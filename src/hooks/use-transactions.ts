'use client';
// src/hooks/use-transactions.ts — SALES AND MONEY RECORDS FOR JUST THE DATES (OR THE VISIT) A SCREEN SHOWS. Screens used
// to read every transaction the business ever had; these read only what they display, live.
//
// Dates are stored two ways across the app's history (ISO text, and Firestore timestamps from a few older writers), so
// a range asks for both and merges them. Text dates are matched a day wider on each side (a date-only "2026-10-19"
// sorts before "2026-10-19T…", and stored times are UTC), then trimmed to the exact range here.
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { parseISO } from 'date-fns';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useTenant } from '@/context/TenantContext';

const DAY = 86_400_000;
const NONE: any[] = [];

export function txDate(val: any): Date {
  if (!val) return new Date(0);
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { const d = parseISO(val); return Number.isFinite(d.getTime()) ? d : new Date(val); }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Text bounds for a date range, a day wider each side (see top of file). */
export function textBounds(from: Date, to: Date): [string, string] {
  return [ymd(new Date(from.getTime() - DAY)), ymd(new Date(to.getTime() + 2 * DAY))];
}

/** Merge both query results, keep only what's really in [from, to), and give every record a Date like the old context did. */
export function mergeInRange(a: any[] | null, b: any[] | null, from: number, to: number): any[] {
  const byId = new Map<string, any>();
  for (const t of [...(a || []), ...(b || [])]) {
    const d = txDate(t.date); const ms = d.getTime();
    if (ms >= from && ms < to) byId.set(t.id, { ...t, date: d });
  }
  return [...byId.values()].sort((x, y) => y.date.getTime() - x.date.getTime());
}

/**
 * Transactions dated in [from, to). Pass null to load nothing. Keep from/to stable (useMemo) so the query isn't
 * rebuilt on every render.
 */
export function useTransactionsInRange(from: Date | null, to: Date | null): { transactions: any[]; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const fromMs = from ? from.getTime() : 0; const toMs = to ? to.getTime() : 0;
  const ok = !!(firestore && tenantId && from && to && toMs > fromMs);
  const textQ = useMemoFirebase(() => {
    if (!ok) return null;
    const [lo, hi] = textBounds(new Date(fromMs), new Date(toMs));
    return query(collection(firestore, 'tenants', tenantId!, 'transactions'), where('date', '>=', lo), where('date', '<', hi));
  }, [ok, firestore, tenantId, fromMs, toMs]);
  const stampQ = useMemoFirebase(() => {
    if (!ok) return null;
    return query(collection(firestore, 'tenants', tenantId!, 'transactions'), where('date', '>=', Timestamp.fromMillis(fromMs - DAY)), where('date', '<', Timestamp.fromMillis(toMs + DAY)));
  }, [ok, firestore, tenantId, fromMs, toMs]);
  const a = useCollection<any>(textQ);
  const b = useCollection<any>(stampQ);
  const transactions = useMemo(() => (ok ? mergeInRange(a.data, b.data, fromMs, toMs) : NONE), [ok, a.data, b.data, fromMs, toMs]);
  const isLoading = ok && ((a.isLoading || (a.data == null && !a.error)) || (b.isLoading || (b.data == null && !b.error)));
  return { transactions, isLoading };
}

/** Every transaction recorded against one visit (deposits, payments, fees, refunds), whenever it happened. */
export function useVisitTransactions(appointmentId: string | null | undefined): { transactions: any[]; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const q = useMemoFirebase(() => (firestore && tenantId && appointmentId ? query(collection(firestore, 'tenants', tenantId, 'transactions'), where('appointmentId', '==', appointmentId)) : null), [firestore, tenantId, appointmentId]);
  const r = useCollection<any>(q);
  const transactions = useMemo(() => (r.data || NONE).map((t: any) => ({ ...t, date: txDate(t.date) })), [r.data]);
  return { transactions, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}

/** Today in the device's time zone, as a stable [start, end) pair. */
export function useToday(): [Date, Date] {
  const key = new Date().toDateString();
  return useMemo(() => { const s = new Date(); s.setHours(0, 0, 0, 0); const e = new Date(s); e.setDate(e.getDate() + 1); return [s, e]; }, [key]);
}

/** Money records for a set of visits (a client's history), read once and again whenever the set changes. */
export function useTransactionsForVisits(appointmentIds: string[]): { transactions: any[]; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const key = useMemo(() => [...new Set(appointmentIds.filter(Boolean))].sort().join(','), [appointmentIds]);
  const [state, setState] = useState<{ key: string; list: any[] }>({ key: '', list: NONE });
  useEffect(() => {
    if (!firestore || !tenantId || !key) { setState({ key, list: NONE }); return; }
    let live = true;
    const ids = key.split(',');
    void (async () => {
      const out: any[] = [];
      for (let i = 0; i < ids.length; i += 30) {
        try {
          const snap = await getDocs(query(collection(firestore, 'tenants', tenantId, 'transactions'), where('appointmentId', 'in', ids.slice(i, i + 30))));
          snap.docs.forEach((d) => out.push({ ...(d.data() as any), id: d.id, date: txDate((d.data() as any).date) }));
        } catch { /* a page that can't be read contributes nothing */ }
      }
      if (live) setState({ key, list: out });
    })();
    return () => { live = false; };
  }, [firestore, tenantId, key]);
  return { transactions: state.key === key ? state.list : NONE, isLoading: !!key && state.key !== key };
}
