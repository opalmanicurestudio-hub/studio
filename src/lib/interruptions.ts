// src/lib/interruptions.ts
//
// BUSINESS INTERRUPTION — FLOOD, FIRE, POWER, WEATHER, FORCED CLOSURE.
//
// This is the one nobody builds until the week they need it, and by then the
// facts are gone: which days the doors were shut, which chairs were unusable,
// what each renter lost, what was done about it, and when. Reconstructing that
// for an insurer six months later is a memory exercise. Recording it as it
// happens is a filing cabinet.
//
// WHY "INTERRUPTION" AND NOT "INCIDENT". The word 'incident' is already spoken
// for in this app: LogIncidentForm records something that went wrong during a
// client's SERVICE — a burn, a reaction, a complaint. Two unrelated things
// sharing one word inside one product is how a support conversation goes
// sideways. So the thing that closes the building is an interruption.
//
// THE MONEY RULE, SAME AS EVERYWHERE ELSE: this module PROPOSES. It computes
// what each affected renter would be owed for the days their space was
// unusable and hands the owner a number with an Approve button. Nothing here
// writes to a ledger, and nothing abates on a schedule. A closure is exactly
// the moment a shop's cash is most fragile; an automatic giveaway during it
// would be the worst-timed automation in the product.

import { dailyRentCents } from './leave-policy';

export type InterruptionType = 'flood' | 'fire' | 'power' | 'water' | 'weather' | 'closure' | 'other';
export type InterruptionStatus = 'open' | 'resolved';

export const INTERRUPTION_TYPE_LABEL: Record<InterruptionType, string> = {
  flood: 'Flood / water damage',
  fire: 'Fire / smoke',
  power: 'Power loss',
  water: 'No running water',
  weather: 'Weather',
  closure: 'Forced closure',
  other: 'Other',
};

export interface RemedyNote {
  at: string;
  text: string;
  sharedWithRenters: boolean;
}

export interface InterruptionRecord {
  id: string;
  type: InterruptionType;
  title: string;
  /** YYYY-MM-DD. The first day the space could not be used. */
  startDate: string;
  /** YYYY-MM-DD, or null while it is still going on. */
  endDate: string | null;
  /** Empty means the WHOLE studio — every leased space is affected. */
  affectedBoothIds: string[];
  status: InterruptionStatus;
  note: string;
  remedy: RemedyNote[];
  /** renterId → what has actually been credited, so nobody is paid twice. */
  abated: Record<string, { cents: number; days: number; at: string }>;
  createdAt: string;
  resolvedAt?: string | null;
}

/**
 * Days the interruption has run, inclusive of both ends. An open interruption
 * is counted up to today and no further — a closure that is still going on
 * has not yet cost anyone tomorrow.
 */
export function interruptionDays(start: string, end: string | null, todayIso: string): number {
  const p = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const a = p(start);
  const b = p(end && end < todayIso ? end : todayIso);
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Does this interruption touch this booth? An empty list means the lot. */
export function affectsBooth(rec: { affectedBoothIds?: string[] }, boothId: string | null | undefined): boolean {
  const ids = Array.isArray(rec.affectedBoothIds) ? rec.affectedBoothIds : [];
  if (ids.length === 0) return true;
  return !!boothId && ids.includes(boothId);
}

export interface AbatementProposal {
  renterId: string;
  leaseId: string;
  renterName: string;
  boothId: string | null;
  boothName: string;
  days: number;
  dailyCents: number;
  fullCents: number;
  paidCents: number;
  owedCents: number;
}

/**
 * What each affected renter would be owed, at a day's rent per day their space
 * was unusable. Priced off their OWN lease, so a renter on a weekly agreement
 * and one on a monthly agreement are each made whole against what they
 * actually pay — not against an average nobody signed.
 *
 * Renters already on leave are skipped: their rent is already suspended or
 * reduced by the leave, and abating it a second time pays twice for one empty
 * chair. That is the double-count this function exists to prevent.
 */
export function abatementProposals(
  rec: InterruptionRecord,
  leases: any[],
  boothById: Map<string, any>,
  renterById: Map<string, any>,
  todayIso: string,
): AbatementProposal[] {
  const days = interruptionDays(rec.startDate, rec.endDate, todayIso);
  if (days <= 0) return [];
  const out: AbatementProposal[] = [];
  for (const lease of leases || []) {
    if (String(lease.status) !== 'active') continue;
    if (!affectsBooth(rec, lease.boothId)) continue;
    const renter = renterById.get(lease.renterId);
    const dailyCents = dailyRentCents(lease);
    if (dailyCents <= 0) continue;
    const paid = Number(rec.abated?.[lease.renterId]?.cents) || 0;
    const fullCents = dailyCents * days;
    out.push({
      renterId: lease.renterId,
      leaseId: lease.id,
      renterName: renter ? `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'Renter' : 'Renter',
      boothId: lease.boothId || null,
      boothName: (lease.boothId && boothById.get(lease.boothId)?.name) || 'Their space',
      days,
      dailyCents,
      fullCents,
      paidCents: paid,
      owedCents: Math.max(0, fullCents - paid),
    });
  }
  return out.sort((a, b) => a.renterName.localeCompare(b.renterName));
}

/** The shop's total exposure for this interruption, before anything is approved. */
export function exposureCents(proposals: AbatementProposal[]): { fullCents: number; paidCents: number; owedCents: number } {
  return proposals.reduce(
    (acc, p) => ({ fullCents: acc.fullCents + p.fullCents, paidCents: acc.paidCents + p.paidCents, owedCents: acc.owedCents + p.owedCents }),
    { fullCents: 0, paidCents: 0, owedCents: 0 },
  );
}
