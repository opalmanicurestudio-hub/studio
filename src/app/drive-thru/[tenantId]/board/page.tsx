'use client';
// src/app/drive-thru/[tenantId]/board/page.tsx — THE ORDER BOARD by the speaker: a guest sees their order as it's taken
// (each item, its choices and price, and the total), so a mistake is caught before it's made, then where to go once it's
// sent. Big, high-contrast type for a screen outdoors. It shows nothing about any other car, and if it loses touch with
// the server it goes back to its welcome rather than show an order that may be out of date.
//   Set up like the lane screen, with a key of its own kind (api/kitchen 'pair', kind 'drive-thru-board') that can only
//   show the order at the speaker: a screen guests can reach never holds a key that takes payments. Reads api/counter
//   'board' only. With two ordering lanes that merge (lib/drive-lanes), each board is set to its lane once and shows
//   only the order at that lane's speaker.
//   In English or Español (lib/guest-lang; design board "The boards and the assistant in Spanish", A): set in the corner
//   (or ?lang=es in its address) and kept on the screen. Each item shows the business's Spanish name when it has one; the
//   choices a guest asked for, the prices and the order number read as they are.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';
import { GUEST_LANGS, cleanGuestLang, gt, guestLangKey, inLang, type GuestLang } from '@/lib/guest-lang';

