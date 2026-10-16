// src/app/api/notifications/send-completion-link/route.ts
//
// SENDS A CLIENT THEIR VISIT LINK (the check-in link: forms, photos, card, deposit, confirm, arrival). Used by the
// visit's "Send what's missing", accepting a booking request, phone and voice bookings, and the fee notice after a
// late cancellation. Staff (signed in) or our own server only, never the public.
//
// The link is built HERE from the visit's own check-in token, never taken from the request, so this can't be used to
// text a stranger an arbitrary address. Contact details: the request's, then the visit's, then the client's.
// Text first, email too when there is one; both go through sendNotification, so each lands in the visit's messages.
//
// POST { tenantId, appointmentId, items?: string[], reason?: 'requirements' | 'booking' | 'fee', clientEmail?, clientPhone? }
//   (older callers may also send { link } — only its token is read, and only if it matches a visit of this business)
// → { ok, smsSent, emailSent, link, reason? }
import { NextRequest, NextResponse } from 'next/server';
import { staffOrServer } from '@/lib/route-guard';
import { getAdminDb } from '@/lib/firebase-admin';
import { linkOrigin } from '@/lib/app-origin';
import { sendNotification } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';
import { smsConfigured } from '@/lib/sms';
import { requestMessage, type RequestItem } from '@/lib/visit-requests';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, reason: 'Missing details.' }, { status: 400 });
  if (!(await staffOrServer(req, tenantId))) return NextResponse.json({ ok: false, reason: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb();

  // Which visit: by id, or (older callers) by the token inside the link they pass.
  let aptSnap: any = null;
  if (b.appointmentId) aptSnap = await db.doc(`tenants/${tenantId}/appointments/${String(b.appointmentId).slice(0, 80)}`).get();
  else if (typeof b.link === 'string') {
    const m = b.link.match(/\/(?:check-in|complete\/[^/]+)\/([A-Za-z0-9_-]{6,80})/);
    if (m) { const q = await db.collection(`tenants/${tenantId}/appointments`).where('checkInToken', '==', m[1]).limit(1).get(); aptSnap = q.docs[0] || null; }
  }
  if (!aptSnap?.exists) return NextResponse.json({ ok: false, reason: 'We could not find this visit.' }, { status: 404 });
  const apt: any = aptSnap.data() || {}; const appointmentId = aptSnap.id;
  if (!apt.checkInToken) return NextResponse.json({ ok: false, reason: 'This visit has no client link yet.' }, { status: 409 });

  const tData: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const studioName = tData.name || tData.businessName || 'Your studio';
  const link = `${linkOrigin(tData, req.nextUrl.origin)}/check-in/${apt.checkInToken}`;

  let email = String(b.clientEmail || apt.clientEmail || '').trim(); let phone = String(b.clientPhone || apt.clientPhone || '').trim();
  if ((!email || !phone) && apt.clientId) {
    try { const c: any = (await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() || {}; if (!email) email = String(c.email || '').trim(); if (!phone) phone = String(c.phone || '').trim(); } catch { /* use what we have */ }
  }
  if (!email.includes('@')) email = '';
  if (!email && !phone) return NextResponse.json({ ok: false, smsSent: false, emailSent: false, link, reason: 'No phone or email on file for this client.' });

  const items: RequestItem[] = Array.isArray(b.items) ? b.items.filter((x: any) => typeof x === 'string').slice(0, 12) : [];
  const reason = ['requirements', 'booking', 'fee'].includes(b.reason) ? b.reason : items.length ? 'requirements' : 'booking';
  const msg = requestMessage({ firstName: String(apt.clientName || '').split(' ')[0] || 'there', studioName, startTime: apt.startTime, tzOffsetMinutes: tData.clientNotify?.tzOffsetMinutes, items, reason, link });

  let smsSent = false, emailSent = false;
  const common = { tenantId, kind: 'visit_request', appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null };
  if (phone && smsConfigured()) { const r = await sendNotification(db, { ...common, channel: 'sms', to: phone, text: msg.text } as any); smsSent = !!r?.ok; }
  if (email) {
    const html = brandedEmailHtml({ studioName, title: msg.title, bodyLines: msg.lines, cta: { label: msg.cta, url: link }, secondaryCta: null, footerNote: `Sent by ${studioName}.` } as any);
    const r = await sendNotification(db, { ...common, channel: 'email', to: email, subject: msg.title, html } as any); emailSent = !!r?.ok;
  }
  const at = new Date().toISOString();
  if (smsSent || emailSent) await aptSnap.ref.set({ lastRequirementsRequestedAt: at, requirementsSentVia: smsSent ? 'sms' : 'email', ...(items.length ? { requestedItems: items } : {}) }, { merge: true });
  return NextResponse.json({ ok: smsSent || emailSent, smsSent, emailSent, link,
    ...(smsSent || emailSent ? {} : { reason: !process.env.RESEND_API_KEY && !smsConfigured() ? 'No text or email service is set up yet.' : 'It could not be sent. The message log has the details.' }) });
}
