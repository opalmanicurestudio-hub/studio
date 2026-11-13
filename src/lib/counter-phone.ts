// src/lib/counter-phone.ts — SCAN TO PAY AT THE DRIVE-THRU (server; api/counter 'phoneLink' and 'phoneCheck', the guest's
// own page through api/counter/pay, and the payment notice, lib/connect-webhook). The lane (the phone walking the line,
// or the window) shows a code; the guest scans it and pays the order's total on their own phone (card, Apple Pay or
// Google Pay, on the card company's own secure form: nothing about the card touches the business's screens).
//   The link is signed for that one order (it can't be guessed or changed to another order's) and works while the order
//   is with the kitchen and not yet paid, for 3 hours at most. The order keeps its one phone payment (made under a key
//   named after the order and the try, so opening the page again never makes a second); its amount is always the
//   order's total, worked out on the server.
//   Paid: the order is paid by it in one step, whichever hears first (the guest's page, the lane asking, or the payment
//   notice). Paid on the phone after the order was paid another way, it goes back to the guest's card (lib/counter-card
//   giveBack), and managers are told. Cash taken while the page is open calls the phone payment off.
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { accountOf, readerStripe } from '@/lib/reader-sale';
import { payOrder, cleanName } from '@/lib/counter-server';
import { giveBack } from '@/lib/counter-card';
import { photoOf } from '@/lib/counter-orders';
import { ensureWalletDomainsSoon, walletsOn } from '@/lib/wallet-domains';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const LINK_HOURS = 3;
const secret = () => String(process.env.ORDER_TRACK_SECRET || process.env.RETAIL_QR_SECRET || process.env.CRON_SECRET || '');
const nowIso = () => new Date().toISOString();
const centsOf = (n: unknown) => Math.round((Number(n) || 0) * 100);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const payKey = (tenantId: string, orderId: string, attempt: number) => `counter-phone-${createHash('sha256').update(`${tenantId}/${orderId}`).digest('hex').slice(0, 40)}-${attempt}`;
const orderRefOf = (db: any, tenantId: string, orderId: string) => db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
type Fail = { ok: false; error: string; status: number; code?: string };
/** A phone payment made after the order was paid another way. */
export const NOT_KEPT = 'This order was already paid another way, so your card payment is going back to your card. It can take a few days to show.';
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });

/** The signature on one order's pay link (none when the server has no secret to sign with). */
export function phoneSig(tenantId: string, orderId: string): string | null {
  const s = secret(); if (!s) return null;
  return createHmac('sha256', s).update(`dtpay:${tenantId}:${orderId}`).digest('base64url').slice(0, 32);
}
export function phoneSigOk(tenantId: string, orderId: string, sig: unknown): boolean {
  const want = phoneSig(tenantId, orderId); const got = String(sig || '');
  if (!want || got.length !== want.length) return false;
  try { return timingSafeEqual(Buffer.from(want), Buffer.from(got)); } catch { return false; }
}
const fresh = (o: any, now = Date.now()) => now - (Date.parse(String(o?.createdAt || '')) || 0) < LINK_HOURS * 3600000;
/** The order's phone payment marked, only while it's still that payment (an older one settled late changes nothing). */
const markPhone = (db: any, ref: any, piId: string, state: 'paid' | 'stopped', extra: Record<string, any> = {}) => db.runTransaction(async (tx: any) => {
  const x: any = (await tx.get(ref)).data(); if (!x) return;
  tx.set(ref, { ...(String(x.phone?.id || '') === piId ? { phone: { state } } : {}), ...extra }, { merge: true });
});
const payable = (o: any, now = Date.now()) => !!o && (o.status === 'sent' || o.status === 'done') && !o.paidAt && now - (Date.parse(String(o.createdAt || '')) || 0) < LINK_HOURS * 3600000;

