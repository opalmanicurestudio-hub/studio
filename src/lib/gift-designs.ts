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
  renters: { salonCards: boolean; ownCards: boolean };
  /** The card's terms (Gift cards → Rules): written into plain words on every card page, receipt and email. */
  expiryYears: number; paysFor: { services: boolean; products: boolean; tips: boolean }; cashBackUnderCents: number; refundDays: number; customRules: boolean;
  serviceCards: boolean;   // sell a service ("a gel manicure") as well as dollar amounts
  onBooking: boolean; showcase: { design: string; amount: number; label: string | null }[] | null;
};
export const DEFAULT_RULES = 'Never expires. Use it for services, products and tips. Not for cash, except where the law requires. Lost it? We can resend it.';
/** The rules in plain words, from the settings (a business can write its own instead). */
export function rulesFrom(x: { expiryYears: number; paysFor: { services: boolean; products: boolean; tips: boolean }; cashBackUnderCents: number; refundDays: number }) {
  const what = [x.paysFor.services && 'services', x.paysFor.products && 'products', x.paysFor.tips && 'tips'].filter(Boolean) as string[];
  const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0] || 'services';
  return [x.expiryYears > 0 ? `Expires ${x.expiryYears} years after it’s bought.` : 'Never expires.', `Use it for ${list}.`,
    x.cashBackUnderCents > 0 ? `Not for cash — except a balance under $${(x.cashBackUnderCents / 100).toFixed(0)}, which we’ll give back in cash if you ask.` : 'Not for cash, except where the law requires.',
    x.refundDays > 0 ? `Unused cards can be refunded to the buyer within ${x.refundDays} days.` : null, 'Lost it? We can resend it.'].filter(Boolean).join(' ');
}
/** The one line the front desk says when selling one. */
export const deskScript = (s: GiftShopSettings) => { const w = [s.paysFor.services && 'services', s.paysFor.products && 'products', s.paysFor.tips && 'tips'].filter(Boolean) as string[];
  const list = w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}` : w[0] || 'services';
  return `${s.expiryYears > 0 ? `It’s good for ${s.expiryYears} years` : 'It never expires'}, it works for ${list}, and we can resend it if it’s ever lost.`; };

export function shopSettings(t: any): GiftShopSettings {
  const s = t?.giftCardSettings || {};
  const paysFor = { services: s.paysFor?.services !== false, products: s.paysFor?.products !== false, tips: s.paysFor?.tips !== false };
  const expiryYears = [0, 5, 6, 7, 10].includes(Number(s.expiryYears)) ? Number(s.expiryYears) : 0;
  const cashBackUnderCents = Math.max(0, Math.min(5000, Math.round(Number(s.cashBackUnderCents) || 0))); const refundDays = [0, 7, 14, 30].includes(Number(s.refundDays)) ? Number(s.refundDays) : 0; const nums = (a: any) => (Array.isArray(a) ? a.map(Number).filter((n) => n >= 1 && n <= 5000).slice(0, 6) : null);
  const min = Math.max(1, Math.min(5000, Number(s.min) || 10)); const max = Math.max(min, Math.min(5000, Number(s.max) || 500));
  return { online: s.online === true, designs: Array.isArray(s.designs) ? s.designs.map(String) : null, amounts: nums(s.amounts)?.length ? nums(s.amounts)! : [25, 50, 100, 150],
    custom: s.custom !== false, min, max, seasonalOnly: s.seasonalOnly !== false, rules: String(s.rules || rulesFrom({ expiryYears, paysFor, cashBackUnderCents, refundDays })).slice(0, 600), customRules: !!s.rules, expiryYears, paysFor, cashBackUnderCents, refundDays, buyerThanks: s.buyerThanks !== false,
    renters: { salonCards: s.renters?.salonCards !== false, ownCards: s.renters?.ownCards === true },
    serviceCards: s.serviceCards !== false, onBooking: s.onBooking !== false, showcase: cleanShowcase(s.showcase) };
}
/** The designs a buyer may pick from, in library order; out-of-season occasion cards are left out. */
export function offered(all: GiftDesign[], s: GiftShopSettings, at = new Date()) {
  return all.filter((d) => (!s.designs || s.designs.includes(d.id)) && (!s.seasonalOnly || inSeason(d, at)));
}
/** The three cards on the booking page: a design, an amount and a short label each. */
export function cleanShowcase(v: any) {
  if (!Array.isArray(v)) return null;
  const out = v.slice(0, 3).map((x: any) => ({ design: okDesign(x?.design) || DEFAULT_DESIGN, amount: Math.max(1, Math.min(5000, Math.round(Number(x?.amount) * 100) / 100 || 50)), label: x?.label ? String(x.label).slice(0, 40) : null }));
  return out.length ? out : null;
}
export const okDesign = (id: any) => typeof id === 'string' && /^[a-z0-9-]{2,30}$/.test(id) ? id : null;
