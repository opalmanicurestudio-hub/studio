// src/app/school/[tenantId]/support/page.tsx — gifts and sponsorships for students.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSite } from '../data';
import { Section, base } from '@/components/school/Site';
import { GiveForm, GiftThanks } from '@/components/school/Forms';
import { sponsorsList } from '@/lib/school-site';
import { GENERAL } from '@/lib/academy-funding';
export const metadata: Metadata = { title: 'Support our students' };
export default async function Support({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { tenantId } = await params; const q = await searchParams; const site = (await getSite(tenantId))!; const D = site.settings.donors; const b = base(tenantId);
  if (!D.enabled) notFound();
  const sponsors = await sponsorsList(tenantId).catch(() => [] as string[]);
  const funds = [...D.funds.map((f) => f.name), GENERAL];
  return (
    <>
      <Section eyebrow="Support our students" title={<>Help a student <b>finish strong</b></>}>
        <p className="max-w-3xl text-lg text-stone-700">Gifts from people and local businesses help students with tuition, professional kits, board exam fees and emergencies that could stop them finishing.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{D.funds.map((f, i) => <div key={f.name} className="sch-card sch-rise p-5" style={{ animationDelay: `${i * 60}ms` }}><p className="font-semibold">{f.name}</p><p className="mt-1 text-[14px] text-stone-700">{f.text}</p></div>)}</div>
        {site.canGive && <div id="give" className="mt-8 grid gap-6 lg:grid-cols-2 lg:items-start"><div className="space-y-2"><h2 className="text-2xl">Give <b>online</b></h2><p className="text-stone-600">Choose an amount and where it goes. Every gift is receipted by email.</p></div>{q.gift ? <GiftThanks tenantId={tenantId} sessionId={q.gift} /> : <GiveForm tenantId={tenantId} funds={funds} nonprofit={D.nonprofit && !!D.ein} />}</div>}
        <div className="mt-6 flex flex-wrap gap-3"><Link href={`${b}/contact?topic=donate`} className="rounded-full px-6 py-3.5 text-[15px] font-medium text-white" style={{ background: 'var(--accent)' }}>Talk to us about giving</Link><Link href={`${b}/contact?topic=sponsor`} className="rounded-full bg-white px-6 py-3.5 text-[15px] shadow-sm">Business sponsorship</Link></div>
      </Section>
      {sponsors.length > 0 && <Section eyebrow="Thank you" title={<>Our <b>supporters</b></>}><ul className="flex flex-wrap gap-2">{sponsors.map((n) => <li key={n} className="rounded-full bg-white px-4 py-2 text-[15px] shadow-sm">{n}</li>)}</ul></Section>}
      {D.howAwarded && <Section eyebrow="How awards work" title={<>How gifts reach <b>students</b></>}><p className="max-w-3xl whitespace-pre-line text-stone-700">{D.howAwarded}</p></Section>}
      {D.useReport && <Section eyebrow="Where it went" title={<>How gifts have been <b>used</b></>}><p className="max-w-3xl whitespace-pre-line text-stone-700">{D.useReport}</p></Section>}
      <Section><p className="sch-card max-w-3xl p-5 text-[14px] text-stone-700">{D.nonprofit && D.ein
        ? <>{site.identity.legalName || site.name} is a tax-exempt nonprofit organisation (EIN {D.ein}). Gifts may be tax-deductible to the extent allowed by law — please check with your tax adviser.</>
        : <>{site.name} is not a tax-exempt charity, so gifts are <b>not</b> tax-deductible.</>}</p></Section>
    </>
  );
}
