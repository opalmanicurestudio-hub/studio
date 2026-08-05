import { NextRequest, NextResponse } from 'next/server';

// ─── /api/retail/reviews ──────────────────────────────────────────────────────
// GET  ?tenantId=&productId=      → { average, count, reviews: [...] }
// POST { tenantId, orderId, qrToken, productId, rating, title, body, name }
//
// Reviews are only worth anything if they're real, so eligibility is proven
// rather than claimed: the poster must hold an order's qrToken, that order
// must contain the product, and it must actually have been received
// (handed_off | shipped | completed). No accounts, no scraping, no "verified"
// badge that means nothing — a review can't exist without a purchase behind it.
//
// One review per product per order. Editing re-submits over the same id, so a
// customer can fix a typo without creating a second voice.
//
// Moderation: retailSettings.reviewsAutoPublish === false holds new reviews at
// status 'pending' for the shop to approve; otherwise they publish on arrival.
// GET only ever returns published ones.

export const dynamic = 'force-dynamic';

const RECEIVED_STAGES = ['handed_off', 'shipped', 'completed'];

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-reviews';
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

/** "Jessica Marshall" → "Jessica M." — a real person, not a full identity. */
function displayName(raw: string): string {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Verified buyer';
  if (parts.length === 1) return parts[0].slice(0, 20);
  return `${parts[0].slice(0, 20)} ${parts[1][0].toUpperCase()}.`;
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const productId = String(req.nextUrl.searchParams.get('productId') || '').trim();
  if (!tenantId || !productId) {
    return NextResponse.json({ error: 'tenantId and productId are required' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const snap = await db.collection(`tenants/${tenantId}/retailReviews`)
      .where('productId', '==', productId)
      .where('status', '==', 'published')
      .limit(100)
      .get();

    const reviews = snap.docs
      .map((d: any) => {
        const r = d.data() as any;
        return {
          id: d.id,
          rating: Math.max(1, Math.min(5, Number(r.rating) || 0)),
          title: String(r.title || ''),
          body: String(r.body || ''),
          author: String(r.author || 'Verified buyer'),
          at: String(r.createdAt || ''),
        };
      })
      .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 30);

    const count = reviews.length;
    const average = count
      ? Math.round((reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / count) * 10) / 10
      : 0;

    return NextResponse.json({ average, count, reviews });
  } catch (e: any) {
    // A review outage must never take a product page down with it.
    return NextResponse.json({ average: 0, count: 0, reviews: [] });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  const productId = String(body.productId || '').trim();
  const rating = Math.max(1, Math.min(5, Math.round(Number(body.rating) || 0)));
  const title = String(body.title || '').trim().slice(0, 80);
  const text = String(body.body || '').trim().slice(0, 1200);

  if (!tenantId || !orderId || !qrToken || !productId) {
    return NextResponse.json({ error: 'Order details are required' }, { status: 400 });
  }
  if (!rating) return NextResponse.json({ error: 'Pick a star rating' }, { status: 400 });
  if (text.length < 4) return NextResponse.json({ error: 'Tell us a little about it' }, { status: 400 });

  try {
    const db = getAdminDb();
    const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    const order = orderSnap.data() as any;
    if (String(order.qrToken || '') !== qrToken) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    if (!RECEIVED_STAGES.includes(String(order.stage))) {
      return NextResponse.json(
        { error: 'You can review once your order has been picked up or delivered.' },
        { status: 409 }
      );
    }
    const line = (order.lines || []).find((l: any) => String(l.productId) === productId);
    if (!line) return NextResponse.json({ error: 'That item is not on this order' }, { status: 400 });

    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    const rs = (tenantSnap.exists ? (tenantSnap.data() as any).retailSettings : {}) || {};
    const status = rs.reviewsAutoPublish === false ? 'pending' : 'published';

    // Deterministic id = one review per product per order, and a re-submit
    // edits rather than duplicates.
    const reviewId = `${orderId}__${productId}`;
    const now = new Date().toISOString();

    await db.collection(`tenants/${tenantId}/retailReviews`).doc(reviewId).set({
      id: reviewId,
      tenantId,
      productId,
      productName: String(line.name || ''),
      orderId,
      orderNumber: order.orderNumber ?? null,
      rating,
      title,
      body: text,
      author: displayName(body.name || order.customerName || ''),
      customerEmail: String(order.customerEmail || ''),
      status,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });

    return NextResponse.json({
      ok: true,
      status,
      message: status === 'published'
        ? 'Thanks — your review is live.'
        : 'Thanks — your review is with the shop for approval.',
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || 'Could not save your review').slice(0, 200) },
      { status: 500 }
    );
  }
}p
