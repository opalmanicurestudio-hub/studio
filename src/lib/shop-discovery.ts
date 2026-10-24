// src/lib/shop-discovery.ts — HOW A SHOP IS FOUND: by search engines, by Google Shopping and by AI assistants.
// Pure functions (no reads), so every rule here is checked by scripts/verify/discovery.verify.ts:
//   - the facts a stranger may know about a shop (name, address, how it ships, its return window), from its settings;
//   - structured data for the shop, its products (one product, or a group of variants each at its own price), ratings,
//     returns and shipping, and its bundles;
//   - the product feed Google Merchant Center reads for free listings (one item per variant, at the price and stock
//     its page shows);
//   - a plain-text guide and a JSON feed for assistants.
// Two rules from lib/shop-seo hold everywhere: never leave a field blank when the shop already wrote the words, and
// never claim what isn't true (a price, a stock state or a policy the checkout and the returns flow wouldn't honor).
import { clip, SEO_DESC_MAX } from '@/lib/shop-seo';
import { asSold, canSell, pickedBy, variantGroup } from '@/lib/variants';
import { preorderState } from '@/lib/retail-orders';
import { groupSaving, productsOf, type Offer } from '@/lib/retail-offers';
import { finalSaleFor } from '@/lib/return-eligibility';
import { moduleEnabled } from '@/lib/modules';
import { linkOrigin } from '@/lib/app-origin';

export type ShopFacts = {
  tenantId: string; name: string; tagline: string; logoUrl: string; phone: string;
  address: { street: string; city: string; region: string; postalCode: string; country: string } | null;
  /** Can sell online at all: the Retail tool is on and payments are connected (checkout refuses every order without
   *  them, whatever Setup says). A paused shop is still listed: its products show as out of stock until it reopens,
   *  so a short pause doesn't send every item back through Google's review. */
  listed: boolean;
  paused: boolean;
  /** Listed and not paused: taking orders right now. */
  live: boolean;
  /** The owner's switch for the Google product feed (Setup, Search and assistants). */
  feed: boolean;
  pickup: boolean; shipping: boolean;
  flatShipCents: number; freeShipOverCents: number;
  /** days 0 = no time limit (as the returns flow reads it). Restocking fees capped at 50%, as returns caps them. */
  returns: { enabled: boolean; days: number; payer: 'shop' | 'customer' | 'fault'; newPct: number; openedPct: number; note: string };
  cancelHours: number | null;
};

const s = (v: any) => String(v ?? '').trim();
const cents = (dollars: any) => Math.max(0, Math.round((Number(dollars) || 0) * 100));
const pct50 = (v: any) => Math.min(50, Math.max(0, Math.floor(Number(v) || 0)));

/** The one address search engines, the feed and assistants are given, in the same order robots.txt and the booking
 *  pages use: the app's public address, else the production address. Never a business's own "public link" setting:
 *  that's free text for shared links, and nothing confirms it serves the shop. `t` is kept for when shops get
 *  verified domains of their own. */
