'use client';
// src/components/pos/desk/Housekeeping.tsx — THE HOUSEKEEPING QUEUE on screen (O3): one list, most urgent first, of
// stations to reset, kits to clean or finish, and wash loads to start or put away. Quick jobs are one tap here; the
// rest open the screen where they're done. Managers choose who does housekeeping (each provider, or named attendants).
import * as React from 'react';
import { collection, doc, updateDoc, setDoc, deleteDoc, addDoc, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { logAuditClient } from '@/lib/audit-client';
import { stationReadiness } from '@/lib/readiness';
import { stageOf } from '@/lib/visit';
import { moveKit, KIT_LABEL } from '@/lib/kits';
import { moveLinen, linenOutlook } from '@/lib/linens';
import { attendantQueue, housekeepingMode, taskLimit, tasksHeldBy, attendantsOnNow, type OpsTask } from '@/lib/attendant';
import { dayPrep } from '@/lib/day-prep';
import { forecastVisits, paceRunway, walkInMode } from '@/lib/demand';
import { useAssistQueue } from '@/components/pos/desk/AssistQueue';
import { LiveTimer } from '@/components/pos/desk/LiveTimer';

/** How many housekeeping jobs are waiting (for a button's badge). Loads the same records as the queue. */
export function useHousekeeping(tenantId: string | null | undefined, appts: any[], services: any[], staff: any[]) {
  const { firestore } = useFirebase(); const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const q = (name: string) => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, name) : null);
  const rq = useMemoFirebase(() => q('resources'), [firestore, tenantId]); const pq = useMemoFirebase(() => q('protocols'), [firestore, tenantId]);
  const kq = useMemoFirebase(() => q('kits'), [firestore, tenantId]); const tq = useMemoFirebase(() => q('kitTypes'), [firestore, tenantId]); const lq = useMemoFirebase(() => q('linens'), [firestore, tenantId]);
  const cq = useMemoFirebase(() => q('opsClaims'), [firestore, tenantId]); const { data: claims } = useCollection<any>(cq);
  const hSince = React.useMemo(() => new Date(Date.now() - 16 * 3600000).toISOString(), []);
  const hq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'opsHandovers'), where('at', '>=', hSince)) : null), [firestore, tenantId, hSince]); const { data: handovers } = useCollection<any>(hq);
  const requests = useAssistQueue(firestore, tenantId || null);   // what providers asked for from their stations, lounge orders, restocks
  const { data: resources } = useCollection<any>(rq); const { data: protocols } = useCollection<any>(pq); const { data: kits } = useCollection<any>(kq); const { data: kitTypes } = useCollection<any>(tq); const { data: linens } = useCollection<any>(lq);
  const tasks = React.useMemo(() => {
    const stations = stationReadiness(resources || [], appts || [], services || [], now, staff || [], protocols || []);
    const ahead = (appts || []).filter((a: any) => ['booked', 'waiting', 'in_service'].includes(stageOf(a)) && !a.linensCounted).map((a: any) => ({ ...a, startTime: typeof a.startTime === 'string' ? a.startTime : a.startTime?.toDate ? a.startTime.toDate().toISOString() : new Date(a.startTime).toISOString() }));
    // The pace right now (the last hour): clean kits or linens that will run out soon become jobs, bookings or not.
    const prep: OpsTask[] = paceRunway({ visits: appts || [], services: services || [], kits: kits || [], linens: linens || [], now }).filter((r) => r.minutesLeft < 60).map((r) => ({
      id: `pace:${r.kind}:${r.id}`, kind: 'prep' as const, refId: r.id, goTo: r.kind === 'kit' ? 'kits' as const : 'linens' as const, dueAt: new Date(now + r.minutesLeft * 60000).toISOString(),
      title: r.kind === 'kit' ? `Get more ${String(r.name).toLowerCase()}s clean` : `Get more ${String(r.name).toLowerCase()}s clean`,
      detail: r.clean === 0 ? `None clean, and ${r.perHour} an hour are being used` : `${r.clean} clean · using ${r.perHour} an hour · about ${r.minutesLeft} min left at this pace`, score: r.minutesLeft <= 15 ? 92 : r.minutesLeft <= 30 ? 82 : 55 }));
    return attendantQueue({ stations, kits: (kits || []).filter((k: any) => k.status !== 'retired'), kitTypes: kitTypes || [], linens: linens || [], outlook: linenOutlook(linens || [], ahead, services || []), requests, claims: claims || [], prep, now });
  }, [resources, protocols, kits, kitTypes, linens, appts, services, staff, now, requests, claims]);
  return { tasks, kits: kits || [], kitTypes: kitTypes || [], linens: linens || [], claims: claims || [], handovers: handovers || [], firestore };
}

