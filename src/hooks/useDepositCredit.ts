'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useFirebase } from '@/firebase';

export interface DepositCredit {
  id: string;
  amountCents?: number;
  amountDollars?: number;
  stripePaymentIntentId?: string;
  status: string;
  clientId?: string;
  clientEmail?: string;
  createdAt?: string;
  expiresAt?: string;
  [key: string]: any;
}

interface UseDepositCreditResult {
  depositCredit: DepositCredit | null;
  isLoadingDeposit: boolean;
  hasDeposit: boolean;
  depositDollars: number;
}

/**
 * Single source of truth for "does this client have an available deposit
 * credit for this appointment." Looks up `depositCredits` directly — NOT
 * appointment.depositStatus / appointment.depositAmountCents, which aren't
 * reliably populated by the deposit-payment webhook in this codebase.
 *
 * Lookup order: by clientId, falling back to clientEmail. Most-recent-first,
 * excludes expired credits. Mirrors the pattern used by
 * studio-cancel-refund, handle-no-show-action, and the self-cancel route —
 * this hook exists so every consumer agrees with those server-side paths
 * instead of trusting a derived flag that can drift out of sync.
 *
 * @param clientId - appointment.clientId
 * @param clientEmail - client?.email (fallback lookup key)
 * @param tenantId - selectedTenant?.id
 * @param enabled - skip the query entirely when false (e.g. dialog closed)
 */
export function useDepositCredit(
  clientId: string | undefined,
  clientEmail: string | undefined,
  tenantId: string | undefined,
  enabled: boolean = true,
): UseDepositCreditResult {
  const { firestore } = useFirebase();
  const [depositCredit, setDepositCredit] = useState<DepositCredit | null>(null);
  const [isLoadingDeposit, setIsLoadingDeposit] = useState(false);

  useEffect(() => {
    if (!enabled || !firestore || !tenantId) {
      setDepositCredit(null);
      return;
    }
    let cancelled = false;
    setIsLoadingDeposit(true);
    (async () => {
      try {
        const creditsCol = collection(firestore, `tenants/${tenantId}/depositCredits`);
        let snap = clientId
          ? await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientId', '==', clientId)))
          : null;
        if ((!snap || snap.empty) && clientEmail) {
          snap = await getDocs(
            query(
              creditsCol,
              where('status', '==', 'available'),
              where('clientEmail', '==', String(clientEmail).toLowerCase().trim()),
            ),
          );
        }
        if (cancelled) return;
        if (snap && !snap.empty) {
          const candidates = snap.docs
            .map(d => ({ id: d.id, ...(d.data() as any) }))
            .filter((c: any) => !c.expiresAt || new Date(c.expiresAt).getTime() > Date.now());
          candidates.sort(
            (a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
          );
          setDepositCredit(candidates[0] || null);
        } else {
          setDepositCredit(null);
        }
      } catch (e) {
        console.warn('[useDepositCredit lookup]', e);
        if (!cancelled) setDepositCredit(null);
      } finally {
        if (!cancelled) setIsLoadingDeposit(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, firestore, tenantId, clientId, clientEmail]);

  const hasDeposit = !!depositCredit;
  const depositDollars = depositCredit
    ? Number(depositCredit.amountDollars ?? (depositCredit.amountCents || 0) / 100)
    : 0;

  return { depositCredit, isLoadingDeposit, hasDeposit, depositDollars };
}
