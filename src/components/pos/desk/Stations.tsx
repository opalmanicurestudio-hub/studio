'use client';
// src/components/pos/desk/Stations.tsx — STATIONS (O2): every room and piece of equipment, live.
// Ready · In use (who, since when) · Turning over ("ready by 2:45 · 6 min") · Needs inspection · Blocked — plus who's
// next on it today. Actions: Mark ready (early), Needs inspection, Block (with a reason), Unblock. Status is worked out
// from the visits (lib/readiness), so it's right whichever screen moved a visit along.
import * as React from 'react';
import { doc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { logAuditClient } from '@/lib/audit-client';
import { LiveTimer } from '@/components/pos/desk/LiveTimer';
import { stationReadiness, READINESS_LABEL, type Readiness, type StationRow } from '@/lib/readiness';

const TONE: Record<Readiness, string> = { ready: 'bg-emerald-100 text-emerald-800', in_use: 'bg-sky-100 text-sky-800', turnover: 'bg-amber-100 text-amber-900', inspect: 'bg-violet-100 text-violet-900', blocked: 'bg-red-100 text-red-800' };
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

export function Stations({ firestore, tenantId, resources, appts, services, staff = [], protocols = [], onAsk, onlyRow, mine = false }: { onlyRow?: (r: StationRow) => boolean; mine?: boolean; firestore: any; tenantId: string; resources: any[]; appts: any[]; services: any[]; staff?: any[]; protocols?: any[]; onAsk?: (ctx: { resourceId: string; stationName: string; visitId?: string | null; clientName?: string | null }) => void }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const rows = React.useMemo(() => stationReadiness(resources, appts, services, now, staff, protocols), [resources, appts, services, now, staff, protocols]);
  const [ticked, setTicked] = React.useState<Record<string, number[]>>({});   // turnover steps ticked, per station
  const [busy, setBusy] = React.useState<string | null>(null); const [err, setErr] = React.useState<string | null>(null);
  const [blocking, setBlocking] = React.useState<string | null>(null); const [reason, setReason] = React.useState(''); const [quarProto, setQuarProto] = React.useState('');
  const who = () => getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff';
  // Every station action goes on the audit log (who, when, what).
  const save = async (id: string, patch: any, what?: { action: string; summary: string }) => { setBusy(id); setErr(null);
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'resources', id), patch);
      if (what) void logAuditClient(firestore, tenantId, { action: what.action, targetType: 'station', targetId: id, actor: { type: 'user', id: getAuth().currentUser?.uid, name: who() }, summary: what.summary }); }
    catch (e: any) { setErr('That didn’t save — try again.'); } setBusy(null); };
  // Ticked steps are saved on the station, so a reset can be started by one person and finished by another.
  const savedTicks = (r: StationRow): number[] => { const res: any = (resources || []).find((x: any) => x.id === r.id); const t = res?.readiness?.ticks; return t && t.visitId === (r.visitId || r.quarantine?.reason || 'q') && Array.isArray(t.done) ? t.done : []; };
  const ticksOf = (r: StationRow) => ticked[r.id] ?? savedTicks(r);
  const toggle = (r: StationRow, i: number) => { const cur = ticksOf(r); const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]; setTicked((t) => ({ ...t, [r.id]: next }));
    void updateDoc(doc(firestore, 'tenants', tenantId, 'resources', r.id), { 'readiness.ticks': { visitId: r.visitId || r.quarantine?.reason || 'q', done: next, by: who().split(' ')[0], at: new Date().toISOString() } }).catch(() => undefined); };
  const act = {
    ready: async (r: StationRow) => {
      const at = new Date().toISOString();
      await save(r.id, { readiness: { status: 'ready', at, by: who(), ...(r.checklist?.length ? { checklist: r.checklist } : {}) } }, { action: 'station.ready', summary: `${r.name} marked ready${r.clientName ? ` after ${r.clientName}` : ''}${r.overdueMin ? ` (${r.overdueMin} min late)` : ''}${r.checklist?.length ? ` — ${r.checklist.length} steps confirmed` : ''}` });
      // Proof of the turnover (who, when, which steps, how late) — kept for the owner's records.
      if (r.status === 'turnover') { try { await addDoc(collection(firestore, 'tenants', tenantId, 'turnoverLogs'), { resourceId: r.id, resourceName: r.name, visitId: r.visitId || null, clientName: r.clientName || null,
        steps: r.checklist || [], ownerName: r.ownerName || null, completedBy: who(), completedAt: at, readyBy: r.readyBy || null, minutesLate: r.overdueMin || 0,
        protocolId: r.protocolId || null, protocolName: r.protocolName || null, protocolVersion: r.protocolVersion || null }); } catch { /* the station is ready either way */ } }
      setTicked((t) => { const n = { ...t }; delete n[r.id]; return n; });
    },
    claim: (r: StationRow) => save(r.id, { 'readiness.claimedFor': r.visitId || null, 'readiness.claimedById': getAuth().currentUser?.uid || null, 'readiness.claimedByName': who().split(' ')[0] }, { action: 'station.taken', summary: `${who()} took the reset of ${r.name}` }),
    inspect: (r: StationRow) => save(r.id, { readiness: { status: 'inspect', at: new Date().toISOString(), by: who() } }, { action: 'station.inspect', summary: `${r.name} flagged for inspection` }),
    block: async (r: StationRow) => { const at = new Date().toISOString(); const q = quarProto ? { protocolId: quarProto === 'station' ? null : quarProto, reason: reason.trim() || null, at, by: who() } : null;
      await save(r.id, { isOutOfService: true, maintenanceNotes: reason.trim() || (q ? 'Quarantined' : 'Blocked at the desk'), quarantine: q, readiness: { status: 'blocked', at, by: who(), note: reason.trim() || null } }, { action: q ? 'station.quarantined' : 'station.blocked', summary: `${r.name} ${q ? 'quarantined' : 'blocked'}${reason.trim() ? ` — ${reason.trim()}` : ''}` }); setBlocking(null); setReason(''); setQuarProto(''); },
    // Quarantine release: only once its protocol is completed — logged as proof like a turnover.
    release: async (r: StationRow) => { const at = new Date().toISOString();
      await save(r.id, { isOutOfService: false, quarantine: null, readiness: { status: 'ready', at, by: who() } }, { action: 'station.released', summary: `${r.name} released from quarantine — ${r.quarantine?.steps.length || 0} steps confirmed` });
      try { await addDoc(collection(firestore, 'tenants', tenantId, 'turnoverLogs'), { kind: 'quarantine_release', resourceId: r.id, resourceName: r.name, reason: r.quarantine?.reason || null, steps: r.quarantine?.steps || [],
        protocolId: r.quarantine?.protocolId || null, protocolName: r.quarantine?.protocolName || null, protocolVersion: r.quarantine?.protocolVersion || null, completedBy: who(), completedAt: at }); } catch { /* released either way */ }
      setTicked((t) => { const n = { ...t }; delete n[r.id]; return n; }); },
    unblock: (r: StationRow) => save(r.id, { isOutOfService: false, readiness: { status: 'ready', at: new Date().toISOString(), by: who() } }, { action: 'station.unblocked', summary: `${r.name} unblocked` }),
  };
  if (mine && !rows.some((r) => !onlyRow || onlyRow(r))) return null;   // a provider's own list: nothing to do, nothing shown
  if (!rows.length) return <p className="text-[14px] text-muted-foreground">No rooms or equipment yet — add them under Resources, then link them to services.</p>;
  const order: Readiness[] = ['turnover', 'inspect', 'blocked', 'in_use', 'ready'];
  const sorted = [...rows].filter((r) => !onlyRow || onlyRow(r)).sort((a, b) => (b.overdueMin || 0) - (a.overdueMin || 0) || order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name));
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
                  {r.status === 'in_use' && <>With {r.clientName || 'a client'}{r.since ? <> since {time(r.since)} · <LiveTimer since={r.since} /></> : ''}</>}
                  {r.status === 'turnover' && (r.overdueMin ? <span className="font-semibold text-red-700">Overdue {r.overdueMin} min{r.clientName ? ` · after ${r.clientName}` : ''}</span> : <>Ready by {time(r.readyBy)} · <LiveTimer until={r.readyBy} doneLabel="Time’s up" />{r.clientName ? ` · after ${r.clientName}` : ''}</>)}
                  {r.quarantine ? <span className="font-semibold text-red-700">Quarantined{r.quarantine.reason ? ` — ${r.quarantine.reason}` : ''}{r.quarantine.protocolName ? ` · ${r.quarantine.protocolName}` : ''}</span>
                    : (r.status === 'blocked' || r.status === 'inspect') && (r.note || (r.status === 'inspect' ? 'Check it before the next client' : 'Out of service'))}
                  {r.status === 'ready' && 'Ready for the next client'}
                </p>
                {r.status === 'turnover' && r.ownerName && <p className="text-[12px] text-muted-foreground">{r.claimed ? `Taken by ${r.ownerName}` : `${r.ownerName}’s turnover`}{r.protocolName ? ` · ${r.protocolName} v${r.protocolVersion}` : ''}</p>}
                {r.next && <p className="text-[12px] text-muted-foreground">Next: {time(r.next.at)}{r.next.clientName ? ` · ${r.next.clientName}` : ''}</p>}
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${TONE[r.status]}`}>{READINESS_LABEL[r.status]}</span>
            </div>
            {blocking === r.id ? (
              <div className="mt-2 flex gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 120))} placeholder="Why? (e.g. chair broken)" className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[14px]" />
                <select value={quarProto} onChange={(e) => setQuarProto(e.target.value)} className="h-10 rounded-xl border bg-background px-2 text-[13px]" aria-label="Quarantine">
                  <option value="">Just block it</option>
                  <option value="station">Quarantine — station’s protocol</option>
                  {protocols.map((p: any) => <option key={p.id} value={p.id}>Quarantine — {p.name}</option>)}
                </select>
                <button type="button" disabled={busy === r.id} onClick={() => act.block(r)} className="h-10 rounded-xl bg-red-600 px-3 text-[13px] font-semibold text-white">Block</button>
                <button type="button" onClick={() => setBlocking(null)} className="h-10 rounded-xl px-2 text-[13px]">Cancel</button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {r.status === 'turnover' && !!r.checklist?.length && (
                  <ul className="w-full space-y-2 pb-1">{r.checklist.map((step, i) => { const on = ticksOf(r).includes(i); return (
                    <li key={i}><button type="button" aria-pressed={on} onClick={() => toggle(r, i)} className={`flex min-h-[52px] w-full items-center gap-3 rounded-2xl border-[1.5px] px-3 text-left text-[15px] font-semibold ${on ? 'border-emerald-700 bg-emerald-50' : 'bg-card'}`}><span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[15px] ${on ? 'bg-emerald-700 text-white' : 'border-2 border-stone-400'}`}>{on ? '✓' : ''}</span>{step}</button></li>); })}</ul>)}
                {(r.status === 'turnover' || r.status === 'inspect') && (() => { const need = r.status === 'turnover' && r.needsConfirm && ticksOf(r).length < (r.checklist || []).length;
                  return <button type="button" disabled={busy === r.id || need} onClick={() => act.ready(r)} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">{r.status === 'turnover' && r.needsConfirm ? 'Done — ready' : 'Mark ready'}</button>; })()}
                {r.status === 'turnover' && !mine && <button type="button" disabled={busy === r.id} onClick={() => act.claim(r)} className="h-9 rounded-full border px-3 text-[13px] disabled:opacity-50">I’ll do it</button>}
                {(r.status === 'ready' || r.status === 'turnover') && <button type="button" disabled={busy === r.id} onClick={() => act.inspect(r)} className="h-9 rounded-full border px-3 text-[13px] disabled:opacity-50">Needs inspection</button>}
                {r.status === 'in_use' && onAsk && <button type="button" onClick={() => onAsk({ resourceId: r.id, stationName: r.name, visitId: r.visitId, clientName: r.clientName })} className="h-9 rounded-full border px-3 text-[13px] font-semibold">Ask for help</button>}
                {r.status === 'blocked' && r.quarantine && (
                  <ul className="w-full space-y-2 pb-1">{r.quarantine.steps.map((step, i) => { const on = ticksOf(r).includes(i); return (
                    <li key={i}><button type="button" aria-pressed={on} onClick={() => toggle(r, i)} className={`flex min-h-[52px] w-full items-center gap-3 rounded-2xl border-[1.5px] px-3 text-left text-[15px] font-semibold ${on ? 'border-emerald-700 bg-emerald-50' : 'bg-card'}`}><span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[15px] ${on ? 'bg-emerald-700 text-white' : 'border-2 border-stone-400'}`}>{on ? '✓' : ''}</span>{step}</button></li>); })}</ul>)}
                {r.status === 'blocked'
                  ? (r.quarantine
                    ? <button type="button" disabled={busy === r.id || ticksOf(r).length < r.quarantine.steps.length} onClick={() => act.release(r)} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">Release from quarantine</button>
                    : <button type="button" disabled={busy === r.id} onClick={() => act.unblock(r)} className="h-9 rounded-full border px-3 text-[13px] font-semibold disabled:opacity-50">Unblock</button>)
                  : r.status !== 'in_use' && !mine && <button type="button" onClick={() => { setBlocking(r.id); setReason(''); }} className="h-9 rounded-full border px-3 text-[13px] text-red-700">Block</button>}
              </div>
            )}
          </div>);
      })}
    </div>
  );
}
