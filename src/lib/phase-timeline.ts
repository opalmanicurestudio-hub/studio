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

// ── Live timing: the plan, corrected by what has actually happened ─────────────────────────────────────────────────
// A provider can tap "Next step" (recorded as stepStarts[i] = when step i began) and "More time" (stepExtra[i] = extra
// minutes for step i). Without taps the steps follow the plan, and the last hands-on step stretches until the visit ends.
export interface LiveStep extends Step { fromMs: number; toMs: number; plannedFromMs: number; plannedToMs: number; over: boolean; extra: number }
export interface LiveTiming { steps: LiveStep[]; index: number; state: 'before' | 'during' | 'after'; leftMin: number; pct: number;
  /** Minutes the client's part will finish later (+) or earlier (−) than booked. */ delayMin: number;
  /** When the client's part is now expected to end, and when the station is expected to be free again. */ clientEndMs: number; freeMs: number; plannedClientEndMs: number; recorded: boolean }

export function liveTiming(steps: Step[], appt: any, now = Date.now()): LiveTiming | null {
  const startMs = clientStartMs(appt); if (!steps.length || !startMs) return null;
  const bookedMs = ms(appt?.startTime) || startMs;
  const starts: Record<string, any> = appt?.stepStarts || {}; const extras: Record<string, any> = appt?.stepExtra || {};
  const at = (i: number) => ms(starts[String(i)]);
  const finished = ['completed', 'checked_out'].includes(String(appt?.status)) ? ms(appt?.actualEndTime) || ms(appt?.completedAt) : 0;
  const live = !finished && (['servicing', 'in_service'].includes(String(appt?.status)) || !!appt?.actualStartTime);
  const client = steps.map((s, i) => i).filter((i) => steps[i].kind !== 'setup' && steps[i].kind !== 'turnover');
  const lastClient = client[client.length - 1] ?? steps.length - 1;
  const logged = client.filter((i) => at(i) > 0); const recorded = logged.length > 0;
  // Which step is happening now
  let cur = -1;
  if (live || finished) {
    if (recorded) cur = Math.max(...logged);
    else { const t = ((finished || now) - startMs) / 60000; cur = client.find((i) => t < steps[i].to) ?? lastClient; }
  }
  const out: LiveStep[] = []; let t = startMs; let plannedT = bookedMs;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]; const extra = Math.max(0, Math.round(Number(extras[String(i)]) || 0)); const len = (s.minutes + extra) * 60000;
    if (s.kind === 'setup') { out.push({ ...s, fromMs: startMs + s.from * 60000, toMs: startMs + s.to * 60000, plannedFromMs: bookedMs + s.from * 60000, plannedToMs: bookedMs + s.to * 60000, over: false, extra }); continue; }
    const from = at(i) || t; const pFrom = plannedT; const pTo = plannedT + s.minutes * 60000; plannedT = pTo;
    let to: number;
    if (s.kind === 'turnover') to = from + len;
    else if (cur >= 0 && i < cur) { const nx = client[client.indexOf(i) + 1]; to = (nx !== undefined && at(nx)) || from + len; }
    else if (i === cur) to = finished ? Math.max(from, finished) : Math.max(from + len, live ? now : 0);
    else if (finished && i > cur) to = from;   // finished before reaching this step
    else to = from + len;
    out.push({ ...s, fromMs: from, toMs: to, plannedFromMs: pFrom, plannedToMs: pTo, over: i === cur && !finished && live && now > from + len, extra });
    t = to;
  }
  const lc = out[lastClient]; const clientEndMs = lc ? lc.toMs : t; const plannedClientEndMs = lc ? lc.plannedToMs : t;
  const freeMs = out.length ? out[out.length - 1].toMs : clientEndMs;
  const first = out[0].fromMs, last = freeMs, span = Math.max(1, last - first);
  const state: LiveTiming['state'] = finished || (live && now >= last) ? 'after' : !live ? 'before' : 'during';
  const ci = cur >= 0 ? cur : -1; const leftMin = ci >= 0 && state === 'during' ? Math.max(0, Math.ceil((out[ci].toMs - now) / 60000)) : 0;
  return { steps: out, index: ci, state, leftMin, pct: Math.min(100, Math.max(0, ((Math.min(now, last) - first) / span) * 100)), delayMin: Math.round((clientEndMs - plannedClientEndMs) / 60000), clientEndMs, freeMs, plannedClientEndMs, recorded };
}
