
l// ─── src/lib/fulfilment-access.ts ─────────────────────────────────────────────
// Who may do what on the fulfilment board, and how a person's work is measured.
//
// Both halves live together on purpose: the same actor stamp that authorises
// an action is the one that later counts it. Nothing here reads the network —
// permissions come from the staff record you already have, and every metric is
// derived from events the engine already writes. That means no new data model,
// no drift, and both the staff portal and the manager dashboard can share this
// file rather than each inventing their own rules.
//
// Bottlenecks this is designed to prevent, before they happen:
//   • Money by accident — buying or voiding a label and issuing refunds are
//     spending decisions, so they sit behind their own permission rather than
//     "is logged in".
//   • Queue hoarding — a claim limit stops one person holding six batches
//     while everyone else waits.
//   • Speed theatre — every speed metric is paired with an accuracy metric, so
//     nobody can look good by picking fast and wrong.
//   • Shared devices — work is attributed to a person, not to whoever opened
//     the iPad this morning.

export type StaffRole = 'owner' | 'admin' | 'staff' | 'renter' | string;

/** What a person is allowed to do with orders. */
export interface FulfilmentPermissions {
  canPick: boolean;        // claim a batch, scan items, short a line
  canPack: boolean;        // mark packed / ready, hand off to a customer
  canShip: boolean;        // buy and void carrier labels (spends money)
  canManage: boolean;      // cancel orders, mark refunded, change settings
  canSeeTeam: boolean;     // see other people's numbers, not just their own
  claimLimit: number;      // how many batches one person may hold at once
}

const PRESETS: Record<string, FulfilmentPermissions> = {
  manager: { canPick: true, canPack: true, canShip: true, canManage: true, canSeeTeam: true, claimLimit: 4 },
  shipper: { canPick: true, canPack: true, canShip: true, canManage: false, canSeeTeam: false, claimLimit: 3 },
  packer:  { canPick: true, canPack: true, canShip: false, canManage: false, canSeeTeam: false, claimLimit: 2 },
  picker:  { canPick: true, canPack: false, canShip: false, canManage: false, canSeeTeam: false, claimLimit: 2 },
  none:    { canPick: false, canPack: false, canShip: false, canManage: false, canSeeTeam: false, claimLimit: 0 },
};

export const FULFILMENT_ROLES = ['picker', 'packer', 'shipper', 'manager', 'none'] as const;
export type FulfilmentRole = (typeof FULFILMENT_ROLES)[number];

/**
 * A staff member's fulfilment permissions.
 *
 * `staff.fulfilmentRole` wins when set — that is the explicit assignment a
 * manager makes. Otherwise it falls back to the business role, so an existing
 * team keeps working the moment this ships: owners and admins manage, staff
 * pack, renters (who sell their own retail) pick and pack their own work.
 */
export function permissionsFor(staff: { role?: StaffRole; fulfilmentRole?: string } | null | undefined): FulfilmentPermissions {
  if (!staff) return PRESETS.none;

  const explicit = String(staff.fulfilmentRole || '').toLowerCase();
  if (explicit && PRESETS[explicit]) return PRESETS[explicit];

  switch (String(staff.role || '').toLowerCase()) {
    case 'owner':
    case 'admin':
      return PRESETS.manager;
    case 'staff':
      return PRESETS.packer;
    case 'renter':
      return PRESETS.packer;
    default:
      return PRESETS.picker;
  }
}

