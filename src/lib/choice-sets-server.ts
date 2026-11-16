// src/lib/choice-sets-server.ts — CHOICE SETS, KEPT AND SHARED (lib/choice-sets; api/menu 'sets', 'setSave',
// 'setRemove', 'setApply', 'setOff', 'setFrom', 'setSoldOut'). A set lives in tenants/{t}/choiceSets/{id}; each item it's
// on carries a copy as one of its own choices (a group with `setId`, the item's own group id kept), so every menu, order
// and kitchen screen reads items as before. Saving a set writes it onto every item that has it; each item keeps only the
// recipe changes that fit its own recipe. Sold out on a set's option is sold out on every item with it, and back in the
// morning on its own, like any choice.
import { cleanSet, groupKey, groupOfSet, idsOnItem, kindOfGroup, MAX_SETS, optionsLine, setIdsOf, setRule, type ChoiceSet } from '@/lib/choice-sets';
import { cleanChanges, type ChoiceChange } from '@/lib/choice-recipe';
import { choiceGroups, MAX_GROUPS } from '@/lib/menu-choices';
import { isMenuItem, soldOutUntil } from '@/lib/menu-server';
import { recipeOf, type RecipeLine } from '@/lib/menu-stock';
import { canBeIngredient } from '@/lib/prep-recipes-server';
import { toStockUnits } from '@/lib/kitchen-units';
import { randomBytes } from 'crypto';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const newId = () => randomBytes(6).toString('base64url');
export class SetStop extends Error { constructor(public msg: string, public status = 400) { super(msg); } }

/** The recipe changes that fit an item: what's added is in stock and measurable that way; what's swapped out or left out
 *  is in its recipe, and what's swapped in can stand in the same measure. The rest do nothing on that item. */
export function fitChanges(list: ChoiceChange[], recipe: RecipeLine[], parts: Map<string, any>): ChoiceChange[] {
  const out: ChoiceChange[] = [];
  for (const c of list) {
    if (c.kind === 'add') { const p = parts.get(c.id); if (p && canBeIngredient(p, c.id) && toStockUnits(c.amount, c.measure, p) !== null) out.push(c); }
    else if (c.kind === 'swap') {
      const line = recipe.find((l) => l.id === c.from); const p = parts.get(c.to);
      if (line && p && canBeIngredient(p, c.to) && toStockUnits(line.measure ? Number(line.amount) : line.quantityUsed, line.measure || line.unit, p) !== null) out.push({ ...c, fromName: line.name });
    } else if (recipe.some((l) => l.id === c.id)) out.push(c);
  }
  return out;
}

