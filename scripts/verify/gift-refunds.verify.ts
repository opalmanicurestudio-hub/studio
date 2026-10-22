// Checks refunds on orders paid partly or wholly by gift card or store credit (api/retail/refund, lib/non-card-back).
// The card gets back what it can; the rest goes back onto the gift card the order used (or as store credit when that
// card is gone), or as store credit for what store credit paid, never more than was paid that way, counted once on the
// paying order so a later refund or cancellation can't give it again. What was paid that way is the server's own record
// of it; an order paid before that record was kept is matched to the gift card's own history (the payment page checked
// with Stripe) or to store credit the server marked used on it, and a made-up one gives nothing back. Also the shop's
// automatic amount: who may send a refund under it, and that it's checked inside the claim.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/gift-refunds.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
let actor: any = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
const stripeCalls: any[] = []; const stripeMade: any[] = [];
// Stripe's payment pages, by id, and the times one was asked for.
let pages: Record<string, any> = {}; const pageAsks: string[] = []; let pagesDown = false;

function StripeMock(this: any) {
  return { checkout: { sessions: {
    retrieve: async (id: string, _p: any, opts: any) => {
      pageAsks.push(`${id}@${opts?.stripeAccount}`);
      if (pagesDown) throw Object.assign(new Error('timeout'), { type: 'StripeConnectionError' });
      if (!pages[id]) throw Object.assign(new Error('No such checkout.session'), { type: 'StripeInvalidRequestError', statusCode: 404, code: 'resource_missing' });
      return pages[id];
    },
  } }, refunds: {
    create: async (params: any, opts: any) => {
      stripeCalls.push({ params, opts });
      const r = { id: `re_${stripeCalls.length}`, amount: params.amount, metadata: params.metadata, status: 'succeeded', payment_intent: params.payment_intent };
      stripeMade.push(r);
      return r;
    },
    list: async (params: any) => ({ data: stripeMade.filter((r) => r.payment_intent === params.payment_intent) }),
  } };
}
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return StripeMock;
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/email-shell') return { brandedEmail: (_b: any, html: string) => html, emailButton: (link: string) => `<a href="${link}">`, getEmailBrand: async () => ({ shopName: 'Opal' }) };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, json: async () => ({}) });
process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.CRON_SECRET = 'cron'; process.env.RESEND_API_KEY = 'rk'; process.env.NOTIFY_FROM_EMAIL = 'shop@example.com';

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const all = async (path: string) => (await db.collection(path).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, nextUrl: { origin: 'https://shop.example' } }) as any;
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

// Dana's $40 order: $25 on her card, $15 on gift card GIFT-1234 (which has $5 on it now).
const mixed = (x: any = {}) => ({ id: 'm1', tenantId: 't1', orderNumber: 1050, stage: 'completed', method: 'ship', lines: [], subtotalCents: 4000, taxCents: 0, totalCents: 4000, chargedCents: 2500, refundedCents: 0,
  stripePaymentIntentId: 'pi_M', stripeCheckoutSessionId: 'cs_M', giftCardId: 'g1', giftCardCode: 'GIFT-1234', giftCardCents: 1500, giftSpentAt: '2026-10-20T15:00:00Z',
  qrToken: 'qrM', customerEmail: 'Dana@Example.com', customerName: 'Dana Whitfield', clientId: 'cl1', pendingRefundCents: 3000, ...x });

