/**
 * server-availability — v1
 *
 * Server-side port of the core of hooks/useSmartAvailability (v2) for the AI
 * receptionist routes, running against the Firebase ADMIN SDK instead of
 * client-context subscriptions. Faithfully carries over:
 *
 *   - Slot generation: 30-min grid, 8 AM–8 PM business hours, full service
 *     footprint (duration + padBefore + padAfter) must fit before close.
 *   - Overlap blocking against appointments with status 'confirmed',
 *     'deposit_pending', or 'servicing' (same status list as the hook).
 *   - gapMinutesAfter computation (gap to the provider's next appointment).
 *   - Dedup semantics: one slot per provider per time (the staffId+time
 *     keying fix — providers never collide with each other).
 *   - "Any available" fairness rotation: same pool-narrowing chain as
 *     QuickBookForm.resolveAnyStaffId — active → acceptingWalkIns !== false →
 *     on-shift today (shifts collection, status not cancelled/draft) →
 *     eligible at the requested time — then oldest lastBookingAssignedAt
 *     wins. Note: this route only *offers* slots; it never writes
 *     lastBookingAssignedAt. The fairness ledger is only advanced when a
 *     booking is actually created (by staff confirming the call-back draft
 *     through QuickBookForm, which already handles it).
 *
 * Differences from the client hook, on purpose:
 *   - Timezone-explicit. The hook runs in the salon's browser so local Date
 *     math is implicitly salon-local; this runs on Vercel in UTC, so business
 *     hours are computed in the tenant's timezone (tenant doc `timezone`
 *     field, default America/New_York) via voice-utils.
 *   - No add-on upsell computation. A phone agent upselling from a gap model
 *     is a v2 problem; keep the call flow simple.
 *   - Returns only AVAILABLE slots (a voice agent has no use for blocked
 *     ones), pre-formatted for speech, sampled down to a few options spread
 *     across the day instead of a wall of 8:00/8:30/9:00.
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

const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 20;
const SLOT_INTERVAL_MINUTES = 30;
const BOOKABLE_STATUSES = ['confirmed', 'deposit_pending', 'servicing'];
const DEFAULT_TIMEZONE = 'America/New_York';
const MAX_RANGE_DAYS = 7;

// ── Types ────────────────────────────────────────────────────────────────────

export type VoiceSlot = {
  slotId: string; // '{yyyy-MM-dd}T{HH:mm}_{staffId}' — stable, parseable
  date: string; // 'yyyy-MM-dd' (tenant-local)
  time: string; // 'HH:mm' (tenant-local) — same shape as the hook's slot.time
  startISO: string; // exact UTC instant, for create-callback-draft
  spoken: string; // 'Tuesday, July 7 at 2:30 PM with Jessica'
  spokenTime: string; // '2:30 PM'
  providerId: string;
  providerName: string;
  gapMinutesAfter: number;
};

export type TenantContext = {
  timezone: string;
  tenantName: string;
  services: any[];
  staff: any[];
};

type TimeOfDay = 'morning' | 'afternoon' | 'evening';

// ── Shared safe date parsing (same contract as the hook's safeDate) ──────────

const safeDate = (val: any): Date | null => {
  if (!val) return null;
  try {
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
      const d = new Date(val);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof val?.toDate === 'function') return val.toDate();
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

// ── Tenant context ───────────────────────────────────────────────────────────

export async function loadTenantContext(
  db: Firestore,
  tenantId: string,
): Promise<TenantContext> {
  const [tenantSnap, servicesSnap, staffSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.collection(`tenants/${tenantId}/services`).get(),
    db.collection(`tenants/${tenantId}/staff`).get(),
  ]);
  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  return {
    timezone: tenant?.timezone || DEFAULT_TIMEZONE,
    tenantName: tenant?.name || tenant?.locationName || 'the studio',
    services: servicesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
    staff: staffSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
  };
}

// ── Entity resolution (id-or-fuzzy-name, for the voice agent's benefit) ──────

export function resolveService(
  ctx: TenantContext,
  opts: { serviceId?: string; serviceName?: string },
): any | null {
  if (opts.serviceId) {
    return ctx.services.find((s) => s.id === opts.serviceId) || null;
  }
  const q = (opts.serviceName || '').trim().toLowerCase();
  if (!q) return null;
  const primaries = ctx.services.filter((s) => s.type === 'service');
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
    return ctx.staff.find((s) => s.id === opts.providerId) || null;
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

// ── Fairness rotation (port of QuickBookForm.resolveAnyStaffId) ──────────────

function pickFairestProvider(
  candidates: any[], // providers with an open slot at this exact time
  allStaff: any[],
  shifts: any[],
  dateStr: string,
): any | null {
  const onShiftIds = new Set(
    shifts
      .filter(
        (s: any) =>
          s.date === dateStr && s.status !== 'cancelled' && s.status !== 'draft',
      )
      .map((s: any) => s.staffId),
  );
  const eligibleIds = new Set(candidates.map((c) => c.id));

  const basePool = allStaff.filter(
    (s: any) =>
      s.active && s.acceptingWalkIns !== false && onShiftIds.has(s.id),
  );
  let pool = basePool.filter((s: any) => eligibleIds.has(s.id));
  if (pool.length === 0) pool = candidates.filter((c) => onShiftIds.has(c.id));
  if (pool.length === 0) pool = candidates; // final fallback: anyone actually free

  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a: any, b: any) => {
    const aLast = a.lastBookingAssignedAt
      ? new Date(a.lastBookingAssignedAt).getTime()
      : 0;
    const bLast = b.lastBookingAssignedAt
      ? new Date(b.lastBookingAssignedAt).getTime()
      : 0;
    return aLast - bLast;
  });
  return sorted[0] || null;
}

// ── Even sampling — a caller can hold 3 options, not 24 ─────────────────────

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

// ── Single-day computation (the useSmartAvailability core) ───────────────────

async function computeDaySlots(
  db: Firestore,
  tenantId: string,
  ctx: TenantContext,
  opts: {
    date: string; // 'yyyy-MM-dd' tenant-local
    service: any;
    provider: any | null; // null = 'any available'
    minStartUtc: Date; // lead-time floor (now + buffer)
    timeOfDay?: TimeOfDay;
  },
): Promise<VoiceSlot[]> {
  const { date, service, provider, minStartUtc, timeOfDay } = opts;
  const tz = ctx.timezone;

  const svcDuration: number =
    (service.duration ?? 60) + (service.padBefore ?? 0) + (service.padAfter ?? 0);

  // Next calendar day string (UTC-noon arithmetic avoids DST edge cases)
  const [y, m, d] = date.split('-').map(Number);
  const nextDateStr = new Date(Date.UTC(y, m - 1, d + 1, 12))
    .toISOString()
    .slice(0, 10);

  const dayStartUtc = wallTimeToUtc(date, 0, 0, tz);
  const nextDayStartUtc = wallTimeToUtc(nextDateStr, 0, 0, tz);

  // startTime is written client-side with toISOString(), so lexicographic
  // string range === chronological range. Single-field range → no composite
  // index required (deliberately — see the ClientStatsBar index saga).
  const [aptsSnap, shiftsSnap] = await Promise.all([
    db
      .collection(`tenants/${tenantId}/appointments`)
      .where('startTime', '>=', dayStartUtc.toISOString())
      .where('startTime', '<', nextDayStartUtc.toISOString())
      .get(),
    db.collection(`tenants/${tenantId}/shifts`).where('date', '==', date).get(),
  ]);

  const dayApts = aptsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((a) => BOOKABLE_STATUSES.includes(a.status));
  const shifts = shiftsSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as any),
  }));

  const candidateStaff = provider
    ? [provider]
    : ctx.staff.filter((s: any) => s.active !== false); // same filter as the hook

  const businessEnd = wallTimeToUtc(date, BUSINESS_END_HOUR, 0, tz);
  const intervalMs = SLOT_INTERVAL_MINUTES * 60_000;

  // Per-provider open slots — keyed staffId+time by construction, so the
  // "Any available" collision bug the hook fixed can't reappear here.
  const openByTime = new Map<string, { slot: Omit<VoiceSlot, 'spoken' | 'spokenTime' | 'providerName'>; provider: any }[]>();

  for (const staffMember of candidateStaff) {
    const staffApts = dayApts
      .filter((a) => a.staffId === staffMember.id)
      .map((a) => {
        const start = safeDate(a.startTime);
        if (!start) return null;
        const end = safeDate(a.endTime) ?? new Date(start.getTime() + 60 * 60_000);
        return { start, end };
      })
      .filter((a): a is { start: Date; end: Date } => a !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let cursor = wallTimeToUtc(date, BUSINESS_START_HOUR, 0, tz);

    while (cursor.getTime() < businessEnd.getTime()) {
      const slotEnd = new Date(cursor.getTime() + svcDuration * 60_000);

      if (cursor.getTime() < minStartUtc.getTime()) {
        cursor = new Date(cursor.getTime() + intervalMs);
        continue;
      }
      if (slotEnd.getTime() > businessEnd.getTime()) break;
      if (!matchesTimeOfDay(localHour(cursor, tz), timeOfDay)) {
        cursor = new Date(cursor.getTime() + intervalMs);
        continue;
      }

      // Non-inclusive interval overlap — same semantics as the hook's
      // areIntervalsOverlapping(..., { inclusive: false })
      const blocked = staffApts.some(
        (a) => cursor.getTime() < a.end.getTime() && a.start.getTime() < slotEnd.getTime(),
      );

      if (!blocked) {
        const nextApt = staffApts.find((a) => a.start.getTime() >= slotEnd.getTime());
        const gapEnd = nextApt ? nextApt.start : businessEnd;
        const gapMinutesAfter = Math.max(
          0,
          Math.floor((gapEnd.getTime() - slotEnd.getTime()) / 60_000),
        );
        const time = localTimeHHmm(cursor, tz);
        const entry = {
          slot: {
            slotId: `${date}T${time}_${staffMember.id}`,
            date,
            time,
            startISO: cursor.toISOString(),
            providerId: staffMember.id,
            gapMinutesAfter,
          },
          provider: staffMember,
        };
        const list = openByTime.get(time) || [];
        list.push(entry);
        openByTime.set(time, list);
      }

      cursor = new Date(cursor.getTime() + intervalMs);
    }
  }

  // Collapse to one offer per time. Specific provider: trivially one.
  // 'Any available': fairness rotation picks who gets offered.
  const result: VoiceSlot[] = [];
  const times = Array.from(openByTime.keys()).sort((a, b) => a.localeCompare(b));

  for (const time of times) {
    const entries = openByTime.get(time)!;
    let chosen = entries[0];
    if (!provider && entries.length > 1) {
      const fairest = pickFairestProvider(
        entries.map((e) => e.provider),
        ctx.staff,
        shifts,
        date,
      );
      if (fairest) {
        chosen = entries.find((e) => e.provider.id === fairest.id) || entries[0];
      }
    }
    const start = new Date(chosen.slot.startISO);
    const providerFirstName =
      (chosen.provider.name || chosen.provider.id).split(' ')[0];
    result.push({
      ...chosen.slot,
      providerName: chosen.provider.name || chosen.provider.id,
      spoken: `${speakDateTime(start, tz)} with ${providerFirstName}`,
      spokenTime: speakTime(start, tz),
    });
  }

  return result;
}

// ── Public entry point: multi-day, sampled, speech-ready ─────────────────────

export async function computeAvailability(
  db: Firestore,
  tenantId: string,
  ctx: TenantContext,
  opts: {
    service: any;
    provider: any | null;
    dateRangeStart: string; // 'yyyy-MM-dd'
    dateRangeEnd?: string;
    timeOfDay?: TimeOfDay;
    maxOptions?: number; // default 4, capped 6
    minLeadMinutes?: number; // default 30 — no "can you be here in 10 minutes"
  },
): Promise<{ slots: VoiceSlot[]; spokenSummary: string }> {
  const tz = ctx.timezone;
  const limit = Math.min(Math.max(opts.maxOptions ?? 4, 1), 6);
  const minStartUtc = new Date(Date.now() + (opts.minLeadMinutes ?? 30) * 60_000);

  // Clamp the range: never before today (tenant-local), never > 7 days wide.
  const todayLocal = localDateStr(new Date(), tz);
  let start = opts.dateRangeStart < todayLocal ? todayLocal : opts.dateRangeStart;
  const end =
    opts.dateRangeEnd && opts.dateRangeEnd >= start ? opts.dateRangeEnd : start;

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

  // First pass: an even sample from each day (earliest days first).
  // Second pass: top up from remaining slots in day order until the limit.
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
