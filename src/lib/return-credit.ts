// src/lib/return-credit.ts — STORE CREDIT FOR A RETURN COMES FROM THE SERVER. When the shop settles a return with store
// credit, the credit is issued here (api/retail/return-credit), never written from a browser: the database doesn't let
// anyone add credit marked as for a return (firestore.rules). It's worth what was paid for the items, after any promo
// code and with their tax, less return shipping when the customer pays it, and never more than is left of what was paid
// on the order the customer paid on, after everything already refunded or waiting to be refunded, given back on a gift
// card or as credit, or credited for the order's other returns. It goes to that order's customer, or for a gift exchange
// to the person the server recorded when the exchange was started. One transaction with the return, so it's issued
// once. Server only.
import { buildEvent, isReturnReceivable, returnRefundCents } from './retail-orders';
import { followUpsOf, isFollowUp, payingOrder, sameCustomer } from './order-family';
import { nonCardPaid, withNonCardRecord } from './non-card-back';
import { ensureNonCardRecord } from './non-card-record';
import { cardPaidCents } from './retail-money';

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const chunks = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** The credit a return gives (one per return, so it can never be issued twice). */
export const returnCreditRef = (db: any, t: string, returnId: string) => db.doc(`tenants/${t}/depositCredits/return_${returnId}`);
/** Who a gift exchange's credit is for, recorded by the server when the exchange is started (api/retail/gift). */
export const giftReturnRef = (db: any, t: string, returnId: string) => db.doc(`tenants/${t}/private/giftReturns/returns/${returnId}`);
/** Store credit given for returns on an order and everything made from it, as the server counted it. */
const tallyRef = (db: any, t: string, payerId: string) => db.doc(`tenants/${t}/private/returnCredits/orders/${payerId}`);

export type CreditActor = { uid: string; name: string; isManager?: boolean };
export type CreditResult = { ok: boolean; message: string; status?: number; creditCents?: number; cappedCents?: number; orderQrToken?: string; already?: boolean };

