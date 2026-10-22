// Checks the label route end to end against a stand-in database and Shippo (api/retail/shipping-label): a purchase
// keeps every box's label and a record of it, one purchase at a time, a replacement voids the old label first (and
// buys nothing if the carrier has it), one box can be replaced or given a new label or taken off, and "Got it" clears
// the cards.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shipping-label-route.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';

const db = makeDb();
// The route's own connections, stood in for: the database, who's signed in, the Shippo key, the response.
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin-retail-shipping' }), getApps: () => [{ name: 'admin-retail-shipping' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: { arrayUnion: FV.arrayUnion, increment: FV.increment, delete: FV.delete, serverTimestamp: FV.serverTimestamp } };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { uid: 'u1', name: 'Maya Lin', isTenantOwner: true } }) };
  if (request === '@/lib/retail-secrets') return { shippoKeyFor: async () => 'k', getRetailSecrets: async () => ({ shippoApiKey: 'k' }) };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/notify') return { sendNotification: async () => ({ ok: true }) };
  return load.call(this, request, ...rest);
};

const T = 'shop';
const OR = (id: string) => `tenants/${T}/retailOrders/${id}`;
const LR = (id: string) => `tenants/${T}/shippingLabels/${id}`;
const realFetch = globalThis.fetch;
let calls: string[] = [];
type Reply = { status?: number; body?: any } | 'throw' | null;
let route: (u: string, init?: any) => Reply = () => null;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url).replace('https://api.goshippo.com', ''); calls.push(`${init?.method || 'GET'} ${u}`);
  const r = route(u, init);
  if (r === 'throw') throw new Error('timed out');
  const { status = 200, body = {} } = r || { status: 404 };
  return { ok: status >= 200 && status < 300, status, json: async () => body } as any;
}) as any;
const pre = { tracking_status: { status: 'PRE_TRANSIT' }, tracking_history: [{ status: 'PRE_TRANSIT' }] };
const moving = { tracking_status: { status: 'TRANSIT' }, tracking_history: [{ status: 'TRANSIT' }] };
const addr = { name: 'Dana Whitfield', line1: '12 Elm St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };
const baseOrder = (extra: any = {}) => ({ qrToken: 'q', method: 'ship', stage: 'packed', orderNumber: 1042, customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', shippingAddress: addr, lines: [{ name: 'Gel kit', qtyOrdered: 1, unitPriceCents: 4500 }], ...extra });
const order = (id: string) => db._store.get(OR(id));
const rec = (id: string) => db._store.get(LR(id));

(async () => {
  db._store.set(`tenants/${T}`, { businessName: 'Opal', retailSettings: { shippoConnected: true, shipFrom: { name: 'Opal', street1: '1 Main', city: 'Austin', state: 'TX', zip: '78701' } } });
  const { POST } = await import('../../src/app/api/retail/shipping-label/route');
  const call = async (orderId: string, body: any) => (await POST({ json: async () => ({ tenantId: T, orderId, qrToken: 'q', ...body }) } as any)) as any;
  // Shippo: a two-box rate r2 (labels X1, X2) and one-box rates r1 (Y1), rb (Z1); any other rate's label is W-{rate}.
  const shippo = (over: (u: string, init?: any) => Reply = () => null) => (u: string, init?: any): Reply => {
    const o = over(u, init); if (o !== null) return o;
    if (init?.method === 'POST' && u === '/transactions/') {
      const rate = JSON.parse(init.body).rate;
      const id = rate === 'r2' ? 'X1' : rate === 'r1' ? 'Y1' : rate === 'rb' ? 'Z1' : `W-${rate}`;
      return { status: 201, body: { status: 'SUCCESS', object_id: id, tracking_number: `9400${id}000000000001`, label_url: `https://labels/${id}.pdf`, tracking_url_provider: `https://track/${id}`, parcel: `P-${id}` } };
    }
    if (u.startsWith('/rates/')) { const r = u.split('/')[2]; return { body: { amount: r === 'r2' ? '9.10' : r === 'r1' ? '8.40' : '4.75', provider: 'USPS', servicelevel: { name: 'Ground Advantage' }, shipment: `S-${r}` } }; }
    if (u.startsWith('/transactions/?rate=r2')) return { body: { results: [
      { object_id: 'X1', status: 'SUCCESS', tracking_number: '9400X1000000000001', label_url: 'https://labels/X1.pdf', parcel: 'P-X1' },
      { object_id: 'X2', status: 'SUCCESS', tracking_number: '9400X2000000000001', label_url: 'https://labels/X2.pdf', tracking_url_provider: 'https://track/X2', parcel: 'P-X2' }] } };
    if (u.startsWith('/transactions/?rate=')) return { body: { results: [] } };
    if (u === '/shipments/S-r2') return { body: { parcels: [{ object_id: 'P-X1', length: '12', width: '10', height: '6', weight: '38', mass_unit: 'oz' }, { object_id: 'P-X2', length: '9', width: '6', height: '2', weight: '14', mass_unit: 'oz' }] } };
    if (init?.method === 'POST' && u === '/refunds/') return { status: 201, body: { object_id: `rf-${JSON.parse(init.body).transaction}`, status: 'QUEUED' } };
    if (u.startsWith('/tracks/')) return { body: pre };
    return null;
  };

  // ── Buying a two-box label ──
  db._store.set(OR('o1'), baseOrder());
  route = shippo(); calls = [];
  let r = await call('o1', { action: 'purchase', rateId: 'r2', parcels: [{ weightOz: 38, lengthIn: 12, widthIn: 10, heightIn: 6 }, { weightOz: 14, lengthIn: 9, widthIn: 6, heightIn: 2 }] });
  let o = order('o1'); let L = rec('X1');
  check('a two-box label: every box on the order, in box order, with each box’s Shippo label kept', r.status === 200 && o.trackingNumber === '9400X1000000000001' && o.extraTrackingNumbers.join() === '9400X2000000000001' && o.labelTxns.join() === 'X1,X2' && o.labelRecs.join() === 'X1,X1' && o.packageCount === 2, { r, o });
  check('the carrier is the rate’s own (not a stand-in name)', o.carrier === 'USPS' && r.body.carrier === 'USPS');
  check('a record of it: both boxes with their sizes, the price, who bought it', L?.boxTxns.join() === 'X1,X2' && L.amountCents === 910 && L.boxes[1].parcel?.weightOz === 14 && L.boughtBy.name === 'Maya Lin' && L.how === 'single' && L.orderIds.join() === 'o1', L);
  check('the postage goes into the books once, and the order is free again', db._store.get(`tenants/${T}/transactions/postage-X1`)?.amount === 9.1 && o.labelBuying === null);
  r = await call('o1', { action: 'purchase', rateId: 'r2', parcels: [{ weightOz: 10 }] });
  check('a second label over a live one is refused', r.status === 409 && /already has a label/.test(r.body.error));

  // ── One purchase at a time ──
  db._store.set(OR('o2'), baseOrder({ labelBuying: { at: new Date().toISOString(), by: 'Jo', token: 'other' } }));
  calls = [];
  r = await call('o2', { action: 'purchase', rateId: 'r1', parcels: [{ weightOz: 20 }] });
  check('while someone else is buying a label for an order, nothing is bought', r.status === 409 && r.body.busy === true && !calls.some((c) => c.startsWith('POST /transactions')));

  // ── Replacing the whole label ──
  calls = [];
  r = await call('o1', { action: 'replace', rateId: 'r1', parcels: [{ weightOz: 52, lengthIn: 14, widthIn: 12, heightIn: 8 }], reason: { kind: 'size' } });
  o = order('o1');
  check('replace: the old labels are voided first, then the new one is bought', r.status === 200 && calls.findIndex((c) => c === 'POST /refunds/') < calls.findIndex((c) => c === 'POST /transactions/') && calls.filter((c) => c === 'POST /refunds/').length === 2, calls);
  check('…the order carries the new label, and the old numbers are remembered as dead', o.shippoTransactionId === 'Y1' && o.labelTxns.join() === 'Y1' && o.extraTrackingNumbers.length === 0 && (o.voidedTracking || []).includes('9400X2000000000001'), o);
  check('…the two records are linked, with the reason', rec('X1').replacedBy === 'Y1' && rec('X1').replacedWhy?.kind === 'size' && rec('Y1').replaces?.id === 'X1' && rec('Y1').reason?.kind === 'size' && rec('Y1').how === 'replace');
  check('…the old label’s refund is asked for, box by box, and the sheet is told how much', rec('X1').refunds.X1?.status === 'requested' && rec('X1').refunds.X2?.cents === 455 && r.body.replaced?.refundCents === 910 && rec('X1').refundOpen === true);
  check('…and nothing comes back into the books until Shippo confirms it', !db._store.get(`tenants/${T}/transactions/postage-void-X1`) && !db._store.get(`tenants/${T}/transactions/postage-refund-X1`) && db._store.get(`tenants/${T}/transactions/postage-Y1`)?.amount === 8.4);
  check('…the void ran under the replacement’s own claim, and the order is free again afterwards', o.labelBuying === null);

  // ── The carrier already has the old label: nothing is voided or bought ──
  db._store.set(OR('o3'), baseOrder({ shippoTransactionId: 'K1', trackingNumber: '9400K1000000000001', labelUrl: 'https://labels/K1.pdf', carrier: 'USPS', labelTxns: ['K1'], labelRecs: ['K1'] }));
  route = shippo((u) => (u.startsWith('/tracks/') ? { body: moving } : null)); calls = [];
  r = await call('o3', { action: 'replace', rateId: 'r1', parcels: [{ weightOz: 20 }], reason: { kind: 'damaged' } });
  check('replace when the carrier has scanned the old label: refused, nothing voided, nothing bought', r.status === 409 && /Nothing new was bought|nothing new was bought/.test(r.body.error) && !calls.some((c) => c.startsWith('POST')) && order('o3').shippoTransactionId === 'K1', { r, calls });
  route = shippo();
  r = await call('o3', { action: 'replace', rateId: 'r1', parcels: [{ weightOz: 20 }], reason: { kind: 'other', note: '' } });
  check('“something else” needs a note for the record', r.status === 400 && /note/.test(r.body.error));

  // ── Replacing one box of two ──
  db._store.set(OR('o4'), baseOrder({ shippoTransactionId: 'A1', trackingNumber: '9400A1000000000001', labelUrl: 'https://labels/A1.pdf', extraTrackingNumbers: ['9400A2000000000001'], extraLabelUrls: ['https://labels/A2.pdf'], extraTrackingUrls: [''], carrier: 'USPS', labelTxns: ['A1', 'A2'], labelRecs: ['A1', 'A1'], packageCount: 2, labelsChecked: ['9400A1000000000001', '9400A2000000000001'], labelCheckedAt: 'x' }));
  db._store.set(LR('A1'), { id: 'A1', orderId: 'o4', orderIds: ['o4'], boxes: [{ txn: 'A1', tracking: '9400A1000000000001' }, { txn: 'A2', tracking: '9400A2000000000001' }], boxTxns: ['A1', 'A2'], amountCents: 910, refunds: {}, carrier: 'USPS' });
  calls = [];
  r = await call('o4', { action: 'replace', box: 1, rateId: 'rb', parcels: [{ weightOz: 16, lengthIn: 9, widthIn: 6, heightIn: 2 }], reason: { kind: 'damaged' } });
  o = order('o4');
  check('replace box 2 only: just its label is voided, and its new one takes its place', r.status === 200 && calls.filter((c) => c === 'POST /refunds/').length === 1 && o.trackingNumber === '9400A1000000000001' && o.extraTrackingNumbers.join() === '9400Z1000000000001' && o.labelTxns.join() === 'A1,Z1' && o.labelRecs.join() === 'A1,Z1' && o.labelVoidIds.length === 0, { r, o });
  check('…box 1 stays checked, box 2 needs checking again', o.labelsChecked.join() === '9400A1000000000001' && o.labelCheckedAt === null);
  check('…the old record marks box 2 replaced and its refund requested at its share', rec('A1').boxes[1].replacedBy === 'Z1' && rec('A1').refunds.A2?.cents === 455 && !rec('A1').refunds.A1 && rec('Z1').replaces?.slot === 1 && rec('Z1').how === 'replace' && r.body.replaced?.refundCents === 455);

  // ── A box whose label was voided while the other went out: its own new label, or off the order ──
  db._store.set(OR('o5'), baseOrder({ shippoTransactionId: 'B1', trackingNumber: '9400B1000000000001', labelUrl: 'https://labels/B1.pdf', extraTrackingNumbers: ['9400B2000000000001'], extraLabelUrls: ['https://labels/B2.pdf'], extraTrackingUrls: [''], carrier: 'USPS', labelTxns: ['B1', 'B2'], labelRecs: ['B1', 'B1'], labelVoidIds: ['B2'], relabelOpen: true, labelSeenMoving: 'x', packageCount: 2 }));
  db._store.set(LR('B1'), { id: 'B1', orderId: 'o5', orderIds: ['o5'], boxes: [{ txn: 'B1' }, { txn: 'B2' }], boxTxns: ['B1', 'B2'], amountCents: 910, refunds: {} });
  r = await call('o5', { action: 'box', slot: 0, rateId: 'rb', parcels: [{ weightOz: 16 }] });
  check('a box whose label still works can’t be given another', r.status === 409 && /already has a label/.test(r.body.error));
  r = await call('o5', { action: 'box', slot: 1, rateId: 'rb', parcels: [{ weightOz: 16 }] });
  o = order('o5');
  check('the voided box gets its own new label in its place, and the order no longer waits', r.status === 200 && o.extraTrackingNumbers.join() === '9400Z1000000000001' && o.labelTxns.join() === 'B1,Z1' && o.labelVoidIds.length === 0 && o.relabelOpen === false && rec('B1').boxes[1].replacedBy === 'Z1' && rec('Z1').how === 'box', { r, o });
  db._store.set(OR('o6'), { ...baseOrder(), ...order('o5'), labelTxns: ['B1', 'B2'], labelVoidIds: ['B1'], extraTrackingNumbers: ['9400B2000000000001'], extraLabelUrls: ['https://labels/B2.pdf'], relabelOpen: true });
  r = await call('o6', { action: 'drop_box', slot: 1 });
  check('only a voided box can come off the order', r.status === 409);
  r = await call('o6', { action: 'drop_box', slot: 0 });
  o = order('o6');
  check('box 1 isn’t going: it comes off, and box 2 becomes the order’s first box', r.status === 200 && o.trackingNumber === '9400B2000000000001' && o.shippoTransactionId === 'B2' && o.labelTxns.join() === 'B2' && o.packageCount === 1 && o.relabelOpen === false, { r, o });

  // ── A void that didn't finish is settled before any box gets a new label ──
  db._store.set(OR('o10'), baseOrder({ shippoTransactionId: 'D1', trackingNumber: '9400D1000000000001', labelUrl: 'https://labels/D1.pdf', extraTrackingNumbers: ['9400D2000000000001'], extraLabelUrls: ['https://labels/D2.pdf'], extraTrackingUrls: [''], carrier: 'USPS', labelTxns: ['D1', 'D2'], labelRecs: ['D1', 'D1'], labelVoidIds: ['D1'], packageCount: 2,
    labelUnscannedOpen: true, labelUnscanned: { why: 'void_unfinished' } }));
  calls = [];
  r = await call('o10', { action: 'box', slot: 0, rateId: 'rb', parcels: [{ weightOz: 16 }] });
  let r2 = await call('o10', { action: 'drop_box', slot: 0 });
  check('while a void of the label hasn’t finished, no box gets a new label or comes off', r.status === 409 && /hasn’t finished/.test(r.body.error) && r2.status === 409 && !calls.some((c) => c.startsWith('POST')) && order('o10').labelTxns.join() === 'D1,D2', { r, r2 });

  // ── The order changed while the label was being bought: kept, voided, followed ──
  db._store.set(OR('o11'), baseOrder());
  route = shippo((u, init) => {
    if (init?.method === 'POST' && u === '/transactions/') { db._store.set(OR('o11'), { ...order('o11'), shippingAddress: { ...addr, line1: '99 New Rd' } }); }
    return null;
  });
  r = await call('o11', { action: 'purchase', rateId: 'r1', parcels: [{ weightOz: 20 }] });
  check('a label bought while the address changed is voided straight away, and kept: its record, its postage in the books, its refund followed',
    r.status === 409 && r.body.addressChanged === true && !order('o11').shippoTransactionId && rec('Y1')?.refunds?.Y1?.status === 'requested' && rec('Y1')?.orderIds.includes('o11')
      && db._store.get(`tenants/${T}/transactions/postage-Y1`)?.amount === 8.4 && order('o11').labelBuying === null, { r, rec: rec('Y1') });

  // ── Replacing when Shippo won't void one of the old boxes ──
  db._store.set(OR('o12'), baseOrder({ shippoTransactionId: 'E1', trackingNumber: '9400E1000000000001', labelUrl: 'https://labels/E1.pdf', extraTrackingNumbers: ['9400E2000000000001'], extraLabelUrls: ['https://labels/E2.pdf'], extraTrackingUrls: [''], carrier: 'USPS', labelTxns: ['E1', 'E2'], labelRecs: ['E1', 'E1'], packageCount: 2 }));
  db._store.set(LR('E1'), { id: 'E1', orderId: 'o12', orderIds: ['o12'], boxes: [{ txn: 'E1' }, { txn: 'E2' }], boxTxns: ['E1', 'E2'], amountCents: 1000, refunds: {}, carrier: 'USPS' });
  route = shippo((u, init) => (init?.method === 'POST' && u === '/refunds/' && JSON.parse(init.body).transaction === 'E2' ? { status: 400, body: { detail: 'Transaction is not eligible for a refund' } } : null));
  r = await call('o12', { action: 'replace', rateId: 'r1', parcels: [{ weightOz: 30 }], reason: { kind: 'service' } });
  check('Shippo wouldn’t void one old box: the new label is still bought, the sheet is told that postage isn’t coming back, and the record says so',
    r.status === 200 && /wouldn’t void/.test(r.body.replaced?.note || '') && rec('E1').refunds.E2?.status === 'refused' && rec('E1').refunds.E1?.status === 'requested' && r.body.replaced?.refundCents === 500 && order('o12').shippoTransactionId === 'Y1', { r, rec: rec('E1') });

  // ── Replacing the whole label when one box already had its own new label: its boxes are on two records ──
  db._store.set(OR('o13'), baseOrder({ shippoTransactionId: 'G1', trackingNumber: '9400G1000000000001', labelUrl: 'https://labels/G1.pdf', extraTrackingNumbers: ['9400G2000000000001'], extraLabelUrls: ['https://labels/G2.pdf'], extraTrackingUrls: [''], carrier: 'USPS', labelTxns: ['G1', 'G2'], labelRecs: ['G1', 'G2'], packageCount: 2 }));
  db._store.set(LR('G1'), { id: 'G1', orderId: 'o13', orderIds: ['o13'], boxes: [{ txn: 'G1' }, { txn: 'G0', replacedBy: 'G2' }], boxTxns: ['G1', 'G0'], amountCents: 1000, carrier: 'USPS',
    refunds: { G0: { status: 'refunded', cents: 500, requestedAt: 'x', slot: 1, refundId: 'rf-G0' } } });
  db._store.set(LR('G2'), { id: 'G2', orderId: 'o13', orderIds: ['o13'], boxes: [{ txn: 'G2' }], boxTxns: ['G2'], amountCents: 450, carrier: 'USPS', refunds: {}, replaces: { id: 'G1', slot: 1 } });
  route = shippo(); calls = [];
  r = await call('o13', { action: 'replace', rateId: 'rg', parcels: [{ weightOz: 40 }], reason: { kind: 'service' } });
  check('replacing a label whose boxes were bought on two: both are voided, both records link to the new one, and the refund counts both boxes (not the box replaced before)',
    r.status === 200 && calls.filter((c) => c === 'POST /refunds/').length === 2 && rec('G1').replacedBy === 'W-rg' && rec('G2').replacedBy === 'W-rg' && rec('G1').refunds.G1?.cents === 500 && rec('G2').refunds.G2?.cents === 450
      && r.body.replaced?.refundCents === 950 && (rec('W-rg').replaces?.ids || []).join() === 'G1,G2' && rec('W-rg').replaces?.id === 'G1' && order('o13').labelTxns.join() === 'W-rg', { r, g1: rec('G1'), g2: rec('G2'), nw: rec('W-rg') });

  // ── A save the database didn't answer: the order says whether it went through ──
  const realTx = db.runTransaction;
  let lose: 'answer' | 'write' | null = null;
  db.runTransaction = async (fn: any) => {
    if (!lose) return realTx(fn);
    // Writes held back until the end, so a save can fail before or after it lands.
    const writes: (() => Promise<void>)[] = []; let isSave = false;
    const out = await fn({ get: (x: any) => (x.get ? x.get() : x), set: (x: any, v: any, opt?: any) => { if (String(x.path).includes('/shippingLabels/') && v?.boughtAt) isSave = true; writes.push(() => x.set(v, opt)); },
      update: (x: any, v: any) => { writes.push(() => x.update(v)); }, delete: (x: any) => { writes.push(() => x.delete()); } });
    if (!isSave) { for (const w of writes) await w(); return out; }
    const mode = lose; lose = null;
    if (mode === 'answer') for (const w of writes) await w();
    throw new Error('Deadline exceeded');
  };
  db._store.set(OR('o14'), baseOrder());
  route = shippo(); calls = []; lose = 'answer';
  r = await call('o14', { action: 'purchase', rateId: 'ra', parcels: [{ weightOz: 20 }] });
  check('the save landed but its answer was lost: the label counts as bought, and nothing is voided', r.status === 200 && order('o14').shippoTransactionId === 'W-ra' && !calls.includes('POST /refunds/') && db._store.get(`tenants/${T}/transactions/postage-W-ra`)?.amount === 4.75, { r, calls });
  db._store.set(OR('o15'), baseOrder());
  calls = []; lose = 'write';
  r = await call('o15', { action: 'purchase', rateId: 'rc', parcels: [{ weightOz: 20 }] });
  check('the save never landed: the label is voided straight away and kept, with its refund followed', r.status === 409 && /voided straight away/.test(r.body.error) && !order('o15').shippoTransactionId && rec('W-rc')?.refunds?.['W-rc']?.status === 'requested' && rec('W-rc').refunds['W-rc'].refundId === 'rf-W-rc' && order('o15').labelBuying === null, { r, rec: rec('W-rc') });
  db.runTransaction = realTx;
  // The order changed while the label was being bought, and Shippo doesn't answer the void: the sheet says it's followed.
  db._store.set(OR('o16'), baseOrder());
  route = shippo((u, init) => {
    if (init?.method === 'POST' && u === '/transactions/') { db._store.set(OR('o16'), { ...order('o16'), shippingAddress: { ...addr, line1: '7 Moved Ln' } }); }
    if (init?.method === 'POST' && u === '/refunds/') return 'throw';
    return null;
  });
  r = await call('o16', { action: 'purchase', rateId: 'rd', parcels: [{ weightOz: 20 }] });
  check('…and when Shippo doesn’t answer that void, the sheet says so and the refund is asked again each morning', r.status === 409 && /asked again each morning/.test(r.body.error) && rec('W-rd')?.refunds?.['W-rd']?.status === 'requested' && rec('W-rd').refunds['W-rd'].refundId === null, { r, rec: rec('W-rd') });

  // ── One at a time: a void waits for someone buying or replacing the label ──
  db._store.set(OR('o17'), baseOrder({ shippoTransactionId: 'J1', trackingNumber: '9400J1000000000001', labelUrl: 'https://labels/J1.pdf', carrier: 'USPS', labelTxns: ['J1'], labelRecs: ['J1'], labelBuying: { at: new Date().toISOString(), by: 'Jo', token: 'other' } }));
  route = shippo(); calls = [];
  r = await call('o17', { action: 'void', reason: { kind: 'mistake' } });
  check('voiding while someone is buying or replacing the label: refused, nothing asked of Shippo, the label and their claim stay', r.status === 409 && r.body.busy === true && !calls.some((c) => c.startsWith('POST')) && order('o17').shippoTransactionId === 'J1' && order('o17').labelBuying?.token === 'other', { r, calls });
  // The address route loads its Shippo key on demand, past the stand-ins above: the platform key stands in for it.
  process.env.SHIPPO_API_KEY = 'k';
  const { POST: ADDRESS } = await import('../../src/app/api/retail/address/route');
  const addressCall = async (orderId: string, body: any) => (await ADDRESS({ json: async () => ({ tenantId: T, orderId, ...body }), nextUrl: { origin: 'https://app.example' } } as any)) as any;
  db._store.set(OR('o18'), baseOrder({ shippoTransactionId: 'H1', trackingNumber: '9400H1000000000001', labelUrl: 'https://labels/H1.pdf', carrier: 'USPS', labelTxns: ['H1'], labelRecs: ['H1'],
    addressRequest: { id: 'ar1', kind: 'change', status: 'waiting', to: { ...addr, line1: '99 New Rd' } }, labelBuying: { at: new Date().toISOString(), by: 'Jo', token: 'other' } }));
  calls = [];
  r = await addressCall('o18', { action: 'approve_change' });
  check('approving an address change while someone is replacing the label: it waits, nothing is voided, and it can be approved again', r.status === 409 && /working on this order’s label/.test(r.body.error) && !calls.some((c) => c.startsWith('POST')) && order('o18').addressRequest.status === 'waiting' && order('o18').shippoTransactionId === 'H1', { r, calls, o: order('o18') });
  db._store.set(OR('o18'), { ...order('o18'), labelBuying: null });
  r = await addressCall('o18', { action: 'approve_change' });
  check('…once they’re done, the approval voids the label under the same claim and lets the order go', r.status === 200 && calls.includes('POST /refunds/') && order('o18').shippoTransactionId === '' && order('o18').shippingAddress.line1 === '99 New Rd' && order('o18').labelBuying === null && order('o18').addressRequest.status === 'done', { r, o: order('o18') });

  // ── Voiding by hand, with a reason; seen cards ──
  db._store.set(OR('o7'), baseOrder({ shippoTransactionId: 'V1', trackingNumber: '9400V1000000000001', labelUrl: 'https://labels/V1.pdf', carrier: 'USPS', labelTxns: ['V1'], labelRecs: ['V1'] }));
  db._store.set(LR('V1'), { id: 'V1', orderId: 'o7', orderIds: ['o7'], boxes: [{ txn: 'V1' }], boxTxns: ['V1'], amountCents: 600, refunds: {} });
  r = await call('o7', { action: 'void', reason: { kind: 'mistake' } });
  const ev = [...db._store.entries()].filter(([k]) => k.startsWith(`${OR('o7')}/events/`)).map(([, v]) => v.meta?.text).join(' | ');
  check('voiding by hand with a reason: it’s on the record and the label comes off', r.status === 200 && order('o7').shippoTransactionId === '' && /voided by hand \(bought by mistake\)/.test(ev) && rec('V1').voidWhy === 'voided by hand (bought by mistake)' && /once Shippo confirms/.test(r.body.message), { r, ev });
  db._store.set(OR('o8'), baseOrder({ labelRefundDenied: { open: true, labelId: 'V1', txn: 'V1' }, labelCharge: { open: true, cents: 235, labelId: 'V1' } }));
  db._store.set(LR('V1'), { ...rec('V1'), orderIds: ['o8'], deniedOpen: true, chargeOpen: true });
  db._store.set(LR('V0'), { id: 'V0', orderId: 'o8', orderIds: ['o8'], deniedOpen: true, chargeOpen: true });
  await call('o8', { action: 'refund_seen' }); await call('o8', { action: 'charge_seen' });
  check('“Got it” clears the card on the order and on every label record of the order, not just the latest', order('o8').labelRefundDenied.open === false && order('o8').labelCharge.open === false && rec('V1').deniedOpen === false && rec('V1').chargeOpen === false
    && rec('V0').deniedOpen === false && rec('V0').chargeOpen === false && order('o8').labelRefundDenied.seenBy === 'Maya Lin');

  globalThis.fetch = realFetch;
  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
