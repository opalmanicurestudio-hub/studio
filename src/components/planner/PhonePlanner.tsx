'use client';
// src/components/planner/PhonePlanner.tsx — THE PLANNER ON A PHONE (approved design, canvas boards 1–4). A slim header
// (the date, the day's count, who you're looking at), one "needs you" line instead of a row of badges, and a bar along
// the bottom: Now · Day · + · Week · More. "+" opens the Book sheet; More holds what needs an answer (with Accept and
// Decline right there) and everything that used to crowd the header: waiting list, scan, this week, bills, month,
// view settings.
import * as React from 'react';
import { format, addDays, isToday, startOfDay } from 'date-fns';
import { DatePicker } from '@/components/planner/PlannerHeader';

const safe = (v: any) => (v instanceof Date ? v : new Date(v?.toDate ? v.toDate() : v));
const muted = { color: 'var(--muted, #6d7075)' } as React.CSSProperties;
const AMBER = 'var(--warn, #b45309)';
export type PhoneView = 'now' | 'grid' | 'list' | 'week' | 'month';
export type Row = { key: string; label: string; onClick: () => void; tone?: 'warn' };

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(22,23,26,.38)' }} onClick={onClose}>
      <div className="max-h-[86dvh] w-full overflow-y-auto rounded-t-[28px] px-2 pt-2" style={{ background: 'var(--card, #fff)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-2 mt-1 h-1 w-10 rounded-full" style={{ background: 'var(--line, #ececee)' }} />
        {children}
      </div>
    </div>);
}

/** The header: the date (tap for any date, swipe for the next or last day), the day in one line, and who you're viewing. */
export function PhoneHeader({ date, onDate, visits, booked, providers, provider, onProvider, appointments, staff, events, onFindTime, dayToggle }: {
  date: Date; onDate: (d: Date) => void; visits: number; booked: number | null; providers: any[]; provider: string; onProvider: (id: string) => void;
  appointments: any[]; staff: any[]; events?: any[]; onFindTime?: () => void; dayToggle?: React.ReactNode;
}) {
  const [picker, setPicker] = React.useState(false); const [who, setWho] = React.useState(false); const x0 = React.useRef<number | null>(null);
  const current = provider === 'all' ? null : providers.find((p) => p.id === provider);
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  return (
    <header className="shrink-0 px-4 pb-2" style={{ background: 'var(--paper, #fff)', paddingTop: 'max(10px, env(safe-area-inset-top))' }}
      onTouchStart={(e) => { x0.current = e.touches[0].clientX; }} onTouchEnd={(e) => { if (x0.current == null) return; const dx = e.changedTouches[0].clientX - x0.current; x0.current = null; if (Math.abs(dx) > 70) onDate(addDays(date, dx < 0 ? 1 : -1)); }}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setPicker(true)} aria-label={`${format(date, 'EEEE d MMMM yyyy')}, choose a date`} className="min-w-0 text-left">
          <span className="block truncate text-[24px] font-light leading-tight">{format(date, 'EEEE d')}</span>
          <span className="block truncate text-[13px]" style={muted}>{isToday(date) ? 'Today' : format(date, 'MMMM yyyy')} · {visits} visit{visits === 1 ? '' : 's'}{booked != null && booked > 0 ? ` · ${money(booked)} booked` : ''}</span>
        </button>
        <span className="ml-auto" />
        {!isToday(date) && <button type="button" onClick={() => onDate(startOfDay(new Date()))} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft)' }}>Today</button>}
        {dayToggle}
        {providers.length > 1 && <button type="button" onClick={() => setWho(true)} aria-label="Whose day to show" className="h-9 max-w-[42vw] truncate rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft)' }}>{current ? current.name : 'Everyone'} ▾</button>}
      </div>
      {who && <Sheet label="Whose day" onClose={() => setWho(false)}>
        <p className="px-4 pb-2 text-[13px]" style={muted}>Show</p>
        {[{ id: 'all', name: 'Everyone' }, ...providers].map((p: any) => <button key={p.id} type="button" aria-pressed={provider === p.id} onClick={() => { onProvider(p.id); setWho(false); }} className="flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-[16px] hover:bg-black/5"><span>{p.name}</span>{provider === p.id && <span aria-hidden="true">✓</span>}</button>)}
      </Sheet>}
      {picker && <DatePicker date={date} onPick={onDate} onClose={() => setPicker(false)} appointments={appointments} staff={staff} events={events} isMobile onFindTime={onFindTime} />}
    </header>);
}

/** One line for everything waiting on you. Tap it to see them. */
export function NeedsYouLine({ requests, others, onOpen }: { requests: number; others: Row[]; onOpen: () => void }) {
  const total = requests + others.length; if (!total) return null;
  const parts = [requests ? `${requests} booking request${requests === 1 ? '' : 's'}` : '', ...others.slice(0, 2).map((o) => o.label.charAt(0).toLowerCase() + o.label.slice(1))].filter(Boolean);
  return (
    <button type="button" onClick={onOpen} className="mx-3 mb-2 flex items-center gap-2 rounded-2xl px-4 py-3 text-left text-[14px]" style={{ background: 'color-mix(in srgb, #b45309 9%, transparent)', color: AMBER }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: AMBER }} />
      <span className="min-w-0 flex-1 truncate"><b className="font-semibold">{total} need{total === 1 ? 's' : ''} you:</b> {parts.join(', ')}</span><span aria-hidden="true">›</span>
    </button>);
}

