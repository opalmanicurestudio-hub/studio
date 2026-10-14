import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
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
    const { tenantId: bodyTenant, userId } = await req.json();
    const db = getAdminDb();
    // The business by its id (what Settings sends); an owner's user id still works for older callers.
    let ref: any = null;
    const tid = String(bodyTenant || userId || '').trim();
    if (!tid) return NextResponse.json({ error: 'Which business?' }, { status: 400 });
    const direct = await db.doc(`tenants/${tid}`).get();
    if (direct.exists) ref = direct.ref;
    else { const q = await db.collection('tenants').where('userId', '==', tid).limit(1).get(); if (!q.empty) ref = q.docs[0].ref; }
    if (!ref) return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    { const g = await requireRole(req, String(ref.id), 'owner'); if (g.deny) return g.deny; }
    const tenantsSnap = { docs: [{ ref }] };
    await tenantsSnap.docs[0].ref.update({
      stripeAccountId:      FieldValue.delete(),
      stripeConnectedAt:    FieldValue.delete(),
      stripeChargesEnabled: FieldValue.delete(),
      stripeDetailsSubmitted: FieldValue.delete(),
      stripeTerminalLocationId: FieldValue.delete(),
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[stripe/disconnect]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
