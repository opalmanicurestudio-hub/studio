// src/lib/tenant-access.ts — IS THIS BUSINESS LOCKED? One answer for the staff app, the public booking page and shop,
// and every route that starts a booking or takes money for a business.
// Locked when HQ paused it ("Pause access"), when its ClarityFlow subscription ended, or when a late payment's grace
// period has run out. A business that's simply not set up yet, or on early access, is never locked.
export type LockReason = 'paused' | 'cancelled' | 'grace_expired';
export type AccessLock = { locked: boolean; reason: LockReason | null };

const OPEN: AccessLock = { locked: false, reason: null };

export function accessLockOf(t: any, now = Date.now()): AccessLock {
  if (!t) return OPEN;
  const status = String(t.subscriptionStatus || '').toLowerCase();
  const graceOver = status === 'past_due' && !!t.gracePeriodEndsAt && Date.parse(String(t.gracePeriodEndsAt)) < now;
  if (t.accessLocked === true || t.suspended === true) {
    if (t.accessLockedAt || t.suspended === true) return { locked: true, reason: 'paused' };
    if (status === 'cancelled' || status === 'canceled') return { locked: true, reason: 'cancelled' };
    if (status === 'past_due') return { locked: true, reason: 'grace_expired' };
    return { locked: true, reason: 'paused' };
  }
  if (status === 'cancelled' || status === 'canceled') return { locked: true, reason: 'cancelled' };
  if (graceOver) return { locked: true, reason: 'grace_expired' };
  return OPEN;
}

/** What a client is told when a locked business can't take a booking or an order. Never says why. */
export const CLOSED_FOR_CLIENTS = 'This business isn’t taking online bookings or orders right now.';
/** What the team sees when a paused or cancelled business is asked to take money: nothing is charged. */
export const CLOSED_FOR_TEAM = 'This business is paused, so it can’t take payments right now. The owner can tell you more.';
/** What a client, guest or renter is told when a paused or cancelled business is asked to take their money. Never says why. */
export const CLOSED_FOR_PAYERS = 'This business isn’t taking payments right now, so nothing was charged.';
