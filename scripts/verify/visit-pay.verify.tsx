// scripts/verify/visit-pay.verify.tsx — PAY AND TIP FROM THE VISIT LINK (Booking page step 5d, ClientVisit "Pay and tip"):
// checkout sends the total to the client's own phone (a screen that belongs to one visit — no iPad, so a solo provider
// on their phone can use it), they're texted their visit link, the link shows the bill with the deposit taken off, a tip
// in dollars, then Stripe's form; the tip is added on the server, and it only counts once Stripe says it's paid.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/visit-pay.verify.tsx
import Module from 'module';
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeDb, FV } from './fake-db';

(globalThis as any).React = React;
process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
let db: any = makeDb();
const pis: Record<string, any> = {}; let n = 0; const sent: any[] = []; const failCancel = new Set<string>();
function StripeMock(this: any) {
  return {
    paymentIntents: {
      create: async (p: any) => { const id = `pi_${++n}`; pis[id] = { id, status: 'requires_payment_method', amount: p.amount, metadata: p.metadata || {}, client_secret: `${id}_secret`, customer: p.customer }; return { ...pis[id] }; },
      update: async (id: string, p: any) => { if (failCancel.has(id)) throw new Error('network'); if (['succeeded', 'processing'].includes(pis[id].status)) throw Object.assign(new Error(`cannot update a ${pis[id].status} payment`), { code: 'payment_intent_unexpected_state' }); const { metadata, ...rest } = p || {}; Object.assign(pis[id], rest); if (metadata) pis[id].metadata = { ...pis[id].metadata, ...metadata }; return { ...pis[id] }; },
      retrieve: async (id: string) => ({ ...pis[id] }),
      // Like Stripe: one that went through, or is still going through at the bank, can't be called off.
      cancel: async (id: string) => { if (failCancel.has(id)) throw new Error('network'); if (['succeeded', 'processing'].includes(pis[id].status)) throw new Error(`cannot cancel a ${pis[id].status} payment`); pis[id].status = 'canceled'; return { ...pis[id] }; },
    },
    customers: { create: async () => ({ id: 'cus_1' }) },
    paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2030 } }) },
  };
}
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { uid: 'k1', name: 'Kai Park', role: 'front_desk' } }) };
  if (request === '@/lib/audit') return { logAuditAdmin: async () => undefined };
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: !String(m.to || '').includes('fail') }; } };
  if (request === '@/lib/email-template') return { brandedEmailHtml: (x: any) => `<p>${x.title}</p>` };
  if (request === '@/lib/client-verify') return { ...load.call(this, require.resolve('../../src/lib/client-verify.ts'), ...rest), deviceTrusted: async () => true };
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams() } } as any);
const getReq = (q: string) => ({ nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams(q) }, headers: { get: () => null } } as any);
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const text = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const fresh = async (o: { phone?: string; email?: string; noLink?: boolean; off?: boolean; renter?: boolean; textOff?: boolean } = {}) => {
  db = makeDb(); sent.length = 0;
  await db.doc(T).set({ name: 'Opal Manicure Studio', stripeAccountId: 'acct_1', timezone: 'America/Chicago', ...(o.off ? { clientScreen: { payOnVisitLink: false } } : {}) });
  await db.doc(`${T}/clients/c1`).set({ name: 'Dana Reyes', phone: o.phone ?? '+15125550148', email: o.email ?? 'dana@example.com', ...(o.textOff ? { smsOptOut: true } : {}) });
  await db.doc(`${T}/appointments/a1`).set({ id: 'a1', tenantId: 't1', clientId: 'c1', clientName: 'Dana Reyes', serviceId: 's1', staffId: 'm1', status: 'servicing', checkInStatus: 'arrived', startTime: new Date().toISOString(), ...(o.noLink ? {} : { checkInToken: 'tokVisit1' }), ...(o.renter ? { isRenterBooking: true, renterProviderId: 'r1' } : {}) });
  await db.doc('appointmentCheckIns/tokVisit1').set({ tenantId: 't1', id: 'a1', status: 'servicing' });
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ id: 'pc1', status: 'prepared', clientId: 'c1', clientName: 'Dana Reyes', expectedTotal: 50, preparedAt: new Date().toISOString(), payload: { clientId: 'c1', items: [], payment: { method: 'card' } } });
};

