// src/lib/payroll-draft.ts
//
// Server-side payroll draft engine — the same earnings math as the Payday
// tab (commission + retail commission, hourly from activity logs, tips),
// ported to run unattended with firebase-admin.
//
// Level 2 (live now): the daily cron builds a draft on the tenant's pay
// cadence and notifies the owner. Approval in the app ALWAYS recomputes
// from live data — the draft is a preview and a reminder, never the
// numbers that get paid.
//
// Level 3 (built, switched off): runPayrollGates() returns the safeguard
// gates. When tenant.payroll.autoSubmit is true AND every gate passes,
// the cron may submit to Gusto without a tap. Flip it only after months
// of boringly-accurate Level 2 drafts.

import { periodPay, payrollFields } from './pay-period';
import { sessionsFrom, clockPolicy, localDay, weekOf } from './timeclock';
import { getStateProfile, estimateEmployerPayrollTax, GENERIC_US_PROFILE } from './state-tax-profiles';

export type DraftLine = {
  staffId: string;
  gustoEmployeeId?: string;
  name: string;
  payStructure: string;
  regularHours: number;
  overtimeHours?: number;
  doubleOvertimeHours?: number;
  commission: number;      // everything earned from services and sales (commission, per service pay, bonuses) — what payroll pays as commission
  servicePay?: number;     // per service pay (part of commission)
  extras?: number;         // membership sale bonus + share of no-show fees (part of commission)
  bonus?: number;          // overtime on commission / per service pay + minimum-wage top-ups
  overtimePremium?: number; minWageTopUp?: number; salary?: number; hours?: number; missingClockOuts?: number; unapprovedSessions?: number; noHours?: boolean;
  tips: number;
  total: number;
};

export type PayrollGate = { key: string; label: string; passed: boolean; detail?: string };

export type ServerPayrollDraft = {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  lines: DraftLine[];
  grossTotal: number;
  estimatedEmployerTaxes: number;
  cashNeeded: number;
  periodNetIncome: number;
  stateCode: string;
  status: 'pending' | 'approved' | 'submitted' | 'superseded';
  createdAt: string;
};

