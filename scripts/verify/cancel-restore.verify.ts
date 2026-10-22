// Checks what a cancelled order gives back besides the card (lib/cancel-restore). Store credit comes back only when it
// was really spent: a checkout left unpaid (cancelled when its payment page expired) gives nothing back, however often
// it happens. A gift card goes back only when it was charged. Each order gives back once.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/cancel-restore.verify.ts
import { makeDb, check, failures } from './fake-db';

const T = 'tenants/t1';
(async () => {
  const { restoreNonCardPayment } = await import('../../src/lib/cancel-restore');
  const db = makeDb();
  const credits = async () => (await db.collection(`${T}/depositCredits`).get()).docs.map((d: any) => d.data());
  const base = { tenantId: 't1', orderNumber: 1080, stage: 'cancelled', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', totalCents: 4000 };

  // Dana applies $25 of credit at checkout and leaves the payment page. The checkout expires and is cancelled.
  await db.doc(`${T}/retailOrders/draft`).set({ ...base, storeCreditRequestedCents: 2500, isDraft: true });
  let r = await restoreNonCardPayment(db, 't1', 'draft', 'Nightly check');
  check('a checkout left unpaid gives no store credit back: none was ever taken', r.creditCents === 0 && (await credits()).length === 0, r);
  r = await restoreNonCardPayment(db, 't1', 'draft', 'Nightly check');
  check('…not on the next night either', r.creditCents === 0 && (await credits()).length === 0);

  await db.doc(`${T}/retailOrders/paid`).set({ ...base, paidAt: '2026-10-20T15:00:00Z', storeCreditRequestedCents: 2500, creditSpentCents: 2500 });
  r = await restoreNonCardPayment(db, 't1', 'paid', 'Order cancelled');
  check('a paid order that used $25 of credit gives the $25 back when it’s cancelled', r.creditCents === 2500 && (await credits()).some((c: any) => c.amountCents === 2500 && c.sourceRetailOrderId === 'paid'));
  r = await restoreNonCardPayment(db, 't1', 'paid', 'Nightly check');
  check('…once', r.creditCents === 0 && (await credits()).length === 1);

  await db.doc(`${T}/retailOrders/short`).set({ ...base, paidAt: '2026-10-20T15:00:00Z', storeCreditRequestedCents: 2500, creditSpentCents: 2000, creditShortfallCents: 500 });
  r = await restoreNonCardPayment(db, 't1', 'short', 'Order cancelled');
  check('only what was really spent comes back: $20 of the $25 asked for', r.creditCents === 2000);

  await db.doc(`${T}/retailOrders/older`).set({ ...base, paidAt: '2026-09-01T15:00:00Z', storeCreditRequestedCents: 2500, creditShortfallCents: 500 });
  r = await restoreNonCardPayment(db, 't1', 'older', 'Order cancelled');
  check('an order paid before the amount spent was recorded gives back what was asked, less the shortfall', r.creditCents === 2000);

  await db.doc(`${T}/retailOrders/gift`).set({ ...base, giftCardId: 'g1', giftCardCents: 1500 });
  r = await restoreNonCardPayment(db, 't1', 'gift', 'Nightly check');
  check('a gift card that was set aside but never charged isn’t topped up', r.giftCents === 0);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
