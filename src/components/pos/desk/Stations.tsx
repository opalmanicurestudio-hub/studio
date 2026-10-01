'use client';
// src/components/pos/desk/Stations.tsx — STATIONS (O2): every room and piece of equipment, live.
// Ready · In use (who, since when) · Turning over ("ready by 2:45 · 6 min") · Needs inspection · Blocked — plus who's
// next on it today. Actions: Mark ready (early), Needs inspection, Block (with a reason), Unblock. Status is worked out
// from the visits (lib/readiness), so it's right whichever screen moved a visit along.
import * as React from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { stationReadiness, READINESS_LABEL, type Readiness, type StationRow } from '@/lib/readiness';

const TONE: Record<Readiness, string> = { ready: 'bg-emerald-100 text-emerald-800', in_use: 'bg-sky-100 text-sky-800', turnover: 'bg-amber-100 text-amber-900', inspect: 'bg-violet-100 text-violet-900', blocked: 'bg-red-100 text-red-800' };
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

export function Stations({ firestore, tenantId, resources, appts, services }: { firestore: any; tenantId: string; resources: any[]; appts: any[]; services: any[] }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const rows = React.useMemo(() => stationReadiness(resources, appts, services, now), [resources, appts, services, now]);
  const [busy, setBusy] = React.useState<string | null>(null); const [err, setErr] = React.useState<string | null>(null);
  const [blocking, setBlocking] = React.useState<string | null>(null); const [reason, setReason] = React.useState('');
  const who = () => getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff';
  const save = async (id: string, patch: any) => { setBusy(id); setErr(null);
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'resources', id), patch); } catch (e: any) { setErr('That didn’t save — try again.'); } setBusy(null); };
  const act = {
    ready: (r: StationRow) => save(r.id, { readiness: { status: 'ready', at: new Date().toISOString(), by: who() } }),
    inspect: (r: StationRow) => save(r.id, { readiness: { status: 'inspect', at: new Date().toISOString(), by: who() } }),
    block: async (r: StationRow) => { await save(r.id, { isOutOfService: true, maintenanceNotes: reason.trim() || 'Blocked at the desk', readiness: { status: 'blocked', at: new Date().toISOString(), by: who(), note: reason.trim() || null } }); setBlocking(null); setReason(''); },
    unblock: (r: StationRow) => save(r.id, { isOutOfService: false, readiness: { status: 'ready', at: new Date().toISOString(), by: who() } }),
  };
  if (!rows.length) return <p className="text-[14px] text-muted-foreground">No rooms or equipment yet — add them under Resources, then link them to services.</p>;
  const order: Readiness[] = ['turnover', 'inspect', 'blocked', 'in_use', 'ready'];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name));
  return (
    <div className="space-y-2">
      {err && <p className="text-[13px] font-medium text-red-700" role="alert">{err}</p>}
      {sorted.map((r) => {
        const mins = r.readyBy ? Math.max(0, Math.ceil((Date.parse(r.readyBy) - now) / 60000)) : 0;
        return (
          <div key={r.id} className="rounded-2xl border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{r.name}</p>
                <p className="text-[13px] text-muted-foreground">
                  {r.status === 'in_use' && <>With {r.clientName || 'a client'}{r.since ? ` since ${time(r.since)}` : ''}</>}
                  {r.status === 'turnover' && <>Ready by {time(r.readyBy)} · {mins} min{r.clientName ? ` · after ${r.clientName}` : ''}</>}
                  {(r.status === 'blocked' || r.status === 'inspect') && (r.note || (r.status === 'inspect' ? 'Check it before the next client' : 'Out of service'))}
                  {r.status === 'ready' && 'Ready for the next client'}
                </p>
                {r.next && <p className="text-[12px] text-muted-foreground">Next: {time(r.next.at)}{r.next.clientName ? ` · ${r.next.clientName}` : ''}</p>}
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${TONE[r.status]}`}>{READINESS_LABEL[r.status]}</span>
            </div>
            {blocking === r.id ? (
              <div className="mt-2 flex gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 120))} placeholder="Why? (e.g. chair broken)" className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[14px]" />
                <button type="button" disabled={busy === r.id} onClick={() => act.block(r)} className="h-10 rounded-xl bg-red-600 px-3 text-[13px] font-semibold text-white">Block</button>
                <button type="button" onClick={() => setBlocking(null)} className="h-10 rounded-xl px-2 text-[13px]">Cancel</button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {(r.status === 'turnover' || r.status === 'inspect') && <button type="button" disabled={busy === r.id} onClick={() => act.ready(r)} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-50">Mark ready</button>}
                {(r.status === 'ready' || r.status === 'turnover') && <button type="button" disabled={busy === r.id} onClick={() => act.inspect(r)} className="h-9 rounded-full border px-3 text-[13px] disabled:opacity-50">Needs inspection</button>}
                {r.status === 'blocked'
                  ? <button type="button" disabled={busy === r.id} onClick={() => act.unblock(r)} className="h-9 rounded-full border px-3 text-[13px] font-semibold disabled:opacity-50">Unblock</button>
                  : r.status !== 'in_use' && <button type="button" onClick={() => { setBlocking(r.id); setReason(''); }} className="h-9 rounded-full border px-3 text-[13px] text-red-700">Block</button>}
              </div>
            )}
          </div>);
      })}
    </div>
  );
}
