'use client';
// src/components/booking/StudioBookingPage.tsx
//
// THE "STUDIO" BOOKING PAGE — an optional design in the same warm look as the
// school website (shared kit: src/components/public/kit.tsx). Everything on
// it is the business's own: hero text and photo from the page builder,
// services by category, the team, REAL reviews only, and "Visit us" with
// hours worked out from the team's actual schedules (so they always agree
// with the times clients can book). Booking itself is the same flow, with
// deposits, forms, text consent, memberships and packages unchanged.

import { catSlug } from '@/lib/share-links';
import { useMemo, useState } from 'react';
import { PublicFrame, Section, PrimaryButton, QuietButton, money, minutes } from '@/components/public/kit';

const DAYS: [string, string][] = [['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun']];
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`; };

export function StudioBookingPage({ tenant, services, staff, sections, accent, onBook, focus }: {
  tenant: any; services: any[]; staff: any[]; sections: any[]; accent: string;
  onBook: (service: any, staffId?: string) => void;
  focus?: any | null;   // a shared link to ONE service → the page is about that service (from a website, a QR code, a bio)
}) {
  const name = tenant?.name || 'Book an appointment';
  // The page builder's SAMPLE hero text counts as "not set" — Studio shows the
  // business's own name and description instead of generic marketing copy.
  const rawHero = sections.find((s) => s.type === 'hero')?.config || {};
  const hero = { ...rawHero,
    headline: rawHero.headline && rawHero.headline !== 'Book Your Experience' ? rawHero.headline : '',
    subheadline: rawHero.subheadline && !/^A sanctuary of craft/.test(rawHero.subheadline) ? rawHero.subheadline : '' };
  const rv = sections.find((s) => s.type === 'reviews')?.config || {};
  const reviews = [1, 2, 3].map((i) => ({ name: rv[`rev${i}Name`], text: rv[`rev${i}Text`], rating: rv[`rev${i}Rating`] ?? 5 })).filter((r) => r.text && r.name);
  const bookable = services.filter((s) => s.isActive !== false);
  const groups = useMemo(() => {
    const m = new Map<string, any[]>(); const ordered = [...bookable].sort((a: any, b: any) => (Number.isFinite(a.menuOrder) ? a.menuOrder : 1e9) - (Number.isFinite(b.menuOrder) ? b.menuOrder : 1e9) || String(a.name).localeCompare(String(b.name)));   // the owner's menu order
    for (const s of ordered) { const k = s.category || 'Services'; m.set(k, [...(m.get(k) || []), s]); } return [...m.entries()];
  }, [bookable]);
  const team = staff.filter((m) => m.showOnPublicPage !== false && !(m.isRenter && m.bookingOptOut) && !m.isStudent);
  // Hours from the team's own weekly schedules: earliest start – latest finish per day.
  const hours = DAYS.map(([k, label]) => {
    const spans = team.map((m) => m.availability?.week?.[k]).filter((d: any) => d?.enabled && d.start && d.end);
    if (!spans.length) return { label, text: 'Closed' };
    const start = spans.map((d: any) => d.start).sort()[0], end = spans.map((d: any) => d.end).sort().pop();
    return { label, text: `${clock(start)} – ${clock(end)}` };
  });
  const hasHours = hours.some((h) => h.text !== 'Closed');
  const photo = hero.heroImage || hero.bgImage || null;
  const addr = tenant?.address ? String(tenant.address) : '';
  const bookTop = () => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // "Book with Jessica": remember her while the client chooses a service.
  const [withId, setWithId] = useState<string | null>(null);
  const withWho = withId ? team.find((m: any) => m.id === withId) : null;

  return (
    <PublicFrame accent={accent}>
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-[#faf8f5]/90 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">{tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="h-9 w-9 rounded-xl object-contain" />}<span className="truncate text-[17px] font-semibold">{name}</span></div>
          <PrimaryButton onClick={bookTop} className="h-10 px-5 text-sm">Book</PrimaryButton>
        </div>
      </header>

      <main id="main">
        {focus ? (
          <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:py-20 md:grid-cols-2" aria-label={`Book ${focus.name}`}>
            <div className="pub-rise space-y-5">
              <p className="text-sm uppercase tracking-wide text-stone-500">{focus.category || 'Service'} · {name}</p>
              <h1 className="text-4xl leading-[1.08] sm:text-6xl">{focus.name}</h1>
              <p className="text-lg text-stone-700">{focus.duration ? `${focus.duration} min · ` : ''}{(focus.priceIsFrom || (focus.serviceTiers || []).length ? 'from ' : '')}${(Number(focus.price) || 0).toFixed(0)}</p>
              {focus.description && <p className="max-w-xl text-lg text-stone-600">{focus.description}</p>}
              <div className="flex flex-wrap items-center gap-3"><PrimaryButton onClick={() => onBook(focus)}>Book {focus.name}</PrimaryButton><QuietButton href="#services">See all services</QuietButton></div>
            </div>
            {(focus.imageUrl || photo) && <div className="pub-rise pub-card overflow-hidden" style={{ animationDelay: '.1s' }}><img src={focus.imageUrl || photo} alt="" className="aspect-[4/3] w-full object-cover" /></div>}
          </section>
        ) : (
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:py-20 md:grid-cols-2">
          <div className="pub-rise space-y-5">
            <h1 className="text-4xl leading-[1.08] sm:text-6xl">{hero.headline ? hero.headline : <>Welcome to <b>{name}</b></>}</h1>
            <p className="max-w-xl text-lg text-stone-600">{hero.subheadline || tenant?.description || 'Book your next visit online in under a minute — pick a service, a time, and you’re done.'}</p>
            <div className="flex flex-wrap gap-3"><PrimaryButton onClick={bookTop}>Book an appointment</PrimaryButton>{team.length > 0 && <QuietButton href="#team">Meet the team</QuietButton>}</div>
          </div>
          {photo && <div className="pub-rise pub-card overflow-hidden" style={{ animationDelay: '.1s' }}><img src={photo} alt="" className="aspect-[4/3] w-full object-cover" /></div>}
        </section>)}

        <Section id="services" eyebrow="Services" title={<>Choose your <b>service</b></>}>
          {withWho && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-[15px] shadow-sm" role="status"><span>Booking with <b>{withWho.name}</b> — choose a service</span><button type="button" onClick={() => setWithId(null)} className="text-[14px] underline underline-offset-4">Anyone is fine</button></div>}
          {bookable.length === 0 ? <p className="text-stone-600">Online booking is coming soon — please check back shortly.</p> : (
            <div className="space-y-8">{groups.map(([cat, list]) => (
              <div key={cat} id={`cat-${catSlug(cat)}`} className="space-y-3 scroll-mt-24">
                {groups.length > 1 && <h3 className="text-lg font-semibold">{cat}</h3>}
                <div className="grid gap-3 sm:grid-cols-2">{list.map((s: any, i: number) => (
                  <button key={s.id} type="button" onClick={() => onBook(s, withId || undefined)} className="pub-rise pub-card flex w-full items-center gap-4 p-4 text-left transition hover:-translate-y-0.5" style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }} aria-label={`Book ${s.name}`}>
                    {s.imageUrl && <img src={s.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />}
                    <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold">{s.name}</span>
                      <span className="mt-0.5 block text-[13px] text-stone-500">{[minutes(s.duration), money(s.price) && `${s.priceIsFrom || (s.serviceTiers || []).length ? 'from ' : ''}${money(s.price)}`].filter(Boolean).join(' · ')}</span>
                      {s.description && <span className="mt-1 line-clamp-2 block text-[13px] text-stone-600">{s.description}</span>}</span>
                    <span className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium text-white" style={{ background: 'var(--accent)' }}>Book</span>
                  </button>
                ))}</div>
              </div>
            ))}</div>
          )}
        </Section>

        {team.length > 0 && <Section id="team" eyebrow="The team" title={<>Meet the <b>people</b></>}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{team.map((m: any) => (
            <div key={m.id} className="pub-card space-y-3 p-5">
              <div className="flex items-center gap-3">{m.avatarUrl ? <img src={m.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" /> : <span className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: 'var(--accent)' }}>{String(m.name || '?').charAt(0)}</span>}
                <div className="min-w-0"><p className="font-semibold">{m.name}</p>{(m.specialties || []).length > 0 && <p className="truncate text-[13px] text-stone-500">{m.specialties.slice(0, 3).join(' · ')}</p>}</div></div>
              {m.bio && <p className="line-clamp-3 text-[14px] text-stone-600">{m.bio}</p>}
              <button type="button" onClick={() => { setWithId(m.id); bookTop(); }} className="text-[14px] font-medium underline underline-offset-4" style={{ color: 'var(--accent)' }}>Book with {String(m.name || '').split(' ')[0]}</button>
            </div>
          ))}</div>
        </Section>}

        {reviews.length > 0 && <Section eyebrow="Kind words" title={<>What clients <b>say</b></>}>
          <div className="grid gap-3 sm:grid-cols-3">{reviews.map((r, i) => (
            <figure key={i} className="pub-card space-y-3 p-5"><p aria-label={`${r.rating} out of 5 stars`} style={{ color: 'var(--accent)' }}>{'★'.repeat(Math.max(1, Math.min(5, Number(r.rating) || 5)))}</p><blockquote className="text-[15px] text-stone-700">“{r.text}”</blockquote><figcaption className="text-[13px] font-medium text-stone-500">— {r.name}</figcaption></figure>
          ))}</div>
        </Section>}

        {(addr || tenant?.phone || tenant?.email || hasHours) && <Section id="visit" eyebrow="Visit us" title={<>Find <b>us</b></>}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="pub-card space-y-3 p-5 text-[15px]">
              {addr && <p>📍 {addr}<br /><a href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer" className="text-[14px] font-medium underline underline-offset-4" style={{ color: 'var(--accent)' }}>Get directions</a></p>}
              {tenant?.phone && <p>📞 <a href={`tel:${String(tenant.phone).replace(/[^\d+]/g, '')}`} className="underline underline-offset-4">{tenant.phone}</a></p>}
              {tenant?.email && <p>✉️ <a href={`mailto:${tenant.email}`} className="underline underline-offset-4">{tenant.email}</a></p>}
            </div>
            {hasHours && <div className="pub-card p-5"><p className="mb-2 font-semibold">Hours</p><dl className="grid grid-cols-[3.5rem_1fr] gap-y-1 text-[15px]">{hours.map((h) => <div key={h.label} className="contents"><dt className="text-stone-500">{h.label}</dt><dd className={h.text === 'Closed' ? 'text-stone-400' : ''}>{h.text}</dd></div>)}</dl></div>}
          </div>
        </Section>}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-28 pt-8 text-[13px] text-stone-500 md:pb-10">© {new Date().getFullYear()} {name} · Online booking by ClarityFlow</footer>
      {/* Always-there Book bar on phones, above the home bar */}
      <div className="pub-safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/70 bg-[#faf8f5]/95 px-4 pt-3 backdrop-blur md:hidden">
        <PrimaryButton onClick={bookTop} className="w-full">Book an appointment</PrimaryButton>
      </div>
    </PublicFrame>
  );
}
