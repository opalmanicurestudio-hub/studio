'use client';
// components/renters/RentalsNav.tsx — THE RENTALS TABS AND HEADER. One header shared by every Rentals page (Home,
// Spaces, Renters, Rent, Pipeline, Policies): the business's name, Rentals, the page's own buttons, and one row of
// tabs, so moving between them is one tap from anywhere in the area. On a phone the tabs scroll sideways inside
// themselves; the page never does.
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

/** Buttons in the Rentals header, light and dark. */
export const RENTALS_BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#ececee] bg-white px-3.5 text-[14px] font-medium text-[#16171a] hover:bg-[#f5f5f7] disabled:opacity-40';
export const RENTALS_BTN_DARK = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[#16171a] px-3.5 text-[14px] font-semibold text-white disabled:opacity-40';

export function RentalsHeader({ businessName, current, actions }: { businessName?: string; current: string; actions?: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {businessName && <p className="text-[13px] leading-snug text-[#6d7075]">{businessName}</p>}
          <h2 className="text-[28px] font-bold leading-9 text-[#16171a]">Rentals</h2>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <RentalsNav current={current} />
    </div>
  );
}
