// src/lib/pay-period.ts — ONE PERSON'S PAY FOR A PAY PERIOD, the same on the payroll draft, Payday and the Money overview.
//
//   hours        from the time clock (lib/timeclock), split per workweek at the overtime threshold (default 40 h)
//   hourly       regular hours × rate, overtime hours × rate × multiplier (default 1.5)
//   services     commission per service / per service pay (lib/commission) + retail commission + extras (sale bonus,
//                no-show share)
//   salary       the salary for the period (a year's salary ÷ 52 per week); exempt from overtime unless marked otherwise
//   overtime on  for people paid commission or per service, overtime is half their "regular rate" (that week's pay ÷
//   other pay    that week's hours) for each overtime hour — the US rule; hourly + commission adds the commission part
//   minimum wage each workweek, pay before tips must reach minimum wage × hours worked; any shortfall is a top-up
//   tips         never count toward minimum wage or the overtime rate
//
// Not legal advice: wage rules differ by state and city (daily overtime in California, tip credits, exempt status).
import { serviceEarnings, earnsCommission, paidPerService, payExtras, tierBonus, payReversals } from '@/lib/commission';
import { weeklyHours, sessionsIn, localDay, weekOf, type Session } from '@/lib/timeclock';
import { shiftWindow } from '@/lib/shift-check';

