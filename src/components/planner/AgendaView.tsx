'use client';
// src/components/planner/AgendaView.tsx — THE DAY AS ONE LIST. Every visit in time order with the provider, the client,
// the service and the state in words; sticky hour headers; gaps inside working hours as "Book here" rows; provider chips
// to narrow it; arrow keys move, Enter opens. The selected row drives the side panel next to it.
import * as React from 'react';
import { format, differenceInMinutes, isToday, startOfDay } from 'date-fns';

const safe = (v: any) => (v instanceof Date ? v : new Date(v?.toDate ? v.toDate() : v));
export const STATE_WORD: Record<string, string> = { confirmed: 'Booked', requested: 'Requested', servicing: 'In the chair', ready_for_checkout: 'Ready to pay', completed: 'Done', cancelled: 'Cancelled', declined: 'Declined', deposit_pending: 'Deposit due', pending_payment: 'Deposit unpaid' };
export const STATE_COLOR: Record<string, string> = { completed: 'var(--ok, #15803d)', servicing: 'var(--accent)', ready_for_checkout: 'var(--ok, #15803d)', confirmed: 'var(--accent)', requested: 'var(--muted, #6b635c)', deposit_pending: 'var(--warn, #b45309)', pending_payment: 'var(--warn, #b45309)', cancelled: '#a8a29e', declined: '#a8a29e' };
/** A clock that re-renders every `ms` — for live timers and "N min over". */
export function useNow(ms = 1000) { const [, set] = React.useState(0); React.useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t); }, [ms]); return new Date(); }
/** "12:04" elapsed since the visit started (hours shown past 60 minutes). */
export function elapsedLabel(a: any): string | null { if (a.status !== 'servicing' || !a.actualStartTime) return null; const s = Math.max(0, Math.floor((Date.now() - safe(a.actualStartTime).getTime()) / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; }
/** The marks every view shows — the same list as the board's cards, from the visit's own data. */
export function visitMarks(a: any, client: any, service: any): { label: string; tone: 'alert' | 'good' | 'info' }[] {
  const out: { label: string; tone: 'alert' | 'good' | 'info' }[] = []; const c = client || {};
  if (a.status === 'requested' || a.approvalStatus === 'pending') out.push({ label: 'Needs an answer', tone: 'alert' });
  if (a.groupId) out.push({ label: a.groupSize ? `Group of ${a.groupSize}` : 'Group', tone: 'info' });
  else if (a.visitId) out.push({ label: 'Several services', tone: 'info' });
  if (a.isEscalated) out.push({ label: 'Manager', tone: 'alert' });
  if (a.issue && a.issue.status === 'open') out.push({ label: 'Issue', tone: 'alert' });
  if (a.checkInStatus === 'running_late') out.push({ label: a.lateTimeMinutes ? `Late +${a.lateTimeMinutes}` : 'Running late', tone: 'alert' });
  if (a.checkInStatus === 'on_my_way') out.push({ label: a.clientTrip?.etaMin ? `En route ~${a.clientTrip.etaMin} min` : 'En route', tone: 'info' });
  if (a.checkInStatus === 'arrived' && a.status !== 'servicing') out.push({ label: 'Here', tone: 'good' });
  const need: string[] = [...((service as any)?.requiredFormIds || []), ...(a.requiredFormIds || [])]; const signed = new Set((a.signedForms || []).map((f: any) => f.formId));
  if (need.length && need.some((id) => !signed.has(id)) && !['completed', 'cancelled', 'declined'].includes(String(a.status))) out.push({ label: 'Form to sign', tone: 'alert' });
  if (c.id && (c.totalVisits === 0 || c.visitCount === 0 || c.isNew === true)) out.push({ label: 'First visit', tone: 'info' });
  if (c.activeMembershipId) out.push({ label: 'Member', tone: 'info' });
  if (a.packageId || a.redeemedPackageId) out.push({ label: 'Package', tone: 'info' });
  if (a.inspirationPhotoUrl) out.push({ label: 'Photo', tone: 'info' });
  if (Array.isArray(a.addOnIds) && a.addOnIds.length) out.push({ label: `+${a.addOnIds.length} add-on${a.addOnIds.length === 1 ? '' : 's'}`, tone: 'info' });
  try { if (c.birthday && String(c.birthday).slice(5, 10) === new Date().toISOString().slice(5, 10)) out.push({ label: 'Birthday', tone: 'good' }); } catch { /* fine */ }
  return out;
}
export const MARK_COLOR = { alert: 'var(--warn, #b45309)', good: 'var(--ok, #15803d)', info: 'var(--muted, #6b635c)' } as const;
export function stateOf(a: any, service: any): { word: string; color: string; over: number } {
  let over = 0;
  if (a.status === 'servicing' && a.actualStartTime) { const booked = (Number(service?.duration) || 0) + 0; over = booked > 0 ? Math.max(0, differenceInMinutes(new Date(), safe(a.actualStartTime)) - booked) : 0; }
  if (over > 0) return { word: `${over} min over`, color: 'var(--warn, #b45309)', over };
  if (a.status === 'requested' || a.approvalStatus === 'pending') return { word: 'Request — needs an answer', color: 'var(--warn, #b45309)', over: 0 };
  if (a.status === 'confirmed' && a.checkInStatus === 'arrived') return { word: 'Here, waiting', color: 'var(--accent)', over: 0 };
  if (a.status === 'confirmed' && a.checkInStatus === 'running_late') return { word: 'Running late', color: 'var(--warn, #b45309)', over: 0 };
  return { word: STATE_WORD[a.status] || a.status, color: STATE_COLOR[a.status] || 'var(--muted, #6b635c)', over: 0 };
}

export function AgendaView({ date, appointments, clients, services, staff, selectedId, onSelect, onOpen, onBookAt, providerFilter, onProviderFilter, extras = [], onOpenExtra }: {
  date: Date; appointments: any[]; clients: any[]; services: any[]; staff: any[]; selectedId: string | null; onSelect: (a: any) => void; onOpen: (a: any) => void;
  extras?: any[]; onOpenExtra?: (x: any) => void;   // events and blocks for the day (itemType 'event' | 'block'), shown in time order
  onBookAt?: (staffId: string, when: Date) => void; providerFilter: string; onProviderFilter: (id: string) => void;
}) {
  const dayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
  const rows = React.useMemo(() => {
    const visits = appointments.filter((a) => !['cancelled', 'declined'].includes(String(a.status)) && (providerFilter === 'all' || a.staffId === providerFilter)).map((a) => ({ kind: 'visit' as const, at: safe(a.startTime), a }));
    const gaps: any[] = [];
    if (onBookAt) for (const s of staff) { if (providerFilter !== 'all' && s.id !== providerFilter) continue; const d = s.availability?.week?.[dayKey]; if (!d || d.enabled === false || !d.start || !d.end) continue;
      const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); }; const start = toMin(d.start), end = toMin(d.end); const d0 = startOfDay(date);
      const busy = appointments.filter((a) => a.staffId === s.id && !['cancelled', 'declined'].includes(String(a.status))).map((a) => [differenceInMinutes(safe(a.startTime), d0), differenceInMinutes(safe(a.endTime), d0)]).sort((x, y) => x[0] - y[0]);
      let cursor = Math.max(start, isToday(date) ? Math.ceil(differenceInMinutes(new Date(), d0) / 5) * 5 : start);
      const push = (a: number, b: number) => gaps.push({ kind: 'gap', at: new Date(d0.getTime() + a * 60000), minutes: b - a, staff: s });
      for (const [a, b] of busy) { if (a - cursor >= 20) push(cursor, a); cursor = Math.max(cursor, b); } if (end - cursor >= 20) push(cursor, end); }
    const others = extras.filter((x: any) => providerFilter === 'all' || !x.staffId || x.staffId === providerFilter).map((x: any) => ({ kind: 'extra' as const, at: safe(x.startTime || x.date), x }));
    return [...visits, ...gaps, ...others].sort((x, y) => x.at.getTime() - y.at.getTime());
  }, [appointments, staff, providerFilter, date, dayKey, onBookAt, extras]);
  useNow(15000);   // keeps "N min over" and timers current
  const listRef = React.useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => { const visits = rows.filter((r) => r.kind === 'visit'); if (!visits.length) return; const i = visits.findIndex((r: any) => r.a.id === selectedId);
    if (e.key === 'ArrowDown') { e.preventDefault(); onSelect(visits[Math.min(visits.length - 1, i + 1)].a); } else if (e.key === 'ArrowUp') { e.preventDefault(); onSelect(visits[Math.max(0, i - 1)].a); } else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); onOpen(visits[i].a); } };
  const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
  let lastHour = -1;
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl" style={{ background: 'var(--card)', border: '1px solid var(--line)' }} aria-label="Agenda">
      <div className="flex gap-2 overflow-x-auto border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        {[{ id: 'all', name: 'Everyone' }, ...staff].map((s: any) => <button key={s.id} type="button" aria-pressed={providerFilter === s.id} onClick={() => onProviderFilter(s.id)} className="h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold" style={providerFilter === s.id ? { background: 'var(--ink)', color: '#fff' } : { background: 'var(--soft)' }}>{s.name}{s.isStudent ? ' · student' : ''}</button>)}
      </div>
      <div ref={listRef} tabIndex={0} onKeyDown={onKey} className="min-h-0 flex-1 overflow-auto outline-none" role="listbox" aria-label="Visits in time order">
        {!rows.length && <p className="p-6 text-[15px]" style={muted}>Nothing booked{providerFilter !== 'all' ? ' for them' : ''} on this day.</p>}
        {rows.map((r: any, i) => { const hour = r.at.getHours(); const header = hour !== lastHour; lastHour = hour;
          return (<React.Fragment key={r.kind === 'visit' ? r.a.id : r.kind === 'extra' ? `x-${r.x.id}` : `gap-${r.staff.id}-${r.at.getTime()}`}>
            {header && <div className="sticky top-0 z-[2] px-4 py-1 text-[12px] font-semibold" style={{ background: 'var(--soft)', ...muted }}>{format(r.at, 'h a')}</div>}
            {r.kind === 'extra' ? (
              <button type="button" onClick={() => onOpenExtra?.(r.x)} className="grid w-full grid-cols-[64px_6px_minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-2.5 text-left text-[14px]" style={{ borderColor: 'var(--line)' }}>
                <span style={muted}>{format(r.at, 'h:mm')}</span><span className="h-8 w-1.5 rounded-full" style={{ background: r.x.itemType === 'block' ? 'var(--line)' : 'var(--accent)' }} />
                <span className="min-w-0 truncate">{r.x.itemType === 'block' ? <span style={muted}>{r.x.reason || 'Blocked'}{r.x.staffId ? ` · ${staff.find((s) => s.id === r.x.staffId)?.name || ''}` : ''}</span> : <><b>{r.x.title || r.x.name || 'Event'}</b>{r.x.type ? ` · ${String(r.x.type).replace(/_/g, ' ')}` : ''}</>}</span>
                <span className="text-[13px]" style={muted}>{r.x.itemType === 'block' ? 'Not bookable' : 'Event'}</span>
              </button>) : r.kind === 'gap' ? (
              <button type="button" onClick={() => onBookAt?.(r.staff.id, r.at)} className="grid w-full grid-cols-[64px_6px_minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-2 text-left text-[13px]" style={{ borderColor: 'var(--line)', background: 'var(--paper, #faf8f5)', ...muted }} aria-label={`${r.minutes} minute gap for ${r.staff.name} at ${format(r.at, 'h:mm a')} — book here`}>
                <span>{format(r.at, 'h:mm')}</span><span className="h-8 w-1.5 rounded-full" style={{ background: 'var(--line)' }} /><span>{r.staff.name} · {r.minutes} min open</span><span className="font-semibold" style={{ color: 'var(--accent)' }}>Book here</span>
              </button>) : (() => { const a = r.a; const client = clients.find((c) => c.id === a.clientId); const service = services.find((s) => s.id === a.serviceId); const prov = staff.find((s) => s.id === a.staffId); const st = stateOf(a, service); const sel = a.id === selectedId;
              return (<div role="option" aria-selected={sel} onClick={() => onSelect(a)} onDoubleClick={() => onOpen(a)} className="grid cursor-pointer grid-cols-[64px_6px_minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-3 text-[14px]" style={{ borderColor: 'var(--line)', background: sel ? 'color-mix(in srgb, var(--accent) 7%, var(--card))' : undefined }}>
                <span style={muted}>{format(r.at, 'h:mm')}</span><span className="h-9 w-1.5 rounded-full" style={{ background: st.color }} />
                <span className="min-w-0 truncate">{providerFilter === 'all' && prov && <span className="mr-2 inline-block h-6 w-6 rounded-full text-center text-[11px] font-semibold leading-6 text-white" style={{ background: 'var(--accent)' }} aria-label={prov.name}>{String(prov.name || '?').charAt(0)}</span>}<b>{client?.name || a.clientName || 'Client'}</b> · {service?.name || a.serviceName || 'Service'}{service?.duration ? ` · ${service.duration} min` : ''}</span>
                <span className="flex flex-col items-end gap-0.5"><span className="whitespace-nowrap text-[13px] font-semibold" style={{ color: st.color }}>{st.word}{elapsedLabel(a) && !st.over ? ` · ${elapsedLabel(a)}` : ''}</span>
                  {(() => { const mk = visitMarks(a, client, service).filter((m) => !/Needs an answer/.test(m.label)).slice(0, 3); return mk.length ? <span className="flex gap-1">{mk.map((m) => <span key={m.label} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${MARK_COLOR[m.tone]} 12%, transparent)`, color: MARK_COLOR[m.tone] }}>{m.label}</span>)}</span> : null; })()}</span>
              </div>); })()}
          </React.Fragment>); })}
      </div>
    </section>);
}
