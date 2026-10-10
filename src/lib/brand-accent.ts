// src/lib/brand-accent.ts — THE BUSINESS'S COLOUR for screens shown before anyone signs in (staff portal sign-in, the
// shared tablet). Same source as the app's Studio look (booking-page accent); falls back to ink when white text on it
// wouldn't be readable (WCAG 4.5:1).
export function brandAccent(t: any): string {
  const c = t?.bookingPageSettings?.cfPageConfig?.accentColor || t?.bookingPageSettings?.theme?.primaryColor || t?.brandColor || '';
  const hex = typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c.trim()) ? (c.trim().startsWith('#') ? c.trim() : `#${c.trim()}`) : '';
  if (!hex) return '#16171a';
  const n = parseInt(hex.slice(1), 16); const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  return 1.05 / (L + 0.05) >= 4.5 ? hex : '#16171a';
}
export function brandLogo(t: any): string | null {
  return t?.bookingPageSettings?.logoUrl || t?.kioskSettings?.logoUrl || t?.logoUrl || null;
}
