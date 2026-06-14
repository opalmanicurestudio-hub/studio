import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

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
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    }, APP_NAME);
  }
  return getFirestore(app);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const db = getAdminDb();

    // Look up tenant by userId
    const tenantsSnap = await db.collection('tenants')
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (tenantsSnap.empty) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
    }

    await tenantsSnap.docs[0].ref.update({
      stripeAccountId:      FieldValue.delete(),
      stripeConnectedAt:    FieldValue.delete(),
      stripeChargesEnabled: FieldValue.delete(),
      stripeDetailsSubmitted: FieldValue.delete(),
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[stripe/disconnect]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}