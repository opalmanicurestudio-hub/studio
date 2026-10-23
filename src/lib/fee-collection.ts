// src/lib/fee-collection.ts — COLLECT FEES OWED FROM THE CARD ON FILE (an automation; off unless switched on).
// Fees a client owes (a no-show or late-cancel fee whose charge didn't go through, or a balance parked on their
// account) sit on the client as `unpaidFees` + `outstandingBalance`. When the business switches this on in
// Automations, each fee is tried against their saved card:
//   • first try: right away, after a day (default) or after 3 days — the owner chooses in Automations
//   • at most 3 tries: the first, then 3 days later, then 7 days after that — then it stops and flags it for you
//   • if their bank wants them to confirm the payment, it stops at once and says so (send a payment link instead)
// A successful charge is recorded exactly like a manual one (the transactions ledger), comes off their balance,
// and the client is told (the "fee charged" message — it can't be switched off: a charge nobody was told about is
// how chargebacks start). Every try is logged in `collectionAttempts`, paid or not, with the reason.
// Never charges twice: each fee is claimed while it's charged, through the same lock every other way of paying a fee
// uses (lib/fee-pay), and Stripe gets the same key for the same fee, amount and card, whoever charges it. A fee with a
// pay link still open is left for the link. A run cut off after charging leaves its claim behind: the next run (or the
// desk) finds that payment at Stripe and records it, rather than charging the fee again. When Stripe doesn't answer,
// the fee stays claimed and nothing is counted as a failed try.
import { automationOn, noteAutomation } from '@/lib/automation-switches';
import { anyStaleClaim, chargeClaimedFees, claimFees, linkOpen, resolveStaleFees } from '@/lib/fee-pay';

export const RETRY_AFTER_DAYS = [3, 7];          // after the 1st try, then after the 2nd → 3 tries in all
const DAY = 86400000;
/** Only fees from the last 30 days are collected automatically — a surprise charge for something months old is how
 *  chargebacks start. Older fees (and fees with no date) stay for you to handle in person. */
export const MAX_FEE_AGE_DAYS = 30;

const friendly = (e: any): { text: string; stop: boolean } => {
  const code = String(e?.code || e?.decline_code || e?.raw?.code || '');
  if (code === 'authentication_required') return { text: 'Their bank requires them to confirm the payment. Please send them a payment link instead.', stop: true };
  if (/expired_card/.test(code)) return { text: 'Their card has expired.', stop: true };
  if (/insufficient_funds/.test(code)) return { text: 'The card was declined for insufficient funds.', stop: false };
  if (/card_declined|do_not_honor|generic_decline/.test(code)) return { text: 'The card was declined.', stop: false };
  return { text: 'The charge did not go through.', stop: false };
};

/** When this fee is next due to be tried (or null if it shouldn't be). */
export function nextTryAt(fee: any, firstAfterHours: number, now = Date.now()): number | null {
  if (!fee || fee.collectGaveUp || fee.autoCollect === false || !(Number(fee.feeAmount) > 0)) return null;   // autoCollect:false = the owner chose to collect it in person
  const born = Date.parse(fee.appointmentDate || fee.createdAt || '');
  if (!Number.isFinite(born) || now - born > MAX_FEE_AGE_DAYS * DAY) return null;   // too old, or no date: yours to handle
  if (fee.nextCollectAt) return Date.parse(fee.nextCollectAt);
  return born + Math.max(0, firstAfterHours) * 3600000;
}

