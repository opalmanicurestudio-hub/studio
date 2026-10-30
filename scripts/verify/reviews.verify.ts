// scripts/verify/reviews.verify.ts — Row 14: one Reviews screen (mockups 9A to 9D), run for real against the stand-in
// database: Show and Hide (hiding needs a reason, kept with the review, for the people whose role runs marketing), the
// review settings, the customer's review from their order page, the visit reviews a booking page shows, and the review
// email after pickup or delivery (off until turned on, everyone who received their order, waiting while a problem is
// open, once per order, never to someone who unsubscribed, only in the daytime).
// Also what the independent review found: no time zone, a send that never finished, busy shops, backorders, long-open
// problems, waiting reviews nobody hears about, edits racing a hide, and unsubscribe links opened by mail scanners.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/reviews.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.CRON_SECRET = 'test-secret';
let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'jess', name: 'Jessica Marshall', role: 'manager', isManager: true, isTenantOwner: false, caps: ['marketing.manage'] };
const M: any = Module as any;
const load = M._load;
const told: any[] = [];
let mailDown = false;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') {
    class R { status: number; body: any; headers: any; constructor(b: any, init?: any) { this.body = b; this.status = init?.status || 200; this.headers = init?.headers || {}; } static json(body: any, init?: any) { return { status: init?.status || 200, body, headers: init?.headers || {} }; } }
    return { NextResponse: R, after: (fn: any) => { void Promise.resolve().then(fn); } };
  }
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { told.push(m); return mailDown ? { ok: false, reason: 'provider down' } : { ok: true, status: 'sent' }; } };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null };
  if (request === 'next/cache') return { revalidateTag: () => {}, unstable_cache: (fn: any) => fn };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any, q = '') => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://shop.test', searchParams: new URLSearchParams(q) } }) as any;
const DAY = 864e5;
// 2 pm in New York on a Thursday.
const NOW = Date.parse('2026-10-29T18:00:00Z');
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const ORDER = (id: string, n: number, extra: any = {}) => ({
  id, tenantId: 't1', orderNumber: n, method: 'counter', stage: 'completed', qrToken: `q${id}`, customerName: 'Maya Lin', customerEmail: `${id}@example.com`, clientId: `c-${id}`,
  completedAt: ago(4), lines: [{ lineId: 'A', productId: 'oil', name: 'Rose Cuticle Oil', qtyOrdered: 1, qtyShorted: 0, unitPriceCents: 1800 }], ...extra });
const fresh = async (rs: any = {}) => {
  db = strictTransactions(makeDb()); told.length = 0; mailDown = false;
  actor = { uid: 'jess', name: 'Jessica Marshall', role: 'manager', isManager: true, isTenantOwner: false, caps: ['marketing.manage'] };
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal Studio', timezone: 'America/New_York', retailSettings: { ...rs } });
};

