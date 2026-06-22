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
 * (client.totalStoreCredit). If staff want to add MORE than the deposit
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

  const candidates = creditSnap.docs
    .map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() as any) }))
    .filter((c: any) => !isCreditExpired(c.expiresAt));
  candidates.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const credit = candidates[0];
  if (!credit) {
    return NextResponse.json({ ok: false, reason: 'Deposit on file has expired.' }, { status: 404 });
  }

  const depositAmountCents = Math.round(Number(credit.amountDollars ?? (credit.amountCents || 0) / 100) * 100);
  const dollars = depositAmountCents / 100;
  const stripePaymentIntentId = credit.stripePaymentIntentId || null;
  const extraCents = Math.max(0, Math.round(Number(additionalCreditCents) || 0));
  const extraDollars = extraCents / 100;

  const batch = db.batch();

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
        { stripeAccount: tenant.stripeAccountId },
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

      batch.set(credit.ref, {
        status: 'refunded',
        refundedAt: now,
        refundedFromAppointmentId: appointmentId,
        stripeRefundId: refund.id,
      }, { merge: true });

      batch.update(db.doc(`tenants/${tenantId}/appointments/${appointmentId}`), {
        depositRefunded: true,
        depositRefundedAt: now,
        depositRefundedAmountCents: depositAmountCents,
        depositStripeRefundId: refund.id,
        depositDisposition: 'refunded',
      });

      const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      batch.set(txRef, {
        id: txRef.id, tenantId, appointmentId, clientId,
        clientName: client.name || 'Client',
        type: 'refund', category: 'Deposit Refund',
        amount: -dollars, amountCents: -depositAmountCents,
        stripePaymentIntentId, stripeRefundId: refund.id, status: 'succeeded',
        reason: reason || 'studio_cancelled', disposition: 'refunded', createdAt: now,
        // Informational only — the original fee was already expensed when
        // the deposit was charged. Surfaced here so reports can show "this
        // refund's true cost" without double-counting it as a new expense.
        notes: originalFeeCents > 0
          ? `Original processing fee already sunk at charge time: $${(originalFeeCents / 100).toFixed(2)} (not re-logged as a separate expense).`
          : undefined,
      });

      // NOTE: the incremental refund fee is intentionally NOT written here.
      // The Connect webhook's charge.refunded handler is the single source of
      // truth for refund-side fees — it reads the refund's balance transaction
      // and books any returned fee with the correct sign (a credit/return, not
      // an expense), deduped by stripeBalanceTxnId. Writing it here too would
      // double-count it, and as an expense rather than a credit it would also
      // have the wrong sign. refundFeeCents is still surfaced in the audit
      // detail below for visibility.

      const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
      batch.set(auditRef, {
        id: auditRef.id, tenantId, entityType: 'deposit_refund', entityId: appointmentId,
        actorId: staffId || 'system', timestamp: now,
        summary: `Deposit refunded $${dollars.toFixed(2)} to ${client.name || 'client'} — studio cancelled`,
        detail: { disposition: 'refunded', stripeRefundId: refund.id, reason, originalFeeCents, refundFeeCents },
      });

      await batch.commit();
      return NextResponse.json({
        ok: true, disposition: 'refunded', refundId: refund.id, amount: dollars,
        originalFeeCents, refundFeeCents,
      });

    } else {
      // ── Store credit path ────────────────────────────────────────────────
      let originalFeeCents = 0;
      if (stripePaymentIntentId && tenant.stripeAccountId) {
        originalFeeCents = await getOriginalChargeFeeCents(getStripe(), tenant.stripeAccountId, stripePaymentIntentId);
      }

      // Consume the SOURCE depositCredits record (so it can't also get
      // auto-applied to a future booking) and add the same amount to the
      // client's general store-credit wallet.
      batch.set(credit.ref, {
        status: 'consumed',
        consumedAt: now,
        consumedReason: 'converted_to_store_credit',
        consumedFromAppointmentId: appointmentId,
      }, { merge: true });

      const creditEntry = {
        id: `credit_${appointmentId}`,
        tenantId, clientId, appointmentId,
        amountCents: depositAmountCents, amount: dollars,
        type: 'earned' as const,
        source: 'cancellation_deposit_conversion' as const,
        reason: 'Studio cancellation — deposit converted to credit',
        cancelReason: reason || 'studio_cancelled',
        createdBy: staffId || 'system',
        expiresAt: getStoreCreditExpiry(tenant),
        createdAt: now, usedAt: null, usedOnAppointmentId: null, status: 'available',
      };

      const storeCreditsToAdd: any[] = [creditEntry];
      let totalCreditDollars = dollars;

      // Discretionary/goodwill credit — a REAL expense, separate from the
      // deposit conversion above, since nothing was collected for it.
      if (extraCents > 0) {
        const goodwillEntry = {
          id: `goodwill_${appointmentId}_${Date.now()}`,
          tenantId, clientId, appointmentId,
          amountCents: extraCents, amount: extraDollars,
          type: 'courtesy' as const,
          source: 'goodwill' as const,
          reason: additionalCreditReason || 'Service recovery — goodwill credit',
          cancelReason: reason || 'studio_cancelled',
          createdBy: staffId || 'system',
          expiresAt: getStoreCreditExpiry(tenant),
          createdAt: now, usedAt: null, usedOnAppointmentId: null, status: 'available',
        };
        storeCreditsToAdd.push(goodwillEntry);
        totalCreditDollars += extraDollars;

        const goodwillTxRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        batch.set(goodwillTxRef, {
          id: goodwillTxRef.id, tenantId, appointmentId, clientId,
          clientName: client.name || 'Client',
          type: 'expense', category: 'Service Recovery',
          amount: extraDollars, amountCents: extraCents, status: 'issued',
          reason: additionalCreditReason || 'Service recovery — goodwill credit',
          disposition: 'store_credit', createdAt: now,
          notes: 'Discretionary credit beyond the deposit amount — staff-issued goodwill, distinct from the deposit conversion below.',
        });
      }

      batch.update(db.doc(`tenants/${tenantId}/clients/${clientId}`), {
        storeCredits: FieldValue.arrayUnion(...storeCreditsToAdd),
        totalStoreCredit: FieldValue.increment(totalCreditDollars),
      });

      batch.update(db.doc(`tenants/${tenantId}/appointments/${appointmentId}`), {
        depositConvertedToCredit: true,
        depositConvertedToCreditAt: now,
        depositConvertedAmountCents: depositAmountCents,
        depositDisposition: 'store_credit',
      });

      const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      batch.set(txRef, {
        id: txRef.id, tenantId, appointmentId, clientId,
        clientName: client.name || 'Client',
        type: 'store_credit_issued', category: 'Store Credit',
        amount: dollars, amountCents: depositAmountCents, status: 'issued',
        reason: reason || 'studio_cancelled', disposition: 'store_credit',
        expiresAt: creditEntry.expiresAt, createdAt: now,
        notes: originalFeeCents > 0
          ? `Processing fee already sunk on the original deposit charge: $${(originalFeeCents / 100).toFixed(2)} (not recoverable; the appointment isn't happening, so there's no revenue to offset it).`
          : undefined,
      });

      const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
      batch.set(auditRef, {
        id: auditRef.id, tenantId, entityType: 'deposit_store_credit', entityId: appointmentId,
        actorId: staffId || 'system', timestamp: now,
        summary: `$${dollars.toFixed(2)} deposit converted to store credit for ${client.name || 'client'}${extraCents > 0 ? ` + $${extraDollars.toFixed(2)} goodwill credit` : ''}`,
        detail: { disposition: 'store_credit', creditId: credit.id, reason, originalFeeCents, additionalCreditCents: extraCents },
      });

      await batch.commit();
      return NextResponse.json({
        ok: true, disposition: 'store_credit', creditId: credit.id,
        amount: dollars, additionalCredit: extraDollars, totalCredit: totalCreditDollars,
        expiresAt: creditEntry.expiresAt, originalFeeCents,
      });
    }
  } catch (err: any) {
    console.error('[studio-cancel-refund]', err);
    return NextResponse.json({ ok: false, reason: err.message || 'Unknown error', code: err.code }, { status: 500 });
  }
}