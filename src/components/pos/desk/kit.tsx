'use client';
// src/components/pos/desk/kit.tsx — THE POS DESIGN KIT.
//
// Every part of the new POS is built from these pieces, so any combination of
// a business's tools (retail, memberships, kiosk, team, voice …) still looks
// deliberate: the same paper, ink, accent, type, radius, spacing and motion.
// White by default, true black when switched; the accent is the business's own
// (booking page colour) when set. Motion is quiet (rings fill, live dots ping,
// rows rise into place) and turns off for "reduce motion".

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

export const DESK_CSS = `
.desk{--accent:#16171a;--accent-ink:#fff;--paper:#fff;--panel:#fff;--ink:#16171a;--muted:#6d7075;--line:#ececee;--card:#fff;--soft:#f5f5f7;--warn:#a15c07;--ok:#1f7a4d;--danger:#b42318;--shade:0 1px 2px rgba(16,17,20,.04),0 8px 24px -16px rgba(16,17,20,.18);
  background:var(--paper);color:var(--ink);font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;color-scheme:light}
[data-desk-theme=dark].desk,[data-desk-theme=dark] .desk{--accent:#7fd1a5;--accent-ink:#000;--paper:#000;--panel:#0c0c0e;--ink:#f5f5f7;--muted:#9a9ca3;--line:#222226;--card:#0c0c0e;--soft:#18181b;--warn:#f0b35a;--ok:#7fd1a5;--danger:#ff8a80;--shade:0 0 0 1px #1c1c20;color-scheme:dark}
.desk :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@keyframes desk-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes desk-ping{0%{transform:scale(1);opacity:.5}80%,100%{transform:scale(2.6);opacity:0}}
@keyframes desk-breathe{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes desk-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes desk-drift{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.desk .d-rise{animation:desk-rise .42s cubic-bezier(.2,.7,.2,1) both}
.desk .d-breathe{animation:desk-breathe 2.4s ease-in-out infinite}
.desk .d-drift{animation:desk-drift 3.2s ease-in-out infinite}
.desk .d-ping{position:relative}
.desk .d-ping::after{content:'';position:absolute;inset:0;border-radius:999px;background:currentColor;animation:desk-ping 2s cubic-bezier(0,0,.2,1) infinite}
.desk .d-shimmer{background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--ok) 14%,transparent) 50%,transparent 100%);background-size:200% 100%;animation:desk-shimmer 2.8s linear infinite}
.desk .d-ring circle{transition:stroke-dashoffset 1s cubic-bezier(.2,.7,.2,1),stroke .3s}
.desk .d-row{transition:background .18s,border-color .18s,transform .18s}
.desk .d-row:hover{background:var(--soft)}
.desk .d-row:active{transform:scale(.995)}
.desk input::placeholder{color:var(--muted)}
@media (prefers-reduced-motion:reduce){.desk *,.desk *::after{transition:none!important;animation:none!important}}
`;
export const DESK_FONT = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap';

export type DeskThemePref = 'light' | 'dark' | 'system';
const THEME_KEY = 'cf.desk.theme';
/** White by default; true black when switched (or when following a dark device). Remembered per device. */
export function useDeskTheme() {
  const [pref, setPref] = useState<DeskThemePref>('light');
  const [sysDark, setSysDark] = useState(false);
  useEffect(() => {
    try { const v = localStorage.getItem(THEME_KEY); if (v === 'light' || v === 'dark' || v === 'system') setPref(v); } catch { /* per-device memory is a nicety */ }
    const on = (ev: any) => { const v = ev?.detail; if (v === 'light' || v === 'dark' || v === 'system') setPref(v); };
    window.addEventListener('cf:desk-theme', on);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const sync = () => setSysDark(!!mq?.matches); sync(); mq?.addEventListener?.('change', sync);
    return () => { window.removeEventListener('cf:desk-theme', on); mq?.removeEventListener?.('change', sync); };
  }, []);
  const set = (p: DeskThemePref) => { setPref(p); try { localStorage.setItem(THEME_KEY, p); } catch { /* ignore */ } window.dispatchEvent(new CustomEvent('cf:desk-theme', { detail: p })); };
  const resolved: 'light' | 'dark' = pref === 'system' ? (sysDark ? 'dark' : 'light') : pref;
  return { pref, resolved, set };
}

