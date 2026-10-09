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
        geoVerified: !!(outP?.geoVerified ?? cur.geo?.geoVerified), geoWarnOnly: !!cur.geo?.geoWarnOnly, note: outP?.reviewNote || '', approvedBy: outP?.approvedBy || '' });
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

export type WeekHours = { weekStart: string; minutes: number; regular: number; overtime: number };
/** Per workweek: paid minutes split at the weekly overtime threshold (default 40 hours). */
export function weeklyHours(sessions: Session[], staffId: string, from: any, to: any, thresholdHours = 40): WeekHours[] {
  const m = new Map<string, number>(); for (const s of sessionsIn(sessions, from, to, staffId)) m.set(s.weekStart, (m.get(s.weekStart) || 0) + s.workedMinutes);
  const cap = Math.max(0, Number(thresholdHours) || 40) * 60;
  return [...m].sort().map(([weekStart, minutes]) => ({ weekStart, minutes, regular: Math.min(minutes, cap), overtime: Math.max(0, minutes - cap) }));
}

/** Policy from the tenant document. */
export const clockPolicy = (tenant: any, now?: number): ClockPolicy => ({ timeZone: tenant?.timezone || 'America/New_York', paidBreakMinutes: Number(tenant?.paidBreakMinutes) || 0,
  autoClockOutHours: Number(tenant?.autoClockOutHours) || 12, weekStartsOn: Number.isInteger(tenant?.workweekStartsOn) ? tenant.workweekStartsOn : 1, now });
