// Checks an event's guest pages work for guests who aren't signed in (launch L11):
// - The event page, the meal order page and a seat's QR code read and write through the server
//   (api/public/event), never the database from the browser.
// - A guest sees the event, places left, the menu and the seating chart's names. They never see the guest list, the
//   private PIN or the business's internal description.
// - A private event's PIN is checked on the server, and wrong tries are limited.
// - Reservations go onto the event's guest list (the manifest's), within its limit and once per email.
// - Meal orders land on the guest's own entry (by email, or the name the host added), or add them. An order already
//   made isn't replaced from the link.
// - A seat's request reaches the floor board with its table, seat and guest, on the day only, and not twice in a row.
// - The old checkout route the event page called is gone.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-events.verify.ts
import Module from 'module';
import { readFileSync, existsSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  return load.call(this, request, ...rest);
};
const read = (p: string) => readFileSync(p, 'utf8');
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const list = async (c: string, k: string, v: any) => (await db.collection(c).where(k, '==', v).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));

(async () => {
  const { POST } = await import('../../src/app/api/public/event/route');
  const L = await import('../../src/lib/event-guest-link');
  const { eventToday } = await import('../../src/lib/studio-page');
  const { addDays } = await import('../../src/lib/tenant-time');
  let ip = '10.0.0.1';
  const call = async (body: any) => { const r: any = await POST({ json: async () => body, headers: { get: (k: string) => (k === 'x-forwarded-for' ? ip : null) } } as any); return { status: r.status, ...r.body }; };

  const tenant = { name: 'Fern & Co', timezone: 'America/New_York', userId: 'owner1', subscriptionStatus: 'active', kioskSettings: { primaryColor: '#2f6f4f' } };
  await db.doc(T).set(tenant);
  const today = eventToday(tenant); const soon = addDays(today, 5);
  const chart = [{ id: 'tA', name: 'Table 1', seats: [{ id: 's1', label: 'A' }, { id: 's2', label: 'B' }] }, { id: 'tB', name: 'Table 2', seats: [{ id: 's3', label: 'A' }] }];
  await db.doc(`${T}/studioEvents/ev1`).set({ title: 'Harvest dinner', date: soon, time: '19:00', venue: 'Back garden', description: 'Internal: owner’s cousin comps', capacity: 3, status: 'upcoming', seatingTables: chart, menuNote: 'All dishes are nut-free.' });
  await db.doc(`${T}/studioEvents/ev2`).set({ title: 'Private tasting', date: addDays(today, 3), time: '18:30', venue: 'Cellar room', accessPin: '4821', status: 'upcoming' });
  await db.doc(`${T}/studioEvents/ev3`).set({ title: 'Gala', date: soon, status: 'upcoming', ticketingConfig: { type: 'paid', price: 25 } });
  await db.doc(`${T}/studioEvents/ev4`).set({ title: 'Tonight’s supper', date: today, time: '20:00', status: 'active', seatingTables: chart });
  await db.doc(`${T}/studioEvents/ev5`).set({ title: 'Cancelled thing', date: soon, status: 'cancelled' });
  await db.doc(`${T}/studioEvents/ev6`).set({ title: 'Closed orders', date: soon, status: 'upcoming', orderingDeadline: new Date(Date.now() - 3600000).toISOString() });
  for (const [id, course, name] of [['m1', 1, 'Squash soup'], ['m2', 1, 'Garden salad'], ['m3', 2, 'Seared trout'], ['m4', 2, 'Mushroom risotto']] as const)
    await db.doc(`${T}/eventMenuItems/${id}`).set({ id, eventId: 'ev1', name, courseNumber: course, pricePerGuest: 18, supplies: [{ inventoryId: 'inv1', qty: 2 }], isVegan: id === 'm4' });
  await db.doc(`${T}/eventMenuItems/m5`).set({ id: 'm5', eventId: 'ev4', name: 'Chef’s plate', courseNumber: 2 });
  await db.doc(`${T}/eventGuests/g1`).set({ id: 'g1', eventId: 'ev1', name: 'Dana Fox', email: '', tableNumber: null });
  await db.doc(`${T}/eventGuests/g2`).set({ id: 'g2', eventId: 'ev1', name: 'Lee Park', email: 'lee@example.com', mealChoiceId: 'm3', mealChoiceName: 'Seared trout' });
  await db.doc(`${T}/eventGuests/g3`).set({ id: 'g3', eventId: 'ev4', name: 'Maria Lopez', email: 'maria@example.com', tableNumber: 'Table 1', seatNumber: 'A', allergies: [{ id: 'shellfish', label: 'Shellfish', severity: 'critical' }] });

  console.log('What a guest sees');
  const l1 = await call({ action: 'load', tenantId: 't1', eventId: 'ev1' }); const j1 = JSON.stringify(l1);
  check('the event loads with its details, places left and the menu by course', l1.ok && l1.event.title === 'Harvest dinner' && l1.event.venue === 'Back garden' && l1.reserve.placesLeft === 1 && l1.order.courses.length === 2 && l1.order.courses[0].name === 'Starters' && l1.order.courses[1].items.length === 2, l1);
  check('never the guest list, the internal description, or dish costs and supplies', !/Dana|Lee Park|lee@example|Internal|pricePerGuest|inv1|supplies/.test(j1), j1);
  check('the seating chart comes as names only', JSON.stringify(l1.order.tables) === JSON.stringify([{ name: 'Table 1', seats: ['A', 'B'] }, { name: 'Table 2', seats: ['A'] }]), l1.order.tables);
  check('the business shows with its own color', l1.business.name === 'Fern & Co' && /^#/.test(l1.business.color), l1.business);
  const l404 = await call({ action: 'load', tenantId: 't1', eventId: 'nope' });
  check('an unknown event says the link may be out of date', l404.status === 404 && /out of date/.test(l404.error), l404);
  const lbad = await call({ action: 'load', tenantId: 't1/../x', eventId: 'ev1' });
  check('a malformed link is refused before anything is read', lbad.status === 400, lbad);

  console.log('A private event');
  const p0 = await call({ action: 'load', tenantId: 't1', eventId: 'ev2' });
  check('without the PIN: only its name and date, nothing else, and never the PIN', p0.ok && p0.needsPin && p0.event.title === 'Private tasting' && !p0.event.venue && !p0.order && !JSON.stringify(p0).includes('4821'), p0);
  const p1 = await call({ action: 'load', tenantId: 't1', eventId: 'ev2', pin: '1111' });
  check('a wrong PIN is told so', p1.needsPin && /isn’t right/.test(p1.pinError), p1);
  const p2 = await call({ action: 'load', tenantId: 't1', eventId: 'ev2', pin: '4821' });
  check('the right PIN opens it', p2.ok && !p2.needsPin && p2.event.venue === 'Cellar room', p2);
  const r0 = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev2', name: 'Ola Berg', email: 'ola@example.com' });
  check('reserving a private event without its PIN is refused', r0.status === 403 && r0.needsPin, r0);
  const r1 = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev2', pin: '4821', name: 'Ola Berg', email: 'ola@example.com' });
  check('with its PIN, the place is saved', r1.ok && (await list(`${T}/eventGuests`, 'eventId', 'ev2')).length === 1, r1);
  ip = '10.0.0.66';
  for (let i = 0; i < 12; i++) await call({ action: 'load', tenantId: 't1', eventId: 'ev2', pin: String(1000 + i) });
  const p3 = await call({ action: 'load', tenantId: 't1', eventId: 'ev2', pin: '9999' });
  const p4 = await call({ action: 'load', tenantId: 't1', eventId: 'ev2', pin: '4821' });
  check('after a dozen wrong tries, even the right PIN waits (no guessing them all)', /Too many tries/.test(p3.pinError) && p4.needsPin && /Too many tries/.test(p4.pinError), { p3, p4 });
  ip = '10.0.0.67';
  const p5 = await call({ action: 'load', tenantId: 't1', eventId: 'ev2', pin: '4821' });
  const pinTries = async (who: string) => { const { createHash } = await import('crypto'); const h = createHash('sha256').update(`t1|ev2|${who}`).digest('hex').slice(0, 32); return Number((await get(`rateLimits/event-pin_ip_${h}_${Math.floor(Date.now() / 3600000)}`))?.count) || 0; };
  check('a right PIN gives its try back', p5.ok && (await pinTries('10.0.0.67')) === 0 && (await pinTries('10.0.0.66')) === 12, [await pinTries('10.0.0.67'), await pinTries('10.0.0.66')]);
  ip = '10.0.0.68';
  const burst = await Promise.all(Array.from({ length: 25 }, (_, i) => call({ action: 'load', tenantId: 't1', eventId: 'ev2', pin: String(2000 + i) })));
  check('a burst of guesses at once still gets no more than twelve compared', burst.filter((x) => /isn’t right/.test(x.pinError || '')).length <= 12 && burst.filter((x) => /Too many tries/.test(x.pinError || '')).length >= 13, burst.map((x) => x.pinError));
  check('another guest with the right PIN still gets in', p5.ok && !p5.needsPin, p5);
  ip = '10.0.0.1';

  console.log('Reserving a place');
  const big = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', name: 'Ana Ruiz', email: 'ana@example.com', places: 2 });
  check('never past the limit, and says how many are left', big.status === 409 && big.error === 'Only 1 place is left.', big);
  const ok1 = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', name: 'Ana Ruiz', email: 'Ana@Example.com', phone: '555-0101' });
  const ana = (await list(`${T}/eventGuests`, 'eventId', 'ev1')).find((g: any) => g.email === 'ana@example.com');
  check('the place lands on the event’s guest list, the one the manifest reads', ok1.ok && ana && ana.name === 'Ana Ruiz' && ana.source === 'event link' && ana.checkedIn === false, { ok1, ana });
  check('the event’s count is the real number on the list, and the owner is told', (await get(`${T}/studioEvents/ev1`)).rsvpCount === (await list(`${T}/eventGuests`, 'eventId', 'ev1')).length && (await list(`${T}/notifications`, 'userId', 'owner1')).some((n: any) => /Ana Ruiz reserved a place at Harvest dinner/.test(n.message)));
  const again = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', name: 'Ana R', email: 'ana@example.com' });
  const stranger = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', name: 'Kim Ode', email: 'kim.new@example.com' });
  check('the same email again is answered exactly as anyone else would be (here: full), and nothing is added', JSON.stringify(again) === JSON.stringify(stranger) && (await list(`${T}/eventGuests`, 'eventId', 'ev1')).length === 3, { again, stranger });
  const full = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', name: 'Kim Ode', email: 'kim@example.com' });
  check('a full event says so', full.status === 409 && full.error === 'This event is full.', full);
  const paid = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev3', name: 'Kim Ode', email: 'kim@example.com' });
  check('a paid event isn’t reserved free from the link', paid.status === 409 && /arranged with the business/.test(paid.error), paid);
  const canc = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev5', name: 'Kim Ode', email: 'kim@example.com' });
  check('a canceled event says so', canc.status === 409 && canc.error === 'This event has been canceled.', canc);
  const noEmail = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev3', name: 'Kim', email: 'nope' });
  check('a reservation needs a name and a real email', noEmail.status === 409 || noEmail.status === 400, noEmail);
  const before = db._store.size;
  const bot = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev2', pin: '4821', name: 'Bot', email: 'bot@example.com', ev_ref: 'http://spam' });
  check('a script filling the hidden field is answered like anyone, and nothing is written', bot.ok && db._store.size === before, bot);

  console.log('Ordering a meal');
  const o1 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Dana Fox', picks: { 1: 'm1' } });
  check('every course needs a choice', o1.status === 400 && o1.error === 'Choose your mains.', o1);
  const o2 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Dana Fox', picks: { 1: 'm3', 2: 'm4' } });
  check('a dish from another course is refused', o2.status === 400, o2);
  const o3 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Dana Fox', picks: { 1: 'm1', 2: 'm4' }, allergies: ['peanuts'] });
  check('allergies need the guest to confirm them', o3.status === 400 && /confirm/.test(o3.error), o3);
  const o4 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Dana Fox', email: 'dana@example.com', table: 'Table 1', seat: 'Z', picks: { 1: 'm1', 2: 'm4' } });
  check('a seat that isn’t on the chart is refused', o4.status === 400 && /seat/.test(o4.error), o4);
  const o5 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: '  dana   fox ', email: 'dana@example.com', table: 'Table 1', seat: 'A', picks: { 1: 'm1', 2: 'm4' }, allergies: ['peanuts', 'vegan', 'made-up'], allergyNote: 'Severe', note: 'Celebrating!', confirm: true });
  const dana = await get(`${T}/eventGuests/g1`);
  check('the order lands on the entry the host added by name', o5.ok && dana.name === 'Dana Fox' && dana.mealChoiceId === 'm1' && dana.mealChoiceName === 'Squash soup' && dana.courseSelections['1'] === 'm1' && dana.courseSelections['2'] === 'm4', { o5, dana });
  check('with what to avoid as the manifest reads it, and the table and email filled in', JSON.stringify(dana.allergies) === JSON.stringify([{ id: 'peanuts', label: 'Peanuts', severity: 'critical' }, { id: 'vegan', label: 'Vegan', severity: 'preference' }]) && dana.allergyNote === 'Severe' && dana.guestNote === 'Celebrating!' && dana.tableNumber === 'Table 1' && dana.seatNumber === 'A' && dana.email === 'dana@example.com', dana);
  check('no one new was added', (await list(`${T}/eventGuests`, 'eventId', 'ev1')).length === 3);
  const o6 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Lee Park', email: 'LEE@example.com', picks: { 1: 'm2', 2: 'm4' } });
  check('an order already made isn’t replaced from the link', o6.status === 409 && o6.already && /let your host know/.test(o6.error) && (await get(`${T}/eventGuests/g2`)).mealChoiceId === 'm3', o6);
  const o7 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Dana Fox', picks: { 1: 'm2', 2: 'm3' } });
  check('nor by someone using the same name without an email', o7.status === 409 && (await get(`${T}/eventGuests/g2`)).mealChoiceId === 'm3' && (await get(`${T}/eventGuests/g1`)).mealChoiceId === 'm1', o7);
  const o8 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Sam Rivera', email: 'sam@example.com', picks: { 1: 'm2', 2: 'm3' } });
  check('a new guest isn’t added past the limit', o8.status === 409 && /full/.test(o8.error), o8);
  const o9a = await call({ action: 'order', tenantId: 't1', eventId: 'ev4', name: 'Sam Rivera', table: 'Table 2', seat: 'A', picks: { 2: 'm5' } });
  check('a new guest needs an email', o9a.status === 400 && o9a.needEmail, o9a);
  const o9 = await call({ action: 'order', tenantId: 't1', eventId: 'ev4', name: 'Sam Rivera', email: 'sam@example.com', table: '2', seat: '1', picks: { 2: 'm5' } });
  const sam = (await list(`${T}/eventGuests`, 'eventId', 'ev4')).find((g: any) => g.name === 'Sam Rivera');
  check('a new guest is added with their order (a one-course menu is their meal)', o9.ok && sam && sam.mealChoiceId === 'm5' && sam.tableNumber === 'Table 2' && sam.seatNumber === 'A' && sam.source === 'meal order link', { o9, sam });
  const ana1 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'ana ruiz', picks: { 1: 'm2', 2: 'm3' } });
  check('someone who reserved and orders by name alone is asked for their email, not added twice', ana1.status === 400 && ana1.needEmail && /reserved with/.test(ana1.error) && (await list(`${T}/eventGuests`, 'eventId', 'ev1')).length === 3, ana1);
  const ana2 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Ana', email: 'ana@example.com', table: 'Table 1', seat: 'A', picks: { 1: 'm2', 2: 'm3' } });
  const anaRow = (await list(`${T}/eventGuests`, 'eventId', 'ev1')).find((g: any) => g.email === 'ana@example.com');
  check('with it, the order goes on their place, and a seat someone else has is left off (and they’re told)', ana2.ok && ana2.seatTaken === true && anaRow.mealChoiceId === 'm2' && anaRow.name === 'Ana Ruiz' && anaRow.tableNumber === 'Table 1' && !anaRow.seatNumber, { ana2, anaRow });
  ip = '10.0.0.90';
  const made: any[] = [];
  for (let i = 0; i < 7; i++) made.push(await call({ action: 'order', tenantId: 't1', eventId: 'ev4', name: `Guest ${i}`, email: `g${i}@example.com`, picks: { 2: 'm5' } }));
  check('at most six new guests a day from one visitor through meal orders', made.slice(0, 6).every((x) => x.ok) && made[6].status === 409 && /Too many new guests/.test(made[6].error), made[6]);
  ip = '10.0.0.1';
  const o10 = await call({ action: 'order', tenantId: 't1', eventId: 'ev6', name: 'Late Larry' });
  check('orders close at the business’s deadline', o10.status === 409 && /closed/.test(o10.error), o10);

  console.log('A seat’s QR code');
  const s0 = await call({ action: 'load', purpose: 'seat', tenantId: 't1', eventId: 'ev4', tableId: 'tA', seatId: 's1' });
  check('the seat shows its table, seat and the first name of whoever sits there, nothing more', s0.ok && s0.seat.tableName === 'Table 1' && s0.seat.seatLabel === 'A' && s0.seat.firstName === 'Maria' && s0.seat.open && !/Lopez|maria@|Shellfish/.test(JSON.stringify(s0)), s0);
  check('with the requests it can make, labels only', s0.seat.types.length === 9 && s0.seat.types.every((t: any) => Object.keys(t).join() === 'id,label,note'), s0.seat.types);
  const q1 = await call({ action: 'request', tenantId: 't1', eventId: 'ev4', tableId: 'tA', seatId: 's1', type: 'water' });
  const fr = await list(`${T}/floorRequests`, 'eventId', 'ev4');
  check('the request reaches the floor board with the table, seat and guest', q1.ok && fr.length === 1 && fr[0].tableNumber === 'Table 1' && fr[0].seatNumber === 'A' && fr[0].guestName === 'Maria Lopez' && fr[0].guestAllergies.length === 1 && fr[0].label === 'Water refill' && fr[0].status === 'new' && fr[0].source === 'guest_qr', { q1, fr });
  const q2 = await call({ action: 'request', tenantId: 't1', eventId: 'ev4', tableId: 'tA', seatId: 's1', type: 'napkins' });
  check('the same seat can’t ask again right away', q2.status === 429 && q2.waitSeconds > 0, q2);
  await db.doc(`${T}/floorRequests/${fr[0].id}`).set({ createdAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  const q3 = await call({ action: 'request', tenantId: 't1', eventId: 'ev4', tableId: 'tA', seatId: 's1', type: 'water' });
  check('nor ask twice for the same thing while someone is on the way', q3.status === 409 && /already on the way/.test(q3.error), q3);
  const q4 = await call({ action: 'request', tenantId: 't1', eventId: 'ev4', tableId: 'tB', seatId: 's3', type: 'other', note: 'Could we get a high chair?' });
  const fr2 = (await list(`${T}/floorRequests`, 'eventId', 'ev4')).find((x: any) => x.seatId === 's3');
  check('a note goes under the business’s own label, as the guest’s words', q4.ok && fr2.label === 'Something else' && fr2.requestText === 'Could we get a high chair?' && fr2.guestName === 'Sam Rivera', fr2);
  const q5 = await call({ action: 'request', tenantId: 't1', eventId: 'ev4', tableId: 'tA', seatId: 's2', type: 'champagne' });
  check('only the listed requests', q5.status === 400, q5);
  const q6 = await call({ action: 'request', tenantId: 't1', eventId: 'ev4', tableId: 'tZ', seatId: 's1', type: 'water' });
  check('a seat no longer on the chart says the code is out of date', q6.status === 404 && /out of date/.test(q6.error), q6);
  const q7 = await call({ action: 'request', tenantId: 't1', eventId: 'ev1', tableId: 'tA', seatId: 's1', type: 'water' });
  check('requests open on the day of the event only', q7.status === 409 && /day of the event/.test(q7.error), q7);

  console.log('A locked business');
  await db.doc('tenants/t2').set({ name: 'Paused Co', subscriptionStatus: 'active', accessLocked: true, timezone: 'America/New_York' });
  await db.doc('tenants/t2/studioEvents/e1').set({ title: 'Open house', date: soon, status: 'upcoming' });
  const z1 = await call({ action: 'load', tenantId: 't2', eventId: 'e1' });
  const z2 = await call({ action: 'reserve', tenantId: 't2', eventId: 'e1', name: 'Ana', email: 'ana@example.com' });
  check('its event page says it isn’t taking reservations, and none are taken', z1.ok && z1.closed && z2.status === 403 && (await list('tenants/t2/eventGuests', 'eventId', 'e1')).length === 0, { z1, z2 });

  console.log('Helpers');
  check('matching a meal order to the list', JSON.stringify([
    L.matchGuest([{ id: 'a', name: 'Jo', email: 'jo@x.com' }], 'Someone', 'JO@x.com'),
    L.matchGuest([{ id: 'a', name: 'Jo Lee', email: '' }], 'jo  lee', ''),
    L.matchGuest([{ id: 'a', name: 'Jo Lee', email: '', mealChoiceId: 'm' }], 'Jo Lee', 'other@x.com'),
    L.matchGuest([], 'New', ''),
  ]) === JSON.stringify([{ kind: 'update', id: 'a' }, { kind: 'update', id: 'a' }, { kind: 'new' }, { kind: 'new' }]));
  check('a printed code’s numbers find the chart’s own names', JSON.stringify([
    L.seatFromCode([{ name: 'Table 1', seats: ['A', 'B'] }, { name: 'Patio 2', seats: ['1', '2'] }], '1', '2'),
    L.seatFromCode([{ name: 'Table 1', seats: ['A', 'B'] }, { name: 'Patio 2', seats: ['1', '2'] }], '2', '2'),
    L.seatFromCode([{ name: 'Table 1', seats: ['A'] }], 'Bar', 'A'),
    L.seatFromCode([], '7', 'C'),
  ]) === JSON.stringify([{ table: 'Table 1', seat: 'B' }, { table: 'Patio 2', seat: '2' }, { table: '', seat: '' }, { table: '7', seat: 'C' }]));
  check('the business’s own request list wins over ours', L.requestTypesFor({}, { defaultRequestTypes: [{ id: 'tea', label: 'Tea', enabled: true }, { id: 'x', label: 'Off', enabled: false }] }).map((t) => t.id).join() === 'tea');

  console.log('Source');
  const pages = ['src/app/event/[tenantId]/[eventId]/page.tsx', 'src/app/event/[tenantId]/[eventId]/rsvp/page.tsx', 'src/app/request/[tenantId]/[eventId]/[tableId]/[seatId]/page.tsx'].map(read);
  check('the guest pages never touch the database from the browser', pages.every((s) => !/firebase\/(firestore|app)|useFirebase/.test(s)) && pages.every((s) => /askEvent\(/.test(s)));
  check('no emojis and no all-caps labels on the guest pages', pages.every((s) => !/\p{Extended_Pictographic}/u.test(s) && !/\buppercase\b/.test(s)));
  check('the old checkout route the event page called is gone', !existsSync('src/app/api/stripe/checkout/route.ts'));
  const man = read('src/app/(app)/events/[eventId]/manifest/page.tsx');
  check('the manifest shares the event page and the meal order page, and seat codes open the meal order page', /eventPageLink = .*\/event\/\$\{tenantId\}\/\$\{eventId\}/.test(man) && man.includes('const shareableLink = eventPageLink ? `${eventPageLink}/rsvp`') && man.includes('`${shareableLink}?table=${encodeURIComponent(t.name)}&seat=${encodeURIComponent(s.label)}`'));
  check('a PIN kept from earlier that no longer works is forgotten quietly', pages.slice(0, 2).every((x) => x.includes('if (r.needsPin && kept) { savePin(tenantId, eventId, \'\'); r.pinError = null; }')));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
