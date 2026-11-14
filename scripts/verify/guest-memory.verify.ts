// Checks guest memory (L20 round 8): lib/guest-memory (the rules), lib/guest-memory-server, api/host/floor (the floor
// read, guest_link, guest_note, guest_find), api/tab 'usual', api/wait (the usual offered and added), and the screens.
// - Who a party is: an exact mobile number or email of one guest the business has (never a renter's own client, never
//   when two guests share it) is only a suggestion, looked up once per number: the host asks and says yes, or finds
//   them, or says "not them". A seated table changes with them, allergies and all.
// - What's remembered: their table visits before tonight, when they were last in, what they ordered on at least two of
//   their recent visits, the table they sat at on half of them, their profile's allergies and the team's note.
// - Where it shows: the host stand, the server's tab (their usual a tap away), and the wait link (their usual drink, and
//   nothing else about them). Each is the business's choice.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/guest-memory.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 's1', name: 'Rae Kim', role: 'staff', isManager: false, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { ...actor, isManager: manager }, tenant: {} }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager }, tenant: {} }),
    requireCan: async () => ({ actor }),
  };
  if (request === '@/lib/sms') return { sendTenantSms: async () => ({ ok: true }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString();

(async () => {
  const G = await import('../../src/lib/guest-memory');
  const { searchFields } = await import('../../src/lib/client-search');
  console.log('the rules');
  const D = G.memorySettingsOf({});
  check('on at the host stand, a regular after 3 visits, the usual on the wait link only when the business turns it on; cleaned within range', D.on && D.regularAfter === 3 && !D.offerUsual && G.cleanMemory({ offerUsual: true }).offerUsual
    && G.cleanMemory({ on: false, regularAfter: 99, offerUsual: false }).regularAfter === 20 && G.cleanMemory({ regularAfter: 1 }).regularAfter === 2 && !G.cleanMemory({ on: false }).on);
  const people = [
    { id: 'dana', name: 'Dana Okafor', phone: '(555) 201-4417' },
    { id: 'twin1', name: 'Lee Park', phone: '555-777-0000' }, { id: 'twin2', name: 'Jo Park', phone: '+1 555 777 0000' },
    { id: 'rent', name: 'Rita Renter', phone: '555 300 1234', ownerRenterId: 'r1' },
    { id: 'priya', name: 'Priya Natarajan', email: 'Priya@Example.com' },
  ];
  check('an exact mobile number, however it’s written', G.matchGuest(people, { phone: '+1 555-201-4417' }).id === 'dana' && G.matchGuest(people, { phone: '+1 555-201-4417' }).by === 'phone');
  check('…not two guests who share it, and not a renter’s own client', G.matchGuest(people, { phone: '5557770000' }).id === null && G.matchGuest(people, { phone: '5557770000' }).count === 2 && G.matchGuest(people, { phone: '5553001234' }).id === null);
  check('…an email, any case; part of a number is no match', G.matchGuest(people, { email: 'priya@example.COM' }).id === 'priya' && G.matchGuest(people, { phone: '4417' }).id === null && G.matchSig({ phone: '4417' }) === '');

  const now = Date.now();
  const line = (id: string, name: string, o: any = {}) => ({ lineId: id + Math.random(), itemId: id, itemType: 'product', name, price: 5, quantity: 1, ...o });
  const visits = [
    { id: 'v1', isTable: true, status: 'completed', completedAt: iso(now - 7 * DAY), tableName: '4', tab: [line('fw', 'Flat white'), line('shak', 'Shakshuka'), line('fw', 'Flat white')] },
    { id: 'v2', isTable: true, status: 'completed', completedAt: iso(now - 14 * DAY), tableName: '4', tab: [line('fw', 'Flat white'), line('shak', 'Shakshuka'), line('cro', 'Croissant')] },
    { id: 'v3', isTable: true, status: 'completed', completedAt: iso(now - 21 * DAY), tableName: '9', tab: [line('fw', 'Flat white'), line('tea', 'Tea'), line('gift', 'Gift wrap', { itemType: 'service' })] },
    { id: 'v4', isTable: true, status: 'completed', completedAt: iso(now - 28 * DAY), tableName: '4', tab: [line('tea', 'Tea')] },
    { id: 'v5', isTable: true, status: 'servicing', startTime: iso(now), tableName: '4', tab: [line('cro', 'Croissant')] },
    { id: 'v6', isTable: false, status: 'completed', completedAt: iso(now - 3 * DAY), tab: [line('cro', 'Croissant')] },
    { id: 'v7', isTable: true, status: 'cancelled', completedAt: iso(now - 5 * DAY), tab: [line('cro', 'Croissant')] },
  ];
  const dana = { name: 'Dana Okafor', intel: { allergies: { flags: ['Tree nuts'], notes: 'Severe, carries an EpiPen' } }, hostNote: { text: 'Likes the window. Oat milk.', by: 'Rae', at: iso(now) } };
  const m = G.memoryOf('dana', dana, visits, D);
  check('their table visits before tonight, finished ones only (not tonight’s, not a cancelled one, not a non-table visit)', m.visits === 4 && m.regular && m.lastAt === visits[0].completedAt, m);
  check('their usual: what they ordered on at least two visits, most often first (once a visit, never a service)', m.usual.map((u) => u.id).join() === 'fw,shak,tea' && m.usual[0].times === 3, m.usual);
  check('their usual table: where they sat on half their visits or more', m.table === '4');
  check('their profile’s allergies and the team’s note', !!m.allergy && m.allergy.keys.includes('treenuts') && m.allergy.severe && m.note?.text === 'Likes the window. Oat milk.' && G.allergyWords(m.allergy).startsWith('Tree nuts'), m.allergy);
  const w = G.visitWords(m, 'America/New_York', now, (n) => `Spot ${n}`);
  check('in words: a regular, the 5th visit, when last in, their usual table in the business’s own word', w.head === 'Regular, 5th visit.' && /^Last in [A-Z][a-z]{2} \d{1,2}\. Usually Spot 4\.$/.test(w.rest), w);
  check('…what they usually order', G.usualWords(m) === 'Usually orders Flat white, Shakshuka and Tea.');
  const two = G.memoryOf('x', { name: 'X' }, visits.slice(0, 1), D);
  check('one visit before: their 2nd, not a regular yet; nothing usual from one visit; none yet says so', G.visitWords(two).head === '2nd visit.' && !two.regular && two.usual.length === 0 && two.table === null
    && G.visitWords(G.memoryOf('y', { name: 'Y' }, [], D)).head === 'No table visits yet.');
  check('the wait link offers only their usual drinks on its list, not ones picked already, two at most', G.usualDrinks(m, [{ id: 'tea' }, { id: 'fw' }, { id: 'neg' }]).join() === 'fw,tea' && G.usualDrinks(m, [{ id: 'tea' }, { id: 'fw' }], ['fw']).join() === 'tea' && G.usualDrinks(null, [{ id: 'fw' }]).length === 0);

  console.log('the host stand');
  await db.doc(T).set({ name: 'Linden', timezone: 'America/New_York', hostingSettings: { wait: { link: true, preorder: true } } });
  const units = [{ id: 'u4', name: '4', seatCount: 4, staffIds: [] }, { id: 'u9', name: '9', seatCount: 2, staffIds: [] }];
  await db.doc(`${T}/serviceSessions/s1`).set({ status: 'open', opensAt: iso(now - 2 * 3600000), units, businessDay: '2026-11-14' });
  const client = async (id: string, c: any) => db.doc(`${T}/clients/${id}`).set({ id, ...c, ...searchFields(c) });
  await client('dana', { ...dana, phone: '(555) 201-4417' });
  await client('twin1', { name: 'Lee Park', phone: '555-777-0000' }); await client('twin2', { name: 'Jo Park', phone: '+1 555 777 0000' });
  await client('rent', { name: 'Rita Renter', phone: '555 300 1234', ownerRenterId: 'r1' });
  await client('priya', { name: 'Priya Natarajan', email: 'priya@example.com' });
  await client('sam', { name: 'Sam Reyes', phone: '555 909 4417' });
  for (const v of visits) await db.doc(`${T}/appointments/${v.id}`).set({ ...v, clientId: 'dana' });
  await db.doc(`${T}/appointments/p1`).set({ id: 'p1', clientId: 'priya', isTable: true, status: 'completed', completedAt: iso(now - 50 * DAY), tableName: '9', tab: [line('neg', 'Negroni')] });
  const party = (id: string, o: any) => db.doc(`${T}/parties/${id}`).set({ sessionId: 's1', name: id, size: 2, needs: [], unitIds: [], guestIds: [], joinedAt: iso(now - 5 * 60000), ...o });
  await party('okafor', { status: 'waiting', name: 'Dana Okafor', phone: '+1 555 201 4417' });
  await party('park', { status: 'waiting', name: 'Lee Park', phone: '5557770000' });
  await party('rita', { status: 'waiting', name: 'Rita', phone: '5553001234' });
  await party('booked', { status: 'expected', name: 'Priya N', email: 'PRIYA@example.com', arrivesAt: iso(now + 30 * 60000), source: 'booking' });
  await party('walkup', { status: 'waiting', name: 'Sam Reyes' });
  let clientReads = 0; const col = db.collection.bind(db); db.collection = (p: string) => { if (p === `${T}/clients`) clientReads++; return col(p); };
  const Floor = await import('../../src/app/api/host/floor/route');
  let r: any = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  const ok1 = await get(`${T}/parties/okafor`); const pk = await get(`${T}/parties/park`); const rt = await get(`${T}/parties/rita`); const bk = await get(`${T}/parties/booked`);
  check('a regular’s mobile number only suggests who they are (nothing is theirs yet); the floor read gives their name and visits to ask with, nothing more', r.body.ok && !ok1.clientId && ok1.guestSuggest === 'dana' && ok1.guestSuggestBy === 'phone'
    && r.body.guests.dana?.visits === 4 && r.body.guests.dana.name === 'Dana Okafor' && r.body.guests.dana.note === null && r.body.guests.dana.allergy === null && r.body.guests.dana.usual.length === 0 && r.body.memory.on && !r.body.memory.offerUsual, { ok1, g: r.body.guests });
  check('…a booking by its email', !bk.clientId && bk.guestSuggest === 'priya' && bk.guestSuggestBy === 'email' && r.body.guests.priya?.visits === 1, bk);
  check('…not a number two guests share, not a renter’s client; checked once each', !pk.guestSuggest && pk.guestMatches === 2 && !rt.guestSuggest && !!pk.guestCheck && !!rt.guestCheck, { pk, rt });
  const before = clientReads;
  (await import('../../src/lib/floor-server')).forgetFloor('t1');
  r = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  check('…and not looked up again on the next read', clientReads === before && r.body.guests.dana, { before, clientReads });
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'booked', clientId: 'priya' }));
  const bk2 = await get(`${T}/parties/booked`);
  check('“Yes, it’s Priya”: linked by the host, the suggestion gone', r.body.ok && bk2.clientId === 'priya' && bk2.guestMatch === 'host' && bk2.guestSuggest === null);

  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_find', term: 'reyes' }));
  check('“Been here before?”: found by name, with only a hint of their number', r.body.ok && r.body.guests.length === 1 && r.body.guests[0].id === 'sam' && r.body.guests[0].hint === 'Mobile ending 4417' && !JSON.stringify(r.body).includes('909'), r.body);
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_find', term: 'rita' }));
  check('…never a renter’s own client', r.body.ok && r.body.guests.length === 0);
  let lastFind: any = null; for (let i = 0; i < 20; i++) lastFind = await Floor.POST(req({ tenantId: 't1', action: 'guest_find', term: 'park' }));
  check('…a few looks a minute', lastFind.status === 429);
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'walkup', clientId: 'sam' }));
  check('the host links them', r.body.ok && (await get(`${T}/parties/walkup`)).clientId === 'sam' && (await get(`${T}/parties/walkup`)).guestMatch === 'host');
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'walkup', clientId: 'rent' }));
  check('…not to a renter’s client', r.status === 404 && (await get(`${T}/parties/walkup`)).clientId === 'sam');
  await party('apptp', { status: 'waiting', name: 'Booked visit', clientId: 'priya', guestIds: ['appt:a77'] });
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'apptp', clientId: null }));
  check('…not a party from a booked visit (that’s changed on the booking)', r.status === 409 && (await get(`${T}/parties/apptp`)).clientId === 'priya');

  console.log('seated: not them, and the right guest');
  await db.doc(`${T}/parties/okafor`).set({ status: 'seated', unitIds: ['u4'], seatedAt: iso(now) }, { merge: true });
  await db.doc(`${T}/kdsTickets/tk1`).set({ id: 'tk1', visitId: 'apt-party-okafor', status: 'pending', allergies: [] });
  await db.doc(`${T}/appointments/apt-party-okafor`).set({ id: 'apt-party-okafor', isTable: true, partyId: 'okafor', tableName: '4', status: 'servicing', clientId: null, allergiesSeeded: true,
    allergies: [{ id: 'a1', seat: '2', keys: ['shellfish'], other: null, severe: false, from: 'asked', by: 'Rae', at: iso(now) }], tab: [{ lineId: 'l1', itemId: 'cake', name: 'Cake', price: 9, quantity: 1, seat: null, kdsId: 'tk1', allergens: ['treenuts'] }] });
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'okafor', clientId: 'sam' }));
  let vO = await get(`${T}/appointments/apt-party-okafor`);
  check('linked while seated: the visit is theirs at once', r.body.ok && vO.clientId === 'sam' && vO.allergies.length === 1, vO);
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'okafor', clientId: 'dana' }));
  vO = await get(`${T}/appointments/apt-party-okafor`); let tk = await get(`${T}/kdsTickets/tk1`);
  check('“Not Sam?”, it’s Dana: her profile’s allergies go on the table and on the tickets not out yet, in the same save; what the table said stays',
    r.body.ok && vO.clientId === 'dana' && vO.allergiesSeeded === true && vO.allergies.some((a: any) => a.from === 'profile' && a.keys.includes('treenuts')) && vO.allergies.some((a: any) => a.id === 'a1')
    && JSON.stringify(tk.allergies || []).toLowerCase().includes('tree'), { vO: vO.allergies, tk });
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'okafor', clientId: null }));
  let pO = await get(`${T}/parties/okafor`); vO = await get(`${T}/appointments/apt-party-okafor`); tk = await get(`${T}/kdsTickets/tk1`);
  check('“Not Dana?”: unlinked, her allergies off the table and its tickets, and her number not suggested again tonight', r.body.ok && pO.clientId === null && pO.guestMatch === 'not_them'
    && vO.clientId === null && !vO.allergies.some((a: any) => a.from === 'profile') && vO.allergies.length === 1 && !JSON.stringify(tk.allergies || []).toLowerCase().includes('tree'), { vO: vO.allergies, tk: tk.allergies });
  (await import('../../src/lib/floor-server')).forgetFloor('t1');
  await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  check('…the next floor read leaves them unlinked', !(await get(`${T}/parties/okafor`)).clientId && !(await get(`${T}/parties/okafor`)).guestSuggest);
  await db.doc(`${T}/appointments/apt-party-okafor`).set({ payPaidSoFar: 20 }, { merge: true });
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'okafor', clientId: 'dana' }));
  check('…not once part of the check is paid at the table', r.status === 409 && (await get(`${T}/appointments/apt-party-okafor`)).clientId === null);
  await db.doc(`${T}/appointments/apt-party-okafor`).set({ payPaidSoFar: 0 }, { merge: true });
  await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'okafor', clientId: 'dana' }));
  vO = await get(`${T}/appointments/apt-party-okafor`);
  await db.doc(`${T}/appointments/apt-party-okafor`).set({ allergies: vO.allergies.map((a: any) => (a.from === 'profile' ? { ...a, seat: '1', other: 'Mustard' } : a)) }, { merge: true });
  await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'okafor', clientId: null }));
  vO = await get(`${T}/appointments/apt-party-okafor`);
  check('…a profile allergy the server changed at the table stays, as the table told it', vO.allergies.some((a: any) => a.from === 'asked' && a.seat === '1' && a.other === 'Mustard' && a.keys.includes('treenuts')), vO.allergies);
  await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'okafor', clientId: 'dana' }));
  // Seated a moment before the host's yes reached the party: the visit was made without them.
  await party('late', { status: 'seated', name: 'Sam Reyes', unitIds: ['u9'], seatedAt: iso(now), clientId: 'sam', guestMatch: 'host' });
  await db.doc(`${T}/appointments/apt-party-late`).set({ id: 'apt-party-late', isTable: true, partyId: 'late', tableName: '9', status: 'servicing', clientId: null, allergiesSeeded: true, allergies: [], tab: [] });
  (await import('../../src/lib/floor-server')).forgetFloor('t1');
  await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  check('a table seated just as its party was linked is put right on the next floor read', (await get(`${T}/appointments/apt-party-late`)).clientId === 'sam');

  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_note', partyId: 'okafor', clientId: 'dana', note: '  Corner table by the window.   Birthday in March. ' }));
  (await import('../../src/lib/floor-server')).forgetFloor('t1');
  const r2: any = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  check('the team’s note, saved on the guest and shown at once', r.body.ok && (await get(`${T}/clients/dana`)).hostNote.text === 'Corner table by the window. Birthday in March.' && r2.body.guests.dana.note.text === 'Corner table by the window. Birthday in March.' && r2.body.guests.dana.note.by === 'Rae Kim');
  const stray: any = await Floor.POST(req({ tenantId: 't1', action: 'guest_note', partyId: 'okafor', clientId: 'priya', note: 'Not hers' }));
  await party('lastweek', { status: 'finished', name: 'Priya', clientId: 'priya', guestMatch: 'host' });
  const old1: any = await Floor.POST(req({ tenantId: 't1', action: 'guest_note', partyId: 'lastweek', clientId: 'priya', note: 'From before' }));
  check('…only for the guest a party on tonight’s floor is linked to', stray.status === 409 && old1.status === 409 && !(await get(`${T}/clients/priya`)).hostNote);
  r = await Floor.POST(req({ tenantId: 't1', action: 'guest_note', partyId: 'okafor', clientId: 'dana', note: 'x'.repeat(400) }));
  check('…two hundred characters at most; empty takes it off', r.body.note.text.length === 200 && (await Floor.POST(req({ tenantId: 't1', action: 'guest_note', partyId: 'okafor', clientId: 'dana', note: '' }))).body.note === null);

  console.log('the server’s tab');
  const Tab = await import('../../src/app/api/tab/route');
  r = await Tab.POST(req({ tenantId: 't1', action: 'usual', visitId: 'apt-party-okafor' }));
  check('their usual, a tap away, with what the team knows', r.body.ok && r.body.usual.map((u: any) => u.id).join() === 'fw,shak,tea' && /^Regular, 5th visit\./.test(r.body.words), r.body);

  console.log('the wait link');
  await db.doc(`${T}/inventory/fw`).set({ name: 'Flat white', type: 'refreshment', category: 'Coffee', msrp: 4.5, allergens: ['milk'] });
  await db.doc(`${T}/inventory/tea`).set({ name: 'Tea', type: 'refreshment', category: 'Coffee', msrp: 3, allergens: [] });
  await db.doc(`${T}/inventory/shak`).set({ name: 'Shakshuka', type: 'refreshment', category: 'Brunch', msrp: 14 });
  await db.doc(`${T}/parties/okafor2`).set({ sessionId: 's1', status: 'waiting', name: 'Dana Okafor', size: 2, guestSuggest: 'dana', waitToken: 'tok_dana_okafor_000000', joinedAt: iso(now), needs: [], unitIds: [], guestIds: [] });
  await db.doc(`${T}/parties/anon`).set({ sessionId: 's1', status: 'waiting', name: 'Ana', size: 2, waitToken: 'tok_anon_guest_0000000', joinedAt: iso(now), needs: [], unitIds: [], guestIds: [] });
  const Wait = await import('../../src/app/api/wait/route');
  const W = (token: string, body: any): Promise<any> => Wait.POST(req({ tenantId: 't1', token, ...body }));
  r = await W('tok_dana_okafor_000000', { action: 'view' });
  check('off until the business offers it', r.body.ok && r.body.usual.length === 0 && !(await W('tok_dana_okafor_000000', { action: 'usual' })).body.ok);
  await Floor.POST(req({ tenantId: 't1', action: 'settings', memory: { on: true, regularAfter: 3, offerUsual: true } }));
  let realNow = Date.now; Date.now = () => realNow() + 11000;   // the wait link reads the business again after ten seconds
  r = await W('tok_dana_okafor_000000', { action: 'view' });
  check('…and never for a number someone typed: only once the host has said who they are', r.body.ok && r.body.usual.length === 0 && !(await W('tok_dana_okafor_000000', { action: 'usual' })).body.ok);
  await Floor.POST(req({ tenantId: 't1', action: 'guest_link', partyId: 'okafor2', clientId: 'dana' }));
  r = await W('tok_dana_okafor_000000', { action: 'view' });
  check('“Your usual?”: their usual drinks on the list, named and priced, nothing else about them', r.body.ok && r.body.usual.map((d: any) => d.id).join() === 'fw,tea' && r.body.usual[0].price === 4.5
    && !/visit|allerg|nuts|window|note/i.test(JSON.stringify(r.body.usual)) && !('guests' in r.body) && !('note' in r.body), r.body.usual);
  r = await W('tok_dana_okafor_000000', { action: 'usual' });
  const pd = await get(`${T}/parties/okafor2`);
  check('one tap adds them, one of each, on their table’s check', r.body.ok && pd.preorder.map((l: any) => `${l.itemId}:${l.qty}`).join() === 'fw:1,tea:1', pd.preorder);
  r = await W('tok_dana_okafor_000000', { action: 'view' });
  const again: any = await W('tok_dana_okafor_000000', { action: 'usual' });
  check('…then it isn’t offered again, and can’t be added twice', r.body.usual.length === 0 && !again.body.ok && (await get(`${T}/parties/okafor2`)).preorder.length === 2);
  r = await W('tok_anon_guest_0000000', { action: 'view' });
  check('someone we don’t know isn’t offered one', r.body.ok && r.body.usual.length === 0 && !(await W('tok_anon_guest_0000000', { action: 'usual' })).body.ok);

  console.log('the business’s choice');
  manager = false;
  r = await Floor.POST(req({ tenantId: 't1', action: 'settings', memory: { on: true, offerUsual: false } }));
  check('a manager changes it', r.status === 403);
  manager = true;
  r = await Floor.POST(req({ tenantId: 't1', action: 'settings', memory: { on: true, regularAfter: 6, offerUsual: false } }));
  check('saved, cleaned', r.body.ok && r.body.memory.regularAfter === 6 && !r.body.memory.offerUsual && (await get(T)).hostingSettings.memory.regularAfter === 6);
  await db.doc(`${T}/parties/okafor2`).set({ preorder: [] }, { merge: true });
  Date.now = realNow; realNow = Date.now; Date.now = () => realNow() + 22000;
  r = await W('tok_dana_okafor_000000', { action: 'view' });
  check('the usual not offered on the wait link when it’s off', r.body.ok && r.body.usual.length === 0 && !(await W('tok_dana_okafor_000000', { action: 'usual' })).body.ok, r.body);
  Date.now = realNow;
  await Floor.POST(req({ tenantId: 't1', action: 'settings', memory: { on: false } }));
  await party('newcomer', { status: 'waiting', name: 'Lee', phone: '(555) 909-4417' });
  (await import('../../src/lib/floor-server')).forgetFloor('t1');
  r = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  const tabOff: any = await Tab.POST(req({ tenantId: 't1', action: 'usual', visitId: 'apt-party-okafor' }));
  check('regulars off: nobody suggested, nothing remembered on the floor or the tab', r.body.ok && Object.keys(r.body.guests).length === 0 && !(await get(`${T}/parties/newcomer`)).guestSuggest && tabOff.body.usual.length === 0, r.body.guests);

  console.log('a long history');
  const GS = await import('../../src/lib/guest-memory-server');
  await client('mix', { name: 'Mo Ito', phone: '555 121 2121' });
  for (let i = 0; i < 70; i++) await db.doc(`${T}/appointments/mx-a${String(i).padStart(3, '0')}`).set({ clientId: 'mix', status: 'completed', startTime: iso(now - i * DAY), completedAt: iso(now - i * DAY), services: [{ name: 'Class' }] });
  for (let i = 0; i < 5; i++) await db.doc(`${T}/appointments/mx-b${String(i).padStart(3, '0')}`).set({ clientId: 'mix', isTable: true, status: 'completed', startTime: iso(now - (80 + i) * DAY), completedAt: iso(now - (80 + i) * DAY), tableName: '7', tab: [line('lat', 'Latte')] });
  const mm = await GS.memoryFor(db, T, {}, 'mix', { fresh: true });
  check('a business that also takes other appointments: their table visits are still found past the others', !!mm && mm.visits === 5 && mm.usual[0]?.id === 'lat' && mm.table === '7' && !mm.more, mm);
  await client('long', { name: 'Lou Grant', phone: '555 343 4343' });
  for (let i = 0; i < 70; i++) await db.doc(`${T}/appointments/lg-${String(i).padStart(3, '0')}`).set({ clientId: 'long', isTable: true, status: 'completed', startTime: iso(now - (i + 1) * DAY), completedAt: iso(now - (i + 1) * DAY), tableName: '2', tab: [line('esp', 'Espresso')] });
  const ml = await GS.memoryFor(db, T, {}, 'long', { fresh: true });
  check('…and every table visit is counted, not just the ones read', !!ml && ml.visits === 70 && !ml.more && G.visitWords(ml).head === 'Regular, 71st visit.', ml && { visits: ml.visits, more: ml.more });

  console.log('the screens');
  const host = src('src/app/(app)/host/page.tsx'); const tab = src('src/components/host/TableTab.tsx'); const wait = src('src/app/wait/[tenantId]/[token]/page.tsx'); const set = src('src/components/settings/HostStandSettings.tsx');
  check('the host stand: their memory on waiting, booked and seated parties; “Been here before?”, “Not …?”, a note for next time', /guestBlock\(p\)/.test(host) && /guestBlock\(openParty, /.test(host) && /Been here before\?/.test(host) && /Not \{name1\}\?/.test(host) && /Is this \{m\.name\}\?/.test(host) && /Yes, it’s \{name1\}/.test(host) && /A note for next time/.test(host) && /That’s them/.test(host) && /function GuestBlock/.test(host));
  check('the tab: their usual through the same checks as the menu', /Their usual/.test(tab) && /onClick=\{\(\) => add\(it\)\}/.test(tab) && /action: 'usual'/.test(tab));
  check('the wait link: “Your usual?”', /Your usual\?/.test(wait) && /act\('usual'\)/.test(wait));
  check('the settings: regulars, a regular after, the usual on the wait link', /Show regulars at the host stand/.test(set) && /A regular after/.test(set) && /Offer their usual drink on the wait link/.test(set) && /Regulars/.test(src('src/lib/settings-rows.ts')));
  const fresh = src('src/lib/guest-memory.ts') + src('src/lib/guest-memory-server.ts') + host.slice(host.indexOf('function GuestBlock'));
  check('no emoji, all caps, red or niche words in what’s new', !/[\u{1F300}-\u{1FAFF}]/u.test(fresh + set + wait) && !/\buppercase\b|font-black|#b42318/.test(fresh) && !/\b(salon|stylist|booth|chair)\b/i.test(fresh));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
