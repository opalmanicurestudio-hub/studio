// src/lib/delivery-retry-server.ts — THE CUSTOMER'S CHOICE AFTER A DELIVERY COULDN'T BE MADE, CARRIED OUT (server; the
// rules are lib/delivery-retry). Read by api/retail/delivery-choice (the order page), the payments notice
// (connect-webhook), the five-minute check (cron/retail-payments) and a cancellation (api/retail/self-serve).
//   · Another try in an open window. Free: the order goes in it at once, if the window still has room. With a fee: the
//     place in the window is held while they pay on Stripe's own page (cards only, on the shop's account), and the try
//     goes on when the payment is confirmed: their return to the page, Stripe's notice or the five-minute check,
//     whichever comes first; each is safe to repeat. A page they leave or let lapse gives the place back.
//   · Pick it up at the shop: it becomes a pickup order with their pickup code. When it failed on the shop's side, the
//     delivery fee for that try goes back (the order's own through its refund, with no tax; a second try's own payment
//     straight back to its card).
// Every second-try payment is written on the order once (deliveryRetryPaid, server-only) with what happened to it, so
// money never goes missing: a page paid after another replaced it, or after the order was canceled, set for pickup or
// sent out again by the shop, is refunded; a refund that failed is tried again by the five-minute check, and the team
// hears if it can't be. What they paid is delivery income, and each refund is written against it.
import Stripe from 'stripe';
import { deliveryFrom, deliveryWindows, driverLookup } from '@/lib/delivery-plan';
import { bookedDelivery } from '@/lib/delivery-server';
import { holdsPlace, shiftsFor } from '@/lib/pickup-slots-server';
import { planFrom, windowLabelOn, type ShiftSpan } from '@/lib/pickup-slots';
import { hasTimeZone, tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { refundAmount } from '@/lib/stripe-refund';
import { canChoose, feeBack, feeForNext, keptPaidKeys, retryCents, retryPayOpen, whenInSentence } from '@/lib/delivery-retry';

export type RetryWindow = { key: string; start: string; end: string; label: string; labelOn: string; left: number | null; cap: number | null };
export type RetryResult = { ok: boolean; result: 'applied' | 'refunded' | 'refund_failed' | 'pending' | 'expired' | 'cancelled' | 'not_found'; message: string };
export type RetryRefundWhy = 'cancelled' | 'pickup' | 'gone_out' | 'replaced' | 'late';

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(c0(c) / 100).toFixed(2)}`;
const num = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;
const accountOf = (t: any) => t?.stripeAccountId || t?.stripeConnectAccountId || null;
const stripeNow = () => (process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any }) : null);
const randId = () => `dr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const sidKey = (sid: string) => String(sid || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 120);
const REFUND_TRIES = 12;   // about an hour of tries by the five-minute check, then the team refunds it by hand
const LOAD_MINUTES = 15;   // it's packed already: long enough to get it in the van
const PAY_MINUTES = 35;    // a paid try also leaves time for the payment page (it lasts 31 minutes) before the window
const refOf = (db: any, tenantId: string, orderId: string) => db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
const firstName = (o: any) => String(o?.customerName || '').trim().split(/\s+/)[0] || 'The customer';

/** The windows another try can go in: the shop's own over the days it offers, from now (no prep time, only time to load
 *  the van, and for a paid try time to pay), with room left. */
export async function retryWindows(db: any, tenantId: string, tenant: any, now = Date.now(), o: { paid?: boolean } = {}): Promise<{ ok: true; windows: RetryWindow[] } | { ok: false; message: string }> {
  const rs = tenant?.retailSettings || {};
  const plan = deliveryFrom(rs);
  if (!plan.on || !hasTimeZone(tenant) || !plan.slots.length || !plan.days.length) return { ok: false, message: 'The shop isn’t taking deliveries right now, so another try can’t be booked here.' };
  const shop = planFrom(rs); const tz = tenantTimeZone(tenant);
  const today = todayIn(tz, new Date(now));
  const days = Array.from({ length: plan.daysAhead }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10));
  const [booked, spans] = await Promise.all([
    bookedDelivery(db, tenantId, days[0], days[days.length - 1], now),
    plan.drivers.length ? shiftsFor(db, tenantId, days) : Promise.resolve([] as ShiftSpan[]),
  ]);
  const lookup = plan.perDriver !== null && plan.drivers.length ? driverLookup(spans, plan.drivers, tz) : undefined;
  const all = deliveryWindows(plan, { ...shop, prepMinutes: LOAD_MINUTES + (o.paid ? PAY_MINUTES : 0) }, now, tz, booked, lookup);
  return { ok: true, windows: all.filter((w) => !w.full).slice(0, 6).map((w) => ({
    key: w.key, start: w.start, end: w.end, label: w.label, labelOn: windowLabelOn(Date.parse(w.start), Date.parse(w.end), tz),
    left: w.left, cap: w.left === null ? null : w.left + (booked[w.key] || 0) })) };
}

