import { NextRequest, NextResponse } from 'next/server';

// ─── /api/internal/lock-tenant/route.ts ───────────────────────────────────────
// Called by middleware when a tenant's grace period has expired.
// Protected by MIDDLEWARE_SECRET so only the middleware can call it.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore }                 = require('firebase-admin/firestore');
  const APP_NAME = 'admin-lock-tenant';
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
  // Verify this is called from our own middleware
  const secret = req.headers.get('x-middleware-secret');
  if (!secret || secret !== process.env.MIDDLEWARE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { tenantId } = await req.json();
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  const db = getAdminDb();
  await db.collection('tenants').doc(tenantId).set({
    accessLocked:          true,
    subscriptionStatus:    'past_due',
    subscriptionUpdatedAt: new Date().toISOString(),
  }, { merge: true });

  console.log(`[lock-tenant] Tenant ${tenantId} locked — grace period expired`);
  return NextResponse.json({ locked: true });
}
