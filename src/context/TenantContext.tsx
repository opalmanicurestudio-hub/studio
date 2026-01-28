
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
    if (tenantsLoading) return; // Wait until tenants are loaded

    if (tenants && tenants.length > 0) {
      const storedTenantId = localStorage.getItem('selectedTenantId');
      const activeTenant = tenants.find(t => t.id === storedTenantId);

      // If there is a stored tenant and it exists in the current user's list of tenants
      if (activeTenant) {
        // And it's not already the selected one, update it.
        if (selectedTenant?.id !== activeTenant.id) {
          setSelectedTenant(activeTenant);
        }
      } else {
        // Otherwise, default to the first tenant in the list
        setSelectedTenant(tenants[0]);
        localStorage.setItem('selectedTenantId', tenants[0].id);
      }
    } else {
      // If the user has no tenants, clear the selection
      setSelectedTenant(null);
      localStorage.removeItem('selectedTenantId');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, tenantsLoading]);


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
