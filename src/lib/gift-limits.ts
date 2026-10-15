// src/lib/gift-limits.ts — ADVANCED GIFT CARD LIMITS and CARDS ACROSS LOCATIONS. Pure functions, no imports.
// Limits are off unless the business turns them on (Gift cards → Rules → Advanced limits). A card can then be limited to:
//   certain services, certain providers, certain channels (front desk, online booking, the shop), a minimum bill, and
//   "not with other discounts". A limited card pays only for the parts of the bill it's allowed to; never more.
// Locations: one card works at every location of the same business. Each sale and each spend records where it happened,
// so the business can see what each location owes the other (the one that sold it holds the money; the one that did the
// work earned it).
export type GiftChannel = 'desk' | 'online' | 'shop';
export const CHANNEL_LABEL: Record<GiftChannel, string> = { desk: 'Front desk', online: 'Online booking', shop: 'Online shop' };
export interface GiftLimits { serviceIds?: string[]; staffIds?: string[]; channels?: GiftChannel[]; minSpendCents?: number; notWithDiscounts?: boolean }
export interface BillLine { kind: 'service' | 'product' | 'tip' | 'other'; cents: number; serviceId?: string | null; staffId?: string | null }

const ids = (a: any, max = 60) => (Array.isArray(a) ? Array.from(new Set(a.map((x: any) => String(x || '').slice(0, 80)).filter(Boolean))).slice(0, max) as string[] : []);
/** What's kept when a manager saves a card's limits (empty → no limits at all). */
export function cleanLimits(v: any): GiftLimits | null {
  if (!v || typeof v !== 'object') return null;
  const out: GiftLimits = {}; const s = ids(v.serviceIds), st = ids(v.staffIds); const ch = ids(v.channels, 3).filter((c) => c in CHANNEL_LABEL) as GiftChannel[];
  if (s.length) out.serviceIds = s; if (st.length) out.staffIds = st; if (ch.length && ch.length < 3) out.channels = ch;
  const min = Math.max(0, Math.min(500000, Math.round(Number(v.minSpendCents) || 0))); if (min > 0) out.minSpendCents = min;
  if (v.notWithDiscounts === true) out.notWithDiscounts = true;
  return Object.keys(out).length ? out : null;
}
export const limitsOn = (tenant: any) => tenant?.giftCardSettings?.advancedLimits === true;
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

/** How much of this bill the card may pay for. `cap` null = no limit applies. `error` = it can't be used here at all. */
export function giftCap(card: any, bill: { channel: GiftChannel; lines: BillLine[]; hasDiscount?: boolean }, enabled: boolean): { cap: number | null; error: string | null } {
  const L: GiftLimits | null = enabled ? cleanLimits(card?.limits) : null; const code = String(card?.code || '');
  if (!L) return { cap: null, error: null };
  if (L.channels && !L.channels.includes(bill.channel)) return { cap: 0, error: `Gift card ${code} can only be used ${L.channels.map((c) => (c === 'desk' ? 'at the front desk' : c === 'online' ? 'when booking online' : 'in the online shop')).join(' or ')}.` };
  const total = bill.lines.reduce((t, l) => t + Math.max(0, Math.round(l.cents)), 0);
  if (L.minSpendCents && total < L.minSpendCents) return { cap: 0, error: `Gift card ${code} needs a bill of at least ${money(L.minSpendCents)}.` };
  if (L.notWithDiscounts && bill.hasDiscount) return { cap: 0, error: `Gift card ${code} can’t be used with another discount or offer.` };
  if (!L.serviceIds && !L.staffIds) return { cap: null, error: null };
  const cap = bill.lines.filter((l) => l.kind === 'service' && (!L.serviceIds || L.serviceIds.includes(String(l.serviceId || ''))) && (!L.staffIds || L.staffIds.includes(String(l.staffId || ''))))
    .reduce((t, l) => t + Math.max(0, Math.round(l.cents)), 0);
  if (cap <= 0) return { cap: 0, error: `Nothing on this bill is something gift card ${code} can pay for.` };
  return { cap, error: null };
}
/** The limits in plain words, for the card page, receipt and the desk. */
export function limitsText(L: GiftLimits | null, names: { services?: Record<string, string>; staff?: Record<string, string> } = {}): string[] {
  if (!L) return []; const out: string[] = []; const list = (a: string[]) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}` : a[0] || '');
  if (L.serviceIds?.length) out.push(`For ${list(L.serviceIds.map((i) => names.services?.[i] || 'a chosen service'))}`);
  if (L.staffIds?.length) out.push(`With ${list(L.staffIds.map((i) => names.staff?.[i] || 'a chosen provider'))}`);
  if (L.channels?.length) out.push(`Use it ${list(L.channels.map((c) => (c === 'desk' ? 'in person' : c === 'online' ? 'when booking online' : 'in the online shop')))}`);
  if (L.minSpendCents) out.push(`On a bill of ${money(L.minSpendCents)} or more`);
  if (L.notWithDiscounts) out.push('Not with other discounts or offers');
  return out;
}

/** Cards across locations: for every spend at one location of a card sold at another, the selling location owes the
 *  location that did the work. Netted per pair, so each pair shows one line. Spends or sales with no location are skipped. */
export function locationSettlement(cards: any[]): { from: string; to: string; cents: number; spends: number }[] {
  const pair = new Map<string, { a: string; b: string; net: number; spends: number }>();
  for (const c of cards || []) { const sold = c?.soldAtLocationId; if (!sold || c?.promo || c?.ownerRenterId) continue;
    for (const h of c.history || []) { if (h?.type !== 'spend' || !h.locationId || h.locationId === sold) continue; const cents = -Math.round(Number(h.cents) || 0); if (!cents) continue;
      const [a, b] = [String(sold), String(h.locationId)].sort(); const k = `${a}|${b}`; const p = pair.get(k) || { a, b, net: 0, spends: 0 };
      p.net += sold === a ? cents : -cents; p.spends++; pair.set(k, p); } }   // net > 0: a owes b
  return [...pair.values()].filter((p) => p.net !== 0).map((p) => (p.net > 0 ? { from: p.a, to: p.b, cents: p.net, spends: p.spends } : { from: p.b, to: p.a, cents: -p.net, spends: p.spends }))
    .sort((x, y) => y.cents - x.cents);
}
