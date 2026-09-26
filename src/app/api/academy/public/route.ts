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

import { upcomingPayments, studentPaySession, completeStudentPayment, cardUpdateSession, completeCardUpdate } from '@/lib/academy-admissions';
import { translateTexts, translateLong, LANGUAGES } from '@/lib/translate';
import { findLive, studentBeat, studentAnswer } from '@/lib/academy-live';
import { askClaude, aiConfigured } from '@/lib/ai';
import { postMessage, sendEmail as sendJourneyEmail } from '@/lib/academy-journey';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { resolveFromAddress } from '@/lib/notify';
import { linkOrigin } from '@/lib/app-origin';
import { payLaterCheckoutParams } from '@/lib/pay-later';
import { loadCourseBySlug, loadLessons, studentFromToken, enroll, enrollFromCheckout, createStudentSession, createLoginLink, studentIdFor, sha, muxPlaybackToken, embedUrl } from '@/lib/academy';
import { applyBeat, appendAudit, jitterMin, lessonMet, qrValid, metersBetween, mergeRanges, watchedSeconds, DEFAULT_RULES, type Range } from '@/lib/academy-compliance';
import { randomBytes } from 'crypto';
import { savePrivateImage } from '@/lib/private-storage';
import { programProgress } from '@/lib/academy-school';
import { DEFAULT_DOCS, DEFAULT_REFUND, admissionByToken, issueApplicationLink, setStage, renderAgreement, createTuitionPlan, completeDownPayment, planBalance, sha as sha256hex } from '@/lib/academy-admissions';
import { savePrivateDocument } from '@/lib/private-storage';

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
        lessons: lessons.map((l: any) => ({ id: l.id, title: l.title, moduleTitle: l.moduleTitle, kind: l.kind, preview: !!l.preview, durationSec: l.durationSec || null,
          unlockAt: enr && Number(l.releaseAfterDays) > 0 ? new Date(new Date(enr.startDate || enr.createdAt).getTime() + Number(l.releaseAfterDays) * 86400000).toISOString() : null })),
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
      // Licensed-school students: their program's hours and service requirements.
      const pe = await db.collection(`tenants/${tenantId}/programEnrollments`).where('studentId', '==', student.id).limit(10).get();
      const programs = [];
      for (const d of pe.docs) { const pr = await programProgress(tenantId, d.id); if (pr) programs.push({ id: d.id, name: pr.program.name, status: pr.enrollment.status, hours: pr.hours, totalHours: pr.program.totalHours, requirements: pr.requirements, requirementsPct: pr.requirementsPct }); }
      return NextResponse.json({ ok: true, brand, student: { email: student.email, name: student.name }, courses, programs });
    }

    if (b.action === 'lesson') {
      const courseId = String(b.courseId || ''), lessonId = String(b.lessonId || '');
      const c = ((await db.doc(`tenants/${tenantId}/courses/${courseId}`).get()).data() as any) || null;
      const l = ((await db.doc(`tenants/${tenantId}/courses/${courseId}/lessons/${lessonId}`).get()).data() as any) || null;
      if (!c || !l || c.status !== 'published') return NextResponse.json({ ok: false, error: 'Lesson not found.' }, { status: 404 });
      const enrolled = student ? (await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).get()).exists : false;
      if (!enrolled && !l.preview) return NextResponse.json({ ok: false, locked: true, error: 'Enrol to watch this lesson.' }, { status: 403 });
      // Scheduled release: unlocks N days after the student starts.
      if (enrolled && student && Number(l.releaseAfterDays) > 0) {
        const en = ((await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).get()).data() as any) || {};
        const unlock = new Date(new Date(en.startDate || en.createdAt || Date.now()).getTime() + Number(l.releaseAfterDays) * 86400000);
        if (unlock.getTime() > Date.now()) return NextResponse.json({ ok: false, locked: true, error: `This lesson unlocks on ${unlock.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` }, { status: 403 });
      }
      const video = l.kind === 'video'
        ? (l.muxPlaybackId && l.muxStatus === 'ready' ? { type: 'mux', playbackId: l.muxPlaybackId, token: muxPlaybackToken(l.muxPlaybackId) } : l.videoUrl ? { type: 'embed', url: embedUrl(l.videoUrl) } : null)
        : null;
      if (enrolled && student) await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).set({ lastLessonId: lessonId, lastSeenAt: new Date().toISOString() }, { merge: true });
      const enr = enrolled && student ? ((await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).get()).data() as any) || {} : {};
      const stat = enr.stats?.[lessonId] || {};
      const quiz = l.quiz?.questions?.length ? { passPct: l.quiz.passPct || 80, questions: l.quiz.questions.map((q: any) => ({ q: q.q, options: q.options })), attempts: (enr.quiz?.[lessonId]?.attempts || []).slice(-5), passed: !!enr.quiz?.[lessonId]?.passed } : null;
      const studentLang = student ? ((((await db.doc(`tenants/${tenantId}/students/${student.id}`).get()).data() as any) || {}).language || 'en') : 'en';
      return NextResponse.json({ ok: true, enrolled, studentLang, aiTutor: enrolled && c.aiTutor !== false && aiConfigured(), lesson: { id: lessonId, title: l.title, moduleTitle: l.moduleTitle, kind: l.kind, body: l.body || '', downloadUrl: l.downloadUrl || null, downloadName: l.downloadName || null, preview: !!l.preview, video, durationSec: l.durationSec || null, minMinutes: l.minMinutes || 0, quiz,
        flashcards: l.flashcards || [], activity: l.activity || null, transcript: l.transcript || null },
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

    // ── Admissions: apply, then a private application page ──
    if (b.action === 'programs') {
      const s = await db.collection(`tenants/${tenantId}/programs`).where('status', '==', 'active').limit(50).get();
      return NextResponse.json({ ok: true, brand, programs: s.docs.map((d: any) => { const p = d.data() as any; return { id: d.id, name: p.name, totalHours: p.totalHours || null, description: p.description || null,
        tuitionCents: p.tuition ? p.tuition.tuitionCents + p.tuition.registrationFeeCents + p.tuition.kitCents : null, installments: p.tuition?.installments || 0 }; }) });
    }
    if (b.action === 'apply') {
      const name = String(b.name || '').trim().slice(0, 80), mail = String(b.email || '').trim().toLowerCase();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return NextResponse.json({ ok: false, error: 'Add your name and email.' }, { status: 400 });
      const p = ((await db.doc(`tenants/${tenantId}/programs/${String(b.programId || '')}`).get()).data() as any) || null;
      if (!p || p.status === 'archived') return NextResponse.json({ ok: false, error: 'Choose a program.' }, { status: 400 });
      const dupe = await db.collection(`tenants/${tenantId}/admissions`).where('email', '==', mail).limit(20).get();
      const open = dupe.docs.find((d: any) => (d.data() as any).programId === b.programId && !['declined', 'withdrawn'].includes((d.data() as any).stage));
      const at = new Date().toISOString();
      const wantsToApply = b.intent !== 'info';
      let id = open?.id;
      if (!id) {
        const ref = db.collection(`tenants/${tenantId}/admissions`).doc(); id = ref.id;
        await ref.set({ id, name, email: mail, phone: String(b.phone || '').slice(0, 30) || null, programId: b.programId, stage: wantsToApply ? 'applied' : 'inquiry', source: String(b.source || 'website').slice(0, 80),
          message: String(b.message || '').slice(0, 1000) || null, requiredDocs: p.requiredDocs?.length ? p.requiredDocs : DEFAULT_DOCS, documents: {}, notes: [], createdAt: at, updatedAt: at, history: [{ stage: wantsToApply ? 'applied' : 'inquiry', at, by: 'applicant' }] });
        await appendAudit(tenantId, { type: 'admissions.created', by: mail, summary: `${wantsToApply ? 'Application' : 'Inquiry'} from ${name} for ${p.name}`, data: { admissionId: id } });
      }
      if (wantsToApply) {
        const token = await issueApplicationLink(tenantId, id!);
        const link = `${origin}/learn/${tenantId}/application/${token}`;
        await sendEmail(mail, `Your application — ${brand.name}`, `Hi ${name.split(' ')[0]},

Thanks for applying to ${p.name}! Your private application page is here — upload your documents, read and sign your enrolment agreement, and make your down payment:

${link}

Keep this link private.

— ${brand.name}`);
        return NextResponse.json({ ok: true, applied: true, link });
      }
      return NextResponse.json({ ok: true, applied: false });
    }
    if (b.action?.startsWith?.('app-') || b.action === 'application') {
      const a = await admissionByToken(tenantId, String(b.appToken || ''));
      if (!a) return NextResponse.json({ ok: false, error: 'This application link isn’t valid — ask the school for a new one.' }, { status: 404 });
      const p = ((await db.doc(`tenants/${tenantId}/programs/${a.programId}`).get()).data() as any) || {};
      const tuition = p.tuition || { tuitionCents: 0, registrationFeeCents: 0, kitCents: 0, downPaymentCents: 0, installments: 0, interval: 'month' };
      const studentId = studentIdFor(a.email); const planId = `${a.programId}_${studentId}`;
      const agreementText = () => renderAgreement(p.agreementTemplate || '', { student: a.name, program: p.name || 'Program', school: brand.name, start: a.startDate ? new Date(a.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'to be confirmed', tuition, refund: p.refundPolicy || DEFAULT_REFUND, totalHours: p.totalHours || null });

      if (b.action === 'application') {
        const plan = ((await db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`).get()).data() as any) || null;
        const bal = plan ? await planBalance(tenantId, planId) : null;
        const docs = (a.requiredDocs || DEFAULT_DOCS).map((k: string) => ({ key: k, status: a.documents?.[k]?.status || 'missing', reason: a.documents?.[k]?.reason || null }));
        return NextResponse.json({ ok: true, brand, applicant: { name: a.name, email: a.email, stage: a.stage, startDate: a.startDate || null, waitlisted: !!a.waitlisted },
          program: { name: p.name, totalHours: p.totalHours || null, tuition }, docs,
          agreement: a.agreement?.signedAt ? { signed: true, signedAt: a.agreement.signedAt, signedName: a.agreement.signedName, text: a.agreement.text } : { signed: false, text: agreementText() },
          payment: plan ? { downPaymentCents: plan.downPaymentCents, paid: !!plan.downPaidAt, balanceCents: bal?.balanceCents ?? null, installmentCents: plan.installmentCents, installmentsTotal: plan.installmentsTotal, nextDueAt: plan.nextDueAt, autopay: !!plan.autopay } : null });
      }
      if (b.action === 'app-upload') {
        const key = String(b.docKey || ''); if (!(a.requiredDocs || DEFAULT_DOCS).includes(key)) return NextResponse.json({ ok: false, error: 'Unknown document.' }, { status: 400 });
        if (a.documents?.[key]?.status === 'verified') return NextResponse.json({ ok: false, error: 'That document is already verified.' }, { status: 400 });
        const safe = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        const f = await savePrivateDocument(tenantId, `tenants/${tenantId}/academy/admissions/${a.id}/${safe}-${Date.now()}`, String(b.file || ''));
        const docs = { ...(a.documents || {}), [key]: { ref: f.ref, sha256: f.sha256, type: f.type, at: new Date().toISOString(), status: 'submitted', reason: null } };
        const allIn = (a.requiredDocs || DEFAULT_DOCS).every((k: string) => docs[k]);
        await a.ref.set({ documents: docs, updatedAt: new Date().toISOString() }, { merge: true });
        await appendAudit(tenantId, { type: 'admissions.doc_uploaded', by: a.email, summary: `${a.name} uploaded ${key}`, data: { admissionId: a.id, sha256: f.sha256 } });
        if (allIn && ['inquiry', 'tour', 'applied'].includes(a.stage)) await setStage(tenantId, a.id, 'documents', 'applicant', 'All documents uploaded');
        return NextResponse.json({ ok: true });
      }
      if (b.action === 'app-sign') {
        if (a.agreement?.signedAt) return NextResponse.json({ ok: true, already: true });
        const missing = (a.requiredDocs || DEFAULT_DOCS).filter((k: string) => !a.documents?.[k]);
        if (missing.length) return NextResponse.json({ ok: false, error: `Upload ${missing.join(', ')} first.` }, { status: 400 });
        const typed = String(b.typedName || '').trim().replace(/\s+/g, ' ');
        if (!b.agree || typed.toLowerCase() !== String(a.name).trim().replace(/\s+/g, ' ').toLowerCase()) return NextResponse.json({ ok: false, error: `Type your full name exactly as “${a.name}” and tick the box to sign.` }, { status: 400 });
        const text = agreementText(); const signedAt = new Date().toISOString();
        const agreement = { text, sha256: sha256hex(text), signedName: typed, signedAt, ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null, userAgent: String(req.headers.get('user-agent') || '').slice(0, 240) };
        await a.ref.set({ agreement, updatedAt: signedAt }, { merge: true });
        await appendAudit(tenantId, { type: 'admissions.signed', by: a.email, summary: `${a.name} signed the enrolment agreement for ${p.name}`, data: { admissionId: a.id, sha256: agreement.sha256 } });
        await setStage(tenantId, a.id, 'agreement', 'applicant', 'Agreement signed');
        await createTuitionPlan({ tenantId, programId: a.programId, studentId, email: a.email, name: a.name, admissionId: a.id, tuition, by: 'applicant' });
        return NextResponse.json({ ok: true });
      }
      if (b.action === 'app-pay') {
        const plan = ((await db.doc(`tenants/${tenantId}/tuitionPlans/${planId}`).get()).data() as any) || null;
        if (!plan) return NextResponse.json({ ok: false, error: 'Sign your agreement first.' }, { status: 400 });
        if (plan.downPaidAt) return NextResponse.json({ ok: false, error: 'Already paid — thank you!' }, { status: 400 });
        if (!t.stripeAccountId) return NextResponse.json({ ok: false, error: 'The school can’t take payments online yet — contact them.' }, { status: 400 });
        const session = await stripe().checkout.sessions.create({
          mode: 'payment', customer_email: a.email, customer_creation: 'always', payment_method_types: ['card'],
          line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: plan.downPaymentCents, product_data: { name: `${p.name} — ${plan.installmentsTotal ? 'down payment' : 'tuition'}`, description: plan.installmentsTotal ? `Your card is saved for ${plan.installmentsTotal} automatic instalments.` : undefined } } }],
          payment_intent_data: { ...(plan.installmentsTotal ? { setup_future_usage: 'off_session' } : {}), metadata: { type: 'academy_tuition', planId, admissionId: a.id } },
          metadata: { type: 'academy_tuition', planId, admissionId: a.id },
          success_url: `${origin}/learn/${tenantId}/application/${String(b.appToken)}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/learn/${tenantId}/application/${String(b.appToken)}`,
        } as any, { stripeAccount: t.stripeAccountId });
        return NextResponse.json({ ok: true, url: session.url });
      }
      if (b.action === 'app-confirm') {
        const s = await stripe().checkout.sessions.retrieve(String(b.sessionId || ''), {}, { stripeAccount: t.stripeAccountId });
        if (s.metadata?.planId !== planId) return NextResponse.json({ ok: false, error: 'That payment isn’t for this application.' }, { status: 400 });
        const r = await completeDownPayment(tenantId, s);
        return NextResponse.json({ ok: !!r, pending: !r });
      }
    }

    // ── Student portal ──
    if (['portal', 'set-language', 'translate', 'lesson-translate', 'hours', 'tuition', 'tuition-pay', 'tuition-confirm', 'card-update', 'card-confirm', 'documents'].includes(b.action)) {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in first.', needsSignIn: true }, { status: 401 });
      const T = `tenants/${tenantId}`;
      const sDoc = ((await db.doc(`${T}/students/${student.id}`).get()).data() as any) || {};
      const lang = LANGUAGES[sDoc.language] ? sDoc.language : 'en';
      const myPath = `/learn/${tenantId}/my`;

      if (b.action === 'set-language') {
        const l = LANGUAGES[b.lang] ? b.lang : 'en';
        await db.doc(`${T}/students/${student.id}`).set({ language: l }, { merge: true });
        return NextResponse.json({ ok: true, lang: l });
      }
      if (b.action === 'translate') {
        const l = LANGUAGES[b.lang] ? b.lang : lang;
        const texts = (Array.isArray(b.texts) ? b.texts : []).map((x: any) => String(x ?? '').slice(0, 4000)).slice(0, 80);
        if (l === 'en') return NextResponse.json({ ok: true, texts });
        return NextResponse.json({ ok: true, texts: await translateTexts(tenantId, texts, l) });
      }
      if (b.action === 'lesson-translate') {
        if (lang === 'en') return NextResponse.json({ ok: false, error: 'Choose your language first.' }, { status: 400 });
        const courseId = String(b.courseId || ''), lessonId = String(b.lessonId || '');
        if (!(await db.doc(`${T}/enrollments/${courseId}_${student.id}`).get()).exists) return NextResponse.json({ ok: false, error: 'Not enrolled.' }, { status: 403 });
        const l = ((await db.doc(`${T}/courses/${courseId}/lessons/${lessonId}`).get()).data() as any) || {};
        const short: string[] = [l.title || '', ...(l.quiz?.questions || []).flatMap((q: any) => [q.q, ...(q.options || [])]), ...(l.flashcards || []).flatMap((f: any) => [f.front, f.back]),
          ...(l.activity ? [l.activity.prompt || '', ...(l.activity.pairs || []).flatMap((p: any) => [p.left, p.right]), ...(l.activity.steps || []), ...(l.activity.points || []).map((p: any) => p.label), ...(l.activity.options || []).flatMap((o: any) => [o.text, o.feedback])] : [])];
        const [tShort, body, transcript] = await Promise.all([translateTexts(tenantId, short, lang), l.body ? translateLong(tenantId, l.body, lang) : Promise.resolve(''), l.transcript ? translateLong(tenantId, l.transcript, lang) : Promise.resolve('')]);
        let i = 0; const nx = () => tShort[i++];
        const title = nx();
        const quiz = l.quiz?.questions?.length ? { questions: l.quiz.questions.map((q: any) => ({ q: nx(), options: (q.options || []).map(() => nx()) })) } : null;
        const flashcards = (l.flashcards || []).map(() => ({ front: nx(), back: nx() }));
        let activity: any = null;
        if (l.activity) { activity = { ...l.activity, prompt: nx() };
          if (l.activity.pairs) activity.pairs = l.activity.pairs.map(() => ({ left: nx(), right: nx() }));
          if (l.activity.steps) activity.steps = l.activity.steps.map(() => nx());
          if (l.activity.points) activity.points = l.activity.points.map((p: any) => ({ ...p, label: nx() }));
          if (l.activity.options) activity.options = l.activity.options.map((o: any) => ({ ...o, text: nx(), feedback: nx() })); }
        return NextResponse.json({ ok: true, lang, title, body, transcript, quiz, flashcards, activity });
      }

      const [pe, ce, thread] = await Promise.all([
        db.collection(`${T}/programEnrollments`).where('studentId', '==', student.id).limit(10).get(),
        db.collection(`${T}/enrollments`).where('studentId', '==', student.id).limit(100).get(),
        db.doc(`${T}/academyThreads/${student.id}`).get(),
      ]);
      const progEnr = pe.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
      const plans: any[] = [];
      for (const e of progEnr) { const pd = await db.doc(`${T}/tuitionPlans/${e.id}`).get(); if (pd.exists) { const p = pd.data() as any; const bal = await planBalance(tenantId, pd.id); plans.push({ id: pd.id, p, bal }); } }

      if (b.action === 'portal') {
        const today = new Date(); const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][today.getDay()];
        const monday = new Date(today); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        const [open, rota, anns, adm] = await Promise.all([
          db.collection(`${T}/attendance`).where('studentId', '==', student.id).where('status', '==', 'open').limit(1).get(),
          db.doc(`${T}/rotations/${monday.toISOString().slice(0, 10)}`).get(),
          db.collection(`${T}/academyAnnouncements`).orderBy('at', 'desc').limit(10).get(),
          db.collection(`${T}/admissions`).where('email', '==', student.email).limit(5).get(),
        ]);
        const progIds = new Set(progEnr.map((e: any) => e.programId));
        const cohortIds = new Set(adm.docs.map((d: any) => (d.data() as any).cohortId).filter(Boolean));
        // Today's duty + clinic clients (first names only).
        const r = rota.exists ? (rota.data() as any) : null;
        const duty = r?.published ? Object.entries(r.assignments?.[dayKey] || {}).filter(([, ids]: any) => (ids || []).includes(student.id)).map(([st]) => st) : [];
        const week = r?.published ? (r.days || []).map((dk: string) => ({ day: dk, stations: Object.entries(r.assignments?.[dk] || {}).filter(([, ids]: any) => (ids || []).includes(student.id)).map(([st]) => st) })) : [];
        const clinic: any[] = [];
        for (const e of progEnr.filter((x: any) => x.staffId && x.status === 'active')) {
          const ap = await db.collection(`${T}/appointments`).where('staffId', '==', e.staffId).limit(1500).get();
          const from = new Date(today); from.setHours(0, 0, 0, 0); const to = new Date(from.getTime() + 86400000);
          for (const d of ap.docs) { const a = d.data() as any; const at = new Date(a.startTime).getTime(); if (at >= from.getTime() && at < to.getTime() && !['cancelled', 'declined', 'no_show'].includes(a.status)) clinic.push({ time: a.startTime, service: a.serviceName || 'Service', client: String(a.clientName || 'Client').split(' ')[0], signedOff: !!a.clinicCheckoff?.signedOff }); }
        }
        clinic.sort((x, y) => String(x.time).localeCompare(String(y.time)));
        // Continue learning: most recent course activity.
        const courses = ce.docs.map((d: any) => d.data() as any).sort((x: any, y: any) => String(y.lastActiveAt || y.createdAt).localeCompare(String(x.lastActiveAt || x.createdAt)));
        let next: any = null;
        for (const c of courses.slice(0, 3)) { const cd = ((await db.doc(`${T}/courses/${c.courseId}`).get()).data() as any) || null; if (!cd) continue; const done = Object.keys(c.progress || {}).length; if (done >= (cd.lessonCount || 0)) continue;
          next = { title: cd.title, slug: cd.slug, lessonId: c.lastLessonId || null, done, total: cd.lessonCount || 0 }; break; }
        const needs = adm.docs.flatMap((d: any) => { const a = d.data() as any; return Object.entries(a.documents || {}).filter(([, v]: any) => v.status === 'rejected').map(([k, v]: any) => ({ doc: k, reason: v.reason })); });
        const programs = []; for (const e of progEnr) { const pr = await programProgress(tenantId, e.id); if (pr) programs.push({ id: e.id, name: pr.program.name, status: pr.enrollment.status, hours: pr.hours, totalHours: pr.program.totalHours, requirements: pr.requirements, sap: (e.sap || []).slice(-1)[0] || null, risk: null }); }
        return NextResponse.json({ ok: true, brand, lang, languages: LANGUAGES, student: { name: student.name, email: student.email },
          clock: open.empty ? null : { since: (open.docs[0].data() as any).clockInAt }, duty, week, clinic, next, needs, programs,
          tuition: plans.map((x: any) => ({ id: x.id, status: x.p.status, balanceCents: x.bal.balanceCents, nextDueAt: x.p.nextDueAt || null, installmentCents: x.p.installmentCents, autopay: !!x.p.autopay, lastError: x.p.status === 'past_due' ? (x.p.lastError || 'Payment failed') : null })),
          announcements: anns.docs.map((d: any) => d.data() as any).filter((a: any) => (!a.programId || progIds.has(a.programId)) && (!a.cohortId || cohortIds.has(a.cohortId))).slice(0, 3).map((a: any) => ({ title: a.title, body: a.body, at: a.at })),
          unread: ((thread.data() as any) || {}).unreadStudent || 0, isSchool: progEnr.length > 0 });
      }

      if (b.action === 'hours') {
        const [att, sess, live] = await Promise.all([
          db.collection(`${T}/attendance`).where('studentId', '==', student.id).limit(3000).get(),
          db.collection(`${T}/learningSessions`).where('studentId', '==', student.id).limit(3000).get(),
          db.collection(`${T}/liveAttendance`).where('studentId', '==', student.id).limit(1000).get(),
        ]);
        const punches = att.docs.map((d: any) => d.data() as any).sort((x: any, y: any) => String(y.clockInAt).localeCompare(String(x.clockInAt))).slice(0, 60).map((p: any) => ({ in: p.clockInAt, out: p.clockOutAt, minutes: p.minutes || 0, status: p.status, corrected: (p.corrections || []).length > 0 }));
        // Online time by week (last 12 weeks).
        const weeks: Record<string, number> = {};
        for (const d of sess.docs) { const s = d.data() as any; const dt = new Date(s.startedAt); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); const k = dt.toISOString().slice(0, 10); weeks[k] = (weeks[k] || 0) + (s.engagedSec || 0) / 60; }
        const programs = []; for (const e of progEnr) { const pr = await programProgress(tenantId, e.id); if (pr) programs.push({ name: pr.program.name, hours: pr.hours, totalHours: pr.program.totalHours, requirements: pr.requirements, sap: e.sap || [] }); }
        return NextResponse.json({ ok: true, programs, punches, onlineByWeek: Object.entries(weeks).sort().slice(-12).map(([w, m]) => ({ week: w, minutes: Math.round(m) })),
          live: live.docs.map((d: any) => d.data() as any).sort((x: any, y: any) => String(y.joinedAt).localeCompare(String(x.joinedAt))).slice(0, 20).map((x: any) => ({ title: x.title, at: x.joinedAt, minutes: x.minutes })) });
      }

      if (b.action === 'tuition') {
        return NextResponse.json({ ok: true, plans: plans.map((x: any) => ({ id: x.id, name: x.p.name, status: x.p.status, totalCents: x.p.totalCents, paidCents: x.bal.paidCents, balanceCents: x.bal.balanceCents,
          installmentsPaid: x.p.installmentsPaid || 0, installmentsTotal: x.p.installmentsTotal || 0, installmentCents: x.p.installmentCents, nextDueAt: x.p.nextDueAt || null, autopay: !!x.p.autopay, hasCard: !!x.p.paymentMethodId, lastError: x.p.status === 'past_due' ? (x.p.lastError || 'Payment failed') : null,
          upcoming: upcomingPayments(x.p, x.bal.balanceCents), history: x.bal.entries.slice().reverse().map((e: any) => ({ at: e.at, type: e.type, amountCents: e.amountCents, desc: e.desc })) })) });
      }
      const mine = (id: string) => plans.find((x: any) => x.id === id);
      if (b.action === 'tuition-pay' || b.action === 'card-update') {
        if (!mine(String(b.planId))) return NextResponse.json({ ok: false, error: 'Plan not found.' }, { status: 404 });
        if (!t.stripeAccountId) return NextResponse.json({ ok: false, error: 'Online payments aren’t set up — contact the school.' }, { status: 400 });
        const url = b.action === 'tuition-pay'
          ? await studentPaySession({ tenantId, stripeAccountId: t.stripeAccountId, planId: String(b.planId), what: b.what === 'balance' ? 'balance' : 'next', origin, returnPath: `${myPath}?tab=tuition` })
          : await cardUpdateSession({ tenantId, stripeAccountId: t.stripeAccountId, planId: String(b.planId), origin, returnPath: `${myPath}?tab=tuition` });
        return NextResponse.json({ ok: true, url });
      }
      if (b.action === 'tuition-confirm' || b.action === 'card-confirm') {
        const s = await stripe().checkout.sessions.retrieve(String(b.sessionId || ''), {}, { stripeAccount: t.stripeAccountId });
        if (!mine(String(s.metadata?.planId))) return NextResponse.json({ ok: false, error: 'Not your payment.' }, { status: 403 });
        const r = b.action === 'tuition-confirm' ? await completeStudentPayment(tenantId, s) : await completeCardUpdate(tenantId, t.stripeAccountId, s);
        return NextResponse.json({ ok: !!r, ...(r || {}) });
      }

      if (b.action === 'documents') {
        const [adm, letters] = await Promise.all([db.collection(`${T}/admissions`).where('email', '==', student.email).limit(5).get(),
          db.collection('platformDocuments').where('tenantId', '==', tenantId).where('email', '==', student.email).limit(50).get()]);
        const agreements = adm.docs.map((d: any) => d.data() as any).filter((a: any) => a.agreement?.signedAt).map((a: any) => ({ signedAt: a.agreement.signedAt, signedName: a.agreement.signedName, text: a.agreement.text, countersignedBy: a.agreement.countersignedBy || null }));
        const uploads = adm.docs.flatMap((d: any) => Object.entries((d.data() as any).documents || {}).map(([k, v]: any) => ({ doc: k, status: v.status, reason: v.reason || null, at: v.at })));
        const certs = ce.docs.map((d: any) => d.data() as any).filter((e: any) => e.certificateCode).map((e: any) => ({ code: e.certificateCode, at: e.completedAt, courseId: e.courseId }));
        for (const c of certs) (c as any).title = (((await db.doc(`${T}/courses/${c.courseId}`).get()).data() as any) || {}).title || 'Course';
        return NextResponse.json({ ok: true, agreements, uploads, certificates: certs, letters: letters.docs.map((d: any) => { const x = d.data() as any; return { code: x.code, at: x.issuedAt, program: x.programName, hours: x.hours?.total }; }) });
      }
    }

    // ── AI tutor: answers only from this course's lessons ──
    if (b.action === 'tutor') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in to ask the tutor.' }, { status: 401 });
      const courseId = String(b.courseId || ''); const question = String(b.question || '').trim().slice(0, 600);
      if (!question) return NextResponse.json({ ok: false, error: 'Ask a question.' }, { status: 400 });
      if (!(await db.doc(`tenants/${tenantId}/enrollments/${courseId}_${student.id}`).get()).exists) return NextResponse.json({ ok: false, error: 'Enrol to use the tutor.' }, { status: 403 });
      const c = ((await db.doc(`tenants/${tenantId}/courses/${courseId}`).get()).data() as any) || {};
      if (c.aiTutor === false || !aiConfigured()) return NextResponse.json({ ok: false, error: 'The tutor isn’t available for this course.' }, { status: 400 });
      const day = new Date().toISOString().slice(0, 10);
      const uRef = db.doc(`tenants/${tenantId}/tutorUsage/${student.id}_${day}`);
      const used = (((await uRef.get()).data() as any)?.n) || 0;
      if (used >= 30) return NextResponse.json({ ok: false, error: 'You’ve asked 30 questions today — ask your instructor, or try again tomorrow.' }, { status: 429 });
      const lessons = await loadLessons(tenantId, courseId);
      const cur = lessons.find((l: any) => l.id === b.lessonId);
      const ordered = cur ? [cur, ...lessons.filter((l: any) => l.id !== cur.id)] : lessons;
      let material = ''; for (const l of ordered) { const chunk = `\n### Lesson: ${l.title}\n${String(l.body || '').trim()}${l.transcript ? `\n[Video transcript]\n${String(l.transcript).slice(0, 8000)}` : ''}${!l.body && !l.transcript ? '(video lesson — no notes or transcript yet)' : ''}\n`; if (material.length + chunk.length > 24000) break; material += chunk; }
      const r = await askClaude({ tier: 'fast', maxTokens: 700, purpose: 'academy-tutor', tenantId,
        system: `You are the study tutor for the course "${c.title}" at ${brand.name}. Answer ONLY from the course material below. If the material doesn't cover the question, say so plainly and suggest asking their instructor (they can message the school from "My courses") — do not answer from general knowledge. Never diagnose or give medical advice; for anything about a client's health, infection or contraindications, tell them to follow the course's rules and check with their instructor. Keep answers short and clear for a student, and end with the lesson(s) you used, like: (From: Lesson title).\n\nCOURSE MATERIAL:${material}`,
        prompt: question });
      if (!r.ok) return NextResponse.json({ ok: false, error: 'The tutor is busy — try again in a moment.' }, { status: 502 });
      await uRef.set({ n: used + 1, at: new Date().toISOString() }, { merge: true });
      await db.collection(`tenants/${tenantId}/tutorLogs`).add({ courseId, lessonId: b.lessonId || null, studentId: student.id, email: student.email, question, answer: r.text.slice(0, 4000), at: new Date().toISOString() });
      return NextResponse.json({ ok: true, answer: r.text, left: 29 - used });
    }

    // ── Live class (students) ──
    if (b.action === 'live-find' || b.action === 'live-state' || b.action === 'live-answer') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in to join the class.', needsSignIn: true }, { status: 401 });
      if (b.action === 'live-find') { const s = await findLive(tenantId, String(b.code || '')); return s ? NextResponse.json({ ok: true, sessionId: s.id, title: s.title }) : NextResponse.json({ ok: false, error: 'No live class with that code — check the screen.' }, { status: 404 }); }
      if (b.action === 'live-answer') { try { await studentAnswer(tenantId, String(b.sessionId || ''), student.id, String(b.questionId || ''), Number(b.choice)); return NextResponse.json({ ok: true }); } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); } }
      const st = await studentBeat(tenantId, String(b.sessionId || ''), student, !!b.visible);
      return st ? NextResponse.json({ ok: true, ...st, brand }) : NextResponse.json({ ok: false, error: 'Class not found.' }, { status: 404 });
    }

    // ── Messages & announcements (students) ──
    if (b.action === 'inbox' || b.action === 'message') {
      if (!student) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
      const ref = db.doc(`tenants/${tenantId}/academyThreads/${student.id}`);
      if (b.action === 'message') {
        const stLang = (((await db.doc(`tenants/${tenantId}/students/${student.id}`).get()).data() as any) || {}).language;
        const inEnglish = stLang && stLang !== 'en' ? (await translateTexts(tenantId, [String(b.text)], 'en'))[0] : null;
        await postMessage({ tenantId, studentId: student.id, from: 'student', by: student.email, text: b.text, studentEmail: student.email, studentName: student.name, translated: inEnglish, lang: stLang || null });
        try { const { getAdminAuth } = await import('@/lib/firebase-admin'); const owner = t.userId ? (await getAdminAuth().getUser(t.userId)).email : null; if (owner) await sendJourneyEmail(owner, `Message from ${student.name || student.email}`, `${String(b.text).slice(0, 1500)}\n\nReply in ClarityFlow → Academy → Students → Messages.`); } catch { /* no owner email */ }
        return NextResponse.json({ ok: true });
      }
      const [m, anns, pe] = await Promise.all([ref.collection('messages').orderBy('at').limit(300).get(), db.collection(`tenants/${tenantId}/academyAnnouncements`).orderBy('at', 'desc').limit(30).get(),
        db.collection(`tenants/${tenantId}/programEnrollments`).where('studentId', '==', student.id).limit(10).get()]);
      const progIds = new Set(pe.docs.map((d: any) => (d.data() as any).programId));
      const adm = await db.collection(`tenants/${tenantId}/admissions`).where('email', '==', student.email).limit(10).get();
      const cohortIds = new Set(adm.docs.map((d: any) => (d.data() as any).cohortId).filter(Boolean));
      await ref.set({ unreadStudent: 0 }, { merge: true });
      return NextResponse.json({ ok: true, messages: m.docs.map((d: any) => d.data()),
        announcements: anns.docs.map((d: any) => d.data() as any).filter((a: any) => (!a.programId || progIds.has(a.programId)) && (!a.cohortId || cohortIds.has(a.cohortId))) });
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
      if (b.action === 'attend-status') return NextResponse.json({ ok: true, student: { email: student.email, name: student.name }, requirePhoto: !!t.academy?.requirePhoto, requireGeo: !!t.academy?.requireGeo, open: open.empty ? null : { id: open.docs[0].id, clockInAt: (open.docs[0].data() as any).clockInAt } });
      if (!qrValid(tenantId, String(b.code || ''), Number(b.w))) return NextResponse.json({ ok: false, error: 'That code has expired — scan the screen again.' }, { status: 400 });
      const cfg = t.academy || {};
      const geo = b.geo && Number.isFinite(Number(b.geo.lat)) ? { lat: Number(b.geo.lat), lng: Number(b.geo.lng), accuracy: Number(b.geo.accuracy) || null } : null;
      let distance: number | null = null;
      if (cfg.geo?.lat != null && geo) distance = Math.round(metersBetween(cfg.geo, geo));
      if (cfg.requireGeo) {
        if (!geo) return NextResponse.json({ ok: false, error: 'Allow location to clock in — the academy requires it.', needsGeo: true }, { status: 400 });
        if (distance != null && distance > (cfg.geo?.radiusM || 150) + Math.min(100, geo.accuracy || 0)) return NextResponse.json({ ok: false, error: `You appear to be ${distance} m from the academy. Clock in on site.` }, { status: 400 });
      }
      if (cfg.requirePhoto && !b.photo) return NextResponse.json({ ok: false, error: 'Take a photo to clock in — the academy requires it.', needsPhoto: true }, { status: 400 });
      const at = new Date().toISOString();
      const meta: any = { ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null, userAgent: String(req.headers.get('user-agent') || '').slice(0, 240), geo, distanceM: distance, photo: null };
      const attRef = b.direction === 'in' ? db.collection(`tenants/${tenantId}/attendance`).doc() : (open.empty ? null : open.docs[0].ref);
      if (b.photo && attRef) {
        try { meta.photo = { ...(await savePrivateImage(tenantId, `tenants/${tenantId}/academy/attendance/${attRef.id}-${b.direction === 'in' ? 'in' : 'out'}.jpg`, String(b.photo))), live: !!b.photoLive, at }; }
        catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || 'Photo upload failed — try again.') }, { status: 400 }); }
        // The first photo on file becomes the student's reference photo.
        const sRef = db.doc(`tenants/${tenantId}/students/${student.id}`);
        if (!(((await sRef.get()).data() as any) || {}).referencePhoto) await sRef.set({ referencePhoto: { ref: meta.photo.ref, sha256: meta.photo.sha256, at } }, { merge: true });
      }
      if (b.direction === 'in') {
        if (!open.empty) return NextResponse.json({ ok: false, error: `You’re already clocked in since ${new Date((open.docs[0].data() as any).clockInAt).toLocaleTimeString()}.` }, { status: 400 });
        const ref = attRef!;
        await ref.set({ id: ref.id, studentId: student.id, email: student.email, name: student.name || null, courseId: b.courseId || null, clockInAt: at, clockOutAt: null, minutes: 0, status: 'open', in: meta, out: null, corrections: [] });
        await appendAudit(tenantId, { type: 'attendance.in', studentId: student.id, by: student.email, summary: `Clocked in${distance != null ? ` (${distance} m from academy)` : ''}${meta.photo ? ' with photo' : ''}`, data: { attendanceId: ref.id, at, photoSha256: meta.photo?.sha256 || null } });
        return NextResponse.json({ ok: true, direction: 'in', at });
      }
      if (open.empty) return NextResponse.json({ ok: false, error: 'You’re not clocked in.' }, { status: 400 });
      const p = open.docs[0].data() as any;
      const minutes = Math.max(0, Math.floor((Date.now() - new Date(p.clockInAt).getTime()) / 60000));
      await open.docs[0].ref.set({ clockOutAt: at, minutes, status: cfg.requireApproval ? 'pending' : 'closed', out: meta }, { merge: true });
      await appendAudit(tenantId, { type: 'attendance.out', studentId: student.id, by: student.email, summary: `Clocked out — ${Math.floor(minutes / 60)}h ${minutes % 60}m${cfg.requireApproval ? ' (awaiting instructor approval)' : ''}${meta.photo ? ' with photo' : ''}`, data: { attendanceId: open.docs[0].id, at, minutes, photoSha256: meta.photo?.sha256 || null } });
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
