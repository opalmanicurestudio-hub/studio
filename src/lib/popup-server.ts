// src/lib/popup-server.ts — A POP-UP'S PRODUCTS AS THE TABLE SELLS THEM (lib/popup), read from the records, never the
// screen: each one's name (a variant by its listing and choice: "Gel color, Berry"), its price, a photo, its number on
// the pickup window (lib/pickup-window), what's on hand, and how a cart names it (a variant goes in as its listing and
// choice, the way checkout sells it). Only the business's own products that can be sold: one archived, without a price,
// or not a product is left out.
import { choiceFor, variantIdsOf, variantPriceCents } from '@/lib/variants';
import { listingPriceCents } from '@/lib/retail-orders';
import { boardNumbers, readWindow } from '@/lib/pickup-window';
import { readMenu } from '@/lib/menu-server';

export type PopupProduct = {
  id: string; name: string; priceCents: number; imageUrl: string | null; number: number | null; onHand: number;
  prosOnly: boolean; cart: { productId: string; selections?: Record<string, string> };
};

const https = (v: unknown) => { const s = String(v ?? '').trim(); return /^https:\/\/[^\s"'<>]{4,1990}$/.test(s) ? s : null; };
const photoOf = (i: any) => https(Array.isArray(i?.imageUrls) ? i.imageUrls.find((x: any) => typeof x === 'string' && x.trim()) : null) || https(i?.imageUrl);
const sellable = (i: any) => !!i && i.type === 'retail' && i.status !== 'archived' && i.archived !== true && i.isActive !== false;

export async function popupProducts(db: any, tenantId: string, tenant: any, ids: string[], o: { numbers?: boolean } = {}): Promise<Map<string, PopupProduct>> {
  const out = new Map<string, PopupProduct>();
  const want = [...new Set((ids || []).map(String).filter((x) => /^[A-Za-z0-9_-]{1,120}$/.test(x)))].slice(0, 400);
  if (!want.length) return out;
  const inv = db.collection(`tenants/${tenantId}/inventory`);
  const read = async (list: string[]) => {
    const m = new Map<string, any>();
    for (let i = 0; i < list.length; i += 100) {
      const snaps = await db.getAll(...list.slice(i, i + 100).map((id) => inv.doc(id)));
      for (const s of snaps) if (s.exists) m.set(s.id, { ...(s.data() || {}), id: s.id });
    }
    return m;
  };
  const items = await read(want);
  const parents = await read([...new Set([...items.values()].map((i) => String(i.parentId || '')).filter((p) => p && !items.has(p)))]);
  const all = new Map([...parents, ...items]);
  let nums = new Map<string, number>();
  if (o.numbers !== false) {
    try { const [menu, products] = await Promise.all([readMenu(db, tenantId), readWindow(db, tenantId, tenant)]); nums = boardNumbers(menu, products); } catch { /* no numbers */ }
  }
  for (const id of want) { const p = describe(id, items, all, nums); if (p) out.set(id, p); }
  return out;
}

/** One product as the table sells it, or null when it can't be sold (see above). `own`: the products asked about;
 *  `all`: those and their listings. */
function describe(id: string, own: Map<string, any>, all: Map<string, any>, nums: Map<string, number>): PopupProduct | null {
  const i = own.get(id); if (!sellable(i)) return null;
  const listing = i.parentId && String(i.parentId) !== id ? all.get(String(i.parentId)) : null;
  if (i.parentId && String(i.parentId) !== id && (!listing || !sellable(listing))) return null;
  const c = listing ? choiceFor(listing, id) : null;
  if (listing && !c) return null;
  // (A listing with variants is sold by its variants: it isn't one on its own.)
  if (!listing && variantIdsOf(i).length) return null;
  const priceCents = listing ? variantPriceCents(i, listing, 'retail') : listingPriceCents(i, 'retail');
  if (!(priceCents > 0)) return null;
  return {
    id, name: c ? `${String(listing.name || i.name || 'Item').trim()}, ${c.choice.label}` : String(i.name || 'Item').trim(),
    priceCents, imageUrl: photoOf(i) || (listing ? photoOf(listing) : null),
    number: nums.get(listing ? String(listing.id) : id) ?? null,
    onHand: Math.max(0, Math.floor((Number(i.totalStock) || 0) - (Number(i.stockReserved) || 0))),
    prosOnly: i.prosOnly === true || listing?.prosOnly === true,
    cart: c ? { productId: String(listing.id), selections: { [c.group.id]: c.choice.id } } : { productId: id },
  };
}

/** Everything the business could bring to a pop-up, for setting one up: its products that can be sold, each variant as
 *  its own line, by name. Up to `max`. */
export async function popupCatalog(db: any, tenantId: string, max = 800): Promise<PopupProduct[]> {
  const snap = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'retail').limit(2000).get();
  const all = new Map<string, any>(snap.docs.map((d: any) => [d.id, { ...(d.data() || {}), id: d.id }]));
  const out: PopupProduct[] = [];
  for (const id of all.keys()) { const p = describe(id, all, all, new Map()); if (p) out.push(p); }
  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, max);
}
