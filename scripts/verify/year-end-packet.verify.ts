// Checks closing the year (the top of the Money page's Reports tab; lib/year-end-packet, components/money/YearEndPacket):
//   What's left before the year goes to the accountant: lines without a category, bank lines waiting, write-offs to
//   finish and (the owner's) often-missed ones to answer, the odometer readings, the year's W-2s and 1099s, the owner's
//   last estimated tax payment, the latest sales tax return and the months closed, each with the way to it. Done, to do
//   or just to know. The packet: what's still to finish, profit and loss, the tax summary, write-offs, the mileage log,
//   the owner's estimated tax payments, the team's W-2 and 1099 totals and the year's sales tax, all escaped. For
//   whoever keeps the books, the owner's own parts for the owner alone; nothing read until it's asked for.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/year-end-packet.verify.ts
import fs from 'fs';
import * as F from './fake-db';
const { check } = F;
import { yearItems, packetBody, yearToClose, paymentsToward, renterYearItems, renterPacketBody, type YearItem } from '../../src/lib/year-end-packet';
import { booksSummary } from '../../src/lib/books-summary';
import { findWriteOffs } from '../../src/lib/write-offs';
import { withCarried, carriedKept } from '../../src/lib/renter-taxes';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const Y = 2026;
const by = (items: YearItem[], key: string) => items.find((i) => i.key === key);
const base = (over: any = {}) => ({ year: Y, s: { unsorted: { count: 0, amount: 0 } }, bankWaiting: 0, wo: null, mi: null, ot: null, owner: true, payroll: null, tax: null,
  closedThrough: '', began: '', today: '2026-11-27', ...over });

console.log('The year to close');
check('in November, this year', yearToClose('2026-11-27') === 2026);
check('until the end of April, last year', yearToClose('2027-03-10') === 2026);
check('from May, the new year', yearToClose('2027-04-30') === 2026 && yearToClose('2027-05-01') === 2027);

console.log('Estimated payments toward a year');
const pay = (date: string, cents = 120000, to = 'irs') => ({ id: date, date, cents, to });
check('the plan year’s own', paymentsToward({ year: Y, payments: [pay('2026-06-15')] }, Y)?.length === 1);
check('last year’s, until April 15', paymentsToward({ year: Y + 1, lastYearOpen: true, lastYearPayments: [pay('2027-01-12')] }, Y)?.length === 1);
check('after April 15, not known from here (never “none”)', paymentsToward({ year: Y + 1, lastYearOpen: false, lastYearPayments: [] }, Y) === null);
check('through April 30, last year’s as recorded', paymentsToward({ year: Y + 1, lastYearOpen: false, lastYearPayments: [], lastYearRecorded: [pay('2027-01-12')] }, Y)?.length === 1);
check('nothing read, nothing known', paymentsToward(null, Y) === null);

console.log('The books and the bank');
let it = yearItems(base({ s: { unsorted: { count: 3, amount: 120 } }, bankWaiting: 2 }));
check('lines without a category, to Books', by(it, 'unsorted')?.state === 'todo' && by(it, 'unsorted')!.title === '3 lines without a category' && by(it, 'unsorted')!.href === '/money?tab=ledger');
check('bank lines waiting, to Bank', by(it, 'bank')?.state === 'todo' && by(it, 'bank')!.title === '2 bank lines to sort' && by(it, 'bank')!.href === '/money?tab=bank');
it = yearItems(base({ s: { unsorted: { count: 1, amount: 5 } }, bankWaiting: 0 }));
check('one line; nothing from the bank', by(it, 'unsorted')!.title === '1 line without a category' && by(it, 'bank')?.state === 'ok');
check('the bank couldn’t be counted: not said at all', !by(yearItems(base({ bankWaiting: null })), 'bank'));
it = yearItems(base({ unread: ['Estimated taxes'] }));
check('something that couldn’t be read: a to-do, never “finished”', by(it, 'unread-Estimated taxes')?.state === 'todo' && by(it, 'unread-Estimated taxes')!.title === 'Estimated taxes couldn’t be read just now'
  && !/Everything ClarityFlow checks/.test(packetBody({ year: Y, items: it, ls: [], lookup: [], wo: null, mi: null, ot: null, owner: true, w2s: [], necs: [] })));
