'use client';
// src/hooks/use-appointments.ts — APPOINTMENTS FOR JUST WHAT A SCREEN SHOWS.
//
// The shared "working window" (about six weeks back to a year ahead) is read once and kept live for every screen
// that works around today: the planner, the front desk, the dashboard. A screen looking further back (an old month
// in the planner, a report) asks for that range on its own. A client's history and single visits are read by
// client or by id. Every list looks exactly like the shared one (lib/appointment-merge).
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, documentId, getCountFromServer, getDocs, query, where } from 'firebase/firestore';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useDatedRange } from '@/hooks/use-transactions';
import type { Appointment } from '@/lib/data';

const NONE: any[] = [];

/** The context's shared window, its bounds, and the merge every list goes through. */
function useWindowParts() {
  const inv: any = useInventory();
  return { inv, from: inv._apptWindowFrom as number, to: inv._apptWindowTo as number, merge: inv._mergeVisits as (raw: any[] | null) => any[] };
}

/**
 * Appointments starting in [from, to). Inside the shared window this costs nothing extra; outside it, only that
 * range is read. Pass withWindow to also get the whole window (the planner needs today's world plus the month it
 * shows). Keep from/to stable.
 */
export function useAppointmentsInRange(from: Date | null, to: Date | null, opts?: { withWindow?: boolean }): { appointments: Appointment[]; isLoading: boolean } {
  const { inv, from: wf, to: wt, merge } = useWindowParts();
  const fromMs = from ? from.getTime() : 0, toMs = to ? to.getTime() : 0;
  const ok = !!from && !!to && toMs > fromMs;
  const inside = ok && fromMs >= wf && toMs <= wt;
  const useWin = inside || !!opts?.withWindow;
  const own = useDatedRange('appointments', 'startTime', ok && !inside ? from : null, ok && !inside ? to : null);
  const win: any[] = useWin ? inv.appointmentWindow : NONE;
  const ownMerged = useMemo(() => (ok && !inside ? merge(own.list) : NONE), [ok, inside, own.list, merge]);
  const appointments = useMemo(() => {
    if (!ok) return opts?.withWindow ? win : NONE;
    const inRange = (a: any) => { const t = a.startTime instanceof Date ? a.startTime.getTime() : 0; return t >= fromMs && t < toMs; };
    if (inside) return opts?.withWindow ? win : win.filter(inRange);
    if (!opts?.withWindow) return ownMerged;
    const seen = new Set(win.map((a: any) => a.id));
    return [...win, ...ownMerged.filter((a: any) => !seen.has(a.id))];
  }, [ok, inside, win, ownMerged, fromMs, toMs, opts?.withWindow]);
  const isLoading = (useWin && !!inv._apptWindowLoading) || (ok && !inside && own.isLoading);
  return { appointments, isLoading };
}

/** The shared working window itself (six weeks back, a year ahead). */
export function useAppointmentWindow(): { appointments: Appointment[]; isLoading: boolean } {
  const inv: any = useInventory();
  const appointments = inv.appointmentWindow as any[];
  return { appointments, isLoading: !!inv._apptWindowLoading };
}

/** One visit by id, live: from the window when it's there, otherwise read on its own. */
export function useAppointmentById(id: string | null | undefined): { appointment: any | null; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const { inv, merge } = useWindowParts();
  const win: any[] = id ? inv.appointmentWindow : NONE;
  const fromWin = id ? win.find((a: any) => a.id === id) || null : null;
  const needOwn = !!id && !fromWin && !inv._apptWindowLoading;
  const ref = useMemoFirebase(() => (firestore && tenantId && needOwn ? doc(firestore, 'tenants', tenantId, 'appointments', String(id)) : null), [firestore, tenantId, needOwn, id]);
  const r = useDoc<any>(ref);
  const own = useMemo(() => (r.data ? merge([r.data])[0] || null : null), [r.data, merge]);
  return { appointment: fromWin || own, isLoading: !!id && !fromWin && (!!inv._apptWindowLoading || (needOwn && r.isLoading)) };
}

