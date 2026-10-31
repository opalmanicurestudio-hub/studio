// src/lib/claim-settle.ts — PUTTING A REPORT RIGHT ANOTHER WAY: SEND ANOTHER, OR STORE CREDIT (mockup 10A, "Put it right
// with"). On the server (api/retail/fulfil decideClaim), for a manager or someone who can refund, within their role's
// refund limit (lib/money-limits). Both settle the units the report covers (qtyClaimed), so they can't be returned or
// claimed again, and both record the loss straight after (lossPending, lib/claim-loss), as a refund does.
//   - Send another: a $0 order with the item (for a parcel that never came, everything that went in it), going the way
//     the first one did, packed and checked like any other. Its stock is held the moment it's made, as a paid order's is.
//   - Store credit: worth what's left to refund on the report (lib/claim-view claimRefundable), never more than is left of
//     what was paid on the order paid on, after every refund made or waiting and everything already given back. Kept with
//     the customer's email, counted as given back wherever money goes back for the order (lib/return-credit tally), and
//     in the books as a refund paid as store credit. One credit per report.
// One transaction each, with the report and the order, so two devices can't both decide. Server only.
import { claimRefundable, unitsOpen } from './claim-view';
import { followUpsOf, isFollowUp, lineFor, payingOrder, sameCustomer, taxBasisOf } from './order-family';
import { nonCardPaid, withNonCardRecord } from './non-card-back';
import { ensureNonCardRecord } from './non-card-record';
import { cardPaidCents } from './retail-money';
import { refundTaxPart } from './refund-tax';
import { returnCreditGiven } from './return-credit';
import { refundAllowed } from './money-limits';
import { followUpDelivery } from './delivery-plan';
import { buildEntry } from './stock-ledger';
import { randomBytes } from 'crypto';
import { closeCarrierIssue, type ClaimDecision } from './claim-decide';

export type SettleHow = 'replacement' | 'store_credit';
export type SettleActor = { id: string; name: string; role?: string; isTenantOwner?: boolean };
export type SettleResult = ClaimDecision & { status?: number; replacementOrderId?: string; creditCents?: number; creditId?: string };

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const newId = () => randomBytes(6).toString('hex');
const tallyRef = (db: any, t: string, payerId: string) => db.doc(`tenants/${t}/private/returnCredits/orders/${payerId}`);
export const claimCreditRef = (db: any, t: string, claimId: string) => db.doc(`tenants/${t}/depositCredits/claim_${String(claimId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 140)}`);
const num = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;

