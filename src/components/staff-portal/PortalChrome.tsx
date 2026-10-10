'use client';
// src/components/staff-portal/PortalChrome.tsx — THE STAFF PORTAL'S FRAME: the floating bottom bar (Today · Schedule ·
// Team · Pay · Me, or Rent · Team · Me for renters) and the small switches inside a tab (Now · Day · Floor, Shifts ·
// Requests, Chats · Notices). White, ink, and the business's colour for what's selected.
import * as React from 'react';

export type NavKey = 'today' | 'schedule' | 'team' | 'pay' | 'me' | 'rent';
const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';

const ICON: Record<NavKey, React.ReactNode> = {
  today: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  schedule: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
  team: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  pay: <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2M3 10h18" /></>,
  me: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  rent: <><path d="M3 10l9-6 9 6" /><path d="M5 10v9h14v-9M9 19v-5h6v5" /></>,
};
const LABEL: Record<NavKey, string> = { today: 'Today', schedule: 'Schedule', team: 'Team', pay: 'Pay', me: 'Me', rent: 'Rent' };

export function BottomNav({ items, active, onPick, badges = {}, accent = INK }: { items: NavKey[]; active: NavKey; onPick: (k: NavKey) => void; badges?: Partial<Record<NavKey, number>>; accent?: string }) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg px-4" style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}>
      <div className="grid h-[66px] items-center rounded-[24px] border" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, background: 'rgba(255,255,255,.94)', borderColor: LINE, boxShadow: '0 18px 40px -22px rgba(22,23,26,.4)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
        {items.map((k) => { const on = k === active; const n = badges[k] || 0;
          return (
            <button key={k} type="button" onClick={() => onPick(k)} aria-current={on ? 'page' : undefined} className="relative flex flex-col items-center gap-1 text-[11px]" style={{ color: on ? accent : MUTED, fontWeight: on ? 700 : 600 }}>
              <span className="relative">
                <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round">{ICON[k]}</svg>
                {n > 0 && <span className="absolute -right-2 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: '#b42318' }}>{n > 99 ? '99+' : n}</span>}
              </span>
              {LABEL[k]}
            </button>); })}
      </div>
    </nav>);
}

export function Segments<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; badge?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex rounded-full p-1" style={{ background: '#f4f4f5' }}>
      {options.map((o) => { const on = o.value === value; return (
        <button key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.value)}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] transition-colors" style={on ? { background: '#fff', color: INK, fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,.08)' } : { color: MUTED, fontWeight: 600 }}>
          {o.label}{(o.badge || 0) > 0 && <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: '#b42318' }}>{o.badge}</span>}
        </button>); })}
    </div>);
}

/** The tab a portal section belongs to — the old tab names keep working (notification links, ?tab=…). */
export function navOf(tab: string, renter: boolean): NavKey {
  if (tab === 'schedule' || tab === 'requests') return 'schedule';
  if (tab === 'messages' || tab === 'inbox') return 'team';
  if (tab === 'earnings') return 'pay';
  if (tab === 'rent') return 'rent';
  if (tab === 'today') return renter ? 'rent' : 'today';
  return 'me';
}
