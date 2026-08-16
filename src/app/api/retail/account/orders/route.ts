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
      /* A resolved return changes what an order IS in the customer's history:
       * "Completed" on an order whose items came back and were refunded is a
       * status page lying by omission. The label carries the outcome. */
      stageLabel: o.returnSummary
        ? (o.returnSummary.resolution === 'refund' ? 'Returned \u2014 refunded'
          : o.returnSummary.resolution === 'store_credit' ? 'Returned \u2014 store credit'
          : o.returnSummary.resolution === 'replacement' ? 'Returned \u2014 replaced'
          : 'Returned')
        : (STAGE_LABELS[o.stage as keyof typeof STAGE_LABELS] || o.stage),
      returnSummary: o.returnSummary || null,
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

  // ── One shelf for everything they've ever bought that isn't a parcel.
  // Assembled across ALL their orders, newest first, deduped by product so
  // buying the same guide twice doesn't read as two entitlements. Each entry
  // carries the order it came from, because access is checked against that
  // order — the shelf is a directory, never a second door.
  const library: any[] = [];
  const seenProducts = new Set<string>();
  [...seen.values()]
    .sort((a, b) => String(b.paidAt || b.placedAt || '').localeCompare(String(a.paidAt || a.placedAt || '')))
    .forEach((o: any) => {
      if (['placed', 'cancelled', 'refunded'].includes(String(o.stage))) return;
      (o.lines || []).forEach((l: any) => {
        if (l.digital !== true) return;
        if (['refunded', 'backordered'].includes(String(l.status))) return;
        if (seenProducts.has(l.productId)) return;
        seenProducts.add(l.productId);
        const days = Number(l.digitalAccessDays) || 0;
        const start = Date.parse(String(o.paidAt || o.placedAt || '')) || 0;
        const endsAt = days > 0 && start ? new Date(start + days * 86400000).toISOString() : null;
        library.push({
          productId: l.productId,
          name: l.name,
          orderId: o.id,
          orderNumber: o.orderNumber ?? null,
          boughtAt: o.paidAt || o.placedAt || '',
          endsAt,
          expired: !!endsAt && Date.parse(endsAt) < Date.now(),
        });
      });
    });

  return NextResponse.json({ email, orders, creditCents, library });
}
