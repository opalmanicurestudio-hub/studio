// src/app/api/completion/submit/route.ts — A CLIENT FINISHES THEIR FORMS (completion link).
// The completion page used to write these from the browser — and the database
// rules (rightly) refuse clients, so the signed forms never reached the
// appointment and a card-already-on-file completion was never marked done.
// Now the server does it, with the completion link's token as the key:
//   • an audit record of exactly what was signed and accepted
//   • signed forms, policy acceptance and uploaded files onto the appointment
//   • card already on file (the SERVER's flag) → completion marked done here;
//     otherwise the page continues to the card step as before
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';
const clip = (v: any, n: number) => (typeof v === 'string' ? v.slice(0, n) : v);

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), token = String(b.token || '');
  if (!tenantId || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) return NextResponse.json({ ok: false, error: 'This link isn’t valid.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const cRef = db.doc(`${T}/bookingCompletions/${token}`);
  const c: any = (await cRef.get()).data();
  if (!c) return NextResponse.json({ ok: false, error: 'This link isn’t valid.' }, { status: 404 });
  if (c.status === 'complete') return NextResponse.json({ ok: true, done: true, already: true });
  // Only what a client can reasonably send — bounded, never trusted for money.
  const signedForms = (Array.isArray(b.signedForms) ? b.signedForms : []).slice(0, 20).map((f: any) => ({ formId: clip(String(f?.formId || ''), 80), formTitle: clip(String(f?.formTitle || ''), 200), formData: f?.formData && typeof f.formData === 'object' ? f.formData : {} }));
  const fileSubmissions = (Array.isArray(b.fileSubmissions) ? b.fileSubmissions : []).slice(0, 20).map((x: any) => ({ requirementId: clip(String(x?.requirementId || ''), 80), label: clip(String(x?.label || ''), 200), files: (Array.isArray(x?.files) ? x.files : []).slice(0, 20) }));
  const p = b.policyAcceptance && typeof b.policyAcceptance === 'object' ? b.policyAcceptance : {};
  const nowIso = new Date().toISOString();
  const policyAcceptance = { ...p, acceptedAt: nowIso };                 // the server's clock, not the browser's
  if (JSON.stringify({ signedForms, fileSubmissions, policyAcceptance }).length > 400_000) return NextResponse.json({ ok: false, error: 'That’s too much to send at once.' }, { status: 413 });
  const skipCardStep = c.skipCardStep === true;                           // decided when the link was made, on the server
  const batch = db.batch();
  const sRef = db.collection(`${T}/completionSubmissions`).doc();
  batch.set(sRef, { id: sRef.id, token, tenantId, appointmentId: c.appointmentId || null, clientId: c.clientId || null, clientName: c.clientName || null, clientEmail: c.clientEmail || null,
    signedForms, fileSubmissions, policyAcceptance, submittedAt: nowIso, cardAlreadyOnFile: skipCardStep, via: 'completion link' });
  if (c.appointmentId) batch.set(db.doc(`${T}/appointments/${c.appointmentId}`), { signedForms, policyAcceptance, requirementFiles: fileSubmissions, completionConsentsAt: nowIso }, { merge: true });
  if (skipCardStep) batch.set(cRef, { status: 'complete', completedAt: nowIso, formsSignedAt: nowIso }, { merge: true });
  else batch.set(cRef, { formsSignedAt: nowIso }, { merge: true });
  await batch.commit();
  if (c.appointmentId) await logAuditAdmin(db, tenantId, { action: 'completion.forms_signed', targetType: 'appointment', targetId: c.appointmentId,
    summary: `${c.clientName || 'Client'} signed ${signedForms.length} form${signedForms.length === 1 ? '' : 's'} and accepted the policy${skipCardStep ? ' — all done (card already on file)' : ' — card step next'}`,
    actor: { type: 'user', name: c.clientName || 'Client', role: 'client', via: 'completion link' } }).catch(() => {});
  return NextResponse.json({ ok: true, done: skipCardStep, needsCard: !skipCardStep });
}
