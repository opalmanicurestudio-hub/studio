// Registers a new card reader to the business: the reader shows a short registration code on its screen
// (Settings → Generate pairing code on the reader); a manager types it here with a name for the reader.
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

export async function POST(req: NextRequest) {
  try {
    const { tenantId, code, label } = await req.json();
    { const g = await requireRole(req, String(tenantId || ''), 'manager'); if (g.deny) return g.deny; }
    const regCode = String(code || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 64);
    const name = String(label || '').trim().slice(0, 60) || 'Front desk';
    if (!regCode) return NextResponse.json({ ok: false, error: 'Type the code the reader shows on its screen.' }, { status: 400 });
    const db = getAdminDb();
    const t = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    if (!t.stripeAccountId) return NextResponse.json({ ok: false, error: 'Connect your Stripe account in Settings first.' }, { status: 400 });
    if (!t.stripeTerminalLocationId) return NextResponse.json({ ok: false, error: 'Open the front desk once so the reader location is set up, then try again.' }, { status: 400 });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
    const reader = await stripe.terminal.readers.create({ registration_code: regCode, label: name, location: t.stripeTerminalLocationId }, { stripeAccount: t.stripeAccountId });
    return NextResponse.json({ ok: true, id: reader.id, label: reader.label, deviceType: reader.device_type });
  } catch (err: any) {
    const msg = String(err?.message || '');
    return NextResponse.json({ ok: false, error: /registration code/i.test(msg) ? 'That code didn’t match a reader. Codes expire quickly — make a new one on the reader and type it again.' : msg || 'The reader couldn’t be added.' }, { status: 400 });
  }
}
