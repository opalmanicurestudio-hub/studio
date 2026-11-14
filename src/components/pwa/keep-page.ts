'use client';
// src/components/pwa/keep-page.ts — a floor screen asks the service worker (public/sw.js) to keep its empty page, so it
// still opens through a Wi-Fi drop even when it was reached inside the app rather than loaded directly. Only the page
// itself is kept, never what's on it (that's lib/last-seen, with its time).
import { useEffect } from 'react';

export function useKeepPage() {
  useEffect(() => {
    try {
      const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined; if (!sw) return;
      const ask = () => sw.controller?.postMessage({ type: 'cf-keep', url: window.location.href });
      if (sw.controller) ask(); else void sw.ready.then(() => ask()).catch(() => undefined);
    } catch { /* no service worker here */ }
  }, []);
}
