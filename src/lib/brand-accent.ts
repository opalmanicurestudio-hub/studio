// src/lib/brand-accent.ts — THE BUSINESS'S COLOUR for screens shown before anyone signs in (staff portal sign-in, the
// shared tablet). Same source as the app's Studio look (lib/studio-page: the booking page's color), darkened just
// enough that white text on it stays readable (WCAG 4.5:1); ink when the business hasn't chosen one.
import { brandColor } from '@/lib/studio-page';

export function brandAccent(t: any): string {
  return brandColor(t);
}
export function brandLogo(t: any): string | null {
  return t?.bookingPageSettings?.logoUrl || t?.kioskSettings?.logoUrl || t?.logoUrl || null;
}