/** Now · Day · + · Week · More. */
export function PhoneBottomBar({ view, onView, onBook, onMore, moreBadge }: { view: PhoneView; onView: (v: PhoneView) => void; onBook: () => void; onMore: () => void; moreBadge: number }) {
  const tab = (v: PhoneView | 'more', label: string, on: boolean, click: () => void, icon: React.ReactNode) => (
    <button key={label} type="button" onClick={click} aria-current={on ? 'page' : undefined} className="relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold" style={{ color: on ? 'var(--ink, #16171a)' : 'var(--muted, #6d7075)' }}>
      {icon}<span>{label}</span>
      {v === 'more' && moreBadge > 0 && <span className="absolute right-[calc(50%-18px)] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] text-white" style={{ background: AMBER }}>{moreBadge > 9 ? '9+' : moreBadge}</span>}
    </button>);
  const I = (d: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
  return (
    <nav aria-label="Planner" className="fixed inset-x-0 bottom-0 z-40 flex items-center border-t px-2" style={{ background: 'var(--paper, #fff)', borderColor: 'var(--line, #ececee)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {tab('now', 'Now', view === 'now', () => onView('now'), I('M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'))}
      {tab('grid', 'Day', view === 'grid' || view === 'list', () => onView(view === 'list' ? 'list' : 'grid'), I('M4 5h16M4 10h16M4 15h10M4 20h7'))}
      <span className="flex flex-1 justify-center"><button type="button" onClick={onBook} aria-label="Book" className="flex h-12 w-12 items-center justify-center rounded-full text-[26px] font-light leading-none" style={{ background: 'var(--ink, #16171a)', color: 'var(--paper, #fff)' }}>+</button></span>
      {tab('week', 'Week', view === 'week' || view === 'month', () => onView('week'), I('M4 6h16v14H4zM4 10h16M9 6V3M15 6V3'))}
      {tab('more', 'More', false, onMore, I('M5 12h.01M12 12h.01M19 12h.01'))}
    </nav>);
}

/** The Book sheet: a visit, find a time, block time, then the other kinds. */
export function BookSheet({ onClose, onVisit, onFind, onBlock, others }: { onClose: () => void; onVisit: () => void; onFind: () => void; onBlock: () => void; others: [string, () => void][] }) {
  const go = (f: () => void) => () => { onClose(); f(); };
  const big = (title: string, sub: string, f: () => void) => <button type="button" onClick={go(f)} className="block w-full rounded-2xl px-4 py-3.5 text-left hover:bg-black/5"><span className="block text-[17px]">{title}</span><span className="block text-[13px]" style={muted}>{sub}</span></button>;
  return (
    <Sheet label="Book" onClose={onClose}>
      <p className="px-4 pb-1 text-[22px] font-light">Book</p>
      {big('A visit', 'Client, service, time', onVisit)}
      {big('Find a time', 'The next openings for a service', onFind)}
      {big('Block time', 'Breaks, events, time off', onBlock)}
      {others.length > 0 && <><p className="px-4 pb-1 pt-3 text-[13px]" style={muted}>Other bookings</p>
        <div className="flex flex-wrap gap-2 px-4 pb-2">{others.map(([l, f]) => <button key={l} type="button" onClick={go(f)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>{l}</button>)}</div></>}
    </Sheet>);
}

/** More: what needs you first (booking requests answered right here), then the rest of the planner's tools. */
export function MoreSheet({ onClose, requests, onOpenVisit, onApprove, onDecline, canDecline, staff, others, items }: {
  onClose: () => void; requests: any[]; onOpenVisit: (a: any) => void; onApprove?: (a: any) => void; onDecline?: (a: any) => void; canDecline?: boolean; staff: any[];
  others: Row[]; items: [string, () => void][];
}) {
  const [declining, setDeclining] = React.useState<string | null>(null);
  const total = requests.length + others.length;
  const prov = (a: any) => staff.find((s) => s.id === a.staffId)?.name;
  return (
    <Sheet label="More" onClose={onClose}>
      {total > 0 && <section aria-label="Needs you" className="mb-2">
        <p className="px-4 pb-1 text-[13px] font-semibold" style={{ color: AMBER }}>Needs you · {total}</p>
        {requests.map((a) => (<div key={a.id} className="mx-2 border-t px-2 py-3" style={{ borderColor: 'var(--line, #ececee)' }}>
          <button type="button" onClick={() => { onClose(); onOpenVisit(a); }} className="block w-full text-left text-[15px]"><b className="font-semibold">{a.clientName || 'A client'}</b> asked to book<br />
            <span className="text-[13px]" style={muted}>{a.serviceName || 'Service'} · {isToday(safe(a.startTime)) ? 'Today' : format(safe(a.startTime), 'EEE d MMM')} {format(safe(a.startTime), 'h:mm')}{prov(a) ? ` · ${prov(a)}` : ''}</span></button>
          {declining === a.id
            ? <div className="mt-2 flex gap-2"><button type="button" onClick={() => { setDeclining(null); onDecline?.(a); }} className="h-11 flex-1 rounded-full text-[14px] font-semibold text-white" style={{ background: '#b42318' }}>Yes, decline</button><button type="button" onClick={() => setDeclining(null)} className="h-11 flex-1 rounded-full text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Keep it</button></div>
            : <div className="mt-2 flex gap-2">{onApprove && <button type="button" onClick={() => onApprove(a)} className="h-11 flex-1 rounded-full text-[14px] font-semibold" style={{ background: 'var(--ink, #16171a)', color: 'var(--paper, #fff)' }}>Accept</button>}{onDecline && canDecline && <button type="button" onClick={() => setDeclining(a.id)} className="h-11 flex-1 rounded-full text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Decline</button>}</div>}
        </div>))}
        {others.map((o) => <button key={o.key} type="button" onClick={() => { onClose(); o.onClick(); }} className="mx-2 block w-[calc(100%-16px)] border-t px-2 py-3.5 text-left text-[15px]" style={{ borderColor: 'var(--line, #ececee)', color: o.tone === 'warn' ? AMBER : undefined }}>{o.label} ›</button>)}
      </section>}
      <p className="px-4 pb-1 pt-2 text-[13px]" style={muted}>More</p>
      {items.map(([l, f]) => <button key={l} type="button" onClick={() => { onClose(); f(); }} className="block w-full rounded-2xl px-4 py-3.5 text-left text-[16px] hover:bg-black/5">{l}</button>)}
    </Sheet>);
}
