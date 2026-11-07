// src/app/api/forms/visit/route.ts — THE TEAM'S SIDE OF A VISIT'S FORMS (board FormsStaff). From the appointment's
// "Before the visit": send the client a reminder now (the same one as the evening before, at most once every 4 hours,
// counting the evening one), waive a form for this visit with a reason (it isn't on file, so the next visit asks as
// usual) or undo that, note that someone opened the answers (health answers are private: who looked, and when, is
// kept), and mark inspiration photos as looked at. Signed-in team only; everything but noting an opening is for managers,
// people who may manage any booking, and the visit's own provider. Only a manager waives a health form.
// The answers to a form kept beside the visit (a long visit record moves older answers there) are read here too, by the
// same rule as the appointment: health answers only for people allowed to see health notes. And "Ask for different
// photos": the client gets a text or email with the visit link, where they add new ones (with the team's note).
//   POST { tenantId, apptId, action: 'remind' | 'waive' | 'unwaive' | 'opened' | 'answers' | 'photos_ok' | 'photos_again', formId?, reason?, note? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const GAP_MS = 4 * 3600e3;
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
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

  if (action === 'opened' || action === 'answers') {
    // Only a form this visit asks for (its services, the team, its request) or has signed, or one on the client's file.
    const svcIds = [appt.serviceId, ...(Array.isArray(appt.addOnIds) ? appt.addOnIds : [])].filter(Boolean).map(String).slice(0, 11);
    const svcs = (await Promise.all(svcIds.map((id) => db.doc(`${T}/services/${id}`).get().then((d: any) => (d.exists ? d.data() : null)).catch(() => null)))).filter(Boolean);
    const rec: any = appt.checkInToken ? ((await db.doc(`${T}/bookingCompletions/${appt.checkInToken}`).get().catch(() => null))?.data?.() || {}) : {};
    let known = ID.test(formId) && (formsAskedFor(appt, svcs).includes(formId) || signedOnVisit(appt).has(formId) || (Array.isArray(rec.requiredConsentFormIds) && rec.requiredConsentFormIds.map(String).includes(formId)));
    if (!known && ID.test(formId) && appt.clientId) known = !!(await db.doc(`${T}/clients/${appt.clientId}/signedConsents/${formId}`).get().catch(() => null))?.exists;
    if (!known) return bad('That form isn’t part of this visit.');
    let record: any = null;
    if (action === 'answers') {
      const kept: any = (await db.doc(`${T}/appointments/${apptId}/formAnswers/${formId.replace(/[^A-Za-z0-9_-]/g, '_')}`).get().catch(() => null))?.data?.() || null;
      if (!kept) return bad('Those answers aren’t here.', 404);
      const def: any = (await db.doc(`${T}/consentForms/${formId}`).get().catch(() => null))?.data?.() || null;
      const { isHealthForm } = await import('@/lib/forms'); const { canSeeCareNoteContents } = await import('@/lib/privacy');
      const tenantDoc: any = (await db.doc(T).get()).data() || {};
      if ((!def || isHealthForm(def)) && !who.isTenantOwner && !canSeeCareNoteContents(tenantDoc, who.role)) return bad('Health answers are private.', 403);
      record = { formId, formTitle: kept.formTitle || def?.title || null, formData: kept.formData && typeof kept.formData === 'object' ? kept.formData : {}, signedName: kept.signedName || null, acknowledged: kept.acknowledged === true, signedAt: kept.signedAt || null, via: kept.via || null, source: kept.source || null, guardian: kept.guardian || null, guardianName: kept.guardianName || null, guardianRelationship: kept.guardianRelationship || null };
    }
    await logAuditAdmin(db, tenantId, { action: 'forms.answers_opened', targetType: 'appointment', targetId: apptId, summary: `${who.name || 'Someone'} opened ${appt.clientName || 'a client'}’s answers to a form (${formId})`, actor }).catch(() => {});
    return NextResponse.json({ ok: true, ...(record ? { record } : {}) });
  }

  if (!['waive', 'unwaive', 'remind', 'photos_ok', 'photos_again'].includes(action)) return bad('Unknown action.');
  if (!mayAct) return bad('Ask a manager, or the person doing this visit, to do this.', 403);
  const { visitForms, closeIfDone, ENDED_VISIT } = await import('@/lib/forms-visit');
  if (ENDED_VISIT.includes(String(appt.status || ''))) return bad('This visit isn’t going ahead, so there’s nothing to change here.', 409);

  // Inspiration photos looked at: "Looks good" (the client sees nothing; the team sees who looked). Not while the client
  // has been asked for different ones (their new ones come in first), so a screen left open never cancels an ask.
  if (action === 'photos_ok') {
    const done = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      if (cur.inspoReview?.status === 'again') return false;
      tx.update(ref, { inspoReview: { status: 'ok', by: who.name || 'Team', byUid: who.uid || null, at: nowIso } });
      return true;
    });
    if (!done) return bad(`${first(appt.clientName) || 'The client'} was asked for different photos. Their new ones will show here.`, 409);
    return NextResponse.json({ ok: true });
  }

  // "Ask for different photos": the visit link asks for new ones, with the team's note, and the client is told once.
  // If the message can't go out, nothing changes and the team is told why (they can ask again straight away).
  if (action === 'photos_again') {
    const note = String(b.note || '').trim().slice(0, 200);
    if (!(ms(appt.startTime) > Date.now())) return bad('This visit has already started, so there’s no time to send new photos.', 409);
    if (!appt.checkInToken || appt.linkRevokedAt) return bad('This client’s visit link is turned off, so they can’t send new photos there.', 409);
    const tenantNow: any = (await db.doc(T).get()).data() || {};
    if (tenantNow?.clientNotify?.enabled === false) return bad('Messages to clients are switched off in Settings, so they can’t be asked.', 409);
    // Once an hour at most (two taps, or two people, ask once).
    let before: any = null;
    const asked = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      if (cur.inspoReview?.status === 'again' && ms(cur.inspoReview?.at) > Date.now() - 3600e3) return false;
      before = cur.inspoReview || null;
      tx.update(ref, { inspoReview: { status: 'again', note: note || null, by: who.name || 'Team', byUid: who.uid || null, at: nowIso } });
      return true;
    });
    if (!asked) return bad('They were just asked. You can ask again later.', 429);
    const { askForPhotos } = await import('@/lib/forms-remind');
    let sent: 'sent' | 'off' | 'no_contact' | 'failed' = 'failed';
    try { sent = await askForPhotos(db, tenantId, { ...appt, id: apptId }, tenantNow, note, first(who.name) || null); } catch (e) { console.error('[forms/visit] photos', e); }
    if (sent !== 'sent') {
      // Put it back as it was (unless someone has changed it since).
      await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(ref)).data() || {}; if (cur.inspoReview?.status === 'again' && cur.inspoReview?.at === nowIso) tx.update(ref, { inspoReview: before || FieldValue.delete() }); })
        .catch((e: any) => console.error('[forms/visit] photos: putting the ask back', apptId, e));
      const name = first(appt.clientName) || 'This client';
      return bad(sent === 'off' ? `${name} has chosen not to get messages, so they couldn’t be asked. Mention it when they arrive.`
        : sent === 'no_contact' ? `There’s no phone number or email for ${name}, so they couldn’t be asked.`
        : `The message to ${name} didn’t go out. Please try again in a moment.`, 409);
    }
    await logAuditAdmin(db, tenantId, { action: 'forms.photos_again', targetType: 'appointment', targetId: apptId, summary: `${who.name || 'Someone'} asked ${appt.clientName || 'a client'} for different inspiration photos${note ? `: ${note}` : ''}`, actor }).catch(() => {});
    return NextResponse.json({ ok: true, sent: true });
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
  const { sendFormsReminder } = await import('@/lib/forms-remind');
  const due = state.dueAt || appt.startTime;   // as the visit's service has it (lib/forms-visit)
  let sent = false;
  try { sent = await sendFormsReminder(db, tenantId, { ...appt, id: apptId }, tenant, state, due); } catch (e) { console.error('[forms/visit] remind', e); }
  if (!sent) {
    await ref.set({ formsNudgedAt: before || FieldValue.delete() }, { merge: true }).catch(() => {});
    return bad('The reminder couldn’t be sent. Check the client’s phone number and email.', 409);
  }
  await logAuditAdmin(db, tenantId, { action: 'forms.reminded', targetType: 'appointment', targetId: apptId, summary: `${who.name || 'Someone'} sent ${appt.clientName || 'a client'} a reminder to finish their forms`, actor }).catch(() => {});
  return NextResponse.json({ ok: true });
}
