// Checks the host stand's floor and the wait list from the guest's phone (L20 round 5): lib/table-stage, lib/seat-next,
// lib/wait-line, lib/floor-server, api/host/floor, api/wait, api/host/notify, api/tab 'check', the host stand, My
// tables, the guest's page and the settings.
// - Each table's stage (just seated, cooking, at the pass, a course out and another to fire, the check, paid) and when
//   it's likely free: the business's usual stay for that party size, never sooner than what's left of the meal, plus
//   clearing. A table just left is "being cleared" for the business's clearing time.
// - Who to seat next: overdue first, then whoever's been told it's ready, then the business's rule (longest wait or
//   best fit), the lighter section when two tables fit; a nearly-ready table is held and the party texted.
// - The guest's link: their place in line and wait from the same floor; more time as often as allowed (a held table
//   goes to the next party); leaving (drinks already at the bar come off); a drink from the business's drinks only,
//   priced from the menu, going on the tab when they sit (or when we text them), once.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/floor-wait.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let manager = true; let signedIn = true;
let actor: any = { uid: 's1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
const texts: { to: string; body: string; kind?: string }[] = []; let smsOk = true;
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => (signedIn ? { ok: true, actor, tenant: {} } : { ok: false, error: 'Sign in to do that.', status: 401 }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (!signedIn ? { deny: { status: 401, body: { ok: false, error: 'Please sign in again.' } } }
      : level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager }, tenant: {} }),
    requireCan: async () => ({ actor }),
  };
  if (request === '@/lib/sms') return { sendTenantSms: async (_db: any, _t: string, to: string, body: string, _f: any, meta: any) => { texts.push({ to, body, kind: meta?.kind }); return smsOk ? { ok: true, via: 'sms' } : { ok: false }; } };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const NOW = Date.parse('2026-11-14T20:00:00.000Z');
const ago = (min: number, from = NOW) => new Date(from - min * 60000).toISOString();

