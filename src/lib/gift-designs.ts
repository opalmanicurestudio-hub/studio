// src/lib/gift-designs.ts — GIFT CARD DESIGNS: the library (gift-designs.data), which ones a business offers, and which
// occasion cards are in season. Shared by the shop page, the desk, the recipient's page and the manager settings.
export type GiftDesign = {
  id: string; name: string; collection: 'Finishes' | 'Luxe' | 'Art' | 'Nature' | 'Beauty' | 'Occasions'; note: string;
  bg: string; sheen: string; svg: string; ink: string; sub: string; chip: string[]; border?: string;
  dark?: boolean; tileAccent?: boolean; amountAccent?: boolean; brand?: boolean; glow?: boolean;
  line?: string; lineColor?: string; season?: [number, number];
};
export const COLLECTIONS = ['Occasions', 'Finishes', 'Luxe', 'Art', 'Nature', 'Beauty'] as const;
export const COLLECTION_NOTE: Record<string, string> = {
  Occasions: 'Birthdays, holidays and thank-yous — seasonal ones show up at the right time of year.',
  Finishes: 'Clean card finishes that suit any brand.',
  Luxe: 'Stone, foil and velvet.', Art: 'Painted, drawn and printed.', Nature: 'Calm and seasonal, any time of year.', Beauty: 'Made for nail, beauty and spa businesses.',
};
export const DEFAULT_DESIGN = 'frost';

let cache: GiftDesign[] | null = null;
export async function loadDesigns(): Promise<GiftDesign[]> { if (!cache) cache = (await import('./gift-designs.data')).DESIGNS; return cache; }
export function designsSync(): GiftDesign[] { if (!cache) cache = require('./gift-designs.data').DESIGNS; return cache!; }   // eslint-disable-line @typescript-eslint/no-require-imports
export const designById = (id?: string | null) => designsSync().find((d) => d.id === id) || designsSync().find((d) => d.id === DEFAULT_DESIGN)!;

/** Is an occasion card in its window today? Windows can run over New Year (Nov 15 – Jan 5). Year-round cards always are. */
export function inSeason(d: GiftDesign, at = new Date()) {
  if (!d.season) return true; const md = (at.getMonth() + 1) * 100 + at.getDate(); const [a, b] = d.season;
  return a <= b ? md >= a && md <= b : md >= a || md <= b;
}

/** What a business has chosen (tenant.giftCardSettings). Everything is on until they turn things off. */
export type GiftShopSettings = {
  online: boolean; designs: string[] | null; amounts: number[]; custom: boolean; min: number; max: number;
  seasonalOnly: boolean; rules: string; buyerThanks: boolean;
};
export const DEFAULT_RULES = 'Never expires. Use it for services, products and tips. Not for cash, except where the law requires. Lost it? We can resend it.';
export function shopSettings(t: any): GiftShopSettings {
  const s = t?.giftCardSettings || {}; const nums = (a: any) => (Array.isArray(a) ? a.map(Number).filter((n) => n >= 1 && n <= 5000).slice(0, 6) : null);
  const min = Math.max(1, Math.min(5000, Number(s.min) || 10)); const max = Math.max(min, Math.min(5000, Number(s.max) || 500));
  return { online: s.online === true, designs: Array.isArray(s.designs) ? s.designs.map(String) : null, amounts: nums(s.amounts)?.length ? nums(s.amounts)! : [25, 50, 100, 150],
    custom: s.custom !== false, min, max, seasonalOnly: s.seasonalOnly !== false, rules: String(s.rules || DEFAULT_RULES).slice(0, 600), buyerThanks: s.buyerThanks !== false };
}
/** The designs a buyer may pick from, in library order; out-of-season occasion cards are left out. */
export function offered(all: GiftDesign[], s: GiftShopSettings, at = new Date()) {
  return all.filter((d) => (!s.designs || s.designs.includes(d.id)) && (!s.seasonalOnly || inSeason(d, at)));
}
export const okDesign = (id: any) => typeof id === 'string' && /^[a-z0-9-]{2,30}$/.test(id) ? id : null;
