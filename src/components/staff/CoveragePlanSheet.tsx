'use client';

import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, ArrowRightLeft, CalendarClock, Check, Loader, UserX } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { buildCoveragePlan, type CoverageOutcome } from '@/lib/coverage-plan';

const safe = (v: any): Date => (v instanceof Date ? v : new Date(v));

export function CoveragePlanSheet({
  open,
  onOpenChange,
  provider,
  date,
  appointments,
  services,
  staff,
  busyId,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider: any;
  date: Date;
  appointments: any[];
  services: any[];
  staff: any[];
  busyId?: string | null;
  onApply: (apt: any, outcome: CoverageOutcome, pick: { id: string; name: string } | null) => void | Promise<void>;
}) {
  const isMobile = useIsMobile();
  const [overrides, setOverrides] = useState<Record<string, { outcome: CoverageOutcome; pick: string | null }>>({});

  const plan = useMemo(() => {
    if (!provider) return null;
    return buildCoveragePlan({ staffId: provider.id, date, appointments, services, staff });
  }, [provider, date, appointments, services, staff]);

  if (!provider) return null;

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) setOverrides({});
  };

  const rowState = (aptId: string, suggested: CoverageOutcome, pick: string | null) =>
    overrides[aptId] || { outcome: suggested, pick };

  const set = (aptId: string, next: Partial<{ outcome: CoverageOutcome; pick: string | null }>, suggested: CoverageOutcome, pick: string | null) =>
    setOverrides(prev => ({ ...prev, [aptId]: { ...rowState(aptId, suggested, pick), ...next } }));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={cn(
        'border-2 shadow-2xl p-0 flex flex-col overflow-hidden gap-0',
        isMobile
          ? 'left-0 bottom-0 top-auto w-full max-w-none translate-x-0 translate-y-0 h-[92dvh] rounded-t-[2rem] rounded-b-none data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full'
          : 'sm:max-w-xl rounded-[2rem] h-[min(88dvh,48rem)]',
      )}>
        <DialogHeader className="shrink-0 space-y-1 border-b bg-muted/5 p-5 text-left">
          <DialogTitle className="text-[17px] font-black tracking-tight">
            {provider.name} can&apos;t work
          </DialogTitle>
          <DialogDescription className="text-[12px] font-bold text-muted-foreground">
            {format(date, 'EEEE d MMMM')} · {plan?.rows.length || 0} affected
          </DialogDescription>
          {plan && plan.rows.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-800">
                {plan.covered} can be covered
              </span>
              {plan.atRisk > 0 && (
                <span className="rounded-lg bg-destructive/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-destructive">
                  {plan.atRisk} at risk · ${Math.round(plan.valueAtRisk).toLocaleString()}
                </span>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3">
          {(!plan || plan.rows.length === 0) && (
            <p className="rounded-xl border-2 border-dashed px-4 py-6 text-center text-[12px] font-bold text-muted-foreground">
              Nothing on {provider.name.split(' ')[0]}&apos;s book for this day. No cover needed.
            </p>
          )}

          {plan?.rows.map(row => {
            const apt = row.appointment;
            const st = rowState(apt.id, row.suggested, row.pick);
            const handled = apt.coverageHandledAt || apt.reassignedAt;
            const picked = row.candidates.find(c => c.id === st.pick) || null;
            const busy = busyId === apt.id;

            return (
              <div
                key={apt.id}
                className={cn(
                  'rounded-r-xl border-2 border-l-[3px] p-3',
                  handled ? 'border-l-emerald-600 bg-muted/20 opacity-70'
                    : row.candidates.length === 0 ? 'border-l-destructive' : 'border-l-primary',
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 tabular-nums text-[12px] font-black tracking-tight">
                    {format(safe(apt.startTime), 'h:mm')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-black tracking-tight">
                    {apt.clientName || 'Guest'}
                  </span>
                  {handled && <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />}
                </div>
                <p className="mt-0.5 truncate text-[12px] font-bold text-muted-foreground">{row.serviceName}</p>

                {!handled && row.candidates.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.candidates.slice(0, 4).map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => set(apt.id, { outcome: 'reassign', pick: c.id }, row.suggested, row.pick)}
                        aria-pressed={st.pick === c.id && st.outcome === 'reassign'}
                        className={cn(
                          'rounded-lg border-2 px-2.5 py-1 text-[11px] font-black tracking-tight transition-colors',
                          st.pick === c.id && st.outcome === 'reassign'
                            ? 'border-primary bg-primary/[0.06] text-foreground'
                            : 'border-border bg-white text-muted-foreground',
                        )}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}

                {!handled && row.candidates.length === 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] font-bold leading-snug text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Nobody qualified is free. Moving it beats losing it.
                  </p>
                )}

                {!handled && (
                  <div className="mt-2.5 flex gap-1.5">
                    {row.candidates.length > 0 && (
                      <Button
                        size="xs" disabled={busy || !picked}
                        onClick={() => picked && onApply(apt, 'reassign', { id: picked.id, name: picked.name })}
                        className="h-8 flex-1 rounded-lg text-[10px] font-black uppercase tracking-widest"
                      >
                        {busy ? <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          : <><ArrowRightLeft className="mr-1.5 h-3 w-3" aria-hidden="true" />Move to {picked?.name.split(' ')[0] || '—'}</>}
                      </Button>
                    )}
                    <Button
                      variant="outline" size="xs" disabled={busy}
                      onClick={() => onApply(apt, 'move', null)}
                      className="h-8 flex-1 rounded-lg border-2 text-[10px] font-black uppercase tracking-widest"
                    >
                      <CalendarClock className="mr-1.5 h-3 w-3" aria-hidden="true" />New time
                    </Button>
                    <Button
                      variant="ghost" size="xs" disabled={busy}
                      aria-label={`Cancel ${apt.clientName || 'this booking'} — no cover available`}
                      onClick={() => onApply(apt, 'no_cover', null)}
                      className="h-8 shrink-0 rounded-lg px-2.5 text-[10px] font-black uppercase tracking-widest text-destructive"
                    >
                      <UserX className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