(async () => {
  const { POST: screen } = await import('../../src/app/api/client-screen/route');
  const { GET: visitView } = await import('../../src/app/api/visit-view/route');
  const call = (body: any) => screen(req({ tenantId: 't1', ...body })) as any;

  // ── A visit's own screen ────────────────────────────────────────────────
  await fresh();
  const v1 = await call({ action: 'visit_screen', appointmentId: 'a1' });
  ok(v1.body.ok && v1.body.screenId.length >= 40 && v1.body.name === 'Dana’s phone', 'checkout opens the visit’s own screen (a long secret id), named for the client', v1.body);
  const sc = await get(`clientScreens/${v1.body.screenId}`);
  ok(sc.kind === 'visit' && sc.tenantId === 't1' && sc.appointmentId === 'a1' && (await get(`${T}/appointments/a1`)).payScreenId === v1.body.screenId, 'it belongs to that visit, and the visit knows it');
  ok(!('checkInToken' in sc) && !JSON.stringify(sc).includes('tokVisit1'), 'the screen never holds a copy of the visit link');
  const v2 = await call({ action: 'visit_screen', appointmentId: 'a1' });
  ok(v2.body.screenId === v1.body.screenId, 'sending again uses the same screen');
  await db.doc(`${T}/appointments/a1`).set({ payScreenId: null }, { merge: true });
  const [v3, v4] = await Promise.all([call({ action: 'visit_screen', appointmentId: 'a1' }), call({ action: 'visit_screen', appointmentId: 'a1' })]);
  ok(v3.body.screenId === v1.body.screenId && v4.body.screenId === v1.body.screenId, 'two desks asking at once still get the one screen for that visit');
  await db.doc('clientScreens/ipad0000000000000000000000000000').set({ tenantId: 't1', name: 'Front iPad' });
  const list = await call({ action: 'list' });
  ok(list.body.screens.length === 1 && list.body.screens[0].name === 'Front iPad', 'a visit’s screen never shows among the iPads to pair or choose');
  await fresh({ noLink: true });
  ok((await call({ action: 'visit_screen', appointmentId: 'a1' })).body.code === 'no_link', 'a visit without a visit link can’t be sent there (take the card another way)');
  await fresh({ off: true });
  ok((await call({ action: 'visit_screen', appointmentId: 'a1' })).status === 403, 'the business can turn paying from the visit link off');
  await fresh({ renter: true });
  ok((await call({ action: 'visit_screen', appointmentId: 'a1' })).body.code === 'renter', 'a renter’s own booking is never sent to the client’s phone from this checkout');

  // ── Asking for the payment: texted, and the link looks again at once ────
  await fresh();
  const s1 = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  const r1 = await call({ action: 'request', screenId: s1, kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1', askTip: true, tipBase: 50, providers: [] });
  const q1 = (await get(`clientScreens/${s1}`)).request;
  ok(r1.body.ok && r1.body.notified === 'text' && sent[0]?.channel === 'sms' && /your total from Opal Manicure Studio is ready\. You can add a tip and pay here: https:\/\/app\.test\/check-in\/tokVisit1\?do=pay/.test(sent[0].text), 'they’re texted their visit link, opening on the payment', { r: r1.body, sent });
  ok(q1.kind === 'pay' && q1.amount === 50 && q1.askTip === true && q1.tipsDirect === true && pis[q1.paymentIntentId]?.metadata?.pendingCheckoutId === 'pc1', 'the same payment as the iPad: on the sale’s ticket, tip asked for, tips said to go straight to the provider');
  const left = Date.parse(q1.expiresAt) - Date.now();
  ok(left > 29 * 60000 && left <= 30 * 60000, 'on their phone it stays open for 30 minutes', q1.expiresAt);
  ok(sent[0]?.kind === 'visit_pay' && sent[0].essential === true && sent[0].tokens?.link === 'https://app.test/check-in/tokVisit1?do=pay' && sent[0].tokens?.amount === '$50.00' && sent[0].appointmentId === 'a1', 'it’s the “Your total is ready” message (the business can word it), sent at any hour since they’re at the desk', sent[0]);
  const other = await call({ action: 'request', screenId: s1, kind: 'pay', amount: 50, clientId: 'c2', pendingId: 'pc1' });
  ok(other.status === 409 && other.body.code === 'other_client' && (await get(`clientScreens/${s1}`)).request.id === q1.id, 'another client’s sale is never sent to this client’s phone', other.body);
  await fresh({ textOff: true });
  const s1b = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  ok((await call({ action: 'request', screenId: s1b, kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1' })).body.notified === 'email' && !sent.some((m) => m.channel === 'sms'), 'texts turned off: emailed, never texted');
  await fresh({ phone: '+1fail' });
  const s2 = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  const r2 = await call({ action: 'request', screenId: s2, kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1' });
  ok(r2.body.notified === 'email' && sent.some((m) => m.channel === 'email' && m.subject === 'Your total from Opal Manicure Studio'), 'no text possible: emailed instead');
  await fresh({ phone: '', email: '' });
  const s3 = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  ok((await call({ action: 'request', screenId: s3, kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1' })).body.notified === null, 'no phone or email: the desk is told to ask them to open their link');

  // ── The visit link sees it, they tip, they pay ──────────────────────────
  await fresh();
  const s4 = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  const r4 = await call({ action: 'request', screenId: s4, kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1', askTip: true, tipBase: 50 });
  const view1: any = await visitView(getReq('token=tokVisit1'));
  ok(view1.body.view.pay?.open === true && view1.body.view.pay.screenId === s4, 'the visit link learns there’s a payment waiting (only that link learns the screen)', view1.body.view.pay);
  const pv = await screen(req({ action: 'pay_view', screenId: s4, requestId: r4.body.requestId })) as any;
  ok(pv.body.ok && pv.body.clientSecret && pv.body.stripeAccount === 'acct_1' && pv.body.amount === 50, 'Stripe’s form opens for that payment on the business’s account');
  const tip = await screen(req({ action: 'pay_tip', screenId: s4, requestId: r4.body.requestId, tip: 10 })) as any;
  const piId = (await get(`clientScreens/${s4}`)).request.paymentIntentId;
  ok(tip.body.amount === 60 && pis[piId].amount === 6000 && pis[piId].metadata.tipCents === '1000', 'the tip is added to the payment on the server ($50 + $10)');
  ok((await screen(req({ action: 'pay_tip', screenId: s4, requestId: r4.body.requestId, tip: 500 })) as any).status === 400, 'a tip with an extra zero is caught');
  const early = await screen(req({ action: 'pay_done', screenId: s4, requestId: r4.body.requestId })) as any;
  ok(early.status === 409 && early.body.code === 'not_paid' && !(await get(`clientScreens/${s4}`)).request.answeredAt, 'it doesn’t count as paid until Stripe says so (and says it isn’t paid, so the page can let them try again)', early.body);
  pis[piId].status = 'processing';
  const tipLocked = await screen(req({ action: 'pay_tip', screenId: s4, requestId: r4.body.requestId, tip: 5 })) as any;
  const doneSlow = await screen(req({ action: 'pay_done', screenId: s4, requestId: r4.body.requestId })) as any;
  ok(tipLocked.status === 409 && tipLocked.body.code === 'locked' && pis[piId].amount === 6000 && doneSlow.body.code === 'processing', 'once it’s going through, the tip can’t be changed (said plainly), and confirming says it’s still going through', { tipLocked: tipLocked.body, doneSlow: doneSlow.body });
  pis[piId].status = 'requires_payment_method'; failCancel.add(piId);
  const tipDrop = await screen(req({ action: 'pay_tip', screenId: s4, requestId: r4.body.requestId, tip: 5 })) as any;
  ok(tipDrop.status === 503 && tipDrop.body.code !== 'locked' && /try again/.test(tipDrop.body.error), 'Stripe not reached: “try again”, never “already on its way”', tipDrop.body); failCancel.delete(piId);
  Object.assign(pis[piId], { status: 'succeeded' });
  const done = await screen(req({ action: 'pay_done', screenId: s4, requestId: r4.body.requestId })) as any;
  const after = await get(`clientScreens/${s4}`);
  ok(done.body.ok && after.response?.paid === true && after.response.amount === 60 && after.response.tip === 10 && after.response.paymentIntentId === piId, 'paid: the desk hears it with the payment and the tip, and the sale records itself', after.response);
  const view2: any = await visitView(getReq('token=tokVisit1'));
  ok(view2.body.view.pay?.paid === true && !view2.body.view.pay.open, 'the visit link sees it’s paid');
  const cancel = await call({ action: 'request', screenId: s4, kind: 'idle' });
  ok(cancel.body.ok && (await get(`clientScreens/${s4}`)).request === null, 'the desk can cancel what’s waiting on their phone');

  // ── Never two live payments for one sale; never left open ──────────────
  await fresh();
  await db.doc('clientScreens/ipad0000000000000000000000000000').set({ tenantId: 't1', name: 'Front iPad', phase: 'idle', request: null });
  const ip = await call({ action: 'request', screenId: 'ipad0000000000000000000000000000', kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1' });
  const ipPi = (await get('clientScreens/ipad0000000000000000000000000000')).request.paymentIntentId;
  const s5 = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  const r5 = await call({ action: 'request', screenId: s5, kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1' });
  const ipAfter = await get('clientScreens/ipad0000000000000000000000000000');
  ok(ip.body.ok && r5.body.ok && pis[ipPi].status === 'canceled' && ipAfter.request === null && ipAfter.response?.abandoned === true, 'sent to their phone while it was open on the iPad: the iPad’s payment is called off first', { ip: ip.body, r5: r5.body, ipAfter });
  // Still going through at the bank: it can't be replaced or called off, so the desk waits.
  const q5 = (await get(`clientScreens/${s5}`)).request; pis[q5.paymentIntentId].status = 'processing';
  const stillCancel = await call({ action: 'request', screenId: s5, kind: 'idle' });
  ok(stillCancel.status === 409 && stillCancel.body.code === 'screen_processing' && (await get(`clientScreens/${s5}`)).request?.id === q5.id, 'a payment still going through can’t be called off (it stays, so it can land on its sale)', stillCancel.body);
  const viaIpad = await call({ action: 'request', screenId: 'ipad0000000000000000000000000000', kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1' });
  ok(viaIpad.status === 409 && viaIpad.body.code === 'screen_processing' && /still going through on Dana’s phone/.test(viaIpad.body.error), 'nor asked for again on another screen while it’s going through', viaIpad.body);
  ok((await screen(req({ action: 'pay_abandon', screenId: s5, requestId: q5.id })) as any).body.result === 'processing' && (await get(`clientScreens/${s5}`)).request?.id === q5.id, 'a screen timing out leaves it open too');
  const { closeScreenPaymentsFor } = await import('../../src/lib/screen-pay');
  const sp = await closeScreenPaymentsFor(db, 't1', 'pc1');
  ok(sp.processing === 1 && sp.names[0] === 'Dana’s phone' && (await get(`clientScreens/${s5}`)).request?.id === q5.id, 'settling the sale says a payment is still going through, and where', sp);
  pis[q5.paymentIntentId].status = 'requires_payment_method';
  const sp2 = await closeScreenPaymentsFor(db, 't1', 'pc1', { why: 'the sale was saved' });
  ok(sp2.processing === 0 && pis[q5.paymentIntentId].status === 'canceled' && (await get(`clientScreens/${s5}`)).request === null, 'once the sale is settled, a payment still open for it is called off');

  // Couldn't be called off, and Stripe doesn't say it's canceled: it may still be paid on the form already open, so it
  // stays open and the desk is told to try again (never "nothing was charged").
  await fresh();
  const s8 = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  await call({ action: 'request', screenId: s8, kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1' });
  const q8 = (await get(`clientScreens/${s8}`)).request; failCancel.add(q8.paymentIntentId);
  const c8 = await call({ action: 'request', screenId: s8, kind: 'idle' });
  ok(c8.status === 503 && c8.body.code === 'screen_unknown' && (await get(`clientScreens/${s8}`)).request?.id === q8.id && pis[q8.paymentIntentId].status === 'requires_payment_method', 'a cancel that didn’t reach Stripe leaves the payment open and says to try again', c8.body);
  const sp8 = await closeScreenPaymentsFor(db, 't1', 'pc1');
  ok(sp8.unknown === 1 && sp8.open[0]?.state === 'unknown' && (await get(`clientScreens/${s8}`)).request?.id === q8.id, 'settling the sale doesn’t count it as called off either');
  await db.doc(`clientScreens/${s8}`).update({ 'request.expiresAt': new Date(Date.now() - 1000).toISOString() });
  const e8 = await screen(req({ action: 'pay_view', screenId: s8, requestId: q8.id })) as any;
  ok(e8.status === 503 && (await get(`clientScreens/${s8}`)).request?.id === q8.id, 'nor does timing out');
  failCancel.delete(q8.paymentIntentId); pis[q8.paymentIntentId].status = 'canceled'; failCancel.add(q8.paymentIntentId);
  const { closeOpenPayment } = await import('../../src/lib/screen-pay');
  ok(await closeOpenPayment(db, await get(`clientScreens/${s8}`), 'test') === 'cancelled', 'once Stripe says it’s canceled, it counts as called off'); failCancel.clear();
  // Two people paying their shares of a split at once, on two screens: asking for one never calls off the other.
  await fresh();
  await db.doc(`${T}/pendingCheckouts/pc1`).set({ id: 'pc1', status: 'prepared', clientId: 'c1', split: true }, { merge: true });
  await db.doc('clientScreens/ipad0000000000000000000000000000').set({ tenantId: 't1', name: 'Front iPad', phase: 'idle', request: null });
  const sh1 = await call({ action: 'request', screenId: 'ipad0000000000000000000000000000', kind: 'pay', amount: 20, clientId: 'c1', splitPendingId: 'pc1', shareLabel: 'Dana' });
  const s9 = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  const sh2 = await call({ action: 'request', screenId: s9, kind: 'pay', amount: 30, clientId: 'c1', splitPendingId: 'pc1', shareLabel: 'Sam' });
  ok(sh1.body.ok && sh2.body.ok && (await get('clientScreens/ipad0000000000000000000000000000')).request?.kind === 'pay', 'two shares of a split can be paid at once on two screens', { sh1: sh1.body, sh2: sh2.body });

  // Open too long: called off when it's next looked at; one paid just before it closed is still confirmed.
  await fresh();
  const s6 = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  const r6 = await call({ action: 'request', screenId: s6, kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1' });
  await db.doc(`clientScreens/${s6}`).update({ 'request.expiresAt': new Date(Date.now() - 1000).toISOString() });
  const v6: any = await visitView(getReq('token=tokVisit1'));
  ok(!v6.body.view.pay?.open, 'past its time, the visit link no longer offers it');
  const pi6 = (await get(`clientScreens/${s6}`)).request.paymentIntentId;
  const pv6 = await screen(req({ action: 'pay_view', screenId: s6, requestId: r6.body.requestId })) as any;
  ok(pv6.status === 409 && pv6.body.code === 'expired' && pis[pi6].status === 'canceled' && (await get(`clientScreens/${s6}`)).request === null && (await get(`clientScreens/${s6}`)).response?.abandoned === true, 'and opening it then calls it off at Stripe (the desk hears it wasn’t paid)', pv6.body);
  await fresh();
  const s7 = (await call({ action: 'visit_screen', appointmentId: 'a1' })).body.screenId;
  const r7 = await call({ action: 'request', screenId: s7, kind: 'pay', amount: 50, clientId: 'c1', pendingId: 'pc1' });
  const pi7 = (await get(`clientScreens/${s7}`)).request.paymentIntentId; pis[pi7].status = 'succeeded';
  await db.doc(`clientScreens/${s7}`).update({ 'request.expiresAt': new Date(Date.now() - 1000).toISOString() });
  const pv7 = await screen(req({ action: 'pay_view', screenId: s7, requestId: r7.body.requestId })) as any;
  const d7 = await screen(req({ action: 'pay_done', screenId: s7, requestId: r7.body.requestId })) as any;
  ok(pv7.body.code === 'expired' && (await get(`clientScreens/${s7}`)).response?.paid === true && d7.body.ok, 'paid just as it timed out: it counts as paid, and their phone is told so', { pv7: pv7.body, d7: d7.body });

  // ── The screens ─────────────────────────────────────────────────────────
  const pay = src('src/components/visit/VisitPay.tsx');
  ok(pay.includes("call({ action: 'pay_tip', screenId, requestId: q.id, tip })") && pay.includes('await elements?.fetchUpdates()') && pay.includes("call({ action: 'pay_done', screenId, requestId })") && pay.includes("redirect: 'if_required'"), 'the visit link pays the way the iPad does: tip on the server, Stripe’s form brought up to date, confirmed with Stripe');
  ok(/pay_save[\s\S]{0,260}await elements\.fetchUpdates\(\)/.test(pay) && pay.includes("disabled={busy || slow || tipBusy || needTip || !stripe}") && pay.includes("Please don’t pay again: this page updates by itself once it’s through"), 'still going through at the bank: Pay stays off and it says not to pay again (and saving the card is brought into Stripe’s form)');
  ok(pay.includes("status === 'failed'") && pay.includes('That payment didn’t go through, and nothing was charged.') && pay.includes('{!busy && !slow && <VisitButton quiet onClick={onClose}>Back to your visit</VisitButton>}'), 'back from a bank that said no, it says so; and they can go back to their visit, except while paying or while it goes through');
  ok(pay.includes("if (['not_paid', 'mismatch', 'closed'].includes(d?.code)) return { ok: false, final: d.code, error: d.error };") && (pay.match(/outcome\(c\)/g) || []).length === 2 && pay.includes("if (d?.code === 'processing') { setSlow(true); setBackNote(SLOW); follow(); }"), 'only the server’s own answer ends the wait (a dropped connection is asked again), and both ways in read it the same way');
  ok(pay.includes('setView(null); setViewErr(null); setSlow(false); setBusy(false); setBackNote(null);'), 'a new payment starts clean, with nothing held over from the one before');
  ok(pay.includes("void call({ action: 'pay_done', screenId, requestId: q.id }).then((d: any) =>") && pay.includes("i < 5 ? 1500 : i < 30 ? 5000 : 15000"), 'each time it opens it asks whether they’ve already paid, and it keeps following a slow payment until it’s through');
  ok(pay.includes("row('Store credit'") && pay.includes("row('Card fee'") && src('src/app/api/client-screen/route.ts').includes('credit: num(tk.credit), fee: num(tk.fee)'), 'the bill adds up: store credit and any card fee are on it');
  ok(pay.includes("needTip ? 'Choose a tip to continue'") && pay.includes('`Tips go to ${provider} in full.`') && pay.includes("q.tipsDirect"), 'a tip is chosen (No tip included) before paying, and “in full” is only said when tips go straight to the provider');
  ok(pay.includes("['payment_intent', 'payment_intent_client_secret', 'redirect_status', 'paid'].forEach") && pay.includes("theme: night ? 'night' : 'stripe'"), 'back from a payment that opened another page, it’s confirmed here; Stripe’s form follows Night');
  const page = src('src/app/check-in/[token]/page.tsx');
  ok(page.includes("payInfo?.open === true") && page.includes('<VisitPay brand={brandOf(tenant, tenantId') && page.includes('fastPoll.current ? 8000 : 20000') && page.includes("useEffect(() => { if (payOpen) setPayScreen(payOpen); }, [payKey]);"), 'the visit link opens on Pay when a total is waiting (each one once), and looks every 8 seconds while they’re in or around their time');
  ok(page.includes('Your total is ready') && page.includes('<VisitTop.Provider value={payTop}>') && page.includes('Pay now'), 'stepped back to their visit: “Your total is ready · Pay now” waits at the top');
  ok(page.includes('if (!over || verifyFirst || revoked || payScreen || payOpen) return;'), 'a finished visit never jumps on to their next booking while they’re paying or on the thank-you');
  const hub = src('src/components/pos/CheckoutHub.tsx');
  ok(hub.includes('const vs = useVisitScreen(tenantId);') && hub.includes("sendPayToScreen('visit')") && hub.includes('{payOnVisitOn && <button type="button" onClick={startPayOnPhone}'), 'checkout: “Send to Dana’s phone”, with or without an iPad');
  ok(hub.includes("const pt = payVia === 'visit' ? vs : cs;") && hub.includes('useEffect(() => { const r = pt.response; if (!r || !payReq') && hub.includes("[cs.response?.requestId, vs.response?.requestId, vs.response?.paid]"), 'its answer is handled exactly like the iPad’s (the sale saves itself with the payment)');
  ok((hub.match(/cancelPayOn\(/g) || []).length >= 4 && !/cs\.ask\('idle'\); \}\} className="h-11 rounded-full px-4 text-\[14px\]" style=\{\{ background: 'var\(--card\)' \}\}>Cancel/.test(hub) && hub.includes("toast(r?.code === 'screen_processing' ? { title: 'Their payment is still going through'"), 'switching payment type, switching client, or Cancel takes it off their phone; one still going through keeps the desk waiting');
  ok(hub.includes('useEffect(() => () => { leaveRef.current?.(); }, []);') && hub.includes("leaveRef.current = payVia === 'visit' && payReq && vs.screenId"), 'closing checkout while they’re paying on their phone calls it off');
  ok(hub.includes("toast({ title: 'The payment on their phone timed out'") && hub.includes('vs.request?.expiresAt'), 'the desk hears when it times out on their phone');
  ok(hub.includes('if (sending.current || canceling.current) return; sending.current = true;') && hub.includes('if (ticketKeyRef.current !== forKey) return;'), 'one send at a time, and never for a sale that changed while it was on its way');
  ok(hub.includes("reachBy === 'text' ? 'We text them their visit link' : reachBy === 'email' ? 'We email them their visit link' : 'It opens on their visit link'") && hub.includes('!!visitAppt?.checkInToken && !visitAppt?.linkRevokedAt && !visitAppt?.isRenterBooking'), 'the row says how it reaches them, and only shows for a visit with a link that’s on (not a renter’s)');
  const complete = src('src/app/api/checkout/complete/route.ts');
  ok(complete.includes("await closeScreenPaymentsFor(db, tenantId, pendingRef.id, { why: 'the sale was saved' })") && complete.includes("if (sc?.kind === 'visit' && sc.tenantId === tenantId && (!sc.request || sc.request.answeredAt)) await sRef.update({ request: null, ticket: null"), 'once the sale is saved, nothing is left open for it on any screen, and their phone lets go of the bill');
  ok(complete.includes("code: 'screen_processing'") && complete.includes('Date.now() - Date.parse(x.at || \'\') < 2 * 3600e3'), 'a manager can’t record or discard a sale while a payment for it is going through (one going through for hours doesn’t hold it up)');
  ok(complete.indexOf("await closeScreenPaymentsFor(db, tenantId, pendingRef.id, { why: 'the desk took the payment another way', exceptPi: incomingPi || null })") > 0
    && complete.indexOf("why: 'the desk took the payment another way'") < complete.indexOf('const ticketPaid = ticketPayment(ticket0);'), 'a sale saved another way calls off any screen payment for it first, before anything is taken (never paid twice)');
  ok(hub.includes("if (r?.ok) return true;\n      if (keep) { setPayVia(via); setPayReq(keep); }") && hub.includes("if (sending.current || canceling.current) return;") && hub.includes("canceling.current = true; setSendingVia('cancel');") && hub.includes("if (!r?.ok) { t = setTimeout(tryClose, 30000); return; }"), 'the desk only treats it as called off when the server says so, on the iPad and their phone (keeps trying when it times out, and sends nothing new meanwhile)');
  ok(hub.includes("disabled={isCartEmpty || amountToCharge <= 0 || !!sendingVia}") && hub.includes("'Sending their total…'") && hub.includes("'The sale changed while it was being sent'"), 'while it’s on its way the rows wait and say so; a sale changed meanwhile is called off and the desk is told');
  ok(!/variant: 'destructive', duration: 20000, title: d\?\.via/.test(hub), 'the late-payment notice is a notice, not red');
  ok(src('src/app/api/appt/route.ts').includes("closeOpenPayment(db, sc, 'the visit link was turned off')"), '“Not you?” calls off a payment open on that link');
  const route = src('src/app/api/client-screen/route.ts');
  ok(route.includes(".then(() => true).catch((e: any) => e?.code === 6 || /already exists/i.test(String(e?.message || '')));") && route.includes("if (!made) return NextResponse.json({ ok: false, error: 'Their phone couldn’t be set up for this just now."), 'the phone’s screen is made once; any other failure making it is said, never hidden');
  ok(!/cancelled it|the desk cancelled/.test(route), 'sale notes say canceled');
  const { MESSAGE_KINDS }: any = await import('../../src/lib/message-policy').catch(() => ({}));
  ok(src('src/lib/message-policy.ts').includes("id: 'visit_pay', group: 'Money', label: 'Your total is ready'") && (!MESSAGE_KINDS || MESSAGE_KINDS.some?.((k: any) => k.id === 'visit_pay')), '“Your total is ready” is in Settings → Messages');
  const rules = src('firestore.rules');
  ok(/match \/clientScreens\/\{screenId\} \{[\s\S]*?allow get: if true;\s*allow list: if false;/.test(rules), 'a screen opens by its secret id, and screens can never be listed');
  const { VisitPay } = await import('../../src/components/visit/VisitPay');
  ok(text(html(<VisitPay brand={{ accent: '#8b5e57' }} screenId="x" first="Dana" onClose={() => {}} />)).includes('Getting your total'), 'while it opens, it says so');
  const tool = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(['src/components/visit/VisitPay.tsx', 'src/components/pos/ClientScreen.tsx', 'src/app/api/client-screen/route.ts'].every((p) => !tool.test(src(p)) && !/[\u{1F300}-\u{1FAFF}\u{2728}]/u.test(src(p)) && !/call us/i.test(src(p))) && !/uppercase|\{\/\*/.test(pay), 'no tool names, emojis, “call us”, all-caps or JSX comments');

  if (bad) { console.error(`\n${bad} failed`); process.exit(1); }
  console.log('\nvisit pay: all good');
})();
