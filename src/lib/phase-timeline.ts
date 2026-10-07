// src/lib/phase-timeline.ts — A VISIT'S STEPS ON A CLOCK. Turns a service's blueprint (set-up → service → processing →
// service → turnover) into stretches of time for one visit, and says which step is happening right now.
// The client's time starts at the visit's start (the actual start once they're in service); set-up sits before it and
// turnover after it. Used by the planner card's edge strip and the step timeline on the visit.
import { phasesFromService, PHASE_LABEL, type PhaseKind } from '@/lib/blueprint';

export interface Step { kind: PhaseKind; label: string; minutes: number; providerNeeded: boolean; from: number; to: number }   // from/to: minutes from the client's start (set-up is negative)
const mins = (n: any) => Math.max(0, Math.round(Number(n) || 0));
const ms = (v: any): number => { if (!v) return 0; if (typeof v === 'string') return Date.parse(v) || 0; if (v?.seconds) return v.seconds * 1000; if (v?.toDate) return v.toDate().getTime(); if (v instanceof Date) return v.getTime(); return Number(v) || 0; };

/** True when the service has steps worth drawing (more than one, i.e. not just "the service"). */
export const hasSteps = (service: any) => Array.isArray(service?.blueprint?.phases) && service.blueprint.phases.filter((p: any) => mins(p?.minutes) > 0).length > 1;

/** The visit's steps in order. `extraMinutes` (a client's own extra time, add-ons) lengthens the last hands-on step. */
export function visitSteps(service: any, extraMinutes = 0): Step[] {
  const raw: any[] = (Array.isArray(service?.blueprint?.phases) && service.blueprint.phases.length ? service.blueprint.phases : phasesFromService(service)).filter((p: any) => mins(p?.minutes) > 0);
  const order = (k: PhaseKind) => (k === 'setup' ? 0 : k === 'turnover' ? 2 : 1);
  const sorted = raw.map((p, i) => ({ p, i })).sort((a, b) => order(a.p.kind) - order(b.p.kind) || a.i - b.i).map((x) => ({ ...x.p, minutes: mins(x.p.minutes) }));
  if (extraMinutes) { for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].kind === 'active') { sorted[i].minutes = Math.max(5, sorted[i].minutes + Math.round(extraMinutes)); break; } }
  const setup = sorted.filter((p) => p.kind === 'setup').reduce((a, p) => a + p.minutes, 0);
  let at = -setup;
  return sorted.map((p): Step => { const s: Step = { kind: p.kind, label: String(p.label || PHASE_LABEL[p.kind as PhaseKind] || 'Step').trim(), minutes: p.minutes, providerNeeded: p.kind === 'turnover' ? !!p.providerNeeded : p.providerNeeded !== false, from: at, to: at + p.minutes }; at += p.minutes; return s; });
}
/** When the client's time starts for this visit: the actual start once in service, else the booked start. */
export const clientStartMs = (appt: any) => ms(appt?.actualStartTime) || ms(appt?.startTime);

/** Where "now" falls: which step, minutes left in it, and how far through the whole timeline (0–100). */
export function stepNow(steps: Step[], startMs: number, now = Date.now()): { index: number; leftMin: number; pct: number; state: 'before' | 'during' | 'after' } {
  if (!steps.length || !startMs) return { index: -1, leftMin: 0, pct: 0, state: 'before' };
  const t = (now - startMs) / 60000; const first = steps[0].from, last = steps[steps.length - 1].to;
  if (t < first) return { index: -1, leftMin: Math.ceil(first - t), pct: 0, state: 'before' };
  if (t >= last) return { index: steps.length - 1, leftMin: 0, pct: 100, state: 'after' };
  const i = steps.findIndex((s) => t >= s.from && t < s.to);
  return { index: i, leftMin: Math.max(1, Math.ceil(steps[i].to - t)), pct: ((t - first) / (last - first)) * 100, state: 'during' };
}
