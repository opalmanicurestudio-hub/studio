'use client';
// src/hooks/useServerAvailability.ts — open times for one day, worked out on
// the SERVER (/api/booking/public-data, action 'availability') with the same
// engine the booking route verifies with. The browser never sees anyone
// else's appointments, shifts or days off — only which times are open.
// Returns the same fields the booking sheet used from useSmartAvailability.
import { useEffect, useRef, useState } from 'react';

export interface ServerAvailability { times: string[]; hotTimes: string[]; addOnUpsells: any[]; selectedSlotGap: number; warnings: string[]; staffByTime: Record<string, string[]>; loading: boolean }
const EMPTY: ServerAvailability = { times: [], hotTimes: [], addOnUpsells: [], selectedSlotGap: 0, warnings: [], staffByTime: {}, loading: false };

export function useServerAvailability(p: { tenantId?: string | null; date: string; serviceId: string; staffId: string; tierId?: string; providerId?: string | null; addOnIds?: string[]; extraMinutes?: number }): ServerAvailability {
  const [out, setOut] = useState<ServerAvailability>(EMPTY);
  const seq = useRef(0);
  const addOnKey = (p.addOnIds || []).join(',');
  useEffect(() => {
    if (!p.tenantId || !p.date || !p.serviceId) { setOut(EMPTY); return; }
    const my = ++seq.current; const ctrl = new AbortController();
    setOut((o) => ({ ...o, loading: true }));
    fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ tenantId: p.tenantId, action: 'availability', date: p.date, serviceId: p.serviceId, extraMinutes: p.extraMinutes || 0, staffId: p.staffId || 'any', tierId: p.tierId, providerId: p.providerId || undefined, addOnIds: p.addOnIds || [] }) })
      .then((r) => r.json()).then((d) => {
        if (my !== seq.current) return; // a newer request (the client tapped again) wins
        setOut(d?.ok ? { times: d.times || [], hotTimes: d.hotTimes || [], addOnUpsells: d.addOnUpsells || [], selectedSlotGap: d.bestGapMinutes || 0, warnings: d.warnings || [], staffByTime: d.staffByTime || {}, loading: false }
          : { ...EMPTY, warnings: [d?.error || 'Couldn’t load open times. Please try again.'] });
      })
      .catch((e) => { if (e?.name !== 'AbortError' && my === seq.current) setOut({ ...EMPTY, warnings: ['Couldn’t load open times — check your connection and try again.'] }); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tenantId, p.date, p.serviceId, p.staffId, p.tierId, p.providerId, addOnKey, p.extraMinutes]);
  return out;
}

/** "Any available": which provider the server would give this time to. */
export async function pickProvider(p: { tenantId: string; date: string; time: string; serviceId: string; tierId?: string; providerId?: string | null; addOnIds?: string[] }) {
  try {
    const r = await fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, action: 'pick', staffId: 'any' }) });
    const d = await r.json(); return d?.ok && d.staffId ? { ok: true as const, staffId: String(d.staffId) } : { ok: false as const, error: d?.error || 'No professionals are available for this time. Please pick another.' };
  } catch { return { ok: false as const, error: 'Couldn’t reach the booking system — check your connection and try again.' }; }
}