/** The link the guest scans, for this order: shown on the lane (and on the window screen, for the next 10 minutes). */
export async function phoneLink(db: any, tenantId: string, tenant: any, orderId: string, origin: string, by: string, o: { stripe?: any } = {}): Promise<{ ok: true; url: string; wallets: boolean } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  if (!accountOf(tenant) || !process.env.STRIPE_SECRET_KEY) return fail('Card payments aren’t set up for this business yet.', 409, 'no_payments');
  const sig = phoneSig(tenantId, orderId); if (!sig) return fail('Scan to pay isn’t set up on the server yet.', 409, 'no_secret');
  const ref = orderRefOf(db, tenantId, orderId);
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return fail('That order is gone.', 404);
    if (o.paidAt) return fail('That order is paid already.', 409, 'paid');
    if (o.status !== 'sent' && o.status !== 'done') return fail(o.status === 'voided' ? 'That order was voided.' : 'Send the order to the kitchen first.', 409);
    if (centsOf(o.total) < 50) return fail('Card payments start at $0.50. Take this one in cash.', 409, 'too_small');
    tx.set(ref, { phone: { ...(o.phone || {}), shownAt: nowIso(), shownBy: by } }, { merge: true });
    return { ok: true };
  });
  if (!r.ok) return r;
  // Apple Pay and Google Pay on the guest's page: the address registered first, if it isn't yet (a few seconds at most).
  await ensureWalletDomainsSoon(db, tenantId, tenant, origin, 3000, o);
  return { ok: true, url: `${origin.replace(/\/+$/, '')}/drive-thru/${encodeURIComponent(tenantId)}/pay?o=${encodeURIComponent(orderId)}&s=${sig}`, wallets: walletsOn(tenant, origin) };
}

