import { NextRequest, NextResponse } from 'next/server';

import {
  deliveryEvidence, readShippoStatus, sendCarrierUpdate, shouldNotify,
} from '@/lib/shipping-notify';

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
  const data = body?.data || body || {};
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

  const envOrigin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const origin = envOrigin || (host ? `https://${host}` : '');

  try {
    const db = getAdminDb();
    const snap = await db.collection(`tenants/${tenantId}/retailOrders`)
      .where('trackingNumber', '==', trackingNumber).limit(3).get();

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

      // Evidence is recorded for EVERY scan, including ones that send no email
      // and ones on an order that has already completed. A claim six weeks from
      // now needs the whole trail, not just the parts that were newsworthy.
      try {
        await d.ref.set(
          { carrierTrail: deliveryEvidence(update, String(order.customerEmail || '')) },
          { merge: true }
        );
      } catch {
        // never let bookkeeping fail the webhook
      }

      if (shouldNotify(status)) {
        const res = await sendCarrierUpdate({
          // Deterministic id = one email per order per status, however many
          // times the carrier repeats itself.
          markerRef: d.ref.collection('events').doc(`carrier-${status.toLowerCase()}`),
          order, tenant, update, origin, tenantId, orderId: d.id,
        });
        if (res.sent) notified += 1;
      }

      if (status !== 'DELIVERED' || order.stage !== 'shipped') continue;

      const evRef = d.ref.collection('events').doc();
      const batch = db.batch();
      batch.set(d.ref, {
        stage: 'completed',
        deliveredAt: update.statusAt,
      }, { merge: true });
      batch.set(evRef, {
        id: evRef.id, type: 'note', at: new Date().toISOString(),
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
    return NextResponse.json({ ok: true, advanced, notified });
  } catch (e: any) {
    console.error('[shippo-webhook]', e?.message);
    // Return 200 anyway: Shippo retries non-200s and a transient failure
    // here must not build a retry storm.
    return NextResponse.json({ ok: true, error: 'logged' });
  }
}
