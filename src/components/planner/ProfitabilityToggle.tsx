'use client';

// ─────────────────────────────────────────────────────────────────────────────
// components/planner/ProfitabilityToggle.tsx
//
// Small settings control for useProfitabilityVisibility. Drop this wherever
// makes sense as the control surface — candidates, in order of how natural
// they'd feel given what's in your codebase already:
//
//   1. Inside a settings/account menu, if one exists (I don't have that
//      file, so can't confirm placement there).
//   2. As a quick toggle directly in PlannerPageContent's header row,
//      next to the existing Bills/KPI icon buttons (role === 'owner' ||
//      role === 'admin' block) — this fits the existing pattern of small
//      icon-triggered controls in that exact spot.
//
// This component is intentionally just the control + label, no surrounding
// page chrome, so it can slot into either location without modification.
//
// Usage:
//   <ProfitabilityToggle />
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { TrendingUp } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useProfitabilityVisibility } from '@/hooks/useProfitabilityVisibility';
import { cn } from '@/lib/utils';

interface ProfitabilityToggleProps {
  className?: string;
  /** Compact renders just icon + switch, no description line — for tight header spots. */
  compact?: boolean;
}

export function ProfitabilityToggle({ className, compact = false }: ProfitabilityToggleProps) {
  const { showProfitability, setShowProfitability, isLoading } = useProfitabilityVisibility();

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2 p-2 rounded-xl border-2 bg-muted/5', className)}>
        <TrendingUp className={cn('w-3.5 h-3.5', showProfitability ? 'text-primary' : 'text-muted-foreground opacity-40')} />
        <Switch checked={showProfitability} onCheckedChange={setShowProfitability} disabled={isLoading} />
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-between p-4 rounded-2xl border-2 bg-muted/5 shadow-inner', className)}>
      <div className="space-y-0.5">
        <Label className="text-xs font-black uppercase tracking-tight flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-primary" /> Show profitability on cards
        </Label>
        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
          Margin signal visible only to you, on this and other devices
        </p>
      </div>
      <Switch checked={showProfitability} onCheckedChange={setShowProfitability} disabled={isLoading} />
    </div>
  );
}
