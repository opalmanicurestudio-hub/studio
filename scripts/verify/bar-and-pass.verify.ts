// Checks the bar and the pass (round 29, design canvas "The bar and the pass"):
// - bar tabs with a card held (lib/bar-tab, lib/bar-tab-server, api/bar, the bar's tabs at /bar-tabs, and "Charge the
//   held card" at the desk): a tab under a name, off the host stand's floor; the hold amount sent to the bar's reader
//   once, never captured on its own; held with the card's brand and last four; turned down with the reader's words; let
//   go; charged at the desk for the check only (never more than what's held), as the sale's own card reader payment
//   named on its ticket, once; the sweep letting go a card on a tab paid another way and recording a lost charge
// - the kitchen calling people (lib/back-calls, lib/back-calls-server, api/back 'call'): a runner with a run of plates
//   from expo (its table and what's on it), a table's server, a manager; their phones buzz; the same call twice is one;
//   it shows on their My tables; sending the plates out closes the run
// - what the kitchen tells the floor (lib/floor-word, lib/floor-word-server, api/kitchen 'floorNote'): tonight's 86 list
//   and its message, on My tables and the host stand
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/bar-and-pass.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), readers: new Map<string, any>(), calls: [] as string[], n: 0, down: false, captureDown: false };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const err = (code: string, msg = code) => Object.assign(new Error(msg), { code, raw: { code } });
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (S.down) throw err('api_connection_error');
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, currency: p.currency, status: 'requires_payment_method', capture_method: p.capture_method, metadata: { ...p.metadata }, amount_received: 0, amount_capturable: 0, latest_charge: null, created: Math.floor(Date.now() / 1000) };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); S.calls.push(`create ${id} ${p.amount} ${p.metadata?.kind}`);
      return clone(pi);
    },
    retrieve: async (id: string) => { if (S.down) throw err('api_connection_error'); const pi = S.pis.get(id); if (!pi) throw Object.assign(err('resource_missing'), { statusCode: 404 }); return clone(pi); },
    update: async (id: string, p: any) => { const pi = S.pis.get(id); pi.metadata = { ...p.metadata }; S.calls.push(`update ${id}`); return clone(pi); },
    capture: async (id: string, p: any) => {
      if (S.captureDown) throw err('api_connection_error');
      const pi = S.pis.get(id); if (pi.status !== 'requires_capture') throw err('payment_intent_unexpected_state');
      const amt = p?.amount_to_capture ?? pi.amount; if (amt > pi.amount_capturable) throw err('amount_too_large');
      if (p?.metadata) pi.metadata = { ...p.metadata };
      pi.status = 'succeeded'; pi.amount_received = amt; pi.amount_capturable = 0; S.calls.push(`capture ${id} ${amt}`); return clone(pi);
    },
    cancel: async (id: string) => { const pi = S.pis.get(id); if (pi.status === 'succeeded') throw err('payment_intent_unexpected_state'); pi.status = 'canceled'; S.calls.push(`cancel ${id}`); return clone(pi); },
  };
  balanceTransactions = { retrieve: async () => ({ fee: 0 }) };
  charges = { retrieve: async () => ({ balance_transaction: { fee: 0 } }) };
  terminal = { readers: {
    list: async () => ({ data: Array.from(S.readers.values()).map(clone) }),
    retrieve: async (id: string) => { const r = S.readers.get(id); if (!r) throw Object.assign(err('resource_missing'), { statusCode: 404 }); return clone(r); },
    processPaymentIntent: async (id: string, p: any) => {
      const r = S.readers.get(id); if (!r) throw Object.assign(err('resource_missing'), { statusCode: 404 });
      if (r.status !== 'online') throw err('terminal_reader_offline');
      if (r.action?.status === 'in_progress') throw err('terminal_reader_busy');
      r.action = { type: 'process_payment_intent', status: 'in_progress', process_payment_intent: { payment_intent: p.payment_intent }, failure_message: null };
      S.calls.push(`process ${id} ${p.payment_intent} tip:${p.process_config?.skip_tipping === true ? 'no' : 'yes'}`); return clone(r);
    },
    cancelAction: async (id: string) => { const r = S.readers.get(id); r.action = null; S.calls.push(`cancelAction ${id}`); return clone(r); },
  } };
}
const approve = (readerId: string) => { const r = S.readers.get(readerId); const pi = S.pis.get(r.action.process_payment_intent.payment_intent); pi.status = 'requires_capture'; pi.amount_capturable = pi.amount;
  pi.latest_charge = { payment_method_details: { card_present: { brand: 'visa', last4: '4242' } } }; r.action.status = 'succeeded'; };
