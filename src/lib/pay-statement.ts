// src/lib/pay-statement.ts — A PERSON'S PAY STATEMENT for a period: every line that adds up to their pay, in plain words,
// so nobody has to ask how it was worked out. The same numbers as Payday and the payroll draft (lib/pay-period).
//
//   Services     "Gel manicure · 12 × · $540 · 40% → $216" (commission) or "Massage 60 · 9 × → $270" (per service)
//   Hours        "38.5 h on the clock · 2.5 h overtime" and the hourly pay
//   Salary       the period's share
//   Overtime     the overtime owed on commission / per service pay
//   Minimum wage the top-up, week by week
//   Extras       membership / package sales, share of no-show fees
//   Tips         their tips (or their approved share when tips are shared)
// Not a payslip: taxes and deductions are the payroll service's.
import { periodPay, type PayLine } from '@/lib/pay-period';
import { serviceCommission, perServicePay, earnsCommission, paidPerService, payExtras } from '@/lib/commission';
import { sessionsFrom, clockPolicy } from '@/lib/timeclock';

export type StatementLine = { label: string; detail?: string; amount: number };
export type Statement = { staffId: string; name: string; from: string; to: string; payStructure: string; sections: { title: string; lines: StatementLine[] }[]; total: number; tips: number; notes: string[]; line: PayLine };

const money = (v: number) => `$${(Math.round(v * 100) / 100).toFixed(2)}`;
const hrs = (h: number) => `${Math.round(h * 10) / 10} h`;

/** Build a statement from data already loaded (the server route and the tests both use this). */
export function buildStatement(input: { member: any; from: string; to: string; incomeTxns: any[]; services: any[]; tenant: any; punches: any[]; apptStaff?: Record<string, string>; tips?: number; shifts?: any[] }): Statement {
  const { member: m, tenant } = input;
  const sessions = sessionsFrom(input.punches || [], clockPolicy(tenant, Date.parse(input.to)));
  const l = periodPay({ member: m, from: input.from, to: input.to, incomeTxns: input.incomeTxns, services: input.services, tenant, sessions, apptStaff: input.apptStaff, shifts: input.shifts, ...(input.tips != null ? { tips: input.tips } : {}) });
  const mine = (input.incomeTxns || []).filter((t) => t.staffId === m.id || t.splitWith?.staffId === m.id);
  const sections: Statement['sections'] = []; const notes: string[] = [];

  if (earnsCommission(m)) {
    const c = serviceCommission(m, mine, input.services, 40);
    if (c.lines.length) sections.push({ title: 'Services', lines: c.lines.map((x) => ({ label: x.name, detail: `${x.count || 0} × · ${money(x.base ?? x.revenue)} at ${x.rate}%${x.covered ? ` (${x.covered} membership or package visit${x.covered === 1 ? '' : 's'} at the normal price)` : ''}`, amount: x.commission })) });
  }
  if (paidPerService(m)) {
    const p = perServicePay(m, mine, input.services);
    if (p.lines.length) sections.push({ title: 'Services', lines: p.lines.map((x) => ({ label: x.name, detail: `${x.count} ×`, amount: x.pay })) });
  }
  const adj: StatementLine[] = [];
  if (l.tierBonus) adj.push({ label: 'Sales tier bonus', detail: 'a higher rate on services above your level this period', amount: l.tierBonus });
  if (l.refundTakeBack) adj.push({ label: 'Refunds', detail: `commission taken back on ${l.refunds} refunded service${l.refunds === 1 ? '' : 's'}`, amount: -l.refundTakeBack });
  if (adj.length) sections.push({ title: 'Adjustments', lines: adj });
  if (l.retail) sections.push({ title: 'Retail', lines: [{ label: 'Retail commission', detail: `${m.retailCommissionRate}% of retail sales`, amount: l.retail }] });
  const hourLines: StatementLine[] = [];
  if (l.hourlyPay) hourLines.push({ label: 'Hourly pay', detail: `${hrs(l.regularHours)} at ${money(Number(m.hourlyRate) || 0)}${l.overtimeHours ? ` + ${hrs(l.overtimeHours)} overtime` : ''}${l.doubleTimeHours ? ` + ${hrs(l.doubleTimeHours)} double time` : ''}`, amount: l.hourlyPay });
  if (l.nonServicePay) hourLines.push({ label: 'Training, meetings and other paid time', detail: `${hrs(l.nonServiceHours)} at ${money(l.nonServicePay / (l.nonServiceHours || 1))}`, amount: l.nonServicePay });
  if (l.salaryPay) hourLines.push({ label: 'Salary', detail: 'This period’s share', amount: l.salaryPay });
  if (l.overtimePremium) hourLines.push({ label: 'Overtime on commission / per service pay', detail: `${hrs(l.overtimeHours + l.doubleTimeHours)} over the weekly limit`, amount: l.overtimePremium });
  if (l.minWageTopUp) hourLines.push({ label: 'Minimum-wage top-up', detail: l.weeks.filter((w) => w.topUp > 0).map((w) => `week of ${w.weekStart}: ${money(w.topUp)}`).join(' · '), amount: l.minWageTopUp });
  if (hourLines.length) sections.push({ title: 'Time', lines: hourLines });
  const ex = payExtras(m, input.incomeTxns || [], tenant, input.apptStaff || {});
  const exLines: StatementLine[] = [];
  if (ex.saleBonus) exLines.push({ label: 'Membership and package sales', detail: `${ex.sales} sold`, amount: ex.saleBonus });
  if (ex.noShow) exLines.push({ label: 'Share of no-show and late-cancellation fees', amount: ex.noShow });
  if (exLines.length) sections.push({ title: 'Extras', lines: exLines });
  if (l.tips) sections.push({ title: 'Tips', lines: [{ label: 'Tips', amount: l.tips }] });

  if (l.hours) notes.push(`${hrs(l.hours)} on the clock${l.overtimeHours ? `, ${hrs(l.overtimeHours)} of it overtime` : ''}.`);
  if (l.missingClockOuts) notes.push(`${l.missingClockOuts} shift${l.missingClockOuts === 1 ? '' : 's'} with no clock-out — not counted until a manager adds the time.`);
  if (l.unapprovedSessions) notes.push(`${l.unapprovedSessions} shift${l.unapprovedSessions === 1 ? '' : 's'} waiting for a manager’s approval.`);
  if (l.noHours) notes.push('No hours on the clock this period — clock in each shift so minimum wage and overtime can be checked.');
  notes.push('Before taxes and deductions — your payroll service takes those out.');
  return { staffId: m.id, name: m.name || 'Team member', from: input.from, to: input.to, payStructure: l.payStructure, sections, total: l.total, tips: l.tips, notes, line: l };
}