(async () => {
  const { POST } = await import('../../src/app/api/retail/refund/route');
  const fresh = async (setup: (d: any) => Promise<void> = async () => {}) => {
    db = makeDb(); stripeCalls.length = 0; stripeMade.length = 0;
    actor = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
    await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', retailSettings: {} });
    await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'GIFT-1234', balanceCents: 500, status: 'active', recipientId: 'cl1', history: [] });
    await db.doc(`${T}/retailOrders/m1`).set(mixed());
    // What the server wrote down when it took the $15 off the gift card.
    await db.doc(`${T}/private/nonCardPaid/orders/m1`).set({ at: '2026-10-20T15:00:00Z', giftCents: 1500, giftCardId: 'g1' });
    await db.doc(`${T}/loyaltyLedger/earn_order_m1`).set({ clientId: 'cl1', type: 'earn', points: 40, basisCents: 4000, saleId: 'order_m1' });
    pages = {}; pageAsks.length = 0; pagesDown = false;
    await setup(db);
  };
  const send = (orderId = 'm1', qrToken = 'qrM', extra: any = {}, headers: Record<string, string> = {}) => POST(req({ tenantId: 't1', orderId, qrToken, ...extra }, headers)) as any;

  // ── A return of $30 on the mixed order ──
  await fresh();
  let r = await send();
  let o = await get(`${T}/retailOrders/m1`); let g = await get(`${T}/giftCards/g1`);
  check('a $30 refund on a $25 card + $15 gift card order: $25 to the card, the other $5 back on the gift card',
    r.status === 200 && stripeCalls.length === 1 && stripeCalls[0].params.amount === 2500 && g.balanceCents === 1000 && r.body.cardCents === 2500 && r.body.otherCents === 500 && r.body.amountCents === 3000 && r.body.overCardCents === 0, { r: r.body, g });
  check('…recorded on the order: nothing left to send, $25 back on the card, $5 back the other way, counted once',
    o.pendingRefundCents === 0 && o.refundedCents === 2500 && o.refundedOtherCents === 500 && o.nonCardRestored?.giftCents === 500 && o.nonCardRestored?.creditCents === 0 && o.refundInFlight === null && o.refundSeq === 1, o);
  check('…the gift card’s history shows the $5 and why', g.history.length === 1 && g.history[0].cents === 500 && g.history[0].balanceAfter === 1000 && /Refund on order #1050/.test(g.history[0].note) && g.status === 'active', g.history);
  const ev = (await all(`${T}/retailOrders/m1/events`)).find((e: any) => e.type === 'refund_issued');
  check('…one refund in the order’s history, split by where it went', ev?.meta?.amountCents === 3000 && ev.meta.toCardCents === 2500 && ev.meta.giftCents === 500 && /\$25\.00 to the card/.test(ev.meta.text) && /\$5\.00 back on gift card GIFT-1234/.test(ev.meta.text), ev);
  let books = await all(`${T}/transactions`);
  check('…two refunds in the books: $25 by card and $5 by gift card', books.length === 2 && books.some((b: any) => b.amount === 25 && b.paymentMethod === 'Card (Online)') && books.some((b: any) => b.amount === 5 && b.paymentMethod === 'Gift card' && b.category === 'Refund'), books);
  check('…the team is told where it all went', /\$30\.00 refunded: \$25\.00 through Stripe to the card and \$5\.00 back on gift card GIFT-1234/.test(r.body.message), r.body.message);
  const card = (await all(`${T}/retailOrders/m1/inbox`)).find((x: any) => x.kind === 'refund_issued');
  check('…and so is Dana, on her order page: $30 in all, $5 of it on her gift card, usable right away',
    !!card && /30\.00/.test(card.body) && /\$5\.00 back on your gift card/.test(card.body) && /used again right away/.test(card.body), card);
  check('…and her wallet shows the gift card’s new balance', (await get(`${T}/clients/cl1`))?.giftBalanceCents === 1000, await get(`${T}/clients/cl1`));
  const rev = await get(`${T}/loyaltyLedger/rev_order_m1_re_1`);
  check('…the points come off for the whole $30, card and gift card', rev?.points === -30 && rev.saleId === 'order_m1', rev);

  // Another $15 queued: the card is used up, so $10 goes back on the gift card (all that's left of the $15 it paid), and
  // $5 stays on the order for a look.
  await db.doc(`${T}/retailOrders/m1`).set({ pendingRefundCents: 1500 }, { merge: true });
  r = await send();
  o = await get(`${T}/retailOrders/m1`); g = await get(`${T}/giftCards/g1`);
  check('the card used up: $10 more back on the gift card, never more than it paid, and no second card refund',
    r.status === 200 && stripeCalls.length === 1 && g.balanceCents === 2000 && r.body.cardCents === 0 && r.body.otherCents === 1000 && r.body.overCardCents === 500 && o.pendingRefundCents === 500 && o.nonCardRestored.giftCents === 1500, { r: r.body, o });
  check('…and the $5 beyond what she paid is called out', /\$5\.00 is more than is left of what they paid/.test(r.body.message), r.body.message);
  r = await send();
  check('asking again: everything paid has gone back, nothing moves', r.status === 409 && /Everything paid on this order has already gone back/.test(r.body.error) && stripeCalls.length === 1 && (await get(`${T}/giftCards/g1`)).balanceCents === 2000, r.body);

  // ── Paid entirely by gift card: no card refund, and no Stripe needed ──
  await fresh(async (d) => {
    await d.doc(T).set({ name: 'Opal', retailSettings: {} });
    await d.doc(`${T}/giftCards/g2`).set({ id: 'g2', code: 'GIFT-5678', balanceCents: 0, status: 'active', history: [] });
    await d.doc(`${T}/retailOrders/a1`).set({ id: 'a1', tenantId: 't1', orderNumber: 1051, stage: 'completed', totalCents: 2000, giftCardId: 'g2', giftCardCode: 'GIFT-5678', giftCardCents: 2000, giftSpentAt: '2026-10-20T15:00:00Z', paidVia: 'gift_card', qrToken: 'qrA', customerEmail: 'sam@example.com', customerName: 'Sam Lee', pendingRefundCents: 2000 });
    await d.doc(`${T}/private/nonCardPaid/orders/a1`).set({ at: '2026-10-20T15:00:00Z', giftCents: 2000, giftCardId: 'g2' });
  });
  r = await send('a1', 'qrA');
  o = await get(`${T}/retailOrders/a1`);
  check('an order paid all by gift card: the $20 goes back on the card, with no Stripe refund and no connected account needed',
    r.status === 200 && stripeCalls.length === 0 && (await get(`${T}/giftCards/g2`)).balanceCents === 2000 && r.body.cardCents === 0 && r.body.otherCents === 2000 && o.pendingRefundCents === 0 && !o.refundedCents && o.refundedOtherCents === 2000, { r: r.body, o });
  check('…no expense in the books (the sale was never booked through a card payment)', (await all(`${T}/transactions`)).length === 0);
  const aCard = (await all(`${T}/retailOrders/a1/inbox`)).find((x: any) => x.kind === 'refund_issued');
  check('…and Sam is told it’s ready to use, not that a bank will show it', !!aCard && /ready to use/.test(aCard.body) && !/business days/.test(aCard.body), aCard);
  check('…the team is told where it went', /\$20\.00 refunded: \$20\.00 back on gift card GIFT-5678/.test(r.body.message), r.body.message);

  await fresh(async (d) => { await d.doc(`${T}/retailOrders/n1`).set({ id: 'n1', tenantId: 't1', orderNumber: 1052, stage: 'completed', totalCents: 2000, qrToken: 'qrN', pendingRefundCents: 2000 }); });
  r = await send('n1', 'qrN');
  check('no card payment and nothing paid another way: refunded by hand, and said so', r.status === 422 && /No Stripe payment/.test(r.body.error), r.body);

  // ── Store credit ──
  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/s1`).set({ id: 's1', tenantId: 't1', orderNumber: 1053, stage: 'completed', totalCents: 3000, chargedCents: 1000, storeCreditRequestedCents: 2000, creditShortfallCents: 0, stripePaymentIntentId: 'pi_S', qrToken: 'qrS', customerEmail: 'Ana@Example.com', customerName: 'Ana Ruiz', clientId: 'cl9', pendingRefundCents: 3000 });
    await d.doc(`${T}/private/nonCardPaid/orders/s1`).set({ at: '2026-10-20T15:00:00Z', creditCents: 2000 });
  });
  r = await send('s1', 'qrS');
  const cr = (await all(`${T}/depositCredits`)).filter((c: any) => c.sourceRetailOrderId === 's1');
  check('$10 by card and $20 by store credit: $10 back to the card, $20 back as new store credit for her',
    r.status === 200 && stripeCalls[0]?.params.amount === 1000 && cr.length === 1 && cr[0].amountCents === 2000 && cr[0].status === 'available' && cr[0].sourceKind === 'refund' && cr[0].clientId === 'cl9' && cr[0].clientEmail === 'ana@example.com', { r: r.body, cr });
  check('…counted on the order', (await get(`${T}/retailOrders/s1`)).nonCardRestored?.creditCents === 2000);
  await db.doc(`${T}/loyaltyLedger/earn_order_s1`).set({ clientId: 'cl9', type: 'earn', points: 10, basisCents: 1000, saleId: 'order_s1' });
  await db.doc(`${T}/retailOrders/s1`).set({ pendingRefundCents: 0, nonCardRestored: { giftCents: 0, creditCents: 0 }, refundedCents: 1000 }, { merge: true });
  await db.doc(`${T}/retailOrders/s1`).set({ pendingRefundCents: 500 }, { merge: true });
  r = await send('s1', 'qrS');
  check('store credit that comes back takes no points back (it earned none)', r.status === 200 && r.body.otherCents === 500 && (await all(`${T}/loyaltyLedger`)).every((x: any) => !x.id.startsWith('rev_')), await all(`${T}/loyaltyLedger`));
  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/s2`).set({ id: 's2', tenantId: 't1', orderNumber: 1054, stage: 'completed', totalCents: 3000, chargedCents: 1000, storeCreditRequestedCents: 2000, creditShortfallCents: 2000, stripePaymentIntentId: 'pi_S2', qrToken: 'qrS2', customerEmail: 'ana@example.com', pendingRefundCents: 3000 });
    await d.doc(`${T}/private/nonCardPaid/orders/s2`).set({ at: '2026-10-20T15:00:00Z', creditCents: 0 });
  });
  r = await send('s2', 'qrS2');
  check('store credit that was never really there (all of it short) doesn’t come back', r.status === 200 && r.body.otherCents === 0 && r.body.overCardCents === 2000 && (await all(`${T}/depositCredits`)).length === 0, r.body);

  // ── The gift card it was paid with is gone ──
  await fresh(async (d) => { await d.doc(`${T}/giftCards/g1`).set({ status: 'void' }, { merge: true }); });
  r = await send();
  const vc = (await all(`${T}/depositCredits`)).filter((c: any) => c.sourceRetailOrderId === 'm1');
  check('the gift card was voided since: its $5 comes back as store credit, and the card stays as it was',
    r.status === 200 && vc.length === 1 && vc[0].amountCents === 500 && (await get(`${T}/giftCards/g1`)).balanceCents === 500 && /\$5\.00 back as store credit/.test(r.body.message) && (await get(`${T}/retailOrders/m1`)).nonCardRestored?.giftCents === 500, { r: r.body, vc });

  // ── A backorder's refund, paid on an order whose card has already had everything back ──
  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/m1`).set(mixed({ refundedCents: 2500, pendingRefundCents: 0 }));
    await d.doc(`${T}/retailOrders/b1`).set({ id: 'b1', tenantId: 't1', orderNumber: 1050, stage: 'cancelled', parentOrderId: 'm1', holdUntilRestock: true, totalCents: 0, subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, qrToken: 'qrM', customerEmail: 'dana@example.com', customerName: 'Dana Whitfield', pendingRefundCents: 1000,
      lines: [{ lineId: 'B1', productId: 'gel', unitPriceCents: 1000, unitPaidCents: 1000, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0, status: 'pending' }] });
  });
  r = await send('b1');
  const b = await get(`${T}/retailOrders/b1`); const pay = await get(`${T}/retailOrders/m1`);
  const note = (await all(`${T}/retailOrders/m1/events`)).find((e: any) => e.meta?.kind === 'follow_up_refund');
  check('a cancelled backorder’s $10, the original card used up: back on the gift card the original order used',
    r.status === 200 && stripeCalls.length === 0 && (await get(`${T}/giftCards/g1`)).balanceCents === 1500 && b.pendingRefundCents === 0 && b.refundedOtherCents === 1000 && pay.nonCardRestored?.giftCents === 1000 && pay.refundInFlight === null, { r: r.body, b, pay });
  check('…the original order’s history notes it', !!note && note.meta.amountCents === 1000 && /back on gift card GIFT-1234/.test(note.meta.text), note);

  // ── A try that was cut off after the card refund went: recorded once, with its gift card part ──
  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/m1`).set({ refundSeq: 0, refundInFlight: { cents: 2500, other: 500, seq: 1, at: ago(6), by: 'm1', refundedBefore: 0 } }, { merge: true });
  });
  stripeMade.push({ id: 're_old', amount: 2500, metadata: { retailOrderId: 'm1', seq: '1' }, status: 'succeeded', payment_intent: 'pi_M' });
  r = await send();
  o = await get(`${T}/retailOrders/m1`);
  check('a cut-off try: the card refund Stripe already made is recorded, not sent again, and the gift card part goes back with it',
    r.status === 200 && stripeCalls.length === 0 && o.refundedCents === 2500 && o.pendingRefundCents === 0 && o.refundSeq === 1 && (await get(`${T}/giftCards/g1`)).balanceCents === 1000 && o.lastStripeRefundId === 're_old', { r: r.body, o });

  // ── Limits count the whole refund ──
  await fresh(async (d) => { await d.doc(T).set({ retailSettings: { policies: { refundLimits: { cashier: 2500 } } } }, { merge: true }); });
  actor = { uid: 'k1', name: 'Kai', role: 'cashier', caps: ['checkout.refund'] };
  r = await send();
  check('a cashier’s $25 limit counts the gift card part too: $30 in all is over it', r.status === 403 && r.body.limitCents === 2500 && stripeCalls.length === 0 && (await get(`${T}/giftCards/g1`)).balanceCents === 500, r.body);

  // ── The shop's automatic amount ──
  const autoShop = async (cents: number) => { await db.doc(T).set({ retailSettings: { policies: { refundAutoBelowCents: cents } } }, { merge: true }); };
  await fresh(async () => { await autoShop(5000); });
  actor = { uid: 'f1', name: 'Jo Park', role: 'front_desk', caps: [] };
  r = await send('m1', 'qrM', { reason: 'policy' });
  check('within the shop’s automatic amount, anyone on the team sends the refund they made', r.status === 200 && stripeCalls.length === 1 && (await all(`${T}/retailOrders/m1/events`)).find((e: any) => e.type === 'refund_issued')?.actorName === 'Jo Park', r.body);
  await fresh(async () => { await autoShop(5000); });
  actor = { uid: 'f1', name: 'Jo Park', role: 'front_desk', caps: [] };
  r = await send();
  check('…only when they ask for it under that amount: a plain tap still needs someone allowed to refund', r.status === 403 && stripeCalls.length === 0, r.body);
  await fresh(async () => { await autoShop(2000); });
  actor = { uid: 'f1', name: 'Jo Park', role: 'front_desk', caps: [] };
  r = await send('m1', 'qrM', { reason: 'policy' });
  check('…never over it: $30 is over a $20 automatic amount', r.status === 403 && stripeCalls.length === 0, r.body);
  await fresh(async () => { await autoShop(5000); });
  actor = { uid: 'x1', name: 'Lee', role: 'renter', employmentModel: 'renter', caps: [] };
  r = await send('m1', 'qrM', { reason: 'policy' });
  check('…and never a renter', r.status === 403 && stripeCalls.length === 0, r.body);
  await fresh(async () => { await autoShop(0); });
  actor = { uid: 'f1', name: 'Jo Park', role: 'front_desk', caps: [] };
  r = await send('m1', 'qrM', { reason: 'policy' });
  check('…and not at all when the shop has no automatic amount', r.status === 403 && stripeCalls.length === 0, r.body);

  await fresh(async () => { await autoShop(5000); });
  actor = { uid: 'nobody', name: 'Nobody', caps: [] };
  r = await send('m1', 'qrM', { reason: 'policy' }, { 'x-internal-key': 'cron' });
  check('the shop’s own server sends one its rules decided, under the automatic amount', r.status === 200 && stripeCalls.length === 1 && (await all(`${T}/retailOrders/m1/events`)).find((e: any) => e.type === 'refund_issued')?.actorName === 'Automatic refund', r.body);
  await fresh(async () => { await autoShop(2000); });
  r = await send('m1', 'qrM', { reason: 'policy' }, { 'x-internal-key': 'cron' });
  check('…not over it', r.status === 403 && stripeCalls.length === 0, r.body);
  await fresh(async (d) => { await autoShop(5000); await d.doc(`${T}/retailOrders/m1`).set({ replacementFor: 'lost_in_transit' }, { merge: true }); });
  r = await send('m1', 'qrM', { reason: 'policy' }, { 'x-internal-key': 'cron' });
  check('…and never for a replacement for a lost parcel', r.status === 403 && stripeCalls.length === 0, r.body);
  await fresh(async () => { await autoShop(5000); });
  r = await send('m1', 'qrM', { reason: 'policy' }, { 'x-internal-key': 'wrong' });
  check('a wrong server key is just a team member’s tap (here: allowed to refund, so it goes as theirs)', r.status === 200 && (await all(`${T}/retailOrders/m1/events`)).find((e: any) => e.type === 'refund_issued')?.actorName === 'Rae Moss', r.body);

  // ── Paid before the server kept its record: matched to what only the server writes ──
  const legacy = (id: string, x: any = {}) => ({ id, tenantId: 't1', orderNumber: 990, stage: 'completed', method: 'ship', lines: [], subtotalCents: 4000, taxCents: 0, totalCents: 4000, chargedCents: 2500, refundedCents: 0,
    stripePaymentIntentId: `pi_${id}`, stripeCheckoutSessionId: `cs_${id}`, giftCardId: 'gL', giftCardCode: 'GIFT-9000', giftCardCents: 1500, giftSpentAt: '2026-10-05T15:00:00Z',
    qrToken: `qr${id}`, customerEmail: 'lee@example.com', customerName: 'Lee Grant', pendingRefundCents: 3000, ...x });
  const sendL = (id: string) => POST(req({ tenantId: 't1', orderId: id, qrToken: `qr${id}` })) as any;
  await fresh(async (d) => {
    await d.doc(`${T}/giftCards/gL`).set({ id: 'gL', code: 'GIFT-9000', balanceCents: 0, status: 'active', history: [{ at: '2026-10-05T15:00:00Z', type: 'spend', cents: -1500, balanceAfter: 0, by: 'Online shop', ref: 'cs_L1' }] });
    await d.doc(`${T}/retailOrders/L1`).set(legacy('L1'));
  });
  pages = { cs_L1: { id: 'cs_L1', metadata: { type: 'retail_order', retailOrderId: 'L1', tenantId: 't1' } } };
  r = await sendL('L1');
  let rec = await get(`${T}/private/nonCardPaid/orders/L1`);
  check('an order paid by card and gift card before the record was kept: the gift card’s own history (its payment page checked with Stripe) shows the $15, so $25 goes to the card and $5 back on the gift card',
    r.status === 200 && r.body.cardCents === 2500 && r.body.otherCents === 500 && (await get(`${T}/giftCards/gL`)).balanceCents === 500 && rec?.giftCents === 1500 && rec?.giftCardId === 'gL' && pageAsks.join() === 'cs_L1@acct_1', { r: r.body, rec, pageAsks });
  await db.doc(`${T}/retailOrders/L1`).set({ pendingRefundCents: 500 }, { merge: true });
  r = await sendL('L1');
  check('…recorded once: the next refund reads the record and asks Stripe nothing more', r.status === 200 && r.body.otherCents === 500 && pageAsks.length === 1, { r: r.body, pageAsks });

  // Paid all by gift card at checkout: the order is made, and its gift card charged a moment later, marked with it.
  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/L2`).set(legacy('L2', { chargedCents: 0, stripePaymentIntentId: null, stripeCheckoutSessionId: null, totalCents: 2000, giftCardCents: 2000, paidVia: 'gift_card', pendingRefundCents: 2000 }));
    await d.doc(`${T}/giftCards/gL`).set({ id: 'gL', code: 'GIFT-9000', balanceCents: 0, status: 'active', history: [{ at: new Date(Date.now() + 1000).toISOString(), type: 'spend', cents: -2000, balanceAfter: 0, by: 'Online shop', ref: 'L2' }] });
  });
  r = await sendL('L2');
  check('…one paid all by gift card at checkout: its spend is marked with the order, so it’s found without Stripe and the $20 goes back',
    r.status === 200 && r.body.otherCents === 2000 && (await get(`${T}/giftCards/gL`)).balanceCents === 2000 && pageAsks.length === 0, { r: r.body, pageAsks });
  // The same, but the order's own note that its gift card was charged never got written.
  await fresh(async (d) => {
    await d.doc(`${T}/retailOrders/L4`).set(legacy('L4', { chargedCents: 0, stripePaymentIntentId: null, stripeCheckoutSessionId: null, totalCents: 2000, giftCardCents: 2000, giftSpentAt: null, paidVia: 'gift_card', pendingRefundCents: 2000 }));
    await d.doc(`${T}/giftCards/gL`).set({ id: 'gL', code: 'GIFT-9000', balanceCents: 0, status: 'active', history: [{ at: new Date(Date.now() + 1000).toISOString(), type: 'spend', cents: -2000, balanceAfter: 0, by: 'Online shop', ref: 'L4' }] });
  });
  r = await sendL('L4');
  check('…and one whose own note that the gift card was charged never got written: the charge on the gift card is found, and the $20 goes back',
    r.status === 200 && r.body.otherCents === 2000 && (await get(`${T}/giftCards/gL`)).balanceCents === 2000, r.body);
  // Made up in a browser, given the id that a visit's gift card payment yesterday was marked with.
  await fresh(async (d) => {
    await d.doc(`${T}/giftCards/gL`).set({ id: 'gL', code: 'GIFT-9000', balanceCents: 0, status: 'active', history: [{ at: new Date(Date.now() - 86400e3).toISOString(), type: 'spend', cents: -2500, balanceAfter: 0, by: 'Front desk', ref: 'pos123' }] });
    await d.doc(`${T}/retailOrders/pos123`).set(legacy('pos123', { chargedCents: 0, stripePaymentIntentId: null, stripeCheckoutSessionId: null, totalCents: 0, giftCardCents: 2500, paidVia: 'gift_card', pendingRefundCents: 2500 }));
  });
  r = await sendL('pos123');
  check('…but an order made up later under the id another gift card payment was marked with gets nothing: that spend came before it existed',
    r.status >= 400 && /couldn’t be matched/.test(r.body.error) && (await get(`${T}/giftCards/gL`)).balanceCents === 0, r.body);

  // From before the card payment was recorded on the order, and its gift card part can't be matched (its history no
  // longer shows the spend): the card still only gets back what it really paid.
  await fresh(async (d) => {
    await d.doc(`${T}/giftCards/gL`).set({ id: 'gL', code: 'GIFT-9000', balanceCents: 0, status: 'active', history: [] });
    await d.doc(`${T}/retailOrders/L5`).set(legacy('L5', { chargedCents: null, pendingRefundCents: 4000 }));
  });
  r = await sendL('L5');
  check('an older order whose gift card part can’t be matched: the card gets back the $25 it paid, not the whole $40, and the rest is called out',
    r.status === 200 && stripeCalls[0]?.params.amount === 2500 && r.body.otherCents === 0 && r.body.overCardCents === 1500 && /couldn’t be matched/.test(r.body.message), { r: r.body, s: stripeCalls.map((c) => c.params.amount) });

  // Made up in a browser: claims a $15 gift card payment and points at another order's payment page.
  await fresh(async (d) => {
    await d.doc(`${T}/giftCards/gL`).set({ id: 'gL', code: 'GIFT-9000', balanceCents: 0, status: 'active', history: [{ at: '2026-10-05T15:00:00Z', type: 'spend', cents: -1500, balanceAfter: 0, by: 'Online shop', ref: 'cs_L1' }] });
    await d.doc(`${T}/retailOrders/F1`).set(legacy('F1', { chargedCents: 0, totalCents: 0, stripeCheckoutSessionId: 'cs_L1', pendingRefundCents: 1500 }));
  });
  pages = { cs_L1: { id: 'cs_L1', metadata: { type: 'retail_order', retailOrderId: 'L1', tenantId: 't1' } } };
  r = await sendL('F1');
  const fNotes = async () => (await all(`${T}/retailOrders/F1/events`)).filter((e: any) => e.meta?.kind === 'non_card_unconfirmed');
  check('an order made up in a browser claiming a gift card payment, pointing at another order’s payment page: nothing goes back on the gift card, and the team is told why',
    r.status >= 400 && /couldn’t be matched/.test(r.body.error) && (await get(`${T}/giftCards/gL`)).balanceCents === 0 && stripeCalls.length === 0 && !(await get(`${T}/private/nonCardPaid/orders/F1`))?.giftCents, r.body);
  r = await sendL('F1');
  const fn = await fNotes();
  check('…its history says so once, however often it’s tried', fn.length === 1 && /\$15\.00 paid by gift card/.test(fn[0].meta.text) && (await get(`${T}/giftCards/gL`)).balanceCents === 0, fn);

  // Store credit: a browser can add credit, never mark it used, so credit added already marked used on an order isn't proof.
  await fresh(async (d) => {
    await d.doc(`${T}/depositCredits/fake`).set({ id: 'fake', tenantId: 't1', clientEmail: 'lee@example.com', amountCents: 2000, usedCents: 2000, status: 'used', lastUsedOnRetailOrderId: 'F2', sourceRetailReturnId: 'x' });
    await d.doc(`${T}/retailOrders/F2`).set(legacy('F2', { chargedCents: 0, totalCents: 0, stripePaymentIntentId: null, stripeCheckoutSessionId: null, giftCardId: null, giftCardCents: 0, giftSpentAt: null, storeCreditRequestedCents: 2000, creditShortfallCents: 0, pendingRefundCents: 2000 }));
  });
  r = await sendL('F2');
  check('an order made up in a browser claiming $20 of store credit, with credit added already marked used on it: no store credit comes back',
    r.status >= 400 && /couldn’t be matched/.test(r.body.error) && (await all(`${T}/depositCredits`)).length === 1, { r: r.body });
  await fresh(async (d) => {
    await d.doc(`${T}/depositCredits/c1`).set({ id: 'c1', tenantId: 't1', clientEmail: 'lee@example.com', amountCents: 2000, status: 'available', createdAt: '2026-09-01T10:00:00Z' });
    await d.doc(`${T}/depositCredits/c1`).set({ usedCents: 2000, status: 'used', lastUsedAt: '2026-10-05T15:00:00Z', lastUsedOnRetailOrderId: 'L3' }, { merge: true });
    await d.doc(`${T}/retailOrders/L3`).set(legacy('L3', { giftCardId: null, giftCardCents: 0, giftSpentAt: null, storeCreditRequestedCents: 2000, creditShortfallCents: 0, chargedCents: 2000, pendingRefundCents: 4000 }));
  });
  r = await sendL('L3');
  const back3 = (await all(`${T}/depositCredits`)).filter((c: any) => c.sourceRetailOrderId === 'L3');
  check('…while a real one, whose credit the server marked used on it when it was paid, gets its $20 back as store credit',
    r.status === 200 && r.body.cardCents === 2000 && r.body.otherCents === 2000 && back3.length === 1 && back3[0].amountCents === 2000 && (await get(`${T}/private/nonCardPaid/orders/L3`))?.creditCents === 2000, { r: r.body, back3 });

  await fresh(async (d) => {
    await d.doc(`${T}/giftCards/gL`).set({ id: 'gL', code: 'GIFT-9000', balanceCents: 0, status: 'active', history: [{ at: '2026-10-05T15:00:00Z', type: 'spend', cents: -1500, balanceAfter: 0, by: 'Online shop', ref: 'cs_L1' }] });
    await d.doc(`${T}/retailOrders/L1`).set(legacy('L1'));
  });
  pagesDown = true;
  r = await sendL('L1');
  check('Stripe can’t be asked about the payment page: nothing is sent or recorded, and the team is told to try again',
    r.status === 502 && /Try again/.test(r.body.error) && stripeCalls.length === 0 && !(await get(`${T}/private/nonCardPaid/orders/L1`)) && (await get(`${T}/retailOrders/L1`)).refundInFlight == null, r.body);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
