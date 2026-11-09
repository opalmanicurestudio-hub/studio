// src/lib/rent-schedule.ts
//
// WHAT AUTOPAY IS ABOUT TO DO — computed the same way the cron decides it.
//
// The autopay cron (api/cron/autopay-leases) charges a lease on its due day:
// day-of-month for monthly leases, every N days from firstChargeDate for
// daily/weekly/biweekly. Until now that rule lived only inside the cron, so
// the app could show what autopay HAD charged but never what it was ABOUT
// to charge — the owner found out the next morning. This module is that
// rule, lifted out so a page can look forward with it, plus the readiness
// checks the cron applies (autopay on, Stripe customer, card on file).
//
// Pure: calendar days as strings, never instants, exactly like the cron.
import { renterBusinessCard } from './space-stripe';

export type RentFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

const parts = (v: any) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
};
const iso = (y: number, mo: number, d: number) =>
  `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

const day10 = (v: any) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');

/**
 * The day billing starts: the lease's first charge date (its start date if it has none), or, when the lease started
 * later than that (it waited for the renter's signature), the day it started. Its first bill is due on this day.
 */
/** The day a lease that waited for its signature was signed: the business's own day, which document-sign writes from
 *  now on (activatedOn). Leases signed or started before it don't have it, so they keep the schedule they've already been
 *  billed on. */
function signedOn(lease: any): string {
  return day10(lease?.activatedOn);
}

export function billingStart(lease: any): string | null {
  const first = day10(lease?.firstChargeDate) || day10(lease?.startDate);
  const started = signedOn(lease);
  if (!first) return started || null;
  return started && started > first ? started : first;
}

/**
 * The next calendar day on or after `fromIso` that this lease is billed. ONE rule for every part of the app: the
 * nightly bills, the catch-up, autopay, the portal and the rent page. The first bill is on the billing start (above);
 * after it, monthly leases bill on their due day (the month's last day when it's shorter) and the others every 1, 7 or
 * 14 days from the first charge date. Nothing after the lease's end date. Null when the lease has no usable schedule.
 */
export function nextChargeDate(lease: any, fromIso: string): string | null {
  const from = parts(fromIso);
  if (!from) return null;
  const freq: RentFrequency = lease?.frequency || 'monthly';
  const start = billingStart(lease);
  // Nothing past the end of a lease that doesn't renew itself (one that does is extended by the nightly job, so it
  // has no cutoff). lastChargeDate isn't a cutoff: autopay stamps it with each charge; an ended lease isn't billed.
  const end = lease?.autoRenew === true ? '' : day10(lease?.endDate);
  const within = (d: string | null) => (d && (!end || d <= end) ? d : null);
  if (start && String(fromIso).slice(0, 10) <= start) return within(start);
  return within(regularChargeDate(lease, from, freq));
}

/** A lease's regular schedule, without its first bill (the day after which it applies is `from`). */
function regularChargeDate(lease: any, from: { y: number; mo: number; d: number }, freq: RentFrequency): string | null {
  if (freq === 'monthly') {
    const dueDay = Number(lease?.dueDay);
    if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return null;
    // Same month if the day hasn't passed; otherwise next month. A due day
    // the month does not have falls on its last day — the cron now agrees, so
    // a lease due on the 31st drafts on Sep 30, not Oct 31.
    for (let k = 0; k < 2; k++) {
      let mo = from.mo + k, y = from.y;
      if (mo > 12) { mo -= 12; y += 1; }
      const d = Math.min(dueDay, daysInMonth(y, mo));
      if (k === 1 || d >= from.d) return iso(y, mo, d);
    }
    return null;
  }

  // Every 1, 7 or 14 days from the billing start for a lease signed late (a whole period between its first bill and the
  // next, not a full bill on the day it was signed and another a few days later); from the first charge date otherwise,
  // as leases already running have always been billed.
  const anchor = signedOn(lease) ? parts(billingStart(lease)) : (parts(lease?.firstChargeDate) || parts(lease?.startDate));
  if (!anchor) return null;
  const step = freq === 'daily' ? 1 : freq === 'weekly' ? 7 : 14;
  const a = Date.UTC(anchor.y, anchor.mo - 1, anchor.d);
  const f = Date.UTC(from.y, from.mo - 1, from.d);
  const diff = Math.round((f - a) / 86_400_000);
  const stepsAhead = diff <= 0 ? 0 : Math.ceil(diff / step);
  const next = new Date(a + stepsAhead * step * 86_400_000);
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

const addDays = (isoDay: string, n: number) => { const p = parts(isoDay)!; const t = new Date(Date.UTC(p.y, p.mo - 1, p.d) + n * 86_400_000); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };

/** Every billing day from `fromIso` through `toIso` (at most `max`), by the one rule above. */
export function dueDatesBetween(lease: any, fromIso: string, toIso: string, max = 120): string[] {
  const out: string[] = [];
  let from = String(fromIso).slice(0, 10);
  for (let i = 0; i < max; i++) {
    const d = nextChargeDate(lease, from);
    if (!d || d > toIso) break;
    out.push(d); from = addDays(d, 1);
  }
  return out;
}

/** Is this day one of the lease's regular billing days (as opposed to a first bill that falls between them)? */
export function isRegularDay(lease: any, dayIso: string): boolean {
  const p = parts(dayIso); if (!p) return false;
  return regularChargeDate(lease, p, (lease?.frequency || 'monthly') as RentFrequency) === String(dayIso).slice(0, 10);
}

/**
 * What a bill on `dueDate` is for. A monthly lease whose first bill falls partway into a period bills that first period
 * by the day: rent × days until the next due day ÷ days in that month, unless the lease says otherwise
 * (prorateFirst false: a full month). A first bill on a regular due day is a full month. Everything else is the rent.
 */
export function billCents(lease: any, dueDate: string): number {
  const rent = Math.max(0, Math.round(Number(lease?.rentAmountCents) || 0));
  if (lease?.prorateFirst === false || (lease?.frequency || 'monthly') !== 'monthly' || dueDate !== billingStart(lease) || isRegularDay(lease, dueDate)) return rent;
  const p = parts(dueDate); if (!p) return rent;
  const next = regularChargeDate(lease, parts(addDays(dueDate, 1))!, 'monthly');
  if (!next) return rent;
  const n = parts(next)!;
  const days = Math.round((Date.UTC(n.y, n.mo - 1, n.d) - Date.UTC(p.y, p.mo - 1, p.d)) / 86_400_000);
  const dim = daysInMonth(p.y, p.mo);
  return days >= dim ? rent : Math.round((rent * days) / dim);
}

/** The first bill, for showing before a lease is made: when it's due, what it's for and when the regular bills begin. */
export function firstBill(lease: any): { due: string; cents: number; prorated: boolean; nextDue: string | null } | null {
  const due = billingStart(lease); if (!due) return null;
  const cents = billCents(lease, due);
  return { due, cents, prorated: cents !== Math.max(0, Math.round(Number(lease?.rentAmountCents) || 0)), nextDue: nextChargeDate(lease, addDays(due, 1)) };
}

export type AutopayReadiness =
  | 'ready'            // will charge on the next date
  | 'no_card'          // autopay on, but nothing to charge
  | 'manual'           // autopay off — renter pays by hand
  | 'no_schedule';     // lease has no due day / anchor

export function autopayReadiness(lease: any, renter: any, businessAccount?: string | null): AutopayReadiness {
  if (!lease?.dueDay && !lease?.firstChargeDate) return 'no_schedule';
  if (!renter?.autopayEnabled) return 'manual';
  if (!renter?.stripeCustomerId || !(renter?.stripePaymentMethodId || renter?.defaultPaymentMethodId)) return 'no_card';
  // Autopay charges on the business's own account: a card saved on the platform's before the move has to be saved
  // again first (lib/space-stripe). Without the account at hand, the card is taken as it is.
  if (businessAccount !== undefined && !renterBusinessCard(renter, businessAccount)) return 'no_card';
  return 'ready';
}

export interface ScheduledCharge {
  leaseId: string;
  renterId: string;
  boothId: string;
  date: string;              // next charge date
  amountCents: number;
  frequency: RentFrequency;
  readiness: AutopayReadiness;
  /** The most recent autopay attempt on this lease, if any. */
  lastAttempt: { date: string; ok: boolean; note: string } | null;
}

/**
 * One row per active lease, soonest first. `ledger` is the rent ledger; an
 * autopay attempt is any rent_charge the cron wrote — success is 'paid', a
 * decline is left 'pending' with a "card declined" description.
 */
export function buildRentSchedule(
  leases: any[], renterById: Map<string, any>, ledger: any[], fromIso: string, businessAccount?: string | null,
): ScheduledCharge[] {
  const lastByLease = new Map<string, { date: string; ok: boolean; note: string }>();
  for (const e of ledger || []) {
    if (e?.type !== 'rent_charge' || !e.leaseId) continue;
    const desc = String(e.description || '');
    const isAutopay = /autopay/i.test(desc) || /card on file/i.test(String(e.paymentMethod || ''));
    if (!isAutopay) continue;
    const date = String(e.dueDate || e.createdAt || '').slice(0, 10);
    const prev = lastByLease.get(e.leaseId);
    if (!prev || date > prev.date) {
      lastByLease.set(e.leaseId, {
        date,
        ok: e.status === 'paid',
        note: e.status === 'paid' ? 'Paid' : (desc.match(/declined \(([^)]+)\)/)?.[1] || 'Declined'),
      });
    }
  }

  return (leases || [])
    .filter((l) => l?.status === 'active')
    .map((l) => {
      const date = nextChargeDate(l, fromIso);
      if (!date) return null;
      return {
        leaseId: l.id, renterId: l.renterId, boothId: l.boothId,
        date, amountCents: Number(l.rentAmountCents) || 0,
        frequency: (l.frequency || 'monthly') as RentFrequency,
        readiness: autopayReadiness(l, renterById.get(l.renterId), businessAccount),
        lastAttempt: lastByLease.get(l.id) || null,
      } as ScheduledCharge;
    })
    .filter(Boolean)
    .sort((a, b) => (a!.date.localeCompare(b!.date))) as ScheduledCharge[];
}
