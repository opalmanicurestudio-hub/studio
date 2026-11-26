// src/lib/release-unpaid.ts
//
// RELEASE UNPAID HOLDS — the business's payment deadlines, enforced.
// An appointment waiting on payment ('pending_payment') has a deadline:
//   • paymentDueAt — set when a request is ACCEPTED but the card on file
//     declined (Settings → Booking: "You accept but their card does not go
//     through", in hours; never later than the appointment itself)
//   • otherwise createdAt + holdMinutes — an online deposit the client
//     started and walked away from ("Someone starts paying and wanders off")
// The calendar already treats an expired hold as free; this makes it official:
// the appointment is cancelled ("payment not received"), the check-in copy
// follows, it's in the activity log, and — for accepted requests, where the
// client was expecting it — the client is told, with a link to book again.
// Runs from the booking page (throttled per business) and the daily job. A deposit taken on the card reader that
// the booking screen never confirmed is recorded first (lib/reader-deposit), so a paid visit is never released, and
// every online payment form opened for it is closed with Stripe before its time is let go (lib/deposit-sessions).

import { logAuditAdmin } from '@/lib/audit';
import { tenantTimeZone } from '@/lib/tenant-time';
import { recordWaitingReaderDeposit } from '@/lib/reader-deposit';
import { accessLockOf } from '@/lib/tenant-access';

