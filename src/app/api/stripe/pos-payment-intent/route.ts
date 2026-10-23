// ─── /api/stripe/pos-payment-intent/route.ts ──────────────────────────────────
// Creates a PaymentIntent for the embedded card form at POS checkout.
// Optionally creates/reuses a Stripe customer so the card can be saved.
// A desk sale names its started ticket on the payment, and is never started when the sale is already paid, finished,
// discarded, part paid in a split, or has a card reader payment still going (lib/reader-sale).

import { requireRole } from '@/lib/route-guard';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { safeId, ticketBlocks } from '@/lib/reader-sale';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
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
  return getFirestore(app);
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

export async function POST(req: NextRequest) {
  try {
    const {
      tenantId,
      clientId,
      amountCents,
      description = 'Studio Services',
      saveCard = false,
      pendingId = '',
    } = await req.json();
    { const g = await requireRole(req, String(tenantId || ''), 'staff'); if (g.deny) return g.deny; }

    if (!tenantId || !amountCents || amountCents <= 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json({ error: 'No connected Stripe account' }, { status: 400 });
    }

    const stripe = getStripe();
    const forTicket = safeId(pendingId);
    if (forTicket) {
      const block = await ticketBlocks(db, String(tenantId), forTicket, { stripe, acct: stripeAccountId });
      if (block) return NextResponse.json({ code: block.code, error: block.error, ...(block.paidWith ? { paidWith: block.paidWith, paidPayload: block.paidPayload } : {}) }, { status: block.status });
    }
    let customerId: string | undefined;

    if (saveCard && clientId) {
      const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
      const clientData  = clientSnap.data();
      customerId = clientData?.cardOnFile?.customerId;
      if (!customerId) {
        const customer = await stripe.customers.create(
          { email: clientData?.email || undefined, name: clientData?.name || undefined },
          { stripeAccount: stripeAccountId }
        );
        customerId = customer.id;
      }
    }

    const intent = await stripe.paymentIntents.create(
      {
        amount:   amountCents,
        currency: 'usd',
        ...(customerId ? { customer: customerId } : {}),
        ...(saveCard   ? { setup_future_usage: 'off_session' } : {}),
        description,
        metadata: { tenantId, clientId: clientId || '', source: 'pos_embedded', ...(forTicket ? { pendingId: forTicket } : {}) },
      },
      { stripeAccount: stripeAccountId }
    );

    return NextResponse.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      customerId: customerId || null,
    });
  } catch (err: any) {
    console.error('[pos-payment-intent]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
