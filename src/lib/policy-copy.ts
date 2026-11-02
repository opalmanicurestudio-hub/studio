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
import { hasTimeZone, tenantTimeZone } from '@/lib/tenant-time';
import { noShowWords } from '@/lib/booth-no-show';
import { publicService } from '@/lib/agent-access';

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

/** The cancellation rule for ONE booking, in a sentence, for the review before booking: "Free to cancel until Fri at
 *  3:30 PM, 24 hours before. After that, a $25 cancellation fee applies." Worked out exactly as bookingPolicyLines says
 *  it (the words the client agrees to), with the visit's own time. `start` and `now` are wall-clock times in the
 *  business's day ('2026-11-06T15:30'). '' when the business wrote its own cancellation policy (their words show). */
export function freeChangeLine(tenant: any, service: any, start: string, now: string, depositCents = 0): string {
  const t = tenant || {};
  if (t.cancellationPolicy) return '';
  const windowH = Number(service?.cancellationWindowHours || t.cancellationWindowHours || 0);
  if (!(windowH > 0)) return 'You can cancel any time from your visit link.';
  const s = wallMs(start), n = wallMs(now); if (s === null) return '';
  const kept = resolvePolicy(t, service).cancel.lateConsequence.value === 'deposit' && depositCents > 0;
  const fee = kept ? '' : feePhrase(t, service);
  const after = kept ? `the ${money(depositCents / 100)} deposit stays with ${String(t.name || '').trim() || 'the business'}` : fee ? `${fee} applies` : '';
  const cut = s - windowH * 3600000;
  const line = n !== null && cut <= n ? `It’s less than ${hrs(windowH)} away, so canceling after you book counts as late${after ? `: ${after}` : ''}.`
    : `Free to cancel until ${dayAt(cut, n)}, ${hrs(windowH)} before.${after ? ` After that, ${after}.` : ''}`;
  return line.replace(/\$(\d+)\.00\b/g, '$$$1');   // "$25", as the prices beside it are written
}
const wallMs = (x: string): number | null => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(x || '')); if (!m) return null; const v = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`); return Number.isFinite(v) ? v : null; };
/** A wall-clock moment said from today: "today at 3:30 PM", "tomorrow at 9:00 AM", "Fri at 3:30 PM", "Fri, Nov 13 at 3:30 PM". */
function dayAt(ms: number, nowMs: number | null): string {
  const d = new Date(ms); const h = d.getUTCHours(), mi = d.getUTCMinutes();
  const time = `${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  const days = nowMs === null ? 99 : Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Math.floor(nowMs / 86400000) * 86400000) / 86400000);
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 1 && days < 7 ? wd : `${wd}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return `${day} at ${time}`;
}

/** Beside "Change or cancel" on a visit link: until when it's free ("free until Thu 3:30 PM"), 'late' once that has
 *  passed, or '' when the business has its own written policy (their policy page says it in their words). The window
 *  is the one the server enforces (Booking policies, 24 hours unless set), counted from `startIso` — pass the deadline
 *  start (change-rules deadlineStart) so a moved booking counts from its original time when the business says so. The
 *  time is the business's clock when it has set its zone, otherwise this device's (as the rest of the screen). */
export function freeUntilWords(tenant: any, service: any, startIso: string, now: Date = new Date()): string {
  const t = tenant || {};
  if (t.cancellationPolicy) return '';
  const windowH = Number(resolvePolicy(t, service).cancel.windowHours.value) || 24;
  const start = Date.parse(startIso || ''); if (!Number.isFinite(start)) return '';
  const cut = start - windowH * 3600000;
  if (cut <= now.getTime()) return 'late';
  const zone = hasTimeZone(t) ? tenantTimeZone(t) : undefined;
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...(zone ? { timeZone: zone } : {}), ...o }).format(new Date(cut));
  const dayKey = (d: number) => new Intl.DateTimeFormat('en-CA', zone ? { timeZone: zone } : {}).format(new Date(d));
  const days = Math.round((Date.parse(dayKey(cut)) - Date.parse(dayKey(now.getTime()))) / 86400000);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? fmt({ weekday: 'short' }) : fmt({ weekday: 'short', month: 'short', day: 'numeric' });
  return `free until ${day} ${fmt({ hour: 'numeric', minute: '2-digit' })}`;
}

/** The policy lines a client should see with a booking (short; plain words). */
export function bookingPolicyLines(tenant: any, service?: any, opts: { depositCents?: number; anyDeposit?: boolean } = {}): string[] {
  const t = tenant || {}; const out: string[] = [];
  const windowH = Number(service?.cancellationWindowHours || t.cancellationWindowHours || 0);
  const dep0 = Number(opts.depositCents || 0);
  const lc = resolvePolicy(t, service).cancel.lateConsequence.value;
  // "Deposit only" with a deposit on this booking → inside the window the deposit is kept instead of a fee.
  const fee = lc === 'deposit' && dep0 > 0 ? 'your deposit is kept' : feePhrase(t, service);
  if (t.cancellationPolicy) out.push(`Cancellation policy: ${clip(t.cancellationPolicy)}`);
  else if (windowH > 0) out.push(`You're welcome to change or cancel your appointment from your visit link up to ${hrs(windowH)} before it starts.${fee ? ` ${/kept$/.test(fee) ? `If you cancel within ${hrs(windowH)} of your appointment, we'll keep your deposit.` : `If you cancel within ${hrs(windowH)} of your appointment, ${fee} applies.`}` : ''}`);
  else out.push("You're welcome to change or cancel your appointment at any time from your visit link.");
  // Moving a booking — the rules now in force (change-rules.ts).
  const ch = resolvePolicy(t, service).change;
  const cut = Number(ch.cutoffHours.value) || 0, lim = Number(ch.limit.value) || 0;
  const moveBits = [cut > 0 ? `Online rescheduling closes ${hrs(cut)} before your appointment.` : null,
    lim > 0 ? `You can reschedule online up to ${lim} time${lim === 1 ? '' : 's'}${ch.overLimit.value === 'approval' ? '. After that, you can still request a change from your visit link' : ''}.` : null,
    ch.deadline.value === 'original' ? 'A rescheduled appointment keeps its original cancellation deadline.' : null].filter(Boolean) as string[];
  if (moveBits.length) out.push(`Rescheduling policy: ${moveBits.join(' ')}`);
  const rf = Number(t.rescheduleFee || 0), rw = Number(t.rescheduleFeeWindowHours || 0);
  if (rf > 0 && rw > 0) out.push(`If you move your appointment within ${hrs(rw)} of its start time, a ${money(rf)} rescheduling fee applies.`);
  // Extra time / product the client asks for — only said when the business actually suggests those charges, and only
  // for services timed by the provider (never rentals or classes).
  const auto = t.automations || {}; const tp = t.timingPolicy || {};
  if ((auto.overtimeSuggest === true || auto.extraProductSuggest === true) && (!service || !service.timedBy || service.timedBy === 'provider')) {
    const bits: string[] = [];
    if (auto.overtimeSuggest === true) bits.push(`extra time you ask for beyond your booking is charged ${tp.pricing === 'per_block' ? `at ${money(Number(tp.blockPrice) || 0)} per ${Number(tp.blockMinutes) || 15} minutes` : 'at the service’s standard rate'}, after the first ${Number(tp.graceMinutes ?? 15)} minutes, which are on us`);
    if (auto.extraProductSuggest === true && tp.extraProduct !== 'off') bits.push(`extra product you ask for is charged${tp.extraProduct === 'cost' ? ' at cost' : ''}`);
    if (bits.length) out.push(`Please note: ${bits.join(', and ')}.`);
  }
  const dep = Number(opts.depositCents || 0);
  if (dep > 0 || opts.anyDeposit) {   // anyDeposit: the booking page's full policy, said of deposits in general
    const p = resolveDepositPolicy(t);
    const early = p.onEarlyCancel === 'rollover' ? `we'll save it as credit toward your next visit${p.rolloverExpiryDays ? ` (valid for ${p.rolloverExpiryDays} days)` : ''}` : p.onEarlyCancel === 'refund' ? "we'll refund it" : "we'll keep it";
    out.push(`Deposit policy: ${dep > 0 ? `Your ${money(dep / 100)} deposit` : 'A deposit'} goes toward your total on the day of your appointment. If you cancel at least ${hrs(p.refundWindowHours)} in advance, ${early}. If you cancel later than that${p.onLateCancel === 'forfeit' ? (lc === 'fee' ? ", we'll save it as credit and the cancellation fee will apply" : lc === 'deposit' ? ", we'll keep it and there's no additional fee" : ", we'll keep it and put it toward the cancellation fee") : p.onLateCancel === 'rollover' ? ", we'll save it as credit" : ", we'll refund it"}.${p.onNoShow === 'forfeit' ? " If an appointment is missed without notice, we'll keep the deposit." : ''}`);
  }
  const grace = Number(t.lateArrivalGracePeriod || 0);
  if (t.lateArrivalPolicy) out.push(`Late arrival policy: ${clip(t.lateArrivalPolicy)}`);
  else out.push(`If you're running late, please let us know from your visit link and we'll talk you through your options.${grace > 0 ? ` We can usually hold your appointment for up to ${grace} minutes.` : ''}`);
  if (noShowWords(t)) out.push(`Missed appointment policy: ${clip(noShowWords(t))}`);
  // What happens if a change fee can't be charged — only when the business charges change fees.
  if (Number(t.rescheduleFee) > 0 || resolvePolicy(t).cancel.feeMode.value !== 'none') out.push(unpaidFeeLine(unpaidFeeRuleOf(t)));
  out.push(...graceLines(t));   // the grace allowances, so clients know what flexibility exists
  if (t.makingItRight) out.push(clientPolicyLine(settingsOf(t)));   // Making it right — agreed to with the rest when booking
  return out;
}

