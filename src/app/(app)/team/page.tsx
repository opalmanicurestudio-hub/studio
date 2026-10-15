'use client';
// src/app/(app)/team/page.tsx — ONE TEAM AREA. People, schedule, time, pay, requests, hiring, documents and how the
// team is doing, in one place with one header; plus Alerts — what about the team buzzes a manager (lib/team-alerts).
// Each area is the full page it always was, shown here without its own header.
import * as React from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, doc, query, updateDoc, where, type Firestore } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { InHub } from '@/components/shared/HubContext';
import { TEAM_ALERTS, type TeamAlertKey } from '@/lib/team-alerts';

const Loading = () => <p className="px-6 py-10 text-[14px] text-muted-foreground">Loading…</p>;
const AREAS = {
  people: { label: 'People', C: dynamic(() => import('@/app/(app)/staff/page'), { loading: Loading }) },
  schedule: { label: 'Schedule', C: dynamic(() => import('@/app/(app)/schedule/page'), { loading: Loading }) },
  time: { label: 'Time', C: dynamic(() => import('@/app/(app)/timesheets/page'), { loading: Loading }) },
  pay: { label: 'Pay', C: dynamic(() => import('@/app/(app)/payroll/questions/page'), { loading: Loading }) },
  payplan: { label: 'Pay plan check', C: dynamic(() => import('@/components/pay/PlanCheck'), { loading: Loading }) },
  requests: { label: 'Requests', C: null },
  hiring: { label: 'Hiring', C: dynamic(() => import('@/app/(app)/applicants/page'), { loading: Loading }) },
  documents: { label: 'Documents', C: dynamic(() => import('@/app/(app)/documents/page'), { loading: Loading }) },
  performance: { label: 'How it’s going', C: dynamic(() => import('@/app/(app)/team-performance/page'), { loading: Loading }) },
  alerts: { label: 'Alerts', C: null },
} as const;
type Area = keyof typeof AREAS;
const REQ_LABEL: Record<string, string> = { time_off: 'Time off', swap: 'Shift swap', drop: 'Give away a shift', early_finish: 'Leave early', cover: 'Cover', availability: 'Availability change' };
const when = (r: any) => { const d = r.date || r.startDate; if (!d) return ''; try { return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); } catch { return String(d); } };

function Requests({ tenantId, onDecide }: { tenantId: string; onDecide: () => void }) {
  const firestore = useFirestore(); const { staff } = useInventory() as any;
  const q = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/shiftRequests`), where('status', '==', 'pending')) : null), [firestore, tenantId]);
  const { data } = useCollection<any>(q);
  const today = new Date().toLocaleDateString('en-CA');
  const list = (data || []).filter((r: any) => !r.date || String(r.date) >= today).sort((a: any, b: any) => String(a.date || '').localeCompare(String(b.date || '')));
  const name = (id: string) => (staff || []).find((s: any) => s.id === id)?.name || 'A team member';
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 md:p-8">
      <p className="text-[14px] text-muted-foreground">{list.length ? `${list.length} waiting for a yes or no.` : 'Nothing waiting. Time off, swaps and early finishes show up here when someone asks.'}</p>
      {list.map((r: any) => (
        <div key={r.id} className="flex items-center justify-between gap-3 rounded-[18px] border bg-card p-4">
          <div className="min-w-0"><p className="text-[15px] font-semibold">{name(r.staffId || r.requesterId)} · {REQ_LABEL[r.type] || 'Request'}</p>
            <p className="text-[13px] text-muted-foreground">{[when(r), r.reason || r.note].filter(Boolean).join(' · ')}</p></div>
          <button type="button" onClick={onDecide} className="h-10 shrink-0 rounded-full bg-foreground px-4 text-[13.5px] font-semibold text-background">Decide</button>
        </div>))}
    </div>);
}

function Alerts({ tenant }: { tenant: any }) {
  const firestore = useFirestore(); const [v, setV] = React.useState<any>(tenant?.teamAlerts || {}); const [msg, setMsg] = React.useState('');
  React.useEffect(() => { setV(tenant?.teamAlerts || {}); }, [tenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (next: any) => { setV(next); setMsg(''); try { await updateDoc(doc(firestore as Firestore, 'tenants', tenant.id), { teamAlerts: next }); setMsg('Saved.'); } catch (e: any) { setMsg(e?.message || 'Couldn’t save.'); } };
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4 md:p-8">
      <p className="text-[14px] text-muted-foreground">What about the team buzzes you. Each one also shows in Timesheets or Documents either way.</p>
      <div className="divide-y rounded-[18px] border bg-card">
        {TEAM_ALERTS.map((a) => { const on = v?.[a.key] !== false; return (
          <label key={a.key} className="flex cursor-pointer items-center justify-between gap-4 p-4">
            <span><span className="block text-[15px] font-semibold">{a.label}</span><span className="block text-[13px] text-muted-foreground">{a.hint}</span></span>
            <input type="checkbox" className="h-5 w-5 accent-[var(--foreground)]" checked={on} onChange={(e) => save({ ...v, [a.key as TeamAlertKey]: e.target.checked })} />
          </label>); })}
      </div>
      <div className="rounded-[18px] border bg-card p-4"><p className="text-[15px] font-semibold">Who gets them</p>
        <div className="mt-2 flex flex-wrap gap-2">{[[false, 'The owner and every manager'], [true, 'The owner only']].map(([k, l]) => (
          <button key={String(k)} type="button" onClick={() => save({ ...v, ownerOnly: k })} aria-pressed={(v?.ownerOnly === true) === k} className="h-10 rounded-full px-4 text-[13.5px] font-semibold" style={(v?.ownerOnly === true) === k ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } : { background: 'hsl(var(--secondary))' }}>{l as string}</button>))}</div></div>
      {msg && <p className="text-[13px] text-muted-foreground">{msg}</p>}
    </div>);
}

function TeamHub() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const params = useSearchParams(); const router = useRouter();
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const area: Area = ((params.get('area') as Area) in AREAS ? params.get('area') : 'people') as Area;
  const go = (a: Area) => router.replace(`/team?area=${a}`, { scroll: false });
  const shown = (Object.keys(AREAS) as Area[]).filter((k) => isManager || ['people', 'schedule'].includes(k));
  const C: any = AREAS[area].C;
  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Team" />
      <nav className="sticky top-[76px] z-20 mx-3 mt-3 overflow-x-auto rounded-full border bg-card/95 p-1 backdrop-blur" aria-label="Team areas">
        <div className="flex w-max gap-1">{shown.map((k) => (
          <button key={k} type="button" onClick={() => go(k)} aria-current={area === k ? 'page' : undefined} className="h-10 shrink-0 rounded-full px-4 text-[14px] font-medium transition-colors"
            style={area === k ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } : { color: 'hsl(var(--muted-foreground))' }}>{AREAS[k].label}</button>))}</div>
      </nav>
      <InHub.Provider value={true}>
        {area === 'requests' ? <Requests tenantId={tenantId} onDecide={() => go('schedule')} />
          : area === 'alerts' ? (selectedTenant ? <Alerts tenant={selectedTenant} /> : null)
          : C ? <C /> : null}
      </InHub.Provider>
    </div>);
}

export default function TeamPage() { return <React.Suspense fallback={<Loading />}><TeamHub /></React.Suspense>; }
