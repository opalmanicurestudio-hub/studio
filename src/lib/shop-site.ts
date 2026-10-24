// src/lib/shop-site.ts — THE SHOP'S WHOLE-SITE LOOK. A layout decides how every page is put together (Atelier,
// Maison, Index, Spotlight, Bento); a preset is a layout with a finished look (colors, corners, type and motion); the
// business's logo sits on top. Pure (no reads), so the server, the designer and the checks share it.
// The finer settings (colors, spacing, buttons) stay in lib/shop-theme; a preset just fills them in.
import type { ShopTheme } from '@/lib/shop-theme';

export type SiteLayout = 'atelier' | 'maison' | 'index' | 'spotlight' | 'bento';

export const SITE_LAYOUTS: { id: SiteLayout; name: string; blurb: string }[] = [
  { id: 'atelier', name: 'Atelier', blurb: 'Classic and clear. Best sellers up front, quick add on every card.' },
  { id: 'maison', name: 'Maison', blurb: 'Editorial and calm. Full-screen photos, fine type, shoppable looks.' },
  { id: 'index', name: 'Index', blurb: 'Built for big catalogs. Search, filters and dense grids.' },
  { id: 'spotlight', name: 'Spotlight', blurb: 'One product told as a story. Great for launches and small ranges.' },
  { id: 'bento', name: 'Bento', blurb: 'Playful tiles you can tap. Every feature on one screen.' },
];
export const isSiteLayout = (v: any): v is SiteLayout => SITE_LAYOUTS.some((l) => l.id === v);

const SCHEMES = {
  light: { surface: '#ffffff', ink: '#121212' },
  soft: { surface: '#faf9f7', ink: '#1c1b19' },
  dark: { surface: '#0e0e0e', ink: '#f2f2f2' },
} as const;

export type SitePreset = { id: string; name: string; layout: SiteLayout; scheme: keyof typeof SCHEMES; blurb: string; theme: Partial<ShopTheme> };

const p = (id: string, name: string, layout: SiteLayout, scheme: keyof typeof SCHEMES, brand: string, accent: string, corners: ShopTheme['corners'], blurb: string, extra: Partial<ShopTheme> = {}): SitePreset => ({
  id, name, layout, scheme, blurb,
  theme: { ...SCHEMES[scheme], brand, accent, corners, font: 'jakarta', headingFont: 'jakarta', site: layout, preset: id, ...extra } as Partial<ShopTheme>,
});

/** The twelve presets: whole-shop looks, two or three for each layout. */
export const SITE_PRESETS: SitePreset[] = [
  p('atelier-ivory', 'Atelier Ivory', 'atelier', 'light', '#121212', '#8a5a20', 'soft', 'Clean and familiar. Best sellers up front, quick add on every card.', { density: 'comfortable', imageShape: 'square', surfaceStyle: 'soft', buttonStyle: 'solid', headerStyle: 'centered' }),
  p('atelier-graphite', 'Atelier Graphite', 'atelier', 'dark', '#f2f2f2', '#c9a227', 'soft', 'The classic layout after dark. Photos glow, text stays easy to read.', { density: 'comfortable', imageShape: 'square', surfaceStyle: 'flat', buttonStyle: 'solid', headerStyle: 'centered' }),
  p('sage', 'Sage', 'atelier', 'soft', '#3d4a3d', '#7a6a3c', 'round', 'Calm greens and soft edges.', { density: 'comfortable', imageShape: 'square', surfaceStyle: 'soft', buttonStyle: 'solid', headerStyle: 'centered' }),
  p('maison-sand', 'Maison Sand', 'maison', 'soft', '#4a3b32', '#8a6a4a', 'sharp', 'Warm, quiet and editorial. Full-screen photos and shoppable looks.', { density: 'roomy', imageShape: 'portrait', surfaceStyle: 'flat', buttonStyle: 'solid', headerStyle: 'centered' }),
  p('maison-noir', 'Maison Noir', 'maison', 'dark', '#e9e2d6', '#c9a227', 'sharp', 'Gallery-dark with fine type. Made for strong product photography.', { density: 'roomy', imageShape: 'portrait', surfaceStyle: 'flat', buttonStyle: 'solid', headerStyle: 'centered' }),
  p('studio', 'Studio', 'maison', 'light', '#121212', '#8a5a20', 'sharp', 'Bright white space and big type. Feels like a print magazine.', { density: 'roomy', imageShape: 'portrait', surfaceStyle: 'flat', buttonStyle: 'outline', headerStyle: 'centered' }),
  p('index-clean', 'Index Clean', 'index', 'light', '#2f3a4a', '#b45309', 'round', 'Filters, chips and dense grids for shops with lots of products.', { density: 'cozy', imageShape: 'square', surfaceStyle: 'bordered', buttonStyle: 'solid', headerStyle: 'minimal' }),
  p('index-night', 'Index Night', 'index', 'dark', '#7fd1a5', '#e0a458', 'round', 'The catalog layout in dark, with a bright accent for buttons.', { density: 'cozy', imageShape: 'square', surfaceStyle: 'bordered', buttonStyle: 'solid', headerStyle: 'minimal' }),
  p('spotlight-light', 'Spotlight Light', 'spotlight', 'light', '#121212', '#1f7a4d', 'round', 'One hero product told as a story, with a buy bar that follows you.', { density: 'roomy', imageShape: 'square', surfaceStyle: 'soft', buttonStyle: 'solid', headerStyle: 'bold', motion: 'lively' }),
  p('spotlight-bold', 'Spotlight Bold', 'spotlight', 'dark', '#7fd1a5', '#e0a458', 'round', 'The story layout after dark, for launches and limited drops.', { density: 'roomy', imageShape: 'square', surfaceStyle: 'flat', buttonStyle: 'solid', headerStyle: 'bold', motion: 'lively' }),
  p('bento-pop', 'Bento Pop', 'bento', 'soft', '#2f3a4a', '#b45309', 'round', 'Colorful tiles you can tap: quiz, countdown, look and box builder.', { density: 'comfortable', imageShape: 'square', surfaceStyle: 'soft', buttonStyle: 'solid', headerStyle: 'minimal', motion: 'lively' }),
  p('bento-mono', 'Bento Mono', 'bento', 'light', '#121212', '#8a5a20', 'soft', 'The tile layout in quiet tones, so your photos do the talking.', { density: 'comfortable', imageShape: 'square', surfaceStyle: 'soft', buttonStyle: 'solid', headerStyle: 'minimal', motion: 'subtle' }),
];
export const presetById = (id: any) => SITE_PRESETS.find((x) => x.id === id) || null;

