// Checks the Write-offs tab (design board "Write-offs: found for you, finished by you"; lib/write-offs, api/writeoffs,
// components/money/WriteOffsScreen, the tax summary in lib/report-builders):
//   A business meal and one on a work trip half count, a party for employees all counts, entertainment and a personal
//   meal don't; each asks what the IRS does (who was there, what it was about, what the trip was for). Gifts count up to
//   $25 a person. Meals, travel and gifts of $75 or more ask for a receipt (a photo in the business's own uploads, in
//   the app's own bucket, only). Equipment of $2,500 or more, and only that, is marked for the accountant. A line taken
//   back (a reversal, an undo, a void) isn't asked about, and one put back is. For the owner only, purchases on a
//   personal account from places the business books costs from (not a store or restaurant anyone might use) are asked
//   about: for the business, to book as its, or personal, not asked again. The often-missed list is the owner's to
//   answer. The tax summary and the books' tax line count meals and gifts the same way, the rest kept as not deductible.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/write-offs.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures } from './fake-db';
import { countsOf, findWriteOffs, cleanMeal, receiptUrlOk, writeOffsBodyHtml, everydayPurchase, CHECKLIST, MEAL_KINDS } from '../../src/lib/write-offs';
import { taxSummaryRows } from '../../src/lib/report-builders';
import { scheduleCFor, categoryNames } from '../../src/lib/categories';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const db = makeDb(); let actor: any = { id: 'u1', name: 'Jess', isTenantOwner: true }; const audits: any[] = [];
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor, tenant: { timezone: 'America/New_York' } }) };
  if (request === '@/lib/inspo-photos') return { ourBuckets: async () => ['cf-app.firebasestorage.app'] };
  if (request === '@/lib/audit') return { logAuditAdmin: async (_d: any, _t: any, e: any) => { audits.push(e); } };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
const req = (body: any) => ({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => null } }) as any;
const ex = (id: string, category: string, amount: number, extra: any = {}) => ({ id, type: 'expense', context: 'Business', category, amount, date: '2026-05-10T12:00:00.000Z', description: `${category} ${id}`, ...extra });
const year = new Date().getFullYear();
const ex2 = (id: string, category: string, amount: number, extra: any = {}) => ex(id, category, amount, { date: `${year}-05-10T12:00:00.000Z`, ...extra });

