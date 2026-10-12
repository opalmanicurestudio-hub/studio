import { NextRequest, NextResponse } from 'next/server';

import { brandedEmailHtml } from '@/lib/email-template';

// ─── /api/comms/dispatch ──────────────────────────────────────────────────────
// POST { kind, tenantId, ...ids }
//
// Replaces the four Firebase Cloud Functions mailers (onApplicantMessageCreate,
// onApplicationCreate, onInterviewInviteUpdate, onDocumentPublish) with inline
// sending from Vercel — the same architecture as the retail emails that already
// work. No firebase deploy, no GitHub Action, no separate secrets: this route
// uses the FIREBASE_ADMIN_* and RESEND_* envs that are already live.
//
// Kinds:
//   'messages'    { tenantId, applicationId }   send that application's queued emails
//   'application' { tenantId, applicationId }   applicant receipt + owner alert
//   'interview'   { tenantId, token }           applicant confirmation + owner notify + timeline
//   'document'    { tenantId, documentId }      "please read" notices to assigned staff
//
// It is deliberately NOT a mail relay. It accepts no recipient, no subject and
// no body from the caller — only document ids. Every address and every word
// sent is re-read from Firestore with the Admin SDK, and each kind claims an
// idempotency marker in a transaction before sending, so the worst a forged
// call can do is deliver a truthful, already-due email exactly once.
//
// FAILS SOFT EVERYWHERE: missing envs, Resend outages and absent addresses all
// return ok:false with a reason and HTTP 200. The Firestore writes that queued
// the mail have already committed and must never look failed because of a mail
// problem — the message doc's own status field carries the truth to the UI.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-comms-dispatch';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

const esc = (v: any) =>
  String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Sender address: reuse the exact address that already delivers for retail
// (RESEND_FROM, e.g. "Opal Studio <hi@domain.com>" or a bare address), but let
// each tenant's own business name be the display name. Falls back to the
// legacy notifications@ pattern only when RESEND_FROM is absent.
function fromFor(displayName: string): string {
  const rf = String(process.env.RESEND_FROM || '').trim();
  const m = rf.match(/<([^>]+)>/);
  const addr = (m ? m[1] : rf).trim();
  if (addr && addr.includes('@')) return `${displayName} <${addr}>`;
  return `${displayName} <notifications@${process.env.RESEND_SENDING_DOMAIN || 'clarityflow.app'}>`;
}

/**
 * Every dispatch email goes through sendNotification. This helper used to POST
 * straight to Resend, which meant the whole hiring funnel — receipts, owner
 * alerts, interview confirmations, queued replies — plus staff document
 * notices were invisible in the delivery log and outside message settings.
 * `from` stays in the signature so the call sites read unchanged; the address
 * itself is resolved centrally now, so it cannot disagree with the rest of
 * the app.
 */
