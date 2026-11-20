'use client';
// src/app/drive-thru/[tenantId]/ready/page.tsx — THE READY BOARD (design canvas "The ready board"; lib/ready-board): a TV
// by the counter that says which orders are being made and which are ready to collect, by number and first name (or
// numbers only, picked on the screen and kept on it). Counter, kiosk and ordered-ahead orders, from the kitchen screen
// itself: ready when every part of it is, off the board once it's handed over. Nothing about items or prices.
//   Set up like the menu board, with a key that can only show (api/kitchen 'pair', kind 'drive-thru-board'); reads
//   api/counter 'readyBoard' only. Out of touch with the server for a while, it says so rather than show an old board.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';

const BG = '#16171a', TEXT = '#ffffff', SUB = '#b9bbc0', RULE = 'rgba(255,255,255,0.14)', GREEN_ON_DARK = '#7fd1a4', TILE = '#24262b';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#16171a]';
const POLL_MS = 3000, STALE_MS = 30000;
type Row = { number: string; name: string | null };
type Board = { business: { name: string }; making: Row[]; more: number; ready: Row[]; moreReady: number };
const keyName = (t: string) => `cf.drivethru.ready.${t}`;
const namesName = (t: string) => `cf.drivethru.ready.names.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

export default function ReadyBoardScreen() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [board, setBoard] = useState<Board | null>(null); const [lastOk, setLastOk] = useState(0); const [stopped, setStopped] = useState(''); const [closed, setClosed] = useState(false);
  const [names, setNamesState] = useState(true); const [picking, setPicking] = useState(false);
  const [, setTick] = useState(0);
  const inFlight = useRef(false);
  // A TV never scrolls: as many as fit (two columns of orders being made on a wide screen), and how many more.
  const [tall, setTall] = useState(false); const [short, setShort] = useState(false);
  useEffect(() => { const f = () => { setTall(window.innerHeight > window.innerWidth); setShort(window.innerHeight < 900); }; f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  useEffect(() => {
    setKey(read(keyName(tenantId)));
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('names') : null;
    const n = q ?? read(namesName(tenantId)); if (n === 'off' || n === '0') setNamesState(false);
    setReady(true);
  }, [tenantId]);
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), 5000); return () => clearInterval(i); }, []);
  const setNames = (v: boolean) => { setNamesState(v); write(namesName(tenantId), v ? 'on' : 'off'); setPicking(false); };

  const load = useCallback(async () => {
    if (!key || inFlight.current) return; inFlight.current = true;
    try {
      const r = await fetch('/api/counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, action: 'readyBoard' }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { write(keyName(tenantId), null); setKey(null); setStopped(d.error || 'This screen was stopped. A manager can set it up again.'); return; }
      if (d.closed) { setClosed(true); return; }
      if (d.ok) { setBoard(d); setLastOk(Date.now()); setClosed(false); }
    } catch { /* keeps trying */ } finally { inFlight.current = false; }
  }, [tenantId, key]);
  useEffect(() => { if (!key) return; load(); const i = setInterval(load, POLL_MS); return () => clearInterval(i); }, [key, load]);
  useEffect(() => { if (!picking) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicking(false); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [picking]);

  if (!ready) return <main className="min-h-dvh" style={{ background: BG }} />;
  if (!key) return <ScreenSetup ready tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); }} />;
  const stale = lastOk > 0 && Date.now() - lastOk > STALE_MS;
  const b = stale ? null : board;
  const who = (r: Row) => (names && r.name ? r.name : null);
  // (Ready in two columns of smaller tiles on a wide screen once there are more than fit in one.)
  const readyCols = !tall && !!b && b.ready.length > (short ? 4 : 5);
  const fitMaking = tall ? 10 : short ? 10 : 12, fitReady = tall ? 8 : readyCols ? (short ? 8 : 10) : short ? 4 : 5;
  const making = b ? b.making.slice(0, fitMaking) : []; const moreMaking = b ? b.more + Math.max(0, b.making.length - fitMaking) : 0;
  const readyNow = b ? b.ready.slice(0, fitReady) : []; const moreReady = b ? b.moreReady + Math.max(0, b.ready.length - fitReady) : 0;
  const twoCols = !tall && making.length > 6;

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden" style={{ background: BG, color: TEXT }}>
      <header className="flex items-baseline justify-between gap-4 px-[4vw] pb-[2vh] pt-[4vh]" style={{ borderBottom: `1px solid ${RULE}` }}>
        <p className="truncate text-[clamp(22px,3vw,44px)] font-semibold tracking-tight">{board?.business.name || 'Your order'}</p>
        <p className="shrink-0 text-[clamp(16px,2vw,30px)]" style={{ color: SUB }}>Your order</p>
      </header>
      {closed ? (
        <section className="flex flex-1 items-center justify-center px-[6vw] text-center"><p className="text-[clamp(26px,3.4vw,52px)] font-semibold">We’re not taking orders right now.</p></section>
      ) : !b ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-[2vh] px-[6vw] text-center" aria-live="polite">
          <p className="text-[clamp(26px,3.4vw,52px)] font-semibold">{stale ? 'Reconnecting…' : 'One moment…'}</p>
          {stale && <p className="text-[clamp(16px,2vw,30px)]" style={{ color: SUB }}>Ask at the counter about your order.</p>}
        </section>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-[4vh] px-[4vw] py-[3vh] md:grid-cols-[1fr_1.4fr] md:gap-[4vw]">
          <section aria-labelledby="being-made" className="min-w-0">
            <h2 id="being-made" className="text-[clamp(20px,2.4vw,40px)] font-semibold" style={{ color: SUB }}>Being made</h2>
            {b.making.length === 0 ? <p className="mt-[2vh] text-[clamp(18px,2vw,32px)]" style={{ color: SUB }}>Nothing waiting.</p> : (
              <>
              <ul className={`mt-[1.5vh] ${twoCols ? 'grid grid-cols-2 gap-x-[2vw]' : ''}`}>
                {making.map((r) => (
                  <li key={r.number} className={`flex min-w-0 items-baseline gap-[1.5vw] py-[1.2vh] ${twoCols ? 'text-[clamp(18px,2vw,34px)]' : 'text-[clamp(20px,2.4vw,40px)]'}`} style={{ borderTop: `1px solid ${RULE}` }}>
                    <span className="min-w-[4.5ch] font-semibold tabular-nums">{r.number}</span>{who(r) && <span className="truncate">{who(r)}</span>}
                  </li>))}
              </ul>
              {moreMaking > 0 && <p className="py-[1.2vh] text-[clamp(16px,2vw,30px)]" style={{ borderTop: `1px solid ${RULE}`, color: SUB }}>and {moreMaking} more</p>}
              </>)}
          </section>
          <section aria-labelledby="ready-now" className="min-w-0">
            <h2 id="ready-now" className="text-[clamp(20px,2.4vw,40px)] font-semibold" style={{ color: GREEN_ON_DARK }}>Ready</h2>
            {b.ready.length === 0 ? <p className="mt-[2vh] text-[clamp(18px,2vw,32px)]" style={{ color: SUB }}>Ready orders show here.</p> : (
              <>
              <ul className={`mt-[1.5vh] ${readyCols ? 'grid grid-cols-2 gap-[1.4vh_1.4vw]' : 'space-y-[1.4vh]'}`} aria-live="polite">
                {readyNow.map((r) => (
                  <li key={r.number} className="flex min-w-0 items-baseline justify-between gap-[2vw] rounded-[clamp(14px,2vh,28px)] px-[2vw] py-[1.6vh]" style={{ background: TILE }}>
                    <span className={`${readyCols ? 'text-[clamp(28px,3.6vw,60px)]' : 'text-[clamp(34px,5vw,84px)]'} font-semibold leading-none tabular-nums`} style={{ color: GREEN_ON_DARK }}>{r.number}</span>
                    {who(r) && <span className={`truncate ${readyCols ? 'text-[clamp(18px,2vw,34px)]' : 'text-[clamp(22px,2.8vw,48px)]'} font-semibold`}>{who(r)}</span>}
                  </li>))}
              </ul>
              {moreReady > 0 && <p className="mt-[1.4vh] text-[clamp(16px,2vw,30px)]" style={{ color: SUB }}>and {moreReady} more ready</p>}
              </>)}
          </section>
        </div>
      )}
      <footer className="px-[4vw] pb-[3vh] text-[clamp(15px,1.8vw,28px)]" style={{ color: SUB }}>Collect ready orders at the counter.</footer>

      <button type="button" onClick={() => setPicking(true)} aria-haspopup="dialog" className={`absolute bottom-3 right-3 min-h-[44px] rounded-xl px-3 text-[13px] font-medium ${RING}`} style={{ color: 'rgba(255,255,255,0.6)' }}>
        {names ? 'Names shown' : 'Numbers only'}
      </button>
      {picking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setPicking(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="ready-names" className="w-full max-w-sm space-y-2 rounded-3xl bg-[#fff] p-4" style={{ color: '#16171a' }} onClick={(e) => e.stopPropagation()}>
            <p id="ready-names" className="px-2 pb-1 text-[16px] font-semibold">On this board</p>
            {([[true, 'Numbers and first names', 'The name given with the order'], [false, 'Numbers only', 'For a board guests passing by can see']] as [boolean, string, string][]).map(([v, label, hint]) => (
              <button key={label} type="button" aria-pressed={names === v} onClick={() => setNames(v)} autoFocus={names === v} className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]" style={{ background: names === v ? '#f5f5f7' : 'transparent' }}>
                <span><span className="block text-[15px] font-medium">{label}</span><span className="block text-[13px]" style={{ color: '#6d7075' }}>{hint}</span></span>
                <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ border: `2px solid ${names === v ? '#16171a' : '#ececee'}` }}>{names === v && <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#16171a' }} />}</span>
              </button>))}
            <button type="button" onClick={() => setPicking(false)} className="min-h-[44px] w-full rounded-xl text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]" style={{ border: '1px solid #ececee' }}>Done</button>
          </div>
        </div>
      )}
    </main>
  );
}
