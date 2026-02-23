

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { type Tenant } from '@/lib/data';
import type { User } from 'firebase/auth';

type UserRole = 'owner' | 'staff' | null;

interface TenantContextType {
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  setSelectedTenant: (tenant: Tenant) => void;
  isLoading: boolean;
  role: UserRole;
  user: User | null;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const { user, isUserLoading } = useFirebase();
  const firestore = useFirebase().firestore;
  const [role, setRole] = useState<UserRole>(null);
  
  const ownerTenantQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'tenants'), where('userId', '==', user.uid));
  }, [user, firestore]);

  const { data: tenants, isLoading: tenantsLoading } = useCollection<Tenant>(ownerTenantQuery);

  const staffDirectoryEntryRef = useMemoFirebase(() => {
    if (!user || !firestore || role === 'owner') return null;
    return doc(firestore, 'staffDirectory', user.uid);
  }, [user, firestore, role]);

  const { data: staffDirectoryEntry, isLoading: isStaffDirectoryLoading } = useDoc(staffDirectoryEntryRef);

  const staffTenantId = staffDirectoryEntry?.tenantId;
  const staffTenantRef = useMemoFirebase(() => {
    if (!firestore || !staffTenantId) return null;
    return doc(firestore, 'tenants', staffTenantId);
  }, [firestore, staffTenantId]);
  const { data: staffTenant, isLoading: staffTenantLoading } = useDoc<Tenant>(staffTenantRef);

  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  
  useEffect(() => {
    if (isUserLoading || tenantsLoading) return;

    if (tenants && tenants.length > 0) {
      setRole('owner');
      const storedTenantId = localStorage.getItem('selectedTenantId');
      const activeTenant = tenants.find(t => t.id === storedTenantId) || tenants[0];
      if (selectedTenant?.id !== activeTenant.id) {
          setSelectedTenant(activeTenant);
          localStorage.setItem('selectedTenantId', activeTenant.id);
      }
    } else {
        // If not an owner, check if they are staff
        if (!isStaffDirectoryLoading) {
            if (staffTenant) {
                setRole('staff');
                if (selectedTenant?.id !== staffTenant.id) {
                    setSelectedTenant(staffTenant);
                    localStorage.setItem('selectedTenantId', staffTenant.id);
                }
            } else {
                setRole(null);
                setSelectedTenant(null);
            }
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenants, tenantsLoading, isStaffDirectoryLoading, staffTenant]);

  const handleSetSelectedTenant = useCallback((tenant: Tenant) => {
    if (role === 'owner') {
        setSelectedTenant(tenant);
        localStorage.setItem('selectedTenantId', tenant.id);
    }
    // Staff cannot switch tenants.
  }, [role]);
  
  const isLoading = isUserLoading || tenantsLoading || (user && !tenants?.length && isStaffDirectoryLoading) || (isStaffDirectoryLoading && staffTenantLoading);

  const value = {
    tenants: tenants || [],
    selectedTenant,
    setSelectedTenant: handleSetSelectedTenant,
    isLoading,
    role,
    user
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
