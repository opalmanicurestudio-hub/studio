'use client';
// src/components/pos/desk/Housekeeping.tsx — THE HOUSEKEEPING QUEUE on screen (O3): one list, most urgent first, of
// stations to reset, kits to clean or finish, and wash loads to start or put away. Quick jobs are one tap here; the
// rest open the screen where they're done. Managers choose who does housekeeping (each provider, or named attendants).
import * as React from 'react';
import { collection, doc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { logAuditClient } from '@/lib/audit-client';
import { stationReadiness } from '@/lib/readiness';
import { stageOf } from '@/lib/visit';
import { moveKit, KIT_LABEL } from '@/lib/kits';
import { moveLinen, linenOutlook } from '@/lib/linens';
import { attendantQueue, housekeepingMode, type OpsTask } from '@/lib/attendant';
import { LiveTimer } from '@/components/pos/desk/LiveTimer';

/** How many housekeeping jobs are waiting (for a button's badge). Loads the same records as the queue. */
export function useHousekeeping(tenantId: string | null | undefined, appts: any[], services: any[], staff: any[]) {
  const { firestore } = useFirebase(); const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const q = (name: string) => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, name) : null);
  const rq = useMemoFirebase(() => q('resources'), [firestore, tenantId]); const pq = useMemoFirebase(() => q('protocols'), [firestore, tenantId]);
  const kq = useMemoFirebase(() => q('kits'), [firestore, tenantId]); const tq = useMemoFirebase(() => q('kitTypes'), [firestore, tenantId]); const lq = useMemoFirebase(() => q('linens'), [firestore, tenantId]);
  const { data: resources } = useCollection<any>(rq); const { data: protocols } = useCollection<any>(pq); const { data: kits } = useCollection<any>(kq); const { data: kitTypes } = useCollection<any>(tq); const { data: linens } = useCollection<any>(lq);
  const tasks = React.useMemo(() => {
    const stations = stationReadiness(resources || [], appts || [], services || [], now, staff || [], protocols || []);
    const ahead = (appts || []).filter((a: any) => ['booked', 'waiting', 'in_service'].includes(stageOf(a)) && !a.linensCounted).map((a: any) => ({ ...a, startTime: typeof a.startTime === 'string' ? a.startTime : a.startTime?.toDate ? a.startTime.toDate().toISOString() : new Date(a.startTime).toISOString() }));
    return attendantQueue({ stations, kits: (kits || []).filter((k: any) => k.status !== 'retired'), kitTypes: kitTypes || [], linens: linens || [], outlook: linenOutlook(linens || [], ahead, services || []), now });
  }, [resources, protocols, kits, kitTypes, linens, appts, services, staff, now]);
  return { tasks, kits: kits || [], linens: linens || [], firestore };
}