export async function collectFees(db: any, stripe: any, tenantId: string, tenant: any, now = Date.now()) {
  const out = { tried: 0, paid: 0, failed: 0, stopped: 0, skippedNoCard: 0, unconfirmed: 0 };
  if (!automationOn(tenant, 'fee-collection') || !tenant?.stripeAccountId) return out;
  const firstAfterHours = Number(tenant?.automations?.feeCollectionAfterHours ?? 24);
  const T = `tenants/${tenantId}`;
  const owing = await db.collection(`${T}/clients`).where('outstandingBalance', '>', 0).limit(300).get();
  for (const cDoc of owing.docs) {
    let client: any = cDoc.data() || {};
    // A payment a run (or the desk) was cut off from: found at Stripe and recorded first, never charged again.
    if (anyStaleClaim(client, now)) { await resolveStaleFees(db, stripe, tenantId, tenant, cDoc.id, now).catch(() => null); client = (await cDoc.ref.get()).data() || {}; }
    const card = client.cardOnFile;
    const due = (Array.isArray(client.unpaidFees) ? client.unpaidFees : []).filter((f: any) => { const at = nextTryAt(f, firstAfterHours, now); return at !== null && at <= now && !f.collectingAt && !linkOpen(f, now); });
    if (!due.length) continue;
    if (!card?.customerId || !card?.paymentMethodId) { out.skippedNoCard++; continue; }
    for (const fee0 of due) {
      // Claimed (so no other run, and no other way of paying, can take this fee at the same moment).
      const cl = await claimFees(db, tenantId, { clientId: cDoc.id, feeIds: [String(fee0.feeId)], source: 'collection', by: 'Automatic collection', skipLinked: true, now });
      if (!cl.ok) continue;
      const fee = cl.claim.fees[0]; if (!fee) continue;
      const attempt = fee.collectAttempts + 1; const cents = fee.cents; const reason = fee.reason;
      const nowIso = new Date(now).toISOString();
      out.tried++;
      let stop = false; let why = '';
      const r = await chargeClaimedFees(db, stripe, tenantId, tenant, cl.claim, { description: `${reason} — collected automatically`, receiptEmail: client.email || null, by: 'Automatic collection', how: 'collection',
        metadata: { feeId: fee.feeId, appointmentId: fee.appointmentId || '', kind: 'arrears_fee', source: 'fee_collection', attempt: String(attempt) },
        // Stripe said no: this try counts, and the next one is scheduled (or collection stops and you're told).
        declinedPatch: (_f: any, err: any) => { const f = friendly(err); stop = f.stop || attempt >= 1 + RETRY_AFTER_DAYS.length; why = f.text;
          return { collectAttempts: attempt, lastCollectError: f.text, lastCollectAt: nowIso, ...(stop ? { collectGaveUp: true, nextCollectAt: null } : { nextCollectAt: new Date(now + RETRY_AFTER_DAYS[attempt - 1] * DAY).toISOString() }) }; } });
      // Each try is logged once, under its own name (the fee and the try).
      const logTry = (x: any) => db.doc(`${T}/collectionAttempts/${String(fee.feeId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100)}_${attempt}`).set({ clientId: cDoc.id, clientName: client.name || null, feeId: fee.feeId, amount: cents / 100, reason, attempt, at: nowIso, ...x }, { merge: true });
      if (r.ok) {
        if (!r.settled.already && r.settled.paidCents > 0) {
          try { const { recordCharge } = await import('@/lib/charge-records'); await recordCharge(db, tenantId, { kind: 'fees_card_on_file', clientId: cDoc.id, cents, reason: `Collected automatically — ${reason}`, appointmentId: fee.appointmentId || null, paymentIntentId: r.intent.id, needs: ['booking_policies', 'card_on_file'] }); } catch { /* fine */ }
          await logTry({ status: 'paid', paymentIntentId: r.intent.id });
          out.paid++; await noteAutomation(db, tenantId, 'fee-collection');
          await tellClient(db, tenantId, tenant, cDoc.id, client, cents / 100, reason).catch(() => null);
        }
      } else if ('unknown' in r) {
        // No answer from Stripe: the fee stays claimed, and the next run finds out what happened before anything else.
        out.unconfirmed++;
      } else {
        await logTry({ status: 'failed', why, stopped: stop });
        if (stop) await db.doc(`${T}/chargeFlags/collect_stop_${String(fee.feeId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100)}`).set({ tenantId, clientId: cDoc.id, appointmentId: fee.appointmentId || null, amountDollars: cents / 100, description: reason, reason,
          failReason: `Automatic collection stopped after ${attempt} ${attempt === 1 ? 'try' : 'tries'}: ${why}`, code: 'collection_stopped', status: 'needs_attention', createdAt: nowIso });
        out.failed++; if (stop) out.stopped++;
      }
    }
  }
  return out;
}

export async function tellClient(db: any, tenantId: string, tenant: any, clientId: string, client: any, amount: number, reason: string) {
  const { resolveMessagePolicy, renderMessage } = await import('@/lib/message-policy'); const { sendNotification } = await import('@/lib/notify');
  const studio = tenant?.name || 'Us'; const toks = { client_first: String(client.name || '').split(' ')[0] || 'there', amount: `$${amount.toFixed(2)}`, fee_reason: reason.toLowerCase(), studio, when: '', service: '', link: '' };
  if (client.phone) { const p = resolveMessagePolicy(tenant, 'fee_charged', 'sms');
    if (p.enabled) await sendNotification(db, { tenantId, channel: 'sms', to: client.phone, kind: 'fee_charged', clientId, clientName: client.name || null,
      text: p.body ? renderMessage(p.body, toks) : `Hi ${toks.client_first}, we wanted to let you know that, under our booking policy, we've charged ${toks.amount} to your card on file for ${toks.fee_reason}. If you have any questions, please reply to this message and we'll be happy to help.` } as any); }
  if (client.email) { const p = resolveMessagePolicy(tenant, 'fee_charged', 'email');
    if (p.enabled) { const { brandedEmailHtml } = await import('@/lib/email-template');
      await sendNotification(db, { tenantId, channel: 'email', to: client.email, kind: 'fee_charged', clientId, clientName: client.name || null,
        subject: p.subject ? renderMessage(p.subject, toks) : `A ${toks.amount} fee from ${studio} has been charged to your card`,
        html: brandedEmailHtml({ studioName: studio, title: 'A fee has been charged to your card', bodyLines: p.body ? [renderMessage(p.body, toks)] : [`Hi ${toks.client_first},`, `We wanted to let you know that, under our booking policy, we've charged ${toks.amount} to your card on file for ${toks.fee_reason}.`, "If you have any questions, just reply to this email and we'll be happy to help.", 'Kind regards,', studio] } as any) } as any); } }
}
