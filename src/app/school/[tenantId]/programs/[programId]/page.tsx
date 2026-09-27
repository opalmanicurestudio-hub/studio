// src/app/school/[tenantId]/programs/[programId]/page.tsx — one program, in full.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSite } from '../../data';
import { Section, CostTable, CTA, base, when } from '@/components/school/Site';
import type { SchoolSite } from '@/lib/school-site';

export async function generateMetadata({ params }: { params: Promise<{ tenantId: string; programId: string }> }): Promise<Metadata> {
  const { tenantId, programId } = await params; const p = (await getSite(tenantId))?.programs.find((x) => x.id === programId);
  return { title: p?.name || 'Program', description: p?.description?.slice(0, 160) };
}

export default async function Program({ params }: { params: Promise<{ tenantId: string; programId: string }> }) {
  const { tenantId, programId } = await params; const site = (await getSite(tenantId))!;
  const found = site.programs.find((x) => x.id === programId); if (!found) notFound();
  const p: SchoolSite['programs'][number] = found;
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pb-4 pt-8 sm:pt-12">
        <Link href={`${base(tenantId)}#programs`} className="text-sm text-stone-600">← All programs</Link>
        <h1 className="sch-rise mt-3 text-4xl sm:text-5xl"><b>{p.name}</b></h1>
        <div className="sch-rise mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" style={{ animationDelay: '80ms' }}>
          {[[p.totalHours ? `${p.totalHours}` : '—', 'hours'], [p.weeks ? `~${p.weeks}` : '—', 'weeks'], [p.hoursPerWeek ? `${p.hoursPerWeek}` : '—', 'hours a week'], [p.costs.hasPrice ? `$${Math.round(p.costs.total / 100).toLocaleString()}` : 'Ask', 'total cost']].map(([v, l]) => <div key={l} className="sch-card p-4"><p className="text-2xl font-semibold tabular-nums">{v}</p><p className="text-[13px] text-stone-600">{l}</p></div>)}
        </div>
        {p.description && <p className="mt-6 max-w-3xl whitespace-pre-line text-lg text-stone-700">{p.description}</p>}
        <div className="mt-6"><CTA site={site} programId={p.id} /></div>
      </section>

      {(p.schedule || p.cohorts.length > 0) && <Section eyebrow="Schedule" title={<>When you’ll <b>train</b></>}>
        {p.schedule && <p className="mb-4 max-w-3xl whitespace-pre-line text-stone-700">{p.schedule}</p>}
        {p.cohorts.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{p.cohorts.map((c) => <div key={c.id} className="sch-card p-5"><p className="font-semibold">{c.name}</p><p className="text-sm text-stone-600">Starts {when(c.startDate)}</p>{c.schedule && <p className="mt-1 text-sm text-stone-700">{c.schedule}</p>}{c.seatsLeft != null && <p className={`mt-2 inline-block rounded-full px-3 py-1 text-[13px] ${c.seatsLeft === 0 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>{c.seatsLeft === 0 ? 'Full — waitlist open' : `${c.seatsLeft} place${c.seatsLeft === 1 ? '' : 's'} left`}</p>}</div>)}</div>}
      </Section>}

      {p.curriculum.length > 0 && <Section eyebrow="Curriculum" title={<>What you’ll <b>learn</b></>}>
        <div className="grid gap-4 md:grid-cols-2">{p.curriculum.map((c) => <div key={c.title} className="sch-card p-6"><p className="text-lg font-semibold">{c.title}</p>{c.summary && <p className="mt-1 text-[15px] text-stone-700">{c.summary}</p>}{c.modules.length > 0 && <ol className="mt-3 space-y-1.5 text-[15px]">{c.modules.map((m, i) => <li key={m} className="flex gap-2"><span className="w-6 shrink-0 text-stone-400 tabular-nums">{i + 1}.</span>{m}</li>)}</ol>}</div>)}</div>
      </Section>}

      {(p.requirements.length > 0 || p.clinic.length > 0) && <Section eyebrow="Hands-on clinic" title={<>Real clients, <b>real experience</b></>}>
        <p className="max-w-3xl text-stone-700">You’ll practise on real clients in our student clinic, with an instructor signing off every service.</p>
        {p.requirements.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{p.requirements.map((r) => <span key={r.label} className="rounded-full bg-white px-3 py-1.5 text-sm shadow-sm"><b>{r.count}</b> {r.label}</span>)}</div>}
        {p.clinic.length > 0 && <div className="mt-6"><p className="font-semibold">Book a service with our students</p><p className="text-sm text-stone-600">Lower prices, supervised by licensed instructors.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{p.clinic.map((s) => <Link key={s.id} href={`/book/${tenantId}?service=${s.id}`} className="sch-card flex items-center justify-between gap-2 p-4 hover:-translate-y-0.5"><span><b className="block">{s.name}</b><span className="text-[13px] text-stone-600">{s.duration ? `${s.duration} min · ` : ''}${s.price.toFixed(s.price % 1 ? 2 : 0)}</span></span><span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>Book →</span></Link>)}</div></div>}
      </Section>}

      <Section eyebrow="Cost" title={<>The <b>full cost</b></>}>
        <div className="max-w-2xl"><CostTable p={p} /></div>
        <p className="mt-3 text-sm text-stone-600"><Link href={`${base(tenantId)}/funding`} className="underline underline-offset-2">Scholarships and funding help →</Link></p>
      </Section>

      <Section eyebrow="Admission" title={<>What you’ll <b>need</b></>}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="sch-card p-6"><p className="font-semibold">Documents</p><ul className="mt-2 space-y-1 text-stone-700">{p.requiredDocs.map((d) => <li key={d}>• {d}</li>)}</ul></div>
          <div className="sch-card p-6"><p className="font-semibold">Requirements</p><ul className="mt-2 space-y-1 text-stone-700">{p.checks.map((c) => <li key={c}>• {c}</li>)}</ul></div>
        </div>
        <p className="mt-3 text-sm text-stone-600">Applying doesn’t guarantee a place — every application is reviewed. <Link href={`${base(tenantId)}/admissions`} className="underline underline-offset-2">How admissions works →</Link></p>
      </Section>

      {p.licensing && <Section eyebrow="Licensing" title={<>After you <b>graduate</b></>}><p className="max-w-3xl whitespace-pre-line text-stone-700">{p.licensing}</p></Section>}

      {site.instructors.length > 0 && <Section eyebrow="Instructors" title={<>Learn from <b>professionals</b></>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{site.instructors.map((m) => <div key={m.id} className="sch-card flex gap-4 p-5">{m.photo ? <img src={m.photo} alt={m.name} className="h-16 w-16 shrink-0 rounded-full object-cover" /> : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xl">{m.name?.[0]}</span>}<div><p className="font-semibold">{m.name}</p><p className="text-[13px] text-stone-600">{m.title}</p>{m.bio && <p className="mt-1 line-clamp-4 text-[14px] text-stone-700">{m.bio}</p>}</div></div>)}</div>
      </Section>}

      <Section><div className="sch-card flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center sm:justify-between"><p className="text-2xl">Ready to take the <b>next step?</b></p><CTA site={site} programId={p.id} /></div></Section>
    </>
  );
}
