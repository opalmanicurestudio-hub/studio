'use client';

/**
 * useSmartAvailability — v2
 *
 * v2 — BUG FIX: the add-on upsell filter checked `s.type === 'service'` and
 * `s.isAddOn !== false`. Your Service type has no `isAddOn` field at all, so
 * that second check was always true (undefined !== false), and the first
 * check pulled from full primary SERVICES, not things actually flagged as
 * add-ons. The practical effect: a manicure's "upsells" could include an
 * unrelated Pedicure or Facial just because it happened to fit the time gap
 * — not because anyone marked it compatible. Now filters on
 * `type === 'addon'` AND membership in the selected service's
 * `compatibleAddOnIds`, the same field AppointmentDetailsSheet,
 * AddAndConfigurePartsDialog, and MultiProviderPanel already key off of —
 * so upsells here are finally drawn from the same compatibility model as
 * the rest of the app instead of an independent (and broken) one.
 *
 * v1 — Given a date, serviceId, and optional staffId, returns only the time
 * slots where the full service (duration + padBefore + padAfter) fits
 * without overlapping any existing confirmed appointment.
 *
 * Also returns eligible add-ons that fit within the selected slot's
 * remaining gap before the next appointment.
 *
 * No extra Firestore reads — uses appointments already in InventoryContext.
 *
 * FIX (carried forward): the slot dedup step below previously keyed by
 * `slot.time` alone. That's harmless when staffId is a single specific
 * provider (there's only ever one slot per time, so nothing collides) but
 * breaks "Any available": with multiple providers open at the same time,
 * only the one with the largest gapMinutesAfter survived — every other
 * provider's slot at that exact time was silently overwritten and
 * discarded. Keying by `${staffId}-${time}` instead means providers no
 * longer collide with each other, so SmartAvailabilityGrid (which already
 * keys its buttons by staffId+time) actually receives every provider's
 * slots, not just one.
 */

import { useMemo } from 'react';
import {
  addMinutes,
  areIntervalsOverlapping,
  format,
  parseISO,
  startOfDay,
  endOfDay,
  isAfter,
  isBefore,
  setHours,
  setMinutes,
} from 'date-fns';

export type AvailableSlot = {
  time: string;
  label: string;
  staffId: string;
  staffName: string;
  gapMinutesAfter: number;
  available: boolean;
};

export type AddOnUpsell = {
  serviceId: string;
  name: string;
  duration: number;
  price: number;
  fitsInGap: boolean;
};

const safeDate = (val: any): Date | null => {
  if (!val) return null;
  try {
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
    return new Date(val);
  } catch { return null; }
};

const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 20;
const SLOT_INTERVAL_MINUTES = 30;

