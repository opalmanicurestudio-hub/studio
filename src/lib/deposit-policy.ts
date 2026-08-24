// ─────────────────────────────────────────────────────────────────────────────
// deposit-policy.ts — the rules engine for deposit outcomes
//
// Pure TypeScript. ZERO runtime imports (no Firebase, no date-fns), so it is
// safe to call from client pages (Web SDK) AND server routes (Admin SDK), the
// same way ledger.ts is.
//
// Given a tenant's policy + the timing of a cancellation (or a no-show), it
// decides ONE outcome:
//   • 'refund'   → money returns to the client (Stripe refund + ledger reversal)
//   • 'rollover' → credit stays on the client and auto-applies to their NEXT visit
//   • 'forfeit'  → studio keeps the deposit; income already recognized stays
//
// The whole point: the owner sets the rule once, and every cancellation resolves
// itself consistently — no case-by-case decisions, no inconsistency between
// clients. The UI still offers a one-tap override for the rare exception, and a
// reason string is returned for the audit trail.
// ─────────────────────────────────────────────────────────────────────────────

export type DepositOutcome = 'refund' | 'rollover' | 'forfeit';

// What initiated the close-out of the appointment.
export type CancelTrigger = 'client_cancel' | 'no_show' | 'studio_cancel';

export interface DepositPolicy {
  // Cancellations made at least this many hours before the start time are treated
  // as "early" (good faith). Inside the window counts as "late".
  refundWindowHours: number;
  // Outcome when the client cancels EARLY (>= refundWindowHours before start).
  onEarlyCancel: DepositOutcome;
  // Outcome when the client cancels LATE (< refundWindowHours before start).
  onLateCancel: DepositOutcome;
  // Outcome when the client simply does not show.
  onNoShow: DepositOutcome;
  // Outcome when the STUDIO cancels (almost always a refund — not the client's fault).
  onStudioCancel: DepositOutcome;
  // How long a rolled-over credit stays usable. null = never expires.
  rolloverExpiryDays: number | null;
}

// Sensible defaults: keep the money in the business when possible, only refund
// when the studio is at fault, and let good-faith early cancels roll forward.
export const DEFAULT_DEPOSIT_POLICY: DepositPolicy = {
  refundWindowHours: 48,
  onEarlyCancel:     'rollover',
  onLateCancel:      'forfeit',
  onNoShow:          'forfeit',
  onStudioCancel:    'refund',
  rolloverExpiryDays: 90,
};

// Merge a tenant's saved policy over the defaults so missing fields are always
// filled. Works before any settings UI exists — the defaults simply apply.
export function resolveDepositPolicy(tenant: any): DepositPolicy {
  const p = (tenant && tenant.depositPolicy) || {};
  return {
    refundWindowHours:  numOr(p.refundWindowHours, DEFAULT_DEPOSIT_POLICY.refundWindowHours),
    onEarlyCancel:      outcomeOr(p.onEarlyCancel, DEFAULT_DEPOSIT_POLICY.onEarlyCancel),
    onLateCancel:       outcomeOr(p.onLateCancel,  DEFAULT_DEPOSIT_POLICY.onLateCancel),
    onNoShow:           outcomeOr(p.onNoShow,      DEFAULT_DEPOSIT_POLICY.onNoShow),
    onStudioCancel:     outcomeOr(p.onStudioCancel,DEFAULT_DEPOSIT_POLICY.onStudioCancel),
    rolloverExpiryDays: p.rolloverExpiryDays === null
      ? null
      : numOr(p.rolloverExpiryDays, DEFAULT_DEPOSIT_POLICY.rolloverExpiryDays ?? 90),
  };
}

export interface ResolveInput {
  trigger: CancelTrigger;
  // Hours from "now" until the appointment start. Negative = already past.
  hoursUntilStart: number;
  policy: DepositPolicy;
}

export interface ResolvedOutcome {
  outcome: DepositOutcome;
  withinWindow: boolean;   // true when a client cancel landed inside the late window
  reason: string;          // human-readable, stored on the audit record + shown in UI
  movesCash: boolean;      // true only for 'refund' — the one outcome needing confirmation
}

