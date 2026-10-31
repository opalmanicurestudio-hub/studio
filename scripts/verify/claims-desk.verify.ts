// Checks row 15, part 2a: problem reports are decided in Problems (components/orders/ClaimCard), and the old Claims
// page is gone.
//   - what the record shows, as facts with no score; why the shop's rules didn't approve it; the carrier claim to file
//     if it's approved; where it is for the customer, in the words the shop's screens use (lib/claim-view);
//   - one queue with a filter for each kind; what waits for the customer kept apart under Waiting on them; appeals
//     first among reports (lib/problems-view showProblems);
//   - on the server: asking again starts a new wait (the last answer kept in its history), approving without an
//     amount refunds what it was worth (it used to be read as $0), the person who decided is named, and the loss is
//     recorded there, once, never from a screen (lib/claim-loss);
//   - a report nobody has decided on in two days: one note to the people who can decide, once per wait
//     (lib/claim-reminder, cron/nightly);
//   - the screens: ClaimCard asks the server for everything; the old page sends people to Problems.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/claims-desk.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: ['checkout.refund'] };
const afterJobs: Promise<any>[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, sent: true }) });

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const as = (x: any) => { actor = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: ['checkout.refund'], ...x }; };
const now = Date.parse('2026-10-30T12:00:00Z');
const iso = (h: number) => new Date(now + h * 3600e3).toISOString();

