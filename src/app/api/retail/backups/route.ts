// /api/retail/backups — THE BACKUPS A CUSTOMER CAN PICK FOR ONE ITEM, in case it's out when their order is packed
// (lib/retail-swap). Best first: the same product's other colors, then close matches in its category. Only what the shop
// sells online, in stock now, never a product the shop never swaps, and never dearer than the item itself (up to the
// shop's limit when it covers the difference). Checkout checks the one they pick again (api/retail/checkout).
//   POST { tenantId, productId, selections? } → { priceCents, noSwap, options: [{ productId, name, unitPriceCents, imageUrl, sameProduct }] }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { similarItems } from '@/lib/retail-swap';
import { choiceSale, saleUnitCents, soldAs } from '@/lib/variants';

export const dynamic = 'force-dynamic';

// A few seconds of memory per shop, so opening the picker for each item doesn't re-read the catalog each time.
const recent = new Map<string, { at: number; items: any[]; rs: any }>();
const asks = new Map<string, { minute: number; n: number }>();

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim();
  const productId = String(b.productId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,120}$/.test(productId)) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  try {
    const { visitorIp } = await import('@/lib/rate-limit');
    const who = `${tenantId}|${visitorIp(req)}`; const minute = Math.floor(Date.now() / 60000);
    const a = asks.get(who); const n = a && a.minute === minute ? a.n + 1 : 1;
    if (asks.size > 5000) asks.clear();
    asks.set(who, { minute, n });
    if (n > 40) return NextResponse.json({ error: 'Please wait a moment and try again.' }, { status: 429 });
    const db = getAdminDb();
    let hit = recent.get(tenantId);
    if (!hit || Date.now() - hit.at > 15000) {
      const t = await db.doc(`tenants/${tenantId}`).get();
      if (!t.exists) return NextResponse.json({ error: 'Shop not found.' }, { status: 404 });
      const snap = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'retail').limit(2000).get();
      hit = { at: Date.now(), items: snap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id })), rs: (t.data() as any)?.retailSettings || {} };
      if (recent.size > 300) recent.clear();
      recent.set(tenantId, hit);
    }
    const listing = hit.items.find((i) => i.id === productId);
    if (!listing || listing.status === 'archived' || listing.showOnline !== true) return NextResponse.json({ error: 'That item isn’t for sale online.' }, { status: 404 });
    const sale = choiceSale(listing, b.selections && typeof b.selections === 'object' ? b.selections : undefined);
    const variant = sale.variantId ? hit.items.find((i) => i.id === sale.variantId) || null : null;
    const priceCents = saleUnitCents(listing, variant, sale, 'retail', 0);
    const noSwap = listing.noSwap === true || variant?.noSwap === true;
    if (noSwap) return NextResponse.json({ priceCents, noSwap: true, options: [] }, { headers: { 'Cache-Control': 'no-store' } });
    const pros = listing.prosOnly === true || variant?.prosOnly === true;
    // As the shop sells them (a listing's variants in its place), without what can't stand in for a shelf item: downloads,
    // gift cards and products for licensed pros on an item that isn't (a product never swapped is left out by similarItems).
    const listings = new Map(hit.items.map((i) => [String(i.id), i]));
    const pool = soldAs(hit.items).filter((i: any) => i.digital !== true && i.giftCard !== true
      && (pros || (i.prosOnly !== true && !(i.listingId && listings.get(String(i.listingId))?.prosOnly === true))));
    const family = variant ? String(listing.id) : '';
    const options = similarItems(pool, { productId: variant ? variant.id : listing.id, unitPriceCents: priceCents, ...(family ? { listingId: family } : {}) }, 6, hit.rs)
      .map((o) => ({ productId: o.productId, name: o.name, unitPriceCents: o.unitPriceCents, imageUrl: o.imageUrl || '', sameProduct: !!family && o.listingId === family }));
    return NextResponse.json({ priceCents, noSwap: false, options }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[backups]', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: 'Backups couldn’t be loaded.' }, { status: 500 });
  }
}
