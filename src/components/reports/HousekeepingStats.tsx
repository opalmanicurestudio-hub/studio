'use client';
// src/components/reports/HousekeepingStats.tsx — HOW HOUSEKEEPING IS GOING, and what to buy. Over the last 7 / 30 days:
//   • station resets — how many, how many were ready on time, how late the late ones were, and who did them;
//   • kits — cleanses started, swaps at the chair, kits pulled out; laundry loads started; tags reprinted;
//   • buying tips — for each kit type and linen, the days the bookings needed more at once than you own, and how many
//     more would have covered it ("2 more manicure kits would have covered 5 of the last 30 days").
// Managers only (the audit log and turnover records are manager-readable).
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { dayPrep } from '@/lib/day-prep';

const ms = (v: any): number => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : v?.seconds ? v.seconds * 1000 : v instanceof Date ? v.getTime() : 0);

export function buyingTips(input: { appts: any[]; services: any[]; kits: any[]; kitTypes: any[]; linens: any[]; days: number; now?: number }): { kind: 'kit' | 'linen'; name: string; shortDays: number; worst: number; text: string }[] {
  const now = input.now ?? Date.now(); const byDay = new Map<string, any[]>();
  for (const a of input.appts) { const t = ms(a.startTime); if (!t || t < now - input.days * 86400000 || t > now) continue; if (['cancelled', 'no_show', 'declined'].includes(String(a.status))) continue;
    const d = new Date(t); const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(a); }
  // Count as if everything owned were clean at opening: a shortfall then means you own too few, not that cleaning was slow.
  const kits = input.kits.filter((k) => k.status !== 'retired').map((k) => ({ ...k, status: k.status === 'out' ? 'out' : 'ready' }));
  const linens = input.linens.map((l) => ({ ...l, clean: (Number(l.clean) || 0) + (Number(l.dirty) || 0) + (Number(l.washing) || 0) + (Number(l.inUse) || 0) + (Number(l.drying) || 0) + (Number(l.folding) || 0), dirty: 0, washing: 0, inUse: 0, drying: 0, folding: 0 }));
  const kitShort = new Map<string, { days: number; worst: number }>(); const linShort = new Map<string, { days: number; worst: number }>();
  for (const visits of byDay.values()) { const p = dayPrep({ visits, services: input.services, kits: kits as any, kitTypes: input.kitTypes as any, linens: linens as any });
    for (const k of p.kits) if (k.shortPeak > 0) { const e = kitShort.get(k.name) || { days: 0, worst: 0 }; e.days++; e.worst = Math.max(e.worst, k.shortPeak); kitShort.set(k.name, e); }
    for (const l of p.linens) if (l.shortOwned > 0) { const e = linShort.get(l.name) || { days: 0, worst: 0 }; e.days++; e.worst = Math.max(e.worst, l.shortOwned); linShort.set(l.name, e); } }
  const many = (n: string, q: number) => { const x = n.toLowerCase(); return q === 1 ? x : /s$/.test(x) ? x : `${x}s`; };
  return [...[...kitShort].map(([name, e]) => ({ kind: 'kit' as const, name, shortDays: e.days, worst: e.worst })), ...[...linShort].map(([name, e]) => ({ kind: 'linen' as const, name, shortDays: e.days, worst: e.worst }))]
    .filter((x) => x.shortDays >= 2).sort((a, b) => b.shortDays - a.shortDays)
    .map((x) => ({ ...x, text: `${x.worst} more ${many(x.name, x.worst)} would have covered ${x.shortDays} of the last ${input.days} days${x.kind === 'linen' ? ' (or one more wash load on those days)' : ''}.` }));
}