check('each read that failed is said', /unread: \[\.\.\.\(woY \? \[\] : \['Write-offs'\]\), \.\.\.\(miY \? \[\] : \['The mileage log'\]\), \.\.\.\(owner && !otY \? \['Estimated taxes'\] : \[\]\)\]/.test(src('src/components/money/YearEndPacket.tsx')));
check('more waiting than could be read: at least, never done', by(yearItems(base({ bankWaiting: 12, bankCapped: true })), 'bank')!.title === 'At least 12 bank lines to sort'
  && by(yearItems(base({ bankWaiting: 0, bankCapped: true })), 'bank')?.state === 'todo');

console.log('Write-offs');
const wo = (toFinish: number, checklist: any = {}) => ({ found: { toFinish }, checklist });
it = yearItems(base({ wo: wo(2, { homeOffice: 'no', phone: 'ask' }) }));
check('to finish', by(it, 'writeoffs')?.state === 'todo' && by(it, 'writeoffs')!.title === '2 write-offs to finish' && by(it, 'writeoffs')!.href === '/money?tab=writeoffs');
check('the often-missed ones not answered, for the owner', by(it, 'missed')?.state === 'todo' && by(it, 'missed')!.title === '3 often-missed write-offs to answer');
it = yearItems(base({ owner: false, wo: wo(0, {}) }));
check('finished; the often-missed ones aren’t asked of anyone but the owner', by(it, 'writeoffs')?.state === 'ok' && !by(it, 'missed'));
it = yearItems(base({ wo: wo(0, { homeOffice: 'no', phone: 'no', health: 'ask', retirement: 'ask', tips: 'no' }) }));
check('every one answered: nothing to ask', !by(it, 'missed'));

console.log('Miles and the odometer');
const mi = (trips: number, odometer: any) => ({ summary: { trips, businessTenths: 1234, amountCents: 8700, rate: { label: '$0.70' }, odometer } });
check('no miles: something to know, not a to-do', by(yearItems(base({ mi: mi(0, { start: null, end: null }) })), 'miles')?.state === 'info');
it = yearItems(base({ mi: mi(4, { start: null, end: null }) }));
check('no January reading: the owner’s to-do', by(it, 'miles')?.state === 'todo' && by(it, 'miles')!.href === '/mileage' && /123\.4 business miles/.test(by(it, 'miles')!.sub));
it = yearItems(base({ owner: false, mi: mi(4, { start: null, end: null }) }));
check('for others, the owner’s to enter', by(it, 'miles')?.state === 'info' && /the owner enters them/.test(by(it, 'miles')!.sub));
it = yearItems(base({ mi: mi(4, { start: 41000, end: null }) }));
check('before December 31: write it down then', by(it, 'miles')?.state === 'info' && /December 31/.test(by(it, 'miles')!.sub));
it = yearItems(base({ today: '2027-01-08', mi: mi(4, { start: 41000, end: null }) }));
check('after December 31 with no reading: to do', by(it, 'miles')?.state === 'todo');
check('both readings: done', by(yearItems(base({ mi: mi(4, { start: 41000, end: 52000 }) })), 'miles')?.state === 'ok');

