// src/lib/claim-decide.ts — DECIDING ON A CUSTOMER'S REPORT (damaged, missing, never arrived), on the server
// (api/retail/fulfil, for a manager or someone who can refund). Approving queues the refund on the order and marks the
// units it settles, so they can't be returned or claimed again; one item is refunded once. Declining keeps the reason
// the customer's email quotes. Both in one transaction with the order, so two devices can't both decide.
import { claimRefundable, unitsOpen } from './claim-view';

export type ClaimDecision = { ok: boolean; message: string; cents?: number; orderId?: string };

/** A parcel reported as never arriving, put right (a refund, sent again, or store credit): the carrier problem on the
 *  order is closed, and the order keeps a note of it (lostReportSettled) that the nightly quiet-parcel check, a parcel
 *  turning up after all, and a replacement from Needs you all read, so none of them treats it as still lost. */
export const closeCarrierIssue = (cur: any, order: any, now: string, by: string, how = 'refund') => (cur?.type !== 'not_received' ? {} : {
  lostReportSettled: { claimId: String(cur.id || ''), at: now, by, how },
  ...(order?.carrierIssue?.open ? { carrierIssue: { ...order.carrierIssue, open: false, closedAt: now, closedBy: by, outcome: 'report_settled' } } : {}),
});

export async function decideClaim(db: any, tenantId: string, claimId: string, approve: boolean, o: { cents: number | null; declineWhy: string; by?: { id: string; name: string } }): Promise<ClaimDecision> {
  const by = { decidedBy: String(o.by?.name || 'staff').slice(0, 80), ...(o.by?.id ? { decidedById: String(o.by.id).slice(0, 128) } : {}) };
  const claimRef = db.doc(`tenants/${tenantId}/retailClaims/${claimId}`);
  if (!approve && !String(o.declineWhy || '').trim()) return { ok: false, message: 'A decline needs a reason. The customer’s email quotes it word for word.' };
  return db.runTransaction(async (tx: any) => {
    const claimSnap = await tx.get(claimRef);
    if (!claimSnap.exists) return { ok: false, message: 'That report isn’t there any more.' };
    const cur: any = claimSnap.data() || {};
    if (cur.status !== 'in_review') return { ok: false, message: 'Already decided on another device.' };
    const orderId = String(cur.orderId || '');
    const orderRef = orderId && !orderId.includes('/') ? db.doc(`tenants/${tenantId}/retailOrders/${orderId}`) : null;
    const orderSnap = orderRef ? await tx.get(orderRef) : null;
    const now = new Date().toISOString();
    if (!approve) {
      tx.update(claimRef, { status: 'declined', resolution: 'declined', decidedAt: now, ...by, declineReason: String(o.declineWhy).trim().slice(0, 400) });
      return { ok: true, message: 'Declined', orderId };
    }
    // The shop's photo rule, stamped on the report when it came in: approving without the photo would make it a lie.
    if (cur.photosRequired && !(Array.isArray(cur.photoUrls) && cur.photoUrls.length)) return { ok: false, message: 'Your policy asks for a photo first. Ask the customer for one, or decline if it doesn’t hold up.' };
    const n = (v: any) => Math.max(0, Number(v) || 0);
    const order: any = orderSnap?.exists ? orderSnap.data() : null;
    const oLines: any[] = Array.isArray(order?.lines) ? order.lines : [];
    // One item is refunded once: units since returned, refunded, or settled another way aren't paid again, and only part
    // of it left is that share of the amount (lib/claim-view claimRefundable, the same sum the decide sheet shows).
    const asked0 = n(cur.claimValueCents);
    const line = cur.lineId ? oLines.find((l: any) => l.lineId === cur.lineId) : null;
    const want = Math.max(1, n(cur.qty));
    const share = claimRefundable(cur, order);
    if (cur.lineId && line && share.units <= 0) return { ok: false, message: 'That item has already been refunded, through a return or another report.' };
    if (!cur.lineId && order && share.units <= 0) return { ok: false, message: 'Everything on this order has already been put right, through a return, a refund or another report.' };
    const units = cur.lineId ? share.units : want;
    const asked = share.cents;
    const cents = o.cents !== null && Number.isFinite(o.cents) ? Math.max(0, Math.min(Math.round(o.cents), asked)) : asked;
    // lossPending: the loss is recorded straight after (lib/claim-loss), or by the nightly run if that fails. A reason
    // from an earlier decline (before an appeal) is kept apart, so an approval never carries it.
    tx.update(claimRef, { status: 'resolved', resolution: cents > 0 ? 'refund' : 'no_refund', resolutionCents: cents, decidedAt: now, ...by, lossPending: true,
      ...(cur.declineReason ? { declineReason: null, earlierDeclineReason: String(cur.declineReason).slice(0, 400) } : {}), ...(cents !== asked0 ? { partialOfCents: asked0 } : {}), ...(units < want ? { qtySettled: units } : {}) });
    if (order && orderRef) {
      // The units this report settles can't be returned or claimed again (qtyClaimed): its own item, or for an order that
      // never arrived, everything still on it.
      const lines = oLines.map((l: any) => (cur.lineId
        ? (l.lineId === cur.lineId ? { ...l, qtyClaimed: n(l.qtyClaimed) + units } : l)
        : { ...l, qtyClaimed: n(l.qtyClaimed) + unitsOpen(l) }));
      tx.update(orderRef, { pendingRefundCents: n(order.pendingRefundCents) + cents, lines: JSON.parse(JSON.stringify(lines)), ...closeCarrierIssue({ ...cur, id: claimId }, order, now, by.decidedBy, cents > 0 ? 'refund' : 'no_refund') });
    }
    return { ok: true, message: 'Approved', cents, orderId };
  });
}
