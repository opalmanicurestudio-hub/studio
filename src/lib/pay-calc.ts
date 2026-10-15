// src/lib/pay-calc.ts — the public pay calculator's state and math (page: /pay-calculator). Pure and client-side:
// nothing here is sent or stored. The state packs into the address (#s=…) so a "private link" carries the numbers
// itself. Uses the same engine as the in-app pay pages (lib/pay-clarity, lib/pay-extras) and the yearly government
// pay data (lib/wage-data). US rules. Estimates, not tax or legal advice.
import { planPay, breakEvenSales, FICA, type Plan, type Basis } from './pay-clarity';
import { allIn, takeHome, contractorLean, NO_TIP_CREDIT, FEDERAL_CASH_WAGE, type Filing } from './pay-extras';
import { wageRange } from './wage-data';

const MONTH_DAYS = 30.44;
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: any) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));

export type Mode = 'job' | 'self' | 'offer';
export type PayType = 'hourly' | 'commission' | 'hourly_commission' | 'greater_of' | 'salary' | 'draw' | 'tips';
export type OfferPay = { payType: Exclude<PayType, 'tips'>; rate: number | null; pct: number | null; retailPct: number | null; salary: number | null; drawPerWeek: number | null;
  ptoDays: number | null; healthMonthly: number | null; matchPct: number | null; suppliesMonthly: number | null; commuteMin: number | null };
export type CalcState = {
  v: 1; mode: Mode; payType: PayType;
  weeks: number; daysPerWeek: number | null; hoursPerDay: number | null;
  rate: number | null; pct: number | null; retailPct: number | null; salary: number | null; drawPerWeek: number | null; drawBack: boolean;
  sales: number | null; retailSales: number | null; paid: number | null; bonus: number | null; tips: number | null;
  costsMonthly: number | null; clawback: number | null;
  ptoDays: number | null; healthMonthly: number | null; matchPct: number | null;
  commuteMin: number | null; offClockMonthly: number | null;
  soc: string; state: string; minWage: number | null; contractor: boolean | null; cq: Record<string, boolean>;
  self: { spacePerWeek: number | null; suppliesPct: number | null; cardPct: number | null; otherMonthly: number | null; unpaidWeeks: number | null };
  offer: OfferPay;
  tax: { on: boolean; filing: Filing; statePct: number | null };
  est: string[];
};

export function blank(mode: Mode = 'job'): CalcState {
  return { v: 1, mode, payType: mode === 'self' ? 'commission' : 'hourly', weeks: 4, daysPerWeek: 5, hoursPerDay: 8,
    rate: null, pct: null, retailPct: null, salary: null, drawPerWeek: null, drawBack: true,
    sales: null, retailSales: null, paid: null, bonus: null, tips: null, costsMonthly: null, clawback: null,
    ptoDays: null, healthMonthly: null, matchPct: null, commuteMin: null, offClockMonthly: null,
    soc: '', state: '', minWage: 7.25, contractor: null, cq: {},
    self: { spacePerWeek: 250, suppliesPct: 10, cardPct: 2.9, otherMonthly: 90, unpaidWeeks: 2 },
    offer: { payType: 'hourly', rate: null, pct: null, retailPct: null, salary: null, drawPerWeek: null, ptoDays: null, healthMonthly: null, matchPct: null, suppliesMonthly: null, commuteMin: null },
    tax: { on: false, filing: 'single', statePct: null }, est: [] };
}