console.log('The team’s forms');
it = yearItems(base({ payroll: { w2s: 3, necs: 1 } }));
check('W-2s and 1099s, due the next business day after January 31 (a Sunday in 2027), from Payday', by(it, 'payroll')?.state === 'info' && by(it, 'payroll')!.title === 'W-2s for 3 people and 1 1099-NEC' && /^Due February 1, 2027\./.test(by(it, 'payroll')!.sub) && by(it, 'payroll')!.href === '/money?tab=payday');
it = yearItems(base({ today: '2027-02-10', payroll: { w2s: 1, necs: 0 } }));
check('after the date: said as past', by(it, 'payroll')!.title === 'W-2s for 1 person' && /^They were due/.test(by(it, 'payroll')!.sub));
check('no forms, or the paydays can’t be read: not said', !by(yearItems(base({ payroll: { w2s: 0, necs: 0 } })), 'payroll') && !by(yearItems(base({ payroll: null })), 'payroll'));

console.log('Estimated taxes (the owner’s)');
const ot = (structure: string | null, payments: any[] = [], year = Y) => ({ year, settings: { structure, stateName: 'Ohio' }, payments, lastYearOpen: true, lastYearPayments: payments });
check('its own return: the accountant works out those payments', by(yearItems(base({ ot: ot('other') })), 'estimated')?.state === 'info' && /accountant works out those payments/.test(by(yearItems(base({ ot: ot('other') })), 'estimated')!.sub) && !by(yearItems(base({ ot: ot('other') })), 'estimated')!.href);
check('not said yet: say how on the Taxes tab', /^Say how the business files/.test(by(yearItems(base({ ot: ot(null) })), 'estimated')!.sub));
it = yearItems(base({ ot: ot('schedule_c', [pay('2026-06-15')]) }));
check('the last payment, due January 15', by(it, 'estimated')?.state === 'todo' && by(it, 'estimated')!.title === 'Last estimated tax payment, due January 15, 2027' && by(it, 'estimated')!.href === '/money?tab=taxes');
it = yearItems(base({ today: '2027-01-20', ot: ot('schedule_c', [pay('2027-01-12')], Y + 1) }));
check('paid toward it, recorded in January', by(it, 'estimated')?.state === 'ok');
it = yearItems(base({ today: '2027-01-20', ot: ot('schedule_c', [], Y + 1) }));
check('its date gone without one: something to know, not a to-do', by(it, 'estimated')?.state === 'info');
check('never for anyone but the owner', !by(yearItems(base({ owner: false, ot: ot('schedule_c') })), 'estimated'));
check('payments not known from here: not said', !by(yearItems(base({ today: '2027-05-10', ot: { ...ot('schedule_c', [], Y + 1), lastYearOpen: false } })), 'estimated'));

console.log('Sales tax and the months');
check('the latest return paid', by(yearItems(base({ tax: { last: { period: '2026-10', label: 'October 2026', paid: true, due: 'November 20' } } })), 'salestax')?.state === 'ok');
check('a return from a later year is never taken for the year’s', !by(yearItems(base({ today: '2027-03-10', tax: { last: { period: '2027-02', label: 'February 2027', paid: true, due: 'March 20' } } })), 'salestax'));
it = yearItems(base({ tax: { last: { period: '2026-10', label: 'October 2026', paid: false, due: 'November 20' }, owed: { due: 'November 20', cents: 41200 } } }));
check('owed: to do', by(it, 'salestax')?.state === 'todo' && by(it, 'salestax')!.title === 'Sales tax for October 2026, due November 20');
check('nothing owed', by(yearItems(base({ tax: { last: { period: '2026-Q3', label: 'Q3 2026', paid: false, due: 'October 31' }, owed: null } })), 'salestax')?.state === 'ok');
check('sales tax not set up: not said', !by(yearItems(base({ tax: { unset: true } })), 'salestax'));
it = yearItems(base({ closedThrough: '2026-10' }));
check('every month before this one closed', by(it, 'months')?.state === 'ok' && by(it, 'months')!.title === 'Every month of 2026 closed');
it = yearItems(base({ closedThrough: '2026-08' }));
check('some closed, to the Overview', by(it, 'months')?.state === 'info' && by(it, 'months')!.title === '8 of 10 months closed' && by(it, 'months')!.href === '/money?tab=overview');
it = yearItems(base({ closedThrough: '', began: '2026-09' }));
check('months before the business began aren’t asked about', by(it, 'months')!.title === '0 of 2 months closed');
it = yearItems(base({ today: '2027-02-02', closedThrough: '2026-12' }));
check('the year over: all twelve', by(it, 'months')?.state === 'ok');

