// Checks ordering ahead inside opening hours, and ordering to take home from the guest pass (design canvas: Ordering
// ahead inside opening hours): lib/ahead-hours, lib/counter-ahead pickupTimes, aheadMenu and placeAhead, api/table-pay,
// and the order-ahead page and the guest pass.
// - Times only while open: from opening (or twenty minutes from now) to closing; "as soon as it's ready" only while open
//   with twenty minutes left. Hours past midnight count to the next morning. No hours set: no limit, as before.
// - Closed for the day: nothing to pick, paying refused, and when it opens next. A page left open can't place an order
//   for when it's closed.
// - The guest pass offers ordering to take home while orders placed ahead can be picked up inside.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ahead-hours.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_fake'; process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake'; process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
const T = 'tenants/t1'; const TZ = 'America/New_York';
const src = (p: string) => fs.readFileSync(p, 'utf8');
// Monday, November 16 2026 in New York (UTC-5): a wall-clock time there, as ms.
const at = (day: number, h: number, m = 0) => Date.UTC(2026, 10, 16 + day, h + 5, m);
const local = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const realNow = Date.now;

(async () => {
  const H = await import('../../src/lib/ahead-hours');
  const A = await import('../../src/lib/counter-ahead');
  const day = (start: string, end: string) => ({ enabled: true, start, end });
  const week = { monday: day('7:00 AM', '9:00 PM'), tuesday: day('07:00 AM', '09:00 PM'), wednesday: day('7:00 AM', '9:00 PM'), thursday: day('7:00 AM', '9:00 PM'),
    friday: day('5:00 PM', '2:00 AM'), saturday: { enabled: false, start: '9:00 AM', end: '5:00 PM' }, sunday: { enabled: false } };

  console.log('reading the hours');
  check('clock times as the settings write them: 9:00 AM, 09:00 PM, 17:30, 9, 12:00 AM; nonsense is none', H.clockMinutes('9:00 AM') === 540 && H.clockMinutes('09:00 PM') === 1260 && H.clockMinutes('17:30') === 1050
    && H.clockMinutes('9') === 540 && H.clockMinutes('12:00 AM') === 0 && H.clockMinutes('12:30 PM') === 750 && H.clockMinutes('13:00 PM') === null && H.clockMinutes('soon') === null && H.clockMinutes(null) === null);
  check('the house hours: the active schedule’s week, as the booking pages read it; none active, none (no limit)', H.houseWeek([{ week: { monday: 1 } }, { isActive: true, week: week }]) === week && H.houseWeek([{ week }]) === null && H.houseWeek([]) === null && H.houseWeek([{ name: 'x', isActive: true }]) === null);

  console.log('times inside the hours');
  const tenant = { timezone: TZ, orderAhead: { on: true, laterHours: 3 } };
  let now = at(0, 6, 40); let h = H.hoursNow(week, TZ, now);
  let times = A.pickupTimes(tenant, now, 0, h);
  check('before opening (6:40, opens 7:00): no “as soon as it’s ready”; times from 7:00', h.set && !!h.today && !A.asapNow(h, now) && local(Date.parse(times[0])) === '7:00 AM' && times.every((t) => Date.parse(t) >= at(0, 7)), times.map((t) => local(Date.parse(t))));
  now = at(0, 12); h = H.hoursNow(week, TZ, now);
  check('open (noon): as soon as it’s ready, and times as before', A.asapNow(h, now) && A.pickupTimes(tenant, now, 0, h).length === A.pickupTimes(tenant, now).length);
  now = at(0, 20, 20); h = H.hoursNow(week, TZ, now); times = A.pickupTimes(tenant, now, 0, h);
  check('near closing (8:20, closes 9:00): the last time is closing; as soon as it’s ready while there’s twenty minutes', times.map((t) => local(Date.parse(t))).join(',') === '8:45 PM,9:00 PM' && A.asapNow(h, now) && A.asapNow(h, at(0, 20, 40)) && !A.asapNow(h, at(0, 20, 45)), times);
  now = at(0, 21, 30); h = H.hoursNow(week, TZ, now);
  check('closed for the day (9:30): nothing to pick, and it opens next tomorrow at 7:00', h.set && !h.today && !A.asapNow(h, now) && A.pickupTimes(tenant, now, 0, h).length === 0 && h.next === at(1, 7), h);
  now = at(5, 1); h = H.hoursNow(week, TZ, now);
  check('hours past midnight (Friday 5 PM to 2 AM, now Saturday 1:00 AM): still open, times to 2:00', !!h.set && !!h.today && A.asapNow(h, now) && A.pickupTimes(tenant, now, 0, h).every((t) => Date.parse(t) <= at(5, 2)) && A.pickupTimes(tenant, now, 0, h).length > 0
    && !A.asapNow(h, at(5, 1, 50)), h);
  now = at(5, 12); h = H.hoursNow(week, TZ, now);
  check('a day it’s closed (Saturday noon): closed, opening next Monday at 7:00', h.set && !h.today && h.next === at(7, 7), h);
  const spring = { sunday: day('7:00 AM', '9:00 PM') };
  h = H.hoursNow(spring, TZ, Date.UTC(2026, 2, 8, 10, 40));
  check('the morning the clocks go forward (Sunday March 8, 6:40 AM): opens 7:00 local, 11:00 in UTC', h.set && !!h.today && h.today.open === Date.UTC(2026, 2, 8, 11) && h.today.close === Date.UTC(2026, 2, 9, 1), h);
  h = H.hoursNow(null, TZ, now);
  check('no hours set: no limit, as before', !h.set && A.asapNow(h, now) && A.pickupTimes(tenant, now, 0, h).length === A.pickupTimes(tenant, now).length);

  console.log('the page and placing');
  await db.doc(T).set({ name: 'Northside', timezone: TZ, stripeAccountId: 'acct_1', stripeChargesEnabled: true, orderAhead: { on: true, laterHours: 3 } });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 50 });
  await db.doc(`${T}/scheduleProfiles/p1`).set({ isActive: true, week });
  Date.now = () => at(0, 6, 40);
  let m: any = await A.aheadMenu(db, 't1', await (await db.doc(T).get()).data());
  check('the page before opening: no “as soon as it’s ready”, when it opens, times from then, closing time', m.asap === false && m.opens === new Date(at(0, 7)).toISOString() && m.closes === new Date(at(0, 21)).toISOString() && !m.closedNow && m.times.length > 0 && m.nextOpen === null, m);
  const base = { key: 'keykeykey-hours-1', name: 'Jordan', way: 'inside', lines: [{ itemId: 'burger', quantity: 1 }] };
  const stripe = { paymentIntents: { create: async () => ({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method' }) } };
  const td = async () => (await db.doc(T).get()).data();
  let placed: any = await A.placeAhead(db, 't1', await td(), { ...base, key: 'keykeykey-hours-2' }, { stripe, now: at(0, 20) });
  const replay: any = await A.placeAhead(db, 't1', await td(), { ...base, key: 'keykeykey-hours-2' }, { stripe, now: at(0, 21, 30) });
  check('placed while open, its answer lost, asked again after closing: the same order, not refused', placed.ok && replay.ok && replay.orderId === placed.orderId, [placed, replay]);
  let r: any = await A.placeAhead(db, 't1', await (await db.doc(T).get()).data(), base, { stripe: {}, now: at(0, 6, 40) });
  check('…“as soon as it’s ready” sent anyway (an old page): refused, pick a time', r.code === 'asap_closed' && r.status === 409, r);
  r = await A.placeAhead(db, 't1', await (await db.doc(T).get()).data(), { ...base, at: new Date(at(0, 6, 45)).toISOString() }, { stripe: {}, now: at(0, 6, 25) });
  check('…a time before opening: refused', r.code === 'at', r);
  Date.now = () => at(0, 21, 30);
  m = await A.aheadMenu(db, 't1', await (await db.doc(T).get()).data());
  check('the page after closing: closed right now, nothing to pick, opening tomorrow at 7:00', m.closedNow === true && !m.lateToday && m.asap === false && m.times.length === 0 && m.nextOpen === new Date(at(1, 7)).toISOString(), m);
  r = await A.placeAhead(db, 't1', await (await db.doc(T).get()).data(), base, { stripe: {}, now: at(0, 21, 30) });
  check('…placing anyway: refused, closed right now', r.code === 'closed_now' && r.status === 409, r);
  Date.now = () => at(0, 20, 45);
  m = await A.aheadMenu(db, 't1', await td());
  check('open, but too near closing for anything to be ready (8:45, closes 9:00): too late today, not “closed”', m.closedNow === true && m.lateToday === true && m.nextOpen === new Date(at(1, 7)).toISOString(), m);
  Date.now = realNow;

  console.log('the screens');
  const page = src('src/app/order/[tenantId]/page.tsx');
  check('the order page: as soon as it’s ready only when offered; when it opens; last pickup; closed right now, with when it opens next; paying off while closed',
    /\{menu\.asap !== false && <TimeButton label="As soon as it’s ready"/.test(page) && /We open \{opensWords\(menu\.opens, menu\.timeZone\)\}\. Pick a time from then\./.test(page) && /Last pickup \{clock\(menu\.times\[menu\.times\.length - 1\], menu\.timeZone\)\}\./.test(page)
    && /We open again \$\{opensWords\(menu\.nextOpen, menu\.timeZone\)\}/.test(page) && /menu\.lateToday \? 'Too late for pickup today' : 'Closed right now'/.test(page)
    && /const waiting = !!menu && !track && \(!!menu\.closedNow \|\| !!menu\.opens\);/.test(page) && /const i = setInterval\(again, 60000\)/.test(page) && /disabled=\{placing \|\| !cart\.length \|\| chosenFull \|\| closedNow\}/.test(page) && /return `tomorrow \$\{at\}`;/.test(page));
  check('…starts on the first time when as soon as it’s ready isn’t offered; opened from the guest pass, inside is picked', /const startAt = \(m: Menu\) => \(m\.asapFull \|\| m\.asap === false \? firstOpen\(m\) : ''\);/.test(page) && /wantWay && \(d\.ways \|\| \[\]\)\.includes\(wantWay\)/.test(page));
  const tp = src('src/app/api/table-pay/route.ts'); const bill = src('src/app/bill/[tenantId]/[token]/page.tsx');
  check('the guest pass: “Taking something home?” while orders placed ahead are picked up inside, payments are connected, and there’s a time today', /if \(A\.on && A\.ways\.includes\('inside'\) && !!accountOf\(tenant\)\) \{/.test(tp) && /if \(asapNow\(hrs\) \|\| pickupTimes\(tenant, Date\.now\(\), 0, hrs\)\.length\) takeHome = `\/order\/\$\{encodeURIComponent\(tenantId\)\}\?way=inside`;/.test(tp)
    && /Pick it up inside when it’s ready\./.test(bill)
    && /\{pass\.takeHome && \(/.test(bill) && /Taking something home\?/.test(bill) && /Order to take home/.test(bill));
  check('in the app’s own words', !/font-black|\buppercase\b|call us|contact us/i.test(src('src/lib/ahead-hours.ts') + page.slice(page.indexOf('const startAt'), page.indexOf('const startAt') + 900)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