export function Housekeeping({ tenantId, tenant, appts, services, staff, manager, onGo }: { tenantId: string; tenant: any; appts: any[]; services: any[]; staff: any[]; manager: boolean; onGo?: (where: OpsTask['goTo']) => void }) {
  const { tasks, kits, linens, firestore } = useHousekeeping(tenantId, appts, services, staff);
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<string | null>(null); const [setup, setSetup] = React.useState(false);
  const mode = housekeepingMode(tenant); const picked: string[] = Array.isArray(tenant?.ops?.attendantIds) ? tenant.ops.attendantIds.map(String) : [];
  const who = () => (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0];
  const actor = () => ({ type: 'user' as const, id: getAuth().currentUser?.uid, name: who() });
  if (!firestore) return null;
  const visible = tasks.filter((t) => manager || !t.managerOnly);

  const quick = async (t: OpsTask) => { setBusy(t.id); setMsg(null);
    try {
      if (t.kind === 'station') { await updateDoc(doc(firestore, 'tenants', tenantId, 'resources', t.refId), { 'readiness.claimedFor': (stationVisit(t) || null), 'readiness.claimedById': getAuth().currentUser?.uid || null, 'readiness.claimedByName': who().split(' ')[0] }); setMsg(`${t.title} — yours.`); }
      else if (t.kind === 'kit_clean') { const k = kits.find((x: any) => x.id === t.refId); const res = k ? moveKit(k, 'cleaning', { name: who(), manager }) : { error: 'That kit is gone.' };
        if ('error' in res) setMsg(res.error); else { await updateDoc(doc(firestore, 'tenants', tenantId, 'kits', k.id), { ...(res.patch as any), byId: getAuth().currentUser?.uid || null });
          void logAuditClient(firestore, tenantId, { action: 'kit.cleaning', targetType: 'kit', targetId: k.id, actor: actor(), before: { status: 'dirty' }, after: { status: 'cleaning' }, summary: `${k.name} ${k.code}: ${KIT_LABEL.dirty} → ${KIT_LABEL.cleaning}` }); } }
      else if (t.kind === 'wash_start' || t.kind === 'wash_done') { const l = linens.find((x: any) => x.id === t.refId); if (l) { const move = t.kind === 'wash_start' ? 'wash' : 'washed'; const r = moveLinen(l, move, t.kind === 'wash_start' ? l.dirty : l.washing); const at = new Date().toISOString();
          await updateDoc(doc(firestore, 'tenants', tenantId, 'linens', l.id), { clean: r.clean, dirty: r.dirty, washing: r.washing, inUse: r.inUse, by: who(), at, ...(move === 'wash' ? { washStartedAt: at, washById: getAuth().currentUser?.uid || null } : r.washing === 0 ? { washStartedAt: null } : {}) });
          void logAuditClient(firestore, tenantId, { action: `linen.${move}`, targetType: 'linen', targetId: l.id, actor: actor(), before: { clean: l.clean, dirty: l.dirty, washing: l.washing }, after: { clean: r.clean, dirty: r.dirty, washing: r.washing }, summary: `${l.name}: ${move === 'wash' ? 'Wash load started' : 'Wash load finished'} × ${r.moved}` }); } }
    } catch { setMsg('That didn’t save — try again.'); }
    setBusy(null); };
  // The visit a station's turnover belongs to (needed to mark "I'll take it" for that turnover only).
  const stationVisit = (t: OpsTask) => { const res = (appts || []).filter((a: any) => Array.isArray(a.requiredResourceIds) && a.requiredResourceIds.includes(t.refId) && ['ready_to_pay', 'complete'].includes(stageOf(a))); return res.sort((a: any, b: any) => String(b.actualEndTime || b.startTime).localeCompare(String(a.actualEndTime || a.startTime)))[0]?.id; };
  const quickLabel: Partial<Record<OpsTask['kind'], string>> = { station: 'I’ll take it', kit_clean: 'Start cleaning', wash_start: 'Start the load', wash_done: 'Done — clean' };
  const saveSetup = async (patch: any) => { try { await updateDoc(doc(firestore, 'tenants', tenantId), { ops: { ...(tenant?.ops || {}), ...patch } }); } catch { setMsg('That didn’t save — try again.'); } };

  return (
    <div className="space-y-2">
      {msg && <p className="text-[13px] font-medium" role="status">{msg}</p>}
      {!visible.length && <p className="rounded-2xl border bg-card p-4 text-[14px] text-muted-foreground">Nothing waiting — stations, kits and linens are all in hand.</p>}
      {visible.map((t, i) => (
        <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-3" style={t.score >= 75 ? { borderColor: 'var(--danger, #fca5a5)' } : undefined}>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold"><span className="mr-2 text-muted-foreground tabular-nums">{i + 1}</span>{t.title}</p>
            <p className={`text-[13px] ${t.score >= 75 ? 'font-semibold text-red-700' : 'text-muted-foreground'}`}>{t.detail}{t.kind === 'station' && t.dueAt ? <> · <LiveTimer until={t.dueAt} doneLabel="time’s up" /></> : null}</p>
            {t.kind === 'station' && t.ownerName && <p className="text-[12px] text-muted-foreground">{t.claimed ? `Taken by ${t.ownerName}` : mode === 'attendants' ? 'For housekeeping' : `${t.ownerName}’s to reset`}</p>}
          </div>
          <div className="flex gap-2">
            {quickLabel[t.kind] && !(t.kind === 'station' && t.claimed) && <button type="button" disabled={busy === t.id} onClick={() => quick(t)} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">{quickLabel[t.kind]}</button>}
            {onGo && (t.kind === 'station' || t.kind === 'inspect' || t.kind === 'kit_finish' || t.kind === 'kit_decide') && <button type="button" onClick={() => onGo(t.goTo)} className="h-9 rounded-full border px-3 text-[13px] font-semibold">{t.kind === 'station' ? 'Open steps' : 'Open'}</button>}
          </div>
        </div>))}
      {manager && (setup ? (
        <div className="space-y-2 rounded-2xl border bg-card p-3 text-[14px]">
          <p className="font-semibold">Who does housekeeping?</p>
          <label className="flex items-center gap-2"><input type="radio" name="hk" checked={mode === 'providers'} onChange={() => saveSetup({ housekeeping: 'providers' })} /> Each provider resets their own station</label>
          <label className="flex items-center gap-2"><input type="radio" name="hk" checked={mode === 'attendants'} disabled={!picked.length} onChange={() => saveSetup({ housekeeping: 'attendants' })} /> The people ticked below (pick at least one)</label>
          <div className="flex flex-wrap gap-2 pl-6">{(staff || []).filter((s: any) => s && s.id && s.active !== false && s.role !== 'renter').map((s: any) => { const on = picked.includes(s.id); return (
            <label key={s.id} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] ${on ? 'bg-foreground text-background' : ''}`}><input type="checkbox" className="sr-only" checked={on} onChange={() => { const next = on ? picked.filter((x) => x !== s.id) : [...picked, s.id]; saveSetup({ attendantIds: next, ...(next.length ? {} : { housekeeping: 'providers' }) }); }} />{String(s.name || 'Team member').split(' ')[0]}</label>); })}</div>
          <p className="text-[12px] text-muted-foreground">With named people, reset reminders go to them instead of the provider, and this list shows on their own Today screen.</p>
          <button type="button" onClick={() => setSetup(false)} className="h-9 rounded-full border px-3 text-[13px] font-semibold">Done</button>
        </div>
      ) : <button type="button" onClick={() => setSetup(true)} className="h-10 rounded-full border px-4 text-[13px] font-semibold">Who does housekeeping: {mode === 'attendants' ? `${picked.length} named` : 'each provider'}</button>)}
    </div>);
}