export type PayLine = {
  staffId: string; name: string; payStructure: string;
  hours: number; regularHours: number; overtimeHours: number; doubleTimeHours: number;
  hourlyPay: number; salaryPay: number; servicePay: number; retail: number; extras: number;
  tierBonus: number; refundTakeBack: number; refunds: number;   // both already inside servicePay
  nonServicePay: number; nonServiceHours: number;               // training / meetings / other paid time (commission / per service people)
  overtimePremium: number;     // overtime owed beyond what hourly pay already covers (commission / per service / the commission part of hourly + commission)
  minWageTopUp: number;
  tips: number; total: number;
  missingClockOuts: number;    // sessions waiting for a manager — not paid until fixed
  unapprovedSessions: number;  // with "pay approved hours only": sessions still waiting for approval
  noHours: boolean;            // earned from services but has no hours on the clock (minimum wage and overtime can't be checked)
  weeks: { weekStart: string; hours: number; overtimeHours: number; doubleTimeHours: number; earned: number; topUp: number; premium: number }[];
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const amt = (t: any) => (typeof t?.amount === 'number' ? t.amount : (Number(t?.amountCents) || 0) / 100);

export function payRules(tenant: any) {
  return {
    minimumWage: Number(tenant?.payRules?.minimumWage) > 0 ? Number(tenant.payRules.minimumWage) : 7.25,
    overtimeHours: Number(tenant?.overtimeThresholdHours) > 0 ? Number(tenant.overtimeThresholdHours) : 40,
    multiplier: Number(tenant?.overtimeMultiplier) > 1 ? Number(tenant.overtimeMultiplier) : 1.5,
    dailyOvertimeHours: Number(tenant?.dailyOvertimeHours) > 0 && tenant?.dailyOvertimeOn === true ? Number(tenant.dailyOvertimeHours) : 0,   // daily overtime only when switched on (e.g. California)
    doubleTimeAfterHours: Number(tenant?.doubleTimeAfterHours) > 0 && tenant?.dailyOvertimeOn === true ? Number(tenant.doubleTimeAfterHours) : 0,
    timeZone: tenant?.timezone || 'America/New_York',
    weekStartsOn: Number.isInteger(tenant?.workweekStartsOn) ? tenant.workweekStartsOn : 1,
  };
}

/** A year's salary from the person's record (salaryAmount + salaryPer 'year' | 'week'; the old salaryWeekly is read too). */
export function annualSalary(m: any): number {
  const a = Number(m?.salaryAmount) || 0; if (a > 0) return m?.salaryPer === 'week' ? a * 52 : a;
  return (Number(m?.salaryWeekly) || 0) * 52;
}

export function periodPay(input: {
  member: any; from: Date | string; to: Date | string; incomeTxns: any[]; services: any[]; tenant: any; sessions: Session[];
  apptStaff?: Record<string, string>; tips?: number;
  shifts?: any[];   // the schedule, for paid non-service time (training, meetings, other) — optional
}): PayLine {
  const { member: m, tenant } = input; const rules = payRules(tenant); const ps = String(m.payStructure || 'commission');
  const fromMs = new Date(input.from as any).getTime(), toMs = new Date(input.to as any).getTime();
  // Their sales — including services they assisted on (a shared service names them in splitWith). The list passed in
  // may hold every transaction for the period: refund lines are read for take-backs, other people's ignored.
  const mine = (input.incomeTxns || []).filter((t) => (t.type || 'income') === 'income' && (t.staffId === m.id || t.splitWith?.staffId === m.id));
  const tips = input.tips ?? mine.filter((t) => t.staffId === m.id && (t.category === 'Tips' || t.tipAmount)).reduce((s, t) => s + (t.tipAmount || amt(t)), 0);

  // Hours, per workweek. With "pay approved hours only" on, sessions a manager hasn't approved wait for the next run.
  const approvedOnly = tenant?.payRules?.approvedHoursOnly === true;
  const inRange = sessionsIn(input.sessions, fromMs, toMs, m.id);
  const unapproved = approvedOnly ? inRange.filter((x) => !x.missingOut && x.status !== 'approved' && x.status !== 'rejected').length : 0;
  const counted = approvedOnly ? input.sessions.filter((x) => x.staffId !== m.id || x.status === 'approved') : input.sessions;
  const weeks = weeklyHours(counted, m.id, fromMs, toMs, rules.overtimeHours, { afterHours: rules.dailyOvertimeHours, doubleAfterHours: rules.doubleTimeAfterHours });
  const missingClockOuts = sessionsIn(input.sessions, fromMs, toMs, m.id).filter((s) => s.missingOut).length;
  const hours = weeks.reduce((a, w) => a + w.minutes, 0) / 60; const otHours = weeks.reduce((a, w) => a + w.overtime, 0) / 60; const dtHours = weeks.reduce((a, w) => a + (w.doubleTime || 0), 0) / 60; const regHours = hours - otHours - dtHours;

  // Earnings from services and sales, per workweek (by the sale's local date)
  const weekOfTxn = (t: any) => weekOf(localDay(Date.parse(t.date) || Date.now(), rules.timeZone), rules.weekStartsOn);
  const byWeek = new Map<string, any[]>(); for (const t of mine) { const k = weekOfTxn(t); (byWeek.get(k) || byWeek.set(k, []).get(k)!).push(t); }
  const earns = earnsCommission(m) || paidPerService(m);
  const svcFor = (txns: any[]) => serviceEarnings(m, txns, input.services, 40);
  const retailFor = (txns: any[]) => (earns && m.retailCommissionRate ? txns.filter((t) => t.category === 'Retail' && t.staffId === m.id).reduce((s, t) => s + amt(t), 0) * (Number(m.retailCommissionRate) / 100) : 0);
  const tiers = tierBonus(m, mine, input.services, 40);                       // sales tiers (higher rate above a level)
  const refunds = payReversals(m, input.incomeTxns || []);                     // commission taken back on refunds this period
  const servicePay = svcFor(mine) + tiers - refunds.total; const retail = retailFor(mine);

  // Paid non-service time: commission / per service people are paid an hourly rate for training, meetings and other
  // non-service shifts on the schedule — the time they were actually clocked in during it.
  const nsRate = Number(m.nonServiceRate) > 0 ? Number(m.nonServiceRate) : Number(tenant?.payRules?.nonServiceRate) > 0 ? Number(tenant.payRules.nonServiceRate) : rules.minimumWage;
  const nsByWeek = new Map<string, number>(); let nsMinutes = 0;
  if (earns && Array.isArray(input.shifts)) for (const sh of input.shifts) {
    if (sh?.staffId !== m.id || !sh.kind || sh.kind === 'work' || ['draft', 'cancelled', 'denied'].includes(String(sh.status || 'published'))) continue;
    const w = shiftWindow(sh, rules.timeZone); if (!w || w.start < fromMs || w.start > toMs) continue;
    let got = 0; for (const x of counted) { if (x.staffId !== m.id || x.missingOut || x.status === 'rejected') continue; const a = Date.parse(x.inAt), b = x.outAt ? Date.parse(x.outAt) : Date.now(); got += Math.max(0, Math.min(b, w.end) - Math.max(a, w.start)) / 60000; }
    const cap = Math.max(0, (w.end - w.start) / 60000 - (Number(sh.breakMinutes) || 0)); const mins = Math.min(got, cap); if (mins <= 0) continue;
    nsMinutes += mins; const wk = weekOf(localDay(w.start, rules.timeZone), rules.weekStartsOn); nsByWeek.set(wk, (nsByWeek.get(wk) || 0) + mins);
  }
  const nonServicePay = r2((nsMinutes / 60) * nsRate);
  const ex = payExtras(m, input.incomeTxns || [], tenant, input.apptStaff || {}); const extras = ex.saleBonus + ex.noShow;

  // Hourly and salary
  const rate = Number(m.hourlyRate) || 0; const hourlyish = ps === 'hourly' || ps === 'hourly_plus_commission';
  const hourlyPay = hourlyish && rate ? regHours * rate + otHours * rate * rules.multiplier + dtHours * rate * 2 : 0;
  const days = Math.max(0, (toMs - fromMs) / 86400000); const salaryWeekly = annualSalary(m) / 52;
  const salaryPay = ps === 'salary' ? salaryWeekly * Math.min(days, 366) / 7 : 0;
  const salaryNonExempt = ps === 'salary' && (m.overtimeExempt === false || m.overtimeNonExempt === true);

  // Per workweek: overtime on other pay, and the minimum-wage check
  let overtimePremium = 0, minWageTopUp = 0; const weekRows: PayLine['weeks'] = [];
  for (const w of weeks) {
    const h = w.minutes / 60, ot = w.overtime / 60, dt = (w.doubleTime || 0) / 60; const wt = byWeek.get(w.weekStart) || [];
    const other = (earns ? svcFor(wt) + retailFor(wt) + ((nsByWeek.get(w.weekStart) || 0) / 60) * nsRate : 0);                                   // commission / per service / retail that week
    const straight = (hourlyish ? h * rate : 0) + other + (ps === 'salary' ? salaryWeekly : 0);  // pay for the week before overtime and tips
    let premium = 0;
    if (h > 0 && (ot > 0 || dt > 0)) {
      // overtime adds half the regular rate per hour; double time adds a full regular rate
      if (ps === 'commission' || ps === 'per_service') { const rr = Math.max(rules.minimumWage, other / h); premium = 0.5 * rr * ot + rr * dt; }
      else if (ps === 'hourly_plus_commission') { const rr = other / h; premium = 0.5 * rr * ot + rr * dt; }   // the hourly part is already in hourlyPay
      else if (salaryNonExempt) premium = (ot * rules.multiplier + dt * 2) * (salaryWeekly / rules.overtimeHours);
    }
    const topUp = ps !== 'salary' && h > 0 ? Math.max(0, rules.minimumWage * h - straight) : 0;
    overtimePremium += premium; minWageTopUp += topUp;
    weekRows.push({ weekStart: w.weekStart, hours: r2(h), overtimeHours: r2(ot), doubleTimeHours: r2(dt), earned: r2(straight), topUp: r2(topUp), premium: r2(premium) });
  }

  const total = hourlyPay + salaryPay + servicePay + retail + extras + nonServicePay + overtimePremium + minWageTopUp + tips;
  return { staffId: m.id, name: m.name, payStructure: ps, hours: r2(hours), regularHours: r2(regHours), overtimeHours: r2(otHours), doubleTimeHours: r2(dtHours),
    hourlyPay: r2(hourlyPay), salaryPay: r2(salaryPay), servicePay: r2(servicePay), retail: r2(retail), extras: r2(extras), tierBonus: r2(tiers), refundTakeBack: r2(refunds.total), refunds: refunds.count, nonServicePay, nonServiceHours: r2(nsMinutes / 60),
    overtimePremium: r2(overtimePremium), minWageTopUp: r2(minWageTopUp), tips: r2(tips), total: r2(total), missingClockOuts, unapprovedSessions: unapproved,
    noHours: (earns && servicePay > 0 && hours === 0), weeks: weekRows };
}

/** What payroll (Gusto) is sent: hours for hourly pay (Gusto applies the rate), and everything else as fixed amounts. */
export function payrollFields(l: PayLine) {
  const hourly = l.payStructure === 'hourly' || l.payStructure === 'hourly_plus_commission';
  return {
    regularHours: hourly ? l.regularHours : 0, overtimeHours: hourly ? l.overtimeHours : 0, doubleOvertimeHours: hourly ? l.doubleTimeHours : 0,
    commission: r2(l.servicePay + l.retail + l.extras),
    bonus: r2(l.overtimePremium + l.minWageTopUp + l.nonServicePay),   // overtime on commission / per service pay, minimum-wage top-ups, paid non-service time
    salary: l.salaryPay, tips: l.tips,
  };
}
