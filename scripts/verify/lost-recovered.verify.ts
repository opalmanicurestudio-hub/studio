// Checks Lost and recovered (lib/lost-recovered and api/retail/lost-parcel): who covers a loss and the date to file by,
// claims to file for Needs you (the next week's on top), a claim's story from reported to paid, the details to paste,
// the month (lost, recovered, net, where it went, one change worth making), a parcel that stopped moving (hidden while
// the team waits on it, never emailed about on its own), sending a replacement (a $0 order, the loss recorded once,
// the carrier problem closed), and packing an insured box (lib/pack-photo: the insurer's rules and a photo).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/lost-recovered.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';
import { claimDetails, claimTimeline, claimsToFile, coverFor, dueState, fileBy, lossKind, monthLoss } from '../../src/lib/lost-recovered';
import { carrierItem } from '../../src/lib/ship-day';
import { needsYou } from '../../src/lib/orders-view';
import { INSURED_PACK_RULES, insuredPackCheck } from '../../src/lib/pack-photo';

const db = makeDb();
let actor: any = { uid: 'm1', name: 'Rae Moss', isManager: true, caps: [] };
let authTenant: any = {};
let sent: any[] = [];
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: authTenant }) };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === './notify' || request === '@/lib/notify') return { sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: true }; } };
  return load.call(this, request, ...rest);
};

const DAY = 86400e3;
const day = (v: string) => new Date(v).toISOString().slice(5, 10);

