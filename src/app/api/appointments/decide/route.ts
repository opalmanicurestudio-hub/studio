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
//   accept  → status becomes 'confirmed' (or 'pending_payment' when a deposit
//             is owed, because approval mode never charges at request time —
//             acceptance is the moment the money is asked for). The client
//             gets the real confirmation, with the deposit link when needed.
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
        // Deposit owed → the client still has a step to take, so the row goes
        // to pending_payment rather than pretending the money is in.
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
        return { ok: true, status: nextStatus, depositCents, apt };
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

    const { sendNotification } = await import('@/lib/notify');
    const { brandedEmailHtml } = await import('@/lib/email-template');

    if (email.includes('@')) {
      const html = accepted
        ? brandedEmailHtml({
          studioName,
          title: needsDeposit ? 'Accepted — one step to lock it in' : "You're confirmed",
          bodyLines: [
            `Good news, ${firstName} — we can take you on ${when}.`,
            ...(needsDeposit
              ? [`To finish, tap below and pay the ${money} deposit. It goes toward your total, and the time is yours the moment it clears.`]
              : ['Nothing else is needed. Show the code below when you arrive.']),
          ],
          ...(needsDeposit ? {} : { bigCode: apt.shortCode ? String(apt.shortCode).toUpperCase() : undefined }),
          cta: { label: needsDeposit ? 'Pay deposit & confirm' : 'Check in / manage my visit', url: portalUrl },
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
          ? (needsDeposit ? `Accepted — finish booking your ${when}` : `Confirmed: ${when}`)
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
          ? (needsDeposit
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
    message: accepted
      ? (outcome.status === 'pending_payment'
        ? 'Accepted — the client has been asked for their deposit.'
        : 'Accepted and confirmed — the client has been told.')
      : 'Declined — the time is free again and the client has been told.',
  });
}
