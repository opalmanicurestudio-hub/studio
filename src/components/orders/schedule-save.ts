// src/components/orders/schedule-save.ts — saves a change to the shipping schedule through the server
// (api/retail/ship-schedule), so a manager can make it too, not only the owner. Busy periods change one at a time, by
// their id, so one change never overwrites another. What comes back is the schedule as it was kept.
import { staffAuthHeader } from '@/lib/staff-fetch';
import type { BusyPeriod, ShipSchedule } from '@/lib/ship-promise';

export type ScheduleSaved = { ok: boolean; error?: string; schedule?: ShipSchedule };
export type BusyChange = { op: 'upsert'; period: BusyPeriod } | { op: 'remove'; id: string } | { op: 'end'; id: string };

async function send(body: any): Promise<ScheduleSaved> {
  try {
    const r = await fetch('/api/retail/ship-schedule', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, schedule: d.schedule } : { ok: false, error: d.error ? String(d.error) : undefined };
  } catch { return { ok: false }; }
}

/** Any part of the schedule but its busy periods. */
export const saveSchedule = (tenantId: string, patch: Partial<Omit<ShipSchedule, 'busy'>>) => send({ tenantId, patch });
/** One busy period: add or replace it, remove it, or end it now. */
export const saveBusy = (tenantId: string, change: BusyChange) => send({ tenantId, busy: change });
