// Checks Gusto in Payday (the payroll audit, round 3; design board "Timesheets and Gusto", Gusto A):
//   Each employee is matched to who they are in Gusto: saved, the same email (saved by the server), or a likely name to
//   confirm. A match is saved only for someone on the team who isn't a contractor, to an employee of the connected
//   company, and one Gusto employee is one person here. Payroll isn't sent to Gusto until every employee with pay is
//   matched. Each payroll sent shows where it is, and checking again never forgets one waiting to be submitted in Gusto.
//   The pay period downloads as a spreadsheet for another payroll company: employees with hours and each kind of pay,
//   then contractors, and nothing in it runs as a formula.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/payroll-gusto.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
let gustoList: any[] = []; let gustoPayroll: any = {}; let openPayrolls: any[] = []; const sent: { path: string; method: string }[] = [];
class NR { status: number; body: any; constructor(body: any, init: any = {}) { this.body = body; this.status = init.status || 200; } static json(body: any, init?: any) { return new NR(body, init); } }
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: NR, NextRequest: class {} };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor: { uid: 'mgr', name: 'Mo' } }), requireRole: async () => ({ actor: { uid: 'mgr', name: 'Mo' } }) };
  if (request === '@/lib/gusto-server') return { getGustoAuth: async () => ({ companyId: 'c1' }), gustoFetch: async (_a: any, path: string, init?: any) => {
    sent.push({ path, method: init?.method || 'GET' });
    if (/\/employees$/.test(path)) return gustoList;
    if (/processing_statuses=unprocessed/.test(path)) return openPayrolls;
    return gustoPayroll; } };
  return load.call(this, request, ...rest);
};
const src = (f: string) => fs.readFileSync(f, 'utf8');
const req = (body: any, q: Record<string, string> = {}) => ({ json: async () => body, nextUrl: { searchParams: new URLSearchParams(q) } }) as any;

