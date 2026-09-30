// src/lib/rebook.ts — BOOK THE NEXT VISIT (server). Used by the client screen (and later the visit link).
//  • The return plan: what they come back for, when, and what to book if they've left it too long.
//      service.returnServiceId (default: the same service) · service.returnMinWeeks / returnMaxWeeks
//      (default: rebookWeeks −1 / +1, else the business's quick picks) · service.lateServiceId (past the window)
//  • Real open times — the SAME engine as online booking and the desk (hours, days off, blocks, other bookings,
//    resources), in the business's time zone.
//  • Their usual day and time, from past visits — so the first suggestions are the ones they'd pick anyway.
import { computeAvailability } from '@/lib/availability';
import { loadBookingData, engineFrame, FALLBACK_HOURS } from '@/lib/booking-data';
import { tenantTimeZone, wallToUtc, todayIn } from '@/lib/tenant-time';

export interface ReturnPlan { serviceId: string; serviceName: string; minWeeks: number; maxWeeks: number; lateServiceId: string | null; lateServiceName: string | null; why: string }
export interface Slot { startIso: string; date: string; time: string; label: string; dayLabel: string; staffId: string; staffName: string }

const clampW = (n: any, d: number) => { const v = Math.round(Number(n)); return Number.isFinite(v) && v >= 1 && v <= 52 ? v : d; };
export function returnPlanOf(svc: any, services: any[], quickWeeks: number[] = [2, 4, 6, 8]): ReturnPlan {
  const target = (svc?.returnServiceId && services.find((s: any) => s.id === svc.returnServiceId)) || svc;
  const rw = Number(svc?.rebookWeeks) || 0;
  const minWeeks = clampW(svc?.returnMinWeeks, rw ? Math.max(1, rw - 1) : quickWeeks[0] || 2);
  const maxWeeks = Math.max(minWeeks, clampW(svc?.returnMaxWeeks, rw ? rw + 1 : quickWeeks[quickWeeks.length - 1] || 8));
  const late = svc?.lateServiceId ? services.find((s: any) => s.id === svc.lateServiceId) : null;
  const why = target?.id !== svc?.id ? `Recommended ${minWeeks === maxWeeks ? `${minWeeks}` : `${minWeeks}–${maxWeeks}`} weeks after ${svc?.name || 'today'}` : `Recommended every ${minWeeks === maxWeeks ? minWeeks : `${minWeeks}–${maxWeeks}`} weeks`;
  return { serviceId: target?.id || svc?.id, serviceName: target?.name || svc?.name || 'Your next visit', minWeeks, maxWeeks, lateServiceId: late?.id || null, lateServiceName: late?.name || null, why };
}

/** Their usual weekday (0–6) and time (minutes after midnight), from their last visits. */
export function usualOf(pastStarts: string[], tz: string): { weekday: number | null; minutes: number | null } {
  const parts = pastStarts.slice(-8).map((iso) => { const d = new Date(iso); const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(d);
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(f.find((p) => p.type === 'weekday')?.value || ''); const h = Number(f.find((p) => p.type === 'hour')?.value) % 24; const m = Number(f.find((p) => p.type === 'minute')?.value) || 0;
    return { wd, min: h * 60 + m }; }).filter((p) => p.wd >= 0);
  if (!parts.length) return { weekday: null, minutes: null };
  const counts = new Map<number, number>(); for (const p of parts) counts.set(p.wd, (counts.get(p.wd) || 0) + 1);
  const weekday = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const mins = parts.map((p) => p.min).sort((a, b) => a - b); return { weekday, minutes: mins[Math.floor(mins.length / 2)] };
}

