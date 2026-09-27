'use client';
// src/components/pos/desk/kit.tsx — THE POS DESIGN KIT.
//
// Every part of the new POS is built from these pieces, so any combination of
// a business's tools (retail, memberships, kiosk, team, voice …) still looks
// deliberate: the same paper, ink, accent, type, radius, spacing and motion.
// The accent is the business's own (booking page colour), falling back to the
// app's primary colour. Motion only follows something the user did, and turns
// off for "reduce motion".

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

export const DESK_CSS = `
.desk{--accent:hsl(var(--primary));--accent-ink:#fff;--paper:#faf8f5;--ink:#1c1917;--muted:#57534e;--line:#e7e2dc;--card:#fff;--soft:#f1ece6;--warn:#a15c07;--ok:#1f7a55;
  background:var(--paper);color:var(--ink);font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.dark .desk{--paper:#171412;--ink:#f3eee8;--muted:#b3aaa1;--line:#342e29;--card:#211d1a;--soft:#2a2521}
.desk :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.desk *{transition:none!important;animation:none!important}}
`;
export const DESK_FONT = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap';

export function DeskFrame({ accent, children }: { accent?: string | null; children: ReactNode }) {
  return (
    <div className="desk flex min-h-0 flex-1 flex-col" style={{ ['--accent' as any]: accent || 'hsl(var(--primary))', ['--accent-ink' as any]: '#fff' }}>
      <style>{DESK_CSS}</style>
      <link rel="stylesheet" href={DESK_FONT} />
      {children}
    </div>
  );
}

export function Btn({ children, onClick, quiet, big, disabled, label, className = '' }: { children: ReactNode; onClick?: () => void; quiet?: boolean; big?: boolean; disabled?: boolean; label?: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition active:scale-[.97] disabled:opacity-40 ${big ? 'h-12 px-6 text-[15px]' : 'h-9 px-3.5 text-[13px]'} ${className}`}
      style={quiet ? { background: 'var(--soft)', color: 'var(--ink)' } : { background: 'var(--accent)', color: 'var(--accent-ink)' }}>{children}</button>
  );
}

/** Segmented switch — views, modes, filters. */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex max-w-full gap-1 overflow-x-auto rounded-full p-1" style={{ background: 'var(--soft)' }}>
      {options.map(([k, l]) => (
        <button key={k} role="tab" type="button" aria-selected={value === k} onClick={() => onChange(k)}
          className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition"
          style={value === k ? { background: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,.12)', fontWeight: 600 } : { color: 'var(--muted)' }}>{l}</button>
      ))}
    </div>
  );
}

export function Pill({ children, tone = 'soft' }: { children: ReactNode; tone?: 'soft' | 'warn' | 'ok' | 'accent' }) {
  const s = tone === 'warn' ? { color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)' }
    : tone === 'ok' ? { color: 'var(--ok)', background: 'color-mix(in srgb, var(--ok) 12%, transparent)' }
    : tone === 'accent' ? { color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }
    : { color: 'var(--muted)', background: 'var(--soft)' };
  return <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={s}>{children}</span>;
}

/** A guest, anywhere in the POS. Calm by design: name + time on top, provider
 *  and service below, a thin progress bar while in service, at most two flags
 *  (+N reveals the rest), one action. Glides to its new place (layoutId). */
export function GuestCard({ id, name, line, time, timeTone, progress, flags = [], badge, action, onOpen, compact, meta }: {
  id: string; name: string; line?: ReactNode; time?: ReactNode; timeTone?: 'warn'; progress?: number | null;
  flags?: { label: string; tone?: 'soft' | 'warn' | 'ok' | 'accent' }[]; badge?: ReactNode; action?: ReactNode; onOpen?: () => void; compact?: boolean; meta?: ReactNode;
}) {
  const [allFlags, setAllFlags] = useState(false);
  const shown = allFlags ? flags : flags.slice(0, 2);
  return (
    <motion.article layout layoutId={`guest-${id}`} transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      className={`relative rounded-2xl ${compact ? 'p-3' : 'p-3.5'}`} style={{ background: 'var(--card)', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" aria-label={`Open ${name}`}>
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold">{name}</span>
            {time && <span className="shrink-0 text-[12px] tabular-nums" style={timeTone === 'warn' ? { color: 'var(--warn)', fontWeight: 600 } : { color: 'var(--muted)' }}>{time}</span>}
          </span>
          {line && <span className="mt-0.5 block truncate text-[13px]" style={{ color: 'var(--muted)' }}>{line}</span>}
        </button>
        {badge}
      </div>
      {typeof progress === 'number' && <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'var(--soft)' }} aria-hidden><div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`, background: progress > 1 ? 'var(--warn)' : 'var(--accent)' }} /></div>}
      {meta && <div className="mt-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>{meta}</div>}
      {(flags.length > 0 || action) && <div className="mt-2 flex items-end justify-between gap-2">
        <span className="flex min-w-0 flex-wrap gap-1">{shown.map((f) => <Pill key={f.label} tone={f.tone}>{f.label}</Pill>)}
          {!allFlags && flags.length > 2 && <button type="button" onClick={() => setAllFlags(true)} className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }} aria-label={`Show ${flags.length - 2} more`}>+{flags.length - 2}</button>}</span>
        {action}
      </div>}
    </motion.article>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>{children}</p>;
}

