// Checks a renter's own Write-offs in their portal (Money, Your business, Write-offs; included in rent;
// api/portal/renter-writeoffs, lib/renter-write-offs, components/rent/RenterWriteOffs):
//   Rent and space fees paid to the business, by their renter id (never by name), less refunds to their card; a
//   security deposit held isn't rent. Business miles from their own mileage log. Their logged costs by kind: a meal
//   half counts and needs who and why; a gift counts up to $25 a person and needs how many; equipment of $2,500 or more
//   is the accountant's choice; meals, travel and gifts of $75 or more need a receipt kept. Tips the front desk
//   collected for them. Insurance and their license when nothing's logged. The often-missed checklist kept privately
//   with their log. Only their own costs, and no one else can change them. A print for their accountant. Earnings and
//   expenses uses the same kinds (US spelling, old costs shown in today's words). The rent statement's 1099 note says
//   rent goes the other way, at $2,000 from 2026.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-writeoffs.verify.ts
import fs from 'fs';
import Module from 'module';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { makeDb, check, failures } from './fake-db';
import { costKindOf, renterCounts, renterFound, rentPaidOf, deskTipsOf, missingRenterUsual, cleanRenterCost, renterWriteOffsHtml, RENTER_COST_KINDS } from '../../src/lib/renter-write-offs';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const db = makeDb();
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/here-server') return { bizLocationsOf: async () => [] };
  if (request === '@/lib/geocode-server') return { geocode: async () => null, reverseGeocode: async () => null, preciseEnough: () => false };
  if (request === '@/lib/route-server') return { roadLegs: async () => null };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const req = (body: any, token = 'tok-ana') => ({ json: async () => ({ tenantId: 't1', token, ...body }), headers: { get: () => null } }) as any;
const Y = Number(new Date().toISOString().slice(0, 4));
const cost = (id: string, category: string, cents: number, extra: any = {}) => ({ id, renterId: 'r1', date: `${Y}-03-0${(id.length % 8) + 1}`, cents, category, note: '', ...extra });

