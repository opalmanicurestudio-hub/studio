'use client';
// src/components/pos/CounterScan.tsx — A CODE SCANNED AT THE COUNTER OR THE WINDOW THAT'S ON NOTHING YET (design board
// "Register tools", part 3; lib/counter-scan-server). Pick the menu item it is, a manager okays it with their PIN, and
// the code is on that item from then on (it scans everywhere), and it's added to the order. `call` posts to the screen's
// own api/counter with its own key. White surfaces are set inline, so the app's black look (lib/app-theme) takes them over.
import { useEffect, useMemo, useState } from 'react';
import { PinPad } from '@/components/kitchen/PinPad';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const field = `mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal outline-none focus:border-[#16171a]`;
const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

type Item = { id: string; name: string; section: string; price: number; choices?: unknown[] };

/** "That code is on nothing yet": pick the item it is. `onDone`: the words to show, and the order as it is now. */
/** `scaleNo`: with scale labels on, the item number a sticker with this code would be (lib/scale-label), said as the
 *  other way to it, since a sticker's code changes with each weighing and isn't one to keep on an item. */
export function CodeOnSheet({ code, orderId, menu, call, onClose, onDone, scaleNo }: { code: string; orderId: string; menu: Item[]; call: (body: any) => Promise<any>; onClose: () => void; onDone: (text: string, d: any) => void; scaleNo?: string | null }) {
  const [q, setQ] = useState(''); const [pick, setPick] = useState<Item | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [pin, setPin] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return menu.filter((m) => !k || m.name.toLowerCase().includes(k) || m.section.toLowerCase().includes(k)).slice(0, 40); }, [menu, q]);
  const body = (it: Item) => ({ action: 'codeOn', orderId, code, itemId: it.id, tapKey: `code-${code}-${it.id}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) });
  const words = (it: Item, d: any) => `${code} is on ${it.name} now${d.name ? `, and ${d.name} was added` : d.after ? `. ${d.after}` : ''}.`;
  const go = async (it: Item) => {
    setPick(it); setBusy(true); setErr('');
    try { const d = await call(body(it)); if (d?.ok) onDone(words(it, d), d); else if (d?.needsManager) setPin(true); else setErr(d?.error || 'That didn’t go through. Try again.'); }
    catch { setErr('No connection. Try again.'); } finally { setBusy(false); }
  };
  return (<>
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="A code that’s on nothing yet" className="max-h-[92vh] w-full max-w-[520px] space-y-3 overflow-y-auto rounded-t-3xl p-4 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-center justify-between gap-2"><p className="text-[19px] font-semibold">Which item is it?</p>
          <button type="button" onClick={onClose} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Close</button></div>
        <p className="text-[14px]" style={{ color: MUTED }}><span className="font-semibold tabular-nums" style={{ color: INK }}>{code}</span> isn’t on anything yet. Pick the item it is: the code stays on it, so it scans everywhere. A manager okays it.</p>
        {scaleNo && <p className="rounded-xl px-3 py-2 text-[14px]" style={{ background: '#f5f5f7', color: INK }}>A sticker from your scale? Give the item scale number {scaleNo} on the Menu page instead, then scan it again.</p>}
        <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Find the item
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value.slice(0, 40))} placeholder="Sparkling water" autoComplete="off" className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
        {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
        <ul className="space-y-2">{shown.map((m) => (
          <li key={m.id}><button type="button" disabled={busy} onClick={() => void go(m)} className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl px-3 text-left disabled:opacity-60 ${RING}`} style={{ background: SOFT }}>
            <span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{m.name}</span><span className="block truncate text-[12.5px]" style={{ color: MUTED }}>{m.section}</span></span>
            <span className="shrink-0 text-[14.5px] tabular-nums">{usd(m.price)}</span></button></li>))}</ul>
        {!shown.length && <p className="text-[14px]" style={{ color: MUTED }}>Nothing on the menu matches that.</p>}
      </div>
    </div>
    {pin && pick && <PinPad title="A manager’s PIN" line={`It puts ${code} on ${pick.name}. It doesn’t change who’s signed in here.`} onClose={() => setPin(false)} onDone={() => setPin(false)}
      check={async (p) => { const d = await call({ ...body(pick), pin: p }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
        if (!d?.ok) return { ok: false as const, error: d?.error || 'That didn’t go through. Try again.' }; onDone(words(pick, d), d); return { ok: true as const, staff: { id: '', name: '', pass: '' } }; }} />}
  </>);
}