const BG = '#16171a', TEXT = '#ffffff', SUB = '#b9bbc0', RULE = 'rgba(255,255,255,0.14)', GREEN_ON_DARK = '#7fd1a4', TILE = '#24262b';
const POLL_MS = 1500, STALE_MS = 20000;
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#16171a]';
type Board = { business: { name: string }; lanes?: 1 | 2; order: null | { number: string; name?: string | null; sent: boolean; lines: { name: string; nameEs?: string | null; quantity: number; choicesText: string | null; price: number; comp?: boolean; imageUrl?: string | null }[]; subtotal: number; tax: number; total: number; alsoAhead?: string | null } };
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const boardKey = (t: string) => `cf.drivethru.board.${t}`;
// With two ordering lanes that merge (lib/drive-lanes): the lane this board stands at, kept on the screen.
const laneKey = (t: string) => `cf.drivethru.boardLane.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

export default function OrderBoard() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [board, setBoard] = useState<Board | null>(null); const [lastOk, setLastOk] = useState(0); const [stopped, setStopped] = useState('');
  const [, setTick] = useState(0);
  const inFlight = useRef(false);
  const [myLane, setMyLane] = useState<1 | 2 | null>(null); const [picking, setPicking] = useState(false);
  // English or Español on this board, kept on it (lib/guest-lang).
  const [lang, setLangState] = useState<GuestLang>('en'); const [langPick, setLangPick] = useState(false);
  const t = (en: string, vars?: Record<string, string | number>) => gt(lang, en, vars);
  useEffect(() => {
    setKey(read(boardKey(tenantId)));
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const l = Number(q?.get('lane') || read(laneKey(tenantId))); setMyLane(l === 1 || l === 2 ? l : null);
    setLangState(cleanGuestLang(q?.get('lang') || read(guestLangKey('board', tenantId))));
    setReady(true);
  }, [tenantId]);
  const pickLane = (l: 1 | 2) => { setMyLane(l); write(laneKey(tenantId), String(l)); setPicking(false); setBoard(null); setLastOk(0); };
  const pickLang = (v: GuestLang) => { setLangState(v); write(guestLangKey('board', tenantId), v === 'en' ? null : v); setLangPick(false); };
  useEffect(() => { if (!langPick) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setLangPick(false); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [langPick]);
  // (Closed, the language picker hands focus back to its button.)
  const langBtn = useRef<HTMLButtonElement>(null); const wasPicking = useRef(false);
  useEffect(() => { if (wasPicking.current && !langPick) langBtn.current?.focus(); wasPicking.current = langPick; }, [langPick]);
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), 2000); return () => clearInterval(i); }, []);

  const load = useCallback(async () => {
    if (!key || inFlight.current) return; inFlight.current = true;
    try {
      const r = await fetch('/api/counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, action: 'board', lane: myLane }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { write(boardKey(tenantId), null); setKey(null); setStopped('This screen was stopped. A manager can set it up again.'); return; }
      if (d.ok) { setBoard(d); setLastOk(Date.now()); }
    } catch { /* keeps trying */ } finally { inFlight.current = false; }
  }, [tenantId, key, myLane]);
  useEffect(() => { if (!key) return; load(); const i = setInterval(load, POLL_MS); return () => clearInterval(i); }, [key, load]);

  if (!ready) return <main className="min-h-dvh" style={{ background: BG }} />;
  if (!key) return <ScreenSetup board tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(boardKey(tenantId), k); setKey(k); setStopped(''); }} />;

  const fresh = lastOk > 0 && Date.now() - lastOk < STALE_MS;
  const o = fresh ? board?.order || null : null;
  // Up to four lines at full size; a longer order switches to smaller lines and shows the newest five, with the rest
  // counted above them, so nothing is ever cut off at the bottom of the screen.
  const pictures = !!o && o.lines.some((l) => !!l.imageUrl);
  const dense = !!o && o.lines.length > 4;
  const shown = dense ? 5 : 4;
  const name = board?.business.name || '';
  const twoLanes = board?.lanes === 2;
  // Set up once: with two lanes, which one this board stands at (and changed from the corner, like the window screen).
  if (twoLanes && (!myLane || picking)) return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center" style={{ background: BG, color: TEXT }}>
      <div className="w-full max-w-md space-y-5" role="group" aria-labelledby="board-lane">
        <p id="board-lane" className="text-[30px] font-semibold leading-tight">Which lane is this screen at?</p>
        <p className="text-[16px] leading-relaxed" style={{ color: SUB }}>The drive-thru has two ordering lanes. This board shows only the order at its own lane’s speaker.</p>
        <div className="flex gap-3">{([1, 2] as const).map((l) => <button key={l} type="button" aria-pressed={myLane === l} onClick={() => pickLane(l)} className={`min-h-[72px] flex-1 rounded-2xl px-6 text-[20px] font-semibold ${RING}`} style={myLane === l ? { background: TEXT, color: BG } : { background: TILE, color: TEXT }}>Lane {l}</button>)}</div>
      </div>
    </main>
  );
  return (
    <main lang={lang} className="relative flex min-h-dvh flex-col" style={{ background: BG, color: TEXT }}>
      <header className="flex items-center justify-between gap-4 px-[4vw] pb-[2vh] pt-[4vh]" style={{ borderBottom: `1px solid ${RULE}` }}>
        <p className="truncate text-[clamp(22px,3vw,40px)] font-semibold tracking-tight">{name || t('Welcome')}</p>
        {o && <p className="shrink-0 text-[clamp(18px,2.2vw,30px)] font-medium tabular-nums" style={{ color: SUB }}>{t('Order {n}', { n: o.number })}{o.name ? ` · ${o.name}` : ''}</p>}
      </header>

      {!o ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-[2vh] px-[6vw] text-center">
          <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-tight tracking-tight">{t('Welcome')}</p>
          <p className="max-w-[24ch] text-[clamp(22px,3vw,44px)] leading-snug" style={{ color: SUB }}>{t('Your order shows here as we take it.')}</p>
        </section>
      ) : o.sent ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-[3vh] px-[6vw] text-center">
          <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-tight tracking-tight">{o.name ? t('Thank you, {name}', { name: o.name }) : t('Thank you')}</p>
          <p className="text-[clamp(24px,3.4vw,52px)] leading-snug" style={{ color: SUB }}>{t('Please pull forward to the window.')}</p>
          <p className="text-[clamp(30px,4.5vw,72px)] font-semibold tabular-nums">{usd(o.total)}</p>
        </section>
      ) : (
        <>
          <section className="flex-1 overflow-hidden px-[4vw] py-[3vh]">
            {o.lines.length === 0
              ? <p className="pt-[8vh] text-center text-[clamp(26px,3.6vw,56px)]" style={{ color: SUB }}>{o.alsoAhead ? t('We have your order {n}, paid and being made. Anything else?', { n: o.alsoAhead }) : t('Go ahead whenever you’re ready.')}</p>
              : <ul className={dense ? 'space-y-[1.4vh]' : 'space-y-[2.2vh]'}>
                {o.lines.length > shown && <li className="text-[clamp(18px,2.2vw,32px)]" style={{ color: SUB }}>{t(o.lines.length - shown === 1 ? '{n} more item before these' : '{n} more items before these', { n: o.lines.length - shown })}</li>}
                {o.lines.slice(-shown).map((l, i) => (
                  <li key={i} className={`flex justify-between gap-[3vw] ${pictures ? 'items-center' : 'items-baseline'}`}>
                    <div className="flex min-w-0 items-center gap-[2vw]">
                      {pictures && <span className="block shrink-0 overflow-hidden rounded-[14px]" style={{ width: dense ? 'min(5.5vw, 8vh)' : 'min(8vw, 12vh)', height: dense ? 'min(5.5vw, 8vh)' : 'min(8vw, 12vh)', background: TILE }} aria-hidden>{l.imageUrl && <img src={l.imageUrl} alt="" className="h-full w-full object-cover" />}</span>}
                      <div className="min-w-0">
                        <p className={`${dense ? 'text-[clamp(20px,2.6vw,42px)]' : 'text-[clamp(26px,3.6vw,56px)]'} font-semibold leading-tight`}><span className="tabular-nums" style={{ color: GREEN_ON_DARK }}>{l.quantity}</span> {inLang(lang, l.name, l.nameEs)}</p>
                        {l.choicesText && <p className={`${dense ? 'text-[clamp(15px,1.8vw,28px)]' : 'text-[clamp(18px,2.4vw,36px)]'} leading-snug`} style={{ color: SUB }}>{l.choicesText}</p>}
                        {l.comp && <p className={`${dense ? 'text-[clamp(15px,1.8vw,28px)]' : 'text-[clamp(18px,2.4vw,36px)]'} leading-snug`} style={{ color: SUB }}>{t('On the house')}</p>}
                      </div>
                    </div>
                    <p className={`shrink-0 ${dense ? 'text-[clamp(20px,2.4vw,38px)]' : 'text-[clamp(24px,3.2vw,50px)]'} tabular-nums`}>{usd(l.price)}</p>
                  </li>
                ))}
              </ul>}
          </section>
          <footer className="flex items-baseline justify-between gap-4 px-[4vw] pb-[5vh] pt-[2.5vh]" style={{ borderTop: `1px solid ${RULE}` }}>
            <p className="text-[clamp(20px,2.6vw,40px)]" style={{ color: SUB }}>{t(o.tax > 0 ? 'Total with tax' : 'Total')}</p>
            <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-none tabular-nums">{usd(o.total)}</p>
          </footer>
        </>
      )}
      <div className="absolute bottom-3 right-3 flex gap-1">
        <button ref={langBtn} type="button" onClick={() => setLangPick(true)} aria-haspopup="dialog" className={`min-h-[44px] rounded-xl px-3 text-[13px] font-medium ${RING}`} style={{ color: 'rgba(255,255,255,0.55)' }}>{GUEST_LANGS.find((l) => l.id === lang)?.name}</button>
        {twoLanes && myLane && <button type="button" onClick={() => setPicking(true)} className={`min-h-[44px] rounded-xl px-3 text-[13px] font-medium ${RING}`} style={{ color: 'rgba(255,255,255,0.55)' }}>Lane {myLane}</button>}
      </div>
      {langPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setLangPick(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="board-lang" lang="en" className="w-full max-w-sm space-y-2 rounded-3xl bg-[#fff] p-4" style={{ color: '#16171a' }} onClick={(e) => e.stopPropagation()}>
            <p id="board-lang" className="px-2 pb-1 text-[16px] font-semibold">Language on this screen</p>
            {GUEST_LANGS.map((l) => (
              <button key={l.id} type="button" lang={l.id} aria-pressed={lang === l.id} onClick={() => pickLang(l.id)} autoFocus={lang === l.id} className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl px-3 text-left text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]" style={{ background: lang === l.id ? '#f5f5f7' : 'transparent' }}>
                {l.name}
                <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ border: `2px solid ${lang === l.id ? '#16171a' : '#ececee'}` }}>{lang === l.id && <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#16171a' }} />}</span>
              </button>))}
            <button type="button" onClick={() => setLangPick(false)} className="min-h-[44px] w-full rounded-xl text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]" style={{ border: '1px solid #ececee' }}>Done</button>
          </div>
        </div>
      )}
    </main>
  );
}
