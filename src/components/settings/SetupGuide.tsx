'use client';
// src/components/settings/SetupGuide.tsx — SET UP YOUR BUSINESS, on screen (steps and rules in lib/setup-guide).
// useSetupGuide: the business's steps, worked out from the business itself and a few counts from /api/getting-started.
// SetupBar: on any page opened from the guide (…?setup=<step>), a bar at the bottom says which step this is and offers
// Skip and Next, so an owner walks the whole setup on the real pages without hunting for them.
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { payPost } from '@/components/pay/pay-client';
import { C } from '@/components/orders/ui';
import { mayLeave } from '@/components/settings/settings-place';
import { guideSteps, guideProgress, stepAfter, othersLeft, stepHref, type GuideFacts, type GuideStep } from '@/lib/setup-guide';

export interface GuideData { facts: GuideFacts; toPrice: number; suggest: string; starterMenu: string | null; menus: { id: string; label: string; count: number }[]; bookingPath: string }

const isManagerRole = (role: any) => ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
const notedFor = new Set<string>();

/** The bar's own colors on any page (light and dark), without the rest of the Settings styles. */
const BAR_CSS = `.cf-setup-bar{--paper:#fff;--ink:#16171a;--cf-muted:#6d7075;--line:#ececee;--soft:#f5f5f7;--ok-ink:#1f7a4d;--warn-ink:#b45309;font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.dark .cf-setup-bar{--paper:#000;--ink:#f5f5f7;--cf-muted:#9a9ca3;--line:#222226;--soft:#18181b;--ok-ink:#7fd1a5;--warn-ink:#f0b35a}
.cf-setup-bar :focus-visible{outline:3px solid var(--ink);outline-offset:2px}`;

/** One copy of the counts per business, shared by every place that shows the guide (the Settings list, Settings home,
 *  the setup page and the bar): places that open together ask once, and a fresh count reaches all of them. Asking
 *  again on purpose (a step checking again) never waits on an answer already on its way, and an older answer that
 *  arrives late never replaces a newer one. */
const FRESH_MS = 3_000;
const cache = new Map<string, { at: number; data: GuideData }>();
const flying = new Map<string, Promise<GuideData | null>>();
const asked = new Map<string, number>();
const listeners = new Set<(tenantId: string, data: GuideData | null) => void>();
function fetchGuide(tenantId: string, force: boolean): Promise<GuideData | null> {
  const hit = cache.get(tenantId);
  if (!force && hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.data);
  const going = flying.get(tenantId); if (going && !force) return going;
  const mine = (asked.get(tenantId) || 0) + 1; asked.set(tenantId, mine);
  const p = (async () => {
    const r: any = await payPost('/api/getting-started', { tenantId, action: 'guide' });
    if (asked.get(tenantId) !== mine) return cache.get(tenantId)?.data || null;
    if (!r?.ok || !r.facts) { listeners.forEach((f) => f(tenantId, null)); return null; }
    const data: GuideData = { facts: r.facts, toPrice: r.toPrice || 0, suggest: r.suggest, starterMenu: r.starterMenu, menus: r.menus || [], bookingPath: r.bookingPath };
    cache.set(tenantId, { at: Date.now(), data }); listeners.forEach((f) => f(tenantId, data)); return data;
  })().finally(() => { if (flying.get(tenantId) === p) flying.delete(tenantId); });
  flying.set(tenantId, p); return p;
}

/** The steps for this business. Counts are fetched again when the page changes (unless follow is off: the Settings
 *  list asks once and hears every later count), so a service added on /services ticks its step when the owner moves on.
 *  ready: the business and the person's role have loaded. failed: the counts couldn't be fetched. */
