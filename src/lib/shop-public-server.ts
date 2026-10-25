// src/lib/shop-public-server.ts — THE PUBLIC SHOP, READ ON THE SERVER. What the product feed, the assistant guide and
// data, and the search markup all start from: the same product list the shop's catalog serves (lib/shop-catalog), its
// live bundles that have a page of their own, and the reviews each product page shows. Anonymous shoppers only, so
// no wholesale prices.
//
// The business record is read fresh each time (so a switch turned off takes effect at once, and is checked before
// anything else is read); the products and bundles are kept for five minutes per shop, because a whole catalog read
// on every feed fetch, guide read or bundle page view adds up.
import { unstable_cache } from 'next/cache';
import { listingsOf, variantIdsOf } from '@/lib/variants';
import { tenantTimeZone } from '@/lib/tenant-time';
import { catalogProducts, publicRow } from '@/lib/shop-catalog';
import { publicOffer } from '@/lib/retail-offers';
import { liveOffers } from '@/lib/retail-offers-server';
import { hasOwnPage, shopFactsOf } from '@/lib/shop-discovery';

export const TENANT_ID = /^[A-Za-z0-9_-]{2,80}$/;

// Only plain data crosses the cache (dates come back as strings, which is all these pages read).
const plain = (x: any) => JSON.parse(JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && typeof v.toDate === 'function' ? v.toDate().toISOString() : v)));

async function readRows(db: any, tenantId: string) {
  const inv = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'retail').get();
  // Only the fields the public shop reads, so the cache stays small (it can't hold more than 2 MB) and private ones stay out.
  const rows = inv.docs.map((d: any) => publicRow({ id: d.id, ...(d.data() || {}) }));
  const offers = await liveOffers(db, tenantId).catch(() => [] as any[]);
  return plain({ rows, offers });
}

function cachedRows(db: any, tenantId: string): Promise<{ rows: any[]; offers: any[] }> {
  try { return unstable_cache(() => readRows(db, tenantId), ['public-shop-rows-v2', tenantId], { revalidate: 300, tags: [`shop:${tenantId}`] })().catch(() => readRows(db, tenantId)); }
  catch { return readRows(db, tenantId); }   // outside a request (scripts): read directly
}

/** The public shop. `gate`: checked against the business record before the catalog is read; false = stop there. */
export async function loadPublicShop(db: any, tenantId: string, gate?: (t: any) => boolean) {
  if (!TENANT_ID.test(tenantId)) return null;
  const tSnap = await db.doc(`tenants/${tenantId}`).get(); if (!tSnap.exists) return null;
  const t: any = tSnap.data() || {}; const facts = shopFactsOf(tenantId, t);
  const empty = { t, facts, products: [] as any[], byId: new Map<string, any>(), offers: [] as any[], productMap: new Map<string, any>(), zone: tenantTimeZone(t), gated: false };
  if (gate && !gate(t)) return { ...empty, gated: true };
  if (!facts.listed) return empty;
  const { rows, offers: raw } = await cachedRows(db, tenantId);
  const byId = new Map<string, any>(rows.map((i: any) => [String(i.id), i]));
  const products = catalogProducts(rows, byId, listingsOf(rows), { wholesale: false, discountPct: 0, zone: empty.zone });
  const productMap = new Map<string, any>(products.map((p: any) => [String(p.id), p]));
  const offers = raw.filter(hasOwnPage).map((o: any) => publicOffer(o, productMap)).filter(Boolean).sort((a: any, b: any) => a.order - b.order || String(a.name).localeCompare(String(b.name)));
  return { ...empty, products, byId, offers, productMap };
}

/** A product page's published reviews: its own, its listing's, and its variants' (the product page and its search
 *  markup both read this). `listing`: the product's record when the caller already has it. */
export async function publishedReviews(db: any, tenantId: string, productId: string, listing?: any) {
  const col = db.collection(`tenants/${tenantId}/retailReviews`);
  // Reviews written before each noted its listing are found by the variants the listing sells now.
  let data: any = listing;
  if (data === undefined) { const lsnap = await db.doc(`tenants/${tenantId}/inventory/${productId}`).get().catch(() => null); data = lsnap?.exists ? lsnap.data() || {} : null; }
  const vids = data ? variantIdsOf({ ...data, id: productId }).slice(0, 60) : [];
  const asks = [
    col.where('productId', '==', productId).where('status', '==', 'published').limit(100).get(),
    col.where('listingId', '==', productId).where('status', '==', 'published').limit(100).get(),
    ...[0, 30].filter((k) => vids.length > k).map((k) => col.where('productId', 'in', vids.slice(k, k + 30)).where('status', '==', 'published').limit(100).get()),
  ];
  // One query failing (a missing index, say) leaves the others' reviews showing.
  const docs = [...new Map((await Promise.all(asks.map((a: any) => Promise.resolve(a).catch(() => ({ docs: [] }))))).flatMap((x: any) => x.docs).map((d: any) => [d.id, d])).values()];
  const reviews = docs
    .map((d: any) => { const r = d.data() as any; return { id: d.id, rating: Math.max(1, Math.min(5, Number(r.rating) || 0)), title: String(r.title || ''), body: String(r.body || ''), author: String(r.author || 'Verified buyer'), at: String(r.createdAt || '') }; })
    .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 30);
  const count = reviews.length;
  const average = count ? Math.round((reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / count) * 10) / 10 : 0;
  return { average, count, reviews };
}

/** The rating a product page shows, kept for ten minutes (it's in the page's search markup on every view). */
export function cachedRating(db: any, tenantId: string, productId: string, listing: any): Promise<{ average: number; count: number }> {
  const read = async () => { const r = await publishedReviews(db, tenantId, productId, listing); return { average: r.average, count: r.count }; };
  try { return unstable_cache(read, ['product-rating', tenantId, productId], { revalidate: 600, tags: [`shop:${tenantId}`] })().catch(read); }
  catch { return read(); }
}
