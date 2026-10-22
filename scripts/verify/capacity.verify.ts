// Checks busy periods and capacity (lib/ship-promise, lib/capacity): a busy period's extra days and earlier cutoff,
// overlapping periods adding up, its customer lines filled in (a sentence with nothing to fill it left out), the
// schedule reader keeping only what's valid; the team's capacity from its busier days; what's still to pack on each
// coming ship day; the over-capacity days; and the suggestions, which change nothing until one is applied.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/capacity.verify.ts
import { check, failures, makeDb } from './fake-db';
import { checkCapacity } from '../../src/lib/capacity-check';
import { busyBanner, busyLineFor, busyText, busyWithRoom, countdownFor, cutoffFor, normalizeSchedule, orderPromise, processingSentence, productPromise, scheduleFrom } from '../../src/lib/ship-promise';
import { capacityOn, dayLoads, onTimeRate, overDays, overTitle, suggestionsFor, teamCapacity } from '../../src/lib/capacity';
import { endOfDay, wallToUtc } from '../../src/lib/tenant-time';

const TZ = 'America/New_York';
const base = { processingDays: 1, shipDays: [1, 2, 3, 4, 5], cutoff: '14:00', pickups: [{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '15:00' }], showDates: true, savedAt: '2026-10-01T00:00:00Z', standardTransit: { min: 2, max: 5 } };
// A time on the shop's clock in New York (four hours behind UTC until November 1, five after).
const at = (day: string, hhmm: string) => wallToUtc(day, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)), TZ).getTime();