/** The guest's page: the order and its total, and the secure form's key for this order's one phone payment. */
export async function phoneView(db: any, tenantId: string, orderId: string, sig: unknown, o: { stripe?: any } = {}): Promise<any> {
  if (!ID.test(tenantId) || !ID.test(orderId) || !phoneSigOk(tenantId, orderId, sig)) return fail('This link doesn’t work. Ask at the window for a new one.', 404);
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  const ref = orderRefOf(db, tenantId, orderId);
  const or: any = (await ref.get()).data(); if (!or) return fail('This order isn’t here any more.', 404);
  const business = String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Drive-thru';
  const summary = { business, number: String(or.number || ''), name: cleanName(or.guestName) || null,
    lines: (or.lines || []).map((l: any) => ({ name: String(l.name || ''), quantity: num(l.quantity), choicesText: l.choicesText || null, price: Math.round(num(l.unitPrice) * num(l.quantity) * 100) / 100, imageUrl: photoOf(l) })),
    subtotal: num(or.subtotal), tax: num(or.tax), total: num(or.total) };
  // Paid: says so while the link would still work (after that, the guest's name and order aren't shown to anyone).
  if (or.paidAt) return fresh(or) ? { ok: true, paid: true, ...summary } : fail('This link has expired.', 410);
  if (!payable(or)) return fail(or.status === 'voided' ? 'This order was canceled.' : 'This link has expired. Ask at the window.', 410);
  if (!acct || !stripe || !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) return fail('Card payments aren’t set up here yet. Pay at the window.', 409);
  const cents = centsOf(or.total);
  for (let round = 0; round < 7; round++) {
    const claim: any = await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(ref)).data(); if (!x) return { gone: true };
      if (x.paidAt) return { paid: true };
      const p: any = x.phone || {};
      if (p.id && Math.round(num(p.cents)) === cents && p.state !== 'stopped') return { reuse: String(p.id) };
      // Opened twice at once (a double scan): the other one is making it; wait for it rather than make another.
      if (!p.id && p.state === 'starting' && Date.now() - (Date.parse(String(p.at || '')) || 0) < 4000) return { wait: true };
      const attempt = Math.max(0, Math.floor(num(p.attempt))) + 1;
      tx.set(ref, { phone: { ...p, attempt, id: null, cents, state: 'starting', at: nowIso() } }, { merge: true });
      return { attempt };
    });
    if (claim.gone) return fail('This order isn’t here any more.', 404);
    if (claim.paid) return { ok: true, paid: true, ...summary };
    if (claim.wait) { await new Promise((r) => setTimeout(r, 800)); continue; }
    let pi: any = null;
    if (claim.reuse) {
      // Not reachable just now: never a second payment while the first may still be open on someone's phone.
      try { pi = await stripe.paymentIntents.retrieve(claim.reuse, {}, { stripeAccount: acct }); } catch { return fail('We couldn’t reach card payments just now. Try again in a moment.', 503); }
      if (pi?.status === 'succeeded') {
        const s: any = await settlePhone(db, tenantId, tenant, orderId, pi.id, { stripe });
        if (s.ok && s.paid) return { ok: true, paid: true, ...summary };
        if (s.ok && s.notKept) return fail(NOT_KEPT, 409);
        return fail('Your payment is still being confirmed. Show this screen at the window.', 503);
      }
      if (pi.status === 'processing') return fail('Your payment is still going through. Show this screen at the window.', 409);
      // Called off, or (never expected: a sent order's total can't change) not the total any more: a new one, once the
      // old one can't be paid.
      if (pi.status !== 'canceled' && Math.round(num(pi.amount)) !== cents) {
        try { await stripe.paymentIntents.cancel(pi.id, {}, { stripeAccount: acct }); } catch { return fail('We couldn’t reach card payments just now. Try again in a moment.', 503); }
      }
      if (pi.status === 'canceled' || Math.round(num(pi.amount)) !== cents) { await ref.set({ phone: { id: null, state: 'stopped' } }, { merge: true }); continue; }
    } else {
      try {
        pi = await stripe.paymentIntents.create({
          amount: cents, currency: 'usd',
          // Cards and the phone's wallet, paid right there: nothing that sends the guest off to another site.
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          description: `Drive-thru order ${or.number}`,
          metadata: { tenantId, source: 'drive_thru_phone', kind: 'counter', orderId, attempt: String(claim.attempt) },
        }, { stripeAccount: acct, idempotencyKey: payKey(tenantId, orderId, claim.attempt) });
      } catch { await ref.set({ phone: { state: 'stopped' } }, { merge: true }); return fail('Paying by phone isn’t working right now. Pay at the window.', 503); }
      // Still this try (not paid, or opened again elsewhere, meanwhile): it's the order's phone payment.
      const kept: any = await db.runTransaction(async (tx: any) => {
        const x: any = (await tx.get(ref)).data() || {};
        if (x.paidAt || Math.floor(num(x.phone?.attempt)) !== claim.attempt || x.phone?.id) return false;
        // On the sweep's list (lib/counter-card) until it's paid, called off or given back.
        tx.set(ref, { phone: { ...(x.phone || {}), id: pi.id, state: 'open', at: nowIso() }, cardOpen: true }, { merge: true }); return true;
      });
      if (!kept) { try { await stripe.paymentIntents.cancel(pi.id, {}, { stripeAccount: acct }); } catch { /* never confirmed: it charges nothing */ } continue; }
    }
    // (Only the business's own addresses: never the one a guest's request says it came from.)
    await ensureWalletDomainsSoon(db, tenantId, tenant, null, 2500, { stripe });
    return { ok: true, paid: false, ...summary, clientSecret: pi.client_secret, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, stripeAccount: acct };
  }
  return fail('Paying by phone isn’t working right now. Pay at the window.', 503);
}

/** A phone payment the card company says went through: the order is paid by it, once. Paid another way first, it goes
 *  back to the guest's card. `pending`: not through yet. */
