'use client';
// src/components/pos/desk/LiveTimer.tsx — A CLOCK THAT COUNTS DOWN ON SCREEN (cleaning a kit, a wash load, resetting a
// station). Give it when the thing started and how long it takes (or when it should be done): it shows "12:34 left",
// then "Time’s up · 3 min over". With no length it simply counts up ("for 8:12"). Ticks every second; no saving involved.
import * as React from 'react';

const mmss = (s: number) => { const a = Math.abs(s); const h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), x = a % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
function chime() { try { const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctx) return; const ctx = new Ctx(); const g = ctx.createGain(); g.gain.value = 0.12; g.connect(ctx.destination);
  [[880, 0], [1175, 0.16], [1568, 0.32]].forEach(([f, t]) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(g); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.14); }); setTimeout(() => ctx.close().catch(() => {}), 900); } catch { /* sound is a nicety */ } }
export function useSeconds() { const [now, setNow] = React.useState(() => Date.now()); React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []); return now; }

export function LiveTimer({ since, minutes, until, doneLabel = 'Time’s up', className = '', short = false }: { since?: string | null; minutes?: number | null; until?: string | null; doneLabel?: string; className?: string; short?: boolean }) {
  const now = useSeconds(); const prev = React.useRef<number | null>(null);
  const start = Date.parse(String(since || '')) || 0;
  const end = until ? Date.parse(until) || 0 : start && Number(minutes) > 0 ? start + Number(minutes) * 60000 : 0;
  if (!end) { if (!start) return null; return <span className={`tabular-nums ${className}`} role="timer">for {mmss(Math.max(0, Math.round((now - start) / 1000)))}</span>; }
  const left = Math.round((end - now) / 1000);
  // A short chime the moment it reaches zero while this screen is open (once).
  if (prev.current !== null && prev.current > 0 && left <= 0) chime();
  prev.current = left;
  if (left > 0) return <span className={`font-semibold tabular-nums ${left <= 60 ? 'text-amber-700' : ''} ${className}`} role="timer" aria-live="off">{mmss(left)} left</span>;
  const over = Math.floor(-left / 60);
  if (short) return <span className={`tabular-nums ${className}`} role="timer">{over >= 1 ? `${over} min over` : doneLabel}</span>;   // on a card: just the number that matters
  return <span className={`font-semibold text-emerald-700 ${className}`} role="timer">{doneLabel}{over >= 1 ? ` · ${over} min over` : ''}</span>;
}
