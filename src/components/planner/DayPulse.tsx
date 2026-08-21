'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * DayPulse — the day's money in one line, for whoever is running the shop.
 *
 * The weekly KPI sheet already existed but it is a sheet: you have to know to
 * open it, and it answers a different question ("how is the week going") from
 * the one someone staring at today has ("is today worth what it looks like").
 * So this sits under the date, always visible, and never opens anything.
 *
 * It is gated on the same useProfitabilityVisibility flag as the ticket on the
 * card, so a provider reading their own day never sees it. Money follows
 * authority, in one place, consistently.
 */
export function DayPulse({
  booked,
  net,
  bookedMinutes,
  availableMinutes,
  className,
}: {
  booked: number;
  net: number;
  bookedMinutes: number;
  availableMinutes: number;
  className?: string;
}) {
  if (booked <= 0 && bookedMinutes <= 0) return null;

  const utilisation = availableMinutes > 0
    ? Math.round((bookedMinutes / availableMinutes) * 100)
    : null;

  const cells: Array<{ label: string; value: string; tone?: 'bad' }> = [
    { label: 'Booked', value: `$${Math.round(booked).toLocaleString()}` },
    { label: 'Net', value: `${net < 0 ? '-' : ''}$${Math.round(Math.abs(net)).toLocaleString()}`, ...(net < 0 ? { tone: 'bad' as const } : {}) },
  ];
  if (utilisation !== null) {
    cells.push({ label: 'Chair', value: `${utilisation}%` });
  }

  return (
    <div
      className={cn('flex w-full items-stretch gap-2 overflow-x-auto scrollbar-hide', className)}
      aria-label="Today at a glance"
    >
      {cells.map(cell => (
        <div
          key={cell.label}
          className="flex min-w-0 flex-1 shrink-0 flex-col justify-center rounded-xl border-2 border-border bg-white px-3 py-2"
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{cell.label}</span>
          <span className={cn(
            'mt-0.5 tabular-nums text-[15px] font-black tracking-tight leading-none',
            cell.tone === 'bad' ? 'text-destructive' : 'text-foreground',
          )}>
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  );
}
