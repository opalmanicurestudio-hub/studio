// src/lib/order-tips.ts — AN ONLINE ORDER'S TIP GOES TO THE PEOPLE WHO FULFILLED IT (server). When the order has gone
// out (shipped, or handed over at the counter), its tip is split evenly between everyone on the team who packed it and
// sent it (from the order's own record: who scanned items in, packed it, put it on the shelf, bought the label, shipped
// it, handed it over), and written as 'Tips' lines dated when it went out — one per person, named after the order and
// the person (otip_{orderId}_{staffId}), so it can never be written twice. From there the shop's tip policy shares
// them like any other tip (lib/tip-share: kept, tipped out, or pooled), and payroll pays them.
// Nobody on the team to credit (a digital order, or the record's sign-ins don't match a team member): one line with
// no one on it, which no policy shares, and a note on the order for the owner to give it out by hand.
// Called after an order goes out (/api/retail/order-tip) and by the five-minute job for anything missed.
import { staffIdForLogin } from '@/lib/owner-staff';

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const OUT = ['shipped', 'completed', 'handed_off'];
// What counts as fulfilling it: packing it, and sending it or handing it over.
const WORK = new Set(['item_scanned', 'pick_complete', 'packed', 'marked_ready', 'label_generated', 'shipped', 'handoff_scanned', 'completed', 'override']);
const NOT_PEOPLE = new Set(['', 'system', 'staff', 'customer', 'shippo', 'stripe', 'automation']);

export const tipLineId = (orderId: string, staffId: string) => `otip_${orderId}_${String(staffId).replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 1400);

/** Even shares of `cents` for `n` people, to the cent; the first shares take any remainder. */
export function evenShares(cents: number, n: number): number[] {
  const t = c0(cents); if (n <= 0 || !t) return [];
  const base = Math.floor(t / n); let rest = t - base * n;
  return Array.from({ length: n }, () => base + (rest-- > 0 ? 1 : 0));
}

export type TipShareResult = 'shared' | 'unassigned' | 'no_tip' | 'not_yet' | 'already' | 'missing' | 'booked_at_payment';

export async function shareOrderTip(db: any, tenantId: string, orderId: string): Promise<TipShareResult> {
  const T = `tenants/${tenantId}`; const oRef = db.doc(`${T}/retailOrders/${orderId}`);
  const snap = await oRef.get(); if (!snap.exists) return 'missing';
  const o: any = snap.data() || {};
  // What's left of the tip: any of it given back with a refund isn't the team's.
  const tip = Math.max(0, c0(o.tipCents) - c0(o.refundedTipCents));
  if (o.tipSharedAt) return 'already';
  if (!tip || o.isTest) return 'no_tip';
  // An order paid before orders were paid in one step (no booksAt) had its tip booked when it was paid.
  if (!o.booksAt) return 'booked_at_payment';
  if (!OUT.includes(String(o.stage || ''))) return 'not_yet';

  // Who did the work, in the order they first touched it.
  const evs = (await oRef.collection('events').orderBy('at', 'asc').limit(400).get().catch(() => ({ docs: [] as any[] }))).docs.map((d: any) => d.data() || {});
  const logins: string[] = [];
  for (const e of evs) { const id = String(e.actorId || ''); if (WORK.has(String(e.type || '')) && !NOT_PEOPLE.has(id) && !logins.includes(id)) logins.push(id); }
  const staffIds: string[] = []; const names: Record<string, string> = {};
  for (const uid of logins) {
    const sid = await staffIdForLogin(db, tenantId, uid).catch(() => null);
    if (!sid || staffIds.includes(sid)) continue;
    const m: any = (await db.doc(`${T}/staff/${sid}`).get()).data() || {};
    // Renters keep their own takings; a shop order's tip isn't theirs.
    if (m.role === 'renter' || m.isRenter === true) continue;
    staffIds.push(sid); names[sid] = String(m.name || 'Team member');
  }

  const at = String(o.completedAt || o.shippedAt || o.handedOffAt || new Date().toISOString());
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const base = {
    date: at, type: 'income', context: 'Business', category: 'Tips', taxBucket: 'gratuity', hasReceipt: false,
    clientOrVendor: o.customerName || 'Guest', clientId: o.clientId || null, retailOrderId: orderId, channel: 'online',
    paymentMethod: 'Online Checkout', tenantId,
  };
  const linesFor = (tipNow: number) => {
    const shares = evenShares(tipNow, staffIds.length);
    return staffIds.length
      ? staffIds.map((sid, i) => ({ id: tipLineId(orderId, sid), data: { ...base, id: tipLineId(orderId, sid), staffId: sid, amount: shares[i] / 100,
          description: `Tip — Order ${num}${staffIds.length > 1 ? ` (shared between ${staffIds.length})` : ''}` } }))
      : [{ id: tipLineId(orderId, 'unassigned'), data: { ...base, id: tipLineId(orderId, 'unassigned'), staffId: null, amount: tipNow / 100, description: `Tip — Order ${num} (no one on the team to credit)` } }];
  };

  const now = new Date().toISOString();
  // Worked out again from the order as it is inside the step: a refund that gave some of the tip back a moment ago
  // (or cancelled the order) is seen, and only what's left is shared.
  const done = await db.runTransaction(async (tx: any): Promise<'done' | 'already' | 'no_tip' | 'not_yet'> => {
    const cur: any = (await tx.get(oRef)).data() || {};
    if (cur.tipSharedAt) return 'already';
    const tipNow = Math.max(0, c0(cur.tipCents) - c0(cur.refundedTipCents));
    if (!tipNow || cur.isTest) return 'no_tip';
    if (!OUT.includes(String(cur.stage || ''))) return 'not_yet';
    for (const l of linesFor(tipNow)) tx.set(db.doc(`${T}/transactions/${l.id}`), l.data);
    tx.update(oRef, { tipSharedAt: now, tipSharedWith: staffIds, ...(staffIds.length ? {} : { tipUnassigned: true }) });
    const ev = oRef.collection('events').doc(`tip-shared`);
    tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: 'system', actorName: 'Tips',
      meta: { kind: 'tip_shared', text: staffIds.length
        ? `The ${`$${(tipNow / 100).toFixed(2)}`} tip went to ${staffIds.map((s) => names[s].split(' ')[0]).join(' and ')}, who ${staffIds.length > 1 ? 'packed and sent it' : 'fulfilled it'}. The shop’s tip policy shares it from there.`
        : `The ${`$${(tipNow / 100).toFixed(2)}`} tip couldn’t be matched to anyone on the team, so it’s in the books without a name. Give it out by hand in Money.` } });
    return 'done';
  });
  if (done !== 'done') return done;
  return staffIds.length ? 'shared' : 'unassigned';
}