/** Room in the window, counted in the same step as the write (this order never counts against itself). */
async function hasRoom(tx: any, db: any, tenantId: string, orderId: string, w: { key: string; cap: number | null }): Promise<boolean> {
  if (w.cap === null) return true;
  const q = await tx.get(db.collection(`tenants/${tenantId}/retailOrders`).where('deliveryWindowKey', '==', w.key));
  return q.docs.filter((x: any) => x.id !== orderId && holdsPlace(x.data(), Date.now())).length < w.cap;
}

/** The order in its new window, waiting to go out again; the try that failed kept as the last one. */
function bookedFields(cur: any, w: { key: string; start: string; end: string; labelOn: string }, paid: { cents: number; from: string } | null, now: string): Record<string, any> {
  const d = cur.delivery || {};
  return {
    'delivery.status': 'waiting',
    'delivery.window': { key: w.key, start: w.start, end: w.end, label: w.labelOn },
    'delivery.asap': null, 'delivery.readyBy': w.start,
    'delivery.lastFail': { code: d.failCode || null, cause: d.failCause || null, reason: String(d.failReason || ''), at: d.failedAt || null, try: Math.max(1, Math.floor(Number(d.tries) || 1)) },
    'delivery.failCode': null, 'delivery.failCause': null, 'delivery.failReason': null, 'delivery.failedAt': null,
    'delivery.doorAt': null, 'delivery.doorCode': null, 'delivery.skippedAt': null,
    'delivery.retry': { at: now, by: 'customer', key: w.key, label: w.labelOn, cents: paid?.cents || 0 },
    'delivery.feeFor': feeForNext(cur, paid),
    deliveryWindowKey: w.key, deliveryAsapAt: null,
  };
}

function choiceEvent(tx: any, ref: any, cur: any, text: string, kind: string, now: string) {
  const ev = ref.collection('events').doc();
  tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: 'customer', actorName: cur.customerName || 'Customer', meta: { kind, text } });
}

/** The team hears what the customer chose (the order's bell in the back office). */
async function tellTeam(db: any, tenantId: string, orderId: string, order: any, message: string) {
  const n = db.collection(`tenants/${tenantId}/notifications`).doc();
  await n.set({ id: n.id, type: 'delivery_choice', read: false, createdAt: new Date().toISOString(), link: `/retail-orders?order=${orderId}`, message }).catch(() => {});
}

/**
 * Another try in window `key`. Free: booked now. With a fee: a Stripe page, with the place held while they pay.
 */
export async function chooseRetry(db: any, tenantId: string, tenant: any, orderId: string, key: string, origin: string, o: { stripe?: any; now?: number } = {}):
  Promise<{ ok: true; booked: true; label: string; message: string } | { ok: true; url: string } | { ok: false; error: string; status: number }> {
  const ref = refOf(db, tenantId, orderId);
  const order: any = ((await ref.get()).data() as any) || null;
  if (!order) return { ok: false, error: 'Order not found.', status: 404 };
  if (!canChoose(order)) return { ok: false, error: order.delivery?.status === 'waiting' ? 'Another try is already booked for this order.' : 'This order isn’t waiting for another try.', status: 409 };
  const plan = deliveryFrom(tenant?.retailSettings);
  const cents = retryCents(order, plan);
  const ws = await retryWindows(db, tenantId, tenant, o.now, { paid: cents > 0 });
  if (!ws.ok) return { ok: false, error: ws.message, status: 409 };
  const w = ws.windows.find((x) => x.key === String(key || ''));
  if (!w) return { ok: false, error: 'That time isn’t available anymore. Choose another.', status: 409 };
  const now = new Date().toISOString();
  if (cents <= 0) {
    const out = await db.runTransaction(async (tx: any) => {
      const cur: any = ((await tx.get(ref)).data() as any) || {};
      if (!canChoose(cur) || retryPayOpen(cur)) return { ok: false as const, error: retryPayOpen(cur) ? 'A payment for another try is open. Finish it, or go back to choose again.' : 'This order isn’t waiting for another try.', status: 409 };
      if (!(await hasRoom(tx, db, tenantId, orderId, w))) return { ok: false as const, error: `${w.label} just filled up. Choose another time.`, status: 409 };
      tx.update(ref, bookedFields(cur, w, null, now));
      choiceEvent(tx, ref, cur, `Chose another try: ${w.labelOn} (free)`, 'delivery_retry', now);
      return { ok: true as const };
    });
    if (!out.ok) return out;
    await tellTeam(db, tenantId, orderId, order, `${firstName(order)} chose another try for order ${num(order)}: ${w.labelOn}.`);
    return { ok: true, booked: true, label: w.label, message: `We’ll try again ${whenInSentence(w.label)}.` };
  }
  return startRetryPay(db, tenantId, tenant, orderId, order, w, cents, origin, o);
}

