'use client';
// src/components/products/StoreStockPanel.tsx — AT EACH STORE, on a product's page (design board "Stock at each store, and
// tonight's counts at each location"; lib/store-stock, api/inventory/stores). Only with more than one location: what each
// store has, the total, and what isn't at a store yet; a count at a store, a move between stores, and, once every store
// is counted, what wasn't found taken off the total.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import type { StoreStockView } from '@/lib/store-stock';
import { Btn, C, Sheet, muted } from '@/components/orders/ui';

type View = StoreStockView;
async function call(body: any): Promise<any> {
  try {
    const r = await fetch('/api/inventory/stores', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false, error: 'That didn’t save. Try again.' }));
  } catch { return { ok: false, error: 'That didn’t save. Check the connection and try again.' }; }
}

const field = 'h-12 w-full rounded-xl px-3 text-[16px] outline-none';
const boxStyle: React.CSSProperties = { border: `1px solid ${C.line}`, background: C.paper, color: C.ink };

export function StoreStockPanel({ tenantId, itemId, onChanged }: { tenantId: string; itemId: string; onChanged?: () => void }) {
  const [v, setV] = React.useState<View | null>(null); const [err, setErr] = React.useState('');
  const [open, setOpen] = React.useState<'count' | 'move' | null>(null); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { let on = true; void call({ tenantId, itemId, action: 'view' }).then((d) => { if (!on) return; if (d.ok) setV(d); else setErr(d.error || ''); }); return () => { on = false; }; }, [tenantId, itemId]);
  const done = (d: any) => { if (d.ok) { setV(d); setOpen(null); onChanged?.(); return null; } return String(d.error || 'That didn’t save. Try again.'); };
  const clear = async () => { setBusy(true); setErr(''); const d = await call({ tenantId, itemId, action: 'clear' }); setBusy(false); const e = done(d); if (e) setErr(e); };
  if (!v) return err ? null : <section className="h-40 rounded-2xl" style={{ background: C.paper, border: `1px solid ${C.line}` }} aria-busy="true" />;
  const allCounted = v.stores.every((s) => s.count !== null);
  return (
    <section className="rounded-2xl p-5" style={{ background: C.paper, border: `1px solid ${C.line}` }} aria-labelledby="at-stores">
      <h2 id="at-stores" className="m-0 mb-3 text-[17px] font-semibold">At each store</h2>
      <div className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]"><span>Total</span><span className="font-semibold tabular-nums">{v.total}</span></div>
      {v.stores.map((s) => (
        <div key={s.id} className="flex items-baseline justify-between gap-4 border-t py-2.5 text-[15px]" style={{ borderColor: C.line }}>
          <span>{s.name}</span><span className="tabular-nums" style={s.count === null ? muted : undefined}>{s.count === null ? 'Not counted yet' : s.count}</span>
        </div>))}
      <div className="flex items-baseline justify-between gap-4 border-t py-2.5 text-[15px]" style={{ borderColor: C.line, ...muted }}><span>Not at a store yet</span><span className="tabular-nums">{v.unplaced}</span></div>
      {!v.tracked && <p className="m-0 mt-1 text-[14px]" style={muted}>Count it at each store to keep each one’s own number. Until then, the shop sells it from every store as now.</p>}
      {v.tracked && v.stores.some((s) => s.count === null) && <p className="m-0 mt-1 text-[14px]" style={muted}>Until it’s counted at every store, the shop doesn’t offer it for pickup or delivery from the ones not counted yet.</p>}
      {v.short > 0 && <p className="m-0 mt-2 rounded-xl px-3 py-2 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>{v.short} sold or used without a store since the last count, so the stores add up to more than the total. Count again to place them.</p>}
      {allCounted && v.unplaced > 0 && (
        <p className="m-0 mt-2 text-[14px]" style={muted}>Every store is counted.{' '}
          <button type="button" disabled={busy} onClick={() => void clear()} className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2 disabled:opacity-50" style={{ color: C.ink }}>Take the {v.unplaced} not found off the total</button></p>)}
      {err && <p role="alert" className="m-0 mt-2 rounded-xl px-3 py-2 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      <div className="mt-3 flex gap-2">
        <Btn className="flex-1" onClick={() => { setErr(''); setOpen('count'); }}>Count at a store</Btn>
        <Btn className="flex-1" onClick={() => { setErr(''); setOpen('move'); }}>Move</Btn>
      </div>
      {open === 'count' && <CountAt v={v} onClose={() => setOpen(null)} save={async (at, n) => done(await call({ tenantId, itemId, action: 'count', at, counted: n }))} />}
      {open === 'move' && <MoveSheet v={v} onClose={() => setOpen(null)} save={async (from, to, qty) => done(await call({ tenantId, itemId, action: 'move', from, to, qty }))} />}
    </section>
  );
}

function CountAt({ v, onClose, save }: { v: View; onClose: () => void; save: (at: string, n: number) => Promise<string | null> }) {
  const [at, setAt] = React.useState(v.stores[0]?.id || ''); const [n, setN] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const s = v.stores.find((x) => x.id === at); const counted = n === '' ? NaN : Math.floor(Number(n));
  // (Starts on what the record says for the store picked, as a count of the whole shelf does.)
  React.useEffect(() => { const c = v.stores.find((x) => x.id === at)?.count; setN(c === null || c === undefined ? '' : String(c)); }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => { if (!Number.isFinite(counted) || busy) return; setBusy(true); setErr(''); const e = await save(at, counted); setBusy(false); if (e) setErr(e); };
  return (
    <Sheet title="Count at a store" onClose={onClose}>
      <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <div role="group" aria-label="Which store" className="flex flex-wrap gap-2">
          {v.stores.map((x) => <button key={x.id} type="button" aria-pressed={x.id === at} onClick={() => setAt(x.id)} className="min-h-[44px] rounded-xl px-4 text-[15px] font-semibold"
            style={x.id === at ? { background: C.ink, color: C.paper } : { background: C.paper, color: C.ink, border: `1px solid ${C.line}` }}>{x.name}</button>)}
        </div>
        <div>
          <label htmlFor="store-n" className="mb-1.5 block text-[13px] font-semibold" style={muted}>How many are there</label>
          <input id="store-n" inputMode="numeric" autoFocus value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, '').slice(0, 7))} className="h-14 w-full rounded-xl px-4 text-[24px] tabular-nums outline-none" style={boxStyle} />
        </div>
        <p className="m-0 text-[14px]" style={muted}>{s?.count === null || s?.count === undefined ? `Not counted at ${s?.name || 'this store'} yet: what you count comes from “Not at a store yet” (${v.unplaced}), and anything past that adds to the total.` : `The record says ${s.count} at ${s.name}.`}</p>
        {err && <p role="alert" className="m-0 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
        <Btn kind="primary" type="submit" className="w-full text-[17px]" disabled={!Number.isFinite(counted) || busy}>{busy ? 'Saving…' : 'Save the count'}</Btn>
      </form>
    </Sheet>
  );
}

function MoveSheet({ v, onClose, save }: { v: View; onClose: () => void; save: (from: string, to: string, qty: number) => Promise<string | null> }) {
  const places = [...v.stores.map((s) => ({ id: s.id, label: `${s.name}, ${s.count ?? 0}` })), { id: 'none', label: `Not at a store yet, ${v.unplaced}` }];
  const [from, setFrom] = React.useState(v.unplaced > 0 ? 'none' : v.stores.find((s) => (s.count ?? 0) > 0)?.id || v.stores[0]?.id || 'none');
  const [to, setTo] = React.useState(v.stores.find((s) => s.id !== from)?.id || 'none');
  const [n, setN] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const qty = n === '' ? NaN : Math.floor(Number(n));
  const go = async () => { if (!Number.isFinite(qty) || !qty || busy) return; setBusy(true); setErr(''); const e = await save(from, to, qty); setBusy(false); if (e) setErr(e); };
  return (
    <Sheet title="Move between stores" onClose={onClose}>
      <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <div><label htmlFor="move-from" className="mb-1.5 block text-[13px] font-semibold" style={muted}>From</label>
          <select id="move-from" value={from} onChange={(e) => setFrom(e.target.value)} className={field} style={boxStyle}>{places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        <div><label htmlFor="move-to" className="mb-1.5 block text-[13px] font-semibold" style={muted}>To</label>
          <select id="move-to" value={to} onChange={(e) => setTo(e.target.value)} className={field} style={boxStyle}>{places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        <div><label htmlFor="move-n" className="mb-1.5 block text-[13px] font-semibold" style={muted}>How many</label>
          <input id="move-n" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, '').slice(0, 7))} className="h-14 w-full rounded-xl px-4 text-[24px] tabular-nums outline-none" style={boxStyle} /></div>
        <p className="m-0 text-[14px]" style={muted}>The total stays the same. It’s kept in the stock history with your name.</p>
        {err && <p role="alert" className="m-0 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
        <Btn kind="primary" type="submit" className="w-full text-[17px]" disabled={!Number.isFinite(qty) || !qty || busy || from === to}>{busy ? 'Saving…' : Number.isFinite(qty) && qty ? `Move ${qty}` : 'Move'}</Btn>
      </form>
    </Sheet>
  );
}
