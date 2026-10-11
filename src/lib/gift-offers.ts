// src/lib/gift-offers.ts — GIFT CARD OFFERS: "Buy a $100 gift card, get $20 for you."
//
// The business sets offers in Gift cards → Online shop & designs → Offers (giftCardSettings.offers). While one is on, each
// gift card bought (online, at the desk, or both) earns the BUYER a separate bonus card:
//   • the bonus is its own card — never added to the gift — so the gift stays whole and the bonus can have its own dates
//   • it can start later ("use it from January 1") and it ends (90 days by default) — bonus money is a promotion, not
//     money someone paid, so it can expire where a paid gift card can't
//   • it's used at the studio (the front desk), not in the online shop, on deposits or on a balance
//   • when it's used, the books record a discount (category Discounts, kind gift_offer) — no money came in for it
//   • it is never counted in "gift card money you owe" — nobody paid for it
// Pure helpers here; making the card is lib/gift-cards issueGiftCard with `promo`.

export type OfferTier = { buyCents: number; bonusCents: number };
export type GiftOffer = {
  id: string; name: string; tiers: OfferTier[];
  startsOn: string | null; endsOn: string | null;      // yyyy-mm-dd, the days people can buy (inclusive); null = open
  usableFrom: string | null;                            // yyyy-mm-dd the bonus can first be used; null = right away
  bonusDays: number;                                    // the bonus ends this many days after it can first be used
  online: boolean; desk: boolean; on: boolean;
};

const day = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const cents = (v: any) => Math.max(0, Math.min(500000, Math.round(Number(v) || 0)));

export function cleanOffers(raw: any): GiftOffer[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).map((o: any, i: number) => {
    const tiers = (Array.isArray(o?.tiers) ? o.tiers : []).slice(0, 4).map((t: any) => ({ buyCents: cents(t?.buyCents), bonusCents: cents(t?.bonusCents) }))
      .filter((t: OfferTier) => t.buyCents >= 100 && t.bonusCents >= 100 && t.bonusCents <= t.buyCents).sort((a: OfferTier, b: OfferTier) => a.buyCents - b.buyCents);
    return {
      id: typeof o?.id === 'string' && /^[a-z0-9-]{1,30}$/.test(o.id) ? o.id : `offer-${i + 1}`,
      name: String(o?.name || 'Gift card bonus').trim().slice(0, 40) || 'Gift card bonus', tiers,
      startsOn: day(o?.startsOn), endsOn: day(o?.endsOn), usableFrom: day(o?.usableFrom),
      bonusDays: Math.max(14, Math.min(730, Math.round(Number(o?.bonusDays) || 90))),
      online: o?.online !== false, desk: o?.desk !== false, on: o?.on !== false,
    };
  }).filter((o) => o.tiers.length > 0);
}

/** Today's date where the business is (yyyy-mm-dd). */
export function todayIn(timeZone?: string | null, at: Date = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at); }
  catch { return at.toISOString().slice(0, 10); }
}

/** The offer running now for this channel (the first one on, in its dates). */
export function liveOffer(settings: any, channel: 'online' | 'desk', today: string): GiftOffer | null {
  for (const o of cleanOffers(settings?.offers)) {
    if (!o.on || !o[channel]) continue;
    if (o.startsOn && today < o.startsOn) continue;
    if (o.endsOn && today > o.endsOn) continue;
    return o;
  }
  return null;
}

/** The bonus a gift card of this amount earns: the biggest tier it reaches. */
export function bonusFor(o: GiftOffer | null, amountCents: number) {
  if (!o) return 0; let b = 0; for (const t of o.tiers) if (amountCents >= t.buyCents) b = t.bonusCents; return b;
}

const $ = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
/** "Buy $100, get $20 for you" (one tier) or "Get up to $50 for you" (several). */
export function offerLine(o: GiftOffer) {
  if (o.tiers.length === 1) return `Buy a ${$(o.tiers[0].buyCents)} gift card, get ${$(o.tiers[0].bonusCents)} for you`;
  return `Get up to ${$(o.tiers[o.tiers.length - 1].bonusCents)} for you when you buy a gift card`;
}
export function tierLines(o: GiftOffer) { return o.tiers.map((t) => `${$(t.buyCents)} → ${$(t.bonusCents)} for you`); }

/** When a bonus made today can be used, and when it ends (ISO). */
export function bonusDates(o: GiftOffer, today: string) {
  const from = o.usableFrom && o.usableFrom > today ? o.usableFrom : today;
  const end = new Date(`${from}T23:59:59Z`); end.setUTCDate(end.getUTCDate() + o.bonusDays);
  return { usableFrom: from > today ? `${from}T00:00:00.000Z` : null, expiresAt: end.toISOString() };
}
const nice = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
/** "Use it from January 1 to March 31, 2027" / "Use it by March 31, 2027". */
export function bonusWhen(g: { usableFrom?: string | null; expiresAt?: string | null }) {
  if (g.usableFrom && g.expiresAt) return `Use it from ${nice(g.usableFrom).replace(/, \d{4}$/, '')} to ${nice(g.expiresAt)}`;
  return g.expiresAt ? `Use it by ${nice(g.expiresAt)}` : '';
}
/** The public part of a running offer (the shop and the desk show it). */
export function pubOffer(o: GiftOffer | null) {
  return o ? { id: o.id, name: o.name, tiers: o.tiers, line: offerLine(o), usableFrom: o.usableFrom, bonusDays: o.bonusDays, endsOn: o.endsOn } : null;
}
