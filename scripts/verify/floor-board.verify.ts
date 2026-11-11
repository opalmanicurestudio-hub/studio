// Checks the floor board (L19): app/floor, api/floor, lib/screen-keys.
// - It works on a tablet nobody is signed in on, with the kitchen screen's own set-up (one tablet set up opens both): a
//   wrong, another business's or stopped key is refused; no key works only for a team member signed in on their own
//   device (never a renter or someone switched off); a paused business has it closed.
// - The board is tonight's event (the one running, or today's next): its tables, who's at each seat and whether they're
//   here, allergies (how serious), what the seats asked for (open, and done in the last 90 minutes; other events' never),
//   flagged and access requests first then oldest, the kitchen's ready plates for this event only, and who looks after
//   each table (the seating chart's own and whoever picked it tonight). Nothing private about a guest (email, phone).
// - Each step on a request happens once ("On my way" twice, or "Done" twice, changes nothing), under the name of whoever
//   entered their PIN, or the screen's own name; a pass for someone taken off the team names nobody, and the screen is
//   told. Picking tables needs a PIN. Marking a guest here, or not, is kept with who did it.
// - The page reads and acts only through the server (no database in the browser), and keeps the writing rules.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/floor-board.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

let db: any = strictTransactions(makeDb());
let manager = true;
let signedIn = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (!signedIn ? { deny: { status: 401, body: { ok: false, error: 'Please sign in again.' } } }
      : level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/floor/route');
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC' });
  await db.doc('tenants/t2').set({ name: 'Other place', timezone: 'UTC' });

  console.log('setting the tablet up');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Floor', kind: 'floor' }))).body.key;
  check('a floor tablet doesn’t move the lounge’s orders to a kitchen screen nobody watches', !(await get(T)).kitchenSettings?.loungeOrdersMadeBy && (await get(`kitchenScreens/${createHash('sha256').update(key).digest('hex')}`))?.kind === 'floor');
  manager = false;   // the manager signs out: the board keeps working on its key
  let r: any = await POST(req({ action: 'board', tenantId: 't1', key }));
  check('a tablet set up once opens the floor board on its own key, named for the screen', r.status === 200 && r.body.ok && r.body.screen === 'Floor' && r.body.business?.name === 'North Loft', r.body);
  r = await POST(req({ action: 'board', tenantId: 't2', key }));
  check('…only for its own business', r.status === 401);
  r = await POST(req({ action: 'board', tenantId: 't1', key: 'f'.repeat(64) }));
  check('…a wrong key is refused', r.status === 401);
  signedIn = false;
  r = await POST(req({ action: 'board', tenantId: 't1' }));
  check('…and no key, with nobody signed in', r.status === 401);
  signedIn = true;
  r = await POST(req({ action: 'board', tenantId: 't1' }));
  check('a team member signed in on their own device needs no key', r.status === 200 && r.body.ok && r.body.staff?.name === 'Ana Ruiz', r.body);
  actor.isRenter = true;
  r = await POST(req({ action: 'board', tenantId: 't1' }));
  actor.isRenter = false;
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', isActive: false });
  const off: any = await POST(req({ action: 'board', tenantId: 't1' }));
  await db.doc(`${T}/staff/m1`).set({ isActive: true }, { merge: true });
  check('…never a renter, nor someone switched off', r.status === 403 && off.status === 403, [r.body, off.body]);

  console.log('a quiet day');
  await db.doc(`${T}/floorRequests/lounge1`).set({ id: 'lounge1', requestType: 'water', type: 'water', label: 'Water', status: 'new', createdAt: iso(2), tableNumber: 'Station 2', guestName: 'Maya Lin', source: 'lounge' });
  r = await POST(req({ action: 'board', tenantId: 't1', key }));
  check('no event today: no tables, and the lounge’s own requests still show', r.body.event === null && r.body.tables.length === 0 && r.body.requests.length === 1 && r.body.requests[0].id === 'lounge1' && r.body.requests[0].tableId === null, r.body);

  console.log('tonight’s event');
  // The business's own day, the same way the board works it out (the test runs at any hour, in any zone).
  const { eventToday } = await import('../../src/lib/studio-page');
  const tenantNow: any = await get(T);
  const today = eventToday(tenantNow); const yesterday = eventToday(tenantNow, new Date(Date.now() - 86400000));
  await db.doc(`${T}/studioEvents/later`).set({ title: 'Brunch club', date: today, time: '23:59', status: 'scheduled' });
  await db.doc(`${T}/studioEvents/stale`).set({ title: 'Left running', date: '2025-01-04', status: 'active' });
  await db.doc(`${T}/studioEvents/lastnight`).set({ title: 'Last night', date: yesterday, time: '18:00', endTime: '23:00', status: 'active' });
  r = await POST(req({ action: 'board', tenantId: 't1', key }));
  check('today’s next event when none is running (one left “running” from last night, or days ago, doesn’t count)', r.body.event?.id === 'later' && r.body.event.running === false, r.body.event);
  await db.doc(`${T}/studioEvents/e1`).set({
    title: 'Spring dinner', date: today, time: '19:00', status: 'active', broadcastMessage: 'Second course in five minutes', broadcastSentAt: iso(1),
    seatingTables: [
      { id: 'ta', name: 'Oak', x: 20, y: 30, staffIds: ['s7'], seats: [{ id: 'a1', label: '1' }, { id: 'a2', label: '2' }] },
      { id: 'tb', name: 'Elm', x: 60, y: 30, seats: [{ id: 'b1', label: '1' }, { id: 'b2', label: '2' }] },
      { id: 'tc', name: 'Ash', x: 40, y: 70, seats: [{ id: 'c1', label: '1' }] },
    ],
  });
  await db.doc(`${T}/studioEvents/e2`).set({ title: 'Other night', date: '2030-01-01', status: 'scheduled' });
  await db.doc(`${T}/staff/s7`).set({ name: 'Rosa Diaz', role: 'staff', pin: '7777' });
  await db.doc(`${T}/staff/s9`).set({ name: 'Kai Park', role: 'staff', pin: '4821' });
  await db.doc(`${T}/staff/old`).set({ name: 'Gone Person', status: 'archived' });
  await db.doc(`${T}/staff/rent`).set({ name: 'Renter Person', role: 'renter' });
  await db.doc(`${T}/eventGuests/g1`).set({ eventId: 'e1', name: 'June Park', email: 'june@mail.test', phone: '+15550001111', tableNumber: 'Oak', seatNumber: '1', checkedIn: true, mealChoiceName: 'Risotto', allergies: [{ label: 'Peanuts', severity: 'critical' }] });
  await db.doc(`${T}/eventGuests/g2`).set({ eventId: 'e1', name: 'Theo Grant', email: 'theo@mail.test', tableNumber: 'Oak', seatNumber: '2', checkedIn: false, allergies: ['Gluten'], allergyNote: 'Celiac, please check the bread' });
  await db.doc(`${T}/eventGuests/g3`).set({ eventId: 'e1', name: 'Ines Mora', tableNumber: 'Elm', seatNumber: '1', checkedIn: false });
  await db.doc(`${T}/eventGuests/gx`).set({ eventId: 'e2', name: 'Someone Else', tableNumber: 'Oak', seatNumber: '1' });
  const fr = (id: string, extra: any) => db.doc(`${T}/floorRequests/${id}`).set({ id, eventId: 'e1', tableId: 'ta', tableNumber: 'Oak', seatId: 'a1', seatNumber: '1', requestType: 'water', label: 'Water', status: 'new', source: 'guest_qr', ...extra });
  await fr('q-old', { createdAt: iso(9), guestName: 'June Park', guestAllergies: [{ label: 'Peanuts', severity: 'critical' }] });
  await fr('q-new', { createdAt: iso(1), tableId: 'tb', tableNumber: 'Elm', seatId: 'b1', seatNumber: '1', requestText: 'and a straw' });
  await fr('q-access', { createdAt: iso(2), requestType: 'accessibility', type: 'accessibility', label: 'A hand getting about' });
  await fr('q-flag', { createdAt: iso(0), escalated: true });
  await fr('q-ack', { createdAt: iso(4), status: 'acknowledged', acknowledgedBy: 'Rosa Diaz', claimedByName: 'Rosa Diaz' });
  await fr('q-done', { createdAt: iso(30), status: 'done', resolvedAt: iso(20), resolvedBy: 'Kai Park' });
  await fr('q-long', { createdAt: iso(200), status: 'done', resolvedAt: iso(180), resolvedBy: 'Kai Park' });
  await fr('q-other', { eventId: 'e2', createdAt: iso(3) });
  await fr('q-ancient', { createdAt: iso(60 * 40) });
  await fr('q-noone', { createdAt: iso(1.5), tableId: 'tc', tableNumber: 'Ash', seatId: 'c1', seatNumber: '1' });
  await db.doc(`${T}/eventGuests/g4`).set({ eventId: 'e1', name: 'Walk In', tableNumber: null, checkedIn: false });
  await db.doc(`${T}/kdsTickets/k1`).set({ id: 'k1', source: 'event', eventId: 'e1', eventTitle: 'Spring dinner', courseNumber: 1, guestName: 'June Park', menuItemName: 'Soup', tableNumber: 'Oak', seatNumber: '1', status: 'ready', readyAt: iso(1), createdAt: iso(12), allergies: [{ label: 'Peanuts', severity: 'critical' }] });
  await db.doc(`${T}/kdsTickets/k2`).set({ id: 'k2', source: 'event', eventId: 'e1', guestName: 'Ines Mora', menuItemName: 'Soup', tableNumber: 'Elm', seatNumber: '1', status: 'pending', createdAt: iso(12) });
  await db.doc(`${T}/kdsTickets/k3`).set({ id: 'k3', source: 'event', eventId: 'e2', guestName: 'Someone Else', menuItemName: 'Soup', status: 'ready', readyAt: iso(1), createdAt: iso(12) });
  await db.doc(`${T}/kdsTickets/k4`).set({ id: 'k4', source: 'tab', guestName: 'Table 9', menuItemName: 'Fries', status: 'ready', readyAt: iso(1), createdAt: iso(5) });
  await db.doc(`${T}/studioEvents/e1/staffAssignments/s9`).set({ tableIds: ['tb'], staffId: 's9', staffName: 'Kai Park' });

  r = await POST(req({ action: 'board', tenantId: 't1', key }));
  const B = r.body;
  check('the event running wins over today’s next one, with its message for the team', B.event?.id === 'e1' && B.event.running === true && B.event.title === 'Spring dinner' && B.event.message?.text === 'Second course in five minutes', B.event);
  check('its tables, with their seats and where they sit on the map', B.tables.length === 3 && B.tables[0].name === 'Oak' && B.tables[0].x === 20 && B.tables[0].seats.length === 2 && B.tables[0].seats[0].label === '1', B.tables);
  check('…looked after by the seating chart’s own and whoever picked a table tonight', B.tables[0].staffIds.join() === 's7' && B.tables[1].staffIds.join() === 's9' && B.tables[2].staffIds.length === 0 && B.tables[1].chartStaffIds.length === 0, B.tables.map((t: any) => t.staffIds));
  const g1 = B.guests.find((g: any) => g.id === 'g1'), g2 = B.guests.find((g: any) => g.id === 'g2');
  check('this event’s guests only, each placed at their table and seat, here or not', B.guests.length === 4 && g1.tableId === 'ta' && B.guests.find((g: any) => g.id === 'g4').tableId === null && g1.seat === '1' && g1.here === true && g2.here === false && B.guests.find((g: any) => g.id === 'g3').tableId === 'tb', B.guests);
  check('…with their meal and allergies, and how serious', g1.meal === 'Risotto' && g1.allergies[0].label === 'Peanuts' && g1.allergies[0].severe === true && g2.allergies[0].label === 'Gluten' && !g2.allergies[0].severe && g2.note === 'Celiac, please check the bread', [g1, g2]);
  check('…and nothing private about them (no email, no phone)', !/june@mail|theo@mail|5550001111/.test(JSON.stringify(B)));
  const ids = B.requests.map((x: any) => x.id);
  check('requests: flagged first, then a hand getting about, then urgent, then oldest; the last 90 minutes of done; never another event’s, nor one left open from another day', ids.join() === 'q-flag,q-access,q-old,q-noone,q-ack,lounge1,q-new,q-done', ids);
  const U = (id: string) => B.requests.find((x: any) => x.id === id).urgent;
  check('…urgent: waited too long, or at a table nobody looks after; not one someone is on, nor one with no table', U('q-old') && U('q-noone') && U('q-flag') && !U('q-new') && !U('q-ack') && !U('lounge1') && !U('q-done'));
  const qOld = B.requests.find((x: any) => x.id === 'q-old'), qNew = B.requests.find((x: any) => x.id === 'q-new');
  check('…each with its table, seat, guest, allergies and the guest’s own words', qOld.tableId === 'ta' && qOld.seat === '1' && qOld.guest === 'June Park' && qOld.allergies[0].severe && qNew.tableId === 'tb' && qNew.note === 'and a straw', [qOld, qNew]);
  check('…who’s on the way, and who finished one', B.requests.find((x: any) => x.id === 'q-ack').by === 'Rosa Diaz' && B.requests.find((x: any) => x.id === 'q-done').resolvedBy === 'Kai Park');
  check('ready to run: this event’s ready plates only, placed at their table', B.ready.length === 1 && B.ready[0].id === 'k1' && B.ready[0].tableId === 'ta' && B.ready[0].col === 'kdsTickets', B.ready);
  check('the team by name, without anyone archived or renting', B.team.map((s: any) => s.name).sort().join() === ['Kai Park', 'Rosa Diaz'].join() || B.team.map((s: any) => s.name).sort().join() === ['Ana Ruiz', 'Kai Park', 'Rosa Diaz'].join(), B.team);
  check('no PIN or pass ever leaves the server', !/7777|4821|passes/.test(JSON.stringify(B)));

  console.log('who’s working');
  const pass = (await kitchen(req({ action: 'pin', tenantId: 't1', key, pin: '4821' }))).body.pass;
  r = await POST(req({ action: 'board', tenantId: 't1', key, staffPass: pass }));
  check('a PIN on the tablet: the board knows who, and which tables they picked', r.body.staff?.name === 'Kai Park' && r.body.staffOk === true && r.body.mine.join() === 'tb', r.body.staff);
  const rosaPass = (await kitchen(req({ action: 'pin', tenantId: 't1', key, pin: '7777' }))).body.pass;
  r = await POST(req({ action: 'board', tenantId: 't1', key, staffPass: rosaPass }));
  check('…and the tables the seating chart gives them are theirs too', r.body.mine.join() === 'ta', r.body.mine);
  r = await POST(req({ action: 'board', tenantId: 't1', key, staffPass: 'a'.repeat(48) }));
  check('…a pass the server never gave names nobody, and the tablet is told', r.body.ok && r.body.staff === null && r.body.staffOk === false && r.body.mine.length === 0);

  console.log('answering a request');
  r = await POST(req({ action: 'request', tenantId: 't1', key, staffPass: pass, id: 'q-old', step: 'ack' }));
  let q = await get(`${T}/floorRequests/q-old`);
  check('“On my way” under the name of whoever entered their PIN', r.body.ok && q.status === 'acknowledged' && q.acknowledgedBy === 'Kai Park' && q.claimedBy === 's9' && !!q.acknowledgedAt, q);
  const rosa = (await kitchen(req({ action: 'pin', tenantId: 't1', key, pin: '7777' }))).body.pass;
  r = await POST(req({ action: 'request', tenantId: 't1', key, staffPass: rosa, id: 'q-old', step: 'ack' }));
  check('…a second “On my way” (another tablet, a double tap) changes nothing, and says who has it', r.body.already === true && r.body.who === 'Kai Park' && (await get(`${T}/floorRequests/q-old`)).acknowledgedBy === 'Kai Park', r.body);
  r = await POST(req({ action: 'request', tenantId: 't1', key, staffPass: pass, id: 'q-old', step: 'done' }));
  q = await get(`${T}/floorRequests/q-old`);
  check('“Done” keeps who and how long the guest waited', r.body.ok && q.status === 'done' && q.resolvedBy === 'Kai Park' && q.waitSeconds >= 9 * 60 - 2 && q.waitSeconds <= 9 * 60 + 60, q);
  r = await POST(req({ action: 'request', tenantId: 't1', key, id: 'q-old', step: 'done' }));
  check('…and “Done” twice changes nothing', r.body.already === true && (await get(`${T}/floorRequests/q-old`)).resolvedBy === 'Kai Park');
  r = await POST(req({ action: 'request', tenantId: 't1', key, id: 'q-old', step: 'backup' }));
  check('…nor can backup be asked for on one that’s done', r.status === 409 && !(await get(`${T}/floorRequests/q-old`)).needsBackup);
  r = await POST(req({ action: 'request', tenantId: 't1', key, id: 'q-new', step: 'done' }));
  q = await get(`${T}/floorRequests/q-new`);
  check('with no PIN, the tablet’s own name goes on it, and “Done” straight away counts as taking it', r.body.ok && q.status === 'done' && q.resolvedBy === 'Floor' && q.claimedByName === 'Floor', q);
  r = await POST(req({ action: 'request', tenantId: 't1', key, id: 'q-access', step: 'backup' }));
  q = await get(`${T}/floorRequests/q-access`);
  check('asking for backup is kept, with who asked', r.body.ok && q.needsBackup === true && q.backupAskedBy === 'Floor' && q.status === 'new', q);
  r = await POST(req({ action: 'request', tenantId: 't1', key, id: 'q-access', step: 'unbackup' }));
  check('…and can be taken back', (await get(`${T}/floorRequests/q-access`)).needsBackup === false);
  r = await POST(req({ action: 'request', tenantId: 't1', key, id: 'nope', step: 'ack' }));
  const r2: any = await POST(req({ action: 'request', tenantId: 't1', key, id: 'q-flag', step: 'delete' }));
  check('a request that’s gone, or a step that isn’t one, is refused', r.status === 404 && r2.status === 400 && (await get(`${T}/floorRequests/q-flag`)).status === 'new');
  await db.doc(`${T}/staff/s7`).set({ isActive: false }, { merge: true });
  r = await POST(req({ action: 'request', tenantId: 't1', key, staffPass: rosa, id: 'q-flag', step: 'ack' }));
  q = await get(`${T}/floorRequests/q-flag`);
  check('a pass for someone taken off the team names nobody (the tablet’s name instead), and the tablet is told', r.body.ok && q.acknowledgedBy === 'Floor' && r.body.staffOk === false, [q, r.body]);
  await db.doc(`${T}/staff/s7`).set({ isActive: true }, { merge: true });

  console.log('my tables');
  r = await POST(req({ action: 'mytables', tenantId: 't1', key, eventId: 'e1', tableIds: ['ta'] }));
  check('picking tables needs a PIN', r.status === 403 && (await get(`${T}/studioEvents/e1/staffAssignments/s9`)).tableIds.join() === 'tb');
  r = await POST(req({ action: 'mytables', tenantId: 't1', key, staffPass: pass, eventId: 'e1', tableIds: ['ta', 'tb'] }));
  const B2 = (await POST(req({ action: 'board', tenantId: 't1', key, staffPass: pass }))).body;
  check('…then they’re yours, and the board shows you look after them', r.body.ok && B2.mine.join() === 'ta,tb' && B2.tables[0].staffIds.includes('s9') && B2.tables[0].staffIds.includes('s7'), [B2.mine, B2.tables.map((t: any) => t.staffIds)]);
  r = await POST(req({ action: 'mytables', tenantId: 't1', key, staffPass: pass, eventId: 'e1', tableIds: [] }));
  check('…and can all be let go', (await get(`${T}/studioEvents/e1/staffAssignments/s9`)).tableIds.length === 0);
  r = await POST(req({ action: 'mytables', tenantId: 't1', key, staffPass: pass, eventId: 'e1', tableIds: ['tc', 'made-up', 'tc'] }));
  check('only this event’s real tables are kept (once each)', r.body.ok && (await get(`${T}/studioEvents/e1/staffAssignments/s9`)).tableIds.join() === 'tc', await get(`${T}/studioEvents/e1/staffAssignments/s9`));
  r = await POST(req({ action: 'mytables', tenantId: 't1', key, staffPass: pass, eventId: 'no-such-event', tableIds: ['ta'] }));
  check('…and never for an event that isn’t there', r.status === 404 && !(await get(`${T}/studioEvents/no-such-event/staffAssignments/s9`)));

  console.log('who’s here');
  r = await POST(req({ action: 'arrive', tenantId: 't1', key, staffPass: pass, guestId: 'g2', here: true }));
  let g = await get(`${T}/eventGuests/g2`);
  check('a guest marked here, with when and by whom', r.body.ok && g.checkedIn === true && g.checkedInBy === 'Kai Park' && !!g.checkedInAt, g);
  r = await POST(req({ action: 'arrive', tenantId: 't1', key, guestId: 'g2', here: false }));
  g = await get(`${T}/eventGuests/g2`);
  check('…and back to not here, if tapped by mistake', r.body.ok && g.checkedIn === false && g.checkedInAt === null && g.checkedInBy === null, g);
  r = await POST(req({ action: 'arrive', tenantId: 't1', key, guestId: 'nobody', here: true }));
  check('…only someone on the list', r.status === 404);
  r = await POST(req({ action: 'arrive', tenantId: 't1', key, guestId: 'gx', here: true }));
  check('…on tonight’s list (not another event’s)', r.status === 409 && !(await get(`${T}/eventGuests/gx`)).checkedIn);
  r = await POST(req({ action: 'board', tenantId: 't1', key }));
  await POST(req({ action: 'arrive', tenantId: 't1', key, guestId: 'g3', here: true }));
  const r4: any = await POST(req({ action: 'board', tenantId: 't1', key }));
  check('…and the board shows the change at once (the shared guest list is cleared)', r4.body.guests.find((x: any) => x.id === 'g3').here === true);
  r = await POST(req({ action: 'arrive', tenantId: 't2', key, guestId: 'g2', here: true }));
  check('…and never from another business’s tablet', r.status === 401 && (await get(`${T}/eventGuests/g2`)).checkedIn === false);

  console.log('running food from the floor');
  r = await kitchen(req({ action: 'act', tenantId: 't1', key, staffPass: pass, col: 'kdsTickets', id: 'k1', step: 'carry' }));
  check('“I’ll take it” is the kitchen’s own step, under the PIN’s name', r.body.ok && (await get(`${T}/kdsTickets/k1`)).carriedBy === 'Kai Park', await get(`${T}/kdsTickets/k1`));
  r = await kitchen(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k1', step: 'deliver' }));
  const B3 = (await POST(req({ action: 'board', tenantId: 't1', key }))).body;
  check('…and once served it leaves the board', r.body.ok && (await get(`${T}/kdsTickets/k1`)).status === 'delivered' && B3.ready.length === 0);

  console.log('closed');
  await db.doc(T).set({ suspended: true }, { merge: true });
  r = await POST(req({ action: 'board', tenantId: 't1', key }));
  const r3: any = await POST(req({ action: 'request', tenantId: 't1', key, id: 'q-flag', step: 'done' }));
  check('a paused business has its floor board closed, and nothing moves', r.status === 403 && r.body.closed === true && r3.status === 403 && (await get(`${T}/floorRequests/q-flag`)).status === 'acknowledged', r.body);
  await db.doc(T).set({ suspended: false }, { merge: true });
  manager = true;
  const id = (await kitchen(req({ action: 'screens', tenantId: 't1' }))).body.screens.find((x: any) => x.name === 'Floor')?.id;
  await kitchen(req({ action: 'revoke', tenantId: 't1', id }));
  r = await POST(req({ action: 'board', tenantId: 't1', key }));
  check('a tablet stopped from the kitchen screen’s set-up stops here too', r.status === 401, r.body);

  console.log('the page');
  const page = src('src/app/floor/[tenantId]/page.tsx');
  check('the page reads and acts only through the server', !/from 'firebase\/firestore'|useCollection|useDoc|updateDoc|onSnapshot/.test(page) && page.includes("'/api/floor'") && page.includes("'/api/kitchen'"));
  check('…shares the kitchen screen’s set-up, and keeps the PIN pass for this visit only', page.includes('cf.kitchen.${t}') && page.includes("swrite('cf.kitchen.staff'") && !/localStorage\.setItem\('cf\.kitchen\.staff'|[^s]write\('cf\.kitchen\.staff'/.test(page));
  check('…sets up as a floor tablet, gives up on a call that hangs, keeps the screen awake and can sound on an iPad', page.includes("kind: 'floor'") && page.includes('AbortController') && page.includes('wakeLock') && page.includes('webkitAudioContext') && page.includes("'touchend'"));
  check('…every request step and the run steps are there', ["step(r, 'ack')", "step(r, 'done')", "'backup'", "run(t, 'carry')", "run(t, 'deliver')", "run(t, 'drop')", "action: 'arrive'", "action: 'mytables'"].every((x) => page.includes(x)));
  const strings = (page.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1|>[^<>{}\n]+</g) || []).filter((x) => !/^['"`]@\//.test(x)).join('\n');
  const bad = [['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join(''));
  check('writing rules: no emoji or check marks, no “call us”, no all-caps, no JSX comments, no business-type words, no tool names', !/[\u{1F300}-\u{1FAFF}✓✔✅]/u.test(page) && !/call us|contact us/i.test(strings) && !/\buppercase\b|font-black/.test(page)
    && !/\{\/\*/.test(page) && !/\b(studio|salon|stylist|booth|chair)s?\b/i.test(strings) && !new RegExp(bad.join('|'), 'i').test(page) && !/cancelled/.test(strings), strings.match(/\b(studio|salon|stylist|booth|chair)s?\b/gi));
  check('…big enough to tap: buttons are 44px or more', !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(page));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