/** Load everything for one person and period from Firestore (admin) and build the statement. */
export async function statementFor(db: any, tenantId: string, staffId: string, from: string, to: string): Promise<Statement | null> {
  const T = `tenants/${tenantId}`;
  const [tSnap, mSnap, svcSnap, txSnap, pSnap] = await Promise.all([
    db.doc(T).get(), db.doc(`${T}/staff/${staffId}`).get(), db.collection(`${T}/services`).get(),
    db.collection(`${T}/transactions`).where('date', '>=', from).where('date', '<=', to).get(),
    db.collection(`${T}/activityLogs`).where('timestamp', '>=', new Date(Date.parse(from) - 86400000).toISOString()).where('timestamp', '<=', new Date(Date.parse(to) + 86400000).toISOString()).get(),
  ]);
  if (!mSnap.exists) return null;
  const tenant: any = tSnap.data() || {}; const member = { id: staffId, ...(mSnap.data() || {}) };
  const income = txSnap.docs.map((d: any) => d.data() || {}).map((t: any) => ({ ...t, amount: typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100, type: t.type || 'income' }));   // refunds included: they carry take-backs
  const punches = pSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((p: any) => p.staffId === staffId);
  // Shared tips: their approved share for runs inside the period.
  let tips: number | undefined;
  if (String(tenant.tipSharing?.mode || 'direct') !== 'direct') { tips = 0;
    for (const d of (await db.collection(`${T}/tipShareRuns`).where('status', '==', 'approved').get()).docs) { const r: any = d.data() || {}; if (String(r.start || '') < from || String(r.end || '') > to) continue; for (const x of r.rows || []) if (x.staffId === staffId) tips += (Number(x.shareCents) || 0) / 100; } }
  // Fees that name only the visit: whose visit it was.
  const apptStaff: Record<string, string> = {};
  if (Number(tenant.payExtras?.noShowPct) > 0) for (const t of income) if (!t.staffId && t.appointmentId && ['No-Show Revenue', 'Cancellation Fee', 'Cancellation Fees'].includes(String(t.category))) { const a: any = (await db.doc(`${T}/appointments/${t.appointmentId}`).get()).data(); if (a?.staffId) apptStaff[t.appointmentId] = String(a.staffId); }
  const shifts = (await db.collection(`${T}/shifts`).where('staffId', '==', staffId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  return buildStatement({ member, from, to, incomeTxns: income, shifts, services: svcSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })), tenant, punches, apptStaff, tips });
}

