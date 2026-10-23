'use client';
// src/components/orders/ui.tsx — THE BUILDING BLOCKS OF THE ORDERS SCREENS, drawn to the house rules: six type sizes,
// 44px touch areas, one black main button over a frosted bar, red only for destructive actions, true-black dark mode
// through the theme tokens (var(--paper), var(--ink), var(--soft), var(--line), var(--muted)).
import * as React from 'react';

export const C = {
  ink: 'var(--ink, #16171a)', paper: 'var(--paper, #fff)', soft: 'var(--soft, #f5f5f7)', line: 'var(--line, #ececee)', muted: 'var(--muted, #6d7075)',
  ok: 'var(--ok-ink, #1f7a4d)', okSoft: 'var(--ok-soft, #eaf6ef)', warn: 'var(--warn-ink, #b45309)', warnSoft: 'var(--warn-soft, #fff7ed)', bad: 'var(--bad-ink, #b42318)', badSoft: 'var(--bad-soft, #fdecea)', mint: '#7fd1a5',
};
export const muted: React.CSSProperties = { color: C.muted };

export function LargeTitle({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-[34px] font-light leading-tight tracking-[-0.025em]">{title}</h1>
        {sub ? <p className="m-0 mt-0.5 text-[15px]" style={muted}>{sub}</p> : null}
      </div>
      {right}
    </div>);
}

type BtnKind = 'primary' | 'soft' | 'danger' | 'plain' | 'mint';
export function Btn({ kind = 'soft', className = '', style, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind }) {
  const look: Record<BtnKind, React.CSSProperties> = {
    primary: { background: C.ink, color: C.paper }, soft: { background: C.soft, color: C.ink }, danger: { background: C.badSoft, color: C.bad },
    plain: { background: 'transparent', color: C.ink }, mint: { background: C.mint, color: '#16171a' },
  };
  return <button type="button" {...rest} className={`cf-press inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold disabled:opacity-50 ${className}`} style={{ ...look[kind], ...style }}>{children}</button>;
}

