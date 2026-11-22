'use client';
// src/app/drive-thru/[tenantId]/guest/page.tsx — THE SCREEN FACING THE GUEST AT THE COUNTER (design board "Register
// tools", part 4): the order the counter is on, as it's rung; its total; the tip, when the business takes them (its three
// or none, picked here, once); then thank you, any change, and a code for their receipt. Nothing about any other order;
// if it loses touch with the server it goes back to its welcome rather than show a total that may be out of date.
//   Set up like the window screen, with a key that can only show (api/kitchen 'pair', kind 'drive-thru-board'); reads
//   api/counter 'guest', and its one write is the tip the guest picks ('guestTip', only one of the tips it shows).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';

const BG = '#16171a', TEXT = '#ffffff', SUB = '#b9bbc0', RULE = 'rgba(255,255,255,0.14)', GREEN_ON_DARK = '#7fd1a4', TILE = '#24262b';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#16171a]';
const POLL_MS = 1500, STALE_MS = 20000;
type Show = { mode: 'ringing' | 'pay' | 'thanks'; number: string; name: string | null; orderId: string;
  lines: { name: string; quantity: number; choicesText: string | null; price: number; comp?: boolean }[];
  reward: { name: string; off: number } | null; markdown: { name: string; off: number } | null; tax: number; tip: number; total: number;
  tips: { pct: number; cents: number }[] | null; card: 'on_reader' | null; change: number | null; earned: { points: number; unit: string } | null; receiptUrl: string | null };
