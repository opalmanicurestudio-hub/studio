'use client';
// src/components/planner/PlannerHeader.tsx — THE PLANNER'S HEADER, in about 100px instead of ~330.
//   Row 1: the date as the hero (tap → the date picker) · ‹ › by day · the day's figures (tap → weekly numbers) ·
//          Needs you (requests, cancellations, events today, bills due) · the view controls · Waitlist · Scan · ⋯ · + Book
//   Row 2: the day ribbon — each day of the week with the shape of its day, who's working, and how full it is
//          (amber when full, quiet when closed); ‹ › by week.
// The DATE PICKER: quick jumps (Today · next same weekday · +1/+2/+4/+6 weeks · +3 months), two months as a heat
// calendar (shade = how full, amber = full, grey = closed, number = visits), "Go to…" in plain words, coming up, most
// room. A popover on desktop, a bottom sheet on phones. Keys: T today · ←/→ day · Shift+←/→ week · G go to a date.
import * as React from 'react';
import { format, addDays, addWeeks, addMonths, startOfWeek, startOfMonth, endOfMonth, isSameDay, isToday, differenceInMinutes, startOfDay, isBefore } from 'date-fns';

const safe = (v: any) => (v instanceof Date ? v : new Date(v?.toDate ? v.toDate() : v));
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const toMin = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const AV = ['#2e6f6a', '#7c5a3c', '#5b5bd6', '#b45309', '#be185d', '#0f766e'];

export type DayInfo = { date: Date; closed: boolean; visits: number; full: number; shape: number[]; working: any[] };
/** One day's picture: who works, how full (booked minutes ÷ working minutes), and its shape across six slices. */
export function dayInfo(date: Date, appointments: any[], staff: any[]): DayInfo {
  const k = DAY_KEYS[date.getDay()]; const working = staff.filter((s) => { const d = s.availability?.week?.[k]; return d && d.enabled !== false && d.start && d.end; });
  const d0 = startOfDay(date); const visits = appointments.filter((a) => { try { return isSameDay(safe(a.startTime), date) && !['cancelled', 'declined'].includes(String(a.status)); } catch { return false; } });
  if (!working.length) return { date, closed: true, visits: visits.length, full: 0, shape: [], working };
  const start = Math.min(...working.map((s) => toMin(s.availability.week[k].start))), end = Math.max(...working.map((s) => toMin(s.availability.week[k].end)));
  const capacity = working.reduce((n, s) => n + Math.max(0, toMin(s.availability.week[k].end) - toMin(s.availability.week[k].start)), 0);
  const slices = 6, w = Math.max(1, (end - start) / slices); const shape = new Array(slices).fill(0); let booked = 0;
  for (const a of visits) { const s = Math.max(start, differenceInMinutes(safe(a.startTime), d0)), e = Math.min(end, differenceInMinutes(safe(a.endTime || a.startTime), d0)); if (e <= s) continue; booked += e - s;
    for (let i = 0; i < slices; i++) { const a0 = start + i * w, a1 = a0 + w; const ov = Math.max(0, Math.min(e, a1) - Math.max(s, a0)); shape[i] += ov; } }
  return { date, closed: false, visits: visits.length, full: capacity ? Math.min(1, booked / capacity) : 0, shape: shape.map((m) => Math.min(1, m / (w * working.length))), working };
}

