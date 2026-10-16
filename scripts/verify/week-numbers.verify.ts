// scripts/verify/week-numbers.verify.ts — "This week" from real numbers, and the bills line.
import { weekNumbers, billsLine } from '../../src/lib/week-numbers';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const ws = new Date(2026, 9, 11); const now = new Date(2026, 9, 14, 12).getTime(); const day = (d: number, h = 10) => new Date(2026, 9, d, h).toISOString();
const tx = [
  { type: 'income', category: 'Service Revenue', amount: 500, date: day(12) }, { type: 'income', category: 'Retail', amount: 40, date: day(13) },
  { type: 'income', category: 'Deposit', amount: 25, date: day(12) }, { type: 'expense', category: 'Supplies', amount: 90, date: day(12) },
  { type: 'income', category: 'Service Revenue', amount: 400, date: day(6) }, { type: 'income', category: 'Service Revenue', amount: 900, date: day(9) },
];
const appts = [{ status: 'confirmed', startTime: day(15), price: 80 }, { status: 'confirmed', startTime: day(16), serviceId: 's' }, { status: 'cancelled', startTime: day(16), price: 99 }, { status: 'confirmed', startTime: day(19), price: 70 }];
const n = weekNumbers({ weekStart: ws, now, transactions: tx, appointments: appts, services: [{ id: 's', price: 55 }], billDefinitions: [{ amount: 2600, cadence: 'monthly' }, { amount: 50, cadence: 'weekly' }, { amount: 100, cadence: 'monthly', context: 'Personal' }], tenant: { dailyGoal: 400 }, openDays: 5 });
ok(n.taken === 540, 'taken: services and retail this week, not deposits or expenses', n.taken);
ok(n.lastWeekSamePoint === 400, 'last week up to the same point only', n.lastWeekSamePoint);
ok(n.vsLastWeek === 35, '35% ahead', n.vsLastWeek);
ok(n.stillBooked === 135 && n.stillBookedCount === 2, 'still booked at their own prices, this week only', n);
ok(n.weeklyGoal === 2000, 'daily goal × open days');
ok(Math.round(n.weeklyCost!) === 650, 'business bills as a weekly share (2600/mo + 50/wk)', n.weeklyCost);
ok(Math.round(n.overCost!) === 25, 'projected less the bills', n.overCost);
ok(weekNumbers({ weekStart: ws, now, transactions: [], appointments: [], services: [], billDefinitions: [], tenant: {}, openDays: 5 }).weeklyCost === null, 'no bills: no guess');
const line = billsLine([{ dueDate: day(15), amountDue: 1800, definition: { name: 'Rent' } }, { dueDate: day(20), amountDue: 40, amountPaid: 0, definition: { name: 'Phone' } }], now);
ok(line === '2 bills due · $1,840 · Rent tomorrow', 'the bills line', line);
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
