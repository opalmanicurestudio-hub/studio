'use client';
// src/components/referrals/WelcomeLayouts.tsx — THE FIVE WELCOME LAYOUTS (design canvas RF6, RF8, RF10, RF11). Each
// business picks one in Referrals → Settings: Invitation (tap to open the gift), Editorial (big photo, numbered
// chapters), Postcard (everything on one screen), Stories (one idea per screen) or Simple (big type, no photos needed).
// All five use the same real details from /api/referrals/public (welcome), in the order the business chose, with the
// gift already applied. A friend can always choose who they see: their friend's provider first, or anyone else who
// does that service, each with their own next open times. Motion is short, and still for anyone with Reduce Motion on.
import * as React from 'react';
import { motion, AnimatePresence, animate } from 'framer-motion';

export const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d';
export const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';
export const money = (n: number | null | undefined) => (n == null ? '' : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);
export const ease = [0.22, 1, 0.36, 1] as const;
const SOFT_LIGHT = 'radial-gradient(90% 60% at 20% 15%, #ffffff 0%, transparent 60%), radial-gradient(80% 60% at 85% 60%, #dfe0e5 0%, transparent 70%), linear-gradient(180deg,#f3f3f5,#e5e5ec)';
const SHADE = 'linear-gradient(180deg, rgba(22,23,26,0) 35%, rgba(22,23,26,.82) 100%)';

const ICON: Record<string, React.ReactNode> = {
  arrive: <><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  service: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
  care: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
  pin: <><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  cal: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16" /></>,
};
const Icon = ({ k }: { k: string }) => <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: SOFT }} aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON[k] || ICON.service}</svg></span>;

export type Slot = { label: string; dayLabel: string; startIso: string; staffId: string };
export type Provider = { id: string; first: string; photo: string | null; title: string | null; specialties: string[]; theirs: boolean; times: Slot[] };
export type Welcome = { firstName: string; business: string; logo: string | null; offerCents: number; layout: string; sections: string[]; motion: boolean; who: 'theirs' | 'first';
  favorite: { id: string; name: string; minutes: number | null; price: number | null; image: string | null } | null; provider: Provider | null; providers: Provider[]; times: Slot[]; anyTimes: Slot[];
  steps: { icon: string; title: string; sub: string }[]; address: string | null; policy: string | null; loved: number; review: { text: string; first: string | null } | null; photos: string[] };

/** Everything a layout needs: the data, who's picked, their times, and the link that books it with the gift. */
export type Ctx = { d: Welcome; still: boolean; tenantId: string; offer: number; priceAfter: number | null; pick: string; setPick: (id: string) => void; who: Provider | null; times: Slot[];
  book: (staffId?: string | null) => string; has: (k: string) => boolean; hero: string | null };

export function useWelcome(d: Welcome, tenantId: string, code: string, still: boolean): Ctx {
  const [pick, setPick] = React.useState<string>(d.provider?.id || '');
  const who = d.providers.find((p) => p.id === pick) || null;
  const times = who ? who.times : (d.anyTimes || d.times || []);
  const offer = Math.round((d.offerCents || 0) / 100);
  const priceAfter = d.favorite?.price != null ? Math.max(0, d.favorite.price - offer) : null;
  const book = (staffId?: string | null) => `/book/${encodeURIComponent(tenantId)}?ref=${encodeURIComponent(code)}${d.favorite?.id ? `&service=${encodeURIComponent(d.favorite.id)}` : ''}${staffId ? `&staff=${encodeURIComponent(staffId)}` : ''}&src=referral`;
  const has = (k: string) => {
    if (!d.sections.includes(k)) return false;
    if (k === 'favorite') return !!d.favorite;
    if (k === 'provider') return d.providers.length > 0;
    if (k === 'visit') return d.steps.length > 0;
    if (k === 'photos') return d.photos.length > 1;
    if (k === 'good') return !!(d.address || d.policy);
    if (k === 'proof') return d.loved > 0 || !!d.review;
    return false;
  };
  return { d, still, tenantId, offer, priceAfter, pick, setPick, who, times, book, has, hero: d.photos[0] || null };
}

function CountUp({ to, still }: { to: number; still: boolean }) {
  const [v, setV] = React.useState(still ? to : 0);
  React.useEffect(() => { if (still) { setV(to); return; } const c = animate(0, to, { duration: 0.6, ease, onUpdate: (x) => setV(Math.round(x)) }); return () => c.stop(); }, [to, still]);
  return <>{money(v)}</>;
}
export function Reveal({ children, still, delay = 0 }: { children: React.ReactNode; still: boolean; delay?: number }) {
  if (still) return <>{children}</>;
  return <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.45, ease, delay }}>{children}</motion.div>;
}
const Face = ({ p, size = 56 }: { p: { first: string; photo: string | null }; size?: number }) => p.photo
  ? <img src={p.photo} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  : <span className="flex shrink-0 items-center justify-center rounded-full font-light text-white" style={{ width: size, height: size, background: INK, fontSize: size * 0.4 }} aria-hidden="true">{String(p.first)[0]}</span>;
