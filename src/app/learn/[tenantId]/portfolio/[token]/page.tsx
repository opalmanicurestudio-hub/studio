// src/app/learn/[tenantId]/portfolio/[token]/page.tsx — a student's shared portfolio (approved work only).
import type { Metadata } from 'next';
import { PortfolioPublic } from '@/components/academy/Portfolio';

export const metadata: Metadata = { title: 'Portfolio', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ tenantId: string; token: string }> }) {
  const { tenantId, token } = await params;
  return <PortfolioPublic tenantId={tenantId} token={token} />;
}
