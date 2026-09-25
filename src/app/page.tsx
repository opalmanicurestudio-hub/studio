// src/app/page.tsx
//
// MARKETING LANDING PAGE — splash, "Run your business. Not five apps.", then
// a day at the visitor's own kind of business (salon · spa · fitness · shop).
// The experience is src/components/marketing/Journey.tsx; each niche's words
// are in src/components/marketing/niches.ts. Server component, so the page
// keeps a real title and link preview.

import type { Metadata } from 'next';
import { Journey } from '@/components/marketing/Journey';

export const metadata: Metadata = {
  title: 'ClarityFlow — run your business, not five apps',
  description: 'Bookings, payments, clients and your team in one calm place — for salons, spas, fitness studios and shops. Free during early access.',
  openGraph: {
    title: 'ClarityFlow — run your business, not five apps',
    description: 'Bookings, payments, clients and your team in one calm place. Free during early access.',
    type: 'website',
  },
};

export default function LandingPage() {
  return <Journey />;
}
