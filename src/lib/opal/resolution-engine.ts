/**
 * src/lib/opal/resolution-engine.ts
 *
 * PHASE 0 — the unified substrate every disruption workflow routes through.
 *
 * This is an EXTRACTION, not a rewrite. It renames and unifies patterns that
 * already exist in the codebase rather than introducing a parallel system:
 *
 *   PRD concept            →  what you already have
 *   ─────────────────────────────────────────────────────────────────────
 *   Resolution Ticket      →  cancellationEvents + cancellationAudit
 *   Behavior Ledger        →  cancellationAudit.actorType, cancellationCount,
 *                             rescheduleCount, no-show flags (scattered today)
 *   Financial ledger       →  transactions + depositCredits + unpaidFees
 *   Policy snapshot         →  cancellationAudit.feeOverridden / suggestedFeeAmount
 *   Recommendation-first    →  the cancel dialog's editable suggested fee
 *   Recovery Ticket         →  NET-NEW (the one genuinely new entity)
 *   Rebooking Ticket        →  reschedule dialog + cadence fields (seed only)
 *
 * Conventions kept consistent with the rest of the app:
 *   - Money is integer cents. Never floats for balances.
 *   - Dates are ISO strings. Never Firestore Timestamps.
 *   - Append-only ledgers: a balance/score is the SUM/READ of entries,
 *     never a mutable stored field.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SHARED PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

export type ISODate = string;   // e.g. '2026-06-22T14:30:00.000Z'
export type Cents = number;     // integer cents
export type ID = string;

/**
 * SOLO-COLLAPSE RULE (the sixth invariant).
 * Every location/role concept must define its n=1 form. locationId is always
 * present in the data model so nothing needs migrating when a second location
 * appears — but when a tenant has exactly one location, the UI hides the
 * switcher entirely and 'requires_approval' becomes an inline owner flag, not
 * a routed queue. Encode that collapse here so it is a property of the model,
 * not something each screen reinvents.
 */
export const isSoloTenant = (locationCount: number): boolean => locationCount <= 1;

// ─────────────────────────────────────────────────────────────────────────────
// RELIABILITY (computed at read time — never stored)
// ─────────────────────────────────────────────────────────────────────────────

export type ReliabilityBand =
  | 'flexible'
  | 'standard'
  | 'requires_deposit'
  | 'requires_approval';

/**
 * COLD-START POSTURE (the gap the PRD doesn't name).
 * A brand-new tenant or a thin-history client has no behavioral data. The band
 * system must NOT over-penalize on tiny samples, and must NOT silently do
 * nothing. Below a minimum sample size we return the tenant's configured
 * default trust band (typically 'standard') and mark it low-confidence, so the
 * UI can show "new client" rather than implying a judgment was made.
 */
export const RELIABILITY_MIN_SAMPLE = 3;

export interface ReliabilityResult {
  band: ReliabilityBand;
  confidence: 'low' | 'medium' | 'high';
  sampleSize: number;
  isColdStart: boolean;          // true when below RELIABILITY_MIN_SAMPLE
  computedAt: ISODate;
}

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR LEDGER  (append-only)   tenants/{tenantId}/behaviorLedger
// ─────────────────────────────────────────────────────────────────────────────

export type BehaviorEventType =
  | 'no_show'
  | 'late_cancel'
  | 'reschedule'
  | 'late_arrival'
  | 'dispute'
  | 'reschedule_flow_abandoned'   // logged for visibility, NEVER docks score alone
  | 'completed';                  // positive signal — reliability can recover

/**
 * One row per behavioral event. NEVER updated or deleted. Reliability, cadence,
 * and dispute-evidence packages are all computed by READING this table.
 *
 * weightContext is applied at READ time (3.4), not baked into the event — e.g.
 * a no-show on a recovery-ticket fill is weighed leniently because the client
 * was doing the business a favor by claiming a last-minute opening.
 */
export interface BehaviorEvent {
  id: ID;
  tenantId: ID;
  clientId: ID;
  eventType: BehaviorEventType;
  weightContext: 'normal' | 'recovery_fill' | 'cascaded_reschedule' | 'business_initiated';
  locationId: ID | null;          // for reporting only — NEVER scopes the score
  resolutionTicketId: ID | null;  // link back to the originating ticket
  timestamp: ISODate;             // used for decay-weighted scoring
}

