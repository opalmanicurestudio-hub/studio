import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';
import { buildLedgerEntry, ledgerEntryId } from '@/lib/ledger';

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

    // ════════════════════════════════════════════════════════════════════════
    // APPOINTMENT DEPOSIT branch
    // Fires for sessions created by /api/stripe/deposit (metadata.type==='deposit').
    // Marks the booking request paid, parks a deposit CREDIT on the client, and
    // posts the deposit to the ledger. The credit is consumed later at POS
    // checkout, which subtracts it so service revenue isn't double-counted.
    // ════════════════════════════════════════════════════════════════════════
    if (meta?.type === 'deposit') {
      if (!meta.tenantId || !meta.bookingRequestId) {
        console.error('[stripe/webhook] Deposit session missing metadata', session.id);
        return NextResponse.json({ received: true });
      }

      try {
        const db          = getAdminDb();
        const tenantId    = meta.tenantId;
        const amountCents = session.amount_total || 0;

        // Idempotency: if a credit already exists for this Stripe session, stop.
        const dupe = await db
          .collection(`tenants/${tenantId}/depositCredits`)
          .where('stripeSessionId', '==', session.id)
          .limit(1)
          .get();
        if (!dupe.empty) {
          console.log('[stripe/webhook] Deposit already recorded for session', session.id);
          return NextResponse.json({ received: true });
        }

        // Pull whatever the booking request can tell us (tolerate it being gone).
        let reqData: any = {};
        try {
          const reqSnap = await db.doc(`tenants/${tenantId}/bookingRequests/${meta.bookingRequestId}`).get();
          if (reqSnap.exists) reqData = reqSnap.data() || {};
        } catch { /* request not readable — fall back to metadata */ }

        const clientEmail = (reqData.clientEmail || meta.clientEmail || '').toLowerCase().trim();
        const clientName  = reqData.clientName  || meta.clientName  || 'Guest';
        const clientId    = reqData.clientId    || null;
        const serviceName = reqData.serviceName || meta.serviceName || '';
        const creditId    = nanoid();
        const nowISO      = new Date().toISOString();
        const ledgerDocId = ledgerEntryId('appointment_deposit', session.id);

        const batch = db.batch();

        // 1) Mark the booking request paid
        batch.set(
          db.doc(`tenants/${tenantId}/bookingRequests/${meta.bookingRequestId}`),
          {
            depositStatus:         'paid',
            depositPaidAt:         nowISO,
            stripeSessionId:       session.id,
            stripePaymentIntentId: (session.payment_intent as string) || null,
          },
          { merge: true }
        );

        // 2) Park the deposit as an available credit on the client
        batch.set(
          db.collection(`tenants/${tenantId}/depositCredits`).doc(creditId),
          {
            id:                    creditId,
            tenantId,
            bookingRequestId:      meta.bookingRequestId,
            clientId,
            clientEmail,
            clientName,
            serviceName,
            amountCents,
            amountDollars:         amountCents / 100,
            status:                'available',           // → 'consumed' at checkout
            appointmentId:         null,
            stripeSessionId:       session.id,
            stripePaymentIntentId: (session.payment_intent as string) || null,
            ledgerSourceId:        ledgerDocId,
            createdAt:             nowISO,
            consumedAt:            null,
          }
        );

        // 3) Post the deposit to the general ledger (idempotent doc id)
        const entry = buildLedgerEntry({
          source:                'appointment_deposit',
          sourceId:              session.id,
          amountCents,
          category:              'Deposits',
          description:           `Appointment deposit — ${serviceName || 'Service'} — ${clientName}`,
          clientOrVendor:        clientName,
          clientId:              clientId || undefined,
          paymentMethod:         'Card (Stripe)',
          stripePaymentIntentId: (session.payment_intent as string) || null,
        });
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc(ledgerDocId);
        batch.set(txnRef, { ...entry, id: txnRef.id });

        await batch.commit();
        console.log('[stripe/webhook] Deposit recorded:', creditId, 'for', clientEmail);
      } catch (err: any) {
        console.error('[stripe/webhook] Failed to record deposit:', err.message);
        return NextResponse.json({ error: 'Failed to record deposit' }, { status: 500 });
      }

      return NextResponse.json({ received: true });
    }

    // ════════════════════════════════════════════════════════════════════════
    // EVENT TICKET branch (unchanged)
    // ════════════════════════════════════════════════════════════════════════
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

      // ── Ticket + general-ledger income line, written atomically ──────────────
      // The ledger transaction routes through the same canonical funnel the rest
      // of the app uses. Its doc ID is derived from the Stripe session ID, so a
      // retried webhook overwrites the same row instead of double-posting income.
      const batch = db.batch();

      batch.set(
        db.collection(`tenants/${meta.tenantId}/eventTickets`).doc(ticketId),
        ticket
      );

      const entry = buildLedgerEntry({
        source:                'event_ticket',
        sourceId:              session.id,
        amountCents:           session.amount_total || 0,
        category:              'Event Tickets',
        description:           `Event ticket — ${meta.ticketName || 'General Admission'} — ${meta.guestName || 'Guest'}`,
        clientOrVendor:        meta.guestName || 'Guest',
        paymentMethod:         'Card (Stripe)',
        relatedEventId:        meta.eventId,
        stripePaymentIntentId: (session.payment_intent as string) || null,
      });
      const txnRef = db
        .collection(`tenants/${meta.tenantId}/transactions`)
        .doc(ledgerEntryId('event_ticket', session.id));
      batch.set(txnRef, { ...entry, id: txnRef.id });

      await batch.commit();

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