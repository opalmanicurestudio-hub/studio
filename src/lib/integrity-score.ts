// ─── src/lib/integrity-score.ts ──────────────────────────────────────────────
// The Order Integrity Score: how strong is the EVIDENCE that this order was
// fulfilled exactly as promised? 0–100, computed from verification facts the
// system already records — nothing new is captured to produce it.
//
// The honest math: every check has a weight, but only APPLICABLE checks
// count toward the denominator. A pickup order is never punished for lacking
// carrier custody; an order from before pack-photos shipped isn't scored as
// suspicious — the score measures the strength of what exists, normalized to
// what could exist for THAT order.
//
// It is decision SUPPORT, never a verdict: a weak score means "the record is
// thin here — look closer," not "the customer is right/wrong."

export type IntegrityInput = {
  method?: string;                 // 'ship' | 'counter' | 'curbside' | ...
  stage?: string;
  lines?: { qtyOrdered?: number; qtyShorted?: number; qtyScanned?: number }[];
  packPhotoUrls?: string[];
  trackingNumber?: string;
  // Optional event-derived facts (evidence page has them; claim snapshots don't):
  hasHandoffOrLabelScan?: boolean | null;
  hasMismatchOrOverride?: boolean | null;
};

export type IntegrityScore = {
  score: number;                   // 0–100
  grade: 'strong' | 'fair' | 'weak';
  earned: number;
  possible: number;
  checks: { label: string; ok: boolean; weight: number; applicable: boolean }[];
};

export function computeIntegrityScore(input: IntegrityInput): IntegrityScore {
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const isShip = input.method === 'ship';
  const delivered = input.stage === 'completed';

  const allScanned =
    lines.length > 0 &&
    lines.every((l) => (Number(l.qtyScanned) || 0) >= Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0)));
  const photoCount = Array.isArray(input.packPhotoUrls) ? input.packPhotoUrls.length : 0;

  const checks: IntegrityScore['checks'] = [
    { label: 'Every unit scanned', ok: allScanned, weight: 30, applicable: lines.length > 0 },
    { label: 'Packing photo', ok: photoCount > 0, weight: 15, applicable: true },
    {
      label: isShip ? 'Label verified onto box' : 'Handoff verified by scan',
      ok: input.hasHandoffOrLabelScan === true,
      weight: 20,
      applicable: input.hasHandoffOrLabelScan !== null && input.hasHandoffOrLabelScan !== undefined,
    },
    { label: 'Carrier custody', ok: Boolean(input.trackingNumber), weight: 15, applicable: isShip },
    { label: 'Delivery confirmed', ok: delivered, weight: 10, applicable: isShip },
    {
      label: 'No mismatches or overrides',
      ok: input.hasMismatchOrOverride === false,
      weight: 10,
      applicable: input.hasMismatchOrOverride !== null && input.hasMismatchOrOverride !== undefined,
    },
  ];

  const applicable = checks.filter((c) => c.applicable);
  const possible = applicable.reduce((a, c) => a + c.weight, 0);
  const earned = applicable.reduce((a, c) => a + (c.ok ? c.weight : 0), 0);
  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  const grade: IntegrityScore['grade'] = score >= 80 ? 'strong' : score >= 50 ? 'fair' : 'weak';
  return { score, grade, earned, possible, checks };
}

/**
 * A claim stores its evidence snapshot at open time (lineScanned, photoCount,
 * hasCarrier, delivered) — score THAT, so the number on the claims desk
 * reflects the record as it stood when the customer spoke, immune to
 * anything that changed after.
 */
export function scoreClaimSnapshot(ev: any, orderMethodHint?: string): IntegrityScore {
  const scanned = ev?.allScanned === true;
  return computeIntegrityScore({
    method: ev?.hasCarrier || orderMethodHint === 'ship' ? 'ship' : orderMethodHint || 'counter',
    stage: ev?.delivered ? 'completed' : String(ev?.stageAtClaim || ''),
    lines: [{ qtyOrdered: 1, qtyShorted: 0, qtyScanned: scanned ? 1 : 0 }],
    packPhotoUrls: Array.from({ length: Math.max(0, Number(ev?.photoCount) || 0) }, () => 'x'),
    trackingNumber: ev?.hasCarrier ? 'y' : '',
    hasHandoffOrLabelScan: null,
    hasMismatchOrOverride: null,
  });
}
