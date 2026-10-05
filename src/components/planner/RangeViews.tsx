'use client';
// src/components/planner/RangeViews.tsx — PLANNING AHEAD.
//   MonthView — every day of the month: visits, booked, how full, and what's special (closed, full, requests waiting,
//               events, who's off, plenty of space). Tap a day → that day's board.
//   WeekView  — the week as seven columns of compact visits (time · client · service · state); tap a visit → the Visit,
//               tap a day's heading → that day's board. On phones: the week as one list grouped by day.
import * as React from 'react';
import { format, addDays, addMonths, startOfWeek, startOfMonth, isSameDay, isToday, isBefore, startOfDay, differenceInMinutes } from 'date-fns';
import { dayInfo } from '@/components/planner/PlannerHeader';
import { stateOf } from '@/components/planner/AgendaView';

const safe = (v: any) => (v instanceof Date ? v : new Date(v?.toDate ? v.toDate() : v));
const live = (a: any) => !['cancelled', 'declined'].includes(String(a.status));
const isReq = (a: any) => a.status === 'requested' || a.approvalStatus === 'pending';
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
const tag = (label: string, tone: 'warn' | 'accent' | 'plain' = 'plain') => <span key={label} className="w-fit truncate rounded-full px-2 py-0.5 text-[11px] font-semibold" style={tone === 'warn' ? { background: 'color-mix(in srgb, var(--warn, #b45309) 12%, transparent)', color: 'var(--warn, #b45309)' } : tone === 'accent' ? { background: 'color-mix(in srgb, var(--accent, #2e6f6a) 12%, transparent)', color: 'var(--accent, #2e6f6a)' } : { background: 'var(--soft, #efebe6)' }}>{label}</span>;

function priceOf(a: any, services: any[]) { const p = Number(a.price ?? a.totalPrice); if (Number.isFinite(p) && p > 0) return p; return Number(services.find((s) => s.id === a.serviceId)?.price) || 0; }
/** Long blocks (half a day or more, or all day) read as time off: "Bea off". */
function offOn(day: Date, blocks: any[], staff: any[]) {
  return blocks.filter((b) => { try { if (!isSameDay(safe(b.startTime), day)) return false; const end = b.endTime ? safe(b.endTime) : new Date(safe(b.startTime).getTime() + (Number(b.durationMin) || 60) * 60000); return b.allDay || differenceInMinutes(end, safe(b.startTime)) >= 240; } catch { return false; } })
    .map((b) => staff.find((s) => s.id === b.staffId)?.name).filter(Boolean) as string[];
}

