// src/lib/kiosk-charges.ts — A CONCIERGE ORDER CHARGED TO A SAVED CARD, RECORDED ONCE (server).
// The concierge kiosk (api/booths/kiosk, action 'charge') charges an order from the menu to a saved card on the
// platform's own Stripe account: the station renter's card, or a checked-in day guest's own. Each order is claimed first
// (tenants/{t}/private/kiosk/stationCharges/{order}: 'charging', with the amount and card it's for), charged under one
// key named after the order, its amount and card, and recorded here, once: its line in the books and its Stripe fee are
// named after the order, and written in the same step that marks the claim 'charged'. Stripe saying no lets the claim go
// ('failed'): nothing is recorded, and the order can be tried again.
//
// When Stripe's answer is lost, the screen says to try again in a couple of minutes, which sends the same charge under
// the same key. If nobody does, the claim would stay open, with the money maybe taken and never recorded.
// settleLostKioskCharges, run by the five-minute check, settles every claim left open more than 15 minutes. It takes the
// claim over in one step (two runs at once settle it once), asks Stripe for the payment made for that order (each one
// carries the order's id, and is for the claim's amount), and then:
//   - it went through: recorded as the kiosk records it, and the front desk is told, because the screen never heard back
//     and so never sent the order to be made;
//   - Stripe said no, or the charge never reached Stripe: let go, as a decline is (nothing recorded, nothing owed);
//   - still going through: left for the next run.
// A payment still waiting for someone to approve it is canceled at Stripe first, so it can't go through later. Asked
// again after it's recorded, the kiosk answers that it's done, and never charges it twice.
import Stripe from 'stripe';

export const kioskChargesPath = (tenantId: string) => `tenants/${tenantId}/private/kiosk/stationCharges`;
export type KioskPayer = { kind: 'station' | 'stay'; id: string; name: string; boothName: string };
type Note = { id: string; message: string; link: string };
type Result = 'recorded' | 'released' | 'waiting';

const OPEN_AFTER_MS = 15 * 60000;   // a claim still open this long has lost its answer
const TAKEN_MS = 5 * 60000;         // one run's hold on a claim it's settling
const DAY_S = 86400;
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: any) => Date.parse(String(v || '')) || 0;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const stripeFor = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }) as any;
const claimTime = (c: any) => ms(c?.claimAt) || ms(c?.createdAt);
const noteDoc = (id: string, n: Note) => ({ id, type: 'booth_reservation', read: false, createdAt: new Date().toISOString(), link: n.link, message: n.message });

/** Stripe's fee and the charge's id: from the payment as it came back, else asked for. Fail-open: no fee line. */
async function feeOf(stripe: any, intent: any): Promise<{ feeCents: number; chargeId: string | null }> {
  const lc: any = intent?.latest_charge;
  let feeCents = Number(lc?.balance_transaction?.fee) || 0;
  let chargeId: string | null = typeof lc === 'string' ? lc : (lc?.id || null);
  if (!feeCents && intent?.id && (stripe || process.env.STRIPE_SECRET_KEY)) {
    try {
      const pi: any = await (stripe || stripeFor()).paymentIntents.retrieve(intent.id, { expand: ['latest_charge.balance_transaction'] });
      const c: any = pi?.latest_charge;
      feeCents = Number(c?.balance_transaction?.fee) || 0;
      chargeId = chargeId || c?.id || null;
    } catch { /* no fee line */ }
  }
  return { feeCents, chargeId };
}

/** The order charged: its line in the books, its Stripe fee and the claim marked 'charged', once. False when it was
 *  recorded already. `extra` is written on the claim with it, and `note` (named after what it's about) beside it. */
