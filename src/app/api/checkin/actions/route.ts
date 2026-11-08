// src/app/api/checkin/actions/route.ts
//
// THE CHECK-IN LINK'S ACTIONS, SAVED ON THE SERVER. Clients open their link
// signed out, and the database rules (rightly) refuse browser writes to
// appointments, client records, completions and reviews — so reviews,
// pre-visit steps and preferences were silently lost while the page showed
// "thank you". Each action here is authorised by the link itself: the token
// must match a check-in record (or booking completion), and everything is
// written to THAT appointment and THAT client only.
//
//   review    { token, rating 1–5, text }             once per visit
//   viewed    { token }                                first open, for the timeline
//   prefs     { token, confirmationChannel, reminderChannel, reminderHoursBefore }
//   prefs_get { token }                                 what's set now (to show it)
//   wifi      { token }                                 the guest Wi-Fi (private to the business, so only through a visit link)
//   form      { token, formId, formData, signedName?, acknowledged?, guardian? }   one form, saved as they finish it
//   health_same { token, formId }                       "nothing's changed" on health answers on file
//   photos    { token, photos: [{ url, note }] }         new inspiration photos, when the team asked for different ones
//   photos_reply { token, answer: 'ok' | 'reply', text? }  "Looks good", or a reply, to the team's marks on their photos
//   complete  { token, tenantId, signedForms, fileSubmissions, policyAcceptance,
//               guardianByForm, profileDocuments, marketingConsent,
//               emergencyContact, acknowledgments, skipCardStep }
// (Fee payments and card/deposit completion are recorded by the Stripe webhook
//  when payment is confirmed — not from the page.)

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
const TOKEN = /^[A-Za-z0-9_-]{6,80}$/;
const str = (v: any, n = 300) => String(v ?? '').slice(0, n);
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/** The check-in record behind a link → which business, appointment, client. */
async function fromCheckIn(db: any, token: string) {
  const ci = ((await db.doc(`appointmentCheckIns/${token}`).get()).data()) || null;
  if (!ci?.tenantId || !(ci.id || ci.appointmentId)) return null;
  const apptId = String(ci.id || ci.appointmentId);
  const ref = db.doc(`tenants/${ci.tenantId}/appointments/${apptId}`);
  const appt = ((await ref.get()).data()) || null;
  if (!appt || (appt.checkInToken && appt.checkInToken !== token)) return null;
  return { tenantId: String(ci.tenantId), apptId, ref, appt };
}

