// Checks the ship-by dates: the cutoff, ship days, carrier holidays and closures, pickup days, made-to-order and
// pre-order items, busy periods, daylight saving, the arrival window, and the words customers read.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ship-promise.verify.ts
import {
  arrivalLabel, carrierHolidays, carrierKey, clockLabel, countdownFor, cutoffInfo, holidayOn, isCalendarDay, isShipDay, lastPickupAt, promiseCarrier,
  leadOf, minutesLabel, missedAt, normalizeSchedule, processingSentence, productPromise, promiseFor, promisedDay,
  revisedShipBy, scheduleFrom, shortRange, showsDates, startsReason, transitWindow, type ShipSchedule,
} from '../../src/lib/ship-promise';

let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const base = (over: any = {}): ShipSchedule => normalizeSchedule({
  processingDays: 1, shipDays: [1, 2, 3, 4, 5], cutoff: '14:00',
  pickups: [{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '15:00' }],
  standardTransit: { min: 2, max: 5 }, showDates: true, savedAt: '2026-10-01T12:00:00.000Z', ...over,
});
const std = { min: 2, max: 5 };

// The scenario on the design board: Wednesday after the cutoff.
{
  const p = promiseFor({ at: '2026-10-21T19:12:00Z', timeZone: NY, schedule: base(), carrier: 'USPS', transit: std });
  ok(p.startsOn === '2026-10-22' && p.shipBy === '2026-10-23', 'Wed 3:12 PM, after the 2 PM cutoff: starts Thursday, ships by Friday');
  ok(p.shipByAt === '2026-10-23T19:00:00.000Z', 'the team’s deadline is Friday’s 3 PM pickup');
  ok(p.deadlineAt === '2026-10-24T03:59:59.000Z', 'the customer’s deadline is the end of Friday on the shop’s clock');
  ok(p.arriveFrom === '2026-10-26' && p.arriveTo === '2026-10-29', 'arrives Mon Oct 26 – Thu Oct 29 (2–5 days, USPS skips Sunday)');
  ok(p.why.includes('after_cutoff') && startsReason(p, base()) === 'After the 2:00 PM cutoff, so it starts Thursday.', 'it says why');
  ok(arrivalLabel(p, NY) === 'Mon, Oct 26 – Thu, Oct 29', 'the arrival in words');
}
{
  const p = promiseFor({ at: '2026-10-21T15:47:00Z', timeZone: NY, schedule: base(), carrier: 'USPS', transit: std });
  ok(p.startsOn === '2026-10-21' && p.shipBy === '2026-10-22' && p.arriveFrom === '2026-10-24' && p.arriveTo === '2026-10-28',
    'Wed 11:47 AM, before the cutoff: ships by Thursday, arrives Sat Oct 24 – Wed Oct 28');
  ok(startsReason(p, base()) === 'Processing starts the same day.', 'before the cutoff it starts that day');
}
ok(promiseFor({ at: '2026-10-23T19:00:00Z', timeZone: NY, schedule: base() }).shipBy === '2026-10-27', 'Friday after the cutoff: starts Monday, ships by Tuesday');
{
  const p = promiseFor({ at: '2026-10-24T14:00:00Z', timeZone: NY, schedule: base() });
  ok(p.startsOn === '2026-10-26' && p.shipBy === '2026-10-27' && p.why.includes('not_ship_day'), 'Saturday morning: starts Monday');
}
ok(promiseFor({ at: '2026-10-21T18:00:00Z', timeZone: NY, schedule: base() }).startsOn === '2026-10-22', 'exactly 2:00 PM counts as after the cutoff');

// The shop's own clock, not the server's.
ok(promiseFor({ at: '2026-10-21T20:30:00Z', timeZone: LA, schedule: base() }).startsOn === '2026-10-21'
  && promiseFor({ at: '2026-10-21T20:30:00Z', timeZone: NY, schedule: base() }).startsOn === '2026-10-22',
  'the same moment is before the cutoff in Los Angeles and after it in New York');
