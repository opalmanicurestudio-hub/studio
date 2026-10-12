// Checks Before the visit extras: the deposit top-up rule (lib/prep-topup), the top-up payment record
// (lib/prep-check-server), and the answer-accuracy report (lib/prep-accuracy).
// Run: npx tsx scripts/verify/prep-extras.verify.ts
import { topUpDue, depositPaidCents } from '../../src/lib/prep-topup';
import { accuracyOf } from '../../src/lib/prep-accuracy';
import { prepTopUpPaid, prepDeskKey, prepKey } from '../../src/lib/prep-check-server';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const store: Record<string, any> = {};
const docRef = (p: string) => ({ get: async () => ({ exists: !!store[p], data: () => store[p] }), set: async (v: any, o?: any) => { store[p] = o?.merge ? { ...(store[p] || {}), ...v } : v; } });
let n = 0;
const coll = (p: string) => { const rows = () => Object.entries(store).filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => v, ref: docRef(k) }));
  return { get: async () => ({ docs: rows() }), where: (f: string, _o: string, val: any) => ({ get: async () => ({ docs: rows().filter((d) => d.data()[f] === val) }) }), doc: (id?: string) => docRef(`${p}/${id || `n${++n}`}`) }; };
const db: any = { doc: docRef, collection: coll };

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

  store['tenants/t/appointments/a'] = { clientId: 'c', clientName: 'Kim', serviceName: 'Gel fill', depositStatus: 'paid', depositAmountCents: 2000, depositTopUp: { cents: 500, status: 'due' } };
  store['tenants/t/depositCredits/dc'] = { amountCents: 2000, status: 'available', sourceAppointmentId: 'a' };
  await prepTopUpPaid(db, 't', 'a', { cents: 500, sessionId: 's1' });
  ok(store['tenants/t/appointments/a'].depositAmountCents === 2500 && store['tenants/t/appointments/a'].depositTopUp.status === 'paid', 'paid → the deposit is now $25');
  ok(store['tenants/t/depositCredits/dc'].amountCents === 2500, 'the credit that comes off at checkout grows too');
  await prepTopUpPaid(db, 't', 'a', { cents: 500, sessionId: 's1' });
  ok(store['tenants/t/appointments/a'].depositAmountCents === 2500 && Object.keys(store).filter((k) => k.includes('/transactions/')).length === 1, 'the same payment twice changes nothing');

  const past = '2026-09-01T15:00:00Z'; const v = (o: any) => ({ startTime: past, serviceName: 'Gel fill', prepSentAt: past, status: 'completed', ...o });
  const rows = [v({ prep: { answeredAt: past } }), v({ prep: { answeredAt: past }, dayChanges: [{ answer: 'yes' }] }), v({}), v({ dayChanges: [{ answer: 'no' }] }), v({ status: 'cancelled', prep: { answeredAt: past } }), { startTime: past, serviceName: 'Lash fill', status: 'completed' }];
  const r = accuracyOf(rows, Date.parse('2026-10-01'));
  const g = r.rows.find((x) => x.service === 'Gel fill')!;
  ok(r.rows.length === 1 && g.asked === 4 && g.answered === 2 && g.matched === 1 && g.moreAfterAnswer === 1 && g.moreNoAnswer === 1, 'accuracy: asked 4, answered 2, 1 matched, 1 more after answering, 1 more with no answer');
  const many = Array.from({ length: 6 }, (_, i) => v({ prep: { answeredAt: past }, ...(i < 2 ? { dayChanges: [{}] } : {}) }));
  ok(accuracyOf(many, Date.parse('2026-10-01')).tips.some((t) => /2 of 6/.test(t)), 'a tip when answers often miss');
  console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
})();