console.log('The packet');
const lines: any[] = [
  { id: 's1', type: 'income', category: 'Services', amount: 5000, date: `${Y}-03-10T15:00:00.000Z`, context: 'Business', tax: 0 },
  { id: 'e1', type: 'expense', category: 'Supplies', amount: 800, date: `${Y}-03-12T15:00:00.000Z`, context: 'Business' },
  { id: 'm1', type: 'expense', category: 'Meals & Entertainment', amount: 200, date: `${Y}-04-15T15:00:00.000Z`, context: 'Business', description: 'Lunch <b>' },
  { id: 'p1', type: 'expense', category: 'Supplies', amount: 99, date: `${Y}-04-16T15:00:00.000Z`, context: 'Personal' },
];
const items = yearItems(base({ s: booksSummary(lines, { businessOnly: true }), wo: { found: findWriteOffs(lines, Y), checklist: {} }, bankWaiting: 1 }));
items.push({ key: 'x', state: 'todo', title: 'A <script>', sub: 'and "quotes"' });
const trips = [{ kind: 'trip', id: 't1', year: Y, day: `${Y}-05-02`, use: 'business', purpose: 'supplies', note: '', from: { label: 'Home' }, to: { label: 'Supply <store>' },
  oneWayTenths: 62, roundTrip: true, tenths: 124, how: 'typed', road: false, by: { id: 'u1', name: 'Owner' }, at: `${Y}-05-02T16:00:00.000Z` }];
const html = packetBody({ year: Y, items, ls: lines, lookup: lines, wo: { found: findWriteOffs(lines, Y), checklist: {} },
  mi: { summary: { trips: 1, businessTenths: 124, amountCents: 868, rate: { label: '$0.70' } }, trips, setup: { odometer: {} } },
  ot: ot('schedule_c', [pay('2026-09-15', 150000), pay('2026-04-15', 100000), pay('2026-06-15', 50000, 'state')]), owner: true,
  w2s: [{ name: 'Ana', b1: 30000, b2: 2500 }, { name: 'Bo', b1: 12000.5, b2: 800 }], necs: [{ name: 'Cy', amount: 4200 }] });
