'use client';
// src/components/markup/PhotoCompare.tsx — NOW AND THE GOAL, SIDE BY SIDE (board 17B, "Compare"). How it looks now next to
// the photo they love: a slider to drag across, the two side by side, or one seen through the other. The marks are
// on both (each photo is shown as it was sent, never trimmed). The two share one frame, the shape of the "now" photo,
// so the line and the see-through always line up. The client sees it while booking and the team on the appointment; after the
// visit the finished photo can join them. Plain images, so it works with any photo the page can show.
import * as React from 'react';
import { createPortal } from 'react-dom';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', WARN = '#b45309';
export type ComparePhoto = { src: string; label: string };

export function PhotoCompare({ now, goals, after, onClose, accent = INK, who, viewer = 'client' }: {
  now: ComparePhoto; goals: ComparePhoto[]; after?: ComparePhoto | null; onClose: () => void; accent?: string;
  /** Whose screen this is: the client's ("the photo you love") or the team's ("the photo they love"). */
  viewer?: 'client' | 'team';
  /** Who can open the same comparison on the appointment (the client's screen only). */
  who?: string;
}) {
  const [mode, setMode] = React.useState<'slider' | 'side' | 'through'>('slider');
  const [gi, setGi] = React.useState(0); const [at, setAt] = React.useState(0.5); const [mix, setMix] = React.useState(0.5);
  const [right, setRight] = React.useState<'goal' | 'after'>('goal');
  const [shape, setShape] = React.useState<number | null>(null); const [box, setBox] = React.useState({ w: 0, h: 0 }); const [broken, setBroken] = React.useState<string | null>(null);   // the photo that couldn't be shown
  const root = React.useRef<HTMLDivElement>(null); const stage = React.useRef<HTMLDivElement>(null); const frame = React.useRef<HTMLDivElement>(null); const dragging = React.useRef(false);
  const goal = right === 'after' && after ? after : goals[Math.min(gi, goals.length - 1)];
  const loved = viewer === 'client' ? 'the photo you love' : 'the photo they love';
  React.useEffect(() => { setBroken(null); }, [now.src, goal.src]);   // another photo is tried afresh
  React.useEffect(() => { const before = document.activeElement as HTMLElement | null; root.current?.focus({ preventScroll: true }); return () => { try { before?.focus?.({ preventScroll: true }); } catch { /* gone */ } }; }, []);
  React.useEffect(() => { const back = () => onClose(); window.addEventListener('cf-markup-back', back); return () => window.removeEventListener('cf-markup-back', back); }, [onClose]);
  // The frame: as large as fits, the shape of the "now" photo.
  React.useEffect(() => {
    const el = stage.current; if (!el) return;
    // (Inside the stage's side padding, so the handle never hangs off its edge.)
    const fit = () => { setBox({ w: Math.max(0, el.clientWidth - 48), h: el.clientHeight }); };
    fit(); const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null; ro?.observe(el); return () => ro?.disconnect();
  }, [mode]);
  const fw = shape && box.w && box.h ? Math.min(box.w, box.h * shape) : 0; const fh = fw && shape ? fw / shape : 0;
  const slide = (clientX: number) => { const r = frame.current?.getBoundingClientRect(); if (r && r.width) setAt(Math.min(1, Math.max(0, (clientX - r.left) / r.width))); };
  const chip = 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-4 text-[14px] font-semibold';
  const on = (x: boolean) => (x ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` });
  const tag = (t: string, side: 'left' | 'right') => <span className={`pointer-events-none absolute top-3 ${side === 'left' ? 'left-3' : 'right-3'} rounded-full px-3 py-1 text-[13px] font-semibold`} style={{ background: 'rgba(255,255,255,.94)', color: INK }}>{t}</span>;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab' && root.current) {
      // Tab goes round this screen alone.
      const f = Array.from(root.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length > 0);
      if (!f.length) return; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === root.current)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  };
  const handleKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setAt((x) => Math.max(0, x - step)); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setAt((x) => Math.min(1, x + step)); }
    else if (e.key === 'Home') { e.preventDefault(); setAt(0); } else if (e.key === 'End') { e.preventDefault(); setAt(1); }
  };
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div ref={root} tabIndex={-1} data-markup-editor="" role="dialog" aria-modal="true" aria-label="Compare" onKeyDown={onKey} className="fixed inset-0 z-[410] flex flex-col outline-none"
      style={{ background: '#fff', color: INK, paddingTop: 'env(safe-area-inset-top,0px)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
      <div className="flex items-center justify-between gap-2 px-3" style={{ minHeight: 52 }}>
        <span className="w-16" aria-hidden />
        <p className="text-[16px] font-semibold">Compare</p>
        <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-16 items-center justify-end px-3 text-[16px] font-semibold" style={{ color: accent }}>Done</button>
      </div>
      <div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6" style={{ background: LINE }}>
        {broken ? <p className="px-6 text-center text-[15px]" role="alert" style={{ color: WARN }}>{broken.startsWith('How it looks now') ? 'The photo of how it looks now couldn’t be shown just now.' : `${goal.label} couldn’t be shown just now.`}{goals.length > 1 || after ? ' Choose another below.' : ' Please try again.'}</p>
          : mode === 'side' ? (
          <div className="grid h-full w-full grid-cols-2 gap-1 p-2">
            {[{ p: now, t: 'Now' }, { p: goal, t: goal.label }].map(({ p, t }, i) => <div key={i} className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-xl" style={{ background: SOFT }}><img src={p.src} alt={i ? `${t}: ${loved}` : 'How it looks now'} onError={(e) => setBroken(e.currentTarget.alt)} className="max-h-full max-w-full object-contain" />{tag(t, 'left')}</div>)}
          </div>
        ) : (
          <div ref={frame} className="relative touch-none select-none" style={fw ? { width: fw, height: fh } : { width: '100%', height: '100%' }}
            onPointerDown={(e) => { if (mode !== 'slider' || (e.pointerType === 'mouse' && e.button !== 0)) return; dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); slide(e.clientX); }}
            onPointerMove={(e) => { if (dragging.current) slide(e.clientX); }} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }} onLostPointerCapture={() => { dragging.current = false; }}>
            <div className="absolute inset-0 overflow-hidden">
            <img src={now.src} alt="How it looks now" onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setShape(i.naturalWidth / i.naturalHeight); }} onError={(e) => setBroken(e.currentTarget.alt)} className="absolute inset-0 h-full w-full object-cover" />
            <img src={goal.src} alt={`${goal.label}: ${loved}`} onError={(e) => setBroken(e.currentTarget.alt)} className="absolute inset-0 h-full w-full object-contain"
              style={mode === 'slider' ? { clipPath: `inset(0 0 0 ${at * 100}%)`, background: SOFT } : { opacity: mix, background: SOFT }} />
            </div>
            {tag('Now', 'left')}{tag(goal.label, 'right')}
            {mode === 'slider' && <div className="pointer-events-none absolute inset-y-0" style={{ left: `${at * 100}%`, width: 2, marginLeft: -1, background: '#fff', boxShadow: '0 0 6px rgba(0,0,0,.25)' }} />}
            {mode === 'slider' && <span role="slider" tabIndex={0} aria-label={`Where the line is: now on the left, ${goal.label.toLowerCase()} on the right`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(at * 100)} aria-valuetext={`${Math.round(at * 100)}% now`} onKeyDown={handleKey}
              className="absolute top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[15px] font-bold outline-none focus-visible:ring-4" style={{ left: `${at * 100}%`, background: '#fff', color: INK, boxShadow: '0 4px 14px -4px rgba(0,0,0,.35)', ['--tw-ring-color' as any]: INK }}>‹›</span>}
          </div>)}
      </div>
      <div className="space-y-3 px-3 pb-4 pt-3" style={{ background: SOFT, borderTop: `1px solid ${LINE}` }}>
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3">
          {([['slider', 'Slider'], ['side', 'Side by side'], ['through', 'See through']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={chip} style={on(mode === k)}>{l}</button>)}
        </div>
        {(goals.length > 1 || after) && <div className="-mx-3 flex gap-2 overflow-x-auto px-3" role="group" aria-label="Compare with">
          {goals.map((g, i) => <button key={i} type="button" aria-pressed={right === 'goal' && gi === i} onClick={() => { setRight('goal'); setGi(i); }} className={chip} style={on(right === 'goal' && gi === i)}>{g.label}</button>)}
          {after && <button type="button" aria-pressed={right === 'after'} onClick={() => setRight('after')} className={chip} style={on(right === 'after')}>{after.label}</button>}
        </div>}
        {mode === 'through' && <label className="flex items-center gap-3 text-[14px]"><span className="w-16 shrink-0">Now</span>
          <input type="range" min={0} max={100} step={1} value={Math.round(mix * 100)} onChange={(e) => setMix(Number(e.target.value) / 100)} className="h-11 flex-1" aria-label="How much of the goal shows through" /><span className="w-16 shrink-0 text-right">{goal.label}</span></label>}
        <p className="text-[13.5px] leading-snug" style={{ color: MUTED }}>{mode === 'slider' ? `Drag the line to compare how it looks now with ${loved}. Marks show on both.` : mode === 'side' ? 'The two side by side, marks and all.' : 'One seen through the other: slide to show more of either.'}{viewer === 'client' && who ? ` ${who} can open this same comparison on your appointment.` : ''}</p>
      </div>
    </div>, document.body);
}
