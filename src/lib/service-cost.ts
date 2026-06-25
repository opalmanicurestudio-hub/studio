// ─────────────────────────────────────────────────────────────────────────────
// lib/service-cost.ts
//
// Extracted from POSPage's inline `computeServiceCost`. Same formula, same
// inputs, zero behavior change — this is a pure relocation, not a rewrite.
// Both POSPage and AppointmentCard should import from here instead of each
// keeping their own copy, for the same reason we flagged the late-arrival
// fee logic earlier: duplicated business math drifts silently over time.
//
// Migration note for POSPage.tsx: once this is wired in, delete the local
// `computeServiceCost` function there and replace with:
//   import { computeServiceCost } from '@/lib/service-cost';
// No call sites change — same function name, same signature, same return shape.
// ─────────────────────────────────────────────────────────────────────────────

export interface ServiceCostBreakdown {
  overhead: number;
  materials: number;
  labor: number;
  total: number;
}

export interface ServiceCostResult extends ServiceCostBreakdown {
  /** price - total cost. Negative means this booking loses money at cost, before tax/tip. */
  margin: number;
  /** margin / price, as a 0-1 fraction. Null if price is 0 (avoids divide-by-zero, e.g. comped/redeemed services). */
  marginPct: number | null;
}

/**
 * Computes the fully-loaded cost of performing a service for a given
 * appointment: materials consumed, staff labor cost, and time-based
 * overhead recovery. Same formula POSPage already uses at checkout.
 *
 * @param service       The service being performed.
 * @param apt           The appointment (used for any custom formula override).
 * @param staffMember   The staff member assigned (determines labor cost via payStructure).
 * @param inventory     Full inventory list, used to resolve per-product cost.
 * @param tmhr          Tenant's "time-money-hour-rate" — the overhead recovery rate.
 */
export function computeServiceCost(
  service: any,
  apt: any,
  staffMember: any,
  inventory: any[],
  tmhr: number
): ServiceCostBreakdown {
  if (!service) return { overhead: 0, materials: 0, labor: 0, total: 0 };

  let materials = 0;
  if (apt?.checkoutState?.formula?.length > 0) {
    materials = apt.checkoutState.formula.reduce(
      (acc: number, item: any) => acc + (item.quantity || 0) * (item.costPerUnit || 0),
      0
    );
  } else if (service.products?.length > 0) {
    materials = service.products.reduce((acc: number, p: any) => {
      const item = (inventory || []).find((i: any) => i.id === p.id);
      if (!item) return acc;
      let cpu = item.costPerUnit || 0;
      if (item.costingMethod === 'size' && item.size) cpu /= item.size;
      else if (item.costingMethod === 'uses' && item.estimatedUses) cpu /= item.estimatedUses;
      return acc + (p.quantityUsed || 1) * cpu;
    }, 0);
  }

  const duration = service.duration || 60;
  const overhead = (duration / 60) * (tmhr || 0);

  let labor = 0;
  if (staffMember?.payStructure === 'commission') {
    labor = (service.price || 0) * ((staffMember.commissionRate || 40) / 100);
  } else if (staffMember?.payStructure === 'hourly' && staffMember.hourlyRate) {
    labor = (duration / 60) * staffMember.hourlyRate;
  }

  return {
    overhead,
    materials,
    labor,
    total: Number((overhead + materials + labor).toFixed(2)),
  };
}

/**
 * Convenience wrapper around computeServiceCost that also returns margin
 * and margin percentage against a given price. Use this where you need the
 * profitability verdict (e.g. AppointmentCard's signal), not just the raw
 * cost breakdown.
 *
 * @param price  The revenue side — typically getServicePrice(service, staffMember).
 *               Pass 0 for comped/redeemed services; marginPct will be null
 *               in that case rather than a misleading negative-infinity-style number.
 */
export function computeServiceProfitability(
  service: any,
  apt: any,
  staffMember: any,
  inventory: any[],
  tmhr: number,
  price: number
): ServiceCostResult {
  const breakdown = computeServiceCost(service, apt, staffMember, inventory, tmhr);
  const margin = Number((price - breakdown.total).toFixed(2));
  const marginPct = price > 0 ? margin / price : null;
  return { ...breakdown, margin, marginPct };
}

export type ProfitabilityTier = 'healthy' | 'thin' | 'negative';

export interface ProfitabilityThresholds {
  /** marginPct at or above this = healthy. Default 0.25 (25%). */
  healthy: number;
  /** marginPct at or above this (but below `healthy`) = thin. Below this = negative. Default 0.05 (5%). */
  thin: number;
}

export const DEFAULT_PROFITABILITY_THRESHOLDS: ProfitabilityThresholds = {
  healthy: 0.25,
  thin: 0.05,
};

/**
 * Classifies a marginPct into a tier for visual signaling. Thresholds should
 * come from tenant settings (selectedTenant.profitabilityThresholds) once
 * that field exists — falls back to sane defaults otherwise. Margin
 * expectations vary a lot by service type and market, so this is
 * deliberately configurable rather than hardcoded business judgment.
 *
 * Returns null if marginPct is null (e.g. comped service with price 0) —
 * callers should treat null as "no signal," not as a fourth tier.
 */
export function classifyProfitability(
  marginPct: number | null,
  thresholds: ProfitabilityThresholds = DEFAULT_PROFITABILITY_THRESHOLDS
): ProfitabilityTier | null {
  if (marginPct === null) return null;
  if (marginPct >= thresholds.healthy) return 'healthy';
  if (marginPct >= thresholds.thin) return 'thin';
  return 'negative';
}
