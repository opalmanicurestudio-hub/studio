// Checks closing a month (design board "Closing a month", option A):
//   lib/books-close         — what a closed month is: by day and by the moment where the business is; the date a line
//                             the server writes for a closed month gets (today, saying the day it was for)
//   lib/books-close-server  — what's still open in a month, closing it (and every month before), the owner reopening
//   firestore.rules         — lines in a closed month keep their figures; only their matches, receipts, notes and
//                             refund marks change; only the server closes a month
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/books-close.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, strictTransactions, FV, check, failures } from './fake-db';

const db: any = strictTransactions(makeDb());
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  return load.call(this, request, ...rest);
};
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const C = await import('../../src/lib/books-close');
  const S = await import('../../src/lib/books-close-server');

  console.log('what a closed month is');
  const ny = { timezone: 'America/New_York' };
  const thru = C.closeThrough(ny, '2026-10');
  check('closing October opens from November 1, from its first moment where the business is', thru.openDay === '2026-11-01' && thru.openFrom === '2026-11-01T04:00:00.000Z' && thru.through === '2026-10' && thru.openFromMs === Date.parse('2026-11-01T04:00:00.000Z'), thru);
  const t = { ...ny, booksClose: { ...thru, at: '2026-11-03T15:00:00.000Z', by: 'Jordan' } };
  check('a line dated by day or by the moment is in the closed month by the business’s own clock',
    C.inClosedMonth(t, '2026-10-31') && !C.inClosedMonth(t, '2026-11-01') && C.inClosedMonth(t, '2026-11-01T03:30:00.000Z') && !C.inClosedMonth(t, '2026-11-01T04:00:00.000Z') && !C.inClosedMonth({}, '2020-01-01')
    && C.inClosedMonth(t, { toMillis: () => Date.parse('2026-10-15T12:00:00Z') }) && !C.inClosedMonth(t, { toMillis: () => Date.parse('2026-11-15T12:00:00Z') }) && !C.inClosedMonth(t, ''));
  const now = Date.parse('2026-11-20T15:00:00.000Z');
  check('a line the server writes for a closed month goes in today, saying the day it was for; an open month’s keeps its date',
    JSON.stringify(C.datedFor(t, '2026-10-28T12:00:00.000Z', now)) === JSON.stringify({ date: '2026-11-20T15:00:00.000Z', forDay: '2026-10-28' })
    && JSON.stringify(C.datedFor(t, '2026-11-02T12:00:00.000Z', now)) === JSON.stringify({ date: '2026-11-02T12:00:00.000Z' }));
  check('months count on and back across a year', C.monthAfter('2026-12') === '2027-01' && C.monthAfter('2026-01', -1) === '2025-12' && C.monthDays('2028-02').end === '2028-02-29' && C.monthName('2026-10') === 'October 2026');

  console.log('what’s still open, and closing it');
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'North Loft', timezone: 'America/New_York', retailSettings: { taxRatePercent: 8.25 }, salesTax: { configured: true, filing: { every: 'month', dueDay: 20 } } });
  await db.doc(`${T}/transactions/s1`).set({ id: 's1', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 500, date: '2026-10-10T15:00:00.000Z' });
  await db.doc(`${T}/transactions/e1`).set({ id: 'e1', type: 'expense', category: 'Supplies', taxBucket: 'operating_cost', amount: 120, date: '2026-10-12T15:00:00.000Z' });
  await db.doc(`${T}/transactions/u1`).set({ id: 'u1', type: 'expense', category: 'Uncategorized', amount: 30, date: '2026-10-14T15:00:00.000Z' });
  await db.doc(`${T}/transactions/n1`).set({ id: 'n1', type: 'income', category: 'Retail', taxBucket: 'revenue', amount: 999, date: '2026-11-02T15:00:00.000Z' });
  await db.doc(`${T}/bankTransactions/b1`).set({ status: 'unmatched', date: '2026-10-20', amountCents: 4500 });
  await db.doc(`${T}/bankTransactions/b2`).set({ status: 'unmatched', date: '2026-11-03', amountCents: 100 });
  await db.doc(`${T}/pendingCheckouts/p1`).set({ status: 'paid_waiting', paidCents: 18450, createdAt: '2026-10-30T22:00:00.000Z' });
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open', openedAt: '2026-10-31T13:00:00.000Z' });
  const tenant = await get(T);
  const v: any = await S.monthView(db, 't1', tenant, '2026-10', now);
  const by = (id: string) => v.checks.find((c: any) => c.id === id);
  check('it lists what’s still open in the month, each with the way to it', !by('bank').ok && /1 bank line still to sort/.test(by('bank').title) && !by('checks').ok && /\$184\.50 isn’t in October’s sales/.test(by('checks').detail)
    && !by('drawers').ok && !by('unsorted').ok && /1 line without a category/.test(by('unsorted').title) && by('bank').href, v.checks);
  check('…sales tax for the period ending with it, for the record (never in the way)', by('salestax')?.info === true && /Due November 20/.test(by('salestax').detail));
  check('…and its figures as it closes (only its own days)', v.figures.netSales === 500 && v.figures.costs === 150 && v.figures.profit === 350 && v.ended && !v.closed, v.figures);
  const early: any = await S.closeMonth(db, 't1', tenant, '2026-11', 'Jordan', now);
  check('a month that isn’t over can’t be closed', !early.ok && /isn’t over yet/.test(early.error));
  const c1: any = await S.closeMonth(db, 't1', tenant, '2026-10', 'Jordan', now);
  const after = await get(T);
  check('closing it (with something still open) closes it and every month before it', c1.ok && after?.booksClose?.through === '2026-10' && after?.booksClose?.openDay === '2026-11-01' && after?.booksClose?.by === 'Jordan'
    && C.inClosedMonth(after, '2026-09-05'), after?.booksClose);
  const again: any = await S.closeMonth(db, 't1', after, '2026-09', 'Jordan', now);
  check('…closing one already closed changes nothing', again.ok && again.already && (await get(T))?.booksClose?.through === '2026-10');
  const ov: any = await S.closeOverview(db, 't1', await get(T), undefined, now);
  check('afterwards the overview shows October closed, by whom, and November open', ov.ok && ov.months.find((m: any) => m.month === '2026-10')?.closed && ov.months.find((m: any) => m.month === '2026-10')?.by === 'Jordan'
    && ov.months.find((m: any) => m.month === '2026-11')?.current && !ov.months.find((m: any) => m.month === '2026-11')?.closed, ov.months);
  const noWhy: any = await S.reopenMonth(db, 't1', 'Jo', ' ', now);
  check('reopening needs a reason', !noWhy.ok && /Say why/.test(noWhy.error));
  const re: any = await S.reopenMonth(db, 't1', 'Jo', 'A bill dated in it came in late', now);
  const log = (await get(`${T}/private/booksClose`))?.log || [];
  check('reopened: back to what was closed before (nothing, here), kept on the record with the reason', re.ok && re.reopened === '2026-10' && (await get(T))?.booksClose == null
    && log.some((x: any) => x.kind === 'reopen' && x.reason === 'A bill dated in it came in late' && x.by === 'Jo'), [re, await get(T)]);
  await S.closeMonth(db, 't1', await get(T), '2026-09', 'Jo', now); await S.closeMonth(db, 't1', await get(T), '2026-10', 'Jo', now);
  await S.reopenMonth(db, 't1', 'Jo', 'Fixing a receipt', now);
  check('…with September closed before October, reopening October leaves September closed', (await get(T))?.booksClose?.through === '2026-09');
  const route = src('src/app/api/money/close/route.ts');
  check('only the owner can reopen; closing is a manager’s', /action === 'reopen'[\s\S]{0,80}isTenantOwner/.test(route) && /isManager \|\| auth\.actor\.isTenantOwner/.test(route));

  console.log('what a closed month keeps');
  const rules = src('firestore.rules');
  const txRule = rules.slice(rules.indexOf('match /tenants/{tenantId}/transactions/{txnId}'), rules.indexOf('match /tenants/{tenantId}/rentInvoices/{invId}'));
  const listed = (/hasOnly\(\[([^\]]+)\]\)/.exec(txRule)?.[1] || '').split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  check('the rules keep a closed month’s lines as they are: none added in it, and only their matches, receipts, notes and refund marks change',
    /allow create: if isStaff\(tenantId\) && lineOpen\(tenantId, request\.resource\.data\)/.test(txRule) && /lineOpen\(tenantId, resource\.data\) && lineOpen\(tenantId, request\.resource\.data\)/.test(txRule)
    && JSON.stringify([...listed].sort()) === JSON.stringify([...C.CLOSED_LINE_FIELDS].sort()), listed);
  check('…read from the business’s own record, by day and by the moment, the same as the app', /function lineOpen\(tenantId, d\)/.test(rules) && /day\.size\(\) <= 10 && day >= bc\.openDay/.test(rules) && /day\.size\(\) > 10 && day >= bc\.openFrom/.test(rules));
  check('…a stored time by its moment, and a line with no date open', /day is timestamp && 'openFromMs' in bc && day\.toMillis\(\) >= bc\.openFromMs/.test(rules) && /day == ''/.test(rules));
  check('…and only the server closes or reopens a month', /'addons', 'booksClose'/.test(rules));
  check('lines the server writes for a closed month go in today: the bank feed, the bank inbox, card fees and the plan charge',
    (src('src/lib/plaid-sync.ts').match(/datedFor\(tenantDoc/g) || []).length === 4 && (src('src/app/api/plaid/route.ts').match(/datedFor\(biz/g) || []).length === 2
    && /datedFor\(/.test(src('src/lib/stripe-fee.ts')) && /datedFor\(biz, paidAt/.test(src('src/app/api/stripe/billing-webhook/route.ts')));
  check('…and the rest that date a line by when it happened: rent paid on a day, card charges found later, memberships, packages and tickets bought online, tuition, gifts, card fee returns and dispute fees',
    /\.\.\.datedFor\(tenant, date\)/.test(src('src/app/api/rent/record-payment/route.ts')) && (src('src/lib/lost-charges.ts').match(/datedAt\(db, tenantId/g) || []).length === 2
    && /datedAt\(db, tenantId, paidAt\)/.test(src('src/lib/offer-sale.ts')) && /datedAt\(db, tenantId, paidAt\)/.test(src('src/lib/event-tickets.ts')) && /datedAt\(db, tenantId/.test(src('src/lib/academy-admissions.ts'))
    && /datedAt\(db, tenantId/.test(src('src/lib/academy-funding.ts')) && (src('src/lib/connect-webhook.ts').match(/datedAt\(db, tenant\.id/g) || []).length === 2);
  check('the expenses page says a closed month is closed, and a purchase order’s cost goes in today', /inClosedMonth\(selectedTenant, `\$\{form\.date\}T12:00:00\.000Z`\)/.test(src('src/app/api/expenses/page.tsx'))
    && (src('src/app/(app)/inventory/page.tsx').match(/\.\.\.datedFor\(selectedTenant, String\(newOrder\.orderDate/g) || []).length === 2);
  check('the desk won’t void a sale from a closed month, and says to refund it', /inClosedMonth\(selectedTenant, originalTx\.date\)[\s\S]{0,260}Refund it instead/.test(src('src/components/pos/usePosEngine.tsx')));
  check('the Money page won’t add a line to a closed month, and says to date it today', /inClosedMonth\(selectedTenant, \(data as any\)\.date\)/.test(src('src/app/(app)/money/page.tsx')));
  const card = src('src/components/money/MonthCloseCard.tsx');
  check('the screen keeps the house style', !/\buppercase\b|font-black|\{\/\*| · |[Cc]all us|[Cc]ontact us|\b(salon|stylist|booth|chair|studio)\b/.test(card + src('src/lib/books-close-server.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