check('what’s still to finish, first', /Still to finish/.test(html) && /2 write-offs? to finish|write-off/.test(html) && /1 bank line to sort/.test(html));
check('everything escaped', html.includes('A &lt;script&gt;') && !html.includes('<script>') && !html.includes('Supply <store>'));
check('profit and loss, and the tax summary by line', /Profit and loss/.test(html) && /Tax summary, by Schedule C line/.test(html) && /Line 1/.test(html));
check('personal lines left out of the profit and loss', !/\$99\.00/.test(html.split('Tax summary')[0]));
check('write-offs and the mileage log', /Write-offs that are easy to miss/.test(html) && /Mileage log/.test(html) && /Supply &lt;store&gt;/.test(html));
const est = html.split('Estimated tax payments recorded')[1] || '';
check('the owner’s payments, in order, to whom, with the total', !!est && est.indexOf('April 15, 2026') < est.indexOf('June 15, 2026') && est.indexOf('June 15, 2026') < est.indexOf('September 15, 2026') && /Ohio/.test(est) && /\$3,000\.00/.test(est));
check('W-2 totals and 1099-NECs', /The team/.test(html) && /\$42,000\.50/.test(html) && /\$3,300\.00/.test(html) && /Cy/.test(html) && /\$4,200\.00/.test(html));
check('the year’s sales tax', /Sales tax for the year/.test(html) && /Paid to the state/.test(html));
const asked = { homeOffice: 'ask', health: 'ask' };
const ownerPk = packetBody({ year: Y, items: [], ls: lines, lookup: lines, wo: { found: findWriteOffs(lines, Y), checklist: asked }, mi: null, ot: null, owner: true, w2s: [], necs: [] });
const mgrPk = packetBody({ year: Y, items: [], ls: lines, lookup: lines, wo: { found: findWriteOffs(lines, Y), checklist: asked }, mi: null, ot: null, owner: false, w2s: [], necs: [] });
check('the owner’s own answers in the owner’s packet only', /To ask about/.test(ownerPk) && /Health insurance/.test(ownerPk) && !/To ask about/.test(mgrPk) && !/Health insurance/.test(mgrPk));
check('what’s already in the tax summary said, so it isn’t counted twice', /already counted in the tax summary above/.test(ownerPk));
const mgr = packetBody({ year: Y, items: [], ls: lines, lookup: lines, wo: null, mi: null, ot: ot('schedule_c', [pay('2026-04-15')]), owner: false, w2s: [], necs: [] });
check('for others: no owner’s payments; nothing to finish said so', !/Estimated tax payments/.test(mgr) && !/The team/.test(mgr) && /Everything ClarityFlow checks for the year is finished/.test(mgr));
const none = packetBody({ year: Y, items: [], ls: lines, lookup: lines, wo: null, mi: null, ot: ot('schedule_c', [], Y + 1), owner: true, w2s: [], necs: [] });
check('no payments recorded: said so', /None recorded in ClarityFlow/.test(none));
check('payments not known: no section, never “none”', !/Estimated tax payments/.test(packetBody({ year: Y, items: [], ls: lines, lookup: lines, wo: null, mi: null, ot: { ...ot('schedule_c', [], Y + 1), lastYearOpen: false }, owner: true, w2s: [], necs: [] })));

console.log('A renter’s year');
const rwo = (over: any = {}) => ({ found: { toFinish: 2, receipts: 1, kinds: [{ kind: 'Supplies', spent: 42000, counts: 42000, lines: 6 }], costs: { spent: 42000, counts: 42000 }, meals: { spent: 0, counts: 0, needNote: [] }, gifts: { needPeople: [] }, equipment: [] },
  rent: { cents: 960000, payments: 12, creditsCents: 0 }, space: 'North <Loft>', miles: null, deskTipsCents: 31000, checklist: { homeOffice: 'no' }, missing: ['insurance'], ...over });
const rmi = { summary: { trips: 2, businessTenths: 412, amountCents: 2987, rate: { label: '72.5¢' }, odometer: { start: null, end: null } }, trips, setup: { odometer: {} } };
it = renterYearItems({ year: Y, wo: rwo(), mi: rmi, tx: { payments: [pay('2026-06-15')] }, today: '2026-11-27' });
check('costs to finish, to Write-offs', by(it, 'writeoffs')?.state === 'todo' && by(it, 'writeoffs')!.title === '2 costs to finish' && by(it, 'writeoffs')!.view === 'writeoffs' && !by(it, 'writeoffs')!.href);
check('receipts to keep: something to know', by(it, 'receipts')?.state === 'info' && by(it, 'receipts')!.title === 'Keep 1 receipt');
check('their own often-missed ones to answer', by(it, 'missed')?.title === '4 often-missed write-offs to answer' && by(it, 'missed')!.view === 'writeoffs');
check('a usual cost not logged', by(it, 'usual')?.state === 'info' && /your insurance/.test(by(it, 'usual')!.title));
check('the odometer: theirs to read, to Mileage', by(it, 'miles')?.state === 'todo' && by(it, 'miles')!.view === 'mileage' && !/the owner enters/.test(by(it, 'miles')!.sub));
check('their last estimated payment, to Taxes to set aside', by(it, 'estimated')?.state === 'todo' && by(it, 'estimated')!.view === 'taxes' && /Taxes to set aside/.test(by(it, 'estimated')!.sub));
it = renterYearItems({ year: Y, wo: null, mi: null, tx: null, today: '2026-11-27', unread: ['Write-offs'] });
check('a renter’s read that failed: a to-do, never finished', by(it, 'unread-Write-offs')?.state === 'todo' && it.length === 1);
const earned: Record<string, number> = { [`${Y}-01`]: 410000, [`${Y}-02`]: 388050, [`${Y}-11`]: 120000 };
const rhtml = renterPacketBody({ year: Y, items: renterYearItems({ year: Y, wo: rwo(), mi: rmi, tx: { payments: [pay('2026-06-15'), pay('2026-04-14', 90000)] }, today: '2026-11-27' }),
  earnedByMonth: earned, wo: rwo(), mi: rmi, tx: { payments: [pay('2026-06-15'), pay('2026-04-14', 90000, 'state')], stateName: 'Georgia' } });
