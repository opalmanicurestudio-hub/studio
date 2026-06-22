'use client';
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { collection, query, where, doc } from 'firebase/firestore';
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
      return; // ← owner resolved; never touch staff path
    }

    // Not an owner — wait for staff directory check to settle
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

  // ── isLoading ──────────────────────────────────────────────────────────────
  // Fix: the old fourth condition `!!(isStaffDirectoryLoading && staffTenantLoading)`
  // fired permanently for owners because useDoc(null) can return isLoading:true.
  // Now we only count staff-tenant loading when we actually have a staffTenantId to fetch.
  const isLoading =
    isUserLoading ||
    tenantsLoading ||
    // Non-owner waiting for staff directory lookup
    !!(user && !isOwner && isStaffDirectoryLoading) ||
    // Staff user waiting for their tenant doc (only meaningful when we have an ID)
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
