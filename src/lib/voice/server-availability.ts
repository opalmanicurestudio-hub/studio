/**
 * server-availability — v2
 *
 * v2 — SCHEDULE-PROFILE AWARENESS: v1 ported useSmartAvailability's
 * hardcoded 8 AM–8 PM business hours, which the ONLINE booking page has
 * never used — BookingSheet computes windows from the active
 * scheduleProfile (per-day hours + bookingSlotInterval), per-staff
 * availability.week overrides, and blocked studioEvents. A voice agent
 * running on v1 could offer Monday 8 AM when the studio is closed Mondays.
 * v2 adopts the online page's model as the authority:
 *   - window per staff/day: staff.availability.week[day] if enabled; if
 *     present-but-disabled the staff member is OFF that day; else the
 *     active profile's day; else (no profile at all) 8 AM–8 PM fallback so
 *     tenants without profiles keep working.
 *   - '9:00 AM' / '17:00' wall-time strings parsed and converted in the
 *     tenant's timezone.
 *   - blocked studioEvents excluded (handles both evt.staffId string and
 *     evt.staffIds array shapes found across the codebase).
 *   - slot grid steps by profile.bookingSlotInterval (default 15) so voice
 *     offers align with what the online page would offer.
 *   (tightScheduling / morningAnchor / flashYield yield-optimizers are NOT
 *    applied here — voice offers any genuinely open slot; can be added as
 *    a flag later if a tenant wants yield rules on the phone channel too.)
 *
 * v2 — UNIFIED FAIRNESS KEY: the codebase has TWO fairness fields —
 * QuickBookForm writes lastBookingAssignedAt; BookingSheet and
 * AddAppointmentDialog sort by lastServedTimestamp. This module sorts by
 * the most recent of EITHER, and the booking engine writes BOTH — so every
 * channel finally rotates off the same clock.
 *
 * Carried over from v1: bookable-status blocking ('confirmed',
 * 'deposit_pending', 'servicing'), service footprint (duration + pads),
 * staffId+time dedup semantics, gapMinutesAfter, speech-ready output,
 * even-spread sampling, and read-only fairness (the ENGINE advances the
 * ledger on booking; offering slots never does).
 */

import type { Firestore } from 'firebase-admin/firestore';
import {
  wallTimeToUtc,
  localTimeHHmm,
  localDateStr,
  localHour,
  speakDateTime,
  speakTime,
  speakList,
} from './voice-utils';

const FALLBACK_START_HOUR = 8;
const FALLBACK_END_HOUR = 20;
const DEFAULT_SLOT_INTERVAL = 15;
export const BOOKABLE_STATUSES = ['confirmed', 'deposit_pending', 'servicing'];
const DEFAULT_TIMEZONE = 'America/New_York';
const MAX_RANGE_DAYS = 7;

// ── Types ────────────────────────────────────────────────────────────────────

export type VoiceSlot = {
  slotId: string;
  date: string;
  time: string;
  startISO: string;
  spoken: string;
  spokenTime: string;
  providerId: string;
  providerName: string;
  gapMinutesAfter: number;
};

export type TenantContext = {
  timezone: string;
  tenantName: string;
  tenant: any;
  services: any[];
  staff: any[];
  scheduleProfile: any | null; // the active profile, if any
  blockedEvents: any[]; // studioEvents with type === 'blocked'
};

type TimeOfDay = 'morning' | 'afternoon' | 'evening';

// ── Safe parsing ─────────────────────────────────────────────────────────────

