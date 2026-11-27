// Checks Payday, Bills and Activity in the new look (design boards "A. Payday, read like a statement", "Bills: overdue,
// this week, later, paid", "Activity: by day, in plain words"; components/money/PaydayScreen, BillsScreen, ActivityScreen):
//   Payday reads like a statement: what came in, the team's pay, the payroll taxes, the bills, what's left; each person's
//   pay in words; the split to set aside from what's left. Its sums and what it writes are the Payday tab's own.
//   Bills: overdue, the next 7 days and later; this month's bills; paid lately; Mark paid asks how it was paid.
//   Activity: by day, in plain words, who did it or Done for you, filtered by kind and by person.
//   A link inside the page (Payday's See all bills, Books' All reports) moves the tab.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/money-tabs-look.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';

const src = (f: string) => fs.readFileSync(f, 'utf8');

(async () => {
  const P = await import('../../src/components/money/PaydayScreen');
  const B = await import('../../src/components/money/BillsScreen');
  const A = await import('../../src/components/money/ActivityScreen');
  const R = await import('../../src/lib/report-builders');
  const page = src('src/app/(app)/money/page.tsx');
  const pay = src('src/components/money/PaydayScreen.tsx'), bills = src('src/components/money/BillsScreen.tsx'), act = src('src/components/money/ActivityScreen.tsx');

  console.log('payday');
  const now = new Date(2026, 10, 26);
  check('the dates in words: one month, two months, another year',
    P.spanWords(new Date(2026, 10, 16), new Date(2026, 10, 29), now) === 'November 16 to 29'
    && P.spanWords(new Date(2026, 10, 23), new Date(2026, 11, 6), now) === 'November 23 to December 6'
    && P.spanWords(new Date(2025, 11, 22), new Date(2026, 0, 4), now) === 'December 22, 2025 to January 4, 2026'
    && P.spanWords(new Date(2025, 9, 1), new Date(2025, 9, 31), now) === 'October 1 to 31, 2025', P.spanWords(new Date(2025, 9, 1), new Date(2025, 9, 31), now));
  const words = P.payWords({ id: 'a', name: 'Jo', amount: 1412.4, hours: 52, overtimeHours: 4, commissionPay: 480, tips: 212.5, payStructure: 'hourly_plus_commission' });
  check('each person’s pay in words: hours (and overtime), commission, tips', words === '52 hours (4 overtime), $480 in commission, $212.50 in tips', words);
  check('per service pay, extras and salary read as what they are',
    P.payWords({ id: 'b', name: 'K', amount: 600, commissionPay: 600, payStructure: 'per_service' }) === '$600 for services'
    && P.payWords({ id: 'c', name: 'S', amount: 2000, payStructure: 'salary', bonus: 40 }) === 'Salary, $40 extra for overtime or minimum wage'
    && P.payWords({ id: 'd', name: 'H', amount: 10, hours: 1 }) === '1 hour', P.payWords({ id: 'c', name: 'S', amount: 2000, payStructure: 'salary', bonus: 40 }));
  check('the statement: came in, the team’s pay, the employer’s payroll taxes, the bills due, and what’s left (or short)',
    /Came in, after costs/.test(pay) && /Your team’s pay/.test(pay) && /Payroll taxes you pay as the employer/.test(pay) && /Bills due these dates/.test(pay)
    && /Left after payday/.test(pay) && /Short after payday/.test(pay) && /const left = Math\.round\(\(p\.cameIn - payday - cashOut - billsTotal\) \* 100\) \/ 100/.test(pay) && /const payday = p\.teamTotal \+ p\.employerTaxes/.test(pay));
  check('each person: what they earned, forgotten clock-outs and shifts waiting (never paid until fixed), no hours on the clock, and how it’s worked out',
    /forgotten clock-out/.test(pay) && /waiting for approval, not paid yet/.test(pay) && /No hours on the clock/.test(pay) && /How it’s worked out/.test(pay) && /p\.statement\(o\)/.test(pay));
  check('payday goes through Gusto when it’s connected; otherwise Connect Gusto, and payday is recorded in the books',
    /Send payroll to Gusto/.test(pay) && /Connect Gusto/.test(pay) && /Record payday in your books/.test(pay));
  check('the split: taxes for the business’s state, the owner’s pay, profit, and what stays to run the business, from what’s left',
    /Set aside from what’s left/.test(pay) && /Use what’s left/.test(pay) && /p\.onSetAside\(Math\.max\(0, left\)\)/.test(pay) && /Taxes are estimated for/.test(pay)
    && /tax: 'Taxes', owner: 'Your pay', profit: 'Profit', opex: 'Running the business'/.test(pay));
  check('the pay period: the one before and after (from pay period settings, with its payday), or picked dates for a one-off; a payroll draft and the payroll draft switch',
    /The pay period before/.test(pay) && /The pay period after/.test(pay) && /Pick dates, for a one-off/.test(pay) && /pay period settings/.test(pay) && /Payday is \$\{paydayWords\}/.test(pay)
    && /A payroll draft is ready/.test(pay) && /role="switch"/.test(pay));
  const tab = page.slice(page.indexOf('const PaydayTab'), page.indexOf('// ─── BillsTab'));
  check('the Payday tab hands its own figures to the screen: the period’s income, the pay worked out per person, the payroll tax estimate, the bills due',
    /<PaydayScreen/.test(tab) && /cameIn=\{currentBalance\}/.test(tab) && /team=\{staffObligations\} teamTotal=\{staffTotalOwed\} employerTaxes=\{selfTaxes \? selfTaxes\.employerTotal : employerTaxes\}/.test(tab)
    && /\[\.\.\.upcomingBusiness, \.\.\.upcomingPersonal\]/.test(tab) && /onSendToGusto=\{handleApprovePayroll\}/.test(tab) && /onRecord=\{handleConfirmDistributions\}/.test(tab));
  const rec = src('src/lib/payday-record.ts'), recRoute = src('src/app/api/payroll/record/route.ts');
  check('recording payday books the team’s pay and the set-asides (never what stays to run the business), audited',
    /suggestions\.filter\(b => b\.amount > 0 && b\.key !== 'opex'\)/.test(tab) && /action: 'payroll\.distribute'/.test(recRoute) && /action: 'payroll\.submit_gusto'/.test(tab)
    && /category: 'Payroll', taxBucket: 'payroll'/.test(rec) && /category: 'Distribution', taxBucket: 'transfer'/.test(rec));

  check('what came in is the books’ own reading (never the sales tax, gift cards sold or transfers; refunds come off), with pay already booked added back',
    /const s = booksSummary\(ls, \{ lookup: ls, businessOnly: true \}\);/.test(tab) && /e\.side === 'opex' && \(\(isTeamPay\(e\.category\) && !\/contract\/i\.test\(e\.category\)\) \|\| t\.paydayPeriod\)/.test(tab) && /return Math\.round\(\(s\.net \+ booked\) \* 100\) \/ 100;/.test(tab));
  {
    const { booksSummary, isTeamPay } = await import('../../src/lib/books-summary');
    const ls = [
      { id: 'a', type: 'income', category: 'Service Revenue', amount: 1000, date: '2026-11-20T15:00:00.000Z' },
      { id: 'b', type: 'income', category: 'Tax Collected', taxBucket: 'tax_collected', amount: 80, date: '2026-11-20T15:00:00.000Z' },
      { id: 'c', type: 'income', category: 'Gift Card Sales', amount: 50, date: '2026-11-21T15:00:00.000Z' },
      { id: 'd', type: 'expense', category: 'Payroll', taxBucket: 'payroll', amount: 300, date: '2026-11-22T15:00:00.000Z' },
      { id: 'e', type: 'expense', category: 'Supplies', amount: 120, date: '2026-11-22T15:00:00.000Z' },
      { id: 'f', type: 'expense', category: 'Distribution', taxBucket: 'transfer', amount: 400, date: '2026-11-23T15:00:00.000Z' },
    ];
    const s = booksSummary(ls, { lookup: ls, businessOnly: true });
    const came = s.net + s.byCategory.opex.filter(([c]) => isTeamPay(c)).reduce((n, [, v]) => n + v, 0);
    check('…so $1,000 of sales less $120 of supplies came in, whatever tax, gift cards, pay already booked or draws are there', Math.abs(came - 880) < 0.001, { came, s: s.net });
  }
  check('payday is recorded once for a pay period: fixed ids, written only when none is there, and the screen says when it was',
    /`payday_\$\{periodKey\}_team`/.test(rec) && /`setaside_\$\{periodKey\}_\$\{a\.key\}`/.test(rec) && /if \(exist\.some\(\(d: any\) => d\.exists\)\)/.test(rec)
    && /where\('paydayTo', '>=', from\)/.test(rec) && /String\(t\.paydayFrom \|\| ''\) <= to/.test(rec) && /const mark = off \? \{ paydayPeriod: periodKey, offCycle: true \} : \{ paydayPeriod: periodKey, paydayFrom: from, paydayTo: to \};/.test(rec)
    && /where\('paydayTo', '>=', payFromYmd\)/.test(tab) && /if \(res\.status === 409\)/.test(tab)
    && /Payday for these dates is in your books, recorded/.test(pay) && /These dates overlap it, so it can’t be recorded again/.test(pay) && /recordedOn=\{recorded \? safeDate\(recorded\.on\) : null\}/.test(tab));
  check('the team’s pay can be recorded with nothing to split', /disabled=\{\(p\.setAside <= 0 && !p\.team\.length\) \|\| p\.recording \|\| !!p\.blocked \|\| !!waits\}/.test(pay) && /Put in an amount to split to add the set-asides too/.test(pay));

  console.log('bills');
  const d = (m: number, x: number) => new Date(2026, m, x);
  const g = B.groupBills([
    { id: 'a', name: 'Rent', amount: 1800, due: d(10, 24) }, { id: 'b', name: 'Phone', amount: 146, due: d(11, 2) },
    { id: 'c', name: 'Today', amount: 5, due: d(10, 26) }, { id: 'e', name: 'Eighth day', amount: 9, due: d(11, 4) }, { id: 'f', name: 'Later', amount: 49, due: d(11, 20) },
  ], new Date(2026, 10, 26, 15));
  check('overdue (before today), the next 7 days (today through a week from today), later',
    g.overdue.map((b) => b.id).join() === 'a' && g.soon.map((b) => b.id).join() === 'c,b' && g.later.map((b) => b.id).join() === 'e,f', g);
  check('a bill: due or overdue since, how often, personal, a late fee, pay online (only a web address), Mark paid',
    /Overdue since/.test(bills) && /every three months/.test(bills) && /late fee may apply/.test(bills) && /\/\^https\?:\\\/\\\/\/i\.test\(u\)/.test(bills) && /Pay online/.test(bills) && /Mark paid/.test(bills));
  check('Mark paid asks how it was paid, kept as before (bank transfer, card, cash, check, autopay)',
    B.PAY_WAYS.map(([v]) => v).join() === 'Bank Transfer,Card,Cash,Check,Auto-Pay' && /How was it paid\?/.test(bills) && /aria-modal="true"/.test(bills) && /e\.key === 'Escape'/.test(bills));
  const btab = page.slice(page.indexOf('const BillsTab'), page.indexOf('// ─── OverviewTab'));
  check('the Bills tab: this month’s bills (due, paid, still to pay), paid in the last 30 days, and a payment booked as a cost and audited',
    /<BillsScreen/.test(btab) && /startOfMonth\(now\), m1 = endOfMonth\(now\), since = subDays\(startOfDay\(now\), 30\)/.test(btab)
    && /status: 'paid',\s+paidDate: now/.test(btab) && /relatedBillInstanceId: instance\.id/.test(btab) && /action: 'bill\.pay'/.test(btab) && /return true;/.test(btab) && /return false;/.test(btab));
  check('a bill is paid once: one paid meanwhile (another device, the bank feed) isn’t booked again',
    /const already = await runTransaction\(firestore, async \(tx\) => \{\s+const cur: any = \(await tx\.get\(instRef\)\)\.data\(\);\s+if \(cur\?\.status === 'paid'\) return true;/.test(btab) && /That bill is already paid/.test(btab));
  check('the month card counts bills overdue from before the month in what’s still to pay', /if \(due < m0 && i\.status !== 'paid'\) \{ earlier \+= amountOf\(i, d\); continue; \}/.test(btab) && /Overdue from before/.test(bills) && /const stillToPay = Math\.round\(\(month\.left \+ earlier\) \* 100\) \/ 100/.test(bills));
  check('bills are added and changed where they come from', /href="\/financials"/.test(bills) && /Add or change bills/.test(bills));

  console.log('activity');
  check('days in words', A.dayWords(new Date(2026, 10, 26, 9), new Date(2026, 10, 26, 18)) === 'Today' && A.dayWords(new Date(2026, 10, 25, 23), new Date(2026, 10, 26, 1)) === 'Yesterday'
    && A.dayWords(new Date(2026, 10, 23), new Date(2026, 10, 26)) === 'Monday, November 23' && A.dayWords(new Date(2025, 11, 31), new Date(2026, 10, 26)) === 'Wednesday, December 31, 2025');
  check('each action in plain words, the same as the audit trail report; one without its own words reads by what it says it did',
    R.knownAction('bill.pay') && !R.knownAction('appointment.cancel') && /knownAction\(e\.action\) \|\| !said \? actionWords\(e\.action\) : said/.test(act));
  check('who: a person, or Done for you; a manager’s PIN says so', /Done for you/.test(act) && /With a manager’s PIN/.test(act) && /e\.actor\?\.type === 'system'/.test(act));
  check('filters: by kind (sales and refunds, bank, bills and payday, books and taxes, everything else) and by person',
    A.KINDS.map(([k]) => k).join() === 'all,sales,bank,pay,books' && /Everything else/.test(act) && /<option value="app">Done for you<\/option>/.test(act));
  check('for someone who isn’t the owner or a manager, it says it’s theirs rather than looking empty', /notYours=\{!canSee \|\| denied\}/.test(page) && /For the owner and managers/.test(act) && /if \(!canSee\) \{ setFeedLoading\(false\); return; \}/.test(page));
  check('the latest only, with the way to every one', /capped=\{entries\.length >= ACTIVITY_MAX\}/.test(page) && /The audit trail in Reports has every one/.test(act) && /onNavigate\?\.\('reports'\)/.test(page));

  console.log('the page');
  check('a link inside the page moves the tab (Books’ All reports), and Payday’s bills and Activity’s Reports switch tabs',
    /if \(urlTab && VALID_TABS\.includes\(urlTab\) && urlTab !== activeTab\) handleTabChange\(urlTab\); \}, \[urlTab\]\)/.test(page)
    && /<PaydayTab onNavigate=\{seesAll \? handleTabChange : undefined\} \/>/.test(page) && /<ActivityTab onNavigate=\{handleTabChange\} \/>/.test(page) && /onNavigate\('bills'\)/.test(page));
  {
    const rd = src('src/components/money/RefundDialog.tsx');
    const early = rd.indexOf('if (!transaction) return null;');
    check('the refund dialog opens: every hook comes before its early return (it’s mounted with no line, then given one)',
      early > 0 && !/\buse(State|Effect|Memo|Ref|Callback)\(/.test(rd.slice(early)) && /<RefundDialog\b/.test(page) && !/const RefundProtocolDialog/.test(page));
  }
  check('the old Payday, Bills and Activity are gone', !/Run Payday|Allocation Engine|Bills & Obligations|const BillRow|const ActivityRow|AllocationItem/.test(page));
  check('house style: no shouting labels, no dots between words, no comments in the markup, 44px targets, the palette',
    [pay, bills, act].every((s) => !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us|\b(salon|stylist|booth|chair|studio)\b/.test(s) && /min-h-\[44px\]/.test(s) && !/#b42318/.test(s)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
