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
import { cleansePlan } from '@/lib/cleanse';
import { delaySettings } from '@/lib/delay';
import { planSetAside } from '@/lib/setaside';
import { PrepPlan } from '@/components/pos/desk/PrepPlan';
import { setOutItem } from '@/lib/setout-client';
import { ProductionBoard, TimerGrid, type Running } from '@/components/pos/desk/ProductionBoard';
import { startCleanse } from '@/lib/cleanse-client';
import { moveLinen, linenOutlook, linenUpdate, afterWash, loadDecision, LINEN_MOVE_LABEL, type LinenMove } from '@/lib/linens';
import { attendantQueue, housekeepingMode, taskLimit, tasksHeldBy, attendantsOnNow, type OpsTask } from '@/lib/attendant';
import { dayPrep } from '@/lib/day-prep';
import { forecastVisits, paceRunway, walkInMode } from '@/lib/demand';
import { useAssistQueue } from '@/components/pos/desk/AssistQueue';
import { LiveTimer } from '@/components/pos/desk/LiveTimer';
import { TypeBadge, Initials } from '@/components/pos/desk/hk-ui';
import { Stations } from '@/components/pos/desk/Stations';

/** How many housekeeping jobs are waiting (for a button's badge). Loads the same records as the queue. */
export function useHousekeeping(tenantId: string | null | undefined, appts: any[], services: any[], staff: any[]) {
  const { firestore } = useFirebase(); const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const q = (name: string) => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, name) : null);
  const rq = useMemoFirebase(() => q('resources'), [firestore, tenantId]); const pq = useMemoFirebase(() => q('protocols'), [firestore, tenantId]);
  const kq = useMemoFirebase(() => q('kits'), [firestore, tenantId]); const dq = useMemoFirebase(() => q('disinfectants'), [firestore, tenantId]); const { data: disinfectants } = useCollection<any>(dq); const tq = useMemoFirebase(() => q('kitTypes'), [firestore, tenantId]); const lq = useMemoFirebase(() => q('linens'), [firestore, tenantId]);
  const cq = useMemoFirebase(() => q('opsClaims'), [firestore, tenantId]); const { data: claims } = useCollection<any>(cq);
  const bq = useMemoFirebase(() => q('linenBundles'), [firestore, tenantId]); const { data: bundles } = useCollection<any>(bq);
  // Timers for the production board: steriliser cycles running and contact timers still open.
  // Rentals of rooms / stations today (booth reservations of a mirrored space) — they can need linens too.
  const rSince = React.useMemo(() => { const d = new Date(Date.now() - 24 * 3600000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, []);
  const rvq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'boothReservations'), where('startDate', '>=', rSince)) : null), [firestore, tenantId, rSince]); const { data: rentals } = useCollection<any>(rvq);
  const cyq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'sterilisationCycles'), where('status', '==', 'running')) : null), [firestore, tenantId]); const { data: cycles } = useCollection<any>(cyq);
  const ctq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'contactTimers'), where('doneAt', '==', null)) : null), [firestore, tenantId]); const { data: contacts } = useCollection<any>(ctq);
  const hSince = React.useMemo(() => new Date(Date.now() - 16 * 3600000).toISOString(), []);
  const hq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'opsHandovers'), where('at', '>=', hSince)) : null), [firestore, tenantId, hSince]); const { data: handovers } = useCollection<any>(hq);
  const requests = useAssistQueue(firestore, tenantId || null);   // what providers asked for from their stations, lounge orders, restocks
  const { data: resources } = useCollection<any>(rq); const { data: protocols } = useCollection<any>(pq); const { data: kits } = useCollection<any>(kq); const { data: kitTypes } = useCollection<any>(tq); const { data: linens } = useCollection<any>(lq);
  // The production plan: one kit / bundle set aside for each visit ahead, re-planned live.
  const plan = React.useMemo(() => planSetAside({ visits: appts || [], services: services || [], kits: (kits || []) as any, kitTypes: (kitTypes || []) as any, bundles: (bundles || []) as any, linens: (linens || []) as any, resources: resources || [], reservations: rentals || [], now }), [appts, services, kits, kitTypes, bundles, linens, resources, rentals, now]);
  const tasks = React.useMemo(() => {
    const stations = stationReadiness(resources || [], appts || [], services || [], now, staff || [], protocols || []);
    const ahead = (appts || []).filter((a: any) => ['booked', 'waiting', 'in_service'].includes(stageOf(a)) && !a.linensCounted).map((a: any) => ({ ...a, startTime: typeof a.startTime === 'string' ? a.startTime : a.startTime?.toDate ? a.startTime.toDate().toISOString() : new Date(a.startTime).toISOString() }));
    // The pace right now (the last hour): clean kits or linens that will run out soon become jobs, bookings or not.
    const prep: OpsTask[] = paceRunway({ visits: appts || [], services: services || [], kits: kits || [], linens: linens || [], now }).filter((r) => r.minutesLeft < 60).map((r) => ({
      id: `pace:${r.kind}:${r.id}`, kind: 'prep' as const, refId: r.id, goTo: r.kind === 'kit' ? 'kits' as const : 'linens' as const, dueAt: new Date(now + r.minutesLeft * 60000).toISOString(),
      title: `Get more ${/s$/i.test(String(r.name)) ? String(r.name).toLowerCase() : String(r.name).toLowerCase() + 's'} clean`,
      detail: r.clean === 0 ? `None clean, and ${r.perHour} an hour are being used` : `${r.clean} clean · using ${r.perHour} an hour · about ${r.minutesLeft} min left at this pace`, score: r.minutesLeft <= 15 ? 92 : r.minutesLeft <= 30 ? 82 : 55 }));
    // Shortages from the plan: a visit in the next 3 hours that won't have its kit or bundle in time.
    const fmt = (v: number) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    for (const sh of plan.shortages.filter((x) => x.startMs - now < 3 * 3600000)) { const left = Math.round((sh.startMs - now) / 60000);
      prep.push({ id: `short:${sh.visitId}:${sh.type}`, kind: 'prep', refId: sh.visitId, goTo: sh.kind === 'kit' ? 'kits' : 'linens', dueAt: new Date(sh.startMs).toISOString(),
        title: `${sh.type} needed for ${sh.clientName.split(' ')[0]} at ${fmt(sh.startMs)}`, detail: sh.state === 'none' ? `None available — get one cleansed or swap the service` : `Nothing free until ~${fmt(sh.freeAt!)} — speed one up, or move the visit`, score: left <= 30 ? 95 : left <= 60 ? 88 : 70 }); }
    return attendantQueue({ stations, kits: (kits || []).filter((k: any) => k.status !== 'retired'), kitTypes: kitTypes || [], linens: linens || [], outlook: linenOutlook(linens || [], ahead, services || [], resources || []), requests, claims: claims || [], prep, now });
  }, [resources, protocols, kits, kitTypes, linens, appts, services, staff, now, requests, claims, plan]);
  const running = React.useMemo((): Running[] => { const ms = (v: any) => Date.parse(String(v || '')) || 0; const out: Running[] = [];
    for (const k of (kits || []) as any[]) if (k.status === 'cleaning' && k.cleanse?.startedAt && !k.cleansedAt) out.push({ id: `c:${k.id}`, kind: 'cleanse', title: `${k.name} ${k.code}`, sub: `${k.cleanse.method === 'wipe' ? 'Wipe' : 'Soak'} · ${k.cleanse.name}`, startMs: ms(k.cleanse.startedAt), minutes: Number(k.cleanse.minutes) || 0 });
    for (const c of (cycles || []) as any[]) out.push({ id: `y:${c.id}`, kind: 'cycle', title: c.device || 'Steriliser', sub: [Array.isArray(c.kits) ? `${c.kits.length} kit${c.kits.length === 1 ? '' : 's'}` : null, c.number ? `cycle ${c.number}` : null].filter(Boolean).join(' · ') || 'Running', startMs: ms(c.startedAt), minutes: Number(c.minutes) || 0 });
    for (const l of (linens || []) as any[]) { if (Number(l.washing) > 0 && l.washStartedAt && Number(l.washMinutes) > 0) out.push({ id: `w:${l.id}`, kind: 'wash', title: `${l.name} × ${l.washing}`, sub: 'In the washer', startMs: ms(l.washStartedAt), minutes: Number(l.washMinutes) });
      if (Number(l.drying) > 0 && l.dryStartedAt && Number(l.dryMinutes) > 0) out.push({ id: `d:${l.id}`, kind: 'dry', title: `${l.name} × ${l.drying}`, sub: 'In the dryer', startMs: ms(l.dryStartedAt), minutes: Number(l.dryMinutes) }); }
    for (const t of (contacts || []) as any[]) if (!t.kitId && ms(t.startedAt) > Date.now() - 6 * 3600000) out.push({ id: `t:${t.id}`, kind: 'contact', title: t.what || 'Surface', sub: t.name || 'Disinfectant', startMs: ms(t.startedAt), minutes: Number(t.minutes) || 0 });
    return out; }, [kits, cycles, linens, contacts]);
  return { running, plan, bundles: bundles || [], tasks, kits: kits || [], kitTypes: kitTypes || [], linens: linens || [], claims: claims || [], handovers: handovers || [], resources: resources || [], protocols: protocols || [], disinfectants: disinfectants || [], firestore };
}

