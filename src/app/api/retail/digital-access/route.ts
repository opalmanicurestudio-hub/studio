import { NextRequest, NextResponse } from 'next/server';
import { checkPass } from '@/lib/order-pass';
import { checkStreamToken, closedMessage, digitalLineAccess, makeStreamToken, streamTokenMode, STREAM_MINUTES } from '@/lib/digital-access';
import { countUse, downloadsLeft, ensureEntitlement, type Entitlement } from '@/lib/entitlements';
import { watermarkPdf, looksLikePdf } from '@/lib/pdf-watermark';
import { downloadFile } from '@/lib/digital-storage';
import { fileOf, filesOf, openMode, ownPath } from '@/lib/digital-product';
import { accessPassKey } from '@/lib/digital-gift';

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
async function authorize(db: any, tenantId: string, orderId: string, productId: string, lineId = ''): Promise<
  { error: string; status: number; closed?: string; endsAt?: string | null } | { ref: any; order: any; line: any; item: any; endsAt: string | null; ent: Entitlement }
> {
  const ref = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const orderSnap = await ref.get();
  if (!orderSnap.exists) return { error: 'Order not found', status: 404 };
  const order = orderSnap.data() as any;
  // The line asked for (the same product can sit on two lines, e.g. part of it on an offer); else the first that opens.
  const mine = (order.lines || []).filter((l: any) => l.productId === productId && l.digital === true);
  if (!mine.length) return { error: 'That isn\u2019t on this order.', status: 404 };
  const itemSnap = await db.collection(`tenants/${tenantId}/inventory`).doc(productId).get();
  let item = itemSnap.exists ? (itemSnap.data() as any) : {};
  // A variant sold inside its listing gets the listing's download unless it has its own (lib/variants asSold).
  if (item.parentId && item.digital !== true) {
    const ls = await db.collection(`tenants/${tenantId}/inventory`).doc(String(item.parentId)).get();
    if (ls.exists) { const { asSold } = await import('@/lib/variants'); item = asSold({ id: ls.id, ...(ls.data() as any) }, { id: productId, ...item }); }
  }
  const paid = !['placed', 'cancelled'].includes(String(order.stage));
  // The buyer's access record (lib/entitlements): made now for an order paid before records existed. With no line
  // named, the first line that opens counting the shop's own changes on each record.
  let line: any = lineId ? mine.find((l: any) => String(l.lineId || '') === lineId) : null;
  let ent: Entitlement | null = null;
  if (line || mine.length === 1) { line = line || mine[0]; ent = paid ? await ensureEntitlement(db, tenantId, { ...order, id: orderId }, line, item) : null; }
  else {
    for (const l of mine) {
      const e = paid ? await ensureEntitlement(db, tenantId, { ...order, id: orderId }, l, item) : null;
      if (!line) { line = l; ent = e; }
      if (digitalLineAccess(order, l, Date.now(), e).open) { line = l; ent = e; break; }
    }
  }
  const a = digitalLineAccess(order, line, Date.now(), ent);
  if (!a.open || !ent) return { error: closedMessage(a.reason, a.endsAt, !!order?.digitalGift), status: a.reason === 'inactive' || !ent ? 409 : 403, closed: a.reason || 'inactive', endsAt: a.endsAt };
  return { ref, order, line, item, endsAt: a.endsAt, ent };
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

/** Where to ask the shop: the buyer from their order page; someone given it as a gift by replying to their gift email. */
const askShop = (o: any) => (o?.digitalGift ? 'Reply to your gift email to ask the shop' : 'Send the shop a message from your order page');
const usedUp = (o: any) => `All the downloads for this have been used. You can still view it here, or ${o?.digitalGift ? 'reply to your gift email to ask the shop' : 'send the shop a message from your order page'} for more.`;
/** What a stream link is signed for: the product, and the line when the order has one (the same product can be on two). */
const streamKey = (productId: string, lineId: string, fileId = '') => `${productId}${lineId ? `|${lineId}` : ''}${fileId && fileId !== 'main' ? `#${fileId}` : ''}`;

const SLOW = { error: 'That\u2019s a lot of opens in a short time. Please wait a little and try again.' };
// The name stamped on the file is whoever it belongs to: on a gift, the person it was for, never the buyer.
const label = (o: any) => { const g = o?.digitalGift; return `${(g ? g.toName : o.customerName) || 'Customer'} \u00b7 ${(g ? g.toEmail : o.customerEmail) || ''} \u00b7 #${String(o.orderNumber ?? '').padStart(4, '0')}`; };

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
    const lineId = String(q.get('lineId') || '').trim();
    const fid = String(q.get('fileId') || '').trim();
    const sig = String(q.get('s') || '').trim();
    if (!tenantId || !orderId || !productId || !sig) {
      return NextResponse.json({ error: 'Missing details' }, { status: 400 });
    }
    if (!checkStreamToken(tenantId, orderId, streamKey(productId, lineId, fid), sig)) {
      return NextResponse.json({ error: 'This link has expired. Open the item again from your library.' }, { status: 403 });
    }
    if (await tooMany(req, tenantId, orderId, 'visitor') || await tooMany(req, tenantId, orderId, 'order')) return NextResponse.json(SLOW, { status: 429 });
    const db = getAdminDb();
    const auth = await authorize(db, tenantId, orderId, productId, lineId);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    // The file the link was made for (lib/digital-product): a replaced file serves its newest version.
    const file = fileOf(auth.item, fid || null);
    if (!file) return NextResponse.json({ error: 'That file isn\u2019t on this item any more. Open it again from your library.' }, { status: 409 });
    const filePath = file.path;
    if (!ownPath(tenantId, filePath)) return NextResponse.json({ error: `This file can\u2019t be opened. ${askShop(auth.order)}.` }, { status: 409 });
    // How the shop delivers it now wins over the link: a link made before the shop switched to view only can't save.
    if (openMode(auth.item, file, streamTokenMode(sig)) !== streamTokenMode(sig)) return NextResponse.json({ error: 'The shop changed how this item opens. Open it again from your library.' }, { status: 403 });

    // A saved copy uses one of the downloads (lib/entitlements), refused once they're used. Checked before the file is
    // fetched, counted only once it's ready to send, and once per link however often it's fetched. Views were counted
    // when the link was made, so a PDF viewer's several requests are one view.
    const mode = streamTokenMode(sig);
    const name = file.name;
    const saving = mode === 'download' || !showsInPage(name);
    const leftNow = downloadsLeft(auth.ent);
    if (saving && leftNow !== null && leftNow <= 0 && !((auth.ent.downloads as any)?.seen || []).some((x: any) => x?.id === sig.slice(-32))) return NextResponse.json({ error: usedUp(auth.order) }, { status: 403 });

    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const tenantBucket = String((tSnap.data() as any)?.storageBucket || '') || null;
    const bytes = await downloadFile(filePath, tenantBucket);
    if (!bytes) {
      // The team hears (once per item a day), so a lost file is put back before more buyers find it.
      const { alertMissingFile } = await import('@/lib/digital-notices-server');
      await alertMissingFile(db, tenantId, auth.item, productId, String(auth.item?.name || auth.line?.name || 'a download'), 'missing');
      return NextResponse.json({ error: `The file couldn\u2019t be opened just now. The shop has been told. ${askShop(auth.order)} if it still won\u2019t open later.` }, { status: 502 });
    }

    const isPdf = looksLikePdf(filePath, bytes);
    const out = isPdf ? await watermarkPdf(bytes, label(auth.order)) : bytes;
    if (saving && !(await countUse(db, tenantId, auth.ent.id, 'download', sig.slice(-32))).ok) return NextResponse.json({ error: usedUp(auth.order) }, { status: 403 });
    const type = isPdf ? 'application/pdf' : TYPES[extOf(name)] || 'application/octet-stream';

    return new NextResponse(Buffer.from(out), {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Disposition': `${saving ? 'attachment' : 'inline'}; filename="${name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
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
    const lineId = String(body.lineId || '').trim().slice(0, 80);
    const pass = String(body.pass || '').trim();
    const asked: 'view' | 'download' = body.mode === 'download' ? 'download' : 'view';
    const askedFile = String(body.fileId || '').trim().slice(0, 40);
    const wantsLink = body.link === true;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId) || !productId) {
      return NextResponse.json({ error: 'Missing details' }, { status: 400 });
    }
    if (await tooMany(req, tenantId, orderId, 'visitor')) return NextResponse.json(SLOW, { status: 429 });

    const db = getAdminDb();
    const auth = await authorize(db, tenantId, orderId, productId, lineId);
    if ('error' in auth) return NextResponse.json({ error: auth.error, closed: auth.closed || null, endsAt: auth.endsAt ?? null, expired: auth.closed === 'expired' }, { status: auth.status });
    const { order, line, item, endsAt, ref, ent } = auth;

    // Proof it's the buyer: the pass this device keeps (lib/order-pass). The order link alone opens nothing.
    // On a download bought as a gift it's the recipient's pass, never the buyer's (lib/digital-gift).
    if (!checkPass(tenantId, accessPassKey(order), pass)) {
      return NextResponse.json({ error: 'Confirm it\u2019s you to open this.', needsPass: true }, { status: 401 });
    }
    if (await tooMany(req, tenantId, orderId, 'order')) return NextResponse.json(SLOW, { status: 429 });

    // One of the item's files (lib/digital-product), or its link. Nothing named = the first file, else the link.
    const files = filesOf(item);
    const linkUrl = String(item.digitalUrl || line.digitalUrl || '');
    const file = wantsLink ? null : askedFile ? fileOf(item, askedFile) : files[0] || null;
    if (askedFile && !file) return NextResponse.json({ error: 'That file isn\u2019t on this item any more. Reload your library.' }, { status: 409 });
    if (file && !ownPath(tenantId, file.path)) return NextResponse.json({ error: `This file can\u2019t be opened. ${askShop(order)}.` }, { status: 409 });
    const filePath = file ? file.path : '';
    if (!filePath && !linkUrl) {
      const { alertMissingFile } = await import('@/lib/digital-notices-server');
      if (!wantsLink || !files.length) await alertMissingFile(db, tenantId, item, productId, String(item?.name || line?.name || 'a download'), 'unattached');
      return NextResponse.json({ error: `This file hasn\u2019t been attached yet. The shop has been told. ${askShop(order)} to hear when it\u2019s ready.` }, { status: 409 });
    }

    await logOpen(ref, order, line, productId, filePath ? 'file' : 'link');

    const left = downloadsLeft(ent);
    const lid = String(line.lineId || '');
    if (file) {
      // How the shop delivers it decides (lib/digital-product): what can't be shown in the page (a zip, audio, video) is
      // always a saved copy, view-only never saves, save-only always does.
      const inPage = showsInPage(file.name);
      const mode = openMode(item, file, asked);
      if (!mode) return NextResponse.json({ error: `This file can\u2019t be shown here, and the shop doesn\u2019t offer copies of it. ${askShop(order)}.` }, { status: 409 });
      // A copy to save, once the downloads are used, is refused here (and again when the file is fetched).
      if (mode === 'download' && left !== null && left <= 0) {
        return NextResponse.json({ error: usedUp(order), downloadsLeft: 0 }, { status: 403 });
      }
      if (mode === 'view') await countUse(db, tenantId, ent.id, 'view');
      // Stored files stream through our own GET so the watermark is baked in; the link lasts ten minutes.
      const fk = file.id === 'main' ? '' : file.id;
      const s = makeStreamToken(tenantId, orderId, streamKey(productId, lid, fk), Date.now(), mode);
      const url = `/api/retail/digital-access?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}&productId=${encodeURIComponent(productId)}${lid ? `&lineId=${encodeURIComponent(lid)}` : ''}${fk ? `&fileId=${encodeURIComponent(fk)}` : ''}&s=${encodeURIComponent(s)}`;
      return NextResponse.json({ ok: true, url, kind: 'file', mode, inPage: mode === 'view', canSave: openMode(item, file, 'download') === 'download', fileName: file.name, name: line.name, endsAt, watermark: label(order), expiresInMinutes: STREAM_MINUTES, downloadsLeft: left, license: ent.license });
    }
    await countUse(db, tenantId, ent.id, 'view');
    return NextResponse.json({ ok: true, url: linkUrl, kind: 'link', name: line.name, endsAt, watermark: label(order), expiresInMinutes: 0, downloadsLeft: null, license: ent.license });
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
