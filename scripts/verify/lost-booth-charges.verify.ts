// Checks that a booth charge whose answer from Stripe was lost, and that nobody asks for again, still ends recorded or
// let go, by the five-minute check: the concierge kiosk's station charge (settleLostKioskCharges, lib/kiosk-charges), a
// lease renter's incidental (settleLostRenterIncidentals, lib/renter-incidentals), and a station booked and charged in
// one step (settleLostStationBookings, lib/station-booking). For each:
//   - the money went through: recorded once, even with two runs of the check at the same moment, as the charge itself
//     records it; asked for again afterwards, it's "already done", never a second charge;
//   - Stripe said no: let go as a decline is, nothing recorded (a booking's time is free again, and the team is told);
//   - nothing reached Stripe: let go, nothing recorded, nothing owed;
//   - still going through: left for the next run, and recorded once the money arrives;
//   - a claim less than 15 minutes old: left alone;
//   - the check and the person asking again at the same moment: charged once at most, recorded once.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/lost-booth-charges.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.ORDER_PASS_SECRET = 'test-station-secret';
process.env.CRON_SECRET = 'sec';
let db: any = strictTransactions(makeDb());

// ── Stripe: one payment per key and account (a decline too, as Stripe keeps it), listed by customer and account. The
// answer can go missing after the payment is made, or before the request reaches Stripe; a payment can be declined,
// still going through, or waiting for the renter's approval, and one waiting can be canceled. ──
type Status = 'succeeded' | 'requires_payment_method' | 'processing' | 'requires_action';
let answer: 'ok' | 'lost' | 'lost_before' = 'ok'; let outcome: Status = 'succeeded';
let pis: any[] = []; const keys = new Map<string, any>(); let creates = 0; let cancels = 0; const listed: (string | null)[] = [];
let audits: any[] = [];
// Something that happens while the check is asking Stripe (the screen asking again at that moment).
let whileListing: null | (() => Promise<void>) = null;
const lostError = () => Object.assign(new Error('connection reset'), { type: 'StripeConnectionError' });
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const acctOf = (o: any) => o?.stripeAccount || null;
function StripeMock(this: any) {
  return {
    paymentIntents: {
      create: async (p: any, o: any = {}) => {
        creates++;
        if (answer === 'lost_before') { answer = 'ok'; throw lostError(); }
        const k = `${acctOf(o) || ''}:${o.idempotencyKey}`;
        let pi = keys.get(k);
        if (!pi) {
          const n = pis.length + 1;
          pi = { id: `pi_${n}`, status: outcome, amount: p.amount, customer: p.customer, payment_method: outcome === 'requires_payment_method' ? null : p.payment_method,
            metadata: p.metadata || {}, created: Math.floor(Date.now() / 1000), account: acctOf(o), client_secret: `pi_${n}_secret`,
            latest_charge: outcome === 'succeeded' ? { id: `ch_${n}`, balance_transaction: { fee: 47 } } : null,
            last_payment_error: outcome === 'requires_payment_method' ? { message: 'Your card was declined.' } : null };
          pis.push(pi); keys.set(k, pi);
        }
        if (answer === 'lost') { answer = 'ok'; throw lostError(); }
        if (pi.status === 'requires_payment_method') throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined' });
        return clone(pi);
      },
      retrieve: async (id: string, _p?: any, o?: any) => {
        const pi = pis.find((x) => x.id === id && x.account === acctOf(o));
        if (!pi) throw Object.assign(new Error('No such payment_intent'), { type: 'StripeInvalidRequestError' });
        return clone(pi);
      },
      // A list names each payment's charge; it doesn't carry the charge's fee.
      list: async (q: any, o?: any) => {
        listed.push(acctOf(o));
        if (whileListing) { const f = whileListing; whileListing = null; await f(); }
        const data = pis.filter((x) => x.customer === q.customer && x.account === acctOf(o) && x.created >= (q.created?.gte ?? 0))
          .map((x) => ({ ...clone(x), latest_charge: x.latest_charge?.id || x.latest_charge || null }));
        return { has_more: false, data };
      },
      cancel: async (id: string, _p?: any, o?: any) => {
        cancels++;
        const pi = pis.find((x) => x.id === id && x.account === acctOf(o));
        if (!pi || !['requires_action', 'requires_confirmation', 'requires_payment_method'].includes(pi.status)) throw Object.assign(new Error('This payment can’t be canceled.'), { type: 'StripeInvalidRequestError' });
        pi.status = 'canceled';
        return clone(pi);
      },
    },
  };
}
// The money arrives for a payment that was still going through.
const arrives = (pi: any) => Object.assign(pi, { status: 'succeeded', latest_charge: { id: `ch_${pi.id}`, balance_transaction: { fee: 47 } } });

