'use client';
// /ref/[tenantId]/[code] — A FRIEND'S WELCOME (design canvas RF6, RF8, RF9). An invitation, not a form, in the app's own
// look and font. Full-screen opening ("Hannah thinks you'll love it here"), the gift that turns over and counts up,
// Hannah's favorite with the next real open times, who they'll see, the visit in steps, where to go, and real proof —
// then one button that books it with the gift applied. No photos? Soft light instead; nothing is ever made up.
// Motion is short and calm, and still for anyone who has Reduce Motion on. /api/referrals/public (welcome).
import * as React from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion, animate } from 'framer-motion';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d';
const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';
const money = (n: number | null | undefined) => (n == null ? '' : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);
const ease = [0.22, 1, 0.36, 1] as const;

const ICON: Record<string, React.ReactNode> = {
  arrive: <><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  service: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
  care: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
  pin: <><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  cal: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16" /></>,
};
const Icon = ({ k }: { k: string }) => <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: SOFT }} aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON[k] || ICON.service}</svg></span>;

function CountUp({ to, still }: { to: number; still: boolean }) {
  const [v, setV] = React.useState(still ? to : 0);
  React.useEffect(() => { if (still) { setV(to); return; } const c = animate(0, to, { duration: 0.6, ease, onUpdate: (x) => setV(Math.round(x)) }); return () => c.stop(); }, [to, still]);
  return <>{money(v)}</>;
}

function Reveal({ children, still, delay = 0 }: { children: React.ReactNode; still: boolean; delay?: number }) {
  if (still) return <>{children}</>;
  return <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.45, ease, delay }}>{children}</motion.div>;
}

