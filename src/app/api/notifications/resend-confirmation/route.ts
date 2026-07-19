// src/app/api/notifications/resend-confirmation/route.ts
//
// v14 — QuickBookForm's confirmation screen has called this endpoint since
// v4, but it never existed server-side (the file's own header flagged it).
// Now it does: loads the appointment, builds a clean confirmation email,
// sends via the notification core, and the send lands in messageLog +
// the audit trail like every other message.
//
// POST { tenantId, appointmentId, clientEmail?, clientPhone? }
// → { ok: true } | { ok: false, reason }

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendNotification, emailShell } from '@/lib/notify';

export async function POST(req: NextRequest) {
  try {
    const { tenantId, appointmentId, clientEmail } = await req.json();
    if (!tenantId || !appointmentId) {
      return NextResponse.json({ ok: false, reason: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();

    const aptSnap = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
    if (!aptSnap.exists) return NextResponse.json({ ok: false, reason: 'Appointment not found.' }, { status: 404 });
    const apt = aptSnap.data() as any;

    const to = String(clientEmail || '').trim()
      || String((apt.clientEmail || '')).trim()
      || (apt.clientId
        ? String(((await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() as any)?.email || '').trim()
        : '');
    if (!to || !to.includes('@')) {
      return NextResponse.json({ ok: false, reason: 'No email on file for this client.' });
    }

    const [tenantSnap, svcSnap, staffSnap] = await Promise.all([
      db.doc(`tenants/${tenantId}`).get(),
      apt.serviceId ? db.doc(`tenants/${tenantId}/services/${apt.serviceId}`).get() : Promise.resolve(null),
      apt.staffId ? db.doc(`tenants/${tenantId}/staff/${apt.staffId}`).get() : Promise.resolve(null),
    ]);
    const studioName = (tenantSnap.data() as any)?.name || 'Your studio';
    const serviceName = (svcSnap as any)?.exists ? ((svcSnap as any).data()?.name || 'your service') : 'your service';
    const staffName = (staffSnap as any)?.exists ? ((staffSnap as any).data()?.name || null) : null;

    const when = apt.startTime ? new Date(apt.startTime) : null;
    const whenStr = when && !Number.isNaN(when.getTime())
      ? when.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'your scheduled time';
    const origin = req.nextUrl.origin;
    const checkInUrl = apt.checkInToken ? `${origin}/check-in/${apt.checkInToken}` : null;
    const code = apt.shortCode ? String(apt.shortCode).toUpperCase() : null;
    const firstName = String(apt.clientName || '').split(' ')[0] || 'there';

    const html = emailShell(studioName, `
      <p style="margin:0 0 12px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;">You're confirmed! Here are your appointment details:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#64748b;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;">${serviceName}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">When</td><td style="padding:6px 0;text-align:right;font-weight:600;">${whenStr}</td></tr>
        ${staffName ? `<tr><td style="padding:6px 0;color:#64748b;">With</td><td style="padding:6px 0;text-align:right;font-weight:600;">${staffName}</td></tr>` : ''}
        ${code ? `<tr><td style="padding:6px 0;color:#64748b;">Check-in code</td><td style="padding:6px 0;text-align:right;font-weight:700;font-family:monospace;letter-spacing:2px;">${code}</td></tr>` : ''}
      </table>
      ${checkInUrl ? `<p style="margin:20px 0 0;"><a href="${checkInUrl}" style="display:block;text-align:center;background:#0f172a;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:600;">Check in / manage your visit</a></p>` : ''}
    `);

    const result = await sendNotification(db, {
      tenantId, channel: 'email', to,
      subject: `Confirmed: ${serviceName} — ${whenStr}`,
      html,
      kind: 'booking_confirmation',
      appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null,
    });

    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, reason: result.status === 'skipped_no_provider'
          ? 'Email isn’t set up yet — add RESEND_API_KEY to go live.'
          : result.error || 'Send failed.' });
  } catch (err) {
    console.error('[resend-confirmation] failed', err);
    return NextResponse.json({ ok: false, reason: 'Something went wrong.' }, { status: 500 });
  }
}
