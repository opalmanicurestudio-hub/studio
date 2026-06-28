'use client';
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { collection, query, where, doc, updateDoc } from 'firebase/firestore';
import { type Tenant } from '@/lib/data';
import type { User } from 'firebase/auth';

type UserRole = 'owner' | 'admin' | 'staff' | null;

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

  // ── Owner path ─────────────────────────────────────────────────────────────
  const ownerTenantQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'tenants'), where('userId', '==', user.uid));
  }, [user, firestore]);

  const { data: tenants, isLoading: tenantsLoading } = useCollection<Tenant>(ownerTenantQuery);

  const isOwner = !!(tenants && tenants.length > 0);

  // ── Staff path — only runs when user has no owned tenants ──────────────────
  const staffDirectoryEntryRef = useMemoFirebase(() => {
    if (!user || !firestore || isOwner) return null;
    return doc(firestore, 'staffDirectory', user.uid);
  }, [user, firestore, isOwner]);

  const { data: staffDirectoryEntry, isLoading: isStaffDirectoryLoading } = useDoc(staffDirectoryEntryRef);

  const staffTenantId = staffDirectoryEntry?.tenantId as string | undefined;

  const staffTenantRef = useMemoFirebase(() => {
    if (!firestore || !staffTenantId) return null;
    return doc(firestore, 'tenants', staffTenantId);
  }, [firestore, staffTenantId]);

  const { data: staffTenant, isLoading: staffTenantLoading } = useDoc<Tenant>(staffTenantRef);

  // ── Selected tenant ────────────────────────────────────────────────────────
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    if (isUserLoading || tenantsLoading) return;

    if (isOwner && tenants) {
      setRole('owner');
      const storedTenantId = localStorage.getItem('selectedTenantId');
      const activeTenant = tenants.find(t => t.id === storedTenantId) || tenants[0];
      setSelectedTenant(activeTenant);
      localStorage.setItem('selectedTenantId', activeTenant.id);
      return;
    }

    if (isStaffDirectoryLoading) return;

    if (staffTenant && staffDirectoryEntry) {
      setRole((staffDirectoryEntry as any).role || 'staff');
      setSelectedTenant(staffTenant);
      localStorage.setItem('selectedTenantId', staffTenant.id);
    } else {
      setRole(null);
      setSelectedTenant(null);
    }
  }, [user, tenants, tenantsLoading, isOwner, isStaffDirectoryLoading, staffTenant, staffDirectoryEntry, isUserLoading]);

  // ── Self-heal: ensure tenant doc has userId set ────────────────────────────
  useEffect(() => {
    if (!user || !firestore || !tenants || tenants.length === 0) return;
    tenants.forEach(tenant => {
      if (!tenant.userId) {
        updateDoc(doc(firestore, 'tenants', tenant.id), { userId: user.uid })
          .catch(() => {}); // silent — next render will pick it up
      }
    });
  }, [user, firestore, tenants]);

  // ── isLoading ──────────────────────────────────────────────────────────────
  const isLoading =
    isUserLoading ||
    tenantsLoading ||
    !!(user && !isOwner && isStaffDirectoryLoading) ||
    !!(staffTenantId && staffTenantLoading);

  // ── Tenant switching (owners only) ─────────────────────────────────────────
  const handleSetSelectedTenant = useCallback((tenant: Tenant) => {
    if (role === 'owner') {
      setSelectedTenant(tenant);
      localStorage.setItem('selectedTenantId', tenant.id);
    }
  }, [role]);

  const value: TenantContextType = {
    tenants: tenants || [],
    selectedTenant,
    setSelectedTenant: handleSetSelectedTenant,
    isLoading,
    role,
    user,
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
