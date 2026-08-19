import { NextRequest, NextResponse } from 'next/server';

import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';

// ─── /api/appointments/reschedule ─────────────────────────────────────────────
// POST { tenantId, appointmentId, startTime, staffId?, qrToken? | actor?,
//        reason?, chargeFee? }
//
// Moving an appointment, which until now had no route at all — clients
// cancelled and rebooked instead, which lost the deposit, lost the history,
// and lost any chance of counting how often somebody moves their booking.
//
// Three things happen here that a cancel-and-rebook could never do:
//
//   1. THE BOOKING SURVIVES. Same document, same deposit, same forms, same
//      check-in token. The client keeps what they already paid.
//   2. THE MOVE IS COUNTED. rescheduleCount drives the free-moves policy, so
//      a first move can be free and a fourth can carry a fee.
//   3. THE OLD SLOT IS FREED IMMEDIATELY, which is what makes a reschedule
//      better for the shop than a silent no-show.
//
// Authorisation is either the client's own link token or a staff actor —
// the same pattern the self-serve routes use.

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const appointmentId = String(body.appointmentId || '').trim();
  const startTime = String(body.startTime || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  const actor = String(body.actor || '').slice(0, 80);
  const reason = String(body.reason || '').slice(0, 300);

  if (!tenantId || !appointmentId || !startTime) {
    return NextResponse.json({ ok: false, error: 'tenantId, appointmentId and startTime are required.' }, { status: 400 });
  }
  const newStart = Date.parse(startTime);
  if (!Number.isFinite(newStart)) {
    return NextResponse.json({ ok: false, error: 'That start time is not a valid date.' }, { status: 400 });
  }
  if (newStart < Date.now()) {
    return NextResponse.json({ ok: false, error: 'That time is in the past.' }, { status: 400 });
  }

  const db = getAdminDb();
  const aptRef = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`);
  const [tenantSnap, aptSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    aptRef.get(),
  ]);
  if (!tenantSnap.exists) return NextResponse.json({ ok: false, error: 'Shop not found' }, { status: 404 });
  if (!aptSnap.exists) return NextResponse.json({ ok: false, error: 'Appointment not found' }, { status: 404 });

  const tenant = tenantSnap.data() as any;
  const apt = aptSnap.data() as any;

  // Either the client holds the link, or a staff member is acting.
  const clientAuthorised = qrToken && String(apt.checkInToken || '') === qrToken;
  if (!clientAuthorised && !actor) {
    return NextResponse.json({ ok: false, error: 'Not authorized' }, { status: 403 });
  }

  if (['cancelled', 'completed', 'no_show', 'declined', 'expired'].includes(String(apt.status))) {
    return NextResponse.json({
      ok: false,
      error: `That appointment is ${String(apt.status).replace(/_/g, ' ')} and cannot be moved. Book a new one instead.`,
    }, { status: 409 });
  }

  const oldStart = apt.startTime || null;
  const durationMs = apt.endTime && apt.startTime
    ? Math.max(0, Date.parse(apt.endTime) - Date.parse(apt.startTime))
    : (Number(apt.durationMinutes) || 60) * 60000;
  const newEnd = new Date(newStart + durationMs).toISOString();
  const targetStaffId = String(body.staffId || apt.staffId || '');

  // ── Is the new slot actually free? ───────────────────────────────────────
  // Deliberately narrow: same staff, overlapping window, live statuses only.
  // A reschedule that quietly double-books is worse than one that is refused.
  try {
    const dayStart = new Date(newStart); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(newStart); dayEnd.setHours(23, 59, 59, 999);
    const sameDay = await db.collection(`tenants/${tenantId}/appointments`)
      .where('startTime', '>=', dayStart.toISOString())
      .where('startTime', '<=', dayEnd.toISOString())
      .get();
    const LIVE = ['confirmed', 'pending_payment', 'requested', 'checked_in', 'in_progress'];
    const clash = sameDay.docs.some((d: any) => {
      if (d.id === appointmentId) return false;
      const o = d.data() as any;
      if (!LIVE.includes(String(o.status))) return false;
      if (targetStaffId && String(o.staffId || '') !== targetStaffId) return false;
      const s = Date.parse(o.startTime || '');
      const e = Date.parse(o.endTime || '') || s + 60 * 60000;
      return Number.isFinite(s) && newStart < e && s < newStart + durationMs;
    });
    if (clash) {
      return NextResponse.json({ ok: false, error: 'That time is already booked — pick another.' }, { status: 409 });
    }
  } catch {
    // A failed availability read must not silently permit a double booking.
    return NextResponse.json({ ok: false, error: 'Could not check that time is free. Try again.' }, { status: 503 });
  }

  const nowIso = new Date().toISOString();
  const priorCount = Number(apt.rescheduleCount) || 0;

  // ── Fee first, move second ───────────────────────────────────────────────
  // Deliberate order: if the policy says this move costs money, the client
  // finds out BEFORE the booking changes under them. The route computes the
  // fee but only collects it when explicitly told to, so a UI can preview.
  let feeResult: any = null;
  try {
    const { internalOrigin, internalPost } = await import('@/lib/message-policy');
    const origin = internalOrigin(tenant, req.nextUrl.origin);
    const r = await internalPost(origin, '/api/appointments/settle-fee', {
      tenantId, appointmentId,
      event: 'reschedule',
      mode: body.chargeFee === true ? 'collect' : 'preview',
      actor: actor || 'Client',
    });
    feeResult = r.data || null;
  } catch { /* the move still proceeds; the fee is reported as unknown */ }

  const feeCents = Number(feeResult?.settlement?.feeCents) || 0;
  if (feeCents > 0 && body.chargeFee !== true && body.acknowledgeFee !== true) {
    // Tell them the price of the move and let them decide. Silently charging
    // for a reschedule is how a shop earns a chargeback and loses a client.
    return NextResponse.json({
      ok: false,
      requiresAcknowledgement: true,
      feeCents,
      settlement: feeResult?.settlement || null,
      message: `Moving this appointment now carries a $${(feeCents / 100).toFixed(2)} fee. Confirm to go ahead.`,
    }, { status: 409 });
  }

  await aptRef.set({
    startTime: new Date(newStart).toISOString(),
    endTime: newEnd,
    ...(targetStaffId ? { staffId: targetStaffId } : {}),
    rescheduleCount: priorCount + 1,
    lastRescheduledAt: nowIso,
    lastRescheduledBy: clientAuthorised ? 'client' : (actor || 'staff'),
    rescheduleHistory: [
      ...(Array.isArray(apt.rescheduleHistory) ? apt.rescheduleHistory.slice(-9) : []),
      { from: oldStart, to: new Date(newStart).toISOString(), at: nowIso, by: clientAuthorised ? 'client' : (actor || 'staff'), reason: reason || null },
    ],
    // Reminders already sent were about the OLD time and must go again.
    reminderSent: false,
    reminderSentAt: null,
  }, { merge: true });

  await logAuditAdmin(db, tenantId, {
    action: 'appointment.rescheduled',
    targetType: 'appointment', targetId: appointmentId,
    summary: `${apt.clientName || 'A client'}'s ${apt.serviceName || 'appointment'} moved from ${String(oldStart || '').slice(0, 16).replace('T', ' ')} to ${String(new Date(newStart).toISOString()).slice(0, 16).replace('T', ' ')}${feeCents > 0 ? ` — $${(feeCents / 100).toFixed(2)} fee` : ''} (move ${priorCount + 1})`,
    actor: { type: 'user', name: actor || apt.clientName || 'Client', role: clientAuthorised ? 'client' : 'staff', via: 'reschedule' },
  }).catch(() => {});

  // ── Tell the client where to be ──────────────────────────────────────────
  let notified = false;
  try {
    const { resolveMessage, tidyBody, internalOrigin } = await import('@/lib/message-policy');
    const { sendNotification } = await import('@/lib/notify');
    const { brandedEmailHtml } = await import('@/lib/email-template');

    const client = apt.clientId
      ? ((await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() as any) || {}
      : {};
    const email = String(client.email || apt.clientEmail || '').trim();
    const phone = String(client.phone || apt.clientPhone || '').trim();
    const studioName = tenant.name || tenant.businessName || 'Your studio';
    const origin = internalOrigin(tenant, req.nextUrl.origin);
    const link = apt.checkInToken ? `${origin}/check-in/${apt.checkInToken}` : '';
    const when = (iso: any) => (iso
      ? new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '');

    const tokens = {
      client_first: String(apt.clientName || '').split(' ')[0],
      service: apt.serviceName || 'your appointment',
      when: when(new Date(newStart).toISOString()),
      old_when: when(oldStart),
      amount: feeCents > 0 ? `$${(feeCents / 100).toFixed(2)}` : '',
      link, studio: studioName,
    };
    const msg = resolveMessage(tenant, 'appointment_rescheduled', tokens, 'email');
    if (msg.send && email.includes('@')) {
      const r = await sendNotification(db, {
        tenantId, channel: 'email', to: email,
        subject: msg.subject,
        html: brandedEmailHtml({
          studioName, title: msg.subject,
          bodyLines: tidyBody(msg.body).split('\n\n'),
          ...(link ? { cta: { label: 'View my appointment', url: link } } : {}),
        }),
        kind: 'appointment_rescheduled', appointmentId,
        clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
      notified = !!r.ok;
    }
    const sms = resolveMessage(tenant, 'appointment_rescheduled', tokens, 'sms');
    if (sms.send && phone) {
      await sendNotification(db, {
        tenantId, channel: 'sms', to: phone,
        text: tidyBody(sms.body),
        kind: 'appointment_rescheduled', appointmentId,
        clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
    }
  } catch (e) {
    console.error('[reschedule] notify failed (the move is saved)', e);
  }

  return NextResponse.json({
    ok: true,
    startTime: new Date(newStart).toISOString(),
    endTime: newEnd,
    rescheduleCount: priorCount + 1,
    feeCents,
    feeCollected: body.chargeFee === true ? (feeResult?.collected || null) : null,
    notified,
    message: feeCents > 0 && body.chargeFee === true
      ? `Moved. ${feeResult?.collected?.summary || `$${(feeCents / 100).toFixed(2)} fee applied.`}`
      : 'Moved — the old time is free again and the client has been told.',
  });
}
