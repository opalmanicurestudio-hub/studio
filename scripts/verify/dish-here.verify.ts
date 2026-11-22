// Checks tonight's counts at each location (design board "Stock at each store, and tonight's counts at each location";
// lib/dish-counts-server readCounts / soldOutByCount / liveCounts / setTonightCount at, api/kitchen, api/menu, the
// kitchen screen's counts, the table tab).
// - With more than one location, each counts its own: its own number tonight, its own tickets counted down, and at zero
//   it's sold out there only; raised again, back there (only what its count sold out). Each on its own clock.
// - Without a location, the business's count, as before.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/dish-here.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }), staffOrServer: async () => true });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const DC = await import('../../src/lib/dish-counts-server');
  const NS = await import('../../src/lib/night-close-server');
  const HS = await import('../../src/lib/here-server');
  const C = await import('../../src/lib/menu-choices');
  const { POST: KITCHEN } = await import('../../src/app/api/kitchen/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true });
  await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true, timezone: 'Pacific/Kiritimati' });
  await db.doc(`${T}/inventory/rib`).set({ type: 'refreshment', name: 'Short rib', category: 'Mains', price: 30, totalStock: 100, dailyCount: 6 });
  HS.forgetLocations('t1');
  const house = await get(T); const harborT = HS.zonedFor(house, { timezone: 'Pacific/Kiritimati' });
  const dayH = NS.tonight(harborT); const dayW = NS.tonight(house);
  const K = (b: any) => KITCHEN(req({ tenantId: 't1', ...b })) as any;
  const keyH = (await K({ action: 'pair', name: 'Harbor pass', locationId: 'harbor' })).body.key;
  const keyM = (await K({ action: 'pair', name: 'Main pass', locationId: 'main' })).body.key;

  console.log('each location’s own number');
  let r = await K({ action: 'count', key: keyH, itemId: 'rib', value: 2 });
  const doc = await get(`${T}/dishCounts/${dayH}_harbor`);
  check('the kitchen at Harbor Rd sets its own number tonight, on its own clock', r.body.ok && doc?.counts?.rib === 2 && doc?.locationId === 'harbor' && !(await get(`${T}/dishCounts/${dayW}`))?.counts?.rib, doc);
  check('…and gets its own counts back', r.body.counts.find((x: any) => x.id === 'rib')?.start === 2);
  r = await K({ action: 'tickets', key: keyM });
  check('Main St: the menu’s own number, untouched', r.body.ok && r.body.counts.find((x: any) => x.id === 'rib')?.start === 6 && r.body.place === 'Main St', r.body.counts);

  console.log('counted down by its own tickets');
  const start = new Date(Date.parse(NS.nightBounds(harborT, dayH).start) + 3600000).toISOString();
  const startW = new Date(Date.parse(NS.nightBounds(house, dayW).start) + 3600000).toISOString();
  await db.doc(`${T}/kdsTickets/h1`).set({ menuItemId: 'rib', menuItemName: 'Short rib', quantity: 2, status: 'pending', createdAt: start, locationId: 'harbor' });
  await db.doc(`${T}/kdsTickets/m1`).set({ menuItemId: 'rib', menuItemName: 'Short rib', quantity: 1, status: 'pending', createdAt: startW, locationId: 'main' });
  DC.forgetCounts('t1');
  const lh = await DC.liveCounts(db, 't1', harborT, undefined, { at: 'harbor', fresh: true });
  const rib = await get(`${T}/inventory/rib`);
  check('Harbor Rd’s two tickets use up its 2: sold out there only', lh.rows.find((x) => x.id === 'rib')?.left === 0 && C.outWhere(rib, 'harbor') === 'here' && C.outWhere(rib, 'main') === null && rib.soldOut !== true, [lh.rows, rib.outAt]);
  check('…marked as its count’s doing', (await get(`${T}/dishCounts/${dayH}_harbor`))?.countOut?.rib === true);
  const lm = await DC.liveCounts(db, 't1', house, undefined, { at: 'main', fresh: true });
  check('Main St counts only its own ticket: 5 left, still on', lm.rows.find((x) => x.id === 'rib')?.left === 5 && !lm.soldOut.includes('rib'), lm.rows);
  r = await K({ action: 'count', key: keyH, itemId: 'rib', value: 4 });
  check('raised at Harbor Rd: back there', r.body.ok && C.outWhere(await get(`${T}/inventory/rib`), 'harbor') === null && !(await get(`${T}/dishCounts/${dayH}_harbor`))?.countOut?.rib);

  console.log('sold out by hand stays');
  await db.doc(`${T}/inventory/rib`).update({ 'outAt.main': new Date(Date.now() + 3600000).toISOString() });
  await DC.liveCounts(db, 't1', house, undefined, { at: 'main', fresh: true });
  check('sold out at Main St by hand, with plenty counted: its count never brings it back', C.outWhere(await get(`${T}/inventory/rib`), 'main') === 'here');

  console.log('the Menu page and the table');
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b })) as any;
  r = await Mn({ action: 'counts', locationId: 'harbor' });
  check('the Menu page’s counts for the location picked in the app', r.body.ok && r.body.counts.find((x: any) => x.id === 'rib')?.start === 4 && r.body.day === dayH, r.body);
  r = await Mn({ action: 'count', locationId: 'main', itemId: 'rib', value: 9 });
  check('…and its number set there', r.body.ok && (await get(`${T}/dishCounts/${dayW}_main`))?.counts?.rib === 9);
  r = await Mn({ action: 'counts' });
  check('no location picked: the business’s, as before', r.body.ok && r.body.counts.find((x: any) => x.id === 'rib')?.start === 6 && r.body.day === dayW, r.body.counts);
  await db.doc(`${T}/inventory/pie`).set({ type: 'refreshment', name: 'Pie', category: 'Desserts', price: 8, totalStock: 100, dailyCount: 2 });
  await db.doc(`${T}/kdsTickets/p1`).set({ menuItemId: 'pie', menuItemName: 'Pie', quantity: 1, status: 'pending', createdAt: startW, locationId: 'main' });
  await db.doc(`${T}/kdsTickets/p2`).set({ menuItemId: 'pie', menuItemName: 'Pie', quantity: 1, status: 'pending', createdAt: startW, locationId: 'harbor' });
  DC.forgetCounts('t1');
  const whole = await DC.liveCounts(db, 't1', house, undefined, { fresh: true });
  const pie = await get(`${T}/inventory/pie`);
  check('the whole business’s count, adding up every location, never sells something out everywhere', whole.rows.find((x) => x.id === 'pie')?.left === 0 && pie.soldOut !== true && C.outWhere(pie, 'main') === null, [whole.rows, pie]);
  console.log('tables, the floor, and counting with no location');
  await db.doc(`${T}/appointments/vt`).set({ isTable: true, locationId: 'harbor', startTime: start });
  await db.doc(`${T}/kdsTickets/tab1`).set({ source: 'tab', visitId: 'vt', menuItemId: 'rib', menuItemName: 'Short rib', quantity: 1, status: 'pending', createdAt: start });
  DC.forgetCounts('t1');
  const lh2 = await DC.liveCounts(db, 't1', harborT, undefined, { at: 'harbor', fresh: true });
  check('a table’s ticket (which doesn’t say where) counts where its table is', lh2.rows.find((x) => x.id === 'rib')?.used === 3, lh2.rows);
  const FW = await import('../../src/lib/floor-word-server');
  await db.doc(`${T}/inventory/rib`).update({ 'outAt.harbor': new Date(Date.now() + 3600000).toISOString() });
  const wH = await FW.floorWordNow(db, 't1', harborT, { at: 'harbor', fresh: true }); const wM = await FW.floorWordNow(db, 't1', house, { at: 'main', fresh: true });
  check('the floor’s 86 list at each location is its own', wH.eightySix.some((e: any) => e.id === 'rib' && e.out) && !wM.eightySix.some((e: any) => e.id === 'pie' && e.out) && wM.eightySix.some((e: any) => e.id === 'rib'), [wH.eightySix, wM.eightySix]);
  await FW.setFloorNote(db, 't1', house, 'No more rib tonight', 'Chef');
  const wNote = await FW.floorWordNow(db, 't1', harborT, { at: 'harbor', fresh: true, house });
  check('the kitchen’s message is the business’s night, read the same at a location on another clock', wNote.note?.text === 'No more rib tonight', wNote.note);
  const keyNone = (await K({ action: 'pair', name: 'Every pass' })).body.key;
  r = await K({ action: 'count', key: keyNone, itemId: 'rib', value: 3 });
  check('a count from a screen with no location, with more than one: refused, saying how', r.status === 409 && /Each location counts its own/.test(r.body.error), r.body);
  await K({ action: 'count', key: keyH, itemId: 'rib', value: 1 }); DC.forgetCounts('t1');
  await DC.liveCounts(db, 't1', harborT, undefined, { at: 'harbor', fresh: true });
  r = await K({ action: 'count', key: keyH, itemId: 'rib', value: 'off' });
  check('not counted there any more: one its count sold out is back there now', r.body.ok && !(await get(`${T}/dishCounts/${dayH}_harbor`))?.countOut?.rib);
  const sv = src('src/lib/dish-counts-server.ts');
  check('the count’s mark is written before it sells out, and let go when it’s back on by hand', sv.indexOf("countOut: { [r.id]: true }") < sv.indexOf("{ itemId: r.id, out: true, where: 'here' }") && sv.includes('} else if (r.left > 0 && !w && countOut[r.id]) {'));
  check('the host stand and a server’s tables ask for their location’s 86 list', src('src/app/(app)/host/page.tsx').includes("action: 'floor', locationId:") && src('src/app/(app)/tables/page.tsx').includes("action: 'nudges', mine, locationId:"));
  const tab = src('src/components/host/TableTab.tsx'); const kds = src('src/app/kds/[tenantId]/page.tsx');
  check('the table tab reads its table’s location’s counts', tab.includes("const countsAt = String(visit?.locationId || '');") && (tab.match(/\.\.\.\(countsAt \? \{ locationId: countsAt \} : \{\}\)/g) || []).length === 2);
  check('the kitchen screen names its location and says sold out there only', kds.includes('Tonight’s counts{place ? `, ${place}` : \'\'}') && kds.includes('At zero it’s sold out at ${place} only') && kds.includes("place: typeof d.place === 'string' ? d.place : null"));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
