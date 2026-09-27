// src/lib/booking-data.ts — everything the availability engine needs for one
// business, read on the SERVER. Shared by the public booking page's open
// times (/api/booking/public-data) and staff reschedules
// (/api/appointments/reschedule), so both reach the same verdict as the
// booking route. Returns raw query snapshots; callers decide what to expose.
import { tenantTimeZone, todayIn, tzOffsetMs, wallToUtc } from '@/lib/tenant-time';

export const FALLBACK_HOURS = { start: '08:00', end: '20:00' }; // same default as the browser hook (useSmartAvailability)

export async function loadBookingData(db: any, T: string) {
  const tSnap = await db.doc(T).get();
  if (!tSnap.exists) return null;
  const t = tSnap.data() as any;
  const tz = tenantTimeZone(t);
  const fromDay = todayIn(tz), eventsFromDay = todayIn(tz, new Date(Date.now() - 31 * 86400000));
  const safe = async (p: Promise<any>) => { try { return await p; } catch { return { docs: [] }; } };
  const [sv, st, se, ap, sp, pt, cf, sh, sb, dof, rs, tk, mp, ce, rsv] = await Promise.all([
    safe(db.collection(`${T}/services`).get()),
    safe(db.collection(`${T}/staff`).get()),
    safe(db.collection(`${T}/studioEvents`).get()),
    safe(db.collection(`${T}/appointments`).where('startTime', '>=', fromDay).get()),
    safe(db.collection(`${T}/scheduleProfiles`).get()),
    safe(db.collection(`${T}/pricingTiers`).get()),
    safe(db.collection(`${T}/consentForms`).get()),
    safe(db.collection(`${T}/shifts`).where('date', '>=', fromDay).get()),
    safe(db.collection(`${T}/staffBlocks`).where('startTime', '>=', fromDay).get()),
    safe(db.collection(`${T}/shiftDayOffBlocks`).where('date', '>=', fromDay).get()),
    safe(db.collection(`${T}/resources`).get()),
    safe(db.collection(`${T}/tickets`).where('status', 'in', ['open', 'in_progress']).get()),
    safe(db.collection(`${T}/maintenancePlans`).get()),
    safe(db.collection(`${T}/events`).where('startTime', '>=', eventsFromDay).get()),
    safe(db.collection(`${T}/renterServices`).get()),
  ]);
  return { t, fromDay, eventsFromDay, sv, st, se, ap, sp, pt, cf, sh, sb, dof, rs, tk, mp, ce, rsv };
}


/* ── ONE TIME FRAME (same as /api/appointments/book) ────────────────────
 * The engine compares wall-clock strings ("we open at 10:00") against
 * instants (an appointment's startTime). The server runs in UTC, so every
 * instant is moved into the business's local frame first — by that date's
 * offset (summer/winter time handled) — and "now" too. Skipping this shifts
 * every busy time by the zone offset (4–5 hours in the US).
 */
export function engineFrame(raw: { appointments: any[]; events: any[]; staffBlocks: any[]; tickets: any[] }, timeZone: string, dateStr: string) {
  const shiftMs = tzOffsetMs(timeZone, wallToUtc(dateStr, 12, 0, timeZone));
  const L = (v: any): string | null => {
    if (v === null || v === undefined || v === '') return null;
    const d = v?.toDate ? v.toDate() : v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + shiftMs).toISOString();
  };
  const appointments = raw.appointments
    .filter((a: any) => !['cancelled', 'canceled'].includes(String(a.status || '').toLowerCase()))
    .map((a: any) => { const s = L(a.startTime); return s ? { ...a, startTime: s, endTime: L(a.endTime) ?? s, createdAt: L(a.createdAt) ?? a.createdAt } : null; })
    .filter(Boolean);
  return {
    shiftMs,
    now: new Date(Date.now() + shiftMs),
    appointments,
    events: raw.events.map((e: any) => ({ ...e, startTime: L(e.startTime) ?? e.startTime, endTime: L(e.endTime) ?? e.endTime })),
    staffBlocks: raw.staffBlocks.map((b: any) => ({ ...b, startTime: L(b.startTime) ?? b.startTime, endTime: L(b.endTime) ?? b.endTime })),
    tickets: raw.tickets.map((t: any) => ({ ...t, createdAt: L(t.createdAt) ?? t.createdAt })),
  };
}
