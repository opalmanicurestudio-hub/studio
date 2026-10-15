// src/lib/pay-extras.ts — the rest of "pay, clearly" (lib/pay-clarity): what pay is worth all in (benefits, commute,
// hours worked off the clock), a rough income tax estimate, whether a stretch is long enough to trust, the tip-credit
// rules by state, and the employee-or-contractor questions. Pure; US rules; estimates, never tax or legal advice.

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const MONTH_DAYS = 30.44;

// ── All in ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type MyPerks = { ptoDays?: number; healthMonthly?: number; matchPct?: number; commuteMin?: number; daysPerWeek?: number; offClockMonthly?: number };
/** Pay per hour counting benefits, the commute and hours worked off the clock, over a stretch of `days`. */
export function allIn(o: { gross: number; grossNoTips: number; hours: number; days: number; costs: number }, k: MyPerks) {
  const sc = o.days / MONTH_DAYS; const dpw = Math.max(1, Math.min(7, Number(k.daysPerWeek) || 5)); const workdays = (o.days / 7) * dpw;
  const perDay = workdays > 0 && o.hours > 0 ? o.hours / workdays : 8; const rate = o.hours > 0 ? o.grossNoTips / o.hours : 0;
  const pto = (Number(k.ptoDays) || 0) * perDay * rate * (o.days / 365); const health = (Number(k.healthMonthly) || 0) * sc; const match = o.gross * ((Number(k.matchPct) || 0) / 100);
  const benefits = r2(pto + health + match); const commute = r2(((Number(k.commuteMin) || 0) * 2 / 60) * workdays); const offClock = r2((Number(k.offClockMonthly) || 0) * sc);
  const h = o.hours + offClock; const hc = h + commute;
  return { benefits, pto: r2(pto), health: r2(health), match: r2(match), commuteHours: commute, offClockHours: offClock,
    perHourWithOffClock: h > 0 && offClock ? r2((o.gross - o.costs) / h) : null, perHourWithCommute: hc > 0 && commute ? r2((o.gross - o.costs) / hc) : null,
    perHourWithBenefits: h > 0 && benefits ? r2((o.gross - o.costs + benefits) / h) : null, perHourAllIn: hc > 0 ? r2((o.gross - o.costs + benefits) / hc) : null };
}

// ── A rough income tax estimate ─────────────────────────────────────────────────────────────────────────────────────
export type Filing = 'single' | 'joint' | 'head';
/** 2026 federal brackets and standard deductions (IRS, for income earned in 2026). */
const BRACKETS: Record<Filing, [number, number][]> = {
  single: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]],
  joint: [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]],
  head: [[17700, 0.10], [67450, 0.12], [105700, 0.22], [201750, 0.24], [256200, 0.32], [640600, 0.35], [Infinity, 0.37]],
};
export const STANDARD_DEDUCTION: Record<Filing, number> = { single: 16100, joint: 32200, head: 24150 };
export const TAX_YEAR = 2026;
/** Federal income tax on a year's income, roughly: standard deduction, the brackets, nothing else (no credits, no other
 *  income, no other deductions). For someone working for themselves, half their self-employment tax comes off first. */
export function federalTax(annual: number, filing: Filing = 'single', halfSeTax = 0): number {
  let taxable = Math.max(0, annual - halfSeTax - STANDARD_DEDUCTION[filing]); let tax = 0, lo = 0;
  for (const [hi, rate] of BRACKETS[filing]) { if (taxable <= 0) break; const part = Math.min(taxable, hi - lo); tax += part * rate; taxable -= part; lo = hi; }
  return r2(tax);
}
/** Take-home, roughly, for a month: before-income-tax figure less federal tax (on the yearly amount, by month) and a flat state rate. */
export function takeHome(monthlyBeforeIncomeTax: number, o: { filing?: Filing; statePct?: number; selfEmployedSeTaxMonthly?: number; monthlyTaxable?: number }) {
  const annualTaxable = (o.monthlyTaxable ?? monthlyBeforeIncomeTax) * 12;
  const fed = federalTax(annualTaxable, o.filing || 'single', (o.selfEmployedSeTaxMonthly || 0) * 6) / 12;
  const state = annualTaxable * ((Number(o.statePct) || 0) / 100) / 12;
  return { federal: r2(fed), state: r2(state), takeHome: r2(monthlyBeforeIncomeTax - fed - state) };
}

