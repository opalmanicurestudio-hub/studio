// src/components/gift/gift-brand.ts — a gift card page's look (the card page, the wallet) from the card's answer: the
// business's color, mood and logo, or a renter's name on a card the renter sold.
import type { VisitBrand } from '@/components/booking/VisitShell';

export function giftBrand(d: any, fallback: VisitBrand): VisitBrand {
  if (!d?.brand) return fallback;
  const logo = typeof d.brand.logo === 'string' && /^(https:\/\/|\/(?![/\\]))/.test(d.brand.logo) ? d.brand.logo : null;
  return { accent: d.brand.accent || fallback.accent, mood: d.brand.mood || fallback.mood || 'soft', logo, studioName: d.brand.name || fallback.studioName,
    bookHref: d.bookUrl || fallback.bookHref, phone: d.brand.phone || null, zone: null };
}
