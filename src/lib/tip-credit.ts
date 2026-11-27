// src/lib/tip-credit.ts — THE TIP CREDIT, AN ESTIMATE (IRS Form 8846; 26 U.S.C. §45B), for the Write-offs tab
// (api/writeoffs, lib/write-offs). An employer pays its share of Social Security and Medicare (7.65%) on the tips its
// employees report, and gets that back as a credit off the tax itself, on the tips above what tops each person's pay up
// to the federal minimum wage for the month:
//   - Food and drink, where tipping is customary: the minimum wage as of January 1, 2007 ($5.15 an hour).
//   - Barbering and hair care, nail care, esthetics, and body and spa treatments, where tipping is customary (added for
//     tax years beginning after December 31, 2024): the federal minimum wage ($7.25 an hour).
//   - Tips over the year's Social Security wage base count for Medicare only (1.45%).
//   - The same amount can't also be deducted as payroll tax (§45B(c)), so the accountant takes it off that deduction.
// Worked out from the paydays recorded in ClarityFlow (tenants/{t}/payrollRuns, kind 'payday'): each person's tips,
// their pay without tips, and their hours (kept on paydays recorded from now on; a payday without them counts every
// tip, so the estimate is then the most it could be). Contractors and renters aren't employees, so never count.
import { nicheOf, type Niche } from './niche';
import { tablesFor } from './withholding';

export const TIP_CREDIT_RATE = 0.0765;
export const MEDICARE_RATE = 0.0145;
export const FOOD_MIN_WAGE = 5.15;
export const BEAUTY_MIN_WAGE = 7.25;
/** The first tax year beauty services count. */
export const BEAUTY_FROM_YEAR = 2025;

export type TipCreditKind = 'beauty' | 'food';
const BEAUTY: Niche[] = ['nails', 'hair', 'lash', 'barber', 'beauty', 'spa', 'medspa'];

/** Which kind of tips the business's count as (by its kind of business: lib/niche), or null when neither fits. A
 *  business the app can't place ('general') is left to its accountant. */
export function tipCreditKind(tenant: any): TipCreditKind | null {
  const n = nicheOf(tenant);
  if (n === 'hospitality') return 'food';
  return BEAUTY.includes(n) ? 'beauty' : null;
}

export type TipCredit = {
  kind: TipCreditKind; year: number; minWage: number;
  /** Tips the employees reported in the year, and the part above what tops their pay up to the minimum wage. */
  tipsCents: number; creditableCents: number;
  /** The estimate, and how many employees and paydays it's from. */
  creditCents: number; people: number; paydays: number;
  /** Paydays recorded before hours were kept: every tip counted, so it's the most it could be. */
  noHours: number;
  /** Tips in pay from before ClarityFlow this year (lib/payroll-prior): not in the estimate, as it has no months. */
  priorTips: boolean;
};

type PersonMonth = { tips: number; wages: number; hours: number; hoursKnown: boolean };
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** The year's estimate from its paydays (`runs`: payroll runs of any year; only `year`'s paydays are used). Null when
 *  the business's tips don't count, or for beauty services before 2025. */
export function tipCreditEstimate(runs: any[], year: number, kind: TipCreditKind | null): TipCredit | null {
  if (!kind || (kind === 'beauty' && year < BEAUTY_FROM_YEAR)) return null;
  const minWage = kind === 'food' ? FOOD_MIN_WAGE : BEAUTY_MIN_WAGE;
  const base = tablesFor(year).t.ss.base;
  const mine = runs.filter((r) => r?.kind === 'payday' && String(r?.payDate || r?.to || '').slice(0, 4) === String(year))
    .sort((a, b) => String(a.payDate || a.to).localeCompare(String(b.payDate || b.to)));
  // (By person and by month: the minimum wage test is a month's pay against a month's hours.)
  const months = new Map<string, Map<string, PersonMonth>>(); const people = new Set<string>(); let noHours = 0;
  for (const r of mine) {
    const month = String(r.payDate || r.to).slice(0, 7); let runNoHours = false;
    for (const p of Array.isArray(r.people) ? r.people : []) {
      if (p?.contractor) continue;
      const tips = Math.max(0, num(p?.tips)); const gross = num(p?.taxes?.gross) || Math.max(0, num(p?.paid) + num(p?.cashTips));
      const id = String(p?.staffId || ''); if (!id) continue;
      if (tips > 0) people.add(id);
      const hoursKnown = typeof p?.hours === 'number' && Number.isFinite(p.hours); if (tips > 0 && !hoursKnown) runNoHours = true;
      const m = months.get(month) || new Map<string, PersonMonth>(); months.set(month, m);
      const x = m.get(id) || { tips: 0, wages: 0, hours: 0, hoursKnown: true };
      x.tips += tips; x.wages += Math.max(0, gross - tips); x.hours += hoursKnown ? Math.max(0, num(p.hours)) : 0; x.hoursKnown = x.hoursKnown && hoursKnown;
      m.set(id, x);
    }
    if (runNoHours) noHours++;
  }
  // (Month by month, each person's Social Security wages so far, from pay before ClarityFlow this year too: tips past the
  // year's wage base count for Medicare only.)
  const ytd = new Map<string, number>(); let tipsCents = 0, creditableCents = 0, credit = 0, priorTips = false;
  for (const r of runs.filter((x) => x?.kind === 'prior' && Number(x?.year) === year && Array.isArray(x?.people))) {
    for (const p of r.people) { const id = String(p?.staffId || ''); if (!id) continue; ytd.set(id, (ytd.get(id) || 0) + Math.max(0, num(p?.wages))); if (num(p?.tips) > 0) priorTips = true; }
  }
  for (const month of [...months.keys()].sort()) {
    for (const [id, x] of months.get(month)!) {
      const short = x.hoursKnown ? Math.max(0, x.hours * minWage - x.wages) : 0;
      const creditable = Math.max(0, x.tips - short);
      const before = ytd.get(id) || 0; const room = Math.max(0, base - before - x.wages);
      const ss = Math.min(creditable, room);
      credit += ss * TIP_CREDIT_RATE + (creditable - ss) * MEDICARE_RATE;
      ytd.set(id, before + x.wages + x.tips);
      tipsCents += Math.round(x.tips * 100); creditableCents += Math.round(creditable * 100);
    }
  }
  return { kind, year, minWage, tipsCents, creditableCents, creditCents: Math.round(credit * 100), people: people.size, paydays: mine.length, noHours, priorTips };
}
