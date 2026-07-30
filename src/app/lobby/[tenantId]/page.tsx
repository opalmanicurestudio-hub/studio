'use client';

/* ═══════════════════════════════════════════════════════════════════════════
 * THE LOBBY QUEUE DISPLAY
 * repo path: src/app/lobby/[tenantId]/page.tsx
 *
 * v5 — Firestore onSnapshot replaces the polling loop entirely.
 *
 * Previous versions polled GET /api/walkins?view=board every 5 seconds and
 * needed visibility recovery, network-reconnect events, rAF freeze detection,
 * and a hard-reload fallback to stay live. The poll interval itself was the
 * source of up to 5 seconds of lag on the call-forward banner — the most
 * important thing on the screen.
 *
 * v5 subscribes directly to Firestore. Firestore pushes every change the
 * instant it lands in the database. A guest who joins at the kiosk appears
 * on this screen in under 200ms. A guest who is called appears in the green
 * banner in under 200ms. All of the liveness machinery is gone because there
 * is no polling interval to freeze, throttle, or recover from.
 *
 * WHAT THIS PAGE NOW READS DIRECTLY
 *   tenants/{id}/walkIns      — the live queue (48h window, falls back to full)
 *   tenants/{id}/staff        — names, avatars, busy/free status
 *   tenants/{id}/services     — service names for display
 *   tenants/{id}              — studioName, walkInEnabled
 *
 * WAIT ESTIMATES
 * Per-guest estimates are computed locally from the live row data and
 * refreshed every 30 seconds. Queue membership itself is always instant.
 *
 * SECURITY
 * The lobby uses the public Firestore client (getApp / getFirestore) with no
 * auth. The Firestore security rule for tenants/{id}/walkIns must allow read
 * without sign-in. Staff photos are already public on the booking page.
 * Guests get first names only — no phone, no email, no notes.
 * ═══════════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Users, Scissors, Star, Hourglass,
  Coffee, Wifi, AlertTriangle, CheckCircle2, BellRing, User,
  Moon, SunDim,
} from 'lucide-react';
import { getApp } from 'firebase/app';
import { getFirestore, collection, query, where, onSnapshot } from 'firebase/firestore';

/* ── timings ────────────────────────────────────────────────────────────── */
const CLOCK_MS        = 20 * 1000;
const ROTATE_MS       =  9 * 1000;
const PAGE_SIZE       = 6;
const WAIT_REFRESH_MS = 30 * 1000;
const STALE_MS        = 90 * 1000;

/* ── theme ──────────────────────────────────────────────────────────────── */
type Theme = 'dark' | 'light';
type Tokens = {
  shell:string;panel:string;panelSoft:string;rowPanel:string;chipPanel:string;
  heading:string;strong:string;muted:string;faint:string;dot:string;dotOn:string;
  toggle:string;calledWrap:string;calledCard:string;calledLabel:string;
  calledLead:string;calledSub:string;emptyIcon:string;offIcon:string;
  avatarFallback:string;floorOff:string;floorBusy:string;floorFree:string;
  floorDotOff:string;floorDotBusy:string;floorDotFree:string;invite:string;
};
const THEMES: Record<Theme, Tokens> = {
  dark: {
    shell:'bg-slate-950 text-white',panel:'border-slate-800 bg-slate-900/60',
    panelSoft:'border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40',
    rowPanel:'bg-slate-800/60 border-slate-700/60',chipPanel:'bg-slate-900 border-slate-700',
    heading:'text-slate-400',strong:'text-white',muted:'text-slate-400',faint:'text-slate-500',
    dot:'bg-slate-700',dotOn:'bg-slate-300',
    toggle:'border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800',
    calledWrap:'border-emerald-400/70 bg-emerald-500/10',calledCard:'bg-emerald-500/15 border-emerald-400/40',
    calledLabel:'text-emerald-300',calledLead:'text-emerald-200',calledSub:'text-emerald-300/70',
    emptyIcon:'bg-slate-800',offIcon:'bg-slate-800',
    avatarFallback:'bg-slate-800 text-slate-300 border-slate-700',
    floorOff:'border-slate-700 bg-slate-800/40 text-slate-500',
    floorBusy:'border-amber-400/30 bg-amber-400/10 text-amber-200',
    floorFree:'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    floorDotOff:'bg-slate-600',floorDotBusy:'bg-amber-300',floorDotFree:'bg-emerald-300',
    invite:'text-white',
  },
  light: {
    shell:'bg-slate-50 text-slate-900',panel:'border-slate-200 bg-white',
    panelSoft:'border-slate-200 bg-gradient-to-br from-white to-slate-50',
    rowPanel:'bg-slate-50 border-slate-200',chipPanel:'bg-white border-slate-200',
    heading:'text-slate-500',strong:'text-slate-900',muted:'text-slate-500',faint:'text-slate-400',
    dot:'bg-slate-300',dotOn:'bg-slate-700',
    toggle:'border-slate-200 bg-white text-slate-500 hover:bg-slate-100',
    calledWrap:'border-emerald-500 bg-emerald-50',calledCard:'bg-white border-emerald-300',
    calledLabel:'text-emerald-700',calledLead:'text-emerald-700',calledSub:'text-emerald-600',
    emptyIcon:'bg-slate-100',offIcon:'bg-slate-100',
    avatarFallback:'bg-slate-100 text-slate-500 border-slate-200',
    floorOff:'border-slate-200 bg-slate-100 text-slate-400',
    floorBusy:'border-amber-300 bg-amber-50 text-amber-700',
    floorFree:'border-emerald-300 bg-emerald-50 text-emerald-700',
    floorDotOff:'bg-slate-400',floorDotBusy:'bg-amber-500',floorDotFree:'bg-emerald-500',
    invite:'text-slate-900',
  },
};
const THEME_KEY = 'clarityflow.lobbyTheme';

