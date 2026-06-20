'use client';

/**
 * StoreCreditBadge
 *
 * Compact badge shown next to client name anywhere credit exists.
 * Used in: booking search results, WalkInQueue, AppointmentDetailsSheet header.
 * Intentionally tiny — just a signal, not the full panel.
 */

import React from 'react';
import { Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type StoreCredit, isCreditExpiringSoon } from '@/hooks/useStoreCredit';

interface Props {
  credits: StoreCredit[];
  totalAvailable: number;
  className?: string;
}

export const StoreCreditBadge: React.FC<Props> = ({ credits, totalAvailable, className }) => {
  if (totalAvailable <= 0) return null;

  const expiringSoon = credits.some(c => isCreditExpiringSoon(c.expiresAt, 14));

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border-2',
      expiringSoon
        ? 'bg-amber-50 border-amber-300 text-amber-700'
        : 'bg-green-50 border-green-300 text-green-700',
      className,
    )}>
      <Wallet className="w-2.5 h-2.5" />
      ${totalAvailable.toFixed(2)} credit
      {expiringSoon && ' · expiring'}
    </span>
  );
};