export function HousekeepingStats() {
  const { firestore } = useFirebase(); const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id;
  const { appointments, services } = useInventory() as any;
  const manager = ['owner', 'admin', 'manager'].includes(String(role || ''));
  const [days, setDays] = React.useState(30); const since = React.useMemo(() => new Date(Date.now() - days * 86400000).toISOString(), [days]);
  const on = !!(firestore && tenantId && manager);
  const { data: logs } = useCollection<any>(useMemoFirebase(() => (on ? query(collection(firestore, 'tenants', tenantId, 'turnoverLogs'), where('completedAt', '>=', since)) : null), [on, tenantId, since]));
  const { data: audit } = useCollection<any>(useMemoFirebase(() => (on ? query(collection(firestore, 'tenants', tenantId, 'auditLogs'), where('at', '>=', since)) : null), [on, tenantId, since]));
  const { data: kits } = useCollection<any>(useMemoFirebase(() => (on ? collection(firestore, 'tenants', tenantId, 'kits') : null), [on, tenantId]));
  const { data: kitTypes } = useCollection<any>(useMemoFirebase(() => (on ? collection(firestore, 'tenants', tenantId, 'kitTypes') : null), [on, tenantId]));
  const { data: linens } = useCollection<any>(useMemoFirebase(() => (on ? collection(firestore, 'tenants', tenantId, 'linens') : null), [on, tenantId]));
  const resets = (logs || []).filter((l: any) => l.kind !== 'quarantine_release');
  const late = resets.filter((l: any) => Number(l.minutesLate) > 0);
  const people = React.useMemo(() => { const m = new Map<string, { n: number; late: number }>(); for (const l of resets) { const k = String(l.completedBy || 'Someone').split(' ')[0]; const e = m.get(k) || { n: 0, late: 0 }; e.n++; if (Number(l.minutesLate) > 0) e.late++; m.set(k, e); } return [...m].sort((a, b) => b[1].n - a[1].n); }, [resets]);
  const count = (p: RegExp) => (audit || []).filter((a: any) => p.test(String(a.action || ''))).length;
  const tips = React.useMemo(() => (kits && linens ? buyingTips({ appts: appointments || [], services: services || [], kits: kits || [], kitTypes: kitTypes || [], linens: linens || [], days }) : []), [appointments, services, kits, kitTypes, linens, days]);
  if (!manager || (!(kits || []).length && !(linens || []).length && !resets.length)) return null;
  const tile = (label: string, value: React.ReactNode, sub?: string) => (
    <div className="rounded-[20px] bg-white p-4 shadow-[0_8px_22px_-16px_rgba(23,24,26,0.35)]" style={{ border: '1px solid #ECE6DD' }}>
      <p className="text-[12px] font-[700] text-[#8A847A]">{label}</p><p className="text-[28px] font-[800] leading-tight tabular-nums">{value}</p>{sub && <p className="text-[12px] text-[#6A655D]">{sub}</p>}
    </div>);
  return (
    <section aria-label="Housekeeping" className="space-y-4 rounded-[28px] p-5" style={{ background: '#FBF9F6', border: '1px solid #ECE6DD' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-[22px] font-[800] tracking-[-0.01em]">Housekeeping</h2><p className="text-[13px] text-[#6A655D]">Resets, cleansing, laundry — and what to buy</p></div>
        <div className="flex overflow-hidden rounded-full border text-[13px] font-[600]">{[7, 30].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`h-10 px-4 ${days === d ? 'bg-[#17181A] text-white' : 'bg-white'}`}>Last {d} days</button>)}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tile('Station resets', resets.length, resets.length ? `${Math.round(((resets.length - late.length) / resets.length) * 100)}% ready on time` : undefined)}
        {tile('Late resets', late.length, late.length ? `on average ${Math.round(late.reduce((a: number, l: any) => a + Number(l.minutesLate || 0), 0) / late.length)} min late` : 'none')}
        {tile('Cleanses started', count(/^kit\.cleanse_started$/), `${count(/^kit\.swapped$/)} swaps at the chair · ${count(/^kit\.out$/)} pulled out`)}
        {tile('Laundry loads', count(/^linen\.wash$/), `${count(/^bundle\.retagged$/)} tags reprinted`)}
      </div>
      {people.length > 0 && <div className="rounded-[20px] bg-white p-4" style={{ border: '1px solid #ECE6DD' }}><p className="mb-2 text-[13px] font-[700]">Who did the resets</p>
        <div className="flex flex-wrap gap-2">{people.map(([name, e]) => <span key={name} className="rounded-full bg-[#F1ECE5] px-3 py-1.5 text-[13px] font-[600]">{name} · {e.n}{e.late ? <span className="text-[#B42318]"> · {e.late} late</span> : null}</span>)}</div></div>}
      <div className="rounded-[20px] bg-white p-4" style={{ border: '1px solid #ECE6DD' }}>
        <p className="mb-1 text-[13px] font-[700]">Buying tips</p>
        {tips.length ? <ul className="space-y-1.5">{tips.map((t) => <li key={t.kind + t.name} className="flex items-start gap-2 text-[14px]"><span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#7A5C3A]" /><span><b className="font-[700]">{t.name}:</b> {t.text}</span></li>)}</ul>
          : <p className="text-[14px] text-[#6A655D]">You own enough of everything your bookings needed at once in the last {days} days.</p>}
      </div>
    </section>);
}
