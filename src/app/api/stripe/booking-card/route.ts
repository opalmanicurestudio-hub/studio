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

  const appointmentId = String(body.appointmentId || '').trim();
  const checkInToken = String(body.checkInToken || '').trim();
  if (!tenantId || !clientId || !appointmentId || !checkInToken) {
    return NextResponse.json({ error: 'This booking link isn’t complete — please book again.' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
    }
    const tenant = tenantSnap.data() as any;
    /* WHO'S ASKING: only the booking that was just made can put a card on its client — the request must carry that
     * booking's own id and its private visit token (both come back from /api/appointments/book), the booking must be
     * this client's, ask for a card on file, and still be live. Knowing a business id and a client id is not enough. */
    const ap: any = (await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get()).data();
    const live = ap && !['cancelled', 'canceled', 'completed', 'no_show', 'declined', 'expired'].includes(String(ap.status || ''));
    if (!live || String(ap.clientId || '') !== clientId || !ap.checkInToken || String(ap.checkInToken) !== checkInToken || ap.requiresCardOnFile !== true) {
      return NextResponse.json({ error: 'We couldn’t match this to your booking — please book again.' }, { status: 403 });
    }
    const stripeAccountId = tenant?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json({ error: 'This studio is not set up to take cards yet.' }, { status: 400 });
    }

    const stripe = getStripe();
    // Saved UNDER a customer on the business's account, or the card can't be charged later (lib/card-save).
    const clientDoc: any = (await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data();
    const { ensureStripeCustomer } = await import('@/lib/card-save');
    const customer = clientDoc ? await ensureStripeCustomer(db, tenantId, stripeAccountId, clientId, { ...clientDoc, email: clientDoc.email || clientEmail || null }) : null;
    const session = await stripe.checkout.sessions.create(
      {
        ui_mode: 'embedded',
        mode: 'setup',
        payment_method_types: ['card'],
        ...(customer ? { customer } : { customer_email: clientEmail || undefined }),
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