export function DeskFrame({ accent, children }: { accent?: string | null; children: ReactNode }) {
  const { resolved } = useDeskTheme();
  return (
    <div className="desk flex min-h-0 flex-1 flex-col" data-desk-theme={resolved} style={accent ? { ['--accent' as any]: accent, ['--accent-ink' as any]: '#fff' } : undefined}>
      <style>{DESK_CSS}</style>
      <link rel="stylesheet" href={DESK_FONT} />
      {children}
    </div>
  );
}

/** Light / dark switch: a sun and a moon on a sliding track. */
export function ThemeSwitch() {
  const { resolved, set } = useDeskTheme();
  const dark = resolved === 'dark';
  return (
    <button type="button" role="switch" aria-checked={dark} aria-label={dark ? 'Switch to the white desk' : 'Switch to the black desk'} onClick={() => set(dark ? 'light' : 'dark')}
      className="relative inline-flex h-9 w-[68px] shrink-0 items-center rounded-full px-1" style={{ background: 'var(--soft)', border: '1px solid var(--line)' }}>
      <span aria-hidden className="absolute top-1 h-7 w-7 rounded-full transition-all duration-300" style={{ left: dark ? 35 : 4, background: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,.18)' }} />
      <span className="relative z-10 flex w-full justify-between px-[5px]" style={{ color: 'var(--muted)' }}>
        <Icon name="sun" size={16} style={{ color: dark ? 'var(--muted)' : 'var(--ink)' }} /><Icon name="moon" size={16} style={{ color: dark ? 'var(--ink)' : 'var(--muted)' }} />
      </span>
    </button>
  );
}

const ICONS: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.6-3.6',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10',
  plus: 'M12 5v14M5 12h14',
  calendar: 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4',
  bag: 'M6 8h12l-1 12H7L6 8zM9 8V6a3 3 0 0 1 6 0v2',
  walk: 'M13 4.5a1.5 1.5 0 1 0 0 .01M10 21l2-6 3 3v3M9 13l1-4 4 1 2 3M10 9l-3 2v3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l2.5 2.5',
  phone: 'M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4z',
  message: 'M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM5 20a7 7 0 0 1 14 0',
  users: 'M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM3 20a6 6 0 0 1 12 0M16 5.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 21h4',
  card: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3 10h18M7 15h3',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 10v4M18 10v4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
  ticket: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7zM14 7v10',
  screen: 'M4 5h16v11H4zM9 20h6M12 16v4',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4V8zM4 8l8 4 8-4M12 12v8',
  broom: 'M14 4l-4 8M6 13h8l2 7H4l2-7zM8 16v4M12 16v4',
  station: 'M5 10h14v4H5zM7 14v6M17 14v6M9 10V6h6v4',
  home: 'M4 11l8-7 8 7v9H4v-9zM10 20v-5h4v5',
  school: 'M3 9l9-5 9 5-9 5-9-5zM7 11v5c3 2 7 2 10 0v-5',
  alert: 'M12 4l9 16H3l9-16zM12 10v4M12 17h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6',
  till: 'M4 10h16v10H4zM7 10V5h10v5M8 14h2M14 14h2M8 17h8',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  columns: 'M4 5h4v14H4zM10 5h4v14h-4zM16 5h4v14h-4z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  pause: 'M8 5v14M16 5v14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};
export type IconName = keyof typeof ICONS;
/** Line icons — one stroke weight, currentColor. */
export function Icon({ name, size = 18, stroke = 1.7, className = '', style }: { name: string; size?: number; stroke?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} style={style}>
      <path d={ICONS[name] || ''} />
    </svg>
  );
}

