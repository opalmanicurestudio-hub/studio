import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';
import { digitalAccessEndsAt } from '@/lib/retail-orders';

// ─── /api/retail/digital-access ──────────────────────────────────────────────
// The private door to a purchased file. Honest framing first: NOTHING can
// stop a determined person from screenshotting or re-recording content they
// are allowed to see. What this route CAN do — and does — is make casual
// sharing pointless and deliberate leaking traceable:
//
//   · Ownership is proven per request (order token + the line was actually
//     bought + the order is paid, not cancelled or refunded).
//   · The file is NEVER given a permanent public URL. Each open mints a
//     SIGNED link that expires in 10 minutes, so a copied address is dead
//     almost immediately and can't be posted in a group chat.
//   · Every open is logged on the order's own event ledger with the count,
//     so an account handing its link around is visible, not theoretical.
//   · The file path lives on the INVENTORY item, not the order — replacing
//     the file updates every past buyer, and clearing it revokes access.
//
// The viewer page renders the file with the buyer's name and email burned
// across it, which is the actual deterrent: a screenshot carries the
// screenshotter's identity.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LINK_MINUTES = 10;

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let app = getApps().find((a: any) => a.name === 'retail-digital-access');
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    }, 'retail-digital-access');
  }
  return getFirestore(app);
}

/** Bucket hunt, same chain the claim-photo uploader proved out. */
async function signedUrlFor(path: string, tenantBucket: string | null): Promise<string | null> {
  let projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
  let appBucket: string | null = null;
  try {
    const { getApps } = await import('firebase-admin/app');
    const opts: any = getApps()[0]?.options || {};
    appBucket = opts.storageBucket || null;
    if (!projectId) projectId = opts.projectId || opts.credential?.projectId || '';
  } catch { /* keep hunting */ }
  const names: (string | null)[] = [
    tenantBucket,
    null,
    process.env.FIREBASE_STORAGE_BUCKET || null,
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null,
    appBucket,
    projectId ? `${projectId}.firebasestorage.app` : null,
    projectId ? `${projectId}.appspot.com` : null,
  ];
  const tried = new Set<string>();
  for (const name of names) {
    if (name !== null && tried.has(name)) continue;
    if (name !== null) tried.add(name);
    try {
      const bucket = name === null ? getStorage().bucket() : getStorage().bucket(name);
      const [url] = await bucket.file(path).getSignedUrl({
        action: 'read',
        expires: Date.now() + LINK_MINUTES * 60 * 1000,
      });
      if (url) return url;
    } catch { /* next candidate */ }
  }
  return null;
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
    const productId = String(body.productId || '').trim();
    if (!tenantId || !orderId || !qrToken || !productId) {
      return NextResponse.json({ error: 'Missing details' }, { status: 400 });
    }

    const db = getAdminDb();
    const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const order = orderSnap.data() as any;

    if (!order.qrToken || String(order.qrToken) !== qrToken) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
    }
    if (['placed', 'cancelled', 'refunded'].includes(String(order.stage))) {
      return NextResponse.json({ error: 'This order isn\u2019t active.' }, { status: 409 });
    }
    const line = (order.lines || []).find((l: any) => l.productId === productId && l.digital === true);
    if (!line) {
      return NextResponse.json({ error: 'That isn\u2019t on this order.' }, { status: 404 });
    }
    if (['refunded', 'backordered'].includes(String(line.status))) {
      return NextResponse.json({ error: 'Access for this item was closed.' }, { status: 409 });
    }

    // ── ACCESS WINDOW. Most digital goods here are sold outright, so the
    // default is access for good and this block does nothing. When the shop
    // DID sell a limited window, it is enforced here rather than only shown
    // in the UI — and the refusal names the date and points at a human,
    // because "expired" with no recourse is how a paying customer ends up
    // feeling robbed over a $12 PDF.
    const endsAt = digitalAccessEndsAt(line, order.paidAt, order.placedAt);
    if (endsAt && Date.parse(endsAt) < Date.now()) {
      return NextResponse.json({
        error: `Your access to this ended on ${new Date(endsAt).toLocaleDateString()}. Message the shop from your order page \u2014 they can extend it.`,
        expired: true, endsAt,
      }, { status: 403 });
    }

    // The file lives on the item, so the shop can swap or withdraw it later.
    const itemSnap = await db.collection(`tenants/${tenantId}/inventory`).doc(productId).get();
    const item = itemSnap.exists ? (itemSnap.data() as any) : {};
    const filePath = String(item.digitalFilePath || '');
    const linkUrl = String(item.digitalUrl || line.digitalUrl || '');

    let url: string | null = null;
    let kind: 'file' | 'link' | null = null;
    if (filePath) {
      const tSnap = await db.collection('tenants').doc(tenantId).get();
      const tenantBucket = String((tSnap.data() as any)?.storageBucket || '') || null;
      url = await signedUrlFor(filePath, tenantBucket);
      kind = 'file';
      if (!url) {
        return NextResponse.json({ error: 'The file couldn\u2019t be opened just now \u2014 try again in a minute.' }, { status: 502 });
      }
    } else if (linkUrl) {
      url = linkUrl;
      kind = 'link';
    } else {
      return NextResponse.json({ error: 'The shop hasn\u2019t attached this yet \u2014 they\u2019ve been told.' }, { status: 409 });
    }

    // Log the open. Counted per line so repeated opens read as one story
    // rather than flooding the ledger.
    try {
      const { FieldValue } = require('firebase-admin/firestore');
      const opens = (Number(order.digitalOpens?.[productId]) || 0) + 1;
      await orderRef.set({ digitalOpens: { [productId]: FieldValue.increment(1) } }, { merge: true });
      if (opens === 1 || opens % 10 === 0) {
        const ev = orderRef.collection('events').doc();
        await ev.set({
          id: ev.id, type: 'note', at: new Date().toISOString(),
          actorId: 'customer', actorName: order.customerName || 'Customer',
          meta: { text: `Opened "${line.name}" (${opens} time${opens === 1 ? '' : 's'})` },
        });
      }
    } catch { /* logging must never block the customer's access */ }

    return NextResponse.json({
      ok: true, url, kind,
      name: line.name,
      endsAt,
      watermark: `${order.customerName || 'Customer'} \u00b7 ${order.customerEmail || ''} \u00b7 #${String(order.orderNumber ?? '').padStart(4, '0')}`,
      expiresInMinutes: LINK_MINUTES,
    });
  } catch (err: any) {
    console.error('[digital-access] failed:', err?.message);
    return NextResponse.json({ error: 'Something went wrong opening this.' }, { status: 500 });
  }
}
