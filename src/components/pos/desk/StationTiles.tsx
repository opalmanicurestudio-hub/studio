'use client';
// src/components/pos/desk/StationTiles.tsx — EVERY STATION AS A TILE, coloured by its state (and labelled, so it never
// relies on colour alone): ready, in use, resetting, overdue, needs a check, blocked. Tap a tile that needs something and
// its steps and buttons open underneath. Same live records as the Stations list.
import * as React from 'react';
import { collection } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { stationReadiness, type StationRow } from '@/lib/readiness';
import { Stations } from '@/components/pos/desk/Stations';
import { LiveTimer, useSeconds } from '@/components/pos/desk/LiveTimer';

const first = (n?: string | null) => String(n || '').split(' ')[0];
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
type Look = { label: string; cls: string; sub: string };
function lookOf(r: StationRow): Look {
  if (r.status === 'in_use') return { label: 'In use', cls: 'bg-[#164A86] text-white', sub: 'text-white/90' };
  if (r.status === 'turnover' && (r.overdueMin || 0) > 0) return { label: 'Overdue', cls: 'bg-[#B42318] text-white', sub: 'text-white' };
  if (r.status === 'turnover') return { label: 'Resetting', cls: 'border-2 border-[#B26A00] bg-card', sub: 'text-muted-foreground' };
  if (r.status === 'inspect') return { label: 'Needs a check', cls: 'border-2 border-violet-700 bg-violet-50', sub: 'text-violet-900' };
  if (r.status === 'blocked') return { label: r.quarantine ? 'Quarantined' : 'Blocked', cls: 'border-2 border-dashed border-[#B42318] bg-[#FBE4E1]', sub: 'text-[#6E1A12]' };
  return { label: 'Ready', cls: 'border border-[#A9D4B5] bg-[#E3F3E7]', sub: 'text-[#2B4A35]' };
}

export function StationTiles({ tenantId, appts, services, staff }: { tenantId: string; appts: any[]; services: any[]; staff: any[] }) {
  const { firestore } = useFirebase(); const now = useSeconds();
  const rq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'resources') : null), [firestore, tenantId]);
  const pq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'protocols') : null), [firestore, tenantId]);
  const { data: resources } = useCollection<any>(rq); const { data: protocols } = useCollection<any>(pq);
  const [open, setOpen] = React.useState<string | null>(null);
  const half = Math.floor(now / 30000);   // the grid itself re-works every 30 s; the timers tick each second
  const rows = React.useMemo(() => stationReadiness(resources || [], appts || [], services || [], Date.now(), staff || [], protocols || []), [resources, appts, services, staff, protocols, half]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!firestore) return null;
  if (!rows.length) return <p className="rounded-[20px] border border-dashed p-4 text-[14px] text-muted-foreground">No stations yet — add rooms and chairs under Settings, then link them to services.</p>;
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const acts = (r: StationRow) => r.status === 'turnover' || r.status === 'inspect' || r.status === 'blocked';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {sorted.map((r) => { const k = lookOf(r); const Tag: any = acts(r) ? 'button' : 'div'; const steps = r.checklist?.length || 0; return (
          <Tag key={r.id} {...(acts(r) ? { type: 'button', onClick: () => setOpen(open === r.id ? null : r.id), 'aria-expanded': open === r.id } : {})} className={`flex min-h-[132px] flex-col justify-between rounded-[22px] p-4 text-left ${k.cls} ${open === r.id ? 'ring-4 ring-foreground/20' : ''}`}>
            <span className="flex items-baseline justify-between gap-2"><span className="text-[22px] font-[700] leading-tight">{r.name}</span><span className="shrink-0 text-[13px] font-bold">{k.label}</span></span>
            <span className={`flex flex-col gap-0.5 text-[14px] ${k.sub}`}>
              {r.status === 'in_use' && <><span>{r.clientName || 'A client'}</span>{r.since && <span className="text-[26px] font-[800] leading-none tabular-nums text-white"><LiveTimer since={r.since} className="!font-[800]" /></span>}</>}
              {r.status === 'turnover' && <><span className={`text-[26px] font-[800] leading-none tabular-nums ${(r.overdueMin || 0) > 0 ? '' : 'text-foreground'}`}>{(r.overdueMin || 0) > 0 ? `${r.overdueMin} min over` : <LiveTimer short until={r.readyBy} doneLabel="Time’s up" className="!font-[800]" />}</span>
                <span>{r.claimed ? `${first(r.ownerName)} has it` : (r.overdueMin || 0) > 0 ? 'Nobody has it' : r.ownerName ? `${first(r.ownerName)}’s to reset` : ''}{steps ? ` · ${steps} step${steps === 1 ? '' : 's'}` : ''}</span></>}
              {r.status === 'ready' && <span>{r.next ? `Next: ${first(r.next.clientName) || 'client'} at ${clock(r.next.at)}` : 'Open'}</span>}
              {(r.status === 'blocked' || r.status === 'inspect') && <span>{r.quarantine?.reason || r.note || (r.status === 'inspect' ? 'Check it before the next client' : 'Out of service')}</span>}
              {r.status !== 'ready' && r.next && <span>Next client {clock(r.next.at)}</span>}
              {acts(r) && <span className="mt-1 text-[13px] font-bold underline">{open === r.id ? 'Close' : 'Open'}</span>}
            </span>
          </Tag>); })}
      </div>
      {open && <div className="rounded-[22px] border bg-card p-3"><Stations mine firestore={firestore} tenantId={tenantId} resources={resources || []} appts={appts} services={services} staff={staff} protocols={protocols || []} onlyRow={(r) => r.id === open} /></div>}
    </div>);
}