/** Opens the payment for another try, holding its place in the window until it's paid, left or lapses. */
async function startRetryPay(db: any, tenantId: string, tenant: any, orderId: string, order: any, w: RetryWindow, cents: number, origin: string, o: { stripe?: any } = {}):
  Promise<{ ok: true; url: string } | { ok: false; error: string; status: number }> {
  const acct = accountOf(tenant); const stripe = o.stripe || stripeNow();
  if (!acct || !stripe) return { ok: false, error: 'Online payments aren’t set up for this shop. Pick it up, or send the shop a message on this page.', status: 409 };
  const payId = randId();
  const base = `${origin}/shop/${tenantId}/order/${orderId}`;
  const session: any = await stripe.checkout.sessions.create({
    mode: 'payment',
    // Cards only (and the wallets that pay by card): the try is booked when the payment is confirmed.
    payment_method_types: ['card'],
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `Delivery, another try · Order ${num(order)}` } } }],
    ...(order.customerEmail ? { customer_email: String(order.customerEmail) } : {}),
    metadata: { type: 'delivery_retry', tenantId, retailOrderId: orderId, payId },
    payment_intent_data: { metadata: { type: 'delivery_retry', tenantId, retailOrderId: orderId, payId } },
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    success_url: `${base}?dretry_paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}?dretry_cancel=1`,
  }, { stripeAccount: acct, idempotencyKey: `dretry-${orderId}-${payId}` }).catch((e: any) => ({ error: e }));
  if (!session?.id || !session?.url) return { ok: false, error: 'The payment page couldn’t be opened. Try again in a moment.', status: 502 };
  const ref = refOf(db, tenantId, orderId);
  const now = new Date().toISOString();
  const out = await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || {};
    if (!canChoose(cur)) return { ok: false as const, error: 'This order isn’t waiting for another try.', status: 409 };
    if (!(await hasRoom(tx, db, tenantId, orderId, w))) return { ok: false as const, error: `${w.label} just filled up. Choose another time.`, status: 409 };
    const prev = retryPayOpen(cur) ? cur.delivery.retryPay : null;
    tx.update(ref, {
      'delivery.retryPay': { id: payId, status: 'awaiting_payment', window: { key: w.key, start: w.start, end: w.end, label: w.label, labelOn: w.labelOn }, cents, sessionId: session.id, url: session.url, at: now,
        // The window it was counted in before the hold: given back to it if this page isn't paid.
        prevKey: prev ? (prev.prevKey ?? null) : (cur.deliveryWindowKey ?? null), replaces: prev?.sessionId || null },
      deliveryWindowKey: w.key,
      ...(prev?.sessionId ? { [`deliveryRetryLog.${sidKey(prev.sessionId)}`]: { status: 'replaced', at: now } } : {}),
    });
    choiceEvent(tx, ref, cur, `Paying ${money(cents)} for another try: ${w.labelOn}`, 'delivery_retry_pay', now);
    return { ok: true as const, prev };
  });
  if (!out.ok) { await stripe.checkout.sessions.expire(session.id, {}, { stripeAccount: acct }).catch(() => null); return out; }
  // An earlier page they didn't finish can't be paid any more; if it was paid after all (a second tab), it's refunded.
  if (out.prev?.sessionId) await stripe.checkout.sessions.expire(String(out.prev.sessionId), {}, { stripeAccount: acct }).catch(() => null);
  return { ok: true, url: session.url };
}

/** A page given up on here: closed, and its place goes back. */
async function expireHere(db: any, tenantId: string, orderId: string, sessionId: string) {
  const ref = refOf(db, tenantId, orderId); const at = new Date().toISOString();
  await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(ref)).data() as any) || {};
    if (cur.delivery?.retryPay?.sessionId === sessionId && cur.delivery.retryPay.status === 'awaiting_payment') tx.update(ref, { 'delivery.retryPay': { ...cur.delivery.retryPay, status: 'expired', endedAt: at }, [`deliveryRetryLog.${sidKey(sessionId)}`]: { status: 'expired', at }, ...giveBackPlace(cur, cur.delivery.retryPay) }); });
}

/** The held place goes back to where the order was counted before, when the order still holds it. */
const giveBackPlace = (cur: any, rp: any) => (rp?.window?.key && cur.deliveryWindowKey === rp.window.key ? { deliveryWindowKey: rp.prevKey ?? null } : {});

