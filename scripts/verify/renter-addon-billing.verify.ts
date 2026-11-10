// Checks charging renters' add-ons (lib/renter-addon-billing), against a stand-in database and Stripe:
// - Adding one in the portal charges its first month at once, on the business's account, and records it once (income
//   'Renter Add-on', a receipt, a note in their portal); a declined card means it isn't added.
// - The daily run charges each month that's due, once (run twice: one charge), a month on from the day it was added
//   (the last day of a shorter month), and moves it on; time already paid for isn't charged again.
// - A declined renewal pauses it (it works until its paid month runs out), and the renter and the business are told.
// - Only running add-ons, for a tool that's still an add-on, held by a renter with a lease now, are charged; others stop.
// - A lost answer is settled by the five-minute check, which moves the add-on on, or pauses it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-addon-billing.verify.ts
import Module from 'module';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const audits: any[] = []; const sent: any[] = []; const receipts: any[] = [];
const M: any = Module as any;
const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);

// A stand-in Stripe: each payment is kept; a card ending 0002 is declined; `silent` loses the answer once.
const intents: any[] = []; let silent = false;
const stripe: any = {
  paymentIntents: {
    create: async (p: any, o: any) => {
      const prior = intents.find((x) => x.idem === o?.idempotencyKey);
      if (prior) { if (prior.declined) throw prior.err; return prior; }
      if (p.payment_method === 'pm_0002') { const err = Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', raw: { message: 'Your card was declined.' } }); intents.push({ idem: o?.idempotencyKey, declined: true, err }); throw err; }
      const pi = { id: `pi_${intents.length + 1}`, status: 'succeeded', amount: p.amount, created: Math.floor(Date.now() / 1000), customer: p.customer, metadata: p.metadata, account: o?.stripeAccount, idem: o?.idempotencyKey,
        latest_charge: { id: `ch_${intents.length + 1}`, balance_transaction: { id: `txn_${intents.length + 1}`, fee: 74 } } };
      intents.push(pi);
      if (silent) { silent = false; throw Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' }); }
      return pi;
    },
    list: async (q: any, o: any) => ({ data: intents.filter((x) => !x.declined && x.customer === q.customer && x.account === o?.stripeAccount), has_more: false }),
    retrieve: async (id: string) => intents.find((x) => x.id === id),
    cancel: async (id: string) => ({ id, status: 'canceled' }),
  },
};
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) return fake(request, function () { return stripe; });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (is(request, 'firebase-admin')) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === './audit' || is(request, 'audit')) return fake(request, { logAuditAdmin: async (_db: any, _t: string, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (is(request, 'notify')) return fake(request, { sendNotification: async (_db: any, i: any) => { sent.push(i); return { status: 'sent', ok: true }; }, resolveFromAddress: () => 'hello@example.com' });
  if (is(request, 'account-receipts')) return fake(request, { sendRenterMoneyNotice: async (_db: any, _t: string, _te: any, x: any) => { receipts.push(x); return { sentTo: 'Maya by email', noContact: false }; } });
  if (is(request, 'sms')) return fake(request, { smsConfigured: () => false, sendTenantSms: async () => ({ ok: true }) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN = 'tok-maya-0123456789abcdef';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const tx = async () => (await db.collection(`${T}/transactions`).get()).docs.map((d: any) => d.data());

(async () => {
  const B = await import('../../src/lib/renter-addon-billing');
  const { todayIn, tenantTimeZone, addDays } = await import('../../src/lib/tenant-time');
  check('a month on, on the same day', B.monthOn('2026-11-09', 9) === '2026-12-09' && B.monthOn('2026-12-09', 9) === '2027-01-09');
  check('a shorter month: its last day, then back to the day', B.monthOn('2027-01-31', 31) === '2027-02-28' && B.monthOn('2027-02-28', 31) === '2027-03-31');
  check('the words on a charge', B.addOnWords('Swap days', '2026-11-09', '2026-12-09') === 'Swap days add-on, Nov 9 to Dec 9');

  const tenant0 = { name: 'Northside', stripeAccountId: 'acct_1', timezone: 'America/Chicago',
    renterOffers: { addons: { swaps: true, campaigns: true, packages: true }, prices: { swaps: 1500, campaigns: 500, packages: 800 }, version: 2 }, renterCampaigns: { mode: 'renter_pays' } };
  await db.doc(T).set(tenant0);
  const today = todayIn(tenantTimeZone(tenant0));
  const card = (pm: string) => ({ cardOnFile: true, stripeCustomerId: 'cus_1', stripePaymentMethodId: pm, stripeCustomerAccount: 'acct_1', cardBrand: 'visa', cardLast4: pm.slice(-4) });
  await db.doc(`${T}/renters/r1`).set({ firstName: 'Maya', lastName: 'Ortiz', email: 'maya@example.com', ...card('pm_4242') });
  await db.doc(`${T}/staff/s1`).set({ isRenter: true, renterId: 'r1', name: 'Maya Ortiz' });
  await db.doc(`${T}/leases/l1`).set({ renterId: 'r1', status: 'active' });
  await db.doc(`${T}/private/renterSessions`).set({ [sha(TOKEN)]: { contactKey: '5551234567', name: 'Maya Ortiz', renterId: 'r1', expiresAt: Date.now() + 3600e3 } });
  const { POST } = await import('../../src/app/api/portal/renter/route');
  const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://northside.test' } }) as any;
  const portal = (x: any) => POST(req({ tenantId: 't1', token: TOKEN, ...x })) as any;
  const orig = { e: console.error, w: console.warn }; console.error = () => {}; console.warn = () => {};

  // ── Adding one: the first month, at once ────────────────────────────────
  const a1 = await portal({ action: 'addon-add', key: 'swaps', priceCents: 1500 });
  const r1 = (await get(`${T}/renters/r1`)).addOns.swaps;
  const end1 = B.monthOn(today, Number(today.slice(8)));
  check('adding it charges the first month at once', a1.status === 200 && intents.length === 1 && intents[0].amount === 1500 && intents[0].account === 'acct_1', a1.body);
  check('…and says so, with the card', /^Added\. \$15 was charged to your Visa ending 4242, and your receipt is on its way\.$/.test(a1.body.message), a1.body.message);
  check('…paid through a month on, next charged then', r1.status === 'active' && r1.paidThrough === end1 && r1.nextBillOn === end1 && r1.billDay === Number(today.slice(8)), r1);
  const lines = (await tx()).filter((t: any) => t.category === 'Renter Add-on');
  check('…recorded once, as a Renter Add-on, with its Stripe fee', lines.length === 1 && lines[0].amount === 15 && /Swap days add-on/.test(lines[0].description) && (await tx()).some((t: any) => t.category === 'Processing Fees' && t.amount === 0.74));
  check('…a receipt, and a note in their portal', receipts.length === 1 && receipts[0].kind === 'renter_charge' && /Swap days add-on/.test(receipts[0].tokens.what) && (await db.collection(`${T}/renterAlerts`).get()).docs.some((d: any) => /\$15\.00 was charged to Visa ending 4242/.test(d.data().text)));

  // Declined on the way in: not added.
  await db.doc(`${T}/renters/r1`).set(card('pm_0002'), { merge: true });
  const a2 = await portal({ action: 'addon-add', key: 'campaigns', priceCents: 500 });
  const c2 = (await get(`${T}/renters/r1`)).addOns.campaigns;
  check('a declined first month: not added, and they’re told on screen', a2.status === 402 && /Your card was declined, so it wasn’t added/.test(a2.body.error) && c2.status === 'stopped' && c2.stoppedWhy === 'declined' && c2.nextBillOn === null);
  check('…nothing recorded, no receipt, and the business isn’t told it was added', (await tx()).filter((t: any) => t.category === 'Renter Add-on').length === 1 && receipts.length === 1 && !audits.some((a) => a.action === 'renters.addon_add' && /Win-back/.test(a.summary)));
  check('…the list shows it can be added again', a2.body.lines.find((l: any) => l.key === 'campaigns').state === 'addon');
  await db.doc(`${T}/renters/r1`).set(card('pm_4242'), { merge: true });

  // ── The daily run ────────────────────────────────────────────────────────
  const n0 = intents.length;
  let run = await B.billRenterAddOns(db, 't1', tenant0, { stripe });
  check('nothing due: nothing charged', run.charged === 0 && intents.length === n0);
  // A month on (a day other than today's, whose month was charged as it was added).
  const due = addDays(today, -5);
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { nextBillOn: due, paidThrough: due } } }, { merge: true });
  run = await B.billRenterAddOns(db, 't1', tenant0, { stripe });
  const r2 = (await get(`${T}/renters/r1`)).addOns.swaps;
  const end2 = B.monthOn(due, Number(today.slice(8)));
  check('a month due is charged, once, and moves on a month, on the day it was added', run.charged === 1 && intents.length === n0 + 1 && r2.nextBillOn === end2 && r2.paidThrough === end2, { run, r2 });
  check('the month already charged (the day it was added) is never charged again', (await B.chargeAddOn(db, 't1', tenant0, 'r1', 'swaps', { stripe })).result === 'skipped');
  run = await B.billRenterAddOns(db, 't1', tenant0, { stripe });
  check('run again the same day: no second charge', run.charged === 0 && intents.length === n0 + 1);
  // Its price stays what they added it at.
  await db.doc(T).set({ renterOffers: { prices: { swaps: 2500 } } }, { merge: true });
  const tenant1 = await get(T);
  const yesterday = addDays(today, -1);
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { nextBillOn: yesterday } } }, { merge: true });
  run = await B.billRenterAddOns(db, 't1', tenant1, { stripe });
  check('a new price doesn’t change theirs', run.charged === 1 && intents[intents.length - 1].amount === 1500);
  // Long overdue: no charge for the time already gone.
  await db.doc(`${T}/renters/r1/charges/inc_addon_swaps_${today}`).delete();
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { nextBillOn: addDays(today, -60) } } }, { merge: true });
  run = await B.billRenterAddOns(db, 't1', tenant1, { stripe });
  const r3 = (await get(`${T}/renters/r1`)).addOns.swaps;
  check('long overdue: it starts today, not back then', run.charged === 1 && r3.nextBillOn === end1 && (await get(`${T}/renters/r1/charges/inc_addon_swaps_${today}`))?.status === 'charged' && !(await get(`${T}/renters/r1/charges/inc_addon_swaps_${addDays(today, -60)}`)), run);
  check('…and from then on falls on today’s day of the month', r3.billDay === Number(today.slice(8)));
  // Charged, but moving it on didn't get saved: never charged again, just moved on.
  const tag = addDays(today, -40);
  await db.doc(`${T}/renters/r1/charges/inc_addon_swaps_${tag}`).set({ status: 'charged', amountCents: 1500, addon: { key: 'swaps', start: tag, end: B.monthOn(tag, 9), next: tag } });
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { nextBillOn: tag } } }, { merge: true });
  const nAll = intents.length;
  run = await B.billRenterAddOns(db, 't1', tenant1, { stripe });
  check('a month charged whose move-on was lost isn’t charged again, even long after', intents.length === nAll && run.charged === 0 && (await get(`${T}/renters/r1`)).addOns.swaps.nextBillOn === B.monthOn(tag, 9));
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { nextBillOn: end1 } } }, { merge: true });

  // Declined renewal: paused, both told.
  sent.length = 0;
  await db.doc(`${T}/renters/r1`).set({ ...card('pm_0002'), addOns: { swaps: { nextBillOn: addDays(today, -2), paidThrough: addDays(today, 3) } } }, { merge: true });
  run = await B.billRenterAddOns(db, 't1', tenant1, { stripe });
  const p1 = (await get(`${T}/renters/r1`)).addOns.swaps;
  check('a declined renewal pauses it', run.declined === 1 && p1.status === 'paused' && p1.pausedWhy === 'declined' && p1.nextBillOn === null);
  const { offerAllows, resolveOffers, renterOfferLines } = await import('../../src/lib/renter-offers');
  const rNow = await get(`${T}/renters/r1`);
  check('…it works until the month paid for runs out', offerAllows(resolveOffers(tenant1), 'swaps', rNow, today) && !offerAllows(resolveOffers(tenant1), 'swaps', rNow, addDays(today, 3)));
  check('…the renter is told in their portal and by email', (await db.collection(`${T}/renterAlerts`).get()).docs.some((d: any) => d.data().tone === 'amber' && /Swap days is paused: your Visa ending 0002 was declined/.test(d.data().text)) && sent.some((x) => x.kind === 'renter_addon_paused'));
  check('…and the business', (await db.collection(`${T}/notifications`).get()).docs.some((d: any) => /Maya Ortiz’s Swap days add-on is paused: their card was declined\. Nothing was charged/.test(d.data().message)));
  check('…their list says it’s paused', renterOfferLines(resolveOffers(tenant1), rNow, { booksHere: true, businessName: 'Northside', today }).find((l) => l.key === 'swaps')?.paused === true);
  run = await B.billRenterAddOns(db, 't1', tenant1, { stripe });
  check('…and nothing is tried again on its own', run.declined === 0 && run.charged === 0);

  // Adding it again before it runs out: no charge until then.
  await db.doc(`${T}/renters/r1`).set(card('pm_4242'), { merge: true });
  const n1 = intents.length;
  const a3 = await portal({ action: 'addon-add', key: 'swaps', priceCents: 2500 });
  const r4 = (await get(`${T}/renters/r1`)).addOns.swaps;
  check('added again before it runs out: next charged then, at today’s price', a3.status === 200 && intents.length === n1 && r4.nextBillOn === addDays(today, 3) && r4.priceCents === 2500 && /next charged on/.test(a3.body.message), a3.body);

  // No card: paused.
  await db.doc(`${T}/renters/r1`).set({ cardOnFile: false, addOns: { swaps: { nextBillOn: addDays(today, -7) } } }, { merge: true });
  run = await B.billRenterAddOns(db, 't1', tenant1, { stripe });
  check('no card to charge: paused, nothing tried at Stripe', run.declined === 1 && intents.length === n1 && (await get(`${T}/renters/r1`)).addOns.swaps.pausedWhy === 'no_card');
  await db.doc(`${T}/renters/r1/charges/inc_addon_swaps_${today}`).delete();
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { status: 'active', nextBillOn: addDays(today, -45), pausedWhy: null } } }, { merge: true });
  run = await B.billRenterAddOns(db, 't1', tenant1, { stripe });
  check('…long overdue with no card: paused all the same', run.declined === 1 && (await get(`${T}/renters/r1`)).addOns.swaps.status === 'paused', { run, a: (await get(`${T}/renters/r1`)).addOns.swaps });
  await db.doc(`${T}/renters/r1`).set({ ...card('pm_4242') }, { merge: true });

  // Only what should be charged is.
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { status: 'active', nextBillOn: today }, packages: { status: 'stopped', nextBillOn: today, priceCents: 800 } } }, { merge: true });
  await db.doc(T).set({ renterOffers: { addons: { swaps: false } } }, { merge: true });
  const tenant2 = await get(T);
  run = await B.billRenterAddOns(db, 't1', tenant2, { stripe });
  check('a tool no longer an add-on: stopped, not charged', run.stopped === 1 && run.charged === 0 && intents.length === n1 && (await get(`${T}/renters/r1`)).addOns.swaps.stoppedWhy === 'included');
  check('a stopped one is never charged', !intents.some((x) => /packages/.test(x.metadata?.addon || '')));
  await db.doc(T).set({ renterOffers: { addons: { swaps: true } } }, { merge: true });
  const tenant3 = await get(T);
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { status: 'active', nextBillOn: today } } }, { merge: true });
  await db.doc(`${T}/leases/l1`).set({ status: 'ended' }, { merge: true });
  run = await B.billRenterAddOns(db, 't1', tenant3, { stripe });
  check('no lease now: stopped, not charged', run.stopped === 1 && intents.length === n1 && (await get(`${T}/renters/r1`)).addOns.swaps.stoppedWhy === 'lease_ended');
  await db.doc(`${T}/leases/l1`).set({ status: 'active' }, { merge: true });

  // ── A lost answer, settled by the five-minute check ─────────────────────
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { status: 'active', nextBillOn: addDays(today, -3), paidThrough: null } } }, { merge: true });
  silent = true;
  run = await B.billRenterAddOns(db, 't1', tenant3, { stripe });
  const start = addDays(today, -3);
  const att = await get(`${T}/renters/r1/charges/inc_addon_swaps_${start}`);
  check('no answer: left claimed, the add-on not moved on', run.waiting === 1 && att?.status === 'charging' && (await get(`${T}/renters/r1`)).addOns.swaps.nextBillOn === start);
  run = await B.billRenterAddOns(db, 't1', tenant3, { stripe });
  check('…the daily run doesn’t charge it again meanwhile', run.charged === 0 && intents.filter((x) => String(x.metadata?.attempt) === `addon_swaps_${start}`).length === 1);
  await db.doc(`${T}/renters/r1/charges/inc_addon_swaps_${start}`).set({ claimAt: new Date(Date.now() - 20 * 60000).toISOString() }, { merge: true });
  await db.doc(`${T}/renters/r1`).set({ incidentalOpenAt: new Date(Date.now() - 20 * 60000).toISOString() }, { merge: true });
  const { settleLostRenterIncidentals } = await import('../../src/lib/renter-incidentals');
  const st = await settleLostRenterIncidentals(db, 't1', tenant3, { stripe });
  const r5 = (await get(`${T}/renters/r1`)).addOns.swaps;
  check('the check finds it went through: recorded as an add-on, and it moves on a month', st.recorded === 1 && r5.nextBillOn === B.monthOn(start, Number(r5.billDay)) && (await tx()).filter((t: any) => t.category === 'Renter Add-on').length >= 4, { st, r5 });

  // A renewal that never reached Stripe: tried again by the daily run, not paused.
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { status: 'active', nextBillOn: addDays(today, -11) } }, incidentalOpen: {}, incidentalOpenAt: null }, { merge: true });
  const k2 = `addon_swaps_${addDays(today, -11)}`;
  await db.doc(`${T}/renters/r1/charges/inc_${k2}`).set({ status: 'charging', claimAt: new Date(Date.now() - 20 * 60000).toISOString(), amountCents: 1500, customer: 'cus_1', account: 'acct_1', pm: 'pm_4242', tries: 1, ledgerCategory: 'Renter Add-on', description: 'Swap days add-on', addon: { key: 'swaps', start: addDays(today, -11), end: end1, next: addDays(today, -11) } });
  await db.doc(`${T}/renters/r1`).set({ incidentalOpen: { [k2]: new Date(Date.now() - 20 * 60000).toISOString() }, incidentalOpenAt: new Date(Date.now() - 20 * 60000).toISOString() }, { merge: true });
  const st2 = await settleLostRenterIncidentals(db, 't1', tenant3, { stripe });
  const r6 = (await get(`${T}/renters/r1`)).addOns.swaps;
  check('a renewal that never reached Stripe: released, still running, tried again next run', st2.released === 1 && r6.status === 'active' && r6.nextBillOn === addDays(today, -11));
  const again2 = await B.billRenterAddOns(db, 't1', tenant3, { stripe });
  check('…and the next run charges it, under a new try', again2.charged === 1 && (await get(`${T}/renters/r1/charges/inc_${k2}`)).tries === 2);
  // A first month whose answer was lost and that never went through: not added, and they're told.
  sent.length = 0;
  await db.doc(`${T}/renters/r1`).set({ addOns: { packages: { status: 'active', priceCents: 800, nextBillOn: today, billDay: Number(today.slice(8)) } } }, { merge: true });
  const k3 = `addon_packages_${today}`;
  const old = new Date(Date.now() - 20 * 60000).toISOString();
  await db.doc(`${T}/renters/r1/charges/inc_${k3}`).set({ status: 'charging', claimAt: old, amountCents: 800, customer: 'cus_9', account: 'acct_1', pm: 'pm_4242', tries: 1, ledgerCategory: 'Renter Add-on', description: 'Packages add-on', addon: { key: 'packages', start: today, end: end1, next: today, first: true } });
  await db.doc(`${T}/renters/r1`).set({ incidentalOpen: { [k3]: old }, incidentalOpenAt: old }, { merge: true });
  await settleLostRenterIncidentals(db, 't1', tenant3, { stripe });
  const p3 = (await get(`${T}/renters/r1`)).addOns.packages;
  check('a lost first month that never went through: not added, and they’re told', p3.status === 'stopped' && p3.stoppedWhy === 'not_through' && sent.some((x) => /wasn’t added/.test(x.subject)) && (await db.collection(`${T}/notifications`).get()).docs.some((d: any) => /Packages and memberships add-on wasn’t added/.test(d.data().message)));
  // The business can't take cards: nothing charged or paused, the business told once.
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { status: 'active', nextBillOn: addDays(today, -2) } } }, { merge: true });
  const nNo = intents.length;
  const noAcct = { ...tenant3, stripeChargesEnabled: false };
  run = await B.billRenterAddOns(db, 't1', noAcct, { stripe }); await B.billRenterAddOns(db, 't1', noAcct, { stripe });
  check('card payments off for the business: nothing charged or paused, and it’s told once a day', intents.length === nNo && (await get(`${T}/renters/r1`)).addOns.swaps.status === 'active' && run.waiting === 1 && (await get(`${T}/notifications/addon_nopay_${today}`)) !== null);
  // An add-on charge can be refunded like any agreed charge.
  const { renterPaymentKind } = await import('../../src/lib/renter-refund');
  const addLine = (await db.collection(`${T}/transactions`).get()).docs.find((d: any) => d.data().category === 'Renter Add-on');
  check('an add-on charge can be refunded on the Rent page, as an agreed charge', renterPaymentKind(addLine.data(), new Set(), addLine.id) === 'agreed');
  check('…its fee line says add-on', (await tx()).some((t: any) => t.category === 'Processing Fees' && /add-on charge/.test(t.description)));
  console.error = orig.e; console.warn = orig.w;

  // ── The words ────────────────────────────────────────────────────────────
  const src = readFileSync('src/lib/renter-addon-billing.ts', 'utf8');
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  check('no tool names', !AI.test(src));
  check('never says to call or contact', !/call us|contact us/i.test(src));
  check('the daily run charges them', /billRenterAddOns/.test(readFileSync('src/app/api/cron/autopay-leases/route.ts', 'utf8')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
