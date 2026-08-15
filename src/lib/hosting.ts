// ─── src/lib/hosting.ts ───────────────────────────────────────────────────
// THE HOSTING ENGINE. Who sits where, who serves them, and what has been
// waiting too long.
//
// Pure functions, no Firestore, no React. Everything here is derived from
// three inputs — the units, the guests, the open requests — so it can be
// tested exhaustively, run on a host screen and re-run on a server without
// two implementations drifting apart. The surfaces come in later rounds; this
// is the thing they will all agree with.
//
// ══════════════════════════════════════════════════════════════════════════
// NOT A RESTAURANT ENGINE. NOT A SALON ENGINE.
//
// The thing a guest occupies is a UNIT. In a restaurant it is a table; in a
// salon a station or a chair; in a spa a room; in a workshop a bay; at a
// bowling alley a lane; at a market a booth. The engine never says which,
// because a tenant that reads "table is full" about their pedicure chair is
// reading someone else's product.
//
// So every sentence this file produces is BUILT from a Vocabulary the tenant
// sets, and the default is deliberately plain rather than plausible — a
// default of "table" would be invisible to a restaurant and wrong for
// everyone else, which is the worst kind of wrong.
//
// The FIELD names (`tableId`, `tableNumber`, `seatingTables`) stay as they
// are: that is what is already written in Firestore, and renaming stored
// fields to chase vocabulary would orphan every existing record to fix a
// wording problem. Field names are plumbing; vocabulary is what a human
// reads. They are allowed to disagree.
//
// ══════════════════════════════════════════════════════════════════════════
// THE PROBLEM THIS EXISTS TO END: A TABLE HAS THREE IDENTITIES
//
// Today a guest is matched to a table by `tableId`, OR by `tableNumber`
// holding an id, OR by `tableNumber` holding the table's NAME. Every consumer
// does its own two- or three-way OR. And the seating chart's own write path
// stores the human-readable label on purpose:
//
//     tableNumber: table?.name ?? tableId,   // "Table 1" or "Main"
//
// So renaming a table silently orphans everyone sitting at it, and two tables
// that happen to share a name make every guest at either of them ambiguous —
// which today resolves by `.find()` taking whichever came first.
//
// This file does two things about that. `resolveSeat()` reads all three forms
// so nothing breaks while the data is mixed, and it reports HOW it matched,
// so a host screen can show "12 guests are matched by name and would be lost
// if you rename this table". `migrationPlan()` turns that into a one-time
// backfill. After the backfill, name matching should never fire again — and
// if it does, that is a bug worth seeing rather than absorbing.
//
// AMBIGUITY IS NOT RESOLVED, IT IS REPORTED. Where two tables could match,
// this returns null and flags it. Picking one would be a guess, and a guess
// about where a person is sitting is how a request reaches the wrong server.

// ══════════════════════════════════════════════════════════════════════════
// VOCABULARY
// ══════════════════════════════════════════════════════════════════════════

export type Vocabulary = {
  /** What a guest occupies. table / station / room / bay / lane / booth. */
  unit: string;
  units: string;
  /** One place at that unit. Some niches have none — a treatment room seats
   *  one and nobody calls it a seat — so `seat` may equal `unit`. */
  seat: string;
  seats: string;
  /** The person. guest / client / customer / patient / player. */
  person: string;
  people: string;
  /** A group arriving together. */
  party: string;
  parties: string;
};

/** Plain on purpose. A tenant that has not chosen sees neutral words rather
 *  than another industry's words. */
export const DEFAULT_VOCABULARY: Vocabulary = {
  unit: 'space', units: 'spaces',
  seat: 'seat', seats: 'seats',
  person: 'guest', people: 'guests',
  party: 'party', parties: 'parties',
};

/** A starting list, not a closed one. These are OFFERED to a tenant in
 *  settings; nothing here is applied to anyone who did not pick it. */
export const VOCABULARY_PRESETS: Record<string, Vocabulary> = {
  restaurant: { unit: 'table', units: 'tables', seat: 'seat', seats: 'seats', person: 'guest', people: 'guests', party: 'party', parties: 'parties' },
  salon:      { unit: 'station', units: 'stations', seat: 'chair', seats: 'chairs', person: 'client', people: 'clients', party: 'group', parties: 'groups' },
  spa:        { unit: 'room', units: 'rooms', seat: 'space', seats: 'spaces', person: 'guest', people: 'guests', party: 'booking', parties: 'bookings' },
  clinic:     { unit: 'room', units: 'rooms', seat: 'space', seats: 'spaces', person: 'patient', people: 'patients', party: 'group', parties: 'groups' },
  workshop:   { unit: 'bay', units: 'bays', seat: 'space', seats: 'spaces', person: 'customer', people: 'customers', party: 'job', parties: 'jobs' },
  venue:      { unit: 'table', units: 'tables', seat: 'seat', seats: 'seats', person: 'guest', people: 'guests', party: 'party', parties: 'parties' },
};

