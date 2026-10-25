// src/lib/shop-catalog.ts — WHAT THE SHOP SELLS, AS A SHOPPER SEES IT. One place that turns inventory into the public
// product list (prices, variants, stock shown, pre-orders, made to order), used by the shop's catalog, its product feed
// for Google and its guide for assistants, so all three always agree. Never exposes cost, batches, suppliers or exact
// large stock counts.
import { filesOf } from './digital-product';
import { listingPriceCents, preorderState, type SellableItem } from '@/lib/retail-orders';
import { listedInShop, listingBuyable, listingStock, shopOptionGroups, variantIdsOf } from '@/lib/variants';
import { publicDescription, collectImages } from '@/lib/product-public';
import { discountedCents } from '@/lib/retail-wholesale';
import { leadOf } from '@/lib/ship-promise';

export const MAX_SHOWN_QTY = 99; // never reveal exact large stock counts

// The fields the public shop reads from an inventory record (prices, choices, photos, words, stock, pre-orders, how it
// sells): what's kept in the server's short-lived cache, so a big catalog fits and cost, suppliers and notes never go in.
const KEEP = new Set(['id', 'type', 'name', 'status', 'showOnline', 'optionGroups', 'parentId', 'category', 'description', 'onlineDescription', 'howToUse', 'specs', 'includes',
  'imageUrl', 'imageUrls', 'images', 'videoUrl', 'photoUrl', 'sku', 'brand', 'gtin', 'upc', 'ean', 'barcode', 'barcodes', 'seoTitle', 'seoDescription', 'digital', 'finalSale', 'finalSaleCode', 'finalSaleReason',
  'isGiftCard', 'leadDays', 'allowBackorder', 'lowStockThreshold', 'totalStock', 'stockReserved', 'storeHoldback', 'batches', 'msrp', 'retailPriceCents', 'priceCents', 'price', 'soldFor', 'shipGroundOnly', 'documents', 'allocations']);
export function publicRow(item: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(item || {})) if (KEEP.has(k) || k.startsWith('preorder') || k.startsWith('wholesale')) out[k] = v;
  // Only what the stock and expiry rules read from each batch.
  // Units handed out to stations or booths aren't for sale (lib/retail-orders allocatedUnits): only each one's count.
  if (out.allocations && typeof out.allocations === 'object') out.allocations = Object.fromEntries(Object.entries(out.allocations).map(([k, v]: [string, any]) => [k, { qty: v?.qty }]));
  if (Array.isArray(out.batches)) out.batches = out.batches.map((b: any) => ({ stock: b?.stock, expirationDate: b?.expirationDate, expiryDate: b?.expiryDate }));
  // A download's files and link stay private: the cache only says whether it has something to give (lib/retail-orders).
  if (item?.digital === true) out.digitalReady = filesOf(item).length > 0 || !!String(item?.digitalUrl || '').trim();
  return out;
}

export function catalogProducts(all: SellableItem[], byId: Map<string, any>, listings: any, o: { wholesale: boolean; discountPct: number; zone: string }): any[] {
  return all
    .filter((item: SellableItem) => listedInShop(item, listings))
    .flatMap((item: SellableItem) => {
      // One malformed inventory doc must never take the whole shop down:
      // anything that throws here is skipped (and logged), not fatal.
      try {
        const available = listingStock(item, byId);
        // Each variant with the price it sells for and whether it can be bought; the listing shows its lowest price.
        const optionGroups = shopOptionGroups(item, byId, { wholesale: o.wholesale, discountPct: o.discountPct, zone: o.zone, maxShown: MAX_SHOWN_QTY });
        const vg: any = optionGroups.find((g: any) => g.variants);
        // The lowest price of what can be bought (else of its variants still in Inventory): a variant that's gone never
        // makes it "From $0.00".
        const liveCs: any[] = vg ? vg.choices.filter((c: any) => c.live !== false) : [];
        const pick = (k: 'priceCents' | 'wholesalePriceCents') => { const cs = liveCs.filter((c: any) => c.inStock); const xs = (cs.length ? cs : liveCs).map((c: any) => c[k]).filter((x: any) => x != null && x > 0); return xs.length ? Math.min(...xs) : null; };
        const hasVariants = variantIdsOf(item).length > 0;
        // Pre-orders sell BEFORE stock exists — that is the whole point — so a
        // grid that decides availability from the shelf alone marks an open
        // pre-order sold out, and the customer never reaches the
        // product page that knows better. The product endpoint already had
        // this rule; the catalog did not, so the two disagreed.
        const pre = item.preorder === true ? preorderState(item as any, o.zone) : null;
        const preOpen = pre?.open === true;
        const preCap = pre && pre.remaining !== null ? Math.max(0, pre.remaining) : MAX_SHOWN_QTY;
        return [{
        id: item.id,
        name: String(item.name || '').trim() || 'Item',
        category: String(item.category || '') || 'General',
        description: publicDescription(item).slice(0, 300),
        imageUrls: collectImages(item),
        optionGroups,
        priceCents: (vg && pick('priceCents')) ?? listingPriceCents(item, 'retail'),
        // Variants at different prices: the grid says "from".
        priceVaries: !!vg && new Set(liveCs.map((c: any) => c.priceCents)).size > 1,
        wholesalePriceCents: o.wholesale ? ((vg && pick('wholesalePriceCents')) ?? discountedCents(listingPriceCents(item, 'wholesale'), o.discountPct)) : null,
        wholesaleMinQty: o.wholesale ? item.wholesaleMinQty ?? 0 : null,
        inStock: hasVariants ? listingBuyable(item, byId, o.zone) : available > 0 || item.allowBackorder === true || preOpen || item.digital === true,
        qtyAvailable: hasVariants
          ? Math.min(MAX_SHOWN_QTY, vg ? vg.choices.reduce((n: number, c: any) => n + (Number(c.qtyAvailable) || 0), 0) : available)
          : item.allowBackorder === true || item.digital === true
          ? MAX_SHOWN_QTY
          : preOpen
            ? Math.min(Math.max(available, preCap), MAX_SHOWN_QTY)
            : Math.min(available, MAX_SHOWN_QTY),
        lowStock: available > 0 && available <= (item.lowStockThreshold ?? 0),
        // The cart cannot warn about something it was never told. Only the
        // OPEN state travels: a closed run is simply unavailable, and a
        // closed date is not a promise anyone should be shown at checkout.
        preorder: preOpen
          ? { open: true, etaAt: pre?.etaAt || null, closesAt: pre?.closesAt || null, remaining: pre?.remaining ?? null }
          : null,
        // Made to order: business days to ship, which the ship-by date at checkout counts from.
        leadDays: item.digital === true ? null : leadOf(item.leadDays),
        digital: item.digital === true,
        }];
      } catch (e: any) {
        console.error('[retail-catalog] skipped malformed item', item?.id, e?.message);
        return [];
      }
    })
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
}