export function IconBtn({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} className="cf-press grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: C.soft, color: C.ink }}>{children}</button>;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  const i = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div role="tablist" className="relative flex rounded-full p-[3px]" style={{ background: C.soft }}>
      <span aria-hidden="true" className="cf-glide absolute bottom-[3px] top-[3px] rounded-full" style={{ left: 3, width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${i * 100}%)`, background: C.paper, boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 1px 1px rgba(0,0,0,.04)' }} />
      {options.map((o) => {
        const on = o.id === value;
        return <button key={o.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.id)} className="relative z-[1] h-9 flex-1 rounded-full px-3 text-[14px] font-semibold transition-colors duration-200" style={{ color: on ? C.ink : C.muted }}>{o.label}</button>;
      })}
    </div>);
}

/** The frosted bar at the bottom of a phone screen that holds the one main button (and anything stacked on it). */
export function BottomBar({ children, above = 0 }: { children: React.ReactNode; above?: number }) {
  return (
    <div className="fixed inset-x-0 z-30 border-t px-4 pt-3 lg:static lg:border-0 lg:px-0 lg:pt-4" style={{ bottom: above, borderColor: C.line, background: 'color-mix(in srgb, var(--paper, #fff) 86%, transparent)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', paddingBottom: above ? 12 : 'max(16px, env(safe-area-inset-bottom))' }}>
      {children}
    </div>);
}

/** A sheet that slides up on phones and sits centred on computers, and settles back down when closed. Labelled
 *  actions, never a bare ×. */
export function Sheet({ title, sub, onClose, closeLabel = 'Cancel', children, wide }: { title: string; sub?: React.ReactNode; onClose: () => void; closeLabel?: string; children: React.ReactNode; wide?: boolean }) {
  const [leaving, setLeaving] = React.useState(false);
  const close = React.useCallback(() => {
    if (leaving) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { onClose(); return; }
    setLeaving(true); setTimeout(onClose, 240);
  }, [leaving, onClose]);
  React.useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [close]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className={`fixed inset-0 z-50 flex items-end justify-center sm:items-center ${leaving ? 'cf-anim-backdrop-out' : 'cf-anim-backdrop'}`} style={{ background: 'rgba(22,23,26,.38)' }} onClick={close}>
      <div className={`max-h-[90dvh] w-full overflow-y-auto rounded-t-[28px] p-5 sm:rounded-[28px] ${wide ? 'max-w-2xl' : 'max-w-lg'} ${leaving ? 'cf-anim-sheet-out' : 'cf-anim-sheet'}`} style={{ background: C.paper, color: C.ink, paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-[5px] w-10 rounded-full sm:hidden" style={{ background: C.line }} />
        <div className="mb-2 flex items-start gap-3">
          <div className="min-w-0 flex-1"><p className="m-0 text-[22px] font-light leading-snug">{title}</p>{sub ? <p className="m-0 mt-1 text-[15px]" style={muted}>{sub}</p> : null}</div>
          <button type="button" onClick={close} className="cf-press h-11 shrink-0 px-1 text-[17px]" style={{ color: C.muted }}>{closeLabel}</button>
        </div>
        {children}
      </div>
    </div>);
}

/** A row in a grouped list: whole row tappable, at least 64px tall. */
export function ListRow({ onClick, lead, title, detail, trail, active }: { onClick?: () => void; lead?: React.ReactNode; title: React.ReactNode; detail?: React.ReactNode; trail?: React.ReactNode; active?: boolean }) {
  const inner = (<>
    {lead}
    <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch border-b py-2.5 pr-4" style={{ borderColor: C.line }}>
      <span className="min-w-0 flex-1"><span className="block truncate text-[17px] font-semibold tracking-[-0.01em]">{title}</span>{detail ? <span className="block truncate text-[14px]" style={muted}>{detail}</span> : null}</span>
      {trail}
    </span>
  </>);
  const look = { background: active ? C.soft : 'transparent', color: C.ink };
  // A row that does nothing itself isn't a button (and a button in its trail stays a button of its own).
  if (!onClick) return <div className="flex min-h-[64px] w-full items-center gap-3 pl-4 text-left" style={look}>{inner}</div>;
  return <button type="button" onClick={onClick} className="cf-press flex min-h-[64px] w-full items-center gap-3 pl-4 text-left" style={look}>{inner}</button>;
}

export function Initials({ name, photo }: { name: string; photo?: string }) {
  if (photo) return <img src={photo} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />;
  const t = String(name || '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  return <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[13px] font-semibold" style={{ background: C.soft, color: C.muted }}>{t}</span>;
}

export function Thumb({ src, size = 52 }: { src?: string; size?: number }) {
  return src ? <img src={src} alt="" className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />
    : <span className="shrink-0 rounded-xl" style={{ width: size, height: size, background: C.soft }} />;
}

/** The dark "Undo" bar: shows for 6 seconds above the main button. */
export function UndoBar({ text, onUndo, onDone, bottom = 96 }: { text: string; onUndo?: () => void; onDone: () => void; bottom?: number }) {
  React.useEffect(() => { const t = setTimeout(onDone, 6000); return () => clearTimeout(t); }, [text, onDone]);
  return (
    <div role="status" className="cf-anim-rise fixed inset-x-4 z-40 mx-auto flex min-h-12 max-w-md items-center justify-between gap-2 rounded-2xl px-4 py-2 text-[15px] leading-snug lg:inset-x-auto lg:right-8" style={{ bottom, background: '#16171a', color: '#fff' }}>
      <span className="line-clamp-2">{text}</span>
      {onUndo ? <button type="button" onClick={() => { onUndo(); onDone(); }} className="h-11 pl-4 font-semibold" style={{ color: C.mint }}>Undo</button> : null}
    </div>);
}

/** A short sound and vibration when something lands (or doesn't). */
export function feel(ok: boolean) {
  try { if (navigator.vibrate) navigator.vibrate(ok ? 30 : [70, 50, 70]); } catch { /* best effort */ }
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctx) return;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220; g.gain.value = 0.05; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.08 : 0.2));
  } catch { /* silent is fine */ }
}

export function Empty({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return <div className="cf-anim-rise px-6 py-16 text-center"><p className="m-0 text-[20px] font-light">{title}</p>{sub ? <p className="m-0 mt-1 text-[15px]" style={muted}>{sub}</p> : null}{action ? <div className="mt-4">{action}</div> : null}</div>;
}

export const Ic = {
  search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>,
  scan: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" /></svg>,
  chev: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>,
  back: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>,
  check: <svg className="cf-anim-draw" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>,
};

/** An on/off switch: green when on, the knob glides. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50" style={{ background: on ? C.ok : 'var(--line-strong, #dcdde0)' }}>
      <span className="cf-glide absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white" style={{ transform: `translateX(${on ? 20 : 0}px)`, boxShadow: '0 2px 6px rgba(0,0,0,.18)' }} />
    </button>);
}

/** A titled group of rows, like a settings list. */
export function Group({ title, foot, children }: { title?: string; foot?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      {title ? <p className="m-0 px-4 pb-2 text-[13px] font-semibold" style={muted}>{title}</p> : null}
      <div className="overflow-hidden rounded-2xl" style={{ background: C.soft }}>{children}</div>
      {foot ? <p className="m-0 px-4 pt-2 text-[13px] leading-snug" style={muted}>{foot}</p> : null}
    </section>);
}

/** One row inside a Group: a label, an optional note under it, and a control on the right. */
export function Row({ label, note, children, last }: { label: React.ReactNode; note?: React.ReactNode; children?: React.ReactNode; last?: boolean }) {
  return (
    <div className="flex min-h-[56px] items-center gap-3 pl-4">
      <div className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4" style={last ? undefined : { borderBottom: `1px solid ${C.line}` }}>
        <div className="min-w-0 flex-1"><p className="m-0 text-[17px] tracking-[-0.01em]">{label}</p>{note ? <p className="m-0 mt-0.5 text-[13px] leading-snug" style={muted}>{note}</p> : null}</div>
        {children}
      </div>
    </div>);
}
