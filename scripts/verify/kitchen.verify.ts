// Checks the kitchen screen (L18): app/kds, api/kitchen, lib/kitchen.
// - It works on a tablet nobody is signed in on: a manager sets it up once and it carries its own key (kept only as a
//   fingerprint, where no browser can reach it); a wrong, another business's or stopped key is refused; a manager can
//   list the screens and stop a lost one; a paused business has it closed. No PIN is needed to use it; a PIN, checked
//   on the server, puts a name on what's done (a name the screen just sends counts for nothing).
// - A ticket moves where it lives: a table tab's ticket (kdsTickets) is moved there, never written into lounge orders.
//   Each step happens once (a second tap, or another screen, changes nothing).
// - A lounge order's stock is taken once: ordering already took the item, so delivering takes nothing more for it (a
//   recipe uses its parts); cancelling puts back what ordering took. A member perk and the visit are counted on delivery;
//   a kiosk order paid at the station is booked once as it's handed over. The guest's own recall is one step with the
//   kitchen: it puts stock back once, only if ordering took it, and never after the kitchen has started.
// - A whole course or dish moves at once; tickets group by course and by dish.
// - Allergies are flagged big, including ones only typed into a note.
// - Food and drink sold at the desk reaches the kitchen once; what a table's tab already sent isn't sent again.
// - The event screen links to its kitchen screen; late arrivals carry their allergy note; the old copies are gone.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/kitchen.verify.ts
import Module from 'module';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
let db: any = strictTransactions(makeDb());
let manager = true;
let signedIn = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
function StripeMock(this: any) { return { paymentIntents: { retrieve: async () => { throw new Error('no card here'); } } }; }
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
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
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();

