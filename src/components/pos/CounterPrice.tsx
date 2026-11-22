'use client';
// src/components/pos/CounterPrice.tsx — ONE ITEM AT A DIFFERENT PRICE, AT THE COUNTER OR THE WINDOW (design board
// "Register tools, part 3", part 1; lib/counter-price-server). The new price each, why (one of the usual reasons, or
// typed), how many while it's being taken (all of the line once it's with the kitchen), and a manager's PIN when it's
// lower. `call` posts to the screen's own api/counter with its own key. White surfaces are set inline, so the app's black
// look (lib/app-theme) takes them over.
import { useEffect, useState } from 'react';
import { PinPad } from '@/components/kitchen/PinPad';
import { PRICE_REASONS, cleanPrice } from '@/lib/counter-price';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

type Line = { lineId: string; name: string; quantity: number; unitPrice: number; choicesText?: string | null; priceChange?: { from: number } | null };

export function PriceSheet({ orderId, number, line, whole, call, onClose, onDone }: { orderId: string; number: string; line: Line; whole: boolean; call: (body: any) => Promise<any>; onClose: () => void; onDone: (text: string, d: any) => void }) {
  const [n, setN] = useState(line.quantity); const [price, setPrice] = useState(''); const [why, setWhy] = useState(''); const [other, setOther] = useState(false); const [typed, setTyped] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [pin, setPin] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const menu = line.priceChange ? Number(line.priceChange.from) : line.unitPrice;
  const cents = cleanPrice(price); const now = Math.round(line.unitPrice * 100);
  const lower = cents !== null && cents < now;
  const reason = other ? typed.trim() : why;
  const qty = whole ? line.quantity : n;
  const body = { action: 'price', orderId, lineId: line.lineId, qty, price: cents === null ? null : cents / 100, reason };
  const words = (d: any) => d.back ? `${d.name} on ${number} is back at its menu price.` : `${d.qty} ${d.name} on ${number} at ${usd(d.to)} each (was ${usd(d.from)})${d.approvedBy ? `, okayed by ${d.approvedBy}` : ''}.`;
  const ready = cents !== null && cents !== now && !!reason;
  const go = async () => {
    if (!ready || busy) return; setBusy(true); setErr('');
    try { const d = await call(body); if (d?.ok) onDone(words(d), d); else if (d?.needsManager) setPin(true); else setErr(d?.error || 'That didn’t go through. Try again.'); }
    catch { setErr('No connection. Try again.'); } finally { setBusy(false); }
  };
  const chip = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK });
  const quiet = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
  return (<>
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-label={`${line.name} at a different price`} onSubmit={(e) => { e.preventDefault(); void go(); }} className="w-full max-w-[460px] space-y-4 rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-center justify-between gap-2"><p className="text-[19px] font-semibold">A different price</p>
          <button type="button" onClick={onClose} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Close</button></div>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0"><span className="block text-[15.5px] font-semibold">{line.name}</span><span className="block text-[13px]" style={{ color: MUTED }}>{usd(menu)} on the menu{line.priceChange ? `, ${usd(line.unitPrice)} now` : ''}</span></span>
          {!whole && line.quantity > 1 && <span className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="One fewer at this price" onClick={() => setN((x) => Math.max(1, x - 1))} disabled={n <= 1 || busy} className={`h-11 w-11 rounded-full text-[18px] ${RING}`} style={quiet}>−</button>
            <span className="w-7 text-center text-[16px] font-semibold tabular-nums" aria-live="polite">{n}</span>
            <button type="button" aria-label="One more at this price" onClick={() => setN((x) => Math.min(line.quantity, x + 1))} disabled={n >= line.quantity || busy} className={`h-11 w-11 rounded-full text-[18px] ${RING}`} style={quiet}>+</button>
          </span>}
        </div>
        <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>New price, each
          <span className="mt-1 flex min-h-[48px] items-center rounded-xl border px-3 focus-within:border-[#16171a]" style={{ borderColor: LINE }}>
            <span aria-hidden className="text-[18px]" style={{ color: MUTED }}>$</span>
            <input autoFocus inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value.replace(/[^\d.]/g, '').slice(0, 7)); setErr(''); }} placeholder={line.unitPrice.toFixed(2)} className="min-w-0 flex-1 bg-transparent px-1 text-[20px] font-normal tabular-nums" style={{ color: INK, outline: 'none' }} />
          </span></label>
        <div role="radiogroup" aria-label="Why the price is different" className="flex flex-wrap gap-2">
          {PRICE_REASONS.map((r) => <button key={r} type="button" role="radio" aria-checked={!other && why === r} onClick={() => { setOther(false); setWhy(r); setErr(''); }} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={chip(!other && why === r)}>{r}</button>)}
          <button type="button" role="radio" aria-checked={other} onClick={() => { setOther(true); setErr(''); }} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={chip(other)}>Something else</button>
        </div>
        {other && <input value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 60))} placeholder="Last one of the day" aria-label="Why, in a few words" className="block min-h-[48px] w-full rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} />}
        {cents === 0 || (price && cents === null) ? <p role="alert" className="text-[14px]" style={{ color: AMBER }}>A price from $0.01 to $1,000. For nothing at all, use On the house.</p> : null}
        {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
        <button type="submit" disabled={!ready || busy} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : cents !== null ? `Charge ${usd(cents / 100)}${qty > 1 ? ' each' : ''}${lower ? ', a manager’s PIN' : ''}` : 'Charge a different price'}</button>
        <p className="text-[13px]" style={{ color: MUTED }}>{whole && line.quantity > 1 ? 'It’s with the kitchen, so it’s the whole line. ' : ''}Lower takes a manager; higher doesn’t. Only this item on this order: the menu stays as it is. The night report shows what different prices took off, and why.</p>
      </form>
    </div>
    {pin && <PinPad title="A manager’s PIN" line={`${line.name} at ${cents !== null ? usd(cents / 100) : 'a lower price'}: ${reason}. It doesn’t change who’s signed in here.`} onClose={() => setPin(false)} onDone={() => setPin(false)}
      check={async (p) => { const d = await call({ ...body, pin: p }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
        if (!d?.ok) return { ok: false as const, error: d?.error || 'That didn’t go through. Try again.' }; onDone(words(d), d); return { ok: true as const, staff: { id: '', name: '', pass: '' } }; }} />}
  </>);
}

/** One link on a line for its price: on the house, or a different price (each opens its own sheet). */
export function PriceMenu({ name, free, onFree, onPrice, busy }: { name: string; free: boolean; onFree: () => void; onPrice: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]);
  const pick = (go: () => void) => { setOpen(false); go(); };
  return (<>
    <button type="button" onClick={() => setOpen(true)} disabled={busy} aria-label={`Change the price of ${name}`} className={`flex min-h-[44px] items-center text-[13px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }}>Change price</button>
    {open && <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label={`The price of ${name}`} className="w-full max-w-[380px] space-y-2 rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate text-[17px] font-semibold">{name}</p>
          <button type="button" onClick={() => setOpen(false)} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Close</button></div>
        {free && <button type="button" onClick={() => pick(onFree)} className={`${btn} w-full justify-start text-left`} style={{ background: SOFT, color: INK }}>On the house</button>}
        <button type="button" onClick={() => pick(onPrice)} className={`${btn} w-full justify-start text-left`} style={{ background: SOFT, color: INK }}>A different price</button>
        <p className="text-[13px]" style={{ color: MUTED }}>Only this item on this order. A manager okays either one, unless the price goes up.</p>
      </div>
    </div>}
  </>);
}
