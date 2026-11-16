// src/lib/prep-recipes-server.ts — PREP RECIPES, on the server (lib/prep-recipes): saved from the Menu page (api/menu
// 'prep'), and a batch made from the prep list (api/prep 'made').
//   A prep recipe is an Inventory item counted in what a batch makes (lib/prep-recipes prepStockFields). Saving it turns
//   each recipe line into what its ingredient is counted in (lib/kitchen-units) and keeps what a batch costs at today's
//   ingredient costs as its cost (lib/food-cost), so a portion of it costs its share everywhere a cost is read.
//   Making a batch takes what goes into it off stock (with what trimming and cooking lose), puts what it makes on the
//   shelf, and writes both on the stock history with who made it, in one step: the next count compares against that.
import { recipeOf, ingredientLeft, needsOf, MAX_RECIPE_LINES } from '@/lib/menu-stock';
import { toStockUnits, measuresFor, canonUnit, convert, sameUnit } from '@/lib/kitchen-units';
import { prepOf, isPrep, prepStockFields, MAX_KEEPS_DAYS, MAX_MINUTES, MAX_MAKES } from '@/lib/prep-recipes';
import { linesCost, ledgerUnit } from '@/lib/food-cost';
import { unitLabel, usesLeft } from '@/lib/product-cost';
import { moveStock } from '@/lib/usage';
import { buildEntry } from '@/lib/stock-ledger';
import { takeParts } from '@/lib/recipe-stock-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const live = (x: any) => !!x && x.archived !== true && x.status !== 'archived' && x.isActive !== false;
type Fail = { error: string; status: number };

/** Can this go into a recipe: something the business stocks (not equipment, not put away), and not a menu item made
 *  from a recipe of its own. */
export function canBeIngredient(x: any, id: string): boolean {
  if (!live(x)) return false;
  if (x.type === 'equipment') return false;
  if (x.type === 'refreshment' && recipeOf(x, id).length) return false;
  return true;
}

/** Inventory items by id, with what any prep recipe among them is made of (and what a prep inside it is made of). */
export async function readPartsDeep(db: any, T: string, ids: string[], parts = new Map<string, any>(), levels = 3): Promise<Map<string, any>> {
  let want = Array.from(new Set(ids)).filter((id) => ID.test(id) && !parts.has(id)).slice(0, 600);
  for (let level = 0; level < levels && want.length; level++) {
    for (let i = 0; i < want.length; i += 300) {
      const snaps: any[] = await db.getAll(...want.slice(i, i + 300).map((id) => db.doc(`${T}/inventory/${id}`))).catch(() => []);
      for (const sn of snaps) if (sn?.exists) parts.set(sn.id, sn.data() || {});
    }
    want = Array.from(new Set(want.flatMap((id) => (prepOf(parts.get(id)) ? recipeOf(parts.get(id), id).map((l) => l.id) : [])))).filter((id) => ID.test(id) && !parts.has(id)).slice(0, 600);
  }
  return parts;
}

/** A recipe as typed on a screen ([{ id, amount, measure }] or older [{ id, quantityUsed }]), turned into what each
 *  ingredient is counted in against the ingredients read. The words for what's wrong when it can't be. */
