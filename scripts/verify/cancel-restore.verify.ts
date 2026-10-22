// Checks what a cancelled order gives back besides the card (lib/cancel-restore). Store credit comes back only when it
// was really spent: a checkout left unpaid (cancelled when its payment page expired) gives nothing back, however often
// it happens. A gift card goes back only when it was charged. Each order gives back once, never more than is left after
// a refund already gave some back that way, and the card pays first for anything the customer keeps.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/cancel-restore.verify.ts
import { makeDb, check, failures } from './fake-db';

const T = 'tenants/t1';
(async () => {
  const { restoreNonCardPayment } = await import('../../src/lib/cancel-restore');
  const db = makeDb();
  const credits = async () => (await db.collection(`${T}/depositCredits`).get()).docs.map((d: any) => d.data());
  const get = async (path: string) => (await db.doc(path).get()).data() || null;
  const base = { tenantId: 't1', orderNumber: 1080, stage: 'cancelled', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', totalCents: 4000 };

  // Dana applies $25 of credit at checkout and leaves the payment page. The checkout expires and is cancelled.
  await db.doc(`${T}/retailOrders/draft`).set({ ...base, orderNumber: null, storeCreditRequestedCents: 2500, isDraft: true });
  let r = await restoreNonCardPayment(db, 't1', 'draft', 'Nightly check');
  check('a checkout left unpaid gives no store credit back: none was ever taken', r.creditCents === 0 && (await credits()).length === 0, r);
  r = await restoreNonCardPayment(db, 't1', 'draft', 'Nightly check');
  check('…not on the next night either', r.creditCents === 0 && (await credits()).length === 0);
  await db.doc(`${T}/retailOrders/draft2`).set({ ...base, orderNumber: null, storeCreditRequestedCents: 2500, creditSpentCents: 2500, isDraft: true });
  r = await restoreNonCardPayment(db, 't1', 'draft2', 'Nightly check');
  check('…even when the page itself wrote that the credit was spent (only the server’s record counts)', r.creditCents === 0 && (await credits()).length === 0, r);

  await db.doc(`${T}/retailOrders/paid`).set({ ...base, paidAt: '2026-10-20T15:00:00Z', storeCreditRequestedCents: 2500, creditShortfallCents: 0, stripePaymentIntentId: 'pi_1', chargedCents: 1500 });
  r = await restoreNonCardPayment(db, 't1', 'paid', 'Order cancelled');
  const c1 = (await credits()).find((c: any) => c.sourceRetailOrderId === 'paid');
  check('a paid order that used $25 of credit gives the $25 back when it’s cancelled', r.creditCents === 2500 && c1?.amountCents === 2500 && c1?.status === 'available' && c1?.sourceKind === 'order_cancelled', { r, c1 });
  const paidAfter = await get(`${T}/retailOrders/paid`);
  check('…counted on the order, so nothing gives it back twice', paidAfter.nonCardRestored?.creditCents === 2500 && !!paidAfter.nonCardRestoredAt, paidAfter);
  r = await restoreNonCardPayment(db, 't1', 'paid', 'Nightly check');
  check('…once', r.creditCents === 0 && (await credits()).length === 1);
  const books = (await db.collection(`${T}/transactions`).get()).docs.map((d: any) => d.data());
  check('…and the books show it as a refund, since the sale was booked through the card payment', books.length === 1 && books[0].category === 'Refund' && books[0].amount === 25 && books[0].paymentMethod === 'Store credit', books);

  await db.doc(`${T}/retailOrders/short`).set({ ...base, paidAt: '2026-10-20T15:00:00Z', storeCreditRequestedCents: 2500, creditShortfallCents: 500 });
  r = await restoreNonCardPayment(db, 't1', 'short', 'Order cancelled');
  check('only what was really spent comes back: $20 of the $25 asked for', r.creditCents === 2000);

  await db.doc(`${T}/retailOrders/older`).set({ ...base, paidAt: '2026-09-01T15:00:00Z', storeCreditRequestedCents: 2500 });
  r = await restoreNonCardPayment(db, 't1', 'older', 'Order cancelled');
  check('an order paid before the shortfall was always recorded gives back what was asked', r.creditCents === 2500, r);

  await db.doc(`${T}/retailOrders/gift`).set({ ...base, giftCardId: 'g1', giftCardCents: 1500 });
  r = await restoreNonCardPayment(db, 't1', 'gift', 'Nightly check');
  check('a gift card that was set aside but never charged isn’t topped up', r.giftCents === 0);

  // Paid $40: $25 on the card and $15 on gift card GIFT-1234. A refund already gave $5 back to the gift card.
  await db.doc(`${T}/giftCards/g2`).set({ id: 'g2', code: 'GIFT-1234', balanceCents: 500, status: 'active', history: [] });
  const mixed = { ...base, paidAt: '2026-10-20T15:00:00Z', stripePaymentIntentId: 'pi_2', chargedCents: 2500, giftCardId: 'g2', giftCardCode: 'GIFT-1234', giftCardCents: 1500, giftSpentAt: '2026-10-20T15:00:00Z' };
  await db.doc(`${T}/retailOrders/mixed`).set({ ...mixed, refundedCents: 2500, nonCardRestored: { giftCents: 500, creditCents: 0 } });
  r = await restoreNonCardPayment(db, 't1', 'mixed', 'Order cancelled');
  const g2 = await get(`${T}/giftCards/g2`);
  check('cancelled after a refund already put $5 back on the gift card: the other $10 goes back on it, not $15',
    r.giftCents === 1000 && g2.balanceCents === 1500 && g2.history.length === 1 && g2.history[0].cents === 1000 && (await get(`${T}/retailOrders/mixed`)).nonCardRestored.giftCents === 1500, { r, g2 });

  // The same order, cancelled with its $30 backorder already sent: Dana keeps $30 of the $40. The card's $25 pays for
  // it first, and $5 of the gift card part, so $10 goes back on the gift card.
  await db.doc(`${T}/giftCards/g3`).set({ id: 'g3', code: 'GIFT-5678', balanceCents: 0, status: 'active', history: [] });
  await db.doc(`${T}/retailOrders/fam`).set({ ...mixed, giftCardId: 'g3', giftCardCode: 'GIFT-5678', qrToken: 'qrF', pendingRefundCents: 0 });
  await db.doc(`${T}/retailOrders/famBo`).set({ tenantId: 't1', orderNumber: 1080, stage: 'shipped', parentOrderId: 'fam', qrToken: 'qrF', totalCents: 0, subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0,
    lines: [{ lineId: 'B1', productId: 'gel', unitPriceCents: 3000, unitPaidCents: 3000, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0, status: 'pending' }], taxBasis: { subtotalCents: 4000, taxCents: 0, discountCents: 0 } });
  r = await restoreNonCardPayment(db, 't1', 'fam', 'Order cancelled');
  check('cancelled while its $30 backorder went out: the card pays for what she keeps first, so $10 of the $15 goes back on the gift card', r.giftCents === 1000 && (await get(`${T}/giftCards/g3`)).balanceCents === 1000, r);

  // A refund for $30 was already waiting on the order when it was cancelled: it goes out card first ($25), then $5 from
  // the gift card, so $10 goes back on the gift card now. $40 in all.
  await db.doc(`${T}/giftCards/g4`).set({ id: 'g4', code: 'GIFT-9012', balanceCents: 0, status: 'active', history: [] });
  await db.doc(`${T}/retailOrders/queued`).set({ ...mixed, giftCardId: 'g4', giftCardCode: 'GIFT-9012', pendingRefundCents: 3000 });
  r = await restoreNonCardPayment(db, 't1', 'queued', 'Order cancelled');
  check('a refund already waiting on it is counted: $10 back on the gift card now, the rest with that refund', r.giftCents === 1000, r);

  // Everything it paid by gift card is spoken for: nothing more goes back, and it isn't looked at again every night.
  await db.doc(`${T}/giftCards/g5`).set({ id: 'g5', code: 'GIFT-3456', balanceCents: 0, status: 'active', history: [] });
  await db.doc(`${T}/retailOrders/kept`).set({ ...mixed, giftCardId: 'g5', giftCardCode: 'GIFT-3456', qrToken: 'qrK', pendingRefundCents: 0 });
  await db.doc(`${T}/retailOrders/keptBo`).set({ tenantId: 't1', orderNumber: 1080, stage: 'completed', parentOrderId: 'kept', qrToken: 'qrK', totalCents: 0, refundedCents: 0,
    lines: [{ lineId: 'B1', productId: 'gel', unitPriceCents: 4000, unitPaidCents: 4000, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0, status: 'pending' }], taxBasis: { subtotalCents: 4000, taxCents: 0, discountCents: 0 } });
  r = await restoreNonCardPayment(db, 't1', 'kept', 'Order cancelled');
  const keptAfter = await get(`${T}/retailOrders/kept`);
  check('when she keeps everything it paid for, nothing goes back, and the order is marked as checked', r.giftCents === 0 && (await get(`${T}/giftCards/g5`)).balanceCents === 0 && !!keptAfter.nonCardRestoredAt, { r, keptAfter });

  // The gift card it was paid with has been voided since: that part comes back as store credit instead.
  await db.doc(`${T}/giftCards/g6`).set({ id: 'g6', code: 'GIFT-7890', balanceCents: 0, status: 'void', history: [] });
  await db.doc(`${T}/retailOrders/voided`).set({ ...mixed, giftCardId: 'g6', giftCardCode: 'GIFT-7890' });
  r = await restoreNonCardPayment(db, 't1', 'voided', 'Order cancelled');
  check('a voided gift card’s $15 comes back as store credit', r.giftCents === 0 && r.creditCents === 1500 && (await credits()).some((c: any) => c.sourceRetailOrderId === 'voided' && c.amountCents === 1500) && (await get(`${T}/giftCards/g6`)).balanceCents === 0, r);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