const claimId = (taskId: string) => taskId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
async function assistApi(body: any) { const tk = await getAuth().currentUser?.getIdToken();
  const r = await fetch('/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'That didn’t work.' })); }
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const toDate = (v: any) => new Date(typeof v === 'string' ? v : v?.toDate ? v.toDate() : v?.seconds ? v.seconds * 1000 : v);

export function Housekeeping({ tenantId, tenant, appts, services, staff, manager, onGo, allAppts, view = 'list' }: { tenantId: string; tenant: any; appts: any[]; services: any[]; staff: any[]; manager: boolean; onGo?: (where: OpsTask['goTo']) => void; allAppts?: any[]; view?: 'list' | 'lanes' | 'focus' | 'board' | 'timers' }) {
  const { running, plan, bundles, tasks, kits, kitTypes, linens, handovers, resources, protocols, disinfectants, firestore } = useHousekeeping(tenantId, appts, services, staff);
  // Set out: which kits / bundles are already at their station for a visit, and the tap that marks one.
  const setOut = React.useMemo(() => { const m: Record<string, string> = {}; for (const x of [...(kits || []), ...(bundles || [])] as any[]) if (x.setFor && (x.status === 'ready' || x.status === 'clean')) m[x.id] = x.setFor; return m; }, [kits, bundles]);
  const onSetOut = async (it: any, v: any) => { const a: any = (appts || []).find((x: any) => x.id === v.visitId); const st: any = a && Array.isArray(a.requiredResourceIds) ? (resources || []).find((r: any) => a.requiredResourceIds.includes(r.id)) : null; const e = await setOutItem(firestore, tenantId, it, v, st?.name || null); setMsg(e || `${it.type} ${it.code || ''} set out for ${String(v.clientName).split(' ')[0]}${st?.name ? ` at ${st.name}` : ''}.`); }; const [at, setAt] = React.useState(0);   // which job the focus view is on
  const [noteFor, setNoteFor] = React.useState<string | null>(null); const [note, setNote] = React.useState(''); const [ending, setEnding] = React.useState(false);
  const [prepDay, setPrepDay] = React.useState<'today' | 'tomorrow'>('tomorrow'); const [closeOpen, setCloseOpen] = React.useState(false);
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
      else if (t.kind === 'kit_clean') { const k = kits.find((x: any) => x.id === t.refId); const plan = k ? cleansePlan(k, kitTypes as any, disinfectants) : null;
        if (!k) setMsg('That kit is gone.'); else if (!plan) { setMsg(`Set how ${String(k.name).toLowerCase()}s are cleansed (in Kits, Set contents) — then start it.`); onGo?.('kits'); }
        else { const r = await startCleanse(firestore, tenantId, k, plan, { manager }); setMsg('error' in r ? r.error : `${k.name} ${k.code}: cleanse started — ${plan.disinfectant.contactMinutes} min. You’ll be told when it’s done.`); } }
      else if (['wash_start', 'wash_done', 'dry_done', 'fold'].includes(t.kind)) { const l: any = linens.find((x: any) => x.id === t.refId); if (l) {
          // Bundled linens are folded and checked tag by tag on the Linens screen; everything else is one tap here.
          if (t.kind === 'fold' && l.byBundle) { onGo?.('linens'); return; }
          const move: LinenMove = t.kind === 'wash_start' ? 'wash' : t.kind === 'wash_done' ? afterWash(l) : t.kind === 'dry_done' ? 'dried' : 'folded';
          const qty = t.kind === 'wash_start' ? loadDecision(l, linenOutlook([l], [], services || [])[0]?.short || 0).qty || l.dirty : t.kind === 'wash_done' ? l.washing : t.kind === 'dry_done' ? l.drying : l.folding;
          const r = moveLinen(l, move, qty);
          await updateDoc(doc(firestore, 'tenants', tenantId, 'linens', l.id), linenUpdate(l, move, r, { name: who(), uid: getAuth().currentUser?.uid || null }));
          void logAuditClient(firestore, tenantId, { action: `linen.${move}`, targetType: 'linen', targetId: l.id, actor: actor(), before: { clean: l.clean, dirty: l.dirty, washing: l.washing, drying: l.drying || 0, folding: l.folding || 0 }, after: { clean: r.clean, dirty: r.dirty, washing: r.washing, drying: r.drying, folding: r.folding }, summary: `${l.name}: ${LINEN_MOVE_LABEL[move]} × ${r.moved}` }); } }
    } catch { setMsg('That didn’t save — try again.'); }
    setBusy(null); };
  // The visit a station's turnover belongs to (needed to mark "I'll take it" for that turnover only).
  const stationVisit = (t: OpsTask) => { const res = (appts || []).filter((a: any) => Array.isArray(a.requiredResourceIds) && a.requiredResourceIds.includes(t.refId) && ['ready_to_pay', 'complete'].includes(stageOf(a))); return res.sort((a: any, b: any) => String(b.actualEndTime || b.startTime).localeCompare(String(a.actualEndTime || a.startTime)))[0]?.id; };
  const quickLabel = (t: OpsTask): string | null => t.kind === 'request' ? (t.request?.source !== 'assist' ? null : t.request?.status === 'accepted' ? 'Delivered' : 'I’m on it') : ({ station: 'I’ll take it', kit_clean: 'Start cleanse', wash_start: 'Start the load', wash_done: Number((linens.find((x: any) => x.id === t.refId) as any)?.dryMinutes) > 0 ? 'Into the dryer' : 'To fold', dry_done: 'To fold', fold: (linens.find((x: any) => x.id === t.refId) as any)?.byBundle ? 'Fold & tag-check' : 'Folded' } as any)[t.kind] || null;
  const saveSetup = async (patch: any) => { try { await updateDoc(doc(firestore, 'tenants', tenantId), { ops: { ...(tenant?.ops || {}), ...patch } }); audit('housekeeping.settings', `Housekeeping settings changed: ${Object.keys(patch).join(', ')}`, undefined, { after: patch }); } catch { setMsg('That didn’t save — try again.'); } };

  if (!firestore) return null;
  const first = (n?: string | null) => String(n || 'Someone').split(' ')[0];
  // One card, used by every layout. `big` = the single job in the focus view.
  const card = (t: OpsTask, big = false) => { const isMine = mine.some((x) => x.id === t.id); const ql = quickLabel(t); const urgent = t.score >= 75 && !t.claimed;
    const takeable = !t.claimed && (t.kind === 'kit_finish' || t.kind === 'kit_decide' || t.kind === 'inspect' || t.kind === 'prep');
    const primary = ql && !(t.kind === 'station' && t.claimed) ? { label: ql, run: async () => { if ((t.kind === 'kit_clean' || t.kind === 'wash_start') && !t.claimed && !(await take(t))) return; await quick(t); } } : takeable ? { label: 'I’ll take it', run: async () => { await take(t); } } : null;
    const canOpen = !!onGo && (t.kind === 'station' || t.kind === 'inspect' || t.kind === 'kit_finish' || t.kind === 'kit_decide' || t.kind === 'prep' || t.kind === 'laundry_setup' || (t.kind === 'request' && t.request?.source !== 'assist'));
    const steps = big && (t.kind === 'station' || t.kind === 'inspect');   // the focus view shows a station's steps right on the card
    return (
      <div key={t.id} className={`flex flex-col rounded-[20px] bg-card ${big ? 'gap-4 p-5' : 'gap-2.5 p-4'} ${urgent ? 'border-[2px] border-red-700' : 'border'}`}>
        <div className="flex items-center justify-between gap-2">
          <TypeBadge task={t} big={big} />
          <span className={`shrink-0 font-[800] tabular-nums ${big ? 'text-[34px]' : 'text-[18px]'} ${urgent ? 'text-red-700' : ''}`}>{t.kind === 'request' && !t.dueAt && t.score >= 90 ? 'Now' : t.dueAt ? <LiveTimer short until={t.dueAt} doneLabel="Now" className={`!font-[800] ${urgent ? '!text-red-700' : ''}`} /> : null}</span>
        </div>
        <p className={`font-[700] leading-tight ${big ? 'text-[30px]' : 'text-[18px]'}`}>{t.title}</p>
        <p className={`${big ? 'text-[16px]' : 'text-[14px]'} ${urgent ? 'font-semibold text-red-700' : 'text-muted-foreground'}`}>{t.detail}</p>
        {t.claimed ? <p className="flex items-center gap-2 text-[14px] font-bold"><Initials name={isMine ? who() : t.claimedBy} dark={!isMine} size={28} />{isMine ? 'You have this' : `${first(t.claimedBy)} has it`}</p>
          : t.kind === 'station' && t.ownerName ? <p className="text-[13px] text-muted-foreground">{mode === 'attendants' ? 'For housekeeping' : `${first(t.ownerName)}’s to reset`}</p> : null}
        {t.handover && !t.claimed && <p className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">Handed over by {t.handover.from}{t.handover.note ? `: “${t.handover.note}”` : ''}</p>}
        {steps && <Stations mine firestore={firestore} tenantId={tenantId} resources={resources} appts={appts} services={services} staff={staff} protocols={protocols} onlyRow={(r) => r.id === t.refId} />}
        {noteFor === t.id ? (
          <div className="flex flex-wrap gap-2">
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="What’s done and what’s left?" className="h-12 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[15px]" />
            <button type="button" onClick={() => handOver(t, note)} className="h-12 rounded-xl bg-foreground px-4 text-[14px] font-bold text-background">Hand over</button>
            <button type="button" onClick={() => setNoteFor(null)} className="h-12 px-2 text-[14px]">Cancel</button>
          </div>
        ) : (primary || canOpen || isMine) && (
          <div className="mt-auto flex flex-wrap gap-2">
            {primary && !steps && <button type="button" disabled={busy === t.id} onClick={primary.run} className={`flex-1 rounded-[14px] font-[700] disabled:opacity-40 ${big ? 'h-[60px] text-[19px]' : 'h-12 text-[15px]'} ${urgent || big ? 'bg-foreground text-background' : 'border-[1.5px] border-foreground bg-card'}`}>{primary.label}</button>}
            {canOpen && !steps && <button type="button" onClick={() => onGo!(t.goTo)} className={`rounded-[14px] border-[1.5px] font-bold ${primary ? 'px-4' : 'flex-1'} ${big ? 'h-[60px] text-[17px]' : 'h-12 text-[15px]'}`}>{t.kind === 'station' ? 'Open steps' : 'Open'}</button>}
            {isMine && t.kind !== 'request' && <button type="button" onClick={() => { setNoteFor(t.id); setNote(''); }} className={`rounded-[14px] border px-4 font-semibold ${big ? 'h-[60px] flex-1 text-[16px]' : 'h-12 text-[14px]'}`}>Hand over</button>}
          </div>)}
      </div>); };
  const doNow = visible.filter((t) => !t.claimed && t.score >= 75), nextUp = visible.filter((t) => !t.claimed && t.score < 75), inProgress = visible.filter((t) => t.claimed);
  const lane = (title: string, items: OpsTask[], tone: 'urgent' | 'plain') => (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between"><h3 className={`text-[18px] !font-[700] ${tone === 'urgent' && items.length ? 'text-red-700' : ''}`}>{title}</h3>
        <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[14px] font-extrabold ${tone === 'urgent' && items.length ? 'bg-red-700 text-white' : 'bg-muted'}`}>{items.length}</span></div>
      {items.length ? items.map((t) => card(t)) : <p className="rounded-[20px] border border-dashed p-4 text-[14px] text-muted-foreground">{tone === 'urgent' ? 'Nothing urgent.' : 'Nothing here.'}</p>}
    </section>);
  const topBits = (<>
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
  </>);
  const shiftBits = (<>
      {ending ? (
        <div className="space-y-2 rounded-2xl border bg-card p-3">
          <p className="text-[14px] font-semibold">End your housekeeping shift</p>
          <p className="text-[12px] text-muted-foreground">{mine.length ? `Your ${mine.length} job${mine.length === 1 ? '' : 's'} go back on the list. ` : ''}Leave a note for whoever is next.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 400))} rows={2} placeholder="e.g. autoclave is mid-cycle, towels in the dryer, room 2 needs a deep clean" className="w-full rounded-xl border bg-background p-3 text-[14px]" />
          <div className="flex gap-2"><button type="button" onClick={endShift} className="h-10 rounded-xl bg-foreground px-4 text-[13px] font-semibold text-background">Save and end shift</button><button type="button" onClick={() => setEnding(false)} className="h-10 px-2 text-[13px]">Cancel</button></div>
        </div>
      ) : <button type="button" onClick={() => { setEnding(true); setNote(''); setNoteFor(null); }} className="h-10 rounded-full border px-4 text-[13px]">End my shift / leave a note</button>}
  </>);
  const settingsBits = (<>
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
          <p className="pt-1 font-semibold">When a visit runs behind</p>
          {(() => { const dl = delaySettings(tenant); const put = (p: any) => saveSetup({ delay: { ...(tenant?.ops?.delay || {}), ...p } }); return <>
            <label className="block">Count it as behind after <input type="number" min={1} max={30} defaultValue={dl.marginMin} onBlur={(e) => put({ marginMin: Math.max(1, Math.min(30, Math.round(Number(e.target.value)) || 5)) })} className="mx-1 h-9 w-16 rounded-lg border bg-background px-2" aria-label="Minutes behind before anyone is told" /> min <span className="text-muted-foreground">(suggested: 5)</span></label>
            {([['desk', 'The front desk confirms each message first (suggested)'], ['auto', 'Text clients automatically when their start moves'], ['off', 'Never message clients about delays']] as const).map(([m, l]) => (
              <label key={m} className="flex items-start gap-2"><input type="radio" name="dl" className="mt-1" checked={dl.clientMessages === m} onChange={() => put({ clientMessages: m })} /> {l}</label>))}
            {dl.clientMessages === 'auto' && <label className="block pl-6">Only automatically up to <input type="number" min={5} max={90} defaultValue={dl.autoMaxMin} onBlur={(e) => put({ autoMaxMin: Math.max(5, Math.min(90, Math.round(Number(e.target.value)) || 20)) })} className="mx-1 h-9 w-16 rounded-lg border bg-background px-2" aria-label="Most minutes late to message automatically" /> min late — longer delays wait for the desk</label>}
            <label className="block">Offer keep / reschedule / cancel (no fee) from <input type="number" min={5} max={120} defaultValue={dl.choiceFromMin} onBlur={(e) => put({ choiceFromMin: Math.max(5, Math.min(120, Math.round(Number(e.target.value)) || 15)) })} className="mx-1 h-9 w-16 rounded-lg border bg-background px-2" aria-label="Minutes late before clients are offered a choice" /> min late <span className="text-muted-foreground">(suggested: 15)</span></label>
            <p className="text-[12px] text-muted-foreground">The desk, managers, the next provider and housekeeping are always told. A message goes again only if the delay grows by the same amount again.</p></>; })()}
          <button type="button" onClick={() => setSetup(false)} className="h-9 rounded-full border px-3 text-[13px] font-semibold">Done</button>
        </div>
      ) : <div className="flex flex-wrap gap-2"><a href={`/housekeeping/${tenantId}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border px-4 text-[13px] font-semibold">Open the wall screen</a><button type="button" onClick={() => setCloseOpen((x) => !x)} aria-pressed={closeOpen} className="h-10 rounded-full border px-4 text-[13px] font-semibold">{closeOpen ? 'Hide closing check' : 'Closing check'}</button><button type="button" onClick={() => setSetup(true)} className="h-10 rounded-full border px-4 text-[13px] font-semibold">Who does housekeeping: {mode === 'attendants' ? `${picked.length} named` : 'each provider'}</button></div>)}
  </>);
  const status = (<>
      {msg && <p className="text-[14px] font-semibold" role="status">{msg}</p>}
      {mine.length > 0 && view !== 'focus' && <p className="text-[13px] text-muted-foreground">You have {mine.length} of {limit} jobs.</p>}
  </>);
  const allClear = <p className="rounded-[20px] border bg-card p-6 text-center text-[16px] font-semibold text-emerald-800">All clear — stations, kits, linens and requests are in hand.</p>;

  // FOCUS: one job at a time (phones, and anyone working alone). Your own jobs first, then the most urgent unclaimed.
  if (view === 'focus') { const list = [...visible.filter((t) => mine.some((x) => x.id === t.id)), ...visible.filter((t) => !t.claimed)]; const cur = list.length ? list[Math.min(at, list.length - 1)] : null; const rest = list.filter((t) => t !== cur);
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between"><p className="text-[20px] font-[700]">{cur ? `Job ${Math.min(at, list.length - 1) + 1} of ${list.length}` : 'Housekeeping'}</p>
          {doNow.length > 0 && <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-[14px] font-bold"><span aria-hidden className="h-2 w-2 rounded-full bg-red-700" />{doNow.length} urgent</span>}</div>
        {status}
        {cur ? card(cur, true) : allClear}
        {rest.length > 0 && (<div className="space-y-2"><p className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground">Up next</p>
          <div className="flex gap-2">{rest.slice(0, 2).map((t) => <button key={t.id} type="button" onClick={() => setAt(list.indexOf(t))} className={`min-w-0 flex-1 rounded-2xl bg-card p-3 text-left ${t.score >= 75 ? 'border-2 border-red-700' : 'border'}`}><span className="block truncate text-[12px] font-bold text-muted-foreground">{t.detail}</span><span className="block text-[15px] font-extrabold leading-tight">{t.title}</span></button>)}
            {rest.length > 2 && <button type="button" onClick={() => setAt((Math.min(at, list.length - 1) + 1) % list.length)} aria-label="Next job" className="w-14 shrink-0 rounded-2xl border bg-card text-[15px] font-extrabold text-muted-foreground">+{rest.length - 2}</button>}</div></div>)}
        {handover && topBits}
        {shiftBits}
      </div>); }
  // LANES: the wall board — do now, next up, in progress, side by side.
  // CLOSING UP: once today's last visit is done (or on demand), what still needs finishing before the lights go off.
  const dayDone = (appts || []).length > 0 && (appts || []).every((a: any) => ['complete', 'cancelled', 'ready_to_pay'].includes(stageOf(a)) || ['completed', 'cancelled', 'no_show', 'declined'].includes(String(a.status)));
  const closing = (() => { const k = (kits || []) as any[]; const l = (linens || []) as any[]; const lines: { label: string; n: number }[] = [
      { label: 'Kits still marked in use', n: k.filter((x) => x.status === 'in_use').length },
      { label: 'Kits waiting for their cleanse', n: k.filter((x) => x.status === 'dirty').length },
      { label: 'Kits cleansing or waiting for the steriliser / check', n: k.filter((x) => x.status === 'cleaning').length },
      { label: 'Steriliser cycles without a result', n: running.filter((r) => r.kind === 'cycle').length },
      { label: 'Contact timers still open', n: running.filter((r) => r.kind === 'contact').length },
      { label: 'Loads in the washer or dryer', n: l.filter((x) => Number(x.washing) > 0).length + l.filter((x) => Number(x.drying) > 0).length },
      { label: 'Linens to fold and put away', n: l.reduce((a, x) => a + (Number(x.folding) || 0), 0) },
      { label: 'Linens in the bin', n: l.reduce((a, x) => a + (Number(x.dirty) || 0), 0) },
      { label: 'Stations to reset or check', n: visible.filter((t) => t.kind === 'station' || t.kind === 'inspect').length },
      { label: 'Requests not yet done', n: visible.filter((t) => t.kind === 'request').length } ];
    const left = lines.filter((x) => x.n > 0);
    return (
      <section aria-label="Closing up" className="rounded-[22px] bg-white p-4 shadow-[0_10px_24px_-18px_rgba(23,24,26,0.45)]" style={{ border: `1px solid ${left.length ? '#F0D9AE' : '#CDE7D4'}` }}>
        <p className="text-[16px] font-[800]">{left.length ? `Closing up — ${left.length} thing${left.length === 1 ? '' : 's'} left` : 'Closing up — all done'}</p>
        <ul className="mt-2 space-y-1">{lines.map((x) => <li key={x.label} className="flex items-center gap-2 text-[14px]"><span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-[800]" style={{ background: x.n ? '#FDF1DC' : '#E3F3E7', color: x.n ? '#7A4A00' : '#1F6B3A' }}>{x.n ? x.n : '✓'}</span><span style={{ color: x.n ? '#17181A' : '#8A847A' }}>{x.label}</span></li>)}</ul>
        <p className="mt-2 text-[12px] text-muted-foreground">Kits left in use after their visit move to “needs cleaning” by themselves; loads keep their timers overnight. Check tomorrow’s readiness in the card above.</p>
      </section>); })();
  const showClosing = dayDone || closeOpen;

  // TIMERS: just the countdown rings (the phone's Timers tab).
  if (view === 'timers') return <div className="space-y-3">{status}<TimerGrid running={running} /></div>;
  // BOARD: the production board — Now · Prepare · In process · Restock.
  if (view === 'board') { const RESTOCK = ['fold', 'kit_finish', 'kit_decide', 'laundry_setup'];
    const nowL = visible.filter((t) => !RESTOCK.includes(t.kind)).sort((a, b) => Number(!!a.claimed) - Number(!!b.claimed) || b.score - a.score);   // most urgent first, jobs already taken last
    const rest = visible.filter((t) => RESTOCK.includes(t.kind)).sort((a, b) => b.score - a.score);
    return (
      <div className="space-y-4">
        {topBits}{status}
        {showClosing && closing}
        <ProductionBoard now={nowL} restock={rest} plan={plan} running={running} card={(t) => card(t)} staff={staff || []} onSetOut={onSetOut} setOut={setOut} />
        {shiftBits}
      </div>); }
  if (view === 'lanes') return (
    <div className="space-y-4">
      {topBits}{status}
      {visible.length ? <div className="grid gap-5 lg:grid-cols-3">{lane('Do now', doNow, 'urgent')}{lane('Next up', nextUp, 'plain')}{lane('In progress', inProgress, 'plain')}</div> : allClear}
      <PrepPlan plan={plan} staff={staff || []} onSetOut={onSetOut} setOut={setOut} />
      {shiftBits}
    </div>);
  // LIST (the desk drawer): the same three groups, stacked.
  return (
    <div className="space-y-4">
      {topBits}{status}
      {showClosing && closing}
      {!visible.length ? allClear : <>{doNow.length > 0 && lane('Do now', doNow, 'urgent')}{nextUp.length > 0 && lane('Next up', nextUp, 'plain')}{inProgress.length > 0 && lane('In progress', inProgress, 'plain')}</>}
      <PrepPlan plan={plan} staff={staff || []} onSetOut={onSetOut} setOut={setOut} />
      {shiftBits}
      {settingsBits}
    </div>);
}
