// src/lib/reschedule-slots.ts — OPEN TIMES TO MOVE AN APPOINTMENT TO (server).
// The same availability engine the staff reschedule uses (hours, days off,
// blocks, other bookings, resources) — but with the business's NORMAL client
// rules (lead time, how far ahead, spacing), not the staff overrides. The
// appointment itself doesn't block its own new time. Same provider, same
// service, same length.
import { tenantTimeZone, addDays as addDaysStr } from '@/lib/tenant-time';
import { computeAvailability } from '@/lib/availability';
import { loadBookingData, engineFrame, FALLBACK_HOURS } from '@/lib/booking-data';

export async function clientOpenTimes(db: any, tenantId: string, appointmentId: string, appt: any, fromDate: string, days: number): Promise<{ ok: boolean; days: { date: string; times: string[] }[]; error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return { ok: false, days: [], error: 'Pick a day.' };
  const T = `tenants/${tenantId}`;
  const data = await loadBookingData(db, T); if (!data) return { ok: false, days: [], error: 'Unknown business.' };
  const t = data.t; const tz = tenantTimeZone(t);
  const raw = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const staff = raw(data.st).filter((m: any) => m.isActive !== false);
  const services = [...raw(data.sv), ...raw(data.rsv).map((x: any) => ({ ...x, staffIds: x.staffId ? [x.staffId] : x.staffIds }))];
  const service = services.find((s: any) => s.id === appt.serviceId);
  if (!service || !appt.staffId) return { ok: false, days: [], error: 'We can’t list times for this appointment online.' };
  const duration = Math.max(5, Math.round((Date.parse(appt.endTime) - Date.parse(appt.startTime)) / 60000) || Number(service.duration) || 60);
  const others = raw(data.ap).filter((a: any) => a.id !== appointmentId);
  const base: any = {
    serviceId: service.id, staffId: appt.staffId, services: services.map((s: any) => (s.id === service.id ? { ...s, duration } : s)), staff, scheduleProfiles: raw(data.sp), tenant: { id: tenantId, ...t },
    shifts: raw(data.sh), dayOffBlocks: raw(data.dof), resources: raw(data.rs), maintenancePlans: raw(data.mp), fallbackHours: FALLBACK_HOURS, includeUnavailable: false,
  };
  const out: { date: string; times: string[] }[] = [];
  for (let i = 0; i < Math.max(1, Math.min(21, days)); i++) {
    const d = addDaysStr(fromDate, i);
    const f = engineFrame({ appointments: others, events: raw(data.ce), staffBlocks: raw(data.sb), tickets: raw(data.tk) }, tz, d);
    let times: string[] = [];
    try { times = computeAvailability({ ...base, date: d, appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now }).times; } catch { /* unreadable day */ }
    out.push({ date: d, times });
  }
  return { ok: true, days: out };
}
