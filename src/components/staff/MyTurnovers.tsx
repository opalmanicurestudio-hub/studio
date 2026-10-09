'use client';
// src/components/staff/MyTurnovers.tsx — A PROVIDER'S OWN TURNOVERS (O3). In a small studio the provider resets their own
// station, so the task shows on their own screen (not only at the front desk): the steps to tick, when it's due, who's
// next. Nothing shows when there's nothing to do. Same list and the same proof-of-turnover record as the desk.
import * as React from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { useDoc } from '@/firebase/firestore/use-doc';
import { Housekeeping } from '@/components/pos/desk/Housekeeping';
import { AskForHelp } from '@/components/pos/desk/AssistQueue';
import { Disinfection } from '@/components/pos/desk/Disinfection';
import { attendantIds } from '@/lib/attendant';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { Stations } from '@/components/pos/desk/Stations';
import { planSetAside } from '@/lib/setaside';
import { PrepPlan } from '@/components/pos/desk/PrepPlan';

export function MyTurnovers({ tenantId, staffId, appts, services, staff, everyone = false }: { tenantId: string; staffId: string; appts: any[]; services: any[]; staff: any[]; everyone?: boolean }) {
  const { firestore } = useFirebase();
  const resQ = useMemoFirebase(() => (!firestore || !tenantId) ? null : collection(firestore, `tenants/${tenantId}/resources`), [firestore, tenantId]);
  const protoQ = useMemoFirebase(() => (!firestore || !tenantId) ? null : collection(firestore, `tenants/${tenantId}/protocols`), [firestore, tenantId]);
  const { data: resources } = useCollection<any>(resQ); const { data: protocols } = useCollection<any>(protoQ);
  // Only visits from the last day matter for "what did I just finish".
  const recent = React.useMemo(() => { const from = Date.now() - 18 * 3600000; return (appts || []).filter((a: any) => { const t = Date.parse(String(a?.startTime?.toDate ? a.startTime.toDate().toISOString() : a?.startTime || '')); return Number.isFinite(t) && t >= from; }); }, [appts]);
  if (!firestore || !resources?.length) return null;
  return (
    <section aria-label="Your stations to reset">
      <Stations mine firestore={firestore} tenantId={tenantId} resources={resources} appts={recent} services={services || []} staff={staff || []} protocols={protocols || []}
        onlyRow={(r) => (r.status === 'turnover' || (everyone && r.status === 'inspect')) && (everyone || r.ownerId === staffId)} />
    </section>);
}

/** A provider's own next visits with the kit and linen bundle set aside for each (planned across the whole team). */
export function MyPrep({ tenantId, staffId, services, staff }: { tenantId: string; staffId: string; services: any[]; staff: any[] }) {
  const { firestore } = useFirebase(); const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  const since = React.useMemo(() => new Date(Date.now() - 12 * 3600000).toISOString(), []);
  const c = (n: string) => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, n) : null);
  const { data: all } = useCollection<any>(useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'appointments'), where('startTime', '>=', since)) : null), [firestore, tenantId, since]));
  const { data: kits } = useCollection<any>(useMemoFirebase(() => c('kits'), [firestore, tenantId])); const { data: kitTypes } = useCollection<any>(useMemoFirebase(() => c('kitTypes'), [firestore, tenantId]));
  const { data: bundles } = useCollection<any>(useMemoFirebase(() => c('linenBundles'), [firestore, tenantId])); const { data: linens } = useCollection<any>(useMemoFirebase(() => c('linens'), [firestore, tenantId]));
  const { data: resources } = useCollection<any>(useMemoFirebase(() => c('resources'), [firestore, tenantId]));
  const plan = React.useMemo(() => planSetAside({ visits: all || [], services: services || [], kits: kits || [], kitTypes: kitTypes || [], bundles: bundles || [], linens: linens || [], resources: resources || [], now, horizonHours: 10 }), [all, services, kits, kitTypes, bundles, linens, resources, now]);
  if (!kits?.length) return null;
  return <div className="rounded-2xl border bg-card p-3"><PrepPlan plan={plan} staff={staff || []} staffId={staffId} perProvider={5} title="Your next visits — set aside for you" /></div>;
}

/** On a team member's own Today screen: their own station resets — or, for someone named as housekeeping, the whole
 *  housekeeping queue and every station waiting to be reset. */
export function PortalHousekeeping({ tenantId, staffId, myAppts, services, staff }: { tenantId: string; staffId: string; myAppts: any[]; services: any[]; staff: any[] }) {
  const { firestore } = useFirebase();
  const tRef = useMemoFirebase(() => (firestore && tenantId ? doc(firestore, 'tenants', tenantId) : null), [firestore, tenantId]);
  const { data: tenant } = useDoc<any>(tRef as any);
  const isAttendant = attendantIds(tenant).includes(staffId);
  // Housekeeping people need everyone's visits from today, not only their own.
  const since = React.useMemo(() => new Date(Date.now() - 18 * 3600000).toISOString(), []);
  const aq = useMemoFirebase(() => (firestore && tenantId && isAttendant ? query(collection(firestore, 'tenants', tenantId, 'appointments'), where('startTime', '>=', since)) : null), [firestore, tenantId, isAttendant, since]);
  const { data: all } = useCollection<any>(aq); const [asking, setAsking] = React.useState(false); const [guide, setGuide] = React.useState(false);
  // The visit this person is in right now gives the request its station and client.
  const live: any = (myAppts || []).find((a: any) => String(a.status) === 'servicing' || (a.actualStartTime && !['completed', 'cancelled', 'no_show'].includes(String(a.status))));
  const ask = (
    <div className="rounded-2xl border bg-card p-3">
      {asking ? <AskForHelp tenantId={tenantId} context={live ? { visitId: live.id, clientName: live.clientName || null, resourceId: (live.requiredResourceIds || [])[0], stationName: live.stationName || undefined } : undefined} onDone={() => setAsking(false)} />
        : <button type="button" onClick={() => setAsking(true)} className="h-11 w-full rounded-full border text-sm font-semibold">Need something at your station?</button>}
      {asking && <button type="button" onClick={() => setAsking(false)} className="mt-2 h-9 px-2 text-sm text-muted-foreground">Close</button>}
      <button type="button" aria-expanded={guide} onClick={() => setGuide((g) => !g)} className="mt-2 h-11 w-full rounded-full border text-sm font-semibold">{guide ? 'Close the disinfection guide' : 'Disinfection guide and contact timers'}</button>
      {guide && <div className="mt-3"><Disinfection tenantId={tenantId} tenant={tenant} manager={false} scan={false} /></div>}
    </div>);
  if (!isAttendant) return <div className="space-y-3">{ask}<MyPrep tenantId={tenantId} staffId={staffId} services={services} staff={staff} /><MyTurnovers tenantId={tenantId} staffId={staffId} appts={myAppts} services={services} staff={staff} /></div>;
  const today = (all || []).filter((a: any) => String(a.startTime || '') <= new Date(Date.now() + 18 * 3600000).toISOString());
  return (
    <section aria-label="Housekeeping" className="space-y-3">
      {ask}
      <p className="text-sm font-semibold">Housekeeping</p>
      <Housekeeping view="focus" tenantId={tenantId} tenant={tenant} appts={today} services={services} staff={staff} manager={false} />
    </section>);
}
