// src/app/api/retail/digital-preview/route.ts — A FREE PREVIEW OF A DOWNLOAD (lib/digital-product MAX_PREVIEWS). Anyone
// can read a file the shop marked as a free preview, on a product the shop sells online, before buying. Nothing else
// about the item is opened here: a file not marked as a preview, or an item that's hidden, gives nothing. PDFs are
// stamped "Free preview" on every page; the file is shown in the page, never offered as a download, and each visitor
// gets a limited number of opens an hour.
//   GET ?tenantId&productId&fileId
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isStorefrontVisible } from '@/lib/retail-orders';
import { filesOf, ownPath, viewable } from '@/lib/digital-product';
import { downloadFile } from '@/lib/digital-storage';
import { watermarkPdf, looksLikePdf } from '@/lib/pdf-watermark';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const ID = /^[A-Za-z0-9_-]{1,80}$/;

async function tooMany(req: NextRequest, tenantId: string): Promise<boolean> {
  try {
    const { bump, visitorIp } = await import('@/lib/rate-limit');
    const { createHash } = await import('crypto');
    const h = createHash('sha256').update(`${tenantId}|${visitorIp(req)}`).digest('hex').slice(0, 32);
    return !(await bump(`digital_preview_${h}_${Math.floor(Date.now() / 3600000)}`, 60, 2 * 3600000));
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const tenantId = String(q.get('tenantId') || '').trim(); const productId = String(q.get('productId') || '').trim(); const fid = String(q.get('fileId') || '').trim();
  if (!ID.test(tenantId) || !ID.test(productId) || !ID.test(fid)) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  if (await tooMany(req, tenantId)) return NextResponse.json({ error: 'That’s a lot of previews in a short time. Please wait a little and try again.' }, { status: 429 });
  try {
    const db = getAdminDb();
    const [iSnap, tSnap] = await Promise.all([db.doc(`tenants/${tenantId}/inventory/${productId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
    const item: any = iSnap.exists ? { id: iSnap.id, ...iSnap.data() } : null;
    // A variant is sold inside its listing, whose page shows the listing's files: never one of its own.
    const variant = !!item && !!item.parentId && String(item.parentId) !== String(item.id);
    const file = item && !variant && item.digital === true && isStorefrontVisible(item) ? filesOf(item).find((f) => f.id === fid && f.preview === true) : null;
    if (!file || !viewable(file.name) || !ownPath(tenantId, file.path)) return NextResponse.json({ error: 'This preview isn’t available.' }, { status: 404 });
    const t: any = tSnap.exists ? tSnap.data() : {};
    const bytes = await downloadFile(file.path, String(t.storageBucket || '') || null);
    if (!bytes) return NextResponse.json({ error: 'The preview couldn’t be opened just now.' }, { status: 502 });
    const isPdf = looksLikePdf(file.path, bytes);
    const out = isPdf ? await watermarkPdf(bytes, `Free preview · ${String(t.businessName || t.name || 'Shop')}`) : bytes;
    const ext = file.name.toLowerCase().split('.').pop() || '';
    return new NextResponse(Buffer.from(out), {
      status: 200,
      headers: {
        'Content-Type': isPdf ? 'application/pdf' : TYPES[ext] || 'application/octet-stream',
        'Content-Disposition': `inline; filename="preview-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        // A short private cache: a shop that turns the preview off stops it soon after.
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e: any) {
    console.error('[digital-preview]', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: 'The preview couldn’t be opened just now.' }, { status: 500 });
  }
}
