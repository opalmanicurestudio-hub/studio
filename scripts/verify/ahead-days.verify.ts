// Checks orders for another day (design board "Orders for another day"; lib/ahead-days, lib/ahead-days-server,
// lib/counter-ahead, api/menu 'ahead', api/counter/ahead 'place' / 'cancel', api/counter 'lane' / 'laterSend' /
// 'laterCancel', the payments cron).
// - Settings, a manager's: on, how far ahead (3, 7, 14 or 30 days), the notice (12, 24, 48 or 72 hours), the smallest order.
// - The guest picks a day and a time it's open, from the notice on, inside, curbside or delivered (never the drive-thru),
//   with a phone number and how many people; paid when placed, in the books that day; its code and number are its day's.
// - It waits (no tickets) until a couple of hours before its time, then goes to the kitchen screen under Later until it's
//   time to start (its slowest item, more for a big order). Something that can't be made then keeps it, and the managers
//   are told once; once fixed it goes by itself, or the counter sends it.
// - Canceled for a full refund: by the guest until the notice runs out, by a manager until it goes; each line once, a
//   refund that stops partway finished by asking again; the code freed; the guest texted when the business cancels.
// - The counter's Coming up; the night report; a delivery for another day isn't from an earlier night on its day.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ahead-days.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+18325550100';
const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const texts: { to: string; body: string }[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).includes('twilio')) { const p = new URLSearchParams(String(init?.body || '')); texts.push({ to: String(p.get('To')), body: String(p.get('Body')) }); }
  return { ok: true, status: 201, json: async () => ({ sid: `SM${texts.length}` }) };
};
const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), n: 0, refunds: [] as any[], refundKeys: new Map<string, any>(), failIn: 0 };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, status: 'requires_payment_method', metadata: { ...p.metadata }, amount_received: 0, client_secret: `${id}_secret`, account: o?.stripeAccount };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(pi);
    },
    retrieve: async (id: string) => clone(S.pis.get(id)),
    cancel: async (id: string) => { const pi = S.pis.get(id); pi.status = 'canceled'; return clone(pi); },
  };
  refunds = { create: async (p: any, o: any) => {
    if (o?.idempotencyKey && S.refundKeys.has(o.idempotencyKey)) return S.refundKeys.get(o.idempotencyKey);
    if (S.failIn > 0 && --S.failIn === 0) throw Object.assign(new Error('The card company said no.'), { type: 'StripeInvalidRequestError' });
    const r = { id: `re_${S.refunds.length + 1}`, status: 'succeeded', amount: p.amount, payment_intent: p.payment_intent }; S.refunds.push(r); if (o?.idempotencyKey) S.refundKeys.set(o.idempotencyKey, r); return r;
  }, list: async () => ({ data: [] }) };
}
const paid = (piId: string) => { const pi = S.pis.get(piId); pi.status = 'succeeded'; pi.amount_received = pi.amount; };

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() || {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/geocode-server' || /\/src\/lib\/geocode-server(\.ts)?$/.test(request)) {
    const real = load.call(this, request, ...rest);
    return fake(request, { ...real, hasMapsKey: () => true, geocode: async () => ({ lat: 39.95, lng: -75.0, label: '9 Harbor Ct', postal: '08077', confidence: 'exact' }) });
  }
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const PLAN = { on: true, by: 'postal', zones: [{ id: 'near', name: 'Near', postalCodes: ['08077'], feeCents: 399, minimumCents: 1000 }], days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '08:00', end: '22:00' }] };
const H = 3600000;

