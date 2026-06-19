/**
 * lib/cancellation-config.ts
 *
 * Describes every tenant-level field that controls the cancellation
 * automation system. Add these fields to your Tenant type and your
 * studio settings UI so business owners can configure their own rules.
 */

export interface CancellationAutomationConfig {
  // ── Master controls ─────────────────────────────────────────────────────────

  /** Kill-switch for the entire auto-cancel system. Default: true */
  autoCancelEnabled: boolean;

  /** Whether to send email notifications on cancellation. Default: true */
  cancellationEmailEnabled: boolean;

  /** Whether to send SMS notifications on cancellation. Default: true */
  cancellationSmsEnabled: boolean;


  // ── No-show rules ───────────────────────────────────────────────────────────

  /**
   * How many minutes after appointment start time before the system
   * automatically marks the appointment as a no-show.
   * Default: 15. Recommended range: 10–30.
   */
  noShowWindowMinutes: number;

  /**
   * How to compute the no-show fee:
   *   'full_service' — 100% of all service prices (default)
   *   'flat'         — a fixed dollar amount (flatNoShowFee)
   *   'matrix'       — uses the profitability matrix from CancelAppointmentDialog
   */
  noShowFeeMode: 'full_service' | 'flat' | 'matrix';

  /** Used when noShowFeeMode === 'flat'. Dollar amount. */
  flatNoShowFee?: number;


  // ── Late cancellation rules ─────────────────────────────────────────────────

  /**
   * Hours before appointment start inside which a cancellation is considered
   * "late" and the fee applies. Default: 24.
   * E.g. set to 48 for a 2-day policy.
   */
  cancellationWindowHours: number;

  /**
   * Default cancellation fee dollar amount when the matrix is not used.
   * Only applies when useMatrixForCancellation is false.
   */
  cancellationFee: number;

  /**
   * When true, the profitability matrix (time cost + material cost + labor)
   * is the default fee suggestion instead of a flat cancellationFee.
   * Default: true.
   */
  useMatrixForCancellation: boolean;


  // ── Repeat no-show protection ───────────────────────────────────────────────

  /**
   * Number of no-shows within 90 days before the system automatically
   * flags the client and enforces deposit + card requirements.
   * Default: 2.
   */
  repeatNoShowThreshold: number;


  // ── Deposit forfeiture ──────────────────────────────────────────────────────

  /**
   * When true, a paid deposit is automatically marked forfeited on no-show
   * and a forfeiture transaction is recorded. Default: true.
   */
  forfeitDepositOnNoShow: boolean;


  // ── Studio contact (used in email/SMS templates) ────────────────────────────
  email: string;
  phone: string;
}

/**
 * Defaults — merge these into a new tenant's config at creation time.
 */
export const DEFAULT_CANCELLATION_CONFIG: CancellationAutomationConfig = {
  autoCancelEnabled: true,
  cancellationEmailEnabled: true,
  cancellationSmsEnabled: true,
  noShowWindowMinutes: 15,
  noShowFeeMode: 'full_service',
  cancellationWindowHours: 24,
  cancellationFee: 50,
  useMatrixForCancellation: true,
  repeatNoShowThreshold: 2,
  forfeitDepositOnNoShow: true,
  email: '',
  phone: '',
};
