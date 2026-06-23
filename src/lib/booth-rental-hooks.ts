/**
 * lib/booth-rental-hooks.ts
 *
 * Replaces the near-identical `useMemo` blocks that were copy-pasted
 * across BoothsPage, RentersPage, ReceiptsPage, and RentRollPage:
 *
 *   - boothById / renterById  (4 separate copies, identical logic)
 *   - activeLeaseByBooth / activeLeaseByRenter  (3 copies, DIFFERENT
 *     status filters each time — see FIX-7 in booth-rental-service.ts)
 *
 * Pages should call these instead of writing their own useMemo for the
 * same indexes. Less code per page, and exactly one place where "what
 * counts as active" can be changed.
 */

import { useMemo } from 'react';
import {
  collection,
} from 'firebase/firestore';
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
 * One subscription point for the four core collections, scoped to the
 * current tenant. Every page was already doing this individually with
 * identical useMemoFirebase wiring — pulling it into one hook means
 * tenant-scoping logic (the `firestore && tenantId ? ... : null` guard)
 * exists in one place instead of 4x3 = 12 near-identical call sites.
 */
export function useBoothRentalCollections(tenantId: string | null) {
  const { firestore } = useFirebase();

  const boothsRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId))
        : null,
    [firestore, tenantId]
  );
  const rentersRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId))
        : null,
    [firestore, tenantId]
  );
  const leasesRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.leases(tenantId))
        : null,
    [firestore, tenantId]
  );
  const ledgerRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId))
        : null,
    [firestore, tenantId]
  );
  const receiptsRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.receipts(tenantId))
        : null,
    [firestore, tenantId]
  );

  const booths = useCollection<Booth>(boothsRef);
  const renters = useCollection<Renter>(rentersRef);
  const leases = useCollection<Lease>(leasesRef);
  const ledger = useCollection<RentLedgerEntry>(ledgerRef);
  const receipts = useCollection<Receipt>(receiptsRef);

  return { firestore, booths, renters, leases, ledger, receipts };
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
 * definition — see FIX-7.
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
        (b.dueDate ?? b.createdAt).localeCompare(a.dueDate ?? a.createdAt)
      )
    );
    return map;
  }, [ledger]);
}
