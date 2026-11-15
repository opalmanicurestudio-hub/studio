// Checks tables booked online (L20 round 7): lib/table-booking (the rules), lib/table-booking-server, api/table-book (the
// guest's pages), api/host/floor (the host stand's charge and let-go), and the screens.
// - Off until the business turns it on; its days and times, the seats online bookings can fill, the largest party.
// - A party fits a time when, all through its stay, the guests in at once plus them come to no more than those seats; two
//   guests can't both take the last seats.
// - A big table: the card company's form saves a card (nothing charged), the table held a few minutes meanwhile; a form
//   left open lets the seats go, unless the card did go through.
// - The guest's link: see it, running late, cancel (late after the free time, with a card).
// - On the day: each booking is a party still to come on the host stand, once; a cancelled one comes off.
// - A no-show past the held time or a late cancel: a manager charges the agreed fee once (or lets it go); a declined card
//   charges nothing.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/table-booking.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Mo Diaz', role: 'manager', isManager: true, caps: [] };
const S: any = { sis: new Map<string, any>(), pis: new Map<string, any>(), keys: new Map<string, string>(), n: 0, decline: false, texts: [] as any[], emails: [] as any[] };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
class FakeStripe {
  customers = { create: async (p: any, o: any) => { if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return { id: S.keys.get(o.idempotencyKey) }; const id = `cus_${++S.n}`; if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return { id, ...p }; } };
  setupIntents = {
    create: async (p: any, o: any) => { if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.sis.get(S.keys.get(o.idempotencyKey))); const id = `seti_${++S.n}`;
      const si = { id, status: 'requires_payment_method', customer: p.customer, metadata: { ...p.metadata }, usage: p.usage, client_secret: `${id}_secret`, payment_method: null, account: o?.stripeAccount }; S.sis.set(id, si); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(si); },
    retrieve: async (id: string) => clone(S.sis.get(id)),
  };
  paymentMethods = { retrieve: async (id: string) => ({ id, card: { brand: 'visa', last4: '4242' } }) };
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      if (S.decline) throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', raw: { message: 'Your card was declined.' } });
      const id = `pi_${++S.n}`; const pi = { id, status: 'succeeded', ...p, metadata: { ...p.metadata }, account: o?.stripeAccount, key: o?.idempotencyKey };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(pi);
    },
  };
}
const saveCard = (siId: string) => { const si = S.sis.get(siId); si.status = 'succeeded'; si.payment_method = `pm_${siId}`; };

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Your role doesn’t allow that.' } } } : { actor, tenant: {} }) };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/sms' || /\/src\/lib\/sms(\.ts)?$/.test(request)) return fake(request, { sendTenantSms: async (_db: any, _t: string, to: string, text: string) => { S.texts.push({ to, text }); return { ok: true }; } });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, x: any) => { S.emails.push(x); return { status: 'sent' }; } });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any, ip = '10.3.0.1') => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'x-real-ip' ? ip : String(k).toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

