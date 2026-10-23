// Checks who sees what on an order's own page (api/retail/order-status, api/retail/order-pass, lib/order-pass): with only
// the link, the order without the customer's details (the town, never the street; the first name; the email masked);
// with a pass (a code sent to the email or mobile on the order, the device that paid, their account at the shop) all of
// it; past the link's window, only enough to ask for a code; and a code is good once, for that order only.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-link.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.ORDER_PASS_SECRET = 'test-pass-secret';
process.env.RESEND_API_KEY = 're_test_x';
process.env.ACCOUNT_TOKEN_SECRET = process.env.ACCOUNT_TOKEN_SECRET || 'acct-secret';
let db: any = strictTransactions(makeDb());
const mails: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => { if (String(url).includes('resend')) mails.push(JSON.parse(String(init?.body || '{}'))); return { ok: true, status: 200, json: async () => ({ id: 'em_1' }), text: async () => '' }; };
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin-retail-status' }), getApps: () => [{ name: 'admin-retail-status' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/audit' || request === './audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const day = 864e5;
const iso = (ms: number) => new Date(ms).toISOString();
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1130, stage: 'paid', method: 'ship', qrToken: 'qr1', paidAt: iso(Date.now() - 5 * day), placedAt: iso(Date.now() - 5 * day),
  customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', customerPhone: '5035551234', stripeCheckoutSessionId: 'cs_paid1',
  shippingAddress: { name: 'Dana Whitfield', line1: '88 Pine St', city: 'Portland', state: 'OR', postalCode: '97201', country: 'US' },
  lines: [{ lineId: 'a', productId: 'p1', name: 'Pine candle', unitPriceCents: 1200, qtyOrdered: 1, status: 'picked' }], subtotalCents: 1200, totalCents: 1200, ...x });
const fresh = async (x: any = {}, rs: any = {}) => {
  db = strictTransactions(makeDb()); mails.length = 0;
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal Studio', retailSettings: rs });
  await db.doc(`${T}/retailOrders/o1`).set(order(x));
};
const get = (q: Record<string, string>) => ({ nextUrl: { searchParams: new URLSearchParams({ tenantId: 't1', orderId: 'o1', ...q }), origin: 'https://shop.test' }, headers: { get: () => null } }) as any;
const post = (body: any) => ({ json: async () => body, nextUrl: { origin: 'https://shop.test' }, headers: { get: () => null } }) as any;

