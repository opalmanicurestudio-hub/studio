// src/app/api/school/route.ts
//
// THE SCHOOL WEBSITE'S PUBLIC ACTIONS (no sign-in):
//   tour-slots  { tenantId, date }            open tour times — the business's ONE
//                                             tour calendar (shared with booth tours)
//   tour-book   { tenantId, date, time, name, email, phone, programId?, message?, language? }
//                                             → tours/{id} (purpose 'school', same
//                                             record + manage link as booth tours)
//                                             → Admissions (stage 'tour')
//   inquiry     { tenantId, topic, name, email?, phone?, programId?, contactBy, bestTime?, message?, language? }
//                                             admissions / funding / scholarship → Admissions
//                                             donate / sponsor / general → the website inbox
// Every visitor gets an instant confirmation; the school gets an alert.

import { donationSession, completeDonation, scholarshipApply } from '@/lib/academy-funding';
import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { tourSlots, tourRules, getSettings } from '@/lib/school-site';
import { getIdentity } from '@/lib/school-identity';
import { appendAudit } from '@/lib/academy-compliance';
import { DEFAULT_DOCS } from '@/lib/academy-admissions';
import { brandedEmailHtml } from '@/lib/email-template';
import { sendNotification } from '@/lib/notify';
import { LANGUAGES } from '@/lib/translate';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
const TOPICS: Record<string, string> = { admissions: 'Programs & admissions', tour: 'Tour', funding: 'Help finding funding', scholarship: 'Scholarships', donate: 'Giving to students', sponsor: 'Business sponsorship', general: 'General question' };
const ADMISSIONS_TOPICS = ['admissions', 'funding', 'scholarship'];
const clean = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const niceDate = (date: string, time: string) => new Date(`${date}T${time}:00`).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** An admissions record for this person + program — reused if one is open. */
async function upsertAdmission(tenantId: string, v: { name: string; email: string; phone: string; programId: string; language: string; stage: 'inquiry' | 'tour'; source: string; note: string; extra?: any }) {
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const now = new Date().toISOString();
  const p = v.programId ? (((await db.doc(`${T}/programs/${v.programId}`).get()).data() as any) || null) : null;
  const programId = p ? v.programId : ((await db.collection(`${T}/programs`).limit(1).get()).docs[0]?.id || '');
  const mine = v.email ? (await db.collection(`${T}/admissions`).where('email', '==', v.email).limit(20).get()).docs : [];
  const open = mine.find((d: any) => { const a = d.data() as any; return (!programId || a.programId === programId) && !['declined', 'withdrawn', 'enrolled'].includes(a.stage); });
  if (open) {
    const a = open.data() as any;
    const move = v.stage === 'tour' && a.stage === 'inquiry';
    await open.ref.set({ ...(v.extra || {}), notes: [...(a.notes || []), { at: now, by: 'website', text: v.note }], updatedAt: now, ...(move ? { stage: 'tour', history: [...(a.history || []), { stage: 'tour', at: now, by: 'website', note: 'Booked a tour' }] } : {}) }, { merge: true });
    return { id: open.id, created: false };
  }
  const ref = db.collection(`${T}/admissions`).doc();
  const pp = programId ? (((await db.doc(`${T}/programs/${programId}`).get()).data() as any) || {}) : {};
  await ref.set({ id: ref.id, name: v.name, email: v.email || null, phone: v.phone || null, language: v.language, programId, stage: v.stage, source: v.source,
    requiredDocs: pp.requiredDocs?.length ? pp.requiredDocs : DEFAULT_DOCS, documents: {}, notes: [{ at: now, by: 'website', text: v.note }], createdAt: now, updatedAt: now,
    history: [{ stage: v.stage, at: now, by: 'website' }], ...(v.extra || {}) });
  await appendAudit(tenantId, { type: 'admissions.created', by: v.email || v.phone || 'website', summary: `${v.stage === 'tour' ? 'Tour booked' : 'Inquiry'} from ${v.name} (website)`, data: { admissionId: ref.id } });
  return { id: ref.id, created: true };
}

