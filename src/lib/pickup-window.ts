// src/lib/pickup-window.ts — THE PICKUP WINDOW: the shop's everyday products picked to show at the window (on the
// window board, drive-thru/[tenantId]/menu) and numbered so a customer can order "number 3" at the window or the
// register. Any business with a shop can have one: a supply store's acetone and files, a pop-up's best sellers.
//   • The list is the business's own pick and order (tenants/{id}.pickupWindow.items, up to WINDOW_MAX), saved from the
//     Pickup window page (api/retail/window). Only its own retail products, never a variant on its own (a variant is
//     sold in its listing, picked by its shade or size).
//   • Numbers follow the board: the menu's items first (lib/menu-numbers, the same numbers the lane and the speaker
//     use), then the window's products, category by category in the order the list first reaches each one.
//   • At the window a product is sold from what's on the shelf (on hand less what's held for orders), not the online
//     shop's share of it, so the board shows sold out only when there's none to hand over.
// Pure apart from readWindow, which is handed the database: the board, the register and the page all use these.
import { menuNumbers, type Numbered } from '@/lib/menu-numbers';
import { listingPriceCents, sellableStock, expiredUnits } from '@/lib/retail-orders';
import { variantGroup, variantIdsOf, pickedBy, variantPriceCents, swatchOf } from '@/lib/variants';

