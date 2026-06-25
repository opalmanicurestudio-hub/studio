'use client';

// ─────────────────────────────────────────────────────────────────────────────
// hooks/useProfitabilityVisibility.ts
//
// Per-user toggle controlling whether profitability signals render on
// appointment cards. Persists to Firestore on the current user's staff doc
// so it survives across sessions/devices — a local-only toggle would reset
// every time someone logs in on a different device, which defeats the
// purpose of a deliberate, considered choice to view margin data.
//
// Defaults to OFF for any user who hasn't set a preference yet. This is a
// deliberate safe default given the front-desk-visibility concern raised
// earlier — nobody should see margin data appear by surprise.
//
// Storage location: tenants/{tenantId}/staff/{uid}.showProfitability (boolean)
// This is the same staff doc already read/written throughout POSPage and
// PlannerPageContent (e.g. `doc(firestore, 'tenants', tenantId, 'staff', sid)`),
// so this adds one field to an existing document — no new collection.
//
// Usage:
//   const { showProfitability, setShowProfitability, isLoading } = useProfitabilityVisibility();
//
//   <Switch checked={showProfitability} onCheckedChange={setShowProfitability} disabled={isLoading} />
//
//   // inside AppointmentCard or wherever the signal renders:
//   {showProfitability && profitTier && <ProfitBadge tier={profitTier} />}
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { doc } from 'firebase/firestore';
import { useFirebase, setDocumentNonBlocking } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useUser } from '@/firebase';

export function useProfitabilityVisibility() {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;

  const [showProfitability, setShowProfitabilityState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !tenantId || !user?.uid) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    let unsub: (() => void) | undefined;

    // Lazy import to avoid pulling onSnapshot into every call site that
    // doesn't need live updates — this hook is the one place that does.
    import('firebase/firestore').then(({ onSnapshot }) => {
      const ref = doc(firestore, 'tenants', tenantId, 'staff', user.uid);
      unsub = onSnapshot(
        ref,
        (snap) => {
          const data = snap.data();
          setShowProfitabilityState(data?.showProfitability === true);
          setIsLoading(false);
        },
        () => {
          // Read failure (e.g. permissions, doc doesn't exist yet) — fall
          // back to the safe default rather than leaving state undefined.
          setShowProfitabilityState(false);
          setIsLoading(false);
        }
      );
    });

    return () => { if (unsub) unsub(); };
  }, [firestore, tenantId, user?.uid]);

  const setShowProfitability = useCallback(
    (value: boolean) => {
      if (!firestore || !tenantId || !user?.uid) return;
      setShowProfitabilityState(value);
      setDocumentNonBlocking(
        doc(firestore, 'tenants', tenantId, 'staff', user.uid),
        { showProfitability: value },
        { merge: true }
      );
    },
    [firestore, tenantId, user?.uid]
  );

  return { showProfitability, setShowProfitability, isLoading };
}
