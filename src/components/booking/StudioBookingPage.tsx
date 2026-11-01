'use client';
// src/components/booking/StudioBookingPage.tsx
//
// THE BOOKING PAGE — one design for every business, in the same warm look as the school website (shared kit:
// src/components/public/kit.tsx). What makes it theirs comes from Settings › Bookings › Booking page (lib/studio-page):
// their color, the headline and cover photo, which sections show and in what order, and the photos, about words and
// questions in a few of them. Services by category, the team, real reviews only, and "Visit us" with hours worked out
// from the team's actual schedules (so they always agree with the times clients can book). A section with nothing in it
// stays hidden. Booking itself is the same flow, with deposits, forms, text consent, memberships and packages unchanged.

import { GiftCoverBar } from '@/components/gift/GiftCoverBar';
import { BoothListingsSection } from '@/components/shared/BoothListingsSection';
import { GiftCardShowcase } from '@/components/gift/GiftCardShowcase';
import { catSlug } from '@/lib/share-links';
import { usePublicReviews } from '@/lib/booking-sections';
import { studioPage, headlineParts, sectionShows, type SectionId } from '@/lib/studio-page';
import { moduleEnabled } from '@/lib/modules';
import { Clock, Mail, MapPin, Minus, Phone, Plus } from 'lucide-react';
import * as React from 'react';
import { useMemo, useState } from 'react';
import { PublicFrame, Section, PrimaryButton, QuietButton, money, minutes } from '@/components/public/kit';

