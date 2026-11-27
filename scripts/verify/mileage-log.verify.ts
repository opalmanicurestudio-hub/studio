// Checks the business's mileage log (design board "Mileage: logged as you go, with proof"; lib/trip-log,
// lib/trip-log-server, api/mileage, components/money/MileageScreen, the Money page's Write-offs):
//   The IRS rate by year, in tenths of a cent (72.5¢ for 2026), and a year with none says so. Miles in tenths.
//   A drive: started and ended from the phone's two places (a kept place when it's one, the street address otherwise),
//   the miles by road from the map, saved with why; home to the business is commuting, never a write-off, unless home is
//   where the business is run. A trip added after, from kept places or a typed address, the miles from the map or typed.
//   Suggested drives: card purchases made in a store (the bank's place for them, on the day bought, not posted) and
//   events away from the business (made from a quote, with the street address), round trip from the business, logged
//   once with the purchase or event kept as proof; passed over once; a business drive already logged there around that
//   day takes the purchase as its proof, and its history says so. Places typed or sent are the map's, or a kept place
//   when they're at one (home typed out is still home). Edits keep what the trip was; a trip taken out stays, marked.
//   The owner logs (it's their car); others who keep the books see it and download it.
//   The year: business and commuting miles, the amount at the rate, the odometer readings and the other miles; the log
//   as a spreadsheet (no formulas) and printed.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/mileage-log.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures } from './fake-db';
import { rateFor, amountCents, milesText, tenthsOf, cleanPlace, dayOk, isCommute, cleanChoice, yearSummary, cleanReading, logCsv, logBodyHtml, editWords, tripTenths, IRS_RATES, type Trip } from '../../src/lib/trip-log';
import { storePlace } from '../../src/lib/plaid-sync';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const db = makeDb(); let actor: any = { id: 'u1', uid: 'u1', name: 'Jess', isTenantOwner: true, role: 'owner' };
let capAsked = ''; const audits: any[] = [];
const roadCalls: any[] = [];
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/route-guard') return { requireCan: async (_r: any, _t: any, cap: string) => { capAsked = cap; return { actor, tenant: { name: 'North Loft', timezone: 'America/New_York' } }; } };
  if (request === '@/lib/audit') return { logAuditAdmin: async (_d: any, _t: any, e: any) => { audits.push(e); } };
  if (request === '@/lib/here-server') return { bizLocationsOf: async () => [{ id: 'main', name: 'North Loft', address: '201 Elm St, Raleigh, NC 27601', coordinates: { lat: 35.78, lng: -78.64 } }] };
  if (request === '@/lib/geocode-server') return {
    geocode: async (a: string) => (/nowhere/i.test(a) ? null : /oak st/i.test(a) ? { lat: 35.79, lng: -78.66, label: '12 Oak St, Raleigh, NC 27605', postal: '27605', confidence: 'exact' } : { lat: 35.70 + ([...a].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) % 90) / 300, lng: -78.70, label: `${a} (found)`, postal: '', confidence: 'high' }),
    reverseGeocode: async () => ({ lat: 35.8, lng: -78.6, label: '88 Main St, Raleigh, NC 27601', postal: '', confidence: 'exact' }),
    preciseEnough: (g: any) => !!g && g !== 'down' };
  if (request === '@/lib/route-server') return { roadLegs: async (pts: any[]) => { roadCalls.push(pts.length); const n = pts.length; return { road: true, min: pts.map(() => pts.map(() => 5)), miles: pts.map((a: any, i: number) => pts.map((b: any, k: number) => (i === k ? 0 : Math.round((Math.abs(a.lat - b.lat) + Math.abs(a.lng - b.lng)) * 100 * 10) / 10 + 0.04 * n))) }; } };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
const req = (body: any) => ({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => null } }) as any;
const priv = async () => (await db.collection('tenants/t1/private').get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));