ok(promiseFor({ at: '2026-10-22T03:30:00Z', timeZone: NY, schedule: base() }).startsOn === '2026-10-22',
  '11:30 PM Wednesday in New York (already Thursday in UTC) starts Thursday, not Friday');

// Carrier holidays and closures.
{
  const p = promiseFor({ at: '2026-11-25T20:00:00Z', timeZone: NY, schedule: base(), transit: std });
  ok(p.startsOn === '2026-11-27' && p.shipBy === '2026-11-30' && p.why.includes('holiday'), 'the day before Thanksgiving after the cutoff: starts Friday, ships by Monday');
}
ok(promiseFor({ at: '2026-10-09T19:00:00Z', timeZone: NY, schedule: base(), carrier: 'USPS' }).shipBy === '2026-10-14',
  'Columbus Day: USPS doesn’t pick up, so Friday’s late order ships Wednesday');
ok(promiseFor({ at: '2026-10-09T19:00:00Z', timeZone: NY, schedule: base({ pickups: [] }), carrier: 'UPS' }).shipBy === '2026-10-13',
  'UPS works Columbus Day: the same order ships Tuesday with UPS');
ok(promiseFor({ at: '2026-10-09T19:00:00Z', timeZone: NY, schedule: base({ carrierHolidays: false, pickups: [] }) }).shipBy === '2026-10-13',
  'carrier holidays turned off: Columbus Day is an ordinary day');
{
  const s = base({ closures: [{ from: '2026-12-24', to: '2027-01-01', label: 'Holidays' }] });
  const p = promiseFor({ at: '2026-12-23T20:00:00Z', timeZone: NY, schedule: s });
  ok(p.startsOn === '2027-01-04' && p.shipBy === '2027-01-05' && p.why.includes('closure'), 'closed Dec 24 – Jan 1: a late order on the 23rd starts January 4');
  ok(startsReason(p, s).startsWith('After the 2:00 PM cutoff'), 'and it explains the cutoff first');
  ok(!isShipDay('2026-12-28', s) && isShipDay('2027-01-04', s), 'closures are whole days, both ends included');
}

// Pickup days.
{
  const s = base({ pickups: [{ carrier: 'USPS', days: [2, 5], time: '15:00' }] });
  ok(promiseFor({ at: '2026-10-19T14:00:00Z', timeZone: NY, schedule: s }).shipBy === '2026-10-20', 'pickups Tuesday and Friday: Monday’s order ships Tuesday');
  const p = promiseFor({ at: '2026-10-20T19:30:00Z', timeZone: NY, schedule: s });
  ok(p.shipBy === '2026-10-23' && p.why.includes('pickup_day'), 'Tuesday after the cutoff: ready Thursday, ships with Friday’s pickup');
  ok(countdownFor({}, new Date('2026-10-19T14:00:00Z'), NY, base({ pickups: [{ carrier: 'USPS', days: [5], time: '15:00' }] })) === null,
    'no countdown when ordering after the cutoff would ship the same day anyway');
}
{
  const s = base({ pickups: [{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '15:00' }, { carrier: 'UPS', days: [1, 2, 3, 4, 5], time: '17:00', kind: 'dropoff' }] });
  ok(lastPickupAt('2026-10-23', NY, s, 'UPS') === '2026-10-23T21:00:00.000Z' && lastPickupAt('2026-10-23', NY, s, 'USPS') === '2026-10-23T19:00:00.000Z',
    'each carrier’s own pickup time');
  ok(lastPickupAt('2026-10-23', NY, s, null) === '2026-10-23T21:00:00.000Z', 'carrier not chosen yet: the last pickup that day');
  ok(lastPickupAt('2026-10-24', NY, s, 'USPS') === null, 'no pickup on Saturday');
}

