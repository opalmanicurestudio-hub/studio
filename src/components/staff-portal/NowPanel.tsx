'use client';
// src/components/staff-portal/NowPanel.tsx — "NOW" ON THE STAFF PORTAL'S TODAY TAB: the visit in progress with every
// step (StepTimeline — Next step and +5 min move the later steps and warn the next client's provider), or the next
// visit if nothing is under way; then the rest of today with each visit's step ribbon and the free gaps between them.
import * as React from 'react';
import { StepTimeline, StepRibbon } from '@/components/planner/StepTimeline';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const ms = (v: any) => { const t = v?.toDate ? v.toDate().getTime() : Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const OFF = ['cancelled', 'no_show', 'declined'];
export const isLive = (a: any) => ['servicing', 'in_service'].includes(String(a?.status)) || (!!a?.actualStartTime && !['completed', ...OFF].includes(String(a?.status)));

export function endOf(a: any, svc: any): number {
  const e = ms(a?.endTime); if (Number.isFinite(e)) return e;
  return ms(a?.startTime) + (Number(svc?.duration) || Number(a?.duration) || 60) * 60000;
}

/** The visit under way right now, if any (used to open Today on "Now"). */
export function currentVisit(apts: any[]): any | null {
  return (apts || []).find((a) => isLive(a)) || null;
}

export function NowPanel({ apts, services, tenantId, accent = INK, onOpen }: { apts: any[]; services: any[]; tenantId: string; accent?: string; onOpen: (a: any) => void }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const svcOf = (a: any) => (services || []).find((s: any) => s.id === a?.serviceId) || null;
  const day = (apts || []).filter((a) => !OFF.includes(String(a?.status)) && Number.isFinite(ms(a?.startTime))).sort((a, b) => ms(a.startTime) - ms(b.startTime));
  const live = day.find(isLive) || null;
  const upcoming = day.filter((a) => a !== live && String(a.status) !== 'completed' && endOf(a, svcOf(a)) > now);
  const focus = live || upcoming[0] || null;
  const rest = upcoming.filter((a) => a !== focus);
  const after = focus ? rest[0] : null;

  return (
    <div className="space-y-4" style={{ color: INK }}>
      {focus ? (
        <div className="space-y-3 rounded-[24px] border bg-white p-4" style={{ borderColor: LINE, boxShadow: '0 14px 34px -22px rgba(22,23,26,.4)' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full px-2.5 py-1 text-[12px] font-bold text-white" style={{ background: live ? accent : INK }}>{live ? 'Now' : `Next · ${Math.max(0, Math.round((ms(focus.startTime) - now) / 60000))} min`}</span>
            <span className="text-[12px]" style={{ color: MUTED }}>{clock(ms(focus.startTime))} – {clock(endOf(focus, svcOf(focus)))}{focus.stationName ? ` · ${focus.stationName}` : ''}</span>
          </div>
          <button type="button" onClick={() => onOpen(focus)} className="block w-full text-left">
            <p className="text-[20px] font-extrabold leading-tight">{focus.clientName || 'Client'}</p>
            <p className="text-[14px]" style={{ color: MUTED }}>{svcOf(focus)?.name || focus.serviceName || 'Visit'}{focus.checkInStatus === 'arrived' ? ' · here' : focus.checkInStatus === 'on_my_way' ? ' · on the way' : focus.checkInStatus === 'running_late' ? ' · running late' : ''}</p>
          </button>
          {live && svcOf(focus) ? <StepTimeline service={svcOf(focus)} appointment={focus} tenantId={tenantId} next={after ? { clientName: after.clientName, startMs: ms(after.startTime) } : null} />
            : <StepRibbon service={svcOf(focus)} appointment={focus} height={10} />}
          {!live && <button type="button" onClick={() => onOpen(focus)} className="h-11 w-full rounded-[14px] text-[14px] font-bold text-white" style={{ background: INK }}>Open visit</button>}
        </div>
      ) : (
        <div className="rounded-[24px] border p-5 text-center" style={{ borderColor: LINE }}>
          <p className="text-[16px] font-bold">No more visits today</p>
          <p className="text-[14px]" style={{ color: MUTED }}>Anything new will show up here.</p>
        </div>)}

      {rest.length > 0 && (
        <section aria-label="Rest of today" className="space-y-2">
          <p className="px-0.5 text-[15px] font-bold">Rest of today</p>
          {rest.map((a, i) => {
            const prevEnd = i === 0 ? (focus ? endOf(focus, svcOf(focus)) : now) : endOf(rest[i - 1], svcOf(rest[i - 1]));
            const gap = Math.round((ms(a.startTime) - prevEnd) / 60000);
            return (
              <React.Fragment key={a.id}>
                {gap >= 20 && <p className="py-0.5 text-center text-[12px] font-semibold" style={{ color: MUTED }}>Free {gap >= 60 ? `${Math.floor(gap / 60)} h${gap % 60 ? ` ${gap % 60} min` : ''}` : `${gap} min`}</p>}
                <button type="button" onClick={() => onOpen(a)} className="flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3 text-left" style={{ background: '#f6f6f7' }}>
                  <span className="w-12 shrink-0 text-[14px] font-bold tabular-nums">{clock(ms(a.startTime)).replace(/\s?[AP]M/i, '')}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{a.clientName || 'Client'} · {svcOf(a)?.name || a.serviceName || 'Visit'}</span>
                    <span className="mt-2 block"><StepRibbon service={svcOf(a)} appointment={a} height={6} /></span>
                  </span>
                </button>
              </React.Fragment>);
          })}
        </section>)}
    </div>);
}
