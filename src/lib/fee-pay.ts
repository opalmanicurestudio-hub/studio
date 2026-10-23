// src/lib/fee-pay.ts — PAYING FEES WHEN THE CLIENT ISN'T AT THE COUNTER (server).
//   chargeFeesNow   — the front desk charges the card on file for chosen fees (approval rules checked by the route)
//   feePayLink      — a secure Stripe link for exactly those fees, texted / emailed to the client
//   settleFeesPaid  — what happens once a payment for fees arrives (any way): each fee still owed comes off their list
//                     and balance, is recorded in the books like any fee payment, and a full receipt is made — once
//                     only, however many times it's called (a link opened twice, a webhook retried). Money that arrives
//                     for fees already paid another way meanwhile is recorded too, and refunded to the card it came
//                     from; when that refund can't go through, a manager is asked to send it. It is never dropped.
// ONE LOCK FOR EVERY WAY OF PAYING A FEE. While a card payment for a fee is going through, the fee carries its claim:
// when (collectingAt) and which payment (collectingKey — the payment's record in feeCharges, named after the key Stripe
// gets). Automatic collection (lib/fee-collection), the desk's Charge card and a whole-balance payment
// (api/portal/pay-balance) claim their fees first, in one step, so two of them can never take the same fee at once, and
// cash recorded at the desk (api/clients/balance) waits while one is going through.
// A claim left behind (a run cut off between charging the card and recording it, or no answer from Stripe) is settled
// by asking Stripe for the payment made under it: one that went through is recorded, never charged again.
// A pay link can't hold its fees for the day it's open: it marks them (payLinkUntil) so automatic collection leaves
// them alone meanwhile, and it's closed when they're paid another way.
import crypto from 'crypto';
import Stripe from 'stripe';

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const stripeFor = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }) as any;
const plain = (r: any) => String(r || 'Fee').replace(/\s*[—–-]\s*(auto-charge failed|card declined|no card on file|payments not connected).*$/i, '').slice(0, 120);
const safe = (s: any, n = 120) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, n);
const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const centsOf = (f: any) => Math.round(num(f?.feeAmount) * 100);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** How long one payment's claim keeps every other way of paying from its fees. Older: it's checked with Stripe. */
export const FEE_CLAIM_MS = 2 * 60000;
export const NO_ANSWER = 'Stripe didn’t answer, so the charge may or may not have gone through. Try again in a couple of minutes: it won’t charge twice.';
/** Stripe said no: nothing moved. Anything else (no connection, Stripe's own error, a key still in use) may have gone through. */
export function stripeRefused(e: any): boolean {
  const code = String(e?.code || e?.raw?.code || '');
  if (code === 'idempotency_key_in_use' || String(e?.type || '') === 'StripeIdempotencyError') return false;
  return ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'].includes(String(e?.type || ''));
}
const claimedAt = (f: any) => Date.parse(String(f?.collectingAt || ''));
export const claimFresh = (f: any, now = Date.now()) => Number.isFinite(claimedAt(f)) && now - claimedAt(f) < FEE_CLAIM_MS;
export const claimStale = (f: any, now = Date.now()) => Number.isFinite(claimedAt(f)) && now - claimedAt(f) >= FEE_CLAIM_MS;
/** A pay link for this fee is still open (automatic collection leaves it alone until the link expires). */
export const linkOpen = (f: any, now = Date.now()) => Date.parse(String(f?.payLinkUntil || '')) > now;
const balanceClaim = (c: any) => (c?.balancePaying?.key ? { collectingAt: c.balancePaying.at } : null);
/** Something is being paid on this client's account right now, or a payment for it is waiting on Stripe's answer. */
export const paymentGoingThrough = (c: any) => (Array.isArray(c?.unpaidFees) ? c.unpaidFees : []).some((f: any) => Number.isFinite(claimedAt(f))) || !!balanceClaim(c);
export const anyStaleClaim = (c: any, now = Date.now()) => (Array.isArray(c?.unpaidFees) ? c.unpaidFees : []).some((f: any) => claimStale(f, now)) || claimStale(balanceClaim(c), now);
const unclaim = (f: any) => { const { collectingAt: _a, collectingKey: _k, ...rest } = f || {}; return rest; };

export type FeeClaim = { key: string; clientId: string; fees: { feeId: string; cents: number; reason: string; appointmentId: string | null; collectAttempts: number }[];
  cents: number; extraCents: number; customer: string; pm: string; source: 'desk' | 'collection' | 'balance'; client: any };

