// src/lib/clock-fix.ts — "I FORGOT TO CLOCK OUT". The person says when they left; a manager approves (or changes it,
// or declines). Nothing counts toward pay until it's approved: the shift stays flagged as a missing clock-out.
//   clockFixes/{clockInPunchId} = { staffId, staffName, inId, inAt, outAt, note, status: pending | approved | declined }
// Approving writes the clock-out punch (activityLogs, via 'fix', waiting for timesheet approval like any punch).
import type { RequestActor } from '@/lib/request-actor';

type Out = { ok: true; message: string } | { ok: false; error: string };
const H = 3600000;
const clock = (iso: string, tz: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz });

async function managerIds(db: any, T: string): Promise<string[]> {
  const snap = await db.collection(`${T}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get();
  return snap.docs.filter((d: any) => d.data()?.archived !== true).map((d: any) => d.id);
}
function notify(db: any, T: string, userId: string, type: string, message: string, link: string, now: string) {
  const r = db.collection(`${T}/notifications`).doc();
  return r.set({ id: r.id, userId, type, message, link, createdAt: now, read: false });
}

/** Is there already a clock-out after this clock-in (before the next clock-in)? */
async function alreadyClosed(db: any, T: string, staffId: string, inMs: number): Promise<{ closed: boolean; nextInMs: number | null }> {
  const snap = await db.collection(`${T}/activityLogs`).where('staffId', '==', staffId).get();
  const after = snap.docs.map((d: any) => d.data() || {}).map((p: any) => ({ t: Date.parse(String(p.timestamp || '')), type: String(p.type || '') }))
    .filter((p: any) => p.t > inMs).sort((a: any, b: any) => a.t - b.t);
  const nextIn = after.find((p: any) => p.type === 'clock_in');
  const closed = after.some((p: any) => p.type === 'clock_out' && (!nextIn || p.t < nextIn.t));
  return { closed, nextInMs: nextIn ? nextIn.t : null };
}

export async function submitFix(db: any, tenantId: string, me: RequestActor, input: { inId?: string; outAt?: string; note?: string }, nowMs = Date.now()): Promise<Out> {
  const T = `tenants/${tenantId}`; const inId = String(input.inId || ''); const outMs = Date.parse(String(input.outAt || '')); const note = String(input.note || '').trim().slice(0, 300);
  const p: any = inId ? (await db.doc(`${T}/activityLogs/${inId}`).get()).data() : null;
  if (!p || p.type !== 'clock_in') return { ok: false, error: 'We could not find that shift.' };
  if (p.staffId !== me.staffId) return { ok: false, error: 'You can only correct your own shifts.' };
  const inMs = Date.parse(String(p.timestamp || ''));
  if (!(outMs > inMs)) return { ok: false, error: 'Please choose a time after you clocked in.' };
  if (outMs > nowMs) return { ok: false, error: 'That time is in the future. Please choose a time that has already passed.' };
  if (outMs - inMs > 16 * H) return { ok: false, error: 'That shift would be over 16 hours. Please ask your manager to correct it.' };
  const { closed, nextInMs } = await alreadyClosed(db, T, me.staffId, inMs);
  if (closed) return { ok: false, error: 'That shift already has a clock-out.' };
  if (nextInMs && outMs > nextInMs) return { ok: false, error: 'That time is after your next clock-in. Please choose an earlier time.' };
  const tenant: any = (await db.doc(T).get()).data() || {}; const tz = String(tenant.timezone || 'America/New_York');
  const now = new Date(nowMs).toISOString(); const ref = db.doc(`${T}/clockFixes/${inId}`); const cur: any = (await ref.get()).data();
  if (cur?.status === 'approved') return { ok: false, error: 'This correction has already been approved.' };
  await ref.set({ id: inId, staffId: me.staffId, staffName: me.name, inId, inAt: new Date(inMs).toISOString(), outAt: new Date(outMs).toISOString(), note: note || null, status: 'pending', createdAt: cur?.createdAt || now, updatedAt: now });
  for (const m of await managerIds(db, T)) if (m !== me.staffId) await notify(db, T, m, 'clock_fix', `Action needed: ${me.name} has no clock-out recorded for ${clock(new Date(inMs).toISOString(), tz).split(',')[0]} and reports leaving at ${clock(new Date(outMs).toISOString(), tz).split(', ').pop()}${note ? ` (note: “${note}”)` : ''}. Please review and approve it in Timesheets.`, '/timesheets', now);
  return { ok: true, message: 'Your correction has been sent to your manager. It will count toward your pay once it is approved.' };
}

export async function decideFix(db: any, tenantId: string, me: RequestActor, fixId: string, approve: boolean, input: { outAt?: string; note?: string } = {}, nowMs = Date.now()): Promise<Out> {
  if (!me.isManager) return { ok: false, error: 'Only a manager can approve this correction.' };
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/clockFixes/${fixId}`); const f: any = (await ref.get()).data();
  if (!f) return { ok: false, error: 'This request is no longer available.' };
  if (f.status !== 'pending') return { ok: false, error: 'This request has already been decided.' };
  if (f.staffId === me.staffId && !me.isOwner) return { ok: false, error: 'Your own hours must be approved by another manager.' };
  const now = new Date(nowMs).toISOString(); const note = String(input.note || '').trim().slice(0, 300);
  const tenant: any = (await db.doc(T).get()).data() || {}; const tz = String(tenant.timezone || 'America/New_York');
  if (!approve) {
    await ref.set({ status: 'declined', decidedBy: me.name, decidedAt: now, decisionNote: note || null }, { merge: true });
    await notify(db, T, f.staffId, 'clock_fix_declined', `${me.name} did not approve your clock-out correction for ${clock(f.inAt, tz).split(',')[0]}${note ? ` (note: “${note}”)` : ''}. Please speak with them to resolve it.`, '/staff-portal?tab=me', now);
    return { ok: true, message: 'Declined. The team member has been notified.' };
  }
  const outMs = Date.parse(String(input.outAt || f.outAt)); const inMs = Date.parse(f.inAt);
  if (!(outMs > inMs) || outMs - inMs > 18 * H) return { ok: false, error: 'Please check the clock-out time.' };
  const { closed, nextInMs } = await alreadyClosed(db, T, f.staffId, inMs);
  if (closed) { await ref.set({ status: 'approved', decidedBy: me.name, decidedAt: now, note: 'Already fixed' }, { merge: true }); return { ok: true, message: 'This shift has already been corrected.' }; }
  if (nextInMs && outMs > nextInMs) return { ok: false, error: 'That time is after their next clock-in. Please choose an earlier time.' };
  const out = new Date(outMs).toISOString(); const p = db.collection(`${T}/activityLogs`).doc();
  await p.set({ id: p.id, staffId: f.staffId, type: 'clock_out', timestamp: out, via: 'fix', timesheetStatus: 'pending', addedByManager: true, editedAt: now, editNote: `Forgot to clock out — approved by ${me.name}${f.note ? ` (“${f.note}”)` : ''}`, fixId });
  if (!nextInMs) { const s: any = (await db.doc(`${T}/staff/${f.staffId}`).get()).data() || {}; if (s.active || s.onBreak) await db.doc(`${T}/staff/${f.staffId}`).set({ active: false, onBreak: false, status: 'off', lastClockOut: out }, { merge: true }); }
  await ref.set({ status: 'approved', outAt: out, decidedBy: me.name, decidedAt: now, decisionNote: note || null, punchId: p.id }, { merge: true });
  await notify(db, T, f.staffId, 'clock_fix_approved', `${me.name} has approved your clock-out for ${clock(f.inAt, tz).split(',')[0]} at ${clock(out, tz).split(', ').pop()}.`, '/staff-portal?tab=me', now);
  return { ok: true, message: 'Approved. The clock-out has been recorded.' };
}
