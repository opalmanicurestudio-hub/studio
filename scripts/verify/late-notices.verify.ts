// Checks running-late notices end to end on an in-memory database: an order that misses the ship-by day its customer
// was shown is told the next date by itself, at most twice, then handed to the team; held, labeled, pre-ordered and
// never-shown orders are left alone; a date moved by hand counts. Also the team's due times from the schedule, the
// dates customers read, and the order page's words.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/late-notices.verify.ts
import { makeDb } from './fake-db';
import { lateCall, sweepLateOrders } from '../../src/lib/late-notices';
import { sendDelayNotice } from '../../src/lib/delay-notice';
import { customerDates, normalizeSchedule, orderPromise } from '../../src/lib/ship-promise';
import { dueAt, fulfilmentPolicy } from '../../src/lib/retail-orders';
import { dueLine, needsYou } from '../../src/lib/orders-view';
import { orderNow } from '../../src/lib/order-now';

let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const NY = 'America/New_York';
const sched = {
  processingDays: 1, shipDays: [1, 2, 3, 4, 5], cutoff: '14:00', pickups: [{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '15:00' }],
  standardTransit: { min: 2, max: 5 }, showDates: true, savedAt: '2026-10-01T12:00:00.000Z',
};
const schedule = normalizeSchedule(sched);
const tenant = { businessName: 'Opal Studio', timezone: NY, retailSettings: { shipSchedule: sched } };
const placed = '2026-10-21T19:12:00.000Z'; // Wed 3:12 PM in New York
const promise = orderPromise({ at: placed, timeZone: NY, schedule, lines: [{}], carrier: 'USPS', service: 'Ground Advantage', transitDays: 3 });
const base = (over: any = {}) => ({
  method: 'ship', stage: 'paid', orderNumber: 1042, customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', customerPhone: '',
  lines: [{ name: 'Velvet Gel Kit', qtyOrdered: 1 }], paidAt: placed, placedAt: placed, promise, promiseAt: promise.shipByAt,
  shipPromiseAt: promise.deadlineAt, shippingCarrier: 'USPS', lateWatch: true, ...over,
});
const at = (iso: string) => new Date(iso);

