'use client';
// src/app/drive-thru/[tenantId]/window/page.tsx — THE SCREEN FACING THE GUEST AT THE WINDOW: the car that's there, by
// first name and order number, its items and total, and how paying is going ("Tap, insert or swipe your card on the
// reader", or what the reader said); once paid, thank you, any change, and where to go next (the next window, or that
// the order is being made); a car sent to wait in a spot is told which; a car handed its order is thanked. It shows
// nothing about any other car, and if it loses touch with the server it goes back to its welcome rather than show a
// total that may be out of date.
//   Set up like the order board, with a key that can only show (api/kitchen 'pair', kind 'drive-thru-board'); reads
//   api/counter 'window' only. Which window it's at is kept on the screen: one window for paying and picking up, the pay
//   window, or the pickup window.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';

const BG = '#16171a', TEXT = '#ffffff', SUB = '#b9bbc0', RULE = 'rgba(255,255,255,0.14)', GREEN_ON_DARK = '#7fd1a4', AMBER_ON_DARK = '#f2b46d', TILE = '#24262b';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#16171a]';
const POLL_MS = 1500, STALE_MS = 20000;
type At = 'one' | 'pay' | 'pickup';
const ATS: [At, string, string][] = [['one', 'One window', 'Guests pay and pick up here'], ['pay', 'Pay window', 'Guests pay here, then drive on'], ['pickup', 'Pickup window', 'Guests pick up here']];
type Show = { mode: 'pay' | 'paid' | 'forward' | 'thanks'; number: string; name: string | null; spot: string | null;
  lines: { name: string; quantity: number; choicesText: string | null; price: number; imageUrl: string | null }[];
  subtotal: number; tax: number; total: number; paid: boolean; payMethod: string | null; change: number | null;
  card: 'on_reader' | 'declined' | null; cardMessage: string | null; kitchen: 'making' | 'ready' | null; nextWindow: boolean; payUrl?: string | null };
