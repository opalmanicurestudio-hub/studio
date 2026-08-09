import { NextRequest, NextResponse } from 'next/server';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';

// ─── /api/retail/claim-photo ─────────────────────────────────────────────────
// Attach a photo to an existing claim. The security model, spelled out:
//   · Auth = the order's qrToken (link possession), same as every other
//     customer self-serve action — no Firebase Auth, no open Storage rules.
//   · The SERVER chooses the storage path; the customer only sends bytes.
//   · Caps: 4 photos per claim, 3 MB decoded each, JPG/PNG/WebP only —
//     validated server-side regardless of what the client promised.
//   · Approved claims are closed to new photos (the decision is made);
//     in-review, declined, and appealed claims accept them — a declined
//     claim gaining a photo is exactly the "genuinely new information"
//     an appeal deserves.
// Every accepted photo lands on the order's event ledger, so the desk and
// the Evidence Record see that the customer added evidence, and when.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PHOTOS = 4;

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let app = getApps().find((a: any) => a.name === 'retail-claim-photo');
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    }, 'retail-claim-photo');
  }
  return getFirestore(app);
}

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    const tenantId = String(body.tenantId || '').trim();
    const orderId = String(body.orderId || '').trim();
    const qrToken = String(body.qrToken || '').trim();
    const claimId = String(body.claimId || '').trim();
    const image = body.image;
    if (!tenantId || !orderId || !qrToken || !claimId || !image) {
      return NextResponse.json({ error: 'Missing photo details' }, { status: 400 });
    }

    const db = getAdminDb();

    const orderSnap = await db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get();
    if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const order = orderSnap.data() as any;
    if (!order.qrToken || String(order.qrToken) !== qrToken) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
    }

    const claimRef = db.collection(`tenants/${tenantId}/retailClaims`).doc(claimId);
    const claimSnap = await claimRef.get();
    if (!claimSnap.exists) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    const claim = claimSnap.data() as any;
    if (String(claim.orderId) !== orderId) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }
    if (claim.status === 'approved') {
      return NextResponse.json({ error: 'This report is already approved \u2014 no photos needed.' }, { status: 409 });
    }
    const existing: string[] = Array.isArray(claim.photoUrls) ? claim.photoUrls : [];
    if (existing.length >= MAX_PHOTOS) {
      return NextResponse.json({ error: `That report already has ${MAX_PHOTOS} photos \u2014 that\u2019s plenty for review.` }, { status: 409 });
    }

    const up = await uploadClaimPhotoFromDataUrl(tenantId, claimId, image);
    if (!up.url) {
      return NextResponse.json({ error: up.error || 'The photo couldn\u2019t be saved.' }, { status: 422 });
    }

    const photoUrls = [...existing, up.url];
    const batch = db.batch();
    batch.set(claimRef, { photoUrls, photosUpdatedAt: new Date().toISOString() }, { merge: true });
    const evRef = orderSnap.ref.collection('events').doc();
    batch.set(evRef, {
      id: evRef.id, type: 'note', at: new Date().toISOString(),
      actorId: 'customer', actorName: order.customerName || 'Customer',
      meta: { text: `Customer added a photo to their ${String(claim.type || 'issue')} report (${photoUrls.length} of ${MAX_PHOTOS})` },
    });
    await batch.commit();

    return NextResponse.json({ ok: true, url: up.url, photoUrls });
  } catch (err: any) {
    console.error('[claim-photo] failed:', err?.message);
    return NextResponse.json({ error: 'Something went wrong saving the photo.' }, { status: 500 });
  }
}