function setOf(id: string, x: any): ChoiceSet | null {
  const c = cleanSet(x, newId); return 'error' in c ? null : { id, ...c };
}
export async function readSet(db: any, tenantId: string, id: string): Promise<ChoiceSet | null> {
  if (!ID.test(id)) return null; const x = (await db.doc(`tenants/${tenantId}/choiceSets/${id}`).get()).data(); return x ? setOf(id, x) : null;
}
/** Every menu item (for the list of sets and the choices that could be one). */
async function menuItems(db: any, tenantId: string): Promise<[string, any][]> {
  const snap = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(3000).get();
  return snap.docs.map((d: any) => [d.id, d.data() || {}] as [string, any]).filter(([, x]: [string, any]) => isMenuItem(x));
}
/** The items a set is on: each keeps the sets its choices come from (`choiceSetIds`), so they're found at once. */
async function itemsWith(db: any, tenantId: string, setId: string): Promise<[string, any][]> {
  const snap = await db.collection(`tenants/${tenantId}/inventory`).where('choiceSetIds', 'array-contains', setId).limit(3000).get();
  return snap.docs.map((d: any) => [d.id, d.data() || {}] as [string, any]).filter(([, x]: [string, any]) => isMenuItem(x) && (Array.isArray(x.choices) ? x.choices : []).some((g: any) => g?.setId === setId));
}
async function partsFor(db: any, tenantId: string, s: ChoiceSet): Promise<Map<string, any>> {
  const ids = Array.from(new Set(s.options.flatMap((o) => (o.changes || []).flatMap((c) => (c.kind === 'add' ? [c.id] : c.kind === 'swap' ? [c.to] : [])))));
  const out = new Map<string, any>(); if (!ids.length) return out;
  const snaps = await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`)));
  ids.forEach((id, k) => { const d = snaps[k]?.data?.(); if (d) out.set(id, d); }); return out;
}

/** Writes the set onto items, each in its own transaction (a save on the item meanwhile is read again, never written
 *  over; what's sold out is read from the set in the same transaction, so a tap in the kitchen is never undone): where
 *  it's already one of the item's choices (or `match` says this choice is the same one), it's replaced, each option
 *  keeping the id it has on the item; with `add`, an item without it gets it at the end. Returns how many changed, and
 *  those already at the most choices. */
async function writeOnto(db: any, tenantId: string, s: ChoiceSet, ids: string[], opts: { add?: boolean; match?: (g: any) => boolean; by: string }): Promise<{ changed: number; full: string[] }> {
  const parts = await partsFor(db, tenantId, s); let changed = 0; const full: string[] = []; const at = new Date().toISOString();
  const sref = db.doc(`tenants/${tenantId}/choiceSets/${s.id}`);
  for (let k = 0; k < ids.length; k += 10) {
    await Promise.all(ids.slice(k, k + 10).map(async (id) => {
      const ref = db.doc(`tenants/${tenantId}/inventory/${id}`);
      const r = await db.runTransaction(async (tx: any) => {
        const [x, live]: any[] = await Promise.all([tx.get(ref), tx.get(sref)]).then((d) => d.map((y: any) => y.data()));
        if (!x || !isMenuItem(x) || !live) return null;
        const out = new Map<string, any>((Array.isArray(live.options) ? live.options : []).map((o: any) => [String(o?.id), o]));
        const now: ChoiceSet = { ...s, options: s.options.map((o) => { const w = out.get(o.id); return { ...o, soldOut: w?.soldOut === true, soldOutUntil: w?.soldOutUntil || null }; }) };
        const raw: any[] = Array.isArray(x.choices) ? x.choices : []; const recipe = recipeOf(x, id);
        const fit = (o: any) => fitChanges(o.changes || [], recipe, parts);
        let hit = false;
        const next = raw.map((g) => {
          if (String(g?.setId || '') === s.id) { hit = true; return groupOfSet(now, String(g.id), fit, idsOnItem(g)); }
          if (!g?.setId && opts.match?.(g)) {
            // The same choice made a set: its options are the set's, in order, each keeping the id it has here.
            const own = choiceGroups({ choices: [g] })[0]?.options || [];
            hit = true; return groupOfSet(now, String(g.id), fit, new Map(now.options.map((o, i) => [o.id, own[i]?.id || o.id])));
          }
          return g;
        });
        if (!hit) { if (!opts.add) return null; if (raw.length >= MAX_GROUPS) return 'full'; next.push(groupOfSet(now, newId(), fit)); }
        tx.set(ref, { choices: next, choiceSetIds: setIdsOf(next), menuUpdatedAt: at, menuUpdatedBy: words(opts.by, 60) || null }, { merge: true });
        return 'ok';
      });
      if (r === 'ok') changed++; else if (r === 'full') full.push(id);
    }));
  }
  return { changed, full };
}

/** Every set, with the items it's on; and choices the same on several items that aren't a set yet (each one offered as
 *  one, in a tap). */
export async function listSets(db: any, tenantId: string) {
  const [snap, items] = await Promise.all([db.collection(`tenants/${tenantId}/choiceSets`).limit(MAX_SETS).get(), menuItems(db, tenantId)]);
  const on = new Map<string, { id: string; name: string; section: string }[]>(); const same = new Map<string, { g: any; items: { id: string; name: string }[] }>();
  for (const [id, x] of items) for (const g of choiceGroups(x, true)) {
    if (g.setId) { on.set(g.setId, [...(on.get(g.setId) || []), { id, name: words(x.name, 80) || 'Item', section: words(x.category, 40) || 'Menu' }]); continue; }
    const k = groupKey(g); const cur = same.get(k) || { g: { ...g, itemId: id }, items: [] }; cur.items.push({ id, name: words(x.name, 80) || 'Item' }); same.set(k, cur);
  }
  const sets = snap.docs.map((d: any) => setOf(d.id, d.data() || {})).filter(Boolean).map((s: ChoiceSet) => ({ ...s, rule: setRule(s), line: optionsLine(s), on: (on.get(s.id) || []).sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a: any, b: any) => b.on.length - a.on.length || a.name.localeCompare(b.name));
  const suggestions = Array.from(same.values()).filter((x) => x.items.length >= 2).sort((a, b) => b.items.length - a.items.length).slice(0, 6)
    .map((x) => ({ name: x.g.name, rule: setRule({ kind: kindOfGroup(x.g), required: x.g.required, max: x.g.max, options: x.g.options }), line: optionsLine(x.g), itemId: x.g.itemId, groupId: x.g.id, count: x.items.length, items: x.items.map((i) => i.name).slice(0, 8) }));
  return { sets, suggestions, items: items.map(([id, x]) => ({ id, name: words(x.name, 80) || 'Item', section: words(x.category, 40) || 'Menu' })).sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name)) };
}

/** A set made or changed: kept, and written onto every item it's on. What's sold out stays as the kitchen left it (read
 *  and written in one step, so a tap meanwhile is kept); a new set made from an item's choice starts as that choice is
 *  (`seedOut`: its options sold out now, by the set's option id). */
export async function saveSet(db: any, tenantId: string, raw: any, by: string, seedOut?: Map<string, string | null>): Promise<{ set: ChoiceSet; items: number }> {
  const T = `tenants/${tenantId}`; const given = String(raw?.id || '');
  const c = cleanSet(raw, newId); if ('error' in c) throw new SetStop(c.error);
  const known = ID.test(given) && !!(await db.doc(`${T}/choiceSets/${given}`).get()).data();
  if (!known) { const n = (await db.collection(`${T}/choiceSets`).limit(MAX_SETS).get()).docs.length; if (n >= MAX_SETS) throw new SetStop(`Up to ${MAX_SETS} choice sets.`); }
  const id = known ? given : db.collection(`${T}/choiceSets`).doc().id; const sref = db.doc(`${T}/choiceSets/${id}`);
  const s: ChoiceSet = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(sref)).data() || null; const at = new Date().toISOString();
    if (known && !cur) throw new SetStop('That set isn’t there any more.', 404);
    const was = new Map<string, any>((cur?.options || []).map((o: any) => [String(o.id), o]));
    const made: ChoiceSet = { id, ...c, options: c.options.map((o) => {
      const w = was.get(o.id); if (w) return { ...o, soldOut: w.soldOut === true, soldOutUntil: w.soldOutUntil || null };
      return { ...o, soldOut: !cur && !!seedOut?.has(o.id), soldOutUntil: (!cur && seedOut?.get(o.id)) || null };
    }) };
    tx.set(sref, { ...made, updatedAt: at, updatedBy: words(by, 60) || null, createdAt: cur?.createdAt || at });
    return made;
  });
  const r = await writeOnto(db, tenantId, s, (await itemsWith(db, tenantId, s.id)).map(([iid]) => iid), { by });
  return { set: s, items: r.changed };
}

/** The set put on these items (each gets it as one of its choices, at the end). */
export async function applySet(db: any, tenantId: string, setId: string, itemIds: unknown, by: string): Promise<{ added: number; full: string[] }> {
  const s = await readSet(db, tenantId, setId); if (!s) throw new SetStop('That set isn’t there any more.', 404);
  const want = Array.from(new Set((Array.isArray(itemIds) ? itemIds : []).map(String).filter((x) => ID.test(x)))).slice(0, 500);
  const snaps: any[] = want.length ? await db.getAll(...want.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`))) : [];
  const ids = want.filter((id, k) => { const x = snaps[k]?.data?.(); return isMenuItem(x) && !(Array.isArray(x.choices) ? x.choices : []).some((g: any) => g?.setId === s.id); });
  const r = await writeOnto(db, tenantId, s, ids, { add: true, by });
  return { added: r.changed, full: r.full };
}

