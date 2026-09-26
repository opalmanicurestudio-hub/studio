// src/app/api/academy/admin/route.ts
//
// THE COURSE BUILDER — owners and managers of the business.
//   list · course-get · course-save · course-delete
//   lesson-save · lesson-delete · lesson-move
//   upload-create  (a Mux upload URL for a lesson's video)
//   video-status   (is Mux done processing? saves the playback id)
//   students       (who's enrolled, and how far they've got)

import { progressFor, nudge } from '@/lib/academy-assign';
import { modKey, notifyModuleOpen } from '@/lib/academy-modules';
import { KIT_GUIDE, KIT_EXAMPLE, extractHtml, scriptError } from '@/lib/interactive-kit';
import { AI_WEIGHTS, takeCredits, refundCredits, creditStatus } from '@/lib/ai-credits';
import { deviceAllowed } from '@/lib/approved-devices';
import { letter } from '@/lib/grades';
import { mediaUrl } from '@/lib/academy';
import { askClaude, aiConfigured, parseJson } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { slugify, RESERVED_SLUGS, loadLessons, muxConfigured, muxSigningReady, muxCreateUpload, muxUploadStatus, muxAddCaptions, muxTranscript, CAPTION_LANGUAGES } from '@/lib/academy';
import { appendAudit, verifyAudit, transcript, qrWindow, qrCode, QR_WINDOW_SEC } from '@/lib/academy-compliance';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
// AI builds (interactives on Claude Opus at high effort) can take a couple of minutes.
export const maxDuration = 300;
const KINDS = ['video', 'text', 'download', 'assignment'];
const str = (v: any, n: number) => String(v ?? '').slice(0, n);
const BLOCK_TYPES = ['text', 'image', 'steps', 'callout', 'file', 'divider', 'interactive', 'hotspots', 'stages', 'game'];
/** Template games (drawn by ClarityFlow): Sort it · Speed round · Memory match · Sequence. */
function cleanGame(t: string, d: any) {
  const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
  if (t === 'sort') { const bins = (d?.bins || []).map((x: any) => s(x, 40)).filter(Boolean).slice(0, 4); const items = (d?.items || []).map((x: any) => ({ text: s(x.text, 80), bin: Math.max(0, Math.min(bins.length - 1, Number(x.bin) || 0)) })).filter((x: any) => x.text).slice(0, 16); return bins.length >= 2 && items.length >= 3 ? { bins, items } : null; }
  if (t === 'speed') { const items = (d?.items || []).map((x: any) => ({ text: s(x.text, 160), true: !!x.true, why: s(x.why, 200) })).filter((x: any) => x.text).slice(0, 20); return items.length >= 3 ? { items, seconds: Math.max(3, Math.min(20, Number(d?.seconds) || 8)) } : null; }
  if (t === 'memory') { const pairs = (d?.pairs || []).map((x: any) => ({ a: s(x.a, 60), b: s(x.b, 80) })).filter((x: any) => x.a && x.b).slice(0, 8); return pairs.length >= 3 ? { pairs } : null; }
  if (t === 'sequence') { const steps = (d?.steps || []).map((x: any) => s(x, 120)).filter(Boolean).slice(0, 10); return steps.length >= 3 ? { steps } : null; }
  return null;
}
/** AI-built interactives run in a sealed frame for students; keep them self-contained and a sensible size. */
function cleanHtml(v: any) { const h = String(v || ''); return h.length > 150_000 ? '' : h; }
/** Content blocks: text · image · step-by-step (a photo per step) · callout (safety / key point / tip) · file · divider. */
function cleanBlocks(v: any) {
  return (Array.isArray(v) ? v : []).slice(0, 80).map((b: any) => {
    if (!BLOCK_TYPES.includes(b?.type)) return null;
    const id = String(b.id || Math.random().toString(36).slice(2, 10)).slice(0, 20);
    if (b.type === 'text') return { id, type: 'text', text: str(b.text, 8000) };
    if (b.type === 'image') return b.mediaId ? { id, type: 'image', mediaId: str(b.mediaId, 40), caption: str(b.caption, 300) } : null;
    if (b.type === 'file') return b.mediaId ? { id, type: 'file', mediaId: str(b.mediaId, 40), label: str(b.label, 160) } : null;
    if (b.type === 'callout') return { id, type: 'callout', tone: ['safety', 'key', 'tip'].includes(b.tone) ? b.tone : 'key', text: str(b.text, 1500) };
    if (b.type === 'interactive') { const html = cleanHtml(b.html); return html ? { id, type: 'interactive', game: !!b.game, title: str(b.title, 120), request: str(b.request, 1000), html, height: Math.max(200, Math.min(1400, Number(b.height) || 480)) } : null; }
    if (b.type === 'hotspots') return b.mediaId ? { id, type: 'hotspots', mediaId: str(b.mediaId, 40), title: str(b.title, 160), points: (b.points || []).slice(0, 20).map((p: any) => ({ x: Math.max(0, Math.min(100, Number(p.x) || 0)), y: Math.max(0, Math.min(100, Number(p.y) || 0)), label: str(p.label, 80), text: str(p.text, 600) })).filter((p: any) => p.label) } : null;
    if (b.type === 'game') { const tpl = ['sort', 'speed', 'memory', 'sequence'].includes(b.template) ? b.template : 'sort'; const data = cleanGame(tpl, b.data); return data ? { id, type: 'game', template: tpl, title: str(b.title, 120), data } : null; }
    if (b.type === 'stages') return { id, type: 'stages', title: str(b.title, 160), stages: (b.stages || []).slice(0, 12).map((x: any) => ({ label: str(x.label, 80), text: str(x.text, 800), mediaId: x.mediaId ? str(x.mediaId, 40) : null })).filter((x: any) => x.label || x.text) };
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
/** Refer-or-treat cases: a client story (optional photo), choices with feedback. */
function cleanCases(c: any) {
  if (!c || !Array.isArray(c.cases)) return null;
  const cases = c.cases.slice(0, 15).map((x: any) => ({ story: str(x.story, 1200), mediaId: x.mediaId ? str(x.mediaId, 40) : null,
    options: (x.options || []).slice(0, 4).map((o: any) => ({ text: str(o.text, 200), correct: !!o.correct, feedback: str(o.feedback, 600) })).filter((o: any) => o.text) }))
    .filter((x: any) => x.story && x.options.length >= 2 && x.options.some((o: any) => o.correct));
  return cases.length ? { prompt: str(c.prompt, 200) || 'What would you do?', cases } : null;
}

/** Interactive activities: match pairs, put steps in order, or a client scenario. */
function cleanActivity(a: any) {
  if (!a || !['match', 'order', 'scenario', 'label', 'wordsearch', 'crossword', 'cloze'].includes(a.type)) return null;
  // Online puzzles published from worksheets (built the same way as the printed ones, from the seed).
  if (a.type === 'wordsearch') { const words = (a.words || []).map((w: any) => str(w, 30)).filter(Boolean).slice(0, 15); return words.length >= 4 ? { type: 'wordsearch', prompt: str(a.prompt, 200) || 'Find the words', words, seed: Number(a.seed) || 1 } : null; }
  if (a.type === 'crossword') { const entries = (a.entries || []).map((e: any) => ({ answer: str(e.answer, 20), clue: str(e.clue, 200) })).filter((e: any) => e.answer && e.clue).slice(0, 16); return entries.length >= 4 ? { type: 'crossword', prompt: str(a.prompt, 200) || 'Crossword', entries, seed: Number(a.seed) || 1 } : null; }
  if (a.type === 'cloze') { const items = (a.items || []).map((x: any) => ({ sentence: str(x.sentence, 400), answer: str(x.answer, 60) })).filter((x: any) => x.sentence.includes('____') && x.answer).slice(0, 20); return items.length >= 2 ? { type: 'cloze', prompt: str(a.prompt, 200) || 'Fill in the blanks', items } : null; }
  if (a.type === 'label') { const points = (a.points || []).map((p: any) => ({ x: Math.max(0, Math.min(100, Number(p.x) || 0)), y: Math.max(0, Math.min(100, Number(p.y) || 0)), label: str(p.label, 80) })).filter((p: any) => p.label).slice(0, 15);
    return /^https:\/\//.test(String(a.imageUrl || '')) && points.length >= 2 ? { type: 'label', prompt: str(a.prompt, 200) || 'Label the diagram', imageUrl: str(a.imageUrl, 600), points } : null; }
  if (a.type === 'match') { const pairs = (a.pairs || []).map((p: any) => ({ left: str(p.left, 160), right: str(p.right, 160) })).filter((p: any) => p.left && p.right).slice(0, 10); return pairs.length >= 2 ? { type: 'match', prompt: str(a.prompt, 200) || 'Match the pairs', pairs } : null; }
  if (a.type === 'order') { const steps = (a.steps || []).map((x: any) => str(x, 200)).filter(Boolean).slice(0, 12); return steps.length >= 2 ? { type: 'order', prompt: str(a.prompt, 200) || 'Put these in order', steps } : null; }
  const options = (a.options || []).map((o: any) => ({ text: str(o.text, 300), correct: !!o.correct, feedback: str(o.feedback, 500) })).filter((o: any) => o.text).slice(0, 6);
  return options.length >= 2 && options.some((o: any) => o.correct) ? { type: 'scenario', prompt: str(a.prompt, 800), options } : null;
}

/**
 * AI actions use the business's monthly AI credits (lib/ai-credits): signed-in
 * staff only, taken atomically before the call, refunded if it fails.
 */
export async function POST(req: NextRequest) {
  const peek = await req.clone().json().catch(() => ({}));
  const weight = AI_WEIGHTS[String(peek?.action || '')];
  if (!weight || !aiConfigured()) return handle(req);
  const tenantId = String(peek.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return handle(req);
  const take = await takeCredits(tenantId, String(peek.action), weight);
  if (!take.ok) return NextResponse.json({ ok: false, error: take.error, outOfCredits: true }, { status: 402 });
  const res = await handle(req);
  if (res.status >= 400) await refundCredits(tenantId, String(peek.action), weight).catch(() => {});
  return res;
}

async function handle(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  // Owners, managers and instructors. Only owners/managers change courses and settings.
  const isInstructor = String(auth.actor.role || '').toLowerCase() === 'instructor';
  if (!auth.actor.isManager && !auth.actor.isTenantOwner && !isInstructor) return NextResponse.json({ ok: false, error: 'Only owners, managers and instructors can use the academy tools.' }, { status: 403 });
  const INSTRUCTOR_OK = ['assign-options', 'assign-list', 'assign-save', 'assign-delete', 'assign-progress', 'assign-nudge', 'group-save', 'group-delete', 'interactive-list', 'ai-credits', 'materials-list', 'material-save', 'submissions', 'submission-ai', 'submission-grade', 'gradebook', 'media-list', 'media-url', 'qbank-list', 'worksheet-ai', 'tutor-log', 'list', 'course-get', 'students', 'attendance', 'attendance-approve', 'attendance-resolve', 'attendance-code', 'attendance-photo-check', 'transcript', 'audit-verify'];
  if (isInstructor && !auth.actor.isManager && !INSTRUCTOR_OK.includes(String(b.action))) return NextResponse.json({ ok: false, error: 'Instructors can review attendance and students, not change courses.' }, { status: 403 });
  const who = auth.actor.name || auth.actor.uid;
  if (['attendance', 'attendance-approve', 'attendance-resolve', 'attendance-photo-check', 'transcript', 'students', 'submissions', 'gradebook'].includes(String(b.action))) {
    const dv = await deviceAllowed(tenantId, req); if (!dv.ok) return NextResponse.json({ ok: false, error: dv.error, deviceBlocked: true }, { status: 403 });
  }
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
        ...('stepMode' in l ? { stepMode: l.stepMode === true } : {}),
        // Refer-or-treat client cases, and questions that pop up during the video.
        ...('cases' in l ? { cases: cleanCases(l.cases) } : {}),
        ...('videoQuestions' in l ? { videoQuestions: (Array.isArray(l.videoQuestions) ? l.videoQuestions : []).slice(0, 20).map((q: any) => ({ at: Math.max(1, Math.round(Number(q.at) || 0)), q: str(q.q, 300), options: (q.options || []).map((o: any) => str(o, 160)).filter(Boolean).slice(0, 4), answer: Math.max(0, Number(q.answer) || 0), explain: str(q.explain, 400) })).filter((q: any) => q.q && q.options.length >= 2).sort((a: any, b: any) => a.at - b.at) } : {}),
        ...('assignment' in l ? { assignment: l.assignment ? { prompt: str(l.assignment.prompt, 4000), type: ['written', 'photo', 'file', 'any'].includes(l.assignment.type) ? l.assignment.type : 'any',
          rubric: (l.assignment.rubric || []).slice(0, 12).map((r: any) => ({ criterion: str(r.criterion, 200), points: Math.max(1, Math.min(100, Number(r.points) || 1)) })).filter((r: any) => r.criterion),
          dueDays: Math.max(0, Math.min(365, Number(l.assignment.dueDays) || 0)) || null, resubmit: l.assignment.resubmit !== false } : null } : {}),
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

    // The course board: save the whole order (and which module each lesson is in) in one go.
    if (b.action === 'lessons-arrange') {
      const all = await loadLessons(tenantId, courseId); const known = new Set(all.map((x: any) => x.id));
      const items = (Array.isArray(b.items) ? b.items : []).filter((x: any) => known.has(String(x.id))).slice(0, 500);
      if (items.length !== all.length) return NextResponse.json({ ok: false, error: 'The lesson list changed — refresh and try again.' }, { status: 409 });
      const batch = db.batch();
      items.forEach((x: any, k: number) => batch.set(db.doc(`${base}/${courseId}/lessons/${String(x.id)}`), { order: k, moduleTitle: str(x.moduleTitle, 120) || 'Module 1', updatedAt: now }, { merge: true }));
      await batch.commit();
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

    // ── AI credits (the meter in Settings) ──
    if (b.action === 'ai-credits') return NextResponse.json({ ok: true, ...(await creditStatus(tenantId)), weights: AI_WEIGHTS });

    // ── ✨ Draft an assignment from the lesson material ──
    if (b.action === 'ai-assignment') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on (ANTHROPIC_API_KEY).' }, { status: 400 });
      const lessons = await loadLessons(tenantId, courseId);
      const lx = lessons.find((x: any) => x.id === b.lessonId) || null;
      const material = (lx ? [lx] : lessons).map((x: any) => `### ${x.title}\n${x.body || ''}\n${x.transcript ? String(x.transcript).slice(0, 5000) : ''}\n${(x.blocks || []).map((k: any) => k.text || (k.steps || []).map((st: any) => st.text).join('\n') || '').join('\n')}`).join('\n').slice(0, 14000);
      const kind = ['written', 'photo', 'file', 'any'].includes(b.type) ? b.type : 'any';
      const r = await askClaude({ tier: 'smart', maxTokens: 1500, purpose: 'academy-assignment', tenantId,
        system: 'You write assignments for a state-licensed beauty school. Base the task only on the material given — no new regulations, products or medical claims. Hands-on tasks include the infection-control steps. Write the task clearly for the student, say exactly what to hand in, and give a rubric whose points add up to 100. Reply with JSON only.',
        prompt: `Material:\n${material || '(no written material — base it on the lesson title)'}\n\nLesson: ${lx?.title || 'whole course'}\nWhat students hand in: ${kind === 'photo' ? 'photos of their work' : kind === 'written' ? 'a written answer' : kind === 'file' ? 'a file' : 'writing and/or photos'}\nFocus (optional): ${String(b.focus || '').slice(0, 300)}\n\nReturn JSON: {"prompt":"…","rubric":[{"criterion":"…","points":40}],"dueDays":7}` });
      const j: any = r.ok ? parseJson(r.text) : null;
      if (!j?.prompt) return NextResponse.json({ ok: false, error: 'The draft didn’t come back usable — try again.' }, { status: 502 });
      return NextResponse.json({ ok: true, assignment: { prompt: String(j.prompt).slice(0, 4000), type: kind, rubric: (j.rubric || []).slice(0, 10).map((x: any) => ({ criterion: String(x.criterion || '').slice(0, 200), points: Math.max(1, Math.min(100, Math.round(Number(x.points) || 10))) })).filter((x: any) => x.criterion), dueDays: Math.max(0, Math.min(60, Number(j.dueDays) || 7)), resubmit: true } });
    }

    // ── Assign work: what, who, when, automatic review ──
    if (b.action === 'assign-options') {
      const T = `tenants/${tenantId}`;
      const [courses, progs, cohorts, groups] = await Promise.all([db.collection(base).limit(200).get(), db.collection(`${T}/programs`).limit(100).get(), db.collection(`${T}/cohorts`).limit(200).get(), db.collection(`${T}/studentGroups`).limit(200).get()]);
      let lessons: any[] = [], students: any[] = [];
      if (courseId) {
        lessons = (await loadLessons(tenantId, courseId)).map((l: any) => ({ id: l.id, title: l.title, moduleTitle: l.moduleTitle, kind: l.kind, hasQuiz: !!l.quiz?.questions?.length }));
        const enr = await db.collection(`${T}/enrollments`).where('courseId', '==', courseId).limit(2000).get();
        const names = new Map((await db.collection(`${T}/students`).limit(3000).get()).docs.map((d: any) => [d.id, (d.data() as any).name]));
        students = enr.docs.map((d: any) => { const e = d.data() as any; return { id: e.studentId, name: names.get(e.studentId) || e.email, email: e.email }; }).filter((x: any) => x.id).sort((x: any, y: any) => String(x.name).localeCompare(String(y.name)));
      }
      return NextResponse.json({ ok: true, courses: courses.docs.map((d: any) => ({ id: d.id, title: (d.data() as any).title })), lessons, students,
        programs: progs.docs.map((d: any) => ({ id: d.id, name: (d.data() as any).name })), cohorts: cohorts.docs.map((d: any) => ({ id: d.id, name: (d.data() as any).name })), groups: groups.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })) });
    }
    if (b.action === 'assign-list') {
      const q = await db.collection(`tenants/${tenantId}/assigned`).orderBy('createdAt', 'desc').limit(200).get();
      const titles = new Map((await db.collection(base).limit(200).get()).docs.map((d: any) => [d.id, (d.data() as any).title]));
      return NextResponse.json({ ok: true, items: q.docs.map((d: any) => ({ id: d.id, ...(d.data() as any), courseTitle: titles.get((d.data() as any).courseId) || '' })) });
    }
    if (b.action === 'assign-save') {
      const a = b.assignment || {};
      const lessons = await loadLessons(tenantId, String(a.courseId || ''));
      const ids = (a.lessonIds || []).map(String).filter((id: string) => lessons.some((l: any) => l.id === id)).slice(0, 30);
      if (!ids.length) return NextResponse.json({ ok: false, error: 'Choose at least one lesson.' }, { status: 400 });
      const type = ['course', 'program', 'cohort', 'group', 'students'].includes(a.audience?.type) ? a.audience.type : 'course';
      const aud = { type, ids: type === 'course' ? [] : (a.audience?.ids || []).map(String).slice(0, 500) };
      if (type !== 'course' && !aud.ids.length) return NextResponse.json({ ok: false, error: 'Choose who it’s for.' }, { status: 400 });
      const cond = a.condition?.lessonId && lessons.some((l: any) => l.id === a.condition.lessonId) ? { lessonId: String(a.condition.lessonId), below: Math.max(1, Math.min(100, Number(a.condition.below) || 70)) } : null;
      const ref = a.id ? db.doc(`tenants/${tenantId}/assigned/${String(a.id)}`) : db.collection(`tenants/${tenantId}/assigned`).doc();
      const due = a.dueAt ? new Date(a.dueAt).toISOString() : null;
      const prev = a.id ? (((await ref.get()).data() as any) || {}) : {};
      await ref.set({ id: ref.id, title: str(a.title, 140) || lessons.filter((l: any) => ids.includes(l.id)).map((l: any) => l.title).slice(0, 2).join(' + '), courseId: String(a.courseId), lessonIds: ids, audience: aud, dueAt: due, note: str(a.note, 600) || null, condition: cond,
        createdAt: prev.createdAt || now, createdBy: prev.createdBy || who, updatedAt: now, remindedAt: prev.dueAt === due ? prev.remindedAt || null : null });
      await appendAudit(tenantId, { type: 'work.assigned', courseId: String(a.courseId), by: who, summary: `Assigned “${str(a.title, 140) || 'work'}” to ${type === 'course' ? 'everyone in the course' : `${aud.ids.length} ${type === 'students' ? 'student' : type}${aud.ids.length === 1 ? '' : 's'}`}${cond ? ` (review for scores under ${cond.below}%)` : ''}`, data: { id: ref.id } });
      return NextResponse.json({ ok: true, id: ref.id });
    }
    if (b.action === 'assign-delete') { await db.doc(`tenants/${tenantId}/assigned/${String(b.id || '')}`).delete(); return NextResponse.json({ ok: true }); }
    if (b.action === 'assign-progress' || b.action === 'assign-nudge') {
      const d = await db.doc(`tenants/${tenantId}/assigned/${String(b.id || '')}`).get(); if (!d.exists) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const a = { id: d.id, ...(d.data() as any) };
      if (b.action === 'assign-nudge') return NextResponse.json({ ok: true, sent: await nudge(tenantId, a, Array.isArray(b.studentIds) ? b.studentIds.map(String) : undefined) });
      return NextResponse.json({ ok: true, rows: await progressFor(tenantId, a) });
    }
    if (b.action === 'group-save') {
      const ref = b.id ? db.doc(`tenants/${tenantId}/studentGroups/${String(b.id)}`) : db.collection(`tenants/${tenantId}/studentGroups`).doc();
      const name = str(b.name, 80); if (!name) return NextResponse.json({ ok: false, error: 'Name the group.' }, { status: 400 });
      await ref.set({ name, studentIds: (b.studentIds || []).map(String).slice(0, 500), updatedAt: now, by: who }, { merge: true });
      return NextResponse.json({ ok: true, id: ref.id });
    }
    if (b.action === 'group-delete') { await db.doc(`tenants/${tenantId}/studentGroups/${String(b.id || '')}`).delete(); return NextResponse.json({ ok: true }); }

    // ── Module settings: when each module opens, its intro and badge ──
    if (b.action === 'module-settings' || b.action === 'module-release-now') {
      const key = modKey(String(b.title || b.key || ''));
      const title = String(b.title || '').slice(0, 120);
      const ref = db.doc(`${base}/${courseId}`);
      if (b.action === 'module-release-now') {
        await ref.set({ modules: { [key]: { title, release: 'manual', releasedAt: now, releasedBy: who } } }, { merge: true });
        await appendAudit(tenantId, { type: 'module.released', courseId, by: who, summary: `Released module “${title}”`, data: { key } });
        const sent = await notifyModuleOpen(tenantId, courseId, title).catch(() => 0);
        return NextResponse.json({ ok: true, sent });
      }
      const m = b.settings || {};
      const release = ['open', 'previous', 'date', 'manual'].includes(m.release) ? m.release : 'open';
      await ref.set({ modules: { [key]: { title, release, date: release === 'date' && m.date ? new Date(m.date).toISOString() : null, intro: str(m.intro, 600) || null,
        badge: m.badge?.name ? { name: str(m.badge.name, 40), emoji: str(m.badge.emoji, 4) || '🏅' } : null, ...(release === 'date' ? { notifiedAt: null } : {}) } }, updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // ── ✨ Make an interactive: AI builds animated, self-contained HTML (sealed frame for students) ──
    if (b.action === 'ai-interactive') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on (ANTHROPIC_API_KEY).' }, { status: 400 });
      const request = String(b.request || '').trim().slice(0, 1000);
      if (!request) return NextResponse.json({ ok: false, error: 'Describe what the interactive should show.' }, { status: 400 });
      const course = ((await db.doc(`${base}/${courseId}`).get()).data() as any) || {};
      let material = '';
      if (b.useLesson && b.lessonId) { const lx = ((await db.doc(`${base}/${courseId}/lessons/${String(b.lessonId)}`).get()).data() as any) || {}; material = `${lx.title || ''}\n${lx.body || ''}\n${lx.transcript ? String(lx.transcript).slice(0, 4000) : ''}`.slice(0, 8000); }
      const current = typeof b.currentHtml === 'string' && b.currentHtml.length < 150_000 ? b.currentHtml : '';
      const gameRules = b.game ? `
THIS ONE IS A GAME. Make it genuinely fun for students: a clear goal, a short "How to play" line, points or a timer, satisfying feedback (small bounce/flash on right answers), and a Play again button.
When a round finishes, call window.cfScore(scorePercent) exactly once with a whole number 0–100 — that sends the score to the school's gradebook. Keep the content accurate and from the instructor's material.` : '';
      const system = `You build interactive, animated teaching visuals for students at a state-licensed beauty / nail school, as ONE self-contained HTML fragment: markup, then one inline <script>. It runs inside a sealed frame that already contains the ClarityFlow style kit described below.

${KIT_GUIDE}

Rules:
- Teach one idea clearly through cause and effect: controls the student changes (sliders, toggles, Play/Reset), a drawing that responds with smooth motion (CSS transitions, requestAnimationFrame), and a one-sentence explanation in .cf-note that updates with every change.
- Mobile first: it must work at 320px wide. SVG uses a viewBox and width="100%". Big touch targets.
- Accurate and honest: use only well-established facts; follow the instructor's material when given and never contradict it. It's a simplified teaching model — no invented brand names, figures or regulations. Draw anatomy only as simple schematic shapes.
- Self-contained: no external scripts, fonts, images or URLs; no fetch/XMLHttpRequest/WebSocket; no alert/confirm/prompt; no forms; no top-level await; no import/export. Wrap the script in (function(){ … })().
- It must work the moment it loads: call your draw/update function once at the end of the script. Check every getElementById target exists in your markup.
- Keep it focused: about 60–200 lines total.

Here is an example of the expected quality and use of the kit:
\`\`\`html
${KIT_EXAMPLE}
\`\`\`

Reply with the complete HTML only, inside one \`\`\`html code block.${gameRules}`;
      const context = `Course: ${course.title || '—'}${course.subtitle ? ` — ${course.subtitle}` : ''}${material ? `\n\nInstructor's lesson material (follow it):\n${material}` : ''}`;
      const prompt = current
        ? `Here is the current interactive:\n\`\`\`html\n${current}\n\`\`\`\n\nChange requested: ${String(b.change || '').slice(0, 800)}\nReturn the complete updated HTML.\n\n${context}`
        : `Build an interactive that shows: ${request}\n\n${context}`;
      // Built on Claude Opus with room to think and write; falls back to Sonnet if the account can't use Opus.
      const ask = (tier: 'interactive' | 'smart', p: string) => askClaude({ tier, maxTokens: 32000, effort: 'high', purpose: 'academy-interactive', tenantId, system, prompt: p });
      let r = await ask('interactive', prompt); let usedFallback = false;
      if (!r.ok && /model/i.test(String(r.error || ''))) { r = await ask('smart', prompt); usedFallback = true; }
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'The AI didn’t respond — try again.' }, { status: 502 });
      let got = extractHtml(r.text, r.stopReason);
      if (!got.html) return NextResponse.json({ ok: false, error: got.error }, { status: 502 });
      let html = got.html;
      if (/<script[^>]+src=|<link\b|@import|(?:src|href)\s*=\s*["']?https?:|\bfetch\s*\(|XMLHttpRequest|WebSocket/i.test(html)) return NextResponse.json({ ok: false, error: 'The draft tried to load something from the internet, which isn’t allowed — try again.' }, { status: 502 });
      // Catch script errors before anyone sees them; one automatic fix attempt.
      let problem = scriptError(html);
      if (problem) {
        const fix = await ask(usedFallback ? 'smart' : 'interactive', `This interactive has a JavaScript error: ${problem}\nFix it and return the complete corrected HTML.\n\`\`\`html\n${html}\n\`\`\``);
        const g2 = fix.ok ? extractHtml(fix.text, fix.stopReason) : { html: null };
        if (g2.html && !scriptError(g2.html)) { html = g2.html; problem = null; }
      }
      return NextResponse.json({ ok: true, html, model: usedFallback ? 'sonnet' : 'opus', ...(problem ? { problem } : {}), ...(usedFallback ? { note: 'Built with Claude Sonnet — your Anthropic account couldn’t use Claude Opus just now.' } : {}) });
    }
    if (b.action === 'interactive-save') {
      const html = cleanHtml(b.html); if (!html) return NextResponse.json({ ok: false, error: 'Nothing to save.' }, { status: 400 });
      const ref = db.collection(`tenants/${tenantId}/interactives`).doc();
      await ref.set({ id: ref.id, title: str(b.title, 120) || 'Interactive', request: str(b.request, 1000), html, by: who, at: now });
      return NextResponse.json({ ok: true, id: ref.id });
    }
    if (b.action === 'interactive-list') {
      const q = await db.collection(`tenants/${tenantId}/interactives`).orderBy('at', 'desc').limit(100).get();
      return NextResponse.json({ ok: true, items: q.docs.map((d: any) => d.data()) });
    }
    // ✨ Hotspot explanations, client cases, video questions — drafts from the lesson material.
    if (b.action === 'ai-hotspots' || b.action === 'ai-cases' || b.action === 'ai-video-questions') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on (ANTHROPIC_API_KEY).' }, { status: 400 });
      const lx = ((await db.doc(`${base}/${courseId}/lessons/${String(b.lessonId || '')}`).get()).data() as any) || {};
      const material = `${lx.title || ''}\n${lx.body || ''}\n${lx.transcript ? String(lx.transcript).slice(0, 9000) : ''}\n${(lx.blocks || []).map((k: any) => k.text || '').join('\n')}`.slice(0, 14000);
      if (b.action !== 'ai-hotspots' && material.trim().length < 150) return NextResponse.json({ ok: false, error: 'Add lesson text or captions first — drafts use only what’s in the lesson.' }, { status: 400 });
      const n = Math.max(2, Math.min(10, Number(b.count) || 5));
      const spec: Record<string, string> = {
        'ai-hotspots': `For each labelled part, write a short (1–2 sentence) plain-language explanation for students, using the lesson material where it covers it and only well-established facts otherwise. Parts: ${JSON.stringify((b.labels || []).slice(0, 20))}. Return JSON {"texts":["…"]} in the same order.`,
        'ai-cases': `Write ${n} realistic client cases for "refer or treat" practice, based only on the lesson material: a short client story (what the client says, what the technician sees) and 3 choices — proceed as planned, adapt the service, or refer the client to a doctor — with exactly one correct choice and one sentence of feedback for every choice. Never diagnose; referral cases say to refer. Return JSON {"cases":[{"story":"…","options":[{"text":"…","correct":true,"feedback":"…"}]}]}.`,
        'ai-video-questions': `Write ${n} multiple-choice questions to pop up during this lesson video, in the order the topics come up in the transcript. For each, estimate where the topic is discussed as a fraction of the video (0.05–0.95). Return JSON {"questions":[{"pos":0.2,"q":"…","options":["…","…","…"],"answer":0,"explain":"one sentence"}]}.`,
      };
      const r = await askClaude({ tier: 'smart', maxTokens: 3500, purpose: `academy-${b.action}`, tenantId,
        system: 'You write teaching material for a state-licensed beauty / nail school. Use only the lesson material and well-established general facts; never invent products, numbers, regulations or medical claims. Reply with JSON only.',
        prompt: `Lesson material:\n${material || '(none)'}\n\n${spec[b.action]}` });
      const j: any = r.ok ? parseJson(r.text) : null;
      if (!j) return NextResponse.json({ ok: false, error: 'The draft didn’t come back usable — try again.' }, { status: 502 });
      if (b.action === 'ai-hotspots') return NextResponse.json({ ok: true, texts: (j.texts || []).map((x: any) => String(x).slice(0, 600)) });
      if (b.action === 'ai-cases') { const c = cleanCases({ prompt: 'What would you do?', cases: j.cases }); return c ? NextResponse.json({ ok: true, cases: c }) : NextResponse.json({ ok: false, error: 'The draft didn’t come back usable — try again.' }, { status: 502 }); }
      const dur = Number(lx.durationSec) || 0;
      return NextResponse.json({ ok: true, questions: (j.questions || []).slice(0, 10).map((q: any) => ({ at: dur ? Math.round(Math.max(0.03, Math.min(0.97, Number(q.pos) || 0.5)) * dur) : 60, q: String(q.q || '').slice(0, 300), options: (q.options || []).map((o: any) => String(o).slice(0, 160)).slice(0, 4), answer: Math.max(0, Number(q.answer) || 0), explain: String(q.explain || '').slice(0, 400) })).filter((q: any) => q.q && q.options.length >= 2), durationKnown: !!dur });
    }

    // ── ✨ Fill a game template from the lesson ──
    if (b.action === 'ai-game') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on (ANTHROPIC_API_KEY).' }, { status: 400 });
      const tpl = ['sort', 'speed', 'memory', 'sequence'].includes(b.template) ? b.template : 'sort';
      const lx = b.lessonId ? (((await db.doc(`${base}/${courseId}/lessons/${String(b.lessonId)}`).get()).data() as any) || {}) : {};
      const material = `${lx.title || ''}\n${lx.body || String(b.text || '')}\n${lx.transcript ? String(lx.transcript).slice(0, 6000) : ''}\n${(lx.blocks || []).map((k: any) => k.text || (k.steps || []).map((x: any) => x.text).join('\n') || '').join('\n')}`.slice(0, 12000);
      if (material.trim().length < 120) return NextResponse.json({ ok: false, error: 'Write some lesson text first (and save) — games are made from it.' }, { status: 400 });
      const shape: Record<string, string> = {
        sort: '{"bins":["2–4 short category names"],"items":[{"text":"short item","bin":0}]} — 8 to 12 items, each clearly belonging to one bin',
        speed: '{"items":[{"text":"a short statement","true":true,"why":"one-line explanation"}],"seconds":8} — 10 to 14 statements, about half false (believable misconceptions)',
        memory: '{"pairs":[{"a":"term","b":"short meaning"}]} — 6 pairs',
        sequence: '{"steps":["first step","second step"]} — 5 to 8 steps of a procedure, in the correct order',
      };
      const r = await askClaude({ tier: 'smart', maxTokens: 2500, purpose: 'academy-ai-game', tenantId,
        system: 'You write fun, accurate review games for a state-licensed beauty / nail school. Use only facts from the lesson material given — never invent facts, products, figures or regulations. Keep text short enough for phone screens. Reply with JSON only.',
        prompt: `Lesson material:\n${material}\n\nReturn JSON exactly in this shape: ${shape[tpl]}` });
      const j: any = r.ok ? parseJson(r.text) : null;
      const data = j ? cleanGame(tpl, j) : null;
      return data ? NextResponse.json({ ok: true, data }) : NextResponse.json({ ok: false, error: 'The game didn’t come back usable — try again.' }, { status: 502 });
    }

    // ── 📄 Turn a file (PDF or pasted text) into a lesson draft — nothing saved until the owner saves ──
    if (b.action === 'ai-file-lesson') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on (ANTHROPIC_API_KEY).' }, { status: 400 });
      const text = String(b.text || '').slice(0, 40000);
      const pdf = typeof b.pdf === 'string' && b.pdf.startsWith('data:application/pdf;base64,') ? b.pdf.split(',')[1] : null;
      if (pdf && pdf.length > 4_300_000) return NextResponse.json({ ok: false, error: 'That PDF is too large (about 3 MB max) — split it, or paste the text.' }, { status: 400 });
      if (!pdf && text.trim().length < 200) return NextResponse.json({ ok: false, error: 'Attach a PDF or paste at least a few paragraphs.' }, { status: 400 });
      const want = { keyPoints: b.want?.keyPoints !== false, flashcards: b.want?.flashcards !== false, quiz: b.want?.quiz !== false };
      const r = await askClaude({ tier: 'smart', maxTokens: 7000, purpose: 'academy-file-lesson', tenantId, pdfBase64: pdf,
        system: 'You turn an instructor\'s document into a clear, student-friendly lesson for a state-licensed beauty / nail school. Use ONLY what the document says — never add facts, figures, products or regulations it doesn\'t contain; if the document is unclear, leave that part out. Plain, friendly language; short paragraphs; "# " for section headings. Reply with JSON only.',
        prompt: `${pdf ? 'The attached PDF is the source.' : `Source document:\n${text}`}\n${b.focus ? `Focus on: ${String(b.focus).slice(0, 300)}\n` : ''}\nReturn JSON: {"title":"lesson title","notes":"the study notes, with # headings — covering everything important, in the document's order","keyPoints":["the 3–6 things students must remember"]${want.flashcards ? ',"flashcards":[{"front":"term or question","back":"short answer"}]' : ''}${want.quiz ? ',"quiz":[{"q":"question","options":["…","…","…"],"answer":0}]' : ''}} — ${want.flashcards ? '8–12 flashcards, ' : ''}${want.quiz ? '5–8 quiz questions with one right answer and believable wrong ones' : ''}.` });
      const j: any = r.ok ? parseJson(r.text) : null;
      if (!j?.notes) return NextResponse.json({ ok: false, error: r.error || 'The notes didn’t come back usable — try again (or a smaller file).' }, { status: 502 });
      const uidL = () => Math.random().toString(36).slice(2, 10);
      const draft: any = { title: str(j.title, 160), kind: 'text', body: str(j.notes, 20000), blocks: [], fromFile: true };
      if (want.keyPoints && Array.isArray(j.keyPoints) && j.keyPoints.length) draft.blocks.push({ id: uidL(), type: 'callout', tone: 'key', text: j.keyPoints.slice(0, 8).map((x: any) => `• ${str(x, 200)}`).join('\n') });
      if (want.flashcards && Array.isArray(j.flashcards)) draft.flashcards = j.flashcards.slice(0, 20).map((x: any) => ({ front: str(x.front, 200), back: str(x.back, 400) })).filter((x: any) => x.front && x.back);
      if (want.quiz && Array.isArray(j.quiz)) draft.quiz = { passPct: 80, questions: j.quiz.slice(0, 12).map((q: any) => ({ q: str(q.q, 300), options: (q.options || []).map((o: any) => str(o, 160)).filter(Boolean).slice(0, 4), answer: Math.max(0, Number(q.answer) || 0) })).filter((q: any) => q.q && q.options.length >= 2) };
      return NextResponse.json({ ok: true, draft });
    }

    // ── Saved materials: generate once, save, reprint without AI ──
    if (b.action === 'materials-list') {
      const q = await db.collection(`tenants/${tenantId}/materials`).where('courseId', '==', courseId).limit(500).get();
      return NextResponse.json({ ok: true, materials: q.docs.map((d: any) => d.data()).sort((a: any, c: any) => String(c.at).localeCompare(String(a.at))) });
    }
    if (b.action === 'material-save') {
      const m = b.material || {};
      if (!['test', 'worksheet'].includes(m.kind)) return NextResponse.json({ ok: false, error: 'Unknown material.' }, { status: 400 });
      const raw = JSON.stringify(m.data || {}); if (raw.length > 400_000) return NextResponse.json({ ok: false, error: 'Too large to save.' }, { status: 400 });
      const ref = m.id ? db.doc(`tenants/${tenantId}/materials/${String(m.id)}`) : db.collection(`tenants/${tenantId}/materials`).doc();
      await ref.set({ id: ref.id, courseId, kind: m.kind, type: String(m.type || '').slice(0, 30), title: String(m.title || 'Untitled').slice(0, 160), lessonId: m.lessonId || null, seed: Number(m.seed) || 1, data: m.data || {}, by: who, at: now }, { merge: true });
      return NextResponse.json({ ok: true, id: ref.id });
    }
    // 📲 Publish a worksheet as an online activity: a new "Practice" lesson in the course.
    if (b.action === 'material-publish') {
      const type = String(b.type || ''), items = Array.isArray(b.items) ? b.items : [], title = str(b.title, 140) || 'Practice';
      let activity: any = null, assignment: any = null;
      if (type === 'matching') activity = cleanActivity({ type: 'match', prompt: 'Match each term to its meaning', pairs: items.slice(0, 10).map((x: any) => ({ left: x.term, right: x.definition })) });
      if (type === 'wordsearch') activity = cleanActivity({ type: 'wordsearch', words: items.map((x: any) => x.term), seed: b.seed });
      if (type === 'crossword') activity = cleanActivity({ type: 'crossword', entries: items.map((x: any) => ({ answer: x.term, clue: x.definition })), seed: b.seed });
      if (type === 'cloze') activity = cleanActivity({ type: 'cloze', items });
      if (type === 'short') assignment = { prompt: `Answer each question in your own words.\n\n${items.map((x: any, i: number) => `${i + 1}. ${x.question}`).join('\n')}`, type: 'written', rubric: [{ criterion: 'Accuracy', points: 60 }, { criterion: 'Completeness', points: 25 }, { criterion: 'Clear explanation', points: 15 }], dueDays: 7, resubmit: true };
      if (!activity && !assignment) return NextResponse.json({ ok: false, error: 'This worksheet type can’t be published online (label worksheets already come from a lesson activity).' }, { status: 400 });
      const list = await loadLessons(tenantId, courseId);
      const ref = db.collection(`${base}/${courseId}/lessons`).doc();
      await ref.set({ id: ref.id, order: list.length, moduleTitle: 'Practice', title, kind: assignment ? 'assignment' : 'text', body: assignment ? '' : 'Try it here — your score is saved.', ...(activity ? { activity } : {}), ...(assignment ? { assignment } : {}), preview: false, updatedAt: now, fromWorksheet: true });
      await db.doc(`${base}/${courseId}`).set({ lessonCount: list.length + 1, updatedAt: now }, { merge: true });
      return NextResponse.json({ ok: true, lessonId: ref.id });
    }
    if (b.action === 'material-delete') { await db.doc(`tenants/${tenantId}/materials/${String(b.id || '')}`).delete(); return NextResponse.json({ ok: true }); }

    // ── Assignments: grading queue, AI-suggested feedback, returning grades ──
    if (b.action === 'submissions') {
      let q: any = db.collection(`tenants/${tenantId}/submissions`).where('courseId', '==', courseId);
      const s = await q.limit(2000).get();
      return NextResponse.json({ ok: true, submissions: s.docs.map((d: any) => d.data()).sort((a: any, c: any) => (a.status === 'submitted' ? 0 : 1) - (c.status === 'submitted' ? 0 : 1) || String(a.submittedAt).localeCompare(String(c.submittedAt))) });
    }
    if (b.action === 'submission-ai') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on (ANTHROPIC_API_KEY).' }, { status: 400 });
      const sub = ((await db.doc(`tenants/${tenantId}/submissions/${String(b.id || '')}`).get()).data() as any) || null;
      if (!sub) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      if (!String(sub.text || '').trim()) return NextResponse.json({ ok: false, error: 'AI feedback works on written answers — grade photos and files yourself.' }, { status: 400 });
      const lx = ((await db.doc(`${base}/${sub.courseId}/lessons/${sub.lessonId}`).get()).data() as any) || {};
      const rub = lx.assignment?.rubric || [];
      const r = await askClaude({ tier: 'smart', maxTokens: 1200, purpose: 'academy-feedback', tenantId,
        system: 'You help a beauty-school instructor mark a student’s written assignment. Suggest a score for each rubric criterion (whole numbers, 0 to its maximum) and short, kind, specific feedback the student can act on — what they did well and what to improve. Judge only against the assignment and rubric; do not invent requirements. The instructor makes the final decision. Reply with JSON only.',
        prompt: `Assignment:\n${lx.assignment?.prompt || lx.title}\n\nRubric:\n${rub.map((x: any, i: number) => `${i + 1}. ${x.criterion} (max ${x.points})`).join('\n')}\n\nStudent answer:\n${String(sub.text).slice(0, 8000)}\n\nReturn JSON: {"scores":[n,…],"feedback":"…"}` });
      const j: any = r.ok ? parseJson(r.text) : null;
      if (!j) return NextResponse.json({ ok: false, error: 'The suggestion didn’t come back usable — try again.' }, { status: 502 });
      return NextResponse.json({ ok: true, scores: rub.map((x: any, i: number) => Math.max(0, Math.min(x.points, Math.round(Number(j.scores?.[i]) || 0)))), feedback: String(j.feedback || '').slice(0, 3000) });
    }
    if (b.action === 'submission-grade') {
      const ref = db.doc(`tenants/${tenantId}/submissions/${String(b.id || '')}`);
      const sub = ((await ref.get()).data() as any) || null;
      if (!sub) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const lx = ((await db.doc(`${base}/${sub.courseId}/lessons/${sub.lessonId}`).get()).data() as any) || {};
      const rub = lx.assignment?.rubric || [];
      const scores = rub.map((x: any, i: number) => Math.max(0, Math.min(x.points, Math.round(Number(b.scores?.[i]) || 0))));
      const max = rub.reduce((n: number, x: any) => n + x.points, 0) || 100;
      const total = rub.length ? scores.reduce((n: number, x: number) => n + x, 0) : Math.max(0, Math.min(100, Number(b.pct) || 0));
      const pct = Math.round((total / max) * 100);
      const passGrade = 70;
      const redo = !!b.resubmit;
      const grade = { scores, total, max, pct, letter: letter(pct, passGrade), feedback: String(b.feedback || '').slice(0, 4000), by: who, at: now };
      await ref.set({ status: redo ? 'resubmit' : 'returned', grade, history: [...(sub.history || []), { at: now, by: who, pct, redo }] }, { merge: true });
      // A passing grade completes the lesson for the student.
      if (!redo && pct >= passGrade) await db.doc(`tenants/${tenantId}/enrollments/${sub.courseId}_${sub.studentId}`).set({ progress: { [sub.lessonId]: now } }, { merge: true });
      await appendAudit(tenantId, { type: 'assignment.graded', studentId: sub.studentId, courseId: sub.courseId, by: who, summary: `${sub.name || sub.email}: “${lx.title || 'assignment'}” ${pct}% (${grade.letter})${redo ? ' — returned for resubmission' : ''}`, data: { submissionId: ref.id, pct } });
      try { const { sendEmail } = await import('@/lib/academy-journey'); await sendEmail(sub.email, `Your assignment has been ${redo ? 'returned for another try' : 'graded'}`, `“${lx.title || 'Assignment'}” — ${pct}% (${grade.letter}).\n\n${grade.feedback}\n\nSee it in your student portal.`); } catch { /* no email */ }
      return NextResponse.json({ ok: true, pct, letter: grade.letter });
    }
    if (b.action === 'gradebook') {
      const [enr, subs, lessons] = await Promise.all([db.collection(`tenants/${tenantId}/enrollments`).where('courseId', '==', courseId).limit(2000).get(), db.collection(`tenants/${tenantId}/submissions`).where('courseId', '==', courseId).limit(5000).get(), loadLessons(tenantId, courseId)]);
      const items = lessons.filter((l: any) => l.quiz?.questions?.length || l.kind === 'assignment').map((l: any) => ({ id: l.id, title: l.title, kind: l.kind === 'assignment' ? 'assignment' : 'quiz' }));
      // Live-class exit tickets saved for this course.
      const liveKeys = new Map<string, string>();
      enr.docs.forEach((d: any) => Object.entries((d.data() as any).quiz || {}).forEach(([k, v]: any) => { if (/^(live|act|cases|vq|game)_/.test(k)) liveKeys.set(k, v.title || (k.startsWith('live_') ? 'Live class' : 'Practice')); }));
      for (const [id, title] of liveKeys) items.push({ id, title, kind: 'quiz' });
      const S = subs.docs.map((d: any) => d.data() as any);
      const rows = enr.docs.map((d: any) => { const e = d.data() as any;
        const cells = items.map((it: any) => it.kind === 'quiz' ? (e.quiz?.[it.id]?.best ?? null) : (S.find((x: any) => x.studentId === e.studentId && x.lessonId === it.id)?.grade?.pct ?? null));
        const got = cells.filter((x: any) => x != null) as number[]; const avg = got.length ? Math.round(got.reduce((n, x) => n + x, 0) / got.length) : null;
        return { studentId: e.studentId, email: e.email, cells, avg, letter: letter(avg) }; }).sort((a: any, c: any) => String(a.email).localeCompare(String(c.email)));
      const names = new Map((await db.collection(`tenants/${tenantId}/students`).limit(3000).get()).docs.map((d: any) => [d.id, (d.data() as any).name]));
      return NextResponse.json({ ok: true, items, rows: rows.map((r: any) => ({ ...r, name: names.get(r.studentId) || r.email })) });
    }

    // ── AI course builder: from an outline or a PDF, as drafts to approve ──
    if (b.action === 'ai-course') {
      if (!aiConfigured()) return NextResponse.json({ ok: false, error: 'AI isn’t switched on (ANTHROPIC_API_KEY).' }, { status: 400 });
      const outline = String(b.outline || '').slice(0, 20000);
      const pdf = typeof b.pdf === 'string' && b.pdf.startsWith('data:application/pdf;base64,') ? b.pdf.split(',')[1] : null;
      if (pdf && pdf.length > 4_300_000) return NextResponse.json({ ok: false, error: 'That PDF is too large (about 3 MB max) — split it or paste the outline.' }, { status: 400 });
      if (!outline.trim() && !pdf) return NextResponse.json({ ok: false, error: 'Paste an outline or attach a PDF.' }, { status: 400 });
      const r = await askClaude({ tier: 'smart', maxTokens: 6000, purpose: 'academy-course-builder', tenantId, pdfBase64: pdf,
        system: 'You design courses for a state-licensed beauty / wellness school. Build a clear course structure from the material the instructor provides (an outline, syllabus or curriculum). Stay faithful to it: use its topics and order; do not add regulations, products or medical claims it does not contain. Begin with infection control where the material covers hands-on services. Reply with JSON only.',
        prompt: `${outline ? `Instructor’s outline / notes:\n${outline}\n\n` : ''}${pdf ? 'The attached PDF is the curriculum or syllabus to build from.\n\n' : ''}Audience: ${String(b.audience || 'students').slice(0, 200)}. Approximate total hours: ${Number(b.hours) || 'not given'}.\n\nReturn JSON: {"title":"…","subtitle":"…","description":"…","whatYouLearn":["…"],"modules":[{"title":"…","lessons":[{"title":"…","kind":"text|video|assignment","minutes":45,"objectives":["…"],"summary":"2–4 sentences of what the lesson covers","subjects":["…"]}]}]}` });
      const j: any = r.ok ? parseJson(r.text) : null;
      return j?.modules ? NextResponse.json({ ok: true, draft: j }) : NextResponse.json({ ok: false, error: r.error || 'The draft didn’t come back usable — try again (or shorten the material).' }, { status: 502 });
    }
    if (b.action === 'ai-course-create') {
      const dft = b.draft || {};
      const cref = db.collection(base).doc();
      let slug = slugify(dft.title || 'course'); if (RESERVED_SLUGS.includes(slug)) slug = `${slug}-course`;
      if (!(await db.collection(base).where('slug', '==', slug).limit(1).get()).empty) slug = `${slug}-${cref.id.slice(0, 4).toLowerCase()}`;
      await cref.set({ id: cref.id, title: str(dft.title, 120) || 'New course', slug, subtitle: str(dft.subtitle, 200), description: str(dft.description, 8000), whatYouLearn: (dft.whatYouLearn || []).map((x: any) => str(x, 160)).slice(0, 12),
        priceCents: 0, status: 'draft', aiTutor: true, captionLanguage: 'en', createdAt: now, updatedAt: now, enrolledCount: 0, revenueCents: 0, builtWithAi: true });
      let order = 0;
      for (const m of (dft.modules || []).slice(0, 30)) for (const l of (m.lessons || []).slice(0, 40)) {
        if (l.skip) continue;
        const lref = db.collection(`${base}/${cref.id}/lessons`).doc();
        await lref.set({ id: lref.id, order: order++, moduleTitle: str(m.title, 120) || 'Module', title: str(l.title, 160) || 'Lesson', kind: KINDS.includes(l.kind) ? l.kind : 'text',
          body: `${str(l.summary, 2000)}${(l.objectives || []).length ? `\n\n# You’ll be able to\n\n${(l.objectives || []).map((o: any) => `• ${str(o, 200)}`).join('\n')}` : ''}`,
          plan: cleanPlan({ objectives: l.objectives, minutes: l.minutes, subjects: l.subjects, agenda: [] }), preview: order === 1, updatedAt: now });
      }
      await db.doc(`${base}/${cref.id}`).set({ lessonCount: order }, { merge: true });
      return NextResponse.json({ ok: true, id: cref.id, lessons: order });
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
