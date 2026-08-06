// ─── src/lib/shop-theme.ts ────────────────────────────────────────────────────
// One theme model for the whole storefront.
//
// Two problems this solves at once. First, the customer-facing pages each
// carried their own colours, radii and money formatter — five copies that
// drift apart. Second, every shop looked identical: a barber, a bakery and a
// nail studio all got the same near-black-on-white. A storefront people are
// proud to send to clients has to carry their brand, not ours.
//
// The model is deliberately small — a handful of decisions rather than a
// hundred knobs. Businesses do not want a CSS editor; they want to pick a
// look, drop in their colour, and get something that still reads well on a
// phone. Contrast is enforced rather than trusted, so nobody can ship pale
// grey text on white by accident.

export type LayoutPreset = 'grid' | 'editorial' | 'list';
export type SurfaceStyle = 'soft' | 'flat' | 'glass' | 'bordered';
export type CornerStyle = 'sharp' | 'soft' | 'round';
export type FontPreset = 'jakarta' | 'serif' | 'mono' | 'rounded' | 'display';
export type Density = 'cozy' | 'comfortable' | 'roomy';
export type ButtonStyle = 'solid' | 'outline' | 'soft' | 'underline';
export type ImageShape = 'square' | 'portrait' | 'landscape';
export type CaptionStyle = 'below' | 'overlay';
export type BackdropStyle = 'plain' | 'tint' | 'grain' | 'grid';
export type MotionLevel = 'none' | 'subtle' | 'lively';
export type PriceStyle = 'plain' | 'mono' | 'tag';
export type HeaderStyle = 'minimal' | 'centered' | 'bold';

export interface ShopTheme {
  brand: string;          // hex — buttons, links, active states
  accent: string;         // hex — badges, sale flags, secondary emphasis
  ink: string;            // hex — body text
  surface: string;        // hex — page background
  layout: LayoutPreset;
  surfaceStyle: SurfaceStyle;
  corners: CornerStyle;
  font: FontPreset;           // body
  headingFont: FontPreset;    // headings — pairing is most of a shop's voice
  density: Density;
  buttonStyle: ButtonStyle;
  imageShape: ImageShape;
  captionStyle: CaptionStyle;
  backdrop: BackdropStyle;
  motion: MotionLevel;
  priceStyle: PriceStyle;
  headerStyle: HeaderStyle;
  heroStyle: 'banner' | 'minimal' | 'split' | 'none';
  showPrices: boolean;
}

export const DEFAULT_THEME: ShopTheme = {
  brand: '#16171a',
  accent: '#8a5a20',
  ink: '#16171a',
  surface: '#f7f7f8',
  layout: 'grid',
  surfaceStyle: 'soft',
  corners: 'soft',
  font: 'jakarta',
  headingFont: 'jakarta',
  density: 'comfortable',
  buttonStyle: 'solid',
  imageShape: 'square',
  captionStyle: 'below',
  backdrop: 'plain',
  motion: 'subtle',
  priceStyle: 'mono',
  headerStyle: 'minimal',
  heroStyle: 'banner',
  showPrices: true,
};