export default function ReferralWelcome() {
  const p = useParams() as any; const tenantId = String(p?.tenantId || ''); const code = String(p?.code || '');
  const still = !!useReducedMotion();
  const [d, setD] = React.useState<any>(null); const [open, setOpen] = React.useState(false); const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => { fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'welcome', tenantId, code }) })
    .then((r) => r.json()).then(setD).catch(() => setD({ ok: false, error: 'This page couldn’t load. Please try again.' })); }, [tenantId, code]);
  React.useEffect(() => { const f = () => setScrolled(window.scrollY > 80); window.addEventListener('scroll', f, { passive: true }); return () => window.removeEventListener('scroll', f); }, []);
  const book = (staffId?: string | null) => `/book/${encodeURIComponent(tenantId)}?ref=${encodeURIComponent(code)}${d?.favorite?.id ? `&service=${encodeURIComponent(d.favorite.id)}` : ''}${staffId ? `&staff=${encodeURIComponent(staffId)}` : ''}&src=referral`;
  const shell = { color: INK, fontFamily: FONT, background: '#fff' } as React.CSSProperties;

  if (!d) return <main className="flex min-h-screen items-center justify-center" style={shell}><p style={{ color: MUTED }}>One moment…</p></main>;
  if (!d.ok) return <main className="mx-auto min-h-screen max-w-[480px] space-y-3 px-5 py-12" style={shell}><h1 className="text-[28px] font-light tracking-[-0.02em]">This offer isn’t available</h1><p style={{ color: MUTED }}>{d.error}</p>
    <a href={`/book/${encodeURIComponent(tenantId)}`} className="inline-flex h-12 items-center rounded-full px-6 font-semibold text-white" style={{ background: INK }}>See services</a></main>;

  const hero = d.photos?.[0] || null; const offer = Math.round((d.offerCents || 0) / 100);
  const priceAfter = d.favorite?.price != null ? Math.max(0, d.favorite.price - offer) : null;
  const lines = ['A gift from ' + d.firstName];

  return (
    <main className="min-h-screen" style={shell}>
      <AnimatePresence>
        {!open && (
          <motion.section key="opening" className="fixed inset-0 z-30 flex flex-col justify-end overflow-hidden" exit={still ? { opacity: 0 } : { opacity: 0, scale: 1.02 }} transition={{ duration: 0.45, ease }} aria-label="Welcome">
            <motion.div className="absolute inset-0" initial={still ? false : { scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 8, ease: 'easeOut' }}
              style={hero ? { backgroundImage: `url(${hero})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'radial-gradient(90% 60% at 20% 15%, #ffffff 0%, transparent 60%), radial-gradient(80% 60% at 85% 60%, #dfe0e5 0%, transparent 70%), linear-gradient(180deg,#f3f3f5,#e5e5ec)' }} />
            {hero ? <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(22,23,26,0) 35%, rgba(22,23,26,.82) 100%)' }} />
              : <><motion.div aria-hidden="true" className="absolute -left-16 top-28 h-64 w-64 rounded-full border" style={{ borderColor: '#d4d5d9' }} animate={still ? undefined : { y: [0, 14, 0] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />
                <motion.div aria-hidden="true" className="absolute -right-20 top-64 h-72 w-72 rounded-full border" style={{ borderColor: '#dcdde0' }} animate={still ? undefined : { y: [0, -12, 0] }} transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }} /></>}
            <div className="absolute inset-x-0 top-10 text-center text-[13px] tracking-[0.32em]" style={{ color: hero ? '#fff' : INK }}>{d.logo ? <img src={d.logo} alt={d.business} className="mx-auto h-9 w-auto" /> : String(d.business).toUpperCase()}</div>
            <div className="relative mx-auto w-full max-w-[520px] px-6 pb-10" style={{ color: hero ? '#fff' : INK }}>
              {lines.map((l) => <motion.p key={l} className="text-[12px] uppercase tracking-[0.18em]" style={{ color: hero ? 'rgba(255,255,255,.8)' : MUTED }} initial={still ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease, delay: 0.2 }}>{l}</motion.p>)}
              <h1 className="mt-2 text-[40px] font-light leading-[1.05] tracking-[-0.03em]">
                <motion.span className="block" initial={still ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.4 }}>{d.firstName} thinks</motion.span>
                <motion.span className="block" initial={still ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.65 }}>you’ll love it here.</motion.span></h1>
              <motion.button type="button" onClick={() => { setOpen(true); window.scrollTo({ top: 0 }); }} className="mt-8 h-[52px] w-full rounded-full text-[15px] font-bold" style={hero ? { background: '#fff', color: INK } : { background: INK, color: '#fff' }}
                initial={still ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease, delay: 1.1 }}>Open your gift</motion.button>
            </div>
          </motion.section>)}
      </AnimatePresence>

      <div className="mx-auto max-w-[520px] space-y-5 px-5 pb-32 pt-10" style={{ background: SOFT, minHeight: '100vh' }}>
        <motion.div className="relative overflow-hidden rounded-[22px] p-5 text-white" style={{ background: 'linear-gradient(135deg,#3a3d44 0%,#16171a 100%)', boxShadow: '0 18px 40px -18px rgba(22,23,26,.7)', transformPerspective: 700 }}
          initial={still ? false : { rotateY: 75, opacity: 0 }} animate={open ? { rotateY: 0, opacity: 1 } : {}} transition={{ duration: 0.55, ease }} aria-label={`Your gift from ${d.firstName}: ${money(offer)} off your first visit`}>
          <div aria-hidden="true" className="absolute -right-8 -top-8 h-36 w-36 rounded-full" style={{ background: 'rgba(255,255,255,.08)' }} />
          {!still && open && <motion.div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,.28) 45%, transparent 60%)' }} initial={{ x: '-100%' }} animate={{ x: '120%' }} transition={{ duration: 0.9, ease, delay: 0.5 }} />}
          <p className="text-[11px] tracking-[0.2em] opacity-85">YOUR GIFT FROM {String(d.firstName).toUpperCase()}</p>
          <p className="mt-2 text-[44px] font-light leading-none tracking-[-0.03em]">{open ? <CountUp to={offer} still={still} /> : money(offer)} off</p>
          <p className="mt-1 pb-6 text-[13px] opacity-90">your first visit · already applied</p>
          <p className="absolute bottom-4 right-5 text-[11px] tracking-[0.3em] opacity-80">{String(d.business).toUpperCase().slice(0, 18)}</p>
        </motion.div>

        {d.favorite && <Reveal still={still} delay={0.3}><section className="overflow-hidden rounded-[20px] border bg-white" style={{ borderColor: LINE }} aria-label={`${d.firstName}’s favorite`}>
          {d.photos?.[1] || d.favorite.image ? <div className="h-40 bg-cover bg-center" style={{ backgroundImage: `url(${d.photos?.[1] || d.favorite.image})` }} role="img" aria-label={d.favorite.name} /> : null}
          <div className="space-y-3 p-4">
            <p className="text-[11px] tracking-[0.14em]" style={{ color: MUTED }}>{String(d.firstName).toUpperCase()}’S FAVORITE</p>
            <div className="flex items-baseline justify-between gap-3"><p className="text-[22px] font-light tracking-[-0.02em]">{d.favorite.name}</p>
              <p className="shrink-0 text-[13px]" style={{ color: MUTED }}>{d.favorite.minutes ? `${d.favorite.minutes} min · ` : ''}{d.favorite.price != null && offer > 0 ? <><s>{money(d.favorite.price)}</s> <b style={{ color: INK }}>{money(priceAfter)}</b></> : money(d.favorite.price)}</p></div>
            {(d.times || []).length > 0 && <><p className="text-[12px]" style={{ color: MUTED }}>Next open</p>
              <div className="flex gap-2">{d.times.map((t: any, i: number) => <motion.a key={t.startIso} href={book(t.staffId)} className="flex-1 rounded-[14px] border px-2 py-2.5 text-center text-[13px] font-semibold" style={{ borderColor: LINE }}
                initial={still ? false : { opacity: 0, y: 8 }} animate={open ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.35, ease, delay: 0.9 + i * 0.12 }}>{String(t.dayLabel).split(',')[0]} {t.label}</motion.a>)}
                <a href={book(d.provider?.id)} className="flex-1 rounded-[14px] border px-2 py-2.5 text-center text-[13px] font-semibold" style={{ borderColor: LINE }}>More</a></div></>}
          </div></section></Reveal>}

        {d.provider && <Reveal still={still}><section className="flex items-center gap-3 rounded-[18px] border bg-white p-3.5" style={{ borderColor: LINE }} aria-label="Who you’ll see">
          {d.provider.photo ? <img src={d.provider.photo} alt="" className="h-14 w-14 rounded-full object-cover" /> : <span className="flex h-14 w-14 items-center justify-center rounded-full text-[22px] font-light text-white" style={{ background: INK }} aria-hidden="true">{String(d.provider.first)[0]}</span>}
          <div><p className="text-[12px]" style={{ color: MUTED }}>You’ll be seeing</p><p className="text-[16px] font-bold">{d.provider.first}</p>
            {(d.provider.title || d.provider.specialties?.length) && <p className="text-[12.5px]" style={{ color: MUTED }}>{[d.provider.title, (d.provider.specialties || []).join(', ')].filter(Boolean).join(' · ')}</p>}</div>
        </section></Reveal>}

        {d.photos?.length > 1 && <Reveal still={still}><div className="grid grid-cols-3 gap-2">{d.photos.slice(0, 3).map((u: string, i: number) => <div key={u} className="h-28 rounded-[16px] bg-cover bg-center" style={{ backgroundImage: `url(${u})` }} role="img" aria-label={`${d.business} photo ${i + 1}`} />)}</div></Reveal>}

        <Reveal still={still}><section className="rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }} aria-label="Your first visit">
          <p className="mb-3 text-[12px] tracking-[0.12em]" style={{ color: MUTED }}>YOUR FIRST VISIT{d.favorite?.minutes ? ` · ABOUT ${d.favorite.minutes + 10} MINUTES` : ''}</p>
          {(d.steps || []).map((s: any, i: number, all: any[]) => <motion.div key={s.title} className="flex gap-3" initial={still ? false : { opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.35, ease, delay: i * 0.08 }}>
            <div className="flex flex-col items-center"><Icon k={s.icon} />{i < all.length - 1 && <span className="my-1 w-[2px] flex-1" style={{ background: LINE }} />}</div>
            <div className={i < all.length - 1 ? 'pb-3' : ''}><p className="text-[14.5px] font-bold">{s.title}</p><p className="text-[13px] leading-snug" style={{ color: MUTED }}>{s.sub}</p></div></motion.div>)}
        </section></Reveal>

        {(d.address || d.policy) && <Reveal still={still}><section className="space-y-3 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }} aria-label="Good to know">
          <p className="text-[20px] font-light tracking-[-0.02em]">Good to know</p>
          {d.address && <a href={`https://maps.apple.com/?q=${encodeURIComponent(d.address)}`} target="_blank" rel="noreferrer" className="flex items-center gap-3"><Icon k="pin" /><span><span className="block text-[14px] font-semibold">{d.address}</span><span className="block text-[12.5px] underline underline-offset-2" style={{ color: MUTED }}>Open in Maps</span></span></a>}
          {d.policy && <div className="flex items-center gap-3"><Icon k="cal" /><span><span className="block text-[14px] font-semibold">Plans change?</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{d.policy}</span></span></div>}
        </section></Reveal>}

        {(d.loved > 0 || d.review) && <Reveal still={still}><section className="space-y-3" aria-label="What clients say">
          {d.loved > 0 && <div className="flex items-center gap-3 rounded-[16px] p-4" style={{ background: '#e8f3ec' }}><span className="text-[28px] font-light" style={{ color: GREEN }}>{d.loved}</span><span className="text-[13.5px]">clients told us they loved their visit this year</span></div>}
          {d.review && <figure className="rounded-[16px] bg-white p-4" style={{ border: `1px solid ${LINE}` }}><p className="text-[13px]" aria-label="5 stars">★★★★★</p><blockquote className="mt-1.5 text-[18px] font-light leading-snug tracking-[-0.01em]">“{d.review.text}”</blockquote>
            <figcaption className="mt-1.5 text-[12px]" style={{ color: MUTED }}>{d.review.first ? `${d.review.first} · ` : ''}a real review</figcaption></figure>}
        </section></Reveal>}
        <p className="text-center text-[12px]" style={{ color: MUTED }}>New clients · one welcome gift per person · <a className="underline" href={`/ref/${encodeURIComponent(tenantId)}/terms`}>terms</a></p>
      </div>

      <AnimatePresence>{open && (scrolled || still) && <motion.div key="cta" className="fixed inset-x-0 bottom-0 z-20 px-5 pb-5 pt-3" style={{ background: 'linear-gradient(180deg, rgba(243,243,245,0), #f3f3f5 40%)' }}
        initial={still ? false : { y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.35, ease }}>
        <a href={book(d.times?.[0]?.staffId || d.provider?.id)} className="mx-auto flex h-[52px] max-w-[480px] items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: INK }}>Book with {money(offer)} off</a>
      </motion.div>}</AnimatePresence>
      {open && !scrolled && !still && <div className="mx-auto max-w-[520px] px-5 pb-8" style={{ background: SOFT }}><a href={book(d.times?.[0]?.staffId || d.provider?.id)} className="flex h-[52px] items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: INK }}>Book with {money(offer)} off</a></div>}
    </main>);
}
