'use client';
// src/components/pos/desk/CollectRent.tsx — COLLECT RENT AT THE DESK. Renters with what they owe (most owed first); the
// amount defaults to their balance (change it for part-payments or paying ahead). "Take payment" fills the normal checkout
// with their rent line — cash (counted in the till), card, the iPad or a split — receipt, Today's sales and void included.
// Settled oldest charges first, the same rule as the Rent page.
import * as React from 'react';
import { getAuth } from 'firebase/auth';

const money = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;
async function call(body: any) { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/rent-desk', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' })); }

export function CollectRent({ tenantId, onTake }: { tenantId: string; onTake: (x: { clientId: string; renterId: string; name: string; amount: number }) => void }) {
  const [list, setList] = React.useState<any[] | null>(null); const [q, setQ] = React.useState(''); const [sel, setSel] = React.useState<any>(null);
  const [amt, setAmt] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { call({ tenantId, action: 'list' }).then((r: any) => (r?.ok ? setList(r.renters) : (setList([]), setErr(r?.error || 'Couldn’t load renters.')))); }, [tenantId]);
  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties; const soft = { background: 'var(--soft)' } as React.CSSProperties; const muted = { color: 'var(--muted)' } as React.CSSProperties;
  const take = async () => { const amount = Math.round(Number(amt) * 100) / 100; if (!(amount > 0)) { setErr('Enter the amount they’re paying.'); return; }
    setBusy(true); setErr(null); const r: any = await call({ tenantId, action: 'payer', renterId: sel.id }); setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t work.'); return; } onTake({ clientId: r.clientId, renterId: sel.id, name: sel.name, amount }); };
  if (sel) { const n = Number(amt) * 100;
    return (
      <div className="space-y-3">
        <section className="space-y-1 rounded-3xl p-4" style={box}>
          <p className="text-[20px] font-semibold">{sel.name}</p>
          <p className="text-[14px]" style={muted}>{sel.boothName || 'No booth on their lease'} · {sel.owedCents > 0 ? `owes ${money(sel.owedCents)}${sel.oldestDue ? ` (oldest due ${new Date(sel.oldestDue).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : ''}` : 'nothing owed right now'}</p>
        </section>
        <section className="space-y-2 rounded-3xl p-4" style={box}>
          <label className="block text-[13px] font-semibold" htmlFor="rent-amt">They’re paying</label>
          <input id="rent-amt" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="0.00" className="h-12 w-full rounded-xl px-4 text-[18px] tabular-nums outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />
          <p className="text-[12px]" style={muted}>{!(n > 0) ? '' : n < sel.owedCents ? `Part-payment — pays their oldest charges in full first; the rest stays owed.` : n > sel.owedCents ? `${money(n - sel.owedCents)} more than they owe — kept as credit on their account.` : 'Clears everything they owe.'}</p>
        </section>
        {err && <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }} role="alert">{err}</p>}
        <button type="button" disabled={busy || !(Number(amt) > 0)} onClick={take} className="h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{busy ? 'One moment…' : `Take payment — ${money(n || 0)}`}</button>
        <button type="button" onClick={() => { setSel(null); setErr(null); }} className="text-[13px] underline underline-offset-4">Back to renters</button>
      </div>); }
  const t = q.trim().toLowerCase(); const shown = (list || []).filter((r) => !t || r.name.toLowerCase().includes(t) || String(r.boothName || '').toLowerCase().includes(t));
  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a renter or booth" aria-label="Find a renter" className="h-12 w-full rounded-xl px-4 text-[16px] outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />
      {err && <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
      {list === null ? <p className="text-[14px]" style={muted}>Loading renters…</p> : !shown.length ? <p className="py-4 text-center text-[14px]" style={muted}>No renters found.</p>
        : <div className="space-y-2">{shown.map((r) => <button key={r.id} type="button" onClick={() => { setSel(r); setAmt(r.owedCents > 0 ? (r.owedCents / 100).toFixed(2) : ''); setErr(null); }} className="flex w-full items-center justify-between gap-2 rounded-2xl p-3 text-left" style={box}>
          <span><span className="block text-[15px] font-semibold">{r.name}</span><span className="block text-[13px]" style={muted}>{r.boothName || 'No booth'}</span></span>
          <span className="rounded-full px-3 py-1 text-[13px] font-semibold tabular-nums" style={r.owedCents > 0 ? { background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' } : soft}>{r.owedCents > 0 ? `Owes ${money(r.owedCents)}` : 'Paid up'}</span></button>)}</div>}
    </div>
  );
}