const decline = (readerId: string, msg = 'Your card was declined.') => { const r = S.readers.get(readerId); r.action.status = 'failed'; r.action.failure_message = msg; };

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const as = (o: any) => { for (const k of Object.keys(actor)) delete actor[k]; Object.assign(actor, { caps: [] }, o); };
const notes = async (type: string) => (await all(`${T}/notifications`)).filter((n: any) => n.type === type);
// The business's night (it runs past midnight), as the code reads tonight's schedule: set below.
let day = new Date().toISOString().slice(0, 10);

(async () => {
  day = (await import('../../src/lib/night-close-server')).tonight({ timezone: 'UTC' });
  await db.doc(T).set({ name: 'North Loft', userId: 'own', businessType: 'hospitality', stripeAccountId: 'acct_1', timezone: 'UTC' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', job: 'manager' });
  await db.doc(`${T}/staff/s1`).set({ name: 'Lee Park', role: 'staff', job: 'server' });
  await db.doc(`${T}/staff/b1`).set({ name: 'Bo Diaz', role: 'staff', job: 'bartender' });
  await db.doc(`${T}/staff/r1`).set({ name: 'Jo Kim', role: 'assistant', job: 'runner' });
  await db.doc(`${T}/staff/r2`).set({ name: 'Max Ng', role: 'assistant', job: 'runner' });
  await db.doc(`${T}/staff/c1`).set({ name: 'Rio Cook', role: 'assistant', job: 'cook' });
  await db.doc(`${T}/shifts/sh1`).set({ staffId: 'r1', date: day, startTime: '16:00', endTime: '23:00', status: 'published', kind: 'work' });
  await db.doc(`${T}/shifts/sh2`).set({ staffId: 's1', date: day, startTime: '16:00', endTime: '23:00', status: 'published', kind: 'work' });
  S.readers.set('tmr_BAR1', { id: 'tmr_BAR1', label: 'Bar reader', status: 'online', device_type: 'bbpos_wisepos_e', action: null });

  console.log('bar tabs');
  const B = await import('../../src/app/api/bar/route');
  let r: any = await B.POST(req({ tenantId: 't1', action: 'open', name: '   ' }));
  check('a tab needs a name', r.status === 400);
  r = await B.POST(req({ tenantId: 't1', action: 'open', name: 'Maria, red jacket' }));
  const visitId = r.body.visitId, partyId = r.body.partyId;
  const v0 = await get(`${T}/appointments/${visitId}`); const p0 = await get(`${T}/parties/${partyId}`);
  check('a tab under a name: a party at the bar, off the host stand’s floor, and its own visit like a table’s', r.body.ok && visitId === `apt-party-${partyId}` && p0.barTab === true && p0.sessionId === null && p0.unitIds.length === 0 && p0.status === 'seated'
    && v0.barTab === true && v0.isTable === true && v0.tableName === 'Bar' && v0.clientName === 'Maria, red jacket' && v0.status === 'servicing' && Array.isArray(v0.tab), { v0, p0 });
  r = await B.POST(req({ tenantId: 't1', action: 'tabs' }));
  check('the bar’s tabs: each open one, its readers, and the hold amount ($50 when not set)', r.body.ok && r.body.tabs.length === 1 && r.body.tabs[0].name === 'Maria, red jacket' && r.body.readers.map((x: any) => x.id).join() === 'tmr_BAR1' && r.body.holdDollars === 50, r.body);
  r = await B.POST(req({ tenantId: 't1', action: 'hold', visitId, readerId: 'tmr_BAR1' }));
  const h1 = (await get(`${T}/appointments/${visitId}`)).cardHold; const pi1 = S.pis.get(h1?.id);
  check('a card held: $50 sent to the bar’s reader, never to be taken on its own, no tip asked', r.body.ok && r.body.hold.state === 'on_reader' && pi1.amount === 5000 && pi1.capture_method === 'manual' && pi1.metadata.kind === 'bar_hold' && pi1.metadata.visitId === visitId
    && S.calls.some((c: string) => c === `process tmr_BAR1 ${pi1.id} tip:no`), { b: r.body, calls: S.calls });
  S.readers.get('tmr_BAR1').action.status = 'in_progress';
  r = await B.POST(req({ tenantId: 't1', action: 'hold', visitId, readerId: 'tmr_BAR1' }));
  check('…asked again while the reader’s asking: the same payment, not a second', r.body.ok && S.calls.filter((c: string) => c.startsWith('create')).length === 1);
  approve('tmr_BAR1');
  r = await B.POST(req({ tenantId: 't1', action: 'holdCheck', visitId }));
  check('the guest taps: held, with the card’s brand and last four, nothing charged', r.body.ok && r.body.hold.state === 'held' && r.body.hold.brand === 'visa' && r.body.hold.last4 === '4242' && r.body.hold.cents === 5000 && S.pis.get(pi1.id).status === 'requires_capture', r.body);
  const BT = await import('../../src/lib/bar-tab');
  check('…said in a few words', BT.holdWords(r.body.hold) === 'Visa 4242 held, up to $50');

  console.log('closing it at the desk on the held card');
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ status: 'prepared', payload: { appointmentIds: [visitId], items: [], feeIds: [] } });
  await db.doc(`${T}/pendingCheckouts/pc2`).set({ status: 'prepared', payload: { appointmentIds: ['other'], items: [], feeIds: [] } });
  r = await B.POST(req({ tenantId: 't1', action: 'charge', visitId, pendingId: 'nope', amountCents: 4450 }));
  check('…a sale that wasn’t started isn’t charged', r.status === 404 && r.body.code === 'no_ticket');
  r = await B.POST(req({ tenantId: 't1', action: 'charge', visitId, pendingId: 'pc2', amountCents: 4450 }));
  check('…nor a sale this tab isn’t on', r.status === 409 && r.body.code === 'not_on_sale');
  r = await B.POST(req({ tenantId: 't1', action: 'charge', visitId, pendingId: 'pc1', amountCents: 6200 }));
  check('…never more than what’s held', r.status === 409 && r.body.code === 'over_hold' && S.pis.get(pi1.id).status === 'requires_capture' && (await get(`${T}/appointments/${visitId}`)).cardHold.state === 'held');
  r = await B.POST(req({ tenantId: 't1', action: 'charge', visitId, pendingId: 'pc1', amountCents: 4450 }));
  const pi1b = S.pis.get(pi1.id); const pc1 = await get(`${T}/pendingCheckouts/pc1`);
  check('charged for the check only: $44.50 taken, the rest of the hold goes back', r.body.ok && r.body.amountCents === 4450 && pi1b.status === 'succeeded' && pi1b.amount_received === 4450 && S.calls.includes(`capture ${pi1.id} 4450`), { b: r.body, calls: S.calls });
  check('…as the sale’s own card reader payment, named on its ticket', pi1b.metadata.kind === 'sale' && pi1b.metadata.pendingId === 'pc1' && pi1b.metadata.source === 'terminal' && pc1.paymentIntentId === pi1.id && pc1.paidVia === 'card_reader' && pc1.status === 'paid_waiting' && pc1.readerPis?.[pi1.id]?.state === 'captured', pc1);
  const RS = await import('../../src/lib/reader-sale');
  check('…which the desk’s checkout accepts as this sale’s reader payment', JSON.stringify(RS.deskPaymentOf(pi1b, 't1')) === JSON.stringify({ pendingId: 'pc1', via: 'card_reader', share: false }));
  check('…and the tab shows it paid on the card', (await get(`${T}/appointments/${visitId}`)).cardHold.state === 'charged' && (await get(`${T}/appointments/${visitId}`)).cardHold.chargedCents === 4450);
  r = await B.POST(req({ tenantId: 't1', action: 'charge', visitId, pendingId: 'pc1', amountCents: 4450 }));
  check('…asked again (an answer lost): the same payment, not taken twice', r.body.ok && r.body.already === true && S.calls.filter((c: string) => c.startsWith(`capture ${pi1.id}`)).length === 1);

  console.log('letting a card go, a card turned down, and the sweep');
  r = await B.POST(req({ tenantId: 't1', action: 'open', name: 'Dev' })); const v2 = r.body.visitId;
  await B.POST(req({ tenantId: 't1', action: 'hold', visitId: v2, readerId: 'tmr_BAR1' })); approve('tmr_BAR1');
  await B.POST(req({ tenantId: 't1', action: 'holdCheck', visitId: v2 }));
  const pi2 = (await get(`${T}/appointments/${v2}`)).cardHold.id;
  r = await B.POST(req({ tenantId: 't1', action: 'holdStop', visitId: v2 }));
  check('a held card let go: the payment is cancelled, so it can never be taken', r.body.ok && r.body.hold.state === 'released' && S.pis.get(pi2).status === 'canceled');
  r = await B.POST(req({ tenantId: 't1', action: 'open', name: 'Pat' })); const v3 = r.body.visitId;
  await B.POST(req({ tenantId: 't1', action: 'hold', visitId: v3, readerId: 'tmr_BAR1' })); decline('tmr_BAR1', 'Your card has insufficient funds.');
  await db.doc(`${T}/appointments/${v3}`).set({ cardHold: { at: new Date(Date.now() - 60000).toISOString() } }, { merge: true });
  r = await B.POST(req({ tenantId: 't1', action: 'holdCheck', visitId: v3 }));
  check('a card turned down: the reader’s words, and it can be tried again', r.body.ok && r.body.hold.state === 'declined' && !!r.body.hold.failed, r.body);
  S.readers.get('tmr_BAR1').action = null;
  r = await B.POST(req({ tenantId: 't1', action: 'open', name: 'Sam' })); const v4 = r.body.visitId;
  await B.POST(req({ tenantId: 't1', action: 'hold', visitId: v4, readerId: 'tmr_BAR1' })); approve('tmr_BAR1');
  await B.POST(req({ tenantId: 't1', action: 'holdCheck', visitId: v4 }));
  const pi4 = (await get(`${T}/appointments/${v4}`)).cardHold.id;
  await db.doc(`${T}/appointments/${v4}`).set({ status: 'completed' }, { merge: true });
  const BS = await import('../../src/lib/bar-tab-server');
  const sw = await BS.sweepBarHolds(db, 't1', await get(T));
  check('the sweep: a held card on a tab paid another way is let go', sw.released >= 1 && S.pis.get(pi4).status === 'canceled' && (await get(`${T}/appointments/${v4}`)).cardHold.state === 'released', sw);
  r = await B.POST(req({ tenantId: 't1', action: 'open', name: 'Kim' })); const v5 = r.body.visitId;
  S.readers.get('tmr_BAR1').action = null;
  await B.POST(req({ tenantId: 't1', action: 'hold', visitId: v5, readerId: 'tmr_BAR1' })); approve('tmr_BAR1');
  await B.POST(req({ tenantId: 't1', action: 'holdCheck', visitId: v5 }));
  const pi5 = (await get(`${T}/appointments/${v5}`)).cardHold.id;
  await db.doc(`${T}/pendingCheckouts/pc5`).set({ status: 'prepared', payload: { appointmentIds: [v5], items: [], feeIds: [] } });
  S.captureDown = true;
  r = await B.POST(req({ tenantId: 't1', action: 'charge', visitId: v5, pendingId: 'pc5', amountCents: 2200 }));
  S.captureDown = false;
  const pc5 = await get(`${T}/pendingCheckouts/pc5`);
  check('a charge that didn’t go through: still only the tab’s hold, on no sale’s ticket, nothing taken', r.status === 503 && (await get(`${T}/appointments/${v5}`)).cardHold.state === 'held' && S.pis.get(pi5).status === 'requires_capture'
    && S.pis.get(pi5).metadata.kind === 'bar_hold' && !S.pis.get(pi5).metadata.pendingId && !pc5.readerPis?.[pi5], { pc5, md: S.pis.get(pi5).metadata });
  const cap = await RS.captureReaderPayment(new FakeStripe(), 'acct_1', pi5, 't1');
  const rel = await RS.releaseReaderPayment(new FakeStripe(), 'acct_1', pi5, 't1');
  check('…the desk’s own capture and cancel never take or let go a bar hold (only the bar’s steps do)', !cap.ok && cap.status === 'bar_hold' && !rel.ok && rel.status === 'bar_hold' && S.pis.get(pi5).status === 'requires_capture');
  // A hold mid-charge, left on a ticket as the card company last had it: the desk's reader sweep never takes it in full.
  S.pis.get(pi5).metadata = { ...S.pis.get(pi5).metadata, kind: 'sale', pendingId: 'pc5', barHold: '1' };
  await db.doc(`${T}/pendingCheckouts/pc5`).set({ readerPis: { [pi5]: { at: new Date(Date.now() - 20 * 60000).toISOString(), cents: 2200, state: 'started' } }, readerOpen: true }, { merge: true });
  await RS.sweepReaderPayments(db, 't1', await get(T), { stripe: new FakeStripe() });
  check('…the desk’s reader sweep never takes a bar hold in full', S.pis.get(pi5).status === 'requires_capture' && (await get(`${T}/pendingCheckouts/pc5`)).readerPis[pi5].state === 'not_charged');
  as({ uid: 's1', name: 'Lee Park', role: 'staff' });
  r = await B.POST(req({ tenantId: 't1', action: 'settings', holdDollars: 80 }));
  check('the hold amount is a manager’s to set', r.status === 403);
  as({ uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true });
  r = await B.POST(req({ tenantId: 't1', action: 'settings', holdDollars: 5 }));
  check('…between $10 and $500', r.status === 400);
  r = await B.POST(req({ tenantId: 't1', action: 'settings', holdDollars: 80 }));
  check('…saved', r.body.ok && (await get(T)).barTabSettings.holdDollars === 80);

  console.log('the kitchen calls people');
  const BK = await import('../../src/app/api/back/route');
  await db.doc(`${T}/serviceSessions/ss1`).set({ status: 'open', units: [{ id: 'u12', name: '12', staffIds: ['s1'] }, { id: 'u7', name: '7', staffIds: [] }] });
  await db.doc(`${T}/parties/p12`).set({ name: 'Marsh', size: 4, status: 'seated', unitIds: ['u12'], sessionId: 'ss1' });
  await db.doc(`${T}/parties/p7`).set({ name: 'Chen', size: 2, status: 'seated', unitIds: ['u7'], sessionId: 'ss1' });
  await db.doc(`${T}/appointments/v12`).set({ partyId: 'p12', tableName: '12' });
  await db.doc(`${T}/appointments/v7`).set({ partyId: 'p7', tableName: '7' });
  const K = (id: string, o: any) => db.doc(`${T}/kdsTickets/${id}`).set({ id, source: 'tab', visitId: 'v12', status: 'ready', course: 3, courseName: 'Mains', createdAt: new Date().toISOString(), ...o });
  await K('k1', { menuItemName: 'Burger' }); await K('k2', { menuItemName: 'Steak frites', quantity: 2 }); await K('k3', { menuItemName: 'Soup', status: 'delivered' });
  as({ uid: 'c1', name: 'Rio Cook', role: 'assistant' });
  r = await BK.POST(req({ tenantId: 't1', action: 'call', to: 'runner', what: 'run', visitId: 'v12', ticketIds: ['k1', 'k2', 'k3'], station: 'Expo' }));
  let kc = await notes('kitchen_call');
  check('a run from expo: the runners on tonight (not one off tonight) are buzzed with the table and what’s still at the pass', r.body.ok && r.body.call.table === 'Table 12' && r.body.call.course === 'Mains' && r.body.call.ticketIds.join() === 'k1,k2'
    && r.body.call.note === 'Burger, Steak frites × 2' && r.body.call.forIds.join() === 'r1' && kc.length === 1 && kc[0].userId === 'r1' && /^Food to run, Table 12: Mains\. Burger, Steak frites × 2/.test(kc[0].message) && kc[0].link === '/tables', { b: r.body, kc });
  r = await BK.POST(req({ tenantId: 't1', action: 'call', to: 'runner', what: 'run', visitId: 'v12', ticketIds: ['k1', 'k2'], station: 'Expo' }));
  check('…called again: the same call, nobody buzzed twice', r.body.ok && r.body.already === true && (await notes('kitchen_call')).length === 1);
  await K('k4', { menuItemName: 'Fries' });
  r = await BK.POST(req({ tenantId: 't1', action: 'call', to: 'runner', what: 'run', visitId: 'v12', ticketIds: ['k1', 'k2', 'k4'], station: 'Expo' }));
  check('…asked again with another plate now ready: the same run, with it on it', r.body.ok && r.body.already === true && r.body.call.ticketIds.join() === 'k1,k2,k4' && /Fries/.test(r.body.call.note) && (await notes('kitchen_call')).length === 1, r.body);
  await db.doc(`${T}/kdsTickets/k4`).set({ status: 'delivered' }, { merge: true });
  r = await BK.POST(req({ tenantId: 't1', action: 'call', to: 'runner', what: 'run', visitId: 'v12', ticketIds: ['k3'], station: 'Expo' }));
  check('…plates already out can’t be run', r.status === 409);
  r = await BK.POST(req({ tenantId: 't1', action: 'call', to: 'server', what: 'pass', visitId: 'v12', station: 'Grill' }));
  kc = await notes('kitchen_call');
  check('a table’s server: their section on tonight’s floor', r.body.ok && r.body.call.forIds.join() === 's1' && kc.some((n: any) => n.userId === 's1' && /Grill needs you: Come to the pass, Table 12/.test(n.message)), kc);
  await db.doc(`${T}/staff/s1`).set({ archived: true }, { merge: true });
  r = await BK.POST(req({ tenantId: 't1', action: 'call', to: 'server', what: 'question', visitId: 'v12', station: 'Grill' }));
  check('…someone in the section who’s left the team isn’t buzzed: the managers are', r.body.ok && !r.body.call.forIds.includes('s1') && r.body.call.forIds.includes('m1'));
  await db.doc(`${T}/staff/s1`).set({ archived: false }, { merge: true });
  r = await BK.POST(req({ tenantId: 't1', action: 'call', to: 'server', what: 'pass', visitId: 'v7', station: 'Grill' }));
  check('…a table nobody has: the managers', r.body.ok && r.body.call.forIds.includes('m1') && r.body.call.forIds.includes('own'));
  r = await BK.POST(req({ tenantId: 't1', action: 'call', to: 'server', what: 'pass', station: 'Grill' }));
  check('…a table’s server needs the table', r.status === 400);
  r = await BK.POST(req({ tenantId: 't1', action: 'call', to: 'manager', what: 'kitchen', station: 'Grill' }));
  check('a manager: the owner and managers', r.body.ok && r.body.call.forIds.includes('m1') && r.body.call.forIds.includes('own'));

  console.log('on their phones');
  const TB = await import('../../src/app/api/tab/route');
  as({ uid: 'r1', name: 'Jo Kim', role: 'assistant' });
  r = await TB.POST(req({ tenantId: 't1', action: 'nudges' }));
  const run = (r.body.calls || []).find((c: any) => c.run);
  check('My tables shows a runner the run, with the table and the plates', r.body.ok && run && run.line === 'Table 12: Mains. Burger, Steak frites × 2, Fries' && run.status === 'open', r.body.calls);
  r = await BK.POST(req({ tenantId: 't1', action: 'callStep', id: run.id, step: 'coming' }));
  check('…“I’m on it”: the kitchen sees who’s coming', r.body.ok && r.body.call.status === 'coming' && r.body.call.takenBy === 'Jo Kim');
  as({ uid: 'r2', name: 'Max Ng', role: 'assistant' });
  r = await TB.POST(req({ tenantId: 't1', action: 'nudges' }));
  check('…and it’s off the other runners’ phones once taken', !(r.body.calls || []).some((c: any) => c.id === run.id));
  as({ uid: 's1', name: 'Lee Park', role: 'staff' });
  r = await TB.POST(req({ tenantId: 't1', action: 'nudges' }));
  check('a server sees the kitchen asking for them, not the runners’ runs', (r.body.calls || []).some((c: any) => c.line === 'Come to the pass, Table 12') && !(r.body.calls || []).some((c: any) => c.run));
  const BCS = await import('../../src/lib/back-calls-server');
  const closed = await BCS.runsDone(db, T, ['k1', 'k2'], 'Expo');
  check('sending the plates out closes the run', closed === 1 && (await get(`${T}/backCalls/${run.id}`)).status === 'done');

  console.log('what the kitchen tells the floor');
  const FW = await import('../../src/lib/floor-word');
  const later = new Date(Date.now() + 3600000).toISOString();
  const list = FW.eightySixOf([
    { id: 'i1', x: { name: 'Short rib', soldOut: true, soldOutUntil: later } },
    { id: 'i2', x: { name: 'Oysters', choices: [{ id: 'g', name: 'Sauce', options: [{ id: 'o1', name: 'Mignonette', soldOut: true, soldOutUntil: later }, { id: 'o2', name: 'Lemon' }] }] } },
    { id: 'i3', x: { name: 'Fish of the day' } }, { id: 'i4', x: { name: 'Burger' } },
    { id: 'i5', x: { name: 'Pie', soldOut: true, soldOutUntil: new Date(Date.now() - 1000).toISOString() } },
  ], [{ id: 'i3', name: 'Fish of the day', start: 12, used: 9, left: 3, soldOut: false, fromTonight: true }, { id: 'i4', name: 'Burger', start: 40, used: 10, left: 30, soldOut: false, fromTonight: false }]);
  check('tonight’s 86 list: sold out, a choice run out, nearly gone (not one back on, not plenty left)', FW.eightySixWords(list) === 'Short rib. Oysters: no more mignonette. Fish of the day: 3 left', FW.eightySixWords(list));
  const KR = await import('../../src/app/api/kitchen/route');
  as({ uid: 's1', name: 'Lee Park', role: 'staff' });
  r = await KR.POST(req({ tenantId: 't1', action: 'floorNote', text: 'Fish is 10 minutes out.' }));
  check('telling the floor is for the kitchen (a server can’t)', r.status === 403);
  as({ uid: 'c1', name: 'Rio Cook', role: 'assistant' });
  r = await KR.POST(req({ tenantId: 't1', action: 'floorNote', text: 'Fish is 10 minutes out. Push the pasta.' }));
  const kn = await notes('kitchen_note');
  check('a cook tells the floor: the floor team on tonight is buzzed once (not the kitchen, not someone off tonight)', r.body.ok && r.body.note.text === 'Fish is 10 minutes out. Push the pasta.' && kn.map((n: any) => n.userId).sort().join() === 'r1,s1'
    && kn[0].message === 'From the kitchen: Fish is 10 minutes out. Push the pasta.', { b: r.body, kn });
  r = await KR.POST(req({ tenantId: 't1', action: 'floorNote', text: 'And the pie is out.' }));
  check('…another straight away waits a few seconds (the whole floor buzzes each time)', r.status === 429 && (await notes('kitchen_note')).length === kn.length);
  as({ uid: 's1', name: 'Lee Park', role: 'staff' });
  r = await TB.POST(req({ tenantId: 't1', action: 'nudges' }));
  check('…on My tables, with who and when', r.body.word?.note?.text === 'Fish is 10 minutes out. Push the pasta.' && r.body.word?.note?.by === 'Rio Cook', r.body.word);
  check('…for three hours at most', FW.noteNow({ text: 'x', by: 'Rio', at: new Date(Date.now() - 4 * 3600000).toISOString() }) === null && !!FW.noteNow({ text: 'x', by: 'Rio', at: new Date().toISOString() }));
  as({ uid: 'c1', name: 'Rio Cook', role: 'assistant' });
  r = await KR.POST(req({ tenantId: 't1', action: 'floorNote', text: null }));
  as({ uid: 's1', name: 'Lee Park', role: 'staff' });
  const TB2: any = await TB.POST(req({ tenantId: 't1', action: 'nudges' }));
  check('…until the kitchen clears it', r.body.ok && TB2.body.word?.note === null, TB2.body.word);

  console.log('the screens');
  const hub = src('src/components/pos/CheckoutHub.tsx'), bar = src('src/app/(app)/bar-tabs/page.tsx'), kds = src('src/app/kds/[tenantId]/page.tsx'), expo = src('src/components/kitchen/ExpoView.tsx'),
    sheet = src('src/components/kitchen/CallSheet.tsx'), tables = src('src/app/(app)/tables/page.tsx'), host = src('src/app/(app)/host/page.tsx'), word = src('src/components/host/FloorWord.tsx'), note = src('src/components/kitchen/FloorNoteSheet.tsx');
  check('the desk: “Charge the held card” on a tab with one, never for more than what’s held, then saved like any reader payment', /a\?\.barTab && a\?\.cardHold\?\.state === 'held'/.test(hub) && /action: 'charge', visitId: heldTab\.id, pendingId/.test(hub)
    && /Math\.round\(amountToCharge \* 100\) > heldCents/.test(hub) && /await afterReaderPaid\(\{ paymentIntentId: d\.paymentIntentId/.test(hub));
  check('the bar’s tabs: open one under a name, hold a card on the bar’s reader, let it go, ring drinks on it, close it at the desk', /action: 'open', name: name\.trim\(\)/.test(bar) && /action: 'hold', visitId, readerId/.test(bar) && /action: 'holdStop', visitId/.test(bar)
    && /<TableTab key=\{open\.visitId\}/.test(bar) && /\/pos\?checkout=\$\{encodeURIComponent\(open\.visitId\)\}&tab=1/.test(bar));
  check('the kitchen screen: Tell the floor, and its Call reaching people with a table to pick', /setFloorOpen\(true\)/.test(kds) && /<FloorNoteSheet post=\{post\}/.test(kds) && /people tables=\{callTables\}/.test(kds) && /action: 'floorNote', text: value/.test(note)
    && /setPicking\(\{ to, kind: k \}\)/.test(sheet) && /!\(to === 'runner' && k\.id === 'run'\)/.test(sheet));
  check('expo: “Send a runner” on a table’s run, and who’s coming', /Send a runner/.test(expo) && /is coming for it/.test(expo) && /onRunner=\{sendRunner\}/.test(kds) && /to: 'runner', what: 'run', visitId: r\.visitId, ticketIds: r\.ticketIds/.test(kds));
  check('My tables and the host stand show what the kitchen tells the floor, and My tables the calls for the person', /<FloorWord word=\{d\?\.word\} \/>/.test(tables) && /action: 'callStep', id: c\.id, step/.test(tables) && /<FloorWord word=\{floor\?\.word\} tight \/>/.test(host) && /86 tonight/.test(word));
  const PT = await import('../../src/lib/push-tier'); const J = await import('../../src/lib/jobs'); const scope = src('src/components/shared/PortalScope.tsx');
  check('the buzzes are at once, with the floor’s other kinds', PT.PUSH_TIER.kitchen_call === 'now' && PT.PUSH_TIER.kitchen_note === 'now' && /table_moved kitchen_call kitchen_note/.test(src('src/lib/notify-prefs.ts')));
  check('Bar tabs: on a bartender’s menu and managers’ Tonight, reachable from the team app', J.jobDef('bartender')?.menu.includes('/bar-tabs') && J.TONIGHT.includes('/bar-tabs') && /'\/bar-tabs', '\/counter', '\/curbside'\]/.test(scope) && /hospitality: \{[^}]*'\/bar-tabs'/.test(src('src/lib/modules.ts')));
  check('the sweep runs with the other reader payments', /await sweepBarHolds\(db, t\.id, tenant\)/.test(src('src/app/api/cron/retail-payments/route.ts')));
  check('new screens keep the house style', ![bar, word, note].some((x) => /uppercase|font-black| · /.test(x)) && ![bar, word, note].some((x) => /\{\/\*/.test(x)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
