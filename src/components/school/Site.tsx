// src/components/school/Site.tsx
//
// The school website's building blocks (server components). Mobile-first,
// the school's own colour and logo, gentle motion that respects "reduce motion".
import Link from 'next/link';
import type { SchoolSite } from '@/lib/school-site';
import { usd, imgUrl } from '@/lib/school-site';

export const SITE_CSS = `
.sch{--ink:#1c1917;--muted:#57534e;--paper:#faf8f5;color:var(--ink);background:var(--paper);font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif}
.sch h1,.sch h2{letter-spacing:-.02em;font-weight:300}.sch h1 b,.sch h2 b{font-weight:650}
@keyframes schRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.sch-rise{animation:schRise .7s cubic-bezier(.2,.8,.2,1) both}
.sch-card{background:#fff;border-radius:1.5rem;box-shadow:0 1px 2px rgba(28,25,23,.04),0 12px 32px -18px rgba(28,25,23,.25)}
.sch a:focus-visible,.sch button:focus-visible,.sch input:focus-visible,.sch select:focus-visible,.sch textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.sch-rise{animation:none}}
.sch .overflow-x-auto{scroll-padding-inline:1rem}
`;
export const base = (t: string) => `/school/${t}`;
export const NAV: [string, string][] = [['programs', 'Programs'], ['admissions', 'Admissions & costs'], ['student-life', 'Student life'], ['funding', 'Funding'], ['contact', 'Contact']];

export function Header({ site }: { site: SchoolSite }) {
  const b = base(site.tenantId);
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-[#faf8f5]/90 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top,0px)' }}>
      {!site.settings.published && <p className="bg-amber-100 px-4 py-1.5 text-center text-[12px] text-amber-900">Preview — this website isn’t published yet. Publish it from Academy → Website.</p>}
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href={b} className="flex min-w-0 items-center gap-2.5">
          {site.logoUrl && <img src={site.logoUrl} alt="" className="h-9 max-w-[120px] object-contain" />}
          <span className="truncate text-lg font-semibold tracking-tight">{site.name}</span>
        </Link>
        <nav aria-label="Main" className="ml-auto hidden items-center gap-5 text-sm lg:flex">{NAV.map(([k, l]) => <Link key={k} href={`${b}/${k === 'programs' ? '#programs' : k}`} className="text-stone-700 hover:text-stone-950">{l}</Link>)}</nav>
        <Link href={`${b}/contact?tour=1`} className="ml-auto shrink-0 rounded-full px-4 py-2.5 text-sm font-medium text-white lg:ml-2" style={{ background: 'var(--accent)' }}>Book a tour</Link>
      </div>
      <nav aria-label="Sections" className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 pb-2 text-[13px] lg:hidden">{NAV.map(([k, l]) => <Link key={k} href={`${b}/${k === 'programs' ? '#programs' : k}`} className="shrink-0 text-stone-600">{l}</Link>)}</nav>
    </header>
  );
}

