import { NextRequest, NextResponse } from 'next/server';

import { TERMINAL_STAGES, buildOrderQrValue } from '@/lib/retail-orders';
import { changeMode, changePolicy } from '@/lib/address-flow';
import { busyLineFor, customerDates, scheduleFrom } from '@/lib/ship-promise';
import { dayKey, tenantTimeZone } from '@/lib/tenant-time';
import { liveSlots } from '@/lib/label-boxes';
import { effectiveUnitCents, swapLines } from '@/lib/retail-swap';
import { windowOpen } from '@/lib/order-windows';

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
  let order = orderSnap.data() as any;
  // SAFETY NET: if Stripe's notification is late or never arrives, the order would sit at "Confirming payment" forever.
  // While it's still 'placed' (and has waited 45 s), ask Stripe directly — at most every 15 s — and, if paid, run the
  // SAME completion the webhook runs (it only acts on a 'placed' order, so the two can't both do the work).
  if (order.stage === 'placed' && order.stripeCheckoutSessionId && tenantSnap.exists) {
    const placedAt = Date.parse(order.placedAt || order.createdAt || '') || 0; const lastCheck = Date.parse(order.paymentCheckAt || '') || 0;
    if (Date.now() - placedAt > 45000 && Date.now() - lastCheck > 15000) {
      try { const { confirmRetailPayment } = await import('@/lib/retail-payment-check'); await confirmRetailPayment(db, tenantId, tenantSnap.data(), orderSnap.ref, order);
        order = ((await orderSnap.ref.get()).data() as any) || order; }
      catch (e: any) { console.error('[order-status] payment check', String(e?.message || e).slice(0, 200)); }
    }
  }
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

  /* Updates from the shop (lib/order-inbox): everything we'd once have emailed, kept here in full. */
  let updates: any[] = [];
  try {
    const u = await db.collection(`tenants/${tenantId}/retailOrders/${orderId}/inbox`).orderBy('at', 'desc').limit(30).get();
    updates = u.docs.map((d: any) => { const x = d.data() || {}; return { id: d.id, kind: String(x.kind || ''), at: x.at || null, title: String(x.title || ''), body: String(x.body || ''), links: Array.isArray(x.links) ? x.links.slice(0, 3) : [] }; });
  } catch { /* the rest of the page still loads */ }

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
  // From delivery, or the ship date when the carrier never confirmed it (lib/order-windows), as the routes enforce it.
  const returnWindowOk = windowOpen(order, rs.returnWindowDays);
  const help = {
    canCancel: ['placed', 'paid'].includes(order.stage) && polH.cancelAllowed !== false && cancelWindowOk,
    canReturn: ['shipped', 'handed_off', 'completed'].includes(order.stage) && rs.returnsEnabled !== false && returnWindowOk,
    // The report window, as api/retail/claims enforces it (a message to the shop is always there).
    canReport: ['shipped', 'handed_off', 'completed'].includes(order.stage) && windowOpen(order, Math.max(0, Math.floor(Number(rs.deliveryIssueWindowDays) || 0))),
    canChangeAddress: order.method === 'ship' && ['placed', 'paid', 'picking', 'packed'].includes(order.stage),
    hasTracking: Boolean(order.trackingUrl || order.trackingNumber),
    refundState: (Number(order.refundedCents) || 0) > 0 ? 'refunded' : (Number(order.pendingRefundCents) || 0) > 0 ? 'pending' : 'none',
  };

  // Shipped in one box with the customer's other orders (lib/ship-together): which ones, by number.
  let shippedWith: string[] = [];
  try {
    const others: string[] = order.shippedWithOrderId ? [String(order.shippedWithOrderId)] : Array.isArray(order.shippedWithOrderIds) ? order.shippedWithOrderIds.map(String).slice(0, 9) : [];
    if (others.length) shippedWith = (await Promise.all(others.map((id) => db.doc(`tenants/${tenantId}/retailOrders/${id}`).get()))).filter((d: any) => d.exists).map((d: any) => `#${String((d.data() as any)?.orderNumber ?? '').padStart(4, '0')}`);
  } catch { /* cosmetic */ }
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
        // Exchanges made by a gift's recipient aren't shown to the buyer.
        qtyReturned: Math.max(0, (l.qtyReturned || 0) - (l.qtyGiftReturned || 0)),
        qtyClaimed: Math.max(0, Number(l.qtyClaimed) || 0),
        name: l.name,
        documents: Array.isArray(l.documents) ? l.documents.slice(0, 6) : [],
        qtyOrdered: l.qtyOrdered,
        qtyShorted: l.qtyShorted || 0,
        unitPriceCents: l.unitPriceCents,
        status: l.status === 'returned' && (l.qtyGiftReturned || 0) > 0 && (l.qtyReturned || 0) - (l.qtyGiftReturned || 0) < (l.qtyOrdered || 0) - (l.qtyShorted || 0) ? 'picked' : l.status,
        digital: l.digital === true,
        optionsLabel: l.optionsLabel || '',
        swappedToName: l.swappedToName || '',
        swapForName: l.swapForName || '',
        lineDiscountCents: Number(l.lineDiscountCents) || 0,
      })),
      /* A question waiting for the customer: can we swap an out-of-stock item? Only what they need to answer, only
       * while it still applies (an order still being packed, an item still to send), and the refund it would give is
       * the one the swap itself works out (lib/retail-swap): what they paid after any promo, with its tax. */
      swapOffer: (() => {
        const so = order.swapOffer; if (so?.status !== 'waiting' || !['paid', 'picking'].includes(String(order.stage))) return null;
        const l: any = (order.lines || []).find((x: any) => x.lineId === so.lineId);
        const qty = l ? (Number(l.qtyOrdered) || 0) - (Number(l.qtyScanned) || 0) - (Number(l.qtyShorted) || 0) : 0;
        if (qty <= 0) return null;
        let refundCents = 0; try { refundCents = swapLines(order, so.lineId, so.sub, 'preview').refundCents; } catch { refundCents = 0; }
        return {
          lineName: so.lineName, expiresAt: so.expiresAt,
          sub: { name: so.sub?.name || '', unitPriceCents: Number(so.sub?.unitPriceCents) || 0, imageUrl: so.sub?.imageUrl || '' },
          origUnitCents: effectiveUnitCents(l), qty, refundCents,
        };
      })(),
      ifUnavailable: order.ifUnavailable || 'refund',
      idCheckStatus: order.idCheck?.status || null,
      pendingRefundCents: Number(order.pendingRefundCents) || 0,
      shelfSlot: order.shelfSlot || null,
      hasPhone: !!order.customerPhone,
      subtotalCents: order.subtotalCents || 0,
      promo: order.promo ? { code: String(order.promo.code || ''), label: String(order.promo.label || order.promo.code || ''), cents: Number(order.promo.cents) || 0, freeShipping: !!order.promo.freeShipping } : null,
      taxCents: order.taxCents || 0,
      shippingCents: order.shippingCents || 0,
      refundedCents: order.refundedCents || 0,
      /* The inquiry thread. A customer should never have to wonder whether
       * a message landed — every ticket they've sent on this order comes
       * back with its receipt time, its instant answer if one was given,
       * every staff reply, and its status. Same poll that moves the stage
       * tracker moves this, so a reply appears without a refresh. */
      support: supportTickets,
      updates,
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
      /* The address flow (lib/address-flow): whether the shop asked them to confirm it, their change waiting for the
       * shop (or its answer), and what a change would do now. Never why: a hold for review isn't shown. */
      ...(order.method === 'ship' ? (() => {
        const r = order.addressRequest || null;
        return {
          addressConfirm: order.addressConfirm ? { status: String(order.addressConfirm.status || ''), askedAt: order.addressConfirm.askedAt || null } : null,
          addressRequest: r ? { status: r.status === 'approving' ? 'waiting' : String(r.status || ''), to: r.to || null, at: r.at || null, reply: r.reply || null, answeredAt: r.answeredAt || null } : null,
          addressChange: changeMode(order, rs).mode,
          addressChangeUntil: changePolicy(rs).until,
          // The shop takes address changes by message only (lib/address-flow): the page says so instead of a button.
          addressChangeOff: changeMode(order, rs).why === 'off',
          // A new address they're paying the shipping difference for (lib/address-pay), and how it went.
          addressPay: order.addressPay ? (() => { const ap = order.addressPay; const live = ap.status === 'awaiting_payment' && Date.now() - (Date.parse(String(ap.at || '')) || 0) < 30 * 60000;
            return { status: String(ap.status || ''), cents: Number(ap.paidCents || ap.cents) || 0, shopCents: Number(ap.shopCents) || 0, to: ap.to || null, at: ap.at || null, url: live ? String(ap.url || '') : null, refundWhy: ap.refundWhy || null }; })() : null,
          addressVerdict: order.addressCheck?.verdict || null,
          addressUnitMissing: order.addressCheck?.unitMissing === true && !order.addressCheck?.unitAnswer,
        };
      })() : {}),
      customerEmail: order.customerEmail || '',
      // Their own contact details, as the order page shows them (the mobile by its last 4), and whether they can change
      // them here (not on an order held for review, which is never said).
      contact: { phoneEnding: String(order.customerPhone || '').replace(/\D/g, '').slice(-4) || null, textsOff: order.textsOff === true, locked: order.holdForReview === true || order.stage === 'placed' },
      storeCreditRequestedCents: order.storeCreditRequestedCents || 0,
      shipPromiseAt: order.shipPromiseAt || null,
      // The ship-by and arrival dates they were shown (lib/ship-promise), as they stand now; null when they never were.
      dates: order.method === 'ship' ? customerDates(order, tenantTimeZone(tenantSnap.exists ? tenantSnap.data() : null)) : null,
      // A busy period's line for an order placed during it, in the shop's own words; '' otherwise.
      // Filled from the dates as they stand now (a notice can move them), and the last day to order only until it passes.
      busyNote: order.method === 'ship' && order.promise?.shown === true ? (() => {
        const tz = tenantTimeZone(tenantSnap.exists ? tenantSnap.data() : null);
        const d = customerDates(order, tz);
        return d ? busyLineFor(order.promise, scheduleFrom(rs), 'email', d.timeZone, { shipBy: d.shipBy, arriveFrom: d.arriveFrom, arriveTo: d.arriveTo, today: dayKey(new Date(), d.timeZone) }) : '';
      })() : '',
      timeZone: tenantTimeZone(tenantSnap.exists ? tenantSnap.data() : null),
      // A delay notice went out: they can cancel for a full refund until it ships.
      delayNotified: !!order.notifiedForPromiseAt || (Number(order.promiseRevisions) || 0) > 0,
      // A label the carrier hasn't scanned for days (the morning check): the box counts as not sent yet.
      labelStuck: order.labelUnscannedOpen === true,
      hasPreorder: order.hasPreorder === true,
      // Only boxes whose labels work (lib/label-boxes): a box waiting for its new label shows once it has it.
      trackingNumber: liveSlots(order)[0]?.tracking || null,
      trackingUrl: liveSlots(order)[0]?.trackingUrl || null,
      shippedWith,
      shipTogetherRefundCents: Number(order.shipTogetherRefundCents) || 0,
      // More boxes: one tracking number (and link, when the carrier gave one) per box.
      extraTracking: liveSlots(order).slice(1, 10).map((b) => ({ number: b.tracking, url: b.trackingUrl || null })).filter((x: any) => x.number),
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
