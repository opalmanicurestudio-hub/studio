import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';

// ─── Lazy inits — must NOT be at module scope (build-time env vars unavailable) ─
function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('[stripe/webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta    = session.metadata;

    if (!meta?.tenantId || !meta?.eventId) {
      console.error('[stripe/webhook] Missing metadata on session', session.id);
      return NextResponse.json({ received: true });
    }

    try {
      const db       = getAdminDb();
      const ticketId = nanoid();
      const code     = nanoid(8).toUpperCase();

      // Prevent duplicate ticket creation if webhook fires twice
      const existing = await db
        .collection(`tenants/${meta.tenantId}/eventTickets`)
        .where('stripeSessionId', '==', session.id)
        .limit(1)
        .get();

      if (!existing.empty) {
        console.log('[stripe/webhook] Ticket already created for session', session.id);
        return NextResponse.json({ received: true });
      }

      const ticket = {
        id:                    ticketId,
        eventId:               meta.eventId,
        tenantId:              meta.tenantId,
        guestName:             meta.guestName,
        guestEmail:            meta.guestEmail,
        guestPhone:            meta.guestPhone  || null,
        guestId:               meta.guestId     || null,
        type:                  'paid',
        status:                'paid',
        price:                 (session.amount_total || 0) / 100,
        amountPaid:            (session.amount_total || 0) / 100,
        ticketCode:            code,
        stripeSessionId:       session.id,
        stripePaymentIntentId: session.payment_intent as string || null,
        source:                meta.guestId ? 'invite_link' : 'public',
        invitedAt:             null,
        confirmedAt:           new Date().toISOString(),
        checkedInAt:           null,
        tableNumber:           null,
        seatNumber:            null,
      };

      await db
        .collection(`tenants/${meta.tenantId}/eventTickets`)
        .doc(ticketId)
        .set(ticket);

      // ── EMAIL stub ─────────────────────────────────────────────────────────
      // Uncomment when Resend is configured:
      //
      // await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/ticket-confirmation`, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ ticket, tenantId: meta.tenantId }),
      // });

      // ── SMS stub ───────────────────────────────────────────────────────────
      // Uncomment when Twilio is configured:
      //
      // if (meta.guestPhone) {
      //   await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/ticket-sms`, {
      //     method: 'POST',
      //     headers: { 'Content-Type': 'application/json' },
      //     body: JSON.stringify({
      //       phone:      meta.guestPhone,
      //       ticketCode: code,
      //       eventName:  meta.ticketName,
      //     }),
      //   });
      // }

      console.log('[stripe/webhook] Ticket created:', ticketId, 'for', meta.guestEmail);
    } catch (err: any) {
      console.error('[stripe/webhook] Failed to create ticket:', err.message);
      return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}