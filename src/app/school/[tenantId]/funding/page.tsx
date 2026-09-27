// src/app/school/[tenantId]/funding/page.tsx — scholarships, funding, payment options.
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSite } from '../data';
import { Section, base, when } from '@/components/school/Site';
import { usd } from '@/lib/school-site';
export const metadata: Metadata = { title: 'Funding & scholarships' };
export default async function Funding({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const site = (await getSite(tenantId))!; const S = site.settings; const b = base(tenantId);
  const plans = site.programs.filter((p) => p.costs.plan);
  return (
    <>
      <Section eyebrow="Funding" title={<>Ways to <b>pay for school</b></>}>
        <p className="sch-card max-w-3xl p-5 text-[15px] text-stone-700" role="note">ⓘ <b>Eligibility varies and funding isn’t guaranteed.</b> We’ll help you understand your options, but awards and funding decisions are made by each program or organisation.</p>
        <div className="mt-5 flex flex-wrap gap-3"><Link href={`${b}/contact?topic=funding`} className="rounded-full px-6 py-3.5 text-[15px] font-medium text-white" style={{ background: 'var(--accent)' }}>Book help finding funding</Link><Link href={`${b}/admissions`} className="rounded-full bg-white px-6 py-3.5 text-[15px] shadow-sm">See full costs</Link></div>
      </Section>
      {S.scholarships.length > 0 && <Section eyebrow="Our scholarships" title={<>Scholarships from <b>{site.name}</b></>}>
        <div className="grid gap-4 md:grid-cols-2">{S.scholarships.map((x) => <div key={x.name} className="sch-card space-y-2 p-6"><p className="text-lg font-semibold">{x.name}</p>{x.amountCents > 0 && <p className="text-2xl font-semibold" style={{ color: 'var(--accent)' }}>Up to {usd(x.amountCents)}</p>}{x.description && <p className="text-stone-700">{x.description}</p>}{x.eligibility && <p className="text-sm text-stone-600"><b>Who can apply:</b> {x.eligibility}</p>}{x.deadline && <p className="text-sm text-stone-600"><b>Deadline:</b> {when(x.deadline)}</p>}<Link href={`${b}/contact?topic=scholarship`} className="inline-block pt-1 text-sm font-medium underline underline-offset-4">Ask about this scholarship →</Link></div>)}</div>
      </Section>}
      {S.outsideScholarships.length > 0 && <Section eyebrow="Outside scholarships" title={<>Other scholarships <b>worth a look</b></>}>
        <div className="space-y-2">{S.outsideScholarships.map((x) => <div key={x.name} className="sch-card flex flex-wrap items-start justify-between gap-2 p-5"><div className="min-w-0"><p className="font-semibold">{x.url ? <a href={x.url} rel="noopener nofollow" target="_blank" className="underline-offset-4 hover:underline">{x.name} ↗</a> : x.name}</p>{x.notes && <p className="text-[15px] text-stone-700">{x.notes}</p>}{x.lastChecked && <p className="text-[12px] text-stone-500">Details last checked by our team on {when(x.lastChecked)} — confirm with the organisation before applying.</p>}</div>{x.amount && <span className="rounded-full bg-stone-100 px-3 py-1 text-sm">{x.amount}</span>}</div>)}</div>
      </Section>}
      {S.workforce.show && <Section eyebrow="Workforce funding" title={<>Workforce <b>funding</b></>}><p className="max-w-3xl whitespace-pre-line text-stone-700">{S.workforce.text}</p></Section>}
      {plans.length > 0 && <Section eyebrow="Payment plans" title={<>Spread the <b>cost</b></>}>
        <div className="grid gap-3 md:grid-cols-2">{plans.map((p) => <div key={p.id} className="sch-card p-5"><p className="font-semibold">{p.name}</p><p className="text-stone-700">{usd(p.costs.plan!.downCents)} down, then {p.costs.plan!.count} automatic payments of about {usd(p.costs.plan!.eachCents)} {p.costs.plan!.interval}.</p></div>)}</div>
      </Section>}
    </>
  );
}
