'use client';
// src/hooks/use-stock.ts — STOCK CHANGES FOR ONE PRODUCT, OR FOR A RECENT PERIOD, rather than every stock change the
// business has ever recorded.
import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useTenant } from '@/context/TenantContext';
import { useDatedRange, useToday } from '@/hooks/use-transactions';

const NONE: any[] = [];

/** Every stock change for one product, live (its history and running balance). */
export function useStockChangesFor(productId: string | null | undefined): { stockCorrections: any[]; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const q = useMemoFirebase(() => (firestore && tenantId && productId ? query(collection(firestore, 'tenants', tenantId, 'stockCorrections'), where('productId', '==', productId)) : null), [firestore, tenantId, productId]);
  const r = useCollection<any>(q);
  return { stockCorrections: r.data || NONE, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}

/** Stock changes from the last `days` days, live. */
export function useRecentStockChanges(days = 90): { stockCorrections: any[]; isLoading: boolean } {
  const [, todayEnd] = useToday();
  const from = useMemo(() => new Date(todayEnd.getTime() - days * 86_400_000), [todayEnd, days]);
  const r = useDatedRange('stockCorrections', 'date', from, todayEnd);
  // Screens compare dates as text (parseISO), so keep them as stored text.
  const stockCorrections = useMemo(() => r.list.map((x: any) => ({ ...x, date: x.date instanceof Date ? x.date.toISOString() : x.date })), [r.list]);
  return { stockCorrections, isLoading: r.isLoading };
}
