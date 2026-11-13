// Checks orders from the line at a pop-up (api/retail/checkout with a pop-up, api/retail/popup-public,
// shop/[tenantId]/popup/[popupId], the order page's number, print/popup-sign) and the Pickup and drive-thru switch
// (lib/modules 'pickup', api/retail/pickup-tools, Shop setup).
// - The line's page: only while the pop-up is taking orders from the line, with what's left (never more than on hand);
//   nothing when it's off or over.
// - Checkout with a pop-up: picked up at the table (no pickup time, whatever the shop's pickup settings), only its own
//   products, only what's left (checked as the order is written, the last one to one person), a number each in order,
//   and turned back when the pop-up stops taking orders.
// - The order page shows the number; the sign carries the page's link; the screen has the sign.
// - The switch: managers turn the pickup tools on or off; on only while the shop is; off, the pages leave the menu and
//   the window, pop-ups and line orders say so.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/popup-line.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
function StripeMock(this: any) { return { coupons: { create: async () => ({ id: 'co_1' }) }, checkout: { sessions: { create: async () => ({ id: 'cs_x', url: 'https://stripe.test/x' }) } }, paymentIntents: { create: async () => ({ id: 'pi_1', client_secret: 's' }) } }; }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  if (request === '@/lib/loyalty-server' || /loyalty-server(\.ts)?$/.test(request)) return fake(request, { earnForShopOrder: async () => undefined });
  return load.call(this, request, ...rest);
};
const src = (p: string) => readFileSync(p, 'utf8');
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any, q: Record<string, string> = {}) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer x' : null) }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams(q) } }) as any;
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const { POST: CHECKOUT } = await import('../../src/app/api/retail/checkout/route');
  const { GET: PUBLIC } = await import('../../src/app/api/retail/popup-public/route');
  const { POST: TOOLS } = await import('../../src/app/api/retail/pickup-tools/route');
  const { moduleEnabled, pageVisible, hrefModule } = await import('../../src/lib/modules');

  // A shop that takes pickups only at set times, and has pickup off: neither applies at the table.
  await db.doc(T).set({ name: 'Rooted Loc Co.', timezone: 'UTC', userId: 'owner1', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 8, pickupEnabled: false } });
  await db.doc(`${T}/inventory/gel`).set({ type: 'retail', name: 'Retwist gel', msrp: 18, totalStock: 40, showOnline: true, status: 'active' });
  await db.doc(`${T}/inventory/butter`).set({ type: 'retail', name: 'Loc butter', msrp: 14, totalStock: 1, showOnline: true, status: 'active' });
  await db.doc(`${T}/inventory/cot`).set({ type: 'retail', name: 'Cotton rounds', msrp: 4, totalStock: 30, showOnline: true, status: 'active' });
  await db.doc(`${T}/popups/p1`).set({ id: 'p1', name: 'Saturday market', place: 'Stall 14', day: today, status: 'open', lineOrders: true, items: [{ id: 'gel', qty: 3 }, { id: 'butter', qty: 5 }], soldAtTable: { gel: 1 }, nextNumber: 11 });
  const orders = async () => (await db.collection(`${T}/retailOrders`).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
  let who = 0;
  const buy = (items: any[], x: any = {}) => CHECKOUT(req({ tenantId: 't1', popupId: 'p1', items, method: 'counter', customer: { name: 'Aisha Grant', email: `aisha${++who}@example.com`, phone: '5125550199' }, checkoutKey: `key-${Math.random().toString(36).slice(2, 18).padEnd(16, 'x')}`, ...x }));

  console.log('the line’s page');
  let r: any = await PUBLIC(req({}, { tenantId: 't1', id: 'p1' }));
  const gel = r.body.items?.find((x: any) => x.id === 'gel'); const butter = r.body.items?.find((x: any) => x.id === 'butter');
  check('open with what’s left at the table (what came, less the table’s sales)', r.status === 200 && r.body.open === true && r.body.name === 'Saturday market' && gel?.left === 2 && butter?.left === 5 && gel.cart.productId === 'gel', r.body);
  const over: any = await buy([{ productId: 'butter', qty: 2 }]);
  check('…and the shop’s own stock still decides (one on hand: two can’t be sold, whatever the table says)', over.status >= 400 && !(await orders()).some((x: any) => (x.lines || []).some((l: any) => l.productId === 'butter')), over.body);

  console.log('ordering from the line');
  r = await buy([{ productId: 'gel', qty: 1 }]);
  let o: any = (await orders()).find((x: any) => x.popupId === 'p1');
  check('placed: picked up at the table (no pickup time, pickup off or not), numbered next, named after the pop-up', r.status === 200 && !!r.body.url && o?.popupNumber === 12 && o.popupName === 'Saturday market' && /^At the table, Saturday market/.test(o.pickupAt) && !o.pickupWindowKey && (await get(`${T}/popups/p1`)).nextNumber === 12, [r.body, o]);
  const refused: any[] = [];
  refused.push(await buy([{ productId: 'cot', qty: 1 }]));
  refused.push(await buy([{ productId: 'gel', qty: 2 }]));
  refused.push(await buy([{ productId: 'gel', qty: 1 }], { method: 'curbside' }));
  check('turned back: a product that isn’t at the pop-up, more than what’s left (saying how many), not picked up at the table', refused[0].status === 409 && /Cotton rounds isn’t at this pop-up/.test(refused[0].body.error) && refused[1].status === 409 && /Only 1 Retwist gel left/.test(refused[1].body.error) && refused[2].status === 400, refused.map((x) => [x.status, x.body.error]));
  r = await buy([{ productId: 'gel', qty: 1 }]);
  const r2: any = await buy([{ productId: 'gel', qty: 1 }]);
  check('the last one goes to one person; the next is told it sold out; numbers in order', r.status === 200 && r2.status === 409 && /just sold out/.test(r2.body.error) && (await orders()).filter((x: any) => x.popupId === 'p1').map((x: any) => x.popupNumber).sort().join() === '12,13', [r2.body]);
  await db.doc(`${T}/popups/p1`).set({ lineOrders: false }, { merge: true });
  r = await buy([{ productId: 'butter', qty: 1 }]);
  check('…and when it stops taking orders from the line, they’re told to order at the table', r.status === 409 && r.body.popupClosed === true && /Order at the table/.test(r.body.error), r.body);
  await new Promise((res) => setTimeout(res, 10_050));
  r = await PUBLIC(req({}, { tenantId: 't1', id: 'p1' }));
  check('the page says it’s closed, and lists nothing', r.body.open === false && r.body.items.length === 0 && r.body.over === false);
  // The same checkout tried again (back from the payment page): no competing with itself, the same number; one email
  // holds at most two unpaid tries.
  await db.doc(`${T}/popups/p1`).set({ lineOrders: true, items: [{ id: 'gel', qty: 3 }, { id: 'butter', qty: 5 }] }, { merge: true });
  await db.doc(`${T}/inventory/butter`).set({ totalStock: 10 }, { merge: true });
  const key = 'retrykey-0123456789abcdef'; const same = { checkoutKey: key, customer: { name: 'Lee', email: 'lee@example.com' } };
  const a: any = await buy([{ productId: 'butter', qty: 5 }], same);
  const b: any = await buy([{ productId: 'butter', qty: 5 }], same);
  const tries = (await orders()).filter((x: any) => x.customerEmail === 'lee@example.com');
  check('tried again from the payment page: not turned back by its own first try, and the same number', a.status === 200 && b.status === 200 && tries.length === 2 && tries[0].popupNumber === tries[1].popupNumber, [a.body, b.body, tries.map((x: any) => x.popupNumber)]);
  await db.doc(`${T}/popups/p1`).set({ items: [{ id: 'gel', qty: 3 }, { id: 'butter', qty: 50 }] }, { merge: true });
  const many: any[] = [];
  for (let i = 0; i < 3; i++) many.push(await buy([{ productId: 'butter', qty: 1 }], { customer: { name: 'Max', email: 'max@example.com' } }));
  check('one email holds at most two unpaid tries', many[0].status === 200 && many[1].status === 200 && many[2].status === 429 && /waiting to be paid/.test(many[2].body.error), many.map((x) => [x.status, x.body.error]));
  r = await buy([{ productId: 'gel', qty: 1 }], { popupId: 'day-2026-01-01' });
  check('a made-up pop-up takes nothing', r.status === 409);
  r = await CHECKOUT(req({ tenantId: 't1', items: [{ productId: 'cot', qty: 1 }], method: 'counter', customer: { name: 'Kim', email: 'kim@example.com' } }));
  check('without a pop-up, the shop’s own pickup rules stand (pickup is off here)', r.status === 400 && /isn’t offering pickup/.test(r.body.error), r.body);

  console.log('the number, the sign');
  check('the line’s tries are limited per visitor', /limitPublic\(req, 'popup-order', tenantId, \{ perHour: 15, perDay: 0 \}\)/.test(src('src/app/api/retail/checkout/route.ts')));
  const ready = src('src/app/api/retail/ready-notify/route.ts'); const conf = src('src/lib/retail-webhook.ts');
  check('ready and confirmed: the number and the table, never the shop’s address or a pickup time', /No\. \$\{popupNo\} is ready\. Come up to the table at \$\{where\}\./.test(ready) && /Your number is <strong>\$\{popupNo\}<\/strong>/.test(conf) && /const pickupNote = popupNo/.test(conf));
  check('the line’s page: products for licensed pros are ordered at the table', /const atTable = it\.prosOnly/.test(src('src/app/shop/[tenantId]/popup/[popupId]/page.tsx')) && /!out && !atTable && \(n \?/.test(src('src/app/shop/[tenantId]/popup/[popupId]/page.tsx')));
  check('the sign only for a real pop-up with the pickup tools on', /if \(p\.marker \|\| !p\.day \|\| !moduleEnabled\(tenant, 'pickup'\)\)/.test(src('src/app/print/popup-sign/[tenantId]/[popupId]/page.tsx')));
  const status = src('src/app/api/retail/order-status/route.ts'); const page = src('src/app/shop/[tenantId]/order/[orderId]/page.tsx');
  check('the order page shows the number it’s called by, and when to come up', /popup: Number\(order\.popupNumber\) > 0 \? \{ number: Number\(order\.popupNumber\)/.test(status) && /aria-label="Your number"/.test(page) && /Come up when we call your number\./.test(page));
  const sign = src('src/app/print/popup-sign/[tenantId]/[popupId]/page.tsx');
  check('the sign: the line’s page as a code, the three steps, a few products, nothing about any customer', /\/shop\/\$\{encodeURIComponent\(tenantId\)\}\/popup\/\$\{encodeURIComponent\(popupId\)\}/.test(sign) && /Skip the line\./.test(sign) && /Come up when we call it\./.test(sign) && /Rather order in person\? Come to the table\./.test(sign) && !/customerName|customerEmail|customerPhone|retailOrders/.test(sign));
  check('…printed from the pop-up', /\/print\/popup-sign\//.test(src('src/components/orders/PopupScreen.tsx')));
  const line = src('src/app/shop/[tenantId]/popup/[popupId]/page.tsx');
  check('the line’s page: read again every half minute, never more than what’s left, pays with the shop’s checkout for this pop-up', /setInterval\(\(\) => void load\(\), 30000\)/.test(line) && /Math\.min\(q\[it\.id\], it\.left\)/.test(line) && /tenantId, popupId, method: 'counter'/.test(line));

  console.log('the switch');
  check('on unless turned off, and only while the shop is', moduleEnabled({}, 'pickup') && !moduleEnabled({ modules: { pickup: false } }, 'pickup') && !moduleEnabled({ modules: { retail: false } }, 'pickup') && moduleEnabled({ modules: { retail: true, pickup: true } }, 'pickup'));
  const { lockedModule } = await import('../../src/lib/modules');
  check('a pickup page says which switch: its own when only it is off, the shop when the shop is off; the lock card sends to Shop setup, not to buying anything', lockedModule({ modules: { pickup: false } }, '/popup') === 'pickup' && lockedModule({ modules: { retail: false } }, '/popup') === 'retail' && lockedModule({}, '/popup') === null
    && /if \(locked === 'pickup'\) return \(/.test(src('src/components/shared/ToolGate.tsx')) && /href="\/retail-orders\/setup"/.test(src('src/components/shared/ToolGate.tsx')));
  check('the window, Pickups and pop-ups are its pages', ['/window', '/popup', '/retail-orders/pickups'].every((h) => hrefModule(h) === 'pickup') && hrefModule('/retail-orders') === 'retail' && !pageVisible({ modules: { pickup: false } }, '/window') && pageVisible({ modules: { pickup: false } }, '/retail-orders'));
  actor = { uid: 's1', name: 'Sam', role: 'staff', caps: [] };
  r = await TOOLS(req({ tenantId: 't1', on: false }));
  check('only a manager turns it on or off', r.status === 403);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await TOOLS(req({ tenantId: 't1', on: false }));
  check('turned off', r.status === 200 && (await get(T)).modules?.pickup === false);
  await db.doc(`${T}/popups/p1`).set({ lineOrders: true }, { merge: true });
  r = await buy([{ productId: 'butter', qty: 1 }]);
  check('…off, the line takes no orders', r.status === 409, r.body);
  r = await TOOLS(req({ tenantId: 't1', on: true }));
  check('turned back on', r.status === 200 && (await get(T)).modules?.pickup === true);
  await db.doc(T).set({ modules: { retail: false } }, { merge: true });
  r = await TOOLS(req({ tenantId: 't1', on: true }));
  check('…not with the shop off (it sells the shop’s products)', r.status === 409 && /Turn the shop on first/.test(r.body.error));
  const { toTenantModules } = await import('../../src/lib/module-catalog');
  check('choosing tools never overwrites the business’s own Pickup and drive-thru switch', !('pickup' in toTenantModules(['inventory'] as any)) && toTenantModules(['inventory'] as any).retail === true && toTenantModules([] as any).retail === false);
  check('Shop setup has the switch, a real one, 44px, named', /role="switch" aria-checked=\{now\} aria-label="Pickup and drive-thru"/.test(src('src/components/orders/SetupScreen.tsx')) && /'retail', 'pickup'/.test(src('src/lib/module-catalog.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
