/**
 * lib/booth-rental-hooks.ts
 *
 * Read-side counterpart to booth-rental-service.ts. Replaces the
 * near-identical `useMemo` blocks that were copy-pasted across
 * BoothsPage, RentersPage, ReceiptsPage, and RentRollPage:
 *
 *   - boothById / renterById  (4 separate copies, identical logic)
 *   - activeLeaseByBooth / activeLeaseByRenter  (3 copies, DIFFERENT
 *     status filters each time)
 *
 * Multi-location update: every collection hook now accepts an optional
 * `locationId` filter. This is the query-layer half of the trust boundary
 * called out in firestore.rules — the security rules CANNOT filter `list`
 * queries by document field, so the actual location-scoping enforcement
 * for "what does a staff member assigned to Location A see" depends on
 * every collection query in the app going through these hooks with the
 * current location passed in. See the long comment in firestore.rules
 * (search LOCATION-SCOPED LIST CAVEAT) for the full reasoning — these
 * hooks are the other half of that tradeoff, not a separate concern.
 */

import { useMemo } from 'react';
import { collection, query, where, type Query } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import {
  Booth,
  Renter,
  Lease,
  RentLedgerEntry,
  Receipt,
  BOOTH_RENTAL_COLLECTIONS,
} from '@/lib/booth-rental-types';
import {
  indexOccupyingLeaseByBooth,
  indexOccupyingLeaseByRenter,
  indexBillableLeases,
} from '@/lib/booth-rental-service';

/**
 * One subscription point for the five core collections, scoped to the
 * current tenant and — optionally — a single location. Pass
 * `locationId` once a location switcher exists in the UI; omit it (or
 * pass `null`) to fetch tenant-wide, which is also the safe default for
 * an owner viewing a combined, all-locations dashboard.
 *
 * IMPORTANT: when locationId IS provided, this applies
 * `where('locationId', '==', locationId)` to every query. That `where`
 * clause is what actually keeps a location-restricted staff member from
 * seeing another location's documents in their results — the Firestore
 * rules alone cannot do this for list queries (see file header). Always
 * pass the current location here for any UI that is meant to be
 * location-scoped; never rely on the rules alone for that guarantee.
 */
export function useBoothRentalCollections(
  tenantId: string | null,
  locationId?: string | null
) {
  const { firestore } = useFirebase();

  const scoped = (path: string | null): Query | null => {
    if (!firestore || !path) return null;
    const base = collection(firestore, path);
    return locationId ? query(base, where('locationId', '==', locationId)) : base;
  };

  const boothsRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? scoped(BOOTH_RENTAL_COLLECTIONS.booths(tenantId))
        : null,
    [firestore, tenantId, locationId]
  );
  const rentersRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? scoped(BOOTH_RENTAL_COLLECTIONS.renters(tenantId))
        : null,
    [firestore, tenantId, locationId]
  );
  const leasesRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? scoped(BOOTH_RENTAL_COLLECTIONS.leases(tenantId))
        : null,
    [firestore, tenantId, locationId]
  );
  const ledgerRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? scoped(BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId))
        : null,
    [firestore, tenantId, locationId]
  );
  const receiptsRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? scoped(BOOTH_RENTAL_COLLECTIONS.receipts(tenantId))
        : null,
    [firestore, tenantId, locationId]
  );

  const booths = useCollection<Booth>(boothsRef);
  const renters = useCollection<Renter>(rentersRef);
  const leases = useCollection<Lease>(leasesRef);
  const ledger = useCollection<RentLedgerEntry>(ledgerRef);
  const receipts = useCollection<Receipt>(receiptsRef);

  return { firestore, booths, renters, leases, ledger, receipts };
}

