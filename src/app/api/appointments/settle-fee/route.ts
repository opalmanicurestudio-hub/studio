import { NextRequest, NextResponse } from 'next/server';

import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import {
  computeBreakeven, outcomeEconomics, resolveFeePolicy, settleFee, type FeeEvent,
} from '@/lib/service-economics';
import { collectSettlement } from '@/lib/fee-collection';

// ─── /api/appointments/settle-fee ─────────────────────────────────────────────
// POST { tenantId, appointmentId, event, mode }
//   event : 'late_cancel' | 'no_show' | 'reschedule'
//   mode  : 'preview' (default) | 'collect'
//
// The one place a cancellation, no-show or reschedule fee is decided and
// collected. It exists as a SERVER route rather than logic in the cancel
// dialog for two reasons that both matter:
//
//   1. A fee computed in the browser is a fee anyone can edit. The amount a
//      client is charged has to be decided somewhere they cannot reach.
//   2. Staff were previously typing the fee in by hand. That is not a policy,
//      it is a mood — the same situation gets $0 on a good day and $50 on a
//      bad one, and neither number is defensible if the client disputes it.
//
// 'preview' returns the recommendation so the cancel dialog can prefill and
// explain it. 'collect' does the same maths and then actually moves the
// money: deposit first, card second, recorded balance last. Preview never
// writes anything.

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const appointmentId = String(body.appointmentId || '').trim();
  const event = String(body.event || '') as FeeEvent;
  const mode = body.mode === 'collect' ? 'collect' : 'preview';
  const actor = String(body.actor || 'Staff').slice(0, 80);

  if (!tenantId || !appointmentId || !['late_cancel', 'no_show', 'reschedule'].includes(event)) {
    return NextResponse.json({ ok: false, error: 'tenantId, appointmentId and a valid event are required.' }, { status: 400 });
  }

  const db = getAdminDb();
  const [tenantSnap, aptSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get(),
  ]);
  if (!tenantSnap.exists) return NextResponse.json({ ok: false, error: 'Shop not found' }, { status: 404 });
  if (!aptSnap.exists) return NextResponse.json({ ok: false, error: 'Appointment not found' }, { status: 404 });

  const tenant = tenantSnap.data() as any;
  const apt = aptSnap.data() as any;

  // ── Idempotency: a fee is settled once. A second tap returns what happened
  //    the first time rather than charging again. ──
  if (mode === 'collect' && apt.feeSettledAt) {
    return NextResponse.json({
      ok: true, alreadySettled: true,
      settlement: apt.feeSettlement || null,
      message: 'This fee was already settled.',
    });
  }

  // ── The facts the policy needs ──
  const priceCents = Math.round(
    (Number(apt.priceCents) || Number(apt.price) * 100 || 0),
  ) || Math.round((Number(apt.totalCents) || 0));

  const service = apt.serviceId
    ? ((await db.doc(`tenants/${tenantId}/services/${apt.serviceId}`).get()).data() as any) || {}
    : {};
  const staff = apt.staffId
    ? ((await db.doc(`tenants/${tenantId}/staff/${apt.staffId}`).get()).data() as any) || null
    : null;

  const breakeven = computeBreakeven({
    tenant,
    service: {
      ...service,
      // Prefer what the appointment actually recorded — the service definition
      // may have changed since the booking was taken.
      price: (Number(apt.price) || Number(service.price) || 0),
      duration: Number(apt.durationMinutes) || Number(service.duration) || 0,
    },
    staff,
  });

  // Deposit already held, and whether the shop's policy keeps it.
  const depositHeldCents = Math.round(Number(apt.depositAmountCents) || 0);
  const depositPaid = apt.depositStatus === 'paid';
  const depositForfeited = depositPaid && (
    body.depositForfeited === true
    || event === 'no_show'
    || event === 'late_cancel'
  );

  const hoursUntil = apt.startTime
    ? (Date.parse(apt.startTime) - Date.now()) / 3600000
    : undefined;

  const settlement = settleFee({
    tenant, event,
    priceCents: priceCents || Math.round((Number(apt.price) || 0) * 100),
    depositHeldCents: depositPaid ? depositHeldCents : 0,
    depositForfeited,
    priorRescheduleCount: Number(apt.rescheduleCount) || 0,
    hoursUntilAppointment: hoursUntil,
    breakevenCents: breakeven.totalCents,
  });

  const economics = outcomeEconomics(
    settlement.feeCents + (depositForfeited ? 0 : 0),
    breakeven.totalCents,
  );
  const policy = resolveFeePolicy(tenant, event);

  if (mode === 'preview') {
    return NextResponse.json({
      ok: true,
      settlement,
      breakeven: {
        totalCents: breakeven.totalCents,
        productCents: breakeven.productCents,
        timeCents: breakeven.timeCents,
        labourCents: breakeven.labourCents,
        explanation: breakeven.explanation,
      },
      economics,
      autoCharge: policy.autoCharge,
      // Everything the dialog needs to explain itself to a member of staff
      // without them having to know the policy by heart.
      summary: settlement.waived
        ? settlement.reason
        : `${settlement.reason} ${economics.summary}`,
    });
  }

  // ── Collect ──────────────────────────────────────────────────────────────
  const { internalOrigin } = await import('@/lib/message-policy');
  const origin = internalOrigin(tenant, req.nextUrl.origin);
  const label = event === 'no_show' ? 'No-show fee'
    : event === 'reschedule' ? 'Late reschedule fee'
      : 'Late cancellation fee';

  const collected = await collectSettlement({
    db, tenantId,
    clientId: apt.clientId || null,
    settlement, event,
    description: `${label} — ${apt.serviceName || 'appointment'}`,
    appointmentId,
    origin,
    attemptCharge: policy.autoCharge && body.attemptCharge !== false,
  });

  // Record what happened ON the appointment, so the same question asked
  // tomorrow gets the same answer.
  await aptSnap.ref.set({
    feeSettledAt: new Date().toISOString(),
    feeSettledBy: actor,
    feeEvent: event,
    feeSettlement: {
      feeCents: settlement.feeCents,
      coveredByDepositCents: settlement.coveredByDepositCents,
      shortfallCents: settlement.shortfallCents,
      chargedCents: collected.chargedCents,
      arrearsCents: collected.arrearsCents,
      refundableCents: collected.refundableCents,
      belowBreakeven: settlement.belowBreakeven,
      breakevenGapCents: settlement.breakevenGapCents,
    },
  }, { merge: true });

  // Income line for the part actually collected by card. The forfeited
  // deposit is already recognised as revenue by the cancellation flow, so
  // recognising it again here would double-count it.
  if (collected.chargedCents > 0) {
    const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await txnRef.set({
      id: txnRef.id, tenantId, appointmentId,
      clientId: apt.clientId || null, clientName: apt.clientName || 'Client',
      date: new Date().toISOString(),
      type: 'income', context: 'Business', taxBucket: 'revenue',
      category: label,
      amount: collected.chargedCents / 100,
      amountCents: collected.chargedCents,
      paymentMethod: 'Card on file (Stripe)', hasReceipt: false,
      description: `${label} — ${apt.serviceName || 'appointment'}`,
    });
  }

  await logAuditAdmin(db, tenantId, {
    action: `appointment.fee_${event}`,
    targetType: 'appointment', targetId: appointmentId,
    summary: `${label}: ${collected.summary}${settlement.belowBreakeven ? ` (still $${(settlement.breakevenGapCents / 100).toFixed(2)} below the slot's cost)` : ''}`,
    actor: { type: 'user', name: actor, role: 'staff', via: 'cancellation' },
  }).catch(() => {});

  // ── Tell the client, in the shop's own words ──
  let notified = false;
  if (collected.chargedCents > 0 || collected.arrearsCents > 0) {
    try {
      const { resolveMessage, tidyBody } = await import('@/lib/message-policy');
      const { sendNotification } = await import('@/lib/notify');
      const { brandedEmailHtml } = await import('@/lib/email-template');

      const client = apt.clientId
        ? ((await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() as any) || {}
        : {};
      const email = String(client.email || apt.clientEmail || '').trim();
      const studioName = tenant.name || tenant.businessName || 'Your studio';
      const amountCents = collected.chargedCents > 0 ? collected.chargedCents : collected.arrearsCents;
      const kind = collected.chargedCents > 0 ? 'fee_charged' : 'balance_outstanding';

      const msg = resolveMessage(tenant, kind, {
        client_first: String(apt.clientName || '').split(' ')[0],
        amount: `$${(amountCents / 100).toFixed(2)}`,
        when: apt.startTime
          ? new Date(apt.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
          : '',
        service: apt.serviceName || 'your appointment',
        fee_reason: label.toLowerCase(),
        link: origin ? `${origin}/check-in/${apt.checkInToken || ''}` : '',
        studio: studioName,
      }, 'email');

      if (msg.send && email.includes('@')) {
        const r = await sendNotification(db, {
          tenantId, channel: 'email', to: email,
          subject: msg.subject,
          html: brandedEmailHtml({
            studioName,
            title: msg.subject,
            bodyLines: tidyBody(msg.body).split('\n\n'),
          }),
          kind, appointmentId,
          clientId: apt.clientId || null, clientName: apt.clientName || null,
        });
        notified = !!r.ok;
      }
    } catch (e) {
      console.error('[settle-fee] notify failed (the settlement stands)', e);
    }
  }

  return NextResponse.json({
    ok: true,
    settlement,
    collected,
    economics,
    notified,
    message: settlement.waived
      ? settlement.reason
      : `${collected.summary}${settlement.belowBreakeven ? ` Note: even the full fee is $${(settlement.breakevenGapCents / 100).toFixed(2)} short of what the slot costs you.` : ''}`,
  });
}
