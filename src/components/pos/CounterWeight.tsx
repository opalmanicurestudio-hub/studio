'use client';
// src/components/pos/CounterWeight.tsx — SOLD BY WEIGHT, AT THE COUNTER OR THE WINDOW (design board "Sold by weight";
// lib/menu-weight). What the scale reads (typed, or a quick weight), the price worked out as it's typed, and added to the
// order as a line of its own. `add` posts the item, its choices and the weight to the screen's own api/counter and answers
// with an error to show, or null when it's on. White surfaces are set inline, so the app's black look (lib/app-theme)
// takes them over.
import { useEffect, useState } from 'react';
import { QUICK, cleanWeight, perText, weightText, type WeightUnit } from '@/lib/menu-weight';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-3 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

/** `price`: per unit of weight now; `extra`: its picked choices' extras, once; `choicesText`: those choices, in words. */
export function WeightSheet({ name, unit, price, extra = 0, choicesText, onClose, add }: { name: string; unit: WeightUnit; price: number; extra?: number; choicesText?: string | null; onClose: () => void; add: (weight: number) => Promise<string | null> }) {
  const [typed, setTyped] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const w = typed ? cleanWeight(typed, unit) : null;
  const total = w === null ? null : Math.round((w * price + extra) * 100) / 100;
  const go = async (weight = w) => {
    if (weight === null || busy) return;
    setBusy(true); setErr('');
    const e = await add(weight).catch(() => 'No connection. Try again.');
    setBusy(false); if (e) setErr(e);
  };
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-label={`Weigh ${name}`} onSubmit={(e) => { e.preventDefault(); void go(); }} className="w-full max-w-[460px] space-y-4 rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0"><span className="block text-[19px] font-semibold">{name}</span><span className="block text-[13.5px]" style={{ color: MUTED }}>{perText(price, unit)}{choicesText ? `, ${choicesText}` : ''}</span></span>
          <button type="button" onClick={onClose} className={`${btn} px-4 text-[14px]`} style={{ color: MUTED }}>Close</button></div>
        <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>What the scale reads
          <span className="mt-1 flex min-h-[64px] items-center gap-2 rounded-xl border px-4 focus-within:border-[#16171a]" style={{ borderColor: typed && w === null ? AMBER : LINE }}>
            <input autoFocus inputMode="decimal" value={typed} onChange={(e) => { setTyped(e.target.value.replace(/[^\d.]/g, '').slice(0, 8)); setErr(''); }} placeholder="0.00" className="min-w-0 flex-1 bg-transparent text-[30px] font-medium tabular-nums" style={{ color: INK, outline: 'none' }} />
            <span aria-hidden className="text-[18px]" style={{ color: MUTED }}>{unit}</span>
          </span></label>
        <div className="grid grid-cols-4 gap-2">{QUICK[unit].map((q) => <button key={q.label} type="button" disabled={busy} onClick={() => setTyped(String(q.amount))} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{q.label}</button>)}</div>
        {w !== null && total !== null && <div className="flex items-baseline justify-between gap-3 text-[14.5px]"><span style={{ color: MUTED }}>{weightText(w, unit)} at {perText(price, unit)}{extra > 0 ? `, plus ${usd(extra)}` : ''}</span><b className="font-semibold tabular-nums">{usd(total)}</b></div>}
        {typed && w === null && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>How much does it weigh, in {unit}?</p>}
        {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
        <button type="submit" disabled={w === null || busy} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Adding…' : total !== null ? `Add to the order, ${usd(total)}` : 'Add to the order'}</button>
        <p className="text-[13px]" style={{ color: MUTED }}>Each weighing is a line of its own. Its weight comes off stock.</p>
      </form>
    </div>
  );
}

/** The choices picked for a weighed item: their extras (once) and their names. */
export function pickedOf(groups: { id: string; options: { id: string; name: string; price: number }[] }[], picks: Record<string, string[]>) {
  const opts = groups.flatMap((g) => g.options.filter((o) => (picks[g.id] || []).includes(o.id)));
  return { extra: Math.round(opts.reduce((n, o) => n + (Number(o.price) || 0), 0) * 100) / 100, text: opts.map((o) => o.name).join(', ') || null };
}