/**
 * Tenant-wide list of locations, for a location switcher. Always
 * unscoped by definition — you can't filter locations by location.
 *
 * DEPENDENCY: this calls BOOTH_RENTAL_COLLECTIONS.locations(tenantId),
 * which does not exist yet in the real booth-rental-types.ts — it's
 * only in booth-rental-types.additions.ts, still pending merge. This
 * function (and the Location type import, if you add one) will fail to
 * compile until that merge happens. Left in now rather than stubbed out,
 * since the whole point of this pass is to have the location layer ready
 * the moment the schema catches up — comment it out only if you need a
 * build to pass before that merge lands.
 */
export function useLocations(tenantId: string | null) {
  const { firestore } = useFirebase();
  const locationsRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.locations(tenantId))
        : null,
    [firestore, tenantId]
  );
  return useCollection(locationsRef);
}

/** id -> Booth lookup. Was duplicated in BoothsPage, RentersPage, ReceiptsPage, RentRollPage. */
export function useBoothIndex(booths: Booth[] | undefined) {
  return useMemo(() => {
    const m = new Map<string, Booth>();
    (booths ?? []).forEach((b) => m.set(b.id, b));
    return m;
  }, [booths]);
}

/** id -> Renter lookup. Was duplicated in BoothsPage, ReceiptsPage, RentRollPage. */
export function useRenterIndex(renters: Renter[] | undefined) {
  return useMemo(() => {
    const m = new Map<string, Renter>();
    (renters ?? []).forEach((r) => m.set(r.id, r));
    return m;
  }, [renters]);
}

/**
 * boothId -> occupying lease. Replaces BoothsPage's local
 * `activeLeaseByBooth` (which used ['active','on_leave']) with the
 * canonical OCCUPYING_LEASE_STATUSES definition.
 */
export function useOccupyingLeaseByBooth(leases: Lease[] | undefined) {
  return useMemo(() => indexOccupyingLeaseByBooth(leases ?? []), [leases]);
}

/**
 * renterId -> occupying lease. Replaces RentersPage's
 * `activeLeaseByRenter` (which used ['active','on_leave','pending_signature'])
 * and ReceiptsPage's (which used ['active','on_leave']) with one shared
 * definition.
 */
export function useOccupyingLeaseByRenter(leases: Lease[] | undefined) {
  return useMemo(() => indexOccupyingLeaseByRenter(leases ?? []), [leases]);
}

/**
 * renterId -> billable lease (status === 'active' only). Replaces
 * RentRollPage's `leaseByRenter`, which was the strictest of the three
 * original filters and is now made explicit as "billable" rather than
 * implicitly meaning "active" while other pages used a looser definition
 * for the same word.
 */
export function useBillableLeaseByRenter(leases: Lease[] | undefined) {
  return useMemo(() => {
    const m = new Map<string, Lease>();
    indexBillableLeases(leases ?? []).forEach((l) => m.set(l.renterId, l));
    return m;
  }, [leases]);
}

/** renterId -> ledger entries, sorted newest-first by due/created date. */
export function useLedgerByRenter(ledger: RentLedgerEntry[] | undefined) {
  return useMemo(() => {
    const map = new Map<string, RentLedgerEntry[]>();
    (ledger ?? []).forEach((entry) => {
      const list = map.get(entry.renterId) ?? [];
      list.push(entry);
      map.set(entry.renterId, list);
    });
    map.forEach((list) =>
      list.sort((a, b) =>
        (b.dueDate ?? b.createdAt ?? '').localeCompare(a.dueDate ?? a.createdAt ?? '')
      )
    );
    return map;
  }, [ledger]);
}

/**
 * id -> Location lookup, mirroring useBoothIndex/useRenterIndex. Useful
 * once a location switcher or a combined dashboard needs to label rows
 * with their location name.
 */
export function useLocationIndex(locations: { id: string }[] | undefined) {
  return useMemo(() => {
    const m = new Map<string, { id: string }>();
    (locations ?? []).forEach((l) => m.set(l.id, l));
    return m;
  }, [locations]);
}
