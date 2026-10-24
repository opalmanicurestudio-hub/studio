// src/lib/claim-decide.ts — DECIDING ON A CUSTOMER'S REPORT (damaged, missing, never arrived), on the server
// (api/retail/fulfil, for a manager or someone who can refund). Approving queues the refund on the order and marks the
// units it settles, so they can't be returned or claimed again; one item is refunded once. Declining keeps the reason
// the customer's email quotes. Both in one transaction with the order, so two devices can't both decide.
export type ClaimDecision = { ok: boolean; message: string; cents?: number };

export async function decideClaim(db: any, tenantId: string, claimId: string, approve: boolean, o: { cents: number | null; declineWhy: string }): Promise<ClaimDecision> {
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
      tx.update(claimRef, { status: 'declined', resolution: 'declined', decidedAt: now, decidedBy: 'staff', declineReason: String(o.declineWhy).trim().slice(0, 400) });
      return { ok: true, message: 'Declined' };
    }
    // The shop's photo rule, stamped on the report when it came in: approving without the photo would make it a lie.
    if (cur.photosRequired && !(Array.isArray(cur.photoUrls) && cur.photoUrls.length)) return { ok: false, message: 'Your policy asks for a photo first. Ask the customer for one, or decline if it doesn’t hold up.' };
    const n = (v: any) => Math.max(0, Number(v) || 0);
    const open = (l: any) => Math.max(0, n(l.qtyOrdered) - n(l.qtyShorted) - n(l.qtyReturned));
    const order: any = orderSnap?.exists ? orderSnap.data() : null;
    const oLines: any[] = Array.isArray(order?.lines) ? order.lines : [];
    // One item is refunded once: units since returned, or refunded through another report, aren't paid again. Only part
    // of it left: that share of the amount.
    const asked0 = n(cur.claimValueCents);
    const line = cur.lineId ? oLines.find((l: any) => l.lineId === cur.lineId) : null;
    const want = Math.max(1, n(cur.qty));
    const left = line ? Math.max(0, open(line) - n(line.qtyClaimed)) : want;
    if (cur.lineId && left <= 0) return { ok: false, message: 'That item has already been refunded, through a return or another report.' };
    const units = Math.min(want, left);
    const asked = units < want ? Math.round((asked0 * units) / want) : asked0;
    const cents = o.cents !== null && Number.isFinite(o.cents) ? Math.max(0, Math.min(Math.round(o.cents), asked)) : asked;
    tx.update(claimRef, { status: 'resolved', resolution: 'refund', resolutionCents: cents, decidedAt: now, decidedBy: 'staff', ...(cents !== asked0 ? { partialOfCents: asked0 } : {}), ...(units < want ? { qtySettled: units } : {}) });
    if (order && orderRef) {
      // The units this report settles can't be returned or claimed again (qtyClaimed): its own item, or for an order that
      // never arrived, everything still on it.
      const lines = oLines.map((l: any) => (cur.lineId
        ? (l.lineId === cur.lineId ? { ...l, qtyClaimed: n(l.qtyClaimed) + units } : l)
        : { ...l, qtyClaimed: Math.max(n(l.qtyClaimed), open(l)) }));
      tx.update(orderRef, { pendingRefundCents: n(order.pendingRefundCents) + cents, lines: JSON.parse(JSON.stringify(lines)) });
    }
    return { ok: true, message: 'Approved', cents };
  });
}
