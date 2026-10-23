// Checks that money given back or given as credit moves once — voids, store credit and balances:
//   - voiding a whole sale (api/checkout/void): two taps, a retry after a save that failed, a claim left too long, or
//     the receipt changing under the save undo everything once (stock, fees, deposits, the till, lifetime value,
//     gift card money), and the card is refunded once; Stripe saying no voids nothing and lets the claim go; a sale
//     taking from the same stock batch, or a package session used, while the void saves: built again, and both count;
//   - a booking deposit paid with a gift card (lib/gift-shop): two taps take it off the card once, with one line in
//     the books and one deposit credit;
//   - store credit given by staff or the app (api/credits/issue, and api/appt's thank-you for waiting): once per
//     attempt / per booking; earned credit only from the server or a manager; renters and the signed-out refused;
//   - a cash refund (lib/refund-payouts): the client and the desk choosing store credit at once credit once; two
//     set-ups for one case or sale make one refund; handing over, sending and cancelling happen once (one books line,
//     named after the refund), and cash taken from or put back in the till, or a missed pickup, moves the till once;
//   - change kept toward rent or tuition (api/rent/change-credit), including two sales toward one renter's invoice at
//     once, and a bad-debt write-off (api/credits/write-off), including a retry after a lost answer: once, and a
//     balance never goes below zero;
//   - referral credit (lib/referrals-server): issued once, and a credit spent at checkout while the sweep runs stays
//     spent (both when the reward is added and when it's taken back).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/void-credits.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.CRON_SECRET = 'cron_test';
let db: any = strictTransactions(makeDb());
let who: 'manager' | 'staff' | 'renter' | 'none' = 'manager';
const actorFor = (): any => (who === 'manager' ? { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] }
  : who === 'renter' ? { uid: 'r9', name: 'Rae Renter', role: 'renter', isManager: false, isRenter: true, caps: [] }
  : { uid: 's1', name: 'Sol Staff', role: 'front_desk', isManager: false, caps: [] });