(async () => {
  console.log('tickets, read and moved the same way');
  const K = await import('../../src/lib/kitchen');
  check('steps only from where a ticket is', K.canStep('pending', 'claim') && !K.canStep('in_progress', 'claim') && K.canStep('in_progress', 'release') && !K.canStep('pending', 'release')
    && K.canStep('pending', 'ready') && !K.canStep('ready', 'ready') && K.canStep('ready', 'deliver') && !K.canStep('delivered', 'deliver') && !K.canStep('cancelled', 'cancel') && !K.canStep('delivered', 'cancel'));
  const lounge = K.ticketFrom({ id: 'r1', clientName: 'Maya', itemName: 'Latte', itemId: 'latte', quantity: 2, requestedAt: iso(3), stationName: 'Station 2', notes: 'oat milk', guestDescription: 'green coat' }, 'refreshmentRequests');
  const tab = K.ticketFrom({ id: 'tab_v1_l1', source: 'tab', guestName: 'Table 4', menuItemName: 'Fries', tableNumber: '4', seatNumber: '2', note: 'no salt', createdAt: iso(2) }, 'kdsTickets');
  check('a lounge order and a table tab’s ticket each keep where they live', lounge.col === 'refreshmentRequests' && lounge.source === 'lounge' && tab.col === 'kdsTickets' && tab.source === 'tab' && tab.station === 'Table 4, seat 2', { lounge, tab });
  check('…with the guest’s own notes and what to look for', lounge.note === 'oat milk' && lounge.lookFor === 'green coat' && lounge.quantity === 2 && tab.note === 'no salt');
  let f = K.allergyFlags({ allergies: [{ label: 'Peanuts', severity: 'critical' }, 'Gluten'], allergyNote: null, note: null, accessNote: null } as any);
  check('allergies picked from a list, with how serious', f.any && f.severe && f.listed.length === 2 && f.listed[0].name === 'Peanuts' && f.listed[0].severe && !f.listed[1].severe, f);
  f = K.allergyFlags({ allergies: [], allergyNote: null, note: 'Please no nuts, she carries an EpiPen', accessNote: null } as any);
  check('…and one only typed into a note is flagged too (severe when it says so)', f.any && f.severe && f.mentions.length === 1 && f.listed.length === 0, f);
  f = K.allergyFlags({ allergies: [], allergyNote: null, note: 'extra hot, oat milk', accessNote: 'tap my shoulder' } as any);
  check('…a note with no allergy in it isn’t flagged (oat milk is a choice)', !f.any, f);
  check('…nor is an allergen that’s part of the order (extra shrimp, almond milk)', ['extra shrimp please', 'almond milk', 'eggs over easy', 'fish of the day'].every((n) => !K.allergyFlags({ allergies: [], allergyNote: null, note: n, accessNote: null } as any).any));
  check('…but “no egg”, “allergic” and “can’t have nuts” are', ['no egg', 'she’s allergic to kiwi', 'can’t have nuts', 'lactose intolerant'].every((n) => K.allergyFlags({ allergies: [], allergyNote: null, note: n, accessNote: null } as any).any));
  check('…dairy, gluten, shellfish and sesame written in a note are caught', ['dairy free please', 'gluten-free', 'shellfish allergy', 'no sesame'].every((n) => K.allergyFlags({ allergies: [], allergyNote: n, note: null, accessNote: null } as any).any));
  const ev = (id: string, course: number, item: string, at: number, ev = 'e1', title = 'Spring dinner') => K.ticketFrom({ id, source: 'event', eventId: ev, eventTitle: title, courseNumber: course, menuItemName: item, guestName: id, createdAt: iso(at) }, 'kdsTickets');
  const list = [ev('a', 2, 'Risotto', 5), ev('b', 1, 'Soup', 9), ev('c', 2, 'Salmon', 4), ev('d', 1, 'Soup', 1, 'e2', 'Gala'), lounge, tab];
  const byCourse = K.groupTickets(list, 'course');
  check('by course: each event’s course its own group, oldest first, other orders by where they came from', byCourse[0].label === 'Spring dinner, course 1' && byCourse.find((g) => g.label === 'Spring dinner, course 2')?.tickets.length === 2 && byCourse.some((g) => g.label === 'Gala, course 1') && byCourse.some((g) => g.label === 'Lounge orders') && byCourse.some((g) => g.label === 'Table orders'), byCourse.map((g) => g.label));
  const byDish = K.groupTickets(list, 'dish');
  check('by dish: every guest’s same dish together, counted by quantity', byDish.find((g) => g.label === 'Soup')?.count === 2 && byDish.find((g) => g.label === 'Latte')?.count === 2, byDish.map((g) => `${g.label}×${g.count}`));

  console.log('setting up a screen');
  const { POST } = await import('../../src/app/api/kitchen/route');
  const fresh = async () => {
    db = strictTransactions(makeDb()); manager = true;
    await db.doc(T).set({ name: 'North Loft', timezone: 'America/New_York' });
  };
  await fresh();
  manager = false;
  let r: any = await POST(req({ action: 'pair', tenantId: 't1', name: 'Pass' }));
  check('only a manager signed in can set one up', r.status === 403 && (await all('kitchenScreens')).length === 0, r.body);
  manager = true;
  r = await POST(req({ action: 'pair', tenantId: 't1', name: 'Pass' }));
  const key = r.body.key;
  const screens = await all('kitchenScreens');
  check('a manager gets the screen’s key once; only its fingerprint is kept', r.body.ok && /^[0-9a-f]{64}$/.test(key) && screens.length === 1 && screens[0].id === createHash('sha256').update(key).digest('hex') && !JSON.stringify(screens).includes(key) && screens[0].name === 'Pass' && screens[0].tenantId === 't1', r.body);
  const rules = src('firestore.rules');
  check('…kept where the security rules let no browser read or write (nothing matches it, outside any business)', !/match \/kitchenScreens/.test(rules) && !/match \/\{[a-z]+=\*\*\}/.test(rules) && !(await all(`${T}/kitchenScreens`)).length);
  await db.doc(T.replace('t1', 't2')).set({ name: 'Other place' });
  r = await POST(req({ action: 'tickets', tenantId: 't2', key }));
  check('a screen’s key opens only its own business', r.status === 401);
  manager = false;   // the manager signs out: the screen keeps working on its key
  r = await POST(req({ action: 'tickets', tenantId: 't1', key: 'f'.repeat(64) }));
  check('a wrong key is refused', r.status === 401, r.body);
  signedIn = false;
  r = await POST(req({ action: 'tickets', tenantId: 't1' }));
  check('…and no key at all, with nobody signed in', r.status === 401);
  signedIn = true;

  manager = true;
  const k2 = (await POST(req({ action: 'pair', tenantId: 't1', name: 'Bar' }))).body.key;
  r = await POST(req({ action: 'screens', tenantId: 't1' }));
  const barId = createHash('sha256').update(k2).digest('hex');
  check('a manager sees the business’s screens (never their keys)', r.body.ok && r.body.screens.length === 2 && r.body.screens.some((x: any) => x.id === barId && x.name === 'Bar') && !JSON.stringify(r.body).includes(k2) && !JSON.stringify(r.body).includes(key), r.body);
  r = await POST(req({ action: 'revoke', tenantId: 't2', id: barId }));
  check('…another business can’t stop them', r.status === 404);
  r = await POST(req({ action: 'revoke', tenantId: 't1', id: barId }));
  const r3: any = await POST(req({ action: 'tickets', tenantId: 't1', key: k2 }));
  check('…and can stop a lost one from any device; it stops working at once', r.body.ok && r3.status === 401 && (await POST(req({ action: 'screens', tenantId: 't1' }))).body.screens.length === 1);
  manager = false;
  r = await POST(req({ action: 'screens', tenantId: 't1' }));
  check('…only a manager', r.status === 403);

  console.log('reading tickets');
  await db.doc(`${T}/inventory/latte`).set({ name: 'Latte', type: 'refreshment', totalStock: 10, price: 5, cost: 1.2, formula: [{ id: 'beans', name: 'Espresso beans', quantityUsed: 18, unit: 'g' }, { id: 'milk', name: 'Milk', quantityUsed: 200, unit: 'ml' }] });
  await db.doc(`${T}/inventory/water`).set({ name: 'Sparkling water', type: 'refreshment', totalStock: 20, price: 3 });
  await db.doc(`${T}/inventory/beans`).set({ name: 'Espresso beans', totalStock: 1000, unit: 'g' });
  await db.doc(`${T}/inventory/milk`).set({ name: 'Milk', totalStock: 5000, unit: 'ml' });
  await db.doc(`${T}/refreshmentRequests/r1`).set({ id: 'r1', clientName: 'Maya', clientId: 'c1', appointmentId: 'a1', itemId: 'water', itemName: 'Sparkling water', quantity: 2, status: 'pending', requestedAt: iso(4), stockMoved: true, isRedemption: true });
  await db.doc(`${T}/refreshmentRequests/r2`).set({ id: 'r2', clientName: 'Ben', itemId: 'latte', itemName: 'Latte', quantity: 1, status: 'pending', requestedAt: iso(3), stockMoved: true });
  await db.doc(`${T}/refreshmentRequests/r3`).set({ id: 'r3', clientName: 'Cleo', itemId: 'water', itemName: 'Sparkling water', quantity: 1, status: 'pending', requestedAt: iso(2) });
  await db.doc(`${T}/refreshmentRequests/old`).set({ id: 'old', clientName: 'Dee', itemId: 'water', itemName: 'Sparkling water', status: 'delivered', requestedAt: iso(30), deliveredAt: iso(25) });
  await db.doc(`${T}/kdsTickets/tab_v1_l1`).set({ id: 'tab_v1_l1', source: 'tab', visitId: 'v1', tableNumber: '4', guestName: 'Table 4', menuItemId: 'water', menuItemName: 'Sparkling water', status: 'pending', createdAt: iso(1) });
  for (const [id, course, eid] of [['k1', 1, 'e1'], ['k2', 1, 'e1'], ['k3', 1, 'e1'], ['k4', 2, 'e2']] as const) await db.doc(`${T}/kdsTickets/${id}`).set({ id, source: 'event', eventId: eid, eventTitle: eid === 'e1' ? 'Spring dinner' : 'Gala', courseNumber: course, guestName: id, menuItemName: 'Soup', status: 'pending', createdAt: iso(6), allergies: id === 'k2' ? [{ label: 'Dairy', severity: 'critical' }] : [] });
  r = await POST(req({ action: 'tickets', tenantId: 't1', key }));
  const tk: any[] = r.body.tickets || [];
  check('both places’ tickets, each saying where it lives; nothing finished', r.body.ok && tk.length === 8 && tk.filter((t) => t.col === 'refreshmentRequests').length === 3 && tk.find((t) => t.id === 'tab_v1_l1')?.col === 'kdsTickets' && !tk.some((t) => t.id === 'old'), tk.map((t) => `${t.col}/${t.id}`));
  check('the items they use, with what they’re made of, and nothing about cost', r.body.items?.latte?.formula?.length === 2 && !JSON.stringify(r.body.items).includes('cost') && !('price' in (r.body.items?.latte || {})), r.body.items);
  check('today’s numbers include what’s already served; the business and screen are named', Array.isArray(r.body.today) && r.body.today.some((x: any) => x.status === 'delivered') && r.body.business?.name === 'North Loft' && r.body.screen === 'Pass');
  r = await POST(req({ action: 'tickets', tenantId: 't1', key, eventId: 'e1' }));
  check('one event’s tickets only, when asked', r.body.tickets.length === 3 && r.body.tickets.every((t: any) => t.eventId === 'e1'));

  console.log('who’s working');
  await db.doc(`${T}/staff/s9`).set({ name: 'Kai Park', role: 'staff', pin: '4821' });
  r = await POST(req({ action: 'pin', tenantId: 't1', key, pin: '1111' }));
  check('a wrong PIN is refused (and counted toward the lockout), without stopping the screen', r.status === 403 && ((await get(`${T}/private/pinGuard`))?.failedAt || []).length === 1, r.body);
  r = await POST(req({ action: 'pin', tenantId: 't1', key, pin: '4821' }));
  const pass = r.body.pass;
  check('the right PIN, checked on the server, gives the screen a pass with their name', r.body.ok && r.body.staff?.name === 'Kai Park' && /^[0-9a-f]{48}$/.test(pass) && !JSON.stringify(await all('kitchenScreens')).includes(pass), r.body);
  r = await POST(req({ action: 'pin', tenantId: 't1', key: 'f'.repeat(64), pin: '4821' }));
  check('…only on a screen that’s set up', r.status === 401);
  await db.doc(`${T}/staff/s8`).set({ name: 'Rosa Diaz', role: 'staff', pin: '7777' });
  const passB = (await POST(req({ action: 'pin', tenantId: 't1', key, pin: '7777' }))).body.pass;
  const scr = (await all('kitchenScreens')).find((x: any) => x.tenantId === 't1' && !x.revokedAt && x.name === 'Pass');
  check('…two people on one screen each keep their own pass', Object.keys(scr?.passes || {}).length === 2 && !!passB, scr?.passes);
  await db.doc(`${T}/kdsTickets/zz`).set({ id: 'zz', source: 'event', guestName: 'Zed', menuItemName: 'Soup', status: 'pending', createdAt: iso(1) });
  await db.doc(`${T}/staff/s8`).set({ isActive: false }, { merge: true });
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'zz', step: 'claim', staffPass: passB }));
  check('…and a pass stops naming someone taken off the team (the screen is told, to stop showing them)', (await get(`${T}/kdsTickets/zz`)).claimedBy?.name === 'Pass' && r.body.staffOk === false, r.body);

  console.log('moving a ticket');
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'tab_v1_l1', step: 'claim', staffPass: pass }));
  let doc: any = await get(`${T}/kdsTickets/tab_v1_l1`);
  check('a table tab’s ticket is moved where it lives, with the name of who started it', r.body.ok && doc.status === 'in_progress' && doc.claimedBy?.name === 'Kai Park' && doc.claimedBy?.staffId === 's9' && doc.claimedBy?.via === 'Pass' && !(await get(`${T}/refreshmentRequests/tab_v1_l1`)), doc);
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'tab_v1_l1', step: 'claim', staffPass: pass }));
  check('…a second tap (or another screen) changes nothing', r.body.ok && r.body.already && (await get(`${T}/kdsTickets/tab_v1_l1`)).claimedBy.name === 'Kai Park');
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'tab_v1_l1', step: 'release' }));
  doc = await get(`${T}/kdsTickets/tab_v1_l1`);
  check('“Not started” puts it back, with nobody on it', doc.status === 'pending' && doc.claimedBy === null);
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'r1', step: 'ready', staff: { id: 'boss', name: 'The Owner' }, staffPass: 'a'.repeat(48) }));
  check('ready straight from waiting; a name the screen just sends (or a made-up pass) counts for nothing: it’s the screen’s', (await get(`${T}/refreshmentRequests/r1`)).status === 'ready' && (await get(`${T}/refreshmentRequests/r1`)).claimedBy?.name === 'Pass');
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'nope', id: 'r1', step: 'deliver' }));
  check('only the two places tickets live', r.status === 400);
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'gone', step: 'claim' }));
  check('a ticket that’s gone says so', r.status === 404);

  console.log('a lounge order’s stock, once');
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'r1', step: 'deliver' }));
  const water = await get(`${T}/inventory/water`);
  check('delivering one whose item was taken at ordering takes nothing more', r.body.ok && water.totalStock === 20 && (await get(`${T}/refreshmentRequests/r1`)).status === 'delivered', water);
  check('…the member perk is counted and it’s added to the visit', (await get(`${T}/clients/c1`))?.subscription?.perkUsage?.water === 2 && (await get(`${T}/appointments/a1`))?.checkoutState?.refreshments?.length === 1);
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'r1', step: 'deliver' }));
  check('…and delivering it again does nothing at all', r.body.already && (await get(`${T}/clients/c1`)).subscription.perkUsage.water === 2 && (await get(`${T}/appointments/a1`)).checkoutState.refreshments.length === 1);
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'r2', step: 'deliver' }));
  check('a recipe uses up its parts when it’s made (ordering only took the item itself)', (await get(`${T}/inventory/beans`)).totalStock === 982 && (await get(`${T}/inventory/milk`)).totalStock === 4800 && (await get(`${T}/inventory/latte`)).totalStock === 10, [(await get(`${T}/inventory/beans`)).totalStock, (await get(`${T}/inventory/milk`)).totalStock]);
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'r3', step: 'deliver' }));
  const used = (await all(`${T}/stockCorrections`)).filter((c: any) => c.productId === 'water');
  check('one ordered before stock was taken at ordering is taken now, once, with a record', (await get(`${T}/inventory/water`)).totalStock === 19 && used.length === 1 && (await get(`${T}/refreshmentRequests/r3`)).stockMoved === true, used);
  await db.doc(`${T}/refreshmentRequests/r4`).set({ id: 'r4', clientName: 'Eve', itemId: 'water', itemName: 'Sparkling water', quantity: 3, status: 'in_progress', requestedAt: iso(2), stockMoved: true });
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'r4', step: 'cancel' }));
  check('cancelling puts back what ordering took', (await get(`${T}/inventory/water`)).totalStock === 22 && (await get(`${T}/refreshmentRequests/r4`)).stockReturned === true && (await get(`${T}/refreshmentRequests/r4`)).status === 'cancelled');
  r = await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'r4', step: 'cancel' }));
  check('…once', r.body.already && (await get(`${T}/inventory/water`)).totalStock === 22);

  await db.doc(`${T}/refreshmentRequests/q1`).set({ id: 'q1', clientName: 'Walk-in', clientId: 'guest-walkin', itemId: 'water', itemName: 'Sparkling water', quantity: 2, status: 'ready', requestedAt: iso(3), isGuestKiosk: true, priceAtRequest: 3 });
  const kioskTicket = (await POST(req({ action: 'tickets', tenantId: 't1', key }))).body.tickets.find((t: any) => t.id === 'q1');
  check('a kiosk order to be paid at the station says what to collect', kioskTicket?.collect === 6, kioskTicket);
  await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'q1', step: 'deliver' }));
  await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'q1', step: 'deliver' }));
  const sale = await all(`${T}/transactions`);
  check('…and is booked once as it’s handed over, as the desk books it', sale.length === 1 && sale[0].amount === 6 && sale[0].paymentMethod === 'Guest Kiosk Entry' && sale[0].id === 'kiosk_q1', sale);
  for (const [id, x] of [['q2', { settledBy: 'card_on_file' }], ['q3', { paidAtKiosk: true }], ['q4', { settledBy: 'balance' }], ['q5', { chargedToStation: true }], ['q6', { appointmentId: 'a9' }]] as const)
    await db.doc(`${T}/refreshmentRequests/${id}`).set({ id, clientName: 'Guest', itemId: 'water', itemName: 'Sparkling water', quantity: 1, status: 'ready', requestedAt: iso(3), isGuestKiosk: true, priceAtRequest: 3, ...x });
  const paidUp = (await POST(req({ action: 'tickets', tenantId: 't1', key }))).body.tickets.filter((t: any) => /^q[2-6]$/.test(t.id));
  for (const id of ['q2', 'q3', 'q4', 'q5', 'q6']) await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id, step: 'deliver' }));
  check('…one already paid by card, on a balance, charged to the station or on a visit shows nothing to collect and books nothing more', paidUp.length === 5 && paidUp.every((t: any) => t.collect === 0) && (await all(`${T}/transactions`)).length === 1, paidUp.map((t: any) => [t.id, t.collect]));
  check('…the desk and the dashboard hand an order over with this same server step, never one of their own', /kitchenStep\(tenantId, 'refreshmentRequests', q\.id, 'deliver'\)/.test(src('src/components/pos/desk/AssistQueue.tsx')) && /kitchenStep\(tenantId, 'refreshmentRequests', String\(\(request as any\)\.id\), 'deliver'\)/.test(src('src/app/(app)/dashboard/page.tsx')) && !/deliverRefreshment|moveStock|transactions/.test(src('src/lib/lounge-delivery.ts')));

  console.log('the guest’s own recall');
  const { POST: LOUNGE } = await import('../../src/app/api/guest-lounge/route');
  await db.doc('appointmentCheckIns/tok1').set({ tenantId: 't1', clientId: 'c7', appointmentId: 'a7' });
  const order = (id: string, x: any) => db.doc(`${T}/refreshmentRequests/${id}`).set({ id, clientId: 'c7', clientName: 'Gia', itemId: 'water', itemName: 'Sparkling water', quantity: 2, status: 'pending', requestedAt: iso(1), ...x });
  const shelf = async () => (await get(`${T}/inventory/water`)).totalStock;
  await order('g1', { stockMoved: true });
  let before = await shelf();
  r = await LOUNGE(req({ token: 'tok1', action: 'recall', requestId: 'g1' }));
  check('the guest takes back an order the kitchen hasn’t started: what ordering took goes back on the shelf, once', r.body.ok && (await shelf()) === before + 2 && (await get(`${T}/refreshmentRequests/g1`)).stockReturned === true && (await get(`${T}/refreshmentRequests/g1`)).status === 'cancelled', r.body);
  r = await LOUNGE(req({ token: 'tok1', action: 'recall', requestId: 'g1' }));
  check('…taking it back again changes nothing', r.status === 409 && (await shelf()) === before + 2);
  await order('g2', {});
  before = await shelf();
  r = await LOUNGE(req({ token: 'tok1', action: 'recall', requestId: 'g2' }));
  check('…one whose stock was never taken at ordering puts nothing back (it used to add stock that was never there)', r.body.ok && (await shelf()) === before);
  await order('g3', { stockMoved: true });
  await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'g3', step: 'claim' }));
  before = await shelf();
  r = await LOUNGE(req({ token: 'tok1', action: 'recall', requestId: 'g3' }));
  check('…once the kitchen has started it, it can’t be taken back, and nothing moves', r.status === 409 && (await shelf()) === before && (await get(`${T}/refreshmentRequests/g3`)).status === 'in_progress');
  await order('g4', { stockMoved: true, clientId: 'someone-else' });
  r = await LOUNGE(req({ token: 'tok1', action: 'recall', requestId: 'g4' }));
  check('…and only their own', r.status === 403 && (await get(`${T}/refreshmentRequests/g4`)).status === 'pending');

  console.log('one owner per order, and order up');
  check('the first kitchen screen took over the lounge’s orders', (await get(T))?.kitchenSettings?.loungeOrdersMadeBy === 'kitchen');
  manager = false;
  r = await POST(req({ action: 'maker', tenantId: 't1', maker: 'desk' }));
  check('only a manager decides who makes them', r.status === 403);
  manager = true;
  r = await POST(req({ action: 'maker', tenantId: 't1', maker: 'desk' }));
  check('…not while a lounge order is being made (it would drop off one screen without landing on the other)', r.status === 409 && /being made right now/.test(r.body.error) && (await get(T)).kitchenSettings.loungeOrdersMadeBy === 'kitchen', r.body);
  await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'g3', step: 'cancel' }));
  r = await POST(req({ action: 'maker', tenantId: 't1', maker: 'desk' }));
  await order('m1', { stockMoved: true });
  let up = (await POST(req({ action: 'tickets', tenantId: 't1', key }))).body.tickets;
  check('when the desk makes lounge orders, the kitchen screen doesn’t show them (never made twice)', r.body.maker === 'desk' && !up.some((t: any) => t.col === 'refreshmentRequests') && up.some((t: any) => t.col === 'kdsTickets'), up.map((t: any) => t.id));
  await POST(req({ action: 'maker', tenantId: 't1', maker: 'kitchen' }));
  up = (await POST(req({ action: 'tickets', tenantId: 't1', key }))).body.tickets;
  check('…and when the kitchen makes them, it does', up.some((t: any) => t.id === 'm1'));
  // The front desk, signed in, hands an order over with the very same step (no key, their own name).
  await POST(req({ action: 'act', tenantId: 't1', key, col: 'refreshmentRequests', id: 'm1', step: 'ready' }));
  r = await POST(req({ action: 'act', tenantId: 't1', col: 'refreshmentRequests', id: 'm1', step: 'carry' }));
  let m1 = await get(`${T}/refreshmentRequests/m1`);
  check('“I’ll take it” from the desk: still ready, with who’s carrying it, and the guest sees it’s on its way', r.body.ok && m1.status === 'ready' && m1.carriedBy === 'Ana Ruiz' && !!m1.bringingOutAt, m1);
  r = await POST(req({ action: 'act', tenantId: 't1', col: 'refreshmentRequests', id: 'm1', step: 'carry' }));
  check('…a second “I’ll take it” at the same time changes nothing (one person carries it)', r.body.already === true && (await get(`${T}/refreshmentRequests/m1`)).carriedBy === 'Ana Ruiz');
  r = await POST(req({ action: 'act', tenantId: 't1', col: 'refreshmentRequests', id: 'm1', step: 'drop' }));
  check('…“Let someone else” frees it, and the guest no longer reads “on its way”', r.body.ok && (await get(`${T}/refreshmentRequests/m1`)).carriedBy === null && (await get(`${T}/refreshmentRequests/m1`)).bringingOutAt === null);
  r = await POST(req({ action: 'act', tenantId: 't1', col: 'refreshmentRequests', id: 'm1', step: 'deliver' }));
  m1 = await get(`${T}/refreshmentRequests/m1`);
  check('…“Delivered” from the desk is the kitchen’s own step, under the desk’s name', r.body.ok && m1.status === 'delivered' && m1.deliveredBy?.name === 'Ana Ruiz' && m1.deliveredBy?.via === 'Ana Ruiz', m1);
  r = await POST(req({ action: 'act', tenantId: 't1', col: 'refreshmentRequests', id: 'm1', step: 'deliver' }));
  check('…and a second screen delivering it changes nothing', r.body.already === true);
  r = await POST(req({ action: 'act', tenantId: 't1', col: 'refreshmentRequests', id: 'm1', step: 'carry' }));
  check('…nobody carries what’s already been handed over', r.body.already === true);
  r = await POST(req({ action: 'pin', tenantId: 't1', pin: '4821' }));
  const r4: any = await POST(req({ action: 'forget', tenantId: 't1' }));
  check('a signed-in team member can’t take a screen’s PIN pass or stop a screen without its key', r.status === 401 && r4.status === 401);
  actor.isRenter = true;
  r = await POST(req({ action: 'act', tenantId: 't1', col: 'kdsTickets', id: 'k4', step: 'claim' }));
  actor.isRenter = false;
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', isActive: false }, { merge: true });
  const r5: any = await POST(req({ action: 'act', tenantId: 't1', col: 'kdsTickets', id: 'k4', step: 'claim' }));
  await db.doc(`${T}/staff/m1`).set({ isActive: true }, { merge: true });
  check('a renter, or someone switched off, can’t move the shop’s tickets', r.status === 403 && r5.status === 403 && (await get(`${T}/kdsTickets/k4`)).status === 'pending');

  console.log('a whole course at once');
  r = await POST(req({ action: 'bump', tenantId: 't1', key, step: 'ready', tickets: [{ col: 'kdsTickets', id: 'k1' }, { col: 'kdsTickets', id: 'k2' }, { col: 'kdsTickets', id: 'k3' }] }));
  check('a course marked ready together', r.body.ok && r.body.moved === 3 && (await all(`${T}/kdsTickets`)).filter((t: any) => t.eventId === 'e1' && t.status === 'ready').length === 3, r.body);
  r = await POST(req({ action: 'bump', tenantId: 't1', key, step: 'ready', tickets: [{ col: 'kdsTickets', id: 'k1' }] }));
  check('…again, nothing moves (and nothing is called a failure)', r.body.moved === 0 && r.body.of === 1 && r.body.failed === 0);
  r = await POST(req({ action: 'bump', tenantId: 't1', key, step: 'ready', tickets: [{ col: 'kdsTickets', id: 'deleted-one' }] }));
  check('…nor is a ticket someone has deleted', r.body.failed === 0 && r.body.moved === 0);
  r = await POST(req({ action: 'bump', tenantId: 't1', key, step: 'deliver', tickets: [{ col: 'kdsTickets', id: 'k1' }, { col: 'kdsTickets', id: 'k2' }, { col: 'kdsTickets', id: 'k3' }] }));
  check('…and served together', r.body.moved === 3 && (await all(`${T}/kdsTickets`)).filter((t: any) => t.eventId === 'e1' && t.status === 'delivered').length === 3);
  r = await POST(req({ action: 'bump', tenantId: 't1', key, step: 'cancel', tickets: [{ col: 'kdsTickets', id: 'k4' }] }));
  check('a whole group can’t be cancelled at once', r.status === 400 && (await get(`${T}/kdsTickets/k4`)).status === 'pending');

  console.log('closed and stopped');
  await db.doc(T).set({ suspended: true }, { merge: true });
  r = await POST(req({ action: 'tickets', tenantId: 't1', key }));
  const r2: any = await POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k4', step: 'claim' }));
  check('a paused business has its kitchen screen closed', r.status === 403 && r.body.closed && r2.status === 403 && (await get(`${T}/kdsTickets/k4`)).status === 'pending', r.body);
  await db.doc(T).set({ suspended: false }, { merge: true });
  r = await POST(req({ action: 'forget', tenantId: 't1', key }));
  r = await POST(req({ action: 'tickets', tenantId: 't1', key }));
  check('a stopped screen is refused until it’s set up again', r.status === 401 && /set it up again/.test(r.body.error), r.body);

  console.log('desk sales reach the kitchen');
  const { POST: complete } = await import('../../src/app/api/checkout/complete/route');
  await fresh();
  await db.doc(T).set({ salesTax: { configured: true, productsPct: 0 } }, { merge: true });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez' });
  await db.doc(`${T}/inventory/latte`).set({ name: 'Latte', type: 'refreshment', msrp: 5, totalStock: 10 });
  await db.doc(`${T}/inventory/oil`).set({ name: 'Cuticle oil', msrp: 12, totalStock: 10 });
  r = await complete(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'latte', type: 'product', quantity: 2, price: 5, name: 'Latte' }, { id: 'oil', type: 'product', quantity: 1, price: 12, name: 'Cuticle oil' }], expectedTotal: 22, payment: { method: 'cash', amountTendered: 22 } }));
  let kt = await all(`${T}/kdsTickets`);
  check('a latte sold at the desk goes to the kitchen (a shelf product doesn’t), its stock already taken', r.status === 200 && kt.length === 1 && kt[0].source === 'pos' && kt[0].quantity === 2 && kt[0].stockMoved === true && kt[0].status === 'pending' && kt[0].guestName === 'Maya Lopez' && (await get(`${T}/inventory/latte`)).totalStock === 8, { status: r.status, body: r.body, kt });
  // A table's tab: two lattes, one already sent to the kitchen when it was ordered on the tab.
  await db.doc(`${T}/services/svc1`).set({ name: 'Table', price: 0, duration: 60 });
  await db.doc(`${T}/appointments/v1`).set({ clientId: 'c1', clientName: 'Maya Lopez', serviceId: 'svc1', serviceName: 'Table', price: 0, status: 'checked_in', startTime: iso(30), staffId: 'm1',
    tab: [{ lineId: 'l1', itemId: 'latte', itemType: 'product', name: 'Latte', price: 5, quantity: 1, kdsId: 'tab_v1_l1' }] });
  r = await complete(req({ tenantId: 't1', clientId: 'c1', appointmentIds: ['v1'], items: [{ id: 'latte', type: 'product', quantity: 2, price: 5, name: 'Latte' }], payment: { method: 'cash', amountTendered: 10 } }));
  kt = (await all(`${T}/kdsTickets`)).filter((t: any) => t.saleId && t.saleId !== kt[0].saleId);
  check('paying a table’s tab doesn’t send again what the tab already sent (only the one that wasn’t)', r.status === 200 && kt.length === 1 && kt[0].quantity === 1, { status: r.status, body: r.body, kt });

  console.log('the screen itself');
  const M = await import('../../src/lib/modules');
  check('the kitchen screen and floor board come with Events too (an event with a meal needs them)', M.pageVisible({ modules: { hospitality: false } }, '/kds') && M.pageVisible({ modules: { hospitality: false } }, '/floor')
    && !M.pageVisible({ modules: { hospitality: false, classes_events: false } }, '/kds') && !M.pageVisible({ modules: { hospitality: false } }, '/host'));
  check('“Order up” shows on the front desk, the dashboard and the host stand', /<ReadyToRun /.test(src('src/components/pos/desk/DeskPOS.tsx')) && /<ReadyToRun /.test(src('src/app/(app)/dashboard/page.tsx')) && /<ReadyToRun /.test(src('src/app/(app)/host/page.tsx')));
  check('the desk lists lounge orders only when the desk makes them', /useAssistQueue\(e\.firestore, e\.tenantId \|\| null, loungeByDesk\)/.test(src('src/components/pos/desk/DeskPOS.tsx')) && /loungeByDesk \? query/.test(src('src/components/pos/desk/AssistQueue.tsx')));
  check('the dashboard cancels with the server step too (what ordering took goes back)', /kitchenStep\(tenantId, 'refreshmentRequests', requestId, 'cancel'\)/.test(src('src/app/(app)/dashboard/page.tsx')));
  check('the unused leftovers are gone', !['src/components/events/EventModeKiosk.tsx', 'src/components/events/EventModeScreen.tsx', 'src/components/events/EventQuotePanel.ts', 'src/components/events/manifest-tickets-tab.tsx', 'src/components/TableTab.tsx'].some((f) => existsSync(f)));
  const page = src('src/app/kds/[tenantId]/page.tsx');
  check('it reads and moves tickets only through the server, on its own key', /\/api\/kitchen/.test(page) && !/useCollection|firebase\/firestore|writeBatch|updateDoc/.test(page));
  check('…sends a pass for who’s working, never a name; stops on the server before forgetting here', /staffPass: staff\.pass/.test(page) && !/\{ staff \}/.test(page) && /if \(d\.ok \|\| status === 401\) \{ forgetHere/.test(page));
  check('…a tap’s buttons never stay stuck, and a refresh from before a tap is dropped', /finally \{ acted\.current\+\+; setBusy/.test(page) && /if \(at !== acted\.current\) return;/.test(page));
  check('no forced PIN and no lock after 30 minutes; a PIN only names who did it', !/INACTIVITY|useInactivityLogout|PinLogin/.test(page) && /Who’s working\?/.test(page));
  check('a sound for every new ticket, the first one too (it used to wait for a second)', /seen\.current/.test(page) && !/lastCount !== 0/.test(page) && /chime\(/.test(page));
  check('grouped by course or dish, with a whole group moved at once', /By course/.test(page) && /By dish/.test(page) && /action: 'bump'/.test(page) && /All \{toReady\.length\} ready/.test(page));
  check('allergies shown big, from the list and from typed notes', /AllergyBanner/.test(page) && /allergyFlags\(/.test(page) && /Allergy in their note/.test(page));
  check('one event’s tickets from ?event=, and back to all', /get\('event'\)/.test(page) && /Show every ticket/.test(page));
  check('the screen never names a kind of business', !/\b(studio|salon|stylist|booth|chair)\b/i.test(page.replace(/^\s*\/\/.*$/gm, '')));
  check('printing goes through the tablet; the open relay to any address is gone', !existsSync('src/app/api/thermal-print/route.ts') && !/thermal-print/.test(page));
  const manifest = src('src/app/(app)/events/[eventId]/manifest/page.tsx');
  check('the event screen opens its own kitchen screen', /\/kds\/\$\{tenantId\}\?event=/.test(manifest));
  check('late arrivals’ tickets carry their allergy note and guest note', /isDelta: true/.test(manifest) && /allergyNote: g\.allergyNote \|\| null, hasCriticalAllergy[^\n]*notes: g\.guestNote[^\n]*isDelta: true/.test(manifest));
  check('the old unused copy of the event screen is gone', !existsSync('src/components/events/EventManifest.tsx'));
  const login = src('src/app/(auth)/login/page.tsx');
  check('signing in to set it up comes back to the screen (only ever a page of this app)', /get\('next'\)/.test(login) && /!n\.includes\('\/\/'\)/.test(login));
  const words = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  check('nothing names the tools it was made with', ![page, src('src/app/api/kitchen/route.ts'), src('src/lib/kitchen.ts')].some((s) => words.test(s)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
