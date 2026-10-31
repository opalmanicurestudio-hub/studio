import { shippoKeyFor } from '@/lib/retail-secrets';
import { eventIdFor } from '@/lib/order-events';
import { syncTracking } from '@/lib/order-tracking';
import { NextRequest, NextResponse } from 'next/server';

import {
  deliveryEvidence, readShippoStatus, sendCarrierUpdate, shouldNotify,
} from '@/lib/shipping-notify';
import { protectionPolicy, weightVerdict } from '@/lib/shipment-protection';
import { labelSlots, voidedSlots } from '@/lib/label-boxes';
import { carrierIssueUpdate } from '@/lib/carrier-issue';

// ─── /api/retail/shippo-webhook/route.ts ──────────────────────────────────────
// Auto-delivered: Shippo POSTs tracking updates here; when the carrier says
// DELIVERED, the matching shipped order advances to completed on its own —
// the loop closes with nobody checking a tracking page.
//
// Setup (once, in the Shippo dashboard → Settings → Webhooks):
//   URL:   https://<your-domain>/api/retail/shippo-webhook?tenantId=<TENANT_ID>
//   Event: "Track updated"
// Each tenant registers their own URL with their own tenantId, matching the
// per-tenant API keys.
//
// It now also TELLS THE CUSTOMER. Between "order confirmed" and a box
// appearing there used to be total silence, which is where "where is my order"
// emails come from. Carrier scans — in transit, out for delivery, delivered,
// returned, failed — each send one email, and PRE_TRANSIT deliberately sends
// none, because a label existing is not news.
//
// EVERY SCAN IS ALSO EVIDENCE. Each notified status writes the carrier's own
// status, timestamp, location and note onto the order, along with when and
// where we emailed the customer. A parcel-never-arrived claim is answered with
// facts gathered before the claim existed, which is the only kind a card
// network accepts.
//
// Honesty notes: only DELIVERED advances the stage, only orders currently in
// 'shipped' move, and matching is by exact tracking number within that
// tenant — an unknown or replayed event is a harmless 200 no-op (webhooks
// retry on non-200s, so no-ops must not error).

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-shippo-hook';
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
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  if (!tenantId) return NextResponse.json({ ok: true, skipped: 'no tenantId' });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: true, skipped: 'bad json' }); }

  // Shippo track_updated payload: { event, data: { tracking_number,
  // tracking_status: { status, status_date }, carrier } }
  // NEVER TRUST THE CALLER. Shippo doesn't sign its webhooks, so anyone could post a fake "DELIVERED". We take only the
  // carrier and tracking number from the call and ask Shippo ourselves, with this business's own key — the order moves
  // (and the customer is emailed) only on what Shippo itself says. If it can't be confirmed, nothing happens.
  const claimed = body?.data || body || {};
  const claimedCarrier = String(claimed.carrier || '').trim(); const claimedNumber = String(claimed.tracking_number || '').trim();
  if (!claimedCarrier || !claimedNumber) return NextResponse.json({ ok: true, skipped: 'no carrier or tracking number' });
  let data: any = {};
  try {
    const tdoc: any = (await getAdminDb().doc(`tenants/${tenantId}`).get()).data() || {};
    const key = await shippoKeyFor(getAdminDb(), tenantId, tdoc);
    if (!key) return NextResponse.json({ ok: true, skipped: 'no Shippo key to confirm with' });
    const r = await fetch(`https://api.goshippo.com/tracks/${encodeURIComponent(claimedCarrier)}/${encodeURIComponent(claimedNumber)}`, { headers: { Authorization: `ShippoToken ${key}` } });
    if (!r.ok) return NextResponse.json({ ok: true, skipped: 'Shippo could not confirm this tracking number' });
    data = await r.json();
  } catch { return NextResponse.json({ ok: true, skipped: 'could not confirm with Shippo' }); }
  const trackingNumber = String(data.tracking_number || '').trim();
  const status = readShippoStatus(data);
  if (!trackingNumber || !status) {
    return NextResponse.json({ ok: true, skipped: 'no tracking number or unreadable status' });
  }

  const update = {
    status,
    carrier: String(data.carrier || '').trim(),
    trackingNumber,
    trackingUrl: String(data.tracking_url_provider || data.tracking_url || '').trim(),
    statusAt: String(data.tracking_status?.status_date || new Date().toISOString()),
    location: [
      data.tracking_status?.location?.city,
      data.tracking_status?.location?.state,
    ].filter(Boolean).map(String).join(', '),
    detail: String(data.tracking_status?.status_details || '').slice(0, 200),
  };

  // The carrier weighs every parcel on its own scale and reports the number
  // back. Shippo puts it in different places depending on the carrier, so try
  // each. Ounces where the carrier gives pounds.
  const rawWeight = Number(
    data.tracking_status?.weight ?? data.weight ?? data.parcel?.weight ?? NaN
  );
  const weightUnit = String(
    data.tracking_status?.mass_unit || data.mass_unit || data.parcel?.mass_unit || 'oz'
  ).toLowerCase();
  const carrierWeightOz = Number.isFinite(rawWeight) && rawWeight > 0
    ? (weightUnit === 'lb' || weightUnit === 'lbs' ? rawWeight * 16 : rawWeight)
    : 0;

  const envOrigin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const origin = envOrigin || (host ? `https://${host}` : '');

  try {
    const db = getAdminDb();
    let snap = await db.collection(`tenants/${tenantId}/retailOrders`)
      .where('trackingNumber', '==', trackingNumber).limit(10).get();
    // ANOTHER BOX of a multi-box order: its scans are kept per box, and the order counts as delivered only once every
    // box is (lib/totes labelBoxes). The customer hears "delivered" once, when the last box arrives.
    let extraBox = false;
    if (snap.empty) {
      const ex = await db.collection(`tenants/${tenantId}/retailOrders`)
        .where('extraTrackingNumbers', 'array-contains', trackingNumber).limit(10).get().catch(() => null);
      if (ex && !ex.empty) { snap = ex; extraBox = true; }
    }

    // A VOIDED LABEL THAT MOVES (lib/label-sweep, lib/label-void): the box went out on a label we asked to refund. The
    // order no longer carries the number, so it's found through the numbers it voided, and flagged for the team.
    if (snap.empty && ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'].includes(String(status))) {
      const vs = await db.collection(`tenants/${tenantId}/retailOrders`)
        .where('voidedTracking', 'array-contains', trackingNumber).limit(5).get().catch(() => null);
      if (vs && !vs.empty) {
        for (const vd of vs.docs) {
          const vo: any = vd.data() || {};
          if (vo.voidedLabelMoving?.trackingNumber === trackingNumber && vo.voidedLabelMoving?.open === false) continue;
          await vd.ref.set({ voidedLabelMoving: { open: true, unsure: false, voidedBoxes: 0, unconfirmedBoxes: 0, at: new Date().toISOString(), trackingNumber, status: String(status) } }, { merge: true }).catch(() => {});
          const ev = vd.ref.collection('events').doc(`voided-moving-${trackingNumber}`);
          await ev.set({ id: ev.id, type: 'note', at: new Date().toISOString(), actorId: 'shippo', actorName: 'Carrier', meta: { kind: 'voided_label_moving', text: `The carrier scanned ${trackingNumber}, a label that was voided (${String(status).toLowerCase()})` } }, { merge: true }).catch(() => {});
        }
        return NextResponse.json({ ok: true, advanced: 0, notified: 0, voidedMoving: vs.size });
      }
    }

    // Return labels carry their own tracking numbers that never match an
    // order's outbound leg. When the order lookup comes up empty, check the
    // returns — the same carrier scans then drive the RETURN's journey, so
    // the desk sees "on its way back" without anyone asking the customer.
    if (snap.empty) {
      const retSnap = await db.collection(`tenants/${tenantId}/retailReturns`)
        .where('labelTrackingNumber', '==', trackingNumber).limit(3).get();
      let stamped = 0;
      for (const rd of retSnap.docs) {
        const ret = rd.data() as any;
        await rd.ref.set({
          labelTrackingStatus: update.status,
          labelTrackingStatusAt: update.statusAt,
          labelTrackingDetail: update.detail,
        }, { merge: true });
        stamped++;
        if (['DELIVERED', 'TRANSIT', 'RETURNED'].includes(update.status) && ret.orderId) {
          try {
            const evRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(String(ret.orderId)).collection('events').doc(`ret-track-${trackingNumber}-${update.status}`);
            await evRef.set({
              id: evRef.id, type: 'note', at: update.statusAt || new Date().toISOString(),
              actorId: 'carrier', actorName: update.carrier || 'Carrier',
              meta: { text: update.status === 'DELIVERED'
                ? `Return parcel arrived back at the shop (${trackingNumber})`
                : `Return parcel ${update.status === 'TRANSIT' ? 'in transit back to the shop' : 'returned to sender'} (${trackingNumber})` },
            }, { merge: true });
          } catch {
            // ledger note is best-effort; the status stamp already landed
          }
        }
      }
      if (stamped > 0) {
        return NextResponse.json({ ok: true, returnLegs: stamped, status: update.status });
      }
    }

    let advanced = 0;
    let notified = 0;

    // The tenant record supplies the shop name and contact line on the email.
    let tenant: any = {};
    try {
      const tSnap = await db.collection('tenants').doc(tenantId).get();
      if (tSnap.exists) tenant = tSnap.data() || {};
    } catch {
      // cosmetic only
    }

    for (const d of snap.docs) {
      const order = d.data() as any;
      // A box whose label was voided while the order's other boxes kept theirs (lib/label-boxes): it shouldn't move.
      // If it does, it went out on a voided label, so the team hears; nothing else about the order changes.
      if (voidedSlots(order).some((s) => s.tracking === trackingNumber)) {
        if (['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'].includes(String(status)) && !(order.voidedLabelMoving?.trackingNumber === trackingNumber && order.voidedLabelMoving?.open === false)) {
          await d.ref.set({ voidedLabelMoving: { open: true, unsure: false, voidedBoxes: 0, unconfirmedBoxes: 0, at: new Date().toISOString(), trackingNumber, status: String(status) } }, { merge: true }).catch(() => {});
          const ev = d.ref.collection('events').doc(`voided-moving-${trackingNumber}`);
          await ev.set({ id: ev.id, type: 'note', at: new Date().toISOString(), actorId: 'shippo', actorName: 'Carrier', meta: { kind: 'voided_label_moving', text: `The carrier scanned ${trackingNumber}, a box label that was voided (${String(status).toLowerCase()})` } }, { merge: true }).catch(() => {});
        }
        continue;
      }
      const extras: string[] = Array.isArray(order.extraTrackingNumbers) ? order.extraTrackingNumbers.map(String) : [];
      const multi = extras.length > 0;
      // Each box's latest status, this scan included.
      const boxStatus: Record<string, string> = { ...(order.boxStatus || {}), [trackingNumber]: String(status) };
      if (multi) { try { await d.ref.set({ boxStatus: { [trackingNumber]: String(status) } }, { merge: true }); } catch { /* evidence below still lands */ } }
      // Every box on the order, a box waiting for its new label included (it hasn't arrived, so neither has the order);
      // once it has its new label, its new number is the one waited on. A box taken off the order isn't on it.
      const allBoxes = labelSlots(order).map((s) => s.tracking).filter(Boolean);
      const allDelivered = allBoxes.every((t) => boxStatus[t] === 'DELIVERED' || (t === trackingNumber && status === 'DELIVERED'));

      // Evidence is recorded for EVERY scan, including ones that send no email
      // and ones on an order that has already completed. A claim six weeks from
      // now needs the whole trail, not just the parts that were newsworthy.
      try {
        const trail: any = deliveryEvidence(update, String(order.customerEmail || ''));

        // WEIGHT AS EVIDENCE. Two independent numbers — what the order should
        // weigh (recorded when the label was bought, from per-item weights)
        // and what the carrier actually weighed. Two parties agreeing is very
        // hard to argue with, and almost nobody collects it. Recorded whether
        // or not anyone ever disputes anything, because it costs nothing now
        // and cannot be reconstructed later.
        const expectedOz = Number(order.shipmentProtection?.expectedWeightOz) || 0;
        // The expected weight is for the whole order, so it's only compared when the order went as one box.
        if (!multi && carrierWeightOz > 0 && expectedOz > 0) {
          trail.weightCheck = weightVerdict(
            expectedOz, carrierWeightOz, protectionPolicy(tenant.retailSettings).weightToleranceOz
          );
        }

        // A scan at last: it isn't an unused label after all (lib/label-sweep). If a void of it never finished, the box
        // is out on a label that may be refunded, so the team hears of it.
        const scanned = ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'].includes(String(status));
        const moved = order.labelUnscannedOpen && scanned;
        const doubtful = scanned && !!order.shippoTransactionId && !order.voidedLabelMoving?.open && order.voidedLabelMoving?.trackingNumber !== String(order.trackingNumber || '')
          && (String(order.labelVoiding?.txn || '') === String(order.shippoTransactionId) || (order.labelUnscannedOpen === true && order.labelUnscanned?.why === 'void_unfinished')
            || (Array.isArray(order.labelVoidIds) && order.labelVoidIds.length > 0));
        // The carrier's own arrival estimate for the main box, kept as it changes: once the box is moving, the
        // customer's order page shows this rather than the window worked out at checkout.
        const etaMs = Date.parse(String(data?.eta || ''));
        // A parcel the carrier is having trouble with (going back to the sender, a delivery that failed): raised once
        // per carrier event, cleared when that box is delivered or a quiet one moves again (lib/carrier-issue).
        const issue = carrierIssueUpdate(order, trackingNumber, String(status), update, Date.now());
        await d.ref.set({ ...(extraBox ? { boxTrails: { [trackingNumber]: trail } } : { carrierTrail: trail, ...(Number.isFinite(etaMs) ? { carrierEtaAt: new Date(etaMs).toISOString() } : {}) }), ...(moved ? { labelUnscannedOpen: false } : {}), ...issue,
          ...(doubtful ? { labelVoiding: null, voidedLabelMoving: { open: true, unsure: true, voidedBoxes: Array.isArray(order.labelVoidIds) ? order.labelVoidIds.length : 0, unconfirmedBoxes: 0, at: new Date().toISOString(), trackingNumber: String(order.trackingNumber || ''), status: String(status) } } : {}) }, { merge: true });
      } catch {
        // never let bookkeeping fail the webhook
      }

      // A parcel a replacement went out for that turned up after all (delivered, or coming back to the shop): its claim
      // to file is closed, so nobody files "lost in transit" for a box that arrived (lib/lost-recovered).
      if ((order.replacementOrderId || order.lostReportSettled) && ['DELIVERED', 'RETURNED'].includes(String(status))) {
        try {
          // The lost parcel's record, and one written when a "never arrived" report on it was put right (lib/claim-loss).
          const lostIds = [`lost-${d.id}`, ...((await db.collection(`tenants/${tenantId}/inventoryExceptions`).where('orderId', '==', d.id).limit(10).get().catch(() => null))?.docs || [])
            .filter((x: any) => String(x.id).startsWith('claim-') && x.data()?.reason === 'carrier_lost').map((x: any) => String(x.id))];
          for (const id of lostIds) {
            const excRef = db.doc(`tenants/${tenantId}/inventoryExceptions/${id}`);
            await db.runTransaction(async (tx: any) => {
              const e = await tx.get(excRef);
              const rec: any = e.exists ? e.data()?.recovery || null : null;
              if (!rec || rec.status !== 'candidate') return;
              const at = new Date().toISOString();
              tx.set(excRef, { recovery: { ...rec, status: 'abandoned', events: [...(Array.isArray(rec.events) ? rec.events : []), { at, by: 'Carrier', action: 'abandon', note: status === 'DELIVERED' ? 'It was delivered after all' : 'It’s coming back to the shop' }] } }, { merge: true });
            });
          }
        } catch { /* the claim stays to file; the screens leave out one that turned up */ }
      }

      /* THE DELAY THE CUSTOMER HEARS ABOUT FIRST. Shippo's track payload
       * carries both the carrier's ORIGINAL promise and its CURRENT eta.
       * When the current one slips a full day or more past the original —
       * and the parcel isn't delivered — the customer gets one email per
       * distinct new date (the marker id carries the date, so a repeated
       * webhook or a same-day wobble sends nothing, but a second slip to a
       * later date speaks again). This is the "they know before they ask"
       * email: it exists precisely so 'Where is my order?' never gets typed. */
      try {
        const etaRaw = Date.parse(String(data.eta || ''));
        const origEtaRaw = Date.parse(String(data.original_eta || ''));
        const slippedDays = Number.isFinite(etaRaw) && Number.isFinite(origEtaRaw)
          ? Math.floor((etaRaw - origEtaRaw) / 86400000) : 0;
        if (!extraBox && !order.shippedWithOrderId && slippedDays >= 1 && !['DELIVERED', 'RETURNED'].includes(String(status))) {
          const etaKey = new Date(etaRaw).toISOString().slice(0, 10);
          const res = await sendCarrierUpdate({
            markerRef: d.ref.collection('events').doc(`carrier-delayed-${etaKey}`),
            order, tenant, origin, tenantId, orderId: d.id,
            update: { ...update, status: 'DELAYED', eta: new Date(etaRaw).toISOString() },
          });
          if (res.sent) {
            notified += 1;
            await d.ref.set({ carrierEtaAt: new Date(etaRaw).toISOString(), carrierEtaSlippedDays: slippedDays }, { merge: true });
          }
        }
      } catch {
        // delay detection is best-effort; the scan trail already landed
      }

      // Other boxes' scans don't email the customer, except the last delivery; the first box's "delivered" waits for the rest.
      // An order shipped in the same box as another (lib/ship-together) stays quiet: the customer hears it once, on the first order.
      const speak = !order.shippedWithOrderId && (status === 'DELIVERED' ? allDelivered : !extraBox);
      if (speak && shouldNotify(status)) {
        const res = await sendCarrierUpdate({
          // Deterministic id = one email per order per status, however many
          // times the carrier repeats itself.
          markerRef: d.ref.collection('events').doc(`carrier-${status.toLowerCase()}`),
          order, tenant, update, origin, tenantId, orderId: d.id,
        });
        if (res.sent) notified += 1;
      }

      if (status === 'DELIVERED' && multi && !allDelivered) {
        try {
          const n = allBoxes.filter((t) => boxStatus[t] === 'DELIVERED').length;
          const nRef = d.ref.collection('events').doc(`box-delivered-${trackingNumber}`);
          await nRef.set({ id: nRef.id, type: 'note', at: new Date().toISOString(), actorId: 'shippo', actorName: 'Carrier',
            meta: { kind: 'box_delivered', text: `Box ${n} of ${allBoxes.length} delivered (${trackingNumber}). Waiting on the rest.`, trackingNumber } }, { merge: true });
        } catch { /* the box status already landed */ }
        continue;
      }
      if (status !== 'DELIVERED' || order.stage !== 'shipped') continue;

      // The order's last step, as the customer sees it ("Delivered"), recorded once however often the carrier repeats it.
      const evRef = d.ref.collection('events').doc(eventIdFor('completed', 'delivered'));
      const batch = db.batch();
      batch.set(d.ref, {
        stage: 'completed',
        deliveredAt: update.statusAt,
      }, { merge: true });
      batch.set(evRef, {
        id: evRef.id, type: 'completed', at: new Date().toISOString(),
        actorId: 'shippo', actorName: 'Carrier',
        meta: {
          kind: 'carrier_delivered',
          text: `Delivered — confirmed by ${update.carrier || 'carrier'} tracking`,
          carrierStatusAt: update.statusAt,
          carrierLocation: update.location,
          carrierDetail: update.detail,
          trackingNumber: update.trackingNumber,
        },
      });
      await batch.commit();
      advanced += 1;
    }
    // The customers' order pages show each scan and the delivery as they happen (lib/order-tracking).
    for (const d of snap.docs) await syncTracking(db, tenantId, d.id);
    return NextResponse.json({ ok: true, advanced, notified });
  } catch (e: any) {
    console.error('[shippo-webhook]', e?.message);
    // Return 200 anyway: Shippo retries non-200s and a transient failure
    // here must not build a retry storm.
    return NextResponse.json({ ok: true, error: 'logged' });
  }
}
