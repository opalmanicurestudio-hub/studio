'use client';
// src/lib/client-crash.ts — WHEN A SCREEN CRASHES ON SOMEONE'S PHONE. Two things:
//   1. After an update, a phone that kept an old copy of the app open (very common for Home Screen apps) asks for files
//      that no longer exist. That isn't a real fault — reload once and it's fixed.
//   2. Anything else is reported (/api/client-error) so it can be found and fixed, and the person gets a plain screen
//      with a Reload button instead of a technical message.
export function isStaleCopy(e: any): boolean {
  const m = String(e?.message || e || '');
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(m) || e?.name === 'ChunkLoadError';
}
/** Reload once per few minutes (never in a loop). Returns true if a reload was started. */
export function reloadOnce(): boolean {
  try { const k = 'cf_reload_at'; const last = Number(sessionStorage.getItem(k) || 0); if (Date.now() - last < 3 * 60000) return false; sessionStorage.setItem(k, String(Date.now())); } catch { /* private mode: still reload */ }
  window.location.reload(); return true;
}
export function reportCrash(e: any, where: string, extra: Record<string, any> = {}) {
  try {
    const body = JSON.stringify({ where, message: String(e?.message || e || '').slice(0, 500), stack: String(e?.stack || '').slice(0, 2000), url: location.pathname + location.search, ua: navigator.userAgent.slice(0, 200), ...extra });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
    else fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* reporting must never crash */ }
}