/** Claim fees for one card payment, in one step. `feeIds: 'all'` with source 'balance' is the whole balance on record
 *  (fees and any older balance that isn't a fee). The key is named after the fees, the amount and the card — the same
 *  whoever charges them — and changes only after Stripe said no to it (each fee counts its declines). */
export async function claimFees(db: any, tenantId: string, x: { clientId: string; feeIds: string[] | 'all'; source: FeeClaim['source']; by: string; skipLinked?: boolean; allowNoCard?: boolean; now?: number }):
  Promise<{ ok: true; claim: FeeClaim } | { ok: false; why: 'no_client' | 'paid' | 'busy' | 'stale' | 'no_card'; client?: any }> {
  const T = `tenants/${tenantId}`; const cRef = db.doc(`${T}/clients/${x.clientId}`);
  const now = x.now ?? Date.now(); const nowIso = new Date(now).toISOString(); const whole = x.source === 'balance';
  return db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(cRef)).data(); if (!c) return { ok: false, why: 'no_client' };
    const list: any[] = Array.isArray(c.unpaidFees) ? c.unpaidFees : [];
    let picked = list.filter((f) => centsOf(f) > 0 && (x.feeIds === 'all' || x.feeIds.includes(String(f.feeId))));
    if (x.skipLinked) picked = picked.filter((f) => !linkOpen(f, now));
    const bal = whole ? balanceClaim(c) : null;
    if (picked.some((f) => claimFresh(f, now)) || (bal && claimFresh(bal, now))) return { ok: false, why: 'busy', client: c };
    if (picked.some((f) => claimStale(f, now)) || (bal && claimStale(bal, now))) return { ok: false, why: 'stale', client: c };
    const feeCents = picked.reduce((n, f) => n + centsOf(f), 0);
    const cents = whole ? Math.round(num(c.outstandingBalance) * 100) : feeCents;
    if (!(cents > 0)) return { ok: false, why: 'paid', client: c };
    const card = c.cardOnFile || {}; const customer = String(card.customerId || ''); const pm = String(card.paymentMethodId || '');
    if ((!customer || !pm) && !x.allowNoCard) return { ok: false, why: 'no_card', client: c };
    const tries = picked.map((f) => `${f.feeId}:${Number(f.chargeTries) || 0}`).sort().join(',') + (whole ? `|balance:${Number(c.balanceTries) || 0}` : '');
    const key = `fees_${safe(x.clientId, 40)}_${sha(tries)}_${cents}_${safe(pm || 'nocard', 40)}`;
    const fees = picked.map((f) => ({ feeId: String(f.feeId), cents: centsOf(f), reason: plain(f.reason), appointmentId: f.appointmentId || null, collectAttempts: Number(f.collectAttempts) || 0 }));
    tx.set(db.doc(`${T}/feeCharges/${key}`), { id: key, tenantId, clientId: x.clientId, fees, cents, extraCents: cents - feeCents, customer, pm, source: x.source, by: x.by, at: nowIso, status: 'charging' });
    tx.update(cRef, { unpaidFees: list.map((f) => (picked.includes(f) ? { ...f, collectingAt: nowIso, collectingKey: key } : f)), ...(whole ? { balancePaying: { key, at: nowIso } } : {}) });
    return { ok: true, claim: { key, clientId: x.clientId, fees, cents, extraCents: cents - feeCents, customer, pm, source: x.source, client: c } };
  });
}

/** Let the fees go again: Stripe said no (each fee counts the decline, so the next try is a new charge), nothing reached
 *  Stripe, or the payment was finished another way. A claim whose payment is recorded as charged is never let go. */
export async function releaseFeeClaim(db: any, tenantId: string, claim: { key: string | null; clientId: string; feeIds?: string[] }, o: { declined?: boolean; why?: string; patch?: (f: any) => any; status?: string } = {}) {
  const T = `tenants/${tenantId}`; const cRef = db.doc(`${T}/clients/${claim.clientId}`); const chargeRef = claim.key ? db.doc(`${T}/feeCharges/${claim.key}`) : null;
  const mine = (f: any) => (claim.key ? f?.collectingKey === claim.key : !f?.collectingKey && Number.isFinite(claimedAt(f)) && (claim.feeIds || []).includes(String(f?.feeId)));
  await db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(cRef)).data(); const rec: any = chargeRef ? (await tx.get(chargeRef)).data() || null : null;
    if (rec?.status === 'charged') return;
    if (c) {
      const list: any[] = Array.isArray(c.unpaidFees) ? c.unpaidFees : [];
      const next = list.map((f) => (!mine(f) ? f : { ...unclaim(f), ...(o.declined ? { chargeTries: (Number(f.chargeTries) || 0) + 1 } : {}), ...(o.patch ? o.patch(f) : {}) }));
      const bal = claim.key && c.balancePaying?.key === claim.key;
      tx.update(cRef, { unpaidFees: next, ...(bal ? { balancePaying: null, ...(o.declined ? { balanceTries: (Number(c.balanceTries) || 0) + 1 } : {}) } : {}) });
    }
    if (rec) tx.set(chargeRef, { status: o.status || (o.declined ? 'declined' : 'released'), endedAt: new Date().toISOString(), ...(o.why ? { why: String(o.why).slice(0, 200) } : {}) }, { merge: true });
  });
}

