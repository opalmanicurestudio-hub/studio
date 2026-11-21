'use client';
// src/components/money/AppPayoutsCard.tsx — DELIVERY APP PAYOUTS on the Money page (api/apps/payouts; lib/app-payouts-
// server; design board "App orders in the books at the app's price"). Each app's weeks, newest first: its orders, what
// should come in (the app's price, less its share), and what did. A payout that doesn't match can have its difference
// booked once as an app adjustment. Shown once there's an app order picked up in the last few weeks.
import * as React from 'react';
import { getAuth } from 'firebase/auth';

const GREEN = '#1f7a4d', AMBER = '#b45309', GREEN_TINT = '#ecf6f0', AMBER_TINT = '#fff7ed', SOFT = '#f5f5f7';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const usd = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Week = { app: string; label: string; week: string; weekEnd: string; orders: number; payoutCents: number; feeCents: number; paidCents: number | null; diffCents: number | null;
  status: 'open' | 'waiting' | 'matches' | 'short' | 'over'; adjustedCents: number | null };

/** "Nov 10 to 16", or "Oct 27 to Nov 2". */
function range(from: string, to: string) {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  const m = (x: Date) => x.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const a = d(from), b = d(to);
  return `${m(a)} ${a.getUTCDate()} to ${m(a) === m(b) ? '' : `${m(b)} `}${b.getUTCDate()}`;
}