/** Curated starting points — a shop picks one, then tweaks the brand colour. */
export const THEME_PRESETS: { id: string; name: string; blurb: string; theme: Partial<ShopTheme> }[] = [
  { id: 'ink', name: 'Ink', blurb: 'Clean and neutral — the product does the talking',
    theme: { brand: '#16171a', accent: '#8a5a20', surface: '#f7f7f8', surfaceStyle: 'soft', corners: 'soft', font: 'jakarta', headingFont: 'jakarta', density: 'comfortable', buttonStyle: 'solid', imageShape: 'square', captionStyle: 'below', backdrop: 'plain', priceStyle: 'mono', headerStyle: 'minimal' } },
  { id: 'atelier', name: 'Atelier', blurb: 'Gallery calm — light headings, generous space',
    theme: { brand: '#1b1a17', accent: '#7a6a55', surface: '#f6f4f0', surfaceStyle: 'bordered', corners: 'sharp', font: 'serif', headingFont: 'serif', density: 'roomy', buttonStyle: 'underline', imageShape: 'portrait', captionStyle: 'below', backdrop: 'grain', priceStyle: 'plain', headerStyle: 'centered', heroStyle: 'split' } },
  { id: 'boutique', name: 'Boutique', blurb: 'Soft, warm and friendly — good for gifting',
    theme: { brand: '#a8456b', accent: '#d98fb0', surface: '#fdf7f8', surfaceStyle: 'soft', corners: 'round', font: 'rounded', headingFont: 'rounded', density: 'comfortable', buttonStyle: 'solid', imageShape: 'square', captionStyle: 'below', backdrop: 'tint', priceStyle: 'tag', headerStyle: 'centered' } },
  { id: 'studio', name: 'Studio', blurb: 'Muted green, roomy, quietly premium',
    theme: { brand: '#3f5c4a', accent: '#7a6a3c', surface: '#f5f6f4', surfaceStyle: 'soft', corners: 'round', font: 'jakarta', headingFont: 'serif', density: 'roomy', buttonStyle: 'soft', imageShape: 'landscape', captionStyle: 'below', backdrop: 'plain', priceStyle: 'mono', headerStyle: 'minimal' } },
  { id: 'market', name: 'Market', blurb: 'Dense and busy — for shops with a lot to show',
    theme: { brand: '#1d4ed8', accent: '#b91c1c', surface: '#ffffff', surfaceStyle: 'flat', corners: 'sharp', font: 'jakarta', headingFont: 'jakarta', density: 'cozy', buttonStyle: 'solid', imageShape: 'square', captionStyle: 'below', backdrop: 'grid', priceStyle: 'tag', headerStyle: 'bold', layout: 'grid' } },
  { id: 'midnight', name: 'Midnight', blurb: 'Dark, glassy and modern',
    theme: { brand: '#e8e6e1', accent: '#c9a227', ink: '#f5f5f4', surface: '#141414', surfaceStyle: 'glass', corners: 'soft', font: 'jakarta', headingFont: 'display', density: 'comfortable', buttonStyle: 'solid', imageShape: 'portrait', captionStyle: 'overlay', backdrop: 'tint', priceStyle: 'mono', headerStyle: 'minimal' } },
  { id: 'clay', name: 'Clay', blurb: 'Handmade warmth — terracotta and round edges',
    theme: { brand: '#8c4f3a', accent: '#4a6b45', surface: '#f7f5f3', surfaceStyle: 'soft', corners: 'round', font: 'rounded', headingFont: 'serif', density: 'comfortable', buttonStyle: 'soft', imageShape: 'square', captionStyle: 'below', backdrop: 'grain', priceStyle: 'plain', headerStyle: 'centered' } },
  { id: 'press', name: 'Press', blurb: 'Editorial and typographic — big headings, hairlines',
    theme: { brand: '#111111', accent: '#b45309', surface: '#ffffff', surfaceStyle: 'bordered', corners: 'sharp', font: 'jakarta', headingFont: 'display', density: 'roomy', buttonStyle: 'outline', imageShape: 'landscape', captionStyle: 'below', backdrop: 'plain', priceStyle: 'plain', headerStyle: 'bold', layout: 'editorial' } },
];

const RADII: Record<CornerStyle, { card: string; control: string; pill: string }> = {
  sharp: { card: '0.375rem', control: '0.25rem', pill: '0.25rem' },
  soft:  { card: '1.25rem',  control: '0.875rem', pill: '999px' },
  round: { card: '2rem',     control: '1.25rem', pill: '999px' },
};

const FONTS: Record<FontPreset, string> = {
  jakarta: '"Plus Jakarta Sans", system-ui, sans-serif',
  serif:   'Georgia, "Times New Roman", serif',
  mono:    '"JetBrains Mono", ui-monospace, monospace',
  rounded: '"Nunito", "Plus Jakarta Sans", system-ui, sans-serif',
  display: '"Playfair Display", Georgia, serif',
};

