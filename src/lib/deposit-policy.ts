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