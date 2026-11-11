'use client';
// src/app/drive-thru/[tenantId]/board/page.tsx — THE ORDER BOARD by the speaker: a guest sees their order as it's taken
// (each item, its choices and price, and the total), so a mistake is caught before it's made, then where to go once it's
// sent. Big, high-contrast type for a screen outdoors. It shows nothing about any other car, and if it loses touch with
// the server it goes back to its welcome rather than show an order that may be out of date.
//   Set up like the lane screen, with a key of its own kind (api/kitchen 'pair', kind 'drive-thru-board') that can only
//   show the order at the speaker: a screen guests can reach never holds a key that takes payments. Reads api/counter
//   'board' only.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';

const BG = '#16171a', TEXT = '#ffffff', SUB = '#b9bbc0', RULE = 'rgba(255,255,255,0.14)', GREEN_ON_DARK = '#7fd1a4';
const POLL_MS = 1500, STALE_MS = 20000;
type Board = { business: { name: string }; order: null | { number: string; sent: boolean; lines: { name: string; quantity: number; choicesText: string | null; price: number }[]; subtotal: number; tax: number; total: number } };
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const boardKey = (t: string) => `cf.drivethru.board.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

export default function OrderBoard() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [board, setBoard] = useState<Board | null>(null); const [lastOk, setLastOk] = useState(0); const [stopped, setStopped] = useState('');
  const [, setTick] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => { setKey(read(boardKey(tenantId))); setReady(true); }, [tenantId]);
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), 2000); return () => clearInterval(i); }, []);

  const load = useCallback(async () => {
    if (!key || inFlight.current) return; inFlight.current = true;
    try {
      const r = await fetch('/api/counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, key, action: 'board' }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { write(boardKey(tenantId), null); setKey(null); setStopped('This screen was stopped. A manager can set it up again.'); return; }
      if (d.ok) { setBoard(d); setLastOk(Date.now()); }
    } catch { /* keeps trying */ } finally { inFlight.current = false; }
  }, [tenantId, key]);
  useEffect(() => { if (!key) return; load(); const i = setInterval(load, POLL_MS); return () => clearInterval(i); }, [key, load]);

  if (!ready) return <main className="min-h-dvh" style={{ background: BG }} />;
  if (!key) return <ScreenSetup board tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(boardKey(tenantId), k); setKey(k); setStopped(''); }} />;

  const fresh = lastOk > 0 && Date.now() - lastOk < STALE_MS;
  const o = fresh ? board?.order || null : null;
  const name = board?.business.name || '';
  return (
    <main className="flex min-h-dvh flex-col" style={{ background: BG, color: TEXT }}>
      <header className="flex items-center justify-between gap-4 px-[4vw] pb-[2vh] pt-[4vh]" style={{ borderBottom: `1px solid ${RULE}` }}>
        <p className="truncate text-[clamp(22px,3vw,40px)] font-semibold tracking-tight">{name || 'Welcome'}</p>
        {o && <p className="shrink-0 text-[clamp(18px,2.2vw,30px)] font-medium tabular-nums" style={{ color: SUB }}>Order {o.number}</p>}
      </header>

      {!o ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-[2vh] px-[6vw] text-center">
          <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-tight tracking-tight">Welcome</p>
          <p className="max-w-[24ch] text-[clamp(22px,3vw,44px)] leading-snug" style={{ color: SUB }}>Your order shows here as we take it.</p>
        </section>
      ) : o.sent ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-[3vh] px-[6vw] text-center">
          <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-tight tracking-tight">Thank you</p>
          <p className="text-[clamp(24px,3.4vw,52px)] leading-snug" style={{ color: SUB }}>Please pull forward to the window.</p>
          <p className="text-[clamp(30px,4.5vw,72px)] font-semibold tabular-nums">{usd(o.total)}</p>
        </section>
      ) : (
        <>
          <section className="flex-1 overflow-hidden px-[4vw] py-[3vh]">
            {o.lines.length === 0
              ? <p className="pt-[8vh] text-center text-[clamp(26px,3.6vw,56px)]" style={{ color: SUB }}>Go ahead whenever you’re ready.</p>
              : <ul className="space-y-[2.2vh]">
                {o.lines.length > 8 && <li className="text-[clamp(18px,2.2vw,32px)]" style={{ color: SUB }}>{o.lines.length - 8} more {o.lines.length - 8 === 1 ? 'item' : 'items'} before these</li>}
                {o.lines.slice(-8).map((l, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-[3vw]">
                    <div className="min-w-0">
                      <p className="text-[clamp(26px,3.6vw,56px)] font-semibold leading-tight"><span className="tabular-nums" style={{ color: GREEN_ON_DARK }}>{l.quantity}</span> {l.name}</p>
                      {l.choicesText && <p className="text-[clamp(18px,2.4vw,36px)] leading-snug" style={{ color: SUB }}>{l.choicesText}</p>}
                    </div>
                    <p className="shrink-0 text-[clamp(24px,3.2vw,50px)] tabular-nums">{usd(l.price)}</p>
                  </li>
                ))}
              </ul>}
          </section>
          <footer className="flex items-baseline justify-between gap-4 px-[4vw] pb-[5vh] pt-[2.5vh]" style={{ borderTop: `1px solid ${RULE}` }}>
            <p className="text-[clamp(20px,2.6vw,40px)]" style={{ color: SUB }}>{o.tax > 0 ? 'Total with tax' : 'Total'}</p>
            <p className="text-[clamp(40px,6vw,96px)] font-semibold leading-none tabular-nums">{usd(o.total)}</p>
          </footer>
        </>
      )}
    </main>
  );
}
