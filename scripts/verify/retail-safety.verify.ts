import { makePrintKey, checkPrintKey } from '../../src/lib/print-key';
import { reservedByOpenReturns } from '../../src/lib/return-reserve';
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } };
const now = 1_800_000_000_000;
const { k, x } = makePrintKey('t1', 'loss-recovery', now);
ok(checkPrintKey('t1', 'loss-recovery', k, x, now + 60000), 'valid key passes');
ok(!checkPrintKey('t2', 'loss-recovery', k, x, now), 'other business fails');
ok(!checkPrintKey('t1', 'evidence:o1', k, x, now), 'other page fails');
ok(!checkPrintKey('t1', 'loss-recovery', k, x, now + 16 * 60000), 'expired fails');
ok(!checkPrintKey('t1', 'loss-recovery', k, x + 1, now), 'tampered expiry fails');
ok(!checkPrintKey('t1', 'loss-recovery', '', x, now), 'empty key fails');
const rets = [
  { status: 'open', lines: [{ lineId: 'a', qty: 2 }, { lineId: 'b', qty: 1, disposition: 'restock' }] },
  { status: 'received', lines: [{ lineId: 'a', qty: 1 }] },
  { status: 'resolved', lines: [{ lineId: 'a', qty: 5 }] },
];
ok(reservedByOpenReturns(rets, 'a') === 3, 'open + received unscanned count');
ok(reservedByOpenReturns(rets, 'b') === 0, 'scanned lines already counted on the order');
ok(reservedByOpenReturns([], 'a') === 0, 'none');
if (fails) process.exit(1); console.log('retail-safety ok');
import { cardPaidCents, cardRefundableCents } from '../../src/lib/retail-money';
{
  let f = 0; const ok = (c: boolean, m: string) => { if (!c) { f++; console.error('FAIL', m); } };
  ok(cardPaidCents({ chargedCents: 4200, totalCents: 5000 }) === 4200, 'recorded charge wins');
  ok(cardPaidCents({ totalCents: 5000, storeCreditRequestedCents: 1000, giftCardCents: 500 }) === 3500, 'flat mode subtracts credit and gift card');
  ok(cardPaidCents({ totalCents: 4800, taxMode: 'stripe', storeCreditRequestedCents: 1000 }) === 4800, 'stripe mode total is already post-discount');
  ok(cardRefundableCents({ chargedCents: 4200, refundedCents: 1200 }) === 3000, 'less refunded');
  ok(cardRefundableCents({ chargedCents: 0, refundedCents: 0 }) === 0, 'full credit order has nothing to refund to the card');
  if (f) process.exit(1); console.log('retail-money ok');
}
