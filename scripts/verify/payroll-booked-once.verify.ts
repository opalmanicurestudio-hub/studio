// Checks payroll is booked once, the team's pay is private, and payroll is open to the roles that run it (the payroll
// audit, round 2):
//   Recording payday (api/payroll/record, lib/payday-record) writes one line for the employees' pay, one for contractors
//   and one for cash tips taken home, never a line per person; who was paid what is kept in a payroll run only payroll
//   reads. Once per pay period, whoever records it. A payroll company's withdrawal the bank already booked for these
//   dates is the employees' pay: it's claimed, not booked again.
//   The other way round (lib/payroll-bank, lib/plaid-sync): withdrawals after payday was recorded are matched against the
//   pay it booked until it's used up, and only what's beyond it is booked, as payroll taxes. Undoing the match frees it.
//   The payroll register shows a recorded payday person by person, from its run.
//   A manager (or any role that runs payroll or approves time) gets Payday, Timesheets and the Gusto routes; the rules let
//   those roles read what Payday needs and fix hours.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/payroll-booked-once.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const dbs: any[] = []; let current: any = null;
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => current, getAdminAuth: () => ({ getUser: async () => ({ email: '' }) }) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => current, FieldValue: FV };
  return load.call(this, request, ...rest);
};
const src = (f: string) => fs.readFileSync(f, 'utf8');
// (A business whose payroll company works out the taxes: payroll run in ClarityFlow is scripts/verify/payroll-self-run.)
const tenant = { timezone: 'America/New_York', workweekStartsOn: 1, payroll: { cadence: 'bi-weekly', periodAnchor: '2026-11-02', paydayAfterDays: 4 }, payrollTax: { runBy: 'company' } };

