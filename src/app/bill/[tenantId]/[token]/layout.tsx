// src/app/bill/[tenantId]/[token]/layout.tsx — a table's check, paid on a guest's own phone: kept out of search, and the
// link's address never goes along to the fonts or pictures the page loads.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your check',
  description: 'Pay your share of the check.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
