// src/app/school/[tenantId]/page.tsx — the school's home page.
import Link from 'next/link';
import { getSite } from './data';
import { Section, ProgramCard, CTA, Photo, base, when, SponsorWall } from '@/components/school/Site';
import { sponsorWall } from '@/lib/academy-funding';
import { featuredWork } from '@/lib/school-site';

export default async function Home({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const site = (await getSite(tenantId))!; const S = site.settings;
  const work = await featuredWork(tenantId, 6).catch(() => []);
  const wall = S.donors.enabled && S.donors.sponsorStrip ? await sponsorWall(tenantId, S.donors.tiers).catch(() => []) : [];
  const next = site.cohorts[0]; const nextProg = next ? site.programs.find((p) => p.id === next.programId) : null;
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-6 pt-8 sm:pt-14 lg:grid-cols-[1.1fr_1fr]">
        <div className="sch-rise space-y-5">
          <h1 className="text-4xl leading-[1.05] sm:text-6xl">{S.headline || <>Start your career at <b>{site.name}</b></>}</h1>
          {S.message && <p className="max-w-xl whitespace-pre-line text-lg text-stone-700">{S.message}</p>}
          {next && nextProg && <p className="inline-block rounded-full bg-white px-4 py-2 text-sm shadow-sm">📅 Next start: <b>{nextProg.name}</b> · {when(next.startDate)}{next.seatsLeft != null ? ` · ${next.seatsLeft === 0 ? 'full — waitlist open' : `${next.seatsLeft} place${next.seatsLeft === 1 ? '' : 's'} left`}` : ''}</p>}
          <CTA site={site} />
          {site.address && <p className="text-sm text-stone-600">📍 {site.address}</p>}
        </div>
        {S.heroPhotoId ? <Photo site={site} id={S.heroPhotoId} alt={`${site.name}`} className="sch-rise aspect-[4/3] w-full rounded-[2rem] object-cover shadow-xl" /> : <div className="sch-rise hidden aspect-[4/3] rounded-[2rem] lg:block" style={{ background: 'linear-gradient(135deg, var(--accent), #f5f5f4)' }} />}
      </section>

      <Section id="programs" eyebrow="Programs" title={<>Find your <b>program</b></>}>
        {site.programs.length ? <div className="grid gap-4 md:grid-cols-2">{site.programs.map((p, i) => <ProgramCard key={p.id} site={site} p={p} i={i} />)}</div> : <p className="text-stone-600">Programs are being added — contact us for details.</p>}
      </Section>

      {S.whyUs.length > 0 && <Section eyebrow="Why us" title={<>What makes us <b>different</b></>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{S.whyUs.map((w, i) => <div key={i} className="sch-card sch-rise p-6" style={{ animationDelay: `${i * 70}ms` }}><p className="text-lg font-semibold">{w.title}</p><p className="mt-1 text-stone-700">{w.text}</p></div>)}</div>
      </Section>}

      {S.photos.length > 1 && <Section eyebrow="Inside our school" title={<>See where you’ll <b>learn</b></>}>
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">{S.photos.map((ph) => <figure key={ph.id} className="w-72 shrink-0 snap-start"><Photo site={site} id={ph.id} alt={ph.caption || site.name} className="aspect-[4/3] w-full rounded-2xl object-cover" />{ph.caption && <figcaption className="mt-1.5 text-[13px] text-stone-600">{ph.caption}</figcaption>}</figure>)}</div>
      </Section>}

      {work.length > 0 && <Section eyebrow="Student work" title={<>Made by our <b>students</b></>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{work.map((w: any) => <figure key={w.id} className="sch-card overflow-hidden">{(w.after || w.before) && <img src={w.after || w.before} alt={`${w.service} by ${w.by}`} className="aspect-square w-full object-cover" loading="lazy" />}<figcaption className="px-3 py-2 text-[13px]">{w.service} · <span className="text-stone-500">{w.by}</span></figcaption></figure>)}</div>
        <p className="mt-3 text-[12px] text-stone-500">Shared with our students’ and clients’ permission.</p>
      </Section>}

      {S.stories.length > 0 && <Section eyebrow="Graduates" title={<>Where our graduates <b>go</b></>}>
        <div className="grid gap-4 md:grid-cols-2">{S.stories.slice(0, 4).map((st, i) => <blockquote key={i} className="sch-card flex gap-4 p-6">{st.photoId && <Photo site={site} id={st.photoId} alt={st.name} className="h-16 w-16 shrink-0 rounded-full object-cover" />}<div><p className="text-[15px] leading-relaxed text-stone-800">“{st.quote}”</p><footer className="mt-2 text-sm text-stone-600">— <b>{st.name}</b>{st.program ? `, ${st.program}` : ''}{st.year ? ` (${st.year})` : ''}</footer></div></blockquote>)}</div>
        <p className="mt-3"><Link href={`${base(tenantId)}/student-life`} className="text-sm font-medium underline underline-offset-4">More about student life →</Link></p>
      </Section>}

      {wall.some((s) => s.hasLogo) && <Section eyebrow="Supported by" title={<>Thank you to our <b>sponsors</b></>}>
        <SponsorWall tenantId={tenantId} wall={wall} compact />
        <p className="mt-3"><Link href={`${base(tenantId)}/support`} className="text-sm font-medium underline underline-offset-4">Support our students →</Link></p>
      </Section>}

      <Section eyebrow="Visit" title={<>Come and <b>see us</b></>}>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 text-stone-700">
            {site.address && <p className="text-lg">📍 {site.address}</p>}
            {S.location.directions && <p>{S.location.directions}</p>}
            {S.location.parking && <p>🅿️ {S.location.parking}</p>}
            {S.contact.hoursText && <p>🕐 {S.contact.hoursText}</p>}
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href={`${base(tenantId)}/contact?tour=1`} className="rounded-full px-5 py-3 text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>Book a tour</Link>
              {site.phone && <a href={`tel:${site.phone}`} className="rounded-full bg-white px-5 py-3 text-sm shadow-sm">📞 Call</a>}
              {site.phone && S.contact.textOk && <a href={`sms:${site.phone}`} className="rounded-full bg-white px-5 py-3 text-sm shadow-sm">💬 Text</a>}
            </div>
          </div>
          {site.address && <iframe title={`Map to ${site.name}`} src={`https://www.google.com/maps?q=${encodeURIComponent(site.address)}&output=embed`} className="h-72 w-full rounded-[1.5rem] border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
        </div>
      </Section>
    </>
  );
}
