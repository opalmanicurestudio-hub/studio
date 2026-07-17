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

import { getStateProfile, estimateEmployerPayrollTax, DEFAULT_STATE_CODE } from './state-tax-profiles';

export type DraftLine = {
  staffId: string;
  gustoEmployeeId?: string;
  name: string;
  payStructure: string;
  regularHours: number;
  commission: number;
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
  const [tenantSnap, staffSnap, txnSnap, logsSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.collection(`tenants/${tenantId}/staff`).get(),
    db.collection(`tenants/${tenantId}/transactions`)
      .where('date', '>=', periodStart.toISOString())
      .where('date', '<=', periodEnd.toISOString()).get(),
    db.collection(`tenants/${tenantId}/activityLogs`).get(),
  ]);

  const tenant = (tenantSnap.data() as any) || {};
  const staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const txns = txnSnap.docs.map((d: any) => d.data() as any)
    .map((t: any) => ({
      ...t,
      amount: typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100,
      type: t.type || 'income',
    }));
  const logs = logsSnap.docs.map((d: any) => d.data() as any)
    .filter((l: any) => {
      const ts = toDate(l.timestamp);
      return ts >= periodStart && ts <= periodEnd;
    });

  // ── Same per-staff math as the Payday tab ──
  const lines: DraftLine[] = staff.map((member: any) => {
    const mine = txns.filter((t: any) => t.staffId === member.id && t.type === 'income');
    const serviceRevenue = mine.filter((t: any) => t.category === 'Service Revenue').reduce((s: number, t: any) => s + t.amount, 0);
    const retailSales = mine.filter((t: any) => t.category === 'Retail').reduce((s: number, t: any) => s + t.amount, 0);
    const tips = mine.filter((t: any) => t.category === 'Tips' || t.tipAmount).reduce((s: number, t: any) => s + (t.tipAmount || t.amount), 0);

    let commission = 0, regularHours = 0;
    if (member.payStructure === 'commission') {
      commission = (serviceRevenue * ((member.commissionRate || 40) / 100)) +
                   (member.retailCommissionRate ? (retailSales * (member.retailCommissionRate / 100)) : 0);
    } else if (member.payStructure === 'hourly' && member.hourlyRate) {
      const minutes = logs.filter((l: any) => l.staffId === member.id)
        .reduce((s: number, l: any) => s + (l.durationMinutes || 0), 0);
      regularHours = minutes / 60;
      commission = 0;
    }
    const hourlyPay = member.payStructure === 'hourly' && member.hourlyRate ? regularHours * member.hourlyRate : 0;
    const total = commission + hourlyPay + tips;

    return {
      staffId: member.id,
      gustoEmployeeId: member.gustoEmployeeId || undefined,
      name: member.name,
      payStructure: member.payStructure || 'commission',
      regularHours: Number(regularHours.toFixed(2)),
      commission: Number(commission.toFixed(2)),
      tips: Number(tips.toFixed(2)),
      total: Number(total.toFixed(2)),
    };
  }).filter((l: DraftLine) => l.total > 0);

  const grossTotal = Number(lines.reduce((s, l) => s + l.total, 0).toFixed(2));
  const stateCode = tenant.taxState || DEFAULT_STATE_CODE;
  const profile = getStateProfile(stateCode);
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
      key: 'reserve_funded',
      label: 'Period income covers wages + employer taxes',
      passed: draft.periodNetIncome >= draft.cashNeeded,
      detail: `income $${draft.periodNetIncome.toFixed(2)} vs needed $${draft.cashNeeded.toFixed(2)}`,
    },
  ];
  return { gates, allPassed: gates.every(g => g.passed) };
}

export const CADENCE_DAYS: Record<string, number> = {
  'weekly': 7,
  'bi-weekly': 14,
  'monthly': 30,
};