/** One item without the set: taken off it, or kept as a choice of its own (changed only on that item from now on). */
export async function setOff(db: any, tenantId: string, setId: string, itemId: string, keep: boolean): Promise<void> {
  if (!ID.test(setId) || !ID.test(itemId)) throw new SetStop('Which item?');
  const ref = db.doc(`tenants/${tenantId}/inventory/${itemId}`);
  await db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(ref)).data(); if (!x) throw new SetStop('That item isn’t there any more.', 404);
    const raw: any[] = Array.isArray(x.choices) ? x.choices : [];
    const next = keep ? raw.map((g) => { if (g?.setId !== setId) return g; const { setId: _drop, ...rest } = g; return { ...rest, options: (Array.isArray(g.options) ? g.options : []).map((o: any) => { const { setOption: _s, ...own } = o || {}; return own; }) }; })
      : raw.filter((g) => g?.setId !== setId);
    tx.set(ref, { choices: next, choiceSetIds: setIdsOf(next), menuUpdatedAt: new Date().toISOString() }, { merge: true });
  });
}

/** A set taken away: every item keeps it as a choice of its own. */
export async function removeSet(db: any, tenantId: string, setId: string): Promise<number> {
  if (!ID.test(setId)) throw new SetStop('Which set?');
  const ids = (await itemsWith(db, tenantId, setId)).map(([id]) => id);
  for (const id of ids) await setOff(db, tenantId, setId, id, true);
  await db.doc(`tenants/${tenantId}/choiceSets/${setId}`).delete();
  return ids.length;
}

