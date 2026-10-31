// src/lib/retail-nightly.ts — EVERY NIGHTLY CHECK FOR ONE SHOP (api/cron/retail-nightly runs it for each in turn). One
// check failing never stops the others; each is marker-guarded, so running it twice sends nothing twice. Server only.
import { reconcileReservations, sweepStaleCurbside } from '@/lib/stock-reconcile';
import { alertExpiringStock } from '@/lib/expiry-alerts';
import { syncRenterCreditsForOrder } from '@/lib/renter-sales-server';
import { restoreNonCardPayment } from '@/lib/cancel-restore';
import { roomCents } from '@/lib/non-card-back';
import { closeStaleReturns, countEarlierHolds } from '@/lib/return-close';
import { sweepRecoveryDeadlines, sweepStalledShipments, sweepStaleCases } from '@/lib/retail-sweeps';
import { ensureCodeIndex } from './code-index';

const err = (e: any) => ({ error: String(e?.message || e).slice(0, 200) });

/** Every nightly check for one shop. One failing never stops the others. */
export async function retailNightlyForShop(db: any, tenantId: string, tenant: any): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  // Every variant points at its listing (variants saved before that are pointed the first night), so none is sold on
  // its own anywhere. Only builds when the index is older than the current rules (lib/code-index).
  try { await ensureCodeIndex(db, tenantId); } catch (e) { out.codeIndex = err(e); }
  try { const r = await reconcileReservations(db, tenantId); if (r.corrected > 0) out.stock = r; } catch (e) { out.stock = err(e); }
  try {
    const ro = await db.collection(`tenants/${tenantId}/retailOrders`).where('hasRenterItems', '==', true).limit(500).get();
    let ch = 0; for (const d of ro.docs) ch += await syncRenterCreditsForOrder(db, tenantId, d.id, 'Nightly check');
    if (ch) out.renterCredits = { changed: ch };
  } catch (e) { out.renterCredits = err(e); }
  // Cancelled orders that used a gift card or store credit: make sure it went back (once each). Read by when they were
  // cancelled (the last 30 days), so checkouts left unpaid can't crowd out real ones.
  try {
    const since = new Date(Date.now() - 30 * 86400e3).toISOString();
    const co = await db.collection(`tenants/${tenantId}/retailOrders`).where('cancelledAt', '>=', since).limit(500).get();
    let n = 0; let waiting = 0;
    for (const d of co.docs) {
      const o: any = d.data() || {};
      if (o.stage !== 'cancelled' || o.nonCardRestoredAt || roomCents(o) <= 0) continue;
      // One that can't be checked tonight (Stripe didn't answer) is tried again tomorrow, without holding up the rest.
      try { const r = await restoreNonCardPayment(db, tenantId, d.id, 'Nightly check'); if (r.giftCents + r.creditCents > 0) n++; } catch { waiting++; }
    }
    if (n || waiting) out.nonCardRestored = { orders: n, ...(waiting ? { waiting } : {}) };
  } catch (e) { out.nonCardRestored = err(e); }
  // Downloads whose access ends within the week: one reminder per end date (lib/digital-notices-server).
  try { const { sweepEndingNotices } = await import('@/lib/digital-notices-server'); const en = await sweepEndingNotices(db, tenantId, tenant); if (en.sent > 0 || !en.done) out.accessEnding = { emailed: en.sent, ...(en.done ? {} : { carriesOn: true }) }; } catch (e) { out.accessEnding = err(e); }
  try { const cr = await closeStaleReturns(db, tenantId, tenant); if (cr > 0) out.returnsClosed = { closed: cr }; } catch (e) { out.returnsClosed = err(e); }
  // Once: items held to check on the old Return desk wait in Problems like the rest (lib/return-close).
  try { const h = await countEarlierHolds(db, tenantId); if (h > 0) out.holdsCounted = { returns: h }; } catch (e) { out.holdsCounted = err(e); }
  try { const ex = await alertExpiringStock(db, tenantId); if (ex > 0) out.expiry = { alerts: ex }; } catch (e) { out.expiry = err(e); }
  try { const st = await sweepStaleCurbside(db, tenantId); if (st.flagged > 0) out.curbside = st; } catch (e) { out.curbside = err(e); }
  try {
    const [stall, deadlines, cases] = await Promise.all([sweepStalledShipments(db, tenantId), sweepRecoveryDeadlines(db, tenantId), sweepStaleCases(db, tenantId)]);
    if (stall.actioned || deadlines.actioned || cases.actioned) out.sweeps = { stall, deadlines, cases };
  } catch (e) { out.sweeps = err(e); }
  return out;
}

