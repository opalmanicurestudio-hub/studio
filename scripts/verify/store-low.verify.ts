// Checks running low at each store, part 1 (design board "Running low at each store"; lib/store-stock reorderAtOf,
// lowStores; lib/store-stock-server setStorePoint; lib/store-low-server; api/inventory/stores 'point'; api/cron/store-low;
// components/products/StoreStockPanel).
// - Each store has its own number to order more at (a manager's); the panel shows it and which stores are low.
// - Every hour, what's newly at or under its number at a store is told once to the managers who work there (or at every
//   store), in one note for the store with what the other stores have; back above it, it can be told again.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/store-low.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'u1', name: 'Rae Kim', role: 'manager', isManager: true, caps: [] };
let deny = false;
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && deny ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const S = await import('../../src/lib/store-stock');
  const HS = await import('../../src/lib/here-server');
  const L = await import('../../src/lib/store-low-server');
  const { POST } = await import('../../src/app/api/inventory/stores/route');
  const stores = [{ id: 'main', name: 'Main St' }, { id: 'harbor', name: 'Harbor Rd' }];

  console.log('the rules');
  const it = { totalStock: 18, stockAt: { main: 12, harbor: 4 }, reorderAt: { main: 5, harbor: 6 } };
  let v = S.storeView(it, stores);
  check('each store’s own number, and which are at or under it', v.stores[0].point === 5 && !v.stores[0].low && v.stores[1].point === 6 && v.stores[1].low === true);
  check('…a store not counted yet is never low', S.lowStores({ totalStock: 5, reorderAt: { main: 5 } }, stores).length === 0 && S.lowStores(it, stores).map((s) => s.id).join() === 'harbor');
  check('the note: the store, each item, and the other stores that have more', L.lowNote({ id: 'harbor', name: 'Harbor Rd' }, [{ itemId: 'oil', name: 'Lip oil, Rose', count: 4, point: 6, others: [{ name: 'Main St', count: 12 }] }]) === 'Running low at Harbor Rd: Lip oil, Rose: 4 left, you order more at 6. Main St has 12.');

  console.log('setting a store’s number');
  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', userId: 'owner1' });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true }); await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true }); HS.forgetLocations('t1');
  await db.doc(`${T}/inventory/oil`).set({ type: 'retail', name: 'Lip oil, Rose', totalStock: 18, stockAt: { main: 12, harbor: 4 } });
  await db.doc(`${T}/inventory/balm`).set({ type: 'retail', name: 'Shea balm', totalStock: 9, stockAt: { main: 8, harbor: 1 } });
  deny = true;
  let r: any = await POST(req({ tenantId: 't1', itemId: 'oil', action: 'point', at: 'harbor', point: 6 }));
  check('a manager’s: anyone else is refused', r.status === 403, r.body);
  deny = false;
  r = await POST(req({ tenantId: 't1', itemId: 'oil', action: 'point', at: 'harbor', point: 6 }));
  check('saved: Harbor Rd’s own number, and it shows low', r.body.ok && r.body.stores.find((s: any) => s.id === 'harbor').point === 6 && r.body.stores.find((s: any) => s.id === 'harbor').low === true && (await get(`${T}/inventory/oil`)).reorderAtOn === true, r.body);
  await POST(req({ tenantId: 't1', itemId: 'oil', action: 'point', at: 'main', point: 5 }));
  r = await POST(req({ tenantId: 't1', itemId: 'oil', action: 'point', at: 'nowhere', point: 5 }));
  check('a store that isn’t one, or a number that isn’t: refused', r.status === 400 && (await POST(req({ tenantId: 't1', itemId: 'oil', action: 'point', at: 'main', point: -2 }))).status === 400, r.body);
  await POST(req({ tenantId: 't1', itemId: 'balm', action: 'point', at: 'harbor', point: 2 }));

  console.log('told once, to who works there');
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana', role: 'manager', locationIds: ['harbor'] });
  await db.doc(`${T}/staff/m2`).set({ name: 'Bo', role: 'manager', locationIds: ['main'] });
  await db.doc(`${T}/staff/m3`).set({ name: 'Cy', role: 'manager' });
  await db.doc(`${T}/staff/s1`).set({ name: 'Di', role: 'staff', locationIds: ['harbor'] });
  let run = await L.checkStoreLow(db, 't1', await get(T));
  let notes = (await all(`${T}/notifications`)).filter((n: any) => n.type === 'store_low');
  check('one note for Harbor Rd, with both items, to its manager, the one at every store, and the owner', run.stores === 1 && run.items === 2 && notes.length === 3 && new Set(notes.map((n: any) => n.userId)).size === 3 && notes.every((n: any) => ['m1', 'm3', 'owner1'].includes(n.userId))
    && /Running low at Harbor Rd: Lip oil, Rose: 4 left, you order more at 6\. Main St has 12; Shea balm: 1 left, you order more at 2\. Main St has 8\./.test(notes[0].message) && notes[0].link === '/inventory/ordering?at=harbor', notes);
  run = await L.checkStoreLow(db, 't1', await get(T));
  check('…once: the next hour, nothing new to tell', run.items === 0 && (await all(`${T}/notifications`)).length === 3);
  await db.doc(`${T}/inventory/oil`).set({ stockAt: { main: 12, harbor: 10 } }, { merge: true });
  await L.checkStoreLow(db, 't1', await get(T));
  check('back above its number: it can be told again', !(await get(`${T}/inventory/oil`)).lowSentAt?.harbor && !!(await get(`${T}/inventory/balm`)).lowSentAt?.harbor);
  await db.doc(`${T}/inventory/oil`).set({ stockAt: { main: 12, harbor: 3 } }, { merge: true });
  run = await L.checkStoreLow(db, 't1', await get(T));
  check('…and low again: told again, that item only', run.items === 1 && (await all(`${T}/notifications`)).length === 6);
  console.log('never lost, never twice');
  await db.doc(`${T}/inventory/tea`).set({ type: 'retail', name: 'Rooibos tin', totalStock: 6, stockAt: { main: 4, harbor: 2 } });
  await POST(req({ tenantId: 't1', itemId: 'tea', action: 'point', at: 'main', point: 5 }));
  await db.doc(`${T}/staff/m2`).set({ status: 'archived' }, { merge: true }); await db.doc(`${T}/staff/m3`).set({ isRenter: true }, { merge: true });
  run = await L.checkStoreLow(db, 't1', { name: 'Northside' });
  check('nobody to tell at Main St (its manager archived, the other renting, no owner on file): not marked as told', run.items === 0 && !(await get(`${T}/inventory/tea`)).lowSentAt?.main);
  run = await L.checkStoreLow(db, 't1', { name: 'Northside', ownerId: 'owner2' });
  check('…so once there is someone (the owner, on file another way), it’s told', run.items === 1 && !!(await get(`${T}/inventory/tea`)).lowSentAt?.main && (await all(`${T}/notifications`)).some((n: any) => n.userId === 'owner2' && /Rooibos tin: 4 left/.test(n.message)));
  await db.doc(`${T}/staff/m2`).set({ status: 'active' }, { merge: true }); await db.doc(`${T}/staff/m3`).set({ isRenter: false }, { merge: true });
  // A number raised from another screen between the read and the mark: the item as it is now wins.
  await db.doc(`${T}/inventory/tea`).set({ stockAt: { main: 9, harbor: 2 } }, { merge: true }); await L.checkStoreLow(db, 't1', await get(T));
  await db.doc(`${T}/inventory/tea`).set({ stockAt: { main: 4, harbor: 2 } }, { merge: true });
  const rt = db.runTransaction; db.runTransaction = async (fn: any) => { db.runTransaction = rt; await db.doc(`${T}/inventory/tea`).set({ reorderAt: { main: 3 } }, { merge: true }); return rt.call(db, fn); };
  const before = (await all(`${T}/notifications`)).length;
  run = await L.checkStoreLow(db, 't1', await get(T));
  check('a number changed a moment ago: no note from the old one, no mark', run.items === 0 && (await all(`${T}/notifications`)).length === before && !(await get(`${T}/inventory/tea`)).lowSentAt?.main);
  // A note that couldn't be written: its marks come back off, so the next run tells it.
  await db.doc(`${T}/inventory/tea`).set({ reorderAt: { main: 5 } }, { merge: true });
  const bt = db.batch; db.batch = () => { db.batch = bt; const b = bt.call(db); return { ...b, set: b.set, commit: async () => { throw new Error('offline'); } }; };
  run = await L.checkStoreLow(db, 't1', await get(T));
  check('…a note that didn’t go out: not marked, so it’s told next time', run.items === 0 && !(await get(`${T}/inventory/tea`)).lowSentAt?.main);
  run = await L.checkStoreLow(db, 't1', await get(T));
  check('…and the next run tells it', run.items === 1 && !!(await get(`${T}/inventory/tea`)).lowSentAt?.main);
  await db.doc(`${T}/inventory/tea`).set({ archived: true }, { merge: true });
  await L.checkStoreLow(db, 't1', await get(T));
  check('an item put away: its marks come off', !(await get(`${T}/inventory/tea`)).lowSentAt?.main);
  r = await POST(req({ tenantId: 't1', itemId: 'oil', action: 'point', at: 'harbor', point: null }));
  check('its number taken off: not low there any more', r.body.ok && r.body.stores.find((s: any) => s.id === 'harbor').point === null && !('harbor' in ((await get(`${T}/inventory/oil`)).reorderAt || {})));

  console.log('one store');
  await db.doc(`${T}/locations/harbor`).set({ isActive: false }, { merge: true }); HS.forgetLocations('t1');
  run = await L.checkStoreLow(db, 't1', await get(T));
  check('with one location, nothing to tell here', run.items === 0 && run.stores === 0);

  console.log('the screens');
  const panel = src('src/components/products/StoreStockPanel.tsx'), cron = src('src/app/api/cron/store-low/route.ts'), vj = src('vercel.json');
  check('the panel: each store’s number, Low, and Order more at…', panel.includes(', order more at {s.point}') && panel.includes('>Low</span>') && panel.includes('Order more at…') && panel.includes('function PointSheet'));
  check('every hour, for every business', cron.includes("forEachTenant(db, 'store-low'") && /"path": "\/api\/cron\/store-low",\s*"schedule": "35 \* \* \* \*"/.test(vj));
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(panel + src('src/lib/store-low-server.ts')) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b/.test(src('src/lib/store-low-server.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