/** Fill the gaps rather than reject a partial one — a tenant who has set only
 *  `unit` should not lose every other word. */
export function resolveVocabulary(v?: Partial<Vocabulary> | null): Vocabulary {
  const out = { ...DEFAULT_VOCABULARY };
  for (const k of Object.keys(DEFAULT_VOCABULARY) as (keyof Vocabulary)[]) {
    const val = typeof v?.[k] === 'string' ? String(v[k]).trim() : '';
    if (val) out[k] = val;
  }
  return out;
}

/** Singular or plural, so a count and its noun always agree. Nothing here
 *  tries to be clever about English: the tenant supplies both forms. */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ══════════════════════════════════════════════════════════════════════════
// SHAPES — structurally typed so the seating chart's SeatingTable, the floor
// board's local type and the manifest's loose objects all pass without any of
// them importing each other.
// ══════════════════════════════════════════════════════════════════════════

export type SeatLike = { id: string; label?: string };

export type TableLike = {
  id: string;
  name?: string;
  seatCount?: number;
  seats?: SeatLike[];
  staffIds?: string[];
  x?: number | null;
  y?: number | null;
  /** Free-form capability tags — 'accessible', 'high-top', 'quiet'. Matched
   *  against a party's `needs`; a unit with no tags fits anyone. The SET is
   *  the tenant's, not ours: a clinic tags rooms very differently from a bar. */
  tags?: string[];
  /** Units this one can be physically joined to. Adjacency is a fact about a
   *  room that no algorithm can see, so the tenant states it. */
  joinableWith?: string[];
  /** Shorthand for the same thing: units in one zone are joinable with each
   *  other. Cheaper to maintain than pairwise lists on a big floor. */
  zone?: string;
};

export type GuestLike = {
  id: string;
  name?: string;
  tableId?: string | null;
  tableNumber?: string | null;
  seatId?: string | null;
  seatNumber?: string | null;
  /** Guests sharing a partyId are seated together or not at all. */
  partyId?: string | null;
  needs?: string[];
  checkedIn?: boolean;
};

export type RequestLike = {
  id: string;
  status?: string;              // 'new' | 'acknowledged' | 'done'
  tableId?: string | null;
  tableNumber?: string | null;
  createdAt?: string | number | Date | null;
  claimedBy?: string | null;
};

export type StaffLike = { id: string; name?: string };

export type MatchKind = 'id' | 'number-as-id' | 'name' | 'none' | 'ambiguous';

// ══════════════════════════════════════════════════════════════════════════
// IDENTITY
// ══════════════════════════════════════════════════════════════════════════

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const seatsOf = (t: TableLike): number => {
  const n = Number(t?.seatCount);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return Array.isArray(t?.seats) ? t.seats.length : 0;
};

/**
 * Which table is this guest at? Reads all three historical forms, in the
 * order of how certain each one is, and says which one answered.
 *
 * A NAME match is reported as such rather than treated as equivalent,
 * because it is the fragile one: it survives only until someone renames the
 * table. Callers that care (the host screen, the migration) can act on that;
 * callers that just need the id can ignore it.
 */
export function resolveSeat(
  guest: GuestLike | null | undefined,
  tables: TableLike[],
): { tableId: string | null; match: MatchKind } {
  if (!guest) return { tableId: null, match: 'none' };
  const list = Array.isArray(tables) ? tables.filter(Boolean) : [];

  const byId = s(guest.tableId);
  if (byId && list.some((t) => t.id === byId)) return { tableId: byId, match: 'id' };

  const num = s(guest.tableNumber);
  if (!num) return { tableId: null, match: 'none' };

  if (list.some((t) => t.id === num)) return { tableId: num, match: 'number-as-id' };

  // Names are not unique and nothing has ever stopped two tables sharing one.
  // Two candidates means we do not know, and saying so beats picking.
  const named = list.filter((t) => s(t.name).toLowerCase() === num.toLowerCase());
  if (named.length === 1) return { tableId: named[0].id, match: 'name' };
  if (named.length > 1) return { tableId: null, match: 'ambiguous' };

  return { tableId: null, match: 'none' };
}

