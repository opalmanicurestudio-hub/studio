// src/lib/usage.ts — ACTUAL USAGE & OPEN CONTAINERS (O8), server.
// Retail sales always took stock off; the products a SERVICE uses (2 ml of polish, 1 use of a buffer…) were only
// used to work out its cost — so back-bar stock only moved when someone corrected it by hand. Now:
//   recordVisitUsage   — after checkout, the visit's products (service + add-ons) come off stock ONCE per visit,
//                        respecting how each is counted (uses / size / units, opening a new container when one runs
//                        out — lib/replenishment-system deductMainStock). Running out is recorded as a shortfall,
//                        never a failed checkout.
//   adjustVisitUsage   — the provider's ACTUAL amounts; only the difference moves (using less puts stock back).
//   containerFinished  — "finished it, opened a new one": what was still expected to be left is logged as waste,
//                        with the container's expected vs actual yield (over-pouring, spills, evaporation).
// Records: tenants/{t}/usage/{visitId} and tenants/{t}/openContainers; every movement in the stock ledger.
import { deductMainStock } from '@/lib/replenishment-system';
import { buildEntry } from '@/lib/stock-ledger';
import { disposablesUsed } from '@/lib/blueprint';
import { costGap, perContainer, unitCost } from '@/lib/product-cost';

export interface UsageLine { productId: string; name: string; unit: string; expected: number; actual?: number; deducted?: number; shortfall?: number; notCounted?: string }
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const unitOf = (it: any) => (it?.costingMethod === 'uses' ? it.useUnit || 'uses' : it?.costingMethod === 'size' ? it.unit || 'ml' : it?.unit || 'units');
// 0 when it's counted by uses or by amount but the number isn't set (lib/product-cost perContainer).
export const containerSize = (it: any) => perContainer(it) || 0;
const partialKey = (it: any) => (it?.costingMethod === 'uses' ? 'partialContainerUses' : it?.costingMethod === 'size' ? 'partialContainerSize' : null);

/** What a visit should have used: its service's products + each add-on's (quantities summed per product). */
export function expectedUsage(service: any, addOns: any[], inventory: any[]): UsageLine[] {
  const m = new Map<string, UsageLine>(); const inv = new Map((inventory || []).map((i: any) => [i.id, i]));
  for (const s of [service, ...(addOns || [])]) for (const p of (s?.products || [])) {
    // A recipe line with no amount counts as one use, as its cost does (lib/product-cost recipeLines).
    const id = String(p?.id ?? p?.productId ?? ''); if (!id) continue; const q = n(p?.quantityUsed) > 0 ? n(p.quantityUsed) : 1; const it: any = inv.get(id) || p;
    const cur = m.get(id) || { productId: id, name: String(it.name || p.name || 'Product'), unit: unitOf(it), expected: 0 };
    cur.expected = Math.round((cur.expected + q) * 1000) / 1000; m.set(id, cur);
  }
  // Disposables on the service's blueprint that are linked to a stock item come off stock too (one client, then thrown away).
  for (const d of disposablesUsed([service, ...(addOns || [])])) {
    if (!d.inventoryItemId) continue; const it: any = inv.get(d.inventoryItemId); if (!it) continue;
    const cur = m.get(d.inventoryItemId) || { productId: d.inventoryItemId, name: String(it.name || d.name), unit: unitOf(it), expected: 0 };
    cur.expected = Math.round((cur.expected + d.qty) * 1000) / 1000; m.set(d.inventoryItemId, cur);
  }
  return Array.from(m.values());
}

/** Take `qty` (in the product's own unit) off stock inside a transaction. Negative qty puts it back. Shared with the
 *  provider's hand-off (lib/visit-handoff), so every path that uses product moves stock the same way. */