/** The payment confirmed: the try is booked (or refunded if it's too late). Safe to repeat. */
export async function finishRetryPay(db: any, tenantId: string, orderId: string, sessionId: string, o: { stripe?: any; session?: any; tenant?: any } = {}): Promise<RetryResult> {
  const ref = refOf(db, tenantId, orderId);
  const order: any = ((await ref.get()).data() as any) || null;
  const rp = order?.delivery?.retryPay;
  if (!order || !sessionId) return { ok: false, result: 'not_found', message: 'That payment wasn’t found on this order.' };
  const key = sidKey(sessionId);
  const tenant = o.tenant || ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const acct = accountOf(tenant); const stripe = o.stripe || stripeNow();
  const getSession = async () => o.session || (acct && stripe ? await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: acct }).catch(() => null) : null);
  const known = order.deliveryRetryPaid?.[key];
  if (!rp || rp.sessionId !== sessionId) {
    if (known) return saidPaid(known);
    // A page replaced by a later one, then paid anyway: its payment goes back.
    const session = await getSession();
    if (!session || session.metadata?.retailOrderId !== orderId || session.metadata?.type !== 'delivery_retry') return { ok: false, result: 'not_found', message: 'That payment wasn’t found on this order.' };
    if (session.payment_status !== 'paid') return { ok: false, result: session.status === 'expired' ? 'expired' : 'pending', message: session.status === 'expired' ? 'The payment wasn’t finished, so nothing changed.' : 'We’re still waiting to hear the payment went through.' };
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
    const cents = c0(session.amount_total);
    await recordPaid(db, tenantId, orderId, order, key, cents, pi, 'replaced');
    const r = await refundRetryPayment(db, tenantId, orderId, key, 'replaced', { tenant });
    return { ok: true, result: r.ok ? 'refunded' : 'refund_failed', message: refundedWords(money(cents), 'replaced', r.ok) };
  }
  if (rp.status !== 'awaiting_payment') {
    // Closed or lapsed here, yet paid after all (Stripe answered late): the payment is written down and goes back.
    if (['expired', 'cancelled'].includes(String(rp.status)) && !known) {
      const late = await getSession();
      if (late && late.payment_status === 'paid' && late.metadata?.retailOrderId === orderId && late.metadata?.payId === rp.id) {
        const pi = typeof late.payment_intent === 'string' ? late.payment_intent : late.payment_intent?.id || null;
        const cents = c0(late.amount_total);
        await recordPaid(db, tenantId, orderId, order, key, cents, pi, 'late');
        const r = await refundRetryPayment(db, tenantId, orderId, key, 'late', { tenant });
        return { ok: true, result: r.ok ? 'refunded' : 'refund_failed', message: refundedWords(money(cents), 'late', r.ok) };
      }
    }
    return said(rp);
  }
  const session = await getSession();
  if (!session || session.metadata?.retailOrderId !== orderId || session.metadata?.payId !== rp.id) return { ok: false, result: 'pending', message: 'We’re still waiting to hear the payment went through.' };
  if (session.payment_status !== 'paid') {
    if (session.status === 'expired') {
      await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(ref)).data() as any) || {}; const at = new Date().toISOString();
        if (cur.delivery?.retryPay?.sessionId === sessionId && cur.delivery.retryPay.status === 'awaiting_payment') tx.update(ref, { 'delivery.retryPay': { ...cur.delivery.retryPay, status: 'expired', endedAt: at }, [`deliveryRetryLog.${key}`]: { status: 'expired', at }, ...giveBackPlace(cur, cur.delivery.retryPay) }); });
      return { ok: false, result: 'expired', message: 'The payment wasn’t finished, so nothing changed. Choose again below.' };
    }
    return { ok: false, result: 'pending', message: 'We’re still waiting to hear the payment went through.' };
  }
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const paidCents = c0(session.amount_total) || c0(rp.cents);
  const now = new Date().toISOString();
  const outcome: { kind: 'applied' | 'refund' | 'done'; why?: RetryRefundWhy } = await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || {};
    const live = cur.delivery?.retryPay;
    if (live?.sessionId !== sessionId || live?.status !== 'awaiting_payment') return { kind: 'done' as const };
    const entry = { cents: paidCents, pi, at: now };
    // The window it was held in hasn't ended (a late notice from Stripe can come after it has).
    const inTime = !(Date.parse(String(live.window?.end || '')) <= Date.now());
    if (canChoose(cur) && inTime) {
      // Its place was held while they paid, so it's theirs.
      tx.update(ref, {
        ...bookedFields(cur, live.window, { cents: paidCents, from: key }, now),
        'delivery.retryPay': { ...live, status: 'applied', paidAt: now, paidCents, paymentIntentId: pi },
        [`deliveryRetryPaid.${key}`]: { ...entry, state: 'applied' }, deliveryRetryPaidOpen: true,
      });
      choiceEvent(tx, ref, cur, `Paid ${money(paidCents)} for another try: ${live.window?.labelOn || live.window?.label || ''}`, 'delivery_retry', now);
      return { kind: 'applied' as const };
    }
    const why: RetryRefundWhy = String(cur.stage || '') === 'cancelled' ? 'cancelled' : cur.method !== 'delivery' ? 'pickup' : canChoose(cur) ? 'late' : 'gone_out';
    tx.update(ref, { 'delivery.retryPay': { ...live, status: 'refunding', paidAt: now, paidCents, paymentIntentId: pi, refundWhy: why },
      [`deliveryRetryPaid.${key}`]: { ...entry, state: 'refunding', refundWhy: why, refundTriedAt: now }, deliveryRetryPaidOpen: true, deliveryRetryPaidRetry: true, ...giveBackPlace(cur, live) });
    return { kind: 'refund' as const, why };
  });
  if (outcome.kind === 'done') { const cur: any = ((await ref.get()).data() as any) || {}; return cur.delivery?.retryPay?.sessionId === sessionId ? said(cur.delivery.retryPay) : (cur.deliveryRetryPaid?.[key] ? saidPaid(cur.deliveryRetryPaid[key]) : said(rp)); }
  await writeIncome(db, tenantId, orderId, order, paidCents, pi, key).catch(() => {});
  if (outcome.kind === 'applied') {
    await tellTeam(db, tenantId, orderId, order, `${firstName(order)} paid ${money(paidCents)} for another try on order ${num(order)}: ${rp.window?.labelOn || rp.window?.label || ''}.`);
    return said({ ...rp, status: 'applied', paidCents });
  }
  const r = await refundRetryPayment(db, tenantId, orderId, key, outcome.why || 'gone_out', { tenant });
  return said({ ...rp, status: r.ok ? 'refunded' : 'refund_failed', paidCents, refundWhy: outcome.why });
}