// The core decision. Pure and deterministic.
export function resolveDepositOutcome(input: ResolveInput): ResolvedOutcome {
  const { trigger, hoursUntilStart, policy } = input;

  if (trigger === 'studio_cancel') {
    return finalize(policy.onStudioCancel, false, 'Studio-initiated cancellation');
  }
  if (trigger === 'no_show') {
    return finalize(policy.onNoShow, false, 'Client did not show');
  }

  // client_cancel — compare against the window
  const withinWindow = hoursUntilStart < policy.refundWindowHours;
  if (withinWindow) {
    const when = hoursUntilStart < 0
      ? 'Cancelled after the appointment time'
      : `Cancelled within ${policy.refundWindowHours}h of start`;
    return finalize(policy.onLateCancel, true, when);
  }
  return finalize(policy.onEarlyCancel, false, `Cancelled ${policy.refundWindowHours}h+ before start`);
}

// Compute hours from now until an appointment start (accepts ISO string, Date,
// or Firestore-like {seconds}). Negative when the start is in the past.
export function hoursUntilStart(startTime: any, now: Date = new Date()): number {
  const start = toDate(startTime);
  return (start.getTime() - now.getTime()) / 3_600_000;
}

// When a rolled-over credit should stop being usable. null = never.
export function rolloverExpiryISO(policy: DepositPolicy, from: Date = new Date()): string | null {
  if (policy.rolloverExpiryDays == null) return null;
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + policy.rolloverExpiryDays);
  return d.toISOString();
}

// True when a credit's expiry has passed (so checkout should ignore it).
export function isCreditExpired(expiresAt: any, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return toDate(expiresAt).getTime() < now.getTime();
}

// ─── Deposit AMOUNT calculation ───────────────────────────────────────────────
// Single source of truth for "how big is the deposit" — mirrors the booking
// sheet's logic so the phone-booking link and the online flow never disagree.
// Returns integer CENTS. `depositsLive` gates the whole feature off when false.
export interface DepositAmountInput {
  /** Needed for true-breakeven pricing (the chair-hour floor). Optional so
   *  every existing caller keeps working unchanged. */
  tenant?: any;
  staff?: any;
  service: any;          // expects depositType / depositSubType / depositAmount / price / cost
  price: number;         // resolved service price (tier/staff applied), in dollars
  depositsLive: boolean; // tenant.depositsLive === true
  poorHistory?: boolean; // client has a weak no-show/cancel record (guardian surcharge)
  guardianActive?: boolean;
}

export function computeDepositCents(input: DepositAmountInput): number {
  const { service, price, depositsLive } = input;
  if (!depositsLive || !service) return 0;
  const guardianActive = input.guardianActive !== false;
  const poorHistory = !!input.poorHistory;

  const type = service.depositType;
  if (type === 'none' && (!poorHistory || !guardianActive)) return 0;
  if (guardianActive && poorHistory && type === 'none') return Math.round(Math.ceil(price * 0.5) * 100);
  if (type === 'full')      return Math.round((price || 0) * 100);
  /* Product cost only. The FULL breakeven — TMHR time + materials + burdened
   * labour — already exists per service as the "matrix basis" used by the
   * cancellation engine, and is tier-aware in a way this call site is not.
   * A second implementation here would drift from it. */
  if (type === 'breakeven') return Math.round((service.cost || 0) * 100);

  if (type === 'deposit') {
    if (service.depositSubType === 'percentage') return Math.round(price * ((service.depositAmount || 0) / 100) * 100);
    return Math.round((service.depositAmount || 0) * 100);
  }
  return 0;
}

// ─── internals ───────────────────────────────────────────────────────────────
function finalize(outcome: DepositOutcome, withinWindow: boolean, reason: string): ResolvedOutcome {
  return { outcome, withinWindow, reason, movesCash: outcome === 'refund' };
}

function outcomeOr(v: any, fallback: DepositOutcome): DepositOutcome {
  return v === 'refund' || v === 'rollover' || v === 'forfeit' ? v : fallback;
}

