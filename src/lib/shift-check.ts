// src/lib/shift-check.ts — PUNCHES AGAINST THE PUBLISHED SCHEDULE.
//   shiftWindow  a shift's start and end as instants in the business's time zone (overnight shifts end the next day);
//   shiftNote    what a clock-in or clock-out says about the shift: "late: 12 min after 9:00", "early: 40 min before
//                9:00", "noshift: no shift today", "left_early: 30 min before 5:00", "stayed: 25 min after 5:00";
//   dayCompare   scheduled vs actual for a person and a day (Timesheets), and no-shows (a published shift with no
//                clock-in once it's well under way).
// Only published / confirmed shifts count — drafts are plans, not the schedule.
import { zonedEpoch } from '@/lib/timeclock';

export const LIVE = (s: any) => s && !['draft', 'cancelled', 'denied'].includes(String(s.status || 'published'));
const fmt = (t: number, tz: string) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

export function shiftWindow(s: any, tz = 'America/New_York'): { start: number; end: number; breakMinutes: number } | null {
  if (!s?.date || !/^\d{1,2}:\d{2}/.test(String(s.startTime || '')) || !/^\d{1,2}:\d{2}/.test(String(s.endTime || ''))) return null;
  const start = zonedEpoch(s.date, s.startTime, tz); let end = zonedEpoch(s.date, s.endTime, tz);
  if (end <= start) end += 86400000;   // overnight
  return { start, end, breakMinutes: Math.max(0, Number(s.breakMinutes) || 0) };
}

export function shiftNote(action: 'clock_in' | 'clock_out', now: number, shifts: any[], day: string, tenant: any): string | null {
  const tz = tenant?.timezone || 'America/New_York'; const grace = Number.isFinite(Number(tenant?.lateGraceMinutes)) ? Number(tenant.lateGraceMinutes) : 5;
  const live = (shifts || []).filter(LIVE);
  const today = live.filter((s) => s.date === day).map((s) => ({ s, w: shiftWindow(s, tz) })).filter((x) => x.w) as { s: any; w: { start: number; end: number } }[];
  if (!today.length) {
    if (action !== 'clock_in') return null;
    const usesSchedule = live.some((s) => Math.abs(Date.parse(`${s.date}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) <= 7 * 86400000);
    return usesSchedule ? 'noshift: no shift on the schedule today' : null;
  }
  // the shift nearest to now
  const near = today.sort((a, b) => Math.abs(a.w.start - now) - Math.abs(b.w.start - now))[0].w;
  if (action === 'clock_in') {
    const d = Math.round((now - near.start) / 60000); const earlyAllowed = Number.isFinite(Number(tenant?.earlyClockInMinutes)) ? Number(tenant.earlyClockInMinutes) : 15;
    if (d > grace) return `late: ${d} min after the ${fmt(near.start, tz)} start`;
    if (-d > earlyAllowed) return `early: ${-d} min before the ${fmt(near.start, tz)} start`;
    return null;
  }
  const d = Math.round((now - near.end) / 60000);
  if (d < -grace) return `left_early: ${-d} min before the ${fmt(near.end, tz)} end`;
  if (d > 15) return `stayed: ${d} min after the ${fmt(near.end, tz)} end`;
  return null;
}

export type DayCompare = { scheduledMinutes: number; actualMinutes: number; shiftLabel: string | null; noShow: boolean; notes: string[] };
/** Scheduled vs actual for one person on one local day. `sessions` from lib/timeclock (already this person's). */
export function dayCompare(day: string, shifts: any[], sessions: any[], tenant: any, now = Date.now()): DayCompare {
  const tz = tenant?.timezone || 'America/New_York';
  const mine = (shifts || []).filter(LIVE).filter((s) => s.date === day);
  let scheduled = 0; const labels: string[] = []; let noShow = false;
  for (const s of mine) { const w = shiftWindow(s, tz); if (!w) continue; scheduled += Math.max(0, (w.end - w.start) / 60000 - w.breakMinutes); labels.push(`${fmt(w.start, tz)}–${fmt(w.end, tz)}`);
    const started = (sessions || []).some((x) => Date.parse(x.inAt) < w.end && (x.outAt ? Date.parse(x.outAt) : now) > w.start - 3600000);
    if (!started && now > w.start + 30 * 60000) noShow = true; }
  const todays = (sessions || []).filter((x) => x.localDate === day);
  const actual = todays.reduce((a, x) => a + (x.workedMinutes || 0), 0);
  const notes = todays.map((x) => x.shiftNoteIn).filter(Boolean);
  return { scheduledMinutes: Math.round(scheduled), actualMinutes: actual, shiftLabel: labels.join(', ') || null, noShow, notes };
}
