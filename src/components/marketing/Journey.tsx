'use client';
// src/components/marketing/Journey.tsx
//
// THE LANDING PAGE — one story every owner recognises, told in their world.
//
//   Splash   — the mess owners juggle (calendar, texts, a payments sheet, a
//              card reader, a sticky note) folds into one mark: "One calm
//              place." Tap/scroll/wait and it lifts. Once per visit.
//   Hero     — "Run your business. Not five apps." + salon · spa · fitness ·
//              shop. Picking one rewrites everything below it.
//   The day  — six moments stamped with the time, each with a phone that
//              shows it happening (a notification lands, a tap clears the
//              count, the offer strikes through, the renters flip to paid).
//              Laptop: the phone stays pinned; phone: each moment has its own.
//   Proof    — built and run by a salon owner.
//   Switch   — "Coming from Vagaro…" (per niche). We help you move.
//   Made for — links to /for/salons · spas · fitness · shops.
//   Pricing  — free during early access.  Questions.  Start.
//
// The words for each niche live in ./niches.ts. No animation library: CSS +
// IntersectionObserver; readable without JS; still for "reduce motion".

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NICHES, NICHE_ORDER, type NicheKey, type Screen } from './niches';
import { ToolPicker } from '@/components/modules/ToolPicker';
import { RECOMMENDED, type ToolId } from '@/lib/module-catalog';

// What most platforms don't do — the short list that sells ClarityFlow.
const ONLY_HERE: [string, string, string][] = [
  ['✨', 'Live guest updates', 'Running late, arrived, forms done — clients update you, not the other way round.'],
  ['📲', 'A kiosk front desk', 'Walk-ins, waitlists and check-in on a tablet. No receptionist needed.'],
  ['📒', 'Books that keep themselves', 'Every sale, tip, fee and bill lands in your ledger — true profit per service.'],
  ['🔑', 'Renters with their own portal', 'Their clients, their books, rent collected on schedule.'],
  ['👥', 'Hiring & onboarding built in', 'Job posts to first shift — checklists, handbooks, time clock and pay.'],
  ['💌', 'Marketing that shows the money', 'Campaigns counted in bookings and dollars, not opens.'],
];

const FAQS = [
  ['How do I get it?', 'ClarityFlow is in early access, by request. Try the live demo, then request access — we set each business up personally, and share pricing before you commit.'],
  ['Do my clients need an app?', 'No. They book, check in and pay from a link on their phone.'],
  ['Can I bring my clients over?', 'Yes — clients, services and team. Start with your booking page and move the rest when you’re ready. We’ll help.'],
  ['Do I need new equipment?', 'No. It runs on the phone, tablet or laptop you already have. A card reader is optional.'],
];

