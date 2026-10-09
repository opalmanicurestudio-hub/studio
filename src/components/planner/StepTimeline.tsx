'use client';
// src/components/planner/StepTimeline.tsx — A VISIT'S STEPS, DRAWN. Two sizes:
//   <StepTimeline>  on the visit: a bar split into the service's steps (set-up · service · processing · turnover) with a
//                   marker that moves as the visit goes, the step happening now, and when the provider is free. Times follow
//                   what actually happens: a late start, a step running over, "Next step" and "+5 min" taps all move the
//                   later steps, and the knock-on for the next client is shown.
//   <StepEdge>      on a planner card: a thin strip down the card's edge — solid where the provider is hands-on, striped
//                   where the client is processing and the provider is free — so overlapping bookings make sense at a glance.
import * as React from 'react';
import { visitSteps, stepNow, clientStartMs, hasSteps, liveTiming, type Step } from '@/lib/phase-timeline';
import { useFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { logAuditClient } from '@/lib/audit-client';

const FILL: Record<string, string> = { setup: '#94a3b8', active: 'var(--accent, #0f172a)', processing: '#f59e0b', turnover: '#94a3b8' };
const stripes = (c: string) => `repeating-linear-gradient(-45deg, ${c} 0 4px, color-mix(in srgb, ${c} 35%, transparent) 4px 8px)`;
const bg = (s: Step) => (s.kind === 'active' ? FILL.active : stripes(FILL[s.kind] || '#94a3b8'));
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const useNow = (everyMs: number) => { const [now, setNow] = React.useState(() => Date.now()); React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]); return now; };

