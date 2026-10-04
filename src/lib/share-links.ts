// src/lib/share-links.ts — SHAREABLE BOOKING LINKS. A link for a service, a category or a provider opens the booking
// page already on that thing; `src` says where the link lives (website, instagram, google, qr, email) and is kept on
// the booking as its channel, so Reports can show which channel brings clients.
export type LinkSource = 'website' | 'instagram' | 'google' | 'qr' | 'email' | 'sms' | 'other';
export const catSlug = (name: any) => String(name || 'services').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
export function bookingLink(origin: string, tenantId: string, x: { serviceId?: string | null; staffId?: string | null; category?: string | null; src?: LinkSource | string | null } = {}) {
  const q = new URLSearchParams();
  if (x.serviceId) q.set('service', String(x.serviceId)); if (x.staffId) q.set('provider', String(x.staffId)); if (x.category) q.set('category', catSlug(x.category)); if (x.src) q.set('src', String(x.src).slice(0, 24));
  const s = q.toString(); return `${origin.replace(/\/+$/, '')}/book/${encodeURIComponent(tenantId)}${s ? `?${s}` : ''}`;
}
/** The booking's channel from a link's `src` — a known value, or "link" for anything else. */
export function channelFrom(src: any): string { const v = String(src || '').toLowerCase().slice(0, 24); return ['website', 'instagram', 'google', 'qr', 'email', 'sms', 'campaign'].includes(v) ? v : v ? 'link' : 'booking-page'; }
