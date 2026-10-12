// src/lib/staff-kpis.ts — STAFF NUMBERS (approved design, Staff Portal Directions canvas S: "My numbers", "Team
// performance", "Book a one-on-one"). The same few numbers for a person and for the team, over the last 30 days against
// the 30 before, and against the business's goals (tenant.teamGoals):
//   rebooked        — finished visits where the client booked again within 7 days of it (the next visit can be later)
//   average visit   — service money per finished visit (services and add-ons, after redemptions)
//   retail / visit  — products they sold, per finished visit
//   chair time      — booked minutes ÷ minutes on work shifts (draft, cancelled and non-work shifts don't count)
//   on time         — visits started within 5 minutes of the booked time (only visits with a recorded start count)
//   redos           — redo fixes on their visits, as a share of finished visits
//   reviews         — the average "How was your visit?" rating
// Pure: the server loads the records (lib/staff-kpis-server) and calls kpisFor. Renters are never in the team numbers —
// their business is their own.

export interface TeamGoals { rebookPct: number; avgVisit: number; retailPerVisit: number; chairPct: number; onTimePct: number; redoPctMax: number }
export const DEFAULT_GOALS: TeamGoals = { rebookPct: 70, avgVisit: 60, retailPerVisit: 5, chairPct: 80, onTimePct: 95, redoPctMax: 3 };
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp = (v: any, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
export function goalsOf(tenant: any): TeamGoals {
  const g = tenant?.teamGoals || {};
  return { rebookPct: clamp(g.rebookPct, 0, 100, DEFAULT_GOALS.rebookPct), avgVisit: clamp(g.avgVisit, 0, 10000, DEFAULT_GOALS.avgVisit), retailPerVisit: clamp(g.retailPerVisit, 0, 1000, DEFAULT_GOALS.retailPerVisit),
    chairPct: clamp(g.chairPct, 0, 100, DEFAULT_GOALS.chairPct), onTimePct: clamp(g.onTimePct, 0, 100, DEFAULT_GOALS.onTimePct), redoPctMax: clamp(g.redoPctMax, 0, 100, DEFAULT_GOALS.redoPctMax) };
}

const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
const DONE = ['completed', 'checked_out', 'paid'];
const DEAD = ['cancelled', 'canceled', 'no_show', 'declined', 'expired'];
const DAY = 864e5;
const hm = (t: any) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export interface Numbers { visits: number; revenue: number; rebookPct: number | null; avgVisit: number | null; retailPerVisit: number | null; chairPct: number | null; onTimePct: number | null; redoPct: number | null; redos: number; rating: number | null; reviews: number }
export interface Inputs { appointments: any[]; retail: any[]; shifts: any[]; cases: any[] }

/** One person's (or the whole team's, staffId null) numbers for [from, to). */
export function numbersFor(x: Inputs, staffId: string | null, from: number, to: number): Numbers {
  const mine = (a: any) => staffId === null || String(a.staffId || '') === staffId;
  const inWin = (t: number) => t >= from && t < to;
  const visits = x.appointments.filter((a) => mine(a) && DONE.includes(String(a.status || '')) && inWin(ms(a.startTime)));
  const n = visits.length;
  const revenue = visits.reduce((s, a) => s + num(a.revenue ?? a.price), 0);
  // Rebooked: the same client has another (not dead) booking that was MADE within 7 days after this visit.
  const byClient = new Map<string, any[]>(); for (const a of x.appointments) { const c = String(a.clientId || ''); if (!c) continue; byClient.set(c, [...(byClient.get(c) || []), a]); }
  const rebooked = visits.filter((v) => { if (v.rebookedAs) return true; const t = ms(v.startTime); const made = (o: any) => ms(o.createdAt) || ms(o.bookedAt) || 0;
    return (byClient.get(String(v.clientId || '')) || []).some((o) => o !== v && ms(o.startTime) > t && !DEAD.includes(String(o.status || '')) && made(o) >= t - 3600e3 && made(o) <= t + 7 * DAY); }).length;
  const retail = x.retail.filter((r) => (staffId === null || String(r.staffId || '') === staffId) && inWin(ms(r.date))).reduce((s, r) => s + num(r.amount), 0);
  // Chair time: booked minutes on their visits ÷ minutes on their work shifts.
  const shiftMin = x.shifts.filter((s) => (staffId === null || String(s.staffId || '') === staffId) && !['cancelled', 'draft', 'denied'].includes(String(s.status || '')) && (!s.kind || s.kind === 'work') && inWin(Date.parse(`${s.date}T12:00:00Z`)))
    .reduce((m, s) => { const a = hm(s.startTime), b = hm(s.endTime); if (a === null || b === null) return m; const span = b > a ? b - a : b + 1440 - a; return m + Math.max(0, span - num(s.breakMinutes)); }, 0);
  const booked = x.appointments.filter((a) => mine(a) && !DEAD.includes(String(a.status || '')) && inWin(ms(a.startTime))).reduce((m, a) => m + (num(a.duration) || Math.max(0, Math.round((ms(a.endTime) - ms(a.startTime)) / 60000))), 0);
  const timed = visits.filter((a) => ms(a.actualStartTime) > 0); const onTime = timed.filter((a) => ms(a.actualStartTime) - ms(a.startTime) <= 5 * 60000).length;
  const visitIds = new Set(visits.map((v) => v.id));
  const redos = x.cases.filter((c) => c.fix?.kind === 'redo' && visitIds.has(String(c.visit?.appointmentId || c.appointmentId || ''))).length;
  const rated = visits.map((a) => num(a.feedback?.rating)).filter((r) => r > 0);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return { visits: n, revenue: Math.round(revenue * 100) / 100, rebookPct: pct(rebooked, n), avgVisit: n ? Math.round((revenue / n) * 100) / 100 : null, retailPerVisit: n ? Math.round((retail / n) * 100) / 100 : null,
    chairPct: shiftMin ? Math.min(100, Math.round((booked / shiftMin) * 1000) / 10) : null, onTimePct: pct(onTime, timed.length), redoPct: pct(redos, n), redos,
    rating: rated.length ? Math.round((rated.reduce((s, r) => s + r, 0) / rated.length) * 10) / 10 : null, reviews: rated.length };
}

/** Weekly revenue for the last 12 weeks (oldest first) — the little bars on Team performance. */
export function weekly(x: Inputs, staffId: string | null, now: number): number[] {
  const out: number[] = []; for (let i = 11; i >= 0; i--) { const to = now - i * 7 * DAY; out.push(numbersFor(x, staffId, to - 7 * DAY, to).revenue); } return out;
}

/** Things worth talking about in a one-on-one, in plain words — from their numbers against the goal and the team. */
export function suggestedTopics(me: Numbers, team: Numbers, g: TeamGoals, trend?: number[]): string[] {
  const out: string[] = [];
  if (me.rebookPct !== null && me.rebookPct < g.rebookPct) out.push(`Rebooking ${me.rebookPct}% (team ${team.rebookPct ?? '—'}%, goal ${g.rebookPct}%)`);
  if (me.retailPerVisit !== null && me.retailPerVisit < g.retailPerVisit) out.push(`Retail $${me.retailPerVisit.toFixed(2)} a visit (goal $${g.retailPerVisit})`);
  if (me.redoPct !== null && me.redoPct > g.redoPctMax && me.redos > 0) out.push(`${me.redos} redo${me.redos === 1 ? '' : 's'} this month`);
  if (me.onTimePct !== null && me.onTimePct < g.onTimePct) out.push(`Starting on time ${me.onTimePct}% (goal ${g.onTimePct}%)`);
  if (me.avgVisit !== null && me.avgVisit < g.avgVisit * 0.9) out.push(`Average visit $${Math.round(me.avgVisit)} (goal $${g.avgVisit})`);
  if (trend && trend.length >= 5) { const last = trend.slice(-4); if (last.every((v, i) => i === 0 || v < last[i - 1])) out.push('Revenue down four weeks in a row'); }
  return out.slice(0, 4);
}

/** A KPI tile's "on track" for the bar: 0–100 of the goal (redos: under the limit is full). */
export function towardGoal(kind: keyof TeamGoals, value: number | null, g: TeamGoals): number {
  if (value === null) return 0; const goal = g[kind]; if (kind === 'redoPctMax') return value <= goal ? 100 : Math.max(0, Math.round(100 - (value - goal) * 20));
  return goal ? Math.max(0, Math.min(100, Math.round((value / goal) * 100))) : 100;
}
