'use client';
import { useMyTenants } from '@/lib/my-tenants-client';
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
 // Owner path — which businesses are MINE comes from the server (the rules forbid listing businesses from a browser;
 // the old query was always refused and the app then trusted a business id stored in this browser as "mine").
 const { tenants: allTenants, loading: tenantsLoading } = useMyTenants(user, firestore as any);
 const fallbackLoading = false;
 const isOwner = allTenants.length > 0;

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
   if (isUserLoading || tenantsLoading || fallbackLoading) return;

   if (isOwner && allTenants.length > 0) {
     setRole('owner');
     const stored = localStorage.getItem('selectedTenantId');
     const activeTenant = allTenants.find(t => t.id === stored) || allTenants[0];
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
 }, [
   user, allTenants, tenantsLoading, fallbackLoading, isOwner,
   isStaffDirectoryLoading, staffTenant, staffDirectoryEntry, isUserLoading,
 ]);

 // ── Self-heal: ensure tenant doc has userId set ────────────────────────────
 useEffect(() => {
   if (!user || !firestore || !allTenants.length) return;
   allTenants.forEach(tenant => {
     if (!tenant.userId) {
       updateDoc(doc(firestore, 'tenants', tenant.id), { userId: user.uid })
         .catch(() => {});
     }
   });
 }, [user, firestore, allTenants]);

 // ── isLoading ──────────────────────────────────────────────────────────────
 const isLoading =
   isUserLoading ||
   tenantsLoading ||
   fallbackLoading ||
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
   tenants: allTenants,
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
