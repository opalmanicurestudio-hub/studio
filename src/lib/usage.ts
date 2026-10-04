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

export interface UsageLine { productId: string; name: string; unit: string; expected: number; actual?: number; deducted?: number; shortfall?: number }
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const unitOf = (it: any) => (it?.costingMethod === 'uses' ? it.useUnit || 'uses' : it?.costingMethod === 'size' ? it.unit || 'ml' : it?.unit || 'units');
const containerSize = (it: any) => (it?.costingMethod === 'uses' ? n(it.estimatedUses) : it?.costingMethod === 'size' ? n(it.size) : 1);
const partialKey = (it: any) => (it?.costingMethod === 'uses' ? 'partialContainerUses' : it?.costingMethod === 'size' ? 'partialContainerSize' : null);

/** What a visit should have used: its service's products + each add-on's (quantities summed per product). */
export function expectedUsage(service: any, addOns: any[], inventory: any[]): UsageLine[] {
  const m = new Map<string, UsageLine>(); const inv = new Map((inventory || []).map((i: any) => [i.id, i]));
  for (const s of [service, ...(addOns || [])]) for (const p of (s?.products || [])) {
    const q = n(p?.quantityUsed); if (!p?.id || q <= 0) continue; const it: any = inv.get(p.id) || p;
    const cur = m.get(p.id) || { productId: p.id, name: String(it.name || p.name || 'Product'), unit: unitOf(it), expected: 0 };
    cur.expected = Math.round((cur.expected + q) * 1000) / 1000; m.set(p.id, cur);
  }
  return Array.from(m.values());
}

/** Take `qty` (in the product's own unit) off stock inside a transaction. Negative qty puts it back. */
function moveStock(it: any, qty: number) {
  const pk = partialKey(it); const size = containerSize(it);
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
      const it = s.data(); const r = moveStock(it, l.expected); tx.set(s.ref, r.patch, { merge: true });
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
    for (const l of lines) { if (actual[l.productId] === undefined) continue; const want = Math.max(0, Math.round(n(actual[l.productId]) * 1000) / 1000); const was = n(l.actual ?? l.expected); if (want !== was) changes.push({ l, diff: want - was }); }
    const snaps = await Promise.all(changes.map((c) => tx.get(db.doc(`${T}/inventory/${c.l.productId}`))));
    snaps.forEach((s: any, i: number) => { const { l, diff } = changes[i]; if (!s.exists) return; const r = moveStock(s.data(), diff); tx.set(s.ref, r.patch, { merge: true });
      tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: l.productId, type: 'used', delta: -diff, unit: l.unit, reason: `Actual usage ${diff > 0 ? 'more' : 'less'} than expected — ${u.clientName || 'client'}`, actorId: actor.id || 'staff', actorName: actor.name || 'Staff', ref: { kind: 'appointment', id: visitId } } as any)); });
    const next = lines.map((l) => (actual[l.productId] !== undefined ? { ...l, actual: Math.max(0, Math.round(n(actual[l.productId]) * 1000) / 1000) } : l));
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
    const it: any = (await db.doc(`${T}/inventory/${l.productId}`).get()).data() || {}; const size = containerSize(it) || 1;
    const perUnit = rule === 'cost' ? n(it.costPerUnit) / size : n(it.msrp) > 0 ? n(it.msrp) / size : n(it.costPerUnit) / size;
    const price = Math.round(extra * perUnit * 100) / 100; if (price > 0) items.push({ name: l.name || it.name || 'Product', extra, unit: l.unit || unitOf(it), price }); }
  return { items, total: Math.round(items.reduce((t, x) => t + x.price, 0) * 100) / 100, rule };
}
