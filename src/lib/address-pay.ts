// src/lib/address-pay.ts — THE CUSTOMER PAYS THE SHIPPING DIFFERENCE FOR A NEW ADDRESS, THEN IT GOES ON (server).
// When the shop's policy (lib/address-cost) has the customer pay some or all of what a new address adds, the change
// waits on the order (addressPay) while they pay on Stripe's own page (cards only), on the shop's account. It goes on as
// soon as the payment is confirmed, by whichever comes first: their return to the order page, Stripe's notice
// (connect-webhook), or the five-minute check (cron/retail-payments). Each is safe to repeat: the change goes on once.
// If the order moved on meanwhile: a label bought (or packing started, or a hold) turns it into a request for the shop
// (if they keep the old address, the payment is refunded); an order already gone out, cancelled, or a shop that stopped
// taking changes online can't change, so the payment is refunded at once.
// Every payment is written on the order once, by its Stripe page (addressPaid, server-only), with what happened to it, so
// money never goes missing: a page paid after another replaced it is refunded; a cancelled order's payments are refunded;
// a refund that failed or stopped part way is tried again by the five-minute check, and the team hears if it can't be.
// What they paid is shipping income, and each refund is written against it.
import Stripe from 'stripe';
import { changeMode, oneLine, type Address } from '@/lib/address-flow';
import { refundAmount } from '@/lib/stripe-refund';

export type AddressPayInput = { to: Address; check: any; cents: number; shopCents: number; diffCents: number; fromCents: number; toCents: number; origCents: number; paidBefore: number; service: string; carrier: string; unitAnswer?: string | null };
export type FinishResult = { ok: boolean; result: 'applied' | 'requested' | 'refunded' | 'refund_failed' | 'pending' | 'expired' | 'cancelled' | 'not_found'; message: string };
export type RefundWhy = 'gone_out' | 'cancelled' | 'off' | 'kept' | 'replaced';

