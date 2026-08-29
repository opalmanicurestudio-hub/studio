'use client';

import { useEffect } from 'react';

/**
 * Registers the installability service worker once the page is interactive.
 * Registration is idempotent and best-effort: if it fails, the site is
 * exactly what it was before — a working web app — so no error surfaces.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
