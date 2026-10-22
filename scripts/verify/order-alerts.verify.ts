// Checks the order alerts (lib/order-alerts): who gets each one until they choose (whoever packed lately gets the
// cutoff, managers the rest, the one person packing all four), "usually" from the shop's own history, each alert's
// window and wording, what "missed the pickup" says about customers being told, and the check itself: claimed once a
// day per alert, sent as the app's own notifications to the right people, let go again if they couldn't be written.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-alerts.verify.ts
import { check, failures, makeDb } from './fake-db';
import { alertDefault, alertsDue, checkOrderAlerts, packersOf, usualBy, usualFrom, wantsAlert, type AlertNow, type Usual } from '../../src/lib/order-alerts';
import { scheduleFrom } from '../../src/lib/ship-promise';
import { endOfDay } from '../../src/lib/tenant-time';

const TZ = 'America/New_York';
const rs = { shipSchedule: { processingDays: 1, shipDays: [1, 2, 3, 4, 5], cutoff: '14:00', pickups: [{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '15:00' }], showDates: true, savedAt: '2026-10-01T00:00:00Z', standardTransit: { min: 2, max: 5 } } };
const schedule = scheduleFrom(rs);
// Thursday, October 22, 2026 on the shop's clock (four hours behind UTC).
const at = (hhmm: string, day = '2026-10-22') => { const h = Number(hhmm.slice(0, 2)) + 4; return Date.parse(`${day}T${String(h).padStart(2, '0')}:${hhmm.slice(3)}:00Z`); };
const promise = (day: string, shown = true) => ({ v: 1, source: 'schedule', shipBy: day, shipByAt: `${day}T19:00:00.000Z`, deadlineAt: endOfDay(day, TZ).toISOString(), shown, timeZone: TZ, carrier: 'USPS' });
const dueToday = (id: string, name: string, extra: any = {}) => ({ id, orderNumber: 1000 + id.length, customerName: name, method: 'ship', stage: 'paid', paidAt: '2026-10-21T20:00:00Z', lines: [{ lineId: 'l', name: 'Gel', qtyOrdered: 1 }],
  promise: promise('2026-10-22'), promiseAt: '2026-10-22T19:00:00.000Z', shipPromiseAt: endOfDay('2026-10-22', TZ).toISOString(), ...extra });
const none: Usual = { daily: null, paidByDay: [] };
const now0 = (s: Partial<AlertNow>): AlertNow => ({ due: [], dueToday: [], unpacked: 0, paidToday: 0, usual: none, ...s });

