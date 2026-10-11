// src/lib/gift-visit.ts — "I'M BOOKING WITH MY GIFT CARD". The gift card page and wallet link to booking with ?gift=<cents
// left>. The booking page remembers it for this visit (this tab only) so it can mark the services the card covers and
// open the gift card box on the deposit step. Display only: nothing is charged from it; the code is still checked.
export function giftCentsFor(tenantId: string): number {
  if (typeof window === 'undefined' || !tenantId) return 0;
  const key = `gift-visit:${tenantId}`;
  try {
    const q = new URLSearchParams(window.location.search).get('gift');
    if (q !== null) { const n = Math.max(0, Math.min(1000000, Math.round(Number(q) || 0))); sessionStorage.setItem(key, String(n)); return n; }
    return Math.max(0, Number(sessionStorage.getItem(key)) || 0);
  } catch { return 0; }
}
/** A booking link that carries the card's balance along. */
export function withGift(url: string, cents: number) {
  if (!(cents > 0)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}gift=${Math.round(cents)}${/[?&]src=/.test(url) ? '' : '&src=gift'}`;
}
export const giftMoney = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
/** The card page remembers its code for this tab, so the booking deposit step can fill it in with one tap. */
export function rememberGiftCode(tenantId: string, code: string) { try { sessionStorage.setItem(`gift-code:${tenantId}`, code); } catch { /* private mode */ } }
export function rememberedGiftCode(tenantId: string): string { try { return sessionStorage.getItem(`gift-code:${tenantId}`) || ''; } catch { return ''; } }