const safeDate = (val: any): Date | null => {
  if (!val) return null;
  try {
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
      const d = new Date(val);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

/** Parses '9:00 AM', '05:30 PM', or '17:00' into wall-clock hour/minute. */
export function parseWallTime(str: any): { h: number; m: number } | null {
  if (!str || typeof str !== 'string') return null;
  const match = str.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** Lowercase weekday name ('monday') for a local date string in a timezone. */
function weekdayName(dateStr: string, timeZone: string): string {
  const noonUtc = wallTimeToUtc(dateStr, 12, 0, timeZone);
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' })
    .format(noonUtc)
    .toLowerCase();
}

// ── Tenant context ───────────────────────────────────────────────────────────

export async function loadTenantContext(
  db: Firestore,
  tenantId: string,
): Promise<TenantContext> {
  const [tenantSnap, servicesSnap, staffSnap, profilesSnap, eventsSnap] =
    await Promise.all([
      db.doc(`tenants/${tenantId}`).get(),
      db.collection(`tenants/${tenantId}/services`).get(),
      db.collection(`tenants/${tenantId}/staff`).get(),
      db.collection(`tenants/${tenantId}/scheduleProfiles`).get().catch(() => null),
      db.collection(`tenants/${tenantId}/studioEvents`).limit(500).get().catch(() => null),
    ]);

  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const profiles = profilesSnap
    ? profilesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
    : [];
  const events = eventsSnap
    ? eventsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
    : [];

  return {
    timezone: tenant?.timezone || DEFAULT_TIMEZONE,
    tenantName: tenant?.name || tenant?.locationName || 'the studio',
    tenant,
    services: servicesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    staff: staffSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    scheduleProfile: profiles.find((p: any) => p.isActive) || null,
    blockedEvents: events.filter((e: any) => e.type === 'blocked'),
  };
}

// ── Entity resolution ────────────────────────────────────────────────────────

export function resolveService(
  ctx: TenantContext,
  opts: { serviceId?: string; serviceName?: string },
): any | null {
  if (opts.serviceId) {
    const byId = ctx.services.find((s) => s.id === opts.serviceId);
    if (byId) return byId;
  }
  const q = (opts.serviceName || opts.serviceId || '').trim().toLowerCase();
  if (!q) return null;
  const primaries = ctx.services.filter(
    (s) => s.type === 'service' && s.isActive !== false,
  );
  return (
    primaries.find((s) => s.name?.toLowerCase() === q) ||
    primaries.find((s) => s.name?.toLowerCase().includes(q)) ||
    primaries.find((s) => q.includes(s.name?.toLowerCase() || '\u0000')) ||
    null
  );
}

export function resolveProvider(
  ctx: TenantContext,
  opts: { providerId?: string; providerName?: string },
): any | null {
  if (opts.providerId && opts.providerId !== 'any') {
    const byId = ctx.staff.find((s) => s.id === opts.providerId);
    if (byId) return byId;
  }
  const q = (opts.providerName || '').trim().toLowerCase();
  if (!q || q === 'any' || q === 'anyone' || q === 'any available') return null;
  return (
    ctx.staff.find((s) => s.name?.toLowerCase() === q) ||
    ctx.staff.find((s) => s.name?.toLowerCase().startsWith(q)) ||
    ctx.staff.find((s) => s.name?.toLowerCase().includes(q)) ||
    null
  );
}

// ── Schedule windows (the online page's model, server-side) ─────────────────

/**
 * The working window for one staff member on one local date, as UTC
 * instants, or null if they're off. Mirrors BookingSheet: per-staff
 * availability overrides the profile; present-but-disabled means OFF;
 * no profile at all falls back to 8–20.
 */
export function staffWindowForDate(
  staffMember: any,
  ctx: TenantContext,
  dateStr: string,
): { start: Date; end: Date } | null {
  const tz = ctx.timezone;
  const dayName = weekdayName(dateStr, tz);

  const staffDay = staffMember?.availability?.week?.[dayName];
  let hours: any = null;
  if (staffDay?.enabled) hours = staffDay;
  else if (staffDay && staffDay.enabled === false) return null; // explicitly off
  else hours = ctx.scheduleProfile?.week?.[dayName] || null;

  if (ctx.scheduleProfile && (!hours || hours.enabled === false)) return null;

  const startParts = parseWallTime(hours?.start) || { h: FALLBACK_START_HOUR, m: 0 };
  const endParts = parseWallTime(hours?.end) || { h: FALLBACK_END_HOUR, m: 0 };
  const start = wallTimeToUtc(dateStr, startParts.h, startParts.m, tz);
  const end = wallTimeToUtc(dateStr, endParts.h, endParts.m, tz);
  if (end.getTime() <= start.getTime()) return null;
  return { start, end };
}

/** Blocked studioEvents intervals affecting one staff member on one local date. */
function blockedIntervalsFor(
  staffId: string,
  ctx: TenantContext,
  dayStart: Date,
  dayEnd: Date,
): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  for (const evt of ctx.blockedEvents) {
    const start = safeDate(evt.startTime);
    const end = safeDate(evt.endTime) || (start ? new Date(start.getTime() + 60 * 60_000) : null);
    if (!start || !end) continue;
    if (end.getTime() <= dayStart.getTime() || start.getTime() >= dayEnd.getTime()) continue;
    // Both shapes exist in the codebase: staffId (string|'all') and staffIds (array)
    const appliesToAll =
      !evt.staffId && !evt.staffIds
        ? true
        : evt.staffId === 'all' ||
          (Array.isArray(evt.staffIds) && evt.staffIds.includes('all'));
    const appliesToStaff =
      evt.staffId === staffId ||
      (Array.isArray(evt.staffIds) && evt.staffIds.includes(staffId));
    if (appliesToAll || appliesToStaff) out.push({ start, end });
  }
  return out;
}

/** Fetch a day's blocking appointments (bookable statuses) for a tenant. */
export async function fetchDayAppointments(
  db: Firestore,
  tenantId: string,
  ctx: TenantContext,
  dateStr: string,
): Promise<any[]> {
  const tz = ctx.timezone;
  const [y, m, d] = dateStr.split('-').map(Number);
  const nextDateStr = new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10);
  const dayStartUtc = wallTimeToUtc(dateStr, 0, 0, tz);
  const nextDayStartUtc = wallTimeToUtc(nextDateStr, 0, 0, tz);
  const snap = await db
    .collection(`tenants/${tenantId}/appointments`)
    .where('startTime', '>=', dayStartUtc.toISOString())
    .where('startTime', '<', nextDayStartUtc.toISOString())
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((a) => BOOKABLE_STATUSES.includes(a.status));
}

/** Unified fairness clock: most recent of the two fields used across the app. */
export function lastAssignedMs(staffMember: any): number {
  const a = staffMember?.lastBookingAssignedAt
    ? new Date(staffMember.lastBookingAssignedAt).getTime()
    : 0;
  const b = staffMember?.lastServedTimestamp
    ? new Date(staffMember.lastServedTimestamp).getTime()
    : 0;
  return Math.max(Number.isNaN(a) ? 0 : a, Number.isNaN(b) ? 0 : b);
}

// ── Authoritative single-slot verification (used by the booking engine) ──────

export function verifySlotOpen(opts: {
  staffMember: any;
  service: any;
  startUtc: Date;
  ctx: TenantContext;
  dayAppointments: any[]; // pre-fetched for the day
}): { open: true } | { open: false; reason: string } {
  const { staffMember, service, startUtc, ctx, dayAppointments } = opts;
  const tz = ctx.timezone;
  const dateStr = localDateStr(startUtc, tz);

  const window = staffWindowForDate(staffMember, ctx, dateStr);
  if (!window) return { open: false, reason: 'provider_off_that_day' };

  const footprint =
    (service.duration ?? 60) + (service.padBefore ?? 0) + (service.padAfter ?? 0);
  const slotEnd = new Date(startUtc.getTime() + footprint * 60_000);
  if (startUtc.getTime() < window.start.getTime() || slotEnd.getTime() > window.end.getTime()) {
    return { open: false, reason: 'outside_business_hours' };
  }

  const blocked = blockedIntervalsFor(staffMember.id, ctx, window.start, window.end);
  for (const b of blocked) {
    if (startUtc.getTime() < b.end.getTime() && b.start.getTime() < slotEnd.getTime()) {
      return { open: false, reason: 'blocked_event' };
    }
  }

  for (const a of dayAppointments) {
    if (a.staffId !== staffMember.id) continue;
    const aStart = safeDate(a.startTime);
    if (!aStart) continue;
    const aSvc = ctx.services.find((s: any) => s.id === a.serviceId);
    const aEnd =
      safeDate(a.endTime) || new Date(aStart.getTime() + ((aSvc?.duration ?? 60) * 60_000));
    const padded = {
      start: new Date(aStart.getTime() - (aSvc?.padBefore ?? 0) * 60_000),
      end: new Date(aEnd.getTime() + (aSvc?.padAfter ?? 0) * 60_000),
    };
    if (startUtc.getTime() < padded.end.getTime() && padded.start.getTime() < slotEnd.getTime()) {
      return { open: false, reason: 'slot_taken' };
    }
  }

  return { open: true };
}

// ── Day slot computation ─────────────────────────────────────────────────────

function sampleSpread<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  if (n <= 1) return [arr[0]];
  const out: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i * step);
    if (!seen.has(idx)) {
      seen.add(idx);
      out.push(arr[idx]);
    }
  }
  return out;
}

