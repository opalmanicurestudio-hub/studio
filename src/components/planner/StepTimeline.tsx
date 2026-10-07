'use client';
// src/components/planner/StepTimeline.tsx — A VISIT'S STEPS, DRAWN. Two sizes:
//   <StepTimeline>  on the visit: a bar split into the service's steps (set-up · service · processing · turnover) with a
//                   marker that moves as the visit goes, the step happening now, and when the provider is free.
//   <StepEdge>      on a planner card: a thin strip down the card's edge — solid where the provider is hands-on, striped
//                   where the client is processing and the provider is free — so overlapping bookings make sense at a glance.
import * as React from 'react';
import { visitSteps, stepNow, clientStartMs, hasSteps, type Step } from '@/lib/phase-timeline';

const FILL: Record<string, string> = { setup: '#94a3b8', active: 'var(--accent, #0f172a)', processing: '#f59e0b', turnover: '#94a3b8' };
const stripes = (c: string) => `repeating-linear-gradient(-45deg, ${c} 0 4px, color-mix(in srgb, ${c} 35%, transparent) 4px 8px)`;
const bg = (s: Step) => (s.kind === 'active' ? FILL.active : stripes(FILL[s.kind] || '#94a3b8'));
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const useNow = (everyMs: number) => { const [now, setNow] = React.useState(() => Date.now()); React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]); return now; };

export function StepTimeline({ service, appointment, extraMinutes = 0 }: { service: any; appointment: any; extraMinutes?: number }) {
  const now = useNow(15000);
  const steps = React.useMemo(() => visitSteps(service, extraMinutes), [service, extraMinutes]);
  if (!hasSteps(service) || !steps.length) return null;
  const start = clientStartMs(appointment); const total = steps[steps.length - 1].to - steps[0].from;
  const live = ['servicing', 'in_service'].includes(String(appointment?.status)) || !!appointment?.actualStartTime;
  const done = ['completed', 'cancelled', 'no_show', 'declined'].includes(String(appointment?.status));
  const at = stepNow(steps, start, now); const showMarker = live && !done && at.state === 'during';
  const cur = showMarker ? steps[at.index] : null;
  return (
    <section aria-label="Steps of this visit" className="rounded-2xl border bg-card p-4">
      <style>{`@keyframes cfStepPulse{0%,100%{opacity:1}50%{opacity:.55}}@media (prefers-reduced-motion: reduce){.cf-step-now{animation:none!important}.cf-step-marker{transition:none!important}}`}</style>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[13px] font-semibold">Steps</p>
        <p className="text-[13px] text-muted-foreground" role="status">
          {cur ? <><b className="text-foreground">Now: {cur.label}</b> · {at.leftMin} min left{cur.kind === 'processing' && !cur.providerNeeded ? ' · provider is free' : ''}</>
            : done ? 'Finished' : at.state === 'after' && live ? 'All steps done' : `${Math.round(total)} min in all`}
        </p>
      </div>
      <div className="relative">
        <div className="flex h-5 w-full overflow-hidden rounded-full" style={{ background: 'var(--soft, #efebe6)' }}>
          {steps.map((s, i) => <div key={i} title={`${s.label} · ${s.minutes} min`} className={cur === s ? 'cf-step-now' : ''} style={{ width: `${(s.minutes / total) * 100}%`, background: bg(s), opacity: showMarker && i < at.index ? 0.35 : 1, borderRight: i < steps.length - 1 ? '2px solid var(--card, #fff)' : undefined, animation: cur === s ? 'cfStepPulse 2s ease-in-out infinite' : undefined }} />)}
        </div>
        {showMarker && <div aria-hidden className="cf-step-marker absolute -top-1 h-7 w-[3px] rounded-full bg-foreground" style={{ left: `calc(${at.pct}% - 1px)`, transition: 'left 15s linear' }} />}
      </div>
      <ol className="mt-3 space-y-1">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-[13px]" style={{ opacity: showMarker && i < at.index ? 0.5 : 1 }}>
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ background: bg(s) }} />
            <span className={cur === s ? 'font-semibold' : ''}>{s.label}</span>
            <span className="text-muted-foreground">{start ? `${clock(start + s.from * 60000)} – ${clock(start + s.to * 60000)}` : `${s.minutes} min`}{s.kind === 'processing' && !s.providerNeeded ? ' · provider free' : s.kind === 'setup' ? ' · before the client' : s.kind === 'turnover' ? ' · after the client' : ''}</span>
          </li>))}
      </ol>
    </section>);
}

/** The strip down a planner card's edge: the client's time only (the card's own height), top to bottom. */
export function StepEdge({ service, appointment }: { service: any; appointment: any }) {
  const now = useNow(30000);
  const steps = React.useMemo(() => visitSteps(service).filter((s) => s.kind === 'active' || s.kind === 'processing'), [service]);
  if (!hasSteps(service) || steps.length < 2) return null;
  const total = steps[steps.length - 1].to - steps[0].from; const start = clientStartMs(appointment);
  const live = String(appointment?.status) === 'servicing' || (!!appointment?.actualStartTime && String(appointment?.status) !== 'completed');
  const at = stepNow(steps, start, now);
  return (
    <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 top-0 flex w-[5px] flex-col overflow-hidden">
      {steps.map((s, i) => <div key={i} style={{ height: `${(s.minutes / total) * 100}%`, background: bg(s), borderBottom: i < steps.length - 1 ? '1px solid #fff' : undefined }} />)}
      {live && at.state === 'during' && <div className="absolute left-0 right-0 h-[3px] bg-foreground" style={{ top: `calc(${at.pct}% - 1px)`, transition: 'top 30s linear' }} />}
    </div>);
}
