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
// Claimed in a transaction, and Stripe gets one key per event — it can never charge twice. Each part is written down as
// it's done (the fee, then each message), and the books lines and notes are named after the event, so an event a call
// was cut off from part way (left 'processing') is finished by the five-minute job without doing anything twice.
// The booking's deposit (kept, rolled over, or waiting to be refunded: lib/deposit-outcome) is settled here too when the
// event carries the plan for it, so a cancellation cut off before its deposit was settled is settled by the same job.
import { FieldValue } from 'firebase-admin/firestore';

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmt = (iso: string, tz: string, long: boolean) => { try { return new Date(iso).toLocaleString('en-US', long ? { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch { return ''; } };
/** How long a claim lasts before the five-minute job may take it over (a call cut off part way). */
export const CLAIM_STALE_MS = 10 * 60000;

export async function processCancellationEvent(db: any, stripe: any, tenantId: string, eventId: string): Promise<{ ok: boolean; status?: string; chargeStatus?: string }> {
  const T = `tenants/${tenantId}`; const eventRef = db.doc(`${T}/cancellationEvents/${eventId}`);
  const claimed = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(eventRef)).data();
    const stale = cur?.status === 'processing' && Date.now() - (Date.parse(String(cur.claimedAt || '')) || 0) > CLAIM_STALE_MS;
    if (!cur || !(cur.status === 'pending' || stale)) return null;
    tx.update(eventRef, { status: 'processing', claimedAt: new Date().toISOString() }); return cur;
  });
  if (!claimed) return { ok: true, status: 'not_pending' };
  const data: any = claimed; const tenant: any = (await db.doc(T).get()).data();
  if (!tenant) { await eventRef.update({ status: 'failed', errorMessage: 'Business not found' }); return { ok: false, status: 'failed' }; }
  const nowIso = () => new Date().toISOString();
  const updates: Record<string, any> = { status: 'complete', processedAt: nowIso() };
  const fee = Number(data.feeAmount) || 0; const actor = data.cancellationAudit?.actorType || 'studio';
  const safeId = String(eventId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  const owedLine = (notes: string, extra: any = {}) => { const ref = db.doc(`${T}/transactions/cancelowed_${safeId}`);
    return ref.set({ id: ref.id, tenantId, appointmentId: data.appointmentId || null, clientId: data.clientId || null, clientName: data.clientName, clientOrVendor: data.clientName, type: 'income', context: 'Business',
      category: 'Cancellation Fee', taxBucket: 'revenue', amount: fee, amountCents: Math.round(fee * 100), status: 'balance_owed', reason: data.reason || null, actorType: actor, notes, createdAt: nowIso(), ...extra }); };
  // What they owe goes on their balance once: the fee's own id is on their list of owed fees.
  const owe = async (why: string) => { if (!data.clientId) return;
    const cRef = db.doc(`${T}/clients/${data.clientId}`); const feeId = `cancel-${data.appointmentId || eventId}`;
    await db.runTransaction(async (tx: any) => {
      const c: any = (await tx.get(cRef)).data(); if (!c) return;
      if ((Array.isArray(c.unpaidFees) ? c.unpaidFees : []).some((f: any) => f?.feeId === feeId)) return;
      tx.update(cRef, { outstandingBalance: FieldValue.increment(fee), unpaidFees: FieldValue.arrayUnion({ feeId, appointmentId: data.appointmentId || null, appointmentDate: nowIso(), feeAmount: fee, reason: why }) });
    }); };
  const tellStaff = (type: string, message: string, userId?: string) => { const ref = db.doc(`${T}/notifications/cancel_${safeId}_${type}_${String(userId || data.staffId || 'owner').replace(/[^A-Za-z0-9_-]/g, '')}`);
    return ref.set({ id: ref.id, userId: userId || data.staffId || 'owner', type, message, link: `/clients/${data.clientId || ''}`, createdAt: nowIso(), read: false }); };

  if (data.chargeDoneAt) {
    // The fee was dealt with by an earlier try: what it did stands.
  } else if (data.chargeStatus === 'succeeded') {
    updates.chargeStatus = 'charged';   // the route already took the fee — nothing more to collect
  } else if (data.chargeFee && fee > 0 && data.paymentMethod === 'card_on_file' && data.stripePaymentMethodId && data.stripeCustomerId) {
    if (!tenant.stripeAccountId) { updates.chargeStatus = 'failed'; updates.errorMessage = 'The fee could not be charged because payments are not connected.'; await owedLine('Payments not connected at cancellation time — added to balance.'); await owe('Cancellation fee — payments not connected'); }
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
          const ref = db.doc(`${T}/transactions/cancelfee_${safeId}`);
          await ref.set({ id: ref.id, tenantId, date: nowIso(), appointmentId: data.appointmentId || null, clientId: data.clientId || null, clientName: data.clientName, clientOrVendor: data.clientName, type: 'income', context: 'Business',
            category: 'Cancellation Fee', taxBucket: 'revenue', amount: fee, amountCents: cents, stripeChargeId: chargeId, stripePaymentIntentId: pi.id, stripePaymentMethodId: data.stripePaymentMethodId, status: 'succeeded', reason: data.reason || null, actorType: actor, createdAt: nowIso() });
          const admins = await db.collection(`${T}/staff`).where('role', 'in', ['admin', 'owner']).get();
          for (const d of admins.docs) await tellStaff('cancellation_charge', `A ${money(fee)} cancellation fee has been charged to ${data.clientName}’s card on file.`, d.id);
        } catch (e: any) { updates.ledgerWriteFailed = true; updates.ledgerErrorMessage = String(e?.message || 'Ledger write failed after a successful charge'); }
      } catch (e: any) {
        updates.chargeStatus = 'failed'; updates.stripeErrorCode = e?.code || 'unknown'; updates.declineCode = e?.decline_code || e?.raw?.decline_code || null; updates.errorMessage = e?.message || 'The charge did not go through.';
        // A declined fee is still owed — on their balance and their list of owed fees (automatic collection can retry it).
        try { await owedLine(`Card on file declined at cancellation time (${updates.declineCode || updates.stripeErrorCode}) — added to balance.`); await owe(`Cancellation fee — card declined (${updates.declineCode || 'declined'})`); updates.arrearsRecorded = true; }
        catch { updates.arrearsWriteFailed = true; }
        await tellStaff('charge_failed', `${data.clientName}’s card was declined for the ${money(fee)} cancellation fee. The fee has been added to their account balance.`);
      }
    }
  } else if (data.paymentMethod === 'waived' || !data.chargeFee || fee <= 0) {
    updates.chargeStatus = 'waived';
  } else if (data.paymentMethod === 'add_to_balance') {
    updates.chargeStatus = 'balance'; await owedLine('Added to balance.');
  } else {
    updates.chargeStatus = 'uncollected';
    await owedLine('No chargeable card on file at cancellation time — added to balance.'); await owe('Cancellation fee — no card on file');
    await tellStaff('charge_failed', `The ${money(fee)} cancellation fee for ${data.clientName} could not be charged because there is no card on file. The fee has been added to their account balance.`);
  }
  // The fee is dealt with: written down now, so a later try never deals with it again.
  if (!data.chargeDoneAt) { const done: Record<string, any> = { chargeDoneAt: nowIso() }; for (const k of Object.keys(updates)) if (k !== 'status' && k !== 'processedAt') done[k] = updates[k]; await eventRef.update(done); data.chargeStatus = updates.chargeStatus ?? data.chargeStatus; }
  else updates.chargeStatus = data.chargeStatus;

  // The booking's deposit, as the cancellation planned it (lib/deposit-outcome; once).
  if (data.depositPlan?.outcome && !data.depositSettledAt && data.appointmentId) {
    try {
      const { settleCancelledDeposit } = await import('@/lib/deposit-outcome');
      await settleCancelledDeposit(db, tenantId, { appointmentId: String(data.appointmentId), outcome: data.depositPlan.outcome, reason: String(data.depositPlan.reason || data.reason || 'cancellation'), trigger: actor === 'no_show' ? 'no_show' : actor === 'client' ? 'client_cancel' : 'front_desk', by: String(data.depositPlan.by || 'Cancellation'), creditId: data.depositPlan.creditId || null, clientEmail: data.clientEmail || null });
      updates.depositSettledAt = nowIso();
    } catch (e: any) { updates.depositError = String(e?.message || e).slice(0, 200); updates.status = 'processing'; }
  }

  // Tell the client — one email and/or one text, in the business's time zone. (Bookings handled through the visit
  // link carry no email/phone here: they've already had their one message.)
  const tz = tenant.timezone || 'America/New_York'; const studio = tenant.name || 'The studio'; const charged = (updates.chargeStatus ?? data.chargeStatus) === 'charged' && fee > 0;
  const feeText = !fee || updates.chargeStatus === 'waived' ? '' : charged ? `Under our cancellation policy, a fee of ${money(fee)} has been charged to your card on file.` : `Under our cancellation policy, a fee of ${money(fee)} has been added to your account balance.`;
  const { sendNotification } = await import('@/lib/notify');
  // Business's own wording if they've written it (Settings → Messages → We missed you).
  const tokens = { client_first: String(data.clientName || 'there').split(' ')[0], when: fmt(data.appointmentStartTime, tz, false), service: data.serviceName || '', fee: feeText || "There's no charge for this.", studio };
  if (data.emailDoneAt) { /* sent by an earlier try */ }
  else if (data.clientEmail && tenant.cancellationEmailEnabled !== false) {
    try { const { brandedEmailHtml } = await import('@/lib/email-template');
      const subject = actor === 'no_show' ? `We missed you — ${studio}` : actor === 'client' ? `Your cancellation is confirmed — ${studio}` : `Your appointment has been cancelled — ${studio}`;
      const r: any = await sendNotification(db, { tenantId, channel: 'email', to: data.clientEmail, kind: 'cancellation', tokens, clientId: data.clientId || null, clientName: data.clientName || null, subject,
        html: brandedEmailHtml({ studioName: studio, title: subject.split(' — ')[0], bodyLines: [`Hi ${String(data.clientName || 'there').split(' ')[0]},`, actor === 'no_show' ? `We missed you at your ${data.serviceName || 'appointment'} on ${fmt(data.appointmentStartTime, tz, true)}, and we hope everything is all right. The appointment has been cancelled.` : `Your ${data.serviceName || 'appointment'} on ${fmt(data.appointmentStartTime, tz, true)} has been cancelled.`, ...(feeText ? [feeText] : []), "If you have any questions, just reply to this email and we'll be happy to help.", 'Kind regards,', studio] } as any) } as any);
      updates.emailStatus = r?.ok ? 'sent' : 'failed'; } catch (e: any) { updates.emailStatus = 'failed'; updates.emailError = String(e?.message || e); }
    await eventRef.update({ emailStatus: updates.emailStatus, emailDoneAt: nowIso() }).catch(() => {});
  } else updates.emailStatus = 'skipped';
  if (data.smsDoneAt) { /* sent by an earlier try */ }
  else if (data.clientPhone && tenant.cancellationSmsEnabled !== false) {
    try { const first = String(data.clientName || 'there').split(' ')[0];
      const lead = actor === 'no_show' ? `Hi ${first}, we missed you today and hope everything is all right. Your appointment` : `Hi ${first}, your ${data.serviceName || ''} appointment`.replace(/\s+appointment$/, ' appointment');
      const r: any = await sendNotification(db, { tenantId, channel: 'sms', to: data.clientPhone, kind: 'cancellation', tokens, clientId: data.clientId || null, clientName: data.clientName || null,
        text: `${lead} on ${fmt(data.appointmentStartTime, tz, false)} has been cancelled.${feeText ? ` ${feeText}` : ''} If you have any questions, please reply to this message. We're happy to help.` } as any);
      updates.smsStatus = r?.ok ? 'sent' : 'failed'; } catch (e: any) { updates.smsStatus = 'failed'; updates.smsError = String(e?.message || e); }
    await eventRef.update({ smsStatus: updates.smsStatus, smsDoneAt: nowIso() }).catch(() => {});
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
  // And any a call was cut off from part way through (claimed, never finished): taken over once the claim is stale.
  const stuck = await db.collection(`tenants/${tenantId}/cancellationEvents`).where('status', '==', 'processing').limit(50).get().catch(() => ({ docs: [] as any[] }));
  let done = 0; const now = Date.now();
  for (const d of stuck.docs) {
    const v: any = d.data() || {};
    if (now - (Date.parse(String(v.claimedAt || '')) || 0) <= CLAIM_STALE_MS) continue;
    try { await processCancellationEvent(db, stripe, tenantId, d.id); done++; } catch { /* next run */ }
  }
  for (const d of snap.docs) {
    const v: any = d.data() || {}; const made = Date.parse(v.createdAt || v.timestamp || '');
    if (!Number.isFinite(made) || now - made > MAX_PENDING_AGE_HOURS * 3600000) {   // too old (or undated): set aside, untouched
      await d.ref.update({ status: 'needs_review', reviewReason: 'Too old to process automatically. No fee was charged and the client was not messaged.', reviewFlaggedAt: new Date(now).toISOString() }).catch(() => null);
      continue;
    }
    if (now - made < olderThanMs) continue;   // fresh — its own route is finishing it
    try { await processCancellationEvent(db, stripe, tenantId, d.id); done++; } catch { /* next run */ }
  }
  return done;
}
