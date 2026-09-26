// src/app/api/academy/admin/route.ts
//
// THE COURSE BUILDER — owners and managers of the business.
//   list · course-get · course-save · course-delete
//   lesson-save · lesson-delete · lesson-move
//   upload-create  (a Mux upload URL for a lesson's video)
//   video-status   (is Mux done processing? saves the playback id)
//   students       (who's enrolled, and how far they've got)

import { mediaUrl } from '@/lib/academy';
import { askClaude, aiConfigured, parseJson } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { slugify, RESERVED_SLUGS, loadLessons, muxConfigured, muxSigningReady, muxCreateUpload, muxUploadStatus, muxAddCaptions, muxTranscript, CAPTION_LANGUAGES } from '@/lib/academy';
import { appendAudit, verifyAudit, transcript, qrWindow, qrCode, QR_WINDOW_SEC } from '@/lib/academy-compliance';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
const KINDS = ['video', 'text', 'download'];
const str = (v: any, n: number) => String(v ?? '').slice(0, n);
const BLOCK_TYPES = ['text', 'image', 'steps', 'callout', 'file', 'divider'];
/** Content blocks: text · image · step-by-step (a photo per step) · callout (safety / key point / tip) · file · divider. */
function cleanBlocks(v: any) {
  return (Array.isArray(v) ? v : []).slice(0, 80).map((b: any) => {
    if (!BLOCK_TYPES.includes(b?.type)) return null;
    const id = String(b.id || Math.random().toString(36).slice(2, 10)).slice(0, 20);
    if (b.type === 'text') return { id, type: 'text', text: str(b.text, 8000) };
    if (b.type === 'image') return b.mediaId ? { id, type: 'image', mediaId: str(b.mediaId, 40), caption: str(b.caption, 300) } : null;
    if (b.type === 'file') return b.mediaId ? { id, type: 'file', mediaId: str(b.mediaId, 40), label: str(b.label, 160) } : null;
    if (b.type === 'callout') return { id, type: 'callout', tone: ['safety', 'key', 'tip'].includes(b.tone) ? b.tone : 'key', text: str(b.text, 1500) };
    if (b.type === 'steps') return { id, type: 'steps', title: str(b.title, 160), steps: (b.steps || []).slice(0, 40).map((x: any) => ({ text: str(x.text, 800), mediaId: x.mediaId ? str(x.mediaId, 40) : null })).filter((x: any) => x.text || x.mediaId) };
    return { id, type: 'divider' };
  }).filter(Boolean);
}
const PLAN_TYPES = ['guided_theory', 'demonstration', 'guided_practice', 'independent_theory', 'practice', 'evaluation', 'performance'];
/** The instructor's lesson plan (Board instruction order, infection control integrated). */
function cleanPlan(p: any) {
  if (!p) return null;
  const list = (v: any, n = 20) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x: any) => str(x, 300).trim()).filter(Boolean).slice(0, n);
  return { objectives: list(p.objectives), minutes: Math.max(0, Math.min(600, Number(p.minutes) || 0)), materials: list(p.materials, 40), setup: str(p.setup, 2000), infectionControl: str(p.infectionControl, 3000),
    agenda: (Array.isArray(p.agenda) ? p.agenda : []).slice(0, 30).map((a: any) => ({ minutes: Math.max(0, Math.min(600, Number(a.minutes) || 0)), type: PLAN_TYPES.includes(a.type) ? a.type : 'guided_theory', activity: str(a.activity, 800) })),
    notes: str(p.notes, 4000), differentiation: str(p.differentiation, 2000), assessment: str(p.assessment, 2000), subjects: list(p.subjects, 12), updatedAt: new Date().toISOString() };
}
/** Interactive activities: match pairs, put steps in order, or a client scenario. */
function cleanActivity(a: any) {
  if (!a || !['match', 'order', 'scenario', 'label'].includes(a.type)) return null;
  if (a.type === 'label') { const points = (a.points || []).map((p: any) => ({ x: Math.max(0, Math.min(100, Number(p.x) || 0)), y: Math.max(0, Math.min(100, Number(p.y) || 0)), label: str(p.label, 80) })).filter((p: any) => p.label).slice(0, 15);
    return /^https:\/\//.test(String(a.imageUrl || '')) && points.length >= 2 ? { type: 'label', prompt: str(a.prompt, 200) || 'Label the diagram', imageUrl: str(a.imageUrl, 600), points } : null; }
  if (a.type === 'match') { const pairs = (a.pairs || []).map((p: any) => ({ left: str(p.left, 160), right: str(p.right, 160) })).filter((p: any) => p.left && p.right).slice(0, 10); return pairs.length >= 2 ? { type: 'match', prompt: str(a.prompt, 200) || 'Match the pairs', pairs } : null; }
  if (a.type === 'order') { const steps = (a.steps || []).map((x: any) => str(x, 200)).filter(Boolean).slice(0, 12); return steps.length >= 2 ? { type: 'order', prompt: str(a.prompt, 200) || 'Put these in order', steps } : null; }
  const options = (a.options || []).map((o: any) => ({ text: str(o.text, 300), correct: !!o.correct, feedback: str(o.feedback, 500) })).filter((o: any) => o.text).slice(0, 6);
  return options.length >= 2 && options.some((o: any) => o.correct) ? { type: 'scenario', prompt: str(a.prompt, 800), options } : null;
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  // Owners, managers and instructors. Only owners/managers change courses and settings.
  const isInstructor = String(auth.actor.role || '').toLowerCase() === 'instructor';
  if (!auth.actor.isManager && !auth.actor.isTenantOwner && !isInstructor) return NextResponse.json({ ok: false, error: 'Only owners, managers and instructors can use the academy tools.' }, { status: 403 });
  const INSTRUCTOR_OK = ['media-list', 'media-url', 'qbank-list', 'worksheet-ai', 'tutor-log', 'list', 'course-get', 'students', 'attendance', 'attendance-approve', 'attendance-resolve', 'attendance-code', 'attendance-photo-check', 'transcript', 'audit-verify'];
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
        aiTutor: c.aiTutor !== false,
        captionLanguage: CAPTION_LANGUAGES[c.captionLanguage] ? c.captionLanguage : (cur.captionLanguage || 'en'),
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
        releaseAfterDays: Math.max(0, Math.min(3650, Number(l.releaseAfterDays) || 0)),
        flashcards: (Array.isArray(l.flashcards) ? l.flashcards : []).map((f: any) => ({ front: String(f.front || '').slice(0, 300), back: String(f.back || '').slice(0, 600) })).filter((f: any) => f.front && f.back).slice(0, 60),
        activity: cleanActivity(l.activity),
        ...('blocks' in l ? { blocks: cleanBlocks(l.blocks) } : {}),
        ...('plan' in l ? { plan: cleanPlan(l.plan) } : {}),
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
      const course = ((await db.doc(`${base}/${courseId}`).get()).data() as any) || {};
      const up = await muxCreateUpload(origin, course.captionLanguage || 'en');
      await db.doc(`${base}/${courseId}/lessons/${String(b.lessonId)}`).set({ muxUploadId: up.uploadId, muxStatus: 'uploading', muxPlaybackId: null, updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true, url: up.url });
    }

    if (b.action === 'video-status') {
      const ref = db.doc(`${base}/${courseId}/lessons/${String(b.lessonId)}`);
      const l = ((await ref.get()).data() as any) || {};
      if (!l.muxUploadId) return NextResponse.json({ ok: true, status: 'none' });
      const st = await muxUploadStatus(l.muxUploadId);
      const patch: any = { muxStatus: st.status, ...(st.assetId ? { muxAssetId: st.assetId } : {}), ...(st.playbackId ? { muxPlaybackId: st.playbackId } : {}), ...(st.durationSec ? { durationSec: st.durationSec } : {}) };
      if (st.captions) patch.captions = { trackId: st.captions.trackId, status: st.captions.status };
      // Captions ready → keep the transcript on the lesson (students, the tutor, AI drafts).
      if (st.captions?.status === 'ready' && st.playbackId && !l.transcript) { const tx = await muxTranscript(st.playbackId, st.captions.trackId); if (tx) patch.transcript = tx; }
      await ref.set(patch, { merge: true });
      return NextResponse.json({ ok: true, ...st, transcript: !!(patch.transcript || l.transcript) });
    }

    if (b.action === 'captions-add') {
      const ref = db.doc(`${base}/${courseId}/lessons/${String(b.lessonId)}`);
      const l = ((await ref.get()).data() as any) || {};
      if (!l.muxAssetId) return NextResponse.json({ ok: false, error: 'Upload the video first.' }, { status: 400 });
      const course = ((await db.doc(`${base}/${courseId}`).get()).data() as any) || {};
      const r = await muxAddCaptions(l.muxAssetId, course.captionLanguage || 'en');
      await ref.set({ captions: { ...(l.captions || {}), status: 'preparing' } }, { merge: true });
      return NextResponse.json({ ok: true, already: r.already });
    }

    if (b.action === 'students') {
      let q: any = db.collection(`tenants/${tenantId}/enrollments`);
      if (courseId) q = q.where('courseId', '==', courseId);
      const s = await q.limit(1000).get();
      const lessons = courseId ? await loadLessons(tenantId, courseId) : [];
      const total = Math.max(1, lessons.length);
      return NextResponse.json({ ok: true, students: s.docs.map((d: any) => { const e = d.data() as any; const done = Object.keys(e.progress || {}).length; return { studentId: e.studentId, email: e.email, courseId: e.courseId, since: e.createdAt, paidCents: e.paidCents || 0, done, pct: courseId ? Math.round((done / total) * 100) : null, onlineHours: Math.round(((e.onlineSec || 0) / 3600) * 10) / 10, certificateCode: e.certificateCode || null, lastActiveAt: e.lastActiveAt || null }; }).sort((a: any, c: any) => String(c.since).localeCompare(String(a.since))) });
    }

    // ── Media library (per course) ──
    if (b.action === 'media-list') {
      const s = await db.collection(`${base}/${courseId}/media`).limit(500).get();
      return NextResponse.json({ ok: true, media: s.docs.map((d: any) => d.data()).sort((a: any, c: any) => String(c.at).localeCompare(String(a.at))) });
    }
    if (b.action === 'media-upload') {
      const m = String(b.file || '').match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!m || !/^(image\/(jpeg|png|webp|gif)|application\/pdf|audio\/(mpeg|mp4|x-m4a|wav|webm|ogg))$/.test(m[1])) return NextResponse.json({ ok: false, error: 'Upload an image, PDF or audio file.' }, { status: 400 });
      const buf = Buffer.from(m[2], 'base64');
      // Uploads travel as text (a third larger) and hosting caps a request at ~4.5 MB → ~3 MB files.
      if (buf.length > 3_200_000) return NextResponse.json({ ok: false, error: 'That file is over 3 MB — compress the PDF or audio (images are resized for you), or split it.' }, { status: 400 });
      const ref = db.collection(`${base}/${courseId}/media`).doc();
      const ext = m[1].split('/')[1].replace('mpeg', 'mp3').replace('x-m4a', 'm4a');
      const path = `tenants/${tenantId}/academy/media/${courseId}/${ref.id}.${ext}`;
      const { privateBucket } = await import('@/lib/private-storage');
      await (await privateBucket()).file(path).save(buf, { contentType: m[1], resumable: false, metadata: { cacheControl: 'private, max-age=3600' } });
      const doc = { id: ref.id, name: String(b.name || 'File').slice(0, 160), type: m[1], kind: m[1].startsWith('image/') ? 'image' : m[1] === 'application/pdf' ? 'pdf' : 'audio', path, bytes: buf.length, by: who, at: now };
      await ref.set(doc);
      return NextResponse.json({ ok: true, media: { ...doc, url: await mediaUrl(path, 30) } });
    }
    if (b.action === 'media-url') {
      const m = ((await db.doc(`${base}/${courseId}/media/${String(b.mediaId || '')}`).get()).data() as any) || null;
      return NextResponse.json({ ok: !!m, url: m ? await mediaUrl(m.path, 30) : null });
    }

    // ── Lesson plans (AI draft — the instructor edits and saves) ──
    if (b.action === 'ai-plan') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on (ANTHROPIC_API_KEY).' }, { status: 400 });
      const lx = ((await db.doc(`${base}/${courseId}/lessons/${String(b.lessonId || '')}`).get()).data() as any) || {};
      const src = `${lx.body || ''}\n${lx.transcript ? `Video transcript:\n${lx.transcript}` : ''}\n${(lx.blocks || []).map((x: any) => x.text || (x.steps || []).map((s: any) => s.text).join('\n') || '').join('\n')}`.trim().slice(0, 12000);
      const r = await askClaude({ tier: 'smart', maxTokens: 2200, purpose: 'academy-lesson-plan', tenantId,
        system: 'You write lesson plans for instructors at a state-licensed beauty school. Follow the instruction order: guided_theory → demonstration → guided_practice → independent_theory → practice → evaluation → performance (use only the stages that fit this lesson). Integrate infection control into every hands-on step. Use only facts from the lesson material given; where the material is thin, keep items general and practical rather than inventing specifics. Reply with JSON only.',
        prompt: `Lesson: ${lx.title || ''}\nLength in minutes (if known): ${Number(b.minutes) || ''}\n\nMaterial:\n${src || '(no written material yet — plan from the title)'}\n\nReturn JSON: {"objectives":["…"],"minutes":90,"materials":["…"],"setup":"…","infectionControl":"…","agenda":[{"minutes":15,"type":"guided_theory","activity":"…"}],"notes":"…","differentiation":"…","assessment":"…","subjects":["…"]}` });
      const j: any = r.ok ? parseJson(r.text) : null;
      return j ? NextResponse.json({ ok: true, plan: cleanPlan(j) }) : NextResponse.json({ ok: false, error: 'The draft didn’t come back usable — try again.' }, { status: 502 });
    }

    // ── Question bank ──
    if (b.action === 'qbank-list') {
      const s = await db.collection(`tenants/${tenantId}/questionBank`).where('courseId', '==', courseId).limit(2000).get();
      return NextResponse.json({ ok: true, questions: s.docs.map((d: any) => d.data()).sort((a: any, c: any) => String(a.topic || '').localeCompare(String(c.topic || '')) || String(a.at).localeCompare(String(c.at))) });
    }
    if (b.action === 'qbank-save' || b.action === 'qbank-save-many') {
      const list = b.action === 'qbank-save' ? [b.question] : (b.questions || []);
      const saved = [];
      for (const q of list.slice(0, 100)) {
        const options = (q.options || []).map((o: any) => String(o).slice(0, 240)).filter(Boolean).slice(0, 6);
        const text = String(q.q || '').trim().slice(0, 500);
        if (!text || options.length < 2) continue;
        const ref = q.id ? db.doc(`tenants/${tenantId}/questionBank/${String(q.id)}`) : db.collection(`tenants/${tenantId}/questionBank`).doc();
        await ref.set({ id: ref.id, courseId, lessonId: q.lessonId || null, q: text, options, answer: Math.max(0, Math.min(options.length - 1, Number(q.answer) || 0)), topic: String(q.topic || '').slice(0, 80) || null,
          difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium', explanation: String(q.explanation || '').slice(0, 600) || null, source: q.source || 'instructor', by: who, at: now }, { merge: true });
        saved.push(ref.id);
      }
      return NextResponse.json({ ok: true, saved: saved.length });
    }
    if (b.action === 'qbank-delete') { await db.doc(`tenants/${tenantId}/questionBank/${String(b.id || '')}`).delete(); return NextResponse.json({ ok: true }); }
    if (b.action === 'qbank-ai' || b.action === 'worksheet-ai') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on (ANTHROPIC_API_KEY).' }, { status: 400 });
      const lessons = await loadLessons(tenantId, courseId);
      const pick = b.lessonId ? lessons.filter((x: any) => x.id === b.lessonId) : lessons;
      const material = pick.map((x: any) => `### ${x.title}\n${x.body || ''}\n${x.transcript ? String(x.transcript).slice(0, 6000) : ''}\n${(x.blocks || []).map((k: any) => k.text || (k.steps || []).map((s: any) => s.text).join('\n') || '').join('\n')}`).join('\n').slice(0, 16000);
      if (material.replace(/###.*\n/g, '').trim().length < 150) return NextResponse.json({ ok: false, error: 'Add written lesson content (or captions) first — questions are made only from it.' }, { status: 400 });
      const n = Math.max(3, Math.min(25, Number(b.count) || 10));
      const kind = b.action === 'qbank-ai' ? 'mcq' : String(b.kind || 'cloze');
      const shape: Record<string, string> = {
        mcq: `{"questions":[{"q":"…","options":["…","…","…","…"],"answer":0,"topic":"lesson or topic name","difficulty":"${['easy', 'medium', 'hard'].includes(b.difficulty) ? b.difficulty : 'medium'}","explanation":"why the answer is right"}]} — ${n} multiple-choice questions, 4 options each, one correct, plausible wrong options, no "all/none of the above", written like a state-board exam.`,
        cloze: `{"items":[{"sentence":"The ____ is the hardened keratin plate that covers the nail bed.","answer":"nail plate"}]} — ${n} fill-in-the-blank sentences, exactly one blank (____) each.`,
        short: `{"items":[{"question":"…","answer":"model answer in one or two sentences"}]} — ${n} short-answer questions.`,
        vocab: `{"items":[{"term":"…","definition":"short definition"}]} — ${n} key terms from the material (single words or short phrases, no punctuation in terms).`,
      };
      if (!shape[kind]) return NextResponse.json({ ok: false, error: 'Unknown worksheet type.' }, { status: 400 });
      const r = await askClaude({ tier: 'smart', maxTokens: 3500, purpose: `academy-${kind}`, tenantId,
        system: 'You write assessment material for a state-licensed beauty school. Use ONLY facts stated in the material given — never add facts, products, regulations or medical claims that are not in it. Clear, plain language. Reply with JSON only.',
        prompt: `Material:\n${material}\n\nReturn JSON exactly in this shape: ${shape[kind]}` });
      const j: any = r.ok ? parseJson(r.text) : null;
      if (!j) return NextResponse.json({ ok: false, error: 'The draft didn’t come back usable — try again.' }, { status: 502 });
      return NextResponse.json({ ok: true, ...(kind === 'mcq' ? { questions: (j.questions || []).map((q: any) => ({ ...q, lessonId: b.lessonId || null, source: 'ai' })) } : { items: j.items || [] }) });
    }

    // ── AI drafts for instructors (they review and save — nothing goes to students unapproved) ──
    if (b.action === 'ai-draft') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on for ClarityFlow yet (ANTHROPIC_API_KEY).' }, { status: 400 });
      let src = String(b.text || '').trim();
      if (b.lessonId) { const lx = ((await db.doc(`${base}/${courseId}/lessons/${String(b.lessonId)}`).get()).data() as any) || {}; if (lx.transcript) src = `${src}\n\nVideo transcript:\n${lx.transcript}`.trim(); }
      src = src.slice(0, 14000);
      if (src.length < 120) return NextResponse.json({ ok: false, error: 'Write the lesson text first (a few paragraphs), or add captions to its video — drafts are made from them.' }, { status: 400 });
      const kind = String(b.kind || 'quiz');
      const shape: Record<string, string> = {
        quiz: '{"questions":[{"q":"question","options":["a","b","c","d"],"answer":0}]} — 5 multiple-choice questions, one correct option each (answer = index), plausible wrong options, no "all of the above".',
        flashcards: '{"flashcards":[{"front":"term or question","back":"short answer"}]} — 8 to 12 cards covering the key facts.',
        match: '{"activity":{"type":"match","prompt":"Match each … to …","pairs":[{"left":"…","right":"…"}]}} — 5 to 7 pairs.',
        order: '{"activity":{"type":"order","prompt":"Put these steps in order","steps":["first","second","…"]}} — 4 to 8 steps in the CORRECT order.',
        scenario: '{"activity":{"type":"scenario","prompt":"A client … What do you do?","options":[{"text":"…","correct":true,"feedback":"why"},{"text":"…","correct":false,"feedback":"why not"}]}} — a realistic client situation, 3 or 4 options, exactly one correct, feedback for each.',
      };
      if (!shape[kind]) return NextResponse.json({ ok: false, error: 'Unknown draft type.' }, { status: 400 });
      const r = await askClaude({ tier: 'smart', maxTokens: 1800, purpose: `academy-draft-${kind}`, tenantId,
        system: 'You write study material for a licensed beauty / wellness school. Use ONLY facts stated in the lesson text you are given — never add facts, products, regulations or medical claims that are not in it. Plain, friendly language for adult learners. Reply with JSON only, no commentary.',
        prompt: `Lesson title: ${String(b.title || '').slice(0, 200)}\n\nLesson text:\n${src}\n\nReturn JSON exactly in this shape: ${shape[kind]}` });
      const j: any = r.ok ? parseJson(r.text) : null;
      if (!j) return NextResponse.json({ ok: false, error: 'The draft didn’t come back usable — try again.' }, { status: 502 });
      return NextResponse.json({ ok: true, draft: j });
    }
    if (b.action === 'tutor-log') {
      const s = await db.collection(`tenants/${tenantId}/tutorLogs`).where('courseId', '==', courseId).limit(300).get();
      return NextResponse.json({ ok: true, log: s.docs.map((d: any) => d.data()).sort((a: any, c: any) => String(c.at).localeCompare(String(a.at))).slice(0, 100) });
    }

    // ── Attendance: live list, approvals, corrections (never overwritten) ──
    if (b.action === 'attendance') {
      const col = db.collection(`tenants/${tenantId}/attendance`);
      const since = new Date(Date.now() - Math.max(1, Math.min(90, Number(b.days) || 14)) * 86400000).toISOString();
      const [recent, open, flagged, pending] = await Promise.all([col.where('clockInAt', '>=', since).limit(2000).get(), col.where('status', '==', 'open').limit(500).get(), col.where('status', '==', 'flagged').limit(500).get(), col.where('status', '==', 'pending').limit(500).get()]);
      const map = new Map<string, any>();
      for (const s of [recent, open, flagged, pending]) for (const d of s.docs) map.set(d.id, { id: d.id, ...(d.data() as any) });
      const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const punches = [...map.values()].sort((a, c) => String(c.clockInAt).localeCompare(String(a.clockInAt)));
      const refs: Record<string, string | null> = {};
      for (const sid of Array.from(new Set(punches.map((p: any) => p.studentId))).slice(0, 300) as string[]) refs[sid] = ((((await db.doc(`tenants/${tenantId}/students/${sid}`).get()).data() as any) || {}).referencePhoto?.ref) || null;
      return NextResponse.json({ ok: true, punches, referencePhotos: refs, settings: t.academy || {} });
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
    if (b.action === 'attendance-photo-check') {
      const ref = db.doc(`tenants/${tenantId}/attendance/${String(b.id || '')}`);
      const p = ((await ref.get()).data() as any) || null;
      if (!p) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const match = !!b.match;
      const note = String(b.note || '').trim().slice(0, 300);
      if (!match && !note) return NextResponse.json({ ok: false, error: 'Say what doesn’t match — it’s kept on the record.' }, { status: 400 });
      await ref.set({ photoCheck: { match, note: note || null, by: who, at: now }, ...(match ? {} : { status: 'flagged', flagReason: 'Photo doesn’t match', flaggedAt: now }) }, { merge: true });
      await appendAudit(tenantId, { type: match ? 'attendance.photo_ok' : 'attendance.photo_mismatch', studentId: p.studentId, by: who, summary: match ? `Photo checked — matches ${p.email}` : `Photo does NOT match ${p.email} — flagged, no hours until resolved. ${note}`, data: { attendanceId: ref.id } });
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
        ...('requireGeo' in b ? { requireGeo: !!b.requireGeo } : {}), ...('requireApproval' in b ? { requireApproval: !!b.requireApproval } : {}), ...('requirePhoto' in b ? { requirePhoto: !!b.requirePhoto } : {}),
        ...(b.geo && Number.isFinite(Number(b.geo.lat)) ? { geo: { lat: Number(b.geo.lat), lng: Number(b.geo.lng), radiusM: Math.max(30, Math.min(2000, Number(b.geo.radiusM) || 150)) } } : {}) };
      await db.doc(`tenants/${tenantId}`).set({ academy: next }, { merge: true });
      await appendAudit(tenantId, { type: 'settings.changed', by: who, summary: `Attendance settings: location ${next.requireGeo ? 'required' : 'optional'}${next.geo ? ` (${next.geo.radiusM} m)` : ''}, photo ${next.requirePhoto ? 'required' : 'optional'}, approval ${next.requireApproval ? 'required' : 'automatic'}`, data: next });
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