(async () => {
  console.log('The rate and the miles');
  check('72.5¢ a mile for 2026, 70¢ for 2025; a year with none uses the latest and says so', rateFor(2026).tenthCents === 725 && rateFor(2026).label === '72.5¢' && rateFor(2025).label === '70¢' && !rateFor(2026).stale
    && rateFor(2027).stale && rateFor(2027).year === Math.max(...Object.keys(IRS_RATES).map(Number)));
  check('1,284 miles at 72.5¢ come to $930.90; 6.4 miles to $4.64', amountCents(12840, 2026) === 93090 && amountCents(64, 2026) === 464);
  check('miles said in tenths, whole once in the thousands', milesText(64) === '6.4' && milesText(12840) === '1,284' && milesText(81) === '8.1' && milesText(40, true) === '4');
  check('typed miles: up to a tenth, 0.1 to 1,000', tenthsOf('6.4') === 64 && tenthsOf('1,000') === 10000 && tenthsOf('0') === null && tenthsOf('6.45') === null && tenthsOf('abc') === null && tenthsOf('1001') === null);
  check('a round trip is twice one way', tripTenths(32, true) === 64 && tripTenths(32, false) === 32);
  check('a place: its name, its place on the map only when real, and a kept place by its ref', cleanPlace({ label: ' 88 Main St ', lat: 35.8, lng: -78.6, ref: 'home' })?.ref === 'home'
    && !('lat' in (cleanPlace({ label: 'x', lat: 0, lng: 0 }) as any)) && cleanPlace({ label: '' }) === null && cleanPlace({ label: 'a<b>', ref: 'evil' })?.ref === null && !/</.test(cleanPlace({ label: 'a<b>' })!.label));
  check('a trip from this year or last, up to today', dayOk('2026-11-27', '2026-11-27') && dayOk('2025-01-02', '2026-11-27') && !dayOk('2024-12-31', '2026-11-27') && !dayOk('2026-11-28', '2026-11-27'));
  const home = { label: 'Home', ref: 'home' }, biz = { label: 'North Loft', ref: 'biz:main' }, store = { label: 'Store' };
  check('home and the business, either way, is commuting, unless home is where the business is run', isCommute(home, biz, {}) && isCommute(biz, home, {}) && !isCommute(home, store, {}) && !isCommute(home, biz, { homeIsMain: true }));
  check('saving asks what it was for (not for commuting)', !cleanChoice({}, '2026-11-27').ok && cleanChoice({ use: 'commute' }, '2026-11-27').ok && (cleanChoice({ purpose: 'bank', roundTrip: true }, '2026-11-27') as any).roundTrip === true);
  check('odometer readings: whole miles', cleanReading('41,208') === 41208 && cleanReading('') === null && cleanReading('4.5') === undefined);

  console.log('A drive');
  await db.doc('tenants/t1').set({ name: 'North Loft', timezone: 'America/New_York' });
  const POST: (r: any) => Promise<any> = (await import('../../src/app/api/mileage/route')).POST as any;
  let r: any = await POST(req({ action: 'start' }));
  check('no place from the phone: nothing starts, and it says to turn on location or add it after', r.status === 400 && /location/.test(r.body.error));
  r = await POST(req({ action: 'start', lat: 35.7801, lng: -78.6401 }));
  check('started at the business: named as the business (a parking lot away)', r.status === 200 && r.body.from.ref === 'biz:main' && /North Loft/.test(r.body.from.label) && capAsked === 'money.manage', r.body);
  const again: any = await POST(req({ action: 'start', lat: 35.9, lng: -78.9 }));
  check('starting again while one’s under way: the same drive', again.body.startedAt === r.body.startedAt);
  r = await POST(req({ action: 'save', purpose: 'supplies' }));
  check('can’t save before it ends', r.status === 409);
  r = await POST(req({ action: 'end', lat: 35.8, lng: -78.6 }));
  check('ended elsewhere: its street address from the map, the miles by road', r.status === 200 && r.body.to.label === '88 Main St, Raleigh, NC 27601' && r.body.oneWayTenths > 0 && r.body.road === true && r.body.commute === false, r.body);
  const oneWay = r.body.oneWayTenths;
  r = await POST(req({ action: 'save', purpose: 'supplies', note: 'Restock gel polish', roundTrip: true }));
  const t1: Trip = r.body.trip;
  check('saved: the day, both places, why, the miles both ways, both times, who, and how the miles were found', r.status === 200 && t1.how === 'drive' && t1.purpose === 'supplies' && t1.tenths === oneWay * 2 && t1.roundTrip && !!t1.started && !!t1.ended
    && t1.by.name === 'Jess' && /^\d{4}-\d{2}-\d{2}$/.test(t1.day) && t1.use === 'business' && t1.note === 'Restock gel polish', t1);
  check('the drive under way is gone once saved, and its raw places were never kept', !(await priv()).some((d: any) => d.id.startsWith('drive_')));
  r = await POST(req({ action: 'save', purpose: 'supplies' }));
  check('a second tap on save: refused, not a second trip', r.status === 409 && (await priv()).filter((d: any) => d.kind === 'trip').length === 1);
  await POST(req({ action: 'start', lat: 35.7801, lng: -78.6401 })); await POST(req({ action: 'end', lat: 35.9, lng: -78.9 }));
  const dv: any = (await priv()).find((d: any) => d.id.startsWith('drive_'));
  check('an ended drive keeps no raw phone places', dv && !('startPoint' in dv) && !('endPoint' in dv));
  await db.doc(`tenants/t1/private/${dv.id}`).set({ startedAt: new Date(Date.now() - 20 * 3600e3).toISOString() }, { merge: true });
  r = await POST(req({ action: 'list' }));
  check('ended but not saved: kept until saved or dropped, however long ago it started', !!r.body.drive?.ended);
  r = await POST(req({ action: 'start', lat: 35.7801, lng: -78.6401 }));
  check('a new drive waits for that one', r.status === 409 && /Save or drop/.test(r.body.error));
  await POST(req({ action: 'cancel' }));

  console.log('Home, commuting and trips added after');
  r = await POST(req({ action: 'setup', home: { label: '12 Oak St, Raleigh' } }));
  r = await POST(req({ action: 'list' }));
  check('setting home is in the activity, without the address', audits.some((e) => /Mileage log: set home/.test(e.summary) && !/Oak/.test(e.summary)));
  check('home kept, looked up on the map, among the places', r.body.setup.home.label === '12 Oak St, Raleigh, NC 27605' && r.body.places.some((p: any) => p.ref === 'home' && p.lat === 35.79) && r.body.origin.ref === 'biz:main');
  r = await POST(req({ action: 'add', from: { ref: 'home' }, to: { ref: 'biz:main' }, day: '2026-11-20', purpose: 'supplies' }));
  check('home to the business: kept as commuting, whatever was picked', r.status === 200 && r.body.trip.use === 'commute' && r.body.trip.how === 'map');
  r = await POST(req({ action: 'miles', from: { label: 'Home' }, to: { ref: 'biz:main' } }));
  check('“home” typed is home', r.body.from?.ref === 'home' && r.body.commute === true);
  r = await POST(req({ action: 'add', from: { label: '12 Oak St, Raleigh, NC' }, to: { ref: 'biz:main' }, day: '2026-11-20', purpose: 'supplies' }));
  check('home typed out is still home: commuting', r.status === 200 && r.body.trip.use === 'commute' && r.body.trip.from.ref === 'home', r.body.trip?.from);
  r = await POST(req({ action: 'add', from: { ref: 'evil' }, to: { label: 'Office Depot, 1 Main St', lat: 40.7, lng: -74 }, day: '2026-11-20', purpose: 'supplies' }));
  check('a place on the map sent by the page isn’t taken: its address is looked up, an unknown ref is dropped', r.status === 400 || (r.body.trip.to.lat !== 40.7 && r.body.trip.from.ref == null));
  r = await POST(req({ action: 'add', from: { ref: 'biz:main' }, to: { label: '400 Hill Rd, Cary, NC' }, miles: '11.2', day: '2026-11-12', purpose: 'event', roundTrip: true }));
  check('an address typed and miles typed: kept as typed', r.status === 200 && r.body.trip.how === 'typed' && r.body.trip.tenths === 224 && /400 Hill Rd/.test(r.body.trip.to.label));
  r = await POST(req({ action: 'add', from: { ref: 'biz:main' }, to: { label: 'Nowhere Lane' }, day: '2026-11-21', purpose: 'event' }));
  check('a place not on the map with no miles typed: asks for the miles', r.status === 400 && /Type the miles/.test(r.body.error));
  r = await POST(req({ action: 'add', from: { ref: 'biz:main' }, to: { label: '9 Pine St' }, day: '2026-12-25', purpose: 'bank' }));
  check('a day to come is refused', r.status === 400);
  r = await POST(req({ action: 'miles', from: { ref: 'biz:main' }, to: { ref: 'home' } }));
  check('miles before adding: by road, and whether it’s commuting', r.status === 200 && r.body.oneWayTenths > 0 && r.body.commute === true);
  await POST(req({ action: 'setup', homeIsMain: true }));
  r = await POST(req({ action: 'miles', from: { ref: 'home' }, to: { ref: 'biz:main' } }));
  check('home is where the business is run: no commuting', r.body.commute === false);
  await POST(req({ action: 'setup', homeIsMain: false }));

  console.log('Suggested drives');
  await db.doc('tenants/t1/bankTransactions/b1').set({ direction: 'out', context: 'Business', date: '2026-11-24', merchant: 'Beauty Supply', amountCents: 6420, place: { address: '50 Market St, Raleigh', lat: 35.82, lng: -78.61 } });
  await db.doc('tenants/t1/bankTransactions/b2').set({ direction: 'out', context: 'Personal', date: '2026-11-24', merchant: 'Groceries', amountCents: 9000, place: { lat: 35.83, lng: -78.62 } });
  await db.doc('tenants/t1/bankTransactions/b3').set({ direction: 'out', context: 'Business', date: '2026-11-24', merchant: 'Software', amountCents: 2000 });
  await db.doc('tenants/t1/bankTransactions/b4').set({ direction: 'out', context: 'Business', date: '2026-11-24', merchant: 'Coffee next door', amountCents: 500, place: { lat: 35.7801, lng: -78.6401 } });
  // (Posted two days after it was bought, the day of the drive.)
  const posted = new Date(Date.parse(`${t1.day}T12:00:00Z`) + 2 * 86400e3).toISOString().slice(0, 10);
  await db.doc('tenants/t1/bankTransactions/b5').set({ direction: 'out', context: 'Business', date: posted, boughtOn: t1.day, merchant: 'Beauty Supply Main', amountCents: 14218, place: { lat: 35.8, lng: -78.6 } });
  await db.doc('tenants/t1/bankTransactions/b6').set({ direction: 'out', context: 'Business', date: '2026-11-18', boughtOn: '2026-11-16', merchant: 'Bank\tbranch', amountCents: 300, place: { lat: 35.75, lng: -78.70 } });
  await db.doc('tenants/t1/studioEvents/e1').set({ title: 'Bridal party', date: '2026-11-22', venue: 'The Glass House', address: { street: '400 Hill Rd', city: 'Cary', state: 'NC', zip: '27511' }, status: 'upcoming' });
  await db.doc('tenants/t1/studioEvents/e2').set({ title: 'Next month', date: '2026-12-20', address: { street: '1 Far Rd', city: 'Cary', state: 'NC' } });
  await db.doc('tenants/t1/studioEvents/e3').set({ title: 'In the shop', date: '2026-11-20', venue: 'Here' });
  r = await POST(req({ action: 'list' }));
  const ids = r.body.suggestions.map((s: any) => s.id);
  check('a business card purchase made in a store and an event away (from a quote) are suggested; personal, online, next door, future and address-less ones aren’t', ids.includes('card_b1') && ids.includes('event_e1') && !ids.includes('card_b2') && !ids.includes('card_b3') && !ids.includes('card_b4') && !ids.includes('event_e2') && !ids.includes('event_e3'), ids);
  const b6 = r.body.suggestions.find((x: any) => x.id === 'card_b6');
  check('a purchase is suggested on the day it was bought, not the day it posted', b6?.day === '2026-11-16' && !/\t/.test(b6.title), b6);
  const proven = r.body.trips.find((t: any) => t.id === t1.id);
  check('a drive logged there the day it was bought (posted two days later) takes the purchase as its proof, said in its history, and it isn’t suggested again', proven?.proof?.kind === 'card' && proven.proof.id === 'b5' && /\$142\.18/.test(proven.proof.label) && !ids.includes('card_b5')
    && proven.edits.some((e: any) => /proof added/.test(e.was)), proven?.proof);
  const commuteTrip = r.body.trips.find((t: any) => t.use === 'commute');
  check('a commute never takes a purchase as proof', commuteTrip && !commuteTrip.proof);
  check('one map request for all the suggestions', roadCalls.some((n) => n >= 3));
  r = await POST(req({ action: 'suggested', id: 'card_b1' }));
  check('logged: round trip from the business, on the purchase’s day, with the purchase as proof', r.status === 200 && r.body.trip.roundTrip && r.body.trip.from.ref === 'biz:main' && r.body.trip.day === '2026-11-24' && r.body.trip.proof.id === 'b1' && r.body.trip.purpose === 'supplies');
  r = await POST(req({ action: 'suggested', id: 'card_b1' }));
  check('the same one again (a second tap): already logged, one trip', r.status === 409 && (await priv()).filter((d: any) => d.kind === 'trip' && d.proof?.id === 'b1').length === 1);
  r = await POST(req({ action: 'suggested', id: 'card_b2' }));
  check('one never suggested can’t be logged as one', r.status === 409);
  // (Posted with no day bought: a trip the day after it posted can't be the drive to buy it.)
  await POST(req({ action: 'add', from: { ref: 'biz:main' }, to: { label: '77 Late St' }, miles: '2', day: '2026-11-09', purpose: 'supplies' }));
  const late: any = (await priv()).find((d: any) => d.to?.label === '77 Late St (found)');
  await db.doc('tenants/t1/bankTransactions/b7').set({ direction: 'out', context: 'Business', date: '2026-11-08', merchant: 'Late Store', amountCents: 900, place: { lat: late.to.lat, lng: late.to.lng } });
  r = await POST(req({ action: 'list' }));
  check('a purchase with only its posted day: never the proof of a trip after that day', !!late && !r.body.trips.find((t: any) => t.id === late.id)?.proof);
  await POST(req({ action: 'remove', id: 's_card_b1' })); r = await POST(req({ action: 'suggested', id: 'card_b1' }));
  check('a suggested trip taken out and logged again: the same trip, back, its history saying so', r.status === 200 && r.body.trip.id === 's_card_b1' && !r.body.trip.removed && /logged again/.test(r.body.trip.edits.at(-1).was), r.body);
  await POST(req({ action: 'dismiss', id: 'event_e1' }));
  r = await POST(req({ action: 'list' }));
  check('passed over: not suggested again', !r.body.suggestions.some((s: any) => s.id === 'event_e1'));

  console.log('Changes, the year and the log');
  r = await POST(req({ action: 'edit', id: t1.id, miles: '3.5', purpose: 'post' }));
  check('an edit keeps what the trip was, and typed miles say so', r.status === 200 && r.body.trip.tenths === 70 && r.body.trip.how === 'typed' && /miles .* → 7\.0/.test(r.body.trip.edits.at(-1).was) && /Supplies → Post office/.test(r.body.trip.edits.at(-1).was), r.body.trip?.edits);
  r = await POST(req({ action: 'remove', id: t1.id }));
  const kept: any = (await db.doc(`tenants/t1/private/trip_${t1.id}`).get()).data();
  const after: any = await POST(req({ action: 'list' }));
  check('taken out: still kept, marked, and gone from the year', r.status === 200 && kept?.removed?.by === 'Jess' && !after.body.trips.some((t: any) => t.id === t1.id));
  r = await POST(req({ action: 'setup', year: 2026, start: '41208', end: '40000' }));
  check('December 31’s reading can’t be lower than January 1’s', r.status === 400);
  await POST(req({ action: 'setup', year: 2026, start: '41208' })); await POST(req({ action: 'setup', year: 2026, end: '53108' }));
  const today = (await POST(req({ action: 'list' }))).body.today;
  await POST(req({ action: 'add', from: { ref: 'biz:main' }, to: { label: '9 Pine St, Raleigh' }, day: today, purpose: 'bank' }));
  r = await POST(req({ action: 'list', year: 2026 }));
  const s = r.body.summary;
  check('the year: business and commuting miles, the amount, the readings, all miles and the other miles', s.odometer.start === 41208 && s.odometer.end === 53108 && s.totalTenths === 119000 && s.otherTenths === s.totalTenths - s.businessTenths - s.commuteTenths && s.amountCents === amountCents(s.businessTenths, 2026) && s.commuteTenths > 0, s);
  r = await POST(req({ action: 'export', year: 2026 }));
  check('the spreadsheet: a row a trip, business or commuting, and where the miles came from; downloading it is in the activity', /^Date,From,To,Business or commuting/.test(r.body.csv) && /Commuting/.test(r.body.csv) && /Typed/.test(r.body.csv) && /Card purchase, Beauty Supply/.test(r.body.csv)
    && audits.some((e) => /Downloaded the 2026 mileage log/.test(e.summary)));
  check('how many were logged the day of the drive', s.sameDay >= 1 && s.sameDay <= s.trips);
  const evil: Trip = { kind: 'trip', id: 'e', year: 2026, day: '2026-01-02', use: 'business', purpose: 'other', note: '=HYPERLINK("x")', from: { label: '<b>x</b>' }, to: { label: '+1' }, oneWayTenths: 10, roundTrip: false, tenths: 10, how: 'map', road: true, by: { id: 'u', name: 'J' }, at: '2026-01-02T00:00:00Z' };
  check('no formulas in the spreadsheet (a tab or return first too), nothing unescaped in print', /"'=HYPERLINK/.test(logCsv([evil], 2026)) && /"'\+1"/.test(logCsv([evil], 2026)) && /"'\tx"/.test(logCsv([{ ...evil, note: '\tx' }], 2026)) && /"'\rx"/.test(logCsv([{ ...evil, note: '\rx' }], 2026))
    && !/<b>x<\/b>/.test(logBodyHtml([evil], 2026)) && /&lt;b&gt;/.test(logBodyHtml([evil], 2026)));
  check('the year from trips alone', yearSummary([evil, { ...evil, id: 'c', use: 'commute', tenths: 30 }, { ...evil, id: 'r', removed: { at: 'x', by: 'J' } }], 2026).businessTenths === 10 && yearSummary([evil], 2026).commuteTenths === 0);
  check('an edit says what changed', editWords(evil, { tenths: 20 }) === 'miles 1.0 → 2.0' && editWords(evil, {}) === '');

  console.log('Who logs');
  actor = { id: 'u2', uid: 'u2', name: 'Bookkeeper', role: 'manager', caps: ['money.manage'] };
  r = await POST(req({ action: 'list' }));
  check('someone else who keeps the books sees the log and downloads it, but doesn’t log, change or start drives', r.status === 200 && r.body.owner === false && r.body.drive === null
    && (await POST(req({ action: 'export', year: 2026 }))).status === 200 && (await POST(req({ action: 'start', lat: 35.78, lng: -78.64 }))).status === 403
    && (await POST(req({ action: 'add', from: { ref: 'biz:main' }, to: { ref: 'home' }, purpose: 'bank' }))).status === 403 && (await POST(req({ action: 'setup', homeIsMain: true }))).status === 403);
  actor = { id: 'u1', uid: 'u1', name: 'Jess', isTenantOwner: true, role: 'owner' };

  console.log('Where a store purchase was made');
  check('the bank line keeps the day it was bought too', /boughtOn: \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(String\(bt\.authorized_date/.test(src('src/lib/plaid-sync.ts')));
  check('in a store, with a place: kept; online or without one: not', storePlace({ payment_channel: 'in store', amount: 12, location: { address: '50 Market St', city: 'Raleigh', region: 'NC', postal_code: '27601', lat: 35.8, lon: -78.6 } })?.address === '50 Market St, Raleigh, NC 27601'
    && storePlace({ payment_channel: 'online', amount: 12, location: { lat: 35.8, lon: -78.6 } }) === null && storePlace({ payment_channel: 'in store', amount: 12, location: { lat: null, lon: null } }) === null && storePlace({ payment_channel: 'in store', amount: -5, location: { lat: 35.8, lon: -78.6 } }) === null);
  check('the bank line keeps it', /\.\.\.\(storePlace\(bt\) \? \{ place: storePlace\(bt\), boughtOn:/.test(src('src/lib/plaid-sync.ts')));

  console.log('Where it is in the app');
  check('Mileage in the menu’s Money section, its module and the sidebar (managers who keep the books too)', /pages: \['\/money', '\/mileage'/.test(src('src/lib/nav.ts')) && /'\/money', '\/mileage'\]/.test(src('src/lib/modules.ts'))
    && /href: '\/mileage',\s+icon: Car/.test(src('src/components/shared/AppSidebar.tsx')) && /can\('money\.manage'\) \? \[\{ href: '\/mileage'/.test(src('src/components/shared/AppSidebar.tsx')));
  const page = src('src/app/(app)/money/page.tsx');
  check('Money has a Write-offs tab, between Bills and Reports, with business miles', /\{ key: 'bills',\s+label: 'Bills' \},\n  \{ key: 'writeoffs', label: 'Write-offs' \},\n  \{ key: 'reports'/.test(page) && /<WriteOffsScreen tenantId=\{tenantId\} canLog=\{can\('money\.manage'\)\} business=/.test(page));
  const screen = src('src/components/money/MileageScreen.tsx');
  check('someone who only sees the log gets the odometer read-only and each trip’s details without changing it', /readOnly=\{d\.owner === false\}/.test(screen) && /open === t\.id && d\.owner === false && <p/.test(screen));
  check('the phone gives its place once, never followed', /getCurrentPosition/.test(src('src/app/(app)/mileage/page.tsx')) && !/watchPosition/.test(src('src/app/(app)/mileage/page.tsx') + screen));
  check('the screen says how a drive works and what makes the log hold up', /The miles come from the map between where you started and where you ended/.test(screen) && /what a mileage log needs to show/.test(screen) && /Drives between home and work aren’t counted: that’s commuting/.test(screen));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
