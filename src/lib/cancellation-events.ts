// src/lib/cancellation-events.ts — WHAT HAPPENS AFTER A CANCELLATION OR A CONFIRMED NO-SHOW.
// The self-cancel and no-show routes record a `cancellationEvents` doc (status 'pending') carrying the fee and how
// it's paid. This used to be finished by a background function (onCancellationEvent) that was never deployed — so
// late-cancel and no-show fees were never charged and clients were never told. It now runs inside the app: each
// route calls `processCancellationEvent` right after saving, and the 5-minute no-shows job sweeps up anything still
// 'pending' (if a call was interrupted). Faithful to the original, with four fixes:
//   • a fee the route ALREADY charged is not recorded as owed again (the old code would have billed it twice later);
//   • a fee with no card on file also goes on the client's list of owed fees (so automatic collection can see it);
//   • message times use the business's own time zone;
//   • messages go through the app's own sender (the same logs, providers and settings as every other message).
// Claimed in a transaction, and Stripe gets one key per event — it can never charge twice.
import { FieldValue } from 'firebase-admin/firestore';

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmt = (iso: string, tz: string, long: boolean) => { try { return new Date(iso).toLocaleString('en-US', long ? { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch { return ''; } };

export async function processCancellationEvent(db: any, stripe: any, tenantId: string, eventId: string): Promise<{ ok: boolean; status?: string; chargeStatus?: string }> {
  const T = `tenants/${tenantId}`; const eventRef = db.doc(`${T}/cancellationEvents/${eventId}`);
  const claimed = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(eventRef)).data();
    if (!cur || cur.status !== 'pending') return null;
    tx.update(eventRef, { status: 'processing', claimedAt: new Date().toISOString() }); return cur;
  });
  if (!claimed) return { ok: true, status: 'not_pending' };
  const data: any = claimed; const tenant: any = (await db.doc(T).get()).data();
  if (!tenant) { await eventRef.update({ status: 'failed', errorMessage: 'Business not found' }); return { ok: false, status: 'failed' }; }
  const nowIso = () => new Date().toISOString();
  const updates: Record<string, any> = { status: 'complete', processedAt: nowIso() };
  const fee = Number(data.feeAmount) || 0; const actor = data.cancellationAudit?.actorType || 'studio';
  const owedLine = (notes: string, extra: any = {}) => { const ref = db.collection(`${T}/transactions`).doc();
    return ref.set({ id: ref.id, tenantId, appointmentId: data.appointmentId || null, clientId: data.clientId || null, clientName: data.clientName, clientOrVendor: data.clientName, type: 'income', context: 'Business',
      category: 'Cancellation Fee', taxBucket: 'revenue', amount: fee, amountCents: Math.round(fee * 100), status: 'balance_owed', reason: data.reason || null, actorType: actor, notes, createdAt: nowIso(), ...extra }); };
  const owe = async (why: string) => { if (!data.clientId) return;
    await db.doc(`${T}/clients/${data.clientId}`).update({ outstandingBalance: FieldValue.increment(fee),
      unpaidFees: FieldValue.arrayUnion({ feeId: `cancel-${data.appointmentId || eventId}`, appointmentId: data.appointmentId || null, appointmentDate: nowIso(), feeAmount: fee, reason: why }) }); };
  const tellStaff = (type: string, message: string, userId?: string) => { const ref = db.collection(`${T}/notifications`).doc();
    return ref.set({ id: ref.id, userId: userId || data.staffId || 'owner', type, message, link: `/clients/${data.clientId || ''}`, createdAt: nowIso(), read: false }); };

  if (data.chargeStatus === 'succeeded') {
    updates.chargeStatus = 'charged';   // the route already took the fee — nothing more to collect
  } else if (data.chargeFee && fee > 0 && data.paymentMethod === 'card_on_file' && data.stripePaymentMethodId && data.stripeCustomerId) {
    if (!tenant.stripeAccountId) { updates.chargeStatus = 'failed'; updates.errorMessage = 'Payments aren’t connected — the fee couldn’t be charged.'; await owedLine('Payments not connected at cancellation time — added to balance.'); await owe('Cancellation fee — payments not connected'); }
    else {
      try {
        const cents = Math.round(fee * 100);
        const pi = await stripe.paymentIntents.create({ amount: cents, currency: 'usd', customer: data.stripeCustomerId, payment_method: data.stripePaymentMethodId, confirm: true, off_session: true, expand: ['latest_charge'],
          description: `Cancellation fee — ${data.serviceName || 'Service'} — ${data.clientName}`,
          metadata: { tenantId, clientId: data.clientId || '', appointmentId: data.appointmentId || '', cancellationEventId: eventId, reason: String(data.reason || '').slice(0, 400), actorType: actor } },
          { stripeAccount: tenant.stripeAccountId, idempotencyKey: `cancel-fee-${tenantId}-${eventId}` });
        const lc: any = pi.latest_charge; const chargeId = lc && typeof lc === 'object' ? lc.id : (lc || null);
        updates.chargeStatus = 'charged'; updates.stripeChargeId = chargeId || pi.id; updates.stripeChargeAmountCents = cents;
        try { const { recordCharge } = await import('@/lib/charge-records'); await recordCharge(db, tenantId, { kind: actor === 'no_show' ? 'no_show_fee' : 'late_cancel_fee', clientId: String(data.clientId || ''), cents, reason: String(data.reason || (actor === 'no_show' ? 'Did not arrive' : 'Cancelled inside the notice period')), appointmentId: data.appointmentId || null, paymentIntentId: pi.id, needs: ['booking_policies', 'card_on_file'] }); } catch { /* the charge stands */ }
        try {
          const ref = db.collection(`${T}/transactions`).doc();
          await ref.set({ id: ref.id, tenantId, date: nowIso(), appointmentId: data.appointmentId || null, clientId: data.clientId || null, clientName: data.clientName, clientOrVendor: data.clientName, type: 'income', context: 'Business',
            category: 'Cancellation Fee', taxBucket: 'revenue', amount: fee, amountCents: cents, stripeChargeId: chargeId, stripePaymentIntentId: pi.id, stripePaymentMethodId: data.stripePaymentMethodId, status: 'succeeded', reason: data.reason || null, actorType: actor, createdAt: nowIso() });
          const admins = await db.collection(`${T}/staff`).where('role', 'in', ['admin', 'owner']).get();
          for (const d of admins.docs) await tellStaff('cancellation_charge', `${money(fee)} cancellation fee charged to ${data.clientName}`, d.id);
        } catch (e: any) { updates.ledgerWriteFailed = true; updates.ledgerErrorMessage = String(e?.message || 'Ledger write failed after a successful charge'); }
      } catch (e: any) {
        updates.chargeStatus = 'failed'; updates.stripeErrorCode = e?.code || 'unknown'; updates.declineCode = e?.decline_code || e?.raw?.decline_code || null; updates.errorMessage = e?.message || 'The charge didn’t go through';
        // A declined fee is still owed — on their balance and their list of owed fees (automatic collection can retry it).
        try { await owedLine(`Card on file declined at cancellation time (${updates.declineCode || updates.stripeErrorCode}) — added to balance.`); await owe(`Cancellation fee — card declined (${updates.declineCode || 'declined'})`); updates.arrearsRecorded = true; }
        catch { updates.arrearsWriteFailed = true; }
        await tellStaff('charge_failed', `Card declined for ${data.clientName} — ${money(fee)} cancellation fee added to their balance`);
      }
    }
  } else if (data.paymentMethod === 'waived' || !data.chargeFee || fee <= 0) {
    updates.chargeStatus = 'waived';
  } else if (data.paymentMethod === 'add_to_balance') {
    updates.chargeStatus = 'balance'; await owedLine('Added to balance.');
  } else {
    updates.chargeStatus = 'uncollected';
    await owedLine('No chargeable card on file at cancellation time — added to balance.'); await owe('Cancellation fee — no card on file');
    await tellStaff('charge_failed', `Couldn’t charge the ${money(fee)} cancellation fee for ${data.clientName} — no card on file. Added to their balance.`);
  }

  // Tell the client — one email and/or one text, in the business's time zone. (Bookings handled through the visit
  // link carry no email/phone here: they've already had their one message.)
  const tz = tenant.timezone || 'America/New_York'; const studio = tenant.name || 'The studio'; const charged = updates.chargeStatus === 'charged' && fee > 0;
  const feeText = !fee || updates.chargeStatus === 'waived' ? '' : charged ? `A ${money(fee)} cancellation fee has been charged to the card on file.` : `A ${money(fee)} cancellation fee has been added to your account.`;
  const { sendNotification } = await import('@/lib/notify');
  if (data.clientEmail && tenant.cancellationEmailEnabled !== false) {
    try { const { brandedEmailHtml } = await import('@/lib/email-template');
      const subject = actor === 'no_show' ? `We missed you — ${studio}` : actor === 'client' ? `Cancellation confirmed — ${studio}` : `Your appointment has been cancelled — ${studio}`;
      const r: any = await sendNotification(db, { tenantId, channel: 'email', to: data.clientEmail, kind: 'cancellation', clientId: data.clientId || null, clientName: data.clientName || null, subject,
        html: brandedEmailHtml({ studioName: studio, title: subject.split(' — ')[0], bodyLines: [`Hi ${String(data.clientName || 'there').split(' ')[0]}, your ${data.serviceName || 'appointment'} on ${fmt(data.appointmentStartTime, tz, true)} has been cancelled.`, ...(feeText ? [feeText] : []), 'If you have any questions, just reply to this email.'] } as any) } as any);
      updates.emailStatus = r?.ok ? 'sent' : 'failed'; } catch (e: any) { updates.emailStatus = 'failed'; updates.emailError = String(e?.message || e); }
  } else updates.emailStatus = 'skipped';
  if (data.clientPhone && tenant.cancellationSmsEnabled !== false) {
    try { const first = String(data.clientName || 'there').split(' ')[0];
      const lead = actor === 'no_show' ? `Hi ${first}, we missed you today` : `Hi ${first}, your ${data.serviceName || ''} appt`.replace(/\s+appt$/, ' appt');
      const r: any = await sendNotification(db, { tenantId, channel: 'sms', to: data.clientPhone, kind: 'cancellation', clientId: data.clientId || null, clientName: data.clientName || null,
        text: `${lead} on ${fmt(data.appointmentStartTime, tz, false)} has been cancelled.${feeText ? ` ${feeText}` : ''} Questions? Reply${tenant.phone ? ` or call ${tenant.phone}` : ''}. — ${studio}` } as any);
      updates.smsStatus = r?.ok ? 'sent' : 'failed'; } catch (e: any) { updates.smsStatus = 'failed'; updates.smsError = String(e?.message || e); }
  } else updates.smsStatus = 'skipped';

  await eventRef.update(updates);
  return { ok: true, status: 'complete', chargeStatus: updates.chargeStatus };
}