export async function settlePhone(db: any, tenantId: string, tenant: any, orderId: string, piId: string, o: { stripe?: any } = {}): Promise<{ ok: true; paid: boolean; pending?: boolean; notKept?: boolean; canceled?: boolean } | Fail> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe || !ID.test(orderId)) return fail('Card payments aren’t set up for this business yet.', 409);
  let pi: any;
  try { pi = await stripe.paymentIntents.retrieve(String(piId), {}, { stripeAccount: acct }); } catch { return fail('We couldn’t reach card payments just now. Try again in a moment.', 503); }
  if (String(pi?.metadata?.tenantId || '') !== tenantId || String(pi?.metadata?.orderId || '') !== orderId || pi?.metadata?.source !== 'drive_thru_phone') return fail('That payment isn’t for this order.', 409);
  const ref = orderRefOf(db, tenantId, orderId);
  // Called off (paid another way, or its link ran out): nothing was charged.
  if (pi.status === 'canceled') { await markPhone(db, ref, pi.id, 'stopped'); return { ok: true, paid: false, canceled: true }; }
  if (pi.status !== 'succeeded') return { ok: true, paid: false, pending: true };
  const r: any = await payOrder(db, tenantId, orderId, { method: 'card', by: 'Paid on their phone', card: { id: pi.id, cents: Math.round(num(pi.amount)) } });
  if (r.ok && !r.paidOtherwise) {
    await markPhone(db, ref, pi.id, 'paid', { paidVia: 'phone' });
    // A card the reader was asking for meanwhile is called off (or given back, if it went through at that moment).
    if (r.cardId) { const { stopCard } = await import('@/lib/counter-card'); await stopCard(db, tenantId, tenant, orderId, 'Paid on their phone', { stripe }).catch(() => null); }
    return { ok: true, paid: true };
  }
  // Paid another way first, voided, or (never expected: a sent order's total can't change) not the order's total: it goes
  // back to their card.
  if (r.paidOtherwise || (r.status === 409 && /voided|total/i.test(String(r.error)))) {
    const or: any = (await ref.get()).data() || {};
    // Given back already (asked again by the page, the lane or the notice): once.
    if (or.cardBack?.[pi.id]?.refunded !== true) await giveBack(db, stripe, acct, tenantId, orderId, pi, String(or.number || ''));
    await markPhone(db, ref, pi.id, 'stopped');
    return { ok: true, paid: false, notKept: true };
  }
  return fail(r.error || 'That didn’t go through. Try again.', r.status || 500);
}

/** The lane asking how the order's phone payment is going (while its code is on screen). */
export async function checkPhone(db: any, tenantId: string, tenant: any, orderId: string, o: { stripe?: any } = {}) {
  const or: any = (await orderRefOf(db, tenantId, orderId).get()).data();
  if (!or) return fail('That order is gone.', 404);
  if (or.paidAt) return { ok: true as const, paid: true, payMethod: or.payMethod || null, viaPhone: or.paidVia === 'phone' };
  const id = or.phone?.id; if (!id) return { ok: true as const, paid: false };
  const s: any = await settlePhone(db, tenantId, tenant, orderId, id, o);
  return s.ok ? { ok: true as const, paid: !!s.paid, viaPhone: !!s.paid } : s;
}

/** The order was paid another way: an open phone payment is called off, so it can't be paid as well (if the guest paid
 *  at that very moment, it goes back to their card). */
export async function stopPhone(db: any, tenantId: string, tenant: any, orderId: string, o: { stripe?: any } = {}) {
  const or: any = (await orderRefOf(db, tenantId, orderId).get()).data();
  const id = or?.phone?.id; if (!id || or.phone?.state === 'paid' || or.phone?.state === 'stopped') return;
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe(); if (!acct || !stripe) return;
  try { await stripe.paymentIntents.cancel(String(id), {}, { stripeAccount: acct }); await orderRefOf(db, tenantId, orderId).set({ phone: { state: 'stopped' } }, { merge: true }); }
  // It went through at that moment (settled: paid by it, or given back), or it was called off already (marked stopped).
  catch { await settlePhone(db, tenantId, tenant, orderId, String(id), { stripe }).catch(() => null); }
}
