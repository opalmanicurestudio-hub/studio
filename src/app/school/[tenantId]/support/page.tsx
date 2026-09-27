// src/app/school/[tenantId]/support/page.tsx — gifts and sponsorships for students.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSite } from '../data';
import { Section, base } from '@/components/school/Site';
export const metadata: Metadata = { title: 'Support our students' };
export default async function Support({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const site = (await getSite(tenantId))!; const D = site.settings.donors; const b = base(tenantId);
  if (!D.enabled) notFound();
  return (
    <>
      <Section eyebrow="Support our students" title={<>Help a student <b>finish strong</b></>}>
        <p className="max-w-3xl text-lg text-stone-700">Gifts from people and local businesses help students with tuition, professional kits, board exam fees and emergencies that could stop them finishing.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{D.funds.map((f, i) => <div key={f.name} className="sch-card sch-rise p-5" style={{ animationDelay: `${i * 60}ms` }}><p className="font-semibold">{f.name}</p><p className="mt-1 text-[14px] text-stone-700">{f.text}</p></div>)}</div>
        <div className="mt-6 flex flex-wrap gap-3"><Link href={`${b}/contact?topic=donate`} className="rounded-full px-6 py-3.5 text-[15px] font-medium text-white" style={{ background: 'var(--accent)' }}>Talk to us about giving</Link><Link href={`${b}/contact?topic=sponsor`} className="rounded-full bg-white px-6 py-3.5 text-[15px] shadow-sm">Business sponsorship</Link></div>
      </Section>
      {D.howAwarded && <Section eyebrow="How awards work" title={<>How gifts reach <b>students</b></>}><p className="max-w-3xl whitespace-pre-line text-stone-700">{D.howAwarded}</p></Section>}
      {D.useReport && <Section eyebrow="Where it went" title={<>How gifts have been <b>used</b></>}><p className="max-w-3xl whitespace-pre-line text-stone-700">{D.useReport}</p></Section>}
      <Section><p className="sch-card max-w-3xl p-5 text-[14px] text-stone-700">{D.nonprofit && D.ein
        ? <>{site.identity.legalName || site.name} is a tax-exempt nonprofit organisation (EIN {D.ein}). Gifts may be tax-deductible to the extent allowed by law — please check with your tax adviser.</>
        : <>{site.name} is not a tax-exempt charity, so gifts are <b>not</b> tax-deductible.</>}</p></Section>
    </>
  );
}
