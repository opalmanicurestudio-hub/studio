'use client';
// Opens a staff-only print page with a fresh key. The tab opens first (so the browser allows it), then loads.
import { staffAuthHeader } from '@/lib/staff-fetch';

export async function openPrint(tenantId: string, scope: string, path: string): Promise<string | null> {
  const w = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
  try {
    const r = await fetch('/api/print-key', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, scope }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { w?.close(); return d.error || 'Couldn’t open that page.'; }
    const url = `${path}${path.includes('?') ? '&' : '?'}k=${encodeURIComponent(d.k)}&x=${d.x}`;
    if (w) w.location.href = url; else window.location.href = url;
    return null;
  } catch { w?.close(); return 'Couldn’t open that page. Check your connection.'; }
}
