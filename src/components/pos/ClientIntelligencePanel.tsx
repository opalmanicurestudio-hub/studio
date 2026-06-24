'use client';

/**
 * ClientIntelligencePanel
 *
 * Drop into QuickBookForm step 1 immediately after a client is selected.
 * Renders insights from useClientIntelligence with zero extra Firestore reads.
 *
 * Usage:
 *   import { ClientIntelligencePanel } from '@/components/pos/ClientIntelligencePanel';
 *   import { useClientIntelligence } from '@/hooks/useClientIntelligence';
 *
 *   const intel = useClientIntelligence(selectedClient, appointments, services);
 *   <ClientIntelligencePanel intel={intel} staff={staff} onActionClick={...} />
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { Clock, AlertTriangle, Gift, Package, Sparkles, Star, ChevronRight, Repeat2 } from 'lucide-react';
import type { ClientIntelligence, ClientInsight } from '@/hooks/useClientIntelligence';

type Props = {
  intel: ClientIntelligence;
  staff?: any[];
  /** Called when an insight action button is tapped. */
  onActionClick?: (insight: ClientInsight) => void;
  className?: string;
};

const INSIGHT_ICONS: Record<string, React.ReactNode> = {
  rebooking_due: <Repeat2 className="w-3.5 h-3.5" />,
  no_show_risk: <AlertTriangle className="w-3.5 h-3.5" />,
  birthday: <Gift className="w-3.5 h-3.5" />,
  package_expiring: <Package className="w-3.5 h-3.5" />,
  membership_perk: <Sparkles className="w-3.5 h-3.5" />,
  preferred_staff: <Star className="w-3.5 h-3.5" />,
  preferred_time: <Clock className="w-3.5 h-3.5" />,
};

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-primary/5 border-primary/15 text-primary',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
  success: 'bg-green-50 border-green-200 text-green-700',
};

const ICON_STYLES: Record<string, string> = {
  info: 'text-primary',
  warning: 'text-amber-500',
  success: 'text-green-500',
};

function InsightCard({
  insight,
  onActionClick,
}: {
  insight: ClientInsight;
  onActionClick?: (insight: ClientInsight) => void;
}) {
  const icon = INSIGHT_ICONS[insight.type] ?? <Clock className="w-3.5 h-3.5" />;
  const style = SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info;
  const iconStyle = ICON_STYLES[insight.severity] ?? ICON_STYLES.info;

  return (
    <div className={cn('rounded-xl border p-3 space-y-1.5', style)}>
      <div className="flex items-start gap-2">
        <div className={cn('mt-0.5 shrink-0', iconStyle)}>{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black uppercase tracking-wide leading-tight">
            {insight.title}
          </p>
          <p className="text-[10px] font-medium leading-relaxed mt-0.5 opacity-80">
            {insight.detail}
          </p>
        </div>
      </div>
      {insight.actionLabel && onActionClick && (
        <button
          onClick={() => onActionClick(insight)}
          className="text-[10px] font-black uppercase tracking-widest underline underline-offset-2 flex items-center gap-1 hover:opacity-70 transition-opacity"
        >
          {insight.actionLabel}
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export function ClientIntelligencePanel({ intel, staff, onActionClick, className }: Props) {
  if (!intel || intel.insights.length === 0) return null;

  // Resolve preferred staff name from the __staff:id chip format
  const resolvedChips = intel.preferenceChips.map((chip) => {
    if (chip.startsWith('__staff:')) {
      const staffId = chip.replace('__staff:', '');
      const member = (staff || []).find((s: any) => s.id === staffId);
      return member ? `Prefers ${member.name.split(' ')[0]}` : null;
    }
    return chip;
  }).filter(Boolean) as string[];

  return (
    <div className={cn('space-y-3', className)}>
      {/* Section label */}
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-1">
          Client intel
        </p>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Insights */}
      <div className="space-y-2">
        {intel.insights.map((insight) => (
          <InsightCard
            key={insight.type}
            insight={insight}
            onActionClick={onActionClick}
          />
        ))}
      </div>

      {/* Preference chips */}
      {resolvedChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {resolvedChips.map((chip) => (
            <span
              key={chip}
              className="px-2.5 py-1 rounded-full bg-muted/60 border text-[10px] font-bold text-muted-foreground uppercase tracking-wide"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      {/* Stats row */}
      {(intel.lifetimeVisits > 0 || intel.weeksSinceLastVisit !== null) && (
        <div className="flex items-center gap-4 px-1 pt-1">
          {intel.lifetimeVisits > 0 && (
            <div>
              <p className="text-[18px] font-black tracking-tighter text-slate-900 leading-none">
                {intel.lifetimeVisits}
              </p>
              <p className="text-[9px] font-bold text-muted-foreground uppercase">
                total visits
              </p>
            </div>
          )}
          {intel.weeksSinceLastVisit !== null && (
            <div>
              <p className="text-[18px] font-black tracking-tighter text-slate-900 leading-none">
                {intel.weeksSinceLastVisit}w
              </p>
              <p className="text-[9px] font-bold text-muted-foreground uppercase">
                since last visit
              </p>
            </div>
          )}
          {intel.lastServiceName && (
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-900 truncate">
                {intel.lastServiceName}
              </p>
              <p className="text-[9px] font-bold text-muted-foreground uppercase">
                last service
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
