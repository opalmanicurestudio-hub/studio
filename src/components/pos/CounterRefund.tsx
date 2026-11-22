'use client';
// src/components/pos/CounterRefund.tsx — REFUND A PAID ORDER at the counter or the drive-thru (design board "Register
// tools", part 1; lib/counter-refund, lib/counter-refund-server). RefundFind: today's paid orders on this side, by
// number or name. RefundAsk: all of it or some items, the tip, where it goes back (the way it was paid), why, and a
// manager's PIN. `call` posts to the screen's own api/counter with its own key. White surfaces are set inline, so the
// app's black look (lib/app-theme) takes them over.
import { useEffect, useMemo, useState } from 'react';
import { PinPad } from '@/components/kitchen/PinPad';
import { REFUND_REASONS, backWords, type SourceKind } from '@/lib/counter-refund';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const dark = { background: INK, color: '#fff' } as const;
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;
const usd = (cents: number) => `$${(Math.round(Number(cents) || 0) / 100).toFixed(2)}`;
const field = `mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal outline-none focus:border-[#16171a]`;

export type PaidRow = { id: string; number: string; guestName: string | null; total: number; paidAt: string; refundCents: number; left: number; why: string | null; tipCents: number;
  lines: { lineId: string; name: string; quantity: number; unitPrice: number; choicesText: string | null; left: number }[] };
type Call = (body: any) => Promise<any>;
const timeOf = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; };

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={label} className="max-h-[92vh] w-full max-w-[560px] space-y-3 overflow-y-auto rounded-t-3xl p-4 sm:rounded-3xl" style={{ background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        {children}
      </div>
    </div>
  );
}

