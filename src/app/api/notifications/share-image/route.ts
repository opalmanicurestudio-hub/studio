// src/app/api/notifications/share-image/route.ts
//
// v14 — "send the image to the client for their records." The appointment
// detail sheet's image viewer calls this with the (marked-up) image URL;
// the client gets a clean email with the photo inline, and the send is
// logged in messageLog + the audit trail like every other message.
//
// POST { tenantId, appointmentId, imageUrl, note?, clientEmail? }
// → { ok: true } | { ok: false, reason }

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendNotification, emailShell } from '@/lib/notify';

export async function POST(req: NextRequest) {
  try {
    const { tenantId, appointmentId, imageUrl, note, clientEmail } = await req.json();
    if (!tenantId || !imageUrl || typeof imageUrl !== 'string' || !/^https:\/\//.test(imageUrl)) {
      return NextResponse.json({ ok: false, reason: 'Missing or invalid image.' }, { status: 400 });
    }
    const db = getAdminDb();

    let apt: any = null;
    if (appointmentId) {
      const s = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
      apt = s.exists ? (s.data() as any) : null;
    }
    const to = String(clientEmail || '').trim()
      || String(apt?.clientEmail || '').trim()
      || (apt?.clientId
        ? String(((await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() as any)?.email || '').trim()
        : '');
    if (!to || !to.includes('@')) {
      return NextResponse.json({ ok: false, reason: 'No email on file for this client.' });
    }

    const studioName = ((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.name || 'Your studio';
    const firstName = String(apt?.clientName || '').split(' ')[0] || 'there';
    const safeNote = note ? String(note).slice(0, 500) : '';

    const html = emailShell(studioName, `
      <p style="margin:0 0 12px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;">Here's the photo from your visit${safeNote ? ':' : ' — for your records.'}</p>
      ${safeNote ? `<p style="margin:0 0 16px;padding:12px 14px;background:#f8fafc;border-radius:10px;color:#334155;">${safeNote}</p>` : ''}
      <img src="${imageUrl}" alt="Your photo" style="width:100%;border-radius:12px;border:1px solid #e2e8f0;" />
    `);

    const result = await sendNotification(db, {
      tenantId, channel: 'email', to,
      subject: `Your photo from ${studioName}`,
      html,
      kind: 'image_share',
      appointmentId: appointmentId || null,
      clientId: apt?.clientId || null,
      clientName: apt?.clientName || null,
    });

    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, reason: result.status === 'skipped_no_provider'
          ? 'Email isn’t set up yet — add RESEND_API_KEY to go live.'
          : result.error || 'Send failed.' });
  } catch (err) {
    console.error('[share-image] failed', err);
    return NextResponse.json({ ok: false, reason: 'Something went wrong.' }, { status: 500 });
  }
}
