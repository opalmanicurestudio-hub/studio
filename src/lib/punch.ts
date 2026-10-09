// src/lib/punch.ts — EVERY CLOCK-IN, BREAK AND CLOCK-OUT goes through here (server side), from the kiosk, the staff page
// and the staff portal alike, so all three agree:
//   • the punch is checked against where the person actually is (worked out from their punches — lib/timeclock):
//     no second clock-in, no clock-out or break when not clocked in, no ending a break that never started;
//   • clocking out mid-break ends the break first;
//   • the server's clock is the time (a device with the wrong time can't move a shift);
//   • the person's record gets the same fields every time (active, onBreak, clockInTime, breakStartTime, status), which
//     the desk, the planner and the portal all read;
//   • a published shift turns into a note on the punch: late, early, or clocked in with no shift (lib/shift-check);
//   • every punch is in the owner's audit log.
import { sessionsFrom, clockPolicy, localDay, weekOf } from '@/lib/timeclock';
import { shiftNote } from '@/lib/shift-check';

export type PunchAction = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
export type PunchState = { clockedIn: boolean; onBreak: boolean; since: string | null; breakSince: string | null; forgotten: boolean };
const LABEL: Record<PunchAction, string> = { clock_in: 'clocked in', clock_out: 'clocked out', break_start: 'started a break', break_end: 'ended a break' };

/** Where someone is right now, from their recent punches. */
export function punchState(punches: any[], tenant: any, now = Date.now()): PunchState {
  const list = [...(punches || [])].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const s = sessionsFrom(list, clockPolicy(tenant, now)); const last = s[s.length - 1];
  if (!last || last.outAt) return { clockedIn: false, onBreak: false, since: null, breakSince: null, forgotten: false };
  // open: on a break when the last break punch in this session is a break_start
  const inT = Date.parse(last.inAt); let breakSince: string | null = null;
  for (const p of list) { const t = Date.parse(p.timestamp); if (t < inT) continue; if (p.type === 'break_start') breakSince = p.timestamp; if (p.type === 'break_end') breakSince = null; }
  return { clockedIn: !last.missingOut, onBreak: !last.missingOut && !!breakSince, since: last.inAt, breakSince: last.missingOut ? null : breakSince, forgotten: last.missingOut };
}

/** Can this punch happen now? null = yes, else the reason (plain words for the person at the clock). */
export function punchProblem(action: PunchAction, st: PunchState, name = 'You'): string | null {
  const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
  if (action === 'clock_in' && st.clockedIn) return `${name} clocked in at ${hm(st.since)} and hasn’t clocked out.`;
  if (action !== 'clock_in' && !st.clockedIn) return st.forgotten ? `${name}’s last shift has no clock-out — a manager needs to fix it on Timesheets first.` : `${name} isn’t clocked in.`;
  if (action === 'break_start' && st.onBreak) return `${name} has been on a break since ${hm(st.breakSince)}.`;
  if (action === 'break_end' && !st.onBreak) return `${name} isn’t on a break.`;
  return null;
}

/**
 * Record a punch. `db` is the admin Firestore. Returns the new state, or an error message (nothing is written then).
 * `via` says where it came from ('kiosk' | 'staff-page' | 'portal' | 'manager').
 */
