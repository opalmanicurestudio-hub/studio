import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
import Stripe from 'stripe';

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

    // Ensure a Terminal location exists for this tenant
    let locationId = tenantSnap.data()?.stripeTerminalLocationId;
    if (!locationId) {
      // A reader's location is the real business address — never a made-up one.
      const tenantData = tenantSnap.data() || {};
      const p = tenantData.studioAddressParts || {};
      const line1 = String(p.street || p.line1 || '').trim(), city = String(p.city || '').trim(), state = String(p.state || '').trim(), zip = String(p.zip || p.postalCode || '').trim();
      if (!line1 || !city || !state || !zip) {
        return NextResponse.json({ error: 'Add your business address (street, city, state and ZIP) in Settings before connecting a card reader.' }, { status: 400 });
      }
      const location = await stripe.terminal.locations.create(
        { display_name: tenantData.name || 'Front desk', address: { line1, city, state, country: String(p.country || 'US'), postal_code: zip } },
        { stripeAccount: stripeAccountId }
      );
      locationId = location.id;
      await db.doc(`tenants/${tenantId}`).update({ stripeTerminalLocationId: locationId });
    }

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