// ── The phone ─────────────────────────────────────────────────────────────
function Phone({ screens, active, biz, times }: { screens: Screen[]; active: number; biz: string; times: string[] }) {
  return (
    <div className="relative mx-auto w-[262px] sm:w-[282px]" aria-hidden>
      <div className="relative rounded-[2.7rem] border border-white/70 bg-white/40 p-2.5 shadow-[0_50px_90px_-35px_rgba(28,25,23,0.5)] backdrop-blur-xl">
        <div className="relative h-[540px] overflow-hidden rounded-[2.2rem] bg-[#faf8f5]">
          <div className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-[#1c1917]" />
          {screens.map((s, i) => (
            <div key={i} className="cf-screen absolute inset-0 px-4 pb-4 pt-10" data-on={i === active ? 'true' : 'false'}>
              <ScreenView s={s} biz={biz} time={times[i] || ''} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const tone = { green: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-800', dark: 'bg-stone-900 text-white', light: 'bg-white/80 text-stone-600 border border-stone-200' };
const Pill = ({ t = 'light', children, className = '' }: { t?: keyof typeof tone; children: React.ReactNode; className?: string }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${tone[t]} ${className}`}>{children}</span>
);
const card = 'rounded-2xl border border-white/80 bg-white/75 p-3 shadow-sm';

function ScreenView({ s, biz, time }: { s: Screen; biz: string; time: string }) {
  if (s.kind === 'notify') return (
    <div className="flex h-full flex-col">
      <p className="text-center text-[34px] font-light tracking-tight text-stone-800">{/^\d/.test(time) ? time.replace(/\s?[ap]m$/i, '') : '7:42'}</p>
      <p className="text-center text-[11px] text-stone-500">{/pm$/i.test(time) ? 'This evening' : 'This morning'}</p>
      <div className="cf-drop mt-6 rounded-2xl border border-white/80 bg-white/85 p-3 shadow-[0_10px_30px_-12px_rgba(28,25,23,0.35)] backdrop-blur">
        <div className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-stone-900 text-[9px] font-bold text-white">CF</span><span className="text-[10px] font-semibold text-stone-500">{s.app}</span><span className="ml-auto text-[10px] text-stone-400">now</span></div>
        <p className="mt-1.5 text-[12px] font-semibold text-stone-900">{s.title}</p>
        {s.lines.map((l) => <p key={l} className="text-[11px] text-stone-600">{l}</p>)}
        <Pill t="green" className="mt-2">{s.pill}</Pill>
      </div>
    </div>
  );
  if (s.kind === 'decide') return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-[13px] font-semibold text-stone-900">Today</p>
        <span className="relative h-6 w-[112px]"><Pill t="amber" className="cf-chip-a absolute right-0 whitespace-nowrap">{s.chip}</Pill><Pill t="green" className="cf-chip-b absolute right-0 whitespace-nowrap">all answered ✓</Pill></span></div>
      <div className={card + ' cf-decide space-y-2 ring-2 ring-amber-200'}>
        <p className="text-[12px] font-semibold text-stone-900">{s.title}</p>
        <p className="text-[11px] text-stone-500">{s.sub}</p>
        <div className="flex gap-1.5"><span className="cf-tap flex-1 rounded-xl bg-stone-900 py-2 text-center text-[11px] font-semibold text-white">{s.accept}</span><span className="rounded-xl border border-stone-200 px-3 py-2 text-[11px] font-semibold text-stone-600">Decline</span></div>
      </div>
      {s.others.map((x) => <div key={x} className={card + ' flex items-center justify-between text-[11px] text-stone-600'}><span>{x}</span><Pill t="green">confirmed</Pill></div>)}
    </div>
  );
  if (s.kind === 'chat') return (
    <div className="space-y-2.5">
      <p className="text-center text-[11px] font-semibold text-stone-500">{s.biz}</p>
      {s.bubbles.map((b, k) => (
        <div key={k} className={`cf-bubble max-w-[82%] rounded-2xl p-2.5 text-[11px] ${b.me ? 'ml-auto rounded-br-sm bg-stone-900 text-white' : 'rounded-bl-sm bg-white/90 text-stone-700 shadow-sm'}`} style={{ animationDelay: `${k * 380}ms` }}>{b.text}</div>
      ))}
      <div className={card + ' cf-bubble mt-4 flex items-center justify-between'} style={{ animationDelay: '1250ms' }}><span className="text-[12px] font-semibold text-stone-900">{s.done}</span><Pill t="green">✓</Pill></div>
    </div>
  );
  if (s.kind === 'checkout') return (
    <div className="space-y-3">
      <p className="text-[13px] font-semibold text-stone-900">Checkout</p>
      <div className={card + ' space-y-1.5 text-[12px]'}>
        {s.lines.map(([a, b, k]) => (
          <div key={a} className={`flex justify-between ${k ? 'cf-offer text-emerald-700' : 'text-stone-700'}`}><span>{k === 'offer' ? '🎁 ' : k === 'credit' ? '◎ ' : ''}{a}</span><span>{b}</span></div>
        ))}
        <div className="flex justify-between border-t border-stone-200 pt-1.5 font-semibold text-stone-900"><span>Total</span><span>{s.total}</span></div>
      </div>
      <div className="cf-tap rounded-2xl bg-stone-900 py-3 text-center text-[12px] font-semibold text-white">{s.pay}</div>
      <div className="cf-bubble flex justify-center" style={{ animationDelay: '1100ms' }}><Pill t="green">Paid · receipt sent</Pill></div>
    </div>
  );
  if (s.kind === 'rows') return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-semibold text-stone-900">{s.title}</p>
      {s.rows.map(([n, r, st, t], k) => (
        <div key={n} className={card + ' flex items-center gap-2.5'}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[10px] font-semibold text-stone-600">{n.split(' ').map((p) => p[0]).join('')}</span>
          <span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-stone-900">{n}</span><span className="block text-[10px] text-stone-500">{r}</span></span>
          <Pill t={t} className="cf-flip" >{st}</Pill>
        </div>
      ))}
      <div className={card + ' flex justify-between text-[11px] text-stone-600'}><span>{s.footer[0]}</span><span className="font-semibold text-stone-900">{s.footer[1]}</span></div>
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-[13px] font-semibold text-stone-900">Campaigns</p>
      <div className={card}><p className="text-[10px] text-stone-500">{s.label}</p><p className="mt-1 text-[12px] text-stone-800">{s.message}</p></div>
      <div className="grid grid-cols-3 gap-1.5 text-center">{s.stats.map(([v, l]) => <div key={l} className={card + ' px-1'}><p className="text-[15px] font-semibold text-stone-900">{v}</p><p className="text-[9px] text-stone-500">{l}</p></div>)}</div>
      <div className={card + ' cf-bubble flex items-center justify-between'} style={{ animationDelay: '700ms' }}><span className="text-[11px] text-stone-600">{s.result}</span><Pill t="green">from this campaign</Pill></div>
      <p className="pt-1 text-center text-[10px] text-stone-400">{biz}</p>
    </div>
  );
}

// ── The page ──────────────────────────────────────────────────────────────
export function Journey({ initialNiche }: { initialNiche?: NicheKey }) {
  const [niche, setNiche] = useState<NicheKey | null>(initialNiche || null);
  const [splash, setSplash] = useState<'show' | 'leaving' | 'gone'>(initialNiche ? 'gone' : 'show');
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const journeyRef = useRef<HTMLDivElement>(null);
  const n = NICHES[niche || 'salon'];
  // À la carte: starts on the recommended set for their business, follows the
  // business type until they change a tool themselves.
  const [tools, setTools] = useState<ToolId[]>(RECOMMENDED[initialNiche || 'other'] as ToolId[]);
  const [toolsTouched, setToolsTouched] = useState(false);
  useEffect(() => { if (niche && !toolsTouched) setTools(RECOMMENDED[niche] as ToolId[]); }, [niche, toolsTouched]);

  // Remember the pick for the visit.
  useEffect(() => {
    if (initialNiche) return;
    try { const v = sessionStorage.getItem('cf_niche') as NicheKey | null; if (v && NICHES[v]) setNiche(v); } catch { /* private mode */ }
  }, [initialNiche]);
  const pick = (k: NicheKey) => { setNiche(k); try { sessionStorage.setItem('cf_niche', k); } catch { /* ignore */ } };

  // Splash: once per visit; lifts on tap, scroll, key, or after ~3.4s.
  useEffect(() => {
    if (initialNiche) return;
    let seen = false;
    try { seen = sessionStorage.getItem('cf_splash') === '1'; } catch { /* ignore */ }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (seen || reduce) { setSplash('gone'); return; }
    document.documentElement.classList.add('cf-lock');
    const leave = () => {
      setSplash((s) => (s === 'show' ? 'leaving' : s));
      try { sessionStorage.setItem('cf_splash', '1'); } catch { /* ignore */ }
      document.documentElement.classList.remove('cf-lock');
      window.setTimeout(() => setSplash('gone'), 900);
    };
    const t = window.setTimeout(leave, 3400);
    window.addEventListener('wheel', leave, { once: true, passive: true });
    window.addEventListener('touchmove', leave, { once: true, passive: true });
    window.addEventListener('keydown', leave, { once: true });
    (window as any).__cfLeave = leave;
    return () => { window.clearTimeout(t); window.removeEventListener('wheel', leave); window.removeEventListener('touchmove', leave); window.removeEventListener('keydown', leave); document.documentElement.classList.remove('cf-lock'); };
  }, [initialNiche]);

  // Rise-in; which moment is on screen; how far through the day.
  useEffect(() => {
    document.documentElement.classList.add('cf-js');
    const rise = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { (e.target as HTMLElement).dataset.shown = 'true'; rise.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('[data-rise]:not([data-shown])').forEach((el) => rise.observe(el));
    const chap = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.chapter)); }), { rootMargin: '-45% 0px -45% 0px' });
    document.querySelectorAll('[data-chapter]').forEach((el) => chap.observe(el));
    const onScroll = () => {
      const el = journeyRef.current; if (!el) return;
      const r = el.getBoundingClientRect(); const total = r.height - window.innerHeight;
      setProgress(total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0);
    };
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    return () => { rise.disconnect(); chap.disconnect(); window.removeEventListener('scroll', onScroll); };
  }, [niche]);

  const screens = n.chapters.map((c) => c.screen);
  const inDay = progress > 0 && progress < 1;

  return (
    <div className="cf-page relative min-h-dvh overflow-x-clip bg-[#f7f5f2] text-stone-900">
      <style>{CSS}</style>

      {/* Soft moving light */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="cf-orb absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-amber-200/60 via-rose-200/50 to-transparent blur-3xl" />
        <div className="cf-orb cf-orb-2 absolute -right-40 top-1/3 h-[560px] w-[560px] rounded-full bg-gradient-to-bl from-violet-200/50 via-sky-200/40 to-transparent blur-3xl" />
        <div className="cf-orb cf-orb-3 absolute -bottom-40 left-1/4 h-[480px] w-[480px] rounded-full bg-gradient-to-tr from-emerald-200/40 via-amber-100/40 to-transparent blur-3xl" />
      </div>

      {/* ── Splash: the mess folds into one calm place ── */}
      {splash !== 'gone' && (
        <button type="button" onClick={() => (window as any).__cfLeave?.()} data-leaving={splash === 'leaving'} aria-label="Enter"
          className="cf-splash fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-[#f7f5f2]">
          {[
            ['📅 Fri · 9:00 · 10:30 · 1:00', '-34vw,-26vh', '-6deg'],
            ['💬 “can I move to 3?”', '26vw,-30vh', '5deg'],
            ['📊 Payments — Sept.xlsx', '-30vw,22vh', '4deg'],
            ['💳 Card reader · paired?', '30vw,20vh', '-4deg'],
            ['📝 remind everyone Friday', '0vw,-38vh', '2deg'],
            ['🔔 3 missed calls', '-2vw,34vh', '-3deg'],
          ].map(([t, pos, rot], k) => (
            <span key={k} className="cf-mess absolute rounded-2xl border border-white/80 bg-white/80 px-3.5 py-2 text-[12px] font-medium text-stone-600 shadow-[0_12px_30px_-14px_rgba(28,25,23,0.35)] sm:text-[13px]"
              style={{ ['--p' as any]: pos, ['--r' as any]: rot, animationDelay: `${k * 90}ms` }}>{t}</span>
          ))}
          <span className="relative flex flex-col items-center">
            <span className="cf-mark text-5xl font-light tracking-tight sm:text-7xl">Clarity<span className="font-semibold">Flow</span></span>
            <span className="cf-tag mt-4 text-base text-stone-500 sm:text-lg">One calm place.</span>
          </span>
          <span className="cf-cue absolute bottom-10 text-[11px] uppercase tracking-[0.3em] text-stone-400">tap to begin</span>
        </button>
      )}

      <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-stone-900 transition-opacity duration-300" style={{ transform: `scaleX(${progress})`, opacity: inDay ? 1 : 0 }} />

      {/* ── Header ── */}
      <header className="relative z-40 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" className="text-lg font-light tracking-tight">Clarity<span className="font-semibold">Flow</span></Link>
        <nav className="flex items-center gap-1 text-sm">
          <a href="#day" className="hidden rounded-full px-3 py-2 text-stone-600 hover:text-stone-900 sm:inline">How it works</a>
          <a href="#tools" className="hidden rounded-full px-3 py-2 text-stone-600 hover:text-stone-900 sm:inline">Tools</a>
          <a href="#pricing" className="hidden rounded-full px-3 py-2 text-stone-600 hover:text-stone-900 sm:inline">Pricing</a>
          <Link href="/login" className="rounded-full px-3 py-2 text-stone-600 hover:text-stone-900">Log in</Link>
          <Link href={`/demo${niche ? `?type=${niche}` : ''}`} className="rounded-full bg-stone-900 px-4 py-2 font-medium text-white">Try the demo</Link>
        </nav>
      </header>

      <main className="relative z-10">
        {/* ── Hero ── */}
        <section className="mx-auto flex min-h-[88dvh] max-w-4xl flex-col items-center justify-center px-5 pb-12 text-center">
          <span data-rise className="glass rounded-full px-4 py-1.5 text-xs text-stone-600">Now in early access</span>
          <h1 data-rise className="mt-6 text-balance text-5xl font-light leading-[1.02] tracking-tight sm:text-7xl">Run your business. <span className="font-semibold">Not five apps.</span></h1>
          <p data-rise className="mt-6 max-w-xl text-balance text-lg text-stone-600">{niche ? n.sub : 'Bookings, payments, clients and your team — in one calm place.'}</p>

          <div data-rise className="mt-8">
            <p className="text-xs uppercase tracking-[0.25em] text-stone-400">I run a…</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Your kind of business">
              {NICHE_ORDER.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={niche === k} onClick={() => pick(k)}
                  className={`rounded-full px-4 py-2.5 text-sm transition-all ${niche === k ? 'bg-stone-900 text-white shadow-[0_10px_24px_-12px_rgba(28,25,23,0.7)]' : 'glass text-stone-700 hover:text-stone-900'}`}>
                  {NICHES[k].label}
                </button>
              ))}
            </div>
          </div>

          <div data-rise className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Link href={`/demo${niche ? `?type=${niche}` : ''}`} className="rounded-full bg-stone-900 px-7 py-3.5 text-sm font-medium text-white shadow-[0_12px_30px_-12px_rgba(28,25,23,0.6)]">Try the live demo</Link>
            <Link href={`/request-access${niche ? `?type=${niche}` : ''}`} className="glass rounded-full px-6 py-3.5 text-sm text-stone-700">Request access</Link>
          </div>
        </section>

        {/* ── A day at the business ── */}
        <section id="day" ref={journeyRef} key={n.key} className="relative mx-auto max-w-6xl px-5">
          <p data-rise className="text-center text-xs uppercase tracking-[0.3em] text-stone-400">A day at {n.biz}</p>
          <div className="md:grid md:grid-cols-2 md:gap-16">
            <div className="hidden md:block">
              <div className="sticky top-0 flex h-dvh items-center justify-center">
                <Phone screens={screens} active={active} biz={n.biz} times={n.chapters.map((c) => c.time)} />
                <div className="absolute left-0 top-1/2 flex -translate-y-1/2 flex-col gap-2" aria-hidden>
                  {n.chapters.map((c, i) => <span key={i} className="h-2 w-2 rounded-full transition-all duration-300" style={{ background: i === active ? '#1c1917' : 'rgba(28,25,23,0.18)', transform: i === active ? 'scale(1.5)' : 'none' }} />)}
                </div>
              </div>
            </div>
            <div className="md:order-first">
              {n.chapters.map((c, i) => (
                <article key={i} data-chapter={i} className="flex min-h-[92dvh] flex-col justify-center py-14 md:min-h-dvh">
                  <p data-rise className="font-mono text-sm tracking-wide text-stone-400">{c.time}</p>
                  <h2 data-rise className="mt-3 text-balance text-4xl font-light leading-[1.05] tracking-tight sm:text-6xl">{c.line}</h2>
                  <p data-rise className="mt-5 max-w-sm text-lg text-stone-600">{c.body}</p>
                  <div data-rise className="mt-10 md:hidden"><Phone screens={[c.screen]} active={0} biz={n.biz} times={[c.time]} /></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Only in ClarityFlow ── */}
        <section className="mx-auto max-w-5xl px-5 pt-24">
          <p data-rise className="text-center text-xs uppercase tracking-[0.3em] text-stone-400">What others don’t do</p>
          <h2 data-rise className="mt-3 text-center text-balance text-4xl font-light leading-tight tracking-tight sm:text-5xl">Built to protect your profit — <span className="font-semibold">and give you your evenings back.</span></h2>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ONLY_HERE.map(([e, t, d], k) => (
              <div key={t} data-rise className="glass rounded-3xl p-5" style={{ transitionDelay: `${(k % 3) * 80}ms` }}>
                <span className="text-2xl" aria-hidden>{e}</span>
                <p className="mt-2 text-lg font-semibold">{t}</p>
                <p className="mt-1 text-stone-600">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── À la carte ── */}
        <section id="tools" className="mx-auto max-w-6xl px-5 py-24">
          <p data-rise className="text-center text-xs uppercase tracking-[0.3em] text-stone-400">À la carte</p>
          <h2 data-rise className="mt-3 text-center text-balance text-4xl font-light leading-tight tracking-tight sm:text-5xl">Unlock what your business needs. <span className="font-semibold">Nothing it doesn’t.</span></h2>
          <p data-rise className="mx-auto mt-4 max-w-xl text-center text-lg text-stone-600">Turn tools on and off like switches. Your app shows only what you use — and grows when you do.</p>
          <div data-rise className="mt-10">
            <ToolPicker value={tools} onChange={(v) => { setTools(v); setToolsTouched(true); }} niche={niche || 'other'} nicheLabel={niche ? NICHES[niche].label : null} />
          </div>
          <div data-rise className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href={`/request-access?${niche ? `type=${niche}&` : ''}tools=${tools.join(',')}`} className="rounded-full bg-stone-900 px-7 py-3.5 text-sm font-medium text-white">Request access with these tools</Link>
            <Link href={`/demo${niche ? `?type=${niche}` : ''}`} className="rounded-full px-5 py-3 text-sm text-stone-600">Try the live demo</Link>
          </div>
        </section>

        {/* ── Proof ── */}
        <section className="mx-auto max-w-3xl px-5 py-24 text-center">
          <p data-rise className="text-xs uppercase tracking-[0.3em] text-stone-400">Why it exists</p>
          <p data-rise className="mt-5 text-balance text-3xl font-light leading-snug tracking-tight sm:text-4xl">“I was running my business across five apps and a spreadsheet. So I built one place — and <span className="font-semibold">I run my own studio on it every day.</span>”</p>
          <p data-rise className="mt-5 text-stone-500">Jessica Marshall · Owner, Opal Manicure Studio</p>
        </section>

        {/* ── Switching ── */}
        <section className="mx-auto max-w-3xl px-5 pb-10">
          <div data-rise className="glass rounded-[2rem] p-8 text-center sm:p-10">
            <p className="text-2xl font-light tracking-tight sm:text-3xl">Coming from <span className="font-semibold">{n.switchFrom}</span>?</p>
            <p className="mx-auto mt-3 max-w-lg text-stone-600">Bring your clients, services and team. We’ll help you move — and your data is yours to export, any time.</p>
          </div>
        </section>

        {/* ── Made for ── */}
        <section className="mx-auto max-w-5xl px-5 py-16">
          <h2 data-rise className="text-center text-3xl font-light tracking-tight sm:text-4xl">Made for businesses <span className="font-semibold">that run on people.</span></h2>
          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {NICHE_ORDER.map((k) => (
              <Link key={k} data-rise href={`/for/${NICHES[k].slug}`} className="glass group rounded-3xl p-6 transition-transform hover:-translate-y-0.5">
                <p className="flex items-center justify-between text-lg font-semibold">{NICHES[k].plural}<span className="text-stone-400 transition-transform group-hover:translate-x-1">→</span></p>
                <p className="mt-1 text-stone-600">{NICHES[k].sub}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" className="mx-auto max-w-xl px-5 py-16 text-center">
          <div data-rise className="glass relative overflow-hidden rounded-[2rem] p-8 sm:p-10">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-amber-200/70 to-rose-200/50 blur-2xl" />
            <p className="relative text-xs uppercase tracking-[0.25em] text-stone-400">Early access</p>
            <p className="relative mt-3 text-5xl font-light tracking-tight">By request</p>
            <p className="relative mt-3 text-stone-600">We’re opening a few businesses at a time and setting each one up personally — your services, your team, your clients moved over. Pricing is shared before you commit.</p>
            <div className="relative mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Link href={`/request-access${niche ? `?type=${niche}` : ''}`} className="rounded-full bg-stone-900 px-7 py-3.5 text-sm font-medium text-white">Request access</Link>
              <Link href={`/demo${niche ? `?type=${niche}` : ''}`} className="rounded-full px-5 py-3 text-sm text-stone-600">Try the demo first</Link>
            </div>
            <p className="relative mt-4 text-xs text-stone-500">Payments run through your own Stripe account at Stripe’s rates.</p>
          </div>
        </section>

        {/* ── Questions ── */}
        <section className="mx-auto max-w-2xl px-5 py-16">
          <h2 data-rise className="text-center text-3xl font-light tracking-tight">Questions</h2>
          <div className="mt-8 space-y-2">
            {FAQS.map(([q, a]) => (
              <details key={q} data-rise className="glass group rounded-2xl px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">{q}<span className="text-stone-400 transition-transform group-open:rotate-45">+</span></summary>
                <p className="mt-3 text-stone-600">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Start ── */}
        <section className="mx-auto flex max-w-3xl flex-col items-center px-5 pb-28 pt-16 text-center">
          <h2 data-rise className="text-balance text-4xl font-light leading-tight tracking-tight sm:text-6xl">See it for yourself. <span className="font-semibold">Two minutes.</span></h2>
          <p data-rise className="mt-5 text-stone-600">Book as a {niche === 'fitness' ? 'member' : niche === 'shop' ? 'customer' : 'client'}, accept as the owner, check them out and bring them back — in a live demo. No sign-up.</p>
          <div data-rise className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Link href={`/demo${niche ? `?type=${niche}` : ''}`} className="rounded-full bg-stone-900 px-8 py-4 text-sm font-medium text-white shadow-[0_12px_30px_-12px_rgba(28,25,23,0.6)]">Try the live demo</Link>
            <Link href={`/request-access${niche ? `?type=${niche}` : ''}`} className="rounded-full px-5 py-3 text-sm text-stone-600">Request access</Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-stone-200/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-stone-500 sm:flex-row">
          <span>© {new Date().getFullYear()} ClarityFlow</span>
          <span className="flex flex-wrap justify-center gap-5">{NICHE_ORDER.map((k) => <Link key={k} href={`/for/${NICHES[k].slug}`}>{NICHES[k].plural}</Link>)}<Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Terms</Link></span>
        </div>
      </footer>
    </div>
  );
}

// Motion for this page only. Hidden states apply only after JS adds .cf-js.
const CSS = `
html:has(.cf-page), html:has(.cf-page) body { overflow-x: clip; overflow-y: visible; }
html.cf-lock, html.cf-lock body { overflow: hidden !important; }
.cf-js [data-rise] { opacity: 0; transform: translateY(24px); }
.cf-js [data-rise][data-shown="true"] { opacity: 1; transform: none; transition: opacity .9s cubic-bezier(.22,1,.36,1), transform .9s cubic-bezier(.22,1,.36,1); }

.cf-orb { animation: cf-float 18s ease-in-out infinite alternate; }
.cf-orb-2 { animation-duration: 22s; animation-delay: -6s; }
.cf-orb-3 { animation-duration: 26s; animation-delay: -12s; }
@keyframes cf-float { from { transform: translate3d(0,0,0) scale(1); } to { transform: translate3d(40px,-30px,0) scale(1.08); } }

/* Splash: the mess arrives scattered, then folds into the mark. */
.cf-splash { transition: opacity .8s ease, transform .9s cubic-bezier(.7,0,.2,1), filter .8s ease; }
.cf-splash[data-leaving="true"] { opacity: 0; transform: translateY(-6%) scale(1.04); filter: blur(8px); pointer-events: none; }
.cf-mess { left: 50%; top: 50%; opacity: 0; animation: cf-mess 2.1s cubic-bezier(.65,0,.35,1) both; }
@keyframes cf-mess {
  0%   { opacity: 0; transform: translate(-50%,-50%) translate(var(--p)) rotate(var(--r)) scale(.9); }
  18%  { opacity: 1; transform: translate(-50%,-50%) translate(var(--p)) rotate(var(--r)) scale(1); }
  58%  { opacity: 1; transform: translate(-50%,-50%) translate(var(--p)) rotate(calc(var(--r) * -1)) scale(1); }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(.2); }
}
.cf-mark { animation: cf-in 1s 1.55s cubic-bezier(.22,1,.36,1) both; }
.cf-tag { animation: cf-in 1s 1.95s cubic-bezier(.22,1,.36,1) both; }
.cf-cue { animation: cf-in 1s 2.4s both, cf-breathe 2.4s 3.4s ease-in-out infinite; }
@keyframes cf-in { from { opacity: 0; transform: translateY(14px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes cf-breathe { 50% { opacity: .35; } }

/* The phone: screens cross-fade; each one plays its moment when it arrives. */
.cf-screen { opacity: 0; transform: translateY(14px) scale(.98); transition: opacity .6s ease, transform .7s cubic-bezier(.22,1,.36,1); }
.cf-screen[data-on="true"] { opacity: 1; transform: none; }
.cf-screen[data-on="true"] .cf-drop { animation: cf-drop .9s .3s cubic-bezier(.22,1.2,.36,1) both; }
@keyframes cf-drop { from { opacity: 0; transform: translateY(-40px) scale(.96); } to { opacity: 1; transform: none; } }
.cf-screen[data-on="true"] .cf-bubble { animation: cf-in .7s cubic-bezier(.22,1,.36,1) both; }
.cf-screen[data-on="true"] .cf-tap { animation: cf-tap .5s 1s ease both; }
@keyframes cf-tap { 40% { transform: scale(.94); box-shadow: 0 0 0 8px rgba(28,25,23,.12); } }
.cf-chip-b { opacity: 0; }
.cf-screen[data-on="true"] .cf-chip-a { animation: cf-out .4s 1.4s both; }
.cf-screen[data-on="true"] .cf-chip-b { animation: cf-in .5s 1.6s both; }
.cf-screen[data-on="true"] .cf-decide { animation: cf-settle .6s 1.4s both; }
@keyframes cf-out { to { opacity: 0; transform: translateY(-6px); } }
@keyframes cf-settle { to { box-shadow: 0 0 0 2px rgba(16,185,129,.35); } }
.cf-screen[data-on="true"] .cf-offer { animation: cf-offer .8s .7s both; }
@keyframes cf-offer { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
.cf-screen[data-on="true"] .cf-flip { animation: cf-flip .6s both; }
.cf-screen[data-on="true"] div:nth-child(2) .cf-flip { animation-delay: .4s; }
.cf-screen[data-on="true"] div:nth-child(3) .cf-flip { animation-delay: .7s; }
.cf-screen[data-on="true"] div:nth-child(4) .cf-flip { animation-delay: 1s; }
@keyframes cf-flip { from { opacity: 0; transform: rotateX(90deg); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .cf-orb, .cf-mark, .cf-tag, .cf-cue, .cf-mess, .cf-drop, .cf-bubble, .cf-tap, .cf-chip-a, .cf-chip-b, .cf-decide, .cf-offer, .cf-flip { animation: none !important; }
  .cf-chip-b { opacity: 0; }
  .cf-js [data-rise] { opacity: 1; transform: none; }
  .cf-screen { transition: none; }
}
`;
