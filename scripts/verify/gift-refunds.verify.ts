// Checks refunds on orders paid partly or wholly by gift card or store credit (api/retail/refund, lib/non-card-back).
// The card gets back what it can; the rest goes back onto the gift card the order used (or as store credit when that
// card is gone), or as store credit for what store credit paid, never more than was paid that way, counted once on the
// paying order so a later refund or cancellation can't give it again. Also the shop's automatic amount: who may send a
// refund under it, and that it's checked inside the claim.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/gift-refunds.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
let actor: any = { uid: 'm1', name: 'Rae Moss', role: 'manager', isManager: true, caps: ['checkout.refund'] };
const stripeCalls: any[] = []; const stripeMade: any[] = [];

function StripeMock(this: any) {
  return { refunds: {
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
    await db.doc(`${T}/loyaltyLedger/earn_order_m1`).set({ clientId: 'cl1', type: 'earn', points: 40, basisCents: 4000, saleId: 'order_m1' });
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
    await d.doc(`${T}/retailOrders/m1`).set({ refundSeq: 0, refundInFlight: { cents: 2500, other: 500, seq: 1, at: ago(3), by: 'm1', refundedBefore: 0 } }, { merge: true });
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

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