/** Today's paid orders on this side, to pick one to refund. */
export function RefundFind({ call, onClose, onDone }: { call: Call; onClose: () => void; onDone: (text: string) => void }) {
  const [rows, setRows] = useState<PaidRow[] | null>(null); const [err, setErr] = useState(''); const [q, setQ] = useState(''); const [pick, setPick] = useState<PaidRow | null>(null);
  useEffect(() => { let live = true; void call({ action: 'paidToday' }).then((d) => { if (!live) return; if (d?.ok) setRows(d.orders || []); else setErr(d?.error || 'Today’s orders couldn’t be read. Try again.'); }).catch(() => live && setErr('No connection. Try again.')); return () => { live = false; }; }, [call]);
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return (rows || []).filter((r) => !k || r.number.toLowerCase().includes(k) || String(r.guestName || '').toLowerCase().includes(k)); }, [rows, q]);
  if (pick) return <RefundAsk row={pick} call={call} onBack={() => setPick(null)} onClose={onClose} onDone={onDone} />;
  return (
    <Sheet label="Refund an order" onClose={onClose}>
      <div className="flex items-center justify-between gap-2"><p className="text-[19px] font-semibold">Refund an order</p>
        <button type="button" onClick={onClose} className={`${btn} text-[14px]`} style={{ color: MUTED }}>Close</button></div>
      <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Order number or name
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value.slice(0, 30))} placeholder="C15 or Jordan" autoComplete="off" className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
      {err ? <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>
        : rows === null ? <p className="text-[14px]" style={{ color: MUTED }}>Today’s paid orders…</p>
        : !shown.length ? <p className="text-[14px]" style={{ color: MUTED }}>{rows.length ? 'None match that.' : 'Nothing paid here today yet.'}</p>
        : <ul className="space-y-2">{shown.map((r) => (
          <li key={r.id}><button type="button" disabled={!!r.why} onClick={() => setPick(r)} className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left disabled:opacity-60 ${RING}`} style={{ background: SOFT }}>
            <span className="min-w-0"><span className="block truncate text-[15.5px] font-semibold">{r.number}{r.guestName ? `, ${r.guestName}` : ''}</span>
              <span className="block truncate text-[13px]" style={{ color: MUTED }}>{r.why || `Paid ${timeOf(r.paidAt)}${r.refundCents ? `, ${usd(r.refundCents)} refunded` : ''}`}</span></span>
            <span className="shrink-0 text-[15px] font-semibold tabular-nums">{usd(Math.round(r.total * 100))}</span></button></li>))}</ul>}
    </Sheet>
  );
}

type Preview = { plan: { cents: number; netCents: number; taxCents: number; tipCents: number }; back: { kind: SourceKind; cents: number; code?: string }[] };
/** A refund started on it that didn't finish (the card company didn't answer): finished first, as it was okayed. */
type Unfinished = { cents: number; reason: string; approvedBy: string; back: { kind: SourceKind; cents: number; code?: string }[] };

/** All of it or some items, the tip, where it goes back, why, and a manager's PIN. */
export function RefundAsk({ row, call, onBack, onClose, onDone }: { row: PaidRow; call: Call; onBack: () => void; onClose: () => void; onDone: (text: string) => void }) {
  const [mode, setMode] = useState<'all' | 'some'>('all');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [tip, setTip] = useState(true);
  const [reason, setReason] = useState(''); const [other, setOther] = useState(false);
  const [pv, setPv] = useState<Preview | null>(null); const [pvErr, setPvErr] = useState(''); const [resuming, setResuming] = useState<Unfinished | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [pin, setPin] = useState(false);
  const some = mode === 'some';
  const lines = row.lines.filter((l) => l.left > 0);
  const body = useMemo(() => ({ orderId: row.id, all: !some, lines: some ? Object.entries(qty).filter(([, n]) => n > 0).map(([lineId, n]) => ({ lineId, qty: n })) : [], tip: !some && row.tipCents > 0 ? tip : false }), [row, some, qty, tip]);
  useEffect(() => {
    if (some && !body.lines.length) { setPv(null); setPvErr(''); return; }
    let live = true; const t = setTimeout(() => {
      void call({ action: 'refundPreview', ...body, reason: 'preview' }).then((d) => { if (!live) return;
        if (d?.ok && d.resuming) { setResuming(d.resuming); setPv(null); setPvErr(''); }
        else if (d?.ok) { setPv({ plan: d.plan, back: d.back || [] }); setPvErr(''); } else { setPv(null); setPvErr(d?.error || 'That can’t be refunded.'); } }).catch(() => live && setPvErr('No connection. Try again.'));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [body, call, some]);
  const why = reason.trim();
  const done = (d: any) => {
    const cash = Number(d.cashCents) || 0; const mach = Number(d.machineCents) || 0;
    onDone(`${row.number}: ${usd(d.cents)} refunded${d.resumed ? ', the refund that didn’t finish' : d.approvedBy ? `, okayed by ${d.approvedBy}` : ''}.${cash ? ` Give ${usd(cash)} back in cash.` : ''}${mach ? ` Give ${usd(mach)} back on your card machine.` : ''}`);
  };
  // (Finishing one that didn't: as it was okayed; anything picked here waits until it's done.)
  const ask = resuming ? { action: 'refund', orderId: row.id, resume: true } : { action: 'refund', ...body, reason: why };
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const d = await call(ask);
      if (d?.ok) done(d); else if (d?.needsManager) setPin(true); else if (d?.unfinished) { setResuming(d.unfinished); setPv(null); } else setErr(d?.error || 'That didn’t go through. Try again.');
    } catch { setErr('No connection. Try again.'); } finally { setBusy(false); }
  };
  const seg = (on: boolean) => (on ? dark : quiet);
  const step = `flex h-[44px] w-[44px] items-center justify-center rounded-xl text-[20px] font-semibold disabled:opacity-40 ${RING}`;
  const machine = (pv?.back || []).filter((b) => b.kind === 'machine').reduce((n, b) => n + b.cents, 0);
  return (<>
    {resuming ? <Sheet label={`Refund ${row.number}`} onClose={onClose}>
      <p className="text-[19px] font-semibold">Refund {row.number}{row.guestName ? `, ${row.guestName}` : ''}</p>
      <div className="space-y-1 rounded-2xl p-3" style={{ background: SOFT }}>
        <p className="text-[14.5px] font-semibold">A {usd(resuming.cents)} refund didn’t finish</p>
        <p className="text-[13.5px]" style={{ color: MUTED }}>{resuming.approvedBy} okayed it{resuming.reason ? ` (${resuming.reason})` : ''}, and the card company didn’t answer. Finish it first: nothing is given back twice.</p>
        {resuming.back.map((b, i) => <div key={`${b.kind}-${i}`} className="flex justify-between pt-1 text-[14px]"><span>{backWords(b)}</span><span className="tabular-nums">{usd(b.cents)}</span></div>)}
      </div>
      {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
      <div className="flex gap-2"><button type="button" onClick={onBack} className={`${btn} flex-1`} style={quiet}>Back</button>
        <button type="button" disabled={busy} onClick={() => void go()} className={`${btn} flex-[2]`} style={dark}>Finish the refund</button></div>
    </Sheet> : <Sheet label={`Refund ${row.number}`} onClose={onClose}>
      <div className="flex items-baseline justify-between gap-2"><p className="text-[19px] font-semibold">Refund {row.number}{row.guestName ? `, ${row.guestName}` : ''}</p>
        <span className="text-[13.5px]" style={{ color: MUTED }}>Paid {timeOf(row.paidAt)}</span></div>
      <div role="radiogroup" aria-label="What to refund" className="grid grid-cols-2 gap-2">
        {([['all', 'All of it'], ['some', 'Some items']] as const).map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setTip(k === 'all'); }} className={btn} style={seg(mode === k)}>{label}</button>)}
      </div>
      <ul className="space-y-1">{lines.map((l) => { const n = qty[l.lineId] || 0; return (
        <li key={l.lineId} className="flex min-h-[44px] items-center justify-between gap-2">
          <span className="min-w-0"><span className="block truncate text-[14.5px]">{l.name}{l.left > 1 ? ` × ${l.left}` : ''}</span>{l.choicesText && <span className="block truncate text-[12.5px]" style={{ color: MUTED }}>{l.choicesText}</span>}</span>
          {some ? <span className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label={`One ${l.name} fewer`} disabled={n <= 0} onClick={() => setQty((m) => ({ ...m, [l.lineId]: Math.max(0, n - 1) }))} className={step} style={{ background: SOFT, color: INK }}>−</button>
            <span className="w-8 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">{n}</span>
            <button type="button" aria-label={`One ${l.name} more`} disabled={n >= l.left} onClick={() => setQty((m) => ({ ...m, [l.lineId]: Math.min(l.left, n + 1) }))} className={step} style={{ background: SOFT, color: INK }}>+</button></span>
          : <span className="shrink-0 text-[14.5px] tabular-nums">{usd(Math.round(l.unitPrice * l.left * 100))}</span>}
        </li>); })}</ul>
      {row.tipCents > 0 && !some && <label className="flex min-h-[44px] items-center gap-3 text-[14.5px]"><input type="checkbox" checked={tip} onChange={(e) => setTip(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Give the tip back too ({usd(row.tipCents)})</label>}
      <div className="space-y-1 rounded-2xl p-3" style={{ background: SOFT }}>
        {pvErr ? <p className="text-[13.5px]" style={{ color: AMBER }}>{pvErr}</p>
          : !pv ? <p className="text-[13.5px]" style={{ color: MUTED }}>{some ? 'Pick what to refund.' : 'Working it out…'}</p>
          : <>
            <div className="flex justify-between text-[14px]"><span>Items</span><span className="tabular-nums">{usd(pv.plan.netCents)}</span></div>
            {pv.plan.taxCents > 0 && <div className="flex justify-between text-[14px]" style={{ color: MUTED }}><span>Tax</span><span className="tabular-nums">{usd(pv.plan.taxCents)}</span></div>}
            {pv.plan.tipCents > 0 && <div className="flex justify-between text-[14px]"><span>Tip</span><span className="tabular-nums">{usd(pv.plan.tipCents)}</span></div>}
            <p className="pt-2 text-[12.5px] font-semibold" style={{ color: MUTED }}>Back the way it was paid</p>
            {pv.back.map((b, i) => <div key={`${b.kind}-${i}`} className="flex justify-between text-[14px]"><span>{backWords(b)}</span><span className="tabular-nums">{usd(b.cents)}</span></div>)}
            <div className="flex justify-between pt-1 text-[16px] font-semibold"><span>Refund</span><span className="tabular-nums">{usd(pv.plan.cents)}</span></div>
            {machine > 0 && <p className="text-[12.5px]" style={{ color: AMBER }}>{usd(machine)} was paid on another card machine: give it back on that machine too.</p>}
          </>}
      </div>
      <div role="radiogroup" aria-label="Why it’s refunded" className="flex flex-wrap gap-2">
        {REFUND_REASONS.map((x) => <button key={x} type="button" role="radio" aria-checked={!other && reason === x} onClick={() => { setOther(false); setReason(x); }} className={`${btn} px-3 text-[13.5px]`} style={seg(!other && reason === x)}>{x}</button>)}
        <button type="button" role="radio" aria-checked={other} onClick={() => { setOther(true); setReason(''); }} className={`${btn} px-3 text-[13.5px]`} style={seg(other)}>Another reason</button>
      </div>
      {other && <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Why
        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value.slice(0, 120))} placeholder="For the record" className={field} style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>}
      {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
      <div className="flex gap-2"><button type="button" onClick={onBack} className={`${btn} flex-1`} style={quiet}>Back</button>
        <button type="button" disabled={busy || !pv || !why} onClick={() => void go()} className={`${btn} flex-[2]`} style={dark}>{pv ? `Refund ${usd(pv.plan.cents)}` : 'Refund'}</button></div>
      <p className="text-[12.5px]" style={{ color: MUTED }}>A refund takes a manager’s PIN. It’s kept on record with why and who okayed it.</p>
    </Sheet>}
    {pin && (pv || resuming) && <PinPad title="A manager’s PIN" line={`${resuming ? `Finishing the ${usd(resuming.cents)}` : `A ${usd(pv!.plan.cents)}`} refund on ${row.number} takes a manager. It doesn’t change who’s signed in here.`} onClose={() => setPin(false)} onDone={() => setPin(false)}
      check={async (p) => { const d = await call({ ...ask, pin: p }).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
        if (!d?.ok) return { ok: false as const, error: d?.error || 'That didn’t go through. Try again.' }; done(d); return { ok: true as const, staff: { id: '', name: String(d.approvedBy || ''), pass: '' } }; }} />}
  </>);
}
