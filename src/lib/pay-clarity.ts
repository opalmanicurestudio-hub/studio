// src/lib/pay-clarity.ts — PAY, CLEARLY (design canvas "Pay clarity"). Pure math for any business that pays by the hour,
// salary, commission, tips or a mix:
//   clarity()     what someone actually earns per hour at work (with and without tips, and after their own costs),
//                 where the money came from, booked vs unbooked time, week by week, and what it takes to reach a goal
//   planPay()     the same hours and sales, paid another way (commission, hourly, hourly + commission, the greater of
//                 the two, tiered, salary, or working for yourself), before income tax
//   minWageCheck  weeks where pay before tips came in under minimum wage for the hours worked (the owner's check)
// Every figure is before income tax. Estimates say they are estimates. Not tax or legal advice.

export type Period = {
  from: string; to: string; current?: boolean;
  total: number; tips: number; hours: number; overtimeHours: number;
  parts: { services: number; tips: number; retail: number; time: number; other: number; adjustments: number };
  visits: number; serviceSales: number; retailSales: number; bookedHours: number; scheduledHours: number;
  topUp: number; weeks?: { weekStart: string; hours: number; earned: number; topUp: number }[];
};
export type Cost = { id: string; label: string; amount: number; per: 'month' | 'once' };
export type Plan = {
  id: string; kind: 'current' | 'commission' | 'hourly' | 'hourly_commission' | 'greater_of' | 'tiered' | 'salary' | 'self' | 'draw' | 'split'; label?: string;
  rate?: number; pct?: number; retailPct?: number; tiers?: { over: number; pct: number }[]; salary?: number;
  /** Commission with a weekly advance: paid back from later commission ("recoverable") or not. */
  draw?: { perWeek: number; recoverable: boolean };
  /** Paid by the hour for some hours a week (the desk, say) and only commission for the rest. */
  split?: { hoursPerWeek: number };
  self?: { spacePerWeek: number; suppliesPct: number; cardPct: number; retailMarginPct?: number; otherMonthly?: number; unpaidWeeks?: number };
  /** What else comes with it (or costs you): paid days off a year, the employer's health insurance contribution a month,
   *  retirement match (% of pay), supplies you buy yourself a month, and your commute (minutes each way). */
  perks?: { ptoDays?: number; healthMonthly?: number; matchPct?: number; suppliesMonthly?: number; commuteMin?: number };
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const DAY = 864e5;
export const daysIn = (from: string, to: string) => Math.max(1, Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / DAY) + 1);
const MONTH_DAYS = 30.44;
export const FICA = 0.0765; export const SE_TAX = 0.153; export const SE_BASE = 0.9235;

/** Costs over a stretch of days: monthly costs scaled, one-off costs counted when they fall inside (here: all of them, as entered for the range). */
export const costsOver = (costs: Cost[], days: number) => r2((costs || []).reduce((s, c) => s + (c.per === 'month' ? (Number(c.amount) || 0) * (days / MONTH_DAYS) : Number(c.amount) || 0), 0));