export async function releaseUnpaidHolds(db: any, tenantId: string, opts: { origin?: string; now?: number } = {}): Promise<{ released: number }> {
  const T = `tenants/${tenantId}`; const now = opts.now ?? Date.now();
  const t: any = ((await db.doc(T).get()).data()) || {};
  const holdMin = Number(t?.bookingMode?.holdMinutes) > 0 ? Number(t.bookingMode.holdMinutes) : 30;
  // Paused: the pay link and the booking page are closed, so the client can neither pay nor book again, and nothing is
  // let go. Once it's open again, an accepted request still waiting has its time to pay again (reopenHolds, below).
  if (accessLockOf(t, now).locked) return { released: 0 };
  const snap = await db.collection(`${T}/appointments`).where('status', '==', 'pending_payment').limit(200).get();
  let released = 0;
  // Stripe is asked about at most this many bookings a run (each can take a few seconds when Stripe is slow); the rest
  // wait for the next run, which comes soon.
  let asked = 0; const ASK_LIMIT = 12;
  for (const d of snap.docs) {
    const a: any = d.data() || {};
    if (a.depositStatus === 'paid') continue; // paid in the meantime — the webhook confirms it
    // Taken on the card reader, but the screen never confirmed it (lost connection): recorded now, never released.
    if (a.depositReaderPi?.id) {
      const r = await recordWaitingReaderDeposit(db, tenantId, { id: d.id, ...a }, { tenant: t, origin: opts.origin || null }).catch((e: any) => { console.error('[release-unpaid] reader deposit', e); return null; });
      if (r?.ok) continue;
    }
    // Never on the visit's own morning: inside the protected window the desk decides (lib/deposit-release).
    const { releaseCall, tellDeskDeposit } = await import('@/lib/deposit-release');
    const call = releaseCall({ id: d.id, ...a }, now, t, holdMin);
    if (call === 'chase' || call === 'desk') { await tellDeskDeposit(db, tenantId, { id: d.id, ...a }, call, now).catch((e: any) => console.error('[release-unpaid] desk', e)); continue; }
    if (call !== 'release') continue;
    const nowIso = new Date(now).toISOString();
    const wasAccepted = !!a.paymentDueAt; // an accepted request (card declined) — the client was expecting this visit
    // Every payment form opened for it is closed first (lib/deposit-sessions), so it can't be paid once its time is
    // gone. One that has been (or is being) paid keeps the booking: Stripe's notice records it. If Stripe can't be asked,
    // it's left for the next sweep rather than let go with a form still open.
    const forms: string[] = Array.isArray(a.depositSessions) ? a.depositSessions.map(String) : [];
    // Paid with Stripe but never recorded here: never let go by a clock (the team has been told; they decide).
    if (a.depositPaidUnrecordedAt) continue;
    // Every form closes within a day of being opened, so once the newest is older than that, none can still be paid:
    // Stripe is still asked (a form that WAS paid must be found), but not hearing back no longer holds the time.
    const newest = Date.parse(String(a.depositSessionAt || a.createdAt || '')) || 0;
    const allExpired = !!newest && now - newest > 24.5 * 3600000;
    if (forms.length) {
      if (asked >= ASK_LIMIT) continue;
      asked++;
      const { closePayments } = await import('@/lib/deposit-sessions');
      let pay = await closePayments(forms).catch(() => 'unknown' as const);
      if (pay === 'unknown' && allExpired) pay = 'closed';
      // Paid with Stripe but never recorded here (its notice didn't arrive): the time stays held, since the money was
      // taken, and the team is told once to check it rather than it waiting unseen.
      if (pay === 'paid' && !a.depositPaidUnrecordedAt) {
        await d.ref.set({ depositPaidUnrecordedAt: new Date(now).toISOString(), needsAttention: 'deposit_paid_not_recorded', needsAttentionAt: new Date(now).toISOString() }, { merge: true }).catch(() => {});
        const { tellTeam } = await import('@/lib/deposit-release');
        await tellTeam(db, tenantId, { id: d.id, ...a }, 'A deposit was paid but not recorded', `${a.clientName || 'A client'} paid the deposit for their booking online, but the payment wasn't recorded here, so the time is still held. ${a.isRenterBooking ? 'It was paid to the renter: ask them to check it in their Stripe account' : 'Check the payment in Stripe'}, then confirm the booking or refund it.`, now).catch(() => {});
      }
      if (pay !== 'closed') continue;
    }
    // Let go only if nothing changed meanwhile: still waiting on payment, not paid, and no new form opened since.
    const gone = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(d.ref)).data();
      if (!cur || cur.status !== 'pending_payment' || cur.depositStatus === 'paid' || cur.depositReaderPi?.id || cur.depositPaidUnrecordedAt) return false;
      if ((Array.isArray(cur.depositSessions) ? cur.depositSessions.map(String) : []).some((x: string) => !forms.includes(x))) return false;
      tx.set(d.ref, { status: 'cancelled', cancellationReason: 'payment_not_received', cancelledAt: nowIso, releasedAt: nowIso, cancelledBy: 'system' }, { merge: true });
      if (a.checkInToken) tx.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), { status: 'cancelled' }, { merge: true });
      return true;
    }).catch((e: any) => { console.error('[release-unpaid] letting go', d.id, e?.message || e); return false; });
    if (!gone) continue;
    released++;
    const tz = tenantTimeZone(t);
    const when = a.startTime ? new Date(a.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : 'your time';
    await logAuditAdmin(db, tenantId, { action: 'appointment.released_unpaid', targetType: 'appointment', targetId: d.id,
      summary: `Released ${a.clientName || 'a client'}'s ${when}: ${wasAccepted ? 'payment was not received by the deadline after the card was declined' : 'the deposit was not completed'}`,
      actor: { type: 'system', name: 'Payment deadline' } }).catch(() => {});
    if (!wasAccepted) continue; // a walked-away online checkout: no message (they never had the booking)
    try {
      const cl = a.clientId ? (((await db.doc(`${T}/clients/${a.clientId}`).get()).data()) || {}) : {};
      const email = a.clientEmail || cl.email || null; const phone = a.clientPhone || cl.phone || null;
      const svc = a.serviceName || (a.serviceId ? ((((await db.doc(`${T}/services/${a.serviceId}`).get()).data()) || {}).name) : null) || 'appointment';
      const base = process.env.NEXT_PUBLIC_APP_URL || opts.origin || '';
      const rebook = base ? `${base}/book/${tenantId}` : null;
      const { sendNotification } = await import('@/lib/notify');
      const { brandedEmailHtml } = await import('@/lib/email-template');
      if (email) await sendNotification(db, { tenantId, channel: 'email', to: String(email), kind: 'payment_not_received',
        subject: `Your ${svc} appointment time has been released`,
        html: brandedEmailHtml({ studioName: t.name || 'Your studio', title: "We weren't able to hold your appointment",
          bodyLines: [`Hi ${String(a.clientName || '').split(' ')[0] || 'there'},`, `We didn't receive the deposit for your ${svc} on ${when}, so we've had to release your appointment time. No payment has been taken.`, `We're sorry about that. We'd still love to see you, and you're welcome to book a new time${rebook ? ' using the button below' : ''}.`, 'Kind regards,', t.name || 'Your studio'],
          ...(rebook ? { cta: { label: 'Book a new time', url: rebook } } : {}) }),
        recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: d.id } as any).catch(() => null);
      if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: String(phone), kind: 'payment_not_received',
        text: `Hi ${String(a.clientName || '').split(' ')[0] || 'there'}, we didn't receive the deposit for your ${svc} on ${when}, so we've had to release your appointment time. No payment has been taken. We're sorry about that.${rebook ? ` You're welcome to book a new time here: ${rebook}` : ''}`,
        recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: d.id } as any).catch(() => null);
    } catch (e) { console.error('[release-unpaid] client message failed (released anyway)', e); }
  }
  return { released };
}