/** Whether deposits are actually collected: the business's master switch (Settings › Bookings), whatever each service
 *  says, and the services that take one. */
export function liveDeposits(tenant: any, services: any[] = []) {
  if (tenant?.depositsLive !== true) return [];
  return services.filter(publicService).map((s) => resolvePolicy(tenant, s).deposit).filter((d) => d.required.value);
}

/** "Before you book" on the booking page: the few rules a new client most needs, short, from the same settings and
 *  written policies as every message — and only the ones the business has actually set (an untouched default is never
 *  presented as their rule). The full wording is bookingPolicyLines. */
export function pagePolicies(tenant: any, services: any[] = []): { title: string; text: string }[] {
  const t = tenant || {}; const out: { title: string; text: string }[] = []; const short = (x: any) => clip(x, 160);
  const whole = (x: string) => x.replace(/\$(\d+)\.00\b/g, '$$$1');   // "$25", not "$25.00", in a short line
  const live = services.filter(publicService);
  const deposits = liveDeposits(t, live);
  // Changing or canceling: their written policy, or the window (and fee) they set. A service with its own rules is noted.
  const windowH = Number(t.cancellationWindowHours || 0); const lc = resolvePolicy(t).cancel.lateConsequence.value;
  const own = live.some((s) => { const c = resolvePolicy(t, s).cancel; return c.windowHours.source === 'service' || c.feeMode.source === 'service' || c.feeValue.source === 'service'; });
  const differs = own ? ' Some services have their own; you’ll see theirs when you book.' : '';
  if (t.cancellationPolicy) out.push({ title: 'Changing or canceling', text: short(t.cancellationPolicy) });
  else if (windowH > 0) {
    const fee = feePhrase(t);
    const later = lc === 'deposit' && deposits.length ? ' Later than that, a deposit is kept.' : fee ? ` Later than that, ${fee}.` : '';
    out.push({ title: 'Changing or canceling', text: whole(`Free up to ${hrs(windowH)} before.${later}${differs}`) });
  }
  // Running late: their written policy, or the grace time / fee they set.
  const late = resolvePolicy(t).late; const lateFee = Number(late.fee.value) || 0;
  if (t.lateArrivalPolicy) out.push({ title: 'Running late', text: short(t.lateArrivalPolicy) });
  else if (late.graceMinutes.source === 'business' || lateFee > 0) {
    const grace = Number(late.graceMinutes.value) || 0;
    out.push({ title: 'Running late', text: whole(`${grace > 0 ? `We hold your time for ${grace} minutes, then ${late.autoCancel.value ? 'it may be canceled' : 'may need to shorten your service'}.` : 'Please be on time; a late start may need to be shortened.'}${lateFee > 0 ? ` A ${money(lateFee)} late fee may apply.` : ''}`) });
  }
  // Deposits: only when they're collected. Paid in full is said as that, not as a deposit.
  if (deposits.length) {
    const full = deposits.filter((d) => d.kind.value === 'full'), part = deposits.filter((d) => d.kind.value !== 'full');
    const all = deposits.length === live.length;
    const bits: string[] = [];
    if (part.length) {
      const flat = part.every((d) => d.kind.value === 'flat') ? [...new Set(part.map((d) => Number(d.amount.value) || 0))] : [];
      const amount = flat.length === 1 && flat[0] > 0 ? whole(`a ${money(flat[0])} deposit`) : 'a deposit';
      const toward = part.every((d) => d.appliesToBalance.value !== false) ? ' It goes toward your visit.' : '';
      bits.push(`${all && !full.length ? 'Each booking takes' : 'Some services take'} ${amount}.${toward}`);
    }
    if (full.length) bits.push(`${all && !part.length ? 'Each booking is' : 'Some services are'} paid in full when you book.`);
    out.push({ title: 'Deposits', text: bits.join(' ') });
  }
  if (noShowWords(t)) out.push({ title: 'Missed appointments', text: short(noShowWords(t)) });
  return out;
}

