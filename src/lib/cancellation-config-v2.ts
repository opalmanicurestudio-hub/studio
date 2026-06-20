/**
 * New tenant config fields for v2
 * Add these to your existing CancellationAutomationConfig type and settings UI
 */

export interface CancellationAutomationConfigV2 {

  // ── No-show detection (flag only — never auto-cancel) ─────────────────────

  /** Minutes after start before appointment is flagged as suspected no-show.
   *  Default: 15. Staff must manually confirm before anything is cancelled. */
  noShowWindowMinutes: number;

  /** Minutes staff have to respond to a suspected no-show notification
   *  before it escalates to manager. Default: 10. */
  noShowConfirmWindowMinutes: number;


  // ── Studio cancellation deposit policy ────────────────────────────────────

  /** What happens to a paid deposit when the STUDIO cancels.
   *  Staff can override per-cancellation, but this is the default shown.
   *
   *  'refund'       — Stripe refund (3–5 business days)
   *  'store_credit' — Instant credit added to client wallet
   *
   *  Default: 'refund' (most client-friendly, reduces disputes)
   */
  studioRefundPolicy: 'refund' | 'store_credit';

  /** How many days store credits are valid before expiring.
   *  0 = never expires. Default: 365 */
  storeCreditExpiryDays: number;


  // ── Existing fields (unchanged) ───────────────────────────────────────────
  autoCancelEnabled: boolean;
  cancellationEmailEnabled: boolean;
  cancellationSmsEnabled: boolean;
  noShowWindowMinutes: number;        // already existed — now drives flag, not cancel
  noShowFeeMode: 'full_service' | 'flat' | 'matrix';
  flatNoShowFee?: number;
  cancellationWindowHours: number;
  cancellationFee: number;
  useMatrixForCancellation: boolean;
  repeatNoShowThreshold: number;
  forfeitDepositOnNoShow: boolean;
}

export const DEFAULT_CANCELLATION_CONFIG_V2: Partial<CancellationAutomationConfigV2> = {
  noShowWindowMinutes:        15,
  noShowConfirmWindowMinutes: 10,
  studioRefundPolicy:         'refund',
  storeCreditExpiryDays:      365,
};

/**
 * Settings UI additions needed:
 *
 * In Settings → Policies → Cancellation section:
 *
 *   [No-Show Detection Window]
 *   "Flag appointment as suspected no-show after __ minutes"
 *   Input: noShowWindowMinutes (default 15)
 *
 *   [Staff Response Window]
 *   "Escalate to manager if staff don't respond within __ minutes"
 *   Input: noShowConfirmWindowMinutes (default 10)
 *
 *   [Studio Cancellation Default]
 *   "When studio cancels, default deposit to:"
 *   Radio: Refund to Card | Store Credit
 *   Field: studioRefundPolicy
 *
 *   [Store Credit Expiry]
 *   "Store credits expire after __ days (0 = never)"
 *   Input: storeCreditExpiryDays (default 365)
 */
