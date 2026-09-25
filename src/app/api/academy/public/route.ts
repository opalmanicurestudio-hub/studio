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
        courses.push({ ...publicCourse({ id: en.courseId, ...c }), done, pct: Math.round((done / Math.max(1, c.lessonCount || 1)) * 100), lastLessonId: en.lastLessonId || null, since: en.createdAt });
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
      return NextResponse.json({ ok: true, enrolled, lesson: { id: lessonId, title: l.title, moduleTitle: l.moduleTitle, kind: l.kind, body: l.body || '', downloadUrl: l.downloadUrl || null, downloadName: l.downloadName || null, preview: !!l.preview, video } });
    }

    if (b.action === 'progress') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
      const ref = db.doc(`tenants/${tenantId}/enrollments/${String(b.courseId || '')}_${student.id}`);
      const e = ((await ref.get()).data() as any) || null;
      if (!e) return NextResponse.json({ ok: false, error: 'Not enrolled.' }, { status: 403 });
      const progress = { ...(e.progress || {}) };
      if (b.done) progress[String(b.lessonId)] = new Date().toISOString(); else delete progress[String(b.lessonId)];
      await ref.set({ progress, lastLessonId: String(b.lessonId) }, { merge: true });
      return NextResponse.json({ ok: true, progress });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
