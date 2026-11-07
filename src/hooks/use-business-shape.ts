'use client';
// src/hooks/use-business-shape.ts — HOW THE BUSINESS WORKS, on a staff screen (lib/business-shape): worked out from the
// team as it loads. Until the team is read (or if it can't be), what was chosen at signup is used; `ready` says when
// the team has been read, for a screen that prints or sends something with it.
import { collection, type Firestore } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { shapeOf, type BusinessShape } from '@/lib/business-shape';

export function useBusinessShape(tenantId: string | null | undefined, tenant: any): BusinessShape & { ready: boolean } {
  const { firestore } = useFirebase() as any;
  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/staff`) : null), [firestore, tenantId]);
  const { data, isLoading } = useCollection<any>(q);
  return { ...shapeOf(tenant, data || null), ready: !!q && !isLoading };
}
