// Checks when a customer's return and problem windows start (lib/order-windows): days after delivery, as the shop's
// policy says, from the carrier's delivery scan; from the ship date when the carrier never confirmed delivery; from the
// handover for a pickup. No limit set, or no date at all, keeps the window open. The self-serve return, the problem
// report, the order page's menu, the gift exchange and the order assistant all count the same way.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-windows.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';
import { daysSinceStart, startedAgo, windowEndsAt, windowOpen, windowStart } from '../../src/lib/order-windows';
import { giftWindow } from '../../src/lib/gift-orders';

const day = (iso: string) => Date.parse(`${iso}T15:00:00.000Z`);
// Shipped Oct 1, delivered Oct 10, a 30-day return window.
const shipped = { method: 'ship', stage: 'completed', completedAt: '2026-10-01T15:00:00.000Z', deliveredAt: '2026-10-10T15:00:00.000Z' };

check('the window starts at the carrier’s delivery scan, not the day it shipped', windowStart(shipped)?.from === 'delivered' && windowStart(shipped)?.at === day('2026-10-10'));
check('35 days after shipping but 26 after delivery: a 30-day return window is still open', windowOpen(shipped, 30, day('2026-11-05')));
check('…and it closes 30 days after delivery', windowOpen(shipped, 30, day('2026-11-09')) && !windowOpen(shipped, 30, day('2026-11-10') + 3600e3));
check('its last day is 30 days after delivery', windowEndsAt(shipped, 30) === day('2026-11-09'));
check('days since it started count from delivery', daysSinceStart(shipped, day('2026-10-20')) === 10);

const lost = { method: 'ship', stage: 'shipped', completedAt: '2026-10-01T15:00:00.000Z' };
check('a parcel the carrier never confirmed delivering counts from the day it shipped', windowStart(lost)?.from === 'shipped' && !windowOpen(lost, 30, day('2026-11-01') + 3600e3) && windowOpen(lost, 30, day('2026-10-31')));
check('…and it says so when a report is refused', startedAgo(lost, day('2026-11-05')) === 'shipped 35 days ago' && startedAgo(shipped, day('2026-11-05')) === 'delivered 26 days ago');

const pickup = { method: 'counter', stage: 'completed', completedAt: '2026-10-02T15:00:00.000Z' };
check('a pickup counts from the day it was handed over', windowStart(pickup)?.from === 'handed_over' && startedAgo(pickup, day('2026-10-03')) === 'picked up 1 day ago');

check('no limit set (0 or none) is no limit', windowOpen(shipped, 0, day('2027-06-01')) && windowOpen(shipped, undefined, day('2027-06-01')) && windowEndsAt(shipped, 0) === null);
check('no dates at all keeps it open (ambiguity is the customer’s)', windowOpen({ method: 'ship', stage: 'shipped' }, 14, day('2027-01-01')) && windowStart({}) === null);
check('a junk delivery date falls back to the ship date', windowStart({ ...lost, deliveredAt: 'not a date' })?.from === 'shipped');

const g = (o: any, now: number) => giftWindow(o, { returnWindowDays: 30 }, now);
check('a gift exchange counts from delivery too', g(shipped, day('2026-11-05')).open && !g(shipped, day('2026-11-12')).open);
check('…and from the ship date (shippedAt on older gift orders) without a delivery scan', !g({ method: 'ship', stage: 'shipped', shippedAt: '2026-10-01T15:00:00.000Z' }, day('2026-11-05')).open);

// ── Every place that enforces or describes a window counts this way ──
const src = (p: string) => fs.readFileSync(p, 'utf8');
const selfServe = src('src/app/api/retail/self-serve/route.ts');
const status = src('src/app/api/retail/order-status/route.ts');
const claims = src('src/app/api/retail/claims/route.ts');
const ai = src('src/app/api/retail/ai-support/route.ts');
check('starting a return asks the shared window', /windowOpen\(order, windowDays\)/.test(selfServe) && !/new Date\(order\.completedAt\)\.getTime\(\)\) \/ 86400000;\s*\n\s*if \(Number\.isFinite\(ageDays\) && ageDays > windowDays\)/.test(selfServe));
check('the order page’s menu asks the same window the route enforces', /const returnWindowOk = windowOpen\(order, rs\.returnWindowDays\);/.test(status));
check('…and only offers to report a problem while the report window is open', /canReport: \['shipped', 'completed'\]\.includes\(order\.stage\) && windowOpen\(order, Math\.max\(0, Math\.floor\(Number\(rs\.deliveryIssueWindowDays\) \|\| 0\)\)\)/.test(status));
check('reporting a problem asks the shared window, and names delivery or shipping in its refusal', /windowOpen\(order, issueDays\)/.test(claims) && /startedAgo\(order\)/.test(claims));
check('the order assistant is told the windows count from delivery, and whether they’re open for this order', /days of delivery \(\$\{windowOpen\(order, rs\.returnWindowDays\)/.test(ai) && !/days of completion/.test(ai));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
