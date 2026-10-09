// src/lib/timeclock.ts — HOURS WORKED, worked out one way for every screen and for payroll.
//
// Built from the punches themselves (tenants/{t}/activityLogs: clock_in, break_start, break_end, clock_out with an ISO
// `timestamp`) — never from `durationMinutes`, which only some break_end punches carry and which made payroll pay
// break minutes instead of shift time.
//
//   • A session runs from a clock-in to the next clock-out (overnight shifts included).
//   • Breaks inside it are worked out from break_start → break_end; a break left open at clock-out ends at the clock-out.
//   • Paid breaks: the first `paidBreakMinutes` of break time in each session is paid (the rest is unpaid).
//   • A forgotten clock-out: a session still open after `autoClockOutHours` (default 12) is flagged `missingOut` and
//     pays nothing until a manager puts in the real time — it never runs on for days, and never quietly disappears.
//   • A second clock-in within an hour of the first is a double tap and is ignored; an hour or more later it means the
//     first one never got its clock-out — that session is flagged `missingOut` and a new one starts. A clock-out with
//     no clock-in is ignored.
//   • Rejected sessions (timesheetStatus 'rejected' on the clock_out punch) pay nothing.
//   • Days and workweeks are in the BUSINESS's time zone (tenant.timezone), not the device's.

export type Punch = { id?: string; staffId: string; type: string; timestamp: string; timesheetStatus?: string; reviewNote?: string; approvedBy?: string; geoVerified?: boolean; geoWarnOnly?: boolean };
export type Session = {
  staffId: string; inAt: string; outAt: string | null; inId?: string; outId?: string;
  breakMinutes: number; paidBreakMinutes: number; unpaidBreakMinutes: number;
  workedMinutes: number;          // paid minutes: elapsed − unpaid breaks (0 when missingOut or rejected)
  open: boolean;                  // still clocked in (within autoClockOutHours)
  missingOut: boolean;            // forgotten clock-out — needs a manager
  status: string;                 // pending | approved | rejected | active | missing
  localDate: string;              // yyyy-MM-dd the session started, business time zone
  weekStart: string;              // yyyy-MM-dd of its workweek's first day, business time zone
  geoVerified?: boolean; geoWarnOnly?: boolean; note?: string; approvedBy?: string;
  shiftNoteIn?: string | null; shiftNoteOut?: string | null;   // late / early / no shift, noted when the punch was made
};
export type ClockPolicy = { timeZone?: string; paidBreakMinutes?: number; autoClockOutHours?: number; weekStartsOn?: number; now?: number };

const ms = (s: any) => (typeof s === 'string' ? Date.parse(s) : s?.toDate ? s.toDate().getTime() : s?.seconds ? s.seconds * 1000 : Number(s) || 0);
const mins = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60000));

/** yyyy-MM-dd for an instant in a time zone. */
export function localDay(t: number, timeZone = 'America/New_York'): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); }
  catch { return new Date(t).toISOString().slice(0, 10); }
}
/** The workweek's first day (yyyy-MM-dd) for a local day. weekStartsOn: 0 Sunday … 1 Monday (default). */
export function weekOf(day: string, weekStartsOn = 1): string {
  const d = new Date(`${day}T12:00:00Z`); const back = (d.getUTCDay() - weekStartsOn + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back); return d.toISOString().slice(0, 10);
}

/** All sessions from a set of punches (any number of people). */
export function sessionsFrom(punches: Punch[], policy: ClockPolicy = {}): Session[] {
  const tz = policy.timeZone || 'America/New_York'; const now = policy.now ?? Date.now();
  const paidCap = Math.max(0, Number(policy.paidBreakMinutes) || 0); const autoH = Number(policy.autoClockOutHours) > 0 ? Number(policy.autoClockOutHours) : 12;
  const ws = Number.isInteger(policy.weekStartsOn) ? Number(policy.weekStartsOn) : 1;
  const byStaff = new Map<string, Punch[]>();
  for (const p of punches || []) { if (!p?.staffId || !ms(p.timestamp)) continue; if (!['clock_in', 'clock_out', 'break_start', 'break_end'].includes(p.type)) continue; (byStaff.get(p.staffId) || byStaff.set(p.staffId, []).get(p.staffId)!).push(p); }
  const out: Session[] = [];
  for (const [staffId, list] of byStaff) {
    list.sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
    let cur: { inT: number; inId?: string; breakAt: number | null; breaks: number[]; geo?: Punch } | null = null;
    const close = (outT: number | null, outP?: Punch, forgot = false) => {
      if (!cur) return;
      let breaks = [...cur.breaks]; if (cur.breakAt != null) breaks.push(mins(cur.breakAt, outT ?? now));   // a break left open ends at the clock-out
      const breakMinutes = breaks.reduce((a, b) => a + b, 0); const paid = Math.min(paidCap, breakMinutes); const unpaid = breakMinutes - paid;
      const endT = outT ?? now; const missingOut = forgot || (outT == null && endT - cur.inT > autoH * 3600000); const open = outT == null && !missingOut;
      const status = missingOut ? 'missing' : open ? 'active' : String(outP?.timesheetStatus || 'pending');
      const worked = missingOut || status === 'rejected' ? 0 : Math.max(0, mins(cur.inT, endT) - unpaid);
      const day = localDay(cur.inT, tz);
      out.push({ staffId, inAt: new Date(cur.inT).toISOString(), outAt: outT == null ? null : new Date(outT).toISOString(), inId: cur.inId, outId: outP?.id,
        breakMinutes, paidBreakMinutes: paid, unpaidBreakMinutes: unpaid, workedMinutes: worked, open, missingOut, status, localDate: day, weekStart: weekOf(day, ws),
        geoVerified: !!(outP?.geoVerified ?? cur.geo?.geoVerified), geoWarnOnly: !!cur.geo?.geoWarnOnly, note: outP?.reviewNote || '', approvedBy: outP?.approvedBy || '',
        shiftNoteIn: (cur.geo as any)?.shiftNote || null, shiftNoteOut: (outP as any)?.shiftNote || null });
      cur = null;
    };
    for (const p of list) {
      const t = ms(p.timestamp);
      if (p.type === 'clock_in') {
        if (cur && t - cur.inT >= 3600000) close(null, undefined, true);   // the earlier one was never clocked out
        if (!cur) cur = { inT: t, inId: p.id, breakAt: null, breaks: [], geo: p };
        continue;
      }
      if (!cur) continue;                                                                                                     // punches while not clocked in are ignored
      if (p.type === 'break_start') { if (cur.breakAt == null) cur.breakAt = t; }
      else if (p.type === 'break_end') { if (cur.breakAt != null) { cur.breaks.push(mins(cur.breakAt, t)); cur.breakAt = null; } }
      else if (p.type === 'clock_out') close(t, p);
    }
    close(null);
  }
  return out.sort((a, b) => Date.parse(a.inAt) - Date.parse(b.inAt));
}