const Logo = ({ c, light }: { c: Ctx; light?: boolean }) => <div className="text-center text-[13px] tracking-[0.32em]" style={{ color: light ? '#fff' : INK }}>{c.d.logo ? <img src={c.d.logo} alt={c.d.business} className="mx-auto h-9 w-auto" /> : String(c.d.business).toUpperCase()}</div>;
const BG = ({ c, className = '' }: { c: Ctx; className?: string }) => <div className={`absolute inset-0 ${className}`} style={c.hero ? { backgroundImage: `url(${c.hero})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: SOFT_LIGHT }} />;
const Terms = ({ c, light }: { c: Ctx; light?: boolean }) => <p className="text-center text-[12px]" style={{ color: light ? 'rgba(255,255,255,.7)' : MUTED }}>New clients · one welcome gift per person · <a className="underline" href={`/ref/${encodeURIComponent(c.tenantId)}/terms`}>terms</a></p>;
const btnCls = 'flex h-[52px] w-full items-center justify-center rounded-full text-[15px] font-bold';
const bookLabel = (c: Ctx) => (c.times[0] ? `Book ${String(c.times[0].dayLabel).split(',')[0]} ${c.times[0].label}${c.priceAfter != null ? ` · ${money(c.priceAfter)}` : ''}` : `Book with ${money(c.offer)} off`);
const BookBtn = ({ c, light, label }: { c: Ctx; light?: boolean; label?: string }) => <a href={c.book(c.times[0]?.staffId || c.who?.id)} className={btnCls} style={light ? { background: '#fff', color: INK } : { background: INK, color: '#fff' }}>{label || bookLabel(c)}</a>;

/** The gift, as a card that turns over once and counts up. */
export function GiftCard({ c, go = true }: { c: Ctx; go?: boolean }) {
  const { d, still, offer } = c;
  return <motion.div className="relative overflow-hidden rounded-[22px] p-5 text-white" style={{ background: 'linear-gradient(135deg,#3a3d44 0%,#16171a 100%)', boxShadow: '0 18px 40px -18px rgba(22,23,26,.7)', transformPerspective: 700 }}
    initial={still ? false : { rotateY: 75, opacity: 0 }} animate={go ? { rotateY: 0, opacity: 1 } : {}} transition={{ duration: 0.55, ease }} aria-label={`Your gift from ${d.firstName}: ${money(offer)} off your first visit`}>
    <div aria-hidden="true" className="absolute -right-8 -top-8 h-36 w-36 rounded-full" style={{ background: 'rgba(255,255,255,.08)' }} />
    {!still && go && <motion.div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,.28) 45%, transparent 60%)' }} initial={{ x: '-100%' }} animate={{ x: '120%' }} transition={{ duration: 0.9, ease, delay: 0.5 }} />}
    <p className="text-[11px] tracking-[0.2em] opacity-85">YOUR GIFT FROM {String(d.firstName).toUpperCase()}</p>
    <p className="mt-2 text-[44px] font-light leading-none tracking-[-0.03em]">{go ? <CountUp to={offer} still={still} /> : money(offer)} off</p>
    <p className="mt-1 pb-6 text-[13px] opacity-90">your first visit · already applied</p>
    <p className="absolute bottom-4 right-5 text-[11px] tracking-[0.3em] opacity-80">{String(d.business).toUpperCase().slice(0, 18)}</p>
  </motion.div>;
}

/** Open times as tappable chips: each one books that time's provider. */
export function Times({ c, dark, go = true }: { c: Ctx; dark?: boolean; go?: boolean }) {
  if (!c.times.length) return <a href={c.book(c.who?.id)} className="block rounded-[14px] border px-3 py-2.5 text-center text-[13px] font-semibold" style={{ borderColor: dark ? 'rgba(255,255,255,.4)' : LINE, color: dark ? '#fff' : INK }}>See open times</a>;
  const chip = { borderColor: dark ? 'rgba(255,255,255,.4)' : LINE, color: dark ? '#fff' : INK };
  return <div className="flex gap-2">{c.times.map((t, i) => <motion.a key={t.startIso} href={c.book(t.staffId)} className="flex-1 rounded-[14px] border px-2 py-2.5 text-center text-[13px] font-semibold" style={chip}
    initial={c.still ? false : { opacity: 0, y: 8 }} animate={go ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.35, ease, delay: 0.3 + i * 0.12 }}>{String(t.dayLabel).split(',')[0]} {t.label}</motion.a>)}
    <a href={c.book(c.who?.id)} className="flex-1 rounded-[14px] border px-2 py-2.5 text-center text-[13px] font-semibold" style={chip}>More</a></div>;
}

function FavoriteBody({ c, go = true }: { c: Ctx; go?: boolean }) {
  const { d, offer, priceAfter } = c; const f = d.favorite!;
  return <div className="space-y-3">
    <div className="flex items-baseline justify-between gap-3"><p className="text-[22px] font-light tracking-[-0.02em]">{f.name}</p>
      <p className="shrink-0 text-[13px]" style={{ color: MUTED }}>{f.minutes ? `${f.minutes} min · ` : ''}{f.price != null && offer > 0 ? <><s>{money(f.price)}</s> <b style={{ color: INK }}>{money(priceAfter)}</b></> : money(f.price)}</p></div>
    <p className="text-[12px]" style={{ color: MUTED }}>{c.who ? `Next open with ${c.who.first}` : 'Next open'}</p><Times c={c} go={go} /></div>;
}

/** Who they'll see, and the choice of anyone else who does it. */
export function WhoPicker({ c, dark, compact }: { c: Ctx; dark?: boolean; compact?: boolean }) {
  const { d, who, setPick } = c; const [open, setOpen] = React.useState(false);
  const many = d.providers.length > 1 || (d.providers.length === 1 && !who);
  const fg = dark ? '#fff' : INK; const sub = dark ? 'rgba(255,255,255,.75)' : MUTED;
  const label = (p: Provider) => (p.theirs ? `${d.firstName} sees ${p.first}` : [p.title, p.specialties.join(', ')].filter(Boolean).join(' · '));
  return <div className="space-y-3">
    <div className="flex items-center gap-3">
      {who ? <Face p={who} size={compact ? 40 : 56} /> : <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: compact ? 40 : 56, height: compact ? 40 : 56, background: dark ? 'rgba(255,255,255,.15)' : SOFT }} aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg></span>}
      <div className="min-w-0 flex-1"><p className="text-[12px]" style={{ color: sub }}>You’ll be seeing</p><p className="text-[16px] font-bold" style={{ color: fg }}>{who ? who.first : 'Whoever is free first'}</p>
        {who && label(who) && <p className="truncate text-[12.5px]" style={{ color: sub }}>{label(who)}</p>}</div>
      {many && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="shrink-0 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: dark ? 'rgba(255,255,255,.4)' : LINE, color: fg }}>{open ? 'Done' : 'Change'}</button>}
    </div>
    <AnimatePresence initial={false}>{open && <motion.div key="list" className="overflow-hidden" initial={c.still ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={c.still ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }}>
      <div role="radiogroup" aria-label="Who you’d like to see" className="space-y-2 pt-1">
        {[...d.providers, null].map((p) => { const on = p ? p.id === who?.id : !who; const t = p ? p.times[0] : (d.anyTimes || [])[0];
          return <button key={p?.id || 'first'} type="button" role="radio" aria-checked={on} onClick={() => { setPick(p?.id || ''); setOpen(false); }}
            className="flex w-full items-center gap-3 rounded-[14px] border p-2.5 text-left" style={{ borderColor: on ? fg : (dark ? 'rgba(255,255,255,.25)' : LINE), background: on && !dark ? SOFT : 'transparent' }}>
            {p ? <Face p={p} size={36} /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px]" style={{ background: dark ? 'rgba(255,255,255,.15)' : SOFT, color: fg }} aria-hidden="true">✦</span>}
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold" style={{ color: fg }}>{p ? p.first : 'Whoever is free first'}</span>
              <span className="block truncate text-[12px]" style={{ color: sub }}>{p ? (label(p) || 'Also does this') : 'The soonest time with anyone'}</span></span>
            <span className="shrink-0 text-[12px]" style={{ color: sub }}>{t ? `${String(t.dayLabel).split(',')[0]} ${t.label}` : 'No times soon'}</span></button>; })}
      </div></motion.div>}</AnimatePresence>
  </div>;
}

function Steps({ c }: { c: Ctx }) {
  return <>{c.d.steps.map((s, i, all) => <motion.div key={s.title} className="flex gap-3" initial={c.still ? false : { opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.35, ease, delay: i * 0.08 }}>
    <div className="flex flex-col items-center"><Icon k={s.icon} />{i < all.length - 1 && <span className="my-1 w-[2px] flex-1" style={{ background: LINE }} />}</div>
    <div className={i < all.length - 1 ? 'pb-3' : ''}><p className="text-[14.5px] font-bold">{s.title}</p><p className="text-[13px] leading-snug" style={{ color: MUTED }}>{s.sub}</p></div></motion.div>)}</>;
}
const visitTitle = (c: Ctx) => `YOUR FIRST VISIT${c.d.favorite?.minutes ? ` · ABOUT ${c.d.favorite.minutes + 10} MINUTES` : ''}`;
function Good({ c }: { c: Ctx }) {
  const { d } = c;
  return <div className="space-y-3">
    {d.address && <a href={`https://maps.apple.com/?q=${encodeURIComponent(d.address)}`} target="_blank" rel="noreferrer" className="flex items-center gap-3"><Icon k="pin" /><span><span className="block text-[14px] font-semibold">{d.address}</span><span className="block text-[12.5px] underline underline-offset-2" style={{ color: MUTED }}>Open in Maps</span></span></a>}
    {d.policy && <div className="flex items-center gap-3"><Icon k="cal" /><span><span className="block text-[14px] font-semibold">Plans change?</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{d.policy}</span></span></div>}
  </div>;
}
function Proof({ c }: { c: Ctx }) {
  const { d } = c;
  return <div className="space-y-3">
    {d.loved > 0 && <div className="flex items-center gap-3 rounded-[16px] p-4" style={{ background: '#e8f3ec' }}><span className="text-[28px] font-light" style={{ color: GREEN }}>{d.loved}</span><span className="text-[13.5px]">clients told us they loved their visit this year</span></div>}
    {d.review && <figure className="rounded-[16px] bg-white p-4" style={{ border: `1px solid ${LINE}` }}><p className="text-[13px]" aria-label="5 stars">★★★★★</p><blockquote className="mt-1.5 text-[18px] font-light leading-snug tracking-[-0.01em]">“{d.review.text}”</blockquote>
      <figcaption className="mt-1.5 text-[12px]" style={{ color: MUTED }}>{d.review.first ? `${d.review.first} · ` : ''}a real review</figcaption></figure>}
  </div>;
}
const Photos = ({ c }: { c: Ctx }) => <div className="grid grid-cols-3 gap-2">{c.d.photos.slice(0, 3).map((u, i) => <div key={u} className="h-28 rounded-[16px] bg-cover bg-center" style={{ backgroundImage: `url(${u})` }} role="img" aria-label={`${c.d.business} photo ${i + 1}`} />)}</div>;

const TITLES: Record<string, (c: Ctx) => string> = { favorite: (c) => `${c.d.firstName}’s favorite`, provider: () => 'Who you’ll see', visit: () => 'Your first visit', photos: (c) => `Inside ${c.d.business}`, good: () => 'Good to know', proof: () => 'What clients say' };
/** One section, as a white card (Invitation, Postcard) or a numbered chapter (Editorial). */
function Section({ c, k, n, go = true }: { c: Ctx; k: string; n?: number; go?: boolean }) {
  const body = k === 'favorite' ? <FavoriteBody c={c} go={go} /> : k === 'provider' ? <WhoPicker c={c} /> : k === 'visit' ? <Steps c={c} /> : k === 'photos' ? <Photos c={c} /> : k === 'good' ? <Good c={c} /> : <Proof c={c} />;
  if (n != null) return <Reveal still={c.still}><section className="space-y-3 py-6" style={{ borderTop: `1px solid ${LINE}` }} aria-label={TITLES[k](c)}>
    <p className="flex items-baseline gap-3"><span className="text-[12px] font-bold" style={{ color: MUTED }}>{String(n).padStart(2, '0')}</span><span className="text-[11px] tracking-[0.14em]" style={{ color: MUTED }}>{TITLES[k](c).toUpperCase()}</span></p>
    {k === 'visit' && c.d.favorite?.minutes ? <p className="text-[13px]" style={{ color: MUTED }}>About {c.d.favorite.minutes + 10} minutes in all</p> : null}{body}</section></Reveal>;
  if (k === 'photos' || k === 'proof') return <Reveal still={c.still}><section aria-label={TITLES[k](c)}>{body}</section></Reveal>;
  const fav = k === 'favorite' && c.d.favorite;
  return <Reveal still={c.still}><section className="overflow-hidden rounded-[20px] border bg-white" style={{ borderColor: LINE }} aria-label={TITLES[k](c)}>
    {fav && (c.d.photos[1] || c.d.favorite!.image) ? <div className="h-40 bg-cover bg-center" style={{ backgroundImage: `url(${c.d.photos[1] || c.d.favorite!.image})` }} role="img" aria-label={c.d.favorite!.name} /> : null}
    <div className="space-y-3 p-4">{k === 'provider' ? null : <p className={k === 'good' ? 'text-[20px] font-light tracking-[-0.02em]' : 'text-[11px] tracking-[0.14em]'} style={k === 'good' ? undefined : { color: MUTED }}>{k === 'good' ? 'Good to know' : k === 'visit' ? visitTitle(c) : TITLES[k](c).toUpperCase()}</p>}{body}</div></section></Reveal>;
}

/** On a computer: the photo (or soft light) holds the left half while the details scroll on the right. */
function Split({ c, children, headline = true }: { c: Ctx; children: React.ReactNode; headline?: boolean }) {
  return <div className="md:grid md:min-h-screen md:grid-cols-[1fr_minmax(440px,560px)]">
    <div className="relative hidden md:block"><div className="sticky top-0 h-screen overflow-hidden"><BG c={c} />{c.hero && <div className="absolute inset-0" style={{ background: SHADE }} />}
      <div className="absolute inset-x-0 top-10"><Logo c={c} light={!!c.hero} /></div>
      {headline && <div className="absolute inset-x-10 bottom-12" style={{ color: c.hero ? '#fff' : INK }}><p className="text-[12px] uppercase tracking-[0.18em]" style={{ opacity: 0.8 }}>A gift from {c.d.firstName}</p>
        <p className="mt-2 text-[44px] font-light leading-[1.05] tracking-[-0.03em]">{c.d.firstName} thinks you’ll love it here.</p></div>}</div></div>
    <div className="min-w-0">{children}</div></div>;
}

function StickyBook({ c, show }: { c: Ctx; show: boolean }) {
  return <AnimatePresence>{show && <motion.div key="cta" className="fixed bottom-0 right-0 z-20 w-full px-5 pb-5 pt-3 md:w-[min(560px,100%)]" style={{ background: 'linear-gradient(180deg, rgba(243,243,245,0), #f3f3f5 40%)' }}
    initial={c.still ? false : { y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.35, ease }}>
    <div className="mx-auto max-w-[480px]"><BookBtn c={c} /></div></motion.div>}</AnimatePresence>;
}
function useScrolled(px = 80) {
  const [s, setS] = React.useState(false);
  React.useEffect(() => { const f = () => setS(window.scrollY > px); f(); window.addEventListener('scroll', f, { passive: true }); return () => window.removeEventListener('scroll', f); }, [px]);
  return s;
}

// ── 1 · Invitation ──
export function Invitation({ c }: { c: Ctx }) {
  const { d, still } = c; const [open, setOpen] = React.useState(false); const scrolled = useScrolled();
  return <>
    <AnimatePresence>{!open && <motion.section key="opening" className="fixed inset-0 z-30 flex flex-col justify-end overflow-hidden" exit={still ? { opacity: 0 } : { opacity: 0, scale: 1.02 }} transition={{ duration: 0.45, ease }} aria-label="Welcome">
      <motion.div className="absolute inset-0" initial={still ? false : { scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 8, ease: 'easeOut' }}><BG c={c} /></motion.div>
      {c.hero ? <div className="absolute inset-0" style={{ background: SHADE }} />
        : <><motion.div aria-hidden="true" className="absolute -left-16 top-28 h-64 w-64 rounded-full border" style={{ borderColor: '#d4d5d9' }} animate={still ? undefined : { y: [0, 14, 0] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />
          <motion.div aria-hidden="true" className="absolute -right-20 top-64 h-72 w-72 rounded-full border" style={{ borderColor: '#dcdde0' }} animate={still ? undefined : { y: [0, -12, 0] }} transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }} /></>}
      <div className="absolute inset-x-0 top-10"><Logo c={c} light={!!c.hero} /></div>
      <div className="relative mx-auto w-full max-w-[520px] px-6 pb-10" style={{ color: c.hero ? '#fff' : INK }}>
        <motion.p className="text-[12px] uppercase tracking-[0.18em]" style={{ color: c.hero ? 'rgba(255,255,255,.8)' : MUTED }} initial={still ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease, delay: 0.2 }}>A gift from {d.firstName}</motion.p>
        <h1 className="mt-2 text-[40px] font-light leading-[1.05] tracking-[-0.03em]">
          <motion.span className="block" initial={still ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.4 }}>{d.firstName} thinks</motion.span>
          <motion.span className="block" initial={still ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.65 }}>you’ll love it here.</motion.span></h1>
        <motion.button type="button" onClick={() => { setOpen(true); window.scrollTo({ top: 0 }); }} className={`mt-8 ${btnCls}`} style={c.hero ? { background: '#fff', color: INK } : { background: INK, color: '#fff' }}
          initial={still ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease, delay: 1.1 }}>Open your gift</motion.button>
      </div></motion.section>}</AnimatePresence>
    <Split c={c}><div className="min-h-screen" style={{ background: SOFT }}><div className="mx-auto max-w-[520px] space-y-5 px-5 pb-32 pt-10">
      <GiftCard c={c} go={open} />
      {d.sections.filter(c.has).map((k) => <Section key={k} c={c} k={k} go={open} />)}
      <Terms c={c} />
      {open && !scrolled && <BookBtn c={c} label={`Book with ${money(c.offer)} off`} />}
    </div></div></Split>
    <StickyBook c={c} show={open && (scrolled || still)} />
  </>;
}

