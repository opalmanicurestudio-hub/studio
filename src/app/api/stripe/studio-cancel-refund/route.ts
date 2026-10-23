/**
 * api/stripe/studio-cancel-refund/route.ts
 *
 * Handles the deposit disposition when the STUDIO cancels an appointment.
 * The studio is always at fault here — client should never lose money.
 *
 * Looks the deposit up itself from tenants/{tenantId}/depositCredits — the
 * single source of truth every cancellation path now agrees on
 * (studio-cancel-refund, handle-no-show-action, useCancellationConfirm,
 * self-cancel). Never trusts amounts passed in the request body.
 *
 * ── Stripe processing fee visibility ──────────────────────────────────────
 * Refunding does NOT return the original processing fee to the studio in
 * most Stripe configurations — that fee is gone the moment the deposit was
 * first collected, refund or not. This route surfaces both costs instead of
 * silently absorbing them:
 *   - The ORIGINAL fee paid when the deposit was collected is looked up
 *     (via the deposit's payment intent) and attached as a note on the
 *     ledger transaction — informational only, NOT a new expense line,
 *     since that fee was already logged as an expense when the charge
 *     happened. Re-logging it here would double-count it.
 *   - Any INCREMENTAL fee Stripe reports specifically for the refund
 *     transaction itself (rare, but some Connect configurations adjust the
 *     application fee on refund) IS logged as a new expense line, since
 *     that's a genuinely new cost incurred right now.
 *   - Store-credit conversions never touch Stripe, so there's no
 *     incremental fee — but the same "what fee was already sunk on this
 *     deposit" note is attached for transparency.
 *
 * ── Discretionary / goodwill credit ───────────────────────────────────────
 * Converting a deposit to store credit isn't an expense — the client
 * already paid that money, the studio is just moving it from "applies to a
 * specific re-booking" (depositCredits) to "spendable on anything"
 * (client.totalStoreCredit). In the books it comes off sales (lib/books-summary):
 * the deposit was counted as a sale when it was paid, and the credit is counted
 * again when it's spent. If staff want to add MORE than the deposit
 * amount as a goodwill gesture, that additional amount IS a real expense
 * (nothing was collected for it) and is logged as its own ledger line,
 * separate from the deposit conversion. Pass additionalCreditCents +
 * additionalCreditReason to use this.
 *
 * NOTE: this goodwill-credit mechanism duplicates what IssueRecoveryDialog
 * presumably already does elsewhere in this app for the same purpose
 * (issuing discretionary client credit/recovery). They should eventually
 * share one implementation rather than each minting client.storeCredits
 * entries independently — flagged, not fixed here, since this route
 * doesn't have visibility into that dialog's existing contract.
 *
 * POST body:
 *   {
 *     tenantId, clientId, appointmentId, disposition, staffId, reason,
 *     additionalCreditCents?,   // optional — only meaningful for disposition: 'store_credit'
 *     additionalCreditReason?,  // optional — shown on the ledger line and store credit entry
 *   }
 *   disposition: 'refund' | 'store_credit'
 */

import { staffOrServer } from '@/lib/route-guard';
import { creditLeftCents, isDepositCredit, pickDeposit } from '@/lib/credit-pools';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

function getAdmin() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue }     = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return { db: getFirestore(app), FieldValue };
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

function isCreditExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

