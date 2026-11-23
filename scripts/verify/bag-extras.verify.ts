// Checks the extras ticked into the bag before an order goes (design board "The extras in the bag, and what got caught",
// A: made from each order; lib/bag-extras, lib/food-bags-server tickExtra and bagsWaiting, api/counter and api/curbside
// 'extra', api/menu laneSettings bagGroups / bagExtras, components/menu/BagExtrasSettings, the bag scan sheet):
// - the list for an order: the guest's picks from the choices the business named (counted), and the business's own
//   extras it picked (per order, per item in some sections), for orders to go only; nothing for here
// - none with the scan off, or once a manager let it go; the first bag's label lists them to read
// - the handover waits for them as for a bag, saying what to put in; each is ticked in (or out after a wrong tap),
//   only one that's on the order; once all are in, it's handed over; a manager's PIN (an extra ran out) lets it go
// - curbside the same; the Menu page sets them, managers only, and only extras the business has
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/bag-extras.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
const audits: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (f: any) => { void Promise.resolve().then(f); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async (_r: any, _t: any, role: string) => (role === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Managers only.' } } } : { actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_db: any, _t: any, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test', searchParams: new URLSearchParams() } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const day = new Date().toISOString().slice(0, 10);
const nowS = () => new Date().toISOString();

(async () => {
  const X = await import('../../src/lib/bag-extras');
  const F = await import('../../src/lib/food-bags');
  const FS = await import('../../src/lib/food-bags-server');

  console.log('the list for an order');
  const plate = [
    { id: 'x1', itemId: 'nap', name: 'Napkins', amount: 4, measure: 'each', per: 'order', when: 'togo' },
    { id: 'x2', itemId: 'straw', name: 'Straws', amount: 1, measure: 'each', per: 'item', when: 'any', sections: ['Cold drinks'] },
    { id: 'x3', itemId: 'bread', name: 'Bread', amount: 1, measure: 'each', per: 'guest', when: 'here' },
    { id: 'x4', itemId: 'box', name: 'Box', amount: 1, measure: 'each', per: 'item', when: 'here' },
    { id: 'x5', itemId: 'fork', name: 'Forks', amount: 0.5, measure: 'each', per: 'order', when: 'any' },
  ];
  const tn: any = { foodCost: { extras: plate }, bagCheck: { groups: ['dips', 'Dips', ' '], extras: ['x1', 'x2', 'x3', 'x4', 'x5', 'nope'] } };
  const lines = [
    { lineId: 'a', name: 'Chicken tenders', quantity: 2, section: 'Mains', choices: [{ groupId: 'd', group: 'Dips', optionId: 'r', option: 'Ranch', price: 0 }, { groupId: 'd', group: 'Dips', optionId: 'b', option: 'BBQ', price: 0 }, { groupId: 's', group: 'Size', optionId: 'l', option: 'Large', price: 1 }] },
    { lineId: 'b', name: 'Iced tea', quantity: 2, section: 'cold drinks', choices: [] },
    { lineId: 'c', name: 'Fries', quantity: 1, section: 'Sides', choices: [{ groupId: 'd2', group: 'DIPS', optionId: 'r', option: 'Ranch', price: 0 }] },
    { lineId: 'g', name: 'Gift card', quantity: 1, giftCard: { to: null } },
  ];
  const togo = { channel: 'drive-thru', status: 'sent', lines };
  const set = X.bagExtrasSetOf(tn);
  check('what the business ticks in, as kept: each choice once whatever its case, and only its own extras (never one for a table’s guests)', set.groups.join() === 'dips' && set.extras.join() === 'x1,x2,x4,x5', set);
  const list = X.extrasFor(togo, tn);
  const base = (k: string) => k.replace(/_\d+$/, '');
  const by = Object.fromEntries(list.map((x) => [base(x.k), X.extraLabel(x)]));
  check('the guest’s picks, counted across the order (2 tenders with ranch, and fries with ranch: 3 Ranch); other choices not', by['c:ranch'] === '3 Ranch' && by['c:bbq'] === '2 BBQ' && !Object.values(by).some((v) => /Large/.test(String(v))), by);
  check('…the business’s extras: per order (4 Napkins), per item in its sections whatever the case (a straw for each of 2 teas), and half of one reads as its name', by['x:x1'] === '4 Napkins' && by['x:x2'] === '2 Straws' && by['x:x5'] === 'Forks' && !by['x:x4'] && !by['x:x3'], by);
  const oz = { foodCost: { extras: [{ id: 'cup', itemId: 'cup', name: 'Sauce cups', amount: 1.5, measure: 'oz', per: 'item', when: 'any', sections: ['Mains'] }, { id: 'Cup', itemId: 'lid', name: 'Lids', amount: 2, measure: 'ea', per: 'order', when: 'any' }] }, bagCheck: { groups: ['Dips'], extras: ['cup', 'Cup'] } };
  const ozBy = Object.fromEntries(X.extrasFor(togo, oz).map((x) => [x.name, X.extraLabel(x)]));
  check('an extra measured in oz counts one for each (2 tenders: 2 Sauce cups, not 3); in each, its amount (2 Lids)', ozBy['Sauce cups'] === '2 Sauce cups' && ozBy['Lids'] === '2 Lids', ozBy);
  check('…ids that differ only in case stay two, and names only in case are one', new Set(X.extrasFor(togo, oz).filter((x) => x.k.startsWith('x:')).map((x) => base(x.k))).size === 2 && X.extrasFor(togo, oz).filter((x) => base(x.k).startsWith('c:ranch')).length === 1);
  check('…names that read alike in plain letters stay two', X.extrasFor({ channel: 'drive-thru', lines: [{ quantity: 1, choices: [{ group: 'Dips', option: 'Salsa' }, { group: 'Dips', option: 'Salsa!' }, { group: 'Dips', option: 'Сальса' }, { group: 'Dips', option: 'Соус' }] }] }, oz).filter((x) => x.k.startsWith('c:')).length === 4);
  check('…nothing for here, nothing when it ticks nothing in', X.extrasFor({ channel: 'counter', lines }, tn).length === 0 && X.extrasFor({ ...togo }, { foodCost: { extras: plate } }).length === 0 && X.extrasFor({ channel: 'counter', toGo: true, lines }, tn).length === 5);
  check('…each keyed by what it is and how many', list.map((x) => x.k).join() === 'c:ranch_3000,c:bbq_2000,x:x1_4000,x:x2_2000,x:x5_500', list.map((x) => x.k));
  const ticked = { ...togo, extrasIn: ['c:ranch_3000', 'x:x1_4000', 'bad key', 'c:ranch_3000'] };
  const toTick = X.extrasToTick(ticked, tn);
  check('to tick before it goes: each with whether it’s in', toTick.length === 5 && toTick.filter((x) => x.done).map((x) => base(x.k)).join() === 'c:ranch,x:x1' && X.extrasLeft(ticked, tn).length === 3);
  const more = { ...ticked, lines: [{ ...lines[0], quantity: 3 }, ...lines.slice(1)] };
  check('…one ticked for 3 Ranch, then a fourth: it’s to go in again', X.extrasToTick(more, tn).find((x) => base(x.k) === 'c:ranch')?.done === false && X.extrasToTick(more, tn).find((x) => base(x.k) === 'x:x1')?.done === true);
  check('…none with the scan off, or once a manager let it go', X.extrasToTick(togo, { ...tn, bagCheck: { ...tn.bagCheck, off: true } }).length === 0 && X.extrasToTick({ ...togo, bags: { skipped: { by: 'Ana' } } }, tn).length === 0);
  check('words: "1 BBQ and napkins", "4 extras"', X.extrasWords([{ name: '1 BBQ' }, { name: 'Napkins' }]) === '1 BBQ and Napkins' && X.extrasWords([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }]) === '4 extras' && X.extrasWords([{ name: 'a' }, { name: 'b' }, { name: 'c' }]) === 'a, b and c');
  const lab1 = F.labelOf(togo, 1, 2, null, 'Juniper', X.extrasLine(togo, tn)); const lab2 = F.labelOf(togo, 2, 2, null, 'Juniper', X.extrasLine(togo, tn));
  check('the first bag’s label lists them to read; the others don’t', lab1.extras === '3 Ranch, 2 BBQ, 4 Napkins, 2 Straws, Forks' && !lab2.extras && F.labelDoc(lab1).blocks.some((b: any) => b.k === 'text' && b.text === 'Add: 3 Ranch, 2 BBQ, 4 Napkins, 2 Straws, Forks' && b.bold) && !F.labelDoc(lab2).blocks.some((b: any) => /^Add:/.test(String(b.text || ''))), lab1.extras);
  const w = FS.bagsWaiting([{ id: 'o1', data: { ...togo, number: 'D7' } }], tn);
  check('what’s left before it goes counts them, and says to put them in', w.length === 1 && w[0].extras?.length === 5 && FS.waitingWords(w) === 'For D7, put in 5 extras first.' && FS.waitingWords(FS.bagsWaiting([{ id: 'o1', data: { ...togo, number: 'D7', extrasIn: ['c:ranch_3000', 'c:bbq_2000', 'x:x1_4000'] } }], tn)) === 'For D7, put in 2 Straws and Forks first.', FS.waitingWords(w));
  const both = FS.bagsWaiting([{ id: 'o1', data: { ...togo, number: 'D7', extrasIn: ['c:ranch_3000', 'c:bbq_2000', 'x:x1_4000', 'x:x2_2000'], bags: { count: 2, printedAt: nowS(), coded: true, scanned: [1] } } }], tn);
  check('…with a bag too: "scan bag 2, and put in Forks"', FS.waitingWords(both) === 'For D7, scan bag 2, and put in Forks first.', FS.waitingWords(both));
  check('…a bag alone still reads as before', FS.waitingWords(FS.bagsWaiting([{ id: 'o1', data: { channel: 'drive-thru', status: 'sent', number: 'D7', lines, bags: { count: 2, printedAt: nowS(), coded: true, scanned: [1] } } }], {})) === 'Scan bag 2 of D7 first.');

  console.log('at the window');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, orderAhead: { on: true, curbside: true }, ownerId: 'own1', foodCost: { extras: plate } });
  await db.doc(`${T}/staff/s1`).set({ name: 'Kai Park', role: 'staff' });
  await db.doc(`${T}/staff/m9`).set({ name: 'Ana Ruiz', role: 'manager', pin: '4821' });
  await db.doc(`${T}/inventory/tenders`).set({ type: 'refreshment', name: 'Chicken tenders', category: 'Mains', price: 8, totalStock: 80,
    choices: [{ id: 'dips', name: 'Dips', pick: 'any', max: 3, options: [{ id: 'ranch', name: 'Ranch', price: 0 }, { id: 'bbq', name: 'BBQ', price: 0 }] }] });
  await db.doc(`${T}/inventory/tea`).set({ type: 'refreshment', name: 'Iced tea', category: 'Cold drinks', price: 3, totalStock: 80 });
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: curbApi } = await import('../../src/app/api/curbside/route');
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Lane', kind: 'drive-thru' }))).body.key;
  const L = (b: any) => LANE(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const C = (b: any) => curbApi(req({ tenantId: 't1', ...b })) as Promise<any>;
  const MN = (b: any) => menuApi(req({ tenantId: 't1', ...b })) as Promise<any>;

  let r = await MN({ action: 'laneSettings', bagGroups: ['Dips'] });
  check('only a manager sets what’s ticked in', r.status === 403 || r.body?.ok === false, r.body);
  actor = { uid: 'm9', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await MN({ action: 'laneSettings', bagExtras: ['x1', 'x3'] });
  check('…only extras the business has for an order to go (not a table’s bread)', r.status === 409 && /isn’t set anymore/.test(r.body.error), r.body);
  r = await MN({ action: 'laneSettings', bagGroups: 'Dips' });
  check('…choices as a list', r.status === 400);
  r = await MN({ action: 'laneSettings', bagGroups: ['Dips', 'dips'], bagExtras: ['x1', 'x2'] });
  check('…saved: the choices once each, and the extras', r.body.ok && r.body.lane.bagExtras.groups.join() === 'Dips' && r.body.lane.bagExtras.extras.join() === 'x1,x2' && (await get(T)).bagCheck.extras.join() === 'x1,x2', r.body);
  r = await MN({ action: 'list' });
  check('the Menu page gets them, with the extras to pick from in words', r.body.ok && r.body.lane.bagExtras.groups.join() === 'Dips' && r.body.lane.bagExtras.plate.map((p: any) => p.id).join() === 'x1,x2,x5' && /for each order to go/.test(r.body.lane.bagExtras.plate[0].words), r.body.lane?.bagExtras);
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  r = await MN({ action: 'list' });
  check('…not for the rest of the team', r.body.ok && r.body.lane.bagExtras === null);

  const carWith = async (k: string) => {
    const c = (await L({ action: 'car', carKey: k })).body;
    await L({ action: 'add', orderId: c.orderId, itemId: 'tenders', quantity: 2, choices: { dips: ['ranch', 'bbq'] }, tapKey: `${k}-a` });
    await L({ action: 'add', orderId: c.orderId, itemId: 'tea', quantity: 1, tapKey: `${k}-b` });
    await L({ action: 'name', orderId: c.orderId, name: 'Maria Lopez' });
    await L({ action: 'send', orderId: c.orderId });
    await L({ action: 'paid', orderId: c.orderId, method: 'cash', tendered: 100 });
    return c;
  };
  const c1 = await carWith('car-1');
  const o1: any = await get(`${T}/counterOrders/${c1.orderId}`);
  check('each line keeps its menu section', o1.lines.map((l: any) => l.section).join() === 'Mains,Cold drinks', o1.lines);
  r = await L({ action: 'move', carId: c1.carId, to: 'gone' });
  const ex = r.body.bags?.[0]?.extras || [];
  check('handing over waits for the extras, saying what to put in', r.status === 409 && r.body.code === 'bags' && ex.map((x: any) => x.name).join() === '2 Ranch,2 BBQ,4 Napkins,Straws' && /put in 4 extras first\.$/.test(r.body.error) && (await get(`${T}/counterOrders/${c1.orderId}`)).status === 'sent', r.body);
  r = await L({ action: 'extra', carId: c1.carId, orderId: c1.orderId, k: 'not a key' });
  check('…ticking something that isn’t one says so', r.status === 400);
  r = await L({ action: 'extra', carId: c1.carId, orderId: c1.orderId, k: 'c:mustard_1000' });
  check('…nor one that isn’t on this order', r.status === 409 && /isn’t on this order/.test(r.body.error));
  const c2 = await carWith('car-2');
  r = await L({ action: 'extra', carId: c1.carId, orderId: c2.orderId, k: 'c:ranch_2000' });
  check('…nor another car’s order', r.status === 400);
  for (const x of ex) r = await L({ action: 'extra', carId: c1.carId, orderId: c1.orderId, k: x.k });
  check('each ticked in, kept on the order, nothing left', r.body.ok && r.body.extrasLeft.length === 0 && (await get(`${T}/counterOrders/${c1.orderId}`)).extrasIn.length === 4, r.body);
  r = await L({ action: 'extra', carId: c1.carId, orderId: c1.orderId, k: 'x:x1_4000', on: false });
  check('…a wrong tap taken out again: it’s left', r.body.ok && r.body.extrasLeft.join() === 'x:x1_4000' && !(await get(`${T}/counterOrders/${c1.orderId}`)).extrasIn.includes('x:x1_4000'), r.body);
  r = await L({ action: 'move', carId: c1.carId, to: 'gone' });
  check('…so it still waits, for the napkins only', r.status === 409 && /put in 4 Napkins first/.test(r.body.error), r.body);
  await L({ action: 'extra', carId: c1.carId, orderId: c1.orderId, k: 'x:x1_4000' });
  r = await L({ action: 'move', carId: c1.carId, to: 'gone' });
  check('…all in: handed over', r.body.ok && (await get(`${T}/counterOrders/${c1.orderId}`)).status === 'done', r.body);
  r = await L({ action: 'move', carId: c2.carId, to: 'gone', bagOverride: true, pin: '4821', bagReason: 'ran_out' });
  const o2: any = await get(`${T}/counterOrders/${c2.orderId}`);
  check('an extra ran out: a manager’s PIN lets it go, with why, on the order', r.body.ok && o2.status === 'done' && o2.bags?.skipped?.by === 'Ana Ruiz' && o2.bags.skipped.reason === 'An extra ran out', { body: r.body, bags: o2.bags });
  await db.doc(T).set({ bagCheck: { off: true } }, { merge: true });
  const c3 = await carWith('car-3');
  r = await L({ action: 'bags', carId: c3.carId, orderId: c3.orderId, count: 2, here: true });
  check('the scan off: the first bag’s label still lists them, to read', r.body.ok && r.body.labels[0].extras === '2 Ranch, 2 BBQ, 4 Napkins, Straws' && !r.body.labels[1].extras, r.body.labels?.map((l: any) => l.extras));
  r = await L({ action: 'move', carId: c3.carId, to: 'gone' });
  check('…and nothing waits for them', r.body.ok, r.body);
  await db.doc(T).set({ bagCheck: { off: false } }, { merge: true });

  console.log('curbside');
  const id = 'ahead1';
  await db.doc(`${T}/counterOrders/${id}`).set({ id, number: 'A1', channel: 'ahead', status: 'sent', day, guestName: 'Jordan Lee', paidAt: nowS(), payMethod: 'card', sentAt: nowS(),
    lines: [{ lineId: 'l1', itemId: 'tea', name: 'Iced tea', quantity: 2, unitPrice: 3, section: 'Cold drinks', choices: [] }], subtotal: 6, tax: 0, total: 6, ahead: { way: 'curbside', state: 'paid', hereAt: nowS() } });
  r = await C({ action: 'handed', orderId: id });
  check('a curbside order waits for its extras too', r.status === 409 && r.body.code === 'bags' && r.body.bags[0].extras.map((x: any) => x.name).join() === '4 Napkins,2 Straws', r.body);
  await C({ action: 'extra', orderId: id, k: 'x:x1_4000' }); r = await C({ action: 'extra', orderId: id, k: 'x:x2_2000' });
  check('…ticked in from its screen', r.body.ok && r.body.extrasLeft.length === 0, r.body);
  r = await C({ action: 'handed', orderId: id });
  check('…then handed over', r.body.ok && (await get(`${T}/counterOrders/${id}`)).status === 'done', r.body);
  r = await C({ action: 'extra', orderId: id, k: 'x:x1_4000' });
  check('…a tick after it’s gone says so', r.status === 409 && /already handed over/.test(r.body.error), r.body);
  const id2 = 'ahead2';
  await db.doc(`${T}/counterOrders/${id2}`).set({ id: id2, number: 'A2', channel: 'ahead', status: 'sent', day, guestName: 'Sam Ito', paidAt: nowS(), payMethod: 'card', sentAt: nowS(),
    lines: [{ lineId: 'l1', itemId: 'tea', name: 'Iced tea', quantity: 2, unitPrice: 3, section: 'Cold drinks', choices: [] }], subtotal: 6, tax: 0, total: 6, ahead: { way: 'curbside', state: 'paid', hereAt: nowS() } });
  await C({ action: 'extra', orderId: id2, k: 'x:x2_2000' });
  await db.doc(`${T}/counterOrders/${id2}`).set({ lines: [{ lineId: 'l1', itemId: 'tea', name: 'Iced tea', quantity: 3, unitPrice: 3, section: 'Cold drinks', choices: [] }] }, { merge: true });
  r = await C({ action: 'extra', orderId: id2, k: 'x:x2_2000' });
  check('a count that changed since the screen opened says so (not that it’s gone)', r.status === 409 && /changed since this opened/.test(r.body.error), r.body);
  r = await C({ action: 'extra', orderId: id2, k: 'x:x1_4000' });
  check('…and the tick for the old count doesn’t linger on the order', r.body.ok && (await get(`${T}/counterOrders/${id2}`)).extrasIn.join() === 'x:x1_4000' && r.body.extrasLeft.join() === 'x:x2_3000', { body: r.body, o: (await get(`${T}/counterOrders/${id2}`)).extrasIn });

  console.log('the screens');
  const sheets = src('src/components/drive-thru/BagSheets.tsx'), menu = src('src/app/(app)/menu/page.tsx'), card = src('src/components/menu/BagExtrasSettings.tsx');
  check('the bag sheet: each extra a button to tap in (pressed when in), counted with the scan, and handed over once everything’s in', /aria-pressed=\{done\} disabled=\{!tick \|\| busy\} onClick=\{\(\) => void tap\(w\.orderId, x\.k, x\.name\)\}/.test(sheets) && /if \(on && allDone\(left, itemsLeft, next\)\)/.test(sheets) && /if \(allDone\(next, nextItems, extrasLeft\)\)/.test(sheets)
    && /Into the bag, tap each/.test(sheets) && /min-h-\[44px\]/.test(sheets));
  check('…with only extras to tick, no camera, and "An extra ran out" offered as why', /\{anyScan && <div className="overflow-hidden rounded-2xl"><ScanGate/.test(sheets) && /SKIP_REASONS\.filter\(\(r\) => anyExtras \|\| r\.id !== 'ran_out'\)/.test(sheets));
  check('…the counter, the window and curbside tap them in through their own screens', [src('src/app/(app)/counter/page.tsx'), src('src/app/drive-thru/[tenantId]/page.tsx'), src('src/components/orders/CurbsideScreen.tsx')].every((s) => /action: 'extra'/.test(s) && /tick=\{extraIn\}/.test(s)));
  check('…a label printed on this device lists them', /Add: \$\{esc\(l\.extras\)\}/.test(sheets));
  check('the Menu page: the menu’s choices and the business’s extras to pick, under the scan switch', /<BagExtrasSettings key=/.test(menu) && /menuGroups=\{menuGroups\}/.test(menu) && /action: 'laneSettings', \.\.\.body/.test(card) && /href="\/food-cost"/.test(card) && /aria-pressed=\{on\}/.test(card));
  for (const f of ['src/lib/bag-extras.ts', 'src/components/menu/BagExtrasSettings.tsx', 'src/components/drive-thru/BagSheets.tsx']) check(`${f}: no comments in markup, no uppercase, no " · "`, !/\{\/\*/.test(src(f)) && !/\buppercase\b/.test(src(f)) && !/ · /.test(src(f)));
  void audits; void all;

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