export function MonthView({ date, appointments, services, staff, events = [], blocks = [], showMoney, isMobile, onOpenDay, onMonth, goal, onAddOn }: {
  date: Date; appointments: any[]; services: any[]; staff: any[]; events?: any[]; blocks?: any[]; showMoney: boolean; isMobile?: boolean; onOpenDay: (d: Date) => void; onMonth: (d: Date) => void; goal?: number | null; onAddOn?: (d: Date) => void;
}) {
  const m0 = startOfMonth(date); const first = startOfWeek(m0); const days = Array.from({ length: 42 }, (_, i) => addDays(first, i)); const weeks = days[35].getMonth() === m0.getMonth() ? 6 : 5;
  const cells = days.slice(0, weeks * 7).map((d) => { const info = dayInfo(d, appointments, staff); const list = appointments.filter((a) => { try { return live(a) && isSameDay(safe(a.startTime), d); } catch { return false; } });
    return { d, info, booked: list.reduce((n, a) => n + priceOf(a, services), 0), requests: list.filter(isReq).length, events: events.filter((e: any) => { try { return isSameDay(safe(e.date || e.startTime), d); } catch { return false; } }), off: offOn(d, blocks, staff) }; });
  const inMonth = cells.filter((c) => c.d.getMonth() === m0.getMonth());
  // "Plenty of space" means something only if it's rare: the three emptiest open days in the next three weeks.
  const roomy = new Set(cells.filter((c) => !c.info.closed && !isBefore(c.d, startOfDay(new Date())) && c.d <= addDays(new Date(), 21) && c.info.full < 0.3).sort((a, b) => a.info.full - b.info.full).slice(0, 3).map((c) => c.d.toDateString()));
  const totalVisits = inMonth.reduce((n, c) => n + c.info.visits, 0), totalBooked = inMonth.reduce((n, c) => n + c.booked, 0);
  const byWd = [0, 1, 2, 3, 4, 5, 6].map((w) => inMonth.filter((c) => c.d.getDay() === w && !c.info.closed)).map((cs) => cs.length ? cs.reduce((n, c) => n + c.info.full, 0) / cs.length : -1);
  const busiest = byWd.indexOf(Math.max(...byWd));
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 sm:p-4" aria-label={`${format(m0, 'MMMM yyyy')}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Previous month" onClick={() => onMonth(addMonths(m0, -1))} className="h-9 w-9 rounded-full" style={{ background: 'var(--soft)' }}>‹</button>
        <button type="button" aria-label="Next month" onClick={() => onMonth(addMonths(m0, 1))} className="h-9 w-9 rounded-full" style={{ background: 'var(--soft)' }}>›</button>
        <h2 className="px-1 text-[22px] font-light">{format(m0, 'MMMM yyyy')}</h2>
        <p className="text-[13px]" style={muted}>{totalVisits} visits{showMoney && totalBooked ? ` · ${money(totalBooked)} booked` : ''}{busiest >= 0 && byWd[busiest] > 0 ? ` · busiest: ${format(addDays(first, busiest), 'EEEE')}s` : ''}</p>
      </div>
      <div className="grid grid-cols-7 gap-1.5 px-1 text-[12px] font-semibold sm:gap-2" style={muted}>{[0, 1, 2, 3, 4, 5, 6].map((i) => <span key={i}>{format(addDays(first, i), isMobile ? 'EEEEE' : 'EEE')}</span>)}</div>
      <div className="grid flex-1 grid-cols-7 gap-1.5 sm:gap-2" style={{ gridAutoRows: isMobile ? '64px' : 'minmax(104px, 1fr)' }}>
        {cells.map(({ d, info, booked, requests, events: evs, off }) => { const out = d.getMonth() !== m0.getMonth(); const sel = isSameDay(d, date); const full = !info.closed && info.full >= 0.95; const past = isBefore(d, startOfDay(new Date()));
          const label = `${format(d, 'EEEE d MMMM')}${info.closed ? ', closed' : `, ${info.visits} visits, ${Math.round(info.full * 100)}% full`}${requests ? `, ${requests} awaiting an answer` : ''}`;
          return (
            <button key={d.toISOString()} type="button" onClick={() => onOpenDay(d)} aria-label={label} className="flex min-w-0 flex-col gap-1 overflow-hidden rounded-2xl p-1.5 text-left text-[12px] sm:p-2.5"
              style={{ background: info.closed ? 'var(--soft, #f3f0ec)' : 'var(--card, #fff)', border: `1px solid ${sel ? 'var(--ink, #1c1917)' : 'var(--line, #e7e2dc)'}`, boxShadow: sel ? 'inset 0 0 0 1px var(--ink, #1c1917)' : undefined, opacity: out ? 0.45 : 1 }}>
              <span className="flex items-baseline gap-1"><b className="text-[14px] font-semibold sm:text-[15px]">{format(d, 'd')}</b>{isToday(d) && <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>{isMobile ? '•' : 'Today'}</span>}{onAddOn && !isMobile && !out && !past && <span role="button" tabIndex={0} aria-label={`Add on ${format(d, 'EEEE d MMMM')}`} onClick={(e) => { e.stopPropagation(); onAddOn(d); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAddOn(d); } }} className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-[15px] leading-none" style={{ background: 'var(--soft, #efebe6)' }}>+</span>}</span>
              {info.closed ? <span style={muted}>{isMobile ? '' : 'Closed'}</span> : <>
                {!isMobile && <span>{info.visits} visit{info.visits === 1 ? '' : 's'}{showMoney && booked ? ` · ${money(booked)}` : ''}</span>}
                {isMobile && info.visits > 0 && <span className="text-[11px]">{info.visits}</span>}
                <span className="h-[5px] w-full overflow-hidden rounded-full" style={{ background: 'var(--soft, #efebe6)' }}><i className="block h-full rounded-full" style={{ width: `${Math.round(info.full * 100)}%`, background: full ? 'var(--warn, #b45309)' : 'var(--accent)' }} /></span>
                {!isMobile && <span className="flex flex-col gap-1">
                  {showMoney && goal && booked >= goal ? tag('Goal met', 'accent') : null}{full && tag('Full', 'warn')}{requests > 0 && tag(`${requests} request${requests === 1 ? '' : 's'}`, 'warn')}
                  {evs.slice(0, 1).map((e: any) => tag(e.title || e.name || 'Event', 'accent'))}{off.slice(0, 1).map((n) => tag(`${n} off`))}
                  {!past && roomy.has(d.toDateString()) && !requests && !evs.length && tag('Plenty of space')}
                </span>}
                {isMobile && (requests > 0 || evs.length > 0) && <span className="flex gap-0.5">{requests > 0 && <i className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--warn, #b45309)' }} />}{evs.length > 0 && <i className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}</span>}
              </>}
            </button>); })}
      </div>
      {!isMobile && <p className="text-[12px]" style={muted}>Tap a day to open its board.</p>}
    </section>);
}

export function WeekView({ date, appointments, clients, services, staff, events = [], blocks = [], isMobile, onOpenDay, onOpenVisit, onWeek, onAddOn }: {
  date: Date; appointments: any[]; clients: any[]; services: any[]; staff: any[]; events?: any[]; blocks?: any[]; isMobile?: boolean; onOpenDay: (d: Date) => void; onOpenVisit: (a: any) => void; onWeek: (d: Date) => void; onAddOn?: (d: Date) => void;
}) {
  const w0 = startOfWeek(date); const days = Array.from({ length: 7 }, (_, i) => addDays(w0, i));
  const name = (a: any) => clients.find((c) => c.id === a.clientId)?.name || a.clientName || 'Client';
  const svc = (a: any) => services.find((s) => s.id === a.serviceId);
  const prov = (a: any) => staff.find((s) => s.id === a.staffId);
  const row = (a: any) => { const st = stateOf(a, svc(a)); return (
    <button key={a.id} type="button" onClick={() => onOpenVisit(a)} className="flex w-full gap-2 rounded-xl p-2 text-left text-[12px] hover:bg-black/5" style={isReq(a) ? { background: 'color-mix(in srgb, var(--warn, #b45309) 8%, transparent)' } : undefined}>
      <span className="w-1 shrink-0 rounded-full" style={{ background: st.color }} />
      <span className="min-w-0"><span className="block" style={muted}>{format(safe(a.startTime), 'h:mm')}{prov(a) ? ` · ${prov(a).name}` : ''}</span><b className="block truncate text-[13px]">{name(a)}</b><span className="block truncate" style={muted}>{svc(a)?.name || a.serviceName || 'Service'}</span>{(isReq(a) || st.over > 0) && <span className="block font-semibold" style={{ color: 'var(--warn, #b45309)' }}>{isReq(a) ? 'Needs an answer' : st.word}</span>}</span>
    </button>); };
  const cols = days.map((d) => { const info = dayInfo(d, appointments, staff); const list = appointments.filter((a) => { try { return live(a) && isSameDay(safe(a.startTime), d); } catch { return false; } }).sort((x, y) => safe(x.startTime).getTime() - safe(y.startTime).getTime());
    const evs = events.filter((e: any) => { try { return isSameDay(safe(e.date || e.startTime), d); } catch { return false; } }); return { d, info, list, evs, off: offOn(d, blocks, staff) }; });
  const head = (c: any) => (
    <button type="button" onClick={() => onOpenDay(c.d)} className="flex w-full flex-col gap-1 rounded-xl p-2 text-left" aria-label={`Open ${format(c.d, 'EEEE d MMMM')}`} style={isSameDay(c.d, date) ? { background: 'var(--card, #fff)', outline: '1.5px solid var(--ink, #1c1917)' } : undefined}>
      <span className="flex items-baseline gap-1.5"><span className="text-[12px]" style={muted}>{format(c.d, 'EEE')}</span><b className="text-[17px] font-semibold">{format(c.d, 'd')}</b>{isToday(c.d) && <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>TODAY</span>}{onAddOn && !isBefore(c.d, startOfDay(new Date())) && <span role="button" tabIndex={0} aria-label={`Add on ${format(c.d, 'EEEE d MMMM')}`} onClick={(e) => { e.stopPropagation(); onAddOn(c.d); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAddOn(c.d); } }} className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-[15px] leading-none" style={{ background: 'var(--soft, #efebe6)' }}>+</span>}</span>
      {c.info.closed ? <span className="text-[12px]" style={muted}>Closed</span> : <><span className="text-[12px]" style={muted}>{c.info.visits} visit{c.info.visits === 1 ? '' : 's'} · {Math.round(c.info.full * 100)}%</span><span className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--soft)' }}><i className="block h-full rounded-full" style={{ width: `${Math.round(c.info.full * 100)}%`, background: c.info.full >= 0.95 ? 'var(--warn, #b45309)' : 'var(--accent)' }} /></span></>}
      {(c.evs.length > 0 || c.off.length > 0) && <span className="flex flex-wrap gap-1">{c.evs.slice(0, 1).map((e: any) => tag(e.title || e.name || 'Event', 'accent'))}{c.off.slice(0, 2).map((n: string) => tag(`${n} off`))}</span>}
    </button>);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4" aria-label={`Week of ${format(w0, 'd MMMM')}`}>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous week" onClick={() => onWeek(addDays(w0, -7))} className="h-9 w-9 rounded-full" style={{ background: 'var(--soft)' }}>‹</button>
        <button type="button" aria-label="Next week" onClick={() => onWeek(addDays(w0, 7))} className="h-9 w-9 rounded-full" style={{ background: 'var(--soft)' }}>›</button>
        <h2 className="px-1 text-[20px] font-light sm:text-[22px]">{isMobile ? `${format(w0, 'd')}–${format(addDays(w0, 6), 'd MMM')}` : `${format(w0, 'd MMM')} – ${format(addDays(w0, 6), 'd MMM yyyy')}`}</h2>
        <p className="text-[13px]" style={muted}>{cols.reduce((n, c) => n + c.list.length, 0)} visits</p>
      </div>
      {isMobile ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto pb-24">{cols.map((c) => (<div key={c.d.toISOString()} className="rounded-2xl p-1" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }}>{head(c)}{c.list.length ? c.list.map(row) : !c.info.closed && <p className="px-2 pb-2 text-[12px]" style={muted}>Nothing booked</p>}</div>))}</div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-7 gap-2 overflow-hidden">{cols.map((c) => (
          <div key={c.d.toISOString()} className="flex min-h-0 min-w-0 flex-col rounded-2xl p-1" style={{ background: c.info.closed ? 'var(--soft, #f3f0ec)' : 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }}>
            {head(c)}<div className="min-h-0 flex-1 space-y-0.5 overflow-auto">{c.list.map(row)}</div>
          </div>))}</div>
      )}
    </section>);
}
