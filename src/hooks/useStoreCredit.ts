'use client';

/**
 * useStoreCredit
 *
 * Single source of truth for store credit across all surfaces.
 * All four surfaces (POS, AppointmentDetailsSheet, ClientProfile,
 * BookingConfirmation) import from here — consistent data, consistent logic.
 *
 * Returns:
 *  - credits:          all credit entries for this client
 *  - availableCredits: only non-expired, non-used entries
 *  - totalAvailable:   sum in dollars
 *  - applyCredit:      applies a partial or full credit at checkout
 *  - isApplying:       loading state
 */

import { useMemo, useState, useCallback } from 'react';
import type { Client } from '@/lib/data';

export interface StoreCredit {
  id: string;
  tenantId: string;
  clientId: string;
  appointmentId: string;           // source appointment that generated this credit
  amount: number;                  // dollars
  amountCents: number;
  reason: string;                  // human-readable e.g. "Studio cancellation — deposit converted to credit"
  cancelReason?: string;
  expiresAt: string | null;        // ISO string or null (never expires)
  createdAt: string;
  usedAt: string | null;
  usedOnAppointmentId: string | null;
  status: 'available' | 'used' | 'expired';
}

interface UseCreditResult {
  credits: StoreCredit[];
  availableCredits: StoreCredit[];
  totalAvailable: number;
  hasCredit: boolean;
  applyCredit: (opts: ApplyCreditOpts) => Promise<ApplyCreditResult>;
  isApplying: boolean;
}

interface ApplyCreditOpts {
  tenantId: string;
  appointmentId: string;
  amountToApply: number;           // dollars — can be partial
  staffId: string;
}

interface ApplyCreditResult {
  ok: boolean;
  appliedAmount: number;
  remainingBalance: number;        // what client still owes after credit
  creditIdsUsed: string[];
  error?: string;
}

export function useStoreCredit(client: Client | null | undefined): UseCreditResult {
  const [isApplying, setIsApplying] = useState(false);

  const credits = useMemo<StoreCredit[]>(() => {
    if (!client) return [];
    return (client as any).storeCredits || [];
  }, [client]);

  const availableCredits = useMemo(() => {
    const now = new Date();
    return credits.filter(c => {
      if (c.status === 'used') return false;
      if (c.status === 'expired') return false;
      if (c.usedAt) return false;
      if (c.expiresAt && new Date(c.expiresAt) < now) return false;
      return true;
    });
  }, [credits]);

  const totalAvailable = useMemo(
    () => availableCredits.reduce((sum, c) => sum + c.amount, 0),
    [availableCredits],
  );

  const hasCredit = totalAvailable > 0;

  const applyCredit = useCallback(
    async (opts: ApplyCreditOpts): Promise<ApplyCreditResult> => {
      setIsApplying(true);
      try {
        const res = await fetch('/api/stripe/apply-store-credit', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId:      opts.tenantId,
            clientId:      client?.id,
            appointmentId: opts.appointmentId,
            amountToApply: opts.amountToApply,
            staffId:       opts.staffId,
          }),
        });
        const data = await res.json();
        return data;
      } catch (err: any) {
        return { ok: false, appliedAmount: 0, remainingBalance: opts.amountToApply, creditIdsUsed: [], error: err?.message };
      } finally {
        setIsApplying(false);
      }
    },
    [client?.id],
  );

  return { credits, availableCredits, totalAvailable, hasCredit, applyCredit, isApplying };
}

// ── Formatting helpers used across all surfaces ───────────────────────────────

export function formatCreditExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'Never expires';
  const d = new Date(expiresAt);
  const now = new Date();
  const daysLeft = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 0)  return 'Expired';
  if (daysLeft === 1) return 'Expires tomorrow';
  if (daysLeft <= 7)  return `Expires in ${daysLeft} days`;
  if (daysLeft <= 30) return `Expires ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return `Expires ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function isCreditExpiringSoon(expiresAt: string | null, withinDays = 14): boolean {
  if (!expiresAt) return false;
  const d = new Date(expiresAt);
  const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
  return d < cutoff;
}
