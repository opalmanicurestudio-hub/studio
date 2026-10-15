// scripts/verify/pay-clarity.verify.ts — pay, clearly (lib/pay-clarity): per-hour pay, sources, goals, other ways of being paid.
import { clarity, planPay, breakEvenSales, planOfRecord, planLabel, minWageWeeks, costsOver, cleanPlan, type Period } from '../../src/lib/pay-clarity';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const P = (from: string, to: string, x: Partial<Period>): Period => ({ from, to, total: 0, tips: 0, hours: 0, overtimeHours: 0, parts: { services: 0, tips: 0, retail: 0, time: 0, other: 0, adjustments: 0 }, visits: 0, serviceSales: 0, retailSales: 0, bookedHours: 0, scheduledHours: 0, topUp: 0, ...x });
const ps = [
  P('2026-09-17', '2026-09-30', { total: 2050, tips: 400, hours: 80, bookedHours: 62, scheduledHours: 80, visits: 13, serviceSales: 3100, retailSales: 2400, parts: { services: 1240, tips: 400, retail: 240, time: 128, other: 42, adjustments: 0 } }),
  P('2026-10-01', '2026-10-14', { total: 1886, tips: 368, hours: 80, bookedHours: 56, scheduledHours: 80, visits: 13, serviceSales: 3000, retailSales: 2320, parts: { services: 1200, tips: 368, retail: 232, time: 128, other: -42 + 0, adjustments: 0 } }),
];
const c = clarity(ps, { costs: [{ id: 'a', label: 'Tools', amount: 120, per: 'once' }], goalMonthly: 4500, commissionPct: 40 });
ok(c.gross === 3936 && c.tips === 768 && c.hours === 160, 'totals', c);
ok(c.perHour === 24.6 && c.perHourNoTips === 19.8 && c.perHourAfterCosts === 23.85, 'per hour: with tips, without, after own costs', c);
ok(c.bookedHours === 118 && c.unbookedHours === 42 && c.bookedShare === 74, 'booked and not booked');
ok(c.change?.last === 23.58 && c.change?.prev === 25.63, 'change between the last two periods', c.change);
ok(c.goal && c.goal.gap > 0 && c.goal.salesNeeded === Math.round((c.goal.gap / 0.4) * 100) / 100 && c.goal.bookingsNeeded! > 0, 'goal: sales and bookings needed', c.goal);
ok(costsOver([{ id: 'm', label: 'Phone', amount: 30.44, per: 'month' }], 61) === 61, 'monthly costs scale to the days');
const b = { hours: 160, serviceSales: 6100, retailSales: 4720, tips: 768, otherPay: 256, days: 28, currentGross: 3936, minimumWage: 15 };
const now = planPay({ id: 'n', kind: 'commission', pct: 40, retailPct: 10 }, b);
ok(now.gross === 3936 && now.beforeIncomeTax === 3634.9, 'commission as now: $3,936, $3,634.90 before income tax', now);
ok(planPay({ id: 'h', kind: 'hourly', rate: 20 }, b).gross === 3968, '$20 an hour + tips');
ok(planPay({ id: 'hc', kind: 'hourly_commission', rate: 18, pct: 10 }, b).gross === 2880 + 610 + 768, '$18 an hour + 10%');
ok(planPay({ id: 'g', kind: 'greater_of', rate: 16, pct: 40 }, { ...b, serviceSales: 5000 }).payBeforeTips === 2560, 'greater of: the hourly wins at lower sales');
const low = planPay({ id: 'c', kind: 'commission', pct: 40 }, { ...b, serviceSales: 3000, retailSales: 0, otherPay: 0 });
ok(low.toppedUp === 1200 && low.payBeforeTips === 2400, 'under minimum wage → topped up to $15 × 160', low);
ok(Math.round(planPay({ id: 't', kind: 'tiered', pct: 40, tiers: [{ over: 3000, pct: 50 }] }, { ...b, retailSales: 0, otherPay: 0, days: 30.44 }).payBeforeTips) === 1200 + 1550, 'tiered: 40% to $3,000, then 50%');
ok(Math.round(planPay({ id: 's', kind: 'salary', salary: 52000 }, { ...b, days: 365 }).payBeforeTips) === 52000, 'salary for a year');
const self = planPay({ id: 'me', kind: 'self', self: { spacePerWeek: 250, suppliesPct: 8, cardPct: 2.9 } }, b);
ok(self.gross === 6868 && Math.abs(self.beforeIncomeTax - (6868 - 1000 - 488 - 199.17 - (6868 - 1000 - 488 - 199.17) * 0.9235 * 0.153)) < 0.02, 'working for myself: space, supplies, card fees, self-employment tax', self);
const be = breakEvenSales({ id: 'me', kind: 'self', self: { spacePerWeek: 250, suppliesPct: 8, cardPct: 2.9 } }, { id: 'n', kind: 'commission', pct: 40, retailPct: 10 }, b);
ok(be !== null && be > 3000 && be < 5000, `break-even sales a month (${be})`);
ok(planOfRecord({ payStructure: 'hourly_plus_commission', hourlyRate: 18, commissionRate: 10 }).kind === 'hourly_commission' && planLabel({ id: 'x', kind: 'greater_of', rate: 16, pct: 40 }) === '$16 an hour or 40%, whichever is more', 'the plan on record, in words');
ok(JSON.stringify(minWageWeeks([P('a', 'b', { weeks: [{ weekStart: 'w1', hours: 40, earned: 520, topUp: 80 }, { weekStart: 'w2', hours: 40, earned: 700, topUp: 0 }] })])) === JSON.stringify({ weeks: 1, amount: 80 }), 'weeks topped up to minimum wage');
ok(cleanPlan({ kind: 'nope' }) === null && cleanPlan({ kind: 'hourly', rate: 99999 })?.rate === 1000, 'plans are cleaned');
if (bad) { console.log(`\n${bad} failed`); process.exit(1); } console.log('\nAll checks passed');
