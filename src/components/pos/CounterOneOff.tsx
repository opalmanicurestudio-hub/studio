'use client';
// src/components/pos/CounterOneOff.tsx — SOMETHING NOT ON THE MENU, AT THE COUNTER OR THE WINDOW (design board "Register
// tools", part 2; lib/counter-oneoff). Its name, its price (up to the amount the business sets under Menu) and whether
// it's taxed, added to the order being taken as a line of its own. Handed over at the counter: it doesn't go to the
// kitchen. `add` posts to the screen's own api/counter and answers with an error to show, or null when it's on. White
// surfaces are set inline, so the app's black look (lib/app-theme) takes them over.
import { useEffect, useMemo, useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const field = `mt-1 block min-h-[48px] w-full rounded-xl border px-3 text-[16px] font-normal outline-none focus:border-[#16171a]`;

export function OneOffSheet({ max, onClose, add }: { max: number; onClose: () => void; add: (body: { name: string; price: number; taxed: boolean; tapKey: string }) => Promise<string | null> }) {
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [taxed, setTaxed] = useState(true);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  // (One tap is one line, however often it's sent.)
  const tapKey = useMemo(() => `oneoff-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const n = Math.round(Number(price.replace(/[$,\s]/g, '')) * 100) / 100;
  const ready = name.trim().length > 0 && n > 0 && n <= max;
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    const e = await add({ name: name.trim(), price: n, taxed, tapKey }).catch(() => 'No connection. Try again.');
    setBusy(false); if (e) setErr(e);
  };
  const seg = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` });
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-label="Something not on the menu" onSubmit={(e) => { e.preventDefault(); void go(); }} className="w-full max-w-[460px] space-y-4 rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-center justify-between gap-2"><p className="text-[19px] font-semibold">Another item</p>
          <button type="button" onClick={onClose} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Close</button></div>
        <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>What is it?
          <input autoFocus value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Bag of beans, 12 oz" autoComplete="off" className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
        <div className="flex items-end gap-3">
          <label className="block min-w-0 flex-1 text-[13px] font-semibold" style={{ color: MUTED }}>Price
            <span className="mt-1 flex min-h-[48px] items-center rounded-xl border px-3 focus-within:border-[#16171a]" style={{ borderColor: n > max ? AMBER : LINE }}>
              <span aria-hidden className="text-[18px]" style={{ color: MUTED }}>$</span>
              <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} placeholder="0.00" className="min-w-0 flex-1 bg-transparent px-1 text-[18px] font-normal tabular-nums" style={{ color: INK, outline: 'none' }} />
            </span></label>
          <div role="group" aria-label="Sales tax" className="flex shrink-0 gap-1.5">
            <button type="button" aria-pressed={taxed} onClick={() => setTaxed(true)} className={`${btn} min-h-[48px]`} style={seg(taxed)}>Taxed</button>
            <button type="button" aria-pressed={!taxed} onClick={() => setTaxed(false)} className={`${btn} min-h-[48px]`} style={seg(!taxed)}>Not taxed</button>
          </div>
        </div>
        {n > max && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>Up to ${max.toFixed(2)} here. Anything more goes on the menu first.</p>}
        {err && n <= max && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
        <button type="submit" disabled={!ready || busy} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Adding…' : n > 0 && n <= max ? `Add to the order, $${n.toFixed(2)}` : 'Add to the order'}</button>
        <p className="text-[13px]" style={{ color: MUTED }}>Up to ${max.toFixed(2)}. It’s handed over here and doesn’t go to the kitchen. Kept by name under Menu, so you can see what to put on the menu.</p>
      </form>
    </div>
  );
}