check('the renter’s packet: still to finish, then what they earned month by month with the total', /Still to finish/.test(rhtml) && /Earned through ClarityFlow/.test(rhtml) && /January/.test(rhtml) && /\$4,100\.00/.test(rhtml) && /\$9,180\.50/.test(rhtml) && /December/.test(rhtml));
check('their write-offs: rent, costs and front-desk tips, escaped', /Rent and space fees paid to North &lt;Loft&gt;/.test(rhtml) && /\$9,600\.00/.test(rhtml) && /Tips collected for you at the front desk/.test(rhtml) && !rhtml.includes('<Loft>'));
check('payments to their state, by name', /Georgia/.test(rhtml));
check('their mileage log and estimated payments in order, with the total', /Mileage log/.test(rhtml) && rhtml.indexOf('April 14, 2026') < rhtml.indexOf('June 15, 2026') && /\$2,100\.00/.test(rhtml));
check('while the year isn’t over, the months so far', !/December/.test(renterPacketBody({ year: Y, items: [], earnedByMonth: earned, wo: null, mi: null, tx: null, today: '2026-11-27' })) && /November/.test(renterPacketBody({ year: Y, items: [], earnedByMonth: earned, wo: null, mi: null, tx: null, today: '2026-11-27' })));
check('earnings not read: no section, never zeros', !/Earned through ClarityFlow/.test(renterPacketBody({ year: Y, items: [], earnedByMonth: null, wo: null, mi: null, tx: null })));

