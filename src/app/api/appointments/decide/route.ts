import { NextRequest, NextResponse } from 'next/server';

import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';

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
  const staffName = String(body.staffName || 'The studio').slice(0, 80);
  const reason = String(body.reason || '').slice(0, 300);

  if (!tenantId || !appointmentId || !['accept', 'decline'].includes(decision)) {
    return NextResponse.json({ ok: false, error: 'tenantId, appointmentId and a valid decision are required.' }, { status: 400 });
  }

  const db = getAdminDb();
  const aptRef = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`);
  const nowIso = new Date().toISOString();

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
        tx.update(aptRef, {
          status: nextStatus,
          decidedAt: nowIso,
          decidedBy: staffName,
          requestExpiresAt: null,
          // The hold clock restarts NOW: the client has not been waiting on
          // themselves, they have been waiting on us, so they get the full
          // window from the moment of acceptance.
          createdAt: nextStatus === 'pending_payment' ? nowIso : apt.createdAt,
          ...(apt.createdAt && nextStatus === 'pending_payment' ? { originallyRequestedAt: apt.createdAt } : {}),
        });
        return { ok: true, status: nextStatus, depositCents, apt, needsCharge: nextStatus === 'pending_payment' };
      }

      tx.update(aptRef, {
        status: 'declined',
        decidedAt: nowIso,
        decidedBy: staffName,
        declineReason: reason || null,
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

  /* ═══ AUTO-CHARGE THE DEPOSIT WHEN WE HOLD A CARD ═════════════════════════
   * The honest version of "we'll ask for the deposit when we accept": if the
   * client already gave us a card, asking again is friction for no reason —
   * we charge it and tell them. Everything about failure is explicit: no
   * silent confirm, no silent cancel, a real reason code on the row, and a
   * client email that says what to do next. */
  let chargeResult: { attempted: boolean; ok: boolean; reason?: string; code?: string } = { attempted: false, ok: false };
  if (accepted && outcome.needsCharge && outcome.depositCents > 0 && apt.clientId) {
    try {
      const clientSnap = await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get();
      const card = (clientSnap.data() as any)?.cardOnFile;
      if (card?.customerId && card?.paymentMethodId) {
        chargeResult.attempted = true;
        const cr = await fetch(`${req.nextUrl.origin}/api/stripe/charge-card`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          }),
        });
        const cd = await cr.json().catch(() => ({}));
        chargeResult.ok = cr.ok && cd.ok === true;
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
          chargeResult.code = String(cd.code || 'charge_failed');
          // Stays pending_payment — accepted, but not yet paid for.
          await aptRef.update({
            depositStatus: 'failed',
            depositFailureReason: chargeResult.reason,
            depositFailureCode: chargeResult.code,
            depositFailedAt: nowIso,
          });
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
    actor: { type: 'user', name: staffName, role: 'staff', via: 'requests' },
  }).catch(() => {});

  // ── Tell the client. A decision nobody hears about is not a decision. ──
  const sendStatus = { emailSent: false, smsSent: false };
  try {
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const tenant = (tenantSnap.data() as any) || {};
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

    if (email.includes('@')) {
      const html = accepted
        ? brandedEmailHtml({
          studioName,
          title: cardFailed
            ? 'Accepted — but your card was declined'
            : needsDeposit ? 'Accepted — one step to lock it in' : "You're confirmed",
          bodyLines: [
            `Good news, ${firstName} — we can take you on ${when}.`,
            ...(cardFailed
              // Never blame the client, never bury the consequence.
              ? [
                `We tried the card we have on file for the ${money} deposit and it did not go through${chargeResult.code === 'card_declined' ? '' : ''}. That happens — an expired card or a bank hold is usually all it is.`,
                'Tap below to pay it with any card and your time is locked in. We are holding it for you in the meantime.',
              ]
              : chargedOnFile
                ? [`We have charged the ${money} deposit to the card on file — nothing else to do. It goes toward your total.`]
                : needsDeposit
                  ? [`To finish, tap below and pay the ${money} deposit. It goes toward your total, and the time is yours the moment it clears.`]
                  : ['Nothing else is needed. Show the code below when you arrive.']),
          ],
          ...(needsDeposit || cardFailed ? {} : { bigCode: apt.shortCode ? String(apt.shortCode).toUpperCase() : undefined }),
          cta: {
            label: cardFailed ? 'Pay deposit with another card' : needsDeposit ? 'Pay deposit & confirm' : 'Check in / manage my visit',
            url: portalUrl,
          },
          footerNote: `Questions? Just reply — ${studioName}.`,
        })
        : brandedEmailHtml({
          studioName,
          title: 'About your request',
          bodyLines: [
            `Hi ${firstName} — we are sorry, we cannot take ${when}.`,
            reason || 'That slot will not work on our end.',
            'Nothing was charged. Please do pick another time — we would love to see you.',
          ],
          cta: { label: 'Choose another time', url: bookUrl },
          footerNote: `Thank you for thinking of us — ${studioName}.`,
        });
      const er = await sendNotification(db, {
        tenantId, channel: 'email', to: email,
        subject: accepted
          ? (cardFailed
            ? `Your card didn't go through — ${when}`
            : chargedOnFile
              ? `Confirmed: ${when} — deposit charged`
              : needsDeposit ? `Accepted — finish booking your ${when}` : `Confirmed: ${when}`)
          : `About your request for ${when}`,
        html, kind: accepted ? 'request_accepted' : 'request_declined',
        appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
      sendStatus.emailSent = !!er.ok;
    }

    if (phone) {
      const sr = await sendNotification(db, {
        tenantId, channel: 'sms', to: phone,
        text: accepted
          ? (cardFailed
            ? `Good news — we can take ${when}. Your card on file was declined for the ${money} deposit; pay with another card here and it's locked in: ${portalUrl}`
            : chargedOnFile
              ? `You're confirmed for ${when}. The ${money} deposit was charged to your card on file. Details: ${portalUrl}`
              : needsDeposit
                ? `Good news — we can take ${when}. Pay the ${money} deposit to lock it in: ${portalUrl}`
                : `You're confirmed for ${when}. Details & check-in: ${portalUrl}`)
          : `Sorry — we can't take ${when}.${reason ? ` ${reason}` : ''} Nothing was charged. Pick another time: ${bookUrl}`,
        kind: accepted ? 'request_accepted' : 'request_declined',
        appointmentId, clientId: apt.clientId || null, clientName: apt.clientName || null,
      });
      sendStatus.smsSent = !!sr.ok;
    }
  } catch (e) {
    console.error('[appointments/decide] notify failed (decision is safe)', e);
  }

  return NextResponse.json({
    ok: true,
    status: outcome.status,
    depositCents: outcome.depositCents,
    sendStatus,
    chargedOnFile: chargeResult.attempted && chargeResult.ok,
    chargeFailed: chargeResult.attempted && !chargeResult.ok,
    chargeFailureReason: chargeResult.reason || null,
    message: accepted
      ? (chargeResult.attempted && chargeResult.ok
        ? `Accepted — the ${(outcome.depositCents / 100).toFixed(2)} deposit was charged to their card on file.`
        : chargeResult.attempted
          ? `Accepted, but their card was declined (${chargeResult.reason}). They have been sent a link to pay another way — the time is still held.`
          : outcome.status === 'pending_payment'
            ? 'Accepted — the client has been asked for their deposit.'
            : 'Accepted and confirmed — the client has been told.')
      : 'Declined — the time is free again and the client has been told.',
  });
}
