// Checks EVERY ITEM SCANNED (lib/scan-rule, lib/retail-fulfill, api/retail/fulfil):
//   - on for every shop unless it's turned off; a tap counts nothing while it's on, whatever screen sends it;
//   - an item that won't scan is approved one unit at a time, by a PIN the server checks (a manager's, or anyone who
//     packs when the shop allows it; never a renter's), with one of the reasons; kept on the line and in the record,
//     with who approved it and who was packing;
//   - an approval or a tap is undone only as what it was (an undo can't turn one into a scan); the business's PIN
//     lockout holds, and a PIN that can't approve never clears it;
//   - evidence (the dispute narrative, the integrity score, claims) calls only scanned units scanned;
//   - a unit ticked by hand before scanning was turned on is scanned to confirm it before the order can be finished;
//   - with the second scan on, a unit picked at the shelf is approved into the box;
//   - the packing screen, the help sheet and Setup follow the same rule.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/scan-rule.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
const afterJobs: Promise<any>[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const line = (x: any = {}) => ({ lineId: 'A', productId: 'files', sku: 'NF-100', barcode: '012345678905', name: 'Nail files 100/180', unitPriceCents: 900, qtyOrdered: 2, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending', ...x });
let pinHash: (t: string, p: string) => string;
const fresh = async (rs: any = {}, lines: any[] = [line()], x: any = {}) => {
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal', retailSettings: rs });
  await db.doc(`${T}/inventory/files`).set({ id: 'files', name: 'Nail files 100/180', type: 'retail', status: 'active', totalStock: 10, stockReserved: 2, batches: [{ id: 'b1', stock: 10, costPerUnit: 2, receivedDate: '2026-01-01' }], barcode: '012345678905' });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', tenantId: 't1', orderNumber: 1201, stage: 'paid', method: 'counter', lines, customerName: 'Dana R', customerEmail: 'dana@example.com', qrToken: 'o1.abcdef', totalCents: 1800, placedAt: '2026-11-13T10:00:00Z', paidAt: '2026-11-13T10:00:00Z', ...x });
  // Andre manages, Kai packs, Rae rents a station: each with a PIN.
  await db.doc(`${T}/staff/m1`).set({ name: 'Andre Cole', role: 'manager', hasPin: true });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'staff', hasPin: true });
  await db.doc(`${T}/staff/r1`).set({ name: 'Rae Lin', role: 'renter', isRenter: true, hasPin: true });
  await db.doc(`${T}/staffSecrets/m1`).set({ pinHash: pinHash('t1', '4321') });
  await db.doc(`${T}/staffSecrets/k1`).set({ pinHash: pinHash('t1', '1111') });
  await db.doc(`${T}/staffSecrets/r1`).set({ pinHash: pinHash('t1', '2222') });
};
const as = (x: any = {}) => { actor = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [], ...x }; };

