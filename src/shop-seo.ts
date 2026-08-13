// ─── src/lib/shop-seo.ts ─────────────────────────────────────────────────────
// What Google, Facebook and iMessage see when they look at a shop.
//
// The starting position was worse than nothing: every customer-facing page
// inherited the app's own title, so a shop's product pages showed up as
// "ClarityFlow — A comprehensive business management application for solo
// service professionals." Every share, every search result, every link
// preview. The product was invisible and the app was advertised instead.
//
// Two principles run through this file:
//
//   1. NEVER LEAVE IT BLANK. A shop owner should not have to write meta
//      descriptions to be findable. Everything falls back to copy that
//      already exists — the product name, the shop name, the description
//      they wrote for customers — and the hand-written fields only override.
//
//   2. NEVER CLAIM WHAT ISN'T TRUE. Structured data is a promise to a search
//      engine: a price it can show, a stock state it can trust. Google
//      penalises listings that lie about availability, so an out-of-stock
//      product says so rather than hoping for a click.

export interface SeoInput {
  shopName: string;
  productName?: string;
  description?: string;
  images?: string[];
  priceCents?: number | null;
  currency?: string;
  inStock?: boolean;
  sku?: string;
  brand?: string;
  url?: string;
  /** Hand-written overrides from the Online listing tab. */
  seoTitle?: string;
  seoDescription?: string;
}

/** Search results cut around 60 chars; write to the limit, not past it. */
export const SEO_TITLE_MAX = 60;
/** Descriptions cut around 155. */
export const SEO_DESC_MAX = 155;

export function clip(text: string, max: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  // Cut at a word, not mid-syllable — a truncated word reads like a bug.
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}\u2026`;
}

/** The <title> — hand-written if given, otherwise "Product · Shop". */
export function seoTitle(input: SeoInput): string {
  if (input.seoTitle?.trim()) return clip(input.seoTitle, SEO_TITLE_MAX);
  const parts = [input.productName, input.shopName].filter(Boolean) as string[];
  return clip(parts.join(' \u00b7 ') || 'Shop', SEO_TITLE_MAX);
}

/**
 * The description. Falls back to the copy she already wrote for customers,
 * because the best meta description is usually the first thing the page says.
 */
export function seoDescription(input: SeoInput): string {
  const source = input.seoDescription?.trim()
    || input.description?.trim()
    || [input.productName, input.shopName].filter(Boolean).join(' from ');
  return clip(source, SEO_DESC_MAX);
}

/**
 * Product structured data (schema.org), which is what earns a price and an
 * in-stock badge in a search result rather than a bare blue link.
 *
 * Omits what it doesn't know instead of guessing: no price means no offer
 * block, because an offer without a price is exactly the kind of malformed
 * markup that gets a site's rich results switched off.
 */
export function productJsonLd(input: SeoInput): Record<string, any> {
  const ld: Record<string, any> = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: input.productName || input.shopName,
    description: seoDescription(input),
  };
  if (input.images?.length) ld.image = input.images.slice(0, 6);
  if (input.sku) ld.sku = input.sku;
  if (input.brand || input.shopName) ld.brand = { '@type': 'Brand', name: input.brand || input.shopName };
  if (typeof input.priceCents === 'number' && input.priceCents > 0) {
    ld.offers = {
      '@type': 'Offer',
      price: (input.priceCents / 100).toFixed(2),
      priceCurrency: input.currency || 'USD',
      availability: input.inStock === false
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
      ...(input.url ? { url: input.url } : {}),
    };
  }
  return ld;
}

/** Shop-level structured data, for the storefront's own page. */
export function storeJsonLd(shopName: string, url: string, description?: string): Record<string, any> {
  return {
    '@context': 'https://schema.org/',
    '@type': 'Store',
    name: shopName,
    ...(url ? { url } : {}),
    ...(description ? { description: clip(description, SEO_DESC_MAX) } : {}),
  };
}