(async () => {
  const R = await import('../../src/lib/reviews');
  console.log('the rules');
  check('a shop review: published shows, pending waits, hidden is hidden', R.shopState({ status: 'published' }) === 'shown' && R.shopState({ status: 'pending' }) === 'waiting' && R.shopState({ status: 'hidden' }) === 'hidden' && R.shopState({}) === 'waiting');
  check('a visit review: shown, hidden with its reason, or not decided yet', R.visitState({ isPublic: true }) === 'shown' && R.visitState({ isPublic: false, hidden: true }) === 'hidden' && R.visitState({ isPublic: false }) === 'waiting');
  check('signed with a first name and last initial', R.reviewerName('Jessica Marshall') === 'Jessica M.' && R.reviewerName('Mary Ann Smith') === 'Mary S.' && R.reviewerName('Cher') === 'Cher' && R.reviewerName('') === 'Verified buyer');
  const d0 = R.reviewSettings({});
  check('the defaults: shop reviews show right away (as before), visit reviews wait, and the email is off', d0.shopAutoShow === true && d0.visitAutoShow === false && d0.ask.on === false && d0.ask.days === 3);
  check('hiding reasons are about what it says, never its rating', R.HIDE_REASONS.map((h) => h.id).join() === 'personal,abusive,off_topic,spam' && !R.HIDE_REASONS.some((h) => /low|star|rating|negative/i.test(`${h.shop} ${h.visit}`)));

  const ask = { on: true, days: 3, onAt: ago(30) };
  const v = (o: any, ctx: any = {}) => R.askVerdict(o, { ask, now: NOW, timeZone: 'America/New_York', ...ctx });
  const base = ORDER('a', 1);
  check('picked up four days ago, asked three days after: it goes', 'send' in v(base));
  check('…not while it’s off', (v(base, { ask: { ...ask, on: false } }) as any).never === 'off');
  check('…not before its day comes', (v({ ...base, completedAt: ago(2) }) as any).wait === 'not_yet');
  check('…waits while a problem report or return is open (it isn’t skipped)', (v(base, { openProblem: true }) as any).wait === 'open_problem');
  check('…waits for the daytime where the business is', (R.askVerdict(base, { ask, now: Date.parse('2026-10-30T03:00:00Z'), timeZone: 'America/New_York' }) as any).wait === 'night');
  check('…never to someone who unsubscribed', (v(base, { optedOut: true }) as any).never === 'unsubscribed');
  check('…never for an order received before the email was turned on', (v(base, { ask: { ...ask, onAt: ago(1) } }) as any).never === 'before_on');
  check('…never weeks later', (v({ ...base, completedAt: ago(35) }, { ask: { ...ask, onAt: ago(60) } }) as any).never === 'too_late');
  check('…never for a canceled order, or one still on its way', (v({ ...base, stage: 'cancelled' }) as any).never === 'not_received' && (v({ ...base, method: 'ship', stage: 'shipped' }) as any).never === 'not_received');
  check('a shipped order counts from the carrier’s delivered scan, not from when it shipped', 'send' in v({ ...base, method: 'ship', completedAt: ago(9), deliveredAt: ago(4) }) && (v({ ...base, method: 'ship', completedAt: ago(9), deliveredAt: ago(1) }) as any).wait === 'not_yet' && (v({ ...base, method: 'ship', completedAt: ago(9) }) as any).never === 'not_received');
  check('…delivered by the team counts from the delivery', 'send' in v({ ...base, method: 'delivery', completedAt: ago(4), deliveredAt: ago(4) }));
  check('never twice', (v({ ...base, reviewAsk: { state: 'sent' } }) as any).never === 'done' && (v({ ...base, reviewAsk: { state: 'skipped' } }) as any).never === 'done');
  check('a failed email is tried again after an hour, at most three times', (v({ ...base, reviewAsk: { state: 'failed', at: new Date(NOW - 10 * 60e3).toISOString(), tries: 1 } }) as any).wait === 'retry'
    && 'send' in v({ ...base, reviewAsk: { state: 'failed', at: new Date(NOW - 2 * 3600e3).toISOString(), tries: 1 } }) && (v({ ...base, reviewAsk: { state: 'failed', at: ago(1), tries: 3 } }) as any).never === 'failed');
  check('nothing to ask about: no email, a download only, already reviewed, a test order', (v({ ...base, customerEmail: '' }) as any).never === 'no_email'
    && (v({ ...base, lines: [{ productId: 'pdf', name: 'Guide', digital: true, qtyOrdered: 1 }] }) as any).never === 'nothing_to_review'
    && (v(base, { reviewed: new Set(['oil']) }) as any).never === 'reviewed' && (v({ ...base, isTest: true }) as any).never === 'test');
  check('a send that never finished isn’t tried again (asking twice is worse than not asking)', (v({ ...base, reviewAsk: { state: 'sending', at: new Date(NOW - 20 * 60e3).toISOString(), tries: 1 } }) as any).never === 'unknown' && (v({ ...base, reviewAsk: { state: 'sending', at: new Date(NOW - 5 * 60e3).toISOString() } }) as any).wait === 'retry');
  check('not for a backorder or replacement, a wholesale order or an in-person sale', (v(base, { followUp: true }) as any).never === 'follow_up' && (v({ ...base, wholesaleAccountId: 'w1' }) as any).never === 'wholesale' && (v({ ...base, priceTier: 'wholesale' }) as any).never === 'wholesale' && (v({ ...base, method: 'in_store' }) as any).never === 'in_store');
  check('without a time zone, never: 9 am in UTC is the night across the US', (R.askVerdict(base, { ask, now: NOW, timeZone: 'UTC' }) as any).wait === 'night' && (R.askVerdict(base, { ask, now: NOW, timeZone: null }) as any).wait === 'night' && !R.askHours(NOW, 'UTC'));
  check('a problem that kept it waiting moves the cutoff on, so long reports are still asked once settled', 'send' in v({ ...base, completedAt: ago(50), reviewAsk: { state: 'held', at: ago(2) } }, { ask: { ...ask, onAt: ago(90) } }) && (v({ ...base, completedAt: ago(50), reviewAsk: { state: 'held', at: ago(40) } }, { ask: { ...ask, onAt: ago(90) } }) as any).never === 'too_late');
  check('the products to review: physical ones, once each, not ones that were shorted', JSON.stringify(R.reviewableLines({ lines: [{ productId: 'a', name: 'A', qtyOrdered: 2 }, { productId: 'a', name: 'A', qtyOrdered: 1 }, { productId: 'b', name: 'B', qtyOrdered: 1, qtyShorted: 1 }, { productId: 'c', name: 'C', digital: true, qtyOrdered: 1 }] }).map((l) => l.productId)) === '["a"]');

  console.log('show and hide');
  const API = (await import('../../src/app/api/reviews/route')).POST;
  await fresh();
  await db.doc(`${T}/retailReviews/o1__oil`).set({ id: 'o1__oil', productId: 'oil', productName: 'Rose Cuticle Oil', orderId: 'o1', rating: 2, title: 'Came late', body: 'Text me at 555-0142', author: 'Maya L.', status: 'pending', createdAt: ago(1) });
  await db.doc(`${T}/reviews/v1`).set({ id: 'v1', clientName: 'Dana Wills', clientId: 'c9', staffId: 'ana', serviceName: 'Spa pedicure', rating: 4, text: 'Loved it', isPublic: true, isFeatured: true, createdAt: ago(2) });
  actor = { uid: 'sam', name: 'Sam Ortiz', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
  let r: any = await API(req({ tenantId: 't1', action: 'show', kind: 'shop', id: 'o1__oil' }));
  check('only someone whose role runs marketing', r.status === 403 && (await get(`${T}/retailReviews/o1__oil`)).status === 'pending');
  actor = { uid: 'jess', name: 'Jessica Marshall', role: 'manager', isManager: true, isTenantOwner: false, caps: ['marketing.manage'] };
  r = await API(req({ tenantId: 't1', action: 'hide', kind: 'shop', id: 'o1__oil' }));
  check('hiding needs a reason', r.status === 400 && /why/i.test(r.body.error));
  r = await API(req({ tenantId: 't1', action: 'hide', kind: 'shop', id: 'o1__oil', reason: 'low_rating' }));
  check('…one of the reasons, not "it’s low"', r.status === 400);
  r = await API(req({ tenantId: 't1', action: 'hide', kind: 'shop', id: 'o1__oil', reason: 'personal' }));
  let rv: any = await get(`${T}/retailReviews/o1__oil`);
  check('hidden, with its reason, who and when', r.status === 200 && rv.status === 'hidden' && rv.hiddenReason === 'personal' && rv.hiddenBy?.name === 'Jessica Marshall' && rv.stateLog?.length === 1, rv);
  const audit = (await db.collection(`${T}/auditLogs`).get()).docs.map((d: any) => d.data());
  check('…and in the activity log', audit.some((a: any) => a.action === 'review.hidden' && /personal/.test(a.summary)));
  r = await API(req({ tenantId: 't1', action: 'show', kind: 'shop', id: 'o1__oil' }));
  rv = await get(`${T}/retailReviews/o1__oil`);
  check('shown again: the reason goes, the history stays', rv.status === 'published' && rv.hiddenReason === null && rv.stateLog?.length === 2);
  r = await API(req({ tenantId: 't1', action: 'hide', kind: 'visit', id: 'v1', reason: 'off_topic' }));
  rv = await get(`${T}/reviews/v1`);
  check('a visit review: hidden is off the booking page and no longer pinned', rv.isPublic === false && rv.hidden === true && rv.isFeatured === false && rv.hiddenReason === 'off_topic');
  r = await API(req({ tenantId: 't1', action: 'show', kind: 'visit', id: 'v1' }));
  rv = await get(`${T}/reviews/v1`);
  check('…shown again', rv.isPublic === true && rv.hidden === false && rv.hiddenReason === null);
  r = await API(req({ tenantId: 't1', action: 'pin', id: 'v1', on: true }));
  check('a shown visit review can be pinned to the top again', r.status === 200 && (await get(`${T}/reviews/v1`)).isFeatured === true);
  r = await API(req({ tenantId: 't1', action: 'hide', kind: 'visit', id: 'v1', reason: 'spam' }));
  r = await API(req({ tenantId: 't1', action: 'pin', id: 'v1', on: true }));
  check('…but not one that isn’t shown', r.status === 409 && (await get(`${T}/reviews/v1`)).isFeatured === false);
  r = await API(req({ tenantId: 't1', action: 'show', kind: 'visit', id: 'nope' }));
  check('a review that isn’t there', r.status === 404);
  r = await API(req({ tenantId: 't1', action: 'show', kind: 'shop', id: '../x' }));
  check('…or an id that isn’t one', r.status === 400);

  console.log('the settings');
  r = await API(req({ tenantId: 't1', action: 'settings', askOn: true, askDays: 7, shopAutoShow: false, visitAutoShow: true }));
  let t: any = await get(T);
  check('saved together: wait for me, show visit reviews, ask a week after', r.status === 200 && t.retailSettings.reviewsAutoPublish === false && t.reviewSettings.visitsAutoShow === true && t.retailSettings.reviewAsk.on === true && t.retailSettings.reviewAsk.days === 7 && !!t.retailSettings.reviewAsk.onAt, t);
  const firstOn = t.retailSettings.reviewAsk.onAt;
  await new Promise((x) => setTimeout(x, 5));
  r = await API(req({ tenantId: 't1', action: 'settings', askDays: 1 }));
  t = await get(T);
  check('changing when keeps the day it was turned on', t.retailSettings.reviewAsk.onAt === firstOn && t.retailSettings.reviewAsk.days === 1);
  r = await API(req({ tenantId: 't1', action: 'settings', askOn: false }));
  await new Promise((x) => setTimeout(x, 5));
  r = await API(req({ tenantId: 't1', action: 'settings', askOn: true }));
  t = await get(T);
  check('turned off and on again: only orders from then on are asked', t.retailSettings.reviewAsk.on === true && Date.parse(t.retailSettings.reviewAsk.onAt) > Date.parse(firstOn));
  r = await API(req({ tenantId: 't1', action: 'settings', askDays: 5 }));
  t = await get(T);
  check('…and only the offered days', t.retailSettings.reviewAsk.days === 1);

  console.log('the customer reviews from their order page');
  const POST = (await import('../../src/app/api/retail/reviews/route')).POST;
  const S0 = await import('../../src/lib/reviews-server');
  await fresh({ reviewsAutoPublish: false });
  await db.doc(`${T}/retailOrders/o1`).set(ORDER('o1', 1214));
  await db.doc(T).update({ userId: 'owner1' });
  await db.doc(`${T}/staff/jess`).set({ name: 'Jessica Marshall', role: 'manager' });
  await db.doc(`${T}/staff/sam`).set({ name: 'Sam Ortiz', role: 'staff' });
  r = await POST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qo1', productId: 'oil', rating: 5, title: 'Sinks in', body: 'Not greasy at all.', name: 'Somebody Else' }));
  rv = await get(`${T}/retailReviews/o1__oil`);
  check('a shop that reads them first: it waits, signed Maya L.', r.status === 200 && rv.status === 'pending' && rv.author === 'Maya L.' && rv.clientId === 'c-o1', rv);
  const notes = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  check('…signed with the name on the order, whatever name is sent', rv.author === 'Maya L.');
  check('…and the people who decide hear it’s waiting (the owner and marketing roles, not everyone)', notes.filter((n: any) => n.type === 'review_waiting').map((n: any) => n.userId).sort().join() === 'jess,owner1' && /5-star review of Rose Cuticle Oil/.test(notes[0]?.message || ''), notes.map((n: any) => n.userId));
  await db.doc(`${T}/retailReviews/o1__oil`).update({ status: 'hidden', hiddenReason: 'personal' });
  r = await POST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qo1', productId: 'oil', rating: 4, body: 'Changed my mind a little.' }));
  rv = await get(`${T}/retailReviews/o1__oil`);
  check('edited after the shop hid it: still hidden, with its reason', rv.status === 'hidden' && rv.hiddenReason === 'personal' && rv.rating === 4 && !!rv.editedAt);
  await db.doc(T).update({ 'retailSettings.reviewsAutoPublish': true });
  await db.doc(`${T}/retailOrders/o2`).set(ORDER('o2', 1215));
  r = await POST(req({ tenantId: 't1', orderId: 'o2', qrToken: 'qo2', productId: 'oil', rating: 3, body: 'It is fine.' }));
  check('a shop that shows them right away', (await get(`${T}/retailReviews/o2__oil`)).status === 'published');
  r = await POST(req({ tenantId: 't1', orderId: 'o2', qrToken: 'nope', productId: 'oil', rating: 3, body: 'It is fine.' }));
  check('only with the order’s own code', r.status === 403);
  await db.doc(`${T}/retailOrders/o3`).set(ORDER('o3', 1216, { stage: 'cancelled' }));
  r = await POST(req({ tenantId: 't1', orderId: 'o3', qrToken: 'qo3', productId: 'oil', rating: 3, body: 'It is fine.' }));
  check('not for a canceled order', r.status === 409);
  await db.doc(`${T}/retailOrders/o4`).set(ORDER('o4', 1217, { isTest: true }));
  r = await POST(req({ tenantId: 't1', orderId: 'o4', qrToken: 'qo4', productId: 'oil', rating: 5, body: 'Testing it.' }));
  check('not on a test order (it would show to real shoppers)', r.status === 409 && !(await get(`${T}/retailReviews/o4__oil`)));
  await db.doc(`${T}/retailReviews/o2__oil`).update({ status: 'published' });
  const [e1] = await Promise.all([POST(req({ tenantId: 't1', orderId: 'o2', qrToken: 'qo2', productId: 'oil', rating: 2, body: 'Changed my mind.' })),
    S0.setReviewState(db, 't1', { uid: 'jess', name: 'Jessica Marshall' }, { kind: 'shop', id: 'o2__oil', to: 'hidden', reason: 'abusive' })]);
  const raced = await get(`${T}/retailReviews/o2__oil`);
  check('an edit landing as the shop hides it: it stays hidden', e1.status === 200 && raced.status === 'hidden' && raced.hiddenReason === 'abusive', raced);
  const S = await import('../../src/lib/reviews-server');
  const mine = await S.orderReviews(db, 't1', 'o1', ORDER('o1', 1214));
  check('their order page gets what they wrote, to change it', mine.oil?.rating === 4 && /Changed my mind/.test(mine.oil.body));

  console.log('visit reviews on the booking page');
  await db.doc(`${T}/staff/ana`).set({ name: 'Ana Ruiz', phone: '+1555', payRate: 30 });
  await db.doc(`${T}/reviews/v1`).set({ clientName: 'Dana Wills', clientId: 'c9', staffId: 'ana', serviceName: 'Spa pedicure', rating: 4, text: 'Loved it', isPublic: true, createdAt: ago(3) });
  await db.doc(`${T}/reviews/v2`).set({ clientName: 'Lena Kim', staffId: 'ana', serviceName: 'Gel manicure', rating: 5, text: 'So careful', isPublic: true, isFeatured: true, createdAt: ago(5) });
  await db.doc(`${T}/reviews/v3`).set({ clientName: 'Sam Oh', rating: 3, text: 'Waited', isPublic: false, createdAt: ago(1) });
  await db.doc(`${T}/reviews/v4`).set({ clientName: 'Bo Lee', rating: 1, text: 'Call 555-1234', isPublic: false, hidden: true, hiddenReason: 'personal', createdAt: ago(1) });
  const PUB = (await import('../../src/app/api/public/reviews/route')).GET;
  r = await PUB(req({}, 'tenantId=t1'));
  const pub = r.body;
  check('only the ones shown, pinned first, then newest', pub.ok && pub.reviews.map((x: any) => x.id).join() === 'v2,v1' && pub.count === 2 && pub.average === 4.5, pub);
  check('…first name and last initial, the service and who did it, nothing from the client record', pub.reviews[1].name === 'Dana W.' && pub.reviews[1].staff === 'Ana' && pub.reviews[1].service === 'Spa pedicure' && !JSON.stringify(pub).includes('c9') && !JSON.stringify(pub).includes('+1555'));

  console.log('a visit review from the client’s link');
  const CHECKIN = (await import('../../src/app/api/checkin/actions/route')).POST;
  const setVisit = async () => {
    await db.doc('appointmentCheckIns/tok123').set({ tenantId: 't1', id: 'a1' });
    await db.doc(`${T}/appointments/a1`).set({ checkInToken: 'tok123', status: 'completed', startTime: ago(1), clientId: 'c5', clientName: 'Rae Park', serviceName: 'Gel manicure', staffId: 'ana' });
  };
  await setVisit();
  const [x1, x2] = await Promise.all([CHECKIN(req({ action: 'review', token: 'tok123', rating: 5, text: 'Great' })), CHECKIN(req({ action: 'review', token: 'tok123', rating: 5, text: 'Great' }))]);
  const vrs = (await db.collection(`${T}/reviews`).where('appointmentId', '==', 'a1').get()).docs.map((d: any) => d.data());
  check('one review per visit, even from two taps at once', vrs.length === 1 && [x1.status, x2.status].sort().join() === '200,409', { n: vrs.length, s: [x1.status, x2.status] });
  check('…shown straight away only when the business chose that', vrs[0]?.isPublic === false);
  check('…and while it waits, the people who decide hear about it', (await db.collection(`${T}/notifications`).get()).docs.some((d: any) => d.data().type === 'review_waiting' && /Rae P\. left a 5-star review of their Gel manicure/.test(d.data().message)));
  await db.doc(T).update({ 'reviewSettings.visitsAutoShow': true });
  await db.doc(`${T}/appointments/a1`).update({ reviewSubmittedAt: null });
  await db.collection(`${T}/reviews`).doc(vrs[0].id).delete();
  await CHECKIN(req({ action: 'review', token: 'tok123', rating: 4, text: 'Good' }));
  const vr2 = (await db.collection(`${T}/reviews`).where('appointmentId', '==', 'a1').get()).docs.map((d: any) => d.data());
  check('…and then it shows', vr2.length === 1 && vr2[0].isPublic === true);

  console.log('the review email');
  const askOn = { reviewAsk: { on: true, days: 3, onAt: ago(30) } };
  const sweep = (o: any = {}) => S.sweepReviewAsks(db, 't1', o.tenant || { businessName: 'Opal Studio', timezone: 'America/New_York', retailSettings: askOn }, 'https://shop.test', { now: o.now ?? NOW });
  await fresh(askOn);
  await db.doc(`${T}/retailOrders/a`).set(ORDER('a', 1214));
  await db.doc(`${T}/retailOrders/b`).set(ORDER('b', 1215, { completedAt: ago(1) }));
  await db.doc(`${T}/retailOrders/c`).set(ORDER('c', 1216));
  await db.doc(`${T}/retailClaims/cl1`).set({ orderId: 'c', status: 'in_review' });
  await db.doc(`${T}/retailOrders/d`).set(ORDER('d', 1217));
  await db.doc(`${T}/clients/c-d`).set({ marketingOptOut: true });
  await db.doc(`${T}/retailOrders/e`).set(ORDER('e', 1218, { method: 'ship', stage: 'shipped', completedAt: ago(5) }));
  await db.doc(`${T}/retailOrders/f`).set(ORDER('f', 1219, { stage: 'cancelled', completedAt: ago(5) }));
  await db.doc(`${T}/retailOrders/h`).set(ORDER('h', 1220));
  await db.doc(`${T}/retailReviews/h__oil`).set({ orderId: 'h', productId: 'oil', rating: 5, status: 'published' });
  await db.doc(`${T}/retailOrders/i`).set(ORDER('i', 1221, { method: 'ship', completedAt: ago(9), deliveredAt: ago(4), lines: [{ productId: 'oil', name: 'Rose Cuticle Oil', qtyOrdered: 1 }, { productId: 'lamp', name: 'Mini Gel Lamp', qtyOrdered: 1 }] }));
  await db.doc(`${T}/retailOrders/j`).set(ORDER('j', 1222));
  await db.doc(`${T}/retailReturns/rt1`).set({ orderId: 'j', status: 'open' });
  let n = await sweep();
  const mails = told.filter((m) => m.kind === 'review_ask');
  check('asked: the picked-up order and the one the carrier delivered', n === 2 && mails.map((m) => m.to).sort().join() === 'a@example.com,i@example.com', mails.map((m) => m.to));
  const ma = mails.find((m) => m.to === 'a@example.com'); const mi = mails.find((m) => m.to === 'i@example.com');
  check('one product: about it by name; two: about the order', ma?.subject === 'How’s your Rose Cuticle Oil?' && mi?.subject === 'How did your order from Opal Studio go?');
  check('…by email, in full (not routed through the order page), from the shop', ma.channel === 'email' && !ma.orderId && /Hi Maya, thanks again for order 1214, picked up on Oct 25/.test(ma.text) && /delivered on Oct 25/.test(mi.text), ma.text);
  check('…straight to the review on their order page', /\/shop\/t1\/order\/a\?review=1#review/.test(ma.html) && /\/shop\/t1\/order\/a\?review=1#review/.test(ma.text));
  const { unsubSig } = await import('../../src/lib/campaigns');
  check('…with an unsubscribe link that works for them only', ma.html.includes(`/api/campaigns/unsubscribe?t=t1&amp;c=c-a&amp;s=${await unsubSig('t1', 'c-a')}`) && /Unsubscribe/.test(ma.html) && /only time we’ll ask about this order/.test(ma.html));
  check('…the items listed, escaped', /<li>Rose Cuticle Oil<\/li>/.test(mi.html) && /<li>Mini Gel Lamp<\/li>/.test(mi.html));
  const st = async (id: string) => (await get(`${T}/retailOrders/${id}`))?.reviewAsk || null;
  check('marked sent, with a note on the order', (await st('a'))?.state === 'sent' && (await db.collection(`${T}/retailOrders/a/events`).get()).docs.some((d: any) => d.data().meta?.kind === 'review_ask'));
  check('not yet, and not while a problem report or a return is open (held, not skipped)', !(await st('b')) && (await st('c'))?.state === 'held' && (await st('j'))?.state === 'held');
  check('never to someone who unsubscribed, or who already reviewed everything', (await st('d'))?.why === 'unsubscribed' && (await st('h'))?.why === 'reviewed');
  check('never for a canceled order, or a parcel still on its way', !(await st('e')) && !(await st('f')));
  told.length = 0;
  n = await sweep({ now: NOW + 10 * 60e3 });
  check('once an hour', n === 0 && told.length === 0);
  await db.doc(`${T}/retailClaims/cl1`).update({ status: 'approved' });
  await db.doc(`${T}/retailReturns/rt1`).update({ status: 'refunded' });
  n = await sweep({ now: NOW + 2 * 3600e3 });
  check('the problem settled: held ones wait for their daily look', n === 0 && told.length === 0);
  n = await sweep({ now: NOW + DAY + 3600e3 });
  check('…the next day they’re asked; the others aren’t asked again, and one not due yet waits', n === 2 && told.map((m) => m.to).sort().join() === 'c@example.com,j@example.com', told.map((m) => m.to));
  told.length = 0;
  n = await sweep({ now: NOW + 2 * DAY + 3600e3 });
  check('…two days on, its day comes', n === 1 && told[0]?.to === 'b@example.com');

  await fresh(askOn);
  await db.doc(`${T}/retailOrders/a`).set(ORDER('a', 1214));
  mailDown = true;
  n = await sweep();
  check('an email that didn’t go: marked failed, tried again after an hour', n === 0 && (await st('a'))?.state === 'failed' && (await st('a'))?.tries === 1);
  mailDown = false;
  n = await sweep({ now: NOW + 30 * 60e3 });
  check('…not before', n === 0);
  n = await sweep({ now: NOW + 2 * 3600e3 });
  check('…and then it goes', n === 1 && (await st('a'))?.state === 'sent' && (await st('a'))?.tries === 2);

  await fresh(askOn);
  await db.doc(`${T}/retailOrders/a`).set(ORDER('a', 1214));
  n = await sweep({ now: Date.parse('2026-10-30T02:30:00Z') });
  check('not at night where the business is', n === 0 && !(await st('a')));
  n = await sweep({ tenant: { businessName: 'Opal Studio', timezone: 'America/New_York', retailSettings: { reviewAsk: { on: false, days: 3, onAt: ago(30) } } }, now: NOW + 3 * 3600e3 });
  check('not while it’s off', n === 0);
  n = await sweep({ tenant: { businessName: 'Opal Studio', timezone: 'America/New_York', privacy: { discreet: true }, retailSettings: askOn }, now: NOW + 5 * 3600e3 });
  check('not while discreet messages are on', n === 0 && told.length === 0);
  const two = await Promise.all([sweep({ now: NOW + DAY }), sweep({ now: NOW + DAY })]);
  check('two runs at once: one email', two[0] + two[1] === 1 && told.filter((m) => m.kind === 'review_ask').length === 1, two);

  console.log('the review email: what the review found');
  await fresh(askOn);
  await db.doc(`${T}/retailOrders/a`).set(ORDER('a', 1214));
  n = await S.sweepReviewAsks(db, 't1', { businessName: 'Opal Studio', retailSettings: askOn }, 'https://shop.test', { now: NOW });
  check('a business without its time zone set: no emails (they’d land at night)', n === 0 && !(await st('a')));
  await fresh(askOn);
  await db.doc(`${T}/retailOrders/a`).set(ORDER('a', 1214, { reviewAsk: { state: 'sending', at: new Date(NOW - 20 * 60e3).toISOString(), tries: 1 } }));
  await db.doc(`${T}/retailOrders/p`).set(ORDER('p', 1300, { chargedCents: 4000 }));
  await db.doc(`${T}/retailOrders/f2`).set(ORDER('f2', 1301, { parentOrderId: 'p', chargedCents: 0 }));
  await db.doc(`${T}/retailOrders/w`).set(ORDER('w', 1302, { wholesaleAccountId: 'acct1' }));
  await db.doc(`${T}/retailOrders/z`).set(ORDER('z', 1303));
  await db.doc(`${T}/clients/c-z`).set({ archived: true });
  n = await sweep();
  check('one email for an order and its backorder; none twice after a run that stopped; none wholesale; none to an archived client', n === 1 && told.map((m) => m.to).join() === 'p@example.com' && (await st('a'))?.state === 'sending', told.map((m) => m.to));
  await fresh(askOn);
  for (let i = 0; i < 510; i++) await db.doc(`${T}/retailOrders/a${String(i).padStart(4, '0')}`).set(ORDER(`a${i}`, 2000 + i, { completedAt: ago(10), reviewAsk: { state: 'sent', at: ago(7) } }));
  for (let i = 0; i < 3; i++) await db.doc(`${T}/retailOrders/b${i}`).set(ORDER(`b${i}`, 3000 + i, { completedAt: ago(4) }));
  n = await sweep();
  check('a busy shop: its newest due orders are still reached past the first few hundred', n === 3, n);
  await fresh(askOn);
  await db.doc(`${T}/retailOrders/k`).set(ORDER('k', 1400, { completedAt: ago(20) }));
  await db.doc(`${T}/retailClaims/ck`).set({ orderId: 'k', status: 'in_review' });
  n = await sweep({ now: NOW });
  check('a report open on the day: held, not skipped', n === 0 && (await st('k'))?.state === 'held');
  for (let dd = 1; dd <= 20; dd++) await sweep({ now: NOW + dd * DAY });
  await db.doc(`${T}/retailClaims/ck`).update({ status: 'approved' });
  n = await sweep({ now: NOW + 22 * DAY });
  check('…weeks later, past the usual cutoff, it’s settled and they’re asked', n === 1 && told.some((m) => m.to === 'k@example.com'));
  await fresh({ reviewAsk: { on: true, days: 3, onAt: ago(200) } });
  await db.doc(`${T}/retailOrders/old`).set(ORDER('old', 1500, { completedAt: ago(80), reviewAsk: { state: 'held', at: ago(40) } }));
  n = await S.sweepReviewAsks(db, 't1', { businessName: 'Opal Studio', timezone: 'America/New_York', retailSettings: { reviewAsk: { on: true, days: 3, onAt: ago(200) } } }, 'https://shop.test', { now: NOW });
  check('a held order that can no longer be asked is finished with, so it stops coming back', n === 0 && (await st('old'))?.state === 'skipped' && (await st('old'))?.why === 'too_late');
  await fresh(askOn);
  await db.doc(`${T}/retailOrders/lp`).set(ORDER('lp', 1600, { method: 'ship', stage: 'shipped', completedAt: ago(12), chargedCents: 4000 }));
  await db.doc(`${T}/retailOrders/lr`).set(ORDER('lr', 1600, { method: 'ship', parentOrderId: 'lp', replacementFor: 'lost_in_transit', chargedCents: 0, completedAt: ago(8), deliveredAt: ago(4), customerEmail: 'lp@example.com', clientId: 'c-lp' }));
  await db.doc(`${T}/retailOrders/ar`).set(ORDER('ar', 1601));
  await db.doc(`${T}/clients/c-ar`).set({ archived: true });
  await db.doc(`${T}/retailOrders/tf`).set(ORDER('tf', 1602, { reviewAsk: { state: 'held', at: ago(3), tries: 2 } }));
  n = await sweep();
  check('a parcel that never arrived: its replacement is asked (the order it came from can’t be)', told.some((m) => m.to === 'lp@example.com') && !(await st('lp')));
  check('an archived client: not asked, and not marked for good', !told.some((m) => m.to === 'ar@example.com') && !(await st('ar')));
  check('tries carry over a hold (three in all)', (await st('tf'))?.state === 'sent' && (await st('tf'))?.tries === 3);
  await db.doc(`${T}/clients/c-ar`).set({ archived: false });
  told.length = 0;
  n = await sweep({ now: NOW + 3600e3 });
  check('…restored, they’re asked', told.some((m) => m.to === 'ar@example.com'));

  await fresh(askOn);
  await db.doc(`${T}/retailOrders/h1`).set(ORDER('h1', 1700, { reviewAsk: { state: 'held', at: new Date(NOW - 6 * 3600e3).toISOString() } }));
  await db.doc(`${T}/retailOrders/lp2`).set(ORDER('lp2', 1701, { method: 'ship', completedAt: ago(12), deliveredAt: ago(6), chargedCents: 4000, reviewAsk: { state: 'sent', at: ago(2) } }));
  await db.doc(`${T}/retailOrders/lr2`).set(ORDER('lr2', 1701, { method: 'ship', parentOrderId: 'lp2', replacementFor: 'lost_in_transit', chargedCents: 0, completedAt: ago(8), deliveredAt: ago(4) }));
  await db.doc(`${T}/retailOrders/dl`).set(ORDER('dl', 1702));
  await db.doc(`${T}/clients/c-dl`).set({ deleted: true });
  n = await sweep();
  check('held under a day: left until its daily look, wherever it turns up', !told.some((m) => m.to === 'h1@example.com') && (await st('h1'))?.state === 'held');
  check('the lost parcel turned up and was asked about: its replacement isn’t (and is finished with)', !told.some((m) => m.to === 'lr2@example.com') && (await st('lr2'))?.why === 'original_asked');
  await db.doc(`${T}/retailOrders/lp3`).set(ORDER('lp3', 1703, { method: 'ship', completedAt: ago(14), deliveredAt: ago(5), chargedCents: 4000, replacementOrderId: 'lr3' }));
  await db.doc(`${T}/retailOrders/lr3`).set(ORDER('lr3', 1703, { method: 'ship', parentOrderId: 'lp3', replacementFor: 'lost_in_transit', chargedCents: 0, reviewAsk: { state: 'sent', at: ago(1) } }));
  told.length = 0;
  n = await sweep({ now: NOW + 3600e3 });
  check('…and the other way round: the replacement was asked, so the original turning up late isn’t', !told.some((m) => m.to === 'lp3@example.com') && (await st('lp3'))?.why === 'replacement_asked');
  check('a deleted client: never', !told.some((m) => m.to === 'dl@example.com') && (await st('dl'))?.why === 'unsubscribed');

  console.log('changed reviews');
  await fresh({ reviewsAutoPublish: false });
  await db.doc(T).update({ userId: 'owner1' });
  await db.doc(`${T}/retailOrders/o1`).set(ORDER('o1', 1214));
  await db.doc(`${T}/retailReviews/o1__oil`).set({ id: 'o1__oil', orderId: 'o1', productId: 'oil', rating: 5, body: 'Great', status: 'published', createdAt: ago(5) });
  r = await POST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qo1', productId: 'oil', rating: 2, body: 'It stopped working.' }));
  let nn = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  check('a shown review changed while the shop reads them first: it waits again, and they hear about it', (await get(`${T}/retailReviews/o1__oil`)).status === 'pending' && nn.some((x: any) => /changed their review of Rose Cuticle Oil \(now 2 stars\)/.test(x.message)), nn.map((x: any) => x.message));
  await db.doc(`${T}/retailReviews/o1__oil`).update({ status: 'hidden', hiddenReason: 'personal', hiddenAt: new Date().toISOString() });
  await new Promise((x) => setTimeout(x, 5));
  r = await POST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qo1', productId: 'oil', rating: 2, body: 'Took my number out.' }));
  nn = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  check('a hidden review changed: still hidden, and they’re told to look again', (await get(`${T}/retailReviews/o1__oil`)).status === 'hidden' && nn.some((x: any) => /changed the review of Rose Cuticle Oil you hid/.test(x.message)));
  r = await POST(req({ tenantId: 't1', orderId: 'o1', qrToken: 'qo1', productId: 'oil', rating: 2, body: 'Took my number out, again.' }));
  const hidNotes = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data()).filter((x: any) => /you hid/.test(x.message));
  check('…once per hiding, not on every save', hidNotes.length === 1, hidNotes.length);
  const unsubRoute = await import('../../src/app/api/campaigns/unsubscribe/route');
  const sig = await (await import('../../src/lib/campaigns')).unsubSig('t1', 'c-k');
  await db.doc(`${T}/clients/c-k`).set({ name: 'Maya Lin' });
  const ureq = (q: string) => ({ nextUrl: { searchParams: new URLSearchParams(q) } }) as any;
  const g1: any = await unsubRoute.GET(ureq(`t=t1&c=c-k&s=${sig}`));
  check('opening the unsubscribe link only asks (mail scanners open links)', /<form method="post"/.test(g1.body) && !(await get(`${T}/clients/c-k`)).marketingOptOut);
  await unsubRoute.POST(ureq(`t=t1&c=c-k&s=${sig}`));
  check('…the button unsubscribes them', (await get(`${T}/clients/c-k`)).marketingOptOut === true);
  const g2: any = await unsubRoute.POST(ureq(`t=t1&c=c-other&s=${sig}`));
  check('…and only them', /didn’t work/.test(g2.body) && !(await get(`${T}/clients/c-other`)));

  console.log('the wiring');
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  check('reviews: the team reads them, only the server writes them', /match \/tenants\/\{tenantId\}\/retailReviews\/\{reviewId\} \{\s+allow read: if isTeam\(tenantId\);\s+allow write: if false;/.test(rules)
    && /match \/tenants\/\{tenantId\}\/reviews\/\{reviewId\} \{\s+allow read: if isTeam\(tenantId\);\s+allow write: if false;/.test(rules) && /'driverLocations', 'retailReviews', 'reviews',/.test(rules));
  check('the review email’s record on the order is locked', /'switchedFrom',\s+'reviewAsk'\];/.test(rules));
  check('the old shop page goes to the Shop tab, and Reviews is in every plan', /redirect\('\/reviews\?tab=shop'\)/.test(fs.readFileSync('src/app/(app)/retail-orders/reviews/page.tsx', 'utf8')) && !/'\/reviews'/.test(fs.readFileSync('src/lib/modules.ts', 'utf8')));
  const cron = fs.readFileSync('src/app/api/cron/retail-payments/route.ts', 'utf8');
  check('the cron sends them after the payment work, with a time budget', /sweepReviewAsks\(db, t\.id, tenant[^\n]*budgetMs/.test(cron) && cron.indexOf('sweepReviewAsks(db') > cron.indexOf("where('stage', '==', 'placed')"));
  const os = fs.readFileSync('src/app/api/retail/order-status/route.ts', 'utf8');
  check('…and nothing to review on a test order', /\['shipped', 'completed'\]\.includes\(String\(order\.stage\)\) && !order\.isTest/.test(os));
  check('the order page gets their words and last initial only with their pass', /body\.order\.reviews = passOk \? mine/.test(os) && /body\.order\.reviewAs = passOk \?/.test(os));
  check('a case can start from a low visit review', /visitReviewId/.test(fs.readFileSync('src/lib/cases.ts', 'utf8')) && /visitReview/.test(fs.readFileSync('src/app/(app)/cases/page.tsx', 'utf8')));
  check('the booking page shows the visit reviews the business shows', /usePublicReviews\(data\?\.tenantId\)/.test(fs.readFileSync('src/lib/booking-sections.tsx', 'utf8')) && /usePublicReviews\(sections\.some\(\(s\) => s\.type === 'reviews'\) \? tenant\?\.id : undefined\)/.test(fs.readFileSync('src/components/booking/StudioBookingPage.tsx', 'utf8')));
  const files = ['src/lib/reviews.ts', 'src/lib/reviews-server.ts', 'src/app/api/reviews/route.ts', 'src/app/api/public/reviews/route.ts', 'src/components/reviews/ReviewsScreen.tsx', 'src/components/shop/OrderReviews.tsx'];
  const words = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const tool = new RegExp(String.fromCharCode(67, 108, 97, 117, 100, 101), 'i');
  check('no mention of the tool that wrote this, no "call us", no JSX comments, US spelling', !tool.test(words) && !/call us/i.test(words) && !/\{\/\*/.test(words) && !/cancelled/i.test(words.replace(/'cancelled'/g, '')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
