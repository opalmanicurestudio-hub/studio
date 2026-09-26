// src/app/api/academy/journey/route.ts
//
// STUDENT JOURNEY — owners, managers and instructors (license/placement edits:
// owners and managers).
//   students · refresh · journey-save · outcomes
//   threads · thread · reply · announce · announcements

import { translateTexts } from '@/lib/translate';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { appendAudit } from '@/lib/academy-compliance';
import { computeRisk, evaluateSap, outcomes, postMessage, sendEmail } from '@/lib/academy-journey';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const isInstructor = String(auth.actor.role || '').toLowerCase() === 'instructor';
  const isLead = auth.actor.isManager || auth.actor.isTenantOwner;
  if (!isLead && !isInstructor) return NextResponse.json({ ok: false, error: 'Owners, managers and instructors only.' }, { status: 403 });
  if (!isLead && b.action === 'journey-save') return NextResponse.json({ ok: false, error: 'Owners and managers only.' }, { status: 403 });
  const db = getAdminDb();
  const who = auth.actor.name || auth.actor.uid;
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const origin = linkOrigin(t, req.nextUrl.origin);

  try {
    if (b.action === 'students') {
      const [enr, progs] = await Promise.all([db.collection(`tenants/${tenantId}/programEnrollments`).limit(3000).get(), db.collection(`tenants/${tenantId}/programs`).limit(100).get()]);
      const names = new Map(progs.docs.map((d: any) => [d.id, (d.data() as any).name]));
      const rank: Record<string, number> = { high: 0, watch: 1, ok: 2 };
      const students = enr.docs.map((d: any) => { const e = d.data() as any; return { id: d.id, studentId: e.studentId, name: e.name, email: e.email, status: e.status, program: names.get(e.programId) || '—', programId: e.programId, startDate: e.startDate,
        risk: e.risk || null, sap: (e.sap || []).slice(-1)[0] || null, sapHistory: e.sap || [], journey: e.journey || {} }; })
        .filter((s: any) => !b.programId || s.programId === b.programId)
        .sort((a: any, c: any) => (a.status === 'active' ? 0 : 1) - (c.status === 'active' ? 0 : 1) || (rank[a.risk?.level] ?? 3) - (rank[c.risk?.level] ?? 3) || (c.risk?.score || 0) - (a.risk?.score || 0));
      return NextResponse.json({ ok: true, students });
    }

    if (b.action === 'refresh') {
      const ref = db.doc(`tenants/${tenantId}/programEnrollments/${String(b.enrollmentId || '')}`);
      const e = ((await ref.get()).data() as any) || null;
      if (!e) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const p = ((await db.doc(`tenants/${tenantId}/programs/${e.programId}`).get()).data() as any) || {};
      const risk = await computeRisk(tenantId, e, p);
      await ref.set({ risk }, { merge: true });
      const sap = await evaluateSap(tenantId, ref, e, p, who);
      return NextResponse.json({ ok: true, risk, newChecks: sap });
    }

    if (b.action === 'journey-save') {
      const ref = db.doc(`tenants/${tenantId}/programEnrollments/${String(b.enrollmentId || '')}`);
      const e = ((await ref.get()).data() as any) || null;
      if (!e) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const j = { ...(e.journey || {}) };
      if (b.license) j.license = { examDate: String(b.license.examDate || '').slice(0, 10) || null, result: ['passed', 'failed', 'scheduled'].includes(b.license.result) ? b.license.result : null, licenseNumber: String(b.license.licenseNumber || '').slice(0, 40) || null, updatedAt: new Date().toISOString(), by: who };
      if (b.placement) j.placement = { status: ['hired', 'renting', 'self_employed', 'seeking', 'not_seeking'].includes(b.placement.status) ? b.placement.status : null, where: String(b.placement.where || '').slice(0, 120) || null, at: String(b.placement.at || '').slice(0, 10) || null, updatedAt: new Date().toISOString(), by: who };
      await ref.set({ journey: j }, { merge: true });
      await appendAudit(tenantId, { type: 'journey.updated', studentId: e.studentId, by: who, summary: `${e.name}: ${b.license ? `license ${j.license?.result || '—'}${j.license?.licenseNumber ? ` #${j.license.licenseNumber}` : ''}` : ''}${b.placement ? ` placement ${j.placement?.status || '—'}${j.placement?.where ? ` at ${j.placement.where}` : ''}` : ''}`, data: j });
      return NextResponse.json({ ok: true, journey: j });
    }

    if (b.action === 'outcomes') return NextResponse.json({ ok: true, outcomes: await outcomes(tenantId, b.programId || null) });

    if (b.action === 'threads') {
      const s = await db.collection(`tenants/${tenantId}/academyThreads`).orderBy('lastAt', 'desc').limit(300).get();
      return NextResponse.json({ ok: true, threads: s.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })) });
    }
    if (b.action === 'thread') {
      const ref = db.doc(`tenants/${tenantId}/academyThreads/${String(b.studentId || '')}`);
      const m = await ref.collection('messages').orderBy('at').limit(500).get();
      await ref.set({ unreadSchool: 0 }, { merge: true });
      return NextResponse.json({ ok: true, messages: m.docs.map((d: any) => d.data()) });
    }
    if (b.action === 'reply') {
      const st = ((await db.doc(`tenants/${tenantId}/students/${String(b.studentId || '')}`).get()).data() as any) || null;
      if (!st) return NextResponse.json({ ok: false, error: 'Student not found.' }, { status: 404 });
      // In the student's language (the original is kept alongside).
      const lang = st.language && st.language !== 'en' ? st.language : null;
      const translated = lang ? (await translateTexts(tenantId, [String(b.text)], lang))[0] : null;
      await postMessage({ tenantId, studentId: String(b.studentId), from: 'school', by: who, text: b.text, studentEmail: st.email, studentName: st.name, translated, lang });
      await sendEmail(st.email, `New message from ${t.name || 'your academy'}`, `${translated ? `${translated}\n\n———\n` : ''}${String(b.text).slice(0, 1500)}\n\n— ${who}, ${t.name || ''}\n\n${origin}/learn/${tenantId}/my`);
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'announce') {
      const title = String(b.title || '').trim().slice(0, 120), body = String(b.body || '').trim().slice(0, 4000);
      if (!title || !body) return NextResponse.json({ ok: false, error: 'A title and message are needed.' }, { status: 400 });
      const ref = db.collection(`tenants/${tenantId}/academyAnnouncements`).doc();
      const target = { programId: b.programId || null, cohortId: b.cohortId || null };
      await ref.set({ id: ref.id, title, body, ...target, by: who, at: new Date().toISOString() });
      // Who hears it: active students in the program (and cohort, via admissions).
      let recipients = (await db.collection(`tenants/${tenantId}/programEnrollments`).where('status', '==', 'active').limit(3000).get()).docs.map((d: any) => d.data() as any).filter((e: any) => !target.programId || e.programId === target.programId);
      if (target.cohortId) { const inCohort = new Set((await db.collection(`tenants/${tenantId}/admissions`).where('cohortId', '==', target.cohortId).limit(1000).get()).docs.map((d: any) => String((d.data() as any).email).toLowerCase())); recipients = recipients.filter((e: any) => inCohort.has(String(e.email).toLowerCase())); }
      let emailed = 0;
      if (b.email) for (const r of recipients.slice(0, 500)) { if (await sendEmail(r.email, `${title} — ${t.name || 'your academy'}`, `${body}\n\n— ${who}\n\n${origin}/learn/${tenantId}/my`)) emailed++; }
      await appendAudit(tenantId, { type: 'announcement', by: who, summary: `Announcement “${title}” to ${recipients.length} student${recipients.length === 1 ? '' : 's'}${b.email ? ` (${emailed} emailed)` : ''}` });
      return NextResponse.json({ ok: true, recipients: recipients.length, emailed });
    }
    if (b.action === 'announcements') {
      const s = await db.collection(`tenants/${tenantId}/academyAnnouncements`).orderBy('at', 'desc').limit(100).get();
      return NextResponse.json({ ok: true, announcements: s.docs.map((d: any) => d.data()) });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
