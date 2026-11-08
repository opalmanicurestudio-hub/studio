// src/app/demo/page.tsx — THE LIVE DEMO: try ClarityFlow without signing up (components/marketing/DemoApp). Every
// "Try the demo" link lands here, with the visitor's kind of business (?type=salon|spa|fitness|shop) when it's known.
// Nothing is saved and nothing is sent; it all runs in the browser.
import type { Metadata } from 'next';
import { DemoApp } from '@/components/marketing/DemoApp';
import { NICHE_ORDER, type NicheKey } from '@/components/marketing/niches';

export const metadata: Metadata = {
  title: 'Try ClarityFlow',
  description: 'A working sample business you can click through: book as a client, accept it, check them out and bring them back. Nothing is saved.',
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const sp = await searchParams;
  const type = String(sp?.type || '');
  const niche: NicheKey = (NICHE_ORDER as string[]).includes(type) ? (type as NicheKey) : 'salon';
  return <DemoApp initialNiche={niche} />;
}