/**
 * Default per-event weights and decay. These are a STARTING POINT to tune
 * against real data (the PRD's highest-trust-risk warning). A no-show weighs
 * more than a reschedule; a late arrival less than either. Positive events
 * (completed visits) let a reformed client recover instead of being flagged
 * forever.
 */
export const BEHAVIOR_WEIGHTS: Record<BehaviorEventType, number> = {
  no_show: 3.0,
  late_cancel: 1.5,
  reschedule: 0.75,
  late_arrival: 0.5,
  dispute: 1.0,
  reschedule_flow_abandoned: 0,   // visibility only
  completed: -0.5,                // recovery toward 'flexible'
};

export const WEIGHT_CONTEXT_MULTIPLIER: Record<BehaviorEvent['weightContext'], number> = {
  normal: 1.0,
  recovery_fill: 0.25,            // leniency: claimed a favor slot then no-showed
  cascaded_reschedule: 0.0,       // a cascade counts once, via the FIRST event
  business_initiated: 0.0,        // provider illness/closure is never the client's fault
};

export const RELIABILITY_DECAY_HALF_LIFE_DAYS = 120; // events lose half their weight every ~4mo

export const BAND_THRESHOLDS = {
  flexibleMax: 1.0,        // weighted score ≤ this → flexible
  standardMax: 3.0,        // ≤ this → standard
  requiresDepositMax: 6.0, // ≤ this → requires_deposit; above → requires_approval
};

/**
 * Reference implementation — pure, decay-weighted, read-time. Deliberately
 * simple and tunable; the point is the SHAPE (decay + per-type weight + context
 * multiplier + cold-start), not these exact numbers.
 */
export function computeReliabilityBand(
  events: BehaviorEvent[],
  now: ISODate,
  defaultBand: ReliabilityBand = 'standard',
): ReliabilityResult {
  const negativeEvents = events.filter(e => BEHAVIOR_WEIGHTS[e.eventType] > 0);
  const sampleSize = negativeEvents.length + events.filter(e => e.eventType === 'completed').length;

  if (negativeEvents.length < RELIABILITY_MIN_SAMPLE) {
    return { band: defaultBand, confidence: 'low', sampleSize, isColdStart: true, computedAt: now };
  }

  const nowMs = new Date(now).getTime();
  const halfLifeMs = RELIABILITY_DECAY_HALF_LIFE_DAYS * 86400000;

  let score = 0;
  for (const e of events) {
    const base = BEHAVIOR_WEIGHTS[e.eventType] ?? 0;
    if (base === 0) continue;
    const ctx = WEIGHT_CONTEXT_MULTIPLIER[e.weightContext] ?? 1;
    const ageMs = Math.max(0, nowMs - new Date(e.timestamp).getTime());
    const decay = Math.pow(0.5, ageMs / halfLifeMs);
    score += base * ctx * decay;
  }
  score = Math.max(0, score);

  let band: ReliabilityBand;
  if (score <= BAND_THRESHOLDS.flexibleMax) band = 'flexible';
  else if (score <= BAND_THRESHOLDS.standardMax) band = 'standard';
  else if (score <= BAND_THRESHOLDS.requiresDepositMax) band = 'requires_deposit';
  else band = 'requires_approval';

  const confidence = sampleSize >= 8 ? 'high' : sampleSize >= 5 ? 'medium' : 'low';
  return { band, confidence, sampleSize, isColdStart: false, computedAt: now };
}

// ─────────────────────────────────────────────────────────────────────────────
// POLICY  (location-aware, all-or-nothing override)   tenants/{tenantId}/policyRules
// ─────────────────────────────────────────────────────────────────────────────

export type PolicyRuleType =
  | 'cutoff_window_hours'
  | 'fee_amount_cents'
  | 'max_reschedules'
  | 'deposit_requirement_cents'
  | 'approval_threshold'
  | 'grace_period_minutes'        // no-show grace
  | 'reschedule_fee_cents'
  | 'reschedule_fee_window_hours';

export interface PolicyRule {
  id: ID;
  tenantId: ID;
  scope: 'business' | 'location';
  ruleType: PolicyRuleType;
  value: number;
  locationId: ID | null;          // null when scope === 'business'
}

/**
 * Resolution order: a location-level rule for a given ruleType FULLY overrides
 * the business default — never partially. Partial blending is where these
 * systems become unpredictable. NOTE: this resolves POLICY only. The behavior
 * ledger and reliability band are NEVER location-overridable (9.4 non-negotiable
 * — a location can set its own fee, it cannot ignore a client's global history).
 */
