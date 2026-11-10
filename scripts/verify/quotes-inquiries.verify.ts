// Checks a business's inquiries and quotes from the public side (L17):
// - The inquiry form saves, on the server (api/inquiry): it couldn't before, since nobody outside the business may write
//   to its records. Checked and tidied (lib/inquiry-intake): a name, a way to reply, agreement to be contacted, a date
//   that's coming; services named and priced from the business's own list, not the form's; pictures only from the
//   form's own uploads; no distance or travel cost made up; options in words that fit any business. The business is
//   told. A paused business takes none; a robot is thanked and dropped.
// - The client's quote (api/quote) opens only with its own key. They see what's quoted, never the team's pay or the
//   business's costs; the first look tells the business, once. Accepting locks it, holds its day on the business's
//   clock (its hours when it has a start time) once, and tells the business with the deposit to ask for. Declining
//   and asking for changes are kept and told. A quote past its date, or one already answered, can't be accepted; a
//   paused business takes no acceptance.
// - The Quotes page: its dates never break the page; the client's link carries the key; a copy gets its own.
// - A paused business takes no lounge orders or concierge orders either.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/quotes-inquiries.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { FieldValue: FV, getFirestore: () => db };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null };
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => null } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  console.log('the inquiry, checked');
  const I = await import('../../src/lib/inquiry-intake');
  const svc = [{ id: 's1', name: 'Group class', price: 40, duration: 90 }, { id: 's2', name: 'Private session', price: 120, duration: 60 }];
  const base = { firstName: ' Sam ', lastName: 'Lee', email: 'SAM@Example.com', phone: '', agreedToContact: true, eventType: 'celebration', eventDate: '2026-12-05', interestedServiceIds: ['s1', 'nope'], guestCount: '40' };
  let r: any = I.cleanInquiry({ ...base, interestedServices: [{ id: 's1', price: 1 }] }, svc, '2026-11-10', 't1');
  check('tidied, and services named and priced from the business’s own list (an unknown one is dropped)', r.ok && r.data.firstName === 'Sam' && r.data.email === 'sam@example.com' && r.data.interestedServices.length === 1 && r.data.interestedServices[0].price === 40 && r.data.interestedServices[0].name === 'Group class' && r.data.estimatedHours === 1.5, r);
  check('…the kind of event in words that fit any business, and nothing made up about travel', r.ok && r.data.eventTypeLabel === 'Celebration or party' && !('estimatedMiles' in r.data) && !('estimatedTravelCost' in r.data), r.ok && r.data);
  check('a name, a way to reply and agreement to be contacted are needed', !I.cleanInquiry({ ...base, firstName: '' }, svc, '2026-11-10', 't1').ok && !I.cleanInquiry({ ...base, email: '', phone: '' }, svc, '2026-11-10', 't1').ok && !I.cleanInquiry({ ...base, agreedToContact: false }, svc, '2026-11-10', 't1').ok);
  check('a date that’s passed is refused (on the business’s day)', !I.cleanInquiry({ ...base, eventDate: '2026-11-09' }, svc, '2026-11-10', 't1').ok && I.cleanInquiry({ ...base, eventDate: '2026-11-10' }, svc, '2026-11-10', 't1').ok);
  const own = 'https://storage.googleapis.com/bkt/tenants/t1/inquiryInspo/abc_12.jpg';
  r = I.cleanInquiry({ ...base, inspirationImages: [own, 'https://evil.test/x.jpg', 'https://storage.googleapis.com/bkt/tenants/t2/inquiryInspo/a.jpg'] }, svc, '2026-11-10', 't1');
  check('pictures only from this business’s own form uploads', r.ok && r.data.inspirationImages.length === 1 && r.data.inspirationImages[0] === own, r.ok && r.data.inspirationImages);
  const words = JSON.stringify([I.INQUIRY_EVENT_TYPES, I.INQUIRY_HEARD_FROM, I.INQUIRY_PLACES]);
  check('no bridal party, prom, wedding planner or wedding sites in the choices', !/bridal|prom|planner|knot|weddingwire/i.test(words));

  console.log('the inquiry, saved');
  const { POST: INQ } = await import('../../src/app/api/inquiry/route');
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'North Loft', timezone: 'America/New_York' });
  await db.doc(`${T}/services/s1`).set(svc[0]);
  let res: any = await INQ(req({ tenantId: 't1', ...base }));
  const saved = await all(`${T}/quoteRequests`);
  check('saved to the business’s inquiries, which the Quotes page lists, and the business is told', res.body.ok && saved.length === 1 && saved[0].fullName === 'Sam Lee' && saved[0].status === 'new' && saved[0].id === res.body.id
    && (await all(`${T}/notifications`)).some((n: any) => n.type === 'quote_request' && /Sam Lee/.test(n.message)), res.body);
  res = await INQ(req({ tenantId: 't1', ...base, cf_hp: 'http://spam' }));
  check('a robot (the field people never see, filled in) is thanked and dropped', res.body.ok && (await all(`${T}/quoteRequests`)).length === 1);
  res = await INQ(req({ tenantId: 't1', ...base, tookMs: 900 }));
  check('…and so is a whole form sent within seconds of opening it (timed on the visitor’s own clock)', res.body.ok && (await all(`${T}/quoteRequests`)).length === 1);
  res = await INQ(req({ tenantId: 't1', ...base, tookMs: 95000 }));
  check('…a person taking their time is saved', res.body.ok && (await all(`${T}/quoteRequests`)).length === 2);
  await db.doc(T).set({ suspended: true }, { merge: true });
  res = await INQ(req({ tenantId: 't1', ...base }));
  check('a paused business takes no inquiries', res.status === 403 && res.body.closed && (await all(`${T}/quoteRequests`)).length === 2, res.body);

  console.log('the client’s quote');
  const { POST: Q } = await import('../../src/app/api/quote/route');
  const KEY = 'k'.repeat(32);
  const quote = (x: any = {}) => ({ eventName: 'Spring team day', clientId: 'c1', status: 'sent', sentAt: '2026-11-08T15:00:00Z', expiresInDays: 14, clientSecret: KEY, eventDate: '2026-12-05T05:00:00.000Z', totalHours: 3,
    lineItems: [{ name: 'Group class', price: 40, quantity: 10, cost: 15 }], travelExpenses: 50, projectFee: 10, depositAmount: 100, staffPayouts: [{ staffId: 'st1', name: 'Ana', amount: 200 }], ...x });
  const fresh = async (x: any = {}, t: any = {}) => { db = strictTransactions(makeDb()); await db.doc(T).set({ name: 'North Loft', timezone: 'America/New_York', ...t }); await db.doc(`${T}/quotes/q1`).set(quote(x)); };
  const ask = (action: string, x: any = {}) => Q(req({ tenantId: 't1', id: 'q1', k: KEY, action, ...x })) as any;
  await fresh();
  res = await Q(req({ tenantId: 't1', id: 'q1', k: 'x'.repeat(32), action: 'view' }));
  check('the wrong key opens nothing (the same answer as no quote)', res.status === 404 && !res.body.quote);
  const [v1, v2] = await Promise.all([ask('view'), ask('view')]);
  const pq = v1.body.quote;
  check('what they see: the lines, travel, the fee and the total ($400 + $50 + $40 = $490), the deposit, the day on the business’s clock', pq.total === 490 && pq.fee === 40 && pq.deposit === 100 && pq.eventDay === '2026-12-05' && pq.lines.length === 1 && pq.open === true, pq);
  check('…never the team’s pay or the business’s costs', !JSON.stringify(v1.body).includes('staffPayouts') && !JSON.stringify(v1.body).includes('"cost"') && !JSON.stringify(v1.body).includes('Ana') && !JSON.stringify(v1.body).includes(KEY));
  check('the first look marks it viewed and tells the business, once', (await get(`${T}/quotes/q1`)).status === 'viewed' && (await all(`${T}/notifications`)).filter((n: any) => n.type === 'quote_viewed').length === 1 && v2.body.ok);
  await db.doc(`${T}/clients/c1`).set({ name: 'Sam Lee' });
  let a0 = await ask('accept', { total: 400 });
  check('the price they accept is the price they saw: a quote changed since, shown again first', a0.status === 409 && a0.body.changed && a0.body.quote.total === 490 && (await get(`${T}/quotes/q1`)).status === 'viewed', a0.body);
  const [a1, a2] = await Promise.all([ask('accept', { total: 490 }), ask('accept', { total: 490 })]);
  const qd = await get(`${T}/quotes/q1`); const block = await get(`${T}/events/quote_q1`);
  check('accepted and locked, once; the business told once, with the deposit to ask for', a1.body.ok && a2.body.ok && qd.status === 'accepted' && qd.locked === true
    && (await all(`${T}/notifications`)).filter((n: any) => n.type === 'quote_accepted').length === 1 && (await all(`${T}/notifications`)).some((n: any) => /\$100\.00 deposit/.test(n.message)), { a1: a1.body, qd });
  check('…its day held on the calendar for the team on it: the whole day on the business’s clock, with no start time', block && block.allDay === true && block.startTime === '2026-12-05T05:00:00.000Z' && block.staffIds.join() === 'st1' && (await all(`${T}/events`)).length === 1, block);
  check('…the client’s record marked, and a client that’s gone isn’t made again', (await get(`${T}/clients/c1`)).hasActiveBooking === true);
  await fresh({ clientId: 'gone' }); await ask('accept', { total: 490 });
  check('…(no client made for one that was deleted)', !(await get(`${T}/clients/gone`)) && (await get(`${T}/quotes/q1`)).status === 'accepted');
  await fresh({ eventDate: '2026-12-05', startTime: '14:00', totalHours: 0 });
  await ask('accept', { total: 490 }); const b0 = await get(`${T}/events/quote_q1`);
  check('…a start time with no length holds the whole day, rather than guessing', b0.allDay === true && b0.startTime === '2026-12-05T05:00:00.000Z', b0);
  await fresh({ eventDate: '2026-12-05', startTime: '14:00' });
  await ask('accept', { total: 490 }); const b2 = await get(`${T}/events/quote_q1`);
  check('…its hours when it has a start time (2pm New York for 3 hours)', b2.startTime === '2026-12-05T19:00:00.000Z' && b2.endTime === '2026-12-05T22:00:00.000Z' && b2.allDay === false, b2);
  await fresh();
  res = await ask('decline', { reason: 'My plans changed', note: 'Moved abroad' });
  check('declined with their reason, for the business to follow up', res.body.ok && (await get(`${T}/quotes/q1`)).declineReason === 'My plans changed' && (await get(`${T}/quotes/q1`)).needsFollowUp === true);
  res = await ask('accept', { total: 490 });
  check('…and a declined quote can’t then be accepted', res.status === 409 && !res.body.changed, res.body);
  await fresh();
  res = await ask('revise', { message: 'Could it start at 3?' });
  check('asking for changes: kept with the quote and told', res.body.ok && (await get(`${T}/quotes/q1`)).status === 'revision_requested' && (await all(`${T}/quotes/q1/revisions`)).length === 1 && (await all(`${T}/notifications`)).some((n: any) => n.type === 'quote_revision'));
  await fresh({ sentAt: '2026-10-01T15:00:00Z', expiresInDays: 7 });
  res = await ask('accept', { total: 490 });
  check('past its date: can’t be accepted', res.status === 409);
  res = await ask('view');
  check('…and is marked expired when it’s looked at', res.body.quote.status === 'expired' && (await get(`${T}/quotes/q1`)).status === 'expired');
  await fresh({}, { suspended: true });
  res = await ask('accept', { total: 490 });
  check('a paused business takes no acceptance', res.status === 403 && (await get(`${T}/quotes/q1`)).status === 'sent');
  await fresh({ status: 'draft' });
  res = await ask('view');
  check('a draft can be previewed (nothing can be done with it, and it isn’t marked viewed)', res.body.ok && res.body.quote.open === false && (await get(`${T}/quotes/q1`)).status === 'draft');
  await fresh();
  res = await ask('view', { preview: true });
  check('the business’s own preview of a sent quote isn’t the client’s first look', res.body.ok && (await get(`${T}/quotes/q1`)).status === 'sent' && !(await all(`${T}/notifications`)).length);

  console.log('the pages');
  const quotes = src('src/app/(app)/quotes/page.tsx');
  check('the Quotes page never glues a time onto a quote’s date (it broke the page and Convert to Event)', !/eventDate \+ 'T12:00:00'/.test(quotes) && /quoteDayText\(quote\)/.test(quotes));
  check('…the client’s link carries the key, every quote gets its own (given against what’s saved, never replacing one already sent), and a copy gets a new one', /\?k=\$\{encodeURIComponent\(q\.clientSecret\)\}/.test(quotes) && /if \(k\.length >= 16 && k !== was\) return;/.test(quotes) && /tx\.update\(ref, \{ clientSecret: nanoid\(32\) \}\);/.test(quotes) && /clientSecret,\n\s+acceptedVia, declineReason/.test(quotes) && !/✓/.test(quotes));
  const pub = src('src/app/quote/[tenantId]/[id]/page.tsx');
  check('the client’s quote page goes through the server, takes no card, and says no “contact us”', /fetch\('\/api\/quote'/.test(pub) && !/firebase\/firestore/.test(pub) && !/Card Number|CVC/.test(pub) && !/contact us|call us/i.test(pub) && !/uppercase/.test(pub));
  const inq = src('src/app/inquiry/[tenantId]/page.tsx');
  check('the inquiry form saves through the server, with no made-up distance', /fetch\('\/api\/inquiry'/.test(inq) && !/addDoc\(/.test(inq) && !/nominatim|calculateMileage|COST_PER_MILE/.test(inq));
  check('…in words that fit any business', !/Bridal|Wedding planner|Knot|bridesmaids|glam|Ritz|At Studio|contact us/i.test(inq));
  check('a paused business takes no lounge or concierge orders', /if \(action === 'request'\) \{ const closed = await closedReplyFor\(db, tenantId\); if \(closed\) return closed; \}/.test(src('src/app/api/guest-lounge/route.ts'))
    && /\{ const closed = closedReply\(tenant\); if \(closed\) return closed; \}/.test(src('src/app/api/concierge/requests/route.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
