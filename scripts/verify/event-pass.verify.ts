// Checks the event pass (design board "The event pass", A; lib/event-pass, api/public/event 'place', api/event-night
// 'door' and 'doorIn', the guest's place page, the manifest's At the door):
// - A guest's link is their pass: their party (first names only; a guest's guests as "Ana’s guest 1"), each place's
//   seat, meal (dish names) and allergies, the entry code (its QR link to the manifest, signed, and 4 digits), and where
//   the evening is for them (before, today, in, over).
// - At the door the team finds the party by the QR (or its link pasted) or the 4 digits; a code for another event, a
//   changed one or a canceled place finds nothing; checking in marks each place once, with who and how, and the pass
//   then says they're in. Only the business's own team, signed in, and never a renter.
// - Paid tickets get a party too (worked out from the order), so the buyer's confirmation has the same pass; their
//   places still aren't changed from the link.
// - The emails point at the pass; the pages and the manifest show it; the house style holds.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/event-pass.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.LINK_SECRET = 'test-link-secret';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';
const db: any = strictTransactions(makeDb());
const mails: any[] = [];
let actor: any = { uid: 'u1', name: 'Kai Park', role: 'staff', caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, m: any) => { mails.push(m); return { ok: true }; } });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => (actor ? { actor } : { deny: { status: 401, body: { ok: false, error: 'Sign in.' } } }) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const src = (p: string) => readFileSync(p, 'utf8');
const get = async (p: string) => (await db.doc(p).get()).data() || null;

