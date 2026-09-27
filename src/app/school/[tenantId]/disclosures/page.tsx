// src/app/school/[tenantId]/disclosures/page.tsx — the school's required disclosures.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite } from '../data';
import { Section } from '@/components/school/Site';
import { mdLite } from '@/lib/doc-theme';
export const metadata: Metadata = { title: 'Disclosures' };
export default async function Disclosures({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const site = (await getSite(tenantId))!;
  if (!site.settings.disclosures) notFound();
  // mdLite escapes everything first — nothing here can run as code.
  return <Section eyebrow="Disclosures" title={<>Consumer <b>information</b></>}><article className="sch-card prose max-w-3xl p-6 text-stone-800 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-3" dangerouslySetInnerHTML={{ __html: mdLite(site.settings.disclosures) }} /></Section>;
}
