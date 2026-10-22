// Checks every label is kept and followed (lib/label-boxes, lib/label-records, lib/label-void, lib/label-sweep voidBox):
// boxes told apart, a box's new label put in its place, refunds asked for and written down per box, confirmed refunds
// into the books once, turned-down ones under Needs you, carrier adjustments from Shippo's invoices, and one purchase
// at a time.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/label-records.verify.ts
import { makeDb, check, failures } from './fake-db';
import { boxShare, boxTrail, labelSlots, liveTracking, reasonLine, recordOf, slotPatch, slotsKnown, voidedSlots } from '../../src/lib/label-boxes';
import { labelDoubt } from '../../src/lib/label-doubt';
import { labelBoxes, labelMatchesOrder } from '../../src/lib/totes';
import { voidOrderLabels, voidUnsavedLabel } from '../../src/lib/label-void';
import { voidBox, voidIfUnused, keepBoxes } from '../../src/lib/label-sweep';
import { BUY_STALE_MS, boxesOf, claimLabelBuy, followRefunds, importCarrierCharges, newLabelRecord, noteRefundRequests, releaseLabelBuy, withdrawRefund } from '../../src/lib/label-records';
import { needsYou } from '../../src/lib/orders-view';

const realFetch = globalThis.fetch;
type Handler = (url: string, init?: any) => any;
let calls: string[] = [];
const serve = (h: Handler) => {
  calls = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url); calls.push(`${init?.method || 'GET'} ${u.replace('https://api.goshippo.com', '')}`);
    const r = h(u, init);
    if (r === 'throw') throw new Error('timed out');
    const { status = 200, body = {} } = r || { status: 404 };
    return { ok: status >= 200 && status < 300, status, json: async () => body } as any;
  }) as any;
};
const T = 'shop';
const OR = (id: string) => `tenants/${T}/retailOrders/${id}`;
const LR = (id: string) => `tenants/${T}/shippingLabels/${id}`;

