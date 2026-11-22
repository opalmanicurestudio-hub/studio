'use client';
// src/components/pos/DrawerMove.tsx — CASH IN AND OUT OF THE DRAWER, FROM THE COUNTER OR THE WINDOW (design board
// "Register tools, part 2", part 3; lib/drawer-moves-server). Pay out (an expense, with a photo of the receipt where
// the screen can take one), put in, or to the safe; how much; what for; the drawer's count before and after; and
// today's, each of which a manager can undo while the drawer's open. Every one is a manager's. And the drawer opened with
// no sale (design board "Register tools, part 3", part 3): someone signed in here, with why, on its record. `call` posts to the screen's own api/counter with its own key. White surfaces are set
// inline, so the app's black look (lib/app-theme) takes them over.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PinPad } from '@/components/kitchen/PinPad';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
type Kind = 'out' | 'in' | 'drop';
const NO_SALE = ['Make change', 'Check the count'];
const KINDS: { id: Kind; label: string; what: string; hint: string }[] = [
  { id: 'out', label: 'Pay out', what: 'What for', hint: 'Milk from the store' },
  { id: 'in', label: 'Put in', what: 'What for', hint: 'More change' },
  { id: 'drop', label: 'To the safe', what: 'A note, if you like', hint: 'Afternoon drop' },
];