/** How long an unpaid booking is held, in words. */
export function holdLine(tenant: any, until?: Date | null): string {
  const t = tenant || {};
  const due = until || new Date(Date.now() + (Number(t.bookingMode?.holdMinutes) > 0 ? Number(t.bookingMode.holdMinutes) : 30) * 60000);
  return `We're holding this time for you until ${due.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: t.timezone || undefined })}. After that, it will be released so other clients can book it.`;
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
  if (o.who === 'studio') out.push("We're truly sorry to have to cancel your appointment. There's no charge to you for this cancellation.");
  if (o.who !== 'studio' && fee > 0) {
    if (o.collected === 'waived') out.push(`${will ? "We'll waive" : "We've waived"} the ${money(fee)} ${o.who === 'no_show' ? 'missed appointment' : 'late cancellation'} fee this time.`);
    else {
      out.push(o.who === 'no_show' ? `Because we weren't able to see you for your appointment, our missed appointment fee of ${money(fee)} applies.` : `Because your appointment was canceled within our cancellation notice period, our late cancellation fee of ${money(fee)} applies.`);
      if (applied > 0) out.push(`Your ${money(applied)} deposit goes toward this fee${due > 0 ? `, leaving ${money(due)}` : ', which covers it in full'}.`);
      if (due > 0) out.push(o.collected === 'card' ? `${will ? "We'll charge" : "We've charged"} ${money(due)} to your card${o.cardLast4 ? ` ending in ${o.cardLast4}` : ''}.` : `The ${money(due)} will be due at your next visit.`);
    }
  } else if (o.who !== 'studio') out.push("There's no charge for this cancellation.");
  const d = o.deposit;
  if (d && d.dollars > 0 && d.outcome !== 'applied') {
    out.push(d.outcome === 'refund' ? `${will ? "We'll refund" : "We're refunding"} your ${money(d.dollars)} deposit to your card. Refunds usually appear within 3 to 5 business days.`
      : d.outcome === 'store_credit' || d.outcome === 'rollover' ? `${will ? "We'll save" : "We've saved"} your ${money(d.dollars)} deposit as credit toward your next visit.`
      : `Under our deposit policy, ${will ? "we'll keep" : "we've kept"} your ${money(d.dollars)} deposit.`);
  }
  if (Number(o.goodwillDollars || 0) > 0) out.push(`As a thank-you for your understanding, we've added ${money(Number(o.goodwillDollars))} in credit to your account.`);
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
