// Checks Phase B, round 4: the messages an order step sends are queued on the server and tried again until they go
// (lib/order-outbox).
//   - one message per step: the same step queued twice is one message; sent by one server at a time;
//   - a message that went is done; one the service didn't take is tried again later (a little later each time), and
//     after its last try the team sees on the order that the customer wasn't told;
//   - each message's route gives its once-only mark back when the send failed, and says to try again, so a retry can
//     send it; a message switched off by the shop isn't retried;
//   - the steps queue their messages on the server before they answer (ready, curbside, missing item, shipped with
//     tracking typed in, a return settled, a report decided); no screen sends a step's message itself;
//   - the five-minute job sends what's due, and the nightly job clears old ones; nobody reads the queue from a browser.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-outbox.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.CRON_SECRET = 'test-secret';
let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const afterJobs: Promise<any>[] = [];
let notifyResult: any = { ok: true, status: 'sent' };
const notified: any[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor: { uid: 'k1', name: 'Kai Park', role: 'manager', isManager: true, isTenantOwner: false, caps: [] }, tenant: {} }) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, input: any) => { notified.push(input); return typeof notifyResult === 'function' ? notifyResult(input) : notifyResult; } });
  if (request === '@/lib/email-shell' || /\/src\/lib\/email-shell(\.ts)?$/.test(request)) return fake(request, { getEmailBrand: async () => ({ shopName: 'Opal' }), brandedEmail: (_b: any, html: string) => html, emailButton: () => '' });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const routeRule0 = (p: string, re: RegExp) => re.test(src(p));
const answer = (status: number, body: any) => async () => ({ ok: status < 300, status, json: async () => body }) as any;
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, nextUrl: { origin: 'https://app.example' } }) as any;

