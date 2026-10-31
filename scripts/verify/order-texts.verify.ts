// Checks row 15, part 4: a customer's text lands on their order, store credit for the trouble is given on the order
// by the server, and the old Message inbox is retired.
//   - texts (lib/order-texts, api/sms/inbound): a number matching a paid order from the last 30 days joins that order's
//     case (or starts one), on the order and in Problems; an appointment text, or a client with an appointment coming up
//     and no order news lately, stays with the appointments side; a thank-you doesn't reopen a finished case;
//   - store credit (lib/goodwill-credit, api/retail/fulfil giveCredit): managers any amount, anyone else up to the
//     shop's limit on the order, once per key, kept by email, on the order's history; no browser adds credit (the rules);
//   - the old inbox's other jobs move to the order and Problems: reply drafts, notes about a customer.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-texts.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
const afterJobs: Promise<any>[] = [];
const fetched: any[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async (url: string, init: any) => { fetched.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };

const T = 'tenants/t1';
const NOW = Date.parse('2026-10-31T16:00:00Z');
const ago = (d: number) => new Date(NOW - d * 864e5).toISOString();
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };

(async () => {
  const OT = await import('../../src/lib/order-texts');
  const fresh = async () => {
    db = strictTransactions(makeDb());
    await db.doc(T).set({ name: 'Opal', retailSettings: {} });
    await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1209, stage: 'shipped', method: 'ship', customerName: 'Jordan Tate', customerEmail: 'jordan@example.com', customerPhone: '(832) 555-0137', placedAt: ago(5), paidAt: ago(5), qrToken: 'o1.tok', lines: [] });
    await db.doc(`${T}/retailOrders/o0`).set({ id: 'o0', orderNumber: 1100, stage: 'completed', customerName: 'Jordan Tate', customerPhone: '832-555-0137', placedAt: ago(45), paidAt: ago(45), lines: [] });
    await db.doc(`${T}/retailOrders/oX`).set({ id: 'oX', orderNumber: 1210, stage: 'placed', customerName: 'Jordan Tate', customerPhone: '8325550137', placedAt: ago(1), lines: [] });
    // A checkout they left: lapsed, never paid.
    await db.doc(`${T}/retailOrders/oD`).set({ id: 'oD', stage: 'cancelled', isDraft: true, customerName: 'Jordan Tate', customerPhone: '8325550137', placedAt: ago(0.5), lines: [] });
  };
  const sent = (id: string, o: any) => db.doc(`${T}/messageLog/${id}`).set({ to: '+18325550137', channel: 'sms', status: 'sent', sentAt: ago(1), ...o });

  const PVx = await import('../../src/lib/problems-view');
  console.log('a text about an order');
  await fresh();
  await sent('m0', { kind: 'order_shipped', orderId: 'o1' });
  let r = await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'Hi, did my lamp ship yet?', sid: 'SM1', now: NOW });
  let cases = await all(`${T}/retailSupport`);
  check('a reply to the shop’s text about their order starts a case on it (never an unpaid checkout or one they left, never an older order)', !!r && r.orderId === 'o1' && r.created && cases.length === 1 && cases[0].orderId === 'o1' && cases[0].via === 'sms' && cases[0].message === 'Hi, did my lamp ship yet?' && cases[0].status === 'open' && cases[0].customerMessagesSinceStaffReply === 1 && cases[0].caseRef === '1209-1', { r, cases });
  const notes = await all(`${T}/notifications`);
  check('…the team is told, and it opens the order in Problems; the order’s history has it', notes.some((n: any) => n.link === '/retail-orders/problems?order=o1' && /Jordan texted about order #1209/.test(n.message)) && (await all(`${T}/retailOrders/o1/events`)).some((e: any) => e.meta?.kind === 'customer_text'), notes);
  const ib = await get(`${T}/smsInbox/sms_SM1`);
  check('…kept in the studio’s record of texts too (their conversation, the evening report), marked as answered on the order', ib?.routedOrderId === 'o1' && !!ib.readAt && ib.body === 'Hi, did my lamp ship yet?' && /\.filter\(\(m: any\) => !m\.routedOrderId\)/.test(src('src/app/api/inbox/route.ts')), ib);
  r = await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'Hi, did my lamp ship yet?', sid: 'SM1', now: NOW + 5e3 });
  check('Twilio sending the same text again: kept once', !!r?.duplicate && (await get(`${T}/retailSupport/${cases[0].id}`)).followUps.length === 0 && (await all(`${T}/notifications`)).length === notes.length);
  r = await OT.textIntoOrder(db, 't1', { from: '8325550137', body: 'This is ridiculous, it has been a week', mediaCount: 2, mediaUrls: ['https://api.twilio.com/m/1', 'http://bad'], sid: 'SM2', now: NOW + 60e3 });
  cases = await all(`${T}/retailSupport`);
  check('a second text joins the open case (no new case), counts as waiting on the shop, and an angry one is marked urgent; its photos are kept', !!r && !r.created && cases.length === 1 && cases[0].followUps.length === 1 && cases[0].followUps[0].kind === 'sms' && cases[0].followUps[0].message === 'This is ridiculous, it has been a week' && cases[0].followUps[0].smsPhotos === 2 && /2 photos sent by text: open them in the shop’s Twilio messages/.test(PVx.threadOf(cases[0])[1].text) && cases[0].followUps[0].mediaUrls?.join() === 'https://api.twilio.com/m/1' && cases[0].customerMessagesSinceStaffReply === 2 && cases[0].priority === 'urgent', cases[0]);
  await db.doc(`${T}/retailSupport/${cases[0].id}`).set({ replies: [{ by: 'Kai', text: 'So sorry, it ships today.', at: new Date(NOW + 90e3).toISOString() }], customerMessagesSinceStaffReply: 0 }, { merge: true });
  let before = (await all(`${T}/notifications`)).length;
  r = await OT.textIntoOrder(db, 't1', { from: '8325550137', body: 'ok thank you :)', sid: 'SM3', now: NOW + 100e3 });
  let c0 = await get(`${T}/retailSupport/${cases[0].id}`);
  check('a thank-you after the shop’s reply is kept, without waiting on the shop or telling anyone', !!r && r.quiet && c0.customerMessagesSinceStaffReply === 0 && c0.followUps.length === 2 && c0.followUps[1].quiet === true && (await all(`${T}/notifications`)).length === before, { r, c0 });
  r = await OT.textIntoOrder(db, 't1', { from: '8325550137', body: 'Thanks so much!', sid: 'SM3b', now: NOW + 110e3 });
  c0 = await get(`${T}/retailSupport/${cases[0].id}`);
  const grp = PVx.buildProblems({ orders: [], knownOrders: [await get(`${T}/retailOrders/o1`)], tickets: [{ ...c0, id: cases[0].id }], now: NOW + 120e3 });
  const OTx = await import('../../src/lib/order-thread');
  check('…a second one too, and Problems and the order show it as waiting on them, not on the shop', !!r && r.quiet && c0.customerMessagesSinceStaffReply === 0 && grp[0]?.items[0]?.waiting === true && /Waiting on Jordan/.test(grp[0].items[0].title) && OTx.waitingOnShop(OTx.conversationOf([], [c0]), [c0]) === false, grp[0]?.items[0]);
  await db.doc(`${T}/retailSupport/${cases[0].id}`).set({ status: 'resolved', resolvedAt: new Date(NOW + 120e3).toISOString(), resolvedBy: 'Kai' }, { merge: true });
  r = await OT.textIntoOrder(db, 't1', { from: '8325550137', body: 'Thanks!!', sid: 'SM4', now: NOW + 180e3 });
  c0 = await get(`${T}/retailSupport/${cases[0].id}`);
  check('…and after it’s finished: kept, never reopened', !!r && r.quiet && c0.status === 'resolved' && c0.followUps.length === 4 && (await all(`${T}/notifications`)).length === before, { r, c0 });
  r = await OT.textIntoOrder(db, 't1', { from: '8325550137', body: 'Actually the box was damaged', sid: 'SM5', now: NOW + 240e3 });
  c0 = await get(`${T}/retailSupport/${cases[0].id}`);
  check('…anything else reopens it, waiting on the shop', !!r && r.reopened && c0.status === 'open' && c0.customerMessagesSinceStaffReply === 1 && c0.resolvedAt === null && c0.resolvedBy === null);
  check('a number on no recent order isn’t about an order', (await OT.textIntoOrder(db, 't1', { from: '+17135550100', body: 'hello', now: NOW })) === null);
  await fresh();
  before = (await all(`${T}/notifications`)).length;
  r = await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'Thank you!', sid: 'SM6', now: NOW });
  check('a thank-you with no conversation yet starts nothing and pings no one (it’s kept with their texts)', !!r && r.quiet && !r.caseId && !(await all(`${T}/retailSupport`)).length && (await all(`${T}/notifications`)).length === before && !!(await get(`${T}/smsInbox/sms_SM6`)));
  check('…a thank-you in its many forms', ['thx', 'Got it, thanks', 'Ok thank you', 'Thanks :)', 'ty!', 'Perfect, thank you so much', 'great thanks'].every((x) => OT.justThanks(x)) && !OT.justThanks('Thanks but it never came') && !OT.justThanks('ok where is it'));
  await fresh();
  await Promise.all([OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'Where is it?', sid: 'SMa', now: NOW }), OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'Hello?', sid: 'SMb', now: NOW })]);
  cases = await all(`${T}/retailSupport`);
  check('two texts at the same moment start one case, not two', cases.length === 1 && cases[0].followUps.length === 1, cases.map((c: any) => c.caseRef));

  console.log('whose text is it');
  await fresh();
  await sent('m1', { kind: 'appt_reminder', appointmentId: 'a1' });
  check('answering an appointment text: it stays with the appointments side', (await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'See you then', now: NOW })) === null && !(await all(`${T}/retailSupport`)).length);
  await fresh();
  await sent('m1', { kind: 'opportunity' });
  check('…answering an offer, or anything else that isn’t about an order (YES to an opening still books it)', (await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'YES', clientId: 'cl1', now: NOW })) === null);
  await fresh();
  check('…a client the studio knows, with nothing texted lately: the studio’s', (await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'Can I book a fill Friday?', clientId: 'cl1', now: NOW })) === null);
  await sent('m2', { kind: 'order_ready', status: 'failed', sentAt: ago(0.2) });
  check('…a text that didn’t go out doesn’t count', (await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'hi', clientId: 'cl1', now: NOW })) === null);
  await db.doc(`${T}/retailOrders/o2`).set({ id: 'o2', orderNumber: 1215, stage: 'ready', method: 'pickup', customerName: 'Jordan Tate', customerPhone: '8325550137', placedAt: ago(2), paidAt: ago(2), lines: [] });
  await sent('m3', { kind: 'order_uncollected', orderId: 'o1', sentAt: ago(0.1) });
  r = await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'Coming tomorrow', clientId: 'cl1', now: NOW });
  check('…answering the shop’s text about an order: the order that text was about, even with a newer one', !!r && r.orderId === 'o1');
  await sent('m4', { kind: 'order_short', sentAt: ago(0.05) });
  r = await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'Which item?', clientId: 'cl1', now: NOW });
  check('…about an order it can’t name: their newest', !!r && r.orderId === 'o2');
  await fresh();
  await db.doc(`${T}/retailOrders/oP`).set({ id: 'oP', orderNumber: 1001, stage: 'paid', preorder: true, customerName: 'Jordan Tate', customerPhone: '8325550137', placedAt: ago(70), paidAt: ago(70), lines: [] });
  await sent('m5', { kind: 'preorder_eta', orderId: 'oP' });
  r = await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'Any news?', now: NOW });
  check('…a pre-order still on its way however long ago it was placed', !!r && r.orderId === 'oP');
  await fresh();
  await db.doc(`${T}/retailOrders/oOld`).set({ id: 'oOld', orderNumber: 1050, stage: 'completed', customerName: 'Jordan Tate', customerPhone: '8325550137', placedAt: ago(60), paidAt: ago(60), lines: [] });
  await sent('m6', { kind: 'return_received', orderId: 'oOld' });
  r = await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'When does the refund show?', now: NOW });
  check('…answering a text about an older order: that order, never a newer one in its place', !!r && r.orderId === 'oOld');
  await fresh();
  await sent('m7', { kind: 'appt_reminder', appointmentId: 'a1', sentAt: ago(2) });
  await db.doc(`${T}/messageLog/m8`).set({ to: '+18325550137', channel: 'order_page', kind: 'order_ready', recipientId: 'o1', status: 'sent', sentAt: ago(1) });
  await sent('m9', { kind: 'order_ready', orderId: 'o1', sentAt: ago(0.5), bouncedAt: ago(0.4) });
  check('…only texts that really went out count (a post on the order page, or one that bounced, isn’t a text)', (await OT.textIntoOrder(db, 't1', { from: '+18325550137', body: 'C', clientId: 'cl1', now: NOW })) === null);
  check('the order a text is about is kept with it, so a reply can find its way back (every text the shop sends about an order)', /orderId: meta\?\.orderId \|\| null,/.test(src('src/lib/sms.ts')) && /orderId: input\.orderId \|\| null,/.test(src('src/lib/notify.ts')) && /sendNudge\(\{ \.\.\.input, orderId, viaOrderPage: true, channel: 'sms'/.test(src('src/lib/order-inbox.ts')) && /\{ kind: moment === 'ready' \? 'curbside_ready' : 'curbside_out', orderId \}/.test(src('src/app/api/retail/curbside-notify/route.ts')));
  const route = src('src/app/api/sms/inbound/route.ts');
  check('the shop’s number sends a customer’s text to their order before the studio’s inbox (STOP and HELP stay), with its id and photos', /const \{ textIntoOrder \} = await import\('@\/lib\/order-texts'\); if \(await textIntoOrder\(db, tenantId, \{ from, body, mediaCount, mediaUrls, clientId, senderName: clientId \? senderName : null, sid: String\(params\.MessageSid \|\| params\.SmsSid \|\| ''\) \}\)\) return twimlOk\(\);/.test(route) && route.indexOf('textIntoOrder') < route.indexOf('smsInbox`).doc()') && route.indexOf('textIntoOrder') > route.indexOf('smsOptOuts'));
  const PV = await import('../../src/lib/problems-view');
  const OTH = await import('../../src/lib/order-thread');
  const t = { id: 't9', message: 'Did it ship?', via: 'sms', createdAt: ago(1), autoReply: 'Your order is on its way.', photoUrls: ['https://x.example/p.jpg'], followUps: [{ at: ago(0.5), message: 'Hello?', kind: 'sms' }, { at: ago(0.2), message: 'Re: order', kind: 'email' }, { at: ago(0.1), message: 'Any update', kind: 'chaser' }] };
  check('Problems and the order say how each one reached the shop (by text, by email), with their photos and what they were told straight away', PV.threadOf(t).map((m: any) => m.via || (m.chaser ? 'chaser' : '-')).join() === 'text,text,email,chaser' && PV.threadOf(t)[0].photos?.[0] === 'https://x.example/p.jpg' && OTH.conversationOf([], [t]).map((m: any) => m.via || '-').join() === 'text,text,email,-' && /m\.via === 'text' \? 'By text · '/.test(src('src/components/orders/ProblemPanel.tsx')) && /m\.via === 'text' \? 'By text · '/.test(src('src/components/orders/workspace/CustomerPane.tsx')) && /They were told straight away/.test(src('src/components/orders/ProblemPanel.tsx')));
  check('Problems reads the finished order a message is on (its email, for store credit)', /\[\.\.\.returns, \.\.\.holds, \.\.\.claims, \.\.\.tickets\]/.test(src('src/components/orders/ProblemsApp.tsx')));

  console.log('store credit for the trouble');
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (args: any) => { const res: any = await POST(req({ tenantId: 't1', action: 'giveCredit', ...args })); await settle(); return res; };
  await fresh();
  fetched.length = 0;
  let s = await step({ orderId: 'o1', cents: 1500, key: 'k-one', note: 'Parcel was a week late', ticketId: 't9' });
  const cr = await get(`${T}/depositCredits/goodwill_o1_k-one`);
  check('given on the order by the server: kept by their email, ready at checkout, with who gave it and why', s.body.ok && cr?.clientEmail === 'jordan@example.com' && cr.amountCents === 1500 && cr.kind === 'store_credit' && cr.status === 'available' && cr.source === 'goodwill' && cr.issuedBy === 'Kai Park' && cr.retailOrderId === 'o1' && cr.note === 'Parcel was a week late' && cr.sourceSupportTicketId === 't9' && (await get(`${T}/retailOrders/o1`)).goodwillCents === 1500, { s: s.body, cr });
  check('…on the order’s history, and they get their balance by email straight after', (await all(`${T}/retailOrders/o1/events`)).some((e: any) => e.meta?.kind === 'goodwill_credit' && /\$15\.00 store credit given by Kai Park: Parcel was a week late/.test(e.meta.text)) && fetched.some((f) => /\/api\/retail\/credit-notify$/.test(f.url) && JSON.parse(f.init.body).creditId === 'goodwill_o1_k-one' && f.init.headers.Authorization === 'Bearer t'), fetched.map((f) => f.url));
  s = await step({ orderId: 'o1', cents: 1500, key: 'k-one' });
  check('asked again with the same key, it’s given once', s.body.ok && s.body.already === true && (await all(`${T}/depositCredits`)).length === 1 && (await get(`${T}/retailOrders/o1`)).goodwillCents === 1500, s.body);
  s = await step({ orderId: 'o1', cents: 1500, key: 'k-two' });
  check('anyone but a manager gives up to the shop’s limit on the order, all told ($25 unless set)', s.status === 403 && /up to \$10\.00 more on this order/.test(s.body.message) && (await all(`${T}/depositCredits`)).length === 1, s.body);
  await db.doc(T).set({ name: 'Opal', retailSettings: { staffCreditCapCents: 0 } });
  s = await step({ orderId: 'o1', cents: 100, key: 'k-three' });
  check('…a shop that sets the limit to $0 keeps it to managers', s.status === 403 && /Only a manager can give store credit here/.test(s.body.message), s.body);
  actor = { ...actor, role: 'manager', isManager: true };
  s = await step({ orderId: 'o1', cents: 6000, key: 'k-four' });
  check('a manager gives any amount', s.body.ok && (await get(`${T}/retailOrders/o1`)).goodwillCents === 7500, s.body);
  s = await step({ orderId: 'o1', cents: 0, key: 'k-five' });
  const s2 = await step({ orderId: 'o1', cents: 'lots', key: 'k-six' });
  check('…never $0 or a made-up amount', s.status === 400 && s2.status === 400);
  await db.doc(`${T}/retailOrders/o1`).set({ customerEmail: '' }, { merge: true });
  s = await step({ orderId: 'o1', cents: 500, key: 'k-seven' });
  check('an order with no email: nothing is given (credit is kept by email)', s.status === 422 && /no email/.test(s.body.message));
  actor = { uid: 'k1', name: 'Kai Park', role: 'manager', isManager: true, isTenantOwner: false, caps: [] };
  s = await step({ orderId: 'oD', cents: 500, key: 'k-ten' });
  check('…nor on a checkout that was never paid', s.status === 409 && /never paid/.test(s.body.message), s.body);
  check('the order’s running total can’t be changed from a browser (it’s what holds the limit)', /'goodwillCents', 'textsIn'\]/.test(src('firestore.rules')));
  actor = { uid: 'r1', name: 'Rae', role: 'staff', isRenter: true, isManager: false, isTenantOwner: false, caps: [] };
  const sR = await step({ orderId: 'o1', cents: 500, key: 'k-eight' });
  actor = { uid: 'p1', name: 'Pat', role: 'staff', fulfilmentRole: 'picker', isManager: false, isTenantOwner: false, caps: [] };
  const sP = await step({ orderId: 'o1', cents: 500, key: 'k-nine' });
  check('a renter or a picker doesn’t give the shop’s store credit', sR.status === 403 && sP.status === 403 && /store credit isn’t part of your role/.test(sP.body.message));
  actor = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
  const rules = src('firestore.rules');
  const credits = (rules.match(/match \/tenants\/\{tenantId\}\/depositCredits\/\{creditId\} \{[\s\S]*?\n    \}/) || [''])[0];
  check('no browser adds store credit (the server adds every credit), and the team still sees it', /allow create: if false;/.test(credits) && /allow read: if isStaff\(tenantId\);/.test(credits) && !/staffCreditCapCents/.test(rules));

  console.log('the screens');
  const panel = src('src/components/orders/ProblemPanel.tsx');
  const sheet = src('src/components/orders/GoodwillSheet.tsx');
  check('a message in Problems: draft a reply, or give store credit (said in the reply too)', /fetch\('\/api\/retail\/support-draft'/.test(panel) && /'Draft a reply'/.test(panel) && /Give store credit<\/button>/.test(panel) && /<GoodwillSheet tenantId=\{tenantId\} order=\{order\} ticketId=\{p\.ref\.id\}/.test(panel) && /I’ve added \$\{money\(c\)\} in store credit for the trouble/.test(panel));
  check('…the order’s More gives store credit too, for those who can', /\{canCredit && <Btn kind="soft" className="w-full" onClick=\{\(\) => \{ setMore\(false\); setCredit\(true\); \}\}>Give store credit<\/Btn>\}/.test(src('src/components/orders/workspace/OrderWorkspace.tsx')));
  check('the credit sheet: how much (and what this person can still give), why for the team, one key per sheet so a retry gives it once', /giveCredit\(tenantId, order\.id, cents, \{ note: note\.trim\(\), key: key\.current, ticketId \}\)/.test(sheet) && /You can give up to \$\{money\(left\)\} on this order/.test(sheet) && /disabled=\{busy \|\| cents < 1 \|\| over\}/.test(sheet));
  const flagRule = (src('firestore.rules').match(/match \/tenants\/\{tenantId\}\/customerFlags\/\{flagId\} \{[\s\S]*?\n    \}/) || [''])[0];
  check('notes about a customer: the team adds them, only a manager stops (or allows) online checkout, notes are never taken away, none deleted from a browser', /request\.resource\.data\.level == 'watch' \|\| isManager\(tenantId\)/.test(flagRule) && /request\.resource\.data\.reasons\.hasAll\(resource\.data\.get\('reasons', \[\]\)\)/.test(flagRule) && /allow delete: if false;/.test(flagRule) && /'customerFlags', 'retailOffers'/.test(src('firestore.rules')) && /reasons: arrayUnion\(reason\)/.test(src('src/components/orders/CustomerFlag.tsx')) && /\{!stopped && isManager && <Btn kind="danger"/.test(src('src/components/orders/CustomerFlag.tsx')), flagRule);
  check('the checkout and reply drafts heed a stop on any record for the email', /flagSnap\.docs\.some\(\(d: any\) => String\(\(d\.data\(\) as any\)\?\.level\) === 'banned'\)/.test(src('src/app/api/retail/checkout/route.ts')) && /rows\.find\(\(r: any\) => r\.level === 'banned'\)/.test(src('src/app/api/retail/support-draft/route.ts')));
  check('a reply draft answers what they said last, never overwrites what someone typed, and never shows the service’s own error', /THE CONVERSATION SO FAR/.test(src('src/app/api/retail/support-draft/route.ts')) && !/data\?\.error\?\.message \|\| 'AI service error'/.test(src('src/app/api/retail/support-draft/route.ts')) && /\{!text\.trim\(\) && <button type="button" disabled=\{!!busy\} onClick=\{\(\) => void draft\(\)\}/.test(panel));
  check('the team’s notes about a customer live on the order and in Problems (watch, or stop online checkout; the notes are kept)', /<CustomerFlag fs=\{fs\} tenantId=\{tenantId\} email=\{order\.customerEmail\}/.test(src('src/components/orders/workspace/CustomerPane.tsx')) && /<CustomerFlag fs=\{fs\} tenantId=\{tenantId\} email=\{o\.customerEmail\}/.test(panel) && /Save and stop online checkout/.test(src('src/components/orders/CustomerFlag.tsx')) && /level: 'watch', updatedAt/.test(src('src/components/orders/CustomerFlag.tsx')));
  check('the old Message inbox sends people to Problems, and nothing links to it', /redirect\('\/retail-orders\/problems\?show=messages'\)/.test(src('src/app/(app)/retail-orders/support/page.tsx')) && !/'use client'/.test(src('src/app/(app)/retail-orders/support/page.tsx')) && !/retail-orders\/support/.test(src('src/components/orders/SetupScreen.tsx')));
  check('Policies says the staff limit is for the whole order', /note="On each order, all told\. Managers have no limit\."/.test(src('src/components/orders/PoliciesScreen.tsx')));
  const words = panel + sheet + src('src/components/orders/CustomerFlag.tsx') + src('src/lib/order-texts.ts') + src('src/lib/goodwill-credit.ts') + src('src/app/(app)/retail-orders/support/page.tsx');
  check('the words: no mention of the tool (the draft route’s message too), no "call us", US spelling, no JSX comments, no emojis', !new RegExp(['cl', 'aude|anth', 'ropic'].join(''), 'i').test(words) && /error: 'Reply drafts aren’t set up yet\./.test(src('src/app/api/retail/support-draft/route.ts')) && !/call us/i.test(words) && !/cancelled/.test(words.replace(/'cancelled'/g, '')) && !/\{\/\*/.test(panel + sheet + src('src/components/orders/CustomerFlag.tsx')) && !/[\u{1F300}-\u{1FAFF}]/u.test(words));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
