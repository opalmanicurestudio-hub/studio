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
export type FontPreset = 'jakarta' | 'serif' | 'mono' | 'rounded';

export interface ShopTheme {
  brand: string;          // hex — buttons, links, active states
  ink: string;            // hex — body text
  surface: string;        // hex — page background
  layout: LayoutPreset;
  surfaceStyle: SurfaceStyle;
  corners: CornerStyle;
  font: FontPreset;
  heroStyle: 'banner' | 'minimal' | 'split';
  showPrices: boolean;
}

export const DEFAULT_THEME: ShopTheme = {
  brand: '#16171a',
  ink: '#16171a',
  surface: '#f7f7f8',
  layout: 'grid',
  surfaceStyle: 'soft',
  corners: 'soft',
  font: 'jakarta',
  heroStyle: 'banner',
  showPrices: true,
};

/** Curated starting points — a shop picks one, then tweaks the brand colour. */
export const THEME_PRESETS: { id: string; name: string; theme: Partial<ShopTheme> }[] = [
  { id: 'ink',      name: 'Ink',      theme: { brand: '#16171a', surface: '#f7f7f8', surfaceStyle: 'soft',     corners: 'soft',  font: 'jakarta' } },
  { id: 'paper',    name: 'Paper',    theme: { brand: '#1b1a17', surface: '#f6f4f0', surfaceStyle: 'bordered', corners: 'sharp', font: 'serif'   } },
  { id: 'sage',     name: 'Sage',     theme: { brand: '#3f5c4a', surface: '#f5f6f4', surfaceStyle: 'soft',     corners: 'round', font: 'rounded' } },
  { id: 'clay',     name: 'Clay',     theme: { brand: '#8c4f3a', surface: '#f7f5f3', surfaceStyle: 'soft',     corners: 'round', font: 'jakarta' } },
  { id: 'midnight', name: 'Midnight', theme: { brand: '#e8e6e1', ink: '#f5f5f4', surface: '#141414', surfaceStyle: 'glass', corners: 'soft', font: 'jakarta' } },
  { id: 'bloom',    name: 'Bloom',    theme: { brand: '#a8456b', surface: '#fdf7f8', surfaceStyle: 'soft',     corners: 'round', font: 'rounded' } },
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
    layout: pick(raw?.layout, ['grid', 'editorial', 'list'] as const, DEFAULT_THEME.layout),
    surfaceStyle: pick(raw?.surfaceStyle, ['soft', 'flat', 'glass', 'bordered'] as const, DEFAULT_THEME.surfaceStyle),
    corners: pick(raw?.corners, ['sharp', 'soft', 'round'] as const, DEFAULT_THEME.corners),
    font: pick(raw?.font, ['jakarta', 'serif', 'mono', 'rounded'] as const, DEFAULT_THEME.font),
    heroStyle: pick(raw?.heroStyle, ['banner', 'minimal', 'split'] as const, DEFAULT_THEME.heroStyle),
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
  ].join(';');
}

/** Product grid columns per layout preset — phone first, then wider screens. */
export function gridClassFor(layout: LayoutPreset): string {
  if (layout === 'list') return 'grid-cols-1';
  if (layout === 'editorial') return 'grid-cols-1 sm:grid-cols-2';
  return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
}
