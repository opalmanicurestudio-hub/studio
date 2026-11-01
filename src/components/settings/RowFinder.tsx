'use client';
// src/components/settings/RowFinder.tsx — OPENING A PAGE ON ONE SETTING. A search result opens its page with
// ?find=<the setting>; this finds that row on the page, opening closed sections one at a time if it's inside one (and
// closing again the ones it isn't in), scrolls to it clear of the header and marks it for a moment (still, when the
// phone asks for less motion), moves focus to it and says so to screen readers. If the row can't be shown (it appears
// once another setting is on), a short note says so instead of leaving the owner wondering.
import * as React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { C } from '@/components/orders/ui';

export type Hit = { el: HTMLElement; heading: boolean };

/** How tall a block can be and still be "the row" (a card or the whole page is taller). */
export const ROW_MAX = 240;

export function shown(el: Element): boolean {
  if (el.closest('[hidden],[aria-hidden="true"],details:not([open])')) return false;
  return el.getClientRects().length > 0;
}

/** The row around a word on the page: a marked settings row if there is one; a section title's heading; otherwise the
 *  block around the word, at most three levels up and never taller than a row, so a card or the page isn't marked. */
export function rowOf(el: HTMLElement, root: HTMLElement): Hit {
  const marked = el.closest('[data-setting-row], .cf-row, li, tr') as HTMLElement | null;
  if (marked && root.contains(marked) && marked !== root) return { el: marked, heading: false };
  if (/^H[23]$/.test(el.tagName)) { const up = el.parentElement; return { el: up && up !== root && root.contains(up) && up.getBoundingClientRect().height <= ROW_MAX / 2 ? up : el, heading: true }; }
  let cur = el;
  for (let i = 0; i < 3; i++) {
    const up = cur.parentElement;
    if (!up || up === root || !root.contains(up) || up.getBoundingClientRect().height > ROW_MAX) break;
    cur = up;
  }
  return { el: cur, heading: false };
}

export function findRow(root: HTMLElement, label: string): Hit | null {
  const want = label.trim().toLowerCase();
  const marked = Array.from(root.querySelectorAll<HTMLElement>('[data-setting-row]')).find((el) => (el.dataset.settingRow || '').trim().toLowerCase() === want && shown(el));
  if (marked) return { el: marked, heading: false };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (p && (n.nodeValue || '').trim().toLowerCase() === want && shown(p)) return rowOf(p, root);
  }
  const named = Array.from(root.querySelectorAll<HTMLElement>('[aria-label]')).find((el) => (el.getAttribute('aria-label') || '').trim().toLowerCase() === want && shown(el));
  return named ? rowOf(named, root) : null;
}

/** The part of the page a closed section's button opens. */
export const boxOf = (b: HTMLElement) => (b.closest('section') as HTMLElement | null) || b.parentElement;

/** Looks for a setting on the page for a few seconds while it loads. If it isn't showing, opens the closed sections
 *  one at a time (an accordion keeps one open), gives each a moment to show its rows and closes it again when the
 *  setting isn't in it, going round a second time (on pages with a handful of sections) for rows that load late.
 *  Giving up, or being canceled by leaving, puts back the sections that were open before. Plain page and timers, no
 *  React, so it can be tried on its own. */
export function seekRow(o: { root: () => HTMLElement | null; label: string; later: (fn: () => void, ms: number) => void; stopped: () => boolean; found: (hit: Hit) => void; gaveUp: () => void; every?: number }): { cancel: () => void } {
  const every = o.every ?? 150;
  let tries = 0; let current: HTMLElement | null = null; let waited = 0; let round = 0; let wasOpen: HTMLElement[] | null = null; let over = false;
  const tried = new Set<HTMLElement>();
  const closed = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[data-settings-more][aria-expanded="false"]')).filter((b) => !tried.has(b) && shown(b));
  const step = () => {
    if (o.stopped()) return;
    const root = o.root(); const hit = root ? findRow(root, o.label) : null;
    if (hit) {
      if (current && current.getAttribute('aria-expanded') === 'true' && !boxOf(current)?.contains(hit.el)) current.click();
      over = true; o.found(hit); return;
    }
    tries++;
    if (root && tries >= 3 && tries < 120) {
      if (!wasOpen) wasOpen = Array.from(root.querySelectorAll<HTMLElement>('[data-settings-more][aria-expanded="true"]'));
      if (current) {
        if (++waited < 3) { o.later(step, every); return; }
        if (current.getAttribute('aria-expanded') === 'true') current.click();
        current = null;
      }
      let next: HTMLElement | undefined = closed(root)[0];
      if (!next && round === 0 && tried.size && tried.size <= 6) { round = 1; tried.clear(); next = closed(root)[0]; }
      if (next) { tried.add(next); current = next; waited = 0; next.click(); o.later(step, every); return; }
    }
    if (tries < 32) { o.later(step, every); return; }
    putBack(); o.gaveUp();
  };
  const putBack = () => {
    over = true;
    if (current && current.isConnected && current.getAttribute('aria-expanded') === 'true' && !(wasOpen || []).includes(current)) current.click();
    for (const b of wasOpen || []) if (b.isConnected && b.getAttribute('aria-expanded') === 'false') b.click();
  };
  step();
  return { cancel: () => { if (!over) putBack(); } };
}

