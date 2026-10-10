'use client';
import { useMyTenants } from '@/lib/my-tenants-client';
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { collection, query, where, doc, updateDoc } from 'firebase/firestore';
import { type Tenant } from '@/lib/data';
import type { User } from 'firebase/auth';
import { can as canFor, isManagerRole, type Cap } from '@/lib/permissions';

type UserRole = 'owner' | 'admin' | 'manager' | 'staff' | null;

interface TenantContextType {
 tenants: Tenant[];
 selectedTenant: Tenant | null;
 setSelectedTenant: (tenant: Tenant) => void;
 isLoading: boolean;
 role: UserRole;
 user: User | null;
 /** The signed-in person's STAFF record id — their login for the owner, the linked record for an invited team member. */
 staffId: string | null;
 /** Their actual role id at this business (a built-in or one the business made). `role` above is the broad level. */
 roleId: string | null;
 /** May the signed-in person do this? (lib/permissions) — the owner always can. */
 can: (cap: Cap) => boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider = ({ children }: { children: ReactNode }) => {
 const { user, isUserLoading } = useFirebase();
 const firestore = useFirebase().firestore;
 const [role, setRole] = useState<UserRole>(null);
 const [roleId, setRoleId] = useState<string | null>(null);

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
     setRole('owner'); setRoleId('owner');
     const stored = localStorage.getItem('selectedTenantId');
     const activeTenant = allTenants.find(t => t.id === stored) || allTenants[0];
     setSelectedTenant(activeTenant);
     localStorage.setItem('selectedTenantId', activeTenant.id);
     return;
   }

   if (isStaffDirectoryLoading) return;

   if (staffTenant && staffDirectoryEntry) {
     const r = String((staffDirectoryEntry as any).role || 'staff');
     setRoleId(r);
     // Custom roles map to the broad level the rest of the app understands; what they may do comes from can().
     setRole((['owner', 'admin', 'manager', 'staff'].includes(r) ? r : isManagerRole(staffTenant, r) ? 'manager' : 'staff') as UserRole);
     setSelectedTenant(staffTenant);
     localStorage.setItem('selectedTenantId', staffTenant.id);
   } else {
     setRole(null); setRoleId(null);
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
   staffId: !user ? null : role === 'owner' ? user.uid : String((staffDirectoryEntry as any)?.staffId || user.uid),
   roleId,
   can: (cap: Cap) => !!role && (role === 'owner' || canFor(selectedTenant, roleId || role, cap)),
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
