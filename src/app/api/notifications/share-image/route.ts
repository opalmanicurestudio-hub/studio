// src/app/api/notifications/share-image/route.ts
//
// v14 — "send the image to the client for their records." The appointment
// detail sheet's image viewer calls this with the (marked-up) image URL;
// the client gets a clean email with the photo inline, and the send is
// logged in messageLog + the audit trail like every other message.
//
// POST { tenantId, appointmentId, imageUrl, note?, clientEmail? }
// → { ok: true } | { ok: false, reason }

import { staffOrServer } from '@/lib/route-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendNotification, emailShell } from '@/lib/notify';

export async function POST(req: NextRequest) {
  try {
    const { tenantId, appointmentId, imageUrl, note, clientEmail } = await req.json();
    if (!(await staffOrServer(req, String(tenantId || '')))) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });   // staff, or our own server — never the public
    if (!tenantId || !imageUrl || typeof imageUrl !== 'string' || !/^https:\/\/[^\s"'<>]+$/.test(imageUrl)) {
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

    const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
    const img = String(imageUrl);   // checked above: https, nothing that could break out of the tag
    const html = emailShell(studioName, `
      <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#2c2d31">Hi ${esc(firstName)}, here’s the photo from your visit${safeNote ? '.' : ', for your records.'}</p>
      ${safeNote ? `<p style="margin:14px 0 0;padding:14px 16px;background:#f5f5f7;border-radius:14px;font-size:15px;line-height:1.6;color:#2c2d31">${esc(safeNote)}</p>` : ''}
      <img src="${esc(img)}" alt="Your photo" style="display:block;width:100%;margin:16px 0 0;border-radius:16px;border:0" />
    `, 'Your photo');

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
