'use client';

/**
 * useSmartAvailability — v3
 * ─────────────────────────────────────────────────────────────────────────────
 * This hook no longer contains an availability engine. It is now a thin React
 * wrapper over `src/lib/availability.ts`, which is the single source of truth
 * for "can this be booked?" across the whole app — the public booking sheet,
 * the front-desk QuickBook form, and the server-side booking route.
 *
 * WHY THIS CHANGED
 *
 * v2 of this hook had its own scan loop with these constants baked in:
 *
 *     BUSINESS_START_HOUR   = 8
 *     BUSINESS_END_HOUR     = 20
 *     SLOT_INTERVAL_MINUTES = 30
 *
 * It read no working hours, no schedule profiles, and no blocked events. So the
 * front desk was offered 8:00 AM slots on days the studio opens at 10, and
 * slots on days the studio is closed entirely. It also used a three-status
 * whitelist (`confirmed`, `deposit_pending`, `servicing`) to decide what counts
 * as busy, which meant any appointment in some other state — checked in, no
 * show, rescheduled, completed — was invisible and its time got double-booked.
 *
 * The engine fixes all of that, and because the same functions run in the API
 * route, the front desk can no longer offer a time the server will reject.
 *
 * WHAT DID NOT CHANGE — ON PURPOSE
 *
 * The parameter names, the return shape, and the two exported types are byte
 * for byte what they were. `QuickBookForm`, `MultiProviderPanel`, and
 * `SmartAvailabilityGrid` compile and behave without a single edit. Every new
 * capability is an OPTIONAL parameter, so nothing breaks by omission — it just
 * stays as approximate as it was until the extra data is passed in.
 *
 * TO GET FULL CORRECTNESS AT A CALL SITE, add three props:
 *
 *     events:           events,            // blocked time, classes, closures
 *     scheduleProfiles: scheduleProfiles,  // the studio's real open hours
 *     tenant:           tenant,            // slot interval + smart toggles
 *
 * Without `scheduleProfiles`, per-staff hours are still honored; only staff
 * with no schedule of their own fall back to a window. Without `events`,
 * blocked time is invisible. Without `tenant`, tight scheduling / morning
 * anchor / flash yield stay off and the slot interval falls back to config
 * defaults.
 *
 * FALLBACK WINDOW: when a staff member has no schedule AND no profile exists,
 * this hook falls back to 8:00 AM – 8:00 PM, matching v2 exactly. That keeps
 * an unconfigured studio working the way it does today instead of showing an
 * empty grid the day this file lands.
 */

import { useMemo } from 'react';
import {
  computeAvailability,
  type Slot,
  type AddOnUpsell as EngineAddOnUpsell,
} from '@/lib/availability';

/**
 * Unchanged public type. The engine's Slot is a superset — it adds `isHotSlot`
 * and an optional `reason` — so existing consumers keep type-checking, and new
 * ones can read the extra fields.
 */
export type AvailableSlot = Slot;

/** Unchanged public type: { serviceId, name, duration, price, fitsInGap }. */
export type AddOnUpsell = EngineAddOnUpsell;

/** Matches v2's hardcoded business day, used only when nothing is configured. */
const LEGACY_FALLBACK_HOURS = { start: '08:00', end: '20:00' };

export type SmartAvailabilityParams = {
  /** 'yyyy-MM-dd' */
  date: string;
  serviceId: string;
  /** A specific staff id, or 'any'. */
  staffId: string | 'any';
  allAppointments: any[];
  allServices: any[];
  allStaff: any[];
  /** 'HH:mm' floor — nothing earlier is offered. */
  skipSlotsBefore?: string;

  // ── Optional. Each one makes the answer more correct. ──────────────────────
  /** Blocked time / closures / classes. Without this they are invisible. */
  events?: any[];
  /** The studio's schedule profiles — the real open hours. */
  scheduleProfiles?: any[];
  /** Tenant doc: bookingSlotInterval, tightSchedulingEnabled, morningAnchorEnabled, flashYieldEnabled. */
  tenant?: any;
  /** Add-ons already chosen — extends the length the slot has to fit. */
  addOnIds?: string[];
  /** Pricing tier filter when staffId is 'any'. */
  tierId?: string;
  /** Force a grid step. Pass 30 to reproduce v2's spacing exactly. */
  slotIntervalMinutes?: number;
  /** Bypass tight-scheduling and morning-anchor rules (front desk override). */
  ignoreHeuristics?: boolean;
  /** Injectable clock — tests only. */
  now?: Date;
};