// ── 2 · Editorial ──
export function Editorial({ c }: { c: Ctx }) {
  const { d, still } = c; const scrolled = useScrolled(300); let n = 0;
  return <Split c={c}><div className="min-h-screen bg-white pb-28">
    <div className="relative h-[58vh] min-h-[380px] overflow-hidden md:hidden">
      <motion.div className="absolute inset-0" initial={still ? false : { scale: 1.06 }} animate={{ scale: 1 }} transition={{ duration: 8, ease: 'easeOut' }}><BG c={c} /></motion.div>
      {c.hero && <div className="absolute inset-0" style={{ background: SHADE }} />}
      <div className="absolute inset-x-0 top-10"><Logo c={c} light={!!c.hero} /></div>
      <motion.div className="absolute inset-x-6 bottom-6" style={{ color: c.hero ? '#fff' : INK }} initial={still ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.2 }}>
        <p className="text-[11px] uppercase tracking-[0.18em]" style={{ opacity: 0.85 }}>A gift from {d.firstName}</p>
        <h1 className="mt-2 text-[36px] font-light leading-[1.05] tracking-[-0.03em]">{d.firstName} thinks you’ll love it here.</h1></motion.div></div>
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white/95 px-5 py-3.5 backdrop-blur" style={{ borderColor: LINE }}>
      <div><p className="text-[22px] font-light leading-tight tracking-[-0.02em]">{money(c.offer)} off</p><p className="text-[11.5px]" style={{ color: MUTED }}>your first visit · already applied</p></div>
      <a href={c.book(c.times[0]?.staffId || c.who?.id)} className="rounded-full px-5 py-2.5 text-[13.5px] font-bold text-white" style={{ background: INK }}>Book</a></div>
    <div className="mx-auto max-w-[560px] px-5">
      {d.sections.filter(c.has).map((k) => <Section key={k} c={c} k={k} n={++n} />)}
      <div className="space-y-4 py-6" style={{ borderTop: `1px solid ${LINE}` }}><BookBtn c={c} /><Terms c={c} /></div>
    </div>
    <StickyBook c={c} show={scrolled} />
  </div></Split>;
}