type View = { business: { name: string }; show: Show | null };
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const keyName = (t: string) => `cf.drivethru.window.${t}`;
const atName = (t: string) => `cf.drivethru.window.at.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

export default function WindowScreen() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [at, setAtState] = useState<At>('one'); const [picking, setPicking] = useState(false);
  const [view, setView] = useState<View | null>(null); const [lastOk, setLastOk] = useState(0); const [stopped, setStopped] = useState('');
  const [, setTick] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    setKey(read(keyName(tenantId)));
    const fromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('at') : null;
    const a = (fromUrl || read(atName(tenantId))) as At | null; if (a && ATS.some(([k]) => k === a)) setAtState(a);
    setReady(true);
  }, [tenantId]);
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), 2000); return () => clearInterval(i); }, []);
  const setAt = (a: At) => { setAtState(a); write(atName(tenantId), a); setPicking(false); setView(null); setLastOk(0); };

  const load = useCallback(async () => {
    if (!key || inFlight.current) return; inFlight.current = true;
    try {
      const r = await fetch('/api/counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, action: 'window', at }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { write(keyName(tenantId), null); setKey(null); setStopped(d.error || 'This screen was stopped. A manager can set it up again.'); return; }
      if (d.ok) { setView(d); setLastOk(Date.now()); }
    } catch { /* keeps trying */ } finally { inFlight.current = false; }
  }, [tenantId, key, at]);
  useEffect(() => { if (!key) return; load(); const i = setInterval(load, POLL_MS); return () => clearInterval(i); }, [key, load]);
  useEffect(() => { if (!picking) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicking(false); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [picking]);
  // Scan to pay: the code for the order on screen, drawn here (only while the team has it up).
  const payUrl = view?.show?.payUrl || null;
  const [qr, setQr] = useState<{ url: string; img: string } | null>(null);
  useEffect(() => {
    if (!payUrl || qr?.url === payUrl) return; let live = true;
    void import('qrcode').then((Q: any) => Q.toDataURL(payUrl, { margin: 1, width: 640, errorCorrectionLevel: 'M', color: { dark: '#16171a', light: '#ffffff' } })).then((img: string) => { if (live) setQr({ url: payUrl, img }); }).catch(() => null);
    return () => { live = false; };
  }, [payUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <main className="min-h-dvh" style={{ background: BG }} />;
  if (!key) return <ScreenSetup window tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); }} />;

  const fresh = lastOk > 0 && Date.now() - lastOk < STALE_MS;
  const s = fresh ? view?.show || null : null;
  const name = view?.business.name || '';
  const hi = (n: string | null) => (n ? `, ${n}` : '');
  return (
    <main className="relative flex min-h-dvh flex-col" style={{ background: BG, color: TEXT }}>
      <header className="flex items-center justify-between gap-4 px-[4vw] pb-[2vh] pt-[4vh]" style={{ borderBottom: `1px solid ${RULE}` }}>
        <p className="truncate text-[clamp(22px,3vw,40px)] font-semibold tracking-tight">{name || 'Welcome'}</p>
        {s && <p className="shrink-0 text-[clamp(18px,2.2vw,30px)] font-medium tabular-nums" style={{ color: SUB }}>Order {s.number}{s.name ? ` · ${s.name}` : ''}</p>}
      </header>

      <div className="flex flex-1 flex-col pb-12" aria-live="polite">
        {!s ? (
          <section className="flex flex-1 flex-col items-center justify-center gap-[2vh] px-[6vw] text-center">
            <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-tight tracking-tight">Welcome</p>
            <p className="max-w-[26ch] text-[clamp(22px,3vw,44px)] leading-snug" style={{ color: SUB }}>{at === 'pickup' ? 'Your order is handed out here.' : 'Your order and total show here at the window.'}</p>
          </section>
        ) : s.mode === 'pay' ? (
          <section className="grid flex-1 grid-rows-[auto_minmax(0,1fr)] gap-[3vh] px-[4vw] py-[3vh] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-rows-none lg:gap-[4vw]">
            <div className="order-2 min-w-0 lg:order-1">
              <OrderLines s={s} />
            </div>
            <div className="order-1 flex flex-col justify-center gap-[2.5vh] self-start rounded-[clamp(20px,3vh,36px)] px-[clamp(20px,3vw,48px)] py-[clamp(20px,4vh,56px)] lg:order-2 lg:self-stretch" style={{ background: TILE }}>
              <div>
                <p className="text-[clamp(18px,2.2vw,32px)]" style={{ color: SUB }}>{s.tax > 0 ? 'Your total with tax' : 'Your total'}</p>
                <p className="text-[clamp(56px,8vw,128px)] font-semibold leading-none tracking-tight tabular-nums">{usd(s.total)}</p>
              </div>
              <div className="h-px w-full" style={{ background: RULE }} />
              {s.card === 'on_reader' ? (
                <div className="flex items-center gap-[2vw]">
                  <span aria-hidden className="relative flex shrink-0 items-center justify-center rounded-full" style={{ width: 'clamp(56px,7vh,96px)', height: 'clamp(56px,7vh,96px)', background: GREEN_ON_DARK }}>
                    <span className="absolute inset-0 rounded-full motion-safe:animate-ping" style={{ background: GREEN_ON_DARK, opacity: 0.25 }} />
                    <CreditCard className="relative h-1/2 w-1/2" color={BG} />
                  </span>
                  <p className="text-[clamp(24px,3.2vw,52px)] font-semibold leading-tight">Tap, insert or swipe your card on the reader</p>
                </div>
              ) : s.card === 'declined' ? (
                <div className="space-y-[1vh]">
                  <p className="text-[clamp(24px,3.2vw,52px)] font-semibold leading-tight" style={{ color: AMBER_ON_DARK }}>{s.cardMessage || 'The card didn’t go through.'}</p>
                  <p className="text-[clamp(18px,2.4vw,36px)] leading-snug" style={{ color: SUB }}>Try another card, or pay another way.</p>
                </div>
              ) : s.payUrl && qr?.url === s.payUrl ? (
                <div className="flex items-center gap-[2.5vw]">
                  <img src={qr.img} alt="Code to pay on your phone" className="shrink-0 rounded-[clamp(12px,2vh,24px)] bg-[#fff] p-[clamp(6px,1vh,12px)]" style={{ width: 'clamp(150px,24vh,300px)', height: 'clamp(150px,24vh,300px)' }} />
                  <div className="min-w-0 space-y-[1vh]">
                    <p className="text-[clamp(24px,3.2vw,52px)] font-semibold leading-tight">Scan to pay on your phone</p>
                    <p className="text-[clamp(16px,2vw,30px)] leading-snug" style={{ color: SUB }}>Point your camera at the code. Card, Apple Pay or Google Pay. Or pay at the window.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-[1vh]">
                  <p className="text-[clamp(24px,3.2vw,52px)] font-semibold leading-tight">Card or cash</p>
                  <p className="text-[clamp(18px,2.4vw,36px)] leading-snug" style={{ color: SUB }}>We’ll take it at the window.</p>
                </div>
              )}
            </div>
          </section>
        ) : s.mode === 'paid' ? (
          <section className="flex flex-1 flex-col items-center justify-center gap-[3vh] px-[6vw] text-center">
            <p className="rounded-full px-[1.2em] py-[0.35em] text-[clamp(18px,2.2vw,32px)] font-semibold" style={{ background: 'rgba(127,209,164,0.16)', color: GREEN_ON_DARK }}>Paid{s.payMethod === 'cash' ? ' in cash' : s.payMethod === 'card' ? ' by card' : ''}</p>
            <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-tight tracking-tight">Thank you{hi(s.name)}</p>
            {s.change !== null && s.change > 0 && (
              <p className="text-[clamp(26px,3.6vw,56px)]" style={{ color: SUB }}>Your change <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{usd(s.change)}</span></p>
            )}
            <p className="max-w-[28ch] text-[clamp(24px,3.4vw,52px)] leading-snug" style={{ color: s.nextWindow ? TEXT : SUB }}>
              {s.nextWindow ? 'Please pull up to the next window.' : s.kitchen === 'ready' ? 'Your order is ready.' : 'Your order is being made.'}
            </p>
          </section>
        ) : s.mode === 'forward' ? (
          <section className="flex flex-1 flex-col items-center justify-center gap-[3vh] px-[6vw] text-center">
            <p className="text-[clamp(34px,5vw,80px)] font-semibold leading-tight tracking-tight">Please pull forward{s.spot ? ' to' : ''}</p>
            {s.spot && (
              <div className="flex flex-col items-center justify-center rounded-[clamp(20px,3vh,40px)]" style={{ minWidth: 'clamp(140px,20vh,260px)', padding: 'clamp(12px,2vh,28px) clamp(24px,4vw,64px)', border: `4px solid ${GREEN_ON_DARK}` }}>
                <span className="text-[clamp(18px,2.2vw,32px)] font-medium" style={{ color: GREEN_ON_DARK }}>Spot</span>
                <span className="text-[clamp(80px,14vh,180px)] font-semibold leading-none tabular-nums">{s.spot}</span>
              </div>
            )}
            <p className="max-w-[28ch] text-[clamp(22px,3vw,44px)] leading-snug" style={{ color: SUB }}>We’ll bring your order right out to you{s.name ? `, ${s.name}` : ''}.</p>
          </section>
        ) : (
          <section className="flex flex-1 flex-col items-center justify-center gap-[3vh] px-[6vw] text-center">
            <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-tight tracking-tight">Thank you{hi(s.name)}</p>
            <p className="text-[clamp(24px,3.4vw,52px)] leading-snug" style={{ color: SUB }}>Enjoy, and see you next time.</p>
          </section>
        )}
      </div>

      <button type="button" onClick={() => setPicking(true)} aria-haspopup="dialog" className={`absolute bottom-3 right-3 min-h-[44px] rounded-xl px-3 text-[13px] font-medium ${RING}`} style={{ color: 'rgba(255,255,255,0.4)' }}>
        {ATS.find(([k]) => k === at)?.[1]}
      </button>
      {picking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setPicking(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="window-at" className="w-full max-w-sm space-y-2 rounded-3xl bg-[#fff] p-4" style={{ color: '#16171a' }} onClick={(e) => e.stopPropagation()}>
            <p id="window-at" className="px-2 pb-1 text-[16px] font-semibold">This screen is at</p>
            {ATS.map(([k, label, hint]) => (
              <button key={k} type="button" aria-pressed={at === k} onClick={() => setAt(k)} autoFocus={at === k} className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]`} style={{ background: at === k ? '#f5f5f7' : 'transparent' }}>
                <span><span className="block text-[15px] font-medium">{label}</span><span className="block text-[13px]" style={{ color: '#6d7075' }}>{hint}</span></span>
                <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ border: `2px solid ${at === k ? '#16171a' : '#ececee'}` }}>{at === k && <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#16171a' }} />}</span>
              </button>))}
            <button type="button" onClick={() => setPicking(false)} className="min-h-[44px] w-full rounded-xl text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]" style={{ border: '1px solid #ececee' }}>Done</button>
          </div>
        </div>
      )}
    </main>
  );
}