(async () => {
  // ── Who gets what ──
  const owner = { id: 'o1', name: 'Jessica Opal', role: 'owner' };
  const stylist = { id: 's1', name: 'Mia Lane', role: 'staff' };
  const shipper = { id: 's2', name: 'Ava Chen', role: 'staff', fulfilmentRole: 'shipper' };
  const packsByLogin = { id: 's3', name: 'Zoe Hart', role: 'staff', authUid: 'u3' };
  const manager = { id: 'm1', name: 'Rae Moss', role: 'manager' };
  const packingManager = { id: 'm3', name: 'Lou Diaz', role: 'manager' };
  const shopManager = { id: 's5', name: 'Kit Shaw', role: 'staff', fulfilmentRole: 'manager' };
  const gone = { id: 's4', name: 'Old Hand', role: 'staff', archived: true };
  const noAccess = { id: 'm2', name: 'Ned Price', role: 'manager', fulfilmentRole: 'none' };
  const renter = { id: 'r1', name: 'Bo Lane', role: 'renter' };
  const team = [owner, stylist, shipper, packsByLogin, manager, packingManager, shopManager, gone, noAccess, renter];
  const packers = packersOf(team, ['o1', 'u3', 's4', 'm3', 'r1', '']);
  check('who packs: whoever packed lately (matched by their record or their login), and anyone made a shipper; not someone archived, and never a booth renter',
    [...packers].sort().join() === 'm3,o1,s2,s3', [...packers]);
  check('the cutoff goes to whoever packs, managers included; not to the rest of the salon',
    alertDefault('cutoff', owner, packers) && alertDefault('cutoff', shipper, packers) && alertDefault('cutoff', packsByLogin, packers) && alertDefault('cutoff', packingManager, packers) && !alertDefault('cutoff', stylist, packers) && !alertDefault('cutoff', manager, packers));
  check('a big day, coming in fast and missed the pickup go to the owner, the shop’s fulfillment manager and managers who pack; not to a salon manager who never touches the shop',
    (['big_day', 'fast', 'missed'] as const).every((k) => alertDefault(k, owner, packers) && alertDefault(k, packingManager, packers) && alertDefault(k, shopManager, packers) && !alertDefault(k, manager, packers) && !alertDefault(k, shipper, packers) && !alertDefault(k, stylist, packers)));
  const one = packersOf(team, ['u3']);
  check('when one person does the packing, they get all four; the owner still gets hers',
    (['big_day', 'fast', 'cutoff', 'missed'] as const).every((k) => alertDefault(k, { ...packsByLogin, fulfilmentRole: undefined }, packersOf([packsByLogin, owner], ['u3']))) && alertDefault('big_day', owner, packersOf([packsByLogin, owner], ['u3'])) && !alertDefault('cutoff', owner, packersOf([packsByLogin, owner], ['u3'])) && one.has('s3'));
  check('before anyone has packed a shipped order, the cutoff goes to the owner and admins', alertDefault('cutoff', owner, new Set()) && alertDefault('cutoff', { ...manager, role: 'admin' }, new Set()) && !alertDefault('cutoff', manager, new Set()) && !alertDefault('cutoff', stylist, new Set()));
  check('a booth renter never gets the shop’s alerts, even by choice', (['big_day', 'fast', 'cutoff', 'missed'] as const).every((k) => !wantsAlert(k, { ...renter, notificationPrefs: { orderAlerts: { [k]: true } } }, packersOf([renter], ['r1']))));
  check('never someone with no access to orders', (['big_day', 'fast', 'cutoff', 'missed'] as const).every((k) => !alertDefault(k, noAccess, packers) && !alertDefault(k, noAccess, new Set())));
  check('their own choice wins either way',
    !wantsAlert('cutoff', { ...shipper, notificationPrefs: { orderAlerts: { cutoff: false } } }, packers) && wantsAlert('big_day', { ...stylist, notificationPrefs: { orderAlerts: { big_day: true } } }, packers) && wantsAlert('cutoff', shipper, packers));

  // ── Usual ──
  const shippedOn = (day: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${day}-${i}`, method: 'ship', completedAt: `${day}T18:00:00Z` }));
  const shipped = [...shippedOn('2026-10-15', 3), ...shippedOn('2026-10-16', 5), ...shippedOn('2026-10-19', 4), ...shippedOn('2026-10-20', 6), ...shippedOn('2026-10-21', 2),
    ...shippedOn('2026-10-22', 40), ...shippedOn('2026-09-01', 40), { id: 'dl', method: 'ship', digitalOnly: true, completedAt: '2026-10-21T18:00:00Z' }, { id: 'pu', method: 'counter', completedAt: '2026-10-21T18:00:00Z' }];
  const shipDays = ['2026-10-21', '2026-10-20', '2026-10-19', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-09', '2026-10-08'];
  const paid = shipDays.flatMap((d, j) => [8, 9, 9, 10, 13, 16].slice(0, j % 2 ? 6 : 5).map((h, i) => ({ id: `${d}-p${i}`, method: 'ship', paidAt: `${d}T${String(h + 4).padStart(2, '0')}:15:00Z` })));
  const usual = usualFrom(shipped, paid, '2026-10-22', TZ, schedule);
  check('usually shipped: the middle of the shop’s own ship days over four weeks (not today, not older, not downloads or pickups)', usual.daily === 4, usual.daily);
  check('too few days to tell, and it stays quiet', usualFrom(shipped.slice(0, 12), [], '2026-10-22', TZ, schedule).daily === null);
  check('usually paid by now: the middle count by this minute over the last ten ship days', usual.paidByDay.length === 10 && usualBy(usual, 10 * 60 + 15) === 4 && usualBy(usual, 9 * 60) === 1 && usualBy(none, 600) === null, usual.paidByDay.map((l) => l.length));

  // ── When each goes, and what it says ──
  const many = (n: number) => Array.from({ length: n }, (_, i) => dueToday(`d${i}`, `Name${i} X`));
  const big = alertsDue(now0({ due: many(18), usual: { daily: 10, paidByDay: [] } }), at('08:30'), TZ, schedule);
  check('a big day: from 8 AM, more due today than usual by a clear margin', big.length === 1 && big[0].kind === 'big_day' && big[0].title === 'A big day' && big[0].message === '18 orders are due today. You usually ship 10.', big);
  check('not before 8, not after the cutoff, not for a normal day',
    !alertsDue(now0({ due: many(18), usual: { daily: 10, paidByDay: [] } }), at('07:59'), TZ, schedule).length
    && !alertsDue(now0({ due: many(18), usual: { daily: 10, paidByDay: [] } }), at('14:01'), TZ, schedule).some((a) => a.kind === 'big_day')
    && !alertsDue(now0({ due: many(14), usual: { daily: 10, paidByDay: [] } }), at('09:00'), TZ, schedule).length);
  const fourByTen: Usual = { daily: null, paidByDay: Array.from({ length: 10 }, () => [480, 540, 560, 590, 800, 960]) };
  const fast = alertsDue(now0({ paidToday: 9, usual: fourByTen }), at('10:00'), TZ, schedule);
  check('coming in fast: twice the usual by now (and at least eight), to the nearest half', fast.length === 1 && fast[0].title === 'Orders are coming in fast' && fast[0].message === '2.5 times your usual pace today: 9 so far, against 4 by now on a usual day.', fast);
  check('not before 9, not with fewer than eight, not within half an hour of the cutoff',
    !alertsDue(now0({ paidToday: 9, usual: fourByTen }), at('08:55'), TZ, schedule).length && !alertsDue(now0({ paidToday: 7, usual: { daily: null, paidByDay: Array.from({ length: 10 }, () => [480, 500]) } }), at('10:00'), TZ, schedule).length
    && !alertsDue(now0({ paidToday: 20, usual: fourByTen }), at('13:40'), TZ, schedule).some((a) => a.kind === 'fast'));
  const cut = alertsDue(now0({ due: many(3), unpacked: 3 }), at('13:00'), TZ, schedule);
  check('the cutoff: about an hour before it, while orders due today aren’t packed', cut.length === 1 && cut[0].title === 'Cutoff in 1 hour' && cut[0].message === '3 orders due today aren’t packed yet.', cut);
  check('not at 70 minutes, not at 35, not when everything is packed',
    !alertsDue(now0({ unpacked: 3 }), at('12:50'), TZ, schedule).length && !alertsDue(now0({ unpacked: 3 }), at('13:25'), TZ, schedule).length && !alertsDue(now0({ unpacked: 0 }), at('13:00'), TZ, schedule).length);

  const priya = dueToday('a', 'Priya Shah');
  const kim = dueToday('k', 'Kim Lee');
  const kara = dueToday('h', 'Kara Bell', { holdForReview: true });
  const noDate = dueToday('n', 'Nia Cole', { promise: promise('2026-10-22', false) });
  const labeledBox = dueToday('b', 'Owen Park', { stage: 'packed', trackingNumber: '9400' });
  const missed = (list: any[], t = at('15:06'), when = '2026-10-22') => alertsDue(now0({ due: list, dueToday: list }), t, TZ, schedule).find((a) => a.kind === 'missed') && alertsDue(now0({ due: list, dueToday: list }), t, TZ, schedule).find((a) => a.kind === 'missed')!;
  const m1 = missed([priya, labeledBox, kara, noDate]);
  check('missed the pickup: still unlabeled after it (a labeled box may have gone), who to tell, and who hears by themselves',
    m1?.title === '3 orders missed the pickup' && m1.message === 'Tell Kara it ships tomorrow? Priya hears the new date after 4:00 PM.' && m1.link === '/retail-orders?view=late', m1);
  check('when everyone is told by themselves, it says so, and that labeling first stops it',
    missed([priya])?.message === 'Priya hears after 4:00 PM that the order ships tomorrow, unless it’s labeled first.' && missed([priya, kim])?.message === 'Priya and Kim hear after 4:00 PM that their orders ship tomorrow, unless they’re labeled first.', [missed([priya])?.message, missed([priya, kim])?.message]);
  check('nobody to tell when no date was given', missed([noDate])?.message === 'It goes out tomorrow. No date was given to its customer, so nobody needs telling.', missed([noDate])?.message);
  check('a few minutes’ grace after the pickup, and nothing once everything is labeled', !missed([priya], at('15:04')) && !missed([labeledBox]));
  const fri = [dueToday('f', 'Fay Dunn', { promise: promise('2026-10-23'), promiseAt: '2026-10-23T19:00:00.000Z', shipPromiseAt: endOfDay('2026-10-23', TZ).toISOString() })];
  check('on a Friday, the next ship day is Monday', alertsDue(now0({ due: fri, dueToday: fri }), at('15:06', '2026-10-23'), TZ, schedule).find((a) => a.kind === 'missed')?.message === 'Fay hears after 4:00 PM that the order ships on Monday, unless it’s labeled first.');
  // Pickups Monday, Wednesday and Friday: missed on Monday, it goes Wednesday, as the late notice and the Late list say.
  const mwf = scheduleFrom({ shipSchedule: { ...rs.shipSchedule, pickups: [{ carrier: 'USPS', days: [1, 3, 5], time: '15:00' }] } });
  const mon = [dueToday('w', 'Wes Hale', { promise: promise('2026-10-26'), promiseAt: '2026-10-26T19:00:00.000Z', shipPromiseAt: endOfDay('2026-10-26', TZ).toISOString() })];
  const onMon = alertsDue(now0({ due: mon, dueToday: mon }), at('15:06', '2026-10-26'), TZ, mwf).find((a) => a.kind === 'missed');
  check('the day named is the next day its carrier collects, not just the next ship day', onMon?.message === 'Wes hears after 4:00 PM that the order ships on Wednesday, unless it’s labeled first.', onMon?.message);
  const ups = dueToday('u', 'Uma Park', { promise: { ...promise('2026-10-26'), carrier: 'UPS' }, promiseAt: '2026-10-26T19:00:00.000Z', shipPromiseAt: endOfDay('2026-10-26', TZ).toISOString() });
  const mixed = alertsDue(now0({ due: [...mon, ups], dueToday: [...mon, ups] }), at('18:10', '2026-10-26'), TZ, mwf).find((a) => a.kind === 'missed');
  check('orders that now go on different days aren’t given one: each hears their own, after the later of their times', mixed?.title === '2 orders missed the pickup' && mixed.message === 'Wes and Uma hear their new dates after 7:00 PM, unless they’re labeled first.', mixed?.message);
  check('nothing on a day the shop doesn’t ship', !alertsDue(now0({ due: many(30), unpacked: 30, usual: { daily: 2, paidByDay: [] } }), at('10:00', '2026-10-24'), TZ, schedule).length);

  // ── The check ──
  const db = makeDb();
  const T = 'tenants/t1';
  const tenant = { name: 'Opal', timezone: TZ, retailSettings: rs };
  await db.doc(T).set(tenant);
  for (const m of [owner, stylist, { ...packsByLogin }, manager]) await db.doc(`${T}/staff/${m.id}`).set(m);
  for (const o of [dueToday('x1', 'Ana Ruiz'), dueToday('x2', 'Ben Fox'), dueToday('x3', 'Cy Gold', { stage: 'picking', claimedBy: 'u3', claimedAt: '2026-10-22T16:00:00Z' }),
    dueToday('x4', 'Dee Hall', { stage: 'packed', claimedBy: 'o1', packedAt: '2026-10-22T15:00:00Z', trackingNumber: '9401' }),
    dueToday('x5', 'Eve Ives', { holdUntilRestock: true }),
    { id: 'old', method: 'ship', stage: 'completed', claimedBy: 'u3', packedAt: '2026-10-19T15:00:00Z', completedAt: '2026-10-19T18:00:00Z' }])
    await db.doc(`${T}/retailOrders/${o.id}`).set(o);
  const notes = () => [...db._store.entries()].filter(([p]: any) => p.startsWith(`${T}/notifications/`)).map(([, d]: any) => d);
  const r1 = await checkOrderAlerts(db, 't1', tenant, { now: at('13:05') });
  const n1 = notes();
  check('at 1:05, the cutoff goes to the people packing (the owner and Zoe), not the stylist or a manager who doesn’t pack; waiting on stock isn’t counted',
    r1.sent === 1 && n1.map((n: any) => n.userId).sort().join() === 'o1,s3' && n1.every((n: any) => n.type === 'orders_cutoff' && n.title === 'Cutoff in 1 hour' && n.message === '3 orders due today aren’t packed yet.' && n.link === '/retail-orders' && n.priority === 'high' && n.read === false && n.createdAt === new Date(at('13:05')).toISOString() && n.id), n1);
  const dayDoc: any = db._store.get(`${T}/private/order-alerts-2026-10-22`);
  check('claimed on the day’s record, with the usual numbers kept there (a list of lists stored as {m})', !!dayDoc?.sent?.cutoff && dayDoc.usual?.daily === null && Array.isArray(dayDoc.usual?.paidByDay) && dayDoc.usual.paidByDay.every((x: any) => Array.isArray(x.m)), dayDoc);
  const r2 = await checkOrderAlerts(db, 't1', tenant, { now: at('13:15') });
  check('ten minutes later, nothing goes twice', r2.sent === 0 && notes().length === 2);
  const r3 = await checkOrderAlerts(db, 't1', tenant, { now: at('15:10') });
  const n3 = notes().filter((n: any) => n.type === 'orders_missed');
  check('after the pickup, missed goes to the owner (not a manager who doesn’t pack), naming who hears by themselves; the labeled box and the backorder aren’t in it',
    r3.sent === 1 && n3.map((n: any) => n.userId).sort().join() === 'o1' && n3[0].title === '3 orders missed the pickup' && n3[0].message === 'Ana, Ben and 1 other hear after 4:00 PM that their orders ship tomorrow, unless they’re labeled first.' && n3[0].link === '/retail-orders?view=late', n3);

  // A batch that can't be written lets its claim go, so the next check sends it.
  const db2 = makeDb();
  await db2.doc(T).set(tenant);
  await db2.doc(`${T}/staff/o1`).set(owner);
  await db2.doc(`${T}/retailOrders/y1`).set(dueToday('y1', 'Ana Ruiz'));
  const realBatch = db2.batch; let failOnce = true;
  db2.batch = () => { const b = realBatch(); if (failOnce) { failOnce = false; return { ...b, commit: async () => { throw new Error('unavailable'); } }; } return b; };
  const f1 = await checkOrderAlerts(db2, 't1', tenant, { now: at('13:05') });
  const f2 = await checkOrderAlerts(db2, 't1', tenant, { now: at('13:15') });
  check('a notification that couldn’t be written is sent on the next check', f1.sent === 0 && f2.sent === 1 && [...db2._store.keys()].filter((p: any) => p.startsWith(`${T}/notifications/`)).length === 1, { f1, f2 });
  const db3 = makeDb();
  await db3.doc(T).set(tenant);
  await db3.doc(`${T}/staff/o1`).set(owner);
  await db3.doc(`${T}/retailOrders/z1`).set(dueToday('z1', 'Ana Ruiz'));
  const early = await checkOrderAlerts(db3, 't1', tenant, { now: at('07:30') });
  const late3 = await checkOrderAlerts(db3, 't1', tenant, { now: Date.parse('2026-10-23T01:10:00Z') });   // 9:10 PM
  check('nothing is read before 8 AM, or three hours after the day’s last miss (the end of the shipping day, 6 PM, for a carrier with no pickup listed)', early.sent === 0 && late3.sent === 0 && !db3._store.has(`${T}/private/order-alerts-2026-10-22`));
  // Veterans Day, Wednesday November 11: USPS doesn't collect, UPS does (New York is five hours behind UTC by then).
  const db4 = makeDb();
  const rsVet = { shipSchedule: { ...rs.shipSchedule, pickups: [{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '15:00' }, { carrier: 'UPS', days: [1, 2, 3, 4, 5], time: '15:00' }] } };
  const tVet = { ...tenant, retailSettings: rsVet };
  await db4.doc(T).set(tVet);
  await db4.doc(`${T}/staff/o1`).set(owner);
  await db4.doc(`${T}/retailOrders/v1`).set({ ...dueToday('v1', 'Vi Lane'), promise: { ...promise('2026-11-11'), carrier: 'UPS' }, promiseAt: '2026-11-11T20:00:00.000Z', shipPromiseAt: endOfDay('2026-11-11', TZ).toISOString() });
  const vet = await checkOrderAlerts(db4, 't1', tVet, { now: Date.parse('2026-11-11T18:05:00Z') });
  check('a holiday only USPS keeps doesn’t silence a shop that ships UPS that day', vet.sent === 1 && [...db4._store.values()].some((d: any) => d?.type === 'orders_cutoff'), vet);
  // Only shipped orders count as packing: getting a pickup order ready at the desk isn't.
  const db5 = makeDb();
  await db5.doc(T).set(tenant);
  for (const m of [owner, stylist]) await db5.doc(`${T}/staff/${m.id}`).set(m);
  await db5.doc(`${T}/retailOrders/k1`).set({ id: 'k1', method: 'counter', stage: 'ready', claimedBy: 's1', packedAt: '2026-10-22T14:00:00Z' });
  await db5.doc(`${T}/retailOrders/k2`).set(dueToday('k2', 'Ana Ruiz'));
  await checkOrderAlerts(db5, 't1', tenant, { now: at('13:05') });
  const n5 = [...db5._store.entries()].filter(([p]: any) => p.startsWith(`${T}/notifications/`)).map(([, d]: any) => d.userId);
  check('someone who only gets pickup orders ready isn’t sent the shipping cutoff', n5.join() === 'o1', n5);
  check('a shop without a saved schedule, or on a Saturday, isn’t checked',
    (await checkOrderAlerts(db, 't1', { ...tenant, retailSettings: {} }, { now: at('13:05') })).sent === 0 && (await checkOrderAlerts(db, 't1', tenant, { now: at('13:05', '2026-10-24') })).sent === 0);

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nall good');
})();