/** They left the payment page (or chose something else): it closes and the place goes back. A page paid meanwhile goes
 *  through instead; one Stripe is still finishing is left for the five-minute check. */
export async function cancelRetryPay(db: any, tenantId: string, orderId: string, o: { stripe?: any; tenant?: any } = {}): Promise<RetryResult> {
  const ref = refOf(db, tenantId, orderId);
  const order: any = ((await ref.get()).data() as any) || {};
  const rp = order.delivery?.retryPay;
  if (!rp || rp.status !== 'awaiting_payment') return said(rp || { status: 'cancelled' });
  const tenant = o.tenant || ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const acct = accountOf(tenant); const stripe = o.stripe || stripeNow();
  const closed: any = acct && stripe ? await stripe.checkout.sessions.expire(String(rp.sessionId), {}, { stripeAccount: acct }).catch((e: any) => ({ error: e })) : null;
  if (!closed || closed?.error) {
    const f = await finishRetryPay(db, tenantId, orderId, String(rp.sessionId), { stripe, tenant });
    if (f.result !== 'pending') return f;
    return { ok: false, result: 'pending', message: 'We couldn’t close the payment page just now. If you paid, another try is booked; if not, nothing is charged. Check back in a few minutes.' };
  }
  const now = new Date().toISOString();
  await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(ref)).data() as any) || {};
    if (cur.delivery?.retryPay?.sessionId === rp.sessionId && cur.delivery.retryPay.status === 'awaiting_payment') tx.update(ref, { 'delivery.retryPay': { ...cur.delivery.retryPay, status: 'cancelled', endedAt: now }, [`deliveryRetryLog.${sidKey(rp.sessionId)}`]: { status: 'cancelled', at: now }, ...giveBackPlace(cur, cur.delivery.retryPay) }); });
  return { ok: true, result: 'cancelled', message: 'No problem. Nothing was charged.' };
}

/** Give back one second-try payment, once (the same Stripe key every time, so trying again never refunds twice). */
/** A second-try payment still to be settled: one the five-minute check may yet need to refund. Kept ones (the
 *  customer's own choice after a try that failed on their side) and refunded ones are settled. */
const UNSETTLED = ['applied', 'refunding', 'refund_failed', 'late', 'replaced'];
export const retryPaidOpen = (map: Record<string, any>): boolean => Object.values<any>(map || {}).some((x) => x && !x.refundedAt && !x.gaveUp && UNSETTLED.includes(String(x.state)));

/** Who a payment belongs to, as Stripe has it. */
async function paymentOwner(tenant: any, pi: any, stripe0?: any): Promise<{ ok: boolean; type?: string; orderId?: string }> {
  const acct = accountOf(tenant); const stripe = stripe0 || stripeNow();
  if (!acct || !stripe || !pi) return { ok: false };
  const p: any = await stripe.paymentIntents.retrieve(String(pi), {}, { stripeAccount: acct }).catch(() => null);
  return p ? { ok: true, type: String(p.metadata?.type || ''), orderId: String(p.metadata?.retailOrderId || '') } : { ok: false };
}