export function moveStock(it: any, qty: number): { patch: Record<string, any>; moved: number; shortfall: number; notCounted?: string } {
  const pk = partialKey(it); const size = containerSize(it);
  // Counted by uses or by amount with no number set: there's no telling how many containers this is, so the shelf is
  // left as it is (it used to be set to zero) and the visit says why.
  if (pk && !(size > 0)) return { patch: {}, moved: 0, shortfall: 0, notCounted: costGap(it) || 'no container size or uses' };
  const r = moveStockRaw(it, qty, pk, size);
  // While a cost-per-use test runs, every use is counted, so the test can say how many uses a container really gives.
  if (it?.isExperimentActive === true && qty !== 0) r.patch = { ...r.patch, experimentUses: Math.max(0, Math.round((n(it.experimentUses) + qty) * 1000) / 1000) };
  return r;
}
function moveStockRaw(it: any, qty: number, pk: string | null, size: number): { patch: Record<string, any>; moved: number; shortfall: number; notCounted?: string } {
  if (qty > 0) {
    const r = deductMainStock(it, qty);
    if (r.success) return { patch: { totalStock: r.updatedTotalStock, ...(pk === 'partialContainerUses' ? { partialContainerUses: r.updatedPartialContainerUses ?? n(it.partialContainerUses) } : pk === 'partialContainerSize' ? { partialContainerSize: r.updatedPartialContainerSize ?? n(it.partialContainerSize) } : {}) }, moved: qty, shortfall: 0 };
    // Not enough: use everything there is and record what was missing (the shelf and the app should agree).
    const have = pk ? n(it[pk]) + n(it.totalStock) * size : n(it.totalStock);
    return { patch: { totalStock: 0, ...(pk ? { [pk]: 0 } : {}) }, moved: Math.max(0, have), shortfall: Math.max(0, qty - have) };
  }
  const back = -qty;   // putting stock back
  if (!pk) return { patch: { totalStock: n(it.totalStock) + back }, moved: qty, shortfall: 0 };
  let partial = n(it[pk]) + back; let stock = n(it.totalStock);
  while (size > 0 && partial > size) { partial -= size; stock += 1; }
  return { patch: { totalStock: stock, [pk]: partial }, moved: qty, shortfall: 0 };
}

export async function recordVisitUsage(db: any, tenantId: string, visit: any, lines: UsageLine[], actor: { id?: string; name?: string } = {}) {
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/usage/${visit.id}`); const now = new Date().toISOString();
  if (!lines.length) return { ok: true, skipped: 'nothing to use' };
  return db.runTransaction(async (tx: any) => {
    if ((await tx.get(ref)).exists) return { ok: true, skipped: 'already recorded' };   // once per visit
    const snaps = await Promise.all(lines.map((l) => tx.get(db.doc(`${T}/inventory/${l.productId}`))));
    const out: UsageLine[] = [];
    snaps.forEach((s: any, i: number) => { const l = lines[i]; if (!s.exists) { out.push({ ...l, deducted: 0, shortfall: l.expected }); return; }
      const it = s.data(); const r = moveStock(it, l.expected);
      if (r.notCounted) { out.push({ ...l, deducted: 0, notCounted: r.notCounted }); return; }
      tx.set(s.ref, r.patch, { merge: true });
      tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: l.productId, type: 'used', delta: -l.expected, unit: l.unit, reason: `Used in service — ${visit.clientName || 'client'}${r.shortfall ? ` (short by ${r.shortfall} ${l.unit})` : ''}`, actorId: actor.id || 'system', actorName: actor.name || 'Checkout', ref: { kind: 'appointment', id: visit.id } } as any));
      out.push({ ...l, deducted: r.moved, ...(r.shortfall ? { shortfall: r.shortfall } : {}) }); });
    tx.set(ref, { visitId: visit.id, clientName: visit.clientName || null, staffId: visit.staffId || null, lines: out, recordedAt: now, updatedAt: now, shortfalls: out.filter((l) => l.shortfall).length });
    return { ok: true, lines: out };
  });
}

export async function adjustVisitUsage(db: any, tenantId: string, visitId: string, actual: Record<string, number>, actor: { id?: string; name?: string } = {}) {
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/usage/${visitId}`); const now = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const u: any = (await tx.get(ref)).data(); if (!u) throw new Error('No usage recorded for this visit yet.');
    const lines: UsageLine[] = u.lines || []; const changes: { l: UsageLine; diff: number }[] = [];
    // A line that couldn't be taken off (no size or uses set then) moved nothing: the difference is from nothing.
    for (const l of lines) { if (actual[l.productId] === undefined) continue; const want = Math.max(0, Math.round(n(actual[l.productId]) * 1000) / 1000); const was = l.notCounted ? n(l.deducted) : n(l.actual ?? l.expected); if (want !== was) changes.push({ l, diff: want - was }); }
    const snaps = await Promise.all(changes.map((c) => tx.get(db.doc(`${T}/inventory/${c.l.productId}`))));
    const movedIds = new Set<string>();
    snaps.forEach((s: any, i: number) => { const { l, diff } = changes[i]; if (!s.exists) return; const r = moveStock(s.data(), diff); if (r.notCounted) return; tx.set(s.ref, r.patch, { merge: true }); movedIds.add(l.productId);
      tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: l.productId, type: 'used', delta: -diff, unit: l.unit, reason: `Actual usage ${diff > 0 ? 'more' : 'less'} than expected — ${u.clientName || 'client'}`, actorId: actor.id || 'staff', actorName: actor.name || 'Staff', ref: { kind: 'appointment', id: visitId } } as any)); });
    const next = lines.map((l) => { if (actual[l.productId] === undefined) return l;
      const a = Math.max(0, Math.round(n(actual[l.productId]) * 1000) / 1000);
      // Once stock really moves for a line that couldn't be counted before, it's counted from here on.
      if (l.notCounted && movedIds.has(l.productId)) { const { notCounted: _gone, ...rest } = l; return { ...rest, actual: a, deducted: a }; }
      return { ...l, actual: a }; });
    tx.set(ref, { lines: next, updatedAt: now, adjustedBy: actor.name || null }, { merge: true });
    return { ok: true, changed: changes.length };
  });
}

