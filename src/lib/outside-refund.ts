// src/lib/outside-refund.ts — A REFUND MADE OUTSIDE THE APP (in the Stripe Dashboard), IN THE BOOKS (server).
// The payments handler (lib/connect-webhook, charge.refunded) passes each refund on a business's charge here.
//   - One the app sent carries the app's mark (metadata.origin 'app', or the marks each refund path wrote before that)
//     and is recorded by the path that sent it, so it's left alone. So is one from before this was in place
//     (OUTSIDE_FROM), and money held but never taken (an authorization let go, the part of a hold not captured): that
//     was never a sale, so it isn't a refund of one.
//   - One made in the Dashboard is recorded once, named after Stripe's refund, as a refund (it comes off sales,
//     lib/books-summary), and the owners are told, so nobody adds it by hand as well.
//       A shop order's: on the order too (what's been refunded, with its tax and tip parts, lib/refund-tax), and it
//       takes the place of a refund the order was waiting to send, up to its amount. One the team already recorded by
//       hand as "refunded in the dashboard" (lib/retail-returns, markRefundExecuted) is matched to it instead.
//       A booking deposit's: the deposit closes (or what's left on it comes down), so it can't also come off a bill.
import { refundTaxPart, refundTipPart } from '@/lib/refund-tax';

/** Refunds made before this was in place are left as they were (any made outside the app then were recorded by hand). */
export const OUTSIDE_FROM = Date.parse('2026-10-24T00:00:00Z');

// What the app has ever written on a refund it sent.
const APP_MARKS = ['origin', 'tenantId', 'moneyRefundOf', 'retailOrderId', 'depositCreditId', 'reservationId', 'appointmentId', 'why', 'kind', 'source', 'disposition', 'seq', 'paidOnOrderId', 'clientId', 'staffId', 'cancelReason'];
export const madeByApp = (rf: any) => { const m = rf?.metadata || {}; return APP_MARKS.some((k) => m[k] != null && String(m[k]) !== ''); };

const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const c0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));

export type OutsideRefund = { recorded: false; why: string } | { recorded: true; lineId: string; cents: number; orderId?: string | null; matched?: boolean };