/** "Go to…" in plain words: today · tomorrow · fri / next friday · in 3 weeks · +2w · 14 nov · nov 14 · 2026-11-14. */
export function parseGoTo(text: string, from: Date): Date | null {
  const t = text.trim().toLowerCase(); if (!t) return null; const today = startOfDay(new Date());
  if (t === 'today' || t === 'now') return today; if (t === 'tomorrow') return addDays(today, 1); if (t === 'yesterday') return addDays(today, -1);
  const wd = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; const m1 = t.match(/^(next |this )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/);
  if (m1) { const want = wd.indexOf(m1[2]); let d = addDays(today, 1); while (d.getDay() !== want) d = addDays(d, 1); if (m1[1] === 'next ' && differenceInMinutes(d, today) < 7 * 1440 && d.getDay() <= today.getDay()) return d; return d; }
  const m2 = t.match(/^(?:in\s+|\+)\s*(\d+)\s*(d|day|days|w|wk|wks|week|weeks|m|mo|month|months)$/);
  if (m2) { const n = Number(m2[1]); const u = m2[2][0]; return u === 'd' ? addDays(from, n) : u === 'w' ? addWeeks(from, n) : addMonths(from, n); }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const m3 = t.match(/^(\d{1,2})\s*([a-z]{3})[a-z]*\.?\s*(\d{4})?$/) || null; const m4 = t.match(/^([a-z]{3})[a-z]*\.?\s*(\d{1,2})(?:,?\s*(\d{4}))?$/) || null;
  const mk = (dd: number, mi: number, yy?: string) => { if (mi < 0 || dd < 1 || dd > 31) return null; let d = new Date(yy ? Number(yy) : today.getFullYear(), mi, dd); if (!yy && isBefore(d, today)) d = new Date(today.getFullYear() + 1, mi, dd); return d; };
  if (m3) return mk(Number(m3[1]), months.indexOf(m3[2]), m3[3]); if (m4) return mk(Number(m4[2]), months.indexOf(m4[1]), m4[3]);
  const m5 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m5) return new Date(Number(m5[1]), Number(m5[2]) - 1, Number(m5[3]));
  return null;
}

const shade = (d: DayInfo) => d.closed ? 'var(--soft, #f3f0ec)' : d.full >= 0.95 ? '#f1dcc4' : d.visits === 0 ? 'transparent' : `color-mix(in srgb, var(--accent, #2e6f6a) ${Math.round(10 + d.full * 40)}%, var(--card, #fff))`;

