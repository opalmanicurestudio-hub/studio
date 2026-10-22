// Checks the shipping schedule route (api/retail/ship-schedule): a manager can change the schedule, each change is
// tidied by the same reader every screen uses and saved on its own path, and the first save writes the whole schedule.
// Busy periods change one at a time by their id (add or replace, remove, end now), against the list as it's saved:
// ended ones over a month old are cleared out, a full list lets the one that ended longest ago go and never one still
// to come, and ending or removing an extra day the capacity check added stops it adding another today. Someone who
// isn't a manager can't change any of it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ship-schedule-route.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';
import { addDays, dayKey } from '../../src/lib/tenant-time';

const db = makeDb();
let actor: any = { uid: 'm1', name: 'Rae Moss', isManager: true };
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async (_req: any, tenantId: string) => ({ ok: true, actor, tenant: db._store.get(`tenants/${tenantId}`) || {} }) };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
// What each save writes, to see that only the changed parts go.
const writes: any[] = [];
const run = db.runTransaction;
db.runTransaction = (fn: any) => run((tx: any) => fn({ ...tx, update: (r: any, v: any) => { writes.push(v); return tx.update(r, v); } }));

const TZ = 'America/New_York';
const today = dayKey(new Date(), TZ);
const day = (n: number) => addDays(today, n);
const sched = (t: string) => db._store.get(`tenants/${t}`).retailSettings.shipSchedule;
const ids = (t: string) => sched(t).busy.map((b: any) => b.id);