(async () => {
  // ── Busy periods ──
  const rush = { from: '2026-11-25', to: '2026-12-19', extraDays: 2, cutoff: '12:00', name: 'Holiday rush', capacity: 60,
    banner: { on: true, text: 'Holiday orders ship within {days} business days. Order by {last order day} for {occasion}.' },
    product: { on: true, text: 'Holiday orders take a little longer to pack.' },
    email: { on: true, text: 'Holiday orders take a little longer to pack. Yours ships by {ship date}.' },
    lastOrder: { day: '2026-12-15', occasion: 'Christmas' } };
  const s = scheduleFrom({ shipSchedule: { ...base, busy: [rush] } });
  check('the reader keeps a busy period whole: days, cutoff, capacity, lines and the last day to order', s.busy.length === 1 && s.busy[0].capacity === 60 && s.busy[0].banner?.on === true && s.busy[0].lastOrder?.occasion === 'Christmas' && s.busy[0].cutoff === '12:00', s.busy[0]);
  const bad = normalizeSchedule({ ...base, busy: [{ from: '2026-12-01', to: '2026-12-02', extraDays: 99, capacity: -3, banner: { on: true, text: '   ' }, lastOrder: { day: 'Dec 15', occasion: 'X' }, auto: 'whatever' }], capacity: { mode: 'odd', perDay: 'many' } });
  check('…and drops what isn’t valid', bad.busy[0].extraDays === 30 && bad.busy[0].capacity === undefined && !bad.busy[0].banner && !bad.busy[0].lastOrder && !bad.busy[0].auto && bad.capacity.mode === 'team' && bad.capacity.perDay === 0 && bad.capacity.tell && !bad.capacity.autoMoreTime, bad);
  const p = productPromise({}, new Date(at('2026-11-30', '11:00')), TZ, s);
  check('an order in a busy period gets its extra days, counted in ship days', p.startsOn === '2026-11-30' && p.shipBy === '2026-12-03' && p.busy === 'Holiday rush' && p.why.includes('busy'), p);
  const late = productPromise({}, new Date(at('2026-11-30', '12:30')), TZ, s);
  check('…and its earlier cutoff: after noon it starts the next ship day', late.startsOn === '2026-12-01' && late.why.includes('after_cutoff'), late);
  const ban = (day: string, hhmm: string) => busyBanner(s, new Date(at(day, hhmm)), TZ);
  check('the banner, filled in on the shop’s clock', ban('2026-12-01', '10:00') === 'Holiday orders ship within 3 business days. Order by Tue, Dec 15 for Christmas.', ban('2026-12-01', '10:00'));
  check('past the last day to order, that sentence is left out; before the period there’s no banner', ban('2026-12-16', '10:00') === 'Holiday orders ship within 3 business days.' && ban('2026-11-24', '10:00') === '');
  check('it goes by the day an order placed now starts: the evening before it already shows, and after the cutoff on its last day it’s gone',
    ban('2026-11-24', '15:00') !== '' && ban('2026-12-18', '11:00') !== '' && ban('2026-12-18', '12:30') === '', [ban('2026-11-24', '15:00'), ban('2026-12-18', '12:30')]);
  check('the shop’s one-line rule counts the busy days for an order placed now', processingSentence(s, new Date(at('2026-12-01', '10:00')), TZ) === 'Orders ship within 3 business days.' && processingSentence(s) === 'Orders ship within 1 business day.');
  check('a line that’s off says nothing; a blank with nothing to fill it drops its sentence', busyText({ on: false, text: 'Hi.' }, {}) === '' && busyText({ on: true, text: 'Ships by {ship date}. Thanks!' }, {}) === 'Thanks!');
  const op = orderPromise({ at: new Date(at('2026-11-30', '11:00')), timeZone: TZ, schedule: s, lines: [] });
  check('the email line for an order placed in it names its ship-by day', busyLineFor(op, s, 'email', TZ) === 'Holiday orders take a little longer to pack. Yours ships by Thu, Dec 3.' && busyLineFor(op, s, 'product', TZ) === 'Holiday orders take a little longer to pack.', busyLineFor(op, s, 'email', TZ));
  check('…and nothing for one placed before it', busyLineFor(orderPromise({ at: new Date(at('2026-11-20', '11:00')), timeZone: TZ, schedule: s, lines: [] }), s, 'email', TZ) === '');
  const both = scheduleFrom({ shipSchedule: { ...base, busy: [rush, { from: '2026-12-01', to: '2026-12-01', extraDays: 1, cutoff: '11:00', name: 'Catching up', auto: 'more_time' }] } });
  const bp = productPromise({}, new Date(at('2026-12-01', '10:00')), TZ, both);
  check('a capacity suggestion’s extra day adds to a busy period’s, the earliest cutoff wins, and the busy period still names the order', bp.shipBy === '2026-12-07' && bp.busy === 'Holiday rush' && productPromise({}, new Date(at('2026-12-01', '11:30')), TZ, both).startsOn === '2026-12-02', bp);
  const two = scheduleFrom({ shipSchedule: { ...base, cutoffByDay: { 5: '12:00' }, busy: [{ from: '2026-12-01', to: '2026-12-11', extraDays: 2, name: 'A' }, { from: '2026-12-07', to: '2026-12-11', extraDays: 3, cutoff: '13:00', name: 'B' }] } });
  check('two busy periods set up by hand don’t add up: the larger applies; and one never makes a cutoff later than the day’s own',
    productPromise({}, new Date(at('2026-12-08', '10:00')), TZ, two).extraDays === 3 && cutoffFor('2026-12-11', two) === '12:00' && cutoffFor('2026-12-08', two) === '13:00');
  check('any blank is filled however it’s typed; one it doesn’t know drops its sentence; one day and none read right',
    busyText({ on: true, text: 'Ships by {Ship Date}. Or {ship_date}. Hi {nope}. Done.' }, { shipDate: 'Fri' }) === 'Ships by Fri. Or Fri. Done.'
    && busyText({ on: true, text: 'Orders ship within {days} business days.' }, { days: 1 }) === 'Orders ship within 1 business day.'
    && busyText({ on: true, text: 'Orders ship within {days} business days.' }, { days: 0 }) === 'Orders ship the same day.');
  const made = orderPromise({ at: new Date(at('2026-11-30', '11:00')), timeZone: TZ, schedule: scheduleFrom({ shipSchedule: { ...base, busy: [{ ...rush, email: { on: true, text: 'Yours ships within {days} business days, by {ship date}. Order by {last order day} for {occasion}.' } }] } }), lines: [{ leadDays: { min: 5, max: 5 } } as any] });
  const sMade = scheduleFrom({ shipSchedule: { ...base, busy: [{ ...rush, email: { on: true, text: 'Yours ships within {days} business days, by {ship date}. Order by {last order day} for {occasion}.' } }] } });
  check('an order’s own line uses its own days (a made-to-order item’s too) and its dates as they stand now; the last day to order goes once it’s past',
    busyLineFor(made, sMade, 'email', TZ) === 'Yours ships within 7 business days, by Wed, Dec 9. Order by Tue, Dec 15 for Christmas.'
    && busyLineFor(made, sMade, 'email', TZ, { shipBy: '2026-12-10', today: '2026-12-16' }) === 'Yours ships within 7 business days, by Thu, Dec 10.', [busyLineFor(made, sMade, 'email', TZ), busyLineFor(made, sMade, 'email', TZ, { shipBy: '2026-12-10', today: '2026-12-16' })]);
  const ends = scheduleFrom({ shipSchedule: { ...base, countdown: true, busy: [{ from: '2026-12-14', to: '2026-12-18', extraDays: 2, cutoff: '12:00', name: 'Rush' }] } });
  check('no countdown when ordering after the cutoff would ship sooner (the last day of a busy period)', countdownFor({}, new Date(at('2026-12-18', '10:00')), TZ, ends) === null && !!countdownFor({}, new Date(at('2026-12-21', '10:00')), TZ, ends));

  // ── Capacity ──
  const packed: any[] = [];
  const add = (day: string, n: number, people: string[]) => { for (let i = 0; i < n; i++) packed.push({ method: 'ship', packedAt: `${day}T16:00:00Z`, claimedBy: people[i % people.length] }); };
  add('2026-10-05', 30, ['a', 'b']); add('2026-10-06', 40, ['a', 'b']); add('2026-10-07', 20, ['a']); add('2026-10-08', 36, ['a', 'b']); add('2026-10-09', 10, ['a', 'b']); add('2026-10-12', 24, ['a', 'b']);
  packed.push({ method: 'counter', packedAt: '2026-10-12T16:00:00Z', claimedBy: 'a' }, { method: 'ship', packedAt: '2026-10-21T13:00:00Z', claimedBy: 'a' });
  const team = teamCapacity(packed, at('2026-10-21', '10:00'), TZ);
  check('the team’s capacity: the upper quarter of its days per person packing, times the usual number packing (pickups and today aside)', team?.perPacker === 20 && team?.packers === 2 && team?.perDay === 40 && team?.days === 6, team);
  check('too little history and there’s no number to go on', teamCapacity(packed.slice(0, 70), at('2026-10-21', '10:00'), TZ) === null);
  const fixed = scheduleFrom({ shipSchedule: { ...base, capacity: { mode: 'fixed', perDay: 25 } } });
  check('a fixed number wins over the team’s; a busy period’s own wins over both', capacityOn('2026-10-22', fixed, team) === 25 && capacityOn('2026-12-01', s, team) === 60 && capacityOn('2026-10-22', s, team) === 40 && capacityOn('2026-10-22', scheduleFrom({ shipSchedule: { ...base, capacity: { mode: 'fixed', perDay: 0 } } }), team) === null);

  const plain = scheduleFrom({ shipSchedule: base });
  const due = (id: string, day: string, extra: any = {}) => ({ id, method: 'ship', stage: 'paid', paidAt: '2026-10-20T15:00:00Z', lines: [{ lineId: 'l', qtyOrdered: 1 }],
    promise: { shipBy: day, shipByAt: `${day}T19:00:00.000Z`, shown: true, timeZone: TZ, carrier: 'USPS' }, promiseAt: `${day}T19:00:00.000Z`, shipPromiseAt: endOfDay(day, TZ).toISOString(), ...extra });
  const orders = [
    ...Array.from({ length: 45 }, (_, i) => due(`t${i}`, '2026-10-22')),
    ...Array.from({ length: 3 }, (_, i) => due(`l${i}`, '2026-10-19')),
    due('p1', '2026-10-22', { stage: 'picking' }), due('k1', '2026-10-22', { stage: 'packed' }), due('lb', '2026-10-22', { trackingNumber: '9400' }),
    due('h1', '2026-10-22', { holdUntilRestock: true }), due('r1', '2026-10-22', { shippedWithOrderId: 't1' }),
    ...Array.from({ length: 12 }, (_, i) => due(`f${i}`, '2026-10-23')), due('w1', '2026-10-28'), due('z1', '2026-11-30'),
    { id: 'c1', method: 'counter', stage: 'paid' },
  ];
  const loads = dayLoads(orders, {}, TZ, plain, at('2026-10-21', '16:00'), team);
  check('what’s still to pack on each coming ship day (today’s pickup gone, late ones on the first day, nothing packed, labeled, waiting on stock or riding along)',
    loads.map((l) => `${l.day}:${l.due}:${l.cap}`).join() === '2026-10-22:49:40,2026-10-23:12:40,2026-10-26:0:40,2026-10-27:0:40,2026-10-28:1:40', loads);
  const over = overDays(loads);
  check('the days over capacity, and by how much', over.length === 1 && over[0].day === '2026-10-22' && over[0].by === 9 && overTitle(over[0], '2026-10-21', TZ) === 'Tomorrow is over by 9', over);

  // Wednesday 10 AM, Thursday over: new orders now ship by Thursday, so a day more helps, and today's cutoff can move.
  const sug = suggestionsFor(over[0], plain, at('2026-10-21', '10:00'), TZ, team);
  const more = sug.find((x) => x.kind === 'more_time') as any;
  check('one more day for new orders: from today through the last day an order can start and still be due Thursday',
    more?.period.from === '2026-10-21' && more.period.to === '2026-10-21' && more.period.extraDays === 1 && more.period.auto === 'more_time' && more.detail === 'From now on, new orders show “ships by Friday”. Orders already placed keep their dates.', more);
  const cut = sug.find((x) => x.kind === 'early_cutoff') as any;
  check('an earlier cutoff on that day, while it’s still ahead', cut?.title === 'Move today’s cutoff to 12:00 PM' && cut.period.cutoff === '12:00' && cut.period.from === '2026-10-21' && cut.detail === 'Orders after 12 PM start tomorrow.', cut);
  const pk = sug.find((x) => x.kind === 'packer') as any;
  check('another packer, with what one more person covers', pk?.title === 'Add a packer tomorrow' && pk.detail === 'One more person packing covers about 20 orders.', pk);
  check('applying the extra day moves new orders, not ones already placed', productPromise({}, new Date(at('2026-10-21', '10:00')), TZ, { ...plain, busy: [more.period] }).shipBy === '2026-10-23' && productPromise({}, new Date(at('2026-10-22', '10:00')), TZ, { ...plain, busy: [more.period] }).shipBy === '2026-10-23');
  const lateSug = suggestionsFor(over[0], plain, at('2026-10-21', '13:45'), TZ, team);
  check('with the cutoff under half an hour away it isn’t offered; after it, new orders don’t land on Thursday so a day more isn’t either',
    !lateSug.some((x) => x.kind === 'early_cutoff') && lateSug.some((x) => x.kind === 'more_time') && !suggestionsFor(over[0], plain, at('2026-10-21', '15:00'), TZ, team).some((x) => x.kind === 'more_time' || x.kind === 'early_cutoff'));
  // Monday 10 AM, Thursday over, one day to ship: only Wednesday's orders land on Thursday.
  const mon = suggestionsFor({ day: '2026-10-22', due: 50, cap: 40, by: 10 }, plain, at('2026-10-19', '10:00'), TZ, team);
  const monMore = mon.find((x) => x.kind === 'more_time') as any;
  check('one more day covers only the days whose orders land on the over day, so none are moved onto it',
    monMore?.period.from === '2026-10-21' && monMore.period.to === '2026-10-21' && monMore.detail === 'Orders placed on Wednesday show “ships by Friday” instead of Thursday. Orders already placed keep their dates.'
    && productPromise({}, new Date(at('2026-10-20', '10:00')), TZ, { ...plain, busy: [monMore.period] }).shipBy === '2026-10-21', monMore);
  const monCut = mon.find((x) => x.kind === 'early_cutoff') as any;
  check('…and the earlier cutoff is Wednesday’s', monCut?.title === 'Move Wednesday’s cutoff to 12:00 PM' && monCut.detail === 'Orders after 12 PM start Thursday.', monCut);
  check('a new suggestion has its own id', !!monMore.period.id && monMore.period.id !== monCut.period.id);

  // Veterans Day, Wednesday November 11: a shop that ships UPS still ships, so its orders count that day.
  const upsSched = scheduleFrom({ shipSchedule: { ...base, pickups: [{ carrier: 'UPS', days: [1, 2, 3, 4, 5], time: '15:00' }] } });
  const ups = (id: string) => ({ ...due(id, '2026-11-11'), promise: { shipBy: '2026-11-11', shipByAt: '2026-11-11T20:00:00.000Z', shown: true, timeZone: TZ, carrier: 'UPS' }, promiseAt: '2026-11-11T20:00:00.000Z' });
  const vetLoads = dayLoads([ups('v1'), ups('v2')], {}, TZ, upsSched, at('2026-11-10', '16:00'), team);
  check('coming days follow the carriers the shop uses, not only USPS’s holidays', vetLoads[0].day === '2026-11-11' && vetLoads[0].due === 2, vetLoads.slice(0, 2));
  check('today counts what’s already been packed today', dayLoads(orders, {}, TZ, plain, at('2026-10-22', '10:00'), team, 5, 7)[0].due === 7 + 49 - 3 + 3, dayLoads(orders, {}, TZ, plain, at('2026-10-22', '10:00'), team, 5, 7)[0]);

  const shipped = [
    ...Array.from({ length: 9 }, (_, i) => ({ method: 'ship', completedAt: '2026-10-15T20:00:00Z', promise: { shipBy: '2026-10-15' } })),
    { method: 'ship', completedAt: '2026-10-16T20:00:00Z', promise: { shipBy: '2026-10-15' } },
    { method: 'ship', completedAt: '2026-10-16T20:00:00Z' }, { method: 'ship', completedAt: '2026-08-01T20:00:00Z', promise: { shipBy: '2026-07-31' } },
  ];
  check('on time over 30 days: shipped by the first date given', onTimeRate(shipped, at('2026-10-21', '10:00'), TZ) === 90 && onTimeRate(shipped.slice(0, 3), at('2026-10-21', '10:00'), TZ) === null);

  // ── Giving new orders more time by itself ──
  const db = makeDb();
  const T = 'tenants/t1';
  const tenant: any = { name: 'Opal', timezone: TZ, userId: 'o1', retailSettings: { shipSchedule: { ...base, capacity: { mode: 'team', autoMoreTime: true } } } };
  await db.doc(T).set(tenant);
  await db.doc(`${T}/staff/o1`).set({ name: 'Jessica Opal', role: 'owner' });
  await db.doc(`${T}/staff/s1`).set({ name: 'Mia Lane', role: 'staff' });
  for (const [i, o] of packed.entries()) await db.doc(`${T}/retailOrders/h${i}`).set({ ...o, stage: 'completed' });
  for (const o of orders) await db.doc(`${T}/retailOrders/${o.id}`).set(o);
  const r1 = await checkCapacity(db, 't1', tenant, { now: at('2026-10-21', '10:00') });
  const saved1 = scheduleFrom(db._store.get(T).retailSettings);
  const notes = [...db._store.entries()].filter(([p]: any) => p.startsWith(`${T}/notifications/`)).map(([, d]: any) => d);
  check('a shop that turned it on gets one more day for new orders while tomorrow is over, saved with the schedule',
    r1.added && r1.day === '2026-10-22' && saved1.busy.length === 1 && saved1.busy[0].auto === 'more_time' && saved1.busy[0].from === '2026-10-21' && saved1.busy[0].to === '2026-10-21' && saved1.busy[0].extraDays === 1, { r1, busy: saved1.busy });
  check('…and the owner sees it in the app (no buzz), in plain words (at 10 AM the late ones count today, so Thursday is over by 6)', notes.length === 1 && notes[0].userId === 'o1' && notes[0].type === 'orders_capacity' && notes[0].title === 'New orders get one more day'
    && notes[0].message === 'Tomorrow is over by 6, so from now on, new orders show “ships by Friday”. Orders already placed keep their dates.', notes);
  const r2 = await checkCapacity(db, 't1', { ...tenant, retailSettings: db._store.get(T).retailSettings }, { now: at('2026-10-21', '10:10') });
  check('ten minutes later nothing more is added', !r2.added && scheduleFrom(db._store.get(T).retailSettings).busy.length === 1);
  // Today and tomorrow both over at 10 AM: today can't be helped by a day more for new orders, tomorrow can.
  const db2 = makeDb();
  await db2.doc(T).set(tenant);
  await db2.doc(`${T}/staff/o1`).set({ name: 'Jessica Opal', role: 'owner' });
  for (const [i, o] of packed.entries()) await db2.doc(`${T}/retailOrders/h${i}`).set({ ...o, stage: 'completed' });
  for (let i = 0; i < 50; i++) await db2.doc(`${T}/retailOrders/w${i}`).set(due(`w${i}`, '2026-10-21'));
  for (let i = 0; i < 50; i++) await db2.doc(`${T}/retailOrders/x${i}`).set(due(`x${i}`, '2026-10-22'));
  const both2 = await checkCapacity(db2, 't1', tenant, { now: at('2026-10-21', '10:00') });
  check('with today and tomorrow both over, it uses the first day one more day can help', both2.added && both2.day === '2026-10-22', both2);
  // Someone stopped it by hand today: nothing goes back on until tomorrow.
  const db3 = makeDb();
  const paused = { ...tenant, retailSettings: { shipSchedule: { ...base, capacity: { mode: 'team', autoMoreTime: true, pausedOn: '2026-10-21' } } } };
  await db3.doc(T).set(paused);
  for (const [i, o] of packed.entries()) await db3.doc(`${T}/retailOrders/h${i}`).set({ ...o, stage: 'completed' });
  for (const o of orders) await db3.doc(`${T}/retailOrders/${o.id}`).set(o);
  check('stopped by hand today, none is added again today', !(await checkCapacity(db3, 't1', paused, { now: at('2026-10-21', '10:00') })).added && !scheduleFrom(db3._store.get(T).retailSettings).busy.length);
  const pausedYesterday = { ...tenant, retailSettings: { shipSchedule: { ...base, capacity: { mode: 'team', autoMoreTime: true, pausedOn: '2026-10-20' } } } };
  await db3.doc(T).set(pausedYesterday);
  check('stopped yesterday, it can add one again today', (await checkCapacity(db3, 't1', pausedYesterday, { now: at('2026-10-21', '10:00') })).added);
  // Room on a full list: old ones make way, oldest first; one the shop set up that's on or to come never does.
  const fullDb = async (list: any[]) => {
    const d = makeDb();
    const t = { ...tenant, retailSettings: { shipSchedule: { ...base, busy: list, capacity: { mode: 'team', autoMoreTime: true } } } };
    await d.doc(T).set(t);
    for (const [i, o] of packed.entries()) await d.doc(`${T}/retailOrders/h${i}`).set({ ...o, stage: 'completed' });
    for (const o of orders) await d.doc(`${T}/retailOrders/${o.id}`).set(o);
    return { d, t };
  };
  const longAgo = Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, from: '2026-08-01', to: '2026-08-07', extraDays: 1, name: `Old ${i}` }));
  const f1 = await fullDb(longAgo);
  const r5 = await checkCapacity(f1.d, 't1', f1.t, { now: at('2026-10-21', '10:00') });
  const s5 = scheduleFrom(f1.d._store.get(T).retailSettings);
  check('ones that ended over a month ago are cleared out as it’s added', r5.added && s5.busy.length === 1 && s5.busy[0].auto === 'more_time', s5.busy.map((b) => b.id));
  const lately = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, from: '2026-10-01', to: `2026-10-${String(i < 10 ? 2 + i : 20 - (i - 10)).padStart(2, '0')}`, extraDays: 1, name: `Lately ${i}` }));
  const f2 = await fullDb(lately);
  const r6 = await checkCapacity(f2.d, 't1', f2.t, { now: at('2026-10-21', '10:00') });
  const s6 = scheduleFrom(f2.d._store.get(T).retailSettings);
  check('a full list lets the one that ended longest ago go, and the new one is kept', r6.added && s6.busy.length === 20 && !s6.busy.some((b) => b.id === 'r0') && s6.busy.some((b) => b.auto === 'more_time'), s6.busy.map((b) => `${b.id}:${b.to}`));
  const ahead = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, from: '2026-11-01', to: '2026-11-30', extraDays: 0, name: `Ahead ${i}` }));
  const f3 = await fullDb(ahead);
  const r7 = await checkCapacity(f3.d, 't1', f3.t, { now: at('2026-10-21', '10:00') });
  const s7 = scheduleFrom(f3.d._store.get(T).retailSettings);
  check('twenty still to come: nothing is pushed out and nothing is added, and no one is told', !r7.added && s7.busy.length === 20 && s7.busy.every((b) => String(b.id).startsWith('a')) && ![...f3.d._store.keys()].some((k) => k.includes('/notifications/')));
  check('busyWithRoom keeps every one on or to come', busyWithRoom(ahead as any, '2026-10-21') === null && busyWithRoom(longAgo as any, '2026-10-21')!.length === 0);

  const off = makeDb();
  await off.doc(T).set({ ...tenant, retailSettings: { shipSchedule: base } });
  check('off unless the shop turns it on', !(await checkCapacity(off, 't1', { ...tenant, retailSettings: { shipSchedule: base } }, { now: at('2026-10-21', '10:00') })).added);

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