/** A business open again after being paused or locked (HQ's restore, or its subscription paid up). An accepted request
 *  still waiting on its deposit gets its time to pay again from now, as long as it had to begin with (never past the visit
 *  itself), written on its own deadline (paymentDueAt): the calendar, the release above and the deposit sweep all read
 *  that one date, and the sweep's reminder goes again with the new time. Never for a time someone else has booked since,
 *  and never for a checkout someone walked away from (that one was never theirs). */
export async function reopenHolds(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<{ moved: number }> {
  const T = `tenants/${tenantId}`; let moved = 0;
  const graceH = Number(tenant?.bookingMode?.paymentGraceHours);
  const snap = await db.collection(`${T}/appointments`).where('status', '==', 'pending_payment').limit(300).get();
  for (const d of snap.docs) {
    const a: any = d.data() || {};
    if (!a.paymentDueAt || a.depositStatus === 'paid' || a.depositDeskHold === true) continue;
    const due = Date.parse(String(a.paymentDueAt)), from = Date.parse(String(a.decidedAt || a.createdAt || '')), start = Date.parse(String(a.startTime || ''));
    if (!Number.isFinite(due) || (Number.isFinite(start) && start <= now)) continue;
    const win = Number(a.payWindowMs) > 0 ? Number(a.payWindowMs) : Number.isFinite(from) && due > from ? due - from : graceH > 0 ? graceH * 3600000 : 24 * 3600000;
    const next = Math.min(Math.max(due, now + win), Number.isFinite(start) ? start : Infinity);
    if (!(next > due + 60000)) continue;   // (already given its time: asked again, nothing moves)
    // Taken by someone else meanwhile (the calendar let the time go at its old deadline): it isn't held again.
    if (due < now && Number.isFinite(start)) {   // (one with no time on the calendar holds none)
      const end = Date.parse(String(a.endTime || '')) || start + 60 * 60000;
      const staff = String(a.staffId || '');
      // (Around that day only, by time alone, so no extra index is needed; that provider's are picked out here. Not able to
      // look: it isn't held again, rather than risk two bookings for one time.)
      const dayStart = new Date(start - 24 * 3600000).toISOString(), dayEnd = new Date(end + 24 * 3600000).toISOString();
      const near: any = staff ? await db.collection(`${T}/appointments`).where('startTime', '>=', dayStart).where('startTime', '<=', dayEnd).get().catch(() => null) : { docs: [] };
      if (!near) continue;
      const others = near.docs.filter((o: any) => String((o.data() || {}).staffId || '') === staff);
      const taken = others.some((o: any) => { if (o.id === d.id) return false; const x: any = o.data() || {};
        if (['cancelled', 'declined', 'expired', 'pending_payment', 'no_show'].includes(String(x.status || ''))) return false;
        const s = Date.parse(String(x.startTime || '')), e = Date.parse(String(x.endTime || '')) || s + 60 * 60000;
        return Number.isFinite(s) && s < end && e > start; });
      if (taken) continue;
    }
    await d.ref.set({ paymentDueAt: new Date(next).toISOString(), payWindowMs: win }, { merge: true });
    await db.doc(`${T}/systemMarkers/unpaid-nudge-${d.id}`).delete().catch(() => {});
    moved++;
  }
  return { moved };
}

/** Throttled trigger for busy pages: at most every 10 minutes per business. */
export async function maybeReleaseUnpaid(db: any, tenantId: string, origin?: string) {
  try {
    const ref = db.doc(`tenants/${tenantId}/system/holdSweep`);
    const last = Date.parse(((await ref.get()).data() || {}).at || '');
    if (Number.isFinite(last) && Date.now() - last < 10 * 60000) return;
    await ref.set({ at: new Date().toISOString() }, { merge: true });
    await releaseUnpaidHolds(db, tenantId, { origin });
  } catch (e) { console.error('[release-unpaid] sweep skipped', e); }
}
