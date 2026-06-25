'use client';

// ─────────────────────────────────────────────────────────────────────────────
// StatusStrip
//
// Drop-in replacement for the KPI hero row currently rendered above the
// timeline. Branches automatically on provider count:
//   - solo (staff.length <= 1)   -> calm single-line "today" summary
//   - multi (staff.length > 1)   -> compact metric cards (till, waiting,
//                                   in-service, ready-to-pay, today's revenue)
//
// Zero new Firestore reads. Every number here is derived from data the
// Planner page already has in memory (appointments, walkIns, transactions,
// activeTill). This component is pure presentation.
//
// Usage in PlannerPageContent, replacing the old KPI row markup:
//
//   <StatusStrip
//     staffCount={staff.length}
//     activeTill={activeTill}                 // from till session data, or null if no till feature
//     waitingCount={waitingWalkInsCount}
//     inServiceCount={inServiceCount}
//     readyToPayCount={readyForCheckoutCount}
//     todayRevenue={kpis.weeklyRevenue ? todayRevenueValue : 0} // see note below
//   />
//
// `todayRevenue` should be today's gross, not weekly — Planner's existing
// `kpis` object computes weekly figures. If you want a "today" number, filter
// `transactions` by `isToday(safeDate(t.date)) && t.type === 'income'` the
// same way POSPage's kpiData already does, and pass the sum in here. Left as
// a prop rather than computed inside this component, since the page owns
// data fetching and this component should stay a pure renderer.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Wallet, Clock, UserCheck, Receipt, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatusStripProps {
  staffCount: number;
  activeTill: { expectedCash?: number } | null;
  waitingCount: number;
  inServiceCount: number;
  readyToPayCount: number;
  todayRevenue: number;
  /** Show till card at all. Pass false for tenants without till/cash-drawer tracking enabled. */
  showTill?: boolean;
  className?: string;
}

const MetricCard = ({
  icon,
  label,
  value,
  accent,
  live,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: 'warning' | 'success' | 'revenue';
  live?: boolean;
}) => {
  const accentBg =
    accent === 'warning'
      ? 'bg-amber-50'
      : accent === 'revenue'
      ? 'bg-amber-50'
      : 'bg-white';
  const accentText =
    accent === 'warning'
      ? 'text-amber-700'
      : accent === 'revenue'
      ? 'text-amber-900'
      : 'text-slate-900';
  const labelText = accent === 'warning' || accent === 'revenue' ? 'text-amber-700/80' : 'text-muted-foreground';

  return (
    <div className={cn('relative rounded-xl border border-slate-200 px-3.5 py-3', accentBg)}>
      {live && (
        <span className="absolute top-3 right-3 flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
        </span>
      )}
      <p className={cn('text-[11px] font-medium flex items-center gap-1.5 mb-1.5', labelText)}>
        {icon}
        {label}
      </p>
      <p className={cn('text-[19px] font-medium tracking-tight leading-none', accentText)}>{value}</p>
    </div>
  );
};

export function StatusStrip({
  staffCount,
  activeTill,
  waitingCount,
  inServiceCount,
  readyToPayCount,
  todayRevenue,
  showTill = true,
  className,
}: StatusStripProps) {
  const isSolo = staffCount <= 1;

  // ── Solo mode: one calm line, not a card grid. ────────────────────────────
  // A single provider doesn't need "who's free" framing — there's no one
  // else to assign anything to. Surfacing a card grid that's mostly about
  // staffing for a one-person business reads as broken, not minimal.
  if (isSolo) {
    const parts: string[] = [];
    if (inServiceCount > 0) parts.push(`in service`);
    if (readyToPayCount > 0) parts.push(`${readyToPayCount} ready to checkout`);
    if (waitingCount > 0) parts.push(`${waitingCount} waiting`);

    return (
      <div className={cn('flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3', className)}>
        <div className="flex items-center gap-5 text-sm">
          {showTill && activeTill && (
            <span className="flex items-center gap-1.5 font-medium text-slate-900">
              <Wallet className="w-3.5 h-3.5 text-slate-400" />
              ${(activeTill.expectedCash ?? 0).toFixed(2)}
            </span>
          )}
          {readyToPayCount > 0 && (
            <span className="flex items-center gap-1.5 font-medium text-emerald-700">
              <Receipt className="w-3.5 h-3.5" />
              {readyToPayCount} ready to checkout
            </span>
          )}
          {waitingCount > 0 && (
            <span className="flex items-center gap-1.5 font-medium text-amber-700">
              <Clock className="w-3.5 h-3.5" />
              {waitingCount} waiting
            </span>
          )}
          {parts.length === 0 && (
            <span className="text-muted-foreground">Nothing waiting right now</span>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
          <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
          ${todayRevenue.toFixed(0)} today
        </span>
      </div>
    );
  }

  // ── Multi-provider mode: the compact metric grid. ─────────────────────────
  const cardCount = showTill ? 5 : 4;

  return (
    <div
      className={cn('grid gap-2.5', className)}
      style={{ gridTemplateColumns: `repeat(${cardCount}, minmax(0, 1fr))` }}
    >
      {showTill && (
        <MetricCard
          icon={<Wallet className="w-3.5 h-3.5" />}
          label="Till"
          value={activeTill ? `$${(activeTill.expectedCash ?? 0).toFixed(2)}` : '—'}
        />
      )}
      <MetricCard
        icon={<Clock className="w-3.5 h-3.5" />}
        label="Waiting"
        value={String(waitingCount)}
        accent={waitingCount > 0 ? 'warning' : undefined}
        live={waitingCount > 0}
      />
      <MetricCard
        icon={<UserCheck className="w-3.5 h-3.5" />}
        label="In service"
        value={String(inServiceCount)}
      />
      <MetricCard
        icon={<Receipt className="w-3.5 h-3.5" />}
        label="Ready to pay"
        value={String(readyToPayCount)}
        accent={readyToPayCount > 0 ? 'success' : undefined}
      />
      <MetricCard
        icon={<TrendingUp className="w-3.5 h-3.5" />}
        label="Today so far"
        value={`$${todayRevenue.toFixed(0)}`}
        accent="revenue"
      />
    </div>
  );
}
