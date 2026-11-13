'use client';
// src/app/drive-thru/[tenantId]/menu/page.tsx — THE MENU BOARD: the screen guests read before they order (at the
// drive-thru, or inside by the counter), in the same look as the rest of ClarityFlow, with a picture for every item
// (most guests choose by what they see):
//   • One item shown big (the featured card): what the business features, else its best sellers. Its photo, its name, its
//     words, and the price on a tag in the business's own color. It changes every few seconds when there are several (the
//     one motion on the board; for a screen set to less motion, it and any turns of the menu come every 20 seconds).
//   • Every other item as a picture card, section by section: photo, name, price, calories. An item without a photo keeps
//     its place with its first letter.
//   • Tags: Popular (worked out from the week's sales), New and Limited time (the business's own). Sold out shows as it
//     happens, the picture grayed. The code to order ahead sits at the top while that's on.
//   • Light (inside) or dark (outdoors, bright sun), picked on each screen. Numbers on the items ("number 3"), the same
//     numbers the lane tablet and the voice assistant at the speaker know (lib/menu-numbers): on for a dark screen unless
//     turned off, off for a light one unless turned on.
//   • The shop's products picked for the pickup window (lib/pickup-window) after the menu, numbered after it: each with
//     its size, its shades as dots, and Pros only when it's sold to licensed pros alone. A business with only a shop
//     shows just its window, and the code goes to its shop.
// A business with more than one screen can split it: each screen shows all sections, or just one (picked in the corner,
// or with ?show=Drinks in its address). A menu too long for the screen gets smaller pictures, then lines, then shows its
// sections (or a section's items) in turn, never cut off. If it loses touch with the server it keeps the last menu it had.
//   Set up like the order board, with a show-only key (api/kitchen 'pair', kind 'drive-thru-board'). Reads api/counter
//   'menuBoard' only.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';

type Look = 'dark' | 'light';
type Tone = { bg: string; card: string; well: string; line: string; text: string; sub: string; faint: string; popular: [string, string]; fresh: [string, string]; out: [string, string]; label: string };
const LOOKS: Record<Look, Tone> = {
  light: { bg: '#f5f5f7', card: '#ffffff', well: '#f5f5f7', line: '#ececee', text: '#16171a', sub: '#6d7075', faint: '#c4c6ca', popular: ['#fff7ed', '#b45309'], fresh: ['#ecf6f0', '#1f7a4d'], out: ['#ececee', '#6d7075'], label: 'Light, for inside' },
  dark: { bg: '#16171a', card: '#232428', well: '#2c2d31', line: '#2c2d31', text: '#ffffff', sub: '#a6a8ad', faint: '#55575d', popular: ['#3a2a14', '#f5b45a'], fresh: ['#183427', '#74d19c'], out: ['#2c2d31', '#a6a8ad'], label: 'Dark, for outdoors' },
};
const INK = '#16171a';
const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
const POLL_MS = 15000, ROTATE_MS = 12000, HERO_MS = 8000;
type Item = { id: string; name: string; words: string | null; price: number; from: boolean; startPrice: number; imageUrl: string | null; soldOut: boolean;
  featured?: boolean; badge?: 'popular' | 'new' | 'limited' | null; calories?: number | null; number?: number | null ;
  /** A product from the shop's window (lib/pickup-window): its size, its shades, and Pros only. */
  kind?: 'product'; size?: string | null; prosOnly?: boolean; swatches?: { label: string; color: string | null; soldOut: boolean }[] };