// Card refunds (lib/stripe-refund): one refund per payment however often it's asked (its key is the payment); Stripe can say no.
const refunds = new Set<string>(); let refundCalls = 0; let refundSaysNo = false;
let emails = 0; let texts = 0; let tuitionApplied = 0;
let issuePOST: any = null;
const M: any = Module as any;
const load = M._load;
// Marked as a module, so a dynamic import() made inside the code being checked sees its named exports.
const fake = (request: string, mock: any) => { const m = { __esModule: true, ...mock }; const c = M._cache?.[request]; if (c) { c.exports = m; c.loaded = true; } return m; };
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);
const internalReq = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'x-cf-internal' ? 'cron_test' : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') { const S: any = function () { return {}; }; return Object.assign(S, { default: S, __esModule: true }); }
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (is(request, 'staff-auth')) return fake(request, { verifyStaffActor: async () => (who === 'none' ? { ok: false, status: 401, error: 'Please sign in again.' } : { ok: true, actor: actorFor(), tenant: {} }) });
  if (is(request, 'route-guard')) return fake(request, {
    requireRole: async (_r: any, _t: any, level = 'staff') => (who === 'none' ? { deny: { status: 401, body: { ok: false, error: 'Please sign in again.' } } }
      : level !== 'staff' && !actorFor().isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: actorFor() }),
    staffOrServer: async () => who !== 'none' });
  if (is(request, 'stripe-refund')) return fake(request, { refundPaymentIntent: async (_a: any, pi: string) => { refundCalls++; if (refundSaysNo) { refundSaysNo = false; return false; } refunds.add(pi); return true; } });
  if (is(request, 'audit')) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (is(request, 'notify')) return fake(request, { sendNotification: async () => ({ ok: true }) });
  if (is(request, 'loyalty-server')) return fake(request, { reverseSale: async () => ({ ok: true }) });
  if (is(request, 'restocking-fund')) return fake(request, { takeBackForSale: async () => undefined });
  if (is(request, 'account-receipts')) return fake(request, { sendReversalNotice: async () => undefined, sendAccountReceipt: async () => undefined });
  if (is(request, 'retail-webhook')) return fake(request, { sendStoreCreditEmail: async () => { emails++; } });
  if (is(request, 'sms')) return fake(request, { smsConfigured: () => true, sendTenantSms: async () => { texts++; return { ok: true }; } });
  if (is(request, 'push')) return fake(request, { pushNow: async () => undefined });
  if (is(request, 'claim-photo-upload')) return fake(request, { uploadClaimPhotoFromDataUrl: async () => ({ url: 'https://files.test/signature.png' }) });
  if (is(request, 'tuition-desk')) return fake(request, {
    tuitionAccount: async (_d: any, _t: string, planId: string) => (planId === 'pl1' ? { plan: { id: 'pl1', studentId: 'st1' }, name: 'Ava Student', balanceCents: 50000, open: true } : null),
    applyTuitionPayment: async (d: any, t: string, acct: any, o: any) => { tuitionApplied++; await d.collection(`tenants/${t}/tuitionEntries`).add({ planId: acct.plan.id, type: 'payment', amountCents: o.amountCents, desc: `Paid at the front desk — toward the next instalment (${o.method})`, ref: o.receiptId }); return {}; },
    reverseTuitionPayment: async () => undefined });
  if (is(request, 'message-policy')) {
    const real = load.call(this, request, ...rest);
    // Our own server calling our own routes: the store credit route, signed as the server.
    return fake(request, { ...real, internalOrigin: () => 'https://studio.test',
      internalPost: async (_o: string, path: string, body: any) => { if (path !== '/api/credits/issue' || !issuePOST) return { ok: false, status: 404, data: {} }; const r = await issuePOST(internalReq(body)); return { ok: r.status < 400, status: r.status, data: r.body }; } });
  }
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
const fresh = async () => { db = strictTransactions(makeDb()); refunds.clear(); refundCalls = 0; refundSaysNo = false; emails = 0; texts = 0; tuitionApplied = 0; who = 'manager';
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York' }); };
// A save that fails once, or a change just before the save goes in (another try taking over its claim, a sale at the
// same moment) — once, or before every save.
let failNextSave = false; let beforeSave: null | (() => Promise<void>) = null; let beforeEachSave: null | (() => Promise<void>) = null;
const watchSaves = () => { const real = db.batch.bind(db); db.batch = () => { const b = real(); const commit = b.commit; b.commit = async () => {
  if (failNextSave) { failNextSave = false; throw new Error('14 UNAVAILABLE: the save didn’t reach the database'); }
  if (beforeSave) { const f = beforeSave; beforeSave = null; await f(); }
  if (beforeEachSave) await beforeEachSave();
  return commit(); }; return b; }; };

(async () => {
  const { POST: voidSale } = await import('../../src/app/api/checkout/void/route');

  // ── 15. Voiding a whole sale ───────────────────────────────────────────────────────────────────────────────
  const sale = async (reversal: any = {}, receipt: any = {}) => {
    await fresh(); watchSaves();
    await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 500, totalCashSales: 300, totalCashTips: 0, voidsTotal: 0 });
    await db.doc(`${T}/inventory/p1`).set({ name: 'Cuticle oil', totalStock: 10 });
    await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', lifetimeValue: 200, outstandingBalance: 0, unpaidFees: [] });
    await db.doc(`${T}/depositCredits/d1`).set({ id: 'd1', kind: 'deposit', status: 'used', amountCents: 2000, usedCents: 2000, clientId: 'c1' });
    await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'AAAA-BBBB', codeKey: 'AAAABBBB', balanceCents: 1000, initialCents: 5000, status: 'active', holds: {}, history: [], recipientId: 'c1' });
    await db.doc(`${T}/appointments/a1`).set({ status: 'completed', clientId: 'c1', checkoutSessionId: 'cs1' });
    await db.doc(`${T}/transactions/l1`).set({ id: 'l1', checkoutSessionId: 'cs1', type: 'income', category: 'Service', amount: 60, description: 'Gel manicure', paymentMethod: 'Cash', taxBucket: 'revenue' });
    await db.doc(`${T}/transactions/l2`).set({ id: 'l2', checkoutSessionId: 'cs1', type: 'income', category: 'Retail', amount: 20, description: 'Cuticle oil', paymentMethod: 'Cash', taxBucket: 'revenue' });
    await db.doc(`${T}/receipts/r1`).set({ id: 'r1', date: new Date().toISOString(), clientId: 'c1', clientName: 'Maya Lopez', total: 80, checkoutSessionId: 'cs1', ...receipt,
      reversal: { method: 'cash', tillId: 'till1', cashSales: 50, cashTips: 0, cashIn: 50, products: [{ id: 'p1', name: 'Cuticle oil', quantity: 2 }], fees: [{ owner: 'c1', feeId: 'f1', feeAmount: 15, reason: 'Late fee' }],
        depositsUsed: [{ id: 'd1', cents: 2000 }], giftCardsUsed: [{ id: 'g1', cents: 1000 }], spend: { c1: 80 }, visits: [{ id: 'a1', statusBefore: 'completed' }], ...reversal } });
  };
  const voidIt = (x: any = {}) => voidSale(req({ tenantId: 't1', receiptId: 'r1', reason: 'Rang up the wrong client', ...x })) as any;
  const undone = async () => {
    const inv: any = await get(`${T}/inventory/p1`); const c: any = await get(`${T}/clients/c1`); const d: any = await get(`${T}/depositCredits/d1`);
    const till: any = await get(`${T}/tillSessions/till1`); const g: any = await get(`${T}/giftCards/g1`); const r: any = await get(`${T}/receipts/r1`);
    const lines = await all(`${T}/transactions`); const sc = await all(`${T}/stockCorrections`);
    return { stock: inv.totalStock, owed: c.outstandingBalance, fees: (c.unpaidFees || []).length, ltv: c.lifetimeValue, dep: d.status === 'available' ? d.usedCents : 'used', till: till.expectedCash, voids: till.voidsTotal,
      gift: g.balanceCents, giftLines: (g.history || []).filter((h: any) => h.ref === 'void:r1').length, voidLines: lines.filter((l: any) => l.category === 'Void').length, stockLines: sc.length,
      voided: !!r.voided, claim: r.voidClaimAt || null, claimId: r.voidClaimId || null, appt: (await get(`${T}/appointments/a1`)).status };
  };
  const once = { stock: 12, owed: 15, fees: 1, ltv: 120, dep: 0, till: 450, voids: 50, gift: 2000, giftLines: 1, voidLines: 2, stockLines: 1, voided: true, claim: null, claimId: null, appt: 'checked_in' };
  const asBefore = { stock: 10, owed: 0, fees: 0, ltv: 200, dep: 'used', till: 500, voids: 0, gift: 1000, giftLines: 0, voidLines: 0, stockLines: 0, voided: false, claim: null, claimId: null, appt: 'completed' };
  const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

  console.log('15. voiding a whole sale');
  await sale();
  const [v1, v2] = await Promise.all([voidIt(), voidIt()]);
  const did = [v1, v2].filter((r: any) => r.status === 200 && r.body.ok && !r.body.already);
  check('two voids at once: one does it, the other is told it’s under way', did.length === 1 && [v1, v2].some((r: any) => r.status === 409 || r.body.already), [v1.body, v2.body]);
  let u = await undone();
  check('…stock, owed fees, the deposit, the till, lifetime value and gift card money are each put back once', same(u, once), u);
  check('…the desk is told how much cash to hand back', did[0]?.body.cashToReturn === 50 && /take \$50\.00 out/.test(String(did[0]?.body.tillNote)), did[0]?.body);
  const again: any = await voidIt();
  check('asked again: already voided, nothing more', again.status === 200 && again.body.already && same(await undone(), once), again.body);

  await sale();
  failNextSave = true;
  let r: any = await voidIt();
  u = await undone();
  check('the save fails: nothing is undone (gift card money included) and the claim is let go', r.status === 500 && same(u, asBefore), { body: r.body, u });
  r = await voidIt();
  check('…pressing Void again undoes everything once', r.status === 200 && r.body.ok && same(await undone(), once), r.body);

  console.log('15. …a card sale');
  await sale({ method: 'card', cashSales: 0, cashIn: 0, stripePaymentIntentId: 'pi_card' });
  await db.doc(`${T}/transactions/l3`).set({ id: 'l3', stripePaymentIntentId: 'pi_card', type: 'income', category: 'Service', amount: 80, description: 'Card payment', paymentMethod: 'Card', taxBucket: 'revenue' });
  const cardOnce = { ...once, till: 500, voids: 0, voidLines: 3 };
  const [cv1, cv2] = await Promise.all([voidIt(), voidIt()]);
  check('two at once: the card is refunded once and the sale undone once', refundCalls === 1 && refunds.size === 1 && [cv1, cv2].filter((x: any) => x.status === 200 && x.body.ok && x.body.refunded && !x.body.already).length === 1 && same(await undone(), cardOnce), { refundCalls, u: await undone(), b: [cv1.body, cv2.body] });
  await sale({ method: 'card', cashSales: 0, cashIn: 0, stripePaymentIntentId: 'pi_card' });
  failNextSave = true;
  r = await voidIt();
  check('refunded, then the save fails: the desk is told to press Void again; nothing else changed', r.status === 500 && /press Void again/.test(r.body.error) && refunds.size === 1 && same({ ...(await undone()) }, { ...asBefore, till: 500 }), { b: r.body, u: await undone() });
  r = await voidIt();
  check('…pressing Void again: no second refund, the gift card filled back once', r.status === 200 && r.body.refunded && refundCalls === 1 && (await undone()).gift === 2000 && (await undone()).giftLines === 1, { refundCalls, b: r.body });
  await sale({ method: 'card', cashSales: 0, cashIn: 0, stripePaymentIntentId: 'pi_card' });
  refundSaysNo = true;
  r = await voidIt();
  check('Stripe says no: nothing voided, the claim let go', r.status === 502 && same(await undone(), { ...asBefore, till: 500 }), { b: r.body, u: await undone() });
  r = await voidIt();
  check('…trying again refunds and voids once', r.status === 200 && r.body.ok && refunds.size === 1 && (await undone()).voided, r.body);

  console.log('15. …claims');
  await sale({}, { voidClaimAt: new Date().toISOString(), voidClaimId: 'other' });
  r = await voidIt();
  check('a void under way elsewhere: told to give it a moment, nothing changes', r.status === 409 && same({ ...(await undone()), claim: null, claimId: null }, asBefore), r.body);
  await sale({}, { voidClaimAt: new Date(Date.now() - 3 * 60000).toISOString(), voidClaimId: 'stale' });
  r = await voidIt();
  check('a claim left for over two minutes by a try that never finished is taken over: voided once', r.status === 200 && r.body.ok && same(await undone(), once), { b: r.body, u: await undone() });
  await sale();
  beforeSave = async () => { await db.doc(`${T}/receipts/r1`).set({ voidClaimId: 'taker', voidClaimAt: new Date().toISOString() }, { merge: true }); };
  r = await voidIt();
  u = await undone();
  check('the receipt changes just before the save (another try took over): the save is refused, nothing undone, their claim kept', r.status === 409 && u.stock === 10 && u.gift === 1000 && !u.voided && u.claimId === 'taker', { b: r.body, u });

  console.log('15. …something it was worked out from changes before the save');
  const batch1 = (stock: number) => [{ id: 'b1', stock, costPerUnit: 2, receivedDate: '2026-09-01' }];
  await sale();
  await db.doc(`${T}/inventory/p1`).set({ batches: batch1(3) }, { merge: true });
  beforeSave = async () => { await db.doc(`${T}/inventory/p1`).set({ totalStock: 9, batches: batch1(2) }, { merge: true }); };   // another sale takes one from the same batch
  r = await voidIt();
  let inv: any = await get(`${T}/inventory/p1`); u = await undone();
  check('another sale takes stock from the same batch while the void saves: built again, and both count', r.status === 200 && r.body.ok && inv.totalStock === 11 && inv.batches[0].stock === 4 && u.gift === 2000 && u.giftLines === 1 && u.voidLines === 2 && u.stockLines === 1, { b: r.body, inv, u });
  await sale({ redeemed: { clientId: 'c1', type: 'package', id: 'pk1' } });
  await db.doc(`${T}/clients/c1`).set({ activePackages: [{ packageId: 'pk1', sessionsRemaining: 2 }] }, { merge: true });
  beforeSave = async () => { await db.doc(`${T}/clients/c1`).set({ activePackages: [{ packageId: 'pk1', sessionsRemaining: 1 }] }, { merge: true }); };   // a visit uses a session meanwhile
  r = await voidIt();
  const pk: any = (((await get(`${T}/clients/c1`)) as any).activePackages || [])[0]; u = await undone();
  check('a package session used elsewhere while the void saves: built again, the session given back counts on top', r.body.ok && pk?.sessionsRemaining === 2 && u.ltv === 120 && u.owed === 15 && u.fees === 1, { b: r.body, pk, u });
  await sale({ products: [{ id: 'p1', name: 'Cuticle oil', quantity: 1 }, { id: 'p1', name: 'Cuticle oil', quantity: 2 }] });
  await db.doc(`${T}/inventory/p1`).set({ batches: batch1(3) }, { merge: true });
  r = await voidIt();
  inv = await get(`${T}/inventory/p1`);
  check('two lines of the same item: both go back on the shelf and into its batch, each in the stock ledger', r.body.ok && inv.totalStock === 13 && inv.batches[0].stock === 6 && (await all(`${T}/stockCorrections`)).length === 2, inv);
  await sale();
  await db.doc(`${T}/inventory/p1`).set({ batches: batch1(3) }, { merge: true });
  let bumps = 0; beforeEachSave = async () => { bumps++; await db.doc(`${T}/inventory/p1`).set({ countedAt: String(bumps) }, { merge: true }); };
  r = await voidIt(); beforeEachSave = null; u = await undone();
  check('if it keeps changing, the void stops after three tries with nothing undone, and lets go of the claim', r.status === 500 && bumps === 3 && same(u, asBefore), { b: r.body, bumps, u });
  await sale(); who = 'staff';
  r = await voidIt();
  check('no manager’s approval: refused, and the claim let go', r.status === 403 && same(await undone(), asBefore), r.body);
  who = 'none';
  r = await voidIt();
  check('not signed in: refused, nothing changes', r.status === 401 && same(await undone(), asBefore), r.body);

  // ── 16. A booking deposit paid with a gift card ────────────────────────────────────────────────────────────
  console.log('16. a deposit paid with a gift card');
  const gc = await import('../../src/lib/gift-cards'); const gs = await import('../../src/lib/gift-shop');
  const booking = async () => { await fresh(); await db.doc(`${T}/appointments/a1`).set({ status: 'pending_payment', depositAmountCents: 2000, clientId: 'c1', clientName: 'Tia Brown', clientEmail: 'tia@x.com', serviceName: 'Gel manicure', startTime: new Date(Date.now() + 864e5).toISOString() });
    return ((await gc.issueGiftCard(db, 't1', { amountCents: 7500, by: 'x', source: 'desk' })) as any).card; };
  const depositRecords = async () => ({ lines: (await all(`${T}/transactions`)).filter((x: any) => x.category === 'Retainers' && x.appointmentId === 'a1').length, credits: (await all(`${T}/depositCredits`)).filter((x: any) => x.sourceAppointmentId === 'a1').length });
  let card = await booking();
  const [d1, d2] = await Promise.all([gs.payDepositWithGiftCard(db, 't1', 'a1', card.code, ''), gs.payDepositWithGiftCard(db, 't1', 'a1', card.code, '')]) as any[];
  let rec = await depositRecords(); let ap: any = await get(`${T}/appointments/a1`);
  check('two taps at once: $20 off the card once, one line in the books, one deposit credit, booking confirmed', d1.ok && d2.ok && [d1, d2].filter((x) => !x.already).length === 1 && (await get(`${T}/giftCards/${card.id}`)).balanceCents === 5500 && rec.lines === 1 && rec.credits === 1 && ap.status === 'confirmed' && ap.depositStatus === 'paid', { d1, d2, rec, bal: (await get(`${T}/giftCards/${card.id}`)).balanceCents });
  const d3: any = await gs.payDepositWithGiftCard(db, 't1', 'a1', card.code, '');
  rec = await depositRecords();
  check('asked again: paid already, nothing more off the card', d3.ok && d3.already && (await get(`${T}/giftCards/${card.id}`)).balanceCents === 5500 && rec.lines === 1 && rec.credits === 1, d3);
  card = await booking();
  const [dep, desk] = await Promise.all([gs.payDepositWithGiftCard(db, 't1', 'a1', card.code, ''), gc.spendGiftCard(db, 't1', { id: card.id, cents: 6000, by: 'Front desk' })]) as any[];
  const bal = (await get(`${T}/giftCards/${card.id}`)).balanceCents; rec = await depositRecords();
  check('the desk spends the card at the same moment: never more than is on it, and a deposit is recorded only if it was taken', bal >= 0 && (dep.ok ? 1 : 0) + (desk.ok ? 1 : 0) === 1 && bal === 7500 - (dep.ok ? 2000 : 0) - (desk.ok ? 6000 : 0) && rec.lines === (dep.ok ? 1 : 0) && rec.credits === (dep.ok ? 1 : 0), { dep, desk, bal, rec });

  // ── 17. Store credit given by staff or by the app ──────────────────────────────────────────────────────────
  console.log('17. store credit given by staff or the app');
  const { POST: issue } = await import('../../src/app/api/credits/issue/route'); issuePOST = issue;
  const client0 = async () => { await fresh(); await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@x.com', storeCredits: [], totalStoreCredit: 0 }); };
  const credits = async () => { const c: any = await get(`${T}/clients/c1`); return { n: (c.storeCredits || []).length, total: c.totalStoreCredit || 0, lines: (await all(`${T}/transactions`)).filter((x: any) => x.category === 'Service Recovery').length, ids: (c.storeCredits || []).map((x: any) => x.id) }; };
  const give = (x: any = {}, internal = false) => issue(internal ? internalReq({ tenantId: 't1', clientId: 'c1', amountCents: 2000, type: 'courtesy', source: 'service_recovery', reason: 'Polish chipped', createdBy: 'system', ...x })
    : req({ tenantId: 't1', clientId: 'c1', amountCents: 2000, type: 'courtesy', source: 'service_recovery', reason: 'Polish chipped', createdBy: 's1', attemptKey: 'recovery_abc12345', ...x })) as any;
  await client0(); who = 'staff';
  const [i1, i2] = await Promise.all([give(), give()]);
  let cr = await credits();
  check('a double tap on the recovery dialog: one $20 credit, one expense line, one email', i1.status === 200 && i2.status === 200 && [i1, i2].filter((x: any) => !x.body.already).length === 1 && cr.n === 1 && cr.total === 20 && cr.lines === 1 && emails === 1, { b: [i1.body, i2.body], cr, emails });
  const i3: any = await give();
  check('asked again after a lost answer: the same credit back, nothing more', i3.status === 200 && i3.body.already && i3.body.creditId === i1.body.creditId && same(await credits(), cr), i3.body);
  r = await give({ attemptKey: undefined });
  check('no attempt key: refused, nothing written', r.status === 400 && (await credits()).n === 1, r.body);
  r = await give({ attemptKey: 'recovery_other001', amountCents: 9000 });
  check('over the staff limit with no manager’s PIN: refused, nothing written', r.status === 403 && r.body.code === 'needs_approval' && (await credits()).n === 1, r.body);
  r = await give({ type: 'earned', source: 'manual_credit', attemptKey: 'earned_staff0001' });
  check('“earned” credit from a staff member: refused', r.status === 403 && (await credits()).n === 1, r.body);
  who = 'renter';
  r = await give({ attemptKey: 'recovery_renter01' });
  check('a booth renter can’t give the shop’s store credit', r.status === 403 && (await credits()).n === 1, r.body);
  who = 'none';
  r = await give({ attemptKey: 'recovery_nobody01' });
  check('not signed in: refused', r.status === 401 && (await credits()).n === 1, r.body);
  who = 'manager';
  r = await give({ type: 'earned', source: 'manual_credit', attemptKey: 'earned_mgr000001' });
  cr = await credits();
  check('“earned” credit from a manager: added, with no expense line', r.status === 200 && r.body.ok && cr.n === 2 && cr.total === 40 && cr.lines === 1, { b: r.body, cr });
  r = await give({ type: 'earned', source: 'cancellation_retain_partial', attemptKey: 'earned_srv000001' }, true);
  check('“earned” credit from the app’s own server: added', r.status === 200 && r.body.ok && (await credits()).n === 3, r.body);
  const delay = (x: any = {}) => give({ source: 'provider_delay', amountCents: 500, reason: 'Thank you for waiting (15 min delay)', appointmentId: 'a7', ...x }, true);
  const [w1, w2] = await Promise.all([delay(), delay()]);
  cr = await credits();
  check('the thank-you for waiting is accepted, and two at once add it once, named after the booking', w1.status === 200 && w2.status === 200 && cr.ids.filter((x: string) => x === 'provider_delay_a7').length === 1 && cr.total === 65 && cr.n === 4, { b: [w1.body, w2.body], cr });

  console.log('17. …the client chooses to wait (api/appt)');
  const { POST: appt } = await import('../../src/app/api/appt/route');
  await client0();
  await db.doc(T).set({ bookingPolicies: { providerDelayCredit: 5 } }, { merge: true });
  const start = Date.now() + 3 * 3600e3;
  await db.doc(`${T}/appointments/a7`).set({ id: 'a7', clientId: 'c1', clientName: 'Maya Lopez', staffId: 's1', status: 'confirmed', manageToken: 'tok_1234567890abcdef', startTime: new Date(start).toISOString(), endTime: new Date(start + 3600e3).toISOString(),
    providerDelay: { minutes: 15, newStartAt: new Date(start + 15 * 60000).toISOString() } });
  const keep = () => appt(req({ action: 'provider_delay_reply', tenantId: 't1', apptId: 'a7', k: 'tok_1234567890abcdef', choice: 'keep' })) as any;
  const [k1, k2] = await Promise.all([keep(), keep()]);
  cr = await credits();
  check('two “keep it” replies at once: the $5 thank-you is given once', k1.status === 200 && k2.status === 200 && cr.ids.filter((x: string) => x === 'provider_delay_a7').length === 1 && cr.n === 1 && cr.total === 5, { b: [k1.body, k2.body], cr });

  // ── 18. A cash refund taken as store credit ────────────────────────────────────────────────────────────────
  console.log('18. a cash refund taken as store credit');
  const RP = await import('../../src/lib/refund-payouts');
  await fresh();
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', phone: '+15555550100', storeCredits: [], totalStoreCredit: 0 });
  await db.doc(`${T}/transactions/s1`).set({ id: 's1', type: 'income', category: 'Service', amount: 25, paymentMethod: 'Cash', refundPendingId: 'p1', clientId: 'c1' });
  await db.doc(`${T}/cases/k1`).set({ id: 'k1', number: 'MR-7', fix: { amountCents: 2500 } });
  await db.doc(`${T}/refundPayouts/p1`).set({ id: 'p1', number: 'MR-7', status: 'choose', mode: 'client', method: null, amountCents: 2500, clientId: 'c1', clientName: 'Maya Lopez', clientFirst: 'Maya', saleId: 's1', caseId: 'k1', timeline: [] });
  const key = RP.payoutKey('t1', 'p1');
  const staffActor = { name: 'Ana Ruiz', isManager: true };
  const picks = await Promise.all([RP.clientAct(db, 't1', 'p1', key, { action: 'choose', method: 'credit' }), RP.clientAct(db, 't1', 'p1', key, { action: 'choose', method: 'credit' }), RP.staffAct(db, 't1', staffActor, { action: 'choose', id: 'p1', method: 'credit' })]) as any[];
  const mc: any = await get(`${T}/clients/c1`); const po: any = await get(`${T}/refundPayouts/p1`); const s1: any = await get(`${T}/transactions/s1`); const k1d: any = await get(`${T}/cases/k1`);
  check('the client taps twice and the desk chooses at the same moment: $25 credit once, named after the refund', (mc.storeCredits || []).length === 1 && mc.storeCredits[0].id === 'refund_p1' && mc.totalStoreCredit === 25, { picks, mc });
  check('…the refund, its sale and its case say so, and the client is texted once', po.status === 'credited' && s1.refundedAsCreditAt && s1.refundPendingId === null && k1d.fix?.refundVia === 'Store credit' && texts === 1, { po: po.status, s1, fix: k1d.fix, texts });
  const later: any = await RP.staffAct(db, 't1', staffActor, { action: 'choose', id: 'p1', method: 'credit' });
  check('chosen again later: nothing more', !later.ok && ((await get(`${T}/clients/c1`)) as any).totalStoreCredit === 25, later);
  await db.doc(`${T}/refundPayouts/p2`).set({ id: 'p2', status: 'choose', mode: 'client', method: null, amountCents: 1000, clientId: 'c1', clientName: 'Maya Lopez', clientFirst: 'Maya', timeline: [] });
  const key2 = RP.payoutKey('t1', 'p2');
  await Promise.all([RP.clientAct(db, 't1', 'p2', key2, { action: 'choose', method: 'credit' }), RP.staffAct(db, 't1', staffActor, { action: 'choose', id: 'p2', method: 'pickup' })]);
  const p2: any = await get(`${T}/refundPayouts/p2`); const mc2: any = await get(`${T}/clients/c1`);
  const pickupAfter: any = await RP.clientAct(db, 't1', 'p2', key2, { action: 'change' });
  check('the client takes credit while the desk picks cash pickup: it ends credited once, and can’t be reopened for pickup', p2.status === 'credited' && mc2.storeCredits.filter((c: any) => c.id === 'refund_p2').length === 1 && mc2.totalStoreCredit === 35 && !pickupAfter.ok && (await get(`${T}/refundPayouts/p2`)).status === 'credited', { p2: p2.status, total: mc2.totalStoreCredit, pickupAfter });

  console.log('18. …setting up, handing over, sending, cancelling, the till');
  await db.doc(`${T}/cases/k5`).set({ id: 'k5', number: 'MR-9', clientId: 'c1', clientName: 'Maya Lopez', fix: { amountCents: 3000 } });
  const setups = await Promise.all([1, 2].map(() => RP.staffAct(db, 't1', staffActor, { action: 'create', caseId: 'k5', mode: 'client' }))) as any[];
  const forCase = (await all(`${T}/refundPayouts`)).filter((x: any) => x.caseId === 'k5');
  check('two set-ups for the same case at the same moment: one refund; the other is told one is set up', forCase.length === 1 && setups.filter((x) => x.ok).length === 1 && /already set up/.test(String(setups.find((x) => !x.ok)?.error)) && (await get(`${T}/cases/k5`)).payoutId === forCase[0]?.id, { setups, n: forCase.length });
  await db.doc(`${T}/transactions/s7`).set({ id: 's7', type: 'income', category: 'Service', amount: 15, paymentMethod: 'Cash', clientId: 'c1', clientOrVendor: 'Maya Lopez' });
  const saleSetups = await Promise.all([1, 2].map(() => RP.staffAct(db, 't1', staffActor, { action: 'create', mode: 'client', saleId: 's7', clientId: 'c1', amountCents: 1500, reason: 'Chipped polish' }))) as any[];
  const forSale = (await all(`${T}/refundPayouts`)).filter((x: any) => x.saleId === 's7');
  check('…and for the same sale: one refund, and the sale points at it', forSale.length === 1 && saleSetups.filter((x) => x.ok).length === 1 && (await get(`${T}/transactions/s7`)).refundPendingId === forSale[0]?.id, { saleSetups, n: forSale.length });
  const window0 = { date: '2026-10-23', start: '10:00', end: '12:00', startAt: new Date(Date.now() - 3 * 3600e3).toISOString(), endAt: new Date(Date.now() + 3600e3).toISOString() };
  await db.doc(`${T}/tillSessions/till9`).set({ status: 'open', expectedCash: 400, totalCashRefunds: 0 });
  await db.doc(`${T}/transactions/s8`).set({ id: 's8', type: 'income', category: 'Service', amount: 20, paymentMethod: 'Cash', clientId: 'c1', refundPendingId: 'p3' });
  await db.doc(`${T}/cases/k8`).set({ id: 'k8', payoutId: 'p3', fix: { amountCents: 2000 } });
  const payout = (id: string, x: any) => db.doc(`${T}/refundPayouts/${id}`).set({ id, mode: 'staff', clientId: 'c1', clientName: 'Maya Lopez', clientFirst: 'Maya', timeline: [], ...x });
  await payout('p3', { status: 'scheduled', method: 'pickup', amountCents: 2000, saleId: 's8', caseId: 'k8', pickup: window0, prep: { tillAt: new Date().toISOString(), tillSessionId: 'till9', preparedBy: 'Ana Ruiz', countedBy: 'Bo Lee' } });
  await db.doc(`${T}/refundCodes/p3`).set({ code: '4321' });
  const hands = await Promise.all([1, 2].map(() => RP.staffAct(db, 't1', staffActor, { action: 'handover', id: 'p3', code: '4321', signature: 'data:image/png;base64,AAAA' }))) as any[];
  const refundLinesFor = async (id: string) => (await all(`${T}/transactions`)).filter((x: any) => x.payoutId === id && x.category === 'Refunds');
  const l3 = await refundLinesFor('p3');
  check('two taps on “handed over”: handed once, one refund line in the books (named after the refund), the sale and case marked once', hands.filter((x) => x.ok).length === 1 && l3.length === 1 && l3[0].id === 'payout_refund_p3' && (await get(`${T}/refundPayouts/p3`)).status === 'handed' && !!(await get(`${T}/transactions/s8`)).refundedAt && ((await get(`${T}/cases/k8`)).timeline || []).length === 1, { hands, lines: l3.length });
  await payout('p4', { status: 'to_send', method: 'venmo', amountCents: 1200, app: { handle: '@maya' } });
  const sends = await Promise.all([1, 2].map(() => RP.staffAct(db, 't1', staffActor, { action: 'sent', id: 'p4', ref: 'V123' }))) as any[];
  check('two taps on “I sent it”: sent once, one refund line in the books', sends.filter((x) => x.ok).length === 1 && (await refundLinesFor('p4')).length === 1 && (await get(`${T}/refundPayouts/p4`)).status === 'sent', { sends });
  await payout('p5', { status: 'choose', mode: 'client', method: null, amountCents: 800 });
  const [cc, cx] = await Promise.all([RP.clientAct(db, 't1', 'p5', RP.payoutKey('t1', 'p5'), { action: 'choose', method: 'credit' }), RP.staffAct(db, 't1', staffActor, { action: 'cancel', id: 'p5' })]) as any[];
  const p5: any = await get(`${T}/refundPayouts/p5`); const credited5 = (((await get(`${T}/clients/c1`)) as any).storeCredits || []).filter((x: any) => x.id === 'refund_p5').length;
  check('the client takes credit as the desk cancels: one or the other, never both', (p5.status === 'credited' && credited5 === 1 && !cx.ok) || (p5.status === 'cancelled' && credited5 === 0 && !cc.ok), { p5: p5.status, credited5, cc, cx });
  await payout('p6', { status: 'scheduled', method: 'pickup', amountCents: 2000, pickup: { ...window0, endAt: new Date(Date.now() + 5 * 3600e3).toISOString() } });
  const till0 = (await get(`${T}/tillSessions/till9`)).expectedCash;
  await Promise.all([1, 2].map(() => RP.staffAct(db, 't1', staffActor, { action: 'till', id: 'p6' })));
  const till1 = (await get(`${T}/tillSessions/till9`)).expectedCash;
  await Promise.all([1, 2].map(() => RP.staffAct(db, 't1', staffActor, { action: 'return_till', id: 'p6' })));
  const till2 = (await get(`${T}/tillSessions/till9`)).expectedCash;
  check('two taps taking the envelope’s cash from the till, then two putting it back: out once, back once', till1 === till0 - 20 && till2 === till0, { till0, till1, till2 });
  await payout('p7', { status: 'scheduled', method: 'pickup', amountCents: 1000, missed: 0, pickup: { ...window0, endAt: new Date(Date.now() - 2 * 3600e3).toISOString() }, prep: { tillAt: new Date().toISOString(), tillSessionId: 'till9', preparedBy: 'Ana Ruiz' } });
  const till3 = (await get(`${T}/tillSessions/till9`)).expectedCash;
  await Promise.all([RP.staffAct(db, 't1', staffActor, { action: 'missed', id: 'p7' }), RP.missedPickupSweep(db, 't1', await get(T))]);
  const p7: any = await get(`${T}/refundPayouts/p7`);
  check('the desk marks a pickup missed as the every-few-minutes job does: counted once, its cash back in the till once', p7.missed === 1 && p7.status === 'pickup_time' && (await get(`${T}/tillSessions/till9`)).expectedCash === till3 + 10, { missed: p7.missed, status: p7.status, till: (await get(`${T}/tillSessions/till9`)).expectedCash, till3 });

  // ── 23. Change kept toward rent or tuition; a write-off ────────────────────────────────────────────────────
  console.log('23. change kept toward rent or tuition');
  const { POST: change } = await import('../../src/app/api/rent/change-credit/route');
  await fresh();
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 500, totalCashSales: 300 });
  await db.doc(`${T}/renters/rn1`).set({ firstName: 'Rae', lastName: 'Renter' });
  await db.doc(`${T}/rentLedger/e1`).set({ renterId: 'rn1', type: 'charge', amountCents: 500, status: 'pending', dueDate: '2026-10-01' });
  await db.doc(`${T}/receipts/r2`).set({ id: 'r2', amountTendered: 100, total: 90, tillId: 'till1' });
  const keepChange = (x: any = {}) => change(req({ tenantId: 't1', receiptId: 'r2', cents: 1000, kind: 'rent', renterId: 'rn1', ...x })) as any;
  const [ch1, ch2] = await Promise.all([keepChange(), keepChange()]);
  const payments = async () => (await all(`${T}/rentLedger`)).filter((x: any) => x.type === 'payment').length;
  const keptLines = async () => (await all(`${T}/transactions`)).filter((x: any) => /change kept/.test(String(x.description || ''))).length;
  check('a double tap: the $10 goes toward rent once, one line in the books, the till up $10 once', ch1.body.ok && ch2.body.ok && (await payments()) === 1 && (await keptLines()) === 1 && (await get(`${T}/tillSessions/till1`)).expectedCash === 510 && (await get(`${T}/rentLedger/e1`)).status === 'paid', { b: [ch1.body, ch2.body], p: await payments(), till: (await get(`${T}/tillSessions/till1`)).expectedCash });
  r = await keepChange();
  check('asked again: done already, nothing more', r.body.ok && r.body.already && (await payments()) === 1 && (await get(`${T}/tillSessions/till1`)).expectedCash === 510, r.body);
  await db.doc(`${T}/receipts/r3`).set({ id: 'r3', amountTendered: 100, total: 90 });
  const toTuition = () => change(req({ tenantId: 't1', receiptId: 'r3', cents: 1000, kind: 'tuition', planId: 'pl1' })) as any;
  const [t1, t2] = await Promise.all([toTuition(), toTuition()]);
  check('tuition, a double tap: one payment on the student’s ledger, one line in the books; the other is told it’s under way', tuitionApplied === 1 && [t1, t2].filter((x: any) => x.body.ok).length >= 1 && [t1, t2].every((x: any) => x.body.ok || x.status === 409) && (await keptLines()) === 2, { b: [t1.body, t2.body], tuitionApplied });
  await db.doc(`${T}/receipts/r4`).set({ id: 'r4', amountTendered: 100, total: 90, changeKeepClaimAt: new Date(Date.now() - 3 * 60000).toISOString(), changeKeepClaim: { kind: 'tuition', planId: 'pl1', cents: 1000 } });
  await db.collection(`${T}/tuitionEntries`).add({ planId: 'pl1', type: 'payment', amountCents: 1000, desc: 'Paid at the front desk — toward the next instalment (cash (change kept))', ref: 'r4' });
  const before = tuitionApplied;
  r = await change(req({ tenantId: 't1', receiptId: 'r4', cents: 1000, kind: 'tuition', planId: 'pl1' }));
  check('a try that put it on the ledger but never finished: taken over, recorded once, not added to the ledger again', r.body.ok && tuitionApplied === before && (await get(`${T}/receipts/r4`)).changeKept?.cents === 1000 && !(await get(`${T}/receipts/r4`)).changeKeepClaimAt, { b: r.body, tuitionApplied });

  await db.doc(`${T}/renters/rn2`).set({ firstName: 'Ira', lastName: 'Invoiced' });
  await db.doc(`${T}/rentInvoices/I1`).set({ renterId: 'rn2', amountCents: 1500, lateFeeCents: 0, paidCents: 0, status: 'due', dueDate: '2026-10-01' });
  for (const rid of ['r5', 'r6']) await db.doc(`${T}/receipts/${rid}`).set({ id: rid, amountTendered: 100, total: 90, tillId: 'till1' });
  const tillBefore = (await get(`${T}/tillSessions/till1`)).expectedCash;
  const [s5, s6] = await Promise.all(['r5', 'r6'].map((rid) => change(req({ tenantId: 't1', receiptId: rid, cents: 1000, kind: 'rent', renterId: 'rn2' })))) as any[];
  const I1: any = await get(`${T}/rentInvoices/I1`); const led2 = (await all(`${T}/rentLedger`)).filter((x: any) => x.renterId === 'rn2');
  const prepaid = led2.filter((x: any) => x.type === 'prepaid_credit').reduce((s: number, x: any) => s - (Number(x.amountCents) || 0), 0);
  check('two sales’ change toward one renter at the same moment: the $15 invoice is paid in full, and the other $5 comes off the next rent', s5.body.ok && s6.body.ok && I1.paidCents === 1500 && I1.status === 'paid' && prepaid === 500 && led2.filter((x: any) => x.type === 'payment').length === 2 && (await get(`${T}/tillSessions/till1`)).expectedCash === tillBefore + 20, { I1, prepaid, b: [s5.body, s6.body] });

  console.log('23. writing off a balance');
  const { POST: writeOff } = await import('../../src/app/api/credits/write-off/route');
  await fresh();
  await db.doc(`${T}/clients/c2`).set({ name: 'Bo Owes', outstandingBalance: 50, unpaidFees: [{ feeId: 'f9', feeAmount: 50 }] });
  await db.doc(`${T}/clients/c3`).set({ name: 'Cy Owes', outstandingBalance: 50, unpaidFees: [{ feeId: 'f8', feeAmount: 50 }] });
  const wo = (x: any = {}) => writeOff(req({ tenantId: 't1', clientId: 'c2', amount: 50, reason: 'Moved away', staffId: 'm1', ...x })) as any;
  const badDebt = async (cid: string) => (await all(`${T}/transactions`)).filter((x: any) => x.category === 'Bad Debt' && x.clientId === cid);
  const [o1, o2] = await Promise.all([wo(), wo()]);
  let c2: any = await get(`${T}/clients/c2`);
  check('a double tap on a $50 write-off: the balance goes to $0 (never below), one Bad Debt line', c2.outstandingBalance === 0 && c2.badDebtWrittenOff === 50 && (await badDebt('c2')).length === 1 && [o1, o2].filter((x: any) => x.body.ok && !x.body.already).length === 1, { b: [o1.body, o2.body], c2 });
  r = await wo();
  c2 = await get(`${T}/clients/c2`);
  check('asked again: nothing left to write off, nothing more', c2.outstandingBalance === 0 && (await badDebt('c2')).length === 1, r.body);
  const part = (x: any = {}) => writeOff(req({ tenantId: 't1', clientId: 'c3', amount: 20, reason: 'Goodwill', staffId: 'm1', attemptKey: 'wo_attempt_01', ...x })) as any;
  const [q1, q2] = await Promise.all([part(), part()]);
  r = await part();
  check('a part write-off with the screen’s key, tapped twice and asked again: $20 off once', (await get(`${T}/clients/c3`)).outstandingBalance === 30 && (await badDebt('c3')).length === 1 && r.body.already && q1.body.ok && q2.body.ok, { b: [q1.body, q2.body, r.body], c3: await get(`${T}/clients/c3`) });
  await db.doc(`${T}/clients/c4`).set({ name: 'Di Owes', outstandingBalance: 50, unpaidFees: [{ feeId: 'f7', feeAmount: 50 }] });
  const lost = () => writeOff(req({ tenantId: 't1', clientId: 'c4', amount: 20, reason: 'Goodwill', staffId: 'm1', attemptKey: 'wo_lost_0001' })) as any;
  await lost();   // its answer never reaches the screen
  r = await lost();
  check('a part write-off retried after its answer was lost (same key): written off once, the same answer back', r.body.ok && r.body.already && r.body.writtenOff === 20 && (await get(`${T}/clients/c4`)).outstandingBalance === 30 && (await badDebt('c4')).length === 1, r.body);
  who = 'staff';
  r = await wo({ clientId: 'c3' });
  check('a staff member who isn’t a manager: refused', r.status === 403 && (await get(`${T}/clients/c3`)).outstandingBalance === 30, r.body);

  // ── 24. Referral credit, while a checkout spends credit ────────────────────────────────────────────────────
  console.log('24. referral credit while a checkout spends credit');
  const RS = await import('../../src/lib/referrals-server'); const SC = await import('../../src/lib/store-credit');
  const NOW = Date.parse('2026-10-20T15:00:00-04:00'); const DAY = 864e5; const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
  const HANNAH = `${T}/clients/hannah`;
  // Watches the client's record: counts the reads the code makes of it (a read inside a step counts once), notes the
  // read its first credits write was based on, and can run something else right after a given read — as if a checkout
  // spent the credit at that moment. Each read keeps what the record held when it was read (the in-memory database
  // otherwise hands back whatever is there when the data is looked at).
  const watch = (d: any) => {
    const w = { reads: 0, basedOn: -1, at: -1, meanwhile: null as null | (() => Promise<any>) }; let inTxGet = 0;
    const after = async () => { w.reads++; if (w.meanwhile && w.reads === w.at) { const f = w.meanwhile; w.meanwhile = null; await f(); } };
    const realDoc = d.doc;
    d.doc = (p: string) => { const ref = realDoc(p); if (p !== HANNAH) return ref; const g = ref.get, s = ref.set, up = ref.update;
      ref.get = async () => { const snap = await g(); const held = snap.data(); const asRead = { ...snap, data: () => (held === undefined ? undefined : JSON.parse(JSON.stringify(held))) };
        if (!inTxGet) await after(); return asRead; };
      ref.set = async (v: any, o?: any) => { if (w.basedOn < 0 && v && 'storeCredits' in v) w.basedOn = w.reads; return s(v, o); };
      ref.update = async (v: any) => { if (w.basedOn < 0 && v && 'storeCredits' in v) w.basedOn = w.reads; return up(v); };
      return ref; };
    const realRun = d.runTransaction;
    d.runTransaction = (fn: any) => realRun((tx: any) => fn({ ...tx, get: async (ref: any) => { inTxGet++; let snap; try { snap = await tx.get(ref); } finally { inTxGet--; } if (ref?.path === HANNAH) await after(); return snap; } }));
    return w;
  };
  // Runs the sweep once to find the read its credits write is based on, then again on a fresh copy with the checkout
  // spending $20 of credit right after that read.
  const race = async (setup: (d: any) => Promise<void>) => {
    const mk = async () => { const d = strictTransactions(makeDb()); await d.doc(T).set({ name: 'Opal', timezone: 'America/New_York', referrals: { on: true } }); await d.doc(`tenants/t1/clients/maria`).set({ id: 'maria', name: 'Maria Lopez' }); await setup(d); return d; };
    const d1 = await mk(); const w1 = watch(d1); await RS.referralSweep(d1, 't1', (await d1.doc(T).get()).data(), NOW);
    const d2 = await mk(); const w2 = watch(d2); w2.at = w1.basedOn;
    w2.meanwhile = () => SC.useCredit(d2, 't1', 'hannah', 20, { checkoutSessionId: 'cs5', by: 'Front desk' }, NOW);
    await RS.referralSweep(d2, 't1', (await d2.doc(T).get()).data(), NOW);
    return { d: d2, fired: w2.meanwhile === null && w1.basedOn > 0 };
  };
  const issueSetup = async (d: any) => {
    await d.doc(HANNAH).set({ id: 'hannah', name: 'Hannah Kim', storeCredits: [{ id: 'old1', amount: 20, amountCents: 2000, status: 'available', createdAt: ago(30), expiresAt: null, usedAt: null }], totalStoreCredit: 20 });
    await d.doc(`${T}/referrals/rf1`).set({ id: 'rf1', referrerId: 'hannah', referrerName: 'Hannah Kim', friendClientId: 'maria', friendFirst: 'Maria', via: 'link', status: 'booked', createdAt: ago(10), bookedAt: ago(10) });
    await d.doc(`${T}/appointments/v1`).set({ id: 'v1', clientId: 'maria', status: 'completed', startTime: ago(3), checkedOutAt: ago(3) });
  };
  let x = await race(issueSetup);
  let h: any = (await x.d.doc(HANNAH).get()).data();
  const old1 = (h.storeCredits || []).find((c: any) => c.id === 'old1'); const refC = (h.storeCredits || []).filter((c: any) => c.id === 'ref_rf1');
  check('the reward is added while a checkout spends her other credit: the spent credit stays spent, the reward is there once', x.fired && old1?.status === 'used' && refC.length === 1 && refC[0].status === 'available' && h.totalStoreCredit === 15, { fired: x.fired, credits: h.storeCredits, total: h.totalStoreCredit });
  await RS.referralSweep(x.d, 't1', (await x.d.doc(T).get()).data(), NOW + 3600e3);
  h = (await x.d.doc(HANNAH).get()).data();
  check('…and the sweep running again adds nothing', (h.storeCredits || []).filter((c: any) => c.id === 'ref_rf1').length === 1 && h.totalStoreCredit === 15, h);
  const voidSetup = async (d: any) => {
    await d.doc(HANNAH).set({ id: 'hannah', name: 'Hannah Kim', totalStoreCredit: 35, storeCredits: [
      { id: 'old1', amount: 20, amountCents: 2000, status: 'available', createdAt: ago(30), expiresAt: new Date(NOW + 10 * DAY).toISOString(), usedAt: null },
      { id: 'ref_rf1', amount: 15, amountCents: 1500, status: 'available', source: 'referral_reward', createdAt: ago(5), expiresAt: new Date(NOW + 150 * DAY).toISOString(), usedAt: null, referralId: 'rf1' }] });
    await d.doc(`${T}/referrals/rf1`).set({ id: 'rf1', referrerId: 'hannah', referrerName: 'Hannah Kim', friendClientId: 'maria', friendFirst: 'Maria', status: 'rewarded', rewardedAt: ago(5), rewardCents: 1500, creditId: 'ref_rf1', visitId: 'v1', createdAt: ago(10) });
    await d.doc(`${T}/transactions/rv1`).set({ id: 'rv1', appointmentId: 'v1', type: 'reversal', category: 'Refunds', amount: 55 });
  };
  x = await race(voidSetup);
  h = (await x.d.doc(HANNAH).get()).data();
  const o1c = (h.storeCredits || []).find((c: any) => c.id === 'old1'); const rc = (h.storeCredits || []).find((c: any) => c.id === 'ref_rf1');
  check('the reward is taken back (the friend’s visit was refunded) while a checkout spends her other credit: that stays spent', x.fired && o1c?.status === 'used' && rc?.status === 'voided' && h.totalStoreCredit === 0, { fired: x.fired, credits: h.storeCredits, total: h.totalStoreCredit });

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