export const WINDOW_MAX = 60;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const https = (v: unknown) => { const s = String(v ?? '').trim(); return /^https:\/\/[^\s"'<>]{4,1990}$/.test(s) ? s : null; };

/** The products on the window, in the business's order (ids only; duplicates and bad ids left out). */
export function windowIdsOf(tenant: any): string[] {
  const raw = Array.isArray(tenant?.pickupWindow?.items) ? tenant.pickupWindow.items : [];
  const out: string[] = [];
  for (const x of raw) { const id = String(x ?? ''); if (ID.test(id) && !out.includes(id)) out.push(id); if (out.length >= WINDOW_MAX) break; }
  return out;
}

/** Can this product go on the window: one of the shop's own products, not archived, with a price, and not a variant
 *  (a variant is sold inside its listing). */
export function windowable(item: any): boolean {
  return !!item && item.type === 'retail' && item.status !== 'archived' && item.archived !== true && item.isActive !== false && !item.parentId && Number(item.msrp) > 0;
}

/** On the shelf to hand over now: on hand less what's held for orders and what's past its date (never below 0). */
const onShelf = (item: any) => Math.max(0, Math.floor((Number(sellableStock({ ...item, totalStock: Number(item?.totalStock) || 0, stockReserved: Number(item?.stockReserved) || 0 } as any)) || 0) - (Number(expiredUnits(item || {})) || 0)));
const liveVariant = (listing: any, v: any) => !!v && v.type === 'retail' && v.status !== 'archived' && (!v.parentId || String(v.parentId) === String(listing?.id ?? ''));

/** A size a customer reads ("16 fl oz", "10 pack"), from the product's size and unit; null when there's none worth
 *  showing. */
export function sizeWords(item: any): string | null {
  const own = words(item?.sizeLabel, 30); if (own) return own;
  const n = Number(item?.size); const u = words(item?.unit, 16).toLowerCase();
  if (!(n > 0) || !u || ['each', 'unit', 'units', 'piece', 'pieces', 'pcs', 'ea', 'item', 'items', 'use', 'uses'].includes(u)) return null;
  return `${Math.round(n * 100) / 100} ${u}`;
}

export type WindowSwatch = { label: string; color: string | null; soldOut: boolean };
export type WindowProduct = {
  id: string; kind: 'product'; name: string; section: string; words: string | null; size: string | null;
  price: number; from: boolean; startPrice: number; imageUrl: string | null; soldOut: boolean; onHand: number;
  featured: boolean; badge: 'new' | 'limited' | null; prosOnly: boolean;
  /** The listing's shades or sizes when it has them (a color when the choice has one). */
  swatches: WindowSwatch[];
};

/** How a product shows on the window. `byId`: its variants (and anything else read). */
export function windowProductOf(id: string, listing: any, byId: Map<string, any> = new Map()): WindowProduct {
  const L = { ...listing, id };
  const vg = variantGroup(L);
  const swatches: WindowSwatch[] = []; const prices: number[] = []; let onHand = 0;
  if (vg && variantIdsOf(L).length) {
    for (const c of vg.choices) {
      const vid = pickedBy(L, c); const v = vid ? byId.get(vid) : L; const ok = vid ? liveVariant(L, v) : true;
      const n = ok ? onShelf(v) : 0; onHand += n;
      if (ok) prices.push(vid ? variantPriceCents(v, L, 'retail') : listingPriceCents(L, 'retail'));
      swatches.push({ label: words(c.label, 40), color: swatchOf((c as any).swatch), soldOut: n <= 0 });
    }
  } else onHand = onShelf(L);
  const own = listingPriceCents(L, 'retail');
  const low = prices.length ? Math.min(...prices) : own; const high = prices.length ? Math.max(...prices) : own;
  const imgs = Array.isArray(listing?.imageUrls) ? listing.imageUrls : [];
  return {
    id, kind: 'product', name: words(listing?.name, 80) || 'Product', section: words(listing?.category, 40) || 'Shop',
    words: words(listing?.onlineDescription || listing?.description, 160) || null, size: sizeWords(listing),
    price: Math.round(low) / 100, from: high > low, startPrice: Math.round(low) / 100,
    imageUrl: https(imgs[0]) || https(listing?.imageUrl), soldOut: onHand <= 0, onHand,
    featured: listing?.boardFeatured === true, badge: listing?.boardBadge === 'new' || listing?.boardBadge === 'limited' ? listing.boardBadge : null,
    prosOnly: listing?.prosOnly === true,
    swatches: swatches.slice(0, 40),
  };
}

/** The numbers on the board: the menu's own (lib/menu-numbers, unchanged by the window), then the window's products
 *  after them, category by category. */
export function boardNumbers(menu: Numbered[], products: { id: string; section: string }[]): Map<string, number> {
  const out = menuNumbers(menu); const n = out.size;
  for (const [id, k] of menuNumbers(products.map((p) => ({ id: p.id, section: p.section })))) if (!out.has(id)) out.set(id, n + k);
  return out;
}

/** The window's products grouped the way the board shows them: category by category in the order the list first
 *  reaches each, the business's order within each. */
export function windowSections(products: WindowProduct[]): { name: string; items: WindowProduct[] }[] {
  const out: { name: string; items: WindowProduct[] }[] = [];
  for (const p of products) { let s = out.find((x) => x.name === p.section); if (!s) out.push((s = { name: p.section, items: [] })); s.items.push(p); }
  return out;
}

/** The window as it is now: its products (those still on it and sellable at a window), each with its variants read. */
export async function readWindow(db: any, tenantId: string, tenant: any): Promise<WindowProduct[]> {
  const ids = windowIdsOf(tenant); if (!ids.length) return [];
  const T = `tenants/${tenantId}/inventory`;
  const getMany = async (list: string[]) => {
    const m = new Map<string, any>();
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100); if (!chunk.length) continue;
      const snaps: any[] = await db.getAll(...chunk.map((id) => db.doc(`${T}/${id}`)));
      snaps.forEach((s: any, k: number) => { if (s?.exists) m.set(chunk[k], s.data() || {}); });
    }
    return m;
  };
  const listings = await getMany(ids);
  const vids = Array.from(new Set(ids.flatMap((id) => (listings.has(id) ? variantIdsOf({ ...listings.get(id), id }) : [])).filter((v) => ID.test(v) && !listings.has(v))));
  const byId = new Map<string, any>([...listings, ...(await getMany(vids))]);
  const shown = ids.filter((id) => windowable(listings.get(id))).map((id) => windowProductOf(id, listings.get(id), byId));
  return windowSections(shown).flatMap((s) => s.items);
}
