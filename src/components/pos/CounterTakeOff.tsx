'use client';
// src/components/pos/CounterTakeOff.tsx — TAKE SOMETHING OFF AN ORDER THE KITCHEN HAS, BEFORE IT'S PAID (design board
// "Register tools, part 2", part 1; lib/counter-takeoff-server). How many of the line come off; the kitchen hasn't started
// it: back on the shelf, its ticket off the kitchen screen. It has: a manager's PIN, and it's kept as waste. `call` posts
// to the screen's own api/counter with its own key. White surfaces are set inline, so the app's black look
// (lib/app-theme) takes them over.
import { useEffect, useState } from 'react';
import { PinPad } from '@/components/kitchen/PinPad';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

type Line = { lineId: string; name: string; quantity: number; unitPrice: number; choicesText?: string | null };

/** "Take off" on one line of an order with the kitchen (`max`: how many can come off; the last of an order is a void
 *  instead). `onDone`: the words to show, and the answer (its order). */
export function TakeOffSheet({ orderId, number, line, max, call, onClose, onDone }: { orderId: string; number: string; line: Line; max: number; call: (body: any) => Promise<any>; onClose: () => void; onDone: (text: string, d: any) => void }) {
  const [n, setN] = useState(Math.max(1, max)); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [pin, setPin] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const body = { action: 'takeOff', orderId, lineId: line.lineId, qty: n };
  const words = (d: any) => `${d.qty} ${d.name} off ${number}${d.made ? `, kept as waste${d.approvedBy ? `, okayed by ${d.approvedBy}` : ''}` : ', back on the shelf'}. ${usd(d.less)} less.`;
  const go = async () => {
    setBusy(true); setErr('');
    try { const d = await call(body); if (d?.ok) onDone(words(d), d); else if (d?.needsManager) setPin(true); else setErr(d?.error || 'That didn’t go through. Try again.'); }
    catch { setErr('No connection. Try again.'); } finally { setBusy(false); }
  };
  const quiet = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
  return (<>
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Take ${line.name} off ${number}`} className="w-full max-w-[440px] space-y-4 rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-center justify-between gap-2"><p className="text-[19px] font-semibold">Take off {number}</p>
          <button type="button" onClick={onClose} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Close</button></div>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0"><span className="block text-[15.5px] font-semibold">{line.name}</span>{line.choicesText && <span className="block text-[13px]" style={{ color: MUTED }}>{line.choicesText}</span>}</span>
          {max > 1 ? <span className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="One fewer to take off" onClick={() => setN((x) => Math.max(1, x - 1))} disabled={n <= 1 || busy} className={`h-11 w-11 rounded-full text-[18px] ${RING}`} style={quiet}>−</button>
            <span className="w-7 text-center text-[16px] font-semibold tabular-nums" aria-live="polite">{n}</span>
            <button type="button" aria-label="One more to take off" onClick={() => setN((x) => Math.min(max, x + 1))} disabled={n >= max || busy} className={`h-11 w-11 rounded-full text-[18px] ${RING}`} style={quiet}>+</button>
          </span> : <span className="shrink-0 text-[15px] tabular-nums">{usd(line.unitPrice)}</span>}
        </div>
        {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
        <button type="button" disabled={busy} onClick={() => void go()} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Taking it off…' : `Take ${n} off, about ${usd(line.unitPrice * n)} less`}</button>
        <p className="text-[13px]" style={{ color: MUTED }}>If the kitchen hasn’t started it, it goes back on the shelf and its ticket comes off. If it has, a manager okays it and it’s kept as waste. Paid already? Refund it instead.</p>
      </div>
    </div>
    {pin && <PinPad title="A manager’s PIN" line={`The kitchen started on ${line.name}. Taking it off keeps it as waste. It doesn’t change who’s signed in here.`} onClose={() => setPin(false)} onDone={() => setPin(false)}
      check={async (p) => { const d = await call({ ...body, pin: p }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
        if (!d?.ok) return { ok: false as const, error: d?.error || 'That didn’t go through. Try again.' }; onDone(words(d), d); return { ok: true as const, staff: { id: '', name: '', pass: '' } }; }} />}
  </>);
}