(async () => {
  const R = await import('../../src/lib/payday-record');
  const B = await import('../../src/lib/payroll-bank');
  const RB = await import('../../src/lib/report-builders');

  console.log('what Payday sends is checked');
  const good = { periodKey: '2026-11-16_2026-11-29', from: '2026-11-16', to: '2026-11-29', people: [{ staffId: 'a', name: 'Ana', amount: 772.5, cash: 40, contractor: false }], setAsides: [{ key: 'tax', label: 'Taxes (GA)', amount: 100 }] };
  check('a payday with its dates, each person’s pay and the set-asides is taken', typeof R.cleanPayday(good) === 'object');
  check('wrong dates, dates that don’t match, pay that isn’t a number, a made-up set-aside or nothing at all are refused',
    typeof R.cleanPayday({ ...good, from: '2026-11-30' }) === 'string' && typeof R.cleanPayday({ ...good, periodKey: 'x' }) === 'string'
    && typeof R.cleanPayday({ ...good, people: [{ staffId: 'a', amount: 'lots' }] }) === 'string' && typeof R.cleanPayday({ ...good, people: [{ staffId: 'a/b', amount: 1 }] }) === 'string'
    && typeof R.cleanPayday({ ...good, setAsides: [{ key: 'opex', amount: 5 }] }) === 'string' && typeof R.cleanPayday({ ...good, people: [], setAsides: [] }) === 'string');

  console.log('recording payday');
  const db = makeDb(); current = db; dbs.push(db);
  await db.doc('tenants/t1').set(tenant);
  const input: any = R.cleanPayday({ ...good, people: [
    { staffId: 'a', name: 'Ana Ruiz', amount: 772.5, cash: 40, contractor: false },
    { staffId: 'b', name: 'Bo Kim', amount: 500, cash: 0, contractor: false },
    { staffId: 'n', name: 'Nia Cole', amount: -20, cash: 40, contractor: false },
    { staffId: 'c', name: 'Cy Lee', amount: 900, cash: 0, contractor: true },
  ] });
  const now = '2026-12-01T15:00:00.000Z';
  const r1: any = await R.recordPayday(db, 't1', tenant, input, { id: 'mgr', name: 'Mo' }, now);
  const all = (await db.collection('tenants/t1/transactions').get()).docs.map((d: any) => d.data());
  const k = '2026-11-16_2026-11-29'; const line = (id: string) => all.find((t: any) => t.id === id);
  check('recorded', r1.ok === true && r1.viaBankCents === 0, r1);
  check('one line for the employees’ pay (never below nothing for anyone), one for contractors, one for cash tips, and the set-asides',
    line(`payday_${k}_team`)?.amount === 1272.5 && line(`payday_${k}_team`)?.category === 'Payroll' && line(`payday_${k}_contractors`)?.amount === 900 && line(`payday_${k}_contractors`)?.category === 'Contract Labor'
    && line(`paydaycash_${k}`)?.amount === 60 && line(`paydaycash_${k}`)?.paymentMethod === 'Cash' && line(`setaside_${k}_tax`)?.amount === 100 && all.length === 4, all.map((t: any) => [t.id, t.amount]));
  check('…cash tips never booked above what the person earned (Nia earned $20 all told)', (await db.doc('tenants/t1/payrollRuns/payday_' + k).get()).data()?.people.find((p: any) => p.staffId === 'n')?.cashTips === 20);
  check('no line in the books names anyone or carries their id: the team can read the books', all.every((t: any) => !t.staffId && !/Ana|Bo |Nia|Cy /.test(`${t.description} ${t.clientOrVendor}`)), all.map((t: any) => t.description));
  const run: any = (await db.doc(`tenants/t1/payrollRuns/payday_${k}`).get()).data();
  check('who was paid what is kept in the payroll run, which only payroll reads', run?.kind === 'payday' && run.people.length === 4 && run.people.find((p: any) => p.staffId === 'a')?.paid === 772.5 && run.employeesTotal === 1272.5 && run.recordedBy?.name === 'Mo', run);
  check('every line carries the pay period, so the dates are known as recorded', all.every((t: any) => t.paydayPeriod === k && t.paydayFrom === '2026-11-16' && t.paydayTo === '2026-11-29'));
  const again: any = await R.recordPayday(db, 't1', tenant, input, {}, now);
  const shorter: any = await R.recordPayday(db, 't1', tenant, R.cleanPayday({ ...good, periodKey: '2026-11-17_2026-11-29', from: '2026-11-17' }) as any, {}, now);
  check('once per pay period: the same dates again, or dates that overlap them, are refused and nothing is added',
    again.ok === false && again.status === 409 && shorter.ok === false && shorter.recorded?.from === '2026-11-16' && (await db.collection('tenants/t1/transactions').get()).size === 4, [again, shorter]);

  console.log('pay the bank booked already');
  const db2 = makeDb(); current = db2;
  await db2.doc('tenants/t2').set(tenant);
  await db2.doc('tenants/t2/transactions/bank_g1').set({ id: 'bank_g1', type: 'expense', context: 'Business', category: 'Payroll', taxBucket: 'payroll', amount: 1003.12, paymentMethod: 'Bank feed', date: '2026-12-01T12:00:00.000Z', reconciled: true, bankTransactionId: 'g1', sortedBy: 'bank' });
  await db2.doc('tenants/t2/bankTransactions/g1').set({ id: 'g1', direction: 'out', date: '2026-12-01', status: 'auto_categorized', matchedTxnId: 'bank_g1', amountCents: 100312, name: 'GUSTO NET' });
  await db2.doc('tenants/t2/transactions/bank_old').set({ id: 'bank_old', type: 'expense', context: 'Business', category: 'Payroll', amount: 990, paymentMethod: 'Bank feed', date: '2026-11-17T12:00:00.000Z' });
  await db2.doc('tenants/t2/bankTransactions/old').set({ id: 'old', direction: 'out', date: '2026-11-17', status: 'auto_categorized', matchedTxnId: 'bank_old' });
  const r2: any = await R.recordPayday(db2, 't2', tenant, input, {}, now);
  const all2 = (await db2.collection('tenants/t2/transactions').get()).docs.map((d: any) => d.data());
  check('a payroll company’s withdrawal for these dates counts as the employees’ pay: only the rest is booked, never all of it again', r2.ok && r2.viaBankCents === 100312 && all2.find((t: any) => t.id === `payday_${k}_team`)?.amount === 269.38, all2.map((t: any) => [t.id, t.amount]));
  check('…and a withdrawal that covers it all leaves nothing more to book', await (async () => {
    const db4 = makeDb(); current = db4; await db4.doc('tenants/t4').set(tenant);
    await db4.doc('tenants/t4/transactions/bank_n').set({ id: 'bank_n', type: 'expense', context: 'Business', category: 'Payroll', amount: 1000, paymentMethod: 'Bank feed', date: '2026-12-01T12:00:00.000Z' });
    await db4.doc('tenants/t4/transactions/bank_t').set({ id: 'bank_t', type: 'expense', context: 'Business', category: 'Payroll', amount: 400, paymentMethod: 'Bank feed', date: '2026-12-01T12:00:00.000Z' });
    await db4.doc('tenants/t4/bankTransactions/n').set({ direction: 'out', date: '2026-12-01', status: 'auto_categorized', matchedTxnId: 'bank_n' });
    await db4.doc('tenants/t4/bankTransactions/t').set({ direction: 'out', date: '2026-12-01', status: 'created', matchedTxnId: 'bank_t' });
    const r: any = await R.recordPayday(db4, 't4', tenant, input, {}, now); const ids = (await db4.collection('tenants/t4/transactions').get()).docs.map((d: any) => d.id);
    current = db2; return r.ok && r.viaBankCents === 140000 && !ids.includes(`payday_${k}_team`);
  })());
  {
    const weekly = { ...tenant, payroll: { cadence: 'weekly', periodAnchor: '2026-11-02', paydayAfterDays: 4 } };
    const w = R.bankWindow(weekly, '2026-11-16', '2026-11-22');
    check('with weekly pay, the days looked at start after the week before’s payday (its withdrawal is its own)', w.first === '2026-11-20' && w.last === '2026-11-26', w);
  }
  check('…it’s marked as this payday’s, so the dates show as recorded; one from the period before is left alone',
    all2.find((t: any) => t.id === 'bank_g1')?.paydayPeriod === k && !all2.find((t: any) => t.id === 'bank_old')?.paydayPeriod);
  check('…contractors, cash tips and the payroll run are still recorded', !!all2.find((t: any) => t.id === `payday_${k}_contractors`) && !!all2.find((t: any) => t.id === `paydaycash_${k}`)
    && (await db2.doc(`tenants/t2/payrollRuns/payday_${k}`).get()).data()?.viaBank?.[0] === 'bank_g1');

  console.log('withdrawals after payday was recorded');
  const team = { id: `payday_${k}_team`, paydayPeriod: k, paydayFrom: '2026-11-16', paydayTo: '2026-11-29', category: 'Payroll', paymentMethod: 'Distribution', type: 'expense', context: 'Business', amount: 1272.5, date: now };
  const cashLine = { id: `paydaycash_${k}`, paydayPeriod: k, category: 'Payroll', paymentMethod: 'Cash', type: 'expense', context: 'Business', amount: 60, date: now };
  const p1 = B.planPayrollCover([team, cashLine], { id: 'net', amountCents: 100000, date: '2026-12-02' });
  check('their take-home pay is covered by the pay payday booked: nothing more is booked', p1?.covered === 100000 && p1.extra === 0 && p1.parts[0].id === team.id && p1.parts[0].full === false, p1);
  const after = { ...team, bankCover: { net: 100000 } };
  const p2 = B.planPayrollCover([after], { id: 'tax', amountCents: 40000, date: '2026-12-02' });
  check('the taxes withdrawal: what’s left of the pay is covered, and only what’s beyond it is booked (the employer’s taxes and fees)', p2?.covered === 27250 && p2.extra === 12750 && p2.parts[0].full === true, p2);
  check('a check run again counts the same withdrawal once', B.planPayrollCover([after], { id: 'net', amountCents: 100000, date: '2026-12-02' })?.covered === 100000);
  check('never cash tips, contractors, other books, or a payday from long before', B.planPayrollCover([cashLine], { id: 'x', amountCents: 5000, date: '2026-12-02' }) === null
    && B.planPayrollCover([{ ...team, category: 'Contract Labor' }], { id: 'x', amountCents: 5000, date: '2026-12-02' }) === null
    && B.planPayrollCover([{ ...team, context: 'Personal' }], { id: 'x', amountCents: 5000, date: '2026-12-02' }) === null
    && B.planPayrollCover([team], { id: 'x', amountCents: 5000, date: '2027-01-20' }) === null);
  {
    const p1 = { ...team, id: 'p1', paydayPeriod: '2026-11-02_2026-11-15', amount: 10000, date: '2026-11-17T15:00:00.000Z', bankCover: { a: 999700 } };
    const p2 = { ...team, id: 'p2', paydayPeriod: k, amount: 10000, date: '2026-12-01T15:00:00.000Z' };
    const net2 = B.planPayrollCover([p1, p2], { id: 'n2', amountCents: 800000, date: '2026-12-02' });
    check('a few dollars left on an earlier payday never sends the next one’s pay to payroll taxes: its own payday is matched first', net2?.period === k && net2.covered === 800000 && net2.extra === 0 && net2.parts.every((x) => x.id === 'p2'), net2);
    const big = B.planPayrollCover([p1, p2], { id: 'b2', amountCents: 1001000, date: '2026-12-02' });
    check('…and one withdrawal can use up both, booking only what’s beyond them all', big?.covered === 1000300 && big.extra === 700 && big.periods.length === 2, big);
  }
  {
    // The usual order with Gusto: the next payday's withdrawal comes before that payday is recorded, with a few dollars
    // left on the one before.
    const old = { ...team, id: 'p1', paydayPeriod: '2026-11-02_2026-11-15', paydayFrom: '2026-11-02', paydayTo: '2026-11-15', amount: 10000, date: '2026-11-17T15:00:00.000Z', bankCover: { a: 999700 } };
    check('a withdrawal before its own payday is recorded is never matched to what’s left of the one before (it’s booked from the bank, and recording claims it)',
      B.planPayrollCover([old], { id: 'n2', amountCents: 800000, date: '2026-11-30' }, tenant) === null
      && B.planPayrollCover([old], { id: 'n1', amountCents: 300, date: '2026-11-18' }, tenant)?.covered === 300);
  }
  check('the older payday with pay left is matched first, when as near', B.planPayrollCover([{ ...team, id: 'later', paydayPeriod: '2026-11-30_2026-12-13' }, team], { id: 'x', amountCents: 5000, date: '2026-12-15' })?.period === k);

  console.log('the bank feed, end to end');
  const db3 = makeDb(); current = db3;
  await db3.doc('tenants/t3').set({ ...tenant, name: 'North Loft' });
  await db3.doc('tenants/t3/plaidItems/i1').set({ accessToken: 'tok', label: 'Business' });
  const day = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
  // (Dates picked by hand, around today: its withdrawals can fall from 3 days before its last day to a week after.)
  const tFrom = day(16), tTo = day(3);
  await db3.doc(`tenants/t3/transactions/${team.id}`).set({ ...team, paydayPeriod: `${tFrom}_${tTo}`, paydayFrom: tFrom, paydayTo: tTo, date: `${day(3)}T15:00:00.000Z` });
  let feed: any[] = [
    { transaction_id: 'gnet', date: day(1), pending: false, amount: 1000, name: 'GUSTO NET 1234', merchant_name: 'Gusto', personal_finance_category: { primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', confidence_level: 'MEDIUM' } },
    { transaction_id: 'gtax', date: day(1), pending: false, amount: 400, name: 'GUSTO TAX 1234', merchant_name: 'Gusto', personal_finance_category: { primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', confidence_level: 'MEDIUM' } },
  ];
  (globalThis as any).fetch = async (url: string) => {
    if (/\/transactions\/sync$/.test(String(url))) { const out = feed; feed = []; return { ok: true, json: async () => ({ added: out, next_cursor: 'c', has_more: false }) }; }
    return { ok: true, json: async () => ({}) };
  };
  process.env.PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || 'x'; process.env.PLAID_SECRET = process.env.PLAID_SECRET || 'y';
  const P = await import('../../src/lib/plaid-sync');
  await P.syncTenantBankFeed(db3, 't3');
  const g = async (p: string) => (await db3.doc(p).get()).data();
  const net: any = await g('tenants/t3/bankTransactions/gnet'), tax: any = await g('tenants/t3/bankTransactions/gtax');
  const teamNow: any = await g(`tenants/t3/transactions/${team.id}`);
  const books = (await db3.collection('tenants/t3/transactions').get()).docs.map((d: any) => d.data());
  check('both withdrawals are matched to payday, not booked as pay again', net?.status === 'matched' && net.matchedBy === 'payroll' && tax?.status === 'matched' && net.matchedTxnId === team.id, [net?.status, tax?.status]);
  check('…payday’s pay is used up and matched', teamNow?.reconciled === true && Object.values(teamNow?.bankCover || {}).reduce((n: number, v: any) => n + v, 0) === 127250, teamNow);
  const extra = books.find((t: any) => t.category === 'Payroll Taxes');
  check('…only what’s beyond it is booked, as payroll taxes: the books show the pay once, plus the employer’s taxes',
    extra?.amount === 127.5 && !books.some((t: any) => t.id?.startsWith('bank_')) && books.filter((t: any) => /^payroll/i.test(t.category)).reduce((n: number, t: any) => n + t.amount, 0) === 1400, books.map((t: any) => [t.id, t.category, t.amount]));
  const BM = await import('../../src/lib/bank-match-server');
  const undo: any = await BM.unmatchBankLine(db3, 't3', { name: 'North Loft' }, 'gtax');
  const teamUndone: any = await g(`tenants/t3/transactions/${team.id}`);
  check('undoing a match frees that part of payday’s pay, and its payroll taxes line goes', undo.ok && !teamUndone?.bankCover?.gtax && teamUndone?.bankCover?.gnet === 100000 && !teamUndone?.reconciled
    && !(await db3.collection('tenants/t3/transactions').get()).docs.some((d: any) => d.data().category === 'Payroll Taxes'), teamUndone);

  {
    // The Bank screen: a payroll withdrawal waiting to be sorted, booked as Payroll after payday was recorded.
    const db5 = makeDb(); current = db5; await db5.doc('tenants/t5').set(tenant);
    await db5.doc(`tenants/t5/transactions/${team.id}`).set({ ...team, date: '2026-11-30T15:00:00.000Z' });
    await db5.doc('tenants/t5/bankTransactions/w1').set({ id: 'w1', direction: 'out', date: '2026-12-01', status: 'unmatched', amountCents: 150000, name: 'PAYROLL CO', context: 'Business' });
    const pc: any = await B.coverWithPayday(db5, 't5', tenant, { id: 'w1', amountCents: 150000, date: '2026-12-01', context: 'Business', name: 'PAYROLL CO' }, now, { write: true });
    const w1: any = (await db5.doc('tenants/t5/bankTransactions/w1').get()).data(); const lines5 = (await db5.collection('tenants/t5/transactions').get()).docs.map((d: any) => d.data());
    check('booking a payroll line from the Bank screen after payday is matched to payday, and only what’s beyond it is booked',
      pc?.plan?.covered === 127250 && w1?.status === 'matched' && w1.matchedBy === 'payroll' && lines5.find((t: any) => t.category === 'Payroll Taxes')?.amount === 227.5 && lines5.length === 2, [w1, lines5.map((t: any) => [t.id, t.amount])]);
    check('…a line sorted meanwhile is left as it is', (await B.coverWithPayday(db5, 't5', tenant, { id: 'w1', amountCents: 150000, date: '2026-12-01', context: 'Business', name: 'PAYROLL CO' }, now, { write: true })) === 'sorted');
    const api = src('src/app/api/plaid/route.ts'), sync = src('src/lib/plaid-sync.ts');
    check('Book and Book all match payroll to payday before booking it; the sync does too, from payday’s lines as they are now, and writes payroll it books at once',
      (api.match(/await coverWithPayday\(db, tenantId, biz, /g) || []).length === 3 && /\/\^payroll\( taxes\)\?\$\/i\.test\(finalCategory\)/.test(api) && /\/\^payroll\( taxes\)\?\$\/i\.test\(String\(w\.suggestedCategory \|\| ''\)\)/.test(api)
      && /const payCover = payrollOut \? await coverWithPayday\(db, tenantId, tenantDoc,/.test(sync) && /if \(\/\^payroll\( taxes\)\?\$\/i\.test\(sugg\.category\)\) await btRef\.set\(record\);/.test(sync));
    current = db3;
  }

  {
    const api = src('src/app/api/plaid/route.ts'), page = src('src/app/(app)/money/page.tsx');
    check('changing a bank line to payroll after payday was recorded hands it back to be matched to payday (Bank screen and Books alike)',
      /await paydayPlanFor\(db, tenantId, biz, bAt\)/.test(api) && /tx\.delete\(tRef\);/.test(api) && /const pc = await coverWithPayday\(db, tenantId, biz, bAt, nowIso, \{ write: true \}\);/.test(api)
      && /action: 'recategorize', bankTxnId: String\(t\.bankTransactionId\), category/.test(page));
  }

  console.log('the payroll register');
  const runDoc = { kind: 'payday', periodKey: k, people: [{ staffId: 'a', name: 'Ana Ruiz', paid: 772.5, cashTips: 40, contractor: false }, { staffId: 'c', name: 'Cy Lee', paid: 900, cashTips: 0, contractor: true }] };
  const rows = RB.payrollRows([{ ...team, id: 't' } as any, { ...cashLine, id: 'c' } as any], [{ id: 'a', name: 'Ana Ruiz' }], [runDoc]);
  check('a recorded payday is shown person by person from its run (contractors aren’t payroll)', rows.length === 1 && rows[0].name === 'Ana Ruiz' && rows[0].total === 812.5 && rows[0].count === 1, rows);
  check('…and as the team’s one line when the run can’t be read', RB.payrollRows([{ ...team, id: 't', clientOrVendor: 'Team pay' } as any], [], []).length === 1);

  console.log('who can run payroll and approve time');
  const page = src('src/app/(app)/money/page.tsx'), side = src('src/components/shared/AppSidebar.tsx'), ts = src('src/app/(app)/timesheets/page.tsx'), teamPage = src('src/app/(app)/team/page.tsx');
  check('Money: every tab for the books, Payday alone for someone who only runs payroll, and a plain note for anyone else',
    /const seesAll = can\('money\.view'\); const pays = can\('money\.payroll'\); const paysOnly = !seesAll && pays;/.test(page) && /HUB_TABS\.filter\(\(t\) => \(t\.key !== 'payday' \|\| pays\) && \(t\.key !== 'taxes' \|\| isOwner\)\)/.test(page) && /tabs\.map\(\(\{ key, label \}\)/.test(page)
    && /\{pays && visitedTabs\.has\('payday'\)/.test(page) && /if \(tab === 'payday' && !pays\) return;/.test(page)
    && /if \(paysOnly && activeTab !== 'payday'\) handleTabChange\('payday'\)/.test(page) && /Money is for the owner and people whose role includes the books or payroll\./.test(page)
    && (page.match(/\{seesAll && visitedTabs\.has\('/g) || []).length === 7);
  check('Payday is recorded through the server, not line by line from the browser', /fetch\('\/api\/payroll\/record'/.test(page) && !/`payday_\$\{periodKey\}_\$\{obligation\.id\}`/.test(page));
  check('the menu: Payday (or Money) for a role that runs payroll, Team for a role that approves time', /can\('money\.view'\) \? \{ href: '\/money', icon: Wallet, label: 'Money' \} : \{ href: '\/money\?tab=payday', icon: Wallet, label: 'Payday' \}/.test(side)
    && /\(isAdmin \|\| can\('time\.approve'\) \|\| can\('team\.manage'\)\)/.test(side));
  check('Timesheets and the Time area open to anyone whose role approves time', /if \(!can\('time\.approve'\)\) \{/.test(ts) && !/Access Restricted/.test(ts) && /k === 'time' && !!can\?\.\('time\.approve'\)/.test(teamPage));
  const gp = src('src/app/api/gusto/payroll/route.ts'), ge = src('src/app/api/gusto/employees/route.ts'), rec = src('src/app/api/payroll/record/route.ts');
  check('the Gusto payroll and employee routes, and recording payday, are for anyone whose role runs payroll', /requireCan\(req, tenantId, 'money\.payroll'\)/.test(gp) && !/requireRole/.test(gp) && /requireCan\(req, String\(tenantId \|\| ''\), 'money\.payroll'\)/.test(ge) && !/requireRole/.test(ge)
    && /requireCan\(req, tenantId, 'money\.payroll'\)/.test(rec));
  check('pay rates load for a role that runs payroll, so Payday works its pay out right', /\|\| !!can\?\.\('money\.payroll'\)/.test(src('src/components/shared/StaffPayOverlay.tsx')));
  const rules = src('firestore.rules');
  const ruleOf = (m: string) => { const at = rules.indexOf(`match /tenants/{tenantId}/${m}/`); return rules.slice(at, rules.indexOf('\n    }', at)); };
  check('the rules: a role that runs payroll reads pay rates, corrections, stubs, drafts and runs; one that approves time fixes hours',
    /function hasCap\(tenantId, cap\)/.test(rules) && /hasCap\(tenantId, 'money\.payroll'\)/.test(ruleOf('staffPay')) && /hasCap\(tenantId, 'money\.payroll'\)/.test(ruleOf('payAdjustments')) && /hasCap\(tenantId, 'money\.payroll'\)/.test(ruleOf('payStubs'))
    && /hasCap\(tenantId, 'money\.payroll'\)/.test(ruleOf('payrollRuns')) && /hasCap\(tenantId, 'money\.payroll'\)/.test(ruleOf('payrollDrafts'))
    && /hasCap\(tenantId, 'time\.approve'\) && request\.resource\.data\.get\('staffId', ''\) != dirEntry\(\)\.data\.get\('staffId', ''\)/.test(ruleOf('activityLogs'))
    && /hasCap\(tenantId, 'time\.approve'\) && resource\.data\.get\('staffId', ''\) != dirEntry\(\)\.data\.get\('staffId', ''\)/.test(ruleOf('activityLogs'))
    && !/money\.view/.test(ruleOf('payAdjustments'))
    && /allow write: if false;/.test(ruleOf('payrollRuns')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
