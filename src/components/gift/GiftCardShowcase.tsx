'use client';
// src/components/gift/GiftCardShowcase.tsx — GIFT CARDS ON THE BOOKING PAGE (lib/gift-designs). Three cards the owner
// chose (Gift cards → Online shop & designs → On your booking page), drawn as real cards and made to be touched:
//   • they fan out as the section scrolls into view, the stage tilts toward the pointer, the chosen card floats
//     with a light sweeping across it — a physical object you want to pick up;
//   • three amounts with the middle one raised (most people choose the middle), each saying what it covers here
//     ("Covers a Gel manicure") so the amount means a visit, not a number;
//   • "Who's it for?" writes their name on the cards as they type — once it has a name on it, it's already a gift;
//   • an occasion nudge only when one is really in season, and the reassurances that remove doubt (sent on the day,
//     never expires) right beside the button.
// Motion is switched off for people who ask their device for less motion. In the settings preview nothing navigates.
import * as React from 'react';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { designById, designsSync, inSeason } from '@/lib/gift-designs';

export type ShowcaseItem = { design: string; amount: number; label?: string | null };
export const DEFAULT_SHOWCASE: ShowcaseItem[] = [
  { design: 'frost', amount: 50, label: 'A little treat' }, { design: 'pour', amount: 100, label: 'The classic' }, { design: 'velvet', amount: 200, label: 'The whole day' }];
const money = (n: number) => `$${n % 1 ? n.toFixed(2) : n.toFixed(0)}`;

function useReducedMotion() {
  const [r, setR] = React.useState(false);
  React.useEffect(() => { const m = window.matchMedia('(prefers-reduced-motion: reduce)'); setR(m.matches); const f = () => setR(m.matches); m.addEventListener?.('change', f); return () => m.removeEventListener?.('change', f); }, []);
  return r;
}

