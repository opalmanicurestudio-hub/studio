// Checks what a day or hourly stay comes to at check-out (lib/stay-settle), the same at the desk and in the renter's
// portal:
// - The booked end is the business's wall clock on the booking's day, never the server's: a stay that ends at 5pm in New
//   York and checks out at 5:05pm owes nothing (the old sum, on the server's clock, billed hours). A business with no time
//   zone set: the desk's own clock; with none to go by (the portal), nothing is billed on a guess.
// - Overtime past the space's grace, in the space's blocks, at the rate snapshotted at check-in; out 30 minutes or more
//   early, a possible credit (the business decides), from $1. A daily stay, or no rate, is just completed.
// - The desk (Spaces page, Guests today) and the portal's self check-out all use it.
// - A stay's receipt (lib/stay-receipt): what was booked in its own terms (hours and times, a slot, or days, never "1 day"
//   for an hourly stay), the renter discount and credit, extra time and charges taken afterwards, and, with a deposit,
//   whether the balance is paid. The total is what was actually paid. No-shows (lib/no-show) are judged on the business's
//   day, and a paused or cancelled business is never charged a no-show fee.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/stay-settle.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

(async () => {
  const S = await import('../../src/lib/stay-settle');
  const NY = 'America/New_York';
  const stay = { bookingType: 'hourly', startDate: '2026-11-10', startTime: '13:00', endTime: '17:00', actualCheckIn: '2026-11-10T18:00:00Z' };
  const end = S.bookedEndAt(stay, NY);
  check('the booked end is 5pm in New York (10pm UTC in November), not 5pm UTC', end?.toISOString() === '2026-11-10T22:00:00.000Z', end?.toISOString());
  const onTime = S.settleStay(stay, { now: new Date('2026-11-10T22:05:00Z'), timeZone: NY, hourlyCents: 4000 });
  check('out at 5:05pm their time: nothing owed (the old sum, on the server’s clock, billed hours of overtime)', onTime.status === 'completed' && !onTime.overageDueCents && !onTime.potentialCreditCents, onTime);
  const late = S.settleStay(stay, { now: new Date('2026-11-10T22:31:00Z'), timeZone: NY, hourlyCents: 4000 });
  check('31 minutes over with the usual 10 minutes’ grace: two 15-minute blocks at $40 an hour', late.overageMinutes === 30 && late.overageDueCents === 2000 && late.overageStatus === 'due', late);
  const ownRules = S.settleStay(stay, { now: new Date('2026-11-10T22:31:00Z'), timeZone: NY, hourlyCents: 4000, space: { rental: { graceMinutes: 0, blockMinutes: 30 } } });
  check('a space’s own grace and block are used (no grace, 30-minute blocks)', ownRules.overageMinutes === 60 && ownRules.overageDueCents === 4000, ownRules);
  const early = S.settleStay(stay, { now: new Date('2026-11-10T21:10:00Z'), timeZone: NY, hourlyCents: 4000 });
  check('out 50 minutes early: three unused quarter hours as a possible credit for the business to decide', early.unusedMinutes === 45 && early.potentialCreditCents === 3000 && early.creditDecision === 'pending' && !early.overageDueCents, early);
  const tiny = S.settleStay(stay, { now: new Date('2026-11-10T21:25:00Z'), timeZone: NY, hourlyCents: 100 });
  check('a credit under $1 isn’t offered', !tiny.potentialCreditCents, tiny);
  const daily = S.settleStay({ bookingType: 'daily', startDate: '2026-11-10', actualCheckIn: 'x' }, { now: new Date('2026-11-11T05:00:00Z'), timeZone: NY, hourlyCents: 4000 });
  const noRate = S.settleStay(stay, { now: new Date('2026-11-10T23:30:00Z'), timeZone: NY, hourlyCents: 0 });
  check('a daily stay, or one with no hourly rate, is just completed', !daily.overageDueCents && !noRate.overageDueCents && daily.status === 'completed' && noRate.status === 'completed');
  const tokyo = S.settleStay({ ...stay, endTime: '23:30' }, { now: new Date('2026-11-10T14:46:00Z'), timeZone: 'Asia/Tokyo', hourlyCents: 4000 });
  check('works the same anywhere (Tokyo: 11:30pm their time ends at 2:30pm UTC)', tokyo.overageMinutes === 15, tokyo);
  const dst = S.bookedEndAt({ ...stay, startDate: '2026-03-08', endTime: '17:00' }, NY);
  check('on the day the clocks change, 5pm is still 5pm (9pm UTC after the spring change)', dst?.toISOString() === '2026-03-08T21:00:00.000Z', dst?.toISOString());
  const noZone = S.stayClock({ name: 'No zone set' }, null);
  const deskOnly = S.stayClock({ name: 'No zone set' }, 'America/Chicago');
  const own = S.stayClock({ timezone: 'America/Denver' }, 'America/Chicago');
  check('the clock: the business’s own zone; else the desk’s; else none', noZone === null && deskOnly === 'America/Chicago' && own === 'America/Denver', [noZone, deskOnly, own]);
  const guess = S.settleStay(stay, { now: new Date('2026-11-10T23:30:00Z'), timeZone: null, hourlyCents: 4000 });
  check('with no clock to go by, the stay is just completed: nothing billed on a guess, and marked for the desk to check', guess.status === 'completed' && !guess.overageDueCents && !guess.potentialCreditCents && guess.overtimeUnchecked === true, guess);
  check('…a stay with no rate isn’t marked (there was nothing to bill)', !S.settleStay(stay, { now: new Date(), timeZone: null, hourlyCents: 0 }).overtimeUnchecked);

  // ── Receipts ──
  const R = await import('../../src/lib/stay-receipt');
  const hourly = R.stayReceipt({ boothName: 'Sauna', bookingType: 'hourly', startDate: '2026-11-10', endDate: '2026-11-10', startTime: '13:00', endTime: '16:00', numDays: 1, originalAmountCents: 10800, renterDiscountCents: 1200, amountCents: 10800 });
  check('an hourly stay says its hours and times (not “1 day”), at the price before the renter discount, then the discount', hourly.lines[0].description === 'Sauna: 3 hours, 1pm to 4pm' && hourly.lines[0].amountCents === 12000 && hourly.lines[1].description === 'Renter discount' && hourly.lines[1].amountCents === -1200 && hourly.paidCents === 10800 && hourly.periodLabel === 'Nov 10, 2026', hourly);
  const slot = R.bookedLabel({ bookingType: 'hourly', startTime: '09:00', endTime: '12:30', slotLabel: 'Morning' });
  const halfHour = R.bookedLabel({ bookingType: 'hourly', startTime: '09:00', endTime: '10:30' });
  check('a slot by its name and times; half hours read as such', slot === 'Morning, 9am to 12:30pm' && halfHour === '1.5 hours, 9am to 10:30am', [slot, halfHour]);
  const dep = R.stayReceipt({ boothName: 'Suite 2', bookingType: 'daily', startDate: '2026-11-10', endDate: '2026-11-11', numDays: 2, originalAmountCents: 20000, creditAppliedCents: 2000, netDueCents: 18000, amountCents: 5000, depositCents: 5000, balanceDueCents: 13000, balancePaid: false,
    overageStatus: 'charged', overageChargedCents: 1500, overageMinutes: 30, incidentals: [{ amountCents: 2500, description: 'Cleaning fee' }] });
  check('a deposit stay: the price, the credit, extra time and a charge; paid is the deposit and the extras; the balance still to pay is said in words', dep.lines.map((l) => `${l.description}|${l.amountCents}`).join(';') === 'Suite 2: 2 days|20000;Credit used|-2000;Extra time, 30 minutes|1500;Cleaning fee|2500'
    && dep.paidCents === 9000 && dep.stillDueCents === 13000 && /\$50\.00 deposit paid when booking\. The \$130\.00 balance is still to pay\./.test(dep.note) && dep.periodLabel === 'Nov 10, 2026 to Nov 11, 2026', dep);
  const paidUp = R.stayReceipt({ ...{ boothName: 'Suite 2', bookingType: 'daily', startDate: '2026-11-10', endDate: '2026-11-10', numDays: 1, originalAmountCents: 8000, amountCents: 3000, balanceDueCents: 5000 }, balancePaid: true });
  check('…and once the balance is paid, it counts in what’s paid', paidUp.paidCents === 8000 && paidUp.stillDueCents === 0 && /balance is paid/.test(paidUp.note), paidUp);
  const passStay = R.stayReceipt({ boothName: 'Sauna', bookingType: 'hourly', startDate: '2026-11-10', endDate: '2026-11-10', startTime: '13:00', endTime: '15:00', amountCents: 0, originalAmountCents: 8000, renterDiscountCents: 0, balancePaid: true, paidWithPassId: 'p1', passDaysUsed: 1, status: 'completed' });
  check('paid with prepaid days: the price, then the days, so the lines come to the $0 paid', passStay.lines.map((l) => `${l.description}|${l.amountCents}`).join(';') === 'Sauna: 2 hours, 1pm to 3pm|8000;Paid with prepaid days (1 day)|-8000' && passStay.paidCents === 0 && passStay.state === 'paid' && passStay.method === 'Prepaid days', passStay);
  const unpaid = R.stayReceipt({ boothName: 'Room B', bookingType: 'daily', startDate: '2026-11-10', endDate: '2026-11-10', numDays: 1, amountCents: 6000, source: 'desk', paymentStatus: 'unpaid', status: 'confirmed' });
  check('booked at the desk and not paid yet: nothing paid, the price still to pay', unpaid.paidCents === 0 && unpaid.stillDueCents === 6000 && unpaid.state === 'unpaid' && /isn’t paid yet/.test(unpaid.note), unpaid);
  const unpaidOver = R.stayReceipt({ boothName: 'Room B', bookingType: 'daily', startDate: '2026-11-10', endDate: '2026-11-10', numDays: 1, amountCents: 6000, source: 'desk', paymentStatus: 'unpaid', status: 'completed' });
  check('…and once the stay is over with no payment recorded, it says so rather than claiming it’s owed', unpaidOver.state === 'unrecorded' && !unpaidOver.depositOnly && unpaidOver.stillDueCents === 0 && /isn’t recorded here/.test(unpaidOver.note), unpaidOver);
  const paidDesk = R.stayReceipt({ boothName: 'Room B', bookingType: 'daily', startDate: '2026-11-10', endDate: '2026-11-10', numDays: 1, amountCents: 6000, source: 'desk', paymentStatus: 'paid', paidVia: 'pos', status: 'completed' });
  check('…and once paid at the desk, it’s paid, and says so (not “Card (Stripe)”)', paidDesk.paidCents === 6000 && paidDesk.state === 'paid' && paidDesk.method === 'Paid at the desk', paidDesk);
  const inPerson = R.stayReceipt({ boothName: 'Sauna', bookingType: 'hourly', startDate: '2026-11-10', endDate: '2026-11-10', startTime: '13:00', endTime: '14:00', originalAmountCents: 4000, amountCents: 4000, overageStatus: 'collected', overageDueCents: 1000, overageMinutes: 15, status: 'completed' });
  check('extra time collected in person is on the receipt and in what’s paid', inPerson.lines.some((l) => l.description === 'Extra time, 15 minutes' && l.amountCents === 1000) && inPerson.paidCents === 5000, inPerson);
  const overUnrecorded = R.stayReceipt({ boothName: 'Suite 2', bookingType: 'daily', startDate: '2026-11-10', endDate: '2026-11-10', numDays: 1, originalAmountCents: 8000, amountCents: 3000, balanceDueCents: 5000, balancePaid: false, status: 'completed' });
  check('a stay that’s over with its balance never recorded says so, rather than claiming it’s owed', overUnrecorded.state === 'unrecorded' && overUnrecorded.depositOnly && overUnrecorded.stillDueCents === 0 && /was due in person and isn’t recorded here/.test(overUnrecorded.note), overUnrecorded);
  check('a quarter hour reads as such', R.bookedLabel({ bookingType: 'hourly', startTime: '09:00', endTime: '10:15' }) === '1.25 hours, 9am to 10:15am');
  const rcpt = readFileSync('src/app/api/booths/receipt/route.ts', 'utf8');
  check('the stay receipt uses it, and a negative line reads as “−$12.00”', /const rc = stayReceipt\(r\);/.test(rcpt) && /totalDollars: {3}rc\.paidCents \/ 100,/.test(rcpt) && /\$\{n < 0 \? '−' : ''\}\$\$\{Math\.abs\(n\)/.test(rcpt));
  check('the receipt’s status follows it: “Balance due”, “Payment due”, “Deposit paid” or “Not recorded” or “Paid”; and how it was paid', /paidState: {6}rc\.state,/.test(rcpt) && /data\.paidState === 'due' \? '<span class="pill warn">Balance due<\/span>' : data\.paidState === 'unpaid' \? '<span class="pill warn">Payment due<\/span>' : data\.paidState === 'unrecorded' \? `<span class="pill">\$\{data\.depositOnly \? 'Deposit paid' : 'Not recorded'\}<\/span>`/.test(rcpt) && /paymentMethod: {2}rc\.method,/.test(rcpt) && /depositOnly: {4}rc\.depositOnly,/.test(rcpt));
  check('the desk sees a stay whose extra time couldn’t be checked', /r\.overtimeUnchecked && \(/.test(readFileSync('src/components/booths/GuestsToday.tsx', 'utf8')));
  const ns = readFileSync('src/lib/no-show.ts', 'utf8');
  check('no-shows: judged on the business’s day, and never a fee while the business is paused or cancelled', /policyEnabled = p\.enabled && !accessLockOf\(t, now\.getTime\(\)\)\.locked;/.test(ns) && /todayStr = todayIn\(tenantTimeZone\(t\), now\);/.test(ns));

  const files = ['src/app/(app)/booths/page.tsx', 'src/components/booths/GuestsToday.tsx', 'src/app/api/portal/renter/route.ts'].map((p) => readFileSync(p, 'utf8'));
  check('the desk (Spaces page, Guests today) and the portal’s self check-out all use it, on the business’s clock', files.every((f) => /settleStay\(r, \{ now/.test(f)) && files.every((f) => !/const bookedEnd = new Date\(`\$\{r\.startDate\}T\$\{r\.endTime\}:00`\)/.test(f)));
  check('the desk falls back to its own clock; the portal only goes by the business’s', /timeZone: stayClock\(selectedTenant, deskZone\(\)\)/.test(files[0]) && /timeZone: stayClock\(tenant, deskZone\(\)\)/.test(files[1]) && /timeZone: stayClock\(tSnapTz\)/.test(files[2]));
  check('a read that fails never stops the portal’s check-out', /\.get\(\)\.then\(\(s: any\) => s\.data\(\) \|\| null\)\.catch\(\(\) => null\)/.test(files[2]));
  check('the portal’s self check-out uses the space’s own grace and block', /space \}\), selfCheckOut: true \}/.test(files[2]));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
