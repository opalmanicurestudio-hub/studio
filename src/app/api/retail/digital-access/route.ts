import { NextRequest, NextResponse } from 'next/server';
import { getAdminStorage } from '@/lib/firebase-admin';   // the NAMED app — getStorage() alone finds no default app
import { getStorage } from 'firebase-admin/storage';
import { checkPass } from '@/lib/order-pass';
import { checkStreamToken, closedMessage, digitalLineAccess, makeStreamToken, STREAM_MINUTES } from '@/lib/digital-access';
import { watermarkPdf, looksLikePdf } from '@/lib/pdf-watermark';

// ─── /api/retail/digital-access ──────────────────────────────────────────────
// The private door to a purchased file. Honest framing first: NOTHING can
// stop a determined person from screenshotting or re-recording content they
// are allowed to see. What this route CAN do — and does — is make casual
// sharing pointless and deliberate leaking traceable:
//
//   · Ownership is proven per request: the order PASS (lib/order-pass: the
//     device that paid, the shop account, or a 6-digit code), not just the
//     order link, so a forwarded order email opens nothing.
//   · Who may open what, and for how long, is one rule (lib/digital-access):
//     refunds, returns and chargebacks close it; a won dispute opens it again.
//   · A stored file is never given a public URL. Each open gets a stream link
//     signed for ten minutes, served from our own origin with the buyer's
//     name stamped into PDFs, so a copied address is dead almost at once.
//   · Every open is counted on the order (files and links alike), and the
//     route is rate limited per visitor and per order.
//   · The file path lives on the INVENTORY item, not the order — replacing
//     the file updates every past buyer, and clearing it revokes access.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


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

/**
 * One gate, used by both handlers. Returns either a refusal or everything
 * the caller needs. Keeping this shared is the point: a second copy of the
 * ownership rules is a second place for them to rot.
 */
async function authorize(db: any, tenantId: string, orderId: string, productId: string): Promise<
  { error: string; status: number; closed?: string; endsAt?: string | null } | { ref: any; order: any; line: any; item: any; endsAt: string | null }
> {
  const ref = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const orderSnap = await ref.get();
  if (!orderSnap.exists) return { error: 'Order not found', status: 404 };
  const order = orderSnap.data() as any;
  const line = (order.lines || []).find((l: any) => l.productId === productId && l.digital === true);
  if (!line) return { error: 'That isn\u2019t on this order.', status: 404 };
  const a = digitalLineAccess(order, line);
  if (!a.open) return { error: closedMessage(a.reason, a.endsAt), status: a.reason === 'inactive' ? 409 : 403, closed: a.reason || 'inactive', endsAt: a.endsAt };
  const itemSnap = await db.collection(`tenants/${tenantId}/inventory`).doc(productId).get();
  return { ref, order, line, item: itemSnap.exists ? (itemSnap.data() as any) : {}, endsAt: a.endsAt };
}

/**
 * Rate limits; a counting hiccup never blocks a real customer. Per visitor and order each hour (a class on one Wi-Fi
 * opening their own orders doesn't share one allowance), and per order each day, counted only once the buyer has
 * shown it's them, so someone holding just the order link can't use up the buyer's opens.
 */
async function tooMany(req: NextRequest, tenantId: string, orderId: string, which: 'visitor' | 'order'): Promise<boolean> {
  try {
    const { bump, visitorIp } = await import('@/lib/rate-limit');
    const { createHash } = await import('crypto');
    const h = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 32);
    const hour = Math.floor(Date.now() / 3600000), day = Math.floor(Date.now() / 86400000);
    if (which === 'visitor') return !(await bump(`digital_ip_${h(`${tenantId}|${orderId}|${visitorIp(req)}`)}_${hour}`, 120, 2 * 3600000));
    return !(await bump(`digital_order_${h(`${tenantId}|${orderId}`)}_${day}`, 300, 2 * 86400000));
  } catch { return false; }
}

/** What a stored file is, from its name: PDFs and pictures open in the page; anything else is saved. */
const TYPES: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', zip: 'application/zip', txt: 'text/plain' };
const extOf = (name: string) => String(name || '').toLowerCase().split('.').pop() || '';
const showsInPage = (name: string) => ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extOf(name));

const SLOW = { error: 'That\u2019s a lot of opens in a short time. Please wait a little and try again.' };
const label = (o: any) => `${o.customerName || 'Customer'} \u00b7 ${o.customerEmail || ''} \u00b7 #${String(o.orderNumber ?? '').padStart(4, '0')}`;

/** Download the stored file through the same bucket-hunting chain. */
async function downloadFile(path: string, tenantBucket: string | null): Promise<Uint8Array | null> {
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
    tenantBucket, null,
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
      const bucket = name === null ? getAdminStorage().bucket() : getAdminStorage().bucket(name);
      const [buf] = await bucket.file(path).download();
      if (buf) return new Uint8Array(buf);
    } catch { /* next candidate */ }
  }
  return null;
}

