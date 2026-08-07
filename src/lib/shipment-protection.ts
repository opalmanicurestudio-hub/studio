// ─── src/lib/shipment-protection.ts ───────────────────────────────────────────
// Two protections bought at label time, and one piece of evidence recorded
// there for free.
//
// WHY AT LABEL TIME. A claim that a parcel never arrived, or arrived light, is
// answered with facts collected before anyone disputed anything. Signature
// confirmation and insurance both have to be chosen BEFORE the carrier takes
// the box — there is no retrofitting either one — and the weight the system
// expected is only knowable while the order is still in front of you.
//
// SIGNATURE is the strongest single defence against "I never got it". Plain
// tracking loses those disputes far more often than signature does, because a
// delivery scan proves a parcel reached an address, not a person. It costs a
// few dollars, so it is threshold-based: cheap orders are not worth it.
//
// INSURANCE turns damage in transit from her loss into a carrier claim. Also
// threshold-based, and deliberately a SEPARATE threshold from signature —
// they protect against different things and the right cutoffs differ.
//
// Both surcharges are applied when RATES ARE FETCHED, not at purchase. Shippo
// prices these on the shipment, so adding them at purchase would quote one
// price and charge another. Staff see the real cost before they choose.

export interface ProtectionPolicy {
  signatureEnabled: boolean;
  signatureOverCents: number;
  /** 'STANDARD' accepts any adult at the address; 'ADULT' requires ID and 21+. */
  signatureType: 'STANDARD' | 'ADULT';
  insuranceEnabled: boolean;
  insuranceOverCents: number;
  /** Carrier-scanned weight may legitimately differ from ours by this much. */
  weightToleranceOz: number;
}

const int = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/**
 * Read from retailSettings, with defaults chosen to be useful on day one for a
 * shop that has never opened this screen. None of these fields need to exist.
 */
export function protectionPolicy(retailSettings: any): ProtectionPolicy {
  const rs = retailSettings || {};
  return {
    // Opt-IN, because both cost money and nobody should be surprised by a
    // surcharge appearing on their rates.
    signatureEnabled: rs.signatureConfirmationEnabled === true,
    signatureOverCents: int(rs.signatureOverCents, 15000),   // $150
    signatureType: rs.signatureType === 'ADULT' ? 'ADULT' : 'STANDARD',
    insuranceEnabled: rs.shipmentInsuranceEnabled === true,
    insuranceOverCents: int(rs.insuranceOverCents, 10000),   // $100
    weightToleranceOz: int(rs.weightToleranceOz, 4),
  };
}

export interface ProtectionDecision {
  signature: 'NONE' | 'STANDARD' | 'ADULT';
  insuranceCents: number;
  /** Plain-language reasons, for the audit event and the staff toast. */
  reasons: string[];
}

/** What the goods are worth, for insurance purposes: merchandise only, never
 *  shipping or tip, and never a line the shop already refunded. */
export function insurableValueCents(order: any): number {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  if (lines.length === 0) {
    // Fall back to the order subtotal — better than insuring nothing.
    return Math.max(0, Number(order?.subtotalCents) || 0);
  }
  let cents = 0;
  for (const l of lines) {
    const ordered = Math.max(0, Number(l?.qtyOrdered) || 0);
    const shorted = Math.min(Math.max(0, Number(l?.qtyShorted) || 0), ordered);
    cents += (Math.max(0, Number(l?.unitPriceCents) || 0)) * (ordered - shorted);
  }
  return cents;
}

export function protectionFor(order: any, policy: ProtectionPolicy): ProtectionDecision {
  const value = insurableValueCents(order);
  const reasons: string[] = [];

  let signature: ProtectionDecision['signature'] = 'NONE';
  if (policy.signatureEnabled && value >= policy.signatureOverCents) {
    signature = policy.signatureType;
    reasons.push(`Signature required — order value $${(value / 100).toFixed(2)} is at or above the $${(policy.signatureOverCents / 100).toFixed(2)} threshold`);
  }

  let insuranceCents = 0;
  if (policy.insuranceEnabled && value >= policy.insuranceOverCents) {
    insuranceCents = value;
    reasons.push(`Insured for $${(value / 100).toFixed(2)}`);
  }

  return { signature, insuranceCents, reasons };
}

/**
 * The `extra` block Shippo wants on the SHIPMENT. Returns undefined when there
 * is nothing to add, so the caller can spread it without changing behaviour
 * for shops that have neither protection switched on.
 */
export function shippoExtra(decision: ProtectionDecision): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  if (decision.signature !== 'NONE') extra.signature_confirmation = decision.signature;
  if (decision.insuranceCents > 0) {
    extra.insurance = {
      amount: (decision.insuranceCents / 100).toFixed(2),
      currency: 'USD',
      content: 'Merchandise',
    };
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

/* ════════════════════════════════════════════════════════════════════════════
 * WEIGHT AS EVIDENCE
 *
 * The strongest answer to "only two of the three items were in the box" is not
 * an argument, it is arithmetic. The system already computes what the parcel
 * should weigh from per-item weights. The carrier independently WEIGHS it and
 * reports that number back. Two numbers from two parties that agree are very
 * hard to talk around, and almost nobody collects them.
 *
 * Recorded whether or not anyone ever disputes anything, because it costs
 * nothing at label time and cannot be reconstructed later.
 * ════════════════════════════════════════════════════════════════════════════ */

export interface WeightVerdict {
  verdict: 'match' | 'light' | 'heavy' | 'unknown';
  expectedOz: number;
  carrierOz: number;
  deltaOz: number;
  /** One sentence fit to paste into a dispute response. */
  note: string;
}

export function weightVerdict(
  expectedOz: unknown, carrierOz: unknown, toleranceOz = 4
): WeightVerdict {
  const exp = Number(expectedOz);
  const act = Number(carrierOz);
  const base = { expectedOz: Number.isFinite(exp) ? exp : 0, carrierOz: Number.isFinite(act) ? act : 0 };

  if (!Number.isFinite(exp) || !Number.isFinite(act) || exp <= 0 || act <= 0) {
    return { ...base, verdict: 'unknown', deltaOz: 0, note: 'No carrier-scanned weight is available for this shipment.' };
  }

  const delta = Math.round((act - exp) * 10) / 10;
  const within = Math.abs(delta) <= toleranceOz;
  const fmt = (o: number) => `${o.toFixed(1)} oz`;

  if (within) {
    return {
      ...base, verdict: 'match', deltaOz: delta,
      note: `The carrier weighed this parcel at ${fmt(act)}. The contents listed on the order come to ${fmt(exp)} including packaging — a difference of ${fmt(Math.abs(delta))}, within normal scale variance. The parcel the carrier collected matched the order as picked and packed.`,
    };
  }

  return {
    ...base,
    verdict: delta < 0 ? 'light' : 'heavy',
    deltaOz: delta,
    note: delta < 0
      ? `The carrier weighed this parcel at ${fmt(act)}, which is ${fmt(Math.abs(delta))} LIGHTER than the ${fmt(exp)} the order should have weighed. Worth checking the pack photo before responding — this is the pattern of a genuinely missing item.`
      : `The carrier weighed this parcel at ${fmt(act)}, ${fmt(delta)} heavier than the expected ${fmt(exp)}. Usually extra void fill or a heavier box than the default; not a sign of a missing item.`,
  };
}