export async function settleClaim(db: any, t: string, claimId: string, how: SettleHow, o: { cents: number | null; by: SettleActor }): Promise<SettleResult> {
  const T = `tenants/${t}`;
  const claimRef = db.doc(`${T}/retailClaims/${claimId}`);
  const col = db.collection(`${T}/retailOrders`);
  const rs: any = ((await db.doc(T).get()).data() || {}).retailSettings || {};
  // What the order paid by gift card or store credit counts toward what can come back: made sure of first for an order
  // paid before the server kept a record of it (lib/non-card-record).
  {
    try {
      const c0s: any = (await claimRef.get()).data();
      const os = c0s?.orderId ? await col.doc(String(c0s.orderId)).get() : null;
      if (os?.exists) { const ord = { ...(os.data() || {}), id: String(c0s.orderId) }; const p0 = isFollowUp(ord) ? await payingOrder((x: any) => x.get(), col, ord) : ord; if (p0) await ensureNonCardRecord(db, t, String(p0.id), p0); }
    } catch { /* worked out from what's recorded */ }
  }
  return db.runTransaction(async (tx: any): Promise<SettleResult> => {
    const get = (r: any) => tx.get(r);
    const cs = await get(claimRef);
    if (!cs.exists) return { ok: false, status: 404, message: 'That report isn’t there any more.' };
    const cur: any = cs.data() || {};
    if (cur.status !== 'in_review') return { ok: false, status: 409, message: 'Already decided on another device.' };
    // The shop's photo rule, stamped on the report when it came in.
    if (cur.photosRequired && !(Array.isArray(cur.photoUrls) && cur.photoUrls.length)) return { ok: false, status: 409, message: 'Your policy asks for a photo first. Ask the customer for one, or decline if it doesn’t hold up.' };
    const orderId = String(cur.orderId || '');
    if (!orderId || orderId.includes('/')) return { ok: false, status: 404, message: 'The order for this report can’t be found.' };
    const oRef = col.doc(orderId);
    const os = await get(oRef);
    if (!os.exists) return { ok: false, status: 404, message: 'The order for this report can’t be found.' };
    const order: any = { ...(os.data() || {}), id: orderId };
    const oLines: any[] = Array.isArray(order.lines) ? order.lines : [];
    const line = cur.lineId ? oLines.find((l: any) => l?.lineId === cur.lineId) || null : null;
    const share = claimRefundable(cur, order);
    if (cur.lineId && line && share.units <= 0) return { ok: false, status: 409, message: 'That item has already been refunded, through a return or another report.' };
    if (!cur.lineId && share.units <= 0) return { ok: false, status: 409, message: 'Everything on this order has already been put right, through a return, a refund or another report.' };
    const want = Math.max(1, c0(cur.qty));
    const now = new Date().toISOString();
    const by = { decidedBy: String(o.by.name || 'staff').slice(0, 80), decidedById: String(o.by.id || '').slice(0, 128) };
    // The units this report settles can't be returned or claimed again: its own item, or for an order that never
    // arrived, everything still on it.
    const settledLines = oLines.map((l: any) => (cur.lineId
      ? (l.lineId === cur.lineId ? { ...l, qtyClaimed: c0(l.qtyClaimed) + share.units } : l)
      : { ...l, qtyClaimed: c0(l.qtyClaimed) + unitsOpen(l) }));
    const carrier = closeCarrierIssue({ ...cur, id: claimId }, order, now, by.decidedBy, how);
    const earlier = cur.declineReason ? { declineReason: null, earlierDeclineReason: String(cur.declineReason).slice(0, 400) } : {};

    // The order the customer paid on (this one, or for a backorder or replacement the order it was made from), and
    // what's left of what was paid on it: what the card paid and what the server recorded the gift card and store credit
    // paying (the tip aside), less every refund made or waiting across it and everything made from it, what went back
    // on a gift card or as credit, and credit already given. Read for both ways, before anything is written.
    const payer = isFollowUp(order) ? await payingOrder(get, col, order) : order;
    const payerOk = !!payer && (payer.id === order.id || sameCustomer(payer, order));
    const payerId = payerOk ? String(payer.id) : '';
    const family = payerOk ? (await followUpsOf(get, col, payerId)).filter((f: any) => isFollowUp(f)) : [];
    const payerT = payerOk ? await withNonCardRecord(get, db, t, payerId, payer) : null;
    const soFar = payerOk ? await returnCreditGiven(get, db, t, payerId, family.map((f: any) => String(f.id))) : 0;
    let room = 0; let paid = 0;
    if (payerOk) {
      const np = nonCardPaid(payerT);
      paid = Math.max(0, cardPaidCents(payerT) + np.giftCents + np.creditCents - c0(payer.tipCents));
      const everyOrder = [payer, ...family];
      const refunded = everyOrder.reduce((a: number, x: any) => a + c0(x.refundedCents), 0);
      const waiting = everyOrder.reduce((a: number, x: any) => a + c0(x.pendingRefundCents), 0);
      const back = c0(payer.nonCardRestored?.giftCents) + c0(payer.nonCardRestored?.creditCents);
      room = Math.max(0, paid - refunded - waiting - back - soFar);
    }

    if (how === 'replacement') {
      // What goes in the new box: the report's item, or for a parcel that never came, everything still theirs on it.
      const items: { l: any; qty: number }[] = line ? [{ l: line, qty: share.units }]
        : cur.lineId ? [] : oLines.filter((l: any) => l && l.digital !== true).map((l: any) => ({ l, qty: unitsOpen(l) })).filter((x) => x.qty > 0);
      if (!cur.lineId && order.replacementOrderId) return { ok: false, status: 409, message: 'This order already has a replacement on its way.' };
      // Paid back in full already, or about to be (on this order, or for a backorder or replacement on the order it was
      // paid on): sending it again as well would pay for it twice.
      const total = c0(order.totalCents);
      // (An order nothing was paid for, a free one, can still be sent again.)
      if ((payerOk && paid > 0 && room <= 0) || (total > 0 && c0(order.refundedCents) + c0(order.pendingRefundCents) >= total)) return { ok: false, status: 409, message: 'This order is already being refunded in full, so sending another would pay for it twice.' };
      // A box that held other orders too: the replacement for all of it goes from Needs you, so nothing in it is missed.
      if (!cur.lineId && ((Array.isArray(order.shippedWithOrderIds) && order.shippedWithOrderIds.length) || order.shippedWithOrderId || order.labelFromOrderId)) return { ok: false, status: 409, message: 'This order went in one box with another order. Put it right with a refund or store credit.' };
      if (items.some((x) => x.l.digital === true)) return { ok: false, status: 409, message: 'A download can’t be sent again. Refund it, or give store credit.' };
      if (!items.length) return { ok: false, status: 409, message: 'There’s nothing on this order to send again.' };
      const worth = items.reduce((a, x) => a + c0(x.l.unitPriceCents) * x.qty, 0);
      const allowed = refundAllowed(rs, { role: o.by.role, isTenantOwner: o.by.isTenantOwner }, worth);
      if (!allowed.ok) return { ok: false, status: 403, message: `Putting right more than ${money(allowed.limit)} needs someone with a higher limit. Ask a manager to decide this one.` };
      // Each product's stock, read before anything is written.
      const pids = [...new Set(items.map((x) => String(x.l.productId || '')).filter(Boolean))];
      const invRefs = pids.map((id) => db.doc(`${T}/inventory/${id}`));
      const invSnaps = invRefs.length ? await Promise.all(invRefs.map((r) => get(r))) : [];

      const childRef = col.doc();
      const lost = cur.type === 'not_received';
      tx.set(childRef, JSON.parse(JSON.stringify({
        id: childRef.id, tenantId: t, orderNumber: order.orderNumber ?? null,
        stage: 'paid', method: order.method, priceTier: order.priceTier || 'retail', ...(order.priceTier === 'wholesale' ? { wholesaleAccountId: order.wholesaleAccountId || null, ...(order.wholesaleDiscountPct != null ? { wholesaleDiscountPct: order.wholesaleDiscountPct } : {}) } : {}),
        businessName: order.businessName || '', poNumber: order.poNumber || '',
        // Each unit keeps the price paid for it, and the order the tax figures it was paid with, so a refund on the
        // replacement is what was paid (lib/order-family).
        lines: items.map(({ l, qty }) => ({ ...lineFor(l, qty), lineId: `line-${newId()}`, qtyScanned: 0, qtyPacked: 0, qtyShorted: 0, qtyReturned: 0, qtyRefunded: 0, qtyClaimed: 0, status: 'pending', shortReason: '', preorder: false })),
        subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, totalCents: 0, taxBasis: taxBasisOf(order),
        customerName: order.customerName || '', customerEmail: order.customerEmail || '', customerPhone: order.customerPhone || '', clientId: order.clientId || null,
        shippingAddress: order.shippingAddress || null, shippingService: order.shippingService || null, shippingCarrier: order.shippingCarrier || null,
        ...(order.method === 'delivery' && order.delivery ? { delivery: followUpDelivery(order.delivery) } : {}),
        parentOrderId: orderId, isReplacement: true, claimId,
        // A parcel that never came: the replacement for a lost parcel, the same as one sent from Needs you.
        ...(lost ? { replacementFor: 'lost_in_transit', lostParcelOrderId: orderId } : {}),
        qrToken: order.qrToken || null, placedAt: now, paidAt: now,
      })));
      // Its stock is held now, as a paid order's is, so the shelf isn't sold twice and sending it releases its own hold.
      const held = new Map<string, number>();
      for (const { l, qty } of items) if (l.productId) held.set(String(l.productId), (held.get(String(l.productId)) || 0) + qty);
      invSnaps.forEach((s: any, i: number) => {
        const pid = pids[i]; const q = held.get(pid) || 0;
        if (!s?.exists || q <= 0) return;
        const item: any = s.data() || {};
        const after = c0(item.stockReserved) + q;
        tx.update(invRefs[i], { stockReserved: after });
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({
          productId: pid, type: 'reserved', field: 'stockReserved', delta: q, unit: item.unit || 'units',
          reason: `Held for a replacement of order ${num(order)} (a problem report)`, actorId: by.decidedById, actorName: by.decidedBy,
          ref: { kind: 'order', id: childRef.id }, balanceAfter: after,
        }));
      });
      tx.update(claimRef, { status: 'resolved', resolution: 'replacement', resolutionCents: 0, replacementOrderId: childRef.id, replacementMethod: String(order.method || ''), decidedAt: now, ...by, lossPending: true, ...earlier,
        ...(cur.lineId && share.units < want ? { qtySettled: share.units } : {}) });
      tx.update(oRef, { lines: JSON.parse(JSON.stringify(settledLines)), ...(!cur.lineId ? { replacementOrderId: childRef.id } : {}), ...carrier });
      const ev = oRef.collection('events').doc();
      tx.set(ev, { id: ev.id, type: 'replacement_created', at: now, actorId: by.decidedById, actorName: by.decidedBy, meta: { childOrderId: childRef.id, claimId, text: `Replacement sent for their report${line ? `: ${line.name || 'an item'} ×${share.units}` : ': the whole order'}` } });
      return { ok: true, message: 'Approved', cents: 0, orderId, replacementOrderId: childRef.id };
    }

    // ── Store credit ──
    if (!payerOk) return { ok: false, status: 422, message: 'This order was made from another one, and the payment behind it can’t be found, so store credit can’t be worked out. Refund it instead.' };
    const email = String(payer.customerEmail || order.customerEmail || '').toLowerCase().trim();
    if (!email) return { ok: false, status: 422, message: 'This order has no email, and store credit is kept by email. Refund it instead.' };
    const credRef = claimCreditRef(db, t, claimId);
    const existing = await get(credRef);
    if (existing.exists) return { ok: false, status: 409, message: 'Store credit was already given for this report.' };
    const chosen = o.cents != null && Number.isFinite(o.cents) ? Math.min(c0(o.cents), share.cents) : share.cents;
    const cents = Math.min(chosen, room);
    if (cents <= 0) return { ok: false, status: 409, message: room <= 0 ? 'Everything paid on this order has already been refunded or given back, so there’s nothing left to give as credit.' : 'Pick an amount above $0.00.' };
    const allowed = refundAllowed(rs, { role: o.by.role, isTenantOwner: o.by.isTenantOwner }, cents);
    if (!allowed.ok) return { ok: false, status: 403, message: `Putting right more than ${money(allowed.limit)} needs someone with a higher limit. Ask a manager to decide this one.` };

    // In the books: a refund paid as store credit, with the sales tax on it. The credit is money the shop owes until
    // it's spent. The decision email tells them about it (api/retail/claim-notify), so no separate credit email goes.
    const taxPart = refundTaxPart(payerT, cents);
    tx.set(credRef, {
      id: credRef.id, tenantId: t, clientId: payer.clientId || null, clientEmail: email, clientName: String(payer.customerName || order.customerName || 'Guest').slice(0, 80),
      kind: 'store_credit', amountCents: cents, status: 'available', sourceRetailClaimId: claimId, returnForOrderId: payerId, sourceKind: 'claim',
      createdAt: now, issuedBy: by.decidedBy, grantEmailAt: now, grantEmailVia: 'claim_decision',
    });
    const bRef = db.doc(`${T}/transactions/claimcredit_${String(claimId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)}`);
    tx.set(bRef, {
      id: bRef.id, date: now, description: `Problem report settled with store credit — Order ${num(order)}`,
      clientOrVendor: String(payer.customerName || 'Guest'), clientId: payer.clientId || null, type: 'expense', context: 'Business', category: 'Refunds', taxBucket: 'refund',
      amount: cents / 100, taxRefunded: taxPart / 100, paymentMethod: 'Store credit', hasReceipt: true,
      retailOrderId: orderId, retailClaimId: claimId, ...(payerId !== orderId ? { paidOnOrderId: payerId } : {}), channel: 'online', tenantId: t,
    });
    tx.set(tallyRef(db, t, payerId), { cents: soFar + cents, at: now, claims: { [claimId]: cents } }, { merge: true });
    tx.update(claimRef, { status: 'resolved', resolution: 'store_credit', resolutionCents: cents, creditCents: cents, creditId: credRef.id, creditEmail: email, decidedAt: now, ...by, lossPending: true, ...earlier,
      ...(cents < c0(cur.claimValueCents) ? { partialOfCents: c0(cur.claimValueCents) } : {}), ...(cur.lineId && share.units < want ? { qtySettled: share.units } : {}) });
    // The tax given back is counted on the order paid on, so a later refund never gives it back again.
    if (payerId === orderId) tx.update(oRef, { lines: JSON.parse(JSON.stringify(settledLines)), ...carrier, ...(taxPart ? { refundedTaxCents: c0(payer.refundedTaxCents) + taxPart } : {}) });
    else {
      tx.update(oRef, { lines: JSON.parse(JSON.stringify(settledLines)), ...carrier });
      if (taxPart) tx.update(col.doc(payerId), { refundedTaxCents: c0(payer.refundedTaxCents) + taxPart });
    }
    const ev = oRef.collection('events').doc();
    tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: by.decidedById, actorName: by.decidedBy, meta: { claimId, text: `Problem report settled with ${money(cents)} store credit${cents < chosen ? ` (all that was left of what they paid)` : ''}` } });
    return { ok: true, message: 'Approved', cents, orderId, creditCents: cents, creditId: credRef.id };
  });
}
