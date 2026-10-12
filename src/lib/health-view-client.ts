// src/lib/health-view-client.ts — RECORD THAT SOMEONE OPENED A CLIENT'S HEALTH OR CONSENT ANSWERS (browser side).
// Fire and forget: it never blocks or slows the screen. Only sent while health information mode is on
// (lib/health-privacy privacyOf; given only the business's id, the server decides). The same view is recorded at most once every five minutes per screen session,
// so re-renders and tab switching don't flood the log.
import { privacyOf } from '@/lib/health-privacy';
import { staffAuthHeader } from '@/lib/staff-fetch';

const seen = new Map<string, number>();
export function logHealthOpen(tenant: any | string, v: { clientId?: string | null; what: string; appointmentId?: string | null }) {
  const tenantId = typeof tenant === 'string' ? tenant : tenant?.id;
  if (!tenantId || !v.clientId || (typeof tenant !== 'string' && !privacyOf(tenant).healthMode)) return;
  const key = `${tenantId}:${v.clientId}:${v.what}:${v.appointmentId || ''}`; const now = Date.now();
  if ((seen.get(key) || 0) > now - 5 * 60000) return; seen.set(key, now);
  void (async () => {
    try { await fetch('/api/privacy/view-log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
      body: JSON.stringify({ tenantId, clientId: v.clientId, what: v.what, appointmentId: v.appointmentId || null }) }); } catch { /* never blocks */ }
  })();
}