export function GiftCardShowcase({ tenantId, brand, items, services = [], offered, preview = false, ink = '#1c1917', muted = '#78716c', line = '#e7e2dc', font }: {
  tenantId: string; brand: { name: string; logo?: string | null; accent?: string | null }; items?: ShowcaseItem[] | null; services?: any[];
  offered?: string[] | null; preview?: boolean; ink?: string; muted?: string; line?: string; font?: string;
}) {
  const list = (items && items.length ? items : DEFAULT_SHOWCASE).slice(0, 3);
  const accent = brand.accent || ink;
  const reduce = useReducedMotion();
  const [active, setActive] = React.useState(Math.min(1, list.length - 1));
  const [to, setTo] = React.useState('');
  const [shown, setShown] = React.useState(false);
  const [tilt, setTilt] = React.useState({ x: 0, y: 0 });
  const [leaving, setLeaving] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null); const swipe = React.useRef<number | null>(null);
  const [wide, setWide] = React.useState(true); const [cw, setCw] = React.useState(300);
  React.useEffect(() => { const f = () => { const w = window.innerWidth; setWide(w >= 768); setCw(w >= 1024 ? 320 : w >= 768 ? 270 : Math.min(320, w - 72)); }; f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  React.useEffect(() => { const el = stage.current; if (!el || shown) return; const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setShown(true); io.disconnect(); } }, { threshold: 0.25 }); io.observe(el); return () => io.disconnect(); }, [shown]);

  // What each amount covers here — the dearest service it pays for in full (an amount should feel like a visit).
  const covers = (amt: number) => { const s = (services || []).filter((x: any) => x?.isActive !== false && Number(x?.price) > 0 && Number(x.price) <= amt && !x.membersOnly).sort((a: any, b: any) => Number(b.price) - Number(a.price))[0]; return s ? `Covers a ${s.name}` : null; };
  // A real occasion in season among the business's designs (Holidays, Valentine's, Mother's Day…) — never invented.
  const occasion = React.useMemo(() => designsSync().find((d) => d.collection === 'Occasions' && d.season && inSeason(d) && (!offered || offered.includes(d.id))) || null, [offered]);
  const go = (i: number) => {
    const it = list[i]; if (preview) { setActive(i); return; }
    const q = new URLSearchParams({ amount: String(it.amount), design: it.design }); if (to.trim()) q.set('to', to.trim().slice(0, 60));
    setLeaving(true); setTimeout(() => { window.location.href = `/gift/${encodeURIComponent(tenantId)}?${q}`; }, reduce ? 0 : 320);
  };
  const onMove = (e: React.PointerEvent) => { if (reduce || !wide || e.pointerType !== 'mouse') return; const r = stage.current?.getBoundingClientRect(); if (!r) return;
    setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -7, y: ((e.clientX - r.left) / r.width - 0.5) * 9 }); };
  const name = to.trim() ? to.trim() : 'Someone special';
  const it = list[active];
  const cardH = Math.round(cw * 265 / 420);

  return (
    <div className="gcs" style={{ color: ink, fontFamily: font }}>
      <style>{`
        .gcs-card{transition:transform .9s cubic-bezier(.2,.8,.2,1),filter .5s,opacity .5s;will-change:transform}
        .gcs-float{animation:gcsFloat 5.5s ease-in-out infinite}
        @keyframes gcsFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        .gcs-sweep{position:absolute;inset:0;overflow:hidden;pointer-events:none}
        .gcs-sweep::after{content:'';position:absolute;top:-20%;bottom:-20%;width:38%;left:-60%;background:linear-gradient(105deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-12deg);animation:gcsSweep 5s ease-in-out 1.2s infinite}
        @keyframes gcsSweep{0%{left:-60%}22%{left:130%}100%{left:130%}}
        .gcs-side:hover>div{transform:translateY(-10px) scale(1.02)}.gcs-side>div{transition:transform .35s cubic-bezier(.2,.8,.2,1)}
        .gcs-cta{transition:transform .25s,box-shadow .25s}.gcs-cta:hover{transform:translateY(-2px)}
        .gcs-cta::after{content:'→';display:inline-block;margin-left:.45em;transition:transform .25s}.gcs-cta:hover::after{transform:translateX(4px)}
        .gcs-pop{animation:gcsPop .45s cubic-bezier(.2,.8,.2,1)}@keyframes gcsPop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion: reduce){.gcs-card{transition:none}.gcs-float,.gcs-sweep::after,.gcs-pop{animation:none}}
      `}</style>
      {occasion && <div className="mb-6 flex justify-center"><span className="gcs-pop inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-medium" style={{ background: `color-mix(in srgb, ${accent} 10%, #fff)`, color: ink }}>
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: occasion.lineColor || accent }} />{occasion.name} cards are here — schedule it to arrive on the day</span></div>}

      {/* The stage: three real cards */}
      <div ref={stage} onPointerMove={onMove} onPointerLeave={() => setTilt({ x: 0, y: 0 })}
        onTouchStart={(e) => { swipe.current = e.touches[0]?.clientX ?? null; }} onTouchEnd={(e) => { const x0 = swipe.current; const x1 = e.changedTouches[0]?.clientX; swipe.current = null; if (x0 == null || x1 == null || Math.abs(x1 - x0) < 40) return; setActive((a) => Math.max(0, Math.min(list.length - 1, a + (x1 < x0 ? 1 : -1)))); }}
        className="relative mx-auto" style={{ perspective: 1400, height: wide ? cardH + 90 : cardH + 40, maxWidth: wide ? cw * 3 : '100%', overflow: wide ? 'visible' : 'hidden', touchAction: 'pan-y' }}>
        <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d', transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transition: 'transform .35s ease-out' }}>
          {list.map((c, i) => {
            const off = i - active; const isA = i === active;
            const fan = wide ? (shown ? { x: (i - 1) * cw * 0.95, r: (i - 1) * 5, y: isA ? -22 : 16, s: isA ? 1.06 : 0.88 } : { x: 0, r: 0, y: 30, s: 0.86 })
              : { x: off * (cw * 0.86), r: off * 4, y: isA ? 0 : 14, s: isA ? 1 : 0.86 };
            return (
              <button key={i} type="button" onClick={() => (isA ? go(i) : setActive(i))} aria-label={`${money(c.amount)} gift card${c.label ? ` — ${c.label}` : ''}`} aria-pressed={isA}
                className={`gcs-card absolute left-1/2 top-1/2 rounded-[20px] outline-none focus-visible:ring-4 ${isA ? '' : 'gcs-side'}`}
                style={{ width: cw, height: cardH, marginLeft: -cw / 2, marginTop: -cardH / 2, zIndex: isA ? 3 : 2 - Math.abs(off), opacity: !wide && Math.abs(off) > 1 ? 0 : 1, filter: isA ? 'none' : 'saturate(.85) brightness(.97)',
                  transform: `translate3d(${fan.x}px, ${fan.y + (leaving && isA ? -40 : 0)}px, ${isA ? 60 : 0}px) rotate(${fan.r}deg) scale(${leaving && isA ? 1.12 : fan.s})`, transitionDelay: shown ? `${i * 70}ms` : '0ms' }}>
                <div className={isA && !reduce ? 'gcs-float' : ''} style={{ position: 'relative', borderRadius: Math.round(20 * cw / 420), overflow: 'hidden' }}>
                  <GiftCardFace design={designById(c.design)} brand={brand} amount={money(c.amount)} name={name} width={cw} />
                  {isA && !reduce && <span className="gcs-sweep" aria-hidden />}
                </div>
              </button>);
          })}
        </div>
      </div>

      {/* Mobile: dots to swipe between them */}
      {!wide && <div className="mt-3 flex justify-center gap-1.5">{list.map((_, i) => <button key={i} type="button" aria-label={`Card ${i + 1}`} onClick={() => setActive(i)} className="flex h-6 items-center justify-center px-1" style={{ minHeight: 0 }}><span className="block h-1.5 rounded-full transition-all" style={{ width: i === active ? 20 : 6, background: i === active ? ink : line }} /></button>)}</div>}
      {!wide && <div className="mt-2 flex justify-between px-1">{active > 0 ? <button type="button" onClick={() => setActive(active - 1)} className="text-[13px]" style={{ color: muted }}>‹ {money(list[active - 1].amount)}</button> : <span />}{active < list.length - 1 ? <button type="button" onClick={() => setActive(active + 1)} className="text-[13px]" style={{ color: muted }}>{money(list[active + 1].amount)} ›</button> : <span />}</div>}

      {/* The chosen one: what it is, what it covers, who it's for, and the button */}
      <div className="mx-auto mt-6 max-w-md text-center">
        <div key={active} className="gcs-pop">
          <p className="text-[13px] uppercase tracking-[0.14em]" style={{ color: muted }}>{it.label || 'Gift card'}</p>
          <p className="mt-1 text-[38px] font-light leading-none tracking-[-0.03em]">{money(it.amount)}</p>
          {covers(it.amount) && <p className="mt-2 text-[14.5px]" style={{ color: muted }}>{covers(it.amount)}</p>}
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-full border bg-white p-1.5 pl-5" style={{ borderColor: line }}>
          <input value={to} onChange={(e) => setTo(e.target.value.slice(0, 40))} placeholder="Who’s it for?" aria-label="Who’s it for?" className="h-11 min-w-0 flex-1 bg-transparent text-[15.5px] outline-none" />
          <button type="button" onClick={() => go(active)} className="gcs-cta h-11 shrink-0 rounded-full px-5 text-[14.5px] font-semibold text-white" style={{ background: accent, boxShadow: `0 10px 24px color-mix(in srgb, ${accent} 30%, transparent)` }}>Give this card</button>
        </div>
        <p className="mt-3 text-[13px]" style={{ color: muted }}>Sent by text or email · Arrives on the day you choose · Never expires</p>
        {!preview && <a href={`/gift/${encodeURIComponent(tenantId)}${to.trim() ? `?to=${encodeURIComponent(to.trim())}` : ''}`} className="mt-2 inline-block text-[13.5px] underline-offset-4 hover:underline" style={{ color: muted }}>Or choose your own amount and design</a>}
      </div>
    </div>);
}