/** Record one refund on a charge, if it was made outside the app. `meta` is the charge's (and its payment's) metadata. */
export async function recordOutsideRefund(db: any, tenantId: string, charge: any, rf: any, meta: any, opts: { piId?: string | null; account?: string | null } = {}): Promise<OutsideRefund> {
  const T = `tenants/${tenantId}`;
  const cents = c0(rf?.amount);
  if (!rf?.id || !(cents > 0)) return { recorded: false, why: 'nothing' };
  if (['failed', 'canceled'].includes(String(rf.status || ''))) return { recorded: false, why: 'not_refunded' };
  if (madeByApp(rf)) return { recorded: false, why: 'app' };
  if ((Number(rf.created) || 0) * 1000 < OUTSIDE_FROM) return { recorded: false, why: 'before' };
  // Money held but never taken isn't a refund of a sale.
  if (charge?.captured === false || (typeof charge?.amount_captured === 'number' && charge.amount_captured < (Number(charge?.amount) || 0))) return { recorded: false, why: 'hold' };

  const now = new Date().toISOString();
  const at = new Date((Number(rf.created) || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const lineRef = db.doc(`${T}/transactions/stripe_refund_${safe(rf.id)}`);
  if ((await lineRef.get()).exists) return { recorded: false, why: 'already' };
  // Recorded under its id already (by a path that named it, e.g. a refund line with stripeRefundId): nothing to add.
  const named = await db.collection(`${T}/transactions`).where('stripeRefundId', '==', String(rf.id)).limit(1).get();
  if (!named.empty) return { recorded: false, why: 'named' };

  const piId = opts.piId || (typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id) || null;
  const orderId = meta?.type === 'retail_order' && meta?.retailOrderId ? safe(meta.retailOrderId) : null;
  const who = String(charge?.billing_details?.name || meta?.clientName || '').trim() || 'a customer';
  const base = {
    id: lineRef.id, tenantId, date: at, createdAt: now,
    type: 'expense', context: 'Business', category: 'Refunds', taxBucket: 'refund', refundKind: 'outside_app', madeOutsideApp: true,
    amount: cents / 100, amountCents: cents, paymentMethod: 'Card (Stripe refund)', hasReceipt: false,
    clientOrVendor: who === 'a customer' ? 'Customer' : who, clientId: meta?.clientId || null, appointmentId: meta?.appointmentId || null,
    stripeRefundId: String(rf.id), stripeChargeId: charge?.id || null, stripePaymentIntentId: piId, stripeConnectedAccountId: opts.account || null,
    notes: 'Made in the Stripe Dashboard, not in the app. It’s counted as a refund here; there’s no need to add it by hand.',
  };

  let result: OutsideRefund;
  if (orderId) {
    // A shop order's refund: one the team recorded by hand ("refunded in the dashboard") is matched to it; otherwise
    // it's recorded on the order and in the books together.
    const oRef = db.doc(`${T}/retailOrders/${orderId}`);
    const byHand = (await db.collection(`${T}/transactions`).where('retailOrderId', '==', orderId).limit(50).get()).docs
      .filter((d: any) => { const x = d.data() || {}; return x.category === 'Refunds' && /^Refund executed/.test(String(x.description || '')) && !x.stripeRefundId && !x.madeOutsideApp && Math.round((Number(x.amount) || 0) * 100) === cents; })
      .map((d: any) => d.ref);
    result = await db.runTransaction(async (tx: any) => {
      const line = await tx.get(lineRef);
      const os = await tx.get(oRef);
      const hands: any[] = []; for (const r of byHand) hands.push(await tx.get(r));
      if (line.exists) return { recorded: false, why: 'already' } as OutsideRefund;
      const o: any = os.exists ? os.data() || {} : null;
      if (Array.isArray(o?.outsideRefunds) && o.outsideRefunds.some((x: any) => x?.id === rf.id)) return { recorded: false, why: 'already' } as OutsideRefund;
      const hand = hands.find((h) => h.exists && !(h.data() || {}).stripeRefundId);
      if (hand) {
        tx.set(hand.ref, { stripeRefundId: String(rf.id), stripeRefundMatchedAt: now }, { merge: true });
        return { recorded: true, lineId: hand.ref.id, cents, orderId, matched: true } as OutsideRefund;
      }
      if (!o) { tx.set(lineRef, { ...base, retailOrderId: orderId, description: `Refund made in Stripe — shop order` }); return { recorded: true, lineId: lineRef.id, cents, orderId } as OutsideRefund; }
      const tipPart = o.parentOrderId ? 0 : refundTipPart(o, cents);
      const taxPart = refundTaxPart(o, Math.max(0, cents - tipPart));
      const pending = c0(o.pendingRefundCents); const covered = Math.min(pending, cents);
      tx.set(lineRef, { ...base, retailOrderId: orderId, channel: 'online', taxRefunded: taxPart / 100, ...(tipPart ? { tipRefunded: tipPart / 100, ...(o.tipSharedAt || !o.booksAt ? { tipBooked: true } : {}) } : {}),
        clientOrVendor: o.customerName || base.clientOrVendor, description: `Refund made in Stripe — Order #${o.orderNumber || ''}`.trim() });
      tx.set(oRef, {
        refundedCents: c0(o.refundedCents) + cents,
        ...(taxPart ? { refundedTaxCents: c0(o.refundedTaxCents) + taxPart } : {}),
        ...(tipPart ? { refundedTipCents: c0(o.refundedTipCents) + tipPart } : {}),
        ...(covered ? { pendingRefundCents: pending - covered } : {}),
        outsideRefunds: [...(Array.isArray(o.outsideRefunds) ? o.outsideRefunds : []), { id: String(rf.id), cents, at, coveredPendingCents: covered }],
      }, { merge: true });
      const evRef = oRef.collection('events').doc(`outside_refund_${safe(rf.id)}`);
      tx.set(evRef, { id: evRef.id, type: 'refund_issued', at: now, actorId: 'stripe', actorName: 'Stripe Dashboard',
        meta: { amountCents: cents, scope: cents >= c0(o.totalCents) ? 'full' : 'partial', via: 'stripe_dashboard', stripeRefundId: String(rf.id) } });
      return { recorded: true, lineId: lineRef.id, cents, orderId } as OutsideRefund;
    });
  } else {
    // Anything else (a visit, a desk sale, a deposit, a gift card…): in the books, with what the payment says it was for.
    // A booking deposit paid with it closes, or what's left on it comes down, so it can't also come off a bill.
    const deps = piId ? (await db.collection(`${T}/depositCredits`).where('stripePaymentIntentId', '==', String(piId)).limit(5).get()).docs.map((d: any) => d.ref) : [];
    result = await db.runTransaction(async (tx: any) => {
      const line = await tx.get(lineRef);
      const ds: any[] = []; for (const r of deps) ds.push(await tx.get(r));
      if (line.exists) return { recorded: false, why: 'already' } as OutsideRefund;
      tx.set(lineRef, { ...base, taxRefunded: 0, ...(meta?.type === 'address_change' && meta?.retailOrderId ? { retailOrderId: safe(meta.retailOrderId) } : {}),
        description: `Refund made in Stripe — ${who === 'a customer' ? (charge?.description || 'a card payment') : who}`.slice(0, 200) });
      let left = cents;
      for (const d of ds) {
        const c: any = d.data() || {};
        if (!d.exists || c.status !== 'available' || left <= 0) continue;
        const have = Math.max(0, c0(c.amountCents ?? Math.round((Number(c.amount) || 0) * 100)) - c0(c.usedCents));
        if (have <= 0) continue;
        const take = Math.min(have, left); left -= take;
        tx.set(d.ref, take >= have
          ? { status: 'refunded', refundedAt: now, refundedCents: take, stripeRefundId: String(rf.id), refundedOutsideApp: true }
          : { usedCents: c0(c.usedCents) + take, refundedOutsideCents: c0(c.refundedOutsideCents) + take, lastOutsideRefundId: String(rf.id) }, { merge: true });
      }
      return { recorded: true, lineId: lineRef.id, cents } as OutsideRefund;
    });
  }

  // The owners hear about it once (each note is named after Stripe's refund).
  if (result.recorded && !result.matched) {
    try {
      const admins = await db.collection(`${T}/staff`).where('role', 'in', ['admin', 'owner']).get();
      for (const d of admins.docs) {
        const n = db.doc(`${T}/notifications/outsiderefund_${safe(rf.id)}_${safe(d.id)}`);
        await n.set({ id: n.id, userId: d.id, type: 'outside_refund', read: false, createdAt: now, link: orderId ? `/orders?order=${orderId}` : '/money',
          message: `A $${(cents / 100).toFixed(2)} refund${who !== 'a customer' ? ` to ${who}` : ''} was made in Stripe, outside the app. It’s recorded in Money as a refund${orderId ? ' and on the order' : ''}, so there’s no need to add it by hand.` });
      }
    } catch { /* recorded; the note is a courtesy */ }
  }
  return result;
}
