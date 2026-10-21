'use client';

import { canSeeClientContact, maskClientContact, maskAppointmentContact } from '@/lib/privacy';
import React, { createContext, useContext, useState, ReactNode, useMemo, useEffect, useCallback, useRef } from 'react';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useDatedRange } from '@/hooks/use-transactions';
import { useCheckInsFor } from '@/hooks/use-checkins';
import { mergeVisits, liveTokens } from '@/lib/appointment-merge';
import { useTenant } from '@/context/TenantContext';
import { collection, doc, query, where, collectionGroup } from 'firebase/firestore';
import {
    type InventoryItem, 
    type StockCorrection,
    type Location as LocationType,
    type LocationType as LocType,
    type Client,
    type Appointment,
    type Service,
    type Staff,
    type WalkIn,
    type ActivityLog,
    type Membership,
    type Package,
    type ConsentForm,
    type Resource,
    type Event,
    type Discount,
    type Review,
    type PricingTier,
    type TillSession,
    type SubscriptionInstance,
    type Redemption,
    type RefreshmentRequest,
    // ── Staff custody & replenishment ──────────────────────────────────────
    type AssetUnit,
    type StationAllocation,
    type StaffReplenishmentRequest,
    type OverflowEvent,
} from '@/lib/data';
import {
    type BillDefinition as Bill,
    type BillInstance,
    type Transaction,
} from '@/lib/financial-data';
import { parseISO, format, isPast, isToday, startOfDay, addMonths, isBefore, startOfMonth, endOfMonth, isSameMonth } from 'date-fns';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

interface InventoryContextType {
  inventory: InventoryItem[];
  stockCorrections: StockCorrection[];
  locations: LocationType[];
  locationTypes: LocType[];
  billDefinitions: Bill[];
  billInstances: BillInstance[];
  transactions: Transaction[];
  clients: Client[];
  appointments: Appointment[];
  /** Six weeks back to a year ahead, shared (hooks/use-appointments). */
  appointmentWindow: Appointment[];
  services: Service[];
  staff: Staff[];
  walkIns: WalkIn[];
  activityLogs: ActivityLog[];
  memberships: Membership[];
  packages: Package[];
  consentForms: ConsentForm[];
  resources: Resource[];
  events: Event[];
  studioEvents: any[];
  discounts: Discount[];
  reviews: Review[];
  pricingTiers: PricingTier[];
  tillSessions: TillSession[];
  subscriptionInstances: SubscriptionInstance[];
  redemptions: Redemption[];
  refreshmentRequests: RefreshmentRequest[];
  scheduleProfiles: any[];
  lifestyleProfiles: any[];
  businessProfiles: any[];
  // ── Staff custody & replenishment ────────────────────────────────────────
  assetUnits: AssetUnit[];
  stationAllocations: StationAllocation[];
  staffReplenishmentRequests: StaffReplenishmentRequest[];
  overflowEvents: OverflowEvent[];
  isLoading: boolean;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);
const NONE: any[] = [];

