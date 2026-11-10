// src/lib/lounge-card.ts — A LOUNGE ORDER PAID WITH THE GUEST'S CARD ON FILE (server; api/concierge/requests).
// The station menu has no sign-in that may charge a card, so the order route charges it itself, before it writes the
// order. Between the two, something can stop (the database busy, a crash): the card is charged and there's no order.
// So each card order keeps a claim, named after the order (private/kiosk/cardOrders/{requestId}):
//   charging  → claimed in one step before the card is charged (with what the charge will be: guest, amount, key);
//   charged   → charged; the order is being written (the step that writes it checks the claim is still charged);
//   ordered   → the order is written, in the same step, paid by this very payment;
//   refunding → charged, but the order couldn't be written (or was made another way): the payment is going back;
//   refunded  → back on the card, with the refund in the books. Asking again under that order's name is told to start a
//               new order, so the refunded one is never charged again, and never served without paying;
//   declined / none → nothing was charged.
// While a claim is charging or charged, the same order can't switch to another way to pay (it may have been paid).
// The hourly sweep settles a claim left charging, charged or refunding for more than ten minutes: a charge that went
// through with no order of its own goes back; a refund that keeps failing is told to the owners.
import Stripe from 'stripe';
import { refundPaymentIntent } from '@/lib/stripe-refund';

export const CARD_ORDER_SETTLE_MS = 10 * 60000;
const NOTHING_AFTER_MS = 2 * 3600000;
const TELL_AFTER_TRIES = 3;
export const cardOrderRef = (db: any, tenantId: string, requestId: string) => db.doc(`tenants/${tenantId}/private/kiosk/cardOrders/${requestId}`);

/** A charged card order that has no order paid by it: refunded, with the refund in the books. 'ordered' when its order
 *  is there after all, 'refunded' when the money went back, 'failed' when the refund didn't go (left for the next
 *  sweep), 'none' when there's nothing to give back. Decided in one step with the order's own step, so an order can't be
 *  written for a payment that's being refunded. `known.piId`: the payment, when the claim never heard it was made. */
export async function settleCardOrder(db: any, tenantId: string, requestId: string, why: string, known: { piId?: string } = {}): Promise<'ordered' | 'refunded' | 'failed' | 'none'> {
  const T = `tenants/${tenantId}`; const ref = cardOrderRef(db, tenantId, requestId); const orderRef = db.doc(`${T}/refreshmentRequests/${requestId}`);
  const c: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || null; const order = await tx.get(orderRef);
    const piId = String(cur?.piId || known.piId || '');
    if (!cur || !piId || !['charging', 'charged', 'refunding'].includes(String(cur.status))) return null;
    const use: any = (await tx.get(db.doc(`${T}/private/kiosk/cardPayments/${piId.replace(/[^A-Za-z0-9_]/g, '')}`))).data() || null;
    if (order.exists && (order.data() || {}).stripePaymentIntentId === piId) { tx.set(ref, { status: 'ordered', piId }, { merge: true }); return { ordered: true }; }
    // Paying for another order (shouldn't happen: each order's charge has its own key): that order keeps it, and the
    // owners are told, rather than refunding a payment something was served for.
    if (use?.requestId && use.requestId !== requestId) { tx.set(ref, { status: 'none', piId, why: 'paid another order' }, { merge: true }); return { other: String(use.requestId), cur }; }
    tx.set(ref, { status: 'refunding', piId, refundingAt: new Date().toISOString(), why: String(why || '').slice(0, 120) }, { merge: true });
    return { ...cur, piId };
  });
  if (!c) return 'none';
  if (c.ordered) return 'ordered';
  if (c.other) { await tellOwners(db, tenantId, `loungeother_${requestId}`, `A ${money(Number(c.cur?.amountCents) || 0)} lounge card payment is on another order than the one it was taken for. Check it in Money.`); return 'none'; }
  // Under one key per payment, so trying again never refunds twice.
  const ok = await refundPaymentIntent(String(c.account || ''), String(c.piId));
  if (!ok) {
    // Counted in one step, so a sweep and a request failing together count twice, not once.
    const tries: number = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(ref)).data() || {}; const n = (Number(cur.refundTries) || 0) + 1; tx.set(ref, { refundTries: n, refundFailedAt: new Date().toISOString() }, { merge: true }); return n; }).catch(() => 0);
    if (tries === TELL_AFTER_TRIES) await tellOwners(db, tenantId, `loungerefund_${requestId}`, `A ${money(Number(c.amountCents) || 0)} lounge order paid with ${c.clientName || 'a guest'}’s saved card was never placed, and the card couldn’t be refunded automatically. Refund it from Money.`);
    return 'failed';
  }
  const now = new Date().toISOString();
  const line = db.doc(`${T}/transactions/loungerefund_${String(c.piId).replace(/[^A-Za-z0-9_]/g, '')}`);
  // Written whole each time (the same line), so a refund asked again never leaves the books without it; if it can't be
  // written, the claim stays refunding and the next sweep (the refund itself can't happen twice) writes it.
  await line.set({ id: line.id, date: now, description: `Refund: lounge order not placed (${String(c.item || 'item').slice(0, 60)})`, clientOrVendor: c.clientName || 'Guest',
    clientId: c.clientId || null, type: 'expense', context: 'Business', category: 'Refunds', taxBucket: 'refund', amount: (Number(c.amountCents) || 0) / 100, paymentMethod: 'Card on File (Stripe)',
    refundOfPaymentIntent: String(c.piId), hasReceipt: true, tenantId });
  await ref.set({ status: 'refunded', refundedAt: now }, { merge: true });
  return 'refunded';
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
async function tellOwners(db: any, tenantId: string, id: string, message: string) {
  try {
    const ids = new Set<string>();
    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {}; if (t.userId) ids.add(String(t.userId));
    (await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get()).docs.forEach((d: any) => ids.add(d.id));
    const now = new Date().toISOString();
    for (const userId of ids) { const n = db.doc(`tenants/${tenantId}/notifications/${id}_${userId}`.replace(/[^A-Za-z0-9_/-]/g, '')); await n.set({ id: n.id, userId, type: 'card_charge_settled', read: false, createdAt: now, link: '/money', message }); }
  } catch { /* the claim keeps trying; the note is a courtesy */ }
}

