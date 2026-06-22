'use client';
/**
 * StoreCreditSection
 *
 * Surface 2: AppointmentDetailsSheet — Client Requirements section
 *
 * Shows below deposit/card status. Gives staff a heads-up before
 * the session starts that the client has credit waiting at checkout.
 * Read-only here — application happens at the POS.
 */
import React from 'react';
import { Wallet, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStoreCredit, formatCreditExpiry, isCreditExpiringSoon } from '@/hooks/useStoreCredit';
import type { Client } from '@/lib/data';
interface Props {
  client: Client | null | undefined;
}
export const StoreCreditSection: React.FC<Props> = ({ client }) => {
  const { availableCredits, totalAvailable } = useStoreCredit(client);
  if (totalAvailable <= 0) return null;
  const expiringSoon = availableCredits.some(c => isCreditExpiringSoon(c.expiresAt, 14));
  const soonestExpiry = availableCredits
    .filter(c => c.expiresAt)
    .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime())[0];
  return (
    <div className={cn(
      'flex items-center justify-between text-[10px] font-black uppercase',
      expiringSoon ? 'text-amber-700' : 'text-green-700',
    )}>
      <span className="flex items-center gap-2">
        <Wallet className="w-3 h-3 opacity-60" />
        Store Credit
        {expiringSoon && soonestExpiry && (
          <span className="flex items-center gap-1 text-[8px] font-bold text-amber-600 opacity-80">
            <Clock className="w-2.5 h-2.5" />
            {formatCreditExpiry(soonestExpiry.expiresAt)}
          </span>
        )}
      </span>
      <span className={expiringSoon ? 'text-amber-600' : 'text-green-600'}>
        ${totalAvailable.toFixed(2)} available
      </span>
    </div>
  );
};
