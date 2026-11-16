'use client';
// src/components/visit/DeclareTips.tsx — "CASH TIPS" in the staff portal's pay tab (lib/records; api/records 'mine' and
// 'declare'). Anyone who gets $20 or more in cash tips in a month reports all their tips to the business in writing, by
// the 10th of the next month: here, for this month and last, with what the till has of their cash as a start, what they
// paid out to others, and their typed name as a signature. The business keeps the signed copy (on Records). Shown only
// to someone who took tips (or declared before).
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { cleanDollars, monthWords } from '@/lib/records';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const md = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(iso.length === 10 ? { timeZone: 'UTC' } : {}) });
type Month = { month: string; by: string; recordedCashCents: number; took: boolean; declared: { cashCents: number; paidOutCents: number; signedName: string; signedAt: string } | null };

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

export function DeclareTips({ tenantId }: { tenantId: string }) {
  const [d, setD] = React.useState<{ name: string; months: Month[] } | null>(null);
  const [form, setForm] = React.useState<{ month: string; cash: string; paidOut: string; sign: string } | null>(null);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [said, setSaid] = React.useState('');
  const load = React.useCallback(async () => { const r = await post({ tenantId, action: 'mine' }); if (r.ok) setD(r); }, [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  if (!d || !d.months.some((m) => m.took || m.declared)) return null;

  const start = (m: Month) => { setErr(''); setSaid(''); setForm({ month: m.month, cash: ((m.declared?.cashCents ?? m.recordedCashCents) / 100).toFixed(2), paidOut: m.declared?.paidOutCents ? (m.declared.paidOutCents / 100).toFixed(2) : '', sign: '' }); };
  const send = async () => {
    if (!form) return; setErr('');
    if (cleanDollars(form.cash) === null) { setErr('Cash tips: an amount in dollars, like 212.50.'); return; }
    if (cleanDollars(form.paidOut) === null) { setErr('Tips you paid out: an amount in dollars, or leave it empty.'); return; }
    setBusy(true);
    const r = await post({ tenantId, action: 'declare', month: form.month, cash: form.cash, paidOut: form.paidOut, signedName: form.sign }); setBusy(false);
    if (!r.ok) { setErr(r.error || 'That didn’t send. Try again.'); return; }
    setSaid(`Sent: ${money(r.cashCents)} in cash tips for ${monthWords(form.month)}. Your manager has the signed copy.`); setForm(null); void load();
  };
  const field = 'mt-1 block min-h-[44px] w-full rounded-xl border bg-[#fff] px-3 text-[16px] font-normal outline-none focus:border-[#16171a]';

  return (
    <section aria-labelledby="declare-title" className="space-y-2 rounded-3xl bg-[#fff] p-4" style={{ border: `1px solid ${LINE}`, color: INK }}>
      <div>
        <h2 id="declare-title" className="text-[15px] font-semibold">Cash tips</h2>
        <p className="text-[13px]" style={{ color: MUTED }}>Each month, tell the business what you got in cash tips, by the 10th of the next month. If it’s $20 or more, the IRS asks you to report all of it to your employer in writing; this is that.</p>
      </div>
      {said && <p role="status" className="rounded-2xl px-3 py-2 text-[13.5px]" style={{ background: SOFT, color: GREEN }}>{said}</p>}
      <ul>
        {d.months.filter((m) => m.took || m.declared).map((m) => (
          <li key={m.month} className="border-t py-2.5" style={{ borderColor: LINE }}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14.5px] font-medium">{monthWords(m.month)}</p>
                <p className="text-[13px]" style={{ color: m.declared ? GREEN : MUTED }}>{m.declared ? `Sent ${money(m.declared.cashCents)}, signed ${md(m.declared.signedAt)}` : `Due by ${md(m.by)}. The till has ${money(m.recordedCashCents)} of yours in cash.`}</p>
              </div>
              {form?.month !== m.month && <button type="button" onClick={() => start(m)} className={`min-h-[44px] shrink-0 rounded-xl px-3.5 text-[14px] font-semibold ${RING}`} style={m.declared ? { border: `1px solid ${LINE}` } : { background: INK, color: '#fff' }}>{m.declared ? 'Change' : 'Declare'}</button>}
            </div>
            {form?.month === m.month && (
              <div className="mt-2 space-y-2.5 rounded-2xl p-3" style={{ background: SOFT }}>
                <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Cash tips you got in {monthWords(m.month).split(' ')[0]}, all of it
                  <span className="mt-1 flex min-h-[44px] items-center rounded-xl border bg-[#fff] px-3 focus-within:border-[#16171a]" style={{ borderColor: LINE }}><span aria-hidden style={{ color: MUTED }}>$</span>
                    <input inputMode="decimal" value={form.cash} onChange={(e) => setForm({ ...form, cash: e.target.value.replace(/[^0-9.]/g, '').slice(0, 9) })} className="min-w-0 flex-1 bg-transparent pl-1 text-[16px] font-normal tabular-nums outline-none" style={{ color: INK }} /></span></label>
                <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Tips you paid out to others, if any
                  <span className="mt-1 flex min-h-[44px] items-center rounded-xl border bg-[#fff] px-3 focus-within:border-[#16171a]" style={{ borderColor: LINE }}><span aria-hidden style={{ color: MUTED }}>$</span>
                    <input inputMode="decimal" value={form.paidOut} onChange={(e) => setForm({ ...form, paidOut: e.target.value.replace(/[^0-9.]/g, '').slice(0, 9) })} placeholder="0.00" className="min-w-0 flex-1 bg-transparent pl-1 text-[16px] font-normal tabular-nums outline-none" style={{ color: INK }} /></span></label>
                <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Type your full name to sign
                  <input value={form.sign} onChange={(e) => setForm({ ...form, sign: e.target.value.slice(0, 80) })} autoComplete="name" placeholder="Your full name" className={field} style={{ borderColor: LINE, color: INK }} /></label>
                <p className="text-[12.5px]" style={{ color: MUTED }}>By signing, you say this is all the cash tips you got in {monthWords(m.month)}.</p>
                {err && <p role="alert" className="rounded-xl px-3 py-2 text-[13.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setForm(null)} className={`min-h-[44px] flex-1 rounded-xl text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}`, background: '#fff' }}>Cancel</button>
                  <button type="button" onClick={() => void send()} disabled={busy || form.sign.trim().length < 2} className={`min-h-[44px] flex-[2] rounded-xl text-[14px] font-semibold disabled:opacity-50 ${RING}`} style={{ background: INK, color: '#fff' }}>{busy ? 'Sending…' : 'Sign and send'}</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