(async () => {
  console.log('How much counts');
  check('a business meal half counts; one not said yet too', countsOf(ex('a', 'Meals & Entertainment', 86.4, { writeOff: { meal: { kind: 'business' } } })).counts === 4320 && countsOf(ex('b', 'Meals & Entertainment', 50)).counts === 2500 && countsOf(ex('b', 'Meals & Entertainment', 50)).why === 'the other half of business meals');
  check('a meal on a work trip half counts, said apart', countsOf(ex('w', 'Meals & Entertainment', 60, { writeOff: { meal: { kind: 'travel', why: 'Trade show' } } })).counts === 3000 && countsOf(ex('w', 'Meals & Entertainment', 60, { writeOff: { meal: { kind: 'travel' } } })).why === 'the other half of meals on work trips'
    && MEAL_KINDS.map((k) => k.id).join() === 'business,travel,team,entertainment,personal' && /your employees/.test(MEAL_KINDS.find((k) => k.id === 'team')!.label) && /contractors or renters is a business meal/.test(MEAL_KINDS.find((k) => k.id === 'team')!.sub));
  check('a party for employees all counts; entertainment and a personal meal don’t', countsOf(ex('c', 'Meals & Entertainment', 300, { writeOff: { meal: { kind: 'team' } } })).counts === 30000
    && countsOf(ex('d', 'Meals & Entertainment', 120, { writeOff: { meal: { kind: 'entertainment' } } })).counts === 0 && countsOf(ex('d', 'Meals', 120, { writeOff: { meal: { kind: 'personal' } } })).why === 'personal meals');
  check('gifts: up to $25 a person (one, until said)', countsOf(ex('g', 'Business Gifts', 180, { writeOff: { giftPeople: 3 } })).counts === 7500 && countsOf(ex('g', 'Business Gifts', 180)).counts === 2500 && countsOf(ex('g', 'Business Gifts', 20, { writeOff: { giftPeople: 3 } })).counts === 2000);
  check('anything else counts in full', countsOf(ex('s', 'Supplies', 42.5)).counts === 4250 && countsOf(ex('s', 'Supplies', 42.5)).not === 0);
  check('a business meal and a party for employees need who and why; a work trip what it was for; no markup kept', !cleanMeal({ kind: 'business', who: 'Maria' }).ok && cleanMeal({ kind: 'business', who: 'Maria', why: 'Order' }).ok && cleanMeal({ kind: 'entertainment' }).ok && !cleanMeal({ kind: 'lunch' }).ok
    && !cleanMeal({ kind: 'team', who: 'All' }).ok && !cleanMeal({ kind: 'travel', who: 'Me' }).ok && (cleanMeal({ kind: 'travel', who: 'Me', why: 'Trade show' }) as any).meal.who === ''
    && !/[<>]/.test((cleanMeal({ kind: 'team', who: '<b>all</b>', why: 'Party' }) as any).meal.who));
  const B = ['cf-app.firebasestorage.app']; const fsUrl = (bucket: string, object: string, q = '?alt=media&token=abc') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(object)}${q}`;
  check('a receipt only from the business’s own uploads, in the app’s own bucket', receiptUrlOk(fsUrl(B[0], 'tenants/t1/uploads/1764_ab12cd.jpg'), 't1', B) && !receiptUrlOk(fsUrl('other-app.appspot.com', 'tenants/t1/uploads/1764_ab12cd.jpg'), 't1', B)
    && !receiptUrlOk(fsUrl(B[0], 'tenants/t2/uploads/1764_ab12cd.jpg'), 't1', B) && !receiptUrlOk(fsUrl(B[0], 'tenants/t1/leases/a.jpg'), 't1', B) && !receiptUrlOk(fsUrl(B[0], 'tenants/t1/uploads/../../t2/a.jpg'), 't1', B)
    && !receiptUrlOk(fsUrl(B[0], 'tenants/t1/uploads/a.jpg', ''), 't1', B) && !receiptUrlOk('https://evil.example/tenants/t1/uploads/a.jpg', 't1', B) && !receiptUrlOk('data:image/png;base64,AAA', 't1', B) && !receiptUrlOk('', 't1', B));
  check('gifts are a category, on Schedule C line 27a, not for employees; meals on line 24b', categoryNames('expense').includes('Business Gifts') && /^Line 27a/.test(scheduleCFor('Business Gifts')) && scheduleCFor('Meals & Entertainment') === 'Line 24b — Deductible meals'
    && /Gifts to your employees are usually pay/.test(src('src/lib/categories.ts')));
  check('tips: income limits said', /Income limits apply/.test(CHECKLIST.find((c) => c.id === 'tips')!.text) && /\$150,000/.test(CHECKLIST.find((c) => c.id === 'tips')!.text));

  console.log('What the year shows');
  const lines = [
    ex('m1', 'Meals & Entertainment', 86.4), ex('m2', 'Meals & Entertainment', 40, { writeOff: { meal: { kind: 'business', who: 'Maria', why: 'Order' } }, hasReceipt: true }),
    ex('m3', 'Meals', 300, { writeOff: { meal: { kind: 'team', who: 'Team', why: 'Party' } } }), ex('m4', 'Meals & Entertainment', 120, { writeOff: { meal: { kind: 'entertainment' } } }),
    ex('m5', 'Meals & Entertainment', 90), { id: 'r5', type: 'reversal', reversalOf: 'm5', category: 'Meals & Entertainment', amount: 90, date: '2026-05-11T12:00:00.000Z' },
    ex('t1', 'Travel', 240), ex('t2', 'Travel', 60), ex('t3', 'Travel', 500, { receiptUrl: 'x' }),
    ex('g1', 'Business Gifts', 180), ex('g2', 'Business Gifts', 100, { writeOff: { giftPeople: 2 } }),
    ex('e1', 'Equipment', 3480), ex('e2', 'Equipment', 900), ex('c1', 'Education & Training', 450), ex('c2', 'Education & Training', 440),
    ex('old', 'Meals & Entertainment', 70, { date: '2025-03-01T12:00:00.000Z' }), ex('per', 'Meals & Entertainment', 70, { context: 'Personal' }),
  ];
  const f = findWriteOffs(lines, 2026, [{ id: 'b1', day: '2026-05-02', title: 'Beauty Supply', cents: 6420 }]);
  check('meals: spent, what counts (half, all, none), and which still need who and why (not one taken back)', f.meals.spent === 8640 + 4000 + 30000 + 12000 && f.meals.needDetail.map((m) => m.id).join() === 'm1'
    && f.meals.counts === 4320 + 2000 + 30000 + 0 && !f.meals.lines.some((m) => m.id === 'm5'), f.meals);
  check('receipts: meals, travel and gifts of $75 or more without one', f.receipts.map((r) => r.id).sort().join() === ['m1', 'm3', 'm4', 't1', 'g1', 'g2'].sort().join() && !f.receipts.some((r) => r.id === 'm5'), f.receipts.map((r) => r.id));
  check('gifts: how many people asked, and the ones over $25 a person', f.gifts.needPeople.map((g) => g.id).join() === 'g1' && f.gifts.over.map((g) => g.id).join() === 'g2' && f.gifts.counts === 2500 + 5000);
  check('equipment of $2,500 or more, classes, and personal-account purchases', f.equipment.map((e) => e.id).join() === 'e1' && f.education.cents === 89000 && f.education.count === 2 && f.personal.length === 1);
  check('only this year’s business lines; what’s left to finish counted', !f.meals.lines.some((m) => m.id === 'old' || m.id === 'per') && f.toFinish === 1 + 6 + 1);
  const one = (x: any[]) => findWriteOffs(x, 2026);
  const vm = ex('vm', 'Meals & Entertainment', 80); const rm = { id: 'rm', type: 'reversal', reversalOf: 'vm', amount: 80, date: '2026-05-12T12:00:00.000Z' };
  check('a meal voided isn’t asked about; one whose take-back was taken back is', one([vm, { id: 'vv', type: 'income', category: 'Void', voidOf: 'vm', amount: 80, date: '2026-05-11T12:00:00.000Z' }]).meals.lines.length === 0
    && one([vm, rm]).meals.lines.length === 0 && one([vm, rm, { id: 'ru', type: 'reversal', reversalOf: 'rm', amount: 80, date: '2026-05-13T12:00:00.000Z' }]).meals.lines.length === 1);
  check('a meal on a work trip asks what the trip was for, not who', one([ex('w1', 'Meals', 40, { writeOff: { meal: { kind: 'travel', who: '', why: '' } } })]).meals.needDetail.length === 1 && one([ex('w1', 'Meals', 40, { writeOff: { meal: { kind: 'travel', who: '', why: 'Show' } } })]).meals.needDetail.length === 0
    && one([ex('w2', 'Meals', 40, { writeOff: { meal: { kind: 'team', who: 'Team', why: '' } } })]).meals.needDetail.length === 1);
  check('personal purchases: a store or restaurant anyone might use is never asked about', everydayPurchase({ plaidCategory: 'FOOD_AND_DRINK' }) && everydayPurchase({ plaidCategory: 'GENERAL_MERCHANDISE', plaidDetailed: 'GENERAL_MERCHANDISE_SUPERSTORES' }) && everydayPurchase({ plaidDetailed: 'TRANSPORTATION_GAS' })
    && !everydayPurchase({ plaidCategory: 'GENERAL_MERCHANDISE', plaidDetailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE' }) && !everydayPurchase({}));
  const html = writeOffsBodyHtml(f, { tenths: 12840, cents: 93090, rate: '72.5¢', trips: 64 }, { homeOffice: 'ask', phone: 'no' });
  check('printed for the accountant: miles, meals, gifts, classes, equipment, the ones to ask about, and what’s left', /\$930\.90/.test(html) && /Business meals/.test(html) && /Equipment: /.test(html) && /A home office/.test(html) && !/Your phone and internet/.test(html) && /Still to finish/.test(html));

  console.log('The tax summary');
  const rows = taxSummaryRows([...lines, { id: 'r9', type: 'reversal', reversalOf: 'm3', category: 'Meals', amount: 300, date: '2026-05-12T12:00:00.000Z' }] as any, { lookup: lines as any } as any);
  const amt = (label: RegExp) => rows.filter((r) => r.label && label.test(r.label)).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  // (m1 and m2 business, half; m3 a team party, all, then taken back; m4 entertainment, none; m5 business, half, taken
  // back; last year's business meal half: the summary is of the lines it's given.)
  check('meals on line 24b: half of business meals, all of a team party (taken back by its own share), none of entertainment', Math.abs(amt(/^Line 24b/) - (43.2 + 20 + 300 - 300 + 0 + 45 - 45 + 35)) < 0.01, rows.filter((r) => /24b|meal|entertain/i.test(r.label || '')));
  check('the rest kept as not deductible, saying why', amt(/Not deductible — the other half of business meals/) > 0 && Math.abs(amt(/Not deductible — entertainment/) - 120) < 0.01);
  const vrows = taxSummaryRows([ex('vt', 'Meals', 300, { writeOff: { meal: { kind: 'team', who: 'Team', why: 'Party' } } }), { id: 'vx', type: 'income', category: 'Void', voidOf: 'vt', amount: 300, date: '2026-05-12T12:00:00.000Z' },
    ex('vb', 'Meals & Entertainment', 100), { id: 'vy', type: 'income', category: 'Void', voidOf: 'vb', amount: 100, date: '2026-05-12T12:00:00.000Z' }] as any, {} as any);
  const vamt = (label: RegExp) => vrows.filter((r) => r.label && label.test(r.label)).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  check('a void takes a meal back by its own share, on line 24b and below', Math.abs(vamt(/^Line 24b/)) < 0.01 && Math.abs(vamt(/Not deductible — the other half/)) < 0.01, vrows.filter((r) => /24b|meal/i.test(r.label || '')));
  const S = await import('../../src/components/money/BooksScreen'); const byId = new Map<string, any>([['pm', ex('pm', 'Meals', 30, { writeOff: { meal: { kind: 'personal' } } })]]);
  check('the books’ tax line says a meal by its kind', /all counts/.test(S.taxLineOf(ex('a', 'Meals', 30, { writeOff: { meal: { kind: 'team' } } }))) && /half counts/.test(S.taxLineOf(ex('a', 'Meals', 30)))
    && /not deductible/.test(S.taxLineOf(ex('a', 'Meals & Entertainment', 30, { writeOff: { meal: { kind: 'entertainment' } } }))) && /not deductible/.test(S.taxLineOf({ id: 'rp', type: 'reversal', reversalOf: 'pm', amount: 30, date: '2026-05-12T12:00:00.000Z' }, byId))
    && /the same share as the meal it takes back/.test(S.taxLineOf({ id: 'rq', type: 'reversal', reversalOf: 'gone', category: 'Meals', reversedType: 'expense', amount: 30, date: '2026-05-12T12:00:00.000Z' }, byId)));
  check('gifts on line 27a only up to $25 a person; the rest not deductible', Math.abs(amt(/gifts, up to \$25 a person/) - (25 + 50)) < 0.01 && Math.abs(amt(/Not deductible — gifts over \$25 a person/) - (155 + 50)) < 0.01);

  console.log('Saying it, from the Write-offs tab');
  for (const l of [ex2('m1', 'Meals & Entertainment', 86.4), ex2('g1', 'Business Gifts', 180), ex2('e1', 'Equipment', 3480), ex2('s1', 'Supplies', 20)]) await db.doc(`tenants/t1/transactions/${l.id}`).set(l);
  await db.doc(`tenants/t1/transactions/old2`).set(ex('old2', 'Meals & Entertainment', 50, { date: `${year - 3}-05-10T12:00:00.000Z` }));
  await db.doc(`tenants/t1/transactions/rx`).set({ type: 'reversal', reversalOf: 'gx', amount: 40, date: `${year}-06-01T12:00:00.000Z` });
  await db.doc(`tenants/t1/transactions/gx`).set(ex2('gx', 'Business Gifts', 40));
  // (A meal voided (the void has no meal category), a meal reversed and put back, and a meal dated as a stored time.)
  await db.doc(`tenants/t1/transactions/mv`).set(ex2('mv', 'Meals & Entertainment', 95));
  await db.doc(`tenants/t1/transactions/vv`).set({ type: 'income', category: 'Void', voidOf: 'mv', amount: 95, date: `${year + 1}-01-03T12:00:00.000Z` });
  await db.doc(`tenants/t1/transactions/mb`).set(ex2('mb', 'Meals', 30, { writeOff: { meal: { kind: 'personal' } } }));
  await db.doc(`tenants/t1/transactions/rb`).set({ type: 'reversal', reversalOf: 'mb', amount: 30, date: `${year}-06-01T12:00:00.000Z` });
  await db.doc(`tenants/t1/transactions/ub`).set({ type: 'reversal', reversalOf: 'rb', amount: 30, date: `${year}-06-02T12:00:00.000Z` });
  await db.doc(`tenants/t1/transactions/mt`).set({ ...ex('mt', 'Meals & Entertainment', 22), date: { seconds: Date.parse(`${year}-02-02T12:00:00.000Z`) / 1000, nanoseconds: 0 } });
  await db.doc(`tenants/t1/transactions/sale`).set({ id: 'sale', type: 'income', category: 'Service Revenue', amount: 80, date: `${year}-05-10T12:00:00.000Z` });
  // (Places the business books costs from: its own account's learned rules, lib/plaid-sync.)
  const rule = (id: string, category: string, type = 'expense') => db.doc(`tenants/t1/vendorRules/${id}`).set({ category, type, context: id.startsWith('business:') ? 'Business' : 'Personal' });
  await rule('business:beauty supply', 'Supplies'); await rule('business:lash wholesale', 'Supplies'); await rule('business:target', 'Supplies');
  await rule('business:owner bank', 'Distribution'); await rule('business:pay co', 'Payroll'); await rule('personal:paper store', 'Supplies');
  const bank = (id: string, x: any) => db.doc(`tenants/t1/bankTransactions/${id}`).set({ direction: 'out', date: `${year}-05-02`, amountCents: 5000, status: 'unmatched', context: 'Personal', ...x });
  await bank('pp', { merchant: 'Beauty Supply #40', amountCents: 6420 });
  await bank('pl', { merchant: 'Lash Wholesale', date: `${year}-05-03` });
  await bank('pq', { merchant: 'Grocery', amountCents: 9000 });
  await bank('pt', { merchant: 'Target', plaidCategory: 'GENERAL_MERCHANDISE', plaidDetailed: 'GENERAL_MERCHANDISE_SUPERSTORES' });
  await bank('pi', { merchant: 'Paper Store' });
  await bank('pd', { merchant: 'Owner Bank' }); await bank('py', { merchant: 'Pay Co' });
  await bank('ps', { merchant: 'Lash Wholesale', status: 'created' }); await bank('pn', { merchant: 'Lash Wholesale', pending: true });
  await bank('bb', { context: 'Business', merchant: 'Beauty Supply #12' });
  const POST: (r: any) => Promise<any> = (await import('../../src/app/api/writeoffs/route')).POST as any;
  let r = await POST(req({ action: 'list' }));
  check('the year’s list: the meals to finish (one dated as a stored time; not one voided, even by a later void), the gift (not one taken back), the equipment; nothing from years ago',
    r.status === 200 && r.body.found.meals.needDetail.map((m: any) => m.id).sort().join() === 'm1,mt' && r.body.found.gifts.needPeople.map((g: any) => g.id).join() === 'g1' && r.body.found.equipment[0]?.id === 'e1' && !r.body.partial, r.body.found?.meals);
  check('a meal whose reversal was taken back is counted again, as said (personal)', r.body.found.meals.lines.some((m: any) => m.id === 'mb') && !r.body.found.meals.lines.some((m: any) => m.id === 'mv'));
  const route = src('src/app/api/writeoffs/route.ts');
  check('the read is the kinds looked at by category, then take-backs by what they take back: never every line in a stretch of dates', /col\.where\('category', 'in', KINDS\)/.test(route) && /\['reversalOf', 'voidOf'\]\.map\(\(f\) => col\.where\(f, 'in', ids\)/.test(route) && !/transactions`\)\.where\('date'/.test(route));
  check('personal purchases, unsorted, from places the business books costs from (not a superstore, a grocery, a draw, payroll, or a rule for personal costs)', r.body.found.personal.map((p: any) => p.id).join() === 'pl,pp', r.body.found?.personal);
  actor = { id: 'u2', name: 'Bookkeeper', role: 'manager', caps: ['money.manage'] };
  r = await POST(req({ action: 'list' }));
  const r2 = await POST(req({ action: 'personal', id: 'pp' }));
  check('someone else who keeps the books sees no personal-account purchases, and can’t answer them', r.status === 200 && r.body.found.personal.length === 0 && r.body.owner === false && r2.status === 403);
  actor = { id: 'u1', name: 'Jess', isTenantOwner: true };
  r = await POST(req({ action: 'personal', id: 'pp' }));
  const r3 = await POST(req({ action: 'personal', id: 'bb' }));
  r2.body = (await POST(req({ action: 'list' }))).body;
  check('the owner says one was personal: not asked again, kept privately; a business line isn’t one', r.status === 200 && r2.body.found.personal.map((p: any) => p.id).join() === 'pl' && (await db.doc('tenants/t1/private/writeOffs').get()).data()?.personalNo?.pp === true && r3.status === 404);
  const reports = src('src/components/money/ReportsScreen.tsx');
  check('reports look up what a take-back takes back when it’s from before their dates, so a meal is taken back as it was counted', /const withOriginals = async/.test(reports) && /taxSummaryRows\(ls, \{ lookup: await withOriginals\(ls\) \}\)/.test(reports)
    && /buildTaxSummaryHtml\(ls, range!, 'USD', \{ lookup: await withOriginals\(ls\)/.test(reports) && /getDoc\(doc\(firestore, 'tenants', tenantId, 'transactions', id\)\)/.test(reports));
  r = await POST(req({ action: 'meal', id: 'm1', kind: 'business', who: 'Maria G.' }));
  check('a business meal without what it was about: asked for', r.status === 400 && /IRS asks/.test(r.body.error));
  r = await POST(req({ action: 'meal', id: 'm1', kind: 'business', who: 'Maria G., our product rep', why: 'Spring product order' }));
  const m1: any = (await db.doc('tenants/t1/transactions/m1').get()).data();
  check('saved on the line, with who said it; in the activity without the details', r.status === 200 && m1.writeOff.meal.kind === 'business' && m1.writeOff.meal.why === 'Spring product order' && m1.writeOff.meal.by === 'Jess' && m1.amount === 86.4
    && audits.some((e) => e.action === 'writeoffs.meal' && !/Maria/.test(e.summary)));
  r = await POST(req({ action: 'meal', id: 's1', kind: 'team' }));
  check('only a meal takes meal details, only a gift how many people', r.status === 400 && (await POST(req({ action: 'gift', id: 'm1', people: 2 }))).status === 400);
  r = await POST(req({ action: 'gift', id: 'g1', people: 3 }));
  check('a gift’s people kept', r.status === 200 && (await db.doc('tenants/t1/transactions/g1').get()).data()?.writeOff?.giftPeople === 3);
  r = await POST(req({ action: 'receipt', id: 'm1', url: 'https://evil.example/x.jpg' }));
  check('a receipt from anywhere else is refused', r.status === 400);
  r = await POST(req({ action: 'receipt', id: 'm1', url: fsUrl('cf-app.firebasestorage.app', 'tenants/t1/uploads/1764_ab12cd.jpg') }));
  check('a receipt photo kept with the line', r.status === 200 && (await db.doc('tenants/t1/transactions/m1').get()).data()?.hasReceipt === true);
  r = await POST(req({ action: 'note', id: 'e1', on: true }));
  check('equipment marked for the accountant, in the activity', (await db.doc('tenants/t1/transactions/e1').get()).data()?.writeOff?.forAccountant === true && audits.some((e) => e.action === 'writeoffs.note'));
  r = await POST(req({ action: 'note', id: 's1', on: true }));
  check('only equipment of $2,500 or more is marked', r.status === 400 && !(await db.doc('tenants/t1/transactions/s1').get()).data()?.writeOff);
  r = await POST(req({ action: 'meal', id: 'nope', kind: 'team' }));
  check('a line that isn’t in the books', r.status === 404);
  r = await POST(req({ action: 'check', year, item: 'homeOffice', answer: 'ask' }));
  r = await POST(req({ action: 'list' }));
  check('the often-missed answers kept for the year, privately', r.body.checklist.homeOffice === 'ask' && (await db.doc('tenants/t1/private/writeOffs').get()).data()?.checklist?.[String(year)]?.homeOffice === 'ask' && CHECKLIST.length === 5);
  actor = { id: 'u2', name: 'Bookkeeper', role: 'manager' };
  r = await POST(req({ action: 'check', year, item: 'health', answer: 'ask' }));
  check('only the owner answers the often-missed ones (about their own taxes)', r.status === 403);
  actor = { id: 'u1', name: 'Jess', isTenantOwner: true };

  console.log('On the page');
  const screen = src('src/components/money/WriteOffsScreen.tsx'); const page = src('src/app/(app)/money/page.tsx');
  check('personal purchases, for the owner: booked as the business’s through the bank’s own booking, naming who did it, or kept as personal', /'\/api\/plaid', \{ actor, action: 'resolve', bankTxnId: p\.id, mode: 'create', contextOverride: 'Business' \}/.test(screen) && /actor=\{writeOffsActor\}/.test(page)
    && /w!\.owner && f\.personal\.length > 0 && <Row title="Was this for the business\?"/.test(screen) && /action: 'personal', id: p\.id/.test(screen));
  const mileage = src('src/app/api/mileage/route.ts');
  check('the mileage log suggests drives to the owner only (they come from the owner’s card purchases too)', /const sugg = year === thisYear && a\.isTenantOwner \?/.test(mileage));
  check('a closed month: said in the activity, the books’ own figures kept', /is closed; the books stay as they were/.test(src('src/app/api/writeoffs/route.ts')) && /writeOff`, isn't a figure either/.test(src('src/lib/books-close.ts')));
  check('a meal’s form shows what counts as it’s picked, and prints for the accountant', /of \{usd\(line\.cents\)\} counts/.test(screen) && /Print for your accountant/.test(screen) && /writeOffsBodyHtml\(w\.found/.test(screen));
  check('the tab ends saying the tax summary counts them the same way, and the accountant decides', /The Tax summary in Reports counts meals and gifts the same way/.test(screen));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
