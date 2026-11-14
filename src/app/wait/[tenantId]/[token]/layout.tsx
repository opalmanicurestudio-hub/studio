// src/app/wait/[tenantId]/[token]/layout.tsx — a waiting guest's own link: kept out of search, and the card the link
// shows when it's texted says only what it is.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your place in line',
  description: 'See your place in line and how long the wait is.',
  robots: { index: false, follow: false },
  // The link's own address never goes along to the fonts or pictures the page loads.
  referrer: 'no-referrer',
};

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