/** Progress ring for a service in progress; turns amber when it runs over. */
export function Ring({ progress, size = 40, stroke = 3, children }: { progress: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.min(1, Math.max(0, progress));
  const over = progress > 1;
  return (
    <span className="d-ring relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? 'var(--warn)' : 'var(--ok)'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

/** A small live dot that pings — something is happening now. */
export function LiveDot({ tone = 'ok' }: { tone?: 'ok' | 'warn' | 'accent' }) {
  return <span aria-hidden className="d-ping inline-block h-2 w-2 shrink-0 rounded-full" style={{ color: `var(--${tone})`, background: 'currentColor' }} />;
}

/** On/off switch in the desk's look. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-40" style={{ background: on ? 'var(--ok)' : 'var(--line)' }}>
      <span aria-hidden className="absolute h-5 w-5 rounded-full bg-white transition-all duration-200" style={{ left: on ? 18 : 2, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
    </button>
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
      className={`relative rounded-2xl ${compact ? 'p-3' : 'p-3.5'}`} style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>
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
    <section aria-label={title} className={`rounded-3xl p-2.5 ${className}`} style={{ background: 'var(--soft)' }}>
      <h3 className="mb-2 flex items-center justify-between px-1.5 pt-1 text-[14px] font-semibold">{title}{count !== undefined && <span className="font-medium" style={{ color: 'var(--muted)' }}>{count}</span>}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** Side drawer (checkout, selling). Slides in over the desk; the desk stays where it was. */
export function Drawer({ open, onClose, title, children, wide, accent }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; accent?: string | null }) {
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  const { resolved } = useDeskTheme();
  if (typeof document === 'undefined') return null;
  // Phones: appear in place — no slide. (Movement animations have stranded panels off-screen on iPhone before.)
  const still = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches;
  return createPortal(
    <AnimatePresence>{open && (
      <div className="desk fixed inset-0 z-[80]" data-desk-theme={resolved} style={{ background: 'transparent', ...(accent ? { ['--accent' as any]: accent } : {}) }}>
        <style>{DESK_CSS}</style>
        <motion.div className="absolute inset-0 bg-black/30" initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={still ? undefined : { opacity: 0 }} onClick={onClose} aria-hidden />
        <motion.aside role="dialog" aria-label={title} initial={still ? false : { x: '100%' }} animate={{ x: 0 }} exit={still ? undefined : { x: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          className={`absolute inset-y-0 right-0 flex w-full flex-col ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'} sm:rounded-l-[28px]`} style={{ background: 'var(--paper)', boxShadow: '-24px 0 48px -24px rgba(0,0,0,.35)', paddingTop: 'env(safe-area-inset-top,0px)' }}>
          <header className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
            <p className="text-[17px] font-semibold">{title}</p>
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'var(--soft)' }}><Icon name="close" size={18} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>{children}</div>
        </motion.aside>
      </div>
    )}</AnimatePresence>,
    document.body,
  );
}

type MenuItem = { label: string; onSelect: () => void; tone?: 'danger'; hint?: string; icon?: string; count?: number };
/** The "more" menu — the less-common actions, one tap away. */
export function Menu({ items, label = 'More actions', trigger, width = 224 }: { items: (MenuItem | null | false | undefined | '' | 0)[]; label?: string; trigger?: ReactNode; width?: number }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); window.addEventListener('keydown', k); return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); }; }, [open]);
  const list = items.filter(Boolean) as MenuItem[];
  if (!list.length) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={trigger ? 'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold' : 'flex h-9 w-9 items-center justify-center rounded-full'} style={{ background: 'var(--soft)' }}>{trigger || <Icon name="more" size={20} stroke={2.6} />}</button>
      {open && <div role="menu" className="d-rise absolute right-0 top-11 z-30 max-h-[70vh] overflow-y-auto rounded-2xl py-1.5" style={{ width, background: 'var(--card)', border: '1px solid var(--line)', boxShadow: '0 24px 48px -20px rgba(0,0,0,.35)' }}>
        {list.map((it) => <button key={it.label} role="menuitem" type="button" onClick={() => { setOpen(false); it.onSelect(); }} className="d-row flex w-full items-start gap-3 px-4 py-2.5 text-left text-[14px]" style={it.tone === 'danger' ? { color: 'var(--danger)' } : undefined}>
          {it.icon && <Icon name={it.icon} size={18} className="mt-px" style={{ color: it.tone === 'danger' ? 'var(--danger)' : 'var(--muted)' }} />}
          <span className="min-w-0 flex-1">{it.label}{it.hint && <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{it.hint}</span>}</span>
          {!!it.count && <span className="rounded-full px-1.5 text-[11px] font-semibold tabular-nums" style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>{it.count}</span>}</button>)}
      </div>}
    </div>
  );
}
