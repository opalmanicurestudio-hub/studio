'use client';

// ─────────────────────────────────────────────────────────────────────────────
// AttentionStrip
//
// Generalized version of the "stuck appointments" banner already in
// PlannerPageContent. Same visual treatment (amber, horizontal scroll,
// click-through chips) — widened to accept any list of attention items,
// not just stuck appointments.
//
// This is additive, not a replacement: your existing `stuckAppointments`
// useMemo still computes the data. This component just renders a more
// general shape so other sources (e.g. unconfirmed completion links) can
// feed the same strip without a second banner competing for attention.
//
// Zero new Firestore reads required for the stuck-appointment case — it's
// the same data you already compute. The completion-link case (commented
// example below) WOULD require a new query against `bookingCompletions`
// filtered by status == 'pending' and createdAt older than some threshold.
// That's a real, small new read — flagging it explicitly rather than
// burying it, per the cost conversation. It's one additional collection
// query, not a recurring cost concern, but it is a new thing, not a
// re-display of existing data like everything else in this build.
//
// Usage in PlannerPageContent, replacing the inline stuck-appointments JSX:
//
//   const attentionItems: AttentionItem[] = [
//     ...stuckAppointments.map(apt => ({
//       id: apt.id,
//       label: apt.clientName || 'Guest',
//       sublabel: `${services?.find(s => s.id === apt.serviceId)?.name || 'Service'} · ${format(safeDate(apt.startTime), 'MMM d, h:mm a')}`,
//       kind: apt.status === 'servicing' ? 'in_service' as const : 'ready_for_checkout' as const,
//       onClick: () => { setSelectedAppointment(apt); setIsDetailsOpen(true); },
//     })),
//     // optional, only if you build the bookingCompletions query described above:
//     // ...staleCompletionLinks.map(link => ({
//     //   id: link.token,
//     //   label: link.clientName,
//     //   sublabel: 'deposit link unopened',
//     //   kind: 'link_pending' as const,
//     //   onClick: () => { /* surface link or resend */ },
//     // })),
//   ];
//
//   <AttentionStrip items={attentionItems} />
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AttentionKind = 'in_service' | 'ready_for_checkout' | 'link_pending' | 'late' | 'generic';

export interface AttentionItem {
  id: string;
  label: string;
  sublabel: string;
  kind: AttentionKind;
  onClick: () => void;
}

const kindDot: Record<AttentionKind, string> = {
  in_service: 'bg-primary',
  ready_for_checkout: 'bg-emerald-500',
  link_pending: 'bg-amber-500',
  late: 'bg-amber-500',
  generic: 'bg-slate-400',
};

const kindBadge: Record<AttentionKind, { label: string; className: string }> = {
  in_service: { label: 'In service', className: 'bg-primary/10 text-primary' },
  ready_for_checkout: { label: 'Checkout', className: 'bg-emerald-100 text-emerald-700' },
  link_pending: { label: 'Link unopened', className: 'bg-amber-100 text-amber-700' },
  late: { label: 'Running late', className: 'bg-amber-100 text-amber-700' },
  generic: { label: 'Review', className: 'bg-slate-100 text-slate-600' },
};

interface AttentionStripProps {
  items: AttentionItem[];
  className?: string;
}

export function AttentionStrip({ items, className }: AttentionStripProps) {
  if (items.length === 0) return null;

  return (
    <div className={cn('px-4 py-2 bg-amber-50 border-b-2 border-amber-200', className)}>
      <div className="max-w-7xl mx-auto space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-2">
          <AlertTriangle className="w-3 h-3" />
          {items.length} need{items.length === 1 ? 's' : ''} attention
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {items.map((item) => {
            const dotClass = kindDot[item.kind];
            const pulse = item.kind === 'in_service';
            const badge = kindBadge[item.kind];
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border-2 border-amber-300 shrink-0 hover:bg-amber-50 transition-all active:scale-95"
              >
                <div className={cn('w-2 h-2 rounded-full shrink-0', dotClass, pulse && 'animate-pulse')} />
                <div className="text-left">
                  <p className="font-black uppercase text-[10px] text-slate-800">{item.label}</p>
                  <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{item.sublabel}</p>
                </div>
                <span className={cn('font-black text-[8px] uppercase border-none shrink-0 rounded-full px-1.5 py-0.5', badge.className)}>
                  {badge.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
