/**
 * api/stripe/studio-cancel-refund/route.ts
 *
 * Handles the deposit disposition when the STUDIO cancels an appointment.
 * The studio is always at fault here — client should never lose money.
 *
 * Supports three outcomes (configured per tenant, overridable per cancellation):
 *   'refund'       — Return deposit to card via Stripe refund
 *   'store_credit' — Add deposit to client's credit wallet (usable on next visit)
 *   'both_choice'  — Send client a link to choose (default recommended)
 *
 * POST body:
 *   {
 *     tenantId,
 *     clientId,
 *     appointmentId,
 *     depositAmountCents,       // the deposit that was paid
 *     stripePaymentIntentId,    // original deposit payment intent to refund against
 *     disposition,              // 'refund' | 'store_credit'
 *     staffId,
 *     reason,                   // why studio is cancelling
 *   }
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

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const {
    tenantId,
    clientId,
    appointmentId,
    depositAmountCents,
    stripePaymentIntentId,
    disposition,   // 'refund' | 'store_credit'
    staffId,
    reason,
  } = body;

  if (!tenantId || !clientId || !appointmentId || !depositAmountCents || !disposition) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!['refund', 'store_credit'].includes(disposition)) {
    return NextResponse.json({ error: 'disposition must be refund or store_credit' }, { status: 400 });
  }

  const { db, FieldValue } = getAdmin();
  const now     = new Date().toISOString();
  const dollars = depositAmountCents / 100;

  const batch = db.batch();

  // ── Load tenant's connected Stripe account ────────────────────────────────
  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant     = tenantSnap.data();
  if (!tenant?.stripeAccountId) {
    return NextResponse.json({ error: 'No connected Stripe account' }, { status: 400 });
  }

  // ── Load client ───────────────────────────────────────────────────────────
  const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
  const client     = clientSnap.data() || {};

  try {
    if (disposition === 'refund') {
      // ── Stripe refund path ─────────────────────────────────────────────────
      if (!stripePaymentIntentId) {
        // No payment intent to refund against — fall back to store credit
        // This handles cases where deposit was paid cash or outside Stripe
        return NextResponse.json({
          ok:      false,
          reason:  'No Stripe payment intent on file for this deposit — apply store credit instead',
          fallback: 'store_credit',
        });
      }

      const stripe = getStripe();

      // Retrieve the original payment intent to get the charge ID
      const intent = await stripe.paymentIntents.retrieve(
        stripePaymentIntentId,
        { stripeAccount: tenant.stripeAccountId },
      );

      if (intent.status !== 'succeeded') {
        return NextResponse.json({
          ok:     false,
          reason: `Payment intent status is ${intent.status} — cannot refund`,
        });
      }

      // Create the refund
      const refund = await stripe.refunds.create(
        {
          payment_intent: stripePaymentIntentId,
          amount:         depositAmountCents,
          reason:         'requested_by_customer', // most accurate for studio-initiated
          metadata: {
            tenantId,
            clientId,
            appointmentId,
            staffId:       staffId || 'system',
            cancelReason:  reason || 'studio_cancelled',
            disposition:   'refund',
          },
        },
        { stripeAccount: tenant.stripeAccountId },
      );

      // Update appointment
      batch.update(db.doc(`tenants/${tenantId}/appointments/${appointmentId}`), {
        depositRefunded:           true,
        depositRefundedAt:         now,
        depositRefundedAmountCents: depositAmountCents,
        depositStripeRefundId:     refund.id,
        depositDisposition:        'refunded',
        depositStatus:             'refunded',
      });

      // Transaction record (negative = money going out)
      const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      batch.set(txRef, {
        id:                    txRef.id,
        tenantId,
        appointmentId,
        clientId,
        clientName:            client.name || 'Client',
        type:                  'refund',
        category:              'Deposit Refund',
        amount:                -dollars, // negative: outgoing
        amountCents:           -depositAmountCents,
        stripePaymentIntentId,
        stripeRefundId:        refund.id,
        status:                'succeeded',
        reason:                reason || 'studio_cancelled',
        disposition:           'refunded',
        createdAt:             now,
      });

      // Audit log
      const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
      batch.set(auditRef, {
        id:         auditRef.id,
        tenantId,
        entityType: 'deposit_refund',
        entityId:   appointmentId,
        actorId:    staffId || 'system',
        timestamp:  now,
        summary:    `Deposit refunded $${dollars.toFixed(2)} to ${client.name || 'client'} — studio cancelled`,
        detail:     { disposition: 'refunded', stripeRefundId: refund.id, reason },
      });

      await batch.commit();

      return NextResponse.json({
        ok:          true,
        disposition: 'refunded',
        refundId:    refund.id,
        amount:      dollars,
      });

    } else {
      // ── Store credit path ──────────────────────────────────────────────────
      // Add to client's credit wallet. Credits are consumed at next checkout
      // before any new payment is requested.

      const creditEntry = {
        id:            `credit_${appointmentId}`,
        tenantId,
        clientId,
        appointmentId,
        amountCents:   depositAmountCents,
        amount:        dollars,
        reason:        `Studio cancellation — deposit converted to credit`,
        cancelReason:  reason || 'studio_cancelled',
        expiresAt:     getStoreCreditExpiry(tenant),
        createdAt:     now,
        usedAt:        null,
        usedOnAppointmentId: null,
        status:        'available',
      };

      // Add to client's credit wallet
      batch.update(db.doc(`tenants/${tenantId}/clients/${clientId}`), {
        storeCredits:       FieldValue.arrayUnion(creditEntry),
        totalStoreCredit:   FieldValue.increment(dollars),
      });

      // Update appointment
      batch.update(db.doc(`tenants/${tenantId}/appointments/${appointmentId}`), {
        depositConvertedToCredit:           true,
        depositConvertedToCreditAt:         now,
        depositConvertedAmountCents:        depositAmountCents,
        depositDisposition:                 'store_credit',
        depositStatus:                      'converted_to_credit',
      });

      // Transaction record
      const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      batch.set(txRef, {
        id:            txRef.id,
        tenantId,
        appointmentId,
        clientId,
        clientName:    client.name || 'Client',
        type:          'store_credit_issued',
        category:      'Store Credit',
        amount:        dollars,
        amountCents:   depositAmountCents,
        status:        'issued',
        reason:        reason || 'studio_cancelled',
        disposition:   'store_credit',
        expiresAt:     creditEntry.expiresAt,
        createdAt:     now,
      });

      // Audit log
      const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
      batch.set(auditRef, {
        id:         auditRef.id,
        tenantId,
        entityType: 'deposit_store_credit',
        entityId:   appointmentId,
        actorId:    staffId || 'system',
        timestamp:  now,
        summary:    `$${dollars.toFixed(2)} deposit converted to store credit for ${client.name || 'client'}`,
        detail:     { disposition: 'store_credit', creditId: creditEntry.id, reason },
      });

      await batch.commit();

      return NextResponse.json({
        ok:          true,
        disposition: 'store_credit',
        creditId:    creditEntry.id,
        amount:      dollars,
        expiresAt:   creditEntry.expiresAt,
      });
    }

  } catch (err: any) {
    console.error('[studio-cancel-refund]', err);
    return NextResponse.json({
      ok:     false,
      reason: err.message || 'Unknown error',
      code:   err.code,
    }, { status: 500 });
  }
}

// ── Helper: compute store credit expiry from tenant config ────────────────────
function getStoreCreditExpiry(tenant: any): string | null {
  const days = tenant.storeCreditExpiryDays;
  if (!days || days === 0) return null; // never expires
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