(async () => {
  pinHash = (await import('../../src/lib/approvals')).pinHash;
  const R = await import('../../src/lib/scan-rule');
  const { eventWords } = await import('../../src/lib/order-events');
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await POST(req({ tenantId: 't1', action, ...args })); await settle(); return r; };
  const O = async () => (await get(`${T}/retailOrders/o1`));
  const L = async () => (await O()).lines[0];

  // ── The rule ──
  check('every item is scanned unless the shop turned it off', R.scanRequired({}) && R.scanRequired(undefined) && R.scanRequired({ requireScan: true }) && !R.scanRequired({ requireScan: false }));
  check('managers approve unless the shop lets anyone who packs', R.approversOf({}) === 'managers' && R.approversOf({ scanApprovers: 'packers' }) === 'packers' && R.approversOf({ scanApprovers: 'x' }) === 'managers');
  check('a manager may always approve; a packer only when the shop allows it; a picker never',
    R.mayApprove({ canManage: true }, 'managers') && !R.mayApprove({ canPack: true }, 'managers') && R.mayApprove({ canPack: true }, 'packers') && !R.mayApprove({ canPack: false }, 'packers') && !R.mayApprove(null, 'packers'));
  const c = R.lineCounts({ qtyOrdered: 3, qtyScanned: 3, qtyApproved: 1, qtyTapped: 1 });
  check('a line’s units by how they were counted', c.owed === 3 && c.counted === 3 && c.scanned === 1 && c.approved === 1 && c.tapped === 1, c);
  const junk = R.lineCounts({ qtyOrdered: 2, qtyScanned: 1, qtyApproved: 5, qtyTapped: 'x' });
  check('…never more approved or ticked than counted, whatever the data says', junk.approved === 1 && junk.tapped === 0 && junk.scanned === 0, junk);
  const oc = R.orderCounts([{ qtyOrdered: 2, qtyScanned: 2, qtyApproved: 1 }, { qtyOrdered: 1, qtyScanned: 1 }, { digital: true, qtyOrdered: 1, qtyScanned: 0 }]);
  check('the order’s units by how they were counted (downloads have nothing to count)', oc.scanned === 2 && oc.approved === 1 && oc.units === 3, oc);
  check('who approved a line, in words', R.approvedByWords({ approvals: [{ by: 'Andre Cole' }, { by: 'Maya Ito' }, { by: 'Andre Cole' }] }) === 'Andre and Maya' && R.approvedByWords({}) === '');
  check('only the three reasons', R.isApproveReason('No barcode yet') && R.isApproveReason('Barcode won’t read') && R.isApproveReason('Label is damaged') && !R.isApproveReason('Busy'));

  // ── On by default: a tap counts nothing ──
  await fresh({}); as();
  let r = await step('claimOrder', { orderId: 'o1' });
  r = await step('tapLine', { orderId: 'o1', lineId: 'A' });
  check('a shop that never touched the setting scans every item: a tap is refused on the server, nothing counted', !r.body.ok && /scanned here/.test(r.body.message) && (await L()).qtyScanned === 0, r.body);

  // ── An item that won't scan: approved by a manager's PIN ──
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'Too busy', pin: '4321' });
  check('a reason has to be one of the three', r.status === 400 && (await L()).qtyScanned === 0);
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '12' });
  check('a PIN is 4 digits', r.status === 400);
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '9999' });
  const nobody = r.body.message;
  check('a PIN nobody has is refused, with where PINs are set', r.status === 403 && /Staff page/.test(r.body.message) && (await L()).qtyScanned === 0, r.body);
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '1111' });
  check('a packer’s own PIN doesn’t approve while only managers may', r.status === 403 && /manager/.test(r.body.message) && (await L()).qtyScanned === 0, r.body);
  check('…and the answer is the same as for a PIN nobody has, so a guess learns nothing about whose it is', r.body.message === nobody);
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '4321' });
  let l = await L();
  check('a manager’s PIN approves one unit: counted as picked and in the bag', r.body.ok && r.body.kind === 'picked' && l.qtyScanned === 1 && l.qtyPacked === 1 && l.qtyApproved === 1, { r: r.body, l });
  check('…kept on the line: who approved it and why', l.approvals?.length === 1 && l.approvals[0].by === 'Andre Cole' && l.approvals[0].byId === 'm1' && l.approvals[0].reason === 'No barcode yet' && !!l.approvals[0].at, l.approvals);
  let evs = await all(`${T}/retailOrders/o1/events`);
  const ov = evs.find((e: any) => e.type === 'override');
  check('…and in the record as a rule set aside: the item, the reason, who approved it, and the person packing', ov && ov.meta.rule === 'unit_approved' && ov.meta.approvedBy === 'Andre Cole' && ov.meta.reason === 'No barcode yet' && ov.actorName === 'Kai Park', ov);
  check('…in words', eventWords(ov).text === 'Nail files 100/180 approved without a scan: No barcode yet, by Andre Cole · Kai Park', eventWords(ov).text);
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'Label is damaged', pin: '4321' });
  check('two of the same take two approvals', r.body.ok && (await L()).qtyApproved === 2 && (await L()).qtyScanned === 2 && r.body.pickComplete === true, r.body);
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '4321' });
  check('…and never more than were ordered', !r.body.ok && /already in/.test(r.body.message) && (await L()).qtyApproved === 2, r.body);
  r = await step('undoCount', { orderId: 'o1', lineId: 'A', what: 'check', via: 'approve' });
  check('an undo can’t take an approval off and leave its unit counted (the request says check, the approval was a count)', !r.body.ok && (await L()).qtyApproved === 2 && (await L()).approvals.length === 2, r.body);
  r = await step('undoCount', { orderId: 'o1', lineId: 'A', what: 'box', via: 'tap' });
  check('…nor take off a tick that isn’t there', !r.body.ok && (await L()).qtyScanned === 2, r.body);
  r = await step('undoCount', { orderId: 'o1', lineId: 'A', what: 'box', via: 'approve' });
  l = await L();
  check('an approval is undone exactly: the unit back out, the approval off the line', r.body.ok && l.qtyScanned === 1 && l.qtyPacked === 1 && l.qtyApproved === 1 && l.approvals.length === 1 && l.approvals[0].reason === 'No barcode yet' && l.approvals[0].phase === 'pick', l);
  r = await step('scanBox', { orderId: 'o1', value: '012345678905' });
  l = await L();
  check('the last one scanned: one scanned, one approved', r.body.ok && R.lineCounts(l).scanned === 1 && R.lineCounts(l).approved === 1, l);
  r = await step('markPacked', { orderId: 'o1' });
  check('…and the order finishes', r.body.ok && (await O()).stage === 'packed', r.body);
  // What evidence may say about it: one scanned, one approved.
  const { buildNarrative } = await import('../../src/lib/retail-dispute-evidence');
  const { computeIntegrityScore } = await import('../../src/lib/integrity-score');
  const told = buildNarrative({ ...(await O()), method: 'ship' }, { name: 'Opal' });
  check('the dispute narrative calls only scanned units scanned, and says how the other was counted', /1 of 2 units were barcode-scanned/.test(told) && /1 unit was counted in without a scan, each approved with a staff PIN and a recorded reason/.test(told) && !/Every unit was barcode-scanned/.test(told), told.slice(told.indexOf('VERIFICATION')));
  const score = computeIntegrityScore({ lines: (await O()).lines, method: 'counter', stage: 'packed' } as any);
  check('…the integrity score’s “every unit scanned” doesn’t pass on an approved unit', score.checks.find((x) => x.label === 'Every unit scanned')?.ok === false, score.checks);
  check('…and does when every unit was scanned', R.everyUnitScanned([{ qtyOrdered: 2, qtyScanned: 2 }, { qtyOrdered: 1, qtyShorted: 1, qtyScanned: 0, status: 'refunded' }, { digital: true, qtyOrdered: 1 }]) && !R.everyUnitScanned([{ qtyOrdered: 1, qtyScanned: 1, qtyTapped: 1 }]) && !R.everyUnitScanned([]));
  const all2 = buildNarrative({ lines: [{ name: 'Gel', qtyOrdered: 2, qtyScanned: 2 }], method: 'ship' }, { name: 'Opal' });
  check('…a fully scanned order still says every unit was scanned', /Every unit was barcode-scanned against this order as it was picked and packed: 2 of 2 units scanned/.test(all2));
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '4321' });
  check('nothing is approved once packing is done', !r.body.ok && (await L()).qtyApproved === 1, r.body);

  // ── Anyone who packs, when the shop allows it; never a renter ──
  await fresh({ scanApprovers: 'packers' }); as();
  await step('claimOrder', { orderId: 'o1' });
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'Barcode won’t read', pin: '2222' });
  check('a renter’s PIN never approves the shop’s items', r.status === 403 && (await L()).qtyScanned === 0, r.body);
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'Barcode won’t read', pin: '1111' });
  check('with “anyone who packs”, a packer’s own PIN approves, by name', r.body.ok && (await L()).approvals[0].by === 'Kai Park', r.body);

  // ── Turned off: taps count, marked as taps; turned back on mid-order: scan to confirm ──
  await fresh({ requireScan: false }); as();
  await step('claimOrder', { orderId: 'o1' });
  r = await step('tapLine', { orderId: 'o1', lineId: 'A' });
  r = await step('tapLine', { orderId: 'o1', lineId: 'A' });
  l = await L();
  check('with scanning off, a tap counts, marked as a tap on the line', r.body.ok && l.qtyScanned === 2 && l.qtyTapped === 2, l);
  evs = await all(`${T}/retailOrders/o1/events`);
  check('…and the record says ticked, not scanned', evs.some((e: any) => e.type === 'item_scanned' && /^Ticked/.test(eventWords(e).text)));
  await db.doc(T).set({ retailSettings: { requireScan: true } }, { merge: true });
  r = await step('markPacked', { orderId: 'o1' });
  check('scanning turned on before it’s finished: the ticked units are scanned to confirm first', !r.body.ok && /ticked by hand/.test(r.body.message) && /each one/.test(r.body.message) && (await O()).stage === 'picking', r.body);
  r = await step('scanBox', { orderId: 'o1', value: '012345678905' });
  l = await L();
  check('a scan confirms one: nothing more is counted', r.body.ok && r.body.kind === 'confirmed' && l.qtyScanned === 2 && l.qtyTapped === 1, { r: r.body, l });
  await step('scanBox', { orderId: 'o1', value: '012345678905' });
  r = await step('scanBox', { orderId: 'o1', value: '012345678905' });
  check('…and a third scan of a line already confirmed counts nothing', !r.body.ok && (await L()).qtyTapped === 0 && (await L()).qtyScanned === 2, r.body);
  r = await step('markPacked', { orderId: 'o1' });
  check('…then it finishes', r.body.ok && (await O()).stage === 'packed', r.body);
  await fresh({ requireScan: false }); as();
  await step('claimOrder', { orderId: 'o1' });
  await step('tapLine', { orderId: 'o1', lineId: 'A' });
  r = await step('undoCount', { orderId: 'o1', lineId: 'A', what: 'scan', via: 'tap' });
  check('a tap is undone exactly', r.body.ok && (await L()).qtyScanned === 0 && (await L()).qtyTapped === 0, await L());

  // ── The second scan: a unit picked at the shelf is approved into the box ──
  await fresh({ requirePackScan: true }, [line({ qtyScanned: 2, status: 'picked' })], { stage: 'picking', claimedBy: 'k1', claimedByName: 'Kai Park' }); as();
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'Label is damaged', pin: '4321' });
  l = await L();
  check('with the second scan on, a unit picked at the shelf is approved into the box', r.body.ok && r.body.kind === 'checked' && l.qtyPacked === 1 && l.qtyScanned === 2 && l.qtyApprovedIn === 1 && !l.qtyApproved && l.approvals[0].phase === 'check', { r: r.body, l });
  check('…it was still scanned once at the shelf, so evidence counts it as scanned', R.lineCounts(l).scanned === 2 && R.lineCounts(l).approved === 0 && R.lineCounts(l).approvedIn === 1, R.lineCounts(l));
  r = await step('undoCount', { orderId: 'o1', lineId: 'A', what: 'box', via: 'approve' });
  check('…undone only as a check into the box', !r.body.ok && (await L()).qtyScanned === 2, r.body);
  r = await step('undoCount', { orderId: 'o1', lineId: 'A', what: 'check', via: 'approve' });
  check('…which takes the unit back out of the box and the approval off', r.body.ok && (await L()).qtyPacked === 0 && (await L()).qtyApprovedIn === 0 && (await L()).qtyScanned === 2 && (await L()).approvals.length === 0, await L());
  await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'Label is damaged', pin: '4321' });
  r = await step('markPacked', { orderId: 'o1' });
  check('…and the other still needs its scan into the box', !r.body.ok && /scan every item again/i.test(r.body.message), r.body);

  // ── What can't be approved ──
  await fresh({}, [line({ lineId: 'D', digital: true, name: 'Course', qtyOrdered: 1 })]); as();
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'picking' }, { merge: true });
  r = await step('approveUnit', { orderId: 'o1', lineId: 'D', reason: 'No barcode yet', pin: '4321' });
  check('a download has nothing to approve', !r.body.ok && /download/.test(r.body.message), r.body);
  await fresh({}, [line({ status: 'refunded', qtyShorted: 2 })], { stage: 'picking' }); as();
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '4321' });
  check('a line marked missing isn’t approved in', !r.body.ok && /marked missing/.test(r.body.message), r.body);

  // ── The PIN lockout holds ──
  await fresh({}); as();
  await step('claimOrder', { orderId: 'o1' });
  for (let i = 0; i < 15; i++) await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: String(5000 + i) });
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '4321' });
  check('fifteen wrong PINs lock approvals for the business, even with the right one', r.status === 423 && (await L()).qtyScanned === 0, r.body);
  await fresh({}); as();
  await step('claimOrder', { orderId: 'o1' });
  for (let i = 0; i < 14; i++) await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: String(6000 + i) });
  await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '1111' });
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '4321' });
  check('a person’s own PIN, which can’t approve, never clears the count: fourteen guesses and theirs still lock it', r.status === 423 && (await L()).qtyScanned === 0, r.body);
  await fresh({}); as();
  await step('claimOrder', { orderId: 'o1' });
  const { beginPinAttempt, endPinAttempt } = await import('../../src/lib/pin');
  for (let i = 0; i < 14; i++) await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: String(7000 + i) });
  const punch = await beginPinAttempt(db, 't1'); await endPinAttempt(db, 't1', punch, true);
  check('a right PIN on another screen takes back only its own place', (await get(`${T}/private/pinGuard`)).failedAt.length === 14);
  await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '7999' });
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '4321' });
  check('…nor does a right PIN on any other screen (a time clock punch): wrong ones only age out', r.status === 423 && (await L()).qtyScanned === 0, r.body);
  // Tries sent all at once each take their own place: a burst can't slip past the limit.
  await fresh({}); as();
  await step('claimOrder', { orderId: 'o1' });
  await Promise.all(Array.from({ length: 30 }, (_, i) => step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: String(8000 + i) })));
  const g = await get(`${T}/private/pinGuard`);
  r = await step('approveUnit', { orderId: 'o1', lineId: 'A', reason: 'No barcode yet', pin: '4321' });
  check('thirty wrong PINs sent at once: never more than fifteen get through, and the lock closes', g.failedAt.length === 15 && r.status === 423, { n: g.failedAt.length, r: r.body });

  // ── The staff portal's scans confirm a ticked unit too; with the second scan on, one scan does it ──
  await fresh({ requireScan: false }); as();
  await step('claimOrder', { orderId: 'o1' });
  await step('tapLine', { orderId: 'o1', lineId: 'A' }); await step('tapLine', { orderId: 'o1', lineId: 'A' });
  await db.doc(T).set({ retailSettings: { requireScan: true } }, { merge: true });
  r = await step('scanItem', { orderId: 'o1', value: '012345678905' });
  check('a scan from the staff portal confirms a unit ticked by hand', r.body.ok && r.body.kind === 'confirmed' && (await L()).qtyTapped === 1 && (await L()).qtyScanned === 2, r.body);
  await fresh({ requireScan: false }); as();
  await step('claimOrder', { orderId: 'o1' });
  await step('tapLine', { orderId: 'o1', lineId: 'A' }); await step('tapLine', { orderId: 'o1', lineId: 'A' });
  await db.doc(T).set({ retailSettings: { requireScan: true, requirePackScan: true } }, { merge: true });
  r = await step('scanBox', { orderId: 'o1', value: '012345678905', secondScan: true });
  l = await L();
  check('with the second scan on, the scan that checks a ticked unit into the box confirms it too: one scan, not two', r.body.ok && r.body.kind === 'checked' && l.qtyPacked === 1 && l.qtyTapped === 1, { r: r.body, l });
  await step('scanBox', { orderId: 'o1', value: '012345678905', secondScan: true });
  r = await step('markPacked', { orderId: 'o1' });
  check('…so two scans finish two ticked units', r.body.ok && (await O()).stage === 'packed' && (await L()).qtyTapped === 0, r.body);

  // ── One lock for every PIN: no screen keeps its own counter ──
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []);
  const pinRoutes = walk('src/app').filter((f) => /findStaffByPin\(|findByPin\(/.test(src(f)));
  check('every place that checks a PIN counts the try on the business’s one lock first', pinRoutes.length >= 7 && pinRoutes.every((f) => /beginPinAttempt\(db, tenantId\)/.test(src(f)) && /endPinAttempt\(db, tenantId, ticket,/.test(src(f))), pinRoutes.filter((f) => !/beginPinAttempt\(/.test(src(f))));
  check('…and none keeps a counter of its own', !pinRoutes.some((f) => /approvalGuard|private\/portalAuth|pinLocked|recordPinAttempt/.test(src(f))));

  // ── The screens follow the same rule ──
  const pack = src('src/components/orders/workspace/PackPane.tsx');
  check('the packing list taps in only when the shop doesn’t scan every item', /const required = scanRequired\(rs\);/.test(pack) && /const canTap = !required && rs\?\.requirePackScan !== true;/.test(pack));
  check('…otherwise a tap opens the help for an item that won’t scan', /if \(!canTap\) \{ setErr\(''\); setLearn\(null\); setCant\(l\); return; \}/.test(pack) && /<CantScanSheet /.test(pack));
  check('…an approval is undone as an approval', /via: 'approve'/.test(pack) && /undo\.via \|\| 'scan'/.test(pack));
  check('…the main button says how many are left to scan, counting units ticked by hand that still need their scan', /`\$\{left\} more to scan`/.test(pack) && /const ticked = !required \? 0 : boxMode/.test(pack) && /: orderCounts\(order\.lines \|\| \[\]\)\.tapped;/.test(pack));
  const sheet = src('src/components/orders/CantScanSheet.tsx');
  check('the help sheet: type the number, print its label, or approve with a PIN and a reason', /Type the number under the barcode/.test(sheet) && /\/inventory\/labels\?ids=/.test(sheet) && /APPROVE_REASONS\.map/.test(sheet) && /type="password"/.test(sheet));
  const setup = src('src/components/orders/SetupScreen.tsx');
  check('Setup: one switch and who approves, saved on the shop’s settings', /'retailSettings\.requireScan': !on/.test(setup) && /'retailSettings\.scanApprovers': v/.test(setup) && /<ScanningGroup /.test(setup));
  const settings = src('src/app/(app)/retail-orders/settings/page.tsx');
  check('Shop settings shows it on unless it was turned off, and saves it the same way', /requireScan: existing\.requireScan !== false/.test(settings) && /requireScan: rs\.requireScan !== false/.test(settings) && /checked=\{rs\.requireScan !== false\}/.test(settings));
  for (const [name, text] of [['help sheet', sheet], ['scanning group', setup.slice(setup.indexOf('function ScanningGroup'), setup.indexOf('function Steps'))]] as [string, string][]) {
    check(`the ${name} has no all-caps, no heavy weight and the real apostrophe`, !/\buppercase\b|font-black/.test(text) && !/[a-z]'[a-z]/i.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, '')));
  }
  const route = src('src/app/api/retail/fulfil/route.ts');
  check('the server reads the rules itself: taps, finishing and scans at the box', /recordLineTap\(db, tenantId, orderId, lineId, actor, \{ scanRequired: \(await scanSettings\(db, tenantId\)\)\.required \}\)/.test(route) && /requireScan: rules\.required/.test(route) && /confirmTaps: \(await scanSettings\(db, tenantId\)\)\.required/.test(route));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
