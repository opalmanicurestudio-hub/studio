// src/lib/books-close.ts — CLOSING A MONTH (pure; design board "Closing a month", option A). Once a month is closed,
// nothing dated in it can change, so what was filed and handed to an accountant stays as it was; a correction goes in
// on the day it's made. Closing a month closes every month before it. The owner can reopen the last one closed, with a
// reason (lib/books-close-server, kept on the record).
//   tenants/{t}.booksClose = { through: 'YYYY-MM', openDay: 'YYYY-MM-DD', openFrom: ISO, openFromMs, at, by }   (server-written)
//   openDay is the first open day, openFrom its first moment where the business is: a line dated by day ('2026-11-01')
//   is open from openDay, one dated by the moment (an ISO time) from openFrom. firestore.rules reads the same two.
import { addDays, startOfDay, tenantTimeZone } from './tenant-time';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export type BooksClose = { through: string; openDay: string; openFrom: string; at: string | null; by: string | null };

/** The business's closed months, or null when none is. */
export function closeOf(t: any): BooksClose | null {
  const c = t?.booksClose;
  if (!c || !/^\d{4}-\d{2}$/.test(String(c.through || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.openDay || '')) || !c.openFrom) return null;
  return { through: String(c.through), openDay: String(c.openDay), openFrom: String(c.openFrom), at: c.at ? String(c.at) : null, by: c.by ? String(c.by) : null };
}

/** 'October 2026' (with the year), or 'October'. */
export const monthName = (m: string, year = true) => { const [y, mo] = m.split('-').map(Number); return year ? `${MONTHS[mo - 1]} ${y}` : MONTHS[mo - 1]; };
/** The first and last days of a month. */
export function monthDays(m: string): { start: string; end: string } {
  const [y, mo] = m.split('-').map(Number);
  return { start: `${m}-01`, end: `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}` };
}
/** The month after (or before) this one. */
export function monthAfter(m: string, by = 1): string {
  const [y, mo] = m.split('-').map(Number); const i = y * 12 + (mo - 1) + by;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** What closing through a month writes: its next day open, from that day's first moment where the business is. */
export function closeThrough(t: any, m: string): { through: string; openDay: string; openFrom: string; openFromMs: number } {
  const openDay = addDays(monthDays(m).end, 1); const from = startOfDay(openDay, tenantTimeZone(t));
  // (openFromMs: for a line whose date is a stored time rather than text; firestore.rules reads it.)
  return { through: m, openDay, openFrom: from.toISOString(), openFromMs: from.getTime() };
}

/** Whether a line dated `date` (a day or a moment) is in a closed month. */
export function inClosedMonth(t: any, date: unknown): boolean {
  const c = closeOf(t); if (!c) return false;
  // (A stored time rather than text: by its moment. No date: not in any month.)
  if (date && typeof date === 'object' && typeof (date as any).toMillis === 'function') return (date as any).toMillis() < Date.parse(c.openFrom);
  const d = String(date || ''); if (!d) return false;
  return d.length <= 10 ? d < c.openDay : d < c.openFrom;
}

/** The date a line can have: its own while its month is open, else now (and the day it was for, to say so). */
export function openDate(t: any, date: string, now = Date.now()): { date: string; was: string | null } {
  return inClosedMonth(t, date) ? { date: new Date(now).toISOString(), was: String(date).slice(0, 10) } : { date, was: null };
}

/** The fields a line in a closed month may still change: its matches, receipts, notes and refund marks, never its
 *  figures, its kind or its date. firestore.rules lists the same. */
export const CLOSED_LINE_FIELDS = ['refundedAt', 'refundTransactionId', 'refundedCents', 'reconciled', 'reconciledAt', 'bankTransactionId',
  'receiptUrl', 'receiptPath', 'receiptName', 'hasReceipt', 'notes', 'updatedAt'] as const;

/** The date fields for a line the server writes for something that happened on `date`: that date while its month is
 *  open; once the month is closed, today, saying the day it was for (`forDay`), so the closed month stays as it was. */
export function datedFor(t: any, date: string, now = Date.now()): { date: string; forDay?: string } {
  const o = openDate(t, date, now); return o.was ? { date: o.date, forDay: o.was } : { date: o.date };
}

/** The same, reading the business's record first (for a writer that doesn't have it to hand). */
export async function datedAt(db: any, tenantId: string, date: string, now = Date.now()): Promise<{ date: string; forDay?: string }> {
  const t = (await db.doc(`tenants/${tenantId}`).get().catch(() => null))?.data() || {};
  return datedFor(t, date, now);
}
