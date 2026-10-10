// src/lib/shift-requests.ts — SHIFT REQUESTS from the staff portal, recorded on the server (the portal's own sign-in
// isn't allowed to write the schedule directly — nobody should be able to move a shift by hand-editing it).
//   submit   a day off, a swap, an early release or another request. A swap goes to the colleague first; everything
//            else goes straight to the managers. A day off is held as "pending" on the calendar until decided.
//   consent  the colleague agrees to (or declines) a swap; managers are told.
//   decide   a manager approves or denies. An approved swap trades the two shifts — only if both are still with the
//            same people; an approved day off becomes a blocked day on the planner.
import { RequestActor } from '@/lib/request-actor';

const TYPES = ['day_off', 'swap', 'early_release', 'other', 'pickup'];
const day = (d: string) => { const t = Date.parse(`${d}T12:00:00Z`); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : d; };
type Out = { ok: true; message: string; id?: string } | { ok: false; error: string };

async function managers(db: any, T: string): Promise<string[]> {
  return (await db.collection(`${T}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get()).docs.filter((d: any) => d.data()?.archived !== true).map((d: any) => d.id);
}
const note = (db: any, b: any, T: string, userId: string, type: string, message: string, link: string, now: string) => { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId, type, message, link, createdAt: now, read: false }); };

export async function submitRequest(db: any, tenantId: string, me: RequestActor, input: any, now = new Date().toISOString()): Promise<Out> {
  const T = `tenants/${tenantId}`; const type = String(input?.type || ''); const date = String(input?.date || '').slice(0, 10); const reason = String(input?.reason || '').trim().slice(0, 500);
  if (!TYPES.includes(type)) return { ok: false, error: 'Choose what you’re asking for.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Choose a date.' };
  if (!reason) return { ok: false, error: 'Add a short reason.' };
  const b = db.batch(); const ref = db.collection(`${T}/shiftRequests`).doc();
  const base: any = { id: ref.id, staffId: me.staffId, type, date, reason, createdAt: now, via: me.portal ? 'portal' : 'app' };
  if (type === 'swap') {
    const mine = (await db.doc(`${T}/shifts/${String(input.myShiftId || '')}`).get()); const theirs = (await db.doc(`${T}/shifts/${String(input.swapShiftId || '')}`).get());
    if (!mine.exists || (mine.data() as any).staffId !== me.staffId) return { ok: false, error: 'You’re not on that shift.' };
    if (!theirs.exists || !(theirs.data() as any).staffId || (theirs.data() as any).staffId === me.staffId) return { ok: false, error: 'Choose a colleague’s shift to swap with.' };
    const withId = String((theirs.data() as any).staffId);
    b.set(ref, { ...base, status: 'pending_swap_consent', myShiftId: mine.id, swapShiftId: theirs.id, swapWithStaffId: withId });
    note(db, b, T, withId, 'swap_request', `${me.name} would like to swap shifts with you on ${day(date)}.`, 'requests', now);
  } else {
    b.set(ref, { ...base, status: 'pending', ...(input.shiftId ? { shiftId: String(input.shiftId) } : {}) });
    if (type === 'day_off') { const r = db.collection(`${T}/shiftDayOffBlocks`).doc(); b.set(r, { id: r.id, staffId: me.staffId, date, status: 'pending', requestId: ref.id, reason, createdAt: now }); }
    for (const m of await managers(db, T)) if (m !== me.staffId) note(db, b, T, m, 'shift_request', `${me.name} asked for ${type === 'day_off' ? 'a day off' : type === 'early_release' ? 'an early finish' : type === 'pickup' ? 'an extra shift' : 'a change'} on ${day(date)}: “${reason.slice(0, 120)}”`, '/schedule/requests', now);
  }
  await b.commit();
  return { ok: true, message: type === 'swap' ? 'Sent to your colleague to agree.' : 'Sent to your manager.', id: ref.id };
}

export async function consentToSwap(db: any, tenantId: string, me: RequestActor, requestId: string, agree: boolean, now = new Date().toISOString()): Promise<Out> {
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/shiftRequests/${requestId}`); const s = await ref.get();
  if (!s.exists) return { ok: false, error: 'That request isn’t there any more.' };
  const r: any = s.data();
  if (r.swapWithStaffId !== me.staffId) return { ok: false, error: 'This swap wasn’t asked of you.' };
  if (r.status !== 'pending_swap_consent') return { ok: false, error: 'This swap has already been answered.' };
  const b = db.batch();
  b.update(ref, { status: agree ? 'swap_consent_given' : 'swap_consent_denied', consentBy: me.staffId, consentAt: now });
  note(db, b, T, r.staffId, agree ? 'swap_consent_given' : 'swap_consent_denied', agree ? `${me.name} agreed to swap on ${day(r.date)} — a manager will confirm it.` : `${me.name} can’t swap on ${day(r.date)}.`, 'requests', now);
  if (agree) for (const m of await managers(db, T)) note(db, b, T, m, 'swap_request', `${me.name} agreed to swap shifts on ${day(r.date)} — approve it to make the change.`, '/schedule/requests', now);
  await b.commit();
  return { ok: true, message: agree ? 'Agreed — a manager will confirm it.' : 'Declined.' };
}

export async function decideRequest(db: any, tenantId: string, me: RequestActor, requestId: string, approve: boolean, managerNote = '', now = new Date().toISOString()): Promise<Out> {
  if (!me.isManager) return { ok: false, error: 'Only a manager can approve requests.' };
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/shiftRequests/${requestId}`); const s = await ref.get();
  if (!s.exists) return { ok: false, error: 'That request isn’t there any more.' };
  const r: any = s.data(); const b = db.batch(); const msgNote = String(managerNote || '').trim().slice(0, 300);
  if (['approved', 'denied'].includes(String(r.status))) return { ok: false, error: 'This request has already been decided.' };
  if (r.type === 'swap' && approve) {
    if (r.status !== 'swap_consent_given') return { ok: false, error: 'The colleague hasn’t agreed to this swap yet.' };
    const [a, c] = await Promise.all([db.doc(`${T}/shifts/${r.myShiftId}`).get(), db.doc(`${T}/shifts/${r.swapShiftId}`).get()]);
    if (!a.exists || !c.exists || (a.data() as any).staffId !== r.staffId || (c.data() as any).staffId !== r.swapWithStaffId) return { ok: false, error: 'One of those shifts has changed since — ask them to request the swap again.' };
    b.update(a.ref, { staffId: r.swapWithStaffId, swappedAt: now, swapRequestId: requestId }); b.update(c.ref, { staffId: r.staffId, swappedAt: now, swapRequestId: requestId });
  }
  b.update(ref, { status: approve ? 'approved' : 'denied', approvedBy: me.staffId, approvedByName: me.name, resolvedAt: now, managerNote: msgNote || null });
  if (r.type === 'day_off') {
    const blocks = (await db.collection(`${T}/shiftDayOffBlocks`).where('requestId', '==', requestId).get()).docs;
    for (const d of blocks) b.update(d.ref, { status: approve ? 'approved' : 'denied', ...(approve ? { approvedAt: now } : {}) });
    if (approve) { const e = db.collection(`${T}/events`).doc(); const who = (await db.doc(`${T}/staff/${r.staffId}`).get()).data()?.name || 'Team member';
      b.set(e, { id: e.id, title: `${who} - Day Off`, type: 'blocked', allDay: true, startTime: `${r.date}T00:00:00`, endTime: `${r.date}T23:59:59`, staffIds: [r.staffId], source: 'day_off_approved', requestId, createdAt: now }); }
  }
  const what = r.type === 'swap' ? 'shift swap' : r.type === 'day_off' ? 'day off' : 'request';
  for (const uid of [r.staffId, ...(r.type === 'swap' ? [r.swapWithStaffId] : [])].filter(Boolean)) note(db, b, T, uid, approve ? 'request_approved' : 'request_denied', `Your ${what} on ${day(r.date)} was ${approve ? 'approved' : 'not approved'}${msgNote ? ` — ${msgNote}` : ''}.`, 'schedule', now);
  await b.commit();
  return { ok: true, message: approve ? 'Approved.' : 'Not approved.' };
}