/** A link turned off by "Not you?": who to ask for a new one, by the business's own name. */
async function turnedOff(db: any, tenantId: string) {
  const t: any = ((await db.doc(`tenants/${tenantId}`).get().catch(() => null))?.data?.()) || {};
  const name = String(t.name || t.businessName || '').trim();
  return `This link has been turned off. ${name ? `Ask ${name}` : 'Ask the business'} for a new one.`;
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || ''), token = String(b.token || '');
  if (!TOKEN.test(token)) return bad('This link isn’t valid.');
  const db = getAdminDb(); const nowIso = new Date().toISOString();

  if (action === 'review') {
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    const { tenantId, apptId, ref, appt } = x;
    if (['cancelled', 'canceled', 'no_show'].includes(String(appt.status || ''))) return bad('Reviews are for completed visits.', 409);
    if (appt.startTime && Date.parse(appt.startTime) > Date.now()) return bad('You can leave a review after your visit.', 409);
    if (appt.reviewSubmittedAt) return bad('Thanks — you’ve already reviewed this visit.', 409);
    const rating = Math.round(Number(b.rating)); if (!(rating >= 1 && rating <= 5)) return bad('Please choose 1 to 5 stars.');
    const cl = appt.clientId ? (((await db.doc(`tenants/${tenantId}/clients/${appt.clientId}`).get()).data()) || {}) : {};
    const svc = appt.serviceId ? (((await db.doc(`tenants/${tenantId}/services/${appt.serviceId}`).get()).data()) || {}) : {};
    // Shown on the booking page straight away only when the business chose that (Reviews → Visits, lib/reviews).
    const { reviewSettings, autoShows } = await import('@/lib/reviews');
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const show = reviewSettings(tenant).visitAutoShow;
    const id = nanoid();
    // One review per visit, even from two taps at once.
    const took = await db.runTransaction(async (tx: any) => {
      if ((((await tx.get(ref)).data()) || {}).reviewSubmittedAt) return false;
      tx.set(db.doc(`tenants/${tenantId}/reviews/${id}`), {
        id, tenantId, clientId: appt.clientId || null, clientName: appt.clientName || cl.name || 'Guest', clientAvatarUrl: cl.avatarUrl || null,
        staffId: appt.staffId || '', serviceId: appt.serviceId || null, serviceName: svc.name || appt.serviceName || 'Treatment',
        appointmentId: apptId, rating, text: str(b.text, 2000), isPublic: show, isFeatured: false, source: 'check-in link', createdAt: nowIso,
        // The form told them it may be shown publicly (so it can show on its own if left waiting, lib/reviews). Only
        // when the form says it showed them that: one loaded before the notice was added didn't.
        showNotice: b.noticeShown === true,
      });
      tx.set(ref, { reviewSubmittedAt: nowIso, reviewId: id, reviewRating: rating }, { merge: true });
      return true;
    });
    if (!took) return bad('Thanks — you’ve already reviewed this visit.', 409);
    // Waiting to be shown: the people who decide hear about it (lib/reviews-server).
    if (!show) { const { tellWaiting } = await import('@/lib/reviews-server'); const { reviewerName } = await import('@/lib/reviews'); await tellWaiting(db, tenantId, { kind: 'visit', rating, who: reviewerName(appt.clientName || cl.name, 'A client'), what: `their ${svc.name || appt.serviceName || 'visit'}`, auto: autoShows('visit', { showNotice: b.noticeShown === true }, tenant) }); }
    await logAuditAdmin(db, tenantId, { action: 'review.received', targetType: 'appointment', targetId: apptId, summary: `${rating}★ review from ${appt.clientName || 'a client'}`, actor: { type: 'user', name: appt.clientName || 'Client', role: 'client', via: 'check-in link' } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // The guest Wi-Fi, for the person this visit link belongs to: kept off the public business record (lib/tenant-private).
  if (action === 'wifi') {
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    // Only on a link that's still theirs (not turned off by "Not you?", and confirmed when it has to be), and only while
    // they're here: checked in or being looked after.
    { const { visitLinkOpen } = await import('@/lib/client-verify'); const open = await visitLinkOpen(db, x.tenantId, x.appt, str(b.device, 120));
      if (open !== 'ok') return NextResponse.json({ ok: true, wifi: null }); }
    const here = x.appt.checkInStatus === 'arrived' || ['checked_in', 'arrived', 'servicing'].includes(String(x.appt.status || ''));
    if (!here) return NextResponse.json({ ok: true, wifi: null });
    const { tenantPrivate } = await import('@/lib/tenant-private');
    const p = await tenantPrivate(db, x.tenantId);
    return NextResponse.json({ ok: true, wifi: p.wifiNetwork ? { network: p.wifiNetwork, password: p.wifiPassword || null } : null });
  }

  if (action === 'viewed') { // "client opened the link" — once, for the activity timeline
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    if (!x.appt.completionLinkFirstViewedAt) await x.ref.set({ completionLinkFirstViewedAt: nowIso }, { merge: true });
    if (b.by !== 'desk') { const { stampLinkView } = await import('@/lib/link-views'); await stampLinkView(x.ref, x.appt, 'visit'); }
    return NextResponse.json({ ok: true });
  }

  // How and when the business reaches them: read (to show what's set) and saved. Only when the business lets clients
  // choose (Settings › Notifications: allowClientOverride). A reminder can be a phone call ('voice'), which is also
  // what an unset choice means to the reminder calls.
  if (action === 'prefs' || action === 'prefs_get') {
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    if (!x.appt.clientId) return bad('We couldn’t find your client record. Please message us and we’ll sort it out.', 409);
    const t = ((await db.doc(`tenants/${x.tenantId}`).get()).data()) || {};
    if (t.notificationDefaults?.allowClientOverride === false) return bad('This business chooses how it reaches clients, so this can’t be changed here.', 403);
    const cRef = db.doc(`tenants/${x.tenantId}/clients/${x.appt.clientId}`);
    if (action === 'prefs_get') {
      const p = (((await cRef.get()).data()) || {}).notificationPreferences || {};
      return NextResponse.json({ ok: true, prefs: { confirmationChannel: p.confirmationChannel || 'both', reminderChannel: p.reminderChannel || 'voice', reminderHoursBefore: Number(p.reminderHoursBefore) || 48 } });
    }
    const ch = (v: any) => (['email', 'sms', 'both', 'none'].includes(String(v)) ? String(v) : 'both');
    const rch = (v: any) => (['voice', 'email', 'sms', 'both', 'none'].includes(String(v)) ? String(v) : 'voice');
    const hours = Math.max(1, Math.min(168, Math.round(Number(b.reminderHoursBefore) || 24)));
    await cRef.set({ notificationPreferences: { confirmationChannel: ch(b.confirmationChannel), reminderChannel: rch(b.reminderChannel), reminderHoursBefore: hours, updatedAt: nowIso, source: 'check-in link' } }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  // One form at a time from the visit link (lib/forms-visit): checked by the same rule as the booking sheet, kept on the
  // visit and on file; when it was the last thing left, the visit's request closes (with a thank-you if they were reminded).
  if (action === 'form' || action === 'health_same') {
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    // Not once "Not you?" turned the link off, and not before "Is this you?" on a contact that needs it.
    { const { visitLinkOpen } = await import('@/lib/client-verify'); const open = await visitLinkOpen(db, x.tenantId, x.appt, str(b.device, 120));
      if (open === 'revoked') return bad(await turnedOff(db, x.tenantId), 410);
      if (open === 'verify') return bad('Please confirm it’s you first, with the code we send.', 403); }
    const V = await import('@/lib/forms-visit');
    const r = action === 'form' ? await V.saveVisitForm(db, x.tenantId, x.appt, x.apptId, token, b) : await V.confirmHealthSame(db, x.tenantId, x.appt, x.apptId, token, String(b.formId || ''));
    if (!r.ok) return bad(r.error || 'That didn’t save. Please try again.', r.status || 400);
    if (!(r as any).repeat) await logAuditAdmin(db, x.tenantId, { action: action === 'form' ? 'completion.form_signed' : 'completion.health_confirmed', targetType: 'appointment', targetId: x.apptId,
      summary: action === 'form' ? `${x.appt.clientName || 'A client'} finished a form on their visit link` : `${x.appt.clientName || 'A client'} said nothing has changed on their health answers`,
      actor: { type: 'user', name: x.appt.clientName || 'Client', role: 'client', via: 'check-in link' } }).catch(() => {});
    return NextResponse.json({ ok: true, ...(action === 'form' ? { left: (r as any).left, done: (r as any).done } : {}) });
  }

  if (action === 'photos') {
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    { const { visitLinkOpen } = await import('@/lib/client-verify'); const open = await visitLinkOpen(db, x.tenantId, x.appt, str(b.device, 120));
      if (open === 'revoked') return bad(await turnedOff(db, x.tenantId), 410);
      if (open === 'verify') return bad('Please confirm it’s you first, with the code we send.', 403); }
    const P = await import('@/lib/inspo-photos');
    if (!P.photosAskOpen(x.appt)) return bad(x.appt.inspoReview?.status === 'again' ? 'This visit can’t take new photos now.' : 'Your photos are already with the team.', 409);
    // Only photos saved through the business's own photo upload (api/booking/photo), up to four, each with its note.
    const sentIn: any[] = (Array.isArray(b.photos) ? b.photos : []).slice(0, 4);
    if (!sentIn.length) return bad('Add a photo first.');
    const tenant: any = ((await db.doc(`tenants/${x.tenantId}`).get()).data()) || {};
    const buckets = await P.ourBuckets(tenant);
    const { keepMarkup } = await import('@/lib/markup/model');
    const photos: { url: string; note: string; original?: string; markup?: string }[] = [];
    for (const p of sentIn) {
      const url = await P.ownInspoPhoto(db, p?.url, x.tenantId, buckets);
      if (!url) return bad('One of those photos didn’t upload properly. Please add it again.');
      if (photos.some((q) => q.url === url)) continue;   // each photo once
      // The photo before its marks, and the marks (lib/markup), when they came with it: kept so they can be changed later.
      const original = P.ownOriginal(p?.original, x.tenantId); const markup = original ? keepMarkup(p?.markup, { as: 'client' }) : null;
      photos.push({ url, note: str(p?.note, 300), ...(original ? { original } : {}), ...(markup ? { markup } : {}) });
    }
    // Once, even from two taps at once, and only while the ask is still open (a new ask from the team starts over).
    const took = await db.runTransaction(async (tx: any) => {
      const cur: any = ((await tx.get(x.ref)).data()) || {};
      if (!P.photosAskOpen(cur)) return null;
      const had: any[] = Array.isArray(cur.inspirationPhotos) ? cur.inspirationPhotos : [];
      tx.update(x.ref, { inspirationPhotos: photos, inspirationPhotoUrl: photos[0].url, inspirationPhotosEarlier: P.earlierPhotos(had, cur.inspirationPhotosEarlier, photos),
        inspoReview: { status: 'sent', sentAt: nowIso, note: cur.inspoReview.note || null, by: cur.inspoReview.by || null, byUid: cur.inspoReview.byUid || null, at: cur.inspoReview.at || null } });
      return cur;
    });
    if (!took) return bad('Your photos are already with the team.', 409);
    // The person doing the visit hears about it (and whoever asked).
    try {
      const to = [...new Set([took.staffId, took.inspoReview?.byUid].filter(Boolean).map(String))];
      const nb = db.batch();
      for (const uid of to) { const r = db.collection(`tenants/${x.tenantId}/notifications`).doc(); nb.set(r, { id: r.id, userId: uid, type: 'photos_sent', title: 'New inspiration photos', message: `${took.clientName || 'A client'} sent new inspiration photos for their visit.`, link: `/planner?visit=${x.apptId}`, appointmentId: x.apptId, read: false, createdAt: nowIso }); }
      await nb.commit();
    } catch (e) { console.error('[checkin/photos] tell', e); }
    await logAuditAdmin(db, x.tenantId, { action: 'completion.photos_sent', targetType: 'appointment', targetId: x.apptId, summary: `${took.clientName || 'A client'} sent new inspiration photos`, actor: { type: 'user', name: took.clientName || 'Client', role: 'client', via: 'check-in link' } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // The client answers the team's marks on their photos (lib/markup/team): "Looks good", or a reply (which also goes to
  // the business's inbox, so it's answered there). Once for each time the team sends marks; the team hears about it.
  if (action === 'photos_reply') {
    const x = await fromCheckIn(db, token); if (!x) return bad('This link isn’t valid.', 404);
    { const { visitLinkOpen } = await import('@/lib/client-verify'); const open = await visitLinkOpen(db, x.tenantId, x.appt, str(b.device, 120));
      if (open === 'revoked') return bad(await turnedOff(db, x.tenantId), 410);
      if (open === 'verify') return bad('Please confirm it’s you first, with the code we send.', 403); }
    const kind = b.answer === 'reply' ? 'reply' : b.answer === 'ok' ? 'ok' : null; if (!kind) return bad('Choose Looks good, or write a reply.');
    const text = kind === 'reply' ? String(b.text ?? '').trim().slice(0, 500) : '';
    if (kind === 'reply' && !text) return bad('Write your reply first.');
    const { replyFor } = await import('@/lib/markup/team'); const { ENDED_VISIT } = await import('@/lib/forms-visit');
    if (ENDED_VISIT.includes(String(x.appt.status || ''))) return bad('This visit is over, so there’s nothing to answer here.', 409);
    const { photosAskOpen } = await import('@/lib/inspo-photos');
    const took = await db.runTransaction(async (tx: any) => {
      const cur: any = ((await tx.get(x.ref)).data()) || {};
      const r = photosAskOpen(cur) ? null : replyFor(cur); if (!r) return 'none';
      if (r.answer) return 'already';
      tx.update(x.ref, { 'inspoReply.answer': { kind, text: text || null, at: nowIso } });
      return cur;
    });
    if (took === 'none') return bad('There’s nothing to answer here now.', 409);
    if (took === 'already') return bad('You’ve already answered. Send a message if there’s anything else.', 409);
    const by = String(took.inspoReply?.by || '').trim();
    if (kind === 'reply') {
      try { const { clientWrites } = await import('@/lib/client-messages'); await clientWrites(db, x.tenantId, { ...took, id: x.apptId }, `About my inspiration photos: ${text}`); } catch (e) { console.error('[checkin/photos_reply] inbox', e); }
    }
    try {
      const to = [...new Set([took.staffId, took.inspoReply?.byUid].filter(Boolean).map(String))];
      const nb = db.batch();
      for (const uid of to) { const r = db.collection(`tenants/${x.tenantId}/notifications`).doc(); nb.set(r, { id: r.id, userId: uid, type: 'photos_reply', title: kind === 'ok' ? 'Photos: looks good' : 'A reply about the photos', message: kind === 'ok' ? `${took.clientName || 'A client'} said your marks on their photos look good.` : `${took.clientName || 'A client'} replied about your marks: “${text.slice(0, 120)}”`, link: `/planner?visit=${x.apptId}`, appointmentId: x.apptId, read: false, createdAt: nowIso }); }
      await nb.commit();
    } catch (e) { console.error('[checkin/photos_reply] tell', e); }
    await logAuditAdmin(db, x.tenantId, { action: 'completion.photos_answered', targetType: 'appointment', targetId: x.apptId, summary: `${took.clientName || 'A client'} ${kind === 'ok' ? 'said the marks on their photos look good' : 'replied about the marks on their photos'}${by ? ` (from ${by})` : ''}`, actor: { type: 'user', name: took.clientName || 'Client', role: 'client', via: 'check-in link' } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === 'complete') {
    const tenantId = String(b.tenantId || ''); if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return bad('This link isn’t valid.');
    const cRef = db.doc(`tenants/${tenantId}/bookingCompletions/${token}`);
    const c = ((await cRef.get()).data()) || null;
    if (!c) return bad('This link isn’t valid.', 404);
    if (c.status === 'complete') return NextResponse.json({ ok: true, already: true });
    // Not once "Not you?" turned the link off, and not before "Is this you?" on a contact that needs it.
    { const ci = await fromCheckIn(db, token);
      if (ci) { const { visitLinkOpen } = await import('@/lib/client-verify'); const open = await visitLinkOpen(db, ci.tenantId, ci.appt, str(b.device, 120));
        if (open === 'revoked') return bad(await turnedOff(db, ci.tenantId), 410);
        if (open === 'verify') return bad('Please confirm it’s you first, with the code we send.', 403); } }
    // A request the team called off takes nothing more. (Its date isn't checked: the visit link keeps asking until
    // the visit, so an answer on day eight still counts.)
    if (['void', 'cancelled', 'canceled'].includes(String(c.status || ''))) return bad('This request has closed, so there’s nothing more to send here.', 410);
    // Only the forms this request asked for (anything else isn't theirs to stamp as signed).
    const askedIds = new Set<string>((Array.isArray(c.requiredConsentFormIds) ? c.requiredConsentFormIds : []).map(String));
    const signedForms = (Array.isArray(b.signedForms) ? b.signedForms : []).filter((f: any) => askedIds.has(String(f?.formId || ''))).slice(0, 20).map((f: any) => ({ formId: str(f?.formId, 80), formTitle: str(f?.formTitle, 200), formData: f?.formData && typeof f.formData === 'object' ? f.formData : {} }));
    // Every form the visit still needs, signed (the page asks for all of them; a partial answer stays open).
    { const stillIds = new Set<string>((await (async () => { try { const { formsStillNeeded, formRulesOf } = await import('@/lib/forms');
        const ids = [...askedIds]; if (!ids.length) return [] as string[];
        const [tt, cc, ...dd] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), c.clientId ? db.doc(`tenants/${tenantId}/clients/${c.clientId}`).get() : Promise.resolve(null), ...ids.map((id) => db.doc(`tenants/${tenantId}/consentForms/${id}`).get().catch(() => null))]);
        const ap: any = c.appointmentId ? (((await db.doc(`tenants/${tenantId}/appointments/${c.appointmentId}`).get()).data() as any) || {}) : {};
        // Only forms that still exist: a deleted one can't be shown, so it's never required. One that couldn't be read
        // just now is still required.
        if (dd.some((d: any) => d === null)) { const { signedOnVisit, waivedOnVisit } = await import('@/lib/forms'); const here = signedOnVisit(ap); const waived = waivedOnVisit(ap); return ids.filter((id) => !here.has(id) && !waived.has(id)); }
        const defs = dd.map((d: any, i: number) => (d?.exists ? { id: ids[i], ...(d.data() || {}) } : null)).filter(Boolean) as any[];
        return formsStillNeeded({ apt: ap, ids: ids.filter((id) => defs.some((f) => f.id === id)), client: cc?.data?.() || {}, forms: defs, rules: formRulesOf(tt?.data?.() || {}) });
      } catch { return [] as string[]; } })()));   // a slow moment never refuses someone who signed
      if ([...stillIds].some((id) => !signedForms.some((f: any) => f.formId === id))) return bad('Please complete and sign every form before sending.', 400); }
    // Files only for what was asked (by its id), as with the forms.
    const askedFiles = new Set<string>([...(Array.isArray(c.fileRequirements) ? c.fileRequirements : []), ...(Array.isArray(c.requirements) ? c.requirements : [])].map((r: any) => String(r?.id || '')).filter(Boolean));
    const fileSubmissions = (Array.isArray(b.fileSubmissions) ? b.fileSubmissions : []).filter((x: any) => askedFiles.has(String(x?.requirementId || ''))).slice(0, 20);
    // Whether a card or deposit step follows is the completion record's own answer, never the browser's.
    const skipCard = c.skipCardStep === true;
    const policyAcceptance = { acceptedAt: nowIso, cardAuthorization: !skipCard, policyVersion: str(b.policyAcceptance?.policyVersion || 'v1', 40), depositAmountCents: Number(c.depositAmountCents) || 0 };
    if (JSON.stringify({ signedForms, fileSubmissions }).length > 800_000) return bad('That’s too much to send at once — please remove a file and try again.', 413);
    const apptId = c.appointmentId || null, clientId = c.clientId || null;
    const batch = db.batch();
    batch.set(db.collection(`tenants/${tenantId}/completionSubmissions`).doc(), { token, tenantId, appointmentId: apptId, clientId, clientName: c.clientName || null, clientEmail: c.clientEmail || null, signedForms, fileSubmissions, policyAcceptance, submittedAt: nowIso, cardAlreadyOnFile: skipCard });
    // Added to what the visit already has (forms signed while booking, files sent before), never replacing it.
    const apptNow: any = apptId ? (((await db.doc(`tenants/${tenantId}/appointments/${apptId}`).get()).data() as any) || {}) : {};
    if (['declined', 'expired', 'released', 'cancelled', 'canceled', 'no_show'].includes(String(apptNow.status || ''))) return bad('This visit isn’t going ahead, so there’s nothing more to send here.', 410);
    const byId = (xs: any[], key: string, add: any[]) => { const out = (Array.isArray(xs) ? xs : []).filter((x: any) => !add.some((y: any) => y?.[key] && y[key] === x?.[key])); const f = fitOnVisit([...out, ...add], add.length); movedAnswers.push(...f.moved); return f.list; };
    const movedAnswers: any[] = [];
    const { fitOnVisit } = await import('@/lib/forms');
    const apptPatch: any = { policyAcceptance, completionConsentsAt: nowIso,
      ...(signedForms.length ? { signedForms: byId(apptNow.signedForms, 'formId', signedForms) } : {}),
      ...(fileSubmissions.length ? { requirementFiles: byId(apptNow.requirementFiles, 'requirementId', fileSubmissions) } : {}) };
    const clientPatch: any = {};
    if (clientId) {
      const guardians = b.guardianByForm && typeof b.guardianByForm === 'object' ? b.guardianByForm : {};
      // On file for every screen, with the version of the wording they signed (lib/forms-server).
      const { recordSignedForms } = await import('@/lib/forms-server');
      await recordSignedForms(db, tenantId, { clientId, appointmentId: apptId, source: 'client_self_service', at: nowIso, batch,
        forms: signedForms.map((f: any) => ({ ...f, guardian: guardians[f.formId] || null })) });
      // Documents kept on their profile: added to what's there (same document → the new files), never replacing the rest.
      const docs = (Array.isArray(b.profileDocuments) ? b.profileDocuments : []).filter((d: any) => askedFiles.has(String(d?.requirementId || ''))).slice(0, 10);
      if (docs.length) {
        const { mergeProfileDocuments } = await import('@/lib/forms');
        const had = ((await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data() as any)?.profileDocuments || [];
        clientPatch.profileDocuments = mergeProfileDocuments(had, docs.map((d: any) => ({ requirementId: str(d.requirementId, 80), label: str(d.label, 200), files: Array.isArray(d.files) ? d.files.slice(0, 10) : [], uploadedAt: nowIso })));
      }
      if (c.requestMarketingConsent && typeof b.marketingConsent === 'boolean') { clientPatch.marketingConsent = { consented: b.marketingConsent, consentedAt: nowIso, source: 'client_self_service' }; apptPatch.marketingConsentAnsweredAt = nowIso; apptPatch.marketingConsentAnswer = b.marketingConsent; }
      const ec = b.emergencyContact; if (c.requestEmergencyContact && ec?.name && ec?.phone) { clientPatch.emergencyContact = { name: str(ec.name, 120), phone: str(ec.phone, 40), relationship: str(ec.relationship, 80) }; apptPatch.emergencyContactCapturedAt = nowIso; }
      if (Object.keys(clientPatch).length) batch.set(db.doc(`tenants/${tenantId}/clients/${clientId}`), clientPatch, { merge: true });
    }
    const acks = (Array.isArray(b.acknowledgments) ? b.acknowledgments : []).slice(0, 20).map((t: any) => str(t, 400));
    if (acks.length) { apptPatch.acknowledgedAt = nowIso; apptPatch.acknowledgedItems = acks; }
    // No card or deposit step → the requirements are done now. Otherwise the
    // Stripe webhook marks it complete when payment/card is confirmed.
    if (skipCard) {
      batch.set(cRef, { status: 'complete', completedAt: nowIso, formsSignedAt: nowIso }, { merge: true });
      apptPatch.completionStatus = 'completed'; apptPatch.requirementsCompletedAt = nowIso;
    } else batch.set(cRef, { formsSignedAt: nowIso }, { merge: true });
    if (apptId) batch.set(db.doc(`tenants/${tenantId}/appointments/${apptId}`), apptPatch, { merge: true });
    // Older answers moved off the visit record to keep it within size (lib/forms fitOnVisit): kept beside it, whole.
    if (apptId) { const { answersPath } = await import('@/lib/private-records'); for (const m of movedAnswers.slice(0, 100)) batch.set(db.doc(answersPath(tenantId, apptId, String(m.formId))), m); }
    await batch.commit();
    // Reminded about it, and now everything's done: a short thank-you (lib/forms-remind).
    if (skipCard && apptId && (c.formsReminderSentAt || apptNow.formsReminderSentAt)) {
      try { const { sendFormsThanks } = await import('@/lib/forms-remind'); const tdoc = ((await db.doc(`tenants/${tenantId}`).get()).data()) || {};
        await sendFormsThanks(db, tenantId, { ...apptNow, id: apptId }, tdoc, c); } catch (e) { console.error('[checkin] thanks', e); }
    }
    const what = [signedForms.length ? `${signedForms.length} form${signedForms.length === 1 ? '' : 's'}` : '', fileSubmissions.length ? `${fileSubmissions.length} file request${fileSubmissions.length === 1 ? '' : 's'}` : ''].filter(Boolean);
    await logAuditAdmin(db, tenantId, { action: 'completion.submitted', targetType: 'appointment', targetId: apptId || token, summary: `${c.clientName || 'A client'} completed their pre-visit steps${what.length ? ` (${what.join(', ')})` : ''}`, actor: { type: 'user', name: c.clientName || 'Client', role: 'client', via: 'check-in link' } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  return bad('Unknown action.');
}
