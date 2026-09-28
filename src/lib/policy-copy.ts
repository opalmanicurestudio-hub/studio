// src/lib/policy-copy.ts — WHAT CLIENTS ARE TOLD ABOUT YOUR POLICIES, in one place.
//
// Every client message (confirmation, hold, reminder, reschedule, deposit link,
// cancellation) takes its policy wording from here, so it always matches the
// business's actual settings — and the business's own written policy is used
// where they wrote one (their voice), with the numbers from settings otherwise.
// Pure functions: safe on the server and in the browser.

import { resolveDepositPolicy } from '@/lib/deposit-policy';
import { resolvePolicy } from '@/lib/booking-policies';

const money = (d: number) => `$${(Math.round(d * 100) / 100).toFixed(2)}`;
const hrs = (h: number) => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : `${h} hour${h === 1 ? '' : 's'}`); // "24 hours", "2 days"
const clip = (t: any, n = 240) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };

/** The cancellation fee, described (flat amount, % of the service, or "a fee"). */
function feePhrase(tenant: any, service?: any): string | null {
  const mode = service?.cancellationFeeMode && service.cancellationFeeMode !== 'inherit' ? service.cancellationFeeMode : (tenant?.defaultCancellationMode || (Number(tenant?.cancellationFee) > 0 ? 'flat' : null));
  const svcFlat = Number(service?.cancellationFeeValue ?? service?.customCancellationFee ?? 0);
  if (mode === 'flat') { const v = svcFlat > 0 ? svcFlat : Number(tenant?.cancellationFee || 0); return v > 0 ? `a ${money(v)} cancellation fee` : null; }
  if (mode === 'percentage') { const pct = Number(service?.cancellationFeeValue) > 0 ? Number(service.cancellationFeeValue) : 100; return `a cancellation fee of ${pct}% of the service`; }
  if (mode === 'matrix') return 'a cancellation fee';
  return null;
}

/** The policy lines a client should see with a booking (short; plain words). */
export function bookingPolicyLines(tenant: any, service?: any, opts: { depositCents?: number } = {}): string[] {
  const t = tenant || {}; const out: string[] = [];
  const windowH = Number(service?.cancellationWindowHours || t.cancellationWindowHours || 0);
  const dep0 = Number(opts.depositCents || 0);
  const lc = resolvePolicy(t, service).cancel.lateConsequence.value;
  // "Deposit only" with a deposit on this booking → inside the window the deposit is kept instead of a fee.
  const fee = lc === 'deposit' && dep0 > 0 ? 'your deposit is kept' : feePhrase(t, service);
  if (t.cancellationPolicy) out.push(`Cancellations: ${clip(t.cancellationPolicy)}`);
  else if (windowH > 0) out.push(`Need to change or cancel? Do it from your visit link at least ${hrs(windowH)} ahead${fee ? ` — inside that, ${fee}${/kept$/.test(fee) ? '' : ' applies'}` : ''}.`);
  else out.push('Need to change or cancel? You can do it any time from your visit link.');
  const rf = Number(t.rescheduleFee || 0), rw = Number(t.rescheduleFeeWindowHours || 0);
  if (rf > 0 && rw > 0) out.push(`Moving it within ${hrs(rw)} of the time carries a ${money(rf)} reschedule fee.`);
  const dep = Number(opts.depositCents || 0);
  if (dep > 0) {
    const p = resolveDepositPolicy(t);
    const early = p.onEarlyCancel === 'rollover' ? `it becomes credit for your next visit${p.rolloverExpiryDays ? ` (good for ${p.rolloverExpiryDays} days)` : ''}` : p.onEarlyCancel === 'refund' ? 'it’s refunded' : 'it’s kept';
    out.push(`Your ${money(dep / 100)} deposit comes off your total on the day. If you cancel at least ${hrs(p.refundWindowHours)} ahead, ${early}; later than that${p.onLateCancel === 'forfeit' ? (lc === 'fee' ? ', it becomes credit and the cancellation fee applies' : lc === 'deposit' ? ', it’s kept (no extra fee)' : ', it’s kept and counts toward the cancellation fee') : p.onLateCancel === 'rollover' ? ', it becomes credit' : ', it’s refunded'}${p.onNoShow === 'forfeit' ? ', as it is if you don’t come' : ''}.`);
  }
  const grace = Number(t.lateArrivalGracePeriod || 0);
  if (t.lateArrivalPolicy) out.push(`Running late: ${clip(t.lateArrivalPolicy)}`);
  else out.push(`Running late? Tell us from your visit link — we’ll let you know your options${grace > 0 ? ` (we can usually hold your time for ${grace} minutes)` : ''}.`);
  if (t.noShowPolicy) out.push(`Missed appointments: ${clip(t.noShowPolicy)}`);
  return out;
}

/** How long an unpaid booking is held, in words. */
export function holdLine(tenant: any, until?: Date | null): string {
  const t = tenant || {};
  const due = until || new Date(Date.now() + (Number(t.bookingMode?.holdMinutes) > 0 ? Number(t.bookingMode.holdMinutes) : 30) * 60000);
  return `We’re holding this time until ${due.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: t.timezone || undefined })} — after that it goes back on sale.`;
}