// ── 3 · Postcard ──
export function Postcard({ c }: { c: Ctx }) {
  const { d, still } = c; const rest = d.sections.filter((k) => k !== 'favorite' && k !== 'provider' && c.has(k));
  const img = c.hero || d.favorite?.image || null;
  return <main className="min-h-screen" style={{ background: SOFT_LIGHT }}><div className="mx-auto flex min-h-screen max-w-[480px] flex-col gap-4 px-5 pb-8 pt-10">
    <Logo c={c} />
    <motion.div className="overflow-hidden rounded-[22px] bg-white" style={{ boxShadow: '0 24px 50px -26px rgba(22,23,26,.45)' }} initial={still ? false : { opacity: 0, y: 24, rotate: 0 }} animate={{ opacity: 1, y: 0, rotate: -1.2 }} transition={{ duration: 0.6, ease }}>
      {img && <div className="h-40 bg-cover bg-center" style={{ backgroundImage: `url(${img})` }} role="img" aria-label={d.business} />}
      <div className="space-y-3 p-4">
        <div className="flex justify-between text-[11px] tracking-[0.14em]" style={{ color: MUTED }}><span>FROM {String(d.firstName).toUpperCase()}</span><span>TO YOU</span></div>
        <p className="text-[44px] font-light leading-none tracking-[-0.03em]"><CountUp to={c.offer} still={still} /> off</p><p className="text-[12.5px]" style={{ color: MUTED }}>your first visit · already applied</p>
        {c.has('favorite') && d.favorite && <div className="space-y-3 border-t border-dashed pt-3" style={{ borderColor: LINE }}>
          <div className="flex items-baseline justify-between gap-3"><span className="text-[15px] font-bold">{d.firstName}’s favorite: {d.favorite.name}</span><span className="shrink-0 text-[12.5px]" style={{ color: MUTED }}>{d.favorite.minutes ? `${d.favorite.minutes} min · ` : ''}{money(c.priceAfter ?? d.favorite.price)}</span></div>
          <Times c={c} /></div>}
      </div></motion.div>
    {c.has('provider') && <div className="rounded-[16px] bg-white/75 p-3"><WhoPicker c={c} compact /></div>}
    <div className="mt-auto space-y-2 pt-2"><BookBtn c={c} />{rest.length > 0 && <a href="#more" className="block text-center text-[12.5px]" style={{ color: MUTED }}>What your visit is like ↓</a>}</div>
    {rest.length > 0 && <div id="more" className="space-y-5 pt-6">{rest.map((k) => <Section key={k} c={c} k={k} />)}</div>}
    <Terms c={c} />
  </div></main>;
}