/** Sessions that started inside [from, to] (Dates or ISO). */
export const sessionsIn = (sessions: Session[], from: any, to: any, staffId?: string) => {
  const a = ms(from instanceof Date ? from.toISOString() : from), b = ms(to instanceof Date ? to.toISOString() : to);
  return sessions.filter((s) => (!staffId || s.staffId === staffId) && Date.parse(s.inAt) >= a && Date.parse(s.inAt) <= b);
};

/** Paid minutes for one person over [from, to]. */
export const workedMinutes = (sessions: Session[], staffId: string, from: any, to: any) => sessionsIn(sessions, from, to, staffId).reduce((a, s) => a + s.workedMinutes, 0);

export type WeekHours = { weekStart: string; minutes: number; regular: number; overtime: number; doubleTime: number };
/**
 * Per workweek: paid minutes split into regular, overtime and double time.
 *   weekly overtime: regular minutes over `thresholdHours` (default 40);
 *   daily overtime (optional, e.g. California): minutes over `daily.afterHours` in a day, and double time over
 *   `daily.doubleAfterHours` — minutes already counted as daily overtime aren't counted again for the week.
 */
export function weeklyHours(sessions: Session[], staffId: string, from: any, to: any, thresholdHours = 40, daily: { afterHours?: number; doubleAfterHours?: number } = {}): WeekHours[] {
  const byDay = new Map<string, { week: string; min: number }>();
  for (const s of sessionsIn(sessions, from, to, staffId)) { const d = byDay.get(s.localDate) || { week: s.weekStart, min: 0 }; d.min += s.workedMinutes; byDay.set(s.localDate, d); }
  const dCap = Number(daily.afterHours) > 0 ? Number(daily.afterHours) * 60 : Infinity; const dbl = Number(daily.doubleAfterHours) > 0 ? Number(daily.doubleAfterHours) * 60 : Infinity;
  const weeks = new Map<string, WeekHours>(); const cap = Math.max(0, Number(thresholdHours) || 40) * 60;
  for (const { week, min } of byDay.values()) {
    const w = weeks.get(week) || { weekStart: week, minutes: 0, regular: 0, overtime: 0, doubleTime: 0 };
    const double = Math.max(0, min - dbl); const dayOt = Math.max(0, Math.min(min, dbl) - dCap);
    w.minutes += min; w.regular += min - double - dayOt; w.overtime += dayOt; w.doubleTime += double; weeks.set(week, w);
  }
  for (const w of weeks.values()) { const over = Math.max(0, w.regular - cap); w.regular -= over; w.overtime += over; }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** Policy from the tenant document. */
export const clockPolicy = (tenant: any, now?: number): ClockPolicy => ({ timeZone: tenant?.timezone || 'America/New_York', paidBreakMinutes: Number(tenant?.paidBreakMinutes) || 0,
  autoClockOutHours: Number(tenant?.autoClockOutHours) || 12, weekStartsOn: Number.isInteger(tenant?.workweekStartsOn) ? tenant.workweekStartsOn : 1, now });

/** The instant of a local wall-clock time ("2026-10-09", "09:30") in a time zone. */
export function zonedEpoch(day: string, hhmm: string, timeZone = 'America/New_York'): number {
  const [h, m] = String(hhmm || '00:00').split(':').map((x) => Number(x) || 0);
  const guess = Date.parse(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const off = (t: number) => { try { const p = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value); return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - t; } catch { return 0; } };
  const first = guess - off(guess); return guess - off(first);   // second pass settles daylight-saving edges
}
