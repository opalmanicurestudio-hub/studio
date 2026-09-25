// src/app/api/academy/public/route.ts
//
// THE ACADEMY, FOR STUDENTS — no ClarityFlow account needed.
//   catalog   { tenantId }                          published courses
//   course    { tenantId, slug, token? }            page + curriculum (+ progress if enrolled)
//   checkout  { tenantId, courseId, email, name }   Stripe Checkout (card or pay-later);
//                                                   free courses enrol straight away
//   confirm   { tenantId, sessionId }               after payment → enrolled + signed in
//   login     { tenantId, email }                   emails a sign-in link (always "ok")
//   exchange  { tenantId, loginToken }              email link → 30-day sign-in
//   me        { tenantId, token }                   my courses + progress
//   lesson    { tenantId, courseId, lessonId, token? }  content; video token if allowed
//   progress  { tenantId, token, courseId, lessonId, done }

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { resolveFromAddress } from '@/lib/notify';
import { linkOrigin } from '@/lib/app-origin';
import { payLaterCheckoutParams } from '@/lib/pay-later';
import { loadCourseBySlug, loadLessons, studentFromToken, enroll, enrollFromCheckout, createStudentSession, createLoginLink, studentIdFor, sha, muxPlaybackToken, embedUrl } from '@/lib/academy';
import { applyBeat, appendAudit, jitterMin, lessonMet, qrValid, metersBetween, mergeRanges, watchedSeconds, DEFAULT_RULES, type Range } from '@/lib/academy-compliance';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';
const hits = new Map<string, { n: number; at: number }>();
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
const publicCourse = (c: any) => ({ id: c.id, slug: c.slug, title: c.title, subtitle: c.subtitle || '', description: c.description || '', priceCents: c.priceCents || 0, level: c.level || null,
  instructorName: c.instructorName || null, coverUrl: c.coverUrl || null, whatYouLearn: c.whatYouLearn || [], lessonCount: c.lessonCount || 0 });