/** Charge the card for a claim, under its key. Paid → settled at once; Stripe said no → the fees are let go; no answer →
 *  the claim stays, and the next try finds the payment at Stripe rather than charging again. */
export async function chargeClaimedFees(db: any, stripe: any, tenantId: string, tenant: any, claim: FeeClaim & { chargeCents?: number }, o: {
  description: string; metadata?: Record<string, string>; receiptEmail?: string | null; by: string; how: 'card_on_file' | 'collection' | 'balance'; brand?: string | null; last4?: string | null;
  declinedPatch?: (f: any, err: any) => any }): Promise<{ ok: true; intent: any; settled: Awaited<ReturnType<typeof settleFeesPaid>> } | { ok: false; declined: true; error: any } | { ok: false; unknown: true }> {
  const ids = claim.fees.map((f) => f.feeId); const cents = claim.chargeCents ?? claim.cents;
  const declined = async (err: any) => { await releaseFeeClaim(db, tenantId, claim, { declined: true, why: String(err?.code || err?.decline_code || err?.message || 'declined'), patch: o.declinedPatch ? (f) => o.declinedPatch!(f, err) : undefined }); return { ok: false as const, declined: true as const, error: err }; };
  let intent: any = null;
  try {
    intent = await stripe.paymentIntents.create({ amount: cents, currency: 'usd', customer: claim.customer, payment_method: claim.pm, off_session: true, confirm: true,
      description: o.description.slice(0, 300), ...(o.receiptEmail ? { receipt_email: o.receiptEmail } : {}),
      metadata: { ...(o.metadata || {}), tenantId, clientId: claim.clientId, feeIds: ids.join(',').slice(0, 500), feeCharge: claim.key } },
      { stripeAccount: tenant.stripeAccountId, idempotencyKey: claim.chargeCents != null ? `${claim.key}_${cents}` : claim.key });
  } catch (e: any) {
    if (!stripeRefused(e)) return { ok: false, unknown: true };
    return declined(e);
  }
  if (intent?.status === 'processing') return { ok: false, unknown: true };
  if (intent?.status !== 'succeeded') return declined({ code: intent?.status || 'not_completed', message: 'The charge didn’t complete.' });
  const lc: any = intent.latest_charge; const chargeId = lc ? (typeof lc === 'string' ? lc : lc.id || null) : null;
  const settled = await settleFeesPaid(db, tenantId, { clientId: claim.clientId, feeIds: ids, how: o.how, paymentIntentId: intent.id, by: o.by, brand: o.brand || null, last4: o.last4 || null,
    chargeKey: claim.key, fees: claim.fees, paidCents: cents, chargeId });
  return { ok: true, intent, settled };
}

/** Claims left behind on this client's fees (older than FEE_CLAIM_MS): each one's payment is looked up at Stripe — by
 *  the key it was charged under, or, for a claim from before keys were kept, by the fee it names. Went through →
 *  recorded now. Still going through → left. Nothing went through → the fees are free again. */
