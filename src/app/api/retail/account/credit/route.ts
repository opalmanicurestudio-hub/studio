import { NextRequest, NextResponse } from 'next/server';

import { normalizeEmail, verifyAccountToken } from '@/lib/retail-account';

// ─── GET /api/retail/account/credit ───────────────────────────────────────────
// ?tenantId&e&x&s → { creditCents }
//
// The checkout may only show a store-credit balance to someone who has PROVEN
// the email is theirs — the signed magic-link session, same proof the account
// page uses. Verification is pure crypto, so a guessed or tampered token
// costs zero Firestore reads and learns nothing: this endpoint adds no
// enumeration surface that the account page didn't already carry.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-account';
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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || '').trim();
  const email = normalizeEmail(String(sp.get('e') || ''));
  const exp = Number(sp.get('x'));
  const sig = String(sp.get('s') || '');

  const check = verifyAccountToken(tenantId, email, exp, sig);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 401 });

  const db = getAdminDb();
  const creditSnap = await db.collection(`tenants/${tenantId}/depositCredits`)
    .where('clientEmail', '==', email)
    .where('status', '==', 'available')
    .limit(100).get();

  const creditCents = creditSnap.docs.reduce((a: number, d: any) => {
    const c = d.data();
    return a + Math.max(0, (Number(c.amountCents) || 0) - (Number(c.usedCents) || 0));
  }, 0);

  return NextResponse.json({ creditCents });
}
