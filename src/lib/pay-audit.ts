// src/lib/pay-audit.ts — THE STUB, LINE BY LINE. Every visit, retail sale, tip, shift and adjustment behind a pay
// statement, each with how it was worked out, and a check that the lines add up to the total. Each line carries a
// stable `ref` so a team member can point at it ("Something's off") and a manager can open its source.
// Pure — the server loads the records (lib/pay-stub) and the tests feed it directly.
import { serviceCommission, perServicePay, earnsCommission, paidPerService, isServiceIncome } from '@/lib/commission';
import type { Statement } from '@/lib/pay-statement';

export type AuditLine = { ref: string; kind: 'visit' | 'retail' | 'tip' | 'shift' | 'period' | 'adjustment'; date?: string; title: string; detail: string; amount: number; source?: { appointmentId?: string; txnId?: string; punchId?: string; adjustmentId?: string } };
export type Audit = { visits: AuditLine[]; retail: AuditLine[]; tips: AuditLine[]; shifts: AuditLine[]; period: AuditLine[]; adjustments: AuditLine[];
  check: { lines: number; linesTotal: number; total: number; ok: boolean; rounding: number }; byDay: Record<string, number> };

const r2 = (v: number) => Math.round((v || 0) * 100) / 100;
const money = (v: number) => `${v < 0 ? '– ' : ''}$${Math.abs(r2(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amt = (t: any) => (typeof t?.amount === 'number' ? t.amount : (Number(t?.amountCents) || 0) / 100);
/** "Kim T." — a client's first name and last initial, never more on a stub. */
export const shortName = (n: any) => { const p = String(n || '').trim().split(/\s+/).filter(Boolean); return p.length ? `${p[0]}${p[1] ? ` ${p[1][0]}.` : ''}` : 'Client'; };
const dayOf = (iso: any, tz: string) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-CA', { timeZone: tz }) : ''; };
const hm = (iso: any, tz: string) => new Date(String(iso)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
const hrs = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} m`;

