// src/lib/outreach-guard.ts — who the business's optional outreach leaves out. One answer for every sender: campaigns
// and automations, opportunities, win-back reminders, loyalty texts, review asks, gift card notes, the waitlist.
//
//   not_booked  a client the business no longer sees (status banned or blocked). Left out of everything optional.
//   owes        an unpaid balance. Left out of invitations until it is settled. The owner can turn this off.
//   policy      a record that counts against them: more missed or canceled visits than the strikes the owner
//               allows (deposit-policy isPoorHistory, the same rule that asks them for a deposit). Left out of
//               invitations. The owner can turn this off.
//
// 'invite' is anything that asks them to book or buy: offers, win-backs, rebooking nudges, loyalty and review asks.
// 'service' is about something they already have or asked for (a quote, money on a gift card, a waitlist spot, a
// membership payment): only not_booked holds those. Appointment confirmations, reminders and receipts never come here.

import { isPoorHistory } from '@/lib/deposit-policy';

export type OutreachHold = 'not_booked' | 'owes' | 'policy';
export type OutreachKind = 'invite' | 'service';

export interface OutreachRules { skipOwing: boolean; skipPoorHistory: boolean }

/** The owner's choices (Settings → Booking policies → Who offers and reminders leave out). Both on unless turned off. */
export function outreachRules(tenant: any): OutreachRules {
  const r = (tenant && tenant.outreachRules) || {};
  return { skipOwing: r.skipOwing !== false, skipPoorHistory: r.skipPoorHistory !== false };
}

/** A renter's own clients (their campaigns, opportunities and win-backs): only "not booked anymore" holds them, until
 *  renters have choices of their own. The business's balance and missed-visit rules aren't theirs to see or change. */
export const RENTER_RULES = { outreachRules: { skipOwing: false, skipPoorHistory: false } };

/** The business no longer books them. */
export const notBooked = (c: any): boolean => !!c && (c.status === 'banned' || c.status === 'blocked');

/** An unpaid balance (dollars, as the client card keeps it). */
export const owesBalance = (c: any): boolean => { const n = Number(c?.outstandingBalance); return Number.isFinite(n) && n >= 0.01; };

export function outreachHold(client: any, tenant: any, kind: OutreachKind = 'invite'): OutreachHold | null {
  if (!client) return null;
  if (notBooked(client)) return 'not_booked';
  if (kind === 'service') return null;
  const r = outreachRules(tenant);
  if (r.skipOwing && owesBalance(client)) return 'owes';
  if (r.skipPoorHistory && isPoorHistory(client, tenant)) return 'policy';
  return null;
}

/** For the team (a "Left out" list), never for the client. */
export const HOLD_WORDS: Record<OutreachHold, string> = {
  not_booked: 'not booked by you anymore',
  owes: 'has a balance to settle first',
  policy: 'more missed or canceled visits than you allow',
};
