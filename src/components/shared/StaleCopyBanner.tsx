'use client';
// src/components/shared/StaleCopyBanner.tsx
//
// "YOU'RE ON AN OLD COPY OF THE APP."
//
// Every Vercel deployment lives forever at its own address, frozen at the
// code it was built from. Open one (an old email link, a bookmark, a
// shared link) and nothing you fix ever shows up there — Accept fails,
// counts don't move. This banner appears ONLY on such an address and takes
// you to the same page on the live app in one tap.

import { useEffect, useState } from 'react';
import { isFrozenHost } from '@/lib/app-origin';

export function StaleCopyBanner() {
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    const prod = String(process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!prod) return;
    if (isFrozenHost(window.location.host, prod)) setLive(`https://${prod}${window.location.pathname}${window.location.search}${window.location.hash}`);
  }, []);
  if (!live) return null;
  return (
    <div role="alert" className="sticky top-0 z-[60] flex items-center gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2.5 text-amber-950" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}>
      <p className="min-w-0 flex-1 text-[12px] font-bold leading-snug">You’re on an old copy of the app. It won’t get fixes or updates.</p>
      <a href={live} className="shrink-0 rounded-xl bg-amber-900 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white">Open the live app</a>
    </div>
  );
}
