'use client';
// src/components/reports/VisitProfit.tsx — WHAT VISITS REALLY EARN (O9): revenue, actual cost and profit added up by
// service, provider or station, from what actually happened on each finished visit (time taken, products used). Worst
// first, so the services that lose money or always run over are at the top. Managers set the small per-use costs here.
import * as React from 'react';
import { collection, query, where, doc, updateDoc } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { actualVisitCost, rollupProfit, type VisitCost } from '@/lib/visit-cost';

const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const ms = (v: any): number => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : v?.seconds ? v.seconds * 1000 : v instanceof Date ? v.getTime() : 0);
type By = 'service' | 'provider' | 'station';

export function VisitProfit() {
  const { firestore } = useFirebase(); const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id;
  const { appointments, services, staff, inventory } = useInventory() as any;
  const [days, setDays] = React.useState(30); const [by, setBy] = React.useState<By>('service');
  const since = React.useMemo(() => new Date(Date.now() - days * 86400000).toISOString(), [days]);
  const uq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'usage'), where('recordedAt', '>=', since)) : null), [firestore, tenantId, since]);
  const rq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'resources') : null), [firestore, tenantId]);
  const { data: usage } = useCollection<any>(uq); const { data: resources } = useCollection<any>(rq);
  const manager = ['owner', 'admin', 'manager'].includes(String(role || ''));
  const oc = React.useMemo(() => selectedTenant?.opsCosts || {}, [selectedTenant?.opsCosts]); const tmhr = Number(selectedTenant?.tmhr) || 50;
  const [draft, setDraft] = React.useState<{ linenEach: string; kitEach: string; minMarginPct: string } | null>(null); const [saved, setSaved] = React.useState<string | null>(null);

  const visits = React.useMemo(() => { const from = Date.parse(since); const u = new Map((usage || []).map((x: any) => [x.visitId || x.id, x]));
    return (appointments || []).filter((a: any) => String(a.status) === 'completed' && !a.renterId && ms(a.startTime) >= from).map((a: any) => { const service = (services || []).find((s: any) => s.id === a.serviceId); if (!service) return null;
      const addOns = (a.addOnIds || []).map((id: string) => (services || []).find((s: any) => s.id === id)).filter(Boolean); const staffMember = (staff || []).find((s: any) => s.id === a.staffId);
      const cost = actualVisitCost({ visit: a, service, addOns, staffMember, inventory: inventory || [], usage: u.get(a.id) || null, tmhr, opsCosts: oc });
      return { a, service, staffMember, cost }; }).filter(Boolean) as { a: any; service: any; staffMember: any; cost: VisitCost }[]; }, [appointments, services, staff, inventory, usage, since, tmhr, oc]);
  const rows = React.useMemo(() => rollupProfit(visits.flatMap((v) => {
    if (by === 'service') return [{ key: v.service.id, name: v.service.name || 'Service', cost: v.cost }];
    if (by === 'provider') return [{ key: v.a.staffId || 'none', name: v.staffMember?.name || 'No provider', cost: v.cost }];
    const ids: string[] = Array.isArray(v.a.requiredResourceIds) && v.a.requiredResourceIds.length ? v.a.requiredResourceIds.slice(0, 1) : ['none'];
    return ids.map((id) => ({ key: id, name: (resources || []).find((r: any) => r.id === id)?.name || 'No station', cost: v.cost })); })), [visits, by, resources]);
  const tot = React.useMemo(() => visits.reduce((t, v) => ({ revenue: t.revenue + v.cost.revenue, cost: t.cost + v.cost.total, profit: t.profit + v.cost.profit, timed: t.timed + (v.cost.timed ? 1 : 0), actual: t.actual + (v.cost.materialsBasis === 'actual' ? 1 : 0) }), { revenue: 0, cost: 0, profit: 0, timed: 0, actual: 0 }), [visits]);
  const saveCosts = async () => { if (!draft || !firestore || !tenantId) return; const num = (s: string) => Math.max(0, Number(s) || 0);
    try { await updateDoc(doc(firestore, 'tenants', tenantId), { opsCosts: { linenEach: num(draft.linenEach), kitEach: num(draft.kitEach), minMarginPct: Math.min(90, num(draft.minMarginPct)) } }); setDraft(null); setSaved('Saved.'); } catch { setSaved('That didn’t save — try again.'); } };

  return (
    <section aria-label="What visits really earn" className="rounded-3xl border bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-bold">What visits really earn</h2>
          <p className="text-sm text-muted-foreground">From the time each visit actually took and the products actually used. Worst first.</p></div>
        <div className="flex flex-wrap gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="h-10 rounded-xl border bg-background px-2 text-sm"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
          <div className="flex overflow-hidden rounded-xl border" role="tablist" aria-label="Group by">{(['service', 'provider', 'station'] as By[]).map((k) => <button key={k} type="button" role="tab" aria-selected={by === k} onClick={() => setBy(k)} className={`h-10 px-3 text-sm font-semibold capitalize ${by === k ? 'bg-foreground text-background' : 'bg-background'}`}>{k}</button>)}</div>
        </div>
      </div>
      {!visits.length ? <p className="mt-4 text-sm text-muted-foreground">No finished visits in this period yet.</p> : (<>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Visits', String(visits.length)], ['Revenue', money(tot.revenue)], ['Actual cost', money(tot.cost)], ['Profit', money(tot.profit)]].map(([l, v]) => <div key={l} className="rounded-2xl border p-3"><p className="text-xs text-muted-foreground">{l}</p><p className={`text-xl font-bold tabular-nums ${l === 'Profit' && tot.profit < 0 ? 'text-red-700' : ''}`}>{v}</p></div>)}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-semibold capitalize">{by}</th><th className="px-2 text-right font-semibold">Visits</th><th className="px-2 text-right font-semibold">Revenue</th><th className="px-2 text-right font-semibold">Cost</th><th className="px-2 text-right font-semibold">Profit</th><th className="px-2 text-right font-semibold">Margin</th><th className="px-2 text-right font-semibold">Runs over</th><th className="pl-2 text-right font-semibold">Safe discount</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                <td className="py-2 pr-3 font-medium">{r.name}</td><td className="px-2 text-right tabular-nums">{r.visits}</td><td className="px-2 text-right tabular-nums">{money(r.revenue)}</td><td className="px-2 text-right tabular-nums">{money(r.cost)}</td>
                <td className={`px-2 text-right font-semibold tabular-nums ${r.profit < 0 ? 'text-red-700' : ''}`}>{money(r.profit)}</td>
                <td className={`px-2 text-right tabular-nums ${r.marginPct !== null && r.marginPct < 0 ? 'text-red-700' : ''}`}>{r.marginPct === null ? '—' : `${r.marginPct}%`}</td>
                <td className={`px-2 text-right tabular-nums ${r.overMin >= 10 ? 'font-semibold text-amber-800' : ''}`}>{r.timedVisits ? (r.overMin > 0 ? `+${r.overMin} min` : r.overMin < 0 ? `${r.overMin} min` : 'On time') : '—'}</td>
                <td className="pl-2 text-right tabular-nums">{r.maxDiscountPct > 0 ? `up to ${r.maxDiscountPct}%` : 'None'}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Cost = provider pay + running cost of ${tmhr}/hour while the station is tied up + products + linen and kit handling. {tot.timed} of {visits.length} visits had real start and finish times (the rest use the booked length); {tot.actual} had recorded product amounts (the rest use the service’s standard amounts). “Runs over” is the average against the booked time. “Safe discount” is the largest that still leaves {Number(oc.minMarginPct) || 0}% margin on the worst visit in the row.</p>
      </>)}
      {manager && (draft ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border p-3 text-sm">
          <label>Laundering one linen ($)<input type="number" min={0} step="0.05" value={draft.linenEach} onChange={(e) => setDraft({ ...draft, linenEach: e.target.value })} className="mt-1 block h-10 w-28 rounded-xl border bg-background px-2" /></label>
          <label>Cleaning one kit ($)<input type="number" min={0} step="0.25" value={draft.kitEach} onChange={(e) => setDraft({ ...draft, kitEach: e.target.value })} className="mt-1 block h-10 w-28 rounded-xl border bg-background px-2" /></label>
          <label>Margin to always keep (%)<input type="number" min={0} max={90} value={draft.minMarginPct} onChange={(e) => setDraft({ ...draft, minMarginPct: e.target.value })} className="mt-1 block h-10 w-28 rounded-xl border bg-background px-2" /></label>
          <button type="button" onClick={saveCosts} className="h-10 rounded-xl bg-foreground px-4 font-semibold text-background">Save</button>
          <button type="button" onClick={() => setDraft(null)} className="h-10 px-2">Cancel</button>
        </div>
      ) : <button type="button" onClick={() => { setSaved(null); setDraft({ linenEach: String(oc.linenEach ?? 0), kitEach: String(oc.kitEach ?? 0), minMarginPct: String(oc.minMarginPct ?? 0) }); }} className="mt-4 h-10 rounded-full border px-4 text-sm font-semibold">Set handling costs and margin</button>)}
      {saved && <p className="mt-2 text-sm text-muted-foreground" role="status">{saved}</p>}
    </section>);
}
