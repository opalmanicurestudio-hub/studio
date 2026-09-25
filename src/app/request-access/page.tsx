// src/app/request-access/page.tsx — early access, by request.
import type { Metadata } from 'next';
import { RequestAccess } from '@/components/marketing/RequestAccess';

export const metadata: Metadata = {
  title: 'Request early access — ClarityFlow',
  description: 'ClarityFlow is in early access. Tell us about your business and we’ll set you up personally.',
};

export default async function RequestAccessPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const t = String((await searchParams)?.type || '');
  return <RequestAccess initialType={['salon', 'spa', 'fitness', 'shop'].includes(t) ? t : ''} />;
}
