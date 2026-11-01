'use client';
// src/components/settings/SettingsShell.tsx — THE ONE SETTINGS LAYOUT.
// On a computer, Settings keeps its own list on the left (it takes the app's sidebar place, with "Back to the app"
// at the top): eleven groups named for the decisions an owner makes, and the open group's pages under it, so every
// page is a click or two away and you always see where you are. A page that opens a part of the app (Reviews,
// Sent messages…) carries an arrow. On a phone there's no list beside the page: Settings home lists the groups, a
// group lists its pages (settings/group/[group]). Everything comes from lib/settings-registry.
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { ArrowUpRight, Building2, CalendarDays, ChevronLeft, CreditCard, DoorOpen, LayoutGrid, MessageSquare, Puzzle, RefreshCw, Search, ShoppingBag, Users, Zap } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { C } from '@/components/orders/ui';
import { SettingsStyle } from '@/components/settings/settings-style';
import { visibleGroups, settingsPageAt, searchPages, type SettingsPageEntry } from '@/lib/settings-registry';
import { mayLeave } from '@/components/settings/settings-place';

/** Every link in the list checks first that the open page has nothing unsaved (or that leaving is confirmed). */
const guard = (then?: () => void) => (e: React.MouseEvent) => { if (!mayLeave()) { e.preventDefault(); return; } then?.(); };

export const GROUP_ICON: Record<string, any> = {
  business: Building2, bookings: CalendarDays, changes: RefreshCw, checkin: DoorOpen, messages: MessageSquare,
  payments: CreditCard, shop: ShoppingBag, team: Users, rooms: LayoutGrid, auto: Zap, tools: Puzzle,
};

export function GroupIcon({ id, size = 28 }: { id: string; size?: number }) {
  const Icon = GROUP_ICON[id] || Puzzle;
  return <span className="grid shrink-0 place-items-center rounded-lg" style={{ width: size, height: size, background: C.soft, color: C.ink }}><Icon className="h-[15px] w-[15px]" aria-hidden /></span>;
}

