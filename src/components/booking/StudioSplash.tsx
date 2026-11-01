'use client';
// src/components/booking/StudioSplash.tsx — the opening splash on a business's booking page: their color, their
// logo (or first letter) with a soft ring, their name and city, then the page rises in underneath. Under a second,
// only the first time a visitor opens the page in a visit to the site, never in the Settings preview, and never for
// anyone whose phone asks for less motion. The page is already there underneath; the splash is only a curtain, and a
// tap on it lifts it at once.

import * as React from 'react';

const KEY = (tenantId: string) => `cf.splash.${tenantId}`;

/** Whether the splash should play: decided once, on the first render in the browser. */
export function useSplash(tenantId: string | undefined, on: boolean): [boolean, () => void] {
  const [show, setShow] = React.useState(() => {
    if (!on || !tenantId || typeof window === 'undefined') return false;
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
      return !sessionStorage.getItem(KEY(tenantId));
    } catch { return false; }   // storage blocked: no splash rather than one on every page
  });
  // Remembered once it has played, so moving around the site doesn't show it again.
  React.useEffect(() => { if (show && tenantId) try { sessionStorage.setItem(KEY(tenantId), '1'); } catch { /* none */ } }, [show, tenantId]);
  return [show, React.useCallback(() => setShow(false), [])];
}

export function StudioSplash({ name, city, logoUrl, onDone }: { name: string; city?: string; logoUrl?: string | null; onDone: () => void }) {
  const doneRef = React.useRef(onDone); doneRef.current = onDone;
  React.useEffect(() => { const t = window.setTimeout(() => doneRef.current(), 1100); return () => window.clearTimeout(t); }, []);
  const letter = (name.trim()[0] || '·').toUpperCase();
  return (
    <div aria-hidden className="cf-splash fixed inset-0 z-[60] flex flex-col items-center justify-center text-white" style={{ background: 'var(--accent)' }}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) doneRef.current(); }} onClick={() => doneRef.current()}>
      <style>{SPLASH_CSS}</style>
      <div className="relative h-24 w-24">
        <span className="cf-splash-ring absolute inset-0 rounded-[30px] border-2 border-white/60" />
        <span className="cf-splash-mark absolute inset-0 grid place-items-center overflow-hidden rounded-[30px] text-[44px] font-bold" style={{ background: '#fff', color: 'var(--accent)' }}>
          {logoUrl ? <img src={logoUrl} alt="" className="h-16 w-16 object-contain" /> : letter}
        </span>
      </div>
      <p className="cf-splash-name mt-5 px-6 text-center text-[20px] font-semibold tracking-tight">{name}</p>
      {city && <p className="cf-splash-name mt-1.5 text-[14px] opacity-85">{city}</p>}
    </div>
  );
}

// Under a second in all: the mark settles in, holds, then the curtain lifts as the page rises beneath it.
const SPLASH_CSS = `
@keyframes cfSplashBg{0%,62%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-24px)}}
@keyframes cfSplashMark{0%{opacity:0;transform:scale(.86)}24%{opacity:1;transform:scale(1)}62%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.04)}}
@keyframes cfSplashName{0%,12%{opacity:0;transform:translateY(8px)}34%,62%{opacity:1;transform:none}100%{opacity:0}}
@keyframes cfSplashRing{0%{transform:scale(.6);opacity:.5}100%{transform:scale(1.9);opacity:0}}
.cf-splash{animation:cfSplashBg .95s cubic-bezier(.2,.8,.2,1) both}
.cf-splash-mark{animation:cfSplashMark .95s cubic-bezier(.2,.8,.2,1) both}
.cf-splash-name{animation:cfSplashName .95s cubic-bezier(.2,.8,.2,1) both}
.cf-splash-ring{animation:cfSplashRing .9s ease-out both}
@media (prefers-reduced-motion:reduce){.cf-splash{display:none}}
`;