export function StepTimeline({ service, appointment, extraMinutes = 0, tenantId, next }: { service: any; appointment: any; extraMinutes?: number; tenantId?: string; next?: { clientName?: string; startMs: number } | null }) {
  const now = useNow(15000); const { firestore } = useFirebase(); const [busy, setBusy] = React.useState(false);
  const steps = React.useMemo(() => visitSteps(service, extraMinutes), [service, extraMinutes]);
  const lt = React.useMemo(() => liveTiming(steps, appointment, now), [steps, appointment, now]);
  if (!hasSteps(service) || !steps.length || !lt) return null;
  const total = Math.max(1, lt.freeMs - lt.steps[0].fromMs);
  const done = ['completed', 'cancelled', 'no_show', 'declined'].includes(String(appointment?.status));
  const live = !done && (['servicing', 'in_service'].includes(String(appointment?.status)) || !!appointment?.actualStartTime);
  const showMarker = live && lt.state === 'during' && lt.index >= 0; const cur = showMarker ? lt.steps[lt.index] : null;
  const client = lt.steps.map((x, i) => i).filter((i) => lt.steps[i].kind !== 'setup' && lt.steps[i].kind !== 'turnover');
  const nextIdx = cur ? client[client.indexOf(lt.index) + 1] : undefined;
  const late = lt.delayMin; const shifted = Math.abs(late) >= 1;
  // What the knock-on means for whoever is next in this chair / with this provider
  const nextLate = next && next.startMs ? Math.round((lt.freeMs - next.startMs) / 60000) : 0;
  const who = () => getAuth().currentUser?.displayName || 'Staff';
  const save = async (patch: any, action: string, summary: string) => { if (!firestore || !tenantId || !appointment?.id) return; setBusy(true);
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { ...patch, timingUpdatedAt: new Date().toISOString() });
      void logAuditClient(firestore, tenantId, { action, targetType: 'appointment', targetId: appointment.id, actor: { type: 'user', id: getAuth().currentUser?.uid, name: who() }, summary }); } catch { /* shown as unchanged */ } setBusy(false); };
  const nextStep = () => nextIdx !== undefined && save({ [`stepStarts.${nextIdx}`]: new Date().toISOString() }, 'visit.step', `${appointment?.clientName || 'Visit'}: ${lt.steps[nextIdx].label} started${cur && cur.over ? ` (${cur.label} ran ${Math.round((now - cur.fromMs) / 60000) - cur.minutes - cur.extra} min over)` : ''}`);
  const more = (m: number) => cur && save({ [`stepExtra.${lt.index}`]: (cur.extra || 0) + m }, 'visit.more_time', `${appointment?.clientName || 'Visit'}: ${cur.label} needs ${m} more min`);
  const red = '#b42318';
  return (
    <section aria-label="Steps of this visit" className="rounded-2xl border bg-card p-4">
      <style>{`@keyframes cfStepPulse{0%,100%{opacity:1}50%{opacity:.55}}@media (prefers-reduced-motion: reduce){.cf-step-now{animation:none!important}.cf-step-marker{transition:none!important}}`}</style>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[13px] font-semibold">Steps</p>
        <p className="text-[13px] text-muted-foreground" role="status">
          {cur ? <><b className="text-foreground">Now: {cur.label}</b> · {cur.over ? <b style={{ color: red }}>{Math.max(1, Math.round((now - cur.fromMs) / 60000) - cur.minutes - cur.extra)} min over</b> : `${lt.leftMin} min left`}{cur.kind === 'processing' && !cur.providerNeeded ? ' · provider is free' : ''}</>
            : done ? 'Finished' : lt.state === 'after' && live ? 'All steps done' : `${Math.round(total / 60000)} min in all`}
        </p>
      </div>
      {!done && shifted && (live || late > 0) && <p className="mb-2 rounded-xl px-3 py-2 text-[13px]" style={{ background: late > 0 ? 'color-mix(in srgb, #b42318 9%, transparent)' : 'color-mix(in srgb, #1f6b3a 9%, transparent)', color: late > 0 ? red : '#1f6b3a' }}>
        <b>{late > 0 ? `Running ${late} min behind` : `${-late} min ahead`}</b> · client finishes about {clock(lt.clientEndMs)} (booked {clock(lt.plannedClientEndMs)}) · free again {clock(lt.freeMs)}
        {next && nextLate > 0 && <><br />Next: {next.clientName || 'the next client'} at {clock(next.startMs)} would start about {nextLate} min late.</>}
      </p>}
      <div className="relative">
        <div className="flex h-5 w-full overflow-hidden rounded-full" style={{ background: 'var(--soft, #efebe6)' }}>
          {lt.steps.map((s, i) => { const w = Math.max(0, s.toMs - s.fromMs); const planned = (s.minutes + s.extra) * 60000; const overW = s.over ? Math.max(0, w - planned) : 0;
            return <div key={i} title={`${s.label} · ${s.minutes} min${s.extra ? ` + ${s.extra}` : ''}`} className={`flex ${cur === s ? 'cf-step-now' : ''}`} style={{ width: `${(w / total) * 100}%`, opacity: showMarker && i < lt.index ? 0.35 : 1, borderRight: i < lt.steps.length - 1 ? '2px solid var(--card, #fff)' : undefined, animation: cur === s ? 'cfStepPulse 2.4s ease-in-out infinite' : undefined }}>
              <div style={{ flex: `${w - overW} 0 0`, background: bg(s) }} />{overW > 0 && <div style={{ flex: `${overW} 0 0`, background: stripes(red) }} />}</div>; })}
        </div>
        {showMarker && <div aria-hidden className="cf-step-marker absolute -top-1 h-7 w-[3px] rounded-full bg-foreground" style={{ left: `calc(${lt.pct}% - 1px)`, transition: 'left 15s linear' }} />}
      </div>
      <ol className="mt-3 space-y-1">
        {lt.steps.map((s, i) => { const moved = Math.abs(s.fromMs - s.plannedFromMs) >= 60000 && !done;
          return (
          <li key={i} className="flex flex-wrap items-center gap-x-2 text-[13px]" style={{ opacity: showMarker && i < lt.index ? 0.5 : 1 }}>
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ background: bg(s) }} />
            <span className={cur === s ? 'font-semibold' : ''}>{s.label}</span>
            <span className="text-muted-foreground">{clock(s.fromMs)} – {clock(s.toMs)}{moved && <s className="ml-1 opacity-70">{clock(s.plannedFromMs)}</s>}{s.extra ? ` · +${s.extra} min` : ''}{s.kind === 'processing' && !s.providerNeeded ? ' · provider free' : s.kind === 'setup' ? ' · before the client' : s.kind === 'turnover' ? ' · after the client' : ''}</span>
          </li>); })}
      </ol>
      {cur && tenantId && <div className="mt-3 flex flex-wrap gap-2">
        {nextIdx !== undefined && <button type="button" disabled={busy} onClick={nextStep} className="h-11 rounded-xl bg-foreground px-4 text-[14px] font-[700] text-background disabled:opacity-50">Next: {lt.steps[nextIdx].label}</button>}
        {[5, 10].map((m) => <button key={m} type="button" disabled={busy} onClick={() => more(m)} className="h-11 rounded-xl border px-4 text-[14px] font-[600] disabled:opacity-50">+{m} min</button>)}
      </div>}
    </section>);
}

/** The strip down a planner card's edge: the client's time only (the card's own height), top to bottom. */
export function StepEdge({ service, appointment }: { service: any; appointment: any }) {
  const now = useNow(30000);
  const steps = React.useMemo(() => visitSteps(service).filter((s) => s.kind === 'active' || s.kind === 'processing'), [service]);
  if (!hasSteps(service) || steps.length < 2) return null;
  const total = steps[steps.length - 1].to - steps[0].from; const start = clientStartMs(appointment);
  const live = String(appointment?.status) === 'servicing' || (!!appointment?.actualStartTime && String(appointment?.status) !== 'completed');
  const at = stepNow(steps, start, now); const lt = liveTiming(visitSteps(service), appointment, now); const behind = live && lt && lt.delayMin >= 5;
  return (
    <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 top-0 flex w-[5px] flex-col overflow-hidden">
      {steps.map((s, i) => <div key={i} style={{ height: `${(s.minutes / total) * 100}%`, background: bg(s), borderBottom: i < steps.length - 1 ? '1px solid #fff' : undefined }} />)}
      {behind && <div className="absolute bottom-0 left-0 right-0 h-[6px]" style={{ background: '#b42318' }} />}
      {live && at.state === 'during' && <div className="absolute left-0 right-0 h-[3px] bg-foreground" style={{ top: `calc(${at.pct}% - 1px)`, transition: 'top 30s linear' }} />}
    </div>);
}