const toDate = (val: any): Date => {
  if (!val) return new Date(0);
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

/** Compute a payroll draft for one tenant over [periodStart, periodEnd]. */
export async function buildPayrollDraft(
  db: any, tenantId: string, periodStart: Date, periodEnd: Date,
): Promise<ServerPayrollDraft> {
  const [tenantSnap, staffSnap, txnSnap, logsSnap, svcSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.collection(`tenants/${tenantId}/staff`).get(),
    db.collection(`tenants/${tenantId}/transactions`)
      .where('date', '>=', periodStart.toISOString())
      .where('date', '<=', periodEnd.toISOString()).get(),
    // Punches from a day before the period (a shift that started then) to a day after (its clock-out).
    db.collection(`tenants/${tenantId}/activityLogs`)
      .where('timestamp', '>=', new Date(periodStart.getTime() - 86400000).toISOString())
      .where('timestamp', '<=', new Date(periodEnd.getTime() + 86400000).toISOString()).get(),
    db.collection(`tenants/${tenantId}/services`).get(),
  ]);
  const services = svcSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));

  const tenant = (tenantSnap.data() as any) || {};
  // Tip sharing (tip-outs / pool): payroll pays each person's APPROVED share for the periods inside this pay period.
  const sharing = String(tenant.tipSharing?.mode || 'direct'); const approvedTips = new Map<string, number>();
  if (sharing !== 'direct') { const runs = await db.collection(`tenants/${tenantId}/tipShareRuns`).where('status', '==', 'approved').get();
    for (const d of runs.docs) { const r: any = d.data() || {}; if (String(r.start || '') < periodStart.toISOString() || String(r.end || '') > periodEnd.toISOString()) continue;
      for (const x of r.rows || []) approvedTips.set(x.staffId, (approvedTips.get(x.staffId) || 0) + (Number(x.shareCents) || 0) / 100); } }
  // ── A BOOTH RENTER IS NOT ON YOUR PAYROLL ──────────────────────────────
  // Renters share the staff collection because the booking engine needs one
  // provider record per person. That is a storage decision; it must never
  // become an employment one. A 1099 booth renter appearing on a payroll
  // draft is the exact fact pattern that gets a shop reclassified as their
  // employer — so the guard lives HERE, at the source, not in whichever
  // screen happens to render the draft. Their money already went to them;
  // they pay rent for the chair.
  const staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((m: any) => m.isRenter !== true);
  const txns = txnSnap.docs.map((d: any) => d.data() as any)
    .map((t: any) => ({
      ...t,
      amount: typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100,
      type: t.type || 'income',
    }));

  // No-show / late-cancel fees name the visit, not always the provider: look the provider up once.
  const feeAppts = [...new Set(txns.filter((t: any) => !t.staffId && t.appointmentId && ['No-Show Revenue', 'Cancellation Fee', 'Cancellation Fees'].includes(String(t.category))).map((t: any) => String(t.appointmentId)))].slice(0, 500);
  const apptStaff: Record<string, string> = {};
  if (feeAppts.length && (tenant.payExtras?.noShowPct || 0) > 0) for (const s of await Promise.all(feeAppts.map((id) => db.doc(`tenants/${tenantId}/appointments/${id}`).get()))) { const a: any = s?.exists ? s.data() : null; if (a?.staffId) apptStaff[s.id] = String(a.staffId); }
  const allIncome = txns.filter((t: any) => t.type === 'income');
  // ── One calculation for every pay setup (lib/pay-period): hours from the time clock, overtime, minimum wage, salary ──
  const sessions = sessionsFrom(logsSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })), clockPolicy(tenant, periodEnd.getTime()));
  const lines: DraftLine[] = staff.map((member: any) => {
    const mine = txns.filter((t: any) => t.staffId === member.id && t.type === 'income');
    const tips = sharing !== 'direct' ? (approvedTips.get(member.id) || 0) : mine.filter((t: any) => t.category === 'Tips' || t.tipAmount).reduce((s: number, t: any) => s + (t.tipAmount || t.amount), 0);
    const l = periodPay({ member, from: periodStart, to: periodEnd, incomeTxns: txns,   /* all of the period's lines: refunds carry take-backs */ services, tenant, sessions, apptStaff, tips });
    const f = payrollFields(l);
    return {
      staffId: member.id,
      gustoEmployeeId: member.gustoEmployeeId || undefined,
      name: member.name,
      payStructure: l.payStructure,
      hours: l.hours,
      regularHours: f.regularHours,
      overtimeHours: f.overtimeHours,
      ...(f.doubleOvertimeHours ? { doubleOvertimeHours: f.doubleOvertimeHours } : {}),
      commission: f.commission,
      ...(l.servicePay && member.payStructure === 'per_service' ? { servicePay: l.servicePay } : {}),
      ...(l.extras ? { extras: l.extras } : {}),
      ...(f.bonus ? { bonus: f.bonus, overtimePremium: l.overtimePremium, minWageTopUp: l.minWageTopUp } : {}),
      ...(l.salaryPay ? { salary: l.salaryPay } : {}),
      ...(l.missingClockOuts ? { missingClockOuts: l.missingClockOuts } : {}),
      ...(l.unapprovedSessions ? { unapprovedSessions: l.unapprovedSessions } : {}),
      ...(l.noHours ? { noHours: true } : {}),
      tips: l.tips,
      total: l.total,
    };
  }).filter((l: DraftLine) => l.total > 0);

  const grossTotal = Number(lines.reduce((s, l) => s + l.total, 0).toFixed(2));
  // v63 — per-tenant jurisdiction, never assumed: federal-only baseline
  // until the tenant has picked their state.
  const stateCode = tenant.taxState || 'US';
  const profile = tenant.taxState ? getStateProfile(tenant.taxState) : GENERIC_US_PROFILE;
  const estimatedEmployerTaxes = Number(estimateEmployerPayrollTax(grossTotal, profile).toFixed(2));

  const income = txns.filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + t.amount, 0);
  const expenses = txns.filter((t: any) => t.type === 'expense' || t.type === 'payment').reduce((s: number, t: any) => s + t.amount, 0);
  const periodNetIncome = Number(Math.max(0, income - expenses).toFixed(2));

  return {
    tenantId,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    lines,
    grossTotal,
    estimatedEmployerTaxes,
    cashNeeded: Number((grossTotal + estimatedEmployerTaxes).toFixed(2)),
    periodNetIncome,
    stateCode,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

/** Level 3 safeguard gates. All must pass before auto-submit is even
 *  considered — and tenant.payroll.autoSubmit must be true besides. */
export function runPayrollGates(draft: ServerPayrollDraft): { gates: PayrollGate[]; allPassed: boolean } {
  const gates: PayrollGate[] = [
    {
      key: 'has_employees',
      label: 'At least one employee with earnings',
      passed: draft.lines.length > 0,
      detail: `${draft.lines.length} employee(s)`,
    },
    {
      key: 'all_matched',
      label: 'Every employee matched to a Gusto ID',
      passed: draft.lines.length > 0 && draft.lines.every(l => !!l.gustoEmployeeId),
      detail: draft.lines.filter(l => !l.gustoEmployeeId).map(l => l.name).join(', ') || 'all matched',
    },
    {
      key: 'clock_outs',
      label: 'No forgotten clock-outs waiting for a manager',
      passed: draft.lines.every(l => !l.missingClockOuts),
      detail: draft.lines.filter(l => l.missingClockOuts).map(l => `${l.name} (${l.missingClockOuts})`).join(', ') || 'none',
    },
    {
      key: 'reserve_funded',
      label: 'Period income covers wages + employer taxes',
      passed: draft.periodNetIncome >= draft.cashNeeded,
      detail: `income $${draft.periodNetIncome.toFixed(2)} vs needed $${draft.cashNeeded.toFixed(2)}`,
    },
  ];
  return { gates, allPassed: gates.every(g => g.passed) };
}

/**
 * The pay period that just ended, lined up with whole workweeks (so overtime is counted per complete week): it ends at
 * the start of the current workweek in the business's time zone and runs back one or two weeks. Monthly: the last 30 days.
 */
export function lastPeriod(tenant: any, cadence: string, now = new Date()): { start: Date; end: Date } {
  const days = CADENCE_DAYS[cadence] || 14;
  if (cadence === 'monthly') return { start: new Date(now.getTime() - days * 86400000), end: now };
  const tz = tenant?.timezone || 'America/New_York'; const ws = Number.isInteger(tenant?.workweekStartsOn) ? tenant.workweekStartsOn : 1;
  const thisWeek = weekOf(localDay(now.getTime(), tz), ws);
  // midnight at the start of this workweek, in the business's time zone
  const guess = Date.parse(`${thisWeek}T00:00:00Z`); const off = tzOffsetMs(tz, guess); const end = new Date(guess - off - 1);
  return { start: new Date(end.getTime() + 1 - days * 86400000), end };
}
function tzOffsetMs(timeZone: string, t: number): number {
  try { const p = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value); const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')); return asUtc - t; }
  catch { return 0; }
}

export const CADENCE_DAYS: Record<string, number> = {
  'weekly': 7,
  'bi-weekly': 14,
  'monthly': 30,
};
