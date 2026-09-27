// src/app/school/[tenantId]/careers/page.tsx — open roles, from the hiring funnel.
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSite } from '../data';
import { Section } from '@/components/school/Site';
export const metadata: Metadata = { title: 'Teach with us' };
export default async function Careers({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const site = (await getSite(tenantId))!;
  return (
    <Section eyebrow="Careers" title={<>Teach with <b>us</b></>}>
      {site.jobs.length === 0 ? <div className="sch-card p-6"><p className="text-stone-700">No open roles right now — but we’re always glad to hear from great educators.</p><Link href={`/apply/${tenantId}`} className="mt-3 inline-block font-medium underline underline-offset-4">Send us your details →</Link></div> :
        <div className="grid gap-4 md:grid-cols-2">{site.jobs.map((j) => <div key={j.id} className="sch-card space-y-2 p-6"><p className="text-xl font-semibold">{j.title}</p><p className="text-sm text-stone-600">{[j.pay, j.schedule].filter(Boolean).join(' · ')}</p>{j.description && <p className="line-clamp-5 whitespace-pre-line text-stone-700">{j.description}</p>}{j.requirements && <p className="text-sm text-stone-600"><b>You’ll need:</b> {j.requirements}</p>}<Link href={`/apply/${tenantId}?job=${j.id}`} className="inline-block rounded-full px-5 py-3 text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>Apply for this role</Link></div>)}</div>}
    </Section>
  );
}