/** The order at the window: the newest few lines (any more counted above them), each with its picture when the menu has
 *  one, then what it adds up to. */
function OrderLines({ s }: { s: Show }) {
  const pictures = s.lines.some((l) => !!l.imageUrl);
  const shown = 5;
  return (
    <div className="flex h-full flex-col">
      <p className="pb-[1.5vh] text-[clamp(18px,2.2vw,32px)]" style={{ color: SUB }}>Your order</p>
      <ul className="flex-1 space-y-[1.6vh]">
        {s.lines.length > shown && <li className="text-[clamp(16px,2vw,28px)]" style={{ color: SUB }}>{s.lines.length - shown} more {s.lines.length - shown === 1 ? 'item' : 'items'} before these</li>}
        {s.lines.slice(-shown).map((l, i) => (
          <li key={i} className={`flex justify-between gap-[2vw] ${pictures ? 'items-center' : 'items-baseline'}`}>
            <div className="flex min-w-0 items-center gap-[1.5vw]">
              {pictures && <span className="block shrink-0 overflow-hidden rounded-[12px]" style={{ width: 'min(5.5vw, 8vh)', height: 'min(5.5vw, 8vh)', background: TILE }} aria-hidden>{l.imageUrl && <img src={l.imageUrl} alt="" className="h-full w-full object-cover" />}</span>}
              <div className="min-w-0">
                <p className="truncate text-[clamp(20px,2.6vw,42px)] font-semibold leading-tight"><span className="tabular-nums" style={{ color: GREEN_ON_DARK }}>{l.quantity}</span> {l.name}</p>
                {l.choicesText && <p className="truncate text-[clamp(15px,1.8vw,28px)] leading-snug" style={{ color: SUB }}>{l.choicesText}</p>}
              </div>
            </div>
            <p className="shrink-0 text-[clamp(20px,2.4vw,38px)] tabular-nums">{usd(l.price)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-[2vh] space-y-[0.6vh] pt-[1.5vh] text-[clamp(16px,2vw,30px)]" style={{ borderTop: `1px solid ${RULE}`, color: SUB }}>
        <p className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{usd(s.subtotal)}</span></p>
        {s.tax > 0 && <p className="flex justify-between"><span>Tax</span><span className="tabular-nums">{usd(s.tax)}</span></p>}
      </div>
    </div>
  );
}
