'use client';
// src/app/drive-thru/[tenantId]/menu/page.tsx — THE MENU BOARD: the screen guests read before they order (at the
// drive-thru, or inside by the counter), laid out the way quick-service boards are, so the eye lands where it sells:
//   • One item shown big, up front (the hero): what the business features, else its best sellers. A large photo, the name
//     in tall condensed type, and the price on a tag in the business's own color. It changes every few seconds when there
//     are several (the one motion on the board; for a screen set to less motion, no zoom, and it and any turns of the menu
//     come every 20 seconds).
//   • The menu by section: each section's first items with photos as pictures, the rest as lines. The price sits right
//     after the name, without a dollar sign and never in a column of prices to compare.
//   • Tags: Popular (worked out from the week's sales), New and Limited time (the business's own), calories when given.
//   • Sold out shows as it happens. The code to order ahead sits under the hero while that's on.
//   • Dark (outdoors, bright sun) or light (inside), picked on each screen. Big type to read from a car.
// A business with more than one screen can split it: each screen shows all sections, or just one (picked in the corner,
// or with ?show=Burgers in its address). A menu too long for the screen shows its sections (or a section's items) in
// turn, never cut off. If it loses touch
// with the server it keeps the last menu it had.
//   Set up like the order board, with a show-only key (api/kitchen 'pair', kind 'drive-thru-board'). Reads api/counter
//   'menuBoard' only.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';

type Look = 'dark' | 'light';
const LOOKS: Record<Look, { bg: string; panel: string; text: string; sub: string; rule: string; label: string }> = {
  dark: { bg: '#15120f', panel: '#221d18', text: '#fff8ec', sub: '#c7bcaa', rule: 'rgba(255,248,236,0.14)', label: 'Dark, for outdoors' },
  light: { bg: '#efece6', panel: '#ffffff', text: '#1d1a16', sub: '#6b645a', rule: 'rgba(29,26,22,0.12)', label: 'Light, for inside' },
};
// Without a color of the business's own: marigold, with dark type on it.
const MARIGOLD = '#f2b705';
const POLL_MS = 15000, ROTATE_MS = 12000, HERO_MS = 8000;
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', system-ui, sans-serif";
type Item = { id: string; name: string; words: string | null; price: number; from: boolean; startPrice: number; imageUrl: string | null; soldOut: boolean;
  featured?: boolean; badge?: 'popular' | 'new' | 'limited' | null; calories?: number | null };
type Board = { business: { name: string }; sections: { name: string; items: Item[] }[]; orderAhead: string | null; accent?: string | null };
const BADGE: Record<string, string> = { popular: 'Popular', new: 'New', limited: 'Limited time' };
// Prices as the board shows them: no dollar sign, two places ("7.49", "from 2.49").
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const keyName = (t: string) => `cf.drivethru.menuboard.${t}`;
const showName = (t: string) => `cf.drivethru.menuboard.show.${t}`;
const lookName = (t: string) => `cf.drivethru.menuboard.look.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const hide = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.visibility = 'hidden'; };
// Colors: how far apart two are (for a business color that's hard to see on the board's background), and one mixed toward another.
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (hex: string) => { const [r, g, b] = rgb(hex).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return `#${x.map((v, k) => Math.round(v * (1 - t) + y[k] * t).toString(16).padStart(2, '0')).join('')}`; };
const HEX = /^#[0-9a-f]{6}$/i;

function Tag({ kind, accent, ink, edge }: { kind: string; accent: string; ink: string; edge?: string }) {
  return <span className="inline-block shrink-0 rounded-full px-[0.7em] py-[0.12em] font-semibold" style={{ fontSize: 'clamp(12px,1.6vh,20px)', background: accent, color: ink, boxShadow: edge }}>{BADGE[kind] || kind}</span>;
}

