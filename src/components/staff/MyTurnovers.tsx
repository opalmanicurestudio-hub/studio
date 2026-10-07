'use client';
// src/components/staff/MyTurnovers.tsx — A PROVIDER'S OWN TURNOVERS (O3). In a small studio the provider resets their own
// station, so the task shows on their own screen (not only at the front desk): the steps to tick, when it's due, who's
// next. Nothing shows when there's nothing to do. Same list and the same proof-of-turnover record as the desk.
import * as React from 'react';
import { collection } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { Stations } from '@/components/pos/desk/Stations';

export function MyTurnovers({ tenantId, staffId, appts, services, staff }: { tenantId: string; staffId: string; appts: any[]; services: any[]; staff: any[] }) {
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
        onlyRow={(r) => r.status === 'turnover' && r.ownerId === staffId} />
    </section>);
}