async function sendEmail(opts: {
  from: string; to: string; subject: string; html: string;
  db: any; tenantId: string; kind: string;
  recipientType?: 'client' | 'staff' | 'renter' | 'maintenance' | 'contact' | 'other';
  recipientId?: string | null; recipientName?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { sendNotification } = await import('@/lib/notify');
    const r = await sendNotification(opts.db, {
      tenantId: opts.tenantId, channel: 'email', to: opts.to,
      subject: opts.subject, html: opts.html, kind: opts.kind,
      recipientType: opts.recipientType || 'contact',
      recipientId: opts.recipientId || null,
      recipientName: opts.recipientName || null,
    });
    return r.ok ? { ok: true } : { ok: false, error: r.error || r.status };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

function appBase(): string {
  return String(process.env.APP_BASE_URL || 'https://studio-one-blue.vercel.app').replace(/\/+$/, '');
}

function detailCard(lines: string[]): string {
  return `<div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:14px;padding:16px 20px;margin:16px 0;">${lines.join('')}</div>`;
}

async function ownerEmailFor(db: any, tenantId: string): Promise<string> {
  try {
    const tSnap = await db.doc(`tenants/${tenantId}`).get();
    const t = (tSnap.data() as any) || {};
    let ownerEmail: string = t.notificationEmail || t.email || '';
    if (!ownerEmail && t.userId) {
      try {
        const { getAuth } = require('firebase-admin/auth');
        const { getApps } = require('firebase-admin/app');
        const app = getApps().find((a: any) => a.name === 'admin-comms-dispatch');
        ownerEmail = (await getAuth(app).getUser(t.userId)).email || '';
      } catch { /* no auth lookup available */ }
    }
    return ownerEmail;
  } catch {
    return '';
  }
}

async function notifyOwner(db: any, tenantId: string, subject: string, title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const ownerEmail = await ownerEmailFor(db, tenantId);
  if (!ownerEmail) return;
  await sendEmail({
    db, tenantId, kind: 'hiring_owner_alert', recipientType: 'other', recipientName: 'Owner',
    from: fromFor('ClarityFlow'),
    to: ownerEmail,
    subject,
    html: brandedEmailHtml({
      studioName: 'ClarityFlow',
      title,
      bodyHtml,
      cta: cta || { label: 'Open Applicants', url: `${appBase()}/applicants` },
      footerNote: 'You\u2019re receiving this because you own this business on ClarityFlow.',
    }),
  });
}

async function tenantName(db: any, tenantId: string): Promise<string> {
  try {
    const snap = await db.doc(`tenants/${tenantId}`).get();
    return (snap.data() as any)?.name || 'Our team';
  } catch {
    return 'Our team';
  }
}

// ── kind: 'messages' ─────────────────────────────────────────────────────────
// Sends every type 'email' message still at 'queued' under one application.
// Each doc is claimed queued → sending in a transaction first, so concurrent
// calls (a double tap, a card re-mount) cannot double-send the same message.
async function handleMessages(db: any, tenantId: string, applicationId: string) {
  const col = db.collection(`tenants/${tenantId}/applications/${applicationId}/messages`);
  const snap = await col.where('type', '==', 'email').where('status', '==', 'queued').limit(20).get();
  if (snap.empty) return { ok: true, sent: 0 };

  const businessName = await tenantName(db, tenantId);
  let sent = 0;

  for (const d of snap.docs) {
    const claimed = await db.runTransaction(async (tx: any) => {
      const fresh = await tx.get(d.ref);
      if (!fresh.exists || (fresh.data() as any)?.status !== 'queued') return false;
      tx.set(d.ref, { status: 'sending' }, { merge: true });
      return true;
    }).catch(() => false);
    if (!claimed) continue;

    const msg = d.data() as any;
    if (!msg.to || !msg.body) {
      await d.ref.set({ status: 'failed', error: 'Missing recipient or body' }, { merge: true });
      continue;
    }

    const subject = String(msg.subject || `A message from ${businessName}`).slice(0, 200);
    const bodyHtml = esc(String(msg.body).slice(0, 5000)).replace(/\n/g, '<br/>');
    const result = await sendEmail({
      db, tenantId, kind: 'applicant_message', recipientId: applicationId, recipientName: msg.toName || null,
      from: fromFor(businessName),
      to: String(msg.to),
      subject,
      html: brandedEmailHtml({
        studioName: businessName,
        title: subject,
        bodyHtml: `<div style="font-size:15px;color:#0f172a;line-height:1.6;">${bodyHtml}</div>`,
        footerNote: `You are receiving this email because you applied to ${businessName}. If you have any questions, please reply to this email.`,
      }),
    });

    if (result.ok) {
      await d.ref.set({ status: 'sent', sentAt: new Date().toISOString() }, { merge: true });
      sent++;
    } else {
      await d.ref.set({ status: 'failed', error: result.error || 'Send failed' }, { merge: true });
    }
  }
  return { ok: true, sent };
}

// ── kind: 'application' ──────────────────────────────────────────────────────
// Applicant "we got it" receipt (welcome note + listing details) and the owner
// new-application alert. One transaction-claimed marker covers both, so a
// replayed call is a no-op. Phone-only applications skip the receipt but still
// alert the owner.
async function handleApplication(db: any, tenantId: string, applicationId: string) {
  const appRef = db.doc(`tenants/${tenantId}/applications/${applicationId}`);

  const claim = await db.runTransaction(async (tx: any) => {
    const fresh = await tx.get(appRef);
    if (!fresh.exists) return null;
    const a = fresh.data() as any;
    if (a.receiptSent === true || a.dispatchHandled === true) return null;
    tx.set(appRef, { receiptSent: true, dispatchHandled: true }, { merge: true });
    return a;
  }).catch(() => null);
  if (!claim) return { ok: false, reason: 'already_handled_or_missing' };

  const app = claim;
  const tSnap = await db.doc(`tenants/${tenantId}`).get();
  const t = (tSnap.data() as any) || {};
  const businessName = t.name || 'Our team';
  const welcomeNote = String(t.applicationWelcome || '').slice(0, 2000);

  if (app.email) {
    let listingBlock = '';
    if (app.listingId) {
      try {
        const listingSnap = await db.doc(`tenants/${tenantId}/jobListings/${app.listingId}`).get();
        const l = listingSnap.data() as any;
        if (l) {
          listingBlock = detailCard([
            `<p style="margin:0;font-size:15px;font-weight:800;color:#0f172a;">${esc(l.title)}</p>`,
            (l.payRange || l.scheduleNote) ? `<p style="margin:4px 0 0;color:#64748b;font-size:13px;">${esc([l.payRange, l.scheduleNote].filter(Boolean).join(' · '))}</p>` : '',
            l.description ? `<p style="margin:8px 0 0;color:#475569;font-size:14px;line-height:1.6;">${esc(l.description).replace(/\n/g, '<br/>')}</p>` : '',
          ]);
        }
      } catch { /* listing block is optional */ }
    }

    const first = esc(String(app.name || 'there').split(' ')[0]);
    const subject = `Thank you for your application — ${businessName}`;
    const result = await sendEmail({
      db, tenantId, kind: 'applicant_receipt', recipientId: applicationId, recipientName: app.name || null,
      from: fromFor(businessName),
      to: String(app.email),
      subject,
      html: brandedEmailHtml({
        studioName: businessName,
        title: `Thank you for applying, ${first}`,
        bodyHtml: `
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi ${first},</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Thank you for applying${app.listingTitle ? ` for the <strong>${esc(app.listingTitle)}</strong> position` : ''}. We have received your application, and a member of our team will review it personally. In the meantime, here is a little more about us:</p>
          ${welcomeNote ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#0f172a;">${esc(welcomeNote).replace(/\n/g, '<br/>')}</p>` : ''}
          ${listingBlock}
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">If your experience is a good fit, we will contact you at this email address about next steps, usually within a few days.</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Kind regards,<br/>${esc(businessName)}</p>`,
        footerNote: `You are receiving this email because you applied to ${businessName}. If you have any questions, please reply to this email.`,
      }),
    });

    const msgRef = db.doc(`tenants/${tenantId}/applications/${applicationId}/messages/receipt`);
    if (result.ok) {
      await msgRef.set({
        id: 'receipt', type: 'email', status: 'sent', to: app.email, subject,
        by: 'System', createdAt: new Date().toISOString(), sentAt: new Date().toISOString(),
      });
    } else {
      await msgRef.set({
        id: 'receipt', type: 'email', status: 'failed', to: app.email, subject,
        by: 'System', error: result.error || 'Send failed', createdAt: new Date().toISOString(),
      });
    }
  }

  await notifyOwner(db, tenantId,
    `New application: ${String(app.name || 'Someone').slice(0, 120)}${app.position ? ` — ${String(app.position).slice(0, 120)}` : ''}`,
    `Action needed: ${String(app.name || 'A new applicant').slice(0, 120)} has applied and is waiting for review.`,
    detailCard([
      `<p style="margin:0;font-size:15px;font-weight:800;color:#0f172a;">${esc(app.name || 'Applicant')}</p>`,
      `<p style="margin:4px 0 0;color:#64748b;font-size:13px;">${esc(app.position || '')}${app.email ? ` · ${esc(app.email)}` : ''}</p>`,
    ]),
    { label: 'Review their application', url: `${appBase()}/applicants?app=${encodeURIComponent(applicationId)}` },
  );

  return { ok: true };
}

// ── kind: 'interview' ────────────────────────────────────────────────────────
// Closes the loop on an invite response. Claims handledStatus per status value
// in a transaction, so 'pending → countered' and a later 'countered → accepted'
// each notify exactly once, and replays are no-ops. Accepted sends the
// applicant a written confirmation; every response writes the application
// timeline and emails the owner.
async function handleInterview(db: any, tenantId: string, token: string) {
  const inviteRef = db.doc(`tenants/${tenantId}/interviewInvites/${token}`);

  const claim = await db.runTransaction(async (tx: any) => {
    const fresh = await tx.get(inviteRef);
    if (!fresh.exists) return null;
    const inv = fresh.data() as any;
    const status = String(inv.status || '');
    if (status !== 'accepted' && status !== 'needs_new_times' && status !== 'countered') return null;
    if (String(inv.handledStatus || '') === status) return null;
    tx.set(inviteRef, { handledStatus: status, responseHandled: true }, { merge: true });
    return inv;
  }).catch(() => null);
  if (!claim) return { ok: false, reason: 'already_handled_or_missing' };

  const invite = claim;
  const status = String(invite.status);
  const businessName = await tenantName(db, tenantId);

  let applicantEmail = '';
  try {
    const appSnap = await db.doc(`tenants/${tenantId}/applications/${invite.applicationId}`).get();
    applicantEmail = String((appSnap.data() as any)?.email || '');
  } catch { /* timeline entry still gets written */ }

  const accepted = status === 'accepted';
  const whenText = accepted && invite.chosenSlot
    ? new Date(invite.chosenSlot).toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : '';

  if (accepted && applicantEmail) {
    await sendEmail({
      db, tenantId, kind: 'interview_confirmed', recipientId: invite.applicationId || null, recipientName: invite.firstName || null,
      from: fromFor(businessName),
      to: applicantEmail,
      subject: `Your interview is confirmed for ${whenText}`,
      html: brandedEmailHtml({
        studioName: businessName,
        title: 'Your interview is confirmed',
        bodyHtml: `
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi ${esc(invite.firstName || 'there')},</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Thank you for confirming your interview. Here are the details:</p>
          ${detailCard([
            invite.roleTitle ? `<p style="margin:0;font-size:15px;font-weight:800;color:#0f172a;">${esc(invite.roleTitle)}</p>` : '',
            `<p style="margin:4px 0 0;color:#64748b;font-size:14px;">${esc(whenText)}</p>`,
          ])}
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">If anything changes, please reply to this email and we will be happy to arrange another time.</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Kind regards,<br/>${esc(businessName)}</p>`,
        footerNote: `Sent by ${businessName}.`,
      }),
    });
  }

  if (invite.applicationId) {
    try {
      const slotCount = (invite.proposedSlots || []).length;
      await db.doc(`tenants/${tenantId}/applications/${invite.applicationId}/messages/invite_${token}_${status}`).set({
        id: `invite_${token}_${status}`,
        type: 'status',
        toStatus: 'interview',
        note: accepted
          ? `interview confirmed — ${whenText}`
          : status === 'countered'
            ? `sent their availability (${slotCount} option${slotCount === 1 ? '' : 's'})`
            : 'asked for different interview times',
        by: 'Applicant',
        createdAt: new Date().toISOString(),
      });
    } catch { /* timeline is best-effort */ }
  }

  const first = esc(invite.firstName || 'An applicant');
  if (accepted) {
    await notifyOwner(db, tenantId, `Interview confirmed: ${invite.firstName || 'applicant'}`,
      `${first} has confirmed their interview.`,
      detailCard([`<p style="margin:0;color:#0f172a;font-size:15px;font-weight:700;">${esc(whenText || '')}${invite.roleTitle ? ` · ${esc(invite.roleTitle)}` : ''}</p>`]),
      invite.applicationId ? { label: 'Open their application', url: `${appBase()}/applicants?app=${encodeURIComponent(String(invite.applicationId))}` } : undefined);
  } else if (status === 'countered') {
    const slots = (invite.proposedSlots || []).map((sl: string) => {
      try { return new Date(sl).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return sl; }
    });
    await notifyOwner(db, tenantId, `${invite.firstName || 'An applicant'} has sent their availability`,
      `Action needed: ${first} is not available at the times offered and has sent their own availability.`,
      `${detailCard([`<p style="margin:0;color:#0f172a;font-size:15px;line-height:1.8;font-weight:700;">${slots.map((x: string) => esc(x)).join('<br/>')}</p>`])}${invite.applicantNote ? `<p style="margin:0 0 12px;color:#64748b;font-size:14px;font-style:italic;">“${esc(invite.applicantNote)}”</p>` : ''}`,
      invite.applicationId ? { label: 'Open their application', url: `${appBase()}/applicants?app=${encodeURIComponent(String(invite.applicationId))}` } : undefined);
  } else {
    await notifyOwner(db, tenantId, `${invite.firstName || 'An applicant'} needs new interview times`,
      `Action needed: ${first} has asked for different interview times.`,
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Please propose a new set of times from their application card. They will receive a new link to choose one.</p>`,
      invite.applicationId ? { label: 'Open their application', url: `${appBase()}/applicants?app=${encodeURIComponent(String(invite.applicationId))}` } : undefined);
  }

  return { ok: true };
}

// ── kind: 'document' ─────────────────────────────────────────────────────────
// "Please read" notices when a document is published or republished. Claims
// notifiedVersion in a transaction BEFORE sending — one nag maximum per
// version, exactly the deployed-function contract the acks UI expects.
async function handleDocument(db: any, tenantId: string, documentId: string) {
  const docRef = db.doc(`tenants/${tenantId}/documents/${documentId}`);

  const claim = await db.runTransaction(async (tx: any) => {
    const fresh = await tx.get(docRef);
    if (!fresh.exists) return null;
    const d = fresh.data() as any;
    if (d.status !== 'published' || d.category === 'aftercare') return null;   // aftercare is for clients, not the team
    const version = Number(d.version || 1);
    if (Number(d.notifiedVersion || 0) >= version) return null;
    tx.set(docRef, { notifiedVersion: version }, { merge: true });
    return d;
  }).catch(() => null);
  if (!claim) return { ok: false, reason: 'already_notified_or_not_published' };

  const after = claim;
  const version = Number(after.version || 1);
  const isUpdate = version > 1;
  const title = String(after.title || 'A document').slice(0, 140);
  const roles: string[] = Array.isArray(after.assignedRoles) ? after.assignedRoles : [];
  const ids: string[] = Array.isArray(after.assignedStaffIds) ? after.assignedStaffIds : [];

  const businessName = await tenantName(db, tenantId);

  let staff: Array<{ id: string; name?: string; email?: string; role?: string; archived?: boolean }> = [];
  try {
    const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
    staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  } catch {
    return { ok: false, reason: 'staff_read_failed' };
  }

  // "Everyone" is the team; renters get building rules (sent to renters, or to them by name) in their own portal.
  const isRenter = (m: any) => m.role === 'renter' || m.isRenter === true;
  const recipients = staff.filter(m =>
    !m.archived &&
    m.email &&
    (ids.includes(m.id) || (isRenter(m) ? roles.includes('renter') : (roles.includes('all') || (m.role && roles.includes(m.role)))))
  ).slice(0, 50);

  if (recipients.length === 0) return { ok: true, sent: 0 };

  const portalUrl = `${appBase()}/staff-portal/${tenantId}`;
  const subject = isUpdate ? `Action needed: Please review the updated “${title}”` : `Action needed: Please read “${title}”`;

  let sent = 0;
  for (const m of recipients) {
    const renter = isRenter(m);
    const result = await sendEmail({
      db, tenantId, kind: 'staff_document_notice', recipientType: 'staff', recipientId: m.id || null,
      recipientName: m.name || null,
      from: fromFor(businessName),
      to: String(m.email),
      subject,
      html: brandedEmailHtml({
        studioName: businessName,
        title: renter ? (isUpdate ? 'The building rules have been updated. Please sign again.' : 'Building rules are ready for your signature') : isUpdate ? 'A document you have read has been updated' : 'A new document is ready for you to read',
        bodyHtml: `
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi ${esc(String(m.name || 'there').split(' ')[0])},</p>
          ${detailCard([
            `<p style="margin:0;font-size:15px;font-weight:800;color:#0f172a;">${esc(title)}</p>`,
            `<p style="margin:4px 0 0;color:#64748b;font-size:13px;">Version ${version}</p>`,
          ])}
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">${renter
            ? `Please open your renter portal, tap <strong>Studio</strong>, read ${isUpdate ? 'what has changed' : 'the document'} and sign.${after.signBy ? ` Please sign by ${esc(String(after.signBy))}.` : ''}`
            : isUpdate
            ? 'This document has been updated since you last confirmed it. Please open your staff portal, tap <strong>Documents</strong>, read the new version and tap “I’ve read and understood this.”'
            : 'Please open your staff portal, tap <strong>Documents</strong>, read the document and tap “I’ve read and understood this” when you have finished.'}</p>`,
        cta: { label: 'Open my portal', url: renter ? `${appBase()}/rent/${tenantId}?tab=studio` : portalUrl },
        footerNote: renter ? `Sent by ${businessName}.` : `Sent by ${businessName} through its team documents system.`,
      }),
    });
    if (result.ok) sent++;
  }
  return { ok: true, sent };
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400 });
  }

  const kind = String(body?.kind || '').trim();
  const tenantId = String(body?.tenantId || '').trim();
  if (!kind || !tenantId) {
    return NextResponse.json({ ok: false, reason: 'missing_kind_or_tenant' }, { status: 400 });
  }

  let db: any;
  try {
    db = getAdminDb();
  } catch {
    return NextResponse.json({ ok: false, reason: 'admin_unavailable' });
  }

  try {
    if (kind === 'messages') {
      const applicationId = String(body?.applicationId || '').trim();
      if (!applicationId) return NextResponse.json({ ok: false, reason: 'missing_application_id' }, { status: 400 });
      return NextResponse.json(await handleMessages(db, tenantId, applicationId));
    }
    if (kind === 'application') {
      const applicationId = String(body?.applicationId || '').trim();
      if (!applicationId) return NextResponse.json({ ok: false, reason: 'missing_application_id' }, { status: 400 });
      return NextResponse.json(await handleApplication(db, tenantId, applicationId));
    }
    if (kind === 'interview') {
      const token = String(body?.token || '').trim();
      if (!token) return NextResponse.json({ ok: false, reason: 'missing_token' }, { status: 400 });
      return NextResponse.json(await handleInterview(db, tenantId, token));
    }
    if (kind === 'document') {
      const documentId = String(body?.documentId || '').trim();
      if (!documentId) return NextResponse.json({ ok: false, reason: 'missing_document_id' }, { status: 400 });
      return NextResponse.json(await handleDocument(db, tenantId, documentId));
    }
    return NextResponse.json({ ok: false, reason: 'unknown_kind' }, { status: 400 });
  } catch (e: any) {
    console.error('comms dispatch failed', e);
    return NextResponse.json({ ok: false, reason: String(e?.message || e).slice(0, 300) });
  }
}
