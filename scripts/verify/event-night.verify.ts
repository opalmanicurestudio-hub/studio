// Checks event night (L20 round 20a, design canvas "Event night"): lib/event-night (the run of show, where the night
// is, course pacing, the prep from the guests' choices), lib/event-night-server and api/event-night (put together for
// an event; a manager sets and pushes the run of show), and the panel on the manifest page.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/event-night.verify.ts
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
  if (request === '@/lib/route-guard') return { requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor, tenant: {} }) };
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const E = await import('../../src/lib/event-night');
  console.log('the run of show');
  const good = E.cleanShow([{ at: '19:50', what: 'Mains', course: 2 }, { at: '18:30', what: 'Doors open' }, { at: '19:15', what: 'Starters', course: 1, note: 'Lights up' }], [1, 2, 3]);
  check('kept in time order, each with a time and what happens; a course once', !!good && good.map((m) => m.at).join() === '18:30,19:15,19:50' && good[1].course === 1 && good[1].note === 'Lights up' && good[0].course === null, good);
  check('…and refused when it makes no sense', E.cleanShow([{ at: '25:00', what: 'x' }], [1]) === null && E.cleanShow([{ at: '19:00', what: '' }], [1]) === null
    && E.cleanShow([{ at: '19:00', what: 'a', course: 1 }, { at: '19:30', what: 'b', course: 1 }], [1]) === null && E.cleanShow([{ at: '19:00', what: 'a', course: 4 }], [1]) === null
    && E.cleanShow(Array.from({ length: 21 }, (_, i) => ({ at: '19:00', what: `m${i}` })), [1]) === null && E.cleanShow('nope', [1]) === null);
  const sug = E.suggestShow('19:00', [{ n: 1, name: 'Starters' }, { n: 2, name: 'Mains' }, { n: 3, name: 'Desserts' }]);
  check('a first plan from the start and the courses: doors half an hour before, a course every 35 minutes, a close', sug.map((m) => `${m.at} ${m.what}`).join('|') === '18:30 Doors open|19:00 Guests seated|19:15 Starters|19:50 Mains|20:25 Desserts|21:10 Thank you, close', sug);
  const pushed = E.pushLater(sug, 19 * 60 + 20, new Set([1]), 10, 19 * 60);
  check('push: what’s still to come moves later; a course already fired and a moment gone by stay', pushed.find((m) => m.course === 1)!.at === '19:15' && pushed.find((m) => m.id === 'seated')!.at === '19:00' && pushed.find((m) => m.course === 2)!.at === '20:00' && pushed.find((m) => m.id === 'close')!.at === '21:20', pushed);
  const late = E.pushLater(sug, 20 * 60 + 20, new Set([1]), 10, 19 * 60);
  check('…an overdue course is pushed to that long from now, and what follows keeps its spacing', late.find((m) => m.course === 2)!.at === '20:30' && late.find((m) => m.course === 3)!.at === '21:05' && late.find((m) => m.id === 'close')!.at === '21:50', late);
  const lateNight = E.suggestShow('22:00', [{ n: 1, name: 'Starters' }, { n: 2, name: 'Mains' }, { n: 3, name: 'Desserts' }, { n: 4, name: 'Cheese' }]);
  check('a night past midnight carries on from 00:00, in order', lateNight.map((m) => m.at).join() === '21:30,22:00,22:15,22:50,23:25,00:00,00:45' && E.relMin('00:45', 22 * 60) === 24 * 60 + 45
    && E.cleanShow(lateNight, [1, 2, 3, 4], { start: 22 * 60 })!.map((m) => m.at).join() === '21:30,22:00,22:15,22:50,23:25,00:00,00:45'
    && E.nightState(lateNight, new Map([[1, 'x'], [2, 'x'], [3, 'x']]), 24 * 60 + 10, 22 * 60).next?.id === 'c4' && E.nightState(lateNight, new Map([[1, 'x'], [2, 'x'], [3, 'x']]), 24 * 60 + 10, 22 * 60).inMin === -10
    && E.relMin('10:30', 19 * 60) === 630 && E.relMin('05:30', 12 * 60) === 330, lateNight);
  check('read back, a moment whose course left the menu stays (not a course any more); saving one is refused', E.cleanShow([{ at: '19:00', what: 'Cheese', course: 4 }, { at: '18:30', what: 'Doors' }], [1, 2], { kept: true })!.map((m) => `${m.what}/${m.course}`).join() === 'Doors/null,Cheese/null'
    && E.cleanShow([{ at: '19:00', what: 'Cheese', course: 4 }], [1, 2]) === null);
  const st = E.nightState(sug, new Map([[1, '2026-11-20T19:16:00Z']]), 19 * 60 + 44, 19 * 60);
  check('where the night is: done, next (with the minutes until it), later', st.states.doors === 'done' && st.states.c1 === 'done' && st.states.c2 === 'next' && st.states.c3 === 'later' && st.next?.course === 2 && st.inMin === 6, st);
  check('…a course moment is only done once it’s fired', E.nightState(sug, new Map(), 19 * 60 + 30, 19 * 60).next?.id === 'c1' && E.nightState(sug, new Map(), 19 * 60 + 30, 19 * 60).inMin === -15);

  console.log('course pacing');
  const names = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
  const tk = (n: number, out: number, total: number, extra: any = {}) => Array.from({ length: total }, (_, i) => ({ courseNumber: n, status: i < out ? 'delivered' : 'ready', readyAt: '2026-11-20T19:27:00Z', deliveredAt: i < out ? '2026-11-20T19:30:00Z' : null, ...extra }));
  const pace = (o: any) => E.coursePacing({ courses: [1, 2, 3], names, show: sug, start: 19 * 60, clock: (hm: string) => hm, ...o });
  check('not started: when the first course fires', pace({ fires: [], tickets: [], nowMin: 18 * 60 }).state === 'waiting' && pace({ fires: [], tickets: [], nowMin: 18 * 60 }).words === 'Starters fires at 19:15.');
  check('…and once its time has come, fire it (late said)', pace({ fires: [], tickets: [], nowMin: 19 * 60 + 25 }).state === 'fire_now' && pace({ fires: [], tickets: [], nowMin: 19 * 60 + 25 }).words === 'Fire starters when the room is ready. It was due at 19:15.');
  const f1 = [{ courseNumber: 1, firedAt: '2026-11-20T19:15:00Z' }];
  const on = pace({ fires: f1, tickets: tk(1, 20, 33), nowMin: 19 * 60 + 40 });
  check('on pace: plates out, the next course’s time', on.state === 'on_pace' && on.out === 20 && on.total === 33 && on.words === 'Starters: 20 of 33 plates out. Mains fires at 19:50, in 10 minutes.' && on.kitchenMin === 12, on);
  const now = pace({ fires: f1, tickets: tk(1, 28, 33), nowMin: 19 * 60 + 50 });
  check('fire now: most of the course is out and the time has come', now.state === 'fire_now' && now.words === 'Most of starters is out (28 of 33 plates out). Fire mains now.', now);
  const hold = pace({ fires: f1, tickets: tk(1, 15, 33), nowMin: 19 * 60 + 56 });
  check('hold: the course is still going out, and late is said', hold.state === 'hold' && hold.words === 'Starters is still going out (15 of 33 plates out). Hold mains until most of it is out. It was due at 19:50.', hold);
  const carried = pace({ fires: f1, tickets: [...tk(1, 20, 33).slice(0, 20), ...tk(1, 0, 13).map((x, i) => (i < 8 ? { ...x, carriedAt: '2026-11-20T19:31:00Z' } : x))], nowMin: 19 * 60 + 50 });
  check('a plate someone took from the pass is out too; the rest are said to be waiting at the pass', carried.out === 28 && carried.atPass === 5 && carried.state === 'fire_now', carried);
  const cancelled = pace({ fires: f1, tickets: [...tk(1, 28, 33), ...tk(1, 0, 5, { status: 'cancelled' })], nowMin: 19 * 60 + 50 });
  check('…a cancelled plate isn’t counted', cancelled.total === 33 && cancelled.state === 'fire_now');
  check('how long a course has taken the kitchen tonight, from its fire to its last plate ready', pace({ fires: f1, tickets: tk(1, 33, 33), nowMin: 19 * 60 + 40 }).kitchenMin === 12
    && pace({ fires: [{ courseNumber: 1, firedAt: '2026-11-20T19:20:00Z' }], tickets: tk(1, 33, 33), nowMin: 19 * 60 + 40 }).kitchenMin === 7);
  const noPlan = E.coursePacing({ courses: [1, 2], names, show: [], start: 19 * 60, clock: (hm: string) => hm, fires: f1, tickets: tk(1, 30, 33), nowMin: 20 * 60 });
  check('…no time planned: ready when most is out', noPlan.state === 'ready' && noPlan.words === 'Most of starters is out. Mains can fire when the room is ready.');
  const all = pace({ fires: [...f1, { courseNumber: 2, firedAt: '2026-11-20T19:50:00Z' }, { courseNumber: 3, firedAt: '2026-11-20T20:25:00Z' }], tickets: tk(3, 30, 33), nowMin: 20 * 60 + 50 });
  check('…every course fired', all.state === 'done' && all.next === null);

  console.log('the prep');
  const menu = [{ id: 'crudo', name: 'Crudo', courseNumber: 1 }, { id: 'rib', name: 'Short rib', courseNumber: 2 }, { id: 'bream', name: 'Bream', courseNumber: 2 }, { id: 'tart', name: 'Tart', courseNumber: 3 }];
  const g = (o: any) => ({ allergies: [], dietaryRestrictions: [], ...o });
  const prep = E.eventPrep([g({ courseSelections: { 1: 'crudo', 2: 'rib', 3: 'tart' }, allergies: ['Shellfish'] }), g({ courseSelections: { 2: 'bream', 3: 'tart' }, mealChoiceId: 'crudo', allergies: ['shellfish'], dietaryRestrictions: ['Vegetarian'] }),
    g({ courseSelections: { 1: 'crudo', 2: 'rib' } }), g({ status: 'cancelled', courseSelections: { 1: 'crudo', 2: 'rib', 3: 'tart' } })], menu);
  const por = (id: string) => prep.dishes.find((d) => d.id === id)!.portions;
  check('portions of each dish from the guests’ choices (the one meal choice of an older invitation for course 1), a cancelled guest left out', prep.guests === 3 && por('crudo') === 3 && por('rib') === 2 && por('bream') === 1 && por('tart') === 2 && prep.unchosen === 1, prep);
  check('…and the allergies and diets in the room', prep.allergies[0].name === 'shellfish' && prep.allergies[0].count === 2 && prep.diets[0].name === 'vegetarian');

  console.log('put together');
  const today = new Date().toISOString().slice(0, 10);
  const nowMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  await db.doc(T).set({ id: 't1', name: 'Linden', timezone: 'UTC' });
  await db.doc(`${T}/studioEvents/e1`).set({ id: 'e1', title: 'Wine dinner', date: today, time: '19:00', status: 'active' });
  for (const m of menu) await db.doc(`${T}/eventMenuItems/${m.id}`).set({ ...m, eventId: 'e1' });
  for (let i = 0; i < 4; i++) await db.doc(`${T}/eventGuests/g${i}`).set({ id: `g${i}`, eventId: 'e1', name: `Guest ${i}`, courseSelections: { 1: 'crudo', 2: i % 2 ? 'rib' : 'bream', 3: 'tart' }, allergies: i === 0 ? ['nuts'] : [], dietaryRestrictions: [] });
  await db.doc(`${T}/eventGuests/gx`).set({ id: 'gx', eventId: 'other', name: 'Other night', courseSelections: { 1: 'crudo' } });
  const R = await import('../../src/app/api/event-night/route');
  let r: any = await R.POST(req({ tenantId: 't1', eventId: 'e1', action: 'view' }));
  const nt = r.body.night;
  check('the event’s night: a first plan until one is saved, the prep from its guests only', r.body.ok && nt.saved === false && nt.show.length === 6 && nt.prep.guests === 4 && nt.prep.dishes.find((d: any) => d.id === 'rib').portions === 2 && nt.onTheNight === true && r.body.manager === true, nt);
  const at = (d: number) => E.toHM(nowMin + d);
  const show = [{ at: at(-60), what: 'Doors open' }, { at: at(-30), what: 'Crudo', course: 1 }, { at: at(10), what: 'Mains', course: 2 }, { at: at(45), what: 'Tart', course: 3 }];
  r = await R.POST(req({ tenantId: 't1', eventId: 'e1', action: 'show', show }));
  check('a manager saves the run of show', r.body.ok && (await db.doc(`${T}/studioEvents/e1`).get()).data().runOfShow.length === 4 && (await db.doc(`${T}/studioEvents/e1`).get()).data().runOfShowBy === 'Sam Lee', r.body);
  const badShow: any = await R.POST(req({ tenantId: 't1', eventId: 'e1', action: 'show', show: [{ at: '19:00', what: 'x', course: 9 }] }));
  check('…not one that makes no sense', badShow.status === 400);
  await db.doc(`${T}/courseFires/f1`).set({ id: 'f1', eventId: 'e1', courseNumber: 1, status: 'fired', firedAt: new Date(Date.now() - 25 * 60000).toISOString() });
  for (let i = 0; i < 4; i++) await db.doc(`${T}/kdsTickets/k${i}`).set({ id: `k${i}`, eventId: 'e1', courseNumber: 1, guestId: `g${i}`, status: i < 3 ? 'delivered' : 'ready', readyAt: new Date(Date.now() - 15 * 60000).toISOString(), deliveredAt: i < 3 ? new Date().toISOString() : null });
  r = await R.POST(req({ tenantId: 't1', eventId: 'e1', action: 'view', fresh: true }));
  // (An evening event reads a moment before 6 am as after midnight, so the run of show starting an hour back must be after
  // 6 am for these to hold.)
  const timeSafe = nowMin >= 7 * 60 && nowMin <= 21 * 60;
  check('on the night: the course fired is done, the next is mains, and its plates out from the kitchen’s tickets', !timeSafe || (r.body.night.state.next.course === 2 && r.body.night.state.states[r.body.night.show[1].id] === 'done' && r.body.night.pacing.out === 3 && r.body.night.pacing.total === 4 && r.body.night.pacing.state === 'on_pace' && r.body.night.pacing.kitchenMin === 10), r.body.night);
  r = await R.POST(req({ tenantId: 't1', eventId: 'e1', action: 'push', minutes: 10 }));
  const after = (await db.doc(`${T}/studioEvents/e1`).get()).data().runOfShow;
  check('push: what’s still to come moves 10 minutes later; the fired course and what’s gone by stay', !timeSafe || (r.body.ok && after.find((m: any) => m.course === 2).at === at(20) && after.find((m: any) => m.course === 1).at === at(-30) && after[0].at === at(-60)), after);
  const badPush: any = await R.POST(req({ tenantId: 't1', eventId: 'e1', action: 'push', minutes: 2 }));
  check('…by 5 to 60 minutes', badPush.status === 400);
  actor = { uid: 'a1', name: 'Ana', role: 'staff', isManager: false, caps: [] };
  const sv: any = await R.POST(req({ tenantId: 't1', eventId: 'e1', action: 'view' }));
  const ss: any = await R.POST(req({ tenantId: 't1', eventId: 'e1', action: 'show', show }));
  check('the team sees the night; only a manager sets or pushes the run of show', sv.body.ok && sv.body.manager === false && ss.status === 403);
  actor = { uid: 'rn', name: 'Rena', role: 'renter', isRenter: true, isManager: false };
  check('a renter doesn’t get the business’s event', (await R.POST(req({ tenantId: 't1', eventId: 'e1', action: 'view' }))).status === 403);
  actor = { uid: 'm1', name: 'Sam Lee', role: 'manager', isManager: true };
  check('an event that isn’t there', (await R.POST(req({ tenantId: 't1', eventId: 'nope', action: 'view' }))).status === 404 && (await R.POST(req({ tenantId: 't1', eventId: 'a/b', action: 'view' }))).status === 400);
  await db.doc(`${T}/studioEvents/e2`).set({ id: 'e2', title: 'Next week', date: '2099-01-01', time: '19:00' });
  const later: any = await R.POST(req({ tenantId: 't1', eventId: 'e2', action: 'view' }));
  check('another day: the plan only, no pacing', later.body.night.onTheNight === false && later.body.night.pacing === null && later.body.night.state === null);
  check('no start time: a night past midnight still reads in order (the earliest evening moment is its start)', E.startOfShow(null, E.cleanShow([{ at: '00:30', what: 'Close' }, { at: '21:30', what: 'Doors' }, { at: '23:00', what: 'Dessert' }], [1])!) === 21 * 60 + 30
    && E.cleanShow([{ at: '00:30', what: 'Close' }, { at: '21:30', what: 'Doors' }], [1])!.map((m) => m.at).join() === '21:30,00:30');
  check('…and the kitchen’s tickets are only read on the night', /night\.on \? q\('kdsTickets'/.test(src('src/lib/event-night-server.ts')) && /if \(!live\) return;/.test(src('src/components/events/EventNightPanel.tsx')));

  console.log('the page');
  const panel = src('src/components/events/EventNightPanel.tsx'); const manifest = src('src/app/(app)/events/[eventId]/manifest/page.tsx');
  check('on the event’s manifest, firing through the manifest’s own fire', /<EventNightPanel tenantId=\{tenantId\} eventId=\{eventId\}/.test(manifest) && manifest.includes('onFire={(c) => setFireConfirmCourse(c)}'));
  check('the run of show, pacing and prep, a manager’s changes and push', panel.includes('Run of show') && panel.includes('Course pacing') && panel.includes('Prep for the event') && panel.includes('Change the run of show') && panel.includes('Push 10 min') && panel.includes('Save the run of show'));
  const mine = panel + src('src/lib/event-night.ts') + src('src/lib/event-night-server.ts') + src('src/app/api/event-night/route.ts');
  check('house style in the new code', !/salon|stylist|booth|chair/i.test(mine) && !/uppercase|font-black/.test(mine) && !/ · /.test(mine) && !/\{\/\*/.test(panel) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(panel));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