export function Panel({ title, count, children, className = '' }: { title: string; count?: number; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`rounded-3xl p-2.5 ${className}`} style={{ background: 'color-mix(in srgb, var(--card) 55%, transparent)' }}>
      <h3 className="mb-2 flex items-center justify-between px-1.5 pt-1 text-[14px] font-semibold">{title}{count !== undefined && <span className="font-medium" style={{ color: 'var(--muted)' }}>{count}</span>}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** Side drawer (checkout, selling). Slides in over the desk; the desk stays where it was. */
export function Drawer({ open, onClose, title, children, wide, accent }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; accent?: string | null }) {
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>{open && (
      <div className="desk fixed inset-0 z-[80]" style={{ background: 'transparent', ...(accent ? { ['--accent' as any]: accent } : {}) }}>
        <style>{DESK_CSS}</style>
        <motion.div className="absolute inset-0 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
        <motion.aside role="dialog" aria-label={title} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          className={`absolute inset-y-0 right-0 flex w-full flex-col ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'} sm:rounded-l-[28px]`} style={{ background: 'var(--paper)', boxShadow: '-24px 0 48px -24px rgba(0,0,0,.35)', paddingTop: 'env(safe-area-inset-top,0px)' }}>
          <header className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
            <p className="text-[17px] font-semibold">{title}</p>
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'var(--soft)' }}>✕</button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>{children}</div>
        </motion.aside>
      </div>
    )}</AnimatePresence>,
    document.body,
  );
}

/** "⋯" menu on a card — the less-common actions, one tap away. */
export function Menu({ items, label = 'More actions' }: { items: ({ label: string; onSelect: () => void; tone?: 'danger'; hint?: string } | null | false)[]; label?: string }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const list = items.filter(Boolean) as { label: string; onSelect: () => void; tone?: 'danger'; hint?: string }[];
  if (!list.length) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-9 w-9 items-center justify-center rounded-full text-[18px] leading-none" style={{ background: 'var(--soft)' }}>⋯</button>
      {open && <div role="menu" className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-2xl py-1 shadow-xl" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>
        {list.map((it) => <button key={it.label} role="menuitem" type="button" onClick={() => { setOpen(false); it.onSelect(); }} className="block w-full px-4 py-2.5 text-left text-[14px] hover:opacity-80" style={it.tone === 'danger' ? { color: '#b42318' } : undefined}>
          {it.label}{it.hint && <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{it.hint}</span>}</button>)}
      </div>}
    </div>
  );
}
