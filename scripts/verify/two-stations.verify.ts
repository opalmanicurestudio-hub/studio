// Checks one item made at two stations, and New item on the Menu page (round 31, design canvas "One item, two
// stations"):
// - lib/two-stations: the other stations kept clean (the business's own, never its own one, each once, with a part);
//   a part's ticket and name; where a dish is from its parts (the slowest part; a part cancelled alone doesn't hold it)
// - the Menu page saving them (api/menu 'save' alsoAt), and New item (api/menu 'create'): on the menu and in Inventory
//   in one step, counted when it's counted, one item however often it's sent, never a second of the same name
// - a table's tab (lib/table-tab addToTab, api/tab): the part's ticket at its station, held and fired with its dish,
//   moved with it to another seat, told of a new allergy, and taken off with it
// - the floor and the tab screen seeing the dish as far along as its slowest part; the counter, the drive-thru and the
//   desk sending the part to its station too; the kitchen screen saying which is which
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/two-stations.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

const db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') { class StripeMock { paymentIntents = { create: async () => ({ id: 'pi_x' }), retrieve: async () => ({ id: 'pi_x' }) }; refunds = { create: async () => ({}) }; } return Object.assign(StripeMock, { default: StripeMock }); }
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor: { ...actor, isManager: manager, role: manager ? 'manager' : 'staff' }, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager } }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const TS = await import('../../src/lib/two-stations');
  console.log('the other stations');
  const st = ['Grill', 'Fryer', 'Bar'];
  check('kept clean: one of the business’s stations, never its own, each once, with a part, up to two', JSON.stringify(TS.cleanAlsoAt([{ station: 'fryer', part: '  the   fries ' }, { station: 'Grill', part: 'x' }, { station: 'Fryer', part: 'again' }, { station: 'Pastry', part: 'cake' }, { station: 'Bar', part: '' }], st, 'Grill'))
    === JSON.stringify([{ station: 'Fryer', part: 'the fries' }]) && TS.cleanAlsoAt([{ station: 'Fryer', part: 'a' }, { station: 'Bar', part: 'b' }, { station: 'Grill', part: 'c' }], st, null).length === 2);
  check('a part’s ticket and name', TS.partTicketId('tab_v1_ab12', 0) === 'tab_v1_ab12_s1' && TS.partName('Steak frites', 'the fries') === 'Steak frites: the fries' && TS.lineTicketIds({ kdsId: 'k1', alsoKdsIds: ['k1_s1', 'bad id'] }).join() === 'k1,k1_s1');
  check('a dish is as far along as its slowest part', TS.combinedStatus(['ready', 'in_progress']) === 'in_progress' && TS.combinedStatus(['ready', 'ready']) === 'ready' && TS.combinedStatus(['delivered', 'ready']) === 'ready'
    && TS.combinedStatus(['unfired', 'pending']) === 'unfired' && TS.combinedStatus(['ready', 'cancelled']) === 'ready' && TS.combinedStatus(['cancelled', 'cancelled']) === 'cancelled');
  const f = TS.foldParts({ k1: { status: 'ready', readyAt: '2026-11-15T18:01:00Z' }, k1_s1: { status: 'in_progress', partOf: 'k1' }, k2: { status: 'ready', readyAt: '2026-11-15T18:00:00Z' }, k2_s1: { status: 'ready', readyAt: '2026-11-15T18:03:00Z', partOf: 'k2' } } as any);
  check('…folded in: the steak ready and its fries still frying is still being made; both ready is ready, at the later', f.k1.status === 'in_progress' && f.k1.readyAt === null && f.k2.status === 'ready' && f.k2.readyAt === '2026-11-15T18:03:00Z' && f.k1_s1.status === 'in_progress');

  console.log('the Menu page');
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC', kitchenSettings: { stations: st, screenOn: true }, modules: { hospitality: true }, retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', job: 'manager' });
  await db.doc(`${T}/inventory/steak`).set({ type: 'refreshment', name: 'Steak frites', category: 'Mains', price: 24, msrp: 24, totalStock: 30, station: 'Grill' });
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  const save = (x: any) => menuApi(req({ tenantId: 't1', action: 'save', itemId: x.id, item: x }));
  let r: any = await save({ id: 'steak', name: 'Steak frites', section: 'Mains', price: 24, alsoAt: [{ station: 'Pastry', part: 'cake' }] });
  check('another station that isn’t one of yours is said', r.status === 400 && /one of yours/.test(r.body.error), r.body);
  r = await save({ id: 'steak', name: 'Steak frites', section: 'Mains', price: 24, alsoAt: [{ station: 'Grill', part: 'the steak' }] });
  check('…nor the one it’s made at', r.status === 400);
  r = await save({ id: 'steak', name: 'Steak frites', section: 'Mains', price: 24, alsoAt: [{ station: 'Fryer', part: '' }] });
  check('…and a part needs a few words', r.status === 400);
  r = await save({ id: 'steak', name: 'Steak frites', section: 'Mains', price: 24, alsoAt: [{ station: 'Fryer', part: 'the fries' }] });
  check('saved: the fries at the fryer, read back on the item', r.body.ok && JSON.stringify((await get(`${T}/inventory/steak`)).alsoAt) === JSON.stringify([{ station: 'Fryer', part: 'the fries' }]) && r.body.item.alsoAt[0]?.station === 'Fryer', r.body);
  manager = false;
  r = await save({ id: 'steak', name: 'Steak frites', section: 'Mains', price: 24, alsoAt: [] });
  check('…only by a manager', r.status === 403);
  manager = true;

  console.log('New item');
  const create = (b: any) => menuApi(req({ tenantId: 't1', action: 'create', ...b }));
  r = await create({ name: '', price: '9' });
  check('a new item needs a name', r.status === 400 && /name/.test(r.body.error));
  r = await create({ name: 'Fish tacos', price: '' });
  check('…and a price ($0 is fine)', r.status === 400 && /price/.test(r.body.error));
  r = await create({ name: 'Fish tacos', price: '14.50', section: 'Mains', station: 'Pastry' });
  check('…made at one of your stations', r.status === 400 && /stations/.test(r.body.error));
  r = await create({ name: 'Fish tacos', price: '14.50', section: 'Mains', station: 'grill', tapKey: 'tapAbc12345' });
  const ft = await get(`${T}/inventory/menu_tapAbc12345`);
  check('on the menu and in Inventory in one step: a refreshment with its price (at the desk too), section and station', r.body.ok && ft?.type === 'refreshment' && ft.name === 'Fish tacos' && ft.price === 14.5 && ft.msrp === 14.5 && ft.category === 'Mains' && ft.station === 'Grill' && ft.showInConcierge === true && ft.createdVia === 'menu'
    && r.body.item.id === 'menu_tapAbc12345' && r.body.item.onMenu === true, { b: r.body, ft });
  r = await create({ name: 'Fish tacos', price: '14.50', section: 'Mains', station: 'grill', tapKey: 'tapAbc12345' });
  check('…sent twice, one item', r.body.ok && r.body.already === true && (await all(`${T}/inventory`)).filter((x: any) => x.name === 'Fish tacos').length === 1, r.body);
  r = await create({ name: 'fish TACOS', price: '10' });
  check('…never a second of the same name', r.status === 400 && /on the menu already/.test(r.body.error), r.body);
  r = await create({ name: 'Bottled lager', price: '6', section: 'Drinks', onHand: '48' });
  const lager = (await all(`${T}/inventory`)).find((x: any) => x.name === 'Bottled lager');
  check('…counted when it’s counted: what’s on hand, with a line in the stock ledger', r.body.ok && lager?.totalStock === 48 && (await all(`${T}/stockCorrections`)).some((x: any) => x.productId === lager.id && x.type === 'counted' && x.change === 48), lager);
  r = await create({ name: 'Cola', price: '3', onHand: '-2' });
  check('…a count that isn’t a number is said', r.status === 400);
  manager = false;
  r = await create({ name: 'Cola', price: '3' });
  check('…only a manager adds items', r.status === 403);
  manager = true;
  r = await menuApi(req({ tenantId: 't1', action: 'list' }));
  check('…and it’s in the Menu page’s list', r.body.ok && r.body.menu.some((m: any) => m.name === 'Fish tacos') && r.body.menu.some((m: any) => m.name === 'Bottled lager'));

  console.log('a table’s tab');
  const TT = await import('../../src/lib/table-tab');
  webMock.reset();
  const item = { id: 'steak', type: 'product' as const, name: 'Steak frites', price: 24, station: 'Grill', course: { n: 3, name: 'Mains', hold: true }, alsoAt: [{ station: 'Fryer', part: 'the fries' }] };
  const line = await TT.addToTab({} as any, 't1', 'v1', { tableName: 'Table 12', guestName: 'Marsh' }, item, { by: 'Lee Park', lineId: 'ln1abc', seat: '2' });
  const main = webMock.read(`tenants/t1/kdsTickets/tab_v1_ln1abc`); const part = webMock.read(`tenants/t1/kdsTickets/tab_v1_ln1abc_s1`);
  check('rung in: the steak to the grill, its fries to the fryer, both held with the course', main?.madeAt === 'Grill' && main?.status === 'unfired' && part?.madeAt === 'Fryer' && part?.status === 'unfired' && part?.menuItemName === 'Steak frites: the fries' && part?.partOf === 'tab_v1_ln1abc' && part?.partFor === 'Steak frites' && part?.partFrom === 'Grill' && part?.lineId === 'ln1abc' && part?.seatNumber === '2', { main, part });
  check('…joined to the one line (one price, one item on the bill)', JSON.stringify(line.alsoKdsIds) === JSON.stringify(['tab_v1_ln1abc_s1']) && line.price === 24 && JSON.stringify(main?.alsoAt) === JSON.stringify([{ station: 'Fryer', part: 'the fries' }]), line);
  // On to the server: the visit and both tickets as the tab saved them.
  await db.doc(`${T}/appointments/v1`).set({ id: 'v1', isTable: true, tableName: 'Table 12', status: 'servicing', clientName: 'Marsh', tab: [webMock.read('tenants/t1/appointments/v1')!.tab[0]] });
  await db.doc(`${T}/kdsTickets/tab_v1_ln1abc`).set(main); await db.doc(`${T}/kdsTickets/tab_v1_ln1abc_s1`).set(part);
  const Tab = await import('../../src/app/api/tab/route');
  r = await Tab.POST(req({ tenantId: 't1', action: 'fire', visitId: 'v1', course: 3 }));
  check('the course fired: the steak and its fries both go to their stations', r.body.ok && (await get(`${T}/kdsTickets/tab_v1_ln1abc`)).status === 'pending' && (await get(`${T}/kdsTickets/tab_v1_ln1abc_s1`)).status === 'pending', r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'seat', visitId: 'v1', lineId: 'ln1abc', seat: '4' }));
  check('moved to seat 4: both tickets go with it', r.body.ok && (await get(`${T}/kdsTickets/tab_v1_ln1abc`)).seatNumber === '4' && (await get(`${T}/kdsTickets/tab_v1_ln1abc_s1`)).seatNumber === '4', r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'allergies', op: 'save', visitId: 'v1', allergy: { seat: '4', keys: ['sesame'], severe: false } }));
  const pa: any = await get(`${T}/kdsTickets/tab_v1_ln1abc_s1`);
  check('a new allergy for seat 4: the fryer’s ticket is told too', r.body.ok && (pa.allergies || []).some((a: any) => /sesame/i.test(String(a.name || a.label || a))) && (await get(`${T}/kdsTickets/tab_v1_ln1abc`)).allergies.length > 0, pa);
  await db.doc(`${T}/kdsTickets/tab_v1_ln1abc`).set({ status: 'in_progress' }, { merge: true });
  r = await Tab.POST(req({ tenantId: 't1', action: 'remake', visitId: 'v1', lineId: 'ln1abc', reason: 'Dropped or spilled' }));
  const nid = r.body.ticket; const ln = (await get(`${T}/appointments/v1`)).tab[0];
  const np: any = await get(`${T}/kdsTickets/${nid}_s1`);
  check('made again (dropped): the whole plate, the steak and its fries, each at its own station again', r.body.ok && (await get(`${T}/kdsTickets/${nid}`))?.status === 'pending' && np?.status === 'pending' && np?.partOf === nid && np?.madeAt === 'Fryer'
    && (await get(`${T}/kdsTickets/tab_v1_ln1abc_s1`)).status === 'cancelled' && ln.kdsId === nid && JSON.stringify(ln.alsoKdsIds) === JSON.stringify([`${nid}_s1`]), { b: r.body, np, ln });
  r = await Tab.POST(req({ tenantId: 't1', action: 'void', visitId: 'v1', lineId: 'ln1abc', reason: 'Ordered by mistake' }));
  check('taken off: the steak and its fries both come off the screens, and the line off the check', r.body.ok && (await get(`${T}/kdsTickets/${nid}`)).status === 'cancelled' && (await get(`${T}/kdsTickets/${nid}_s1`)).status === 'cancelled' && (await get(`${T}/appointments/v1`)).tab.length === 0, r.body);

  console.log('the counter and the desk');
  await db.doc(`${T}/inventory/steak`).set({ makeSeconds: 600 }, { merge: true });
  const { POST: counter } = await import('../../src/app/api/counter/route');
  const P = (b: any) => counter(req({ tenantId: 't1', channel: 'counter', ...b }));
  const c1 = (await P({ action: 'car', carKey: 'k1' })).body;
  await P({ action: 'add', orderId: c1.orderId, itemId: 'steak', tapKey: 't1' });
  r = await P({ action: 'send', orderId: c1.orderId });
  const ct = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c1.orderId);
  const cMain = ct.find((t: any) => !t.partOf), cPart = ct.find((t: any) => t.partOf);
  check('a counter order: the steak at its station, the fries at the fryer, one of two', r.body.ok && ct.length === 2 && cPart?.madeAt === 'Fryer' && cPart?.menuItemName === 'Steak frites: the fries' && cPart?.partOf === cMain?.id && cMain?.alsoAt?.[0]?.station === 'Fryer' && cMain?.lines === 2 && cPart?.lines === 2, ct);
  check('…the steak’s stock taken once', (await get(`${T}/inventory/steak`)).totalStock === 29);
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez' });
  const { POST: checkout } = await import('../../src/app/api/checkout/complete/route');
  r = await checkout(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'steak', type: 'product', quantity: 1, price: 24, name: 'Steak frites' }], payment: { method: 'cash', amountTendered: 50 } }));
  const pos = (await all(`${T}/kdsTickets`)).filter((t: any) => t.source === 'pos');
  check('a sale at the desk: the fries go to the fryer too, for the steak', r.status === 200 && pos.length === 2 && pos.some((t: any) => t.partOf && t.madeAt === 'Fryer' && t.menuItemName === 'Steak frites: the fries') && pos.some((t: any) => !t.partOf && t.alsoAt?.length === 1), { s: r.status, b: r.body, pos });

  console.log('the kitchen and tonight’s counts');
  const DC = await import('../../src/lib/dish-counts');
  check('tonight’s counts count the dish once, never its part', DC.usedByItem([{ menuItemId: 'steak', status: 'pending' }, { menuItemId: 'steak', status: 'pending', partOf: 'x' }]).get('steak') === 1);
  const kr = src('src/app/api/kitchen/route.ts');
  check('a part marked ready, served or stopped takes none of the dish’s ingredients (its own ticket takes them all)', /!r\.channel && !r\.partOf && r\.partsUsed !== true && \(step === 'ready'/.test(kr) && /!r\.channel && !r\.partOf && r\.partsUsed !== true && step === 'cancel'/.test(kr)
    && /partFor: item\.name, partsUsed: true/.test(src('src/lib/table-tab.ts')) && /partFor: name, partsUsed: true/.test(src('src/lib/floor-server.ts')));
  check('the guest’s own pass folds the parts too', /const tickets: Record<string, any> = foldParts\(raw\)/.test(src('src/app/api/table-pay/route.ts')));
  // Only the fryer has started: a server's void needs a manager, as for any dish the kitchen has started.
  await TT.addToTab({} as any, 't1', 'v2', { tableName: 'Table 4', guestName: 'Diaz' }, { ...item, course: null }, { by: 'Lee Park', lineId: 'ln2abc' });
  await db.doc(`${T}/appointments/v2`).set({ id: 'v2', isTable: true, tableName: 'Table 4', status: 'servicing', clientName: 'Diaz', tab: webMock.read('tenants/t1/appointments/v2')!.tab });
  await db.doc(`${T}/kdsTickets/tab_v2_ln2abc`).set(webMock.read('tenants/t1/kdsTickets/tab_v2_ln2abc')!); await db.doc(`${T}/kdsTickets/tab_v2_ln2abc_s1`).set({ ...webMock.read('tenants/t1/kdsTickets/tab_v2_ln2abc_s1')!, status: 'in_progress' });
  manager = false; actor.isManager = false;
  r = await Tab.POST(req({ tenantId: 't1', action: 'void', visitId: 'v2', lineId: 'ln2abc', reason: 'Ordered by mistake' }));
  check('only the fryer has started: a void needs a manager, as for any dish the kitchen started', r.status === 403 && /PIN/.test(r.body.error), r.body);
  manager = true; actor.isManager = true;
  r = await save({ id: 'meal', name: 'Steak meal', section: 'Mains', price: 30, combo: true, comboParts: ['steak'], alsoAt: [{ station: 'Fryer', part: 'x' }] });
  check('a combo isn’t also made at another station (its parts go to theirs)', r.status === 400 && /combo/.test(r.body.error), r.body);
  // Two managers adding the same new item at once: one item.
  const [ra, rb] = await Promise.all([create({ name: 'Pork belly', price: '19', tapKey: 'tapRace0001' }), create({ name: 'Pork Belly', price: '19', tapKey: 'tapRace0002' })]);
  check('two managers adding the same item at once make one', [ra, rb].filter((x: any) => x.body.ok).length === 1 && (await all(`${T}/inventory`)).filter((x: any) => /pork belly/i.test(x.name)).length === 1, [ra.body, rb.body]);

  console.log('the screens');
  const tt = src('src/components/host/TableTab.tsx'), fl = src('src/lib/floor-server.ts'), kds = src('src/app/kds/[tenantId]/page.tsx'), kit = src('src/lib/kitchen.ts'), mp = src('src/app/(app)/menu/page.tsx'), nis = src('src/components/menu/NewItemSheet.tsx');
  check('the tab screen and the floor see a dish as far along as its slowest part', /const folded = foldParts\(full\)/.test(tt) && /alsoAt: alsoAtOf\(x, stations\)/.test(tt) && /foldParts\(Object\.fromEntries/.test(fl) && /lineTicketIds\(l\)\.map\(\(id\) => tickets\.get\(id\)\)/.test(fl));
  check('…a paper ticket puts the part on its own station’s paper', /partName\(l\.name, a\.part\), a\.station, false/.test(tt));
  check('the kitchen screen says which is which: “Also at Fryer: the fries”, and “For Steak frites, from Grill”', /say\('Also at \{station\}: \{part\}'/.test(kds) && /say\('For \{dish\}, from \{station\}'/.test(kds) && /partOf: typeof r\.partOf === 'string'/.test(kit));
  check('the item’s editor has Also made at (up to two), and the Menu page New item', /Also made at/.test(mp) && /Add another station/.test(mp) && /also\.length < 2/.test(mp) && /New item<\/button>/.test(mp) && /action: 'create', \.\.\.body/.test(mp) && /setEditing\(d\.item\)/.test(mp));
  check('…New item: name, price, section, station and how many, then its editor', /Add to the menu/.test(nis) && /How many you have/.test(nis) && /aria-modal="true"/.test(nis) && /min-h-\[44px\]/.test(nis));
  check('new screens keep the house style', ![nis, src('src/lib/two-stations.ts')].some((x) => /uppercase|font-black|\{\/\*| · /.test(x)));
  const L = await import('../../src/lib/screen-lang');
  check('…and say it in Spanish too', L.tr('es', 'Also at {station}: {part}', { station: 'Fryer', part: 'the fries' }) === 'También en Fryer: the fries' && L.hasSpanish('For {dish}, from {station}'));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