export function seoOrigin(_t?: any, requestOrigin?: string | null): string {
  const set = String(process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/.+/.test(set) ? set : linkOrigin(null, requestOrigin || '');
}

/** What a stranger may know about a shop, from its own settings (the same switches checkout and returns read). */
export function shopFactsOf(tenantId: string, t: any): ShopFacts {
  const rs = t?.retailSettings || {}; const pol = rs.policies || {};
  const a = t?.address && typeof t.address === 'object' ? t.address : null;
  const fees = pol.restockingFees && typeof pol.restockingFees === 'object' ? pol.restockingFees : null;
  const listed = moduleEnabled(t, 'retail') && !!t?.stripeAccountId;
  const paused = rs.storePaused === true;
  return {
    tenantId,
    name: s(t?.businessName || t?.name) || 'Shop',
    tagline: s(rs.shopTagline || rs.shopBlurb || t?.tagline),
    logoUrl: /^https:\/\//.test(s(rs.logoUrl || t?.logoUrl)) ? s(rs.logoUrl || t?.logoUrl) : '',
    phone: s(t?.phone || t?.sms?.fromNumber),
    address: a && s(a.city) ? { street: s(a.street || a.line1), city: s(a.city), region: s(a.state || a.region), postalCode: s(a.postalCode || a.zip), country: s(a.country) || 'US' } : null,
    listed, paused, live: listed && !paused,
    feed: rs.productFeed !== false,
    pickup: rs.pickupEnabled !== false,
    shipping: rs.shippingOffered !== false && rs.shippingEnabled !== false,
    flatShipCents: cents(rs.flatShippingDollars),
    freeShipOverCents: cents(rs.freeShippingOverDollars),
    returns: {
      enabled: rs.returnsEnabled !== false,
      days: Math.max(0, Math.floor(Number(rs.returnWindowDays) || 0)),
      payer: rs.returnLabelPayer === 'shop' || rs.returnLabelPayer === 'customer' ? rs.returnLabelPayer : 'fault',
      newPct: pct50(fees ? fees.as_new : pol.restockingFeePct),
      openedPct: pct50(fees ? fees.opened : pol.restockingFeePct),
      note: clip(s(rs.returnPolicyText), 400),
    },
    cancelHours: pol.cancelAllowed === false ? null : Math.max(0, Math.floor(Number(pol.cancelWindowHours) || 0)),
  };
}

export const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const usd = (c: number) => `${(Math.max(0, c) / 100).toFixed(2)} USD`;

/** A real GTIN (UPC, EAN, ITF-14): 8, 12, 13 or 14 digits with a valid check digit. A wrong one gets a feed item refused. */
export function validGtin(code: any): string {
  const d = s(code).replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(d)) return '';
  const digits = d.split('').map(Number); const check = digits.pop() as number;
  const sum = digits.reverse().reduce((n, x, i) => n + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? d : '';
}

/** The first valid GTIN on an inventory item (any of the places a barcode is kept). */
export function gtinOf(item: any): string {
  const xs = [item?.gtin, item?.upc, item?.ean, item?.barcode, ...(Array.isArray(item?.barcodes) ? item.barcodes : [])];
  for (const x of xs) { const g = validGtin(typeof x === 'object' && x ? x.code : x); if (g) return g; }
  return '';
}

/**
 * Whether one thing can be bought online right now, as checkout sells it: on the shelf first, then an open pre-order
 * run (with its date), then sold ahead of stock. A closed run is simply out of stock.
 */
export function availabilityOf(item: any, zone?: string | null, notSelling = false): { state: 'in_stock' | 'preorder' | 'backorder' | 'out_of_stock'; date: string } {
  if (notSelling) return { state: 'out_of_stock', date: '' };
  if (item?.digital === true) return { state: 'in_stock', date: '' };   // a download is never out of stock
  if (canSell(item) > 0) return { state: 'in_stock', date: '' };
  if (item?.preorder === true) { const p = preorderState(item, zone); if (p.open) return { state: 'preorder', date: isoDate(p.etaAt) }; }
  if (item?.allowBackorder === true) return { state: 'backorder', date: '' };
  return { state: 'out_of_stock', date: '' };
}
const isoDate = (v: any) => { const t = Date.parse(s(v)); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

// ─── Structured data ──────────────────────────────────────────────────────────

const postal = (a: ShopFacts['address']) => a ? { '@type': 'PostalAddress', streetAddress: a.street || undefined, addressLocality: a.city, addressRegion: a.region || undefined, postalCode: a.postalCode || undefined, addressCountry: a.country } : undefined;

/** The shop as a business (a shop with an address is a local store; without one, an online store). */
export function shopJsonLd(f: ShopFacts, origin: string): Record<string, any>[] {
  const url = `${origin}/shop/${f.tenantId}`;
  const store: Record<string, any> = { '@context': 'https://schema.org/', '@type': f.address ? 'Store' : 'OnlineStore', '@id': `${url}#store`, name: f.name, url };
  if (f.tagline) store.description = clip(f.tagline, SEO_DESC_MAX);
  if (f.logoUrl) { store.logo = f.logoUrl; store.image = f.logoUrl; }
  if (f.phone) store.telephone = f.phone;
  if (f.address) store.address = postal(f.address);
  if (f.listed) store.hasMerchantReturnPolicy = returnPolicyLd(f);
  const site = { '@context': 'https://schema.org/', '@type': 'WebSite', '@id': `${url}#site`, name: f.name, url };
  return [store, site];
}

/** The return policy, as the returns flow applies it. `finalSale`: this item can't come back (a download, a gift card,
 *  anything marked final sale). */
export function returnPolicyLd(f: ShopFacts, finalSale = false): Record<string, any> {
  if (!f.returns.enabled || finalSale) return { '@type': 'MerchantReturnPolicy', applicableCountry: 'US', returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' };
  const ld: Record<string, any> = {
    '@type': 'MerchantReturnPolicy', applicableCountry: 'US',
    ...(f.returns.days > 0 ? { returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow', merchantReturnDays: f.returns.days } : { returnPolicyCategory: 'https://schema.org/MerchantReturnUnlimitedWindow' }),
    returnMethod: [...(f.shipping ? ['https://schema.org/ReturnByMail'] : []), ...(f.pickup ? ['https://schema.org/ReturnInStore'] : [])],
    returnFees: f.returns.payer === 'shop' ? 'https://schema.org/FreeReturn' : 'https://schema.org/ReturnFeesCustomerResponsibility',
  };
  if (!ld.returnMethod.length) delete ld.returnMethod;
  if (f.returns.newPct > 0) ld.restockingFee = f.returns.newPct;
  return ld;
}

/** What shipping one item costs (free once it alone passes the free-delivery amount), or null when it doesn't ship. */
export function shippingLd(f: ShopFacts, priceCents: number): Record<string, any> | null {
  if (!f.shipping) return null;
  const free = f.freeShipOverCents > 0 && priceCents >= f.freeShipOverCents;
  return { '@type': 'OfferShippingDetails', shippingRate: { '@type': 'MonetaryAmount', value: ((free ? 0 : f.flatShipCents) / 100).toFixed(2), currency: 'USD' }, shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' } };
}

export function ratingLd(average: number, count: number): Record<string, any> | null {
  if (!(count > 0) || !(average >= 1)) return null;
  return { '@type': 'AggregateRating', ratingValue: Math.round(average * 10) / 10, reviewCount: count, bestRating: 5, worstRating: 1 };
}

export function breadcrumbLd(trail: { name: string; url: string }[]): Record<string, any> {
  return { '@context': 'https://schema.org/', '@type': 'BreadcrumbList', itemListElement: trail.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, item: x.url })) };
}

const SCHEMA_AVAIL: Record<string, string> = { in_stock: 'https://schema.org/InStock', preorder: 'https://schema.org/PreOrder', backorder: 'https://schema.org/BackOrder', out_of_stock: 'https://schema.org/OutOfStock' };

/** One offer, with what a result can show beyond the price: condition, seller, returns (none for final sale) and
 *  shipping (none for a download). */
function offerLd(f: ShopFacts, o: { priceCents: number; url?: string; state: string; date?: string; finalSale: boolean; digital: boolean }): Record<string, any> {
  const ship = o.digital ? null : shippingLd(f, o.priceCents);
  return { '@type': 'Offer', price: (o.priceCents / 100).toFixed(2), priceCurrency: 'USD', availability: SCHEMA_AVAIL[o.state] || SCHEMA_AVAIL.out_of_stock, ...(o.date ? { availabilityStarts: o.date } : {}), ...(o.url ? { url: o.url } : {}),
    itemCondition: 'https://schema.org/NewCondition', seller: { '@type': 'Organization', name: f.name }, hasMerchantReturnPolicy: returnPolicyLd(f, o.finalSale), ...(ship ? { shippingDetails: ship } : {}) };
}

/** A single product's result: price and stock as the page shows them, plus barcode and rating. */
export function productLd(f: ShopFacts, item: any, o: { url: string; name: string; description: string; images: string[]; priceCents: number; zone?: string | null; rating?: { average: number; count: number } | null; brand?: string }): Record<string, any> {
  const ld: Record<string, any> = { '@context': 'https://schema.org/', '@type': 'Product', name: o.name, description: clip(o.description || `${o.name} from ${f.name}`, SEO_DESC_MAX), url: o.url, brand: { '@type': 'Brand', name: s(o.brand) || f.name } };
  if (o.images.length) ld.image = o.images.slice(0, 6);
  if (s(item?.sku)) ld.sku = s(item.sku);
  const g = gtinOf(item); if (g) ld.gtin = g;
  const r = o.rating ? ratingLd(o.rating.average, o.rating.count) : null; if (r) ld.aggregateRating = r;
  if (o.priceCents > 0) { const a = availabilityOf(item, o.zone, !f.live); ld.offers = offerLd(f, { priceCents: o.priceCents, url: o.url, state: a.state, date: a.date, finalSale: !!finalSaleFor(item), digital: item?.digital === true }); }
  return ld;
}

/**
 * A listing sold in variants: a product group, each variant its own product at its own price, stock and barcode,
 * linking to the listing with that variant picked (the same address the feed gives Google, so the price Google checks
 * on the page is the variant's, not the listing's lowest).
 * `choices`: the listing's variants group as the shop sends it (lib/variants shopOptionGroups).
 */
export function productGroupLd(f: ShopFacts, listing: any, byId: Map<string, any>, choices: any[], o: { url: string; name: string; description: string; images: string[]; zone?: string | null; rating?: { average: number; count: number } | null; brand?: string }): Record<string, any> | null {
  const group = variantGroup(listing); if (!group) return null;
  const variants = choices.filter((c: any) => c.live !== false && c.priceCents > 0).map((c: any) => {
    const rc = group.choices.find((x: any) => x.id === c.id); const vid = rc ? pickedBy(listing, rc) : '';
    const v = vid ? asSold(listing, byId.get(vid) || {}) : listing;
    const url = `${o.url}?choice=${encodeURIComponent(c.id)}`;
    const a = availabilityOf(v, o.zone, !f.live);
    const raw = vid ? byId.get(vid) || {} : {};
    const own = (Array.isArray(raw.imageUrls) ? raw.imageUrls : raw.imageUrl ? [raw.imageUrl] : []).filter((u: any) => /^https:\/\//.test(String(u)));
    const p: Record<string, any> = { '@type': 'Product', name: `${o.name} - ${s(c.label)}`, url, ...(vid && s(raw.sku) ? { sku: s(raw.sku) } : {}), ...((own.length || o.images.length) ? { image: (own.length ? own : o.images).slice(0, 4) } : {}),
      offers: offerLd(f, { priceCents: c.priceCents, url, state: a.state, date: a.date, finalSale: !!finalSaleFor(v), digital: v?.digital === true }) };
    const g = vid ? gtinOf(byId.get(vid)) : ''; if (g) p.gtin = g;
    return p;
  });
  if (!variants.length) return null;
  const varies = variesByOf(group.name);
  const ld: Record<string, any> = { '@context': 'https://schema.org/', '@type': 'ProductGroup', name: o.name, description: clip(o.description || `${o.name} from ${f.name}`, SEO_DESC_MAX), url: o.url, productGroupID: s(listing.id), brand: { '@type': 'Brand', name: s(o.brand) || f.name }, ...(varies ? { variesBy: [varies] } : {}), hasVariant: variants };
  if (o.images.length) ld.image = o.images.slice(0, 6);
  const r = o.rating ? ratingLd(o.rating.average, o.rating.count) : null; if (r) ld.aggregateRating = r;
  return ld;
}

/** What a variants group varies by, as Google accepts it (schema.org's own list), or '' to leave it out. */
export function variesByOf(groupName: any): string {
  const n = s(groupName).toLowerCase();
  if (/colou?r|shade|tone|hue|finish/.test(n)) return 'https://schema.org/color';
  if (/size|fit|length|width|volume|ml|oz|weight|capacity/.test(n)) return 'https://schema.org/size';
  if (/material|fabric/.test(n)) return 'https://schema.org/material';
  if (/pattern|print/.test(n)) return 'https://schema.org/pattern';
  return '';
}

/** What an offer saves, in words a shopper and an assistant both read. */
export function offerSaving(o: Offer): string {
  if (o.kind === 'box') return (o.tiers || []).map((t) => `pick ${t.count}, save ${t.pct}%`).join('; ');
  const v = Number(o.save?.value) || 0;
  if (!o.save || v <= 0) return '';
  return o.save.type === 'pct' ? `save ${v}%` : o.save.type === 'off' ? `save ${money(v)}` : `set price ${money(v)}`;
}

/** Offers that have a page of their own (bought-together picks only show on their product's page). */
export const hasOwnPage = (o: { kind?: string } | null | undefined) => !!o && o.kind !== 'together';

/** A set's price as checkout charges it: every item at its own price, less the set saving. 0 when it can't be priced. */
export function setPriceCents(o: Offer, products: Map<string, any>): number {
  if (o.kind === 'box') return 0;
  const lines = [...(o.anchorId ? [{ productId: o.anchorId, qty: 1 }] : []), ...o.items];
  let group = 0;
  for (const l of lines) { const p = products.get(String(l.productId)); if (!p || !(p.priceCents > 0) || p.priceVaries) return 0; group += p.priceCents * Math.max(1, Number(l.qty) || 1); }
  return group - groupSaving(o.save, group);
}

/** A bundle or kit page: a set with a fixed total is one product at that price; a box or look is the list of what's in it. */
export function offerJsonLd(o: Offer & { groupsLeft?: number | null }, products: Map<string, any>, f: ShopFacts, url: string, byId?: Map<string, any>): Record<string, any> | null {
  const list = productsOf(o).map((id) => products.get(String(id))).filter(Boolean);
  if (!list.length || !hasOwnPage(o)) return null;
  const host = hostOf(url);
  const total = o.kind === 'set' ? setPriceCents(o, products) : 0;
  if (total > 0) {
    // As many whole sets as stock allows (lib/retail-offers groupsAvailable, worked out by publicOffer).
    const inStock = f.live && (o.groupsLeft == null ? list.every((p: any) => p.inStock !== false) : o.groupsLeft > 0);
    return { '@context': 'https://schema.org/', '@type': 'Product', name: s(o.name), description: clip(s(o.blurb) || `${s(o.name)} from ${f.name}`, SEO_DESC_MAX), url,
      ...(o.photoUrl ? { image: [o.photoUrl] } : {}), brand: { '@type': 'Brand', name: f.name },
      isRelatedTo: list.slice(0, 10).map((p: any) => ({ '@type': 'Product', name: p.name, url: `${host}/shop/${f.tenantId}/product/${p.id}` })),
      offers: offerLd(f, { priceCents: total, url, state: inStock ? 'in_stock' : 'out_of_stock', finalSale: list.some((p: any) => p.digital || !!finalSaleFor(byId?.get(String(p.id)))), digital: list.every((p: any) => p.digital) }) };
  }
  return { '@context': 'https://schema.org/', '@type': 'ItemList', name: s(o.name), url, itemListElement: list.slice(0, 30).map((p: any, i: number) => ({ '@type': 'ListItem', position: i + 1, url: `${host}/shop/${f.tenantId}/product/${p.id}`, name: p.name })) };
}
const hostOf = (url: string) => { const m = /^(https?:\/\/[^/]+)/.exec(url); return m ? m[1] : ''; };

// ─── The Google Merchant Center feed ─────────────────────────────────────────

export function xmlEscape(v: any): string {
  return s(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export type FeedItem = { id: string; groupId: string | null; title: string; description: string; link: string; images: string[]; priceCents: number; availability: 'in_stock' | 'preorder' | 'out_of_stock'; availabilityDate: string; gtin: string; mpn: string; brand: string; category: string; shippingCents: number };

/** Why a shop has no feed, or '' when it has one (shown to the owner). */
export function feedProblem(f: ShopFacts): string {
  if (!f.listed) return 'Your shop needs payments connected before Google can list it.';
  if (!f.feed) return 'The feed is switched off.';
  if (!f.shipping) return 'Google Shopping lists products that ship. Your shop is pickup only, so it has no feed for now.';
  return '';
}

/**
 * One feed item per thing that can be bought at one price: a plain product, or each variant of a listing, grouped by
 * the listing and linking to it with that variant picked, at the variant's own price and stock (the price Google
 * checks on the page). Left out: downloads, anything unpriced, a pre-order with no date and something sold ahead of
 * stock (Google needs a date for both, and the shop doesn't promise one). While paused, everything shows out of stock.
 */
export function feedItems(f: ShopFacts, originUrl: string, products: any[], byId: Map<string, any>, zone?: string | null): FeedItem[] {
  if (feedProblem(f)) return [];
  const base = `${originUrl}/shop/${f.tenantId}/product/`;
  const shipOf = (c: number) => (f.freeShipOverCents > 0 && c >= f.freeShipOverCents) ? 0 : f.flatShipCents;
  const out: FeedItem[] = [];
  const push = (x: Omit<FeedItem, 'availability' | 'availabilityDate'>, sold: any) => {
    if (sold?.digital === true || !(x.priceCents > 0)) return;
    const a = availabilityOf(sold, zone, f.paused);
    if (a.state === 'backorder' || (a.state === 'preorder' && !a.date)) return;
    out.push({ ...x, availability: a.state, availabilityDate: a.date });
  };
  for (const p of products) {
    if (p.digital) continue;
    const raw = byId.get(String(p.id)) || {};
    const brand = s(raw.brand) || f.name;
    // A part number only for the shop's own products: its SKU means nothing for another maker's.
    const ownBrand = !s(raw.brand) || s(raw.brand).toLowerCase() === f.name.toLowerCase();
    const common = { title: clip(s(raw.seoTitle) || s(p.name), 150), description: clip(s(raw.seoDescription) || s(p.description) || `${s(p.name)} from ${f.name}`, 5000), images: (p.imageUrls || []).filter((u: string) => /^https:\/\//.test(u)).slice(0, 11), brand, category: s(p.category) };
    const vg = (p.optionGroups || []).find((g: any) => g.variants);
    const rawGroup = variantGroup(raw);
    if (vg && rawGroup) {
      for (const c of vg.choices) {
        if (c.live === false) continue;
        const rc = rawGroup.choices.find((x: any) => x.id === c.id); const vid = rc ? pickedBy(raw, rc) : '';
        const v = vid ? byId.get(vid) || {} : raw; const sold = vid ? asSold(raw, v) : raw;
        push({ ...common, id: vid || `${p.id}-${c.id}`, groupId: String(p.id), title: clip(`${common.title} - ${s(c.label)}`, 150), link: `${base}${encodeURIComponent(String(p.id))}?choice=${encodeURIComponent(c.id)}`, priceCents: c.priceCents,
          gtin: gtinOf(v), mpn: ownBrand ? s(v.sku) : '', shippingCents: shipOf(c.priceCents),
          images: [...(Array.isArray(v.imageUrls) ? v.imageUrls : v.imageUrl ? [v.imageUrl] : []).filter((u: string) => /^https:\/\//.test(u)), ...common.images].filter((u, i, a) => a.indexOf(u) === i).slice(0, 11) }, sold);
      }
      continue;
    }
    push({ ...common, id: String(p.id), groupId: null, link: base + encodeURIComponent(String(p.id)), priceCents: p.priceCents, gtin: gtinOf(raw), mpn: ownBrand ? s(raw.sku) : '', shippingCents: shipOf(p.priceCents) }, raw);
  }
  return out;
}

/** The RSS 2.0 feed Google Merchant Center fetches on a schedule (free listings on Google Shopping and Search). */
export function merchantFeedXml(f: ShopFacts, originUrl: string, items: FeedItem[]): string {
  const shopUrl = `${originUrl}/shop/${f.tenantId}`;
  const tag = (k: string, v: any) => (s(v) ? `<g:${k}>${xmlEscape(v)}</g:${k}>` : '');
  const rows = items.map((x) => [
    '<item>',
    tag('id', x.id), `<title>${xmlEscape(x.title)}</title>`, `<description>${xmlEscape(x.description)}</description>`, `<link>${xmlEscape(x.link)}</link>`,
    tag('image_link', x.images[0]), ...x.images.slice(1).map((u) => tag('additional_image_link', u)),
    tag('availability', x.availability), tag('availability_date', x.availability === 'preorder' ? x.availabilityDate : ''),
    tag('price', usd(x.priceCents)), tag('condition', 'new'), tag('brand', x.brand),
    x.gtin ? tag('gtin', x.gtin) : x.mpn ? tag('mpn', x.mpn) : tag('identifier_exists', 'no'),
    tag('item_group_id', x.groupId), tag('product_type', x.category),
    `<g:shipping><g:country>US</g:country><g:price>${usd(x.shippingCents)}</g:price></g:shipping>`,
    '</item>',
  ].filter(Boolean).join(''));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${xmlEscape(f.name)}</title><link>${xmlEscape(shopUrl)}</link><description>${xmlEscape(f.tagline || `Products from ${f.name}`)}</description>\n${rows.join('\n')}\n</channel></rss>\n`;
}

// ─── For AI assistants ───────────────────────────────────────────────────────

export function policyLines(f: ShopFacts): string[] {
  const out: string[] = [];
  if (f.shipping) out.push(f.freeShipOverCents > 0 ? `Shipping: ${money(f.flatShipCents)} flat, free on orders of ${money(f.freeShipOverCents)} or more (before any bundle savings).` : `Shipping: ${money(f.flatShipCents)} flat.`);
  if (f.pickup) out.push('Pickup: free, at the shop. Choose pickup at checkout.');
  if (!f.returns.enabled) out.push('Returns: this shop does not take returns, except for items that arrive damaged or wrong.');
  else {
    const fees = [f.returns.newPct > 0 ? `${f.returns.newPct}% on unopened items` : '', f.returns.openedPct > 0 ? `${f.returns.openedPct}% on opened items` : ''].filter(Boolean);
    out.push(`Returns: ${f.returns.days > 0 ? `within ${f.returns.days} days of delivery or pickup` : 'no time limit'}, for a refund or an exchange. Downloads, gift cards and items marked final sale can't be returned.${f.returns.payer === 'shop' ? ' Return shipping is free.' : f.returns.payer === 'customer' ? ' The customer pays return shipping.' : ' Return shipping is free when the shop made a mistake.'}${fees.length ? ` Restocking fee: ${fees.join(', ')}.` : ''}`);
    if (f.returns.note) out.push(`In the shop's words: ${f.returns.note}`);
  }
  out.push('Bundles: every item keeps its own price; the bundle saving comes off as one line at checkout. Promo codes do not take money off items already in a bundle (free-shipping codes still apply).');
  if (f.cancelHours !== null) out.push(f.cancelHours > 0 ? `Cancelling: online within ${f.cancelHours} hours of paying.` : 'Cancelling: online until packing starts.');
  return out;
}

/** A product's choices for an assistant: each variant with its own price and whether it can be bought; dead ones left out. */
const choicesOf = (p: any) => (p.optionGroups || []).map((g: any) => g.variants
  ? { name: s(g.name), options: g.choices.filter((c: any) => c.live !== false).map((c: any) => ({ label: s(c.label), price: Math.round(Number(c.priceCents) || 0) / 100, inStock: !!c.inStock })) }
  : { name: s(g.name), options: g.choices.map((c: any) => ({ label: s(c.label), priceAdded: Math.round(Number(c.deltaCents) || 0) / 100 })) });

/** The shop's data for an assistant: products with live prices and stock, bundles, policies and where to buy. */
export function shopAgentJson(f: ShopFacts, originUrl: string, products: any[], offers: any[]) {
  const base = `${originUrl}/shop/${f.tenantId}`;
  const show = f.listed;
  return {
    ok: true, code: 'ok', updatedAt: new Date().toISOString(),
    shop: { id: f.tenantId, name: f.name, tagline: f.tagline || null, url: base, open: f.live, address: f.address, phone: f.phone || null, pickup: f.pickup, shipping: f.shipping },
    products: show ? products.filter((p) => p.priceCents > 0).map((p) => ({
      id: String(p.id), name: s(p.name), category: s(p.category) || null, description: s(p.description).slice(0, 300) || null,
      price: Math.round(p.priceCents) / 100, priceIsFrom: !!p.priceVaries, inStock: f.live && !!p.inStock, preorder: !!p.preorder, digital: !!p.digital,
      choices: choicesOf(p), image: (p.imageUrls || [])[0] || null, url: `${base}/product/${encodeURIComponent(String(p.id))}`,
    })) : [],
    bundles: show ? offers.filter(hasOwnPage).map((o: any) => ({ id: String(o.id), kind: o.kind, name: s(o.name), saving: offerSaving(o) || null, url: `${base}/offer/${encodeURIComponent(String(o.id))}` })) : [],
    policies: policyLines(f),
    howToBuy: { note: f.live ? 'Send the customer the product or bundle link; they add it to their bag and pay at checkout themselves. Assistants never place orders or take payment.' : 'The shop is paused and not taking orders right now. The customer can browse and come back.', shop: base },
    rules: ['Use the prices, stock and policies here; never invent them.', 'Prices are in US dollars, before tax and delivery.', 'Only the customer can place, change or cancel their own order.'],
  };
}

export function shopGuideText(f: ShopFacts, originUrl: string, products: any[], offers: any[], bookingUrl: string | null): string {
  const base = `${originUrl}/shop/${f.tenantId}`;
  const L: string[] = [`# ${f.name}`, ''];
  if (f.tagline) L.push(`> ${f.tagline}`, '');
  if (!f.listed) { L.push('The online shop is not open right now.', ''); if (bookingUrl) L.push(`Bookings: ${bookingUrl}`, ''); return L.join('\n'); }
  if (f.paused) L.push('The shop is paused and not taking orders right now. Prices below are for when it reopens.', '');
  L.push('## Links', '', `- Shop: ${base}`, `- All products: ${base}/catalog`, `- Data for assistants (JSON): ${originUrl}/api/agents/${f.tenantId}/shop`);
  if (!feedProblem(f)) L.push(`- Product feed (Google Merchant format): ${base}/feed.xml`);
  if (bookingUrl) L.push(`- Book a service: ${bookingUrl}`);
  L.push('');
  if (f.address) L.push('## Where', '', [f.address.street, f.address.city, f.address.region, f.address.postalCode].filter(Boolean).join(', '), '');
  L.push('## Policies', '', ...policyLines(f).map((x) => `- ${x}`), '');
  const sellable = products.filter((p) => p.priceCents > 0);
  const cats = new Map<string, any[]>(); for (const p of sellable) { const k = s(p.category) || 'General'; cats.set(k, [...(cats.get(k) || []), p]); }
  L.push('## Products', '');
  for (const [cat, ps] of [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    L.push(`### ${cat}`, '');
    for (const p of ps.slice(0, 200)) L.push(`- [${s(p.name)}](${base}/product/${encodeURIComponent(String(p.id))}): ${p.priceVaries ? 'from ' : ''}${money(p.priceCents)}${!f.live ? '' : p.preorder ? ', pre-order' : p.inStock ? '' : ', sold out'}${s(p.description) ? ` — ${clip(s(p.description), 140)}` : ''}`);
    L.push('');
  }
  const own = offers.filter(hasOwnPage);
  if (own.length) { L.push('## Bundles and kits', ''); for (const o of own) L.push(`- [${s(o.name)}](${base}/offer/${encodeURIComponent(String(o.id))})${offerSaving(o) ? `: ${offerSaving(o)}` : ''}`); L.push(''); }
  L.push('## Rules for assistants', '', '- Use the prices, stock and policies here; never invent them.', '- Send the customer a link; only they add to the bag and pay.', '');
  return L.join('\n');
}
