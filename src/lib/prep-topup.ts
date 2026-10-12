// src/lib/prep-topup.ts — BEFORE THE VISIT: a deposit top-up when the price goes up (client and server safe).
// The business chooses (Settings → Before the visit → "When the price goes up"):
//   off      — keep the deposit as it is.
//   over     — when the price rises by more than $X, the deposit grows in step with the price (a $20 deposit on $80 becomes
//              $25 on $100).
//   percent  — the deposit stays a set % of the price.
// Only visits that already took a deposit are topped up — a change never adds a deposit that wasn't asked for at booking.
import type { PrepSettings } from '@/lib/prep-check';

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** What's been paid toward the deposit so far (cents): the booking deposit plus any top-up already paid. */
export function depositPaidCents(a: any): number {
  const paid = a?.depositStatus === 'paid' || a?.depositPaid === true || a?.paymentStatus === 'deposit_paid';
  return paid ? Math.max(0, Math.round(num(a?.depositAmountCents))) : 0;
}

/** The top-up due (cents) for a price change from `oldPrice` to `newPrice` (dollars). 0 when nothing's due. */
export function topUpDue(rule: PrepSettings['topUp'], a: any, oldPrice: number, newPrice: number): number {
  const paid = depositPaidCents(a); if (!paid || rule.mode === 'off' || !(newPrice > oldPrice)) return 0;
  let target = paid;
  if (rule.mode === 'percent') target = Math.round(newPrice * 100 * (rule.pct / 100));
  else if (rule.mode === 'over') { if ((newPrice - oldPrice) * 100 <= rule.overCents) return 0; target = oldPrice > 0 ? Math.round(paid * (newPrice / oldPrice)) : paid; }
  const due = target - paid; return due >= 100 ? due : 0;   // under $1 isn't worth asking for
}

export const centsLabel = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
