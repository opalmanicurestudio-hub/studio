'use client';

/**
 * context/LocationContext.tsx
 *
 * Rewritten against the REAL src/context/TenantContext.tsx (first draft
 * was inferred from usage patterns only — see CORRECTIONS below for what
 * changed once the real file was available).
 *
 * Mirrors TenantContext's actual shape and conventions:
 *   - role-aware resolution (owner sees everything; staff sees only
 *     their assigned locationIds)
 *   - localStorage persistence of the selected location, same key
 *     convention as `selectedTenantId`
 *   - the SAME isLoading null-ref guard TenantContext had to add, with
 *     the same reasoning, because this context has the same shape of bug
 *     waiting in it otherwise (see CORRECTIONS #3)
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useFirebase, useMemoFirebase } from '@/firebase/provider';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { doc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { Location, BOOTH_RENTAL_COLLECTIONS } from '@/lib/booth-rental-types';

// ─────────────────────────────────────────────────────────────────────────
// CORRECTIONS — what changed once the real TenantContext.tsx arrived
// ─────────────────────────────────────────────────────────────────────────
//
// 1. IMPORT PATHS: the real TenantContext imports useCollection from
//    '@/firebase/firestore/use-collection' and useDoc from
//    '@/firebase/firestore/use-doc' — deep paths, not a '@/firebase'
//    barrel export. The original 4 booth-rental pages imported
//    useCollection from the '@/firebase' barrel instead, which is a real
//    inconsistency already present in your codebase, not something this
//    file introduces. This file matches TenantContext's deep-import
//    convention since it sits in the same context/ folder and the two
//    will likely be read side-by-side — but booth-rental-hooks.ts (which
//    matches the 4 pages' barrel-import convention) was left as-is. If
//    '@/firebase' doesn't actually re-export useCollection/useDoc, that
//    inconsistency needs resolving at the barrel-export level, not by
//    guessing which import style is "right" in each new file.
//
// 2. STAFF LOCATION RESTRICTION (real gap, not a style choice): the real
//    TenantContext resolves staff to exactly ONE tenant via
//    staffDirectory/{uid}.tenantId. It does NOT yet restrict staff to a
//    subset of LOCATIONS within that tenant — that's what this file adds,
//    reading StaffMember.locationIds (added in the merged
//    booth-rental-types.ts) and filtering the visible/selectable location
//    list accordingly. Owners (role === 'owner') see every location,
//    matching how isOwner() in firestore.rules is exempt from the
//    locationIds check.
//
// 3. THE isLoading NULL-REF TRAP: TenantContext's own comment explains it
//    directly — "useDoc(null) can return isLoading:true" — and the real
//    code works around this by only counting staffTenantLoading "when we
//    actually have a staffTenantId to fetch" rather than unconditionally.
//    This file has the exact same shape of risk: the staff member's own
//    StaffMember doc ref is null until `tenantId` resolves, and if
//    useDoc(null) here behaves the same way, isLoading would get stuck
//    true forever for OWNERS (who never need the staff doc at all). Fixed
//    below with the same pattern: only counted when there's a real ref to
//    resolve, not unconditionally.

export interface LocationContextValue {
  /** Locations the current user/role may access. For owners: all
   *  locations. For staff: only those in their StaffMember.locationIds. */
  locations: Location[];
  isLoading: boolean;
  selectedLocation: Location | null;
  selectedLocationId: string | null;
  setSelectedLocationId: (locationId: string) => void;
}

const LocationContext = createContext<LocationContextValue | undefined>(
  undefined
);

const STORAGE_KEY = 'selectedLocationId';

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const firestore = useFirebase().firestore;
  const { selectedTenant, role, user, isLoading: tenantLoading } = useTenant();
  const tenantId = selectedTenant?.id ?? null;
  const isOwner = role === 'owner';

  // ── All locations for the resolved tenant ──────────────────────────────
  const locationsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, BOOTH_RENTAL_COLLECTIONS.locations(tenantId));
  }, [firestore, tenantId]);

  const { data: allLocations, isLoading: locationsLoading } =
    useCollection<Location>(locationsQuery);

  // ── Staff member doc — only fetched for non-owners, mirroring
  // TenantContext's "staff path only runs when user has no owned
  // tenants" pattern exactly. ─────────────────────────────────────────────
  const staffMemberRef = useMemoFirebase(() => {
    if (!firestore || !tenantId || !user || isOwner) return null;
    return doc(firestore, BOOTH_RENTAL_COLLECTIONS.staff(tenantId), user.uid);
  }, [firestore, tenantId, user, isOwner]);

  const { data: staffMember, isLoading: staffMemberLoading } =
    useDoc(staffMemberRef);

  // ── Locations actually selectable by this user ─────────────────────────
  const locations = useMemo(() => {
    const list = allLocations ?? [];
    if (isOwner) return list;
    const allowed = new Set((staffMember as any)?.locationIds ?? []);
    return list.filter((l) => allowed.has(l.id));
  }, [allLocations, isOwner, staffMember]);

  // ── Selected location, with localStorage persistence — same
  // convention as TenantContext's selectedTenantId. ──────────────────────
  const [selectedLocationId, setSelectedLocationIdState] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (tenantLoading || locationsLoading) return;
    if (!isOwner && staffMemberLoading) return;
    if (locations.length === 0) {
      setSelectedLocationIdState(null);
      return;
    }

    const storedId =
      typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const stillValid = storedId && locations.some((l) => l.id === storedId);
    const next = stillValid
      ? storedId
      : (locations.find((l) => l.isActive) ?? locations[0]).id;

    setSelectedLocationIdState(next);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
  }, [locations, tenantLoading, locationsLoading, isOwner, staffMemberLoading]);

  const setSelectedLocationId = useCallback(
    (locationId: string) => {
      if (!locations.some((l) => l.id === locationId)) return; // refuse a
      // location outside what this user is allowed to see — mirrors
      // handleSetSelectedTenant's role-gate in the real TenantContext
      // (there: only owners may switch; here: only an allowed location
      // may be switched TO, for any role).
      setSelectedLocationIdState(locationId);
      if (typeof window !== 'undefined')
        localStorage.setItem(STORAGE_KEY, locationId);
    },
    [locations]
  );

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocationId) ?? null,
    [locations, selectedLocationId]
  );

  // ── isLoading ────────────────────────────────────────────────────────
  // CORRECTIONS #3: staffMemberLoading is only counted when this user is
  // actually a non-owner WITH a real staffMemberRef to resolve — exactly
  // the bug TenantContext's own comment describes and works around for
  // staffTenantLoading. Counting it unconditionally would leave isLoading
  // stuck true forever for every owner, since owners never fetch a
  // StaffMember doc at all (staffMemberRef is always null for them).
  const isLoading =
    tenantLoading ||
    locationsLoading ||
    !!(user && !isOwner && staffMemberLoading);

  const value: LocationContextValue = {
    locations,
    isLoading,
    selectedLocation,
    selectedLocationId: selectedLocation?.id ?? null,
    setSelectedLocationId,
  };

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
};

export const useLocation = (): LocationContextValue => {
  const ctx = useContext(LocationContext);
  if (ctx === undefined) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return ctx;
};