export function recipeFromScreen(raw: unknown, own: string, parts: Map<string, any>, o: { prep?: boolean } = {}): { formula: any[] } | Fail {
  if (!Array.isArray(raw)) return { error: 'Check the recipe.', status: 400 };
  if (raw.length > MAX_RECIPE_LINES) return { error: `Up to ${MAX_RECIPE_LINES} ingredients in a recipe.`, status: 400 };
  const formula: any[] = [];
  for (const l of raw) {
    const id = String((l as any)?.id || ''); const p = parts.get(id);
    if (!ID.test(id) || id === own || !p || !canBeIngredient(p, id)) return { error: `${p ? words(p.name, 40) || 'One of the ingredients' : 'One of the ingredients'} can’t go into a recipe. Take it off and save again.`, status: 409 };
    const name = words(p.name, 80) || 'Ingredient'; const unit = unitLabel(p);
    const written = (l as any)?.amount !== undefined && (l as any)?.amount !== null;
    const amount = Math.round(num(written ? (l as any).amount : (l as any).quantityUsed) * 1000) / 1000;
    if (!(amount > 0) || amount > 10000) return { error: `How much ${name} goes in? Type an amount above 0.`, status: 400 };
    const measure = words(written ? (l as any).measure : '', 20) || unit;
    const q = toStockUnits(amount, measure, p);
    if (q === null) return { error: `${name} is counted in ${unit}, so ${amount} ${measure} can’t be worked out from that. Use ${measuresFor(p).slice(0, 4).join(', ')}${p.costingMethod === 'uses' || !p.costingMethod ? ', or say in Inventory what one gives' : ''}.`, status: 400 };
    if (o.prep && prepOf(p) && recipeOf(p, id).some((x) => prepOf(parts.get(x.id)))) return { error: `${name} has a prep recipe in it already. A prep recipe can hold another one, one level deep.`, status: 409 };
    // What was written is kept even in the ingredient's own measure (30 ml of an aioli counted in ml): if the ingredient
    // is later counted another way (by the L), the line is turned again from it, never read in the wrong measure.
    const same = formula.find((f) => f.id === id);
    // Listed twice: added up in what it's counted in, and kept as written in that measure (still turned again later).
    if (same) { same.quantityUsed = Math.round((same.quantityUsed + q) * 1000) / 1000; same.amount = same.quantityUsed; same.measure = unit; continue; }
    formula.push({ id, name, quantityUsed: Math.round(q * 1000) / 1000, unit, amount, measure: sameUnit(measure, unit) ? unit : measure });
  }
  return { formula };
}

export type PrepInput = { prepId?: string | null; name?: unknown; makes?: unknown; unit?: unknown; keepsDays?: unknown; minutes?: unknown; recipe?: unknown };