/**
 * GET streams the file itself, watermarked, from OUR origin — so the buyer's
 * name is inside the bytes even when iOS hands the PDF to its native viewer
 * and our on-page overlay never renders. It takes the stream link the POST
 * signed (ten minutes), and re-checks access, so a copied address soon dies.
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const tenantId = String(q.get('tenantId') || '').trim();
    const orderId = String(q.get('orderId') || '').trim();
    const productId = String(q.get('productId') || '').trim();
    const sig = String(q.get('s') || '').trim();
    if (!tenantId || !orderId || !productId || !sig) {
      return NextResponse.json({ error: 'Missing details' }, { status: 400 });
    }
    if (!checkStreamToken(tenantId, orderId, productId, sig)) {
      return NextResponse.json({ error: 'This link has expired. Open the item again from your library.' }, { status: 403 });
    }
    if (await tooMany(req, tenantId, orderId, 'visitor') || await tooMany(req, tenantId, orderId, 'order')) return NextResponse.json(SLOW, { status: 429 });
    const db = getAdminDb();
    const auth = await authorize(db, tenantId, orderId, productId);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const filePath = String(auth.item.digitalFilePath || '');
    if (!filePath) return NextResponse.json({ error: 'Nothing attached to this yet.' }, { status: 409 });

    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const tenantBucket = String((tSnap.data() as any)?.storageBucket || '') || null;
    const bytes = await downloadFile(filePath, tenantBucket);
    if (!bytes) return NextResponse.json({ error: 'The file couldn\u2019t be opened just now.' }, { status: 502 });

    const isPdf = looksLikePdf(filePath, bytes);
    const out = isPdf ? await watermarkPdf(bytes, label(auth.order)) : bytes;
    const name = String(auth.item.digitalFileName || filePath.split('/').pop() || 'file');
    const type = isPdf ? 'application/pdf' : TYPES[extOf(name)] || 'application/octet-stream';

    return new NextResponse(Buffer.from(out), {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Disposition': `${isPdf || showsInPage(name) ? 'inline' : 'attachment'}; filename="${name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err: any) {
    console.error('[digital-access] stream failed:', err?.message);
    return NextResponse.json({ error: 'Something went wrong opening this.' }, { status: 500 });
  }
}

/**
 * POST opens an item: proof it's the buyer (the order pass), then access, then either a stream link signed for ten
 * minutes (a stored file) or the shop's link. Answers { needsPass } when this device hasn't shown it's them yet.
 */
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
    const productId = String(body.productId || '').trim();
    const pass = String(body.pass || '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId) || !productId) {
      return NextResponse.json({ error: 'Missing details' }, { status: 400 });
    }
    if (await tooMany(req, tenantId, orderId, 'visitor')) return NextResponse.json(SLOW, { status: 429 });

    const db = getAdminDb();
    const auth = await authorize(db, tenantId, orderId, productId);
    if ('error' in auth) return NextResponse.json({ error: auth.error, closed: auth.closed || null, endsAt: auth.endsAt ?? null, expired: auth.closed === 'expired' }, { status: auth.status });
    const { order, line, item, endsAt, ref } = auth;

    // Proof it's the buyer: the pass this device keeps (lib/order-pass). The order link alone opens nothing.
    if (!checkPass(tenantId, String(order.qrToken || ''), pass)) {
      return NextResponse.json({ error: 'Confirm it\u2019s you to open this.', needsPass: true }, { status: 401 });
    }
    if (await tooMany(req, tenantId, orderId, 'order')) return NextResponse.json(SLOW, { status: 429 });

    const filePath = String(item.digitalFilePath || '');
    const linkUrl = String(item.digitalUrl || line.digitalUrl || '');
    if (!filePath && !linkUrl) {
      return NextResponse.json({ error: 'This file hasn\u2019t been attached yet. Send the shop a message from your order page and they\u2019ll sort it out.' }, { status: 409 });
    }

    await logOpen(ref, order, line, productId, filePath ? 'file' : 'link');

    if (filePath) {
      // Stored files stream through our own GET so the watermark is baked in; the link lasts ten minutes.
      const s = makeStreamToken(tenantId, orderId, productId);
      const url = `/api/retail/digital-access?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}&productId=${encodeURIComponent(productId)}&s=${encodeURIComponent(s)}`;
      return NextResponse.json({ ok: true, url, kind: 'file', inPage: showsInPage(String(item.digitalFileName || filePath)), name: line.name, endsAt, watermark: label(order), expiresInMinutes: STREAM_MINUTES });
    }
    return NextResponse.json({ ok: true, url: linkUrl, kind: 'link', name: line.name, endsAt, watermark: label(order), expiresInMinutes: 0 });
  } catch (err: any) {
    console.error('[digital-access] failed:', err?.message);
    return NextResponse.json({ error: 'Something went wrong opening this.' }, { status: 500 });
  }
}

async function logOpen(orderRef: any, order: any, line: any, productId: string, kind: 'file' | 'link'): Promise<void> {
    try {
      const { FieldValue } = require('firebase-admin/firestore');
      const opens = (Number(order.digitalOpens?.[productId]) || 0) + 1;
      await orderRef.set({ digitalOpens: { [productId]: FieldValue.increment(1) } }, { merge: true });
      if (opens === 1 || opens % 10 === 0) {
        const ev = orderRef.collection('events').doc();
        await ev.set({
          id: ev.id, type: 'note', at: new Date().toISOString(),
          actorId: 'customer', actorName: order.customerName || 'Customer',
          meta: { text: `Opened "${line.name}" (${opens} time${opens === 1 ? '' : 's'})`, digital: { productId, kind, opens } },
        });
      }
    } catch { /* logging must never block the customer's access */ }
}
