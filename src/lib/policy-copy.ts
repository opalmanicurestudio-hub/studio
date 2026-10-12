import { settingsOf, clientPolicyLine } from '@/lib/making-it-right';
// src/lib/policy-copy.ts — WHAT CLIENTS ARE TOLD ABOUT YOUR POLICIES, in one place.
//
// Every client message (confirmation, hold, reminder, reschedule, deposit link,
// cancellation) takes its policy wording from here, so it always matches the
// business's actual settings — and the business's own written policy is used
// where they wrote one (their voice), with the numbers from settings otherwise.
// Pure functions: safe on the server and in the browser.

import { resolveDepositPolicy } from '@/lib/deposit-policy';
import { resolvePolicy, unpaidFeeLine, unpaidFeeRuleOf } from '@/lib/booking-policies';
import { graceLines } from '@/lib/grace';

const money = (d: number) => `$${(Math.round(d * 100) / 100).toFixed(2)}`;
const hrs = (h: number) => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : `${h} hour${h === 1 ? '' : 's'}`); // "24 hours", "2 days"
const clip = (t: any, n = 240) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };

/** The cancellation fee, described (flat amount, % of the service, or "a fee"). */
function feePhrase(tenant: any, service?: any): string | null {
  // Unset → 'matrix' — the same default the cancellation screen charges with.
  const mode = service?.cancellationFeeMode && service.cancellationFeeMode !== 'inherit' ? service.cancellationFeeMode : (tenant?.defaultCancellationMode || 'matrix');
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
  if (t.cancellationPolicy) out.push(`Cancellation policy: ${clip(t.cancellationPolicy)}`);
  else if (windowH > 0) out.push(`You may change or cancel your appointment from your visit link up to ${hrs(windowH)} before its start time.${fee ? ` ${/kept$/.test(fee) ? `If you cancel within ${hrs(windowH)} of your appointment, your deposit will be retained.` : `Cancellations made within ${hrs(windowH)} of your appointment are subject to ${fee}.`}` : ''}`);
  else out.push('You may change or cancel your appointment at any time from your visit link.');
  // Moving a booking — the rules now in force (change-rules.ts).
  const ch = resolvePolicy(t, service).change;
  const cut = Number(ch.cutoffHours.value) || 0, lim = Number(ch.limit.value) || 0;
  const moveBits = [cut > 0 ? `Online rescheduling closes ${hrs(cut)} before your appointment.` : null,
    lim > 0 ? `You may reschedule online up to ${lim} time${lim === 1 ? '' : 's'}${ch.overLimit.value === 'approval' ? ', after which you can request a change from your visit link' : ''}.` : null,
    ch.deadline.value === 'original' ? 'A rescheduled appointment keeps its original cancellation deadline.' : null].filter(Boolean) as string[];
  if (moveBits.length) out.push(`Rescheduling policy: ${moveBits.join(' ')}`);
  const rf = Number(t.rescheduleFee || 0), rw = Number(t.rescheduleFeeWindowHours || 0);
  if (rf > 0 && rw > 0) out.push(`Appointments moved within ${hrs(rw)} of their start time are subject to a ${money(rf)} rescheduling fee.`);
  // Extra time / product the client asks for — only said when the business actually suggests those charges, and only
  // for services timed by the provider (never rentals or classes).
  const auto = t.automations || {}; const tp = t.timingPolicy || {};
  if ((auto.overtimeSuggest === true || auto.extraProductSuggest === true) && (!service || !service.timedBy || service.timedBy === 'provider')) {
    const bits: string[] = [];
    if (auto.overtimeSuggest === true) bits.push(`additional time you request beyond your booking is charged ${tp.pricing === 'per_block' ? `at ${money(Number(tp.blockPrice) || 0)} per ${Number(tp.blockMinutes) || 15} minutes` : 'at the service’s standard rate'}, after the first ${Number(tp.graceMinutes ?? 15)} minutes, which are complimentary`);
    if (auto.extraProductSuggest === true && tp.extraProduct !== 'off') bits.push(`additional product you request is charged${tp.extraProduct === 'cost' ? ' at cost' : ''}`);
    if (bits.length) out.push(`Please note: ${bits.join(', and ')}.`);
  }
  const dep = Number(opts.depositCents || 0);
  if (dep > 0) {
    const p = resolveDepositPolicy(t);
    const early = p.onEarlyCancel === 'rollover' ? `it will be saved as credit toward your next visit${p.rolloverExpiryDays ? ` (valid for ${p.rolloverExpiryDays} days)` : ''}` : p.onEarlyCancel === 'refund' ? 'it will be refunded' : 'it will be retained';
    out.push(`Deposit policy: Your ${money(dep / 100)} deposit will be applied toward your total on the day of your appointment. If you cancel at least ${hrs(p.refundWindowHours)} in advance, ${early}. If you cancel later than that${p.onLateCancel === 'forfeit' ? (lc === 'fee' ? ', it will be saved as credit and the cancellation fee will apply' : lc === 'deposit' ? ', it will be retained and no additional fee will apply' : ', it will be retained and applied toward the cancellation fee') : p.onLateCancel === 'rollover' ? ', it will be saved as credit' : ', it will be refunded'}.${p.onNoShow === 'forfeit' ? ' If an appointment is missed without notice, the deposit will be retained.' : ''}`);
  }
  const grace = Number(t.lateArrivalGracePeriod || 0);
  if (t.lateArrivalPolicy) out.push(`Late arrival policy: ${clip(t.lateArrivalPolicy)}`);
  else out.push(`If you are running late, please let us know from your visit link and we will advise you of your options.${grace > 0 ? ` We can usually hold your appointment for up to ${grace} minutes.` : ''}`);
  if (t.noShowPolicy) out.push(`Missed appointment policy: ${clip(t.noShowPolicy)}`);
  // What happens if a change fee can't be charged — only when the business charges change fees.
  if (Number(t.rescheduleFee) > 0 || resolvePolicy(t).cancel.feeMode.value !== 'none') out.push(unpaidFeeLine(unpaidFeeRuleOf(t)));
  out.push(...graceLines(t));   // the grace allowances, so clients know what flexibility exists
  if (t.makingItRight) out.push(clientPolicyLine(settingsOf(t)));   // Making it right — agreed to with the rest when booking
  return out;
}

