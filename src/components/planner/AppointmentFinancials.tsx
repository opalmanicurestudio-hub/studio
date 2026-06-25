'use client';

// ─────────────────────────────────────────────────────────────────────────────
// components/planner/AppointmentFinancials.tsx
//
// The comprehensive "Layer 3" financial breakdown — full profitability
// detail for a single appointment, designed to be dropped inside
// AppointmentDetailsSheet (or any other detail view) as a self-contained
// section. Built standalone since AppointmentDetailsSheet.tsx itself wasn't
// available — this renders into a slot, it doesn't require modifying that
// file's internals beyond adding one import and one render call.
//
// Visual language matches AppointmentCard.tsx and EventCard.tsx: rounded-2xl
// bordered blocks, font-black uppercase tracking-widest labels, the same
// muted-bg/border-2 card pattern used throughout your planner components.
//
// Usage inside AppointmentDetailsSheet, wherever its existing content
// sections are (after notes/checklist-equivalent content, likely near the
// bottom alongside any existing financial/transaction display):
//
//   <AppointmentFinancials
//     appointment={appointment}
//     service={service}
//     addOnServices={addOnServices}   // resolved Service[] for any add-ons
//     staffMember={assignedStaff}
//     inventory={inventory}
//     tmhr={selectedTenant?.tmhr || 50}
//   />
//
// Gating: this section is NOT gated by the showProfitability toggle from
// useProfitabilityVisibility — that toggle controls the ambient card signal
// people see constantly while scanning the timeline. Opening a specific
// appointment's detail sheet is a deliberate look-up action; showing full
// financials there is a different, lower-frequency exposure than a margin
// badge visible on every card all day. If you want this gated too, wrap the
// render call in the same `showProfitability &&` check — that's a one-line
// change at the call site, no change needed here.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { DollarSign, TrendingUp, TrendingDown, Minus, Receipt, Wrench, Clock, Award } from 'lucide-react';
import { cn } from '@/lib/utils';
import { computeServiceCost } from '@/lib/service-cost';

interface LineItem {
  label: string;
  amount: number;
  isComped?: boolean;
}

interface AppointmentFinancialsProps {
  appointment: any;
  service: any;
  addOnServices?: any[];
  staffMember: any;
  inventory: any[];
  tmhr: number;
  className?: string;
}