function getStoreCreditExpiry(tenant: any): string | null {
  const days = tenant?.storeCreditExpiryDays;
  if (!days || days === 0) return null; // never expires
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// ── Look up the fee Stripe charged on the ORIGINAL deposit payment ───────────
// Informational only — never logged as a new ledger line (it's a sunk cost,
// already expensed when the charge happened).
async function getOriginalChargeFeeCents(
  stripe: Stripe,
  stripeAccountId: string,
  stripePaymentIntentId: string | null | undefined,
): Promise<number> {
  if (!stripePaymentIntentId) return 0;
  try {
    const intent: any = await stripe.paymentIntents.retrieve(
      stripePaymentIntentId,
      { expand: ['latest_charge.balance_transaction'] },
      { stripeAccount: stripeAccountId },
    );
    const bt = intent?.latest_charge?.balance_transaction;
    return bt && typeof bt === 'object' ? Math.abs(bt.fee || 0) : 0;
  } catch (e) {
    console.warn('[studio-cancel-refund] could not retrieve original charge fee', e);
    return 0;
  }
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const {
    tenantId, clientId, appointmentId, disposition, staffId, reason,
    additionalCreditCents, additionalCreditReason,
  } = body;
  if (!(await staffOrServer(req, String(tenantId || '')))) return NextResponse.json({ ok: false, error: 'Sign in to refund or credit a deposit.', code: 'unauthorized' }, { status: 401 });

  if (!tenantId || !clientId || !appointmentId || !disposition) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
  }
  if (!['refund', 'store_credit'].includes(disposition)) {
    return NextResponse.json({ ok: false, error: 'disposition must be refund or store_credit' }, { status: 400 });
  }

  const { db, FieldValue } = getAdmin();
  const now = new Date().toISOString();

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant = tenantSnap.data() || {};
  const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
  const client = clientSnap.data() || {};

  // ── Look up the deposit credit — the single source of truth ──────────────
  const creditsCol = db.collection(`tenants/${tenantId}/depositCredits`);
  let creditSnap = await creditsCol.where('status', '==', 'available').where('clientId', '==', clientId).get();
  if (creditSnap.empty && client.email) {
    creditSnap = await creditsCol.where('status', '==', 'available').where('clientEmail', '==', String(client.email).toLowerCase().trim()).get();
  }
  if (creditSnap.empty) {
    return NextResponse.json({ ok: false, reason: 'No deposit on file for this client.' }, { status: 404 });
  }

  // THIS appointment's deposit (lib/credit-pools), or one carried over to it from a cancelled booking. Never store
  // credit from a return or a goodwill gesture (same collection), and never a deposit waiting for another booking.
  const candidates = creditSnap.docs
    .map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() as any) }))
    .filter((c: any) => !isCreditExpired(c.expiresAt) && isDepositCredit(c));
  const credit: any = pickDeposit(candidates, [appointmentId], () => true) || pickDeposit(candidates.filter((c: any) => c.rolledOver === true), [], () => false);
  if (!credit) {
    return NextResponse.json({ ok: false, reason: 'No deposit on file for this booking.' }, { status: 404 });
  }

  // What's left on it: a deposit part used at the desk gives back only the rest.
  const depositAmountCents = creditLeftCents(credit);
  const dollars = depositAmountCents / 100;
  const stripePaymentIntentId = credit.stripePaymentIntentId || null;
  const extraCents = Math.max(0, Math.round(Number(additionalCreditCents) || 0));
  const extraDollars = extraCents / 100;

  const who = client.name || 'Client';
  const what = credit.serviceName || credit.appointmentServiceName || 'booking';

  try {
    if (disposition === 'refund') {
      if (!tenant.stripeAccountId) {
        return NextResponse.json({ ok: false, reason: 'No connected Stripe account.' }, { status: 400 });
      }
      if (!stripePaymentIntentId) {
        return NextResponse.json({
          ok: false,
          reason: 'No Stripe payment intent on file for this deposit — apply store credit instead',
          fallback: 'store_credit',
        });
      }

      const stripe = getStripe();
      const intent = await stripe.paymentIntents.retrieve(stripePaymentIntentId, { stripeAccount: tenant.stripeAccountId });
      if (intent.status !== 'succeeded') {
        return NextResponse.json({ ok: false, reason: `Payment intent status is ${intent.status} — cannot refund` });
      }

      const refund = await stripe.refunds.create(
        {
          payment_intent: stripePaymentIntentId,
          amount: depositAmountCents,
          reason: 'requested_by_customer',
          metadata: {
            tenantId, clientId, appointmentId,
            staffId: staffId || 'system',
            cancelReason: reason || 'studio_cancelled',
            disposition: 'refund',
          },
        },
        // One refund per deposit, however often this is asked (a double tap, a retry after a dropped answer).
        { stripeAccount: tenant.stripeAccountId, idempotencyKey: `studio-cancel-${String(credit.id || credit.ref?.id || appointmentId)}-${depositAmountCents}` },
      );

      // ── Fee visibility ──────────────────────────────────────────────────
      const originalFeeCents = await getOriginalChargeFeeCents(stripe, tenant.stripeAccountId, stripePaymentIntentId);
      let refundFeeCents = 0;
      try {
        const refundWithBalance: any = await stripe.refunds.retrieve(
          refund.id,
          { expand: ['balance_transaction'] },
          { stripeAccount: tenant.stripeAccountId },
        );
        const bt = refundWithBalance?.balance_transaction;
        // balance_transaction.fee on a refund is usually 0 — Stripe doesn't
        // return the original fee in most configurations. Capture whatever
        // it actually reports rather than assuming either way.
        if (bt && typeof bt === 'object') refundFeeCents = Math.abs(bt.fee || 0);
      } catch (e) {
        console.warn('[studio-cancel-refund] could not retrieve refund balance transaction', e);
      }
      // NOTE: the incremental refund fee is intentionally NOT written here.
      // The Connect webhook's charge.refunded handler is the single source of
      // truth for refund-side fees — it reads the refund's balance transaction
      // and books any returned fee with the correct sign (a credit/return, not
      // an expense), deduped by stripeBalanceTxnId. refundFeeCents is still
      // surfaced in the audit detail below for visibility.

      // The records, once: the refund line is named after Stripe's refund, and the deposit is marked refunded in the same
      // step, so a second request (the same refund, by its idempotency key) finds it done.
      const txRef = db.doc(`tenants/${tenantId}/transactions/depositrefund_${refund.id}`);
      const already = await db.runTransaction(async (tx: any) => {
        const [fresh, line] = await Promise.all([tx.get(credit.ref), tx.get(txRef)]);
        if (line.exists || fresh.data()?.status === 'refunded') return true;
        tx.set(credit.ref, { status: 'refunded', refundedAt: now, refundedFromAppointmentId: appointmentId, stripeRefundId: refund.id }, { merge: true });
        tx.update(db.doc(`tenants/${tenantId}/appointments/${appointmentId}`), {
          depositRefunded: true, depositRefundedAt: now, depositRefundedAmountCents: depositAmountCents,
          depositStripeRefundId: refund.id, depositDisposition: 'refunded',
        });
        // A refund in the books (lib/books-summary): it comes off sales, since the deposit was counted when it was paid.
        tx.set(txRef, {
          id: txRef.id, tenantId, appointmentId, clientId, clientName: who, clientOrVendor: who,
          date: now, createdAt: now, description: `Deposit refund — ${what} — ${who}`,
          type: 'expense', context: 'Business', category: 'Refunds', taxBucket: 'refund', refundKind: 'deposit', taxRefunded: 0,
          amount: dollars, amountCents: depositAmountCents, paymentMethod: 'Card (Stripe refund)', hasReceipt: false,
          stripePaymentIntentId, stripeRefundId: refund.id, status: 'succeeded',
          reason: reason || 'studio_cancelled', disposition: 'refunded',
          ...(credit.ledgerSourceId ? { refundOfLine: credit.ledgerSourceId } : {}),
          // The fee paid when the deposit was taken was already an expense then; noted, not written again.
          ...(originalFeeCents > 0 ? { notes: `The card fee on the original deposit ($${(originalFeeCents / 100).toFixed(2)}) was recorded when it was taken; it isn't written again.` } : {}),
        });
        const auditRef = db.doc(`tenants/${tenantId}/auditLog/depositrefund_${refund.id}`);
        tx.set(auditRef, {
          id: auditRef.id, tenantId, entityType: 'deposit_refund', entityId: appointmentId,
          actorId: staffId || 'system', timestamp: now,
          summary: `Deposit refunded $${dollars.toFixed(2)} to ${client.name || 'client'} — studio cancelled`,
          detail: { disposition: 'refunded', stripeRefundId: refund.id, reason: reason || null, originalFeeCents, refundFeeCents },
        });
        return false;
      });
      return NextResponse.json({
        ok: true, disposition: 'refunded', refundId: refund.id, amount: dollars,
        originalFeeCents, refundFeeCents, ...(already ? { already: true } : {}),
      });

    } else {
      // ── Store credit path ────────────────────────────────────────────────
      let originalFeeCents = 0;
      if (stripePaymentIntentId && tenant.stripeAccountId) {
        originalFeeCents = await getOriginalChargeFeeCents(getStripe(), tenant.stripeAccountId, stripePaymentIntentId);
      }
      const expiresAt = getStoreCreditExpiry(tenant);

      const creditEntry = {
        id: `credit_${appointmentId}`,
        tenantId, clientId, appointmentId,
        amountCents: depositAmountCents, amount: dollars,
        type: 'earned' as const,
        source: 'cancellation_deposit_conversion' as const,
        reason: 'Studio cancellation — deposit converted to credit',
        cancelReason: reason || 'studio_cancelled',
        createdBy: staffId || 'system',
        expiresAt,
        createdAt: now, usedAt: null, usedOnAppointmentId: null, status: 'available',
      };
      const storeCreditsToAdd: any[] = [creditEntry];
      let totalCreditDollars = dollars;
      // Discretionary/goodwill credit — a REAL expense, separate from the deposit conversion, since nothing was collected for it.
      const goodwillEntry = extraCents > 0 ? {
        id: `goodwill_${appointmentId}_${String(credit.id || '')}`,
        tenantId, clientId, appointmentId,
        amountCents: extraCents, amount: extraDollars,
        type: 'courtesy' as const,
        source: 'goodwill' as const,
        reason: additionalCreditReason || 'Service recovery — goodwill credit',
        cancelReason: reason || 'studio_cancelled',
        createdBy: staffId || 'system',
        expiresAt,
        createdAt: now, usedAt: null, usedOnAppointmentId: null, status: 'available',
      } : null;
      if (goodwillEntry) { storeCreditsToAdd.push(goodwillEntry); totalCreditDollars += extraDollars; }

      // All in one step that first checks the deposit is still there to convert, so a double tap or a retry can't add
      // the credit twice. Each line is named after the deposit it came from.
      const key = String(credit.id || credit.ref?.id || appointmentId);
      const already = await db.runTransaction(async (tx: any) => {
        const fresh = await tx.get(credit.ref);
        if (fresh.data()?.status !== 'available') return true;
        // Consume the SOURCE depositCredits record (so it can't also get auto-applied to a future booking) and add the
        // same amount to the client's store-credit wallet.
        tx.set(credit.ref, { status: 'consumed', consumedAt: now, consumedReason: 'converted_to_store_credit', consumedFromAppointmentId: appointmentId }, { merge: true });
        tx.update(db.doc(`tenants/${tenantId}/clients/${clientId}`), {
          storeCredits: FieldValue.arrayUnion(...storeCreditsToAdd),
          totalStoreCredit: FieldValue.increment(totalCreditDollars),
        });
        tx.update(db.doc(`tenants/${tenantId}/appointments/${appointmentId}`), {
          depositConvertedToCredit: true, depositConvertedToCreditAt: now,
          depositConvertedAmountCents: depositAmountCents, depositDisposition: 'store_credit',
        });
        if (goodwillEntry) {
          const goodwillTxRef = db.doc(`tenants/${tenantId}/transactions/goodwill_${key}`);
          tx.set(goodwillTxRef, {
            id: goodwillTxRef.id, tenantId, appointmentId, clientId, clientName: who, clientOrVendor: who,
            date: now, createdAt: now, description: `Goodwill credit — ${what}`,
            type: 'expense', context: 'Business', category: 'Service Recovery', taxBucket: 'operating_cost',
            amount: extraDollars, amountCents: extraCents, paymentMethod: 'Store credit', hasReceipt: false, status: 'issued',
            reason: additionalCreditReason || 'Service recovery — goodwill credit', disposition: 'store_credit',
            notes: 'Credit beyond the deposit, given as goodwill.',
          });
        }
        // The deposit kept as store credit: in the books it comes off sales (it was counted when it was paid, and the
        // credit counts as a sale when it's spent).
        const txRef = db.doc(`tenants/${tenantId}/transactions/depositcredit_${key}`);
        tx.set(txRef, {
          id: txRef.id, tenantId, appointmentId, clientId, clientName: who, clientOrVendor: who,
          date: now, createdAt: now, description: `Deposit kept as store credit — ${what}`,
          type: 'store_credit_issued', context: 'Business', category: 'Store Credit',
          amount: dollars, amountCents: depositAmountCents, paymentMethod: 'Store credit', hasReceipt: false, status: 'issued',
          reason: reason || 'studio_cancelled', disposition: 'store_credit', expiresAt,
          ...(originalFeeCents > 0 ? { notes: `The card fee on the original deposit ($${(originalFeeCents / 100).toFixed(2)}) isn't recoverable.` } : {}),
        });
        const auditRef = db.doc(`tenants/${tenantId}/auditLog/depositcredit_${key}`);
        tx.set(auditRef, {
          id: auditRef.id, tenantId, entityType: 'deposit_store_credit', entityId: appointmentId,
          actorId: staffId || 'system', timestamp: now,
          summary: `$${dollars.toFixed(2)} deposit converted to store credit for ${client.name || 'client'}${extraCents > 0 ? ` + $${extraDollars.toFixed(2)} goodwill credit` : ''}`,
          detail: { disposition: 'store_credit', creditId: credit.id || null, reason: reason || null, originalFeeCents, additionalCreditCents: extraCents },
        });
        return false;
      });
      if (!already) {
        try {
          const { sendRefundNotice } = await import('@/lib/refund-notice');
          await sendRefundNotice(db, tenantId, { key: `credit_${credit.id}_${appointmentId}`, kind: 'credit', amountCents: Math.round(totalCreditDollars * 100), clientId, appointmentId, reason: reason || null });
        } catch (e) { console.error('[studio-cancel-refund] credit notice', e); }
      }
      return NextResponse.json({
        ok: true, disposition: 'store_credit', creditId: credit.id,
        amount: dollars, additionalCredit: extraDollars, totalCredit: totalCreditDollars,
        expiresAt, originalFeeCents, ...(already ? { already: true } : {}),
      });
    }
  } catch (err: any) {
    console.error('[studio-cancel-refund]', err);
    return NextResponse.json({ ok: false, reason: err.message || 'Unknown error', code: err.code }, { status: 500 });
  }
}
