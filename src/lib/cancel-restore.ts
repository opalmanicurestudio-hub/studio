// src/lib/cancel-restore.ts — A CANCELLED ORDER GIVES BACK MORE THAN THE CARD PAYMENT. Whatever came off a gift card
// goes back onto that card, and whatever store credit was spent comes back as new store credit: only what was really
// taken (a checkout left unpaid took nothing), less anything that already went back that way for a refund
// (lib/non-card-back). When the customer keeps something made from the order (a backorder that already went out), the
// card pays for that first, and what it can't cover stays with the shop out of the gift card or credit part. One
// transaction with the gift card and the credit, so a retry can never give it twice; the order is stamped once
// everything due has gone back. Server only.
import { giveBackLine, readGift, roomCents, saleBooked, withNonCardRecord, writeGiveBack } from './non-card-back';
import { cancelWithFollowUps, familyRefundableCents, followUpsOf } from './order-family';

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));

export async function restoreNonCardPayment(db: any, t: string, orderId: string, by: string): Promise<{ giftCents: number; creditCents: number }> {
  const col = db.collection(`tenants/${t}/retailOrders`);
  const ref = col.doc(orderId);
  let out = { giftCents: 0, creditCents: 0 };
  let order: any = null;
  await db.runTransaction(async (tx: any) => {
    out = { giftCents: 0, creditCents: 0 };
    order = null;
    const s = await tx.get(ref); if (!s.exists) return;
    // What it paid by gift card or store credit, from the server's own record (lib/non-card-back).
    const o: any = await withNonCardRecord((r: any) => tx.get(r), db, t, orderId, s, { ...(s.data() || {}), id: orderId });
    if (o.stage !== 'cancelled' || o.nonCardRestoredAt) return;
    const room = roomCents(o);
    if (room <= 0) return;
    // What the shop still holds for the order, card and gift card or credit together, less what the customer keeps
    // from orders made from it and every refund already queued (those go back card first): the rest goes back now.
    const fam = await followUpsOf((r: any) => tx.get(r), col, orderId);
    const { spokenCents } = cancelWithFollowUps(o, fam, () => false);
    const want = Math.min(room, Math.max(0, familyRefundableCents(o, fam) + room - spokenCents - c0(o.pendingRefundCents)));
    const gift = want > 0 ? await readGift(tx, db, t, o) : null;
    const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
    const at = new Date().toISOString();
    const g = want > 0
      ? writeGiveBack(tx, db, t, ref, o, gift, want, { note: `Order ${num} cancelled`, by, kind: 'order_cancelled', forOrderId: orderId })
      : { giftCents: 0, creditCents: 0, toCreditFromGift: 0 };
    out = { giftCents: g.giftCents, creditCents: g.creditCents };
    order = o;
    tx.update(ref, { nonCardRestoredAt: at });
    const given = g.giftCents + g.creditCents;
    // The sale was booked as income through the card payment, gift card and credit included: their return is a refund.
    if (given > 0 && saleBooked(o)) {
      const txnRef = db.collection(`tenants/${t}/transactions`).doc();
      tx.set(txnRef, {
        id: txnRef.id, date: at, description: `Refund to ${g.giftCents && !g.creditCents ? 'gift card' : g.creditCents && !g.giftCents ? 'store credit' : 'gift card and store credit'} — Order #${o.orderNumber} cancelled`,
        clientOrVendor: o.customerName || 'Guest', type: 'expense', context: 'Business', category: 'Refund', taxBucket: 'refund',
        amount: given / 100, paymentMethod: g.giftCents && !g.creditCents ? 'Gift card' : 'Store credit', hasReceipt: true, retailOrderId: orderId, tenantId: t,
      });
    }
    const ev = ref.collection('events').doc();
    tx.set(ev, {
      id: ev.id, type: 'note', at, actorId: 'system', actorName: by,
      meta: { kind: 'non_card_restored', giftCents: g.giftCents, creditCents: g.creditCents, text: given > 0 ? giveBackLine(o, g) : 'Nothing more to give back on the gift card or store credit: it covers what the customer kept, or a refund already waiting to go out.' },
    });
  });
  if (out.giftCents > 0 && order?.giftCardId) {
    try {
      const { syncClientGift } = await import('./gift-cards');
      const g = await db.doc(`tenants/${t}/giftCards/${String(order.giftCardId)}`).get();
      await syncClientGift(db, t, g.data()?.recipientId);
    } catch { /* the wallet catches up */ }
  }
  return out;
}