/** The payment made under a claim's key, when the claim never heard back (its charge went through, or didn't). */
async function paymentUnder(c: any, stripe: any): Promise<{ found: any | null; asked: boolean }> {
  if (!c.customer || !c.account || !c.chargeKey) return { found: null, asked: false };
  try {
    // From an hour before the first try (each try moves `at`), through every page.
    const since = Math.floor((Date.parse(String(c.firstAt || c.at || '')) || Date.now()) / 1000) - 3600;
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const l: any = await stripe.paymentIntents.list({ customer: String(c.customer), created: { gte: since }, limit: 100, ...(after ? { starting_after: after } : {}) }, { stripeAccount: String(c.account) });
      const data: any[] = Array.isArray(l?.data) ? l.data : [];
      const found = data.find((p: any) => String(p?.metadata?.chargeKey || '') === String(c.chargeKey));
      if (found) return { found, asked: true };
      if (!l?.has_more || !data.length) break;
      after = String(data[data.length - 1].id);
    }
    return { found: null, asked: true };
  } catch { return { found: null, asked: false }; }
}

/** The hourly sweep: card orders left charging, charged (no order written) or part way through a refund are settled. */
export async function loungeCardSweep(db: any, tenantId: string, now = Date.now(), stripe?: any): Promise<number> {
  const snap = await db.collection(`tenants/${tenantId}/private/kiosk/cardOrders`).where('status', 'in', ['charging', 'charged', 'refunding']).get().catch(() => null);
  let n = 0;
  for (const d of snap?.docs || []) {
    const c: any = d.data() || {}; const at = Date.parse(String(c.refundingAt || c.chargedAt || c.firstAt || c.at || ''));
    if (Number.isFinite(at) && now - at < CARD_ORDER_SETTLE_MS) continue;
    try {
      let known: { piId?: string } = {};
      if (c.status === 'charging') {
        // Never heard back: did the charge go through?
        const s = stripe || (process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any }) : null);
        const { found, asked } = s ? await paymentUnder(c, s) : { found: null, asked: false };
        if (found && ['succeeded', 'processing'].includes(String(found.status))) { if (found.status !== 'succeeded') continue; known = { piId: String(found.id) }; }
        else {
          if (asked && (!Number.isFinite(at) || now - at > NOTHING_AFTER_MS)) await d.ref.set({ status: 'none', closedAt: new Date(now).toISOString() }, { merge: true });
          continue;
        }
      }
      if ((await settleCardOrder(db, tenantId, d.id, 'never ordered', known)) === 'refunded') n++;
    } catch (e: any) { console.error('[lounge-card] sweep', tenantId, d.id, e?.message || e); }
  }
  return n;
}
