'use client';
// src/components/rent/DeskOwedCard.tsx — OWED TO RENTERS: what the front desk collected for them (their clients
// paying at the studio's till). Renters' money is kept separate, so it's theirs until you settle it: pay it out, or
// take it off their next rent. Shows only when something is owed.
import * as React from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const money = (c: number) => `$${(Number(c || 0) / 100).toFixed(2)}`;

export function DeskOwedCard({ tenantId, firestore, renters }: { tenantId: string; firestore: any; renters: any[] }) {
  const [rows, setRows] = React.useState<any[]>([]); const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState('');
  React.useEffect(() => { if (!firestore || !tenantId) return;
    return onSnapshot(query(collection(firestore, 'tenants', tenantId, 'rentLedger'), where('type', '==', 'desk_collected')),
      (s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((r) => r.status === 'owed')), () => setRows([])); }, [firestore, tenantId]);
  const byRenter = React.useMemo(() => { const m = new Map<string, { cents: number; count: number }>(); for (const r of rows) { const k = String(r.renterId || ''); const cur = m.get(k) || { cents: 0, count: 0 }; cur.cents += Number(r.amountCents) || 0; cur.count++; m.set(k, cur); } return [...m.entries()]; }, [rows]);
  if (!byRenter.length) return null;
  const name = (id: string) => { const r = renters.find((x: any) => x.id === id); return r ? [r.firstName, r.lastName].filter(Boolean).join(' ') || r.name || 'Renter' : 'Renter'; };
  const settle = async (renterId: string, how: 'paid' | 'rent') => {
    const amt = money(byRenter.find(([k]) => k === renterId)?.[1].cents || 0);
    if (!window.confirm(how === 'rent' ? `Take ${amt} off ${name(renterId)}’s next rent?` : `Mark ${amt} as paid out to ${name(renterId)}?`)) return;
    setBusy(renterId); setMsg('');
    try { const tk = await getAuth().currentUser?.getIdToken();
      const r = await fetch('/api/renters/desk-settle', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, renterId, how }) }).then((x) => x.json());
      setMsg(r.ok ? (how === 'rent' ? `${amt} will come off ${name(renterId)}’s next rent.` : `${amt} marked as paid out to ${name(renterId)}.`) : r.error || 'That didn’t save.');
    } catch { setMsg('No connection — try again.'); } finally { setBusy(''); }
  };
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3" aria-label="Owed to renters">
      <div><h2 className="text-[17px] font-semibold text-amber-950">Owed to renters</h2>
        <p className="text-[13px] text-amber-900">Their clients paid at your front desk. That money is theirs — pay it out, or take it off their next rent.</p></div>
      {byRenter.map(([rid, v]) => (
        <div key={rid} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2.5">
          <p className="text-[14px]"><span className="font-semibold">{name(rid)}</span> · {money(v.cents)} <span className="text-amber-800">({v.count} {v.count === 1 ? 'payment' : 'payments'})</span></p>
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => void settle(rid, 'rent')} className="h-9 rounded-full bg-amber-900 px-3 text-[13px] font-semibold text-white disabled:opacity-50">Take off next rent</button>
            <button type="button" disabled={!!busy} onClick={() => void settle(rid, 'paid')} className="h-9 rounded-full border border-amber-900/30 px-3 text-[13px] font-medium text-amber-950 disabled:opacity-50">I’ve paid it out</button>
          </div>
        </div>))}
      {msg && <p role="status" className="text-[13px] font-medium text-amber-950">{msg}</p>}
    </section>
  );
}