/** How long an unpaid booking is held, in words. */
export function holdLine(tenant: any, until?: Date | null): string {
  const t = tenant || {};
  const due = until || new Date(Date.now() + (Number(t.bookingMode?.holdMinutes) > 0 ? Number(t.bookingMode.holdMinutes) : 30) * 60000);
  return `We are holding this time for you until ${due.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: t.timezone || undefined })}. After that, it will be released and made available to other clients.`;
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
export function cancellationOutcomeLines(o: CancelOutcome, opts: { preview?: boolean } = {}): string[] {
  const out: string[] = []; const will = !!opts.preview; // preview = BEFORE it happens ("will be")
  const fee = Number(o.feeDollars || 0), applied = Number(o.depositAppliedDollars || 0), due = Math.max(0, fee - applied);
  if (o.who === 'studio') out.push('We sincerely apologize for having to cancel your appointment. There is no charge to you for this cancellation.');
  if (o.who !== 'studio' && fee > 0) {
    if (o.collected === 'waived') out.push(`${will ? 'We will waive' : 'We have waived'} the ${money(fee)} ${o.who === 'no_show' ? 'missed appointment' : 'late cancellation'} fee on this occasion.`);
    else {
      out.push(o.who === 'no_show' ? `As we were not able to see you for your appointment, a missed appointment fee of ${money(fee)} applies, in line with our cancellation policy.` : `As your appointment was cancelled within our cancellation notice period, a late cancellation fee of ${money(fee)} applies, in line with our cancellation policy.`);
      if (applied > 0) out.push(`Your ${money(applied)} deposit has been applied toward this fee${due > 0 ? `, leaving ${money(due)}` : ', which covers it in full'}.`);
      if (due > 0) out.push(o.collected === 'card' ? `${will ? 'We will charge' : 'We have charged'} ${money(due)} to your card${o.cardLast4 ? ` ending in ${o.cardLast4}` : ''}.` : `The amount of ${money(due)} will be due at your next visit.`);
    }
  } else if (o.who !== 'studio') out.push('There is no charge for this cancellation.');
  const d = o.deposit;
  if (d && d.dollars > 0 && d.outcome !== 'applied') {
    out.push(d.outcome === 'refund' ? `Your ${money(d.dollars)} deposit ${will ? 'will be' : 'is being'} refunded to your card. Refunds usually appear within 3 to 5 business days.`
      : d.outcome === 'store_credit' || d.outcome === 'rollover' ? `Your ${money(d.dollars)} deposit ${will ? 'will be' : 'has been'} saved as credit toward your next visit.`
      : `Your ${money(d.dollars)} deposit ${will ? 'will be' : 'has been'} retained, in line with our deposit policy.`);
  }
  if (Number(o.goodwillDollars || 0) > 0) out.push(`As a gesture of goodwill, we have added ${money(Number(o.goodwillDollars))} in credit to your account.`);
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
  /** Grace allowance: the deposit moves to a new booking (credit) instead of being kept. */
  transferDeposit?: boolean;
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
  if (i.transferDeposit && i.who !== 'studio' && dep > 0) depOutcome = 'rollover';   // grace: the deposit moves to a new booking
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
