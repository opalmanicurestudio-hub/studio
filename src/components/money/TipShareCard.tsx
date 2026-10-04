'use client';
// src/components/money/TipShareCard.tsx — TIP SHARING on the Money overview (tip-out / pool businesses): pick a period,
// see how it splits (who earned what, hours, each share, what moved), fix anything, then Approve — payroll pays the
// approved shares. Everyone involved sees their own line in their portal.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import Link from 'next/link';
const money = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
async function post(body: any) { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || ''; return fetch('/api/tips/share', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false })); }
export function TipShareCard({ tenantId, mode, period }: { tenantId: string; mode: string; period: 'day' | 'week' }) {
  const today = new Date(); const startDefault = new Date(today); if (period === 'week') startDefault.setDate(today.getDate() - 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [start, setStart] = React.useState(iso(startDefault)); const [end, setEnd] = React.useState(iso(today)); const [d, setD] = React.useState<any>(null); const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { setBusy(true); const r = await post({ tenantId, action: 'preview', start: `${start}T00:00:00.000Z`, end: `${end}T23:59:59.999Z` }); setBusy(false); setD(r?.ok ? r : null); }, [tenantId, start, end]);
  React.useEffect(() => { void load(); }, [load]);
  if (mode === 'direct') return null;
  const muted = { color: 'var(--muted, #78716c)' }; const ipt = { borderColor: 'var(--line, #e7e2dc)' } as any;
  return (
    <section className="space-y-3 rounded-3xl p-5" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }} aria-label="Tip sharing">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-[15px] font-semibold">Tip sharing — {mode === 'pool' ? 'pool' : 'tip-outs'}</h2><Link href="/settings?tab=policies" className="text-[13px] font-semibold underline underline-offset-2">Settings</Link></div>
      <div className="flex flex-wrap items-center gap-2 text-[14px]"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="From" className="h-10 rounded-xl border px-2" style={ipt} /><span>to</span><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="To" className="h-10 rounded-xl border px-2" style={ipt} /></div>
      {busy && !d ? <p className="text-[14px]" style={muted}>Working it out…</p> : d ? (<>
        <p className="text-[14px]"><b>{money(d.totalCents)}</b> in tips{d.feeCents ? ` (after ${money(d.feeCents)} card fees)` : ''} · {d.rows.filter((r: any) => !r.note).length} people{d.existing === 'approved' ? ' · approved' : ''}</p>
        {(d.warnings || []).map((w: string, i: number) => <p key={i} className="text-[13px] font-semibold" style={{ color: 'var(--warn, #b45309)' }}>{w}</p>)}
        <div className="divide-y text-[14px]" style={{ borderColor: 'var(--line)' }}>{d.rows.map((r: any) => (
          <div key={r.staffId} className="flex flex-wrap items-center justify-between gap-2 py-2" style={r.note ? muted : undefined}>
            <span><b>{r.name}</b> <span style={muted}>· {r.role.replace('_', ' ')}{r.hours ? ` · ${r.hours} h` : ''}{r.note ? ` · ${r.note}` : ''}</span></span>
            <span className="text-right"><b>{money(r.shareCents)}</b> <span style={muted}>{r.earnedCents !== r.shareCents && !r.note ? `(took ${money(r.earnedCents)}${r.inCents ? `, +${money(r.inCents)}` : ''}${r.outCents ? `, −${money(r.outCents)}` : ''})` : ''}</span></span>
          </div>))}</div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" disabled={busy || d.existing === 'approved'} onClick={async () => { setBusy(true); const r = await post({ tenantId, action: 'approve', start: `${start}T00:00:00.000Z`, end: `${end}T23:59:59.999Z` }); setBusy(false); if (r?.ok) await load(); }} className="h-11 rounded-full px-5 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{d.existing === 'approved' ? 'Approved' : 'Approve this period'}</button>
          <span className="text-[13px]" style={muted}>Payroll pays approved shares. Everyone sees their own line in their portal.</span>
        </div>
      </>) : <p className="text-[14px]" style={muted}>Couldn’t work it out — try again.</p>}
    </section>);
}