export async function refundRetryPayment(db: any, tenantId: string, orderId: string, key: string, why: RetryRefundWhy, o: { tenant?: any; stripe?: any } = {}): Promise<{ ok: boolean; cents: number; already?: boolean; error?: string }> {
  const ref = refOf(db, tenantId, orderId); const now = new Date().toISOString();
  const claim: any = await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || {};
    const e = cur.deliveryRetryPaid?.[key];
    if (!e) return { none: true };
    if (e.refundedAt) return { already: true, cents: c0(e.cents) };
    tx.update(ref, { [`deliveryRetryPaid.${key}`]: { ...e, state: 'refunding', refundWhy: why, refundTriedAt: now }, deliveryRetryPaidRetry: true });
    return { e };
  });
  if (claim.none) return { ok: false, cents: 0, error: 'That payment isn’t on this order.' };
  if (claim.already) return { ok: true, cents: claim.cents, already: true };
  const e = claim.e; const cents = c0(e.cents);
  const tenant = o.tenant || ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  // Only a payment Stripe says was this order's second try is ever refunded from here.
  const owner = await paymentOwner(tenant, e.pi, o.stripe);
  const mine = owner.ok && owner.type === 'delivery_retry' && owner.orderId === orderId;
  const r0: any = !(e.pi && cents > 0) ? { ok: false, error: 'There’s no card payment to refund.' }
    : !owner.ok ? { ok: false, error: 'Stripe couldn’t be asked about the payment just now.' }
    : !mine ? { ok: false, error: 'That payment isn’t a second delivery try on this order.', notMine: true }
    : await refundAmount(accountOf(tenant), String(e.pi), cents, `dretry-refund-${key}`);
  // Already refunded in Stripe by hand: the money went back.
  const outside = !r0.ok && r0.code === 'charge_already_refunded';
  const r = outside ? { ok: true } : r0;
  const tries = (Number(e.refundTries) || 0) + (r.ok ? 0 : 1);
  const gaveUp = !r.ok && (tries >= REFUND_TRIES || r0.notMine === true);
  const done = new Date().toISOString();
  await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || {};
    const cE = cur.deliveryRetryPaid?.[key] || e;
    const map = { ...(cur.deliveryRetryPaid || {}), [key]: { ...cE, state: r.ok ? 'refunded' : 'refund_failed', refundTries: tries, refundWhy: why,
      ...(r.ok ? { refundedAt: done, ...(outside ? { refundedOutside: true } : {}) } : { refundError: String((r as any).error || 'The refund didn’t go through.').slice(0, 200), ...(gaveUp ? { gaveUp: true } : {}) }) } };
    const vals = Object.values<any>(map);
    const live = cur.delivery?.retryPay;
    tx.update(ref, { deliveryRetryPaid: map, deliveryRetryPaidOpen: retryPaidOpen(map),
      deliveryRetryPaidRetry: vals.some((x) => !x.refundedAt && !x.gaveUp && ['refunding', 'refund_failed', 'replaced', 'late'].includes(String(x.state))),
      ...(live && sidKey(live.sessionId) === key ? { 'delivery.retryPay': { ...live, status: r.ok ? 'refunded' : 'refund_failed', refundWhy: why, endedAt: done } } : {}) });
  });
  const order: any = ((await ref.get()).data() as any) || {};
  if (r.ok) await writeRefund(db, tenantId, orderId, order, cents, key, whyWords(why)).catch(() => {});
  else if (tries === 1 || gaveUp) {
    const n = db.collection(`tenants/${tenantId}/notifications`).doc();
    await n.set({ id: n.id, type: 'order_refund_due', read: false, createdAt: done, link: `/retail-orders?order=${orderId}`,
      message: gaveUp
        ? `The ${money(cents)} ${order.customerName || 'a customer'} paid for another delivery try on order ${num(order)} still couldn’t be refunded automatically (${whyWords(why)}). Please refund it in Stripe.`
        : `${order.customerName || 'A customer'} paid ${money(cents)} for another delivery try on order ${num(order)}, and it needs refunding (${whyWords(why)}), but the automatic refund didn’t go through. It’s tried again every few minutes; if it keeps failing, you’ll be told to refund it in Stripe.` }).catch(() => {});
  }
  return { ok: r.ok, cents, ...(r.ok ? {} : { error: (r as any).error }) };
}

