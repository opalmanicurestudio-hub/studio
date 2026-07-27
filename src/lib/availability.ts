// src/lib/availability.ts
//
// THE SHARED AVAILABILITY ENGINE — one source of truth for "when can this be booked".
//
// ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
// Before this, four different pieces of code answered that question, and they
// disagreed with each other:
//
//   1. BookingSheet.tsx (public booking)  — the most complete one. Read schedule
//      profiles, per-staff working hours, per-appointment padding, blocked
//      events, tight scheduling, morning anchor, and flash-yield hot slots.
//      But it threw away WHICH staff member each slot belonged to (it built a
//      flat Set<string> of times), then re-derived the staff at confirm time
//      using a DIFFERENT and unpadded filter — so a guest could be shown a
//      valid slot and then assigned to someone whose buffer it violated.
//   2. useSmartAvailability.ts (front desk QuickBook, MultiProviderPanel) —
//      hardcoded 8am-8pm in 30-minute steps. Read no working hours, no
//      schedule profile, and no blocked events at all. Your own front desk was
//      being offered slots on days you are closed.
//   3. AddAppointmentDialog.tsx — a third inline generator, similar to #1 but
//      also discarding staff attribution.
//   4. /api/appointments/book — the server-side check that actually REJECTS a
//      booking, and the only one that applied padding the same way every time.
//
// The practical failure that caused: the page offers a slot, the guest fills
// out the whole form, and the server rejects it with a 409. This module ends
// that by being the one implementation all of them call.
//
// ─── DESIGN RULES ────────────────────────────────────────────────────────────
// • PURE. No React, no Firestore, no fetch, no `window`. Every input is passed
//   in as plain data, so this runs identically in a client component and in a
//   server route. That is the whole point — the client can no longer offer a
//   slot the server will refuse.
// • INJECTABLE CLOCK. Pass `now` to make results deterministic and testable.
//   Never reads the clock implicitly except as a default.
// • TOLERANT INPUTS. Dates may be ISO strings, Date objects, or Firestore
//   Timestamps. Working hours may be '9:00 AM' or '09:00'. Blocked events may
//   use `staffId` or `staffIds`. Real data in this app is all three shapes.
// • NO SILENT MISCONFIGURATION. When schedule data is missing, the result
//   carries a `warnings` array saying so, instead of quietly inventing hours.
//
// ─── ONE CONVENTION THAT CHANGED, ON PURPOSE ─────────────────────────────────
// A slot time is when THE CLIENT'S SERVICE STARTS — not when the padded block
// starts. BookingSheet previously folded padBefore into the slot length, which
// meant its stored startTime and the server's padding math were offset from
// each other by padBefore. Here:
//
//     service window   = [start, start + duration + addOnDurations]
//     protected window = [start - padBefore, serviceEnd + padAfter]
//
// The SERVICE window must fit inside working hours; the PROTECTED window must
// not collide with another appointment. So a 9:00 open with 10 minutes of
// padBefore still offers a 9:00 slot (setup happens before the doors open),
// but two appointments can never eat into each other's buffer. This matches
// what /api/appointments/book already enforces, which is the behavior that
// counts, because that route is what says no.
//
// ─── EVERY REASON A TIME CAN BE UNAVAILABLE (v2) ─────────────────────────────
// This app stores "not bookable" in eight different places. v1 of this file
// read three of them. All eight are now handled, in this order of authority:
//
//   1. SHIFT (tenants/{t}/shifts) — the published roster for one date, with its
//      own startTime/endTime clock strings. Most authoritative: a manager who
//      publishes a 12-8 shift has overridden the weekly template. If NOBODY has
//      a shift on that date, the roster simply isn't published yet, so shifts
//      are ignored entirely rather than blanking the day. That fallback matters
//      — without it, turning this on would empty every future date at once.
//   2. APPROVED DAY OFF (shiftDayOffBlocks) — whole day gone. Pending requests
//      do NOT block, because a request nobody has answered should not quietly
//      cost you bookings.
//   3. PER-STAFF WEEKLY HOURS (staff.availability.week[day]) — the template. A
//      day explicitly disabled means off; a day absent falls through.
//   4. STUDIO SCHEDULE PROFILE (scheduleProfiles, isActive) — the house hours.
//   5. APPOINTMENTS — padded on both sides. Everything blocks except
//      cancellations and payment holds older than 30 minutes.
//   6. CALENDAR EVENTS (events) — 'blocked', 'personal' AND 'business' all
//      occupy the person. v1 only honored 'blocked', so a staff meeting on the
//      calendar was invisible to booking. allDay events take the whole day.
//   7. STAFF BLOCKS (staffBlocks) — duration-based holds written when an add-on
//      is handed to another tech. The code that writes them says they exist "so
//      the tech's slot is protected in the booking system"; until now nothing
//      read them, so they protected nothing.
//   8. RESOURCE CAPACITY (resources + requiredResourceIds) — a studio-wide
//      constraint, not a per-person one. Two techs are free but there is one
//      pedicure chair, so only one of them is actually bookable. Downtime is
//      derived from open urgent/high tickets and from maintenancePlans whose
//      nextRunAt is this date — the SAME rule planner-page uses, so the planner
//      and the booking grid can never disagree about what is out of service.
//
// Plus two throttles that exist to protect the day rather than describe it:
// booking lead time (no online bookings inside the next N minutes) and booking
// horizon (nothing further out than N days).
//
// Everything in that list is OPTIONAL input. Pass nothing and you get v1
// behavior; pass a collection and that constraint switches on. Nothing here
// invents a restriction from missing data — the only thing missing data
// produces is a warning.

import {
  addMinutes,
  areIntervalsOverlapping,
  differenceInMinutes,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  subMinutes,
} from 'date-fns';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Slot = {
  /** 'HH:mm' — 24-hour, sortable as a string. When the service starts. */
  time: string;
  /** Display form, e.g. '2:30 PM'. */
  label: string;
  staffId: string;
  staffName: string;
  /** Free minutes between this booking's protected end and the next thing. */
  gapMinutesAfter: number;
  available: boolean;
  /** True when a recent cancellation freed this exact slot (flash yield). */
  isHotSlot: boolean;
  /** Why an unavailable slot was rejected. Debugging aid; never shown to guests. */
  reason?: string;
};

export type AddOnUpsell = {
  serviceId: string;
  name: string;
  duration: number;
  price: number;
  fitsInGap: boolean;
};

