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
// Runs from the booking page (throttled per business) and the daily job.

import { logAuditAdmin } from '@/lib/audit';
import { tenantTimeZone } from '@/lib/tenant-time';

export async function releaseUnpaidHolds(db: any, tenantId: string, opts: { origin?: string; now?: number } = {}): Promise<{ released: number }> {
  const T = `tenants/${tenantId}`; const now = opts.now ?? Date.now();
  const t: any = ((await db.doc(T).get()).data()) || {};
  const holdMin = Number(t?.bookingMode?.holdMinutes) > 0 ? Number(t.bookingMode.holdMinutes) : 30;
  const snap = await db.collection(`${T}/appointments`).where('status', '==', 'pending_payment').limit(200).get();
  let released = 0;
  for (const d of snap.docs) {
    const a: any = d.data() || {};
    if (a.depositStatus === 'paid') continue; // paid in the meantime — the webhook confirms it
    const createdMs = Date.parse(a.createdAt || '');
    const due = a.paymentDueAt ? Date.parse(a.paymentDueAt) : Number.isFinite(createdMs) ? createdMs + holdMin * 60000 : NaN;
    if (!Number.isFinite(due) || due > now) continue;
    const nowIso = new Date(now).toISOString();
    const wasAccepted = !!a.paymentDueAt; // an accepted request (card declined) — the client was expecting this visit
    const batch = db.batch();
    batch.set(d.ref, { status: 'cancelled', cancellationReason: 'payment_not_received', cancelledAt: nowIso, releasedAt: nowIso, cancelledBy: 'system' }, { merge: true });
    if (a.checkInToken) batch.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), { status: 'cancelled' }, { merge: true });
    await batch.commit(); released++;
    const tz = tenantTimeZone(t);
    const when = a.startTime ? new Date(a.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : 'your time';
    await logAuditAdmin(db, tenantId, { action: 'appointment.released_unpaid', targetType: 'appointment', targetId: d.id,
      summary: `Released ${a.clientName || 'a client'}'s ${when} — ${wasAccepted ? 'payment wasn’t received by the deadline after the card declined' : 'the deposit wasn’t completed'}`,
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
        subject: `Your ${svc} time was released`,
        html: brandedEmailHtml({ studioName: t.name || 'Your studio', title: 'We couldn’t hold your time',
          bodyLines: [`Hi ${String(a.clientName || '').split(' ')[0] || 'there'} — we didn’t receive the deposit for your ${svc} on ${when}, so the time has been released.`, 'Nothing has been charged. We’d love to see you — you’re welcome to book again.'],
          ...(rebook ? { cta: { label: 'Book again', url: rebook } } : {}) }),
        recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: d.id } as any).catch(() => null);
      if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: String(phone), kind: 'payment_not_received',
        text: `${t.name || 'We'}: we didn’t receive the deposit for your ${svc} on ${when}, so the time was released. Nothing was charged.${rebook ? ` Book again: ${rebook}` : ''}`,
        recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: d.id } as any).catch(() => null);
    } catch (e) { console.error('[release-unpaid] client message failed (released anyway)', e); }
  }
  return { released };
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
