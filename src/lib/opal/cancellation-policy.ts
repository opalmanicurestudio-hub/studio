/**
 * src/lib/opal/cancellation-policy.ts
 *
 * The ONE place the cancellation-fee rule lives, so the cancel dialog and any
 * server path that needs it agree exactly (no scattered, drifting copies).
 *
 * The rule, per service on the appointment:
 *   1. Enough notice (hoursUntil ≥ the service/studio cancellation window)
 *      → NO fee. This is the case that was wrong before — the old code billed
 *      the full service cost regardless of notice.
 *   2. A per-service cancellation fee (Service.customCancellationFee) is set
 *      → use it. This is how per-service "special policies" take effect.
 *   3. Otherwise → the studio's flat cancellation fee applies ONCE for the
 *      whole appointment (not once per service).
 *
 * A NO-SHOW is deliberately NOT handled here — a no-show legitimately charges
 * the full service total and is computed separately. Conflating the two is
 * exactly what produced the "$92.89 full-price cancellation fee" bug.
 *
 * Pure (no Firestore, no admin) so both the client dialog and server code can
 * import it. Works in dollars to match the dialog's data flow; callers that
 * need cents multiply by 100. Always rounded to cents — never a raw float.
 */

export interface ServicePolicyInput {
  /** Service.customCancellationFee in dollars (0 / undefined = none). */
  overrideFee?: number;
  /** Required notice in hours for THIS service (falls back to studio window). */
  window?: number;
}

export interface CancellationFeeArgs {
  services: ServicePolicyInput[];
  /** Studio-level flat cancellation fee in dollars (tenant.cancellationFee). */
  tenantFlatFee: number;
  /** Hours between now and the appointment start. Negative = already started. */
  hoursUntilAppointment: number;
  /** Default window if neither service nor studio specifies one. */
  defaultWindowHours?: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Suggested cancellation fee (dollars, rounded to cents) for an appointment,
 * applying per-service overrides and the studio flat fee under the window rule.
 */
export function resolveAppointmentCancellationFee(args: CancellationFeeArgs): number {
  const { services, tenantFlatFee, hoursUntilAppointment } = args;
  const defaultWindow = args.defaultWindowHours ?? 24;

  let total = 0;
  let flatApplied = false;

  for (const s of services) {
    const window = s.window || defaultWindow;
    const withinFreeWindow = hoursUntilAppointment >= window;
    if (withinFreeWindow) continue;                 // enough notice → no fee

    if (s.overrideFee && s.overrideFee > 0) {        // per-service policy wins
      total += s.overrideFee;
      continue;
    }
    if (!flatApplied && tenantFlatFee > 0) {         // studio flat fee, once
      total += tenantFlatFee;
      flatApplied = true;
    }
    // else: late but no fee configured → studio chose not to charge → 0
  }

  return round2(total);
}

/** Round any money value to cents — exported so callers never display a float. */
export const toCents2 = round2;