const DAYS: [string, string][] = [['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun']];
/** The address on one line, whether it's kept as text or as its parts. */
function addressLine(a: any): string {
  if (!a) return '';
  if (typeof a === 'string') return a.trim();
  if (typeof a === 'object') return [a.line1 || a.street, a.line2 || a.suite, [a.city, a.state || a.region].filter(Boolean).join(', '), a.zip || a.postalCode].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  return '';
}
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`; };

export function StudioBookingPage({ tenant, services, staff, accent, onBook, focus, giftCents = 0, preview = false }: {
  tenant: any; services: any[]; staff: any[]; accent: string;
  preview?: boolean;     // shown small in Settings: nothing fixed to the screen, no reviews fetched
  giftCents?: number;   // came from their gift card: the bar on top + a ✓ on the services it covers
  onBook: (service: any, staffId?: string) => void;
  focus?: any | null;   // a shared link to ONE service → the page is about that service (from a website, a QR code, a bio)
}) {
  const name = tenant?.name || 'Book an appointment';
  const page = useMemo(() => studioPage(tenant), [tenant]);
  const [plain, bold] = headlineParts(page.headline);
  // Clients' own reviews the business chose to show (Reviews → Visits); the ones typed in the old page builder until then.
  const real = usePublicReviews(page.on.reviews && !preview ? tenant?.id : undefined);
  const reviews = page.on.reviews ? (real.length ? real.slice(0, 6) : page.typedReviews) : [];
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
  const photo = page.cover?.url || null;
  const addr = addressLine(tenant?.address);
  const [allWork, setAllWork] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const bookTop = () => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // "Book with Jessica": remember her while the client chooses a service.
  const [withId, setWithId] = useState<string | null>(null);
  const withWho = withId ? team.find((m: any) => m.id === withId) : null;

  // Each section of the page, shown only when switched on and with something in it.
  const giftsOn = !!(tenant?.id && tenant?.giftCardSettings?.online && tenant.giftCardSettings.onBooking !== false);
  const counts: Partial<Record<SectionId, number>> = { team: team.length, reviews: reviews.length, gifts: giftsOn ? 1 : 0, spaces: 1, visit: addr || tenant?.phone || tenant?.email || hasHours ? 1 : 0 };
  const part = (id: SectionId): React.ReactNode => {
    if (!sectionShows(page, id, counts, (m) => moduleEnabled(tenant, m as any))) return null;
    if (id === 'spaces') return tenant?.id && !preview ? <div id="spaces"><BoothListingsSection tenantId={tenant.id} config={{ kind: 'spaces', title: 'Book a space', subtitle: 'By the hour or the day, no appointment needed.', showMonthly: false, hideWhenEmpty: true }} /></div> : null;
    if (id === 'team') return team.length > 0 ? <Section id="team" eyebrow="The team" title={<>Meet the <b>people</b></>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{team.map((m: any) => (
        <div key={m.id} className="pub-card space-y-3 p-5">
          <div className="flex items-center gap-3">{m.avatarUrl ? <img src={m.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" /> : <span className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: 'var(--accent)' }} aria-hidden>{String(m.name || '?').slice(0, 1)}</span>}
            <div className="min-w-0"><p className="font-semibold">{m.name}</p>{(m.specialties || []).length > 0 && <p className="truncate text-[13px] text-stone-500">{m.specialties.slice(0, 3).join(' · ')}</p>}</div></div>
          {m.bio && <p className="line-clamp-3 text-[14px] text-stone-600">{m.bio}</p>}
          <button type="button" onClick={() => { setWithId(m.id); bookTop(); }} className="inline-flex min-h-11 items-center text-[14px] font-medium underline underline-offset-4" style={{ color: 'var(--accent)' }}>Book with {String(m.name || '').split(' ')[0]}</button>
        </div>
      ))}</div>
    </Section> : null;
    if (id === 'work') return page.work.length > 0 ? <Section id="work" eyebrow="Our work" title={<>Recent <b>work</b></>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{(allWork ? page.work : page.work.slice(0, 4)).map((w, i) => (
        <figure key={w.url + i} className="relative overflow-hidden rounded-[1.25rem] bg-white">
          <img src={w.url} alt={w.caption ? `${w.caption}, by ${name}` : `Work by ${name}, photo ${i + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
          {w.caption && <figcaption className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-medium text-stone-800">{w.caption}</figcaption>}
        </figure>
      ))}</div>
      {page.work.length > 4 && <button type="button" onClick={() => setAllWork((v) => !v)} className="mt-3 inline-flex min-h-11 items-center text-[14px] font-medium" style={{ color: 'var(--accent)' }}>{allWork ? 'Show fewer' : `See all ${page.work.length} photos`}</button>}
    </Section> : null;
    if (id === 'reviews') return reviews.length > 0 ? <Section id="reviews" eyebrow="Kind words" title={<>What clients <b>say</b></>}>
      <div className="grid gap-3 sm:grid-cols-3">{reviews.map((r, i) => (
        <figure key={i} className="pub-card space-y-3 p-5"><p aria-label={`${r.rating} out of 5 stars`} style={{ color: 'var(--accent)' }}>{'★'.repeat(Math.max(1, Math.min(5, Number(r.rating) || 5)))}</p><blockquote className="text-[15px] text-stone-700">“{r.text}”</blockquote><figcaption className="text-[14px] font-semibold">{r.name}</figcaption></figure>
      ))}</div>
    </Section> : null;
    if (id === 'about') return page.about.text ? <Section id="about" eyebrow="About us" title={<>About <b>{name}</b></>}>
      <div className="grid items-start gap-6 md:grid-cols-2">
        {page.about.photo?.url && <img src={page.about.photo.url} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-[1.5rem] object-cover" />}
        <div className="space-y-4 text-[16px] leading-relaxed text-stone-700">{page.about.text.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</div>
      </div>
    </Section> : null;
    if (id === 'faqs') return page.faqs.length > 0 ? <Section id="questions" eyebrow="Questions" title={<>Asked <b>often</b></>}>
      <div className="max-w-3xl divide-y divide-stone-200 border-y border-stone-200">{page.faqs.map((f, i) => { const open = openFaq === i; return (
        <div key={i}>
          <h3><button type="button" aria-expanded={open} aria-controls={`faq-${i}`} onClick={() => setOpenFaq(open ? -1 : i)} className="flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left text-[16px] font-medium">
            <span>{f.q}</span>{open ? <Minus className="h-4 w-4 shrink-0 text-stone-500" aria-hidden /> : <Plus className="h-4 w-4 shrink-0 text-stone-500" aria-hidden />}</button></h3>
          <p id={`faq-${i}`} hidden={!open} className="pb-4 text-[15px] leading-relaxed text-stone-600">{f.a}</p>
        </div>); })}</div>
    </Section> : null;
    if (id === 'gifts') return tenant?.id && tenant?.giftCardSettings?.online && tenant.giftCardSettings.onBooking !== false && !preview ? <Section id="gift-cards" eyebrow="Gift cards" title={<>Give the gift of a <b>visit</b></>}>
      <GiftCardShowcase tenantId={tenant.id} brand={{ name, logo: tenant?.logoUrl || null, accent }} items={tenant.giftCardSettings.showcase || null} services={bookable} offered={tenant.giftCardSettings.designs || null} />
    </Section> : null;
    if (id === 'visit') return (addr || tenant?.phone || tenant?.email || hasHours) ? <Section id="visit" eyebrow="Visit us" title={<>Find <b>us</b></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="pub-card space-y-3 p-5 text-[15px]">
          {addr && <p className="flex gap-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden /><span>{addr}<br /><a href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-[14px] font-medium underline underline-offset-4" style={{ color: 'var(--accent)' }}>Get directions</a></span></p>}
          {tenant?.phone && <p className="flex items-center gap-3"><Phone className="h-4 w-4 shrink-0 text-stone-500" aria-hidden /><a href={`tel:${String(tenant.phone).replace(/[^\d+]/g, '')}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{tenant.phone}</a></p>}
          {tenant?.email && <p className="flex items-center gap-3"><Mail className="h-4 w-4 shrink-0 text-stone-500" aria-hidden /><a href={`mailto:${tenant.email}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{tenant.email}</a></p>}
        </div>
        {hasHours && <div className="pub-card p-5"><p className="mb-2 flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-stone-500" aria-hidden />Hours</p><dl className="grid grid-cols-[3.5rem_1fr] gap-y-1 text-[15px]">{hours.map((h) => <div key={h.label} className="contents"><dt className="text-stone-500">{h.label}</dt><dd className={h.text === 'Closed' ? 'text-stone-400' : ''}>{h.text}</dd></div>)}</dl></div>}
      </div>
    </Section> : null;
    return null;
  };

  return (
    <PublicFrame accent={accent}>
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-[#faf8f5]/90 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">{tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="h-9 w-9 rounded-xl object-contain" />}<span className="truncate text-[17px] font-semibold">{name}</span></div>
          <div className="flex shrink-0 items-center gap-2">{tenant?.giftCardSettings?.online && tenant?.id && <a href={tenant.giftCardSettings.onBooking !== false ? '#gift-cards' : `/gift/${tenant.id}`} className="inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-stone-700 hover:bg-stone-100">Gift cards</a>}
          <PrimaryButton onClick={bookTop} className="h-10 px-5 text-sm">Book</PrimaryButton></div>
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
            <h1 className="text-4xl leading-[1.08] sm:text-6xl">{page.headline ? <>{plain}{bold && <> <b>{bold}</b></>}</> : <>Welcome to <b>{name}</b></>}</h1>
            <p className="max-w-xl text-lg text-stone-600">{page.description || 'Book your next visit online in under a minute: pick a service, a time, and you’re done.'}</p>
            <div className="flex flex-wrap gap-3"><PrimaryButton onClick={bookTop}>Book an appointment</PrimaryButton>{team.length > 0 && <QuietButton href="#team">Meet the team</QuietButton>}</div>
          </div>
          {photo && <div className="pub-rise pub-card overflow-hidden" style={{ animationDelay: '.1s' }}><img src={photo} alt="" className="aspect-[4/3] w-full object-cover" /></div>}
        </section>)}

        <Section id="services" eyebrow="Services" title={<>Choose your <b>service</b></>}>
          {withWho && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-[15px] shadow-sm" role="status"><span>Booking with <b>{withWho.name}</b> — choose a service</span><button type="button" onClick={() => setWithId(null)} className="text-[14px] underline underline-offset-4">Anyone is fine</button></div>}
          {giftCents > 0 && <div className="mb-5"><GiftCoverBar studio cents={giftCents} services={bookable} accent={accent} onPick={(s) => onBook(s, withId || undefined)} /></div>}
          {bookable.length === 0 ? <p className="text-stone-600">Online booking is coming soon — please check back shortly.</p> : (
            <div className="space-y-8">{groups.map(([cat, list]) => (
              <div key={cat} id={`cat-${catSlug(cat)}`} className="space-y-3 scroll-mt-24">
                {groups.length > 1 && <h3 className="text-lg font-semibold">{cat}</h3>}
                <div className="grid gap-3 sm:grid-cols-2">{list.map((s: any, i: number) => (
                  <button key={s.id} type="button" onClick={() => onBook(s, withId || undefined)} className="pub-rise pub-card flex w-full items-center gap-4 p-4 text-left transition hover:-translate-y-0.5" style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }} aria-label={`Book ${s.name}`}>
                    {s.imageUrl && <img src={s.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />}
                    <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold">{s.name}</span>
                      <span className="mt-0.5 block text-[13px] text-stone-500">{[minutes(s.duration), money(s.price) && `${s.priceIsFrom || (s.serviceTiers || []).length ? 'from ' : ''}${money(s.price)}`].filter(Boolean).join(' · ')}</span>
                      {giftCents > 0 && Number(s.price) > 0 && Number(s.price) * 100 <= giftCents && <span className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ background: '#e9f3ed', color: '#1f7a4d' }}>Covered by your gift card</span>}
                      {s.description && <span className="mt-1 line-clamp-2 block text-[13px] text-stone-600">{s.description}</span>}</span>
                    <span className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium text-white" style={{ background: 'var(--accent)' }}>Book</span>
                  </button>
                ))}</div>
              </div>
            ))}</div>
          )}
        </Section>
        {page.order.filter((id) => id !== 'services').map((id) => <React.Fragment key={id}>{part(id)}</React.Fragment>)}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-28 pt-8 text-[13px] text-stone-500 md:pb-10">© {new Date().getFullYear()} {name} · Online booking by ClarityFlow</footer>
      {!preview && <div className="pub-safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/70 bg-[#faf8f5]/95 px-4 pt-3 backdrop-blur md:hidden">
        <PrimaryButton onClick={bookTop} className="w-full">Book an appointment</PrimaryButton>
      </div>}
    </PublicFrame>
  );
}
