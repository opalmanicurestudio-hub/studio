'use client';

/**
 * Feeds GuestsToday from live subscriptions so the POS page stays thin. The
 * shapes handed down mirror exactly what the booth hub used to build for it
 * (booth map, renter map, contact-by-key map, leases as { data }), so the
 * lifted handlers see the world they were written against.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { GuestsToday } from '@/components/booths/GuestsToday';

export function GuestsTodayPanel({ tenantId }: { tenantId: string }) {
  const { firestore } = useFirebase() as any;
  const [reservations, setReservations] = useState<any[]>([]);
  const [booths, setBooths] = useState<any[]>([]);
  const [renters, setRenters] = useState<any[]>([]);
  const [leases, setLeases] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [tenant, setTenant] = useState<any>(null);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const sub = (name: string, set: any) =>
      onSnapshot(collection(firestore, 'tenants', tenantId, name),
        (s) => set(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => {});
    const unsubs = [
      sub('boothReservations', setReservations), sub('booths', setBooths), sub('renters', setRenters),
      sub('leases', setLeases), sub('boothApplications', setApplications), sub('boothContacts', setContacts),
      onSnapshot(doc(firestore, 'tenants', tenantId), (s) => setTenant({ id: s.id, ...(s.data() as any) }), () => {}),
    ];
    return () => unsubs.forEach((u) => u());
  }, [firestore, tenantId]);

  const boothById = useMemo(() => new Map(booths.map((b) => [b.id, b])), [booths]);
  const renterById = useMemo(() => new Map(renters.map((r) => [r.id, r])), [renters]);
  const contactByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of contacts) if (c.key) m.set(c.key, c);
    return m;
  }, [contacts]);

  if (!tenantId) return null;
  return (
    <GuestsToday
      tenantId={tenantId}
      firestore={firestore}
      reservations={reservations}
      boothById={boothById}
      tenant={tenant}
      renters={renters}
      leases={{ data: leases }}
      applications={applications}
      renterById={renterById}
      contactByKey={contactByKey}
    />
  );
}
