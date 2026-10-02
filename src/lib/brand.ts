// src/lib/brand.ts — WHICH LOGO GUESTS SEE. One rule for every guest-facing page (kiosk, concierge, events & RSVPs,
// inquiries, quotes, job applications, table requests): the logo set specially for guest screens if there is one
// (Settings → Check-in kiosk), otherwise the business logo (Settings → Your business), otherwise the booking page's.
// Before this, some pages read only one and some only the other — so a business could show two different logos.
export function guestLogo(t: any): string | undefined {
  return t?.kioskSettings?.logoUrl || t?.logoUrl || t?.bookingPageSettings?.cfPageConfig?.logoUrl || undefined;
}
