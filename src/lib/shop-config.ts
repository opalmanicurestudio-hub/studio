// ─── src/lib/shop-config.ts ───────────────────────────────────────────────────
// The PURE config layer of the shop landing system: section types, defaults,
// and sanitizeShopConfig. Deliberately has NO 'use client' and NO React/JSX
// imports so SERVER code (the catalog route) can import it — a 'use client'
// module's exports become client references in Next 15 and throw
// "Attempted to call sanitizeShopConfig() from the server" when invoked in a
// route handler. The client renderer (shop-sections.tsx) re-exports all of
// this, so existing imports keep working unchanged.

export type ShopSectionType =
  'hero' | 'drop' | 'featured' | 'banner' | 'story' | 'testimonials' |
  'policies' | 'locator' | 'faq' | 'marquee';

export interface ShopSection {
  id: string;
  type: ShopSectionType;
  enabled: boolean;
  layout?: string;
  props: Record<string, any>;
}

export interface ShopPageConfig {
  sections: ShopSection[];
}

export interface ShopSectionProduct {
  id: string;
  name: string;
  priceCents: number;
  imageUrls: string[];
  inStock: boolean;
}

export const SHOP_SECTION_DEFS: Record<ShopSectionType, {
  label: string;
  hint: string;
  layouts: { id: string; label: string }[];
  defaults: Record<string, any>;
}> = {
  hero: {
    label: 'Hero',
    hint: 'The sales headline at the top',
    layouts: [
      { id: 'split', label: 'Split' },
      { id: 'centered', label: 'Centered' },
      { id: 'immersive', label: 'Immersive' },
    ],
    defaults: {
      headline: 'Your favorites, ready today',
      subhead: 'Order online — pick up in minutes or have it shipped to your door.',
      imageUrl: '',
      ctaLabel: 'Shop now',
    },
  },
  drop: {
    label: 'Drop Countdown',
    hint: 'Count down to a launch or sale',
    layouts: [
      { id: 'band', label: 'Band' },
      { id: 'card', label: 'Card' },
    ],
    defaults: {
      title: 'New drop landing soon',
      endsAt: '',
      endedText: 'It\u2019s live — shop the drop below!',
    },
  },
  featured: {
    label: 'Featured Products',
    hint: 'Hand-pick up to 4 to spotlight',
    layouts: [
      { id: 'row', label: 'Row' },
      { id: 'duo', label: 'Big Duo' },
    ],
    defaults: { title: 'Featured', productIds: [] },
  },
  banner: {
    label: 'CTA Banner',
    hint: 'A bold strip that sells one thing',
    layouts: [
      { id: 'solid', label: 'Solid' },
      { id: 'outline', label: 'Outline' },
    ],
    defaults: { text: 'Free counter pickup — ready fast', ctaLabel: 'Browse everything' },
  },
  story: {
    label: 'Story',
    hint: 'Image + your why',
    layouts: [
      { id: 'imageLeft', label: 'Image Left' },
      { id: 'imageRight', label: 'Image Right' },
    ],
    defaults: {
      title: 'Made for people who care about the details',
      body: 'Every product in this shop is one we use ourselves, every day.',
      imageUrl: '',
    },
  },
  testimonials: {
    label: 'Testimonials',
    hint: 'Social proof strip',
    layouts: [{ id: 'strip', label: 'Strip' }],
    defaults: {
      title: 'Loved by our clients',
      quotes: [{ quote: 'The pickup flow is unreal — ordered on my lunch break, grabbed it after work.', name: 'A happy regular' }],
    },
  },
  policies: {
    label: 'Fulfillment Policies',
    hint: 'Pickup, curbside & shipping promises',
    layouts: [
      { id: 'trio', label: 'Three Cards' },
      { id: 'stacked', label: 'Stacked' },
    ],
    defaults: {
      title: 'How you get it',
      pickupText: 'Counter pickup — usually ready within the hour. Show your QR, grab and go.',
      curbsideText: 'Curbside — tap "I’m here" and we bring it to your car.',
      shippingText: 'Shipping — orders pack same-day and ship with tracking.',
    },
  },
  locator: {
    label: 'Store Locator',
    hint: 'Address, hours & directions',
    layouts: [
      { id: 'card', label: 'Card' },
      { id: 'banner', label: 'Banner' },
    ],
    defaults: {
      title: 'Find us',
      address: '',
      hours: '',
      phone: '',
      mapsUrl: '',
    },
  },
  faq: {
    label: 'FAQ',
    hint: 'Answer objections before they stall a sale',
    layouts: [{ id: 'accordion', label: 'Accordion' }],
    defaults: {
      title: 'Questions, answered',
      items: [{ q: 'How fast is pickup?', a: 'Most orders are ready within the hour during business hours.' }],
    },
  },
  marquee: {
    label: 'Animated Banner',
    hint: 'Scrolling ticker that never stops selling',
    layouts: [
      { id: 'scroll', label: 'Scroll' },
      { id: 'fast', label: 'Fast Scroll' },
      { id: 'pulse', label: 'Pulse' },
    ],
    defaults: { text: 'Free counter pickup · Same-day curbside · Ships with tracking' },
  },
};

export function newShopSection(type: ShopSectionType): ShopSection {
  const def = SHOP_SECTION_DEFS[type];
  return {
    id: `sec-${Math.random().toString(36).slice(2, 9)}`,
    type,
    enabled: true,
    layout: def.layouts[0]?.id,
    props: JSON.parse(JSON.stringify(def.defaults)),
  };
}

export function defaultShopConfig(): ShopPageConfig {
  return { sections: [] };
}

export function sanitizeShopConfig(raw: any): ShopPageConfig {
  const sections = Array.isArray(raw?.sections) ? raw.sections : [];
  return {
    sections: sections
      .filter((s: any) => s && typeof s === 'object' && SHOP_SECTION_DEFS[s.type as ShopSectionType])
      .slice(0, 16)
      .map((s: any) => ({
        id: String(s.id || `sec-${Math.random().toString(36).slice(2, 9)}`),
        type: s.type as ShopSectionType,
        enabled: s.enabled !== false,
        layout: typeof s.layout === 'string' ? s.layout : undefined,
        props: typeof s.props === 'object' && s.props !== null ? s.props : {},
      })),
  };
}
