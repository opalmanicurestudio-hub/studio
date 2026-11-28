'use client';
// src/components/money/MoneyTabs.tsx — THE MONEY PAGE'S TABS (design board "One Money page", option A). One row of tabs
// that stays at the top as the page scrolls: an icon and a word each, what needs you counted on the tab it's in (Books:
// bank lines to sort), and the open one marked. On a phone the row slides sideways, the open tab kept in view and a soft
// edge showing there's more. A real tab list: Tab reaches the open tab, the arrow keys (and Home and End) move between
// them, Enter or Space opens one (so passing over a tab never opens it), and each opens its own panel
// (`money-panel-<key>`, named only once it's been opened: panels are drawn on first visit).
import * as React from 'react';
import { BookOpen, CalendarClock, FileText, History, Landmark, LayoutDashboard, Tags, Users, type LucideIcon } from 'lucide-react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309', AMBER_TINT = '#fff7ed';

export type MoneyTab = { key: string; label: string; count?: number | null; dot?: boolean; dotLabel?: string };
const ICONS: Record<string, LucideIcon> = { overview: LayoutDashboard, ledger: BookOpen, payday: Users, bills: CalendarClock, writeoffs: Tags, taxes: Landmark, reports: FileText, activity: History };

export const tabId = (key: string) => `money-tab-${key}`;
export const panelId = (key: string) => `money-panel-${key}`;

export function MoneyTabs({ tabs, active, onChange, mounted }: { tabs: MoneyTab[]; active: string; onChange: (key: string) => void; mounted?: string[] }) {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  // (The tab the arrow keys are on: the open one until they move.)
  const [focusKey, setFocusKey] = React.useState(active);
  React.useEffect(() => setFocusKey(active), [active]);
  const [edge, setEdge] = React.useState({ left: false, right: false });
  const measure = React.useCallback(() => {
    const el = listRef.current; if (!el) return;
    setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  React.useEffect(() => {
    measure(); const el = listRef.current; if (!el) return;
    el.addEventListener('scroll', measure, { passive: true }); window.addEventListener('resize', measure);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [measure, tabs.length]);
  // (The open tab slides into view on a phone; the page itself never jumps.)
  React.useEffect(() => {
    const el = listRef.current; const t = el?.querySelector<HTMLElement>(`#${tabId(active)}`); if (!el || !t) return;
    const left = t.offsetLeft - (el.clientWidth - t.offsetWidth) / 2;
    try { el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' }); } catch { el.scrollLeft = Math.max(0, left); }
  }, [active]);

  const keys = tabs.map((t) => t.key);
  const onKey = (e: React.KeyboardEvent) => {
    const i = keys.indexOf(focusKey); if (i < 0) return;
    const to = e.key === 'ArrowRight' ? keys[(i + 1) % keys.length] : e.key === 'ArrowLeft' ? keys[(i - 1 + keys.length) % keys.length] : e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : null;
    if (!to) return;
    e.preventDefault(); setFocusKey(to);
    requestAnimationFrame(() => document.getElementById(tabId(to))?.focus());
  };

  return (
    <nav aria-label="Money" className="sticky top-0 z-30 border-b backdrop-blur" style={{ background: 'rgba(245,245,247,0.94)', borderColor: LINE }}>
      <div className="relative mx-auto max-w-[1180px] md:px-6">
        <div ref={listRef} role="tablist" aria-label="Money" onKeyDown={onKey}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusKey(active); }}
          className="relative flex snap-x gap-1 overflow-x-auto px-4 py-2 md:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => {
            const on = t.key === active; const Icon = ICONS[t.key];
            return (
              <button key={t.key} id={tabId(t.key)} type="button" role="tab" aria-selected={on} aria-controls={!mounted || mounted.includes(t.key) ? panelId(t.key) : undefined}
                tabIndex={t.key === focusKey ? 0 : -1} onClick={() => onChange(t.key)}
                className={`relative flex min-h-[44px] shrink-0 snap-start items-center gap-2 rounded-full px-3.5 text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2 ${on ? '' : 'hover:bg-[#ffffff]'}`}
                style={on ? { background: INK, color: '#fff', fontWeight: 600 } : { color: INK }}>
                {Icon && <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={on ? 2.2 : 1.8} style={{ color: on ? '#fff' : MUTED }} />}
                <span>{t.label}</span>
                {!!t.count && <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[12px] font-semibold tabular-nums"
                  style={on ? { background: '#fff', color: INK } : { background: AMBER_TINT, color: AMBER }}>{t.count}<span className="sr-only"> to do</span></span>}
                {t.dot && <span className="h-2 w-2 rounded-full" style={{ background: on ? '#fff' : AMBER }}><span className="sr-only">{t.dotLabel || 'New'}</span></span>}
              </button>
            );
          })}
        </div>
        {edge.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 md:hidden" style={{ background: 'linear-gradient(to right, rgba(245,245,247,1), rgba(245,245,247,0))' }} />}
        {edge.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 md:hidden" style={{ background: 'linear-gradient(to left, rgba(245,245,247,1), rgba(245,245,247,0))' }} />}
      </div>
    </nav>
  );
}
