/**
 * POST /api/stripe/booking-card
 *
 * Vaults a card at booking time WITHOUT charging it.
 *
 * WHY THIS EXISTS
 * A shop can require a card on file. Until now that setting stamped
 * requiresCardOnFile on the appointment and nothing collected one — the card
 * only ever arrived as a side effect of paying a deposit. So the two timings
 * that take no money at booking (on_approval, on_penalty) produced bookings
 * with no card at all, and accepting one could only ever send a pay link.
 *
 * This is Stripe Checkout in setup mode: the client enters a card, the issuer
 * authorises it, nothing is charged. A card that would decline fails HERE, in
 * front of the person who can fix it, rather than silently at accept time.
 *
 * The existing connect webhook already vaults on a completed setup session
 * keyed by client_reference_id, so passing the clientId is the whole
 * integration — no second write path to keep in step.
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tenantId = String(body.tenantId || '').trim();
  const clientId = String(body.clientId || '').trim();
  const clientEmail = String(body.clientEmail || '').trim();
  const clientName = String(body.clientName || '').trim();
  const serviceName = String(body.serviceName || '').trim();

  if (!tenantId || !clientId) {
    return NextResponse.json({ error: 'tenantId and clientId are required.' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
    }
    const tenant = tenantSnap.data() as any;
    const stripeAccountId = tenant?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json({ error: 'This studio is not set up to take cards yet.' }, { status: 400 });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        ui_mode: 'embedded',
        mode: 'setup',
        payment_method_types: ['card'],
        customer_email: clientEmail || undefined,
        /* The webhook's vaulting branch reads this to know whose card it is. */
        client_reference_id: clientId,
        metadata: {
          tenantId,
          clientId,
          type: 'booking_card',
          serviceName,
          clientName,
        },
        redirect_on_completion: 'never',
      },
      { stripeAccount: stripeAccountId },
    );

    return NextResponse.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
      stripeAccountId,
    });
  } catch (err: any) {
    console.error('[stripe/booking-card]', err);
    return NextResponse.json({ error: err.message || 'Could not start card setup.' }, { status: 500 });
  }
}