export async function resolveStaleFees(db: any, stripe: any, tenantId: string, tenant: any, clientId: string, now = Date.now()): Promise<{ unresolved: number }> {
  const T = `tenants/${tenantId}`; const c: any = (await db.doc(`${T}/clients/${clientId}`).get()).data(); if (!c) return { unresolved: 0 };
  const acct = tenant?.stripeAccountId || null; let unresolved = 0;
  const groups = new Map<string, { key: string | null; fees: any[]; at: number }>();
  for (const f of Array.isArray(c.unpaidFees) ? c.unpaidFees : []) if (claimStale(f, now)) {
    const k = f.collectingKey ? String(f.collectingKey) : `fee:${f.feeId}`; const g = groups.get(k) || { key: f.collectingKey ? String(f.collectingKey) : null, fees: [], at: claimedAt(f) };
    g.fees.push(f); groups.set(k, g);
  }
  const bal = balanceClaim(c); if (bal && claimStale(bal, now) && !groups.has(String(c.balancePaying.key))) groups.set(String(c.balancePaying.key), { key: String(c.balancePaying.key), fees: [], at: claimedAt(bal) });
  for (const g of groups.values()) {
    const rec: any = g.key ? (await db.doc(`${T}/feeCharges/${g.key}`).get()).data() || null : null;
    // A whole-balance claim paid only with gift cards has no card payment to find.
    if (rec && !rec.customer) { await releaseFeeClaim(db, tenantId, { key: g.key, clientId }); continue; }
    const customer = rec?.customer || c.cardOnFile?.customerId || null;
    if (!stripe || !acct || !customer) { unresolved++; continue; }
    let found: any[] = [];
    try {
      const since = Math.floor(((rec ? Date.parse(rec.at) : g.at) - 3600e3) / 1000);
      const l: any = await stripe.paymentIntents.list({ customer, created: { gte: since }, limit: 100 }, { stripeAccount: acct });
      found = (Array.isArray(l?.data) ? l.data : []).filter((p: any) => (g.key && rec ? String(p?.metadata?.feeCharge || '') === g.key
        : g.fees.some((f: any) => String(p?.metadata?.feeId || '') === String(f.feeId) || String(p?.metadata?.feeIds || '').split(',').includes(String(f.feeId)))));
    } catch { unresolved++; continue; }
    const paid = found.find((p: any) => p.status === 'succeeded');
    if (paid) {
      const how = rec?.source === 'balance' ? 'balance' : rec?.source === 'collection' || paid.metadata?.source === 'fee_collection' ? 'collection' : 'card_on_file';
      const ids: string[] = rec ? (rec.fees || []).map((f: any) => String(f.feeId)) : String(paid.metadata?.feeIds || paid.metadata?.feeId || '').split(',').filter(Boolean);
      const lc: any = paid.latest_charge;
      await settleFeesPaid(db, tenantId, { clientId, feeIds: ids, how, paymentIntentId: String(paid.id), by: rec?.by || 'Card on file', chargeKey: g.key, fees: rec?.fees,
        paidCents: Math.round(Number(paid.amount_received ?? paid.amount) || 0) || rec?.cents || null, chargeId: lc ? (typeof lc === 'string' ? lc : lc.id || null) : null });
      continue;
    }
    if (found.some((p: any) => ['processing', 'requires_capture'].includes(String(p.status)))) { unresolved++; continue; }
    // Nothing went through for it (a try Stripe declined counts as one).
    await releaseFeeClaim(db, tenantId, { key: g.key, clientId, feeIds: g.fees.map((f: any) => String(f.feeId)) }, { declined: found.length > 0 });
  }
  return { unresolved };
}

/** A payment for fees has arrived (card on file at the desk, automatic collection, a whole-balance payment, or a pay
 *  link). Recorded once, named after the payment. What it pays is what's still owed: the fees still on their list (and,
 *  for a whole-balance payment, what's on the balance now); money for anything already paid another way is recorded and
 *  sent back. `fees` / `paidCents` say what the payment was for and how much it was, when the caller knows. */