(async () => {
  const { POST } = await import('../../src/app/api/retail/ship-schedule/route');
  const call = (body: any) => POST({ json: async () => body } as any) as any;

  // ── The rest of the schedule ──
  await db.doc('tenants/a').set({ timezone: TZ, retailSettings: { shipProcessingHours: 48, other: 1 } });
  const r0 = await call({ tenantId: 'a', patch: { cutoff: '13:00' } });
  const a = db._store.get('tenants/a').retailSettings;
  check('the first save writes the whole schedule, keeping what the old "ship within hours" meant', r0.status === 200 && a.shipSchedule.cutoff === '13:00' && a.shipSchedule.processingDays === 2 && !!a.shipSchedule.savedAt && a.other === 1, a);

  await db.doc('tenants/b').set({ timezone: TZ, retailSettings: { shipSchedule: { processingDays: 1, cutoff: '14:00', savedAt: '2026-10-01T00:00:00Z', closures: [{ from: day(60), to: day(62) }], busy: [{ id: 'keep1', from: day(10), to: day(20), extraDays: 1, name: 'Fall sale' }] } } });
  writes.length = 0;
  const r1 = await call({ tenantId: 'b', patch: { busy: [], capacity: { mode: 'fixed', perDay: 40, tell: true, autoMoreTime: false, junk: 1 }, savedAt: 'hack', role: 'owner' } });
  const b = sched('b');
  check('a manager’s change is tidied and saved on its own path; nothing else moves, and only schedule keys are taken',
    r1.status === 200 && b.capacity.mode === 'fixed' && b.capacity.perDay === 40 && b.capacity.junk === undefined && b.closures.length === 1 && b.cutoff === '14:00' && b.savedAt !== 'hack' && b.role === undefined, b);
  check('busy periods can’t be replaced wholesale through the rest of the schedule', b.busy.length === 1 && b.busy[0].id === 'keep1', b.busy);
  check('only the changed parts are written', writes.length === 1 && Object.keys(writes[0]).sort().join() === 'retailSettings.shipSchedule.capacity,retailSettings.shipSchedule.savedAt', writes);
  check('the schedule comes back as it was kept', r1.body.ok && r1.body.schedule.capacity.perDay === 40 && r1.body.schedule.busy.length === 1, r1.body);

  // ── Busy periods, one at a time ──
  writes.length = 0;
  const r2 = await call({ tenantId: 'b', busy: { op: 'upsert', period: { id: 'hol26', from: day(30), to: day(50), extraDays: 2, cutoff: '12:00', name: 'Holiday rush', capacity: 60, banner: { on: true, text: 'Holiday orders ship within {days} business days.' }, junk: 1 } } });
  const hol = sched('b').busy.find((x: any) => x.id === 'hol26');
  check('a new busy period is added, tidied, beside the others', r2.status === 200 && ids('b').join() === 'keep1,hol26' && hol.capacity === 60 && hol.cutoff === '12:00' && hol.banner.text === 'Holiday orders ship within {days} business days.' && hol.junk === undefined, sched('b').busy);
  check('a busy period change writes only the busy periods', writes.length === 1 && Object.keys(writes[0]).sort().join() === 'retailSettings.shipSchedule.busy,retailSettings.shipSchedule.savedAt', writes);
  await call({ tenantId: 'b', busy: { op: 'upsert', period: { id: 'hol26', from: day(30), to: day(52), extraDays: 3, name: 'Holiday rush' } } });
  const hol2 = sched('b').busy.find((x: any) => x.id === 'hol26');
  check('changing one replaces it by its id and leaves the others as they are', ids('b').join() === 'keep1,hol26' && hol2.extraDays === 3 && hol2.to === day(52) && hol2.capacity === undefined && sched('b').busy[0].name === 'Fall sale', sched('b').busy);
  check('one without an id, or without days, is turned away',
    (await call({ tenantId: 'b', busy: { op: 'upsert', period: { from: day(1), to: day(2) } } })).status === 400
    && (await call({ tenantId: 'b', busy: { op: 'upsert', period: { id: 'nodays', name: 'No days' } } })).status === 400 && ids('b').join() === 'keep1,hol26');
  check('removing one that isn’t there says so', (await call({ tenantId: 'b', busy: { op: 'remove', id: 'gone' } })).status === 404);
  await call({ tenantId: 'b', busy: { op: 'remove', id: 'keep1' } });
  check('removing one takes only that one off', ids('b').join() === 'hol26', ids('b'));

  // Ending one now.
  await db.doc('tenants/c').set({ timezone: TZ, retailSettings: { shipSchedule: { processingDays: 1, savedAt: '2026-10-01T00:00:00Z', capacity: { mode: 'fixed', perDay: 30, tell: true, autoMoreTime: true },
    busy: [{ id: 'on', from: day(-3), to: day(5), extraDays: 1 }, { id: 'starts', from: today, to: day(4), extraDays: 1 }, { id: 'later', from: day(9), to: day(12), extraDays: 1 }, { id: 'over', from: day(-20), to: day(-10), extraDays: 1 }, { id: 'auto1', from: day(-1), to: day(1), extraDays: 1, auto: 'more_time' }] } } });
  await call({ tenantId: 'c', busy: { op: 'end', id: 'on' } });
  check('ending one that’s on: it ends yesterday, so new orders get the usual days from now', sched('c').busy.find((x: any) => x.id === 'on')?.to === day(-1), sched('c').busy);
  await call({ tenantId: 'c', busy: { op: 'end', id: 'starts' } });
  await call({ tenantId: 'c', busy: { op: 'end', id: 'later' } });
  check('ending one that starts today or is still to come takes it off', !ids('c').includes('starts') && !ids('c').includes('later'), ids('c'));
  await call({ tenantId: 'c', busy: { op: 'end', id: 'over' } });
  check('ending one that’s already over never makes it longer', sched('c').busy.find((x: any) => x.id === 'over')?.to === day(-10), sched('c').busy);
  check('ending one set up by hand doesn’t stop the extra day the capacity check can add', !sched('c').capacity.pausedOn);
  await call({ tenantId: 'c', busy: { op: 'end', id: 'auto1' } });
  const c = sched('c');
  check('ending the extra day the capacity check added stops it adding another today, and keeps the rest of the capacity setting',
    c.busy.find((x: any) => x.id === 'auto1')?.to === day(-1) && c.capacity.pausedOn === today && c.capacity.autoMoreTime === true && c.capacity.perDay === 30 && c.capacity.mode === 'fixed', c);

  await db.doc('tenants/d').set({ timezone: TZ, retailSettings: { shipSchedule: { processingDays: 1, savedAt: '2026-10-01T00:00:00Z', capacity: { mode: 'team', tell: true, autoMoreTime: true }, busy: [{ id: 'auto2', from: day(1), to: day(1), extraDays: 1, auto: 'more_time' }] } } });
  await call({ tenantId: 'd', busy: { op: 'remove', id: 'auto2' } });
  check('removing it does the same', !sched('d').busy.length && sched('d').capacity.pausedOn === today, sched('d'));

  // Old ones and a full list.
  await db.doc('tenants/e').set({ timezone: TZ, retailSettings: { shipSchedule: { processingDays: 1, savedAt: '2026-10-01T00:00:00Z',
    busy: [{ id: 'ancient', from: day(-60), to: day(-40), extraDays: 1 }, { id: 'month', from: day(-35), to: day(-31), extraDays: 1 }, { id: 'recent', from: day(-9), to: day(-5), extraDays: 1 }] } } });
  await call({ tenantId: 'e', busy: { op: 'upsert', period: { id: 'new1', from: day(3), to: day(6), extraDays: 1 } } });
  check('ones that ended over a month ago are cleared out as the list is saved; a month ago today stays', ids('e').join() === 'month,recent,new1', ids('e'));

  const ahead = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, from: day(5 + i), to: day(6 + i), extraDays: 1 }));
  await db.doc('tenants/f').set({ timezone: TZ, retailSettings: { shipSchedule: { processingDays: 1, savedAt: '2026-10-01T00:00:00Z', busy: ahead } } });
  const r3 = await call({ tenantId: 'f', busy: { op: 'upsert', period: { id: 'one21', from: day(40), to: day(41), extraDays: 1 } } });
  check('twenty on or still to come: a new one can’t fit, and none of them is pushed out', r3.status === 400 && /room for 20/.test(r3.body.error) && ids('f').length === 20 && !ids('f').includes('one21'), r3.body);
  const r4 = await call({ tenantId: 'f', busy: { op: 'upsert', period: { id: 'a3', from: day(8), to: day(10), extraDays: 2 } } });
  check('one of them can still be changed while the list is full', r4.status === 200 && sched('f').busy.find((x: any) => x.id === 'a3').extraDays === 2 && ids('f').length === 20);
  const mixed = [...Array.from({ length: 18 }, (_, i) => ({ id: `m${i}`, from: day(5), to: day(9), extraDays: 1 })), { id: 'endedLonger', from: day(-20), to: day(-15), extraDays: 1 }, { id: 'endedLately', from: day(-6), to: day(-2), extraDays: 1 }];
  await db.doc('tenants/g').set({ timezone: TZ, retailSettings: { shipSchedule: { processingDays: 1, savedAt: '2026-10-01T00:00:00Z', busy: mixed } } });
  const r5 = await call({ tenantId: 'g', busy: { op: 'upsert', period: { id: 'fresh', from: day(30), to: day(31), extraDays: 1 } } });
  check('a full list lets the one that ended longest ago go to make room', r5.status === 200 && ids('g').length === 20 && !ids('g').includes('endedLonger') && ids('g').includes('endedLately') && ids('g').includes('fresh'), ids('g'));

  // A schedule saved before busy periods had their own ids.
  await db.doc('tenants/h').set({ timezone: TZ, retailSettings: { shipSchedule: { processingDays: 1, savedAt: '2026-10-01T00:00:00Z', busy: [{ from: day(3), to: day(8), extraDays: 1, name: 'Old style' }] } } });
  const oldId = `x${day(3).replace(/-/g, '')}${day(8).replace(/-/g, '')}`;
  await call({ tenantId: 'h', busy: { op: 'upsert', period: { id: oldId, from: day(3), to: day(9), extraDays: 2, name: 'Old style' } } });
  check('one saved before busy periods had ids can still be found and changed', sched('h').busy.length === 1 && sched('h').busy[0].to === day(9) && sched('h').busy[0].extraDays === 2, sched('h').busy);

  // ── Who can change it ──
  actor = { uid: 's1', name: 'Mia Lane', isManager: false };
  const r6 = await call({ tenantId: 'b', patch: { cutoff: '09:00' } });
  const r7 = await call({ tenantId: 'b', busy: { op: 'remove', id: 'hol26' } });
  check('someone who isn’t a manager can’t change it', r6.status === 403 && r7.status === 403 && sched('b').cutoff === '14:00' && ids('b').join() === 'hol26');
  actor = { uid: 'm1', name: 'Rae Moss', isManager: true };
  check('nothing to change, or no business, is turned away',
    (await call({ tenantId: 'b', patch: { nope: 1 } })).status === 400 && (await call({ patch: { cutoff: '10:00' } })).status === 400 && (await call({ tenantId: 'b', busy: { op: 'wipe' } })).status === 400);

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
