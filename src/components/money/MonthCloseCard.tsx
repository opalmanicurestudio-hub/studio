'use client';
// src/components/money/MonthCloseCard.tsx — CLOSING A MONTH, on the Money page (design board "Closing a month",
// option A; api/money/close, lib/books-close-server). The month to close next with what's still open in it (each with
// the way to it), its figures as it closes, and Close; the months around it, closed or open; the owner can reopen the
// last one closed, with a reason. Closing with something still open is allowed: the list says what it is. Managers.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Check = { id: string; ok: boolean; info?: boolean; title: string; detail: string; href?: string };
type View = { month: string; label: string; ended: boolean; closed: boolean; checks: Check[]; figures: { netSales: number; costs: number; profit: number } };
type Month = { month: string; label: string; current: boolean; closed: boolean; at: string | null; by: string | null };

async function api(body: any) {
  try {
    const r = await fetch('/api/money/close', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false, error: 'No answer. Try again.' }));
  } catch { return { ok: false, error: 'No connection. Try again.' }; }
}

function Mark({ c }: { c: Check }) {
  if (c.ok) return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></svg>;
  if (c.info) return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" aria-hidden="true" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="9" /></svg>;
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>;
}

export function MonthCloseCard({ tenantId }: { tenantId: string }) {
  const [d, setD] = React.useState<{ view: View; months: Month[]; through: string | null; canReopen: boolean } | null>(null);
  const [open, setOpen] = React.useState(false); const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null); const [done, setDone] = React.useState<string | null>(null);
  const [reopening, setReopening] = React.useState(false); const [why, setWhy] = React.useState('');
  const load = React.useCallback(async () => {
    const r = await api({ tenantId, action: 'view' });
    if (r?.ok) setD({ view: r.view, months: r.months, through: r.through, canReopen: !!r.canReopen });
  }, [tenantId]);
  React.useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const v = d.view; const toClose = v.ended && !v.closed;
  const lastClosed = d.months.find((m) => m.closed) || null;
  if (!toClose && !lastClosed) return null;
  const waiting = v.checks.filter((c) => !c.ok && !c.info).length;
  const close = async () => {
    setBusy(true); setErr(null); const r = await api({ tenantId, action: 'close', month: v.month }); setBusy(false);
    if (r?.ok) { setDone(`${v.label} is closed. Nothing dated in it can change now.`); setOpen(false); load(); } else setErr(r?.error || 'That didn’t go through. Try again.');
  };
  const reopen = async () => {
    setBusy(true); setErr(null); const r = await api({ tenantId, action: 'reopen', reason: why }); setBusy(false);
    if (r?.ok) { setDone('Reopened. It’s kept on the record, with your reason.'); setReopening(false); setWhy(''); load(); } else setErr(r?.error || 'That didn’t go through. Try again.');
  };
  return (
    <section aria-labelledby="close-h" className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}`, color: INK }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="close-h" className="text-[16px] font-semibold">{toClose ? `Close ${v.label}` : `${lastClosed!.label} is closed`}</h2>
          <p className="text-[14px]" style={{ color: toClose && waiting ? AMBER : MUTED }}>
            {toClose ? (waiting ? `${waiting} thing${waiting === 1 ? '' : 's'} still open in it` : 'Everything in it is sorted. Ready to close')
              : `Closed${lastClosed!.at ? ` ${new Date(lastClosed!.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : ''}${lastClosed!.by ? ` by ${lastClosed!.by}` : ''}. Nothing dated in it can change.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {toClose && <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`min-h-[44px] rounded-full bg-[#fff] px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>{open ? 'Hide' : 'Review and close'}</button>}
          {!toClose && d.canReopen && !reopening && <button type="button" onClick={() => setReopening(true)} className={`min-h-[44px] rounded-full bg-[#fff] px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>Reopen {lastClosed!.label}</button>}
        </div>
      </div>
      {done && <p role="status" className="mt-2 text-[14px] font-medium" style={{ color: GREEN }}>{done}</p>}
      {err && <p role="alert" className="mt-2 text-[14px] font-medium" style={{ color: AMBER }}>{err}</p>}

      {open && toClose && (
        <div className="mt-4 space-y-4">
          <p className="max-w-[640px] text-[14px]" style={{ color: MUTED }}>Once {v.label} is closed, nothing dated in it can change, so the figures you filed and gave your accountant stay as they were. A correction goes in on the day it’s made.</p>
          <div>
            {v.checks.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5" style={{ borderTop: `1px solid ${LINE}`, minHeight: 60 }}>
                <div className="flex min-w-0 gap-3"><Mark c={c} />
                  <div className="min-w-0"><p className="text-[15px] font-medium">{c.title}</p><p className="text-[13px]" style={{ color: !c.ok && !c.info ? AMBER : MUTED }}>{c.detail}</p></div></div>
                {!c.ok && c.href && <a href={c.href} className={`inline-flex min-h-[44px] items-center rounded-full bg-[#fff] px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}>Go to it</a>}
              </div>
            ))}
          </div>
          <div className="rounded-2xl px-4 py-1" style={{ background: SOFT }}>
            <div className="flex min-h-[44px] items-center justify-between"><span>Net sales</span><span className="tabular-nums">{money(v.figures.netSales)}</span></div>
            <div className="flex min-h-[44px] items-center justify-between" style={{ borderTop: `1px solid ${LINE}` }}><span>Costs</span><span className="tabular-nums">{money(-v.figures.costs)}</span></div>
            <div className="flex min-h-[44px] items-center justify-between font-semibold" style={{ borderTop: `1px solid ${LINE}` }}><span>Profit</span><span className="tabular-nums">{money(v.figures.profit)}</span></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={close} disabled={busy} className={`min-h-[48px] rounded-full px-6 text-[15px] font-semibold text-[#fff] disabled:opacity-50 ${RING}`} style={{ background: INK }}>{busy ? 'Closing' : `Close ${v.label}`}</button>
            <p className="max-w-[520px] text-[13px]" style={{ color: MUTED }}>You can close it with something still open. The owner can reopen it, and that’s kept on the record.</p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {d.months.map((m) => (
              <span key={m.month} className="rounded-full px-3 py-1.5 text-[13px]" style={m.closed ? { background: '#ecf6f0', color: GREEN } : { background: SOFT, color: MUTED }}>
                {m.label}: {m.closed ? 'closed' : m.current ? 'open, this month' : m.month === v.month ? 'ready to close' : 'open'}
              </span>
            ))}
          </div>
        </div>
      )}

      {reopening && (
        <div className="mt-4 space-y-2">
          <label className="block text-[14px] font-medium" htmlFor="reopen-why">Why is {lastClosed!.label} being reopened?</label>
          <input id="reopen-why" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="A bill dated in it came in late" maxLength={300}
            className={`h-11 w-full max-w-[520px] rounded-xl px-3 text-[15px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={reopen} disabled={busy || why.trim().length < 3} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold text-[#fff] disabled:opacity-50 ${RING}`} style={{ background: INK }}>Reopen it</button>
            <button type="button" onClick={() => { setReopening(false); setWhy(''); }} className={`min-h-[44px] rounded-full px-3 text-[14px] ${RING}`} style={{ color: MUTED }}>Cancel</button>
          </div>
          <p className="text-[13px]" style={{ color: MUTED }}>Lines dated in it can change again until it’s closed again. Close it once the change is made.</p>
        </div>
      )}
    </section>
  );
}
