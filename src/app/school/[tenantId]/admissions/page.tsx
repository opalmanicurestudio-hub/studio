// src/app/school/[tenantId]/admissions/page.tsx — how to join, and what it costs.
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSite } from '../data';
import { Section, CostTable, CTA, base, when } from '@/components/school/Site';
export const metadata: Metadata = { title: 'Admissions & costs' };
const STEPS = [
  ['Visit or ask', 'Book a tour or send a question — no commitment.'],
  ['Apply', 'A short online application. No payment to apply.'],
  ['Send your documents', 'Upload them securely on your private application page.'],
  ['We review your application', 'Our admissions team checks every application and may invite you to a short interview.'],
  ['Our decision', 'We email you. Applying doesn’t guarantee a place — some applicants are waitlisted when a class is full.'],
  ['Accept your place', 'If offered a place, you accept it online before the deadline in your letter.'],
  ['Sign and pay', 'Sign your enrolment agreement and make your down payment — then you’re enrolled.'],
];
export default async function Admissions({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const site = (await getSite(tenantId))!; const S = site.settings;
  return (
    <>
      <Section eyebrow="Admissions" title={<>How to <b>join us</b></>}>
        <ol className="grid gap-3 md:grid-cols-2">{STEPS.map(([t, d], i) => <li key={t} className="sch-card sch-rise flex gap-4 p-5" style={{ animationDelay: `${i * 60}ms` }}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ background: 'var(--accent)' }}>{i + 1}</span><span><b className="block">{t}</b><span className="text-[15px] text-stone-700">{d}</span></span></li>)}</ol>
        <div className="mt-6"><CTA site={site} /></div>
      </Section>
      {site.cohorts.length > 0 && <Section eyebrow="Dates" title={<>Upcoming <b>starts</b></>}>
        <div className="sch-card overflow-hidden"><table className="w-full text-[15px]"><thead className="bg-stone-50 text-left text-[13px] text-stone-600"><tr><th className="px-5 py-3">Program</th><th className="px-5 py-3">Starts</th><th className="px-5 py-3">Places</th></tr></thead><tbody>
          {site.cohorts.map((c) => <tr key={c.id} className="border-t border-stone-100"><td className="px-5 py-3">{site.programs.find((p) => p.id === c.programId)?.name || '—'}<span className="block text-[13px] text-stone-500">{c.name}{c.schedule ? ` · ${c.schedule}` : ''}</span></td><td className="px-5 py-3">{when(c.startDate)}</td><td className="px-5 py-3">{c.seatsLeft == null ? 'Open' : c.seatsLeft === 0 ? 'Full — waitlist' : `${c.seatsLeft} left`}</td></tr>)}
        </tbody></table></div>
        <p className="mt-2 text-sm text-stone-600">Applications are reviewed in the order they’re completed, so applying early helps.</p>
      </Section>}
      <Section eyebrow="Costs" title={<>Every cost, <b>up front</b></>}>
        <div className="grid gap-6 lg:grid-cols-2">{site.programs.map((p) => <div key={p.id} className="space-y-2"><Link href={`${base(tenantId)}/programs/${p.id}`} className="text-lg font-semibold underline-offset-4 hover:underline">{p.name}</Link><CostTable p={p} /></div>)}</div>
        <p className="mt-4 text-sm text-stone-600">Questions about paying? <Link href={`${base(tenantId)}/funding`} className="underline underline-offset-2">Scholarships, funding and payment options →</Link></p>
      </Section>
      {S.faq.length > 0 && <Section eyebrow="Questions" title={<>Common <b>questions</b></>}>
        <div className="space-y-2">{S.faq.map((f, i) => <details key={i} className="sch-card group p-5"><summary className="cursor-pointer list-none text-[16px] font-semibold marker:hidden">{f.q}<span className="float-right transition group-open:rotate-45">+</span></summary><p className="mt-2 whitespace-pre-line text-stone-700">{f.a}</p></details>)}</div>
      </Section>}
    </>
  );
}