export async function recordKioskCharge(db: any, tenantId: string, orderId: string, intent: any, cents: number, payer: KioskPayer, what: string,
  o: { stripe?: any; at?: string; extra?: Record<string, any>; note?: Note } = {}): Promise<boolean> {
  const claimRef = db.doc(`${kioskChargesPath(tenantId)}/${orderId}`);
  const { feeCents, chargeId } = await feeOf(o.stripe, intent);
  const txnRef = db.doc(`tenants/${tenantId}/transactions/concierge_${orderId}`);
  const feeRef = db.doc(`tenants/${tenantId}/transactions/conciergefee_${orderId}`);
  const noteRef = o.note ? db.doc(`tenants/${tenantId}/notifications/${o.note.id}`) : null;
  const at = o.at || new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(claimRef)).data() || {};
    if (c.status === 'charged') return false;
    tx.set(txnRef, {
      id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
      amount: cents / 100, category: 'Hospitality Revenue',
      description: `${c.description || what} — charged to ${payer.boothName}${payer.kind === 'station' ? ` (${payer.name})` : ''}`,
      clientOrVendor: payer.name, date: at, paymentMethod: 'Card on file (Stripe)',
      hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId, sourceId: payer.id,
      ...(payer.kind === 'station' ? { renterId: payer.id } : {}), conciergeOrderId: orderId, tenantId, createdAt: at,
    });
    if (feeCents > 0) tx.set(feeRef, {
      id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
      amount: feeCents / 100, category: 'Processing Fees',
      description: `Stripe fee — concierge charge — ${payer.boothName} (${payer.name})`,
      clientOrVendor: 'Stripe', date: at, paymentMethod: 'Deducted from payout',
      hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
      sourceId: payer.id, ...(payer.kind === 'station' ? { renterId: payer.id } : {}), relatedTxnId: txnRef.id, tenantId, createdAt: at,
    });
    tx.set(claimRef, { status: 'charged', chargedAt: at, paymentIntentId: intent.id, claimAt: null, ...(o.extra || {}) }, { merge: true });
    if (noteRef && o.note) tx.set(noteRef, noteDoc(noteRef.id, o.note));
    return true;
  });
}

/** Nothing moved: the claim is let go ('failed'), so the order can be tried again, and nothing is recorded. Only while
 *  it's still open (and, with `still`, still as the caller left it). False when it wasn't. */
export async function releaseKioskCharge(db: any, tenantId: string, orderId: string, error: string,
  o: { at?: string; still?: (c: any) => boolean; extra?: Record<string, any> } = {}): Promise<boolean> {
  const claimRef = db.doc(`${kioskChargesPath(tenantId)}/${orderId}`);
  const at = o.at || new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(claimRef)).data() || null;
    if (!c || c.status !== 'charging' || (o.still && !o.still(c))) return false;
    tx.set(claimRef, { status: 'failed', claimAt: null, failedAt: at, error: String(error || '').slice(0, 200), ...(o.extra || {}) }, { merge: true });
    return true;
  });
}

// ── The five-minute check ────────────────────────────────────────────────────

/** Every payment on this customer since `since` (seconds), on the platform's account. Null when Stripe can't be asked
 *  right now (or there are too many to look through), so nothing is decided on half an answer. */
async function paymentsSince(stripe: any, customer: string, since: number): Promise<any[] | null> {
  const found: any[] = [];
  try {
    for (let page = 0, after = ''; page < 10; page++) {
      const l: any = await stripe.paymentIntents.list({ customer, created: { gte: since }, limit: 100, ...(after ? { starting_after: after } : {}) });
      const data: any[] = Array.isArray(l?.data) ? l.data : [];
      found.push(...data);
      if (!l?.has_more || !data.length) return found;
      after = String(data[data.length - 1]?.id || '');
    }
  } catch { /* asked again on the next run */ }
  return null;
}

/** What became of the payments made for a claim: one that went through counts first, then one still going through, then
 *  one waiting for approval. Otherwise Stripe said no to each, or there were none. */
function outcomeOf(payments: any[]): { state: 'paid' | 'pending' | 'open' | 'declined' | 'none'; pi: any; open: any[] } {
  const st = (p: any) => String(p?.status || '');
  const paid = payments.find((p) => st(p) === 'succeeded');
  if (paid) return { state: 'paid', pi: paid, open: [] };
  if (payments.some((p) => st(p) === 'processing')) return { state: 'pending', pi: null, open: [] };
  const open = payments.filter((p) => ['requires_action', 'requires_confirmation', 'requires_capture'].includes(st(p)));
  if (open.length) return { state: 'open', pi: open[0], open };
  const no = payments.find((p) => ['requires_payment_method', 'canceled'].includes(st(p)));
  return { state: no ? 'declined' : 'none', pi: no || null, open: [] };
}

/** Payments still waiting for approval are canceled, so none can go through after the claim is let go. False when one
 *  wasn't (it may have moved on): the next run looks again. */
async function cancelOpen(stripe: any, open: any[]): Promise<boolean> {
  try {
    for (const p of open) {
      const c: any = await stripe.paymentIntents.cancel(String(p.id), {}, { idempotencyKey: `cancel_${p.id}` });
      if (String(c?.status || '') !== 'canceled') return false;
    }
    return true;
  } catch { return false; }
}

/** Take an open claim over in one step, so two runs of the check at once settle it once. */
async function takeOver(db: any, ref: any, isOpen: (c: any) => boolean, now: number): Promise<any | null> {
  return db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(ref)).data() || null;
    if (!c || !isOpen(c) || (c.settlingAt && now - ms(c.settlingAt) < TAKEN_MS)) return null;
    tx.set(ref, { settlingAt: iso(now) }, { merge: true });
    return c;
  }).catch(() => null);
}