function matchesTimeOfDay(hour: number, pref?: TimeOfDay): boolean {
  if (!pref) return true;
  if (pref === 'morning') return hour < 12;
  if (pref === 'afternoon') return hour >= 12 && hour < 17;
  return hour >= 17;
}

async function computeDaySlots(
  db: Firestore,
  tenantId: string,
  ctx: TenantContext,
  opts: {
    date: string;
    service: any;
    provider: any | null;
    minStartUtc: Date;
    timeOfDay?: TimeOfDay;
  },
): Promise<VoiceSlot[]> {
  const { date, service, provider, minStartUtc, timeOfDay } = opts;
  const tz = ctx.timezone;
  const intervalMinutes =
    Number(ctx.scheduleProfile?.bookingSlotInterval) || DEFAULT_SLOT_INTERVAL;
  const intervalMs = intervalMinutes * 60_000;
  const footprint =
    (service.duration ?? 60) + (service.padBefore ?? 0) + (service.padAfter ?? 0);

  const dayApts = await fetchDayAppointments(db, tenantId, ctx, date);

  const candidateStaff = (provider ? [provider] : ctx.staff).filter(
    (s: any) => s.active !== false,
  );

  const openByTime = new Map<
    string,
    { slot: Omit<VoiceSlot, 'spoken' | 'spokenTime' | 'providerName'>; provider: any }[]
  >();

  for (const staffMember of candidateStaff) {
    const window = staffWindowForDate(staffMember, ctx, date);
    if (!window) continue;

    const blocked = blockedIntervalsFor(staffMember.id, ctx, window.start, window.end);
    const staffApts = dayApts
      .filter((a) => a.staffId === staffMember.id)
      .map((a) => {
        const start = safeDate(a.startTime);
        if (!start) return null;
        const aSvc = ctx.services.find((s: any) => s.id === a.serviceId);
        const end =
          safeDate(a.endTime) || new Date(start.getTime() + (aSvc?.duration ?? 60) * 60_000);
        return {
          start: new Date(start.getTime() - (aSvc?.padBefore ?? 0) * 60_000),
          end: new Date(end.getTime() + (aSvc?.padAfter ?? 0) * 60_000),
          rawEnd: end,
        };
      })
      .filter((a): a is { start: Date; end: Date; rawEnd: Date } => a !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let cursor = new Date(window.start.getTime());
    while (cursor.getTime() < window.end.getTime()) {
      const slotEnd = new Date(cursor.getTime() + footprint * 60_000);
      if (slotEnd.getTime() > window.end.getTime()) break;

      if (
        cursor.getTime() >= minStartUtc.getTime() &&
        matchesTimeOfDay(localHour(cursor, tz), timeOfDay)
      ) {
        const overlapsApt = staffApts.some(
          (a) => cursor.getTime() < a.end.getTime() && a.start.getTime() < slotEnd.getTime(),
        );
        const overlapsBlock = blocked.some(
          (b) => cursor.getTime() < b.end.getTime() && b.start.getTime() < slotEnd.getTime(),
        );

        if (!overlapsApt && !overlapsBlock) {
          const nextApt = staffApts.find((a) => a.start.getTime() >= slotEnd.getTime());
          const gapEnd = nextApt ? nextApt.start : window.end;
          const time = localTimeHHmm(cursor, tz);
          const entry = {
            slot: {
              slotId: `${date}T${time}_${staffMember.id}`,
              date,
              time,
              startISO: cursor.toISOString(),
              providerId: staffMember.id,
              gapMinutesAfter: Math.max(
                0,
                Math.floor((gapEnd.getTime() - slotEnd.getTime()) / 60_000),
              ),
            },
            provider: staffMember,
          };
          const list = openByTime.get(time) || [];
          list.push(entry);
          openByTime.set(time, list);
        }
      }
      cursor = new Date(cursor.getTime() + intervalMs);
    }
  }

  // One offer per time; 'any available' picks by unified fairness clock.
  const result: VoiceSlot[] = [];
  const times = Array.from(openByTime.keys()).sort((a, b) => a.localeCompare(b));
  for (const time of times) {
    const entries = openByTime.get(time)!;
    let chosen = entries[0];
    if (!provider && entries.length > 1) {
      const pool = entries
        .map((e) => e.provider)
        .filter((s: any) => s.acceptingWalkIns !== false);
      const finalPool = pool.length > 0 ? pool : entries.map((e) => e.provider);
      const fairest = [...finalPool].sort((a, b) => lastAssignedMs(a) - lastAssignedMs(b))[0];
      if (fairest) chosen = entries.find((e) => e.provider.id === fairest.id) || entries[0];
    }
    const start = new Date(chosen.slot.startISO);
    const firstName = (chosen.provider.name || chosen.provider.id).split(' ')[0];
    result.push({
      ...chosen.slot,
      providerName: chosen.provider.name || chosen.provider.id,
      spoken: `${speakDateTime(start, tz)} with ${firstName}`,
      spokenTime: speakTime(start, tz),
    });
  }
  return result;
}

// ── Public multi-day entry point (same signature as v1) ─────────────────────

export async function computeAvailability(
  db: Firestore,
  tenantId: string,
  ctx: TenantContext,
  opts: {
    service: any;
    provider: any | null;
    dateRangeStart: string;
    dateRangeEnd?: string;
    timeOfDay?: TimeOfDay;
    maxOptions?: number;
    minLeadMinutes?: number;
  },
): Promise<{ slots: VoiceSlot[]; spokenSummary: string }> {
  const tz = ctx.timezone;
  const limit = Math.min(Math.max(opts.maxOptions ?? 4, 1), 6);
  const minStartUtc = new Date(Date.now() + (opts.minLeadMinutes ?? 30) * 60_000);

  const todayLocal = localDateStr(new Date(), tz);
  const start = opts.dateRangeStart < todayLocal ? todayLocal : opts.dateRangeStart;
  const end = opts.dateRangeEnd && opts.dateRangeEnd >= start ? opts.dateRangeEnd : start;

  const days: string[] = [];
  let cursor = start;
  while (cursor <= end && days.length < MAX_RANGE_DAYS) {
    days.push(cursor);
    const [y, m, d] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10);
  }

  const perDay = await Promise.all(
    days.map((date) =>
      computeDaySlots(db, tenantId, ctx, {
        date,
        service: opts.service,
        provider: opts.provider,
        minStartUtc,
        timeOfDay: opts.timeOfDay,
      }),
    ),
  );

  const perDayQuota = Math.max(1, Math.floor(limit / days.length));
  const picked: VoiceSlot[] = [];
  const pickedIds = new Set<string>();
  for (const daySlots of perDay) {
    if (picked.length >= limit) break;
    for (const slot of sampleSpread(daySlots, perDayQuota)) {
      if (picked.length >= limit) break;
      if (!pickedIds.has(slot.slotId)) {
        pickedIds.add(slot.slotId);
        picked.push(slot);
      }
    }
  }
  for (const daySlots of perDay) {
    if (picked.length >= limit) break;
    for (const slot of daySlots) {
      if (picked.length >= limit) break;
      if (!pickedIds.has(slot.slotId)) {
        pickedIds.add(slot.slotId);
        picked.push(slot);
      }
    }
  }
  picked.sort((a, b) => a.startISO.localeCompare(b.startISO));

  let spokenSummary: string;
  if (picked.length === 0) {
    spokenSummary = `I don't see any openings for ${opts.service.name}${
      opts.provider ? ` with ${(opts.provider.name || '').split(' ')[0]}` : ''
    } in that window. Would another day or a different provider work?`;
  } else {
    spokenSummary = `I have ${speakList(picked.map((s) => s.spoken))}. ${
      picked.length > 1 ? 'Would any of those work?' : 'Would that work?'
    }`;
  }

  return { slots: picked, spokenSummary };
}
