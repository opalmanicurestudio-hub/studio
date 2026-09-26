// src/app/api/academy/reports/route.ts
//
// REPORTS (licensed schools) — every figure comes from the verified records.
//   hours-letter { enrollmentId }        a certification letter with a
//                                        verification code (owners/managers)
//   attendance   { month, programId? }   hours per student for a month
//   sap          { programId? }          progress checks
//   outcomes     { programId? }          rates + the graduates behind them
// Each returns { title, subtitle, columns, rows, notes } (+ letter).

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { appendAudit } from '@/lib/academy-compliance';
import { programProgress } from '@/lib/academy-school';
import { outcomes } from '@/lib/academy-journey';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const h = (min: number) => Math.round((min / 60) * 10) / 10;
const d = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const isInstructor = String(auth.actor.role || '').toLowerCase() === 'instructor';
  const isLead = auth.actor.isManager || auth.actor.isTenantOwner;
  if (!isLead && !isInstructor) return NextResponse.json({ ok: false, error: 'Owners, managers and instructors only.' }, { status: 403 });
  if (b.action === 'hours-letter' && !isLead) return NextResponse.json({ ok: false, error: 'Only owners and managers can issue certification letters.' }, { status: 403 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const who = auth.actor.name || auth.actor.uid;
  const t = ((await db.doc(T).get()).data() as any) || {};
  const school = { name: t.name || 'The academy', address: [t.address, t.city, t.state, t.zip].filter(Boolean).join(', ') || t.businessAddress || '', phone: t.phone || '', email: t.email || '' };
  const progs = await db.collection(`${T}/programs`).limit(100).get();
  const P = new Map(progs.docs.map((x: any) => [x.id, x.data() as any]));

  try {
    if (b.action === 'hours-letter') {
      const pr = await programProgress(tenantId, String(b.enrollmentId || ''));
      if (!pr) return NextResponse.json({ ok: false, error: 'Student not found.' }, { status: 404 });
      const e = pr.enrollment;
      const code = randomBytes(5).toString('hex').toUpperCase();
      const issuedAt = new Date().toISOString();
      const doc = { code, type: 'hours_letter', status: 'valid', tenantId, tenantName: school.name, studentName: e.name, email: e.email, programName: pr.program.name, programHours: pr.program.totalHours,
        startDate: e.startDate || null, status_: e.status, graduatedAt: e.graduatedAt || null, hours: pr.hours, requirements: pr.requirements, issuedAt, issuedBy: who };
      await db.doc(`platformDocuments/${code}`).set(doc);
      await appendAudit(tenantId, { type: 'report.hours_letter', studentId: e.studentId, by: who, summary: `Hours certification letter ${code} issued for ${e.name}: ${pr.hours.total} h (${pr.hours.online} online incl. ${pr.hours.live} live, ${pr.hours.inPerson} in person)`, data: { code } });
      return NextResponse.json({ ok: true, letter: { ...doc, school, verifyUrl: `${linkOrigin(t, req.nextUrl.origin)}/verify/${code}` } });
    }

    if (b.action === 'attendance') {
      const month = /^\d{4}-\d{2}$/.test(String(b.month || '')) ? String(b.month) : new Date().toISOString().slice(0, 7);
      const from = new Date(`${month}-01T00:00:00`).toISOString(); const toD = new Date(`${month}-01T00:00:00`); toD.setMonth(toD.getMonth() + 1); const to = toD.toISOString();
      const [enr, sess, att, live] = await Promise.all([
        db.collection(`${T}/programEnrollments`).limit(3000).get(),
        db.collection(`${T}/learningSessions`).where('startedAt', '>=', from).limit(20000).get(),
        db.collection(`${T}/attendance`).where('clockInAt', '>=', from).limit(20000).get(),
        db.collection(`${T}/liveAttendance`).where('joinedAt', '>=', from).limit(20000).get(),
      ]);
      const inMonth = (iso: string) => iso < to;
      const online: Record<string, number> = {}, liveM: Record<string, number> = {}, inP: Record<string, number> = {}, open: Record<string, number> = {};
      for (const x of sess.docs) { const s = x.data() as any; if (inMonth(s.startedAt)) online[s.studentId] = (online[s.studentId] || 0) + (s.engagedSec || 0) / 60; }
      for (const x of live.docs) { const s = x.data() as any; if (inMonth(s.joinedAt)) liveM[s.studentId] = (liveM[s.studentId] || 0) + (s.minutes || 0); }
      for (const x of att.docs) { const s = x.data() as any; if (!inMonth(s.clockInAt)) continue; if (['closed', 'approved'].includes(s.status)) inP[s.studentId] = (inP[s.studentId] || 0) + (s.minutes || 0); else open[s.studentId] = (open[s.studentId] || 0) + 1; }
      const rows = enr.docs.map((x: any) => x.data() as any).filter((e: any) => !b.programId || e.programId === b.programId)
        .filter((e: any) => e.status === 'active' || online[e.studentId] || inP[e.studentId] || liveM[e.studentId])
        .map((e: any) => [e.name, P.get(e.programId)?.name || '—', e.status, h(online[e.studentId] || 0), h(liveM[e.studentId] || 0), h(inP[e.studentId] || 0), h((online[e.studentId] || 0) + (liveM[e.studentId] || 0) + (inP[e.studentId] || 0)), open[e.studentId] || 0])
        .sort((a: any, c: any) => String(a[0]).localeCompare(String(c[0])));
      return NextResponse.json({ ok: true, report: { title: `Monthly attendance — ${new Date(from).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, subtitle: `${school.name}${b.programId ? ` · ${P.get(b.programId)?.name}` : ''}`,
        columns: ['Student', 'Program', 'Status', 'Online (verified) h', 'Live class h', 'In person (approved) h', 'Total h', 'Punches not resolved'], rows,
        notes: ['Online hours count only verified active learning time. In-person hours count only closed or approved punches; punches not resolved earn no hours until an instructor corrects them.', 'Every entry is backed by the academy’s tamper-evident audit log.'] } });
    }

    if (b.action === 'sap') {
      const enr = await db.collection(`${T}/programEnrollments`).limit(3000).get();
      const rows: any[] = [];
      for (const x of enr.docs) { const e = x.data() as any; if (b.programId && e.programId !== b.programId) continue;
        for (const s of e.sap || []) rows.push([e.name, P.get(e.programId)?.name || '—', `${s.checkpoint} h`, d(s.at), s.hours, s.attendancePct ?? '—', s.quizAvg ?? '—', s.practicalAvg ?? '—', s.result, (s.fails || []).join('; ')]);
        if (!(e.sap || []).length && e.status === 'active') rows.push([e.name, P.get(e.programId)?.name || '—', '—', '—', '—', '—', '—', '—', 'no checkpoint yet', '']); }
      rows.sort((a, c) => String(a[0]).localeCompare(String(c[0])));
      return NextResponse.json({ ok: true, report: { title: 'Satisfactory academic progress', subtitle: school.name, columns: ['Student', 'Program', 'Checkpoint', 'Checked', 'Hours', 'Attendance %', 'Quiz avg %', 'Practical avg', 'Result', 'Below minimum'], rows,
        notes: ['Thresholds and checkpoints are the school’s program settings. Attendance % = hours completed ÷ hours scheduled at the time of the check.'] } });
    }

    if (b.action === 'outcomes') {
      const o = await outcomes(tenantId, b.programId || null);
      const enr = await db.collection(`${T}/programEnrollments`).where('status', '==', 'graduated').limit(3000).get();
      const rows = enr.docs.map((x: any) => x.data() as any).filter((e: any) => !b.programId || e.programId === b.programId)
        .map((e: any) => [e.name, P.get(e.programId)?.name || '—', d(e.startDate), d(e.graduatedAt), e.journey?.license?.result || '—', e.journey?.license?.licenseNumber || '', e.journey?.placement?.status?.replace('_', ' ') || '—', e.journey?.placement?.where || '']);
      return NextResponse.json({ ok: true, report: { title: 'Student outcomes', subtitle: `${school.name}${b.programId ? ` · ${P.get(b.programId)?.name}` : ''}`,
        summary: [['Completion', o.rates.completion == null ? '—' : `${o.rates.completion}%`, `${o.counts.graduated} graduated · ${o.counts.withdrawn} withdrew`], ['Licensure', o.rates.licensure == null ? '—' : `${o.rates.licensure}%`, `${o.counts.licensed} of ${o.counts.tookExam} passed`], ['Placement', o.rates.placement == null ? '—' : `${o.rates.placement}%`, `${o.counts.placed} of ${o.counts.graduated} graduates`]],
        columns: ['Graduate', 'Program', 'Started', 'Graduated', 'License exam', 'License #', 'Placement', 'Where'], rows,
        notes: ['Accreditors define these rates precisely (for example which students count and over what period) — check your accreditor’s formula before submitting.'] } });
    }
    return NextResponse.json({ ok: false, error: 'Unknown report' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
