// Checks what a cancelled order gives back besides the card (lib/cancel-restore). Store credit comes back only when it
// was really spent: a checkout left unpaid (cancelled when its payment page expired) gives nothing back, however often
// it happens. A gift card goes back only when it was charged. Each order gives back once, never more than is left after
// a refund already gave some back that way, and the card pays first for anything the customer keeps. What was paid
// that way is the server's own record of it (written in the same step as the money was taken); an order from before
// the record was kept is matched to what only the server writes, part by part, and one made up in a browser gets
// nothing back.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/cancel-restore.verify.ts
import { makeDb, check, failures } from './fake-db';

const T = 'tenants/t1';
(async () => {
  const { restoreNonCardPayment } = await import('../../src/lib/cancel-restore');
  const db = makeDb();
  const credits = async () => (await db.collection(`${T}/depositCredits`).get()).docs.map((d: any) => d.data());
  const get = async (path: string) => (await db.doc(path).get()).data() || null;
  const base = { tenantId: 't1', orderNumber: 1080, stage: 'cancelled', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', totalCents: 4000 };
  // What the server wrote down when it took the money.
  const took = (id: string, part: any) => db.doc(`${T}/private/nonCardPaid/orders/${id}`).set({ at: '2026-10-20T15:00:00Z', ...part }, { merge: true });

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
  await took('paid', { creditCents: 2500 });
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
  await took('short', { creditCents: 2000 });
  r = await restoreNonCardPayment(db, 't1', 'short', 'Order cancelled');
  check('only what was really spent comes back: $20 of the $25 asked for', r.creditCents === 2000);

  // Paid before the record was kept: $25 of credit added in September, marked used on the order by the server when it
  // was paid (a later change to it).
  await db.doc(`${T}/depositCredits/old1`).set({ id: 'old1', tenantId: 't1', clientEmail: 'dana@example.com', amountCents: 2500, status: 'available', createdAt: '2026-09-01T10:00:00Z' });
  await db.doc(`${T}/depositCredits/old1`).set({ usedCents: 2500, status: 'used', lastUsedAt: '2026-09-01T15:00:00Z', lastUsedOnRetailOrderId: 'older' }, { merge: true });
  await db.doc(`${T}/retailOrders/older`).set({ ...base, paidAt: '2026-09-01T15:00:00Z', storeCreditRequestedCents: 2500 });
  r = await restoreNonCardPayment(db, 't1', 'older', 'Order cancelled');
  check('an order paid before the record was kept: the credit the server marked used on it comes back', r.creditCents === 2500 && (await get(`${T}/private/nonCardPaid/orders/older`))?.creditCents === 2500, r);

  // Made up in a browser before the new rules: cancelled, claiming $500 on a gift card and $300 of credit it never used.
  await db.doc(`${T}/giftCards/gx`).set({ id: 'gx', code: 'GIFT-0001', balanceCents: 0, status: 'active', history: [{ at: '2026-10-01T10:00:00Z', type: 'spend', cents: -1500, balanceAfter: 0, ref: 'someoneElse' }] });
  await db.doc(`${T}/retailOrders/fk`).set({ ...base, giftCardId: 'gx', giftCardCode: 'GIFT-0001', giftCardCents: 50000, giftSpentAt: '2026-10-01T10:00:00Z', storeCreditRequestedCents: 30000, creditShortfallCents: 0 });
  const before = (await credits()).length;
  r = await restoreNonCardPayment(db, 't1', 'fk', 'Nightly check');
  const fkEv = (await db.collection(`${T}/retailOrders/fk/events`).get()).docs.map((d: any) => d.data()).filter((e: any) => e.meta?.kind === 'non_card_unconfirmed');
  check('an order made up in a browser gives nothing back, whatever its own fields say, and says why in its history',
    r.giftCents + r.creditCents === 0 && (await get(`${T}/giftCards/gx`)).balanceCents === 0 && (await credits()).length === before && fkEv.length === 1 && /\$500\.00 paid by gift card/.test(fkEv[0].meta.text) && /\$300\.00 paid by store credit/.test(fkEv[0].meta.text), { r, fkEv });
  check('…and it’s marked as checked, so the nightly check doesn’t look at it again', !!(await get(`${T}/retailOrders/fk`)).nonCardRestoredAt);

  await db.doc(`${T}/retailOrders/gift`).set({ ...base, giftCardId: 'g1', giftCardCents: 1500 });
  r = await restoreNonCardPayment(db, 't1', 'gift', 'Nightly check');
  check('a gift card that was set aside but never charged isn’t topped up, and nothing is flagged: the order never said it was paid',
    r.giftCents === 0 && (await db.collection(`${T}/retailOrders/gift/events`).get()).size === 0);

  // Paid $40: $25 on the card and $15 on gift card GIFT-1234. A refund already gave $5 back to the gift card.
  await db.doc(`${T}/giftCards/g2`).set({ id: 'g2', code: 'GIFT-1234', balanceCents: 500, status: 'active', history: [] });
  const mixed = { ...base, paidAt: '2026-10-20T15:00:00Z', stripePaymentIntentId: 'pi_2', chargedCents: 2500, giftCardId: 'g2', giftCardCode: 'GIFT-1234', giftCardCents: 1500, giftSpentAt: '2026-10-20T15:00:00Z' };
  await db.doc(`${T}/retailOrders/mixed`).set({ ...mixed, refundedCents: 2500, nonCardRestored: { giftCents: 500, creditCents: 0 } });
  await took('mixed', { giftCents: 1500, giftCardId: 'g2' });
  r = await restoreNonCardPayment(db, 't1', 'mixed', 'Order cancelled');
  const g2 = await get(`${T}/giftCards/g2`);
  check('cancelled after a refund already put $5 back on the gift card: the other $10 goes back on it, not $15',
    r.giftCents === 1000 && g2.balanceCents === 1500 && g2.history.length === 1 && g2.history[0].cents === 1000 && (await get(`${T}/retailOrders/mixed`)).nonCardRestored.giftCents === 1500, { r, g2 });

  // The same order, cancelled with its $30 backorder already sent: Dana keeps $30 of the $40. The card's $25 pays for
  // it first, and $5 of the gift card part, so $10 goes back on the gift card.
  await db.doc(`${T}/giftCards/g3`).set({ id: 'g3', code: 'GIFT-5678', balanceCents: 0, status: 'active', history: [] });
  await db.doc(`${T}/retailOrders/fam`).set({ ...mixed, giftCardId: 'g3', giftCardCode: 'GIFT-5678', qrToken: 'qrF', pendingRefundCents: 0 });
  await took('fam', { giftCents: 1500, giftCardId: 'g3' });
  await db.doc(`${T}/retailOrders/famBo`).set({ tenantId: 't1', orderNumber: 1080, stage: 'shipped', parentOrderId: 'fam', qrToken: 'qrF', totalCents: 0, subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0,
    lines: [{ lineId: 'B1', productId: 'gel', unitPriceCents: 3000, unitPaidCents: 3000, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0, status: 'pending' }], taxBasis: { subtotalCents: 4000, taxCents: 0, discountCents: 0 } });
  r = await restoreNonCardPayment(db, 't1', 'fam', 'Order cancelled');
  check('cancelled while its $30 backorder went out: the card pays for what she keeps first, so $10 of the $15 goes back on the gift card', r.giftCents === 1000 && (await get(`${T}/giftCards/g3`)).balanceCents === 1000, r);

  // A refund for $30 was already waiting on the order when it was cancelled: it goes out card first ($25), then $5 from
  // the gift card, so $10 goes back on the gift card now. $40 in all.
  await db.doc(`${T}/giftCards/g4`).set({ id: 'g4', code: 'GIFT-9012', balanceCents: 0, status: 'active', history: [] });
  await db.doc(`${T}/retailOrders/queued`).set({ ...mixed, giftCardId: 'g4', giftCardCode: 'GIFT-9012', pendingRefundCents: 3000 });
  await took('queued', { giftCents: 1500, giftCardId: 'g4' });
  r = await restoreNonCardPayment(db, 't1', 'queued', 'Order cancelled');
  check('a refund already waiting on it is counted: $10 back on the gift card now, the rest with that refund', r.giftCents === 1000, r);

  // Everything it paid by gift card is spoken for: nothing more goes back, and it isn't looked at again every night.
  await db.doc(`${T}/giftCards/g5`).set({ id: 'g5', code: 'GIFT-3456', balanceCents: 0, status: 'active', history: [] });
  await db.doc(`${T}/retailOrders/kept`).set({ ...mixed, giftCardId: 'g5', giftCardCode: 'GIFT-3456', qrToken: 'qrK', pendingRefundCents: 0 });
  await took('kept', { giftCents: 1500, giftCardId: 'g5' });
  await db.doc(`${T}/retailOrders/keptBo`).set({ tenantId: 't1', orderNumber: 1080, stage: 'completed', parentOrderId: 'kept', qrToken: 'qrK', totalCents: 0, refundedCents: 0,
    lines: [{ lineId: 'B1', productId: 'gel', unitPriceCents: 4000, unitPaidCents: 4000, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0, status: 'pending' }], taxBasis: { subtotalCents: 4000, taxCents: 0, discountCents: 0 } });
  r = await restoreNonCardPayment(db, 't1', 'kept', 'Order cancelled');
  const keptAfter = await get(`${T}/retailOrders/kept`);
  check('when she keeps everything it paid for, nothing goes back, and the order is marked as checked', r.giftCents === 0 && (await get(`${T}/giftCards/g5`)).balanceCents === 0 && !!keptAfter.nonCardRestoredAt, { r, keptAfter });

  // $10 on the card and $30 on a gift card. The $30 backorder went out, and $20 of it was refunded since: $10 to the
  // card (all it had), then $10 back on the gift card. Cancelling the order gives back its own $10 item: on the gift card.
  await db.doc(`${T}/giftCards/g7`).set({ id: 'g7', code: 'GIFT-2468', balanceCents: 0, status: 'active', history: [] });
  await db.doc(`${T}/retailOrders/fu2`).set({ ...base, paidAt: '2026-10-20T15:00:00Z', stripePaymentIntentId: 'pi_7', chargedCents: 1000, refundedCents: 0, giftCardId: 'g7', giftCardCode: 'GIFT-2468', giftCardCents: 3000, giftSpentAt: '2026-10-20T15:00:00Z', qrToken: 'qrX', pendingRefundCents: 0, nonCardRestored: { giftCents: 1000, creditCents: 0 } });
  await took('fu2', { giftCents: 3000, giftCardId: 'g7' });
  await db.doc(`${T}/retailOrders/fu2Bo`).set({ tenantId: 't1', orderNumber: 1080, stage: 'completed', parentOrderId: 'fu2', qrToken: 'qrX', totalCents: 0, refundedCents: 1000, refundedOtherCents: 1000,
    lines: [{ lineId: 'B1', productId: 'gel', unitPriceCents: 3000, unitPaidCents: 3000, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0, status: 'pending' }], taxBasis: { subtotalCents: 4000, taxCents: 0, discountCents: 0 } });
  r = await restoreNonCardPayment(db, 't1', 'fu2', 'Order cancelled');
  check('what went back on the gift card for a backorder counts as refunded for it: the order’s own $10 still comes back', r.giftCents === 1000 && (await get(`${T}/giftCards/g7`)).balanceCents === 1000, r);

  // The gift card it was paid with has been voided since: that part comes back as store credit instead.
  await db.doc(`${T}/giftCards/g6`).set({ id: 'g6', code: 'GIFT-7890', balanceCents: 0, status: 'void', history: [] });
  await db.doc(`${T}/retailOrders/voided`).set({ ...mixed, giftCardId: 'g6', giftCardCode: 'GIFT-7890' });
  await took('voided', { giftCents: 1500, giftCardId: 'g6' });
  r = await restoreNonCardPayment(db, 't1', 'voided', 'Order cancelled');
  check('a voided gift card’s $15 comes back as store credit', r.giftCents === 0 && r.creditCents === 1500 && (await credits()).some((c: any) => c.sourceRetailOrderId === 'voided' && c.amountCents === 1500) && (await get(`${T}/giftCards/g6`)).balanceCents === 0, r);

  // ── The server's own record of what was paid by gift card or store credit (lib/non-card-back) ──
  const NC = await import('../../src/lib/non-card-back');
  const forged = { id: 'nr', stage: 'cancelled', giftCardId: 'g2', giftCardCents: 50000, giftSpentAt: '2026-11-01T10:00:00Z', storeCreditRequestedCents: 30000, creditShortfallCents: 0, orderNumber: 1 };
  const none = async () => ({ exists: false });
  let v = await NC.withNonCardRecord(none, db, 't1', 'nr', forged);
  check('an order with no record paid nothing by gift card or credit, whatever its own fields say, however old', NC.roomCents(v) === 0, v);
  await NC.recordNonCard(db, 't1', 'real', { giftCents: 1500, giftCardId: 'g2' });
  await NC.recordNonCard(db, 't1', 'real', { creditCents: 700 });
  v = await NC.withNonCardRecord((x: any) => x.get(), db, 't1', 'real', { ...forged, id: 'real' });
  check('…and one the server recorded pays back exactly what it took: $15 on the gift card, $7 of credit, not what its fields claim',
    NC.nonCardPaid(v).giftCents === 1500 && NC.nonCardPaid(v).creditCents === 700 && v.giftCardId === 'g2', NC.nonCardPaid(v));

  // A record with only one part: the other is still found, not taken as nothing. $20 on a gift card at checkout and $10
  // of credit; only the credit was written down.
  await db.doc(`${T}/retailOrders/both`).set({ ...base, paidAt: '2026-10-20T15:00:00Z', giftCardId: 'g8', giftCardCode: 'GIFT-1357', giftCardCents: 2000, giftSpentAt: '2026-10-20T15:00:00Z', storeCreditRequestedCents: 1000, creditShortfallCents: 0, totalCents: 3000 });
  await db.doc(`${T}/giftCards/g8`).set({ id: 'g8', code: 'GIFT-1357', balanceCents: 0, status: 'active', history: [{ at: new Date(Date.now() + 1000).toISOString(), type: 'spend', cents: -2000, balanceAfter: 0, by: 'Online shop', ref: 'both' }] });
  await took('both', { creditCents: 1000 });
  r = await restoreNonCardPayment(db, 't1', 'both', 'Order cancelled');
  check('a record with only the credit part: the $20 gift card part is still found and goes back, with the $10 of credit',
    r.giftCents === 2000 && r.creditCents === 1000 && (await get(`${T}/giftCards/g8`)).balanceCents === 2000, r);

  // The spend and its record are one step, and a retry of the spend isn't charged twice.
  const GC = await import('../../src/lib/gift-cards');
  await db.doc(`${T}/giftCards/g9`).set({ id: 'g9', code: 'GIFT-2222', balanceCents: 5000, status: 'active', holds: { retail_sp: { cents: 1500, until: new Date(Date.now() + 600000).toISOString() } }, history: [] });
  const recRef = NC.nonCardRecordRef(db, 't1', 'sp');
  let sp: any = await GC.spendGiftCard(db, 't1', { id: 'g9', cents: 1500, holdId: 'retail_sp', by: 'Online shop', transactionRef: 'cs_sp', record: recRef });
  const recSp = await get(`${T}/private/nonCardPaid/orders/sp`);
  check('a gift card spent on an online order is written down in the same step: $15', sp.ok && recSp?.giftCents === 1500 && recSp?.giftCardId === 'g9' && (await get(`${T}/giftCards/g9`)).balanceCents === 3500, { sp, recSp });
  sp = await GC.spendGiftCard(db, 't1', { id: 'g9', cents: 1500, holdId: 'retail_sp', by: 'Online shop', transactionRef: 'cs_sp', record: recRef });
  check('…and spending it again for the same order (a retry) takes nothing more', sp.ok && sp.already === true && (await get(`${T}/giftCards/g9`)).balanceCents === 3500 && (await get(`${T}/giftCards/g9`)).history.length === 1, sp);
  const fsMod = await import('fs');
  const shopSpends = ['src/lib/retail-webhook.ts', 'src/app/api/retail/checkout/route.ts'].flatMap((f) => [...fsMod.readFileSync(f, 'utf8').matchAll(/spendGiftCard\([^;]*\)/g)].map((m) => m[0]));
  check('the online shop’s two gift card spends (with a card payment, and paid all by gift card) both write it down in the same step',
    shopSpends.length === 2 && shopSpends.every((x) => /record: nonCardRecordRef\(db, tenantId, orderId\)/.test(x)), shopSpends);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
