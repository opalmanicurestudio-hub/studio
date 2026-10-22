// Checks cancelling a pre-order run (api/retail/preorder-run-cancel). Every order with the product is reached, however
// many orders have pre-orders (they're read page by page); an order left with nothing to send is cancelled and gives
// back everything paid on it, shipping too, its gift card part included; a mixed order keeps shipping and gives back
// the run's items with their tax; within the shop's automatic amount the money goes back straight away; and the
// email says what really happened, never "in full" for part of an order.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/preorder-run.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
const stripeCalls: any[] = [];
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
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'retail-run-cancel' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: {} };
  if (request === '@/lib/route-guard') return { staffOrServer: async () => true, requireCan: async () => ({ actor: { isRenter: false } }) };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: false, status: 401, error: 'no' }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.CRON_SECRET = 'cron'; process.env.NEXT_PUBLIC_APP_URL = 'https://shop.example';
process.env.RESEND_API_KEY = 'rk'; process.env.NOTIFY_FROM_EMAIL = 'shop@example.com';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, nextUrl: { origin: 'https://shop.example' } }) as any;

// A $14 kit, pre-ordered (8% tax). Shipping $8.
const KIT = (qty = 2, x: any = {}) => ({ lineId: `K${qty}`, productId: 'kit', name: 'Starter kit', unitPriceCents: 1400, qtyOrdered: qty, qtyScanned: 0, qtyShorted: 0, preorder: true, status: 'pending', ...x });
const GEL = { lineId: 'G', productId: 'gel', name: 'Gel polish', unitPriceCents: 1000, qtyOrdered: 1, qtyScanned: 0, qtyShorted: 0, status: 'pending' };
const ord = (id: string, lines: any[], x: any = {}) => {
  const sub = lines.reduce((s, l) => s + l.unitPriceCents * l.qtyOrdered, 0); const tax = Math.round(sub * 0.08);
  return { id, tenantId: 't1', orderNumber: 1100, stage: 'paid', method: 'ship', hasPreorder: true, lines, subtotalCents: sub, taxCents: tax, shippingCents: 800, totalCents: sub + tax + 800, chargedCents: sub + tax + 800, refundedCents: 0,
    stripePaymentIntentId: `pi_${id}`, qrToken: `qr_${id}`, customerEmail: `${id}@example.com`, customerName: 'Dana Whitfield', ...x };
};

(async () => {
  const { POST: refundPOST } = await import('../../src/app/api/retail/refund/route');
  (globalThis as any).fetch = async (url: any, init?: any) => {
    if (/\/api\/retail\/refund$/.test(String(url))) { const body = JSON.parse(init.body); const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])); const r: any = await refundPOST(req(body, headers as any)); return { ok: r.status < 300, status: r.status, json: async () => r.body }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const { POST: runPOST } = await import('../../src/app/api/retail/preorder-run-cancel/route');
  const fresh = async (auto: number, setup: (d: any) => Promise<void>) => {
    db = makeDb(); stripeCalls.length = 0;
    await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: { policies: { refundAutoBelowCents: auto } } });
    await db.doc(`${T}/inventory/kit`).set({ name: 'Starter kit', preorder: true, preorderSold: 9 });
    await setup(db);
  };
  const card = async (id: string, kind: string) => (await all(`${T}/retailOrders/${id}/inbox`)).find((x: any) => x.kind === kind);

  // ── Every order is reached ──
  await fresh(0, async (d) => {
    for (let i = 0; i < 205; i++) await d.doc(`${T}/retailOrders/a${String(i).padStart(3, '0')}`).set(ord(`a${String(i).padStart(3, '0')}`, [{ ...KIT(1), productId: 'other' }]));
    await d.doc(`${T}/retailOrders/z1`).set(ord('z1', [KIT(2)]));
    await d.doc(`${T}/retailOrders/z2`).set(ord('z2', [KIT(1), GEL]));
  });
  let peek: any = await runPOST(req({ tenantId: 't1', productId: 'kit', dryRun: true }));
  check('the check before cancelling finds orders past the first 200, and counts the cancelled order’s shipping',
    peek.body.orders === 2 && peek.body.refundCents === 3824 + 1512, peek.body);
  let r: any = await runPOST(req({ tenantId: 't1', productId: 'kit', reason: 'The supplier fell through' }));
  const z1 = await get(`${T}/retailOrders/z1`); const z2 = await get(`${T}/retailOrders/z2`);
  check('both are reached, though 205 other pre-orders come first (only the first 200 used to be read)', r.status === 200 && r.body.orders === 2, r.body);
  check('the order with only the kit is cancelled and gives back everything she paid: $38.24, shipping included (not $30.24)',
    z1.stage === 'cancelled' && z1.pendingRefundCents === 3824 && z1.lines[0].status === 'refunded', z1);
  check('the mixed order keeps shipping its polish and gives back the kit with its tax: $15.12', z2.stage === 'paid' && z2.pendingRefundCents === 1512 && z2.lines[1].status === 'pending', z2);
  const e1 = await card('z1', 'preorder_cancelled'); const e2 = await card('z2', 'preorder_cancelled');
  check('each email says what happened and that the refund is approved, not “in full” and not already on its way',
    !!e1 && /cancelled your order/.test(e1.body) && /A refund of \$38\.24 is approved/.test(e1.body) && !/in full/.test(e1.body)
    && !!e2 && /A refund of \$15\.12 is approved/.test(e2.body) && /rest of your order is unaffected/.test(e2.body) && !/in full/.test(e2.body), { e1, e2 });
  check('the run is closed', (await get(`${T}/inventory/kit`)).preorder === false);

  // ── Within the shop's automatic amount, and paid partly by gift card ──
  await fresh(5000, async (d) => {
    await d.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'GIFT-1234', balanceCents: 0, status: 'active', history: [] });
    // $38.24 order: $28.24 on the card, $10 on the gift card.
    await d.doc(`${T}/retailOrders/z3`).set(ord('z3', [KIT(2)], { chargedCents: 2824, giftCardId: 'g1', giftCardCode: 'GIFT-1234', giftCardCents: 1000, giftSpentAt: '2026-10-01T10:00:00Z' }));
    await d.doc(`${T}/private/nonCardPaid/orders/z3`).set({ at: '2026-10-01T10:00:00Z', giftCents: 1000, giftCardId: 'g1' });
  });
  r = await runPOST(req({ tenantId: 't1', productId: 'kit', reason: '' }));
  const z3 = await get(`${T}/retailOrders/z3`);
  check('cancelled outright: the card gets back its $28.24 straight away, within the shop’s amount',
    r.body.orders === 1 && stripeCalls.length === 1 && stripeCalls[0].amount === 2824 && z3.pendingRefundCents === 0 && r.body.refundCents === 3824 && r.body.sentCents === 3824, { r: r.body, z3, s: stripeCalls });
  check('…and the $10 she paid by gift card goes back on it', (await get(`${T}/giftCards/g1`)).balanceCents === 1000, await get(`${T}/giftCards/g1`));
  const e3 = await card('z3', 'preorder_cancelled');
  check('…and her email says the card part is on its way and the gift card part is back, each once', !!e3 && /\$28\.24 is on its way back to your card/.test(e3.body) && /\$10\.00 is back on your gift card/.test(e3.body) && !/\$2\.00/.test(e3.body), e3);

  r = await runPOST(req({ tenantId: 't1', productId: 'kit', reason: '' }));
  check('cancelling the run again does nothing more', r.body.orders === 0 && stripeCalls.length === 1 && (await get(`${T}/giftCards/g1`)).balanceCents === 1000, r.body);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