(async () => {
  console.log('Kinds and what counts');
  check('old costs in today’s words; anything else is Other; the list has meals and gifts, in US spelling', costKindOf('Licence & fees') === 'Licenses and fees' && costKindOf('Snacks') === 'Other' && costKindOf('Supplies') === 'Supplies'
    && RENTER_COST_KINDS.includes('Meals') && RENTER_COST_KINDS.includes('Gifts') && !RENTER_COST_KINDS.some((k) => /Licence/.test(k)));
  check('a meal half counts; a gift up to $25 a person; anything else all of it', renterCounts({ kind: 'Meals', cents: 5001 } as any).counts === 2501 && renterCounts({ kind: 'Gifts', cents: 9000, people: 2 } as any).counts === 5000
    && renterCounts({ kind: 'Gifts', cents: 9000, people: null } as any).counts === 2500 && renterCounts({ kind: 'Supplies', cents: 9000 } as any).counts === 9000);
  const exp = [cost('a', 'Supplies', 12000), cost('bb', 'Meals', 8000), cost('ccc', 'Meals', 3000, { note: 'Dana, product rep: spring order' }), cost('dddd', 'Gifts', 6000), cost('eeeee', 'Gifts', 4000, { people: 4 }),
    cost('ffffff', 'Equipment', 260000, { note: 'Pedicure throne' }), cost('g', 'Licence & fees', 7500), { ...cost('h', 'Supplies', 5000), date: `${Y - 1}-12-30` }, cost('i', 'Travel', 9000)];
  const f = renterFound(exp, Y);
  check('the year’s costs by kind, counted', f.kinds.find((k) => k.kind === 'Meals')?.counts === 5500 && f.kinds.find((k) => k.kind === 'Supplies')?.spent === 12000 && f.kinds.find((k) => k.kind === 'Licenses and fees')?.lines === 1
    && f.costs.counts === 12000 + 5500 + 2500 + 4000 + 260000 + 7500 + 9000, f.kinds);
  check('to finish: a meal without who and why, a gift without how many people', f.meals.needNote.map((c) => c.id).join() === 'bb' && f.gifts.needPeople.map((c) => c.id).join() === 'dddd' && f.toFinish === 2);
  check('equipment of $2,500 or more for the accountant; receipts to keep for meals, travel and gifts of $75 or more', f.equipment.length === 1 && f.equipment[0].title === 'Pedicure throne' && f.receipts === 2, f.receipts);
  check('insurance and a license: asked about when nothing’s logged', missingRenterUsual(exp, Y).join() === 'insurance' && missingRenterUsual([], Y).join() === 'insurance,licenses');

  console.log('Rent and tips');
  const pays = [{ id: 'p1', type: 'income', category: 'Booth Rent', amount: 800, date: `${Y}-01-05` }, { id: 'p1', type: 'income', category: 'Booth Rent', amount: 800, date: `${Y}-01-05` },
    { id: 'p2', type: 'income', category: 'Booth Rent', amount: 800, date: `${Y}-02-05` }, { id: 'p3', type: 'income', category: 'Booth Deposit', taxBucket: 'transfer', amount: 500, date: `${Y}-01-05` },
    { id: 'p4', type: 'reversal', rentRefundOf: 'p2', amountCents: 10000, date: `${Y}-02-09` }, { id: 'p5', type: 'income', category: 'Booth Rent', amount: 800, date: `${Y - 1}-12-05` },
    { id: 'p6', type: 'income', category: 'Renter Incidental', amount: 25, date: `${Y}-03-01` }];
  const rent = rentPaidOf(pays, Y);
  check('rent and fees paid in the year, once each, less a refund to their card; a deposit held and last year’s aren’t', rent.cents === 80000 + 80000 + 2500 - 10000 && rent.payments === 3, rent);
  const backs = [{ id: 'u1', type: 'reversal', undo: true, reversalOf: 'p1', amount: 800, date: `${Y}-01-20`, category: 'Booth Rent' }, { id: 'v1', type: 'expense', category: 'Void', voidOf: 'p6', amount: 25, date: `${Y}-03-02` },
    { id: 'k1', type: 'income', correctionOf: 'p2', category: 'Booth Rent', amount: 50, date: `${Y}-02-10` }, { id: 'k2', type: 'income', correctionOf: 'p2', category: 'Retail', amount: 70, date: `${Y}-02-10` },
    { id: 'u2', type: 'reversal', reversalOf: 'p3', amount: 500, date: `${Y}-02-10` }];
  const r2y = rentPaidOf([...pays, ...backs], Y);
  check('an undo or a void comes off; a correction for more counts while it’s still rent; taking back a deposit isn’t rent', r2y.cents === rent.cents - 80000 - 2500 + 5000, r2y);
  const led = [{ id: 'c1', type: 'desk_offset', status: 'paid', amountCents: -12000, appliedCents: 9000, lastAppliedAt: `${Y}-06-01T05:00:00Z`, date: `${Y}-05-01` },
    { id: 'c2', type: 'gift_card_credit', status: 'paid', amountCents: -3000, appliedCents: 0, date: `${Y}-05-01` }, { id: 'c3', type: 'retail_sale_credit', status: 'voided', amountCents: 0, appliedCents: 0, date: `${Y}-05-01` },
    { id: 'c4', type: 'retail_sale_credit', status: 'paid', amountCents: -1500, appliedCents: 1500, lastAppliedAt: `${Y}-07-01T05:00:00Z`, date: `${Y}-05-01` },
    { id: 'c5', type: 'desk_offset', status: 'paid', amountCents: -2000, appliedCents: 2000, lastAppliedAt: `${Y + 1}-01-01T05:00:00Z`, date: `${Y}-12-20` },
    { id: 'c6', type: 'leave_credit', status: 'paid', amountCents: -40000, appliedCents: 40000, lastAppliedAt: `${Y}-05-01T05:00:00Z`, date: `${Y}-05-01` }];
  const r3y = rentPaidOf(pays, Y, led);
  check('money the business owed them that went toward rent (front desk, gift cards, shop sales) counts as it’s used, in the year it’s used; unused credit and a discount like time away don’t', r3y.creditsCents === 10500 && r3y.cents === rent.cents + 10500, r3y);
  check('tips the front desk collected for them, not their services or a voided line', deskTipsOf([{ type: 'desk_collected', kind: 'tip', amountCents: 1500, date: `${Y}-04-01` }, { type: 'desk_collected', kind: 'service', amountCents: 9000, date: `${Y}-04-01` },
    { type: 'desk_collected', kind: 'tip', amountCents: 700, status: 'voided', date: `${Y}-04-01` }, { type: 'desk_collected', kind: 'tip', amountCents: 300, date: `${Y - 1}-04-01` }], Y) === 1500);

  console.log('A cost as sent');
  const today = `${Y}-06-15`;
  check('a day this year or last, up to today; an amount; a kind on the list', cleanRenterCost({ date: today, amount: '$1,024.50', kind: 'Supplies' }, today).ok && (cleanRenterCost({ date: today, amount: '1,024.50', kind: 'Supplies' }, today) as any).cost.cents === 102450
    && !cleanRenterCost({ date: `${Y}-06-16`, amount: '5', kind: 'Supplies' }, today).ok && !cleanRenterCost({ date: `${Y - 2}-06-16`, amount: '5', kind: 'Supplies' }, today).ok
    && !cleanRenterCost({ date: today, amount: '0', kind: 'Supplies' }, today).ok && !cleanRenterCost({ date: today, amount: '5', kind: 'Snacks' }, today).ok);
  check('how many people, for a gift only; a note cleaned', (cleanRenterCost({ date: today, amount: '30', kind: 'Gifts', people: '3' }, today) as any).cost.people === 3 && (cleanRenterCost({ date: today, amount: '30', kind: 'Supplies', people: 3 }, today) as any).cost.people === null
    && !cleanRenterCost({ date: today, amount: '30', kind: 'Gifts', people: 0 }, today).ok && !/</.test((cleanRenterCost({ date: today, amount: '3', kind: 'Other', note: 'a<b>' }, today) as any).cost.note));

  console.log('The route');
  await db.doc('tenants/t1').set({ name: 'North <Loft>', timezone: 'America/New_York' });
  await db.doc('tenants/t1/private/renterSessions').set({ [sha('tok-ana')]: { renterId: 'r1', name: 'Ana', expiresAt: Date.now() + 3600e3 }, [sha('tok-bo')]: { renterId: 'r2', name: 'Bo', expiresAt: Date.now() + 3600e3 } });
  for (const e of exp) await db.doc(`tenants/t1/renterExpenses/${e.id}`).set(e);
  await db.doc('tenants/t1/renterExpenses/bo1').set({ id: 'bo1', renterId: 'r2', date: `${Y}-03-01`, cents: 99900, category: 'Supplies', note: 'Bo’s' });
  await db.doc('tenants/t1/transactions/x1').set({ id: 'x1', type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 800, date: `${Y}-01-05`, renterId: 'r1' });
  await db.doc('tenants/t1/transactions/x2').set({ id: 'x2', type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 800, date: `${Y}-01-05`, renterId: 'r2', clientOrVendor: 'Ana' });
  await db.doc('tenants/t1/rentLedger/l1').set({ renterId: 'r1', type: 'desk_collected', kind: 'tip', amountCents: 2200, date: `${Y}-02-02` });
  await db.doc('tenants/t1/renters/r1').set({ name: 'Ana', phone: '+19195550101', email: 'ana@example.com' });
  await db.doc('tenants/t1/boothReservations/res1').set({ phone: '+19195550101', status: 'completed', startDate: `${Y}-04-04` });
  await db.doc('tenants/t1/transactions/x3').set({ id: 'x3', type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 60, date: `${Y}-04-04`, sourceId: 'res1' });
  await db.doc('tenants/t1/transactions/x4').set({ id: 'x4', type: 'income', source: 'booth_rent', category: 'Booth Rent', amount: 800, date: `${Y}-02-05`, renterId: 'r1' });
  await db.doc('tenants/t1/transactions/undo_x4').set({ id: 'undo_x4', type: 'reversal', undo: true, reversalOf: 'x4', amount: 800, date: `${Y}-02-06`, category: 'Booth Rent' });
  await db.doc('tenants/t1/rentLedger/l2').set({ renterId: 'r1', type: 'desk_offset', status: 'paid', amountCents: -5000, appliedCents: 5000, lastAppliedAt: `${Y}-06-02T05:00:00Z`, date: `${Y}-06-01` });
  await db.doc(`tenants/t1/private/renter_r1/mileage/trip_t1`).set({ kind: 'trip', id: 't1', year: Y, day: `${Y}-02-02`, use: 'business', purpose: 'supplies', tenths: 100, oneWayTenths: 50, roundTrip: true, from: { label: 'A' }, to: { label: 'B' }, by: { id: 'renter_r1', name: 'Ana' }, edits: [], removed: null });
  await db.doc(`tenants/t1/private/trip_o1`).set({ kind: 'trip', id: 'o1', year: Y, day: `${Y}-02-02`, use: 'business', purpose: 'bank', tenths: 900, oneWayTenths: 450, roundTrip: true, from: { label: 'A' }, to: { label: 'B' }, by: { id: 'u1', name: 'Owner' }, edits: [], removed: null });
  const POST: (r: any) => Promise<any> = (await import('../../src/app/api/portal/renter-writeoffs/route')).POST as any;
  let r: any = await POST(req({ action: 'list' }, 'nope'));
  check('no session: asked to sign in again', r.status === 401);
  r = await POST(req({ action: 'list' }));
  const b = r.body;
  check('their rent by their renter id, not someone else’s with the same name; a space booked with their phone; an undone payment taken off; front-desk money taken off rent counts', r.status === 200 && b.rent.cents === 80000 + 6000 + 5000 && b.rent.payments === 2 && b.rent.creditsCents === 5000, b.rent);
  check('their own costs only', b.found.kinds.every((k: any) => k.kind !== 'Supplies' || k.spent === 12000) && !JSON.stringify(b.found).includes('Bo’s'));
  check('their miles, from their own log, not the business’s', b.miles?.tenths === 100 && b.miles.trips === 1, b.miles);
  check('tips the front desk collected for them; the business named, cleaned', b.deskTipsCents === 2200 && !/[<>]/.test(b.space));
  r = await POST(req({ action: 'add', date: `${Y - 3}-01-01`, amount: '20', kind: 'Supplies' }));
  check('a cost from years back is refused', r.status === 400);
  r = await POST(req({ action: 'add', date: b.today, amount: '45', kind: 'Gifts', note: 'Thank-you candles', people: 2 }));
  const added: any = (await db.doc(`tenants/t1/renterExpenses/${r.body.id}`).get()).data();
  check('a cost added: theirs, in the same shape Earnings and expenses keeps', r.status === 200 && added.renterId === 'r1' && added.cents === 4500 && added.category === 'Gifts' && added.people === 2 && added.date === b.today, added);
  r = await POST(req({ action: 'finish', id: 'bo1', note: 'mine now' }));
  check('another renter’s cost: not theirs to change', r.status === 404 && (await db.doc('tenants/t1/renterExpenses/bo1').get()).data().note === 'Bo’s');
  r = await POST(req({ action: 'finish', id: 'bb', note: 'x' }));
  check('a meal’s who and why: more than a letter', r.status === 400);
  r = await POST(req({ action: 'finish', id: 'bb', note: 'Lena, educator: class planning' }));
  const r2: any = await POST(req({ action: 'finish', id: 'dddd', people: 3 }));
  r = await POST(req({ action: 'list' }));
  check('finished: nothing left to finish', r2.status === 200 && r.body.found.toFinish === 0, r.body.found);
  r = await POST(req({ action: 'check', year: Y, item: 'homeOffice', answer: 'ask' }));
  const bad: any = await POST(req({ action: 'check', year: Y, item: 'yacht', answer: 'ask' }));
  const kept: any = (await db.doc('tenants/t1/private/renter_r1/writeOffs/checklist').get()).data();
  check('the checklist kept privately with their log; an item not on it refused', r.status === 200 && bad.status === 400 && kept?.[String(Y)]?.homeOffice === 'ask' && (await POST(req({ action: 'list' }))).body.checklist.homeOffice === 'ask');
  r = await POST(req({ action: 'list' }, 'tok-bo'));
  check('another renter’s answers are their own', r.body.checklist.homeOffice === undefined && r.body.rent.cents === 80000);
  const stm = src('src/app/api/booths/statement/route.ts');
  check('the rent statement takes undone, voided and corrected payments into account the same way, and credit used toward rent', /rentTakeBacks\(db, tenantId, pays\.map/.test(stm) && /const cents = rentLineCents\(t, byId\); if \(!cents\) continue;/.test(stm)
    && /for \(const c of rentCreditsUsed\(ledger, year\)\)/.test(stm));

  console.log('The print');
  const html = renterWriteOffsHtml({ found: renterFound(exp, Y), rent, space: 'North <Loft>', miles: { tenths: 100, cents: 725, rate: '72.5¢', trips: 1 }, deskTipsCents: 1500, checklist: { homeOffice: 'ask', phone: 'no' }, missing: ['insurance'] });
  check('rent, miles, each kind, equipment, tips, what to ask, receipts and what’s left; names escaped', /Rent and space fees paid to North &lt;Loft&gt;/.test(html) && /Business miles/.test(html) && /half of a business meal counts/.test(html) && /Equipment: Pedicure throne/.test(html)
    && /Tips collected for you at the front desk/.test(html) && /A home office/.test(html) && !/Your phone and internet/.test(html) && /Your insurance/.test(html) && /Keep the receipts for 2 meal, gift or travel costs/.test(html) && /Still to finish/.test(html));

  console.log('Where it is, and who sees it');
  const PM = await import('../../src/components/rent/portal-map');
  const base = { booksHere: false, hasRenter: true, hasLease: true, swapsOn: false };
  check('Money, Your business, Write-offs: for anyone with a renter record', PM.viewAllowed('writeoffs', base) && !PM.viewAllowed('writeoffs', { ...base, hasRenter: false }) && PM.VIEW_PARENT.writeoffs === 'money'
    && PM.placeRows('money', base).some((g: any) => g.id === 'business' && g.views.includes('writeoffs')));
  const readers = execSync("grep -rl renterExpenses src/app src/lib src/components || true", { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
  check('only the renter’s own portal routes read their costs', readers.every((f) => /^src\/app\/api\/portal\/renter(-writeoffs|-taxes)?\/route\.ts$/.test(f) || f === 'src/lib/renter-write-offs.ts'), readers);
  const rules = src('firestore.rules'); const team = rules.slice(rules.indexOf('match /tenants/{tenantId}/{collection}/{rest=**}'), rules.indexOf('match /tenants/{tenantId}/jobListings/'));
  check('the rules keep their costs from the business’s team: server only', /'choiceSets',\s*'renterExpenses'\s*\]\);/.test(team) && (rules.match(/renterExpenses/g) || []).length === 2);
  const page = src('src/app/rent/[tenantId]/page.tsx'); const screen = src('src/components/rent/RenterWriteOffs.tsx'); const books = src('src/components/rent/setup.tsx');
  check('the portal opens it with their session; the screen says it’s a starting point, seen only by them', /case 'writeoffs': return <RenterWriteOffs tenantId=\{tenantId\} token=\{token\}/.test(page) && /'\/api\/portal\/renter-writeoffs'/.test(screen)
    && /A starting point for your accountant, who decides what goes on your return\. Your costs and answers here are seen only by you/.test(screen));
  check('Earnings and expenses: the same kinds, old ones in today’s words', /RENTER_COST_KINDS\.map\(\(c\) => <option key=\{c\}>/.test(books) && /\{costKindOf\(e\.category\)\}/.test(books) && !/Licence/.test(books));
  const st = src('src/app/api/booths/statement/route.ts');
  check('the rent statement: rent goes the other way, a 1099-MISC, $2,000 from 2026, counting only rent paid by check, cash or bank transfer', /const limit = data\.year >= 2026 \? 2000 : 600;/.test(st) && /usually sends the landlord a Form 1099-MISC/.test(st) && !/The studio may issue a 1099-NEC/.test(st)
    && /const threshold = \(data\.byHandDollars \|\| 0\) >= limit;/.test(st) && /rentByHand:  orig\.category === 'Booth Rent' && !BY_PROCESSOR\.test/.test(st) && /Rent paid by card or a payment app\s+is left out: the processor reports it\./.test(st) && !/ · /.test(st));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