export function resolvePolicy(
  rules: PolicyRule[],
  ruleType: PolicyRuleType,
  locationId: ID | null,
  businessDefault: number,
): number {
  if (locationId) {
    const loc = rules.find(r => r.scope === 'location' && r.ruleType === ruleType && r.locationId === locationId);
    if (loc) return loc.value;
  }
  const biz = rules.find(r => r.scope === 'business' && r.ruleType === ruleType);
  return biz ? biz.value : businessDefault;
}

// ─────────────────────────────────────────────────────────────────────────────
// APPOINTMENT (lineage extensions)
// ─────────────────────────────────────────────────────────────────────────────

export type AppointmentStatus =
  | 'booked'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'rescheduled'   // terminal-for-this-instance
  | 'cancelled'     // terminal-for-this-instance
  | 'no_show';      // terminal-for-this-instance

/**
 * LINEAGE DESIGN FORK — read this before building reschedule.
 *
 * Your current reschedule MOVES the same appointment row (rescheduledFromTime +
 * rescheduleCount on the same doc). The PRD instead SPAWNS A NEW ROW and marks
 * the old one 'rescheduled' (rescheduledFromId points back). The new-row model
 * is what makes the ledger and KPIs clean: every appointment instance has one
 * immutable history, and "this client rescheduled 4 times" is 4 linked rows you
 * can replay, not a counter you have to trust.
 *
 * The unified engine adopts the spawn-new-row model. This supersedes move-in-
 * place. Migration is non-destructive: existing moved appointments keep their
 * rescheduledFromTime; new reschedules create linked rows going forward.
 */
export interface AppointmentLineage {
  status: AppointmentStatus;
  rescheduledFromId: ID | null;   // set on the NEW row created by a reschedule
  packageId: ID | null;           // links sibling appts in a multi-step package
  groupBookingId: ID | null;      // links co-occurring multi-client appts
  resourceIds: ID[];              // rooms/chairs/equipment — checked in conflict pass
}

// ─────────────────────────────────────────────────────────────────────────────
// TICKETS — one collection, discriminated by `kind`   tenants/{tenantId}/tickets
//
// One collection (not four) so the OCC unified queue is a single query with a
// `kind` filter, exactly as the dashboard spec requires. The shared base is
// what lets a Guest Experience ticket link cleanly to the Resolution ticket
// that caused it.
// ─────────────────────────────────────────────────────────────────────────────

export type TicketKind = 'resolution' | 'recovery' | 'rebooking' | 'guest_experience';

export interface BaseTicket {
  id: ID;
  tenantId: ID;
  kind: TicketKind;
  locationId: ID | null;
  clientId: ID | null;
  /**
   * The engine's recommended action, captured so the OCC can show it FIRST and
   * staff confirm/override rather than deciding from scratch.
   */
  recommendation: string;
  resolvedBy: 'engine' | { staffId: ID; override: boolean } | null;
  /**
   * Policy as it existed at this moment — required for accurate historical
   * disputes since policy values change over time. This is the generalization
   * of cancellationAudit.suggestedFeeAmount/feeOverridden you already store.
   */
  policySnapshot: Record<string, number>;
  createdAt: ISODate;
  resolvedAt: ISODate | null;
}

// ===== RESOLUTION TICKET — reschedule / cancel / no-show / provider absence =====
// Generalizes cancellationEvents + cancellationAudit.

export type ResolutionTrigger = 'client' | 'provider' | 'business' | 'automated';

export type ResolutionReason =
  // reschedule
  | 'client_reschedule'
  | 'provider_reschedule'
  // cancel
  | 'client_cancel'
  | 'business_cancel'
  // no-show (always automated, time-based)
  | 'no_show'
  // operational
  | 'late_arrival'
  | 'provider_absence'
  | 'double_booking'
  | 'inventory_shortfall';

export type ResolutionDecision = 'allow' | 'fee' | 'deny' | 'escalate';

export interface ResolutionTicket extends BaseTicket {
  kind: 'resolution';
  appointmentId: ID;
  triggerType: ResolutionTrigger;
  triggerReason: ResolutionReason;
  initiatedByUserId: ID | null;   // null if system-automated (no-show)
  decision: ResolutionDecision;
  /**
   * Signed cents + the ids of the transaction ledger rows it produced. This is
   * how a ticket links into your existing `transactions` collection rather than
   * duplicating money state. Positive = charged to client, negative = refund.
   */
  financialDeltaCents: Cents;
  financialTxnIds: ID[];
  /**
   * Set only when this resolution VACATED a slot (confirmed reschedule, confirmed
   * cancel, or expired no-show). Drives Recovery Ticket creation.
   */
  recoveryTicketId: ID | null;
  /** What was decided about the deposit — generalizes your depositCredits disposition. */
  depositDisposition: 'moved' | 'refunded' | 'converted_to_credit' | 'forfeited' | 'none';
}