const tierStyles = {
  healthy: { text: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', Icon: TrendingUp },
  thin: { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', Icon: Minus },
  negative: { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', Icon: TrendingDown },
};

export function AppointmentFinancials({
  appointment,
  service,
  addOnServices = [],
  staffMember,
  inventory,
  tmhr,
  className,
}: AppointmentFinancialsProps) {
  const checkoutState = appointment.checkoutState || {};
  const overrides = checkoutState.serviceStaffOverrides || {};

  // ── Revenue side: every line item that contributes to the ticket ─────────
  const revenueLines: LineItem[] = useMemo(() => {
    const lines: LineItem[] = [];
    const mainPrice = service?.price || 0;
    lines.push({ label: service?.name || 'Service', amount: mainPrice });

    addOnServices.forEach((addon) => {
      lines.push({ label: `+ ${addon.name}`, amount: addon.price || 0 });
    });

    const adjustments = checkoutState.adjustments;
    if (adjustments) {
      if (adjustments.rescheduleFee > 0) lines.push({ label: 'Reschedule fee', amount: adjustments.rescheduleFee });
      if (adjustments.timeOverage > 0) lines.push({ label: 'Time overage fee', amount: adjustments.timeOverage });
      if (adjustments.materialOverage > 0) lines.push({ label: 'Material overage fee', amount: adjustments.materialOverage });
    } else if (checkoutState.additionalCharge > 0) {
      lines.push({ label: 'Adjustment fee', amount: checkoutState.additionalCharge });
    }

    (checkoutState.refreshments || []).forEach((r: any) => {
      const qty = r.quantity || 1;
      lines.push({ label: `${r.name} (x${qty})`, amount: (r.price || 0) * qty });
    });

    return lines;
  }, [service, addOnServices, checkoutState]);

  const totalRevenue = revenueLines.reduce((acc, l) => acc + l.amount, 0);

  // ── Cost side: materials, labor, overhead for the main service + each add-on ─
  const costBreakdown = useMemo(() => {
    const mainCost = computeServiceCost(service, appointment, staffMember, inventory, tmhr);
    const addonCosts = addOnServices.map((addon) => {
      const addonStaffId = overrides[addon.id] || appointment.staffId;
      // Caller is expected to pass the resolved staffMember for the main
      // service; for add-ons with a different staff override, this falls
      // back to the same staffMember since we don't have the full staff
      // list here. If add-on staff overrides are common, pass a
      // staffLookup map instead of a single staffMember — left as a small
      // follow-up rather than guessed at, since I don't have visibility
      // into how often that case occurs in your data.
      return { name: addon.name, ...computeServiceCost(addon, appointment, staffMember, inventory, tmhr) };
    });
    const totalMaterials = mainCost.materials + addonCosts.reduce((acc, c) => acc + c.materials, 0);
    const totalLabor = mainCost.labor + addonCosts.reduce((acc, c) => acc + c.labor, 0);
    const totalOverhead = mainCost.overhead + addonCosts.reduce((acc, c) => acc + c.overhead, 0);
    const totalCost = Number((totalMaterials + totalLabor + totalOverhead).toFixed(2));
    return { totalMaterials, totalLabor, totalOverhead, totalCost, mainCost, addonCosts };
  }, [service, appointment, staffMember, inventory, tmhr, addOnServices, overrides]);

  const margin = Number((totalRevenue - costBreakdown.totalCost).toFixed(2));
  const marginPct = totalRevenue > 0 ? margin / totalRevenue : null;

  const tier: 'healthy' | 'thin' | 'negative' | null =
    marginPct === null ? null : marginPct >= 0.25 ? 'healthy' : marginPct >= 0.05 ? 'thin' : 'negative';

  // ── Deposit reconciliation, if a deposit was collected ────────────────────
  const depositAmount = (appointment.depositAmountCents || 0) / 100;
  const hasDeposit = depositAmount > 0;
  const remainingAfterDeposit = hasDeposit ? Math.max(0, totalRevenue - depositAmount) : null;

  // ── Redemption/comp framing: if this was redeemed via membership/package,
  // revenue collected may be $0 even though real cost was incurred. Surface
  // that gap explicitly rather than letting margin silently read as "fine"
  // when price was comped to zero. ──────────────────────────────────────────
  const isRedeemed = totalRevenue === 0 && costBreakdown.totalCost > 0;

  return (
    <div className={cn('space-y-4', className)}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
        <DollarSign className="w-3.5 h-3.5 text-primary opacity-40" /> Financial breakdown
      </p>

      {isRedeemed ? (
        <div className="p-4 rounded-2xl border-2 border-violet-200 bg-violet-50 space-y-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">Redeemed via membership or package</p>
          <p className="text-xs font-medium text-violet-600">
            $0 collected on this ticket, but materials/labor/overhead still cost an estimated ${costBreakdown.totalCost.toFixed(2)}.
            This is expected for redemptions — flagged here so the comped cost stays visible rather than invisible.
          </p>
        </div>
      ) : null}

      {/* Revenue */}
      <div className="rounded-2xl border-2 bg-muted/5 p-4 space-y-2">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Receipt className="w-3 h-3 opacity-40" /> Revenue
        </p>
        {revenueLines.map((line, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span className="font-bold text-slate-700">{line.label}</span>
            <span className="font-black text-slate-900">${line.amount.toFixed(2)}</span>
          </div>
        ))}
        <div className="pt-2 border-t border-dashed flex justify-between">
          <span className="text-[10px] font-black uppercase text-muted-foreground">Total revenue</span>
          <span className="font-black text-sm text-slate-900">${totalRevenue.toFixed(2)}</span>
        </div>
      </div>

      {/* Cost */}
      <div className="rounded-2xl border-2 bg-muted/5 p-4 space-y-2">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Wrench className="w-3 h-3 opacity-40" /> Estimated cost
        </p>
        <div className="flex justify-between text-xs">
          <span className="font-bold text-slate-700 flex items-center gap-1.5"><Wrench className="w-3 h-3 opacity-30" /> Materials</span>
          <span className="font-black text-slate-900">${costBreakdown.totalMaterials.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="font-bold text-slate-700 flex items-center gap-1.5"><Award className="w-3 h-3 opacity-30" /> Labor</span>
          <span className="font-black text-slate-900">${costBreakdown.totalLabor.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="font-bold text-slate-700 flex items-center gap-1.5"><Clock className="w-3 h-3 opacity-30" /> Overhead recovery</span>
          <span className="font-black text-slate-900">${costBreakdown.totalOverhead.toFixed(2)}</span>
        </div>
        <div className="pt-2 border-t border-dashed flex justify-between">
          <span className="text-[10px] font-black uppercase text-muted-foreground">Total cost</span>
          <span className="font-black text-sm text-slate-900">${costBreakdown.totalCost.toFixed(2)}</span>
        </div>
      </div>

      {/* Margin verdict */}
      {tier && (
        <div className={cn('rounded-2xl border-2 p-4 flex items-center justify-between', tierStyles[tier].bg, tierStyles[tier].border)}>
          <div className="flex items-center gap-2">
            {React.createElement(tierStyles[tier].Icon, { className: cn('w-4 h-4', tierStyles[tier].text) })}
            <div>
              <p className={cn('text-[10px] font-black uppercase tracking-widest', tierStyles[tier].text)}>Net margin</p>
              <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                {tier === 'healthy' ? 'Healthy margin' : tier === 'thin' ? 'Thin margin' : 'Below cost'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className={cn('text-lg font-black tracking-tighter', tierStyles[tier].text)}>
              {margin >= 0 ? '+' : ''}${margin.toFixed(2)}
            </p>
            {marginPct !== null && (
              <p className={cn('text-[9px] font-bold uppercase opacity-70', tierStyles[tier].text)}>
                {(marginPct * 100).toFixed(0)}% margin
              </p>
            )}
          </div>
        </div>
      )}

      {/* Deposit reconciliation */}
      {hasDeposit && (
        <div className="rounded-2xl border-2 border-dashed bg-muted/5 p-4 space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Deposit reconciliation</p>
          <div className="flex justify-between text-xs">
            <span className="font-bold text-slate-700">Deposit collected</span>
            <span className="font-black text-slate-900">${depositAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="font-bold text-slate-700">Remaining due at checkout</span>
            <span className="font-black text-slate-900">${(remainingAfterDeposit ?? 0).toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
