/**
 * src/lib/opal/cancellation-policy.ts
 *
 * The ONE place the cancellation-fee rule lives, so the cancel dialog and any
 * server path agree exactly. It faithfully honors the policy model configured
 * in Settings → Operational Protocols:
 *
 *   - Global default mode (tenant.defaultCancellationMode): 'matrix' | 'percentage' | 'flat'
 *   - Global flat fee (tenant.cancellationFee) and window (tenant.cancellationWindowHours)
 *   - Per-service override (Service.cancellationFeeMode): 'inherit' | 'matrix' | 'flat' | 'percentage'
 *     with its own value (cancellationFeeValue / customCancellationFee) and window.
 *
 * The rule, per service on the appointment:
 *   1. Enough notice (hoursUntil ≥ the service/studio window) → NO fee. This is
 *      the piece that was missing — the old code billed regardless of notice.
 *   2. Otherwise the EFFECTIVE mode (service override, or the global default if
 *      the service inherits) decides the amount:
 *        matrix     → that service's house floor (time + materials + labor)
 *        percentage → service price × percent
 *        flat       → the service's flat value, or the studio flat fee applied ONCE
 *
 * A NO-SHOW is deliberately NOT handled here — a no-show charges the full
 * service total and is computed separately. Conflating the two is what produced
 * the "$92.89 full-price cancellation fee" on a routine cancel.
 *
 * Pure (no Firestore/admin) so the client dialog and server code share it.
 * Works in dollars to match the dialog; callers needing cents multiply by 100.
 * Always rounded to cents — never a raw float.
 */

export type CancellationFeeMode = 'matrix' | 'percentage' | 'flat';

export interface ServiceCancelInput {
  /** Service.cancellationFeeMode. 'inherit' uses the studio default. */
  mode: 'inherit' | CancellationFeeMode;
  /** Per-service value: flat $ when mode 'flat', percent when mode 'percentage'. */
  value?: number;
  /** Required notice in hours for THIS service (falls back to studio window). */
  window?: number;
  /** This service's house floor = time + materials + burdened labor (matrix basis). */
  matrixBasis: number;
  /** This service's price (basis for percentage mode). */
  price: number;
}

export interface CancellationFeeArgs {
  services: ServiceCancelInput[];
  /** tenant.defaultCancellationMode (defaults to 'matrix' to match Settings). */
  globalMode: CancellationFeeMode;
  /** tenant.cancellationFee — studio flat fee in dollars. */
  tenantFlatFee: number;
  /** tenant.cancellationWindowHours (default 24). */
  defaultWindowHours?: number;
  /** Hours between now and appointment start. Negative = already started. */
  hoursUntilAppointment: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Suggested cancellation fee (dollars, rounded to cents) for an appointment,
 * honoring per-service overrides, the studio default mode, and the window rule.
 */
export function resolveAppointmentCancellationFee(args: CancellationFeeArgs): number {
  const { services, globalMode, tenantFlatFee, hoursUntilAppointment } = args;
  const defaultWindow = args.defaultWindowHours ?? 24;

  let total = 0;
  let flatApplied = false;

  for (const s of services) {
    const window = s.window || defaultWindow;
    if (hoursUntilAppointment >= window) continue;   // enough notice → no fee

    const effectiveMode: CancellationFeeMode = s.mode === 'inherit' ? globalMode : s.mode;

    if (effectiveMode === 'matrix') {
      total += s.matrixBasis;
    } else if (effectiveMode === 'percentage') {
      // Per-service percent if set, otherwise treat as full service price.
      const pct = s.value && s.value > 0 ? s.value : 100;
      total += s.price * (pct / 100);
    } else {
      // flat: a service-level flat value wins; otherwise the studio flat fee
      // applies ONCE for the whole appointment (not once per service).
      if (s.mode === 'flat' && s.value && s.value > 0) {
        total += s.value;
      } else if (!flatApplied && tenantFlatFee > 0) {
        total += tenantFlatFee;
        flatApplied = true;
      }
    }
  }

  return round2(total);
}

/** Round any money value to cents — exported so callers never display a float. */
export const toCents2 = round2;
