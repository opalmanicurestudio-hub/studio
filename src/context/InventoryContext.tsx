

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
import { parseISO } from 'date-fns';


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
  const { data: billDefinitions, isLoading: billDefinitionsLoading } = useCollection<Bill>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'bills') : null, [firestore, tenantId]));
  const { data: billInstances, isLoading: billInstancesLoading } = useCollection<BillInstance>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'billInstances') : null, [firestore, tenantId]));
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
  const { data: events, isLoading: eventsLoading } = useCollection<Event>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'events') : null, [firestore, tenantId]));
  const { data: discounts, isLoading: discountsLoading } = useCollection<Discount>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'discounts') : null, [firestore, tenantId]));
  const { data: reviews, isLoading: reviewsLoading } = useCollection<Review>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'reviews') : null, [firestore, tenantId]));
  const { data: pricingTiers, isLoading: pricingTiersLoading } = useCollection<PricingTier>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'pricingTiers') : null, [firestore, tenantId]));
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'scheduleProfiles') : null, [firestore, tenantId]));
  
  const appointments = useMemo(() => {
    if (!appointmentsFromDB) return [];
    return appointmentsFromDB.map(apt => ({
      ...apt,
      startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : parseISO(apt.startTime as any),
      endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : parseISO(apt.endTime as any),
      actualStartTime: apt.actualStartTime ? ((apt.actualStartTime as any)?.toDate ? (apt.actualStartTime as any).toDate() : new Date(apt.actualStartTime)) : undefined,
      actualEndTime: apt.actualEndTime ? ((apt.actualEndTime as any)?.toDate ? (apt.actualEndTime as any).toDate() : new Date(apt.actualEndTime)) : undefined,
    }));
  }, [appointmentsFromDB]);

  const activityLogs = useMemo(() => {
    if (!rawActivityLogs) return [];
    return rawActivityLogs.map(log => ({
      ...log,
      timestamp: (log.timestamp as any)?.toDate ? (log.timestamp as any).toDate() : parseISO(log.timestamp as any),
    }));
  }, [rawActivityLogs]);

  const transactions = useMemo(() => {
    if (!rawTransactions) return [];
    return rawTransactions.map(t => ({
      ...t,
      date: (t.date as any)?.toDate ? (t.date as any).toDate() : parseISO(t.date as any),
    }));
  }, [rawTransactions]);

  const isLoading = inventoryLoading || stockCorrectionsLoading || locationsLoading || locationTypesLoading || billDefinitionsLoading || billInstancesLoading || transactionsLoading || clientsLoading || appointmentsLoading || servicesLoading || staffLoading || walkInsLoading || activityLogsLoading || membershipsLoading || packagesLoading || consentFormsLoading || resourcesLoading || eventsLoading || discountsLoading || reviewsLoading || pricingTiersLoading || scheduleProfilesLoading;
  
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