const DENSITY: Record<Density, { gap: string; pad: string; section: string; line: string }> = {
  cozy:        { gap: '0.5rem',  pad: '0.75rem', section: '1.25rem', line: '1.45' },
  comfortable: { gap: '0.75rem', pad: '1.125rem', section: '2rem',   line: '1.6'  },
  roomy:       { gap: '1.25rem', pad: '1.5rem',  section: '3rem',    line: '1.75' },
};

const IMAGE_RATIO: Record<ImageShape, string> = {
  square: '1 / 1',
  portrait: '3 / 4',
  landscape: '4 / 3',
};

const BACKDROPS: Record<BackdropStyle, (surface: string, brand: string) => string> = {
  plain: () => 'none',
  tint: (surface, brand) =>
    `radial-gradient(120% 80% at 10% -10%, color-mix(in srgb, ${brand} 14%, transparent) 0%, transparent 60%)`,
  grain: () =>
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.035'/%3E%3C/svg%3E\")",
  grid: (surface, brand) =>
    `linear-gradient(color-mix(in srgb, ${brand} 7%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, ${brand} 7%, transparent) 1px, transparent 1px)`,
};

/* ── colour helpers ───────────────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = String(hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6) || '000000', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text that is guaranteed readable ON a given background. */
export function readableOn(bg: string): string {
  return contrastRatio('#ffffff', bg) >= contrastRatio('#111111', bg) ? '#ffffff' : '#111111';
}