(async () => {
  const V = await import('../../src/lib/claim-view');
  const P = await import('../../src/lib/problems-view');

  console.log('what the decide sheet says');
  const ship = { id: 'o1', method: 'ship', carrier: 'usps', trackingNumber: '9400', completedAt: '2026-10-20T12:00:00Z', deliveredAt: '2026-10-23T12:00:00Z' };
  const facts = V.recordFacts({ lineName: 'Rose Cuticle Oil', evidence: { lineScanned: '1 of 1', lineScanComplete: true, photoCount: 1 } }, ship, 0);
  check('the record shows facts, each marked, and no score', facts.length === 4 && facts[0].ok === true && /scanned into the bag/.test(facts[0].text) && /1 packing photo$/.test(facts[1].text) && /delivered/.test(facts[2].text) && facts[3].text === 'First report from them' && !facts.some((f) => /score|risk|fraud/i.test(f.text)), facts);
  const pick = V.recordFacts({ evidence: { allScanned: false, photoCount: 0 }, photosRequired: true }, { method: 'pickup', handoff: { method: 'checked', collectedBy: 'someone_else', collectorName: 'Sam' } }, 2);
  check('…a pickup says how it was checked and who collected it; a missing photo and earlier reports are there too', pick.some((f) => f.text === 'Picked up, name and phone checked by Sam') && pick.some((f) => f.text === 'No photo from them yet' && f.ok === false) && pick.some((f) => f.text === '2 earlier reports from them') && pick.some((f) => f.text === 'No packing photo'), pick);
  const rs = { claimAutoResolveMaxCents: 1500, policies: { claimReviewAfter: 3 } };
  check('why it wasn’t approved on its own: the first reason that applies', V.whyNotAuto({ appealedAt: 'x', claimValueCents: 100 }, rs) === 'An appeal is always decided by a person.'
    && V.whyNotAuto({ claimValueCents: 100 }, {}) === 'Your claim policy doesn’t approve any on their own.'
    && /\$18\.00 is over your \$15\.00 automatic limit/.test(V.whyNotAuto({ claimValueCents: 1800, type: 'missing' }, rs))
    && /asks for a photo first/.test(V.whyNotAuto({ claimValueCents: 900, photosRequired: true }, rs))
    && /after 3 reports from the same customer/.test(V.whyNotAuto({ claimValueCents: 900, needsReview: true }, rs))
    && /always decided by a person/.test(V.whyNotAuto({ claimValueCents: 900, type: 'damaged' }, rs))
    && /went in the bag/.test(V.whyNotAuto({ claimValueCents: 900, type: 'missing', evidence: { lineScanComplete: true } }, rs)));
  const day = (s: string) => s.slice(0, 10);
  const cl = V.carrierLine({ type: 'damaged' }, ship, day, 'UTC');
  check('a damaged parcel says who to file with and by when, if it’s approved', !!cl && /if you approve it, file with .+ by 20\d\d-\d\d-\d\d\. It’s listed under Lost and recovered\.$/.test(cl), cl);
  check('…nothing to file for a pickup, a missing item, or a parcel sent with no carrier or tracking on record', V.carrierLine({ type: 'damaged' }, { method: 'pickup' }, day) === null && V.carrierLine({ type: 'missing' }, ship, day) === null && V.carrierLine({ type: 'damaged' }, { method: 'ship' }, day) === null);
  const porch = V.carrierLine({ type: 'not_received' }, ship, day, 'UTC');
  check('…and a parcel gone after its delivered scan says the carrier’s cover won’t pay for it', !!porch && /included cover doesn’t pay for a parcel gone after its delivered scan, so there’s no claim to file\.$/.test(porch), porch);
  const insured = V.carrierLine({ type: 'not_received' }, { ...ship, shipmentProtection: { insuranceCents: 5000 } }, day, 'UTC');
  check('…unless it was insured: then it’s a claim with the insurer', !!insured && /^Insured with Shippo: if you approve it, file with Shippo/.test(insured), insured);
  const asked = { status: 'in_review', openedAt: iso(-72), infoRequestText: 'A photo of the bag', infoRequestAt: iso(-50) };
  check('asked and not answered: waiting on them; answered after the ask: back with the shop, counting from the answer', V.claimWaiting(asked) && !V.claimWaiting({ ...asked, infoResponseText: 'Here', infoResponseAt: iso(-10) }) && V.claimSince({ ...asked, infoResponseText: 'Here', infoResponseAt: iso(-10) }) === Date.parse(iso(-10))
    && V.claimWaiting({ ...asked, infoResponseText: 'old', infoResponseAt: iso(-60) }) && !V.claimWaiting({ ...asked, status: 'declined' }));
  check('the customer sees where it is, in plain words', V.customerClaimStatus({ status: 'in_review' }).label === 'Being checked' && V.customerClaimStatus({ status: 'in_review', appealedAt: 'x' }).label === 'Being checked again'
    && V.customerClaimStatus(asked).label === 'We need something from you' && V.customerClaimStatus({ status: 'resolved', resolutionCents: 1800 }).line === 'A $18.00 refund, back to how you paid.'
    && V.customerClaimStatus({ status: 'declined', declineReason: 'Past the window' }).line === 'Past the window');

  console.log('one queue');
  const orders = [{ id: 'o1', orderNumber: 1214, customerName: 'Maya Rivera', stage: 'completed', pendingRefundCents: 2200 }, { id: 'o2', orderNumber: 1188, customerName: 'Priya Shah', stage: 'completed' }, { id: 'o3', orderNumber: 1233, customerName: 'Owen Park', stage: 'paid' }];
  const claims = [
    { id: 'c1', orderId: 'o1', customerName: 'Maya Rivera', type: 'missing', lineName: 'Rose Cuticle Oil', status: 'in_review', openedAt: iso(-48), claimValueCents: 1800 },
    { id: 'c2', orderId: 'o2', customerName: 'Priya Shah', type: 'damaged', lineName: 'Dusk Polish', status: 'in_review', openedAt: iso(-200), appealedAt: iso(-2), claimValueCents: 1400 },
    { id: 'c3', orderId: 'o3', customerName: 'Owen Park', type: 'damaged', lineName: 'Lamp', status: 'in_review', openedAt: iso(-30), infoRequestText: 'A photo of the box', infoRequestAt: iso(-20) },
  ];
  const tickets = [{ id: 't1', orderId: 'o3', customerName: 'Owen Park', status: 'open', message: 'Can I add a polish?', createdAt: iso(-1) }];
  const groups = P.buildProblems({ orders, tickets, claims, now });
  const ids = (gs: any[]) => gs.map((g) => g.orderId);
  const allShown = P.showProblems(groups, 'all');
  check('All leaves out what waits for the customer; the order keeps its other problems', allShown.length === 3 && allShown.find((g) => g.orderId === 'o3')!.items.every((p) => !p.waiting) && allShown.find((g) => g.orderId === 'o3')!.items.length === 1, allShown.map((g) => [g.orderId, g.items.map((p) => p.title)]));
  const claimsShown = P.showProblems(groups, 'claims');
  check('Claims: appeals first, then whoever has waited longest; titled so you can tell', ids(claimsShown).join() === 'o2,o1' && claimsShown[0].items[0].title === 'Appeal: Dusk Polish arrived damaged' && /appealed 2 h ago/.test(claimsShown[0].items[0].detail), claimsShown.map((g) => g.items.map((p) => [p.title, p.detail])));
  const waitingShown = P.showProblems(groups, 'waiting');
  check('Waiting on them holds the report you asked about, with what you asked', ids(waitingShown).join() === 'o3' && waitingShown[0].items[0].title === 'Waiting on Owen: Lamp arrived damaged' && waitingShown[0].items[0].detail === 'You asked 20 h ago');
  check('…and the filters for messages and refunds show only theirs', ids(P.showProblems(groups, 'messages')).join() === 'o3' && ids(P.showProblems(groups, 'refunds')).join() === 'o1' && P.showProblems(groups, 'returns').length === 0, ['messages', 'refunds', 'returns'].map((k: any) => ids(P.showProblems(groups, k))));
  check('…while the full order, with every problem, is still what the panel opens', groups.find((g) => g.orderId === 'o3')!.items.length === 2);
  const replied = P.buildProblems({ orders: orders.map((o) => ({ ...o, pendingRefundCents: 0 })), tickets: [{ ...tickets[0], replies: [{ text: 'Sure', at: iso(0), by: 'Kai' }] }], now });
  check('a message you answered waits on them too, not in front of you', P.showProblems(replied, 'all').length === 0 && P.showProblems(replied, 'waiting').length === 1);
  check('…a filter name in the address is only ever one of the six', P.isShow('claims') && !P.isShow('__proto__') && !P.isShow('everything'));

  console.log('on the server');
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await POST(req({ tenantId: 't1', action, ...args })); await settle(); return r; };
  const fresh = async () => {
    db = strictTransactions(makeDb());
    await db.doc(T).set({ name: 'Opal', userId: 'owner1', retailSettings: {} });
    await db.doc(`${T}/inventory/oil`).set({ id: 'oil', costPerUnit: 4.5 });
    await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1214, stage: 'completed', method: 'ship', carrier: 'usps', trackingNumber: '9400', completedAt: '2026-10-20T12:00:00Z', customerName: 'Maya Rivera', lines: [{ lineId: 'A', productId: 'oil', name: 'Rose Cuticle Oil', unitPriceCents: 1800, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0 }], qrToken: 'o1.x' });
    await db.doc(`${T}/retailClaims/c1`).set({ id: 'c1', orderId: 'o1', orderNumber: 1214, lineId: 'A', lineName: 'Rose Cuticle Oil', qty: 1, claimValueCents: 1800, status: 'in_review', type: 'missing', customerName: 'Maya Rivera', openedAt: iso(-48) });
  };
  await fresh();
  let r = await step('requestClaimInfo', { claimId: 'c1', text: 'A photo of the bag' });
  await db.doc(`${T}/retailClaims/c1`).update({ infoResponseText: 'It was empty', infoResponseAt: iso(-1) });
  r = await step('requestClaimInfo', { claimId: 'c1', text: 'And the label, please' });
  let c1 = await get(`${T}/retailClaims/c1`);
  check('asking again starts a new wait, and the last question and answer are kept in its history', r.body.ok && c1.infoRequestText === 'And the label, please' && c1.infoResponseText === null && c1.infoResponseAt === null && V.claimWaiting(c1)
    && c1.infoHistory.length === 1 && c1.infoHistory[0].asked === 'A photo of the bag' && c1.infoHistory[0].answer === 'It was empty' && c1.infoHistory[0].by === 'Kai Park', c1);
  r = await step('decideClaim', { claimId: 'c1', approve: true, cents: null });
  c1 = await get(`${T}/retailClaims/c1`);
  const o1 = await get(`${T}/retailOrders/o1`);
  check('approving without an amount refunds what it was worth (an empty amount used to be read as $0)', r.body.ok && c1.resolutionCents === 1800 && o1.pendingRefundCents === 1800, { r: r.body, c1: c1.resolutionCents, o: o1.pendingRefundCents });
  check('…and the person who decided is named on it', c1.decidedBy === 'Kai Park' && c1.decidedById === 'k1');
  let exc = await all(`${T}/inventoryExceptions`);
  check('the loss is recorded on the server, once, at what the goods cost', exc.length === 1 && exc[0].id === 'claim-c1' && exc[0].reason === 'reported_missing' && exc[0].landedCostCents === 450 && exc[0].recordedBy.name === 'Kai Park' && exc[0].source === 'claims_desk', exc);
  r = await step('requestClaimInfo', { claimId: 'c1', text: 'One more thing' });
  check('…a decided report can’t be asked about again', r.status === 409);
  const { recordClaimLoss } = await import('../../src/lib/claim-loss');
  const again = await recordClaimLoss(db, 't1', 'c1');
  check('…recording it twice keeps one record', !again.created && (await all(`${T}/inventoryExceptions`)).length === 1);

  await db.doc(`${T}/retailClaims/c2`).set({ id: 'c2', orderId: 'o1', qty: 1, claimValueCents: 1800, status: 'in_review', type: 'not_received', customerName: 'Maya Rivera', openedAt: iso(-5) });
  r = await step('decideClaim', { claimId: 'c2', approve: false, declineWhy: 'The carrier shows it delivered to your porch.' });
  check('a decline records no loss, and keeps their reason word for word', r.body.ok && (await all(`${T}/inventoryExceptions`)).length === 1 && (await get(`${T}/retailClaims/c2`)).declineReason === 'The carrier shows it delivered to your porch.');
  await db.doc(`${T}/retailClaims/c3`).set({ id: 'c3', orderId: 'o1', qty: 1, claimValueCents: 1800, status: 'resolved', type: 'not_received' });
  await db.doc(`${T}/inventoryExceptions/lost-o1`).set({ id: 'lost-o1' });
  check('a parcel already replaced from Needs you isn’t recorded twice', !(await recordClaimLoss(db, 't1', 'c3')).created && !(await get(`${T}/inventoryExceptions/claim-c3`)));
  await db.doc(`${T}/inventoryExceptions/lost-o1`).delete();
  await db.doc(`${T}/retailOrders/o1`).update({ deliveredAt: '2026-10-23T12:00:00Z' });
  await recordClaimLoss(db, 't1', 'c3');
  const box = await get(`${T}/inventoryExceptions/claim-c3`);
  check('…otherwise a box gone from the porch is the whole box, for the insurer, at what it cost', box && box.reason === 'stolen_after_delivery' && box.responsibleParty === 'carrier' && box.landedCostCents === 450 && /Order #1214 contents \(1 item\)/.test(box.name), box);
  check('a report approved by the shop’s own rules records its loss too, after the answer', /if \(filed\.approved\) \{\s+const loss = async \(\) => \{ try \{ const \{ recordClaimLoss \} = await import\('@\/lib\/claim-loss'\); await recordClaimLoss\(db, tenantId, dupId\);/.test(src('src/app/api/retail/claims/route.ts')));
  check('…and the customer’s order page gets when they answered, so it knows a new question is waiting', /infoResponseAt: d\.infoResponseAt \|\| null,/.test(src('src/app/api/retail/claims/route.ts')));

  console.log('two days without a decision');
  const { remindWaitingClaims } = await import('../../src/lib/claim-reminder');
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal', userId: 'owner1', roles: {} });
  await db.doc(`${T}/staff/s1`).set({ role: 'manager' });
  await db.doc(`${T}/staff/s2`).set({ role: 'front_desk' });
  await db.doc(`${T}/staff/s3`).set({ role: 'manager', archived: true });
  await db.doc(`${T}/retailClaims/old`).set({ id: 'old', status: 'in_review', type: 'missing', lineName: 'Rose Cuticle Oil', customerName: 'Maya Rivera', openedAt: iso(-50) });
  await db.doc(`${T}/retailClaims/new`).set({ id: 'new', status: 'in_review', type: 'damaged', customerName: 'Priya Shah', openedAt: iso(-20) });
  await db.doc(`${T}/retailClaims/asked`).set({ id: 'asked', status: 'in_review', openedAt: iso(-90), infoRequestText: 'A photo', infoRequestAt: iso(-80) });
  let rem = await remindWaitingClaims(db, 't1', { now });
  let notes = await all(`${T}/notifications`);
  check('a report two days old: one note to the owner and the managers, naming it, linking to Claims', rem.reminded === 1 && notes.length === 2 && notes.map((n: any) => n.userId).sort().join() === 'owner1,s1' && notes[0].title === 'A problem report is waiting for you' && /^Maya R\.: Rose Cuticle Oil, missing\. It has waited 2 days/.test(notes[0].message) && notes[0].link === '/retail-orders/problems?show=claims', notes);
  rem = await remindWaitingClaims(db, 't1', { now: now + 30 * 3600e3 });
  check('…once per wait, not every night; one waiting on the customer is theirs, not the shop’s', rem.reminded === 1 && (await all(`${T}/notifications`)).length === 4 && !(await get(`${T}/retailClaims/asked`)).remindedFor, rem);
  rem = await remindWaitingClaims(db, 't1', { now: now + 2 * 864e5 });
  check('…and nothing new the next night', rem.reminded === 0);
  await db.doc(`${T}/retailClaims/asked`).update({ infoResponseText: 'Here it is', infoResponseAt: iso(24) });
  rem = await remindWaitingClaims(db, 't1', { now: now + 3 * 864e5 + 3600e3 });
  check('an answered one starts its two days from the answer', rem.reminded === 1 && !!(await get(`${T}/retailClaims/asked`)).remindedFor);
  await db.doc(T).update({ accessLocked: true });
  await db.doc(`${T}/retailClaims/late`).set({ id: 'late', status: 'in_review', openedAt: iso(-100) });
  check('…and a locked business isn’t nagged', (await remindWaitingClaims(db, 't1', { now: now + 5 * 864e5 })).reminded === 0);
  check('it runs every night', /const \{ remindWaitingClaims \} = await import\('@\/lib\/claim-reminder'\); await remindWaitingClaims\(db, tDoc\.id, \{ tenant: tDoc\.data\(\) \}\);/.test(src('src/app/api/cron/nightly/route.ts')));

  console.log('what the review found');
  const appealed = { status: 'in_review', infoRequestText: 'A photo', infoRequestAt: iso(-60), appealedAt: iso(-2) };
  check('an appeal after an unanswered question comes back to the shop, not under Waiting on them', !V.claimWaiting(appealed) && P.showProblems(P.buildProblems({ orders: [], claims: [{ ...appealed, id: 'ca', orderId: 'oa', customerName: 'Ava Lee', type: 'damaged', lineName: 'Lamp', openedAt: iso(-90) }], now }), 'claims').length === 1 && V.customerClaimStatus(appealed).label === 'Being checked again');
  const part = V.claimRefundable({ lineId: 'A', qty: 3, claimValueCents: 3000 }, { lines: [{ lineId: 'A', qtyOrdered: 3, qtyReturned: 1 }] });
  check('what’s left to refund: part of it returned already is that share of the amount, the same as the server', part.cents === 2000 && part.units === 2 && !part.all && V.claimRefundable({ claimValueCents: 3900 }, null).cents === 3900, part);
  check('the record never reads an unknown history as a first report', !V.recordFacts({}, null, null).some((f) => /report from them/.test(f.text)));
  check('why it wasn’t automatic reads the reasons stamped when it came in', V.whyNotAuto({ claimValueCents: 900, type: 'missing', lineId: 'A', riskFactors: ['High value', '2 prior claims on this email'] }, rs) === 'Not approved on its own: it’s $100 or more, and they’ve made 2 earlier reports.'
    && /there’s a packing photo of the bag/.test(V.whyNotAuto({ claimValueCents: 900, type: 'missing', lineId: 'A', riskFactors: ['Packing photo exists'] }, rs)) && /whole order/.test(V.whyNotAuto({ claimValueCents: 900, type: 'missing' }, rs)));
  const trail = { ...ship, deliveredAt: null, carrierTrail: { carrierStatus: 'DELIVERED', carrierStatusAt: '2026-10-22T12:00:00Z' } };
  check('the carrier’s delivered scan counts the same everywhere: the facts, the carrier claim and the loss', V.recordFacts({}, trail).some((f) => f.text === 'The carrier says it was delivered') && /no claim to file/.test(String(V.carrierLine({ type: 'not_received' }, trail, day, 'UTC'))) && V.deliveredAt(trail) === '2026-10-22T12:00:00Z');
  check('…the carrier’s own status is read first, and a delivered scan with no time never borrows the ship date', V.deliveredAt({ carrierTrail: { status: 'ok', carrierStatus: 'DELIVERED', carrierStatusAt: '2026-10-22T12:00:00Z' } }) === '2026-10-22T12:00:00Z' && V.deliveredAt({ completedAt: '2026-10-20T12:00:00Z', carrierTrail: { carrierStatus: 'DELIVERED' } }) === 'yes');
  check('…nothing left to refund, or a replacement already sent, says so as the reason', /nothing is left to refund/.test(V.whyNotAuto({ claimValueCents: 0, type: 'missing' }, rs)) && V.whyNotAuto({ claimValueCents: 900, type: 'missing', lineId: 'A' }, rs, { replacementOrderId: 'r2' }) === 'Not approved on its own: the order already has a replacement.' && V.whyNotAuto({ claimValueCents: 900, type: 'missing', lineId: 'A' }, rs) === 'Not approved on its own: something on it needed a person.');
  check('a group with no times on it still sorts (never at Infinity)', Number.isFinite(P.showProblems(P.buildProblems({ orders: [], claims: [{ id: 'cz', orderId: 'oz', status: 'in_review', type: 'missing' }], now }), 'claims')[0].at));

  await fresh();
  as({ caps: [] });
  r = await step('requestClaimInfo', { claimId: 'c1', text: 'A photo' });
  check('asking the customer about a report is for those who can decide on it', r.status === 403 && !(await get(`${T}/retailClaims/c1`)).infoRequestText);
  as({});
  for (const bad of [0, -500, 'abc']) {
    r = await step('decideClaim', { claimId: 'c1', approve: true, cents: bad });
    check(`an amount of ${JSON.stringify(bad)} is refused, never read as $0 or as all of it`, r.status === 400 && (await get(`${T}/retailClaims/c1`)).status === 'in_review', r.body);
  }
  await db.doc(`${T}/retailOrders/o1`).update({ lines: [{ lineId: 'A', productId: 'oil', name: 'Rose Cuticle Oil', unitPriceCents: 1000, qtyOrdered: 3, qtyShorted: 0, qtyReturned: 1 }] });
  await db.doc(`${T}/retailClaims/c1`).update({ qty: 3, claimValueCents: 3000, declineReason: 'Earlier no', appealedAt: iso(-1) });
  r = await step('decideClaim', { claimId: 'c1', approve: true });
  c1 = await get(`${T}/retailClaims/c1`);
  const loss = await get(`${T}/inventoryExceptions/claim-c1`);
  check('part of it already returned: the refund is for the rest, and the loss counts only those units', r.body.ok && c1.resolutionCents === 2000 && c1.qtySettled === 2 && loss.qty === 2 && loss.landedCostCents === 900, { c1: [c1.resolutionCents, c1.qtySettled], loss: loss && [loss.qty, loss.landedCostCents] });
  check('…an approved appeal doesn’t carry the old decline reason (kept apart), and its loss is no longer pending', c1.declineReason === null && c1.earlierDeclineReason === 'Earlier no' && c1.lossPending === false);
  await db.doc(`${T}/retailClaims/zz`).set({ id: 'zz', orderId: 'o1', qty: 1, claimValueCents: 900, status: 'in_review', type: 'not_received', customerName: 'Maya Rivera', openedAt: iso(-5) });
  r = await step('decideClaim', { claimId: 'zz', approve: true, cents: null });
  check('everything on the order already put right: a whole-order report can’t be approved for it again', r.body.ok === false && /already been put right/.test(r.body.message) && (await get(`${T}/retailClaims/zz`)).status === 'in_review', r.body);
  const withFile = (await get(`${T}/retailOrders/o1`)).lines;
  await db.doc(`${T}/retailOrders/o1`).update({ lines: [...withFile, { lineId: 'F', productId: 'oil', name: 'Glass File', unitPriceCents: 1200, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0 }] });
  await db.doc(`${T}/retailClaims/z1`).set({ id: 'z1', orderId: 'o1', qty: 1, claimValueCents: 0, status: 'in_review', type: 'not_received', customerName: 'Maya Rivera', openedAt: iso(-5) });
  r = await step('decideClaim', { claimId: 'z1', approve: true, cents: null });
  const z1 = await get(`${T}/retailClaims/z1`);
  check('nothing left to refund: approved with no refund, and the loss still recorded', r.body.ok && z1.status === 'resolved' && z1.resolutionCents === 0 && z1.resolution === 'no_refund' && !!(await get(`${T}/inventoryExceptions/claim-z1`)), z1);
  await db.doc(`${T}/retailClaims/p1`).set({ id: 'p1', orderId: 'o1', lineId: 'A', qty: 1, claimValueCents: 1000, status: 'resolved', type: 'missing', lossPending: true });
  const { sweepClaimLosses } = await import('../../src/lib/claim-loss');
  const swept = await sweepClaimLosses(db, 't1');
  check('an approval whose loss wasn’t recorded straight after is recorded by the nightly run', swept === 1 && !!(await get(`${T}/inventoryExceptions/claim-p1`)) && (await get(`${T}/retailClaims/p1`)).lossPending === false && (await sweepClaimLosses(db, 't1')) === 0);
  check('…one that keeps failing stops after five nights, and the owner is told to add it by hand', /tries >= 5 \? \{ lossPending: false, lossTries: tries, lossFailedAt: at \}/.test(src('src/lib/claim-loss.ts')) && /type: 'claim_loss_failed'/.test(src('src/lib/claim-loss.ts')) && /link: '\/retail-orders\/lost'/.test(src('src/lib/claim-loss.ts')));
  check('…which runs every night', /const \{ sweepClaimLosses \} = await import\('@\/lib\/claim-loss'\); await sweepClaimLosses\(db, tDoc\.id\);/.test(src('src/app/api/cron/nightly/route.ts')));
  const fr = src('src/app/api/retail/fulfil/route.ts');
  check('asking is one step with what it reads, so an answer that lands meanwhile goes into the history', /const asked = await db\.runTransaction\(async \(tx: any\) => \{\s+const cs = await tx\.get\(ref\);/.test(fr) && /requestClaimInfo: 'claims'/.test(fr));
  const crt = src('src/app/api/retail/claims/route.ts');
  check('an answer is one step with what it reads; one from a page opened before a new question isn’t attached to it; a decided report takes no answer', /const bad = await db\.runTransaction\(async \(tx: any\) => \{\s+const \[orderSnap, claimSnap\] = \[await tx\.get\(orderRef\), await tx\.get\(claimRef\)\];/.test(crt) && /if \(res\.status === 409\) await loadClaims\(\);/.test(src('src/app/shop/[tenantId]/order/[orderId]/page.tsx')) && /String\(body\.askedAt\) !== String\(claim\.infoRequestAt\)/.test(crt) && /if \(claim\.status !== 'in_review'\) return \{ status: 409, error: 'The shop has already decided on this report\.' \};/.test(crt) && /askedAt: myClaims\.find\(\(c\) => c\.id === claimId\)\?\.infoRequestAt \|\| null/.test(src('src/app/shop/[tenantId]/order/[orderId]/page.tsx')));
  const cn = src('src/app/api/retail/claim-notify/route.ts');
  check('the decision email: no appeal offered after a second look, no refund line for an approval with none, no old reason on an approval', /decision\.appealedAt\s+\? '<p[^>]*>This was our second look at your report, after your appeal, so this decision is final\.<\/p>'/.test(cn) && /approved \|\| decision\.appealedAt \? 'View my order' : 'View or appeal'/.test(cn) && /cents > 0 \? `, and a refund of <strong>/.test(cn) && /reason: approved \? '' :/.test(cn));
  check('the support page offers Decide in Problems only for a report still to decide', /\{c\.status === 'in_review' && \(\s+<Button asChild size="sm"[^>]*>\s+<Link href=\{`\/retail-orders\/problems\?order=\$\{c\.orderId\}`\}>Decide in Problems<\/Link>/.test(src('src/app/(app)/retail-orders/support/page.tsx')));
  check('a re-declined appeal tells the customer it’s final, on their order page too', /Looked at a second time\. This decision is final\./.test(src('src/app/shop/[tenantId]/order/[orderId]/page.tsx')));

  console.log('the screens');
  const card = src('src/components/orders/ClaimCard.tsx');
  check('the decide sheet asks the server for everything, and writes nothing itself', /decideClaim\(tenantId, claim\.id, true, \{ how, cents: how === 'replacement' \|\| max === 0 \? null : cents \}\)/.test(card) && /decideClaim\(tenantId, claim\.id, false, \{ declineWhy: text \}\)/.test(card) && /requestClaimInfo\(tenantId, claim\.id/.test(card) && !/setDoc|updateDoc|addDoc|deleteDoc|recordInventoryException/.test(card));
  check('…the refund is up to what’s left to refund, worked out as the server does; a photo the policy asks for is needed first', /const left = claimRefundable\(claim, order\);/.test(card) && /const amountOk = max === 0 \|\| \(cents > 0 && cents <= max\);/.test(card) && /disabled=\{\(how !== 'replacement' && !amountOk\) \|\| photoGate \|\| off\}/.test(card) && /const photoGate = claim\.photosRequired && !/.test(card));
  check('…the order that takes over from one just decided waits a moment before it takes a tap, and a decided card stays shut', /if \(gone\) setSettling\(true\);/.test(src('src/components/orders/ProblemsApp.tsx')) && /setTimeout\(\(\) => setSettling\(false\), 700\)/.test(src('src/components/orders/ProblemsApp.tsx')) && /style=\{settling \? \{ pointerEvents: 'none' \} : undefined\}/.test(src('src/components/orders/ProblemPanel.tsx')) && /const off = !!busy \|\| done;/.test(card) && /setDone\(true\);/.test(card));
  check('…with the facts (earlier reports only when they could be read), the history, why it wasn’t automatic, the carrier claim and the packing record', /recordFacts\(claim, order, history \? history\.reports : null\)/.test(card) && /historyLine\(history\)/.test(card) && /whyNotAuto\(claim, rs, order\)/.test(card) && /carrierLine\(claim, order, day, tz\)/.test(card) && /<Link href=\{`\/retail-orders\/evidence\/\$\{claim\.orderId\}`\}/.test(card) && /timeZone: tz/.test(card));
  check('Problems decides reports right there, for those the server lets decide', /<ClaimCard fs=\{fs\} tenantId=\{tenantId\} claim=\{p\.ref\}/.test(src('src/components/orders/ProblemPanel.tsx')) && /canDecide=\{canDecideClaims \?\? canRefund\}/.test(src('src/components/orders/ProblemPanel.tsx')) && /const canDecideClaims = canRefund \|\| \['owner', 'admin', 'manager'\]\.includes\(String\(role \|\| ''\)\);/.test(src('src/components/orders/ProblemsApp.tsx')) && !/Decide in Claims/.test(src('src/components/orders/ProblemPanel.tsx')));
  const app = src('src/components/orders/ProblemsApp.tsx');
  check('…with a filter for each kind, kept in the address, and the panel showing the whole order', /showProblems\(groups, show\)/.test(app) && /u\.searchParams\.set\('show', v\)/.test(app) && /const open = openId \? groups\.find/.test(app) && /aria-pressed=\{show === x\.id\}/.test(app));
  const old = src('src/app/(app)/retail-orders/claims/page.tsx');
  check('the old Claims page sends people to Problems, and nothing links to it', /redirect\('\/retail-orders\/problems\?show=claims'\)/.test(old) && !/'use client'/.test(old) && !/retail-orders\/claims/.test(src('src/components/orders/SetupScreen.tsx') + src('src/app/(app)/retail-orders/support/page.tsx') + src('src/components/orders/ProblemPanel.tsx')));
  const shop = src('src/app/shop/[tenantId]/order/[orderId]/page.tsx');
  check('the customer’s order page says where it is in the same words, and asks for an answer only while one is waited for', /const st = customerClaimStatus\(mc\);/.test(shop) && /const waitingOnMe = claimWaiting\(mc\);/.test(shop) && /\{!waitingOnMe \? \(/.test(shop));
  const words = card + src('src/lib/claim-view.ts') + src('src/lib/claim-reminder.ts') + src('src/lib/claim-loss.ts') + src('src/components/orders/use-customer-history.ts');
  check('the words: no mention of the tool, no "call us", no JSX comments, no emojis', !new RegExp(['cl', 'aude|anth', 'ropic'].join(''), 'i').test(words + app) && !/call us/i.test(words) && !/\{\/\*/.test(card + app) && !/[\u{1F300}-\u{1FAFF}]/u.test(words));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
