'use client';
// src/components/drive-thru/CaughtTab.tsx — CAUGHT BEFORE IT WENT, on Drive-thru live (design board "The extras in the
// bag, and what got caught"; api/drive-live 'caught'; lib/bag-caught). What the check before an order to go caught,
// today or over 7 or 30 days, by shift: orders to go, wrong items caught (a bag or sticker from another order scanned),
// orders held for something missing, those let go with a manager's PIN, and those whose labels or stickers had no code.
// Then what was most often missing when someone tried to hand it over, and why each PIN was used (and who okayed it,
// for a manager). Read when it opens and when the days change; nothing here changes an order.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SPEED_RANGES, type SpeedRange } from '@/lib/speed';
import type { CaughtReport } from '@/lib/bag-caught';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = 'var(--warn-ink)';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const COLS: { k: 'orders' | 'wrong' | 'held' | 'skipped' | 'noCode'; label: string }[] = [
  { k: 'orders', label: 'Orders to go' }, { k: 'wrong', label: 'Wrong item caught' }, { k: 'held', label: 'Held, something missing' }, { k: 'skipped', label: 'Let go with a PIN' }, { k: 'noCode', label: 'Went without a code' },
];
const when = (r: SpeedRange) => (r === 'today' ? 'today' : `in the last ${r} days`);

