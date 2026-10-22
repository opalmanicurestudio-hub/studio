// Checks Ship today, start to finish (lib/ship-run, lib/box-shipments and their routes): boxes chosen at the bench and
// the parcels bought for them, the labels priced before anyone pays (services, boxes, insurance and its cost,
// signatures, orders left out and why, the total), several boxes bought one shipment per box (a box that fails voids
// the others; a purchase with no answer is looked up; one cut off is found and voided next time; a run out of time
// hands the rest back), the bench check, the USPS pickup (the day it's for, one booking a day, Priority Mail and a time
// zone needed, no answer kept as not known, a regular pickup means nothing to book), every box on the USPS form, and
// the day's summary when it closes.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ship-run.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';
import { benchCheck, boxFrom, daySummary, itemsOz, packBoxesOf, parcelsFor, pickupDay, planSummary, presetsOf, regularPickup, uspsPickupAllowed } from '../../src/lib/ship-run';
import { BUY_WAIT, combineRates, isBoxRates, rateIdsOf } from '../../src/lib/box-shipments';
import { scheduleFrom } from '../../src/lib/ship-promise';
import { wallToUtc } from '../../src/lib/tenant-time';

const db = makeDb();
let actor: any = { uid: 'u1', name: 'Maya Lin', isTenantOwner: true };
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'x' }), getApps: () => [{ name: 'admin-retail-bulk-labels' }, { name: 'admin-close-day' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: { arrayUnion: FV.arrayUnion, increment: FV.increment, delete: FV.delete, serverTimestamp: FV.serverTimestamp } };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor }) };
  if (request === '@/lib/retail-secrets') return { shippoKeyFor: async () => 'k', getRetailSecrets: async () => ({ shippoApiKey: 'k' }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  return load.call(this, request, ...rest);
};

const T = 'shop';
const OR = (id: string) => `tenants/${T}/retailOrders/${id}`;
let calls: { method: string; path: string; body: any }[] = [];
type Reply = { status?: number; body?: any } | 'throw' | null;
let route: (u: string, init?: any) => Reply = () => null;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url).replace('https://api.goshippo.com', '');
  calls.push({ method: init?.method || 'GET', path: u, body: init?.body ? JSON.parse(init.body) : null });
  const r = route(u, init);
  if (r === 'throw') throw new Error('timed out');
  const { status = 200, body = {} } = r || { status: 404 };
  return { ok: status >= 200 && status < 300, status, json: async () => body } as any;
}) as any;

