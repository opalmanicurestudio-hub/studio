'use client';
// src/components/shared/AppSearch.tsx — "SEARCH PAGES AND SETTINGS" in the header.
// ~60 pages and ~35 settings is too many to hunt through, so owners can just type: "deposit" → Booking policies,
// "tips" → Payments, "planner" → Planner. Keyboard: ⌘K / Ctrl+K to jump in, ↑ ↓ to move, Enter to open, Esc to close.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { NAV_AREAS } from '@/components/shared/AppSidebar';
import { SETTINGS_INDEX } from '@/components/settings/SettingsHome';
import { useTenant } from '@/context/TenantContext';
import { pageVisible, settingVisible } from '@/lib/modules';

type Hit = { title: string; where: string; href: string; hay: string };

export function AppSearch() {
  const router = useRouter(); const { selectedTenant } = useTenant() as any;
  const [q, setQ] = React.useState(''); const [open, setOpen] = React.useState(false); const [sel, setSel] = React.useState(0);
  const box = React.useRef<HTMLInputElement>(null);
  const all = React.useMemo<Hit[]>(() => {
    const pages = NAV_AREAS.flatMap((a) => a.items.filter((i) => pageVisible(selectedTenant, i.href)).map((i) => ({ title: i.label, where: a.area, href: i.href, hay: `${i.label} ${a.area}`.toLowerCase() })));
    const settings = SETTINGS_INDEX.flatMap((g) => g.items.filter((i: any) => settingVisible(selectedTenant, i.href, i.module)).map((i: any) => ({ title: i.title, where: `Settings · ${g.question}`, href: i.href, hay: `${i.title} ${i.meaning} ${i.words || ''}`.toLowerCase() })));
    const seen = new Set<string>(); return [...pages, ...settings].filter((h) => (seen.has(h.href + h.title) ? false : (seen.add(h.href + h.title), true)));
  }, [selectedTenant]);
  const hits = React.useMemo(() => { const n = q.trim().toLowerCase(); if (n.length < 2) return [];
    const words = n.split(/\s+/); return all.filter((h) => words.every((w) => h.hay.includes(w)))
      .sort((a, b) => Number(!a.title.toLowerCase().startsWith(n)) - Number(!b.title.toLowerCase().startsWith(n))).slice(0, 8); }, [q, all]);
  React.useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); box.current?.focus(); setOpen(true); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  React.useEffect(() => setSel(0), [q]);
  const go = (h: Hit) => { setOpen(false); setQ(''); box.current?.blur(); router.push(h.href); };
  return (
    <div className="relative w-full max-w-[420px]">
      <label className="flex h-10 items-center gap-2.5 rounded-full px-4" style={{ background: '#f3eee8' }}>
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input ref={box} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, hits.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
            else if (e.key === 'Enter' && hits[sel]) go(hits[sel]); else if (e.key === 'Escape') { setOpen(false); box.current?.blur(); } }}
          placeholder="Search pages and settings" aria-label="Search pages and settings" role="combobox" aria-expanded={open && hits.length > 0} aria-controls="app-search-results"
          className="h-full w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
        <kbd className="hidden shrink-0 rounded-md border px-1.5 text-[11px] text-muted-foreground lg:inline">⌘K</kbd>
      </label>
      {open && q.trim().length >= 2 && (
        <div id="app-search-results" role="listbox" className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-2xl shadow-[0_12px_40px_rgba(28,25,23,.14)]" style={{ background: 'var(--cf-search-bg, #fff)', border: '1px solid #e7e2dc' }}>
          {hits.length ? hits.map((h, i) => (
            <button key={h.href + h.title} type="button" role="option" aria-selected={i === sel} onMouseDown={(e) => { e.preventDefault(); go(h); }} onMouseEnter={() => setSel(i)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left" style={i === sel ? { background: '#f3eee8' } : undefined}>
              <span className="truncate text-[14.5px] font-medium">{h.title}</span><span className="shrink-0 text-[12px] text-muted-foreground">{h.where}</span>
            </button>)) : <p className="px-4 py-3 text-[14px] text-muted-foreground">Nothing matches “{q}”. Try another word.</p>}
        </div>)}
    </div>
  );
}