/** A choice on an item made into a set, and every item with the same choice (same name, picked the same way, the same
 *  options and prices) linked to it, each keeping its own ids (so its orders and past sales still read the same). Its
 *  recipe changes come with it, and what's sold out on it now. */
export async function setFromGroup(db: any, tenantId: string, itemId: string, groupId: string, by: string): Promise<{ set: ChoiceSet; items: number }> {
  if (!ID.test(itemId)) throw new SetStop('Which item?');
  const x: any = (await db.doc(`tenants/${tenantId}/inventory/${itemId}`).get()).data(); if (!x) throw new SetStop('That item isn’t there any more.', 404);
  const rawG = (Array.isArray(x.choices) ? x.choices : []).find((g: any) => String(g?.id) === groupId); const g = choiceGroups({ choices: rawG ? [rawG] : [] }, true)[0];
  if (!g) throw new SetStop('That choice isn’t on the item any more.', 404);
  if (g.setId) throw new SetStop('That choice is already a set.', 409);
  const key = groupKey(g);
  const rawOpt = (id: string) => (rawG.options || []).find((y: any) => String(y?.id) === id);
  const same = (h: any) => { const c = choiceGroups({ choices: [h] }, true)[0]; return !!c && !c.setId && groupKey(c) === key; };
  const linked = (await menuItems(db, tenantId)).filter(([, y]) => (Array.isArray(y.choices) ? y.choices : []).some(same));
  // Sold out on any of them now: sold out on the set (the kitchen puts it back with one tap), never brought back by it.
  const seedOut = new Map<string, string | null>();
  for (const [, y] of linked) for (const h of (Array.isArray(y.choices) ? y.choices : []).filter(same)) {
    (choiceGroups({ choices: [h] })[0]?.options || []).forEach((o, k) => {
      const sid = g.options[k]?.id; if (!sid || !o.soldOut) return;
      const u = (h.options || []).find((x: any) => String(x?.id) === o.id)?.soldOutUntil; const until = u ? String(u) : null;
      // The latest it comes back (none: until someone puts it back).
      if (!seedOut.has(sid) || (seedOut.get(sid) !== null && (until === null || until > String(seedOut.get(sid))))) seedOut.set(sid, until);
    });
  }
  const { set } = await saveSet(db, tenantId, { name: g.name, kind: kindOfGroup(g), required: g.required, max: g.max,
    options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price, changes: cleanChanges(rawOpt(o.id)?.changes) })) }, by, seedOut);
  const r = await writeOnto(db, tenantId, set, linked.map(([id]) => id), { match: same, by });
  return { set, items: r.changed };
}

/** Sold out (or back) on a set's option: on the set and every item with it, back on its own in the morning. One item
 *  that can't be written doesn't stop the rest (the next tap puts it right). */
export async function setOptionSoldOut(db: any, tenantId: string, setId: string, optionId: string, out: boolean, by: string): Promise<number> {
  const T = `tenants/${tenantId}`; if (!ID.test(setId) || !/^[A-Za-z0-9_-]{1,40}$/.test(optionId)) throw new SetStop('Which choice?');
  const tenant: any = (await db.doc(T).get()).data() || {}; const until = out ? soldOutUntil(tenant) : null; const at = new Date().toISOString();
  const sref = db.doc(`${T}/choiceSets/${setId}`);
  await db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(sref)).data(); if (!x) throw new SetStop('That set isn’t there any more.', 404);
    if (!(x.options || []).some((o: any) => String(o?.id) === optionId)) throw new SetStop('That choice isn’t in the set.', 404);
    tx.set(sref, { options: (x.options || []).map((o: any) => (String(o?.id) === optionId ? { ...o, soldOut: out, soldOutUntil: until, soldOutBy: out ? words(by, 60) || null : null } : o)), updatedAt: at }, { merge: true });
  });
  let n = 0;
  for (const [id] of await itemsWith(db, tenantId, setId)) {
    const ref = db.doc(`${T}/inventory/${id}`);
    try {
      await db.runTransaction(async (tx: any) => {
        const y: any = (await tx.get(ref)).data(); if (!y) return;
        // The item's own id for the set's option (lib/choice-sets groupOfSet: `setOption`).
        const next = (Array.isArray(y.choices) ? y.choices : []).map((g: any) => (g?.setId !== setId ? g : { ...g, options: (g.options || []).map((o: any) => (String(o?.setOption || o?.id) === optionId ? { ...o, soldOut: out, soldOutUntil: until } : o)) }));
        tx.set(ref, { choices: next }, { merge: true });
      });
      n++;
    } catch (e: any) { console.error('[menu] set sold out on an item', id, e?.message || e); }
  }
  return n;
}