// Same day.
{
  const s = base({ processingDays: 0 });
  const p = promiseFor({ at: '2026-10-21T15:00:00Z', timeZone: NY, schedule: s });
  ok(p.shipBy === '2026-10-21' && p.shipByAt === '2026-10-21T19:00:00.000Z', 'same-day shipping: an 11 AM order ships that afternoon');
  ok(promiseFor({ at: '2026-10-21T19:12:00Z', timeZone: NY, schedule: s }).shipBy === '2026-10-22', 'same-day after the cutoff: tomorrow');
  ok(processingSentence(s) === 'Orders placed by 2:00 PM on a business day ship the same day.' && processingSentence(base()) === 'Orders ship within 1 business day.'
    && processingSentence(base({ processingDays: 3 })) === 'Orders ship within 3 business days.', 'the rule in one sentence');
  const late = promiseFor({ at: '2026-10-21T19:30:00Z', timeZone: NY, schedule: base({ processingDays: 0, cutoff: '16:00' }) });
  ok(late.shipBy === '2026-10-22' && late.shipByAt === '2026-10-22T19:00:00.000Z' && late.why.includes('pickup_day'),
    'a cutoff later than the pickup: an order after the 3 PM pickup goes with tomorrow’s, not a pickup already gone');
  const two = base({ processingDays: 0, pickups: [{ carrier: 'USPS', days: [1, 2, 3, 4, 5], time: '11:00' }, { carrier: 'UPS', days: [1, 2, 3, 4, 5], time: '17:00', kind: 'dropoff' }] });
  ok(promiseFor({ at: '2026-10-21T16:00:00Z', timeZone: NY, schedule: two, carrier: 'USPS' }).shipBy === '2026-10-22'
    && promiseFor({ at: '2026-10-21T16:00:00Z', timeZone: NY, schedule: two, carrier: 'UPS' }).shipBy === '2026-10-21'
    && promiseFor({ at: '2026-10-21T16:00:00Z', timeZone: NY, schedule: two }).shipBy === '2026-10-21',
    'USPS collects at 11, UPS at 5: a noon order ships tomorrow by USPS, today by UPS, today when the carrier isn’t chosen yet');
  const own = base({ processingDays: 0, cutoff: '20:00', pickups: [] });
  const evening = promiseFor({ at: '2026-10-21T23:00:00Z', timeZone: NY, schedule: own });
  ok(evening.shipBy === '2026-10-21' && evening.shipByAt === '2026-10-22T00:00:00.000Z' && missedAt('2026-10-21', NY, own) === '2026-10-22T00:00:00.000Z',
    'a shop that drops boxes off itself with an 8 PM cutoff: a 7 PM order is due by 8 PM, and missed only then');
}

// Made to order, pre-order, digital.
{
  const p = promiseFor({ at: '2026-10-21T15:00:00Z', timeZone: NY, schedule: base(), lines: [{}, { leadDays: { min: 5, max: 7 } }] });
  ok(p.shipBy === '2026-10-30' && p.leadDays === 7 && p.why.includes('made_to_order'), 'a made-to-order item (5–7 days) in the cart: the order ships by its longest time');
  ok(leadOf({ min: 9, max: 3 })?.min === 3 && leadOf({ max: 4 })?.min === 4 && leadOf({}) === null && leadOf({ max: 0 }) === null, 'made-to-order times cleaned up');
  ok(promiseFor({ at: '2026-10-21T15:00:00Z', timeZone: NY, schedule: base({ processingDays: 3 }), lines: [{ leadDays: { min: 1, max: 2 } }] }).leadDays === 0,
    'a made-to-order time shorter than the usual one changes nothing');
  const pre = promiseFor({ at: '2026-10-21T15:00:00Z', timeZone: NY, schedule: base(), lines: [{}, { preorder: true, preorderEtaAt: '2026-11-20' }] });
  ok(pre.shipBy === '2026-11-20' && pre.preorderDate === '2026-11-20' && pre.why.includes('preorder'), 'a pre-order: its date is the ship-by date');
  ok(promiseFor({ at: '2026-10-21T15:00:00Z', timeZone: NY, schedule: base(), lines: [{ preorder: true, preorderEtaAt: '2026-10-21' }] }).shipBy === '2026-10-22',
    'a pre-order date sooner than the shop can ship: the schedule’s date');
  ok(promiseFor({ at: '2026-10-21T15:00:00Z', timeZone: NY, schedule: base(), lines: [{ preorder: true, preorderEtaAt: '2026-11-21T04:59:59.000Z' }] }).preorderDate === '2026-11-20',
    'a pre-order date stored as an instant is read on the shop’s clock');
  ok(promiseFor({ at: '2026-10-21T15:00:00Z', timeZone: NY, schedule: base(), lines: [{ digital: true, leadDays: { min: 9, max: 9 } }] }).leadDays === 0,
    'a download never holds up the box');
}