// ── 4 · Stories ──
export function Stories({ c }: { c: Ctx }) {
  const { d, still } = c;
  const screens = ['gift', ...d.sections.filter((k) => k !== 'favorite' && c.has(k)), 'book'];
  const [i, setI] = React.useState(0); const last = screens.length - 1;
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)));
  React.useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); });
  const start = React.useRef<number | null>(null);
  const k = screens[i]; const bg = d.photos.length ? d.photos[i % d.photos.length] : null;
  const fg = '#fff'; const sub = 'rgba(255,255,255,.78)';
  const body = k === 'gift' ? <div><p className="text-[11px] tracking-[0.18em]" style={{ color: sub }}>A GIFT FROM {String(d.firstName).toUpperCase()}</p><p className="mt-2 text-[56px] font-light leading-none tracking-[-0.03em]"><CountUp to={c.offer} still={still} /> off</p>
      <p className="mt-2 text-[14px]" style={{ color: sub }}>your first visit · already applied</p><p className="mt-2 text-[22px] font-light leading-snug">{d.firstName} thinks you’ll love it here.</p><p className="mt-8 text-[12px]" style={{ color: 'rgba(255,255,255,.6)' }}>Tap to continue</p></div>
    : k === 'provider' ? <WhoPicker c={c} dark />
    : k === 'visit' ? <div className="space-y-3"><p className="text-[11px] tracking-[0.14em]" style={{ color: sub }}>{visitTitle(c)}</p>{d.steps.map((s) => <div key={s.title}><p className="text-[18px] font-light">{s.title}</p><p className="text-[13px]" style={{ color: sub }}>{s.sub}</p></div>)}</div>
    : k === 'photos' ? <p className="text-[26px] font-light leading-snug">Inside {d.business}</p>
    : k === 'good' ? <div className="space-y-3"><p className="text-[26px] font-light">Good to know</p>{d.address && <a href={`https://maps.apple.com/?q=${encodeURIComponent(d.address)}`} target="_blank" rel="noreferrer" className="block text-[15px] underline underline-offset-2">{d.address}</a>}{d.policy && <p className="text-[14px]" style={{ color: sub }}>{d.policy}</p>}</div>
    : k === 'proof' ? <div className="space-y-4">{d.loved > 0 && <p><span className="text-[48px] font-light">{d.loved}</span><span className="block text-[14px]" style={{ color: sub }}>clients told us they loved their visit this year</span></p>}{d.review && <figure><blockquote className="text-[22px] font-light leading-snug">“{d.review.text}”</blockquote><figcaption className="mt-1 text-[12px]" style={{ color: sub }}>{d.review.first ? `${d.review.first} · ` : ''}a real review</figcaption></figure>}</div>
    : <div className="space-y-3">{d.favorite && <><p className="text-[11px] tracking-[0.14em]" style={{ color: sub }}>{String(d.firstName).toUpperCase()}’S FAVORITE</p><p className="text-[30px] font-light tracking-[-0.02em]">{d.favorite.name}{c.priceAfter != null ? ` · ${money(c.priceAfter)}` : ''}</p>
        {c.has('provider') && <p className="text-[13px]" style={{ color: sub }}>{c.who ? `With ${c.who.first}` : 'With whoever is free first'}</p>}<Times c={c} dark /></>}<BookBtn c={c} light /><div className="pt-1"><Terms c={c} light /></div></div>;
  const tap = (e: React.MouseEvent) => { const t = e.target as HTMLElement; if (t.closest('a,button')) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); go(e.clientX - r.left > r.width / 3 ? i + 1 : i - 1); };
  const pane = <section className="relative h-[100dvh] w-full select-none overflow-hidden" style={{ color: fg }} aria-roledescription="stories" aria-label={`Screen ${i + 1} of ${screens.length}`} onClick={tap}
    onPointerDown={(e) => { start.current = e.clientX; }} onPointerUp={(e) => { if (start.current == null) return; const dx = e.clientX - start.current; start.current = null; if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1); }}>
    <AnimatePresence initial={false}><motion.div key={bg || 'soft'} className="absolute inset-0" initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}
      style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'linear-gradient(180deg,#55585e,#16171a)' }} /></AnimatePresence>
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(22,23,26,.35) 0%, rgba(22,23,26,.1) 30%, rgba(22,23,26,.85) 100%)' }} />
    <div className="absolute inset-x-3 top-3 z-10 flex gap-1" aria-hidden="true">{screens.map((s, n) => <span key={s} className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.35)' }}>
      <motion.span className="block h-full bg-white" initial={false} animate={{ width: n <= i ? '100%' : '0%' }} transition={{ duration: still ? 0 : 0.3 }} /></span>)}</div>
    <div className="absolute left-4 top-7 z-10 text-[11px] tracking-[0.24em]">{String(d.business).toUpperCase().slice(0, 22)}</div>
    <AnimatePresence mode="wait"><motion.div key={k} className="absolute inset-x-5 bottom-8 z-10 mx-auto max-w-[480px]" initial={still ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={still ? { opacity: 0 } : { opacity: 0, y: -10 }} transition={{ duration: 0.35, ease }}>
      {body}
      {i > 0 && k !== 'book' && <div className="mt-6 flex gap-2"><a href={c.book(c.times[0]?.staffId || c.who?.id)} className="flex h-11 flex-1 items-center justify-center rounded-full bg-white text-[14px] font-bold" style={{ color: INK }}>Book with {money(c.offer)} off</a>
        <button type="button" onClick={() => go(i + 1)} className="h-11 rounded-full border px-4 text-[14px] font-semibold" style={{ borderColor: 'rgba(255,255,255,.5)' }} aria-label="Next">Next</button></div>}
    </motion.div></AnimatePresence>
  </section>;
  return <main className="min-h-screen" style={{ background: INK }}><Split c={c} headline={false}>{pane}</Split></main>;
}

