'use client';
// src/components/pos/desk/hk-ui.tsx — the shared look of the housekeeping boards: a badge that says what kind of job a
// card is (colour AND icon AND word, so it never relies on colour alone), initials for who has it, and a progress ring.
import * as React from 'react';
import type { OpsTask } from '@/lib/attendant';

type Kind = 'station' | 'kit' | 'linen' | 'request';
const LOOK: Record<Kind, { label: string; bg: string; fg: string; path: React.ReactNode }> = {
  station: { label: 'Station', bg: '#DCEBFB', fg: '#164A86', path: <><path d="M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5" /><path d="M3 11h18v5H3z" /><path d="M6 16v4" /><path d="M18 16v4" /></> },
  kit: { label: 'Kit', bg: '#FDECC8', fg: '#7A4A00', path: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></> },
  linen: { label: 'Linen', bg: '#D5F0EC', fg: '#0B5A53', path: <><rect x="4" y="3" width="16" height="18" rx="3" /><circle cx="12" cy="13" r="4" /><path d="M8 7h.01" /></> },
  request: { label: 'Request', bg: '#F3E8FF', fg: '#6B21A8', path: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></> },
};
export const kindOf = (t: OpsTask): Kind => (t.kind === 'request' ? 'request' : t.kind === 'station' || t.kind === 'inspect' ? 'station' : t.goTo === 'linens' || t.kind === 'wash_start' || t.kind === 'wash_done' ? 'linen' : 'kit');
export function TypeBadge({ task, big = false }: { task: OpsTask; big?: boolean }) { const k = LOOK[kindOf(task)];
  return (<span className={`inline-flex items-center gap-1.5 rounded-full font-bold ${big ? 'px-3 py-1.5 text-[14px]' : 'px-2.5 py-1 text-[12px]'}`} style={{ background: k.bg, color: k.fg }}>
    <svg aria-hidden width={big ? 15 : 13} height={big ? 15 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{k.path}</svg>{k.label}</span>); }
export function Initials({ name, dark = false, size = 30 }: { name?: string | null; dark?: boolean; size?: number }) { const parts = String(name || '?').trim().split(/\s+/); const txt = ((parts[0]?.[0] || '?') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase();
  return <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-[800]" style={{ width: size, height: size, fontSize: size * 0.4, background: dark ? '#3A3B3F' : '#D9C3A5', color: dark ? '#fff' : '#17181A' }}>{txt}</span>; }
/** A ring that fills from 0 to 1 (a steriliser cycle, a timer). `children` sit in the middle. */
export function Ring({ value, size = 132, color = 'var(--accent, #7A5C3A)', done = false, children }: { value: number; size?: number; color?: string; done?: boolean; children?: React.ReactNode }) {
  const r = size / 2 - 10; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(1, value));
  return (<span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0"><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={done ? '#1F6B3A' : '#EFEBE6'} strokeWidth="12" />
      {!done && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray 1s linear' }} />}</svg>
    <span className="relative flex flex-col items-center text-center">{children}</span></span>); }
