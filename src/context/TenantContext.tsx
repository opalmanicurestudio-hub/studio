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
 /** Signed in with a PIN in the team app (or a shared host stand tablet): only the floor's pages are theirs here. */
 viaPortal: boolean;
 /** A shared tablet set up for the host stand (api/kitchen 'hostToken'), not a person. */
 screen: boolean;
}

export const TenantContext = createContext<TenantContextType | undefined>(undefined);

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

 // ── Team app path: signed in with a PIN (api/portal/auth), or a host stand tablet ─────────────────────────────────
 // Their sign-in carries the business and their team record; the floor's pages (My tables, Clear tables, the host
 // stand) work for them here too. Undefined while it's being read.
 const [portal, setPortal] = useState<{ tenantId: string; staffId: string; role: string; screen: boolean } | null | undefined>(undefined);
 useEffect(() => {
   if (!user || isOwner) { setPortal(null); return; }
   setPortal(undefined);   // a new sign-in is read afresh (never the last one's)
   let live = true;
   user.getIdTokenResult().then((r) => {
     const c: any = r?.claims || {};
     const ok = c.portal === true && typeof c.tenantId === 'string' && c.tenantId && typeof c.staffId === 'string' && c.staffId && c.isRenter !== true;
     if (live) setPortal(ok ? { tenantId: String(c.tenantId), staffId: String(c.staffId), role: String(c.role || 'staff'), screen: c.screen === true } : null);
   }).catch(() => { if (live) setPortal(null); });
   return () => { live = false; };
 }, [user, isOwner]);
 const viaPortal = !!portal && !staffDirectoryEntry;

 const staffTenantId = (staffDirectoryEntry?.tenantId as string | undefined) || (viaPortal ? portal!.tenantId : undefined);

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

   if (isStaffDirectoryLoading || (!staffDirectoryEntry && portal === undefined)) return;

   if (staffTenant && (staffDirectoryEntry || viaPortal)) {
     const r = String(staffDirectoryEntry ? (staffDirectoryEntry as any).role || 'staff' : portal?.role || 'staff');
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
   isStaffDirectoryLoading, staffTenant, staffDirectoryEntry, isUserLoading, portal, viaPortal,
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
   !!(user && !isOwner && !staffDirectoryEntry && portal === undefined) ||
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
   staffId: !user ? null : role === 'owner' ? user.uid : String((staffDirectoryEntry as any)?.staffId || (viaPortal ? portal!.staffId : '') || user.uid),
   roleId,
   can: (cap: Cap) => !!role && (role === 'owner' || canFor(selectedTenant, roleId || role, cap)),
   viaPortal,
   screen: viaPortal && !!portal?.screen,
 };

 return (
   <TenantContext.Provider value={value}>
     {children}
   </TenantContext.Provider>
 );
};

/** The tenant context when there is one (the app), or undefined on a public page (booking, visit link, kiosk). */
export const useTenantOptional = () => useContext(TenantContext);

export const useTenant = () => {
 const context = useContext(TenantContext);
 if (context === undefined) {
   throw new Error('useTenant must be used within a TenantProvider');
 }
 return context;
};