/** Every visit one client has had, live (their history, counts, last formula). */
export function useClientVisits(clientId: string | null | undefined): { appointments: Appointment[]; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const { merge } = useWindowParts();
  const q = useMemoFirebase(() => (firestore && tenantId && clientId ? query(collection(firestore, 'tenants', tenantId, 'appointments'), where('clientId', '==', clientId)) : null), [firestore, tenantId, clientId]);
  const r = useCollection<any>(q);
  const appointments = useMemo(() => (r.data ? merge(r.data) : NONE), [r.data, merge]);
  return { appointments, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}

/** Completed-visit counts for a handful of clients (the desk's "3rd visit" flags), counted on the server. */
export function useCompletedVisitCounts(clientIds: string[]): Record<string, number> {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const key = [...new Set(clientIds.filter(Boolean))].sort().join(',');
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!firestore || !tenantId || !key) return;
    let live = true;
    const ids = key.split(',').filter((id) => !(id in counts));
    void Promise.all(ids.map(async (id) => {
      try {
        const s = await getCountFromServer(query(collection(firestore, 'tenants', tenantId, 'appointments'), where('clientId', '==', id), where('status', '==', 'completed')));
        return [id, s.data().count] as const;
      } catch { return [id, 0] as const; }
    })).then((pairs) => { if (live && pairs.length) setCounts((c) => ({ ...c, ...Object.fromEntries(pairs) })); });
    return () => { live = false; };
  }, [firestore, tenantId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return counts;
}

/** Visits in the chair right now, across the business (a handful): the step reminder and the live floor count. */
export function useServicingNow(enabled = true): { appointments: Appointment[]; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const { merge } = useWindowParts();
  const q = useMemoFirebase(() => (enabled && firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'appointments'), where('status', '==', 'servicing')) : null), [enabled, firestore, tenantId]);
  const r = useCollection<any>(q);
  const appointments = useMemo(() => (r.data ? merge(r.data) : NONE), [r.data, merge]);
  return { appointments, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}

/** Everything booked on one calendar day (slot pickers, clash checks), live. Free when the day is in the window. */
export function useAppointmentsOnDay(day: Date | string | null | undefined): { appointments: Appointment[]; isLoading: boolean } {
  const d = day ? new Date(day as any) : null;
  const ms = d && Number.isFinite(d.getTime()) ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : 0;
  const [from, to] = useMemo(() => (ms ? [new Date(ms), new Date(ms + 86_400_000 + 3_600_000)] : [null, null]), [ms]);   // an hour over, for a DST day
  return useAppointmentsInRange(from, to);
}

/** Particular visits by id (the visits a period's payments belong to), read once whenever the set changes. */
export function useAppointmentsByIds(ids: string[]): { appointments: Appointment[]; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const { merge } = useWindowParts();
  const key = [...new Set(ids.filter((x) => x && !String(x).includes('/')))].sort().join(',');
  const [state, setState] = useState<{ key: string; raw: any[] }>({ key: '', raw: NONE });
  useEffect(() => {
    if (!firestore || !tenantId || !key) { setState({ key, raw: NONE }); return; }
    let live = true; const list = key.split(',');
    void (async () => {
      const out: any[] = [];
      for (let i = 0; i < list.length; i += 30) {
        try { const snap = await getDocs(query(collection(firestore, 'tenants', tenantId, 'appointments'), where(documentId(), 'in', list.slice(i, i + 30)))); snap.docs.forEach((d) => out.push({ ...(d.data() as any), id: d.id })); } catch { /* skipped */ }
      }
      if (live) setState({ key, raw: out });
    })();
    return () => { live = false; };
  }, [firestore, tenantId, key]);
  const appointments = useMemo(() => (state.key === key ? merge(state.raw) : NONE), [state, key, merge]);
  return { appointments, isLoading: !!key && state.key !== key };
}

/** Every visit one provider has had, live (who they've served, what's booked with them). Only while it's needed. */
export function useStaffVisits(staffId: string | null | undefined): { appointments: Appointment[]; isLoading: boolean } {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id as string | undefined;
  const { merge } = useWindowParts();
  const q = useMemoFirebase(() => (firestore && tenantId && staffId ? query(collection(firestore, 'tenants', tenantId, 'appointments'), where('staffId', '==', staffId)) : null), [firestore, tenantId, staffId]);
  const r = useCollection<any>(q);
  const appointments = useMemo(() => (r.data ? merge(r.data) : NONE), [r.data, merge]);
  return { appointments, isLoading: !!q && (r.isLoading || (r.data == null && !r.error)) };
}
