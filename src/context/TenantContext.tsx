'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { type Tenant } from '@/lib/data';

interface TenantContextType {
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  setSelectedTenant: (tenant: Tenant) => void;
  isLoading: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const { user, isUserLoading } = useFirebase();
  const firestore = useFirebase().firestore;
  
  const tenantQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'tenants'), where('userId', '==', user.uid));
  }, [user, firestore]);

  const { data: tenants, isLoading: tenantsLoading } = useCollection<Tenant>(tenantQuery);

  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    // When tenants load, select the first one as default or find the active one.
    if (tenants && tenants.length > 0 && !selectedTenant) {
      const storedTenantId = localStorage.getItem('selectedTenantId');
      const activeTenant = tenants.find(t => t.id === storedTenantId);
      setSelectedTenant(activeTenant || tenants[0]);
    }
  }, [tenants, selectedTenant]);

  const handleSetSelectedTenant = useCallback((tenant: Tenant) => {
    setSelectedTenant(tenant);
    localStorage.setItem('selectedTenantId', tenant.id);
  }, []);
  
  const isLoading = isUserLoading || tenantsLoading;

  const value = {
    tenants: tenants || [],
    selectedTenant,
    setSelectedTenant: handleSetSelectedTenant,
    isLoading
  };

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
