// ─── src/lib/hosting-sessions.ts ──────────────────────────────────────────
// SESSIONS AND PARTIES: the pure logic under the host screen.
//
// hosting.ts answers "who fits where, right now." This file answers the
// questions around it: WHICH service period is this (a bar's Friday ends at
// 2am Saturday and still belongs to Friday), when does a session open and
// close, what state changes are legal for a party, when is a reserved unit
// held and when does that hold let go, and how the three EXISTING systems —
// walk-ins, event guests, appointments — map into one party shape without any
// of them being rewritten.
//
// Like hosting.ts, everything here is pure and deterministic so it can run
// identically on the host screen and on the server. Unlike hosting.ts it may
// import tenant-time, because a business day is a timezone question and that
// wheel is already built and tested.

import { addDays, dayKey, hourIn } from './tenant-time';
import { resolveSeat, type TableLike, type Vocabulary } from './hosting';

// ══════════════════════════════════════════════════════════════════════════
// SHAPES
// ══════════════════════════════════════════════════════════════════════════

export type SessionUnit = {
  id: string;
  name: string;
  seatCount: number;
  staffIds: string[];
  tags: string[];
  zone?: string;
  joinableWith?: string[];
  x?: number | null;
  y?: number | null;
};

export type ServiceSession = {
  id: string;
  locationId: string | null;
  businessDay: string;
  opensAt: string;
  closesAt: string | null;
  status: 'open' | 'closed';
  eventId: string | null;
  units: SessionUnit[];
  openedBy: string | null;
  vocabulary?: Partial<Vocabulary>;
  lastActivityAt?: string | null;
  autoClosedAt?: string | null;
};

export type PartySource = 'walk_in' | 'reservation' | 'event' | 'booking';

// 'no_show' and 'cancelled' exist from day one. Collapsing both into 'left'
// would make every no-show report impossible retroactively — a status you
// did not record is a status you cannot query.
export type PartyStatus =
  | 'expected' | 'waiting' | 'notified' | 'seated'
  | 'finished' | 'left' | 'no_show' | 'cancelled';

export type HostedParty = {
  id: string;
  sessionId: string;
  name: string;
  size: number;
  needs: string[];
  source: PartySource;
  status: PartyStatus;
  arrivesAt: string | null;
  joinedAt: string | null;
  quotedMinutes: number | null;
  notifiedAt: string | null;
  seatedAt: string | null;
  finishedAt: string | null;
  turnMinutes: number | null;
  unitIds: string[];
  guestIds: string[];
  phone?: string;
  smsOptIn?: boolean;
};

// ══════════════════════════════════════════════════════════════════════════
// THE BUSINESS DAY
// ══════════════════════════════════════════════════════════════════════════

/** Hours before this on the shop's clock belong to the PREVIOUS business
 *  day. 4am: late enough that a 2am last call is still "Friday", early
 *  enough that a bakery opening at 5 starts a fresh day. Tenant-settable. */
export const DEFAULT_DAY_CUTOVER_HOUR = 4;

export function businessDayFor(
  now: Date,
  timeZone?: string | null,
  cutoverHour: number = DEFAULT_DAY_CUTOVER_HOUR,
): string {
  const cut = Math.min(12, Math.max(0, Math.floor(Number(cutoverHour) || 0)));
  const day = dayKey(now, timeZone);
  return hourIn(now, timeZone) < cut ? addDays(day, -1) : day;
}

// ══════════════════════════════════════════════════════════════════════════
// OPENING AND CLOSING
//
// A session opens on the FIRST front-of-house action of a business day — not
// on a cron, which would open sessions on days the shop is unexpectedly
// closed. Nobody is required to press anything; "start service" merely does
// early what the first action would do anyway.
// ══════════════════════════════════════════════════════════════════════════

export type SessionDecision =
  | { action: 'open'; businessDay: string }
  | { action: 'reuse'; businessDay: string }
  | {
      action: 'close_then_open';
      businessDay: string;
      /** Close the stale session AT ITS LAST ACTIVITY, not at now — the shop
       *  was not "open" for the silent hours in between, and covers-per-hour
       *  reports should not think it was. */
      closeStaleAt: string;
    };

export function sessionDecision(
  openSession: Pick<ServiceSession, 'businessDay' | 'opensAt' | 'lastActivityAt'> | null | undefined,
  now: Date,
  timeZone?: string | null,
  cutoverHour: number = DEFAULT_DAY_CUTOVER_HOUR,
): SessionDecision {
  const businessDay = businessDayFor(now, timeZone, cutoverHour);
  if (!openSession) return { action: 'open', businessDay };
  if (openSession.businessDay === businessDay) return { action: 'reuse', businessDay };
  const last = String(openSession.lastActivityAt || openSession.opensAt || '') || now.toISOString();
  return { action: 'close_then_open', businessDay, closeStaleAt: last };
}

