// Checks the team's day (lib/ship-day): the cutoff and the next pickup, what has to ship today and how much is packed,
// late orders (past the date their customer was first given) with what happened and the next step, orders at risk of
// missing today's pickup at the team's own pace, parcels the carrier is having trouble with, and the counts and queue
// order the orders screen shows.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ship-day.verify.ts
import { check, failures } from './fake-db';
import { atRiskItems, carrierItem, dayPicture, dueBy, labelWork, lateItem, packPace, pastWord, sharedTellDay, tellableNow, whenWord } from '../../src/lib/ship-day';
import { carrierName, scheduleFrom } from '../../src/lib/ship-promise';
import { endOfDay } from '../../src/lib/tenant-time';
import { needsYou, packQueue } from '../../src/lib/orders-view';

const TZ = 'America/New_York';
const rs = { shipSchedule: { processingDays: 1, shipDays: [1, 2, 3, 4, 5], cutoff: '14:00', pickups: [{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '15:00' }], showDates: true, savedAt: '2026-10-01T00:00:00Z', standardTransit: { min: 2, max: 5 } } };
const schedule = scheduleFrom(rs);
// Thursday, October 22, 2026. New York is four hours behind UTC until November 1.
const at = (hhmm: string) => Date.parse(`2026-10-22T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, '0')}:${hhmm.slice(3)}:00Z`);
const promise = (day: string) => ({ v: 1, source: 'schedule', shipBy: day, shipByAt: `${day}T19:00:00.000Z`, deadlineAt: endOfDay(day, TZ).toISOString(), shown: true, timeZone: TZ, carrier: 'USPS' });
const ship = (id: string, n: number, name: string, extra: any = {}) => ({ id, orderNumber: n, customerName: name, method: 'ship', stage: 'paid', paidAt: '2026-10-21T20:10:00Z', lines: [{ lineId: 'l1', name: 'Gel kit', qtyOrdered: 1 }], ...extra });
const dueToday = (id: string, n: number, name: string, extra: any = {}) => ship(id, n, name, { promise: promise('2026-10-22'), promiseAt: '2026-10-22T19:00:00.000Z', shipPromiseAt: endOfDay('2026-10-22', TZ).toISOString(), ...extra });

const a = dueToday('a', 1048, 'Priya Shah', { paidAt: '2026-10-21T20:10:00Z' });
const b = dueToday('b', 1047, 'Owen Park', { stage: 'packed' });
const c = ship('c', 1036, 'Kim Lee', { stage: 'packed', trackingNumber: '9400111', labelUrl: 'u', carrier: 'USPS', promise: promise('2026-10-20'), promiseAt: '2026-10-20T19:00:00.000Z', shipPromiseAt: endOfDay('2026-10-20', TZ).toISOString() });
const d = ship('d', 1039, 'Marcus Tate', { promise: promise('2026-10-20'), promiseAt: '2026-10-23T19:00:00.000Z', shipPromiseAt: endOfDay('2026-10-23', TZ).toISOString(), notifiedForPromiseAt: endOfDay('2026-10-23', TZ).toISOString(), delayNoticeAt: '2026-10-20T22:00:00Z' });
const e = dueToday('e', 1049, 'Leo King', { holdUntilRestock: true, lines: [{ lineId: 'l1', name: 'gel', qtyOrdered: 1, status: 'backordered' }] });
const f = dueToday('f', 1051, 'Sam West', { addressRequest: { status: 'waiting' } });
const g = ship('g', 1033, 'Kim Ray', { stage: 'shipped', carrier: 'USPS', carrierIssue: { open: true, status: 'RETURNED', detail: 'Address not found', carrier: 'USPS', key: 'k1' } });
const h = dueToday('h', 1050, 'Ana Ruiz', { labelFromOrderId: 'a' });
const pickup = { id: 'p', method: 'counter', stage: 'paid', paidAt: '2026-10-22T14:00:00Z' };
const orders = [a, b, c, d, e, f, h, pickup];
const recent = [
  { claimedAt: '2026-10-22T13:00:00Z', packedAt: '2026-10-22T13:06:00Z', claimedBy: 'u1' },
  { claimedAt: '2026-10-21T13:00:00Z', packedAt: '2026-10-21T13:10:00Z', claimedBy: 'u2' },
  { claimedAt: '2026-10-20T13:00:00Z', packedAt: '2026-10-20T13:08:00Z', claimedBy: 'u2' },
];