/** EVERY FIVE MINUTES (cron/retail-payments): second-try payments nobody came back from, and refunds that failed. */
export async function sweepRetryPays(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<number> {
  const now = o.now ?? Date.now(); let n = 0;
  const T = `tenants/${tenantId}/retailOrders`;
  const open = await db.collection(T).where('delivery.retryPay.status', '==', 'awaiting_payment').limit(30).get().catch(() => ({ docs: [] as any[] }));
  for (const d of open.docs) {
    const rp: any = (d.data() || {}).delivery?.retryPay || {};
    const age = now - (Date.parse(String(rp.at || '')) || now);
    if (age < 2 * 60000) continue;
    const f = await finishRetryPay(db, tenantId, d.id, String(rp.sessionId || ''), { stripe: o.stripe, tenant });
    if (f.result === 'pending' && age > 2 * 3600e3) {
      const c = await cancelRetryPay(db, tenantId, d.id, { stripe: o.stripe, tenant });
      // Stripe hasn't answered for hours: the page lapsed long ago (it lasts 31 minutes), so the place goes back. If it
      // was paid after all, its notice finds the page closed and the payment goes back (finishRetryPay).
      if (c.result === 'pending' && age > 6 * 3600e3) await expireHere(db, tenantId, d.id, String(rp.sessionId || ''));
    }
    n++;
  }
  // A canceled order: a second try paid for and never settled goes back (one the customer's own choice kept, after a try
  // that failed on their side, stays kept).
  const cancelled = await db.collection(T).where('deliveryRetryPaidOpen', '==', true).where('stage', '==', 'cancelled').limit(30).get().catch(() => ({ docs: [] as any[] }));
  for (const d of cancelled.docs) {
    for (const [k, e] of Object.entries<any>((d.data() || {}).deliveryRetryPaid || {})) {
      if (e?.refundedAt || e?.gaveUp || e?.state !== 'applied') continue;
      await refundRetryPayment(db, tenantId, d.id, k, 'cancelled', { tenant, stripe: o.stripe }).catch(() => null); n++;
    }
  }
  const retry = await db.collection(T).where('deliveryRetryPaidRetry', '==', true).limit(30).get().catch(() => ({ docs: [] as any[] }));
  for (const d of retry.docs) {
    let left = false;
    for (const [k, e] of Object.entries<any>((d.data() || {}).deliveryRetryPaid || {})) {
      if (e?.refundedAt || e?.gaveUp || !['refunding', 'refund_failed', 'replaced', 'late'].includes(String(e?.state))) continue;
      if (e.state === 'refunding' && now - (Date.parse(String(e.refundTriedAt || '')) || 0) < 10 * 60000) { left = true; continue; }
      const r = await refundRetryPayment(db, tenantId, d.id, k, ['replaced', 'late'].includes(e.state) ? e.state : e.refundWhy || 'gone_out', { tenant, stripe: o.stripe }).catch(() => ({ ok: false }));
      if (!r.ok) left = true; n++;
    }
    if (!left) await d.ref.update({ deliveryRetryPaidRetry: false }).catch(() => {});
  }
  return n;
}

/**
 * PICK IT UP AT THE SHOP: a pickup order now, ready on the shelf, with their pickup code. When it failed on the shop's
 * side, the delivery fee for that try is owed back: the order's own is queued as a shipping-only refund (the caller
 * sends it), a second try's own payment goes straight back.
 */
export async function switchToPickup(db: any, tenantId: string, tenant: any, orderId: string): Promise<{ ok: true; back: { cents: number; from: string } | null; sent: boolean } | { ok: false; error: string; status: number }> {
  if (tenant?.retailSettings?.pickupEnabled === false) return { ok: false, error: 'This shop doesn’t offer pickup. Choose another try, or send the shop a message on this page.', status: 409 };
  const ref = refOf(db, tenantId, orderId);
  const now = new Date().toISOString();
  const out = await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || null;
    if (!cur) return { ok: false as const, error: 'Order not found.', status: 404 };
    if (!canChoose(cur)) return { ok: false as const, error: 'This order isn’t waiting for another try.', status: 409 };
    if (retryPayOpen(cur)) return { ok: false as const, error: 'A payment for another try is open. Go back to it, or wait a moment and try again.', status: 409 };
    const back = feeBack(cur);
    const d = cur.delivery || {};
    tx.update(ref, {
      // Ready for them from now: the uncollected reminders count from here, not from when it first went out.
      method: 'counter', pickupAt: 'Ready now', readyAt: now,
      switchedFrom: { method: 'delivery', at: now, by: 'customer', feeBackCents: back?.cents || 0 },
      'delivery.status': 'pickup',
      'delivery.lastFail': { code: d.failCode || null, cause: d.failCause || null, reason: String(d.failReason || ''), at: d.failedAt || null, try: Math.max(1, Math.floor(Number(d.tries) || 1)) },
      deliveryWindowKey: null, deliveryAsapAt: null,
      ...(back && back.from === 'order' ? { pendingRefundCents: c0(cur.pendingRefundCents) + back.cents, deliveryFeeBackCents: c0(cur.deliveryFeeBackCents) + back.cents } : {}),
      // Written down before anything is sent, so a refund cut off part way is tried again by the five-minute check; the
      // rest of what they paid for tries stays with the shop (the try failed on their side).
      ...retryPaidMarks(cur, back, 'pickup', now),
    });
    choiceEvent(tx, ref, cur, `Chose to pick it up at the shop${back ? `; the ${money(back.cents)} delivery fee goes back (it failed on the shop’s side)` : ''}`, 'delivery_pickup', now);
    return { ok: true as const, back, order: cur };
  });
  if (!out.ok) return out;
  await tellTeam(db, tenantId, orderId, out.order, `${firstName(out.order)} will pick up order ${num(out.order)} at the shop instead. It’s on the ready shelf.`);
  let sent = true;
  if (out.back && out.back.from !== 'order') sent = (await refundRetryPayment(db, tenantId, orderId, out.back.from, 'pickup', { tenant }).catch(() => ({ ok: false }))).ok;
  return { ok: true, back: out.back, sent };
}

/** On a pickup or a cancellation after a failed try: the second-try payment coming back is marked to be refunded, and
 *  every other one is kept. Dotted updates, for the same transaction as the choice. */