/** The same question for a floor request, which carries the same two fields. */
export function resolveRequestTable(
  request: RequestLike | null | undefined,
  tables: TableLike[],
): { tableId: string | null; match: MatchKind } {
  return resolveSeat(
    request ? { id: request.id, tableId: request.tableId, tableNumber: request.tableNumber } : null,
    tables,
  );
}

export type MigrationRow = {
  guestId: string;
  guestName: string;
  tableId: string | null;
  match: MatchKind;
  /** True when this guest needs a write to become id-keyed. */
  needsWrite: boolean;
};

/**
 * The one-time backfill: resolve every guest ONCE against the tables as they
 * stand right now, and write the id. Guests already keyed by id are left
 * alone. Guests that cannot be resolved are returned too — they are the ones
 * a human has to look at, and they must not be silently dropped, which is
 * what a filter-then-write migration would do.
 */
export function migrationPlan(guests: GuestLike[], tables: TableLike[]): {
  rows: MigrationRow[];
  toWrite: MigrationRow[];
  unresolved: MigrationRow[];
  fragile: number;
} {
  const rows: MigrationRow[] = (Array.isArray(guests) ? guests : []).filter(Boolean).map((g) => {
    const { tableId, match } = resolveSeat(g, tables);
    return {
      guestId: g.id,
      guestName: s(g.name) || 'Guest',
      tableId,
      match,
      needsWrite: !!tableId && match !== 'id',
    };
  });
  return {
    rows,
    toWrite: rows.filter((r) => r.needsWrite),
    unresolved: rows.filter((r) => !r.tableId && r.match !== 'none'),
    fragile: rows.filter((r) => r.match === 'name').length,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// OCCUPANCY
// ══════════════════════════════════════════════════════════════════════════

export type TableState = {
  tableId: string;
  name: string;
  capacity: number;
  seated: number;
  free: number;
  /** More guests than seats. Possible today because seatCount is displayed
   *  and never enforced — so this reports reality rather than assuming it
   *  cannot happen. */
  overfilled: boolean;
  guestIds: string[];
  staffIds: string[];
  tags: string[];
};

export type SeatingState = {
  tables: TableState[];
  byTable: Record<string, TableState>;
  /** Guests whose table cannot be resolved at all. */
  unseated: GuestLike[];
  /** Guests matched only by table NAME — correct today, lost on rename. */
  fragile: GuestLike[];
  /** Guests whose table name matches more than one table. */
  ambiguous: GuestLike[];
  totalCapacity: number;
  totalSeated: number;
};

export function seatingState(tables: TableLike[], guests: GuestLike[]): SeatingState {
  const list = (Array.isArray(tables) ? tables : []).filter(Boolean);
  const people = (Array.isArray(guests) ? guests : []).filter(Boolean);

  const byTable: Record<string, TableState> = {};
  for (const t of list) {
    byTable[t.id] = {
      tableId: t.id,
      name: s(t.name) || t.id,
      capacity: seatsOf(t),
      seated: 0,
      free: seatsOf(t),
      overfilled: false,
      guestIds: [],
      staffIds: Array.isArray(t.staffIds) ? t.staffIds.filter(Boolean) : [],
      tags: Array.isArray(t.tags) ? t.tags.filter(Boolean) : [],
    };
  }

  const unseated: GuestLike[] = [];
  const fragile: GuestLike[] = [];
  const ambiguous: GuestLike[] = [];

  for (const g of people) {
    const { tableId, match } = resolveSeat(g, list);
    if (match === 'ambiguous') { ambiguous.push(g); continue; }
    if (!tableId || !byTable[tableId]) { unseated.push(g); continue; }
    if (match === 'name') fragile.push(g);
    const st = byTable[tableId];
    st.guestIds.push(g.id);
    st.seated += 1;
  }

  for (const st of Object.values(byTable)) {
    st.free = Math.max(0, st.capacity - st.seated);
    st.overfilled = st.seated > st.capacity;
  }

  const ordered = list.map((t) => byTable[t.id]);
  return {
    tables: ordered,
    byTable,
    unseated,
    fragile,
    ambiguous,
    totalCapacity: ordered.reduce((a, t) => a + t.capacity, 0),
    totalSeated: ordered.reduce((a, t) => a + t.seated, 0),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// SEATING A PARTY
//
// HOLDS. A reservation takes its unit off the market BEFORE the party
// arrives — that is the whole point of booking. Every function below accepts
// an optional `held` map (unitId -> { partyId }), produced by heldUnits() in
// hosting-sessions.ts. A held unit is unavailable to everyone EXCEPT the
// party it is held for: when the Riveras walk in at 7:28, their own hold must
// not refuse them their own table. Passing no map means no holds, which is
// exactly the pre-reservation behaviour — every earlier caller and test is
// untouched by construction, not by luck.
// ══════════════════════════════════════════════════════════════════════════

export type HeldMap = Record<string, { partyId?: string }>;

const heldAgainst = (held: HeldMap | undefined, unitId: string, partyId?: string): boolean => {
  const h = held?.[unitId];
  return !!h && (!partyId || h.partyId !== partyId);
};

export type Party = {
  id: string;
  size: number;
  name?: string;
  /** Tags the table must carry — 'accessible' and so on. */
  needs?: string[];
};

export type SeatVerdict = { allowed: boolean; reason?: string };

/** Can this party go here? Capacity is a RULE, not a progress ring. */
export function canSeat(
  state: SeatingState,
  tableId: string,
  party: Party,
  opts: { allowOverfill?: boolean; vocabulary?: Partial<Vocabulary>; held?: HeldMap } = {},
): SeatVerdict {
  const V = resolveVocabulary(opts.vocabulary);
  const t = state.byTable[tableId];
  if (!t) return { allowed: false, reason: `That ${V.unit} no longer exists.` };
  if (heldAgainst(opts.held, tableId, party?.id)) {
    return { allowed: false, reason: `${t.name} is held for a ${V.party} arriving soon.` };
  }

  const size = Math.max(1, Math.floor(Number(party?.size) || 1));
  const needs = (party?.needs || []).filter(Boolean);
  const missing = needs.filter((n) => !t.tags.includes(n));
  if (missing.length > 0) {
    return { allowed: false, reason: `${t.name} is not ${missing.join(' or ')}.` };
  }
  if (size > t.free && !opts.allowOverfill) {
    return {
      allowed: false,
      reason: t.free === 0
        ? `${t.name} is full.`
        : `${t.name} has ${t.free} ${plural(t.free, V.seat, V.seats)} free and this ${V.party} is ${size}.`,
    };
  }
  return { allowed: true };
}

export type SeatProposal = {
  partyId: string;
  partySize: number;
  tableId: string | null;
  tableName: string;
  /** Why this table and not another — shown to the host, because a plan you
   *  cannot argue with is a plan you cannot trust. */
  rationale: string;
};

/**
 * AUTO-SEAT. Best-fit: the smallest table that still fits the party, so a
 * two-top does not consume the only eight-top and strand the next large
 * group. Ties break on the lightest-loaded section, then on table order, so
 * the same inputs always give the same plan — a host watching the screen
 * re-render must not see seats shuffle for no reason.
 *
 * Larger parties are placed FIRST. Seating small parties first is what fills
 * a room with fours and leaves a six standing in the doorway with forty free
 * seats on the floor.
 *
 * This returns PROPOSALS. Nothing is written, and a host dragging a party
 * somewhere else always wins — the machine is better at arithmetic and worse
 * at knowing that table 4 is under the speaker.
 */
export function autoSeatPlan(
  tables: TableLike[],
  parties: Party[],
  guests: GuestLike[] = [],
  opts: { allowOverfill?: boolean; load?: Record<string, number>; vocabulary?: Partial<Vocabulary>; held?: HeldMap } = {},
): SeatProposal[] {
  const V = resolveVocabulary(opts.vocabulary);
  const state = seatingState(tables, guests);
  // A working copy: each placement consumes seats for the next decision.
  const free: Record<string, number> = {};
  for (const t of state.tables) free[t.tableId] = t.free;

  const load = opts.load || {};
  const loadOf = (t: TableState) => {
    const ids = t.staffIds;
    if (ids.length === 0) return Number.MAX_SAFE_INTEGER - 1; // unstaffed: last resort
    return Math.min(...ids.map((id) => Number(load[id]) || 0));
  };
  const order = new Map(state.tables.map((t, i) => [t.tableId, i]));

  const queue = [...(Array.isArray(parties) ? parties : [])]
    .filter(Boolean)
    .map((p) => ({ ...p, size: Math.max(1, Math.floor(Number(p.size) || 1)) }))
    .sort((a, b) => b.size - a.size || String(a.id).localeCompare(String(b.id)));

  const out: SeatProposal[] = [];
  for (const party of queue) {
    const needs = (party.needs || []).filter(Boolean);
    // The party's OWN held unit is the strongest candidate there is — it was
    // chosen for them at booking time. It goes first when it still fits;
    // units held for anyone else are simply not on the market.
    const own = Object.entries(opts.held || {})
      .find(([, h]) => h?.partyId === party.id)?.[0];
    if (own && free[own] !== undefined && (opts.allowOverfill || free[own] >= party.size)
      && needs.every((n) => state.byTable[own].tags.includes(n))) {
      free[own] -= party.size;
      out.push({
        partyId: party.id, partySize: party.size,
        tableId: own, tableName: state.byTable[own].name,
        rationale: `Held for this ${V.party}.`,
      });
      continue;
    }
    const candidates = state.tables
      .filter((t) => !heldAgainst(opts.held, t.tableId, party.id))
      .filter((t) => needs.every((n) => t.tags.includes(n)))
      .filter((t) => opts.allowOverfill || free[t.tableId] >= party.size)
      .sort((a, b) =>
        (free[a.tableId] - party.size) - (free[b.tableId] - party.size)
        || loadOf(a) - loadOf(b)
        || (order.get(a.tableId)! - order.get(b.tableId)!));

    const pick = candidates[0];
    if (!pick) {
      out.push({
        partyId: party.id,
        partySize: party.size,
        tableId: null,
        tableName: '',
          rationale: needs.length
          ? `No ${needs.join(' / ')} ${V.unit} has ${party.size} ${V.seats} free.`
          : `No ${V.unit} has ${party.size} ${V.seats} free.`,
      });
      continue;
    }
    const waste = free[pick.tableId] - party.size;
    free[pick.tableId] -= party.size;
    out.push({
      partyId: party.id,
      partySize: party.size,
      tableId: pick.tableId,
      tableName: pick.name,
      rationale: waste === 0
        ? `Exact fit for ${party.size}.`
        : `Smallest ${V.unit} that fits ${party.size}; ${waste} ${plural(waste, V.seat, V.seats)} spare.`,
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// COMBINING
//
// A party of ten arrives and the floor has no ten. A host pushes two fives
// together. Nothing in the app has ever modelled that, so the largest party
// any tenant could seat was their single biggest unit — which for most small
// businesses is six, and that is exactly the booking they cannot afford to
// turn away.
//
// A combination is a SET of units treated as one. It is legal only when every
// unit in it is joinable with every other: `joinableWith` lists ids, or units
// sharing a `zone` are joinable by default. Physical adjacency is real and
// this file cannot see it, so the tenant declares it rather than the engine
// guessing that unit 2 is next to unit 9.
// ══════════════════════════════════════════════════════════════════════════

export type Combination = {
  tableIds: string[];
  names: string[];
  seats: number;
  free: number;
  waste: number;
};

const joinable = (a: TableLike, b: TableLike): boolean => {
  if (a.id === b.id) return false;
  const aList = Array.isArray(a.joinableWith) ? a.joinableWith : [];
  const bList = Array.isArray(b.joinableWith) ? b.joinableWith : [];
  if (aList.includes(b.id) || bList.includes(a.id)) return true;
  const az = s(a.zone); const bz = s(b.zone);
  return !!az && az === bz;
};

/**
 * Every legal way to reach `size`, best first.
 *
 * Capped at `maxUnits` (default 3) because a host pushing four separate units
 * together for one party is not a seating plan, it is a barricade — and the
 * search space grows fast enough that an uncapped one would hang a screen on
 * a large floor.
 *
 * Ordered by fewest units, then least waste: two sixes beat three fours for a
 * party of ten, and a five-plus-five beats a six-plus-six.
 */
export function combinationsFor(
  tables: TableLike[],
  size: number,
  guests: GuestLike[] = [],
  opts: { maxUnits?: number; limit?: number; held?: HeldMap; forPartyId?: string } = {},
): Combination[] {
  const want = Math.max(1, Math.floor(Number(size) || 1));
  const maxUnits = Math.min(4, Math.max(2, Math.floor(Number(opts.maxUnits) || 3)));
  const limit = Math.max(1, Math.floor(Number(opts.limit) || 10));
  const list = (Array.isArray(tables) ? tables : []).filter(Boolean);
  const state = seatingState(list, guests);

  // Only units with something free are worth joining — combining a full unit
  // with an empty one seats nobody and moves a party that is already sitting.
  const usable = list
    .filter((t) => (state.byTable[t.id]?.free || 0) > 0)
    // A held unit must not be quietly welded into someone else's combination.
    .filter((t) => !heldAgainst(opts.held, t.id, opts.forPartyId));
  const out: Combination[] = [];

  const walk = (start: number, chosen: TableLike[], free: number) => {
    if (chosen.length >= 2 && free >= want) {
      out.push({
        tableIds: chosen.map((t) => t.id),
        names: chosen.map((t) => state.byTable[t.id]?.name || t.id),
        seats: chosen.reduce((a, t) => a + seatsOf(t), 0),
        free,
        waste: free - want,
      });
      return; // adding another unit to a set that already fits only wastes more
    }
    if (chosen.length >= maxUnits) return;
    for (let i = start; i < usable.length; i++) {
      const next = usable[i];
      if (chosen.some((c) => !joinable(c, next))) continue;
      walk(i + 1, [...chosen, next], free + (state.byTable[next.id]?.free || 0));
    }
  };
  for (let i = 0; i < usable.length; i++) walk(i + 1, [usable[i]], state.byTable[usable[i].id]?.free || 0);

  return out
    .sort((a, b) => a.tableIds.length - b.tableIds.length
      || a.waste - b.waste
      || a.tableIds.join().localeCompare(b.tableIds.join()))
    .slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════════════
// QUOTING A WAIT
//
// The single most-repeated sentence in any host's shift: "about twenty-five
// minutes." Getting it roughly right is what stops people leaving; inventing
// it is what makes them wait an hour and never come back.
//
// This is arithmetic on what is already known — when each party sat down, and
// how long a turn usually takes here — not a prediction. When the inputs are
// missing it says so rather than producing a confident number from nothing.
// ══════════════════════════════════════════════════════════════════════════

export type Seated = {
  tableId: string;
  seatedAt?: string | number | Date | null;
  /** Overrides the default for this party — a two-hour tasting menu at unit 4
   *  should not be quoted as a forty-minute turn. */
  turnMinutes?: number;
};

export type Quote = {
  /** Minutes until something suitable frees up. Null when it cannot be known. */
  minutes: number | null;
  tableId: string | null;
  tableName: string;
  /** Plain sentence, in the tenant's own words. */
  text: string;
  /** True when a suitable unit is free RIGHT NOW. */
  immediate: boolean;
};

export const DEFAULT_TURN_MINUTES = 60;

export function quoteWait(
  tables: TableLike[],
  guests: GuestLike[],
  seated: Seated[],
  party: Party,
  opts: { turnMinutes?: number; now?: Date; vocabulary?: Partial<Vocabulary>; allowCombination?: boolean; held?: HeldMap } = {},
): Quote {
  const V = resolveVocabulary(opts.vocabulary);
  const now = opts.now || new Date();
  const size = Math.max(1, Math.floor(Number(party?.size) || 1));
  const needs = (party?.needs || []).filter(Boolean);
  const defaultTurn = Math.max(1, Math.floor(Number(opts.turnMinutes) || DEFAULT_TURN_MINUTES));
  const state = seatingState(tables, guests);

  const fits = state.tables
    .filter((t) => needs.every((n) => t.tags.includes(n)))
    // Held units are not on the market for a quote either — telling a walk-in
    // "ready now" and then seating them at a booked unit is the exact failure
    // holds exist to prevent.
    .filter((t) => !heldAgainst(opts.held, t.tableId, party?.id));

  const openNow = fits.filter((t) => t.free >= size);
  if (openNow.length > 0) {
    const pick = openNow.sort((a, b) => (a.free - size) - (b.free - size))[0];
    return {
      minutes: 0, tableId: pick.tableId, tableName: pick.name, immediate: true,
      text: `${pick.name} is ready now.`,
    };
  }

  if (opts.allowCombination !== false) {
    const combo = combinationsFor(tables, size, guests, { held: opts.held, forPartyId: party?.id })[0];
    if (combo) {
      return {
        minutes: 0, tableId: combo.tableIds[0], tableName: combo.names.join(' + '), immediate: true,
        text: `Ready now by joining ${combo.names.join(' and ')}.`,
      };
    }
  }

  // Nothing free. When does the earliest SUITABLE unit turn over?
  const byTable: Record<string, Seated[]> = {};
  for (const row of (Array.isArray(seated) ? seated : []).filter(Boolean)) {
    (byTable[s(row.tableId)] = byTable[s(row.tableId)] || []).push(row);
  }

  let best: { minutes: number; t: TableState } | null = null;
  for (const t of fits) {
    if (t.capacity < size) continue;         // will never fit, however long we wait
    const rows = byTable[t.tableId] || [];
    if (rows.length === 0) continue;         // occupied but we do not know since when
    const frees = rows.map((r) => {
      const started = msOf(r.seatedAt as any);
      const turn = Math.max(1, Math.floor(Number(r.turnMinutes) || defaultTurn));
      if (!Number.isFinite(started)) return NaN;
      return Math.max(0, Math.ceil((started + turn * 60000 - now.getTime()) / 60000));
    });
    if (frees.some((n) => !Number.isFinite(n))) continue;
    const mins = Math.max(...frees);
    if (!best || mins < best.minutes) best = { minutes: mins, t };
  }

  if (!best) {
    return {
      minutes: null, tableId: null, tableName: '', immediate: false,
      // Honest, and useful: a host reading this knows to give their own
      // estimate rather than repeat a number the screen invented.
      text: `No ${V.unit} that seats ${size} is free, and there is not enough information to quote a wait.`,
    };
  }
  return {
    minutes: best.minutes, tableId: best.t.tableId, tableName: best.t.name, immediate: false,
    text: best.minutes === 0
      ? `${best.t.name} is finishing now.`
      : `About ${best.minutes} ${plural(best.minutes, 'minute', 'minutes')} — ${best.t.name} next.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// SECTIONS AND LOAD
// ══════════════════════════════════════════════════════════════════════════

export type SectionLoad = {
  staffId: string;
  staffName: string;
  tableIds: string[];
  seats: number;         // seats owned, staffed or not
  guests: number;        // people actually sitting in them
  openRequests: number;
  /** Minutes the oldest unfinished request has been waiting. */
  oldestWaitMinutes: number;
};

const msOf = (v: RequestLike['createdAt']): number => {
  if (!v) return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
};

const isOpen = (r: RequestLike) => s(r?.status) !== 'done';

export function sectionLoad(
  tables: TableLike[],
  staff: StaffLike[],
  guests: GuestLike[],
  requests: RequestLike[],
  now: Date = new Date(),
): SectionLoad[] {
  const state = seatingState(tables, guests);
  const open = (Array.isArray(requests) ? requests : []).filter(Boolean).filter(isOpen);

  const reqByTable: Record<string, RequestLike[]> = {};
  for (const r of open) {
    const { tableId } = resolveRequestTable(r, tables);
    if (!tableId) continue;
    (reqByTable[tableId] = reqByTable[tableId] || []).push(r);
  }

  return (Array.isArray(staff) ? staff : []).filter(Boolean).map((member) => {
    const mine = state.tables.filter((t) => t.staffIds.includes(member.id));
    const reqs = mine.flatMap((t) => reqByTable[t.tableId] || []);
    const waits = reqs
      .map((r) => msOf(r.createdAt))
      .filter((n) => Number.isFinite(n))
      .map((n) => Math.max(0, Math.floor((now.getTime() - n) / 60000)));
    return {
      staffId: member.id,
      staffName: s(member.name) || member.id,
      tableIds: mine.map((t) => t.tableId),
      seats: mine.reduce((a, t) => a + t.capacity, 0),
      guests: mine.reduce((a, t) => a + t.seated, 0),
      openRequests: reqs.length,
      oldestWaitMinutes: waits.length ? Math.max(...waits) : 0,
    };
  });
}

export type SectionProposal = { staffId: string; staffName: string; tableIds: string[]; seats: number };

/**
 * BALANCE SECTIONS BY SEATS, NOT BY TABLES. Four two-tops is not the same
 * shift as two eight-tops, and splitting by table count is how one person
 * ends up with half the room. Largest table first into whoever is lightest —
 * the same greedy rule that keeps the pack bench honest, and it lands within
 * one table of optimal on any realistic floor.
 *
 * A PROPOSAL, not an assignment. Sections are also about who works well where
 * and who is training, and this file knows neither.
 */
export function balanceSections(tables: TableLike[], staff: StaffLike[]): SectionProposal[] {
  const people = (Array.isArray(staff) ? staff : []).filter(Boolean);
  if (people.length === 0) return [];

  const out: SectionProposal[] = people.map((m) => ({
    staffId: m.id, staffName: s(m.name) || m.id, tableIds: [], seats: 0,
  }));

  const ordered = (Array.isArray(tables) ? tables : [])
    .filter(Boolean)
    .map((t, i) => ({ id: t.id, seats: seatsOf(t), i }))
    .sort((a, b) => b.seats - a.seats || a.i - b.i);

  for (const t of ordered) {
    // Lightest by seats; ties by current table count, then by list order, so
    // the result is deterministic rather than dependent on object ordering.
    let best = 0;
    for (let i = 1; i < out.length; i++) {
      const a = out[i]; const b = out[best];
      if (a.seats < b.seats
        || (a.seats === b.seats && a.tableIds.length < b.tableIds.length)) best = i;
    }
    out[best].tableIds.push(t.id);
    out[best].seats += t.seats;
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// ROUTING AND ESCALATION
// ══════════════════════════════════════════════════════════════════════════

export type Routed = {
  requestId: string;
  tableId: string | null;
  tableName: string;
  /** Who owns it. Null means nobody does — the failure mode that is currently
   *  invisible: a request at an unclaimed table sits unread. */
  ownerIds: string[];
  waitMinutes: number;
  escalate: boolean;
  reason: string;
};

export const DEFAULT_ESCALATE_MINUTES = 5;

/**
 * Where does this request go, and should someone be shouted at about it?
 *
 * Two escalation triggers, deliberately separate: NOBODY OWNS IT, and IT HAS
 * WAITED TOO LONG. They need different responses — the first is a floor-plan
 * problem the host fixes once, the second is a pace problem in a section that
 * is drowning — and collapsing them into one amber badge loses that.
 */
export function routeRequests(
  requests: RequestLike[],
  tables: TableLike[],
  opts: { escalateAfterMinutes?: number; now?: Date; vocabulary?: Partial<Vocabulary> } = {},
): Routed[] {
  const V = resolveVocabulary(opts.vocabulary);
  const now = opts.now || new Date();
  const limit = Math.max(1, Math.floor(Number(opts.escalateAfterMinutes) || DEFAULT_ESCALATE_MINUTES));
  const list = (Array.isArray(tables) ? tables : []).filter(Boolean);
  const byId: Record<string, TableLike> = {};
  for (const t of list) byId[t.id] = t;

  return (Array.isArray(requests) ? requests : [])
    .filter(Boolean)
    .filter(isOpen)
    .map((r) => {
      const { tableId, match } = resolveRequestTable(r, list);
      const table = tableId ? byId[tableId] : null;
      const ownerIds = (table?.staffIds || []).filter(Boolean);
      const ms = msOf(r.createdAt);
      const waitMinutes = Number.isFinite(ms) ? Math.max(0, Math.floor((now.getTime() - ms) / 60000)) : 0;

      let escalate = false;
      let reason = '';
      if (!tableId) {
        escalate = true;
        reason = match === 'ambiguous'
          ? `Two ${V.units} share that name — nobody can be sure whose this is.`
          : `This request is not attached to any ${V.unit} on the floor.`;
      } else if (ownerIds.length === 0) {
        escalate = true;
        reason = `${s(table?.name) || tableId} has no one assigned to it.`;
      } else if (waitMinutes >= limit) {
        escalate = true;
        reason = `Waiting ${waitMinutes} min.`;
      }

      return {
        requestId: r.id,
        tableId,
        tableName: s(table?.name) || (tableId || ''),
        ownerIds,
        waitMinutes,
        escalate,
        reason,
      };
    })
    .sort((a, b) => Number(b.escalate) - Number(a.escalate) || b.waitMinutes - a.waitMinutes);
}

/** One line for the host screen: what is actually wrong right now. */
export function floorAlerts(
  state: SeatingState,
  routed: Routed[],
  vocabulary?: Partial<Vocabulary>,
): string[] {
  const V = resolveVocabulary(vocabulary);
  const out: string[] = [];
  const unowned = routed.filter((r) => r.escalate && r.ownerIds.length === 0 && r.tableId).length;
  const detached = routed.filter((r) => !r.tableId).length;
  const slow = routed.filter((r) => r.escalate && r.ownerIds.length > 0).length;
  const over = state.tables.filter((t) => t.overfilled);

  if (detached > 0) out.push(`${detached} ${plural(detached, 'request', 'requests')} not attached to any ${V.unit}.`);
  if (unowned > 0) out.push(`${unowned} ${plural(unowned, 'request', 'requests')} at ${V.units} with nobody assigned.`);
  if (slow > 0) out.push(`${slow} ${plural(slow, 'request', 'requests')} past the wait limit.`);
  if (over.length > 0) out.push(`${over.length} ${plural(over.length, V.unit, V.units)} seated over capacity: ${over.map((t) => t.name).join(', ')}.`);
  if (state.ambiguous.length > 0) out.push(`${state.ambiguous.length} ${plural(state.ambiguous.length, V.person, V.people)} at a duplicated ${V.unit} name.`);
  if (state.fragile.length > 0) out.push(`${state.fragile.length} ${plural(state.fragile.length, V.person, V.people)} matched by ${V.unit} name — renaming that ${V.unit} would unseat them.`);
  return out;
}
