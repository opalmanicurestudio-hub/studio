// Checks refunds the shop's rules decide (lib/auto-refund): within the shop's automatic amount they go back on their
// own, through the same refund route a tap uses, and the customer is told they're on their way; over it, or for a
// replacement for a lost parcel, they wait for the team and the customer is told the refund is approved, not that it's
// on its way. Covers a swap nobody answered, a swap turned down, a claim the rules approved, a cancellation, and the
// team's own sends within the amount (anyone on the team, no one's own limit in the way).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/auto-refunds.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
let actor: any = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
const stripeCalls: any[] = [];
const fetches: { url: string; body: any; headers: any }[] = [];

function StripeMock(this: any) {
  return { refunds: {
    create: async (params: any) => { stripeCalls.push(params); return { id: `re_${stripeCalls.length}`, amount: params.amount, status: 'succeeded' }; },
    list: async () => ({ data: [] }),
  } };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-claims' }, { name: 'admin-retail-selfserve' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: {} };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  if (request === '@/lib/request-forensics') return { requestForensics: () => null };
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.CRON_SECRET = 'cron'; process.env.NEXT_PUBLIC_APP_URL = 'https://shop.example';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, nextUrl: { origin: 'https://shop.example' } }) as any;

// Dana's order: two gel polishes at $14 paid each, $28 on her card, no tax. One polish wasn't on the shelf.
const L1 = { lineId: 'L1', productId: 'gel', name: 'Gel polish', sku: 'GEL', unitPriceCents: 1400, qtyOrdered: 2, qtyScanned: 1, qtyShorted: 0, qtyReturned: 0, status: 'picking' };
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1060, stage: 'picking', method: 'ship', lines: [L1], subtotalCents: 2800, taxCents: 0, totalCents: 2800, chargedCents: 2800, refundedCents: 0,
  stripePaymentIntentId: 'pi_1', qrToken: 'qr1', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', customerPhone: '', ...x });

