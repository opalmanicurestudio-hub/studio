// src/app/for/[niche]/page.tsx
//
// A landing page per kind of business — /for/salons, /for/spas, /for/fitness,
// /for/shops. The same journey, already set to that business (no splash —
// people arrive here from an ad or a search and should see their world at
// once), with its own title and search description.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Journey } from '@/components/marketing/Journey';
import { NICHES, NICHE_ORDER } from '@/components/marketing/niches';

const bySlug = (slug: string) => NICHE_ORDER.map((k) => NICHES[k]).find((n) => n.slug === slug) || null;

export function generateStaticParams() {
  return NICHE_ORDER.map((k) => ({ niche: NICHES[k].slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ niche: string }> }): Promise<Metadata> {
  const n = bySlug((await params).niche);
  if (!n) return {};
  return { title: n.title, description: n.description, openGraph: { title: n.title, description: n.description, type: 'website' } };
}

export default async function NichePage({ params }: { params: Promise<{ niche: string }> }) {
  const n = bySlug((await params).niche);
  if (!n) notFound();
  return <Journey initialNiche={n.key} />;
}