// ── The private link: the state, packed into the address ─────────────────────────────────────────────────────────
const b64 = (s: string) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'));
const unb64 = (s: string) => (typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'));
export function encodeState(s: CalcState): string {
  const json = JSON.stringify(s); const bytes = new TextEncoder().encode(json); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return b64(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeState(code: string): CalcState | null {
  try {
    const bin = unb64(code.replace(/-/g, '+').replace(/_/g, '/')); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const x = JSON.parse(new TextDecoder().decode(bytes)); if (!x || x.v !== 1 || !['job', 'self', 'offer'].includes(x.mode)) return null;
    const d = blank(x.mode); return { ...d, ...x, self: { ...d.self, ...(x.self || {}) }, offer: { ...d.offer, ...(x.offer || {}) }, tax: { ...d.tax, ...(x.tax || {}) }, cq: x.cq || {}, est: Array.isArray(x.est) ? x.est.slice(0, 40) : [] };
  } catch { return null; }
}

// ── The math ────────────────────────────────────────────────────────────────────────────────────────────────────
export const hoursOf = (s: CalcState) => r2(Math.max(0, num(s.weeks)) * Math.max(0, num(s.daysPerWeek)) * Math.max(0, num(s.hoursPerDay)));
const tipCreditFor = (s: CalcState) => (s.payType === 'tips' && s.state && !NO_TIP_CREDIT.includes(s.state) ? { cashWage: num(s.rate) || FEDERAL_CASH_WAGE } : null);

export function planFor(t: PayType | OfferPay['payType'], x: { rate: number | null; pct: number | null; retailPct: number | null; salary: number | null; drawPerWeek?: number | null; drawBack?: boolean }, id = 'now'): Plan {
  const rate = num(x.rate), pct = num(x.pct), retailPct = num(x.retailPct);
  if (t === 'hourly' || t === 'tips') return { id, kind: 'hourly', rate };
  if (t === 'commission') return { id, kind: 'commission', pct, retailPct };
  if (t === 'hourly_commission') return { id, kind: 'hourly_commission', rate, pct, retailPct };
  if (t === 'greater_of') return { id, kind: 'greater_of', rate, pct, retailPct };
  if (t === 'salary') return { id, kind: 'salary', salary: num(x.salary) };
  return { id, kind: 'draw', pct, retailPct, draw: { perWeek: num(x.drawPerWeek), recoverable: x.drawBack !== false } };
}
export function basisOf(s: CalcState, currentGross = 0): Basis {
  const days = Math.max(7, Math.round(num(s.weeks) * 7));
  return { hours: hoursOf(s), serviceSales: num(s.sales), retailSales: num(s.retailSales), tips: num(s.tips), otherPay: num(s.bonus), days, currentGross,
    minimumWage: num(s.minWage) || undefined, tipCredit: tipCreditFor(s), daysPerWeek: num(s.daysPerWeek) || 5, clawback: num(s.clawback) || undefined };
}
const monthly = (v: number, days: number) => r2(v * (MONTH_DAYS / days));
/** A plan's month, all in: before income tax, plus benefits, less what you pay for yourself. */
const allInMonth = (p: Plan, b: Basis) => { const r = planPay(p, b); return { r, month: monthly(r.beforeIncomeTax + r.benefits - r.ownCosts, b.days) }; };

export type Row = { key: string; plan: Plan; month: number; perHourAllIn: number | null; now?: boolean; offer?: boolean };
export type Ask = { k: 'askMin' | 'askOffClock' | 'askCosts' | 'askClawback' | 'askUnbooked'; v?: number; h?: number };

export function compute(s: CalcState) {
  const hours = hoursOf(s); const base = basisOf(s); const days = base.days;
  const nowPerks = { ptoDays: num(s.ptoDays), healthMonthly: num(s.healthMonthly), matchPct: num(s.matchPct), suppliesMonthly: num(s.costsMonthly), commuteMin: num(s.commuteMin) };
  const selfPlan: Plan = { id: 'self', kind: 'self', self: { spacePerWeek: num(s.self.spacePerWeek), suppliesPct: num(s.self.suppliesPct), cardPct: num(s.self.cardPct), otherMonthly: num(s.self.otherMonthly), unpaidWeeks: num(s.self.unpaidWeeks) }, perks: { commuteMin: num(s.commuteMin) } };
  // How they're paid now: from what they were actually paid when they know it, otherwise worked out from the pay plan.
  const derived = planFor(s.payType, s, 'now'); let nowPlan: Plan; let basis: Basis;
  if (s.mode === 'self') { nowPlan = selfPlan; basis = base; }
  else if (s.paid !== null && s.paid > 0) { basis = basisOf(s, num(s.paid) + num(s.bonus) + num(s.tips)); nowPlan = { id: 'now', kind: 'current', perks: nowPerks }; }
  else { basis = base; nowPlan = { ...derived, perks: nowPerks }; }
  const now = planPay(nowPlan, basis);
  const selfCosts = s.mode === 'self' ? r2(-now.lines.filter((l) => l.amount < 0 && l.label !== 'Self-employment tax').reduce((a, l) => a + l.amount, 0)) : 0;
  const gross = s.mode === 'self' ? now.gross : now.gross; const payNoTips = now.payBeforeTips;
  const costs = s.mode === 'self' ? selfCosts : r2(num(s.costsMonthly) * (days / MONTH_DAYS));
  const perHour = hours > 0 ? r2(gross / hours) : null; const perHourNoTips = hours > 0 ? r2(payNoTips / hours) : null;
  const ai = allIn({ gross, grossNoTips: payNoTips, hours, days, costs }, { ptoDays: s.mode === 'self' ? 0 : num(s.ptoDays), healthMonthly: s.mode === 'self' ? 0 : num(s.healthMonthly), matchPct: s.mode === 'self' ? 0 : num(s.matchPct), commuteMin: num(s.commuteMin), daysPerWeek: num(s.daysPerWeek) || 5, offClockMonthly: num(s.offClockMonthly) });
  const afterCosts = hours > 0 && costs ? r2((gross - costs) / hours) : null;

  // Next to similar work (government figures include tips reported on pay).
  const market = s.soc ? wageRange(s.soc) : null;

  // The same work, paid other ways.
  const rows: Row[] = []; const push = (key: string, p: Plan, extra: Partial<Row> = {}) => { const { r, month } = allInMonth(p, basis); rows.push({ key, plan: p, month, perHourAllIn: r.perHourAllIn, ...extra }); };
  if (s.mode !== 'self') push('now', nowPlan, { now: true });
  const typical = market?.median ? Math.round(market.median) : null; const nowRate = perHourNoTips ? Math.round(perHourNoTips) : null;
  const hr = Math.max(num(s.minWage) || 7.25, s.payType === 'hourly' || s.payType === 'tips' ? Math.max((num(s.rate) || 0) + 2, typical || 0) : typical || nowRate || 15);
  if (s.mode === 'self' || s.payType !== 'hourly' || hr !== num(s.rate)) push('hourly', { id: 'hourly', kind: 'hourly', rate: hr, perks: s.mode === 'self' ? { commuteMin: num(s.commuteMin) } : nowPerks });
  const salesKnown = num(s.sales) > 0;
  if (salesKnown) {
    const pct = num(s.pct) || 40; const floor = Math.max(num(s.minWage) || 7.25, 15);
    if (!['greater_of'].includes(s.payType)) push('greater_of', { id: 'greater_of', kind: 'greater_of', rate: floor, pct, retailPct: num(s.retailPct) || 10, perks: s.mode === 'self' ? { commuteMin: num(s.commuteMin) } : nowPerks });
    if (s.mode === 'self') push('commission', { id: 'commission', kind: 'commission', pct, retailPct: num(s.retailPct) || 10, perks: { commuteMin: num(s.commuteMin) } });
    if (s.mode !== 'self') push('self', selfPlan);
  }
  if (s.mode === 'offer') push('offer', { ...planFor(s.offer.payType, s.offer, 'offer'), perks: { ptoDays: num(s.offer.ptoDays), healthMonthly: num(s.offer.healthMonthly), matchPct: num(s.offer.matchPct), suppliesMonthly: num(s.offer.suppliesMonthly), commuteMin: num(s.offer.commuteMin) } }, { offer: true });
  if (s.mode === 'self') rows.unshift({ key: 'now', plan: selfPlan, month: monthly(now.beforeIncomeTax, days), perHourAllIn: now.perHourAllIn, now: true });
  const best = rows.reduce<Row | null>((a, r) => (!a || r.month > a.month ? r : a), null);
  const jobForBreakEven = s.mode === 'self' ? null : s.paid !== null && s.paid > 0 ? derived : nowPlan;
  const breakEven = salesKnown && jobForBreakEven && s.mode !== 'self' && ['commission', 'hourly_commission', 'greater_of', 'draw'].includes(jobForBreakEven.kind) ? breakEvenSales(selfPlan, jobForBreakEven, basis) : null;

  // The offer, side by side, all in; and where the two cross as sales grow.
  let offer: null | { nowMonth: number; offerMonth: number; diff: number; payDiff: number; nowHr: number | null; offerHr: number | null; crossOver: number | null } = null;
  const offerRow = rows.find((r) => r.offer); const nowRow = rows.find((r) => r.now);
  if (offerRow && nowRow) {
    const nowPay = monthly(planPay(nowRow.plan, basis).beforeIncomeTax, days); const offPay = monthly(planPay(offerRow.plan, basis).beforeIncomeTax, days);
    const nowCommish = ['commission', 'hourly_commission', 'greater_of', 'draw'].includes((s.paid !== null && s.paid > 0 ? derived : nowRow.plan).kind);
    let crossOver: number | null = null;
    if (nowCommish && salesKnown) {
      const nowP = { ...(s.paid !== null && s.paid > 0 ? derived : nowRow.plan), perks: nowPerks };
      const at = (x: number) => { const b2 = { ...basis, serviceSales: x, currentGross: 0 }; return allInMonth(nowP, b2).month - allInMonth(offerRow.plan, b2).month; };
      let lo = 0, hi = Math.max(2000, num(s.sales) * 6);
      if (at(lo) < 0 && at(hi) > 0) { for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (at(m) > 0) hi = m; else lo = m; } crossOver = Math.round(((lo + hi) / 2) * (MONTH_DAYS / days) / 50) * 50; }
    }
    offer = { nowMonth: nowRow.month, offerMonth: offerRow.month, diff: r2(offerRow.month - nowRow.month), payDiff: r2(offPay - nowPay), nowHr: nowRow.perHourAllIn, offerHr: offerRow.perHourAllIn, crossOver };
  }

  // Worth asking about.
  const asks: Ask[] = [];
  if (s.mode !== 'self' && hours > 0 && num(s.minWage) > 0 && perHourNoTips !== null) {
    // The plan's own figure, before any top-up payroll would have to add (that top-up is the thing worth asking about).
    const own = r2((payNoTips - now.toppedUp) / hours); const tc = tipCreditFor(s);
    const under = now.toppedUp > 0.005 || (tc ? own < tc.cashWage - 0.005 || (own * hours + num(s.tips)) / hours < num(s.minWage) - 0.005 : own < num(s.minWage) - 0.005);
    if (under) asks.push({ k: 'askMin', v: own });
  }
  if (num(s.offClockMonthly) > 0) asks.push({ k: 'askOffClock', h: Math.round(num(s.offClockMonthly)) });
  if (s.mode !== 'self' && num(s.costsMonthly) > 0) asks.push({ k: 'askCosts', v: num(s.costsMonthly) });
  if (s.mode !== 'self' && num(s.clawback) > 0) asks.push({ k: 'askClawback' });
  if (s.mode !== 'self' && ['commission', 'draw'].includes(s.payType)) asks.push({ k: 'askUnbooked' });

  // A rough take-home.
  const monthBIT = monthly(now.beforeIncomeTax, days);
  const seMonthly = s.mode === 'self' ? monthly(-(now.lines.find((l) => l.label === 'Self-employment tax')?.amount || 0), days) : 0;
  const tax = s.tax.on ? takeHome(monthBIT, { filing: s.tax.filing, statePct: num(s.tax.statePct), selfEmployedSeTaxMonthly: seMonthly, monthlyTaxable: s.mode === 'self' ? monthBIT + seMonthly : monthly(gross, days) }) : null;

  return { hours, days, gross, payNoTips, perHour, perHourNoTips, costs, afterCosts, allIn: ai, market, rows, best, breakEven, offer, asks,
    monthBeforeTax: monthly(gross * (s.mode === 'self' ? 1 : 1), days), monthBIT, tax, notes: now.notes,
    contractor: contractorLean(s.cq), fica: FICA };
}
export type Result = ReturnType<typeof compute>;
