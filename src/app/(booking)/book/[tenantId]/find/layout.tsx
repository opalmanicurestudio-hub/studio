import type { Metadata } from 'next';
import React from 'react';

// Find my booking is a form, not something to find in a search: kept out of search results, and its links still followed.
export const metadata: Metadata = { title: 'Find my booking', robots: { index: false, follow: true } };

export default function FindLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