// ── Is this stretch long enough to trust? ───────────────────────────────────────────────────────────────────────────
export function seasonalityHint(days: number, perHours: (number | null)[]): string | null {
  const v = perHours.filter((x): x is number => x !== null && x > 0); if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length; const cv = v.length >= 2 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) / mean : 0;
  if (days < 50 && cv > 0.2) return 'Your pay moves a lot from one period to the next, so four weeks can mislead. Look at three months too.';
  if (days < 50) return 'Four weeks is a snapshot. A slow month or a holiday rush can tilt it; three months is steadier.';
  if (cv > 0.3) return 'Your pay per hour swings a lot. The average here hides busy and quiet stretches.';
  return null;
}

// ── Tip credit by state ─────────────────────────────────────────────────────────────────────────────────────────────
/** States (and DC) where tips can't count toward minimum wage: everyone gets the full minimum wage before tips. */
export const NO_TIP_CREDIT = ['AK', 'CA', 'MN', 'MT', 'NV', 'OR', 'WA'];
export const FEDERAL_CASH_WAGE = 2.13;
export const US_STATES: [string, string][] = [['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming']];
/** The tip credit the business set, if its state allows one; null means tips never count toward minimum wage. */
export function tipCreditOf(tenant: any): { cashWage: number; state: string } | null {
  const tc = tenant?.payRules?.tipCredit; const st = String(tenant?.payRules?.state || tc?.state || '').toUpperCase();
  if (!tc || tc.on !== true || !st || NO_TIP_CREDIT.includes(st)) return null;
  const cash = Number(tc.cashWage); return cash > 0 ? { cashWage: cash, state: st } : null;
}

// ── Employee or contractor? ─────────────────────────────────────────────────────────────────────────────────────────
/** The questions labor agencies look at. More "yes" answers on the first list point toward employee. Not legal advice. */
export const CONTRACTOR_QUESTIONS: { id: string; q: string; owner: string; employeeIfYes: boolean }[] = [
  { id: 'schedule', q: 'Does the business set your hours or schedule?', owner: 'Do you set their hours or schedule?', employeeIfYes: true },
  { id: 'how', q: 'Does the business tell you how to do the work (methods, scripts, looks)?', owner: 'Do you tell them how to do the work (methods, scripts, looks)?', employeeIfYes: true },
  { id: 'supplies', q: 'Does the business provide your tools, products or supplies?', owner: 'Do you provide their tools, products or supplies?', employeeIfYes: true },
  { id: 'prices', q: 'Does the business set your prices?', owner: 'Do you set their prices?', employeeIfYes: true },
  { id: 'clients', q: 'Does the business book your clients and take the payments?', owner: 'Do you book their clients and take the payments?', employeeIfYes: true },
  { id: 'core', q: 'Is your work the main thing the business sells?', owner: 'Is their work the main thing your business sells?', employeeIfYes: true },
  { id: 'ongoing', q: 'Is it ongoing, with no end date?', owner: 'Is it ongoing, with no end date?', employeeIfYes: true },
  { id: 'others', q: 'Can you work for other businesses or your own clients at the same time?', owner: 'Can they work for other businesses or their own clients at the same time?', employeeIfYes: false },
  { id: 'invest', q: 'Did you invest your own money (space, equipment) and can you make or lose money?', owner: 'Did they invest their own money and can they make or lose money?', employeeIfYes: false },
  { id: 'own', q: 'Do you have your own business name, license and insurance?', owner: 'Do they have their own business name, license and insurance?', employeeIfYes: false },
];
export function contractorLean(answers: Record<string, boolean | null | undefined>): { employee: number; contractor: number; answered: number; lean: 'employee' | 'contractor' | 'mixed' | null } {
  let e = 0, c = 0, n = 0; for (const q of CONTRACTOR_QUESTIONS) { const a = answers[q.id]; if (a === true || a === false) { n++; if (a === q.employeeIfYes) e++; else c++; } }
  return { employee: e, contractor: c, answered: n, lean: n < 4 ? null : e >= c * 2 ? 'employee' : c >= e * 2 ? 'contractor' : 'mixed' };
}