export function CaughtTab({ tenantId, ask }: { tenantId: string; ask: () => { locationId?: string } }) {
  const [range, setRange] = useState<SpeedRange>('today');
  const [data, setData] = useState<{ report: CaughtReport & { capped?: boolean }; manager: boolean; scanOn: boolean } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/drive-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'caught', range, ...ask() }) });
      const d = await r.json().catch(() => ({ ok: false }));
      if (d.ok) { setData(d); setErr(''); } else setErr(d.error || 'That didn’t load. Try again.');
    } catch { setErr('No connection. Try again.'); }
    setBusy(false);
  }, [tenantId, range, ask]);
  useEffect(() => { void load(); }, [load]);
  const rep = data?.report;
  const top = rep?.missing[0]?.n || 1;
  const chip = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK });
  return (
    <div className="space-y-4">
      <p className="max-w-[760px] text-[15px]" style={{ color: MUTED }}>What the check before an order to go caught, by shift: a bag or sticker from another order, something still to go in, or an order let go with a manager’s PIN.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Which days">
        {SPEED_RANGES.map((r) => <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={chip(range === r.id)}>{r.label}</button>)}
      </div>
      {err && <p role="alert" className="text-[14.5px]" style={{ color: AMBER }}>{err}</p>}
      {data && !data.scanOn && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT }}>Bags aren’t scanned before they’re handed over, so nothing is held. Turn it on in the <Link href="/menu" className="font-semibold underline underline-offset-4">Menu page’s</Link> settings.</p>}
      {!rep && <p className="text-[14.5px]" style={{ color: MUTED }}>{busy ? 'Adding it up…' : ''}</p>}
      {rep && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]" aria-busy={busy}>
          <section aria-labelledby="caught-shifts" className="min-w-0 space-y-3 rounded-3xl border p-4" style={{ background: '#fff', borderColor: LINE }}>
            <h2 id="caught-shifts" className="text-[13px] font-semibold" style={{ color: MUTED }}>Caught before it went, by shift</h2>
            {!rep.total.orders ? <p className="text-[14.5px]" style={{ color: MUTED }}>No orders to go were handed over {when(range)} yet.</p> : (<>
              <ul className="space-y-2 sm:hidden" aria-label={`Caught before it went, ${when(range)}, by shift`}>
                {[...rep.shifts, ...(rep.shifts.length > 1 ? [rep.total] : [])].map((s) => (
                  <li key={s.id} className="rounded-2xl p-3" style={{ background: SOFT }}>
                    <p className="text-[15px] font-semibold">{s.name}</p>
                    <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[14px] tabular-nums">
                      {COLS.map((c) => <div key={c.k} className="contents"><dt style={{ color: MUTED }}>{c.label}</dt><dd className="text-right font-semibold">{s[c.k]}</dd></div>)}
                    </dl>
                  </li>))}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[560px] border-collapse text-[14px] tabular-nums">
                  <caption className="sr-only">Caught before it went, {when(range)}, by shift</caption>
                  <thead><tr>
                    <th scope="col" className="py-2 pr-3 text-left text-[12.5px] font-semibold" style={{ color: MUTED, borderBottom: `1px solid ${LINE}` }}>Shift</th>
                    {COLS.map((c) => <th key={c.k} scope="col" className="px-2 py-2 text-right text-[12.5px] font-semibold" style={{ color: MUTED, borderBottom: `1px solid ${LINE}` }}>{c.label}</th>)}
                  </tr></thead>
                  <tbody>
                    {[...rep.shifts, ...(rep.shifts.length > 1 ? [rep.total] : [])].map((s) => (
                      <tr key={s.id}>
                        <th scope="row" className={`py-2.5 pr-3 text-left ${s.id === 'all' ? 'font-semibold' : 'font-medium'}`} style={{ borderBottom: `1px solid ${LINE}` }}>{s.name}</th>
                        {COLS.map((c) => <td key={c.k} className={`px-2 py-2.5 text-right ${c.k === 'orders' || s.id === 'all' ? 'font-semibold' : ''}`} style={{ borderBottom: `1px solid ${LINE}` }}>{s[c.k]}</td>)}
                      </tr>))}
                  </tbody>
                </table>
              </div>
            </>)}
            {rep.skips.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-[13.5px] font-semibold">Let go with a PIN</h3>
                <ul className="space-y-0.5 text-[14px]">
                  {rep.skips.map((x, i) => <li key={i}><b className="font-semibold tabular-nums">{x.n}</b> {x.reason.charAt(0).toLowerCase() + x.reason.slice(1)}{x.by ? `, okayed by ${x.by}` : ''}</li>)}
                </ul>
              </div>)}
            {(rep.noCode.labels > 0 || rep.noCode.stickers > 0) && (
              <p className="text-[14px]" style={{ color: MUTED }}>Went without a code: {[rep.noCode.labels ? `${rep.noCode.labels} ${rep.noCode.labels === 1 ? 'order’s bag labels' : 'orders’ bag labels'}` : '', rep.noCode.stickers ? `${rep.noCode.stickers} item ${rep.noCode.stickers === 1 ? 'sticker' : 'stickers'}` : ''].filter(Boolean).join(' and ')} printed in words only, so they couldn’t be scanned. A printer that prints in the app’s look prints codes (<Link href="/settings/printers" className="font-semibold underline underline-offset-4" style={{ color: INK }}>Settings, Printers</Link>).</p>)}
            {rep.capped && <p className="text-[13.5px]" style={{ color: MUTED }}>So many orders that only the newest are counted here.</p>}
          </section>
          <section aria-labelledby="caught-missing" className="min-w-0 space-y-3 rounded-3xl border p-4" style={{ background: '#fff', borderColor: LINE }}>
            <h2 id="caught-missing" className="text-[13px] font-semibold" style={{ color: MUTED }}>Most often missing when someone tried to hand it over</h2>
            {!rep.missing.length ? <p className="text-[14.5px]" style={{ color: MUTED }}>Nothing was missing at a handover {when(range)}.</p> : (
              <ul className="space-y-2.5">
                {rep.missing.map((m) => (
                  <li key={m.name} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 text-[14.5px]">
                    <span className="truncate" title={m.name}>{m.name}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="h-2 rounded-r-[4px]" style={{ width: `${Math.max(6, Math.round((m.n / top) * 100))}%`, maxWidth: 'calc(100% - 2.5rem)', background: INK }} />
                      <span className="font-semibold tabular-nums">{m.n}<span className="sr-only"> {m.n === 1 ? 'order' : 'orders'}</span></span>
                    </span>
                  </li>))}
              </ul>)}
            <p className="text-[13.5px]" style={{ color: MUTED }}>Over the same days. Each order counts an item once, however many times someone tried. A bag or sticker from another order scanned by mistake counts once as a wrong item caught, on the order being handed over (for a car, its own order).</p>
          </section>
        </div>)}
    </div>);
}
