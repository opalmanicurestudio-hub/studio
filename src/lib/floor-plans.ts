// ─── src/lib/floor-plans.ts ───────────────────────────────────────────────
// THE FLOOR-PLAN TEMPLATE, and the tenant's hosting settings.
//
// A session freezes a copy of the floor at open (hosting-sessions.ts). This
// file owns what it freezes FROM: one template per location at
// tenants/{t}/floorPlans/{locationId || 'default'} — the master layout the
// seating-chart designer edits.
//
// Today the only floor layouts in the system live INSIDE events
// (studioEvents.{id}.seatingTables), which means a restaurant would have to
// invent an event to describe its own room. templateFromEventTables() lifts
// an event's layout into a template ONCE — copied, never linked, so editing
// the master later cannot rewrite a past event, and vice versa.

import type { TableLike, Vocabulary } from './hosting';
import {
  DEFAULT_DAY_CUTOVER_HOUR, DEFAULT_HOLD_BEFORE_MINUTES, DEFAULT_HOLD_GRACE_MINUTES,
} from './hosting-sessions';

// ══════════════════════════════════════════════════════════════════════════
// TENANT HOSTING SETTINGS — stored at tenants/{id}.hostingSettings
// ══════════════════════════════════════════════════════════════════════════

export type PartyFormation = 'host' | 'booking';

export type HostingSettings = {
  vocabulary?: Partial<Vocabulary>;
  vocabularyPreset?: string;      // which preset seeded it — display only
  partyFormation?: PartyFormation;
  holdBeforeMinutes?: number;
  holdGraceMinutes?: number;
  dayCutoverHour?: number;
  escalateAfterMinutes?: number;
};

/** Presets imply a formation mode: a restaurant's parties form at the door,
 *  a salon's in the appointment book. A tenant can override either half. */
export const FORMATION_BY_PRESET: Record<string, PartyFormation> = {
  restaurant: 'host', venue: 'host', workshop: 'host',
  salon: 'booking', spa: 'booking', clinic: 'booking',
};

/** Read with every gap filled, so callers never re-implement a default. */
export function resolveHostingSettings(raw?: HostingSettings | null): Required<Omit<HostingSettings, 'vocabulary' | 'vocabularyPreset'>> & Pick<HostingSettings, 'vocabulary' | 'vocabularyPreset'> {
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
  };
  return {
    vocabulary: raw?.vocabulary,
    vocabularyPreset: raw?.vocabularyPreset,
    partyFormation: raw?.partyFormation === 'booking' ? 'booking' : 'host',
    holdBeforeMinutes: num(raw?.holdBeforeMinutes, DEFAULT_HOLD_BEFORE_MINUTES, 0, 240),
    holdGraceMinutes: num(raw?.holdGraceMinutes, DEFAULT_HOLD_GRACE_MINUTES, 0, 120),
    dayCutoverHour: num(raw?.dayCutoverHour, DEFAULT_DAY_CUTOVER_HOUR, 0, 12),
    escalateAfterMinutes: num(raw?.escalateAfterMinutes, 5, 1, 60),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// THE TEMPLATE — tenants/{t}/floorPlans/{locationId || 'default'}
// ══════════════════════════════════════════════════════════════════════════

export type FloorPlan = {
  id: string;                    // locationId or 'default'
  units: TableLike[];
  updatedAt: string;
  /** Where it came from, for the audit trail: 'event:{id}' or 'editor'. */
  source: string;
};

/**
 * Lift an event's seatingTables into template units.
 *
 * IDs ARE PRESERVED, not regenerated. The event's table ids are already what
 * eventGuests reference (after the H-migration), and keeping them means a
 * tenant who hosts their weekly service on the same physical floor as their
 * events gets one set of unit ids everywhere. Duplicate or missing ids are
 * repaired deterministically — `u2`, `u3` — never randomly, so importing the
 * same event twice yields the same template.
 */
export function templateFromEventTables(eventTables: any[]): TableLike[] {
  const seen = new Set<string>();
  const out: TableLike[] = [];
  let n = 0;
  for (const t of Array.isArray(eventTables) ? eventTables : []) {
    if (!t) continue;
    n += 1;
    let id = String(t.id || '').trim();
    if (!id || seen.has(id)) id = `u${n}`;
    while (seen.has(id)) id = `u${++n}`;
    seen.add(id);
    const seats = Number(t.seatCount);
    out.push({
      id,
      name: String(t.name || '').trim() || `#${n}`,
      seatCount: Number.isFinite(seats) && seats > 0
        ? Math.floor(seats)
        : (Array.isArray(t.seats) ? t.seats.length : 4),
      staffIds: Array.isArray(t.staffIds) ? t.staffIds.filter(Boolean) : [],
      tags: Array.isArray(t.tags) ? t.tags.filter(Boolean) : [],
      ...(t.zone ? { zone: String(t.zone) } : {}),
      ...(Array.isArray(t.joinableWith) ? { joinableWith: t.joinableWith.filter(Boolean) } : {}),
      x: typeof t.x === 'number' ? t.x : null,
      y: typeof t.y === 'number' ? t.y : null,
    });
  }
  return out;
}

/** A blank starter floor for a tenant with no events to import — four
 *  four-seat units in a row, enough to drag around and rename. */
export function starterTemplate(): TableLike[] {
  return [1, 2, 3, 4].map((i) => ({
    id: `u${i}`, name: `#${i}`, seatCount: 4, staffIds: [], tags: [],
    x: 40 + (i - 1) * 140, y: 60,
  }));
}
