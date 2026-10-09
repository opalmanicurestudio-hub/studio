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
import { Sterilisation } from '@/components/pos/desk/Sterilisation';
import { StationTiles } from '@/components/pos/desk/StationTiles';
import { Disinfection } from '@/components/pos/desk/Disinfection';
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
  // A wide screen gets the board (lanes + tiles); a phone gets one job at a time.
  const [wide, setWide] = React.useState(true); React.useEffect(() => { const m = window.matchMedia('(min-width: 1024px)'); const f = () => setWide(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);

  if (isUserLoading) return <main className="grid min-h-screen place-items-center text-lg text-muted-foreground">Loading…</main>;
  if (!user) return (
    <main className="grid min-h-screen place-items-center p-8 text-center">
      <div className="max-w-md space-y-3"><h1 className="text-2xl font-bold">Housekeeping screen</h1>
        <p className="text-muted-foreground">Sign in on this screen once with a team login. It stays signed in and keeps itself up to date.</p>
        <a href={`/login?next=${encodeURIComponent(`/housekeeping/${tenantId}`)}`} className="inline-flex h-12 items-center rounded-full bg-foreground px-6 font-semibold text-background">Sign in</a></div>
    </main>);
  const urgent = hk.tasks.filter((t) => t.score >= 75).length;
  return (
    <main className="min-h-screen bg-[#F6F3EE]" style={{ ['--accent' as any]: accent }}>
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 bg-[#17181A] px-6 py-4 text-white" style={{ borderBottom: `5px solid ${accent}` }}>
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D9C3A5]">{tenant?.name || tenant?.businessName || 'Housekeeping'}</p>
          <h1 className="text-3xl !font-[700] md:text-4xl">Housekeeping</h1></div>
        <div className="flex items-center gap-6 text-right">
          {housekeepingMode(tenant) === 'attendants' && <p className="hidden text-base text-[#CFCBC4] md:block">On now: <b className="text-white">{crew.on.map((s: any) => String(s.name || '').split(' ')[0]).join(', ') || 'nobody'}</b></p>}
          <p className="text-base"><b className={`text-3xl font-[800] tabular-nums md:text-4xl ${urgent ? 'text-[#FFB4A8]' : ''}`}>{hk.tasks.length}</b> <span className="text-[#CFCBC4]">waiting{urgent ? ` · ${urgent} urgent` : ''}</span></p>
          <p className="text-3xl font-[800] md:text-4xl"><Clock /></p>
        </div>
      </header>
      {wide ? (
        <div className="mx-auto grid max-w-[1900px] gap-7 p-6">
          <section aria-label="Production board"><Housekeeping view="board" tenantId={tenantId} tenant={tenant} appts={today} allAppts={apptsRaw || []} services={services || []} staff={staff || []} manager={false} /></section>
          <div className="grid gap-7 xl:grid-cols-3">
            <section aria-label="Sterilisers" className="space-y-3"><h2 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground">Sterilisers</h2><Sterilisation tenantId={tenantId} tenant={tenant} kits={hk.kits as any} manager={false} /></section>
            <section aria-label="Stations" className="space-y-3"><h2 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground">Stations</h2><StationTiles tenantId={tenantId} appts={today} services={services || []} staff={staff || []} /></section>
            <section aria-label="Disinfection" className="space-y-3"><h2 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground">Disinfection</h2><Disinfection tenantId={tenantId} tenant={tenant} manager={false} /></section>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-xl space-y-7 p-4">
          <Housekeeping view="focus" tenantId={tenantId} tenant={tenant} appts={today} allAppts={apptsRaw || []} services={services || []} staff={staff || []} manager={false} />
          <section aria-label="Stations" className="space-y-3"><h2 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground">Stations</h2><StationTiles tenantId={tenantId} appts={today} services={services || []} staff={staff || []} /></section>
          <section aria-label="Disinfection" className="space-y-3"><h2 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground">Disinfection</h2><Disinfection tenantId={tenantId} tenant={tenant} manager={false} /></section>
          <section aria-label="Sterilisers" className="space-y-3"><h2 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground">Sterilisers</h2><Sterilisation tenantId={tenantId} tenant={tenant} kits={hk.kits as any} manager={false} /></section>
        </div>)}
    </main>);
}