/** Who the order was charged to, as the kiosk named them (a claim made before it kept the name looks it up). */
async function payerOf(db: any, tenantId: string, c: any): Promise<KioskPayer> {
  const kind: 'station' | 'stay' = c.payerKind === 'stay' ? 'stay' : 'station';
  const id = String(c.payerId || '');
  let name = String(c.payerName || '').trim();
  if (!name && /^[A-Za-z0-9_-]{1,120}$/.test(id)) {
    try {
      const d: any = (await db.doc(`tenants/${tenantId}/${kind === 'stay' ? 'boothReservations' : 'renters'}/${id}`).get()).data() || {};
      name = kind === 'stay' ? String(d.name || '').trim() : `${d.firstName || ''} ${d.lastName || ''}`.trim();
    } catch { /* the default below */ }
  }
  return { kind, id, name: name || (kind === 'stay' ? 'Guest' : 'Renter'), boothName: String(c.boothName || (kind === 'stay' ? 'your station' : 'their station')) };
}

async function settleOne(db: any, tenantId: string, ref: any, c: any, stripe: any, now: number): Promise<Result> {
  const orderId = String(ref.id);
  const cents = Math.round(Number(c.amountCents) || 0);
  if (!c.customer) return 'waiting';
  const list = await paymentsSince(stripe, String(c.customer), Math.floor(claimTime(c) / 1000) - DAY_S);
  if (!list) return 'waiting';
  const found = outcomeOf(list.filter((p: any) => String(p?.metadata?.orderId || '') === orderId && Math.round(Number(p?.amount) || 0) === cents));
  if (found.state === 'pending') return 'waiting';
  const settled = { settlingAt: null, settledAt: iso(now), settledBy: 'check' };

  if (found.state === 'paid') {
    const payer = await payerOf(db, tenantId, c);
    const what = String(c.description || 'Concierge order');
    const at = Number(found.pi.created) > 0 ? iso(Number(found.pi.created) * 1000) : iso(now);
    const wrote = await recordKioskCharge(db, tenantId, orderId, found.pi, cents, payer, what, { stripe, at, extra: settled, note: {
      id: `concierge_${orderId}`, link: '/money',
      message: `A ${money(cents)} concierge charge for ${what.replace(/^Concierge:\s*/i, '')} to ${payer.boothName} (${payer.name}) went through, but the kiosk never heard back, so the order may never have been sent. It’s recorded in Money. Check with the station, and refund it from Money if the order wasn’t served.`,
    } });
    if (!wrote) await ref.set({ settlingAt: null }, { merge: true }).catch(() => {});
    return 'recorded';
  }

  // Nothing went through: let go, as a decline is. Only if nobody asked again meanwhile (then that request finishes it).
  if (found.state === 'open' && !(await cancelOpen(stripe, found.open))) return 'waiting';
  const why = found.state === 'none' ? 'It never reached Stripe.'
    : found.state === 'open' ? 'It needed approval that never came.'
    : found.pi?.status === 'canceled' ? 'The payment was stopped before it went through.'
    : String(found.pi?.last_payment_error?.message || 'The card was declined.');
  const same = (x: any) => x.settlingAt === iso(now) && String(x.claimAt || '') === String(c.claimAt || '');
  return (await releaseKioskCharge(db, tenantId, orderId, why, { at: iso(now), still: same, extra: settled })) ? 'released' : 'waiting';
}

/** The five-minute check for the concierge kiosk's charges (see the top of this file). */
export async function settleLostKioskCharges(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; recorded: number; released: number; waiting: number }> {
  const out = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const now = o.now ?? Date.now();
  const lost = (c: any) => c?.status === 'charging' && now - claimTime(c) >= OPEN_AFTER_MS;
  const snap = await db.collection(kioskChargesPath(tenantId)).where('status', '==', 'charging').limit(100).get().catch(() => ({ docs: [] as any[] }));
  let stripe = o.stripe;
  for (const d of snap.docs) {
    if (!lost(d.data() || {})) continue;
    const c = await takeOver(db, d.ref, lost, now);
    if (!c) continue;
    out.checked++;
    let r: Result = 'waiting';
    try { stripe = stripe || stripeFor(); r = await settleOne(db, tenantId, d.ref, c, stripe, now); }
    catch (e: any) { console.error('[kiosk-charges]', tenantId, d.id, String(e?.message || e).slice(0, 160)); }
    if (r === 'waiting') await d.ref.set({ settlingAt: null }, { merge: true }).catch(() => {});
    out[r]++;
  }
  return out;
}
