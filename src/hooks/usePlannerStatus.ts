'use client';

// ─────────────────────────────────────────────────────────────────────────────
// usePlannerStatus
//
// Derives every value StatusStrip and AttentionStrip need, purely from data
// PlannerPageContent already fetches via useInventory(). No new Firestore
// reads. This hook exists so PlannerPageContent's render body stays clean —
// the derivation logic lives here instead of inline in JSX.
//
// Drop this file at: hooks/usePlannerStatus.ts (or wherever your other
// planner-specific hooks live — adjust the import paths below to match).
//
// Usage inside PlannerPageContent, after your existing `kpis` and
// `stuckAppointments` useMemo blocks:
//
//   const status = usePlannerStatus({
//     appointments, walkIns, transactions, currentDate, services, activeTill,
//   });
//
//   <StatusStrip
//     staffCount={staff.length}
//     activeTill={activeTill}
//     waitingCount={status.waitingCount}
//     inServiceCount={status.inServiceCount}
//     readyToPayCount={status.readyToPayCount}
//     todayRevenue={status.todayRevenue}
//   />
//
//   <AttentionStrip items={status.attentionItems} />
//
// Note on `activeTill`: your current PlannerPageContent doesn't compute this
// (POSPage does, via `tillSessions?.find(s => s.status === 'open')`). If
// Planner doesn't already have till data wired in, either pass `showTill={false}`
// to StatusStrip, or lift the same one-line derivation from POSPage:
//   const activeTill = useMemo(() => tillSessions?.find(s => s.status === 'open') || null, [tillSessions]);
// `tillSessions` would need to be added to the destructure from useInventory()
// if it isn't already — that's a zero-cost addition since useInventory already
// subscribes to it for POSPage.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { isToday, isSameDay, format } from 'date-fns';
import type { Appointment, WalkIn, Service } from '@/lib/data';
import type { Transaction } from '@/lib/financial-data';
import type { AttentionItem } from '@/components/planner/AttentionStrip';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') {
    try {
      return new Date(val);
    } catch {
      return new Date();
    }
  }
  return new Date(val);
};

interface UsePlannerStatusArgs {
  appointments: Appointment[] | undefined;
  walkIns: WalkIn[] | undefined;
  transactions: Transaction[] | undefined;
  currentDate: Date;
  services: Service[] | undefined;
  /** Pass through if you've added till tracking to Planner; omit otherwise. */
  activeTill?: { expectedCash?: number } | null;
  /** Click handlers wired to your existing setSelectedAppointment/setIsDetailsOpen state */
  onSelectAppointment: (apt: Appointment) => void;
}

export function usePlannerStatus({
  appointments,
  walkIns,
  transactions,
  currentDate,
  services,
  onSelectAppointment,
}: UsePlannerStatusArgs) {
  const waitingCount = useMemo(
    () => (walkIns || []).filter((w) => w.status === 'waiting').length,
    [walkIns]
  );

  const inServiceCount = useMemo(
    () => (appointments || []).filter((a) => a.status === 'servicing').length,
    [appointments]
  );

  const readyForCheckoutAppointments = useMemo(
    () => (appointments || []).filter((a) => a.status === 'ready_for_checkout'),
    [appointments]
  );

  const readyToPayCount = readyForCheckoutAppointments.length;

  const todayRevenue = useMemo(() => {
    return (transactions || [])
      .filter((t) => isToday(safeDate(t.date)) && t.type === 'income' && !(t as any).voided)
      .reduce((acc, t) => acc + (t.amount || 0), 0);
  }, [transactions]);

  // Same condition your existing `stuckAppointments` useMemo already uses —
  // reproduced here so this hook is a complete, self-contained source for
  // the attention strip. If you keep your existing stuckAppointments
  // useMemo in PlannerPageContent, you can delete this block and pass that
  // value in as an argument instead — whichever keeps the page cleaner.
  const stuckAppointments = useMemo(() => {
    if (!appointments) return [];
    return appointments.filter(
      (a) =>
        ['servicing', 'ready_for_checkout'].includes(a.status) &&
        !isSameDay(safeDate(a.startTime), currentDate)
    );
  }, [appointments, currentDate]);

  const attentionItems: AttentionItem[] = useMemo(() => {
    return stuckAppointments.map((apt) => {
      const svc = (services || []).find((s) => s.id === apt.serviceId);
      return {
        id: apt.id,
        label: apt.clientName || 'Guest',
        sublabel: `${svc?.name || 'Service'} · ${format(safeDate(apt.startTime), 'MMM d, h:mm a')}`,
        kind: apt.status === 'servicing' ? ('in_service' as const) : ('ready_for_checkout' as const),
        onClick: () => onSelectAppointment(apt),
      };
    });
  }, [stuckAppointments, services, onSelectAppointment]);

  return {
    waitingCount,
    inServiceCount,
    readyToPayCount,
    todayRevenue,
    attentionItems,
  };
}