export async function settleFeesPaid(db: any, tenantId: string, x: { clientId: string; feeIds: string[]; how: 'card_on_file' | 'link' | 'collection' | 'balance'; paymentIntentId: string; by: string;
  brand?: string | null; last4?: string | null; chargeKey?: string | null; fees?: { feeId: string; cents: number; reason?: string }[] | null; paidCents?: number | null; chargeId?: string | null }) {
  const T = `tenants/${tenantId}`; const pi = safe(x.paymentIntentId); const cRef = db.doc(`${T}/clients/${x.clientId}`); const now = new Date().toISOString();
  const receiptRef = db.doc(`${T}/receipts/fees_${pi}`);   // one receipt per payment — a retry finds it
  const payRef = db.doc(`${T}/feePayments/${pi}`);          // what this payment paid for, and anything sent back
  const chargeRef = x.chargeKey ? db.doc(`${T}/feeCharges/${safe(x.chargeKey, 300)}`) : null;
  const whole = x.how === 'balance';
  let paid: any[] = []; let already = false; let keptCents = 0; let twice = false; let links: string[] = [];
  await db.runTransaction(async (tx: any) => {
    const p0 = await tx.get(payRef); const r0 = await tx.get(receiptRef); const cs = await tx.get(cRef); if (chargeRef) await tx.get(chargeRef);
    if (p0.exists || r0.exists) { already = true; return; }
    const c: any = cs.data() || {};
    const list: any[] = Array.isArray(c.unpaidFees) ? c.unpaidFees : [];
    paid = list.filter((f) => x.feeIds.includes(String(f.feeId)));
    const coveredCents = paid.reduce((n, f) => n + centsOf(f), 0);
    const goneIds = x.feeIds.filter((id) => !list.some((f) => String(f.feeId) === id));
    const owedNow = Math.round(num(c.outstandingBalance) * 100);
    // What this payment pays now, and what came in for something already paid (sent back below).
    let twiceCents: number | null = 0;
    if (whole) { const got = Math.round(num(x.paidCents)); keptCents = Math.min(got, owedNow); twiceCents = got - keptCents; }
    else {
      keptCents = coveredCents;
      if (goneIds.length) twiceCents = x.fees ? x.fees.filter((f) => goneIds.includes(String(f.feeId))).reduce((n, f) => n + Math.round(num(f.cents)), 0) : x.paidCents != null ? Math.max(0, Math.round(num(x.paidCents)) - coveredCents) : null;
    }
    twice = twiceCents !== 0;
    links = paid.flatMap((f) => (Array.isArray(f.payLinkSessions) ? f.payLinkSessions : [])).filter(Boolean);
    const isLink = x.how === 'link'; const method = isLink ? 'Payment link (Stripe)' : x.how === 'collection' ? 'Card on file (Stripe) — automatic' : x.how === 'balance' ? 'Card on File' : 'Card on file (Stripe) — front desk';
    const name = c.name || 'Client';
    if (cs.exists) tx.set(cRef, { unpaidFees: list.filter((f) => !paid.includes(f)), outstandingBalance: Math.max(0, owedNow - keptCents) / 100,
      ...(whole ? { balancePaying: null, ...(owedNow - keptCents <= 0 ? { balancePaidAt: now } : {}), balanceVersion: now } : {}) }, { merge: true });
    if (whole) {
      if (keptCents > 0) { const lineRef = db.doc(`${T}/transactions/balpay_${pi}`);
        tx.set(lineRef, { id: lineRef.id, tenantId, date: now, description: 'Balance paid online', clientOrVendor: c.name || null, clientId: x.clientId, type: 'income', context: 'Business', category: 'Fee Recovery',
          amount: keptCents / 100, paymentMethod: method, stripePaymentIntentId: x.paymentIntentId, stripeChargeId: x.chargeId || null, feeIds: paid.map((f) => String(f.feeId)), hasReceipt: false, createdAt: now }); }
    } else {
      const prefix = x.how === 'collection' ? 'collect' : 'feepay';
      for (const f of paid) {
        const id = `${prefix}_${safe(f.feeId)}`;
        tx.set(db.doc(`${T}/transactions/${id}`), { id, date: now, description: `${plain(f.reason)} — ${x.how === 'collection' ? 'collected automatically' : 'paid'}`, clientOrVendor: name, clientId: x.clientId,
          type: 'income', context: 'Business', category: 'Fees', taxBucket: 'revenue', amount: num(f.feeAmount), paymentMethod: method, appointmentId: f.appointmentId || null,
          stripePaymentIntentId: x.paymentIntentId, stripeChargeId: x.chargeId || null, feeId: f.feeId, receiptId: receiptRef.id, hasReceipt: true, tenantId, createdAt: now }, { merge: true });
      }
      if (paid.length) {
        const total = coveredCents / 100; const rid = () => Math.random().toString(36).slice(2, 10);
        tx.set(receiptRef, { id: receiptRef.id, date: now, clientId: x.clientId, clientName: c.name || null, paidBy: c.name || null, cashierName: x.by, paymentMethod: 'card', subtotal: total, tax: 0, tip: 0, discount: 0, total,
          stripePaymentIntentId: x.paymentIntentId, viewKey: `${rid()}${rid()}`, lineItems: paid.map((f) => ({ label: plain(f.reason), amount: num(f.feeAmount) })),
          detail: { number: receiptRef.id.slice(-6).toUpperCase(), lines: [], fees: paid.map((f) => ({ label: plain(f.reason), amount: num(f.feeAmount), date: f.appointmentDate || null })), tipShares: [],
            payments: [{ method: isLink ? 'card' : 'card_on_file', brand: x.brand || null, last4: x.last4 || null, amount: total, tip: 0 }], depositUsed: 0, storeCredit: 0, cardSurcharge: 0 },
          source: isLink ? 'fee_pay_link' : x.how === 'collection' ? 'fee_collection' : 'fee_card_on_file' });
      }
    }
    tx.set(payRef, { id: payRef.id, tenantId, clientId: x.clientId, how: x.how, paymentIntentId: x.paymentIntentId, feeIds: x.feeIds, settledFeeIds: paid.map((f) => String(f.feeId)), goneFeeIds: goneIds,
      keptCents, twiceCents, status: twice ? 'refunding' : 'settled', receiptId: paid.length && !whole ? receiptRef.id : null, chargeKey: x.chargeKey || null, at: now });
    if (twice) tx.set(db.doc(`${T}/chargeFlags/twice_${pi}`), { tenantId, clientId: x.clientId, appointmentId: null, amountDollars: twiceCents != null ? twiceCents / 100 : null, description: 'Paid twice', reason: 'Paid twice',
      failReason: `A card payment${twiceCents != null ? ` of ${money(twiceCents)}` : ''} came in for fees already paid another way. It is being refunded to the card.`, code: 'paid_twice', paymentIntentId: x.paymentIntentId, status: 'needs_attention', createdAt: now });
    if (chargeRef) tx.set(chargeRef, { status: 'charged', pi: x.paymentIntentId, chargedAt: now }, { merge: true });
  });
  // Money for something already paid goes back (also when this is asked again after that was cut off).
  if (twice || already) await refundPaidTwice(db, tenantId, x.paymentIntentId).catch((e) => console.error('[fee-pay] paid twice refund', e?.message));
  if (!already && links.length) await closePayLinks(db, tenantId, links);
  const paidCents = whole ? keptCents : Math.round(paid.reduce((n, f) => n + num(f.feeAmount), 0) * 100);
  if (!already && paid.length && x.how === 'link') { try { const { recordCharge } = await import('@/lib/charge-records'); await recordCharge(db, tenantId, { kind: 'fees_pay_link', clientId: x.clientId, cents: paidCents, reason: `Paid by link — ${paid.map((f) => plain(f.reason)).join(', ')}`, paymentIntentId: x.paymentIntentId, receiptId: receiptRef.id, by: x.by, needs: ['booking_policies'] }); } catch { /* fine */ } }
  return { already, paidCents, receiptId: receiptRef.id, fees: paid };
}