/** Add or change a prep recipe. */
export async function savePrep(db: any, T: string, by: { id: string; name: string }, b: PrepInput): Promise<{ id: string; item: any } | Fail> {
  const name = words(b.name, 80); if (!name) return { error: 'Give it a name, like House aioli.', status: 400 };
  const makes = Math.round(num(b.makes) * 1000) / 1000; if (!(makes > 0) || makes > MAX_MAKES) return { error: 'What does one batch make? Type an amount, like 2.', status: 400 };
  const unit = canonUnit(b.unit) || words(b.unit, 20).toLowerCase(); if (!unit) return { error: 'What is a batch counted in? L, kg, portions…', status: 400 };
  const keeps = b.keepsDays === null || b.keepsDays === undefined || String(b.keepsDays).trim() === '' ? null : Math.floor(num(b.keepsDays));
  if (keeps !== null && (keeps < 1 || keeps > MAX_KEEPS_DAYS)) return { error: `How long it keeps: 1 to ${MAX_KEEPS_DAYS} days, or leave it empty.`, status: 400 };
  const mins = b.minutes === null || b.minutes === undefined || String(b.minutes).trim() === '' ? null : Math.floor(num(b.minutes));
  if (mins !== null && (mins < 1 || mins > MAX_MINUTES)) return { error: `How long it takes: 1 to ${MAX_MINUTES} minutes, or leave it empty.`, status: 400 };
  const raw: any[] = Array.isArray(b.recipe) ? b.recipe : [];
  if (!raw.length) return { error: 'Add what goes into a batch.', status: 400 };
  const editing = typeof b.prepId === 'string' && ID.test(b.prepId) ? b.prepId : null;
  const ref = editing ? db.doc(`${T}/inventory/${editing}`) : db.collection(`${T}/inventory`).doc();
  // Everything it could be confused with or held in: names are kept apart, and a prep inside another stays one level deep.
  const all = await db.collection(`${T}/inventory`).limit(2000).get();
  const docs = new Map<string, any>(all.docs.map((d: any) => [d.id, d.data() || {}]));
  const clash = Array.from(docs.entries()).find(([id, x]) => id !== ref.id && live(x) && words(x.name, 80).toLowerCase() === name.toLowerCase());
  if (clash) return { error: `Something called ${name} is in Inventory already. Give this one another name.`, status: 409 };
  const r0 = recipeFromScreen(raw, ref.id, docs, { prep: true }); if ('error' in r0) return r0;
  const holdsPrep = r0.formula.some((f) => prepOf(docs.get(f.id)));
  const heldIn = Array.from(docs.entries()).find(([id, x]) => id !== ref.id && isPrep(x, id) && recipeOf(x, id).some((l) => l.id === ref.id));
  if (holdsPrep && heldIn) return { error: `${name} goes into ${words(heldIn[1].name, 40) || 'another prep recipe'}, so it can’t hold a prep recipe itself. A prep recipe can hold another one, one level deep.`, status: 409 };
  const batch = linesCost(r0.formula, docs).cost;
  const now = new Date().toISOString();
  const r: any = await db.runTransaction(async (tx: any) => {
    const cur: any = editing ? (await tx.get(ref)).data() : null;
    if (editing && (!cur || !prepOf(cur))) return { error: 'That prep recipe isn’t there any more.', status: 404 };
    const stock = prepStockFields(makes, unit);
    // A batch now counted another way: what's on the shelf is turned into the new measure (2 L is 2000 ml), never lost.
    let shelf: Record<string, any> = {};
    if (cur) {
      const left = usesLeft(cur) || 0; const was = unitLabel(cur); const now2 = stock.costingMethod === 'size' ? stock.unit : stock.useUnit;
      const amt = left > 0 ? (String(was).toLowerCase() === String(now2).toLowerCase() ? left : convert(left, was, now2)) : 0;
      if (amt === null) return { error: `What’s on the shelf is counted in ${was}, and ${now2} can’t be worked out from that. Keep a batch in a ${canonUnit(was) ? 'weight or volume like it' : was}, or count what’s left as none first.`, status: 409 };
      const full = Math.floor(amt / makes + 1e-9);
      shelf = { totalStock: full, partialContainerSize: stock.costingMethod === 'size' ? Math.round((amt - full * makes) * 1000) / 1000 : 0, partialContainerUses: stock.costingMethod === 'uses' ? Math.round((amt - full * makes) * 1000) / 1000 : 0 };
    }
    const prep = { makes, unit, keepsDays: keeps, minutes: mins, lastMadeAt: cur?.prep?.lastMadeAt || null, lastMadeBy: cur?.prep?.lastMadeBy || null };
    const item = { ...(cur ? {} : { id: ref.id, type: 'professional', category: 'Prep', status: 'active', isActive: true, totalStock: 0, partialContainerSize: 0, partialContainerUses: 0, supplier: '', batches: [], countStock: true, createdVia: 'prep-recipe', createdAt: now }),
      name, prep, formula: r0.formula, ...stock, ...shelf, ...(batch !== null ? { costPerUnit: Math.round(batch * 100) / 100, typicalCost: false } : {}), updatedAt: now, prepUpdatedBy: by.name };
    tx.set(ref, item, { merge: true });
    return { item: { ...(cur || {}), ...item } };
  });
  if (r.error) return r;
  return { id: ref.id, item: r.item };
}

/** Put a prep recipe away (it stays on the stock history). Not while a menu item or another prep recipe uses it. */
export async function removePrep(db: any, T: string, prepId: string, byName: string): Promise<{ ok: true } | Fail> {
  if (!ID.test(prepId)) return { error: 'Which prep recipe?', status: 400 };
  const all = await db.collection(`${T}/inventory`).limit(2000).get();
  const usedIn = all.docs.find((d: any) => { const x: any = d.data() || {}; return d.id !== prepId && live(x) && recipeOf(x, d.id).some((l) => l.id === prepId); });
  if (usedIn) return { error: `${words(usedIn.data()?.name, 40) || 'Something'} uses it. Take it out of that recipe first.`, status: 409 };
  const ref = db.doc(`${T}/inventory/${prepId}`);
  const x: any = (await ref.get()).data(); if (!prepOf(x)) return { error: 'That prep recipe isn’t there any more.', status: 404 };
  await ref.set({ archived: true, status: 'archived', archivedAt: new Date().toISOString(), archivedBy: words(byName, 60) }, { merge: true });
  return { ok: true };
}

