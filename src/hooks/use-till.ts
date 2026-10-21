'use client';
// src/hooks/use-till.ts — the open till, if there is one, without reading every till session ever (the till history
// screen reads those).
import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useTenant } from '@/context/TenantContext';

export function useOpenTill(): { activeTill: any | null; openTills: any[]; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const q = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'tillSessions'), where('status', '==', 'open')) : null), [firestore, tenantId]);
  const r = useCollection<any>(q);
  const openTills = useMemo(() => r.data || [], [r.data]);
  return { activeTill: openTills[0] || null, openTills, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}
