'use client'
/**
 * useSmartAvailability

 *
 * Given a date, serviceId, and optional staffId, returns only the time
 * slots where the full service (duration + padBefore + padAfter) fits
 * without overlapping any existing confirmed appointment.
 *
 * Also returns eligible add-ons that fit within the selected slot's
 * remaining gap before the next appointment.
 *
 * No extra Firestore reads — uses appointments already in InventoryContext.
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
  time: string;          // 'HH:mm'
  label: string;         // '10:00 am'
  staffId: string;
  staffName: string;
  gapMinutesAfter: number; // minutes until next appt / end of day
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
  date: string;                // 'yyyy-MM-dd'
  serviceId: string;
  staffId: string | 'any';
  allAppointments: any[];
  allServices: any[];
  allStaff: any[];
  skipSlotsBefore?: string;    // 'HH:mm' — for today, skip past slots
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

    // Which staff members are candidates?
    const candidateStaff =
      staffId === 'any'
        ? allStaff.filter((s) => s.active !== false)
        : allStaff.filter((s) => s.id === staffId);

    // Appointments on this date (only confirmed/deposit_pending block slots)
    const dayStart = startOfDay(new Date(`${date}T00:00:00`));
    const dayEnd = endOfDay(dayStart);
    const dayApts = allAppointments.filter((a) => {
      const start = safeDate(a.startTime);
      if (!start) return false;
      if (!['confirmed', 'deposit_pending', 'servicing'].includes(a.status)) return false;
      return start >= dayStart && start <= dayEnd;
    });

    // Skip slots before a minimum time (e.g. now + buffer for today)
    const minTimeStr = skipSlotsBefore ?? null;

    // Generate slots for each candidate staff member
    const slots: AvailableSlot[] = [];

    for (const staffMember of candidateStaff) {
      // Appointments for this staff on this day
      const staffApts = dayApts
        .filter((a) => a.staffId === staffMember.id)
        .map((a) => ({
          start: safeDate(a.startTime)!,
          end: safeDate(a.endTime) ?? addMinutes(safeDate(a.startTime)!, 60),
        }))
        .filter((a) => a.start != null)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      // Walk every 30-min slot through the business day
      let cursor = setMinutes(setHours(dayStart, BUSINESS_START_HOUR), 0);
      const businessEnd = setMinutes(setHours(dayStart, BUSINESS_END_HOUR), 0);

      while (isBefore(cursor, businessEnd)) {
        const slotEnd = addMinutes(cursor, svcDuration);
        const timeStr = format(cursor, 'HH:mm');

        // Skip past slots when a minimum time is set
        if (minTimeStr && timeStr < minTimeStr) {
          cursor = addMinutes(cursor, SLOT_INTERVAL_MINUTES);
          continue;
        }

        // Service must end before business hours end
        if (isAfter(slotEnd, businessEnd)) {
          cursor = addMinutes(cursor, SLOT_INTERVAL_MINUTES);
          continue;
        }

        // Check for overlaps with existing appointments
        const blocked = staffApts.some((a) =>
          areIntervalsOverlapping(
            { start: cursor, end: slotEnd },
            { start: a.start, end: a.end },
            { inclusive: false },
          ),
        );

        // Compute gap until next appointment or business end
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

    // Deduplicate: if multiple staff are free at the same time, keep the
    // one with the most gap (widest window) — receptionist can refine later.
    const slotMap = new Map<string, AvailableSlot>();
    for (const slot of slots) {
      const key = slot.time;
      if (!slot.available) continue;
      const existing = slotMap.get(key);
      if (!existing || slot.gapMinutesAfter > existing.gapMinutesAfter) {
        slotMap.set(key, slot);
      }
    }

    const deduped = Array.from(slotMap.values()).sort((a, b) =>
      a.time.localeCompare(b.time),
    );

    // Add-on upsells — services that fit in the best available gap
    const bestGap = deduped.at(0)?.gapMinutesAfter ?? 0;
    const addOnUpsells: AddOnUpsell[] = allServices
      .filter(
        (s) =>
          s.id !== serviceId &&
          s.type === 'service' &&
          s.isAddOn !== false &&
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
