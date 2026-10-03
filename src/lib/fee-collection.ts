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
// Never charges twice: each fee is locked while it's charged, and Stripe gets one key per fee per try.
import { automationOn, noteAutomation } from '@/lib/automation-switches';

export const RETRY_AFTER_DAYS = [3, 7];          // after the 1st try, then after the 2nd → 3 tries in all
const DAY = 86400000;
/** Only fees from the last 30 days are collected automatically — a surprise charge for something months old is how
 *  chargebacks start. Older fees (and fees with no date) stay for you to handle in person. */
export const MAX_FEE_AGE_DAYS = 30;

const friendly = (e: any): { text: string; stop: boolean } => {
  const code = String(e?.code || e?.decline_code || e?.raw?.code || '');
  if (code === 'authentication_required') return { text: 'Their bank wants them to confirm the payment — send them a payment link instead.', stop: true };
  if (/expired_card/.test(code)) return { text: 'Their card has expired.', stop: true };
  if (/insufficient_funds/.test(code)) return { text: 'The card was declined for insufficient funds.', stop: false };
  if (/card_declined|do_not_honor|generic_decline/.test(code)) return { text: 'The card was declined.', stop: false };
  return { text: 'The charge didn’t go through.', stop: false };
};

/** When this fee is next due to be tried (or null if it shouldn't be). */
export function nextTryAt(fee: any, firstAfterHours: number, now = Date.now()): number | null {
  if (!fee || fee.collectGaveUp || !(Number(fee.feeAmount) > 0)) return null;
  const born = Date.parse(fee.appointmentDate || fee.createdAt || '');
  if (!Number.isFinite(born) || now - born > MAX_FEE_AGE_DAYS * DAY) return null;   // too old, or no date: yours to handle
  if (fee.nextCollectAt) return Date.parse(fee.nextCollectAt);
  return born + Math.max(0, firstAfterHours) * 3600000;
}

