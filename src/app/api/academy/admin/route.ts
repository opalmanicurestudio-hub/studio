// src/app/api/academy/admin/route.ts
//
// THE COURSE BUILDER — owners and managers of the business.
//   list · course-get · course-save · course-delete
//   lesson-save · lesson-delete · lesson-move
//   upload-create  (a Mux upload URL for a lesson's video)
//   video-status   (is Mux done processing? saves the playback id)
//   students       (who's enrolled, and how far they've got)

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { slugify, RESERVED_SLUGS, loadLessons, muxConfigured, muxSigningReady, muxCreateUpload, muxUploadStatus } from '@/lib/academy';
import { appendAudit, verifyAudit, transcript, qrWindow, qrCode, QR_WINDOW_SEC } from '@/lib/academy-compliance';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
const KINDS = ['video', 'text', 'download'];

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  // Owners, managers and instructors. Only owners/managers change courses and settings.
  const isInstructor = String(auth.actor.role || '').toLowerCase() === 'instructor';
  if (!auth.actor.isManager && !auth.actor.isTenantOwner && !isInstructor) return NextResponse.json({ ok: false, error: 'Only owners, managers and instructors can use the academy tools.' }, { status: 403 });
  const INSTRUCTOR_OK = ['list', 'course-get', 'students', 'attendance', 'attendance-approve', 'attendance-resolve', 'attendance-code', 'transcript', 'audit-verify'];
  if (isInstructor && !auth.actor.isManager && !INSTRUCTOR_OK.includes(String(b.action))) return NextResponse.json({ ok: false, error: 'Instructors can review attendance and students, not change courses.' }, { status: 403 });
  const who = auth.actor.name || auth.actor.uid;
  const db = getAdminDb();
  const base = `tenants/${tenantId}/courses`;
  const now = new Date().toISOString();
  const courseId = String(b.courseId || '');

  try {
    if (b.action === 'list') {
      const s = await db.collection(base).limit(200).get();
      const courses = s.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, c: any) => String(c.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return NextResponse.json({ ok: true, courses, mux: muxConfigured(), muxSigning: muxSigningReady() });
    }

    if (b.action === 'course-get') {
      const c = await db.doc(`${base}/${courseId}`).get();
      if (!c.exists) return NextResponse.json({ ok: false, error: 'Course not found.' }, { status: 404 });
      return NextResponse.json({ ok: true, course: { id: c.id, ...(c.data() as any) }, lessons: await loadLessons(tenantId, courseId), mux: muxConfigured(), muxSigning: muxSigningReady() });
    }

    if (b.action === 'course-save') {
      const c = b.course || {};
      const title = String(c.title || '').trim().slice(0, 120);
      if (!title) return NextResponse.json({ ok: false, error: 'Give the course a title.' }, { status: 400 });
      const ref = c.id ? db.doc(`${base}/${String(c.id)}`) : db.collection(base).doc();
      const cur = ((await ref.get()).data() as any) || {};
      // A unique, friendly address: /learn/{business}/{slug}
      let slug = slugify(c.slug || cur.slug || title);
      if (RESERVED_SLUGS.includes(slug)) slug = `${slug}-course`;
      const clash = await db.collection(base).where('slug', '==', slug).limit(2).get();
      if (clash.docs.some((d: any) => d.id !== ref.id)) slug = `${slug}-${ref.id.slice(0, 4).toLowerCase()}`;
      const status = c.status === 'published' ? 'published' : 'draft';
      await ref.set({
        id: ref.id, title, slug, subtitle: String(c.subtitle || '').slice(0, 200), description: String(c.description || '').slice(0, 8000),
        priceCents: Math.max(0, Math.round(Number(c.priceDollars ?? (cur.priceCents || 0) / 100) * 100)),
        level: String(c.level || '').slice(0, 40) || null, instructorName: String(c.instructorName || '').slice(0, 80) || null,
        coverUrl: /^https:\/\//.test(String(c.coverUrl || '')) ? String(c.coverUrl) : null,
        // Hours tracking for state-licensed schools (all optional).
        compliance: !!c.compliance, requiredOnlineHours: Math.max(0, Number(c.requiredOnlineHours) || 0) || null, requiredInPersonHours: Math.max(0, Number(c.requiredInPersonHours) || 0) || null,
        minEngagementPct: Math.min(100, Math.max(0, Number(c.minEngagementPct ?? 80))), minWatchPct: Math.min(100, Math.max(0, Number(c.minWatchPct ?? 90))),
        attentionCheckMinutes: Math.min(60, Math.max(0, Number(c.attentionCheckMinutes ?? 10))),
        whatYouLearn: Array.isArray(c.whatYouLearn) ? c.whatYouLearn.map((x: any) => String(x).slice(0, 160)).filter(Boolean).slice(0, 12) : (cur.whatYouLearn || []),
        status, publishedAt: status === 'published' ? (cur.publishedAt || now) : cur.publishedAt || null,
        createdAt: cur.createdAt || now, updatedAt: now, enrolledCount: cur.enrolledCount || 0, revenueCents: cur.revenueCents || 0,
      }, { merge: true });
      return NextResponse.json({ ok: true, id: ref.id, slug });
    }

    if (b.action === 'course-delete') {
      const enrolled = await db.collection(`tenants/${tenantId}/enrollments`).where('courseId', '==', courseId).limit(1).get();
      if (!enrolled.empty) return NextResponse.json({ ok: false, error: 'Students are enrolled — unpublish it instead, so they keep access.' }, { status: 400 });
      const lessons = await db.collection(`${base}/${courseId}/lessons`).get();
      const batch = db.batch(); lessons.docs.forEach((d: any) => batch.delete(d.ref)); batch.delete(db.doc(`${base}/${courseId}`)); await batch.commit();
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'lesson-save') {
      const l = b.lesson || {};
      const title = String(l.title || '').trim().slice(0, 160);
      if (!title) return NextResponse.json({ ok: false, error: 'Give the lesson a title.' }, { status: 400 });
      const col = db.collection(`${base}/${courseId}/lessons`);
      const ref = l.id ? col.doc(String(l.id)) : col.doc();
      const cur = ((await ref.get()).data() as any) || {};
      let order = cur.order;
      if (order == null) { const all = await loadLessons(tenantId, courseId); order = all.length ? Math.max(...all.map((x: any) => x.order ?? 0)) + 1 : 0; }
      await ref.set({
        id: ref.id, title, order, moduleTitle: String(l.moduleTitle || cur.moduleTitle || 'Module 1').slice(0, 120),
        kind: KINDS.includes(l.kind) ? l.kind : 'video', body: String(l.body || '').slice(0, 30000),
        videoUrl: String(l.videoUrl || '').slice(0, 500) || null, downloadUrl: /^https:\/\//.test(String(l.downloadUrl || '')) ? String(l.downloadUrl) : null,
        downloadName: String(l.downloadName || '').slice(0, 120) || null, preview: !!l.preview, updatedAt: now,
        minMinutes: Math.max(0, Math.min(600, Number(l.minMinutes) || 0)),
        quiz: Array.isArray(l.quiz?.questions) && l.quiz.questions.length ? { passPct: Math.min(100, Math.max(1, Number(l.quiz.passPct) || 80)),
          questions: l.quiz.questions.slice(0, 50).map((q: any) => ({ q: String(q.q || '').slice(0, 400), options: (q.options || []).map((o: any) => String(o).slice(0, 200)).filter(Boolean).slice(0, 6), answer: Math.max(0, Number(q.answer) || 0) })).filter((q: any) => q.q && q.options.length >= 2) } : null,
      }, { merge: true });
      const count = (await col.count().get()).data().count;
      await db.doc(`${base}/${courseId}`).set({ lessonCount: count, updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true, id: ref.id });
    }

    if (b.action === 'lesson-delete') {
      await db.doc(`${base}/${courseId}/lessons/${String(b.lessonId || '')}`).delete();
      const count = (await db.collection(`${base}/${courseId}/lessons`).count().get()).data().count;
      await db.doc(`${base}/${courseId}`).set({ lessonCount: count, updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'lesson-move') {
      const all = await loadLessons(tenantId, courseId);
      const i = all.findIndex((x: any) => x.id === b.lessonId); const j = i + (b.direction === 'up' ? -1 : 1);
      if (i < 0 || j < 0 || j >= all.length) return NextResponse.json({ ok: true });
      [all[i], all[j]] = [all[j], all[i]];
      const batch = db.batch(); all.forEach((x: any, k: number) => batch.set(db.doc(`${base}/${courseId}/lessons/${x.id}`), { order: k }, { merge: true })); await batch.commit();
      return NextResponse.json({ ok: true });
    }

    if (b.action === 'upload-create') {
      if (!muxConfigured()) return NextResponse.json({ ok: false, error: 'Video hosting isn’t connected yet (MUX_TOKEN_ID / MUX_TOKEN_SECRET). Paste a video link for now.' }, { status: 400 });
      const origin = req.headers.get('origin') || req.nextUrl.origin;
      const up = await muxCreateUpload(origin);
      await db.doc(`${base}/${courseId}/lessons/${String(b.lessonId)}`).set({ muxUploadId: up.uploadId, muxStatus: 'uploading', muxPlaybackId: null, updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true, url: up.url });
    }

    if (b.action === 'video-status') {
      const ref = db.doc(`${base}/${courseId}/lessons/${String(b.lessonId)}`);
      const l = ((await ref.get()).data() as any) || {};
      if (!l.muxUploadId) return NextResponse.json({ ok: true, status: 'none' });
      const st = await muxUploadStatus(l.muxUploadId);
      await ref.set({ muxStatus: st.status, ...(st.assetId ? { muxAssetId: st.assetId } : {}), ...(st.playbackId ? { muxPlaybackId: st.playbackId } : {}), ...(st.durationSec ? { durationSec: st.durationSec } : {}) }, { merge: true });
      return NextResponse.json({ ok: true, ...st });
    }

    if (b.action === 'students') {
      let q: any = db.collection(`tenants/${tenantId}/enrollments`);
      if (courseId) q = q.where('courseId', '==', courseId);
      const s = await q.limit(1000).get();
      const lessons = courseId ? await loadLessons(tenantId, courseId) : [];
      const total = Math.max(1, lessons.length);
      return NextResponse.json({ ok: true, students: s.docs.map((d: any) => { const e = d.data() as any; const done = Object.keys(e.progress || {}).length; return { studentId: e.studentId, email: e.email, courseId: e.courseId, since: e.createdAt, paidCents: e.paidCents || 0, done, pct: courseId ? Math.round((done / total) * 100) : null, onlineHours: Math.round(((e.onlineSec || 0) / 3600) * 10) / 10, certificateCode: e.certificateCode || null, lastActiveAt: e.lastActiveAt || null }; }).sort((a: any, c: any) => String(c.since).localeCompare(String(a.since))) });
    }

    // ── Attendance: live list, approvals, corrections (never overwritten) ──
    if (b.action === 'attendance') {
      const col = db.collection(`tenants/${tenantId}/attendance`);
      const since = new Date(Date.now() - Math.max(1, Math.min(90, Number(b.days) || 14)) * 86400000).toISOString();
      const [recent, open, flagged, pending] = await Promise.all([col.where('clockInAt', '>=', since).limit(2000).get(), col.where('status', '==', 'open').limit(500).get(), col.where('status', '==', 'flagged').limit(500).get(), col.where('status', '==', 'pending').limit(500).get()]);
      const map = new Map<string, any>();
      for (const s of [recent, open, flagged, pending]) for (const d of s.docs) map.set(d.id, { id: d.id, ...(d.data() as any) });
      const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      return NextResponse.json({ ok: true, punches: [...map.values()].sort((a, c) => String(c.clockInAt).localeCompare(String(a.clockInAt))), settings: t.academy || {} });
    }
    if (b.action === 'attendance-approve' || b.action === 'attendance-resolve') {
      const ref = db.doc(`tenants/${tenantId}/attendance/${String(b.id || '')}`);
      const p = ((await ref.get()).data() as any) || null;
      if (!p) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const reason = String(b.reason || '').trim().slice(0, 300);
      if (b.action === 'attendance-approve') {
        if (!p.clockOutAt) return NextResponse.json({ ok: false, error: 'Add a clock-out time first (Correct).' }, { status: 400 });
        await ref.set({ status: 'approved', approvedBy: who, approvedAt: now }, { merge: true });
        await appendAudit(tenantId, { type: 'attendance.approved', studentId: p.studentId, by: who, summary: `Approved ${Math.floor((p.minutes || 0) / 60)}h ${(p.minutes || 0) % 60}m for ${p.email}`, data: { attendanceId: ref.id } });
        return NextResponse.json({ ok: true });
      }
      if (!reason) return NextResponse.json({ ok: false, error: 'A reason is required for every correction.' }, { status: 400 });
      const inAt = b.clockInAt ? new Date(b.clockInAt).toISOString() : p.clockInAt;
      const outAt = b.clockOutAt ? new Date(b.clockOutAt).toISOString() : p.clockOutAt;
      if (!outAt || new Date(outAt) <= new Date(inAt)) return NextResponse.json({ ok: false, error: 'Clock-out must be after clock-in.' }, { status: 400 });
      if (new Date(outAt).getTime() > Date.now() + 60000) return NextResponse.json({ ok: false, error: 'Clock-out can’t be in the future.' }, { status: 400 });
      const minutes = Math.floor((new Date(outAt).getTime() - new Date(inAt).getTime()) / 60000);
      const correction = { at: now, by: who, reason, before: { clockInAt: p.clockInAt, clockOutAt: p.clockOutAt, minutes: p.minutes || 0, status: p.status }, after: { clockInAt: inAt, clockOutAt: outAt, minutes } };
      await ref.set({ clockInAt: inAt, clockOutAt: outAt, minutes, status: 'approved', approvedBy: who, approvedAt: now, corrections: [...(p.corrections || []), correction] }, { merge: true });
      await appendAudit(tenantId, { type: 'attendance.corrected', studentId: p.studentId, by: who, summary: `Corrected ${p.email}: ${new Date(inAt).toLocaleString()} → ${new Date(outAt).toLocaleTimeString()} (${Math.floor(minutes / 60)}h ${minutes % 60}m). Reason: ${reason}`, data: { attendanceId: ref.id, ...correction } });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'attendance-code') {
      const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const w = qrWindow();
      return NextResponse.json({ ok: true, url: `${linkOrigin(t, req.nextUrl.origin)}/learn/${tenantId}/attend?c=${qrCode(tenantId, w)}&w=${w}`, refreshInSec: QR_WINDOW_SEC - (Math.floor(Date.now() / 1000) % QR_WINDOW_SEC), name: t.name || '' });
    }
    if (b.action === 'academy-settings') {
      if (!auth.actor.isTenantOwner && !auth.actor.isManager) return NextResponse.json({ ok: false, error: 'Owners and managers only.' }, { status: 403 });
      const cur = ((((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {}).academy) || {};
      const next = { ...cur,
        ...('requireGeo' in b ? { requireGeo: !!b.requireGeo } : {}), ...('requireApproval' in b ? { requireApproval: !!b.requireApproval } : {}),
        ...(b.geo && Number.isFinite(Number(b.geo.lat)) ? { geo: { lat: Number(b.geo.lat), lng: Number(b.geo.lng), radiusM: Math.max(30, Math.min(2000, Number(b.geo.radiusM) || 150)) } } : {}) };
      await db.doc(`tenants/${tenantId}`).set({ academy: next }, { merge: true });
      await appendAudit(tenantId, { type: 'settings.changed', by: who, summary: `Attendance settings: location ${next.requireGeo ? 'required' : 'optional'}${next.geo ? ` (${next.geo.radiusM} m)` : ''}, approval ${next.requireApproval ? 'required' : 'automatic'}`, data: next });
      return NextResponse.json({ ok: true, settings: next });
    }
    if (b.action === 'transcript') {
      const tr = await transcript(tenantId, String(b.studentId || ''), b.courseId ? String(b.courseId) : null);
      const c = b.courseId ? ((await db.doc(`${base}/${String(b.courseId)}`).get()).data() as any) || null : null;
      return NextResponse.json({ ok: true, transcript: tr, course: c ? { title: c.title, requiredOnlineHours: c.requiredOnlineHours || null, requiredInPersonHours: c.requiredInPersonHours || null } : null });
    }
    if (b.action === 'audit-verify') {
      const v = await verifyAudit(tenantId);
      const recent = await db.collection(`tenants/${tenantId}/academyAudit`).orderBy('seq', 'desc').limit(40).get();
      return NextResponse.json({ ...v, verified: v.ok, ok: true, recent: recent.docs.map((d: any) => { const e = d.data() as any; return { seq: e.seq, at: e.at, type: e.type, by: e.by, summary: e.summary }; }) });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