export interface CancelOutcome {
  who: 'client' | 'no_show' | 'studio';
  feeDollars?: number;               // the fee under the policy
  depositAppliedDollars?: number;    // the deposit counted toward that fee
  collected?: 'card' | 'balance' | 'waived' | 'none';
  cardLast4?: string | null;
  deposit?: { dollars: number; outcome: 'refund' | 'store_credit' | 'rollover' | 'forfeit' | 'applied' } | null;
  goodwillDollars?: number;
}

/** The lines telling a client what happened — matching what was actually done. */
export function cancellationOutcomeLines(o: CancelOutcome): string[] {
  const out: string[] = [];
  const fee = Number(o.feeDollars || 0), applied = Number(o.depositAppliedDollars || 0), due = Math.max(0, fee - applied);
  if (o.who === 'studio') out.push('We’re sorry to cancel on you — there’s no charge for this.');
  if (o.who !== 'studio' && fee > 0) {
    if (o.collected === 'waived') out.push(`We’ve waived the ${money(fee)} ${o.who === 'no_show' ? 'missed-appointment' : 'late-cancellation'} fee this time.`);
    else {
      out.push(`Under our policy, a ${money(fee)} ${o.who === 'no_show' ? 'missed-appointment' : 'late-cancellation'} fee applies.`);
      if (applied > 0) out.push(`Your ${money(applied)} deposit goes toward it${due > 0 ? `, leaving ${money(due)}` : ' and covers it in full'}.`);
      if (due > 0) out.push(o.collected === 'card' ? `${money(due)} was charged to your card${o.cardLast4 ? ` ending ${o.cardLast4}` : ''}.` : `${money(due)} will be due at your next visit.`);
    }
  } else if (o.who !== 'studio') out.push('There’s no charge for this cancellation.');
  const d = o.deposit;
  if (d && d.dollars > 0 && d.outcome !== 'applied') {
    out.push(d.outcome === 'refund' ? `Your ${money(d.dollars)} deposit is being refunded to your card (usually 3–5 business days).`
      : d.outcome === 'store_credit' || d.outcome === 'rollover' ? `Your ${money(d.dollars)} deposit is saved as credit for your next visit.`
      : `Your ${money(d.dollars)} deposit is kept, as set out in our policy.`);
  }
  if (Number(o.goodwillDollars || 0) > 0) out.push(`We’ve added ${money(Number(o.goodwillDollars))} of credit to say sorry.`);
  return out;
}

/** Work out a cancellation's outcome from the business's policy — BEFORE anything
 *  is done — so what staff see, what's collected and what the client is told
 *  all agree. A deposit the policy keeps (late cancel / no-show) counts toward
 *  the fee; only the rest is collected. Pure — tested on its own. */
export function planCancellation(i: {
  who: CancelOutcome['who']; feeDollars: number; policyFeeDollars: number; chargeFee: boolean;
  depositDollars: number; hoursUntilStart: number; depositPolicy: { refundWindowHours: number; onEarlyCancel: string; onLateCancel: string; onNoShow: string };
  studioDisposition?: 'refund' | 'store_credit'; collectPref: 'card' | 'balance'; hasCard: boolean; cardLast4?: string | null; goodwillDollars?: number;
  /** Late cancellation: 'both' (default — the deposit counts toward the fee), 'fee' (deposit becomes credit, full fee), 'deposit' (deposit kept, no fee). */
  lateConsequence?: 'both' | 'fee' | 'deposit';
}): { outcome: CancelOutcome; due: number; applied: number; waived: boolean; fee: number } {
  const dp = i.depositPolicy; const dep = Math.max(0, Number(i.depositDollars) || 0);
  let depOutcome = i.who === 'studio' ? (i.studioDisposition === 'store_credit' ? 'store_credit' : 'refund') : i.who === 'no_show' ? dp.onNoShow : (i.hoursUntilStart >= dp.refundWindowHours ? dp.onEarlyCancel : dp.onLateCancel);
  let fee = i.who === 'studio' ? 0 : Math.max(0, Number(i.feeDollars) || 0);
  // The business's late-cancellation choice (a late client cancel is one where the deposit would be kept).
  const lc = i.lateConsequence || 'both';
  if (i.who === 'client' && depOutcome === 'forfeit' && dep > 0) {
    if (lc === 'fee') depOutcome = 'rollover';          // fee only → their deposit comes back as credit
    else if (lc === 'deposit') fee = 0;                 // deposit only → no fee on top
  }
  const policyFee = i.who === 'studio' ? 0 : Math.max(0, Number(i.policyFeeDollars) || 0);
  const waived = i.who !== 'studio' && !i.chargeFee && policyFee > 0;
  const applied = !waived && depOutcome === 'forfeit' && fee > 0 ? Math.min(dep, fee) : 0;
  const due = waived ? 0 : Math.round(Math.max(0, fee - applied) * 100) / 100;
  const left = Math.round((dep - applied) * 100) / 100;
  const outcome: CancelOutcome = { who: i.who, feeDollars: waived ? policyFee : fee, depositAppliedDollars: applied,
    collected: waived ? 'waived' : due <= 0 ? 'none' : (i.collectPref === 'card' && i.hasCard ? 'card' : 'balance'), cardLast4: i.cardLast4 || null,
    deposit: dep > 0 ? { dollars: applied > 0 ? left : dep, outcome: applied > 0 ? (left > 0 ? (depOutcome as any) : 'applied') : (depOutcome as any) } : null,
    goodwillDollars: i.who === 'studio' && i.studioDisposition === 'store_credit' ? Number(i.goodwillDollars) || 0 : 0 };
  return { outcome, due, applied, waived, fee };
}