export function useSetupGuide(on = true, follow = true) {
  const { selectedTenant, role } = useTenant() as any;
  const pathname = usePathname();
  const tenantId = selectedTenant?.id || '';
  const ready = !!tenantId && role != null;
  const allowed = on && isManagerRole(role) && !!tenantId;
  const [got, setGot] = React.useState<{ id: string; data: GuideData } | null>(null);
  const [failed, setFailed] = React.useState('');
  const data = allowed ? (got && got.id === tenantId ? got.data : cache.get(tenantId)?.data || null) : null;
  const load = React.useCallback(async (force = false) => {
    if (!allowed) return;
    const d = await fetchGuide(tenantId, force);
    if (d) setGot({ id: tenantId, data: d });
  }, [allowed, tenantId]);
  const at = follow ? pathname : '';
  React.useEffect(() => { void load(); }, [load, at]);
  React.useEffect(() => {
    const hear = (id: string, d: GuideData | null) => { if (id !== tenantId) return; if (d) { setGot({ id, data: d }); setFailed(''); } else setFailed(id); };
    listeners.add(hear); return () => { listeners.delete(hear); };
  }, [tenantId]);
  const steps: GuideStep[] | null = React.useMemo(() => (data && selectedTenant ? guideSteps(selectedTenant, data.facts) : null), [data, selectedTenant]);
  const progress = steps ? guideProgress(steps) : null;
  const mark = React.useCallback(async (step: string, as: 'done' | 'skipped' | 'undo' | 'hide' | 'show' | 'finished'): Promise<boolean> => { if (!allowed) return false; const r: any = await payPost('/api/getting-started', { tenantId, action: 'mark', step, as }); return !!r?.ok; }, [allowed, tenantId]);
  // Every step really done is kept on the business (once, by whichever place sees it first), so Settings stops asking
  // for counts. Steps only put off don't count: the guide stays, quietly, until they're done or it's hidden.
  const allDone = !!progress?.allDone; const noted = !!selectedTenant?.setupGuide?.finishedAt;
  React.useEffect(() => { if (allowed && allDone && !noted && !notedFor.has(tenantId)) { notedFor.add(tenantId); void mark('', 'finished').then((ok) => { if (!ok) notedFor.delete(tenantId); }); } }, [allowed, allDone, noted, mark, tenantId]);
  const reload = React.useCallback(() => load(true), [load]);
  return { ready, allowed, data, steps, progress, mark, reload, failed: !!failed && failed === tenantId && !data };
}

