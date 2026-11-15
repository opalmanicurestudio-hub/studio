'use client';
// src/components/menu/NewItemSheet.tsx — NEW ITEM, on the Menu page (design canvas "One item, two stations"; api/menu
// 'create'). A drink or a dish that isn't anywhere yet goes on the menu and into Inventory in one step: its name, price,
// section and the station that makes it, and how many there are when it's counted. Its editor opens straight after, for
// its photo, choices, recipe and the rest.
import { useEffect, useRef, useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const field = 'mt-1.5 block w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[16px] font-normal outline-none focus:border-[#16171a]';
const tapKey = () => { try { return Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20); } catch { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; } };

export function NewItemSheet({ sections, stations, onClose, onCreate }: { sections: string[]; stations: string[];
  onClose: () => void; onCreate: (body: { name: string; price: string; section: string; station: string | null; onHand: string; tapKey: string }) => Promise<string | null> }) {
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [section, setSection] = useState(sections[0] || '');
  const [station, setStation] = useState(''); const [onHand, setOnHand] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const key = useRef(tapKey()); const box = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setErr('');
    const r = await onCreate({ name: name.trim(), price, section: section.trim(), station: station || null, onHand, tapKey: key.current });
    setBusy(false); if (r) setErr(r);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="new-item-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[#fff] p-6 sm:max-w-lg sm:rounded-3xl" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="new-item-title" className="text-[21px] font-semibold">New item</h2>
            <p className="mt-1 text-[14px]" style={{ color: MUTED }}>It goes on the menu and into Inventory in one step. Add a photo, choices and its recipe next.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className={`h-11 w-11 shrink-0 rounded-full border text-[20px] ${RING}`} style={{ borderColor: LINE }}>×</button>
        </div>
        <form onSubmit={save} className="mt-5 space-y-4">
          <div className="grid grid-cols-[1fr_130px] gap-3">
            <label className="block text-[14px] font-semibold">Name<input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} placeholder="Steak frites" autoComplete="off" className={field} style={{ borderColor: LINE }} /></label>
            <label className="block text-[14px] font-semibold">Price<input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} inputMode="decimal" placeholder="24.00" className={field} style={{ borderColor: LINE }} /></label>
          </div>
          <div className={stations.length ? 'grid grid-cols-2 gap-3' : ''}>
            <label className="block text-[14px] font-semibold">Section<input value={section} onChange={(e) => setSection(e.target.value.slice(0, 40))} list="new-item-sections" placeholder="Mains" autoComplete="off" className={field} style={{ borderColor: LINE }} />
              <datalist id="new-item-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist></label>
            {stations.length > 0 && <label className="block text-[14px] font-semibold">Made at
              <select value={station} onChange={(e) => setStation(e.target.value)} className={field} style={{ borderColor: LINE }}>
                <option value="">Worked out from its section</option>
                {stations.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></label>}
          </div>
          <label className="block text-[14px] font-semibold">How many you have <span className="font-normal" style={{ color: MUTED }}>(if it’s counted)</span>
            <input value={onHand} onChange={(e) => setOnHand(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Leave empty if it’s made to order" className={field} style={{ borderColor: LINE }} />
            <span className="mt-1.5 block text-[13px] font-normal" style={{ color: MUTED }}>Something made to order is sold while its ingredients last: add its recipe in the next step.</span></label>
          {err && <p role="alert" className="rounded-xl px-3 py-2 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={`min-h-[44px] rounded-xl px-5 text-[15px] font-semibold ${RING}`} style={{ background: SOFT }}>Cancel</button>
            <button type="submit" disabled={busy || !name.trim() || price.trim() === ''} className={`min-h-[44px] rounded-xl px-5 text-[15px] font-semibold disabled:opacity-40 ${RING}`} style={{ background: INK, color: '#fff' }}>{busy ? 'Adding…' : 'Add to the menu'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