/** Finish anything still waiting (an interrupted call) — run by the 5-minute no-shows job. */
/** Cancellations older than this are never charged or messaged automatically. Before this moved into the app, every
 *  late cancellation and no-show sat 'pending' forever — finishing those now would charge fees and text clients about
 *  visits from weeks or months ago. They're set aside for the owner to review instead. */
export const MAX_PENDING_AGE_HOURS = 48;

export async function sweepPendingCancellations(db: any, stripe: any, tenantId: string, olderThanMs = 2 * 60000) {
  const snap = await db.collection(`tenants/${tenantId}/cancellationEvents`).where('status', '==', 'pending').limit(50).get();
  let done = 0; const now = Date.now();
  for (const d of snap.docs) {
    const v: any = d.data() || {}; const made = Date.parse(v.createdAt || v.timestamp || '');
    if (!Number.isFinite(made) || now - made > MAX_PENDING_AGE_HOURS * 3600000) {   // too old (or undated): set aside, untouched
      await d.ref.update({ status: 'needs_review', reviewReason: 'Too old to process automatically — no fee was charged and the client wasn’t messaged.', reviewFlaggedAt: new Date(now).toISOString() }).catch(() => null);
      continue;
    }
    if (now - made < olderThanMs) continue;   // fresh — its own route is finishing it
    try { await processCancellationEvent(db, stripe, tenantId, d.id); done++; } catch { /* next run */ }
  }
  return done;
}
