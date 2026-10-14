'use client';
// src/components/booking/VisitHero.tsx — THE VISIT LINK'S HERO (design canvas RF26: home + journey + pass).
// A photo card (the service's photo, the business's own photos, or soft dark light when there are none) holding the
// visit's moment in large type and its journey: Booked → Ready → Here → Done. On the day it carries "I'm here" and a
// small pass code; tapping the code shows a full-screen pass the front desk can scan (the same QR the desk scanner
// reads from printed tickets, lib/scan-codes). Calm motion, and still for anyone with Reduce Motion on.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { qrSvg } from '@/lib/scan-codes';

const STEPS = ['Booked', 'Ready', 'Here', 'Done'] as const;

export function VisitHero({ photo, kicker, big, sub, step, done = false, children }: {
  photo?: string | null; kicker: string; big: React.ReactNode; sub?: React.ReactNode;
  /** The step they're on: 0 Booked · 1 Ready · 2 Here · 3 Done. */
  step: number; done?: boolean; children?: React.ReactNode;
}) {
  return (
    <section className="pub-rise relative overflow-hidden rounded-[26px]" style={{ minHeight: 280, boxShadow: '0 26px 50px -30px rgba(22,23,26,.7)' }} aria-label="Your visit">
      <div className="absolute inset-0" style={photo ? { backgroundImage: `url(${photo})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'radial-gradient(90% 70% at 20% 10%, #6b6e76 0%, transparent 60%), linear-gradient(160deg,#3a3d44,#16171a 70%)' }} />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(22,23,26,.05) 15%, rgba(22,23,26,.88) 72%)' }} />
      <div className="relative flex min-h-[280px] flex-col justify-end p-4 text-white">
        <p className="text-[11px] uppercase tracking-[0.18em] opacity-80">{kicker}</p>
        <p className="text-[32px] font-light leading-tight tracking-[-0.02em]">{big}</p>
        {sub && <p className="text-[13px] opacity-85">{sub}</p>}
        <ol className="mt-3 flex gap-1.5" aria-label="Your visit, step by step">
          {STEPS.map((s, i) => { const state = done || i < step ? 'done' : i === step ? 'now' : 'next';
            return <li key={s} className="min-w-0 flex-1" aria-current={state === 'now' ? 'step' : undefined}>
              <span className="block h-[4px] rounded-full" style={{ background: state === 'next' ? 'rgba(255,255,255,.25)' : state === 'now' ? 'rgba(255,255,255,.9)' : '#fff' }} />
              <span className="mt-1 block truncate text-[10.5px]" style={{ opacity: state === 'next' ? 0.55 : 1, fontWeight: state === 'now' ? 700 : 500 }}>{state === 'done' ? `✓ ${s}` : s}</span></li>; })}
        </ol>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </section>
  );
}

/** A small pass code beside "I'm here"; tapped, a full-screen pass for the desk to scan. */
export function PassCode({ token, code, name, when, service, business }: { token: string; code?: string | null; name: string; when: string; service?: string | null; business?: string | null }) {
  const [open, setOpen] = React.useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/check-in/${token}` : `/check-in/${token}`;
  const small = React.useMemo(() => qrSvg(url, 46, '#16171a'), [url]);
  const big = React.useMemo(() => qrSvg(url, 240, '#16171a'), [url]);
  React.useEffect(() => { if (!open) return; const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [open]);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Show my pass to the front desk" className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] bg-white p-1" dangerouslySetInnerHTML={{ __html: small }} />
    {open && typeof document !== 'undefined' && createPortal(<div role="dialog" aria-modal="true" aria-label="Your pass" className="fixed inset-0 z-50 flex items-center justify-center p-5" style={{ background: 'rgba(22,23,26,.86)' }} onClick={() => setOpen(false)}>
      <div className="w-full max-w-[360px] rounded-[28px] bg-white p-6 text-center" style={{ color: '#16171a', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }} onClick={(e) => e.stopPropagation()}>
        {business && <p className="text-[12px] uppercase tracking-[0.28em]">{business}</p>}
        <p className="mt-3 text-[30px] font-light tracking-[-0.02em]">{name}</p>
        <p className="text-[14px]" style={{ color: '#6d7075' }}>{[service, when].filter(Boolean).join(' · ')}</p>
        <div className="mx-auto mt-5 w-fit rounded-[18px] p-3" style={{ border: '1px solid #ececee' }} dangerouslySetInnerHTML={{ __html: big }} />
        {code && <p className="mt-4 text-[13px]" style={{ color: '#6d7075' }}>Or tell the desk your code <b className="text-[18px] tracking-[0.18em]" style={{ color: '#16171a' }}>{String(code).toUpperCase()}</b></p>}
        <button type="button" onClick={() => setOpen(false)} className="mt-5 h-12 w-full rounded-full text-[15px] font-semibold text-white" style={{ background: '#16171a' }}>Done</button>
      </div></div>, document.body)}
  </>;
}

/** The quick actions under the hero: Message, Reschedule, Directions… */
export function VisitActions({ items }: { items: ({ label: string; icon: 'chat' | 'cal' | 'pin' | 'clock' | 'car' | 'heart' | 'bell'; onClick?: () => void; href?: string } | null | false | '' | undefined)[] }) {
  const ICON: Record<string, React.ReactNode> = {
    chat: <path d="M4 5h16v11H8l-4 4z" />, cal: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16" /></>, pin: <><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>, car: <path d="M5 16h14M6 16l1.5-5h9L18 16M7 19v-3M17 19v-3" />, heart: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
    bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20h4" />,
  };
  const list = items.filter(Boolean) as any[]; if (!list.length) return null;
  return <nav className="pub-rise grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(4, list.length)}, minmax(0,1fr))` }} aria-label="Quick actions">
    {list.map((a) => { const inner = <><span className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16171a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON[a.icon]}</svg></span><span className="text-[12.5px] font-semibold">{a.label}</span></>;
      const cls = 'flex flex-col items-center gap-1.5 rounded-[18px] py-2';
      return a.href ? <a key={a.label} href={a.href} target={a.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={cls}>{inner}</a> : <button key={a.label} type="button" onClick={a.onClick} className={cls}>{inner}</button>; })}
  </nav>;
}

/** Morning, afternoon or evening, by the phone's clock. */
export const greeting = (d = new Date()) => { const h = d.getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