(async () => {
  // ── Who covers it, and by when ──
  const insured = { reason: 'stolen_after_delivery', insuredCents: 14200, carrier: 'USPS', shippedAt: '2026-10-20T15:00:00Z', retailCents: 14200 };
  const order = { customerName: 'Dana Whitfield', deliveredAt: '2026-10-24T18:14:00Z', completedAt: '2026-10-20T15:00:00Z', orderNumber: 1042, trackingNumber: '9400111', carrier: 'USPS', shippingAddress: { line1: '12 Elm St', city: 'Austin', state: 'TX', postalCode: '78701' } };
  const c1 = coverFor(insured, order);
  check('insured with Shippo: the insured amount, porch theft covered, filed in Shippo', c1.by === 'shippo' && c1.amountCents === 14200 && c1.theft && /goshippo/.test(c1.portalUrl));
  check('delivered but never arrived, insured: file within 15 days of the delivery scan', fileBy(insured, order)?.slice(0, 10) === '2026-11-08', fileBy(insured, order));
  const lost = { reason: 'carrier_lost', insuredCents: 14200, carrier: 'USPS', shippedAt: '2026-10-20T15:00:00Z' };
  check('lost in transit, insured: within 60 days of shipping', fileBy(lost, { ...order, deliveredAt: null })?.slice(0, 10) === '2026-12-19');
  const bare = { reason: 'carrier_lost', insuredCents: 0, carrier: 'USPS', shippedAt: '2026-10-20T15:00:00Z', retailCents: 8800 };
  const c2 = coverFor(bare, order);
  check('not insured: the carrier’s included cover, up to $100, no porch theft, the carrier’s window', c2.by === 'carrier' && c2.who === 'USPS' && c2.amountCents === 8800 && c2.upTo && !c2.theft && fileBy(bare, order)?.slice(0, 10) === '2026-12-19' && /usps\.com/.test(c2.portalUrl));
  check('a ship date that isn’t known gives no date rather than a guess', fileBy({ reason: 'carrier_lost', insuredCents: 0 }, {}) === null && dueState(null) === 'none');
  const now = Date.parse('2026-11-03T12:00:00Z');
  check('due in the next week, past due, or fine', dueState('2026-11-08T00:00:00Z', now) === 'soon' && dueState('2026-11-01T00:00:00Z', now) === 'overdue' && dueState('2026-12-19T00:00:00Z', now) === 'ok');
  const NY = 'America/New_York';
  check('the date to file by is the end of that day in the shop’s time zone', fileBy(insured, order, NY)?.startsWith('2026-11-09T04:59:59') === true, fileBy(insured, order, NY));
  // Delivered 11:30 PM Mar 1 (Eastern), daylight saving starting Mar 14: 15 calendar days is the end of Mar 16.
  const dst = fileBy({ reason: 'stolen_after_delivery', insuredCents: 9000, carrier: 'USPS' }, { deliveredAt: '2027-03-02T04:30:00Z' }, NY);
  check('days are calendar days across a daylight-saving change, and the day after is past due',
    dst?.startsWith('2027-03-17T03:59:59') === true && dueState(dst, Date.parse('2027-03-17T04:30:00Z')) === 'overdue' && dueState(dst, Date.parse('2027-03-17T03:30:00Z')) === 'soon', dst);
  check('marked delivered on the carrier’s trail only: counted from that scan',
    fileBy(insured, { carrierTrail: { carrierStatus: 'DELIVERED', carrierStatusAt: '2026-10-24T18:14:00Z' } })?.slice(0, 10) === '2026-11-08');
  check('delivered but missing, delivery date unknown: the earliest it could be due (15 days from shipping), never the 60 for a lost box',
    fileBy({ ...insured }, { completedAt: '2026-10-20T15:00:00Z' })?.slice(0, 10) === '2026-11-04', fileBy({ ...insured }, {}));

  // ── Claims to file, for Needs you ──
  const rows = [
    { id: 'a', orderId: 'o1', reason: 'carrier_lost', insuredCents: 0, carrier: 'USPS', shippedAt: '2026-10-25T15:00:00Z', retailCents: 6100, recovery: { status: 'candidate' } },
    { id: 'b', orderId: 'o2', reason: 'stolen_after_delivery', insuredCents: 14200, carrier: 'USPS', shippedAt: '2026-10-20T15:00:00Z', retailCents: 14200, recovery: { status: 'candidate' } },
    { id: 'c', orderId: 'o3', reason: 'reported_missing', recovery: { status: 'none' } },
    { id: 'd', orderId: 'o4', reason: 'carrier_damaged', insuredCents: 0, carrier: 'UPS', shippedAt: '2026-10-01T15:00:00Z', retailCents: 3000, recovery: { status: 'filed' } },
    { id: 'e', orderId: 'o5', reason: 'inbound_damage', recovery: { status: 'candidate' } },
  ];
  const orders = new Map<string, any>([['o1', { customerName: 'Marcus Tate', orderNumber: 1039 }], ['o2', { ...order }]]);
  const list = claimsToFile(rows, orders, day, now);
  const arrived = [...rows, { id: 'f', orderId: 'o6', at: '2026-10-26T12:00:00Z', reason: 'carrier_lost', insuredCents: 0, carrier: 'USPS', shippedAt: '2026-10-22T15:00:00Z', retailCents: 4000, recovery: { status: 'candidate' } },
    { id: 'g', orderId: 'o7', at: '2026-08-01T12:00:00Z', reason: 'carrier_lost', insuredCents: 0, carrier: 'USPS', shippedAt: '2026-08-01T15:00:00Z', retailCents: 4000, recovery: { status: 'candidate' } }];
  const ordersArrived = new Map<string, any>([...orders, ['o6', { orderNumber: 1060, deliveredAt: '2026-10-29T12:00:00Z' }], ['o7', { orderNumber: 1061 }]]);
  check('a box reported lost that was delivered after all isn’t a claim to file; one long past its date stays off Needs you but on the Lost screen',
    claimsToFile(arrived, ordersArrived, day, now).every((x) => !['f', 'g'].includes(x.exc.id)) && claimsToFile(arrived, ordersArrived, day, now, 'UTC', { all: true }).some((x) => x.exc.id === 'g') && !claimsToFile(arrived, ordersArrived, day, now, 'UTC', { all: true }).some((x) => x.exc.id === 'f'));
  check('only claims to file that a carrier or insurer pays, the one due this week on top', list.length === 2 && list[0].exc.id === 'b' && list[0].due === 'soon' && list[1].exc.id === 'a', list.map((x) => [x.exc.id, x.due]));
  check('the line says what to do and by when, what happened and who covers it',
    list[0].title === 'File the claim for #1042 by 11-08' && /Dana says it never arrived/.test(list[0].detail) && /Insured with Shippo for \$142/.test(list[0].detail)
    && /Marcus reported it missing/.test(list[1].detail) && /USPS’s included cover, up to \$61/.test(list[1].detail), list.map((x) => [x.title, x.detail]));

  // ── A claim's story ──
  const story = claimTimeline({ at: '2026-10-28T12:00:00Z', reason: 'carrier_lost', source: 'carrier_watch', replacementOrderId: 'r1', costed: true, landedCostCents: 6100,
    recovery: { status: 'paid', events: [{ action: 'file', at: '2026-10-30T12:00:00Z', refNumber: 'XC-88213' }, { action: 'approve', at: '2026-11-06T12:00:00Z' }, { action: 'payment', at: '2026-11-09T12:00:00Z', amountCents: 14200 }] } }, { customerName: 'Dana Whitfield' }, day);
  check('from stopped moving to paid, with the replacement’s cost and the claim number',
    story.map((s) => s.text).join(' | ') === 'Stopped moving | Replacement sent | Claim filed · XC-88213 | Approved | Paid $142.00' && /cost you \$61\.00/.test(story[1].sub) && story[4].good === true && /recorded in Money/.test(story[4].sub), story);
  const details = claimDetails(insured, order, day);
  check('the details to paste: order, tracking, dates, value and address', /Order #1042/.test(details) && /Tracking: 9400111 \(USPS\)/.test(details) && /Delivered: 10-24/.test(details) && /Insured value: \$142\.00/.test(details) && /12 Elm St, Austin, TX, 78701/.test(details), details);

  // ── The month ──
  const monthOf = (v: string) => v.slice(0, 7);
  const mrows = [
    { id: '1', orderId: 'o1', at: '2026-10-03T10:00:00Z', reason: 'carrier_lost', costed: true, landedCostCents: 21000, insuredCents: 0, retailCents: 26000, recovery: { status: 'candidate' } },
    { id: '2', orderId: 'o2', at: '2026-10-09T10:00:00Z', reason: 'stolen_after_delivery', costed: true, landedCostCents: 14200, insuredCents: 14200, retailCents: 14200, recovery: { status: 'paid', events: [{ action: 'payment', at: '2026-10-20T10:00:00Z', amountCents: 14200 }] } },
    { id: '3', orderId: 'o3', at: '2026-10-12T10:00:00Z', reason: 'carrier_damaged', costed: false, landedCostCents: 0, retailCents: 9600, insuredCents: 0, recovery: { status: 'filed' } },
    { id: '4', orderId: 'o4', at: '2026-10-14T10:00:00Z', reason: 'wrong_item_shipped', costed: true, landedCostCents: 1800, recovery: { status: 'none' } },
    { id: '5', orderId: 'o5', at: '2026-10-15T10:00:00Z', reason: 'reported_missing', costed: true, landedCostCents: 2000, recovery: { status: 'none' } },
    { id: '6', orderId: null, at: '2026-10-16T10:00:00Z', reason: 'expired', costed: true, landedCostCents: 9999 },
    { id: '7', orderId: 'o7', at: '2026-09-20T10:00:00Z', reason: 'carrier_lost', costed: true, landedCostCents: 5000, recovery: { status: 'paid', events: [{ action: 'payment', at: '2026-10-02T10:00:00Z', amountCents: 9800 }] } },
    { id: '8', orderId: null, at: '2026-10-05T10:00:00Z', reason: 'inbound_damage', costed: true, landedCostCents: 4000, recovery: { status: 'paid', events: [{ action: 'payment', at: '2026-10-06T10:00:00Z', amountCents: 50000 }] } },
  ];
  const ml = monthLoss(mrows, '2026-10', { monthOf, now: Date.parse('2026-10-30T12:00:00Z'), unusedRefundedCents: 2380, shippedValues: [3000, 6000, 9000, 12000, 40000], insuranceOn: true, insureOverCents: 10000, requireScan: false });
  check('lost: the month’s order losses at cost (sale price when no cost), stock write-offs left out', ml.lostCents === 21000 + 14200 + 9600 + 1800 + 2000, ml);
  check('recovered: money that came back this month on the shop’s parcels, whatever month the loss was in (a supplier’s credit on stock isn’t one); and the net', ml.recoveredCents === 24000 && ml.netCents === 48600 - 24000, ml);
  check('open claims, unused labels refunded', ml.openClaims === 2 && ml.unusedRefundedCents === 2380, ml);
  check('where it went, biggest first, packing mistakes marked',
    ml.where.map((w) => w.kind).join() === 'Lost in transit,Delivered, but missing,Damaged,Packing mistakes' && ml.where[0].pct === 100 && ml.where[3].mistake && ml.where[3].cents === 3800, ml.where);
  check('worth changing: the uninsured losses and what insuring them would have cost, and the packing mistakes',
    /2 losses this month weren’t insured \(\$306\)/.test(ml.worth[0]) && /Insuring orders over \$75 would have cost about \$1(\.\d\d)?\./.test(ml.worth[0]) && /2 packing mistakes/.test(ml.worth[1]), ml.worth);
  check('kinds of loss in the shop’s words', lossKind('carrier_destroyed') === 'Lost in transit' && lossKind('return_opened') === 'Returns' && lossKind('expired') === 'Other');

  // ── A parcel that stopped moving ──
  const stalled = { id: 's1', orderNumber: 1039, customerName: 'Marcus Tate', carrier: 'USPS', stage: 'shipped', carrierIssue: { open: true, status: 'STALLED', quietDays: 6, at: '2026-10-15T12:00:00Z', key: 'k' } };
  check('a quiet parcel shows on Today and under Needs you', !!carrierItem(stalled, 'America/New_York', now) && needsYou([stalled], now).some((n) => n.kind === 'carrier'));
  const waiting = { ...stalled, carrierIssue: { ...stalled.carrierIssue, snoozeUntil: new Date(now + 2 * DAY).toISOString() } };
  check('while the team waits on it, it’s off both lists, and back after', !carrierItem(waiting, 'America/New_York', now) && !needsYou([waiting], now).some((n) => n.kind === 'carrier') && !!carrierItem(waiting, 'America/New_York', now + 3 * DAY));
  const goingBack = { ...stalled, carrierIssue: { open: true, status: 'RETURNED', detail: 'Address not found', snoozeUntil: new Date(now + 2 * DAY).toISOString() } };
  const { carrierIssueUpdate } = await import('../../src/lib/carrier-issue');
  const fresh = carrierIssueUpdate(waiting, '9400', 'RETURNED', { statusAt: new Date(now).toISOString(), detail: 'Address not found' }, now);
  check('a wait is only for a parcel gone quiet: a new problem shows at once, and starts without the old wait',
    !!carrierItem(goingBack, 'America/New_York', now) && needsYou([goingBack], now).some((n) => n.kind === 'carrier') && fresh.carrierIssue?.snoozeUntil === null && fresh.carrierIssue?.toldAt === null, fresh);
  const { sweepStalledShipments } = await import('../../src/lib/retail-sweeps');
  await db.doc('tenants/t1').set({ retailSettings: { policies: { stallDays: 6 } } });
  const quietSince = new Date(now - 7 * DAY).toISOString();
  await db.doc('tenants/t1/retailOrders/q1').set({ stage: 'shipped', trackingNumber: '9400', carrier: 'USPS', customerEmail: 'm@example.com', completedAt: quietSince, carrierTrail: { status: 'TRANSIT', carrierStatusAt: quietSince }, carrierIssue: { customerTold: true, snoozeUntil: new Date(now + DAY).toISOString() } });
  await db.doc('tenants/t1/retailOrders/q2').set({ stage: 'shipped', trackingNumber: '9401', carrier: 'USPS', customerEmail: 'n@example.com', completedAt: new Date(now - 5 * DAY).toISOString(), carrierTrail: { status: 'TRANSIT', carrierStatusAt: new Date(now - 5 * DAY).toISOString() } });
  await db.doc('tenants/t1/retailOrders/q3').set({ stage: 'shipped', trackingNumber: '9402', carrier: 'USPS', completedAt: quietSince, carrierTrail: { status: 'TRANSIT', carrierStatusAt: quietSince }, replacementOrderId: 'r9' });
  sent = [];
  await sweepStalledShipments(db, 't1', { now });
  const q1 = db._store.get('tenants/t1/retailOrders/q1'); const q2 = db._store.get('tenants/t1/retailOrders/q2'); const q3 = db._store.get('tenants/t1/retailOrders/q3');
  check('flagged after the shop’s own number of quiet days, not before', q1.carrierIssue?.open === true && q1.carrierIssue?.status === 'STALLED' && !q2.carrierIssue && !q3.carrierIssue, { q1: q1.carrierIssue, q2: q2.carrierIssue });
  check('nothing is emailed to the customer on its own; that they were told and a wait carry over', sent.length === 0 && q1.carrierIssue.customerTold === true && !!q1.carrierIssue.snoozeUntil, sent);

  // ── Sending a replacement ──
  const { POST } = await import('../../src/app/api/retail/lost-parcel/route');
  const call = (orderId: string) => POST({ json: async () => ({ tenantId: 't1', orderId }) } as any) as any;
  await db.doc('tenants/t1/inventory/gel').set({ costPerUnit: 12.5, stockReserved: 4, unit: 'units' });
  await db.doc('tenants/t1/inventory/polish').set({ costPerUnit: 4, stockReserved: 0, unit: 'units' });
  await db.doc('tenants/t1/retailOrders/l1').set({ stage: 'shipped', method: 'ship', orderNumber: 1039, customerName: 'Marcus Tate', customerEmail: 'm@example.com', qrToken: 'qq', trackingNumber: '9400111', carrier: 'USPS',
    completedAt: '2026-10-13T15:00:00Z', shippingService: 'Priority Mail', shippingAddress: { line1: '1 Oak' }, shipmentProtection: { insuranceCents: 0 },
    carrierIssue: { open: true, status: 'STALLED', quietDays: 6, key: 'k' },
    lines: [{ lineId: 'x', productId: 'gel', name: 'Gel kit', qtyOrdered: 2, unitPriceCents: 3000, qtyScanned: 2, qtyPacked: 2 },
      { lineId: 'y', productId: 'oil', name: 'Oil', qtyOrdered: 1, qtyShorted: 1, unitPriceCents: 1400, status: 'refunded' },
      { lineId: 'z', productId: 'polish', name: 'Polish', qtyOrdered: 3, qtyShorted: 1, unitPriceCents: 1500, status: 'refunded', qtyPacked: 2, preorder: true }] });
  const r1 = await call('l1');
  const l1 = db._store.get('tenants/t1/retailOrders/l1');
  const child = db._store.get(`tenants/t1/retailOrders/${r1.body.replacementOrderId}`);
  const exc = db._store.get('tenants/t1/inventoryExceptions/lost-l1');
  check('a $0 replacement with what was in the box (a partly shorted line’s sent units too), the service they paid for, scanned and packed like any other',
    r1.status === 200 && child?.stage === 'paid' && child.totalCents === 0 && child.isReplacement && child.parentOrderId === 'l1' && child.lines.length === 2 && child.lines[0].qtyOrdered === 2 && child.lines[1].qtyOrdered === 2
      && child.lines.every((l: any) => l.qtyScanned === 0 && l.qtyPacked === 0 && l.preorder === false) && child.shippingService === 'Priority Mail', child);
  check('its stock is held at once, as a paid order’s is, with the hold written down',
    db._store.get('tenants/t1/inventory/gel').stockReserved === 6 && db._store.get('tenants/t1/inventory/polish').stockReserved === 2
      && [...db._store.entries()].filter(([k, v]: any) => k.startsWith('tenants/t1/stockCorrections/') && v.type === 'reserved' && v.refId === child.id).length === 2,
    { gel: db._store.get('tenants/t1/inventory/gel'), polish: db._store.get('tenants/t1/inventory/polish'), entries: [...db._store.entries()].filter(([k]: any) => k.startsWith('tenants/t1/stockCorrections/')).map(([, v]: any) => v) });
  check('the loss recorded once as lost in transit, at cost, uninsured, with the replacement, a claim to file',
    exc?.reason === 'carrier_lost' && exc.landedCostCents === 2500 + 800 && exc.retailCents === 6000 + 3000 && exc.costed === true && exc.insuredCents === 0 && exc.replacementOrderId === child.id && exc.recovery.status === 'candidate' && exc.source === 'carrier_watch', exc);
  check('the carrier problem is closed on the order', l1.replacementOrderId === child.id && l1.carrierIssue.open === false && l1.carrierIssue.outcome === 'replaced');
  const r2 = await call('l1');
  check('asking again makes no second replacement', r2.status === 200 && r2.body.already === true && r2.body.replacementOrderId === child.id && [...db._store.keys()].filter((k) => /retailOrders\/[^/]+$/.test(k) && db._store.get(k).parentOrderId === 'l1').length === 1);
  // Not when the customer is already being paid back for it, or has reported it missing and that's still open.
  await db.doc('tenants/t1/retailOrders/l4').set({ stage: 'shipped', method: 'ship', orderNumber: 1041, pendingRefundCents: 3000, lines: [{ lineId: 'x', productId: 'gel', qtyOrdered: 1, unitPriceCents: 3000 }] });
  await db.doc('tenants/t1/retailOrders/l5').set({ stage: 'shipped', method: 'ship', orderNumber: 1042, customerName: 'Dana Whitfield', lines: [{ lineId: 'x', productId: 'gel', qtyOrdered: 1, unitPriceCents: 3000 }] });
  await db.doc('tenants/t1/retailClaims/l5__not_received__order').set({ orderId: 'l5', type: 'not_received', status: 'in_review' });
  const refusedRefund = await call('l4'); const refusedClaim = await call('l5');
  check('no replacement while a refund for it is on its way, or while the customer’s missing report is open',
    refusedRefund.status === 409 && /refunded/.test(refusedRefund.body.error) && refusedClaim.status === 409 && /Claims/.test(refusedClaim.body.error) && !db._store.get('tenants/t1/retailOrders/l4').replacementOrderId, { a: refusedRefund.body, b: refusedClaim.body });
  // Orders that rode in the same box go in the replacement too, and are marked replaced.
  await db.doc('tenants/t1/retailOrders/l6').set({ stage: 'shipped', method: 'ship', orderNumber: 1043, customerName: 'Kim Lee', shippedWithOrderIds: ['l7'], carrierIssue: { open: true, status: 'STALLED', quietDays: 6 }, lines: [{ lineId: 'x', productId: 'gel', qtyOrdered: 1, unitPriceCents: 3000 }] });
  await db.doc('tenants/t1/retailOrders/l7').set({ stage: 'shipped', method: 'ship', orderNumber: 1044, customerName: 'Kim Lee', labelFromOrderId: 'l6', shippedWithOrderId: 'l6', lines: [{ lineId: 'w', productId: 'polish', qtyOrdered: 1, unitPriceCents: 1500 }] });
  const rider = await call('l6');
  const riderChild = db._store.get(`tenants/t1/retailOrders/${rider.body.replacementOrderId}`);
  check('an order that rode in the same box: its items go in the replacement, and it’s marked replaced too',
    rider.status === 200 && riderChild.lines.length === 2 && riderChild.includesOrderIds?.join() === 'l7' && db._store.get('tenants/t1/retailOrders/l7').replacementOrderId === riderChild.id && (await call('l7')).status === 409, riderChild);
  // Within the role's refund limit.
  actor = { uid: 'c1', name: 'Cass', role: 'cashier', isManager: false, caps: ['checkout.refund'] };
  authTenant = { retailSettings: { policies: { refundLimits: { cashier: 2000 } } } };
  await db.doc('tenants/t1/retailOrders/l8').set({ stage: 'shipped', method: 'ship', orderNumber: 1045, lines: [{ lineId: 'x', productId: 'gel', qtyOrdered: 2, unitPriceCents: 3000 }] });
  const overLimit = await call('l8');
  check('over the role’s refund limit: someone with a higher limit sends it', overLimit.status === 403 && /higher limit/.test(overLimit.body.error) && !db._store.get('tenants/t1/retailOrders/l8').replacementOrderId, overLimit.body);
  authTenant = {};
  actor = { uid: 's1', name: 'Sam', isManager: false, caps: [] };
  await db.doc('tenants/t1/retailOrders/l2').set({ stage: 'shipped', method: 'ship', lines: [{ lineId: 'x', qtyOrdered: 1 }] });
  check('someone who can’t refund can’t send a replacement', (await call('l2')).status === 403);

  // ── Packing an insured box ──
  const rsIns = { shipmentInsuranceEnabled: true, insuranceOverCents: 10000 };
  const big = { method: 'ship', lines: [{ qtyOrdered: 1, unitPriceCents: 14200 }] };
  const small = { method: 'ship', lines: [{ qtyOrdered: 1, unitPriceCents: 4000 }] };
  check('an order the shop will insure gets the insurer’s packing rules and a photo; a small one doesn’t',
    insuredPackCheck(big, rsIns) && !insuredPackCheck(small, rsIns) && INSURED_PACK_RULES.some((r) => /2 inches/.test(r)) && INSURED_PACK_RULES.some((r) => /10 lb/.test(r)));
  check('the label decides once it’s bought: insured or not',
    insuredPackCheck({ ...small, shipmentProtection: { insuranceCents: 4000 } }, {}) && !insuredPackCheck({ ...big, shipmentProtection: { insuranceCents: 0 } }, rsIns));
  check('the shop can turn it off, and pickup orders never ask',
    !insuredPackCheck(big, { ...rsIns, policies: { insuredPackCheck: false } }) && !insuredPackCheck({ ...big, method: 'pickup' }, rsIns) && !insuredPackCheck(big, {}));

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
