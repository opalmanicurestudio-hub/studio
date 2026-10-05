// src/app/api/appointments/open-times/route.ts — REAL OPEN TIMES FOR THE DESK.
// The same availability engine as online booking and reschedules (hours, days
// off, blocks, other bookings, resources) — with the desk's freedoms: no minimum
// notice, no booking horizon. For a named provider, or anyone qualified (each
// time lists who's free). A custom length is checked at that length. Staff only.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { tenantTimeZone, wallToUtc } from '@/lib/tenant-time';
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
  const openOn = (day: string, sid: string = serviceId) => { const f = engineFrame({ appointments: raw(data.ap), events: raw(data.ce), staffBlocks: raw(data.sb), tickets: raw(data.tk) }, tz, day);
    const r: any = computeAvailability({
      date: day, serviceId: sid, staffId: sid === serviceId ? staffId : undefined, addOnIds: sid === serviceId ? addOnIds : [], services, staff: raw(data.st).filter((m: any) => m.isActive !== false),
      appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now,
      scheduleProfiles: raw(data.sp), tenant: data.t, shifts: raw(data.sh), dayOffBlocks: raw(data.dof), resources: raw(data.rs), maintenancePlans: raw(data.mp),
      fallbackHours: FALLBACK_HOURS, ignoreHeuristics: true, includeUnavailable: false, ...({ minLeadMinutes: 0, maxHorizonDays: 3650 } as any) } as any);
    return (r?.times || []).map((t: string) => ({ time: t, label: r.byTime?.[t]?.[0]?.label || t, staff: (r.byTime?.[t] || []).map((x: any) => ({ id: x.staffId || x.staff?.id, name: x.staff?.name || x.staffName || '' })) })); };
  // FIND A TIME FOR A GROUP: { scanDays, party: [serviceId, …] } — times when every person can start together, each with
  // a DIFFERENT provider (the engine's own free list per service), and enough units of any shared resource free for all
  // of them. Up to 6 openings, at most 2 a day, each with who'd do whom.
  const party: string[] = Array.isArray(b.party) ? b.party.slice(0, 13).map((x: any) => String(x)) : [];
  if (party.length >= 2 && Math.round(Number(b.scanDays) || 0) > 0) {
    const days = Math.max(1, Math.min(60, Math.round(Number(b.scanDays))));
    const resources = raw(data.rs); const svcOf = (id: string) => services.find((x: any) => x.id === id) || {};
    const needs = (id: string): string[] => (svcOf(id).requiredResourceIds || []).map(String);
    const durOf = (id: string) => (Number(svcOf(id).duration) || 60) + (Number(svcOf(id).padBefore) || 0) + (Number(svcOf(id).padAfter) || 0);
    const booked = raw(data.ap).filter((a: any) => !['cancelled', 'declined', 'no_show'].includes(String(a.status)));
    // Assign a different provider to each person (small backtracking — groups are small).
    const assign = (choices: { id: string; name: string }[][]): { id: string; name: string }[] | null => {
      // Fewest choices first (the hardest person to place), then try each free provider not already taken.
      const order = choices.map((_, i) => i).sort((x, y) => choices[x].length - choices[y].length); const used = new Set<string>(); const pick: Record<number, { id: string; name: string }> = {};
      const go = (k: number): boolean => { if (k === order.length) return true; const i = order[k];
        for (const c of choices[i]) { if (!c?.id || used.has(c.id)) continue; used.add(c.id); pick[i] = c; if (go(k + 1)) return true; used.delete(c.id); } return false; };
      return go(0) ? choices.map((_, i) => pick[i]) : null; };
    const resourcesFree = (day: string, time: string) => { const [hh, mm] = time.split(':').map(Number); const start = wallToUtc(day, hh, mm, tz).getTime();
      const want = new Map<string, number>(); party.forEach((sid) => needs(sid).forEach((r) => want.set(r, (want.get(r) || 0) + 1)));
      for (const [rid, n] of want) { const r: any = resources.find((x: any) => x.id === rid); if (!r || r.isOutOfService) return false; const cap = Math.max(0, Number(r.capacity) || 1);
        const end = start + Math.max(...party.filter((sid) => needs(sid).includes(rid)).map(durOf)) * 60000;
        const inUse = booked.filter((a: any) => needs(String(a.serviceId)).includes(rid) && new Date(a.startTime).getTime() < end && new Date(a.endTime || a.startTime).getTime() > start).length;
        if (cap - inUse < n) return false; }
      return true; };
    const openings: any[] = []; const [y, mo, d] = date.split('-').map(Number);
    try { for (let i = 0; i < days && openings.length < 6; i++) { const day = new Date(Date.UTC(y, mo - 1, d + i)).toISOString().slice(0, 10);
        const per = [...new Set(party)].reduce((m: Map<string, any[]>, sid) => m.set(sid, openOn(day, sid)), new Map<string, any[]>());
        const times = (per.get(party[0]) || []).map((t: any) => t.time).filter((t: string) => party.every((sid) => (per.get(sid) || []).some((x: any) => x.time === t)));
        let today = 0;
        for (const t of times) { if (today >= 2 || openings.length >= 6) break;
          const choices = party.map((sid) => ((per.get(sid) || []).find((x: any) => x.time === t)?.staff || []) as { id: string; name: string }[]);
          const who = assign(choices); if (!who || !resourcesFree(day, t)) continue;
          const label = (per.get(party[0]) || []).find((x: any) => x.time === t)?.label || t;
          openings.push({ date: day, time: t, label, assignment: party.map((sid, k) => ({ serviceId: sid, staffId: who[k].id, staffName: who[k].name })) }); today++; } } }
    catch (e) { console.error('[open-times group]', e); return NextResponse.json({ ok: false, error: 'Couldn’t work out open times.' }, { status: 500 }); }
    return NextResponse.json({ ok: true, date, openings, searchedDays: days, party: party.length });
  }
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
