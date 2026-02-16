

'use client';

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, doc } from 'firebase/firestore';
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
  const { data: transactions, isLoading: transactionsLoading } = useCollection<Transaction>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'transactions') : null, [firestore, tenantId]));
  const { data: clients, isLoading: clientsLoading } = useCollection<Client>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'clients') : null, [firestore, tenantId]));
  const { data: appointments, isLoading: appointmentsLoading } = useCollection<Appointment>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'appointments') : null, [firestore, tenantId]));
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'services') : null, [firestore, tenantId]));
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'staff') : null, [firestore, tenantId]));
  const { data: walkIns, isLoading: walkInsLoading } = useCollection<WalkIn>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'walkIns') : null, [firestore, tenantId]));
  const { data: activityLogs, isLoading: activityLogsLoading } = useCollection<ActivityLog>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'activityLogs') : null, [firestore, tenantId]));
  const { data: memberships, isLoading: membershipsLoading } = useCollection<Membership>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'memberships') : null, [firestore, tenantId]));
  const { data: packages, isLoading: packagesLoading } = useCollection<Package>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'packages') : null, [firestore, tenantId]));
  const { data: consentForms, isLoading: consentFormsLoading } = useCollection<ConsentForm>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'consentForms') : null, [firestore, tenantId]));
  const { data: resources, isLoading: resourcesLoading } = useCollection<Resource>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'resources') : null, [firestore, tenantId]));
  const { data: events, isLoading: eventsLoading } = useCollection<Event>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'events') : null, [firestore, tenantId]));
  const { data: discounts, isLoading: discountsLoading } = useCollection<Discount>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'discounts') : null, [firestore, tenantId]));
  const { data: reviews, isLoading: reviewsLoading } = useCollection<Review>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'reviews') : null, [firestore, tenantId]));
  const { data: pricingTiers, isLoading: pricingTiersLoading } = useCollection<PricingTier>(useMemoFirebase(() => tenantId ? collection(firestore, 'tenants', tenantId, 'pricingTiers') : null, [firestore, tenantId]));
  
  const isLoading = inventoryLoading || stockCorrectionsLoading || locationsLoading || locationTypesLoading || billDefinitionsLoading || billInstancesLoading || transactionsLoading || clientsLoading || appointmentsLoading || servicesLoading || staffLoading || walkInsLoading || activityLogsLoading || membershipsLoading || packagesLoading || consentFormsLoading || resourcesLoading || eventsLoading || discountsLoading || reviewsLoading || pricingTiersLoading;
  
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

    