export function retryPaidMarks(cur: any, back: { cents: number; from: string } | null, why: RetryRefundWhy, now: string): Record<string, any> {
  const paid = cur?.deliveryRetryPaid || {};
  const out: Record<string, any> = {}; const after: Record<string, any> = { ...paid };
  if (back && back.from !== 'order' && paid[back.from] && !paid[back.from].refundedAt) {
    after[back.from] = { ...paid[back.from], state: 'refunding', refundWhy: why, refundTriedAt: now };
    out[`deliveryRetryPaid.${back.from}`] = after[back.from]; out.deliveryRetryPaidRetry = true;
  }
  for (const k of keptPaidKeys(cur)) if (paid[k]?.state === 'applied') { after[k] = { ...paid[k], state: 'kept', keptAt: now }; out[`deliveryRetryPaid.${k}`] = after[k]; }
  if (Object.keys(paid).length) out.deliveryRetryPaidOpen = retryPaidOpen(after);
  return out;
}

async function recordPaid(db: any, tenantId: string, orderId: string, order: any, key: string, cents: number, pi: string | null, state: string) {
  const ref = refOf(db, tenantId, orderId); const now = new Date().toISOString();
  await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(ref)).data() as any) || {};
    if (cur.deliveryRetryPaid?.[key]) return;
    tx.update(ref, { [`deliveryRetryPaid.${key}`]: { cents, pi, at: now, state }, deliveryRetryPaidOpen: true, ...(state === 'replaced' || state === 'late' ? { deliveryRetryPaidRetry: true } : {}) }); });
  await writeIncome(db, tenantId, orderId, order, cents, pi, key).catch(() => {});
}

function whyWords(why: RetryRefundWhy | string): string {
  return why === 'cancelled' ? 'the order was canceled' : why === 'pickup' ? 'it’s being picked up instead' : why === 'replaced' ? 'a later payment replaced it'
    : why === 'late' ? 'the payment came through too late for the time chosen' : 'the shop had already sent it out again';
}

function refundedWords(c: string, why: any, done: boolean): string {
  const back = done ? `your ${c} was refunded to your card` : `the shop will refund your ${c}`;
  if (why === 'cancelled') return `Your order was canceled, so ${back}.`;
  if (why === 'pickup') return `Your order is set for pickup, so ${back}.`;
  if (why === 'replaced') return `You’d already started another payment for this, so ${back}.`;
  if (why === 'late') return `The payment came through after the time you chose, so ${back}. Choose again below.`;
  return `The shop had already sent it out again, so ${back}.`;
}

function said(rp: any): RetryResult {
  const c = money(rp?.paidCents || rp?.cents);
  const when = String(rp?.window?.label || '');
  switch (rp?.status) {
    case 'applied': return { ok: true, result: 'applied', message: `Paid ${c}. We’ll try again ${when ? whenInSentence(when) : 'soon'}.` };
    case 'refunded': return { ok: true, result: 'refunded', message: refundedWords(c, rp.refundWhy, true) };
    case 'refund_failed': case 'refunding': return { ok: true, result: 'refund_failed', message: refundedWords(c, rp.refundWhy, false) };
    case 'expired': return { ok: false, result: 'expired', message: 'The payment wasn’t finished, so nothing changed. Choose again below.' };
    case 'cancelled': return { ok: true, result: 'cancelled', message: 'No problem. Nothing was charged.' };
    default: return { ok: false, result: 'pending', message: 'We’re still waiting to hear the payment went through.' };
  }
}

function saidPaid(e: any): RetryResult {
  const c = money(e?.cents);
  if (e?.refundedAt) return { ok: true, result: 'refunded', message: refundedWords(c, e.refundWhy, true) };
  if (['refunding', 'refund_failed', 'replaced', 'late'].includes(String(e?.state))) return { ok: true, result: 'refund_failed', message: refundedWords(c, ['replaced', 'late'].includes(e.state) ? e.state : e.refundWhy, false) };
  return { ok: true, result: 'applied', message: `Paid ${c}. Another try is booked.` };
}

async function writeIncome(db: any, tenantId: string, orderId: string, order: any, cents: number, pi: string | null, key: string) {
  const ref = db.doc(`tenants/${tenantId}/transactions/delivretry_${key}`);
  await ref.create({ id: ref.id, date: new Date().toISOString(), description: `Delivery, another try — Order ${num(order)}`, clientOrVendor: order.customerName || 'Guest',
    type: 'income', context: 'Business', category: 'Retail', taxBucket: 'revenue', amount: cents / 100, shippingCollected: cents / 100, paymentMethod: 'Online Checkout', hasReceipt: true,
    retailOrderId: orderId, ...(pi ? { stripePaymentIntentId: pi } : {}), deliveryRetrySessionKey: key, tenantId }).catch(() => {});
}

async function writeRefund(db: any, tenantId: string, orderId: string, order: any, cents: number, key: string, why: string) {
  const ref = db.doc(`tenants/${tenantId}/transactions/delivretryrefund_${key}`);
  await ref.create({ id: ref.id, date: new Date().toISOString(), description: `Refund of a delivery try (${why}) — Order ${num(order)}`, clientOrVendor: order.customerName || 'Guest',
    type: 'expense', context: 'Business', category: 'Refunds', taxBucket: 'refund', amount: cents / 100, taxRefunded: 0, paymentMethod: 'Card (Online)', hasReceipt: true, retailOrderId: orderId, channel: 'online', tenantId }).catch(() => {});
}
