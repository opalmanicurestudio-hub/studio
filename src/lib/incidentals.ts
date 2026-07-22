// src/lib/incidentals.ts
//
// Single source of truth for the incidentals CHARGE POLICY — the allowed
// charge types and their hard dollar caps. Both card-charging paths import
// from here so day/hourly renters and monthly resident renters are governed
// by exactly ONE policy:
//
//   • /api/booths/reserve  — action:'incidental'        (day/hourly booking)
//   • /api/booths/reserve  — action:'lease_incidental'  (monthly resident)
//
// The same list is folded into the signed lease (see esign.ts,
// DEFAULT_INCIDENTALS_SCHEDULE) so a renter agrees to these caps up front and
// staff can neither invent a charge nor exceed a cap — enforced server-side,
// so it holds even if the UI is bypassed.

export interface IncidentalCategory {
  label: string;
  capCents: number; // 0 = no cap (not recommended)
}

// Sensible defaults, used until an owner saves their own policy on the tenant
// doc (tenants/{tid}.incidentalCategories). Keep in step with esign.ts's
// DEFAULT_INCIDENTALS_SCHEDULE so the signed lease matches what's enforced.
export const DEFAULT_INCIDENTALS: IncidentalCategory[] = [
  { label: 'Cleaning fee', capCents: 7500 },
  { label: 'Damage', capCents: 50000 },
  { label: 'Lost key / fob', capCents: 2500 },
  { label: 'Late checkout', capCents: 5000 },
  { label: 'Missing product / supplies', capCents: 15000 },
];

// Given the raw tenant document data, return the effective policy: the owner's
// saved categories if present and non-empty, otherwise the defaults.
export function resolveIncidentalPolicy(tenantData: any): IncidentalCategory[] {
  const saved = tenantData?.incidentalCategories;
  if (Array.isArray(saved) && saved.length) {
    return saved
      .map((c: any) => ({ label: String(c?.label || '').trim(), capCents: Math.max(0, Math.round(Number(c?.capCents) || 0)) }))
      .filter((c: IncidentalCategory) => c.label.length > 0);
  }
  return DEFAULT_INCIDENTALS;
}

export type IncidentalValidation =
  | { ok: true; category: IncidentalCategory; description: string }
  | { ok: false; status: number; error: string };

// Validate a requested charge against the policy. Rejects amounts under $0.50,
// unknown charge types, and anything over the type's cap. On success returns
// the matched category and a bounded human-readable description.
export function validateIncidental(
  cats: IncidentalCategory[],
  categoryLabel: string,
  amountCents: number,
  note?: string,
): IncidentalValidation {
  const amount = Math.round(Number(amountCents) || 0);
  if (!(amount >= 50)) {
    return { ok: false, status: 400, error: 'Enter an amount of at least $0.50.' };
  }
  const label = String(categoryLabel || '').slice(0, 80).trim();
  const cat = cats.find((c) => String(c.label || '').toLowerCase() === label.toLowerCase());
  if (!cat) {
    return { ok: false, status: 400, error: 'That is not an allowed charge type — pick one from your incidentals policy.' };
  }
  const capCents = Math.round(Number(cat.capCents) || 0);
  if (capCents > 0 && amount > capCents) {
    return { ok: false, status: 400, error: `That exceeds the $${(capCents / 100).toFixed(0)} cap for "${cat.label}".` };
  }
  const cleanNote = String(note || '').slice(0, 140).trim();
  const description = (cleanNote ? `${cat.label}: ${cleanNote}` : cat.label).slice(0, 200);
  return { ok: true, category: cat, description };
}
