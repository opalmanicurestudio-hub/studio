// src/app/api/food-cost/route.ts — FOOD COST (lib/food-cost; design canvas "Food cost"; the page at /food-cost). Managers
// and owners.
//   report  { tenantId, period?: 'week'|'last'|'30' } → for this week so far, last week or the last 30 days (the
//           business's own days, lib/night-close-server): the food and drink sold at the counter, at tables and at the
//           front desk and what it cost to make at today's ingredient costs, in all and day by day; each menu item's cost
//           to make against its price; the ingredients still at typical prices; what the counts found against what was
//           sold; and what was thrown away.
//   target  { tenantId, target } → the share of its price an item should cost (10% to 60%), kept as foodCost.target.
//   cost    { tenantId, itemId, cost } → what the business pays for an ingredient (per container, as Inventory has it):
//           it's no longer a typical price. Never changes a menu price.
//   yield   { tenantId, itemId, usablePct?, cookLossPct?, perEach? } → an ingredient's yield (lib/kitchen-units): the share
//           usable after trimming (5 to 100), the share lost in cooking when a recipe weighs it cooked (0 to 90), and
//           what one gives when it's counted one by one ({ amount, unit }, a lemon's 45 ml of juice); empty clears each.
//   extras  { tenantId, extras: [{ id?, itemId, amount, measure, per, when, sections }] } → what goes out with food and
//           drink, set once (lib/plate-extras): each checked against the stock and how it's measured; the whole list.
//   cardFee { tenantId, pct } → what card payments cost, as a share of what's charged (0 to 10%), for each plate's cost.
//   (The report also gives what a plate really costs at a table and to go, what went out with food and drink, and the
//   staff meals, lib/counter-server staffMeal; and the prices that moved in the stretch, from deliveries, with the dishes
//   and choices each one moved, lib/price-creep.)
//   view    { tenantId, period? } → the same stretch as a report anyone can read (lib/food-cost-report: the page
//           /food-cost/report); csv → its table as a spreadsheet { name, csv }.
//   price   { tenantId, itemId, price, was } → a menu item's price, from Prices that moved ("Price it at $16"): only while
//           it's still `was` (another screen may have changed it); the desk's price follows, as the Menu page does it.
//   moved   { tenantId, itemIds } → anyone on the team, after putting a delivery away on the stock screens: the managers
//           are told when it pushed a dish over the aim (lib/price-creep-server). Says nothing about costs back.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { toolLocked } from '@/lib/tool-lock';
import { logAuditAdmin } from '@/lib/audit';
import { isMenuItem } from '@/lib/menu-server';
import { recipeOf } from '@/lib/menu-stock';
import { perContainer } from '@/lib/product-cost';
import { nightBounds, tonight } from '@/lib/night-close-server';
import { cleanPeriod, cleanTarget, costWith, countRows, itemCost, linesCost, partUnitCost, periodCost, periodDays, targetOf, wasteOf, type CountEntry, type ItemCost, type SoldLine } from '@/lib/food-cost';
import { cleanPct, cleanPerEach, COOK_LOSS_MAX, measuresFor, toStockUnits, USABLE_MIN } from '@/lib/kitchen-units';
import { cardFeeOf, cleanCardFee, cleanExtras, extrasOf, extraWords, MAX_EXTRAS } from '@/lib/plate-extras';
import { canBeIngredient } from '@/lib/prep-recipes-server';
import { unitLabel } from '@/lib/product-cost';
import { prepOf } from '@/lib/prep-recipes';
import { changeIds, changesRecipe } from '@/lib/choice-recipe';
import { choiceGroups, picksOf } from '@/lib/menu-choices';
import { effectsOf, hurtBy, moveOf } from '@/lib/price-creep';
import { checkDeliveries } from '@/lib/price-creep-server';
import { bump } from '@/lib/rate-limit';
import { foodCostReport } from '@/lib/food-cost-report';
import { reportCsv } from '@/lib/report-kit';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const live = (x: any) => x && x.archived !== true && x.status !== 'archived';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'report');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['report', 'view', 'csv', 'target', 'cost', 'yield', 'extras', 'cardFee', 'price', 'moved'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, action === 'moved' ? 'staff' : 'manager'); if (g.deny) return g.deny;
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = (await db.doc(T).get()).data() || {};
  { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }
  const by = String(g.actor?.name || 'A manager').slice(0, 60); const now = new Date().toISOString();

  if (action === 'target') {
    const t = cleanTarget(b.target); if (t === null) return bad('Pick a share between 10% and 60%.');
    await db.doc(T).set({ foodCost: { target: t, setBy: by, setAt: now }, updatedAt: now }, { merge: true });
    return ok({ target: t });
  }

  if (action === 'cost') {
    const itemId = String(b.itemId || ''); if (!ID.test(itemId)) return bad('Which ingredient?');
    const cost = Math.round(num(b.cost) * 100) / 100;
    if (!(cost > 0) || cost > 100000) return bad('Type what you pay for one, more than $0.');
    const ref = db.doc(`${T}/inventory/${itemId}`);
    const r: any = await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(ref)).data();
      if (!live(x)) return { error: 'That ingredient isn’t there any more.', status: 404 };
      if (x.type === 'refreshment' && recipeOf(x, itemId).length) return { error: 'That’s made from a recipe: its cost comes from its ingredients.', status: 400 };
      tx.set(ref, { costPerUnit: cost, typicalCost: false, costSetBy: by, costSetAt: now, updatedAt: now }, { merge: true });
      return { ok: true, name: String(x.name || 'An ingredient'), was: num(x.costPerUnit), container: String(x.container || '') };
    });
    if (r.error) return bad(r.error, r.status);
    await logAuditAdmin(db, tenantId, { action: 'inventory.cost', targetType: 'inventory', targetId: itemId, summary: `${by} set what ${r.name} costs: $${cost.toFixed(2)}${r.container ? ` a ${r.container}` : ''} (was $${r.was.toFixed(2)}, a typical price).`, actor: { type: 'user', id: String(g.actor?.uid || ''), name: by } } as any).catch(() => {});
    return ok({ itemId, cost });
  }

  if (action === 'yield') {
    const itemId = String(b.itemId || ''); if (!ID.test(itemId)) return bad('Which ingredient?');
    const patch: Record<string, any> = {};
    if (b.usablePct !== undefined) { const v = cleanPct(b.usablePct, USABLE_MIN, 100); if (v === null) return bad(`Usable after trimming: a share from ${USABLE_MIN}% to 100%, or leave it empty.`); patch.usablePct = v === '' || v === 100 ? null : v; }
    if (b.cookLossPct !== undefined) { const v = cleanPct(b.cookLossPct, 0, COOK_LOSS_MAX); if (v === null) return bad(`Lost in cooking: a share up to ${COOK_LOSS_MAX}%, or leave it empty.`); patch.cookLossPct = v === '' || v === 0 ? null : v; }
    if (b.perEach !== undefined) { const v = cleanPerEach(b.perEach); if (v === 'bad') return bad('What one gives: an amount and a weight or volume, like 45 ml.'); patch.perEach = v; }
    if (!Object.keys(patch).length) return bad('Nothing to change.');
    const ref = db.doc(`${T}/inventory/${itemId}`);
    const r: any = await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(ref)).data();
      if (!live(x)) return { error: 'That ingredient isn’t there any more.', status: 404 };
      if (x.type === 'refreshment' && recipeOf(x, itemId).length) return { error: 'That’s made from a recipe: its ingredients have the yields.', status: 400 };
      if (prepOf(x)) return { error: 'A prep recipe is all usable. Change what a batch makes instead.', status: 400 };
      tx.set(ref, { ...patch, yieldSetBy: by, yieldSetAt: now, updatedAt: now }, { merge: true });
      return { name: String(x.name || 'An ingredient') };
    });
    if (r.error) return bad(r.error, r.status);
    const said = [patch.usablePct !== undefined ? `usable ${patch.usablePct === null ? 'all of it' : `${patch.usablePct}%`}` : '', patch.cookLossPct !== undefined ? `lost in cooking ${patch.cookLossPct === null ? 'none' : `${patch.cookLossPct}%`}` : '', patch.perEach !== undefined ? (patch.perEach ? `one gives ${patch.perEach.amount} ${patch.perEach.unit}` : 'what one gives cleared') : ''].filter(Boolean).join(', ');
    await logAuditAdmin(db, tenantId, { action: 'inventory.yield', targetType: 'inventory', targetId: itemId, summary: `${by} set ${r.name}’s yield: ${said}.`, actor: { type: 'user', id: String(g.actor?.uid || ''), name: by } } as any).catch(() => {});
    return ok({ itemId, usablePct: patch.usablePct, cookLossPct: patch.cookLossPct, perEach: patch.perEach });
  }

  if (action === 'moved') {
    // What was just put away (the last six hours, so a screen whose clock is off still counts it; a delivery is told about
    // once, however often it's asked). A few hundred an hour for the business at most: a screen asking in a loop reads
    // nothing past that.
    const ids = (Array.isArray(b.itemIds) ? b.itemIds : []).map(String).filter((x: string) => ID.test(x)).slice(0, 50);
    if (!ids.length) return ok({ moved: 0 });
    if (!(await bump(`price_moved_${tenantId}_${Math.floor(Date.now() / 3600000)}`, 300, 2 * 3600000).catch(() => true))) return ok({ moved: 0, later: true });
    const moves = await checkDeliveries(db, tenantId, tenant, ids, new Date(Date.now() - 6 * 3600000).toISOString()).catch((e: any) => { console.error('[food-cost] delivery check', e?.message || e); return []; });
    return ok({ moved: moves.length });
  }

  if (action === 'price') {
    const itemId = String(b.itemId || ''); if (!ID.test(itemId)) return bad('Which item?');
    const price = Math.round(num(b.price) * 100) / 100; const was = Math.round(num(b.was) * 100) / 100;
    if (!(price > 0) || price > 10000) return bad('A price of more than $0.');
    const ref = db.doc(`${T}/inventory/${itemId}`);
    const r: any = await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(ref)).data();
      if (!x || x.type !== 'refreshment' || x.archived === true) return { error: 'That isn’t on the menu any more.', status: 404 };
      const cur = Math.round(num(x.price) * 100) / 100;
      if (cur !== was) return { error: `Its price is $${cur.toFixed(2)} now (it changed since this was worked out). Look again.`, status: 409 };
      // A required choice that takes something off can't take it below nothing.
      const lowest = price + choiceGroups(x).filter((cg: any) => cg.required && cg.pick === 'one' && cg.options.length).reduce((t: number, cg: any) => t + Math.min(...cg.options.map((o: any) => num(o.price))), 0);
      if (lowest < 0) return { error: 'A choice takes off more than that price. Change it on the Menu.', status: 400 };
      // The desk and a table's tab charge the item's own price: it follows, as the Menu page's save does.
      const deskToo = !(num(x.msrp) > 0) || Math.round(num(x.msrp) * 100) === Math.round(cur * 100);
      tx.set(ref, { price, ...(deskToo ? { msrp: price } : {}), menuUpdatedAt: now, menuUpdatedBy: by, updatedAt: now }, { merge: true });
      return { name: String(x.name || 'Item'), was: cur };
    });
    if (r.error) return bad(r.error, r.status);
    await logAuditAdmin(db, tenantId, { action: 'menu.price', targetType: 'inventory', targetId: itemId, summary: `${by} priced ${r.name} at $${price.toFixed(2)} (was $${r.was.toFixed(2)}), from Prices that moved.`, actor: { type: 'user', id: String(g.actor?.uid || ''), name: by } } as any).catch(() => {});
    return ok({ price });
  }

  if (action === 'cardFee') {
    const pct = cleanCardFee(b.pct); if (pct === null) return bad('Card fees: a share from 0% to 10%, like 2.9.');
    await db.doc(T).set({ foodCost: { cardFeePct: pct, cardFeeSetBy: by, cardFeeSetAt: now }, updatedAt: now }, { merge: true });
    return ok({ cardFeePct: pct });
  }

  if (action === 'extras') {
    const raw: any[] = Array.isArray(b.extras) ? b.extras : null as any;
    if (!raw) return bad('Check the list.');
    if (raw.length > MAX_EXTRAS) return bad(`Up to ${MAX_EXTRAS} of these.`);
    const list = cleanExtras(raw);
    if (list.length !== raw.length) return bad('One of them isn’t complete: pick what it is and how much, then save again.');
    // Each from the business's own stock, in a measure it can be taken off in (a box by the each, napkins by the each).
    const snaps: any[] = list.length ? await db.getAll(...list.map((e) => db.doc(`${T}/inventory/${e.itemId}`))) : [];
    for (const [k, e] of list.entries()) {
      const x: any = snaps[k]?.exists ? snaps[k].data() : null;
      if (!x || !canBeIngredient(x, e.itemId)) return bad(`${x ? String(x.name || 'One of them') : 'One of them'} isn’t in your stock any more. Pick another.`, 409);
      if (toStockUnits(e.amount, e.measure, x) === null) return bad(`${String(x.name || 'That')} is counted in ${unitLabel(x)}, so ${e.amount} ${e.measure} can’t be worked out from that. Use ${measuresFor(x).slice(0, 4).join(', ')}.`);
      e.name = String(x.name || e.name).replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    await db.doc(T).set({ foodCost: { extras: list, extrasSetBy: by, extrasSetAt: now }, updatedAt: now }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'food_cost.extras', targetType: 'tenant', targetId: tenantId, summary: `${by} set what goes out with food and drink: ${list.map((e) => `${e.name} ${extraWords(e)}`).join('; ') || 'none'}.`, actor: { type: 'user', id: String(g.actor?.uid || ''), name: by } } as any).catch(() => {});
    return ok({ extras: list });
  }

  // REPORT
  const period = cleanPeriod(b.period); const target = targetOf(tenant);
  const today = tonight(tenant); const days = periodDays(period, today);
  const start = nightBounds(tenant, days[0]).start, end = nightBounds(tenant, days[days.length - 1]).end;
  const dayOf = (iso: string) => tonight(tenant, new Date(iso));
  const inv = await db.collection(`${T}/inventory`).limit(2000).get();
  const all = new Map<string, any>(inv.docs.map((d: any) => [d.id, d.data() || {}]));
  const menu = Array.from(all.entries()).filter(([, x]) => isMenuItem(x));
  const costs = new Map<string, ItemCost>();
  // Every refreshment, on the menu now or not (something sold last week and since taken off still has a cost). What a
  // plate really costs (its extras and card fee) is worked out below, once the stretch's card share is known.
  for (const [id, x] of all) if (x.type === 'refreshment') costs.set(id, itemCost(id, x, all, target));
  const extras = extrasOf(tenant); const cardPct = cardFeeOf(tenant);
  // The ingredients the menu's recipes use, and the ones still at a typical price.
  // (What its choices can add or swap in, and what a prep recipe in it is made of, two levels down, count too.)
  const used = new Set<string>(); for (const [id, x] of menu) { for (const l of recipeOf(x, id)) used.add(l.id); for (const c of changeIds(x)) used.add(c); }
  for (let level = 0; level < 2; level++) for (const id of Array.from(used)) { const p = all.get(id); if (prepOf(p)) for (const l of recipeOf(p, id)) used.add(l.id); }
  const typical = Array.from(used).map((id) => [id, all.get(id)] as [string, any]).filter(([, p]) => live(p) && p.typicalCost === true)
    .map(([id, p]) => ({ id, name: String(p.name || 'Ingredient'), container: String(p.container || ''), cost: num(p.costPerUnit), per: perContainer(p), unit: String(p.costingMethod === 'uses' ? p.useUnit || 'uses' : p.costingMethod === 'size' ? p.unit || 'ml' : '') }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const [rc, co, ap, tossed, counted, voidedOrders] = await Promise.all([
    db.collection(`${T}/receipts`).where('date', '>=', start).where('date', '<', end).limit(5000).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/counterOrders`).where('paidAt', '>=', start).where('paidAt', '<', end).limit(5000).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/approvals`).where('day', '>=', days[0]).where('day', '<=', days[days.length - 1]).limit(5000).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/holdingBins`).where('tossedAt', '>=', start).where('tossedAt', '<', end).limit(2000).get().catch(() => ({ docs: [] as any[] })),
    // The counts in the stretch. Without the index for that (kind and date together), every count, kept to the stretch
    // here: they're few (one per ingredient each time it's counted).
    db.collection(`${T}/stockCorrections`).where('type', '==', 'counted').where('date', '>=', start).where('date', '<', end).limit(5000).get()
      .catch((e: any) => { console.warn('[food-cost] counts by date need an index; reading them all', e?.message || e); return db.collection(`${T}/stockCorrections`).where('type', '==', 'counted').limit(5000).get(); })
      .catch((e: any) => { console.error('[food-cost] counts not read', e?.message || e); return { docs: [] as any[] }; }),
    // Counter and drive-thru orders voided after the kitchen made them (lib/counter-server keeps what was made).
    db.collection(`${T}/counterOrders`).where('voidedAt', '>=', start).where('voidedAt', '<', end).limit(2000).get().catch(() => ({ docs: [] as any[] })),
  ]);
  // …and what was made and then taken off an order before it was paid (lib/counter-takeoff-server), kept apart.
  const takenOffOrders: any = await db.collection(`${T}/counterOrders`).where('wastedAt', '>=', start).where('wastedAt', '<', end).limit(2000).get().catch(() => ({ docs: [] as any[] }));
  // What went out with food and drink (set once: lib/plate-extras), as taken off stock in the stretch. Without the index
  // for that (marked and dated together), every marked one, kept to the stretch here.
  const extraSnap: any = await db.collection(`${T}/stockCorrections`).where('extra', '==', true).where('date', '>=', start).where('date', '<', end).limit(5000).get()
    .catch(() => db.collection(`${T}/stockCorrections`).where('extra', '==', true).limit(5000).get()).catch(() => ({ docs: [] as any[] }));

  const sold: SoldLine[] = [];
  // The front desk's sales (a table's tab is paid there): each product line of a receipt, as it was sold, matched to
  // the item it was by the order they were rung in. Only menu items: a retail product isn't food and drink.
  for (const d of rc.docs) {
    const r: any = d.data() || {}; if (r.voided) continue;
    const ids: any[] = Array.isArray(r.reversal?.products) ? r.reversal.products : [];
    const lines: any[] = (Array.isArray(r.detail?.lines) ? r.detail.lines : []).filter((l: any) => l?.kind === 'product');
    const taken = new Set<number>();
    ids.forEach((p: any, i: number) => {
      // Its line: the next one by its name (the same item twice is two lines, in order), else the one in its place.
      let k = lines.findIndex((l: any, j: number) => !taken.has(j) && String(l?.label || '') === String(p?.name || ''));
      if (k < 0 && !taken.has(i)) k = i; if (k >= 0) taken.add(k);
      const id = String(p?.id || ''); if (all.get(id)?.type !== 'refreshment') return;
      const l = k >= 0 ? lines[k] : null; const qty = num(p.quantity) || num(l?.qty);
      const x = all.get(id); const each = x && changesRecipe(x) && Array.isArray(p?.choices) && p.choices.length ? costWith(id, x, all, picksOf(p.choices)) : undefined;
      sold.push({ itemId: id, qty, amount: l ? num(l.amount) : 0, at: String(r.date), ...(each !== undefined ? { each } : {}) });
    });
  }
  // The counter's and drive-thru's paid orders. A staff meal (settled with no money: lib/counter-server staffMeal) isn't a
  // sale: what it cost is counted apart, by who it was for.
  const staff = new Map<string, { for: string; count: number; cost: number; unknown: number }>(); let paidCard = 0, paidAll = 0;
  // What was paid by card at the desk: each payment on the receipt when it lists them (a split bill, a gift card toward
  // it), else the receipt by how it was paid. A gift card or store credit isn't a card fee.
  const byCard = (m: unknown) => /card|stripe|terminal|tap|reader|client.?screen/i.test(String(m || '')) && !/gift|credit|store/i.test(String(m || ''));
  for (const d of rc.docs) {
    const r: any = d.data() || {}; if (r.voided) continue;
    const pays: any[] = Array.isArray(r.detail?.payments) && r.detail.payments.length ? r.detail.payments : [{ method: r.paymentMethod, amount: r.total }];
    for (const x of pays) { const t = num(x?.amount); paidAll += t; if (byCard(x?.method)) paidCard += t; }
  }
  for (const d of co.docs) {
    const o: any = d.data() || {};
    if (!o.paidAt || o.refundedAt || ['refunded', 'cancelled', 'canceled', 'voided'].includes(String(o.status || ''))) continue;
    if (o.staffMeal) {
      const who = String(o.staffMeal.for || 'Team').slice(0, 40); const cur = staff.get(who.toLowerCase()) || { for: who, count: 0, cost: 0, unknown: 0 };
      cur.count += 1;
      for (const l of Array.isArray(o.lines) ? o.lines : []) { const id = String(l?.itemId || ''); const x = all.get(id); if (!x) continue; const each = costWith(id, x, all, picksOf(l.choices || [])); if (each === null) cur.unknown += 1; else cur.cost = Math.round((cur.cost + each * num(l.quantity)) * 100) / 100; }
      staff.set(who.toLowerCase(), cur); continue;
    }
    const t = num(o.total); paidAll += t; if (o.payMethod === 'card') paidCard += t;
    for (const l of Array.isArray(o.lines) ? o.lines : []) {
      const id = String(l?.itemId || ''); if (!all.has(id)) continue;
      // Made as it was chosen, when its choices change the recipe (an oat latte costs more than a plain one: lib/choice-recipe).
      const x = all.get(id); const each = x && changesRecipe(x) && Array.isArray(l.choices) && l.choices.length ? costWith(id, x, all, picksOf(l.choices)) : undefined;
      sold.push({ itemId: id, qty: num(l.quantity), amount: num(l.unitPrice) * num(l.quantity), at: String(o.paidAt), ...(each !== undefined ? { each } : {}) });
    }
  }
  const report = periodCost(sold, costs, days, dayOf);
  // What a plate really costs, at a table and to go: its recipe, what goes out with it, and the card fee on the share of
  // sales paid by card in the stretch (all of it, with nothing sold yet).
  const cardShare = paidAll > 0 ? Math.round((paidCard / paidAll) * 1000) / 1000 : 1;
  for (const [id, x] of menu) costs.set(id, itemCost(id, x, all, target, { extras, cardPct, cardShare }));
  // The extras as set, each with what one costs, and what went out in the stretch.
  const extrasList = extras.map((e) => ({ ...e, words: extraWords(e), cost: linesCost([{ id: e.itemId, name: e.name, quantityUsed: e.amount, unit: e.measure, amount: e.amount, measure: e.measure }], all).cost }));
  let extrasCost = 0, extrasUnknown = 0;
  // (Taken is a negative change; put back by a void, a positive one, counted off.)
  for (const d of extraSnap.docs) { const e: any = d.data() || {}; if (!(String(e.date || '') >= start && String(e.date || '') < end)) continue; const p = all.get(String(e.productId || '')); const u = p ? partUnitCost(p, all) : null; if (u === null) { extrasUnknown += 1; continue; } extrasCost -= num(e.change) * u; }
  extrasCost = Math.max(0, extrasCost);
  const staffMeals = Array.from(staff.values()).sort((a, c) => c.cost - a.cost);
  // Prices that moved in the stretch, from deliveries (lib/price-creep): what the menu uses, and what goes out with it.
  // Those that pushed a dish over the aim first, then the rises, the biggest first; then what came down.
  const priced = Array.from(new Set([...Array.from(used), ...extras.map((e) => e.itemId)]));
  const moves = priced.map((id) => { const x = all.get(id); if (!live(x) || prepOf(x)) return null; const m = moveOf(id, x, start, end); if (!m) return null; const e = effectsOf(m, all, menu, target); return { ...m, dishes: e.dishes.slice(0, 6), options: e.options.slice(0, 4) }; })
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, c) => Number(c.dishes.some(hurtBy) || c.options.length > 0) - Number(a.dishes.some(hurtBy) || a.options.length > 0) || Number(c.up) - Number(a.up) || Math.abs(c.pct) - Math.abs(a.pct))
    .slice(0, 12);

  const adjustments = ap.docs.map((d: any) => d.data() || {}).filter((a: any) => (a.kind === 'void_item' || a.kind === 'remake') && a.used === true);
  const voided = [...voidedOrders.docs.flatMap((d: any) => Object.entries((d.data() || {}).wastedItems || {}).map(([itemId, qty]) => ({ itemId, qty: num(qty) }))),
    ...takenOffOrders.docs.flatMap((d: any) => Object.entries((d.data() || {}).takenOffWaste || {}).map(([itemId, qty]) => ({ itemId, qty: num(qty) })))];
  const waste = wasteOf(adjustments, tossed.docs.map((d: any) => d.data() || {}).map((x: any) => ({ itemId: String(x.itemId || ''), qty: num(x.tossedQty) })), costs, voided);

  // What the counts in the stretch found. An ingredient counted at what the record said, with nothing written down for it
  // (counted by the dose, where a match isn't recorded), shows as matching.
  const entries: CountEntry[] = counted.docs.map((d: any) => d.data() || {}).filter((e: any) => String(e.date || '') >= start && String(e.date || '') < end)
    .map((e: any) => ({ productId: String(e.productId || ''), date: String(e.date), change: num(e.change), baseline: e.baseline === true }));
  const parts = new Map<string, any>(Array.from(used).map((id) => [id, all.get(id)] as [string, any]).filter(([, x]) => live(x)));
  const countedAt = new Map<string, string>(); for (const [id, x] of parts) { const at = String(x.lastCountedAt || ''); if (at >= start && at < end) countedAt.set(id, at); }
  const counts = countRows(entries, parts, countedAt);

  // Each menu item, the best sellers in the stretch first; those still to be priced last.
  const soldBy = new Map(report.items.map((x) => [x.id, x]));
  const items = menu.map(([id]) => ({ ...costs.get(id)!, sold: soldBy.get(id)?.qty || 0, soldAmount: soldBy.get(id)?.sold || 0, section: String(all.get(id)?.category || all.get(id)?.department || '') }))
    .sort((a, b) => Number(a.needsPrice) - Number(b.needsPrice) || b.soldAmount - a.soldAmount || a.name.localeCompare(b.name));
  // A stretch with more sales than are read at once: said so, rather than a share that looks complete.
  const partial = rc.docs.length >= 5000 || co.docs.length >= 5000 || counted.docs.length >= 5000;
  if (action === 'view' || action === 'csv') {
    const r = foodCostReport({ period, days, today, target, report, items, typical, waste, partial,
      staffMeals: { count: staffMeals.reduce((n, m) => n + m.count, 0), cost: Math.round(staffMeals.reduce((n, m) => n + m.cost, 0) * 100) / 100, unknown: staffMeals.reduce((n, m) => n + m.unknown, 0) } },
      String(tenant.name || '').replace(/\s+/g, ' ').trim().slice(0, 80), now);
    return action === 'view' ? ok({ report: r, period, today }) : ok({ name: r.file, csv: reportCsv(r) });
  }
  return ok({ period, days, today, target, report, items, typical, counts, waste, partial,
    extras: extrasList, cardPct, cardShare, moves, extrasUsed: { cost: Math.round(extrasCost * 100) / 100, unknown: extrasUnknown },
    staffMeals: { count: staffMeals.reduce((n, m) => n + m.count, 0), cost: Math.round(staffMeals.reduce((n, m) => n + m.cost, 0) * 100) / 100, unknown: staffMeals.reduce((n, m) => n + m.unknown, 0), by: staffMeals } });
}