export async function collectFees(db: any, stripe: any, tenantId: string, tenant: any, now = Date.now()) {
  const out = { tried: 0, paid: 0, failed: 0, stopped: 0, skippedNoCard: 0 };
  if (!automationOn(tenant, 'fee-collection') || !tenant?.stripeAccountId) return out;
  const firstAfterHours = Number(tenant?.automations?.feeCollectionAfterHours ?? 24);
  const T = `tenants/${tenantId}`;
  const owing = await db.collection(`${T}/clients`).where('outstandingBalance', '>', 0).limit(300).get();
  for (const cDoc of owing.docs) {
    const client: any = cDoc.data() || {}; const card = client.cardOnFile;
    const due = (Array.isArray(client.unpaidFees) ? client.unpaidFees : []).filter((f: any) => { const at = nextTryAt(f, firstAfterHours, now); return at !== null && at <= now && !f.collectingAt; });
    if (!due.length) continue;
    if (!card?.customerId || !card?.paymentMethodId) { out.skippedNoCard++; continue; }
    for (const fee0 of due) {
      // Lock this fee (so two runs can never charge it twice).
      const locked = await db.runTransaction(async (tx: any) => {
        const c: any = (await tx.get(cDoc.ref)).data() || {}; const list = Array.isArray(c.unpaidFees) ? c.unpaidFees : [];
        const i = list.findIndex((f: any) => f.feeId === fee0.feeId); if (i < 0 || list[i].collectingAt || list[i].collectGaveUp) return null;
        const next = [...list]; next[i] = { ...list[i], collectingAt: new Date(now).toISOString() }; tx.update(cDoc.ref, { unpaidFees: next }); return next[i];
      });
      if (!locked) continue;
      const attempt = Number(locked.collectAttempts || 0) + 1; const cents = Math.round(Number(locked.feeAmount) * 100);
      const reason = String(locked.reason || 'Fee').replace(/\s*[—–-]\s*(auto-charge failed|card declined|no card on file|payments not connected).*$/i, '').slice(0, 120);
      out.tried++; let intent: any = null; let err: any = null;
      try {
        intent = await stripe.paymentIntents.create({ amount: cents, currency: 'usd', customer: card.customerId, payment_method: card.paymentMethodId, off_session: true, confirm: true,
          description: `${reason} — collected automatically`, ...(client.email ? { receipt_email: client.email } : {}),
          metadata: { tenantId, clientId: cDoc.id, feeId: locked.feeId, appointmentId: locked.appointmentId || '', kind: 'arrears_fee', source: 'fee_collection', attempt: String(attempt) } },
          { stripeAccount: tenant.stripeAccountId, idempotencyKey: `collect_${tenantId}_${locked.feeId}_${attempt}` });
      } catch (e: any) { err = e; }
      const nowIso = new Date(now).toISOString();
      if (intent && intent.status === 'succeeded') {
        await db.runTransaction(async (tx: any) => {
          const c: any = (await tx.get(cDoc.ref)).data() || {}; const list = (Array.isArray(c.unpaidFees) ? c.unpaidFees : []).filter((f: any) => f.feeId !== locked.feeId);
          tx.update(cDoc.ref, { unpaidFees: list, outstandingBalance: Math.max(0, Math.round((Number(c.outstandingBalance || 0) - Number(locked.feeAmount)) * 100) / 100) });
          tx.set(db.doc(`${T}/transactions/collect_${locked.feeId}`), { id: `collect_${locked.feeId}`, date: nowIso, description: `${reason} — collected automatically`, clientOrVendor: client.name || 'Client', clientId: cDoc.id,
            type: 'income', context: 'Business', category: 'Fees', taxBucket: 'revenue', amount: Number(locked.feeAmount), paymentMethod: 'Card on file (Stripe) — automatic',
            appointmentId: locked.appointmentId || null, stripePaymentIntentId: intent.id, stripeChargeId: typeof intent.latest_charge === 'string' ? intent.latest_charge : null, hasReceipt: true, tenantId }, { merge: true });
          tx.set(db.collection(`${T}/collectionAttempts`).doc(), { clientId: cDoc.id, clientName: client.name || null, feeId: locked.feeId, amount: Number(locked.feeAmount), reason, attempt, status: 'paid', at: nowIso, paymentIntentId: intent.id });
        });
        out.paid++; await noteAutomation(db, tenantId, 'fee-collection');
        await tellClient(db, tenantId, tenant, cDoc.id, client, Number(locked.feeAmount), reason).catch(() => null);
      } else {
        const f = friendly(err || { code: intent?.status });
        const stop = f.stop || attempt >= 1 + RETRY_AFTER_DAYS.length;
        await db.runTransaction(async (tx: any) => {
          const c: any = (await tx.get(cDoc.ref)).data() || {}; const list = Array.isArray(c.unpaidFees) ? c.unpaidFees : [];
          const next = list.map((x: any) => (x.feeId !== locked.feeId ? x : (({ collectingAt, ...rest }: any) => ({ ...rest, collectAttempts: attempt, lastCollectError: f.text, lastCollectAt: nowIso,
            ...(stop ? { collectGaveUp: true, nextCollectAt: null } : { nextCollectAt: new Date(now + RETRY_AFTER_DAYS[attempt - 1] * DAY).toISOString() }) }))(x)));
          tx.update(cDoc.ref, { unpaidFees: next });
          tx.set(db.collection(`${T}/collectionAttempts`).doc(), { clientId: cDoc.id, clientName: client.name || null, feeId: locked.feeId, amount: Number(locked.feeAmount), reason, attempt, status: 'failed', why: f.text, stopped: stop, at: nowIso });
          if (stop) tx.set(db.collection(`${T}/chargeFlags`).doc(), { tenantId, clientId: cDoc.id, appointmentId: locked.appointmentId || null, amountDollars: Number(locked.feeAmount), description: reason, reason,
            failReason: `Automatic collection stopped after ${attempt} ${attempt === 1 ? 'try' : 'tries'}: ${f.text}`, code: 'collection_stopped', status: 'needs_attention', createdAt: nowIso });
        });
        out.failed++; if (stop) out.stopped++;
      }
    }
  }
  return out;
}

async function tellClient(db: any, tenantId: string, tenant: any, clientId: string, client: any, amount: number, reason: string) {
  const { resolveMessagePolicy, renderMessage } = await import('@/lib/message-policy'); const { sendNotification } = await import('@/lib/notify');
  const studio = tenant?.name || 'Us'; const toks = { client_first: String(client.name || '').split(' ')[0] || 'there', amount: `$${amount.toFixed(2)}`, fee_reason: reason.toLowerCase(), studio, when: '', service: '', link: '' };
  if (client.phone) { const p = resolveMessagePolicy(tenant, 'fee_charged', 'sms');
    if (p.enabled) await sendNotification(db, { tenantId, channel: 'sms', to: client.phone, kind: 'fee_charged', clientId, clientName: client.name || null,
      text: p.body ? renderMessage(p.body, toks) : `${studio}: we charged ${toks.amount} to your card on file for ${toks.fee_reason}. Questions? Just reply.` } as any); }
  if (client.email) { const p = resolveMessagePolicy(tenant, 'fee_charged', 'email');
    if (p.enabled) { const { brandedEmailHtml } = await import('@/lib/email-template');
      await sendNotification(db, { tenantId, channel: 'email', to: client.email, kind: 'fee_charged', clientId, clientName: client.name || null,
        subject: p.subject ? renderMessage(p.subject, toks) : `A ${toks.amount} fee was charged — ${studio}`,
        html: brandedEmailHtml({ studioName: studio, title: 'A fee was charged to your card', bodyLines: [p.body ? renderMessage(p.body, toks) : `Hi ${toks.client_first}, we charged ${toks.amount} to your card on file for ${toks.fee_reason}. If you have any questions, just reply to this email.`] } as any) } as any); } }
}
