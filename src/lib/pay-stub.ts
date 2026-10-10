// src/lib/pay-stub.ts — A PAY STUB: one person, one pay period — the statement (lib/pay-statement), every line behind
// it (lib/pay-audit), approved corrections, and payday. Once payday has passed the stub is SAVED (payStubs/{staff}_{from})
// and never changes again — a later fix goes on the next stub as an adjustment, so what someone was paid stays what
// they were shown.
import { buildStatement } from '@/lib/pay-statement';
import { auditOf, type Audit } from '@/lib/pay-audit';
import { sessionsFrom, clockPolicy } from '@/lib/timeclock';
import { recentPeriods, periodRange, isPaid, type PayPeriod } from '@/lib/pay-periods';

export type Stub = { staffId: string; name: string; role: string; period: PayPeriod; paid: boolean; frozen: boolean; payStructure: string;
  total: number; parts: { services: number; tips: number; retail: number; time: number; other: number; adjustments: number };
  hours: number; overtimeHours: number; visits: number; notes: string[]; audit: Audit; savedAt?: string };

const r2 = (v: number) => Math.round((v || 0) * 100) / 100;

export async function buildStub(db: any, tenantId: string, staffId: string, period: PayPeriod): Promise<Stub | null> {
  const T = `tenants/${tenantId}`;
  const [tSnap, mSnap] = await Promise.all([db.doc(T).get(), db.doc(`${T}/staff/${staffId}`).get()]);
  if (!mSnap.exists) return null;
  const tenant: any = tSnap.data() || {}; const member: any = { id: staffId, ...(mSnap.data() || {}) };
  const { fromIso, toIso } = periodRange(tenant, period);
  const [svcSnap, txSnap, pSnap, shSnap, adjSnap] = await Promise.all([
    db.collection(`${T}/services`).get(),
    db.collection(`${T}/transactions`).where('date', '>=', fromIso).where('date', '<=', toIso).get(),
    db.collection(`${T}/activityLogs`).where('timestamp', '>=', new Date(Date.parse(fromIso) - 86400000).toISOString()).where('timestamp', '<=', new Date(Date.parse(toIso) + 86400000).toISOString()).get(),
    db.collection(`${T}/shifts`).where('staffId', '==', staffId).get(),
    db.collection(`${T}/payAdjustments`).where('staffId', '==', staffId).get(),
  ]);
  const services = svcSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const income = txSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).map((t: any) => ({ ...t, amount: typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100, type: t.type || 'income' }));
  const punches = pSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((p: any) => p.staffId === staffId);
  let tips: number | undefined; let tipRuns: { id: string; start: string; end: string; share: number }[] | undefined;
  if (String(tenant.tipSharing?.mode || 'direct') !== 'direct') { tips = 0; tipRuns = [];
    for (const d of (await db.collection(`${T}/tipShareRuns`).where('status', '==', 'approved').get()).docs) { const r: any = d.data() || {}; if (String(r.start || '') < fromIso || String(r.end || '') > toIso) continue;
      for (const x of r.rows || []) if (x.staffId === staffId) { const v = (Number(x.shareCents) || 0) / 100; tips += v; tipRuns.push({ id: d.id, start: String(r.start).slice(0, 10), end: String(r.end).slice(0, 10), share: v }); } } }
  const apptStaff: Record<string, string> = {};
  if (Number(tenant.payExtras?.noShowPct) > 0) for (const t of income) if (!t.staffId && t.appointmentId && ['No-Show Revenue', 'Cancellation Fee', 'Cancellation Fees'].includes(String(t.category))) { const a: any = (await db.doc(`${T}/appointments/${t.appointmentId}`).get()).data(); if (a?.staffId) apptStaff[t.appointmentId] = String(a.staffId); }
  const shifts = shSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const st = buildStatement({ member, from: fromIso, to: toIso, incomeTxns: income, shifts, services, tenant, punches, apptStaff, tips });
  const sessions = sessionsFrom(punches, clockPolicy(tenant, Date.parse(toIso))).filter((s) => s.staffId === staffId && s.localDate >= period.from && s.localDate <= period.to);
  const adjustments = adjSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((a: any) => String(a.date || '') >= fromIso && String(a.date || '') <= toIso);
  const audit = auditOf({ st, member, tenant, income, services, sessions, tipRuns, adjustments });
  const sum = (a: { amount: number }[]) => r2(a.reduce((s, x) => s + x.amount, 0));
  const timeKeys = ['p:hourly', 'p:training', 'p:salary', 'p:ot', 'p:minwage'];
  const parts = { services: sum(audit.visits), tips: sum(audit.tips), retail: sum(audit.retail), time: sum(audit.period.filter((x) => timeKeys.includes(x.ref))),
    other: sum(audit.period.filter((x) => !timeKeys.includes(x.ref))), adjustments: sum(audit.adjustments) };
  return { staffId, name: member.name || 'Team member', role: String(member.role || 'staff'), period, paid: isPaid(tenant, period), frozen: false, payStructure: st.payStructure,
    total: audit.check.total, parts, hours: r2(st.line.hours), overtimeHours: r2(st.line.overtimeHours), visits: audit.visits.length, notes: st.notes, audit };
}

/** The stub to show: saved once paid (and from then on read back unchanged), live until then. */
export async function stubFor(db: any, tenantId: string, staffId: string, period: PayPeriod): Promise<Stub | null> {
  const ref = db.doc(`tenants/${tenantId}/payStubs/${staffId}_${period.from}`);
  const saved = await ref.get();
  if (saved.exists) return { ...(saved.data() as any), frozen: true };
  const s = await buildStub(db, tenantId, staffId, period); if (!s) return null;
  if (s.paid) { const snap = { ...s, frozen: true, savedAt: new Date().toISOString() }; await ref.set(JSON.parse(JSON.stringify(snap))); return snap; }
  return s;
}

/** The Pay home: this period live (with a day-by-day view), and the paid stubs before it. */
export async function payHome(db: any, tenantId: string, staffId: string, count = 7) {
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const [cur, ...past] = recentPeriods(tenant, count);
  const current = await buildStub(db, tenantId, staffId, cur);
  const stubs: { period: PayPeriod; total: number; parts: Stub['parts']; paid: boolean }[] = [];
  for (const p of past) { const s = await stubFor(db, tenantId, staffId, p); if (s && (s.total || s.audit.check.lines)) stubs.push({ period: p, total: s.total, parts: s.parts, paid: s.paid }); }
  const prev = stubs[0]?.total ?? null; const best = stubs.reduce((m, s) => Math.max(m, s.total), 0) || null;
  return { current: current ? { ...current, audit: { byDay: current.audit.byDay, check: current.audit.check } } : null, stubs, previousTotal: prev, bestTotal: best };
}
