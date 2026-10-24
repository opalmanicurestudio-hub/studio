// Checks Phase B, round 2: one list of order steps (lib/retail-orders ORDER_EVENT_TYPES, each described once in
// lib/order-events), stages as they really move, and a step that can arrive twice recorded once.
//   - every event the code writes is a kind on the list, and every kind has its words; older names read as the one
//     they mean now; the staff timeline and the order history read the same words;
//   - the two stages nothing ever reached ("handed off", "refunded") are gone, and the stage rules allow exactly the
//     moves the order steps make;
//   - a customer's check-in: two taps are one arrival; a check-in as the order is handed over never puts it back;
//   - a browser can add only the team's notes and the few things done there to an order's history.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-events.verify.ts
import Module from 'module';
import fs from 'fs';
import path from 'path';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { void Promise.resolve().then(fn); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const src = (p: string) => fs.readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => null } }) as any;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...filesUnder(p)); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); }
  return out;
}

(async () => {
  const RO = await import('../../src/lib/retail-orders');
  const OE = await import('../../src/lib/order-events');

  // ── One list ──
  const listed = new Set<string>(RO.ORDER_EVENT_TYPES as readonly string[]);
  const written = new Map<string, string>();
  for (const f of filesUnder('src')) {
    const t = src(f);
    for (const m of t.matchAll(/\b(?:buildEvent|evPayload|evPayloadRaw)\(\s*'([a-z_]+)'/g)) written.set(m[1], f);
    // Events written by hand: a `type:` beside an events document.
    for (const m of t.matchAll(/collection\((?:[^)]*,\s*)?'events'\)[^;]{0,200}?type: (?:hold \? )?'([a-z_]+)'/g)) written.set(m[1], f);
    for (const m of t.matchAll(/(?:ev|evRef|fEv)\.id, type: '([a-z_]+)'/g)) written.set(m[1], f);
    if (/type === 'auto' \? 'batch_auto_released' : 'batch_released'/.test(t)) { written.set('batch_auto_released', f); written.set('batch_released', f); }
    if (/type: hold \? 'held_for_review' : 'hold_released'/.test(t)) { written.set('held_for_review', f); written.set('hold_released', f); }
  }
  const strays = [...written.entries()].filter(([k]) => !listed.has(k));
  check('every kind of step the code writes on an order is on the one list', strays.length === 0 && written.size >= 25, strays);
  const undescribed = [...listed].filter((k) => !(OE.EVENT_INFO as any)[k]);
  check('…and every kind on the list has its words (a new one without them doesn’t compile)', undescribed.length === 0, undescribed);
  const unused = [...listed].filter((k) => !written.has(k) && k !== 'note');
  check('…and nothing on the list is never written', unused.length === 0, unused);
  check('older names read as the one they mean now (a customer’s cancel was “order_cancelled”)', OE.eventWords({ type: 'order_cancelled', actorName: 'Dana W', meta: { reason: 'Changed my mind' } }).text === 'Canceled: Changed my mind · Dana W' && OE.eventTypeOf('ready') === 'marked_ready');
  check('the customer’s cancel is written as the same “cancelled” the shop’s is', !/type: 'order_cancelled'/.test(src('src/app/api/retail/self-serve/route.ts')) && /type: 'cancelled'/.test(src('src/app/api/retail/self-serve/route.ts')));
  check('the staff timeline and the order history read the same words', /export const eventLine = eventWords;/.test(src('src/lib/orders-view.ts')) && /eventWords\(\{ \.\.\.ev, actorName: '' \}\)\.text/.test(src('src/app/(app)/retail-orders/history/page.tsx')) && !/EVENT_LABELS/.test(src('src/app/(app)/retail-orders/history/page.tsx')));
  check('only real steps are marked for the customer, never the team’s notes, holds or wrong scans', OE.customerSees({ type: 'marked_ready' }) && OE.customerSees({ type: 'item_scanned' }) && !OE.customerSees({ type: 'note' }) && !OE.customerSees({ type: 'scan_mismatch' }) && !OE.customerSees({ type: 'held_for_review' }) && !OE.customerSees({ type: 'override' }));
  check('a step that can arrive twice has one id for its key', OE.eventIdFor('customer_arrived', 'at_ready') === OE.eventIdFor('customer_arrived', 'at_ready') && OE.eventIdFor('note', 'a/b c') === 'note-a_b_c');

  // ── Stages as they really move ──
  check('the two stages nothing ever reached are gone', !(RO.ORDER_STAGES as readonly string[]).includes('handed_off') && !(RO.ORDER_STAGES as readonly string[]).includes('refunded'));
  const leftover = filesUnder('src').filter((f) => /'handed_off'/.test(src(f).replace(/accountingStatus[^\n]*/g, '').replace(/batch\.update\([^\n]*/g, '')) && !/inventory-exceptions|exceptions\/page|loss-recovery/.test(f));
  check('…and no screen or route still looks for “handed off”', leftover.length === 0, leftover);
  const o = (stage: string, method = 'counter', x: any = {}) => ({ stage, method, lines: [{ lineId: 'A', qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, status: 'picked' }], ...x }) as any;
  const can = (from: string, to: string, method = 'counter') => RO.canAdvance(o(from, method), to as any).ok;
  check('the stage rules allow the moves the order steps make', can('paid', 'picking') && can('picking', 'paid') && can('picking', 'packed') && can('packed', 'ready') && can('ready', 'arrived', 'curbside') && can('ready', 'completed') && can('arrived', 'completed', 'curbside') && can('packed', 'shipped', 'ship') && can('shipped', 'completed', 'ship') && RO.canAdvance(o('placed', 'ship', { lines: [{ lineId: 'D', digital: true, qtyOrdered: 1, qtyScanned: 0, qtyShorted: 0 }] }), 'completed').ok);
  check('…and refuse the ones they don’t: a ship order isn’t handed over, a finished order doesn’t move, nothing skips packing', !can('ready', 'completed', 'ship') && !can('completed', 'cancelled') && !can('cancelled', 'paid') && !can('paid', 'ready') && !can('picking', 'completed') && !can('ready', 'arrived') && !can('packed', 'arrived', 'curbside') && !can('placed', 'completed') && !can('placed', 'completed', 'curbside'));

  // ── A customer's check-in ──
  const { POST: ARRIVE } = await import('../../src/app/api/retail/arrive/route');
  db = strictTransactions(makeDb());
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', stage: 'ready', method: 'curbside', qrToken: 'o1.tok', customerName: 'Dana W', lines: [] });
  const [a1, a2] = await Promise.all([ARRIVE(req({ tenantId: 't1', orderId: 'o1', qrToken: 'o1.tok', spotOrVehicle: 'Spot 3' })), ARRIVE(req({ tenantId: 't1', orderId: 'o1', qrToken: 'o1.tok', spotOrVehicle: 'Spot 3' }))]) as any[];
  const arrivals = (await all(`${T}/retailOrders/o1/events`)).filter((e: any) => e.type === 'customer_arrived');
  check('two taps of “I’m here” are one arrival on the order’s history', (a1.status === 200 || a2.status === 200) && (await get(`${T}/retailOrders/o1`)).stage === 'arrived' && arrivals.length === 1, { a1: a1.body, a2: a2.body, arrivals: arrivals.length });
  await db.doc(`${T}/retailOrders/o2`).set({ id: 'o2', stage: 'completed', method: 'curbside', qrToken: 'o2.tok', customerName: 'Dana W', lines: [] });
  const late: any = await ARRIVE(req({ tenantId: 't1', orderId: 'o2', qrToken: 'o2.tok' }));
  check('a check-in after it was handed over never puts it back to arrived', late.status === 409 && (await get(`${T}/retailOrders/o2`)).stage === 'completed', late.body);
  await db.doc(`${T}/retailOrders/o3`).set({ id: 'o3', stage: 'packed', method: 'curbside', qrToken: 'o3.tok', customerName: 'Dana W', lines: [] });
  const early: any = await ARRIVE(req({ tenantId: 't1', orderId: 'o3', qrToken: 'o3.tok' }));
  check('…and one before it’s ready records that they’re here without moving it', early.body.early === true && (await get(`${T}/retailOrders/o3`)).stage === 'packed' && !!(await get(`${T}/retailOrders/o3`)).curbside?.arrivedAt, early.body);

  const onWayDone: any = await ARRIVE(req({ tenantId: 't1', orderId: 'o2', qrToken: 'o2.tok', onWay: true }));
  check('“On my way” on an order already handed over changes nothing', onWayDone.status === 409 && !(await get(`${T}/retailOrders/o2`)).curbside?.onWayAt, onWayDone.body);
  const { POST: DOOR } = await import('../../src/app/api/front-door/route').catch(() => ({ POST: null as any }));
  check('the front-door kiosk can’t move an order to “here” before it’s ready (the stage rules no longer allow packed → arrived)', !RO.canAdvance(o('packed', 'curbside'), 'arrived').ok && !!DOOR);
  check('a store-credit or gift-card payment is the same “paid” step the customer sees, and the team still reads how it was paid', !/type: 'paid'/.test(src('src/lib/order-paid.ts')) && OE.eventTypeOf('paid') === 'payment_confirmed' && OE.eventWords({ type: 'payment_confirmed', meta: { text: 'Paid in full with store credit' } }).text === 'Paid in full with store credit');
  check('the claim pack keeps the payment step under its one name', /'payment_confirmed', 'batch_claimed'/.test(src('src/app/print/claim-pack/[tenantId]/[excId]/page.tsx')) && /eventTypeOf\(x\.type\)/.test(src('src/app/print/claim-pack/[tenantId]/[excId]/page.tsx')));

  // ── The history from a browser ──
  const rules = src('firestore.rules');
  check('a browser adds only the team’s notes and the few things done there to an order’s history, each with its time',
    /match \/events\/\{eventId\} \{[^}]*allow create: if isTeam\(tenantId\)[^}]*'at', ''\) != ''[^}]*\['note', 'held_for_review', 'hold_released', 'return_opened', 'label_scan_verified'\][^}]*'refund_issued' && isManager\(tenantId\)/.test(rules));
  check('the words: US spelling for a canceled order, no mention of the tool', /Canceled/.test(src('src/lib/order-events.ts')) && !/claude|anthropic/i.test(src('src/lib/order-events.ts')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
