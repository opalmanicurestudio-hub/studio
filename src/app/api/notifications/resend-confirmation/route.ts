// src/app/api/notifications/resend-confirmation/route.ts
//
// v15 — the booking-confirmation sender, now used TWO ways:
//   1. AUTOMATICALLY — QuickBookForm calls it right after its client-side
//      booking transaction commits, so POS bookings confirm without the
//      front desk doing anything. (Server-side bookings through
//      /api/appointments/book send their own confirmations in-route.)
//   2. MANUALLY — the "Resend confirmation" button on the confirmation
//      screen hits the same endpoint again.
//
// Sends BOTH channels when contact info exists:
//   - Branded email: check-in code displayed large + "Manage appointment"
//     button (cancel / reschedule / running late via the manageToken link)
//   - Text: short confirmation with the same manage link
// Every attempt lands in messageLog (email) / private smsLog (text), so
// "did we actually send it?" always has an answer.
//
// POST { tenantId, appointmentId, clientEmail?, clientPhone? }
// → { ok, emailSent, smsSent, reason? }

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendNotification, ensureApptToken } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';
import { smsConfigured } from '@/lib/sms';

export async function POST(req: NextRequest) {
  try {
    const { tenantId, appointmentId, clientEmail, clientPhone } = await req.json();
    if (!tenantId || !appointmentId) {
      return NextResponse.json({ ok: false, reason: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();

    const aptSnap = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
    if (!aptSnap.exists) return NextResponse.json({ ok: false, reason: 'Appointment not found.' }, { status: 404 });
    const apt = aptSnap.data() as any;

    // ── Contact info: explicit params win, then the appointment, then the
    // client profile — so a number typed at the desk moments ago works
    // even before the client doc syncs.
    let email = String(clientEmail || apt.clientEmail || '').trim();
    let phone = String(clientPhone || apt.clientPhone || '').trim();
    if ((!email || !phone) && apt.clientId) {
      try {
        const c = ((await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() as any) || {};
        if (!email) email = String(c.email || '').trim();
        if (!phone) phone = String(c.phone || '').trim();
      } catch { /* fall through with what we have */ }
    }
    if (!email.includes('@')) email = '';
    if (!email && !phone) {
      return NextResponse.json({ ok: false, emailSent: false, smsSent: false, reason: 'No email or phone on file for this client.' });
    }

    const [tenantSnap, svcSnap, staffSnap] = await Promise.all([
      db.doc(`tenants/${tenantId}`).get(),
      apt.serviceId ? db.doc(`tenants/${tenantId}/services/${apt.serviceId}`).get() : Promise.resolve(null),
      apt.staffId ? db.doc(`tenants/${tenantId}/staff/${apt.staffId}`).get() : Promise.resolve(null),
    ]);
    const tData = (tenantSnap.data() as any) || {};
    const studioName = tData.name || tData.businessName || 'Your studio';
    const serviceName = (svcSnap as any)?.exists ? ((svcSnap as any).data()?.name || 'your service') : 'your service';
    const staffName = (staffSnap as any)?.exists ? ((staffSnap as any).data()?.name || null) : null;

    // Studio-local time, same convention as reminders and /api/appt.
    const cfg = tData.clientNotify || {};
    const tzOffset = Number.isFinite(Number(cfg.tzOffsetMinutes)) ? Number(cfg.tzOffsetMinutes) : -300;
    const when = apt.startTime ? new Date(new Date(apt.startTime).getTime() + tzOffset * 60000) : null;
    const whenStr = when && !Number.isNaN(when.getTime())
      ? `${when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} at ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}`
      : 'your scheduled time';

    // Links live on the PERMANENT domain, never a frozen preview URL.
    const base = String(
      tData.publicOrigin
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
      || req.nextUrl.origin,
    ).replace(/\/$/, '');
    const k = await ensureApptToken(db, tenantId, appointmentId);
    const manageUrl = k ? `${base}/appt/${tenantId}/${appointmentId}?k=${k}` : null;
    // Same token, GET → .ics file. iOS/Android/Outlook all open it as an
    // "add this event" sheet.
    const calendarUrl = k
      ? `${base}/api/appt?tenantId=${encodeURIComponent(tenantId)}&apptId=${encodeURIComponent(appointmentId)}&k=${encodeURIComponent(k)}`
      : null;
    const code = apt.shortCode ? String(apt.shortCode).toUpperCase() : null;
    const firstName = String(apt.clientName || '').split(' ')[0] || 'there';

    let emailSent = false;
    let smsSent = false;

    if (email) {
      const html = brandedEmailHtml({
        studioName,
        title: "You're confirmed",
        bodyLines: [
          `Hi ${firstName} — your ${serviceName}${staffName ? ` with ${staffName}` : ''} is booked for ${whenStr}.`,
          code ? 'Show the code below when you arrive to check in.' : '',
        ].filter(Boolean),
        bigCode: code || undefined,
        cta: manageUrl ? { label: 'Manage appointment', url: manageUrl } : null,
        secondaryCta: calendarUrl ? { label: 'Add to calendar', url: calendarUrl } : null,
        footerNote: `Need to cancel, reschedule, or tell us you're running late? Use the buttons above any time. Sent by ${studioName}.`,
      });
      const er = await sendNotification(db, {
        tenantId, channel: 'email', to: email,
        subject: `Confirmed: ${serviceName} — ${whenStr}`,
        html, kind: 'booking_confirmation',
        appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
      emailSent = !!er.ok;
    }

    if (phone && smsConfigured()) {
      // Routed through sendNotification so the text lands in messageLog
      // with delivery tracking, exactly like the email above.
      const sr = await sendNotification(db, {
        tenantId, channel: 'sms', to: phone,
        text: `You're confirmed — ${serviceName}${staffName ? ` with ${staffName}` : ''} on ${whenStr}.${manageUrl ? ` Manage: ${manageUrl}` : ''}`,
        kind: 'booking_confirmation',
        appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
      smsSent = !!sr.ok;
    }

    return NextResponse.json({
      ok: emailSent || smsSent,
      emailSent, smsSent,
      ...(emailSent || smsSent ? {} : {
        reason: !process.env.RESEND_API_KEY && !smsConfigured()
          ? 'No email or SMS provider is configured yet.'
          : 'Sends failed — check the message log for details.',
      }),
    });
  } catch (err) {
    console.error('[resend-confirmation] failed', err);
    return NextResponse.json({ ok: false, reason: 'Something went wrong.' }, { status: 500 });
  }
}
