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

export const dynamic = 'force-dynamic';
const KINDS = ['video', 'text', 'download'];

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager && !auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only owners and managers can edit courses.' }, { status: 403 });
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
      return NextResponse.json({ ok: true, students: s.docs.map((d: any) => { const e = d.data() as any; const done = Object.keys(e.progress || {}).length; return { email: e.email, courseId: e.courseId, since: e.createdAt, paidCents: e.paidCents || 0, done, pct: courseId ? Math.round((done / total) * 100) : null }; }).sort((a: any, c: any) => String(c.since).localeCompare(String(a.since))) });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