(async () => {
  // ── Words ──
  check('days read as people say them', whenWord('2026-10-22', '2026-10-22', TZ) === 'today' && whenWord('2026-10-23', '2026-10-22', TZ) === 'tomorrow' && whenWord('2026-10-26', '2026-10-22', TZ) === 'Monday' && whenWord('2026-10-30', '2026-10-22', TZ) === 'Fri, Oct 30'
    && pastWord('2026-10-21', '2026-10-22', TZ) === 'yesterday' && pastWord('2026-10-20', '2026-10-22', TZ) === 'Tuesday');

  // ── Pace ──
  const pace = packPace(recent, orders, at('13:00'), TZ);
  check('the team’s pace is the middle time from starting an order to packing it; packers counted from today', pace.minutesPerOrder === 8 && pace.packers === 1 && pace.from === 'recent', pace);
  check('with too little history, a plain default, and it says so', packPace(recent.slice(0, 2), [], at('13:00'), TZ).from === 'default');

  // ── The day ──
  const day = dayPicture({ orders, flagged: [g], recentPacked: recent, sentToday: 1, rs, schedule, now: at('13:00'), timeZone: TZ });
  check('the cutoff and how long is left, and the next pickup', day.shipsToday && day.cutoff.label === '2:00 PM' && day.cutoff.minutesLeft === 60 && day.pickup?.carrier === 'USPS' && day.pickup?.label === '3:00 PM' && !day.pickupsDone && day.lastPickup?.label === '3:00 PM', day.cutoff);
  check('ship today counts what has to leave today (late ones too), not pickups, an order riding in another’s box or one waiting on stock, plus what went today',
    day.ship.total === 5 && day.ship.packed === 2 && day.ship.toGo === 2 && day.ship.sent === 1, day.ship);
  check('the late list: past the date first given, oldest first; not a labeled box', day.late.map((x) => x.order.id).join() === 'd', day.late.map((x) => x.order.id));
  check('a labeled box isn’t late: it’s on its way out, or the morning label check asks about it under Labels (and no notice goes for one)',
    !lateItem(c, at('13:00'), TZ, schedule, rs) && !lateItem({ ...c, promise: promise('2026-10-22'), promiseAt: '2026-10-22T19:00:00.000Z' }, at('15:01'), TZ, schedule, rs));
  check('a box the carrier has scanned that nobody marked shipped goes under Needs you instead', needsYou([{ ...c, carrierTrail: { carrierStatus: 'TRANSIT' } }], at('13:00')).some((n) => n.kind === 'unshipped' && n.text === 'USPS has Kim’s parcel, but it isn’t marked shipped'));
  const ld = day.late.find((x) => x.order.id === 'd')!;
  check('an order whose customer was told a new date: still late against the first one, told when and for when, that date still stands, and no second notice offered',
    ld.told?.day === '2026-10-23' && ld.told?.at === '2026-10-20T22:00:00Z' && ld.toldStands && ld.steps.map((s) => s.kind).join() === 'pack' && ld.what === 'It hasn’t been started.', ld);
  const ld2 = lateItem(d, Date.parse('2026-10-23T19:30:00Z'), TZ, schedule, rs)!;
  check('when the date they were told goes by too, it no longer stands: they’re told again by themselves an hour later, and telling them now is offered',
    !ld2.toldStands && ld2.autoTell?.at === '2026-10-23T20:00:00.000Z' && ld2.autoTell?.day === '2026-10-26' && ld2.steps.map((s) => s.kind).join() === 'pack,tell', ld2);
  check('an order waiting on stock its customer chose to wait for isn’t late', !lateItem({ ...e, promise: promise('2026-10-20'), promiseAt: '2026-10-20T19:00:00.000Z' }, at('13:00'), TZ, schedule, rs));
  const after = lateItem({ ...a, releasedAt: '2026-10-21T15:00:00Z', promise: promise('2026-10-21'), promiseAt: '2026-10-21T19:00:00.000Z' }, at('13:00'), TZ, schedule, rs);
  check('stock that came in for a waiting order is said in plain words', after?.what === 'Its stock came in yesterday. It hasn’t been started.', after?.what);
  check('not late until that day’s last pickup has gone', !lateItem(a, at('14:59'), TZ, schedule, rs) && !!lateItem(a, at('15:01'), TZ, schedule, rs));
  const la = lateItem(a, at('15:01'), TZ, schedule, rs)!;
  check('just missed and still unlabeled: its customer is told by itself an hour after the pickup that it ships tomorrow, so packing it comes first and telling them now second',
    la.autoTell?.at === '2026-10-22T20:00:00.000Z' && la.autoTell?.day === '2026-10-23' && la.steps.map((s) => s.kind).join() === 'pack,tell' && la.steps[1].label === 'Tell Priya it ships tomorrow', la);
  const stale = lateItem(a, at('17:31'), TZ, schedule, rs)!;
  check('well after the time it should have gone by itself and still not told: nobody else is telling them, so telling them comes first', !stale.autoTell && stale.steps[0].kind === 'tell' && !!lateItem(a, at('17:29'), TZ, schedule, rs)?.autoTell, stale.steps);
  check('nothing goes by itself for an order held for review, or one that has had its two automatic notices: telling them comes first',
    !lateItem({ ...a, holdForReview: true }, at('15:01'), TZ, schedule, rs)?.autoTell && lateItem({ ...a, autoDelayNotices: 2 }, at('15:01'), TZ, schedule, rs)?.steps[0].kind === 'tell');
  check('a customer never given a date isn’t told anything', (() => { const x = lateItem({ ...a, promise: { ...a.promise, shown: false } }, at('15:01'), TZ, schedule, rs); return !!x && !x.shown && !x.autoTell && x.steps.every((s) => s.kind !== 'tell'); })());

  // ── At risk ──
  check('with two hours to the pickup, only the orders that can’t move without someone are at risk; not one waiting on stock, whose date moves with it',
    day.atRisk.map((x) => `${x.order.id}:${x.why}`).join() === 'f:address' && day.atRisk[0].detail === 'Address change waiting' && day.atRisk[0].status === 'Needs you', day.atRisk);
  const heldRisk = atRiskItems([dueToday('hr', 1070, 'Hal Ross', { holdForReview: true })], at('09:00'), TZ, schedule, rs, pace);
  check('an order held for review is at risk however early it is', heldRisk.length === 1 && heldRisk[0].why === 'held' && heldRisk[0].status === 'Held' && heldRisk[0].tellDay === '2026-10-23', heldRisk);
  const late = atRiskItems(orders, at('14:50'), TZ, schedule, rs, pace);
  const ra = late.find((x) => x.order.id === 'a');
  check('ten minutes before the pickup, an order not started is at risk at the team’s pace, with the next ship day to tell them', ra?.why === 'not_started' && ra.status === 'Not started' && ra.tellDay === '2026-10-23' && ra.shown && /1 item · paid yesterday/.test(ra.detail), ra);
  check('everyone told gets the same day, so the button can name it', sharedTellDay(late) === '2026-10-23');
  const rushed = atRiskItems([{ ...dueToday('x1', 1, 'A B'), paidAt: '2026-10-22T10:00:00Z' }, { ...dueToday('x2', 2, 'C D'), paidAt: '2026-10-22T11:00:00Z', rushAt: '2026-10-22T18:00:00Z' }], at('14:40'), TZ, schedule, rs, pace);
  check('an order moved to the front is packed first, so the other is the one at risk', rushed.map((x) => x.order.id).join() === 'x1', rushed.map((x) => x.order.id));
  const lateOnes = Array.from({ length: 6 }, (_, i) => ship(`l${i}`, 1100 + i, `Late ${i}`, { promise: promise('2026-10-20'), promiseAt: '2026-10-20T19:00:00.000Z' }));
  const behind = atRiskItems([...lateOnes, dueToday('t1', 1200, 'Tess Moon')], at('14:00'), TZ, schedule, rs, pace);
  check('late orders are packed first, so their work counts before today’s: an hour out, six late ones put today’s at risk',
    behind.map((x) => x.order.id).join() === 't1' && atRiskItems([dueToday('t1', 1200, 'Tess Moon')], at('14:00'), TZ, schedule, rs, pace).length === 0, behind.map((x) => x.order.id));
  check('telling an at-risk customer a new date is offered only in the hour before the pickup, and only to one given a date',
    tellableNow(late, at('13:55')).length === 0 && tellableNow(late, at('14:05')).map((x) => x.order.id).sort().join() === 'a,f' && tellableNow([{ ...late[0], shown: false }], at('14:05')).length === 0);

  // ── Carrier problems ──
  const cg = carrierItem(g, TZ);
  check('a parcel going back to the sender, in plain words', cg?.kind === 'returned' && cg.title === '#1033 is going back to the sender' && cg.detail === 'USPS: address not found. Message Kim about a new one or a refund.' && day.carrier.length === 1, cg);
  check('a seen one is gone', !carrierItem({ ...g, carrierIssue: { ...g.carrierIssue, open: false } }, TZ));
  const quiet = carrierItem({ ...g, carrierIssue: { open: true, status: 'STALLED', quietDays: 5, at: '2026-10-17T15:00:00Z', carrier: 'USPS' } }, TZ);
  check('a parcel gone quiet says when it was last scanned', quiet?.kind === 'stalled' && quiet.title === '#1033 hasn’t moved in 5 days' && /last scanned it Sat, Oct 17/.test(quiet.detail), quiet);
  check('Needs you lists it too', needsYou([g], at('13:00')).some((n) => n.kind === 'carrier' && n.text === 'Kim’s parcel is going back to the sender'));
  const told = carrierItem({ ...g, carrierIssue: { open: true, status: 'STALLED', quietDays: 6, at: '2026-10-16T15:00:00Z', carrier: 'usps', customerTold: true } }, TZ);
  const notTold = carrierItem({ ...g, carrierIssue: { open: true, status: 'STALLED', quietDays: 6, at: '2026-10-16T15:00:00Z', customerTold: false } }, TZ);
  check('a quiet parcel says whether its customer was emailed, as the nightly check recorded it', /Kim has been emailed that it’s running late\./.test(told?.detail || '') && /Kim hasn’t been told\./.test(notTold?.detail || ''), [told?.detail, notTold?.detail]);
  const typed = carrierItem({ ...g, carrierIssue: { open: true, status: 'STALLED', unscanned: true, quietDays: 5, at: '2026-10-17T15:00:00Z', customerTold: true } }, TZ);
  check('one never scanned since it was marked shipped says so, not when it was last scanned', typed?.title === '#1033 hasn’t been scanned in 5 days' && /^Marked shipped Sat, Oct 17, and USPS hasn’t scanned it since\./.test(typed?.detail || ''), typed);
  check('a parcel shared by two orders is counted once, on the order that carries the label', !carrierItem({ ...g, shippedWithOrderId: 'g0' }, TZ) && !needsYou([{ ...g, shippedWithOrderId: 'g0' }], at('13:00')).some((n) => n.kind === 'carrier'));
  check('carriers are named as people write them', carrierName('usps') === 'USPS' && carrierName('dhl_express') === 'DHL Express' && carrierName('canada_post') === 'Canada Post' && carrierName('FedEx Ground') === 'FedEx' && carrierName('') === ''
    && carrierItem({ ...g, carrier: '', carrierIssue: { open: true, status: 'FAILURE', detail: 'Business closed', carrier: 'ups', key: 'k' } }, TZ)?.title === 'UPS couldn’t deliver #1033');

  // ── Counts and queue ──
  check('the Labels count is orders with a label problem for a person', labelWork([{ id: '1', labelRefundDenied: { open: true } }, { id: '2', labelUnscannedOpen: true, shippoTransactionId: 't', stage: 'packed' }, { id: '3', stage: 'paid' }, { id: '1', labelRefundDenied: { open: true } }]) === 2);
  const q = packQueue([dueToday('q1', 1, 'A'), { ...dueToday('q2', 2, 'B'), rushAt: '2026-10-22T17:00:00Z' }], rs, at('13:00'), TZ);
  check('“Pack these first” puts those orders at the front of the queue', q.map((o) => o.id).join() === 'q2,q1');
  const notShipDay = dayPicture({ orders: [], rs, schedule, now: Date.parse('2026-10-24T16:00:00Z'), timeZone: TZ });
  check('a Saturday isn’t a ship day', !notShipDay.shipsToday && notShipDay.ship.total === 0 && notShipDay.shipDay === '2026-10-26');
  const unsaved = dayPicture({ orders: [a], rs: {}, schedule: scheduleFrom({}), now: Date.parse('2026-10-24T16:00:00Z'), timeZone: TZ });
  check('before the shop saves its schedule there’s no cutoff to show, and every day counts', !unsaved.scheduled && unsaved.shipsToday);
  // Veterans Day, Wednesday November 11: USPS doesn't collect, UPS does. New York is five hours behind UTC by then.
  const vet = (pickups: any[]) => { const r = { shipSchedule: { ...rs.shipSchedule, pickups } }; return dayPicture({ orders: [], rs: r, schedule: scheduleFrom(r), now: Date.parse('2026-11-11T17:00:00Z'), timeZone: TZ }); };
  const both = vet([{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '15:00' }, { carrier: 'UPS', days: [1, 2, 3, 4, 5], time: '16:00' }]);
  const uspsOnly = vet([{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '15:00' }]);
  check('a holiday only USPS keeps doesn’t stop a shop that also ships UPS: its cutoff and the UPS pickup show', both.shipsToday && both.cutoff.minutesLeft === 120 && both.pickup?.carrier === 'UPS' && !uspsOnly.shipsToday, [both.shipsToday, both.cutoff, both.pickup, uspsOnly.shipsToday]);
  const released = dueToday('rp', 1300, 'Rae Price', { lines: [{ lineId: 'l1', name: 'Gel', qtyOrdered: 1, preorder: true }], releasedAt: '2026-10-22T12:00:00Z' });
  check('a pre-order released to be packed counts like any order; one still waiting doesn’t', dueBy([released], '2026-10-22', rs, TZ).length === 1 && dueBy([{ ...released, releasedAt: undefined }], '2026-10-22', rs, TZ).length === 0);
  const sat = dayPicture({ orders: [...orders, dueToday('m1', 1060, 'Tia Moss', { promise: promise('2026-10-26'), promiseAt: '2026-10-26T19:00:00.000Z' }), dueToday('m2', 1061, 'Al Pine', { promise: promise('2026-10-27'), promiseAt: '2026-10-27T19:00:00.000Z' })], sentToday: 2, rs, schedule, now: Date.parse('2026-10-24T16:00:00Z'), timeZone: TZ });
  check('on a day off, the count is for the next ship day: what has to go Monday, late ones included, and nothing “sent”',
    sat.ship.total === 6 && sat.ship.sent === 0 && sat.ship.packed === 2 && sat.ship.toGo === 4, sat.ship);

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
