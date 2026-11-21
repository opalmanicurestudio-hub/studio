// Checks miles driven, day by day (design board "Sold out on the apps too, and every driver's miles kept"; lib/mileage,
// lib/mileage-server, api/drivers/miles, the staff app's Miles today and the Money page's Miles driven).
// - Each driver types their odometer at the start and end of their day (their own, a driver here); the day's miles are
//   the difference, and a slip (less than the start, or over a thousand miles) is refused.
// - Hot food trips are counted on the driver's day, there and back, and stand in for a day without both readings.
// - A manager sees each driver's month, what's owed at their rate a mile, and the log to download.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/mileage.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'd1', name: 'Sam Lee', isManager: false };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() || {} }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer x' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const L = await import('../../src/lib/mileage');
  console.log('the rules');
  check('an odometer as typed: commas and spaces fine, whole miles; anything else isn’t one', L.cleanOdo('45,210') === 45210 && L.cleanOdo(' 45 210.4') === 45210 && L.cleanOdo('abc') === null && L.cleanOdo('') === null && L.cleanOdo('-5') === null);
  check('a hot food trip there and back: the map’s miles, or from the drive', L.hotTripTenths(3.1, 12) === 62 && L.hotTripTenths(null, 14) === 80 && L.hotTripTenths(undefined, 2) === 10);
  const dd = (x: any) => ({ day: '2026-11-20', driverId: 'd1', driverName: 'Sam Lee', startOdo: null, endOdo: null, hotTrips: 0, hotMilesTenths: 0, ...x });
  check('a day’s miles: the odometer’s difference; without both readings, its hot food trips', L.dayMiles(dd({ startOdo: 100, endOdo: 152, hotTrips: 3, hotMilesTenths: 180 })).miles === 52 && L.dayMiles(dd({ startOdo: 100, hotTrips: 3, hotMilesTenths: 185 })).miles === 18.5
    && L.dayMiles(dd({ startOdo: 100, endOdo: 90 })).from === 'none' && L.dayMiles(dd({ startOdo: 100, endOdo: 2000 })).from === 'none');
  const month = L.monthByDriver([dd({ startOdo: 100, endOdo: 152 }), dd({ day: '2026-11-21', hotTrips: 2, hotMilesTenths: 124 }), dd({ driverId: 'd2', driverName: 'Rio Diaz', startOdo: 10, endOdo: 30 })], 70);
  check('each driver’s month: days, miles, days without both readings, owed at the rate', month[0].driverId === 'd1' && month[0].days === 2 && month[0].miles === 64.4 && month[0].missing === 1 && month[0].owedCents === 4508 && month[1].miles === 20 && month[1].owedCents === 1400, month);
  const csv = L.mileageCsv([dd({ startOdo: 100, endOdo: 152, hotTrips: 1 }), dd({ day: '2026-11-19', driverName: 'Lee, Sam' })]);
  check('the log: a line a driver a day, oldest first, safe for a spreadsheet', csv.split('\n')[0] === 'Day,Driver,Odometer start,Odometer end,Miles,How,Hot food trips,Reading changed' && csv.split('\n')[1].startsWith('2026-11-19,"Lee, Sam"') && /2026-11-20,Sam Lee,100,152,52,Odometer,1,/.test(csv), csv);
  check('the rate as kept: cents a mile, or none', L.rateOf({ mileage: { rateCents: 70 } }) === 70 && L.rateOf({ mileage: { rateCents: 0 } }) === null && L.rateOf({}) === null);

  console.log('the driver’s day');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { deliveryPlan: { on: true, drivers: ['d1'] } } });
  const { POST } = await import('../../src/app/api/drivers/miles/route');
  const P = (b: any) => POST(req({ tenantId: 't1', ...b })) as any;
  let r: any = await P({ action: 'odometer', which: 'start', value: '45,210' });
  const day = new Date().toISOString().slice(0, 10);
  const doc = await get(`${T}/private/mileage_${day}_d1`);
  check('the start of the day, saved on their own day (where only the server reads it)', r.body.ok && doc?.startOdo === 45210 && doc.kind === 'mileage' && doc.month === day.slice(0, 7) && doc.driverName === 'Sam Lee', { body: r.body, doc });
  r = await P({ action: 'odometer', which: 'end', value: '45,100' });
  const r2: any = await P({ action: 'odometer', which: 'end', value: '47,000' });
  check('an end less than the start, or over a thousand miles, is a slip', r.status === 400 && /less than this morning/.test(r.body.error) && r2.status === 400 && /more than 1,000 miles/.test(r2.body.error), [r.body, r2.body]);
  r = await P({ action: 'odometer', which: 'end', value: '45262' });
  check('…the end: 52 miles today', r.body.ok && r.body.day.endOdo === 45262 && L.dayMiles(r.body.day).miles === 52, r.body);
  const S = await import('../../src/lib/mileage-server');
  const out1 = new Date(Date.now() - 3600e3).toISOString(); const out2 = new Date(Date.now() - 1800e3).toISOString();
  await S.logHotTrip(db, 't1', { id: 'd1', name: 'Sam Lee' }, { miles: 3.1, driveMin: 12, outAt: out1, orderId: 'a1' });
  await S.logHotTrip(db, 't1', { id: 'd1', name: 'Sam Lee' }, { miles: 2.0, driveMin: 9, outAt: new Date(Date.parse(out1) + 40 * 1000).toISOString(), orderId: 'a2' });
  await S.logHotTrip(db, 't1', { id: 'd1', name: 'Sam Lee' }, { miles: null, driveMin: 14, outAt: out2, orderId: 'a3' });
  await S.logHotTrip(db, 't1', { id: null, name: 'Cousin Jo' }, { miles: 2 });
  r = await P({ action: 'today' });
  check('hot food trips counted on their day, there and back; two taken out within a couple of minutes are one trip, the farther (one by someone not on the team isn’t)', r.body.ok && r.body.day.hotTrips === 2 && r.body.day.hotMilesTenths === 142 && r.body.day.startOdo === 45210, r.body.day);
  r = await P({ action: 'odometer', which: 'end', value: '45263' });
  const ed = await get(`${T}/private/mileage_${day}_d1`);
  check('a reading typed again is kept with what it was before', r.body.ok && r.body.day.edited === true && ed.edits.length === 1 && ed.edits[0].which === 'end' && ed.edits[0].was === 45262 && ed.endOdo === 45263, ed.edits);
  check('a day whose readings come to far more than its trips is one to check', L.dayToCheck({ day, driverId: 'd1', driverName: 'S', startOdo: 0, endOdo: 80, hotTrips: 2, hotMilesTenths: 142 }) && !L.dayToCheck({ day, driverId: 'd1', driverName: 'S', startOdo: 0, endOdo: 52, hotTrips: 2, hotMilesTenths: 142 }));
  actor = { uid: 'x9', name: 'Kai Park', isManager: false };
  r = await P({ action: 'odometer', which: 'start', value: '10' });
  const r3: any = await P({ action: 'month' });
  check('only the drivers here; the month is the managers’', r.status === 403 && r3.status === 403, [r.body, r3.body]);
  actor = { uid: 'x8', name: 'Tab', isManager: false, screen: true };
  r = await P({ action: 'today' });
  check('never a shared tablet', r.status === 403, r.body);

  console.log('the month, for a manager');
  actor = { uid: 'm1', name: 'Ana Ruiz', isManager: true };
  r = await P({ action: 'rate', cents: 900 });
  const r4: any = await P({ action: 'rate', cents: 70 });
  check('the rate a mile: up to $5, kept with who set it', r.status === 400 && r4.body.ok && (await get(T)).mileage.rateCents === 70 && (await get(T)).mileage.rateBy === 'Ana Ruiz', [r.body, r4.body]);
  r = await P({ action: 'month', month: day.slice(0, 7) });
  check('the month: every driver’s days, and the rate', r.body.ok && r.body.rateCents === 70 && r.body.days.length === 1 && r.body.days[0].startOdo === 45210 && r.body.days[0].endOdo === 45263 && r.body.days[0].hotTrips === 2 && r.body.days[0].edited === true, r.body);
  const r6: any = await P({ action: 'month' });
  check('…this month and last, by the business’s own day', r6.body.month === day.slice(0, 7) && r6.body.months.length === 2 && r6.body.months[0] === day.slice(0, 7), r6.body.months);
  r = await P({ action: 'rate', cents: null });
  check('…cleared: miles only', r.body.ok && (await get(T)).mileage.rateCents === null, r.body);

  console.log('where it shows');
  const card = src('src/components/money/MilesCard.tsx'); const today = src('src/components/staff-portal/MilesToday.tsx'); const tab = src('src/components/staff-portal/DeliveriesTab.tsx'); const money = src('src/app/(app)/money/page.tsx'); const fds = src('src/lib/food-delivery-server.ts');
  check('the driver’s tab: Miles today, the odometer at the start and the end', /<MilesToday tenantId=/.test(tab) && /The odometer when you start/.test(today) && /And when you’re done/.test(today) && /inputMode="numeric"/.test(today));
  check('the Money page: Miles driven, the rate, the log', /<MilesCard tenantId=/.test(money) && /Download the log/.test(card) && /You pay back/.test(card) && /without readings/.test(card));
  check('every hot food trip that ends is counted', /logHotTrip\(db, tenantId/.test(fds));
  check('house style', ![card, today].some((x) => /\buppercase\b|font-black/.test(x)));
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
