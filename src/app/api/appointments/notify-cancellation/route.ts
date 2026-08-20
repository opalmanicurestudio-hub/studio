/**
 * POST /api/appointments/notify-cancellation
 *
 * WHY THIS EXISTS
 * resolveIssue() runs on the client SDK, so it can write the cancellation but
 * it cannot read the client's contact details or send anything. Until this
 * route existed, a manager could cancel a booking for no coverage and the
 * client was told NOTHING — they simply turned up. The decide route has always
 * messaged the client on a decline; this closes the same gap for the one other
 * path in the app that cancels somebody.
 *
 * The words come from the shop's message catalog, not from here. This supplies
 * the facts as tokens and the sentence is theirs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const tenantId = String(body.tenantId || '').trim();
  const appointmentId = String(body.appointmentId || '').trim();
  const reason = String(body.reason || '').slice(0, 300);
  if (!tenantId || !appointmentId) {
    return NextResponse.json({ ok: false, error: 'tenantId and appointmentId are required.' }, { status: 400 });
  }

  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager) {
    return NextResponse.json({ ok: false, error: 'Only a manager can do that.' }, { status: 403 });
  }

  const db = getAdminDb();
  const aptSnap = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
  if (!aptSnap.exists) {
    return NextResponse.json({ ok: false, error: 'That booking no longer exists.' }, { status: 404 });
  }
  const apt = aptSnap.data() as any;

  /* Only ever message about a booking that IS cancelled. A route that will
   * send "we cancelled you" for a live appointment is a route that eventually
   * does. */
  if (String(apt.status || '') !== 'cancelled') {
    return NextResponse.json({ ok: false, error: 'That booking is not cancelled.' }, { status: 409 });
  }

  const tenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const client = apt.clientId
    ? ((await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() as any) || {}
    : {};

  const email = String(client.email || apt.clientEmail || '').trim();
  const phone = String(client.phone || apt.clientPhone || '').trim();
  const firstName = String(apt.clientName || '').split(' ')[0] || 'there';
  const studioName = tenant.name || tenant.businessName || 'Your studio';
  const base = String(
    tenant.publicOrigin
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || req.nextUrl.origin,
  ).replace(/\/$/, '');
  const when = apt.startTime
    ? new Date(apt.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'your appointment';

  const depositCents = Number(apt.depositAmountCents || 0);
  const depositPaid = String(apt.depositStatus || '') === 'paid' && depositCents > 0;

  const sent = { emailSent: false, smsSent: false };
  try {
    const { sendNotification } = await import('@/lib/notify');
    const { brandedEmailHtml } = await import('@/lib/email-template');
    const { resolveMessage, tidyBody } = await import('@/lib/message-policy');

    const tokens = {
      client_first: firstName,
      service: apt.serviceName || 'your appointment',
      staff: apt.staffName || '',
      when,
      reason: reason || '',
      amount: `$${(depositCents / 100).toFixed(2)}`,
      refund_line: depositPaid
        ? `Your ${`$${(depositCents / 100).toFixed(2)}`} deposit is being returned.`
        : 'Nothing has been charged.',
      link: `${base}/book/${tenantId}`,
      studio: studioName,
    };

    const msg = resolveMessage(tenant, 'appointment_cancelled_no_cover', tokens, 'email');
    const smsMsg = resolveMessage(tenant, 'appointment_cancelled_no_cover', tokens, 'sms');

    if (msg.send && email.includes('@')) {
      const html = brandedEmailHtml({
        studioName,
        title: msg.subject,
        bodyLines: tidyBody(msg.body).split('\n\n'),
        cta: { label: 'View available times', url: `${base}/book/${tenantId}` },
      });
      const er = await sendNotification(db, {
        tenantId, channel: 'email', to: email,
        subject: msg.subject, html, kind: 'appointment_cancelled_no_cover',
        appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
      sent.emailSent = !!er.ok;
    }
    if (smsMsg.send && phone) {
      const sr = await sendNotification(db, {
        tenantId, channel: 'sms', to: phone,
        text: tidyBody(smsMsg.body), kind: 'appointment_cancelled_no_cover',
        appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
      sent.smsSent = !!sr.ok;
    }
  } catch (e) {
    console.error('[notify-cancellation] send failed', e);
  }

  await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).set({
    cancellationNotified: sent.emailSent || sent.smsSent,
    cancellationNotifiedAt: new Date().toISOString(),
  }, { merge: true }).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    ...sent,
    /* A manager needs to know when nobody could be reached, because then the
     * next step is a phone call and only a person can make it. */
    reachable: sent.emailSent || sent.smsSent,
  });
}
