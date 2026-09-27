// src/app/school/[tenantId]/student-life/page.tsx — instructors, work, stories, clinic.
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSite } from '../data';
import { Section, Photo } from '@/components/school/Site';
import { featuredWork } from '@/lib/school-site';
export const metadata: Metadata = { title: 'Student life' };
export default async function StudentLife({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const site = (await getSite(tenantId))!; const S = site.settings;
  const work = await featuredWork(tenantId, 12).catch(() => []);
  const clinic = [...new Map(site.programs.flatMap((p) => p.clinic).map((s) => [s.id, s])).values()];
  return (
    <>
      {site.instructors.length > 0 && <Section eyebrow="Instructors" title={<>Meet your <b>instructors</b></>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{site.instructors.map((m) => <div key={m.id} className="sch-card p-5 text-center">{m.photo ? <img src={m.photo} alt={m.name} className="mx-auto h-24 w-24 rounded-full object-cover" /> : <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-stone-100 text-3xl">{m.name?.[0]}</span>}<p className="mt-3 text-lg font-semibold">{m.name}</p><p className="text-[13px] text-stone-600">{m.title}</p>{m.bio && <p className="mt-2 text-[14px] text-stone-700">{m.bio}</p>}</div>)}</div>
      </Section>}
      {work.length > 0 && <Section eyebrow="Student work" title={<>Made by our <b>students</b></>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{work.map((w: any) => <figure key={w.id} className="sch-card overflow-hidden"><div className="grid grid-cols-2">{w.before && <img src={w.before} alt={`Before — ${w.service}`} className="aspect-square w-full object-cover" loading="lazy" />}{w.after && <img src={w.after} alt={`After — ${w.service}`} className="aspect-square w-full object-cover" loading="lazy" />}</div><figcaption className="px-3 py-2 text-[13px]">{w.service} · <span className="text-stone-500">{w.by}</span></figcaption></figure>)}</div>
        <p className="mt-3 text-[12px] text-stone-500">Shared with our students’ and clients’ permission.</p>
      </Section>}
      {S.stories.length > 0 && <Section eyebrow="Graduates" title={<>Graduate <b>stories</b></>}>
        <div className="grid gap-4 md:grid-cols-2">{S.stories.map((st, i) => <blockquote key={i} className="sch-card flex gap-4 p-6">{st.photoId && <Photo site={site} id={st.photoId} alt={st.name} className="h-16 w-16 shrink-0 rounded-full object-cover" />}<div><p className="leading-relaxed text-stone-800">“{st.quote}”</p><footer className="mt-2 text-sm text-stone-600">— <b>{st.name}</b>{st.program ? `, ${st.program}` : ''}{st.year ? ` (${st.year})` : ''}</footer></div></blockquote>)}</div>
      </Section>}
      {S.photos.length > 0 && <Section eyebrow="Our school" title={<>Take a <b>look around</b></>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{S.photos.map((ph) => <figure key={ph.id}><Photo site={site} id={ph.id} alt={ph.caption || site.name} className="aspect-[4/3] w-full rounded-2xl object-cover" />{ph.caption && <figcaption className="mt-1 text-[13px] text-stone-600">{ph.caption}</figcaption>}</figure>)}</div>
      </Section>}
      {clinic.length > 0 && <Section eyebrow="Student clinic" title={<>Book a service with <b>our students</b></>}>
        <p className="max-w-3xl text-stone-700">Our students work on real clients under licensed instructors — at student prices.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{clinic.map((s) => <Link key={s.id} href={`/book/${tenantId}?service=${s.id}`} className="sch-card flex items-center justify-between gap-2 p-4"><span><b className="block">{s.name}</b><span className="text-[13px] text-stone-600">{s.duration ? `${s.duration} min · ` : ''}${s.price.toFixed(s.price % 1 ? 2 : 0)}</span></span><span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>Book →</span></Link>)}</div>
      </Section>}
    </>
  );
}