export async function recordPunch(db: any, input: { tenantId: string; staffId: string; action: PunchAction; via: string; geo?: { verified?: boolean; warnOnly?: boolean; coords?: any }; actor?: { id?: string; name?: string } ; now?: number }): Promise<{ ok: true; state: PunchState; message: string; note?: string | null } | { ok: false; error: string; state?: PunchState }> {
  const { tenantId, staffId, action } = input; const T = `tenants/${tenantId}`; const now = input.now ?? Date.now(); const iso = new Date(now).toISOString();
  if (!['clock_in', 'clock_out', 'break_start', 'break_end'].includes(action)) return { ok: false, error: 'Unknown punch.' };
  const [tSnap, sSnap] = await Promise.all([db.doc(T).get(), db.doc(`${T}/staff/${staffId}`).get()]);
  if (!sSnap.exists) return { ok: false, error: 'Team member not found.' };
  const tenant: any = tSnap.data() || {}; const staff: any = sSnap.data() || {}; const name = String(staff.name || 'Team member').split(' ')[0];
  if (staff.isRenter === true || staff.role === 'renter') return { ok: false, error: 'Renters don’t use the time clock.' };
  if (staff.archived === true || staff.status === 'archived') return { ok: false, error: 'This team member is archived.' };
  // Recent punches (eight days back: any open shift, and this workweek's hours for the overtime warning)
  const recent = (await db.collection(`${T}/activityLogs`).where('timestamp', '>=', new Date(now - 8 * 86400000).toISOString()).get()).docs
    .map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((p: any) => p.staffId === staffId);
  const st = punchState(recent, tenant, now); const problem = punchProblem(action, st, name);
  if (problem) return { ok: false, error: problem, state: st };
  if (action === 'clock_in' && tenant.blockClockInOnExpiredLicense && staff.compliance?.licenseExpiry && Date.parse(staff.compliance.licenseExpiry) < now) return { ok: false, error: `${name}’s licence has expired — see a manager.` };
  if (action === 'clock_out' && Number(tenant.minimumShiftMinutes) > 0 && st.since && (now - Date.parse(st.since)) / 60000 < Number(tenant.minimumShiftMinutes)) {
    const left = Math.ceil(Number(tenant.minimumShiftMinutes) - (now - Date.parse(st.since)) / 60000); return { ok: false, error: `${left} more minute${left === 1 ? '' : 's'} before ${name} can clock out (minimum shift).` };
  }

  // Against the published shift (late / early / no shift)
  let note: string | null = null;
  if (action === 'clock_in' || action === 'clock_out') {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tenant.timezone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(st.since && action === 'clock_out' ? Date.parse(st.since) : now));
    const shifts = (await db.collection(`${T}/shifts`).where('staffId', '==', staffId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    note = shiftNote(action, now, shifts, day, tenant);
    if (action === 'clock_in' && note && /^early:/.test(note) && tenant.earlyClockInMinutes != null && tenant.earlyClockInMinutes !== '') return { ok: false, error: `Too early — ${name}’s shift hasn’t started yet. Clock in closer to the start, or ask a manager.` };
  }

  // Required break: clocking out after a long shift with no proper break is noted for a manager.
  const notices: string[] = [];
  const needBreakH = Number(tenant.requiredBreakAfterHours) || 0; const minBreak = Number(tenant.minimumBreakMinutes) || 0;
  if (action === 'clock_out' && needBreakH > 0 && st.since) {
    const open = sessionsFrom(recent, clockPolicy(tenant, now)).find((x) => x.inAt === st.since);
    const elapsedH = (now - Date.parse(st.since)) / 3600000; const longest = open ? open.breakMinutes : 0;
    if (elapsedH > needBreakH && longest < Math.max(1, minBreak)) { const msg = `no break: ${elapsedH.toFixed(1)}h shift without a ${minBreak || 'proper'}${minBreak ? '-minute' : ''} break`; note = note ? `${note}; ${msg}` : msg; notices.push(`${staff.name || 'A team member'} worked a ${elapsedH.toFixed(1)}-hour shift without a break.`); }
  }
  // Late clock-in that a manager must approve
  const lateApproval = action === 'clock_in' && !!note && /^late:/.test(note) && tenant.requireManagerOverrideForLateClockIn === true;
  if (lateApproval) notices.push(`${staff.name || 'A team member'} clocked in ${note!.replace(/^late:\s*/, '')} — approve it on Timesheets.`);
  // Close to overtime this workweek
  const alertH = Number(tenant.overtimeAlertHours) || 0;
  if (action === 'clock_in' && alertH > 0) {
    const tz = tenant.timezone || 'America/New_York'; const ws = Number.isInteger(tenant.workweekStartsOn) ? tenant.workweekStartsOn : 1;
    const thisWeek = weekOf(localDay(now, tz), ws); const limit = (Number(tenant.overtimeThresholdHours) || 40) * 60;
    const worked = sessionsFrom(recent, clockPolicy(tenant, now)).filter((x) => x.weekStart === thisWeek).reduce((a, x) => a + x.workedMinutes, 0);
    if (worked >= limit - alertH * 60) notices.push(`${staff.name || 'A team member'} has worked ${(worked / 60).toFixed(1)} hours this week — overtime starts after ${limit / 60}.`);
  }

  const batch = db.batch(); const logs = db.collection(`${T}/activityLogs`);
  const base = { staffId, timestamp: iso, via: input.via, timesheetStatus: 'pending', ...(input.geo ? { geoVerified: !!input.geo.verified, geoWarnOnly: !!input.geo.warnOnly, geoCoords: input.geo.coords || null } : {}), ...(input.actor?.id && input.actor.id !== staffId ? { punchedBy: input.actor.id, punchedByName: input.actor.name || null } : {}) };
  let breakMin = 0;
  if (action === 'clock_out' && st.onBreak) { const r = logs.doc(); batch.set(r, { ...base, id: r.id, type: 'break_end', autoEnded: true }); }   // clocking out ends the break
  if (action === 'break_end' || (action === 'clock_out' && st.onBreak)) breakMin = st.breakSince ? Math.round((now - Date.parse(st.breakSince)) / 60000) : 0;
  const ref = logs.doc();
  const entry: any = { ...base, id: ref.id, type: action, ...(note ? { shiftNote: note } : {}), ...(lateApproval ? { needsApproval: true } : {}) };
  if (action === 'break_end') { entry.durationMinutes = breakMin; if (Number(tenant.maximumBreakMinutes) > 0 && breakMin > Number(tenant.maximumBreakMinutes)) { entry.breakOverage = true; entry.breakOverageMinutes = breakMin - Number(tenant.maximumBreakMinutes); } }
  if (action === 'clock_out' && st.since) entry.workedMinutes = Math.max(0, Math.round((now - Date.parse(st.since)) / 60000));   // elapsed, for reference — pay uses lib/timeclock
  batch.set(ref, entry);
  const staffFields: any =
    action === 'clock_in' ? { active: true, onBreak: false, clockInTime: iso, breakStartTime: null, status: 'available', lastClockIn: iso }
    : action === 'clock_out' ? { active: false, onBreak: false, clockInTime: null, breakStartTime: null, status: 'off', lastClockOut: iso }
    : action === 'break_start' ? { onBreak: true, breakStartTime: iso, status: 'on_break', lastBreakStart: iso }
    : { onBreak: false, breakStartTime: null, status: 'available', lastBreakEnd: iso };
  batch.set(db.doc(`${T}/staff/${staffId}`), staffFields, { merge: true });
  const extra = entry.workedMinutes != null ? ` (${Math.floor(entry.workedMinutes / 60)}h ${entry.workedMinutes % 60}m)` : action === 'break_end' ? ` (${breakMin} min break)` : '';
  const a = db.collection(`${T}/auditLogs`).doc();
  batch.set(a, { action: `timeclock.${action}`, targetType: 'staff', targetId: staffId, at: iso,
    summary: `${staff.name || 'Team member'} ${LABEL[action]}${input.actor?.id && input.actor.id !== staffId ? ` (by ${input.actor.name || 'a manager'})` : ''} via ${input.via}${extra}${note ? ` — ${note.replace(/^\w+:\s*/, '')}` : ''}`,
    actor: { type: 'user', id: input.actor?.id || staffId, name: input.actor?.name || staff.name || null, via: input.via } });
  if (entry.breakOverage) notices.push(`${staff.name || 'A team member'} took a ${breakMin}-minute break (the limit is ${tenant.maximumBreakMinutes}).`);
  // Each manager (and the owner) gets the notice in their own notifications.
  if (notices.length) {
    const mgrs = (await db.collection(`${T}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get()).docs.filter((d: any) => d.data()?.archived !== true).map((d: any) => d.id);
    const to = Array.from(new Set([...mgrs, ...(tenant.userId ? [String(tenant.userId)] : [])])).filter((id) => id !== staffId || mgrs.length <= 1);
    for (const uid of to) for (const m of notices) { const nRef = db.collection(`${T}/notifications`).doc(); batch.set(nRef, { id: nRef.id, userId: uid, type: 'timeclock', priority: 'high', message: m, link: '/timesheets', createdAt: iso, read: false }); }
  }
  await batch.commit();
  const next = punchState([...recent, ...(action === 'clock_out' && st.onBreak ? [{ staffId, type: 'break_end', timestamp: iso }] : []), { staffId, type: action, timestamp: iso }], tenant, now);
  const msg = action === 'clock_in' ? `${name} is clocked in.` : action === 'clock_out' ? `${name} is clocked out${extra}.` : action === 'break_start' ? `${name}’s break has started.` : `${name}’s break has ended${extra}.`;
  return { ok: true, state: next, message: msg, note };
}
