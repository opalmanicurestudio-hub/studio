'use client';
// src/components/pos/desk/Undo.tsx — A SAFETY NET FOR ONE-TAP JOBS. Quick actions (start a cleanse, start a load, folded,
// set out, the last tick that marks a station ready) wait a few seconds before they happen, with an Undo bar at the
// bottom of the screen. A mis-tap is one tap to take back; doing nothing lets it go through. Scans are intentional and
// happen straight away. Leaving the screen sends a waiting action through rather than losing it.
import * as React from 'react';

type Pending = { id: number; label: string; run: () => Promise<unknown> | unknown; ms: number; at: number };

export function useDeferred(ms = 5000) {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const ref = React.useRef<Pending | null>(null); const timer = React.useRef<any>(null); const seq = React.useRef(0);
  const fire = React.useCallback(async (p: Pending) => { if (ref.current?.id !== p.id) return; clearTimeout(timer.current); ref.current = null; setPending(null); try { await p.run(); } catch { /* the action reports its own errors */ } }, []);
  const defer = React.useCallback((label: string, run: () => Promise<unknown> | unknown, wait = ms) => {
    if (ref.current) void fire(ref.current);   // a second tap sends the first one through now
    const p = { id: ++seq.current, label, run, ms: wait, at: Date.now() }; ref.current = p; setPending(p);
    timer.current = setTimeout(() => { void fire(p); }, wait);
  }, [fire, ms]);
  const undo = React.useCallback(() => { clearTimeout(timer.current); ref.current = null; setPending(null); }, []);
  React.useEffect(() => () => { if (ref.current) { clearTimeout(timer.current); const p = ref.current; ref.current = null; void p.run(); } }, []);
  const bar = pending ? <UndoBar key={pending.id} label={pending.label} ms={pending.ms} onUndo={undo} onNow={() => void fire(pending)} /> : null;
  return { defer, undo, bar, waiting: pending };
}

export function UndoBar({ label, ms, onUndo, onNow }: { label: string; ms: number; onUndo: () => void; onNow: () => void }) {
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-[90] flex justify-center px-4">
      <div className="relative flex w-full max-w-[520px] items-center gap-3 overflow-hidden rounded-full bg-[#17181A] py-2 pl-5 pr-2 text-white shadow-2xl">
        <style>{`@keyframes cfUndo{from{transform:scaleX(1)}to{transform:scaleX(0)}}@media (prefers-reduced-motion: reduce){.cf-undo-bar{animation:none!important}}`}</style>
        <span aria-hidden className="cf-undo-bar absolute bottom-0 left-0 h-[3px] w-full origin-left bg-white/60" style={{ animation: `cfUndo ${ms}ms linear forwards` }} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-[600]">{label}</span>
        <button type="button" onClick={onNow} className="h-10 rounded-full px-3 text-[13px] font-[600] text-white/80">Now</button>
        <button type="button" onClick={onUndo} className="h-10 rounded-full bg-white px-5 text-[14px] font-[800] text-[#17181A]">Undo</button>
      </div>
    </div>);
}
