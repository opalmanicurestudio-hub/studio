'use client';

import { useMemo } from 'react';
import { useUser } from '@/firebase';
import { useInventory } from '@/context/InventoryContext';
import { type Staff } from '@/lib/data';

/**
 * Path: hooks/use-current-staff.ts
 *
 * Resolves the currently signed-in Firebase Auth user to their real Staff
 * record. This works because Staff doc IDs ARE the Firebase Auth uid —
 * confirmed by firestore.rules' staffDoc(tenantId), which does
 * get(.../staff/$(request.auth.uid)). No custom claims or separate
 * lookup table needed.
 *
 * Replaces the "first admin/owner in staff" placeholder previously used in
 * ReplenishmentApprovalQueue and the currentStaff prop previously required
 * by ReplenishmentRequestForm.
 */
export type CurrentStaffResult = {
  currentStaff: Staff | null;
  isLoading: boolean;
  /** True once loading is finished but no matching Staff doc was found for this uid. */
  isUnrecognized: boolean;
  isManager: boolean;
};

export function useCurrentStaff(): CurrentStaffResult {
  const { user, isUserLoading } = useUser();
  const { staff, isLoading: isInventoryLoading } = useInventory();

  const currentStaff = useMemo(() => {
    if (!user) return null;
    return staff.find((s) => s.id === user.uid) ?? null;
  }, [user, staff]);

  const isLoading = isUserLoading || isInventoryLoading;
  const isUnrecognized = !isLoading && !!user && !currentStaff;
  const isManager = currentStaff?.role === 'admin' || currentStaff?.role === 'owner';

  return { currentStaff, isLoading, isUnrecognized, isManager };
}
