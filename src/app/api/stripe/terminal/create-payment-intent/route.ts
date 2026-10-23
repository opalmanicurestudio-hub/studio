import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
import Stripe from 'stripe';
import { readerDepositAmount, recordWaitingReaderDeposit } from '@/lib/reader-deposit';
import { earlierReaderPayment, liveShares, noteReaderStart, paidPayloadOf, releaseReaderPayment, ticketPayment, viaWords } from '@/lib/reader-sale';

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
      appointmentId = '',
      kind = '',
      pendingId = '',
      previousPaymentIntentId = '',
    } = await req.json();
    // A deposit taken on the reader for a booking carries that booking, so only it can be recorded with this payment.
    const forBooking = String(appointmentId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
    // A sale at the desk carries its started ticket (saved before any card is charged), so the payment is always
    // accounted for on it, whatever happens to the screen (lib/reader-sale).
    const forTicket = String(pendingId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
    const purpose = String(kind || '') === 'deposit' && forBooking ? 'deposit' : String(kind || '') === 'sale' ? 'sale' : '';
    const g = await requireRole(req, String(tenantId || ''), 'staff'); if (g.deny) return g.deny;
    if (purpose === 'sale' && !forTicket) return NextResponse.json({ error: 'The sale wasn’t saved before charging. Check the internet connection and try again. Nothing was charged.', code: 'no_ticket' }, { status: 400 });

    const db = getAdminDb();
    // A booking's deposit: the amount is the booking's own (its deposit, and a balance collected with it), as the server
    // has it, never what the screen sent; a booking that owes none, or has paid it, isn't charged.
    let charge = Math.round(Number(amountCents) || 0);
    let bookingRef: any = null;
    if (purpose === 'deposit') {
      bookingRef = db.doc(`tenants/${tenantId}/appointments/${forBooking}`);
      const ap: any = (await bookingRef.get()).data();
      if (!ap) return NextResponse.json({ error: 'That booking wasn’t found.' }, { status: 404 });
      if (ap.depositStatus === 'paid') return NextResponse.json({ error: 'This booking’s deposit is already paid.', code: 'already_paid' }, { status: 409 });
      // An earlier reader payment for it that went through but wasn't recorded (the screen lost its connection) is
      // recorded now, and the card isn't charged again.
      if (ap.depositReaderPi?.id) {
        const earlier = await recordWaitingReaderDeposit(db, String(tenantId), { id: forBooking, ...ap }, { origin: req.nextUrl.origin });
        if (earlier?.ok) return NextResponse.json({ error: 'This booking’s deposit was already taken on the card reader.', code: 'already_paid' }, { status: 409 });
      }
      const due = readerDepositAmount(ap);
      if (due.depositCents <= 0) return NextResponse.json({ error: 'This booking has no deposit to take.', code: 'no_deposit' }, { status: 409 });
      charge = due.totalCents;
    }
    if (!tenantId || !charge || charge <= 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json({ error: 'No connected Stripe account' }, { status: 400 });
    }

    const stripe = getStripe();

    // A sale that already has a reader payment that went through isn't charged again: that payment is used. One the
    // reader approved but that wasn't captured is captured instead (same amount), or released (the amount changed).
    if (purpose === 'sale') {
      const ticket: any = (await db.doc(`tenants/${tenantId}/pendingCheckouts/${forTicket}`).get()).data();
      if (!ticket) return NextResponse.json({ error: 'The sale wasn’t found. Start it again. Nothing was charged.', code: 'no_ticket' }, { status: 404 });
      if (ticket.status === 'completed') return NextResponse.json({ error: 'This sale is already finished.', code: 'sale_done' }, { status: 409 });
      if (ticket.status === 'discarded') return NextResponse.json({ error: 'This sale was discarded. Ring it up again. Nothing was charged.', code: 'sale_discarded' }, { status: 409 });
      // Already paid another way (the client screen, a saved or typed card): never charged again on the reader.
      const paid = ticketPayment(ticket);
      if (paid && paid.via !== 'card_reader') return NextResponse.json({ code: 'ticket_paid', paidWith: paid, paidPayload: paidPayloadOf(ticket),
        error: `This sale was already paid${paid.cents ? `: $${(paid.cents / 100).toFixed(2)}` : ''} ${viaWords(paid.via)}. Save the sale with that payment. Nothing was charged.` }, { status: 409 });
      if (liveShares(ticket).length) return NextResponse.json({ code: 'ticket_split', error: 'Part of this bill was already paid in a split. Finish it in Split the bill. Nothing was charged.' }, { status: 409 });
      const earlier = await earlierReaderPayment(db, stripe, stripeAccountId, String(tenantId), forTicket, String(previousPaymentIntentId || '') || null, charge);
      if (earlier.unknown) return NextResponse.json({ code: 'reader_unknown', paymentIntentId: earlier.unknown.id, error: 'We couldn’t check the last card payment for this sale, so nothing new was charged. Check the internet connection and try again.' }, { status: 503 });
      if (earlier.use) return NextResponse.json({ code: 'sale_paid', paymentIntentId: earlier.use.id, amountCents: earlier.use.cents, error: 'This sale’s card payment already went through.' }, { status: 409 });
      if (earlier.processing) return NextResponse.json({ code: 'reader_processing', paymentIntentId: earlier.processing.id, error: 'The last card payment for this sale is still being processed. Check it again in a moment before charging.' }, { status: 409 });
      if (earlier.differs) return NextResponse.json({ code: 'sale_paid_other_amount', paymentIntentId: earlier.differs.id, amountCents: earlier.differs.cents,
        error: `A $${(earlier.differs.cents / 100).toFixed(2)} card payment already went through for this sale. Change the sale back to that total to finish it with that payment, or ask a manager to refund it in Needs attention.` }, { status: 409 });
    }

    // Resolve or create Stripe customer for card saving
    let customerId: string | undefined;
    if (saveCard && clientId) {
      const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
      const clientData = clientSnap.data();
      customerId = clientData?.cardOnFile?.customerId;
      if (!customerId && clientData?.email) {
        const customer = await stripe.customers.create(
          { email: clientData.email, name: clientData.name || undefined },
          { stripeAccount: stripeAccountId }
        );
        customerId = customer.id;
      }
    }

    const intent = await stripe.paymentIntents.create(
      {
        amount: charge,
        currency: 'usd',
        payment_method_types: ['card_present'],
        capture_method: 'manual', // Terminal requires manual capture
        ...(saveCard && customerId ? {
          customer: customerId,
          setup_future_usage: 'off_session',
        } : {}),
        description,
        metadata: { tenantId, clientId: clientId || '', source: 'terminal', ...(purpose === 'deposit' ? { appointmentId: forBooking, kind: purpose } : purpose === 'sale' ? { kind: 'sale', pendingId: forTicket } : {}) },
      },
      { stripeAccount: stripeAccountId }
    );

    // The booking knows a reader payment was started for it, so it's recorded even if the screen loses its connection
    // before saying so (lib/reader-deposit).
    if (bookingRef) await bookingRef.set({ depositReaderPi: { id: intent.id, at: new Date().toISOString(), cents: charge } }, { merge: true });
    // So does the sale's ticket. If the ticket can't be told, the payment is called off before the reader sees it.
    if (purpose === 'sale') {
      try { await noteReaderStart(db, String(tenantId), forTicket, intent.id, charge, g.actor?.name || null); }
      catch (e) {
        await releaseReaderPayment(stripe, stripeAccountId, intent.id, String(tenantId)).catch(() => null);
        return NextResponse.json({ error: 'The payment couldn’t be started. Check the internet connection and try again. Nothing was charged.' }, { status: 503 });
      }
    }

    return NextResponse.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      customerId: customerId || null,
      amountCents: charge,
    });
  } catch (err: any) {
    console.error('[terminal/create-payment-intent]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
