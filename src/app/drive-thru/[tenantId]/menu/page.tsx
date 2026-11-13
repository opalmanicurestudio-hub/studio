'use client';
// src/app/drive-thru/[tenantId]/menu/page.tsx — THE MENU BOARD: the screen guests read before they order (at the
// drive-thru, or inside by the counter). The menu by section with each item's photo and price, sold out shown as it
// happens, and the code to order ahead on their phone when that's on. Big, high-contrast type for a screen outdoors.
// A business with more than one screen can split it: each screen shows all sections, or just one (picked in the corner,
// or with ?show=Burgers in its address). If it loses touch with the server it keeps the last menu it had.
//   Set up like the order board, with a show-only key (api/kitchen 'pair', kind 'drive-thru-board'). Reads api/counter
//   'menuBoard' only.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';

const BG = '#16171a', TEXT = '#ffffff', SUB = '#b9bbc0', RULE = 'rgba(255,255,255,0.14)', TILE = '#24262b', AMBER_ON_DARK = '#f2b46d';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#16171a]';
const POLL_MS = 15000;
type Item = { id: string; name: string; words: string | null; price: number; from: boolean; startPrice: number; imageUrl: string | null; soldOut: boolean };
type Board = { business: { name: string }; sections: { name: string; items: Item[] }[]; orderAhead: string | null };
const ROTATE_MS = 12000;
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const keyName = (t: string) => `cf.drivethru.menuboard.${t}`;
const showName = (t: string) => `cf.drivethru.menuboard.show.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const priceOf = (i: Item) => (i.from ? `from ${usd(i.startPrice)}` : usd(i.price));

function Row({ i, compact }: { i: Item; compact: boolean }) {
  const pic = compact ? 'clamp(44px,6vh,72px)' : 'clamp(56px,8.5vh,112px)';
  return (
    <li className="flex items-center gap-[1.2vw]" style={{ opacity: i.soldOut ? 0.45 : 1 }}>
      {i.imageUrl ? <img src={i.imageUrl} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} className="shrink-0 rounded-[clamp(10px,1.4vh,18px)] object-cover" style={{ width: pic, height: pic, background: TILE }} />
        : <span aria-hidden className="shrink-0 rounded-[clamp(10px,1.4vh,18px)]" style={{ width: pic, height: pic, background: TILE }} />}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block font-semibold leading-tight" style={{ fontSize: compact ? 'clamp(17px,2.4vh,30px)' : 'clamp(19px,2.8vh,38px)' }}>{i.name}</span>
        {i.soldOut ? <span className="mt-[0.4vh] inline-block rounded-full px-[0.8em] py-[0.15em] font-semibold" style={{ fontSize: 'clamp(13px,1.7vh,22px)', background: 'rgba(242,180,109,0.16)', color: AMBER_ON_DARK }}>Sold out</span>
          : !compact && i.words ? <span className="block truncate leading-snug" style={{ fontSize: 'clamp(14px,1.9vh,24px)', color: SUB }}>{i.words}</span> : null}
      </span>
      <span className="shrink-0 text-right font-semibold tabular-nums" style={{ fontSize: compact ? 'clamp(18px,2.6vh,32px)' : 'clamp(20px,3vh,40px)' }}>{priceOf(i)}</span>
    </li>
  );
}

export default function MenuBoard() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [board, setBoard] = useState<Board | null>(null); const [stopped, setStopped] = useState('');
  const [show, setShowState] = useState<string>(''); const [picking, setPicking] = useState(false);
  const [qr, setQr] = useState<{ url: string; img: string } | null>(null);
  const [closed, setClosed] = useState(false);
  // Too much to fit on the screen at once: one section at a time, in turn.
  const [rotate, setRotate] = useState(false); const [page, setPage] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  // A screen on its side (portrait) lays the menu out in one or two columns, not three.
  const [wide, setWide] = useState(true);
  useEffect(() => { const f = () => setWide(window.innerWidth >= window.innerHeight); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  useEffect(() => {
    setKey(read(keyName(tenantId)));
    const fromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('show') : null;
    setShowState(fromUrl ?? read(showName(tenantId)) ?? '');
    setReady(true);
  }, [tenantId]);
  const setShow = (v: string) => { setShowState(v); write(showName(tenantId), v || null); setPicking(false); };
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
  const ahead = board?.orderAhead || null;
  useEffect(() => {
    if (!ahead || qr?.url === ahead) return; let live = true;
    void import('qrcode').then((Q: any) => Q.toDataURL(ahead, { margin: 1, width: 480, color: { dark: '#16171a', light: '#ffffff' } })).then((img: string) => { if (live) setQr({ url: ahead, img }); }).catch(() => null);
    return () => { live = false; };
  }, [ahead]); // eslint-disable-line react-hooks/exhaustive-deps

  // (Measured after each change: more than fits, and showing everything, it takes the sections in turn.)
  useEffect(() => {
    const el = body.current; if (!el || show) { if (rotate) setRotate(false); return; }
    if (!rotate && el.scrollHeight > el.clientHeight + 4) setRotate(true);
  });
  useEffect(() => { if (!rotate) return; const i = setInterval(() => setPage((n) => n + 1), ROTATE_MS); return () => clearInterval(i); }, [rotate]);
  useEffect(() => { setRotate(false); setPage(0); }, [board?.sections.length, show]);

  if (!ready) return <main className="min-h-dvh" style={{ background: BG }} />;
  if (!key) return <ScreenSetup menu tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); }} />;
  if (closed) return <main className="flex h-dvh items-center justify-center px-[6vw] text-center" style={{ background: BG, color: TEXT }}><p className="text-[clamp(26px,4vh,52px)] font-semibold">The menu isn’t available right now.</p></main>;
  if (!board) return <main className="flex min-h-dvh items-center justify-center" style={{ background: BG }}><div className="h-10 w-10 animate-spin rounded-full border-4" style={{ borderColor: RULE, borderTopColor: TEXT }} role="status" aria-label="Loading the menu" /></main>;

  const all = board.sections.filter((s) => s.items.length);
  const sections = show ? all.filter((s) => s.name === show) : rotate && all.length ? [all[page % all.length]] : all;
  const shown = sections.length ? sections : all;
  const count = shown.reduce((n, s) => n + s.items.length, 0);
  // One section on its own: big tiles with photos. Several: columns of rows, smaller when there's a lot.
  // One section with only a few items: big tiles. More than that, or several sections: rows, smaller when there's a lot.
  const single = shown.length === 1;
  const tiles = single && count <= 8;
  const compact = count > 14;
  const cols = tiles ? (count === 1 ? 1 : wide ? Math.min(4, count <= 4 ? count : Math.ceil(count / 2)) : 2)
    : single ? (wide ? Math.min(3, Math.ceil(count / 6)) : count > 8 ? 2 : 1)
    : wide ? Math.min(3, shown.length) : count > 8 ? 2 : 1;
  const showQr = !!(ahead && qr?.url === ahead);
  return (
    <main className="relative flex h-dvh flex-col overflow-hidden" style={{ background: BG, color: TEXT }}>
      <header className="flex items-center justify-between gap-4 px-[3.5vw] pb-[1.5vh] pt-[3vh]" style={{ borderBottom: `1px solid ${RULE}` }}>
        <p className="min-w-0 truncate text-[clamp(24px,3.4vh,48px)] font-semibold tracking-tight">{board.business.name}</p>
        {single && <p className="max-w-[50%] truncate text-[clamp(20px,3vh,40px)] font-semibold" style={{ color: SUB }}>{shown[0].name}</p>}
      </header>

      <div ref={body} className="flex min-h-0 flex-1 gap-[2.5vw] overflow-hidden px-[3.5vw] py-[2.5vh]">
        {tiles ? (
          <ul className="grid min-w-0 flex-1 content-start gap-[1.6vw]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {shown[0].items.map((i) => (
              <li key={i.id} className="flex flex-col overflow-hidden rounded-[clamp(14px,2vh,28px)]" style={{ background: TILE, opacity: i.soldOut ? 0.45 : 1 }}>
                <span className="relative block aspect-[4/3] w-full" style={{ background: '#2c2e33' }}>
                  {i.imageUrl && <img src={i.imageUrl} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} className="h-full w-full object-cover" />}
                  {i.soldOut && <span className="absolute left-[1vh] top-[1vh] rounded-full px-[0.8em] py-[0.2em] font-semibold" style={{ fontSize: 'clamp(14px,2vh,26px)', background: BG, color: AMBER_ON_DARK }}>Sold out</span>}
                </span>
                <span className="block px-[1.2vw] py-[1.4vh]">
                  <span className="line-clamp-2 block text-[clamp(20px,3vh,40px)] font-semibold leading-tight">{i.name}</span>
                  <span className="mt-[0.4vh] block text-[clamp(20px,3vh,40px)] font-semibold tabular-nums" style={{ color: SUB }}>{priceOf(i)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          single ? (
            <ul className="grid min-w-0 flex-1 content-start gap-x-[3vw] gap-y-[1.4vh]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
              {shown[0].items.map((i) => <Row key={i.id} i={i} compact={compact} />)}
            </ul>
          ) : <div className="grid min-w-0 flex-1 content-start gap-x-[3vw] gap-y-[3vh]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {shown.map((s) => (
              <section key={s.name} aria-label={s.name} className="min-w-0">
                <h2 className="mb-[1.5vh] text-[clamp(22px,3.2vh,44px)] font-semibold tracking-tight" style={{ color: SUB }}>{s.name}</h2>
                <ul className="space-y-[1.4vh]">{s.items.map((i) => <Row key={i.id} i={i} compact={compact} />)}</ul>
              </section>
            ))}
          </div>
        )}
        {showQr && (
          <aside className="flex w-[clamp(180px,17vw,320px)] shrink-0 flex-col items-center justify-center gap-[1.5vh] self-stretch rounded-[clamp(16px,2.4vh,32px)] px-[1.4vw] py-[2vh] text-center" style={{ background: TILE }}>
            <img src={qr!.img} alt="Code to order ahead on your phone" className="w-full max-w-[260px] rounded-[clamp(10px,1.4vh,18px)] bg-[#fff] p-[0.8vh]" />
            <p className="text-[clamp(18px,2.6vh,34px)] font-semibold leading-tight">Order ahead on your phone</p>
            <p className="text-[clamp(14px,1.9vh,24px)] leading-snug" style={{ color: SUB }}>Scan, pay, and it’s ready when you get here.</p>
          </aside>
        )}
      </div>

      {all.length > 1 && (
        <div className="absolute bottom-3 right-4">
          <button type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking} className={`min-h-[44px] max-w-[40vw] truncate rounded-xl px-3 text-[13px] ${RING}`} style={{ color: 'rgba(255,255,255,0.6)' }}>{show ? show : 'All sections'}</button>
          {picking && (
            <div className="absolute bottom-12 right-0 w-64 space-y-1 rounded-2xl p-2" style={{ background: TILE, border: `1px solid ${RULE}` }} role="group" aria-label="What this screen shows">
              {['', ...all.map((s) => s.name)].map((n) => (
                <button key={n || 'all'} type="button" aria-pressed={show === n} onClick={() => setShow(n)} className={`flex min-h-[44px] w-full items-center rounded-xl px-3 text-left text-[15px] ${RING}`} style={show === n ? { background: TEXT, color: BG } : { color: TEXT }}>{n || 'All sections'}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
