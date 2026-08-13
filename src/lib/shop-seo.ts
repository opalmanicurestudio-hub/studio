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

/**
 * Booking-page structured data.
 *
 * The salon is the entity; services are what it offers. Modelled as a local
 * business with an offer catalog rather than a page of loose Service objects,
 * because "who and where" is the question a local search actually answers —
 * an assistant asked "where can I get a gel manicure near me on Saturday"
 * needs a business with an address and a way to book, not a floating service
 * with no home.
 *
 * Only services the shop shows publicly are listed. A private or internal
 * service appearing in search is a promise the shop never made.
 */
export function bookingJsonLd(input: {
  shopName: string;
  url?: string;
  description?: string;
  telephone?: string;
  address?: { street?: string; city?: string; region?: string; postalCode?: string; country?: string } | null;
  services?: { name: string; description?: string; price?: number; duration?: number }[];
  currency?: string;
}): Record<string, any> {
  const ld: Record<string, any> = {
    '@context': 'https://schema.org/',
    '@type': 'HealthAndBeautyBusiness',
    name: input.shopName,
    ...(input.url ? { url: input.url } : {}),
    ...(input.description ? { description: clip(input.description, SEO_DESC_MAX) } : {}),
    ...(input.telephone ? { telephone: input.telephone } : {}),
  };

  const a = input.address;
  if (a && (a.street || a.city)) {
    ld.address = {
      '@type': 'PostalAddress',
      ...(a.street ? { streetAddress: a.street } : {}),
      ...(a.city ? { addressLocality: a.city } : {}),
      ...(a.region ? { addressRegion: a.region } : {}),
      ...(a.postalCode ? { postalCode: a.postalCode } : {}),
      ...(a.country ? { addressCountry: a.country } : {}),
    };
  }

  const offers = (input.services || [])
    .filter((sv) => sv.name)
    .slice(0, 40)
    .map((sv) => ({
      '@type': 'Offer',
      itemOffered: {
        '@type': 'Service',
        name: sv.name,
        ...(sv.description ? { description: clip(sv.description, SEO_DESC_MAX) } : {}),
      },
      ...(typeof sv.price === 'number' && sv.price > 0
        ? { price: sv.price.toFixed(2), priceCurrency: input.currency || 'USD' }
        : {}),
    }));
  if (offers.length) {
    ld.hasOfferCatalog = { '@type': 'OfferCatalog', name: `${input.shopName} services`, itemListElement: offers };
  }
  if (input.url) {
    ld.potentialAction = {
      '@type': 'ReserveAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: input.url,
        actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'],
      },
      result: { '@type': 'Reservation', name: `Appointment at ${input.shopName}` },
    };
  }
  return ld;
}

/**
 * FAQ structured data.
 *
 * The questions a shop already answers on its page — "how long does it last?",
 * "do you take walk-ins?" — become answers a search engine can show directly,
 * and an assistant can speak aloud. This is the cheapest reach in the whole
 * file: the copy exists, it just isn't machine-readable yet.
 *
 * Google's rules are strict and worth honouring rather than gaming: the same
 * Q&A must be visible on the page, questions must be genuinely asked by
 * users, and marking up a page that has no visible FAQ is the kind of thing
 * that gets rich results turned off site-wide. So this returns null unless
 * there is something real to describe.
 */
export function faqJsonLd(
  items: { q?: string; a?: string; question?: string; answer?: string }[] | undefined,
): Record<string, any> | null {
  const pairs = (items || [])
    .map((it) => ({
      q: String(it.q ?? it.question ?? '').trim(),
      a: String(it.a ?? it.answer ?? '').trim(),
    }))
    .filter((p) => p.q && p.a)
    .slice(0, 10);
  if (pairs.length === 0) return null;
  return {
    '@context': 'https://schema.org/',
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question',
      name: p.q,
      acceptedAnswer: { '@type': 'Answer', text: p.a },
    })),
  };
}

/**
 * A single staff member's booking page.
 *
 * People search for a PERSON — "book with Kayla" — far more often than a
 * salon expects, and that page currently says the same thing as every other.
 * Modelled as the business's employee with their own booking action, so the
 * answer to "can I book with Kayla on Friday" has somewhere to point.
 */
export function staffBookingJsonLd(input: {
  shopName: string;
  staffName: string;
  role?: string;
  url?: string;
  imageUrl?: string;
}): Record<string, any> {
  return {
    '@context': 'https://schema.org/',
    '@type': 'Person',
    name: input.staffName,
    ...(input.role ? { jobTitle: input.role } : {}),
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
    worksFor: { '@type': 'HealthAndBeautyBusiness', name: input.shopName },
    ...(input.url ? {
      url: input.url,
      potentialAction: {
        '@type': 'ReserveAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: input.url,
          actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'],
        },
        result: { '@type': 'Reservation', name: `Appointment with ${input.staffName}` },
      },
    } : {}),
  };
}
