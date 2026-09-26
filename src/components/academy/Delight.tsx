'use client';
// src/components/academy/Delight.tsx
//
// Small visual touches for students:
//   ProgressRing  a ring showing progress (hours, services, lessons)
//   Celebrate     a short confetti burst — skipped entirely when the device
//                 asks for reduced motion
//   Skeleton      soft placeholder shapes while a page loads

import { useEffect, useState } from 'react';

export function ProgressRing({ value, max, size = 120, stroke = 10, color = '#1c1917', label, sub }: { value: number; max: number; size?: number; stroke?: number; color?: string; label?: string; sub?: string }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${label || ''} ${Math.round(pct * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(120,113,108,.18)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><span className="font-semibold leading-none" style={{ fontSize: size * 0.22 }}>{label ?? `${Math.round(pct * 100)}%`}</span>{sub && <span className="mt-1 text-[11px] text-stone-500">{sub}</span>}</div>
    </div>
  );
}

export function Celebrate({ show, color = '#8b5cf6' }: { show: boolean; color?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!show) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setOn(true); const t = window.setTimeout(() => setOn(false), 1600); return () => window.clearTimeout(t);
  }, [show]);
  if (!on) return null;
  const colors = [color, '#f59e0b', '#10b981', '#ec4899', '#3b82f6'];
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden>
      <style>{`@keyframes cf-fall{0%{transform:translate3d(0,-10vh,0) rotate(0)}100%{transform:translate3d(var(--dx),105vh,0) rotate(720deg)}}`}</style>
      {Array.from({ length: 70 }, (_, i) => <span key={i} style={{ position: 'absolute', left: `${(i * 37) % 100}%`, top: 0, width: 8, height: 12, borderRadius: 2, background: colors[i % colors.length], ['--dx' as any]: `${((i * 53) % 60) - 30}px`, animation: `cf-fall ${1 + ((i * 7) % 6) / 10}s ${(i % 10) / 25}s cubic-bezier(.3,.6,.4,1) forwards` }} />)}
    </div>
  );
}

export function Skeleton() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-4 p-2" aria-label="Loading">
      <div className="h-9 w-2/3 rounded-2xl bg-stone-200/70" />
      <div className="h-4 w-1/2 rounded-full bg-stone-200/60" />
      <div className="h-40 rounded-[1.5rem] bg-stone-200/60" />
      <div className="grid grid-cols-2 gap-3"><div className="h-24 rounded-[1.25rem] bg-stone-200/60" /><div className="h-24 rounded-[1.25rem] bg-stone-200/60" /></div>
      <div className="h-24 rounded-[1.5rem] bg-stone-200/50" />
    </div>
  );
}
