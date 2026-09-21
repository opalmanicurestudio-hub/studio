// src/lib/package-credits.ts
//
// WHAT HAPPENS TO A PACKAGE CREDIT WHEN A VISIT DOESN'T HAPPEN.
//
// A prepaid package is only fair if both sides know the rules before the
// first visit. These are the rules, written once and applied everywhere a
// visit can end — the renter's portal, the client's self-cancel link, a
// decline. The renter sets the policy on the package; the client sees it
// on the page before they buy; this module enforces it without judgement.
//
//   • RENTER cancels, declines, or moves the visit → NEVER a forfeit. If a
//     credit was already applied, it is given back. Their change, their cost.
//   • CLIENT no-shows → forfeit if the package says so (default: yes).
//   • CLIENT cancels inside the late window → forfeit if the package says
//     so (default: yes, 24 h). Outside the window → credit stays theirs.
//   • A visit that was never covered by a credit forfeits one only if the
//     client holds a live credit for that service — you cannot lose what
//     you don't have.
//
// Everything here is pure: callers hand in the package, the purchase and
// the visit, and get back a decision they then write.

export interface PackagePolicy {
  noShowForfeits: boolean;          // default true
  lateCancelForfeits: boolean;      // default true
  lateCancelHours: number;          // default 24
}

export const DEFAULT_POLICY: PackagePolicy = { noShowForfeits: true, lateCancelForfeits: true, lateCancelHours: 24 };

export function policyOf(pkg: any): PackagePolicy {
  return {
    noShowForfeits: pkg?.noShowForfeits !== false,
    lateCancelForfeits: pkg?.lateCancelForfeits !== false,
    lateCancelHours: Math.max(0, Math.min(168, Number(pkg?.lateCancelHours ?? 24) || 0)),
  };
}

/** One line a client can read before buying. */
export function policyText(pkg: any): string {
  const p = policyOf(pkg);
  const parts: string[] = [];
  if (p.noShowForfeits) parts.push('a no-show uses a visit');
  if (p.lateCancelForfeits) parts.push(`cancelling with less than ${p.lateCancelHours} hours' notice uses a visit`);
  if (parts.length === 0) return 'Visits are never lost to cancellations or no-shows.';
  return parts.join('; ').replace(/^./, (c) => c.toUpperCase()) + '.';
}

export type VisitEnding =
  | { by: 'renter'; how: 'cancel' | 'decline' | 'move' }
  | { by: 'client'; how: 'cancel'; hoursBeforeStart: number }
  | { by: 'client'; how: 'no_show' };

export type CreditDecision =
  | { action: 'none'; reason: string }
  | { action: 'restore'; reason: string }     // give a previously-applied credit back
  | { action: 'forfeit'; reason: string };    // burn one credit

/**
 * Decide what a visit's ending does to the client's credits.
 * `applied` — a credit was already used for this visit (paidByPackageId set).
 * `holdsLiveCredit` — the client has an unexpired credit usable for this service.
 */
export function decideCredit(pkg: any, ending: VisitEnding, applied: boolean, holdsLiveCredit: boolean): CreditDecision {
  const p = policyOf(pkg);
  if (ending.by === 'renter') {
    return applied
      ? { action: 'restore', reason: `The provider ${ending.how === 'move' ? 'moved' : ending.how === 'decline' ? 'declined' : 'cancelled'} this visit — the credit goes back.` }
      : { action: 'none', reason: 'The provider ended this visit; nothing was taken.' };
  }
  if (ending.how === 'no_show') {
    if (applied) return { action: 'none', reason: p.noShowForfeits ? 'No-show — the credit already applied to this visit is used.' : 'No-show, but this package does not forfeit — the credit is kept on the visit.' };
    if (p.noShowForfeits && holdsLiveCredit) return { action: 'forfeit', reason: 'No-show — one visit used, as the package terms say.' };
    return { action: 'none', reason: p.noShowForfeits ? 'No-show, but no live credit to take.' : 'This package does not forfeit on a no-show.' };
  }
  // client cancel
  const late = p.lateCancelForfeits && ending.hoursBeforeStart < p.lateCancelHours;
  if (applied) {
    return late
      ? { action: 'none', reason: `Cancelled with ${Math.max(0, Math.floor(ending.hoursBeforeStart))} h notice (under ${p.lateCancelHours}) — the credit stays used.` }
      : { action: 'restore', reason: 'Cancelled with enough notice — the credit goes back.' };
  }
  if (late && holdsLiveCredit) return { action: 'forfeit', reason: `Cancelled with under ${p.lateCancelHours} h notice — one visit used, as the package terms say.` };
  return { action: 'none', reason: late ? 'Late cancel, but no live credit to take.' : 'Cancelled in time — nothing taken.' };
}

/** Hours from now until a visit, never negative. */
export function hoursUntil(startIso: string, now = Date.now()): number {
  const t = new Date(startIso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, (t - now) / 3600000);
}
