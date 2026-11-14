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
  // Taps kept on this device through a Wi-Fi drop (lib/outbox) go by themselves whatever page is open, not only on a
  // floor screen. Loaded only when some are waiting.
  useEffect(() => {
    try { if (!localStorage.getItem('cf.outbox.v1')) return; } catch { return; }
    void import('@/lib/outbox').then((m) => m.startOutbox()).catch(() => {});
  }, []);
  // What floor screens kept for the person signed in (lib/last-seen) is cleared when they sign out, on any page.
  useEffect(() => {
    let any = false; try { for (let i = 0; i < localStorage.length; i++) if (String(localStorage.key(i)).startsWith('cf.last.')) { any = true; break; } } catch { return; }
    if (any) void import('@/lib/last-seen').then((m) => m.watchSignOut()).catch(() => {});
  }, []);
  return null;
}
