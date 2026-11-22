'use client';
// src/components/pos/CounterComp.tsx — ONE ITEM ON THE HOUSE, AT THE COUNTER OR THE WINDOW (design board "Register tools,
// part 2", part 2; lib/counter-comp-server). Why (one of the usual reasons, or typed), how many while it's being taken
// (all of the line once it's with the kitchen), and a manager's PIN. `call` posts to the screen's own api/counter with
// its own key. White surfaces are set inline, so the app's black look (lib/app-theme) takes them over.
import { useEffect, useState } from 'react';
import { PinPad } from '@/components/kitchen/PinPad';
import { COMP_REASONS } from '@/lib/counter-comp';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

type Line = { lineId: string; name: string; quantity: number; unitPrice: number; choicesText?: string | null };

export function CompSheet({ orderId, number, line, whole, call, onClose, onDone }: { orderId: string; number: string; line: Line; whole: boolean; call: (body: any) => Promise<any>; onClose: () => void; onDone: (text: string, d: any) => void }) {
  const [n, setN] = useState(line.quantity); const [why, setWhy] = useState(''); const [other, setOther] = useState(false); const [typed, setTyped] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [pin, setPin] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const reason = other ? typed.trim() : why;
  const body = { action: 'comp', orderId, lineId: line.lineId, qty: whole ? line.quantity : n, reason };
  const words = (d: any) => `${d.qty} ${d.name} on the house on ${number} (${usd(d.cents / 100)}), okayed by ${d.approvedBy}.`;
  const go = async () => {
    if (!reason) { setErr('Why is it on the house?'); return; }
    setBusy(true); setErr('');
    try { const d = await call(body); if (d?.ok) onDone(words(d), d); else if (d?.needsManager) setPin(true); else setErr(d?.error || 'That didn’t go through. Try again.'); }
    catch { setErr('No connection. Try again.'); } finally { setBusy(false); }
  };
  const chip = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK });
  const quiet = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
  return (<>
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`${line.name} on the house`} className="w-full max-w-[460px] space-y-4 rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-center justify-between gap-2"><p className="text-[19px] font-semibold">On the house</p>
          <button type="button" onClick={onClose} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Close</button></div>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0"><span className="block text-[15.5px] font-semibold">{line.name}</span>{line.choicesText && <span className="block text-[13px]" style={{ color: MUTED }}>{line.choicesText}</span>}</span>
          {!whole && line.quantity > 1 ? <span className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="One fewer on the house" onClick={() => setN((x) => Math.max(1, x - 1))} disabled={n <= 1 || busy} className={`h-11 w-11 rounded-full text-[18px] ${RING}`} style={quiet}>−</button>
            <span className="w-7 text-center text-[16px] font-semibold tabular-nums" aria-live="polite">{n}</span>
            <button type="button" aria-label="One more on the house" onClick={() => setN((x) => Math.min(line.quantity, x + 1))} disabled={n >= line.quantity || busy} className={`h-11 w-11 rounded-full text-[18px] ${RING}`} style={quiet}>+</button>
          </span> : <span className="shrink-0 text-[15px] tabular-nums"><s style={{ color: MUTED }}>{usd(line.unitPrice * line.quantity)}</s> $0.00</span>}
        </div>
        <div role="radiogroup" aria-label="Why it’s on the house" className="flex flex-wrap gap-2">
          {COMP_REASONS.map((r) => <button key={r} type="button" role="radio" aria-checked={!other && why === r} onClick={() => { setOther(false); setWhy(r); setErr(''); }} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={chip(!other && why === r)}>{r}</button>)}
          <button type="button" role="radio" aria-checked={other} onClick={() => { setOther(true); setErr(''); }} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={chip(other)}>Something else</button>
        </div>
        {other && <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 60))} placeholder="Birthday" aria-label="Why, in a few words" className="block min-h-[48px] w-full rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} />}
        {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
        <button type="button" disabled={busy || !reason} onClick={() => void go()} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : `On the house, ${usd(line.unitPrice * (whole ? line.quantity : n))} off`}</button>
        <p className="text-[13px]" style={{ color: MUTED }}>{whole && line.quantity > 1 ? 'It’s with the kitchen, so it’s the whole line. ' : ''}A manager’s PIN. It’s still made and still comes off stock; the night report shows what was given and why.</p>
      </div>
    </div>
    {pin && <PinPad title="A manager’s PIN" line={`${line.name} on the house: ${reason}. It doesn’t change who’s signed in here.`} onClose={() => setPin(false)} onDone={() => setPin(false)}
      check={async (p) => { const d = await call({ ...body, pin: p }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
        if (!d?.ok) return { ok: false as const, error: d?.error || 'That didn’t go through. Try again.' }; onDone(words(d), d); return { ok: true as const, staff: { id: '', name: '', pass: '' } }; }} />}
  </>);
}