/** The arrow on a page that opens a part of the app, read out by screen readers. */
export function AwayArrow({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <ArrowUpRight className={`${className} shrink-0`} role="img" aria-label="Opens a page of the app" style={{ color: C.muted }} />;
}

/** The #part of the address, kept up to date: Next changes it without a hashchange when a link only changes the #part. */
function useHash(): [string, (h: string) => void] {
  const pathname = usePathname();
  const params = useSearchParams();
  const [hash, setHash] = React.useState('');
  React.useEffect(() => { setHash(window.location.hash); }, [pathname, params]);
  React.useEffect(() => {
    const f = () => setHash(window.location.hash);
    window.addEventListener('hashchange', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('hashchange', f); window.removeEventListener('popstate', f); };
  }, []);
  return [hash, setHash];
}

function PageLink({ page, on, onPick }: { page: SettingsPageEntry; on: boolean; onPick: () => void }) {
  const away = page.inShell === false;
  return (
    <Link href={page.href} onClick={guard(onPick)} aria-current={on ? 'page' : undefined} className="flex min-h-[36px] [@media(pointer:coarse)]:min-h-11 items-center gap-2 rounded-[10px] py-1.5 pl-[46px] pr-2.5 text-[14px] transition-colors hover:bg-[var(--soft)]"
      style={on ? { background: C.soft, color: C.ink, fontWeight: 600 } : { color: C.muted }}>
      <span className="min-w-0 flex-1 truncate">{page.title}</span>{away && <AwayArrow />}
    </Link>
  );
}

function SettingsNav() {
  const { selectedTenant } = useTenant() as any;
  const router = useRouter();
  const pathname = usePathname() || '';
  const params = useSearchParams();
  const [hash, setHash] = useHash();
  const at = settingsPageAt(pathname, params?.get('tab') || null, hash);
  const groupId = at?.group.id || pathname.match(/^\/settings\/group\/([a-z]+)/)?.[1] || null;
  const groups = React.useMemo(() => (selectedTenant ? visibleGroups(selectedTenant) : []), [selectedTenant]);
  const [q, setQ] = React.useState('');
  const searching = q.trim().length >= 2;
  const hits = React.useMemo(() => (selectedTenant ? searchPages(selectedTenant, q).slice(0, 12) : []), [selectedTenant, q]);
  const navRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => { navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }); }, [at?.page.id, groupId, groups.length]);
  return (
    <nav ref={navRef} aria-label="Settings" data-settings-nav="" className="cf-settings sticky top-0 hidden h-dvh w-[272px] shrink-0 overflow-y-auto border-r px-3 pb-8 pt-5 lg:block" style={{ borderColor: C.line, background: C.paper }}>
      <a href="#settings-page" onClick={(e) => { e.preventDefault(); const el = document.getElementById('settings-page'); el?.focus(); el?.scrollIntoView({ block: 'start' }); }} className="sr-only rounded-lg px-2.5 py-2 text-[14px] focus:not-sr-only focus:block" style={{ color: C.ink }}>Skip to the page</a>
      <Link href="/dashboard" onClick={guard()} className="inline-flex h-9 [@media(pointer:coarse)]:min-h-11 items-center gap-1 rounded-lg px-2.5 text-[14px]" style={{ color: C.muted }}><ChevronLeft className="h-4 w-4" aria-hidden />Back to the app</Link>
      <Link href="/settings" onClick={guard()} className="block px-2.5 pb-3 pt-1 text-[26px] font-light tracking-[-0.02em]" style={{ color: C.ink }}>Settings</Link>
      <label className="mx-0.5 mb-3 flex h-10 items-center gap-2.5 rounded-xl px-3.5" style={{ background: C.soft }}>
        <Search className="h-4 w-4 shrink-0" style={{ color: C.muted }} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits[0] && mayLeave()) { setQ(''); setHash(hits[0].page.href.includes('#') ? '#' + hits[0].page.href.split('#')[1] : ''); router.push(hits[0].page.href); } if (e.key === 'Escape') setQ(''); }}
          placeholder="Search settings" aria-label="Search settings" aria-describedby="settings-search-status" className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none" style={{ color: C.ink }} />
      </label>
      <p id="settings-search-status" aria-live="polite" className="sr-only">{searching ? (hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}. Press Enter to open ${hits[0].page.title}.` : `Nothing matches ${q}.`) : ''}</p>
      {searching ? (
        <div>
          {hits.length === 0 ? <p className="px-2.5 py-2 text-[14px]" style={{ color: C.muted }}>Nothing matches “{q}”.</p> : hits.map((h, i) => (
            <Link key={h.group.id + h.page.id} href={h.page.href} onClick={guard(() => { setQ(''); setHash(h.page.href.includes('#') ? '#' + h.page.href.split('#')[1] : ''); })} className="flex [@media(pointer:coarse)]:min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 py-2 hover:bg-[var(--soft)]" style={i === 0 ? { background: C.soft } : undefined}>
              <GroupIcon id={h.group.id} size={26} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px]" style={{ color: C.ink }}>{h.page.title}</span><span className="block truncate text-[12.5px]" style={{ color: C.muted }}>{h.group.title}</span></span>
              {i === 0 && <span className="shrink-0 text-[11.5px]" style={{ color: C.muted }} aria-hidden>Enter</span>}
            </Link>))}
        </div>
      ) : (
        <ul className="space-y-0.5">{groups.map((g) => {
          const open = g.id === groupId;
          const single = g.pages.length === 1;
          const lit = open && (single || !at);
          return (
            <li key={g.id}>
              <Link href={single ? g.pages[0].href : `/settings/group/${g.id}`} onClick={guard()} aria-expanded={single ? undefined : open} aria-current={lit ? 'page' : undefined} className="flex min-h-[38px] [@media(pointer:coarse)]:min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 text-[14.5px] transition-colors hover:bg-[var(--soft)]"
                style={{ color: C.ink, fontWeight: lit ? 600 : 400, background: lit ? C.soft : undefined }}>
                <GroupIcon id={g.id} size={26} /><span className="min-w-0 flex-1 truncate">{g.title}</span>{single && g.pages[0].inShell === false && <AwayArrow />}
              </Link>
              {open && !single && <div className="mt-0.5 space-y-0.5">{g.pages.map((p) => <PageLink key={p.id} page={p} on={at?.page.id === p.id && at.group.id === g.id} onPick={() => setHash(p.href.includes('#') ? '#' + p.href.split('#')[1] : '')} />)}</div>}
            </li>);
        })}</ul>
      )}
    </nav>
  );
}

/** Wraps every page on a settings address: the list on the left on a computer (when this person gets it), the page
 *  beside it in the Settings colors. The wrapper stays put while the role loads, so the page itself never remounts. */
export function SettingsShell({ children, nav = true }: { children: React.ReactNode; nav?: boolean }) {
  return (
    <div className="flex min-h-dvh w-full">
      <SettingsStyle />
      {nav && <React.Suspense fallback={<div className="hidden w-[272px] shrink-0 lg:block" />}><SettingsNav /></React.Suspense>}
      <div id="settings-page" tabIndex={-1} className="cf-settings min-w-0 flex-1 outline-none">{children}</div>
    </div>
  );
}