/** Settles a checked-in return with store credit. */
export async function resolveCreditReturn(db: any, t: string, returnId: string, actor: CreditActor): Promise<CreditResult> {
  const T = `tenants/${t}`;
  const col = db.collection(`${T}/retailOrders`);
  const rRef = db.doc(`${T}/retailReturns/${returnId}`);
  const cRef = returnCreditRef(db, t, returnId);
  // What the order paid by gift card or store credit counts toward what can come back: made sure of first for an order
  // paid before the server kept a record of it (lib/non-card-record).
  try {
    const r0: any = (await rRef.get()).data();
    const o0 = r0?.orderId ? await col.doc(String(r0.orderId)).get() : null;
    if (o0?.exists) {
      const ord = { ...(o0.data() || {}), id: String(r0.orderId) };
      const p0 = isFollowUp(ord) ? await payingOrder((x: any) => x.get(), col, ord) : ord;
      if (p0) await ensureNonCardRecord(db, t, String(p0.id), p0);
    }
  } catch { /* worked out from what's recorded */ }
  return db.runTransaction(async (tx: any): Promise<CreditResult> => {
    const get = (r: any) => tx.get(r);
    const rs = await get(rRef);
    if (!rs.exists) return { ok: false, status: 404, message: 'Return not found.' };
    const ret: any = { ...(rs.data() || {}), id: returnId };
    if (ret.resolution !== 'store_credit') return { ok: false, status: 409, message: 'This return isn’t settled with store credit.' };
    const cs = await get(cRef);
    // Settled already (a second tap, or a retry whose answer was lost): nothing more is issued.
    if (ret.status === 'resolved') {
      const amt = cs.exists ? c0(cs.data()?.amountCents) : 0;
      return { ok: true, already: true, message: cs.exists ? `Already checked in: ${money(amt)} store credit was issued.` : 'Already checked in.', creditCents: amt, cappedCents: 0 };
    }
    const gate = isReturnReceivable(ret);
    if (!gate.ok) return { ok: false, status: 409, message: gate.reason || 'Check in every item first.' };
    const orderId = String(ret.orderId || '');
    const oRef = col.doc(orderId || '_');
    const os = orderId ? await get(oRef) : null;
    if (!os?.exists) return { ok: false, status: 404, message: 'Original order missing.' };
    const order: any = { ...(os.data() || {}), id: orderId };
    // The order the customer paid on: this one, or for a backorder or replacement the order it was made from.
    const payer = isFollowUp(order) ? await payingOrder(get, col, order) : order;
    if (!payer || (payer.id !== order.id && !sameCustomer(payer, order))) {
      return { ok: false, status: 422, message: 'This return is for an order made from another one, and the payment behind it can’t be found, so the store credit can’t be worked out. A manager can add it by hand.' };
    }
    const payerId = String(payer.id);
    const family = (await followUpsOf(get, col, payerId)).filter((f: any) => isFollowUp(f));
    const payerT = await withNonCardRecord(get, db, t, payerId, payer);
    const tally = await get(tallyRef(db, t, payerId));
    // A gift exchange: the server's record says so, whatever the return itself now says.
    const giftRec = await get(giftReturnRef(db, t, returnId));
    const gift = !!giftRec?.exists || ret.isGiftReturn === true || !!ret.giftRecipient;
    // Credit already given for the order's other returns: as the server counted it, or as the credit itself shows (for
    // returns settled before the server kept count).
    const retIds: string[] = [];
    for (const ids of chunks([payerId, ...family.map((f: any) => String(f.id))], 30)) {
      const q = await get(db.collection(`${T}/retailReturns`).where('orderId', 'in', ids).limit(300));
      for (const d of q?.docs || []) if (d.id !== returnId) retIds.push(String(d.id));
    }
    let shown = 0;
    for (const ids of chunks(retIds, 30)) {
      const q = await get(db.collection(`${T}/depositCredits`).where('sourceRetailReturnId', 'in', ids).limit(300));
      for (const d of q?.docs || []) shown += c0(d.data()?.amountCents);
    }

    // What's left of what was paid: what the card paid and what the server recorded the gift card and store credit paying
    // (the tip aside), less every refund made or waiting across the order and everything made from it, what went back on
    // a gift card or as credit, and credit for other returns.
    const soFar = Math.max(c0(tally?.exists ? tally.data()?.cents : 0), shown);
    const np = nonCardPaid(payerT);
    const paid = Math.max(0, cardPaidCents(payerT) + np.giftCents + np.creditCents - c0(payer.tipCents));
    const everyOrder = [payer, ...family];
    const refunded = everyOrder.reduce((s: number, o: any) => s + c0(o.refundedCents), 0);
    const waiting = everyOrder.reduce((s: number, o: any) => s + c0(o.pendingRefundCents), 0);
    const back = c0(payer.nonCardRestored?.giftCents) + c0(payer.nonCardRestored?.creditCents);
    const room = Math.max(0, paid - refunded - waiting - back - soFar);
    const labelDeduct = c0(ret.labelDeductCents);
    const labelCost = c0(ret.labelCostCents);
    // What was paid for the items (as the return quoted it when it was started, or as the order shows now, whichever is
    // more, as the check-in sheet shows), less return shipping when the customer pays it.
    const worth = Math.max(0, Math.max(c0(ret.storeCreditCents), returnRefundCents(order, ret.lines || [])) - labelDeduct);
    const cents = Math.min(worth, room);
    const capped = worth - cents;

    // Who it's for: the order's customer, or the gift's recipient as the server recorded them.
    let to: { email: string; name: string; clientId: string | null };
    if (gift) {
      const g: any = giftRec?.exists ? giftRec.data() || {} : null;
      const legacy: any = ret.giftRecipient || {};
      if (g?.email) to = { email: String(g.email).toLowerCase().trim(), name: String(g.name || 'Gift recipient').slice(0, 80), clientId: null };
      else if (actor.isManager && legacy.email) to = { email: String(legacy.email).toLowerCase().trim(), name: String(legacy.name || 'Gift recipient').slice(0, 80), clientId: null };
      else return { ok: false, status: 403, message: 'This gift exchange was started before the server kept a record of who it’s for, so a manager needs to finish it.' };
    } else {
      const email = String(payer.customerEmail || '').toLowerCase().trim();
      if (!email && cents > 0) return { ok: false, status: 422, message: 'This order has no email, and store credit is kept by email. Settle the return another way.' };
      to = { email, name: String(payer.customerName || 'Guest').slice(0, 80), clientId: payer.clientId || null };
    }

    const now = new Date().toISOString();
    if (cents > 0) {
      tx.set(cRef, {
        id: cRef.id, tenantId: t, clientId: to.clientId, clientEmail: to.email, clientName: to.name,
        amountCents: cents, status: 'available', sourceRetailReturnId: returnId, returnForOrderId: payerId, sourceKind: 'return',
        createdAt: now, issuedBy: actor.name,
      });
    }
    tx.set(tallyRef(db, t, payerId), { cents: soFar + cents, at: now, returns: { [returnId]: cents } }, { merge: true });
    // The shop paid for the label: it's a real shipping cost of the return.
    if (labelCost > 0 && labelDeduct === 0) {
      const sRef = db.collection(`${T}/transactions`).doc();
      tx.set(sRef, {
        id: sRef.id, date: now, description: `Return shipping label (Order #${ret.orderNumber ?? order.orderNumber ?? ''})`,
        clientOrVendor: ret.labelCarrier || 'Carrier', type: 'expense', context: 'Business', category: 'Shipping', taxBucket: 'expense',
        amount: labelCost / 100, paymentMethod: 'Shippo', hasReceipt: false, retailOrderId: orderId, retailReturnId: returnId, tenantId: t,
      });
    }
    tx.update(rRef, {
      creditNetCents: cents, creditId: cents > 0 ? cRef.id : null, ...(capped > 0 ? { creditCappedCents: capped } : {}),
      status: 'resolved', resolvedBy: actor.name, resolvedAt: now,
    });
    const units = (ret.lines || []).reduce((a: number, l: any) => a + (l.disposition ? c0(l.qty) : 0), 0);
    tx.set(oRef, { returnSummary: { returnId, resolution: 'store_credit', resolvedAt: now, unitsReturned: units, refundCents: 0, creditCents: cents, labelDeductCents: labelDeduct, restockingFeeCents: 0 } }, { merge: true });
    const ev = oRef.collection('events').doc();
    tx.set(ev, { id: ev.id, ...buildEvent('return_resolved', actor.uid, actor.name, { returnId, resolution: 'store_credit', creditCents: cents, ...(capped > 0 ? { cappedCents: capped } : {}) }) });

    const shipping = labelDeduct ? ` (${money(labelDeduct)} return shipping deducted)` : '';
    const message = cents <= 0
      ? 'Checked in. No store credit was issued: everything paid on this order has already been refunded or given back.'
      : capped > 0
        ? `${money(cents)} store credit issued${shipping}. The other ${money(capped)} is more than is left of what they paid on this order, so it wasn’t added.`
        : `${money(cents)} store credit issued${shipping}, ready to use at checkout.`;
    return { ok: true, message, creditCents: cents, cappedCents: capped, orderQrToken: String(order.qrToken || '') };
  });
}
