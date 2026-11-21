'use client';
// src/components/money/MilesCard.tsx — MILES DRIVEN on the Money page (api/drivers/miles; lib/mileage; design board "Sold
// out on the apps too, and every driver's miles kept"). Each driver's month from their odometer readings (a day without
// both counts its hot food trips), what's owed at the business's rate a mile, and the log to download. Shown once a
// driver has logged a day.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { mileageCsv, monthByDriver, type MileDay } from '@/lib/mileage';

const AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

export function MilesCard({ tenantId }: { tenantId: string }) {
  // (This month and last come from the server, by the business's own day; until then, the server's own choice.)
  const [months, setMonths] = React.useState<string[]>([]);
  const [month, setMonth] = React.useState('');
  const [d, setD] = React.useState<{ days: MileDay[]; rateCents: number | null } | null>(null);
  const [rate, setRate] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const call = React.useCallback(async (body: any) => {
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    return fetch('/api/drivers/miles', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, ...body }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
  }, [tenantId]);
  React.useEffect(() => { if (!tenantId) return; let on = true; void call({ action: 'month', ...(month ? { month } : {}) }).then((r) => { if (!on || !r?.ok) return; setD({ days: r.days || [], rateCents: r.rateCents ?? null }); setRate(r.rateCents ? (r.rateCents / 100).toFixed(2) : '');
    if (Array.isArray(r.months) && r.months.length) setMonths(r.months); if (!month && r.month) setMonth(r.month); }); return () => { on = false; }; }, [tenantId, month, call]);
  if (!d || !month || (!d.days.length && month === months[0] && !d.rateCents)) return null;
  const rows = monthByDriver(d.days, d.rateCents);
  const saveRate = async () => {
    const v = rate.trim(); const cents = v ? Math.round(Number(v.replace(/[^\d.]/g, '')) * 100) : null;
    if (v && (!Number.isFinite(cents as number) || (cents as number) < 1)) { setErr('Type the rate a mile, like 0.70.'); return; }
    if ((cents ?? null) === (d.rateCents ?? null)) return;
    setBusy(true); setErr('');
    const r = await call({ action: 'rate', cents });
    setBusy(false);
    if (r.ok) setD({ ...d, rateCents: r.rateCents ?? null }); else setErr(r.error || 'That didn’t save. Try again.');
  };
  const download = () => {
    const blob = new Blob([mileageCsv(d.days)], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `miles-${month}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const muted = { color: 'hsl(var(--muted-foreground))' }; const line = '1px solid var(--line, hsl(var(--border)))';
  return (
    <section className="space-y-3 rounded-3xl p-5" style={{ background: 'hsl(var(--card))', border: line }} aria-labelledby="miles-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="miles-title" className="text-[15px] font-semibold">Miles driven, {monthName(month)}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="miles-month">Which month</label>
          <select id="miles-month" value={month} onChange={(e) => setMonth(e.target.value)} className={`min-h-[44px] rounded-xl px-3 text-[14px] ${RING}`} style={{ border: line, background: 'transparent' }}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
          <button type="button" disabled={!d.days.length} onClick={download} className={`min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-40 ${RING}`} style={{ border: line }}>Download the log</button>
        </div>
      </div>
      {rows.length ? <table className="w-full text-[14px]">
        <thead><tr className="text-left text-[12.5px]" style={muted}><th className="py-1 font-semibold">Driver</th><th className="py-1 text-right font-semibold">Days</th><th className="py-1 text-right font-semibold">Miles</th>{d.rateCents ? <th className="py-1 text-right font-semibold">At {usd(d.rateCents)} a mile</th> : null}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.driverId}><td className="py-1.5">{r.name}{r.missing > 0 && <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{r.missing} {r.missing === 1 ? 'day' : 'days'} without readings</span>}
            {r.toCheck > 0 && <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{r.toCheck} {r.toCheck === 1 ? 'day' : 'days'} to check</span>}
            {r.edited > 0 && <span className="ml-2 inline-block text-[12px]" style={muted}>{r.edited === 1 ? 'a reading changed' : `${r.edited} days with a reading changed`}</span>}</td>
            <td className="py-1.5 text-right tabular-nums">{r.days}</td><td className="py-1.5 text-right tabular-nums">{r.miles.toLocaleString('en-US')}</td>{d.rateCents ? <td className="py-1.5 text-right tabular-nums">{usd(r.owedCents || 0)}</td> : null}</tr>))}</tbody>
      </table> : <p className="text-[14px]" style={muted}>No miles logged in {monthName(month)}.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="miles-rate" className="text-[14px] font-semibold">You pay back</label>
        <span className="text-[14px]">$</span>
        <input id="miles-rate" value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))} onBlur={() => void saveRate()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveRate(); } }} disabled={busy}
          placeholder="0.70" className={`min-h-[44px] w-[90px] rounded-xl px-3 text-[15px] ${RING}`} style={{ border: line, background: 'transparent' }} />
        <span className="text-[14px]">a mile</span>
      </div>
      <p className="text-[12.5px]" style={muted}>From each driver’s odometer at the start and end of the day, on the staff app’s Deliveries tab. A day without both readings counts its hot food trips there and back, from the map. A day to check is one whose readings come to far more than its trips. Leave the rate empty to keep the miles only.</p>
      {err && <p role="alert" className="text-[13.5px] font-medium" style={{ color: AMBER }}>{err}</p>}
    </section>);
}
