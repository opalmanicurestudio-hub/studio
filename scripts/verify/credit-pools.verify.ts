// Checks the two kinds of money in depositCredits are never spent as each other (lib/credit-pools): a booking's deposit
// (it names its booking, which only the server writes) and store credit; each spent from what's left on it, only while
// it's available and not expired; store credit oldest first; a booking's deposit found for that booking first.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/credit-pools.verify.ts
import { creditAmountCents, creditExpired, creditLeftCents, isDepositCredit, isStoreCredit, pickDeposit, planCreditTake, spendable, storeCreditBalance } from '../../src/lib/credit-pools';
let f = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { f++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const now = Date.parse('2026-10-23T12:00:00Z');

console.log('which kind');
ok(isDepositCredit({ sourceAppointmentId: 'a1', amountCents: 2500 }) && !isStoreCredit({ sourceAppointmentId: 'a1' }), 'a credit naming its booking is a deposit');
ok(!isDepositCredit({ kind: 'deposit', amountCents: 2500 }) && isStoreCredit({ kind: 'deposit', amountCents: 2500 }), 'a credit that only says “deposit” (any screen can write that) is store credit, not a deposit');
ok(!isDepositCredit({ kind: 'store_credit', sourceAppointmentId: 'a1' }), 'store credit given back on a visit is still store credit');
ok(!isDepositCredit({ sourceAppointmentId: '  ' }) && !isDepositCredit(null), 'a blank booking, or nothing: not a deposit');

console.log('what’s left on it');
ok(creditAmountCents({ amountDollars: 12.5 }) === 1250 && creditAmountCents({ amountCents: 900, amountDollars: 50 }) === 900, 'older credits wrote dollars; cents win when both are there');
ok(creditLeftCents({ amountCents: 2500, usedCents: 1000 }) === 1500 && creditLeftCents({ amountCents: 2500, usedCents: 9000 }) === 0, 'spent from what’s left, never below nothing');
ok(creditExpired({ expiresAt: '2026-10-01T00:00:00Z' }, now) && !creditExpired({ expiresAt: '2026-12-01T00:00:00Z' }, now) && !creditExpired({}, now), 'expired or not; no date never expires');
ok(spendable({ status: 'available', amountCents: 100 }, now) && !spendable({ status: 'used', amountCents: 100 }, now) && !spendable({ status: 'available', amountCents: 100, usedCents: 100 }, now) && !spendable({ status: 'available', amountCents: 100, expiresAt: '2026-10-01T00:00:00Z' }, now), 'spendable only while available, unexpired, with something left');

console.log('the store credit balance');
const docs = [
  { id: 'sc1', amountCents: 1000, usedCents: 300, status: 'available', createdAt: '2026-09-01' },
  { id: 'dep', amountCents: 2500, status: 'available', sourceAppointmentId: 'a1', createdAt: '2026-08-01' },
  { id: 'sc2', amountCents: 2000, status: 'available', createdAt: '2026-10-01' },
  { id: 'old', amountCents: 5000, status: 'available', createdAt: '2026-07-01', expiresAt: '2026-10-01T00:00:00Z' },
  { id: 'used', amountCents: 5000, status: 'used', createdAt: '2026-06-01' },
];
ok(storeCreditBalance(docs, now) === 2700, 'the balance is store credit only, from what’s left: $7.00 + $20.00 (not the deposit, the expired or the used)', storeCreditBalance(docs, now));

console.log('spending it');
const sc = docs.filter(isStoreCredit);
let p = planCreditTake(sc, 1500, now);
ok(p.taken === 1500 && p.takes.length === 2 && sc[p.takes[0].index].id === 'sc1' && p.takes[0].take === 700 && p.takes[0].used && p.takes[1].take === 800 && !p.takes[1].used && p.takes[1].usedAfter === 800, 'oldest first, each from what’s left on it', p);
p = planCreditTake(sc, 9999, now);
ok(p.taken === 2700, 'more than there is: what’s there, and it says how much', p.taken);
ok(planCreditTake(sc, 0, now).takes.length === 0, 'nothing asked: nothing taken');

console.log('a booking’s deposit');
const deps = [
  { id: 'd-a1', amountCents: 2500, status: 'available', sourceAppointmentId: 'a1', createdAt: '2026-10-01' },
  { id: 'd-a9', amountCents: 2500, status: 'available', sourceAppointmentId: 'a9', createdAt: '2026-10-20' },
  { id: 'd-a5', amountCents: 2500, status: 'available', sourceAppointmentId: 'a5', createdAt: '2026-10-10' },
  { id: 'store', amountCents: 9000, status: 'available', createdAt: '2026-10-22' },
];
const upcoming = (id: string) => id === 'a9';
ok(pickDeposit(deps, ['a1'], upcoming, now)?.id === 'd-a1', 'the deposit for this booking first');
ok(pickDeposit(deps, ['a2'], upcoming, now)?.id === 'd-a5', 'a booking moved to a new time keeps its first booking’s deposit, never one for a visit still to come');
ok(pickDeposit([deps[1], deps[3]], ['a2'], upcoming, now) === null, 'only store credit and another visit’s deposit: no deposit (store credit never stands in for one)');

if (f) { console.error(`${f} failed`); process.exit(1); } console.log('credit-pools ok');
