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
import { ArrowUpRight, Building2, CalendarDays, ChevronLeft, CreditCard, DoorOpen, LayoutGrid, ListChecks, MessageSquare, Puzzle, RefreshCw, Search, ShoppingBag, Users, Zap } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { C } from '@/components/orders/ui';
import { SettingsStyle } from '@/components/settings/settings-style';
import { visibleGroups, settingsPageAt, searchPages, type SettingsPageEntry } from '@/lib/settings-registry';
import { useRowSearch, announceFind } from '@/components/settings/use-row-search';
import { RowFinder } from '@/components/settings/RowFinder';
import { useSetupGuide } from '@/components/settings/SetupGuide';
import { guideOnShow } from '@/lib/setup-guide';
import { mayLeave } from '@/components/settings/settings-place';

/** Every link in the list checks first that the open page has nothing unsaved (or that leaving is confirmed). A click
 *  that opens a new tab, or a link to the page already open, leaves nothing behind, so it doesn't ask. */
const guard = (then?: () => void) => (e: React.MouseEvent<HTMLAnchorElement>) => {
  const newTab = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
  const here = samePage(e.currentTarget.href);
  if (newTab || here) { if (!newTab) then?.(); return; }
  if (!mayLeave()) { e.preventDefault(); return; }
  then?.();
};
const hashOfHref = (href: string) => (href.includes('#') ? '#' + href.split('#')[1] : '');
/** The page already open (a ?find= pointing at one of its settings doesn't make it another page). */
function samePage(href: string): boolean {
  try {
    const strip = (u: URL) => { const p = new URLSearchParams(u.search); p.delete('find'); return u.pathname + '?' + p.toString(); };
    return strip(new URL(href, window.location.href)) === strip(new URL(window.location.href));
  } catch { return false; }
}

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
  // Set up your business sits at the top of the list until every step is done (or it's hidden); after that it's a page
  // under Your business like any other.
  const guide = useSetupGuide(guideOnShow(selectedTenant), false);
  const setupOn = pathname === '/settings/setup';
  const topSetup = !!guide.progress && !guide.progress.allDone;
  const at = settingsPageAt(pathname, params?.get('tab') || null, hash);
  const groupId = setupOn && topSetup ? null : at?.group.id || pathname.match(/^\/settings\/group\/([a-z]+)/)?.[1] || null;
  const groups = React.useMemo(() => (selectedTenant ? visibleGroups(selectedTenant) : []), [selectedTenant]);
  const [q, setQ] = React.useState('');
  const searching = q.trim().length >= 2;
  const hits = React.useMemo(() => (selectedTenant ? searchPages(selectedTenant, q).slice(0, 8) : []), [selectedTenant, q]);
  const { hits: rowHits, loading: rowsLoading } = useRowSearch(selectedTenant, q, 8);
  const first = hits[0] ? { href: hits[0].page.href, title: hits[0].page.title } : rowHits[0] ? { href: rowHits[0].href, title: rowHits[0].label } : null;
  const navRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => { navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }); }, [at?.page.id, groupId, groups.length]);
  return (
    <nav ref={navRef} aria-label="Settings" data-settings-nav="" className="cf-settings sticky top-0 hidden h-dvh w-[272px] shrink-0 overflow-y-auto border-r px-3 pb-8 pt-5 lg:block" style={{ borderColor: C.line, background: C.paper }}>
      <a href="#settings-page" onClick={(e) => { e.preventDefault(); const el = document.getElementById('settings-page'); el?.focus(); el?.scrollIntoView({ block: 'start' }); }} className="sr-only rounded-lg px-2.5 py-2 text-[14px] focus:not-sr-only focus:block" style={{ color: C.ink }}>Skip to the page</a>
      <Link href="/dashboard" onClick={guard()} className="inline-flex h-9 [@media(pointer:coarse)]:min-h-11 items-center gap-1 rounded-lg px-2.5 text-[14px]" style={{ color: C.muted }}><ChevronLeft className="h-4 w-4" aria-hidden />Back to the app</Link>
      <Link href="/settings" onClick={guard()} className="block px-2.5 pb-3 pt-1 text-[26px] font-light tracking-[-0.02em]" style={{ color: C.ink }}>Settings</Link>
      <label className="cf-search mx-0.5 mb-3 flex h-10 [@media(pointer:coarse)]:h-11 items-center gap-2.5 rounded-xl px-3.5" style={{ background: C.soft }}>
        <Search className="h-4 w-4 shrink-0" style={{ color: C.muted }} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && first && (samePage(first.href) || mayLeave())) { setQ(''); setHash(hashOfHref(first.href)); announceFind(first.title); router.push(first.href); } if (e.key === 'Escape') setQ(''); }}
          placeholder="Search settings" aria-label="Search settings" aria-describedby="settings-search-status" className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none" style={{ color: C.ink }} />
      </label>
      <p id="settings-search-status" aria-live="polite" className="sr-only">{searching ? (first ? `${hits.length + rowHits.length} result${hits.length + rowHits.length === 1 ? '' : 's'}. Press Enter to open ${first.title}.` : rowsLoading ? '' : `Nothing matches ${q}.`) : ''}</p>
      {searching ? (
        <div>
          {!first && !rowsLoading && <p className="px-2.5 py-2 text-[14px]" style={{ color: C.muted }}>Nothing matches “{q}”.</p>}
          {hits.map((h, i) => (
            <Link key={h.group.id + h.page.id} href={h.page.href} onClick={guard(() => { setQ(''); setHash(hashOfHref(h.page.href)); })} className="flex [@media(pointer:coarse)]:min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 py-2 hover:bg-[var(--soft)]" style={i === 0 ? { background: C.soft } : undefined}>
              <GroupIcon id={h.group.id} size={26} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px]" style={{ color: C.ink }}>{h.page.title}</span><span className="block truncate text-[12.5px]" style={{ color: C.muted }}>{h.group.title}</span></span>
              {i === 0 && <span className="shrink-0 text-[11.5px]" style={{ color: C.muted }} aria-hidden>Enter</span>}
            </Link>))}
          {rowHits.length > 0 && <p className="px-2.5 pb-1 pt-3 text-[12.5px] font-semibold" style={{ color: C.muted }}>Settings on a page</p>}
          {rowHits.map((r, i) => (
            <Link key={r.href} href={r.href} prefetch={false} onClick={guard(() => { setQ(''); setHash(hashOfHref(r.page.href)); announceFind(r.label); })} className="flex [@media(pointer:coarse)]:min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 py-2 hover:bg-[var(--soft)]" style={!hits.length && i === 0 ? { background: C.soft } : undefined}>
              <GroupIcon id={r.group.id} size={26} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px]" style={{ color: C.ink }}>{r.label}</span><span className="block truncate text-[12.5px]" style={{ color: C.muted }}>{r.page.title === r.group.title ? r.page.title : `${r.page.title} · ${r.group.title}`}</span></span>
              {!hits.length && i === 0 && <span className="shrink-0 text-[11.5px]" style={{ color: C.muted }} aria-hidden>Enter</span>}
            </Link>))}
        </div>
      ) : (
        <>{topSetup && guide.progress && (
          <Link href="/settings/setup" onClick={guard()} aria-current={setupOn ? 'page' : undefined} className="mb-2 flex min-h-[40px] [@media(pointer:coarse)]:min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 text-[14.5px] transition-colors hover:bg-[var(--soft)]"
            style={{ color: C.ink, fontWeight: setupOn ? 600 : 400, background: setupOn ? C.soft : undefined }}>
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg" style={{ background: C.ink, color: C.paper }}><ListChecks className="h-[15px] w-[15px]" aria-hidden /></span>
            <span className="min-w-0 flex-1 truncate text-[14px]">Set up your business</span>
            {!setupOn && <><span className="shrink-0 rounded-full px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums" style={{ background: C.soft, color: C.muted }} aria-hidden="true">{guide.progress.doneCount} of {guide.progress.total}</span><span className="sr-only">, {guide.progress.doneCount} of {guide.progress.total} steps done</span></>}
          </Link>)}
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
              {open && !single && <div className="mt-0.5 space-y-0.5">{g.pages.filter((p) => !(topSetup && p.id === 'setup')).map((p) => <PageLink key={p.id} page={p} on={at?.page.id === p.id && at.group.id === g.id} onPick={() => setHash(hashOfHref(p.href))} />)}</div>}
            </li>);
        })}</ul></>
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
      <React.Suspense fallback={null}><RowFinder /></React.Suspense>
      <div id="settings-page" tabIndex={-1} className="cf-settings min-w-0 flex-1 outline-none">{children}</div>
    </div>
  );
}