(async () => {
  // ── Boxes told apart ──────────────────────────────────────────────────────
  const two = { shippoTransactionId: 'A', trackingNumber: '9400111899223', labelUrl: 'uA', trackingUrl: 'tA', extraTrackingNumbers: ['9400222899223'], extraLabelUrls: ['uB'], extraTrackingUrls: ['tB'], labelTxns: ['A', 'B'], labelRecs: ['A', 'A'], packageCount: 2 };
  check('each box keeps its own label, tracking and record', labelSlots(two).map((s) => `${s.slot}:${s.txn}:${s.tracking}:${s.record}`).join() === '0:A:9400111899223:A,1:B:9400222899223:A' && slotsKnown(two));
  const voidedTwo = { ...two, labelVoidIds: ['B'] };
  check('a box listed as voided is voided; the other still works', voidedSlots(voidedTwo).map((s) => s.slot).join() === '1' && liveTracking(voidedTwo).join() === '9400111899223');
  check('an order bought before boxes were kept apart never reads a box as voided', voidedSlots({ ...voidedTwo, labelTxns: undefined }).length === 0 && !slotsKnown({ ...two, labelTxns: undefined }));
  check('the bench check skips a voided box’s label, so it can’t pass as checked', labelBoxes(voidedTwo).join() === '9400111899223' && !labelMatchesOrder('9400222899223', voidedTwo) && labelMatchesOrder('420900009400111899223', voidedTwo));
  const p1 = slotPatch({ ...voidedTwo, labelsChecked: ['9400111899223', '9400222899223'], labelCheckedAt: 'x' }, 1, { txn: 'C', tracking: '9400333899223', labelUrl: 'uC', trackingUrl: 'tC', record: 'C' });
  check('box 2’s new label goes in box 2’s place, the old one comes off the voided list, and the box needs checking again',
    !!p1 && p1.extraTrackingNumbers.join() === '9400333899223' && p1.extraLabelUrls.join() === 'uC' && p1.labelTxns.join() === 'A,C' && p1.labelRecs.join() === 'A,C' && p1.labelVoidIds.length === 0
      && p1.relabelOpen === false && p1.labelCheckedAt === null && p1.labelsChecked.join() === '9400111899223' && p1.shippoTransactionId === 'A' && p1.packageCount === 2, p1);
  const p0 = slotPatch({ ...two, labelVoidIds: ['A'] }, 0, null);
  check('box 1 taken off the order: box 2 becomes the order’s first box, every field moving together',
    !!p0 && p0.trackingNumber === '9400222899223' && p0.labelUrl === 'uB' && p0.shippoTransactionId === 'B' && p0.extraTrackingNumbers.length === 0 && p0.labelTxns.join() === 'B' && p0.packageCount === 1 && p0.labelVoidIds.length === 0, p0);
  check('only a voided box can come off, and never the last one', slotPatch(two, 1, null) === null && slotPatch({ ...two, labelTxns: ['A'], extraTrackingNumbers: [], extraLabelUrls: [], labelVoidIds: ['A'] }, 0, null) === null);
  check('box shares of a label’s price always add up to the whole', [boxShare(910, 2, 0), boxShare(910, 2, 1)].join() === '455,455' && [0, 1, 2].map((i) => boxShare(1000, 3, i)).reduce((a, b) => a + b, 0) === 1000 && boxShare(1000, 3, 0) === 334);
  check('why a label was replaced, in words', reasonLine({ kind: 'size' }) === 'Wrong box size or weight' && reasonLine({ kind: 'other', note: 'Smudged' }) === 'Smudged' && reasonLine({ kind: 'damaged', note: 'torn' }) === 'The label is damaged or won’t scan: torn');
  check('each box’s carrier scans are read from where the shipping webhook keeps them',
    boxTrail({ ...two, carrierTrail: { trackingNumber: '9400111899223', carrierStatus: 'TRANSIT', carrierStatusAt: '2026-10-22', carrierLocation: 'Austin, TX' } }, 0).where === 'Austin, TX'
      && boxTrail({ ...two, boxStatus: { '9400222899223': 'DELIVERED' } }, 1).status === 'DELIVERED' && boxTrail(two, 1).status === ''
      && boxTrail({ ...two, carrierTrail: { trackingNumber: 'old', carrierStatus: 'TRANSIT' } }, 0).status === '');
  check('the record each box was bought on', recordOf(p1 ? { ...voidedTwo, ...p1 } : two, 1) === 'C' && recordOf({ shippoTransactionId: 'L', trackingNumber: '1' }, 0) === 'L');

  // ── A box waiting for its new label holds the order back, even once another box is moving ──
  check('a voided box with its boxes known apart: the order waits for its new label, moving or not',
    labelDoubt(voidedTwo) === 'relabel' && labelDoubt({ ...voidedTwo, labelSeenMoving: 'x' }) === 'relabel' && labelDoubt({ ...voidedTwo, labelVoiding: { txn: 'A' } }) === 'voiding');
  check('boxes that can’t be told apart keep the earlier rules', labelDoubt({ shippoTransactionId: 'A', labelVoidIds: ['A'] }) === 'partial' && labelDoubt({ shippoTransactionId: 'A', labelVoidIds: ['A'], labelSeenMoving: 'x' }) === null);
  check('after a void that stopped part way, the order keeps each box’s label once looked up, and is flagged for new labels once a box is out',
    JSON.stringify(keepBoxes({ shippoTransactionId: 'A', trackingNumber: '1', extraTrackingNumbers: ['2'], extraLabelUrls: ['u'] }, { boxTxns: ['A', 'B'], voidedIds: ['B'] })) === JSON.stringify({ labelTxns: ['A', 'B'], relabelOpen: true })
      && JSON.stringify(keepBoxes(two, { voidedIds: ['B'] }, false)) === '{}');

  // ── Voids still in doubt are settled before any box gets a new label ──
  check('a void still under way, or handed over unfinished, comes before a box’s new label; kept, the box can have one',
    labelDoubt({ ...voidedTwo, labelVoiding: { txn: 'A' } }) === 'voiding'
      && labelDoubt({ ...voidedTwo, labelUnscannedOpen: true, labelUnscanned: { why: 'void_unfinished' } }) === 'unfinished'
      && labelDoubt({ ...voidedTwo, labelUnscannedOpen: false, labelUnscanned: { why: 'void_unfinished', dismissedAt: 'x' } }) === 'relabel');
  check('an older order’s boxes, once told apart, all belong to the first box’s record',
    recordOf({ shippoTransactionId: 'M', trackingNumber: '9400111899223', extraTrackingNumbers: ['9400222899223'], extraLabelUrls: ['u2'], labelUrl: 'u1', labelTxns: ['M', 'M2'] }, 1) === 'M');

  // ── Refunds asked for, written per box on the label record ──
  let db = makeDb();
  db._store.set(LR('A'), newLabelRecord({ id: 'A', order: { orderNumber: 1042, customerName: 'Dana Whitfield' }, orderId: 'o1', carrier: 'USPS', service: 'Ground Advantage', rateId: 'r',
    boxes: [{ txn: 'A', tracking: '9400111899223', labelUrl: 'uA', trackingUrl: '' }, { txn: 'B', tracking: '9400222899223', labelUrl: 'uB', trackingUrl: '' }], amountCents: 910, at: '2026-10-20T15:00:00Z', by: { id: 'u1', name: 'Jo Smith' }, how: 'single' }));
  db._store.set(OR('o1'), { ...two, stage: 'packed', carrier: 'USPS' });
  serve((u, init) => (u.endsWith('/refunds/') ? { status: 201, body: { object_id: `rf-${JSON.parse(init.body).transaction}`, status: 'QUEUED' } } : null));
  let v = await voidOrderLabels(db, T, db._store.get(OR('o1')), 'k', { orderId: 'o1', why: 'voided by hand' });
  let rec = db._store.get(LR('A'));
  check('a label whose boxes are known is voided box by box, with no lookup of its rate', v.ok && calls.filter((c) => c.startsWith('POST')).length === 2 && !calls.some((c) => c.includes('?rate=')), calls);
  check('each box’s refund is written on the label record with its share and Shippo’s refund, not in the books yet',
    rec.refunds.A?.status === 'requested' && rec.refunds.A.cents === 455 && rec.refunds.B.cents === 455 && rec.refunds.B.refundId === 'rf-B' && rec.refundOpen === true && rec.refundCents === 910 && !!rec.voidedAt && rec.voidWhy === 'voided by hand'
      && ![...db._store.keys()].some((k) => k.includes('/transactions/')), rec);
  await noteRefundRequests(db, T, db._store.get(OR('o1')), 'o1', [{ txn: 'A', refundId: 'again' }]);
  check('a box already asked for isn’t asked for twice', db._store.get(LR('A')).refunds.A.refundId === 'rf-A' && db._store.get(LR('A')).refundCents === 910);
  // A label bought before records existed: its record is made from the order and the postage in the books.
  db = makeDb();
  db._store.set(`tenants/${T}/transactions/postage-L`, { amount: 8.4 });
  db._store.set(OR('o2'), { shippoTransactionId: 'L', trackingNumber: '777', carrier: 'USPS', stage: 'packed', orderNumber: 7, customerName: 'Sam Lee', shipmentProtection: { decidedAt: '2026-10-01T00:00:00Z' } });
  v = await voidOrderLabels(db, T, db._store.get(OR('o2')), 'k', { orderId: 'o2', why: 'the address changed' });
  rec = db._store.get(LR('L'));
  check('an older label gets its record the first time it’s voided, priced from the books', v.ok && rec?.how === 'earlier' && rec.amountCents === 840 && rec.refunds.L?.cents === 840 && rec.orderId === 'o2' && rec.orderIds.join() === 'o2' && rec.boughtAt === '2026-10-01T00:00:00Z', rec);
  // The same void with no order named (a label voided straight after buying it): nothing is written.
  db = makeDb();
  v = await voidOrderLabels(db, T, { shippoTransactionId: 'N', labelTxns: ['N'], trackingNumber: '1', labelUrl: 'u' }, 'k');
  check('a label voided straight after it was bought leaves no record (it was never in the books)', v.ok && db._store.size === 0);
  // An older multi-box label: found through its rate, and each box matched to its place by tracking number.
  db = makeDb();
  serve((u) => (u.endsWith('/refunds/') ? { status: 201, body: { status: 'QUEUED' } } : u.endsWith('/transactions/M') ? { body: { rate: 'r1' } }
    : u.includes('?rate=r1') ? { body: { results: [{ object_id: 'M', status: 'SUCCESS', tracking_number: '1' }, { object_id: 'M3', status: 'SUCCESS', tracking_number: '3' }, { object_id: 'M2', status: 'SUCCESS', tracking_number: '2' }] } } : null));
  v = await voidOrderLabels(db, T, { shippoTransactionId: 'M', trackingNumber: '1', extraTrackingNumbers: ['2', '3'], extraLabelUrls: ['u2', 'u3'], labelUrl: 'u1' }, 'k');
  check('an older label’s boxes, found through its rate, come back in box order for the order to keep', v.ok && (v.boxTxns || []).join() === 'M,M2,M3', v);
  db = makeDb();
  serve((u) => (u.endsWith('/refunds/') ? { status: 429, body: { detail: 'Too many requests' } } : null));
  v = await voidOrderLabels(db, T, { shippoTransactionId: 'N2', labelTxns: ['N2'], trackingNumber: '1', labelUrl: 'u' }, 'k');
  check('Shippo too busy to look counts as no answer (the void is tried again), never as a refusal', !v.ok && v.outcome === 'unknown' && v.unanswered === 1, v);

  // ── A label bought for an order that changed meanwhile: its refunds are written down before Shippo is asked ──
  db = makeDb();
  serve((u) => (u.endsWith('/refunds/') ? 'throw' : null));
  let uv = await voidUnsavedLabel(db, T, 'k', { orderId: 'o8', order: { orderNumber: 1050 }, boxes: [{ txn: 'U1', tracking: '9400U1', labelUrl: 'u', trackingUrl: '' }], cents: 640, carrier: 'USPS', by: { id: 'u1', name: 'Maya' }, how: 'single' });
  rec = db._store.get(LR('U1'));
  check('voided straight after buying it, and Shippo doesn’t answer: its refund is written down anyway, so the morning follow-up asks again',
    uv?.outcome === 'unknown' && rec?.refunds?.U1?.status === 'requested' && rec.refunds.U1.refundId === null && rec.refundOpen === true && db._store.get(`tenants/${T}/transactions/postage-U1`)?.amount === 6.4, { uv, rec });
  db = makeDb();
  serve((u) => (u.endsWith('/refunds/') ? { status: 201, body: { object_id: 'rf-U2', status: 'QUEUED' } } : null));
  uv = await voidUnsavedLabel(db, T, 'k', { orderId: 'o8', order: { orderNumber: 1050 }, boxes: [{ txn: 'U2', tracking: '9400U2', labelUrl: 'u', trackingUrl: '' }], cents: 640, carrier: 'USPS', by: { id: 'u1', name: 'Maya' }, how: 'single' });
  check('…and when Shippo answers, the refund carries its id', uv?.outcome === 'voided' && db._store.get(LR('U2')).refunds.U2.refundId === 'rf-U2' && db._store.get(LR('U2')).refunds.U2.cents === 640);
  // The record can't be written at first: Shippo is asked anyway, and the record is written once it can be.
  db = makeDb();
  const docOf = db.doc; let failsLeft = 1;
  db.doc = (path: string) => { const r = docOf(path); return path === LR('U3') ? { ...r, set: async (v: any, o?: any) => { if (failsLeft-- > 0) throw new Error('unavailable'); return r.set(v, o); } } : r; };
  serve((u) => (u.endsWith('/refunds/') ? { status: 201, body: { object_id: 'rf-U3', status: 'QUEUED' } } : null));
  uv = await voidUnsavedLabel(db, T, 'k', { orderId: 'o8', order: { orderNumber: 1050 }, boxes: [{ txn: 'U3', tracking: '9400U3', labelUrl: 'u', trackingUrl: '' }], cents: 640, carrier: 'USPS', by: { id: 'u1', name: 'Maya' }, how: 'single' });
  check('the record can’t be written at first: Shippo is asked to void it anyway, and the record and its refund are written after', calls.includes('POST /refunds/') && uv?.outcome === 'voided' && uv.tracked === true && db._store.get(LR('U3'))?.refunds?.U3?.refundId === 'rf-U3' && db._store.get(`tenants/${T}/transactions/postage-U3`)?.amount === 6.4, { uv, rec: db._store.get(LR('U3')) });
  // It can't be written at all, and Shippo doesn't answer: no postage booked without a record, and the person is told to void it in Shippo.
  db.doc = (path: string) => { const r = docOf(path); return path === LR('U4') ? { ...r, set: async () => { throw new Error('unavailable'); } } : r; };
  serve((u) => (u.endsWith('/refunds/') ? 'throw' : null));
  uv = await voidUnsavedLabel(db, T, 'k', { orderId: 'o8', order: { orderNumber: 1050 }, boxes: [{ txn: 'U4', tracking: '9400111899223344774471', labelUrl: 'u', trackingUrl: '' }], cents: 640, carrier: 'USPS', by: { id: 'u1', name: 'Maya' }, how: 'single' });
  const { unsavedNote } = await import('../../src/lib/label-void');
  check('…when it can’t be kept and Shippo doesn’t answer, nothing is booked and the person is told to void it in Shippo, by its tracking number',
    calls.includes('POST /refunds/') && uv?.tracked === false && uv.outcome === 'unknown' && !db._store.get(`tenants/${T}/transactions/postage-U4`) && /Void it in Shippo \(tracking ending 4471\)/.test(unsavedNote(uv, '9400111899223344774471')), uv);
  check('…and the words for each outcome', unsavedNote({ ...uv!, outcome: 'voided' }, 'x') === 'that label was voided straight away' && /tried again over the next few days/.test(unsavedNote({ ...uv!, tracked: true }, 'x')));
  db.doc = docOf;

  // ── A label whose every box's refund was asked for counts as voided; once one is called off, it doesn't ──
  db = makeDb();
  db._store.set(LR('A'), newLabelRecord({ id: 'A', order: { orderNumber: 1042 }, orderId: 'o1', carrier: 'USPS', boxes: [{ txn: 'A', tracking: '9400111899223', labelUrl: 'uA', trackingUrl: '' }, { txn: 'B', tracking: '9400222899223', labelUrl: 'uB', trackingUrl: '' }], amountCents: 910, at: 'x', by: { id: '', name: '' }, how: 'single' }));
  await noteRefundRequests(db, T, two, 'o1', [{ txn: 'A', refundId: null }, { txn: 'B', refundId: null }], 'voided by hand');
  const wholeBefore = !!db._store.get(LR('A')).voidedAt;
  await withdrawRefund(db, T, two, 'B', 'This label has already been used');
  rec = db._store.get(LR('A'));
  check('one box’s refund called off: the label no longer reads as voided as a whole', wholeBefore && rec.voidedAt === null && rec.voidWhy === null && rec.refunds.B.status === 'withdrawn' && rec.refundCents === 455 && rec.refundOpen === true, rec);

  // ── Every void takes the order's claim: one under way leaves the label alone ──
  db = makeDb();
  db._store.set(OR('o7'), { shippoTransactionId: 'V1', trackingNumber: '9400111899224', labelUrl: 'u', carrier: 'USPS', stage: 'cancelled', labelTxns: ['V1'], labelRecs: ['V1'], labelBuying: { at: new Date().toISOString(), by: 'Maya', token: 'mine' } });
  serve((u) => (u.includes('/tracks/') ? { body: { tracking_status: { status: 'PRE_TRANSIT' }, tracking_history: [{ status: 'PRE_TRANSIT' }] } } : u.endsWith('/refunds/') ? { status: 201, body: { object_id: 'rf-V1' } } : null));
  let vo = await voidIfUnused(db, T, db.doc(OR('o7')), db._store.get(OR('o7')), 'k', 'the order was cancelled');
  check('the morning check leaves a label alone while someone is buying or replacing it, and asks Shippo nothing', !vo.ok && vo.refused === 'busy' && !calls.some((c) => c.startsWith('POST')) && db._store.get(OR('o7')).shippoTransactionId === 'V1' && db._store.get(OR('o7')).labelBuying.token === 'mine', { vo, calls });
  db._store.set(OR('o7'), { ...db._store.get(OR('o7')), labelBuying: null });
  vo = await voidIfUnused(db, T, db.doc(OR('o7')), db._store.get(OR('o7')), 'k', 'the order was cancelled');
  check('…and voids it once they’re done, letting the order go afterwards', vo.ok && db._store.get(OR('o7')).shippoTransactionId === '' && db._store.get(OR('o7')).labelBuying === null, { vo, o: db._store.get(OR('o7')) });

  // ── One box's label voided while the others keep theirs ──
  db = makeDb();
  db._store.set(LR('A'), newLabelRecord({ id: 'A', order: { orderNumber: 1042 }, orderId: 'o1', carrier: 'USPS', boxes: [{ txn: 'A', tracking: '9400111899223', labelUrl: 'uA', trackingUrl: '' }, { txn: 'B', tracking: '9400222899223', labelUrl: 'uB', trackingUrl: '' }], amountCents: 910, at: 'x', by: { id: '', name: '' }, how: 'single' }));
  db._store.set(OR('o1'), { ...two, stage: 'packed', carrier: 'USPS' });
  const pre = { tracking_status: { status: 'PRE_TRANSIT' }, tracking_history: [{ status: 'PRE_TRANSIT' }] };
  const moving = { tracking_status: { status: 'TRANSIT' }, tracking_history: [{ status: 'TRANSIT' }] };
  serve((u) => (u.includes('/tracks/usps/9400222899223') ? { body: pre } : u.endsWith('/refunds/') ? { status: 201, body: { object_id: 'rf-B', status: 'QUEUED' } } : null));
  let b = await voidBox(db, T, db.doc(OR('o1')), db._store.get(OR('o1')), 1, 'k', 'replaced (wrong box size or weight)', { id: 'u1', name: 'Maya' });
  let o = db._store.get(OR('o1'));
  check('one box’s label voided: listed as voided on the order, its number remembered as dead, the order flagged for its new label',
    b.ok && o.labelVoidIds.join() === 'B' && o.relabelOpen === true && o.voidedTracking.join() === '9400222899223' && voidedSlots(o).map((s) => s.slot).join() === '1' && labelDoubt(o) === 'relabel', o);
  check('…its refund is on the record, for its share only', db._store.get(LR('A')).refunds.B?.cents === 455 && !db._store.get(LR('A')).refunds.A && !db._store.get(LR('A')).voidedAt);
  check('Needs you lists the box waiting for its new label', needsYou([{ ...o, id: 'o1', customerName: 'Dana Whitfield', method: 'ship' }], Date.now()).some((n) => n.kind === 'relabel' && n.text === 'A box of Dana’s needs a new label'));
  db._store.set(OR('o1'), { ...two, stage: 'packed', carrier: 'USPS' });
  serve((u) => (u.includes('/tracks/usps/9400222899223') ? { body: moving } : null));
  b = await voidBox(db, T, db.doc(OR('o1')), db._store.get(OR('o1')), 1, 'k', 'replaced', { id: 'u1', name: 'Maya' });
  check('a box the carrier has scanned keeps its label and nothing is asked for', !b.ok && b.refused === 'moving' && !calls.some((c) => c.startsWith('POST')) && !(db._store.get(OR('o1')).labelVoidIds || []).length);
  db._store.set(LR('A'), { ...db._store.get(LR('A')), refunds: {}, refundOpen: false, refundCents: 0 });
  serve((u) => (u.includes('/tracks/usps/9400222899223') ? { body: pre } : u.endsWith('/refunds/') ? 'throw' : null));
  b = await voidBox(db, T, db.doc(OR('o1')), db._store.get(OR('o1')), 1, 'k', 'replaced', { id: 'u1', name: 'Maya' });
  check('no answer from Shippo: the box counts as voided anyway (it gets a new label either way), and the refund is followed', b.ok && b.unsure === true && db._store.get(OR('o1')).labelVoidIds.join() === 'B' && db._store.get(LR('A')).refunds.B?.refundId === null);
  // Shippo says the carrier has it, after the box was written down as voiding: it all comes off again.
  db._store.set(OR('o1'), { ...two, stage: 'packed', carrier: 'USPS' });
  db._store.set(LR('A'), { ...db._store.get(LR('A')), refunds: {}, refundOpen: false, refundCents: 0 });
  let seenAtAsk: any = null;
  serve((u) => {
    if (u.includes('/tracks/usps/9400222899223')) return { body: pre };
    if (u.endsWith('/refunds/')) { seenAtAsk = { voids: db._store.get(OR('o1')).labelVoidIds, ref: db._store.get(LR('A')).refunds.B?.status }; return { status: 400, body: { detail: 'This label has already been used' } }; }
    return null;
  });
  b = await voidBox(db, T, db.doc(OR('o1')), db._store.get(OR('o1')), 1, 'k', 'replaced', { id: 'u1', name: 'Maya' });
  o = db._store.get(OR('o1'));
  check('the box is written down as voiding before Shippo is asked, so a void cut off part way still holds it back', seenAtAsk?.voids?.includes('B') && seenAtAsk?.ref === 'requested', seenAtAsk);
  check('…and when Shippo says the carrier has it, the label goes back on the order as it was and the refund is called off',
    !b.ok && b.refused === 'moving' && (o.labelVoidIds || []).length === 0 && o.relabelOpen === false && !(o.voidedTracking || []).includes('9400222899223')
      && db._store.get(LR('A')).refunds.B?.status === 'withdrawn' && db._store.get(LR('A')).refundCents === 0 && db._store.get(LR('A')).refundOpen === false, { o, rec: db._store.get(LR('A')) });
  // The rest of the label was voided while Shippo was being asked (it's off the order now): nothing is put back, and the
  // box's number stays on the dead list, so a scan of it is flagged.
  db._store.set(OR('o1'), { ...two, stage: 'packed', carrier: 'USPS' });
  db._store.set(LR('A'), { ...db._store.get(LR('A')), refunds: {}, refundOpen: false, refundCents: 0 });
  serve((u) => {
    if (u.includes('/tracks/usps/9400222899223')) return { body: pre };
    if (u.endsWith('/refunds/')) {
      db._store.set(OR('o1'), { ...db._store.get(OR('o1')), shippoTransactionId: '', trackingNumber: '', labelUrl: '', extraTrackingNumbers: [], extraLabelUrls: [], extraTrackingUrls: [], labelTxns: [], labelRecs: [], labelVoidIds: [], relabelOpen: false });
      return { status: 400, body: { detail: 'This label has already been used' } };
    }
    return null;
  });
  b = await voidBox(db, T, db.doc(OR('o1')), db._store.get(OR('o1')), 1, 'k', 'replaced', { id: 'u1', name: 'Maya' });
  o = db._store.get(OR('o1'));
  check('…but once the label is off the order, nothing is put back on it and the box’s number stays on the dead list',
    !b.ok && b.refused === 'moving' && (o.voidedTracking || []).includes('9400222899223') && (o.labelTxns || []).length === 0 && (o.labelVoidIds || []).length === 0 && db._store.get(LR('A')).refunds.B?.status === 'withdrawn', o);
  // Found by its label: a box taken off meanwhile doesn't shift which box is voided.
  const three = { ...two, extraTrackingNumbers: ['9400222899223', '9400333899223'], extraLabelUrls: ['uB', 'uC'], extraTrackingUrls: ['', ''], labelTxns: ['A', 'B', 'C'], labelRecs: ['A', 'A', 'A'], packageCount: 3, stage: 'packed', carrier: 'USPS' };
  db._store.set(OR('o3'), { ...three, labelTxns: ['A', 'C'], labelRecs: ['A', 'A'], extraTrackingNumbers: ['9400333899223'], extraLabelUrls: ['uC'], extraTrackingUrls: [''], packageCount: 2 });
  serve((u) => (u.includes('/tracks/usps/9400333899223') ? { body: pre } : u.endsWith('/refunds/') ? { status: 201, body: { object_id: 'rf-C' } } : null));
  b = await voidBox(db, T, db.doc(OR('o3')), { ...three, labelVoidIds: ['B'] }, 2, 'k', 'replaced', { id: 'u1', name: 'Maya' });
  check('a box is voided by its own label even when the boxes moved meanwhile', b.ok && db._store.get(OR('o3')).labelVoidIds.join() === 'C' && voidedSlots(db._store.get(OR('o3'))).map((x) => x.slot).join() === '1');
  db._store.set(OR('o9'), { ...two, stage: 'packed', carrier: 'USPS', shippedWithOrderIds: ['o8'] });
  b = await voidBox(db, T, db.doc(OR('o9')), db._store.get(OR('o9')), 1, 'k', 'replaced', { id: 'u1', name: 'Maya' });
  check('a label shared by orders in one box is replaced whole, not box by box', !b.ok && b.refused === 'shared');

  // ── Following refunds every morning ──
  const NOW = Date.parse('2026-11-05T12:00:00Z');
  const ago = (d: number) => new Date(NOW - d * 864e5).toISOString();
  db = makeDb();
  const base = (id: string, refunds: Record<string, any>, extra: any = {}) => ({ ...newLabelRecord({ id, order: { orderNumber: 1039, customerName: 'Sam Lee' }, orderId: `ord-${id}`, carrier: 'USPS', boxes: Object.keys(refunds).map((t) => ({ txn: t, tracking: `trk-${t}`, labelUrl: '', trackingUrl: '' })), amountCents: 455 * Object.keys(refunds).length, at: ago(20), by: { id: '', name: '' }, how: 'single' }), refunds, refundOpen: true, ...extra });
  const req = (cents: number, at: string, more: any = {}) => ({ status: 'requested', requestedAt: at, cents, slot: 0, refundId: null, asks: 1, tracking: '9400999899223', ...more });
  db._store.set(LR('R1'), base('R1', { R1: req(455, ago(10), { refundId: 'rf1' }) }));
  db._store.set(LR('R2'), base('R2', { R2: req(455, ago(10)) }));
  db._store.set(LR('R3'), base('R3', { R3: req(455, ago(3)) }));
  db._store.set(LR('R4'), base('R4', { R4: req(455, ago(50), { refundId: 'rf4' }) }));
  db._store.set(LR('R5'), base('R5', { R5: req(455, ago(10), { checkedAt: new Date(NOW - 2 * 3600e3).toISOString() }) }));
  db._store.set(LR('R6'), base('R6', { R6: req(455, ago(10), { refundId: 'rf6' }) }));
  db._store.set(LR('R7'), base('R7', { R7: req(455, ago(6), { asks: 4 }) }));
  db._store.set(OR('ord-R2'), { stage: 'completed', customerName: 'Sam Lee' });
  serve((u, init) => {
    if (init?.method === 'POST' && u.endsWith('/refunds/')) return { status: 201, body: { object_id: 'rf3-new', status: 'QUEUED' } };
    if (u.endsWith('/transactions/R1')) return { body: { status: 'REFUNDED' } };
    if (u.endsWith('/transactions/R2')) return { body: { status: 'REFUNDREJECTED' } };
    if (u.endsWith('/transactions/R3')) return { body: { status: 'SUCCESS' } };
    if (u.endsWith('/transactions/R4')) return { body: { status: 'REFUNDPENDING' } };
    if (u.endsWith('/transactions/R6')) return { body: { status: 'SUCCESS' } };
    if (u.endsWith('/transactions/R7')) return { body: { status: 'SUCCESS' } };
    if (u.endsWith('/refunds/rf6')) return { body: { status: 'SUCCESS' } };
    return null;
  });
  let run = await followRefunds(db, T, 'k', { now: NOW, deadline: Date.now() + 60000 });
  const income = (t: string) => db._store.get(`tenants/${T}/transactions/postage-refund-${t}`);
  check('a confirmed refund goes into the books as income, once, and the record says refunded', income('R1')?.amount === 4.55 && income('R1')?.type === 'income' && db._store.get(LR('R1')).refunds.R1.status === 'refunded' && db._store.get(LR('R1')).refundOpen === false && db._store.get(LR('R1')).refundedCents === 455);
  check('…confirmed through the refund itself when the label doesn’t say', income('R6')?.amount === 4.55 && db._store.get(LR('R6')).refunds.R6.status === 'refunded');
  const od = db._store.get(OR('ord-R2'));
  check('a refund Shippo turned down: nothing in the books, the record and the order say so, and it goes under Needs you',
    !income('R2') && db._store.get(LR('R2')).refunds.R2.status === 'denied' && db._store.get(LR('R2')).deniedOpen === true && od.labelRefundDenied?.open === true && od.labelRefundDenied?.cents === 455
      && needsYou([{ ...od, id: 'ord-R2' }], NOW).some((n) => n.kind === 'refundDenied' && n.text === 'A label refund for Sam was turned down'), od);
  check('…with a note on the order’s record', [...db._store.keys()].some((k) => k.startsWith(`${OR('ord-R2')}/events/label-refund-denied-R2`)));
  check('a refund Shippo never registered is asked for again, a day on', db._store.get(LR('R3')).refunds.R3.asks === 2 && db._store.get(LR('R3')).refunds.R3.refundId === 'rf3-new' && run.asked === 1);
  check('a refund still pending after 45 days is handed to someone to check in Shippo', db._store.get(LR('R4')).refunds.R4.status === 'unconfirmed' && db._store.get(LR('R4')).unconfirmedOpen === true && db._store.get(LR('R4')).refundOpen === false);
  check('a refund checked within the last day isn’t looked up again', !calls.some((c) => c.endsWith('/transactions/R5')) && run.checked === 6, { run, calls });
  check('a refund Shippo still has no record of after asking four times goes to someone to check in Shippo now, not in 45 days',
    db._store.get(LR('R7')).refunds.R7.status === 'unconfirmed' && db._store.get(LR('R7')).unconfirmedOpen === true && db._store.get(LR('R7')).refundOpen === false && calls.filter((c) => c === 'POST /refunds/').length === 1, { r7: db._store.get(LR('R7')), calls });
  const before = [...db._store.keys()].length;
  run = await followRefunds(db, T, 'k', { now: NOW + 3600e3, deadline: Date.now() + 60000 });
  check('running again an hour later changes nothing and records nothing twice', run.checked === 0 && [...db._store.keys()].length === before, run);

  // The oldest-checked first, so none waits behind the others; and the books not written means nothing is marked.
  db = makeDb();
  db._store.set(LR('Q1'), base('Q1', { Q1: req(455, ago(10), { checkedAt: ago(2) }) }));
  db._store.set(LR('Q2'), base('Q2', { Q2: req(455, ago(10)) }));
  serve((u) => (u.includes('/transactions/') ? { body: { status: 'REFUNDPENDING' } } : null));
  run = await followRefunds(db, T, 'k', { now: NOW, deadline: Date.now() + 60000, maxLookups: 1 });
  check('with only one look-up to spare, the refund never checked goes first', run.checked === 1 && !!db._store.get(LR('Q2')).refunds.Q2.checkedAt && db._store.get(LR('Q1')).refunds.Q1.checkedAt === ago(2));
  run = await followRefunds(db, T, 'k', { now: NOW + 3600e3, deadline: Date.now() + 60000, maxLookups: 1 });
  check('…and the next run reaches the one that waited', run.checked === 1 && db._store.get(LR('Q1')).refunds.Q1.checkedAt !== ago(2));
  db = makeDb();
  db._store.set(LR('Q3'), base('Q3', { Q3: req(455, ago(10)) }));
  const realDoc = db.doc;
  db.doc = (path: string) => { const r = realDoc(path); return path.includes('postage-refund-') ? { ...r, create: async () => { throw new Error('unavailable'); } } : r; };
  serve((u) => (u.includes('/transactions/') ? { body: { status: 'REFUNDED' } } : null));
  run = await followRefunds(db, T, 'k', { now: NOW, deadline: Date.now() + 60000 });
  check('a confirmed refund the books couldn’t take stays waiting, to be written next time', run.refunded === 0 && db._store.get(LR('Q3')).refunds.Q3.status === 'requested');
  db.doc = realDoc;

  // ── Carrier adjustments from Shippo's invoices ──
  db = makeDb();
  db._store.set(LR('A'), newLabelRecord({ id: 'A', order: { orderNumber: 1042, customerName: 'Dana' }, orderId: 'o1', carrier: 'USPS', boxes: [{ txn: 'A', tracking: '1', labelUrl: '', trackingUrl: '' }, { txn: 'B', tracking: '2', labelUrl: '', trackingUrl: '' }], amountCents: 910, at: 'x', by: { id: '', name: '' }, how: 'single' }));
  db._store.set(OR('o1'), { stage: 'completed', customerName: 'Dana Whitfield', carrier: 'USPS' });
  db._store.set(OR('old'), { stage: 'completed', shippoTransactionId: 'OLD', trackingNumber: '5', carrier: 'USPS', orderNumber: 1001 });
  const inv = (id: string, closed: boolean) => ({ object_id: id, invoice_number: 234167, status: closed ? 'POSTED' : 'OPEN', object_created: ago(5), invoice_closed: closed ? ago(4) : null });
  serve((u) => {
    if (u.includes('/invoices?')) return { body: { results: [inv('I1', true), { ...inv('I0', true), object_created: ago(400) }] } };
    if (u.includes('/invoice-items?invoiceObjectId=I1') && u.includes('page=1')) return { body: { next: 'p2', results: [
      { type: 'LABEL_PAYMENT', transaction: 'A', amount: '9.10', currency: 'USD', object_created: ago(20) },
      { type: 'LABEL_PAYMENT_ADJUSTMENT', transaction: 'B', amount: '2.35', currency: 'USD', object_created: ago(6), description: 'Weight correction' },
      { type: 'LABEL_SURCHARGE', transaction: 'ELSEWHERE', amount: '1.00', currency: 'USD', object_created: ago(6) },
    ] } };
    if (u.includes('/invoice-items?invoiceObjectId=I1') && u.includes('page=2')) return { body: { next: null, results: [
      { type: 'LABEL_SURCHARGE', transaction: 'OLD', amount: '1.10', currency: 'USD', object_created: ago(6) },
    ] } };
    return null;
  });
  let ch = await importCarrierCharges(db, T, 'k', { now: NOW, deadline: Date.now() + 60000 });
  rec = db._store.get(LR('A'));
  const adj = [...db._store.entries()].filter(([k]) => k.includes('/transactions/postage-adj-'));
  check('a carrier adjustment is matched to its label and box, recorded on it, on the order, and in the books',
    ch.charges === 2 && Object.values(rec.charges).length === 1 && (Object.values(rec.charges)[0] as any).slot === 1 && rec.chargesCents === 235 && rec.chargeOpen === true
      && db._store.get(OR('o1')).labelCharge?.cents === 235 && adj.some(([, v]) => v.amount === 2.35 && v.type === 'expense'), { ch, rec });
  check('a label bought before records existed gets one when its adjustment comes in; a label bought elsewhere is left alone',
    db._store.get(LR('OLD'))?.chargesCents === 110 && db._store.get(LR('OLD'))?.how === 'earlier' && !db._store.get(LR('ELSEWHERE')) && adj.length === 2);
  check('label payments themselves aren’t adjustments, and an invoice from over 120 days ago isn’t read', !calls.some((c) => c.includes('invoiceObjectId=I0')) && rec.chargesCents === 235);
  check('a closed invoice read to the end is marked done', db._store.get(`tenants/${T}/shippoInvoices/I1`)?.done === true);
  check('Needs you mentions the adjustment', needsYou([{ ...db._store.get(OR('o1')), id: 'o1' }], NOW).some((n) => n.kind === 'charge' && /USPS adjusted Dana’s postage: \+\$2\.35/.test(n.text)));
  calls = [];
  ch = await importCarrierCharges(db, T, 'k', { now: NOW, deadline: Date.now() + 60000 });
  check('a done invoice isn’t read again, and nothing is recorded twice', ch.charges === 0 && !calls.some((c) => c.includes('invoice-items')) && [...db._store.keys()].filter((k) => k.includes('postage-adj-')).length === 2, { ch, calls, adj: [...db._store.keys()].filter((k) => k.includes('postage-adj-')) });

  // An invoice still open, read a page a morning; its items carry no date of their own, and new ones may come first.
  db = makeDb();
  db._store.set(LR('A'), newLabelRecord({ id: 'A', order: { orderNumber: 1042 }, orderId: 'o1', carrier: 'USPS', boxes: [{ txn: 'A', tracking: '1', labelUrl: '', trackingUrl: '' }], amountCents: 455, at: 'x', by: { id: '', name: '' }, how: 'single' }));
  db._store.set(OR('o1'), { stage: 'completed', customerName: 'Dana Whitfield' });
  let page1: any[] = [{ type: 'LABEL_SURCHARGE', transaction: 'A', amount: '1.25', currency: 'USD' }];
  let i7closed = false;
  serve((u) => {
    if (u.includes('/invoices?')) return { body: { results: [{ object_id: 'I7', invoice_number: 9, status: i7closed ? 'POSTED' : 'OPEN', object_created: ago(3) }] } };
    if (u.includes('invoiceObjectId=I7') && u.includes('page=1')) return { body: { next: 'p2', results: page1 } };
    if (u.includes('invoiceObjectId=I7') && u.includes('page=2')) return { body: { next: null, results: [{ type: 'LABEL_REFUND_ADJUSTMENT', transaction: 'A', amount: '4.55', currency: 'USD' }, { type: 'LABEL_PAYMENT_ADJUSTMENT', transaction: 'A', amount: '0.60', currency: 'USD' }] } };
    return null;
  });
  const i7 = () => db._store.get(`tenants/${T}/shippoInvoices/I7`);
  const adjCount = () => [...db._store.keys()].filter((k) => k.includes('postage-adj-')).length;
  ch = await importCarrierCharges(db, T, 'k', { now: NOW, deadline: Date.now() + 60000, maxPages: 1 });
  check('a page a morning: the first page’s adjustment is recorded and reading stops there', ch.charges === 1 && ch.cutOff && db._store.get(LR('A')).chargesCents === 125 && i7()?.page === 2);
  calls = [];
  ch = await importCarrierCharges(db, T, 'k', { now: NOW + 864e5, deadline: Date.now() + 60000, maxPages: 1 });
  check('the next morning picks up on the next page; an adjustment to a refund isn’t booked (the refund itself is)', ch.charges === 1 && calls.some((c) => c.includes('page=2')) && !calls.some((c) => c.includes('invoiceObjectId=I7') && c.includes('page=1')) && db._store.get(LR('A')).chargesCents === 185, { ch, calls, cents: db._store.get(LR('A')).chargesCents });
  check('…and once an open invoice is read to the end, the next reading starts again from the first page', i7()?.page === 1 && i7()?.done === false);
  page1 = [{ type: 'LABEL_SURCHARGE', transaction: 'A', amount: '0.40', currency: 'USD', description: 'Residential delivery' }, ...page1];
  calls = [];
  ch = await importCarrierCharges(db, T, 'k', { now: NOW + 2 * 864e5, deadline: Date.now() + 60000, maxPages: 3 });
  check('a new adjustment listed first on a page already read is found, and nothing is booked twice', ch.charges === 1 && db._store.get(LR('A')).chargesCents === 225 && adjCount() === 3 && calls.some((c) => c.includes('invoiceObjectId=I7') && c.includes('page=1')) && i7()?.done === false, { ch, calls });
  i7closed = true; calls = [];
  ch = await importCarrierCharges(db, T, 'k', { now: NOW + 3 * 864e5, deadline: Date.now() + 60000, maxPages: 3 });
  check('once it closes it’s read through once more from the first page, then marked done', ch.charges === 0 && calls.some((c) => c.includes('invoiceObjectId=I7') && c.includes('page=1')) && calls.some((c) => c.includes('invoiceObjectId=I7') && c.includes('page=2')) && i7()?.done === true && adjCount() === 3, { ch, calls, mark: i7() });
  // Closed and cut off part way: the next morning picks up where it stopped, not at the top.
  db = makeDb();
  db._store.set(LR('A'), newLabelRecord({ id: 'A', order: { orderNumber: 1042 }, orderId: 'o1', carrier: 'USPS', boxes: [{ txn: 'A', tracking: '1', labelUrl: '', trackingUrl: '' }], amountCents: 455, at: 'x', by: { id: '', name: '' }, how: 'single' }));
  db._store.set(OR('o1'), { stage: 'completed', customerName: 'Dana Whitfield' });
  ch = await importCarrierCharges(db, T, 'k', { now: NOW + 4 * 864e5, deadline: Date.now() + 60000, maxPages: 1 });
  calls = [];
  ch = await importCarrierCharges(db, T, 'k', { now: NOW + 5 * 864e5, deadline: Date.now() + 60000, maxPages: 1 });
  check('a closed invoice cut off part way picks up on the next page', calls.some((c) => c.includes('invoiceObjectId=I7') && c.includes('page=2')) && !calls.some((c) => c.includes('invoiceObjectId=I7') && c.includes('page=1')) && i7()?.done === true && db._store.get(LR('A')).chargesCents === 225, { calls, mark: i7() });

  // ── Every box of a label just bought, in the order its parcels were given ──
  serve((u) => {
    if (u.includes('/transactions/?rate=r9')) return { body: { results: [
      { object_id: 'X1', status: 'SUCCESS', tracking_number: 't1', label_url: 'l1', parcel: 'P1' },
      { object_id: 'X3', status: 'SUCCESS', tracking_number: 't3', label_url: 'l3', parcel: 'P3' },
      { object_id: 'X2', status: 'SUCCESS', tracking_number: 't2', label_url: 'l2', parcel: 'P2' },
    ] } };
    if (u.endsWith('/shipments/S9')) return { body: { parcels: [
      { object_id: 'P1', length: '12', width: '10', height: '6', weight: '38', mass_unit: 'oz', distance_unit: 'in' },
      { object_id: 'P2', length: '9', width: '6', height: '2', weight: '14', mass_unit: 'oz', distance_unit: 'in' },
      { object_id: 'P3', length: '8', width: '8', height: '8', weight: '1.5', mass_unit: 'lb', distance_unit: 'in' },
    ] } };
    return null;
  });
  const boxes = await boxesOf('k', { object_id: 'X1', tracking_number: 't1', label_url: 'l1', parcel: 'P1' }, 'r9', [{ weightOz: 38 }, { weightOz: 14 }, { weightOz: 24 }], 'S9');
  check('the boxes come back in parcel order, each with the size and weight it was bought for',
    boxes.map((x) => x.txn).join() === 'X1,X2,X3' && boxes[1].parcel?.weightOz === 14 && boxes[2].parcel?.weightOz === 24 && boxes[0].parcel?.lengthIn === 12, boxes);

  // ── One purchase at a time ──
  db = makeDb();
  db._store.set(OR('o5'), { stage: 'packed' });
  const c1 = await claimLabelBuy(db, db.doc(OR('o5')), 'Maya', NOW);
  const c2 = await claimLabelBuy(db, db.doc(OR('o5')), 'Jo', NOW + 1000);
  const tok = 'token' in c1 ? c1.token : '';
  check('while someone is buying a label, a second purchase is refused', !!tok && 'error' in c2 && c2.busy === true);
  await releaseLabelBuy(db, db.doc(OR('o5')), 'not-mine');
  check('only the purchase that claimed the order lets it go', db._store.get(OR('o5')).labelBuying?.token === tok);
  const c3 = await claimLabelBuy(db, db.doc(OR('o5')), 'Jo', NOW + BUY_STALE_MS + 1);
  check('a claim left by a purchase that was cut off lapses after three minutes', 'token' in c3 && c3.token !== tok);
  await releaseLabelBuy(db, db.doc(OR('o5')), 'token' in c3 ? c3.token : null);
  check('…and the order is free once the purchase lets go', db._store.get(OR('o5')).labelBuying === null);
  db._store.set(OR('o5'), { stage: 'packed', shippoTransactionId: 'L1', labelUrl: 'u' });
  const c4 = await claimLabelBuy(db, db.doc(OR('o5')), 'Jo', NOW, (cur) => (cur.shippoTransactionId && cur.labelUrl ? 'This order already has a label.' : null));
  check('the claim looks at the order as it is now: a label bought a moment ago stops a second one, and nothing is claimed', 'error' in c4 && /already has a label/.test(c4.error) && !db._store.get(OR('o5')).labelBuying);
  db._store.set(OR('o6'), { stage: 'packed' });
  const v1 = await claimLabelBuy(db, db.doc(OR('o6')), 'Daily check', NOW, undefined, 'void');
  const v2 = await claimLabelBuy(db, db.doc(OR('o6')), 'Jo', NOW + 1000);
  check('a void holds the order too: a purchase meanwhile is told a void is under way', 'token' in v1 && 'error' in v2 && v2.busy === true && /voiding/.test(v2.error), v2);

  globalThis.fetch = realFetch;
  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