export async function containerFinished(db: any, tenantId: string, productId: string, actor: { id?: string; name?: string } = {}) {
  const T = `tenants/${tenantId}`; const iref = db.doc(`${T}/inventory/${productId}`); const now = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(iref); if (!s.exists) throw new Error('That product no longer exists.');
    const it: any = s.data(); const pk = partialKey(it); const size = containerSize(it);
    if (!pk || size <= 0) throw new Error('This product isn’t tracked by the bottle — nothing to record.');
    const left = Math.max(0, n(it[pk]));   // what the system still expected to be in it
    const stock = n(it.totalStock);
    tx.set(iref, { [pk]: stock > 0 ? size : 0, totalStock: Math.max(0, stock - 1), openedAt: now }, { merge: true });
    const rec = { productId, name: it.name || 'Product', unit: unitOf(it), expectedYield: size, actualYield: Math.max(0, size - left), lost: left,
      lostPct: size ? Math.round((left / size) * 1000) / 10 : 0, openedAt: it.openedAt || null, closedAt: now, closedBy: actor.name || null, newOpened: stock > 0 };
    tx.set(db.collection(`${T}/openContainers`).doc(), rec);
    if (left > 0) tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId, type: 'spoiled', delta: -left, unit: rec.unit, reason: `Container finished early — ${left} ${rec.unit} unaccounted for (${rec.lostPct}%)`, actorId: actor.id || 'staff', actorName: actor.name || 'Staff' } as any));
    return { ok: true, ...rec };
  });
}

/** EXTRA PRODUCT beyond the recipe, priced by the business's rule (Settings → Fees & credit → Running over): retail
 *  (the container's price spread over its size / uses), cost, or never. Using less never credits anything; a different
 *  product only counts if more of it was used. Suggested at checkout — never charged on its own. */
export async function extraProductFor(db: any, tenantId: string, visitId: string, tenant: any) {
  const T = `tenants/${tenantId}`; const rule = String(tenant?.timingPolicy?.extraProduct || 'retail');
  if (rule === 'off') return { items: [], total: 0, rule };
  const u: any = (await db.doc(`${T}/usage/${visitId}`).get()).data(); const lines: UsageLine[] = u?.lines || []; const items: { name: string; extra: number; unit: string; price: number }[] = [];
  for (const l of lines) { const extra = Math.round((n(l.actual) - n(l.expected)) * 1000) / 1000; if (!(l.actual !== undefined && extra > 0)) continue;
    const it: any = (await db.doc(`${T}/inventory/${l.productId}`).get()).data() || {}; const size = perContainer(it);
    if (size === null) continue;   // no size or uses set: there's no telling what the extra is worth, so nothing is suggested
    const cost = unitCost(it) ?? 0;
    const perUnit = rule === 'cost' ? cost : n(it.msrp) > 0 ? n(it.msrp) / size : cost;
    const price = Math.round(extra * perUnit * 100) / 100; if (price > 0) items.push({ name: l.name || it.name || 'Product', extra, unit: l.unit || unitOf(it), price }); }
  return { items, total: Math.round(items.reduce((t, x) => t + x.price, 0) * 100) / 100, rule };
}