/** Money that came in for fees already paid: recorded as it came in, and refunded to the card (under one key for this
 *  payment, so asking again never refunds twice). When the refund can't go through, the flag stays for a manager. */
async function refundPaidTwice(db: any, tenantId: string, paymentIntentId: string) {
  const T = `tenants/${tenantId}`; const pi = safe(paymentIntentId); const payRef = db.doc(`${T}/feePayments/${pi}`); const flagRef = db.doc(`${T}/chargeFlags/twice_${pi}`);
  const p: any = (await payRef.get()).data(); if (!p || p.status !== 'refunding') return;
  const tenant: any = (await db.doc(T).get()).data() || {}; const acct = tenant.stripeAccountId || null;
  let cents: number | null = p.twiceCents ?? null;
  if (cents == null && acct && process.env.STRIPE_SECRET_KEY) {
    // A pay link's payment: how much came in is asked of Stripe; what it paid that was still owed stays.
    try { const intent: any = await stripeFor().paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: acct });
      cents = Math.max(0, Math.round(Number(intent?.amount_received ?? intent?.amount) || 0) - (Number(p.keptCents) || 0)); } catch { cents = null; }
  }
  if (cents === 0) { await payRef.set({ status: 'settled', twiceCents: 0 }, { merge: true }); await flagRef.set({ status: 'resolved', resolvedAt: new Date().toISOString() }, { merge: true }); return; }
  if (cents == null) { await flagRef.set({ failReason: 'A pay link payment came in for fees already paid another way. Check the payment and refund what was paid twice.' }, { merge: true }); return; }
  const now = new Date().toISOString(); const c: any = (await db.doc(`${T}/clients/${p.clientId}`).get()).data() || {};
  const inRef = db.doc(`${T}/transactions/feepay_twice_${pi}`);
  await inRef.set({ id: inRef.id, tenantId, date: now, description: 'Fees paid twice — refunded', clientOrVendor: c.name || 'Client', clientId: p.clientId, type: 'income', context: 'Business', category: 'Fees', taxBucket: 'revenue',
    amount: cents / 100, paymentMethod: 'Card (Stripe)', stripePaymentIntentId: paymentIntentId, feeIds: p.goneFeeIds || [], hasReceipt: false, createdAt: now }, { merge: true });
  const { refundAmount } = await import('@/lib/stripe-refund');
  const r = await refundAmount(acct, paymentIntentId, cents, `feepay_twice_${pi}`, { tenantId, clientId: String(p.clientId || ''), why: 'fees_already_paid' });
  if (!r.ok) { await flagRef.set({ amountDollars: cents / 100, failReason: `${money(cents)} came in for fees already paid another way, and the refund didn't go through. Refund it to the card.` }, { merge: true }); return; }
  const outRef = db.doc(`${T}/transactions/feepay_twice_refund_${pi}`);
  await outRef.set({ id: outRef.id, tenantId, date: now, description: 'Refund — fees paid twice', clientOrVendor: c.name || 'Client', clientId: p.clientId, type: 'expense', context: 'Business', category: 'Refunds',
    taxBucket: 'refund', refundKind: 'fee', amount: cents / 100, paymentMethod: 'Card (Stripe refund)', reversalOf: inRef.id, stripeRefundId: r.id || null, stripePaymentIntentId: paymentIntentId, hasReceipt: false, createdAt: now }, { merge: true });
  await payRef.set({ status: 'refunded', twiceCents: cents, refundId: r.id || null, refundedAt: now }, { merge: true });
  await flagRef.set({ status: 'resolved', resolvedAt: now, amountDollars: cents / 100, failReason: `${money(cents)} came in for fees already paid another way, and was refunded to the card.` }, { merge: true });
}

