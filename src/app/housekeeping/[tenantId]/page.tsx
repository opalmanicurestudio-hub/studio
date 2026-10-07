'use client';
// src/app/housekeeping/[tenantId]/page.tsx — THE HOUSEKEEPING WALL SCREEN. The same queue as the front desk, on its own
// full-screen page with large type, for a tablet or TV in the back room: what to do next, most urgent first, with the
// one-tap actions and each station's reset steps. Sign in on the screen once; it then stays live and updates itself.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { collection, doc, query, where } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useDoc } from '@/firebase/firestore/use-doc';
import { Housekeeping, useHousekeeping } from '@/components/pos/desk/Housekeeping';
import { MyTurnovers } from '@/components/staff/MyTurnovers';
import { attendantsOnNow, housekeepingMode } from '@/lib/attendant';

function Clock() { const [now, setNow] = React.useState(() => new Date()); React.useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="tabular-nums">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>; }

export default function HousekeepingWall() {
  const params = useParams<{ tenantId: string }>(); const tenantId = String(params?.tenantId || '');
  const { firestore } = useFirebase(); const { user, isUserLoading } = useUser() as any;
  const tRef = useMemoFirebase(() => (firestore && tenantId && user ? doc(firestore, 'tenants', tenantId) : null), [firestore, tenantId, user]);
  const { data: tenant } = useDoc<any>(tRef as any);
  const [since] = React.useState(() => new Date(Date.now() - 18 * 3600000).toISOString());
  const col = (name: string) => (firestore && tenantId && user ? collection(firestore, 'tenants', tenantId, name) : null);
  const aq = useMemoFirebase(() => (firestore && tenantId && user ? query(collection(firestore, 'tenants', tenantId, 'appointments'), where('startTime', '>=', since)) : null), [firestore, tenantId, user, since]);
  const sq = useMemoFirebase(() => col('services'), [firestore, tenantId, user]); const fq = useMemoFirebase(() => col('staff'), [firestore, tenantId, user]);
  const { data: apptsRaw } = useCollection<any>(aq); const { data: services } = useCollection<any>(sq); const { data: staff } = useCollection<any>(fq);
  // Today's visits for the live queue; everything loaded (a day back, and what's booked ahead) for the readiness check.
  const today = React.useMemo(() => { const d = new Date().toDateString(); return (apptsRaw || []).filter((a: any) => { const t = new Date(typeof a.startTime === 'string' ? a.startTime : a.startTime?.toDate?.() || a.startTime); return t.toDateString() === d; }); }, [apptsRaw]);
  const hk = useHousekeeping(user ? tenantId : null, today, services || [], staff || []);
  // Keep the screen awake where the browser allows it.
  React.useEffect(() => { let lock: any = null; const go = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch { /* not supported — the device's own setting applies */ } };
    void go(); const vis = () => { if (document.visibilityState === 'visible') void go(); }; document.addEventListener('visibilitychange', vis); return () => { document.removeEventListener('visibilitychange', vis); try { lock?.release(); } catch { /* gone already */ } }; }, []);
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(String(tenant?.bookingPageSettings?.cfPageConfig?.accentColor || '')) ? tenant.bookingPageSettings.cfPageConfig.accentColor : '#16171a';
  const crew = attendantsOnNow(tenant, staff || []);

  if (isUserLoading) return <main className="grid min-h-screen place-items-center text-lg text-muted-foreground">Loading…</main>;
  if (!user) return (
    <main className="grid min-h-screen place-items-center p-8 text-center">
      <div className="max-w-md space-y-3"><h1 className="text-2xl font-bold">Housekeeping screen</h1>
        <p className="text-muted-foreground">Sign in on this screen once with a team login. It stays signed in and keeps itself up to date.</p>
        <a href={`/login?next=${encodeURIComponent(`/housekeeping/${tenantId}`)}`} className="inline-flex h-12 items-center rounded-full bg-foreground px-6 font-semibold text-background">Sign in</a></div>
    </main>);
  const urgent = hk.tasks.filter((t) => t.score >= 75).length;
  return (
    <main className="min-h-screen bg-background" style={{ ['--accent' as any]: accent }}>
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b bg-background px-6 py-4" style={{ borderTop: `6px solid ${accent}` }}>
        <div><p className="text-sm font-semibold uppercase tracking-widest" style={{ color: accent }}>{tenant?.name || tenant?.businessName || 'Housekeeping'}</p>
          <h1 className="text-3xl font-bold md:text-4xl">Housekeeping</h1></div>
        <div className="flex items-center gap-6 text-right">
          {housekeepingMode(tenant) === 'attendants' && <p className="hidden text-base text-muted-foreground md:block">On now: <b className="text-foreground">{crew.on.map((s: any) => String(s.name || '').split(' ')[0]).join(', ') || 'nobody'}</b></p>}
          <p className="text-base"><b className={`text-3xl tabular-nums md:text-4xl ${urgent ? 'text-red-700' : ''}`}>{hk.tasks.length}</b> <span className="text-muted-foreground">waiting{urgent ? ` · ${urgent} urgent` : ''}</span></p>
          <p className="text-3xl font-bold md:text-4xl"><Clock /></p>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1600px] gap-6 p-6 lg:grid-cols-[3fr_2fr]" style={{ zoom: 1.2 } as any}>
        <section aria-label="What to do next"><Housekeeping tenantId={tenantId} tenant={tenant} appts={today} allAppts={apptsRaw || []} services={services || []} staff={staff || []} manager={false} /></section>
        <section aria-label="Station steps" className="space-y-3">
          <p className="text-[15px] font-semibold">Stations to reset</p>
          <MyTurnovers everyone tenantId={tenantId} staffId={user.uid} appts={today} services={services || []} staff={staff || []} />
          <p className="text-[13px] text-muted-foreground">Kits and linens are scanned at the front desk or on a phone: open Kits &amp; linens there.</p>
        </section>
      </div>
    </main>);
}