/** Mix toward white/black — for soft tints and hover states without a palette. */
function mix(hex: string, toward: 'white' | 'black', amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = toward === 'white' ? 255 : 0;
  const f = (c: number) => Math.round(c + (t - c) * amount);
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function sanitizeTheme(raw: any): ShopTheme {
  const hex = (v: any, fallback: string) =>
    typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : fallback;
  const pick = <T extends string>(v: any, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v) ? v : fallback;

  const brand = hex(raw?.brand, DEFAULT_THEME.brand);
  const surface = hex(raw?.surface, DEFAULT_THEME.surface);
  let ink = hex(raw?.ink, DEFAULT_THEME.ink);

  // Enforce readability: a shop that picks pale grey text gets legible text
  // anyway. Better a slightly different colour than an unreadable shop.
  if (contrastRatio(ink, surface) < 4.5) ink = readableOn(surface);

  return {
    brand,
    ink,
    surface,
    accent: hex(raw?.accent, DEFAULT_THEME.accent),
    headingFont: pick(raw?.headingFont, ['jakarta', 'serif', 'mono', 'rounded', 'display'] as const, DEFAULT_THEME.headingFont),
    density: pick(raw?.density, ['cozy', 'comfortable', 'roomy'] as const, DEFAULT_THEME.density),
    buttonStyle: pick(raw?.buttonStyle, ['solid', 'outline', 'soft', 'underline'] as const, DEFAULT_THEME.buttonStyle),
    imageShape: pick(raw?.imageShape, ['square', 'portrait', 'landscape'] as const, DEFAULT_THEME.imageShape),
    captionStyle: pick(raw?.captionStyle, ['below', 'overlay'] as const, DEFAULT_THEME.captionStyle),
    backdrop: pick(raw?.backdrop, ['plain', 'tint', 'grain', 'grid'] as const, DEFAULT_THEME.backdrop),
    motion: pick(raw?.motion, ['none', 'subtle', 'lively'] as const, DEFAULT_THEME.motion),
    priceStyle: pick(raw?.priceStyle, ['plain', 'mono', 'tag'] as const, DEFAULT_THEME.priceStyle),
    headerStyle: pick(raw?.headerStyle, ['minimal', 'centered', 'bold'] as const, DEFAULT_THEME.headerStyle),
    layout: pick(raw?.layout, ['grid', 'editorial', 'list'] as const, DEFAULT_THEME.layout),
    surfaceStyle: pick(raw?.surfaceStyle, ['soft', 'flat', 'glass', 'bordered'] as const, DEFAULT_THEME.surfaceStyle),
    corners: pick(raw?.corners, ['sharp', 'soft', 'round'] as const, DEFAULT_THEME.corners),
    font: pick(raw?.font, ['jakarta', 'serif', 'mono', 'rounded'] as const, DEFAULT_THEME.font),
    heroStyle: pick(raw?.heroStyle, ['banner', 'minimal', 'split', 'none'] as const, DEFAULT_THEME.heroStyle),
    showPrices: raw?.showPrices !== false,
  };
}

/**
 * The whole theme as CSS custom properties. Injected once per storefront
 * page, so every component reads the shop's brand instead of hardcoding
 * colours — and a new shop restyles its entire store without touching code.
 */
export function themeToCss(theme: ShopTheme): string {
  const t = sanitizeTheme(theme);
  const radii = RADII[t.corners];
  const onBrand = readableOn(t.brand);
  const cardBg = t.surfaceStyle === 'glass'
    ? `color-mix(in srgb, ${mix(t.surface, luminance(t.surface) > 0.5 ? 'white' : 'black', 0.5)} 60%, transparent)`
    : mix(t.surface, luminance(t.surface) > 0.5 ? 'white' : 'black', 0.6);

  return [
    `--shop-brand:${t.brand}`,
    `--shop-on-brand:${onBrand}`,
    `--shop-brand-soft:${mix(t.brand, luminance(t.surface) > 0.5 ? 'white' : 'black', 0.88)}`,
    `--shop-ink:${t.ink}`,
    `--shop-muted:${mix(t.ink, luminance(t.surface) > 0.5 ? 'white' : 'black', 0.45)}`,
    `--shop-surface:${t.surface}`,
    `--shop-card:${cardBg}`,
    `--shop-line:${mix(t.ink, luminance(t.surface) > 0.5 ? 'white' : 'black', 0.86)}`,
    `--shop-radius-card:${radii.card}`,
    `--shop-radius-control:${radii.control}`,
    `--shop-radius-pill:${radii.pill}`,
    `--shop-font:${FONTS[t.font]}`,
    `--shop-card-blur:${t.surfaceStyle === 'glass' ? '20px' : '0px'}`,
    `--shop-card-shadow:${t.surfaceStyle === 'soft' ? '0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.12)' : 'none'}`,
    `--shop-card-border:${t.surfaceStyle === 'flat' ? '0px' : '1px'}`,
    `--shop-accent:${t.accent}`,
    `--shop-on-accent:${readableOn(t.accent)}`,
    `--shop-accent-soft:${mix(t.accent, luminance(t.surface) > 0.5 ? 'white' : 'black', 0.86)}`,
    `--shop-heading-font:${FONTS[t.headingFont]}`,
    `--shop-gap:${DENSITY[t.density].gap}`,
    `--shop-pad:${DENSITY[t.density].pad}`,
    `--shop-section:${DENSITY[t.density].section}`,
    `--shop-line-height:${DENSITY[t.density].line}`,
    `--shop-image-ratio:${IMAGE_RATIO[t.imageShape]}`,
    `--shop-backdrop:${BACKDROPS[t.backdrop](t.surface, t.brand)}`,
    `--shop-backdrop-size:${t.backdrop === 'grid' ? '28px 28px' : t.backdrop === 'grain' ? '120px 120px' : 'auto'}`,
    `--shop-motion:${t.motion === 'none' ? '0ms' : t.motion === 'lively' ? '260ms' : '160ms'}`,
    `--shop-lift:${t.motion === 'lively' ? '-3px' : t.motion === 'subtle' ? '-1px' : '0px'}`,
  ].join(';');
}

/** Button classes per style — solid, outline, soft tint, or a bare underline. */
export function buttonClassFor(style: ButtonStyle): string {
  if (style === 'outline') return 'shop-btn shop-btn-outline';
  if (style === 'soft') return 'shop-btn shop-btn-soft';
  if (style === 'underline') return 'shop-btn shop-btn-underline';
  return 'shop-btn shop-btn-solid';
}

/** Product grid columns per layout preset — phone first, then wider screens. */
export function gridClassFor(layout: LayoutPreset): string {
  if (layout === 'list') return 'grid-cols-1';
  if (layout === 'editorial') return 'grid-cols-1 sm:grid-cols-2';
  return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
}
