// Checks café and bar basics, round 1 (L20): lib/table-service, api/tab, the kitchen screen's stations and expo, the
// menu's table service settings, and comps carried to checkout.
// - Courses come from an item's own setting, else its menu section (and that section's other names), else right away.
//   A held course waits as "not fired" until the server fires it; firing sends exactly that course.
// - Each item is made at one station: its own, else the bar for a drink, else the first station.
// - A comp within the server's allowance tonight needs no PIN; over it, a manager's approval (never their own), used once.
//   A manager comps on their own say. An item is comped once. Every comp is kept where no browser can write.
// - A void before the kitchen starts needs a reason; after, a manager's approval, and its cost counts as waste. The
//   station is told to stop unless asked not to. A remake keeps the line once, makes a fresh ticket, logs the waste.
// - Checkout charges less for a comp only when its record checks out.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/table-service.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const server: any = { uid: 's1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
const boss: any = { uid: 'm1', name: 'Dana Fox', role: 'manager', isManager: true, caps: [] };
let actor: any = server;
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer test' }, nextUrl: { origin: 'https://x.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const soon = () => new Date(Date.now() + 5 * 60000).toISOString();

(async () => {
  const S = await import('../../src/lib/table-service');
  console.log('courses and stations');
  const C = S.coursesOf({});
  check('four courses by default, mains and dessert held', C.map((c) => `${c.n}${c.name}${c.hold ? '*' : ''}`).join(',') === '1Drinks,2Starters,3Mains*,4Dessert*', C);
  const own = S.coursesOf({ kitchenSettings: { courses: [{ name: 'Snacks' }, { name: 'Plates', hold: true }, { name: 'snacks' }, { name: '' }] } });
  check('a business’s own courses, numbered in order, without repeats or blanks', own.length === 2 && own[0].n === 1 && own[1].name === 'Plates' && own[1].hold, own);
  const c = (item: any) => S.courseOfItem(item, C)?.name || null;
  check('a course from the menu section, or one of its other names', c({ category: 'Mains' }) === 'Mains' && c({ category: 'Entrées' }) === 'Mains' && c({ category: 'Appetizers' }) === 'Starters' && c({ category: 'Coffee' }) === 'Drinks' && c({ category: 'Desserts' }) === 'Dessert');
  check('…a section that isn’t a course goes right away', c({ category: 'Sandwiches' }) === null && c({}) === null);
  check('…the item’s own course wins, and 0 means always right away', c({ category: 'Mains', course: 4 }) === 'Dessert' && c({ category: 'Mains', course: 0 }) === null);
  const st = S.stationsOf({ kitchenSettings: { stations: ['Kitchen', 'Grill', 'Bar', 'grill'] } });
  check('stations: the business’s own, no repeats', st.join(',') === 'Kitchen,Grill,Bar', st);
  check('a drink goes to the bar, its own station wins, anything else to the first', S.stationOfItem({ category: 'Cocktails' }, st) === 'Bar' && S.stationOfItem({ category: 'Mains', station: 'grill' }, st) === 'Grill' && S.stationOfItem({ category: 'Mains' }, st) === 'Kitchen' && S.stationOfItem({ category: 'Coffee' }, ['Kitchen']) === 'Kitchen');
  check('allowance $10 by default, capped at $500', S.compAllowanceCents({}) === 1000 && S.compAllowanceCents({ kitchenSettings: { compAllowanceCents: 999999 } }) === 50000 && S.compAllowanceCents({ kitchenSettings: { compAllowanceCents: 0 } }) === 0);
  console.log('who needs a manager');
  const n = S.needsManager;
  check('a comp within the allowance: no PIN; past it: a PIN; a manager never', !n({ kind: 'comp', actorIsManager: false, amountCents: 600, usedTonightCents: 400, allowanceCents: 1000 }).pin
    && n({ kind: 'comp', actorIsManager: false, amountCents: 601, usedTonightCents: 400, allowanceCents: 1000 }).pin && !n({ kind: 'comp', actorIsManager: true, amountCents: 99999, allowanceCents: 0 }).pin);
  check('a void: a PIN only once the kitchen started; a remake never', !n({ kind: 'void', actorIsManager: false, started: false }).pin && n({ kind: 'void', actorIsManager: false, started: true }).pin && !n({ kind: 'remake', actorIsManager: false }).pin);
  check('a course’s stage from its tickets', S.courseStage([{ kdsId: 'a', firedAt: null }], { a: 'unfired' }) === 'unfired' && S.courseStage([{ kdsId: 'a' }, { kdsId: 'b' }], { a: 'ready', b: 'in_progress' }) === 'cooking'
    && S.courseStage([{ kdsId: 'a' }, { kdsId: 'b' }], { a: 'ready', b: 'delivered' }) === 'ready' && S.courseStage([{ kdsId: 'a' }, { kdsId: 'b' }], { a: 'delivered', b: 'cancelled' }) === 'served');
  console.log('expo');
  const tk = (id: string, status: string, o: any = {}) => ({ id, col: 'kdsTickets', status, source: 'tab', item: id, quantity: 1, at: '2026-11-14T20:00:00Z', name: 'Okafor', visitId: 'v1', course: 3, courseName: 'Mains', tableNumber: '12', ...o });
  const g = S.expoGroups([tk('a', 'ready'), tk('b', 'in_progress'), tk('c', 'ready', { visitId: 'v2', tableNumber: 'Patio 2' }), tk('d', 'ready', { course: 2, courseName: 'Starters' }), tk('e', 'unfired'), tk('f', 'cancelled')] as any);
  check('a table’s course is one run; another course or table its own; ready runs first', g.length === 3 && g[0].allReady && g.find((x) => x.label === 'Table 12' && x.sub === 'Mains')?.total === 2 && g.find((x) => x.label === 'Patio 2')?.allReady === true, g.map((x) => [x.label, x.sub, x.ready, x.total]));
  check('…a run is ready only when every plate is', g.find((x) => x.sub === 'Mains' && x.label === 'Table 12')?.allReady === false);
  const u = S.unfiredGroups([tk('e', 'unfired', { course: 4, courseName: 'Dessert' }), tk('g', 'unfired', { course: 4, courseName: 'Dessert' }), tk('a', 'ready')] as any);
  check('what’s held, by table and course', u.length === 1 && u[0].count === 2 && u[0].course === 'Dessert' && u[0].label === 'Table 12', u);

  console.log('the tab: fire, comp, void, remake, seat');
  const R = await import('../../src/app/api/tab/route');
  const call = async (body: any) => R.POST(req({ tenantId: 't1', visitId: 'v1', ...body })) as any;
  await db.doc(T).set({ name: 'Linden', timeZone: 'America/New_York', kitchenSettings: { compAllowanceCents: 1000 } });
  await db.doc(`${T}/inventory/steak`).set({ name: 'Steak frites', costPerUnit: 11.4 });
  const line = (id: string, name: string, price: number, o: any = {}) => ({ lineId: id, itemId: o.itemId || id, itemType: 'product', name, price, listPrice: price, quantity: 1, seat: '1', note: null, at: '', by: 'Sam', kdsId: `tab_v1_${id}`, course: o.course ?? null, courseName: o.courseName ?? null, firedAt: o.firedAt === undefined ? 'x' : o.firedAt, station: 'Kitchen', comp: null });
  await db.doc(`${T}/appointments/v1`).set({ tableName: '12', isTable: true, status: 'servicing', tab: [
    line('l1', 'Burrata', 16), line('l2', 'Risotto', 26, { course: 3, courseName: 'Mains', firedAt: null }), line('l3', 'Steak frites', 34, { itemId: 'steak', course: 3, courseName: 'Mains', firedAt: null }),
    line('l4', 'Fries', 9), line('l5', 'Cake', 11, { course: 4, courseName: 'Dessert', firedAt: null }), line('l6', 'Olives', 6)] });
  for (const [id, status] of [['l1', 'ready'], ['l2', 'unfired'], ['l3', 'unfired'], ['l4', 'pending'], ['l5', 'unfired'], ['l6', 'delivered']]) await db.doc(`${T}/kdsTickets/tab_v1_${id}`).set({ id: `tab_v1_${id}`, status, source: 'tab', visitId: 'v1', menuItemName: id, createdAt: '' });

  let r = await call({ action: 'fire', course: 3 });
  const tab1 = (await get(`${T}/appointments/v1`)).tab;
  check('firing mains sends both mains, and only them', r.body.ok && r.body.fired === 2 && (await get(`${T}/kdsTickets/tab_v1_l2`)).status === 'pending' && (await get(`${T}/kdsTickets/tab_v1_l3`)).status === 'pending' && (await get(`${T}/kdsTickets/tab_v1_l5`)).status === 'unfired'
    && tab1.find((l: any) => l.lineId === 'l2').firedAt && !tab1.find((l: any) => l.lineId === 'l5').firedAt, r.body);
  r = await call({ action: 'fire', course: 3 });
  check('…firing again sends nothing twice', r.body.ok && r.body.fired === 0);

  r = await call({ action: 'need', lineId: 'l4', kind: 'comp' });
  check('a $9 comp is within the $10 allowance: no PIN', r.body.ok && !r.body.pin && r.body.allowanceLeftCents === 1000, r.body);
  r = await call({ action: 'comp', lineId: 'l4', all: true, reason: 'Took too long' });
  let v = await get(`${T}/appointments/v1`); let l4 = v.tab.find((l: any) => l.lineId === 'l4');
  check('…comped: costs $0, list price kept, the comp on the line', r.body.ok && l4.price === 0 && l4.listPrice === 9 && l4.comp?.reason === 'Took too long' && l4.comp?.amount === 9, l4);
  const rec = await get(`${T}/approvals/${l4.comp.approvalId}`);
  check('…kept as a record no browser can write, on the server’s say, for tonight', rec?.kind === 'comp' && rec.via === 'self' && rec.used === true && rec.ref === 'v1:l4' && rec.amount === 9 && typeof rec.day === 'string' && rec.requestedById === 's1', rec);
  const tally = (await all(`${T}/approvals`)).find((a: any) => a.kind === 'tally');
  check('…and counted toward tonight’s allowance in the same save, where no browser can reset it', tally?.cents === 900 && tally.staffId === 's1' && tally.day === rec.day && /^tally_/.test(tally.id), tally);
  r = await call({ action: 'comp', lineId: 'l4', all: true, reason: 'Took too long' });
  check('…an item is comped once', r.status === 400 && /already comped/.test(r.body.error), r.body);
  r = await call({ action: 'comp', lineId: 'l1', all: true, reason: 'Not right' });
  check('a $16 comp on top, past the allowance, needs a manager', r.status === 403 && /manager/i.test(r.body.error), r.body);
  r = await call({ action: 'need', lineId: 'l1', kind: 'comp' });
  check('…and says so before asking', r.body.pin === true && r.body.allowanceLeftCents === 100, r.body);
  await db.doc(`${T}/approvals/apSelf`).set({ kind: 'comp', status: 'approved', used: false, amount: 16, ref: 'v1:l1', approverId: 's1', approverName: 'Sam Lee', expiresAt: soon() });
  r = await call({ action: 'comp', lineId: 'l1', all: true, reason: 'Not right', approvalToken: 'apSelf' });
  check('…never approved by the person asking', r.status === 403, r.body);
  await db.doc(`${T}/approvals/apOpen`).set({ kind: 'comp', status: 'approved', used: false, amount: 50, ref: null, approverId: 'm1', approverName: 'Dana Fox', expiresAt: soon() });
  r = await call({ action: 'comp', lineId: 'l1', all: true, reason: 'Not right', approvalToken: 'apOpen' });
  check('…nor by one that doesn’t name the item', r.status === 403 && (await get(`${T}/approvals/apOpen`)).used === false, r.body);
  await db.doc(`${T}/approvals/apWrong`).set({ kind: 'comp', status: 'approved', used: false, amount: 16, ref: 'v1:l6', approverId: 'm1', approverName: 'Dana Fox', expiresAt: soon() });
  r = await call({ action: 'comp', lineId: 'l1', all: true, reason: 'Not right', approvalToken: 'apWrong' });
  check('…nor by an approval for another item', r.status === 403, r.body);
  await db.doc(`${T}/approvals/ap1`).set({ kind: 'comp', status: 'approved', used: false, amount: 16, ref: 'v1:l1', approverId: 'm1', approverName: 'Dana Fox', requestedById: 's1', via: 'pin', expiresAt: soon() });
  r = await call({ action: 'comp', lineId: 'l1', all: true, reason: 'Not right', approvalToken: 'ap1' });
  v = await get(`${T}/appointments/v1`); const l1 = v.tab.find((l: any) => l.lineId === 'l1');
  check('…with a manager’s approval it goes through, under both names', r.body.ok && r.body.approvedBy === 'Dana Fox' && l1.price === 0 && l1.comp.approvalId === 'ap1' && l1.comp.by === 'Sam Lee', l1);
  check('…a manager-approved comp doesn’t use up the server’s own allowance', (await all(`${T}/approvals`)).find((a: any) => a.kind === 'tally')?.cents === 900);
  check('…the approval is used up and carries the night and the item', (await get(`${T}/approvals/ap1`)).used === true && (await get(`${T}/approvals/ap1`)).itemName === 'Burrata' && !!(await get(`${T}/approvals/ap1`)).day);
  actor = boss;
  r = await call({ action: 'comp', lineId: 'l6', cents: 250, reason: 'A regular' });
  v = await get(`${T}/appointments/v1`);
  check('a manager comps part of an item on their own say', r.body.ok && v.tab.find((l: any) => l.lineId === 'l6').price === 3.5 && (await all(`${T}/approvals`)).some((a: any) => a.ref === 'v1:l6' && a.via === 'manager' && a.amount === 2.5), r.body);
  actor = server;
  r = await call({ action: 'comp', lineId: 'l2', cents: 9999, reason: 'Not right' });
  check('…never more than the item costs', r.status === 400 && /more than/.test(r.body.error), r.body);

  r = await call({ action: 'void', lineId: 'l5', reason: 'Changed their mind' });
  v = await get(`${T}/appointments/v1`);
  check('a void before the kitchen starts: a reason, off the tab, ticket cancelled, kept on record', r.body.ok && !r.body.started && !v.tab.some((l: any) => l.lineId === 'l5') && (await get(`${T}/kdsTickets/tab_v1_l5`)).status === 'cancelled'
    && (await all(`${T}/approvals`)).some((a: any) => a.kind === 'void_item' && a.ref === 'v1:l5' && a.started === false), r.body);
  r = await call({ action: 'void', lineId: 'l2' });
  check('…no reason, no void', r.status === 400);
  await db.doc(`${T}/kdsTickets/tab_v1_l3`).set({ status: 'in_progress' }, { merge: true });
  r = await call({ action: 'void', lineId: 'l3', reason: 'Changed their mind' });
  check('a void after the kitchen started needs a manager', r.status === 403, r.body);
  await db.doc(`${T}/approvals/ap2`).set({ kind: 'void_item', status: 'approved', used: false, amount: null, ref: 'v1:l3', approverId: 'm2', approverName: 'Priya', expiresAt: soon() });
  r = await call({ action: 'void', lineId: 'l3', reason: 'Changed their mind', approvalToken: 'ap2' });
  const ap2 = await get(`${T}/approvals/ap2`);
  check('…approved: off the tab, the station stops, its cost is waste', r.body.ok && r.body.started && r.body.waste === 11.4 && (await get(`${T}/kdsTickets/tab_v1_l3`)).status === 'cancelled' && ap2.wasteCost === 11.4 && ap2.used === true && ap2.approverName === 'Priya', { b: r.body, ap2 });
  actor = boss;
  r = await call({ action: 'void', lineId: 'l1', reason: 'Sent back', stopKitchen: false });
  check('…asked not to stop, a ready plate stays on the screen, marked voided', r.body.ok && (await get(`${T}/kdsTickets/tab_v1_l1`)).status === 'ready' && (await get(`${T}/kdsTickets/tab_v1_l1`)).voided === true, r.body);
  actor = server;

  await db.doc(`${T}/kdsTickets/tab_v1_l2`).set({ status: 'ready', claimedBy: { name: 'Mo' }, note: 'no parmesan' }, { merge: true });
  r = await call({ action: 'remake', lineId: 'l2', reason: 'Dropped or spilled' });
  v = await get(`${T}/appointments/v1`); const l2 = v.tab.find((l: any) => l.lineId === 'l2');
  const fresh = await get(`${T}/kdsTickets/${l2.kdsId}`);
  check('a remake: the line stays once, a fresh ticket waits, the first is cancelled', r.body.ok && v.tab.filter((l: any) => l.lineId === 'l2').length === 1 && l2.kdsId !== 'tab_v1_l2' && fresh?.status === 'pending' && !fresh.claimedBy && /Remake: Dropped/.test(fresh.note) && (await get(`${T}/kdsTickets/tab_v1_l2`)).status === 'cancelled', { l2, fresh });
  check('…and it’s on record', (await all(`${T}/approvals`)).some((a: any) => a.kind === 'remake' && a.ref === 'v1:l2'));
  await db.doc(`${T}/kdsTickets/${l2.kdsId}`).set({ status: 'ready' }, { merge: true });
  r = await call({ action: 'remake', lineId: 'l2', reason: 'Not right' });
  const again = (await get(`${T}/appointments/v1`)).tab.find((l: any) => l.lineId === 'l2').kdsId;
  check('…a second remake keeps a short ticket id', r.body.ok && /^tab_v1_l2_r[a-z0-9]+$/.test(again) && again !== l2.kdsId, again);
  r = await call({ action: 'remake', lineId: 'l4', reason: 'Not right' });
  check('…a dish the kitchen hasn’t started can’t be remade', r.status === 400 && /hasn’t been started/.test(r.body.error), r.body);
  r = await call({ action: 'seat', lineId: 'l4', seat: '3' });
  check('an item moves seats, on its ticket too', r.body.ok && (await get(`${T}/appointments/v1`)).tab.find((l: any) => l.lineId === 'l4').seat === '3' && (await get(`${T}/kdsTickets/tab_v1_l4`)).seatNumber === '3');
  await db.doc(`${T}/appointments/v1`).set({ status: 'completed', checkoutSessionId: 'cs1' }, { merge: true });
  r = await call({ action: 'comp', lineId: 'l4', all: true, reason: 'A regular' });
  check('a table that has paid can’t be changed', r.status === 409, r.body);

  console.log('where it shows');
  const tabSrc = src('src/lib/table-tab.ts');
  check('a held course rings in as “not fired”, with its course and station on the ticket', /status: waits \? 'unfired' : 'pending'/.test(tabSrc) && /course: c \? c\.n : null, courseName: c \? c\.name : null, madeAt: item\.station/.test(tabSrc));
  const co = src('src/app/api/checkout/complete/route.ts');
  check('checkout charges less for a comp only when its record checks out (kind, item, used, enough)', /a\.kind !== 'comp' \|\| a\.status !== 'approved' \|\| a\.used !== true \|\| a\.ref !== `\$\{visitId\}:\$\{lineId\}` \|\| num\(a\.amount\) \+ 0\.005 < num\(c\.amount\)/.test(co)
    && /compsUsed\.has\(compLineId\)/.test(co) && /couldn’t be checked/.test(co));
  check('…bound to that item on that table, and spent by the sale in the same write', /String\(a\.visitId \|\| ''\) !== visitId \|\| String\(a\.itemId \|\| ''\) !== itemId \|\| String\(l\.itemId \|\| ''\) !== itemId \|\| a\.compSaleId/.test(co)
    && /batch\.set\(db\.doc\(`\$\{T\}\/approvals\/\$\{it\.comp\.approvalId\}`\), \{ compSaleId: checkoutSessionId/.test(co) && /A comped item is one item\./.test(co));
  check('…the same product on two lines moves its lots and pop-up count once per line, from where the last left them', /lotsNow\.get\(k\) \?\? \(Array\.isArray\(inv\?\.batches\)/.test(co) && /m\[String\(x\.id\)\] = \(m\[String\(x\.id\)\] \|\| 0\) \+ x\.quantity/.test(co));
  check('…and the desk can’t change a comped line’s count', /item\.id === itemId && !item\.compLineId/.test(src('src/components/pos/CheckoutHub.tsx')));
  check('…and won’t take payment for a table with a course never fired', /l\?\.kdsId && l\.firedAt === null/.test(co) && /from the table’s tab first/.test(co));
  const eng = src('src/components/pos/usePosEngine.tsx');
  check('the desk carries a comped tab line as its own line, and sends what the server needs to check it', /compLineId: comp\.lineId, compVisitId: comp\.visitId/.test(eng) && /\.\.\.\(it\.compLineId \? \{ itemId: it\.itemId, compLineId: it\.compLineId, compVisitId: it\.compVisitId \} : \{\}\)/.test(eng));
  const kr = src('src/app/api/kitchen/route.ts');
  check('a held course left behind for 16 hours is taken off for good', /cancelReason: 'never fired'/.test(src('src/app/api/kitchen/route.ts')));
  check('…and firing it later still reaches the kitchen', /String\(k\.status\) === 'cancelled' && k\.cancelReason === 'never fired'/.test(src('src/app/api/tab/route.ts')));
  check('a voided sale gives its comps back to the reopened table', /comps: items\.filter\(\(x: any\) => x\.comp\?\.approvalId\)/.test(co) && /compSaleId: null, compSaleAt: null/.test(src('src/app/api/checkout/void/route.ts')));
  check('without a kitchen screen nothing is held', /course: c && !kitchenOn \? \{ \.\.\.c, hold: false \} : c/.test(src('src/components/host/TableTab.tsx')));
  const tr = src('src/app/api/tab/route.ts');
  check('the allowance is checked again inside the save; a manager’s PIN is given back if the change fails; approvals must name the item', /Counted again here, in the save/.test(tr) && /used: false, usedAt: null/.test(tr) && (tr.match(/covers: \(x: any\) => x\.ref === `\$\{visitId\}:\$\{lineId\}`/g) || []).length === 2);
  check('the kitchen screen gets each ticket’s station, the stations, and what’s not fired', /t\.madeAt = stationOfItem/.test(kr) && /tickets, unfired, stations, items/.test(kr) && /where\('status', '==', 'unfired'\)/.test(kr));
  const kds = src('src/app/kds/[tenantId]/page.tsx');
  check('a station’s screen shows only its own; expo sees the whole pass', /view === 'expo' \|\| !myStation \|\| t\.madeAt === myStation/.test(kds) && /<ExpoView /.test(kds) && /cf\.kitchen\.station/.test(kds));
  const ex = src('src/components/kitchen/ExpoView.tsx');
  check('expo runs a table only when every plate is ready', /disabled=\{!g\.allReady \|\| busy\}/.test(ex) && /onBump\(list, 'deliver'\)/.test(ex));
  const tt = src('src/components/host/TableTab.tsx');
  check('the tab won’t check out with a course still waiting to be fired', /waiting\.length > 0/.test(tt) && /pointer-events-none/.test(tt));
  check('new screens keep to the house style', ![tt, ex, src('src/components/menu/TableServiceSettings.tsx')].some((x) => /\{\/\*|uppercase|font-black| · /.test(x)));
  const ap = src('src/app/api/approvals/route.ts');
  check('managers are asked in plain words', /comp: 'comp an item on a table’s check', void_item: 'void an item the kitchen has started'/.test(ap));
  const mr = src('src/app/api/menu/route.ts');
  check('only a manager changes table service; an item’s station and course must be the business’s own', /\['save', 'ingredients', 'targets', 'service',/.test(mr) && /Pick one of your stations\./.test(mr) && /Pick one of your courses\./.test(mr));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