function numOr(v: any, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function toDate(val: any): Date {
  if (!val) return new Date(0);
  if (val instanceof Date) return val;
  if (typeof val === 'object' && typeof val.seconds === 'number') return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

// ═════════════════════════════════════════════════════════════════════════════
// BOOKING MODE — Round U
//
// The shop-wide answer to "what happens when someone books online?", and the
// single place the answer is computed. Four modes, one status vocabulary:
//
//   instant           booked and confirmed on the spot (today's behavior).
//                     A deposit may still be collected if the service asks.
//   deposit_required  the slot is HELD, not confirmed, until the deposit is
//                     actually paid. Abandon it and the hold expires.
//   card_on_file      confirmed immediately, nothing charged. The card is
//                     vaulted so a no-show or late cancel can be charged
//                     under the policy already in this file.
//   approval          nothing is confirmed until the shop says yes. Money is
//                     NEVER taken at request time — see chargeTiming below.
//
// Three layers, resolved here so the booking sheet, the API route, and the
// calendar can never disagree about what is owed or what state to write:
//     shop default  →  per-service override  →  per-client override
// A layer only speaks when it has an opinion; silence inherits.
//
// Pure and dependency-free like everything above it.

export type BookingMode = 'instant' | 'deposit_required' | 'card_on_file' | 'approval';

/** When money may be taken. The approval trap this closes: charging at
 *  REQUEST time means refunding every decline, which is both work and a bad
 *  look. So approval mode always defers the charge to the moment of
 *  acceptance — the client is told exactly that. */
export type ChargeTiming = 'at_booking' | 'on_approval' | 'on_penalty' | 'never';

export interface BookingModeConfig {
  mode: BookingMode;
  /** Card on file is ORTHOGONAL to the mode, because in practice it is a
   *  house rule that rides alongside whatever else is true: "book instantly,
   *  but we keep a card", "request an appointment, and we keep a card". The
   *  'card_on_file' MODE is just the case where the card is the ONLY
   *  requirement; this flag is what makes it composable with the rest. */
  requireCardOnFile: boolean;
  /** Minutes an unpaid/unanswered hold survives before the slot is released. */
  holdMinutes: number;
  /** Hours an unanswered REQUEST survives before it auto-declines. 0 = never. */
  approvalExpiryHours: number;
  /** Approval mode only: auto-accept requests from clients with a clean
   *  history and at least this many completed visits. 0 = never auto-accept. */
  autoApproveAfterVisits: number;
}

export const DEFAULT_BOOKING_MODE: BookingModeConfig = {
  mode: 'instant',
  requireCardOnFile: false,
  holdMinutes: 30,          // matches PENDING_HOLD_MS in availability.ts
  approvalExpiryHours: 24,
  autoApproveAfterVisits: 0,
};

export function resolveBookingMode(tenant: any): BookingModeConfig {
  const b = (tenant && tenant.bookingMode) || {};
  const mode: BookingMode = ['instant', 'deposit_required', 'card_on_file', 'approval'].includes(b.mode)
    ? b.mode
    : DEFAULT_BOOKING_MODE.mode;
  return {
    mode,
    // The dedicated mode implies the requirement; the flag can also stand alone.
    requireCardOnFile: b.requireCardOnFile === true || mode === 'card_on_file',
    holdMinutes: numOr(b.holdMinutes, DEFAULT_BOOKING_MODE.holdMinutes),
    approvalExpiryHours: numOr(b.approvalExpiryHours, DEFAULT_BOOKING_MODE.approvalExpiryHours),
    autoApproveAfterVisits: numOr(b.autoApproveAfterVisits, DEFAULT_BOOKING_MODE.autoApproveAfterVisits),
  };
}

export interface BookingPlanInput {
  tenant: any;
  service: any;
  price: number;
  /** The matched client record, when the booker is recognized. */
  client?: any;
  /** Staff booking on someone's behalf skip approval — they ARE the approval. */
  byStaff?: boolean;
}

export interface BookingPlan {
  mode: BookingMode;
  /** What the appointment document should be created as. */
  status: 'confirmed' | 'pending_payment' | 'requested';
  depositCents: number;
  chargeTiming: ChargeTiming;
  /** True when the client must complete a payment step to keep the slot. */
  paymentBlocksConfirmation: boolean;
  /** True when a card must be vaulted (no charge now). */
  requiresCardOnFile: boolean;
  holdMinutes: number;
  approvalExpiryHours: number;
  /** Plain-language line shown to the CLIENT at the point of decision. */
  clientNotice: string;
  /** Why this plan came out the way it did — for the audit trail and for
   *  the owner staring at an appointment wondering what happened. */
  reason: string;
}

/**
 * THE one resolver. Every surface that needs to know "what happens when this
 * person books this service right now" calls exactly this.
 */
export function resolveBookingPlan(input: BookingPlanInput): BookingPlan {
  const { tenant, service, price, client, byStaff } = input;

  // ── Layer 0: independent providers collect their own money ────────────────
  // A booth renter's service is THEIR sale, not the studio's. The studio's
  // Stripe must never touch it — no deposit, no card vault, no payment step —
  // so this short-circuits ahead of every other layer, including the guardian.
  // The slot is still really held; only the money moves elsewhere.
  if (service?.collectsOwnPayment) {
    // Their own Stripe is live AND they've set a deposit on this service →
    // collect it ON THEIR ACCOUNT. Any other state (not connected, still in
    // review, no deposit set) falls through to pay-in-person below, which is
    // why a half-onboarded provider can never produce a broken checkout.
    const renterDeposit = Math.round(Number(service?.renterDepositAmount) * 100) || 0;
    if (service?.renterChargesEnabled && renterDeposit > 0) {
      return {
        mode: 'deposit_required',
        status: 'pending_payment',
        depositCents: renterDeposit,
        chargeTiming: 'at_booking',
        paymentBlocksConfirmation: true,
        requiresCardOnFile: false,
        holdMinutes: 15,
        approvalExpiryHours: 0,
        clientNotice: `A $${(renterDeposit / 100).toFixed(2)} deposit holds this appointment. You'll pay the rest to ${service?.providerName || 'your provider'} at your visit.`,
        reason: 'Independent provider — deposit collected on their own account',
      };
    }
    return {
      mode: 'instant',
      status: 'confirmed',
      depositCents: 0,
      chargeTiming: 'never',
      paymentBlocksConfirmation: false,
      requiresCardOnFile: false,
      holdMinutes: 0,
      approvalExpiryHours: 0,
      clientNotice: `You'll pay ${service?.providerName || 'your provider'} directly at your visit.`,
      reason: 'Independent provider — collects payment directly',
    };
  }

  const cfg = resolveBookingMode(tenant);

  const poorHistory = !!client
    && (numOr(client.noShowCount, 0) + numOr(client.cancellationCount, 0)) > 2;
  const guardianActive = tenant?.guardianProtocolEnabled !== false;

  const depositCents = computeDepositCents({
    service, price, tenant,
    depositsLive: !!tenant?.depositsLive,
    poorHistory, guardianActive,
  });

  // ── Layer 2/3: overrides that can only ever RELAX or TIGHTEN explicitly ──
  // A service may force its own mode (a $400 full set can demand a deposit in
  // an otherwise instant shop). A client may be trusted past the shop rule —
  // but never past the guardian, which exists precisely for the clients whose
  // history says otherwise.
  let mode = cfg.mode;
  let reason = `Shop default: ${cfg.mode.replace(/_/g, ' ')}`;

  const svcMode = service?.bookingMode;
  if (['instant', 'deposit_required', 'card_on_file', 'approval'].includes(svcMode)) {
    mode = svcMode;
    reason = `${service?.name || 'This service'} overrides the shop rule (${String(svcMode).replace(/_/g, ' ')})`;
  }

  if (client?.bookingTrust === 'trusted' && !(guardianActive && poorHistory)) {
    if (mode === 'approval' || mode === 'deposit_required') {
      mode = 'instant';
      reason = 'Trusted client — books instantly';
    }
  }
  if (guardianActive && poorHistory && mode === 'instant' && depositCents > 0) {
    mode = 'deposit_required';
    reason = 'Booking history requires the deposit up front';
  }

  // Staff booking for a client is itself the approval, and the studio does not
  // make itself wait on its own permission.
  if (byStaff && mode === 'approval') {
    mode = depositCents > 0 ? 'instant' : 'instant';
    reason = 'Booked by the studio — no request needed';
  }

  const money = `$${(depositCents / 100).toFixed(2)}`;

  /* A service may demand a card even when the shop does not (a $400 full set
   * in a walk-in-friendly shop), and a trusted client is never let out of it
   * — the card is the shop's protection, not a punishment to be waived. */
  const cardRequired = cfg.requireCardOnFile
    || service?.requireCardOnFile === true
    || mode === 'card_on_file';
  const cardLine = ' A card is saved on file to hold the appointment — nothing extra is charged today.';

  switch (mode) {
    case 'approval':
      return {
        mode, status: 'requested', depositCents,
        chargeTiming: depositCents > 0 ? 'on_approval' : 'never',
        paymentBlocksConfirmation: false,
        requiresCardOnFile: cardRequired,
        holdMinutes: cfg.holdMinutes,
        approvalExpiryHours: cfg.approvalExpiryHours,
        clientNotice: (depositCents > 0
          ? `This time is requested, not booked yet. Nothing is charged now — if it is accepted you will be asked for the ${money} deposit to lock it in.`
          : 'This time is requested, not booked yet. You will hear back shortly.')
          + (cardRequired ? cardLine : ''),
        reason,
      };

    case 'deposit_required':
      return {
        mode,
        status: depositCents > 0 ? 'pending_payment' : 'confirmed',
        depositCents,
        chargeTiming: depositCents > 0 ? 'at_booking' : 'never',
        paymentBlocksConfirmation: depositCents > 0,
        requiresCardOnFile: cardRequired,
        holdMinutes: cfg.holdMinutes,
        approvalExpiryHours: 0,
        clientNotice: (depositCents > 0
          ? `Your slot is held for ${cfg.holdMinutes} minutes. It is confirmed the moment the ${money} deposit goes through.`
          : 'Your time is confirmed.')
          + (cardRequired ? cardLine : ''),
        reason: depositCents > 0 ? reason : `${reason} — no deposit is set for this service`,
      };

    case 'card_on_file':
      return {
        mode, status: 'confirmed', depositCents: 0,
        chargeTiming: 'on_penalty',
        paymentBlocksConfirmation: false,
        requiresCardOnFile: true,
        holdMinutes: cfg.holdMinutes,
        approvalExpiryHours: 0,
        clientNotice: 'Your card is saved to hold the appointment — nothing is charged today. It is only used if the visit is missed or cancelled late.',
        reason,
      };

    case 'instant':
    default:
      return {
        mode: 'instant',
        status: depositCents > 0 ? 'pending_payment' : 'confirmed',
        depositCents,
        chargeTiming: depositCents > 0 ? 'at_booking' : 'never',
        paymentBlocksConfirmation: depositCents > 0,
        requiresCardOnFile: cardRequired,
        holdMinutes: cfg.holdMinutes,
        approvalExpiryHours: 0,
        clientNotice: (depositCents > 0
          ? `A ${money} deposit confirms this time. It goes toward your total.`
          : 'Your time is confirmed.')
          + (cardRequired ? cardLine : ''),
        reason,
      };
  }
}

/** Should this request skip the queue? Kept separate from the plan because it
 *  needs the client's completed-visit count, which only the server has. */
export function shouldAutoApprove(tenant: any, client: any): boolean {
  const cfg = resolveBookingMode(tenant);
  if (cfg.mode !== 'approval' || cfg.autoApproveAfterVisits <= 0) return false;
  const visits = numOr(client?.completedVisits ?? client?.visitCount, 0);
  const bad = numOr(client?.noShowCount, 0) + numOr(client?.cancellationCount, 0);
  return visits >= cfg.autoApproveAfterVisits && bad === 0;
}
