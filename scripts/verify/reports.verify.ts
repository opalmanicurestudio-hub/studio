// Checks the reports in one place (design board "A. A Reports tab"; components/money/ReportsScreen, lib/report-builders,
// lib/csv, lib/books-close-server monthStatement):
//   Each report is one list of lines that both the printed page and the spreadsheet are made from, so they agree.
//   Spreadsheets open in Excel and Google Sheets, and a name can never run as a formula.
//   The audit trail is in plain words; no report prints a dot between words.
//   A closed month prints on one page: its figures, its sales tax, its bank lines (the owner's), what's held, and every
//   correction made to it after it closed.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/reports.verify.ts
import fs from 'fs';
import { makeDb, check, failures } from './fake-db';

(async () => {
  const C = await import('../../src/lib/csv');
  const R = await import('../../src/lib/report-builders');
  const { booksSummary } = await import('../../src/lib/books-summary');

  console.log('spreadsheets');
  const csv = C.toCsv([['Name', 'Amount'], ['=HYPERLINK("x")', 12.5], ['Rae, Lin', -3], ['Said "hi"', '']]);
  check('a spreadsheet opens with accents intact, quotes what needs quoting, and never runs a name as a formula',
    csv.startsWith('﻿') && csv.includes(`"'=HYPERLINK(""x"")",12.5`) && csv.includes('"Rae, Lin",-3') && csv.includes('"Said ""hi""",') && csv.endsWith('\r\n'), csv);
  check('file names from words', C.csvName('North Loft', 'profit and loss', '2026-10') === 'north-loft-profit-and-loss-2026-10.csv' && C.csvName('', 'Mia’s statement') === 'mias-statement.csv');

  console.log('the printed page and the spreadsheet say the same');
  const d = (n: number) => `2026-10-${String(n).padStart(2, '0')}T15:00:00.000Z`;
  const lines = [
    { id: 's1', type: 'income', category: 'Service Revenue', amount: 4820, date: d(3), checkoutSessionId: 'k1', clientOrVendor: 'Ana Ruiz', paymentMethod: 'Card', description: 'Gel set' },
    { id: 't1', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 42.7, date: d(3), checkoutSessionId: 'k1' },
    { id: 'r1', type: 'expense', category: 'Refunds', taxBucket: 'refund', amount: 85, date: d(7) },
    { id: 'c1', type: 'expense', category: 'Supplies', amount: 712.4, date: d(8), description: '=cmd|calc' },
    { id: 'p1', type: 'expense', category: 'Payroll', taxBucket: 'payroll', amount: 2140.55, staffId: 'st1', date: d(15) },
    { id: 'o1', type: 'expense', category: 'Distribution', taxBucket: 'transfer', amount: 500, date: d(20) },
  ];
  const s = booksSummary(lines, { lookup: lines, businessOnly: true });
  const pnl = R.rowsCsv(R.pnlRows(s));
  const pnlHtml = R.buildPnlHtml(lines, { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) }, 'USD', { lookup: lines, shopName: 'North Loft' });
  const netRow = pnl.find((r) => r[1] === 'Net income');
  check('profit and loss: the spreadsheet’s net income is the books’ own, and the printed page shows the same', !!netRow && netRow[2] === Math.round(s.net * 100) / 100 && pnlHtml.includes('Net income') && pnlHtml.includes(s.net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })), { netRow, net: s.net });
  check('the dates read as words', /October 1 to October 31, 2026/.test(pnlHtml));
  const tax = R.rowsCsv(R.taxSummaryRows(lines, { lookup: lines }));
  check('tax summary: lines by Schedule C, in the spreadsheet too', tax.some((r) => r[1] === 'Line 1 — Gross receipts' && r[2] === 4820) && tax.some((r) => String(r[1]).startsWith('Not deductible')));
  const pay = R.payrollCsv(lines, [{ id: 'st1', name: 'Jo Park' }], { code: 'GA', employerPayrollTaxPct: 9.1 });
  check('payroll register: pay by person, and the employer tax estimate', pay[1][0] === 'Jo Park' && pay[1][2] === 2140.55 && /9\.1%/.test(String(pay[3][0])));
  const all = R.ledgerCsv(lines, [{ id: 'st1', name: 'Jo Park' }], { lookup: lines });
  check('every line: one row each, oldest first, saying what it is in the books', all.length === lines.length + 1 && all[1][2] === 'Gel set' && all[1][5] === 'Sale' && all.some((r) => r[5] === 'Refund') && all.some((r) => r[9] === 'Jo Park'));

  console.log('plain words, no dots');
  const entries = [{ at: d(3), action: 'transaction.create', summary: 'Added Supplies', amount: 210, actor: { type: 'user', name: 'Jessica' } },
    { at: d(5), action: 'transaction.auto_book', summary: 'Sorted the monthly fee', amount: 15, actor: { type: 'system', name: 'bank-sync' } }, { at: d(6), action: 'kit.cleanse_started', summary: 'x', actor: { type: 'user', name: 'Jo' } }];
  const range0 = { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) };
  const au = R.buildAuditTrailHtml(entries, range0);
  check('older entries written with dots between words print with commas', !/ · /.test(R.buildAuditTrailHtml([{ at: d(3), action: 'payroll.draft_created', summary: '3 employees · gross $2,140', actor: { type: 'system' } }], range0)) && R.auditCsv([{ summary: 'a · b' }])[1][3] === 'a, b');
  check('the audit trail says what happened in plain words, and who: a person, or done for you', /Added a line/.test(au) && /Sorted a bank line/.test(au) && /Cleanse started/.test(au) && /Done for you/.test(au) && !/transaction\.create|bank-sync/.test(au) && R.auditCsv(entries)[2][1] === 'Done for you');
  const range = { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) };
  const st: any = { month: '2026-10', label: 'October 2026', start: '2026-10-01', end: '2026-10-31', closedAt: '2026-11-03T15:00:00.000Z', closedBy: 'Jessica',
    figures: { sales: 4820, returns: 85, discounts: 0, netSales: 4735, tips: 0, otherIncome: 0, cogs: 712.4, fees: 0, teamPay: 2140.55, otherCosts: 0, costs: 2852.95, profit: 1882.05 },
    tax: { collected: 42.7, givenBack: 0, owed: 42.7, paid: 0, period: { label: 'October 2026', due: 'November 20', paid: false } }, bank: { total: 12, sorted: 12, waiting: 0 }, held: { giftCards: 0, renters: 0 },
    corrections: [{ date: '2026-11-14T15:00:00.000Z', description: 'Correction: Nail Supply Co (Oct 14) moved to Equipment', amount: 88, by: 'Jessica' }] };
  const prints = [pnlHtml, R.buildTaxSummaryHtml(lines, range, 'USD', { lookup: lines }), R.buildPayrollRegisterHtml(lines, [], { code: 'GA', employerPayrollTaxPct: 9.1 }, range, true), au,
    R.buildLedgerHtml(lines, [], s, range, { lookup: lines }), R.buildMonthStatementHtml(st, { shopName: 'North Loft' })];
  check('no report prints a dot between words, or a code', prints.every((h) => !/ · /.test(h.replace(/<script[\s\S]*?<\/script>/g, ''))) && prints.every((h) => !/undefined|NaN/.test(h)), prints.map((h) => (h.match(/.{30} · .{30}/) || [''])[0]));

  console.log('a closed month');
  const stHtml = prints[5];
  const tipsSt = R.buildMonthStatementHtml({ ...st, figures: { ...st.figures, tips: 540, profit: 1882.05 + 540 } });
  check('its three boxes add up: net sales and tips, less costs, is the profit', /Net sales and tips/.test(tipsSt) && tipsSt.includes('$5,275.00') && tipsSt.includes('$2,852.95') && tipsSt.includes('$2,422.05'));
  check('its statement: figures, sales tax and when it’s due, the bank, and what was corrected after, by whom', /Statement, <b>October 2026<\/b>/.test(stHtml) && /Closed November 3 by Jessica/.test(stHtml) && /Due November 20/.test(stHtml)
    && /Matched to your books or sorted/.test(stHtml) && /moved to Equipment, added Nov 14 by Jessica/.test(stHtml) && R.statementCsv(st).some((r) => r[0] === 'Sales tax'));
  const db: any = makeDb(); const S = await import('../../src/lib/books-close-server');
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'North Loft', timezone: 'America/New_York', salesTax: { configured: true, filing: { every: 'month', dueDay: 20 } }, retailSettings: { taxRatePercent: 7 } });
  for (const l of lines) await db.doc(`${T}/transactions/${l.id}`).set(l);
  await db.doc(`${T}/transactions/fix1`).set({ id: 'fix1', type: 'reversal', reversalOf: 'c1', reversedType: 'expense', correctionOf: 'c1', category: 'Supplies', amount: 712.4, paymentMethod: 'Correction', description: 'Correction: taken out', date: '2026-11-14T15:00:00.000Z', enteredBy: 'Jessica' });
  await db.doc(`${T}/transactions/fix2`).set({ id: 'fix2', type: 'expense', correctionOf: 'zz', category: 'Supplies', amount: 5, paymentMethod: 'Correction', description: 'Another month’s', date: '2026-11-14T15:00:00.000Z' });
  await db.doc(`${T}/bankTransactions/b1`).set({ id: 'b1', status: 'matched', date: '2026-10-08' }); await db.doc(`${T}/bankTransactions/b2`).set({ id: 'b2', status: 'unmatched', date: '2026-10-09' });
  await db.doc(`${T}/bankTransactions/b3`).set({ id: 'b3', status: 'matched', date: '2026-11-02' });
  const notYet = await S.monthStatement(db, 't1', (await db.doc(T).get()).data(), '2026-10', true);
  check('a month that isn’t closed has no statement yet', !notYet.ok && /isn’t closed yet/.test((notYet as any).error));
  await S.closeMonth(db, 't1', (await db.doc(T).get()).data(), '2026-10', 'Jessica', Date.parse('2026-11-03T15:00:00Z'));
  const tenant = (await db.doc(T).get()).data();
  const own: any = await S.monthStatement(db, 't1', tenant, '2026-10', true); const mgr: any = await S.monthStatement(db, 't1', tenant, '2026-10', false);
  check('its figures from the books, who closed it and when, its own corrections only, and its bank lines for the owner only', own.ok && own.closedBy === 'Jessica' && Math.abs(own.figures.netSales - 4735) < 1e-9 && own.figures.teamPay === 2140.55
    && own.corrections.length === 1 && own.corrections[0].amount === -712.4 && own.bank.total === 2 && own.bank.waiting === 1 && mgr.ok && mgr.bank === null && own.tax.period?.label === 'October 2026', own);
  const cm: any = await S.closedMonths(db, 't1', tenant);
  check('the closed months, newest first, each with who closed it', cm.ok && cm.months[0].month === '2026-10' && cm.months[0].by === 'Jessica' && cm.months.length === 12);
  // November closed later, by someone else: October still says when and by whom it was closed.
  await S.closeMonth(db, 't1', (await db.doc(T).get()).data(), '2026-11', 'Sam', Date.parse('2026-12-03T15:00:00Z'));
  const later: any = await S.monthStatement(db, 't1', (await db.doc(T).get()).data(), '2026-10', true); const cm2: any = await S.closedMonths(db, 't1', { ...(await db.doc(T).get()).data(), createdAt: '2026-09-02T12:00:00.000Z' });
  check('each closed month says when and by whom it was closed, not the latest close; never months before the business began', later.closedBy === 'Jessica' && /2026-11-03/.test(later.closedAt)
    && cm2.months.map((x: any) => `${x.month}:${x.by}`).join(',') === '2026-11:Sam,2026-10:Jessica,2026-09:Jessica', cm2.months);
  const B = await import('../../src/lib/books-summary');
  check('team pay means the same on the statement and the Overview', B.isTeamPay('Payroll') && B.isTeamPay('Contract Labor') && !B.isTeamPay('Supplies') && /const isPay = isTeamPay;/.test(fs.readFileSync('src/components/money/MoneyOverview.tsx', 'utf8')));

  console.log('the screen and the page');
  const scr = fs.readFileSync('src/components/money/ReportsScreen.tsx', 'utf8');
  const page = fs.readFileSync('src/app/(app)/money/page.tsx', 'utf8');
  check('grouped by what each is for, each to print or download, and the closed months', ['How the business did', 'Taxes', 'Your team', 'Records', 'Closed months'].every((g) => scr.includes(`title="${g}"`))
    && ['Profit and loss', 'Tax summary', 'Payroll register', 'Every line, in full detail', 'Audit trail'].every((n) => scr.includes(`name="${n}"`)) && /Print the statement|onPrint=\{\(\) => print\(`p:m-/.test(scr));
  check('nothing is read until a report is asked for, beyond what sales tax is due (never the report itself) and which months are closed', (scr.match(/useEffect/g) || []).length === 1 && /\{ action: 'status' \}/.test(scr) && /action: 'closed'/.test(scr) && /action: 'view', period: tax\?\.last\?\.period/.test(scr));
  check('the audit trail reads only its dates, and says when there are more than it shows', /where\('at', '>=', range\.from\.toISOString\(\)\), where\('at', '<=', range\.to\.toISOString\(\)\)/.test(scr) && /Pick fewer days to see the rest/.test(scr));
  check('the sales tax return, the audit trail and the closed months are a manager’s; the statement’s bank lines the owner’s or an admin’s', /\{canManage && <Row id="audit"/.test(scr) && /\{canManage && <Group title="Closed months"/.test(scr) && /!canManage \? null/.test(scr)
    && /canManage=\{\['owner', 'admin', 'manager'\]/.test(page) && /isTenantOwner \|\| auth\.actor\.role === 'admin'/.test(fs.readFileSync('src/app/api/money/close/route.ts', 'utf8')));
  check('a report with no dates picked asks for them before any window opens', /if \(dated && !range\) \{ setError\('Pick the first and last day first\.'\); return; \}\n\s+const w = window\.open/.test(scr));
  const TS = await import('../../src/lib/sales-tax-server');
  const st1: any = await TS.taxStatus(makeDb(), 'x', { salesTax: { configured: true, filing: { every: 'month', dueDay: 20 } }, retailSettings: { taxRatePercent: 7 } }, Date.parse('2026-11-26T15:00:00Z'));
  const st2: any = await TS.taxStatus(makeDb(), 'x', {}, Date.parse('2026-11-26T15:00:00Z'));
  check('the light sales tax call says the last period, when it’s due and whether it’s paid, or that tax isn’t set up', st1.last?.period === '2026-10' && st1.last?.paid === false && /November 20/.test(st1.last?.due) && (st2.unset === true || !!st2.last), [st1, st2]);
  check('a report’s window opens at the tap, so it isn’t blocked, and says so when it is', /const w = window\.open\('', '_blank'\);\n\s+if \(!w\)/.test(scr) && /Allow pop-ups for this site/.test(scr));
  const { rangeOf } = await import('../../src/components/money/ReportsScreen');
  const now = new Date(2026, 10, 26, 12);
  const lm = rangeOf('lastMonth', now)!, q = rangeOf('thisQuarter', now)!, ly = rangeOf('lastYear', now)!;
  check('the dates: last month, this quarter, last year, picked dates', lm.from.getDate() === 1 && lm.from.getMonth() === 9 && lm.to.getDate() === 31 && q.from.getMonth() === 9 && q.to.getMonth() === 11 && ly.from.getFullYear() === 2025
    && rangeOf('custom', now, '2026-11-10', '2026-11-01') === null && rangeOf('custom', now, '2026-11-01', '2026-11-10')!.to.getDate() === 10);
  check('the Money page has a Reports tab; the Books tab prints and downloads its own lines and points to the rest', /\{ key: 'reports',\s+label: 'Reports' \}/.test(page) && /<ReportsTab \/>/.test(page) && /Print these lines/.test(page) && /Download them as a spreadsheet/.test(page) && /\/money\?tab=reports/.test(page) && !/function buildPrintHtml/.test(page));
  check('the reports keep the house style', !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us|\b(salon|stylist|booth|chair|studio)\b/.test(scr) && /min-h-\[44px\]/.test(scr));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