async function alertSchool(tenantId: string, t: any, subject: string, lines: string[], link: string) {
  const db = getAdminDb(); const id = await getIdentity(tenantId, t).catch(() => null);
  const to = t.notificationEmail || id?.email || t.email; if (!to) return;
  const html = brandedEmailHtml({ studioName: id?.displayName || t.name || 'Your school', title: subject, bodyLines: lines, cta: { label: 'Open in ClarityFlow', url: link } });
  await sendNotification(db, { tenantId, channel: 'email', to, subject, html, kind: 'school_website_alert', recipientType: 'other', recipientId: tenantId, recipientName: null }).catch(() => null);
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = clean(b.tenantId, 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Unknown school.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const t = ((await db.doc(T).get()).data() as any) || null;
  if (!t || t.modules?.academy === false) return NextResponse.json({ ok: false, error: 'Unknown school.' }, { status: 404 });
  const origin = linkOrigin(t, req.nextUrl.origin);
  const school = (await getIdentity(tenantId, t).catch(() => null))?.displayName || t.name || 'Our school';
  // Bots: a hidden field real people never fill, and a minimum time on the form.
  if (['tour-book', 'inquiry', 'scholarship-apply', 'donate'].includes(b.action) && (b.website || (Number(b.elapsedMs) > 0 && Number(b.elapsedMs) < 2500))) return NextResponse.json({ ok: true });

  try {
    // ── Gifts (school's own Stripe account) and scholarship applications ──
    if (b.action === 'donate') {
      const s = await getSettings(tenantId); if (!s.donors.enabled) return NextResponse.json({ ok: false, error: 'Online giving isn’t open.' }, { status: 400 });
      const email = clean(b.email, 120).toLowerCase(); const name = clean(b.name, 80);
      if (!name || !okEmail(email)) return NextResponse.json({ ok: false, error: 'Add your name and email for your receipt.' }, { status: 400 });
      try { const url = await donationSession(tenantId, { amountCents: Math.round(Number(b.amountCents) || 0), fund: clean(b.fund, 100), name, email, anonymous: !!b.anonymous, business: !!b.business, businessName: clean(b.businessName, 100), showName: !!b.showName && !b.anonymous, message: clean(b.message, 450) }, origin); return NextResponse.json({ ok: true, url }); }
      catch (e: any) { return NextResponse.json({ ok: false, error: e?.message || 'Couldn’t start the payment.' }, { status: 400 }); }
    }
    if (b.action === 'donate-confirm') {
      if (!t.stripeAccountId || !/^cs_[A-Za-z0-9_]+$/.test(String(b.sessionId || ''))) return NextResponse.json({ ok: false }, { status: 400 });
      const session = await new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any }).checkout.sessions.retrieve(String(b.sessionId), {}, { stripeAccount: t.stripeAccountId });
      if (session.metadata?.type !== 'academy_donation') return NextResponse.json({ ok: false }, { status: 400 });
      if (session.payment_status !== 'paid') return NextResponse.json({ ok: false, pending: true });
      await completeDonation(tenantId, session);
      const g = ((await db.doc(`${T}/donations/${session.id}`).get()).data() as any) || {};
      return NextResponse.json({ ok: true, amountCents: g.amountCents, fund: g.fund, receiptNo: g.receiptNo, emailed: !!g.receiptSent });
    }
    if (b.action === 'scholarship-apply') {
      try { await scholarshipApply(tenantId, { scholarship: clean(b.scholarship, 100), name: clean(b.name, 80), email: clean(b.email, 120).toLowerCase(), phone: clean(b.phone, 30), programId: clean(b.programId, 40), why: clean(b.why, 3000), need: clean(b.need, 3000), goals: clean(b.goals, 3000) }); return NextResponse.json({ ok: true }); }
      catch (e: any) { return NextResponse.json({ ok: false, error: e?.message || 'Couldn’t send your application.' }, { status: 400 }); }
    }

    if (b.action === 'tour-slots') return NextResponse.json({ ok: true, ...(await tourSlots(tenantId, clean(b.date, 10))) });

    if (b.action === 'tour-book') {
      const date = clean(b.date, 10), time = clean(b.time, 5), name = clean(b.name, 80), email = clean(b.email, 120).toLowerCase(), phone = clean(b.phone, 30);
      if (!date || !time || !name || !(okEmail(email) || phone)) return NextResponse.json({ ok: false, error: 'Add your name, a way to reach you, and pick a time.' }, { status: 400 });
      const open = await tourSlots(tenantId, date);
      if (!open.slots.includes(time)) return NextResponse.json({ ok: false, error: 'That time was just taken — please pick another.' }, { status: 409 });
      const r = await tourRules(tenantId); const status = r.tourAutoConfirm !== false ? 'confirmed' : 'requested';
      const programId = clean(b.programId, 40); const language = LANGUAGES[b.language] ? b.language : 'en';
      const tourRef = db.collection(`${T}/tours`).doc(); const now = new Date().toISOString();
      const manageToken = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, '');
      const adm = await upsertAdmission(tenantId, { name, email, phone, programId, language, stage: 'tour', source: 'website — tour', note: `Tour ${status === 'confirmed' ? 'booked' : 'requested'} for ${niceDate(date, time)}${b.message ? ` — “${clean(b.message, 300)}”` : ''}`, extra: { tour: { tourId: tourRef.id, date, time, status } } });
      await tourRef.set({ id: tourRef.id, date, time, durationMins: r.tourDurationMins || 30, name, phone, email, message: clean(b.message, 500), status, createdAt: now, tenantId, manageToken,
        purpose: 'school', programId: programId || null, admissionId: adm.id, tourStartIso: `${date}T${time}:00` });
      const nRef = db.collection(`${T}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'school_tour', read: false, createdAt: now, link: '/academy?section=admissions', message: `🎓 School tour ${status === 'confirmed' ? 'booked' : 'requested'}: ${name} — ${date} at ${time}${status === 'requested' ? ' (needs your OK)' : ''}` });
      let emailed = false;
      if (okEmail(email)) {
        const confirmed = status === 'confirmed';
        const html = brandedEmailHtml({ studioName: school, title: confirmed ? 'Your tour is booked' : 'Tour request received',
          bodyLines: [`Hi ${name.split(' ')[0]} — ${confirmed ? `you’re set for ${niceDate(date, time)}.` : `we got your request for ${niceDate(date, time)} and will confirm shortly.`}`,
            `The tour takes about ${r.tourDurationMins || 30} minutes: you’ll see the classroom and student clinic, meet an instructor, and can ask anything about programs, costs and funding.`,
            confirmed ? 'If the time stops working, you can move or cancel it yourself with the button below.' : 'If the time stops working, just reply to this email.'],
          ...(confirmed ? { cta: { label: 'Change or cancel my visit', url: `${origin}/tour-manage/${tenantId}/${tourRef.id}/${manageToken}` } } : {}),
          footerNote: `Sent by ${school} because you booked a tour on our website.` });
        const sent = await sendNotification(db, { tenantId, channel: 'email', to: email, subject: confirmed ? `Tour booked — ${niceDate(date, time)}` : `Tour request received — ${niceDate(date, time)}`, html, kind: 'tour_confirmation', recipientType: 'contact', recipientId: tourRef.id, recipientName: name }).catch(() => null);
        emailed = sent?.status === 'sent';
      }
      await alertSchool(tenantId, t, `${status === 'confirmed' ? 'Tour booked' : 'Tour request'}: ${name}`, [`${name} ${status === 'confirmed' ? 'booked' : 'asked for'} a school tour on ${niceDate(date, time)}.`, [email, phone].filter(Boolean).join(' · ')], `${origin}/academy?section=admissions`);
      return NextResponse.json({ ok: true, status, emailed, when: niceDate(date, time) });
    }

    if (b.action === 'inquiry') {
      const topic = TOPICS[b.topic] ? String(b.topic) : 'general';
      const name = clean(b.name, 80), email = clean(b.email, 120).toLowerCase(), phone = clean(b.phone, 30);
      const contactBy = ['call', 'text', 'email'].includes(b.contactBy) ? b.contactBy : (email ? 'email' : 'call');
      if (!name || !(okEmail(email) || phone)) return NextResponse.json({ ok: false, error: 'Add your name and an email or phone number.' }, { status: 400 });
      if (contactBy === 'email' && !okEmail(email)) return NextResponse.json({ ok: false, error: 'Add your email so we can reply.' }, { status: 400 });
      if (contactBy !== 'email' && !phone) return NextResponse.json({ ok: false, error: 'Add your phone number so we can call or text.' }, { status: 400 });
      const language = LANGUAGES[b.language] ? b.language : 'en'; const message = clean(b.message, 1500); const bestTime = clean(b.bestTime, 80);
      const settings = await getSettings(tenantId); const hrs = settings.contact.respondHours;
      const note = `${TOPICS[topic]} — prefers ${contactBy}${bestTime ? ` (${bestTime})` : ''}${message ? `: “${message}”` : ''}`;
      let where = 'inbox';
      if (ADMISSIONS_TOPICS.includes(topic)) { await upsertAdmission(tenantId, { name, email, phone, programId: clean(b.programId, 40), language, stage: 'inquiry', source: `website — ${TOPICS[topic].toLowerCase()}`, note, extra: { contactBy, bestTime: bestTime || null } }); where = 'admissions'; }
      else {
        const ref = db.collection(`${T}/websiteMessages`).doc();
        await ref.set({ id: ref.id, topic, name, email: email || null, phone: phone || null, contactBy, bestTime: bestTime || null, message, language, status: 'new', createdAt: new Date().toISOString() });
      }
      if (okEmail(email)) {
        const html = brandedEmailHtml({ studioName: school, title: 'We got your message', bodyLines: [`Hi ${name.split(' ')[0]} — thanks for reaching out about ${TOPICS[topic].toLowerCase()}.`, `We’ll ${contactBy === 'email' ? 'reply by email' : contactBy === 'text' ? 'text you' : 'call you'} within ${hrs} hour${hrs === 1 ? '' : 's'}${bestTime ? ` (you said ${bestTime} works best)` : ''}.`], footerNote: `Sent by ${school} because you contacted us on our website.` });
        await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `We got your message — ${school}`, html, kind: 'website_inquiry_receipt', recipientType: 'contact', recipientId: tenantId, recipientName: name }).catch(() => null);
      }
      await alertSchool(tenantId, t, `New ${TOPICS[topic].toLowerCase()} question: ${name}`, [`${name} wants to hear back by ${contactBy}${bestTime ? ` (${bestTime})` : ''} — please respond within ${hrs} hours.`, [email, phone].filter(Boolean).join(' · '), message].filter(Boolean), `${origin}/academy?section=${where === 'admissions' ? 'admissions' : 'website'}`);
      return NextResponse.json({ ok: true, respondHours: hrs, contactBy });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'Something went wrong — please try again, or call us.' }, { status: 500 });
  }
}
