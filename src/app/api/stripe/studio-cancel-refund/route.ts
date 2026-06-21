/**
 * api/stripe/studio-cancel-refund/route.ts
 *
 * Handles the deposit disposition when the STUDIO cancels an appointment.
 * The studio is always at fault here — client should never lose money.
 *
 * REVISED: the previous version trusted depositAmountCents and
 * stripePaymentIntentId passed directly in the request body, sourced from
 * appointment.depositAmountCents / appointment.depositStripePaymentIntentId.
 * Those appointment-level fields are not populated by the actual
 * deposit-payment webhook in this codebase — only
 * tenants/{tenantId}/depositCredits is. This route now looks the deposit up
 * itself from that collection, the same way every other cancellation path
 * (self-cancel, useCancellationConfirm's client/no-show handling) does, so
 * there's exactly one source of truth for "does this client have a paid
 * deposit on file."
 *
 * Three places money can land for a studio cancellation, now reconciled:
 *   1. depositCredits/{id} — the SOURCE record. Always marked
 *      'refunded' or 'consumed' here so it can never be double-applied to
 *      a future booking.
 *   2. Stripe refund — only for the 'refund' disposition.
 *   3. client.storeCredits[] / client.totalStoreCredit — the GENERAL
 *      wallet actually spent at POS via StoreCreditPanel. Only written for
 *      the 'store_credit' disposition; this is deliberately a different
 *      mechanism from depositCredits (which auto-applies to a specific
 *      future booking) — converting a deposit moves its value here so
 *      staff/client can use it on anything, not just a re-booking.
 *
 * POST body:
 *   { tenantId, clientId, appointmentId, disposition, staffId, reason }
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

// ── Helper: compute store credit expiry from tenant config ────────────────────
function getStoreCreditExpiry(tenant: any): string | null {
  const days = tenant?.storeCreditExpiryDays;
  if (!days || days === 0) return null; // never expires
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const { tenantId, clientId, appointmentId, disposition, staffId, reason } = body;

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
  // Field name matches the convention used everywhere else in this codebase
  // (stripePaymentIntentId). If the deposit-payment webhook stores it under a
  // different key on depositCredits docs, update this one line.
  const stripePaymentIntentId = credit.stripePaymentIntentId || null;

  const batch = db.batch();

  try {
    if (disposition === 'refund') {
      if (!tenant.stripeAccountId) {
        return NextResponse.json({ ok: false, reason: 'No connected Stripe account.' }, { status: 400 });
      }
      if (!stripePaymentIntentId) {
        // No payment intent to refund against — fall back to store credit.
        // Handles deposits paid cash, or where depositCredits doesn't carry
        // a Stripe reference for this client/tenant.
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

      // Mark the SOURCE credit refunded — prevents it from ever being
      // auto-applied to a future booking's deposit offset.
      batch.set(credit.ref, {
        status: 'refunded',
        refundedAt: now,
        refundedFromAppointmentId: appointmentId,
        stripeRefundId: refund.id,
      }, { merge: true });

      // Informational mirror on the appointment — NOT authoritative, just
      // for quick display (e.g. "deposit was refunded" on the client page).
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
      });

      const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
      batch.set(auditRef, {
        id: auditRef.id, tenantId, entityType: 'deposit_refund', entityId: appointmentId,
        actorId: staffId || 'system', timestamp: now,
        summary: `Deposit refunded $${dollars.toFixed(2)} to ${client.name || 'client'} — studio cancelled`,
        detail: { disposition: 'refunded', stripeRefundId: refund.id, reason },
      });

      await batch.commit();
      return NextResponse.json({ ok: true, disposition: 'refunded', refundId: refund.id, amount: dollars });

    } else {
      // ── Store credit path ────────────────────────────────────────────────
      // Consume the SOURCE depositCredits record (so it can't also get
      // auto-applied to a future booking) and add the same amount to the
      // client's general store-credit wallet — the mechanism actually spent
      // at POS checkout via StoreCreditPanel.
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
        reason: 'Studio cancellation — deposit converted to credit',
        cancelReason: reason || 'studio_cancelled',
        expiresAt: getStoreCreditExpiry(tenant),
        createdAt: now, usedAt: null, usedOnAppointmentId: null, status: 'available',
      };

      batch.update(db.doc(`tenants/${tenantId}/clients/${clientId}`), {
        storeCredits: FieldValue.arrayUnion(creditEntry),
        totalStoreCredit: FieldValue.increment(dollars),
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
      });

      const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
      batch.set(auditRef, {
        id: auditRef.id, tenantId, entityType: 'deposit_store_credit', entityId: appointmentId,
        actorId: staffId || 'system', timestamp: now,
        summary: `$${dollars.toFixed(2)} deposit converted to store credit for ${client.name || 'client'}`,
        detail: { disposition: 'store_credit', creditId: credit.id, reason },
      });

      await batch.commit();
      return NextResponse.json({ ok: true, disposition: 'store_credit', creditId: credit.id, amount: dollars, expiresAt: creditEntry.expiresAt });
    }
  } catch (err: any) {
    console.error('[studio-cancel-refund]', err);
    return NextResponse.json({ ok: false, reason: err.message || 'Unknown error', code: err.code }, { status: 500 });
  }
}