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

export type RentFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

const parts = (v: any) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
};
const iso = (y: number, mo: number, d: number) =>
  `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/**
 * The next calendar day on or after `fromIso` that the cron would charge
 * this lease. Returns null when the lease has no usable schedule.
 */
export function nextChargeDate(lease: any, fromIso: string): string | null {
  const from = parts(fromIso);
  if (!from) return null;
  const freq: RentFrequency = lease?.frequency || 'monthly';

  if (freq === 'monthly') {
    const dueDay = Number(lease?.dueDay);
    if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return null;
    // Same month if the day hasn't passed; otherwise the next month that HAS
    // that day. This mirrors the cron exactly: it compares day-of-month, so a
    // lease due on the 31st is not charged at all in a 30-day month and a
    // lease due on the 29th–31st skips February. Showing the true next date
    // is the point — a schedule that shows a charge the cron will never make
    // is worse than none. (That cron behaviour is itself worth fixing; when
    // it is, this clamp goes with it.)
    for (let k = 0; k < 13; k++) {
      let mo = from.mo + k, y = from.y;
      while (mo > 12) { mo -= 12; y += 1; }
      if (dueDay > daysInMonth(y, mo)) continue;
      if (k === 0 && dueDay < from.d) continue;
      return iso(y, mo, dueDay);
    }
    return null;
  }

  const anchor = parts(lease?.firstChargeDate);
  if (!anchor) return null;
  const step = freq === 'daily' ? 1 : freq === 'weekly' ? 7 : 14;
  const a = Date.UTC(anchor.y, anchor.mo - 1, anchor.d);
  const f = Date.UTC(from.y, from.mo - 1, from.d);
  const diff = Math.round((f - a) / 86_400_000);
  const stepsAhead = diff <= 0 ? 0 : Math.ceil(diff / step);
  const next = new Date(a + stepsAhead * step * 86_400_000);
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export type AutopayReadiness =
  | 'ready'            // will charge on the next date
  | 'no_card'          // autopay on, but nothing to charge
  | 'manual'           // autopay off — renter pays by hand
  | 'no_schedule';     // lease has no due day / anchor

export function autopayReadiness(lease: any, renter: any): AutopayReadiness {
  if (!lease?.dueDay && !lease?.firstChargeDate) return 'no_schedule';
  if (!renter?.autopayEnabled) return 'manual';
  if (!renter?.stripeCustomerId || !(renter?.stripePaymentMethodId || renter?.defaultPaymentMethodId)) return 'no_card';
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
  leases: any[], renterById: Map<string, any>, ledger: any[], fromIso: string,
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
        readiness: autopayReadiness(l, renterById.get(l.renterId)),
        lastAttempt: lastByLease.get(l.id) || null,
      } as ScheduledCharge;
    })
    .filter(Boolean)
    .sort((a, b) => (a!.date.localeCompare(b!.date))) as ScheduledCharge[];
}
