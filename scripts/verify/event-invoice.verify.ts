// Checks the final invoice for an event (L20 round 22b, design canvas "Event sheet and final invoice"): lib/event-invoice
// (the lines and the balance), lib/event-invoice-server and api/event-invoice (a manager saves, sends, or marks it paid),
// api/public/event-invoice (the client's link: the invoice, a card checkout for exactly the balance, the payment recorded
// once), and the pages.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/event-invoice.verify.ts
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
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !(globalThis as any).__mgr ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { name: 'Jess Manager', isManager: true } }), staffOrServer: async () => true });
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
  (globalThis as any).__mgr = true;
  const I = await import('../../src/lib/event-invoice');
  console.log('the invoice');
  const quoted = { quoteId: 'q1', capacity: 40, quoteTotal: 4200, quoteLines: [{ name: 'Dinner', quantity: 40, price: 95 }, { name: 'Room', quantity: 1, price: 400 }], deposit: { amount: 1000, paid: true } };
  check('a price each to start from: what was quoted, per guest guaranteed', I.suggestEachCents(quoted) === 10500 && I.suggestEachCents({ capacity: 0 }) === null);
  const inv = I.cleanInvoice({ came: 44, eachCents: 10500, barCents: 61250, extras: [{ name: 'Late finish, one hour', cents: 15000 }, { name: '', cents: 0 }] })!;
  const v = I.invoiceLines(quoted, inv);
  check('line by line: as quoted, the extra guests, the bar tab, anything else; less the deposit; the balance', v.lines.map((l) => `${l.label}=${l.cents}`).join('|') === 'As quoted=420000|4 more guests=42000|Bar tab=61250|Late finish, one hour=15000' && v.totalCents === 538250 && v.paidCents === 100000 && v.balanceCents === 438250, v);
  check('…payments since count against it', I.invoiceLines(quoted, inv, [{ id: 'cs_1', cents: 38250, at: '', how: 'card' }]).balanceCents === 400000);
  check('extra guests only for an event from a quote (another event’s number is its ticket limit)', I.invoiceLines({ ...quoted, quoteId: '' }, inv).extraGuests === 0);
  check('refused when it makes no sense', I.cleanInvoice({ came: -1 }) === null && I.cleanInvoice({ eachCents: 1.5 }) === null && I.cleanInvoice({ barCents: 99_999_999_999 }) === null && I.cleanInvoice({ extras: [{ name: '', cents: 500 }] }) === null
    && I.cleanInvoice({ extras: Array.from({ length: 11 }, (_, i) => ({ name: `x${i}`, cents: 1 })) }) === null);

  console.log('the manager');
  await db.doc(T).set({ name: 'Linden', timezone: 'America/New_York', userId: 'owner1', subscriptionStatus: 'active', stripeAccountId: 'acct_biz', stripeChargesEnabled: true });
  await db.doc(`${T}/studioEvents/e1`).set({ id: 'e1', title: 'Okafor rehearsal dinner', date: '2026-11-20', clientName: 'Ada Okafor', clientEmail: 'ada@x.test', ...quoted });
  for (let i = 0; i < 44; i++) await db.doc(`${T}/eventGuests/g${i}`).set({ id: `g${i}`, eventId: 'e1', name: `G${i}`, checkedIn: i < 43 });
  const { POST: MGR } = await import('../../src/app/api/event-invoice/route');
  const mgr = async (b: any) => { const r: any = await MGR({ json: async () => ({ tenantId: 't1', eventId: 'e1', ...b }), headers: { get: () => 'Bearer x' }, nextUrl: { origin: 'https://app.example.com' } } as any); return { status: r.status, ...r.body }; };
  let r: any = await mgr({ action: 'view' });
  check('a start: the guests checked in, and a price each from the quote', r.ok && r.invoice.invoice.came === 43 && r.invoice.invoice.eachCents === 10500 && r.invoice.saved === false && r.invoice.status === 'draft' && r.invoice.clientEmail === 'ada@x.test' && r.invoice.cardOn, r.invoice);
  r = await mgr({ action: 'save', invoice: { came: 44, eachCents: 10500, barCents: 61250, extras: [{ name: 'Late finish, one hour', cents: 15000 }] } });
  check('saved; the balance worked out on the server', r.ok && r.invoice.saved && r.invoice.view.balanceCents === 438250, r);
  const badSave = await mgr({ action: 'save', invoice: { came: 'lots' } });
  check('…not one that makes no sense', badSave.status === 400);
  (globalThis as any).__mgr = false;
  check('only a manager', (await mgr({ action: 'view' })).status === 403);
  (globalThis as any).__mgr = true;
  r = await mgr({ action: 'send' });
  const ev1 = await get(`${T}/studioEvents/e1`); const token = ev1.finalInvoice.token;
  const mail = mails.find((m) => /Your final invoice for Okafor rehearsal dinner/.test(m.subject));
  check('sent: the client is emailed the invoice and a link to pay', r.ok && ev1.finalInvoice.status === 'sent' && /^[a-f0-9]{40}$/.test(token) && !!mail && JSON.stringify(mail).includes(`/event-invoice/t1/${token}`) && JSON.stringify(mail).includes('To pay: $4,382.50'), { sent: ev1.finalInvoice, subject: mail?.subject });

  console.log('the client');
  const { POST: PUB } = await import('../../src/app/api/public/event-invoice/route');
  const pub = async (b: any) => { const r: any = await PUB({ json: async () => ({ tenantId: 't1', token, ...b }), headers: { get: (k: string) => (k === 'x-forwarded-for' ? '10.3.0.1' : null) }, nextUrl: { origin: 'https://app.example.com' } } as any); return { status: r.status, ...r.body }; };
  r = await pub({ action: 'view' });
  check('the link shows the business, the event, each line and what’s left to pay; nothing about other guests', r.ok && r.invoice.business === 'Linden' && r.invoice.balanceCents === 438250 && r.invoice.lines.length === 4 && !JSON.stringify(r.invoice).includes('G1'), r.invoice);
  check('a wrong key finds nothing', (await PUB({ json: async () => ({ tenantId: 't1', token: 'a'.repeat(40), action: 'view' }), headers: { get: () => null }, nextUrl: { origin: 'x' } } as any) as any).status === 404);
  r = await pub({ action: 'pay' });
  const c1 = calls.filter((c) => c.what === 'checkout').pop()!;
  check('pay: a card checkout for exactly the balance, on the business’s own account, for this invoice', r.ok && c1.params.line_items[0].price_data.unit_amount === 438250 && c1.opts.stripeAccount === 'acct_biz' && c1.params.metadata.kind === 'event_invoice' && c1.params.metadata.eventId === 'e1' && /event-invoice-e1-438250-0/.test(c1.opts.idempotencyKey), c1);
  const sid = r.url.split('/').pop(); pay(sid);
  r = await pub({ action: 'paid', sessionId: sid });
  const ev2 = await get(`${T}/studioEvents/e1`); const line = await get(`${T}/transactions/eventinv_${sid}`);
  check('paid: recorded, marked paid in full, in the books', r.ok && r.invoice.paid && ev2.finalInvoice.status === 'paid' && ev2.finalInvoice.payments.length === 1 && line?.amount === 4382.5 && line?.category === 'Events' && line?.paymentMethod === 'Card (Stripe)', { inv: ev2.finalInvoice, line });
  const { handleConnectWebhook } = await import('../../src/lib/connect-webhook'); void handleConnectWebhook;
  const EIS = await import('../../src/lib/event-invoice-server');
  const again = await EIS.finishInvoice(db, fakeStripe, 't1', sid, sessions.get(sid));
  check('the same payment noticed again (Stripe’s notice) counts once', again.ok && (await get(`${T}/studioEvents/e1`)).finalInvoice.payments.length === 1);
  const nots = await list(`${T}/notifications`, 'type', 'event_invoice_paid');
  check('the owner hears once', nots.length === 1 && /paid \$4,382\.50 on the final invoice/.test(nots[0].message), nots);
  check('…and a paid invoice can’t change or be sent again', (await mgr({ action: 'save', invoice: { came: 50, eachCents: 1, barCents: 0, extras: [] } })).status === 409 && (await mgr({ action: 'send' })).status === 409 && (await pub({ action: 'pay' })).status === 409);
  check('the checkout key carries the details Stripe checks (a corrected email or title opens a new checkout)', /^event-invoice-e1-438250-0-[a-f0-9]{12}$/.test(c1.opts.idempotencyKey), c1.opts.idempotencyKey);

  console.log('refunded in Stripe');
  const pi1 = sessions.get(sid).payment_intent;
  check('a refund in Stripe: the payment counts for nothing, the invoice shows what’s owing again', await EIS.syncInvoiceRefund(db, 't1', 'e1', pi1, 438250)
    && (await get(`${T}/studioEvents/e1`)).finalInvoice.status === 'sent' && (await pub({ action: 'view' })).invoice.balanceCents === 438250);
  check('…noticed again, nothing changes; the owner hears once', !(await EIS.syncInvoiceRefund(db, 't1', 'e1', pi1, 438250)) && (await list(`${T}/notifications`, 'type', 'event_invoice_refunded')).length === 1
    && /\$4,382\.50 of the final invoice payment/.test((await list(`${T}/notifications`, 'type', 'event_invoice_refunded'))[0].message));
  check('…a payment it doesn’t know is left alone', !(await EIS.syncInvoiceRefund(db, 't1', 'e1', 'pi_other', 100)));

  console.log('changed while open, and paid twice');
  const stale = await pub({ action: 'pay', expectCents: 100 });
  check('paying an amount the invoice no longer shows: refused, to see the latest', stale.status === 409 && stale.code === 'changed' && /just changed/.test(stale.error));
  r = await pub({ action: 'pay', expectCents: 438250 });
  const sid2 = r.url.split('/').pop(); pay(sid2);
  // Settled another way while the client was on the checkout, then their card payment lands.
  check('marked paid in cash meanwhile', (await mgr({ action: 'mark_paid', how: 'cash' })).ok);
  await EIS.finishInvoice(db, fakeStripe, 't1', sid2, sessions.get(sid2));
  const ev4 = await get(`${T}/studioEvents/e1`); const highs = (await list(`${T}/notifications`, 'type', 'event_invoice_paid')).filter((x: any) => x.priority === 'high');
  check('a payment more than was owed: kept, flagged, and the owner told to refund the difference', ev4.finalInvoice.status === 'paid' && ev4.finalInvoice.payments.length === 3 && highs.length === 1 && /\$4,382\.50 more than was owed\. Refund \$4,382\.50/.test(highs[0].message), { inv: ev4.finalInvoice, highs });
  check('…the manager sees it too', (await mgr({ action: 'view' })).invoice.overpaidCents === 438250);
  await EIS.syncInvoiceRefund(db, 't1', 'e1', sessions.get(sid2).payment_intent, 438250);
  const after = await mgr({ action: 'view' });
  check('…and once the difference is refunded in Stripe, the alert clears and it stays paid', after.invoice.overpaidCents === 0 && after.invoice.status === 'paid' && after.invoice.view.balanceCents === 0, after.invoice);

  console.log('nothing to pay');
  await db.doc(`${T}/studioEvents/e4`).set({ id: 'e4', title: 'Comped', date: '2026-11-23', clientEmail: 'cy@x.test', finalInvoice: { token: 'b'.repeat(40), status: 'sent', came: null, eachCents: null, barCents: 0, extras: [] } });
  const p4 = async (b: any) => { const r: any = await PUB({ json: async () => ({ tenantId: 't1', token: 'b'.repeat(40), ...b }), headers: { get: () => null }, nextUrl: { origin: 'x' } } as any); return { status: r.status, ...r.body }; };
  const v4 = await p4({ action: 'view' }); const pay4 = await p4({ action: 'pay' });
  check('an invoice brought down to nothing says so, not “paid”, and opens no checkout', v4.invoice.nothing && !v4.invoice.paid && pay4.status === 409 && /nothing to pay/.test(pay4.error));

  console.log('paid another way');
  await db.doc(`${T}/studioEvents/e2`).set({ id: 'e2', title: 'Book club', date: '2026-11-21', clientName: 'Bo', clientEmail: 'bo@x.test', quoteId: 'q2', capacity: 10, quoteTotal: 300, deposit: { amount: 0, paid: false } });
  const m2 = async (b: any) => { const r: any = await MGR({ json: async () => ({ tenantId: 't1', eventId: 'e2', ...b }), headers: { get: () => 'Bearer x' }, nextUrl: { origin: 'https://app.example.com' } } as any); return { status: r.status, ...r.body }; };
  await m2({ action: 'save', invoice: { came: 10, eachCents: null, barCents: 4500, extras: [] } });
  r = await m2({ action: 'mark_paid', how: 'cash' });
  const ev3 = await get(`${T}/studioEvents/e2`);
  check('a manager marks it paid in cash: paid in full, in the books as cash', r.ok && ev3.finalInvoice.status === 'paid' && ev3.finalInvoice.payments[0].cents === 34500 && ev3.finalInvoice.payments[0].how === 'cash'
    && (await list(`${T}/transactions`, 'eventId', 'e2'))[0]?.paymentMethod === 'Cash', ev3.finalInvoice);
  check('…not twice', (await m2({ action: 'mark_paid', how: 'cash' })).status === 409 && (await m2({ action: 'mark_paid', how: 'bitcoin' })).status === 400);
  await db.doc(`${T}/studioEvents/e3`).set({ id: 'e3', title: 'No email', date: '2026-11-22', quoteId: 'q3', capacity: 5, quoteTotal: 100 });
  const m3 = async (b: any) => { const r: any = await MGR({ json: async () => ({ tenantId: 't1', eventId: 'e3', ...b }), headers: { get: () => 'Bearer x' }, nextUrl: { origin: 'https://app.example.com' } } as any); return { status: r.status, ...r.body }; };
  await m3({ action: 'save', invoice: { came: 5, eachCents: null, barCents: 0, extras: [] } });
  const noMail = await m3({ action: 'send' });
  check('sending needs the client’s email', noMail.status === 409 && /client’s email/.test(noMail.error));
  await db.doc(`${T}/studioEvents/e5`).set({ id: 'e5', title: 'Two at once', date: '2026-11-24', clientEmail: 'di@x.test', quoteId: 'q5', capacity: 5, quoteTotal: 200 });
  const m5 = async (b: any) => { const r: any = await MGR({ json: async () => ({ tenantId: 't1', eventId: 'e5', ...b }), headers: { get: () => 'Bearer x' }, nextUrl: { origin: 'https://app.example.com' } } as any); return { status: r.status, ...r.body }; };
  await m5({ action: 'save', invoice: { came: 5, eachCents: null, barCents: 0, extras: [] } });
  const before5 = mails.length; await Promise.all([m5({ action: 'send' }), m5({ action: 'send' })]);
  const keys5 = mails.slice(before5).map((x) => (/\/event-invoice\/t1\/([a-f0-9]{40})/.exec(JSON.stringify(x)) || [])[1]);
  check('sent twice at the same moment: one link key, the same in both emails', keys5.length === 2 && keys5[0] === keys5[1] && keys5[0] === (await get(`${T}/studioEvents/e5`)).finalInvoice.token, keys5);

  console.log('the pages');
  const card = read('src/components/events/FinalInvoiceCard.tsx'); const page = read('src/app/event-invoice/[tenantId]/[token]/page.tsx'); const sheet = read('src/app/(app)/events/[eventId]/sheet/page.tsx');
  const hook = read('src/lib/connect-webhook.ts');
  check('the card on the event sheet (managers, not printed); the client’s page; Stripe’s notice records it too', sheet.includes('<FinalInvoiceCard') && card.includes('print:hidden') && card.includes('Send to the client') && card.includes('Paid another way?') && page.includes('Your final invoice') && page.includes("action: 'pay'") && hook.includes("session.metadata?.kind === 'event_invoice'"));
  const mine = card + page + read('src/lib/event-invoice.ts') + read('src/lib/event-invoice-server.ts');
  check('house style in the new code', !/salon|stylist|booth|chair/i.test(mine) && !/uppercase|font-black/.test(mine) && !/ · /.test(mine) && !/\{\/\*/.test(card + page) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(card + page));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
