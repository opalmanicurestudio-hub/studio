'use client';
// src/hooks/useServerAvailability.ts — open times for one day, worked out on
// the SERVER (/api/booking/public-data, action 'availability') with the same
// engine the booking route verifies with. The browser never sees anyone
// else's appointments, shifts or days off — only which times are open.
// Returns the same fields the booking sheet used from useSmartAvailability.
import { holdParam } from '@/lib/agent-hold-param';
import { useEffect, useRef, useState } from 'react';

export interface ServerAvailability { times: string[]; hotTimes: string[]; addOnUpsells: any[]; selectedSlotGap: number; warnings: string[]; staffByTime: Record<string, string[]>; loading: boolean }
const EMPTY: ServerAvailability = { times: [], hotTimes: [], addOnUpsells: [], selectedSlotGap: 0, warnings: [], staffByTime: {}, loading: false };

export function useServerAvailability(p: { tenantId?: string | null; date: string; serviceId: string; staffId: string; tierId?: string; providerId?: string | null; addOnIds?: string[]; extraMinutes?: number }): ServerAvailability {
  const [out, setOut] = useState<ServerAvailability & { key?: string }>(EMPTY);
  const seq = useRef(0);
  const addOnKey = (p.addOnIds || []).join(',');
  // What these times are for. Until the answer for exactly this arrives, it's loading, from the very first render
  // after a change, so times for another day or visit are never shown as this one's.
  const key = [p.tenantId, p.date, p.serviceId, p.staffId, p.tierId, p.providerId, addOnKey, p.extraMinutes || 0].join('|');
  useEffect(() => {
    if (!p.tenantId || !p.date || !p.serviceId) { setOut({ ...EMPTY, key }); return; }
    const my = ++seq.current; const ctrl = new AbortController();
    fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ tenantId: p.tenantId, action: 'availability', date: p.date, serviceId: p.serviceId, extraMinutes: p.extraMinutes || 0, staffId: p.staffId || 'any', tierId: p.tierId, providerId: p.providerId || undefined, addOnIds: p.addOnIds || [], holdId: holdParam() || undefined }) })
      .then((r) => r.json()).then((d) => {
        if (my !== seq.current) return; // a newer request (the client tapped again) wins
        setOut(d?.ok ? { key, times: d.times || [], hotTimes: d.hotTimes || [], addOnUpsells: d.addOnUpsells || [], selectedSlotGap: d.bestGapMinutes || 0, warnings: d.warnings || [], staffByTime: d.staffByTime || {}, loading: false }
          : { ...EMPTY, key, warnings: [d?.error || 'Couldn’t load open times. Please try again.'] });
      })
      .catch((e) => { if (e?.name !== 'AbortError' && my === seq.current) setOut({ ...EMPTY, key, warnings: ['Couldn’t load open times. Check your connection and try again.'] }); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tenantId, p.date, p.serviceId, p.staffId, p.tierId, p.providerId, addOnKey, p.extraMinutes]);
  if (out.key !== key) return { ...EMPTY, loading: !!(p.tenantId && p.date && p.serviceId) };
  const { key: _k, ...answer } = out; void _k;
  return answer;
}

/** "Any available": which provider the server would give this time to. */
export async function pickProvider(p: { tenantId: string; date: string; time: string; serviceId: string; tierId?: string; providerId?: string | null; addOnIds?: string[]; extraMinutes?: number }) {
  try {
    const r = await fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, action: 'pick', staffId: 'any', holdId: holdParam() || undefined }) });
    const d = await r.json(); return d?.ok && d.staffId ? { ok: true as const, staffId: String(d.staffId) } : { ok: false as const, error: d?.error || 'No professionals are available for this time. Please pick another.' };
  } catch { return { ok: false as const, error: 'Couldn’t reach the booking system — check your connection and try again.' }; }
}