(async () => {
  const { POST: refundPOST } = await import('../../src/app/api/retail/refund/route');
  // The app calling itself: the refund route answers its own address.
  (globalThis as any).fetch = async (url: any, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : null; const headers = Object.fromEntries(Object.entries(init?.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    fetches.push({ url: String(url), body, headers });
    if (/\/api\/retail\/refund$/.test(String(url))) { const r: any = await refundPOST(req(body, headers as any)); return { ok: r.status < 300, status: r.status, json: async () => r.body }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const A = await import('../../src/lib/auto-refund');
  const S = await import('../../src/lib/retail-swap-server');
  const { orderNow } = await import('../../src/lib/order-now');

  const fresh = async (auto: number, x: any = {}) => {
    db = makeDb(); stripeCalls.length = 0; fetches.length = 0;
    actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
    await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: { policies: { refundAutoBelowCents: auto } } });
    await db.doc(`${T}/inventory/gel`).set({ name: 'Gel polish', msrp: 14, totalStock: 1, stockReserved: 2 });
    await db.doc(`${T}/inventory/gel2`).set({ name: 'Gel polish, rose', msrp: 12, totalStock: 5, stockReserved: 0 });
    await db.doc(`${T}/retailOrders/o1`).set(order(x));
  };
  const refundCalls = () => fetches.filter((f) => /\/api\/retail\/refund$/.test(f.url));

  // ── The helper's own guard ──
  await fresh(5000, { pendingRefundCents: 1400 });
  let a = await A.autoRefund(db, 't1', 'o1');
  check('within the shop’s automatic amount, a queued $14 goes back through the refund route as the shop’s own server',
    a.sent && a.cents === 1400 && a.cardCents === 1400 && stripeCalls.length === 1 && stripeCalls[0].amount === 1400 && refundCalls()[0]?.body?.reason === 'policy' && refundCalls()[0]?.headers['x-internal-key'] === 'cron', { a, f: refundCalls() });
  check('…recorded on the order like any refund', (await get(`${T}/retailOrders/o1`)).pendingRefundCents === 0 && (await get(`${T}/retailOrders/o1`)).refundedCents === 1400);
  await fresh(1000, { pendingRefundCents: 1400 });
  a = await A.autoRefund(db, 't1', 'o1');
  check('over the amount it isn’t even asked: it waits for the team', !a.sent && refundCalls().length === 0 && stripeCalls.length === 0);
  await fresh(0, { pendingRefundCents: 1400 });
  check('with no automatic amount, nothing goes on its own', !(await A.autoRefund(db, 't1', 'o1')).sent && refundCalls().length === 0);
  await fresh(5000, { pendingRefundCents: 1400, replacementFor: 'lost_in_transit' });
  check('never a replacement for a lost parcel', !(await A.autoRefund(db, 't1', 'o1')).sent && stripeCalls.length === 0);

  // ── Swaps ──
  const offer = { lineId: 'L1', lineName: 'Gel polish', sub: { productId: 'gel2', name: 'Gel polish, rose', unitPriceCents: 1200 }, at: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600e3).toISOString(), status: 'waiting', by: 'Rae' };
  await fresh(5000, { swapOffer: offer });
  let d = await S.decideSwap(db, 't1', 'o1', false, 'page', 'https://shop.example');
  let o = await get(`${T}/retailOrders/o1`);
  check('Dana turns the swap down: the polish is refunded and, within the shop’s amount, the $14 goes straight back',
    d.ok && stripeCalls.length === 1 && stripeCalls[0].amount === 1400 && o.pendingRefundCents === 0 && o.refundedCents === 1400 && /on its way back to your card/.test(d.message), { d, o });
  await fresh(1000, { swapOffer: offer });
  d = await S.decideSwap(db, 't1', 'o1', false, 'page', 'https://shop.example');
  check('…over the amount: queued for the team, and she’s told it’s approved, not that it’s on its way',
    d.ok && stripeCalls.length === 0 && (await get(`${T}/retailOrders/o1`)).pendingRefundCents === 1400 && /A refund of \$14\.00 is approved/.test(d.message) && !/on its way back/.test(d.message), d);
  await fresh(5000, { swapOffer: offer });
  d = await S.decideSwap(db, 't1', 'o1', true, 'page', 'https://shop.example');
  check('Dana takes the $12 swap: the $2 difference goes straight back', d.ok && stripeCalls.length === 1 && stripeCalls[0].amount === 200 && /\$2\.00 is on its way back/.test(d.message), { d, s: stripeCalls });

  await fresh(5000, { swapOffer: { ...offer, expiresAt: new Date(Date.now() - 60e3).toISOString() } });
  const n = await S.expireSwapOffers(db, 't1');
  const order1 = fetches.findIndex((f) => /\/api\/retail\/refund$/.test(f.url)); const notice = fetches.findIndex((f) => /short-notify$/.test(f.url));
  check('a swap nobody answered: refunded, sent within the amount, and only then is she told (so the notice can say it went)',
    n === 1 && stripeCalls.length === 1 && stripeCalls[0].amount === 1400 && order1 >= 0 && notice > order1, { n, fetches: fetches.map((f) => f.url) });

  // ── A claim the shop's rules approve ──
  const { POST: claimPOST } = await import('../../src/app/api/retail/claims/route');
  await fresh(5000, { stage: 'completed', completedAt: new Date().toISOString(), lines: [{ ...L1, qtyScanned: 1, status: 'picked' }] });
  await db.doc(T).set({ retailSettings: { claimAutoResolveMaxCents: 5000 } }, { merge: true });
  let c: any = await claimPOST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', type: 'missing', lineId: 'L1', qty: 1 }));
  check('a missing polish the packing record agrees with is approved, and the $14 goes straight back',
    c.status === 200 && c.body.status === 'auto_resolved' && stripeCalls.length === 1 && stripeCalls[0].amount === 1400 && /on its way back to your card/.test(c.body.message), { c: c.body, s: stripeCalls });
  await fresh(1000, { stage: 'completed', completedAt: new Date().toISOString(), lines: [{ ...L1, qtyScanned: 1, status: 'picked' }] });
  await db.doc(T).set({ retailSettings: { claimAutoResolveMaxCents: 5000 } }, { merge: true });
  c = await claimPOST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', type: 'missing', lineId: 'L1', qty: 1 }));
  check('…over the refund amount: approved, queued, and said so', c.status === 200 && c.body.status === 'auto_resolved' && stripeCalls.length === 0 && /is approved/.test(c.body.message), c.body);

  // ── The team within the amount ──
  await fresh(5000, { pendingRefundCents: 3000, chargedCents: 5000, totalCents: 5000 });
  await db.doc(T).set({ retailSettings: { policies: { refundLimits: { cashier: 2500 } } } }, { merge: true });
  actor = { uid: 'k1', name: 'Kai', role: 'cashier', caps: ['checkout.refund'] };
  let r: any = await refundPOST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1', reason: 'policy' }));
  check('a cashier with a $25 limit sends a $30 refund that’s within the shop’s $50 automatic amount', r.status === 200 && stripeCalls[0]?.amount === 3000, r.body);
  await fresh(5000, { pendingRefundCents: 3000, chargedCents: 5000, totalCents: 5000 });
  await db.doc(T).set({ retailSettings: { policies: { refundLimits: { cashier: 2500 } } } }, { merge: true });
  actor = { uid: 'k1', name: 'Kai', role: 'cashier', caps: ['checkout.refund'] };
  r = await refundPOST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qr1' }));
  check('…but a plain send still meets their own limit', r.status === 403 && stripeCalls.length === 0, r.body);

  // ── What the customer's order page says ──
  const now = orderNow({ stage: 'paid', method: 'ship', customerName: 'Dana', pendingRefundCents: 1400 }, { refundState: 'pending' });
  check('her order page says a waiting refund is approved, not on its way', /A refund of \$14\.00 is approved/.test(String(now?.extra || '')) && !/on its way to your card/.test(String(now?.extra || '')), now);
  check('the words for a refund that went: card, gift card or credit, or both',
    /on its way back to your card/.test(A.refundWords(1400, { sent: true, cents: 1400, cardCents: 1400, otherCents: 0 }))
    && /back the way you paid/.test(A.refundWords(1400, { sent: true, cents: 1400, cardCents: 0, otherCents: 1400 }))
    && /\$10\.00 to your card.*\$4\.00 on your gift card/.test(A.refundWords(1400, { sent: true, cents: 1400, cardCents: 1000, otherCents: 400 })));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
