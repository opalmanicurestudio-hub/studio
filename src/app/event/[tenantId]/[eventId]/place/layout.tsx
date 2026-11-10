// src/app/event/[tenantId]/[eventId]/place/layout.tsx — a guest's own place: the link carries its key, so the page is
// kept out of search engines and never passes its address on to another site.
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Your place', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function PlaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