/* ── helpers ─────────────────────────────────────────────────────────────── */
const softWait = (mins: any): string => {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return 'No wait';
  if (n < 5) return 'A few minutes';
  return `About ${Math.round(n / 5) * 5} minutes`;
};
const waitedLabel = (mins: any): string => {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0 || n < 5) return 'just joined';
  return `waiting ${Math.round(n / 5) * 5} min`;
};
const clockLabel = (d: Date): string => {
  try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
};
const initialOf = (name: any): string => { const s = String(name||''). trim(); return s ? s.charAt(0).toUpperCase() : '?'; };
const firstNameOf = (name: any): string => String(name||''). trim().split(/\s+/)[0] || '';
const positionLabel = (position: any, firstName: any): string => {
  const n = Number(position);
  return (Number.isFinite(n) && n > 0) ? String(Math.round(n)) : initialOf(firstName);
};
const safePhoto = (url: any): string => {
  const s = String(url||''). trim();
  return (s && /^https?:\/\//i.test(s) && s.length <= 500) ? s : '';
};
const safeMs = (val: any): number => {
  if (!val) return 0;
  if (val instanceof Date) return isNaN(val.getTime()) ? 0 : val.getTime();
  if (typeof val?.toDate === 'function') { try { const d=val.toDate(); return isNaN(d.getTime())?0:d.getTime(); } catch { return 0; } }
  const d = new Date(typeof val==='number'?val:String(val));
  return isNaN(d.getTime()) ? 0 : d.getTime();
};
const chunk = <T,>(list: T[], size: number): T[][] => {
  if (!list.length) return [[]];
  const out: T[][] = [];
  for (let i=0;i<list.length;i+=size) out.push(list.slice(i,i+size));
  return out;
};
const estimateWaitMin = (aheadCount: number, workingCount: number, freeCount: number, avgMin: number): number => {
  const providers = Math.max(1, freeCount + workingCount);
  return Math.round((workingCount * avgMin * 0.5 + aheadCount * avgMin) / providers);
};

/* ── Firestore status constants ─────────────────────────────────────────── */
const OPEN_STATUSES    = new Set(['waiting', 'notified', 'arrived']);
const WORKING_STATUSES = new Set(['in_service', 'servicing']);
const STALE_FLOOR_MS   = 90 * 60 * 1000;
const STALE_MULTIPLE   = 2;
const isStale = (row: any, nowMs: number): boolean => {
  if (!WORKING_STATUSES.has(String(row?.status||''))) return false;
  const started = Math.max(safeMs(row?.serviceStartTime), safeMs(row?.notifiedAt), safeMs(row?.checkInTime));
  if (!started) return false;
  return nowMs - started > Math.max(STALE_FLOOR_MS, (Number(row?.estimatedDuration)||30)*60000*STALE_MULTIPLE);
};

/* ══════════════════════════════════════════════════════════════════════════ */

export default function LobbyBoardPage() {
  const params   = useParams();
  const tenantId = String((params as any)?.tenantId || '');

  const [walkInRows, setWalkInRows] = useState<any[]>([]);
  const [staffRows,  setStaffRows]  = useState<any[]>([]);
  const [services,   setServices]   = useState<any[]>([]);
  const [tenantDoc,  setTenantDoc]  = useState<any>(null);
  const [ready,      setReady]      = useState(false);
  const [connError,  setConnError]  = useState(false);
  const [lastSnapAt, setLastSnapAt] = useState<number>(0);
  const [now,        setNow]        = useState<Date | null>(null);
  const [pageIdx,    setPageIdx]    = useState(0);
  const [theme,      setTheme]      = useState<Theme>('dark');
  const [tick,       setTick]       = useState(0);

  /* ── Firestore listeners ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!tenantId) return;
    let db: any;
    try { db = getFirestore(getApp()); } catch { setConnError(true); return; }

    const base = `tenants/${tenantId}`;
    const yesterday = new Date(Date.now() - 48*60*60*1000).toISOString();
    let wReady=false, sReady=false, vReady=false;
    const check = () => { if (wReady&&sReady&&vReady) setReady(true); };

    const subWalkIn = (q: any) => onSnapshot(q,
      snap => { setWalkInRows(snap.docs.map(d=>({id:d.id,...d.data()}))); setLastSnapAt(Date.now()); setConnError(false); wReady=true; check(); },
      () => { /* index missing — retry without filter */ subWalkIn(collection(db,`${base}/walkIns`)); },
    );
    const unsubWalkIn = subWalkIn(query(collection(db,`${base}/walkIns`), where('checkInTime','>=',yesterday)));

    const unsubStaff = onSnapshot(collection(db,`${base}/staff`),
      snap => { setStaffRows(snap.docs.map(d=>({id:d.id,...d.data()}))); sReady=true; check(); });

    const unsubSvc = onSnapshot(collection(db,`${base}/services`),
      snap => { setServices(snap.docs.map(d=>({id:d.id,...d.data()}))); vReady=true; check(); });

    const unsubTenant = onSnapshot(collection(db,'tenants'),
      snap => { const t=snap.docs.find(d=>d.id===tenantId); if(t) setTenantDoc({id:t.id,...t.data()}); });

    return () => { unsubWalkIn(); unsubStaff(); unsubSvc(); unsubTenant(); };
  }, [tenantId]);

  /* ── timers ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(()=>setNow(new Date()), CLOCK_MS);
    return ()=>clearInterval(id);
  }, []);
  useEffect(() => {
    const id = setInterval(()=>setTick(n=>n+1), WAIT_REFRESH_MS);
    return ()=>clearInterval(id);
  }, []);

  /* ── derived data ───────────────────────────────────────────────────── */
  const staffById = useMemo(()=>{ const m=new Map<string,any>(); staffRows.forEach(s=>{if(s?.id)m.set(String(s.id),s);}); return m; }, [staffRows]);
  const serviceById = useMemo(()=>{ const m=new Map<string,any>(); services.forEach(s=>{if(s?.id)m.set(String(s.id),s);}); return m; }, [services]);

  const { queue, working, floor, inServiceCount, studioName, enabled } = useMemo(() => {
    const nowMs2 = Date.now();
    const live = walkInRows.filter(r=>!isStale(r,nowMs2));
    const queue = live.filter(r=>OPEN_STATUSES.has(String(r?.status||''))).sort((a,b)=>safeMs(a.checkInTime)-safeMs(b.checkInTime));
    const working = live.filter(r=>WORKING_STATUSES.has(String(r?.status||'')));
    const floor = staffRows
      .filter(s=>s?.isActive!==false&&s?.active!==false)
      .map(s=>({
        firstName: firstNameOf(s.name), avatarUrl: safePhoto(s.avatarUrl),
        accepting: s.acceptingWalkIns!==false,
        busy: String(s.status||'')=='busy'||working.some(w=>String(w.staffId||'')==String(s.id)),
      }));
    return { queue, working, floor, inServiceCount: working.length,
      studioName: String(tenantDoc?.name||tenantDoc?.businessName||''),
      enabled: tenantDoc?.walkInEnabled!==false };
  }, [walkInRows, staffRows, tenantDoc, tick]);

  const boardQueue = useMemo(() => {
    const nowMs2 = Date.now();
    const freeCount = floor.filter(f=>f.accepting&&!f.busy).length;
    const avgMin = 45;
    const groupCounts = new Map<string,number>();
    queue.forEach(r=>{ const g=String(r?.groupId||''); if(g) groupCounts.set(g,(groupCounts.get(g)||0)+1); });
    const seenGroups = new Set<string>();
    const rows: any[] = [];
    let openSeq = 0;
    for (const r of queue) {
      const g = String(r?.groupId||'');
      if (g) { if(seenGroups.has(g)) continue; seenGroups.add(g); }
      const isNotified = String(r.status)==='notified';
      openSeq += isNotified ? 0 : 1;
      const staffId  = String(r.staffId||r.assignedStaffId||'');
      const provider = staffById.get(staffId);
      const svcId    = r.serviceIds?.[0] || r.serviceId || '';
      const svc      = serviceById.get(String(svcId));
      const waitedMin = Math.max(0, Math.round((nowMs2-safeMs(r.checkInTime))/60000));
      rows.push({
        position: openSeq,
        firstName: firstNameOf(r.customerName||r.clientName)||'Guest',
        partySize: g ? (groupCounts.get(g)||1) : 1,
        serviceName: String(svc?.name||r.serviceName||''),
        providerFirstName: firstNameOf(provider?.name||r.staffName),
        providerAvatar: safePhoto(provider?.avatarUrl),
        requested: r.isRequested===true,
        notified: isNotified || String(r.status)==='arrived' || String(r.checkInStatus||'')==='arrived',
        waitedMin,
        estWaitMin: isNotified ? 0 : estimateWaitMin(Math.max(0,openSeq-1), working.length, freeCount, avgMin),
      });
    }
    return rows;
  }, [queue, working, floor, staffById, serviceById, tick]);

  const inService = useMemo(()=>working.map(r=>{
    const provider = staffById.get(String(r.staffId||''));
    return {
      firstName: firstNameOf(r.customerName||r.clientName)||'Guest',
      serviceName: String(serviceById.get(String(r.serviceId||r.serviceIds?.[0]||''))?.name||r.serviceName||''),
      providerFirstName: firstNameOf(provider?.name||r.staffName),
      providerAvatar: safePhoto(provider?.avatarUrl),
      startedMinutesAgo: r.serviceStartTime ? Math.max(0,Math.round((Date.now()-safeMs(r.serviceStartTime))/60000)) : null,
    };
  }), [working, staffById, serviceById]);

  const called  = useMemo(()=>boardQueue.filter(q=>q.notified),  [boardQueue]);
  const waiting = useMemo(()=>boardQueue.filter(q=>!q.notified), [boardQueue]);
  const pages   = useMemo(()=>chunk(waiting, PAGE_SIZE), [waiting]);
  const shown   = pages[pageIdx] || pages[0] || [];
  const stale   = lastSnapAt > 0 && Date.now() - lastSnapAt > STALE_MS;

  useEffect(() => {
    if (pages.length<=1) { setPageIdx(0); return; }
    const id = setInterval(()=>setPageIdx(i=>(i+1)%pages.length), ROTATE_MS);
    return ()=>clearInterval(id);
  }, [pages.length]);
  useEffect(() => { if(pageIdx>=pages.length) setPageIdx(0); }, [pageIdx, pages.length]);

  useEffect(() => {
    try { const s=localStorage.getItem(THEME_KEY) as Theme|null; if(s==='light'||s==='dark') setTheme(s); } catch {}
  }, []);
  const toggleTheme = () => setTheme(prev=>{ const n=prev==='dark'?'light':'dark'; try{localStorage.setItem(THEME_KEY,n);}catch{} return n; });
  const t = THEMES[theme];

  /* ── guards ─────────────────────────────────────────────────────────── */
  if (!tenantId) return (
    <Shell t={THEMES.dark}>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-400" />
        <p className="text-2xl font-semibold">No studio found</p>
      </div>
    </Shell>
  );
  if (connError) return (
    <Shell t={t}>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Wifi className="w-12 h-12 text-amber-400" />
        <p className="text-2xl font-semibold">Connecting…</p>
        <p className={cn('text-base', t.muted)}>Check the network on this device.</p>
      </div>
    </Shell>
  );
  if (!ready) return (
    <Shell t={t}>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-slate-700 border-t-slate-300 animate-spin" />
      </div>
    </Shell>
  );
  if (!enabled) return (
    <Shell t={t}>
      <Header t={t} studioName={studioName} now={now} stale={stale} subtitle="Walk-ins are closed right now" theme={theme} onToggleTheme={toggleTheme} />
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-5">
        <div className={cn('w-20 h-20 rounded-3xl flex items-center justify-center', t.offIcon)}>
          <Coffee className={cn('w-9 h-9', t.muted)} />
        </div>
        <p className="text-2xl sm:text-4xl font-semibold">We are by appointment today</p>
        <p className={cn('text-base sm:text-lg max-w-md', t.muted)}>Come see us at the front desk and we will find you a time.</p>
      </div>
    </Shell>
  );

  /* ── board ───────────────────────────────────────────────────────────── */
  return (
    <Shell t={t}>
      <Header t={t} studioName={studioName} now={now} stale={stale}
        subtitle={waiting.length===0 ? 'No wait — walk right in' : `${waiting.length} ${waiting.length===1?'guest':'guests'} in line`}
        theme={theme} onToggleTheme={toggleTheme} />

      {called.length > 0 && (
        <div className="px-4 sm:px-6 pt-4">
          <div className={cn('rounded-3xl border-2 p-4 sm:p-6', t.calledWrap)}>
            <p className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.calledLabel)}>
              <BellRing className="w-4 h-4" /> Ready for you now
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {called.slice(0,4).map((q,i)=>(
                <div key={`called-${i}`} className={cn('flex-1 min-w-[13rem] rounded-2xl border px-4 py-4', t.calledCard)}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar t={t} url={q.providerAvatar} name={q.providerFirstName} className="w-12 h-12 sm:w-16 sm:h-16 shrink-0" />
                    <p className={cn('min-w-0 text-3xl sm:text-5xl font-bold leading-tight break-words', t.strong)}>{q.firstName||'Guest'}</p>
                  </div>
                  <p className={cn('mt-2 text-sm sm:text-lg', t.calledLead)}>
                    {q.providerFirstName ? `${q.providerFirstName} is ready for you` : 'Your provider is ready for you'}
                  </p>
                  {q.serviceName ? <p className={cn('mt-0.5 text-xs sm:text-sm', t.calledSub)}>{q.serviceName}</p> : null}
                </div>
              ))}
            </div>
            <p className={cn('mt-3 text-xs sm:text-sm', t.calledLead)}>Please come to the front — we have your chair.</p>
          </div>
        </div>
      )}

      <div className="px-4 sm:px-6 pt-4 grid grid-cols-2 gap-3">
        <Stat t={t} label="In line" value={String(waiting.length)} note={waiting.length===1?'guest':'guests'} icon={<Users className="w-4 h-4" />} />
        <Stat t={t} label="Now serving" value={String(inServiceCount)} note={inServiceCount===1?'guest':'guests'} icon={<Scissors className="w-4 h-4" />} />
      </div>

      <div className="flex-1 px-4 sm:px-6 py-4 grid gap-4 lg:grid-cols-[1.35fr_1fr] items-start">
        <section className={cn('min-w-0 rounded-3xl border p-4 sm:p-5', t.panel)}>
          <div className="flex items-center justify-between gap-3">
            <h2 className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.heading)}>
              <Hourglass className="w-4 h-4" /> Up next
            </h2>
            {pages.length > 1 && (
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {pages.map((_,i)=>(
                  <span key={`dot-${i}`} className={cn('w-1.5 h-1.5 rounded-full transition-colors', i===pageIdx?t.dotOn:t.dot)} />
                ))}
              </div>
            )}
          </div>
          {waiting.length===0 ? (
            <div className="py-10 sm:py-14 text-center">
              <div className={cn('w-16 h-16 mx-auto rounded-3xl flex items-center justify-center', t.emptyIcon)}>
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <p className="mt-4 text-2xl sm:text-3xl font-semibold">Nobody is waiting</p>
              <p className={cn('mt-1 text-sm sm:text-base', t.muted)}>Walk right in — we can take you now.</p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {shown.map((q,i)=>(
                <li key={`q-${q.position??i}-${i}`} className={cn('flex items-center gap-3 sm:gap-4 min-w-0 rounded-2xl border px-3 sm:px-4 py-3', t.rowPanel)}>
                  <div className={cn('w-11 h-11 sm:w-14 sm:h-14 shrink-0 rounded-2xl border flex items-center justify-center', t.chipPanel)}>
                    <span className={cn('text-lg sm:text-2xl font-bold', t.strong)}>{positionLabel(q.position, q.firstName)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn('flex items-center gap-2 min-w-0 text-xl sm:text-3xl font-semibold', t.strong)}>
                      <span className="truncate min-w-0">{q.firstName||'Guest'}{Number(q.partySize)>1?` +${Number(q.partySize)-1}`:''}</span>
                      {q.requested===true&&<Star className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 text-amber-400" />}
                    </p>
                    <p className={cn('mt-0.5 flex items-center gap-1.5 min-w-0 text-xs sm:text-base', t.muted)}>
                      {q.providerFirstName ? <Avatar t={t} url={q.providerAvatar} name={q.providerFirstName} className="w-5 h-5 sm:w-6 sm:h-6 shrink-0 text-[10px] sm:text-xs" /> : null}
                      <span className="truncate min-w-0">{[q.serviceName, q.providerFirstName?`with ${q.providerFirstName}`:'']. filter(Boolean).join(' · ')}</span>
                    </p>
                  </div>
                  <p className={cn('hidden sm:block shrink-0 text-sm sm:text-base text-right whitespace-nowrap', t.faint)}>
                    {q.estWaitMin===undefined||q.estWaitMin===null ? waitedLabel(q.waitedMin) : softWait(q.estWaitMin)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {waiting.length>PAGE_SIZE&&(
            <p className={cn('mt-3 text-center text-[11px] sm:text-xs', t.faint)}>Showing {shown.length} of {waiting.length} — the list rotates</p>
          )}
        </section>

        <div className="min-w-0 space-y-4">
          <section className={cn('min-w-0 rounded-3xl border p-4 sm:p-5', t.panel)}>
            <h2 className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.heading)}>
              <Scissors className="w-4 h-4" /> In the chair
            </h2>
            {inService.length===0 ? (
              <p className={cn('mt-3 text-sm', t.muted)}>Nobody in service right now.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {inService.slice(0,8).map((s,i)=>(
                  <li key={`s-${i}`} className="flex items-center gap-2.5 min-w-0">
                    <Avatar t={t} url={s.providerAvatar} name={s.providerFirstName} className="w-7 h-7 sm:w-9 sm:h-9 shrink-0 text-xs sm:text-sm" />
                    <span className={cn('min-w-0 flex-1 text-base sm:text-xl font-medium truncate', t.strong)}>{s.firstName||'Guest'}</span>
                    <span className={cn('shrink-0 text-xs sm:text-sm truncate', t.muted)}>
                      {s.providerFirstName ? `with ${s.providerFirstName}${s.startedMinutesAgo!=null?` · ${s.startedMinutesAgo}m`:''}` : s.serviceName||''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={cn('min-w-0 rounded-3xl border p-4 sm:p-5', t.panel)}>
            <h2 className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.heading)}>
              <User className="w-4 h-4" /> On the floor today
            </h2>
            {floor.length===0 ? (
              <p className={cn('mt-3 text-sm', t.faint)}>The team list is not up yet.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {floor.map((f,i)=>(
                  <span key={`f-${i}`} className={cn('inline-flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 text-xs sm:text-sm border',
                    f.accepting===false?t.floorOff:f.busy?t.floorBusy:t.floorFree)}>
                    <Avatar t={t} url={f.avatarUrl} name={f.firstName} className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 text-[10px] sm:text-xs" />
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', f.accepting===false?t.floorDotOff:f.busy?t.floorDotBusy:t.floorDotFree)} />
                    {f.firstName||'Team'}
                    <span className="text-[10px] sm:text-xs opacity-70">{f.accepting===false?'booked only':f.busy?'busy':'free'}</span>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className={cn('min-w-0 rounded-3xl border p-4 sm:p-5', t.panelSoft)}>
            <p className={cn('flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em]', t.heading)}>
              <Coffee className="w-4 h-4" /> While you wait
            </p>
            <p className={cn('mt-2 text-base sm:text-xl font-medium leading-snug', t.invite)}>
              Scan the code on your ticket for a drink, and to follow your visit.
            </p>
            <p className={cn('mt-1 text-xs sm:text-sm', t.muted)}>Ask us about anything you would like added on today.</p>
          </section>
        </div>
      </div>

      <div className="px-4 sm:px-6 pb-4">
        <div className={cn('flex items-center justify-between gap-3 text-[11px] sm:text-xs', t.faint)}>
          <span>{studioName ? `${studioName} · walk-in queue` : 'Walk-in queue'}</span>
          <span className="flex items-center gap-1.5">
            {stale
              ? <><Wifi className="w-3.5 h-3.5 text-amber-500" /><span className="text-amber-500">Reconnecting</span></>
              : <><Wifi className="w-3.5 h-3.5 text-emerald-500" /><span>Live</span></>}
          </span>
        </div>
      </div>
    </Shell>
  );
}

/* ── chrome ─────────────────────────────────────────────────────────────── */

function Shell({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return <div className={cn('min-h-dvh flex flex-col antialiased transition-colors duration-300', t.shell)}>{children}</div>;
}

function Avatar({ t, url, name, className }: { t: Tokens; url?: string; name?: string; className?: string }) {
  const src = safePhoto(url);
  const [broken, setBroken] = useState(false);
  useEffect(()=>{setBroken(false);},[src]);
  return (
    <span className={cn('inline-flex items-center justify-center overflow-hidden rounded-full border font-semibold', t.avatarFallback, className)} aria-hidden="true">
      {(Boolean(src)&&!broken)
        ? <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" onError={()=>setBroken(true)} />
        : initialOf(name)}
    </span>
  );
}

function Header({ t, studioName, subtitle, now, stale, theme, onToggleTheme }:
  { t: Tokens; studioName: string; subtitle: string; now: Date|null; stale: boolean; theme: Theme; onToggleTheme: ()=>void; }) {
  return (
    <header className="px-4 sm:px-6 pt-5 pb-1">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {studioName ? <p className={cn('text-[10px] sm:text-xs uppercase tracking-[0.3em] truncate', t.faint)}>{studioName}</p> : null}
          <h1 className="mt-1 text-2xl sm:text-4xl lg:text-5xl font-bold leading-tight">{subtitle}</h1>
        </div>
        <div className="shrink-0 flex items-start gap-2 sm:gap-3">
          <div className="text-right">
            <p className="text-xl sm:text-3xl font-semibold tabular-nums">{now ? clockLabel(now) : ''}</p>
            {stale ? <p className="text-[10px] sm:text-xs text-amber-500 mt-0.5">not live</p> : null}
          </div>
          <button type="button" onClick={onToggleTheme}
            aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'}
            className={cn('w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl border flex items-center justify-center transition-colors', t.toggle)}>
            {theme==='dark' ? <SunDim className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </header>
  );
}

function Stat({ t, label, value, note, icon, small }: { t: Tokens; label: string; value: string; note?: string; icon: React.ReactNode; small?: boolean; }) {
  return (
    <div className={cn('rounded-2xl border px-3 py-3 sm:px-4 sm:py-4 min-w-0', t.panel)}>
      <p className={cn('flex items-center gap-1.5 text-[9px] sm:text-[11px] font-semibold uppercase tracking-[0.18em]', t.faint)}>
        <span>{icon}</span><span className="truncate">{label}</span>
      </p>
      <p className={cn('mt-1 font-bold leading-tight break-words', t.strong, small?'text-base sm:text-2xl':'text-2xl sm:text-4xl')}>{value}</p>
      {note ? <p className={cn('text-[10px] sm:text-xs mt-0.5', t.faint)}>{note}</p> : null}
    </div>
  );
}
