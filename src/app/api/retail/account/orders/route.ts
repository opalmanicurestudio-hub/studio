import { NextRequest, NextResponse } from 'next/server';

import { normalizeEmail, verifyAccountToken } from '@/lib/retail-account';
import { STAGE_LABELS } from '@/lib/retail-orders';

// ─── GET /api/retail/account/orders ───────────────────────────────────────────
// ?tenantId&e&x&s → { orders[], creditCents }
//
// Efficiency by construction:
//  - Token verification is pure crypto — an invalid token costs ZERO reads.
//  - Equality-only Firestore queries (no orderBy) + in-memory sort, so no
//    composite index is ever required and the first call can't fail with an
//    index-creation error.
//  - Both raw and lowercased email are queried and merged, so historic
//    orders survive any casing drift between Stripe and the webhook.
//  - Payload is deliberately minimal — no addresses; each order links to its
//    own qrToken-gated tracking page for the details.

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

const ACTIVE = ['placed', 'paid', 'picking', 'packed', 'ready', 'arrived'];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || '').trim();
  const rawEmail = String(sp.get('e') || '');
  const email = normalizeEmail(rawEmail);
  const exp = Number(sp.get('x'));
  const sig = String(sp.get('s') || '');

  const check = verifyAccountToken(tenantId, email, exp, sig);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 401 });

  const db = getAdminDb();
  const ordersCol = db.collection(`tenants/${tenantId}/retailOrders`);
  const [lowerSnap, rawSnap, creditSnap] = await Promise.all([
    ordersCol.where('customerEmail', '==', email).limit(100).get(),
    rawEmail !== email
      ? ordersCol.where('customerEmail', '==', rawEmail).limit(100).get()
      : Promise.resolve({ docs: [] } as any),
    db.collection(`tenants/${tenantId}/depositCredits`).where('clientEmail', '==', email).limit(100).get(),
  ]);

  const seen = new Map<string, any>();
  [...lowerSnap.docs, ...rawSnap.docs].forEach((d: any) => seen.set(d.id, { id: d.id, ...d.data() }));

  const orders = [...seen.values()]
    .sort((a, b) => String(b.placedAt || '').localeCompare(String(a.placedAt || '')))
    .slice(0, 60)
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      stage: o.stage,
      stageLabel: STAGE_LABELS[o.stage as keyof typeof STAGE_LABELS] || o.stage,
      active: ACTIVE.includes(o.stage),
      method: o.method,
      totalCents: o.totalCents || 0,
      placedAt: o.placedAt || '',
      itemCount: Array.isArray(o.lines)
        ? o.lines.reduce((s: number, l: any) => s + (l.qtyOrdered - (l.qtyShorted || 0)), 0)
        : 0,
    }));

  const creditCents = creditSnap.docs
    .map((d: any) => d.data())
    .filter((c: any) => c.status === 'available')
    .reduce((s: number, c: any) => s + Math.max(0, (c.amountCents || 0) - (c.usedCents || 0)), 0);

  return NextResponse.json({ email, orders, creditCents });
}
