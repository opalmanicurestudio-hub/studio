// Checks Before the visit extras: the deposit top-up rule (lib/prep-topup), the top-up payment record
// (lib/prep-check-server), and the answer-accuracy report (lib/prep-accuracy).
// Run: npx tsx scripts/verify/prep-extras.verify.ts
import { topUpDue, depositPaidCents } from '../../src/lib/prep-topup';
import { accuracyOf } from '../../src/lib/prep-accuracy';
import { isSoloTeam } from '../../src/lib/solo';
import { prepTopUpPaid, prepDeskKey, prepKey } from '../../src/lib/prep-check-server';
import { makeDb, strictTransactions } from './fake-db';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const store = (p: string) => db._store.get(p);
const db: any = strictTransactions(makeDb());

(async () => {
  const paid = { depositStatus: 'paid', depositAmountCents: 2000 };
  ok(depositPaidCents(paid) === 2000 && depositPaidCents({ depositAmountCents: 2000 }) === 0, 'only a paid deposit counts');
  ok(topUpDue({ mode: 'off', overCents: 0, pct: 0 }, paid, 80, 100) === 0, 'off → keep the deposit');
  ok(topUpDue({ mode: 'percent', overCents: 0, pct: 25 }, paid, 80, 100) === 500, '25% of $100 = $25 → $5 more');
  ok(topUpDue({ mode: 'over', overCents: 1000, pct: 0 }, paid, 80, 100) === 500, 'rose $20 (over $10) → deposit grows in step: $25');
  ok(topUpDue({ mode: 'over', overCents: 2500, pct: 0 }, paid, 80, 100) === 0, 'rose $20 (not over $25) → nothing');
  ok(topUpDue({ mode: 'percent', overCents: 0, pct: 25 }, { depositAmountCents: 0 }, 80, 100) === 0, 'no deposit at booking → none added');
  ok(topUpDue({ mode: 'percent', overCents: 0, pct: 25 }, paid, 80, 82) === 0, 'under $1 isn’t asked for');
  ok(topUpDue({ mode: 'percent', overCents: 0, pct: 25 }, paid, 100, 90) === 0, 'price went down → nothing');

  ok(prepDeskKey('t', 'a') !== prepKey('t', 'a') && prepDeskKey('t', 'a') === prepDeskKey('t', 'a'), 'the desk link has its own key');

  await db.doc('tenants/t/appointments/a').set({ clientId: 'c', clientName: 'Kim', serviceName: 'Gel fill', depositStatus: 'paid', depositAmountCents: 2000, depositTopUp: { cents: 500, status: 'due' } });
  await db.doc('tenants/t/depositCredits/dc').set({ amountCents: 2000, status: 'available', sourceAppointmentId: 'a', kind: 'deposit' });
  await prepTopUpPaid(db, 't', 'a', { cents: 500, sessionId: 's1' });
  ok(store('tenants/t/appointments/a').depositAmountCents === 2500 && store('tenants/t/appointments/a').depositTopUp.status === 'paid', 'paid → the deposit is now $25');
  ok(store('tenants/t/depositCredits/dc').amountCents === 2500, 'the credit that comes off at checkout grows too');
  const incomes = () => [...db._store.keys()].filter((k: string) => k.includes('/transactions/'));
  await prepTopUpPaid(db, 't', 'a', { cents: 500, sessionId: 's1' });
  ok(store('tenants/t/appointments/a').depositAmountCents === 2500 && incomes().length === 1, 'the same payment twice changes nothing');
  // Two notices for one payment at once (Stripe sends the same event twice): added once.
  await db.doc('tenants/t/appointments/b').set({ clientId: 'c', clientName: 'Kim', serviceName: 'Gel fill', depositStatus: 'paid', depositAmountCents: 2000, depositTopUp: { cents: 500, status: 'due' } });
  await db.doc('tenants/t/depositCredits/db1').set({ amountCents: 2000, status: 'available', sourceAppointmentId: 'b', kind: 'deposit' });
  const both = await Promise.all([prepTopUpPaid(db, 't', 'b', { cents: 500, sessionId: 's2' }), prepTopUpPaid(db, 't', 'b', { cents: 500, sessionId: 's2' })]);
  ok(store('tenants/t/appointments/b').depositAmountCents === 2500 && store('tenants/t/depositCredits/db1').amountCents === 2500 && incomes().length === 2 && both.some((x: any) => x.already), 'two notices at once: the deposit, its credit and the income go up once');
  // No open deposit on the visit (used at the desk already): a new deposit credit is made for the top-up, tied to the visit.
  await db.doc('tenants/t/appointments/c').set({ clientId: 'c', clientName: 'Kim', serviceName: 'Gel fill', depositStatus: 'paid', depositAmountCents: 2000, depositTopUp: { cents: 500, status: 'due' } });
  await prepTopUpPaid(db, 't', 'c', { cents: 500, sessionId: 's3' });
  const made = store('tenants/t/depositCredits/topup_s3');
  ok(made && made.amountCents === 500 && made.kind === 'deposit' && made.sourceAppointmentId === 'c', 'no open deposit: one made for the top-up, as a deposit for that visit');

  const past = '2026-09-01T15:00:00Z'; const v = (o: any) => ({ startTime: past, serviceName: 'Gel fill', prepSentAt: past, status: 'completed', ...o });
  const rows = [v({ prep: { answeredAt: past } }), v({ prep: { answeredAt: past }, dayChanges: [{ answer: 'yes' }] }), v({}), v({ dayChanges: [{ answer: 'no' }] }), v({ status: 'cancelled', prep: { answeredAt: past } }), { startTime: past, serviceName: 'Lash fill', status: 'completed' }];
  const r = accuracyOf(rows, Date.parse('2026-10-01'));
  const g = r.rows.find((x) => x.service === 'Gel fill')!;
  ok(r.rows.length === 1 && g.asked === 4 && g.answered === 2 && g.matched === 1 && g.moreAfterAnswer === 1 && g.moreNoAnswer === 1, 'accuracy: asked 4, answered 2, 1 matched, 1 more after answering, 1 more with no answer');
  const many = Array.from({ length: 6 }, (_, i) => v({ prep: { answeredAt: past }, ...(i < 2 ? { dayChanges: [{}] } : {}) }));
  ok(accuracyOf(many, Date.parse('2026-10-01')).tips.some((t) => /2 of 6/.test(t)), 'a tip when answers often miss');
  ok(isSoloTeam([{ id: 'o', role: 'owner' }, { id: 'r', role: 'renter' }, { id: 'x', isActive: false }]), 'an owner with renters (and a past staff member) is a one-person business');
  ok(!isSoloTeam([{ id: 'o', role: 'owner' }, { id: 'm', role: 'stylist' }]), 'owner + one provider is a team');
  console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
})();