export function useSmartAvailability(params: {
  date: string;
  serviceId: string;
  staffId: string | 'any';
  allAppointments: any[];
  allServices: any[];
  allStaff: any[];
  skipSlotsBefore?: string;
}): {
  slots: AvailableSlot[];
  addOnUpsells: AddOnUpsell[];
  selectedSlotGap: number;
} {
  const { date, serviceId, staffId, allAppointments, allServices, allStaff, skipSlotsBefore } = params;

  return useMemo(() => {
    const empty = { slots: [], addOnUpsells: [], selectedSlotGap: 0 };
    if (!date || !serviceId) return empty;

    const svc = allServices.find((s) => s.id === serviceId);
    if (!svc) return empty;

    const svcDuration: number = (svc.duration ?? 60) + (svc.padBefore ?? 0) + (svc.padAfter ?? 0);

    const candidateStaff =
      staffId === 'any'
        ? allStaff.filter((s) => s.active !== false)
        : allStaff.filter((s) => s.id === staffId);

    const dayStart = startOfDay(new Date(`${date}T00:00:00`));
    const dayEnd = endOfDay(dayStart);
    const dayApts = allAppointments.filter((a) => {
      const start = safeDate(a.startTime);
      if (!start) return false;
      if (!['confirmed', 'deposit_pending', 'servicing'].includes(a.status)) return false;
      return start >= dayStart && start <= dayEnd;
    });

    const minTimeStr = skipSlotsBefore ?? null;
    const slots: AvailableSlot[] = [];

    for (const staffMember of candidateStaff) {
      const staffApts = dayApts
        .filter((a) => a.staffId === staffMember.id)
        .map((a) => ({
          start: safeDate(a.startTime)!,
          end: safeDate(a.endTime) ?? addMinutes(safeDate(a.startTime)!, 60),
        }))
        .filter((a) => a.start != null)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      let cursor = setMinutes(setHours(dayStart, BUSINESS_START_HOUR), 0);
      const businessEnd = setMinutes(setHours(dayStart, BUSINESS_END_HOUR), 0);

      while (isBefore(cursor, businessEnd)) {
        const slotEnd = addMinutes(cursor, svcDuration);
        const timeStr = format(cursor, 'HH:mm');

        if (minTimeStr && timeStr < minTimeStr) {
          cursor = addMinutes(cursor, SLOT_INTERVAL_MINUTES);
          continue;
        }

        if (isAfter(slotEnd, businessEnd)) {
          cursor = addMinutes(cursor, SLOT_INTERVAL_MINUTES);
          continue;
        }

        const blocked = staffApts.some((a) =>
          areIntervalsOverlapping(
            { start: cursor, end: slotEnd },
            { start: a.start, end: a.end },
            { inclusive: false },
          ),
        );

        const nextApt = staffApts.find((a) => a.start >= slotEnd);
        const gapEnd = nextApt ? nextApt.start : businessEnd;
        const gapMinutesAfter = Math.max(
          0,
          Math.floor((gapEnd.getTime() - slotEnd.getTime()) / 60000),
        );

        slots.push({
          time: timeStr,
          label: format(cursor, 'h:mm a'),
          staffId: staffMember.id,
          staffName: staffMember.name ?? staffMember.id,
          gapMinutesAfter,
          available: !blocked,
        });

        cursor = addMinutes(cursor, SLOT_INTERVAL_MINUTES);
      }
    }

    // FIX: key by staff + time, not time alone — see file header comment.
    const slotMap = new Map<string, AvailableSlot>();
    for (const slot of slots) {
      const key = `${slot.staffId}-${slot.time}`;
      if (!slot.available) continue;
      const existing = slotMap.get(key);
      if (!existing || slot.gapMinutesAfter > existing.gapMinutesAfter) {
        slotMap.set(key, slot);
      }
    }

    const deduped = Array.from(slotMap.values()).sort((a, b) =>
      a.time.localeCompare(b.time),
    );

    const bestGap = deduped.at(0)?.gapMinutesAfter ?? 0;

    // v2 — FIX: draw upsells from the same compatibility model as the rest
    // of the app (type === 'addon' + the primary service's
    // compatibleAddOnIds) instead of the broken type/isAddOn check that let
    // any unrelated full-price service through as an "upsell."
    const compatibleAddOnIds: string[] = svc.compatibleAddOnIds || [];
    const addOnUpsells: AddOnUpsell[] = allServices
      .filter(
        (s) =>
          s.type === 'addon' &&
          compatibleAddOnIds.includes(s.id) &&
          (s.duration ?? 0) > 0,
      )
      .map((s) => ({
        serviceId: s.id,
        name: s.name,
        duration: s.duration,
        price: s.price ?? 0,
        fitsInGap: (s.duration + (s.padBefore ?? 0) + (s.padAfter ?? 0)) <= bestGap,
      }))
      .filter((a) => a.fitsInGap)
      .sort((a, b) => b.price - a.price)
      .slice(0, 4);

    return { slots: deduped, addOnUpsells, selectedSlotGap: bestGap };
  }, [date, serviceId, staffId, allAppointments, allServices, allStaff, skipSlotsBefore]);
}