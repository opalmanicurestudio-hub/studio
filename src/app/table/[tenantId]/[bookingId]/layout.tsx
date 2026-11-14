// src/app/table/[tenantId]/[bookingId]/layout.tsx — a guest's own booking link: kept out of search, and the link's address
// never goes along to the fonts or pictures the page loads.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your booking',
  description: 'See, change or cancel your table booking.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
