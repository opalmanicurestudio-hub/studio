// Checks the Money page in the app's look (design board "Money in the app's look", option A):
//   components/money/MoneyOverview — the statement (the printed Profit and Loss's own reading of the books), what needs
//                                    you, what's held and never yours, the latest lines
//   app/(app)/money/page.tsx       — the tabs: Overview, Books, Bank (with the lines waiting), Payday, Bills, Activity
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/money-look.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';

const src = (p: string) => fs.readFileSync(p, 'utf8');
const ov = src('src/components/money/MoneyOverview.tsx');
const page = src('src/app/(app)/money/page.tsx');

console.log('the overview, read like a statement');
check('its figures are the books’ own reading, each line read the same way as the Books tab and the printed Profit and Loss', /booksSummary\(lines, \{ lookup: lines, businessOnly: true \}\)/.test(ov) && /normalizeLine\(t\)/.test(ov) && /\.\.\.normalizeLine\(t\)/.test(page) && !/taxBucket:\s+t\.taxBucket \|\| 'revenue'/.test(page));
check('the statement: sales, what came off them, net sales, tips, costs and profit',
  ['"Sales"', '"Refunds and returns"', '"Discounts and deposits used"', '"Net sales"', '"Tips for the team"', '"Cost of goods"', '"Card fees"', '"Team pay"', '>Other costs<', '"Profit"'].every((x) => ov.includes(x)));
check('this month says how it compares with the same days last month', /than this point in/.test(ov) && /prevNet/.test(ov));
check('what needs you: bank lines to sort, checks paid but never closed, a payroll to approve, bills overdue and due this week (with their totals), lines without a category, sales tax due',
  /bank line\$\{/.test(ov) && /Never closed, so it isn’t in your sales yet/.test(ov) && /Payroll ready to approve/.test(ov) && /overdue, \$\{usd\(bills\.overdueTotal\)\}/.test(ov) && /bills due this week, \$\{usd\(bills\.soonTotal\)\}/.test(ov)
  && /without a category/.test(ov) && /waiting to be sorted/.test(ov) && /call\('status'\)/.test(ov));
check('what’s held and never yours: sales tax collected and paid in the period (never netted), what the last period owes from its filing report, gift cards sold, money taken for renters',
  /Sales tax collected, /.test(ov) && /Paid to the state, \$\{periodWord\}/.test(ov) && /Owed for \$\{taxOpen\.label\}/.test(ov) && /setTaxOpen\(d\?\.ok && d\.owed/.test(ov) && !/call\('view'\)/.test(ov) && !/Still to pay the state/.test(ov) && /Gift cards sold/.test(ov) && /Taken for renters/.test(ov) && /Never counted as income/.test(ov));
check('the latest lines are newest first by the moment; a long period and last month’s comparison are read once, never kept live', /new Date\(b\.date\)\.getTime\(\) - new Date\(a\.date\)\.getTime\(\)/.test(ov) && /readDatedRange\(firestore, tenantId, 'transactions', 'date', r\.from/.test(ov) && /readDatedRange\(firestore, tenantId, 'transactions', 'date', prevFrom/.test(ov) && /\[preset, firestore, tenantId, dayKey\]\); \/\/ eslint-disable-line react-hooks\/exhaustive-deps\n  const prevNet = React\.useMemo/.test(ov));
check('the latest lines stop at now; a failed long read says so, never $0.00', /new Date\(t\.date\)\.getTime\(\) < endToday/.test(ov) && /couldn’t be added up just now/.test(ov) && />Try again</.test(ov) && /setYearTry/.test(ov) && /Shown once your books for this year are added up/.test(ov) && /if \(a\.status === 'rejected'\) throw a\.reason/.test(src('src/hooks/use-transactions.ts')));
check('the period runs to the end of the month or year, and today moves on while the page is open', /new Date\(now\.getFullYear\(\), now\.getMonth\(\) \+ 1, 0, 23, 59, 59, 999\)/.test(ov) && /setInterval\(tick/.test(ov) && /visibilitychange/.test(ov));
check('the latest lines in the books, and the way to all of them', /Latest in your books/.test(ov) && /See everything/.test(ov));

console.log('the page');
check('the tabs: Overview, Books (with the bank in it), Payday, Bills, Write-offs, Taxes (the owner’s), Reports, Activity; an address asking for Bank opens Books', /\{ key: 'ledger',\s+label: 'Books' \}/.test(page) && !/\{ key: 'bank',\s+label: 'Bank' \}/.test(page) && /\{ key: 'writeoffs', label: 'Write-offs' \}/.test(page) && /\{ key: 'taxes',\s+label: 'Taxes' \}/.test(page) && /VALID_TABS: HubTab\[\] = \['overview', 'ledger', 'bank', 'payday', 'bills', 'writeoffs', 'taxes', 'reports', 'activity'\]/.test(page)
  && /const tabOf = \(t: HubTab \| null\): HubTab \| null => \(t === 'bank' \? 'ledger' : t\);/.test(page));
check('Books has the bank’s lines, with how many wait counted once for the Books tab and the overview (never every line read)', !/const BankTab = \(\) =>/.test(page) && /bank=\{tenantId && firestore && ledgerRole === 'owner' \? <BankScreen tenantId=\{tenantId\} firestore=\{firestore\} actor=\{auditActor\} inBooks \/> : null\}/.test(page) && /t\.key === 'ledger' \? \{ count: bankWaiting \}/.test(page)
  && /const col = collection\(hubFirestore, `tenants\/\$\{hubTenantId\}\/bankTransactions`\);/.test(page) && /getCountFromServer\(query\(col, where\('status', '==', 'unmatched'\)\)\)/.test(page) && /bankCount=\{bankWaiting\}/.test(page) && !/getCountFromServer/.test(ov));
check('the overview carries the page’s own cards after it', /<MoneyOverview bankCount=\{bankWaiting\} onNavigate=/.test(page) && /<MonthCloseCard tenantId=\{tenantId\} \/>/.test(page) && /<AppPayoutsCard tenantId=\{tenantId\} \/>/.test(page) && /<MilesCard tenantId=\{tenantId\} \/>/.test(page));
check('the old overview is gone', !/const OverviewTab = /.test(page) && !/Money Overview/.test(page) && /<AppHeader title="Money" \/>/.test(page));
const shell = fs.readFileSync('src/components/money/MoneyTabs.tsx', 'utf8') + page.slice(page.indexOf('<MoneyTabs'), page.indexOf('</main>', page.indexOf('<MoneyTabs')));
check('the new screens keep the house style (no shouting labels, no dots between words, 44px targets)', !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us|\b(salon|stylist|booth|chair|studio)\b/.test(ov + shell + page.slice(page.indexOf('const PaydayTab')))
  && /min-h-\[44px\]/.test(shell));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