export function clarity(ps: Period[], o: { costs?: Cost[]; goalMonthly?: number | null; commissionPct?: number | null } = {}) {
  const list = [...ps].sort((a, b) => a.from.localeCompare(b.from));
  const sum = (f: (p: Period) => number) => r2(list.reduce((s, p) => s + (Number(f(p)) || 0), 0));
  const days = list.length ? daysIn(list[0].from, list[list.length - 1].to) : 0;
  const gross = sum((p) => p.total), tips = sum((p) => p.tips), hours = sum((p) => p.hours), booked = sum((p) => p.bookedHours), scheduled = sum((p) => p.scheduledHours);
  const sales = sum((p) => p.serviceSales), retail = sum((p) => p.retailSales), visits = sum((p) => p.visits); const costs = costsOver(o.costs || [], days);
  const per = (v: number) => (hours > 0 ? r2(v / hours) : null);
  const sources = [
    { key: 'services', label: 'From your work', amount: sum((p) => p.parts.services) },
    { key: 'tips', label: 'Tips', amount: sum((p) => p.parts.tips) },
    { key: 'retail', label: 'Product sales', amount: sum((p) => p.parts.retail) },
    { key: 'time', label: 'Hourly, salary and paid time', amount: sum((p) => p.parts.time) },
    { key: 'other', label: 'Bonuses and extras', amount: sum((p) => p.parts.other) },
    { key: 'adjustments', label: 'Corrections', amount: sum((p) => p.parts.adjustments) },
  ].filter((x) => Math.abs(x.amount) >= 0.01);
  const trend = list.map((p) => ({ from: p.from, to: p.to, current: !!p.current, perHour: p.hours > 0 ? r2(p.total / p.hours) : null, perHourNoTips: p.hours > 0 ? r2((p.total - p.tips) / p.hours) : null, unbooked: Math.max(0, r2(p.hours - p.bookedHours)) }));
  const done = trend.filter((x) => !x.current && x.perHour !== null); const last = done[done.length - 1] || null; const prev = done[done.length - 2] || null;
  const vals = done.map((x) => x.perHour as number); const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const cv = vals.length >= 3 && mean > 0 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) / mean : null;
  const monthly = days ? r2(gross * (MONTH_DAYS / days)) : 0;
  let goal: any = null;
  if (o.goalMonthly && o.goalMonthly > 0) {
    const gap = r2(Math.max(0, o.goalMonthly - monthly)); const pct = Number(o.commissionPct) > 0 ? Number(o.commissionPct) / 100 : null;
    const avgTicket = visits > 0 ? r2(sales / visits) : null; const salesNeeded = pct ? r2(gap / pct) : null;
    const avgHoursPerVisit = visits > 0 && booked > 0 ? booked / visits : null;
    const hourly = hours > 0 ? (gross - tips) / hours : null;
    goal = { monthly: o.goalMonthly, current: monthly, gap, pct: Math.min(100, Math.round((monthly / o.goalMonthly) * 100)), salesNeeded, bookingsNeeded: salesNeeded && avgTicket ? Math.ceil(salesNeeded / avgTicket) : null,
      hoursNeeded: !pct && hourly ? Math.ceil(gap / hourly) : null, unbookedPerMonth: days ? r2(Math.max(0, hours - booked) * (MONTH_DAYS / days)) : null,
      fitsInUnbooked: salesNeeded && avgTicket && avgHoursPerVisit && days ? Math.ceil(salesNeeded / avgTicket) * avgHoursPerVisit <= Math.max(0, hours - booked) * (MONTH_DAYS / days) : null };
  }
  return { days, gross, tips, grossNoTips: r2(gross - tips), hours, perHour: per(gross), perHourNoTips: per(gross - tips), costs, perHourAfterCosts: per(gross - costs),
    bookedHours: booked, unbookedHours: Math.max(0, r2(hours - booked)), scheduledHours: scheduled, bookedShare: hours > 0 ? Math.min(100, Math.round((booked / hours) * 100)) : null,
    sales, retail, visits, avgTicket: visits > 0 ? r2(sales / visits) : null, salesPerHour: per(sales + retail), monthly, sources, trend,
    change: last && prev ? { last: last.perHour, prev: prev.perHour, unbooked: last.unbooked } : null,
    steadiness: cv === null ? null : cv < 0.12 ? 'steady' : cv < 0.25 ? 'varies a little' : 'up and down a lot', overtimeHours: sum((p) => p.overtimeHours), goal };
}

/** Tiered commission on sales over a stretch: each tier's rate on the part of sales above its line (lines are monthly, scaled to the days). */
function tiered(sales: number, base: number, tiers: { over: number; pct: number }[], days: number) {
  const sc = days / MONTH_DAYS; const steps = [{ over: 0, pct: base }, ...(tiers || []).map((t) => ({ over: Number(t.over) * sc, pct: Number(t.pct) }))].sort((a, b) => a.over - b.over);
  let pay = 0; for (let i = 0; i < steps.length; i++) { const lo = steps[i].over, hi = i + 1 < steps.length ? steps[i + 1].over : Infinity; if (sales > lo) pay += (Math.min(sales, hi) - lo) * (steps[i].pct / 100); } return pay;
}
export type Basis = { hours: number; serviceSales: number; retailSales: number; tips: number; otherPay: number; days: number; currentGross: number; minimumWage?: number;
  /** Where the state allows a tip credit: the lowest cash wage, with tips making up the rest of minimum wage. */
  tipCredit?: { cashWage: number } | null; daysPerWeek?: number; clawback?: number };
export type PlanResult = { gross: number; payBeforeTips: number; beforeIncomeTax: number; toppedUp: number; lines: { label: string; amount: number }[]; notes: string[];
  benefits: number; ownCosts: number; commuteHours: number; perHour: number | null; perHourAllIn: number | null };