(async () => {
  const { GET: status } = await import('../../src/app/api/retail/order-status/route');
  const { POST: passRoute } = await import('../../src/app/api/retail/order-pass/route');
  const { makePass, checkPass } = await import('../../src/lib/order-pass');
  const { signAccountToken } = await import('../../src/lib/retail-account');

  console.log('only the link');
  await fresh();
  let r: any = await status(get({}));
  let o = r.body.order;
  check('the order shows, without her details: the town, her first name, the email masked', r.status === 200 && o.lines.length === 1 && o.shippingAddress.city === 'Portland' && !o.shippingAddress.line1 && !o.shippingAddress.postalCode && o.customerName === 'Dana' && o.customerEmail !== 'dana@example.com' && /@example\.com$/.test(o.customerEmail), o);
  check('…and it says a code is needed, and where it can go', r.body.verify.needed === true && r.body.verify.phoneEnding === '1234' && !!r.body.verify.emailMasked && !r.body.newPass, r.body.verify);
  r = await status(get({ pass: makePass('t1', 'qr2') }));
  check('a pass for another order: still without her details', !r.body.order.shippingAddress.line1 && r.body.verify.needed === true);
  r = await status(get({ pass: 'garbage.value' }));
  check('a made-up pass: the same', !r.body.order.shippingAddress.line1);

  console.log('with a pass');
  r = await status(get({ pass: makePass('t1', 'qr1') }));
  o = r.body.order;
  check('all of it: the street, her full name, her email', o.shippingAddress.line1 === '88 Pine St' && o.customerName === 'Dana Whitfield' && o.customerEmail === 'dana@example.com' && r.body.verify.passOk === true && !r.body.newPass, o);
  await fresh({ paidAt: iso(Date.now() - 3600e3) });
  r = await status(get({ session_id: 'cs_paid1' }));
  check('the device that paid, the same day: all of it, and a pass to keep', r.body.order.shippingAddress.line1 === '88 Pine St' && checkPass('t1', 'qr1', r.body.newPass), r.body.verify);
  r = await status(get({ session_id: 'cs_other' }));
  check('…another payment page: no', !r.body.order.shippingAddress.line1 && !r.body.newPass);
  const exp = Date.now() + 10 * day;
  r = await status(get({ ae: 'dana@example.com', ax: String(exp), as: signAccountToken('t1', 'dana@example.com', exp) }));
  check('signed in to her account at the shop: all of it', r.body.order.shippingAddress.line1 === '88 Pine St' && !!r.body.newPass);
  r = await status(get({ ae: 'someone@else.com', ax: String(exp), as: signAccountToken('t1', 'someone@else.com', exp) }));
  check('…someone else’s account: no', !r.body.order.shippingAddress.line1);

  console.log('past the link’s window');
  await fresh({ stage: 'completed', deliveredAt: iso(Date.now() - 40 * day) });
  r = await status(get({}));
  check('only enough to ask for a code: no items, no address, no name', r.body.expired === true && !r.body.order.lines && !r.body.order.shippingAddress && !r.body.order.customerName && r.body.order.orderNumber === 1130 && r.body.verify.needed === true, r.body);
  r = await status(get({ pass: makePass('t1', 'qr1') }));
  check('…with a pass, it opens again', !r.body.expired && r.body.order.lines.length === 1 && r.body.order.shippingAddress.line1 === '88 Pine St');
  await fresh({ stage: 'completed', deliveredAt: iso(Date.now() - 40 * day) }, { returnWindowDays: 60 });
  r = await status(get({}));
  check('…a longer return window keeps it open', !r.body.expired && r.body.order.lines.length === 1);

  console.log('a code');
  await fresh({ stage: 'completed', deliveredAt: iso(Date.now() - 40 * day) });
  r = await passRoute(post({ tenantId: 't1', orderId: 'o1', action: 'send', via: 'email' }));
  const code = (String(mails[0]?.html || '').match(/\b(\d{6})\b/) || [])[1];
  check('a code goes to the email on the order (never one typed in)', r.status === 200 && mails.length === 1 && mails[0].to?.[0] === 'dana@example.com' && !!code && !!r.body.verificationId, { r: r.body, to: mails[0]?.to });
  let c: any = await passRoute(post({ tenantId: 't1', orderId: 'o1', action: 'confirm', verificationId: r.body.verificationId, code: code === '000000' ? '111111' : '000000' }));
  check('a wrong code: no pass', c.status === 400 && !c.body.pass);
  c = await passRoute(post({ tenantId: 't1', orderId: 'o1', action: 'confirm', verificationId: r.body.verificationId, code }));
  check('the right code: a pass for this order', c.status === 200 && checkPass('t1', 'qr1', c.body.pass));
  const again: any = await passRoute(post({ tenantId: 't1', orderId: 'o1', action: 'confirm', verificationId: r.body.verificationId, code }));
  check('…good once', again.status === 400 && !again.body.pass);
  await db.doc(`${T}/retailOrders/o2`).set(order({ id: 'o2', qrToken: 'qr9' }));
  r = await passRoute(post({ tenantId: 't1', orderId: 'o1', action: 'send', via: 'email' }));
  const code2 = (String(mails[mails.length - 1]?.html || '').match(/\b(\d{6})\b/) || [])[1];
  c = await passRoute(post({ tenantId: 't1', orderId: 'o2', action: 'confirm', verificationId: r.body.verificationId, code: code2 }));
  check('a code for one order doesn’t open another', c.status === 400 && !c.body.pass);
  r = await passRoute(post({ tenantId: 't1', orderId: 'o1', action: 'send', via: 'phone' }));
  check('texts off: no code by text', (await (async () => { await db.doc(`${T}/retailOrders/o1`).set({ textsOff: true }, { merge: true }); return (await passRoute(post({ tenantId: 't1', orderId: 'o1', action: 'send', via: 'phone' }))).status; })()) === 409);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('order-link ok');
})();