export type SmartAvailabilityResult = {
  /** Bookable slots only, earliest first. Unchanged contract. */
  slots: AvailableSlot[];
  addOnUpsells: AddOnUpsell[];
  /** Largest free gap after any bookable slot, in minutes. Unchanged contract. */
  selectedSlotGap: number;

  // ── Additive. Ignore these and nothing changes. ────────────────────────────
  /** Every slot scanned, including unavailable ones with a `reason`. */
  allSlots: AvailableSlot[];
  /** Distinct bookable times, sorted — for a one-button-per-time grid. */
  times: string[];
  /** time -> every staff member free at that time. Powers "Any available". */
  byTime: Record<string, AvailableSlot[]>;
  /** Times reopened by a recent cancellation, when flash yield is on. */
  hotTimes: string[];
  /** Data problems worth showing the owner, e.g. missing hours. */
  warnings: string[];
};

const EMPTY: SmartAvailabilityResult = {
  slots: [],
  addOnUpsells: [],
  selectedSlotGap: 0,
  allSlots: [],
  times: [],
  byTime: {},
  hotTimes: [],
  warnings: [],
};

export function useSmartAvailability(
  params: SmartAvailabilityParams,
): SmartAvailabilityResult {
  const {
    date,
    serviceId,
    staffId,
    allAppointments,
    allServices,
    allStaff,
    skipSlotsBefore,
    events,
    scheduleProfiles,
    tenant,
    addOnIds,
    tierId,
    slotIntervalMinutes,
    ignoreHeuristics,
    now,
  } = params;

  // `addOnIds` is usually a fresh array each render; key the memo on its
  // contents so we recompute when the selection actually changes, not on
  // every keystroke elsewhere in the form.
  const addOnKey = (addOnIds || []).join(',');

  return useMemo(() => {
    if (!date || !serviceId) return EMPTY;

    try {
      const result = computeAvailability({
        date,
        serviceId,
        staffId,
        tierId,
        addOnIds,
        services: allServices || [],
        staff: allStaff || [],
        appointments: allAppointments || [],
        events: events || [],
        scheduleProfiles: scheduleProfiles || [],
        tenant,
        now,
        skipSlotsBefore,
        slotIntervalMinutes,
        ignoreHeuristics,
        fallbackHours: LEGACY_FALLBACK_HOURS,
        includeUnavailable: true,
      });

      return {
        slots: result.slots,
        addOnUpsells: result.addOnUpsells,
        selectedSlotGap: result.bestGapMinutes,
        allSlots: result.allSlots,
        times: result.times,
        byTime: result.byTime,
        hotTimes: result.hotTimes,
        warnings: result.warnings,
      };
    } catch (err) {
      // A malformed appointment or service doc must never white-screen the
      // front desk mid-checkout. Degrade to "no slots" and say why in the
      // console rather than throwing through React.
      console.error('[useSmartAvailability] availability scan failed', err);
      return {
        ...EMPTY,
        warnings: ['Availability could not be calculated. Please refresh and try again.'],
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    date,
    serviceId,
    staffId,
    tierId,
    addOnKey,
    allServices,
    allStaff,
    allAppointments,
    events,
    scheduleProfiles,
    tenant,
    skipSlotsBefore,
    slotIntervalMinutes,
    ignoreHeuristics,
    now,
  ]);
}

export default useSmartAvailability;
