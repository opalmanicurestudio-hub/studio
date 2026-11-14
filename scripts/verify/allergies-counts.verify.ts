// Checks allergies that follow the guest and live dish counts (L20 round 3): lib/allergens, lib/dish-counts,
// lib/dish-counts-server, api/menu, api/kitchen, api/tab, and the screens that use them.
// - A profile's words become allergens ("Nuts" is both kinds; "Celiac" is gluten and wheat); what isn't one is kept as
//   written; "EpiPen" makes it severe. A table's allergy is on a seat or the whole table.
// - A dish with an allergen someone it reaches can't have is a conflict; a dish for the whole table reaches everyone.
//   Its ticket carries each allergen, how serious, and what the menu says the dish contains of them; a change asks the
//   station to note it again, unless the dish is already ready.
// - The kitchen can't mark a dish with an allergy ready (one at a time, in a bump, from holding, or served straight from
//   the line) until someone taps Allergy noted. A seat change carries the new seat's allergies; a remake asks again.
// - A counted dish: tonight's number (the kitchen's, else the menu's) less what's been rung in tonight; a void never
//   started gives one back, one started (or made again) doesn't. At zero it's sold out everywhere, under the count's name,
//   and back when the count goes up; a sold-out set by hand is never undone by the count.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/allergies-counts.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

let db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { ...actor, isManager: manager, role: manager ? 'manager' : 'staff' }, tenant: {} }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager } }),
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

