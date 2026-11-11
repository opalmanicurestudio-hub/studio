// Checks menu photos (L21): a manager adds one on the Menu page (api/menu 'save', an https address only, kept, removed,
// left alone), and the drive-thru shows it: the lane's buttons, each order line, and the order board facing the car.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/menu-photos.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
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
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  const C = await import('../../src/lib/counter-orders');
  process.env.FIREBASE_STORAGE_BUCKET = 'x.appspot.com'; delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const PHOTO = 'https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/tenants%2Ft1%2Fproducts%2Fmenu-burger-1.jpg?alt=media&token=abc';
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Food', price: 6, totalStock: 50 });
  await db.doc(`${T}/inventory/fries`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 2.5, totalStock: 100 });

  console.log('what counts as a photo');
  check('an https address is a photo', C.photoOf({ imageUrl: PHOTO }) === PHOTO);
  check('…anything else is not: http, a script, inline data, quotes or spaces, nothing, or something far too long',
    [ 'http://x.test/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://x.test/a b.jpg', 'https://x.test/"onerror=x', '', null, 42, `https://x.test/${'a'.repeat(1600)}` ]
      .every((u) => C.photoOf({ imageUrl: u }) === null));

  console.log('a manager adds a photo on the Menu page');
  const save = (item: any) => menuApi(req({ action: 'save', tenantId: 't1', itemId: 'burger', item: { name: 'Burger', section: 'Food', price: 6, choices: [], ...item } }));
  let r: any = await save({ imageUrl: PHOTO });
  check('it’s kept on the item and comes back with it', r.body.ok && r.body.item.imageUrl === PHOTO && (await get(`${T}/inventory/burger`)).imageUrl === PHOTO, r.body);
  r = await save({ imageUrl: 'http://x.test/a.jpg' });
  check('a photo address that isn’t a proper upload is refused, and the photo already there stays', r.status === 400 && (await get(`${T}/inventory/burger`)).imageUrl === PHOTO, r.body);
  r = await save({ imageUrl: 'https://cdn.elsewhere.test/burger.jpg' });
  const r2: any = await save({ imageUrl: 'https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/tenants%2Ft2%2Fproducts%2Fa.jpg?alt=media' });
  const r3: any = await save({ imageUrl: 'https://firebasestorage.googleapis.com/v0/b/someone-else.appspot.com/o/tenants%2Ft1%2Fproducts%2Fa.jpg?alt=media' });
  const r4: any = await save({ imageUrl: 'https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/tenants%2Ft1%2Favatars%2Fa.jpg?alt=media' });
  check('…and so is a photo from anywhere but this business’s own product photos (another site, another business’s folder, another storage account, another folder)',
    [r, r2, r3, r4].every((x: any) => x.status === 400) && (await get(`${T}/inventory/burger`)).imageUrl === PHOTO, [r.body, r2.body, r3.body, r4.body]);
  r = await save({});
  check('saving without touching the photo keeps it', r.body.ok && (await get(`${T}/inventory/burger`)).imageUrl === PHOTO, r.body);
  r = await save({ imageUrl: null });
  check('Remove takes it off', r.body.ok && r.body.item.imageUrl === null && !(await get(`${T}/inventory/burger`)).imageUrl, r.body);
  await save({ imageUrl: PHOTO });
  manager = false;
  r = await save({ imageUrl: null });
  check('only a manager changes it', r.status === 403 && (await get(`${T}/inventory/burger`)).imageUrl === PHOTO);

  console.log('the drive-thru shows it');
  manager = true; signedIn = true;
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const bkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Order board', kind: 'drive-thru-board' }))).body.key;
  manager = false; signedIn = false;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b }));
  r = await P({ action: 'lane' });
  check('the lane’s buttons get the photo (and an item without one gets none)', r.body.menu.find((m: any) => m.id === 'burger')?.imageUrl === PHOTO && r.body.menu.find((m: any) => m.id === 'fries')?.imageUrl === null, r.body.menu);
  const car = (await P({ action: 'car', carKey: 'photo-car-0001' })).body;
  await P({ action: 'add', orderId: car.orderId, itemId: 'burger', quantity: 1, tapKey: 'photo-tap-0001' });
  await P({ action: 'add', orderId: car.orderId, itemId: 'fries', quantity: 1, tapKey: 'photo-tap-0002' });
  const o = await get(`${T}/counterOrders/${car.orderId}`);
  check('each line keeps the photo it was added with', o.lines[0].imageUrl === PHOTO && o.lines[1].imageUrl === null, o.lines);
  r = await POST(req({ tenantId: 't1', key: bkey, action: 'board' }));
  check('the order board facing the car shows it beside the line', r.body.order?.lines?.[0]?.imageUrl === PHOTO && r.body.order.lines[1].imageUrl === null, r.body);
  await db.doc(`${T}/counterOrders/${car.orderId}`).set({ lines: o.lines.map((l: any, i: number) => (i === 0 ? { ...l, imageUrl: 'javascript:alert(1)' } : l)) }, { merge: true });
  r = await POST(req({ tenantId: 't1', key: bkey, action: 'board' }));
  check('…and never anything that isn’t a proper photo address', r.body.order.lines[0].imageUrl === null, r.body.order.lines[0]);

  console.log('the pages');
  const lane = src('src/app/drive-thru/[tenantId]/page.tsx'), board = src('src/app/drive-thru/[tenantId]/board/page.tsx'), menu = src('src/app/(app)/menu/page.tsx');
  check('the lane shows picture buttons once any item has a photo, and compact ones when none do', lane.includes('const withPhotos = menu.some((m) => !!m.imageUrl);') && lane.includes('if (withPhotos) return (') && lane.includes('aspect-[16/10]'));
  check('the order board keeps a steady number of lines (smaller once an order is long, never cut off) with pictures beside them', board.includes('const shown = dense ? 5 : 4;') && board.includes('l.imageUrl && <img'));
  check('the Menu page uploads a smaller copy into the business’s product photos, and saves it only with Save',
    menu.includes('uploadImage(`tenants/${tenantId}/products/menu-${item.id}-') && menu.includes("accept=\"image/jpeg,image/png,image/webp\"") && menu.includes('...(photo !== (item.imageUrl || null) ? { imageUrl: photo } : {})'));
  const ui = [lane, board, menu].join('\n');
  check('writing rules: no all-caps, no JSX comments, no emoji', !/\buppercase\b|font-black/.test(ui) && !/\{\/\*/.test(ui) && !/[\u{1F300}-\u{1FAFF}]/u.test(ui));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