(async () => {
  const { POST } = await import('../../src/app/api/public/event/route');
  const { POST: NIGHT } = await import('../../src/app/api/event-night/route');
  const P = await import('../../src/lib/event-pass');
  const { ticketParty } = await import('../../src/lib/event-tickets');
  const { PARTY_RE, onListEmail } = await import('../../src/lib/event-places');
  const { eventToday } = await import('../../src/lib/studio-page');
  const { addDays } = await import('../../src/lib/tenant-time');
  const call = async (body: any) => { const r: any = await POST({ json: async () => body, headers: { get: (k: string) => (k === 'x-forwarded-for' ? '10.9.0.1' : null) }, nextUrl: { origin: 'https://app.test' } } as any); return { status: r.status, ...r.body }; };
  const night = async (body: any) => { const r: any = await NIGHT({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => 'Bearer x' } } as any); return { status: r.status, ...r.body }; };

  const tenant: any = { name: 'Fern & Co', timezone: 'America/New_York', userId: 'owner1', subscriptionStatus: 'active' };
  await db.doc(T).set(tenant);
  const today = eventToday(tenant); const soon = addDays(today, 5);
  await db.doc(`${T}/studioEvents/ev1`).set({ title: 'Harvest dinner', date: soon, time: '19:00', venue: 'The Loft, 212 Market St', capacity: 10, status: 'upcoming' });
  await db.doc(`${T}/studioEvents/ev2`).set({ title: 'Winter dinner', date: soon, time: '19:00', capacity: 10, status: 'upcoming' });
  await db.doc(`${T}/eventMenuItems/m1`).set({ id: 'm1', eventId: 'ev1', name: 'Pumpkin soup', courseNumber: 1 });
  await db.doc(`${T}/eventMenuItems/m2`).set({ id: 'm2', eventId: 'ev1', name: 'Seared salmon', courseNumber: 2 });

  console.log('The pass');
  let r: any = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', name: 'Ana Ruiz', email: 'ana@example.com', places: 2 });
  const guests = (await db.collection(`${T}/eventGuests`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((g: any) => g.eventId === 'ev1');
  const lead = guests.find((g: any) => g.partyLead); const other = guests.find((g: any) => !g.partyLead); const partyId = lead.partyId;
  await db.doc(`${T}/eventGuests/${lead.id}`).set({ courseSelections: { 1: 'm1', 2: 'm2' }, allergies: ['peanuts', 'gluten'], tableNumber: '3', seatNumber: '1' }, { merge: true });
  await db.doc(`${T}/eventGuests/${other.id}`).set({ tableNumber: '3', seatNumber: '2' }, { merge: true });
  const link = new URL(String(mails.find((m) => m.to === 'ana@example.com')?.text || '').match(/https:\/\/app\.test\/event\/t1\/[^\s]+/)![0]);
  const p = link.searchParams.get('p'), k = link.searchParams.get('k');
  r = await call({ action: 'place', tenantId: 't1', eventId: 'ev1', p, k });
  const list = r.party?.list || [];
  check('the pass: her party, first names only, each seat, meal by course and allergies (severe said)', r.ok && list.length === 2 && list[0].first === 'Ana' && list[0].you && list[1].first === 'Ana’s guest 1' && !list[1].you
    && list[0].seat === 'Table 3, seat 1' && list[0].meal === 'Pumpkin soup, Seared salmon' && JSON.stringify(list[0].allergies) === '["Peanuts","Gluten"]' && list[0].severe === true && list[1].meal === null && list[1].severe === false
    && r.party.line === '2 places, table 3' && r.party.paid === false && !JSON.stringify(r).includes('Ruiz') && !JSON.stringify(r).includes('ana@example.com'), r);
  const doorU = String(r.door?.url || '');
  check('…the entry code: a signed link to the event’s manifest on that party, and 4 digits only the server can work out', /^https:\/\/app\.test\/events\/ev1\/manifest\?door=p[a-f0-9]{24}\.[A-Za-z0-9_-]{32}$/.test(doorU) && doorU.includes(`door=${partyId}.`)
    && /^\d{4}$/.test(String(r.door?.digits)) && r.door.digits === P.doorDigits('t1', 'ev1', partyId) && P.doorDigits('t1', 'ev2', partyId) !== null && P.doorKey('t1', 'ev1', partyId) !== P.doorKey('t1', 'ev2', partyId), r.door);
  check('…days before the event: before, and how many days in the business’s own calendar', r.stage === 'before' && r.days === 5, [r.stage, r.days]);
  await db.doc(`${T}/eventGuests/${other.id}`).set({ name: 'Leo Grant', email: 'leo@example.com', allergies: ['shellfish'] }, { merge: true });
  const r2: any = await call({ action: 'place', tenantId: 't1', eventId: 'ev1', p, k });
  check('a member with an email of their own keeps their allergies to themselves; their first name shows', r2.party.list[1].first === 'Leo' && r2.party.list[1].allergies.length === 0 && r2.party.list[0].allergies.length === 2, r2.party.list);
  actor = { uid: 'u1', name: 'Kai Park', role: 'staff', caps: [] };
  const seen: any = await night({ action: 'door', eventId: 'ev1', scan: r.door.url });
  const leo = seen.parties?.[0]?.places.find((x: any) => x.name === 'Leo Grant');
  check('…but the door always sees every guest’s allergies, whoever told them', leo && JSON.stringify(leo.allergies) === '["Shellfish"]' && leo.severe === true, seen);
  await db.doc(`${T}/eventGuests/${other.id}`).set({ name: 'Ana Ruiz (guest 1)', email: '', allergies: [] }, { merge: true });
  check('reading a scan: the QR’s link, the code itself, 4 digits (spaces allowed); anything else is nothing', (P.readDoor(doorU) as any)?.partyId === partyId && (P.readDoor(doorU.split('door=')[1]) as any)?.partyId === partyId
    && (P.readDoor('4 8 2 1') as any)?.digits === '4821' && P.readDoor('hello') === null && P.readDoor('https://app.test/events/ev1/manifest') === null && P.readDoor(`${partyId}.short`) === null);

  console.log('At the door');
  actor = { uid: 'u1', name: 'Kai Park', role: 'staff', caps: [] };
  let d: any = await night({ action: 'door', eventId: 'ev1', scan: doorU });
  check('the team scans the QR: that party, full names as on the list, seats and allergies, nobody in yet', d.ok && d.parties.length === 1 && d.parties[0].partyId === partyId && d.parties[0].lead === 'Ana Ruiz' && d.parties[0].places.length === 2
    && d.parties[0].places[0].seat === 'Table 3, seat 1' && d.parties[0].places[0].severe === true && d.parties[0].places.every((x: any) => !x.checkedIn), d);
  d = await night({ action: 'door', eventId: 'ev1', scan: r.door.digits });
  check('…or types the 4 digits: the same party among those that match', d.ok && d.parties.some((x: any) => x.partyId === partyId), d);
  const wrongEvent = await night({ action: 'door', eventId: 'ev2', scan: doorU });
  const changed = await night({ action: 'door', eventId: 'ev1', scan: doorU.slice(0, -2) + (doorU.endsWith('AA') ? 'BB' : 'AA') });
  const junk = await night({ action: 'door', eventId: 'ev1', scan: 'nope' });
  check('a code for another event, or a changed one, finds nothing; something that isn’t a code says so', wrongEvent.status === 404 && changed.status === 404 && junk.status === 400 && /4 digits/.test(junk.error), [wrongEvent, changed, junk]);
  d = await night({ action: 'doorIn', eventId: 'ev1', partyId, guestIds: [lead.id] });
  const leadNow = await get(`${T}/eventGuests/${lead.id}`);
  check('checked in, just the one picked: marked in, when, by whom and at the door', d.ok && d.added === 1 && leadNow.checkedIn === true && !!leadNow.checkedInAt && leadNow.checkedInBy === 'Kai Park' && leadNow.checkedInHow === 'door'
    && d.party.places[0].checkedIn && !d.party.places[1].checkedIn && !(await get(`${T}/eventGuests/${other.id}`)).checkedIn, d);
  d = await night({ action: 'doorIn', eventId: 'ev1', partyId });
  const again = await night({ action: 'doorIn', eventId: 'ev1', partyId });
  check('…then the rest of the party; asked again, nobody twice', d.ok && d.added === 1 && again.ok && again.added === 0 && again.party.places.every((x: any) => x.checkedIn), [d, again]);
  r = await call({ action: 'place', tenantId: 't1', eventId: 'ev1', p, k });
  check('the pass then says they’re in', r.stage === 'in' && r.party.list.every((x: any) => x.checkedIn), r.stage);
  actor = { uid: 'r1', name: 'Rae', role: 'renter', isRenter: true };
  const renter = await night({ action: 'door', eventId: 'ev1', scan: doorU });
  actor = null;
  const nobody = await night({ action: 'door', eventId: 'ev1', scan: doorU });
  actor = { uid: 'u1', name: 'Kai Park', role: 'staff', caps: [] };
  check('only the business’s own team, signed in: never a renter or someone signed out', renter.status === 403 && nobody.status === 401, [renter.status, nobody.status]);
  await db.doc(`${T}/studioEvents/ev5`).set({ title: 'Called off', date: soon, status: 'cancelled' });
  await db.doc(`${T}/eventGuests/cx1`).set({ id: 'cx1', eventId: 'ev5', name: 'Cy', partyId: 'p' + 'c'.repeat(24), partyLead: true, checkedIn: false });
  const off = await night({ action: 'doorIn', eventId: 'ev5', partyId: 'p' + 'c'.repeat(24) });
  check('a canceled event checks nobody in', off.status === 409 && !(await get(`${T}/eventGuests/cx1`)).checkedIn, off);
  const bad = await night({ action: 'doorIn', eventId: 'ev1', partyId: 'nope' });
  const gonePid = 'p' + 'a'.repeat(24);
  const gone = await night({ action: 'doorIn', eventId: 'ev1', partyId: gonePid });
  check('a party that isn’t right, or isn’t on the list, checks nobody in', bad.status === 400 && gone.status === 404, [bad, gone]);

  console.log('On the day, and paid tickets');
  await db.doc(`${T}/studioEvents/ev4`).set({ title: 'Gala', date: today, time: '18:30', capacity: 20, status: 'upcoming', ticketingConfig: { type: 'paid', price: 40 } });
  const tp = ticketParty('ord1');
  check('a paid order’s party is worked out from the order: the same every time, the right shape', tp === ticketParty('ord1') && tp !== ticketParty('ord2') && PARTY_RE.test(tp));
  await db.doc(`${T}/eventGuests/tg1`).set({ id: 'tg1', eventId: 'ev4', name: 'Bo Chen', email: 'bo@example.com', source: 'ticket', ticketOrderId: 'ord1', partyId: tp, partyLead: true, checkedIn: false, tableNumber: '2', seatNumber: '4' });
  await db.doc(`${T}/eventGuests/tg2`).set({ id: 'tg2', eventId: 'ev4', name: 'Bo Chen (guest 1)', email: '', source: 'ticket', ticketOrderId: 'ord1', partyId: tp, partyLead: false, checkedIn: false });
  const { placeKey } = await import('../../src/lib/event-places');
  r = await call({ action: 'place', tenantId: 't1', eventId: 'ev4', p: tp, k: placeKey('t1', 'ev4', tp) });
  check('a ticket buyer’s pass: paid, on the day the code comes first, places not changed from the link', r.ok && r.party.paid === true && r.stage === 'today' && /business/.test(String(r.block)) && r.party.list[1].first === 'Bo’s guest 1' && !!r.door?.url, r);
  const tix = src('src/lib/event-tickets.ts');
  check('…its guests are made with that party, and the confirmation carries the pass', /partyId: ticketParty\(orderId\), partyLead: i === 0/.test(tix) && /placeUrl\(t, null, tenantId, String\(o\.eventId\), ticketParty\(String\(o\.id\)\)\)/.test(tix)
    && /Your pass, with the code to show at the door: \$\{pass\}/.test(tix));

  console.log('On the night');
  const nightIn: any = { show: [{ id: 'a', at: '18:30', what: 'Doors', course: null }, { id: 'b', at: '19:15', what: 'Soup', course: 1 }, { id: 'c', at: '19:55', what: 'Mains', course: 2 }, { id: 'd', at: '20:45', what: 'Dessert', course: 3 }],
    state: { states: { a: 'done', b: 'done', c: 'next', d: 'later' }, next: { id: 'c', at: '19:55', what: 'Mains', course: 2 } }, courses: [{ n: 1, name: 'Starters' }, { n: 2, name: 'Mains' }, { n: 3, name: 'Desserts' }], fired: [1] };
  const nmenu = [{ id: 's1', name: 'Pumpkin soup', courseNumber: 1 }, { id: 'm1', name: 'Seared salmon', courseNumber: 2 }, { id: 'm2', name: 'Risotto', courseNumber: 2 }];
  const nparty = [{ id: 'x1', courseSelections: { 1: 's1', 2: 'm1' } }, { id: 'x2', courseSelections: { 1: 's1', 2: 'm2' } }];
  const clockW = (hm: string) => (hm === '19:55' ? '7:55 pm' : hm);
  let pn = P.passNight(nightIn, nparty, [{ courseNumber: 1, status: 'served', menuItemName: 'Pumpkin soup' }, { courseNumber: 1, status: 'ready', menuItemName: 'Pumpkin soup' }], nmenu, [], clockW);
  check('where the evening is: now the last thing done, next with its time', pn.now === 'Soup' && pn.next?.what === 'Mains' && pn.next?.at === '7:55 pm', pn);
  check('…their courses from the kitchen: the least far along (one plate on its way), dishes counted; the next course later with its time; one they have nothing in isn’t shown',
    pn.courses.length === 2 && pn.courses[0].state === 'on_way' && JSON.stringify(pn.courses[0].dishes) === '["Pumpkin soup ×2"]' && pn.courses[1].state === 'later' && pn.courses[1].at === '7:55 pm'
    && JSON.stringify(pn.courses[1].dishes) === '["Seared salmon","Risotto"]' && pn.courses[0].name === 'Soup', pn.courses);
  pn = P.passNight(nightIn, nparty, [{ courseNumber: 1, status: 'served' }, { courseNumber: 1, status: 'delivered' }, { courseNumber: 1, status: 'cancelled' }], nmenu, [], clockW);
  check('…served once every plate is (a canceled one aside)', pn.courses[0].state === 'served', pn.courses[0]);
  check('a plate: being made, on its way once ready or carried, served once there', P.plateState({ status: 'pending' }) === 'making' && P.plateState({ status: 'in_progress' }) === 'making' && P.plateState({ status: 'ready' }) === 'on_way'
    && P.plateState({ status: 'pending', carriedAt: 'x' }) === 'on_way' && P.plateState({ status: 'served' }) === 'served' && P.plateState({ status: 'cancelled' }) === null);

  const nowIso = new Date().toISOString(); const leadW = { first: 'Ana', table: '3', seat: '1' };
  let a1: any = await P.askAtEvent(db, 't1', 'ev9', partyId, 'water', leadW, nowIso);
  let a2: any = await P.askAtEvent(db, 't1', 'ev9', partyId, 'water', leadW, nowIso);
  const a3: any = await P.askAtEvent(db, 't1', 'ev9', partyId, 'help', leadW, nowIso);
  const a4: any = await P.askAtEvent(db, 't1', 'ev9', partyId, 'cake', leadW, nowIso);
  check('asking: water once (a second tap is the same ask), someone to help apart, nothing else', a1.ok && !a1.again && a2.ok && a2.again && a2.ask.id === a1.ask.id && a3.ok && a3.ask.id !== a1.ask.id && !a4.ok && a4.status === 400);
  check('…kept server-side, for the team: table, seat and party', !!(await get(`${T}/private/eventAsks_ev9`))?.asks?.length && P.askTextAtEvent(a1.ask) === 'Table 3, seat 1 would like water (Ana’s party).'
    && P.askTextAtEvent({ what: 'help', table: null, seat: null, party: 'Ana' }) === 'Ana’s party is asking for someone to help.');
  check('…what the guest sees: sent, then who has it (a first name)', P.askSaidAtEvent({ what: 'water', seenBy: null }) === 'We let the team know you’d like water.' && P.askSaidAtEvent({ what: 'water', seenBy: 'Kai' }) === 'Water is on its way. Kai has it.'
    && P.askSaidAtEvent({ what: 'help', seenBy: 'Kai' }) === 'Kai is coming over.');
  check('someone on the team takes it: their first name, once', await P.seeAsk(db, 't1', 'ev9', a1.ask.id, 'Kai Park', nowIso) && (await P.eventAsks(db, 't1', 'ev9')).find((x) => x.id === a1.ask.id)?.seenBy === 'Kai'
    && await P.seeAsk(db, 't1', 'ev9', a1.ask.id, 'Lee Moss', nowIso) && (await P.eventAsks(db, 't1', 'ev9')).find((x) => x.id === a1.ask.id)?.seenBy === 'Kai' && !(await P.seeAsk(db, 't1', 'ev9', 'zzzz9999', 'Kai', nowIso)));
  a2 = await P.askAtEvent(db, 't1', 'ev9', partyId, 'water', leadW, nowIso);
  check('…after which water can be asked for again', a2.ok && !a2.again && a2.ask.id !== a1.ask.id);
  for (let i = 0; i < 12; i++) { const x: any = await P.askAtEvent(db, 't1', 'ev9', partyId, 'water', leadW, nowIso); if (x.ok) await P.seeAsk(db, 't1', 'ev9', x.ask.id, 'Kai', nowIso); }
  const capped: any = await P.askAtEvent(db, 't1', 'ev9', partyId, 'water', leadW, nowIso);
  check('…a party asks a dozen times an hour at most (answered ones in the last hour count)', !capped.ok && capped.status === 429, capped);
  const later = new Date(Date.now() + 2 * 3600000).toISOString();
  const after: any = await P.askAtEvent(db, 't1', 'ev9', partyId, 'water', leadW, later, today);
  check('…and can ask again an hour later; each ask’s id random and the right shape; the asks marked with the event’s day for the sweep', after.ok && !after.again && /^[a-f0-9]{12}$/.test(after.ask.id)
    && (await get(`${T}/private/eventAsks_ev9`))?.kind === 'eventAsks' && (await get(`${T}/private/eventAsks_ev9`))?.eventDate === today, after);
  await db.doc(`${T}/private/eventAsks_old1`).set({ kind: 'eventAsks', eventId: 'old1', eventDate: addDays(today, -3), asks: [{ id: 'aaaa1111', what: 'water' }] });
  await db.doc(`${T}/private/eventAsks_new1`).set({ kind: 'eventAsks', eventId: 'new1', eventDate: addDays(today, -1), asks: [] });
  const cleared = await P.clearOldAsks(db, 't1', today);
  check('the sweep clears asks of events more than two days past (guests’ names and tables aren’t kept)', cleared >= 1 && !(await get(`${T}/private/eventAsks_old1`)) && !!(await get(`${T}/private/eventAsks_new1`)) && !!(await get(`${T}/private/eventAsks_ev9`))
    && /m\.clearOldAsks\(db, tenantId, today\)/.test(src('src/lib/event-places.ts')), cleared);

  // The pass on the night, through the route: an event today, the party in, a course fired with a plate on its way.
  await db.doc(`${T}/studioEvents/ev6`).set({ title: 'Supper club', date: today, time: '18:30', capacity: 20, status: 'upcoming' });
  await db.doc(`${T}/eventMenuItems/sm1`).set({ id: 'sm1', eventId: 'ev6', name: 'Pumpkin soup', courseNumber: 1 });
  await db.doc(`${T}/eventMenuItems/sm2`).set({ id: 'sm2', eventId: 'ev6', name: 'Seared salmon', courseNumber: 2 });
  const np = 'p' + 'd'.repeat(24);
  await db.doc(`${T}/eventGuests/ng1`).set({ id: 'ng1', eventId: 'ev6', name: 'Mo Diaz', partyId: np, partyLead: true, checkedIn: true, tableNumber: '5', seatNumber: '2', courseSelections: { 1: 'sm1', 2: 'sm2' } });
  await db.doc(`${T}/courseFires/cf1`).set({ id: 'cf1', eventId: 'ev6', courseNumber: 1, status: 'fired', firedAt: nowIso });
  await db.doc(`${T}/kdsTickets/kt1`).set({ id: 'kt1', eventId: 'ev6', source: 'event', guestId: 'ng1', courseNumber: 1, menuItemName: 'Pumpkin soup', status: 'ready' });
  await db.doc(`${T}/kdsTickets/kt2`).set({ id: 'kt2', eventId: 'ev6', source: 'event', guestId: 'other', courseNumber: 1, menuItemName: 'Pumpkin soup', status: 'served' });
  r = await call({ action: 'place', tenantId: 't1', eventId: 'ev6', p: np, k: placeKey('t1', 'ev6', np) });
  check('the pass on the night: they’re in, now and next, their course on its way (only their own plates), the next one later', r.ok && r.stage === 'in' && !!r.night && r.night.courses[0]?.state === 'on_way' && r.night.courses[0]?.dishes[0] === 'Pumpkin soup'
    && r.night.courses[1]?.state === 'later' && Array.isArray(r.night.asks), r.night);
  let ra: any = await call({ action: 'ask', tenantId: 't1', eventId: 'ev6', p: np, k: placeKey('t1', 'ev6', np), what: 'water' });
  const early = await call({ action: 'ask', tenantId: 't1', eventId: 'ev1', p, k, what: 'water' });
  const wrongK = await call({ action: 'ask', tenantId: 't1', eventId: 'ev6', p: np, k: placeKey('t1', 'ev1', np), what: 'water' });
  check('asking from the pass: on the night only, with the pass’s own link', ra.ok && ra.said === 'We let the team know you’d like water.' && early.status === 409 && wrongK.status === 404, [ra, early.status, wrongK.status]);
  actor = { uid: 'u1', name: 'Kai Park', role: 'staff', caps: [] };
  const seenAsks: any = await night({ action: 'asks', eventId: 'ev6' });
  const take: any = await night({ action: 'askSeen', eventId: 'ev6', askId: seenAsks.asks?.[0]?.id });
  r = await call({ action: 'place', tenantId: 't1', eventId: 'ev6', p: np, k: placeKey('t1', 'ev6', np) });
  check('the team sees it on the manifest (table, seat, party) and takes it; the pass then says who has it', seenAsks.ok && seenAsks.asks[0].text === 'Table 5, seat 2 would like water (Mo’s party).' && take.ok && take.asks[0].seenBy === 'Kai'
    && r.night.asks[0].said === 'Water is on its way. Kai has it.' && r.night.asks[0].open === false, [seenAsks, r.night?.asks]);
  actor = { uid: 'r1', name: 'Rae', role: 'renter', isRenter: true };
  const rAsks = await night({ action: 'asks', eventId: 'ev6' });
  actor = { uid: 'u1', name: 'Kai Park', role: 'staff', caps: [] };
  check('…never a renter', rAsks.status === 403);

  console.log('Emails and pages');
  mails.length = 0;
  await onListEmail(db, 't1', tenant, { title: 'Harvest dinner', date: soon }, 'ev1', null, { name: 'Cy Ode', email: 'cy@example.com', places: 2, partyId: 'p' + 'b'.repeat(24), how: 'reserved' }, false);
  check('the confirmation points at the pass, with the code for the door', /Open your pass: https:\/\/app\.test\/event\/t1\/ev1\/place\?p=/.test(String(mails[0]?.text)) && /code to show at the door for all of you/.test(String(mails[0]?.text)), mails[0]?.text);
  const places = src('src/lib/event-places.ts');
  check('…and so does the reminder, for paid tickets too (changing places only where allowed)', /const link = g\.partyId \? placeUrl\(tenant, null, tenantId, e\.id, g\.partyId\) : null; const canChange = !placeChangeBlock\(ev, today\);/.test(places) && /cta: link \? \{ label: 'Open your pass', url: link \}/.test(places));
  const page = src('src/app/event/[tenantId]/[eventId]/place/page.tsx');
  check('the pass page: the code (bigger on the day), the party with meals and allergies, a meal link to send, getting there', /<EntryCode url=\{d\.door\?\.url \|\| null\} digits=\{d\.door\?\.digits \|\| null\} big=\{stage === 'today'\}/.test(page) && /QRCode\.toDataURL\(url/.test(page)
    && /Send \$\{x\.first\} their meal link/.test(page) && /navigator\.share/.test(page) && /The kitchen has it\./.test(page) && /google\.com\/maps\/search\/\?api=1&query=/.test(page) && /You’re in, \$\{party\.firstName\}/.test(page) && /they can show this same code/.test(page));
  check('the pass on the night: Tonight (now, next, courses, Need something?) once in, under the code before; it keeps itself up to date', /stage === 'in' && <Tonight night=\{d\.night\}/.test(page) && /stage === 'today' && <Tonight night=\{d\.night\}/.test(page)
    && /Your table’s courses/.test(page) && /Need something\?/.test(page) && /setInterval\(tick, 60000\)/.test(page) && /if \(r\.ok && r\.party\) setD\(r\)/.test(page) && /action: 'ask', tenantId, eventId, p: q\.p, k: q\.k, what/.test(page));
  const asksUi = src('src/components/events/GuestAsks.tsx');
  check('the manifest: guests asking, newest first, On it, kept up to date', /<GuestAsks tenantId=\{tenantId\} eventId=\{eventId\} \/>/.test(src('src/app/(app)/events/[eventId]/manifest/page.tsx')) && /action: 'askSeen', askId: a\.id/.test(asksUi) && /setInterval\(tick, 20000\)/.test(asksUi) && />On it</.test(asksUi));
  const route = src('src/app/api/public/event/route.ts');
  check('the room’s passes keep up over one connection: a pass’s reads and asks count against the pass (after its signature), anything else as before; the night’s tickets read once for the room',
    /const PASS_LIMITS: Record<string, number> = \{ place: 300, ask: 30 \};/.test(route) && /\? await limitByKey\(`event-pass-\$\{action\}`, pass, PASS_LIMITS\[action\]\) : await limitPublic\(/.test(route)
    && /placeKeyOk\(tenantId, eventId, String\(b\.p \|\| ''\), b\.k\) \?/.test(route) && /place: \{ perHour: 300, perDay: 5000 \}/.test(route) && /ticketsOf\(db, T, eventId\)/.test(route) && /\.select\('eventId', 'guestId', 'courseNumber', 'status', 'carriedAt', 'menuItemName'\)\.limit\(TICKETS_MAX\)/.test(route) && /Date\.now\(\) - hit\.at < 15000/.test(route));
  check('…and the team’s list reads out only what’s new', /if \(novel\.length\) \{ const say = [^\n]*setFresh\(''\); setTimeout\(\(\) => setFresh\(say\), 60\); \}/.test(asksUi) && !/aria-live="polite"/.test(asksUi));
  const man = src('src/app/(app)/events/[eventId]/manifest/page.tsx'); const door = src('src/components/events/DoorScan.tsx');
  check('the manifest: At the door, with the camera, the 4 digits, and a phone’s own camera opening it on the party', /<DoorScan tenantId=\{tenantId\} eventId=\{eventId\} \/>/.test(man) && /<QRScanner onScan=/.test(door) && /inputMode="numeric"/.test(door)
    && /q\.get\('door'\)/.test(door) && /action: 'doorIn'/.test(door) && /parties have those digits/.test(door) && /await auth\.authStateReady\?\.\(\)/.test(door) && /if \(done\) drop\(\); else setTimeout\(/.test(door));
  const lib = src('src/lib/event-pass.ts');
  check('…a scan reads only its own party; typed digits read the event’s parties at most once a minute', /if \('partyId' in r\) ids = \[r\.partyId\];/.test(lib) && /where\('partyId', '==', partyId\)/.test(lib) && /nowMs - c\.at > 60000/.test(lib));
  const fresh = [door, asksUi, src('src/lib/event-pass.ts'), page.slice(page.indexOf('function stagePill'))].join('\n');
  check('the house style: no all caps, heaviest weight, middle dots, calling or contacting; 44px taps', !/\buppercase\b|font-black| · |call us|contact us/i.test(fresh) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(door + page + asksUi));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