export function DatePicker({ date, onPick, onClose, appointments, staff, events = [], isMobile, onFindTime }: { date: Date; onPick: (d: Date) => void; onClose: () => void; appointments: any[]; staff: any[]; events?: any[]; isMobile?: boolean; onFindTime?: () => void }) {
  const [month, setMonth] = React.useState(startOfMonth(date)); const [q, setQ] = React.useState(''); const [preview, setPreview] = React.useState<Date | null>(null);
  const parsed = q ? parseGoTo(q, date) : null;
  const jumps: [string, Date][] = [['Today', startOfDay(new Date())], [`Next ${format(date, 'EEE')}`, addWeeks(date, 1)], ['+2 weeks', addWeeks(date, 2)], ['+4 weeks', addWeeks(date, 4)], ['+6 weeks', addWeeks(date, 6)], ['+3 months', addMonths(date, 3)]];
  const months = isMobile ? [month] : [month, addMonths(month, 1)];
  const ahead = React.useMemo(() => Array.from({ length: 28 }, (_, i) => dayInfo(addDays(startOfDay(new Date()), i), appointments, staff)), [appointments, staff]);
  const room = ahead.filter((d) => !d.closed && d.date > new Date()).sort((a, b) => a.full - b.full).slice(0, 2);
  const fullDays = ahead.filter((d) => !d.closed && d.full >= 0.95).slice(0, 2);
  const upcomingEvents = events.filter((e: any) => { try { const d = safe(e.date || e.startTime); return d >= startOfDay(new Date()) && d <= addDays(new Date(), 28); } catch { return false; } }).slice(0, 3);
  const pick = (d: Date) => { onPick(startOfDay(d)); onClose(); };
  const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
  const cal = (m: Date) => { const first = startOfWeek(startOfMonth(m)); const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i)).filter((d, i) => i < 35 || d.getMonth() === m.getMonth());
    return (<div key={m.toISOString()} className="min-w-0 flex-1"><p className="mb-2 text-[15px] font-semibold">{format(m, 'MMMM yyyy')}</p>
      <div className="grid gap-1 text-center text-[11px] font-semibold" style={{ ...muted, gridTemplateColumns: `repeat(7, ${isMobile ? 'minmax(0, 1fr)' : '40px'})` }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <span key={i}>{x}</span>)}</div>
      <div className="mt-1 grid gap-1" style={{ gridTemplateColumns: `repeat(7, ${isMobile ? 'minmax(0, 1fr)' : '40px'})` }}>{cells.map((d) => { const inMonth = d.getMonth() === m.getMonth(); if (!inMonth) return <span key={d.toISOString()} />; const info = dayInfo(d, appointments, staff); const sel = isSameDay(d, date); const hint = preview && isSameDay(d, preview);
        return (<button key={d.toISOString()} type="button" onClick={() => pick(d)} aria-label={`${format(d, 'EEEE d MMMM')}${info.closed ? ', closed' : `, ${info.visits} visits${info.full >= 0.95 ? ', full' : ''}`}`}
          className="flex flex-col items-center justify-center rounded-xl text-[13px]" style={{ height: isMobile ? 44 : 40, background: sel ? 'var(--ink, #1c1917)' : shade(info), color: sel ? '#fff' : info.full >= 0.95 ? '#8a3f06' : info.closed ? 'var(--muted, #6b635c)' : 'inherit', outline: hint ? '1.5px dashed var(--accent, #2e6f6a)' : isToday(d) && !sel ? '1.5px solid var(--accent, #2e6f6a)' : undefined }}>
          <span>{format(d, 'd')}</span><span className="text-[9px] opacity-75">{isToday(d) ? 'today' : info.closed ? '' : info.full >= 0.95 ? 'full' : info.visits || ''}</span></button>); })}</div></div>); };
  const body = (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="flex flex-col gap-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">{jumps.map(([l, d]) => <button key={l} type="button" onClick={() => pick(d)} onMouseEnter={() => { setPreview(d); setMonth(startOfMonth(d) > addMonths(month, 1) || startOfMonth(d) < month ? startOfMonth(d) : month); }} onMouseLeave={() => setPreview(null)} className="h-9 shrink-0 rounded-full border px-3 text-[13px] font-semibold" style={{ borderColor: 'var(--line, #e7e2dc)', background: 'var(--card, #fff)' }}>{l}</button>)}</div>
        <div className="flex items-center gap-2"><button type="button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} className="h-8 w-8 rounded-full" style={{ background: 'var(--soft, #efebe6)' }}>‹</button><button type="button" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} className="h-8 w-8 rounded-full" style={{ background: 'var(--soft, #efebe6)' }}>›</button></div>
        <div className="flex w-full gap-6">{months.map(cal)}</div>
        <p className="text-[11px]" style={muted}>Shade = how full · amber = full · grey = closed · number = visits</p>
      </div>
      <aside className="flex min-w-[250px] flex-col gap-3 text-[13px] sm:border-l sm:pl-5" style={{ borderColor: 'var(--line, #e7e2dc)' }}>
        <form onSubmit={(e) => { e.preventDefault(); if (parsed) pick(parsed); }}><input autoFocus={!isMobile} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to… “fri”, “14 Nov”" aria-label="Go to a date" className="h-11 w-full rounded-xl border px-3 text-[14px]" style={{ borderColor: 'var(--line, #e7e2dc)' }} />
          {q && <p className="mt-1 text-[12px]" style={parsed ? { color: 'var(--accent)' } : muted}>{parsed ? <>Enter → {format(parsed, 'EEEE d MMMM yyyy')}</> : 'Try “fri”, “next tue”, “14 nov”, “in 2 weeks”'}</p>}</form>
        {(upcomingEvents.length > 0 || fullDays.length > 0) && <div><p className="mb-1 font-semibold">Coming up</p>{upcomingEvents.map((e: any) => <button key={e.id} type="button" onClick={() => pick(safe(e.date || e.startTime))} className="block text-left">{format(safe(e.date || e.startTime), 'EEE d')} · {e.title || e.name || 'Event'}</button>)}{fullDays.map((d) => <button key={d.date.toISOString()} type="button" onClick={() => pick(d.date)} className="block text-left">{format(d.date, 'EEE d')} · fully booked</button>)}</div>}
        {onFindTime && <button type="button" onClick={() => { onClose(); onFindTime(); }} className="h-10 rounded-full text-[14px] font-semibold" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>Find a time…</button>}
        {room.length > 0 && <div><p className="mb-1 font-semibold">Most room</p>{room.map((d) => <button key={d.date.toISOString()} type="button" onClick={() => pick(d.date)} className="block text-left font-semibold" style={{ color: 'var(--accent)' }}>{format(d.date, 'EEE d MMM')} · {d.visits} visit{d.visits === 1 ? '' : 's'}</button>)}</div>}
      </aside>
    </div>);
  return (
    <div role="dialog" aria-label="Go to a date" className={`fixed inset-0 z-50 flex ${isMobile ? 'items-end' : 'items-start justify-start'}`} style={{ background: isMobile ? 'rgba(28,25,23,.38)' : 'transparent' }} onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className={isMobile ? 'max-h-[88dvh] w-full overflow-auto rounded-t-[28px] p-4 pb-8' : 'ml-4 mt-[120px] rounded-[26px] p-5 sm:ml-24'} style={{ background: 'var(--card, #fff)', boxShadow: isMobile ? undefined : '0 24px 60px rgba(28,25,23,.18)', border: isMobile ? undefined : '1px solid var(--line, #e7e2dc)' }} onClick={(e) => e.stopPropagation()}>
        {isMobile && <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: 'var(--line, #d6d3d1)' }} />}
        {body}
      </div>
    </div>);
}