// ── Who's signed in (by the Authorization header the screen sends) ──
const ACTORS: Record<string, any> = {
  'Bearer manager': { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: ['checkout.take'] },
  'Bearer staff': { uid: 's1', name: 'Sam Lee', role: 'front_desk', caps: ['checkout.take'] },
};
const who = (req: any) => ACTORS[String(req?.headers?.get?.('authorization') || '')] || null;
const denied = (status: number) => ({ deny: { status, body: { ok: false, error: status === 401 ? 'Please sign in again.' : 'Only a manager can do that.' } } });
const routeGuard = {
  requireRole: async (req: any, _t: any, level = 'staff') => { const a = who(req); if (!a) return denied(401); if (level !== 'staff' && !a.isManager) return denied(403); return { actor: a }; },
  requireCan: async (req: any, _t: any, cap: string) => { const a = who(req); if (!a) return denied(401); if (!(a.caps || []).includes(cap)) return denied(403); return { actor: a }; },
  staffOrServer: async (req: any) => req?.headers?.get?.('x-cf-internal') === 'sec' || !!who(req),
};

const M: any = Module as any;
const load = M._load;
// A stand-in module, also for dynamic imports (marked as an ES module, with its default, and put in the cache).
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);
const stripeMod = Object.assign(StripeMock, { default: StripeMock, __esModule: true });
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) { const c = M._cache?.[request]; if (c) { c.exports = stripeMod; c.loaded = true; } return stripeMod; }
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (is(request, 'firebase-admin')) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === 'firebase/firestore') return { collection: () => ({}), doc: () => ({}), setDoc: async () => undefined };
  if (is(request, 'route-guard')) return fake(request, routeGuard);
  if (is(request, 'staff-auth')) return fake(request, { verifyStaffActor: async (req: any) => (who(req) ? { ok: true, actor: who(req) } : { ok: false }) });
  if (request === './audit' || is(request, 'audit')) return fake(request, { logAuditAdmin: async (_db: any, _t: any, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (is(request, 'notify')) return fake(request, { sendNotification: async () => ({ ok: true, status: 'sent' }) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const lines = async (prefix: string) => (await all(`${T}/transactions`)).filter((x: any) => String(x.id).startsWith(prefix));
const notes = () => all(`${T}/notifications`);
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[String(k).toLowerCase()] ?? null },
  nextUrl: { origin: 'https://studio.test', searchParams: new URLSearchParams() }, url: 'https://studio.test/api/x' }) as any;
const inMin = (min: number) => Date.now() + min * 60000;
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const fresh = async () => {
  db = strictTransactions(makeDb()); pis = []; keys.clear(); creates = 0; cancels = 0; listed.length = 0; answer = 'ok'; outcome = 'succeeded'; audits = []; whileListing = null;
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1', incidentalCategories: [{ label: 'Cleaning', capCents: 5000 }] });
  // The concierge station: Chair 2, rented by Nia Park, whose card its orders go on.
  await db.doc(`${T}/booths/b1`).set({ name: 'Chair 2' });
  await db.doc(`${T}/leases/l1`).set({ boothId: 'b1', renterId: 'rt1', status: 'active' });
  await db.doc(`${T}/renters/rt1`).set({ firstName: 'Nia', lastName: 'Park', amenitiesEnabled: true, amenityPayer: 'renter', cardOnFile: true, stripeCustomerId: 'cus_r', stripePaymentMethodId: 'pm_r' });
  await db.doc(`${T}/inventory/latte`).set({ name: 'Latte', type: 'refreshment', price: 6, totalStock: 10 });
  // A day-use station, and two renters with a card on file who book it.
  await db.doc(`${T}/booths/b2`).set({ name: 'Room 3', dayUseEnabled: true, dayUseHourlyCents: 2000, dayUseDailyCents: 12000 });
  await db.doc(`${T}/renters/rn1`).set({ firstName: 'Lena', lastName: 'Cho', stripeCustomerId: 'cus_b', defaultPaymentMethodId: 'pm_b' });
  await db.doc(`${T}/renters/rn2`).set({ firstName: 'Ola', lastName: 'Diaz', stripeCustomerId: 'cus_c', defaultPaymentMethodId: 'pm_c' });
};

(async () => {
  const kiosk = (await import('../../src/app/api/booths/kiosk/route')).POST;
  const setupCard = (await import('../../src/app/api/booths/setup-card/route')).PUT;
  const bookStation = (await import('../../src/app/api/stripe/book-station/route')).POST;
  const { settleLostKioskCharges } = await import('../../src/lib/kiosk-charges');
  const { settleLostRenterIncidentals } = await import('../../src/lib/renter-incidentals');
  const { settleLostStationBookings } = await import('../../src/lib/station-booking');
  let r: any; let s: any; let two: any[];

  // ── 1. The concierge kiosk's station charge ─────────────────────────────────
  console.log('a concierge order charged to the station');
  const K = (body: any, h: Record<string, string> = {}) => kiosk(req({ tenantId: 't1', ...body }, h)) as any;
  const linkFor = async () => (await K({ action: 'station-link', boothId: 'b1' }, { authorization: 'Bearer manager' })).body.token;
  const order = (token: string, orderKey = 'o1') => K({ action: 'charge', payer: 'station', boothId: 'b1', itemId: 'latte', quantity: 1, amountCents: 600, orderKey, stationToken: token });
  const claims = () => all(`${T}/private/kiosk/stationCharges`);
  const settleK = (min = 20) => settleLostKioskCharges(db, 't1', { name: 'Opal' }, { now: inMin(min) });
  const lostOrder = async (how: { answer?: 'lost' | 'lost_before'; outcome?: Status } = {}) => {
    await fresh(); const token = await linkFor();
    answer = how.answer || 'lost'; outcome = how.outcome || 'succeeded';
    const res = await order(token); outcome = 'succeeded';
    return { token, res, c: (await claims())[0] };
  };

  let { token, res, c } = await lostOrder();
  check('(the answer lost: the screen says to try again, and the order stays claimed)', res.status === 502 && c?.status === 'charging' && pis.length === 1, res.body);
  two = await Promise.all([settleK(), settleK()]);
  c = (await claims())[0];
  check('the money went through, two runs of the check at once: recorded once — one line, its fee, the order marked charged',
    (await lines('concierge_')).length === 1 && (await lines('conciergefee_')).length === 1 && c.status === 'charged' && c.paymentIntentId === 'pi_1' && !c.claimAt && !c.settlingAt
    && two[0].recorded + two[1].recorded === 1 && two[0].checked + two[1].checked === 1, { two, c });
  const line = (await lines('concierge_'))[0]; const fee = (await lines('conciergefee_'))[0];
  check('…as the kiosk records it: named after the order, with the renter, the payment, its charge and its fee',
    line?.id === `concierge_${c.id}` && line.amount === 6 && line.category === 'Hospitality Revenue' && line.clientOrVendor === 'Nia Park' && line.renterId === 'rt1'
    && line.stripePaymentIntentId === 'pi_1' && line.stripeChargeId === 'ch_1' && line.conciergeOrderId === c.id && /Chair 2 \(Nia Park\)/.test(line.description)
    && fee?.amount === 0.47 && fee.relatedTxnId === line.id, { line, fee });
  let ns = await notes();
  check('…and the front desk is told once, since the order itself was never sent', ns.length === 1 && ns[0].id === `concierge_${c.id}`
    && /\$6\.00 concierge charge for Latte \(x1\) to Chair 2 \(Nia Park\) went through/.test(ns[0].message), ns);
  check('…Stripe asked on the platform’s own account, where the kiosk charges', listed.length >= 1 && listed.every((a) => a === null), listed);
  r = await order(token);
  check('…the order asked for again afterwards: already done, never a second charge', r.body.ok && r.body.already && r.body.orderId === c.id && r.body.chargedCents === 600 && creates === 1 && pis.length === 1, { body: r.body, creates });
  s = await settleK(40);
  check('…the check run again later: nothing more', s.checked === 0 && (await lines('concierge_')).length === 1 && (await notes()).length === 1, s);

  ({ res, c } = await lostOrder({ outcome: 'requires_payment_method' }));
  check('(Stripe said no, but its answer was lost)', res.status === 502 && c.status === 'charging' && pis[0].status === 'requires_payment_method', res.body);
  s = await settleK();
  c = (await claims())[0];
  check('Stripe said no: let go as a decline is — nothing recorded, the order free to try again', s.released === 1 && c.status === 'failed' && !c.claimAt && !c.settlingAt
    && /declined/.test(c.error) && (await lines('concierge')).length === 0 && (await notes()).length === 0, { s, c });

  ({ token, c } = await lostOrder({ answer: 'lost_before' }));
  two = await Promise.all([settleK(), settleK()]);
  c = (await claims())[0];
  check('nothing reached Stripe, two runs at once: let go once, nothing recorded', two[0].released + two[1].released === 1 && c.status === 'failed' && /never reached Stripe/.test(c.error)
    && pis.length === 0 && (await lines('concierge')).length === 0, { two, c });
  r = await order(token);
  check('…the order asked for again afterwards: charged then, once, as a new try', r.body.ok && !r.body.already && pis.length === 1 && (await lines('concierge_')).length === 1, r.body);

  ({ c } = await lostOrder({ answer: 'lost_before' }));
  pis.push({ id: 'pi_other', status: 'succeeded', amount: 1200, customer: 'cus_r', account: null, metadata: { tenantId: 't1', orderId: c.id }, created: Math.floor(Date.now() / 1000), latest_charge: 'ch_other' });
  pis.push({ id: 'pi_next', status: 'succeeded', amount: 600, customer: 'cus_r', account: null, metadata: { tenantId: 't1', orderId: 'sc_000000000000000000000000' }, created: Math.floor(Date.now() / 1000), latest_charge: 'ch_next' });
  s = await settleK();
  check('payments on the same card for another amount, or for another order, aren’t taken for this charge: still let go, nothing recorded', s.released === 1 && (await claims())[0].status === 'failed' && (await lines('concierge')).length === 0, s);

  ({ c } = await lostOrder({ outcome: 'processing' }));
  s = await settleK();
  c = (await claims())[0];
  check('still going through: left for the next run, nothing recorded', s.waiting === 1 && c.status === 'charging' && !c.settlingAt && (await lines('concierge')).length === 0, { s, c });
  arrives(pis[0]);
  s = await settleK(26);
  check('…once the money arrives: recorded, once', s.recorded === 1 && (await claims())[0].status === 'charged' && (await lines('concierge_')).length === 1, s);

  await lostOrder();
  s = await settleK(5);
  c = (await claims())[0];
  check('a claim less than 15 minutes old: left alone', s.checked === 0 && c.status === 'charging' && !c.settlingAt && (await lines('concierge')).length === 0, { s, c });

  ({ c } = await lostOrder());
  await db.doc(`${T}/private/kiosk/stationCharges/${c.id}`).set({ settlingAt: new Date(inMin(19)).toISOString() }, { merge: true });
  s = await settleK();
  let s2: any = await settleK(26);
  check('a claim another run of the check is settling right now: left to it; one whose run stopped partway: taken over and settled', s.checked === 0 && s2.recorded === 1
    && (await claims())[0].status === 'charged' && (await lines('concierge_')).length === 1, { s, s2 });

  ({ c } = await lostOrder({ answer: 'lost_before' }));
  whileListing = async () => { await db.doc(`${T}/private/kiosk/stationCharges/${c.id}`).set({ claimAt: new Date().toISOString() }, { merge: true }); };
  s = await settleK();
  check('the order asked for again while the check was asking Stripe: not let go under it (that request finishes it)', s.waiting === 1 && (await claims())[0].status === 'charging' && !(await claims())[0].settlingAt, { s, c: (await claims())[0] });

  let steady = true;
  for (let i = 0; i < 6; i++) {
    ({ token, c } = await lostOrder({ answer: 'lost_before' }));
    await db.doc(`${T}/private/kiosk/stationCharges/${c.id}`).set({ claimAt: ago(20) }, { merge: true });
    const [run, ask]: any[] = await Promise.all([settleLostKioskCharges(db, 't1', {}, {}), order(token)]);
    const fine = pis.length === 1 && (await lines('concierge_')).length === 1 && (await claims())[0].status === 'charged' && ask.body.ok;
    if (!fine) { steady = false; console.log('   ', { run, ask: ask.body, pis: pis.length, claim: (await claims())[0] }); }
  }
  check('the check and the order asked for again at the same moment: one charge at Stripe, recorded once', steady);

  // ── 2. A lease renter's incidental ──────────────────────────────────────────
  console.log('a renter’s incidental charge');
  const inc = (key = 'try1') => setupCard(req({ tenantId: 't1', renterId: 'rt1', category: 'Cleaning', amountCents: 2000, key }, { authorization: 'Bearer staff' })) as any;
  const settleI = (min = 20) => settleLostRenterIncidentals(db, 't1', { name: 'Opal' }, { now: inMin(min) });
  const attempt = (key = 'try1') => get(`${T}/renters/rt1/charges/inc_${key}`);
  const renter = () => get(`${T}/renters/rt1`);
  const lostInc = async (how: { answer?: 'lost' | 'lost_before'; outcome?: Status } = {}) => {
    await fresh(); answer = how.answer || 'lost'; outcome = how.outcome || 'succeeded';
    const out = await inc(); outcome = 'succeeded'; return out;
  };

  r = await lostInc();
  let rt: any = await renter();
  check('(the answer lost: it says to try again, and the renter is marked as having an attempt open)', r.status === 502 && (await attempt()).status === 'charging' && !!rt.incidentalOpenAt && !!rt.incidentalOpen?.try1, { body: r.body, rt });
  two = await Promise.all([settleI(), settleI()]);
  rt = await renter(); let a: any = await attempt();
  check('the money went through, two runs of the check at once: recorded once — one line, its fee, on the renter’s log once',
    two[0].recorded + two[1].recorded === 1 && (await lines('renterinc_')).length === 1 && (await lines('renterincfee_')).length === 1
    && rt.incidentals?.length === 1 && rt.incidentalsTotalCents === 2000 && a.status === 'charged' && a.paymentIntentId === 'pi_1' && !a.settlingAt, { two, rt, a });
  const il = (await lines('renterinc_'))[0];
  check('…as the charge records it: named after the renter and the attempt', il.id === 'renterinc_rt1_try1' && il.amount === 20 && il.category === 'Renter Incidental' && il.clientOrVendor === 'Nia Park'
    && il.stripePaymentIntentId === 'pi_1' && (await lines('renterincfee_'))[0].amount === 0.47, il);
  ns = await notes();
  check('…the renter no longer marked, the team told once, and it’s in the audit log', !('incidentalOpenAt' in rt) && !('incidentalOpen' in rt) && ns.length === 1
    && /\$20\.00 incidental charge to Nia Park’s card on file .* went through/.test(ns[0].message) && audits.filter((x) => x.action === 'booth.renter_charged').length === 1, { rt, ns, audits });
  r = await inc();
  check('…asked again afterwards: already done, never a second charge', r.body.ok && r.body.already && creates === 1 && pis.length === 1 && (await renter()).incidentalsTotalCents === 2000, r.body);

  await lostInc({ outcome: 'requires_payment_method' });
  s = await settleI(); rt = await renter(); a = await attempt(); ns = await notes();
  check('Stripe said no: closed as a decline is, nothing recorded, the renter no longer marked, and the team told nothing was charged',
    s.released === 1 && a.status === 'failed' && !a.claimAt && (await lines('renterinc')).length === 0 && !rt.incidentals && !rt.incidentalOpenAt
    && ns.length === 1 && /didn’t go through \(the card was declined\), so nothing was charged/.test(ns[0].message), { s, a, rt, ns });

  await lostInc({ answer: 'lost_before' });
  two = await Promise.all([settleI(), settleI()]);
  rt = await renter(); a = await attempt();
  check('nothing reached Stripe, two runs at once: closed once, nothing recorded, the renter owes nothing', two[0].released + two[1].released === 1 && a.status === 'failed' && pis.length === 0
    && (await lines('renterinc')).length === 0 && !rt.incidentalsTotalCents && !rt.incidentalOpenAt && (await notes()).length === 1, { two, a, rt });

  await lostInc({ outcome: 'processing' });
  s = await settleI(); rt = await renter();
  check('still going through: left for the next run, the renter still marked', s.waiting === 1 && (await attempt()).status === 'charging' && !!rt.incidentalOpenAt && (await lines('renterinc')).length === 0, { s, rt });
  arrives(pis[0]);
  s = await settleI(26);
  check('…once the money arrives: recorded, once', s.recorded === 1 && (await lines('renterinc_')).length === 1 && (await renter()).incidentalsTotalCents === 2000 && !(await renter()).incidentalOpenAt, s);

  await lostInc();
  s = await settleI(5);
  check('an attempt less than 15 minutes old: left alone', s.checked === 0 && (await attempt()).status === 'charging' && !!(await renter()).incidentalOpenAt, s);

  await lostInc();
  await db.doc(`${T}/renters/rt1/charges/inc_try1`).set({ claimAt: ago(20) }, { merge: true });
  await db.doc(`${T}/renters/rt1`).set({ incidentalOpen: { try1: ago(20) }, incidentalOpenAt: ago(20) }, { merge: true });
  answer = 'lost'; await inc('try2');
  s = await settleLostRenterIncidentals(db, 't1', {}, {});
  rt = await renter();
  check('two attempts open, one from long ago and one from just now: the old one recorded, the renter still marked for the new one',
    s.recorded === 1 && (await attempt()).status === 'charged' && (await attempt('try2')).status === 'charging'
    && Object.keys(rt.incidentalOpen || {}).join() === 'try2' && rt.incidentalOpenAt === rt.incidentalOpen.try2, { s, rt });

  await lostInc();
  await db.doc(`${T}/renters/rt1/charges/inc_try1`).set({ settlingAt: new Date(inMin(19)).toISOString() }, { merge: true });
  s = await settleI();
  s2 = await settleI(26);
  check('an attempt another run of the check is settling right now: left to it; one whose run stopped partway: taken over and settled', s.checked === 0 && s2.recorded === 1
    && (await attempt()).status === 'charged' && (await lines('renterinc_')).length === 1, { s, s2 });

  await lostInc({ answer: 'lost_before' });
  whileListing = async () => { await db.doc(`${T}/renters/rt1/charges/inc_try1`).set({ claimAt: new Date().toISOString() }, { merge: true }); };
  s = await settleI();
  check('the charge asked for again while the check was asking Stripe: not closed under it, the renter still marked', s.waiting === 1 && (await attempt()).status === 'charging'
    && !!(await renter()).incidentalOpen?.try1, { s, a: await attempt() });

  await fresh();
  const paidNow = await inc('ok1');
  outcome = 'requires_payment_method';
  const saidNo = await inc('no1');
  outcome = 'succeeded';
  check('charged or declined with the answer in hand: the renter’s mark comes off in the same step (nothing left for the check)', paidNow.body.ok && saidNo.status === 402
    && (await attempt('no1')).status === 'failed' && !(await renter()).incidentalOpenAt && !(await renter()).incidentalOpen && (await settleI()).checked === 0, { paidNow: paidNow.body, saidNo: saidNo.body, rt: await renter() });

  await fresh();
  await db.doc(`${T}/renters/rt1/charges/inc_old1`).set({ id: 'inc_old1', status: 'charging', claimAt: ago(30), amountCents: 2000, description: 'Cleaning', category: 'Cleaning', pm: 'pm_r', customer: 'cus_r' });
  pis.push({ id: 'pi_old', status: 'succeeded', amount: 2000, customer: 'cus_r', account: null, metadata: { tenantId: 't1', renterId: 'rt1', kind: 'renter_incidental', category: 'Cleaning', attempt: 'old1' },
    created: Math.floor(Date.now() / 1000) - 1800, latest_charge: { id: 'ch_old', balance_transaction: { fee: 88 } } });
  s = await settleLostRenterIncidentals(db, 't1', {}, {});
  check('an attempt claimed before renters carried the mark: found, and recorded once', s.recorded === 1 && (await attempt('old1')).status === 'charged' && (await lines('renterinc_')).length === 1
    && !!(await get(`${T}/private/renterIncidentals`))?.markedAt && !(await renter()).incidentalOpenAt, s);

  // ── 3. A station booked and charged in one step ─────────────────────────────
  console.log('a station booked and charged in one step');
  const book = (x: any = {}) => bookStation(req({ tenantId: 't1', locationId: 'loc1', boothId: 'b2', renterId: 'rn1', startAt: '2026-10-24T09:00:00', endAt: '2026-10-24T11:00:00',
    rateType: 'hourly', mode: 'pos', attemptKey: 'try1', ...x }, { authorization: 'Bearer staff' })) as any;
  const settleB = (min = 20) => settleLostStationBookings(db, 't1', { name: 'Opal', stripeAccountId: 'acct_1' }, { now: inMin(min) });
  const booking = (id = 'sb_try1') => get(`${T}/bookings/${id}`);
  const held = async () => Object.keys((await get(`${T}/stationSlots/b2_2026-10-24`))?.holds || {}).sort().join();
  const ledgerRows = async () => (await all(`${T}/rentLedger`)).length;
  const lostBooking = async (how: { answer?: 'lost' | 'lost_before'; outcome?: Status } = {}) => {
    await fresh(); answer = how.answer || 'lost'; outcome = how.outcome || 'succeeded';
    const out = await book(); outcome = 'succeeded'; return out;
  };

  r = await lostBooking();
  check('(the answer lost: it says to try again, and the booking holds its time)', r.status === 502 && (await booking()).status === 'held' && (await held()) === 'sb_try1', r.body);
  two = await Promise.all([settleB(), settleB()]);
  let bk: any = await booking();
  check('the money went through, two runs of the check at once: recorded once — one line in the books, one in the rent roll, the booking confirmed',
    two[0].recorded + two[1].recorded === 1 && (await lines('station_booking_')).length === 1 && (await ledgerRows()) === 1 && bk.status === 'confirmed' && bk.paymentStatus === 'paid'
    && bk.stripePaymentIntentId === 'pi_1' && !bk.chargeClaimAt && !bk.settlingAt && (await held()) === 'sb_try1', { two, bk });
  const bl = (await lines('station_booking_'))[0];
  check('…as the booking records it: named after it, for its amount, the renter and the payment', bl.id === 'station_booking_sb_try1' && bl.amount === 40 && bl.category === 'Day-Use Booking Revenue'
    && bl.clientOrVendor === 'Lena Cho' && bl.bookingId === 'sb_try1' && bl.stripePaymentIntentId === 'pi_1' && bk.transactionId === bl.id, bl);
  check('…Stripe asked on the business’s own account, where the booking was charged', listed.length >= 1 && listed.every((x) => x === 'acct_1'), listed);
  ns = await notes();
  check('…and the team is told once', ns.length === 1 && ns[0].id === 'station_booking_sb_try1' && /The day-use booking for Lena Cho at Room 3 on 2026-10-24, 09:00–11:00 went through/.test(ns[0].message), ns);
  r = await book();
  check('…the same booking asked for again afterwards: already done, never a second charge', r.body.ok && r.body.already && creates === 1 && pis.length === 1, r.body);

  await lostBooking({ outcome: 'requires_payment_method' });
  s = await settleB(); bk = await booking(); ns = await notes();
  check('Stripe said no: the booking cancelled and its time free again, nothing recorded', s.released === 1 && bk.status === 'cancelled' && bk.cancellationReason === 'card_declined'
    && !bk.chargeClaimAt && (await held()) === '' && (await lines('station_booking_')).length === 0 && (await ledgerRows()) === 0, { s, bk });
  check('…the team told it didn’t go through, once', ns.length === 1 && /didn’t go through \(the card was declined\), so nothing was charged and the time is free again/.test(ns[0].message), ns);
  r = await book({ attemptKey: 'deskB', renterId: 'rn2' });
  check('…someone else can book that time now', r.body.ok && (await booking('sb_deskB')).status === 'confirmed', r.body);
  r = await book();
  check('…and the first booking asked for again is told it didn’t go through (no second try at the card)', !r.body.ok && r.status === 402 && r.body.code === 'card_declined'
    && pis.filter((x) => x.customer === 'cus_b').length === 1, r.body);

  await lostBooking({ answer: 'lost_before' });
  two = await Promise.all([settleB(), settleB()]);
  bk = await booking();
  check('nothing reached Stripe, two runs at once: cancelled once, its time free, nothing recorded, nothing owed', two[0].released + two[1].released === 1 && bk.status === 'cancelled'
    && bk.cancellationReason === 'not_charged' && (await held()) === '' && pis.length === 0 && (await lines('station_booking_')).length === 0 && (await ledgerRows()) === 0 && (await notes()).length === 1, { two, bk });
  r = await book();
  check('…asked for again afterwards: told it didn’t go through, and nothing charged', !r.body.ok && r.body.code === 'not_charged' && /nothing was charged/.test(String(r.body.reason)) && creates === 1 && pis.length === 0, r.body);

  await lostBooking({ outcome: 'processing' });
  s = await settleB();
  check('still going through: left for the next run, the time still held', s.waiting === 1 && (await booking()).status === 'held' && !(await booking()).settlingAt && (await held()) === 'sb_try1'
    && (await lines('station_booking_')).length === 0, s);
  r = await book({ attemptKey: 'deskB', renterId: 'rn2' });
  check('…nobody else can take that time meanwhile', r.body.code === 'slot_conflict', r.body);
  arrives(pis[0]);
  s = await settleB(26);
  check('…once the money arrives: recorded and confirmed, once', s.recorded === 1 && (await booking()).status === 'confirmed' && (await lines('station_booking_')).length === 1 && (await ledgerRows()) === 1, s);

  await lostBooking();
  await db.doc(`${T}/bookings/abc123`).set({ status: 'held', boothId: 'b2', holdExpiresAt: ago(30), createdAt: ago(30), updatedAt: ago(30) });
  s = await settleB(5);
  check('a booking held less than 15 minutes: left alone (and a hold made some other way isn’t touched)', s.checked === 0 && (await booking()).status === 'held' && !(await booking()).settlingAt
    && (await booking('abc123')).status === 'held', s);

  await fresh(); outcome = 'requires_action';
  r = await book();
  check('(the renter’s bank asked for their approval: the booking waits on it)', r.body.requiresAction && (await booking()).status === 'held' && (await booking()).stripePaymentIntentId === 'pi_1', r.body);
  s = await settleB();
  bk = await booking();
  check('a booking left waiting on approval that never came: the payment canceled at Stripe, the booking ended and its time freed, nothing recorded',
    s.released === 1 && cancels === 1 && pis[0].status === 'canceled' && bk.status === 'cancelled' && bk.cancellationReason === 'not_approved' && (await held()) === ''
    && (await lines('station_booking_')).length === 0 && (await notes()).length === 1, { s, bk });

  await lostBooking();
  await db.doc(`${T}/bookings/sb_try1`).set({ settlingAt: new Date(inMin(19)).toISOString() }, { merge: true });
  s = await settleB();
  s2 = await settleB(26);
  check('a booking another run of the check is settling right now: left to it; one whose run stopped partway: taken over and settled', s.checked === 0 && s2.recorded === 1
    && (await booking()).status === 'confirmed' && (await lines('station_booking_')).length === 1, { s, s2 });

  await lostBooking({ answer: 'lost_before' });
  whileListing = async () => { const at = new Date().toISOString(); await db.doc(`${T}/bookings/sb_try1`).set({ chargeClaimAt: at, updatedAt: at }, { merge: true }); };
  s = await settleB();
  check('the booking asked for again while the check was asking Stripe: not canceled under it, its time still held', s.waiting === 1 && (await booking()).status === 'held' && (await held()) === 'sb_try1'
    && (await notes()).length === 0, { s, bk: await booking() });

  steady = true; const ways = { confirmed: 0, cancelled: 0 };
  for (let i = 0; i < 8; i++) {
    await lostBooking({ answer: 'lost_before' });
    await db.doc(`${T}/bookings/sb_try1`).set({ chargeClaimAt: ago(20) }, { merge: true });
    // Half the time the check starts first, half the time the screen's request does.
    const run1 = () => settleLostStationBookings(db, 't1', { stripeAccountId: 'acct_1' }, {});
    const [run, ask]: any[] = i % 2 ? await Promise.all([run1(), book()]) : await Promise.all([new Promise((res) => setTimeout(res, 2)).then(run1), book()]);
    const b2 = await booking(); const paid = (await lines('station_booking_')).length; const freedNote = (await notes()).some((n: any) => /didn’t go through/.test(n.message));
    const fine = (b2.status === 'confirmed' && pis.length === 1 && paid === 1 && ask.body.ok && (await held()) === 'sb_try1' && !freedNote)
      || (b2.status === 'cancelled' && pis.length === 0 && paid === 0 && !ask.body.ok && (await held()) === '' && freedNote);
    if (b2.status === 'confirmed') ways.confirmed++; else if (b2.status === 'cancelled') ways.cancelled++;
    if (!fine) { steady = false; console.log('   ', { run, ask: ask.body, status: b2.status, pis: pis.length, paid, held: await held(), freedNote }); }
  }
  check('the check and the same booking asked for again at the same moment: charged once, confirmed and still holding its time, or canceled with nothing charged and its time free', steady, ways);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('lost-booth-charges ok');
})();
