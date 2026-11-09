// Checks paid event tickets (launch L13):
// - A business sets a price per ticket. Guests buy on the event's page, on a checkout on the business's own Stripe
//   account. The places are held while they pay, so an event never sells more tickets than it has places, even when two
//   people buy at once.
// - Once paid (the guest's return or Stripe's notice, whichever comes first, run as often as it likes), the guests go on
//   the event's guest list, the sale goes in the books once, and the buyer and the owner are told once.
// - A guest who leaves the checkout gives the places back. A checkout Stripe closes does too, and so does the daily sweep.
// - A canceled event, a business without card payments, a paused business, or a private event without its PIN sells
//   nothing. Free reservations and meal orders can't get round a paid event.
// - A manager refunds an order, or every order when the event is canceled: the money goes back to the card, the guests
//   come off the list, and the refund goes in the books once.
// - The booking page lists a paid event with its price and a link to buy tickets.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-tickets.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
// A stand-in for Stripe: checkouts, refunds, and what each was asked.
const calls: { what: string; params: any; opts: any }[] = [];
const sessions = new Map<string, any>(); let n = 0;
const fakeStripe: any = {
  checkout: { sessions: {
    create: async (params: any, opts: any) => { calls.push({ what: 'checkout', params, opts }); const id = `cs_test_${String(++n).padStart(6, '0')}`;
      const qty = params.line_items[0].quantity, unit = params.line_items[0].price_data.unit_amount;
      const s = { id, url: `https://checkout.stripe.test/${id}`, metadata: params.metadata, payment_status: 'unpaid', status: 'open', amount_total: qty * unit, payment_intent: null, created: Math.floor(Date.now() / 1000), account: opts?.stripeAccount };
      sessions.set(id, s); return s; },
    retrieve: async (id: string) => { const s = sessions.get(id); if (!s) throw Object.assign(new Error('No such checkout'), { statusCode: 404, code: 'resource_missing' }); return { ...s }; },
    expire: async (id: string, _p: any, opts: any) => { calls.push({ what: 'expire', params: { id }, opts }); const s = sessions.get(id); if (!s || s.status === 'complete') throw Object.assign(new Error('cannot expire'), { type: 'StripeInvalidRequestError' }); s.status = 'expired'; return s; },
  } },
  refunds: { create: async (params: any, opts: any) => { calls.push({ what: 'refund', params, opts }); if (refundAlready.has(params.payment_intent)) throw Object.assign(new Error('already refunded'), { code: 'charge_already_refunded', type: 'StripeInvalidRequestError' });
    const s = [...sessions.values()].find((x) => x.payment_intent === params.payment_intent); return { id: `re_${++n}`, amount: s?.amount_total || 0 }; } },
};
const refundAlready = new Set<string>(); let failCheckouts = 0;
const realCreate = fakeStripe.checkout.sessions.create;
fakeStripe.checkout.sessions.create = async (params: any, opts: any) => { if (failCheckouts > 0) { failCheckouts--; calls.push({ what: 'checkout-failed', params, opts }); throw Object.assign(new Error('timeout'), { type: 'StripeConnectionError' }); } return realCreate(params, opts); };
const pay = (id: string) => { const s = sessions.get(id)!; s.payment_status = 'paid'; s.status = 'complete'; s.payment_intent = `pi_${id.slice(-6)}`; };

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === 'stripe') return { __esModule: true, default: function Stripe() { return fakeStripe; } };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor: { name: 'Jess Manager' } }), staffOrServer: async () => true });
  return load.call(this, request, ...rest);
};
const read = (p: string) => readFileSync(p, 'utf8');
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const list = async (c: string, k: string, v: any) => (await db.collection(c).where(k, '==', v).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const mails: any[] = [];
let mailDown = 0;
(globalThis as any).fetch = async (url: string, init: any) => { if (String(url).includes('resend')) { if (mailDown > 0) { mailDown--; return { ok: false, status: 503, json: async () => ({ message: 'down' }), text: async () => 'down' }; } mails.push(JSON.parse(init.body)); } return { ok: true, status: 200, json: async () => ({ id: 'm1' }) }; };

(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test'; process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>';
  const { POST } = await import('../../src/app/api/public/event/route');
  const R = await import('../../src/app/api/events/tickets/route');
  const K = await import('../../src/lib/event-tickets');
  const SP = await import('../../src/lib/studio-page');
  const { eventToday } = SP; const { addDays } = await import('../../src/lib/tenant-time');
  let ip = '10.1.0.1';
  const call = async (body: any) => { const r: any = await POST({ json: async () => body, headers: { get: (k: string) => (k === 'x-forwarded-for' ? ip : null) }, nextUrl: { origin: 'https://app.example.com' } } as any); return { status: r.status, ...r.body }; };
  const staff = async (body: any) => { const r: any = await R.POST({ json: async () => body, headers: { get: () => null } } as any); return { status: r.status, ...r.body }; };

  const tenant = { name: 'Fern & Co', timezone: 'America/New_York', userId: 'owner1', subscriptionStatus: 'active', stripeAccountId: 'acct_biz', stripeChargesEnabled: true };
  await db.doc(T).set(tenant);
  const today = eventToday(tenant); const soon = addDays(today, 6);
  await db.doc(`${T}/studioEvents/ev1`).set({ title: 'Wine and paint night', date: soon, time: '18:30', venue: 'Main room', capacity: 5, status: 'upcoming', showOnBookingPage: true, ticketingConfig: { type: 'paid', price: 25 } });
  await db.doc(`${T}/studioEvents/ev2`).set({ title: 'Open studio', date: soon, status: 'upcoming', showOnBookingPage: true, ticketingConfig: { type: 'free', price: 0 } });
  await db.doc(`${T}/studioEvents/ev3`).set({ title: 'Members tasting', date: soon, status: 'upcoming', accessPin: '7310', ticketingConfig: { type: 'paid', price: 40 } });
  await db.doc(`${T}/studioEvents/ev4`).set({ title: 'Canceled gala', date: soon, status: 'cancelled', ticketingConfig: { type: 'paid', price: 60 } });
  await db.doc(`${T}/studioEvents/ev5`).set({ title: 'Big dinner', date: soon, status: 'upcoming', ticketingConfig: { type: 'paid', price: 30 } });
  await db.doc(`${T}/eventMenuItems/m1`).set({ id: 'm1', eventId: 'ev1', name: 'Cheese board', courseNumber: 1 });

  console.log('What guests see');
  const l1 = await call({ action: 'load', tenantId: 't1', eventId: 'ev1' });
  check('a paid event shows its price, tickets left and that they’re on sale', l1.ok && l1.tickets.cents === 2500 && l1.tickets.left === 5 && l1.tickets.block === null && l1.tickets.max === 8, l1.tickets);
  check('a free one shows no tickets', !(await call({ action: 'load', tenantId: 't1', eventId: 'ev2' })).tickets);
  check('free reservations can’t get round a paid event', (await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', name: 'Al', email: 'al@x.test' })).status === 409);

  console.log('Buying');
  const b1 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev1', name: 'Ana Ruiz', email: 'Ana@X.test', phone: '555-0101', qty: 3 });
  const c1 = calls.filter((c) => c.what === 'checkout').pop()!;
  const o1 = (await list(`${T}/eventTicketOrders`, 'eventId', 'ev1'))[0];
  check('a checkout opens on the business’s own account, once per order', b1.ok && /checkout\.stripe\.test/.test(b1.url) && c1.opts.stripeAccount === 'acct_biz' && c1.opts.idempotencyKey === `event-ticket-${o1.id}`, { b1, opts: c1.opts });
  check('for the tickets, at the event’s price, sent back to the event’s page', c1.params.line_items[0].quantity === 3 && c1.params.line_items[0].price_data.unit_amount === 2500 && c1.params.metadata.kind === 'event_ticket' && c1.params.metadata.orderId === o1.id
    && c1.params.success_url === 'https://app.example.com/event/t1/ev1?paid={CHECKOUT_SESSION_ID}' && c1.params.cancel_url === `https://app.example.com/event/t1/ev1?left=${o1.id}` && c1.params.customer_email === 'ana@x.test', c1.params);
  check('the checkout closes after about half an hour, and the places are held a little longer', Math.abs(c1.params.expires_at - Math.floor(Date.now() / 1000) - 31 * 60) < 5 && Date.parse(o1.holdUntil) - Date.now() > 32 * 60000, { exp: c1.params.expires_at, hold: o1.holdUntil });
  check('the order is held, not yet on the guest list', o1.status === 'pending' && o1.qty === 3 && o1.totalCents === 7500 && o1.sessionId && (await list(`${T}/eventGuests`, 'eventId', 'ev1')).length === 0, o1);
  check('places held count as taken', (await call({ action: 'load', tenantId: 't1', eventId: 'ev1' })).tickets.left === 2);
  const b2 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev1', name: 'Ben Ode', email: 'ben@x.test', qty: 3 });
  check('never more tickets than places, and it says how many are left', b2.status === 409 && b2.error === 'Only 2 tickets are left.' && b2.left === 2, b2);
  ip = '10.1.0.2';
  const both = await Promise.all([call({ action: 'buy', tenantId: 't1', eventId: 'ev1', name: 'Cy', email: 'cy@x.test', qty: 2 }), call({ action: 'buy', tenantId: 't1', eventId: 'ev1', name: 'Di', email: 'di@x.test', qty: 2 })]);
  check('two people buying the last places at once: only one gets them', both.filter((x) => x.ok).length === 1 && both.filter((x) => x.status === 409).length === 1, both.map((x) => x.status));
  const loser = both.find((x) => x.ok)!; const heldOrder = (await list(`${T}/eventTicketOrders`, 'eventId', 'ev1')).find((o: any) => o.status === 'pending' && o.id !== o1.id)!;
  check('sold out while they pay', (await call({ action: 'load', tenantId: 't1', eventId: 'ev1' })).tickets.left === 0 && !!loser);
  await call({ action: 'left', tenantId: 't1', eventId: 'ev1', order: heldOrder.id });
  check('leaving the checkout closes it and gives the places back', (await get(`${T}/eventTicketOrders/${heldOrder.id}`)).status === 'expired' && sessions.get(heldOrder.sessionId).status === 'expired' && (await call({ action: 'load', tenantId: 't1', eventId: 'ev1' })).tickets.left === 2);

  console.log('Paid');
  const early = await call({ action: 'paid', tenantId: 't1', eventId: 'ev1', session: o1.sessionId });
  check('before the payment settles, the page is told to wait', early.ok && early.status === 'pending', early);
  pay(o1.sessionId);
  mails.length = 0;
  const p1 = await call({ action: 'paid', tenantId: 't1', eventId: 'ev1', session: o1.sessionId });
  const g1 = (await list(`${T}/eventGuests`, 'eventId', 'ev1')).sort((a: any, b: any) => a.id.localeCompare(b.id));
  check('back from paying: the guests are on the list', p1.ok && p1.status === 'paid' && p1.qty === 3 && g1.length === 3 && g1[0].name === 'Ana Ruiz' && g1[0].email === 'ana@x.test' && g1[1].name === 'Ana Ruiz (guest 1)' && g1.every((g: any) => g.source === 'ticket' && g.ticketOrderId === o1.id && g.paidCents === 2500), { p1, g1 });
  const line = await get(`${T}/transactions/ticket_${o1.id}`);
  check('the sale is in the books, on the day it was paid', line && line.type === 'income' && line.amount === 75 && line.category === 'Event Tickets' && line.stripePaymentIntentId === sessions.get(o1.sessionId).payment_intent && line.ticketOrderId === o1.id, line);
  const ev1 = await get(`${T}/studioEvents/ev1`);
  check('the event counts them', ev1.rsvpCount === 3 && ev1.ticketsSold === 3, ev1);
  check('the buyer gets a confirmation from the business', mails.length === 1 && mails[0].to.includes('ana@x.test') && mails[0].from === '"Fern & Co" <hello@mail.example.com>' && /3 tickets for Wine and paint night/.test(mails[0].subject + mails[0].text) && /\$75/.test(mails[0].text), mails[0]);
  check('and the owner is told', (await list(`${T}/notifications`, 'userId', 'owner1')).some((x: any) => /Ana Ruiz bought 3 tickets for Wine and paint night \(\$75\)/.test(x.message)));
  mails.length = 0;
  const again = await K.finishTicketOrder(db, fakeStripe, 't1', o1.sessionId, sessions.get(o1.sessionId));
  check('Stripe’s notice arriving after: nothing twice (guests, sale or messages)', again.ok && (await list(`${T}/eventGuests`, 'eventId', 'ev1')).length === 3 && (await get(`${T}/studioEvents/ev1`)).ticketsSold === 3 && mails.length === 0, again);
  check('a checkout that isn’t this business’s isn’t finished here', (await K.finishTicketOrder(db, fakeStripe, 't1', 'cs_test_unknown1')).ok === false);
  const meal = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Zed Who', email: 'zed@x.test', picks: { 1: 'm1' } });
  check('the meal order page doesn’t add someone without a ticket', meal.status === 409 && meal.needTicket, meal);
  const meal2 = await call({ action: 'order', tenantId: 't1', eventId: 'ev1', name: 'Ana', email: 'ana@x.test', picks: { 1: 'm1' } });
  check('but a ticket holder orders their meal', meal2.ok && g1[0].id && (await get(`${T}/eventGuests/${g1[0].id}`)).mealChoiceId === 'm1', meal2);

  console.log('Nothing sold that shouldn’t be');
  const pinLess = await call({ action: 'buy', tenantId: 't1', eventId: 'ev3', name: 'Al', email: 'al@x.test', qty: 1 });
  const pinOk = await call({ action: 'buy', tenantId: 't1', eventId: 'ev3', pin: '7310', name: 'Al', email: 'al@x.test', qty: 1 });
  check('a private event sells only with its PIN', pinLess.status === 403 && pinLess.needsPin && pinOk.ok, { pinLess, pinOk });
  const canc = await call({ action: 'buy', tenantId: 't1', eventId: 'ev4', name: 'Al', email: 'al2@x.test', qty: 1 });
  check('a canceled event sells nothing', canc.status === 409 && canc.error === 'This event has been canceled.', canc);
  await db.doc('tenants/t2').set({ name: 'No Cards Co', timezone: 'America/New_York', subscriptionStatus: 'active' });
  await db.doc('tenants/t2/studioEvents/e1').set({ title: 'Paid thing', date: soon, status: 'upcoming', ticketingConfig: { type: 'paid', price: 10 } });
  const nc = await call({ action: 'load', tenantId: 't2', eventId: 'e1' }); const ncb = await call({ action: 'buy', tenantId: 't2', eventId: 'e1', name: 'Al', email: 'al@x.test', qty: 1 });
  check('a business without card payments says tickets aren’t on sale yet', /aren’t on sale online yet/.test(nc.tickets.block) && ncb.status === 409, { nc: nc.tickets, ncb });
  await db.doc('tenants/t3').set({ ...tenant, accessLocked: true });
  await db.doc('tenants/t3/studioEvents/e1').set({ title: 'Paused', date: soon, status: 'upcoming', ticketingConfig: { type: 'paid', price: 10 } });
  const lk = await call({ action: 'buy', tenantId: 't3', eventId: 'e1', name: 'Al', email: 'al@x.test', qty: 1 });
  check('a paused business sells nothing', lk.status === 403 && !calls.some((c) => c.what === 'checkout' && c.opts.stripeAccount === 'acct_biz' && c.params.metadata.tenantId === 't3'), lk);
  const tries = []; for (let i = 0; i < 5; i++) { ip = `10.1.0.${20 + i}`; tries.push(await call({ action: 'buy', tenantId: 't1', eventId: 'ev5', name: 'Hog', email: 'hog@x.test', qty: 1 })); }
  check('one email can’t hold an event’s places by opening checkout after checkout', tries.slice(0, 4).every((x) => x.ok) && tries[4].status === 429, tries.map((x) => x.status));
  ip = '10.1.0.40';
  const v = []; for (let i = 0; i < 4; i++) v.push(await call({ action: 'buy', tenantId: 't1', eventId: 'ev5', name: `V${i}`, email: `v${i}@x.test`, qty: 1 }));
  check('nor can one visitor, by changing the email: three open checkouts at a time', v[0].ok && v[1].ok && v[2].ok && v[3].status === 409 && /already have a checkout open/.test(v[3].error), v.map((x) => x.status));
  ip = '10.1.0.41'; failCheckouts = 2;
  const f1 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev5', name: 'Flaky', email: 'flaky@x.test', qty: 1 });
  const fo = (await list(`${T}/eventTicketOrders`, 'email', 'flaky@x.test'))[0];
  check('a checkout that won’t open is asked twice, then its hold just runs out (in case Stripe made it after all)', f1.status === 502 && calls.filter((c) => c.what === 'checkout-failed').length === 2 && fo.status === 'pending' && fo.checkoutFailed === true, { f1, fo });
  failCheckouts = 1;
  const f2 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev5', name: 'Flaky', email: 'flaky2@x.test', qty: 1 });
  check('and asked again with the same key, a lost answer still opens one checkout', f2.ok && calls.filter((c) => c.what === 'checkout').slice(-1)[0].opts.idempotencyKey === calls.filter((c) => c.what === 'checkout-failed').slice(-1)[0].opts.idempotencyKey, f2);

  console.log('Closing and the sweep');
  const exp = (await list(`${T}/eventTicketOrders`, 'eventId', 'ev5'))[0];
  await K.expireTicketOrder(db, 't1', exp.id, exp.sessionId);
  check('a checkout Stripe closed gives its places back', (await get(`${T}/eventTicketOrders/${exp.id}`)).status === 'expired');
  const ev5 = (await list(`${T}/eventTicketOrders`, 'eventId', 'ev5')).filter((o: any) => o.status === 'pending' && o.sessionId);
  pay(ev5[0].sessionId);
  for (const o of ev5) await db.doc(`${T}/eventTicketOrders/${o.id}`).set({ holdUntil: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  const sw = await K.sweepTicketOrders(db, fakeStripe, 't1');
  check('the daily sweep finishes a paid order whose notice was lost, and frees the unpaid ones', sw.finished === 1 && sw.freed === ev5.length - 1 && (await get(`${T}/eventTicketOrders/${ev5[0].id}`)).status === 'paid' && (await get(`${T}/eventTicketOrders/${ev5[1].id}`)).status === 'expired', sw);
  check('places held past their time aren’t counted', K.heldPlaces([{ status: 'pending', qty: 4, holdUntil: new Date(Date.now() - 1000).toISOString() }, { status: 'pending', qty: 2, holdUntil: new Date(Date.now() + 60000).toISOString() }]) === 2);

  console.log('When things go wrong');
  ip = '10.1.0.50';
  await db.doc(`${T}/studioEvents/ev6`).set({ title: 'Tiny class', date: soon, status: 'upcoming', capacity: 2, ticketingConfig: { type: 'paid', price: 15 } });
  const x1 = await call({ action: 'buy', tenantId: 't1', eventId: 'ev6', name: 'Mo', email: 'mo@x.test', qty: 2 }); const xo = (await list(`${T}/eventTicketOrders`, 'eventId', 'ev6'))[0];
  mailDown = 1; mails.length = 0; pay(xo.sessionId);
  await call({ action: 'paid', tenantId: 't1', eventId: 'ev6', session: xo.sessionId });
  check('a confirmation that couldn’t go first time isn’t marked sent', x1.ok && !(await get(`${T}/eventTicketOrders/${xo.id}`)).buyerToldAt && mails.length === 0);
  await call({ action: 'paid', tenantId: 't1', eventId: 'ev6', session: xo.sessionId });
  await K.finishTicketOrder(db, fakeStripe, 't1', xo.sessionId, sessions.get(xo.sessionId));
  check('it’s sent on the next try, once', mails.length === 1 && !!(await get(`${T}/eventTicketOrders/${xo.id}`)).buyerToldAt, mails.length);
  ip = '10.1.0.51';
  await db.doc(`${T}/studioEvents/ev7`).set({ title: 'Last seats', date: soon, status: 'upcoming', capacity: 1, ticketingConfig: { type: 'paid', price: 20 } });
  await call({ action: 'buy', tenantId: 't1', eventId: 'ev7', name: 'Early', email: 'early@x.test', qty: 1 }); const lateO = (await list(`${T}/eventTicketOrders`, 'eventId', 'ev7'))[0];
  await K.expireTicketOrder(db, 't1', lateO.id, lateO.sessionId);
  ip = '10.1.0.52';
  const winner = await call({ action: 'buy', tenantId: 't1', eventId: 'ev7', name: 'Winner', email: 'win@x.test', qty: 1 }); const winO = (await list(`${T}/eventTicketOrders`, 'email', 'win@x.test'))[0];
  pay(winO.sessionId); await call({ action: 'paid', tenantId: 't1', eventId: 'ev7', session: winO.sessionId });
  pay(lateO.sessionId); mails.length = 0;
  const late = await call({ action: 'paid', tenantId: 't1', eventId: 'ev7', session: lateO.sessionId });
  const lateRf = calls.filter((c) => c.what === 'refund').pop()!;
  check('paid after its places were let go and sold: refunded, never added past the limit', winner.ok && late.ok && late.status === 'sold_out' && (await list(`${T}/eventGuests`, 'eventId', 'ev7')).length === 1
    && lateRf.opts.idempotencyKey === `event-ticket-soldout-${lateO.id}` && (await get(`${T}/eventTicketOrders/${lateO.id}`)).status === 'refunded' && mails.some((m: any) => /sold out while you were paying/.test(m.text)), { late, lateRf });
  check('and the guest’s page says so', /sold out while you were paying, so your payment has been refunded/.test(read('src/app/event/[tenantId]/[eventId]/page.tsx')));

  console.log('Refunds');
  const rf = await staff({ tenantId: 't1', action: 'refund', orderId: o1.id });
  const rc = calls.filter((c) => c.what === 'refund').pop()!;
  check('a manager’s refund goes back to the card, on the business’s account, once, marked as the app’s', rf.ok && rf.refundedCents === 7500 && rc.params.payment_intent === sessions.get(o1.sessionId).payment_intent && rc.opts.stripeAccount === 'acct_biz' && rc.opts.idempotencyKey === `event-ticket-refund-${o1.id}` && rc.params.metadata.origin === 'app', { rf, rc });
  const rLine = await get(`${T}/transactions/refund_ticket_${o1.id}`);
  check('the guests come off the list and the refund is in the books', (await list(`${T}/eventGuests`, 'ticketOrderId', o1.id)).length === 0 && (await get(`${T}/studioEvents/ev1`)).ticketsSold === 0 && rLine?.type === 'reversal' && rLine.amount === 75 && rLine.stripeRefundId && (await get(`${T}/transactions/ticket_${o1.id}`)).refundedAt, rLine);
  const rf2 = await staff({ tenantId: 't1', action: 'refund', orderId: o1.id });
  check('refunding again changes nothing', rf2.ok && rf2.already && calls.filter((c) => c.what === 'refund' && c.opts.idempotencyKey === `event-ticket-refund-${o1.id}`).length === 1, rf2);
  await db.doc(`${T}/studioEvents/ev5`).set({ status: 'cancelled' }, { merge: true });
  // Refunded in the Stripe Dashboard: the books have it already (lib/outside-refund), so the app only updates the order.
  refundAlready.add(sessions.get(xo.sessionId).payment_intent);
  const outRf = await staff({ tenantId: 't1', action: 'refund', orderId: xo.id });
  check('an order refunded in the Dashboard first: the app’s refund updates the order and list, with no second refund line', outRf.ok && (await get(`${T}/eventTicketOrders/${xo.id}`)).refundedOutside === true && !(await get(`${T}/transactions/refund_ticket_${xo.id}`)) && (await list(`${T}/eventGuests`, 'ticketOrderId', xo.id)).length === 0, outRf);
  const wo = await get(`${T}/eventTicketOrders/${winO.id}`);
  const synced = await K.syncOutsideTicketRefund(db, 't1', winO.id, 2000);
  check('and the payments notice for a Dashboard refund does the same', synced && (await get(`${T}/eventTicketOrders/${winO.id}`)).status === 'refunded' && (await list(`${T}/eventGuests`, 'ticketOrderId', winO.id)).length === 0 && !(await get(`${T}/transactions/refund_ticket_${winO.id}`)) && wo.status === 'paid');
  check('only once', (await K.syncOutsideTicketRefund(db, 't1', winO.id, 2000)) === false);
  check('the notice calls it for a ticket charge refunded in full', /meta\.kind === 'event_ticket' && meta\.orderId && charge\.refunded === true[\s\S]{0,400}syncOutsideTicketRefund\(db, tenant\.id, String\(meta\.orderId\)/.test(read('src/lib/connect-webhook.ts')));
  // The payments notice for the app's own refund arriving before the app has recorded it: the refund still gets its line.
  ip = '10.1.0.60';
  await call({ action: 'buy', tenantId: 't1', eventId: 'ev1', name: 'Racer', email: 'racer@x.test', qty: 1 }); const ro = (await list(`${T}/eventTicketOrders`, 'email', 'racer@x.test'))[0];
  pay(ro.sessionId); await call({ action: 'paid', tenantId: 't1', eventId: 'ev1', session: ro.sessionId });
  const plain = fakeStripe.refunds.create;
  fakeStripe.refunds.create = async (params: any, opts: any) => { const r = await plain(params, opts); await K.syncOutsideTicketRefund(db, 't1', ro.id, r.amount); return r; };
  const race = await staff({ tenantId: 't1', action: 'refund', orderId: ro.id }); fakeStripe.refunds.create = plain;
  const raceO = await get(`${T}/eventTicketOrders/${ro.id}`);
  check('a refund the notice saw first still gets its line in the books, once', race.ok && raceO.status === 'refunded' && raceO.refundTransactionId === `refund_ticket_${ro.id}` && (await get(`${T}/transactions/refund_ticket_${ro.id}`))?.amount === 25, { race, raceO });
  check('and the notice leaves the app’s own refunds to the app', /!refunds\.some\(\(rf: any\) => rf\?\.metadata\?\.origin === 'app'\)/.test(read('src/lib/connect-webhook.ts')));
  const all = await staff({ tenantId: 't1', action: 'refund-all', eventId: 'ev5' });
  check('canceling: every paid order refunded at once', all.ok && all.refunded === 1 && (await get(`${T}/eventTicketOrders/${ev5[0].id}`)).status === 'refunded', all);

  console.log('The booking page');
  check('lists a paid event (with its price), never a private one', SP.listedEvent({ showOnBookingPage: true, date: soon, ticketingConfig: { type: 'paid', price: 25 } }) && !SP.publicEvent({ showOnBookingPage: true, date: soon, ticketingConfig: { type: 'paid', price: 25 } })
    && !SP.listedEvent({ showOnBookingPage: true, date: soon, accessPin: '1', ticketingConfig: { type: 'paid', price: 25 } }) && SP.listedTicketPrice({ ticketingConfig: { type: 'paid', price: 25 } }) === 25);
  const bp = read('src/components/booking/StudioBookingPage.tsx');
  check('with a Tickets link to the event’s own page', bp.includes('href={`/event/${encodeURIComponent(tenant.id)}/${encodeURIComponent(e.id)}`}') && /a ticket/.test(bp));
  const pd = read('src/app/api/booking/public-data/route.ts');
  check('and seats left there count the places being paid for', /heldPlaces\(/.test(pd) && /filter\(listedEvent\)/.test(pd) && /if \(!publicEvent\(ev\) \|\| String\(ev\.date\) < eventToday\(tt\)\)/.test(pd));

  console.log('Source');
  const wh = read('src/lib/connect-webhook.ts');
  check('Stripe’s notice finishes ticket orders (and asks again if it couldn’t), and frees closed checkouts', /session\.metadata\?\.kind === 'event_ticket'[\s\S]{0,400}finishTicketOrder\(db, stripe2, tenant\.id, String\(session\.id\), session\)[\s\S]{0,120}throw new Error/.test(wh) && /expireTicketOrder\(db, tenant\.id/.test(wh));
  check('the daily sweep runs', /sweepTicketOrders\(db, stripe, d\.id\)/.test(read('src/app/api/cron/membership-renewals/route.ts')));
  const ep = read('src/app/(app)/events/page.tsx');
  check('the event form sets a price (blank is free), keeping a place limit or invitation-only already on it', /return price > 0 \? \{ \.\.\.prev, type: 'paid', price \} : \{ \.\.\.prev, type: prev\.type === 'comp_only' \? 'comp_only' : 'free', price: 0 \}/.test(ep));
  const panel = read('src/components/events/TicketOrdersPanel.tsx');
  check('the refund dialog warns when a guest has checked in or ordered a meal', /already checked in/.test(panel) && /meal order/.test(panel) && /guests=\{guests\}/.test(read('src/app/(app)/events/[eventId]/manifest/page.tsx')));
  const gp = read('src/app/event/[tenantId]/[eventId]/page.tsx');
  check('the guest pays on Stripe’s checkout, never typing a card on our page', /action: 'buy'/.test(gp) && /window\.location\.assign\(r\.url\)/.test(gp) && !/cvc|card number|cardNumber/i.test(gp));
  check('the manifest shows ticket orders with refunds', /TicketOrdersPanel/.test(read('src/app/(app)/events/[eventId]/manifest/page.tsx')));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