export type AvailabilityInput = {
  /** 'yyyy-MM-dd' or a Date. */
  date: string | Date;
  serviceId: string;
  /** A staff id, or 'any'. Defaults to 'any'. */
  staffId?: string;
  /** A pricing tier id, or 'any'. Only narrows when staffId is 'any'. */
  tierId?: string;
  /** Add-ons already chosen — they lengthen the booking, so they change fit. */
  addOnIds?: string[];

  services: any[];
  staff: any[];
  appointments: any[];
  events?: any[];
  scheduleProfiles?: any[];
  tenant?: any;

  // ── Additional blocking sources. Each is optional; omit one and that
  //    constraint is simply not applied. ──────────────────────────────────────
  /** tenants/{t}/shifts — the published roster. { staffId, date, startTime, endTime, status } */
  shifts?: any[];
  /** tenants/{t}/staffBlocks — { staffId, startTime, duration } holds. */
  staffBlocks?: any[];
  /** tenants/{t}/shiftDayOffBlocks — { staffId, date, status }. Only 'approved' blocks. */
  dayOffBlocks?: any[];
  /** tenants/{t}/resources — { id, name, capacity, isOutOfService }. */
  resources?: any[];
  /** tenants/{t}/tickets — open ones at urgent/high priority take a resource down. */
  tickets?: any[];
  /** tenants/{t}/maintenancePlans — a plan whose nextRunAt is this date takes a resource down. */
  maintenancePlans?: any[];

  /** Injectable clock. Defaults to new Date(). */
  now?: Date;
  /** 'HH:mm' — hide anything earlier (used for "today, after now"). */
  skipSlotsBefore?: string;
  /** Overrides the tenant/profile booking interval. */
  slotIntervalMinutes?: number;
  /** Used only when neither the staff member nor the profile defines hours. */
  fallbackHours?: { start: string; end: string };
  /** Front-desk override: ignore tight-scheduling and morning-anchor limits. */
  ignoreHeuristics?: boolean;
  /** Include rejected slots in `allSlots` with a reason. Default true. */
  includeUnavailable?: boolean;

  // ── Policy switches. ──────────────────────────────────────────────────────
  /**
   * Minutes of notice required before a booking may start. Public pages should
   * pass this; the front desk should not, because a receptionist booking
   * someone standing in front of them must be able to say "right now".
   * Falls back to tenant.bookingLeadMinutes / tenant.bookingLeadHours.
   */
  minLeadMinutes?: number;
  /** Refuse dates further out than this. Falls back to tenant.bookingHorizonDays. */
  maxHorizonDays?: number;
  /**
   * Ignore the shift roster entirely. The front desk needs this to book a tech
   * onto a day they are not rostered for — which is a normal thing to do.
   */
  ignoreShifts?: boolean;
  /** Treat a PENDING day-off request as blocking too. Default false. */
  blockPendingDayOff?: boolean;
  /** Only offer staff with acceptingWalkIns !== false. For the walk-in queue. */
  requireAcceptingWalkIns?: boolean;
  /**
   * Event types that occupy a staff member. Default: blocked, personal,
   * business, time_off (and spelling variants). Pass a narrower list to let,
   * say, 'business' events sit alongside bookings.
   */
  blockingEventTypes?: string[];
  /** Skip the resource-capacity check even when resources are supplied. */
  ignoreResources?: boolean;
};

export type AvailabilityResult = {
  /** Bookable slots, sorted by time then staff name. */
  slots: Slot[];
  /** Every candidate considered, including rejects (see `reason`). */
  allSlots: Slot[];
  /** Distinct bookable times, sorted. */
  times: string[];
  /** time -> the staff members bookable at that time. */
  byTime: Record<string, Slot[]>;
  hotTimes: string[];
  addOnUpsells: AddOnUpsell[];
  /** Largest trailing gap across bookable slots — drives upsell fit. */
  bestGapMinutes: number;
  /** Misconfiguration surfaced rather than hidden. */
  warnings: string[];
};

type Window = { start: Date; end: Date };

type StaffDay = {
  staff: any;
  open: Date;
  close: Date;
  /** Already expanded by each existing appointment's own padding. */
  busy: Window[];
  /** Start times freed by a recent cancellation. */
  hot: Date[];
  /** Count of that day's appointments — the fair-rotation tiebreak. */
  load: number;
};

/**
 * A studio-wide constraint: how many of one physical thing exist, and when
 * each unit is already spoken for. Unlike everything else in a StaffDay, this
 * is shared — two techs competing for the same pedicure chair.
 */
type ResourceLedger = {
  resourceId: string;
  name: string;
  /** Units available today, after out-of-service and maintenance. */
  capacity: number;
  /** Padded windows already consuming a unit, one entry per consuming booking. */
  taken: Window[];
  /** Set when capacity hit zero, so the reason can name the cause. */
  downReason?: string;
};

type DayContext = {
  dateObj: Date;
  dayName: string;
  now: Date;
  interval: number;
  service: any;
  serviceMinutes: number;
  padBefore: number;
  padAfter: number;
  staffDays: StaffDay[];
  byId: Record<string, StaffDay>;
  tightScheduling: boolean;
  morningAnchor: boolean;
  /** Ledgers for the resources THIS service needs. Empty when it needs none. */
  resourceLedgers: ResourceLedger[];
  /** Earliest permissible service start, from lead time and the clock. */
  earliest: Date | null;
  /** True when the whole day is refused (past horizon, closed, etc). */
  closed: boolean;
  warnings: string[];
};

// ─── Constants ───────────────────────────────────────────────────────────────