/** The booking engine, loaded once per request. */
export async function engineFor(db: any, tenantId: string) {
  const T = `tenants/${tenantId}`; const data: any = await loadBookingData(db, T); if (!data) return null;
  const raw = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const services = [...raw(data.sv), ...raw(data.rsv).map((x: any) => ({ ...x, staffIds: x.staffId ? [x.staffId] : x.staffIds }))];
  const staff = raw(data.st).filter((m: any) => m.isActive !== false);
  return { data, raw, tz: tenantTimeZone(data.t), services, staff, tenant: data.t };
}
type Engine = NonNullable<Awaited<ReturnType<typeof engineFor>>>;

const dayLabelOf = (date: string, tz: string) => new Date(wallToUtc(date, 12, 0, tz)).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
/** Real open times on one day, for one provider (or anyone qualified). */
export function openTimesOn(e: Engine, o: { date: string; serviceId: string; staffId?: string | null; addOnIds?: string[] }): Slot[] {
  const f = engineFrame({ appointments: e.raw(e.data.ap), events: e.raw(e.data.ce), staffBlocks: e.raw(e.data.sb), tickets: e.raw(e.data.tk) }, e.tz, o.date);
  let res: any;
  try {
    res = computeAvailability({ date: o.date, serviceId: o.serviceId, staffId: o.staffId && o.staffId !== 'any' ? o.staffId : undefined, addOnIds: o.addOnIds || [], services: e.services, staff: e.staff,
      appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now, scheduleProfiles: e.raw(e.data.sp), tenant: e.tenant, shifts: e.raw(e.data.sh),
      dayOffBlocks: e.raw(e.data.dof), resources: e.raw(e.data.rs), maintenancePlans: e.raw(e.data.mp), fallbackHours: FALLBACK_HOURS, ignoreHeuristics: true, includeUnavailable: false,
      ...({ minLeadMinutes: 60, maxHorizonDays: 400 } as any) } as any);
  } catch { return []; }
  const dayLabel = dayLabelOf(o.date, e.tz);
  return (res?.times || []).flatMap((t: string) => {
    const who = (res.byTime?.[t] || [])[0]; const [h, m] = String(t).split(':').map(Number); if (!Number.isFinite(h)) return [];
    const staffId = who?.staffId || who?.staff?.id || o.staffId || ''; const staffName = who?.staff?.name || e.staff.find((s: any) => s.id === staffId)?.name || '';
    return [{ startIso: wallToUtc(o.date, h, m || 0, e.tz).toISOString(), date: o.date, time: t, label: who?.label || new Date(wallToUtc(o.date, h, m || 0, e.tz)).toLocaleTimeString('en-US', { timeZone: e.tz, hour: 'numeric', minute: '2-digit' }), dayLabel, staffId, staffName: String(staffName).split(' ')[0] }];
  });
}
export const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** The best few times in the window — one per day, closest to their usual day and time, earliest first. */
export function suggestSlots(e: Engine, o: { serviceId: string; staffId?: string | null; addOnIds?: string[]; fromWeeks: number; toWeeks: number; usual: { weekday: number | null; minutes: number | null }; count: number; maxDays?: number }): Slot[] {
  const today = todayIn(e.tz); const start = addDays(today, o.fromWeeks * 7); const span = Math.min(o.maxDays || 28, Math.max(7, (o.toWeeks - o.fromWeeks) * 7 + 7));
  const scored: { s: Slot; score: number }[] = [];
  for (let i = 0; i < span; i++) {
    const date = addDays(start, i); const times = openTimesOn(e, { date, serviceId: o.serviceId, staffId: o.staffId, addOnIds: o.addOnIds }); if (!times.length) continue;
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    const best = times.map((s) => { const [h, m] = s.time.split(':').map(Number); const min = h * 60 + (m || 0);
      const score = (o.usual.weekday === null ? 0 : (wd === o.usual.weekday ? 0 : 400)) + (o.usual.minutes === null ? 0 : Math.abs(min - o.usual.minutes)) + i * 2; return { s, score }; }).sort((a, b) => a.score - b.score)[0];
    scored.push(best);
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, o.count).map((x) => x.s).sort((a, b) => a.startIso.localeCompare(b.startIso));
}
