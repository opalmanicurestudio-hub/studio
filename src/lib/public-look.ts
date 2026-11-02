// src/lib/public-look.ts — THE BUSINESS'S LOOK ON A PAGE A CLIENT OPENS FROM A LINK (find my booking, the waitlist,
// gift cards, a forwarded old link): its name, color, mood and logo — the same as its booking page and visit link —
// in the small shape such a page needs, so the page never receives the business's settings themselves. Works on the
// server (routes send it) and in the browser (components/booking/VisitShell brandFromLook turns it into the look).
import { brandColor, studioPage } from '@/lib/studio-page';
import { hasTimeZone, tenantTimeZone } from '@/lib/tenant-time';

export type PublicLook = { name: string; accent: string; mood: 'soft' | 'crisp' | 'night'; logoUrl: string | null; zone: string | null };

export function publicLook(t: any): PublicLook {
  const d = t || {};
  const mood = studioPage(d).mood;
  const logo = d.logoUrl || null;   // the same logo the booking page and visit link show
  return {
    name: String(d.name || d.businessName || ''),
    accent: brandColor(d),
    mood: mood === 'crisp' || mood === 'night' ? mood : 'soft',
    logoUrl: typeof logo === 'string' && /^(https:\/\/|\/(?![/\\]))/.test(logo) ? logo : null,
    zone: hasTimeZone(d) ? tenantTimeZone(d) : null,
  };
}

/** A look as a page received it (from the server or this device's memory): only the shape above, never anything else. */
export function cleanLook(x: any): PublicLook | null {
  if (!x || typeof x !== 'object' || typeof x.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(x.accent)) return null;
  const logo = typeof x.logoUrl === 'string' && /^(https:\/\/|\/(?![/\\]))/.test(x.logoUrl) ? x.logoUrl : null;
  return { name: String(x.name || '').slice(0, 120), accent: x.accent, mood: x.mood === 'crisp' || x.mood === 'night' ? x.mood : 'soft', logoUrl: logo,
    zone: typeof x.zone === 'string' && x.zone.length < 64 ? x.zone : null };
}
