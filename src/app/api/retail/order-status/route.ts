import { NextRequest, NextResponse } from 'next/server';

import { TERMINAL_STAGES, buildOrderQrValue } from '@/lib/retail-orders';

// ─── /api/retail/order-status/route.ts ────────────────────────────────────────
// GET ?tenantId=...&orderId=...
//
// Public, unauthenticated — the unguessable Firestore orderId in the URL is
// the access secret (same model as e-commerce order-status links). The
// response is SANITIZED for that trust level: line items, stage, totals, and
// the pickup QR, but no email, no full street address (city/state only), and
// nothing internal (costs, staff, batches).
//
// Designed for polling: the storefront status page calls this every few
// seconds while the order is active. Reads are 2-4 docs per call.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-status';
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
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const orderId = String(req.nextUrl.searchParams.get('orderId') || '').trim();
  if (!tenantId || !orderId) {
    return NextResponse.json({ error: 'tenantId and orderId are required' }, { status: 400 });
  }

  const db = getAdminDb();
  const [orderSnap, tenantSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get(),
    db.collection('tenants').doc(tenantId).get(),
  ]);
  if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const order = orderSnap.data() as any;
  const rs = (tenantSnap.exists ? (tenantSnap.data() as any).retailSettings : {}) || {};

  // Queue position — how many active orders entered the queue before this one.
  // Only meaningful while waiting to be picked; skipped otherwise to save reads.
  let queuePosition: number | null = null;
  if (order.stage === 'paid' && order.paidAt) {
    try {
      const ahead = await db.collection(`tenants/${tenantId}/retailOrders`)
        .where('stage', 'in', ['paid', 'picking'])
        .where('paidAt', '<', order.paidAt)
        .count().get();
      queuePosition = (ahead.data().count ?? 0) + 1;
    } catch {
      queuePosition = null; // missing index or count unsupported — degrade silently
    }
  }

  const isPickup = order.method === 'counter' || order.method === 'curbside';
  const active = !TERMINAL_STAGES.includes(order.stage);

  // Drive-thru: live lane position among checked-in orders, by arrival time.
  let lanePosition: number | null = null;
  if (order.method === 'curbside' && order.curbside?.arrivedAt && active) {
    try {
      const ahead = await db.collection(`tenants/${tenantId}/retailOrders`)
        .where('stage', '==', 'arrived')
        .where('curbside.arrivedAt', '<', order.curbside.arrivedAt)
        .count().get();
      lanePosition = (ahead.data().count ?? 0) + (order.stage === 'arrived' ? 1 : 0) || null;
      if (order.stage === 'arrived' && lanePosition === null) lanePosition = 1;
    } catch {
      lanePosition = null;
    }
  }

  // The pickup QR is available from the moment payment confirms, so the
  // customer already has it open when they walk up — no fumbling at the counter.
  const qrValue =
    isPickup && order.qrToken && active && order.stage !== 'placed'
      ? buildOrderQrValue(order.qrToken)
      : null;

  // The pickup QR image is stage-gated above — but the customer's RIGHT to
  // help with their own order never expires. selfServeToken is the same
  // credential, handed out whenever the order has one, for any method and
  // any stage: it is what lets a completed pickup start a return, a shipped
  // order report a problem, and the packing slip's plain https QR reach a
  // working help card. Same trust model as the account-exchange route —
  // holding the order link is holding the order.
  const selfServeToken = order.qrToken ? String(order.qrToken) : null;

  // ── WHERE "HERE" IS, FOR CURBSIDE ────────────────────────────────────────
  // Three sources, in the order that respects what a shop has deliberately
  // said:
  //   1. retailSettings.curbsideLat/Lng — an EXPLICIT curbside pin. It stays
  //      first because the kerb is often not the building: a shop may have
  //      aimed this at the loading bay or the two spaces out front, and a
  //      "better" building pin would silently undo that choice.
  //   2. the location's own coordinates — set in Settings > Locations, which
  //      is where a shop would reasonably expect to describe where it is.
  //      This is what makes curbside work for a shop that never found the
  //      curbside card at all.
  //   3. the studio-wide pin used by the timeclock.
  // Absent from all three, the geofence simply never fires and the "I'm
  // here" button still works — which is the existing, deliberate behaviour.
  const pickupGeo = await (async () => {
    const t: any = tenantSnap.exists ? tenantSnap.data() : {};
    const usable = (lat: any, lng: any) => {
      const a = Number(lat); const b = Number(lng);
      return Number.isFinite(a) && Number.isFinite(b) && (a !== 0 || b !== 0) ? { lat: a, lng: b } : null;
    };
    const explicit = usable(t?.retailSettings?.curbsideLat, t?.retailSettings?.curbsideLng);
    if (explicit) return explicit;
    try {
      const locSnap = await db.collection(`tenants/${tenantId}/locations`).get();
      const pinned = locSnap.docs
        .map((d: any) => d.data() as any)
        .filter((l: any) => l?.isActive !== false)
        .map((l: any) => usable(l?.coordinates?.lat, l?.coordinates?.lng))
        .filter(Boolean);
      // Only when it is unambiguous. With two pinned locations and no
      // locationId on the order, picking one would be a guess, and a guess
      // here sends a customer to the wrong building.
      if (pinned.length === 1) return pinned[0];
    } catch { /* a locations read failing must never break order status */ }
    return usable(t?.studioLocation?.lat, t?.studioLocation?.lng);
  })();

  let supportTickets: any[] = [];
  try {
    const tSnap = await db.collection(`tenants/${tenantId}/retailSupport`)
      .where('orderId', '==', orderId).limit(20).get();
    supportTickets = tSnap.docs
      .map((d: any) => {
        const t = d.data() || {};
        return {
          message: String(t.message || ''),
          createdAt: t.createdAt || null,
          status: String(t.status || 'open'),
          autoReply: String(t.autoReply || ''),
          expectNote: String(t.expectNote || ''),
          category: String(t.category || ''),
          caseRef: String(t.caseRef || ''),
          followUps: Array.isArray(t.followUps)
            ? t.followUps.slice(-20).map((f: any) => ({
                at: f.at || null,
                message: String(f.message || ''),
                kind: f.kind === 'evidence' ? 'evidence' : 'chaser',
                photoUrls: Array.isArray(f.photoUrls) ? f.photoUrls.slice(0, 4) : [],
              }))
            : [],
          photoUrls: Array.isArray(t.photoUrls) ? t.photoUrls.slice(0, 4) : [],
          replies: Array.isArray(t.replies)
            ? t.replies.map((r: any) => ({
                by: String(r.by || 'The shop'),
                text: String(r.text || ''),
                at: r.at || null,
              }))
            : [],
        };
      })
      .sort((a: any, b: any) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  } catch { supportTickets = []; }

  /* HELP ELIGIBILITY — computed HERE, beside the routes that enforce it,
   * so the menu the customer sees and the server's refusals can never
   * disagree. A hidden button is honest; a button that errors is not. */
  const polH = (rs.policies || {});
  const cancelWindowOk = (() => {
    const wh = Math.max(0, Number(polH.cancelWindowHours) || 0);
    if (wh <= 0 || !order.paidAt) return true;
    const ageH = (Date.now() - new Date(order.paidAt).getTime()) / 3600000;
    return !Number.isFinite(ageH) || ageH <= wh;
  })();
  const returnWindowOk = (() => {
    const wd = Math.max(0, Number(rs.returnWindowDays) || 0);
    if (wd <= 0 || !order.completedAt) return true;
    const ageD = (Date.now() - new Date(order.completedAt).getTime()) / 86400000;
    return !Number.isFinite(ageD) || ageD <= wd;
  })();
  const help = {
    canCancel: ['placed', 'paid'].includes(order.stage) && polH.cancelAllowed !== false && cancelWindowOk,
    canReturn: ['shipped', 'handed_off', 'completed'].includes(order.stage) && rs.returnsEnabled !== false && returnWindowOk,
    canReport: ['shipped', 'handed_off', 'completed'].includes(order.stage),
    canChangeAddress: order.method === 'ship' && ['placed', 'paid', 'picking', 'packed'].includes(order.stage),
    hasTracking: Boolean(order.trackingUrl || order.trackingNumber),
    refundState: (Number(order.refundedCents) || 0) > 0 ? 'refunded' : (Number(order.pendingRefundCents) || 0) > 0 ? 'pending' : 'none',
  };

  return NextResponse.json({
    help,
    shopName: String((tenantSnap.exists ? (tenantSnap.data() as any) : {})?.businessName || (tenantSnap.exists ? (tenantSnap.data() as any) : {})?.name || ''),
    // Where the shop physically is, so the customer's phone can answer "am I
    // there yet?" locally. Sent to the browser deliberately: the alternative
    // is streaming their position to us, which is worse for them and worse
    // for us. Absent = the geofence simply never fires and everything else
    // still works.
    shopGeo: pickupGeo,
    selfServeToken,
    order: {
      id: orderId,
      orderNumber: order.orderNumber,
      stage: order.stage,
      method: order.method,
      pickupAt: order.pickupAt || '',
      tipCents: order.tipCents || 0,
      priceTier: order.priceTier || 'retail',
      businessName: order.businessName || '',
      poNumber: order.poNumber || '',
      customerName: order.customerName || '',
      lines: (order.lines || []).map((l: any) => ({
        lineId: l.lineId,
        productId: l.productId,
        qtyReturned: l.qtyReturned || 0,
        name: l.name,
        documents: Array.isArray(l.documents) ? l.documents.slice(0, 6) : [],
        qtyOrdered: l.qtyOrdered,
        qtyShorted: l.qtyShorted || 0,
        unitPriceCents: l.unitPriceCents,
        status: l.status,
      })),
      subtotalCents: order.subtotalCents || 0,
      taxCents: order.taxCents || 0,
      shippingCents: order.shippingCents || 0,
      refundedCents: order.refundedCents || 0,
      /* The inquiry thread. A customer should never have to wonder whether
       * a message landed — every ticket they've sent on this order comes
       * back with its receipt time, its instant answer if one was given,
       * every staff reply, and its status. Same poll that moves the stage
       * tracker moves this, so a reply appears without a refresh. */
      support: supportTickets,
      totalCents: order.totalCents || 0,
      timestamps: {
        placedAt: order.placedAt || null,
        paidAt: order.paidAt || null,
        packedAt: order.packedAt || null,
        readyAt: order.readyAt || null,
        completedAt: order.completedAt || null,
        cancelledAt: order.cancelledAt || null,
      },
      curbside: order.curbside
        ? {
            arrivedAt: order.curbside.arrivedAt || null,
            spotOrVehicle: order.curbside.spotOrVehicle || '',
            onWayAt: order.curbside.onWayAt || null,
            etaMinutes: order.curbside.etaMinutes || null,
            bringingOutAt: order.curbside.bringingOutAt || null,
            bringingOutBy: order.curbside.bringingOutBy
              ? String(order.curbside.bringingOutBy).split(' ')[0]
              : null,
            bringingOutPhoto: order.curbside.bringingOutPhoto || null,
          }
        : null,
      shipCity: order.shippingAddress ? `${order.shippingAddress.city}, ${order.shippingAddress.state}` : null,
      shippingAddress: order.shippingAddress || null,
      customerEmail: order.customerEmail || '',
      storeCreditRequestedCents: order.storeCreditRequestedCents || 0,
      shipPromiseAt: order.shipPromiseAt || null,
      hasPreorder: order.hasPreorder === true,
      trackingNumber: order.trackingNumber || null,
      trackingUrl: order.trackingUrl || null,
      carrier: order.carrier || null,
    },
    queuePosition,
    lanePosition,
    curbsideExperience: {
      mode: rs.curbsideMode || 'freeform',
      spots: Array.isArray(rs.curbsideSpots) ? rs.curbsideSpots : [],
    },
    qrValue,
    active,
  });
}
