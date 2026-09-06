"use client";

// ─── MAINTENANCE ─────────────────────────────────────────────────────────────
// Its own page, because maintenance is a WHOLE-STUDIO concern.
//
// It used to live as a section inside the booth-rental hub, which quietly said
// the wrong thing: that a broken dryer or a dead lightbulb in the front room
// was somehow booth-rental business. It isn't. Tickets already covered every
// named resource in the studio, not just rented booths — the page had simply
// never caught up with what the feature actually did.
//
// The section component itself is unchanged and still loads its own resources,
// providers and photos. This page gives it a home, a header, and the at-a-glance
// numbers you would otherwise have to count by eye.

import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { useFirebase, useMemoFirebase, useCollection, useDoc } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { doc } from 'firebase/firestore';
import { useLocation } from '@/context/LocationContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { LocationSwitcher } from '@/components/shared/LocationSwitcher';
import { MaintenanceSection } from '@/components/booths/MaintenanceSection';
import { InterruptionsCard } from '@/components/maintenance/InterruptionsCard';
import { isTicketOverdue } from '@/lib/maintenance';
import { Wrench, AlertTriangle, CircleDot, CalendarClock, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function MaintenancePage() {
  const { firestore, firebaseApp } = useFirebase() as any;
  const { selectedLocationId } = useLocation();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const storage = useMemo(() => (firebaseApp ? getStorage(firebaseApp) : null), [firebaseApp]);

  const tenantRef = useMemoFirebase(
    () => (firestore && tenantId ? doc(firestore, 'tenants', tenantId) : null),
    [firestore, tenantId]
  );
  const { data: tenant } = useDoc<any>(tenantRef);

  const boothsRef = useMemoFirebase(
    () => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/booths`) : null),
    [firestore, tenantId]
  );
  const { data: booths } = useCollection<any>(boothsRef);

  // Tickets, workers and plans are read with raw listeners to match exactly how
  // the hub fed this component before — same shape in, same behaviour out.
  const [tickets, setTickets] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsubs = [
      onSnapshot(collection(firestore, 'tenants', tenantId, 'tickets'),
        (s) => { setTickets(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))); setLoading(false); },
        () => setLoading(false)),
      onSnapshot(collection(firestore, 'tenants', tenantId, 'maintenanceWorkers'),
        (s) => setWorkers(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => {}),
      onSnapshot(collection(firestore, 'tenants', tenantId, 'maintenancePlans'),
        (s) => setPlans(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => {}),
    ];
    return () => unsubs.forEach((u) => u());
  }, [firestore, tenantId]);

  const stats = useMemo(() => {
    const open = tickets.filter((t: any) => t.status !== 'resolved' && t.status !== 'cancelled');
    return {
      open: open.length,
      overdue: open.filter((t: any) => { try { return isTicketOverdue(t); } catch { return false; } }).length,
      unassigned: open.filter((t: any) => !t.assigneeId).length,
      plans: plans.filter((p: any) => p.isActive !== false).length,
    };
  }, [tickets, plans]);

  const sortedBooths = useMemo(() =>
    (booths || []).slice().sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''))),
    [booths]);

  const Stat = ({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) => (
    <div className={cn('rounded-2xl border-2 p-4', tone)}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-2xl font-black mt-1 leading-none">{value}</p>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Maintenance" />
      <div className="flex-1 w-full max-w-[1400px] mx-auto min-w-0 p-4 sm:p-6 md:p-8 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground opacity-60">
            Studio assets
          </p>
          <h1 className="flex items-center gap-2.5 text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none">
            <span className="grid h-9 w-9 place-items-center rounded-2xl border-2 border-primary/15 bg-primary/5 shrink-0">
              <Wrench className="h-4 w-4 text-primary" />
            </span>
            Maintenance
          </h1>
          <p className="text-xs font-bold text-muted-foreground max-w-prose">
            Every ticket, worker and preventive plan across the studio — stations, rooms and equipment alike.
          </p>
        </div>
        <div className="shrink-0"><LocationSwitcher /></div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={CircleDot} label="Open" value={stats.open} tone="border-slate-200" />
        <Stat icon={AlertTriangle} label="Overdue" value={stats.overdue}
          tone={stats.overdue > 0 ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-slate-200'} />
        <Stat icon={Wrench} label="Unassigned" value={stats.unassigned}
          tone={stats.unassigned > 0 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200'} />
        <Stat icon={CalendarClock} label="Active plans" value={stats.plans} tone="border-slate-200" />
      </div>

      {tenantId && <InterruptionsCard tenantId={tenantId} firestore={firestore} tenant={tenant} booths={sortedBooths} />}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader className="h-4 w-4 animate-spin" />
          <span className="text-[11px] font-black uppercase tracking-widest">Loading the queue…</span>
        </div>
      ) : !tenantId ? (
        <p className="text-xs font-bold text-muted-foreground">Sign in to see maintenance.</p>
      ) : (
        <MaintenanceSection
          firestore={firestore}
          storage={storage}
          tenantId={tenantId}
          locationId={selectedLocationId}
          booths={sortedBooths}
          tickets={tickets}
          workers={workers}
          plans={plans}
          ownerName={tenant?.name ? `${tenant.name} team` : 'Owner'}
          autoAssign={tenant?.maintenanceAutoAssign === 'rotate'}
          publicOrigin={tenant?.publicOrigin || null}
          studioName={tenant?.name || ''}
          rules={tenant?.maintenanceRules || null}
        />
      )}
      </div>
    </div>
  );
}