export const InventoryProvider = ({ children }: { children: ReactNode }) => {
  const { firestore } = useFirebase();
  const { selectedTenant, role, roleId } = useTenant() as any;
  // CONTACT PRIVACY (Settings → privacy → client contact details): for people who may not see them, phone numbers,
  // emails and addresses are removed HERE, so every screen fed from this context follows the setting — including
  // ones built later. Records are marked contactHidden so nothing can save the gap back over the real details.
  const hideContact = !canSeeClientContact(selectedTenant, roleId || role);
  const tenantId = selectedTenant?.id;

  /* LOAD WHAT A SCREEN USES. Records that only grow (sales, clock-ins, stock changes, walk-ins, reviews, events…) are
   * no longer all read the moment anyone signs in. Each starts loading the first time a screen reads it from this
   * context, and stays live for the rest of the session; screens that never use it never pay for it. While a
   * collection is starting up, isLoading is true, exactly as it is on a first load. */
  const [wanted, setWanted] = useState<Record<string, boolean>>({});
  const wantedRef = useRef<Record<string, boolean>>({});
  const want = useCallback((k: string) => {
    if (wantedRef.current[k]) return;
    wantedRef.current[k] = true;
    queueMicrotask(() => setWanted((w) => (w[k] ? w : { ...w, [k]: true })));
  }, []);

  const { data: inventory, isLoading: inventoryLoading } = useCollection<InventoryItem>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'inventory') : null, [firestore, tenantId]));
  const { data: stockCorrections, isLoading: stockCorrectionsLoading, error: stockCorrectionsError } = useCollection<StockCorrection>(useMemoFirebase(() => tenantId && wanted.stockCorrections ? collection(firestore, 'tenants', tenantId, 'stockCorrections') : null, [firestore, tenantId, wanted.stockCorrections]));
  const { data: locations, isLoading: locationsLoading } = useCollection<LocationType>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'locations') : null, [firestore, tenantId]));
  const { data: locationTypes, isLoading: locationTypesLoading } = useCollection<LocType>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'locationTypes') : null, [firestore, tenantId]));
  
  const { data: billDefinitionsData, isLoading: billDefinitionsLoading } = useCollection<Bill>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'bills') : null, [firestore, tenantId]));
  const { data: rawBillInstances, isLoading: billInstancesLoading } = useCollection<BillInstance>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'billInstances') : null, [firestore, tenantId]));
  const { data: lifestyleProfiles, isLoading: lifestyleLoading } = useCollection<any>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/lifestyleProfiles`) : null, [firestore, tenantId]));
  const { data: businessProfiles, isLoading: businessLoading } = useCollection<any>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/businessProfiles`) : null, [firestore, tenantId]));

  const { data: rawTransactions, isLoading: transactionsLoading, error: transactionsError } = useCollection<Transaction>(useMemoFirebase(() => tenantId && wanted.transactions ? collection(firestore, 'tenants', tenantId, 'transactions') : null, [firestore, tenantId, wanted.transactions]));
  // Every client: only for screens that list or total them all. Finding one client or showing a few uses hooks/use-clients.
  const { data: rawClients, isLoading: clientsLoading, error: clientsError } = useCollection<Client>(useMemoFirebase(() => tenantId && wanted.clients ? collection(firestore, 'tenants', tenantId, 'clients') : null, [firestore, tenantId, wanted.clients]));
  // A booth renter's clients are THEIR book, not the studio's. They live in
  // the same collection (one booking route, one schema) but carry
  // ownerRenterId, and this is the one place the studio's view is cut: every
  // surface that reads clients from here — the Clients page, planner search,
  // POS lookup, reports — sees only the studio's own. The renter sees theirs
  // in the portal. Filtered here rather than per page so nothing can forget.
  const clients = useMemo(() => { const own = (rawClients || []).filter((c: any) => !c.ownerRenterId); return hideContact ? own.map((c: any) => maskClientContact(c)) : own; }, [rawClients, hideContact]);
  // The same view of one client record, for screens that read clients one at a time: renters' clients hidden, contact privacy applied.
  const clientView = useCallback((c: any) => (!c || c.ownerRenterId ? null : hideContact ? maskClientContact(c) : c), [hideContact]);
  // Every appointment ever: only for the few screens that still need all of history. Most read the shared window below.
  const { data: appointmentsFromDB, isLoading: appointmentsLoading, error: appointmentsError } = useCollection<Appointment>(useMemoFirebase(() => tenantId && wanted.appointments ? collection(firestore, 'tenants', tenantId, 'appointments') : null, [firestore, tenantId, wanted.appointments]));
  // THE WORKING WINDOW: six weeks back to a year ahead, read once and shared by every screen that works around today.
  const winDay = new Date().toDateString();
  const [winFrom, winTo] = useMemo(() => { const s = new Date(); s.setHours(0, 0, 0, 0); return [new Date(s.getTime() - 45 * 86_400_000), new Date(s.getTime() + 366 * 86_400_000)]; }, [winDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const apptWin = useDatedRange('appointments', 'startTime', wanted.apptWindow ? winFrom : null, wanted.apptWindow ? winTo : null);
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'services') : null, [firestore, tenantId]));
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'staff') : null, [firestore, tenantId]));
  // THE WALK-IN QUEUE: everyone still in it (any day), plus everyone who arrived since yesterday — not every walk-in ever.
  const wiSince = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(d.getTime() - 86_400_000).toISOString(); }, [winDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: walkInsOpen, isLoading: walkInsLoading, error: walkInsError } = useCollection<WalkIn>(useMemoFirebase(() => tenantId && wanted.walkIns ? query(collection(firestore, 'tenants', tenantId, 'walkIns'), where('status', 'not-in', ['completed', 'cancelled', 'canceled', 'removed', 'no_show', 'left'])) : null, [firestore, tenantId, wanted.walkIns]));
  const { data: walkInsRecent, isLoading: walkInsRecentLoading } = useCollection<WalkIn>(useMemoFirebase(() => tenantId && wanted.walkIns ? query(collection(firestore, 'tenants', tenantId, 'walkIns'), where('checkInTime', '>=', wiSince)) : null, [firestore, tenantId, wanted.walkIns, wiSince]));
  const walkIns = useMemo(() => { if (walkInsOpen == null && walkInsRecent == null) return null; const m = new Map<string, any>(); for (const w of [...(walkInsRecent || []), ...(walkInsOpen || [])]) m.set((w as any).id, w); return [...m.values()] as WalkIn[]; }, [walkInsOpen, walkInsRecent]);
  const { data: rawActivityLogs, isLoading: activityLogsLoading, error: activityLogsError } = useCollection<ActivityLog>(useMemoFirebase(() => tenantId && wanted.activityLogs ? collection(firestore, 'tenants', tenantId, 'activityLogs') : null, [firestore, tenantId, wanted.activityLogs]));
  const { data: memberships, isLoading: membershipsLoading } = useCollection<Membership>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'memberships') : null, [firestore, tenantId]));
  const { data: packages, isLoading: packagesLoading } = useCollection<Package>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'packages') : null, [firestore, tenantId]));
  const { data: consentForms, isLoading: consentFormsLoading } = useCollection<ConsentForm>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'consentForms') : null, [firestore, tenantId]));
  const { data: resources, isLoading: resourcesLoading } = useCollection<Resource>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'resources') : null, [firestore, tenantId]));
  const { data: rawEvents, isLoading: eventsLoading, error: eventsError } = useCollection<Event>(useMemoFirebase(() => tenantId && wanted.events ? collection(firestore, 'tenants', tenantId, 'events') : null, [firestore, tenantId, wanted.events]));

  // ── STUDIO EVENTS (separate from planner events — no collection collision) ──
  const { data: rawStudioEvents, isLoading: studioEventsLoading, error: studioEventsError } = useCollection<any>(useMemoFirebase(() => tenantId && wanted.studioEvents ? collection(firestore, 'tenants', tenantId, 'studioEvents') : null, [firestore, tenantId, wanted.studioEvents]));

  const { data: discounts, isLoading: discountsLoading } = useCollection<Discount>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'discounts') : null, [firestore, tenantId]));
  const { data: reviews, isLoading: reviewsLoading, error: reviewsError } = useCollection<Review>(useMemoFirebase(() => tenantId && wanted.reviews ? collection(firestore, 'tenants', tenantId, 'reviews') : null, [firestore, tenantId, wanted.reviews]));
  const { data: pricingTiers, isLoading: pricingTiersLoading } = useCollection<PricingTier>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'pricingTiers') : null, [firestore, tenantId]));
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'scheduleProfiles') : null, [firestore, tenantId]));
  const { data: tillSessions, isLoading: tillSessionsLoading, error: tillSessionsError } = useCollection<TillSession>(useMemoFirebase(() => tenantId && wanted.tillSessions ? collection(firestore, 'tenants', tenantId, 'tillSessions') : null, [firestore, tenantId, wanted.tillSessions]));
  const { data: rawSubInstances, isLoading: subInstancesLoading } = useCollection<SubscriptionInstance>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'subscriptionInstances') : null, [firestore, tenantId]));
  // Lounge orders: everything still pending, plus everything asked for since yesterday — not every order ever.
  const { data: refreshOpen, isLoading: refreshmentRequestsLoading, error: refreshmentRequestsError } = useCollection<RefreshmentRequest>(useMemoFirebase(() => tenantId && wanted.refreshmentRequests ? query(collection(firestore, 'tenants', tenantId, 'refreshmentRequests'), where('status', '==', 'pending')) : null, [firestore, tenantId, wanted.refreshmentRequests]));
  const { data: refreshRecent, isLoading: refreshRecentLoading } = useCollection<RefreshmentRequest>(useMemoFirebase(() => tenantId && wanted.refreshmentRequests ? query(collection(firestore, 'tenants', tenantId, 'refreshmentRequests'), where('requestedAt', '>=', wiSince)) : null, [firestore, tenantId, wanted.refreshmentRequests, wiSince]));
  const refreshmentRequests = useMemo(() => { if (refreshOpen == null && refreshRecent == null) return null; const m = new Map<string, any>(); for (const r of [...(refreshRecent || []), ...(refreshOpen || [])]) m.set((r as any).id, r); return [...m.values()] as RefreshmentRequest[]; }, [refreshOpen, refreshRecent]);
  
  const { data: redemptions, isLoading: redemptionsLoading, error: redemptionsError } = useCollection<Redemption>(useMemoFirebase(() => !firestore || !tenantId || !wanted.redemptions ? null : collectionGroup(firestore, 'redemptions'), [firestore, tenantId, wanted.redemptions]));

  // Visit-link copies only for the visits around today (lib/appointment-merge: older ones change nothing on screen).
  const checkInTokens = useMemo(() => liveTokens([appointmentsFromDB, apptWin.list]), [appointmentsFromDB, apptWin.list]);
  const checkInMap = useCheckInsFor(checkInTokens);

  // ── Staff custody & replenishment ──────────────────────────────────────────
  // Same pattern as every other tenant-scoped collection above. These feed
  // lib/replenishment-system.ts (deductMainStock, approveReplenishment,
  // logServiceUsage, recordAssetScan, etc).
  const { data: assetUnits, isLoading: assetUnitsLoading } = useCollection<AssetUnit>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'assetUnits') : null, [firestore, tenantId]));
  const { data: stationAllocations, isLoading: stationAllocationsLoading } = useCollection<StationAllocation>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'stationAllocations') : null, [firestore, tenantId]));
  const { data: staffReplenishmentRequests, isLoading: staffReplenishmentRequestsLoading } = useCollection<StaffReplenishmentRequest>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'staffReplenishmentRequests') : null, [firestore, tenantId]));
  const { data: overflowEvents, isLoading: overflowEventsLoading, error: overflowEventsError } = useCollection<OverflowEvent>(useMemoFirebase(() => tenantId && wanted.overflowEvents ? collection(firestore, 'tenants', tenantId, 'overflowEvents') : null, [firestore, tenantId, wanted.overflowEvents]));

  const billDefinitions = useMemo(() => {
    const rawDefs = billDefinitionsData || [];
    const activeL = (lifestyleProfiles || []).find((p: any) => p.isActive);
    const activeB = (businessProfiles || []).find((p: any) => p.isActive);
    
    const sanitizeId = (title: string) => title.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    const profileBills = [
        ...(activeL?.categories || []).flatMap((c: any) => (c.bills || []).map((b: any) => ({ 
            ...b, 
            id: `bill-${sanitizeId(b.title)}-personal`, 
            context: 'Personal', 
            category: c.name 
        }))),
        ...(activeB?.categories || []).flatMap((c: any) => (c.bills || []).map((b: any) => ({ 
            ...b, 
            id: `bill-${sanitizeId(b.title)}-business`, 
            context: 'Business', 
            category: c.name 
        })))
    ].filter((pb: any) => pb.amount > 0);

    const merged = [...rawDefs];
    profileBills.forEach(pb => {
        if (!merged.some(m => m.id === pb.id)) {
            merged.push({
                id: pb.id,
                name: pb.title,
                amount: pb.amount,
                dueDay: pb.dueDay || 1,
                billingCycle: 'monthly',
                context: pb.context as any,
                category: pb.category,
                startDate: new Date().toISOString(),
            } as any);
        }
    });
    return merged;
  }, [billDefinitionsData, lifestyleProfiles, businessProfiles]);

  const billInstances = useMemo(() => {
    const existingInstances = (rawBillInstances || []).map(instance => ({ ...instance, dueDate: safeDate(instance.dueDate).toISOString() }));
    const now = new Date();
    
    const generatedInstances: BillInstance[] = [];

    billDefinitions.forEach(def => {
        const start = safeDate(def.startDate || '2024-01-01');
        let currentIterMonth = startOfMonth(start);
        const endIterMonth = startOfMonth(now);

        while (currentIterMonth <= endIterMonth) {
            const monthStr = format(currentIterMonth, 'yyyy-MM');
            const hasInstance = existingInstances.some(ei => ei.billDefinitionId === def.id && ei.dueDate.startsWith(monthStr));
            
            if (!hasInstance) {
                const dueDate = new Date(currentIterMonth.getFullYear(), currentIterMonth.getMonth(), (def as any).dueDay || 1);
                const isOverdue = isBefore(dueDate, startOfDay(now)) && !isToday(dueDate);
                
                generatedInstances.push({ 
                    id: `virtual-${def.id}-${monthStr}`, 
                    billDefinitionId: def.id, 
                    dueDate: dueDate.toISOString(), 
                    status: isOverdue ? 'overdue' : 'unpaid', 
                    amountDue: (def as any).amount, 
                    amountPaid: 0 
                } as BillInstance);
            }
            currentIterMonth = addMonths(currentIterMonth, 1);
        }
    });
    
    return [...existingInstances, ...generatedInstances].sort((a,b) => safeDate(b.dueDate).getTime() - safeDate(a.dueDate).getTime());
  }, [rawBillInstances, billDefinitions]);

  const subscriptionInstances = useMemo(() => {
    const existing = rawSubInstances || [];
    const now = new Date();
    const generated: SubscriptionInstance[] = [];

    (clients || []).forEach(client => {
        const mId = client.activeMembershipId || client.subscription?.membershipId;
        const membership = memberships?.find(m => m.id === mId);
        if (!mId || !membership) return;

        const nextBilling = client.subscription?.nextBillingDate ? safeDate(client.subscription.nextBillingDate) : null;
        if (!nextBilling) return;

        const monthStr = format(nextBilling, 'yyyy-MM');
        const hasPaidInstance = existing.some(e => e.clientId === client.id && e.status === 'paid' && e.dueDate.startsWith(monthStr));

        if (!hasPaidInstance) {
            const isOverdue = isBefore(nextBilling, startOfDay(now)) && !isToday(nextBilling);
            generated.push({
                id: `virtual-sub-${client.id}-${monthStr}`,
                clientId: client.id,
                clientName: client.name,
                membershipId: mId,
                membershipName: membership.name,
                amount: membership.price,
                dueDate: nextBilling.toISOString(),
                status: isOverdue ? 'failed' : 'pending',
            } as SubscriptionInstance);
        }
    });

    return [...existing, ...generated].sort((a,b) => safeDate(b.dueDate).getTime() - safeDate(a.dueDate).getTime());
  }, [rawSubInstances, clients, memberships]);

  const mergeRaw = useCallback((raw: any[] | null | undefined) => mergeVisits(raw, checkInMap, hideContact ? maskAppointmentContact : null), [checkInMap, hideContact]);
  const appointments = useMemo(() => mergeRaw(appointmentsFromDB), [appointmentsFromDB, mergeRaw]);
  const appointmentWindow = useMemo(() => mergeRaw(apptWin.list), [apptWin.list, mergeRaw]);

  const activityLogs = useMemo(() => {
    if (!rawActivityLogs) return [];
    return rawActivityLogs.map(log => ({
      ...log,
      timestamp: safeDate(log.timestamp),
    }));
  }, [rawActivityLogs]);

  const transactions = useMemo(() => {
    if (!rawTransactions) return [];
    return rawTransactions.map(t => ({
      ...t,
      date: safeDate(t.date),
    }));
  }, [rawTransactions]);

  const events = useMemo(() => {
    if (!rawEvents) return [];
    return rawEvents.map(evt => ({
      ...evt,
      startTime: safeDate(evt.startTime),
      endTime: safeDate(evt.endTime),
    }));
  }, [rawEvents]);

  const studioEvents = useMemo(() => {
    return rawStudioEvents || [];
  }, [rawStudioEvents]);

  const eagerLoading = inventoryLoading || locationsLoading || locationTypesLoading || billDefinitionsLoading || billInstancesLoading || servicesLoading || staffLoading || membershipsLoading || packagesLoading || consentFormsLoading || resourcesLoading || discountsLoading || pricingTiersLoading || scheduleProfilesLoading || lifestyleLoading || businessLoading || subInstancesLoading || assetUnitsLoading || stationAllocationsLoading || staffReplenishmentRequestsLoading;
  const lazyLoading = (k: string, flag: boolean) => !!wantedRef.current[k] && (!wanted[k] || flag);
  // Still starting: loading, or asked for but no answer yet (and no error).
  const lazyFlags: Record<string, boolean> = { clients: clientsLoading || (rawClients == null && !clientsError), appointments: appointmentsLoading || (appointmentsFromDB == null && !appointmentsError), apptWindow: apptWin.isLoading, transactions: transactionsLoading || (rawTransactions == null && !transactionsError), activityLogs: activityLogsLoading || (rawActivityLogs == null && !activityLogsError), stockCorrections: stockCorrectionsLoading || (stockCorrections == null && !stockCorrectionsError), tillSessions: tillSessionsLoading || (tillSessions == null && !tillSessionsError), redemptions: redemptionsLoading || (redemptions == null && !redemptionsError), refreshmentRequests: refreshmentRequestsLoading || refreshRecentLoading || (refreshOpen == null && !refreshmentRequestsError), overflowEvents: overflowEventsLoading || (overflowEvents == null && !overflowEventsError), reviews: reviewsLoading || (reviews == null && !reviewsError), walkIns: walkInsLoading || walkInsRecentLoading || (walkInsOpen == null && !walkInsError), events: eventsLoading || (rawEvents == null && !eventsError), studioEvents: studioEventsLoading || (rawStudioEvents == null && !studioEventsError) };
  
  /*
   * RENDER ARMOR — a Firestore FieldValue sentinel (or any stray object) that
   * lands in a numeric/text field will crash React on render ("Objects are
   * not valid as a React child", minified error #31) and white-screen the
   * whole page. One malformed field must never take down Inventory, so every
   * item is normalized on the way out of the context: object-valued scalars
   * become safe numbers/strings, and the offending item is logged once so it
   * can be repaired instead of hunted.
   */
  const safeInventory = useMemo(() => {
    const SCALARS = [
      'totalStock', 'stockReserved', 'costPerUnit', 'msrp', 'size', 'weightOz',
      'partialContainerSize', 'lowStockThreshold', 'estimatedUses', 'usageCount',
      'wholesalePriceDollars', 'wholesaleMinQty',
    ];
    const TEXT = ['name', 'sku', 'barcode', 'unit', 'type', 'status', 'category', 'videoUrl'];
    return (inventory || []).map((raw: any) => {
      if (!raw || typeof raw !== 'object') return raw;
      let dirty: string[] = [];
      const item: any = { ...raw };
      for (const k of SCALARS) {
        const v = item[k];
        if (v !== undefined && v !== null && typeof v !== 'number') {
          const n = Number(v);
          item[k] = Number.isFinite(n) ? n : 0;
          if (typeof v === 'object') dirty.push(k);
        }
      }
      for (const k of TEXT) {
        const v = item[k];
        if (v !== undefined && v !== null && typeof v !== 'string') {
          item[k] = typeof v === 'object' ? '' : String(v);
          if (typeof v === 'object') dirty.push(k);
        }
      }
      if (!Array.isArray(item.batches)) item.batches = [];
      else {
        item.batches = item.batches
          .filter((b: any) => b && typeof b === 'object')
          .map((b: any) => ({
            ...b,
            stock: Number.isFinite(Number(b.stock)) ? Number(b.stock) : 0,
            costPerUnit: Number.isFinite(Number(b.costPerUnit)) ? Number(b.costPerUnit) : 0,
            receivedDate: typeof b.receivedDate === 'string' ? b.receivedDate : '',
          }));
      }
      if (!Array.isArray(item.imageUrls)) item.imageUrls = [];
      else item.imageUrls = item.imageUrls.filter((u: any) => typeof u === 'string' && u.trim() !== '');
      if (dirty.length > 0 && typeof console !== 'undefined') {
        console.warn(`[inventory] repaired corrupt field(s) on "${item.name || item.id}" (${item.id}): ${dirty.join(', ')}`);
      }
      return item;
    });
  }, [inventory]);

  // The same array every time it's read, so screens that watch these lists don't see a "change" on every render.
  const safeWalkIns = useMemo(() => (hideContact ? (walkIns || NONE).map((w: any) => maskAppointmentContact(w)) : (walkIns || NONE)), [walkIns, hideContact]);
  const value: any = {
    inventory: safeInventory,
    locations: locations || [],
    locationTypes: locationTypes || [],
    billDefinitions: billDefinitions || [],
    billInstances: billInstances || [],
    services: services || [],
    staff: staff || [],
    memberships: memberships || [],
    packages: packages || [],
    consentForms: consentForms || [],
    resources: resources || [],
    discounts: discounts || [],
    pricingTiers: pricingTiers || [],
    scheduleProfiles: scheduleProfiles || [],
    lifestyleProfiles: lifestyleProfiles || [],
    businessProfiles: businessProfiles || [],
    // ── Staff custody & replenishment ────────────────────────────────────────
    assetUnits: assetUnits || [],
    stationAllocations: stationAllocations || [],
    staffReplenishmentRequests: staffReplenishmentRequests || [],
  };
  Object.defineProperty(value, 'clients', { enumerable: true, get: () => { want('clients'); return clients; } });
  value._clientView = clientView;
  // Upcoming membership charges are worked out from clients, so reading them loads clients.
  Object.defineProperty(value, 'subscriptionInstances', { enumerable: true, get: () => { want('clients'); return subscriptionInstances || NONE; } });
  Object.defineProperty(value, 'appointments', { enumerable: true, get: () => { want('appointments'); return appointments; } });
  Object.defineProperty(value, 'appointmentWindow', { enumerable: true, get: () => { want('apptWindow'); return appointmentWindow; } });
  value._apptWindowFrom = winFrom.getTime(); value._apptWindowTo = winTo.getTime(); value._mergeVisits = mergeRaw;
  Object.defineProperty(value, '_apptWindowLoading', { enumerable: false, get: () => lazyLoading('apptWindow', lazyFlags.apptWindow) || (!wantedRef.current.apptWindow) });
  Object.defineProperty(value, 'stockCorrections', { enumerable: true, get: () => { want('stockCorrections'); return stockCorrections || NONE; } });
  Object.defineProperty(value, 'transactions', { enumerable: true, get: () => { want('transactions'); return transactions || NONE; } });
  Object.defineProperty(value, 'walkIns', { enumerable: true, get: () => { want('walkIns'); return safeWalkIns; } });
  Object.defineProperty(value, 'activityLogs', { enumerable: true, get: () => { want('activityLogs'); return activityLogs || NONE; } });
  Object.defineProperty(value, 'events', { enumerable: true, get: () => { want('events'); return events || NONE; } });
  Object.defineProperty(value, 'studioEvents', { enumerable: true, get: () => { want('studioEvents'); return studioEvents || NONE; } });
  Object.defineProperty(value, 'reviews', { enumerable: true, get: () => { want('reviews'); return reviews || NONE; } });
  Object.defineProperty(value, 'tillSessions', { enumerable: true, get: () => { want('tillSessions'); return tillSessions || NONE; } });
  Object.defineProperty(value, 'redemptions', { enumerable: true, get: () => { want('redemptions'); return redemptions || NONE; } });
  Object.defineProperty(value, 'refreshmentRequests', { enumerable: true, get: () => { want('refreshmentRequests'); return refreshmentRequests || NONE; } });
  Object.defineProperty(value, 'overflowEvents', { enumerable: true, get: () => { want('overflowEvents'); return overflowEvents || NONE; } });
  Object.defineProperty(value, 'isLoading', { enumerable: true, get: () => eagerLoading || Object.keys(lazyFlags).some((k) => lazyLoading(k, lazyFlags[k])) });

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
};

export const useInventory = () => {
  const context = useContext(InventoryContext);
  if (context === undefined) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
};
