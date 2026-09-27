// src/app/api/checkin/actions/route.ts
//
// THE CHECK-IN LINK'S ACTIONS, SAVED ON THE SERVER. Clients open their link
// signed out, and the database rules (rightly) refuse browser writes to
// appointments, client records, completions and reviews — so reviews,
// pre-visit steps and preferences were silently lost while the page showed
// "thank you". Each action here is authorised by the link itself: the token
// must match a check-in record (or booking completion), and everything is
// written to THAT appointment and THAT client only.
//
//   review    { token, rating 1–5, text }             once per visit
//   viewed    { token }                                first open, for the timeline
//   prefs     { token, confirmationChannel, reminderChannel, reminderHoursBefore }
//   complete  { token, tenantId, signedForms, fileSubmissions, policyAcceptance,
//               guardianByForm, profileDocuments, marketingConsent,
//               emergencyContact, acknowledgments, skipCardStep }
// (Fee payments and card/deposit completion are recorded by the Stripe webhook
//  when payment is confirmed — not from the page.)

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
const TOKEN = /^[A-Za-z0-9_-]{6,80}$/;
const str = (v: any, n = 300) => String(v ?? '').slice(0, n);
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/** The check-in record behind a link → which business, appointment, client. */
async function fromCheckIn(db: any, token: string) {
  const ci = ((await db.doc(`appointmentCheckIns/${token}`).get()).data()) || null;
  if (!ci?.tenantId || !(ci.id || ci.appointmentId)) return null;
  const apptId = String(ci.id || ci.appointmentId);
  const ref = db.doc(`tenants/${ci.tenantId}/appointments/${apptId}`);
  const appt = ((await ref.get()).data()) || null;
  if (!appt || (appt.checkInToken && appt.checkInToken !== token)) return null;
  return { tenantId: String(ci.tenantId), apptId, ref, appt };
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || ''), token = String(b.token || '');
  if (!TOKEN.test(token)) return bad('This link isn’t valid.');
  const db = getAdminDb(); const nowIso = new Date().toISOString();

  if (action === 'review') {
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    const { tenantId, apptId, ref, appt } = x;
    if (['cancelled', 'canceled', 'no_show'].includes(String(appt.status || ''))) return bad('Reviews are for completed visits.', 409);
    if (appt.startTime && Date.parse(appt.startTime) > Date.now()) return bad('You can leave a review after your visit.', 409);
    if (appt.reviewSubmittedAt) return bad('Thanks — you’ve already reviewed this visit.', 409);
    const rating = Math.round(Number(b.rating)); if (!(rating >= 1 && rating <= 5)) return bad('Please choose 1 to 5 stars.');
    const cl = appt.clientId ? (((await db.doc(`tenants/${tenantId}/clients/${appt.clientId}`).get()).data()) || {}) : {};
    const svc = appt.serviceId ? (((await db.doc(`tenants/${tenantId}/services/${appt.serviceId}`).get()).data()) || {}) : {};
    const id = nanoid();
    const batch = db.batch();
    batch.set(db.doc(`tenants/${tenantId}/reviews/${id}`), {
      id, tenantId, clientId: appt.clientId || null, clientName: appt.clientName || cl.name || 'Guest', clientAvatarUrl: cl.avatarUrl || null,
      staffId: appt.staffId || '', serviceId: appt.serviceId || null, serviceName: svc.name || appt.serviceName || 'Treatment',
      appointmentId: apptId, rating, text: str(b.text, 2000), isPublic: false, isFeatured: false, source: 'check-in link', createdAt: nowIso,
    });
    batch.set(ref, { reviewSubmittedAt: nowIso, reviewId: id, reviewRating: rating }, { merge: true });
    await batch.commit();
    await logAuditAdmin(db, tenantId, { action: 'review.received', targetType: 'appointment', targetId: apptId, summary: `${rating}★ review from ${appt.clientName || 'a client'}`, actor: { type: 'user', name: appt.clientName || 'Client', role: 'client', via: 'check-in link' } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === 'viewed') { // "client opened the link" — once, for the activity timeline
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    if (!x.appt.completionLinkFirstViewedAt) await x.ref.set({ completionLinkFirstViewedAt: nowIso }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  if (action === 'prefs') {
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    if (!x.appt.clientId) return bad('We couldn’t find your client record — please ask the studio.', 409);
    const ch = (v: any) => (['email', 'sms', 'both', 'none'].includes(String(v)) ? String(v) : 'email');
    const hours = Math.max(1, Math.min(168, Math.round(Number(b.reminderHoursBefore) || 24)));
    await db.doc(`tenants/${x.tenantId}/clients/${x.appt.clientId}`).set({ notificationPreferences: { confirmationChannel: ch(b.confirmationChannel), reminderChannel: ch(b.reminderChannel), reminderHoursBefore: hours, updatedAt: nowIso, source: 'check-in link' } }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  if (action === 'complete') {
    const tenantId = String(b.tenantId || ''); if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return bad('This link isn’t valid.');
    const cRef = db.doc(`tenants/${tenantId}/bookingCompletions/${token}`);
    const c = ((await cRef.get()).data()) || null;
    if (!c) return bad('This link isn’t valid.', 404);
    if (c.status === 'complete') return NextResponse.json({ ok: true, already: true });
    const signedForms = (Array.isArray(b.signedForms) ? b.signedForms : []).slice(0, 20).map((f: any) => ({ formId: str(f?.formId, 80), formTitle: str(f?.formTitle, 200), formData: f?.formData && typeof f.formData === 'object' ? f.formData : {} }));
    const fileSubmissions = (Array.isArray(b.fileSubmissions) ? b.fileSubmissions : []).slice(0, 20);
    const policyAcceptance = { acceptedAt: nowIso, cardAuthorization: b.skipCardStep !== true, policyVersion: str(b.policyAcceptance?.policyVersion || 'v1', 40), depositAmountCents: Number(c.depositAmountCents) || 0 };
    if (JSON.stringify({ signedForms, fileSubmissions }).length > 800_000) return bad('That’s too much to send at once — please remove a file and try again.', 413);
    const apptId = c.appointmentId || null, clientId = c.clientId || null;
    const batch = db.batch();
    batch.set(db.collection(`tenants/${tenantId}/completionSubmissions`).doc(), { token, tenantId, appointmentId: apptId, clientId, clientName: c.clientName || null, clientEmail: c.clientEmail || null, signedForms, fileSubmissions, policyAcceptance, submittedAt: nowIso, cardAlreadyOnFile: b.skipCardStep === true });
    const apptPatch: any = { signedForms, policyAcceptance, requirementFiles: fileSubmissions, completionConsentsAt: nowIso };
    const clientPatch: any = {};
    if (clientId) {
      const guardians = b.guardianByForm && typeof b.guardianByForm === 'object' ? b.guardianByForm : {};
      for (const f of signedForms) {
        const g = guardians[f.formId];
        batch.set(db.doc(`tenants/${tenantId}/clients/${clientId}/signedConsents/${f.formId}`), { formId: f.formId, formTitle: f.formTitle, signedAt: nowIso, formData: f.formData, source: 'client_self_service', appointmentId: apptId,
          ...(g?.name ? { guardianName: str(g.name, 120), guardianRelationship: str(g.relationship, 80), guardianSignedAt: nowIso } : {}) }, { merge: true });
      }
      const docs = (Array.isArray(b.profileDocuments) ? b.profileDocuments : []).slice(0, 10);
      if (docs.length) clientPatch.profileDocuments = docs.map((d: any) => ({ requirementId: str(d.requirementId, 80), label: str(d.label, 200), files: Array.isArray(d.files) ? d.files.slice(0, 10) : [], uploadedAt: nowIso }));
      if (c.requestMarketingConsent && typeof b.marketingConsent === 'boolean') { clientPatch.marketingConsent = { consented: b.marketingConsent, consentedAt: nowIso, source: 'client_self_service' }; apptPatch.marketingConsentAnsweredAt = nowIso; apptPatch.marketingConsentAnswer = b.marketingConsent; }
      const ec = b.emergencyContact; if (c.requestEmergencyContact && ec?.name && ec?.phone) { clientPatch.emergencyContact = { name: str(ec.name, 120), phone: str(ec.phone, 40), relationship: str(ec.relationship, 80) }; apptPatch.emergencyContactCapturedAt = nowIso; }
      if (Object.keys(clientPatch).length) batch.set(db.doc(`tenants/${tenantId}/clients/${clientId}`), clientPatch, { merge: true });
    }
    const acks = (Array.isArray(b.acknowledgments) ? b.acknowledgments : []).slice(0, 20).map((t: any) => str(t, 400));
    if (acks.length) { apptPatch.acknowledgedAt = nowIso; apptPatch.acknowledgedItems = acks; }
    // No card or deposit step → the requirements are done now. Otherwise the
    // Stripe webhook marks it complete when payment/card is confirmed.
    if (b.skipCardStep === true) {
      batch.set(cRef, { status: 'complete', completedAt: nowIso, formsSignedAt: nowIso }, { merge: true });
      apptPatch.completionStatus = 'completed'; apptPatch.requirementsCompletedAt = nowIso;
    } else batch.set(cRef, { formsSignedAt: nowIso }, { merge: true });
    if (apptId) batch.set(db.doc(`tenants/${tenantId}/appointments/${apptId}`), apptPatch, { merge: true });
    await batch.commit();
    await logAuditAdmin(db, tenantId, { action: 'completion.submitted', targetType: 'appointment', targetId: apptId || token, summary: `${c.clientName || 'A client'} completed their pre-visit steps (${signedForms.length} form${signedForms.length === 1 ? '' : 's'}${fileSubmissions.length ? `, ${fileSubmissions.length} file request${fileSubmissions.length === 1 ? '' : 's'}` : ''})`, actor: { type: 'user', name: c.clientName || 'Client', role: 'client', via: 'check-in link' } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  return bad('Unknown action.');
}
