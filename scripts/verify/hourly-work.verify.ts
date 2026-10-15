// scripts/verify/hourly-work.verify.ts — paid by the hour for some work (the front desk, say), commission only for
// the rest: clock-in for a kind of work, switching mid-shift, breaks, payroll, the schedule not counted twice, and the
// minimum-wage check per kind of time where the state requires it.
import { sessionsFrom, weeklyHours } from '../../src/lib/timeclock';
import { punchState, punchProblem } from '../../src/lib/punch';
import { periodPay } from '../../src/lib/pay-period';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const tz = 'America/New_York'; const at = (d: string, hm: string) => new Date(`${d}T${hm}:00-04:00`).toISOString();
const P = (type: string, d: string, hm: string, work?: string) => ({ staffId: 'a', type, timestamp: at(d, hm), ...(work ? { work } : {}), timesheetStatus: 'approved' });

// Monday: 9–1 at the desk, 1–6 services with a 30-minute unpaid break taken during services.
const mon = [P('clock_in', '2026-10-05', '09:00', 'hourly'), P('work_switch', '2026-10-05', '13:00', 'services'), P('break_start', '2026-10-05', '14:00'), P('break_end', '2026-10-05', '14:30'), P('clock_out', '2026-10-05', '18:00')];
// Tuesday: services all day, 10–6, no break.
const tue = [P('clock_in', '2026-10-06', '10:00', 'services'), P('clock_out', '2026-10-06', '18:00')];
// Wednesday: desk 9–11 with a 20-minute break at the desk, then services 11–3.
const wed = [P('clock_in', '2026-10-07', '09:00', 'hourly'), P('break_start', '2026-10-07', '10:00'), P('break_end', '2026-10-07', '10:20'), P('work_switch', '2026-10-07', '11:00', 'services'), P('clock_out', '2026-10-07', '15:00')];
const ss = sessionsFrom([...mon, ...tue, ...wed], { timeZone: tz, now: Date.parse(at('2026-10-10', '12:00')) });
ok(ss[0].workedMinutes === 510 && ss[0].hourlyMinutes === 240, 'Monday: 4 hours of hourly work, the break comes off services', ss[0]);
ok(ss[1].hourlyMinutes === 0 && ss[1].workedMinutes === 480, 'Tuesday: all services');
ok(ss[2].workedMinutes === 340 && ss[2].hourlyMinutes === 100, 'Wednesday: the desk break comes off hourly work', ss[2]);
const wk = weeklyHours(ss, 'a', at('2026-10-05', '00:00'), at('2026-10-11', '23:59'));
ok(wk[0].hourly === 340 && wk[0].minutes === 1330, 'week: hourly-work minutes add up', wk[0]);

const open = [P('clock_in', '2026-10-08', '09:00', 'hourly')];
const st = punchState(open, { timezone: tz }, Date.parse(at('2026-10-08', '10:00')));
ok(st.clockedIn && st.work === 'hourly', 'state knows the current kind of work', st);
ok(punchProblem('switch_work', { ...st, onBreak: true }) !== null && punchProblem('switch_work', st) === null, 'switching needs the break ended first');
const sw = sessionsFrom([...open, P('work_switch', '2026-10-08', '10:00', 'hourly')], { timeZone: tz, now: Date.parse(at('2026-10-08', '11:00')) });
ok(sw[0].hourlySpans.length === 1 && sw[0].hourlySpans[0][0] === Date.parse(at('2026-10-08', '09:00')) && sw[0].work === 'hourly', 'switching to the same kind changes nothing', sw[0].hourlySpans);

// Payroll
const member = { id: 'a', name: 'Ana', payStructure: 'commission', commissionRate: 40, nonServiceRate: 15, splitTime: true };
const sale = (d: string, amount: number) => ({ id: d + amount, type: 'income', staffId: 'a', category: 'Service Revenue', amount, date: at(d, '12:00'), serviceId: 's1' });
const run = (tenant: any, txns: any[], shifts: any[] = [], mm: any = member) => periodPay({ member: mm, from: at('2026-10-05', '00:00'), to: at('2026-10-11', '23:59'), incomeTxns: txns, services: [{ id: 's1', name: 'Service', price: 100 }], tenant: { timezone: tz, ...tenant }, sessions: ss, shifts });
const l = run({}, [sale('2026-10-05', 300), sale('2026-10-06', 600), sale('2026-10-07', 200)]);
ok(l.nonServiceHours === 5.67 && Math.abs(l.nonServicePay - 85) < 0.01, 'hourly work paid at the hourly rate (340 min × $15/h)', { h: l.nonServiceHours, p: l.nonServicePay });
ok(l.servicePay === 440 && l.minWageTopUp === 0, 'commission on services; no top-up when the week averages above minimum wage', { s: l.servicePay, t: l.minWageTopUp });

// California: the commission-only hours are checked on their own.
const slow = [sale('2026-10-05', 100), sale('2026-10-06', 100)];
const fed = run({ payRules: { minimumWage: 7.25, state: 'TX' } }, slow);
const m20 = { ...member, nonServiceRate: 20 };
const ca = run({ payRules: { minimumWage: 16.5, state: 'CA' } }, slow, [], m20);
const svcH = (1330 - 340) / 60; const need = 16.5 * svcH - 80;
ok(Math.abs(ca.minWageTopUp - Math.round(need * 100) / 100) < 0.02, 'California: commission-only hours topped up to minimum wage on their own', { got: ca.minWageTopUp, want: need });
const caAvg = run({ payRules: { minimumWage: 16.5, state: 'CA', separateMinWage: false } }, slow, [], m20);
ok(caAvg.minWageTopUp < ca.minWageTopUp, 'switched off: averaged across the week instead', { avg: caAvg.minWageTopUp, sep: ca.minWageTopUp });
ok(fed.minWageTopUp >= 0 && fed.minWageTopUp < ca.minWageTopUp, 'elsewhere: averaged by default');
const low = run({ payRules: { minimumWage: 16.5, state: 'CA' } }, slow);
ok(Math.abs(low.minWageTopUp - (need + (16.5 - 15) * 340 / 60)) < 0.05, 'California: an hourly rate under minimum wage is topped up too', low.minWageTopUp);

// A desk shift on the schedule that was also clocked in as hourly work is paid once.
const shift = { staffId: 'a', kind: 'other', status: 'published', date: '2026-10-05', startTime: '09:00', endTime: '13:00' };
const both = run({}, [sale('2026-10-05', 300)], [shift]);
ok(both.nonServiceHours === l.nonServiceHours, 'scheduled hourly time and clocked hourly work are not counted twice', both.nonServiceHours);

console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
