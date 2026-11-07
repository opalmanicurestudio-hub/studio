// src/app/api/forms/visit/route.ts — THE TEAM'S SIDE OF A VISIT'S FORMS (board FormsStaff). From the appointment's
// "Before the visit": send the client a reminder now (the same one as the evening before, at most once every 4 hours,
// counting the evening one), waive a form for this visit with a reason (it isn't on file, so the next visit asks as
// usual) or undo that, note that someone opened the answers (health answers are private: who looked, and when, is
// kept), and mark inspiration photos as looked at. Signed-in team only; everything but noting an opening is for managers,
// people who may manage any booking, and the visit's own provider. Only a manager waives a health form.
//   POST { tenantId, apptId, action: 'remind' | 'waive' | 'unwaive' | 'opened' | 'photos_ok', formId?, reason? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const GAP_MS = 4 * 3600e3;
const ms = (v: any) => { const t = v?.toDate ? v.toDate().getTime() : Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), apptId = String(b.apptId || ''), action = String(b.action || '');
  if (!ID.test(tenantId) || !ID.test(apptId)) return bad('That visit couldn’t be found.');
  const auth = await verifyStaffActor(req, tenantId); if (!auth.ok) return bad(auth.error, auth.status);
  const who: any = auth.actor; const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const ref = db.doc(`${T}/appointments/${apptId}`);
  const appt: any = (await ref.get()).data();
  if (!appt) return bad('That visit couldn’t be found.', 404);
  const nowIso = new Date().toISOString();
  const actor = { type: 'user', uid: who.uid || null, name: who.name || 'Team', role: who.role || 'staff', via: 'appointment' } as any;
  const formId = String(b.formId || '');
  const manager = !!(who.isManager || who.isTenantOwner);
  // Managers, anyone who may manage every booking, and the person doing this visit (a solo provider is all three).
  const mayAct = manager || (Array.isArray(who.caps) && who.caps.includes('bookings.manage')) || (!!who.uid && appt.staffId === who.uid);
  const { formsAskedFor, signedOnVisit } = await import('@/lib/forms');

  if (action === 'opened') {
    // Only a form this visit asks for (its services, the team, its request) or has signed, or one on the client's file.
    const svcIds = [appt.serviceId, ...(Array.isArray(appt.addOnIds) ? appt.addOnIds : [])].filter(Boolean).map(String).slice(0, 11);
    const svcs = (await Promise.all(svcIds.map((id) => db.doc(`${T}/services/${id}`).get().then((d: any) => (d.exists ? d.data() : null)).catch(() => null)))).filter(Boolean);
    const rec: any = appt.checkInToken ? ((await db.doc(`${T}/bookingCompletions/${appt.checkInToken}`).get().catch(() => null))?.data?.() || {}) : {};
    let known = ID.test(formId) && (formsAskedFor(appt, svcs).includes(formId) || signedOnVisit(appt).has(formId) || (Array.isArray(rec.requiredConsentFormIds) && rec.requiredConsentFormIds.map(String).includes(formId)));
    if (!known && ID.test(formId) && appt.clientId) known = !!(await db.doc(`${T}/clients/${appt.clientId}/signedConsents/${formId}`).get().catch(() => null))?.exists;
    if (!known) return bad('That form isn’t part of this visit.');
    await logAuditAdmin(db, tenantId, { action: 'forms.answers_opened', targetType: 'appointment', targetId: apptId, summary: `${who.name || 'Someone'} opened ${appt.clientName || 'a client'}’s answers to a form (${formId})`, actor }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (!['waive', 'unwaive', 'remind', 'photos_ok'].includes(action)) return bad('Unknown action.');
  if (!mayAct) return bad('Ask a manager, or the person doing this visit, to do this.', 403);
  const { visitForms, closeIfDone, ENDED_VISIT } = await import('@/lib/forms-visit');
  if (ENDED_VISIT.includes(String(appt.status || ''))) return bad('This visit isn’t going ahead, so there’s nothing to change here.', 409);

  // Inspiration photos looked at: "Looks good" (the client sees nothing; the team sees who looked).
  if (action === 'photos_ok') {
    await ref.set({ inspoReview: { status: 'ok', by: who.name || 'Team', byUid: who.uid || null, at: nowIso } }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  const tenant: any = (await db.doc(T).get()).data() || {};
  const token = String(appt.checkInToken || '');
  const cRef = token ? db.doc(`${T}/bookingCompletions/${token}`) : null;
  let raw: any = null; let rec: any = null; let state: any;
  try {
    raw = cRef ? (await cRef.get()).data() || null : null;
    rec = raw && (!raw.status || raw.status === 'pending') ? raw : null;   // the visit's request, while it's open
    state = await visitForms(db, tenantId, { ...appt, id: apptId }, { tenant, rec });
  }
  catch (e) { console.error('[forms/visit] read', e); return bad('That didn’t go through. Try again in a moment.', 503); }

  if (action === 'waive' || action === 'unwaive') {
    if (!ID.test(formId)) return bad('That form isn’t part of this visit.');
    const ask = state.asks.find((a: any) => a.formId === formId);
    if (action === 'waive') {
      if (!ask) return bad('That form isn’t part of this visit.');
      if (ask.ask === 'done' && !ask.waived) return bad('That form is already done for this visit.', 409);
      const def = (state.defs || []).find((d: any) => d.id === formId);
      const { isHealthForm } = await import('@/lib/forms');
      if (isHealthForm(def) && !manager) return bad('Only a manager can waive a health form.', 403);
      const reason = String(b.reason || '').trim().slice(0, 200);
      if (!reason) return bad('Add a reason, so the team knows why.');
      await ref.set({ formsWaived: { [formId]: { by: who.name || 'Team', byUid: who.uid || null, reason, at: nowIso } } }, { merge: true });
      await logAuditAdmin(db, tenantId, { action: 'forms.waived', targetType: 'appointment', targetId: apptId, summary: `${who.name || 'Someone'} waived “${ask.title}” for ${appt.clientName || 'a client'}’s visit: ${reason}`, actor }).catch(() => {});
      // If that was the last thing the visit's request was waiting on, it closes (no thank-you: they didn't finish it).
      try {
        const after: any = (await ref.get()).data() || {};
        const nextState = await visitForms(db, tenantId, { ...after, id: apptId }, { tenant, rec });
        if (rec && token) await closeIfDone(db, tenantId, token, { ...after, id: apptId }, rec, nextState, tenant, { closedBy: 'waiver' });
      } catch (e) { console.error('[forms/visit] close', e); }
      return NextResponse.json({ ok: true });
    }
    // Ask for it again: taken off the visit's waivers in one step (so two people at once can't undo each other's).
    let had = false;
    await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      const w = cur.formsWaived && typeof cur.formsWaived === 'object' && !Array.isArray(cur.formsWaived) ? cur.formsWaived : {};
      had = !!w[formId]; if (!had) return;
      const rest = { ...w }; delete rest[formId];
      tx.update(ref, { formsWaived: rest });
    });
    if (!had) return NextResponse.json({ ok: true });
    await logAuditAdmin(db, tenantId, { action: 'forms.unwaived', targetType: 'appointment', targetId: apptId, summary: `${who.name || 'Someone'} asked ${appt.clientName || 'a client'} for a waived form again (${formId})`, actor }).catch(() => {});
    // A request the waiver closed opens again, so the visit link asks for it.
    try {
      if (cRef) {
        const after: any = (await ref.get()).data() || {};
        const nextState = await visitForms(db, tenantId, { ...after, id: apptId }, { tenant, rec: raw });
        if (nextState.left > 0) await db.runTransaction(async (tx: any) => {
          const r: any = (await tx.get(cRef)).data() || null;
          if (!r || r.status !== 'complete' || r.closedBy !== 'waiver') return;
          tx.set(cRef, { status: 'pending', closedBy: FieldValue.delete(), completedAt: FieldValue.delete() }, { merge: true });
          tx.set(ref, { completionStatus: 'pending', requirementsCompletedAt: FieldValue.delete() }, { merge: true });
        });
      }
    } catch (e) { console.error('[forms/visit] reopen', e); }
    return NextResponse.json({ ok: true });
  }

  // action === 'remind'
  if (!(ms(appt.startTime) > Date.now())) return bad('This visit has already started, so a reminder wouldn’t help now.', 409);
  if (!token || appt.linkRevokedAt) return bad('This client’s visit link is turned off, so a reminder can’t be sent.', 409);
  if (tenant?.clientNotify?.enabled === false) return bad('Messages to clients are switched off in Settings, so a reminder can’t be sent.', 409);
  if (state.left <= 0) return bad('Nothing is left to ask for on this visit.', 409);
  // Claimed before sending, so two taps (or two people) send one reminder; given back if it couldn't be sent.
  let before: any = null;
  const claimed = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if (Math.max(ms(cur.formsNudgedAt), ms(cur.formsReminderSentAt)) > Date.now() - GAP_MS) return false;
    before = cur.formsNudgedAt ?? null;
    tx.set(ref, { formsNudgedAt: nowIso }, { merge: true });
    return true;
  });
  if (!claimed) return bad('A reminder went out in the last few hours. You can send another later.', 429);
  const { sendFormsReminder } = await import('@/lib/forms-remind'); const { formsDueAt } = await import('@/lib/forms');
  const due = formsDueAt(appt.startTime, appt.createdAt) || appt.startTime;
  let sent = false;
  try { sent = await sendFormsReminder(db, tenantId, { ...appt, id: apptId }, tenant, state, due); } catch (e) { console.error('[forms/visit] remind', e); }
  if (!sent) {
    await ref.set({ formsNudgedAt: before || FieldValue.delete() }, { merge: true }).catch(() => {});
    return bad('The reminder couldn’t be sent. Check the client’s phone number and email.', 409);
  }
  await logAuditAdmin(db, tenantId, { action: 'forms.reminded', targetType: 'appointment', targetId: apptId, summary: `${who.name || 'Someone'} sent ${appt.clientName || 'a client'} a reminder to finish their forms`, actor }).catch(() => {});
  return NextResponse.json({ ok: true });
}