(async () => {
  const D = await import('../../src/lib/ahead-days');
  const RD = await import('../../src/lib/ahead-days-server');
  const SL = await import('../../src/lib/ahead-slots');
  const FS = await import('../../src/lib/food-delivery-server');
  const NC = await import('../../src/lib/night-close-server');
  const { addDays } = await import('../../src/lib/tenant-time');
  const { POST: AHEAD } = await import('../../src/app/api/counter/ahead/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');

  console.log('the rules');
  const d0 = D.anotherDayOf({}); const dBad = D.anotherDayOf({ orderAhead: { anotherDay: { on: true, daysAhead: 5, noticeHours: 6, minCents: -3 } } });
  check('off until turned on, a week ahead and a day’s notice; anything not a choice falls back', !d0.on && d0.daysAhead === 7 && d0.noticeHours === 24 && d0.minCents === null && dBad.on && dBad.daysAhead === 7 && dBad.noticeHours === 24 && dBad.minCents === null, { d0, dBad });
  check('the smallest order as typed: dollars to cents, empty or $0 for any size, anything else isn’t one', D.cleanMinOrder('$50') === 5000 && D.cleanMinOrder('12.5') === 1250 && D.cleanMinOrder('') === null && D.cleanMinOrder('0') === null && D.cleanMinOrder('abc') === undefined && D.cleanMinOrder('6000') === undefined);
  check('how many people: 1 to 500, or not said', D.cleanPeople('') === null && D.cleanPeople('20') === 20 && D.cleanPeople(0) === undefined && D.cleanPeople(501) === undefined && D.cleanPeople(2.5) === undefined);
  const a24 = { on: true, daysAhead: 7, noticeHours: 24, minCents: null };
  const nowMon = Date.parse('2026-11-16T10:00:00.000Z');
  const t0 = D.dayTimes(a24, null, 'Etc/UTC', '2026-11-19', nowMon);
  check('no hours set: every half hour from 9:30 AM to 8:30 PM', t0.length === 23 && t0[0] === '2026-11-19T09:30:00.000Z' && t0[22] === '2026-11-19T20:30:00.000Z', t0);
  const tN = D.dayTimes(a24, null, 'Etc/UTC', '2026-11-17', nowMon);
  check('…none sooner than the notice from now', tN[0] === '2026-11-17T10:00:00.000Z' && tN.length === 22, tN.slice(0, 2));
  const week = { monday: { enabled: true, start: '11:00 AM', end: '2:00 PM' }, tuesday: { enabled: false, start: '9:00 AM', end: '5:00 PM' } };
  const tw = D.dayTimes(a24, week, 'Etc/UTC', '2026-11-23', nowMon);
  check('opening hours set: half an hour after opening to half an hour before closing; a closed day has none', tw.join() === ['11:30', '12:00', '12:30', '13:00', '13:30'].map((x) => `2026-11-23T${x}:00.000Z`).join() && D.dayTimes(a24, week, 'Etc/UTC', '2026-11-24', nowMon).length === 0, tw);
  const ch = D.dayChoices(a24, week, 'Etc/UTC', nowMon);
  check('the days to pick: tomorrow on, up to how far ahead, only those with times', ch.length === 1 && ch[0].date === '2026-11-23' && ch[0].times.length === 5 && D.dayChoices(a24, null, 'Etc/UTC', nowMon).length === 7 && D.dayChoices(a24, null, 'Etc/UTC', nowMon)[0].date === '2026-11-17', ch);
  check('a day and time checked again: offered, yes; not a time offered, today, or past how far ahead, no',
    D.laterOk(a24, week, 'Etc/UTC', '2026-11-23', '2026-11-23T12:00:00.000Z', nowMon) && !D.laterOk(a24, week, 'Etc/UTC', '2026-11-23', '2026-11-23T12:15:00.000Z', nowMon)
    && !D.laterOk(a24, null, 'Etc/UTC', '2026-11-16', '2026-11-16T15:00:00.000Z', nowMon) && !D.laterOk(a24, null, 'Etc/UTC', '2026-11-24', '2026-11-24T12:00:00.000Z', nowMon) && !D.laterOk(a24, null, 'Etc/UTC', 'soon', '2026-11-17T12:00:00.000Z', nowMon));
  check('…a page a few minutes old: a time just inside the notice still counts, for a quarter hour',
    D.laterOk(a24, null, 'Etc/UTC', '2026-11-23', '2026-11-23T12:00:00.000Z', Date.parse('2026-11-22T12:05:00.000Z')) && !D.laterOk(a24, null, 'Etc/UTC', '2026-11-23', '2026-11-23T12:00:00.000Z', Date.parse('2026-11-22T12:20:00.000Z')));
  check('the kitchen starts it its slowest item and two minutes ahead, and three minutes an item past six (an hour at most)',
    D.leadMs([{ quantity: 5, makeSeconds: 600 }]) === 720000 && D.leadMs([{ quantity: 18, makeSeconds: 300 }]) === 420000 + 36 * 60000 && D.leadMs([{ quantity: 40, makeSeconds: 60 }]) === 180000 + 60 * 60000);
  const at0 = Date.parse('2026-11-28T12:00:00.000Z');
  check('to the kitchen screen two hours before (sooner for a long one), canceled until the notice before, started its lead before',
    D.releaseAt(at0, [{ quantity: 5, makeSeconds: 600 }]) === at0 - 2 * H && D.releaseAt(at0, [{ quantity: 40, makeSeconds: 3600 }]) === at0 - (3720000 + 3600000) && D.cancelBy(at0, 48) === at0 - 48 * H && D.startsAt(at0, [{ quantity: 5, makeSeconds: 600 }]) === at0 - 720000);
  check('the night it belongs to: its own time for another day, otherwise when it was paid', D.ownTime({ ahead: { forDay: '2026-11-28', at: 'A' }, paidAt: 'P' }) === 'A' && D.ownTime({ paidAt: 'P', createdAt: 'C' }) === 'P' && D.ownTime({ createdAt: 'C' }) === 'C');
  check('the day in words', D.dayWords('2026-11-28') === 'Saturday, Nov 28' && D.dayWords('2026-11-28', true) === 'Sat 28');

  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, publicOrigin: 'https://app.test' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/inventory/tray`).set({ type: 'refreshment', name: 'Party tray', category: 'Catering', price: 12, totalStock: 100, makeSeconds: 600 });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 3, totalStock: 100, makeSeconds: 60 });
  const A = (b: any) => AHEAD(req({ tenantId: 't1', ...b })) as any;
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b })) as any;
  const C = (b: any) => LANE(req({ tenantId: 't1', channel: 'counter', ...b })) as any;
  let k = 0; const nextKey = () => `laterkey${++k}`;

  console.log('the settings');
  await Mn({ action: 'ahead', on: true });
  let r: any = await Mn({ action: 'ahead', anotherDay: { on: true, daysAhead: 14, noticeHours: 48, minOrder: '50' } });
  check('a manager turns it on: two weeks ahead, two days’ notice, $50 at least', r.body.ok && JSON.stringify(r.body.ahead.anotherDay) === JSON.stringify({ on: true, daysAhead: 14, noticeHours: 48, minCents: 5000 }), r.body.ahead?.anotherDay);
  const bad1: any = await Mn({ action: 'ahead', anotherDay: { daysAhead: 5 } }); const bad2: any = await Mn({ action: 'ahead', anotherDay: { minOrder: 'lots' } });
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  const bad3: any = await Mn({ action: 'ahead', anotherDay: { on: false } });
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  check('…only the choices, and only a manager', bad1.status === 400 && /how far ahead/.test(bad1.body.error) && bad2.status === 400 && /smallest order/.test(bad2.body.error) && bad3.status === 403 && (await get(T)).orderAhead.anotherDay.on === true, [bad1.body, bad2.body, bad3.body]);

  console.log('the guest orders for another day');
  const today = new Date().toISOString().slice(0, 10); const forDay = addDays(today, 3); const at = `${forDay}T12:00:00.000Z`;
  r = await A({ action: 'menu' });
  const L0 = r.body.later;
  check('the guest’s page: the days and their times, inside (never the drive-thru), the smallest order and the notice', !!L0 && L0.days.length >= 10 && L0.days.every((x: any) => x.date > today) && L0.days.some((x: any) => x.date === forDay && x.times.includes(at)) && !L0.ways.includes('drive-thru') && L0.ways.includes('inside') && L0.minCents === 5000 && L0.noticeHours === 48, L0 && { n: L0.days.length, first: L0.days[0], ways: L0.ways });
  const base = { action: 'place', name: 'Maya', way: 'inside', day: forDay, at, phone: '8325550150', people: 20, lines: [{ itemId: 'tray', quantity: 5 }] };
  const noDt: any = await A({ ...base, key: nextKey(), way: 'drive-thru' });
  const noPh: any = await A({ ...base, key: nextKey(), phone: '' });
  const small: any = await A({ ...base, key: nextKey(), lines: [{ itemId: 'tray', quantity: 1 }] });
  const todayT: any = await A({ ...base, key: nextKey(), day: today, at: `${today}T20:00:00.000Z` });
  const oddT: any = await A({ ...base, key: nextKey(), at: `${forDay}T12:15:00.000Z` });
  const ppl: any = await A({ ...base, key: nextKey(), people: 0 });
  check('refused: the drive-thru, no phone, under the smallest order, today, a time not offered, or no people',
    noDt.status === 400 && noDt.body.code === 'way' && noPh.status === 400 && noPh.body.code === 'phone' && /reach you about your order/.test(noPh.body.error) && small.status === 400 && small.body.code === 'too_small' && /\$50\.00/.test(small.body.error)
    && todayT.status === 400 && todayT.body.code === 'at' && oddT.status === 400 && oddT.body.code === 'at' && ppl.status === 400 && ppl.body.code === 'people', [noDt.body, noPh.body, small.body, todayT.body, oddT.body, ppl.body]);
  await Mn({ action: 'ahead', anotherDay: { on: false } });
  const off: any = await A({ ...base, key: nextKey() });
  await Mn({ action: 'ahead', anotherDay: { on: true } });
  check('…and not at all while it’s off', off.status === 409 && off.body.code === 'later_off', off.body);
  // What's counted now says nothing about then (more is made by its day); and more than 20 of one thing.
  await db.doc(`${T}/inventory/fries`).set({ totalStock: 3 }, { merge: true });
  const big: any = await A({ ...base, key: nextKey(), lines: [{ itemId: 'tray', quantity: 30 }] });
  const tooBig: any = await A({ ...base, key: nextKey(), lines: [{ itemId: 'tray', quantity: 101 }] });
  const todayBig: any = await A({ ...base, key: nextKey(), day: undefined, at: undefined, people: undefined, lines: [{ itemId: 'tray', quantity: 30 }] });
  check('up to 100 of one thing for another day (20 for today)', big.body.ok && tooBig.status === 409 && /Between 1 and 100/.test(tooBig.body.error) && todayBig.status === 409 && /Between 1 and 20/.test(todayBig.body.error), [big.body.ok, tooBig.body, todayBig.body]);
  r = await A({ ...base, key: nextKey(), lines: [{ itemId: 'tray', quantity: 5 }, { itemId: 'fries', quantity: 2 }] });
  const lowNow: any = await A({ ...base, key: nextKey(), day: undefined, at: undefined, people: undefined, lines: [{ itemId: 'fries', quantity: 5 }] });
  await db.doc(`${T}/inventory/fries`).set({ totalStock: 100 }, { merge: true });
  const id1 = r.body.orderId; const s1 = r.body.sig; let o1 = await get(`${T}/counterOrders/${id1}`);
  check('…what’s left right now holds back today’s orders only', lowNow.status === 409 && lowNow.body.code === 'sold_out', lowNow.body);
  check('placed: its own day, how many people, until when it can be canceled, when it goes to the kitchen',
    r.body.ok && o1.day === forDay && o1.ahead.forDay === forDay && o1.ahead.at === at && o1.ahead.way === 'inside' && o1.ahead.later.people === 20 && o1.ahead.later.phone === '8325550150'
    && o1.ahead.later.cancelBy === new Date(Date.parse(at) - 48 * H).toISOString() && o1.ahead.later.releaseAt === new Date(Date.parse(at) - 2 * H).toISOString() && o1.ahead.later.due === o1.ahead.later.releaseAt
    && o1.ahead.later.wipeAfter === new Date(Date.parse(at) + 36 * H).toISOString(), { body: r.body, a: o1?.ahead });
  check('…its pickup code and number are its day’s, and it takes no room in its pickup time', !!(await get(`${T}/aheadCodes/${forDay}_${o1.ahead.code}`)) && !!(await get(`${T}/orderCounters/${forDay}`)) && SL.itemsBySlot([{ id: id1, ...o1, ahead: { ...o1.ahead, state: 'paid' } }], Date.now()).size === 0);
  paid(S.pis.get(o1.ahead.payId).id);
  r = await A({ action: 'done', o: id1, s: s1 });
  o1 = await get(`${T}/counterOrders/${id1}`);
  const tix1 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id1);
  const sale1 = await get(`${T}/transactions/counter_${id1}`);
  check('paid: kept for its day (nothing on the kitchen screen yet), and in the books today', r.body.ok && r.body.paid && o1.status === 'scheduled' && !!o1.paidAt && o1.ahead.state === 'paid' && tix1.length === 0 && sale1?.amount === 66 && String(sale1.date).slice(0, 10) === today, { body: r.body, status: o1.status, tix: tix1.length, sale1 });
  r = await A({ action: 'track', o: id1, s: s1 });
  check('their page: booked for its day, for 20, its pickup code, and Cancel and refund until the notice runs out', r.body.later?.waiting === true && r.body.later.canCancel === true && r.body.later.day === forDay && r.body.later.people === 20 && r.body.kitchen === 'later' && r.body.code === o1.ahead.code && r.body.later.cancelBy === o1.ahead.later.cancelBy, r.body.later);
  r = await A({ action: 'here', o: id1, s: s1 });
  check('…I’m here waits for its day', r.status === 409 && r.body.code === 'later', r.body);

  console.log('coming up on the counter');
  r = await C({ action: 'lane' });
  const row1 = (r.body.comingUp || []).find((x: any) => x.orderId === id1);
  check('the counter’s Coming up: when, who, how many, what it comes to, and when the kitchen starts it', !!row1 && row1.day === forDay && row1.at === at && row1.name === 'Maya' && row1.people === 20 && row1.items === 7 && row1.total === o1.total && row1.startsAt === new Date(D.startsAt(Date.parse(at), o1.lines)).toISOString() && row1.startsAt === `${forDay}T11:45:00.000Z` && row1.failed === null && row1.today === false && row1.phone === '8325550150', row1);
  r = await C({ action: 'laterSend', orderId: id1 });
  check('…Send it now waits for its day', r.status === 409 && /goes to the kitchen on its day/.test(r.body.error), r.body);

  console.log('on its day');
  const tenant = await get(T);
  let rd = await RD.releaseDue(db, 't1', tenant, Date.parse(at) - 3 * H);
  check('three hours before: still waiting', rd.sent === 0 && (await get(`${T}/counterOrders/${id1}`)).status === 'scheduled', rd);
  rd = await RD.releaseDue(db, 't1', tenant, Date.parse(at) - 2 * H + 60000);
  o1 = await get(`${T}/counterOrders/${id1}`);
  const tix1b = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id1);
  check('two hours before: on the kitchen screen, under Later until it’s time to start (its slowest item, two minutes, and a bit for its size)', rd.sent === 1 && o1.status === 'sent' && !!o1.ahead.later.sentAt && o1.ahead.later.due === null && tix1b.length === 2 && tix1b.every((t: any) => t.holdUntil === `${forDay}T11:45:00.000Z` && t.dueAt === at), { rd, status: o1.status, tix: tix1b.map((t: any) => [t.holdUntil, t.dueAt]) });
  r = await C({ action: 'lane' });
  check('…off Coming up', !(r.body.comingUp || []).some((x: any) => x.orderId === id1));
  r = await A({ action: 'track', o: id1, s: s1 });
  check('…their page: waiting to start, no Cancel any more', r.body.later?.waiting === false && r.body.later.canCancel === false && r.body.kitchen === 'later', r.body.later);
  r = await C({ action: 'laterCancel', orderId: id1 });
  check('…and with the kitchen, it isn’t canceled here', r.status === 409 && /with the kitchen already/.test(r.body.error), r.body);

  const placePaid = async (extra: any = {}) => {
    const x: any = await A({ ...base, key: nextKey(), ...extra });
    if (!x.body.ok) return { id: '', sig: '', o: null as any, body: x.body };
    const o = await get(`${T}/counterOrders/${x.body.orderId}`); paid(S.pis.get(o.ahead.payId).id);
    await A({ action: 'done', o: x.body.orderId, s: x.body.sig });
    return { id: x.body.orderId, sig: x.body.sig, o: await get(`${T}/counterOrders/${x.body.orderId}`), body: x.body };
  };
  const p2 = await placePaid({ name: 'Dee', lines: [{ itemId: 'tray', quantity: 4 }, { itemId: 'fries', quantity: 2 }] });
  await db.doc(`${T}/inventory/fries`).set({ soldOut: true }, { merge: true });
  const notes0 = (await all(`${T}/notifications`)).filter((n: any) => n.type === 'ahead_later_failed').length;
  rd = await RD.releaseDue(db, 't1', tenant, Date.parse(at) - 2 * H + 60000);
  let o2 = await get(`${T}/counterOrders/${p2.id}`);
  const notes1 = (await all(`${T}/notifications`)).filter((n: any) => n.type === 'ahead_later_failed');
  check('something sold out on the day: kept, why said, the managers told, and tried again in five minutes (behind the rest meanwhile)', rd.failed === 1 && o2.status === 'scheduled' && o2.ahead.later.due === new Date(Date.parse(at) - 2 * H + 6 * 60000).toISOString() && /Fries just sold out/.test(o2.ahead.later.release.why) && notes1.length - notes0 === 1 && /Order .* couldn’t go to the kitchen: Fries just sold out/.test(notes1[notes1.length - 1].message), { rd, rel: o2.ahead.later.release, note: notes1[notes1.length - 1]?.message });
  rd = await RD.releaseDue(db, 't1', tenant, Date.parse(at) - 2 * H + 6 * 60000);
  r = await C({ action: 'lane' });
  const row2 = (r.body.comingUp || []).find((x: any) => x.orderId === p2.id);
  check('…tried again a few minutes on, told only once; the counter shows why', rd.failed === 1 && (await all(`${T}/notifications`)).filter((n: any) => n.type === 'ahead_later_failed').length - notes0 === 1 && /Fries just sold out/.test(row2?.failed || ''), row2);
  await db.doc(`${T}/inventory/fries`).set({ soldOut: false }, { merge: true });
  rd = await RD.releaseDue(db, 't1', tenant, Date.parse(at) - 2 * H + 11 * 60000);
  o2 = await get(`${T}/counterOrders/${p2.id}`);
  check('…back in: it goes by itself', rd.sent === 1 && o2.status === 'sent' && o2.ahead.later.release === null, { rd, status: o2.status });
  const p3 = await placePaid({ name: 'Lee' });
  await db.doc(`${T}/counterOrders/${p3.id}`).set({ day: today, ahead: { forDay: today } }, { merge: true });
  r = await C({ action: 'laterSend', orderId: p3.id });
  check('the counter’s Send it now, on its day', r.body.ok && (await get(`${T}/counterOrders/${p3.id}`)).status === 'sent', r.body);

  console.log('canceled');
  const p4 = await placePaid({ name: 'Ari' });
  const b4 = S.refunds.length;
  r = await A({ action: 'cancel', o: p4.id, s: p4.sig });
  let o4 = await get(`${T}/counterOrders/${p4.id}`);
  const back4 = S.refunds.slice(b4).reduce((n: number, x: any) => n + x.amount, 0);
  check('the guest cancels in time: every line back to the card, the order closed, its code free and their number gone', r.body.ok && r.body.cents === Math.round(p4.o.total * 100) && back4 === Math.round(p4.o.total * 100) && o4.status === 'voided' && o4.ahead.state === 'canceled' && o4.ahead.later.canceledBy === 'guest' && !!o4.refundedAt && o4.refundedCents === Math.round(p4.o.total * 100)
    && !(await get(`${T}/aheadCodes/${forDay}_${p4.o.ahead.code}`)) && o4.ahead.later.phone === null && o4.ahead.later.due === null, { body: r.body, back4, status: o4.status, later: o4.ahead.later });
  r = await A({ action: 'track', o: p4.id, s: p4.sig });
  const again4: any = await A({ action: 'cancel', o: p4.id, s: p4.sig });
  check('…their page says so; asked again, as it was (nothing twice)', r.body.later?.canceled === true && r.body.later.canceledBy === 'guest' && r.body.later.back === p4.o.total && again4.body.ok && again4.body.already === true && S.refunds.length - b4 === 2, { later: r.body.later, again: again4.body });
  rd = await RD.releaseDue(db, 't1', tenant, Date.parse(at) - H);
  check('…and never goes to the kitchen', (await get(`${T}/counterOrders/${p4.id}`)).status === 'voided' && !(await all(`${T}/kdsTickets`)).some((t: any) => t.orderId === p4.id));
  const p5 = await placePaid({ name: 'Bo', phone: '8325550155' });
  await db.doc(`${T}/counterOrders/${p5.id}`).set({ ahead: { later: { cancelBy: new Date(Date.now() - 60000).toISOString() } } }, { merge: true });
  r = await A({ action: 'cancel', o: p5.id, s: p5.sig });
  const tr5: any = await A({ action: 'track', o: p5.id, s: p5.sig });
  check('past the notice: the guest can’t cancel for a refund', r.status === 409 && /time to cancel/.test(r.body.error) && tr5.body.later.canCancel === false && (await get(`${T}/counterOrders/${p5.id}`)).status === 'scheduled', r.body);
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  r = await C({ action: 'laterCancel', orderId: p5.id });
  check('the counter’s Cancel and refund: a manager’s (their PIN, or ask one)', r.status === 403 && r.body.needsManager === true, r.body);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  texts.length = 0;
  r = await C({ action: 'laterCancel', orderId: p5.id });
  const o5 = await get(`${T}/counterOrders/${p5.id}`);
  check('…a manager cancels it (until it goes to the kitchen), and the guest gets a text', r.body.ok && o5.status === 'voided' && o5.ahead.later.canceledBy === 'Ana Ruiz' && texts.some((x) => x.to === '+18325550155' && /was canceled/.test(x.body) && new RegExp(`\\$${p5.o.total.toFixed(2).replace('.', '\\.')} is on its way back`).test(x.body)), { body: r.body, texts });
  const p6 = await placePaid({ name: 'Cy' });
  const b6 = S.refunds.length; S.failIn = 2;
  r = await C({ action: 'laterCancel', orderId: p6.id });
  let o6 = await get(`${T}/counterOrders/${p6.id}`);
  rd = await RD.releaseDue(db, 't1', tenant, Date.parse(at) - H);
  const lane6: any = await C({ action: 'lane' });
  check('a refund that stops partway: what went is kept, it never goes to the kitchen, and the counter says to finish it', r.status === 502 && /went back, but not all of it/.test(r.body.error) && o6.status === 'scheduled' && S.refunds.length - b6 === 1
    && (await get(`${T}/counterOrders/${p6.id}`)).status === 'scheduled' && !!(lane6.body.comingUp || []).find((x: any) => x.orderId === p6.id)?.stuck, { body: r.body, n: S.refunds.length - b6 });
  r = await C({ action: 'laterCancel', orderId: p6.id });
  o6 = await get(`${T}/counterOrders/${p6.id}`);
  check('…asked again: the rest goes, nothing twice', r.body.ok && r.body.cents === Math.round(p6.o.total * 100) && o6.status === 'voided' && S.refunds.length - b6 === 2, { body: r.body, n: S.refunds.length - b6 });

  console.log('delivered on another day');
  await db.doc(T).set({ retailSettings: { taxRatePercent: 10, deliveryPlan: PLAN } }, { merge: true });
  r = await Mn({ action: 'ahead', delivery: true });
  const addr = { line1: '9 Harbor Ct', city: 'Riverton', state: 'NJ', postalCode: '08077' };
  r = await A({ action: 'deliveryCheck', address: addr, lines: [{ itemId: 'tray', quantity: 5 }], later: true });
  check('the address for another day: the fee and the drive only (today’s drivers and hours don’t come into it)', r.body.ok && r.body.feeCents === 399 && r.body.driveMin === 15 && r.body.times.length === 0 && r.body.asapArrive === null, r.body);
  const p7 = await placePaid({ name: 'Dee', way: 'delivery', address: addr, note: 'Gate 4', tip: { pct: 15 } });
  check('placed and paid: a delivery for its day, due the drive after its time', p7.o?.ahead?.way === 'delivery' && p7.o.ahead.delivery.state === 'waiting' && p7.o.ahead.delivery.arriveAt === new Date(Date.parse(at) + 15 * 60000).toISOString() && p7.o.status === 'scheduled' && p7.o.deliveryFee === 3.99, p7.body);
  // On its day, paid three days before: not on the drivers' list until it's sent; then not from an earlier night, and
  // not told as never delivered.
  await db.doc(`${T}/counterOrders/${p7.id}`).set({ day: today, paidAt: new Date(Date.now() - 72 * H).toISOString(), ahead: { forDay: today, at: new Date(Date.now() + 3 * H).toISOString() } }, { merge: true });
  const rows7a = await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 60000);
  check('…waiting for the kitchen on its day: under Coming up, not on the drivers’ list yet', !rows7a.some((x: any) => x.orderId === p7.id), rows7a.map((x: any) => x.orderId));
  await db.doc(`${T}/counterOrders/${p7.id}`).set({ status: 'sent' }, { merge: true });
  const rows7 = await FS.deliveriesToday(db, 't1', await get(T), Date.now() + 120000);
  const nightly = await FS.deliveryNightly(db, 't1', await get(T));
  check('…on its day: on the drivers’ list, not from an earlier night, and not told as never delivered', rows7.some((x: any) => x.orderId === p7.id && x.earlier === false) && nightly.told === 0 && !(await get(`${T}/counterOrders/${p7.id}`)).ahead.delivery.toldAt, { rows7: rows7.map((x: any) => [x.orderId, x.earlier]), nightly });

  console.log('the night report, and the guest’s number');
  const dn = NC.deliveryNight([{ paidAt: 'x', status: 'scheduled', total: 66, ahead: { forDay, way: 'delivery', delivery: { state: 'waiting' } } }, { paidAt: 'x', status: 'sent', total: 20, ahead: { way: 'delivery', delivery: { state: 'waiting' } } }, { paidAt: 'x', status: 'scheduled', total: 40, ahead: { forDay, way: 'inside' } }]);
  check('the night report: orders for another day paid tonight on their own, never still going', dn.later?.orders === 2 && dn.later.cents === 10600 && dn.going === 1, dn);
  const p8 = await placePaid({ name: 'Gil' });
  const past = new Date(Date.now() - 60000).toISOString();
  await db.doc(`${T}/counterOrders/${id1}`).set({ status: 'done', ahead: { later: { wipeAfter: past } } }, { merge: true });
  await db.doc(`${T}/counterOrders/${p8.id}`).set({ ahead: { later: { wipeAfter: past } } }, { merge: true });
  rd = await RD.releaseDue(db, 't1', tenant);
  const o1w = await get(`${T}/counterOrders/${id1}`); const o8w = await get(`${T}/counterOrders/${p8.id}`);
  check('the morning after its day, the guest’s number is cleared (one still waiting for the kitchen keeps it)', rd.wiped === 1 && o1w.ahead.later.phone === null && o1w.ahead.later.wipeAfter === null && o8w.ahead.later.phone === '8325550150' && Date.parse(o8w.ahead.later.wipeAfter) > Date.now() + 5 * H, { rd, o1: o1w.ahead.later, o8: o8w.ahead.later });
  await db.doc(`${T}/counterOrders/${p8.id}`).set({ ahead: { later: { due: past } } }, { merge: true });
  await db.doc(`${T}/counterOrders/${p4.id}`).set({ ahead: { later: { due: past } } }, { merge: true });
  rd = await RD.releaseDue(db, 't1', tenant);
  check('the sweep reads only what’s due: one closed some other way comes off its list', (await get(`${T}/counterOrders/${p4.id}`)).ahead.later.due === null && rd.sent === 1 && (await get(`${T}/counterOrders/${p8.id}`)).status === 'sent', rd);

  console.log('curbside');
  await Mn({ action: 'ahead', curbside: true });
  const p9 = await placePaid({ name: 'Hal', way: 'curbside' });
  await db.doc(`${T}/counterOrders/${p9.id}`).set({ day: today, ahead: { forDay: today } }, { merge: true });
  const CS = await import('../../src/lib/curbside-server');
  const curbRows = await CS.cafeCurbside(db, 't1', await get(T), Date.now() + 10000);
  const handed: any = await CS.cafeHanded(db, 't1', p9.id, { name: 'Kai Park' });
  check('curbside, waiting for the kitchen on its day: not on the Curbside screen, and never handed over with nothing made', p9.o?.ahead?.way === 'curbside' && !curbRows.some((x: any) => x.id === p9.id) && handed.ok === false && /for another day/.test(handed.error) && (await get(`${T}/counterOrders/${p9.id}`)).status === 'scheduled', { rows: curbRows.map((x: any) => x.id), handed });

  console.log('the pages');
  const page = src('src/app/order/[tenantId]/page.tsx'); const card = src('src/components/drive-thru/ComingUp.tsx'); const settings = src('src/components/menu/OrderAheadCard.tsx');
  const cron = src('src/app/api/cron/retail-payments/route.ts'); const counter = src('src/app/(app)/counter/page.tsx');
  check('the guest’s page: Today or Another day, its day and time, how many people, Booked and Cancel and refund', /tr\('Another day'\)/.test(page) && /tr\('How many people\?'\)/.test(page) && /\{tr\('Booked'\)\}</.test(page) && /tr\('Cancel and refund \{price\}', \{ price: usd\(t\.total\) \}\)/.test(page) && /action: 'cancel'/.test(page));
  check('the counter’s Coming up, with Send it now and Cancel and refund (a manager’s PIN)', /Coming up/.test(card) && /laterCancel/.test(card) && /laterSend/.test(card) && /askPin/.test(card) && /<ComingUp /.test(counter));
  check('the Menu page’s settings', /Orders for another day/.test(settings) && /Notice you need/.test(settings) && /Smallest order/.test(settings));
  check('the payments cron sends each on its day', /releaseDue\(db, t\.id, tenant\)/.test(cron));
  const fresh = [card, src('src/lib/ahead-days.ts'), src('src/lib/ahead-days-server.ts')].join('\n');
  check('the new words: no middle dots, no calling or contacting, no uppercase', !/ · /.test(fresh) && !/call us|contact us/i.test(fresh) && !/\buppercase\b|font-black/.test(fresh));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