/** `photo`: where the screen can take a photo of the receipt, a picker that hands back its address (else none). */
export function DrawerSheet({ call, onClose, onDone, photo }: { call: (body: any) => Promise<any>; onClose: () => void; onDone: (text: string) => void; photo?: (set: (url: string) => void) => ReactNode }) {
  const [kind, setKind] = useState<Kind>('out'); const [amount, setAmount] = useState(''); const [note, setNote] = useState(''); const [receiptUrl, setReceiptUrl] = useState('');
  const [view, setView] = useState<{ open: boolean; two?: boolean; expectedCash?: number; moves?: any[] } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [pin, setPin] = useState(false);
  // A move to undo (a manager's PIN), by its key.
  const [undo, setUndo] = useState<any | null>(null);
  // (One move, however often it's sent.)
  const moveKey = useMemo(() => `drawer-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, []);
  // Opened with no sale (lib/drawer-moves-server drawerNoSale): why, and a key of its own for each tap.
  const [noSale, setNoSale] = useState(false); const [nsWhy, setNsWhy] = useState(''); const [nsOther, setNsOther] = useState(false); const [nsTyped, setNsTyped] = useState('');
  const nsReason = nsOther ? nsTyped.trim() : nsWhy;
  const openIt = async () => {
    if (!nsReason || busy) return; setBusy(true); setErr('');
    const key = `nosale-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try { const d = await call({ action: 'noSale', reason: nsReason, moveKey: key }); if (d?.ok) onDone(`The drawer opened${d.printer ? ` on ${d.printer}` : ''}: ${nsReason}. It’s on the drawer’s record.`); else setErr(d?.error || 'That didn’t go through. Try again.'); }
    catch { setErr('No connection. Try again.'); } finally { setBusy(false); }
  };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  useEffect(() => { void call({ action: 'drawerView' }).then((d) => setView(d?.drawer || { open: false })).catch(() => setView({ open: false })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const k = KINDS.find((x) => x.id === kind)!;
  const cents = Math.round(Number(amount.replace(/[$,\s]/g, '')) * 100);
  const now = view?.open ? Math.round((view.expectedCash || 0) * 100) : null;
  const after = now === null || !(cents > 0) ? null : kind === 'in' ? now + cents : now - cents;
  const ready = !!view?.open && cents > 0 && (kind === 'drop' || note.trim().length > 0) && (after === null || after >= 0);
  const body = { action: 'drawer', kind, cents, note: note.trim(), moveKey, ...(kind === 'out' && receiptUrl ? { receiptUrl } : {}) };
  const words = (d: any) => `${d.words} ${usd(d.cents / 100)}${note.trim() ? `: ${note.trim()}` : ''}${d.approvedBy ? `, okayed by ${d.approvedBy}` : ''}. The drawer should have ${usd(d.expectedCash)}.`;
  const go = async () => {
    if (!ready || busy) return; setBusy(true); setErr('');
    try { const d = await call(body); if (d?.ok) onDone(words(d)); else if (d?.needsManager) setPin(true); else setErr(d?.error || 'That didn’t go through. Try again.'); }
    catch { setErr('No connection. Try again.'); } finally { setBusy(false); }
  };
  const seg = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` });
  const field = 'mt-1 flex min-h-[48px] w-full items-center rounded-xl border px-3 focus-within:border-[#16171a]';
  return (<>
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-label="Cash in or out of the drawer" onSubmit={(e) => { e.preventDefault(); void go(); }} className="max-h-[92vh] w-full max-w-[480px] space-y-4 overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <div className="flex items-center justify-between gap-2"><p className="text-[19px] font-semibold">The drawer</p>
          <button type="button" onClick={onClose} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Close</button></div>
        {view && !view.open ? <p className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: SOFT, color: MUTED }}>{view.two ? 'More than one drawer is open. Close the extra one from the front desk’s till first.' : 'No drawer is open. Open it from the front desk’s till first.'}</p> : <>
          <div role="radiogroup" aria-label="Which way" className="grid grid-cols-3 gap-2">
            {KINDS.map((x) => <button key={x.id} type="button" role="radio" aria-checked={kind === x.id} onClick={() => { setKind(x.id); setErr(''); }} className={btn} style={seg(kind === x.id)}>{x.label}</button>)}
          </div>
          <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>How much
            <span className={field} style={{ borderColor: LINE }}><span aria-hidden className="text-[18px]" style={{ color: MUTED }}>$</span>
              <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, '').slice(0, 9))} placeholder="0.00" className="min-w-0 flex-1 bg-transparent px-1 text-[20px] font-normal tabular-nums" style={{ color: INK, outline: 'none' }} /></span></label>
          <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>{k.what}
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 80))} placeholder={k.hint} autoComplete="off" className="mt-1 block min-h-[48px] w-full rounded-xl border px-3 text-[16px] font-normal outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
          {kind === 'out' && photo && <div className="text-[13px] font-semibold" style={{ color: MUTED }}>A photo of the receipt, if there is one<div className="mt-1">{photo(setReceiptUrl)}</div></div>}
          {now !== null && <div className="space-y-1 text-[14.5px]">
            <div className="flex justify-between" style={{ color: MUTED }}><span>In the drawer now</span><span className="tabular-nums">{usd(now / 100)}</span></div>
            {after !== null && <div className="flex justify-between font-semibold"><span>After</span><span className="tabular-nums" style={after < 0 ? { color: AMBER } : undefined}>{usd(after / 100)}</span></div>}
          </div>}
          {after !== null && after < 0 && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>That’s more than should be in the drawer. Count it, or take out less.</p>}
          {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
          <button type="submit" disabled={!ready || busy} className={`${btn} min-h-[52px] w-full text-[16px]`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : `${k.label}${cents > 0 ? ` ${usd(cents / 100)}` : ''}`}</button>
          <p className="text-[13px]" style={{ color: MUTED }}>A manager’s PIN. {kind === 'out' ? 'It’s an expense on the books (Supplies, paid in cash).' : kind === 'drop' ? 'It’s only off the drawer’s count, not an expense.' : 'It’s only on the drawer’s count.'} Each one is on the drawer’s count when it’s closed, and on the night report.</p>
          <div className="space-y-2 border-t pt-3" style={{ borderColor: LINE }}>
            {!noSale ? <button type="button" onClick={() => { setNoSale(true); setErr(''); }} className={`${btn} w-full`} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Open the drawer, no sale</button> : <>
              <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Open the drawer, no sale: why</p>
              <div role="radiogroup" aria-label="Why the drawer is opening" className="flex flex-wrap gap-2">
                {NO_SALE.map((r) => <button key={r} type="button" role="radio" aria-checked={!nsOther && nsWhy === r} onClick={() => { setNsOther(false); setNsWhy(r); }} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={!nsOther && nsWhy === r ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{r}</button>)}
                <button type="button" role="radio" aria-checked={nsOther} onClick={() => setNsOther(true)} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={nsOther ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>Something else</button>
              </div>
              {nsOther && <input value={nsTyped} onChange={(e) => setNsTyped(e.target.value.slice(0, 60))} placeholder="Swap a roll of coins" aria-label="Why, in a few words" className="block min-h-[48px] w-full rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} />}
              <button type="button" disabled={!nsReason || busy} onClick={() => void openIt()} className={`${btn} w-full`} style={{ background: INK, color: '#fff' }}>{busy ? 'Opening…' : 'Open the drawer'}</button>
              <p className="text-[13px]" style={{ color: MUTED }}>On the drawer’s record as yours, with why, and on the night report.</p>
            </>}
          </div>
          {!!view?.moves?.length && <div className="space-y-1 border-t pt-3" style={{ borderColor: LINE }}>
            <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Today</p>
            {view.moves.slice(0, 5).map((m: any, i: number) => <div key={m.key || i} className="flex items-center justify-between gap-3 text-[13.5px]" style={m.undone ? { color: MUTED } : undefined}>
              <span className="min-w-0 truncate">{m.kind === 'nosale' ? `No sale, by ${m.by || 'someone'}` : KINDS.find((x) => x.id === m.kind)?.label || 'Moved'}{m.note ? `: ${m.note}` : ''}{m.undone ? ', undone' : ''}</span>
              <span className="flex shrink-0 items-center gap-3">{m.kind !== 'nosale' && <span className="tabular-nums">{m.kind === 'in' ? '' : '−'}{usd(m.cents / 100)}</span>}
                {!m.undone && m.key && m.kind !== 'nosale' && <button type="button" onClick={() => setUndo(m)} className={`min-h-[44px] text-[13px] font-medium underline underline-offset-4 ${RING}`} style={{ color: MUTED }} aria-label={`Undo ${KINDS.find((x) => x.id === m.kind)?.label || 'it'} ${usd(m.cents / 100)}`}>Undo</button>}</span></div>)}
          </div>}
        </>}
      </form>
    </div>
    {undo && <PinPad title="A manager’s PIN" line={`Undo ${KINDS.find((x) => x.id === undo.kind)?.label || 'it'} ${usd(undo.cents / 100)}${undo.note ? `: ${undo.note}` : ''}.${undo.kind === 'out' ? ' Its expense comes off the books.' : ''}`} onClose={() => setUndo(null)} onDone={() => setUndo(null)}
      check={async (p) => { const d = await call({ action: 'drawerUndo', moveKey: undo.key, pin: p }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
        if (!d?.ok) return { ok: false as const, error: d?.error || 'That didn’t go through. Try again.' }; onDone(`${d.words} ${usd(d.cents / 100)} undone.`); return { ok: true as const, staff: { id: '', name: '', pass: '' } }; }} />}
    {pin && <PinPad title="A manager’s PIN" line={`${k.label} ${usd(cents / 100)}. It doesn’t change who’s signed in here.`} onClose={() => setPin(false)} onDone={() => setPin(false)}
      check={async (p) => { const d = await call({ ...body, pin: p }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
        if (!d?.ok) return { ok: false as const, error: d?.error || 'That didn’t go through. Try again.' }; onDone(words(d)); return { ok: true as const, staff: { id: '', name: '', pass: '' } }; }} />}
  </>);
}