export type NeedsYouItem = { key: string; label: string; onClick: () => void; tone?: 'warn' | 'info' };
export function PlannerHeader({ date, onDate, appointments, staff, events, figures, onFigures, needsYou, onBook, onScan, onWaitlist, waitlistCount, moreItems, viewControls, isMobile, onFindTime, bookMenu }: {
  onFindTime?: () => void; bookMenu?: [string, () => void][];   // + Book opens these (appointment, group, several providers, event, …)
  date: Date; onDate: (d: Date) => void; appointments: any[]; staff: any[]; events?: any[];
  figures: { visits: number; booked?: number | null; goal?: number | null }; onFigures?: () => void; needsYou: NeedsYouItem[];
  onBook: () => void; onScan: () => void; onWaitlist: () => void; waitlistCount: number; moreItems: [string, () => void][]; viewControls?: React.ReactNode; isMobile?: boolean;
}) {
  const [picker, setPicker] = React.useState(false); const [bookOpen, setBookOpen] = React.useState(false); const [needsOpen, setNeedsOpen] = React.useState(false); const [moreOpen, setMoreOpen] = React.useState(false);
  const week = React.useMemo(() => Array.from({ length: 7 }, (_, i) => dayInfo(addDays(startOfWeek(date), i), appointments, staff)), [date, appointments, staff]);
  const today = week.find((d) => isSameDay(d.date, date)) || dayInfo(date, appointments, staff);
  // Keys: T today · ←/→ day · Shift+←/→ week · G the date picker (not while typing).
  React.useEffect(() => { const h = (e: KeyboardEvent) => { const el = e.target as HTMLElement; if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 't' || e.key === 'T') onDate(startOfDay(new Date())); else if (e.key === 'ArrowLeft') onDate(e.shiftKey ? addWeeks(date, -1) : addDays(date, -1)); else if (e.key === 'ArrowRight') onDate(e.shiftKey ? addWeeks(date, 1) : addDays(date, 1)); else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); setPicker(true); } else return; };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [date, onDate]);
  const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties; const soft = { background: 'var(--soft, #efebe6)' } as React.CSSProperties;
  const iconBtn = 'relative inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2.5 text-[13px] font-semibold';
  const badge = (n: number) => n > 0 ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white" style={{ background: 'var(--warn, #b45309)' }}>{n > 99 ? '99+' : n}</span> : null;
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const warnCount = needsYou.length;
  return (
    <header className="shrink-0 border-b px-3 pb-2 pt-2.5 sm:px-6" style={{ borderColor: 'var(--line, #e7e2dc)', background: 'linear-gradient(var(--paper, #faf8f5), var(--paper, #f7f5f2))' }}>
      <div className="flex items-center gap-2 sm:gap-3">
        <button type="button" onClick={() => setPicker(true)} aria-label={`${format(date, 'EEEE d MMMM yyyy')} — choose a date`} className="flex items-baseline gap-2 text-left">
          <span className="text-[34px] font-light leading-none sm:text-[40px]">{format(date, 'd')}</span>
          <span className="flex flex-col leading-tight"><span className="text-[15px] font-semibold sm:text-[17px]">{format(date, 'EEEE')}</span><span className="text-[11px] sm:text-[12px]" style={muted}>{format(date, 'MMMM yyyy')}{isToday(date) ? ' · Today' : ''} ▾</span></span>
        </button>
        <span className="hidden gap-1 sm:inline-flex"><button type="button" aria-label="Previous day" onClick={() => onDate(addDays(date, -1))} className={iconBtn} style={soft}>‹</button>{!isToday(date) && <button type="button" onClick={() => onDate(startOfDay(new Date()))} className={iconBtn} style={soft}>Today</button>}<button type="button" aria-label="Next day" onClick={() => onDate(addDays(date, 1))} className={iconBtn} style={soft}>›</button></span>
        <button type="button" onClick={onFigures} disabled={!onFigures} className="hidden items-center gap-4 rounded-full px-2 py-1 text-[13px] md:flex" title={onFigures ? 'Weekly numbers' : undefined}>
          <span><b className="text-[15px]">{figures.visits}</b> <span style={muted}>visit{figures.visits === 1 ? '' : 's'}</span></span>
          {figures.booked != null && <span><b className="text-[15px]">{money(figures.booked)}</b> <span style={muted}>booked{figures.goal ? ` · goal ${money(figures.goal)}` : ''}</span></span>}
          {!today.closed && <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: 'var(--line, #e7e2dc)' }}><i className="block h-full rounded-full" style={{ width: `${Math.round(today.full * 100)}%`, background: today.full >= 0.95 ? 'var(--warn, #b45309)' : 'var(--accent)' }} /></span><span style={muted}>{Math.round(today.full * 100)}% full</span></span>}
        </button>
        <span className="ml-auto" />
        {warnCount > 0 && <span className="relative"><button type="button" onClick={() => setNeedsOpen((v) => !v)} aria-expanded={needsOpen} className={iconBtn} style={{ background: 'color-mix(in srgb, var(--warn, #b45309) 12%, transparent)', color: 'var(--warn, #b45309)' }}>● {isMobile ? warnCount : `Needs you · ${warnCount}`}</button>
          {needsOpen && <div role="menu" className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl text-[14px]" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)', boxShadow: '0 12px 30px rgba(0,0,0,.12)' }}>{needsYou.map((n) => <button key={n.key} type="button" role="menuitem" onClick={() => { setNeedsOpen(false); n.onClick(); }} className="block w-full px-4 py-3 text-left hover:bg-black/5" style={n.tone === 'warn' ? { color: 'var(--warn, #b45309)' } : undefined}>{n.label}</button>)}</div>}</span>}
        <span className="hidden sm:contents">{viewControls}</span>
        <button type="button" onClick={onWaitlist} aria-label="Waiting list" title="Waiting list" className={iconBtn} style={soft}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 2h12M6 22h12M7 2c0 5 10 5 10 10S7 17 7 22M17 2c0 5-10 5-10 10s10 5 10 10" /></svg>{badge(waitlistCount)}</button>
        <button type="button" onClick={onScan} aria-label="Scan check-in code" title="Scan check-in code" className={iconBtn} style={soft}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" /></svg></button>
        <span className="relative"><button type="button" onClick={() => setMoreOpen((v) => !v)} aria-label="More" aria-expanded={moreOpen} className={iconBtn} style={soft}>⋯</button>
          {moreOpen && <div role="menu" className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-2xl text-[14px]" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)', boxShadow: '0 12px 30px rgba(0,0,0,.12)' }}>{moreItems.map(([l, f]) => <button key={l} type="button" role="menuitem" onClick={() => { setMoreOpen(false); f(); }} className="block w-full px-4 py-3 text-left hover:bg-black/5">{l}</button>)}</div>}</span>
        <span className="relative"><button type="button" onClick={() => (bookMenu?.length ? setBookOpen((v) => !v) : onBook())} aria-label="Book" aria-expanded={bookOpen} aria-haspopup={bookMenu?.length ? 'menu' : undefined} className="inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>{isMobile ? '+' : '+ Book ▾'}</button>
          {bookOpen && bookMenu && (isMobile
            ? <div role="dialog" aria-label="Book" className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(28,25,23,.38)' }} onClick={() => setBookOpen(false)}><div className="w-full rounded-t-[28px] p-2 pb-8" style={{ background: 'var(--card, #fff)' }} onClick={(e) => e.stopPropagation()}>
                <div className="mx-auto my-2 h-1 w-10 rounded-full" style={{ background: 'var(--line, #d6d3d1)' }} />{bookMenu.map(([l, f]) => <button key={l} type="button" onClick={() => { setBookOpen(false); f(); }} className="block w-full rounded-2xl px-4 py-3.5 text-left text-[16px] hover:bg-black/5">{l}</button>)}</div></div>
            : <div role="menu" className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl text-[14px]" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)', boxShadow: '0 12px 30px rgba(0,0,0,.12)' }}>{bookMenu.map(([l, f], i) => <button key={l} type="button" role="menuitem" onClick={() => { setBookOpen(false); f(); }} className="block w-full px-4 py-3 text-left hover:bg-black/5" style={i === 4 ? { borderTop: '1px solid var(--line, #e7e2dc)' } : undefined}>{l}</button>)}</div>)}</span>
      </div>
      {/* The day ribbon */}
      <div className="mt-2 grid items-stretch gap-1 sm:gap-1.5" style={{ gridTemplateColumns: isMobile ? 'repeat(7, minmax(0, 1fr))' : '28px repeat(7, minmax(0, 1fr)) 28px' }}
        onTouchStart={(e) => { (e.currentTarget as any)._x = e.touches[0].clientX; }} onTouchEnd={(e) => { const x0 = (e.currentTarget as any)._x; if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 60) onDate(addWeeks(date, dx < 0 ? 1 : -1)); }}>
        {!isMobile && <button type="button" aria-label="Previous week" onClick={() => onDate(addWeeks(date, -1))} className="rounded-full" style={soft}>‹</button>}
        {week.map((d) => { const sel = isSameDay(d.date, date); const full = !d.closed && d.full >= 0.95;
          return (<button key={d.date.toISOString()} type="button" onClick={() => onDate(d.date)} aria-pressed={sel} aria-label={`${format(d.date, 'EEEE d MMMM')}${d.closed ? ', closed' : `, ${d.visits} visits, ${Math.round(d.full * 100)}% full`}`}
            className="flex min-w-0 flex-col gap-1 rounded-2xl px-1.5 py-1.5 text-left sm:px-2.5" style={sel ? { background: 'var(--card, #fff)', boxShadow: '0 2px 10px rgba(0,0,0,.08)', outline: '1.5px solid var(--ink, #1c1917)' } : undefined}>
            <span className="flex items-baseline justify-center gap-1 sm:justify-start"><span className="text-[11px]" style={muted}>{isMobile ? format(d.date, 'EEEEE') : format(d.date, 'EEE')}</span><b className="text-[16px] font-semibold" style={d.closed ? muted : undefined}>{format(d.date, 'd')}</b>
              {!isMobile && (isToday(d.date) ? <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>TODAY</span> : full ? <span className="text-[10px] font-semibold" style={{ color: 'var(--warn, #b45309)' }}>FULL</span> : null)}</span>
            {d.closed ? <span className="text-center text-[11px] sm:text-left" style={muted}>{isMobile ? '—' : 'Closed'}</span>
              : isMobile ? <span className="mx-auto h-[3px] w-5 overflow-hidden rounded-full" style={{ background: 'var(--line, #e7e2dc)' }}><i className="block h-full rounded-full" style={{ width: `${Math.round(d.full * 100)}%`, background: full ? 'var(--warn, #b45309)' : 'var(--accent)' }} /></span>
              : <><span className="flex h-[16px] items-end gap-[2px]" aria-hidden="true">{d.shape.map((v, i) => <i key={i} className="flex-1 rounded-[2px]" style={{ height: `${Math.max(8, Math.round(v * 100))}%`, background: full ? '#e8c9a4' : v > 0 ? 'color-mix(in srgb, var(--accent, #2e6f6a) 55%, transparent)' : 'var(--line, #e7e2dc)' }} />)}</span>
                <span className="flex">{d.working.slice(0, 4).map((s, i) => <span key={s.id} title={s.name} className="-ml-1.5 h-[18px] w-[18px] rounded-full border-2 text-center text-[9px] font-semibold leading-[14px] text-white first:ml-0" style={{ background: AV[Math.max(0, staff.indexOf(s)) % AV.length], borderColor: 'var(--paper, #faf8f5)' }}>{String(s.name || '?').charAt(0)}</span>)}{d.working.length > 4 && <span className="ml-1 text-[10px]" style={muted}>+{d.working.length - 4}</span>}</span></>}
          </button>); })}
        {!isMobile && <button type="button" aria-label="Next week" onClick={() => onDate(addWeeks(date, 1))} className="rounded-full" style={soft}>›</button>}
      </div>
      {picker && <DatePicker date={date} onPick={onDate} onClose={() => setPicker(false)} appointments={appointments} staff={staff} events={events} isMobile={isMobile} onFindTime={onFindTime} />}
    </header>);
}