async function sendEmail(to: string, subject: string, text: string) {
  if (!process.env.RESEND_API_KEY) return false;
  try { const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: resolveFromAddress(), to, subject, text }) }); return r.ok; } catch { return false; }
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  const h = hits.get(ip); const now = Date.now();
  if (h && now - h.at < 60000 && h.n >= 120) return NextResponse.json({ ok: false, error: 'Slow down a moment.' }, { status: 429 });
  hits.set(ip, h && now - h.at < 60000 ? { n: h.n + 1, at: h.at } : { n: 1, at: now });

  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const db = getAdminDb();
  const tSnap = await db.doc(`tenants/${tenantId}`).get();
  if (!tSnap.exists) return NextResponse.json({ ok: false, error: 'Academy not found.' }, { status: 404 });
  const t = tSnap.data() as any;
  if (t.modules?.academy === false) return NextResponse.json({ ok: false, error: 'This academy isn’t open.' }, { status: 404 });
  const brand = { name: t.name || 'Academy', color: t.bookingPageSettings?.primaryColor || '#1c1917', logoUrl: t.logoUrl || t.bookingPageSettings?.logoUrl || null };
  const origin = linkOrigin(t, req.nextUrl.origin);
  const student = await studentFromToken(tenantId, b.token);

  try {
    if (b.action === 'catalog') {
      const s = await db.collection(`tenants/${tenantId}/courses`).where('status', '==', 'published').limit(100).get();
      return NextResponse.json({ ok: true, brand, courses: s.docs.map((d: any) => publicCourse({ id: d.id, ...(d.data() as any) })), signedIn: !!student });
    }

    if (b.action === 'course') {
      const c = await loadCourseBySlug(tenantId, String(b.slug || ''));
      if (!c || c.status !== 'published') return NextResponse.json({ ok: false, error: 'Course not found.' }, { status: 404 });
      const lessons = await loadLessons(tenantId, c.id);
      const enr = student ? ((await db.doc(`tenants/${tenantId}/enrollments/${c.id}_${student.id}`).get()).data() as any) || null : null;
      return NextResponse.json({ ok: true, brand, course: publicCourse(c), enrolled: !!enr, progress: enr?.progress || {}, lastLessonId: enr?.lastLessonId || null, student: student ? { email: student.email, name: student.name } : null,
        lessons: lessons.map((l: any) => ({ id: l.id, title: l.title, moduleTitle: l.moduleTitle, kind: l.kind, preview: !!l.preview, durationSec: l.durationSec || null })),
        payLater: !!t.payLater?.enabled && (c.priceCents || 0) >= (Number(t.payLater?.minAmount ?? 150) * 100) });
    }

    if (b.action === 'checkout') {
      const email = String(b.email || student?.email || '').trim().toLowerCase();
      const name = String(b.name || student?.name || '').trim().slice(0, 80) || null;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: 'Enter your email.' }, { status: 400 });
      const cSnap = await db.doc(`tenants/${tenantId}/courses/${String(b.courseId || '')}`).get();
      const c = cSnap.exists ? ({ id: cSnap.id, ...(cSnap.data() as any) }) : null;
      if (!c || c.status !== 'published') return NextResponse.json({ ok: false, error: 'Course not found.' }, { status: 404 });
      const already = await db.doc(`tenants/${tenantId}/enrollments/${c.id}_${studentIdFor(email)}`).get();
      if (already.exists) return NextResponse.json({ ok: false, error: 'You’re already enrolled — sign in with your email to continue.', already: true }, { status: 400 });
      if (!c.priceCents) {
        const r = await enroll({ tenantId, courseId: c.id, email, name, paidCents: 0 });
        return NextResponse.json({ ok: true, free: true, token: await createStudentSession(tenantId, r.studentId) });
      }
      if (!t.stripeAccountId) return NextResponse.json({ ok: false, error: 'This academy can’t take payments yet.' }, { status: 400 });
      const session = await stripe().checkout.sessions.create({
        mode: 'payment', customer_email: email,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: c.priceCents, product_data: { name: c.title, description: (c.subtitle || `Online course · ${brand.name}`).slice(0, 300) } } }],
        ...payLaterCheckoutParams(t.payLater, c.priceCents),
        metadata: { type: 'academy_course', courseId: c.id, email, name: name || '' },
        payment_intent_data: { metadata: { type: 'academy_course', courseId: c.id, email } },
        success_url: `${origin}/learn/${tenantId}/welcome?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/learn/${tenantId}/${c.slug}`,
      } as any, { stripeAccount: t.stripeAccountId });
      return NextResponse.json({ ok: true, url: session.url });
    }

    if (b.action === 'confirm') {
      if (!t.stripeAccountId) return NextResponse.json({ ok: false, error: 'No payments set up.' }, { status: 400 });
      const s = await stripe().checkout.sessions.retrieve(String(b.sessionId || ''), {}, { stripeAccount: t.stripeAccountId });
      const r = await enrollFromCheckout(tenantId, s);
      if (!r) return NextResponse.json({ ok: false, pending: true, error: 'Your payment is still being confirmed — this page will update.' });
      const course = ((await db.doc(`tenants/${tenantId}/courses/${s.metadata?.courseId}`).get()).data() as any) || {};
      if (r.created) {
        const link = `${origin}/learn/${tenantId}/my?login=${await createLoginLink(tenantId, r.studentId)}`;
        await sendEmail(String(s.metadata?.email), `You’re in — ${course.title || 'your course'}`, `Welcome to ${course.title || 'your course'} with ${brand.name}!\n\nStart learning any time:\n${origin}/learn/${tenantId}/${course.slug || ''}\n\nOn another device? Sign in here (link works for 30 minutes):\n${link}\n\nOr visit ${origin}/learn/${tenantId}/my and enter this email for a fresh link.`);
      }
      return NextResponse.json({ ok: true, token: await createStudentSession(tenantId, r.studentId), slug: course.slug || null, title: course.title || null });
    }

    if (b.action === 'login') {
      const email = String(b.email || '').trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        const sid = studentIdFor(email);
        if ((await db.doc(`tenants/${tenantId}/students/${sid}`).get()).exists) {
          const link = `${origin}/learn/${tenantId}/my?login=${await createLoginLink(tenantId, sid)}`;
          await sendEmail(email, `Your sign-in link — ${brand.name}`, `Here’s your link to continue learning with ${brand.name} (works for 30 minutes):\n\n${link}\n\nIf you didn’t ask for this, you can ignore it.`);
        }
      }
      return NextResponse.json({ ok: true });   // same answer either way — no one can probe for students
    }

    if (b.action === 'exchange') {
      const ref = db.doc(`tenants/${tenantId}/studentLogins/${sha(String(b.loginToken || ''))}`);
      const l = ((await ref.get()).data() as any) || null;
      if (!l || l.used || new Date(l.expiresAt).getTime() < Date.now()) return NextResponse.json({ ok: false, error: 'That sign-in link has expired — ask for a new one.' }, { status: 400 });
      await ref.set({ used: true, usedAt: new Date().toISOString() }, { merge: true });
      return NextResponse.json({ ok: true, token: await createStudentSession(tenantId, l.studentId) });
    }

    if (b.action === 'me') {
      if (!student) return NextResponse.json({ ok: true, brand, student: null, courses: [] });
      const e = await db.collection(`tenants/${tenantId}/enrollments`).where('studentId', '==', student.id).limit(100).get();
      const courses = [];
      for (const d of e.docs) {
        const en = d.data() as any;
        const c = ((await db.doc(`tenants/${tenantId}/courses/${en.courseId}`).get()).data() as any) || null;
        if (!c) continue;
        const done = Object.keys(en.progress || {}).length;
        courses.push({ ...publicCourse({ id: en.courseId, ...c }), done, pct: Math.round((done / Math.max(1, c.lessonCount || 1)) * 100), lastLessonId: en.lastLessonId || null, since: en.createdAt,
          onlineHours: Math.round(((en.onlineSec || 0) / 3600) * 10) / 10, requiredOnlineHours: c.requiredOnlineHours || null, requiredInPersonHours: c.requiredInPersonHours || null, certificateCode: en.certificateCode || null });
      }
      return NextResponse.json({ ok: true, brand, student: { email: student.email, name: student.name }, courses });
    }

    if (b.action === 'lesson') {
      const courseId = String(b.courseId || ''), lessonId = String(b.lessonId || '');
      const c = ((await db.doc(`tenants/${tenantId}/courses/${courseId}`).get()).data() as any) || null;
      const l = ((await db.doc(`tenants/${tenantId}/courses/${courseId}/lessons/${lessonId}`).get()).data() as any) || null;
      if (!c || !l || c.status !== 'published') return NextResponse.json({ ok: false, error: 'Lesson not found.' }, { status: 404 });
      const enrolled = student ? (await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).get()).exists : false;
      if (!enrolled && !l.preview) return NextResponse.json({ ok: false, locked: true, error: 'Enrol to watch this lesson.' }, { status: 403 });
      const video = l.kind === 'video'
        ? (l.muxPlaybackId && l.muxStatus === 'ready' ? { type: 'mux', playbackId: l.muxPlaybackId, token: muxPlaybackToken(l.muxPlaybackId) } : l.videoUrl ? { type: 'embed', url: embedUrl(l.videoUrl) } : null)
        : null;
      if (enrolled && student) await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).set({ lastLessonId: lessonId, lastSeenAt: new Date().toISOString() }, { merge: true });
      const enr = enrolled && student ? ((await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).get()).data() as any) || {} : {};
      const stat = enr.stats?.[lessonId] || {};
      const quiz = l.quiz?.questions?.length ? { passPct: l.quiz.passPct || 80, questions: l.quiz.questions.map((q: any) => ({ q: q.q, options: q.options })), attempts: (enr.quiz?.[lessonId]?.attempts || []).slice(-5), passed: !!enr.quiz?.[lessonId]?.passed } : null;
      return NextResponse.json({ ok: true, enrolled, lesson: { id: lessonId, title: l.title, moduleTitle: l.moduleTitle, kind: l.kind, body: l.body || '', downloadUrl: l.downloadUrl || null, downloadName: l.downloadName || null, preview: !!l.preview, video, durationSec: l.durationSec || null, minMinutes: l.minMinutes || 0, quiz },
        tracking: { compliance: !!c.compliance, checkEveryMin: c.compliance ? (c.attentionCheckMinutes ?? DEFAULT_RULES.attentionCheckMinutes) : 0, minEngagementPct: c.minEngagementPct ?? DEFAULT_RULES.minEngagementPct, minWatchPct: c.minWatchPct ?? DEFAULT_RULES.minWatchPct,
          engagedSec: stat.engagedSec || 0, watchedSec: stat.watchedSec || 0 } });
    }

    if (b.action === 'progress') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
      const ref = db.doc(`tenants/${tenantId}/enrollments/${String(b.courseId || '')}_${student.id}`);
      const e = ((await ref.get()).data() as any) || null;
      if (!e) return NextResponse.json({ ok: false, error: 'Not enrolled.' }, { status: 403 });
      const progress = { ...(e.progress || {}) };
      const courseId = String(b.courseId || ''), lessonId = String(b.lessonId || '');
      if (b.done) {
        const c = ((await db.doc(`tenants/${tenantId}/courses/${courseId}`).get()).data() as any) || {};
        const l = ((await db.doc(`tenants/${tenantId}/courses/${courseId}/lessons/${lessonId}`).get()).data() as any) || {};
        const st = e.stats?.[lessonId] || {};
        const m = lessonMet(c, l, { engagedSec: st.engagedSec || 0, watchedSec: st.watchedSec || 0, quizPassed: !!e.quiz?.[lessonId]?.passed });
        if (!m.met) return NextResponse.json({ ok: false, error: m.why, notMet: true }, { status: 400 });
        progress[lessonId] = new Date().toISOString();
        await appendAudit(tenantId, { type: 'lesson.completed', studentId: student.id, courseId, by: student.email, summary: `Completed “${l.title || lessonId}” — ${Math.round((st.engagedSec || 0) / 60)} active min, ${l.durationSec ? Math.round(((st.watchedSec || 0) / l.durationSec) * 100) + '% watched' : 'no video'}`, data: { lessonId, engagedSec: st.engagedSec || 0, watchedSec: st.watchedSec || 0 } });
      } else {
        const c = ((await db.doc(`tenants/${tenantId}/courses/${courseId}`).get()).data() as any) || {};
        if (c.compliance) return NextResponse.json({ ok: false, error: 'Completed lessons stay on your record.' }, { status: 400 });
        delete progress[lessonId];
      }
      await ref.set({ progress, lastLessonId: lessonId }, { merge: true });
      return NextResponse.json({ ok: true, progress });
    }

    // ── Verified online time ──
    if (b.action === 'session-start') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
      const courseId = String(b.courseId || ''), lessonId = String(b.lessonId || '');
      if (!(await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).get()).exists) return NextResponse.json({ ok: false, error: 'Not enrolled.' }, { status: 403 });
      const c = ((await db.doc(`tenants/${tenantId}/courses/${courseId}`).get()).data() as any) || {};
      const every = c.compliance ? (c.attentionCheckMinutes ?? DEFAULT_RULES.attentionCheckMinutes) : 0;
      const ref = db.collection(`tenants/${tenantId}/learningSessions`).doc();
      const at = new Date().toISOString();
      await ref.set({ id: ref.id, studentId: student.id, email: student.email, courseId, lessonId, startedAt: at, lastBeatAt: at, status: 'active', engagedSec: 0, idleSec: 0, beats: 0,
        checksIssued: 0, checksPassed: 0, checksMissed: 0, check: null, nextCheckAt: every ? new Date(Date.now() + jitterMin(every) * 60000).toISOString() : null, ranges: [], watchedSec: 0,
        ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null, userAgent: String(req.headers.get('user-agent') || '').slice(0, 240) });
      return NextResponse.json({ ok: true, sessionId: ref.id });
    }
    if (b.action === 'heartbeat') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in again.' }, { status: 401 });
      const sRef = db.doc(`tenants/${tenantId}/learningSessions/${String(b.sessionId || '')}`);
      const sess = ((await sRef.get()).data() as any) || null;
      if (!sess || sess.studentId !== student.id || sess.status !== 'active') return NextResponse.json({ ok: false, restart: true });
      const c = ((await db.doc(`tenants/${tenantId}/courses/${sess.courseId}`).get()).data() as any) || {};
      const l = ((await db.doc(`tenants/${tenantId}/courses/${sess.courseId}/lessons/${sess.lessonId}`).get()).data() as any) || {};
      const ranges: Range[] = (Array.isArray(b.ranges) ? b.ranges : []).slice(0, 50).map((r: any) => [Number(r?.[0]) || 0, Number(r?.[1]) || 0] as Range);
      const r = applyBeat(sess, { visible: !!b.visible, playing: !!b.playing, interacted: !!b.interacted, ranges, checkAnswer: b.checkAnswer ? String(b.checkAnswer) : null },
        { checkEveryMin: c.compliance ? (c.attentionCheckMinutes ?? DEFAULT_RULES.attentionCheckMinutes) : 0, videoDurationSec: l.durationSec || null });
      await sRef.set(r.patch, { merge: true });
      // Roll this session's gains into the student's record for the lesson.
      const eRef = db.doc(`tenants/${tenantId}/enrollments/${sess.courseId}_${student.id}`);
      const e = ((await eRef.get()).data() as any) || {};
      const st = e.stats?.[sess.lessonId] || {};
      const lessonRanges = r.patch.ranges ? mergeRanges(st.ranges || [], r.patch.ranges) : (st.ranges || []);
      const next = { engagedSec: (st.engagedSec || 0) + r.credit, ranges: lessonRanges, watchedSec: watchedSeconds(lessonRanges) };
      await eRef.set({ stats: { [sess.lessonId]: next }, onlineSec: (e.onlineSec || 0) + r.credit, lastActiveAt: new Date().toISOString() }, { merge: true });
      return NextResponse.json({ ok: true, credited: r.credit, check: r.showCheck, paused: r.blocked, lessonEngagedSec: next.engagedSec, lessonWatchedSec: next.watchedSec });
    }
    if (b.action === 'session-end') {
      const sRef = db.doc(`tenants/${tenantId}/learningSessions/${String(b.sessionId || '')}`);
      const sess = ((await sRef.get()).data() as any) || null;
      if (sess && student && sess.studentId === student.id && sess.status === 'active') {
        await sRef.set({ status: 'closed', endedAt: new Date().toISOString() }, { merge: true });
        await appendAudit(tenantId, { type: 'online.session', studentId: student.id, courseId: sess.courseId, by: student.email, summary: `Online session: ${Math.round((sess.engagedSec || 0) / 60)} active min (${Math.round((sess.idleSec || 0) / 60)} idle), checks ${sess.checksPassed || 0}/${sess.checksIssued || 0} answered`, data: { sessionId: sess.id, lessonId: sess.lessonId, engagedSec: sess.engagedSec || 0, idleSec: sess.idleSec || 0, checksMissed: sess.checksMissed || 0 } });
      }
      return NextResponse.json({ ok: true });
    }

    // ── Quizzes (graded here; answers never leave the server) ──
    if (b.action === 'quiz-submit') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
      const courseId = String(b.courseId || ''), lessonId = String(b.lessonId || '');
      const eRef = db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`);
      const e = ((await eRef.get()).data() as any) || null;
      if (!e) return NextResponse.json({ ok: false, error: 'Not enrolled.' }, { status: 403 });
      const l = ((await db.doc(`tenants/${tenantId}/courses/${courseId}/lessons/${lessonId}`).get()).data() as any) || {};
      const qs = l.quiz?.questions || [];
      if (!qs.length) return NextResponse.json({ ok: false, error: 'No quiz here.' }, { status: 400 });
      const answers: number[] = Array.isArray(b.answers) ? b.answers.map((x: any) => Number(x)) : [];
      const correct = qs.reduce((n: number, q: any, i: number) => n + (answers[i] === Number(q.answer) ? 1 : 0), 0);
      const score = Math.round((correct / qs.length) * 100);
      const passed = score >= (l.quiz.passPct || 80);
      const prev = e.quiz?.[lessonId] || { attempts: [] };
      const attempt = { at: new Date().toISOString(), score, correct, total: qs.length, passed };
      await eRef.set({ quiz: { [lessonId]: { attempts: [...(prev.attempts || []), attempt].slice(-50), passed: prev.passed || passed, best: Math.max(prev.best || 0, score) } } }, { merge: true });
      await appendAudit(tenantId, { type: 'quiz.attempt', studentId: student.id, courseId, by: student.email, summary: `Quiz “${l.title || lessonId}”: ${score}% (${correct}/${qs.length}) — ${passed ? 'passed' : 'not passed'}`, data: { lessonId, score, passed } });
      return NextResponse.json({ ok: true, score, correct, total: qs.length, passed, wrong: qs.map((q: any, i: number) => answers[i] !== Number(q.answer) ? i : -1).filter((i: number) => i >= 0) });
    }

    // ── Clock in / out at the academy (rotating QR) ──
    if (b.action === 'attend-status' || b.action === 'attend') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in first.', needsSignIn: true }, { status: 401 });
      const open = await db.collection(`tenants/${tenantId}/attendance`).where('studentId', '==', student.id).where('status', '==', 'open').limit(1).get();
      if (b.action === 'attend-status') return NextResponse.json({ ok: true, student: { email: student.email, name: student.name }, open: open.empty ? null : { id: open.docs[0].id, clockInAt: (open.docs[0].data() as any).clockInAt } });
      if (!qrValid(tenantId, String(b.code || ''), Number(b.w))) return NextResponse.json({ ok: false, error: 'That code has expired — scan the screen again.' }, { status: 400 });
      const cfg = t.academy || {};
      const geo = b.geo && Number.isFinite(Number(b.geo.lat)) ? { lat: Number(b.geo.lat), lng: Number(b.geo.lng), accuracy: Number(b.geo.accuracy) || null } : null;
      let distance: number | null = null;
      if (cfg.geo?.lat != null && geo) distance = Math.round(metersBetween(cfg.geo, geo));
      if (cfg.requireGeo) {
        if (!geo) return NextResponse.json({ ok: false, error: 'Allow location to clock in — the academy requires it.', needsGeo: true }, { status: 400 });
        if (distance != null && distance > (cfg.geo?.radiusM || 150) + Math.min(100, geo.accuracy || 0)) return NextResponse.json({ ok: false, error: `You appear to be ${distance} m from the academy. Clock in on site.` }, { status: 400 });
      }
      const at = new Date().toISOString();
      const meta = { ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null, userAgent: String(req.headers.get('user-agent') || '').slice(0, 240), geo, distanceM: distance };
      if (b.direction === 'in') {
        if (!open.empty) return NextResponse.json({ ok: false, error: `You’re already clocked in since ${new Date((open.docs[0].data() as any).clockInAt).toLocaleTimeString()}.` }, { status: 400 });
        const ref = db.collection(`tenants/${tenantId}/attendance`).doc();
        await ref.set({ id: ref.id, studentId: student.id, email: student.email, name: student.name || null, courseId: b.courseId || null, clockInAt: at, clockOutAt: null, minutes: 0, status: 'open', in: meta, out: null, corrections: [] });
        await appendAudit(tenantId, { type: 'attendance.in', studentId: student.id, by: student.email, summary: `Clocked in${distance != null ? ` (${distance} m from academy)` : ''}`, data: { attendanceId: ref.id, at } });
        return NextResponse.json({ ok: true, direction: 'in', at });
      }
      if (open.empty) return NextResponse.json({ ok: false, error: 'You’re not clocked in.' }, { status: 400 });
      const p = open.docs[0].data() as any;
      const minutes = Math.max(0, Math.floor((Date.now() - new Date(p.clockInAt).getTime()) / 60000));
      await open.docs[0].ref.set({ clockOutAt: at, minutes, status: cfg.requireApproval ? 'pending' : 'closed', out: meta }, { merge: true });
      await appendAudit(tenantId, { type: 'attendance.out', studentId: student.id, by: student.email, summary: `Clocked out — ${Math.floor(minutes / 60)}h ${minutes % 60}m${cfg.requireApproval ? ' (awaiting instructor approval)' : ''}`, data: { attendanceId: open.docs[0].id, at, minutes } });
      return NextResponse.json({ ok: true, direction: 'out', at, minutes, pending: !!cfg.requireApproval });
    }

    // ── Certificates ──
    if (b.action === 'certificate') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
      const courseId = String(b.courseId || '');
      const e = ((await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).get()).data() as any) || null;
      const c = ((await db.doc(`tenants/${tenantId}/courses/${courseId}`).get()).data() as any) || null;
      if (!e || !c) return NextResponse.json({ ok: false, error: 'Not enrolled.' }, { status: 403 });
      if (e.certificateCode) return NextResponse.json({ ok: true, code: e.certificateCode });
      const lessons = await loadLessons(tenantId, courseId);
      const missing = lessons.filter((l: any) => !e.progress?.[l.id]);
      if (missing.length) return NextResponse.json({ ok: false, error: `${missing.length} lesson${missing.length === 1 ? '' : 's'} still to complete.` }, { status: 400 });
      const onlineH = (e.onlineSec || 0) / 3600;
      if (c.requiredOnlineHours && onlineH < c.requiredOnlineHours) return NextResponse.json({ ok: false, error: `${(c.requiredOnlineHours - onlineH).toFixed(1)} more online hours needed.` }, { status: 400 });
      if (c.requiredInPersonHours) {
        const att = await db.collection(`tenants/${tenantId}/attendance`).where('studentId', '==', student.id).limit(5000).get();
        const h = att.docs.map((d: any) => d.data() as any).filter((p: any) => ['closed', 'approved'].includes(p.status) && (!p.courseId || p.courseId === courseId)).reduce((n: number, p: any) => n + (p.minutes || 0), 0) / 60;
        if (h < c.requiredInPersonHours) return NextResponse.json({ ok: false, error: `${(c.requiredInPersonHours - h).toFixed(1)} more in-person hours needed.` }, { status: 400 });
      }
      const code = randomBytes(5).toString('hex').toUpperCase();
      const issuedAt = new Date().toISOString();
      const cert = { code, tenantId, tenantName: t.name || null, courseId, courseTitle: c.title, studentId: student.id, studentName: student.name || student.email, email: student.email, issuedAt,
        onlineHours: Math.round(onlineH * 10) / 10, requiredOnlineHours: c.requiredOnlineHours || null, requiredInPersonHours: c.requiredInPersonHours || null, status: 'valid' };
      await db.doc(`platformCertificates/${code}`).set(cert);
      await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).set({ certificateCode: code, completedAt: issuedAt }, { merge: true });
      await appendAudit(tenantId, { type: 'certificate.issued', studentId: student.id, courseId, by: 'system', summary: `Certificate ${code} issued for “${c.title}”`, data: { code } });
      return NextResponse.json({ ok: true, code });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