/** Freeze the master layout into a session. Junk-armored because the master
 *  comes from a drag-and-drop editor: a unit with no id cannot be referenced
 *  by anything and is dropped rather than invented. */
export function freezeUnits(tables: Array<TableLike | null | undefined>): SessionUnit[] {
  const seen = new Set<string>();
  const out: SessionUnit[] = [];
  for (const t of Array.isArray(tables) ? tables : []) {
    const id = String(t?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const seats = Number(t!.seatCount);
    out.push({
      id,
      name: String(t!.name || '').trim() || id,
      seatCount: Number.isFinite(seats) && seats > 0
        ? Math.floor(seats)
        : (Array.isArray(t!.seats) ? t!.seats.length : 0),
      staffIds: Array.isArray(t!.staffIds) ? t!.staffIds.filter(Boolean) : [],
      tags: Array.isArray(t!.tags) ? t!.tags.filter(Boolean) : [],
      ...(t!.zone ? { zone: String(t!.zone) } : {}),
      ...(Array.isArray(t!.joinableWith) ? { joinableWith: t!.joinableWith.filter(Boolean) } : {}),
      x: t!.x ?? null,
      y: t!.y ?? null,
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// PARTY LIFECYCLE
// ══════════════════════════════════════════════════════════════════════════

const TRANSITIONS: Record<PartyStatus, PartyStatus[]> = {
  expected:  ['waiting', 'seated', 'no_show', 'cancelled'],
  waiting:   ['notified', 'seated', 'left', 'cancelled'],
  notified:  ['seated', 'waiting', 'left'],   // back to waiting: skipped, keeps place
  seated:    ['finished', 'waiting'],          // back to waiting: seated in error
  finished:  [],
  left:      ['waiting'],                      // they came back — it happens
  no_show:   ['waiting'],                      // so does this
  cancelled: [],
};

export function legalTransition(from: PartyStatus, to: PartyStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

// ══════════════════════════════════════════════════════════════════════════
// HOLDS — the piece that keeps auto-seat from giving away the 7:30 table
// ══════════════════════════════════════════════════════════════════════════

export const DEFAULT_HOLD_BEFORE_MINUTES = 30;
export const DEFAULT_HOLD_GRACE_MINUTES = 15;

export type HoldOpts = { holdBeforeMinutes?: number; holdGraceMinutes?: number };

const holdBounds = (arrivesAt: string, opts: HoldOpts) => {
  const at = Date.parse(arrivesAt);
  if (!Number.isFinite(at)) return null;
  const before = Math.max(0, Math.floor(Number(opts.holdBeforeMinutes ?? DEFAULT_HOLD_BEFORE_MINUTES)));
  const grace = Math.max(0, Math.floor(Number(opts.holdGraceMinutes ?? DEFAULT_HOLD_GRACE_MINUTES)));
  return { holdsFrom: at - before * 60000, releasesAt: at + grace * 60000 };
};

export type Hold = { partyId: string; unitId: string; releasesAt: string };

/** Which units are off the market right now, and for whom. Only pinned,
 *  still-expected parties hold specific units; an unpinned reservation is
 *  capacity the HOST is tracking, not a unit the engine may block. */
export function heldUnits(
  parties: HostedParty[],
  now: Date,
  opts: HoldOpts = {},
): Record<string, Hold> {
  const out: Record<string, Hold> = {};
  for (const p of (Array.isArray(parties) ? parties : []).filter(Boolean)) {
    if (p.status !== 'expected' || !p.arrivesAt) continue;
    const b = holdBounds(p.arrivesAt, opts);
    if (!b) continue;
    const t = now.getTime();
    if (t < b.holdsFrom || t > b.releasesAt) continue;
    for (const unitId of p.unitIds || []) {
      const existing = out[unitId];
      // Two reservations pinned to one unit: the earlier arrival wins the
      // hold; the clash is a booking mistake for the host screen to surface,
      // not for this function to hide by overwriting.
      if (!existing || Date.parse(p.arrivesAt) < Date.parse(parties.find(q => q.id === existing.partyId)?.arrivesAt || '')) {
        out[unitId] = { partyId: p.id, unitId, releasesAt: new Date(b.releasesAt).toISOString() };
      }
    }
  }
  return out;
}

export type LateVerdict = { late: boolean; minutesLate: number; holdReleased: boolean };

export function lateVerdict(party: HostedParty, now: Date, opts: HoldOpts = {}): LateVerdict {
  if (party.status !== 'expected' || !party.arrivesAt) return { late: false, minutesLate: 0, holdReleased: false };
  const at = Date.parse(party.arrivesAt);
  if (!Number.isFinite(at)) return { late: false, minutesLate: 0, holdReleased: false };
  const mins = Math.floor((now.getTime() - at) / 60000);
  const grace = Math.max(0, Math.floor(Number(opts.holdGraceMinutes ?? DEFAULT_HOLD_GRACE_MINUTES)));
  return { late: mins > 0, minutesLate: Math.max(0, mins), holdReleased: mins > grace };
}

// ══════════════════════════════════════════════════════════════════════════
// ADAPTERS — the three existing systems, mapped, never rewritten.
// Each returns the party SHAPE; the caller supplies ids and writes.
// ══════════════════════════════════════════════════════════════════════════

const iso = (v: any): string | null => {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** walkIns docs already live this lifecycle under other names:
 *  waiting/confirmed → waiting, notified → notified, held → waiting (their
 *  spot is held, they are not yet sat), active → seated, completed → finished. */
export function partyFromWalkIn(w: any, sessionId: string): Omit<HostedParty, 'id'> | null {
  if (!w) return null;
  const map: Record<string, PartyStatus> = {
    waiting: 'waiting', confirmed: 'waiting', held: 'waiting',
    notified: 'notified', active: 'seated', completed: 'finished',
  };
  const status = map[String(w.status || '').toLowerCase()];
  if (!status) return null; // an unknown status must surface, not be guessed at
  return {
    sessionId,
    name: String(w.name || w.clientName || 'Walk-in').trim(),
    size: Math.max(1, Math.floor(Number(w.partySize) || 1)),
    needs: [],
    source: 'walk_in',
    status,
    arrivesAt: null,
    joinedAt: iso(w.checkInTime) || iso(w.createdAt),
    quotedMinutes: Number.isFinite(Number(w.quotedWaitMinutes)) ? Number(w.quotedWaitMinutes) : null,
    notifiedAt: iso(w.notifiedAt),
    seatedAt: iso(w.serviceStartTime),
    finishedAt: status === 'finished' ? (iso(w.completedAt) || iso(w.updatedAt)) : null,
    turnMinutes: null,
    unitIds: [],
    guestIds: [],
    ...(w.phone ? { phone: String(w.phone) } : {}),
    ...(typeof w.smsOptIn === 'boolean' ? { smsOptIn: w.smsOptIn } : {}),
  };
}

/** Event guests grouped into parties: by bookingId, else partyId, else each
 *  guest alone. Seat assignments come across through resolveSeat, so all
 *  three historical table-matching forms keep working here too. */
export function partiesFromEventGuests(
  guests: any[],
  sessionId: string,
  units: TableLike[],
): Array<Omit<HostedParty, 'id'>> {
  const groups = new Map<string, any[]>();
  for (const g of (Array.isArray(guests) ? guests : []).filter(Boolean)) {
    const key = String(g.bookingId || g.partyId || `solo:${g.id}`);
    (groups.get(key) || groups.set(key, []).get(key)!).push(g);
  }
  const out: Array<Omit<HostedParty, 'id'>> = [];
  for (const members of groups.values()) {
    const unitIds = Array.from(new Set(
      members.map((g) => resolveSeat(g, units).tableId).filter((x): x is string => !!x),
    ));
    const anyIn = members.some((g) => g.checkedIn === true);
    out.push({
      sessionId,
      name: String(members[0].name || 'Guest').trim() + (members.length > 1 ? ` +${members.length - 1}` : ''),
      size: members.length,
      needs: Array.from(new Set(members.flatMap((g) => Array.isArray(g.needs) ? g.needs : []))),
      source: 'event',
      status: anyIn ? 'seated' : 'expected',
      arrivesAt: null,
      joinedAt: anyIn ? iso(members.find((g) => g.checkedIn)?.checkedInAt) : null,
      quotedMinutes: null,
      notifiedAt: null,
      seatedAt: anyIn ? iso(members.find((g) => g.checkedIn)?.checkedInAt) : null,
      finishedAt: null,
      turnMinutes: null,
      unitIds,
      guestIds: members.map((g) => String(g.id)),
    });
  }
  return out;
}

/** A booking with a start time IS an expected party. This is what makes the
 *  host screen useful to a salon on day one: the appointment book flows in,
 *  check-in flips it to waiting, nothing is entered twice. */
export function partyFromAppointment(a: any, sessionId: string): Omit<HostedParty, 'id'> | null {
  if (!a || !a.startTime) return null;
  const status = String(a.status || '').toLowerCase();
  if (['cancelled', 'canceled', 'no_show'].includes(status)) return null;
  return {
    sessionId,
    name: String(a.clientName || a.name || 'Booking').trim(),
    size: Math.max(1, Math.floor(Number(a.groupSize) || 1)),
    needs: [],
    source: 'booking',
    status: a.checkedInAt ? 'waiting' : 'expected',
    arrivesAt: iso(a.startTime),
    joinedAt: iso(a.checkedInAt),
    quotedMinutes: null,
    notifiedAt: null,
    seatedAt: null,
    finishedAt: null,
    turnMinutes: Number.isFinite(Number(a.durationMinutes)) ? Number(a.durationMinutes) : null,
    unitIds: [],
    guestIds: [],
    ...(a.clientPhone ? { phone: String(a.clientPhone) } : {}),
  };
}
