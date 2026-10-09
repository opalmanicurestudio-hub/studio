// src/lib/demand.ts — HOW BUSY WILL IT BE, when bookings can't tell you (walk-in salons, O10). Two answers:
//   forecastVisits — the day's expected visits: what's booked PLUS the walk-ins of a comparable past day (the busiest of
//                    the last few same weekdays, so the plan is for a busy day rather than an average one). Each past
//                    walk-in is replayed at the same time of day, so kit peaks and "runs out at" times are realistic.
//   paceRunway     — right now: how fast kits and linens are being used this past hour, and how many minutes of clean
//                    ones are left at that pace. This is what keeps a walk-in floor from running dry mid-rush.
import { kitsNeeded, kitKey } from '@/lib/kits';
import { linensForVisit, sameLinen } from '@/lib/linens';

const ms = (v: any): number => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : v?.seconds ? v.seconds * 1000 : v instanceof Date ? v.getTime() : 0);
const dead = (a: any) => ['cancelled', 'no_show', 'declined'].includes(String(a?.status));
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const isWalkInVisit = (a: any) => !!(a?.isWalkIn || a?.noBookedTime || a?.walkInId || /walk/i.test(String(a?.source || a?.bookingSource || '')));
export type WalkInMode = 'none' | 'fixed' | 'history';
export const walkInMode = (tenant: any): WalkInMode => { const w = tenant?.ops?.walkIns || {}; return w.mode === 'history' ? 'history' : w.mode === 'fixed' || (!w.mode && Number(w.perDay) > 0) ? 'fixed' : 'none'; };

export interface Forecast { visits: any[]; booked: number; expectedWalkIns: number; basis: string; learned: boolean }
/** The visits to plan `target` (any time on that day) around. `appts` = everything on record (past and future). */
export function forecastVisits(input: { appts: any[]; target: number; mode: WalkInMode; now?: number; weeks?: number }): Forecast {
  const now = input.now ?? Date.now(); const start = midnight(input.target); const key = dayKey(start); const isToday = dayKey(now) === key;
  const iso = (a: any) => ({ ...a, startTime: new Date(ms(a.startTime)).toISOString(), endTime: ms(a.endTime) ? new Date(ms(a.endTime)).toISOString() : null });
  const booked = (input.appts || []).filter((a) => ms(a?.startTime) && dayKey(ms(a.startTime)) === key && !dead(a) && !isWalkInVisit(a)).filter((a) => !isToday || ms(a.startTime) >= now - 15 * 60000 || !a.actualStartTime).map(iso);
  if (input.mode !== 'history') return { visits: booked, booked: booked.length, expectedWalkIns: 0, basis: '', learned: false };
  // Same weekday, the last few weeks: which day had the most walk-ins?
  const weeks = input.weeks ?? 6; const days = new Map<string, any[]>();
  for (const a of input.appts || []) { const t = ms(a?.startTime); if (!t || t >= midnight(now) || dead(a) || !isWalkInVisit(a)) continue;
    const back = Math.round((start - midnight(t)) / 86400000); if (back <= 0 || back > weeks * 7 || back % 7 !== 0) continue;
    const k = dayKey(t); days.set(k, [...(days.get(k) || []), a]); }
  const weekday = new Date(start).toLocaleDateString([], { weekday: 'long' });
  if (!days.size) return { visits: booked, booked: booked.length, expectedWalkIns: 0, basis: `No past ${weekday} walk-ins on record yet — this will fill in after a few weeks.`, learned: false };
  const busiest = [...days.values()].sort((a, b) => b.length - a.length)[0];
  const replay = busiest.map((a) => { const t = ms(a.startTime); const off = t - midnight(t); const dur = (ms(a.endTime) || ms(a.actualEndTime) || t + 60 * 60000) - t;
    return { ...a, id: `expected:${a.id}`, expected: true, status: 'expected', actualStartTime: null, startTime: new Date(start + off).toISOString(), endTime: new Date(start + off + Math.max(10 * 60000, Math.min(dur, 6 * 3600000))).toISOString() }; })
    .filter((a) => !isToday || ms(a.startTime) > now);
  return { visits: [...booked, ...replay], booked: booked.length, expectedWalkIns: replay.length, learned: true,
    basis: `Walk-ins based on your busiest of the last ${days.size} ${weekday}${days.size === 1 ? '' : 's'} (${busiest.length} that day)${isToday ? ', from now on' : ''}.` };
}