/** Pay links for fees now paid are closed, so the client can't pay them again (best effort: one paid anyway is refunded). */
async function closePayLinks(db: any, tenantId: string, sessions: string[]) {
  if (!process.env.STRIPE_SECRET_KEY) return;
  try {
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {}; if (!tenant.stripeAccountId) return;
    const s = stripeFor();
    for (const id of [...new Set(sessions)].slice(0, 10)) await s.checkout.sessions.expire(id, {}, { stripeAccount: tenant.stripeAccountId }).catch(() => null);
  } catch { /* a link paid anyway is refunded when it arrives */ }
}

/** Charge the card on file for these fees, now. Claimed first, so automatic collection (or another screen) can't take
 *  them at the same moment, and a charge whose answer went missing is found at Stripe instead of being made again. */
export async function chargeFeesNow(db: any, stripe: any, tenantId: string, tenant: any, x: { clientId: string; feeIds: string[]; by: string; approvedBy?: string | null }) {
  const ask = () => claimFees(db, tenantId, { clientId: x.clientId, feeIds: x.feeIds, source: 'desk', by: x.by });
  let cl = await ask();
  if (!cl.ok && cl.why === 'stale') { await resolveStaleFees(db, stripe, tenantId, tenant, x.clientId); cl = await ask(); }
  if (!cl.ok) return { ok: false, ...(cl.why === 'stale' ? { code: 'unconfirmed' } : {}),
    error: cl.why === 'no_client' ? 'Client not found.' : cl.why === 'paid' ? 'Those fees are already paid.' : cl.why === 'no_card' ? 'There’s no card on file for this client.'
      : cl.why === 'busy' ? 'Those fees are being charged right now. Check again in a couple of minutes.' : 'A charge for these fees is still waiting on Stripe’s answer. Try again in a couple of minutes: it won’t charge twice.' };
  const claim = cl.claim; const client = claim.client; const card = client.cardOnFile || {};
  const r = await chargeClaimedFees(db, stripe, tenantId, tenant, claim, { description: claim.fees.map((f) => f.reason).join(', '), receiptEmail: client.email || null,
    metadata: { kind: 'arrears_fee', source: 'front_desk_card_on_file' }, by: x.by, how: 'card_on_file', brand: card.brand || null, last4: card.last4 || null });
  if (!r.ok && 'unknown' in r) return { ok: false, code: 'unconfirmed', error: NO_ANSWER };
  if (!r.ok) {
    const code = String(r.error?.code || r.error?.decline_code || r.error?.raw?.decline_code || '');
    return { ok: false, error: /authentication_required/.test(code) ? 'Their bank needs them to approve it — text them a pay link instead.' : /insufficient_funds/.test(code) ? 'Declined — not enough funds.'
      : /expired/.test(code) ? 'Their card on file has expired.' : /requires_|canceled|not_completed/.test(code) ? 'The charge didn’t complete — nothing was taken.' : 'The card was declined.' };
  }
  // Paid another way in the same moment: this charge is refunded (settleFeesPaid), and the desk is told so.
  const kept = r.settled.already ? claim.cents : r.settled.paidCents;
  if (!(kept > 0)) return { ok: false, error: 'Those fees were paid another way just now, so this charge is being refunded to the card.' };
  const reasons = r.settled.fees.map((f: any) => plain(f.reason)).join(', ') || claim.fees.map((f) => f.reason).join(', ');
  if (!r.settled.already) {
    try { const { recordCharge } = await import('@/lib/charge-records'); await recordCharge(db, tenantId, { kind: 'fees_card_on_file', clientId: x.clientId, cents: kept, reason: `Charged at the front desk — ${reasons}`, paymentIntentId: r.intent.id, receiptId: r.settled.receiptId, by: x.by, approvedBy: x.approvedBy || null, needs: ['booking_policies', 'card_on_file'] }); } catch { /* fine */ }
    try { const { tellClient } = await import('@/lib/fee-collection'); await tellClient(db, tenantId, tenant, x.clientId, client, kept / 100, reasons); } catch { /* the charge stands */ }
  }
  return { ok: true, paidCents: kept, receiptId: r.settled.receiptId, card: card.last4 ? `${card.brand || 'Card'} ••${card.last4}` : 'their card on file' };
}

