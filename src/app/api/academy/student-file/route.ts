// src/app/api/academy/student-file/route.ts
//
// THE STUDENT FILE — everything about one student in one place.
//   get           profile · programs (hours with state limits, evaluations,
//                 performances, progress checks, retention date) · enrolment &
//                 agreement · documents on file (checklist) · Board forms ·
//                 daily/weekly hour records with running total · grades ·
//                 tuition · messages · staff notes · this student's audit trail
//   profile-save  date of birth, phone, address, emergency contact   (owners/managers)
//   note-add      private staff note                                  (staff)
//   file-upload   add to the file: photos (several → one PDF) or a PDF (owners/managers)
//   file-verify   mark a document checked                             (owners/managers)
//   eval-record   record an evaluation score (every attempt kept)     (staff)
//   form-update   Board form: submitted date, confirmation #, receipt  (owners/managers)
// Nothing in the file can be deleted: a replacement keeps the earlier version.

import { deviceAllowed } from '@/lib/approved-devices';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { appendAudit } from '@/lib/academy-compliance';
import { programProgress, recordEvaluation } from '@/lib/academy-school';
import { planBalance } from '@/lib/academy-admissions';
import { privateBucket, savePrivateDocument } from '@/lib/private-storage';
import { retainUntil } from '@/lib/state-rules';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Several photos (a phone scan) → one PDF, one page per photo. */
async function photosToPdf(dataUrls: string[]) {
  const pdf = await PDFDocument.create();
  for (const u of dataUrls) {
    const m = String(u).match(/^data:image\/(jpeg|png);base64,(.+)$/); if (!m) throw new Error('Scans must be photos (JPEG or PNG).');
    const bytes = Buffer.from(m[2], 'base64');
    const img = m[1] === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const w = 612, h = Math.round((img.height / img.width) * 612);   // US Letter width
    pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return Buffer.from(await pdf.save());
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const isInstructor = String(auth.actor.role || '').toLowerCase() === 'instructor';
  const isLead = auth.actor.isManager || auth.actor.isTenantOwner;
  if (!isLead && !isInstructor) return NextResponse.json({ ok: false, error: 'Owners, managers and instructors only.' }, { status: 403 });
  { const dv = await deviceAllowed(tenantId, req); if (!dv.ok) return NextResponse.json({ ok: false, error: dv.error, deviceBlocked: true }, { status: 403 }); }
  if (!isLead && ['profile-save', 'file-upload', 'file-verify', 'form-update'].includes(b.action)) return NextResponse.json({ ok: false, error: 'Owners and managers only.' }, { status: 403 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const who = auth.actor.name || auth.actor.uid; const now = new Date().toISOString();
  const studentId = String(b.studentId || '');
  const sRef = db.doc(`${T}/students/${studentId}`);

  try {
    if (b.action === 'get') {
      const st = ((await sRef.get()).data() as any) || null;
      if (!st) return NextResponse.json({ ok: false, error: 'Student not found.' }, { status: 404 });
      const [pe, adm, files, forms, att, sess, live, ce, thread, audit] = await Promise.all([
        db.collection(`${T}/programEnrollments`).where('studentId', '==', studentId).limit(10).get(),
        db.collection(`${T}/admissions`).where('email', '==', st.email).limit(5).get(),
        db.collection(`${T}/studentFiles`).where('studentId', '==', studentId).limit(300).get(),
        db.collection(`${T}/boardForms`).where('studentId', '==', studentId).limit(50).get(),
        db.collection(`${T}/attendance`).where('studentId', '==', studentId).limit(5000).get(),
        db.collection(`${T}/learningSessions`).where('studentId', '==', studentId).limit(5000).get(),
        db.collection(`${T}/liveAttendance`).where('studentId', '==', studentId).limit(2000).get(),
        db.collection(`${T}/enrollments`).where('studentId', '==', studentId).limit(100).get(),
        db.doc(`${T}/academyThreads/${studentId}`).collection('messages').orderBy('at', 'desc').limit(30).get(),
        db.collection(`${T}/academyAudit`).where('studentId', '==', studentId).limit(500).get(),
      ]);
      const programs = [];
      for (const d of pe.docs) {
        const e = d.data() as any; const p = ((await db.doc(`${T}/programs/${e.programId}`).get()).data() as any) || {};
        const pr = await programProgress(tenantId, d.id);
        const plan = (await db.doc(`${T}/tuitionPlans/${d.id}`).get()).data() as any;
        const bal = plan ? await planBalance(tenantId, d.id) : null;
        programs.push({ id: d.id, name: p.name, rule: p.rule || null, state: p.state || null, status: e.status, startDate: e.startDate, createdAt: e.createdAt, statusHistory: e.statusHistory || [],
          hours: pr?.hours, totalHours: p.totalHours || null, limits: p.limits || null, requirements: pr?.requirements || [],
          evaluations: (p.evaluations || []).map((x: any) => ({ ...x, result: e.evaluations?.[x.key] || null })), sap: e.sap || [], journey: e.journey || {}, risk: e.risk || null,
          requiredDocs: p.requiredDocs || [], boardForms: p.boardForms || [],
          retainUntil: retainUntil(p, e.createdAt || e.startDate || now, e.journey?.license?.examAcceptedAt || null),
          tuition: plan ? { status: plan.status, balanceCents: bal!.balanceCents, paidCents: bal!.paidCents, totalCents: plan.totalCents, nextDueAt: plan.nextDueAt || null, entries: bal!.entries.slice(-40).reverse() } : null });
      }
      // NC-style records: daily in-school + online minutes, weekly subtotals, running total.
      const days: Record<string, { school: number; online: number; live: number }> = {};
      const add = (iso: string, k: 'school' | 'online' | 'live', m: number) => { const dk = String(iso).slice(0, 10); const r = days[dk] = days[dk] || { school: 0, online: 0, live: 0 }; r[k] += m; };
      for (const x of att.docs) { const a = x.data() as any; if (['closed', 'approved'].includes(a.status)) add(a.clockInAt, 'school', a.minutes || 0); }
      for (const x of sess.docs) { const a = x.data() as any; add(a.startedAt, 'online', (a.engagedSec || 0) / 60); }
      for (const x of live.docs) { const a = x.data() as any; add(a.joinedAt, 'live', a.minutes || 0); }
      const weeks: Record<string, { school: number; online: number; days: any[] }> = {};
      for (const [dk, v] of Object.entries(days).sort()) { const d = new Date(dk + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const wk = d.toISOString().slice(0, 10); const w = weeks[wk] = weeks[wk] || { school: 0, online: 0, days: [] }; w.school += v.school; w.online += v.online + v.live; w.days.push({ day: dk, ...v }); }
      let running = 0;
      const records = Object.entries(weeks).sort().map(([wk, w]) => { running += w.school + w.online; return { week: wk, schoolMin: Math.round(w.school), onlineMin: Math.round(w.online), runningMin: Math.round(running), days: w.days.map((x) => ({ day: x.day, school: Math.round(x.school), online: Math.round(x.online + x.live) })) }; }).reverse();
      const grades = ce.docs.flatMap((d: any) => { const e = d.data() as any; return Object.entries(e.quiz || {}).map(([lessonId, q]: any) => ({ courseId: e.courseId, lessonId, best: q.best, passed: q.passed, attempts: (q.attempts || []).length })); });
      const a0 = adm.docs[0]?.data() as any;
      return NextResponse.json({ ok: true,
        profile: { id: studentId, name: st.name, email: st.email, dob: st.dob || null, phone: st.phone || a0?.phone || null, address: st.address || null, emergency: st.emergency || null, language: st.language || 'en', photo: st.referencePhoto?.ref || null, createdAt: st.createdAt },
        programs, admission: a0 ? { stage: a0.stage, source: a0.source, cohortId: a0.cohortId || null, agreement: a0.agreement ? { signedAt: a0.agreement.signedAt, signedName: a0.agreement.signedName, sha256: a0.agreement.sha256, countersignedBy: a0.agreement.countersignedBy || null, text: a0.agreement.text } : null, documents: a0.documents || {} } : null,
        files: files.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).sort((x: any, y: any) => String(y.at).localeCompare(String(x.at))),
        signed: (await db.collection(`${T}/docAcks`).where('studentId', '==', studentId).limit(200).get()).docs.map((d: any) => { const a = d.data() as any; return { title: a.title, version: a.version, signedName: a.signedName, at: a.at }; }).sort((x: any, y: any) => String(y.at).localeCompare(String(x.at))),
        forms: forms.docs.map((d: any) => d.data()).sort((x: any, y: any) => String(x.dueAt).localeCompare(String(y.dueAt))),
        records, grades, notes: (st.staffNotes || []).slice().reverse(),
        messages: thread.docs.map((d: any) => d.data()).reverse(),
        audit: audit.docs.map((d: any) => { const x = d.data() as any; return { seq: x.seq, at: x.at, by: x.by, type: x.type, summary: x.summary }; }).sort((x: any, y: any) => y.seq - x.seq),
        canManage: isLead });
    }

    if (b.action === 'profile-save') {
      const pf = b.profile || {};
      const clean = { dob: String(pf.dob || '').slice(0, 10) || null, phone: String(pf.phone || '').slice(0, 30) || null, address: String(pf.address || '').slice(0, 200) || null,
        emergency: pf.emergency ? { name: String(pf.emergency.name || '').slice(0, 80) || null, phone: String(pf.emergency.phone || '').slice(0, 30) || null, relation: String(pf.emergency.relation || '').slice(0, 40) || null } : null };
      await sRef.set(clean, { merge: true });
      await appendAudit(tenantId, { type: 'student.profile', studentId, by: who, summary: 'Student details updated', data: { fields: Object.keys(clean) } });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'note-add') {
      const text = String(b.text || '').trim().slice(0, 2000); if (!text) return NextResponse.json({ ok: false, error: 'Write a note.' }, { status: 400 });
      const st = ((await sRef.get()).data() as any) || {};
      await sRef.set({ staffNotes: [...(st.staffNotes || []), { at: now, by: who, text }] }, { merge: true });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'file-upload') {
      const category = String(b.category || 'Other').slice(0, 160), name = String(b.name || category).slice(0, 160);
      const files: string[] = Array.isArray(b.files) ? b.files.slice(0, 20) : [];
      if (!files.length) return NextResponse.json({ ok: false, error: 'Add a photo or PDF.' }, { status: 400 });
      const base = `${T}/academy/files/${studentId}/${Date.now()}`;
      let saved: any;
      if (files.length > 1 || /^data:image\//.test(files[0])) {
        const buf = await photosToPdf(files);
        if (buf.length > 12_000_000) return NextResponse.json({ ok: false, error: 'Too large — scan fewer pages at a time.' }, { status: 400 });
        const path = `${base}.pdf`; const bucket = await privateBucket();
        await bucket.file(path).save(buf, { contentType: 'application/pdf', resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
        saved = { ref: `/api/files/view?t=${encodeURIComponent(tenantId)}&p=${encodeURIComponent(path)}`, path, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, type: 'application/pdf', pages: files.length };
      } else saved = { ...(await savePrivateDocument(tenantId, base, files[0], 12_000_000)), pages: null };
      const ref = db.collection(`${T}/studentFiles`).doc();
      const prior = await db.collection(`${T}/studentFiles`).where('studentId', '==', studentId).limit(300).get();
      const replaces = prior.docs.filter((d: any) => (d.data() as any).category === category && !(d.data() as any).replacedBy).map((d: any) => d.id);
      for (const id of replaces) await db.doc(`${T}/studentFiles/${id}`).set({ replacedBy: ref.id }, { merge: true });
      await ref.set({ id: ref.id, studentId, category, name, ...saved, status: 'on file', uploadedBy: who, at: now, replaces: replaces[0] || null });
      await appendAudit(tenantId, { type: 'student.file', studentId, by: who, summary: `Filed “${name}”${saved.pages ? ` (${saved.pages} page${saved.pages === 1 ? '' : 's'})` : ''}${replaces.length ? ' — replaces the earlier copy (kept)' : ''}`, data: { fileId: ref.id, sha256: saved.sha256 } });
      return NextResponse.json({ ok: true, id: ref.id });
    }
    if (b.action === 'file-verify') {
      const ref = db.doc(`${T}/studentFiles/${String(b.fileId || '')}`); const f = ((await ref.get()).data() as any) || null;
      if (!f) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      await ref.set({ status: 'verified', verifiedBy: who, verifiedAt: now }, { merge: true });
      await appendAudit(tenantId, { type: 'student.file_verified', studentId: f.studentId, by: who, summary: `Checked “${f.name}”`, data: { fileId: ref.id, sha256: f.sha256 } });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'eval-record') {
      const r = await recordEvaluation({ tenantId, enrollmentId: String(b.enrollmentId || ''), key: String(b.key || ''), score: Number(b.score), notes: String(b.notes || '').slice(0, 300), by: who });
      return NextResponse.json({ ok: true, ...r });
    }
    if (b.action === 'form-update') {
      const ref = db.doc(`${T}/boardForms/${String(b.formId || '')}`); const f = ((await ref.get()).data() as any) || null;
      if (!f) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      let receipt: any = null;
      if (b.receipt) receipt = await savePrivateDocument(tenantId, `${T}/academy/files/${f.studentId}/board-${f.form}-receipt-${Date.now()}`, String(b.receipt), 8_000_000);
      const patch = { status: b.status === 'submitted' ? 'submitted' : f.status, submittedAt: String(b.submittedAt || '').slice(0, 10) || f.submittedAt || null, confirmation: String(b.confirmation || '').slice(0, 80) || f.confirmation || null, ...(receipt ? { receiptRef: receipt.ref, receiptSha: receipt.sha256 } : {}), updatedBy: who, updatedAt: now };
      await ref.set(patch, { merge: true });
      await appendAudit(tenantId, { type: 'board.form', studentId: f.studentId, by: who, summary: `${f.label}: ${patch.status}${patch.submittedAt ? ` on ${patch.submittedAt}` : ''}${patch.confirmation ? ` · confirmation ${patch.confirmation}` : ''}${receipt ? ' · receipt filed' : ''}`, data: { formId: ref.id } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
