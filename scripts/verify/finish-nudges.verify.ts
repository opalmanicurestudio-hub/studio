// Checks finishing a table's plates together and the server's nudges (L20 round 4): lib/table-service startPlan,
// lib/nudges, api/tab 'nudges' and 'nudge', api/menu 'service', the kitchen screen and My tables.
// - A table's course (or a counter order) is timed so its plates are done at once: the slowest dish starts when it's
//   fired, each quicker one later by the difference in make times. Nothing changes for a dish already started, or one on
//   its own.
// - Nudges: food waiting at the pass, a course running late, the next course to fire once the last one has been out a
//   while, checking back after a course lands, a table that hasn't ordered, an allergy at a table before its first order.
//   Each timing is the business's own (0 is off); a nudge marked done stays away, and "Not yet" brings it back later.
// - My tables shows the tables in the person's section, or every table when they have none.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/finish-nudges.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

let db: any = strictTransactions(makeDb());
let manager = true;
let actor: any = { uid: 's1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { uid: 'm1', name: 'Ana Ruiz', isManager: manager } }),
    requireCan: async () => ({ actor }),
  };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const NOW = Date.parse('2026-11-14T20:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();

(async () => {
  const TS = await import('../../src/lib/table-service');
  console.log('finishing together');
  const fire = ago(1);
  const tk = (id: string, item: string, make: number | null, o: any = {}) => ({ id, item, makeSeconds: make, status: 'pending', source: 'tab', visitId: 'v1', course: 3, firedAt: fire, at: fire, ...o });
  const plan = TS.startPlan([tk('a', 'Steak frites', 840), tk('b', 'Mushroom risotto', 1080), tk('c', 'Grilled bream', 720), tk('d', 'Fries', 300, { status: 'in_progress' }), tk('e', 'Soup', 600, { visitId: 'v2' }), tk('f', 'Salad', 120, { course: 2 })]);
  const at = (id: string) => (plan.get(id) ? (plan.get(id)!.startAt - Date.parse(fire)) / 1000 : null);
  check('the slowest dish starts when it’s fired; each quicker one later by the difference', at('b') === null && at('a') === 240 && at('c') === 360 && plan.get('c')?.slowest === 'Mushroom risotto', Array.from(plan.entries()));
  check('…a dish already started, or one on its own (another table, another course), has no plan', at('d') === null && at('e') === null && at('f') === null);
  const p2 = TS.startPlan([tk('s', 'Steak frites', 600, { status: 'ready' }), tk('r', 'Side salad', 120, { remake: true }), tk('q', 'Salad', 120), tk('late', 'Fries', 300, { firedAt: ago(-10) }), tk('n', 'Bream', 720, { firedAt: ago(-10) })]);
  check('a plate already made, a remake, or a dish added to the course later isn’t held back for a slower one (a later addition is timed with what was fired with it)', !p2.has('q') && !p2.has('r') && p2.has('late') && (p2.get('late')!.startAt - Date.parse(ago(-10))) / 1000 === 420, Array.from(p2.entries()));
  const order = TS.startPlan([{ id: 'x', item: 'Double burger', makeSeconds: 240, status: 'pending', source: 'counter', orderId: 'o1', at: fire }, { id: 'y', item: 'Fries', makeSeconds: 90, status: 'pending', source: 'counter', orderId: 'o1', at: fire }]);
  check('a counter order too: the fries start when the burger is nearly done', (order.get('y')!.startAt - Date.parse(fire)) / 1000 === 150 && !order.has('x'));
  check('…said plainly', TS.startWords(NOW + 240000, NOW) === 'in 4 min' && TS.startWords(NOW - 1000, NOW) === 'now' && TS.startWords(NOW + 30000, NOW) === 'in under a minute');
  check('on unless the business turns it off', TS.finishTogetherOn({}) && !TS.finishTogetherOn({ kitchenSettings: { finishTogether: false } }));
  check('a party’s visit: their booking’s, their walk-in’s, or the table’s own', TS.visitIdForParty({ id: 'p1', guestIds: ['appt:a9'] }) === 'a9' && TS.visitIdForParty({ id: 'p1', guestIds: ['walkin:w2'] }) === 'apt-walkin-w2' && TS.visitIdForParty({ id: 'p1' }) === 'apt-party-p1');

  const N = await import('../../src/lib/nudges');
  console.log('nudges');
  const S = N.nudgeSettingsOf({});
  check('the usual timings, the business’s own within 0 to 60 minutes', S.fireAfterMin === 12 && S.checkBackMin === 2 && S.passWaitMin === 3 && S.noOrderMin === 8 && S.lateMin === 5
    && N.nudgeSettingsOf({ kitchenSettings: { nudges: { fireAfterMin: 0, lateMin: 99, passWaitMin: '4' } } }).fireAfterMin === 0 && N.nudgeSettingsOf({ kitchenSettings: { nudges: { lateMin: 99 } } }).lateMin === 5 && N.nudgeSettingsOf({ kitchenSettings: { nudges: { passWaitMin: '4' } } }).passWaitMin === 4);
  const courses = TS.coursesOf({});
  const table = (o: any) => ({ visitId: 'v1', partyId: 'p1', table: 'Table 12', seatedAt: ago(30), tab: [], tickets: {}, allergies: [], done: {}, courses, ...o });
  const line = (id: string, course: number, o: any = {}) => ({ lineId: id, name: id, course, courseName: courses.find((c) => c.n === course)?.name, firedAt: ago(20), kdsId: `k_${id}`, makeSeconds: 600, ...o });
  let ns = N.nudgesFor(table({ seatedAt: ago(9) }), S, NOW);
  check('seated a while with nothing ordered', ns.length === 1 && ns[0].kind === 'no_order' && /Seated 9 min ago/.test(ns[0].text) && N.nudgesFor(table({ seatedAt: ago(5) }), S, NOW).length === 0);
  ns = N.nudgesFor(table({ seatedAt: ago(1), allergies: [{ id: 'a', seat: '2', keys: ['treenuts'], other: null, severe: true, from: 'asked', by: '', at: '' }] }), S, NOW);
  check('…an allergy at a table that hasn’t ordered, to keep in mind', ns.length === 1 && ns[0].kind === 'allergy' && /Seat 2: tree nuts, severe/.test(ns[0].text));
  ns = N.nudgesFor(table({ tab: [line('s1', 2), line('s2', 2)], tickets: { k_s1: { status: 'ready', readyAt: ago(4) }, k_s2: { status: 'ready', readyAt: ago(5) } } }), S, NOW);
  check('a course all made and waiting at the pass, a few minutes on (counted from the last plate)', ns.length === 1 && ns[0].kind === 'at_pass' && ns[0].urgent && /Starters is ready at the pass, 4 min/.test(ns[0].text), ns);
  check('…not before', N.nudgesFor(table({ tab: [line('s1', 2)], tickets: { k_s1: { status: 'ready', readyAt: ago(2) } } }), S, NOW).length === 0);
  ns = N.nudgesFor(table({ tab: [line('m1', 3, { firedAt: ago(26), makeSeconds: 1080 }), line('m2', 3, { firedAt: ago(26) })], tickets: { k_m1: { status: 'in_progress' }, k_m2: { status: 'ready', readyAt: ago(3) } } }), S, NOW);
  check('a course taking longer than its slowest dish usually does', ns.length === 1 && ns[0].kind === 'late' && /taken 26 min/.test(ns[0].text), ns);
  check('…not while it’s within its time', N.nudgesFor(table({ tab: [line('m1', 3, { firedAt: ago(20), makeSeconds: 1080 })], tickets: { k_m1: { status: 'in_progress' } } }), S, NOW).length === 0);
  ns = N.nudgesFor(table({ tab: [line('m1', 3)], tickets: { k_m1: { status: 'delivered', deliveredAt: ago(3) } } }), S, NOW);
  check('a course just landed: check back', ns.length === 1 && ns[0].kind === 'check_back' && N.nudgesFor(table({ tab: [line('m1', 3)], tickets: { k_m1: { status: 'delivered', deliveredAt: ago(30) } } }), S, NOW).length === 0);
  const twoCourses = (served: number, startersDone = true) => table({ tab: [line('s1', 2), line('m1', 3, { firedAt: null }), line('m2', 3, { firedAt: null, makeSeconds: 900 })],
    tickets: { k_s1: startersDone ? { status: 'delivered', deliveredAt: ago(served) } : { status: 'in_progress' }, k_m1: { status: 'unfired' }, k_m2: { status: 'unfired' } } });
  ns = N.nudgesFor(twoCourses(13), S, NOW).filter((n) => n.kind === 'fire');
  check('the next held course, once the last one served has been out a while, with how long it takes', ns.length === 1 && ns[0].course?.n === 3 && /Starters went out 13 min ago\. Mains takes about 15 min/.test(ns[0].text), ns);
  check('…not too soon, and not while the course before is still being made', N.nudgesFor(twoCourses(6), S, NOW).every((n) => n.kind !== 'fire') && N.nudgesFor(twoCourses(13, false), S, NOW).every((n) => n.kind !== 'fire'));
  check('…and off when the business turns it off', N.nudgesFor(twoCourses(13), { ...S, fireAfterMin: 0 }, NOW).every((n) => n.kind !== 'fire'));
  const done = (d: any) => N.nudgesFor({ ...twoCourses(13), done: d }, S, NOW).filter((n) => n.kind === 'fire').length;
  check('a nudge marked done stays away; “Not yet” brings it back when its time is up', done({ 'fire:3': { at: ago(1) } }) === 0 && done({ 'fire:3': { until: new Date(NOW + 60000).toISOString() } }) === 0 && done({ 'fire:3': { until: ago(1) } }) === 1);
  const all = N.allNudges([table({ visitId: 'a', seatedAt: ago(9) }), table({ visitId: 'b', tab: [line('s1', 2)], tickets: { k_s1: { status: 'ready', readyAt: ago(6) } } })], S, NOW);
  check('every table together, what can’t wait first', all[0].kind === 'at_pass' && all[1].kind === 'no_order');
  ns = N.nudgesFor(table({ tab: [line('s1', 2, { firedAt: ago(40) }), line('s2', 2, { firedAt: ago(2) })], tickets: { k_s1: { status: 'delivered', deliveredAt: ago(30) }, k_s2: { status: 'pending' } } }), S, NOW);
  check('a dish added to a course already out isn’t called late because the first one was fired long ago', ns.every((n) => n.kind !== 'late'), ns);
  check('a nudge marked done comes back when the same thing happens again later (a remake waiting at the pass)', N.nudgesFor(table({ tab: [line('s1', 2)], tickets: { k_s1: { status: 'ready', readyAt: ago(4) } }, done: { 'pass:2': { at: ago(20) } } }), S, NOW).length === 1
    && N.nudgesFor(table({ tab: [line('s1', 2)], tickets: { k_s1: { status: 'ready', readyAt: ago(4) } }, done: { 'pass:2': { at: ago(1) } } }), S, NOW).length === 0);
  ns = N.nudgesFor(table({ tab: [line('m1', 3, { firedAt: null, at: ago(2) })], tickets: { k_m1: { status: 'unfired' } } }), S, NOW);
  check('a held course with nothing before it: a nudge a minute after it’s rung in', ns.length === 1 && ns[0].kind === 'fire' && /Mains is held, with nothing before it/.test(ns[0].text), ns);
  ns = N.nudgesFor(table({ tab: [line('s1', 2), line('m1', 3, { firedAt: ago(30) }), line('m2', 3, { firedAt: null, at: ago(3), name: 'Side of greens' })], tickets: { k_s1: { status: 'delivered', deliveredAt: ago(40) }, k_m1: { status: 'delivered', deliveredAt: ago(15) }, k_m2: { status: 'unfired' } } }), S, NOW).filter((n) => n.kind === 'fire');
  check('something added to a course already out is said as itself, not as the course before', ns.length === 1 && /Side of greens for mains is held/.test(ns[0].text), ns);
  check('only nudge keys the server knows', ['order', 'allergy', 'fire:3', 'pass:12'].every((k) => N.NUDGE_KEY.test(k)) && !['fire', 'x:1', 'fire:3; drop'].some((k) => N.NUDGE_KEY.test(k)));

  console.log('api/tab: tonight’s tables and their nudges');
  const Tab = await import('../../src/app/api/tab/route');
  let r: any = await Tab.POST(req({ tenantId: 't0', action: 'nudges', mine: true }));
  check('no open floor tonight: nothing, said plainly', r.body.ok && r.body.tables.length === 0 && r.body.session === null);
  await db.doc(T).set({ name: 'Linden', timezone: 'America/New_York' });
  await db.doc(`${T}/serviceSessions/s1`).set({ status: 'open', opensAt: ago(120), units: [{ id: 'u1', name: '12', seatCount: 4, staffIds: ['s1'] }, { id: 'u2', name: '5', seatCount: 2, staffIds: ['s2'] }, { id: 'u3', name: 'Patio 2', seatCount: 4, staffIds: [] }] });
  const sat = new Date(Date.now() - 20 * 60000).toISOString();
  await db.doc(`${T}/parties/p1`).set({ sessionId: 's1', status: 'seated', name: 'Okafor', size: 4, unitIds: ['u1'], seatedAt: sat, guestIds: [] });
  await db.doc(`${T}/parties/p2`).set({ sessionId: 's1', status: 'seated', name: 'Lopez', size: 2, unitIds: ['u2'], seatedAt: sat, guestIds: ['appt:a2'] });
  await db.doc(`${T}/parties/p3`).set({ sessionId: 's1', status: 'finished', name: 'Gone', size: 2, unitIds: ['u3'], seatedAt: sat, guestIds: [] });
  await db.doc(`${T}/appointments/apt-party-p1`).set({ tableName: '12', tab: [{ lineId: 'l1', name: 'Burrata', price: 16, quantity: 1, course: 2, courseName: 'Starters', firedAt: sat, kdsId: 'k1', makeSeconds: 300 }] });
  await db.doc(`${T}/kdsTickets/k1`).set({ id: 'k1', visitId: 'apt-party-p1', status: 'ready', readyAt: new Date(Date.now() - 5 * 60000).toISOString() });
  await db.doc(`${T}/appointments/a2`).set({ tableName: '5', tab: [] });
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudges', mine: true }));
  check('mine: the tables in my section, with what each needs (starters waiting at the pass), and the table’s party to open its tab', r.body.ok && r.body.mineOnly && r.body.hasSection && r.body.tables.length === 1 && r.body.tables[0].table === 'Table 12'
    && r.body.tables[0].total === 16 && r.body.tables[0].party.name === 'Okafor' && r.body.nudges.length === 1 && r.body.nudges[0].kind === 'at_pass' && r.body.meName === 'Sam Lee', r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudges', mine: false }));
  check('every table, when asked: not a party that has left; a booked party’s own visit', r.body.tables.length === 2 && r.body.tables.some((t: any) => t.visitId === 'a2') && r.body.nudges.some((n: any) => n.kind === 'no_order' && n.table === 'Table 5'), r.body);
  actor = { ...actor, uid: 's9' };
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudges', mine: true }));
  check('someone with no section tonight sees every table', r.body.tables.length === 2 && !r.body.mineOnly && !r.body.hasSection);
  actor = { ...actor, uid: 's1' };
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudge', partyId: 'p1', key: 'pass:2', op: 'done' }));
  let v: any = await get(`${T}/parties/p1`);
  check('a nudge marked done, with who and when, kept on the party; it doesn’t come back', r.body.ok && v.nudges['pass:2'].by === 'Sam Lee' && v.nudges['pass:2'].until === null && ((await Tab.POST(req({ tenantId: 't1', action: 'nudges', mine: true }))) as any).body.nudges.length === 0);
  await db.doc(`${T}/parties/p4`).set({ sessionId: 's1', status: 'seated', name: 'Ng', size: 2, unitIds: ['u3'], seatedAt: new Date(Date.now() - 12 * 60000).toISOString(), guestIds: [] });
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudge', partyId: 'p4', key: 'order', op: 'later' }));
  v = await get(`${T}/parties/p4`);
  check('“Not yet” on a table that has no tab yet works (it’s kept on the party), and puts it off five minutes', r.body.ok && Date.parse(v.nudges.order.until) - Date.now() > 4 * 60000 && !(await get(`${T}/appointments/apt-party-p4`)));
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudge', partyId: 'p4', key: 'drop:everything', op: 'done' }));
  const r9: any = await Tab.POST(req({ tenantId: 't1', action: 'nudge', partyId: 'nobody', key: 'order', op: 'done' }));
  check('only a nudge the server knows, on a party that exists', r.status === 400 && r9.status === 404);

  console.log('settings');
  const MenuApi = await import('../../src/app/api/menu/route');
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'service', finishTogether: false, nudges: { fireAfterMin: 15, checkBackMin: 0 } }));
  check('a manager sets finishing together and each nudge’s timing (0 is off), the rest kept', r.body.ok && r.body.service.finishTogether === false && r.body.service.nudges.fireAfterMin === 15 && r.body.service.nudges.checkBackMin === 0 && r.body.service.nudges.passWaitMin === 3, r.body);
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'service', nudges: { lateMin: 90 } }));
  const r2: any = await MenuApi.POST(req({ tenantId: 't1', action: 'service', finishTogether: 'yes' }));
  check('…within an hour, and on or off', r.status === 400 && r2.status === 400);

  console.log('where it shows');
  const kds = src('src/app/kds/[tenantId]/page.tsx'), pg = src('src/app/(app)/tables/page.tsx'), kr = src('src/app/api/kitchen/route.ts'), cs = src('src/lib/counter-server.ts'), set = src('src/components/menu/TableServiceSettings.tsx');
  check('the kitchen screen: a quicker dish says when to start and waits below what to start now', /startPlan\(/.test(kds) && /So it’s ready with the/.test(kds) && /Start \{startWords/.test(kds) && /finishTogether: finishTogetherOn\(tenant\)/.test(kr));
  check('…counter orders carry each dish’s make time', /makeSeconds: Number\(l\.makeSeconds\) \|\| null/.test(cs));
  check('My tables: each nudge’s own step (fire, done, not yet), the tab one tap away, mine or every table', /action: 'fire'/.test(pg) && /action: 'nudge'/.test(pg) && /Not yet/.test(pg) && /<TableTab /.test(pg) && /Every table/.test(pg) && /navigator\.vibrate/.test(pg));
  check('…in the sidebar and the hospitality pages', /href: '\/tables'/.test(src('src/components/shared/AppSidebar.tsx')) && /'\/tables'\]/.test(src('src/lib/modules.ts')) && /'tables'/.test(src('src/lib/app-theme.ts')));
  check('settings: finishing together and each nudge’s timing', /Finish a table’s plates together/.test(set) && /fireAfterMin/.test(set) && /Off<\/option>/.test(set));
  check('the host stand puts the signed-in person’s name on what they ring in', /by=\{String\(user\?\.displayName \|\| 'Host'\)/.test(src('src/app/(app)/host/page.tsx')));
  check('new screens keep to the house style', ![pg].some((x) => /\{\/\*|uppercase|font-black| · /.test(x)) && !/\b(studio|salon|stylist|booth)\b/i.test(pg.replace(/\/\/.*$/gm, '')));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
