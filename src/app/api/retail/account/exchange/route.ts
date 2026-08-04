import { NextRequest, NextResponse } from 'next/server';

import { ACCOUNT_TOKEN_DAYS, normalizeEmail, signAccountToken } from '@/lib/retail-account';

// ─── POST /api/retail/account/exchange ────────────────────────────────────────
// { tenantId, orderId, qrToken } → { email, exp, sig }
//
// The "View all my orders" path from an order page. Possession of the order's
// qrToken already proves this person holds that order, so no email round-trip
// is needed — we hand back a signed account token for the email on that order
// and the customer lands straight in their order list. (The emailed magic
// link at /account/request stays the way in for someone arriving cold.)
//
// Never returns an account token for an email the caller can't already prove
// they hold: the qrToken must match the order, and the email comes from the
// order document, never from the request body.

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

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();

  if (!tenantId || !orderId || !qrToken) {
    return NextResponse.json({ error: 'Order details are required' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const snap = await db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get();
    if (!snap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    const order = snap.data() as any;
    if (String(order.qrToken || '') !== qrToken) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const email = normalizeEmail(order.customerEmail);
    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'This order has no email on file — ask the shop to add one.' },
        { status: 409 }
      );
    }

    const exp = Date.now() + ACCOUNT_TOKEN_DAYS * 86_400_000;
    const sig = signAccountToken(tenantId, email, exp);
    return NextResponse.json({ email, exp, sig });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || 'Could not open your orders').slice(0, 200) },
      { status: 500 }
    );
  }
}