export function Footer({ site }: { site: SchoolSite }) {
  const b = base(site.tenantId); const id = site.identity;
  return (
    <footer className="mt-20 border-t border-stone-200 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div className="space-y-1 text-sm text-stone-600">
          <p className="text-base font-semibold text-stone-900">{site.name}</p>
          {id.legalName && id.legalName !== site.name && <p>{id.legalName}</p>}
          {site.address && <p>{site.address}</p>}
          {site.phone && <p><a href={`tel:${site.phone}`} className="underline">{site.phone}</a></p>}
          {site.email && <p><a href={`mailto:${site.email}`} className="underline">{site.email}</a></p>}
          {id.licenseNumber && <p className="text-[12px]">{id.licensingBoard ? `${id.licensingBoard} · ` : ''}School licence #{id.licenseNumber}</p>}
        </div>
        <ul className="space-y-1.5 text-sm">
          <li><Link href={`${b}/admissions`} className="underline-offset-2 hover:underline">Admissions & costs</Link></li>
          <li><Link href={`${b}/funding`} className="underline-offset-2 hover:underline">Funding & scholarships</Link></li>
          {site.settings.donors.enabled && <li><Link href={`${b}/support`} className="underline-offset-2 hover:underline">Support our students</Link></li>}
          <li><Link href={`${b}/careers`} className="underline-offset-2 hover:underline">Teach with us{site.jobs.length ? ` (${site.jobs.length} open)` : ''}</Link></li>
          {site.settings.disclosures && <li><Link href={`${b}/disclosures`} className="underline-offset-2 hover:underline">Disclosures</Link></li>}
        </ul>
        <ul className="space-y-1.5 text-sm">
          <li><Link href={`/book/${site.tenantId}`} className="underline-offset-2 hover:underline">Book a student service</Link></li>
          <li><Link href={`/learn/${site.tenantId}/my`} className="underline-offset-2 hover:underline">Student portal</Link></li>
          {site.hasOnlineCourses && <li><Link href={`/learn/${site.tenantId}`} className="underline-offset-2 hover:underline">Online courses</Link></li>}
          {(['instagram', 'facebook', 'tiktok'] as const).filter((k) => site.settings.social[k]).map((k) => <li key={k}><a href={site.settings.social[k].startsWith('http') ? site.settings.social[k] : `https://${k}.com/${site.settings.social[k].replace(/^@/, '')}`} className="capitalize underline-offset-2 hover:underline" rel="noopener">{k}</a></li>)}
        </ul>
      </div>
      <p className="pb-6 text-center text-[11px] text-stone-400">Powered by ClarityFlow</p>
    </footer>
  );
}

export function Section({ id, eyebrow, title, children, className = '' }: { id?: string; eyebrow?: string; title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto max-w-6xl scroll-mt-24 px-4 py-10 sm:py-14 ${className}`}>
      {eyebrow && <p className="text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>{eyebrow}</p>}
      {title && <h2 className="mt-1 text-3xl sm:text-4xl">{title}</h2>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export const when = (d?: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

export function ProgramCard({ site, p, i = 0 }: { site: SchoolSite; p: SchoolSite['programs'][number]; i?: number }) {
  const next = p.cohorts[0];
  return (
    <Link href={`${base(site.tenantId)}/programs/${p.id}`} className="sch-card sch-rise block p-6 transition hover:-translate-y-0.5" style={{ animationDelay: `${i * 80}ms` }}>
      <p className="text-2xl font-semibold tracking-tight">{p.name}</p>
      <p className="mt-1 text-sm text-stone-600">{[p.totalHours && `${p.totalHours} hours`, p.weeks && `about ${p.weeks} weeks`, p.costs.hasPrice && `${usd(p.costs.total)} total`].filter(Boolean).join(' · ')}</p>
      {p.description && <p className="mt-3 line-clamp-3 text-[15px] text-stone-700">{p.description}</p>}
      {next && <p className="mt-4 inline-block rounded-full bg-stone-100 px-3 py-1 text-[13px]">Next start {when(next.startDate)}{next.seatsLeft != null ? ` · ${next.seatsLeft === 0 ? 'full — join the waitlist' : `${next.seatsLeft} place${next.seatsLeft === 1 ? '' : 's'} left`}` : ''}</p>}
      <p className="mt-4 text-sm font-medium" style={{ color: 'var(--accent)' }}>See details and full cost →</p>
    </Link>
  );
}

/** Every cost, one total — nothing hidden. */
export function CostTable({ p }: { p: SchoolSite['programs'][number] }) {
  const c = p.costs;
  if (!c.hasPrice) return <p className="text-stone-600">Ask us for the current costs — we’ll send a full breakdown.</p>;
  return (
    <div className="sch-card overflow-hidden">
      <table className="w-full text-[15px]">
        <tbody>
          {c.school.map((l) => <tr key={l.label} className="border-b border-stone-100"><td className="px-5 py-3">{l.label}{l.note && <span className="block text-[12px] text-stone-500">{l.note}</span>}</td><td className="px-5 py-3 text-right tabular-nums">{usd(l.cents)}</td></tr>)}
          {c.exam.map((l) => <tr key={l.label} className="border-b border-stone-100"><td className="px-5 py-3">{l.label}<span className="block text-[12px] text-stone-500">{l.note || 'Paid to the licensing board, not the school'}</span></td><td className="px-5 py-3 text-right tabular-nums">{usd(l.cents)}</td></tr>)}
          <tr className="bg-stone-50 font-semibold"><td className="px-5 py-4">Total cost</td><td className="px-5 py-4 text-right text-lg tabular-nums">{usd(c.total)}</td></tr>
        </tbody>
      </table>
      {c.plan && <p className="border-t border-stone-100 px-5 py-4 text-[14px] text-stone-700"><b>Payment plan:</b> {usd(c.plan.downCents)} down, then {c.plan.count} payments of about {usd(c.plan.eachCents)} {c.plan.interval}{c.exam.length ? ' (board fees are paid separately)' : ''}.</p>}
    </div>
  );
}

export function Photo({ site, id, alt, className }: { site: SchoolSite; id: string | null | undefined; alt: string; className?: string }) {
  const u = imgUrl(site.tenantId, id); if (!u) return null;
  return <img src={u} alt={alt} className={className} loading="lazy" />;
}

export function CTA({ site, programId }: { site: SchoolSite; programId?: string }) {
  const b = base(site.tenantId);
  return (
    <div className="flex flex-wrap gap-3">
      <Link href={`${b}/contact?tour=1${programId ? `&program=${programId}` : ''}`} className="rounded-full px-6 py-3.5 text-[15px] font-medium text-white" style={{ background: 'var(--accent)' }}>Book a tour</Link>
      <Link href={`${b}/contact?topic=admissions${programId ? `&program=${programId}` : ''}`} className="rounded-full bg-white px-6 py-3.5 text-[15px] font-medium shadow-sm">Get program details</Link>
      <Link href={`/learn/${site.tenantId}/apply${programId ? `?program=${programId}` : ''}`} className="rounded-full px-6 py-3.5 text-[15px] font-medium underline underline-offset-4">Apply</Link>
    </div>
  );
}

/** Approved sponsors' logos, biggest supporters first (top tier shown larger). */
export function SponsorWall({ tenantId, wall, compact = false }: { tenantId: string; wall: { id: string; name: string; url: string | null; hasLogo: boolean; tier: string; rank: number }[]; compact?: boolean }) {
  const withLogo = wall.filter((s) => s.hasLogo); if (!withLogo.length) return null;
  const tiers = [...new Set(withLogo.map((s) => s.tier))];
  const Logo = ({ s, big }: { s: (typeof wall)[number]; big: boolean }) => {
    const img = <img src={`/api/school/sponsor-logo?t=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(s.id)}`} alt={s.name} loading="lazy" className={`${big ? 'max-h-20 max-w-[200px]' : 'max-h-12 max-w-[140px]'} object-contain`} />;
    return s.url ? <a href={s.url} target="_blank" rel="sponsored noopener" title={s.name} className="sch-card flex items-center justify-center p-4 transition hover:-translate-y-0.5">{img}</a> : <div title={s.name} className="sch-card flex items-center justify-center p-4">{img}</div>;
  };
  if (compact) return <div className="flex flex-wrap items-center gap-3">{withLogo.slice(0, 12).map((s) => <Logo key={s.id} s={s} big={false} />)}</div>;
  return <div className="space-y-5">{tiers.map((t) => { const list = withLogo.filter((s) => s.tier === t); const big = list[0]?.rank === 0; return (
    <div key={t} className="space-y-2"><p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-stone-500">{t}</p>
      <div className={`grid gap-3 ${big ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>{list.map((s) => <Logo key={s.id} s={s} big={big} />)}</div></div>
  ); })}</div>;
}
