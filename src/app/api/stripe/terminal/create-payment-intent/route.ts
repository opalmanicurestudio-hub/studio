import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
import Stripe from 'stripe';
import { readerDepositAmount, recordWaitingReaderDeposit } from '@/lib/reader-deposit';

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
    } = await req.json();
    // A deposit taken on the reader for a booking carries that booking, so only it can be recorded with this payment.
    const forBooking = String(appointmentId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
    const purpose = String(kind || '') === 'deposit' && forBooking ? 'deposit' : '';
    { const g = await requireRole(req, String(tenantId || ''), 'staff'); if (g.deny) return g.deny; }

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
        metadata: { tenantId, clientId: clientId || '', source: 'terminal', ...(purpose ? { appointmentId: forBooking, kind: purpose } : {}) },
      },
      { stripeAccount: stripeAccountId }
    );

    // The booking knows a reader payment was started for it, so it's recorded even if the screen loses its connection
    // before saying so (lib/reader-deposit).
    if (bookingRef) await bookingRef.set({ depositReaderPi: { id: intent.id, at: new Date().toISOString(), cents: charge } }, { merge: true });

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