(async () => {
  const TS = await import('../../src/lib/table-service');
  const ST = await import('../../src/lib/table-stage');
  console.log('where each table is in its meal');
  const S = ST.floorSettingsOf({});
  check('the usual times, the business’s own within range', S.turnSmall === 50 && S.turnMid === 65 && S.turnLarge === 80 && S.payMin === 10 && S.clearMin === 3 && S.seatOrder === 'longest' && S.balance && S.textAheadMin === 5
    && ST.floorSettingsOf({ hostingSettings: { floor: { turnSmall: 30, clearMin: 0, payMin: 999, seatOrder: 'fit', balance: false, textAheadMin: '8' } } }).turnSmall === 30
    && ST.cleanFloor({ clearMin: 0 }).clearMin === 0 && ST.cleanFloor({ payMin: 999 }).payMin === 10 && ST.cleanFloor({ seatOrder: 'random' }).seatOrder === 'longest' && ST.cleanFloor({ textAheadMin: '8' }).textAheadMin === 8 && ST.cleanFloor({ balance: false }).balance === false);
  check('a party’s usual stay by its size', ST.turnFor(2, S) === 50 && ST.turnFor(4, S) === 65 && ST.turnFor(7, S) === 80 && ST.turnFor(0, S) === 50);
  const courses = TS.coursesOf({});
  const line = (id: string, course: number, o: any = {}) => ({ lineId: id, course, courseName: courses.find((c) => c.n === course)?.name, firedAt: ago(20), kdsId: `k_${id}`, ...o });
  const st = (o: any) => ST.tableStage({ seatedAt: ago(30), size: 4, tab: [], tickets: {}, courses, ...o }, S, NOW);
  let x = st({ seatedAt: ago(2) });
  check('just seated: free when the usual stay is up, plus clearing', x.key === 'seated' && x.words === 'Just seated' && x.step === 1 && x.freeIn === 63 + 3, x);
  x = st({ seatedAt: ago(9) });
  check('…seated a while with nothing ordered, said so', x.key === 'no_order' && x.words === 'Seated 9 min, nothing ordered', x);
  x = st({ tab: [line('s1', 2), line('m1', 3, { firedAt: ago(4) })], tickets: { k_s1: { status: 'delivered' }, k_m1: { status: 'in_progress' } } });
  check('a course cooking (the latest), after something’s out', x.key === 'cooking' && x.words === 'Mains cooking' && x.step === 3 && x.freeIn === 35 + 3, x);
  x = st({ tab: [line('m1', 3)], tickets: { k_m1: { status: 'ready' } } });
  check('…waiting at the pass', x.key === 'at_pass' && x.words === 'Mains at the pass');
  x = st({ tab: [line('s1', 2), line('m1', 3, { firedAt: null })], tickets: { k_s1: { status: 'delivered' }, k_m1: { status: 'unfired' } } });
  check('a course out, the next one still to fire', x.key === 'between' && x.words === 'Starters out, mains to fire', x);
  x = st({ tab: [line('m1', 3, { firedAt: null })], tickets: { k_m1: { status: 'unfired' } } });
  check('ordered, nothing fired yet', x.key === 'ordered' && x.step === 2);
  x = st({ seatedAt: ago(70), tab: [line('m1', 3), line('d1', 4)], tickets: { k_m1: { status: 'delivered' }, k_d1: { status: 'delivered' } } });
  check('dessert out, past the usual stay: nearly done, and not sooner than the check takes', x.key === 'eating' && x.words === 'Dessert out' && x.step === 4 && x.over === 5 && x.freeIn === 10 + 3, x);
  x = st({ seatedAt: ago(70), tab: [line('m1', 3, { firedAt: ago(2) })], tickets: { k_m1: { status: 'in_progress' } } });
  check('…but food still cooking past the usual stay still needs eating and the check', x.freeIn === ST.EAT_MIN + 10 + 3, x);
  x = st({ checkAt: ago(4), tab: [line('m1', 3)], tickets: { k_m1: { status: 'delivered' } } });
  check('asked for the check: free when the check usually takes, plus clearing', x.key === 'check' && x.words === 'Asked for the check 4 min ago' && x.step === 5 && x.freeIn === 6 + 3, x);
  x = st({ checkAt: ago(4), paidAt: ago(1) });
  check('paid, leaving soon; a while after paying, said so', x.key === 'paid' && x.words === 'Paid, leaving soon' && x.freeIn === 2 + 3 && st({ paidAt: ago(7) }).words === 'Paid 7 min ago' && st({ paidAt: ago(7) }).freeIn === 3);
  x = st({ seatedAt: ago(9), tab: [line('w1', 1, { note: 'Ordered while waiting' })], tickets: { k_w1: { status: 'delivered' } } });
  check('drinks from the wait list aren’t the table ordering: still “nothing ordered”', x.key === 'no_order', x);
  x = st({ tab: [line('w1', 1), line('m1', 3, { firedAt: ago(4) })], tickets: { k_w1: { status: 'ready' }, k_m1: { status: 'in_progress' } } });
  check('a drink at the pass while mains cook says mains cooking', x.key === 'cooking' && x.words === 'Mains cooking', x);
  check('lingering: asked for the check longer ago than it usually takes, or paid a while ago', st({ checkAt: ago(12) }).lingering && !st({ checkAt: ago(4) }).lingering && st({ paidAt: ago(7) }).lingering);
  const NU = await import('../../src/lib/nudges');
  const nt = (tab: any[], tickets: any, allergies: any[] = []) => ({ visitId: 'v', partyId: 'p', table: 'Table 4', seatedAt: ago(10), tab, tickets, allergies, done: {}, courses });
  let nn = NU.nudgesFor(nt([{ ...line('w1', 1, { note: 'Ordered while waiting' }), name: 'Negroni' }], { k_w1: { status: 'ready', readyAt: ago(4) } }, [{ id: 'a', seat: null, keys: ['milk'], other: null, severe: false, from: 'asked', by: '', at: '' }]), NU.nudgeSettingsOf({}), NOW);
  check('…and the server’s phone still says nothing’s ordered and the allergy, besides the drink at the pass', nn.some((n) => n.kind === 'no_order' && /just drinks from the wait list/.test(n.text)) && nn.some((n) => n.kind === 'allergy') && nn.some((n) => n.kind === 'at_pass'), nn);
  check('a table just left is being cleared for the business’s time, then ready; not at all where tables are ready right away',
    ST.clearingStage(ago(1), S, NOW)?.freeIn === 2 && ST.clearingStage(ago(1), S, NOW)?.words === 'Being cleared' && ST.clearingStage(ago(3), S, NOW) === null && ST.clearingStage(ago(1), { ...S, clearMin: 0 }, NOW) === null);
  check('“Free about 9:05”, in the business’s time; soon is “any minute”', ST.freeWords(65, NOW, 'America/New_York') === 'Free about 4:05 PM' && ST.freeWords(1, NOW) === 'Free any minute' && ST.freeWords(null, NOW) === '');

  const SN = await import('../../src/lib/seat-next');
  console.log('who to seat next');
  const units = [{ id: 'u11', name: '11', seatCount: 4, staffIds: ['s3'] }, { id: 'u6', name: '6', seatCount: 4, staffIds: ['s1'] }, { id: 'u2', name: '2', seatCount: 2, staffIds: ['s2'], tags: ['window'] },
    { id: 'u4', name: '4', seatCount: 2, staffIds: ['s2'] }, { id: 'u14', name: '14', seatCount: 6, staffIds: [] }];
  const P = (id: string, o: any) => ({ id, sessionId: 's1', name: id, size: 2, needs: [], status: 'waiting', joinedAt: ago(5), quotedMinutes: null, notifiedAt: null, seatedAt: null, finishedAt: null, unitIds: [], guestIds: [], ...o });
  const parties: any[] = [
    P('Okafor', { status: 'seated', size: 4, unitIds: ['u6'], seatedAt: ago(60) }), P('Lopez', { status: 'seated', size: 2, unitIds: ['u4'], seatedAt: ago(20) }),
    P('Gone', { status: 'finished', size: 4, unitIds: ['u11'], seatedAt: ago(70), finishedAt: ago(1) }),
    P('Reyes', { status: 'expected', size: 6, arrivesAt: new Date(NOW + 20 * 60000).toISOString(), unitIds: ['u14'] }),
    P('Chris', { size: 4, joinedAt: ago(9), phone: '+15550001111' }), P('Ana', { size: 2, joinedAt: ago(3) }), P('Dee', { size: 2, joinedAt: ago(1) }), P('Eve', { size: 2, joinedAt: ago(0.5) }),
  ];
  const stages: any = { u6: { ...ST.tableStage({ seatedAt: ago(60), size: 4, tab: [], tickets: {}, courses, paidAt: ago(1) }, S, NOW) }, u4: ST.tableStage({ seatedAt: ago(20), size: 2, tab: [line('m1', 3)], tickets: { k_m1: { status: 'in_progress' } }, courses }, S, NOW) };
  const tables = SN.floorTables(units, parties, stages, S, NOW, { holdBeforeMinutes: 30, holdGraceMinutes: 15 });
  const tb = (id: string) => tables.find((t) => t.id === id)!;
  check('the floor: free now, being cleared, seated with its stage’s free time, held for a booking', tb('u2').freeIn === 0 && !tb('u2').occupied && tb('u11').clearing && tb('u11').freeIn === 2
    && tb('u6').occupied && tb('u6').freeIn === 5 && tb('u4').freeIn === stages.u4.freeIn && tb('u14').heldFor === 'Reyes', tables);
  const loads = SN.staffLoads(units, parties, { s1: 'Sam', s2: 'Jo', s3: 'Rae' });
  check('guests in each section', loads.s1.guests === 4 && loads.s2.guests === 2 && loads.s3.guests === 0 && loads.s3.name === 'Rae');
  const seatP = (p: any) => ({ id: p.id, name: p.id, size: p.size, needs: p.needs || [], status: p.status, joinedAt: p.joinedAt, quotedMinutes: p.quotedMinutes, notifiedAt: p.notifiedAt, laterUntil: p.laterUntil || null, mirrored: !!p.mirrored });
  let w = parties.filter((p) => ['waiting', 'notified'].includes(p.status)).map(seatP);
  let n = SN.seatNext(tables, w, loads, S, NOW);
  const sg = (id: string) => n.now.find((s) => s.partyId === id);
  check('a free table goes to whoever’s waited longest that it fits: Ana at 2 now', sg('Ana')?.tableId === 'u2' && sg('Ana')?.action === 'seat', n);
  check('a nearly-ready table, held and texted: Chris at 11 (being cleared), with the reasons', sg('Chris')?.tableId === 'u11' && sg('Chris')?.action === 'hold'
    && sg('Chris')!.reasons.includes('11 is being cleared') && sg('Chris')!.reasons.some((r) => /Rae has the fewest guests, and 11 is hers|Rae has the fewest guests, and 11 is theirs/.test(r)), sg('Chris'));
  check('…a paid table nearly ready for the next: Dee at 6; not a table held for a booking', sg('Dee')?.tableId === 'u6' && sg('Dee')?.action === 'hold' && sg('Dee')!.reasons[0] === '6: Paid, leaving soon' && !n.now.some((s) => s.tableId === 'u14'), n.now);
  check('…the rest of the list, with the table likely next for them', n.later.length === 1 && n.later[0].partyId === 'Eve' && n.later[0].tables[0] === '4' && n.later[0].freeIn === tb('u4').freeIn && n.freeSoon === 3, n.later);
  // Overdue first; told it's ready next.
  w = [seatP(P('Old', { size: 2, joinedAt: ago(30) })), seatP(P('Quoted', { size: 2, joinedAt: ago(12), quotedMinutes: 10 }))];
  n = SN.seatNext([tb('u2')], w, loads, S, NOW);
  check('someone told about 10 minutes who’s waited 12 comes before a longer wait, and says why', n.now[0].partyId === 'Quoted' && n.now[0].reasons[0] === 'Told about 10 min, it’s been 12', n.now);
  w = [seatP(P('Old', { size: 2, joinedAt: ago(30) })), seatP(P('Told', { size: 2, joinedAt: ago(5), status: 'notified', notifiedAt: ago(2) }))];
  n = SN.seatNext([tb('u2')], w, loads, S, NOW);
  check('…someone already told it’s ready comes before the longest wait', n.now[0].partyId === 'Told' && n.now[0].reasons[0] === 'Told it’s ready 2 min ago');
  const six = { ...tb('u14'), heldFor: null };
  w = [seatP(P('Two', { size: 2, joinedAt: ago(10) })), seatP(P('Six', { size: 6, joinedAt: ago(4) }))];
  check('longest wait: the 2 at the 6-top; best fit: the 6, no empty seats', SN.seatNext([six], w, loads, S, NOW).now[0].partyId === 'Two'
    && SN.seatNext([six], w, loads, { ...S, seatOrder: 'fit' }, NOW).now[0].partyId === 'Six' && SN.seatNext([six], w, loads, { ...S, seatOrder: 'fit' }, NOW).now[0].reasons.includes('6 at a table for 6, no empty seats'));
  const eight = { ...six, id: 'u8', name: '8', capacity: 8 };
  const twoSoon = { ...tb('u4'), freeIn: 3, occupied: true };
  check('a 2 waits 3 minutes for a 2-top rather than taking a free 8-top', SN.seatNext([eight, twoSoon], [seatP(P('Pair', { size: 2, joinedAt: ago(6) }))], loads, S, NOW).now[0]?.tableId === 'u4');
  w = [seatP(P('Win', { size: 2, needs: ['window'] }))];
  n = SN.seatNext(tables, w, loads, S, NOW);
  check('what they asked for: only a table that has it, and said', n.now[0]?.tableId === 'u2' && n.now[0].reasons.includes('window, as they asked'));
  w = [seatP(P('Later', { size: 2, laterUntil: new Date(NOW + 5 * 60000).toISOString() }))];
  check('someone who asked for more time isn’t suggested until then', SN.seatNext(tables, w, loads, S, NOW).now.length === 0);
  w = [seatP(P('Kiosk', { size: 4, mirrored: true }))];
  check('a lobby-queue guest for a nearly-ready table: no hold and text here (the queue texts its own)', SN.seatNext([tb('u11')], w, loads, S, NOW).now[0]?.action === 'soon');
  check('only free tables when the business doesn’t text ahead', SN.seatNext(tables, [seatP(P('Chris', { size: 4 }))], loads, { ...S, textAheadMin: 0 }, NOW).now.length === 0);
  const holds = SN.waitHolds([P('H', { status: 'notified', holdUnitId: 'u2', holdUntil: new Date(NOW + 60000).toISOString() }), P('Old', { holdUnitId: 'u4', holdUntil: ago(1) })], NOW);
  check('a texted party’s hold lasts until its time; then it’s gone', holds.u2?.partyId === 'H' && !holds.u4);
  const heldT = SN.floorTables(units, [...parties, P('H', { size: 2, status: 'notified', holdUnitId: 'u2', holdUntil: new Date(NOW + 60000).toISOString() })], stages, S, NOW);
  n = SN.seatNext(heldT, [seatP(P('Ana', { size: 2, joinedAt: ago(20) })), seatP(P('H', { size: 2, status: 'notified', joinedAt: ago(2) }))], loads, S, NOW);
  check('a table held for them is theirs, ahead of a longer wait', n.now.find((s) => s.tableId === 'u2')?.partyId === 'H' && n.now.find((s) => s.tableId === 'u2')!.reasons[0] === '2 is held for them');

  const WL = await import('../../src/lib/wait-line');
  console.log('their place in line');
  const WS = WL.waitSettingsOf({});
  check('the wait list from their phone is off until the business turns it on; the rest in range',
    !WS.link && !WS.preorder && WS.holdMin === 10 && WS.moreTimes === 1 && WS.moreMin === 10 && WS.drinksWhen === 'seated' && WS.sections.length === 0
    && WL.cleanWait({ link: true, holdMin: 99, moreTimes: 2, moreMin: 4, drinksWhen: 'ready', sections: ['Cocktails', 'cocktails ', 'Wine'] }).sections.length === 2 && WL.cleanWait({ holdMin: 99 }).holdMin === 10 && WL.cleanWait({ drinksWhen: 'ready' }).drinksWhen === 'ready');
  const line2 = [tb('u2'), tb('u4'), tb('u11'), tb('u6')];
  const wq = (id: string, size: number, joined: number, o: any = {}) => ({ id, size, status: 'waiting', joinedAt: ago(joined), ...o });
  const q = [wq('A', 2, 10), wq('B', 2, 8), wq('C', 2, 6), wq('D', 2, 4), wq('E', 2, 2), wq('F', 6, 1)];
  let lp = WL.linePlace(q[0], line2, q, S);
  check('first in line for 2: the table free now', lp.place === 1 && lp.ahead === 0 && lp.minutes === 0);
  lp = WL.linePlace(q[2], line2, q, S);
  const frees = line2.filter((t) => t.capacity >= 2).map((t) => t.freeIn as number).sort((a, b) => a - b);
  check('third in line: the third table to be ready', lp.place === 3 && lp.minutes === frees[2], { lp, frees });
  lp = WL.linePlace(q[4], line2, q, S);
  check('more people ahead than tables: a table’s next turn', lp.place === 5 && lp.minutes === frees[0] + S.turnSmall + S.clearMin, lp);
  lp = WL.linePlace(wq('Four', 4, 9), line2, [wq('Two', 2, 12, { status: 'notified' }), wq('Four', 4, 9)], S);
  check('…the party ahead takes the table that suits them (the 2-top), not the 4-top this party needs', lp.place === 2 && lp.minutes === tb('u11').freeIn, lp);
  lp = WL.linePlace(wq('H', 2, 1), [tb('u2'), { ...tb('u6'), heldFor: 'H' }], [wq('A', 2, 10), wq('H', 2, 1)], S);
  check('…a table held for them is theirs, whoever else is waiting', lp.place === 1 && lp.ahead === 0 && lp.minutes === tb('u6').freeIn, lp);
  lp = WL.linePlace(q[5], line2, q, S);
  check('nothing seats them: no time made up', lp.minutes === null);
  lp = WL.linePlace(wq('G', 2, 0), line2, [...q, wq('N', 2, 0.5, { status: 'notified', joinedAt: ago(0) })], S);
  check('someone already called counts ahead', lp.ahead === 6, lp);
  lp = WL.linePlace(wq('C', 2, 6), line2, [...q.slice(0, 2).map((p, i) => (i === 0 ? { ...p, laterUntil: new Date(NOW + 10 * 60000).toISOString() } : p)), ...q.slice(2)], S, NOW);
  const lpLater = WL.linePlace({ ...q[0], laterUntil: new Date(NOW + 10 * 60000).toISOString() }, line2, q, S, NOW);
  check('someone who asked for more time goes behind everyone ready, and waits at least until then', lp.place === 2 && lpLater.place === 5 && (lpLater.minutes as number) >= 10, { lp, lpLater });
  check('said plainly', WL.placeWords({ place: 1, ahead: 0, minutes: 0 }) === 'You’re next' && WL.placeWords({ place: 2, ahead: 1, minutes: 5 }) === '2nd in line' && WL.ordinal(3) === '3rd' && WL.ordinal(11) === '11th' && WL.ordinal(22) === '22nd'
    && WL.minutesWords(1) === 'Any minute now' && WL.minutesWords(7) === 'About 7 minutes' && WL.minutesWords(17) === 'About 15 minutes' && WL.minutesWords(null) === 'We’ll text you when it’s ready');
  check('more time: as often as the business allows, from the later of now and their last one',
    WL.moreTime({ status: 'waiting' }, WS, NOW).ok && (WL.moreTime({ status: 'waiting', laterUntil: new Date(NOW + 5 * 60000).toISOString() }, WS, NOW) as any).until === new Date(NOW + 15 * 60000).toISOString()
    && !WL.moreTime({ status: 'waiting', laterCount: 1 }, WS, NOW).ok && !WL.moreTime({ status: 'waiting' }, { ...WS, moreTimes: 0 }, NOW).ok && !WL.moreTime({ status: 'seated' }, WS, NOW).ok);
  const drinkP = { id: 'neg', name: 'Negroni', price: 14 };
  let pre = WL.addPreorder([], drinkP, ago(0)); pre = WL.addPreorder((pre as any).lines, drinkP, ago(0));
  check('a drink twice is one line of 2; one fewer; limits per drink and in all', (pre as any).lines.length === 1 && (pre as any).lines[0].qty === 2 && WL.removePreorder((pre as any).lines, 'neg')[0].qty === 1 && WL.removePreorder(WL.removePreorder((pre as any).lines, 'neg'), 'neg').length === 0
    && !WL.addPreorder([{ itemId: 'neg', name: 'Negroni', price: 14, qty: 4, at: '' }], drinkP, '').ok && !WL.addPreorder(Array.from({ length: 12 }, (_, i) => ({ itemId: `d${i}`, name: 'x', price: 1, qty: 1, at: '' })), drinkP, '').ok);
  check('which drinks: a drinks section, or the sections the business picked; nothing with choices to make', WL.isWaitDrink({ category: 'Cocktails' }, WS, TS.isDrinkItem) && !WL.isWaitDrink({ category: 'Mains' }, WS, TS.isDrinkItem)
    && !WL.isWaitDrink({ category: 'Coffee', choices: [{ name: 'Milk' }] }, WS, TS.isDrinkItem) && WL.isWaitDrink({ category: 'Zero proof' }, { ...WS, sections: ['zero proof'] }, TS.isDrinkItem) && !WL.isWaitDrink({ category: 'Cocktails' }, { ...WS, sections: ['Wine'] }, TS.isDrinkItem));
  check('their drinks, said', WL.preorderWords([{ itemId: 'a', name: 'Negroni', price: 14, qty: 1, at: '' }, { itemId: 'b', name: 'Aperol spritz', price: 13, qty: 2, at: '' }]) === 'Negroni, 2 Aperol spritz' && WL.preorderTotal([{ itemId: 'b', name: 'x', price: 13, qty: 2, at: '' }]) === 26);

  // ── The server ──────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('api/host/floor');
  const RN = Date.now(); const rago = (m: number) => ago(m, RN);
  await db.doc(T).set({ name: 'Linden', timezone: 'America/New_York', hostingSettings: { wait: { link: true, preorder: true } } });
  await db.doc(`${T}/serviceSessions/s1`).set({ status: 'open', opensAt: rago(120), units });
  await db.doc(`${T}/staff/s3`).set({ name: 'Rae Kim' });
  await db.doc(`${T}/parties/okafor`).set({ sessionId: 's1', status: 'seated', name: 'Okafor', size: 4, unitIds: ['u6'], seatedAt: rago(60), guestIds: [] });
  await db.doc(`${T}/appointments/apt-party-okafor`).set({ tableName: '6', status: 'completed', checkedOutAt: rago(1), tab: [] });
  await db.doc(`${T}/parties/lopez`).set({ sessionId: 's1', status: 'seated', name: 'Lopez', size: 2, unitIds: ['u4'], seatedAt: rago(20), guestIds: [] });
  await db.doc(`${T}/appointments/apt-party-lopez`).set({ tableName: '4', tab: [{ lineId: 'l1', name: 'Steak', price: 30, quantity: 1, course: 3, courseName: 'Mains', firedAt: rago(5), kdsId: 'k1' }] });
  await db.doc(`${T}/kdsTickets/k1`).set({ id: 'k1', visitId: 'apt-party-lopez', status: 'in_progress' });
  await db.doc(`${T}/parties/gone`).set({ sessionId: 's1', status: 'finished', name: 'Gone', size: 4, unitIds: ['u11'], seatedAt: rago(70), finishedAt: rago(1), guestIds: [] });
  await db.doc(`${T}/parties/chris`).set({ sessionId: 's1', status: 'waiting', name: 'Chris Day', size: 4, joinedAt: rago(9), phone: '+15550001111', needs: [], unitIds: [], guestIds: [] });
  await db.doc(`${T}/parties/ana`).set({ sessionId: 's1', status: 'waiting', name: 'Ana', size: 2, joinedAt: rago(3), needs: [], unitIds: [], guestIds: [] });
  await db.doc(`${T}/inventory/neg`).set({ name: 'Negroni', type: 'refreshment', category: 'Cocktails', msrp: 14, allergens: [] });
  await db.doc(`${T}/inventory/spritz`).set({ name: 'Aperol spritz', type: 'refreshment', category: 'Cocktails', msrp: 13, allergens: ['sulphites'] });
  await db.doc(`${T}/inventory/latte`).set({ name: 'Latte', type: 'refreshment', category: 'Coffee', msrp: 5, choices: [{ name: 'Milk', options: [] }] });
  await db.doc(`${T}/inventory/burger`).set({ name: 'Burger', type: 'refreshment', category: 'Mains', msrp: 18 });
  await db.doc(`${T}/inventory/wr`).set({ name: 'White Russian', type: 'refreshment', category: 'Cocktails', msrp: 12, allergens: ['milk'] });
  await db.doc(`${T}/inventory/lem`).set({ name: 'Lemonade', type: 'refreshment', category: 'Soft drinks', msrp: 5, allergens: [] });
  await db.doc(`${T}/inventory/gone86`).set({ name: 'Old fashioned', type: 'refreshment', category: 'Cocktails', msrp: 15, soldOut: true });
  const Floor = await import('../../src/app/api/host/floor/route');
  let r: any = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  check('each seated table’s stage and free time by table; who looks after which (first names); the settings', r.body.ok && r.body.stages.u6?.key === 'paid' && r.body.stages.u6.partyId === 'okafor'
    && r.body.stages.u4?.words === 'Mains cooking' && !r.body.stages.u11 && r.body.staff.s3 === 'Rae' && r.body.wait.link === true && r.body.floor.turnSmall === 50, r.body);
  signedIn = false;
  r = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  const rN: any = await (await import('../../src/app/api/host/notify/route')).POST(req({ tenantId: 't1', partyId: 'chris' }));
  check('signed in only, the floor and calling a party forward', r.status === 401 && rN.status === 401 && texts.length === 0);
  signedIn = true;

  r = await Floor.POST(req({ tenantId: 't1', action: 'link', partyId: 'chris' }));
  let c: any = await get(`${T}/parties/chris`);
  check('their own link, made once and texted (with a drink offered, when the business does)', r.body.ok && r.body.sent && /^[A-Za-z0-9_-]{20,40}$/.test(c.waitToken) && r.body.url === `https://app.test/wait/t1/${c.waitToken}`
    && texts.length === 1 && texts[0].to === '+15550001111' && texts[0].body === `Chris, you’re on the list at Linden. See your place in line and order a drink: ${r.body.url}` && !!c.linkSentAt, { body: r.body, texts });
  const token = c.waitToken;
  r = await Floor.POST(req({ tenantId: 't1', action: 'link', partyId: 'chris' }));
  check('…not texted twice, the same link', r.body.ok && !r.body.sent && texts.length === 1 && (await get(`${T}/parties/chris`)).waitToken === token);
  r = await Floor.POST(req({ tenantId: 't1', action: 'link', partyId: 'ana' }));
  check('no mobile number: a link to share, no text', r.body.ok && !r.body.sent && /No mobile number/.test(r.body.message) && texts.length === 1);

  console.log('api/wait: the guest’s own link');
  const Wait = await import('../../src/app/api/wait/route');
  const W = (body: any) => Wait.POST(req({ tenantId: 't1', token, ...body }));
  r = await W({ action: 'view' });
  check('where they are: first name only, their place and wait from the same floor the host sees, the drinks they can add (not food, not with choices, not sold out), with what each contains',
    r.body.ok && r.body.state === 'waiting' && r.body.first === 'Chris' && r.body.size === 4 && r.body.place === 1 && r.body.minutes === 2 && r.body.minutesWords === 'Any minute now'
    && r.body.drinks.map((d: any) => d.id).join(',') === 'spritz,neg,wr,lem' && r.body.drinks.find((d: any) => d.id === 'wr').contains === 'Contains milk' && r.body.canLater && r.body.preorderOn && !JSON.stringify(r.body).includes('Ana'), r.body);
  await db.doc(`${T}/walkIns/k1`).set({ name: 'Kiosk Kim', partySize: 4, status: 'waiting', checkInTime: rago(20) });
  (await import('../../src/lib/floor-server')).forgetFloor('t1');
  r = await W({ action: 'view' });
  check('someone on the lobby list who came earlier is ahead of them too', r.body.place === 2 && r.body.ahead === 1, r.body);
  await db.doc(`${T}/walkIns/k1`).delete();
  const bad1: any = await Wait.POST(req({ tenantId: 't1', token: 'x'.repeat(22), action: 'view' }));
  const bad2: any = await Wait.POST(req({ tenantId: 't1', token: 'short', action: 'view' }));
  check('a link that isn’t one: refused plainly', bad1.status === 404 && bad2.status === 400);
  const fromIp = (body: any, ip: string) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'x-real-ip' ? ip : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
  let last: any = null;
  for (let i = 0; i < 32; i++) last = await Wait.POST(fromIp({ tenantId: 't1', token: `guess${String(i).padStart(18, '0')}`, action: 'view' }, '10.0.0.9'));
  const realFromThere: any = await Wait.POST(fromIp({ tenantId: 't1', token, action: 'view' }, '10.0.0.9'));
  const fromElsewhere: any = await Wait.POST(fromIp({ tenantId: 't1', token: 'x'.repeat(22), action: 'view' }, '10.0.0.10'));
  check('guessing at links is slowed for whoever’s guessing, without locking out real guests or anyone else', last.status === 429 && realFromThere.body.ok && fromElsewhere.status === 404, { last: last.status, real: realFromThere.status, other: fromElsewhere.status });
  r = await W({ action: 'add', itemId: 'neg' }); r = await W({ action: 'add', itemId: 'neg' }); r = await W({ action: 'add', itemId: 'lem' });
  c = await get(`${T}/parties/chris`);
  check('a drink for when they sit, priced from the menu', r.body.ok && c.preorder.length === 2 && c.preorder[0].qty === 2 && c.preorder[0].price === 14 && c.preorder[1].itemId === 'lem', c.preorder);
  const nf: any = await W({ action: 'add', itemId: 'burger' }); const nl: any = await W({ action: 'add', itemId: 'latte' }); const ns: any = await W({ action: 'add', itemId: 'gone86' });
  check('…not food, not a drink with choices, not one that’s sold out', !nf.body.ok && !nl.body.ok && !ns.body.ok && (await get(`${T}/parties/chris`)).preorder.length === 2);
  r = await W({ action: 'remove', itemId: 'lem' });
  check('one fewer', r.body.ok && (await get(`${T}/parties/chris`)).preorder.length === 1);

  console.log('hold a nearly-ready table and text them');
  texts.length = 0;
  r = await Floor.POST(req({ tenantId: 't1', action: 'hold', partyId: 'chris', unitId: 'u11' }));
  c = await get(`${T}/parties/chris`);
  check('held until it’s likely ready plus the hold time; told it’s ready; texted to head back', r.body.ok && r.body.sent && c.status === 'notified' && c.holdUnitId === 'u11'
    && Math.abs(Date.parse(c.holdUntil) - (Date.now() + (2 + 10) * 60000)) < 90000 && texts[0].body === 'Chris, your table at Linden is almost ready. Please head back to the host stand now.' && !c.preorderRungAt, { c, texts, b: r.body });
  r = await Floor.POST(req({ tenantId: 't1', action: 'hold', partyId: 'ana', unitId: 'u11' }));
  check('…not for someone else while it’s held', r.status === 409 && /held for someone else/.test(r.body.error));
  await db.doc(`${T}/parties/gus`).set({ sessionId: 's1', status: 'waiting', name: 'Gus', size: 2, joinedAt: rago(2), needs: [], unitIds: [], guestIds: [] });
  await db.doc(`${T}/parties/hal`).set({ sessionId: 's1', status: 'waiting', name: 'Hal', size: 2, joinedAt: rago(2), needs: [], unitIds: [], guestIds: [] });
  const both: any[] = await Promise.all([Floor.POST(req({ tenantId: 't1', action: 'hold', partyId: 'gus', unitId: 'u2' })), Floor.POST(req({ tenantId: 't1', action: 'hold', partyId: 'hal', unitId: 'u2' }))]);
  check('two people holding one table at the same moment: only one gets it', both.filter((x) => x.body.ok).length === 1 && both.some((x) => x.status === 409), both.map((x) => x.body));
  for (const id of ['gus', 'hal']) await db.doc(`${T}/parties/${id}`).set({ status: 'left', holdUnitId: null, holdUntil: null }, { merge: true });
  r = await W({ action: 'view' });
  check('their link: the table’s ready, held for them until a time', r.body.state === 'ready' && r.body.holdTable === 'Table 11' && !!r.body.holdUntil, r.body);

  r = await W({ action: 'later' });
  c = await get(`${T}/parties/chris`);
  check('more time: back in line later, the held table let go for the next party, texted again when one’s ready', r.body.ok && c.status === 'waiting' && c.holdUnitId === null && c.notifiedAt === null && c.laterCount === 1 && Date.parse(c.laterUntil) > Date.now() + 9 * 60000);
  r = await W({ action: 'later' });
  check('…as often as the business allows', !r.body.ok && /already asked for more time once/.test(r.body.error));

  console.log('their drinks on the tab when they sit');
  await db.doc(`${T}/parties/chris`).set({ status: 'seated', seatedAt: new Date().toISOString(), unitIds: ['u11'] }, { merge: true });
  r = await Floor.POST(req({ tenantId: 't1', action: 'ring', partyId: 'chris', tableName: '11' }));
  c = await get(`${T}/parties/chris`);
  let v: any = await get(`${T}/appointments/apt-party-chris`);
  const k0: any = await get(`${T}/kdsTickets/${c.preorderKds?.[0]}`);
  check('the drinks go on the table’s tab, each its own ticket at the bar now, priced from the menu, said where they came from', r.body.ok && r.body.rung === 2 && v.tab.length === 2 && v.tab.every((l: any) => l.price === 14 && l.note === 'Ordered while waiting' && !!l.firedAt)
    && k0.status === 'pending' && k0.tableNumber === '11' && k0.madeAt === 'Bar' && k0.guestName === 'Chris Day' && v.isTable && v.partyId === 'chris' && c.preorderKds.length === 2, { b: r.body, v, k0 });
  r = await Floor.POST(req({ tenantId: 't1', action: 'ring', partyId: 'chris', tableName: '12' }));
  v = await get(`${T}/appointments/apt-party-chris`);
  check('…once: asked again, the drinks not yet out are pointed at where they are now', r.body.rung === 0 && r.body.moved === 2 && v.tab.length === 2 && (await get(`${T}/kdsTickets/${c.preorderKds[1]}`)).tableNumber === '12');
  r = await W({ action: 'view' });
  check('their link once seated', r.body.state === 'seated' && r.body.rung);

  console.log('when the bar makes them as we call the party');
  await db.doc(T).set({ hostingSettings: { wait: { link: true, preorder: true, drinksWhen: 'ready' } } }, { merge: true });
  await db.doc(`${T}/parties/dee`).set({ sessionId: 's1', status: 'waiting', name: 'Dee', size: 2, joinedAt: rago(1), phone: '+15550002222', needs: [], unitIds: [], guestIds: [], waitToken: 'deetokendeetokendeetok', preorder: [{ itemId: 'spritz', name: 'Aperol spritz', price: 1, qty: 1, at: rago(1) }] });
  r = await (await import('../../src/app/api/host/notify/route')).POST(req({ tenantId: 't1', partyId: 'dee' }));
  const dee: any = await get(`${T}/parties/dee`); v = await get(`${T}/appointments/apt-party-dee`);
  check('“Text: ready” sends the drinks to the bar, at the menu’s price (not what was saved), for the party by name', r.body.ok && dee.status === 'notified' && !!dee.preorderRungAt && v.tab.length === 1 && v.tab[0].price === 13
    && (await get(`${T}/kdsTickets/${dee.preorderKds[0]}`)).tableNumber === 'Dee (waiting)', { b: r.body, v });
  r = await Wait.POST(req({ tenantId: 't1', token: 'deetokendeetokendeetok', action: 'add', itemId: 'neg' }));
  check('…after which their link can’t change them', !r.body.ok && /bar has your drinks/.test(r.body.error));
  r = await Wait.POST(req({ tenantId: 't1', token: 'deetokendeetokendeetok', action: 'leave' }));
  const dee2: any = await get(`${T}/parties/dee`); v = await get(`${T}/appointments/apt-party-dee`);
  check('leaving the list: off it, the drink not yet out comes off the bar’s screen and the tab, and a tab started only for them is closed', r.body.ok && dee2.status === 'left' && dee2.leftBy === 'guest'
    && (await get(`${T}/kdsTickets/${dee.preorderKds[0]}`)).status === 'cancelled' && v.tab.length === 0 && v.status === 'cancelled', { dee2, v });
  r = await Wait.POST(req({ tenantId: 't1', token: 'deetokendeetokendeetok', action: 'view' }));
  check('…and their link says so, without their name or order', r.body.state === 'left' && r.body.first === undefined && r.body.preorder === undefined);
  r = await Floor.POST(req({ tenantId: 't1', action: 'ring', partyId: 'dee', tableName: '4' }));
  check('drinks aren’t sent for someone who’s left', r.status === 409);
  await db.doc(`${T}/parties/dee`).set({ drinksStuckAt: rago(1) }, { merge: true });
  const stillWaiting: any = await Floor.POST(req({ tenantId: 't1', action: 'unring', partyId: 'ana' }));
  r = await Floor.POST(req({ tenantId: 't1', action: 'unring', partyId: 'dee' }));
  check('drinks that couldn’t be taken off: tried again from the host stand; not for someone still on the list', r.body.ok && (await get(`${T}/parties/dee`)).drinksStuckAt === null && stillWaiting.status === 409);
  await db.doc(`${T}/parties/eli`).set({ sessionId: 's1', status: 'notified', notifiedAt: rago(15), name: 'Eli', size: 2, joinedAt: rago(30), needs: [], unitIds: [], guestIds: [] });
  r = await Floor.POST(req({ tenantId: 't1', action: 'left', partyId: 'eli', noShow: true }));
  check('the host: someone who didn’t come back is off the list as a no-show', r.body.ok && (await get(`${T}/parties/eli`)).status === 'no_show' && (await Floor.POST(req({ tenantId: 't1', action: 'left', partyId: 'eli' })) as any).status === 409);

  console.log('a closed night');
  await db.doc(`${T}/serviceSessions/s1`).set({ status: 'closed' }, { merge: true });
  r = await Wait.POST(req({ tenantId: 't1', token: 'deetokendeetokendeetok', action: 'view' }));
  await db.doc(`${T}/parties/fay`).set({ sessionId: 's1', status: 'waiting', name: 'Fay', size: 2, joinedAt: rago(1), waitToken: 'faytokenfaytokenfaytok' });
  const rf: any = await Wait.POST(req({ tenantId: 't1', token: 'faytokenfaytokenfaytok', action: 'view' }));
  const rl: any = await Wait.POST(req({ tenantId: 't1', token: 'faytokenfaytokenfaytok', action: 'later' }));
  check('once the night’s closed, a link still waiting says the list has closed, and changes nothing', rf.body.state === 'closed' && !rl.body.ok && /closed for today/.test(rl.body.error));
  await db.doc(`${T}/serviceSessions/s1`).set({ status: 'open' }, { merge: true });

  console.log('the check, and settings');
  const Tab = await import('../../src/app/api/tab/route');
  r = await Tab.POST(req({ tenantId: 't1', action: 'check', partyId: 'lopez' }));
  let lo: any = await get(`${T}/parties/lopez`);
  const fl: any = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  check('a server marks that the table asked for the check: the host stand sees it nearly free', r.body.ok && !!lo.checkAt && lo.checkBy === 'Sam Lee' && fl.body.stages.u4.key === 'check', fl.body.stages.u4);
  r = await Tab.POST(req({ tenantId: 't1', action: 'check', partyId: 'lopez', op: 'undo' }));
  lo = await get(`${T}/parties/lopez`);
  check('…and takes it back', r.body.ok && lo.checkAt === null && (await Tab.POST(req({ tenantId: 't1', action: 'check', partyId: 'ana' })) as any).status === 409);
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudges', mine: false }));
  check('My tables: each table shows where it is in its meal (the tables now read with the floor)', r.body.ok && r.body.tables.find((t: any) => t.party.id === 'lopez')?.stage?.words === 'Mains cooking', r.body.tables);
  manager = false;
  r = await Floor.POST(req({ tenantId: 't1', action: 'settings', floor: { turnSmall: 30 } }));
  check('settings: a manager only', r.status === 403);
  manager = true;
  r = await Floor.POST(req({ tenantId: 't1', action: 'settings', floor: { turnSmall: 30, clearMin: 0, seatOrder: 'fit', payMin: 999 }, wait: { link: false, preorder: true, sections: ['Cocktails'], moreTimes: 2 } }));
  const t1: any = await get(T);
  check('…saved in range, kept separate from the other hosting settings', r.body.ok && t1.hostingSettings.floor.turnSmall === 30 && t1.hostingSettings.floor.clearMin === 0 && t1.hostingSettings.floor.payMin === 10
    && t1.hostingSettings.floor.seatOrder === 'fit' && t1.hostingSettings.wait.link === false && t1.hostingSettings.wait.sections[0] === 'Cocktails' && t1.hostingSettings.wait.moreTimes === 2, t1.hostingSettings);
  r = await Floor.POST(req({ tenantId: 't1', action: 'link', partyId: 'ana', resend: true }));
  check('links off: no text, said so', r.body.ok && !r.body.sent && /off in Hosting settings/.test(r.body.message));

  console.log('screens');
  const host = src('src/app/(app)/host/page.tsx');
  check('the host stand: each table’s stage, progress and free time; being cleared (tap when ready); who looks after it',
    /st\.words/.test(host) && /STAGE_STEPS/.test(host) && /freeWords\(st\.freeIn/.test(host) && /Being cleared, ready in about/.test(host) && /markReady\(t\.tableId\)/.test(host) && /floor\?\.staff\?\.\[id\]/.test(host));
  check('…seat next with its reasons: seat, or hold and text; the rest of the list with their likely tables', /Seat next/.test(host) && /Hold \$\{unitLabel\(sg\.tableName\)\} and text/.test(host) && /sg\.reasons\.map/.test(host) && /next\.later\.slice/.test(host));
  check('…waiting cards: place and wait from the same floor; more time, drinks, link, not back yet; they left / didn’t come back', /linePlace\(asSeat/.test(host) && /Asked for more time from their phone/.test(host)
    && /Drinks for when they sit/.test(host) && /Send link/.test(host) && /not back yet/.test(host) && /Didn’t come back/.test(host) && /leftList\(p, notBack\)/.test(host));
  check('…the ready text signed in; seating clears holds and sends their drinks; the check from the table’s sheet', /api\('\/api\/host\/notify'/.test(host) && /holdUnitId: null, holdUntil: null, laterUntil: null/.test(host) && /action: 'ring'/.test(host) && /They asked for the check/.test(host));
  check('…someone who left from their phone shows for ten minutes; drinks that couldn’t come off, with a way to try again', /left the list from their phone/.test(host) && /still on the bar’s screen/.test(host) && /action: 'unring'/.test(host));
  const mine = src('src/app/(app)/tables/page.tsx');
  check('My tables: each table’s stage; the server marks the check', /t\.stage\.words/.test(mine) && /action: 'check'/.test(mine) && /They asked for the check/.test(mine));
  const page = src('src/app/wait/[tenantId]/[token]/page.tsx');
  check('…a check that doesn’t get through keeps what’s on the screen; the link’s address isn’t passed on', /setV\(\(prev: any\) => \(r\?\.ok \|\| !prev\?\.ok \? r : prev\)\)/.test(page) && /referrer: 'no-referrer'/.test(src('src/app/wait/[tenantId]/[token]/layout.tsx')));
  check('the guest’s page: place and wait, ready and held, more time, leave (confirmed), drinks with +/−, kept up to date', /in line for \{v\.size\}/.test(page) && /Your table’s ready/.test(page) && /Need \{v\.moreMin\} more min/.test(page)
    && /Yes, leave the list/.test(page) && /One fewer/.test(page) && /POLL_MS/.test(page) && /on your table’s check/.test(page));
  const set = src('src/components/settings/HostStandSettings.tsx');
  const legacy = src('src/app/(app)/settings/hosting/page.tsx');
  check('settings: stays by size, check, clearing, seat order, spreading, texting ahead; the wait list (off until on), hold, more time, drinks and when',
    /How long a table usually stays/.test(set) && /Clearing and resetting a table/.test(set) && /Longest wait/.test(set) && /Spread tables across servers/.test(set) && /Text the next party ahead/.test(set)
    && /Off until you turn it on/.test(set) && /Hold a table after we text/.test(set) && /Asking for more time/.test(set) && /When the bar makes it/.test(set) && /Which drinks/.test(set) && /HostStandSettings/.test(legacy));
  check('…the older hosting settings save field by field, so these are kept', /'hostingSettings\.vocabulary': words/.test(legacy) && !/hostingSettings: \{\n\s+vocabulary: words/.test(legacy));
  check('the guest link is kept out of search', /'\/wait\/'/.test(src('src/app/robots.ts')));
  const all = host + mine + page + set + src('src/lib/table-stage.ts') + src('src/lib/seat-next.ts') + src('src/lib/wait-line.ts') + src('src/lib/floor-server.ts') + src('src/app/api/host/floor/route.ts') + src('src/app/api/wait/route.ts');
  check('no niche words for the business, no emoji, no all caps', !/\b(salon|stylist|booth|chair)\b/i.test(page + set + src('src/lib/seat-next.ts') + src('src/lib/wait-line.ts')) && !/[\u{1F300}-\u{1FAFF}]/u.test(all) && !/\buppercase\b|font-black/.test(page + set));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