/** Plain-language description, for the settings screen where roles are set. */
export function describeRole(role: FulfilmentRole): string {
  switch (role) {
    case 'manager': return 'Everything — including cancelling orders and refunds';
    case 'shipper': return 'Pick, pack and buy shipping labels';
    case 'packer':  return 'Pick, pack and hand orders to customers';
    case 'picker':  return 'Claim and scan items only';
    default:        return 'No fulfilment access';
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * KPIs
 * ════════════════════════════════════════════════════════════════════════════
 * Derived from order event history: every claim, scan, short, pack, ready and
 * handoff already carries actorId, actorName and a timestamp.
 */

export interface OrderEventLike {
  type: string;
  at: string;
  actorId?: string;
  actorName?: string;
  meta?: Record<string, any>;
}

export interface OrderLike {
  id: string;
  orderNumber?: number;
  stage?: string;
  method?: string;
  placedAt?: string;
  paidAt?: string;
  readyAt?: string;
  events?: OrderEventLike[];
  dueAtMs?: number;   // supplied by the caller from the SLA engine
  lines?: { qtyOrdered?: number; qtyShorted?: number }[];
}

export interface StaffKpis {
  actorId: string;
  name: string;
  ordersPicked: number;
  itemsPicked: number;
  medianMinutes: number | null;  // claim → ready, median resists one bad day
  onTimeRate: number | null;     // % finished before the promise
  accuracy: number | null;       // % of scans that matched first time
  shortsRaised: number;
  reopens: number;
  abandonedClaims: number;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 100) : null;

/**
 * Per-person fulfilment numbers.
 *
 * Deliberate choices: MEDIAN not mean, because one interrupted order should
 * not define a shift; accuracy sits beside speed so the pair must be read
 * together; and shorts are counted without judgement — a high number often
 * means someone is surfacing stock problems everyone else walked past.
 */
export function staffKpis(orders: OrderLike[], now: number = Date.now()): StaffKpis[] {
  const byActor = new Map<string, StaffKpis & { durations: number[]; onTime: number; finished: number; scans: number; mismatches: number }>();

  const ensure = (id: string, name: string) => {
    let row = byActor.get(id);
    if (!row) {
      row = {
        actorId: id, name, ordersPicked: 0, itemsPicked: 0, medianMinutes: null,
        onTimeRate: null, accuracy: null, shortsRaised: 0, reopens: 0, abandonedClaims: 0,
        durations: [], onTime: 0, finished: 0, scans: 0, mismatches: 0,
      };
      byActor.set(id, row);
    }
    return row;
  };

  for (const order of orders) {
    const events = [...(order.events || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const claim = events.find((e) => e.type === 'batch_claimed');
    const done = events.find((e) => ['marked_ready', 'ready', 'packed', 'handed_off', 'shipped'].includes(e.type));

    for (const e of events) {
      const id = String(e.actorId || '');
      if (!id || id === 'system' || id === 'shippo' || id === 'customer') continue;
      const row = ensure(id, String(e.actorName || 'Staff'));

      if (e.type === 'item_scanned') { row.scans += 1; row.itemsPicked += Number(e.meta?.qty ?? 1) || 1; }
      if (e.type === 'scan_mismatch') { row.scans += 1; row.mismatches += 1; }
      if (e.type === 'line_shorted') row.shortsRaised += 1;
      if (e.type === 'line_reopened') row.reopens += 1;
      if (e.type === 'batch_auto_released') row.abandonedClaims += 1;
    }

    if (claim?.actorId && done) {
      const row = ensure(String(claim.actorId), String(claim.actorName || 'Staff'));
      row.ordersPicked += 1;
      row.finished += 1;
      const started = Date.parse(claim.at);
      const finished = Date.parse(done.at);
      if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
        row.durations.push(Math.round((finished - started) / 60_000));
      }
      if (order.dueAtMs && Number.isFinite(finished) && finished <= order.dueAtMs) row.onTime += 1;
    }
  }

  return [...byActor.values()]
    .map((r) => ({
      actorId: r.actorId,
      name: r.name,
      ordersPicked: r.ordersPicked,
      itemsPicked: r.itemsPicked,
      medianMinutes: median(r.durations),
      onTimeRate: pct(r.onTime, r.finished),
      accuracy: r.scans > 0 ? pct(r.scans - r.mismatches, r.scans) : null,
      shortsRaised: r.shortsRaised,
      reopens: r.reopens,
      abandonedClaims: r.abandonedClaims,
    }))
    .sort((a, b) => b.ordersPicked - a.ordersPicked || b.itemsPicked - a.itemsPicked);
}

/** Shop-wide view for the same period — the denominator for everything above. */
export function teamKpis(rows: StaffKpis[]) {
  const orders = rows.reduce((a, r) => a + r.ordersPicked, 0);
  const items = rows.reduce((a, r) => a + r.itemsPicked, 0);
  const timed = rows.filter((r) => r.medianMinutes !== null);
  const onTime = rows.filter((r) => r.onTimeRate !== null);
  const acc = rows.filter((r) => r.accuracy !== null);
  return {
    people: rows.length,
    orders,
    items,
    medianMinutes: median(timed.map((r) => r.medianMinutes as number)),
    onTimeRate: onTime.length
      ? Math.round(onTime.reduce((a, r) => a + (r.onTimeRate as number), 0) / onTime.length)
      : null,
    accuracy: acc.length
      ? Math.round(acc.reduce((a, r) => a + (r.accuracy as number), 0) / acc.length)
      : null,
  };
}
