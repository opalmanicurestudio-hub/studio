// src/app/api/appointments/open-times/route.ts — REAL OPEN TIMES FOR THE DESK.
// The same availability engine as online booking and reschedules (hours, days
// off, blocks, other bookings, resources) — with the desk's freedoms: no minimum
// notice, no booking horizon. For a named provider, or anyone qualified (each
// time lists who's free). A custom length is checked at that length. Staff only.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { tenantTimeZone } from '@/lib/tenant-time';
import { computeAvailability } from '@/lib/availability';
import { loadBookingData, engineFrame, FALLBACK_HOURS } from '@/lib/booking-data';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), serviceId = String(b.serviceId || ''), date = String(b.date || '');
  if (!tenantId || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: 'Pick a service and a day.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const data: any = await loadBookingData(db, T);
  if (!data) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
  const raw = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const tz = tenantTimeZone(data.t);
  const addOnIds: string[] = Array.isArray(b.addOnIds) ? b.addOnIds.slice(0, 8).map(String) : [];
  let services = [...raw(data.sv), ...raw(data.rsv).map((x: any) => ({ ...x, staffIds: x.staffId ? [x.staffId] : x.staffIds }))];
  const svc = services.find((s: any) => s.id === serviceId);
  if (!svc) return NextResponse.json({ ok: false, error: 'That service wasn’t found.' }, { status: 404 });
  const len = Number(b.durationMinutes);
  if (Number.isFinite(len) && len >= 5 && len <= 600) {
    const addOnMin = addOnIds.reduce((m, id) => m + (Number(services.find((s: any) => s.id === id)?.duration) || 0), 0);
    services = services.map((s: any) => (s.id === serviceId ? { ...s, duration: Math.max(5, Math.round(len) - addOnMin) } : s));
  }
  const staffId = b.staffId && b.staffId !== 'any' ? String(b.staffId) : undefined;
  // One day's open times (the same engine and rules as online booking, with the desk's freedoms).
  const openOn = (day: string) => { const f = engineFrame({ appointments: raw(data.ap), events: raw(data.ce), staffBlocks: raw(data.sb), tickets: raw(data.tk) }, tz, day);
    const r: any = computeAvailability({
      date: day, serviceId, staffId, addOnIds, services, staff: raw(data.st).filter((m: any) => m.isActive !== false),
      appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now,
      scheduleProfiles: raw(data.sp), tenant: data.t, shifts: raw(data.sh), dayOffBlocks: raw(data.dof), resources: raw(data.rs), maintenancePlans: raw(data.mp),
      fallbackHours: FALLBACK_HOURS, ignoreHeuristics: true, includeUnavailable: false, ...({ minLeadMinutes: 0, maxHorizonDays: 3650 } as any) } as any);
    return (r?.times || []).map((t: string) => ({ time: t, label: r.byTime?.[t]?.[0]?.label || t, staff: (r.byTime?.[t] || []).map((x: any) => ({ id: x.staffId || x.staff?.id, name: x.staff?.name || x.staffName || '' })) })); };
  // FIND A TIME: { scanDays } — walk forward from `date` and return the first openings (up to 8, at most 3 per day).
  const scanDays = Math.max(0, Math.min(90, Math.round(Number(b.scanDays) || 0)));
  if (scanDays > 0) {
    const openings: any[] = []; const [y, mo, d] = date.split('-').map(Number);
    try { for (let i = 0; i < scanDays && openings.length < 8; i++) { const day = new Date(Date.UTC(y, mo - 1, d + i)).toISOString().slice(0, 10);
        const ts = openOn(day); for (const t of ts.slice(0, 3)) { if (openings.length >= 8) break; openings.push({ date: day, ...t }); } } }
    catch (e) { console.error('[open-times scan]', e); return NextResponse.json({ ok: false, error: 'Couldn’t work out open times.' }, { status: 500 }); }
    return NextResponse.json({ ok: true, date, openings, searchedDays: scanDays });
  }
  const f = engineFrame({ appointments: raw(data.ap), events: raw(data.ce), staffBlocks: raw(data.sb), tickets: raw(data.tk) }, tz, date);
  let res: any;
  try {
    res = computeAvailability({
      date, serviceId, staffId, addOnIds, services, staff: raw(data.st).filter((m: any) => m.isActive !== false),
      appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now,
      scheduleProfiles: raw(data.sp), tenant: data.t, shifts: raw(data.sh), dayOffBlocks: raw(data.dof), resources: raw(data.rs), maintenancePlans: raw(data.mp),
      fallbackHours: FALLBACK_HOURS, ignoreHeuristics: true, includeUnavailable: false,
      ...({ minLeadMinutes: 0, maxHorizonDays: 3650 } as any),   // the desk can book last-minute or far ahead
    } as any);
  } catch (e) { console.error('[open-times]', e); return NextResponse.json({ ok: false, error: 'Couldn’t work out open times.' }, { status: 500 }); }
  const times = (res?.times || []).map((t: string) => ({ time: t, label: res.byTime?.[t]?.[0]?.label || t, staff: (res.byTime?.[t] || []).map((x: any) => ({ id: x.staffId || x.staff?.id, name: x.staffName || x.staff?.name || '' })) }));
  return NextResponse.json({ ok: true, date, times });
}