/** A batch (or a few) made: what goes into them off stock, what they make onto the shelf, both on the stock history. */
export async function makeBatch(db: any, T: string, prepId: string, batches: unknown, by: { id: string; name: string }, tapKey?: unknown): Promise<{ made: number; unit: string; left: number | null; name: string; taken: number; already?: boolean } | Fail> {
  // The same tap sent twice (a reply lost on a weak connection, then tapped again) makes one batch, not two.
  const tap = typeof tapKey === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(tapKey) ? tapKey : null;
  if (!ID.test(prepId)) return { error: 'Which prep recipe?', status: 400 };
  const k = batches === undefined || batches === null || batches === '' ? 1 : Math.floor(num(batches)); if (!(k >= 1 && k <= 20)) return { error: 'How many batches: 1 to 20.', status: 400 };
  const ref = db.doc(`${T}/inventory/${prepId}`);
  return db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(ref)).data(); const p = prepOf(x);
    if (!p || !isPrep(x, prepId)) return { error: 'That prep recipe isn’t there any more.', status: 404 };
    const taps: string[] = Array.isArray(x.prep?.taps) ? x.prep.taps.map(String).slice(-10) : [];
    if (tap && taps.includes(tap)) return { made: 0, unit: p.unit, left: usesLeft(x), name: words(x.name, 60) || 'a prep recipe', taken: 0, already: true };
    const lines = recipeOf(x, prepId);
    // What goes in, and what a prep among them is made of (only for what the batch costs today).
    const parts = new Map<string, any>(); const ids = Array.from(new Set(lines.map((l) => l.id)));
    const snaps = await Promise.all(ids.map((id) => tx.get(db.doc(`${T}/inventory/${id}`))));
    ids.forEach((id, i) => { const d = snaps[i].data(); if (d) parts.set(id, d); });
    const inner = Array.from(new Set(ids.flatMap((id) => (prepOf(parts.get(id)) ? recipeOf(parts.get(id), id).map((l) => l.id) : [])))).filter((id) => ID.test(id) && !parts.has(id));
    const innerSnaps = await Promise.all(inner.map((id) => tx.get(db.doc(`${T}/inventory/${id}`))));
    inner.forEach((id, i) => { const d = innerSnaps[i].data(); if (d) parts.set(id, d); });
    const take: { ref: any; data: any; qty: number }[] = [];
    for (const [id, need] of needsOf(lines, parts)) { const d = parts.get(id); if (d && ingredientLeft(d) !== null) take.push({ ref: db.doc(`${T}/inventory/${id}`), data: d, qty: Math.round(need * k * 1000) / 1000 }); }
    const name = words(x.name, 60) || 'a prep recipe'; const why = `Made ${k} batch${k === 1 ? '' : 'es'} of ${name}`;
    const taken = takeParts(tx, db, T, take, { type: 'used', reason: why, actorId: by.id, actorName: by.name, ref: { kind: 'formula', id: prepId } });
    const made = Math.round(p.makes * k * 1000) / 1000;
    // What's on the shelf after, as whole batches and the one that's open (a full one counts as whole, not open).
    const m = moveStock(x, -made); const after = usesLeft({ ...x, ...m.patch }) || 0; const full = Math.floor(after / p.makes + 1e-9);
    const pk = x.costingMethod === 'uses' ? 'partialContainerUses' : 'partialContainerSize';
    const shelf = { totalStock: full, [pk]: Math.round((after - full * p.makes) * 1000) / 1000 };
    const batch = linesCost(lines, parts).cost; const now = new Date().toISOString();
    tx.set(ref, { ...m.patch, ...shelf, countStock: true, prep: { ...(x.prep || {}), lastMadeAt: now, lastMadeBy: by.name, ...(tap ? { taps: [...taps, tap].slice(-10) } : {}) }, ...(batch !== null ? { costPerUnit: Math.round(batch * 100) / 100, typicalCost: false } : {}), updatedAt: now }, { merge: true });
    tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: prepId, type: 'received', delta: made, unit: ledgerUnit(x), reason: why, actorId: by.id, actorName: by.name, ref: { kind: 'formula', id: prepId } }));
    return { made, unit: p.unit, left: after, name, taken };
  });
}
