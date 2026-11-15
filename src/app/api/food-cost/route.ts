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
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { toolLocked } from '@/lib/tool-lock';
import { logAuditAdmin } from '@/lib/audit';
import { isMenuItem } from '@/lib/menu-server';
import { recipeOf } from '@/lib/menu-stock';
import { perContainer } from '@/lib/product-cost';
import { nightBounds, tonight } from '@/lib/night-close-server';
import { cleanPeriod, cleanTarget, countRows, itemCost, periodCost, periodDays, targetOf, wasteOf, type CountEntry, type ItemCost, type SoldLine } from '@/lib/food-cost';

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
  if (!['report', 'target', 'cost'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
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

  // REPORT
  const period = cleanPeriod(b.period); const target = targetOf(tenant);
  const today = tonight(tenant); const days = periodDays(period, today);
  const start = nightBounds(tenant, days[0]).start, end = nightBounds(tenant, days[days.length - 1]).end;
  const dayOf = (iso: string) => tonight(tenant, new Date(iso));
  const inv = await db.collection(`${T}/inventory`).limit(2000).get();
  const all = new Map<string, any>(inv.docs.map((d: any) => [d.id, d.data() || {}]));
  const menu = Array.from(all.entries()).filter(([, x]) => isMenuItem(x));
  const costs = new Map<string, ItemCost>();
  // Every refreshment, on the menu now or not (something sold last week and since taken off still has a cost).
  for (const [id, x] of all) if (x.type === 'refreshment') costs.set(id, itemCost(id, x, all, target));
  // The ingredients the menu's recipes use, and the ones still at a typical price.
  const used = new Set<string>(); for (const [id, x] of menu) for (const l of recipeOf(x, id)) used.add(l.id);
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
      sold.push({ itemId: id, qty, amount: l ? num(l.amount) : 0, at: String(r.date) });
    });
  }
  // The counter's and drive-thru's paid orders.
  for (const d of co.docs) {
    const o: any = d.data() || {};
    if (!o.paidAt || o.refundedAt || ['refunded', 'cancelled', 'canceled', 'voided'].includes(String(o.status || ''))) continue;
    for (const l of Array.isArray(o.lines) ? o.lines : []) {
      const id = String(l?.itemId || ''); if (!all.has(id)) continue;
      sold.push({ itemId: id, qty: num(l.quantity), amount: num(l.unitPrice) * num(l.quantity), at: String(o.paidAt) });
    }
  }
  const report = periodCost(sold, costs, days, dayOf);

  const adjustments = ap.docs.map((d: any) => d.data() || {}).filter((a: any) => (a.kind === 'void_item' || a.kind === 'remake') && a.used === true);
  const voided = voidedOrders.docs.flatMap((d: any) => Object.entries((d.data() || {}).wastedItems || {}).map(([itemId, qty]) => ({ itemId, qty: num(qty) })));
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
  return ok({ period, days, today, target, report, items, typical, counts, waste, partial });
}
