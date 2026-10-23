// Checks a cancellation or a missed visit is settled once, however it arrives: a no-show confirmed twice (one after the
// other, or two people at the same moment), a client cancelling from their link twice at once, a call cut off part way
// (the five-minute job finishes it), and the booking's deposit (kept, once, and never counted as a sale a second time).
// api/notifications/handle-no-show-action, api/appointments/self-cancel, api/appointments/deposit-outcome,
// lib/cancellation-events, lib/deposit-outcome.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/cancellations.verify.ts
import Module from 'module';
import { makeDb, strictTransactions, FV, check, failures } from './fake-db';
import { booksSummary } from '../../src/lib/books-summary';

let db: any = strictTransactions(makeDb());
const pis = new Map<string, any>(); const piCalls: any[] = []; const feeCharges: any[] = [];
function StripeMock(this: any) {
  return { paymentIntents: { create: async (p: any, o: any) => { piCalls.push({ p, key: o?.idempotencyKey });
    const k = String(o?.idempotencyKey || Math.random()); if (pis.has(k)) return pis.get(k);
    const pi = { id: `pi_${pis.size + 1}`, amount: p.amount, status: 'succeeded', latest_charge: { id: `ch_${pis.size + 1}` } }; pis.set(k, pi); return pi; } } };
}
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let actor: any = { uid: 'u1', name: 'Kai Park', role: 'front_desk', caps: [] };
let chargeLost = 0;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }), staffOrServer: async () => true };
  if (request === '@/lib/audit' || request === './audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/opal/recovery-engine') return { spawnRecoveryTicket: async () => undefined };
  if (request === '@/lib/opal/behavior-ledger') return { appendBehaviorEvent: async () => undefined };
  // The client's own cancel charges the card through the payments route; the same appointment and amount is the same
  // charge (Stripe's key), as there.
  if (request === '@/lib/message-policy') { const real = load.call(this, request, ...rest); return { ...real, internalOrigin: () => 'https://studio.test',
    internalPost: async (_o: string, path: string, body: any) => { if (path === '/api/stripe/charge-card') { const key = `fee_${body.appointmentId}_${body.amountCents}`; feeCharges.push(key);
      // Stripe took it but its answer was lost: the charge route says so (the same key gives the same charge back later).
      if (chargeLost > 0) { chargeLost--; return { ok: false, status: 502, data: { ok: false, unknown: true, code: 'unconfirmed' } }; }
      return { ok: true, data: { ok: true, paymentIntentId: `pi_fee_${key}` } }; } return { ok: true, data: {} }; } }; }
  return load.call(this, request, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.RESEND_API_KEY = 're_test_x';
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'em_1' }), text: async () => '' });

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = (prefix: string) => [...db._store.entries()].filter(([p]: any) => p.startsWith(prefix)).map(([, d]: any) => d);
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://studio.test' } }) as any;
const soon = () => new Date(Date.now() + 2 * 3600e3).toISOString();
const fresh = async (o: { card?: boolean; deposit?: boolean } = {}) => {
  db = strictTransactions(makeDb()); pis.clear(); piCalls.length = 0; feeCharges.length = 0; chargeLost = 0;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', timezone: 'America/New_York', cancellationFee: 15 });
  await db.doc(`${T}/services/s1`).set({ name: 'Gel fill', price: 60 });
  await db.doc(`${T}/staff/st1`).set({ name: 'Rae Moss', role: 'owner' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com', outstandingBalance: 0, ...(o.card ? { cardOnFile: { customerId: 'cus_1', paymentMethodId: 'pm_1', last4: '4242' } } : {}) });
  await db.doc(`${T}/appointments/a1`).set({ id: 'a1', status: 'confirmed', clientId: 'c1', clientName: 'Maya Lopez', clientEmail: 'maya@example.com', serviceId: 's1', staffId: 'st1', startTime: soon(), endTime: soon(), checkInToken: 'tok1', ...(o.deposit ? { depositStatus: 'paid', depositAmountCents: 2500 } : {}) });
  if (o.deposit) {
    await db.doc(`${T}/depositCredits/deposit_pi_d`).set({ id: 'deposit_pi_d', kind: 'deposit', amountCents: 2500, status: 'available', sourceAppointmentId: 'a1', clientId: 'c1', clientEmail: 'maya@example.com', createdAt: '2026-10-01T00:00:00Z' });
    await db.doc(`${T}/transactions/deposit_in_cs_d`).set({ id: 'deposit_in_cs_d', type: 'income', category: 'Retainers', taxBucket: 'revenue', amount: 25, appointmentId: 'a1' });
  }
};

(async () => {
  const { POST: noShow } = await import('../../src/app/api/notifications/handle-no-show-action/route');
  const { POST: selfCancel } = await import('../../src/app/api/appointments/self-cancel/route');
  const { POST: depositOutcome } = await import('../../src/app/api/appointments/deposit-outcome/route');
  const { sweepPendingCancellations } = await import('../../src/lib/cancellation-events');
  const confirm = () => noShow(req({ tenantId: 't1', appointmentId: 'a1', action: 'confirm_no_show', staffId: 'st1' })) as any;

  console.log('a no-show, confirmed twice');
  await fresh({ card: true, deposit: true });
  await Promise.all([confirm(), confirm()]);
  await confirm();
  const events = all(`${T}/cancellationEvents/`);
  check('two people at once, then again: one cancellation, one fee charged', events.length === 1 && new Set(piCalls.map((c) => c.key)).size === 1 && pis.size === 1, { events: events.length, keys: piCalls.map((c) => c.key) });
  check('…the fee is in the books once', all(`${T}/transactions/`).filter((t: any) => t.category === 'Cancellation Fee').length === 1);
  const kept = all(`${T}/transactions/`).filter((t: any) => /^Deposit kept/.test(String(t.description || '')));
  check('…the $25 deposit is kept once, named for the team’s no-show share', kept.length === 1 && kept[0].category === 'No-Show Revenue' && kept[0].alreadyCounted === true && (await get(`${T}/depositCredits/deposit_pi_d`)).status === 'forfeited', kept);
  const sales = booksSummary(all(`${T}/transactions/`)).netSales;
  check('…and the books count the deposit as a sale once ($25), with the $60 fee', Math.abs(sales - 85) < 1e-9, sales);

  console.log('a no-show with no card');
  await fresh();
  await Promise.all([confirm(), confirm()]);
  check('the $60 fee goes on her balance once', (await get(`${T}/clients/c1`)).outstandingBalance === 60 && (await get(`${T}/clients/c1`)).unpaidFees.length === 1, await get(`${T}/clients/c1`));

  console.log('the client cancels late from her link, twice at once');
  await fresh({ card: true });
  const sc = () => selfCancel(req({ tenantId: 't1', appointmentId: 'a1', k: 'tok1', clientReason: 'schedule_conflict' })) as any;
  const two: any[] = await Promise.all([sc(), sc()]);
  check('one cancellation, the fee charged once, nothing owed besides', feeCharges.length === 1 && (await get(`${T}/clients/c1`)).outstandingBalance === 0 && all(`${T}/cancellationEvents/`).length === 1, { charges: feeCharges, results: two.map((x) => [x.status, x.body?.code || x.body?.alreadyCancelled || x.body?.ok]) });
  check('…the other is told it’s being saved (or that it’s already done)', two.some((x) => x.status === 409 || x.body?.alreadyCancelled), two.map((x) => x.status));
  await fresh();
  await Promise.all([sc(), sc()]);
  check('no card: the fee goes on her balance once', (await get(`${T}/clients/c1`)).outstandingBalance === 15 && (await get(`${T}/clients/c1`)).unpaidFees.length === 1, await get(`${T}/clients/c1`));

  console.log('the fee charge gets no answer');
  await fresh({ card: true }); chargeLost = 1;
  let lostR: any = await sc();
  check('nothing is saved, nothing is added to what she owes, and she’s asked to try again', lostR.status === 502 && lostR.body.code === 'fee_unconfirmed' && (await get(`${T}/appointments/a1`)).status === 'confirmed' && !((await get(`${T}/clients/c1`)).unpaidFees || []).length && !(await get(`${T}/appointments/a1`)).cancelClaim, lostR.body);
  lostR = await sc();
  check('…asked again: cancelled, with the same charge (one key), nothing owed', (await get(`${T}/appointments/a1`)).status === 'cancelled' && new Set(feeCharges).size === 1 && (await get(`${T}/clients/c1`)).outstandingBalance === 0, { body: lostR.body, feeCharges });

  console.log('a late cancel with a deposit');
  await fresh({ deposit: true });
  await sc();
  const dep = await get(`${T}/depositCredits/deposit_pi_d`);
  check('the deposit is settled once, as the plan says (kept against the fee)', dep.status === 'forfeited' && all(`${T}/transactions/`).filter((t: any) => /^Deposit kept/.test(String(t.description || ''))).length <= 1 && !!(await get(`${T}/appointments/a1`)).depositSettledAt, dep);
  check('…and never counted as a sale twice', Math.abs(booksSummary(all(`${T}/transactions/`)).netSales - 25 - (all(`${T}/transactions/`).filter((t: any) => t.category === 'Cancellation Fee' && t.status !== 'balance_owed').reduce((s: number, t: any) => s + t.amount, 0))) < 1e-9);

  console.log('a call cut off part way');
  await fresh({ card: true, deposit: true });
  await db.doc(`${T}/appointments/a1`).set({ status: 'cancelled', cancellationAudit: { actorType: 'no_show' } }, { merge: true });
  await db.doc(`${T}/cancellationEvents/ev1`).set({ id: 'ev1', tenantId: 't1', appointmentId: 'a1', clientId: 'c1', clientName: 'Maya Lopez', clientEmail: 'maya@example.com', chargeFee: true, feeAmount: 60, paymentMethod: 'card_on_file',
    stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', cancellationAudit: { actorType: 'no_show' }, reason: 'no-show', status: 'processing', claimedAt: new Date(Date.now() - 20 * 60000).toISOString(),
    chargeStatus: 'pending', emailStatus: 'pending', smsStatus: 'pending', depositPlan: { outcome: 'forfeit', reason: 'no_show', by: 'Front desk' }, createdAt: new Date(Date.now() - 20 * 60000).toISOString() });
  const stripe = new (StripeMock as any)();
  await sweepPendingCancellations(db, stripe, 't1');
  await sweepPendingCancellations(db, stripe, 't1');
  const ev = await get(`${T}/cancellationEvents/ev1`);
  check('left processing: the five-minute job finishes it, the fee charged once', ev.status === 'complete' && pis.size === 1 && all(`${T}/transactions/`).filter((t: any) => t.category === 'Cancellation Fee').length === 1, { status: ev.status, pis: pis.size });
  check('…and its deposit is settled from the event', (await get(`${T}/depositCredits/deposit_pi_d`)).status === 'forfeited' && !!ev.depositSettledAt);

  console.log('the desk settles a deposit on the server');
  await fresh({ deposit: true });
  let r: any = await depositOutcome(req({ tenantId: 't1', appointmentId: 'a1', outcome: 'forfeit' }));
  check('a booking still to come: refused, the deposit untouched', r.status === 409 && (await get(`${T}/depositCredits/deposit_pi_d`)).status === 'available', r.body);
  await db.doc(`${T}/appointments/a1`).set({ status: 'cancelled', cancellationAudit: { actorType: 'client' } }, { merge: true });
  r = await depositOutcome(req({ tenantId: 't1', appointmentId: 'a1', outcome: 'rollover' }));
  const r2: any = await depositOutcome(req({ tenantId: 't1', appointmentId: 'a1', outcome: 'forfeit' }));
  check('cancelled: rolled over to her next visit, and a second ask changes nothing', r.body.outcome === 'rollover' && r2.body.already === true && (await get(`${T}/depositCredits/deposit_pi_d`)).rolledOver === true && (await get(`${T}/depositCredits/deposit_pi_d`)).status === 'available', { r: r.body, r2: r2.body });

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('cancellations ok');
})().catch((e) => { console.error(e); process.exit(1); });