export function auditOf(input: { st: Statement; member: any; tenant: any; income: any[]; services: any[]; sessions: any[]; tipRuns?: { id: string; start: string; end: string; share: number }[]; adjustments?: any[] }): Audit {
  const { st, member: m, tenant } = input; const tz = tenant?.timezone || 'America/New_York';
  const byId = Object.fromEntries((input.services || []).map((s: any) => [s.id, s]));
  const mine = (input.income || []).filter((t) => t.staffId === m.id || t.splitWith?.staffId === m.id);
  const visits: AuditLine[] = []; const retail: AuditLine[] = []; const tips: AuditLine[] = []; const shifts: AuditLine[] = []; const period: AuditLine[] = []; const adjustments: AuditLine[] = [];

  for (const t of mine) {
    if (!isServiceIncome(t)) continue;
    const svc = t.serviceId ? byId[t.serviceId] : null; const name = String(t.description || svc?.name || 'Service').replace(/^(Service|Add-on|Redemption):\s*/, '');
    const assisting = t.splitWith?.staffId === m.id && t.staffId !== m.id;
    let earned = 0, how = '';
    if (paidPerService(m)) { earned = perServicePay(m, [t], input.services).total; how = 'set pay for this service'; }
    else if (earnsCommission(m)) { const c = serviceCommission(m, [t], input.services, 40); earned = c.total; const l = c.lines[0];
      const pc = Number(t.productCharge) || 0; const base = l?.base ?? amt(t);
      how = `${money(amt(t))}${t.commissionBase != null && Number(t.commissionBase) !== amt(t) ? ` (counted at ${money(Number(t.commissionBase))})` : ''}${pc ? ` − ${money(pc)} product` : ''}${assisting ? ' · your share assisting' : ''} × ${l?.rate ?? '—'}% of ${money(base)}`; }
    else how = 'paid by the hour — services aren’t paid separately';
    visits.push({ ref: `v:${t.id || t.appointmentId}`, kind: 'visit', date: dayOf(t.date, tz), title: `${shortName(t.clientOrVendor)} · ${name}`, detail: how, amount: r2(earned), source: { appointmentId: t.appointmentId || undefined, txnId: t.id } });
  }
  if ((earnsCommission(m) || paidPerService(m)) && Number(m.retailCommissionRate) > 0) for (const t of mine.filter((x) => (x.type || 'income') === 'income' && x.category === 'Retail' && x.staffId === m.id)) {
    retail.push({ ref: `r:${t.id}`, kind: 'retail', date: dayOf(t.date, tz), title: String(t.description || 'Retail sale').replace(/^Retail:\s*/, ''), detail: `${money(amt(t))} × ${m.retailCommissionRate}%`, amount: r2(amt(t) * Number(m.retailCommissionRate) / 100), source: { txnId: t.id, appointmentId: t.appointmentId || undefined } });
  }
  if (input.tipRuns) for (const r of input.tipRuns) tips.push({ ref: `tr:${r.id}`, kind: 'tip', date: r.end, title: 'Tip share', detail: `your share of tips ${r.start} – ${r.end}`, amount: r2(r.share) });
  else for (const t of mine.filter((x) => (x.type || 'income') === 'income' && x.staffId === m.id && (x.category === 'Tips' || x.tipAmount))) {
    tips.push({ ref: `t:${t.id}`, kind: 'tip', date: dayOf(t.date, tz), title: `Tip · ${shortName(t.clientOrVendor)}`, detail: t.paymentMethod ? `paid by ${t.paymentMethod}` : 'tip', amount: r2(t.tipAmount || amt(t)), source: { txnId: t.id, appointmentId: t.appointmentId || undefined } });
  }
  const hourly = Number(m.hourlyRate) || 0;
  for (const s of input.sessions || []) {
    const status = s.missingOut ? 'no clock-out — not counted yet' : s.status === 'rejected' ? 'not approved' : s.status === 'pending' ? 'waiting for approval' : s.status === 'active' ? 'still clocked in' : 'approved';
    shifts.push({ ref: `s:${s.inId || s.inAt}`, kind: 'shift', date: s.localDate, title: `${hm(s.inAt, tz)} – ${s.outAt ? hm(s.outAt, tz) : '…'}`, detail: `${hrs(s.workedMinutes)} paid${s.unpaidBreakMinutes ? ` · ${s.unpaidBreakMinutes} min unpaid break` : ''} · ${status}`, amount: 0, source: { punchId: s.inId } });
  }
  const l = st.line as any;
  const P = (key: string, title: string, detail: string, v: number) => { if (v) period.push({ ref: `p:${key}`, kind: 'period', title, detail, amount: r2(v) }); };
  P('hourly', 'Hourly pay', `${Math.round(l.regularHours * 10) / 10} h at ${money(hourly)}${l.overtimeHours ? ` + ${Math.round(l.overtimeHours * 10) / 10} h overtime` : ''} — from the shifts below`, l.hourlyPay);
  P('training', 'Training, meetings and other paid time', `${l.nonServiceHours} h`, l.nonServicePay);
  P('salary', 'Salary', 'this period’s share', l.salaryPay);
  P('tier', 'Sales tier bonus', 'a higher rate on services above your level this period', l.tierBonus);
  P('refunds', 'Refunds', `commission taken back on ${l.refunds} refunded service${l.refunds === 1 ? '' : 's'}`, -l.refundTakeBack);
  P('ot', 'Overtime on commission / per service pay', 'hours over the weekly limit', l.overtimePremium);
  P('minwage', 'Minimum-wage top-up', (l.weeks || []).filter((w: any) => w.topUp > 0).map((w: any) => `week of ${w.weekStart}: ${money(w.topUp)}`).join(' · ') || 'to reach minimum wage', l.minWageTopUp);
  P('extras', 'Extras', 'membership / package sales and no-show fee share', l.extras);
  for (const a of input.adjustments || []) adjustments.push({ ref: `a:${a.id}`, kind: 'adjustment', date: String(a.date || '').slice(0, 10), title: String(a.reason || 'Adjustment'), detail: `approved by ${a.byName || 'a manager'}`, amount: r2((Number(a.amountCents) || 0) / 100), source: { adjustmentId: a.id } });

  const all = [...visits, ...retail, ...tips, ...period, ...adjustments];
  const linesTotal = r2(all.reduce((s, x) => s + x.amount, 0)); const total = r2(st.total + adjustments.reduce((s, x) => s + x.amount, 0));
  const rounding = r2(total - linesTotal);
  const byDay: Record<string, number> = {};
  for (const x of [...visits, ...retail, ...tips]) if (x.date) byDay[x.date] = r2((byDay[x.date] || 0) + x.amount);
  const sort = (a: AuditLine[]) => a.sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
  return { visits: sort(visits), retail: sort(retail), tips: sort(tips), shifts: sort(shifts), period, adjustments: sort(adjustments),
    check: { lines: all.length + shifts.length, linesTotal, total, ok: Math.abs(rounding) <= Math.max(0.05, 0.01 * all.length), rounding }, byDay };
}