export function AppPayoutsCard({ tenantId }: { tenantId: string }) {
  const [weeks, setWeeks] = React.useState<Week[] | null>(null); const [needsShare, setNeedsShare] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const [typed, setTyped] = React.useState<Record<string, string>>({}); const [editing, setEditing] = React.useState<string | null>(null);
  const call = React.useCallback(async (body: any) => {
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    return fetch('/api/apps/payouts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, ...body }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
  }, [tenantId]);
  React.useEffect(() => { if (!tenantId) return; let on = true; void call({ action: 'list' }).then((d) => { if (on) { setWeeks(d?.ok ? d.weeks : null); setNeedsShare(d?.ok && Array.isArray(d.needsShare) ? d.needsShare : []); } }); return () => { on = false; }; }, [tenantId, call]);
  if (!weeks || (!weeks.length && !needsShare.length)) return null;
  const keyOf = (w: Week) => `${w.app}_${w.week}`;
  const put = (w: Week) => setWeeks((l) => (l || []).map((x) => (keyOf(x) === keyOf(w) ? w : x)));
  const paid = async (w: Week) => {
    const v = Number(String(typed[keyOf(w)] || '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(v) || !String(typed[keyOf(w)] || '').trim()) { setErr('Type what came in, in dollars.'); return; }
    setBusy(keyOf(w)); setErr('');
    const d = await call({ action: 'paid', app: w.app, week: w.week, cents: Math.round(v * 100) });
    setBusy('');
    if (d.ok) { put(d.week); setEditing(null); } else setErr(d.error || 'That didn’t save. Try again.');
  };
  const adjust = async (w: Week) => {
    setBusy(keyOf(w)); setErr('');
    const d = await call({ action: 'adjust', app: w.app, week: w.week });
    setBusy('');
    if (d.ok) put(d.week); else setErr(d.error || 'That didn’t go through. Try again.');
  };
  const muted = { color: 'hsl(var(--muted-foreground))' };
  const chip = (w: Week) => w.status === 'matches' ? { text: 'Matches', style: { background: GREEN_TINT, color: GREEN } }
    : w.status === 'short' ? { text: `${usd(w.diffCents || 0)} short`, style: { background: AMBER_TINT, color: AMBER } }
    : w.status === 'over' ? { text: `${usd(w.diffCents || 0)} over`, style: { background: AMBER_TINT, color: AMBER } }
    : w.status === 'open' ? { text: 'This week so far', style: { background: SOFT, color: 'inherit' } }
    : { text: 'Waiting', style: { background: SOFT, color: 'inherit' } };
  return (
    <section className="space-y-3 rounded-3xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid var(--line, hsl(var(--border)))' }} aria-labelledby="app-payouts-title">
      <div>
        <h2 id="app-payouts-title" className="text-[15px] font-semibold">App payouts</h2>
        <p className="text-[13.5px]" style={muted}>What each delivery app should pay you each week: its orders at the app’s price, less its share. Enter what came in to check it. A refund the app gave a guest comes out of its payout, so it shows as short.</p>
      </div>
      {needsShare.length > 0 && <p className="text-[13.5px]" style={muted}>To check {needsShare.join(' and ')}’s payouts, set what {needsShare.length === 1 ? 'it keeps' : 'each keeps'} on the Menu page, under Delivery apps.</p>}
      <ul className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {weeks.map((w) => { const k = keyOf(w); const c = chip(w); const asking = w.status === 'waiting' || editing === k; return (
          <li key={k} className="space-y-1.5 rounded-2xl p-3.5" style={{ border: '1px solid var(--line, hsl(var(--border)))' }}>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[15px] font-semibold">{w.label}, {range(w.week, w.weekEnd)}</p><span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={c.style}>{c.text}</span></div>
            <p className="flex justify-between gap-3 text-[13.5px]"><span>{w.orders} {w.orders === 1 ? 'order' : 'orders'}{w.feeCents ? `, less ${w.label}’s share` : ''}</span><span className="tabular-nums">{usd(w.payoutCents)}</span></p>
            {w.paidCents !== null && editing !== k && <p className="flex justify-between gap-3 text-[13.5px]"><span>Paid</span><span className="tabular-nums">{usd(w.paidCents)}</span></p>}
            {(w.status === 'short' || w.status === 'over') && w.adjustedCents === null && editing !== k && <>
              <p className="text-[13px]" style={muted}>Check {w.label}’s statement for a refund or an adjustment.</p>
              <button type="button" disabled={!!busy} onClick={() => adjust(w)} className={`min-h-[44px] w-full rounded-xl px-3 text-[14px] font-semibold disabled:opacity-40 ${RING}`} style={{ border: '1px solid var(--line, hsl(var(--border)))' }}>Book {usd(w.diffCents || 0)} as an app adjustment</button></>}
            {w.adjustedCents !== null && <p className="text-[13px]" style={muted}>The {usd(w.adjustedCents)} difference is booked as an app adjustment.</p>}
            {asking && w.status !== 'open' && w.adjustedCents === null && <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`payout-${k}`}>What {w.label} paid for the week of {range(w.week, w.weekEnd)}</label>
              <span className="text-[14px]">$</span>
              <input id={`payout-${k}`} value={typed[k] ?? (w.paidCents !== null ? (w.paidCents / 100).toFixed(2) : '')} inputMode="decimal" onChange={(e) => setTyped((t) => ({ ...t, [k]: e.target.value.replace(/[^\d.]/g, '').slice(0, 10) }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void paid(w); } }} placeholder="What came in" className={`min-h-[44px] min-w-0 flex-1 rounded-xl px-3 text-[15px] ${RING}`} style={{ border: '1px solid var(--line, hsl(var(--border)))', background: 'transparent' }} />
              <button type="button" disabled={!!busy} onClick={() => paid(w)} className={`min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-40 ${RING}`} style={{ background: '#16171a', color: '#fff' }}>Check it</button>
            </div>}
            {w.paidCents !== null && w.adjustedCents === null && editing !== k && <button type="button" onClick={() => setEditing(k)} className={`min-h-[44px] text-[13px] font-semibold underline underline-offset-4 ${RING}`}>Change what came in</button>}
          </li>); })}
      </ul>
      {err && <p role="alert" className="text-[13.5px] font-medium" style={{ color: AMBER }}>{err}</p>}
    </section>);
}
