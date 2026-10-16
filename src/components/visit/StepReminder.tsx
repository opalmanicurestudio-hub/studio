'use client';
// src/components/visit/StepReminder.tsx — "PROCESSING IS DONE", WHEREVER YOU ARE IN THE APP. Mounted once in the app
// shell. Watches the visits you're working on right now; when a processing step is about to end, or has ended, a small
// card appears (with a soft chime, and a phone notification when allowed) offering the next step in one tap. Each
// reminder shows once; dismissing it keeps it gone for this session.
import * as React from 'react';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { visitSteps, stepAlert } from '@/lib/phase-timeline';
import { openVisit } from '@/lib/visit-client';

const SEEN = 'cf_step_alerts_seen';
const seen = (): string[] => { try { return JSON.parse(sessionStorage.getItem(SEEN) || '[]'); } catch { return []; } };
const markSeen = (k: string) => { try { sessionStorage.setItem(SEEN, JSON.stringify([...seen(), k].slice(-60))); } catch { /* fine */ } };

function chime() {
  try { const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (!C) return; const ctx = new C(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, ctx.currentTime); o.frequency.setValueAtTime(660, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.62); } catch { /* no sound */ }
}

export function StepReminder() {
  const { appointments, services } = useInventory() as any; const { selectedTenant } = useTenant() as any; const { user } = useUser() as any;
  return <StepReminderView appointments={appointments || []} services={services || []} uid={user?.uid} tenantId={selectedTenant?.id} />;
}

/** The same reminder with its data passed in (the staff portal has its own). */
export function StepReminderView({ appointments, services, uid, tenantId }: { appointments: any[]; services: any[]; uid?: string | null; tenantId?: string | null }) {
  const { firestore } = useFirebase() as any;
  const [now, setNow] = React.useState(() => Date.now()); const [shown, setShown] = React.useState<any[]>([]); const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const mine = React.useMemo(() => (appointments || []).filter((a: any) => a?.status === 'servicing' && uid && (a.staffId === uid || Object.values(a.checkoutState?.serviceStaffOverrides || {}).includes(uid))), [appointments, uid]);
  React.useEffect(() => {
    if (!mine.length) { setShown([]); return; }
    const done = new Set(seen()); const next: any[] = [];
    for (const a of mine) { const svc = (services || []).find((s: any) => s.id === a.serviceId); if (!svc) continue;
      const al = stepAlert(visitSteps(svc, Number(a.clientExtraMinutes) || 0), a, now); if (!al || done.has(al.key)) continue; next.push({ ...al, a }); }
    setShown((cur) => { const fresh = next.filter((x) => !cur.some((c) => c.key === x.key));
      if (fresh.length) { chime(); try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) fresh.forEach((x) => new Notification(x.kind === 'processing_done' ? `${String(x.a.clientName || 'Your client').split(' ')[0]}: processing is done` : `${String(x.a.clientName || 'Your client').split(' ')[0]}: processing ends in a minute`, { body: x.nextLabel ? `Next: ${x.nextLabel}` : undefined, tag: x.key })); } catch { /* fine */ } }
      return next; });
  }, [mine, services, now]);
  // Ask once, quietly, the first time a reminder is needed: a notification only matters when the app is in the background.
  React.useEffect(() => { if (shown.length && typeof Notification !== 'undefined' && Notification.permission === 'default') { try { void Notification.requestPermission(); } catch { /* fine */ } } }, [shown.length]);
  if (!shown.length) return null;
  const dismiss = (k: string) => { markSeen(k); setShown((c) => c.filter((x) => x.key !== k)); };
  const goNext = async (x: any) => { if (!firestore || !tenantId || x.nextIndex == null) return; setBusy(x.key);
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'appointments', x.a.id), { [`stepStarts.${x.nextIndex}`]: new Date().toISOString(), timingUpdatedAt: new Date().toISOString() }); dismiss(x.key); } catch { /* stays up */ } setBusy(null); };
  return (
    <div className="pointer-events-none fixed inset-x-3 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5" style={{ bottom: 'calc(150px + env(safe-area-inset-bottom))' }} aria-live="polite">
      {shown.map((x) => { const first = String(x.a.clientName || 'Your client').split(' ')[0];
        return (
          <div key={x.key} role="status" className="pointer-events-auto w-full max-w-sm rounded-2xl p-4" style={{ background: '#16171a', color: '#fff', boxShadow: '0 16px 40px rgba(0,0,0,.25)', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
            <p className="text-[12px]" style={{ color: '#a3a5ab' }}>{x.kind === 'processing_done' ? (x.overMin > 0 ? `${x.label} ended ${x.overMin} min ago` : `${x.label} is done`) : `${x.label} ends in a minute`}</p>
            <p className="mt-0.5 text-[16px]">{first}{x.nextLabel ? ` · time for ${x.nextLabel.toLowerCase()}` : ' is ready for you'}</p>
            <div className="mt-3 flex gap-2">
              {x.nextIndex != null && x.kind === 'processing_done' && <button type="button" disabled={busy === x.key} onClick={() => void goNext(x)} className="h-10 flex-1 rounded-full text-[14px] font-semibold disabled:opacity-60" style={{ background: '#7fd1a5', color: '#16171a' }}>Start {String(x.nextLabel).toLowerCase()}</button>}
              <button type="button" onClick={() => { openVisit(x.a.id); dismiss(x.key); }} className="h-10 flex-1 rounded-full text-[14px] font-semibold" style={{ background: 'rgba(255,255,255,.12)' }}>Open</button>
              <button type="button" onClick={() => dismiss(x.key)} aria-label="Dismiss" className="h-10 rounded-full px-3 text-[14px]" style={{ color: '#a3a5ab' }}>Later</button>
            </div>
          </div>); })}
    </div>);
}
