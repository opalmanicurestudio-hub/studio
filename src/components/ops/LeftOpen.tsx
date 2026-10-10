'use client';
// src/components/ops/LeftOpen.tsx — "LEFT OPEN": visits the overnight close-out took off the live lists because nobody
// finished or checked them out (lib/stale-sweep). Each one is settled here in a tap: they came (back to ready to pay,
// opens checkout) · no-show (no fee) · cancelled · or just clear it as it is. `useLeftOpen` gives the list and count.
import * as React from 'react';
import { collection, doc, query, updateDoc, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { openVisit } from '@/lib/visit-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const WAS: Record<string, string> = { servicing: 'was in service', in_service: 'was in service', ready_for_checkout: 'was waiting to pay', checked_in: 'had arrived', arrived: 'had arrived', waiting: 'was waiting' };

export function useLeftOpen(firestore: any, tenantId?: string | null) {
  const q = useMemoFirebase(() => (!firestore || !tenantId) ? null : query(collection(firestore, `tenants/${tenantId}/appointments`), where('closedReason', '==', 'left_open')), [firestore, tenantId]);
  const { data } = useCollection<any>(q);
  return React.useMemo(() => (data || []).filter((a: any) => a.status === 'expired' && !a.closeOutSettled)
    .sort((a: any, b: any) => String(b.startTime || '').localeCompare(String(a.startTime || ''))), [data]);
}

export function LeftOpen({ firestore, tenantId, items, staff = [], who = 'Front desk' }: { firestore: any; tenantId: string; items: any[]; staff?: any[]; who?: string }) {
  const [busy, setBusy] = React.useState<string>('');
  const name = (id: string) => String((staff || []).find((s: any) => s.id === id)?.name || '').split(' ')[0];
  const settle = async (a: any, how: 'came' | 'no_show' | 'cancelled' | 'clear') => {
    setBusy(a.id); const now = new Date().toISOString();
    const text = { came: 'Settled: they came — back to ready to pay', no_show: 'Settled: no-show (no fee)', cancelled: 'Settled: cancelled', clear: 'Settled: cleared as it was' }[how];
    const patch: any = { closeOutSettled: true, closeOutSettledAt: now, closeOutSettledBy: who,
      timeline: [...(Array.isArray(a.timeline) ? a.timeline : []), { at: now, kind: 'note', text, by: who, via: 'left open' }].slice(-60) };
    if (how === 'came') Object.assign(patch, { status: 'ready_for_checkout' });
    if (how === 'no_show') Object.assign(patch, { status: 'no_show', noShowAt: now, noShowFeeWaived: true });
    if (how === 'cancelled') Object.assign(patch, { status: 'cancelled', cancelledAt: now, cancellationReason: 'Settled after the day — never checked out' });
    try { await updateDoc(doc(firestore, `tenants/${tenantId}/appointments/${a.id}`), patch); if (how === 'came') openVisit(a.id); }
    finally { setBusy(''); }
  };
  if (!items.length) return <p className="rounded-[16px] px-4 py-3 text-[14px]" style={{ background: '#f6f6f7', color: MUTED }}>Nothing left open — every past visit is settled.</p>;
  return (
    <div className="space-y-2" style={{ color: INK }}>
      <p className="text-[14px]" style={{ color: MUTED }}>These visits were never finished or checked out, so they were closed overnight and taken off today’s lists. Settle each one so your records and reports are right.</p>
      {items.map((a) => { const when = new Date(a.startTime); return (
        <div key={a.id} className="space-y-2.5 rounded-[18px] border bg-white p-3.5" style={{ borderColor: LINE }}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-[15px] font-bold">{a.clientName || 'Guest'}{a.serviceName ? ` · ${a.serviceName}` : ''}</p>
            <span className="shrink-0 text-[12px]" style={{ color: MUTED }}>{when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          <p className="text-[13px]" style={{ color: MUTED }}>{[name(a.staffId) && `With ${name(a.staffId)}`, WAS[String(a.statusBefore)] || 'never arrived or was never checked in'].filter(Boolean).join(' · ')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button type="button" disabled={busy === a.id} onClick={() => settle(a, 'came')} className="h-10 rounded-[12px] text-[13px] font-bold text-white disabled:opacity-50" style={{ background: INK }}>They came — check out</button>
            <button type="button" disabled={busy === a.id} onClick={() => settle(a, 'no_show')} className="h-10 rounded-[12px] border text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: '#e6e6e8' }}>No-show</button>
            <button type="button" disabled={busy === a.id} onClick={() => settle(a, 'cancelled')} className="h-10 rounded-[12px] border text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: '#e6e6e8' }}>Cancelled</button>
            <button type="button" disabled={busy === a.id} onClick={() => settle(a, 'clear')} className="h-10 rounded-[12px] border text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: '#e6e6e8', color: MUTED }}>Just clear it</button>
          </div>
        </div>); })}
    </div>);
}
