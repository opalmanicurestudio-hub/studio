import { NextRequest, NextResponse } from 'next/server';

import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor, decisionVerdict, actorAuthority } from '@/lib/staff-auth';
import { REASONS_BY_CODE } from '@/lib/appointment-authority';

// ─── /api/appointments/decide ─────────────────────────────────────────────────
// POST { tenantId, appointmentId, decision: 'accept' | 'decline',
//        staffName?, reason?, suggestAlternative? }
//
// The studio's answer to a booking request. Two outcomes, both final and both
// honest with the client:
//
//   accept  → acceptance is the moment the money is asked for, and HOW it is
//             asked depends on whether we already hold a card:
//               • card on file  → the deposit is charged off-session right
//                 here. Success confirms outright; the client's next contact
//                 is a receipt, not a chore. Failure does NOT silently confirm
//                 and does NOT silently cancel — the row lands in
//                 'pending_payment' with the decline code recorded, the client
//                 gets a "card didn't go through, here's the link" email, and
//                 the studio sees the failure on the appointment.
//               • no card       → 'pending_payment' plus the pay link, exactly
//                 as before.
//             With no deposit owed, acceptance simply confirms.
//   decline → status becomes 'declined', the slot frees immediately, and the
//             client is told plainly, with an invitation to pick another time
//             rather than a dead end.
//
// Idempotent by construction: the transaction refuses to decide anything that
// is not still 'requested', so a double-tap on a slow connection cannot
// accept-then-decline, and two staff answering at once cannot both win.

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const appointmentId = String(body.appointmentId || '').trim();
  const decision = String(body.decision || '').trim();
  /* 'alternative' (default) = this TIME does not work, come back for another.
   * 'final' = this BOOKING does not work — not taking new clients, not a
   * service offered, not a fit. Sending "here are other times" to someone you
   * are declining as a client reads as a brush-off and invites a booking you
   * will decline again, so the studio says which it is and the wording
   * follows. */
  const declineOutcome = body.declineOutcome === 'final' ? 'final' : 'alternative';
  const reason = String(body.reason || '').slice(0, 300);
  const reasonCode = String(body.reasonCode || '').slice(0, 60) || null;

  if (!tenantId || !appointmentId || !['accept', 'decline'].includes(decision)) {
    return NextResponse.json({ ok: false, error: 'tenantId, appointmentId and a valid decision are required.' }, { status: 400 });
  }

  /* WHO IS CALLING. Until this existed, anyone able to POST a tenantId and an
   * appointmentId could accept a booking — which charges a card off-session —
   * or decline one, and the audit line recorded whatever name they sent. */
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const actor = auth.actor;
  const tenantDoc = auth.tenant || {};
  const authorityPolicy = (tenantDoc?.appointmentAuthority as any) || null;
  const verdict = decisionVerdict(actor, decision as 'accept' | 'decline', {
    reasonCode,
    policy: authorityPolicy,
  });
  if (!verdict.allowed) {
    /* A refusal is not a dead end. raiseRequest tells the caller the honest
     * next step is a manager, which is the difference between "you may not"
     * and "here is how this gets solved." */
    return NextResponse.json({
      ok: false,
      error: verdict.reason,
      raiseRequest: verdict.raiseRequest,
      authority: actorAuthority(actor, authorityPolicy),
    }, { status: 403 });
  }
  if (authorityPolicy?.requireDeclineReason && decision === 'decline' && !reasonCode) {
    return NextResponse.json({
      ok: false,
      error: 'Pick a reason for declining — your shop records one on every decline.',
      raiseRequest: false,
    }, { status: 400 });
  }
  const staffName = actor.name;

  const db = getAdminDb();
  const aptRef = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`);
  const nowIso = new Date().toISOString();
  // Read once up front: the transaction needs the grace window, and the
  // notification block below needs the shop's branding and message policy.
  const tenantForGrace = tenantDoc;

  let outcome: any;
  try {
    outcome = await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(aptRef);
      if (!snap.exists) return { error: 'That appointment no longer exists.', code: 404 };
      const apt = snap.data() as any;

      if (apt.status !== 'requested') {
        // Not an error worth alarming anyone about — usually a second tap.
        return {
          error: apt.status === 'confirmed' || apt.status === 'pending_payment'
            ? 'That request was already accepted.'
            : `That request was already ${apt.status === 'declined' ? 'declined' : String(apt.status).replace(/_/g, ' ')}.`,
          code: 409,
          alreadyStatus: apt.status,
        };
      }

      const depositCents = Number(apt.depositAmountCents) || 0;

      if (decision === 'accept') {
        /* The charge itself cannot run inside a transaction — Stripe is not
         * transactional and a retry would double-charge. So the txn only
         * CLAIMS the decision (nobody else can now decide this request), and
         * the charge runs immediately after, updating the row again. */
        const nextStatus = depositCents > 0 && apt.depositStatus !== 'paid'
          ? 'pending_payment'
          : 'confirmed';
        /* The unpaid-accepted hold gets the shop's grace window rather than
         * the 30-minute checkout clock — see paymentDueAt in message-policy. */
        const graceHours = (() => {
          const v = Number((tenantForGrace?.bookingMode || {}).paymentGraceHours);
          return Number.isFinite(v) && v >= 0 ? v : 24;
        })();
        const dueAt = nextStatus === 'pending_payment' && graceHours > 0
          ? (() => {
            let due = Date.now() + graceHours * 3600000;
            const start = apt.startTime ? Date.parse(apt.startTime) : NaN;
            if (Number.isFinite(start) && start < due) due = start;
            return new Date(due).toISOString();
          })()
          : null;
        tx.update(aptRef, {
          status: nextStatus,
          decidedAt: nowIso,
          decidedBy: staffName,
          requestExpiresAt: null,
          ...(nextStatus === 'pending_payment' ? { paymentDueAt: dueAt } : { paymentDueAt: null }),
          // The hold clock restarts NOW: the client has not been waiting on
          // themselves, they have been waiting on us, so they get the full
          // window from the moment of acceptance.
          createdAt: nextStatus === 'pending_payment' ? nowIso : apt.createdAt,
          ...(apt.createdAt && nextStatus === 'pending_payment' ? { originallyRequestedAt: apt.createdAt } : {}),
        });
        return { ok: true, status: nextStatus, depositCents, apt, dueAt, needsCharge: nextStatus === 'pending_payment' };
      }

      tx.update(aptRef, {
        status: 'declined',
        decidedAt: nowIso,
        decidedBy: staffName,
        declineReason: reason || null,
        declineOutcome,
        requestExpiresAt: null,
      });
      return { ok: true, status: 'declined', depositCents, apt };
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'Could not record that decision — nothing changed.' }, { status: 500 });
  }

  if (outcome?.error) {
    return NextResponse.json({ ok: false, error: outcome.error, alreadyStatus: outcome.alreadyStatus || null }, { status: outcome.code || 409 });
  }

  const apt = outcome.apt || {};
  const accepted = outcome.status !== 'declined';
  // Human-readable deadline for the hold, used in both the client copy and
  // the studio's own confirmation toast.
  const holdUntil = outcome.dueAt
    ? new Date(outcome.dueAt).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })
    : '';

  /* ═══ AUTO-CHARGE THE DEPOSIT WHEN WE HOLD A CARD ═════════════════════════
   * The honest version of "we'll ask for the deposit when we accept": if the
   * client already gave us a card, asking again is friction for no reason —
   * we charge it and tell them. Everything about failure is explicit: no
   * silent confirm, no silent cancel, a real reason code on the row, and a
   * client email that says what to do next. */
  let chargeResult: { attempted: boolean; ok: boolean; reason?: string; code?: string; guidance?: string } = { attempted: false, ok: false };
  let chargeReference = '';
  if (accepted && outcome.needsCharge && outcome.depositCents > 0 && apt.clientId) {
    try {
      const clientSnap = await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get();
      const card = (clientSnap.data() as any)?.cardOnFile;
      if (card?.customerId && card?.paymentMethodId) {
        chargeResult.attempted = true;
        /* Resilient internal call: a resolved origin (never just the incoming
         * request's), a bounded wait, and one retry on a cold start. A charge
         * that quietly became "send them a pay link" because a serverless
         * function was warming up is a failure nobody reports. */
        const { internalOrigin, internalPost } = await import('@/lib/message-policy');
        const cr = await internalPost(
          internalOrigin(tenantForGrace, req.nextUrl.origin),
          '/api/stripe/charge-card',
          {
            tenantId, clientId: apt.clientId,
            amountCents: outcome.depositCents,
            description: 'Deposit',
            category: 'Deposits',
            appointmentId,
            reason: apt.serviceName || 'Appointment deposit',
            // 'deposit' kind deliberately: an arrears fee parks itself as a
            // client balance on failure, which would be wrong here — an
            // unpaid deposit means the slot is not yet earned, not that the
            // client owes us money.
            kind: 'deposit',
            mode: 'auto',
          },
        );
        const cd = cr.data || {};
        chargeResult.ok = cr.ok && cd.ok === true;
        if (chargeResult.ok && cd.paymentIntentId) {
          /* The tail is what a client reads back over the phone — the whole
           * intent id is noise to them and to whoever answers. */
          chargeReference = String(cd.paymentIntentId).slice(-8).toUpperCase();
        }
        if (cr.transportError) {
          // Distinguish "the card said no" from "we never got to ask" — they
          // need different words and different retry behaviour.
          cd.reason = `Could not reach the payment processor (${cr.transportError})`;
          cd.declineCode = 'network';
        }
        if (chargeResult.ok) {
          await aptRef.update({
            status: 'confirmed',
            depositStatus: 'paid',
            depositPaidAt: nowIso,
            depositChargedOnFile: true,
            depositPaymentIntentId: cd.paymentIntentId || null,
            depositFailureReason: null,
            depositFailureCode: null,
          });
          outcome.status = 'confirmed';
        } else {
          chargeResult.reason = String(cd.reason || 'Card declined');
          chargeResult.code = String(cd.declineCode || cd.code || 'charge_failed');
          /* Stays pending_payment — accepted, but not yet paid for. The
           * failure is CLASSIFIED so the client gets a next step rather than
           * a diagnosis, and so the nightly retry knows whether trying this
           * same card again could ever work. An expired card will never work;
           * retrying it is a second failure with the client's hope attached. */
          const { classifyCardFailure } = await import('@/lib/message-policy');
          const cf = classifyCardFailure(chargeResult.code, cd.declineCode);
          await aptRef.update({
            depositStatus: 'failed',
            depositFailureReason: chargeResult.reason,
            depositFailureCode: cf.code,
            depositFailureGuidance: cf.guidance,
            depositRetryable: cf.retryable,
            depositNeedsNewCard: cf.needsNewCard,
            depositFailedAt: nowIso,
            depositAttempts: (Number(apt.depositAttempts) || 0) + 1,
          });
          chargeResult.guidance = cf.guidance;
        }
      }
    } catch (e) {
      chargeResult.reason = 'Could not reach the card processor';
      chargeResult.code = 'network';
      await aptRef.update({
        depositStatus: 'failed',
        depositFailureReason: chargeResult.reason,
        depositFailureCode: chargeResult.code,
        depositFailedAt: nowIso,
      }).catch(() => {});
    }
  }

  await logAuditAdmin(db, tenantId, {
    action: accepted ? 'appointment.request_accepted' : 'appointment.request_declined',
    targetType: 'appointment', targetId: appointmentId,
    summary: `${staffName} ${accepted ? 'accepted' : 'declined'} ${apt.clientName || 'a client'}'s request for ${String(apt.startTime || '').slice(0, 16).replace('T', ' ')}${reason ? ` — ${reason}` : ''}`,
    actor: { type: 'user', id: actor.uid, name: actor.name, role: actor.role, via: 'requests' },
  }).catch(() => {});

  // ── Tell the client. A decision nobody hears about is not a decision. ──
  const sendStatus = { emailSent: false, smsSent: false };
  try {
    const tenant = tenantDoc;
    const studioName = tenant.name || tenant.businessName || 'Your studio';
    const base = String(
      tenant.publicOrigin
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
      || req.nextUrl.origin,
    ).replace(/\/$/, '');
    const portalUrl = apt.checkInToken ? `${base}/check-in/${apt.checkInToken}` : `${base}/book/${tenantId}`;
    const bookUrl = `${base}/book/${tenantId}`;

    const client = apt.clientId
      ? ((await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get()).data() as any) || {}
      : {};
    const email = String(client.email || apt.clientEmail || '').trim();
    const phone = String(client.phone || apt.clientPhone || '').trim();
    const firstName = String(apt.clientName || '').split(' ')[0] || 'there';

    const when = apt.startTime
      ? new Date(apt.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'your requested time';
    const money = `$${((Number(outcome.depositCents) || 0) / 100).toFixed(2)}`;
    const needsDeposit = outcome.status === 'pending_payment';
    const chargedOnFile = chargeResult.attempted && chargeResult.ok;
    const cardFailed = chargeResult.attempted && !chargeResult.ok;

    const { sendNotification } = await import('@/lib/notify');
    const { brandedEmailHtml } = await import('@/lib/email-template');
    const { resolveMessage, tidyBody } = await import('@/lib/message-policy');

    /* THE WORDS COME FROM THE CATALOG, NOT FROM HERE. Every sentence below
     * used to be a string literal in this file, which meant the shop could
     * not change it however hard it tried. Now this route supplies only the
     * FACTS as tokens; the sentence is the shop's — their own if they wrote
     * one, the shipped default if not. */
    const kind = accepted
      ? (cardFailed ? 'deposit_failed' : chargedOnFile ? 'deposit_charged' : needsDeposit ? 'booking_hold' : 'request_accepted')
      : (declineOutcome === 'final' ? 'request_declined_final' : 'request_declined');

    const msgTokens = {
      client_first: firstName,
      service: apt.serviceName || 'your appointment',
      staff: apt.staffName || '',
      when,
      amount: money,
      reason,
      card_issue: chargeResult.guidance || '',
      hold_until: holdUntil,
      /* A confirmation says money left; a receipt says which money, when, and
       * what to quote if they ring up about it. Empty strings when there was
       * no charge, so a shop that puts them in its own wording never renders
       * "paid at undefined". */
      paid_at: chargeResult.ok
        ? new Date(nowIso).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '',
      reference: chargeResult.ok && chargeReference ? chargeReference : '',
      link: portalUrl,
      code: apt.shortCode ? String(apt.shortCode).toUpperCase() : '',
      studio: studioName,
    };
    const msg = resolveMessage(tenant, kind, msgTokens, 'email');
    const smsMsg = resolveMessage(tenant, kind, msgTokens, 'sms');

    if (msg.send && email.includes('@')) {
      const html = brandedEmailHtml({
        studioName,
        title: msg.subject,
        bodyLines: tidyBody(msg.body).split('\n\n'),
        ...(accepted && !needsDeposit && !cardFailed && apt.shortCode
          ? { bigCode: String(apt.shortCode).toUpperCase() } : {}),
        cta: {
          label: cardFailed ? 'Pay deposit' : needsDeposit ? 'Pay deposit' : accepted ? 'Manage my visit' : 'View available times',
          url: accepted ? portalUrl : bookUrl,
        },
      });
      const er = await sendNotification(db, {
        tenantId, channel: 'email', to: email,
        subject: msg.subject,
        html, kind: accepted ? 'request_accepted' : 'request_declined',
        appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
      sendStatus.emailSent = !!er.ok;
    }

    if (smsMsg.send && phone) {
      const sr = await sendNotification(db, {
        tenantId, channel: 'sms', to: phone,
        text: tidyBody(smsMsg.body),
        kind: accepted ? 'request_accepted' : 'request_declined',
        appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
      sendStatus.smsSent = !!sr.ok;
    }
  } catch (e) {
    console.error('[appointments/decide] notify failed (decision is safe)', e);
  }

  /* THE DECISION LEDGER. One row per answered request, written after the
   * decision is safe. Metrics, response times and pattern review all read
   * from here — and history cannot be backfilled, so it is written from the
   * first day the endpoint can identify its caller. A failure here never
   * unwinds a decision that already stands. */
  try {
    const requestedAtIso = String(apt.requestedAt || apt.createdAt || '');
    const requestedMs = requestedAtIso ? Date.parse(requestedAtIso) : NaN;
    await db.collection(`tenants/${tenantId}/appointmentDecisions`).add({
      tenantId,
      appointmentId,
      clientId: apt.clientId || null,
      clientName: apt.clientName || null,
      serviceId: apt.serviceId || null,
      staffId: apt.staffId || null,
      startTime: apt.startTime || null,
      source: apt.source || null,
      channel: 'request',
      action: accepted ? 'accepted' : 'declined',
      declineOutcome: accepted ? null : declineOutcome,
      reasonCode,
      reasonLabel: reasonCode ? (REASONS_BY_CODE[reasonCode]?.label || null) : null,
      reason: reason || null,
      decidedVia: verdict.allowed ? verdict.via : null,
      actorAuthority: actorAuthority(actor, authorityPolicy),
      priorStatus: 'requested',
      resultStatus: outcome.status,
      depositCents: outcome.depositCents || 0,
      chargedOnFile: chargeResult.attempted && chargeResult.ok,
      actorUid: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      actorIsManager: actor.isManager,
      decidedAt: nowIso,
      requestedAt: requestedAtIso || null,
      responseSeconds: Number.isFinite(requestedMs)
        ? Math.max(0, Math.round((Date.parse(nowIso) - requestedMs) / 1000))
        : null,
    });
  } catch (e) {
    console.error('[appointments/decide] decision record failed (decision stands)', e);
  }

  return NextResponse.json({
    ok: true,
    status: outcome.status,
    depositCents: outcome.depositCents,
    sendStatus,
    chargedOnFile: chargeResult.attempted && chargeResult.ok,
    chargeFailed: chargeResult.attempted && !chargeResult.ok,
    chargeFailureReason: chargeResult.reason || null,
    chargeGuidance: chargeResult.guidance || null,
    paymentDueAt: outcome.dueAt || null,
    message: accepted
      ? (chargeResult.attempted && chargeResult.ok
        ? `Accepted — the ${(outcome.depositCents / 100).toFixed(2)} deposit was charged to their card on file.`
        : chargeResult.attempted
          ? `Accepted, but their card was declined. ${chargeResult.guidance || ''} They have a link to pay another way${holdUntil ? `, and the time is held until ${holdUntil}` : ' and the time is still held'}.`
          : outcome.status === 'pending_payment'
            ? 'Accepted — the client has been asked for their deposit.'
            : 'Accepted and confirmed — the client has been told.')
      : 'Declined — the time is free again and the client has been told.',
  });
}