(async () => {
  ok(promise.shown === true && promise.shipBy === '2026-10-23' && promise.arriveFrom === '2026-10-26' && promise.arriveTo === '2026-10-28',
    'the order: ships by Fri Oct 23, arrives Oct 26–28 (USPS about 3 days)');

  // What to do, order by order.
  const fri330 = at('2026-10-23T19:30:00Z'), fri410 = at('2026-10-23T20:10:00Z');
  ok(lateCall(base(), fri330, NY, schedule).act === 'none', 'half an hour after the pickup: not yet');
  const c = lateCall(base(), fri410, NY, schedule);
  ok(c.act === 'notify' && (c as any).missed === '2026-10-23' && (c as any).revised === '2026-10-26', 'an hour after Friday’s pickup with no label: tell them it now ships Monday');
  ok(lateCall(base({ trackingNumber: '9400' }), fri410, NY, schedule).act === 'none', 'a box already labeled is on its way out');
  ok(lateCall(base({ promise: { ...promise, shown: false } }), fri410, NY, schedule).act === 'none', 'never shown a date: not told one');
  ok(lateCall(base({ lines: [{ preorder: true }] }), fri410, NY, schedule).act === 'none', 'pre-orders move with their run');
  ok(lateCall(base({ holdUntilRestock: true }), fri410, NY, schedule).act === 'none', 'waiting on stock they chose to wait for');
  ok(lateCall(base({ stage: 'shipped' }), fri410, NY, schedule).act === 'none', 'shipped');
  ok(lateCall(base({ holdForReview: true }), fri410, NY, schedule).act === 'staff', 'held for review: the team decides');
  ok(lateCall(base({ autoDelayNotices: 2 }), fri410, NY, schedule).act === 'staff', 'told twice already: the team decides');
  ok(lateCall(base({ shipPromiseAt: '2026-10-27T03:59:59.000Z', notifiedForPromiseAt: '2026-10-27T03:59:59.000Z' }), fri410, NY, schedule).act === 'none',
    'someone already moved it to Monday by hand: nothing to say on Friday');

  // End to end.
  const db = makeDb();
  await db.doc('tenants/t1').set(tenant);
  await db.doc('tenants/t1/retailOrders/a').set(base());
  await db.doc('tenants/t1/retailOrders/held').set(base({ holdForReview: true, orderNumber: 1043, customerName: 'Rae Kim' }));
  await db.doc('tenants/t1/retailOrders/quiet').set(base({ promise: { ...promise, shown: false }, orderNumber: 1044 }));
  await db.doc('tenants/t1/retailOrders/labeled').set(base({ stage: 'packed', shippoTransactionId: 'tx', trackingNumber: '9400', orderNumber: 1045 }));
  const get = async (id: string) => (await db.doc(`tenants/t1/retailOrders/${id}`).get()).data();

  let r = await sweepLateOrders(db, 't1', tenant, { now: fri410, origin: 'https://shop.test' });
  let a = await get('a');
  ok(r.notified === 1 && r.handed === 1 && r.checked === 3, 'Friday 4:10 PM: one told, one handed to the team, three looked at');
  ok(a.shipPromiseAt === '2026-10-27T03:59:59.000Z' && a.notifiedForPromiseAt === a.shipPromiseAt && a.promiseRevisions === 1 && a.autoDelayNotices === 1,
    'the order now promises the end of Monday, counted as one automatic notice');
  ok(a.promiseAt === '2026-10-26T19:00:00.000Z', 'and the team’s due time is Monday’s 3 PM pickup');
  const evs = [...db._store.entries()].filter(([p]: any) => p.startsWith('tenants/t1/retailOrders/a/events/')).map(([, d]: any) => d);
  ok(evs.some((e: any) => e.meta?.kind === 'delay_notice' && e.meta.auto === true && e.meta.text === 'Running late, told automatically: now ships by Mon, Oct 26 (was Fri, Oct 23)'),
    'the timeline says what was sent, with both dates');
  const cards = [...db._store.entries()].filter(([p]: any) => p.startsWith('tenants/t1/retailOrders/a/inbox/')).map(([, d]: any) => d);
  ok(cards.some((x: any) => x.title === 'Your order #1042 is running behind and now ships by Mon, Oct 26. You can wait, or cancel for a full refund:' && /cancel/i.test(x.body)),
    'the order page has the full notice, and the nudge names the new date and the right to cancel');
  const held = await get('held');
  ok(held.lateNeedsStaff?.open === true && held.lateNeedsStaff.why === 'held' && !held.notifiedForPromiseAt, 'the held order is under Needs you, the customer not told');
  ok((await get('quiet')).notifiedForPromiseAt === undefined && (await get('labeled')).notifiedForPromiseAt === undefined, 'the others are left alone');
  ok((await get('quiet')).lateWatch === false && (await get('labeled')).lateWatch === true, 'an order never told a date stops being read; a labeled one is still watched until it ships');
  await db.doc('tenants/t1/retailOrders/draft').set(base({ stage: 'placed', orderNumber: null }));
  await sweepLateOrders(db, 't1', tenant, { now: fri410 });
  ok((await get('draft')).lateWatch === true, 'an order still being paid for keeps its place on the watch list');
  await db.doc('tenants/t1/retailOrders/draft').set({ stage: 'cancelled' }, { merge: true });

  r = await sweepLateOrders(db, 't1', tenant, { now: at('2026-10-23T21:10:00Z') });
  ok(r.notified === 0 && r.handed === 0 && (await get('a')).promiseRevisions === 1, 'an hour later: nothing new, nobody told twice');

  r = await sweepLateOrders(db, 't1', tenant, { now: at('2026-10-26T20:10:00Z') });
  a = await get('a');
  ok(r.notified === 1 && a.autoDelayNotices === 2 && a.shipPromiseAt === '2026-10-28T03:59:59.000Z', 'missed Monday too: told again, now Tuesday');

  r = await sweepLateOrders(db, 't1', tenant, { now: at('2026-10-27T20:10:00Z') });
  a = await get('a');
  ok(r.notified === 0 && a.lateNeedsStaff?.open === true && a.lateNeedsStaff.why === 'again' && a.autoDelayNotices === 2, 'a third miss goes to the team, not the customer');
  const needs = needsYou([{ id: 'a', ...a }], Date.parse('2026-10-27T20:10:00Z'));
  ok(needs.some((n) => n.kind === 'late' && n.text === 'Dana’s order missed its new ship-by date'), 'Needs you says so');
  r = await sweepLateOrders(db, 't1', tenant, { now: at('2026-10-27T22:10:00Z') });
  ok(r.handed === 0, 'and says it once');

  const manual = await sendDelayNotice(db, { tenantId: 't1', orderId: 'a', revisedDate: '2026-10-29', note: 'The new batch lands Thursday.', actor: { id: 'u1', name: 'Jessica' }, now: at('2026-10-27T22:30:00Z') });
  a = await get('a');
  ok(manual.sent && a.shipPromiseAt === '2026-10-30T03:59:59.000Z' && a.lateNeedsStaff === null && a.autoDelayNotices === 2 && a.promiseRevisions === 3,
    'someone sends Thursday by hand: the customer is told, the Needs you item clears');
  const again = await sendDelayNotice(db, { tenantId: 't1', orderId: 'a', revisedDate: '2026-10-29', actor: { id: 'u1', name: 'Jessica' }, now: at('2026-10-27T22:31:00Z') });
  ok(!again.sent, 'the same date twice sends nothing');
  const past = await sendDelayNotice(db, { tenantId: 't1', orderId: 'a', revisedDate: '2026-10-26', actor: { id: 'u1', name: 'Jessica' }, now: at('2026-10-27T22:31:00Z') });
  ok(!past.sent && past.why === 'The new date has to be today or later.', 'a date already gone is refused');
  const odd = await sendDelayNotice(db, { tenantId: 't1', orderId: 'a', revisedDate: '2026-13-01', actor: { id: 'u1', name: 'Jessica' }, now: at('2026-10-27T22:31:00Z') });
  ok(!odd.sent && odd.why === 'Choose a new ship-by date.', 'a date that doesn’t exist is refused');
  const gone = await sendDelayNotice(db, { tenantId: 't1', orderId: 'a', revisedDate: '2026-10-27', actor: { id: 'u1', name: 'Jessica' }, now: at('2026-10-27T22:31:00Z') });
  ok(!gone.sent && gone.why === 'Today’s last pickup has gone. Choose tomorrow or later.', 'today, after today’s last pickup, is refused');

  // The dates customers read, after the moves.
  const d = customerDates(a, NY);
  ok(!!d && d.shipBy === '2026-10-29' && d.originalShipBy === '2026-10-23' && d.arriveFrom === '2026-10-31' && d.arriveTo === '2026-11-03',
    'their order page: ships by Thursday (was Friday), arrives Oct 31 – Nov 3 from the new date');
  const now1 = orderNow({ ...a, dates: d, stage: 'paid' });
  ok(!!now1 && now1.title === 'Running behind' && now1.body.startsWith('It now ships by Thursday, Oct 29') && /cancel for a full refund/.test(now1.body), 'the top of the page says it plainly');
  const fresh = customerDates(base(), NY)!;
  const now2 = orderNow({ ...base(), dates: fresh });
  ok(!!now2 && now2.body === 'It ships by Friday, Oct 23 and should arrive Mon, Oct 26 – Wed, Oct 28. We’ll email you tracking as soon as it does.', 'an order on time: the date and arrival');
  ok(customerDates(base({ promise: { ...promise, shown: false } }), NY) === null, 'never shown: no dates on the page');

  // The team's due times.
  const pol = fulfilmentPolicy(tenant.retailSettings, NY);
  ok(dueAt(base({ promise: undefined, promiseAt: undefined }) as any, pol) === Date.parse('2026-10-23T19:00:00.000Z'), 'an older order with no promise: due by the schedule (Friday’s pickup), not 24 hours');
  ok(dueAt(base({ promise: undefined, promiseAt: undefined, parentOrderId: 'p', placedAt: '2026-10-22T14:00:00.000Z' }) as any, pol) === Date.parse('2026-10-23T19:00:00.000Z'),
    'a backorder split off Thursday counts from Thursday, not the parent’s payment');
  ok(dueAt(base({ promise: undefined, promiseAt: undefined, parentOrderId: 'p', placedAt: '2026-10-22T14:00:00.000Z', releasedAt: '2026-10-26T13:00:00.000Z' }) as any, pol) === Date.parse('2026-10-27T19:00:00.000Z'),
    'released Monday morning: due Tuesday’s pickup');
  ok(dueLine(base(), tenant.retailSettings, Date.parse('2026-10-23T14:00:00Z'), NY).text === 'Ships today'
    && dueLine(base(), tenant.retailSettings, Date.parse('2026-10-22T14:00:00Z'), NY).text === 'Ships tomorrow', 'the board: ships today, tomorrow');
  ok(dueLine(base({ stage: 'packed', labelUrl: 'x', shippoTransactionId: 'tx' }), tenant.retailSettings, Date.parse('2026-10-23T21:00:00Z'), NY).text === 'Label bought · ships today',
    'a labeled box isn’t called late');
  const late = dueLine(base({ stage: 'packed' }), tenant.retailSettings, Date.parse('2026-10-23T22:00:00Z'), NY);
  ok(late.late && late.text === 'Needs a label · 3 hours late', 'a packed box with no label after the pickup is late');
  ok(dueLine(base(), tenant.retailSettings, Date.parse('2026-10-24T02:00:00Z'), NY).text === '7 hours late', 'late is counted from the pickup');
  ok(dueLine(base({ promise: undefined, promiseAt: undefined, paidAt: '2026-10-22T17:30:00Z' }), tenant.retailSettings, Date.parse('2026-10-23T03:00:00Z'), NY).text === 'Ships tomorrow',
    'paid Thursday 1:30 PM, looked at 11 PM Thursday in New York (already Friday in UTC): ships tomorrow, read on the shop’s clock');

  // Same-day shipping after the carrier has been: told the next pickup day, never "running late" an hour later.
  {
    const sd = normalizeSchedule({ ...sched, processingDays: 0, cutoff: '16:00' });
    const p = orderPromise({ at: '2026-10-21T19:55:00Z', timeZone: NY, schedule: sd, lines: [{}], carrier: 'USPS', transitDays: 3 });
    ok(p.shipBy === '2026-10-22', 'a same-day order at 3:55 PM, after the 3 PM pickup: ships Thursday');
    ok(lateCall(base({ promise: p, promiseAt: p.shipByAt, shipPromiseAt: p.deadlineAt }), at('2026-10-21T20:25:00Z'), NY, sd).act === 'none', 'and nobody tells them it’s late at 4:25 PM');
    const two = normalizeSchedule({ ...sched, processingDays: 0, pickups: [{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '11:00' }, { carrier: 'UPS', days: [1, 2, 3, 4, 5], time: '17:00', kind: 'dropoff' }] });
    const usps = orderPromise({ at: '2026-10-21T16:00:00Z', timeZone: NY, schedule: two, lines: [{}], carrier: 'USPS', transitDays: 3 });
    ok(usps.shipBy === '2026-10-22' && lateCall(base({ promise: usps, promiseAt: usps.shipByAt, shipPromiseAt: usps.deadlineAt }), at('2026-10-21T16:25:00Z'), NY, two).act === 'none',
      'USPS gone at 11, a noon USPS order ships Thursday: no notice at 12:25');
  }

  // A pre-order is watched but left alone while its line waits; refunded, the rest of the order is checked.
  {
    const pre = base({ lines: [{ name: 'Kit', preorder: true, status: 'pending' }, { name: 'Oil' }] });
    ok(lateCall(pre, fri410, NY, schedule).act === 'none', 'a waiting pre-order line: nothing said');
    ok(lateCall(base({ lines: [{ name: 'Kit', preorder: true, status: 'refunded' }, { name: 'Oil' }] }), fri410, NY, schedule).act === 'notify', 'its line refunded: the rest is late like any order');
  }

  // The shop's own flat rate is never taken for a carrier.
  {
    const tf = normalizeSchedule({ ...sched, pickups: [{ carrier: 'USPS', days: [2, 5], time: '15:00' }, { carrier: 'UPS', days: [2, 5], time: '17:00' }] });
    const p = orderPromise({ at: '2026-10-19T14:00:00Z', timeZone: NY, schedule: tf, lines: [{}], carrier: 'Shop', service: 'Standard shipping', transitDays: null });
    ok(p.carrier === null && p.shipBy === '2026-10-20', 'a flat-rate order with two carriers listed: any carrier, ships Tuesday');
    const c = lateCall(base({ promise: p, promiseAt: p.shipByAt, shipPromiseAt: p.deadlineAt, shippingCarrier: 'Shop' }), at('2026-10-20T22:10:00Z'), NY, tf);
    ok(c.act === 'notify' && (c as any).revised === '2026-10-23', 'missed Tuesday’s last pickup (UPS at 5): now ships Friday, the next day anyone collects');
  }

  // A notice for a customer who was never shown a date doesn't quote the team's date.
  {
    const quietDb = makeDb();
    await quietDb.doc('tenants/t1').set(tenant);
    await quietDb.doc('tenants/t1/retailOrders/q').set(base({ orderNumber: 1050, promise: { ...promise, shown: false }, shipPromiseAt: '2026-11-21T04:59:59.000Z', lateWatch: false }));
    const r1 = await sendDelayNotice(quietDb, { tenantId: 't1', orderId: 'q', revisedDate: '2026-11-04', actor: { id: 'u1', name: 'Jessica' }, now: at('2026-10-27T15:00:00Z') });
    const q = (await quietDb.doc('tenants/t1/retailOrders/q').get()).data();
    const ev = [...quietDb._store.entries()].filter(([p]: any) => p.startsWith('tenants/t1/retailOrders/q/events/')).map(([, d]: any) => d)[0];
    const card = [...quietDb._store.entries()].filter(([p]: any) => p.startsWith('tenants/t1/retailOrders/q/inbox/')).map(([, d]: any) => d)[0];
    ok(r1.sent && ev?.meta?.text === 'Delay notice sent: now ships by Wed, Nov 4' && !/Oct 23|instead of/.test(String(card?.body || '')),
      'never shown a date: the notice names the new date only, not the team’s own');
    ok(card?.title === 'Your order #1050 now ships by Wed, Nov 4. You can wait, or cancel for a full refund:', 'with the right to cancel');
    ok(q.lateWatch === true && lateCall(q, at('2026-11-04T21:30:00Z'), NY, schedule).act === 'notify', 'now they’ve been told a date, a miss of it is told too');
    await sendDelayNotice(quietDb, { tenantId: 't1', orderId: 'q', revisedDate: '2026-11-06', actor: { id: 'u1', name: 'Jessica' }, now: at('2026-10-27T15:01:00Z') });
    const cardsQ = [...quietDb._store.entries()].filter(([p]: any) => p.startsWith('tenants/t1/retailOrders/q/inbox/')).map(([, d]: any) => d.title);
    ok(cardsQ.length === 2 && cardsQ.some((t: string) => /Fri, Nov 6/.test(t)), 'a second new date a minute later is its own card on the order page');
  }

  // A labeled box doesn't read as late to the customer, unless the carrier never scanned it.
  {
    const { isPromiseLate } = await import('../../src/lib/retail-orders');
    const old = { stage: 'packed', lines: [], shipPromiseAt: '2026-10-01T03:59:59.000Z' } as any;
    ok(isPromiseLate(old) && !isPromiseLate({ ...old, trackingNumber: '9400' }) && isPromiseLate({ ...old, trackingNumber: '9400', labelUnscannedOpen: true }),
      'past the date: late with no label, not late with one, late again if the carrier never scanned it');
  }

  // Every watched order is reached, a page at a time.
  {
    const big = makeDb();
    await big.doc('tenants/t1').set(tenant);
    for (let i = 0; i < 305; i++) await big.doc(`tenants/t1/retailOrders/o${String(i).padStart(3, '0')}`).set(base({ orderNumber: 2000 + i, trackingNumber: i === 304 ? '' : `94${i}` }));
    const r = await sweepLateOrders(big, 't1', tenant, { now: fri410 });
    ok(r.checked === 305 && r.notified === 1 && (await big.doc('tenants/t1/retailOrders/o304').get()).data().autoDelayNotices === 1, 'the one late order of 305 is found on the second page');
  }

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
