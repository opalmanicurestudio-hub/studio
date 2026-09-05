// src/lib/collections-policy.ts
//
// WHAT HAPPENS TO SOMEONE WHO DOESN'T PAY — decided by the shop, not the code.
//
// Barring a renter from booking, escalating notices, writing them to a wall
// message: these are consequences with a relationship attached, and one
// studio's "firm" is another's "unthinkable". So nothing here has a hard
// default that acts on its own. Out of the box a shop gets exactly one late
// notice (what it always had), no escalation, and no automatic bar — and
// every step past that is a switch the owner flips on /rent.
//
// The resolver is the only reader of tenant.collectionsPolicy; the nightly
// job, the booking route and the rent page all ask it rather than the raw
// document, so a missing or malformed setting always means "the gentle
// default", never "undefined behaviour".

export interface CollectionsPolicy {
  /** Days-late at which an escalating notice goes out. Empty = the single
   *  late notice only. Each day fires once per invoice. */
  dunningDays: number[];
  /** Bar from booking automatically once an invoice is this many days late.
   *  null = never automatically; barring stays a manual decision. */
  autoBarAfterDaysLate: number | null;
  /** When a lease ends with a balance owing, bar automatically. */
  autoBarOnLeaseEndOwing: boolean;
  /** Send the renter a notice when they are barred (auto or manual). */
  notifyOnBar: boolean;
  /** What a barred renter sees when they try to book. */
  wallMessage: string;
}

export const DEFAULT_COLLECTIONS: CollectionsPolicy = {
  dunningDays: [],
  autoBarAfterDaysLate: null,
  autoBarOnLeaseEndOwing: false,
  notifyOnBar: true,
  wallMessage: 'There is an outstanding balance on your account with us. Please get in touch with the studio to settle it before booking.',
};

export function resolveCollectionsPolicy(tenant: any): CollectionsPolicy {
  const c = (tenant && tenant.collectionsPolicy) || {};
  const days: number[] = Array.isArray(c.dunningDays)
    ? (Array.from(new Set<number>(
        c.dunningDays.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 1 && n <= 90),
      )) as number[]).sort((a, b) => a - b)
    : DEFAULT_COLLECTIONS.dunningDays;
  const bar = Number(c.autoBarAfterDaysLate);
  return {
    dunningDays: days,
    autoBarAfterDaysLate: Number.isFinite(bar) && bar >= 1 && bar <= 180 ? bar : null,
    autoBarOnLeaseEndOwing: c.autoBarOnLeaseEndOwing === true,
    notifyOnBar: c.notifyOnBar !== false,
    wallMessage: String(c.wallMessage || '').trim().slice(0, 300) || DEFAULT_COLLECTIONS.wallMessage,
  };
}

/** Whole days between an invoice's due date and `todayIso` (calendar days). */
export function daysLate(dueDateIso: string, todayIso: string): number {
  const p = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const a = p(dueDateIso), b = p(todayIso);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Which dunning steps are due for this invoice today and not yet sent.
 * `sent` is the invoice's record of steps already fired.
 */
export function dunningStepsDue(policy: CollectionsPolicy, dueDateIso: string, todayIso: string, sent: number[]): number[] {
  const late = daysLate(dueDateIso, todayIso);
  return policy.dunningDays.filter((d) => late >= d && !sent.includes(d));
}