// ===== RESCHEDULE specifics =====
// A reschedule is a Resolution ticket (reason: client_reschedule). Non-mutation
// until confirmation: viewing suggested times and the fee preview are stateless.
// On CONFIRM only: spawn new appointment row (rescheduledFromId), old row →
// 'rescheduled', deposit moves (depositDisposition 'moved' — no Stripe round
// trip), and a Recovery Ticket fires for the vacated time with zero gap.

export const RESCHEDULE_FLOW = {
  /** Fee-preview must offer three options, not two — the dignified exit matters. */
  feePreviewOptions: ['confirm_and_pay', 'choose_different_time', 'keep_original'] as const,
  /** Lead with ranked suggestions, not a calendar grid. */
  suggestedSlotCount: 4,
} as const;

// ===== NO-SHOW specifics =====
// Structurally different: no client flow to abandon, trigger is purely time-based.
// At grace-period expiry a Resolution ticket auto-creates (triggerType
// 'automated', initiatedByUserId null) AND a Recovery ticket spawns, since the
// slot is now genuinely dead. Leniency: if the no-showed appointment was itself
// a recovery fill, the behavior event carries weightContext 'recovery_fill'.

export const NO_SHOW_DEFAULTS = {
  gracePeriodMinutes: 12,         // absorbs ordinary lateness without a manual call
  reminderCadenceHours: [72, 24, 2] as const,
} as const;

// ===== RECOVERY TICKET — NET-NEW =====   the vacated-slot pipeline

export type RecoveryStatus =
  | 'vacant'
  | 'tier1_active'
  | 'tier2_active'
  | 'tier3_active'
  | 'tier4_active'
  | 'filled'
  | 'partial_filled'
  | 'expired';

export type RecoveryTier = 1 | 2 | 3 | 4;

export interface RecoveryTicket extends BaseTicket {
  kind: 'recovery';
  sourceResolutionTicketId: ID;   // linked to, but scored independently from
  providerId: ID;
  resourceIds: ID[];
  originalServiceId: ID;
  originalDurationMinutes: number;
  vacatedAt: ISODate;
  slotStart: ISODate;
  slotEnd: ISODate;
  recoverability: 'low' | 'medium' | 'high';  // time-until-slot drives tier strategy
  status: RecoveryStatus;
  currentTier: RecoveryTier | null;
  tierStartedAt: ISODate | null;
  tierTimeboxMinutes: number | null;
  claimantClientId: ID | null;    // a DISTINCT behavioral entity from the original
  fillType: 'exact_match' | 'service_duration_mismatch' | 'partial_fill' | null;
  outcomeValueCents: Cents | null; // revenue delta vs. the original appointment
  linkedNewAppointmentId: ID | null;
  bulkBatchId: ID | null;         // set when part of a BulkRecoveryBatch
}

/** Tier timeboxes shrink for near-term slots, lengthen for far-out ones. */
export const RECOVERY_TIER_TIMEBOX_MINUTES = {
  under4h: { tier1: 20, tier2: 20, tier3: 20, tier4: 0 },
  sameWeek: { tier1: 120, tier2: 240, tier3: 480, tier4: 0 },
  weeksOut: { tier1: 0, tier2: 0, tier3: 0, tier4: 0 }, // just reopen public booking
} as const;

export interface RecoveryOutreach {   // append-only, one row per tier attempt
  id: ID;
  recoveryTicketId: ID;
  tier: RecoveryTier;
  channel: 'waitlist' | 'favorites' | 'push' | 'public_booking';
  sentAt: ISODate;
  recipientCount: number;
  responseCount: number;
  claimed: boolean;
}

// ===== REBOOKING TICKET — post-appointment + win-back =====

export type RebookingTrigger = 'post_appointment' | 'win_back';

export type LapseReason =
  | 'declined_post_appointment'
  | 'cancelled_no_rebook'
  | 'no_show'
  | 'quiet_dormancy'
  | null;