const money = (c: number) => `$${(Math.round(Number(c) || 0) / 100).toFixed(2)}`;
const num = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;
const accountOf = (t: any) => t?.stripeAccountId || t?.stripeConnectAccountId || null;
const stripeNow = () => (process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any }) : null);
const randId = () => `ap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const sidKey = (sid: string) => String(sid || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 120);
const REFUND_TRIES = 12;   // about an hour of tries by the five-minute check, then the team refunds it by hand
const orderRefOf = (db: any, tenantId: string, orderId: string) => db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);

/** Why a payment can't put the change on, from the order as it is now. */
function tooLateWhy(cur: any, mode: string, why: string): RefundWhy {
  if (String(cur?.stage || '') === 'cancelled') return 'cancelled';
  if (mode === 'none' && why === 'off') return 'off';
  return 'gone_out';
}

/** Start the payment: a Stripe page for the customer's share, and the change waiting on the order until it's paid. */
export async function startAddressPay(db: any, tenantId: string, tenant: any, orderId: string, order: any, p: AddressPayInput, origin: string, o: { stripe?: any } = {}): Promise<{ ok: true; url: string } | { ok: false; error: string; status: number }> {
  const acct = accountOf(tenant); const stripe = o.stripe || stripeNow();
  if (!acct || !stripe) return { ok: false, error: 'Online payments aren’t set up for this shop, so the shop needs to make this change. Send them a message on this page.', status: 409 };
  const cents = Math.round(p.cents);
  if (!(cents >= 50)) return { ok: false, error: 'That amount is too small to pay by card.', status: 400 };
  const payId = randId();
  const base = `${origin}/shop/${tenantId}/order/${orderId}`;
  const session: any = await stripe.checkout.sessions.create({
    mode: 'payment',
    // Cards only (and the wallets that pay by card): the change goes on when the payment is confirmed, so it can't
    // wait days for a bank debit to clear.
    payment_method_types: ['card'],
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `Shipping to your new address · Order ${num(order)}` } } }],
    ...(order.customerEmail ? { customer_email: String(order.customerEmail) } : {}),
    metadata: { type: 'address_change', tenantId, retailOrderId: orderId, payId },
    payment_intent_data: { metadata: { type: 'address_change', tenantId, retailOrderId: orderId, payId } },
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    success_url: `${base}?addr_paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}?addr_cancel=1`,
  }, { stripeAccount: acct, idempotencyKey: `addrpay-${orderId}-${payId}` }).catch((e: any) => ({ error: e }));
  if (!session?.id || !session?.url) return { ok: false, error: 'The payment page couldn’t be opened. Try again in a moment.', status: 502 };
  const ref = orderRefOf(db, tenantId, orderId);
  const now = new Date().toISOString();
  const out = await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || {};
    if (changeMode(cur, tenant?.retailSettings || {}).mode !== 'direct') return { ok: false as const, error: 'The address can’t be changed here any more.', status: 409 };
    const prev = cur.addressPay?.status === 'awaiting_payment' ? cur.addressPay : null;
    tx.set(ref, { addressPay: { id: payId, status: 'awaiting_payment', to: p.to, check: p.check || null, unitAnswer: p.unitAnswer || null, cents, shopCents: Math.round(p.shopCents), diffCents: Math.round(p.diffCents), fromCents: Math.round(p.fromCents), toCents: Math.round(p.toCents),
      origCents: Math.round(p.origCents), paidBefore: Math.round(p.paidBefore), service: p.service || '', carrier: p.carrier || '', sessionId: session.id, url: session.url, at: now, replaces: prev?.sessionId || null },
      ...(prev?.sessionId ? { addressPayLog: { [sidKey(prev.sessionId)]: { status: 'replaced', at: now } } } : {}) }, { merge: true });
    const ev = ref.collection('events').doc();
    tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: 'customer', actorName: cur.customerName || 'Customer', meta: { kind: 'address_pay_started', text: `Paying ${money(cents)} for shipping to a new address (${oneLine(p.to)})${p.shopCents > 0 ? `; the shop covers ${money(p.shopCents)}` : ''}` } });
    return { ok: true as const, prev };
  });
  if (!out.ok) { await stripe.checkout.sessions.expire(session.id, {}, { stripeAccount: acct }).catch(() => null); return out; }
  // An earlier payment page they didn't finish can't be paid any more. If it was paid after all (a second tab), its
  // payment is refunded when Stripe's notice, their return or the five-minute check finds it (finishAddressPay).
  if (out.prev?.sessionId) await stripe.checkout.sessions.expire(String(out.prev.sessionId), {}, { stripeAccount: acct }).catch(() => null);
  return { ok: true, url: session.url };
}

/** The payment confirmed: the change goes on (or to the shop, or is refunded if it's too late). Safe to repeat. A page
 *  that was replaced by a later one and paid anyway is refunded. */
export async function finishAddressPay(db: any, tenantId: string, orderId: string, sessionId: string, o: { stripe?: any; session?: any; tenant?: any } = {}): Promise<FinishResult> {
  const ref = orderRefOf(db, tenantId, orderId);
  const order: any = ((await ref.get()).data() as any) || null;
  const ap = order?.addressPay;
  if (!order || !sessionId) return { ok: false, result: 'not_found', message: 'That payment wasn’t found on this order.' };
  const tenant = o.tenant || ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const acct = accountOf(tenant); const stripe = o.stripe || stripeNow();
  const getSession = async () => o.session || (acct && stripe ? await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: acct }).catch(() => null) : null);
  // Already written on the order: say what happened to it.
  const known = order.addressPaid?.[sidKey(sessionId)];
  if (!ap || ap.sessionId !== sessionId) {
    if (known) return saidPaid(known);
    // A page replaced by a later one, then paid anyway (a second tab, or back and pay): its payment goes back.
    const session = await getSession();
    if (!session || session.metadata?.retailOrderId !== orderId || session.metadata?.type !== 'address_change') return { ok: false, result: 'not_found', message: 'That payment wasn’t found on this order.' };
    if (session.payment_status !== 'paid') return { ok: false, result: session.status === 'expired' ? 'expired' : 'pending', message: session.status === 'expired' ? 'The payment wasn’t finished, so the address stayed the same.' : 'We’re still waiting to hear the payment went through.' };
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
    const paidCents = Math.round(Number(session.amount_total) || 0);
    await recordPaid(db, tenantId, orderId, order, sessionId, paidCents, pi, 'replaced');
    const r = await refundAddressPayment(db, tenantId, orderId, sessionId, 'replaced', { tenant });
    return { ok: true, result: r.ok ? 'refunded' : 'refund_failed', message: r.ok ? `You’d already started another payment for a new address, so this ${money(paidCents)} payment was refunded to your card.` : `You’d already started another payment for a new address, so the shop will refund this ${money(paidCents)} payment.` };
  }
  if (ap.status !== 'awaiting_payment') return said(ap);
  const session = await getSession();
  if (!session || session.metadata?.retailOrderId !== orderId || session.metadata?.payId !== ap.id) return { ok: false, result: 'pending', message: 'We’re still waiting to hear the payment went through.' };
  if (session.payment_status !== 'paid') {
    if (session.status === 'expired') {
      await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(ref)).data() as any) || {};
        if (cur.addressPay?.sessionId === sessionId && cur.addressPay?.status === 'awaiting_payment') tx.set(ref, { addressPay: { ...cur.addressPay, status: 'expired', endedAt: new Date().toISOString() }, addressPayLog: { [sidKey(sessionId)]: { status: 'expired', at: new Date().toISOString() } } }, { merge: true }); });
      return { ok: false, result: 'expired', message: 'The payment wasn’t finished, so the address stayed the same.' };
    }
    return { ok: false, result: 'pending', message: 'We’re still waiting to hear the payment went through.' };
  }
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const paidCents = Math.round(Number(session.amount_total) || ap.cents);
  const rs = tenant.retailSettings || {};
  const now = new Date().toISOString();
  // What the moves have cost so far, with this payment (lib/address-cost): measured from the original address's price.
  const customerCents = Math.max(0, Math.round(Number(ap.paidBefore) || 0)) + paidCents;
  const extra = Math.max(0, Math.round(Number(ap.toCents) || 0) - Math.round(Number(ap.origCents ?? ap.fromCents) || 0));
  const cost = { at: now, origCents: Math.round(Number(ap.origCents ?? ap.fromCents) || 0), toCents: Math.round(Number(ap.toCents) || 0), extraCents: extra, diffCents: extra, fromCents: ap.fromCents,
    customerCents, shopCents: Math.max(0, extra - customerCents), service: ap.service, carrier: ap.carrier, paymentIntentId: pi, sessionId, moves: (Number(order.addressCost?.moves) || 0) + 1 };
  const paidEntry = { cents: paidCents, pi, at: now };
  const outcome: { kind: 'applied' | 'requested' | 'refund' | 'done'; why?: string; refundWhy?: RefundWhy } = await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || {};
    if (cur.addressPay?.sessionId !== sessionId || cur.addressPay?.status !== 'awaiting_payment') return { kind: 'done' as const };
    const { mode, why } = changeMode(cur, rs);
    const evRef = ref.collection('events').doc();
    const answered = ['waiting', 'confirmed'].includes(String(cur.addressConfirm?.status || '')) ? { addressConfirm: { ...cur.addressConfirm, status: 'fixed', answeredAt: now } } : {};
    // A request waiting for the shop that this change replaces: what was paid for it goes back (the five-minute check).
    const oldPaid = mode === 'direct' && cur.addressRequest?.status === 'waiting' && cur.addressRequest?.paid?.sessionId ? sidKey(cur.addressRequest.paid.sessionId) : '';
    const oldEntry = oldPaid && cur.addressPaid?.[oldPaid] && !cur.addressPaid[oldPaid].refundedAt ? { [oldPaid]: { ...cur.addressPaid[oldPaid], state: 'replaced' } } : {};
    const paidMark = { addressPaid: { ...(cur.addressPaid || {}), ...oldEntry, [sidKey(sessionId)]: { ...paidEntry, state: mode === 'direct' ? 'applied' : mode === 'request' ? 'requested' : 'refunding', ...(mode === 'direct' || mode === 'request' ? {} : { refundTriedAt: now }) } },
      addressPaidOpen: true, ...(mode === 'direct' || mode === 'request' ? (Object.keys(oldEntry).length ? { addressPaidRetry: true } : {}) : { addressPaidRetry: true }) };
    if (mode === 'direct') {
      tx.update(ref, {
        shippingAddress: ap.to, addressCheck: ap.check || null,
        addressChanged: { at: now, from: cur.shippingAddress || null, by: 'customer', after: String(cur.stage || '') },
        addressCost: cost, addressPay: { ...cur.addressPay, status: 'applied', paidAt: now, paidCents, paymentIntentId: pi },
        ...(cur.addressRequest?.status === 'waiting' ? { addressRequest: { ...cur.addressRequest, status: 'replaced', answeredAt: now } } : {}),
        ...answered, ...paidMark,
      });
      tx.set(evRef, { id: evRef.id, type: 'address_updated', at: now, actorId: 'customer', actorName: cur.customerName || 'Customer',
        meta: { from: cur.shippingAddress || null, to: ap.to, selfServe: true, paidCents, shopCents: cost.shopCents, verdict: ap.check?.verdict || null } });
      return { kind: 'applied' as const };
    }
    if (mode === 'request') {
      // A new request, written whole (never merged into an earlier one, so nothing of an old request carries over).
      tx.update(ref, {
        addressRequest: { id: evRef.id, kind: 'change', status: 'waiting', to: ap.to, from: cur.shippingAddress || null, check: ap.check || null, at: now, why,
          cost: { origCents: cost.origCents, toCents: cost.toCents, extraCents: extra, diffCents: extra, fromCents: ap.fromCents, service: ap.service, carrier: ap.carrier, paidBefore: Math.round(Number(ap.paidBefore) || 0) },
          paid: { cents: paidCents, paymentIntentId: pi, sessionId } },
        addressPay: { ...cur.addressPay, status: 'requested', paidAt: now, paidCents, paymentIntentId: pi, why },
        ...answered, ...paidMark,
      });
      tx.set(evRef, { id: evRef.id, type: 'note', at: now, actorId: 'customer', actorName: cur.customerName || 'Customer',
        meta: { kind: 'address_change_requested', text: `Paid ${money(paidCents)} and asked to change the address to ${oneLine(ap.to)} (${why === 'label' ? 'the label was bought while they were paying' : why === 'packing' ? 'packing started while they were paying' : 'it needs the shop to confirm'})`, to: ap.to } });
      return { kind: 'requested' as const, why };
    }
    const refundWhy = tooLateWhy(cur, mode, why);
    tx.update(ref, { addressPay: { ...cur.addressPay, status: 'refunding', paidAt: now, paidCents, paymentIntentId: pi, refundWhy }, ...paidMark });
    return { kind: 'refund' as const, refundWhy };
  });
  if (outcome.kind === 'done') { const cur: any = ((await ref.get()).data() as any) || {}; return cur.addressPay?.sessionId === sessionId ? said(cur.addressPay) : (cur.addressPaid?.[sidKey(sessionId)] ? saidPaid(cur.addressPaid[sidKey(sessionId)]) : said(ap)); }
  await writeIncome(db, tenantId, orderId, order, paidCents, pi, sessionId).catch(() => {});
  if (outcome.kind === 'applied') return said({ ...ap, status: 'applied', cents: paidCents, to: ap.to });
  if (outcome.kind === 'requested') return said({ ...ap, status: 'requested', cents: paidCents, to: ap.to, why: outcome.why });
  // Too late to change it: the money goes straight back.
  const r = await refundAddressPayment(db, tenantId, orderId, sessionId, outcome.refundWhy || 'gone_out', { tenant });
  return said({ ...ap, status: r.ok ? 'refunded' : 'refund_failed', cents: paidCents, refundWhy: outcome.refundWhy });
}

/** The customer kept their address instead (or left the payment page): the payment page closes. A page that was paid
 *  meanwhile goes through instead, and one Stripe is still finishing is left for the five-minute check. */
export async function cancelAddressPay(db: any, tenantId: string, orderId: string, o: { stripe?: any; tenant?: any } = {}): Promise<FinishResult> {
  const ref = orderRefOf(db, tenantId, orderId);
  const order: any = ((await ref.get()).data() as any) || {};
  const ap = order.addressPay;
  if (!ap || ap.status !== 'awaiting_payment') return said(ap || { status: 'cancelled' });
  const tenant = o.tenant || ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const acct = accountOf(tenant); const stripe = o.stripe || stripeNow();
  const closed: any = acct && stripe ? await stripe.checkout.sessions.expire(String(ap.sessionId), {}, { stripeAccount: acct }).catch((e: any) => ({ error: e })) : null;
  if (closed?.error) {
    // It couldn't be closed: it was paid (it goes on now), it already expired, or Stripe didn't answer.
    const f = await finishAddressPay(db, tenantId, orderId, String(ap.sessionId), { stripe, tenant });
    if (f.result !== 'pending') return f;
    return { ok: false, result: 'pending', message: 'We couldn’t close the payment page just now. If you paid, the new address goes on; if not, nothing is charged. Check back in a few minutes.' };
  }
  const now = new Date().toISOString();
  await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(ref)).data() as any) || {};
    if (cur.addressPay?.sessionId === ap.sessionId && cur.addressPay?.status === 'awaiting_payment') tx.set(ref, { addressPay: { ...cur.addressPay, status: 'cancelled', endedAt: now }, addressPayLog: { [sidKey(ap.sessionId)]: { status: 'cancelled', at: now } } }, { merge: true }); });
  return { ok: true, result: 'cancelled', message: 'No problem. Your order still ships to the address you have.' };
}

/** Give back one address payment, once (the same Stripe key every time, so trying again never refunds twice). The
 *  books get the refund line, the order shows it, and the team hears if it couldn't be done. */
export async function refundAddressPayment(db: any, tenantId: string, orderId: string, sessionId: string, why: RefundWhy, o: { tenant?: any } = {}): Promise<{ ok: boolean; cents: number; already?: boolean; error?: string }> {
  const ref = orderRefOf(db, tenantId, orderId); const key = sidKey(sessionId); const now = new Date().toISOString();
  const claim: any = await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || {};
    const e = cur.addressPaid?.[key];
    if (!e) return { none: true };
    if (e.refundedAt) return { already: true, cents: Math.round(Number(e.cents) || 0) };
    // What it was before the first try is kept, so a refund that goes through on a later try still comes off the
    // running total of what customers paid for moves.
    tx.update(ref, { [`addressPaid.${key}`]: { ...e, state: 'refunding', wasState: e.wasState || (['refunding', 'refund_failed'].includes(String(e.state)) ? null : e.state) || null, refundWhy: why, refundTriedAt: now }, addressPaidRetry: true });
    return { e, cur };
  });
  if (claim.none) return { ok: false, cents: 0, error: 'That payment isn’t on this order.' };
  if (claim.already) return { ok: true, cents: claim.cents, already: true };
  const e = claim.e; const cents = Math.round(Number(e.cents) || 0);
  const tenant = o.tenant || ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const r0: any = e.pi && cents > 0 ? await refundAmount(accountOf(tenant), String(e.pi), cents, `addrpay-refund-${key}`) : { ok: false, error: 'There’s no card payment to refund.' };
  // Already refunded in Stripe by hand: the money went back, so it's written down as refunded.
  const outside = !r0.ok && r0.code === 'charge_already_refunded';
  const r = outside ? { ok: true } : r0;
  const tries = (Number(e.refundTries) || 0) + (r.ok ? 0 : 1);
  const gaveUp = !r.ok && tries >= REFUND_TRIES;
  const done = new Date().toISOString();
  await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || {};
    const cE = cur.addressPaid?.[key] || e;
    const map = { ...(cur.addressPaid || {}), [key]: { ...cE, state: r.ok ? 'refunded' : 'refund_failed', refundTries: tries, ...(r.ok ? { refundedAt: done, ...(outside ? { refundedOutside: true } : {}) } : { refundError: String((r as any).error || 'The refund didn’t go through.').slice(0, 200), ...(gaveUp ? { gaveUp: true } : {}) }), refundWhy: why } };
    const vals = Object.values<any>(map);
    // A payment that counted toward what the customer paid for the moves no longer does once it's refunded, so the
    // policy screen's running total never includes money given back; a cancelled order ships nowhere, so it costs the
    // shop nothing either.
    // (Applied: it says so, or — a try that stopped before it could say — it's the payment the moves' cost names.)
    const counted = r.ok && !!cur.addressCost && typeof cur.addressCost === 'object' && ((e.wasState || e.state) === 'applied'
      || (!!e.pi && String(cur.addressCost.paymentIntentId || '') === String(e.pi) && String(cur.addressCost.sessionId || '') === String(sessionId)));
    const costFix = counted || (r.ok && String(cur.stage || '') === 'cancelled' && cur.addressCost) ? { addressCost: { ...cur.addressCost,
      ...(counted ? { customerCents: Math.max(0, Math.round(Number(cur.addressCost.customerCents) || 0) - cents), refundedCents: Math.max(0, Math.round(Number(cur.addressCost.refundedCents) || 0)) + cents } : {}),
      ...(String(cur.stage || '') === 'cancelled' ? { shopCents: 0 } : counted ? { shopCents: Math.max(0, Math.round(Number(cur.addressCost.extraCents) || 0) - Math.max(0, Math.round(Number(cur.addressCost.customerCents) || 0) - cents)) } : {}) } } : {};
    tx.update(ref, { addressPaid: map, addressPaidOpen: vals.some((x) => !x.refundedAt), addressPaidRetry: vals.some((x) => !x.refundedAt && !x.gaveUp && ['refunding', 'refund_failed', 'replaced'].includes(String(x.state))), ...costFix,
      ...(cur.addressPay?.sessionId === sessionId ? { addressPay: { ...cur.addressPay, status: r.ok ? 'refunded' : 'refund_failed', refundWhy: why, endedAt: done } } : {}),
      ...(r.ok ? { addressPayLog: { ...(cur.addressPayLog || {}), [key]: { status: 'refunded', at: done, why } } } : {}) });
  });
  const order: any = ((await ref.get()).data() as any) || {};
  if (r.ok) await writeRefund(db, tenantId, orderId, order, cents, key, whyWords(why)).catch(() => {});
  else if (tries === 1 || gaveUp) {
    // The team hears the first time it fails, and once more if it still hasn't gone through after an hour of tries.
    const n = db.collection(`tenants/${tenantId}/notifications`).doc();
    await n.set({ id: n.id, type: 'order_refund_due', read: false, createdAt: done, link: `/retail-orders?order=${orderId}`,
      message: gaveUp
        ? `The ${money(cents)} ${order.customerName || 'a customer'} paid to change the address on order ${num(order)} still couldn’t be refunded automatically (${whyWords(why)}). Please refund it in Stripe.`
        : `${order.customerName || 'A customer'} paid ${money(cents)} to change the address on order ${num(order)}, and it needs refunding (${whyWords(why)}), but the automatic refund didn’t go through. It’s tried again every few minutes; if it keeps failing, you’ll be told to refund it in Stripe.` }).catch(() => {});
  }
  return { ok: r.ok, cents, ...(r.ok ? {} : { error: (r as any).error }) };
}

/** EVERY FIVE MINUTES (cron/retail-payments): payments for a new address nobody came back from; a cancelled order's
 *  address payments (refunded); and refunds that failed or stopped part way (tried again). */
export async function sweepAddressPays(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<number> {
  const now = o.now ?? Date.now(); let n = 0;
  const T = `tenants/${tenantId}/retailOrders`;
  const snap = await db.collection(T).where('addressPay.status', '==', 'awaiting_payment').limit(30).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) {
    const ap: any = (d.data() || {}).addressPay || {};
    const age = now - (Date.parse(String(ap.at || '')) || now);
    if (age < 2 * 60000) continue;
    const f = await finishAddressPay(db, tenantId, d.id, String(ap.sessionId || ''), { stripe: o.stripe, tenant });
    if (f.result === 'pending' && age > 2 * 3600e3) { await cancelAddressPay(db, tenantId, d.id, { stripe: o.stripe, tenant }); }
    n++;
  }
  // A cancelled order: whatever was paid for a new address goes back (the order's own refund doesn't include it).
  const cancelled = await db.collection(T).where('addressPaidOpen', '==', true).where('stage', '==', 'cancelled').limit(30).get().catch(() => ({ docs: [] as any[] }));
  for (const d of cancelled.docs) {
    for (const [sid, e] of Object.entries<any>((d.data() || {}).addressPaid || {})) {
      if (e?.refundedAt || e?.gaveUp || e?.state === 'refund_failed') continue;   // a failed one is tried again below
      if (e?.state === 'refunding' && now - (Date.parse(String(e.refundTriedAt || '')) || 0) < 10 * 60000) continue;   // another refund is on it
      await refundAddressPayment(db, tenantId, d.id, sid, 'cancelled', { tenant }).catch(() => null); n++;
    }
  }
  // A refund that didn't go through, or stopped part way: tried again (Stripe never refunds the same payment twice).
  const retry = await db.collection(T).where('addressPaidRetry', '==', true).limit(30).get().catch(() => ({ docs: [] as any[] }));
  for (const d of retry.docs) {
    let left = false;
    for (const [sid, e] of Object.entries<any>((d.data() || {}).addressPaid || {})) {
      // A page paid after a later one replaced it (or a paid request another change replaced) is refunded too.
      if (e?.refundedAt || e?.gaveUp || !['refunding', 'refund_failed', 'replaced'].includes(String(e?.state))) continue;
      if (e.state === 'refunding' && now - (Date.parse(String(e.refundTriedAt || '')) || 0) < 10 * 60000) { left = true; continue; }
      const r = await refundAddressPayment(db, tenantId, d.id, sid, e.state === 'replaced' ? 'replaced' : e.refundWhy || 'gone_out', { tenant }).catch(() => ({ ok: false }));
      if (!r.ok) left = true; n++;
    }
    if (!left) await d.ref.update({ addressPaidRetry: false }).catch(() => {});
  }
  return n;
}

/** Write a payment on the order once, by its Stripe page, before anything is done with it. */
async function recordPaid(db: any, tenantId: string, orderId: string, order: any, sessionId: string, cents: number, pi: string | null, state: string) {
  const ref = orderRefOf(db, tenantId, orderId); const key = sidKey(sessionId); const now = new Date().toISOString();
  await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(ref)).data() as any) || {};
    if (cur.addressPaid?.[key]) return;
    tx.update(ref, { addressPaid: { ...(cur.addressPaid || {}), [key]: { cents, pi, at: now, state } }, addressPaidOpen: true, ...(state === 'replaced' ? { addressPaidRetry: true } : {}) }); });
  await writeIncome(db, tenantId, orderId, order, cents, pi, sessionId).catch(() => {});
}

function whyWords(why: RefundWhy | string): string {
  return why === 'cancelled' ? 'the order was cancelled' : why === 'off' ? 'the shop isn’t taking address changes online' : why === 'kept' ? 'the address was kept'
    : why === 'replaced' ? 'a later payment replaced it' : 'it had already gone out';
}

function refundedWords(c: string, why: any, done: boolean): string {
  const back = done ? `your ${c} was refunded to your card` : `the shop will refund your ${c}`;
  if (why === 'cancelled') return `Your order was cancelled, so ${back}.`;
  if (why === 'off') return `The address can’t be changed online any more, so ${back}. Send the shop a message on this page if it still needs changing.`;
  if (why === 'kept') return `The shop kept the original address, so ${back}.`;
  if (why === 'replaced') return `You’d already started another payment for a new address, so ${back}.`;
  return `Your order had already gone out, so the address couldn’t change and ${back}.`;
}

function said(ap: any): FinishResult {
  const c = money(ap?.paidCents || ap?.cents);
  switch (ap?.status) {
    case 'applied': return { ok: true, result: 'applied', message: `Paid ${c}. Your order will ship to ${oneLine(ap.to)}.` };
    case 'requested': return { ok: true, result: 'requested', message: `Paid ${c}. ${ap.why === 'label' ? 'The label was printed while you were paying, so the new address has gone to the shop.' : ap.why === 'packing' ? 'Packing started while you were paying, so the new address has gone to the shop.' : 'The new address has gone to the shop to confirm.'} If they can’t change it, the ${c} is refunded.` };
    case 'refunded': return { ok: true, result: 'refunded', message: refundedWords(c, ap.refundWhy, true) };
    case 'refund_failed': case 'refunding': return { ok: true, result: 'refund_failed', message: refundedWords(c, ap.refundWhy, false) };
    case 'expired': return { ok: false, result: 'expired', message: 'The payment wasn’t finished, so the address stayed the same.' };
    case 'cancelled': return { ok: true, result: 'cancelled', message: 'No problem. Your order still ships to the address you have.' };
    default: return { ok: false, result: 'pending', message: 'We’re still waiting to hear the payment went through.' };
  }
}
/** What happened to a payment written on the order (one that isn't the order's current payment page any more). */
function saidPaid(e: any): FinishResult {
  const c = money(e?.cents);
  if (e?.refundedAt) return { ok: true, result: 'refunded', message: refundedWords(c, e.refundWhy, true) };
  if (['refunding', 'refund_failed'].includes(String(e?.state))) return { ok: true, result: 'refund_failed', message: refundedWords(c, e.refundWhy, false) };
  if (e?.state === 'replaced') return { ok: true, result: 'refund_failed', message: refundedWords(c, 'replaced', false) };
  if (e?.state === 'requested') return { ok: true, result: 'requested', message: `Paid ${c}. The new address has gone to the shop to confirm. If they can’t change it, the ${c} is refunded.` };
  return { ok: true, result: 'applied', message: `Paid ${c}. The new address is on your order.` };
}

async function writeIncome(db: any, tenantId: string, orderId: string, order: any, cents: number, pi: string | null, sessionId: string) {
  const ref = db.doc(`tenants/${tenantId}/transactions/addrship_${sidKey(sessionId)}`);
  await ref.create({ id: ref.id, date: new Date().toISOString(), description: `Shipping to a new address — Order ${num(order)}`, clientOrVendor: order.customerName || 'Guest',
    type: 'income', context: 'Business', category: 'Retail', taxBucket: 'revenue', amount: cents / 100, shippingCollected: cents / 100, paymentMethod: 'Online Checkout', hasReceipt: true,
    retailOrderId: orderId, ...(pi ? { stripePaymentIntentId: pi } : {}), addressChangeSessionId: sessionId, tenantId }).catch(() => {});
}

export async function writeRefund(db: any, tenantId: string, orderId: string, order: any, cents: number, key: string, why: string) {
  const ref = db.doc(`tenants/${tenantId}/transactions/addrshiprefund_${String(key).replace(/[^A-Za-z0-9_]/g, '')}`);
  await ref.create({ id: ref.id, date: new Date().toISOString(), description: `Refund of shipping to a new address (${why}) — Order ${num(order)}`, clientOrVendor: order.customerName || 'Guest',
    type: 'expense', context: 'Business', category: 'Refund', taxBucket: 'refund', amount: cents / 100, paymentMethod: 'Card (Online)', hasReceipt: true, retailOrderId: orderId, tenantId }).catch(() => {});
}