type View = { business: { name: string }; show: Show | null };
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const keyName = (t: string) => `cf.counter.guest.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

export default function GuestScreen() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [view, setView] = useState<View | null>(null); const [lastOk, setLastOk] = useState(0); const [stopped, setStopped] = useState('');
  const [picking, setPicking] = useState<number | null>(null); const [, setTick] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => { setKey(read(keyName(tenantId))); setReady(true); }, [tenantId]);
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), 2000); return () => clearInterval(i); }, []);
  const post = useCallback(async (body: any) => {
    const r = await fetch('/api/counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, ...body }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { write(keyName(tenantId), null); setKey(null); setStopped(d.error || 'This screen was stopped. A manager can set it up again.'); }
    return d;
  }, [tenantId, key]);
  const load = useCallback(async () => {
    if (!key || inFlight.current) return; inFlight.current = true;
    try { const d = await post({ action: 'guest' }); if (d.ok) { setView(d); setLastOk(Date.now()); } } catch { /* keeps trying */ } finally { inFlight.current = false; }
  }, [key, post]);
  useEffect(() => { if (!key) return; void load(); const i = setInterval(load, POLL_MS); return () => clearInterval(i); }, [key, load]);
  const receiptUrl = view?.show?.receiptUrl || null;
  const [qr, setQr] = useState<{ url: string; img: string } | null>(null);
  useEffect(() => {
    if (!receiptUrl || qr?.url === receiptUrl) return; let live = true;
    void import('qrcode').then((Q: any) => Q.toDataURL(receiptUrl, { margin: 1, width: 560, errorCorrectionLevel: 'M', color: { dark: '#16171a', light: '#ffffff' } })).then((img: string) => { if (live) setQr({ url: receiptUrl, img }); }).catch(() => null);
    return () => { live = false; };
  }, [receiptUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const tip = async (s: Show, cents: number) => { setPicking(cents); try { await post({ action: 'guestTip', orderId: s.orderId, cents }); await load(); } catch { /* the counter can add it */ } finally { setPicking(null); } };

  if (!ready) return <main className="min-h-dvh" style={{ background: BG }} />;
  if (!key) return <ScreenSetup guest tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); }} />;

  const fresh = lastOk > 0 && Date.now() - lastOk < STALE_MS;
  const s = fresh ? view?.show || null : null;
  const big = 'text-[clamp(56px,8vw,128px)] font-semibold leading-none tracking-tight tabular-nums';
  return (
    <main className="relative flex min-h-dvh flex-col" style={{ background: BG, color: TEXT, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="flex items-center justify-between gap-4 px-[4vw] pb-[2vh] pt-[4vh]" style={{ borderBottom: `1px solid ${RULE}` }}>
        <p className="truncate text-[clamp(22px,3vw,40px)] font-semibold tracking-tight">{view?.business.name || 'Welcome'}</p>
        {s && <p className="shrink-0 text-[clamp(18px,2.2vw,30px)] font-medium tabular-nums" style={{ color: SUB }}>{s.number}{s.name ? `, ${s.name}` : ''}</p>}
      </header>
      <div className="flex flex-1 flex-col pb-12" aria-live="polite">
        {!s ? (
          <section className="flex flex-1 flex-col items-center justify-center gap-[2vh] px-[6vw] text-center">
            <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-tight tracking-tight">Welcome</p>
            <p className="max-w-[26ch] text-[clamp(22px,3vw,44px)] leading-snug" style={{ color: SUB }}>Your order shows here as it’s rung up.</p>
          </section>
        ) : s.mode === 'thanks' ? (
          <section className="flex flex-1 flex-col items-center justify-center gap-[3vh] px-[6vw] text-center">
            <p className="text-[clamp(44px,7vw,112px)] font-semibold leading-tight tracking-tight">Thank you{s.name ? `, ${s.name}` : ''}</p>
            {s.change !== null && <p className="text-[clamp(24px,3.4vw,52px)] font-semibold tabular-nums" style={{ color: GREEN_ON_DARK }}>Your change: {usd(s.change)}</p>}
            {s.earned && <p className="text-[clamp(20px,2.6vw,40px)]" style={{ color: SUB }}>You earned {s.earned.points} {s.earned.unit}.</p>}
            {s.receiptUrl && qr?.url === s.receiptUrl && <div className="flex flex-col items-center gap-[1.5vh]">
              <img src={qr.img} alt="Code for your receipt" className="rounded-2xl bg-[#fff] p-2" style={{ width: 'clamp(160px,22vh,280px)', height: 'clamp(160px,22vh,280px)' }} />
              <p className="text-[clamp(18px,2.2vw,32px)]" style={{ color: SUB }}>Scan for your receipt</p></div>}
          </section>
        ) : (
          <section className="grid flex-1 grid-rows-[auto_minmax(0,1fr)] gap-[3vh] px-[4vw] py-[3vh] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-rows-none lg:gap-[4vw]">
            <div className="order-2 min-w-0 lg:order-1">
              <ul className="space-y-[1.6vh]">{s.lines.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 text-[clamp(20px,2.4vw,36px)]">
                  <span className="min-w-0"><span className="font-semibold">{l.quantity > 1 ? `${l.quantity} × ` : ''}{l.name}</span>{l.choicesText && <span className="block text-[0.72em]" style={{ color: SUB }}>{l.choicesText}</span>}{l.comp && <span className="block text-[0.72em]" style={{ color: SUB }}>On the house</span>}</span>
                  <span className="shrink-0 tabular-nums">{usd(l.price)}</span></li>))}</ul>
              {(s.reward || s.markdown || s.tax > 0 || s.tip > 0) && <div className="mt-[2.4vh] space-y-[1vh] border-t pt-[2vh] text-[clamp(18px,2vw,30px)]" style={{ borderColor: RULE, color: SUB }}>
                {s.reward && <div className="flex justify-between gap-4" style={{ color: GREEN_ON_DARK }}><span>{s.reward.name}</span><span className="tabular-nums">-{usd(s.reward.off)}</span></div>}
                {s.markdown && <div className="flex justify-between gap-4" style={{ color: GREEN_ON_DARK }}><span>{s.markdown.name}</span><span className="tabular-nums">-{usd(s.markdown.off)}</span></div>}
                {s.tax > 0 && <div className="flex justify-between gap-4"><span>Tax</span><span className="tabular-nums">{usd(s.tax)}</span></div>}
                {s.tip > 0 && <div className="flex justify-between gap-4"><span>Tip</span><span className="tabular-nums">{usd(s.tip)}</span></div>}
              </div>}
            </div>
            <div className="order-1 flex flex-col justify-center gap-[2.5vh] self-start rounded-[clamp(20px,3vh,36px)] px-[clamp(20px,3vw,48px)] py-[clamp(20px,4vh,56px)] lg:order-2 lg:self-stretch" style={{ background: TILE }}>
              <div><p className="text-[clamp(18px,2.2vw,32px)]" style={{ color: SUB }}>{s.mode === 'ringing' ? 'So far' : 'Your total'}</p><p className={big}>{usd(s.total)}</p></div>
              {s.tips && s.tips.length ? <>
                <div className="h-px w-full" style={{ background: RULE }} />
                <p className="text-[clamp(24px,3vw,48px)] font-semibold">Add a tip?</p>
                <div className="grid grid-cols-3 gap-[1.2vw]">{s.tips.map((t) => (
                  <button key={t.pct} type="button" disabled={picking !== null} onClick={() => void tip(s, t.cents)} className={`flex min-h-[clamp(72px,11vh,140px)] flex-col items-center justify-center rounded-[clamp(14px,2vh,24px)] font-semibold disabled:opacity-50 ${RING}`} style={{ background: TEXT, color: BG }}>
                    <span className="text-[clamp(24px,3.2vw,52px)]">{t.pct}%</span><span className="text-[clamp(16px,1.8vw,28px)] font-medium" style={{ color: '#4b4d52' }}>{usd(t.cents / 100)}</span></button>))}</div>
                <button type="button" disabled={picking !== null} onClick={() => void tip(s, 0)} className={`min-h-[clamp(56px,8vh,96px)] rounded-[clamp(14px,2vh,24px)] text-[clamp(20px,2.4vw,36px)] font-semibold disabled:opacity-50 ${RING}`} style={{ border: `2px solid ${RULE}`, color: TEXT }}>No tip</button>
              </> : s.card === 'on_reader' ? <>
                <div className="h-px w-full" style={{ background: RULE }} />
                <div className="flex items-center gap-[2vw]">
                  <span aria-hidden className="relative flex shrink-0 items-center justify-center rounded-full" style={{ width: 'clamp(56px,7vh,96px)', height: 'clamp(56px,7vh,96px)', background: GREEN_ON_DARK }}>
                    <span className="absolute inset-0 rounded-full motion-safe:animate-ping" style={{ background: GREEN_ON_DARK, opacity: 0.25 }} /><CreditCard className="relative h-1/2 w-1/2" color={BG} /></span>
                  <p className="text-[clamp(24px,3.2vw,52px)] font-semibold leading-tight">Tap, insert or swipe your card on the reader</p></div>
              </> : s.mode === 'pay' ? <p className="text-[clamp(20px,2.6vw,40px)] leading-snug" style={{ color: SUB }}>Pay at the counter.</p> : null}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
