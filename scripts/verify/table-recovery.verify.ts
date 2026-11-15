// Checks fixing a bad experience before they leave (L20 round 17, design canvas "Fixing a bad experience"):
// lib/table-recovery (late courses, saying sorry, what a guest can report, which comps mean something went wrong),
// lib/table-recovery-server (one Making it right case a visit), api/table-pay 'report' and the sorry lines on 'view',
// the server's phone (lib/nudges via lib/guest-pass), api/host/floor (troubles, 'make_right'), api/tab (comps, voids and
// remakes on the case), api/menu (the settings) and the screens.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/table-recovery.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Sam Lee', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor, tenant: {} }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any, ip = '10.3.3.3') => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : String(k).toLowerCase() === 'x-real-ip' ? ip : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const NOW = Date.parse('2026-11-15T20:00:00.000Z');
const ago = (min: number, from = NOW) => new Date(from - min * 60000).toISOString();
const TOK1 = 'abcdefghijklmnopqrstuv'; const TOK2 = 'bcdefghijklmnopqrstuvw'; const TOK3 = 'cdefghijklmnopqrstuvwx';

(async () => {
  const R = await import('../../src/lib/table-recovery');
  const TS = await import('../../src/lib/table-service');
  const MIR = await import('../../src/lib/making-it-right');
  console.log('the settings');
  check('on by default: sorry on the table’s page, “Something not right?”, the host told at 10 minutes late', R.recoverySettingsOf({}).sorry && R.recoverySettingsOf({}).report && R.recoverySettingsOf({}).hostLateMin === 10
    && R.recoverySettingsOf({ kitchenSettings: { recovery: { sorry: false, report: false, hostLateMin: 0 } } }).hostLateMin === 0 && !R.recoverySettingsOf({ kitchenSettings: { recovery: { sorry: false } } }).sorry
    && R.recoverySettingsOf({ kitchenSettings: { recovery: { hostLateMin: 99 } } }).hostLateMin === 10);
  check('…saved only when it makes sense', R.cleanRecovery({ sorry: false, hostLateMin: 15 })?.hostLateMin === 15 && R.cleanRecovery({ sorry: 'no' }) === null && R.cleanRecovery({ hostLateMin: 61 }) === null
    && R.cleanRecovery({ hostLateMin: 2.5 }) === null && R.cleanRecovery(null) === null && R.cleanRecovery({})?.report === true);

  console.log('late food');
  const courses = TS.DEFAULT_COURSES;
  const L = (id: string, name: string, course: number, firedMin: number | null, mk = 600, o: any = {}) => ({ lineId: id, itemId: id, itemType: 'product', name, price: 20, quantity: 1, seat: 1, course, kdsId: `k_${id}`, firedAt: firedMin === null ? null : ago(firedMin), makeSeconds: mk, ...o });
  const tab = [L('a', 'Burrata', 2, 40, 300), L('b', 'Steak frites', 3, 22, 600), L('c', 'Grilled bream', 3, 22, 480), L('d', 'Tart', 4, null, 300)];
  const tk: any = { k_a: { status: 'delivered' }, k_b: { status: 'in_progress' }, k_c: { status: 'ready' }, k_d: { status: 'unfired' } };
  let late = R.lateCourses(tab, tk, courses, NOW);
  check('a course still cooking past its slowest dish’s usual time: mains, 12 min over (what’s ready doesn’t set the clock)', late.length === 1 && late[0].n === 3 && late[0].name === 'Mains' && late[0].overMin === 12, late);
  check('…not with the host’s grace of 15; yes with 10; served, ready and held courses never', R.lateCourses(tab, tk, courses, NOW, 15).length === 0 && R.lateCourses(tab, tk, courses, NOW, 10).length === 1
    && R.lateCourses(tab, { ...tk, k_b: { status: 'ready' } }, courses, NOW).length === 0);
  check('…on time is not late', R.lateCourses([L('x', 'Soup', 2, 3, 600)], { k_x: { status: 'pending' } }, courses, NOW).length === 0);
  check('dishes being made again, by name', R.remadeNow([L('b', 'Steak frites', 3, 2, 600, { kdsId: 'k_b_r1' })], { k_b_r1: { status: 'pending', remakeOf: 'k_b' } }).join() === 'Steak frites'
    && R.remadeNow([L('b', 'Steak frites', 3, 2)], { k_b: { status: 'pending' } }).length === 0 && R.remadeNow([L('b', 'Steak frites', 3, 2, 600, { kdsId: 'k_r' })], { k_r: { status: 'delivered', remakeOf: 'x' } }).length === 0);
  check('the table’s page says sorry, kindly, without blaming anyone', R.sorryLines(late, []).join() === 'Sorry for the wait on your mains. The kitchen is on it now.'
    && R.sorryLines([], ['Steak frites', 'Fries']).join() === 'We’re making your Steak frites and Fries again. Sorry about that.' && R.sorryLines([{ n: 0, name: '', overMin: 3 }], [])[0] === 'Sorry for the wait on your order. The kitchen is on it now.' && R.sorryLines([], []).length === 0);
  check('the host stand’s words', R.hostLateText('Table 12', { n: 3, name: 'Mains', overMin: 14 }) === 'Table 12 has waited 14 min longer than usual for its mains.');

  console.log('what a guest can say');
  const hosp = MIR.settingsOf({ businessType: 'restaurant' });
  const reasons = R.reportReasons(hosp.reasons);
  check('the business’s own Making it right reasons, then “Something else”; an allergic reaction is a safety one', reasons[0].id === 'food' && reasons.some((x) => x.id === 'allergy' && x.safety) && reasons[reasons.length - 1].id === 'other' && reasons.length <= 9, reasons.map((x) => x.id));
  check('…a reason the business turned off isn’t offered', !R.reportReasons([{ id: 'food', label: 'Food', on: false }, { id: 'wait', label: 'Waited' }]).some((x) => x.id === 'food'));
  check('what the team sees', R.reportItem('Food wasn’t right', 'Steak frites') === 'Food wasn’t right, Steak frites' && R.reportItem('Service', null) === 'Service');
  const G = await import('../../src/lib/guest-pass');
  check('the server’s phone and the guest’s page', G.askText({ what: 'report', item: 'Food wasn’t right, Steak frites' }, 'Table 5') === 'Table 5 says something isn’t right: Food wasn’t right, Steak frites. A manager should go over.'
    && G.askSaid({ what: 'report' }, null) === 'Thanks for telling us. A manager is on the way.' && G.askSaid({ what: 'report' }, 'Sam') === 'Thanks for telling us. Sam is coming over.' && !G.ASK_KINDS.includes('report'));
  console.log('comps and remakes that mean something went wrong');
  check('“Took too long”, “Not right”, “Our mistake”, “Wrong order”, “Sent back” did; “A regular”, “Celebration”, “Dropped or spilled”, “Changed their mind”, “Rung in by mistake” (the team’s own slip) and a chocolate cake didn’t',
    ['Took too long', 'Not right', 'Our mistake', 'Wrong order', 'Sent back', 'Came out cold'].every(R.wentWrong) && !['A regular', 'Celebration', 'Dropped or spilled', 'Changed their mind', 'Rung in by mistake', 'Chocolate cake for the birthday', 'Templates'].some(R.wentWrong));
  check('…each to the case’s reason', R.caseReasonFor('Took too long') === 'wait' && R.caseReasonFor('Wrong order') === 'order' && R.caseReasonFor('Not right') === 'food' && R.caseReasonFor('Our mistake') === 'service');
  check('…and its line on the case', R.fixLine({ kind: 'comp', item: 'Steak frites', amount: 30, reason: 'Not right' }) === 'Comped Steak frites, $30.00: Not right' && R.fixLine({ kind: 'remake', item: 'Steak frites', amount: 0, reason: 'Not right' }) === 'Made again: Steak frites: Not right');

  console.log('the table’s page');
  const RN = Date.now(); const rago = (m: number) => ago(m, RN);
  await db.doc(T).set({ id: 't1', name: 'Linden', businessType: 'restaurant', userId: 'owner1', salesTax: { configured: true, productsPct: 10 }, kitchenSettings: { tablePay: { on: true } }, stripeAccountId: 'acct_1', timezone: 'UTC' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Sam Lee', role: 'manager' });
  await db.doc(`${T}/staff/d1`).set({ name: 'Dee Park', role: 'front_desk' });
  await db.doc(`${T}/serviceSessions/s1`).set({ id: 's1', status: 'open', opensAt: rago(240), units: [{ id: 'u5', name: '5', staffIds: ['m1'] }, { id: 'u12', name: '12', staffIds: [] }, { id: 'u7', name: '7', staffIds: [] }] });
  const RL = (id: string, name: string, course: number, firedMin: number | null, mk = 600, o: any = {}) => ({ ...L(id, name, course, null, mk, o), firedAt: firedMin === null ? null : rago(firedMin) });
  const seat = async (vid: string, pid: string, unit: string, tok: string, tabX: any[], tickets: Record<string, string>) => {
    await db.doc(`${T}/appointments/${vid}`).set({ id: vid, isTable: true, tableName: unit.slice(1), partyId: pid, status: 'servicing', source: 'host', payToken: tok, tab: tabX });
    await db.doc(`${T}/parties/${pid}`).set({ id: pid, sessionId: 's1', status: 'seated', name: pid, size: 2, seatedAt: rago(60), guestIds: [`appt:${vid}`], unitIds: [unit] });
    for (const [k, st] of Object.entries(tickets)) await db.doc(`${T}/kdsTickets/${k}`).set({ id: k, visitId: vid, status: st });
  };
  for (const [id, name] of [['a', 'Burrata'], ['b', 'Steak frites'], ['c', 'Grilled bream'], ['d', 'Tart'], ['e', 'Burger']]) await db.doc(`${T}/inventory/${id}`).set({ id, name, msrp: 20, type: 'refreshment' });
  await seat('v1', 'p1', 'u5', TOK1, [RL('a', 'Burrata', 2, 40, 300), RL('b', 'Steak frites', 3, 22, 600), RL('c', 'Grilled bream', 3, 22, 480)], { k_a: 'delivered', k_b: 'in_progress', k_c: 'ready' });
  await seat('v2', 'p2', 'u12', TOK2, [RL('e', 'Burger', 3, 30, 600, { kdsId: 'k_e2' })], { k_e2: 'pending' });
  await seat('v3', 'p3', 'u7', TOK3, [RL('a', 'Burrata', 2, 5, 600, { kdsId: 'k_a3' })], { k_a3: 'delivered' });
  const P = await import('../../src/app/api/table-pay/route');
  let r: any = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'view' }));
  let pass = r.body.pass;
  check('a course running late: the page says sorry on its own', r.body.ok && pass.sorry.join() === 'Sorry for the wait on your mains. The kitchen is on it now.', pass?.sorry);
  check('…and offers “Something not right?” with the business’s reasons and their dishes', pass.report.on && pass.report.mine === null && pass.report.reasons[0].id === 'food' && pass.report.dishes.map((d: any) => d.name).join() === 'Burrata,Steak frites,Grilled bream', pass.report);
  await db.doc(`${T}/kdsTickets/k_b`).set({ status: 'cancelled', remadeAs: 'k_b_r1' }, { merge: true });
  await db.doc(`${T}/kdsTickets/k_b_r1`).set({ id: 'k_b_r1', visitId: 'v1', status: 'pending', remakeOf: 'k_b' });
  await db.doc(`${T}/appointments/v1`).set({ tab: [RL('a', 'Burrata', 2, 40, 300), RL('b', 'Steak frites', 3, 2, 600, { kdsId: 'k_b_r1' }), RL('c', 'Grilled bream', 3, 22, 480)] }, { merge: true });
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'view' }));
  check('a dish being made again: sorry for that too', r.body.pass.sorry[0] === 'We’re making your Steak frites again. Sorry about that.', r.body.pass.sorry);
  await db.doc(T).set({ kitchenSettings: { recovery: { sorry: false } } }, { merge: true });
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'view' }));
  check('…not when the business turns it off', r.body.pass.sorry.length === 0);
  await db.doc(T).set({ kitchenSettings: { recovery: { sorry: true } } }, { merge: true });

  console.log('“Something not right?”');
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'report', reasonId: 'nope' }));
  const rOther: any = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'report', reasonId: 'other', words: '   ' }));
  const rDish: any = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'report', reasonId: 'food', lineId: 'zz' }));
  check('a reason of theirs, a few words for “Something else”, only a dish on their own order', r.status === 400 && rOther.status === 400 && rDish.status === 400 && !(await get(`${T}/appointments/v1`)).guestReport, [r.body, rOther.body, rDish.body]);
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'report', reasonId: 'food', lineId: 'b', words: ' Overcooked,   I asked for medium rare. ' }));
  let v1: any = await get(`${T}/appointments/v1`);
  const ask = v1.guestAsks.find((a: any) => a.what === 'report');
  check('sent: said back to them, and first on their server’s phone with what and which dish', r.body.ok && r.body.report.said === 'Thanks for telling us. A manager is on the way.' && !r.body.report.safety && ask && ask.item === 'Food wasn’t right, Steak frites', { body: r.body, ask });
  const cases = await all(`${T}/cases`); const c1 = cases.find((c: any) => c.id === v1.guestReport.caseId);
  check('…a Making it right case on the visit, from their table’s page, with their words (never the table’s own link)', !!c1 && c1.via === 'table' && c1.reasonId === 'food' && c1.visit?.appointmentId === 'v1' && /About the Steak frites\. Overcooked, I asked for medium rare\./.test(c1.words) && !c1.statusPath && !JSON.stringify(c1).includes(TOK1)
    && /their table’s page/.test(c1.timeline[0].text) && c1.clientName === 'Table 5 guest', c1);
  const notes = await all(`${T}/notifications`);
  check('…the managers and the desk hear at once', notes.some((n: any) => n.userId === 'owner1' && n.type === 'case_new' && n.caseId === c1.id) && notes.some((n: any) => n.userId === 'd1' && n.caseId === c1.id), notes.map((n: any) => `${n.userId}:${n.type}`));
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'report', reasonId: 'wait' }));
  check('…asked again: the same report, no second case', r.body.ok && r.body.already && (await all(`${T}/cases`)).length === 1);
  const N = await import('../../src/lib/nudges');
  const ns = N.nudgesFor({ visitId: 'v1', partyId: 'p1', table: 'Table 5', seatedAt: rago(60), tab: [], tickets: {}, allergies: [], done: {}, courses, asks: v1.guestAsks }, N.DEFAULT_NUDGES, Date.now());
  check('the server’s phone: first of all, urgent', ns[0].kind === 'asked' && ns[0].urgent && ns[0].text.startsWith('Table 5 says something isn’t right: Food wasn’t right, Steak frites.'), ns.map((n) => n.text));
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'view' }));
  check('their page now says what they told us (not among the everyday asks), and offers only an allergic reaction as well', r.body.pass.report.mine.said === 'Thanks for telling us. A manager is on the way.' && r.body.pass.report.reasons.map((x: any) => x.id).join() === 'allergy' && !r.body.pass.asks.some((a: any) => a.what === 'report'), r.body.pass.report);
  await db.doc(`${T}/parties/p1`).set({ nudges: { [`ask:${ask.id}`]: { at: new Date().toISOString(), by: 'Sam Lee' } } }, { merge: true });
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'view' }));
  check('…once someone has it, by first name', r.body.pass.report.mine.seen && r.body.pass.report.mine.said === 'Thanks for telling us. Sam is coming over.');
  check('…while it’s being seen to, only an allergic reaction can be sent as well', r.body.pass.report.reasons.length > 0 && r.body.pass.report.reasons.every((x: any) => x.safety));
  await db.doc(`${T}/parties/p1`).set({ nudges: { [`ask:${ask.id}`]: { at: rago(20), by: 'Sam Lee' } } }, { merge: true });
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'view' }));
  check('…a while after someone had it, they can tell us again', r.body.pass.report.mine === null && r.body.pass.report.reasons.length > 2);
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'report', reasonId: 'wait', words: 'Still waiting on the bream' }));
  v1 = await get(`${T}/appointments/v1`); let c1n: any = await get(`${T}/cases/${c1.id}`);
  check('…another report joins the same case', r.body.ok && !r.body.already && v1.guestReports.length === 2 && v1.guestReport.caseId === c1.id && (await all(`${T}/cases`)).length === 1
    && c1n.timeline.some((x: any) => x.text === 'Their table’s page again: Waited too long. “Still waiting on the bream”'), { body: r.body, tl: c1n.timeline });
  r = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'report', reasonId: 'allergy', words: 'Itchy throat' }));
  c1n = await get(`${T}/cases/${c1.id}`);
  check('…and an allergic reaction is taken straight after, making it a safety case and calling the managers', r.body.ok && !r.body.already && r.body.report.safety && c1n.safety && c1n.needsManager
    && (await all(`${T}/notifications`)).some((n: any) => n.caseId === c1.id && n.type === 'case_safety' && n.userId === 'owner1'), { body: r.body, safety: c1n.safety });
  const tap2: any = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'report', reasonId: 'allergy', words: 'Itchy throat' }));
  const vw: any = await P.POST(req({ tenantId: 't1', token: TOK1, action: 'view' }));
  check('…tapped again: the same one, already on its way (and nothing more to send meanwhile)', tap2.body.ok && tap2.body.already && (await get(`${T}/appointments/v1`)).guestReports.length === 3 && vw.body.pass.report.reasons.length === 0, tap2.body);
  await db.doc(`${T}/appointments/v5`).set({ id: 'v5', isTable: true, tableName: '20', status: 'servicing', payToken: 'defghijklmnopqrstuvwxy', tab: [],
    guestReport: { at: rago(1), askId: 'zzzz9999', reasonId: 'service', label: 'Service', dish: null, words: null, safety: false, caseId: null }, guestAsks: [{ id: 'zzzz9999', what: 'report', at: rago(1), item: 'Service' }] });
  r = await P.POST(req({ tenantId: 't1', token: 'defghijklmnopqrstuvwxy', action: 'report', reasonId: 'service' }));
  const v5: any = await get(`${T}/appointments/v5`);
  check('a report whose case didn’t open the first time: opened when they tap again', r.body.ok && r.body.already && !!v5.guestReport.caseId && !!(await get(`${T}/cases/${v5.guestReport.caseId}`)), v5.guestReport);
  {
    const RS0 = await import('../../src/lib/table-recovery-server');
    await db.doc(`${T}/appointments/v9`).set({ id: 'v9', isTable: true, tableName: '21', status: 'servicing', payToken: 'fghijklmnopqrstuvwxyza', tab: [] });
    const c9 = await RS0.caseForVisit(db, 't1', { staffId: 'm1', name: 'Sam Lee', role: 'manager', isManager: true, isOwner: false, portal: false, caps: [] }, 'v9', { via: 'floor', reasonId: 'wait', words: 'Late mains' });
    await db.doc(`${T}/appointments/v9`).set({ guestReport: { at: rago(1), askId: 'xxxx7777', reasonId: 'food', label: 'Food wasn’t right', dish: null, words: 'Cold', safety: false, caseId: null }, guestAsks: [{ id: 'xxxx7777', what: 'report', at: rago(1), item: 'Food wasn’t right' }] }, { merge: true });
    const rr: any = await P.POST(req({ tenantId: 't1', token: 'fghijklmnopqrstuvwxyza', action: 'report', reasonId: 'food' }));
    const cc: any = await get(`${T}/cases/${(c9 as any).id}`);
    check('…and when a case was opened at that table meanwhile, the report joins it, on its timeline', rr.body.already && (await get(`${T}/appointments/v9`)).guestReport.caseId === (c9 as any).id && cc.timeline.some((x: any) => /Their table’s page again: Food wasn’t right/.test(x.text)), cc.timeline);
  }
  r = await P.POST(req({ tenantId: 't1', token: TOK3, action: 'report', reasonId: 'allergy', words: 'Lips swelling' }));
  const v3: any = await get(`${T}/appointments/v3`); const c3 = (await all(`${T}/cases`)).find((c: any) => c.id === v3.guestReport.caseId);
  const notes3 = (await all(`${T}/notifications`)).filter((n: any) => n.caseId === c3?.id);
  check('an allergic reaction: a safety case, the managers called at once, and the page says to call 911', r.body.report.safety && c3?.safety && notes3.some((n: any) => n.type === 'case_safety' && n.userId === 'owner1') && R.SAFETY_WORDS.includes('call 911'), { c3, notes3 });

  console.log('the host stand');
  const FS = await import('../../src/lib/floor-server');
  const Floor = await import('../../src/app/api/host/floor/route');
  // One more table with an everyday report someone has seen to.
  await db.doc(`${T}/serviceSessions/s1`).set({ units: [{ id: 'u5', name: '5', staffIds: ['m1'] }, { id: 'u12', name: '12', staffIds: [] }, { id: 'u7', name: '7', staffIds: [] }, { id: 'u9', name: '9', staffIds: [] }] }, { merge: true });
  await seat('v8', 'p8', 'u9', 'efghijklmnopqrstuvwxyz', [RL('a', 'Burrata', 2, 5, 600, { kdsId: 'k_a8' })], { k_a8: 'delivered' });
  await db.doc(`${T}/appointments/v8`).set({ guestReport: { at: rago(3), askId: 'yyyy8888', reasonId: 'service', label: 'Service', dish: null, words: null, safety: false, caseId: null }, guestAsks: [{ id: 'yyyy8888', what: 'report', at: rago(3), item: 'Service' }] }, { merge: true });
  await db.doc(`${T}/parties/p8`).set({ nudges: { 'ask:yyyy8888': { at: rago(2), by: 'Dee Park' } } }, { merge: true });
  FS.forgetFloor('t1');
  r = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  let tr = r.body.troubles || [];
  const t5 = tr.find((t: any) => t.partyId === 'p1'); const t9 = tr.find((t: any) => t.partyId === 'p8'); const t12 = tr.find((t: any) => t.partyId === 'p2');
  check('tables that need someone, allergic reactions first: Table 5’s latest, Table 7’s, then Table 9 (Dee is on it), then food late past the business’s minutes', tr.length === 4 && tr[0].safety && tr[1].safety && t5?.text === 'Table 5 says something isn’t right: Allergic reaction.' && t5.caseId === c1.id
    && t9?.text === 'Table 9 says something isn’t right: Service. Dee is on it.' && t9.caseId === null && tr[3] === t12 && t12.kind === 'late' && t12.text === 'Table 12 has waited 20 min longer than usual for its mains.' && t12.caseId === null, tr);
  await db.doc(T).set({ kitchenSettings: { recovery: { hostLateMin: 25 } } }, { merge: true }); FS.forgetFloor('t1');
  r = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  check('…late food only once it’s later than the business says', !(r.body.troubles || []).some((t: any) => t.kind === 'late'));
  await db.doc(T).set({ kitchenSettings: { recovery: { hostLateMin: 10 } } }, { merge: true });
  await db.doc(`${T}/parties/p8`).set({ nudges: { 'ask:yyyy8888': { at: rago(16), by: 'Dee Park' } } }, { merge: true });
  const p1ask = (await get(`${T}/appointments/v1`)).guestReport.askId;
  await db.doc(`${T}/parties/p1`).set({ nudges: { [`ask:${p1ask}`]: { at: rago(16), by: 'Sam Lee' } } }, { merge: true }); FS.forgetFloor('t1');
  r = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  tr = r.body.troubles || [];
  check('…an everyday report someone has had a quarter of an hour leaves the host stand (it stays on the case); an allergic reaction stays while they’re seated', !tr.some((t: any) => t.partyId === 'p8') && tr.some((t: any) => t.partyId === 'p1' && t.safety), tr);
  r = await Floor.POST(req({ tenantId: 't1', action: 'make_right', partyId: 'p8' }));
  check('…Make it right on a report whose case never opened: opened now, with what they told us', r.body.ok && r.body.opened && /Table 9 told us: Service\./.test((await get(`${T}/cases/${r.body.caseId}`)).words));
  r = await Floor.POST(req({ tenantId: 't1', action: 'make_right', partyId: 'p2' }));
  const v2: any = await get(`${T}/appointments/v2`); const c2 = (await all(`${T}/cases`)).find((c: any) => c.id === r.body.caseId);
  check('Make it right on a late table: a case for the visit, waited too long, in the host’s name', r.body.ok && r.body.opened && v2.makeRightCaseId === r.body.caseId && c2?.reasonId === 'wait' && c2.via === 'floor' && /waited 20 min longer than usual for its mains/.test(c2.words) && c2.reportedBy?.name === 'Sam Lee', { body: r.body, c2 });
  const again: any = await Floor.POST(req({ tenantId: 't1', action: 'make_right', partyId: 'p2' }));
  r = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  check('…again: the same case; the host stand now opens it', again.body.ok && !again.body.opened && again.body.caseId === c2.id && r.body.troubles.find((t: any) => t.partyId === 'p2')?.caseId === c2.id);
  const gone: any = await Floor.POST(req({ tenantId: 't1', action: 'make_right', partyId: 'nobody' }));
  check('…only a table that’s seated', gone.status === 404);

  console.log('comps, voids and remakes on the case');
  const Tab = await import('../../src/app/api/tab/route');
  r = await Tab.POST(req({ tenantId: 't1', action: 'comp', visitId: 'v2', lineId: 'e', reason: 'Took too long', all: true }));
  let c2b: any = await get(`${T}/cases/${c2.id}`);
  check('a comp for food that took too long: on the table’s case, its fix “Made right at the table” chosen (a person still closes it)', r.body.ok && c2b.tableFixes?.length === 1 && c2b.tableFixes[0].kind === 'comp' && c2b.tableFixes[0].amount === 20
    && c2b.timeline.some((x: any) => x.text === 'Comped Burger, $20.00: Took too long') && c2b.fix?.label === 'Made right at the table' && c2b.fix.amountCents === 2000 && c2b.status === 'fix_chosen' && !c2b.ownerId, { body: r.body, c2b });
  const before = (await all(`${T}/cases`)).length;
  await db.doc(`${T}/appointments/v4`).set({ id: 'v4', isTable: true, tableName: '9', status: 'servicing', tab: [RL('a', 'Burrata', 2, 5, 600, { kdsId: 'k_a4' }), RL('e', 'Burger', 3, 5, 600, { kdsId: 'k_e4' })] });
  await db.doc(`${T}/kdsTickets/k_a4`).set({ id: 'k_a4', visitId: 'v4', status: 'delivered' }); await db.doc(`${T}/kdsTickets/k_e4`).set({ id: 'k_e4', visitId: 'v4', status: 'delivered' });
  r = await Tab.POST(req({ tenantId: 't1', action: 'comp', visitId: 'v4', lineId: 'a', reason: 'A regular', all: true }));
  check('a comp for a regular: no case', r.body.ok && (await all(`${T}/cases`)).length === before && !(await get(`${T}/appointments/v4`)).makeRightCaseId, r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'comp', visitId: 'v4', lineId: 'e', reason: 'Not right', all: true }));
  const v4: any = await get(`${T}/appointments/v4`); const c4: any = v4.makeRightCaseId ? await get(`${T}/cases/${v4.makeRightCaseId}`) : null;
  check('a comp for food that wasn’t right, at a table with no case: one is started by the team at the table (food wasn’t right), logged, fix chosen', r.body.ok && !!c4 && c4.reasonId === 'food' && c4.via === 'floor' && /by the team at the table/.test(c4.timeline[0].text) && c4.tableFixes.length === 1 && c4.status === 'fix_chosen' && c4.clientName === 'Table 9 guest', c4);
  await db.doc(`${T}/kdsTickets/k_b_r1`).set({ status: 'in_progress' }, { merge: true });
  r = await Tab.POST(req({ tenantId: 't1', action: 'remake', visitId: 'v1', lineId: 'b', reason: 'Not right' }));
  const c1b: any = await get(`${T}/cases/${c1.id}`);
  check('a remake at the table that reported it: on the guest’s own case, but not its fix (only a comp is)', r.body.ok && c1b.tableFixes?.[0]?.kind === 'remake' && c1b.timeline.some((x: any) => x.text === 'Made again: Steak frites: Not right') && !c1b.fix && c1b.status === 'heard', { body: r.body, c1b });
  const c3id = (await get(`${T}/appointments/v3`)).makeRightCaseId;
  r = await Tab.POST(req({ tenantId: 't1', action: 'comp', visitId: 'v3', lineId: 'a', reason: 'Not right', all: true }));
  const c3b: any = await get(`${T}/cases/${c3id}`);
  check('…a comp on a safety case is logged, and leaves the manager’s steps alone', r.body.ok && c3b.safety && c3b.tableFixes?.length === 1 && !c3b.fix && c3b.status === 'heard', c3b);
  const RS = await import('../../src/lib/table-recovery-server');
  await db.doc(`${T}/appointments/v6`).set({ id: 'v6', isTable: true, tableName: '14', status: 'servicing', tab: [] });
  const who: any = { staffId: 'client', name: 'The table', role: 'client', isManager: false, isOwner: false, portal: false, caps: [] };
  const n0 = (await all(`${T}/cases`)).length;
  const both = await Promise.all([RS.caseForVisit(db, 't1', who, 'v6', { via: 'table', reasonId: 'food', words: 'x' }), RS.logTableFix(db, 't1', { id: 'm1', name: 'Sam Lee' }, 'v6', { kind: 'comp', item: 'Burger', amount: 10, reason: 'Took too long' })]);
  const c6: any = await get(`${T}/cases/${(both[0] as any).id}`);
  check('a report and a comp at the same table at the same moment: one case, with both', (both[0] as any).ok && both[1] === (both[0] as any).id && (await all(`${T}/cases`)).length === n0 + 1 && c6.tableFixes?.length === 1, { both, n: (await all(`${T}/cases`)).length - n0 });

  console.log('turned off');
  await db.doc(T).set({ kitchenSettings: { recovery: { report: false } } }, { merge: true });
  await db.doc(`${T}/appointments/v2`).set({ guestReport: null }, { merge: true });
  r = await P.POST(req({ tenantId: 't1', token: TOK2, action: 'view' }));
  const off: any = await P.POST(req({ tenantId: 't1', token: TOK2, action: 'report', reasonId: 'food' }));
  check('“Something not right?” off: not on the page, and not taken', r.body.ok && r.body.pass.report === null && off.status === 403, [r.body.pass.report, off.body]);

  console.log('the settings, saved');
  const Menu = await import('../../src/app/api/menu/route');
  r = await Menu.POST(req({ tenantId: 't1', action: 'service', recovery: { sorry: true, report: true, hostLateMin: 15 } }));
  check('saved and given back', r.body.ok && (await get(T)).kitchenSettings.recovery.hostLateMin === 15 && r.body.service?.recovery?.hostLateMin === 15, r.body);
  r = await Menu.POST(req({ tenantId: 't1', action: 'service', recovery: { hostLateMin: 90 } }));
  check('…nonsense isn’t, and says why', r.status === 400 && /When something goes wrong/.test(r.body.error));

  console.log('the screens');
  const bill = src('src/app/bill/[tenantId]/[token]/page.tsx'); const host = src('src/app/(app)/host/page.tsx'); const set = src('src/components/menu/TableServiceSettings.tsx');
  check('the table’s page: sorry on its own, a quiet “Something not right?”, private, with the safety line for an allergic reaction', bill.includes('Something not right?') && bill.includes('Only our team sees this. A manager comes over.') && bill.includes('Tell a manager') && /SAFETY_WORDS/.test(bill) && /pass\.sorry/.test(bill));
  check('the host stand: each table that needs someone, with its case or one tap to start one', /floor\?\.troubles/.test(host) && host.includes('Make it right') && host.includes('Open the case') && /action: 'make_right'/.test(host));
  check('the settings: When something goes wrong', set.includes('When something goes wrong') && set.includes('Say sorry on the table’s page') && set.includes('Tell the host when food is late by') && /recovery/.test(set));
  check('cases say where a table’s came from', /table: 'Their table’s page'/.test(src('src/app/(app)/cases/page.tsx')) && /table: 'Their table’s page'/.test(src('src/lib/case-pdf.ts')));
  const mine = src('src/lib/table-recovery.ts') + src('src/lib/table-recovery-server.ts');
  check('house style in the new code', !/salon|stylist|booth|chair/i.test(mine) && !/uppercase|font-black/.test(mine + bill));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