(async () => {
  const X = await import('../../src/lib/payroll-export');
  const CSV = await import('../../src/lib/csv');
  const G = await import('../../src/components/money/GustoMatchCard');

  console.log('matching the team to Gusto');
  await db.doc('tenants/t1').set({ name: 'North Loft' });
  await db.doc('tenants/t1/staff/j').set({ name: 'Jo Park', email: 'JO@northloft.co' });
  await db.doc('tenants/t1/staff/r').set({ name: 'Rachel Lin' });
  await db.doc('tenants/t1/staff/k').set({ name: 'Kim Tran', gustoEmployeeId: 'g3' });
  await db.doc('tenants/t1/staff/c').set({ name: 'Cy Lee', employmentType: 'contractor' });
  await db.doc('tenants/t1/staff/x').set({ name: 'Rex Renter', isRenter: true, email: 'rex@northloft.co' });
  await db.doc('tenants/t1/staff/c2').set({ name: 'Cass Lee', employmentType: 'contractor', email: 'cass@northloft.co' });
  await db.doc('tenants/t1/staff/b').set({ name: 'Bo Kim', email: 'bo@northloft.co' });
  gustoList = [{ uuid: 'g0', first_name: 'Bo', last_name: 'Kim', email: 'bo@northloft.co', terminated: true }, { uuid: 'g1', first_name: 'Jo', last_name: 'Park', email: 'jo@northloft.co' }, { uuid: 'g2', first_name: 'Rachel', last_name: 'Lin' }, { uuid: 'g3', first_name: 'Kimberly', last_name: 'Tran' }, { uuid: 'g4', first_name: 'Ana', last_name: 'Ruiz' },
    { uuid: 'g5', first_name: 'Rex', last_name: 'Renter', email: 'rex@northloft.co' }, { uuid: 'g6', first_name: 'Cass', last_name: 'Lee', email: 'cass@northloft.co' }, { uuid: 'g7', first_name: 'Bo', last_name: 'Kim', email: 'bo@northloft.co' }];
  const E = await import('../../src/app/api/gusto/employees/route');
  const got: any = await E.GET(req(null, { tenantId: 't1' }));
  const row = (id: string) => got.body.employees.find((e: any) => e.gustoEmployeeId === id);
  check('saved, the same email (saved for next time) and a likely name to confirm, each said', row('g3').staffId === 'k' && row('g3').how === 'saved' && row('g1').staffId === 'j' && row('g1').how === 'email'
    && (await db.doc('tenants/t1/staff/j').get()).data().gustoEmployeeId === 'g1' && row('g2').suggestedStaffId === 'r' && !row('g2').staffId && !row('g4').staffId, got.body.employees);
  check('never matched by email to someone who has left in Gusto (a rehire is matched to their current record), a renter or a contractor',
    !row('g0').staffId && row('g7').staffId === 'b' && (await db.doc('tenants/t1/staff/b').get()).data().gustoEmployeeId === 'g7' && !row('g5').staffId && !row('g6').staffId
    && !(await db.doc('tenants/t1/staff/x').get()).data().gustoEmployeeId && !(await db.doc('tenants/t1/staff/c2').get()).data().gustoEmployeeId, [row('g0'), row('g5'), row('g6'), row('g7')]);
  const okSave: any = await E.POST(req({ tenantId: 't1', staffId: 'r', gustoEmployeeId: 'g2' }));
  check('confirming a match saves it', okSave.status === 200 && (await db.doc('tenants/t1/staff/r').get()).data().gustoEmployeeId === 'g2', okSave.body);
  const moved: any = await E.POST(req({ tenantId: 't1', staffId: 'r', gustoEmployeeId: 'g3' }));
  check('one Gusto employee is one person here: whoever had them is unmatched', moved.status === 200 && (await db.doc('tenants/t1/staff/r').get()).data().gustoEmployeeId === 'g3' && !(await db.doc('tenants/t1/staff/k').get()).data().gustoEmployeeId);
  const refused = await Promise.all([E.POST(req({ tenantId: 't1', staffId: 'c', gustoEmployeeId: 'g4' })), E.POST(req({ tenantId: 't1', staffId: 'x', gustoEmployeeId: 'g4' })), E.POST(req({ tenantId: 't1', staffId: 'k', gustoEmployeeId: 'nobody' })), E.POST(req({ tenantId: 't1', staffId: 'a/b', gustoEmployeeId: 'g4' })), E.POST(req({ tenantId: 't1', staffId: 'k', gustoEmployeeId: 'g0' }))]) as any[];
  check('never a contractor, a renter, someone not in the Gusto company, someone who has left it, or a made-up id', refused.every((r) => r.status >= 400) && !(await db.doc('tenants/t1/staff/c').get()).data().gustoEmployeeId, refused.map((r) => [r.status, r.body.error]));
  check('every match saved is on the record of who did it', (await db.collection('tenants/t1/auditLogs').get()).docs.some((d: any) => d.data().action === 'payroll.gusto_match'));

  console.log('each payroll sent');
  const P = await import('../../src/app/api/gusto/payroll/route');
  openPayrolls = [{ uuid: 'pr2', pay_period: { start_date: '2026-11-16', end_date: '2026-11-29' } }];
  gustoPayroll = { version: 'v1', employee_compensations: [{ employee_uuid: 'g7', version: 'e1', hourly_compensations: [{ name: 'Regular Hours', hours: '0', job_uuid: 'j1' }], fixed_compensations: [] }] };
  await db.doc('tenants/t1/staff/r').set({ gustoEmployeeId: 'g3' }, { merge: true });
  sent.length = 0;
  const off: any = await P.POST(req({ tenantId: 't1', periodStart: '2026-11-16T05:00:00Z', periodEnd: '2026-11-30T04:59:59Z', periodStartDay: '2026-11-16', periodEndDay: '2026-11-29', grossTotal: 1000,
    lines: [{ staffId: 'b', name: 'Bo Kim', payStructure: 'hourly', regularHours: 30, overtimeHours: 0, commission: 0, tips: 0, bonus: 0, reimbursements: 0, deductions: 0 }, { staffId: 'r', name: 'Rachel Lin', payStructure: 'hourly', regularHours: 20, overtimeHours: 0, commission: 0, tips: 0, bonus: 0, reimbursements: 0, deductions: 0 }] }));
  check('someone not on Gusto’s open payroll stops the whole payroll, by name, before anything is changed in Gusto', off.status === 409 && /Rachel Lin isn’t on Gusto’s open payroll/.test(off.body.error) && !sent.some((x) => x.method === 'PUT'), [off.status, off.body, sent]);
  const never: any = await P.GET(req(null, { tenantId: 't1', payrollId: 'prX' }));
  check('a payroll that wasn’t sent from here is never written down when checked', never.status === 404 && !(await db.doc('tenants/t1/payrollRuns/prX').get()).exists);
  await db.doc('tenants/t1/payrollRuns/pr1').set({ payrollId: 'pr1', status: 'synced_not_submitted', submittedAt: '2026-11-30T15:00:00Z' });
  gustoPayroll = { processed: false, check_date: '2026-12-03' };
  await P.GET(req(null, { tenantId: 't1', payrollId: 'pr1' }));
  check('checking one waiting to be submitted in Gusto keeps it so', (await db.doc('tenants/t1/payrollRuns/pr1').get()).data().status === 'synced_not_submitted');
  gustoPayroll = { processed: false, check_date: '2026-12-03', processed_date: '2026-12-01' };
  await P.GET(req(null, { tenantId: 't1', payrollId: 'pr1' }));
  check('…until it’s submitted there, when it’s being processed', (await db.doc('tenants/t1/payrollRuns/pr1').get()).data().status === 'processing');
  gustoPayroll = { processed: true, check_date: '2026-12-03' };
  await P.GET(req(null, { tenantId: 't1', payrollId: 'pr1' }));
  check('…and once Gusto has processed it, it’s paid on its check date', (await db.doc('tenants/t1/payrollRuns/pr1').get()).data().status === 'processed' && (await db.doc('tenants/t1/payrollRuns/pr1').get()).data().checkDate === '2026-12-03');
  const bad: any = await P.GET(req(null, { tenantId: 't1', payrollId: 'payday_2026-11-16_2026-11-29' }));
  check('a recorded payday is never looked up in Gusto', bad.status === 400);
  const r = (o: any) => G.runWords({ id: 'x', from: '', to: '', people: 1, gross: 1, ...o }, '2026-12-01');
  check('where each one is, in words', r({ status: 'processed', checkDate: '2026-11-19' }).text === 'Paid November 19' && r({ status: 'processed', checkDate: '2026-12-03' }).text === 'Paying December 3'
    && r({ status: 'submitted', checkDate: '2026-12-03' }).text === 'Sent, paying December 3' && r({ status: 'synced_not_submitted' }).text === 'In Gusto, to submit there' && r({ status: 'synced_not_submitted' }).tone === 'warn');

  console.log('Payday');
  const page = src('src/app/(app)/money/page.tsx'), screen = src('src/components/money/PaydayScreen.tsx'), card = src('src/components/money/GustoMatchCard.tsx'), proute = src('src/app/api/gusto/payroll/route.ts');
  check('payroll isn’t sent to Gusto until every employee with pay is matched (to someone who hasn’t left), and the screen says who', /o\.earned > 0 && !gustoPeople\.some\(\(g\) => g\.staffId === o\.id && !g\.terminated\)/.test(page) && /\|\| gustoUnmatched\.length\) return;/.test(page)
    && /\|\| !!p\.gustoUnmatched\?\.length\}/.test(screen) && /to Gusto first, below, then send payroll\./.test(screen));
  check('the matching card shows once Gusto is connected and runs payroll, with the payrolls sent (never a recorded payday)', /gustoSlot=\{gusto\.connected && runBy === 'gusto' \? <GustoMatchCard/.test(page) && /orderBy\('submittedAt', 'desc'\)/.test(page) && /\.filter\(\(d: any\) => d\.kind !== 'payday'\)/.test(page)
    && /Match your team to Gusto/.test(card) && /Look in Gusto again/.test(card) && /Payroll in Gusto/.test(card));
  check('a payroll sent keeps the business’s own first and last day', /periodStartDay: dayFrom, periodEndDay: dayTo/.test(page) && /fromDay: String\(draft\.periodStartDay/.test(proute) && /toDay: endDay \|\| null/.test(proute));
  check('the house style', !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us/.test(card) && /min-h-\[44px\]/.test(card));

  console.log('the download for another payroll company');
  const rows = X.payrollExportRows([
    { name: 'Rae Lin', email: 'rae@x.co', payStructure: 'hourly', regularHours: 40, overtimeHours: 4, tips: 60, cashTips: 40, bonus: 25, adjustments: 25, amount: 772.5 },
    { name: '=Jo Park', payStructure: 'commission', hours: 41.5, commission: 480, amount: 1412.4 },
    { name: 'Nobody Paid', amount: 0 },
    { name: 'Cy Lee', contractor: true, payStructure: 'hourly', amount: 900, cashTips: 50, earned: 950 },
    { name: 'Dee Cash', contractor: true, payStructure: 'commission', amount: -30, cashTips: 30, earned: 0 + 30 },
  ], { from: '2026-11-16', to: '2026-11-29', payday: '2026-12-03' });
  check('the period, then each employee with hours worked, hours and each kind of pay, sorted, with a total', String(rows[0][0]) === 'Pay period 2026-11-16 to 2026-11-29, payday 2026-12-03' && rows[1][0] === 'Name' && rows[1][4] === 'Hours worked' && rows[2][0] === '=Jo Park' && rows[3][0] === 'Rae Lin'
    && rows[2][4] === 41.5 && rows[3][6] === 4 && rows[3][12] === 60 && rows[3][13] === 40 && rows[3][14] === 772.5 && rows[4][0] === 'Employees in all' && rows[4][14] === 2184.9 && !rows.some((x) => x[0] === 'Nobody Paid'), rows);
  check('…then the contractors, apart, with everything they earned (cash tips taken home included)', rows.some((x) => String(x[0]).startsWith('Contractors')) && rows[rows.length - 2][0] === 'Cy Lee' && rows[rows.length - 2][6] === 900 && rows[rows.length - 2][7] === 950
    && rows[rows.length - 1][0] === 'Dee Cash' && rows[rows.length - 1][6] === 0 && rows[rows.length - 1][7] === 30, rows.slice(-3));
  check('…and a name can never run as a formula in the spreadsheet', CSV.toCsv(rows).includes(`'=Jo Park`));
  check('Payday downloads it, as Gusto would be sent it, and not while corrections can’t be read', /payrollExportRows\(staffObligations\.map/.test(page) && /const handleExport = \(\) => \{\s+if \(adjustmentsError\) return;/.test(page)
    && /downloadCsv\(csvName\(String\(\(selectedTenant as any\)\?\.name \|\| ''\), 'payroll', `\$\{dayFrom\} to \$\{dayTo\}`\), rows\)/.test(page) && /Download for \{runBy === 'company' \? 'your' : 'another'\} payroll company/.test(screen));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