const claimId = (taskId: string) => taskId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
async function assistApi(body: any) { const tk = await getAuth().currentUser?.getIdToken();
  const r = await fetch('/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'That didn’t work.' })); }
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const toDate = (v: any) => new Date(typeof v === 'string' ? v : v?.toDate ? v.toDate() : v?.seconds ? v.seconds * 1000 : v);

export function Housekeeping({ tenantId, tenant, appts, services, staff, manager, onGo, allAppts }: { tenantId: string; tenant: any; appts: any[]; services: any[]; staff: any[]; manager: boolean; onGo?: (where: OpsTask['goTo']) => void; allAppts?: any[] }) {
  const { tasks, kits, kitTypes, linens, handovers, firestore } = useHousekeeping(tenantId, appts, services, staff);
  const [noteFor, setNoteFor] = React.useState<string | null>(null); const [note, setNote] = React.useState(''); const [ending, setEnding] = React.useState(false);
  const [prepDay, setPrepDay] = React.useState<'today' | 'tomorrow'>('tomorrow');
  const me = getAuth().currentUser?.uid || null;
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<string | null>(null); const [setup, setSetup] = React.useState(false);
  const mode = housekeepingMode(tenant); const picked: string[] = Array.isArray(tenant?.ops?.attendantIds) ? tenant.ops.attendantIds.map(String) : [];
  const who = () => (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0];
  const actor = () => ({ type: 'user' as const, id: getAuth().currentUser?.uid, name: who() });
  const visible = tasks.filter((t) => manager || !t.managerOnly);
  const mine = tasksHeldBy(tasks, me, who()); const limit = taskLimit(tenant); const crew = attendantsOnNow(tenant, staff);
  const audit = (action: string, summary: string, targetId?: string, extra: any = {}) => { void logAuditClient(firestore, tenantId, { action, targetType: 'housekeeping', targetId, actor: actor(), summary, ...extra }); };
  // The latest shift note that hasn't been acknowledged (so the next person starts knowing what was left).
  const handover = [...handovers].filter((h: any) => !h.ackAt && h.byId !== me).sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)))[0] || null;
  // Ready for the day: the chosen day's bookings (+ walk-in allowance) against kits and linens.
  const wiMode = walkInMode(tenant);
  const fc = React.useMemo(() => { const d = new Date(); if (prepDay === 'tomorrow') d.setDate(d.getDate() + 1);
    return forecastVisits({ appts: (allAppts && allAppts.length ? allAppts : appts) || [], target: d.getTime(), mode: wiMode }); }, [prepDay, allAppts, appts, wiMode]);
  const prep = React.useMemo(() => dayPrep({ visits: fc.visits, services, kits: kits as any, kitTypes: kitTypes as any, linens: linens as any, walkIns: wiMode === 'fixed' ? tenant?.ops?.walkIns || null : null }), [fc, services, kits, kitTypes, linens, wiMode, tenant?.ops?.walkIns]);
  const take = async (t: OpsTask) => { if (mine.length >= limit) { setMsg(`You already have ${mine.length} job${mine.length === 1 ? '' : 's'} — finish one or hand it over first.`); return false; }
    try { await setDoc(doc(firestore, 'tenants', tenantId, 'opsClaims', claimId(t.id)), { taskId: t.id, title: t.title, byId: me, byName: who().split(' ')[0], at: new Date().toISOString(), handover: null }); audit('housekeeping.taken', `${who()} took: ${t.title}`, t.id); return true; } catch { setMsg('That didn’t save — try again.'); return false; } };
  const handOver = async (t: OpsTask, text: string) => { const at = new Date().toISOString(); const ho = { from: who().split(' ')[0], note: text.trim().slice(0, 200), at };
    try { if (t.kind === 'station') await updateDoc(doc(firestore, 'tenants', tenantId, 'resources', t.refId), { 'readiness.claimedFor': null, 'readiness.claimedById': null, 'readiness.claimedByName': null });
      if (t.kind === 'request' && t.request?.source === 'assist') { /* a request someone accepted stays theirs until delivered; the note tells the next person */ }
      await setDoc(doc(firestore, 'tenants', tenantId, 'opsClaims', claimId(t.id)), { taskId: t.id, title: t.title, byId: null, byName: null, at, handover: ho });
      audit('housekeeping.handed_over', `${who()} handed over: ${t.title}${ho.note ? ` — ${ho.note}` : ''}`, t.id); setNoteFor(null); setNote(''); setMsg('Handed over.'); } catch { setMsg('That didn’t save — try again.'); } };
  const endShift = async () => { const at = new Date().toISOString(); const text = note.trim().slice(0, 400);
    try { for (const t of mine) { if (t.kind === 'station') await updateDoc(doc(firestore, 'tenants', tenantId, 'resources', t.refId), { 'readiness.claimedFor': null, 'readiness.claimedById': null, 'readiness.claimedByName': null });
        await setDoc(doc(firestore, 'tenants', tenantId, 'opsClaims', claimId(t.id)), { taskId: t.id, title: t.title, byId: null, byName: null, at, handover: { from: who().split(' ')[0], note: 'Left at the end of their shift', at } }); }
      await addDoc(collection(firestore, 'tenants', tenantId, 'opsHandovers'), { byId: me, byName: who(), at, note: text || null, left: mine.map((t) => t.title), waiting: visible.length, ackAt: null });
      audit('housekeeping.shift_end', `${who()} ended their housekeeping shift — ${visible.length} job${visible.length === 1 ? '' : 's'} waiting${mine.length ? `, ${mine.length} handed back` : ''}${text ? ` — ${text}` : ''}`);
      setEnding(false); setNote(''); setMsg('Shift note saved. The next person will see it.'); } catch { setMsg('That didn’t save — try again.'); } };

  const quick = async (t: OpsTask) => { setBusy(t.id); setMsg(null);
    try {
      if (t.kind === 'request') { const src = t.request?.source; if (src !== 'assist') { onGo?.('assist'); setBusy(null); return; }
        const r = await assistApi({ action: t.request?.status === 'accepted' ? 'deliver' : 'accept', tenantId, id: t.refId }); setMsg(r.ok ? (t.request?.status === 'accepted' ? 'Marked delivered.' : 'It’s yours — the provider has been told you’re on the way.') : r.error || 'That didn’t work.'); setBusy(null); return; }
      if (t.kind === 'station' && mine.length >= limit) { setMsg(`You already have ${mine.length} jobs — finish one or hand it over first.`); setBusy(null); return; }
      if (t.kind === 'station') audit('housekeeping.taken', `${who()} took: ${t.title}`, t.id);
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
  const quickLabel = (t: OpsTask): string | null => t.kind === 'request' ? (t.request?.source !== 'assist' ? null : t.request?.status === 'accepted' ? 'Delivered' : 'I’m on it') : ({ station: 'I’ll take it', kit_clean: 'Start cleaning', wash_start: 'Start the load', wash_done: 'Done — clean' } as any)[t.kind] || null;
  const saveSetup = async (patch: any) => { try { await updateDoc(doc(firestore, 'tenants', tenantId), { ops: { ...(tenant?.ops || {}), ...patch } }); audit('housekeeping.settings', `Housekeeping settings changed: ${Object.keys(patch).join(', ')}`, undefined, { after: patch }); } catch { setMsg('That didn’t save — try again.'); } };

  if (!firestore) return null;
  return (
    <div className="space-y-2">
      {housekeepingMode(tenant) === 'attendants' && <p className="text-[13px] text-muted-foreground">On housekeeping now: <b className="text-foreground">{crew.on.map((x: any) => String(x.name || '').split(' ')[0]).join(', ') || 'nobody'}</b>{crew.onBreak.length ? ` · on a break: ${crew.onBreak.map((x: any) => String(x.name || '').split(' ')[0]).join(', ')}` : ''}{!crew.on.length ? ' — reminders go to the providers and managers meanwhile' : ''}</p>}
      {handover && (
        <div className="space-y-1 rounded-2xl border-2 bg-card p-3" role="note">
          <p className="text-[13px] font-semibold">From {String(handover.byName || 'the last shift').split(' ')[0]} · {toDate(handover.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
          {handover.note && <p className="text-[14px]">{handover.note}</p>}
          {Array.isArray(handover.left) && handover.left.length > 0 && <p className="text-[13px] text-muted-foreground">Left part-way: {handover.left.join(' · ')}</p>}
          <button type="button" onClick={async () => { try { await updateDoc(doc(firestore, 'tenants', tenantId, 'opsHandovers', handover.id), { ackAt: new Date().toISOString(), ackBy: who() }); audit('housekeeping.shift_note_read', `${who()} read ${handover.byName || 'the last'} shift note`); } catch { /* shown again next time */ } }} className="h-9 rounded-full border px-3 text-[13px] font-semibold">Got it</button>
        </div>)}
      <div className="rounded-2xl border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] font-semibold">Ready for {prepDay}? <span className={`ml-1 rounded-full px-2 py-0.5 text-[12px] ${prep.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{prep.ready ? 'Yes' : `${prep.todo.length} to do`}</span></p>
          <div className="flex overflow-hidden rounded-full border text-[12px] font-semibold">{(['today', 'tomorrow'] as const).map((d) => <button key={d} type="button" aria-pressed={prepDay === d} onClick={() => setPrepDay(d)} className={`h-8 px-3 capitalize ${prepDay === d ? 'bg-foreground text-background' : ''}`}>{d}</button>)}</div>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">{fc.booked} booked{prepDay === 'today' ? ' still to come' : ''}{prep.walkIns ? ` + allowing for ${prep.walkIns} walk-in${prep.walkIns === 1 ? '' : 's'}` : ''}{fc.expectedWalkIns ? ` + about ${fc.expectedWalkIns} walk-ins expected` : ''}.{fc.basis ? ` ${fc.basis}` : ''}</p>
        {prep.todo.length > 0 && <ul className="mt-2 space-y-1">{prep.todo.map((t, i) => <li key={i} className="flex gap-2 text-[13px]"><span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />{t}</li>)}</ul>}
        {(prep.kits.length > 0 || prep.linens.length > 0) && <p className="mt-2 text-[12px] text-muted-foreground">{[...prep.kits.map((k) => `${k.name}: up to ${k.peak} at once, ${k.usable} usable, ${k.readyNow} clean now`), ...prep.linens.map((l) => `${l.name}: ${l.needed} needed, ${l.clean} clean now`)].join(' · ')}</p>}
        {!prep.kits.length && !prep.linens.length && <p className="mt-1 text-[12px] text-muted-foreground">Nothing booked that day uses a tracked kit or linen.</p>}
      </div>
      {msg && <p className="text-[13px] font-medium" role="status">{msg}</p>}
      {mine.length > 0 && <p className="text-[13px] text-muted-foreground">You have {mine.length} of {limit} jobs.</p>}
      {!visible.length && <p className="rounded-2xl border bg-card p-4 text-[14px] text-muted-foreground">Nothing waiting — stations, kits, linens and requests are all in hand.</p>}
      {visible.map((t, i) => { const isMine = mine.some((x) => x.id === t.id); const ql = quickLabel(t); const takeable = !t.claimed && (t.kind === 'kit_finish' || t.kind === 'kit_decide' || t.kind === 'inspect' || t.kind === 'prep'); return (
        <div key={t.id} className="rounded-2xl border bg-card p-3" style={t.score >= 75 ? { borderColor: 'var(--danger, #fca5a5)' } : undefined}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold"><span className="mr-2 text-muted-foreground tabular-nums">{i + 1}</span>{t.title}</p>
              <p className={`text-[13px] ${t.score >= 75 ? 'font-semibold text-red-700' : 'text-muted-foreground'}`}>{t.detail}{(t.kind === 'station' || t.kind === 'request') && t.dueAt ? <> · <LiveTimer until={t.dueAt} doneLabel="time’s up" /></> : null}</p>
              {t.claimed ? <p className="text-[12px] font-semibold">{isMine ? 'Yours' : `${String(t.claimedBy || 'Someone').split(' ')[0]} has it`}</p>
                : t.kind === 'station' && t.ownerName ? <p className="text-[12px] text-muted-foreground">{mode === 'attendants' ? 'For housekeeping' : `${t.ownerName}’s to reset`}</p> : null}
              {t.handover && !t.claimed && <p className="text-[12px] text-amber-800">Handed over by {t.handover.from}{t.handover.note ? `: “${t.handover.note}”` : ''}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {ql && !(t.kind === 'station' && t.claimed) && !(t.kind === 'request' && t.claimed && !isMine && t.request?.status === 'accepted' && false) && <button type="button" disabled={busy === t.id} onClick={async () => { if ((t.kind === 'kit_clean' || t.kind === 'wash_start') && !t.claimed && !(await take(t))) return; await quick(t); }} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40">{ql}</button>}
              {takeable && <button type="button" onClick={() => take(t)} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white">I’ll take it</button>}
              {onGo && (t.kind === 'station' || t.kind === 'inspect' || t.kind === 'kit_finish' || t.kind === 'kit_decide' || t.kind === 'prep' || (t.kind === 'request' && t.request?.source !== 'assist')) && <button type="button" onClick={() => onGo(t.goTo)} className="h-9 rounded-full border px-3 text-[13px] font-semibold">{t.kind === 'station' ? 'Open steps' : 'Open'}</button>}
              {isMine && t.kind !== 'request' && noteFor !== t.id && <button type="button" onClick={() => { setNoteFor(t.id); setNote(''); }} className="h-9 rounded-full border px-3 text-[13px]">Hand over</button>}
            </div>
          </div>
          {noteFor === t.id && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="What’s done and what’s left? (e.g. wiped down, tools still to do)" className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[14px]" />
              <button type="button" onClick={() => handOver(t, note)} className="h-10 rounded-xl bg-foreground px-3 text-[13px] font-semibold text-background">Hand over</button>
              <button type="button" onClick={() => setNoteFor(null)} className="h-10 px-2 text-[13px]">Cancel</button>
            </div>)}
        </div>); })}
      {ending ? (
        <div className="space-y-2 rounded-2xl border bg-card p-3">
          <p className="text-[14px] font-semibold">End your housekeeping shift</p>
          <p className="text-[12px] text-muted-foreground">{mine.length ? `Your ${mine.length} job${mine.length === 1 ? '' : 's'} go back on the list. ` : ''}Leave a note for whoever is next.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 400))} rows={2} placeholder="e.g. autoclave is mid-cycle, towels in the dryer, room 2 needs a deep clean" className="w-full rounded-xl border bg-background p-3 text-[14px]" />
          <div className="flex gap-2"><button type="button" onClick={endShift} className="h-10 rounded-xl bg-foreground px-4 text-[13px] font-semibold text-background">Save and end shift</button><button type="button" onClick={() => setEnding(false)} className="h-10 px-2 text-[13px]">Cancel</button></div>
        </div>
      ) : <button type="button" onClick={() => { setEnding(true); setNote(''); setNoteFor(null); }} className="h-10 rounded-full border px-4 text-[13px]">End my shift / leave a note</button>}
      {manager && (setup ? (
        <div className="space-y-2 rounded-2xl border bg-card p-3 text-[14px]">
          <p className="font-semibold">Who does housekeeping?</p>
          <label className="flex items-center gap-2"><input type="radio" name="hk" checked={mode === 'providers'} onChange={() => saveSetup({ housekeeping: 'providers' })} /> Each provider resets their own station</label>
          <label className="flex items-center gap-2"><input type="radio" name="hk" checked={mode === 'attendants'} disabled={!picked.length} onChange={() => saveSetup({ housekeeping: 'attendants' })} /> The people ticked below (pick at least one)</label>
          <div className="flex flex-wrap gap-2 pl-6">{(staff || []).filter((s: any) => s && s.id && s.active !== false && s.role !== 'renter').map((s: any) => { const on = picked.includes(s.id); return (
            <label key={s.id} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] ${on ? 'bg-foreground text-background' : ''}`}><input type="checkbox" className="sr-only" checked={on} onChange={() => { const next = on ? picked.filter((x) => x !== s.id) : [...picked, s.id]; saveSetup({ attendantIds: next, ...(next.length ? {} : { housekeeping: 'providers' }) }); }} />{String(s.name || 'Team member').split(' ')[0]}</label>); })}</div>
          <p className="text-[12px] text-muted-foreground">With named people, reset reminders go to them instead of the provider, and this list shows on their own Today screen.</p>
          <label className="block">Jobs one person can hold at once <input type="number" min={1} max={10} defaultValue={limit} onBlur={(e) => saveSetup({ maxTasksEach: Math.max(1, Math.min(10, Math.round(Number(e.target.value)) || 3)) })} className="ml-1 h-9 w-16 rounded-lg border bg-background px-2" /></label>
          <p className="pt-1 font-semibold">Walk-ins</p>
          {([['none', 'We don’t take walk-ins — plan on bookings only'], ['history', 'Learn from past days — plan for our busiest recent same weekday (best for walk-in salons)'], ['fixed', 'Allow for a set number a day']] as const).map(([m, label]) => (
            <label key={m} className="flex items-start gap-2"><input type="radio" name="wi" className="mt-1" checked={wiMode === m} onChange={() => saveSetup({ walkIns: { ...(tenant?.ops?.walkIns || {}), mode: m, ...(m === 'fixed' && !Number(tenant?.ops?.walkIns?.perDay) ? { perDay: 4 } : {}) } })} /> {label}</label>))}
          {wiMode === 'fixed' && <div className="flex flex-wrap items-center gap-2 pl-6">
            <label>Allow for <input type="number" min={0} max={200} defaultValue={Number(tenant?.ops?.walkIns?.perDay) || 0} onBlur={(e) => saveSetup({ walkIns: { ...(tenant?.ops?.walkIns || {}), mode: 'fixed', perDay: Math.max(0, Math.min(200, Math.round(Number(e.target.value)) || 0)) } })} className="mx-1 h-9 w-16 rounded-lg border bg-background px-2" /> a day, usually for</label>
            <select defaultValue={tenant?.ops?.walkIns?.serviceId || ''} onChange={(e) => saveSetup({ walkIns: { ...(tenant?.ops?.walkIns || {}), serviceId: e.target.value || null } })} aria-label="Usual walk-in service" className="h-9 rounded-lg border bg-background px-2 text-[13px]"><option value="">Choose a service…</option>{(services || []).filter((x: any) => x && x.type !== 'addon').map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </div>}
          <p className="text-[12px] text-muted-foreground">Whatever you choose, the queue also watches the pace of the last hour and warns when clean kits or linens will run out soon.</p>
          <button type="button" onClick={() => setSetup(false)} className="h-9 rounded-full border px-3 text-[13px] font-semibold">Done</button>
        </div>
      ) : <div className="flex flex-wrap gap-2"><a href={`/housekeeping/${tenantId}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border px-4 text-[13px] font-semibold">Open the wall screen</a><button type="button" onClick={() => setSetup(true)} className="h-10 rounded-full border px-4 text-[13px] font-semibold">Who does housekeeping: {mode === 'attendants' ? `${picked.length} named` : 'each provider'}</button></div>)}
    </div>);
}
