'use client';
// src/components/kitchen/PinPad.tsx — "WHO'S WORKING?" on a team screen (the kitchen screen, the drive-thru lane): four
// digits, checked by the server (api/kitchen 'pin', with its lockout), never here. The screen works without it; a PIN
// only puts a name on what's done.
import { useEffect, useRef, useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309';

export type ScreenStaff = { id: string; name: string; pass: string };

export function PinPad({ check, onDone, onClose, line = 'Your PIN puts your name on what you do here. The screen works without it.' }: {
  check: (pin: string) => Promise<{ ok: true; staff: ScreenStaff } | { ok: false; error: string }>; onDone: (s: ScreenStaff) => void; onClose: () => void; line?: string;
}) {
  const [pin, setPin] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); else if (/^[0-9]$/.test(e.key)) (box.current?.querySelector(`[data-k="${e.key}"]`) as HTMLButtonElement | null)?.click(); else if (e.key === 'Backspace') (box.current?.querySelector('[data-k="back"]') as HTMLButtonElement | null)?.click(); };
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  const press = async (k: string) => {
    if (busy) return;
    if (k === 'back') { setPin((p) => p.slice(0, -1)); setErr(''); return; }
    const next = (pin + k).slice(0, 4); setPin(next); setErr('');
    if (next.length < 4) return;
    setBusy(true);
    const r = await check(next);
    setBusy(false);
    if (r.ok) onDone(r.staff); else { setErr(r.error); setPin(''); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="pin-title" className="w-full max-w-xs space-y-4 rounded-3xl bg-[#fff] p-5">
        <div>
          <h2 id="pin-title" className="text-[20px] font-semibold" style={{ color: INK }}>Who’s working?</h2>
          <p className="mt-1 text-[14px]" style={{ color: MUTED }}>{line}</p>
        </div>
        <div className="flex justify-center gap-3" role="status" aria-label={`${pin.length} of 4 digits`}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="h-3.5 w-3.5 rounded-full" style={{ background: i < pin.length ? INK : LINE }} />)}
        </div>
        {err && <p role="alert" className="text-center text-[14px]" style={{ color: AMBER }}>{err}</p>}
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map((k, i) => k === ''
            ? <span key={i} />
            : <button key={i} data-k={k} type="button" disabled={busy} onClick={() => press(k)} className="h-14 rounded-2xl text-[20px] font-semibold disabled:opacity-50" style={{ background: SOFT, color: INK }} aria-label={k === 'back' ? 'Delete' : k}>{k === 'back' ? '⌫' : k}</button>)}
        </div>
        <button type="button" onClick={onClose} className="min-h-[44px] w-full rounded-xl px-4 text-[14px] font-semibold" style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Close</button>
      </div>
    </div>
  );
}