/** What comes with a plan beyond pay, over the same days: paid time off, health insurance, retirement match; and what it costs you. */
function perksOf(p: Plan, b: Basis, payBeforeTips: number, gross: number) {
  const k = p.perks || {}; const sc = b.days / MONTH_DAYS; const dpw = Math.max(1, Math.min(7, Number(b.daysPerWeek) || 5)); const workdays = (b.days / 7) * dpw;
  const perDay = workdays > 0 ? b.hours / workdays : 8; const rate = b.hours > 0 ? payBeforeTips / b.hours : 0;
  const pto = (Number(k.ptoDays) || 0) * perDay * rate * (b.days / 365); const health = (Number(k.healthMonthly) || 0) * sc; const match = gross * ((Number(k.matchPct) || 0) / 100);
  const own = (Number(k.suppliesMonthly) || 0) * sc; const commute = ((Number(k.commuteMin) || 0) * 2 / 60) * workdays;
  return { benefits: r2(pto + health + match), pto: r2(pto), health: r2(health), match: r2(match), own: r2(own), commute: r2(commute) };
}
/** The same hours and sales, paid this way. `gross` includes tips; `beforeIncomeTax` takes off Social Security and Medicare
 *  (7.65% for an employee; 15.3% of 92.35% for someone working for themselves) and, for working for yourself, space, supplies and card fees. */