// Busy periods.
{
  const s = base({ busy: [{ from: '2026-11-25', to: '2026-12-19', extraDays: 2, cutoff: '12:00', name: 'Holiday rush' }] });
  const p = promiseFor({ at: '2026-11-30T18:00:00Z', timeZone: NY, schedule: s });
  ok(p.startsOn === '2026-12-01' && p.shipBy === '2026-12-04' && p.extraDays === 2 && p.busy === 'Holiday rush',
    'Holiday rush (+2 days, 12 PM cutoff): Monday at 1 PM starts Tuesday and ships by Friday');
  ok(promiseFor({ at: '2026-11-23T18:00:00Z', timeZone: NY, schedule: s }).shipBy === '2026-11-24', 'the week before the rush: the usual time');
}

// Daylight saving.
ok(promiseFor({ at: '2026-10-30T19:30:00Z', timeZone: NY, schedule: base() }).shipByAt === '2026-11-03T20:00:00.000Z',
  'over the end of daylight saving: Tuesday’s 3 PM pickup is 20:00 UTC');
ok(promiseFor({ at: '2026-03-06T20:00:00Z', timeZone: NY, schedule: base() }).shipByAt === '2026-03-10T19:00:00.000Z',
  'over the start of daylight saving: Tuesday’s 3 PM pickup is 19:00 UTC');

// Arrival windows.
{
  const ups = promiseFor({ at: '2026-10-22T15:00:00Z', timeZone: NY, schedule: base({ pickups: [] }), carrier: 'UPS', transitDays: 3 });
  ok(ups.shipBy === '2026-10-23' && ups.arriveFrom === '2026-10-27' && ups.arriveTo === '2026-10-29', 'UPS, about 3 days: Tue Oct 27 – Thu Oct 29 (no Saturday delivery)');
  const tg = promiseFor({ at: '2026-11-24T15:00:00Z', timeZone: NY, schedule: base(), carrier: 'USPS', transit: std });
  ok(tg.shipBy === '2026-11-25' && tg.arriveFrom === '2026-11-28' && tg.arriveTo === '2026-12-02', 'shipped the day before Thanksgiving: no delivery on the holiday');
  ok(JSON.stringify(transitWindow(1)) === '{"min":1,"max":2}' && JSON.stringify(transitWindow(2)) === '{"min":1,"max":3}'
    && JSON.stringify(transitWindow(5)) === '{"min":4,"max":6}' && transitWindow(0) === null && transitWindow(null) === null, 'a carrier’s estimate becomes a range');
  ok(promiseFor({ at: '2026-10-21T15:00:00Z', timeZone: NY, schedule: base() }).arriveFrom === null, 'no transit known: no arrival is promised');
  ok(promiseFor({ at: '2026-10-21T15:47:00Z', timeZone: NY, schedule: base({ pickups: [] }), transit: std }).arriveFrom === '2026-10-26',
    'carrier not known: Saturday isn’t counted as a delivery day');
  const one = promiseFor({ at: '2026-10-21T15:00:00Z', timeZone: NY, schedule: base(), carrier: 'USPS', transit: { min: 1, max: 1 } });
  ok(arrivalLabel(one, NY) === 'Fri, Oct 23', 'a one-day range is one date');
}

