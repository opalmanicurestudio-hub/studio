'use client';
// src/hooks/use-checkins.ts — the visit link's live copies (on my way, running late, I'm here) for just the visits
// around today, rather than every copy the business ever had.
import { useEffect, useState } from 'react';
import { collection, documentId, onSnapshot, query, where } from 'firebase/firestore';
import { useFirebase } from '@/firebase/provider';
import { useTenant } from '@/context/TenantContext';

/** Live visit-link copies for a few tokens (chunks of 30), keyed by token. */
export function useCheckInsFor(tokens: string[]): Map<string, any> {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const key = tokens.join(',');
  const [map, setMap] = useState<Map<string, any>>(() => new Map());
  useEffect(() => {
    if (!firestore || !tenantId || !key) { setMap((m) => (m.size ? new Map() : m)); return; }
    const ids = key.split(','); const parts: Record<number, any[]> = {}; const unsubs: (() => void)[] = [];
    const publish = () => { const m = new Map<string, any>(); for (const list of Object.values(parts)) for (const d of list) m.set(d.id, d); setMap(m); };
    for (let i = 0; i < ids.length; i += 30) {
      const n = i;
      const q = query(collection(firestore, 'appointmentCheckIns'), where('tenantId', '==', tenantId), where(documentId(), 'in', ids.slice(i, i + 30)));
      unsubs.push(onSnapshot(q, (s) => { parts[n] = s.docs.map((d) => ({ ...(d.data() as any), id: d.id })); publish(); }, () => { parts[n] = []; publish(); }));
    }
    return () => unsubs.forEach((u) => u());
  }, [firestore, tenantId, key]);
  return map;
}