export function planPay(p: Plan, b: Basis): PlanResult {
  const notes: string[] = []; const lines: { label: string; amount: number }[] = []; const pct = (Number(p.pct) || 0) / 100; const rpct = (Number(p.retailPct) || 0) / 100;
  if (p.kind === 'self') {
    const s = p.self || { spacePerWeek: 0, suppliesPct: 0, cardPct: 2.9 }; const weeks = b.days / 7;
    // Weeks off are unpaid when you work for yourself: averaged over the year, the work earns less while the space still costs.
    const off = Math.max(0, Math.min(26, Number(s.unpaidWeeks) || 0)); const f = (52 - off) / 52;
    const retailKeep = b.retailSales * ((Number(s.retailMarginPct) || 0) / 100) * f;
    const income = (b.serviceSales + b.tips) * f + retailKeep; const space = (Number(s.spacePerWeek) || 0) * weeks; const supplies = b.serviceSales * f * ((Number(s.suppliesPct) || 0) / 100);
    const cards = ((b.serviceSales + b.tips) * f + (retailKeep > 0 ? b.retailSales * f : 0)) * ((Number(s.cardPct) || 0) / 100); const other = (Number(s.otherMonthly) || 0) * (b.days / MONTH_DAYS);
    const net = income - space - supplies - cards - other; const se = net > 0 ? net * SE_BASE * SE_TAX : 0;
    lines.push({ label: off ? `Sales and tips you keep (${off} weeks off a year, unpaid)` : 'Sales and tips you keep', amount: r2(income) }, { label: 'Space', amount: -r2(space) }, { label: 'Supplies', amount: -r2(supplies) }, { label: 'Card fees', amount: -r2(cards) },
      ...(other ? [{ label: 'Insurance, software, licences', amount: -r2(other) }] : []), { label: 'Self-employment tax', amount: -r2(se) });
    notes.push('Only if your clients come with you.', 'No paid time off or employer benefits.');
    const k = perksOf(p, b, income - b.tips * f, income); const hrs = b.hours * f;
    return { gross: r2(income), payBeforeTips: r2(income - b.tips * f), beforeIncomeTax: r2(net - se), toppedUp: 0, lines, notes, benefits: 0, ownCosts: 0, commuteHours: k.commute * f,
      perHour: hrs > 0 ? r2((net - se) / hrs) : null, perHourAllIn: hrs > 0 ? r2((net - se) / (hrs + k.commute * f)) : null };
  }
  let pay = 0;
  if (p.kind === 'current') pay = b.currentGross - b.tips;
  else if (p.kind === 'commission') pay = b.serviceSales * pct + b.retailSales * rpct + b.otherPay;
  else if (p.kind === 'tiered') pay = tiered(b.serviceSales, Number(p.pct) || 0, p.tiers || [], b.days) + b.retailSales * rpct + b.otherPay;
  else if (p.kind === 'hourly') pay = (Number(p.rate) || 0) * b.hours;
  else if (p.kind === 'hourly_commission') pay = (Number(p.rate) || 0) * b.hours + b.serviceSales * pct + b.retailSales * rpct;
  else if (p.kind === 'greater_of') { const h = (Number(p.rate) || 0) * b.hours, c = b.serviceSales * pct + b.retailSales * rpct + b.otherPay; pay = Math.max(h, c); notes.push('Payroll works this out week by week, so the real figure can be a little higher.'); }
  else if (p.kind === 'salary') pay = (Number(p.salary) || 0) * (b.days / 365);
  else if (p.kind === 'split') { const dh = Math.min(b.hours, (Number(p.split?.hoursPerWeek) || 0) * (b.days / 7));
    pay = (Number(p.rate) || 0) * dh + b.serviceSales * pct + b.retailSales * rpct + b.otherPay;
    notes.push(`Hourly for ${Math.round(dh)} of the ${Math.round(b.hours)} hours, commission only for the rest.`, 'Some states (California, for one) require the commission-only hours to earn at least minimum wage on their own, not averaged with the hourly pay.'); }
  else if (p.kind === 'draw') { const c = b.serviceSales * pct + b.retailSales * rpct + b.otherPay; const dr = (Number(p.draw?.perWeek) || 0) * (b.days / 7);
    if (p.draw?.recoverable) { pay = c; if (c < dr) notes.push(`The weekly advance is more than the commission earned: about $${Math.round(dr - c).toLocaleString('en-US')} would be taken back from later pay.`); else notes.push('Advances are paid back from commission, so over time you earn the commission.'); }
    else { pay = Math.max(c, dr); if (dr > c) notes.push('The advance isn’t paid back, so it works like a guaranteed minimum.'); } }
  // Commission taken back when a client gets a refund or a sale is cancelled.
  if (b.clawback && ['commission', 'tiered', 'hourly_commission', 'greater_of', 'draw', 'split'].includes(p.kind)) { pay = Math.max(0, pay - b.clawback); lines.push({ label: 'Commission taken back for refunds', amount: -r2(b.clawback) }); }
  let toppedUp = 0;
  if (p.kind !== 'current' && b.minimumWage && b.hours > 0) {
    // Minimum wage for the hours: pay before tips, unless the state allows a tip credit (then tips can make up the gap above the cash wage).
    const need = b.tipCredit ? Math.max((Number(b.tipCredit.cashWage) || 0) * b.hours, b.minimumWage * b.hours - b.tips) : b.minimumWage * b.hours;
    if (pay < need) { toppedUp = need - pay; pay += toppedUp; notes.push('This would fall under minimum wage for the hours, so payroll has to top it up.'); }
  }
  if (p.kind === 'hourly' || p.kind === 'hourly_commission') notes.push('Overtime would add to this when a week goes past the overtime line.');
  const gross = pay + b.tips; const k = perksOf(p, b, pay, gross);
  lines.push({ label: 'Pay', amount: r2(pay) }, { label: 'Tips', amount: r2(b.tips) }, { label: 'Social Security and Medicare', amount: -r2(gross * FICA) });
  if (k.benefits) lines.push({ label: `Benefits${k.pto ? ', paid days off' : ''}${k.health ? ', health insurance' : ''}${k.match ? ', retirement match' : ''}`, amount: k.benefits });
  if (k.own) lines.push({ label: 'Supplies you buy yourself', amount: -k.own });
  const all = gross * (1 - FICA) + k.benefits - k.own;
  return { gross: r2(gross), payBeforeTips: r2(pay), beforeIncomeTax: r2(gross * (1 - FICA)), toppedUp: r2(toppedUp), lines, notes, benefits: k.benefits, ownCosts: k.own, commuteHours: k.commute,
    perHour: b.hours > 0 ? r2((gross * (1 - FICA)) / b.hours) : null, perHourAllIn: b.hours > 0 ? r2(all / (b.hours + k.commute)) : null };
}
/** Where working for yourself and this job pay the same, in monthly sales (everything else as entered). Null when it never does. */
export function breakEvenSales(self: Plan, job: Plan, b: Basis): number | null {
  const at = (s: number) => { const x = { ...b, serviceSales: s }; return planPay(self, x).beforeIncomeTax - planPay(job.kind === 'current' ? { ...job, kind: 'commission' } : job, x).beforeIncomeTax; };
  let lo = 0, hi = Math.max(1000, b.serviceSales * 4); if (at(lo) > 0) return 0; if (at(hi) < 0) return null;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (at(mid) > 0) hi = mid; else lo = mid; }
  return Math.round(((lo + hi) / 2) * (MONTH_DAYS / b.days) / 50) * 50;
}
/** How they're paid now, as a plan (from their pay record), for the comparison list. */
export function planOfRecord(m: any): Plan {
  const ps = String(m?.payStructure || 'commission'); const pct = Number(m?.commissionRate) || 0; const rpct = Number(m?.retailCommissionRate) || 0;
  if (ps === 'hourly') return { id: 'now', kind: 'hourly', rate: Number(m?.hourlyRate) || 0 };
  if (ps === 'hourly_plus_commission') return { id: 'now', kind: 'hourly_commission', rate: Number(m?.hourlyRate) || 0, pct, retailPct: rpct };
  if (ps === 'salary') return { id: 'now', kind: 'salary', salary: m?.salaryPer === 'week' ? (Number(m?.salaryAmount) || 0) * 52 : Number(m?.salaryAmount) || (Number(m?.salaryWeekly) || 0) * 52 };
  if (Array.isArray(m?.commissionTiers) && m.commissionTiers.length) return { id: 'now', kind: 'tiered', pct, retailPct: rpct, tiers: m.commissionTiers };
  return { id: 'now', kind: 'commission', pct, retailPct: rpct };
}
export function planLabel(p: Plan): string {
  const $ = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (p.label) return p.label;
  switch (p.kind) {
    case 'current': return 'How you’re paid now';
    case 'commission': return `${p.pct || 0}% commission${p.retailPct ? `, ${p.retailPct}% on products` : ''}`;
    case 'tiered': return `${p.pct || 0}%, then ${(p.tiers || []).map((t) => `${t.pct}% over ${$(t.over)}`).join(', ')}`;
    case 'hourly': return `${$(p.rate || 0)} an hour`;
    case 'hourly_commission': return `${$(p.rate || 0)} an hour + ${p.pct || 0}%`;
    case 'greater_of': return `${$(p.rate || 0)} an hour or ${p.pct || 0}%, whichever is more`;
    case 'salary': return `${$(p.salary || 0)} a year`;
    case 'self': return `Working for myself (${$(p.self?.spacePerWeek || 0)} a week for space)`;
    case 'split': return `${$(p.rate || 0)} an hour for ${p.split?.hoursPerWeek || 0} hours a week, ${p.pct || 0}% on the rest`;
    case 'draw': return `${p.pct || 0}% commission with a ${$(p.draw?.perWeek || 0)} weekly advance${p.draw?.recoverable ? ' (paid back)' : ''}`;
  }
}
/** Owner's check: weeks where pay before tips was under minimum wage × hours (payroll's top-up), and what it came to. */
export function minWageWeeks(ps: Period[]) {
  const weeks = ps.flatMap((p) => p.weeks || []).filter((w) => (Number(w.topUp) || 0) > 0.005);
  const fromParts = ps.reduce((s, p) => s + (Number(p.topUp) || 0), 0);
  return { weeks: weeks.length || (fromParts > 0 ? null : 0), amount: r2(weeks.length ? weeks.reduce((s, w) => s + w.topUp, 0) : fromParts) };
}
export function cleanPlan(x: any): Plan | null {
  const kinds = ['commission', 'hourly', 'hourly_commission', 'greater_of', 'tiered', 'salary', 'self', 'draw', 'split']; if (!x || !kinds.includes(x.kind)) return null;
  const n = (v: any, hi: number) => { const k = Number(v); return Number.isFinite(k) ? Math.max(0, Math.min(hi, k)) : 0; };
  return { id: String(x.id || Math.random().toString(36).slice(2, 9)).slice(0, 30), kind: x.kind, label: x.label ? String(x.label).slice(0, 60) : undefined,
    rate: n(x.rate, 1000), pct: n(x.pct, 100), retailPct: n(x.retailPct, 100), salary: n(x.salary, 10000000),
    tiers: Array.isArray(x.tiers) ? x.tiers.slice(0, 5).map((t: any) => ({ over: n(t?.over, 10000000), pct: n(t?.pct, 100) })) : undefined,
    self: x.kind === 'self' ? { spacePerWeek: n(x.self?.spacePerWeek, 100000), suppliesPct: n(x.self?.suppliesPct, 100), cardPct: n(x.self?.cardPct, 10), retailMarginPct: n(x.self?.retailMarginPct, 100), otherMonthly: n(x.self?.otherMonthly, 100000), unpaidWeeks: n(x.self?.unpaidWeeks, 26) } : undefined,
    split: x.kind === 'split' ? { hoursPerWeek: n(x.split?.hoursPerWeek, 80) } : undefined,
    draw: x.kind === 'draw' ? { perWeek: n(x.draw?.perWeek, 100000), recoverable: x.draw?.recoverable !== false } : undefined,
    perks: x.perks ? { ptoDays: n(x.perks.ptoDays, 120), healthMonthly: n(x.perks.healthMonthly, 10000), matchPct: n(x.perks.matchPct, 25), suppliesMonthly: n(x.perks.suppliesMonthly, 10000), commuteMin: n(x.perks.commuteMin, 300) } : undefined };
}
