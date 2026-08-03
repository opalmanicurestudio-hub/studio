import { NextRequest, NextResponse } from 'next/server';

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
// Honesty notes: only DELIVERED changes anything, only orders currently in
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
  const status = String(data.tracking_status?.status || '').toUpperCase();
  if (!trackingNumber || status !== 'DELIVERED') {
    return NextResponse.json({ ok: true, skipped: 'not a delivery' });
  }

  try {
    const db = getAdminDb();
    const snap = await db.collection(`tenants/${tenantId}/retailOrders`)
      .where('trackingNumber', '==', trackingNumber).limit(3).get();

    let advanced = 0;
    for (const d of snap.docs) {
      const order = d.data() as any;
      if (order.stage !== 'shipped') continue;
      const evRef = d.ref.collection('events').doc();
      const batch = db.batch();
      batch.set(d.ref, {
        stage: 'completed',
        deliveredAt: String(data.tracking_status?.status_date || new Date().toISOString()),
      }, { merge: true });
      batch.set(evRef, {
        id: evRef.id, type: 'note', at: new Date().toISOString(),
        actorId: 'shippo', actorName: 'Carrier',
        meta: { text: `Delivered — confirmed by ${data.carrier || 'carrier'} tracking` },
      });
      await batch.commit();
      advanced += 1;
    }
    return NextResponse.json({ ok: true, advanced });
  } catch (e: any) {
    console.error('[shippo-webhook]', e?.message);
    // Return 200 anyway: Shippo retries non-200s and a transient failure
    // here must not build a retry storm.
    return NextResponse.json({ ok: true, error: 'logged' });
  }
}
