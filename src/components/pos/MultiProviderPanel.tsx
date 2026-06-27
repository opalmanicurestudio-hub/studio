'use client';

/**
 * MultiProviderPanel — sequential multi-provider legs for one client.
 *
 * Different from GroupBookingPanel: that's multiple GUESTS (separate client
 * identities) served concurrently at the same time slot. This is the SAME
 * client moving through multiple DIFFERENT services with different staff,
 * back-to-back (e.g. color with Stylist A, then a style with Stylist B).
 *
 * Leg 1 is whatever the parent form's existing service/staff/time fields
 * already hold — this panel only manages legs 2+. Each additional leg's
 * start time is COMPUTED (previous leg's end + that service's
 * processingGapMinutes), never picked by staff — see Service.processingGapMinutes.
 */

import React from 'react';
import { addMinutes, format } from 'date-fns';
import { Plus, Trash2, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getServicePrice } from '@/lib/data';
import { useSmartAvailability } from '@/hooks/useSmartAvailability';

export type ProviderLeg = {
  id: string;
  serviceId: string;
  staffId: string; // 'any' allowed, same convention as the primary leg
};

type Props = {
  legs: ProviderLeg[];
  onChange: (legs: ProviderLeg[]) => void;
  services: any[];
  staff: any[];
  /** Primary leg's resolved start/end — leg 2+ chain off this. */
  primaryStartTime: Date;
  primaryServiceId: string;
  date: string;
  allAppointments: any[];
};

/** A leg's price, using that leg's own staff for tiered pricing if set. */
function legPrice(leg: ProviderLeg, services: any[], staff: any[]): number {
  const svc = services.find((s: any) => s.id === leg.serviceId);
  const staffMember = staff.find((s: any) => s.id === leg.staffId);
  return svc ? getServicePrice(svc, staffMember) : 0;
}

/**
 * Computes each leg's derived start/end by chaining off the leg before it.
 * Leg 0 uses primaryStartTime/primaryServiceId (the parent form's existing
 * fields) as the anchor; legs 1..n chain off the previous leg's end + that
 * previous service's processingGapMinutes (defaults to 0 — back-to-back).
 */
export function computeLegSchedule(
  legs: ProviderLeg[],
  services: any[],
  primaryStartTime: Date,
  primaryServiceId: string,
) {
  const primarySvc = services.find((s: any) => s.id === primaryServiceId);
  const primaryDuration = primarySvc?.duration || 60;
  let cursor = addMinutes(primaryStartTime, primaryDuration);

  return legs.map((leg) => {
    const svc = services.find((s: any) => s.id === leg.serviceId);
    const duration = svc?.duration || 60;
    const start = cursor;
    const end = addMinutes(start, duration);
    // Next leg starts after THIS leg's gap, not the primary's.
    cursor = addMinutes(end, svc?.processingGapMinutes || 0);
    return { ...leg, startTime: start, endTime: end };
  });
}

export function isMultiProviderValid(legs: ProviderLeg[]): boolean {
  return legs.every((l) => !!l.serviceId && !!l.staffId);
}

/** One leg's availability check — reuses useSmartAvailability per-leg rather than a joint solver. */
function LegAvailabilityCheck({
  leg, startTime, services, staff, allAppointments, date,
}: {
  leg: ProviderLeg & { startTime: Date; endTime: Date };
  services: any[];
  staff: any[];
  allAppointments: any[];
  date: string;
}) {
  const { slots } = useSmartAvailability({
    date,
    serviceId: leg.serviceId,
    staffId: leg.staffId,
    allAppointments,
    allServices: services,
    allStaff: staff,
  });

  if (!leg.serviceId || !leg.staffId || leg.staffId === 'any') return null;

  const targetTimeStr = format(leg.startTime, 'HH:mm');
  const isAvailable = (slots || []).some((s: any) => s.time === targetTimeStr && (s.staffId === leg.staffId || !s.staffId));

  if (isAvailable) {
    return (
      <p className="text-[9px] font-bold text-green-600 uppercase flex items-center gap-1 mt-1">
        <CheckCircle2 className="w-3 h-3" /> Available at {format(leg.startTime, 'h:mm a')}
      </p>
    );
  }

  return (
    <p className="text-[9px] font-bold text-amber-600 uppercase flex items-center gap-1 mt-1">
      <AlertTriangle className="w-3 h-3" /> May be unavailable at {format(leg.startTime, 'h:mm a')} — double-check or pick a different provider
    </p>
  );
}

export function MultiProviderPanel({
  legs, onChange, services, staff, primaryStartTime, primaryServiceId, date, allAppointments,
}: Props) {
  const scheduledLegs = computeLegSchedule(legs, services, primaryStartTime, primaryServiceId);
  const activeStaff = staff.filter((s: any) => s.active);
  const serviceOptions = services.filter((s: any) => s.type === 'service');

  const updateLeg = (id: string, patch: Partial<ProviderLeg>) => {
    onChange(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const addLeg = () => {
    onChange([...legs, { id: `leg_${Date.now()}_${legs.length}`, serviceId: '', staffId: 'any' }]);
  };

  const removeLeg = (id: string) => {
    onChange(legs.filter((l) => l.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
          Additional providers · sequential
        </p>
      </div>

      {scheduledLegs.map((leg, idx) => {
        const svc = services.find((s: any) => s.id === leg.serviceId);
        return (
          <div key={leg.id} className="rounded-2xl border-2 border-border bg-white p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Then · {format(leg.startTime, 'h:mm a')}
              </p>
              <button onClick={() => removeLeg(leg.id)} className="text-destructive/60 hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={leg.serviceId}
                onChange={(e) => updateLeg(leg.id, { serviceId: e.target.value })}
                className="h-10 rounded-xl border-2 text-[11px] font-bold px-2 bg-white"
              >
                <option value="">Service…</option>
                {serviceOptions.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <select
                value={leg.staffId}
                onChange={(e) => updateLeg(leg.id, { staffId: e.target.value })}
                className="h-10 rounded-xl border-2 text-[11px] font-bold px-2 bg-white"
              >
                <option value="any">Any provider</option>
                {activeStaff.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {svc && (
              <div className="flex items-center justify-between text-[10px] text-muted-foreground font-bold">
                <span>{svc.duration}m</span>
                <span className="font-black text-slate-900">${legPrice(leg, services, staff).toFixed(2)}</span>
              </div>
            )}

            {leg.serviceId && leg.staffId && (
              <LegAvailabilityCheck
                leg={leg}
                services={services}
                staff={staff}
                allAppointments={allAppointments}
                date={date}
              />
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        onClick={addLeg}
        className="w-full h-11 rounded-xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest"
      >
        <Plus className="w-3.5 h-3.5 mr-1.5" /> Add another provider
      </Button>
    </div>
  );
}
