import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
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
      completionToken,
      appointmentId,
      clientId,
      clientName,
      clientEmail,
      depositAmount = 0,
      serviceName,
    } = await req.json();

    if (!tenantId || !completionToken || !clientEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
    }

    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json(
        { error: 'This studio has not connected a payment account yet.' },
        { status: 400 }
      );
    }

    // ── Verify the connected account exists and is usable ──────────────────
    const stripe = getStripe();
    let connectedAccount;
    try {
      connectedAccount = await stripe.accounts.retrieve(stripeAccountId);
    } catch (e: any) {
      console.error('[stripe/completion] Failed to retrieve connected account:', e.message);
      return NextResponse.json(
        { error: 'Could not verify the studio payment account. Please contact the studio.' },
        { status: 400 }
      );
    }

    if (connectedAccount.requirements?.disabled_reason) {
      console.error('[stripe/completion] Connected account disabled:', connectedAccount.requirements.disabled_reason);
      return NextResponse.json(
        { error: 'The studio payment account needs attention. Please contact the studio.' },
        { status: 400 }
      );
    }

    const metadata = {
      tenantId,
      completionToken,
      appointmentId: appointmentId || '',
      clientId:      clientId || '',
      clientName:    clientName || '',
      clientEmail:   clientEmail || '',
      serviceName:   serviceName || '',
    };

    const hasDeposit = Number(depositAmount) > 0;

    // ── Create session ON the connected account (second arg to stripe.*) ───
    const session = await stripe.checkout.sessions.create(
      hasDeposit
        ? {
            ui_mode:              'embedded',
            mode:                 'payment',
            payment_method_types: ['card'],
            customer_email:       clientEmail,
            customer_creation:    'always',
            line_items: [
              {
                price_data: {
                  currency:     'usd',
                  unit_amount:  Math.round(Number(depositAmount) * 100),
                  product_data: {
                    name:        serviceName ? `Deposit — ${serviceName}` : 'Appointment Deposit',
                    description: 'Secures your appointment and saves your card for any future fees per studio policy.',
                  },
                },
                quantity: 1,
              },
            ],
            payment_intent_data: { setup_future_usage: 'off_session' },
            metadata:    { ...metadata, type: 'completion' },
            redirect_on_completion: 'never',
          }
        : {
            ui_mode:              'embedded',
            mode:                 'setup',
            payment_method_types: ['card'],
            customer_email:       clientEmail,
            setup_intent_data:    { metadata: { ...metadata, type: 'completion_setup' } },
            metadata:             { ...metadata, type: 'completion_setup' },
            redirect_on_completion: 'never',
          },
      { stripeAccount: stripeAccountId }  // ← the critical fix
    );

    return NextResponse.json({
      clientSecret:    session.client_secret,
      sessionId:       session.id,
      stripeAccountId,
    });

  } catch (err: any) {
    console.error('[stripe/completion]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}