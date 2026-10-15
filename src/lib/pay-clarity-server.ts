// src/lib/pay-clarity-server.ts — the server half of lib/pay-clarity. Builds pay periods from the same pay stubs people
// already see (lib/pay-stub), adds booked and scheduled hours, and keeps each person's PRIVATE notes — their goal, their
// own costs and the plans or offers they compare — in privatePay/{key}, outside the business's records: only the
// person can read or change them (the API checks it's them), never a manager or owner. The key is a one-way hash, so the
// document doesn't even name the business or the person.
import { createHash } from 'crypto';
import { clarity, minWageWeeks, planOfRecord, planPay, planLabel, cleanPlan, daysIn, type Period, type Plan, type Cost } from '@/lib/pay-clarity';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const OFF = ['cancelled', 'canceled', 'no_show', 'declined', 'expired', 'pending', 'deposit_pending'];
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const minutesOf = (a: any) => { const d = Number(a.duration || a.durationMinutes); if (d > 0) return d; const s = Date.parse(a.startTime), e = Date.parse(a.endTime); return s && e && e > s ? (e - s) / 60000 : 0; };
const hm = (s: string) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export const RANGES: Record<string, number> = { '4w': 28, '3m': 91, '1y': 365 };
/** The pay periods covering about `days` back, newest first, the current one included (marked "so far"). */
export async function periodsFor(db: any, t: string, staffId: string, days: number): Promise<Period[]> {
  const { recentPeriods, periodRange } = await import('@/lib/pay-periods'); const { stubFor } = await import('@/lib/pay-stub');
  const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {};
  const all = recentPeriods(tenant, 60); const pick: any[] = []; let covered = 0;
  for (const p of all) { pick.push(p); covered += daysIn(p.from, p.to); if (covered >= days) break; }
  const [appts, shifts] = await Promise.all([rows(await db.collection(`tenants/${t}/appointments`).where('staffId', '==', staffId).get()), rows(await db.collection(`tenants/${t}/shifts`).where('staffId', '==', staffId).get())]);
  const today = new Date().toISOString().slice(0, 10); const out: Period[] = [];
  for (const p of pick) {
    const st: any = await stubFor(db, t, staffId, p).catch(() => null); if (!st) continue;
    const { fromIso, toIso } = periodRange(tenant, p);
    const booked = appts.filter((a: any) => !OFF.includes(String(a.status || '')) && String(a.startTime || '') >= fromIso && String(a.startTime || '') <= toIso && Date.parse(a.startTime) <= Date.now()).reduce((s: number, a: any) => s + minutesOf(a), 0) / 60;
    const sched = shifts.filter((x: any) => x.date >= p.from && x.date <= p.to && ['published', undefined, null, ''].includes(x.status) && (!x.kind || x.kind === 'work')).reduce((s: number, x: any) => s + Math.max(0, hm(x.endTime) - hm(x.startTime) - (Number(x.breakMinutes) || 0)), 0) / 60;
    const sales = st.stats?.sales ?? (st.stats?.avgVisit ? st.stats.avgVisit * st.visits : 0); const retail = st.stats?.retailSales ?? (st.stats?.retailPerVisit ? st.stats.retailPerVisit * st.visits : 0);
    const topUp = (st.audit?.period || []).filter((x: any) => x.ref === 'p:minwage').reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0);
    out.push({ from: p.from, to: p.to, current: p.from <= today && today <= p.to, total: r2(st.total), tips: r2(st.parts?.tips), hours: r2(st.hours), overtimeHours: r2(st.overtimeHours), parts: st.parts,
      visits: st.visits || 0, serviceSales: r2(sales), retailSales: r2(retail), bookedHours: r2(booked), scheduledHours: r2(sched), topUp: r2(topUp), weeks: st.weeks || undefined });
  }
  return out;
}

// ── Private to the person ──────────────────────────────────────────────────────────────────────────────────────────
export const privateKey = (t: string, staffId: string) => createHash('sha256').update(`${process.env.PRIVATE_PAY_SECRET || process.env.CRON_SECRET || 'pay'}|${t}|${staffId}`).digest('hex');
export type Private = { goalMonthly: number | null; costs: Cost[]; plans: Plan[]; updatedAt: string | null };
export async function readPrivate(db: any, t: string, staffId: string): Promise<Private> {
  const d: any = (await db.doc(`privatePay/${privateKey(t, staffId)}`).get()).data() || {};
  return { goalMonthly: Number(d.goalMonthly) > 0 ? Number(d.goalMonthly) : null, costs: Array.isArray(d.costs) ? d.costs : [], plans: Array.isArray(d.plans) ? d.plans : [], updatedAt: d.updatedAt || null };
}
export async function savePrivate(db: any, t: string, staffId: string, raw: any): Promise<Private> {
  const g = Number(raw?.goalMonthly); const costs: Cost[] = (Array.isArray(raw?.costs) ? raw.costs : []).slice(0, 30).map((c: any) => ({ id: String(c?.id || Math.random().toString(36).slice(2, 9)).slice(0, 30), label: String(c?.label || '').trim().slice(0, 60) || 'A cost', amount: Math.max(0, Math.min(100000, Number(c?.amount) || 0)), per: (c?.per === 'once' ? 'once' : 'month') as Cost['per'] })).filter((c: Cost) => c.amount > 0);
  const plans = (Array.isArray(raw?.plans) ? raw.plans : []).slice(0, 8).map(cleanPlan).filter(Boolean) as Plan[];
  const next: Private = { goalMonthly: g > 0 && g < 10000000 ? Math.round(g) : null, costs, plans, updatedAt: new Date().toISOString() };
  await db.doc(`privatePay/${privateKey(t, staffId)}`).set(next); return next;
}

