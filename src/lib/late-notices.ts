// src/lib/late-notices.ts — AN ORDER THAT MISSES ITS SHIP-BY DAY TELLS THE CUSTOMER BY ITSELF. Checked every hour: a
// shipped order whose customer was told a ship-by day (at checkout, or by an earlier notice), still not labeled an
// hour after that day's last pickup (or the end of the shop's shipping day when it drops boxes off itself), gets a
// running-late notice with the next ship day and their right to cancel for a full refund (lib/delay-notice). Before
// the day is out, so they hear it while the date still stands.
//
//   · Once per new date, and at most twice by itself. A third miss, or a miss on an order held for review, goes under
//     Needs you for someone to decide what to tell the customer.
//   · Not for pre-orders (their runs move their own dates), orders waiting on stock the customer chose to wait for, or
//     a box already labeled (it's on its way out; an unscanned label is the morning check's job).
//   · A date someone already moved by hand counts: the check works from the order's current ship-by day.
//   · Only orders marked to be watched (lateWatch, set when a customer is told a date) are read, a page at a time, and
//     an order that has moved on is unmarked as it is passed (one still being paid for is left alone), so the list
//     stays the size of what is still open.
import { sendDelayNotice } from './delay-notice';
import { LATE_GRACE_MS, MAX_AUTO_NOTICES, missedAt, promiseCarrier, promisedDay, revisedShipBy, scheduleFrom, waitingPreorder, type ShipSchedule } from './ship-promise';
import { tenantTimeZone } from './tenant-time';

export { LATE_GRACE_MS, MAX_AUTO_NOTICES };
const OPEN = ['paid', 'picking', 'packed'];
const PAGE = 300;

export type LateCall =
  | { act: 'notify'; missed: string; revised: string }
  | { act: 'staff'; missed: string; why: 'held' | 'again' }
  | { act: 'none' };

const NONE: LateCall = { act: 'none' };


/** Whether the order is one to watch: shipped, open, and its customer has been told a ship-by day. A pre-order stays
 *  watched while it waits (nothing is said while a pre-order line is waiting), so once that line is refunded or split
 *  off, the rest of the order is checked like any other. */
export function watchable(o: any): boolean {
  return !!o && o.method === 'ship' && o.digitalOnly !== true && OPEN.includes(String(o.stage)) && !!o.promise
    && (o.promise.shown === true || !!o.notifiedForPromiseAt);
}

/** What to do about one order right now. Pure. */
export function lateCall(o: any, now: Date, tz: string, schedule: ShipSchedule): LateCall {
  if (!watchable(o)) return NONE;
  if (waitingPreorder(o)) return NONE;
  if (o.holdUntilRestock === true) return NONE;
  if (o.trackingNumber || o.shippoTransactionId || o.labelFromOrderId || o.shippedWithOrderId) return NONE;
  const p = o.promise;
  const missed = promisedDay(o, tz);
  if (!missed) return NONE;
  const carrier = promiseCarrier(o);
  // Missed at the day's last pickup (or the end of the shop's shipping day), and never before the team's own deadline
  // for the date they were first given (an order taken late in the day is due by its own time, not one already gone).
  const due = Math.max(Date.parse(missedAt(missed, tz, schedule, carrier)), missed === p.shipBy ? Date.parse(String(p.shipByAt || '')) || 0 : 0);
  if (now.getTime() < due + LATE_GRACE_MS) return NONE;
  if (o.lateNeedsStaff?.open === true && o.lateNeedsStaff?.missed === missed) return NONE;
  if (o.holdForReview === true) return { act: 'staff', missed, why: 'held' };
  if ((Number(o.autoDelayNotices) || 0) >= MAX_AUTO_NOTICES) return { act: 'staff', missed, why: 'again' };
  return { act: 'notify', missed, revised: revisedShipBy(missed, now, tz, schedule, carrier) };
}

export type LateSweep = { checked: number; notified: number; handed: number; cutOff: boolean };

/** One shop's watched orders, checked against their ship-by days. */
export async function sweepLateOrders(
  db: any, tenantId: string, tenant: any, opts: { now?: Date; deadline?: number; origin?: string } = {},
): Promise<LateSweep> {
  const out: LateSweep = { checked: 0, notified: 0, handed: 0, cutOff: false };
  const schedule = scheduleFrom(tenant?.retailSettings);
  // A shop that never saved a schedule never told anyone a date.
  if (!schedule.savedAt) return out;
  const tz = tenantTimeZone(tenant);
  const now = opts.now || new Date();
  const col = db.collection(`tenants/${tenantId}/retailOrders`);
  let after: any = null;
  for (;;) {
    let q = col.where('lateWatch', '==', true).orderBy('__name__').limit(PAGE);
    if (after) q = q.startAfter(after);
    const snap = await q.get();
    for (const d of snap.docs) {
      if (opts.deadline && Date.now() > opts.deadline) { out.cutOff = true; return out; }
      const o = d.data() || {};
      // Still on the payment page: left as it is until it's paid.
      if (o.stage === 'placed') continue;
      // Shipped, cancelled, or never one to watch: unmarked, so it isn't read again.
      if (!watchable(o)) { await d.ref.set({ lateWatch: false }, { merge: true }).catch(() => {}); continue; }
      out.checked++;
      const call = lateCall(o, now, tz, schedule);
      if (call.act === 'notify') {
        try {
          const r = await sendDelayNotice(db, {
            tenantId, orderId: d.id, revisedDate: call.revised, auto: true, tenant, now, origin: opts.origin,
            actor: { id: 'system', name: 'Shipping schedule' },
            expect: { shipPromiseAt: o.shipPromiseAt || null, autoNotices: Number(o.autoDelayNotices) || 0 },
          });
          if (r.sent) out.notified++;
        } catch (e: any) { console.error('[late-notices]', tenantId, d.id, String(e?.message || e).slice(0, 200)); }
      } else if (call.act === 'staff') {
        try {
          // Checked again inside the transaction: a new date sent in the meantime means there's nothing to hand over.
          const handed = await db.runTransaction(async (txn: any) => {
            const fresh = await txn.get(d.ref);
            const f = fresh.exists ? fresh.data() : null;
            const again = f ? lateCall(f, now, tz, schedule) : NONE;
            if (again.act !== 'staff' || again.missed !== call.missed) return false;
            txn.update(d.ref, { lateNeedsStaff: { open: true, missed: call.missed, why: call.why, at: now.toISOString() } });
            const ev = d.ref.collection('events').doc(`late-staff-${call.missed}`);
            txn.set(ev, {
              id: ev.id, type: 'note', at: now.toISOString(), actorId: 'system', actorName: 'Shipping schedule',
              meta: { kind: 'late_needs_staff', text: call.why === 'held' ? 'Missed its ship-by day while held for review. Under Needs you to decide what to tell the customer.' : 'Missed its new ship-by day again. Under Needs you to decide what to tell the customer.' },
            }, { merge: true });
            return true;
          });
          if (handed) out.handed++;
        } catch (e: any) { console.error('[late-notices] hand over', tenantId, d.id, String(e?.message || e).slice(0, 200)); }
      }
    }
    if (snap.docs.length < PAGE) break;
    after = snap.docs[snap.docs.length - 1];
  }
  return out;
}