type Board = { business: { name: string }; sections: { name: string; items: Item[] }[]; orderAhead: string | null; accent?: string | null };
const BADGE: Record<string, string> = { popular: 'Popular', new: 'New', limited: 'Limited time' };
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const keyName = (t: string) => `cf.drivethru.menuboard.${t}`;
const showName = (t: string) => `cf.drivethru.menuboard.show.${t}`;
const lookName = (t: string) => `cf.drivethru.menuboard.look.${t}`;
const numName = (t: string) => `cf.drivethru.menuboard.numbers.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const hide = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.visibility = 'hidden'; };
const HEX = /^#[0-9a-f]{6}$/i;
// How light a color is (0 dark to 1 light), for the business's color on a dark screen.
const light = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

// Card sizes, roomiest first: the picture's height (and width for a card laid on its side), the name, the price.
const SIZES = [
  { pic: 30, name: 3.6, price: 3.2, cal: 2 },
  { pic: 26, name: 3.3, price: 2.95, cal: 1.85 },
  { pic: 22, name: 3, price: 2.7, cal: 1.7 },
  { pic: 17, name: 2.6, price: 2.3, cal: 1.55 },
  { pic: 14.5, name: 2.4, price: 2.15, cal: 1.5 },
  { pic: 12.5, name: 2.2, price: 2.0, cal: 1.45 },
  { pic: 10.5, name: 2.05, price: 1.85, cal: 1.4 },
  { pic: 8.5, name: 1.9, price: 1.75, cal: 1.35 },
];

// Where each cell of the menu goes on a wide screen k cards across, section by section ([its name, ...its items]): a
// section sits beside the one before it only when all of it fits in what's left of that row; a longer one starts a row
// of its own, its name in the first column beside all its items. So an item is never read as part of the section above.
type Spot = { gridColumn: string; gridRow: string };
function place(counts: number[], k: number): Spot[][] {
  const out: Spot[][] = []; let r = 1, c = 1;
  for (const n of counts) {
    const cells: Spot[] = [];
    if (c > 1 && n + 1 > k - c + 1) { r++; c = 1; }
    if (n + 1 <= k - c + 1) {
      for (let j = 0; j <= n; j++) cells.push({ gridColumn: `${c + j}`, gridRow: `${r}` });
      c += n + 1; if (c > k) { r++; c = 1; }
    } else {
      const rows = Math.ceil(n / (k - 1));
      cells.push({ gridColumn: '1', gridRow: `${r} / span ${rows}` });
      for (let j = 0; j < n; j++) cells.push({ gridColumn: `${2 + (j % (k - 1))}`, gridRow: `${r + Math.floor(j / (k - 1))}` });
      r += rows; c = 1;
    }
    out.push(cells);
  }
  return out;
}

export default function MenuBoard() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [board, setBoard] = useState<Board | null>(null); const [stopped, setStopped] = useState('');
  const [show, setShowState] = useState<string>(''); const [look, setLookState] = useState<Look>('dark'); const [picking, setPicking] = useState(false);
  const [numbersSet, setNumbersState] = useState<boolean | null>(null);
  const [qr, setQr] = useState<{ url: string; img: string } | null>(null);
  const [closed, setClosed] = useState(false);
  const [page, setPage] = useState(0); const [hero, setHero] = useState(0);
  // How tightly the menu is set to fit the screen (0 = roomiest), for the menu and screen size it was worked out for.
  const [fitAt, setFitAt] = useState({ key: '', n: 0 });
  // How many cards across the grid has room for at that fit (read from an empty copy of the grid, which nothing placed
  // can widen), to place the sections by.
  const [colsAt, setColsAt] = useState({ key: '', n: 0 });
  const body = useRef<HTMLDivElement>(null); const probe = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const [dims, setDims] = useState({ w: 1920, h: 1080 }); const wide = dims.w >= dims.h * 1.15; const vp = `${dims.w}x${dims.h}`;
  useEffect(() => { const f = () => setDims({ w: window.innerWidth, h: window.innerHeight }); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  // (Fitted again once the app's typeface is in, since the fallback's letters are a different width.)
  const [fontIn, setFontIn] = useState(false);
  useEffect(() => { let live = true; void (document as any).fonts?.ready?.then(() => { if (live) setFontIn(true); }).catch?.(() => null); return () => { live = false; }; }, []);
  // A screen set to less motion: the featured item and any turns of the menu change less often.
  const [calm, setCalm] = useState(false);
  useEffect(() => { const m = window.matchMedia?.('(prefers-reduced-motion: reduce)'); if (!m) return; const f = () => setCalm(m.matches); f(); m.addEventListener?.('change', f); return () => m.removeEventListener?.('change', f); }, []);
  useEffect(() => {
    setKey(read(keyName(tenantId)));
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    setShowState(q?.get('show') ?? read(showName(tenantId)) ?? '');
    const l = (q?.get('look') || read(lookName(tenantId))) as Look | null; if (l === 'dark' || l === 'light') setLookState(l);
    const nq = q?.get('numbers') ?? read(numName(tenantId)); if (nq === 'on' || nq === '1') setNumbersState(true); else if (nq === 'off' || nq === '0') setNumbersState(false);
    setReady(true);
  }, [tenantId]);
  const setShow = (v: string) => { setShowState(v); write(showName(tenantId), v || null); setPicking(false); };
  const setLook = (v: Look) => { setLookState(v); write(lookName(tenantId), v); setPicking(false); };
  const numbers = numbersSet ?? look === 'dark';
  const setNumbers = (v: boolean) => { setNumbersState(v); write(numName(tenantId), v ? 'on' : 'off'); setPicking(false); };
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
    void import('qrcode').then((Q: any) => Q.toDataURL(ahead, { margin: 1, width: 400, color: { dark: INK, light: '#ffffff' } })).then((img: string) => { if (live) setQr({ url: ahead, img }); }).catch(() => null);
    return () => { live = false; };
  }, [ahead]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fitting the menu on the screen, a step at a time until it fits (before it's ever shown cut off): big pictures, then
  // a size smaller at a time (on a wide screen showing everything, each size first with every section on rows of its
  // own, then run together); then lines with small pictures; then (showing everything) the sections take turns, as
  // pictures and then as lines. A screen showing one section: the same, then its items in turns, two pages, three, up to
  // seven.
  const sig = board ? board.sections.map((x) => `${x.name}:${x.items.map((i) => `${i.id}${i.imageUrl ? '+' : ''}${i.badge || ''}${i.calories != null ? 'c' : ''}${i.number ?? ''}${i.size ? 's' : ''}${i.prosOnly ? 'p' : ''}${(i.swatches || []).length}`).join(',')}`).join('|') : '';
  const fitKey = `${sig}#${show}#${vp}#${numbers ? 'n' : ''}#${fontIn ? 'f' : ''}`;
  const fit = fitAt.key === fitKey ? fitAt.n : 0;
  const single = !!show && !!board?.sections.some((x) => x.name === show && x.items.length);
  const pair = wide && !single;
  const PIC = SIZES.length * (pair ? 2 : 1); // the steps with pictures; then lines; then turns
  const most = single ? PIC + 6 : PIC + SIZES.length + 1;
  const colKey = `${fitKey}#${fit}`;
  useLayoutEffect(() => {
    // (Read again every time, so a change in the room, such as the featured card coming or going, is never missed.)
    const pr = probe.current;
    if (pr) { const n = getComputedStyle(pr).gridTemplateColumns.split(' ').filter(Boolean).length; if (colsAt.key !== colKey || colsAt.n !== n) { setColsAt({ key: colKey, n }); return; } }
    const el = body.current; if (!el || fit >= most) return;
    if (el.scrollHeight > el.clientHeight + 4 || el.scrollWidth > el.clientWidth + 4) setFitAt({ key: fitKey, n: fit + 1 });
  });
  const rotate = !single && fit > PIC;
  // (A section in turns: its items split evenly into that many pages, never an empty one.)
  const singleN = single ? board!.sections.find((x) => x.name === show && x.items.length)!.items.length : 0;
  const per = single && fit > PIC ? Math.max(1, Math.ceil(singleN / (fit - PIC + 1))) : singleN;
  const pages = single && fit > PIC ? Math.max(1, Math.ceil(singleN / per)) : 1;
  useEffect(() => { if (!rotate && pages < 2) return; const i = setInterval(() => setPage((n) => n + 1), calm ? 20000 : ROTATE_MS); return () => clearInterval(i); }, [rotate, pages, calm]);
  useEffect(() => { const i = setInterval(() => setHero((n) => n + 1), calm ? 20000 : HERO_MS); return () => clearInterval(i); }, [calm]);

  const C = LOOKS[look];
  if (!ready) return <main className="min-h-dvh" style={{ background: C.bg }} />;
  if (!key) return <ScreenSetup menu tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); }} />;
  if (closed) return <main className="flex h-dvh items-center justify-center px-[6vw] text-center" style={{ background: C.bg, color: C.text, fontFamily: FONT }}><p className="text-[clamp(26px,4vmin,52px)] font-bold">The menu isn’t available right now.</p></main>;
  if (!board) return <main className="flex min-h-dvh items-center justify-center" style={{ background: C.bg }}><div className="h-10 w-10 animate-spin rounded-full border-4 motion-reduce:animate-none" style={{ borderColor: C.line, borderTopColor: C.text }} role="status" aria-label="Loading the menu" /></main>;

  // The business's own color on its logo tile, the featured price and Limited time; on a dark screen a dark color would
  // vanish, so there it's white with dark type.
  const own = !!board.accent && HEX.test(board.accent) ? board.accent! : INK;
  const onDark = look === 'dark' && light(own) < 0.32;
  const brand = onDark ? '#ffffff' : own; const brandInk = onDark ? INK : '#ffffff';
  const all = board.sections.filter((s) => s.items.length);
  const items = all.flatMap((s) => s.items);
  // The featured item: what's featured (and not sold out); else the best sellers; else the first items with photos.
  const pick = (f: (i: Item) => boolean) => items.filter((i) => !i.soldOut && f(i));
  const heroes = (() => { const a = pick((i) => !!i.featured); if (a.length) return a.slice(0, 6); const b = pick((i) => i.badge === 'popular'); if (b.length) return b; return pick((i) => !!i.imageUrl).slice(0, 3); })();
  const h = heroes.length ? heroes[hero % heroes.length] : null;
  const chosen = show ? all.filter((s) => s.name === show) : all;
  const sections = chosen.length ? chosen : all;
  const shown = rotate && sections.length ? [sections[page % sections.length]] : sections;
  // Pictures at one of the SIZES, or lines. (Sections in turns: the biggest pictures each one fits, then lines.)
  const lines = rotate ? fit - PIC - 1 >= SIZES.length : fit >= PIC;
  const size = Math.min(rotate ? fit - PIC - 1 : pair ? fit >> 1 : fit, SIZES.length - 1);
  const S = SIZES[size];
  const tagOf = (i: Item): [string, string, string] | null => i.soldOut ? ['Sold out', C.out[0], C.out[1]]
    : i.badge === 'popular' ? ['Popular', C.popular[0], C.popular[1]] : i.badge === 'new' ? ['New', C.fresh[0], C.fresh[1]] : i.badge === 'limited' ? ['Limited time', brand, brandInk] : null;
  const tag = (i: Item, size: string) => { const t = tagOf(i); return t ? <span className="inline-block max-w-full shrink-0 truncate whitespace-nowrap rounded-full px-[0.75em] py-[0.25em] font-bold" style={{ fontSize: size, background: t[1], color: t[2] }}>{t[0]}</span> : null; };
  const num = (i: Item, size: string) => numbers && i.number ? <span role="img" aria-label={`Number ${i.number}`} className="inline-flex shrink-0 items-center justify-center rounded-full font-extrabold tabular-nums" style={{ width: size, height: size, fontSize: `calc(${size} * 0.5)`, background: look === 'dark' ? '#ffffff' : INK, color: look === 'dark' ? INK : '#ffffff' }}>{i.number}</span> : null;
  // A section's numbers ("Numbers 3 to 7"), under its name, so an item that wraps onto the next row still reads as its.
  const range = (list: Item[]) => {
    const n = numbers ? list.map((i) => i.number).filter((x): x is number => !!x) : [];
    if (!n.length) return null; const a = Math.min(...n), b = Math.max(...n);
    return a === b ? `Number ${a}` : `Numbers ${a} to ${b}`;
  };
  // A product's shades as dots (those with a color; a sold-out one faded), up to a few with how many more.
  const dots = (i: Item, d: string, most = 7) => {
    const sw = (i.swatches || []).filter((w) => w.color); if (!sw.length) return null;
    return (
      <span role="img" aria-label={`${sw.length} colors`} className="flex items-center gap-[0.5vmin]">
        {sw.slice(0, most).map((w, k) => <span key={k} className="shrink-0 rounded-full" style={{ width: d, height: d, background: w.color!, opacity: w.soldOut ? 0.35 : 1, boxShadow: `inset 0 0 0 1px ${look === 'dark' ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.1)'}` }} />)}
        {sw.length > most && <span className="font-semibold" style={{ fontSize: `calc(${d} * 0.9)`, color: C.sub }}>+{sw.length - most}</span>}
      </span>);
  };
  // "Pros only": sold to licensed pros alone.
  const pros = (i: Item, size: string) => i.prosOnly ? <span className="inline-block shrink-0 whitespace-nowrap rounded-full px-[0.75em] py-[0.25em] font-bold" style={{ fontSize: size, background: look === 'dark' ? '#ffffff' : INK, color: look === 'dark' ? INK : '#ffffff' }}>Pros only</span> : null;
  // What sits beside the price: calories for the menu, the size for a product.
  const extra = (i: Item, size: string) => i.calories != null ? <span style={{ fontSize: size, color: C.sub }}>{i.calories} cal</span>
    : i.size ? <span style={{ fontSize: size, color: C.sub }}>{i.size}</span> : null;
  const price = (i: Item) => <>{i.from && <span style={{ fontSize: '0.78em', fontWeight: 600 }}>from </span>}{money(i.from ? i.startPrice : i.price)}</>;
  const picture = (i: Item, letter: string) => i.imageUrl
    // (A product's photo whole, the way a shop shows it; a dish's or drink's photo filling its space.)
    ? <img key={i.imageUrl} src={i.imageUrl} alt="" onError={hide} className={`h-full w-full ${i.kind === 'product' ? 'object-contain p-[6%]' : 'object-cover'}`} style={i.soldOut ? { filter: 'grayscale(1)', opacity: 0.45 } : undefined} />
    : <span aria-hidden className="flex h-full w-full items-center justify-center font-extrabold" style={{ color: C.faint, fontSize: letter }}>{i.name.trim().charAt(0).toUpperCase()}</span>;
  const cardBox = { background: C.card, border: look === 'light' ? `1px solid ${C.line}` : 'none' } as const;

  // A picture card: on a wide screen the picture on top, on a tall one beside the words.
  const card = (i: Item, at?: Spot) => wide ? (
    <li key={i.id} className="flex min-w-0 flex-col rounded-[2.2vmin] p-[0.9vmin]" style={{ ...cardBox, ...at }}>
      <span className="relative block w-full overflow-hidden rounded-[1.6vmin]" style={{ height: `${S.pic}vmin`, background: C.well }}>
        {picture(i, `${S.pic * 0.42}vmin`)}
        <span className="absolute left-[0.8vmin] top-[0.8vmin]">{num(i, `${S.name * 1.25}vmin`)}</span>
        <span className="absolute right-[0.8vmin] top-[0.8vmin]">{pros(i, `${S.cal}vmin`)}</span>
        <span className="absolute bottom-[0.8vmin] left-[0.8vmin] flex max-w-[calc(100%-1.6vmin)]">{tag(i, `${S.cal}vmin`)}</span>
      </span>
      <span className="block px-[0.5vmin] pb-[0.4vmin] pt-[1vmin]">
        <span className="line-clamp-2 block font-bold leading-[1.15]" style={{ fontSize: `${S.name}vmin`, color: i.soldOut ? C.sub : C.text }}>{i.name}</span>
        <span className="mt-[0.3vmin] flex flex-wrap items-baseline gap-x-[1vmin]">
          {!i.soldOut && <span className="font-bold tabular-nums" style={{ fontSize: `${S.price}vmin` }}>{price(i)}</span>}
          {extra(i, `${S.cal}vmin`)}
        </span>
        {(i.swatches || []).some((w) => w.color) && <span className="mt-[0.6vmin] block">{dots(i, `${S.cal}vmin`)}</span>}
      </span>
    </li>
  ) : (
    <li key={i.id} className="flex min-w-0 items-center gap-[1.4vmin] rounded-[2.2vmin] p-[1vmin]" style={cardBox}>
      <span className="relative block shrink-0 overflow-hidden rounded-[1.6vmin]" style={{ width: `${S.pic * 0.72}vmin`, height: `${S.pic * 0.72}vmin`, background: C.well }}>{picture(i, `${S.pic * 0.3}vmin`)}</span>
      <span className="block min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-[0.8vmin]">{num(i, `${S.name * 1.15}vmin`)}{tag(i, `${S.cal}vmin`)}{pros(i, `${S.cal}vmin`)}</span>
        <span className="mt-[0.6vmin] line-clamp-2 block font-extrabold leading-[1.1] tracking-[-0.02em]" style={{ fontSize: `${S.name * 1.1}vmin`, color: i.soldOut ? C.sub : C.text }}>{i.name}</span>
        <span className="mt-[0.4vmin] flex flex-wrap items-baseline gap-x-[1vmin]">
          {!i.soldOut && <span className="font-bold tabular-nums" style={{ fontSize: `${S.price * 1.05}vmin` }}>{price(i)}</span>}
          {extra(i, `${S.cal}vmin`)}
        </span>
        {(i.swatches || []).some((w) => w.color) && <span className="mt-[0.6vmin] block">{dots(i, `${S.cal}vmin`)}</span>}
      </span>
    </li>
  );
  // A line: a small picture, the name and the price (for a long menu).
  const line = (i: Item) => (
    <li key={i.id} className="mb-[1.1vmin] flex break-inside-avoid items-center gap-[1.1vmin]">
      <span className="relative block shrink-0 overflow-hidden rounded-[1.1vmin]" style={{ width: '5.4vmin', height: '5.4vmin', background: C.well, outline: look === 'light' ? `1px solid ${C.line}` : undefined }}>{picture(i, '2.4vmin')}</span>
      {num(i, '2.6vmin')}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold" style={{ fontSize: '2.1vmin', color: i.soldOut ? C.sub : C.text }}>{i.name}</span>
        <span className="flex items-center gap-[0.8vmin]" style={{ fontSize: '1.7vmin' }}>
          {i.soldOut ? <span style={{ color: C.sub }}>Sold out</span> : <span className="font-bold tabular-nums">{price(i)}</span>}
          {!i.soldOut && i.badge && tag(i, '1.3vmin')}
          {pros(i, '1.3vmin')}
        </span>
      </span>
    </li>
  );
  const cols = wide ? `repeat(auto-fill, minmax(${(S.pic * 1.35).toFixed(1)}vmin, 1fr))` : `repeat(auto-fill, minmax(${S.pic >= 17 ? 44 : 30}vw, 1fr))`;
  // The whole menu on a wide screen, sections apart: placed by how many cards fit across (once that's been read); too
  // few across to sit a name beside its items, each name gets a row of its own, as on a tall screen.
  const placing = pair && !rotate && !lines && fit % 2 === 0;
  const across = colsAt.key === colKey ? colsAt.n : 0;
  const spots = placing && across >= 4 ? place(shown.map((s) => s.items.length), across) : null;
  const ownRow = !wide || (placing && across > 0 && across < 4);

  const featured = h ? (
    <section aria-label="Featured" className={`flex min-h-0 overflow-hidden rounded-[3vmin] ${wide ? 'flex-col p-[1.6vmin]' : 'flex-row-reverse items-stretch p-[1.4vmin]'}`} style={{ ...cardBox, ...(wide ? { width: '29%', flexShrink: 0 } : { height: '27%', flexShrink: 0 }) }}>
      <div className={`relative flex min-h-0 items-center justify-center overflow-hidden rounded-[2.2vmin] ${wide ? 'flex-1' : 'w-[42%] shrink-0'}`} style={{ background: C.well }}>
        {h.imageUrl ? <img key={`${h.id}|${h.imageUrl}`} src={h.imageUrl} alt="" onError={hide} className={`cf-hero-img h-full w-full ${h.kind === 'product' ? 'object-contain p-[6%]' : 'object-cover'}`} />
          : <span aria-hidden className="font-extrabold" style={{ color: C.faint, fontSize: '14vmin' }}>{h.name.trim().charAt(0).toUpperCase()}</span>}
        {h.badge && <span className="absolute left-[1.4vmin] top-[1.4vmin]">{tag(h, '1.9vmin')}</span>}
      </div>
      <div className={`flex min-w-0 flex-col justify-center ${wide ? 'px-[1vmin] pb-[0.6vmin] pt-[2.2vmin]' : 'flex-1 px-[2vmin]'}`}>
        <p className="m-0 flex items-center gap-[1.2vmin]">{num(h, '4.4vmin')}</p>
        <p className="m-0 line-clamp-2 pb-[0.12em] font-extrabold leading-[1.08] tracking-[-0.03em]" style={{ fontSize: wide ? '5.4vmin' : '4.6vmin', marginTop: numbers && h.number ? '1vmin' : 0 }}>{h.name}</p>
        {h.words && <p className="m-0 mt-[1vmin] line-clamp-2 leading-[1.4]" style={{ fontSize: '2.1vmin', color: C.sub }}>{h.words}</p>}
        {(h.swatches || []).some((w) => w.color) && <span className="mt-[1.4vmin] block">{dots(h, '3vmin', 8)}</span>}
        <p className="m-0 mt-[1.8vmin] flex flex-wrap items-center gap-[1.6vmin]">
          <span className="rounded-[1.8vmin] px-[0.55em] py-[0.12em] font-extrabold tabular-nums" style={{ fontSize: '4.2vmin', background: brand, color: brandInk }}>{price(h)}</span>
          {extra(h, '2vmin')}
          {pros(h, '1.9vmin')}
        </p>
        {heroes.length > 1 && <span aria-hidden className="mt-[1.8vmin] flex gap-[0.8vmin]">{heroes.map((x, k) => <span key={x.id} className="h-[0.8vmin] rounded-full transition-all motion-reduce:transition-none" style={{ width: k === hero % heroes.length ? '3.6vmin' : '0.8vmin', background: k === hero % heroes.length ? C.text : C.line }} />)}</span>}
      </div>
    </section>
  ) : null;

  return (
    <main className="relative flex h-dvh flex-col gap-[2vmin] overflow-hidden px-[2.4vw] pb-[2vmin] pt-[2.4vmin]" style={{ background: C.bg, color: C.text, fontFamily: FONT }}>
      <style>{`@keyframes cfHeroIn { from { opacity: 0; transform: scale(1.03); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: no-preference) { .cf-hero-img { animation: cfHeroIn 700ms ease-out; } }`}</style>
      <header className="flex shrink-0 items-center justify-between gap-[2vw]">
        <div className="flex min-w-0 items-center gap-[1.6vmin]">
          <span aria-hidden className="flex shrink-0 items-center justify-center rounded-[1.8vmin] font-extrabold" style={{ width: '6.6vmin', height: '6.6vmin', fontSize: '3.2vmin', background: brand, color: brandInk }}>{board.business.name.trim().charAt(0).toUpperCase()}</span>
          <div className="min-w-0">
            <p className="m-0 truncate font-extrabold leading-[1.1] tracking-[-0.02em]" style={{ fontSize: '3.6vmin' }}>{board.business.name}</p>
            {(single || rotate) && shown[0] && <p className="m-0 truncate font-semibold" style={{ fontSize: '2vmin', color: C.sub }}>{shown[0].name}{pages > 1 ? `, ${(page % pages) + 1} of ${pages}` : ''}</p>}
          </div>
        </div>
        {ahead && qr?.url === ahead && (
          <div className="flex shrink-0 items-center gap-[1.4vmin] rounded-[2.2vmin] py-[0.8vmin] pl-[2vmin] pr-[0.8vmin]" style={cardBox}>
            <div className="text-right"><p className="m-0 font-bold" style={{ fontSize: '2.1vmin' }}>Order ahead</p><p className="m-0" style={{ fontSize: '1.6vmin', color: C.sub }}>Scan with your camera</p></div>
            <img src={qr.img} alt="Code to order ahead on your phone" className="rounded-[1.2vmin] bg-[#fff] p-[0.4vmin]" style={{ width: '7.4vmin', height: '7.4vmin' }} />
          </div>)}
      </header>

      <div className={`flex min-h-0 flex-1 gap-[2vmin] ${wide ? 'flex-row' : 'flex-col'}`}>
        {!single && featured}
        <div ref={body} className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-[2vmin] overflow-hidden">
          {placing && <div ref={probe} aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 grid h-0 gap-[1.4vmin]" style={{ gridTemplateColumns: cols }} />}
          {lines ? (() => {
            const list = shown.flatMap((s) => s.items); const at = single ? (page % pages) * per : 0;
            const these = single ? list.slice(at, at + per) : null;
            return these ? (
              <ul className="m-0 list-none p-0" style={{ columnCount: wide ? 3 : 2, columnGap: '3vmin' }} aria-label={pages > 1 ? `${shown[0].name}, part ${(page % pages) + 1} of ${pages}` : shown[0].name}>{these.map(line)}</ul>
            ) : (
              <div className="m-0" style={{ columnCount: wide ? (shown.length === 1 ? 3 : 2) : 2, columnGap: '3vmin' }}>
                {shown.map((s) => (
                  <section key={s.name} aria-label={s.name} className="mb-[1.6vmin] break-inside-avoid">
                    <h2 className="m-0 mb-[1vmin] flex items-baseline gap-x-[1.2vmin] font-extrabold" style={{ fontSize: '2.4vmin' }}>{s.name}{range(s.items) && <span className="font-semibold" style={{ fontSize: '1.5vmin', color: C.sub }}>{range(s.items)}</span>}</h2>
                    <ul className="m-0 list-none p-0">{s.items.map(line)}</ul>
                  </section>))}
              </div>);
          })() : (
            // One grid for the whole menu, so a short section doesn't leave a row half empty: each section starts with its
            // name in a cell of its own (across the whole row on a tall screen, where the cards are wide).
            <ul className="m-0 grid list-none content-start gap-[1.4vmin] p-0" style={{ gridTemplateColumns: cols }}>
              {shown.flatMap((s, si) => [
                ...(single || rotate ? [] : [
                  <li key={`h:${s.name}`} className={`flex min-w-0 ${ownRow ? 'items-baseline gap-x-[1.6vmin]' : 'flex-col items-start pt-[0.6vmin]'}`} style={spots ? spots[si][0] : ownRow ? { gridColumn: '1 / -1' } : undefined}>
                    <h2 className="m-0 font-extrabold leading-[1.1] tracking-[-0.02em]" style={{ fontSize: `${Math.max(2.4, S.name * 1.25)}vmin` }}>{s.name}</h2>
                    {range(s.items) && <p className="m-0 font-semibold" style={{ fontSize: `${Math.max(1.5, S.cal)}vmin`, color: C.sub, marginTop: ownRow ? 0 : '0.5vmin' }}>{range(s.items)}</p>}
                  </li>]),
                ...s.items.map((i, ii) => card(i, spots ? spots[si][ii + 1] : undefined)),
              ])}
            </ul>)}
        </div>
      </div>
      {(() => {
        // What to know before ordering, each said once: order by number, and that Pros only items need a license on file.
        const notes = [numbers && items.some((i) => i.number) ? 'Order by number or by name' : '', items.some((i) => i.prosOnly) ? 'Pros only items need your license on file' : ''].filter(Boolean);
        return notes.length ? (
          <p className="m-0 flex shrink-0 flex-wrap items-center justify-center gap-x-[2.4vmin] font-semibold" style={{ fontSize: '2vmin', color: C.sub }}>
            {notes.map((n, k) => <span key={n} className="flex items-center gap-[2.4vmin]">{k > 0 && <span aria-hidden className="h-[0.7vmin] w-[0.7vmin] rounded-full" style={{ background: C.faint }} />}{n}</span>)}
          </p>) : null;
      })()}

      <div className="absolute bottom-1 right-2">
        <button ref={pickBtn} type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking} className="min-h-[44px] min-w-[44px] max-w-[40vw] truncate rounded-xl px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2" style={{ color: C.sub, opacity: 0.75 }}>{show || 'All sections'}, {look === 'dark' ? 'dark' : 'light'}</button>
        {picking && (
          <div className="absolute bottom-12 right-0 w-64 space-y-1 rounded-2xl p-2" style={{ background: C.card, border: `1px solid ${C.line}` }} role="group" aria-label="What this screen shows">
            {all.length > 1 && ['', ...all.map((s) => s.name)].map((n) => (
              <button key={n || 'all'} type="button" aria-pressed={show === n} onClick={() => setShow(n)} className="flex min-h-[44px] w-full items-center rounded-xl px-3 text-left text-[15px]" style={show === n ? { background: C.text, color: C.bg } : { color: C.text }}>{n || 'All sections'}</button>
            ))}
            <div className="my-1 border-t" style={{ borderColor: C.line }} />
            {(Object.keys(LOOKS) as Look[]).map((k) => (
              <button key={k} type="button" aria-pressed={look === k} onClick={() => setLook(k)} className="flex min-h-[44px] w-full items-center rounded-xl px-3 text-left text-[15px]" style={look === k ? { background: C.text, color: C.bg } : { color: C.text }}>{LOOKS[k].label}</button>
            ))}
            <div className="my-1 border-t" style={{ borderColor: C.line }} />
            <button type="button" aria-pressed={numbers} onClick={() => setNumbers(!numbers)} className="flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-left text-[15px]" style={{ color: C.text }}>Numbers on the items<span style={{ color: C.sub }}>{numbers ? 'On' : 'Off'}</span></button>
          </div>
        )}
      </div>
    </main>
  );
}