export interface RebookingTicket extends BaseTicket {
  kind: 'rebooking';
  triggerType: RebookingTrigger;
  sourceAppointmentId: ID;
  lapseReason: LapseReason;       // win_back only
  suggestedProviderId: ID | null;
  suggestedLocationId: ID | null;
  suggestedSlot: ISODate | null;
  suggestedServiceId: ID | null;
  outcome: 'booked' | 'declined' | 'ignored' | 'expired' | null;
  linkedNewAppointmentId: ID | null;
}

/** Lapse lifecycle is days_since_last ÷ learned cadence — see ClientServiceCadence. */
export type LapseState = 'active' | 'due' | 'lapsing' | 'lapsed' | 'dormant';

export function classifyLapse(daysSinceLast: number, learnedCadenceDays: number): LapseState {
  if (learnedCadenceDays <= 0) return 'active';
  const ratio = daysSinceLast / learnedCadenceDays;
  if (daysSinceLast >= 180) return 'dormant';
  if (ratio < 1.0) return 'active';
  if (ratio < 1.5) return 'due';
  if (ratio < 3.0) return 'lapsing';
  return 'lapsed';
}

// ===== CADENCE (derived, recomputed — never authoritative) =====
//   tenants/{tenantId}/clientServiceCadence/{clientId_serviceId}

export interface ClientServiceCadence {
  clientId: ID;
  serviceId: ID;
  locationId: ID | null;
  learnedIntervalDays: number;    // MEDIAN of last 3-4 intervals (not mean)
  confidence: 'low' | 'medium' | 'high';
  sampleSize: number;
  lastComputedAt: ISODate;
}

export const CADENCE_MIN_SAMPLE = 3; // fewer → fall back to the service default

/** Median, not average — one outlier (a vacation) shouldn't skew a steady client. */
export function computeCadenceDays(intervalDaysSorted: number[], serviceDefault: number): { days: number; confidence: 'low' | 'medium' | 'high' } {
  if (intervalDaysSorted.length < CADENCE_MIN_SAMPLE) return { days: serviceDefault, confidence: 'low' };
  const mid = Math.floor(intervalDaysSorted.length / 2);
  const median = intervalDaysSorted.length % 2 === 0
    ? (intervalDaysSorted[mid - 1] + intervalDaysSorted[mid]) / 2
    : intervalDaysSorted[mid];
  const spread = intervalDaysSorted[intervalDaysSorted.length - 1] - intervalDaysSorted[0];
  // Wide spread → widen the 'due' window / downgrade to a passive nudge.
  const confidence = spread > median ? 'low' : intervalDaysSorted.length >= 4 ? 'high' : 'medium';
  return { days: Math.round(median), confidence };
}

// ===== GUEST EXPERIENCE TICKET (Phase 3 — included for completeness) =====

export interface GuestExperienceTicket extends BaseTicket {
  kind: 'guest_experience';
  relatedAppointmentId: ID | null;
  category: 'service_quality' | 'billing_dispute' | 'staff_conduct' | 'product_issue' | 'scheduling_frustration' | 'other';
  severity: 'low' | 'medium' | 'high' | 'urgent';   // urgent escalates immediately
  channel: 'phone' | 'chat' | 'email' | 'in_person' | 'social';
  status: 'open' | 'in_progress' | 'pending_client' | 'resolved' | 'escalated';
  assignedTo: ID | null;
  resolutionAction: 'complimentary_redo' | 'partial_refund' | 'store_credit' | 'manager_followup' | 'apology_only' | 'escalated_to_owner' | null;
  resolutionValueCents: Cents | null;
  linkedResolutionTicketIds: ID[];   // reference, never duplicate
}

export type Ticket = ResolutionTicket | RecoveryTicket | RebookingTicket | GuestExperienceTicket;

// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE COLLECTION PATHS (single source of truth for the engine)
// ─────────────────────────────────────────────────────────────────────────────

export const COLLECTIONS = {
  tickets: (tenantId: ID) => `tenants/${tenantId}/tickets`,
  behaviorLedger: (tenantId: ID) => `tenants/${tenantId}/behaviorLedger`,
  recoveryOutreach: (tenantId: ID) => `tenants/${tenantId}/recoveryOutreach`,
  cadence: (tenantId: ID) => `tenants/${tenantId}/clientServiceCadence`,
  policyRules: (tenantId: ID) => `tenants/${tenantId}/policyRules`,
  // EXISTING — reused as-is, not replaced:
  transactions: (tenantId: ID) => `tenants/${tenantId}/transactions`,
  depositCredits: (tenantId: ID) => `tenants/${tenantId}/depositCredits`,
} as const;
