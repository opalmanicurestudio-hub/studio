// src/lib/digital-gift.ts — A DOWNLOAD BOUGHT AS A GIFT (pure).
// The buyer pays; the person it's for gets it. On a gift order (order.digitalGift) the downloads belong to the
// recipient: their access records carry the recipient's email, the buyer's order page says who it went to and when, and
// only the recipient opens it, with their own pass (a gift pass, never the buyer's), from the link in the gift email or
// a code sent to their email. The gift goes out on the day the buyer chose (today if none), in the shop's time zone.
import { disputeHolds, fullyRefunded } from '@/lib/digital-access-rule';

export type DigitalGift = { toName: string; toEmail: string; sendOn: string | null; message: string; token: string; sentAt: string | null; failedAt?: string | null };

/** Sends tried before the gift is marked as not sent (the five-minute check: about an hour of tries). */
export const GIFT_TRIES = 12;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What the buyer typed, cleaned, or why it can't be used. `today` is 'YYYY-MM-DD' in the shop's time zone. */
export function cleanDigitalGift(raw: any, today: string): { ok: true; gift: Omit<DigitalGift, 'token' | 'sentAt'> } | { ok: false; error: string } {
  const toName = String(raw?.to || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const toEmail = String(raw?.toEmail || '').trim().toLowerCase().slice(0, 120);
  const message = String(raw?.message || '').replace(/\s+\n/g, '\n').trim().slice(0, 300);
  const rawOn = String(raw?.sendOn || '');
  // A real calendar day only: '2027-02-45' would otherwise go out on some later day.
  const at = /^\d{4}-\d{2}-\d{2}$/.test(rawOn) ? Date.parse(`${rawOn}T12:00:00Z`) : NaN;
  const sendOn = Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === rawOn ? rawOn : null;
  if (rawOn && !sendOn) return { ok: false, error: 'Choose a real day for the gift to be sent.' };
  if (!toName) return { ok: false, error: 'Who is the gift for?' };
  if (!EMAIL.test(toEmail)) return { ok: false, error: 'Add the email the gift should go to.' };
  if (sendOn && sendOn < today) return { ok: false, error: 'Choose today or a day after for the gift to be sent.' };
  if (sendOn && sendOn > addDays(today, 366)) return { ok: false, error: 'A gift can be sent up to a year ahead.' };
  return { ok: true, gift: { toName, toEmail, sendOn: sendOn && sendOn > today ? sendOn : null, message } };
}

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T12:00:00Z`) + n * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

/** A gift that will never go: the order was cancelled or refunded, or sending gave up. */
export function giftDead(order: any): boolean {
  const g = order?.digitalGift;
  return !!g && !g.sentAt && (!!g.failedAt || String(order?.stage) === 'cancelled' || fullyRefunded(order));
}

/**
 * Whether the gift email is due: paid, not sent yet, and its day has come (no day = at once). Never for a cancelled or
 * refunded order, and not while a chargeback is open (it goes if the shop wins it).
 */
export function giftDue(order: any, today: string): boolean {
  const g = order?.digitalGift;
  if (!g || g.sentAt || !order?.paidAt || String(order?.stage) === 'placed' || giftDead(order) || disputeHolds(order)) return false;
  return !g.sendOn || g.sendOn <= today;
}

/** The token the recipient's pass is signed from: different from the buyer's, so neither pass opens the other's view. */
export const giftPassKey = (qrToken: string) => `${qrToken}:gift`;

/** The key a pass to open this order's downloads is checked against: the gift's when it's a gift. */
export const accessPassKey = (order: any) => (order?.digitalGift ? giftPassKey(String(order?.qrToken || '')) : String(order?.qrToken || ''));

/** The day the gift goes, in words, for the buyer's page and receipt. */
export function giftWhen(g: Pick<DigitalGift, 'sendOn' | 'sentAt'> & { failedAt?: string | null }): string {
  if (!g.sentAt && g.failedAt) return 'not sent: the email couldn’t be delivered';
  if (g.sentAt) return `sent ${new Date(g.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  if (g.sendOn) return `sending ${new Date(`${g.sendOn}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return 'sending now';
}