/** The bar's height while it's showing, for anything else fixed to the bottom of the screen (the assistant's button). */
function useBarHeight(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  React.useLayoutEffect(() => {
    const el = ref.current; const root = document.documentElement;
    if (!on || !el) { root.style.removeProperty('--cf-bar'); return; }
    const set = () => root.style.setProperty('--cf-bar', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set(); const ro = new ResizeObserver(set); ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--cf-bar'); };
  }, [ref, on]);
}

/** Where the page's own column is (beside the app's sidebar, or beside the Settings list), so the bar sits over it. */
function useColumn(on: boolean, pathname: string) {
  const [box, setBox] = React.useState<{ left: number; width: number } | null>(null);
  React.useLayoutEffect(() => {
    if (!on) return;
    const el = document.getElementById('settings-page') || document.getElementById('main'); if (!el) return;
    const set = () => { const r = el.getBoundingClientRect(); setBox({ left: Math.max(0, r.left), width: Math.min(r.width, window.innerWidth) }); };
    set(); const ro = new ResizeObserver(set); ro.observe(el); window.addEventListener('resize', set);
    return () => { ro.disconnect(); window.removeEventListener('resize', set); };
  }, [on, pathname]);
  return box;
}

/** The bar at the bottom of a page opened from Set up your business. */
export function SetupBar() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() || '';
  const step = params?.get('setup') || '';
  const g = useSetupGuide(!!step);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const bar = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { setErr(''); }, [step]);
  const i = g.steps ? g.steps.findIndex((s) => s.id === step) : -1;
  const cur = i >= 0 ? g.steps![i] : null;
  const on = !!step && g.allowed && !!cur;
  useBarHeight(bar, on);
  const box = useColumn(on, pathname);
  // A step that needs something real (a priced service, someone on the team) checks again now and then while it's open,
  // so adding it here ticks the step without leaving the page.
  const waiting = on && !!cur?.checked && !cur.done;
  React.useEffect(() => {
    if (!waiting) return;
    let n = 0; const t = setInterval(() => { if (document.visibilityState === 'visible' && n++ < 20) void g.reload(); }, 15_000);
    return () => clearInterval(t);
  }, [waiting, g.reload]);
  if (!on || !cur) return null;
  const next = stepAfter(g.steps!, step);
  const go = async (as: 'done' | 'skipped' | null) => {
    if (busy || !mayLeave()) return;
    setBusy(true); setErr('');
    if (as && !(await g.mark(step, as))) { setBusy(false); setErr('That didn’t save. Try again.'); return; }
    setBusy(false);
    router.push(next ? stepHref(next) : '/settings/setup');
  };
  const leaving = (e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; if (!mayLeave()) e.preventDefault(); };
  const more = othersLeft(g.steps!, step);
  const review = !cur.checked;
  return (
    <>
      <style>{BAR_CSS}</style>
      <div aria-hidden className="h-[176px] sm:h-[112px]" />
      <div ref={bar} role="region" aria-label="Set up your business" className="fixed bottom-0 z-[35] px-3 pb-[max(12px,env(safe-area-inset-bottom))]" style={box ? { left: box.left, width: box.width } : { left: 0, right: 0 }}>
        <div className="cf-setup-bar mx-auto max-w-3xl rounded-[22px] px-4 py-3 sm:flex sm:items-center sm:gap-3" style={{ background: C.paper, color: C.ink, boxShadow: '0 0 0 1px var(--line, #ececee), 0 18px 44px -18px rgba(22,23,26,.4)' }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12.5px]" style={{ color: C.muted }}>Step {i + 1} of {g.steps!.length} · Set up your business</p>
              <Link href="/settings/setup" onClick={leaving} className="-my-2.5 inline-flex h-11 shrink-0 items-center px-1 text-[13.5px] font-medium underline-offset-4 hover:underline sm:hidden" style={{ color: C.muted }}>All steps</Link>
            </div>
            <p className="truncate text-[15.5px] font-semibold">{cur.title}</p>
            {cur.checked && !cur.done && <p className="text-[13px]" style={{ color: C.warn }}>{cur.note || 'Not done yet. You can come back to it.'}</p>}
            {cur.done && <p className="text-[13px]" style={{ color: C.ok }}>Done</p>}
            {err && <p role="alert" className="text-[13px] font-semibold" style={{ color: C.warn }}>{err}</p>}
          </div>
          <div className="mt-2.5 flex gap-2 sm:mt-0 sm:shrink-0">
            <Link href="/settings/setup" onClick={leaving} className="hidden h-11 items-center rounded-full px-3 text-[14px] font-medium sm:inline-flex" style={{ color: C.muted }}>All steps</Link>
            {!cur.done && <button type="button" aria-disabled={busy} onClick={() => void go('skipped')} className="h-11 flex-1 rounded-full px-4 text-[14.5px] font-medium aria-disabled:opacity-50 sm:flex-none" style={{ background: C.soft, color: C.ink }}>Skip for now</button>}
            <button type="button" aria-disabled={busy} onClick={() => void go(review && !cur.done ? 'done' : null)} className="h-11 flex-1 rounded-full px-5 text-[14.5px] font-semibold aria-disabled:opacity-50 sm:flex-none" style={{ background: C.ink, color: C.paper }}>
              {review && !cur.done ? (next ? 'Looks good, next' : more ? 'Looks good' : 'Looks good, finish') : next ? 'Next' : more ? 'All steps' : 'Finish'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
