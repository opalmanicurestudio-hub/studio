import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
import Stripe from 'stripe';
import { ensureTerminalLocation } from '@/lib/terminal-location';

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
    const { tenantId } = await req.json();
    { const g = await requireRole(req, String(tenantId || ''), 'staff'); if (g.deny) return g.deny; }
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json({ error: 'Connect your Stripe account in Settings first — the card reader takes payments through it.' }, { status: 400 });
    }

    const stripe = getStripe();

    // The readers' location (the business's real address), made the first time it's needed (lib/terminal-location).
    const loc = await ensureTerminalLocation(db, stripe, tenantId, tenantSnap.data() || {});
    if (!loc.ok) return NextResponse.json({ error: loc.error }, { status: 400 });
    const locationId = loc.id;

    // Create a connection token scoped to the connected account
    const connectionToken = await stripe.terminal.connectionTokens.create(
      { location: locationId },
      { stripeAccount: stripeAccountId }
    );

    return NextResponse.json({ secret: connectionToken.secret, locationId });
  } catch (err: any) {
    console.error('[terminal/connection-token]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