(async () => {
  const OB = await import('../../src/lib/order-outbox');
  const OE = await import('../../src/lib/order-events');
  const RO = await import('../../src/lib/retail-orders');

  // ── One message per step ──
  const a = await OB.queueMessage(db, 't1', 'order_ready', { orderId: 'o1' });
  const b = await OB.queueMessage(db, 't1', 'order_ready', { orderId: 'o1' });
  check('the same step queued twice is one message', a === b && (await all('messageOutbox')).length === 1 && (await get(`messageOutbox/${a}`)).status === 'queued');
  check('…and a different item is its own message', (await OB.queueMessage(db, 't1', 'order_short', { orderId: 'o1', lineId: 'A' })) !== (await OB.queueMessage(db, 't1', 'order_short', { orderId: 'o1', lineId: 'B' })));
  check('nothing private is kept in the queue: the order and what to send, no name, contact or sign-in', JSON.stringify(await get(`messageOutbox/${a}`)).match(/customer|email|phone|Bearer|auth/i) === null);
  check('…and a step missing what it needs queues nothing', (await OB.queueMessage(db, 't1', 'order_ready', { orderId: 'a/b' })) === '' && (await OB.queueMessage(db, '', 'order_ready', { orderId: 'o1' })) === '');

  // ── Sent, tried again, or never going ──
  let calls: any[] = [];
  const fetchOk = async (url: any, init: any) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => ({ ok: true, sent: true }) } as any; };
  let r = await OB.deliverMessage(db, a, { base: 'https://app.example', fetchImpl: fetchOk as any });
  let m = await get(`messageOutbox/${a}`);
  check('a message that went is done, and isn’t due again', r === 'sent' && m.status === 'sent' && m.dueAt === null && m.tries === 1 && calls.length === 1 && calls[0].url === 'https://app.example/api/retail/ready-notify', { r, m });
  check('…sent with the server’s key and only what the route needs', calls[0].init.headers['x-cf-internal'] === 'test-secret' && JSON.parse(calls[0].init.body).orderId === 'o1' && JSON.parse(calls[0].init.body).tenantId === 't1');
  check('…and a sent message isn’t sent again', (await OB.deliverMessage(db, a, { base: 'https://app.example', fetchImpl: fetchOk as any })) === 'busy' && calls.length === 1);

  db = strictTransactions(makeDb()); calls = [];
  await db.doc(`${T}/retailOrders/o2`).set({ id: 'o2', stage: 'ready', method: 'counter', lines: [] });
  const id2 = await OB.queueMessage(db, 't1', 'order_ready', { orderId: 'o2' });
  const down = async (url: any) => { calls.push(String(url)); return { ok: false, status: 503, json: async () => ({ ok: false, retry: true, why: 'The text and email services didn’t take it.' }) } as any; };
  r = await OB.deliverMessage(db, id2, { base: 'https://app.example', fetchImpl: down as any });
  m = await get(`messageOutbox/${id2}`);
  const wait1 = Date.parse(m.dueAt) - Date.now();
  check('one the service didn’t take is tried again in about a minute', r === 'retry' && m.status === 'retry' && wait1 > 50e3 && wait1 < 70e3 && /didn’t take/.test(m.lastError), { r, m, wait1 });
  check('…and not before then', (await OB.deliverMessage(db, id2, { base: 'https://app.example', fetchImpl: down as any })) === 'busy' && calls.length === 1);
  const waits: number[] = [];
  for (let i = 2; i <= OB.MAX_TRIES; i++) {
    const due = Date.parse((await get(`messageOutbox/${id2}`)).dueAt);
    r = await OB.deliverMessage(db, id2, { base: 'https://app.example', fetchImpl: down as any, now: due + 1 });
    const d = (await get(`messageOutbox/${id2}`)).dueAt; if (d) waits.push(Date.parse(d) - Date.now());
  }
  m = await get(`messageOutbox/${id2}`);
  check('…a little later each time, six tries in all', waits.length === OB.MAX_TRIES - 2 && waits.every((w, i) => i === 0 || w > waits[i - 1]) && calls.length === OB.MAX_TRIES, { waits, calls: calls.length });
  const failedEv = (await all(`${T}/retailOrders/o2/events`)).find((e: any) => e.type === 'message_failed');
  check('after its last try it’s given up, and the team sees on the order the customer wasn’t told', r === 'failed' && m.status === 'failed' && m.dueAt === null && !!failedEv && OE.eventWords(failedEv).text === 'The ready for pickup message didn’t reach the customer after 6 tries. Let them know on the order page.' && OE.eventWords(failedEv).tone === 'warn', { r, m, failedEv });
  check('…which only the team sees, never the customer', !OE.customerSees(failedEv) && (RO.ORDER_EVENT_TYPES as readonly string[]).includes('message_failed'));

  const id3 = await OB.queueMessage(db, 't1', 'order_shipped', { orderId: 'o2' });
  r = await OB.deliverMessage(db, id3, { base: 'https://app.example', fetchImpl: (async () => { throw new Error('socket hang up'); }) as any });
  check('a request that was cut off is tried again', r === 'retry' && /socket hang up/.test((await get(`messageOutbox/${id3}`)).lastError));
  const id4 = await OB.queueMessage(db, 't1', 'order_short', { orderId: 'o2', lineId: 'A' });
  r = await OB.deliverMessage(db, id4, { base: 'https://app.example', fetchImpl: answer(404, { ok: false, reason: 'line_not_found' }) });
  check('one that can never go (the item isn’t on the order) isn’t tried again', r === 'failed' && (await get(`messageOutbox/${id4}`)).status === 'failed');
  const id5 = await OB.queueMessage(db, 't1', 'curbside_out', { orderId: 'o2' });
  r = await OB.deliverMessage(db, id5, { base: 'https://app.example', fetchImpl: answer(200, { ok: true, sent: false }) });
  check('one there was nothing to send for (already sent, switched off) is done without a send', r === 'skipped' && (await get(`messageOutbox/${id5}`)).status === 'skipped');

  // ── One server at a time ──
  db = strictTransactions(makeDb()); calls = [];
  const id6 = await OB.queueMessage(db, 't1', 'order_ready', { orderId: 'o3' });
  const slow = async (url: any) => { calls.push(String(url)); await new Promise((x) => setTimeout(x, 20)); return { ok: true, status: 200, json: async () => ({ ok: true, sent: true }) } as any; };
  const both = await Promise.all([OB.deliverMessage(db, id6, { base: 'https://app.example', fetchImpl: slow as any }), OB.deliverMessage(db, id6, { base: 'https://app.example', fetchImpl: slow as any })]);
  check('two servers trying the same message at once send it once', calls.length === 1 && both.includes('sent') && both.includes('busy'), { both, calls });
  // A server that stopped mid-send leaves its lease to run out; then it's due again.
  const id7 = await OB.queueMessage(db, 't1', 'order_ready', { orderId: 'o4' });
  await db.doc(`messageOutbox/${id7}`).update({ status: 'sending', tries: 1, dueAt: new Date(Date.now() - 1000).toISOString() });
  check('a message left half-sent by a server that stopped is sent once its lease runs out', (await OB.deliverMessage(db, id7, { base: 'https://app.example', fetchImpl: slow as any })) === 'sent');

  // ── Slow, unreadable or unsendable answers ──
  db = strictTransactions(makeDb());
  const s1 = await OB.queueMessage(db, 't1', 'order_short', { orderId: 'q1', lineId: 'A' });
  await OB.deliverMessage(db, s1, { base: 'https://app.example', fetchImpl: (async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }) as any });
  const slowWait = Date.parse((await get(`messageOutbox/${s1}`)).dueAt) - Date.now();
  check('a route that didn’t answer in time (it may still be sending) isn’t tried again until it has surely finished', slowWait > 5.5 * 60e3, slowWait);
  const s2 = await OB.queueMessage(db, 't1', 'order_ready', { orderId: 'q2' });
  check('an answer that isn’t the route’s own (a sign-in page) isn’t taken as sent', (await OB.deliverMessage(db, s2, { base: 'https://app.example', fetchImpl: (async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } })) as any })) === 'retry');
  const s3r = await OB.queueAndSend(db, 't1', 'order_ready', { orderId: 'q3' }, { base: '' });
  const s3 = (await all('messageOutbox')).find((x: any) => x.orderId === 'q3');
  check('with no address to send from, it’s left queued without spending a try', s3r === 'retry' && s3.tries === 0 && s3.status === 'queued');
  await db.doc(`${T}/retailClaims/c1`).set({ orderId: 'q4' }); await db.doc(`${T}/retailClaims/c2`).set({ orderId: 'q4' });
  for (const c of ['c1', 'c2']) { const id = await OB.queueMessage(db, 't1', 'claim_decided', { claimId: c, key: 'd' }); for (let i = 0; i < OB.MAX_TRIES; i++) await OB.deliverMessage(db, id, { base: 'https://app.example', fetchImpl: answer(503, { retry: true }), now: Date.parse((await get(`messageOutbox/${id}`)).dueAt) + 1 }); }
  check('two messages that failed on one order each keep their own note', (await all(`${T}/retailOrders/q4/events`)).filter((e: any) => e.type === 'message_failed').length === 2);
  check('a route that fails before it could claim the send says to try again (never “done”)', routeRule0('src/app/api/retail/return-notify/route.ts', /The return couldn’t be read just then\.' \}, \{ status: 503 \}/) && routeRule0('src/app/api/retail/curbside-notify/route.ts', /if \(release\) await release\(\);\s*return NextResponse\.json\(\{ ok: false, sent: false, retry: true/) && routeRule0('src/app/api/retail/claim-notify/route.ts', /if \(release\) await release\(\);\s*return NextResponse\.json\(\{ ok: false, sent: false, retry: true/) && routeRule0('src/app/api/retail/ready-notify/route.ts', /if \(!texted && !emailed\) \{ if \(release\) await release\(\);/));
  check('a shipped email the shop switched off isn’t tried again', /reason: skipped \? 'not_sent_by_policy' : 'send_failed'/.test(src('src/lib/shipping-notify.ts')));

  // ── The five-minute and nightly jobs ──
  db = strictTransactions(makeDb()); calls = [];
  const due1 = await OB.queueMessage(db, 't1', 'order_ready', { orderId: 'p1' });
  const later = await OB.queueMessage(db, 't1', 'order_ready', { orderId: 'p2' });
  await db.doc(`messageOutbox/${later}`).update({ status: 'retry', dueAt: new Date(Date.now() + 60e3).toISOString() });
  const drained = await OB.drainOutbox(db, 'https://app.example', { fetchImpl: fetchOk as any });
  check('the five-minute job sends what’s due, and leaves what isn’t yet', drained.sent === 1 && (await get(`messageOutbox/${due1}`)).status === 'sent' && (await get(`messageOutbox/${later}`)).status === 'retry', drained);
  await db.doc(`messageOutbox/${due1}`).update({ doneAt: new Date(Date.now() - 31 * 864e5).toISOString() });
  check('the nightly job clears messages finished over a month ago, never ones still waiting', (await OB.sweepOutbox(db)) === 1 && !(await get(`messageOutbox/${due1}`)) && !!(await get(`messageOutbox/${later}`)));
  check('the five-minute job tries them, the nightly job clears them, and they share the run’s time', /drainOutbox\(db,/.test(src('src/app/api/cron/retail-payments/route.ts')) && /\}, \{ startedAt \}\);/.test(src('src/app/api/cron/retail-payments/route.ts')) && /sweepOutbox\(db\)/.test(src('src/app/api/cron/retail-nightly/route.ts')));

  // ── Each route gives its mark back when the send failed ──
  const internal = { 'x-cf-internal': 'test-secret', 'x-internal-key': 'test-secret' };
  const { POST: READY } = await import('../../src/app/api/retail/ready-notify/route');
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal' });
  await db.doc(`${T}/retailOrders/r1`).set({ id: 'r1', stage: 'ready', method: 'counter', orderNumber: 7, customerName: 'Dana W', customerEmail: 'dana@example.com', customerPhone: '5551234567', lines: [] });
  notifyResult = { ok: false, status: 'failed', error: 'provider down' }; notified.length = 0;
  let rr: any = await READY(req({ tenantId: 't1', orderId: 'r1' }, internal));
  check('ready for pickup: when neither the text nor the email went, the mark is given back and it says to try again', rr.status === 503 && rr.body.retry === true && !(await get(`${T}/retailOrders/r1`)).readyNotifiedAt && notified.length === 2, rr.body);
  notifyResult = { ok: true, status: 'sent' };
  rr = await READY(req({ tenantId: 't1', orderId: 'r1' }, internal));
  check('…so the next try sends it, once', rr.status === 200 && rr.body.sent === true && !!(await get(`${T}/retailOrders/r1`)).readyNotifiedAt && (await READY(req({ tenantId: 't1', orderId: 'r1' }, internal)) as any).body.sent === false);
  await db.doc(`${T}/retailOrders/r2`).set({ id: 'r2', stage: 'ready', method: 'counter', orderNumber: 8, customerName: 'Dana W', customerEmail: 'dana@example.com', lines: [] });
  notifyResult = { ok: false, status: 'skipped_by_policy', error: 'order_ready is switched off' };
  rr = await READY(req({ tenantId: 't1', orderId: 'r2' }, internal));
  check('…but one the shop switched off isn’t tried again', rr.status === 200 && rr.body.retry !== true && !!(await get(`${T}/retailOrders/r2`)).readyNotifiedAt);
  await db.doc(`${T}/retailOrders/r3`).set({ id: 'r3', stage: 'ready', method: 'counter', orderNumber: 9, customerName: 'Dana W', customerEmail: 'dana@example.com', customerPhone: '5551234567', lines: [] });
  notifyResult = (i: any) => (i.channel === 'sms' ? { ok: true, status: 'sent' } : { ok: false, status: 'failed' });
  rr = await READY(req({ tenantId: 't1', orderId: 'r3' }, internal));
  check('…and when the text went but the email didn’t, it isn’t sent twice', rr.status === 200 && rr.body.sent === true && !!(await get(`${T}/retailOrders/r3`)).readyNotifiedAt);
  notifyResult = { ok: true, status: 'sent' };

  const routeRule = (p: string, re: RegExp) => re.test(src(p));
  check('curbside: a text the service didn’t take gives its mark back and says to try again; one that can never go doesn’t', routeRule('src/app/api/retail/curbside-notify/route.ts', /if \(!res\.ok && !FINAL\.test\(String\(res\.error \|\| ''\)\)\) \{ await release\(\); return NextResponse\.json\(\{ ok: false, sent: false, retry: true/) && routeRule('src/app/api/retail/curbside-notify/route.ts', /c\[claimed\.sentKey\] === stamp/));
  check('…and a curbside text tried later never arrives after the moment it’s about', routeRule('src/app/api/retail/curbside-notify/route.ts', /moment === 'ready' && String\(o\.stage\) !== 'ready'\) return null/) && routeRule('src/app/api/retail/curbside-notify/route.ts', /moment === 'out' && !\['ready', 'arrived'\]\.includes\(String\(o\.stage\)\)\) return null/));
  check('missing item, shipped, return settled and report decided: each says to try again when the send failed', routeRule('src/app/api/retail/short-notify/route.ts', /reason: 'send_failed', retry: true \}, \{ status: 503 \}/) && routeRule('src/app/api/retail/shipped-notify/route.ts', /reason === 'send_failed'\) return NextResponse\.json\(\{ ok: false, sent: false, retry: true/) && routeRule('src/app/api/retail/return-notify/route.ts', /r\.status === 'failed'\) \{ await release\(\); return NextResponse\.json\(\{ ok: false, sent: false, retry: true/) && routeRule('src/app/api/retail/claim-notify/route.ts', /r\.status === 'failed'\) \{ await release\(\); return NextResponse\.json\(\{ ok: false, sent: false, retry: true/));
  check('…giving back only their own mark', routeRule('src/app/api/retail/return-notify/route.ts', /outcomeEmailAt === stamp/) && routeRule('src/app/api/retail/claim-notify/route.ts', /notifiedForDecidedAt === decision\.decidedAt/));

  // ── The steps queue their messages on the server, before they answer ──
  const { POST: FULFIL } = await import('../../src/app/api/retail/fulfil/route');
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal', retailSettings: {} });
  await db.doc(`${T}/inventory/gel`).set({ id: 'gel', name: 'Gel polish', type: 'retail', status: 'active', totalStock: 10, stockReserved: 1, batches: [{ id: 'b1', stock: 10, costPerUnit: 4, receivedDate: '2026-01-01' }], barcode: '012345678905' });
  await db.doc(`${T}/retailOrders/f1`).set({ id: 'f1', tenantId: 't1', orderNumber: 1301, stage: 'packed', method: 'counter', lines: [{ lineId: 'A', productId: 'gel', name: 'Gel polish', unitPriceCents: 1500, qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, status: 'picked' }], customerName: 'Dana W', qrToken: 'f1.abcdef', totalCents: 1500 });
  const sent: string[] = [];
  (globalThis as any).fetch = async (url: any) => { sent.push(String(url)); return { ok: true, status: 200, json: async () => ({ ok: true, sent: true }) }; };
  const fr: any = await FULFIL(req({ tenantId: 't1', action: 'markReady', orderId: 'f1' }, { authorization: 'Bearer t' }));
  const queued = (await all('messageOutbox')).find((x: any) => x.kind === 'order_ready' && x.orderId === 'f1');
  check('marking it ready queues the customer’s message before the step answers', fr.body.ok === true && !!queued && queued.status === 'queued', { fr: fr.body, queued });
  await settle();
  check('…and sends it straight after, once', sent.filter((u) => /ready-notify$/.test(u)).length === 1 && (await get(`messageOutbox/${queued.id}`)).status === 'sent');
  const route = src('src/app/api/retail/fulfil/route.ts');
  check('every step’s message goes through the queue (ready, curbside, missing item, shipped, return, report)', !/callRoute/.test(route) && /sendMessage\('order_ready'/.test(route) && /'curbside_ready' : 'curbside_out'/.test(route) && /sendMessage\('order_short'/.test(route) && /sendMessage\('return_outcome'/.test(route) && /sendMessage\('claim_decided', \{ claimId: id, key: String\(c\.decidedAt/.test(route) && /if \(o\.trackingNumber && !o\.shippoTransactionId\) sendMessage\('order_shipped'/.test(route));
  check('…all in the queue before the step answers, even when something after it failed', (route.match(/await Promise\.allSettled\(ctx\(\)\?\.queued \|\| \[\]\);/g) || []).length === 2);
  check('…and an item refunded instead of a swap is told through the queue too', /queueAndSend\(db, tenantId, 'order_short'/.test(src('src/app/api/retail/swap/route.ts')) && /queueAndSend\(db, t, 'order_short'/.test(src('src/lib/retail-swap-server.ts')));
  check('no screen sends a step’s message itself (shipped with tracking typed in, a report decided)', !/shipped-notify|ready-notify/.test(src('src/lib/orders-flow.ts')) && !/claimId: c\.id \}\)/.test(src('src/app/(app)/retail-orders/claims/page.tsx')));

  // ── The queue from a browser ──
  check('nobody reads or writes the queue from a browser', /match \/messageOutbox\/\{id\} \{\s*allow read, write: if false;\s*\}/.test(src('firestore.rules')));
  check('the words: no mention of the tool', !/claude|anthropic/i.test(src('src/lib/order-outbox.ts')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