export interface Runway { kind: 'kit' | 'linen'; id: string; name: string; perHour: number; clean: number; minutesLeft: number }
/** At the last hour's pace, how long will the clean ones last? Only things actually being used are listed. */
export function paceRunway(input: { visits: any[]; services: any[]; kits: any[]; linens: any[]; now?: number; windowMin?: number }): Runway[] {
  const now = input.now ?? Date.now(); const win = input.windowMin ?? 60; const out: Runway[] = [];
  const recent = (input.visits || []).filter((a) => { const t = ms(a?.actualStartTime); return t && t <= now && t > now - win * 60000 && !dead(a); });
  if (!recent.length) return out; const svc = (id: any) => (input.services || []).find((s: any) => s.id === id);
  const kitUse = new Map<string, { name: string; n: number }>();
  for (const v of recent) for (const id of [v.serviceId, ...(Array.isArray(v.addOnIds) ? v.addOnIds : [])]) for (const k of kitsNeeded(svc(id))) { const key = kitKey(k.name); const row = kitUse.get(key) || { name: k.name, n: 0 }; row.n += k.qty; kitUse.set(key, row); }
  for (const [key, u] of kitUse) { const mine = (input.kits || []).filter((k) => k.status !== 'retired' && kitKey(k.name) === key); if (!mine.length) continue;
    const clean = mine.filter((k) => k.status === 'ready').length; const perHour = (u.n * 60) / win; out.push({ kind: 'kit', id: key, name: mine[0].name, perHour: Math.round(perHour * 10) / 10, clean, minutesLeft: Math.round((clean / perHour) * 60) }); }
  for (const l of input.linens || []) { let n = 0; for (const v of recent) n += linensForVisit(v, input.services || []).find((x) => sameLinen(x.name, l.name))?.qty || 0; if (!n) continue;
    const perHour = (n * 60) / win; const clean = Math.max(0, Number(l.clean) || 0); out.push({ kind: 'linen', id: l.id, name: l.name, perHour: Math.round(perHour * 10) / 10, clean, minutesLeft: Math.round((clean / perHour) * 60) }); }
  return out.sort((a, b) => a.minutesLeft - b.minutesLeft);
}

/** Walk-ins expected in the next stretch (default 90 min), so housekeeping keeps kits and linen bundles ready for them:
 *  "learn from past days" replays the busiest recent same weekday; "a set number a day" spreads it over the open day
 *  (10 hours unless the business says otherwise) with the usual walk-in service. Each is marked `expected`. */
export function expectedWalkIns(input: { tenant: any; appts: any[]; now?: number; horizonMin?: number }): any[] {
  const now = input.now ?? Date.now(); const horizon = now + (input.horizonMin ?? 90) * 60000; const mode = walkInMode(input.tenant);
  if (mode === 'history') return forecastVisits({ appts: input.appts, target: now, mode, now }).visits.filter((v: any) => v.expected && ms(v.startTime) > now && ms(v.startTime) <= horizon)
    .map((v: any) => ({ ...v, staffId: null, clientName: 'Walk-in (expected)' }));
  if (mode === 'fixed') { const w = input.tenant?.ops?.walkIns || {}; const perDay = Math.max(0, Math.round(Number(w.perDay) || 0)); if (!perDay || !w.serviceId) return [];
    const hours = Math.max(4, Math.min(16, Number(w.openHours) || 10)); const gap = (hours * 60) / perDay; const out: any[] = [];
    for (let t = now + Math.min(30, gap) * 60000, i = 0; t <= horizon && i < 12; t += gap * 60000, i++) out.push({ id: `expected:fixed:${i}`, expected: true, status: 'expected', clientName: 'Walk-in (expected)', staffId: null, serviceId: w.serviceId, startTime: new Date(t).toISOString(), endTime: new Date(t + 60 * 60000).toISOString() });
    return out; }
  return [];
}
