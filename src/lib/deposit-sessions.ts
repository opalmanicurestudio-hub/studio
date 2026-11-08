// src/lib/deposit-sessions.ts — THE PAYMENT FORMS OPENED FOR A BOOKING'S DEPOSIT ARE CLOSED BEFORE ITS TIME IS LET GO.
// Each payment form opened for a booking is noted on it (appointment.depositSessions, "<account>:<session>", written by
// api/stripe/deposit). Before a held time is let go, whether the client stepped back (api/appointments/release-hold) or
// the hold ran out (lib/release-unpaid), every one of them is closed with Stripe. Nothing can then be paid for a time
// that has gone to someone else.
import Stripe from 'stripe';

export type CloseResult = 'paid' | 'closed' | 'unknown';

/** Closes every payment form opened for a booking, a few at a time. 'paid' when one has been (or is being) paid (the
 *  others are still closed); 'closed' when none can be paid any more; 'unknown' when Stripe couldn't be asked in time
 *  (then the booking must not be let go). */
export async function closePayments(sessions: string[]): Promise<CloseResult> {
  if (!sessions.length) return 'closed';
  if (!process.env.STRIPE_SECRET_KEY) return 'unknown';
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any, timeout: 4000, maxNetworkRetries: 0 });
  const one = async (tag: string): Promise<CloseResult> => {
    const [acct, id] = String(tag).split(':'); if (!id) return 'closed';
    const opt = acct ? { stripeAccount: acct } : undefined;
    try {
      let s: any = await stripe.checkout.sessions.retrieve(id, opt);
      if (s.status === 'complete' || s.payment_status === 'paid') return 'paid';
      if (s.status !== 'open') return 'closed';
      try { s = await stripe.checkout.sessions.expire(id, opt); }
      catch { s = await stripe.checkout.sessions.retrieve(id, opt); }   // paid in the very moment it was being closed
      if (s.status === 'complete' || s.payment_status === 'paid') return 'paid';
      return s.status === 'expired' ? 'closed' : 'unknown';
    } catch (e: any) { return e?.code === 'resource_missing' ? 'closed' : 'unknown'; }   // a form Stripe doesn't know can't be paid
  };
  const list = [...new Set(sessions)]; const all: CloseResult[] = [];
  for (let i = 0; i < list.length; i += 6) all.push(...(await Promise.all(list.slice(i, i + 6).map(one))));
  return all.includes('paid') ? 'paid' : all.includes('unknown') ? 'unknown' : 'closed';
}

/** When a deposit's payment form should close by itself: at the booking's payment deadline (an accepted request's
 *  paymentDueAt, else when its hold runs out), kept within what Stripe allows (at least 30 minutes after it's opened,
 *  at most 24 hours). In seconds, as Stripe takes it. */
export function depositFormExpiry(ap: any, tenant: any, now = Date.now()): number {
  const holdMin = Number(tenant?.bookingMode?.holdMinutes) > 0 ? Number(tenant.bookingMode.holdMinutes) : 30;
  const created = Date.parse(String(ap?.createdAt || '')) || now;
  const due = Date.parse(String(ap?.paymentDueAt || '')) || created + holdMin * 60000;
  const at = Math.min(Math.max(due, now + 31 * 60000), now + 23.5 * 3600000);
  return Math.floor(at / 1000);
}