/** Matches PENDING_HOLD_MS in /api/appointments/book. Keep them equal. */
const PENDING_HOLD_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL = 15;
const DEFAULT_FALLBACK_HOURS = { start: '09:00', end: '17:00' };
/** How recent a cancellation has to be to mark its slot "hot". */
const FLASH_YIELD_HOURS = 48;
/** Steps and ceiling for staggered party search. */
export const STAGGER_STEP_MIN = 15;
export const STAGGER_MAX_MIN = 240;

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Accepts ISO strings, Dates, Firestore Timestamps, and epoch numbers. */
export function safeDate(val: any): Date | null {
  if (val === null || val === undefined || val === '') return null;
  try {
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val === 'string') {
      const d = parseISO(val);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate();
    if (typeof val === 'object' && typeof val.seconds === 'number') return new Date(val.seconds * 1000);
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Parses a clock string onto a date. Handles '9:00 AM', '09:00 PM', '17:30',
 * and '9' — all of which appear in real schedule data in this app.
 */
export function parseClock(timeStr: any, onDate: Date): Date | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const raw = timeStr.trim().toUpperCase();
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const period = m[3];
  if (isNaN(hours) || isNaN(minutes) || hours > 23 || minutes > 59) return null;
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  const d = startOfDay(onDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export const toHHmm = (d: Date): string => format(d, 'HH:mm');
export const toLabel = (d: Date): string => format(d, 'h:mm a');

const asDate = (date: string | Date): Date =>
  date instanceof Date ? date : new Date(`${date}T00:00:00`);

const num = (v: any, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? fallback : n;
};

const overlaps = (a: Window, b: Window): boolean =>
  areIntervalsOverlapping(a, b, { inclusive: false });

// ─── Service maths ───────────────────────────────────────────────────────────

/** Duration of the service plus any add-ons, in minutes. Excludes padding. */
export function totalServiceMinutes(service: any, addOns: any[] = []): number {
  const base = num(service?.duration, 60) || 60;
  const extra = addOns.reduce((sum, a) => sum + num(a?.duration, 0), 0);
  return base + extra;
}

/**
 * The window that must be free of other appointments — the service plus its
 * buffers. See the convention note at the top of this file.
 */
export function protectedWindow(
  start: Date,
  serviceMinutes: number,
  padBefore: number,
  padAfter: number,
): Window {
  return {
    start: subMinutes(start, padBefore),
    end: addMinutes(start, serviceMinutes + padAfter),
  };
}

// ─── Schedule resolution ─────────────────────────────────────────────────────

/**
 * Working hours for one staff member on one day.
 *
 * Precedence, carried over from BookingSheet so behavior does not change:
 *   staff has an ENABLED day       -> use it
 *   staff has a DISABLED day       -> that person is off; no slots
 *   staff has no entry for the day -> fall back to the studio's active profile
 *   profile day disabled/missing   -> no slots
 */
export function resolveDayHours(
  staffMember: any,
  dayName: string,
  profile: any,
): { start: string; end: string } | null {
  const staffDay = staffMember?.availability?.week?.[dayName];
  if (staffDay) {
    if (!staffDay.enabled) return null;
    if (staffDay.start && staffDay.end) return { start: staffDay.start, end: staffDay.end };
  }
  const profileDay = profile?.week?.[dayName];
  if (profileDay && profileDay.enabled && profileDay.start && profileDay.end) {
    return { start: profileDay.start, end: profileDay.end };
  }
  return null;
}

/**
 * The roster entry for one person on one date, or null.
 *
 * Shape comes from how StaffPortalPage reads it:
 *   { staffId, date: 'yyyy-MM-dd', startTime: 'HH:mm', endTime: 'HH:mm', status }
 * Draft and cancelled shifts are not a commitment, so they do not count —
 * matching the filter QuickBookForm's resolveAnyStaffId already used.
 */
export function findShift(shifts: any[], staffId: string, dateStr: string): any | null {
  return (
    (shifts || []).find(
      (s) =>
        s?.staffId === staffId &&
        String(s?.date || '').slice(0, 10) === dateStr &&
        s?.status !== 'cancelled' &&
        s?.status !== 'draft' &&
        s?.status !== 'denied',
    ) || null
  );
}

/** Is the roster published for this date at all? Governs the shift fallback. */
export function rosterPublished(shifts: any[], dateStr: string): boolean {
  return (shifts || []).some(
    (s) =>
      String(s?.date || '').slice(0, 10) === dateStr &&
      s?.status !== 'cancelled' &&
      s?.status !== 'draft' &&
      s?.status !== 'denied',
  );
}

/**
 * Whole-day absence from an approved day-off request.
 *
 * Note for the owner: nothing in the app currently sets these to 'approved' —
 * StaffPortalPage writes them at status 'pending' and the approval path never
 * comes back to update them. So today this returns false for everything, which
 * is the safe direction. Wire the approval to set status:'approved' and this
 * starts working with no change here.
 */
export function hasApprovedDayOff(
  blocks: any[],
  staffId: string,
  dateStr: string,
  includePending = false,
): boolean {
  return (blocks || []).some((b) => {
    if (b?.staffId !== staffId) return false;
    if (String(b?.date || '').slice(0, 10) !== dateStr) return false;
    const status = String(b?.status || '').toLowerCase();
    if (status === 'approved' || status === 'accepted') return true;
    return includePending && status === 'pending';
  });
}

/** Staff who hold every skill the service requires. */
export function qualifiedFor(service: any, staff: any[]): any[] {
  const required: string[] = service?.requiredSkills || [];
  if (required.length === 0) return staff;
  return staff.filter((s) => required.every((skill) => (s?.skillSet || []).includes(skill)));
}

/** Certification gate — mirrors the 409 the booking route returns. */
export function isCertified(service: any, staffId: string): boolean {
  const certified: string[] = service?.certifiedStaffIds || [];
  if (certified.length === 0) return true;
  return certified.includes(staffId);
}

// ─── Busy-time construction ──────────────────────────────────────────────────

/**
 * Whether an existing appointment should block time.
 *
 * Everything blocks except cancellations and EXPIRED payment holds. That last
 * exclusion is deliberate: it matches PENDING_HOLD_MS in the booking route, so
 * an abandoned checkout stops blocking the slot at the same moment on both
 * sides. The previous hook whitelisted only three statuses, which meant a
 * completed or no-showed appointment stopped blocking its own slot.
 */
function blocksTime(apt: any, now: Date): boolean {
  const status = apt?.status;
  if (status === 'cancelled') return false;
  if (status === 'pending_payment') {
    const created = safeDate(apt?.createdAt);
    if (created && now.getTime() - created.getTime() > PENDING_HOLD_MS) return false;
  }
  return true;
}

/**
 * Padding for an existing appointment. Prefers what is stored ON the
 * appointment, because that is what the server wrote and what it will use to
 * judge a conflict. Falls back to the service record — which is what saves us
 * from QuickBookForm, whose appointment documents omit padBefore/padAfter
 * entirely and would otherwise be treated as needing zero buffer.
 */
function paddingFor(apt: any, servicesById: Record<string, any>): { before: number; after: number } {
  const svc = servicesById[apt?.serviceId];
  return {
    before: num(apt?.padBefore, num(svc?.padBefore, 0)),
    after: num(apt?.padAfter, num(svc?.padAfter, 0)),
  };
}

/**
 * Event types that occupy a person.
 *
 * EventsDialog writes exactly three: 'personal', 'business', 'blocked'. v1 of
 * this file honored only 'blocked', which meant a staff meeting entered as a
 * 'business' event was invisible to booking and got double-booked. All three
 * count now — if it is on someone's calendar with a start and an end, they are
 * not available. `blockingEventTypes` can narrow this per call.
 */
const DEFAULT_BLOCKING_EVENT_TYPES = [
  'blocked',
  'personal',
  'business',
  'time_off',
  'timeoff',
  'unavailable',
  'class',
  'training',
];

function isBlockingEvent(evt: any, allowed: string[]): boolean {
  const status = String(evt?.status || '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || status === 'deleted') return false;
  const t = String(evt?.type ?? 'blocked').toLowerCase().replace(/[\s-]/g, '_');
  return allowed.includes(t);
}

/** Supports both the `staffId` and the `staffIds[]` shapes used in this app. */
function eventAppliesTo(evt: any, staffId: string): boolean {
  const ids = evt?.staffIds;
  if (Array.isArray(ids)) {
    if (ids.length === 0) return true;
    return ids.includes('all') || ids.includes(staffId);
  }
  const single = evt?.staffId;
  if (!single) return true;
  return single === 'all' || single === staffId;
}

/**
 * The window an event occupies on a given day.
 *
 * allDay events are the trap here: EventsDialog still stores a startTime and
 * endTime for them, and those are whatever the clock happened to say. Taking
 * them literally would block a random hour instead of the day. So an allDay
 * event returns the full working window instead.
 */
function eventWindow(evt: any, open: Date, close: Date): Window | null {
  if (evt?.allDay) return { start: open, end: close };
  const start = safeDate(evt?.startTime);
  const end = safeDate(evt?.endTime);
  if (!start || !end || end <= start) return null;
  return { start, end };
}

/**
 * A staffBlock's window. These are stored as a start plus a DURATION in
 * minutes, not an end — so an end has to be derived. Released blocks stop
 * counting so a handoff that was undone gives the time back.
 */
function staffBlockWindow(block: any): Window | null {
  const status = String(block?.status || '').toLowerCase();
  if (status === 'released' || status === 'cancelled' || status === 'done' || status === 'completed') {
    return null;
  }
  const start = safeDate(block?.startTime);
  if (!start) return null;
  const end = safeDate(block?.endTime) ?? addMinutes(start, num(block?.duration, 0));
  if (end <= start) return null;
  return { start, end };
}

/**
 * Which physical resources a booking consumes. Prefers what is recorded on the
 * appointment (that is what check-in and the planner read), and falls back to
 * the service definition so the constraint applies to bookings made before the
 * field was being written.
 */
function resourceIdsFor(apt: any, service: any): string[] {
  const onApt = apt?.requiredResourceIds;
  if (Array.isArray(onApt) && onApt.length > 0) return onApt.filter(Boolean);
  const onService = service?.requiredResourceIds;
  if (Array.isArray(onService) && onService.length > 0) return onService.filter(Boolean);
  return [];
}

/**
 * Resources that are down for the whole of `dateStr`.
 *
 * This deliberately reuses planner-page.tsx's exact rule so the two screens can
 * never disagree about what is out of service:
 *   • an OPEN ticket at urgent/high priority takes its resource down from the
 *     day it was reported until someone resolves it;
 *   • a maintenancePlan whose nextRunAt is this date takes its resource down
 *     for that date.
 * A resource flagged isOutOfService is down regardless of tickets.
 */
export function resourceDowntime(
  dateStr: string,
  tickets: any[] = [],
  plans: any[] = [],
): Record<string, string> {
  const down: Record<string, string> = {};

  for (const t of tickets || []) {
    const status = String(t?.status || '').toLowerCase();
    if (status !== 'open' && status !== 'in_progress') continue;
    if (!['urgent', 'high'].includes(String(t?.priority || '').toLowerCase())) continue;
    const rid = t?.resourceId;
    if (!rid) continue;
    const reported = String(t?.createdAt || '').slice(0, 10);
    if (reported && reported > dateStr) continue; // not reported yet on this day
    down[rid] = `out of service — ${t?.title || 'maintenance ticket'}`;
  }

  for (const p of plans || []) {
    if (p?.active === false) continue;
    if (String(p?.nextRunAt || '').slice(0, 10) !== dateStr) continue;
    const rid = p?.resourceId;
    if (!rid) continue;
    down[rid] = `scheduled maintenance — ${p?.title || 'preventive run'}`;
  }

  return down;
}

// ─── Day context ─────────────────────────────────────────────────────────────

/**
 * Resolves everything that is true about a day once, so the slot scan, the
 * staff picker, the chain search, and the party search all reason over the
 * same facts instead of each rebuilding them slightly differently.
 */
export function buildDayContext(input: AvailabilityInput): DayContext | null {
  const warnings: string[] = [];
  const now = input.now ?? new Date();
  const dateObj = asDate(input.date);
  if (isNaN(dateObj.getTime())) return null;

  const services = input.services || [];
  const servicesById: Record<string, any> = {};
  for (const s of services) if (s?.id) servicesById[s.id] = s;

  const service = servicesById[input.serviceId];
  if (!service) return null;

  const addOns = (input.addOnIds || []).map((id) => servicesById[id]).filter(Boolean);
  const serviceMinutes = totalServiceMinutes(service, addOns);
  const padBefore = num(service?.padBefore, 0);
  const padAfter = num(service?.padAfter, 0);

  const profile =
    (input.scheduleProfiles || []).find((p: any) => p?.isActive) ??
    (input.scheduleProfiles || [])[0] ??
    null;
  if (!profile && (input.scheduleProfiles || []).length === 0) {
    warnings.push('No schedule profiles supplied — falling back to per-staff hours only.');
  }

  const interval =
    num(input.slotIntervalMinutes, 0) ||
    num(profile?.bookingSlotInterval, 0) ||
    num(input.tenant?.bookingSlotInterval, 0) ||
    DEFAULT_INTERVAL;

  const dayName = format(dateObj, 'eeee').toLowerCase();
  const fallback = input.fallbackHours ?? DEFAULT_FALLBACK_HOURS;
  const flashYield = !!input.tenant?.flashYieldEnabled;
  const sameDay = isSameDay(dateObj, now);

  // Narrow the staff pool: qualified, certified, tier-matched, and the
  // specific person if one was asked for.
  let pool = qualifiedFor(service, input.staff || []);
  pool = pool.filter((s) => s?.id && isCertified(service, s.id));

  const wantStaff = input.staffId || 'any';
  if (wantStaff !== 'any') {
    pool = pool.filter((s) => s.id === wantStaff);
  } else {
    pool = pool.filter((s) => s?.active !== false);
    const tierId = input.tierId || 'any';
    if (tierId !== 'any') pool = pool.filter((s) => s?.pricingTierId === tierId);
  }

  const dateStr = format(dateObj, 'yyyy-MM-dd');

  // ── Booking window: how soon, and how far out. ─────────────────────────────
  // Both are optional. The front desk passes neither, because a receptionist
  // has to be able to book the person standing in front of them for right now,
  // and to book six months out for a wedding.
  let closed = false;

  const horizonDays = num(
    input.maxHorizonDays,
    num(input.tenant?.bookingHorizonDays, 0),
  );
  if (horizonDays > 0) {
    const daysOut = Math.round(
      (startOfDay(dateObj).getTime() - startOfDay(now).getTime()) / 86400000,
    );
    if (daysOut > horizonDays) {
      closed = true;
      warnings.push(`That date is more than ${horizonDays} days out — outside the booking window.`);
    }
  }

  const leadMinutes = num(
    input.minLeadMinutes,
    num(input.tenant?.bookingLeadMinutes, num(input.tenant?.bookingLeadHours, 0) * 60),
  );
  const earliest = leadMinutes > 0 ? addMinutes(now, leadMinutes) : null;

  // ── The published roster. ─────────────────────────────────────────────────
  // A shift is the strongest statement about who is working, and it carries its
  // own clock times. But it can only ever REMOVE people, so if the roster has
  // not been published for this date, applying it would blank the whole day.
  // In that case it is ignored entirely and the weekly hours take over.
  const shifts = input.shifts || [];
  const rosterIsPublished = rosterPublished(shifts, dateStr);
  const useShifts = !input.ignoreShifts && shifts.length > 0 && rosterIsPublished;
  if (!input.ignoreShifts && shifts.length > 0 && !rosterIsPublished) {
    warnings.push(
      `No published shifts for ${dateStr} — the roster was skipped for this day and regular weekly hours were used instead.`,
    );
  }

  const blockingTypes = (input.blockingEventTypes || DEFAULT_BLOCKING_EVENT_TYPES).map((t) =>
    String(t).toLowerCase().replace(/[\s-]/g, '_'),
  );

  const dayAppointments = (input.appointments || []).filter((a) => {
    const start = safeDate(a?.startTime);
    return start ? isSameDay(start, dateObj) : false;
  });

  // Events on this date, including multi-day ones that straddle it.
  const dayEvents = (input.events || []).filter((e) => {
    if (!isBlockingEvent(e, blockingTypes)) return false;
    const start = safeDate(e?.startTime);
    if (!start) return false;
    if (isSameDay(start, dateObj)) return true;
    const end = safeDate(e?.endTime);
    if (!end) return false;
    return startOfDay(start) <= startOfDay(dateObj) && startOfDay(end) >= startOfDay(dateObj);
  });

  const dayStaffBlocks = (input.staffBlocks || []).filter((b) => {
    const start = safeDate(b?.startTime);
    return start ? isSameDay(start, dateObj) : false;
  });

  // ── Physical resources this service needs. ────────────────────────────────
  // Studio-wide, not per staff: two techs free and one pedicure chair means one
  // bookable slot, not two.
  const resourceLedgers: ResourceLedger[] = [];
  const neededResourceIds = input.ignoreResources ? [] : resourceIdsFor(null, service);
  if (neededResourceIds.length > 0) {
    const downtime = resourceDowntime(dateStr, input.tickets || [], input.maintenancePlans || []);
    for (const rid of neededResourceIds) {
      const res = (input.resources || []).find((r: any) => r?.id === rid);
      if (!res) {
        // The service names a station that no longer exists. Refusing every
        // slot over a stale id would be worse than ignoring it, so warn.
        warnings.push(
          `${service?.name || 'This service'} requires resource "${rid}", which no longer exists — that requirement was ignored.`,
        );
        continue;
      }
      const label = res?.name || rid;
      let capacity = Math.max(0, Math.floor(num(res?.capacity, 1) || 1));
      let downReason: string | undefined;

      if (res?.isOutOfService) {
        capacity = 0;
        downReason = `${label} is marked out of service`;
      } else if (downtime[rid]) {
        capacity = 0;
        downReason = `${label} — ${downtime[rid]}`;
      }

      const taken: Window[] = [];
      for (const apt of dayAppointments) {
        if (!blocksTime(apt, now)) continue;
        const ids = resourceIdsFor(apt, servicesById[apt?.serviceId]);
        if (!ids.includes(rid)) continue;
        const start = safeDate(apt?.startTime);
        if (!start) continue;
        const end =
          safeDate(apt?.endTime) ??
          addMinutes(start, num(servicesById[apt?.serviceId]?.duration, 60));
        const pad = paddingFor(apt, servicesById);
        const w = { start: subMinutes(start, pad.before), end: addMinutes(end, pad.after) };
        if (w.end > w.start) taken.push(w);
      }

      resourceLedgers.push({ resourceId: rid, name: label, capacity, taken, downReason });
    }
  }

  const staffDays: StaffDay[] = [];
  const byId: Record<string, StaffDay> = {};

  for (const staffMember of pool) {
    // Walk-in queue only: skip anyone who has turned walk-ins off.
    if (input.requireAcceptingWalkIns && staffMember?.acceptingWalkIns === false) continue;

    // An approved day off outranks every schedule underneath it.
    if (
      hasApprovedDayOff(
        input.dayOffBlocks || [],
        staffMember.id,
        dateStr,
        !!input.blockPendingDayOff,
      )
    ) {
      continue;
    }

    // Roster first, weekly hours second, studio profile third.
    const shift = useShifts ? findShift(shifts, staffMember.id, dateStr) : null;
    if (useShifts && !shift) continue; // published roster says they are not in

    let hours: { start: string; end: string } | null =
      shift?.startTime && shift?.endTime
        ? { start: String(shift.startTime), end: String(shift.endTime) }
        : resolveDayHours(staffMember, dayName, profile);

    if (!hours) {
      const hasAnySchedule = !!staffMember?.availability?.week || !!profile?.week;
      if (hasAnySchedule) continue; // genuinely off today
      hours = fallback;
      warnings.push(
        `No hours defined for ${staffMember?.name || staffMember.id} on ${dayName}; used ${fallback.start}-${fallback.end}.`,
      );
    }

    const open = parseClock(hours.start, dateObj);
    const close = parseClock(hours.end, dateObj);
    if (!open || !close || close <= open) {
      warnings.push(`Unreadable hours for ${staffMember?.name || staffMember.id} on ${dayName}.`);
      continue;
    }

    // On the day itself, respect who is actually on the floor.
    if (sameDay && (staffMember?.active === false || staffMember?.onBreak === true)) continue;

    const busy: Window[] = [];
    const hot: Date[] = [];
    let load = 0;

    for (const apt of dayAppointments) {
      if (apt?.staffId !== staffMember.id) continue;
      const start = safeDate(apt?.startTime);
      if (!start) continue;
      const end = safeDate(apt?.endTime) ?? addMinutes(start, num(servicesById[apt?.serviceId]?.duration, 60));

      if (!blocksTime(apt, now)) {
        // A recent cancellation reopens its slot, and flash yield flags it.
        if (flashYield && apt?.status === 'cancelled') {
          const hoursSince = Math.abs(differenceInMinutes(now, start)) / 60;
          if (hoursSince < FLASH_YIELD_HOURS) hot.push(start);
        }
        continue;
      }

      load += 1;
      const pad = paddingFor(apt, servicesById);
      const w = { start: subMinutes(start, pad.before), end: addMinutes(end, pad.after) };
      if (w.end > w.start) busy.push(w);
    }

    for (const evt of dayEvents) {
      if (!eventAppliesTo(evt, staffMember.id)) continue;
      const w = eventWindow(evt, open, close);
      if (w) busy.push(w);
    }

    // Handoff holds written by the staff portal when a tech takes a sequential
    // add-on. The code that writes them says they protect the tech's slot in
    // the booking system; until now nothing read them, so they protected
    // nothing.
    for (const block of dayStaffBlocks) {
      if (block?.staffId !== staffMember.id) continue;
      const w = staffBlockWindow(block);
      if (w) busy.push(w);
    }

    busy.sort((a, b) => a.start.getTime() - b.start.getTime());

    const entry: StaffDay = { staff: staffMember, open, close, busy, hot, load };
    staffDays.push(entry);
    byId[staffMember.id] = entry;
  }

  return {
    dateObj,
    dayName,
    now,
    interval,
    service,
    serviceMinutes,
    padBefore,
    padAfter,
    staffDays,
    byId,
    tightScheduling: !input.ignoreHeuristics && !!input.tenant?.tightSchedulingEnabled,
    morningAnchor: !input.ignoreHeuristics && !!input.tenant?.morningAnchorEnabled,
    resourceLedgers,
    earliest,
    closed,
    warnings,
  };
}

/**
 * Is there a free unit of every resource this service needs, for this window?
 *
 * Kept separate from `isStaffFree` because it is not about a person. The same
 * check runs in the slot scan, in the staff picker, and in `verifyBookable`, so
 * the grid cannot offer a pedicure the studio has no chair for.
 */
export function resourcesAvailable(
  ctx: DayContext,
  start: Date,
): { ok: true } | { ok: false; reason: string } {
  if (ctx.resourceLedgers.length === 0) return { ok: true };
  const guard = protectedWindow(start, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter);

  for (const led of ctx.resourceLedgers) {
    if (led.capacity <= 0) {
      return { ok: false, reason: led.downReason ?? `${led.name} is unavailable today` };
    }
    const concurrent = led.taken.filter((w) => overlaps(guard, w)).length;
    if (concurrent >= led.capacity) {
      return {
        ok: false,
        reason:
          led.capacity === 1
            ? `${led.name} is already in use at that time`
            : `all ${led.capacity} ${led.name} are in use at that time`,
      };
    }
  }
  return { ok: true };
}

/**
 * Same check, but counting units this visit has already claimed for itself.
 * A party of five pedicures cannot be seated in three chairs, and the two legs
 * of one chained visit cannot both hold the only manicure table.
 */
function resourceFreeWith(
  ctx: DayContext,
  start: Date,
  claimed: Record<string, Window[]>,
): boolean {
  if (ctx.resourceLedgers.length === 0) return true;
  const guard = protectedWindow(start, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter);

  for (const led of ctx.resourceLedgers) {
    if (led.capacity <= 0) return false;
    const already =
      led.taken.filter((w) => overlaps(guard, w)).length +
      (claimed[led.resourceId] || []).filter((w) => overlaps(guard, w)).length;
    if (already >= led.capacity) return false;
  }
  return true;
}

/** Records this visit's claim on every resource its service needs. */
function claimResources(
  ctx: DayContext,
  start: Date,
  claimed: Record<string, Window[]>,
): void {
  if (ctx.resourceLedgers.length === 0) return;
  const guard = protectedWindow(start, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter);
  for (const led of ctx.resourceLedgers) {
    if (!claimed[led.resourceId]) claimed[led.resourceId] = [];
    claimed[led.resourceId].push(guard);
  }
}

// ─── Freedom checks ──────────────────────────────────────────────────────────

/**
 * Is this staff member free for a booking of `minutes` starting at `start`?
 * The service must fit inside working hours; the padded window must not touch
 * another appointment.
 */
export function isStaffFree(
  day: StaffDay,
  start: Date,
  minutes: number,
  padBefore: number,
  padAfter: number,
): boolean {
  const serviceEnd = addMinutes(start, minutes);
  if (start < day.open) return false;
  if (serviceEnd > day.close) return false;
  const guard = protectedWindow(start, minutes, padBefore, padAfter);
  return !day.busy.some((b) => overlaps(guard, b));
}

/** Free minutes between this booking's protected end and the next commitment. */
function gapAfter(day: StaffDay, start: Date, minutes: number, padAfter: number): number {
  const end = addMinutes(start, minutes + padAfter);
  let next: Date | null = null;
  for (const b of day.busy) {
    if (b.start >= end && (next === null || b.start < next)) next = b.start;
  }
  const boundary = next ?? day.close;
  return Math.max(0, Math.floor((boundary.getTime() - end.getTime()) / 60000));
}

const isHotAt = (day: StaffDay, start: Date): boolean =>
  day.hot.some((h) => toHHmm(h) === toHHmm(start));

/**
 * The tenant's scheduling heuristics. Hot slots bypass both, matching the
 * existing behavior — a slot freed by a cancellation is offered regardless.
 */
function heuristicsAllow(ctx: DayContext, day: StaffDay, start: Date, hot: boolean): boolean {
  if (hot) return true;
  const dayEmpty = day.busy.length === 0;
  const isFirstOfDay = start.getTime() === day.open.getTime();

  if (ctx.morningAnchor && dayEmpty && !isFirstOfDay) return false;

  if (ctx.tightScheduling && !dayEmpty && !isFirstOfDay) {
    const guard = protectedWindow(start, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter);
    const butts = day.busy.some(
      (b) =>
        Math.abs(differenceInMinutes(guard.start, b.end)) < 1 ||
        Math.abs(differenceInMinutes(guard.end, b.start)) < 1,
    );
    if (!butts) return false;
  }
  return true;
}

// ─── The main scan ───────────────────────────────────────────────────────────

export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const empty: AvailabilityResult = {
    slots: [],
    allSlots: [],
    times: [],
    byTime: {},
    hotTimes: [],
    addOnUpsells: [],
    bestGapMinutes: 0,
    warnings: [],
  };

  if (!input?.date || !input?.serviceId) return empty;
  const ctx = buildDayContext(input);
  if (!ctx) return { ...empty, warnings: ['Service not found, or the date could not be read.'] };
  // The whole day is refused — past the booking horizon.
  if (ctx.closed) return { ...empty, warnings: ctx.warnings };

  const includeUnavailable = input.includeUnavailable !== false;
  const sameDay = isSameDay(ctx.dateObj, ctx.now);

  // Earliest bookable time today: the caller's floor, or the clock, whichever
  // is later. Rounded UP to the next interval so we never offer a slot that
  // has already begun.
  let floor: Date | null = null;
  if (input.skipSlotsBefore) floor = parseClock(input.skipSlotsBefore, ctx.dateObj);
  if (sameDay) {
    const nowFloor = ctx.now;
    if (!floor || nowFloor > floor) floor = nowFloor;
  }
  // Required notice, when the caller asked for it.
  if (ctx.earliest && (!floor || ctx.earliest > floor)) floor = ctx.earliest;

  const allSlots: Slot[] = [];

  for (const day of ctx.staffDays) {
    let cursor = new Date(day.open.getTime());

    if (floor && cursor < floor) {
      const behind = differenceInMinutes(floor, day.open);
      const steps = Math.ceil(behind / ctx.interval);
      cursor = addMinutes(day.open, steps * ctx.interval);
    }

    while (cursor < day.close) {
      const serviceEnd = addMinutes(cursor, ctx.serviceMinutes);
      if (serviceEnd > day.close) break;

      const hot = isHotAt(day, cursor);
      const guard = protectedWindow(cursor, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter);
      const collides = day.busy.some((b) => overlaps(guard, b));

      let available = true;
      let reason: string | undefined;

      const resourceCheck = collides ? null : resourcesAvailable(ctx, cursor);

      if (collides) {
        available = false;
        reason = 'overlaps an existing appointment or blocked time';
      } else if (resourceCheck && !resourceCheck.ok) {
        available = false;
        reason = resourceCheck.reason;
      } else if (!heuristicsAllow(ctx, day, cursor, hot)) {
        available = false;
        reason = ctx.tightScheduling
          ? 'tight scheduling — would leave an unfillable gap'
          : 'morning anchor — first booking of an empty day only';
      }

      if (available || includeUnavailable) {
        allSlots.push({
          time: toHHmm(cursor),
          label: toLabel(cursor),
          staffId: day.staff.id,
          staffName: day.staff.name ?? day.staff.id,
          gapMinutesAfter: gapAfter(day, cursor, ctx.serviceMinutes, ctx.padAfter),
          available,
          isHotSlot: hot,
          reason,
        });
      }

      cursor = addMinutes(cursor, ctx.interval);
    }
  }

  const slots = allSlots
    .filter((s) => s.available)
    .sort((a, b) => a.time.localeCompare(b.time) || a.staffName.localeCompare(b.staffName));

  const byTime: Record<string, Slot[]> = {};
  for (const s of slots) {
    if (!byTime[s.time]) byTime[s.time] = [];
    byTime[s.time].push(s);
  }

  const times = Object.keys(byTime).sort();
  const hotTimes = Array.from(new Set(slots.filter((s) => s.isHotSlot).map((s) => s.time))).sort();
  const bestGapMinutes = slots.reduce((max, s) => Math.max(max, s.gapMinutesAfter), 0);

  return {
    slots,
    allSlots,
    times,
    byTime,
    hotTimes,
    addOnUpsells: computeAddOnUpsells(input, bestGapMinutes),
    bestGapMinutes,
    warnings: ctx.warnings,
  };
}

/**
 * Add-ons that are genuinely compatible with the chosen service AND fit in the
 * free time after it. Compatibility comes from `type === 'addon'` plus the
 * primary service's `compatibleAddOnIds` — the same model the rest of the app
 * keys off — rather than any service that happened to fit the gap.
 */
export function computeAddOnUpsells(input: AvailabilityInput, gapMinutes: number): AddOnUpsell[] {
  const services = input.services || [];
  const svc = services.find((s) => s?.id === input.serviceId);
  if (!svc) return [];
  const compatible: string[] = svc.compatibleAddOnIds || [];
  if (compatible.length === 0) return [];
  const already = new Set(input.addOnIds || []);

  return services
    .filter(
      (s) =>
        s?.type === 'addon' &&
        compatible.includes(s.id) &&
        !already.has(s.id) &&
        num(s.duration, 0) > 0,
    )
    .map((s) => ({
      serviceId: s.id,
      name: s.name,
      duration: num(s.duration, 0),
      price: num(s.price, 0),
      fitsInGap: num(s.duration, 0) + num(s.padBefore, 0) + num(s.padAfter, 0) <= gapMinutes,
    }))
    .filter((a) => a.fitsInGap)
    .sort((a, b) => b.price - a.price)
    .slice(0, 4);
}

// ─── Fair staff assignment ───────────────────────────────────────────────────

export type StaffPick =
  | { ok: true; staffId: string; staffName: string }
  | { ok: false; error: string };

/**
 * Picks the provider for an "any available" booking, using the SAME padded
 * freedom test the slot scan used — so a slot that was offered cannot resolve
 * to someone it does not actually fit.
 *
 * Rotation order: least-recently-assigned first, then lightest day, then name.
 * The two tiebreaks matter more than they look. The old code sorted only by
 * `lastServedTimestamp`, a field nothing in the codebase ever writes, so every
 * candidate compared equal and "Any Available" silently handed every online
 * booking to whoever happened to be first in the array. Day load is a real
 * signal even when the timestamp is missing, and the name keeps it stable.
 */
export function pickStaffForSlot(input: AvailabilityInput & { time: string }): StaffPick {
  const ctx = buildDayContext(input);
  if (!ctx) return { ok: false, error: 'Service not found, or the date could not be read.' };

  if (ctx.closed) return { ok: false, error: 'That date is outside the booking window.' };

  const start = parseClock(input.time, ctx.dateObj);
  if (!start) return { ok: false, error: 'That time could not be read.' };

  if (ctx.earliest && start < ctx.earliest) {
    return { ok: false, error: 'That time is too soon — please choose a later one.' };
  }

  const resourceCheck = resourcesAvailable(ctx, start);
  if (!resourceCheck.ok) {
    return { ok: false, error: `That time is not available — ${resourceCheck.reason}.` };
  }

  const candidates = ctx.staffDays.filter((d) =>
    isStaffFree(d, start, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter),
  );

  if (candidates.length === 0) {
    return {
      ok: false,
      error: 'No one is available for that window any more. Please pick another time.',
    };
  }

  candidates.sort((a, b) => {
    const ta = rotationStamp(a.staff);
    const tb = rotationStamp(b.staff);
    if (ta !== tb) return ta - tb;
    if (a.load !== b.load) return a.load - b.load;
    return String(a.staff.name ?? a.staff.id).localeCompare(String(b.staff.name ?? b.staff.id));
  });

  const chosen = candidates[0].staff;
  return { ok: true, staffId: chosen.id, staffName: chosen.name ?? chosen.id };
}

/** Reads either rotation field. 0 means "never assigned", which sorts first. */
function rotationStamp(staffMember: any): number {
  const v = staffMember?.lastBookingAssignedAt ?? staffMember?.lastServedTimestamp;
  const d = safeDate(v);
  return d ? d.getTime() : 0;
}

// ─── Multi-service visits (one client, several services in sequence) ─────────

export type ChainLegInput = { serviceId: string; staffId?: string; addOnIds?: string[] };

export type ChainLeg = {
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  start: string;
  end: string;
  minutes: number;
  /** Processing/turnaround minutes the client waits before the next leg. */
  gapAfter: number;
};

export type ChainOption = {
  time: string;
  label: string;
  legs: ChainLeg[];
  /** Arrival to departure, including waiting time. */
  totalMinutes: number;
};

/**
 * Start times where the WHOLE chain fits — every leg's provider actually free
 * for their own leg.
 *
 * This is the gap that made chained booking unsafe to expose publicly.
 * `computeLegSchedule` in MultiProviderPanel derives leg times by walking
 * forward from the primary start and never checks whether leg two's provider
 * is free; `LegAvailabilityCheck` only raised an amber warning that did not
 * block. Tolerable when a receptionist is watching the screen. Not tolerable
 * on a public page, where nobody finds out until the day of.
 */
export function computeChainAvailability(
  base: Omit<AvailabilityInput, 'serviceId' | 'staffId' | 'addOnIds'>,
  legs: ChainLegInput[],
  options?: { maxOptions?: number },
): { options: ChainOption[]; warnings: string[] } {
  if (!legs || legs.length === 0) return { options: [], warnings: [] };

  const warnings: string[] = [];
  const contexts: DayContext[] = [];

  for (const leg of legs) {
    const ctx = buildDayContext({
      ...base,
      serviceId: leg.serviceId,
      staffId: leg.staffId || 'any',
      addOnIds: leg.addOnIds,
      includeUnavailable: false,
    } as AvailabilityInput);
    if (!ctx) return { options: [], warnings: ['One of the services could not be found.'] };
    warnings.push(...ctx.warnings);
    contexts.push(ctx);
  }

  const first = contexts[0];
  const servicesById: Record<string, any> = {};
  for (const s of base.services || []) if (s?.id) servicesById[s.id] = s;

  // Candidate anchors: the times the FIRST leg could start at all.
  const firstScan = computeAvailability({
    ...base,
    serviceId: legs[0].serviceId,
    staffId: legs[0].staffId || 'any',
    addOnIds: legs[0].addOnIds,
    includeUnavailable: false,
  } as AvailabilityInput);

  const out: ChainOption[] = [];
  const limit = options?.maxOptions ?? 24;

  for (const time of firstScan.times) {
    const anchor = parseClock(time, first.dateObj);
    if (!anchor) continue;

    const placed: ChainLeg[] = [];
    const taken: Record<string, Window[]> = {}; // provider -> windows this visit occupies
    const claimed: Record<string, Window[]> = {}; // resource -> windows this visit occupies
    let cursor = new Date(anchor.getTime());
    let ok = true;

    for (let i = 0; i < legs.length && ok; i++) {
      const ctx = contexts[i];
      const want = legs[i].staffId || 'any';

      // The station this leg needs has to be free too, including from the
      // earlier legs of this same visit.
      if (!resourceFreeWith(ctx, cursor, claimed)) {
        ok = false;
        break;
      }

      const candidates = ctx.staffDays.filter((d) => {
        if (!isStaffFree(d, cursor, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter)) return false;
        // A provider already working an earlier leg of this same visit cannot
        // also take this one at an overlapping time.
        const mine = taken[d.staff.id] || [];
        const guard = protectedWindow(cursor, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter);
        return !mine.some((w) => overlaps(guard, w));
      });

      if (candidates.length === 0) {
        ok = false;
        break;
      }

      candidates.sort((a, b) => {
        const ta = rotationStamp(a.staff);
        const tb = rotationStamp(b.staff);
        if (ta !== tb) return ta - tb;
        if (a.load !== b.load) return a.load - b.load;
        return String(a.staff.name ?? a.staff.id).localeCompare(String(b.staff.name ?? b.staff.id));
      });

      const pick = want === 'any' ? candidates[0] : candidates.find((c) => c.staff.id === want);
      if (!pick) {
        ok = false;
        break;
      }

      const legEnd = addMinutes(cursor, ctx.serviceMinutes);
      const svc = servicesById[legs[i].serviceId];
      const processing = num(svc?.processingGapMinutes, 0);

      placed.push({
        serviceId: legs[i].serviceId,
        serviceName: svc?.name ?? legs[i].serviceId,
        staffId: pick.staff.id,
        staffName: pick.staff.name ?? pick.staff.id,
        start: toHHmm(cursor),
        end: toHHmm(legEnd),
        minutes: ctx.serviceMinutes,
        gapAfter: i === legs.length - 1 ? 0 : processing,
      });

      if (!taken[pick.staff.id]) taken[pick.staff.id] = [];
      taken[pick.staff.id].push(
        protectedWindow(cursor, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter),
      );
      claimResources(ctx, cursor, claimed);

      cursor = addMinutes(legEnd, i === legs.length - 1 ? 0 : processing);
    }

    if (ok && placed.length === legs.length) {
      out.push({
        time,
        label: toLabel(anchor),
        legs: placed,
        totalMinutes: differenceInMinutes(cursor, anchor),
      });
      if (out.length >= limit) break;
    }
  }

  return { options: out, warnings: Array.from(new Set(warnings)) };
}

// ─── Parties (several people, one booking) ───────────────────────────────────

export type PartyMemberInput = {
  /** Display label only — the engine never needs a guest's contact details. */
  name?: string;
  serviceId: string;
  staffId?: string;
  addOnIds?: string[];
};

export type PartyMemberPlacement = {
  index: number;
  name?: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  start: string;
  end: string;
  minutes: number;
};

export type PartyOption = {
  mode: 'together' | 'staggered';
  /** Earliest start across the party. */
  time: string;
  label: string;
  /** Last end minus first start — how long the party is in the building. */
  spanMinutes: number;
  members: PartyMemberPlacement[];
};

/**
 * Feasible ways to seat a whole party.
 *
 * `together` means every member starts at the same time, which needs that many
 * providers free at once. `staggered` walks members forward in
 * STAGGER_STEP_MIN increments up to STAGGER_MAX_MIN.
 *
 * Two things this fixes versus the group logic inside QuickBookForm's
 * handleBook: that version tested conflicts with raw overlap and no padding at
 * all, and in the together-plus-any case it fell through to a loose provider
 * pick that skipped the busy check entirely — so it could double-book a
 * provider outright. Here every placement goes through the same padded
 * isStaffFree the rest of this module uses, and a provider already serving one
 * member of the party is unavailable to another at an overlapping time.
 *
 * The caller should present the OUTCOME ("all three of you at 2:00" versus
 * "back to back from 2:00"), never the words together/staggered.
 */
export function computePartyAvailability(
  base: Omit<AvailabilityInput, 'serviceId' | 'staffId' | 'addOnIds'>,
  members: PartyMemberInput[],
  options?: { mode?: 'together' | 'staggered' | 'either'; maxOptions?: number },
): { together: PartyOption[]; staggered: PartyOption[]; warnings: string[] } {
  const result = { together: [] as PartyOption[], staggered: [] as PartyOption[], warnings: [] as string[] };
  if (!members || members.length === 0) return result;

  const mode = options?.mode ?? 'either';
  const limit = options?.maxOptions ?? 12;

  const contexts: DayContext[] = [];
  for (const m of members) {
    const ctx = buildDayContext({
      ...base,
      serviceId: m.serviceId,
      staffId: m.staffId || 'any',
      addOnIds: m.addOnIds,
      includeUnavailable: false,
    } as AvailabilityInput);
    if (!ctx) {
      result.warnings.push('One of the selected services could not be found.');
      return result;
    }
    result.warnings.push(...ctx.warnings);
    contexts.push(ctx);
  }

  const servicesById: Record<string, any> = {};
  for (const s of base.services || []) if (s?.id) servicesById[s.id] = s;

  // Anchor candidates come from the widest pool: any time ANY member could
  // start. Using only member one's times would miss workable arrangements.
  const anchorTimes = new Set<string>();
  for (let i = 0; i < members.length; i++) {
    const scan = computeAvailability({
      ...base,
      serviceId: members[i].serviceId,
      staffId: members[i].staffId || 'any',
      addOnIds: members[i].addOnIds,
      includeUnavailable: false,
    } as AvailabilityInput);
    for (const t of scan.times) anchorTimes.add(t);
  }
  const anchors = Array.from(anchorTimes).sort();

  const place = (
    anchor: Date,
    offsets: number[],
  ): PartyMemberPlacement[] | null => {
    const taken: Record<string, Window[]> = {};
    const claimed: Record<string, Window[]> = {};
    const placements: PartyMemberPlacement[] = [];

    for (let i = 0; i < members.length; i++) {
      const ctx = contexts[i];
      const want = members[i].staffId || 'any';
      const start = addMinutes(anchor, offsets[i]);

      // Enough chairs/tables for this many people at once, not just enough
      // techs. This is the difference between promising a party of five and
      // seating a party of five.
      if (!resourceFreeWith(ctx, start, claimed)) return null;

      const candidates = ctx.staffDays.filter((d) => {
        if (!isStaffFree(d, start, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter)) return false;
        const mine = taken[d.staff.id] || [];
        const guard = protectedWindow(start, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter);
        return !mine.some((w) => overlaps(guard, w));
      });

      if (candidates.length === 0) return null;

      candidates.sort((a, b) => {
        const ta = rotationStamp(a.staff);
        const tb = rotationStamp(b.staff);
        if (ta !== tb) return ta - tb;
        if (a.load !== b.load) return a.load - b.load;
        return String(a.staff.name ?? a.staff.id).localeCompare(String(b.staff.name ?? b.staff.id));
      });

      const pick = want === 'any' ? candidates[0] : candidates.find((c) => c.staff.id === want);
      if (!pick) return null;

      const end = addMinutes(start, ctx.serviceMinutes);
      placements.push({
        index: i,
        name: members[i].name,
        serviceId: members[i].serviceId,
        serviceName: servicesById[members[i].serviceId]?.name ?? members[i].serviceId,
        staffId: pick.staff.id,
        staffName: pick.staff.name ?? pick.staff.id,
        start: toHHmm(start),
        end: toHHmm(end),
        minutes: ctx.serviceMinutes,
      });

      if (!taken[pick.staff.id]) taken[pick.staff.id] = [];
      taken[pick.staff.id].push(
        protectedWindow(start, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter),
      );
      claimResources(ctx, start, claimed);
    }

    return placements;
  };

  const spanOf = (placements: PartyMemberPlacement[]): number => {
    const starts = placements.map((p) => p.start).sort();
    const ends = placements.map((p) => p.end).sort();
    const a = parseClock(starts[0], contexts[0].dateObj);
    const b = parseClock(ends[ends.length - 1], contexts[0].dateObj);
    return a && b ? differenceInMinutes(b, a) : 0;
  };

  for (const time of anchors) {
    const anchor = parseClock(time, contexts[0].dateObj);
    if (!anchor) continue;

    if ((mode === 'together' || mode === 'either') && result.together.length < limit) {
      const placements = place(anchor, members.map(() => 0));
      if (placements) {
        result.together.push({
          mode: 'together',
          time,
          label: toLabel(anchor),
          spanMinutes: spanOf(placements),
          members: placements,
        });
      }
    }

    if ((mode === 'staggered' || mode === 'either') && result.staggered.length < limit) {
      // Walk each member forward from the previous one's start until they fit.
      const offsets: number[] = [];
      let feasible = true;

      for (let i = 0; i < members.length; i++) {
        if (i === 0) {
          offsets.push(0);
          continue;
        }
        let found = -1;
        for (let off = offsets[i - 1]; off <= STAGGER_MAX_MIN; off += STAGGER_STEP_MIN) {
          const trial = [...offsets.slice(0, i), off, ...members.slice(i + 1).map(() => off)];
          const attempt = place(anchor, trial);
          if (attempt) {
            found = off;
            break;
          }
        }
        if (found < 0) {
          feasible = false;
          break;
        }
        offsets.push(found);
      }

      if (feasible) {
        const placements = place(anchor, offsets);
        const isActuallyStaggered = offsets.some((o) => o !== 0);
        if (placements && isActuallyStaggered) {
          result.staggered.push({
            mode: 'staggered',
            time,
            label: toLabel(anchor),
            spanMinutes: spanOf(placements),
            members: placements,
          });
        }
      }
    }

    if (result.together.length >= limit && result.staggered.length >= limit) break;
  }

  result.warnings = Array.from(new Set(result.warnings));
  return result;
}

// ─── Server-side guard ───────────────────────────────────────────────────────

/**
 * The single check a booking route should run inside its transaction, using
 * appointments it just read. Because it shares every rule above, a slot the UI
 * offered will pass here — which is the whole reason this file exists.
 */
export function verifyBookable(
  input: AvailabilityInput & { time: string; requireStaffId?: string },
): StaffPick {
  const pick = pickStaffForSlot(input);
  if (!pick.ok) return pick;
  if (input.requireStaffId && input.requireStaffId !== 'any') {
    const ctx = buildDayContext(input);
    const start = ctx ? parseClock(input.time, ctx.dateObj) : null;
    const day = ctx?.byId[input.requireStaffId];
    if (!ctx || !start || !day) {
      return { ok: false, error: 'That professional is not available on this day.' };
    }
    if (!isStaffFree(day, start, ctx.serviceMinutes, ctx.padBefore, ctx.padAfter)) {
      return { ok: false, error: 'That professional is no longer free at that time.' };
    }
    return { ok: true, staffId: day.staff.id, staffName: day.staff.name ?? day.staff.id };
  }
  return pick;
}
