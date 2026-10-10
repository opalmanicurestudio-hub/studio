// src/lib/clock-reminders.ts — NUDGES AROUND THE SCHEDULE, from the ops tick (every few minutes):
//   • a published shift started 10 minutes ago and they haven't clocked in → remind them (once);
//   • 30 minutes in and still nothing → tell the managers they may be a no-show (once);
//   • a shift ended 30 minutes ago and they're still on the clock → remind them to clock out (once).
// Everyone on the schedule gets these — including people paid by commission or per service, whose hours the
// minimum-wage and overtime checks need. Renters never.
import { sessionsFrom, clockPolicy, localDay } from '@/lib/timeclock';
import { shiftWindow, LIVE } from '@/lib/shift-check';

export async function clockReminders(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<number> {
  if (tenant?.clockReminders === false) return 0;
  const T = `tenants/${tenantId}`; const tz = tenant?.timezone || 'America/New_York';
  const today = localDay(now, tz); const yesterday = localDay(now - 86400000, tz);
  const shifts = (await db.collection(`${T}/shifts`).where('date', 'in', [yesterday, today]).get()).docs.map((d: any) => ({ id: d.id, ref: d.ref, ...(d.data() || {}) })).filter(LIVE);
  if (!shifts.length) return 0;
  const punches = (await db.collection(`${T}/activityLogs`).where('timestamp', '>=', new Date(now - 2 * 86400000).toISOString()).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const sessions = sessionsFrom(punches, clockPolicy(tenant, now));
  const staff = new Map<string, any>((await db.collection(`${T}/staff`).get()).docs.map((d: any) => [d.id, d.data() || {}]));
  const mgrs = [...staff].filter(([, s]) => ['owner', 'admin', 'manager'].includes(String(s.role)) && s.archived !== true).map(([id]) => id);
  const b = db.batch(); let n = 0; const iso = new Date(now).toISOString();
  const tell = (userId: string, type: string, message: string, link: string) => { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId, type, priority: 'high', message, link, createdAt: iso, read: false }); n++; };
  const hm = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  for (const sh of shifts) {
    const p = staff.get(sh.staffId); if (!p || p.isRenter === true || p.role === 'renter' || p.archived === true) continue;
    const w = shiftWindow(sh, tz); if (!w) continue;
    const mine = sessions.filter((x) => x.staffId === sh.staffId);
    const came = mine.some((x) => Date.parse(x.inAt) < w.end && (x.outAt ? Date.parse(x.outAt) : now) > w.start - 3600000);
    const first = String(p.name || 'Team member').split(' ')[0];
    if (!came && now >= w.start + 10 * 60000 && now < w.end && !sh.clockInReminded) {
      tell(sh.staffId, 'clock_reminder', `Your shift started at ${hm(w.start)} — remember to clock in.`, 'today'); b.update(sh.ref, { clockInReminded: iso });
    }
    if (!came && now >= w.start + 30 * 60000 && now < w.end && !sh.noShowTold) {
      for (const m of mgrs) if (m !== sh.staffId) tell(m, 'shift_no_show', `${first} hasn’t clocked in for the ${hm(w.start)} shift.`, '/timesheets');
      b.update(sh.ref, { noShowTold: iso });
    }
    const open = mine.find((x) => x.open && Date.parse(x.inAt) < w.end);
    if (open && now >= w.end + 30 * 60000 && !sh.clockOutReminded) {
      tell(sh.staffId, 'clock_reminder', `Your shift ended at ${hm(w.end)} — you’re still clocked in. Clock out if you’ve finished.`, 'today'); b.update(sh.ref, { clockOutReminded: iso });
    }
  }
  if (n) await b.commit();
  return n;
}