/** How each layout sets type and its header (read by the shop's header, footer and pages through CSS variables). */
export const SITE_TYPE: Record<SiteLayout, { logoWeight: number; logoTrack: string; logoCase: 'uppercase' | 'none'; headWeight: number; headTrack: string; navCase: 'uppercase' | 'none'; navTrack: string; navSize: string; labelTrack: string }> = {
  atelier: { logoWeight: 600, logoTrack: '.14em', logoCase: 'uppercase', headWeight: 500, headTrack: '-0.03em', navCase: 'none', navTrack: '0', navSize: '14px', labelTrack: '.14em' },
  maison: { logoWeight: 300, logoTrack: '.32em', logoCase: 'uppercase', headWeight: 200, headTrack: '-0.045em', navCase: 'uppercase', navTrack: '.14em', navSize: '12px', labelTrack: '.3em' },
  index: { logoWeight: 600, logoTrack: '.06em', logoCase: 'uppercase', headWeight: 600, headTrack: '-0.02em', navCase: 'none', navTrack: '0', navSize: '14px', labelTrack: '0' },
  spotlight: { logoWeight: 700, logoTrack: '-0.02em', logoCase: 'none', headWeight: 700, headTrack: '-0.055em', navCase: 'none', navTrack: '0', navSize: '15px', labelTrack: '.12em' },
  bento: { logoWeight: 700, logoTrack: '-0.01em', logoCase: 'none', headWeight: 700, headTrack: '-0.045em', navCase: 'none', navTrack: '0', navSize: '14px', labelTrack: '0' },
};

export function siteTypeCss(layout: SiteLayout): string {
  const t = SITE_TYPE[layout] || SITE_TYPE.atelier;
  return [`--shop-logo-weight:${t.logoWeight}`, `--shop-logo-track:${t.logoTrack}`, `--shop-logo-case:${t.logoCase}`, `--shop-head-weight:${t.headWeight}`, `--shop-head-track:${t.headTrack}`,
    `--shop-nav-case:${t.navCase}`, `--shop-nav-track:${t.navTrack}`, `--shop-nav-size:${t.navSize}`, `--shop-label-track:${t.labelTrack}`].join(';');
}

// ─── The logo ─────────────────────────────────────────────────────────────────

export type ShopBrand = {
  /** The business logo (Settings, Business profile; the designer changes the same one). */
  logoUrl: string;
  /** A light version for dark headers and over photos. */
  darkLogoUrl: string;
  /** The small square icon for browser tabs and phone home screens. */
  iconUrl: string;
  show: 'mark+name' | 'mark' | 'name';
  place: 'left' | 'center';
  size: 'small' | 'medium' | 'large';
};

const https = (v: any) => { const s = String(v ?? '').trim(); if (!/^https:\/\//.test(s) || /["'<>\s]/.test(s)) return ''; try { return new URL(s).protocol === 'https:' ? s : ''; } catch { return ''; } };
const one = <T extends string>(v: any, ok: readonly T[], d: T): T => (ok.includes(v) ? v : d);

/** The shop's logo and how it shows, from the business record (a logo saved before these settings shows with its name). */
export function brandOf(t: any): ShopBrand {
  const rs = t?.retailSettings || {}; const b = rs.shopBrand || {};
  const logoUrl = https(t?.logoUrl) || https(rs.logoUrl);
  return {
    logoUrl, darkLogoUrl: https(b.darkLogoUrl), iconUrl: https(b.iconUrl),
    show: logoUrl ? one(b.show, ['mark+name', 'mark', 'name'] as const, 'mark+name') : 'name',
    place: one(b.place, ['left', 'center'] as const, 'left'),
    size: one(b.size, ['small', 'medium', 'large'] as const, 'medium'),
  };
}

/** What the designer saves for the logo settings (the logo itself is the business logo). */
export function sanitizeBrandSettings(raw: any): Omit<ShopBrand, 'logoUrl'> {
  return { darkLogoUrl: https(raw?.darkLogoUrl), iconUrl: https(raw?.iconUrl), show: one(raw?.show, ['mark+name', 'mark', 'name'] as const, 'mark+name'), place: one(raw?.place, ['left', 'center'] as const, 'left'), size: one(raw?.size, ['small', 'medium', 'large'] as const, 'medium') };
}

export const LOGO_HEIGHT: Record<ShopBrand['size'], number> = { small: 28, medium: 36, large: 48 };

/** The logo for a background: the light version on dark ones when there is one. */
export function logoFor(b: ShopBrand, darkBackground: boolean): string {
  return darkBackground && b.darkLogoUrl ? b.darkLogoUrl : b.logoUrl;
}