export function RowFinder() {
  const params = useSearchParams();
  const pathname = usePathname();
  const find = params?.get('find') || '';
  const address = params?.toString() || '';
  const [again, setAgain] = React.useState(0);
  const [note, setNote] = React.useState('');
  const [said, setSaid] = React.useState('');

  React.useEffect(() => {
    const f = (e: Event) => { if (String((e as CustomEvent).detail || '').trim().toLowerCase() === find.trim().toLowerCase()) setAgain((n) => n + 1); };
    window.addEventListener('cf-find', f); return () => window.removeEventListener('cf-find', f);
  }, [find]);

  React.useEffect(() => {
    if (!find) return;
    const timers: ReturnType<typeof setTimeout>[] = []; const later = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };
    let marked: HTMLElement | null = null; let margin: string | null = null; let stopped = false;
    const still = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const point = ({ el, heading }: Hit) => {
      margin = el.style.scrollMarginTop; el.style.scrollMarginTop = '96px';
      const opts: ScrollIntoViewOptions = { block: heading ? 'start' : 'center', behavior: still() ? 'auto' : 'smooth' };
      el.scrollIntoView(opts);
      later(() => { if (!stopped && el.isConnected) el.scrollIntoView({ ...opts, behavior: 'auto' }); }, 450);
      el.classList.remove('cf-found-out'); el.classList.add('cf-found'); marked = el;
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
        el.setAttribute('tabindex', '-1'); el.setAttribute('data-cf-pointed', '');
        el.addEventListener('blur', () => { el.removeAttribute('tabindex'); el.removeAttribute('data-cf-pointed'); }, { once: true });
      }
      try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
      setNote(''); setSaid(''); later(() => setSaid(`Showing ${find}`), 60);
      later(() => { el.classList.remove('cf-found'); el.classList.add('cf-found-out'); later(() => el.classList.remove('cf-found-out'), 900); }, 2600);
    };
    // Giving up leaves the page where the owner has it (they may have started scrolling) and says why.
    const giveUp = async () => {
      let needsOther = false;
      try { needsOther = (await import('@/lib/settings-search')).rowNeedsOtherAt(find, pathname || '', params?.get('tab') || null, window.location.hash); } catch { /* the plain note */ }
      if (stopped) return;
      const text = needsOther ? `“${find}” shows once the setting it depends on is turned on.` : `Couldn’t point to “${find}” on this page.`;
      setNote(text); setSaid(''); later(() => setSaid(text), 60);
      later(() => setNote(''), 6000);
    };
    const seeking = seekRow({ root: () => document.getElementById('settings-page'), label: find, later, stopped: () => stopped, found: point, gaveUp: () => void giveUp() });
    return () => {
      stopped = true; timers.forEach(clearTimeout); setNote(''); seeking.cancel();
      if (marked) { marked.classList.remove('cf-found', 'cf-found-out'); if (margin !== null) marked.style.scrollMarginTop = margin; }
    };
  }, [find, pathname, address, again]);

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
      {note && (
        <div aria-hidden="true" className="fixed left-1/2 top-20 z-50 max-w-[92vw] -translate-x-1/2 rounded-full px-4 py-2.5 text-[14px] shadow-lg" style={{ background: C.ink, color: C.paper }}>{note}</div>
      )}
    </>
  );
}