(async () => {
  const A = await import('../../src/lib/allergens');
  console.log('allergens');
  check('“Nuts” on a profile means both kinds; tree nuts and peanuts named are only that kind', A.keysFromWords('Nuts').join() === 'treenuts,peanuts' && A.keysFromWords('Tree nuts').join() === 'treenuts' && A.keysFromWords('Peanuts').join() === 'peanuts' && A.keysFromWords('almonds').join() === 'treenuts',
    [A.keysFromWords('Nuts'), A.keysFromWords('Tree nuts')]);
  check('dairy is milk, celiac is gluten and wheat, shrimp is shellfish, seafood is fish and shellfish; kiwi isn’t one of the list', A.keysFromWords('Dairy').join() === 'milk' && A.keysFromWords('Celiac').join() === 'wheat,gluten' && A.keysFromWords('Shrimp').join() === 'shellfish'
    && A.keysFromWords('Seafood').join() === 'fish,shellfish' && A.keysFromWords('Kiwi').length === 0 && A.keysFromWords('Shellfish').join() === 'shellfish');
  const p = A.profileAllergy({ name: 'Maria Lopez', intel: { allergies: { flags: ['Nuts', 'Kiwi'], notes: 'Carries an EpiPen' } } }, 'Sam', '2026-11-14T20:00:00Z');
  check('a regular’s profile becomes one allergy for the whole table: the allergens, the rest in their words, severe when it says so', !!p && p.seat === null && p.keys.join() === 'treenuts,peanuts' && p.other === 'Kiwi, Carries an EpiPen' && p.severe && p.from === 'profile' && p.by === 'Maria Lopez’s profile', p);
  check('…nothing when the profile has none', A.profileAllergy({ name: 'Ben', intel: { allergies: { flags: [] } } }, 'Sam', '') === null);
  const list: any[] = [{ id: 'a', seat: '2', keys: ['treenuts'], other: null, severe: true, from: 'asked', by: 'Sam', at: '' }, { id: 'b', seat: null, keys: ['shellfish'], other: 'mustard', severe: false, from: 'asked', by: 'Sam', at: '' }, { id: 'c', seat: '3', keys: ['fish'], other: null, severe: false, from: 'asked', by: 'Sam', at: '' }];
  const bream = ['fish', 'treenuts'];
  check('a dish warns for the seat it’s for (and the whole table’s), not the others; for the table it reaches everyone', A.conflicts(bream, list, '2').keys.join() === 'treenuts' && A.conflicts(bream, list, '1').keys.length === 0 && A.conflicts(bream, list, null).keys.join() === 'fish,treenuts' && A.conflicts(['shellfish'], list, '4').keys.join() === 'shellfish');
  const tf = A.ticketAllergyFields(list, '2', bream);
  check('the ticket for seat 2: its allergies and the whole table’s, how serious, and what the dish contains of them', JSON.stringify(tf.allergies) === JSON.stringify([{ name: 'Tree nuts', severity: 'severe' }, { name: 'Shellfish' }, { name: 'mustard' }]) && tf.contains.join() === 'Tree nuts', tf);
  check('…said plainly to the server', A.allergyPhrase(['treenuts'], true) === 'a severe tree nut allergy' && A.allergyPhrase(['eggs', 'milk'], false) === 'an egg and milk allergy' && A.allergyLine(list[0]) === 'Seat 2: tree nuts, severe');
  const pend = { status: 'pending', allergies: tf.allergies, contains: tf.contains, allergyNotedAt: 'x' };
  check('the same allergies change nothing; new ones ask the station to note it again, a plate waiting at the pass too; one already out is left as it was', A.ticketAllergyPatch(pend, list, '2', bream) === null
    && A.ticketAllergyPatch(pend, list, '3', bream)?.allergyNotedAt === null && A.ticketAllergyPatch({ ...pend, status: 'ready' }, list, '3', bream)?.allergyNotedAt === null && A.ticketAllergyPatch({ ...pend, status: 'delivered' }, list, '3', bream) === null);
  check('a table’s saved allergies are cleaned (an unknown allergen dropped, an empty one left out)', A.tableAllergies({ allergies: [{ seat: '1', keys: ['milk', 'kiwi'] }, { seat: '2', keys: [] }, 'x'] }).length === 1 && A.tableAllergies({ allergies: [{ seat: '1', keys: ['milk', 'kiwi'] }] })[0].keys.join() === 'milk');

  const C = await import('../../src/lib/dish-counts');
  console.log('counts');
  check('the menu’s number, unless tonight has its own (a number, or not counted tonight)', C.dailyCountOf({ dailyCount: 14 }) === 14 && C.dailyCountOf({}) === null && C.dailyCountOf({ dailyCount: 5000 }) === null
    && C.startOf({ dailyCount: 14 }, { rib: 10 }, 'rib') === 10 && C.startOf({ dailyCount: 14 }, { rib: null }, 'rib') === null && C.startOf({ dailyCount: 14 }, {}, 'rib') === 14 && C.startOf({}, { rib: 6 }, 'rib') === 6);
  check('what’s used: rung in, a held course too; a void the kitchen never started gives it back; one started, or made again, doesn’t', C.ticketUses({ status: 'unfired' }) && C.ticketUses({ status: 'delivered' }) && !C.ticketUses({ status: 'cancelled' })
    && C.ticketUses({ status: 'cancelled', claimedAt: 'x' }) && C.ticketUses({ status: 'cancelled', remadeAs: 'y' }) && C.usedByItem([{ menuItemId: 'rib', quantity: 2 }, { menuItemId: 'rib', status: 'cancelled' }, { itemId: 'rib' }]).get('rib') === 3);
  const rows = C.countRows([{ id: 'rib', x: { name: 'Short rib', dailyCount: 4 } }, { id: 'pie', x: { name: 'Pie' } }], {}, new Map([['rib', 5]]), () => false);
  check('only counted dishes, never below zero left', rows.length === 1 && rows[0].left === 0 && rows[0].used === 5 && C.leftWords(rows[0]) === 'Sold out' && C.leftWords({ left: 3 }) === '3 left');

  console.log('the menu: allergens, the nightly count, tonight’s counts');
  const NC = await import('../../src/lib/night-close-server');
  await db.doc(T).set({ name: 'North Loft', timezone: 'America/New_York' });
  const tenant = await get(T);
  const b = NC.nightBounds(tenant, NC.tonight(tenant));
  const at = (min: number) => new Date(Date.parse(b.start) + min * 60000).toISOString();
  await db.doc(`${T}/inventory/rib`).set({ name: 'Short rib', type: 'refreshment', price: 36, category: 'Mains' });
  await db.doc(`${T}/inventory/bream`).set({ name: 'Grilled bream', type: 'refreshment', price: 31, category: 'Mains' });
  const MenuApi = await import('../../src/app/api/menu/route');
  let r: any = await MenuApi.POST(req({ tenantId: 't1', action: 'save', itemId: 'bream', item: { name: 'Grilled bream', price: 31, allergens: ['fish', 'treenuts', 'kiwi'] } }));
  check('an allergen not on the list is refused', r.status === 400 && /from the list/.test(r.body.error), r.body);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'save', itemId: 'bream', item: { name: 'Grilled bream', price: 31, allergens: ['treenuts', 'fish', 'fish'], dailyCount: '1000' } }));
  check('a nightly count past 999 is refused', r.status === 400 && /up to 999/.test(r.body.error), r.body);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'save', itemId: 'bream', item: { name: 'Grilled bream', price: 31, allergens: ['treenuts', 'fish', 'fish'], dailyCount: '3' } }));
  check('saved: what it contains (each once, in the list’s order) and how many each night', r.body.ok && r.body.item.allergens.join() === 'fish,treenuts' && r.body.item.dailyCount === 3 && (await get(`${T}/inventory/bream`)).dailyCount === 3, r.body);
  check('…and the desk and tables charge what the menu says (the Inventory price set from it)', (await get(`${T}/inventory/bream`)).msrp === 31);
  await db.doc(`${T}/inventory/bream`).set({ msrp: 29 }, { merge: true });
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'save', itemId: 'bream', item: { name: 'Grilled bream', price: 31, words: 'With almonds' } }));
  check('…but a save that doesn’t change the price leaves a different desk price alone', (await get(`${T}/inventory/bream`)).msrp === 29 && r.body.item.allergensSet === true);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'save', itemId: 'bream', item: { name: 'Grilled bream', price: 32 } }));
  check('…and a new menu price is the desk’s too', (await get(`${T}/inventory/bream`)).msrp === 32);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'save', itemId: 'rib', item: { name: 'Short rib', price: 36, allergens: [] } }));
  check('“None of these” is kept apart from “nobody has said”', r.body.item.allergensSet === true && r.body.item.allergens.length === 0 && (await MenuApi.POST(req({ tenantId: 't1', action: 'list' }))).body.menu.length === 2);
  manager = false;
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'save', itemId: 'bream', item: { name: 'Grilled bream', price: 31, allergens: [] } }));
  const r2 = await MenuApi.POST(req({ tenantId: 't1', action: 'count', itemId: 'bream', value: 10 }));
  check('only a manager changes what a dish contains, or tonight’s count from the Menu page', r.status === 403 && r2.status === 403);
  await db.doc(`${T}/kdsTickets/t1`).set({ id: 't1', menuItemId: 'bream', quantity: 1, status: 'pending', createdAt: at(30) });
  await db.doc(`${T}/kdsTickets/t2`).set({ id: 't2', menuItemId: 'bream', quantity: 1, status: 'cancelled', createdAt: at(31) });
  await db.doc(`${T}/kdsTickets/t3`).set({ id: 't3', menuItemId: 'bream', quantity: 2, status: 'delivered', createdAt: at(-20) });
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'counts', fresh: true }));
  check('anyone on the team sees what’s left tonight: three made, one rung in (not last night’s, not one taken back before it started)', r.body.ok && r.body.counts.length === 1 && r.body.counts[0].left === 2 && r.body.counts[0].used === 1 && !(await get(`${T}/inventory/bream`)).soldOut, r.body);
  await db.doc(`${T}/kdsTickets/t4`).set({ id: 't4', menuItemId: 'bream', quantity: 2, status: 'unfired', createdAt: at(40) });
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'counts' }));
  check('read again within a few seconds, the counts come from what was just read (every screen asks often)', r.body.counts[0].left === 2);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'counts', fresh: true }));
  let breamDoc: any = await get(`${T}/inventory/bream`);
  check('at zero it’s sold out on every menu, by the count (a held course counts: it’s promised), and said so to the screens', r.body.counts[0].left === 0 && r.body.counts[0].soldOut && breamDoc.soldOut === true && breamDoc.soldOutBy === C.COUNT_BY && r.body.soldOut.includes('bream'), breamDoc);
  manager = true;
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'count', itemId: 'bream', value: 5 }));
  breamDoc = await get(`${T}/inventory/bream`);
  check('a manager raises tonight’s count: it’s back on the menu by itself', r.body.ok && r.body.counts[0].start === 5 && r.body.counts[0].left === 2 && breamDoc.soldOut === false && (await get(`${T}/dishCounts/${r.body.day}`)).counts.bream === 5, r.body);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'count', itemId: 'bream', value: -1 }));
  check('a count below zero is refused', r.status === 400);
  await db.doc(`${T}/inventory/bream`).set({ soldOut: true, soldOutBy: 'Pass', soldOutUntil: new Date(Date.now() + 3600000).toISOString() }, { merge: true });
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'counts', fresh: true }));
  check('a sold-out the kitchen set by hand stays sold out (the count only undoes its own)', (await get(`${T}/inventory/bream`)).soldOut === true);
  await db.doc(`${T}/inventory/bream`).set({ soldOut: false, soldOutBy: null, soldOutUntil: null }, { merge: true });
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'count', itemId: 'bream', value: 'off' }));
  check('“not counted tonight” takes it off the counts', r.body.ok && r.body.counts.length === 0);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'count', itemId: 'bream', value: 'menu' }));
  check('…and “the menu’s number” brings the nightly count back', r.body.ok && r.body.counts[0]?.start === 3);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'list' }));
  check('the Menu page gets tonight’s counts and whether tables are asked about allergies (on unless turned off)', Array.isArray(r.body.counts) && r.body.counts[0]?.id === 'bream' && r.body.service.askAllergies === true);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'service', askAllergies: false }));
  check('…a business turns the asking off', r.body.ok && r.body.service.askAllergies === false && (await get(T)).kitchenSettings.askAllergies === false);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'service', askAllergies: 'no' }));
  check('…only on or off', r.status === 400);

  console.log('the kitchen: Allergy noted');
  const Kitchen = await import('../../src/app/api/kitchen/route');
  r = await Kitchen.POST(req({ action: 'pair', tenantId: 't1', name: 'Grill' }));
  const key = r.body.key;
  await db.doc(`${T}/kdsTickets/al1`).set({ id: 'al1', source: 'tab', visitId: 'v1', menuItemId: 'bream', menuItemName: 'Grilled bream', status: 'pending', createdAt: at(50), allergies: [{ name: 'Tree nuts', severity: 'severe' }], contains: ['Tree nuts'] });
  await db.doc(`${T}/kdsTickets/al2`).set({ id: 'al2', source: 'event', menuItemName: 'Soup', status: 'pending', createdAt: at(51), note: 'no dairy please' });
  r = await Kitchen.POST(req({ action: 'tickets', tenantId: 't1', key }));
  const tk = (r.body.tickets || []).find((t: any) => t.id === 'al1');
  check('a ticket says its allergy, what the dish contains, and that nobody has noted it yet; tonight’s counts come with the tickets', tk?.contains?.join() === 'Tree nuts' && tk?.allergyNotedAt === null && Array.isArray(r.body.counts) && r.body.counts[0]?.id === 'bream', { tk, counts: r.body.counts });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'al1', step: 'ready' }));
  check('it can’t be marked ready until someone taps Allergy noted (said as an allergy hold, for screens without the button)', r.status === 409 && r.body.allergy === true && /Allergy noted/.test(r.body.error) && (await get(`${T}/kdsTickets/al1`)).status === 'pending', r.body);
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'al1', step: 'deliver' }));
  check('…nor served straight from the line', r.status === 409);
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'al2', step: 'ready' }));
  check('…an allergy only written in a note counts too', r.status === 409);
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'al1', step: 'claim' }));
  check('starting it is fine', r.body.ok && (await get(`${T}/kdsTickets/al1`)).status === 'in_progress');
  await db.doc(`${T}/holdingBins/hb1`).set({ id: 'hb1', itemId: 'bream', name: 'Grilled bream', quantity: 4, status: 'held', startedAt: new Date().toISOString(), holdMinutes: 30, expiresAt: new Date(Date.now() + 1800000).toISOString() });
  r = await Kitchen.POST(req({ action: 'fromHold', tenantId: 't1', key, col: 'kdsTickets', id: 'al1', binId: 'hb1' }));
  check('…taking it from a held batch waits for it too', r.status === 409 && (await get(`${T}/holdingBins/hb1`)).quantity === 4, r.body);
  await db.doc(`${T}/staff/s9`).set({ name: 'Marco Bell', role: 'staff', pin: '4821' });
  const pass = (await Kitchen.POST(req({ action: 'pin', tenantId: 't1', key, pin: '4821' }))).body.pass;
  r = await Kitchen.POST(req({ action: 'allergyNoted', tenantId: 't1', key, col: 'kdsTickets', id: 'al1', staffPass: pass }));
  check('a screen that doesn’t say what it showed is asked to refresh', r.status === 400 && !(await get(`${T}/kdsTickets/al1`)).allergyNotedAt);
  r = await Kitchen.POST(req({ action: 'allergyNoted', tenantId: 't1', key, col: 'kdsTickets', id: 'al1', seen: A.allergySig({ allergies: [{ name: 'Tree nuts' }], contains: ['Tree nuts'] }), staffPass: pass }));
  check('…and one that showed an older allergy than the ticket has now is refused, to read it again', r.status === 409 && /changed/.test(r.body.error) && !(await get(`${T}/kdsTickets/al1`)).allergyNotedAt, r.body);
  r = await Kitchen.POST(req({ action: 'allergyNoted', tenantId: 't1', key, col: 'kdsTickets', id: 'al1', seen: A.allergySig(await get(`${T}/kdsTickets/al1`)), staffPass: pass }));
  let al1: any = await get(`${T}/kdsTickets/al1`);
  check('Allergy noted, with who and when', r.body.ok && al1.allergyNotedBy === 'Marco Bell' && !!al1.allergyNotedAt, al1);
  r = await Kitchen.POST(req({ action: 'allergyNoted', tenantId: 't1', key, col: 'kdsTickets', id: 'al1', seen: A.allergySig(al1) }));
  check('…a second tap changes nothing', r.body.already && (await get(`${T}/kdsTickets/al1`)).allergyNotedBy === 'Marco Bell');
  r = await Kitchen.POST(req({ action: 'allergyNoted', tenantId: 't1', key, col: 'refreshmentRequests', id: 'al1', seen: '' }));
  check('…only on the kitchen’s own tickets', r.status === 400);
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'al1', step: 'ready' }));
  check('…then it can be marked ready', r.body.ok && (await get(`${T}/kdsTickets/al1`)).status === 'ready');
  r = await Kitchen.POST(req({ action: 'count', tenantId: 't1', key, itemId: 'bream', value: 8, staffPass: pass }));
  check('the kitchen sets tonight’s count, under the name of whoever’s working', r.body.ok && r.body.counts[0]?.start === 8 && (await get(`${T}/dishCounts/${NC.tonight(tenant)}`)).changedBy.bream === 'Marco Bell', r.body);

  console.log('the tab: a seat change, a remake');
  const Tab = await import('../../src/app/api/tab/route');
  await db.doc(`${T}/appointments/v1`).set({ id: 'v1', isTable: true, tableName: '5', status: 'servicing', allergies: list,
    tab: [{ lineId: 'l1', itemId: 'bream', itemType: 'product', name: 'Grilled bream', price: 31, quantity: 1, seat: '2', kdsId: 'al3', allergens: bream }] });
  await db.doc(`${T}/kdsTickets/al3`).set({ id: 'al3', source: 'tab', visitId: 'v1', lineId: 'l1', menuItemId: 'bream', menuItemName: 'Grilled bream', seatNumber: '2', status: 'pending', createdAt: at(60), ...A.ticketAllergyFields(list, '2', bream), allergyNotedAt: 'x', allergyNotedBy: 'Marco Bell' });
  r = await Tab.POST(req({ tenantId: 't1', action: 'seat', visitId: 'v1', lineId: 'l1', seat: '3' }));
  let al3: any = await get(`${T}/kdsTickets/al3`);
  check('moved to seat 3: the ticket takes seat 3’s allergies and what the dish contains of them, and asks the station again', r.body.ok && al3.seatNumber === '3' && al3.allergies.some((a: any) => a.name === 'Fish') && !al3.allergies.some((a: any) => a.name === 'Tree nuts') && al3.contains.join() === 'Fish' && al3.allergyNotedAt === null, al3);
  await db.doc(`${T}/kdsTickets/al3`).set({ status: 'in_progress', claimedAt: 'y', allergyNotedAt: 'z', allergyNotedBy: 'Marco Bell' }, { merge: true });
  r = await Tab.POST(req({ tenantId: 't1', action: 'remake', visitId: 'v1', lineId: 'l1', reason: 'Dropped or spilled' }));
  const fresh: any = await get(`${T}/kdsTickets/${r.body.ticket}`);
  check('a remake carries the table’s allergies as they stand now and asks for Allergy noted again', r.body.ok && fresh.allergies.some((a: any) => a.name === 'Fish') && fresh.contains.join() === 'Fish' && !fresh.allergyNotedAt && !fresh.allergyNotedBy && !fresh.claimedAt, fresh);

  console.log('the tab: a table’s allergies, saved on the server');
  await db.doc(`${T}/clients/c1`).set({ name: 'Maria Lopez', intel: { allergies: { flags: ['Tree nuts'], notes: 'EpiPen' } } });
  await db.doc(`${T}/appointments/v2`).set({ id: 'v2', isTable: true, tableName: '7', status: 'servicing', clientId: 'c1',
    tab: [{ lineId: 'm1', itemId: 'bream', itemType: 'product', name: 'Grilled bream', price: 31, quantity: 1, seat: '2', kdsId: 'tk1', allergens: bream },
      { lineId: 'm2', itemId: 'rib', itemType: 'product', name: 'Short rib', price: 36, quantity: 1, seat: '1', kdsId: 'tk2', allergens: [] }] });
  await db.doc(`${T}/kdsTickets/tk1`).set({ id: 'tk1', source: 'tab', visitId: 'v2', status: 'ready', allergies: [], createdAt: at(70) });
  await db.doc(`${T}/kdsTickets/tk2`).set({ id: 'tk2', source: 'tab', visitId: 'v2', status: 'delivered', allergies: [], createdAt: at(70) });
  r = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'seed', visitId: 'v2' }));
  let v2: any = await get(`${T}/appointments/v2`); let tk1: any = await get(`${T}/kdsTickets/tk1`);
  check('a regular’s profile allergies come to the table once, read by the server, and reach a plate already at the pass', r.body.ok && v2.allergiesSeeded === true && v2.allergies.length === 1 && v2.allergies[0].from === 'profile' && v2.allergies[0].severe
    && tk1.allergies.some((a: any) => a.name === 'Tree nuts') && tk1.allergyNotedAt === null, { v2, tk1 });
  r = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'seed', visitId: 'v2' }));
  check('…only once', (await get(`${T}/appointments/v2`)).allergies.length === 1);
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'tk1', step: 'deliver' }));
  check('a plate at the pass whose allergy changed can’t be served until it’s noted', r.status === 409 && (await get(`${T}/kdsTickets/tk1`)).status === 'ready', r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'save', visitId: 'v2', allergy: { seat: '1', keys: ['sesame'], severe: false } }));
  const r3: any = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'save', visitId: 'v2', allergy: { seat: '3', keys: ['milk'] } }));
  v2 = await get(`${T}/appointments/v2`);
  check('two saves one after another both stand: each allergy is added by itself, never the whole list written over', r.body.ok && r3.body.ok && v2.allergies.length === 3 && v2.allergiesAsked === true, v2.allergies);
  check('…a plate already out isn’t changed', (await get(`${T}/kdsTickets/tk2`)).allergies.length === 0);
  const sesame = v2.allergies.find((a: any) => a.keys.includes('sesame'));
  r = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'save', visitId: 'v2', allergy: { ...sesame, seat: '2' } }));
  v2 = await get(`${T}/appointments/v2`); tk1 = await get(`${T}/kdsTickets/tk1`);
  check('changing one keeps its place and who first said it; the seat’s tickets follow', v2.allergies.length === 3 && v2.allergies.find((a: any) => a.id === sesame.id)?.seat === '2' && tk1.allergies.some((a: any) => a.name === 'Sesame'), { a: v2.allergies, tk1 });
  r = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'remove', visitId: 'v2', id: sesame.id }));
  check('…and one can be taken off', (await get(`${T}/appointments/v2`)).allergies.length === 2 && !(await get(`${T}/kdsTickets/tk1`)).allergies.some((a: any) => a.name === 'Sesame'));
  r = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'save', visitId: 'v2', allergy: { seat: '9x', keys: ['milk'] } }));
  const r4: any = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'save', visitId: 'v2', allergy: { seat: '1', keys: [] } }));
  check('a seat that isn’t one, or an allergy with nothing in it, is refused', r.status === 400 && r4.status === 400);
  await db.doc(`${T}/appointments/v3`).set({ id: 'v3', isTable: true, tableName: '8', status: 'servicing', clientId: 'c404', tab: [] });
  r = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'seed', visitId: 'v3' }));
  check('a guest with no profile: the table is marked as looked at, with nothing added', r.body.ok && (await get(`${T}/appointments/v3`)).allergiesSeeded === true && (await get(`${T}/appointments/v3`)).allergies.length === 0);

  console.log('a tablet that hadn’t heard of a new allergy');
  await db.doc(`${T}/appointments/v4`).set({ id: 'v4', isTable: true, tableName: '6', status: 'servicing', allergies: [{ id: 'z', seat: '1', keys: ['peanuts'], severe: true, from: 'asked', by: 'Sam', at: '' }],
    tab: [{ lineId: 'n1', itemId: 'rib', itemType: 'product', name: 'Short rib', price: 36, quantity: 1, seat: '1', kdsId: 'st1', allergens: [] }, { lineId: 'n2', itemId: 'rib', itemType: 'product', name: 'Short rib', price: 36, quantity: 1, seat: '1', kdsId: 'st2', allergens: [] }] });
  await db.doc(`${T}/kdsTickets/st1`).set({ id: 'st1', source: 'tab', visitId: 'v4', lineId: 'n1', menuItemName: 'Short rib', status: 'in_progress', allergies: [], createdAt: at(80) });
  await db.doc(`${T}/kdsTickets/st2`).set({ id: 'st2', source: 'tab', visitId: 'v4', lineId: 'n2', menuItemName: 'Short rib', status: 'pending', allergies: [], createdAt: at(80) });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'st1', step: 'ready' }));
  const st1: any = await get(`${T}/kdsTickets/st1`);
  check('a ticket made without the seat’s allergy is caught when it’s marked ready: brought up to date, and not ready until it’s noted', r.status === 409 && st1.status === 'in_progress' && st1.allergies.some((a: any) => a.name === 'Peanuts'), { body: r.body, st1 });
  r = await Kitchen.POST(req({ action: 'allergyNoted', tenantId: 't1', key, col: 'kdsTickets', id: 'st2', seen: A.allergySig({ allergies: [] }) }));
  const st2: any = await get(`${T}/kdsTickets/st2`);
  check('…and when someone taps Allergy noted on what the screen showed: brought up to date, and looked at again', r.status === 409 && !st2.allergyNotedAt && st2.allergies.some((a: any) => a.name === 'Peanuts'), { body: r.body, st2 });
  await db.doc(`${T}/kdsTickets/st3`).set({ id: 'st3', source: 'tab', visitId: 'v4', lineId: 'n3', menuItemName: 'Short rib', status: 'pending', allergies: [], createdAt: at(81) });
  await db.doc(`${T}/appointments/v4`).set({ tab: [...(await get(`${T}/appointments/v4`)).tab, { lineId: 'n3', itemId: 'rib', itemType: 'product', name: 'Short rib', price: 36, quantity: 1, seat: '1', kdsId: 'st3', allergens: [] }] }, { merge: true });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'st3', step: 'claim' }));
  check('…and when someone starts it, so nobody begins it without seeing the allergy', r.status === 409 && (await get(`${T}/kdsTickets/st3`)).status === 'pending' && (await get(`${T}/kdsTickets/st3`)).allergies.length === 1);
  await db.doc(`${T}/appointments/v4`).set({ allergies: [] }, { merge: true });
  await db.doc(`${T}/kdsTickets/st1`).set({ allergyNotedAt: 'x', allergyNotedBy: 'Marco Bell' }, { merge: true });
  r = await Tab.POST(req({ tenantId: 't1', action: 'remake', visitId: 'v4', lineId: 'n1', reason: 'Not right' }));
  check('a remake after the table’s allergy was taken off carries none', r.body.ok && (await get(`${T}/kdsTickets/${r.body.ticket}`)).allergies.length === 0);
  const ms = src('src/app/api/menu/route.ts'), ttx = src('src/components/host/TableTab.tsx');
  const fl = src('src/app/floor/[tenantId]/page.tsx'), rtr = src('src/components/kitchen/ReadyToRun.tsx');
  check('the floor and the desk, which have no Allergy noted button, say to ask the kitchen or the pass', /d\.allergy \?/.test(fl) && /Ask the kitchen or the pass to note it/.test(fl) && /r\.allergy \?/.test(rtr));
  check('a nightly count changed on the Menu page is read fresh; a profile that couldn’t be loaded says so, with Try again', /forgetCounts\(tenantId\)/.test(ms) && /couldn’t be loaded/.test(ttx) && /setSeedFailed\(true\)/.test(ttx));

  console.log('where it shows');
  const tt = src('src/components/host/TableTab.tsx'), tl = src('src/lib/table-tab.ts'), kds = src('src/app/kds/[tenantId]/page.tsx'), menu = src('src/app/(app)/menu/page.tsx'), co = src('src/app/api/checkout/complete/route.ts');
  check('the table tab warns before ringing in a conflict, the safe choice first, and tells the kitchen when it’s rung in anyway', /conflicts\(it\.allergens/.test(tt) && /Pick something else/.test(tt) && /Ring it in, the kitchen will make it safe/.test(tt) && /allergies \}\);/.test(tt) && /ticketAllergyFields\(o\.allergies/.test(tl));
  check('…asks once before the first order (when the business has it on), and changes the table’s allergies only through the server', /askAllergiesOf\(tenant\)/.test(tt) && /op: 'seed'/.test(tt) && /action: 'allergies', op/.test(tt) && !/setDoc|writeBatch/.test(tt) && !/allergies:/.test(tl.replace(/allergies: al\.allergies/, '')));
  check('…warns when nobody has said what’s in a dish and someone it reaches has a severe allergy; asks before taking an allergy off; checks a counted dish again before ringing it in', /unknown: true/.test(tt) && /Nobody has said what’s in/.test(tt) && /setRemoving\(a\.id\)/.test(tt) && /fresh: true/.test(tt));
  check('…and a sold-out or counted-out dish can’t be rung in, with what’s left beside each counted one', /outOf\(it\)/.test(tt) && /leftWords\(cnt\)/.test(tt) && /action: 'counts'/.test(tt));
  check('the kitchen screen: Allergy noted in place of Ready, the bump says what’s left to note, Counts to set tonight’s numbers', /Allergy noted<\/button>/.test(kds) && /action: 'allergyNoted'/.test(kds) && /to note first/.test(kds) && /function CountsSheet/.test(kds) && /action: 'count'/.test(kds));
  check('…and it now gets the stations and held courses the server sends', /unfired: d\.unfired \|\| \[\], stations: d\.stations \|\| \[\]/.test(kds));
  check('the Menu page: what a dish contains (or none of these) and how many are made each night', /Contains<\/legend>/.test(menu) && /None of these/.test(menu) && /Made each night/.test(menu) && /tonight<\/span>/.test(menu));
  const ex = src('src/components/kitchen/ExpoView.tsx');
  check('the pass: a run waits while a plate’s allergy isn’t noted, and the pass can note it there', /Note the allergy first/.test(ex) && /onNote\(t\)/.test(ex) && /seen: allergySig\(t\)/.test(kds));
  const rules = src('firestore.rules');
  const blk = (m: string) => rules.slice(rules.indexOf(m), rules.indexOf('match /', rules.indexOf(m) + 10));
  check('the security rules: a kitchen ticket is only made from a browser (waiting, its allergy not marked seen), never changed; tonight’s counts are the server’s; a table’s allergies change only through the server',
    /allow update, delete: if false;/.test(blk('match /tenants/{tenantId}/kdsTickets/{ticketId}')) && /allergyNotedAt', null\) == null/.test(blk('match /tenants/{tenantId}/kdsTickets/{ticketId}'))
    && /allow write: if false;/.test(blk('match /tenants/{tenantId}/dishCounts/{day}')) && /'kdsTickets', 'dishCounts'/.test(rules)
    && /hasAny\(\['allergies', 'allergiesSeeded', 'allergiesAsked'\]\)/.test(rules));
  check('a regular’s allergies go with a café sale’s kitchen ticket', /profileAllergy\(client/.test(co) && /ticketAllergyFields\(\[prof\]/.test(co));

  const part = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from) + 1) > 0 ? text.indexOf(to, text.indexOf(from) + 1) : undefined);
  const ui = [part(tt, 'function AllergySheet', 'function AllergyWarn'), part(tt, 'function AllergyWarn', '\n}\n'), part(kds, 'function CountsSheet', '// ─── Holding'), src('src/components/menu/TableServiceSettings.tsx'), part(tt, 'aria-label="Allergies"', 'records.length > 0')];
  check('new screens keep to the house style', ui.every((x) => x.length > 200) && !ui.some((x) => /\{\/\*|uppercase|font-black| · /.test(x)) && !ui.some((x) => /\b(studio|salon|stylist|booth)\b/i.test(x)));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