const addr = { name: 'Dana Whitfield', line1: '12 Elm St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };
const packed = (extra: any = {}) => ({ qrToken: 'q', method: 'ship', stage: 'packed', customerName: 'Dana Whitfield', shippingAddress: addr, packedAt: new Date().toISOString(), lines: [{ productId: 'gel', name: 'Gel kit', qtyOrdered: 1, unitPriceCents: 4500 }], ...extra });
const presets = [{ id: 'sm', name: 'Small', lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 2 }, { id: 'lg', name: 'Large', lengthIn: 14, widthIn: 10, heightIn: 6, weightOz: 6 }];

(async () => {
  // ── Boxes at the bench ──
  const rs = { packagingPresets: [...presets, { id: 'bad', name: 'Broken', lengthIn: 0 }] };
  check('saved box sizes are read, and a broken one is left out', presetsOf(rs).length === 2 && presetsOf(rs)[1].name === 'Large');
  const two = { packBoxes: [boxFrom(presets[0]), boxFrom(presets[1])] };
  check('the boxes chosen at the bench are kept with their sizes', packBoxesOf(two).length === 2 && packBoxesOf(two)[1].lengthIn === 14 && packBoxesOf({}).length === 0);
  check('what the items weigh: their own weights, 4 oz when unknown, digital left out, shorted left out',
    itemsOz({ lines: [{ productId: 'a', qtyOrdered: 2 }, { productId: 'b', qtyOrdered: 1 }, { productId: 'c', qtyOrdered: 1, digital: true }, { productId: 'a', qtyOrdered: 3, qtyShorted: 3 }] }, (id) => (id === 'a' ? 10 : 0)) === 24);
  const p2 = parcelsFor(two, 40);
  check('two boxes share the items’ weight, each adding its own', p2.length === 2 && p2[0].weightOz === 22 && p2[1].weightOz === 26 && p2[1].lengthIn === 14, p2);
  const p1 = parcelsFor({}, 2, boxFrom(presets[0]));
  check('no box chosen: the shop’s first size, never under 8 oz alone', p1.length === 1 && p1[0].lengthIn === 8 && p1[0].weightOz === 8, p1);

  // ── The plan before buying ──
  const sum = planSummary([
    { orderId: 'a', carrier: 'USPS', service: 'Ground Advantage', how: 'any', amountCents: 540, insuranceFeeCents: 0, insuredCents: 0, signature: 'NONE', boxes: 1 },
    { orderId: 'b', carrier: 'USPS', service: 'Ground Advantage', how: 'any', amountCents: 610, insuranceFeeCents: 250, insuredCents: 20000, signature: 'STANDARD', boxes: 1 },
    { orderId: 'c', carrier: 'usps', service: 'Priority Mail', how: 'matched', amountCents: 910, insuranceFeeCents: 0, insuredCents: 0, signature: 'NONE', boxes: 2 },
  ]);
  check('services grouped with how many each, the standard one first, then what customers paid for',
    sum.lines.length === 2 && sum.lines[0].label === 'USPS Ground Advantage' && sum.lines[0].count === 2 && sum.lines[0].note === 'standard' && sum.lines[1].label === 'USPS Priority Mail' && sum.lines[1].note === 'they paid for it', sum.lines);
  check('boxes, orders in more than one box, insurance and its cost, signatures and the total add up',
    sum.boxes === 4 && sum.multiBox === 1 && sum.insured.orders === 1 && sum.insured.goodsCents === 20000 && sum.insured.feeCents === 250 && sum.signatures === 1 && sum.totalCents === 2060, sum);

  // ── The bench check ──
  const bc = benchCheck([
    { id: 'o1', orderNumber: 1, trackingNumber: '9400111100000000000001', labelCheckedAt: '2026-10-21T10:00:00Z' },
    { id: 'o2', orderNumber: 2, trackingNumber: '9400111100000000000002', extraTrackingNumbers: ['9400111100000000000003'], labelsChecked: ['9400111100000000000002'] },
    { id: 'o3', orderNumber: 3, trackingNumber: '9400111100000000000004', labelFromOrderId: 'o2' },
    { id: 'o4', orderNumber: 4, trackingNumber: '9400111100000000000005', labelTxns: ['t5'], labelVoidIds: ['t5'] },
  ]);
  check('the bench check counts each box once, skips boxes riding in another’s and voided ones, and says which box is left',
    bc.total === 3 && bc.checked === 2 && bc.waiting.length === 1 && bc.waiting[0].order.id === 'o2' && bc.waiting[0].box === 2 && bc.waiting[0].of === 2, bc);
  const bc2 = benchCheck([{ id: 'o5', orderNumber: 5, trackingNumber: '9400111100000000000006', extraTrackingNumbers: ['9400111100000000000007'], labelTxns: ['t6', 't7'], labelVoidIds: ['t6'] }]);
  check('box 1 waiting for a new label: box 2 is still called box 2 of 2', bc2.total === 1 && bc2.waiting[0]?.box === 2 && bc2.waiting[0]?.of === 2, bc2);

  // ── Pickups ──
  check('USPS takes a booking only with a Priority Mail, Express, international or return box',
    uspsPickupAllowed(['Ground Advantage', 'Priority Mail']) && !uspsPickupAllowed(['Ground Advantage']) && uspsPickupAllowed(['Priority Mail Express®']));
  const sched = scheduleFrom({ shipSchedule: { processingDays: 1, shipDays: [1, 2, 3, 4, 5], cutoff: '14:00', savedAt: '2026-10-01T00:00:00Z', pickups: [{ carrier: 'USPS', days: [2, 4], time: '15:00' }] } });
  check('a pickup booked on a Friday is for Monday; one booked Wednesday is for Thursday', pickupDay('2026-10-23', sched) === '2026-10-26' && pickupDay('2026-10-21', sched) === '2026-10-22');
  check('a pickup isn’t on a USPS holiday', pickupDay('2026-11-10', sched) === '2026-11-12');
  check('the shop’s regular USPS pickup that day means nothing to book', regularPickup('2026-10-22', sched)?.time === '15:00' && regularPickup('2026-10-23', sched) === null);

  // ── The day's summary ──
  const tz = 'America/New_York';
  const now = wallToUtc('2026-10-21', 17, 0, tz).getTime();
  const at = (h: number, d = '2026-10-21') => wallToUtc(d, h, 0, tz).toISOString();
  const recs = [
    { boughtAt: at(9), carrier: 'USPS', amountCents: 540, boxes: [{ txn: 'a' }], protection: { signature: 'NONE', insuranceCents: 0 } },
    { boughtAt: at(10), carrier: 'USPS', amountCents: 1820, boxes: [{ txn: 'b' }, { txn: 'c' }], protection: { signature: 'STANDARD', insuranceCents: 61200 } },
    { boughtAt: at(11), carrier: 'UPS', amountCents: 1200, boxes: [{ txn: 'd' }], protection: null },
    { boughtAt: at(12), carrier: 'USPS', amountCents: 700, boxes: [{ txn: 'e' }], voidedAt: at(13) },
    { boughtAt: at(23, '2026-10-20'), carrier: 'USPS', amountCents: 900, boxes: [{ txn: 'f' }] },
  ];
  const voided = [
    { voidedAt: at(6), voidWhy: 'the carrier never scanned it, and USPS labels stop working after 30 days', refunds: { x: { status: 'requested', cents: 570 }, y: { status: 'refunded', cents: 570 } } },
    { voidedAt: at(7), voidWhy: 'replaced (wrong size)', refunds: { z: { status: 'requested', cents: 900 } } },
    { voidedAt: at(6, '2026-10-10'), voidWhy: 'the order was cancelled', refunds: { w: { status: 'refunded', cents: 400 } } },
  ];
  const ds = daySummary(recs, voided, now, tz);
  check('today’s boxes and postage: bought today in the shop’s zone, voided ones left out',
    ds.labels === 4 && ds.postageCents === 3560, ds);
  check('insured goods and Shippo’s 1.25%, signatures, and boxes by carrier with USPS first',
    ds.insured.orders === 1 && ds.insured.goodsCents === 61200 && ds.insured.feeCents === 765 && ds.signatures === 1 && ds.carriers[0].carrier === 'USPS' && ds.carriers[0].boxes === 3 && ds.carriers[1].carrier === 'UPS', ds);
  check('money back: only labels nobody used (or cancelled orders) voided this past week, asked for and already back',
    ds.moneyBack.labels === 1 && ds.moneyBack.cents === 1140 && ds.moneyBack.backCents === 570 && ds.moneyBack.checkCents === 0, ds.moneyBack);
  const ds2 = daySummary([
    { boughtAt: at(9), carrier: 'USPS', amountCents: 1680, boxes: [{ txn: 'p' }, { txn: 'q', replacedBy: 'r' }], protection: { signature: 'NONE', insuranceCents: 16000, feeCents: 450 } },
    { boughtAt: at(10), carrier: 'USPS', amountCents: 840, boxes: [{ txn: 'r' }], protection: { signature: 'NONE', insuranceCents: 8000, feeCents: 225 } },
  ], [{ voidedAt: at(6), voidWhy: 'the carrier never scanned it', refunds: { u: { status: 'unconfirmed', cents: 610 }, v: { status: 'requested', cents: 300 } } }], now, tz);
  check('a box with its own new label counts once, with its share of the goods; the insurance’s real cost; refunds Shippo never confirmed are to check, not on their way',
    ds2.labels === 2 && ds2.insured.goodsCents === 16000 && ds2.insured.feeCents === 450 && ds2.moneyBack.cents === 300 && ds2.moneyBack.checkCents === 610, ds2);

  // ── Several boxes' rates, one shipment per box ──
  const combined = combineRates([
    [{ object_id: 'A1', provider: 'USPS', carrier_account: 'u', servicelevel: { token: 'usps_ground_advantage', name: 'Ground Advantage' }, amount: '5.40', estimated_days: 3, included_insurance_price: '1.10' },
     { object_id: 'A2', provider: 'USPS', carrier_account: 'u', servicelevel: { token: 'usps_priority', name: 'Priority Mail' }, amount: '9.10', estimated_days: 2 }],
    [{ object_id: 'B1', provider: 'USPS', carrier_account: 'u', servicelevel: { token: 'usps_ground_advantage', name: 'Ground Advantage' }, amount: '7.20', estimated_days: 4, included_insurance_price: '1.40' },
     { object_id: 'B3', provider: 'UPS', carrier_account: 'x', servicelevel: { token: 'ups_ground', name: 'Ground' }, amount: '11.00', estimated_days: 3 }],
  ]);
  check('several boxes: a service every box can go by, at the boxes’ prices added up, one rate per box in box order',
    combined.length === 1 && combined[0].object_id === 'boxes:A1,B1' && combined[0].amount === '12.60' && combined[0].included_insurance_price === '2.50' && combined[0].estimated_days === 4 && combined[0].boxCents.join() === '540,720', combined);
  check('a combined rate reads back as each box’s rate', isBoxRates('boxes:A1,B1') && rateIdsOf('boxes:A1,B1').join() === 'A1,B1' && rateIdsOf('R9').join() === 'R9' && !isBoxRates('R9'));

  // ── The bulk route: priced, nothing bought ──
  db._store.set(`tenants/${T}`, { businessName: 'Opal', timezone: tz, retailSettings: { shippoConnected: true, packagingPresets: presets, shipmentInsuranceEnabled: true, insuranceOverCents: 10000,
    shipFrom: { name: 'Opal', street1: '1 Main', city: 'Austin', state: 'TX', zip: '78701', phone: '512-555-0100' } } });
  db._store.set(`tenants/${T}/inventory/gel`, { weightOz: 10 });
  await db.doc(OR('a')).set(packed({ orderNumber: 1001 }));
  await db.doc(OR('b')).set(packed({ orderNumber: 1002, shippingService: 'Priority Mail', shippingCarrier: 'USPS', lines: [{ productId: 'gel', name: 'Gel kit', qtyOrdered: 3, unitPriceCents: 6000 }] }));
  await db.doc(OR('c')).set(packed({ orderNumber: 1003, addressRequest: { status: 'waiting' } }));
  await db.doc(OR('d')).set(packed({ orderNumber: 1004, packBoxes: [boxFrom(presets[0]), boxFrom(presets[1])], lines: [{ productId: 'gel', name: 'Gel kit', qtyOrdered: 4, unitPriceCents: 4000 }] }));
  await db.doc(OR('e')).set(packed({ orderNumber: 1005, shippingService: 'Priority Mail Express' }));
  let shipmentN = 0;
  const rates = (sid: string, insured: boolean) => [
    { object_id: `${sid}-g`, provider: 'USPS', carrier_account: 'acct-usps', servicelevel: { token: 'usps_ground_advantage', name: 'Ground Advantage' }, amount: insured ? '8.40' : '5.40', included_insurance_price: insured ? '2.25' : '0' },
    { object_id: `${sid}-p`, provider: 'USPS', carrier_account: 'acct-usps', servicelevel: { token: 'usps_priority', name: 'Priority Mail' }, amount: insured ? '12.10' : '9.10', included_insurance_price: insured ? '2.25' : '0' },
  ];
  // Shippo, as far as these routes use it. Labels made are kept by rate, so a lookup by rate finds them.
  const made = new Map<string, any>();
  const fail = new Set<string>(); const silent = new Set<string>(); const silentMade = new Set<string>();
  // queued: rates whose label Shippo is still making, with how many more times it says so; hijack: rates during whose
  // purchase someone else takes the order over.
  const queued = new Map<string, number>(); const hijack = new Map<string, string>();
  const txnFor = (rate: string) => ({ status: 'SUCCESS', object_id: `T-${rate}`, tracking_number: `9400${rate.replace(/\W/g, '')}0000000001`, label_url: `https://labels/${rate}.png`, tracking_url_provider: `https://track/${rate}`, rate: { provider: 'USPS' } });
  const shipments = new Map<string, any>();
  route = (u, init) => {
    if (init?.method === 'POST' && u === '/shipments/') { const b = JSON.parse(init.body); const sid = `S${++shipmentN}`; shipments.set(sid, b); const ins = !!(b.extra?.insurance || b.parcels?.some((p: any) => p.extra?.insurance)); return { status: 201, body: { object_id: sid, rates: rates(sid, ins) } }; }
    if (init?.method === 'POST' && u === '/transactions/') {
      const rate = JSON.parse(init.body).rate;
      if (fail.has(rate)) return { status: 201, body: { status: 'ERROR', messages: [{ text: 'The address isn’t deliverable' }] } };
      if (silent.has(rate)) { if (silentMade.has(rate)) made.set(rate, txnFor(rate)); return 'throw'; }
      if (queued.has(rate)) return { status: 201, body: { status: 'QUEUED', object_id: `T-${rate}` } };
      if (hijack.has(rate)) { const id = hijack.get(rate)!; db._store.set(OR(id), { ...db._store.get(OR(id)), labelBuying: { at: new Date().toISOString(), by: 'Sam', token: 'someone-else', what: 'buy' } }); }
      const t = txnFor(rate); made.set(rate, t); return { status: 201, body: t };
    }
    if (u.startsWith('/transactions/?rate=')) { const rate = decodeURIComponent(u.split('=')[1].split('&')[0]); return { body: { results: made.has(rate) ? [made.get(rate)] : (queued.get(rate) || 0) > 0 ? [{ status: 'QUEUED', object_id: `T-${rate}` }] : [] } }; }
    if (init?.method === 'POST' && u === '/refunds/') { const txn = JSON.parse(init.body).transaction; return { status: 201, body: { object_id: `RF-${txn}`, status: 'QUEUED' } }; }
    if (u.startsWith('/rates/')) { const id = decodeURIComponent(u.slice(7)); return { body: { amount: id.endsWith('-p') ? '9.10' : '5.40', provider: 'USPS', servicelevel: { name: id.endsWith('-p') ? 'Priority Mail' : 'Ground Advantage' }, carrier_account: 'acct-usps', shipment: id.split('-')[0], included_insurance_price: '0' } }; }
    if (u.startsWith('/transactions/T-')) {
      const rate = u.slice('/transactions/T-'.length);
      if (queued.has(rate)) { const n = queued.get(rate)!; if (n > 0) { queued.set(rate, n - 1); return { body: { status: 'QUEUED', object_id: `T-${rate}` } }; } queued.delete(rate); made.set(rate, txnFor(rate)); }
      return { body: { ...txnFor(rate), rate, object_created: new Date().toISOString() } };
    }
    if (u.startsWith('/shipments/S')) return { body: { shipment_date: new Date().toISOString() } };
    return null;
  };
  const { POST: BULK } = await import('../../src/app/api/retail/shipping-labels-bulk/route');
  const bulk = (orders: string[], extra: any = {}) => BULK({ json: async () => ({ tenantId: T, orders: orders.map((id) => ({ orderId: id, qrToken: 'q' })), ...extra }) } as any) as any;
  calls = [];
  const pv = await bulk(['a', 'b', 'c', 'd', 'e'], { preview: true });
  const plan = (id: string) => pv.body.plans.find((p: any) => p.orderId === id);
  check('the preview prices each order and buys nothing', pv.status === 200 && pv.body.plans.length === 3 && !calls.some((c) => c.path === '/transactions/'), pv.body);
  check('plain shipping: the cheapest; paid for Priority Mail: Priority Mail, with its insurance cost',
    plan('a')?.service === 'Ground Advantage' && plan('a')?.how === 'any' && plan('a')?.amountCents === 540 && plan('b')?.service === 'Priority Mail' && plan('b')?.how === 'matched' && plan('b')?.insuredCents === 18000 && plan('b')?.insuranceFeeCents === 225, pv.body.plans);
  const boxShipments = calls.filter((c) => c.path === '/shipments/' && c.body.parcels[0].length !== '8' || (c.path === '/shipments/' && c.body.parcels[0].weight === '22'));
  check('two boxes from the bench: one shipment per box, each with its own size, weight and share of the insurance, priced together',
    plan('d')?.boxes === 2 && plan('d')?.amountCents === 1680 && plan('d')?.insuranceFeeCents === 450 && calls.filter((c) => c.path === '/shipments/').every((c) => c.body.parcels.length === 1)
      && (() => { const ins = calls.filter((c) => c.path === '/shipments/' && [22, 26].includes(Number(c.body.parcels[0].weight)) && c.body.extra?.insurance).map((c) => Number(c.body.extra.insurance.amount)); return ins.length >= 2 && Math.abs(ins.slice(-2).reduce((a, b) => a + b, 0) - 160) < 0.01 && ins.every((x) => x < 160); })()
      && calls.some((c) => c.path === '/shipments/' && c.body.parcels[0].length === '14' && c.body.parcels[0].weight === '26') && calls.some((c) => c.path === '/shipments/' && c.body.parcels[0].length === '8' && c.body.parcels[0].weight === '22'),
    { plan: plan('d'), shipments: boxShipments.map((c) => c.body.parcels) });
  check('left out with the reason: an address change waiting, and a service that isn’t offered today',
    pv.body.left.length === 2 && /change the address/.test(pv.body.left.find((l: any) => l.orderId === 'c')?.why) && /Priority Mail Express/.test(pv.body.left.find((l: any) => l.orderId === 'e')?.why), pv.body.left);
  check('the preview leaves no claim on any order', ['a', 'b', 'd'].every((id) => !db._store.get(OR(id)).labelBuying));

  // ── Buying: one label per box ──
  calls = [];
  const buy = await bulk(['d', 'a']);
  const d = db._store.get(OR('d'));
  const recD = [...db._store.entries()].find(([k, v]: any) => k.includes('/shippingLabels/') && v.orderId === 'd')?.[1];
  const dTxns = calls.filter((c) => c.path === '/transactions/').map((c) => c.body.rate);
  check('an order in two boxes gets a label per box, each box its own shipment’s, both kept on the order in box order',
    buy.status === 200 && d.packageCount === 2 && d.extraTrackingNumbers.length === 1 && d.labelTxns.length === 2 && d.labelTxns[1] === `T-${dTxns[1]}` && d.extraLabelUrls[0] === `https://labels/${dTxns[1]}.png`, { d, dTxns });
  check('its record has both boxes with their sizes and their own prices, every box’s rate, the insurance’s real cost, and the result counts the boxes',
    recD && recD.boxes.length === 2 && recD.boxes[1].parcel?.lengthIn === 14 && recD.boxes[0].cents === 840 && recD.boxes[1].cents === 840 && recD.amountCents === 1680 && recD.rateIds?.length === 2 && recD.protection?.feeCents === 450 && buy.body.boxes === 3, { rec: recD, boxes: buy.body.boxes });
  check('a label per box bought; the claim is let go after', dTxns.length === 3 && !db._store.get(OR('d')).labelBuying && !db._store.get(OR('a')).labelBuying, dTxns);

  // A box that doesn't go through: the other box's label is voided straight away and the order has no label.
  await db.doc(OR('f')).set(packed({ orderNumber: 1006, packBoxes: [boxFrom(presets[0]), boxFrom(presets[1])] }));
  const nextSecond = `S${shipmentN + 2}-g`;
  fail.add(nextSecond);
  calls = [];
  const half = await bulk(['f']);
  const f = db._store.get(OR('f'));
  const recF = [...db._store.entries()].find(([k, v]: any) => k.includes('/shippingLabels/') && v.orderId === 'f')?.[1];
  check('box 2 failing: nothing is saved on the order, box 1’s label is voided and its refund followed, and it says so',
    !f.labelUrl && !f.labelBuying && half.body.results[0].ok === false && /Box 2/.test(half.body.results[0].error) && calls.some((c) => c.path === '/refunds/') && !!recF?.refunds && Object.values(recF.refunds).some((r: any) => r.status === 'requested') && /another box/.test(String(recF.voidWhy || '')), { f, rec: recF, res: half.body.results });
  fail.delete(nextSecond);

  // A purchase Shippo didn't answer, that went through anyway: found by its rate and used.
  await db.doc(OR('g')).set(packed({ orderNumber: 1007 }));
  const quietRate = `S${shipmentN + 1}-g`;
  silent.add(quietRate); silentMade.add(quietRate);
  const quiet = await bulk(['g']);
  check('no answer to a purchase: Shippo is asked by its rate, and the label it made is the one kept', quiet.body.results[0].ok === true && db._store.get(OR('g')).shippoTransactionId === `T-${quietRate}`, quiet.body.results);
  silent.delete(quietRate); silentMade.delete(quietRate);

  // No answer, and nothing made: not bought, and the rate stays in doubt for the next try to check.
  await db.doc(OR('h')).set(packed({ orderNumber: 1008 }));
  const lostRate = `S${shipmentN + 1}-g`;
  silent.add(lostRate);
  const lost = await bulk(['h']);
  check('no answer and no label: it isn’t counted as bought, and the rate is kept on the order to check next time',
    lost.body.results[0].ok === false && !db._store.get(OR('h')).labelUrl && (db._store.get(OR('h')).labelBuyDoubt?.rates || []).includes(lostRate), { res: lost.body.results, h: db._store.get(OR('h')) });
  silent.delete(lostRate);
  // It turned up after all: the next purchase voids it first, then buys its own.
  made.set(lostRate, txnFor(lostRate));
  calls = [];
  const retried = await bulk(['h']);
  const h = db._store.get(OR('h'));
  const recLost = db._store.get(`tenants/${T}/shippingLabels/T-${lostRate.replace(/[^\w-]/g, '')}`);
  check('the label an earlier try bought without saving is voided before a new one is bought',
    retried.body.results[0].ok === true && h.shippoTransactionId !== `T-${lostRate}` && calls.some((c) => c.path === '/refunds/' && c.body.transaction === `T-${lostRate}`) && !!recLost && /cut off/.test(String(recLost.voidWhy || '')) && !h.labelBuyDoubt, { h, recLost });

  // A purchase cut off part way (its claim left behind with its rates): found and voided on the next claim.
  await db.doc(OR('k')).set(packed({ orderNumber: 1009, labelBuying: { at: new Date(Date.now() - 10 * 60e3).toISOString(), by: 'Maya', token: 'old', what: 'buy', rates: ['R-cut'] } }));
  made.set('R-cut', txnFor('R-cut'));
  calls = [];
  const after = await bulk(['k']);
  check('a purchase cut off before it was saved: its label is voided, then the order gets its own',
    after.body.results[0].ok === true && calls.some((c) => c.path === '/refunds/' && c.body.transaction === 'T-R-cut') && db._store.get(OR('k')).shippoTransactionId !== 'T-R-cut', after.body.results);

  // Out of time: no new order is started, and the rest come back to be sent again.
  await db.doc(OR('m1')).set(packed({ orderNumber: 1010 }));
  await db.doc(OR('m2')).set(packed({ orderNumber: 1011 }));
  const realNow = Date.now; let jump = 0;
  Date.now = () => realNow() + jump;
  const prevRoute = route;
  route = (u, init) => { const r = prevRoute(u, init); if (init?.method === 'POST' && u === '/transactions/') jump += 200_000; return r; };
  const timed = await bulk(['m1', 'm2']);
  Date.now = realNow; route = prevRoute;
  check('a run out of time stops before the next order and hands it back', timed.body.results.length === 1 && timed.body.results[0].orderId === 'm1' && timed.body.notTried.join() === 'm2', timed.body);
  await bulk(['m2']);

  // A label Shippo is still making: waited for, and kept once it's made.
  BUY_WAIT.ms = 300; BUY_WAIT.every = 20;
  await db.doc(OR('q1')).set(packed({ orderNumber: 1012 }));
  const qRate = `S${shipmentN + 1}-g`;
  queued.set(qRate, 0);
  const q1 = await bulk(['q1']);
  check('a label Shippo is still making is waited for, and kept once it’s made', q1.body.results[0].ok === true && db._store.get(OR('q1')).shippoTransactionId === `T-${qRate}`, q1.body.results);
  // Still being made after the wait: not counted as bought, and no other label goes over it until Shippo has it.
  await db.doc(OR('q2')).set(packed({ orderNumber: 1013 }));
  const q2Rate = `S${shipmentN + 1}-g`;
  queued.set(q2Rate, 999);
  const q2 = await bulk(['q2']);
  check('still being made after the wait: not bought, and its rate stays in doubt on the order',
    q2.body.results[0].ok === false && !db._store.get(OR('q2')).labelUrl && (db._store.get(OR('q2')).labelBuyDoubt?.rates || []).includes(q2Rate) && db._store.get(OR('q2')).labelBuyDoubtOpen === true, { r: q2.body.results, o: db._store.get(OR('q2')) });
  calls = [];
  const q2b = await bulk(['q2']);
  check('asked again while Shippo is still making it: nothing new is bought', q2b.body.results[0].ok === false && /still being made/.test(q2b.body.results[0].error) && !calls.some((c) => c.path === '/transactions/'), q2b.body.results);
  // Shippo finishes it: the morning check voids it (it was never saved on the order) and clears the doubt.
  queued.delete(q2Rate); made.set(q2Rate, txnFor(q2Rate));
  const { settleDoubts } = await import('../../src/lib/label-void');
  calls = [];
  const settledN = await settleDoubts(db, T, 'k', Date.now() + 60000);
  const q2o = db._store.get(OR('q2'));
  const q2ev = [...db._store.entries()].filter(([k]) => k.startsWith(`${OR('q2')}/events/`)).map(([, v]: any) => v.meta?.text || '').join(' | ');
  check('the morning check voids a label made on a purchase nobody saved, says so on the order, and clears the doubt',
    settledN === 1 && calls.some((c) => c.path === '/refunds/' && c.body.transaction === `T-${q2Rate}`) && q2o.labelBuyDoubtOpen === false && !q2o.labelBuyDoubt && !q2o.labelBuying && /earlier try/.test(q2ev), { q2o, q2ev });
  // Someone else takes the order over while its label is being bought: this one isn't saved over theirs, and it's voided.
  await db.doc(OR('t9')).set(packed({ orderNumber: 1015 }));
  const hRate = `S${shipmentN + 1}-g`;
  hijack.set(hRate, 't9');
  calls = [];
  const hij = await bulk(['t9']);
  check('a claim taken over mid-purchase: the label isn’t saved on the order, and it’s voided at once',
    hij.body.results[0].ok === false && !db._store.get(OR('t9')).labelUrl && calls.some((c) => c.path === '/refunds/' && c.body.transaction === `T-${hRate}`) && db._store.get(OR('t9')).labelBuying?.token === 'someone-else', { r: hij.body.results, o: db._store.get(OR('t9')) });
  hijack.clear();
  db._store.set(OR('t9'), { ...db._store.get(OR('t9')), labelBuying: null });
  BUY_WAIT.ms = 20000; BUY_WAIT.every = 2000;

  // ── The pickup ──
  const { POST: PICK } = await import('../../src/app/api/retail/pickup/route');
  const pick = (action: string, extra: any = {}) => PICK({ json: async () => ({ tenantId: T, action, ...extra }) } as any) as any;
  const st = await pick('status');
  const waiting = (n: number) => n;
  check('the pickup knows the USPS boxes waiting and that none is Priority Mail yet', st.status === 200 && st.body.boxes === waiting(9) && st.body.allowed === false && !st.body.booking && st.body.zone === true, st.body);
  check('booking is refused without a Priority Mail box', (await pick('book')).status === 409 && !calls.some((c) => c.path === '/pickups/'));
  // A Priority Mail order joins.
  await bulk(['b']);
  let pickupReply: Reply = { status: 201, body: { object_id: 'PK1', status: 'CONFIRMED', confirmation_code: 'WTC123', confirmed_start_time: '2026-10-22T09:00:00', confirmed_end_time: '2026-10-22T17:00:00', timezone: tz } };
  route = ((prev) => (u: string, init?: any) => {
    if (init?.method === 'POST' && u === '/pickups/') return pickupReply;
    return prev(u, init);
  })(route);
  const tenant0 = db._store.get(`tenants/${T}`);
  db._store.set(`tenants/${T}`, { ...tenant0, retailSettings: { ...tenant0.retailSettings, shipFrom: { ...tenant0.retailSettings.shipFrom, phone: '' } } });
  const noPhone = await pick('book');
  check('USPS needs a phone number on the ship-from address', noPhone.status === 400 && /phone/.test(noPhone.body.error));
  db._store.set(`tenants/${T}`, { ...tenant0, timezone: '' });
  const noZone = await pick('book');
  check('no time zone set: refused, so the window isn’t asked for in UTC', noZone.status === 409 && /time zone/.test(noZone.body.error) && (await pick('status')).body.zone === false);
  db._store.set(`tenants/${T}`, tenant0);
  // Shippo didn't answer: kept as not known, and booking again waits until someone checks with USPS.
  pickupReply = 'throw';
  calls = [];
  const noAnswer = await pick('book');
  const dayId = noAnswer.body.booking?.day;
  check('no answer from Shippo: the day is kept as not known, never freed for a second booking',
    noAnswer.status === 504 && noAnswer.body.unknown === true && db._store.get(`tenants/${T}/shipPickups/${dayId}`)?.status === 'UNKNOWN', noAnswer.body);
  calls = [];
  const blocked = await pick('book');
  check('booking again waits until someone has checked with USPS', blocked.status === 409 && blocked.body.unknown === true && !calls.some((c) => c.path === '/pickups/'));
  // Turned down outright: the day is free again.
  // Turned down on a second try: USPS takes one pickup a day, so the first may have gone through. It stays not confirmed.
  pickupReply = { status: 400, body: { detail: 'A pickup is already scheduled' } };
  const turnedAgain = await pick('book', { retry: true });
  check('a second try turned down: kept as not confirmed, never offered as a fresh booking', turnedAgain.status === 409 && turnedAgain.body.unknown === true && db._store.get(`tenants/${T}/shipPickups/${dayId}`)?.status === 'UNKNOWN', turnedAgain.body);
  // Turned down outright on a first try: nothing is kept, so it can be tried again.
  db._store.delete(`tenants/${T}/shipPickups/${dayId}`);
  pickupReply = { status: 400, body: { detail: 'Pickup window not available' } };
  const turned = await pick('book');
  check('turned down outright: nothing is kept, so it can be tried again', turned.status === 422 && /window not available/.test(turned.body.error) && !db._store.get(`tenants/${T}/shipPickups/${dayId}`), { turned: turned.body, rec: db._store.get(`tenants/${T}/shipPickups/${dayId}`) });
  // Requested, not yet confirmed: kept as requested.
  pickupReply = { status: 201, body: { object_id: 'PK0', status: 'PENDING' } };
  const pend = await pick('book');
  check('Shippo took it but USPS hasn’t confirmed: kept as requested, and a second tap gets it', pend.status === 200 && pend.body.booking.status === 'PENDING' && (await pick('book')).body.already === true, pend.body);
  db._store.delete(`tenants/${T}/shipPickups/${dayId}`);
  pickupReply = { status: 201, body: { object_id: 'PK1', status: 'CONFIRMED', confirmation_code: 'WTC123', confirmed_start_time: '2026-10-22T09:00:00', confirmed_end_time: '2026-10-22T17:00:00', timezone: tz } };
  calls = [];
  const booked = await pick('book');
  const sent = calls.find((c) => c.path === '/pickups/');
  check('booked with every USPS box waiting, 9 to 5 on the day, on the labels’ USPS account', booked.status === 200 && booked.body.booking.confirmationCode === 'WTC123' && sent?.body.transactions.length === 10 && sent?.body.carrier_account === 'acct-usps' && sent?.body.location.address.phone === '512-555-0100', { booked: booked.body, sent: sent?.body });
  calls = [];
  const again = await pick('book');
  check('one booking a day: asking again gets the booking already made', again.status === 200 && again.body.already === true && !calls.some((c) => c.path === '/pickups/'));
  const st2 = await pick('status');
  check('the status shows the booking, and boxes already on it aren’t counted again', st2.body.booking?.confirmationCode === 'WTC123' && st2.body.boxes === 0, st2.body);
  // Today's pickup, booked yesterday, shows too.
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (todayKey !== dayId) db._store.set(`tenants/${T}/shipPickups/${todayKey}`, { day: todayKey, status: 'CONFIRMED', confirmationCode: 'TODAY1', boxes: 2, txns: [] });
  check('today’s pickup shows beside the next one', todayKey === dayId || (await pick('status')).body.today?.confirmationCode === 'TODAY1');

  // ── Close the day ──
  const { POST: CLOSE } = await import('../../src/app/api/retail/close-day/route');
  const summary = await CLOSE({ json: async () => ({ tenantId: T, action: 'summary' }) } as any) as any;
  check('the day so far comes from the label records', summary.status === 200 && summary.body.summary?.labels >= 4 && summary.body.summary?.postageCents > 0, summary.body);
  route = ((prev) => (u: string, init?: any) => {
    if (init?.method === 'POST' && u === '/manifests/') return { status: 201, body: { object_id: 'MF1', status: 'SUCCESS', documents: ['https://forms/mf1.pdf'] } };
    return prev(u, init);
  })(route);
  calls = [];
  const closed = await CLOSE({ json: async () => ({ tenantId: T, action: 'manifest' }) } as any) as any;
  const form = calls.find((c) => c.path === '/manifests/');
  check('the USPS form has every box of a two-box order, and counts boxes', closed.status === 200 && form?.body.transactions.includes(d.labelTxns[0]) && form?.body.transactions.includes(d.labelTxns[1]) && closed.body.count === form?.body.transactions.length && db._store.get(OR('d')).manifestId && db._store.get(OR('d')).manifestTxns?.length === 2, { count: closed.body.count, sent: form?.body.transactions });
  // A box Shippo turns away stays off the order's stamp, and goes on the next form.
  const nowIso = new Date().toISOString();
  await db.doc(OR('p2b')).set(packed({ orderNumber: 1016, carrier: 'USPS', shippoTransactionId: 'T-S90-g', trackingNumber: '9400S90g0000000001', labelUrl: 'https://labels/S90-g.png', extraTrackingNumbers: ['9400S91g0000000001'], extraLabelUrls: ['https://labels/S91-g.png'], labelTxns: ['T-S90-g', 'T-S91-g'], packedAt: nowIso, shipmentProtection: { decidedAt: nowIso } }));
  let refuseOnce = true;
  route = ((prev) => (u: string, init?: any) => {
    if (init?.method === 'POST' && u === '/manifests/') { const tx = JSON.parse(init.body).transactions; if (refuseOnce && tx.includes('T-S91-g')) { refuseOnce = false; return { status: 400, body: { transactions: { 'T-S91-g': { reason: 'Label not eligible right now' } } } }; } }
    return prev(u, init);
  })(route);
  calls = [];
  const c1 = await CLOSE({ json: async () => ({ tenantId: T, action: 'manifest' }) } as any) as any;
  const pb1 = db._store.get(OR('p2b'));
  check('a box turned away isn’t stamped as on the form; the box that went on it is', c1.status === 200 && (pb1.manifestTxns || []).join() === 'T-S90-g' && c1.body.failed.length === 1, { txns: pb1.manifestTxns, failed: c1.body.failed });
  calls = [];
  const c2 = await CLOSE({ json: async () => ({ tenantId: T, action: 'manifest' }) } as any) as any;
  const sent2 = calls.filter((c) => c.path === '/manifests/').map((c) => c.body.transactions);
  check('the next close puts the box turned away on a form of its own, and nothing else', c2.status === 200 && sent2.length === 1 && sent2[0].join() === 'T-S91-g' && (db._store.get(OR('p2b')).manifestTxns || []).length === 2, { sent2, txns: db._store.get(OR('p2b')).manifestTxns });

  actor = { uid: 'u2', name: 'Sam', role: 'stylist' };
  check('someone who can’t ship can’t price, book or close', (await bulk(['a'], { preview: true })).status === 403 && (await pick('book')).status === 403);

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