const DEFAULT_PLANS = (now: Plan): Plan[] => {
  const out: Plan[] = [];
  if (now.kind !== 'hourly') out.push({ id: 'h', kind: 'hourly', rate: 20 });
  if (now.kind === 'commission' || now.kind === 'tiered') out.push({ id: 'hc', kind: 'hourly_commission', rate: 15, pct: 10, retailPct: now.retailPct || 0 }, { id: 'g', kind: 'greater_of', rate: 16, pct: now.pct || 40, retailPct: now.retailPct || 0 });
  out.push({ id: 'self', kind: 'self', self: { spacePerWeek: 250, suppliesPct: 8, cardPct: 2.9 } });
  return out;
};
/** Everything for one person's "What my time is worth". */
export async function myClarity(db: any, t: string, staffId: string, range: string) {
  const days = RANGES[range] || 28; const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {};
  const { staffWithPay } = await import('@/lib/staff-pay-server'); const m: any = (await staffWithPay(db, t, staffId)) || {};
  const { payRules } = await import('@/lib/pay-period'); const minimumWage = payRules(tenant).minimumWage;
  const periods = await periodsFor(db, t, staffId, days); const priv = await readPrivate(db, t, staffId);
  const rec = planOfRecord(m); const c = clarity(periods, { costs: priv.costs, goalMonthly: priv.goalMonthly, commissionPct: rec.kind === 'commission' || rec.kind === 'tiered' || rec.kind === 'hourly_commission' ? rec.pct : null });
  const basis = { hours: c.hours, serviceSales: c.sales, retailSales: c.retail, tips: c.tips, otherPay: r2(c.sources.filter((s) => s.key === 'time' || s.key === 'other').reduce((a, s) => a + s.amount, 0)), days: c.days, currentGross: c.gross, minimumWage };
  const plans = [{ id: 'now', kind: 'current' as const }, ...(priv.plans.length ? priv.plans : DEFAULT_PLANS(rec))];
  const compare = c.hours > 0 ? plans.map((p) => ({ plan: p, label: p.kind === 'current' ? `How you’re paid now (${planLabel(rec)})` : planLabel(p), ...planPay(p, basis) })) : [];
  return { ok: true, range, periods, clarity: c, private: priv, compare, basis, payNow: { ...rec, label: planLabel(rec) }, minimumWage, name: String(m.name || '').split(' ')[0] || null };
}

/** The owner's "Pay plan check": per person, per hour before and with tips, unbooked time, weeks topped up to minimum
 *  wage and overtime, plus a plan to try on everyone it applies to. Never includes anyone's private notes. */
export async function planCheck(db: any, t: string, o: { days?: number; simulate?: any } = {}) {
  const days = o.days || 56; const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {};
  const { payRules } = await import('@/lib/pay-period'); const rules = payRules(tenant);
  const { staffWithPay } = await import('@/lib/staff-pay-server');
  const team = rows(await db.collection(`tenants/${t}/staff`).get()).filter((m: any) => !m.archived && m.isActive !== false && !m.isRenter && m.role !== 'renter' && m.role !== 'student');
  const sim = o.simulate ? cleanPlan(o.simulate) : null; const people: any[] = []; let simDelta = 0; const simWho: { name: string; delta: number }[] = [];
  for (const m0 of team.slice(0, 40)) {
    const m: any = (await staffWithPay(db, t, m0.id)) || m0; const periods = (await periodsFor(db, t, m0.id, days)).filter((p) => !p.current); if (!periods.length) continue;
    const c = clarity(periods); if (!c.hours && !c.gross) continue; const mw = minWageWeeks(periods); const rec = planOfRecord(m);
    const row: any = { staffId: m0.id, name: String(m.name || 'Team member'), plan: planLabel(rec), payStructure: String(m.payStructure || 'commission'), perHourNoTips: c.perHourNoTips, perHour: c.perHour,
      unbookedShare: c.hours ? Math.max(0, 100 - (c.bookedShare || 0)) : null, toppedUpWeeks: mw.weeks, toppedUpAmount: mw.amount, overtimeHours: c.overtimeHours, hours: c.hours, payBeforeTips: c.grossNoTips };
    if (sim && ['commission', 'tiered', 'hourly_commission'].includes(rec.kind) && c.hours > 0) {
      const b = { hours: c.hours, serviceSales: c.sales, retailSales: c.retail, tips: c.tips, otherPay: r2(c.sources.filter((s) => s.key === 'time' || s.key === 'other').reduce((a, s) => a + s.amount, 0)), days: c.days, currentGross: c.gross, minimumWage: rules.minimumWage };
      const x = planPay(sim, b); const d = r2(x.payBeforeTips - c.grossNoTips); row.simulated = { payBeforeTips: x.payBeforeTips, delta: d }; simDelta += d; simWho.push({ name: row.name.split(' ')[0], delta: d });
    }
    people.push(row);
  }
  return { ok: true, days, minimumWage: rules.minimumWage, overtimeHours: rules.overtimeHours, dailyOvertime: !!rules.dailyOvertimeHours, people,
    simulation: sim ? { plan: sim, label: planLabel(sim), delta: r2(simDelta), who: simWho } : null };
}