console.log('On the Reports tab');
const comp = src('src/components/money/YearEndPacket.tsx'); const rep = src('src/components/money/ReportsScreen.tsx'); const page = src('src/app/(app)/money/page.tsx');
check('shown to whoever keeps the books, the owner’s parts for the owner', /\{canManage && <YearEndPacket [^>]*owner=\{isOwner\}/.test(rep));
check('the owner is the owner', /isOwner=\{String\(role \|\| ''\) === 'owner'\}/.test(page));
check('nothing read until it’s asked for', !/useEffect/.test(comp) && /onClick=\{check\}/.test(comp) && /onClick=\{print\}/.test(comp));
check('the owner’s taxes asked for by the owner alone', /owner \? call\('\/api\/owner-taxes'/.test(comp));
check('the business’s own day', /const today = React\.useMemo\(\(\) => dayKey\(new Date\(\), tz\), \[tz\]\);/.test(comp));
check('bank lines: the year’s, the business’s own, not pending', /t\.context !== 'Personal' && !t\.pending && String\(t\.date \|\| ''\)\.slice\(0, 4\) === String\(y\)/.test(comp));
check('sales tax: the year’s own last return once it’s over', /action: 'status', year: y/.test(comp) && /lastEnded\(yearOver \? `\$\{Number\(forYear\) \+ 1\}-01-01` : today, f\)/.test(src('src/lib/sales-tax-server.ts'))
  && /taxStatus\(db, tenantId, tenant, Date\.now\(\), forYear\)/.test(src('src/app/api/money/sales-tax/route.ts')));
check('the owner’s often-missed answers go to the owner alone', /checklist: a\.isTenantOwner \? kept\.checklist\?\.\[String\(year\)\] \|\| \{\} : \{\}/.test(src('src/app/api/writeoffs/route.ts'))
  && /The owner answers this one\./.test(src('src/components/money/WriteOffsScreen.tsx')));
check('a new year starts with what was said last year (how the business files, how they file, the state, other income), never last year’s tax or income so far',
  JSON.stringify(withCarried({ payments: [], outsideCents: 0 }, { structure: 'schedule_c', filing: 'joint', state: 'GA', otherCents: 4000000, lastYearTaxCents: 900000, outsideCents: 50000, lastYearHigh: true, payments: [1] }))
    === JSON.stringify({ payments: [], outsideCents: 0, structure: 'schedule_c', filing: 'joint', state: 'GA', otherCents: 4000000 })
  && withCarried({ filing: 'single' }, { filing: 'joint' }).filing === 'single');
check('a year that moved to its own return still closes last year as it filed then', by(yearItems(base({ today: '2027-02-10', ot: { year: Y + 1, settings: { structure: 'other' }, lastYearOpen: true, lastYearPayments: [], lastYearRecorded: [pay('2027-01-12')], lastYearStructure: 'schedule_c' } })), 'estimated')?.state === 'ok'
  && /Estimated tax payments recorded/.test(packetBody({ year: Y, items: [], ls: lines, lookup: lines, wo: null, mi: null, ot: { year: Y + 1, settings: { structure: 'other' }, lastYearRecorded: [pay('2027-01-12')], lastYearStructure: 'schedule_c' }, owner: true, w2s: [], necs: [] })));
const carry = (async () => {
  // (Answers carry from the latest year that has them, up to three back, and the year keeps them.)
  const docs: Record<number, any> = { 2025: { structure: 'schedule_c', filing: 'joint', state: 'GA', otherCents: 100 }, 2026: { payments: [1] } };
  const c = await carriedKept(async (y) => docs[y] || {}, 2027, {});
  check('a year nobody opened doesn’t break the chain: 2027 gets 2025’s answers, to keep', c.kept.structure === 'schedule_c' && c.kept.filing === 'joint' && c.filled.state === 'GA' && c.before.structure === 'schedule_c' && c.last.payments?.length === 1);
  let threw = false; await carriedKept(async (y) => { if (y === 2026) throw new Error('read failed'); return docs[y] || {}; }, 2027, {}).catch(() => { threw = true; });
  check('a read that fails is an error, never a year with nothing in it (so nothing older is kept in its place)', threw);
  const own = await carriedKept(async (y) => docs[y] || {}, 2027, { filing: 'single' });
  check('what the year says itself stands', own.kept.filing === 'single' && !('filing' in own.filled));
})();
check('the owner’s and the renter’s set-asides both carry it, and keep what was carried', /ownerYearKept\(db, tenantId, year\)/.test(src('src/app/api/owner-taxes/route.ts')) && /carriedKept\(\(y\) => db\.doc\(`\$\{T\}\/private\/renter_\$\{rid\}\/taxes\/\$\{y\}`\)/.test(src('src/app/api/portal/renter-taxes/route.ts'))
  && (src('src/lib/owner-taxes-server.ts').match(/await yearKept\(db, t, soon\.forYear\)/g) || []).length === 2 && /ref\.set\(\{ \.\.\.c\.filled, carriedAt/.test(src('src/lib/owner-taxes-server.ts')) && /ref\.set\(\{ \.\.\.c\.filled, carriedAt/.test(src('src/app/api/portal/renter-taxes/route.ts')));
check('last year’s estimated payments read through April 30, changed only until April 15', /const lastRead = today <= `\$\{year\}-04-30`;/.test(src('src/app/api/owner-taxes/route.ts')) && /lastYearPayments: lastOpen &&/.test(src('src/app/api/owner-taxes/route.ts')));
check('the packet’s window opened at the tap, so it isn’t blocked', /window\.open\('', '_blank'\)/.test(comp) && comp.indexOf("window.open('', '_blank')") < comp.indexOf("setBusy('print')"));
check('the house style', !/uppercase|font-black|\{\/\*| · /.test(comp) && ![...comp.matchAll(/>([^<>{}\n]*)</g)].some((m) => m[1].includes("'")));
const rcomp = src('src/components/rent/RenterYearEnd.tsx'); const map = src('src/components/rent/portal-map.ts');
check('the renter’s Close the year: under Money, their own, opened from its row', /yearend: 'Close the year'/.test(map) && /'taxes', 'yearend'\]\);/.test(map) && /'mileage', 'yearend'\] \}/.test(map)
  && /case 'yearend': return <RenterYearEnd /.test(src('src/app/rent/[tenantId]/page.tsx')));
check('the renter’s screen: each item opens its screen, the packet’s window opened at the tap, the portal’s weights', /openScreen\(\{ view: i\.view, year: shown\.year \}\)/.test(rcomp) && rcomp.indexOf("window.open('', '_blank')") < rcomp.indexOf("setBusy('print')")
  && !/font-bold|font-black|uppercase|\{\/\*| · /.test(rcomp) && ![...rcomp.matchAll(/>([^<>{}\n]*)</g)].some((m) => m[1].includes("'")));
check('the screens it opens open on that year', /const forYear = React\.useContext\(ScreenYearContext\);\n  React\.useEffect\(\(\) => \{ void load\(forYear \?\? undefined\); \}, \[load, forYear\]\);/.test(src('src/components/rent/RenterWriteOffs.tsx'))
  && /startYear=\{forYear\}/.test(src('src/components/rent/RenterMileage.tsx')) && /void load\(p\.startYear \|\| null\)/.test(src('src/components/money/MileageScreen.tsx'))
  && /setScreenYear\(null\);/.test(src('src/app/rent/[tenantId]/page.tsx')) && /if \(to\.year\) setScreenYear\(to\.year\);/.test(src('src/app/rent/[tenantId]/page.tsx')));
check('the year to close by the business’s day; anything unread read again before printing', /action: 'year', \.\.\.\(asked \? \{ year: asked \} : \{\}\)/.test(rcomp) && /!d\.items\.some\(\(i\) => i\.key\.startsWith\('unread-'\)\)/.test(rcomp));
check('the renter’s earnings said truly, and the desk’s tips not a cost twice', /however the client paid/.test(rhtml) && /already in what you earned above/.test(rhtml) && /Bookings marked done count already, however the client paid/.test(src('src/components/money/TaxSetAside.tsx')));
check('the renter’s write-offs: a read that fails is an error, never a year without rent', !/catch \{ return \[\]; \}/.test(src('src/app/api/portal/renter-writeoffs/route.ts')) && !/tripsOf\(db, tenantId, year, rid\)\.catch/.test(src('src/app/api/portal/renter-writeoffs/route.ts')));
check('each of the renter’s reads that failed is said', /unread: \[\.\.\.\(woY \? \[\] : \['Write-offs'\]\), \.\.\.\(miY \? \[\] : \['The mileage log'\]\), \.\.\.\(txY \? \[\] : \['What you earned and paid'\]\)\]/.test(rcomp));
check('no words from one kind of business', !/[^\w](studio|salon|stylist|booth|chair)[^\w]/i.test(comp + src('src/lib/year-end-packet.ts') + rcomp));

carry.then(() => {
  console.log(F.failures ? `\n${F.failures} failed` : '\nAll passed');
  process.exit(F.failures ? 1 : 0);
});
