import { NextRequest, NextResponse } from 'next/server';
import { publishedReviews } from '@/lib/shop-public-server';
import { getAdminDb } from '@/lib/firebase-admin';
import { reviewerName, reviewSettings } from '@/lib/reviews';
import { limitPublic } from '@/lib/rate-limit';

// ─── /api/retail/reviews ──────────────────────────────────────────────────────
// GET  ?tenantId=&productId=      → { average, count, reviews: [...] }
// POST { tenantId, orderId, qrToken, productId, rating, title, body }   signed with the order's name (lib/reviews)
//
// Reviews are only worth anything if they're real, so eligibility is proven
// rather than claimed: the poster must hold an order's qrToken, that order
// must contain the product, and it must actually have been received
// (shipped | completed). No accounts, no scraping, no "verified"
// badge that means nothing — a review can't exist without a purchase behind it.
//
// One review per product per order. Editing re-submits over the same id, so a
// customer can fix a typo without creating a second voice.
//
// Moderation (Reviews → Shop, lib/reviews): a shop that reads reviews first (retailSettings.reviewsAutoPublish ===
// false) holds new ones at status 'pending' (Waiting); otherwise they show on arrival. A review the shop hid stays
// hidden, with its reason, when the customer edits it; an edited review waits again when the shop reads them first.
// GET only ever returns shown ones.

export const dynamic = 'force-dynamic';

const RECEIVED_STAGES = ['shipped', 'completed'];

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const productId = String(req.nextUrl.searchParams.get('productId') || '').trim();
  if (!tenantId || !productId) {
    return NextResponse.json({ error: 'tenantId and productId are required' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const { average, count, reviews } = await publishedReviews(db, tenantId, productId);
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
    // Anyone with the order link can post: a few a minute is plenty for a real customer.
    const limited = await limitPublic(req, 'retail-review', tenantId, { perHour: 60, perDay: 600 }); if (limited) return limited;
    if (!RECEIVED_STAGES.includes(String(order.stage))) {
      return NextResponse.json(
        { error: 'You can review once your order has been picked up or delivered.' },
        { status: 409 }
      );
    }
    const line = (order.lines || []).find((l: any) => String(l.productId) === productId);
    if (!line) return NextResponse.json({ error: 'That item is not on this order' }, { status: 400 });

    if (order.isTest) return NextResponse.json({ error: 'Reviews can’t be left on a test order.' }, { status: 409 });

    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    const S = reviewSettings(tenantSnap.exists ? tenantSnap.data() : {});
    // Deterministic id = one review per product per order, and a re-submit
    // edits rather than duplicates.
    const reviewId = `${orderId}__${productId}`;
    const ref = db.collection(`tenants/${tenantId}/retailReviews`).doc(reviewId);
    const now = new Date().toISOString();
    // Read and written together, so an edit landing just as the shop hides it can't bring it back. A review the shop
    // hid stays hidden (with its reason) when the customer edits it; one waiting keeps waiting.
    const { status, isNew, was, firstSinceHidden } = await db.runTransaction(async (tx: any) => {
      const prev: any = (await tx.get(ref)).data() || null;
      const st = prev?.status === 'hidden' ? 'hidden' : S.shopAutoShow ? 'published' : 'pending';
      tx.set(ref, {
        id: reviewId,
        tenantId,
        productId,
        // A variant's review shows on its listing's page.
        listingId: line.listingId ? String(line.listingId) : null,
        productName: String(line.name || ''),
        orderId,
        orderNumber: order.orderNumber ?? null,
        rating,
        title,
        body: text,
        // Signed with the name on the order, first name and last initial.
        author: reviewerName(order.customerName || ''),
        customerEmail: String(order.customerEmail || ''),
        clientId: order.clientId ? String(order.clientId) : null,
        status: st,
        createdAt: prev?.createdAt || now,
        updatedAt: now,
        ...(prev ? { editedAt: now } : {}),
      }, { merge: true });
      // An edit to a hidden review is news the first time since it was hidden, not on every save.
      const firstSinceHidden = prev?.status === 'hidden' && (!prev?.editedAt || Date.parse(String(prev.editedAt)) < Date.parse(String(prev?.hiddenAt || '')));
      return { status: st, isNew: !prev, was: String(prev?.status || ''), firstSinceHidden };
    });
    // Waiting for the shop (new, or a shown one changed while the shop reads them first), or a hidden one changed (the
    // reason it was hidden may be gone): the people who decide hear about it.
    if ((status === 'pending' && (isNew || was !== 'pending')) || (status === 'hidden' && firstSinceHidden)) {
      const { tellWaiting } = await import('@/lib/reviews-server');
      await tellWaiting(db, tenantId, { kind: 'shop', rating, who: reviewerName(order.customerName || ''), what: String(line.name || ''), changed: !isNew, hidden: status === 'hidden' });
    }

    return NextResponse.json({
      ok: true,
      status,
      message: status === 'published'
        ? 'Thank you for your review. It is now live.'
        : status === 'hidden' ? 'Thank you, your review has been updated.'
        : 'Thank you for your review. It will show once the shop has read it.',
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || 'Could not save your review').slice(0, 200) },
      { status: 500 }
    );
  }
}
