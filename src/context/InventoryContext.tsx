'use client';

import React, { createContext, useContext, useState, ReactNode, useEffect, useMemo } from 'react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, doc, query, where } from 'firebase/firestore';
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
} from '@/lib/data';
import {
    type BillDefinition as Bill,
    type BillInstance,
    type Transaction,
} from '@/lib/financial-data';
import { parseISO, format, isPast, isToday, startOfDay, addMonths, isBefore, startOfMonth, endOfMonth } from 'date-fns';

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
  services: Service[];
  staff: Staff[];
  walkIns: WalkIn[];
  activityLogs: ActivityLog[];
  memberships: Membership[];
  packages: Package[];
  consentForms: ConsentForm[];
  resources: Resource[];
  events: Event[];
  discounts: Discount[];
  reviews: Review[];
  pricingTiers: PricingTier[];
  scheduleProfiles: any[];
  lifestyleProfiles: any[];
  businessProfiles: any[];
  isLoading: boolean;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export const InventoryProvider = ({ children }: { children: ReactNode }) => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  const { data: inventory, isLoading: inventoryLoading } = useCollection<InventoryItem>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'inventory') : null, [firestore, tenantId]));
  const { data: stockCorrections, isLoading: stockCorrectionsLoading } = useCollection<StockCorrection>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'stockCorrections') : null, [firestore, tenantId]));
  const { data: locations, isLoading: locationsLoading } = useCollection<LocationType>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'locations') : null, [firestore, tenantId]));
  const { data: locationTypes, isLoading: locationTypesLoading } = useCollection<LocType>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'locationTypes') : null, [firestore, tenantId]));
  
  const { data: billDefinitionsData, isLoading: billDefinitionsLoading } = useCollection<Bill>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'bills') : null, [firestore, tenantId]));
  const { data: rawBillInstances, isLoading: billInstancesLoading } = useCollection<BillInstance>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'billInstances') : null, [firestore, tenantId]));
  const { data: lifestyleProfiles, isLoading: lifestyleLoading } = useCollection<any>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/lifestyleProfiles`) : null, [firestore, tenantId]));
  const { data: businessProfiles, isLoading: businessLoading } = useCollection<any>(useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/businessProfiles`) : null, [firestore, tenantId]));

  const { data: rawTransactions, isLoading: transactionsLoading } = useCollection<Transaction>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'transactions') : null, [firestore, tenantId]));
  const { data: clients, isLoading: clientsLoading } = useCollection<Client>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'clients') : null, [firestore, tenantId]));
  const { data: appointmentsFromDB, isLoading: appointmentsLoading } = useCollection<Appointment>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'appointments') : null, [firestore, tenantId]));
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'services') : null, [firestore, tenantId]));
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'staff') : null, [firestore, tenantId]));
  const { data: walkIns, isLoading: walkInsLoading } = useCollection<WalkIn>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'walkIns') : null, [firestore, tenantId]));
  const { data: rawActivityLogs, isLoading: activityLogsLoading } = useCollection<ActivityLog>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'activityLogs') : null, [firestore, tenantId]));
  const { data: memberships, isLoading: membershipsLoading } = useCollection<Membership>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'memberships') : null, [firestore, tenantId]));
  const { data: packages, isLoading: packagesLoading } = useCollection<Package>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'packages') : null, [firestore, tenantId]));
  const { data: consentForms, isLoading: consentFormsLoading } = useCollection<ConsentForm>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'consentForms') : null, [firestore, tenantId]));
  const { data: resources, isLoading: resourcesLoading } = useCollection<Resource>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'resources') : null, [firestore, tenantId]));
  const { data: rawEvents, isLoading: eventsLoading } = useCollection<Event>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'events') : null, [firestore, tenantId]));
  const { data: discounts, isLoading: discountsLoading } = useCollection<Discount>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'discounts') : null, [firestore, tenantId]));
  const { data: reviews, isLoading: reviewsLoading } = useCollection<Review>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'reviews') : null, [firestore, tenantId]));
  const { data: pricingTiers, isLoading: pricingTiersLoading } = useCollection<PricingTier>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'pricingTiers') : null, [firestore, tenantId]));
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'scheduleProfiles') : null, [firestore, tenantId]));
  
  const { data: checkIns, isLoading: checkInsLoading } = useCollection<Partial<Appointment>>(useMemoFirebase(() => !firestore || !tenantId ? null : query(collection(firestore, 'appointmentCheckIns'), where('tenantId', '==', tenantId)), [firestore, tenantId]));

  const billDefinitions = useMemo(() => {
    const rawDefs = billDefinitionsData || [];
    const activeL = (lifestyleProfiles || []).find((p: any) => p.isActive);
    const activeB = (businessProfiles || []).find((p: any) => p.isActive);
    
    const profileBills = [
        ...(activeL?.categories || []).flatMap((c: any) => (c.bills || []).map((b: any) => ({ 
            ...b, 
            id: `bill-${b.title.replace(/\s+/g, '-').toLowerCase()}-personal`, 
            context: 'Personal', 
            category: c.name 
        }))),
        ...(activeB?.categories || []).flatMap((c: any) => (c.bills || []).map((b: any) => ({ 
            ...b, 
            id: `bill-${b.title.replace(/\s+/g, '-').toLowerCase()}-business`, 
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

  const appointments = useMemo(() => {
    if (!appointmentsFromDB) return [];
    const checkInMap = new Map((checkIns || []).map(ci => [ci.checkInToken, ci]));
    return appointmentsFromDB.map(apt => {
      const ci = apt.checkInToken ? checkInMap.get(apt.checkInToken) : null;
      return {
        ...apt,
        startTime: safeDate(apt.startTime),
        endTime: safeDate(apt.endTime),
        actualStartTime: apt.actualStartTime ? safeDate(apt.actualStartTime) : undefined,
        actualEndTime: apt.actualEndTime ? safeDate(apt.actualEndTime) : undefined,
        checkInStatus: ci?.checkInStatus || apt.checkInStatus || 'pending',
        lateTimeMinutes: ci?.lateTimeMinutes ?? apt.lateTimeMinutes ?? 0,
        status: (ci?.status && apt.status === 'confirmed') ? ci.status : apt.status
      };
    });
  }, [appointmentsFromDB, checkIns]);

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

  const isLoading = inventoryLoading || stockCorrectionsLoading || locationsLoading || locationTypesLoading || billDefinitionsLoading || billInstancesLoading || transactionsLoading || clientsLoading || appointmentsLoading || servicesLoading || staffLoading || walkInsLoading || activityLogsLoading || membershipsLoading || packagesLoading || consentFormsLoading || resourcesLoading || eventsLoading || discountsLoading || reviewsLoading || pricingTiersLoading || scheduleProfilesLoading || checkInsLoading || lifestyleLoading || businessLoading;
  
  const value = {
    inventory: inventory || [],
    stockCorrections: stockCorrections || [],
    locations: locations || [],
    locationTypes: locationTypes || [],
    billDefinitions: billDefinitions || [],
    billInstances: billInstances || [],
    transactions: transactions || [],
    clients: clients || [],
    appointments: appointments || [],
    services: services || [],
    staff: staff || [],
    walkIns: walkIns || [],
    activityLogs: activityLogs || [],
    memberships: memberships || [],
    packages: packages || [],
    consentForms: consentForms || [],
    resources: resources || [],
    events: events || [],
    discounts: discounts || [],
    reviews: reviews || [],
    pricingTiers: pricingTiers || [],
    scheduleProfiles: scheduleProfiles || [],
    lifestyleProfiles: lifestyleProfiles || [],
    businessProfiles: businessProfiles || [],
    isLoading,
  };

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
