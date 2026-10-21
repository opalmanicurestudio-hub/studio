'use client';
// src/hooks/use-redemptions.ts — THE REDEMPTION LOG, LIVE: every perk and package use for the business, newest first,
// a page at a time. Checkout and the planner write each redemption here as it happens (past ones were copied in once),
// so the ledger shows a redemption the moment it's made.
import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useTenant } from '@/context/TenantContext';

const NONE: any[] = [];

export function useRedemptionLog(pageSize = 100, enabled = true): { redemptions: any[]; isLoading: boolean; hasMore: boolean; loadMore: () => void } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const [n, setN] = useState(pageSize);
  const q = useMemoFirebase(() => (enabled && firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'redemptionLog'), orderBy('at', 'desc'), limit(n)) : null), [enabled, firestore, tenantId, n]);
  const r = useCollection<any>(q);
  const redemptions = useMemo(() => (r.data || NONE).map((x: any) => ({ ...x, date: x.date || x.redeemedAt || x.at })), [r.data]);
  return { redemptions, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)), hasMore: redemptions.length >= n, loadMore: () => setN((x) => x + pageSize) };
}
