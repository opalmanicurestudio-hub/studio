// src/lib/redo-times.ts — WHEN CAN THE REDO HAPPEN? The same availability engine the booking page and reschedules use
// (the provider's hours, shifts, days off, blocks, other bookings, rooms and equipment, and the business's normal client
// rules), for the SAME service at the SAME length as the original visit, over the next few days the business set.
// The original provider is asked first (when the business says so); "someone else" lists the other people who do that
// service and can see this client. bookRedo checks the time is still free at the moment it's booked.
import { clientOpenTimes } from '@/lib/reschedule-slots';
import { eligibleFor } from '@/lib/availability';
import { tenantTimeZone, todayIn, wallToUtc } from '@/lib/tenant-time';
import { settingsOf } from '@/lib/making-it-right';

const T = (t: string) => `tenants/${t}`;
export type ProviderTimes = { staffId: string; name: string; original: boolean; days: { date: string; times: string[] }[] };

/** How long the redo takes: the original visit's length (or what the team set). */
export async function redoMinutes(db: any, tenantId: string, c: any): Promise<number> {
  if (Number(c.fix?.redo?.minutes) > 0) return Number(c.fix.redo.minutes);
  const a: any = c.visit?.appointmentId ? (await db.doc(`${T(tenantId)}/appointments/${c.visit.appointmentId}`).get()).data() || {} : {};
  const m = Math.round((Date.parse(a.endTime) - Date.parse(a.startTime)) / 60000);
  return Number.isFinite(m) && m >= 15 ? Math.min(480, m) : Math.max(15, Number(a.duration) || 60);
}

export async function redoTimes(db: any, tenantId: string, c: any, opts: { staffId?: string; from?: string; others?: boolean; days?: number } = {}): Promise<{ ok: boolean; providers: ProviderTimes[]; minutes: number; error?: string }> {
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const S = settingsOf(tenant); const tz = tenantTimeZone(tenant);
  if (!c.visit?.serviceId) return { ok: false, providers: [], minutes: 0, error: 'This case has no service to redo.' };
  const minutes = await redoMinutes(db, tenantId, c);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from || '')) ? String(opts.from) : todayIn(tz);
  const days = Math.max(1, Math.min(21, opts.days || S.redoLookDays));
  const original = String(c.fix?.redo?.staffId || c.visit.providerId || '');
  const staff = (await db.collection(`${T(tenantId)}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true && s.isActive !== false && !s.isRenter && s.role !== 'renter');
  let ids: string[];
  if (opts.staffId) ids = [opts.staffId];
  else if (!opts.others) ids = original ? [original] : [];
  else {
    const svc: any = (await db.doc(`${T(tenantId)}/services/${c.visit.serviceId}`).get()).data() || {};
    const client: any = c.clientId ? (await db.doc(`${T(tenantId)}/clients/${c.clientId}`).get()).data() || {} : {};
    const allowed = Array.isArray(svc.staffIds) && svc.staffIds.length ? staff.filter((s: any) => svc.staffIds.includes(s.id)) : staff;
    ids = eligibleFor(svc, allowed, client).map((s: any) => s.id).filter((id: string) => id !== original).slice(0, 4);
  }
  const start = new Date(Date.now()).toISOString(); const end = new Date(Date.now() + minutes * 60000).toISOString();
  const providers: ProviderTimes[] = [];
  for (const id of ids) {
    const r = await clientOpenTimes(db, tenantId, '__redo__', { serviceId: c.visit.serviceId, staffId: id, startTime: start, endTime: end }, from, days);
    const s = staff.find((x: any) => x.id === id);
    if (r.ok) providers.push({ staffId: id, name: String(s?.name || c.visit.providerName || 'Provider'), original: id === original, days: r.days.filter((d) => d.times.length) });
  }
  return { ok: true, providers, minutes };
}

/** Is that time still open for that provider right now? Returns the moment it starts. */
export async function redoSlotFree(db: any, tenantId: string, c: any, staffId: string, date: string, time: string): Promise<{ ok: boolean; start?: Date; minutes?: number; error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: 'Pick a day and time.' };
  const r = await redoTimes(db, tenantId, c, { staffId, from: date, days: 1 });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.providers[0]?.days[0]?.times.includes(time)) return { ok: false, error: 'That time was just taken — pick another.' };
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {};
  const [hh, mm] = time.split(':').map(Number);
  return { ok: true, start: wallToUtc(date, hh, mm, tenantTimeZone(tenant)), minutes: r.minutes };
}
