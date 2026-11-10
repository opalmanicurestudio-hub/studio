'use client';
// components/renters/RentalsNav.tsx — THE RENTALS TABS. One row of tabs shared by every Rentals page (Home, Spaces,
// Renters, Rent, Pipeline, Policies), so moving between them is one tap from anywhere in the area. On a phone the row
// scrolls sideways inside itself; the page never does.
import * as React from 'react';
import Link from 'next/link';

export const RENTALS_TABS: { href: string; label: string }[] = [
  { href: '/rentals', label: 'Home' },
  { href: '/booths', label: 'Spaces' },
  { href: '/renters', label: 'Renters' },
  { href: '/rent', label: 'Rent' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/rental-policies', label: 'Policies' },
];

export function RentalsNav({ current, className = '' }: { current: string; className?: string }) {
  return (
    <nav aria-label="Rentals" className={`max-w-full overflow-x-auto ${className}`}>
      <div className="inline-flex gap-1 rounded-[14px] bg-[#ececee] p-1">
        {RENTALS_TABS.map((t) => {
          const on = t.href === current;
          return (
            <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined}
              className={`inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-xl px-3.5 text-[15px] ${on ? 'bg-white font-semibold text-[#16171a] shadow-[0_1px_2px_rgba(22,23,26,0.06)]' : 'text-[#6d7075] hover:text-[#16171a]'}`}>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