// ── 5 · Simple ──
export function Simple({ c }: { c: Ctx }) {
  const { d, still } = c; const [choose, setChoose] = React.useState(false);
  const Line = ({ big, children, sub, href, onClick, i }: { big?: boolean; children: React.ReactNode; sub: React.ReactNode; href?: string; onClick?: () => void; i: number }) => {
    const inner = <><span className={`${big ? 'text-[48px]' : 'text-[30px]'} font-light leading-[1.05] tracking-[-0.03em]`}>{children}</span><span className="shrink-0 text-right text-[12.5px]" style={{ color: MUTED }}>{sub}</span></>;
    const cls = 'flex w-full items-baseline justify-between gap-3 py-4 text-left'; const st = { borderBottom: `1px solid ${LINE}` };
    return <motion.div initial={still ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: 0.1 + i * 0.08 }}>
      {href ? <a href={href} className={cls} style={st}>{inner}</a> : onClick ? <button type="button" onClick={onClick} className={cls} style={st}>{inner}</button> : <div className={cls} style={st}>{inner}</div>}</motion.div>;
  };
  let n = 0; const t = c.times[0];
  return <main className="min-h-screen bg-white"><div className="mx-auto flex min-h-screen max-w-[520px] flex-col px-6 pb-8 pt-10">
    <div className="text-[13px] tracking-[0.32em]">{d.logo ? <img src={d.logo} alt={d.business} className="h-9 w-auto" /> : String(d.business).toUpperCase()}</div>
    <p className="mt-8 text-[13px]" style={{ color: MUTED }}>A gift from {d.firstName}</p>
    <Line big i={n++} sub="applied">{money(c.offer)} off</Line>
    {c.has('favorite') && d.favorite && <Line i={n++} sub={d.favorite.minutes ? `${d.favorite.minutes} min` : ''}>{d.favorite.name}</Line>}
    {c.has('provider') && <><Line i={n++} sub={d.providers.length > 1 ? 'change' : (c.who?.title || '')} onClick={d.providers.length > 1 ? () => setChoose(!choose) : undefined}>{c.who ? `with ${c.who.first}` : 'with whoever is free'}</Line>
      {choose && <div className="py-3"><WhoPicker c={c} compact /></div>}</>}
    {c.has('favorite') && d.favorite && <Line i={n++} href={c.book(t?.staffId || c.who?.id)} sub={t ? 'or another time' : ''}>{t ? `${String(t.dayLabel).split(',')[0]}, ${t.label}` : 'See open times'}</Line>}
    {c.has('good') && d.address && <Line i={n++} href={`https://maps.apple.com/?q=${encodeURIComponent(d.address)}`} sub="open in Maps">{String(d.address).split(',')[0]}</Line>}
    {(c.has('good') && d.policy) || (c.has('proof') && d.loved > 0) ? <p className="mt-4 text-[13.5px] leading-[1.55]" style={{ color: MUTED }}>{[c.has('good') ? d.policy : '', c.has('proof') && d.loved > 0 ? `${d.loved} clients told us they loved their visit this year.` : ''].filter(Boolean).join(' ')}</p> : null}
    {c.has('proof') && d.review && <p className="mt-3 text-[15px] font-light leading-snug">“{d.review.text}”<span className="block text-[12px]" style={{ color: MUTED }}>{d.review.first ? `${d.review.first} · ` : ''}a real review</span></p>}
    <div className="mt-auto space-y-3 pt-8"><BookBtn c={c} label={c.priceAfter != null ? `Book it · ${money(c.priceAfter)}` : `Book with ${money(c.offer)} off`} /><Terms c={c} /></div>
  </div></main>;
}

export const LAYOUT_VIEW: Record<string, (p: { c: Ctx }) => React.ReactElement> = { invitation: Invitation, editorial: Editorial, postcard: Postcard, stories: Stories, simple: Simple };