/** A secure link for exactly these fees (Stripe Checkout on the business's account). Paid → the webhook settles them.
 *  While it's open the fees are marked as the link's, so automatic collection leaves them alone; paid another way, the
 *  link is closed (and a payment through it anyway is refunded). */
export async function feePayLink(db: any, stripe: any, tenantId: string, tenant: any, x: { clientId: string; feeIds: string[]; origin: string }) {
  const cRef = db.doc(`tenants/${tenantId}/clients/${x.clientId}`);
  const c: any = (await cRef.get()).data(); if (!c) return { ok: false, error: 'Client not found.' };
  const fees = (Array.isArray(c.unpaidFees) ? c.unpaidFees : []).filter((f: any) => x.feeIds.includes(f.feeId) && centsOf(f) > 0);
  if (!fees.length) return { ok: false, error: 'Those fees are already paid.' };
  if (fees.some((f: any) => claimFresh(f))) return { ok: false, error: 'Those fees are being charged right now. Check again in a couple of minutes.' };
  const expiresAt = Math.floor(Date.now() / 1000) + 23 * 3600;
  const session = await stripe.checkout.sessions.create({ mode: 'payment', ...(c.email ? { customer_email: c.email } : {}),
    line_items: fees.map((f: any) => ({ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(num(f.feeAmount) * 100), product_data: { name: plain(f.reason) } } })),
    metadata: { type: 'fee_payment', tenantId, clientId: x.clientId, feeIds: fees.map((f: any) => f.feeId).join(',') },
    payment_intent_data: { metadata: { type: 'fee_payment', tenantId, clientId: x.clientId } },
    success_url: `${x.origin}/pay/thanks?b=${encodeURIComponent(tenant?.name || '')}`, cancel_url: `${x.origin}/pay/thanks?b=${encodeURIComponent(tenant?.name || '')}&c=1`,
    expires_at: expiresAt }, { stripeAccount: tenant.stripeAccountId });
  const ids = fees.map((f: any) => String(f.feeId)); const until = new Date(expiresAt * 1000).toISOString();
  const marked = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(cRef)).data() || {}; const list: any[] = Array.isArray(cur.unpaidFees) ? cur.unpaidFees : [];
    const still = list.filter((f) => ids.includes(String(f.feeId)));
    if (still.length) tx.update(cRef, { unpaidFees: list.map((f) => (!still.includes(f) ? f : { ...f, payLinkUntil: until, payLinkSessions: [...(Array.isArray(f.payLinkSessions) ? f.payLinkSessions : []), session.id].slice(-5) })) });
    return still.length;
  });
  if (!marked) { await stripe.checkout.sessions.expire(session.id, {}, { stripeAccount: tenant.stripeAccountId }).catch(() => null); return { ok: false, error: 'Those fees are already paid.' }; }
  return { ok: true, url: session.url as string, cents: Math.round(fees.reduce((n: number, f: any) => n + num(f.feeAmount), 0) * 100), client: c };
}

/** The business's rule for charging a saved card when the client isn't here (Settings → Fees & credit). */
export function cardChargeRule(tenant: any) {
  const r: any = tenant?.cardOnFileCharge || {}; const mode = ['off', 'manager', 'limit'].includes(r.mode) ? r.mode : 'manager';
  return { mode, limitCents: Math.max(0, Math.round(num(r.limitCents))) } as { mode: 'off' | 'manager' | 'limit'; limitCents: number };
}