// Holidays.
{
  const h = carrierHolidays(2026).map((x) => x.day).join(',');
  ok(h === '2026-01-01,2026-01-19,2026-02-16,2026-05-25,2026-06-19,2026-07-04,2026-09-07,2026-10-12,2026-11-11,2026-11-26,2026-12-25', 'the 2026 carrier holidays');
  ok(carrierHolidays(2023)[0].day === '2023-01-02' && carrierHolidays(2022).find((x) => x.name === 'Christmas Day')?.day === '2022-12-26',
    'a holiday on a Sunday is kept on Monday');
  ok(carrierHolidays(2028)[0].day === '2028-01-01', 'one on a Saturday stays on Saturday (the Friday before runs normally)');
  ok(holidayOn('2026-10-12', 'ups') === null && holidayOn('2026-10-12', 'usps')?.name === 'Columbus Day' && holidayOn('2026-10-12')?.name === 'Columbus Day'
    && holidayOn('2026-11-26', 'fedex')?.name === 'Thanksgiving', 'USPS keeps every federal holiday, the others the big six');
}

// Carriers.
ok(carrierKey('USPS') === 'usps' && carrierKey('UPS') === 'ups' && carrierKey('FedEx') === 'fedex' && carrierKey('DHL Express') === 'dhl'
  && carrierKey('Priority Mail') === 'usps' && carrierKey('Shop') === '' && carrierKey('') === '' && carrierKey('Groupset Couriers') === '', 'carriers by name');

// Reading what shops saved.
{
  const legacy = scheduleFrom({ shipProcessingHours: 48 });
  ok(legacy.processingDays === 2 && !showsDates(legacy) && showsDates(base()), 'the old “ship within 48 hours” is 2 days, and no dates are shown until the shop turns them on');
  ok(normalizeSchedule({ processingDays: 0 }).processingDays === 0 && normalizeSchedule({ processingDays: 99 }).processingDays === 30, 'same day kept, too many days capped');
  ok(scheduleFrom({ shipProcessingHours: 12 }).processingDays === 0 && scheduleFrom({ shipProcessingHours: 24 }).processingDays === 1, 'the old “ship within 12 hours” is the same day');
  ok(!isCalendarDay('2026-02-30') && !isCalendarDay('2026-13-01') && isCalendarDay('2028-02-29') && !isCalendarDay('2026-1-5'), 'only real calendar days');
  ok(promiseCarrier({ promise: { carrier: null }, shippingCarrier: 'Shop' }) === null && promiseCarrier({ shippingCarrier: 'Shop' }) === null
    && promiseCarrier({ shippingCarrier: 'USPS' }) === 'USPS' && promiseCarrier({ promise: { carrier: 'UPS' } }) === 'UPS', 'the shop’s own flat rate is never taken for a carrier');
  const junk = normalizeSchedule({ shipDays: [], cutoff: '25:00', cutoffByDay: { 5: '12:00', 9: '10:00', 3: 'noon' }, pickups: [{ carrier: '', time: '15:00' }, { carrier: 'USPS', time: '3pm' }], closures: [{ from: '2026-13-01' }, { from: '2026-12-31', to: '2026-12-24' }] });
  ok(junk.shipDays.join() === '1,2,3,4,5' && junk.cutoff === '14:00' && JSON.stringify(junk.cutoffByDay) === '{"5":"12:00"}' && junk.pickups.length === 0
    && junk.closures.length === 1 && junk.closures[0].from === '2026-12-24', 'anything malformed falls back instead of breaking a date');
  const fri = base({ cutoffByDay: { 5: '12:00' } });
  ok(promiseFor({ at: '2026-10-23T16:30:00Z', timeZone: NY, schedule: fri }).startsOn === '2026-10-26', 'a Friday cutoff of 12 PM: 12:30 PM Friday starts Monday');
  ok(promiseFor({ at: '2026-10-22T16:30:00Z', timeZone: NY, schedule: fri }).startsOn === '2026-10-22', 'and Thursday keeps 2 PM');
}