let BSmod: any = null; const BSx = () => BSmod;
(async () => {
  BSmod = await import('../../src/lib/table-booking-server');
  const TB = await import('../../src/lib/table-booking');
  const { DEFAULT_FLOOR } = await import('../../src/lib/table-stage');
  console.log('the rules');
  const D = TB.tableBookingOf({});
  check('off until the business turns it on; every day, 5 to 9 pm every 30 min, up to 8, a month ahead, an hour before; no card until on', !D.on && D.days.length === 7 && D.first === '17:00' && D.last === '21:00' && D.every === 30 && D.maxSize === 8 && D.aheadDays === 30 && D.cutoffMin === 60 && !D.card && D.cardFrom === 6 && D.feePerGuest === 20 && D.cancelHours === 24);
  const C = TB.cleanTableBooking({ on: true, days: [5, 6, 9, 5], first: '22:00', last: '18:00', every: 20, maxSize: 99, feePerGuest: 0, card: true });
  check('…cleaned: real days only, times in order, 15 or 30 apart, a fee of 0 stays 0', C.days.join() === '5,6' && C.first === '18:00' && C.last === '22:00' && C.every === 30 && C.maxSize === 40 && C.feePerGuest === 0 && TB.cardNeeded(8, C) === false);
  check('the times to pick', TB.timesFor({ ...D, first: '17:00', last: '18:30', every: 30 }).join() === '17:00,17:30,18:00,18:30');
  const fs = { ...DEFAULT_FLOOR };   // 50 min for 1 or 2, 65 for 3 or 4, 80 for 5 or more
  const held = [{ at: '19:00', size: 4 }, { at: '19:30', size: 4 }];
  check('a party fits only while the guests in at once stay within the seats, all through its stay', TB.fits(held, '19:30', 2, 10, fs) && !TB.fits(held, '19:30', 3, 10, fs) && !TB.fits(held, '19:15', 3, 10, fs) && TB.fits(held, '20:30', 6, 10, fs) && !TB.fits(held, '18:30', 3, 10, fs));
  check('…a party that left already, or a card form left open past its time, takes nothing', TB.fits([{ at: '17:00', size: 10 }], '18:30', 10, 10, fs) && TB.heldNow({ at: '19:00', size: 4, until: new Date(Date.now() - 1000).toISOString() }, Date.now()) === false);
  check('the fee: per guest; free to cancel until the hours before', TB.feeFor(8, D) === 160 && TB.freeUntil('2026-11-16T00:00:00.000Z', D) === '2026-11-15T00:00:00.000Z');

  console.log('booking online');
  const tenant: any = { name: 'Linden', timezone: 'America/New_York', stripeAccountId: 'acct_1', hostingSettings: { holdGraceMinutes: 15, booking: { on: false } } };
  await db.doc(T).set(tenant);
  await db.doc(`${T}/floorPlans/default`).set({ units: [{ id: 'u1', seatCount: 4 }, { id: 'u2', seatCount: 4 }, { id: 'u3', seatCount: 2 }] });
  const Book = await import('../../src/app/api/table-book/route');
  let ipN = 0;
  const P = (body: any, ip?: string) => Book.POST(req({ tenantId: 't1', ...body }, ip || (body.action === 'book' ? `10.4.${++ipN}.1` : undefined)));
  let r: any = await P({ action: 'info' });
  check('off: the page says so, and nothing can be booked', r.body.ok && r.body.on === false && (await P({ action: 'book', day: '2026-12-01', time: '19:00', size: 2, name: 'A', phone: '5550001111' })).status === 409);
  await db.doc(T).set({ hostingSettings: { holdGraceMinutes: 15, booking: { on: true, first: '18:00', last: '21:00', every: 30, maxSize: 8, card: true, cardFrom: 6, feePerGuest: 20, cancelHours: 24 } } }, { merge: true });
  r = await P({ action: 'info' });
  // Two days out: a 9 pm booking tomorrow is already inside its free-cancel window after 9 pm tonight.
  const day = r.body.days[2];
  check('on: the days ahead, the largest party, what a guest can tell us, the card rule, the event request for bigger groups', r.body.on && r.body.days.length >= 28 && r.body.maxSize === 8 && r.body.asks.includes('High chair') && r.body.card.from === 6 && r.body.card.feePerGuest === 20 && r.body.groups === '/inquiry/t1' && r.body.holdMin === 15, r.body);
  r = await P({ action: 'slots', day, size: 2 });
  check('the times that day, all open (seats from the floor plan: 10)', r.body.slots.length === 7 && r.body.slots.every((x: any) => x.ok), r.body);
  r = await P({ action: 'book', day, time: '19:00', size: 4, name: 'Lee', phone: '(555) 010-2000', email: 'lee@example.com', asks: ['Birthday', 'Nope'], note: '  A candle   please ' });
  const lee: any = await get(`${T}/tableBookings/${r.body.id}`);
  check('a party of 4 booked: the booking, what they told us, the seats taken, and their link sent', r.body.ok && r.body.status === 'booked' && lee.status === 'booked' && lee.size === 4 && lee.asks.join() === 'Birthday' && lee.note === 'A candle please'
    && (await get(`${T}/tableBookingDays/${day}`)).entries[r.body.id].at === '19:00' && S.texts.length === 1 && S.texts[0].text.includes(`/table/t1/${lee.id}?k=${lee.token}`) && /We hold the table 15 minutes/.test(S.texts[0].text), { b: r.body, t: S.texts });
  const leeTok = lee.token;
  await P({ action: 'book', day, time: '19:30', size: 4, name: 'Ward', email: 'ward@example.com' });
  r = await P({ action: 'slots', day, size: 3 });
  check('…the times that would go over the seats are full', r.body.slots.find((x: any) => x.time === '19:30').ok === false && r.body.slots.find((x: any) => x.time === '18:30').ok === false && r.body.slots.find((x: any) => x.time === '18:00').ok === true && r.body.slots.find((x: any) => x.time === '21:00').ok === true, r.body.slots);
  r = await P({ action: 'book', day, time: '19:30', size: 3, name: 'Late', phone: '5550001111' });
  check('booking a full time: “That time just filled up”', r.status === 409 && r.body.code === 'full');
  r = await P({ action: 'book', day, time: '19:15', size: 2, name: 'X', phone: '5550001111' });
  check('only the business’s times, its days, up to its largest party, with a name and a way to reach them', r.status === 400
    && (await P({ action: 'book', day, time: '21:00', size: 9, name: 'X', phone: '5550001111' })).status === 400 && (await P({ action: 'book', day, time: '21:00', size: 2, name: '', phone: '5550001111' })).status === 400
    && (await P({ action: 'book', day, time: '21:00', size: 2, name: 'X' })).status === 400);

  console.log('a big table and its card');
  r = await P({ action: 'book', day, time: '21:00', size: 6, name: 'Reyes', phone: '5550002222', email: 'morgan@example.com' });
  check('a big table needs them to agree to the fee first', r.status === 400 && r.body.code === 'agree');
  r = await P({ action: 'book', day, time: '21:00', size: 6, name: 'Reyes', phone: '5550002222', email: 'morgan@example.com', asks: ['High chair'], agree: true });
  const rey: any = await get(`${T}/tableBookings/${r.body.id}`); const si: any = S.sis.get(rey.setupIntentId);
  check('…the card company’s form to save a card under a customer on the business’s account, nothing charged; the table held meanwhile', r.body.ok && r.body.status === 'card' && r.body.clientSecret === `${si.id}_secret` && r.body.stripeAccount === 'acct_1'
    && si.usage === 'off_session' && si.metadata.tableBookingId === rey.id && si.account === 'acct_1' && rey.fee === 120 && rey.status === 'card' && !!(await get(`${T}/tableBookingDays/${day}`)).entries[rey.id].until && S.pis.size === 0, { b: r.body, rey });
  r = await P({ action: 'card_done', id: rey.id, k: rey.token });
  check('…not saved yet: not booked', r.status === 409 && (await get(`${T}/tableBookings/${rey.id}`)).status === 'card');
  saveCard(si.id); const texts0 = S.texts.length;
  r = await P({ action: 'card_done', id: rey.id, k: rey.token });
  let rey2: any = await get(`${T}/tableBookings/${rey.id}`);
  check('…saved: booked, the card on the booking, the seats kept, their link sent with the free time', r.body.ok && r.body.status === 'booked' && rey2.status === 'booked' && rey2.card.last4 === '4242' && rey2.card.paymentMethodId === `pm_${si.id}` && rey2.card.customerId
    && (await get(`${T}/tableBookingDays/${day}`)).entries[rey.id].until === null && S.texts.length === texts0 + 1 && /card ending 4242 holds the table/.test(S.texts[S.texts.length - 1].text));
  r = await P({ action: 'card_done', id: rey.id, k: rey.token });
  check('…asked again, nothing twice', r.body.ok && S.texts.length === texts0 + 1);
  // A card form left open past its time: its seats go to the next guest, unless the card went through.
  r = await P({ action: 'book', day, time: '18:00', size: 6, name: 'Gone', phone: '5550003333', agree: true });
  const gone: any = await get(`${T}/tableBookings/${r.body.id}`);
  await db.doc(`${T}/tableBookingDays/${day}`).set({ entries: { [gone.id]: { at: '18:00', size: 6, until: new Date(Date.now() - 1000).toISOString() } } }, { merge: true });
  r = await P({ action: 'book', day, time: '18:00', size: 4, name: 'Next', phone: '5550004444' });
  check('a card form left open past its time lets the seats go', r.body.ok && (await get(`${T}/tableBookings/${gone.id}`)).status === 'expired' && !(await get(`${T}/tableBookingDays/${day}`)).entries[gone.id], r.body);
  r = await P({ action: 'card_done', id: gone.id, k: gone.token });
  check('…and its link says to book again', r.status === 409);

  console.log('one guest, a few bookings');
  for (const t of ['18:00', '18:30', '21:00']) await P({ action: 'book', day, time: t, size: 1, name: 'Many', phone: '+1 (555) 000-9999' });
  r = await P({ action: 'book', day, time: '21:00', size: 1, name: 'Many', phone: '555-000-9999' });
  check('one mobile number can have only a few bookings to come', r.status === 409 && r.body.code === 'many', r.body);
  r = await P({ action: 'book', day, time: '21:00', size: 1, name: 'Many' }, '10.9.9.9'); await P({ action: 'book', day, time: '21:00', size: 1, name: 'Many' }, '10.9.9.9');
  for (let i = 0; i < 4; i++) r = await P({ action: 'book', day, time: '21:00', size: 1, name: 'X', phone: `55500088${i}0` }, '10.9.9.9');
  check('…and one place can only book a few at once', r.status === 429, r.body);
  for (const b of (await all(`${T}/tableBookings`)).filter((x: any) => x.name === 'Many' || x.name === 'X')) await BSx().cancelBooking(db, T, await get(T), 't1', b.id, 'guest').catch(() => null);

  console.log('the guest’s link');
  r = await P({ action: 'view', id: lee.id, k: leeTok });
  check('their booking: when, for how many, what they told us, held 15 minutes; nobody else’s', r.body.ok && r.body.booking.state === 'booked' && r.body.booking.size === 4 && r.body.booking.asks.join() === 'Birthday' && r.body.booking.holdMin === 15 && !JSON.stringify(r.body).includes('ward@'), r.body);
  check('a link that isn’t theirs opens nothing', (await P({ action: 'view', id: lee.id, k: 'x'.repeat(22) })).status === 404 && (await P({ action: 'view', id: 'tb0000000000000000', k: leeTok })).status === 404);
  r = await P({ action: 'view', id: rey.id, k: rey.token });
  check('a big table’s: the card holding it and until when cancelling is free', r.body.booking.card.last4 === '4242' && r.body.booking.fee === 120 && !!r.body.booking.freeWords && r.body.booking.lateFee === false, r.body.booking);
  r = await P({ action: 'late', id: lee.id, k: leeTok, minutes: 15 });
  check('running late: the booking knows', r.body.ok && (await get(`${T}/tableBookings/${lee.id}`)).lateBy === 15);

  console.log('on the day');
  const session = { id: 'ses1', businessDay: day, status: 'open' };
  await db.doc(`${T}/serviceSessions/ses1`).set(session);
  const BS = await import('../../src/lib/table-booking-server');
  let lc = await BS.bookingsOnFloor(db, T, await get(T), session, { fresh: true });
  const pLee: any = await get(`${T}/parties/tb_${lee.id}`); const pRey: any = await get(`${T}/parties/tb_${rey.id}`);
  check('each booking is a party still to come on the host stand: when, how many, what they told us, the card, running late', pLee && pLee.status === 'expected' && pLee.sessionId === 'ses1' && pLee.size === 4 && pLee.asks.join() === 'Birthday' && pLee.lateBy === 15 && pLee.cardHeld === false
    && pRey.cardHeld === true && pRey.fee === 120 && pRey.asks.join() === 'High chair' && pRey.guestIds.join() === `tbook:${rey.id}` && pRey.needs.length === 0 && lc.length === 0, { pLee, pRey });
  await BS.bookingsOnFloor(db, T, await get(T), session, { fresh: true });
  check('…once each, however often the host stand looks', (await all(`${T}/parties`)).filter((p: any) => p.bookingId === lee.id).length === 1);
  // A big table cancelled after the free time.
  await db.doc(`${T}/tableBookings/${rey.id}`).set({ freeUntil: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  r = await P({ action: 'view', id: rey.id, k: rey.token });
  check('past the free time, their link says cancelling now may be charged', r.body.booking.lateFee === true);
  r = await P({ action: 'cancel', id: rey.id, k: rey.token });
  rey2 = await get(`${T}/tableBookings/${rey.id}`);
  check('cancelled late: the seats free, the party off the host stand, told to them', r.body.ok && r.body.late === true && rey2.status === 'cancelled' && rey2.lateCancel === true && !(await get(`${T}/tableBookingDays/${day}`)).entries[rey.id]
    && (await get(`${T}/parties/tb_${rey.id}`)).status === 'cancelled' && /may be charged/.test(S.texts[S.texts.length - 1].text));
  lc = await BS.bookingsOnFloor(db, T, await get(T), session, { fresh: true });
  check('…the host stand sees it as a late cancel that could be charged', lc.length === 1 && lc[0].bookingId === rey.id && lc[0].fee === 120 && lc[0].card === '4242', lc);
  r = await P({ action: 'cancel', id: lee.id, k: leeTok });
  check('cancelled in time: not late', r.body.ok && r.body.late === false && (await get(`${T}/tableBookings/${lee.id}`)).lateCancel === false);

  console.log('charging');
  const Host = await import('../../src/app/api/host/floor/route');
  const H = (body: any) => Host.POST(req({ tenantId: 't1', ...body }));
  actor = { uid: 's1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
  r = await H({ action: 'booking_charge', bookingId: rey.id });
  check('only a manager can charge', r.status === 403 && S.pis.size === 0);
  actor = { uid: 'm1', name: 'Mo Diaz', role: 'manager', isManager: true, caps: [] };
  r = await H({ action: 'booking_charge', bookingId: rey.id });
  const pi1: any = [...S.pis.values()][0];
  check('a late cancel: the agreed fee, once, off the saved card, recorded, and a receipt to them', r.body.ok && r.body.amount === 120 && pi1.amount === 12000 && pi1.off_session === true && pi1.confirm === true && pi1.payment_method === `pm_${si.id}` && pi1.account === 'acct_1'
    && pi1.metadata.kind === 'late_cancel' && (await get(`${T}/transactions/tbookfee_${rey.id}`)).amount === 120 && (await get(`${T}/tableBookings/${rey.id}`)).charge.state === 'paid' && /we charged \$120/.test(S.texts[S.texts.length - 1].text), { b: r.body, pi1 });
  r = await H({ action: 'booking_charge', bookingId: rey.id });
  check('…charging again changes nothing', r.body.ok && r.body.already && S.pis.size === 1);
  lc = await BS.bookingsOnFloor(db, T, await get(T), session, { fresh: true });
  check('…and it’s off the late cancels', lc.length === 0);
  r = await H({ action: 'booking_charge', bookingId: lee.id });
  check('one cancelled in time can’t be charged', r.status === 409);
  // The business cancels a big table after the free time: never a late cancel. The guest asking the host to: is.
  const mk = async (time: string, nm: string) => { const x: any = await P({ action: 'book', day, time, size: 6, name: nm, phone: `5551${Math.floor(Math.random() * 1e6)}`, agree: true }); const bb: any = await get(`${T}/tableBookings/${x.body.id}`); saveCard(bb.setupIntentId); await P({ action: 'card_done', id: bb.id, k: bb.token }); await db.doc(`${T}/tableBookings/${bb.id}`).set({ freeUntil: new Date(Date.now() - 60000).toISOString() }, { merge: true }); return bb; };
  const hc = await mk('18:00', 'Host cancels');
  r = await H({ action: 'booking_cancel', bookingId: hc.id });
  check('cancelled by the business after the free time: nothing to charge', r.body.ok && r.body.late === false && (await H({ action: 'booking_charge', bookingId: hc.id })).status === 409);
  const ga = await mk('18:30', 'Guest asked');
  r = await H({ action: 'booking_cancel', bookingId: ga.id, guestAsked: true });
  check('…the guest asked the host to: a late cancel', r.body.ok && r.body.late === true);
  // A late cancel for another day is seen today.
  const other = ((await P({ action: 'info' })) as any).body.days[3];
  r = await P({ action: 'book', day: other, time: '19:00', size: 6, name: 'Later', phone: '5552223333', agree: true });
  const lt: any = await get(`${T}/tableBookings/${r.body.id}`); saveCard(lt.setupIntentId); await P({ action: 'card_done', id: lt.id, k: lt.token });
  await db.doc(`${T}/tableBookings/${lt.id}`).set({ freeUntil: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  await P({ action: 'cancel', id: lt.id, k: lt.token });
  lc = await BS.bookingsOnFloor(db, T, await get(T), session, { fresh: true });
  check('a late cancel for another day shows today, with its day', lc.some((c: any) => c.bookingId === lt.id && c.day === other) && lc.some((c: any) => c.bookingId === ga.id), lc);
  r = await H({ action: 'booking_letgo', bookingId: lt.id });
  r = await H({ action: 'booking_charge', bookingId: lt.id });
  check('let go: it can’t be charged after', r.status === 409 && /let go/.test(r.body.error));
  // A no-show with a card.
  r = await P({ action: 'book', day, time: '20:30', size: 6, name: 'Okafor', phone: '5550005555', agree: true });
  const oka: any = await get(`${T}/tableBookings/${r.body.id}`); saveCard(oka.setupIntentId);
  await P({ action: 'card_done', id: oka.id, k: oka.token });
  await BS.bookingsOnFloor(db, T, await get(T), session, { fresh: true });
  r = await H({ action: 'booking_charge', bookingId: oka.id });
  check('a no-show can’t be charged while their table is still held', r.status === 409 && /still being held/.test(r.body.error), r.body);
  await db.doc(`${T}/tableBookings/${oka.id}`).set({ arrivesAt: new Date(Date.now() - 20 * 60000).toISOString() }, { merge: true });
  S.decline = true;
  r = await H({ action: 'booking_charge', bookingId: oka.id });
  check('a declined card: nothing charged, said plainly', r.status === 402 && /Nothing was charged/.test(r.body.error) && (await get(`${T}/tableBookings/${oka.id}`)).charge.state === 'declined' && !(await get(`${T}/transactions/tbookfee_${oka.id}`)));
  S.decline = false;
  r = await H({ action: 'booking_charge', bookingId: oka.id });
  check('a no-show past the held time: charged, the party marked as not coming', r.body.ok && r.body.amount === 120 && (await get(`${T}/parties/tb_${oka.id}`)).status === 'no_show' && (await get(`${T}/tableBookings/${oka.id}`)).status === 'no_show');
  // A no-show let go.
  r = await P({ action: 'book', day, time: '18:30', size: 2, name: 'Brooks', phone: '5550006666' });
  const bro: any = await get(`${T}/tableBookings/${r.body.id}`);
  await BS.bookingsOnFloor(db, T, await get(T), session, { fresh: true });
  r = await H({ action: 'booking_letgo', bookingId: bro.id });
  check('not while their table is still held', r.status === 409);
  await db.doc(`${T}/tableBookings/${bro.id}`).set({ arrivesAt: new Date(Date.now() - 20 * 60000).toISOString() }, { merge: true });
  r = await H({ action: 'booking_letgo', bookingId: bro.id });
  check('“Didn’t come”: marked as not coming, nothing charged', r.body.ok && (await get(`${T}/parties/tb_${bro.id}`)).status === 'no_show' && (await get(`${T}/tableBookings/${bro.id}`)).charge.state === 'waived');
  r = await H({ action: 'floor' });
  await db.doc(T).set({ stripeAccountId: null }, { merge: true });
  check('a business that can’t take cards yet: guests aren’t asked for one', ((await P({ action: 'info' })) as any).body.card === null);
  await db.doc(T).set({ stripeAccountId: 'acct_1' }, { merge: true });
  check('the host stand’s read says who can charge', r.body.ok && r.body.manager === true && Array.isArray(r.body.lateCancels));
  // Settings saved through the host stand's settings.
  r = await H({ action: 'settings', booking: { on: true, days: [4, 5, 6], first: '17:30', last: '22:00', every: 15, seats: 30, maxSize: 10, card: true, cardFrom: 8, feePerGuest: 25, cancelHours: 48 } });
  check('settings saved cleaned', r.body.ok && r.body.booking.seats === 30 && r.body.booking.every === 15 && (await get(T)).hostingSettings.booking.cardFrom === 8);

  console.log('screens');
  const page = src('src/app/table/[tenantId]/page.tsx'), mine = src('src/app/table/[tenantId]/[bookingId]/page.tsx'), host = src('src/app/(app)/host/page.tsx'), set = src('src/components/settings/HostStandSettings.tsx');
  check('booking: how many, the day, the time, anything we should know; a card for big tables, agreed first; booked', /How many/.test(page) && /Anything we should know/.test(page) && /Nothing is charged today/.test(page) && /I agree to the/.test(page) && /confirmSetup/.test(page) && /You’re booked/.test(page) && /Send an event request/.test(page));
  check('their link: calendar, running late, cancel (saying when it may be charged)', /Add to my calendar/.test(mine) && /We’re running late/.test(mine) && /Cancel the booking/.test(mine) && /may be charged/.test(mine));
  check('host stand: what they told us, the card, running late, charge or let go, late cancels', /Card on file/.test(host) && /for not coming\?/.test(host) && /Didn’t come, don’t charge/.test(host) && /Cancelled late/.test(host) && /Let it go/.test(host) && /booking_charge/.test(host));
  check('settings: off until on, the link to copy, days, times, seats, largest party, the card rule', /Online table bookings/.test(set) && /Copy link/.test(set) && /Days you take bookings/.test(set) && /Seats online bookings can fill/.test(set) && /A card to hold big tables/.test(set));
  check('a guest’s own booking link is kept out of search', /robots: \{ index: false/.test(src('src/app/table/[tenantId]/[bookingId]/layout.tsx')) && /no-referrer/.test(src('src/app/table/[tenantId]/[bookingId]/layout.tsx')));
  check('no emoji, all caps or niche words in the new screens', !/[\u{1F300}-\u{1FAFF}]/u.test(page + mine) && !/\buppercase\b|font-black/.test(page + mine) && !/\b(salon|stylist|booth|chair)\b/i.test((page + mine).replace(/high chair/gi, '')));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
