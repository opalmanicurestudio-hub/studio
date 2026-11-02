// ─── src/lib/email-shell.ts ──────────────────────────────────────────────────
// THE SHOP'S EMAILS (receipts, cart recovery, claim decisions, return labels, and whatever comes next), drawn by the
// same frame as every other email the business sends (lib/email-template emailFrame, ClientEmails board 15G): the
// shop's color in a line across the top and on the button, its logo and name, the news in big type, and its name
// at the foot. Multi-tenancy done properly:
//
//   · The brand is THE TENANT'S, resolved per send from their own document: shop name from businessName, color
//     from their storefront theme. Never ClarityFlow's brand, never a cached other tenant's.
//   · Button text color is COMPUTED from the brand color's luminance, so a shop with a pale-lemon brand doesn't
//     send white-on-yellow email; words in its color turn ink when the color is too pale to read on white.
//   · Email clients are hostile terrain: tables, inline styles, a 560px column. Jakarta first; clients that strip
//     webfonts (Gmail, Outlook) fall back to the system stack.
//
// Senders build only their BODY html and hand it here. One place to change the look; zero drift between senders.

import { brandOf } from '@/lib/shop-site';
import { EMAIL_FONT, emailFrame, emailPill, readableOn } from '@/lib/email-template';

/** logoUrl: the shop's logo (the header is white, so its regular version); show: as the shop shows it. */
export type EmailBrand = { shopName: string; brandColor: string; logoUrl?: string; show?: 'mark+name' | 'mark' | 'name' };

/** Per-send tenant brand lookup. Fallbacks keep emails sending when a tenant
 *  has no theme: ink header, honest name. */
/** Derive the brand from a tenant object already in hand — zero reads.
 *  getEmailBrand delegates here; senders holding the tenant (the webhook
 *  does) call this directly instead of paying a second fetch per email. */
export function brandFromTenant(t: any): EmailBrand {
  let shopName = 'Your shop';
  let brandColor = '#16171a';
  try {
    shopName = String(t?.businessName || t?.name || shopName);
    const c = t?.retailSettings?.shopTheme?.brand;
    if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.trim())) brandColor = c.trim();
    // The shop's logo by its name, on the white header (so its regular version, never the light one).
    const b = brandOf(t);
    if (b.logoUrl && b.show !== 'name') return { shopName, brandColor, logoUrl: b.logoUrl, show: b.show };
  } catch { /* never block an email on cosmetics */ }
  return { shopName, brandColor };
}

export async function getEmailBrand(db: any, tenantId: string): Promise<EmailBrand> {
  try {
    const snap = await db.collection('tenants').doc(tenantId).get();
    if (snap.exists) return brandFromTenant(snap.data() || {});
  } catch {
    // brand lookup is never allowed to block an email
  }
  return brandFromTenant({});
}

/** White or ink, whichever actually reads on the given background. */
export function readableTextOn(bgHex: string): string {
  return readableOn(bgHex);
}

/** The one button, in the shop's color. href may arrive escaped already (&amp;); it's escaped once either way. */
export function emailButton(href: string, label: string, brand: EmailBrand): string {
  return emailPill(String(href || '').replace(/&amp;/g, '&'), String(label || '').replace(/&amp;/g, '&'), brand.brandColor);
}

/**
 * The shell. bodyHtml is trusted internal markup from our own senders —
 * customer-entered text must be escaped by the CALLER before interpolation
 * (the claim-decision sender already does).
 */
export function brandedEmail(brand: EmailBrand, bodyHtml: string, opts?: { preheader?: string; title?: string; tag?: string }): string {
  const accent = /^#[0-9a-f]{6}$/i.test(String(brand.brandColor || '').trim()) ? String(brand.brandColor).trim() : '#16171a';
  /* The news itself in big type ("Out for delivery today") when a sender passes a title, with the small line above it
   * in the shop's color (usually the order number). Callers that pass neither get the body under the shop's name.
   * title and tag are trusted markup from our own senders, as before; the preheader is plain text (it can quote a
   * customer's message), so it's escaped here. */
  return emailFrame({
    look: { name: brand.shopName || 'Your shop', accent, logoUrl: brand.logoUrl || null, show: brand.show },
    preheader: String(opts?.preheader || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]), eyebrowHtml: opts?.tag || '', titleHtml: opts?.title || '',
    contentHtml: `<div style="margin:${opts?.title ? 14 : 0}px 0 0;font-family:${EMAIL_FONT};font-size:15px;line-height:1.6;color:#2c2d31">${bodyHtml}</div>`,
  });
}
