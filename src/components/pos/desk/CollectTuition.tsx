'use client';
// src/components/pos/desk/CollectTuition.tsx — TUITION AT THE DESK. Enrolled students with a balance (past due first);
// the amount starts at their next instalment (never more than they owe). "Take payment" fills the normal checkout — cash
// (counted in the till), card, the iPad or a split. It goes on their Academy tuition ledger like an online payment.
import * as React from 'react';
import { getAuth } from 'firebase/auth';

const money = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;
async function call(body: any) { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/tuition-desk', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' })); }

export function CollectTuition({ tenantId, onTake }: { tenantId: string; onTake: (x: { clientId: string; planId: string; name: string; program: string; amount: number }) => void }) {
  const [list, setList] = React.useState<any[] | null>(null); const [q, setQ] = React.useState(''); const [sel, setSel] = React.useState<any>(null);
  const [amt, setAmt] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null);
  const [bf, setBf] = React.useState<string | null>(null);   // with the other hooks — below the early return it crashed the panel (React #300)
  React.useEffect(() => { call({ tenantId, action: 'list' }).then((r: any) => (r?.ok ? setList(r.students) : (setList([]), setErr(r?.error || 'Couldn’t load students.')))); }, [tenantId]);
  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties; const soft = { background: 'var(--soft)' } as React.CSSProperties; const muted = { color: 'var(--muted)' } as React.CSSProperties;
  const warn = { background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' } as React.CSSProperties;
  const take = async () => { const amount = Math.round(Number(amt) * 100) / 100; if (!(amount > 0)) { setErr('Enter the amount they’re paying.'); return; }
    if (Math.round(amount * 100) > sel.balanceCents) { setErr(`That’s more than they owe (${money(sel.balanceCents)}).`); return; }
    setBusy(true); setErr(null); const r: any = await call({ tenantId, action: 'payer', planId: sel.id }); setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t work.'); return; } onTake({ clientId: r.clientId, planId: sel.id, name: sel.name, program: sel.program, amount }); };
  if (sel) { const n = Number(amt) * 100;
    return (
      <div className="space-y-3">
        <section className="space-y-1 rounded-3xl p-4" style={box}>
          <p className="text-[20px] font-semibold">{sel.name}</p>
          <p className="text-[14px]" style={muted}>{sel.program} · owes {money(sel.balanceCents)}{sel.pastDue ? ' · past due' : sel.nextDueAt ? ` · next due ${new Date(sel.nextDueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p>
        </section>
        <section className="space-y-2 rounded-3xl p-4" style={box}>
          <label className="block text-[13px] font-semibold" htmlFor="tu-amt">They’re paying</label>
          <input id="tu-amt" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="0.00" className="h-12 w-full rounded-xl px-4 text-[18px] tabular-nums outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />
          <div className="flex flex-wrap gap-1.5">
            {sel.installmentCents > 0 && sel.installmentCents < sel.balanceCents && <button type="button" onClick={() => setAmt((sel.installmentCents / 100).toFixed(2))} className="h-9 rounded-full px-3 text-[13px]" style={soft}>Next instalment · {money(sel.installmentCents)}</button>}
            <button type="button" onClick={() => setAmt((sel.balanceCents / 100).toFixed(2))} className="h-9 rounded-full px-3 text-[13px]" style={soft}>Whole balance · {money(sel.balanceCents)}</button>
          </div>
          <p className="text-[12px]" style={muted}>{!(n > 0) ? '' : n > sel.balanceCents ? 'More than they owe — lower it.' : n === sel.balanceCents ? 'Pays off their tuition.' : n >= sel.installmentCents && sel.installmentCents > 0 ? 'Counts as their next instalment.' : 'A part-payment toward their balance.'}</p>
        </section>
        {err && <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }} role="alert">{err}</p>}
        <button type="button" disabled={busy || !(n > 0) || n > sel.balanceCents} onClick={take} className="h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{busy ? 'One moment…' : `Take payment — ${money(n || 0)}`}</button>
        <button type="button" onClick={() => { setSel(null); setErr(null); }} className="text-[13px] underline underline-offset-4">Back to students</button>
      </div>); }
  const backfill = async () => { setBf('Adding…'); const r: any = await call({ tenantId, action: 'backfill_books' }); setBf(r?.ok ? (r.added ? `Added ${r.added} past online tuition payment${r.added === 1 ? '' : 's'} to your books.` : 'Your books already have every online tuition payment.') : (r?.error || 'That didn’t work.')); };
  const t = q.trim().toLowerCase(); const shown = (list || []).filter((r) => !t || r.name.toLowerCase().includes(t) || String(r.program).toLowerCase().includes(t));
  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a student or program" aria-label="Find a student" className="h-12 w-full rounded-xl px-4 text-[16px] outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />
      {err && <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
      {list === null ? <p className="text-[14px]" style={muted}>Loading students…</p> : !shown.length ? <p className="py-4 text-center text-[14px]" style={muted}>{list.length ? 'No student matches that.' : 'No enrolled student owes tuition right now. (Down payments are taken on their application link.)'}</p>
        : <div className="space-y-2">{shown.map((r) => <button key={r.id} type="button" onClick={() => { setSel(r); setAmt(((r.installmentCents > 0 ? Math.min(r.installmentCents, r.balanceCents) : r.balanceCents) / 100).toFixed(2)); setErr(null); }} className="flex w-full items-center justify-between gap-2 rounded-2xl p-3 text-left" style={box}>
          <span><span className="block text-[15px] font-semibold">{r.name}</span><span className="block text-[13px]" style={muted}>{r.program}</span></span>
          <span className="rounded-full px-3 py-1 text-[13px] font-semibold tabular-nums" style={r.pastDue ? warn : soft}>{r.pastDue ? 'Past due · ' : ''}{money(r.balanceCents)}</span></button>)}</div>}
      <div className="border-t pt-3 text-[12px]" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>
        <p>Tuition paid online now goes into your books automatically. Payments from before that change: <button type="button" onClick={backfill} disabled={bf === 'Adding…'} className="font-semibold underline underline-offset-4">add past online tuition to your books</button> (managers · safe to run again).</p>
        {bf && <p className="mt-1 font-semibold" role="status">{bf}</p>}
      </div>
    </div>
  );
}
