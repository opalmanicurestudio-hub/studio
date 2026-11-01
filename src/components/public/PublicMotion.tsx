'use client';
// src/components/public/PublicMotion.tsx — lets the sections of a public page rise in once as they come into view.
// It marks the page as able to animate (.pub-js) only once it's running, so a page without it, or a phone that
// asks for less motion, shows everything in place. Sections already on screen show at once, and a section counts as
// seen as soon as any of it is on screen, however tall it is (a long menu, a phone on its side, a zoomed-in page).
// On a Night page it also darkens the browser's own edges (scrollbars, the area past the page when it bounces).

import * as React from 'react';

export function PublicMotion({ reveal = true, night = false }: { reveal?: boolean; night?: boolean }) {
  const mark = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (!night) return;
    const html = document.documentElement, body = document.body;
    const was = { scheme: html.style.colorScheme, bg: body.style.background };
    html.style.colorScheme = 'dark'; body.style.background = '#16171a';
    return () => { html.style.colorScheme = was.scheme; body.style.background = was.bg; };
  }, [night]);
  React.useEffect(() => {
    if (!reveal) return;
    const root = mark.current?.closest('.pub') as HTMLElement | null; if (!root) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still || typeof IntersectionObserver === 'undefined') return;
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    const watch = () => root.querySelectorAll('.pub-reveal:not(.is-in)').forEach((el) => {
      if (seen.has(el)) return; seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');   // already in view: no wait, no flash
      else io.observe(el);
    });
    watch();
    root.classList.add('pub-js');
    const mo = new MutationObserver(watch); mo.observe(root, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); root.classList.remove('pub-js'); };
  }, [reveal]);
  return <span ref={mark} hidden />;
}