// The countdown and the cutoff.
{
  const now = new Date('2026-10-21T15:47:00Z');
  const info = cutoffInfo(now, NY, base());
  ok(info.beforeCutoff && info.minutesLeft === 133 && info.cutoffAt === '2026-10-21T18:00:00.000Z' && minutesLabel(133) === '2 h 13 min', 'Wed 11:47 AM: 2 h 13 min to the cutoff');
  const c = countdownFor({}, now, NY, base());
  ok(!!c && c.shipBy === '2026-10-22' && c.laterShipBy === '2026-10-23', 'the countdown names what it gets you');
  ok(countdownFor({}, new Date('2026-10-21T19:00:00Z'), NY, base()) === null && countdownFor({}, new Date('2026-10-24T15:00:00Z'), NY, base()) === null,
    'none after the cutoff or on a day the shop doesn’t ship');
  ok(countdownFor({}, new Date('2026-10-21T05:00:00Z'), NY, base()) === null, 'none with more than 12 hours to go');
  ok(cutoffInfo(new Date('2026-10-24T15:00:00Z'), NY, base()).startsOn === '2026-10-26', 'on Saturday an order starts Monday');
  const pp = productPromise({}, now, NY, base());
  ok(pp.shipBy === '2026-10-22' && pp.arriveFrom === '2026-10-24' && pp.arriveTo === '2026-10-28' && pp.carrier === 'USPS',
    'the product page: ships by Thursday, arrives Oct 24–28 with the shop’s one carrier');
  ok(shortRange(pp.arriveFrom, pp.arriveTo) === 'Oct 24–28' && shortRange('2026-10-30', '2026-11-03') === 'Oct 30 – Nov 3', 'short ranges');
  ok(clockLabel('14:00') === '2:00 PM' && clockLabel('00:30') === '12:30 AM' && clockLabel('12:00') === '12:00 PM', 'times in words');
}

// Running late.
{
  const s = base();
  ok(revisedShipBy('2026-10-23', new Date('2026-10-23T20:00:00Z'), NY, s, 'USPS') === '2026-10-26', 'missed Friday’s pickup: now ships Monday');
  ok(revisedShipBy('2026-11-25', new Date('2026-11-25T20:30:00Z'), NY, s) === '2026-11-27', 'missed the day before Thanksgiving: Friday');
  ok(revisedShipBy('2026-10-23', new Date('2026-10-26T13:00:00Z'), NY, s) === '2026-10-26', 'noticed Monday morning: still Monday');
  ok(revisedShipBy('2026-10-23', new Date('2026-10-26T20:00:00Z'), NY, s) === '2026-10-27', 'noticed after Monday’s pickup: Tuesday');
  ok(missedAt('2026-10-23', NY, s, 'USPS') === '2026-10-23T19:00:00.000Z' && missedAt('2026-10-23', NY, base({ pickups: [] })) === '2026-10-23T22:00:00.000Z',
    'missed at the last pickup, or 6 PM when the shop drops boxes off itself');
  const shownP = { shipBy: '2026-10-23', shown: true, deadlineAt: '2026-10-24T03:59:59.000Z' };
  ok(promisedDay({ promise: shownP, shipPromiseAt: '2026-10-24T03:59:59.000Z' }, NY) === '2026-10-23', 'the promised day');
  ok(promisedDay({ promise: shownP, shipPromiseAt: '2026-10-27T03:59:59.000Z' }, NY) === '2026-10-26', 'a date moved by a notice wins');
  ok(promisedDay({ promise: shownP, shipPromiseAt: '2026-10-23T03:59:59.000Z' }, NY) === '2026-10-22', 'and so does one moved earlier (a pre-order that landed sooner)');
  const quietP = { shipBy: '2026-10-23', shown: false, deadlineAt: '2026-10-24T03:59:59.000Z' };
  ok(promisedDay({ promise: quietP, shipPromiseAt: '2026-11-20T04:59:59.000Z' }, NY) === '2026-10-23', 'never shown: the team’s date, not the rule’s 30 days');
  ok(promisedDay({ promise: quietP, shipPromiseAt: '2026-10-28T03:59:59.000Z', notifiedForPromiseAt: '2026-10-28T03:59:59.000Z' }, NY) === '2026-10-27', 'unless a notice told them a date');
  ok(promisedDay({ shipPromiseAt: '2026-11-20T04:59:59.000Z' }, NY) === '2026-11-19', 'an order from before the schedule: its stored promise');
}

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