export default function MenuBoard() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [board, setBoard] = useState<Board | null>(null); const [stopped, setStopped] = useState('');
  const [show, setShowState] = useState<string>(''); const [look, setLookState] = useState<Look>('dark'); const [picking, setPicking] = useState(false);
  const [qr, setQr] = useState<{ url: string; img: string } | null>(null);
  const [closed, setClosed] = useState(false);
  const [page, setPage] = useState(0); const [hero, setHero] = useState(0);
  // How tightly the menu is set to fit the screen (0 = roomiest), for the menu and screen size it was worked out for.
  const [fitAt, setFitAt] = useState({ key: '', n: 0 });
  const body = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const [dims, setDims] = useState({ w: 1920, h: 1080 }); const wide = dims.w >= dims.h * 1.15; const vp = `${dims.w}x${dims.h}`;
  useEffect(() => { const f = () => setDims({ w: window.innerWidth, h: window.innerHeight }); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  // The board's tall condensed type (a fallback narrow face if it can't load). Once it's in, the menu is fitted again.
  const [fontIn, setFontIn] = useState(false);
  useEffect(() => {
    const id = 'cf-board-font'; let live = true;
    const loaded = () => { void (document as any).fonts?.load?.("600 40px 'Barlow Condensed'")?.then((f: any[]) => { if (live && f?.length) setFontIn(true); }).catch(() => null); };
    const had = document.getElementById(id) as HTMLLinkElement | null;
    // (Already added, it may still be loading: asked again once it has, and once every face on the page is in.)
    if (had) { loaded(); had.addEventListener('load', loaded); void (document as any).fonts?.ready?.then(loaded).catch?.(() => null); }
    else { const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap'; l.onload = loaded; document.head.appendChild(l); }
    return () => { live = false; had?.removeEventListener('load', loaded); };
  }, []);
  // A screen set to less motion: no zoom on the featured item, and it changes less often.
  const [calm, setCalm] = useState(false);
  useEffect(() => { const m = window.matchMedia?.('(prefers-reduced-motion: reduce)'); if (!m) return; const f = () => setCalm(m.matches); f(); m.addEventListener?.('change', f); return () => m.removeEventListener?.('change', f); }, []);
  useEffect(() => {
    setKey(read(keyName(tenantId)));
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    setShowState(q?.get('show') ?? read(showName(tenantId)) ?? '');
    const l = (q?.get('look') || read(lookName(tenantId))) as Look | null; if (l === 'dark' || l === 'light') setLookState(l);
    setReady(true);
  }, [tenantId]);
  const setShow = (v: string) => { setShowState(v); write(showName(tenantId), v || null); setPicking(false); };
  const setLook = (v: Look) => { setLookState(v); write(lookName(tenantId), v); setPicking(false); };
  const load = useCallback(async () => {
    if (!key || inFlight.current) return; inFlight.current = true;
    try {
      const r = await fetch('/api/counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, action: 'menuBoard' }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { write(keyName(tenantId), null); setKey(null); setStopped('This screen was stopped. A manager can set it up again.'); return; }
      if (d.closed) { setClosed(true); return; }
      if (d.ok) { setBoard(d); setClosed(false); }
    } catch { /* keeps the last menu, and tries again */ } finally { inFlight.current = false; }
  }, [tenantId, key]);
  useEffect(() => { if (!key) return; load(); const i = setInterval(load, POLL_MS); return () => clearInterval(i); }, [key, load]);
  useEffect(() => { if (!picking) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicking(false); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [picking]);
  // (Closed, the picker hands focus back to its button.)
  const pickBtn = useRef<HTMLButtonElement>(null); const wasPicking = useRef(false);
  useEffect(() => { if (wasPicking.current && !picking) pickBtn.current?.focus(); wasPicking.current = picking; }, [picking]);
  const ahead = board?.orderAhead || null;
  useEffect(() => {
    if (!ahead || qr?.url === ahead) return; let live = true;
    void import('qrcode').then((Q: any) => Q.toDataURL(ahead, { margin: 1, width: 400, color: { dark: '#15120f', light: '#ffffff' } })).then((img: string) => { if (live) setQr({ url: ahead, img }); }).catch(() => null);
    return () => { live = false; };
  }, [ahead]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fitting the menu on the screen, a step at a time until it fits (before it's ever shown cut off): every section with
  // photos for up to four items; then two; then none; then (showing everything) the sections take turns, with photos and
  // then without. A screen showing one section: pictures filling it; then without pictures; then as lines; then its items
  // in turns, two pages, three, up to six.
  const sig = board ? board.sections.map((x) => `${x.name}:${x.items.map((i) => `${i.id}${i.imageUrl ? '+' : ''}${i.badge || ''}${i.calories != null ? 'c' : ''}${i.words ? 'w' : ''}`).join(',')}`).join('|') : '';
  const fitKey = `${sig}#${show}#${vp}#${fontIn ? 'f' : ''}`;
  const fit = fitAt.key === fitKey ? fitAt.n : 0;
  const single = !!show && !!board?.sections.some((x) => x.name === show && x.items.length);
  const most = single ? 7 : 4;
  useLayoutEffect(() => {
    const el = body.current; if (!el || fit >= most) return;
    if (el.scrollHeight > el.clientHeight + 4) setFitAt({ key: fitKey, n: fit + 1 });
  });
  const rotate = !single && fit >= 3;
  // (Its items split evenly into that many pages, never an empty one.)
  const singleN = single ? board!.sections.find((x) => x.name === show && x.items.length)!.items.length : 0;
  const per = single && fit >= 2 ? Math.max(1, Math.ceil(singleN / (fit - 1))) : singleN;
  const pages = single && fit >= 2 ? Math.max(1, Math.ceil(singleN / per)) : 1;
  useEffect(() => { if (!rotate && pages < 2) return; const i = setInterval(() => setPage((n) => n + 1), calm ? 20000 : ROTATE_MS); return () => clearInterval(i); }, [rotate, pages, calm]);
  useEffect(() => { const i = setInterval(() => setHero((n) => n + 1), calm ? 20000 : HERO_MS); return () => clearInterval(i); }, [calm]);

  const C = LOOKS[look];
  if (!ready) return <main className="min-h-dvh" style={{ background: C.bg }} />;
  if (!key) return <ScreenSetup menu tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); }} />;
  if (closed) return <main className="flex h-dvh items-center justify-center px-[6vw] text-center" style={{ background: C.bg, color: C.text }}><p className="text-[clamp(26px,4vh,52px)] font-semibold">The menu isn’t available right now.</p></main>;
  if (!board) return <main className="flex min-h-dvh items-center justify-center" style={{ background: C.bg }}><div className="h-10 w-10 animate-spin rounded-full border-4 motion-reduce:animate-none" style={{ borderColor: C.rule, borderTopColor: C.text }} role="status" aria-label="Loading the menu" /></main>;

  const own = !!board.accent && HEX.test(board.accent);
  const accent = own ? board.accent! : MARIGOLD; const ink = own ? '#ffffff' : '#15120f';
  // A business color that's hard to see on this background: its marks are mixed toward the type, and its tags get an edge.
  const faint = contrast(accent, C.bg) < 3;
  const mark = faint ? mix(accent, C.text, 0.4) : accent; const edge = faint ? `inset 0 0 0 2px ${mix(accent, C.text, 0.55)}` : undefined;
  const all = board.sections.filter((s) => s.items.length);
  const items = all.flatMap((s) => s.items);
  // The hero: what's featured (and not sold out); else the best sellers; else the first items with photos.
  const pick = (f: (i: Item) => boolean) => items.filter((i) => !i.soldOut && f(i));
  const heroes = (() => { const a = pick((i) => !!i.featured); if (a.length) return a.slice(0, 6); const b = pick((i) => i.badge === 'popular'); if (b.length) return b; return pick((i) => !!i.imageUrl).slice(0, 3); })();
  const h = heroes.length ? heroes[hero % heroes.length] : null;
  const chosen = show ? all.filter((s) => s.name === show) : all;
  const sections = (chosen.length ? chosen : all);
  const shown = rotate && sections.length ? [sections[page % sections.length]] : sections;
  const picN = single ? 0 : rotate ? (fit === 3 ? 2 : 0) : [4, 2, 0][fit] ?? 0;
  const count = shown.reduce((n, s) => n + s.items.length, 0);
  // One section on the screen: its items as pictures filling it, in the number of columns that keeps each one closest to
  // a picture's shape.
  const cols = single ? (() => { const n = shown[0].items.length, W = dims.w * 0.95, H = dims.h * 0.82; let best = 1, score = Infinity;
    for (let c = 1; c <= Math.min(wide ? 4 : 2, n); c++) { const sc = Math.abs(Math.log((W / c) / (H / Math.ceil(n / c)) / 1.15)); if (sc < score) { score = sc; best = c; } } return best; })()
    : Math.min(wide ? 3 : 2, shown.length);
  const showQr = !!(ahead && qr?.url === ahead);

  const name = (s: string, size: string, lines = 2) => <span className={`${lines === 1 ? 'truncate' : 'line-clamp-2'} block font-semibold leading-[0.98]`} style={{ fontFamily: DISPLAY, fontSize: size, letterSpacing: '0.005em' }}>{s}</span>;
  const price = (i: Item, size: string, color = C.text) => <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums" style={{ fontFamily: DISPLAY, fontSize: size, color }}>{i.from ? <><span style={{ fontSize: '0.7em' }}>from </span>{money(i.startPrice)}</> : money(i.price)}</span>;
  const meta = (i: Item) => (i.soldOut || i.badge || i.calories != null) ? (
    <span className="mt-[0.5vh] flex flex-wrap items-center gap-x-[0.8vw] gap-y-[0.4vh]">
      {i.soldOut ? <span className="rounded-full px-[0.7em] py-[0.12em] font-semibold" style={{ fontSize: 'clamp(12px,1.6vh,20px)', background: C.rule, color: C.text }}>Sold out</span> : i.badge ? <Tag kind={i.badge} accent={accent} ink={ink} edge={edge} /> : null}
      {i.calories != null && <span style={{ fontSize: 'clamp(12px,1.5vh,19px)', color: C.sub }}>{i.calories} cal</span>}
    </span>) : null;

  const heroPanel = h && !single ? (
    <section aria-label="Featured" className="relative flex min-h-0 flex-col overflow-hidden rounded-[2.4vh]" style={{ background: C.panel, ...(wide ? { width: '36%' } : { height: '38%' }) }}>
      <div className={`relative min-h-0 overflow-hidden ${wide ? 'flex-[1.35]' : 'h-full w-1/2 shrink-0'}`} style={{ background: C.bg }}>
        {h.imageUrl && <img key={`${h.id}|${h.imageUrl}`} src={h.imageUrl} alt="" onError={hide} className="cf-hero-img h-full w-full object-cover" />}
      </div>
      <div className={`flex flex-col justify-center gap-[1.2vh] px-[1.8vw] py-[2.2vh] ${wide ? '' : 'absolute inset-y-0 right-0 w-1/2'}`}>
        {h.badge && <span><Tag kind={h.badge} accent={accent} ink={ink} edge={edge} /></span>}
        {name(h.name, wide ? 'clamp(36px,7.4vh,104px)' : 'clamp(32px,5.6vh,84px)')}
        {h.words && <span className="line-clamp-2" style={{ fontSize: 'clamp(15px,2.1vh,28px)', color: C.sub }}>{h.words}</span>}
        <span className="flex items-baseline gap-[1vw]">
          <span className="whitespace-nowrap rounded-[1.2vh] px-[0.45em] py-[0.05em] font-semibold tabular-nums" style={{ fontFamily: DISPLAY, fontSize: 'clamp(34px,6.4vh,92px)', background: accent, color: ink, boxShadow: edge }}>{h.from && <span style={{ fontSize: '0.55em' }}>from </span>}{money(h.from ? h.startPrice : h.price)}</span>
          {h.calories != null && <span style={{ fontSize: 'clamp(13px,1.8vh,24px)', color: C.sub }}>{h.calories} cal</span>}
        </span>
        {heroes.length > 1 && <span aria-hidden className="flex gap-[0.5vw] pt-[0.4vh]">{heroes.map((x, k) => <span key={x.id} className="h-[0.8vh] rounded-full transition-all motion-reduce:transition-none" style={{ width: k === hero % heroes.length ? '2.6vw' : '0.8vh', background: k === hero % heroes.length ? mark : C.rule }} />)}</span>}
      </div>
      {showQr && wide && (
        <div className="flex items-center gap-[1.2vw] border-t px-[1.8vw] py-[1.6vh]" style={{ borderColor: C.rule }}>
          <img src={qr!.img} alt="Code to order ahead on your phone" className="h-[13vh] w-[13vh] shrink-0 rounded-[1vh] bg-[#fff] p-[0.5vh]" />
          <span><span className="block font-semibold leading-tight" style={{ fontFamily: DISPLAY, fontSize: 'clamp(20px,3.2vh,44px)' }}>Order ahead on your phone</span>
            <span className="block" style={{ fontSize: 'clamp(13px,1.7vh,22px)', color: C.sub }}>Scan, pay, and it’s ready when you get here.</span></span>
        </div>)}
    </section>
  ) : null;

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden" style={{ background: C.bg, color: C.text }}>
      <style>{`@keyframes cfHeroZoom { from { transform: scale(1); } to { transform: scale(1.07); } } @keyframes cfHeroIn { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: no-preference) { .cf-hero-img { animation: cfHeroIn 700ms ease-out, cfHeroZoom ${HERO_MS}ms ease-out forwards; } }`}</style>
      <header className="flex items-center justify-between gap-4 px-[2.6vw] pb-[1.4vh] pt-[2.2vh]">
        <p className="min-w-0 truncate font-semibold leading-none" style={{ fontFamily: DISPLAY, fontSize: 'clamp(26px,4.6vh,64px)' }}>{board.business.name}</p>
        {(single || rotate) && <p className="max-w-[50%] truncate font-semibold" style={{ fontFamily: DISPLAY, fontSize: 'clamp(22px,3.6vh,50px)', color: C.sub }}>{shown[0]?.name}{pages > 1 ? ` ${(page % pages) + 1} of ${pages}` : ''}</p>}
      </header>

      <div className={`flex min-h-0 flex-1 gap-[1.6vw] px-[2.6vw] pb-[2.6vh] ${wide ? 'flex-row' : 'flex-col'}`}>
        {heroPanel}
        <div ref={body} className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {single && fit >= 2 ? (() => {
            // As lines in columns; more than fit, in turns.
            const list = shown[0].items; const at = (page % pages) * per;
            return (
              <ul style={{ columnCount: wide ? 3 : 2, columnGap: '2.4vw' }} aria-label={pages > 1 ? `${shown[0].name}, part ${(page % pages) + 1} of ${pages}` : shown[0].name}>
                {list.slice(at, at + per).map((i) => (
                  <li key={i.id} className="mb-[1.8vh] break-inside-avoid" style={{ opacity: i.soldOut ? 0.5 : 1 }}>
                    <span className="flex items-baseline gap-[0.9vw]"><span className="min-w-0">{name(i.name, 'clamp(20px,3.2vh,44px)', 1)}</span>{price(i, 'clamp(19px,3vh,42px)', C.sub)}</span>
                    {meta(i)}
                  </li>
                ))}
              </ul>);
          })() : single ? (
            <ul className="grid content-start gap-[1.4vw]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, ...(fit === 0 ? { height: '100%', gridAutoRows: 'minmax(min-content, 1fr)' } : {}) }}>
              {shown[0].items.map((i) => (
                <li key={i.id} className="flex flex-col overflow-hidden rounded-[2vh]" style={{ background: C.panel, opacity: i.soldOut ? 0.5 : 1 }}>
                  {fit === 0 && <span className="relative block min-h-[14vh] w-full flex-1" style={{ background: C.bg }}>
                    {i.imageUrl && <img key={i.imageUrl} src={i.imageUrl} alt="" onError={hide} className="absolute inset-0 h-full w-full object-cover" style={{ filter: i.soldOut ? 'grayscale(1)' : undefined }} />}
                  </span>}
                  <span className="block px-[1.2vw] py-[1.4vh]">
                    {name(i.name, 'clamp(22px,3.6vh,50px)')}
                    <span className="mt-[0.6vh] flex items-center gap-[0.8vw]">{price(i, 'clamp(22px,3.4vh,48px)')}{i.badge && !i.soldOut ? <Tag kind={i.badge} accent={accent} ink={ink} edge={edge} /> : null}</span>
                    {(i.soldOut || i.calories != null) && meta({ ...i, badge: null })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid content-start gap-x-[2.4vw] gap-y-[2.6vh]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
              {shown.map((s) => {
                // A section's first items with photos lead as pictures (as many as fit); the rest are lines.
                const pics = s.items.filter((i) => !!i.imageUrl).slice(0, picN);
                const rest = s.items.filter((i) => !pics.includes(i));
                return (
                  <section key={s.name} aria-label={s.name} className="min-w-0">
                    <h2 className="font-semibold leading-none" style={{ fontFamily: DISPLAY, fontSize: 'clamp(26px,4.4vh,60px)' }}>{s.name}</h2>
                    <span aria-hidden className="mb-[1.6vh] mt-[0.9vh] block h-[0.55vh] w-[3.6vw] rounded-full" style={{ background: mark }} />
                    {pics.length > 0 && (
                      <ul className="mb-[1.6vh] grid gap-[1vw]" style={{ gridTemplateColumns: `repeat(${Math.min(shown.length === 1 && wide ? 4 : 2, pics.length)}, minmax(0,1fr))` }}>
                        {pics.map((i) => (
                          <li key={i.id} className="min-w-0 overflow-hidden rounded-[1.6vh]" style={{ background: C.panel, opacity: i.soldOut ? 0.5 : 1 }}>
                            <span className="block aspect-[16/11] w-full" style={{ background: C.bg }}><img key={i.imageUrl!} src={i.imageUrl!} alt="" onError={hide} className="h-full w-full object-cover" style={{ filter: i.soldOut ? 'grayscale(1)' : undefined }} /></span>
                            <span className="block px-[0.9vw] py-[1vh]">
                              {name(i.name, 'clamp(18px,2.9vh,40px)')}
                              <span className="mt-[0.3vh] block">{price(i, 'clamp(18px,2.8vh,38px)', C.sub)}</span>
                              {meta(i)}
                            </span>
                          </li>
                        ))}
                      </ul>)}
                    <ul style={shown.length === 1 ? { columnCount: wide ? 3 : 2, columnGap: '2.4vw' } : undefined}>
                      {rest.map((i) => (
                        <li key={i.id} className="mb-[1.2vh] break-inside-avoid" style={{ opacity: i.soldOut ? 0.5 : 1 }}>
                          <span className="flex items-baseline gap-[0.9vw]">
                            <span className="min-w-0">{name(i.name, count > 14 ? 'clamp(17px,2.6vh,34px)' : 'clamp(19px,3vh,40px)', 1)}</span>
                            {price(i, count > 14 ? 'clamp(17px,2.5vh,33px)' : 'clamp(18px,2.8vh,38px)', C.sub)}
                          </span>
                          {meta(i)}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {showQr && !wide && (
        <div className="flex items-center gap-[3vw] border-t px-[2.6vw] py-[1.6vh]" style={{ borderColor: C.rule }}>
          <img src={qr!.img} alt="Code to order ahead on your phone" className="h-[11vh] w-[11vh] shrink-0 rounded-[1vh] bg-[#fff] p-[0.5vh]" />
          <span><span className="block font-semibold leading-tight" style={{ fontFamily: DISPLAY, fontSize: 'clamp(22px,3.2vh,44px)' }}>Order ahead on your phone</span>
            <span className="block" style={{ fontSize: 'clamp(13px,1.6vh,22px)', color: C.sub }}>Scan, pay, and it’s ready when you get here.</span></span>
        </div>)}

      <div className="absolute bottom-2 right-3">
        <button ref={pickBtn} type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking} className="min-h-[44px] min-w-[44px] max-w-[40vw] truncate rounded-xl px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2" style={{ color: C.sub, opacity: 0.75 }}>{show || 'All sections'}, {look === 'dark' ? 'dark' : 'light'}</button>
        {picking && (
          <div className="absolute bottom-12 right-0 w-64 space-y-1 rounded-2xl p-2" style={{ background: C.panel, border: `1px solid ${C.rule}` }} role="group" aria-label="What this screen shows">
            {all.length > 1 && ['', ...all.map((s) => s.name)].map((n) => (
              <button key={n || 'all'} type="button" aria-pressed={show === n} onClick={() => setShow(n)} className="flex min-h-[44px] w-full items-center rounded-xl px-3 text-left text-[15px]" style={show === n ? { background: C.text, color: C.bg } : { color: C.text }}>{n || 'All sections'}</button>
            ))}
            <div className="my-1 border-t" style={{ borderColor: C.rule }} />
            {(Object.keys(LOOKS) as Look[]).map((k) => (
              <button key={k} type="button" aria-pressed={look === k} onClick={() => setLook(k)} className="flex min-h-[44px] w-full items-center rounded-xl px-3 text-left text-[15px]" style={look === k ? { background: C.text, color: C.bg } : { color: C.text }}>{LOOKS[k].label}</button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
