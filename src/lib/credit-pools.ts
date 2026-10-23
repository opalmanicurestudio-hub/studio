// src/lib/credit-pools.ts — TWO KINDS OF MONEY SIT IN ONE COLLECTION (tenants/{t}/depositCredits), AND THEY ARE NEVER
// SPENT AS EACH OTHER.
//   deposit       — paid for one booking (the booking page, a pay link, a saved card, the desk). It comes off that
//                   visit's bill at the desk, goes back on that booking's refund, or is kept on a no-show. It is not
//                   store credit: the online shop never offers it, and another sale never takes it.
//   store credit  — given back for a return, a refund to credit, a goodwill gesture, or brought over from another app.
//                   The online shop spends it (oldest first), and the customer's balance counts it.
// A deposit is a credit made for a booking (it names the booking: sourceAppointmentId, which a browser can never set).
// Either kind is spent from what's LEFT on it (amountCents less usedCents), never its original amount, and only while
// it's available and not expired. Pure: no reads or writes.

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));

export type CreditDoc = { id?: string; kind?: string; sourceAppointmentId?: string | null; amountCents?: number; amountDollars?: number;
  usedCents?: number; status?: string; expiresAt?: string | null; createdAt?: string; [k: string]: any };

/** A deposit for a booking (never store credit): it names its booking, which only the server writes (a credit made
 *  from a browser can't carry one: the database rules refuse it), so a deposit can't be made up at a screen. */
export function isDepositCredit(c: CreditDoc | null | undefined): boolean {
  if (!c) return false;
  if (c.kind === 'store_credit') return false;
  return typeof c.sourceAppointmentId === 'string' && c.sourceAppointmentId.trim() !== '';
}

/** Store credit the customer can spend on anything (never a booking's deposit). */
export const isStoreCredit = (c: CreditDoc | null | undefined): boolean => !!c && !isDepositCredit(c);

/** What the credit was for, in cents. Older deposits wrote dollars. */
export function creditAmountCents(c: CreditDoc | null | undefined): number {
  if (!c) return 0;
  if (c.amountCents != null && Number.isFinite(Number(c.amountCents))) return c0(c.amountCents);
  return c0((Number(c.amountDollars) || 0) * 100);
}

/** What's left on it to spend. */
export const creditLeftCents = (c: CreditDoc | null | undefined): number => Math.max(0, creditAmountCents(c) - c0(c?.usedCents));

export function creditExpired(c: CreditDoc | null | undefined, now = Date.now()): boolean {
  const t = Date.parse(String(c?.expiresAt || ''));
  return Number.isFinite(t) && t < now;
}

/** Can be spent now: available, not expired, something left. */
export const spendable = (c: CreditDoc | null | undefined, now = Date.now()): boolean =>
  !!c && c.status === 'available' && !creditExpired(c, now) && creditLeftCents(c) > 0;

/** The customer's store credit balance from their credit documents. */
export function storeCreditBalance(docs: CreditDoc[], now = Date.now()): number {
  return (docs || []).filter((c) => isStoreCredit(c) && spendable(c, now)).reduce((s, c) => s + creditLeftCents(c), 0);
}

export type CreditTake = { index: number; take: number; usedAfter: number; used: boolean };

/** How `cents` comes off these credits: oldest first, each from what's left on it. Returns what each gives and the
 *  total taken (less than asked when there isn't enough). */
export function planCreditTake(docs: CreditDoc[], cents: number, now = Date.now()): { takes: CreditTake[]; taken: number } {
  const order = (docs || []).map((c, index) => ({ c, index })).filter((x) => spendable(x.c, now))
    .sort((a, b) => String(a.c.createdAt || '').localeCompare(String(b.c.createdAt || '')) || a.index - b.index);
  let left = c0(cents); const takes: CreditTake[] = [];
  for (const { c, index } of order) {
    if (left <= 0) break;
    const avail = creditLeftCents(c); const take = Math.min(avail, left);
    if (take <= 0) continue;
    left -= take;
    takes.push({ index, take, usedAfter: c0(c.usedCents) + take, used: take >= avail });
  }
  return { takes, taken: c0(cents) - left };
}

/** The deposit for this booking first; otherwise (a booking moved to a new time keeps its first booking's deposit)
 *  the newest deposit of the client's that isn't for another booking still to come. `upcoming` says whether a
 *  booking (by id) is still to come. */
export function pickDeposit(docs: CreditDoc[], appointmentIds: string[], upcoming: (appointmentId: string) => boolean, now = Date.now()): CreditDoc | null {
  const ids = new Set((appointmentIds || []).map(String));
  const deposits = (docs || []).filter((c) => isDepositCredit(c) && spendable(c, now));
  const mine = deposits.filter((c) => ids.has(String(c.sourceAppointmentId || '')) || ids.has(String((c as any).appointmentId || '')));
  const newest = (xs: CreditDoc[]) => [...xs].sort((a, b) => (Date.parse(String(b.createdAt || '')) || 0) - (Date.parse(String(a.createdAt || '')) || 0))[0] || null;
  if (mine.length) return newest(mine);
  return newest(deposits.filter((c) => !upcoming(String(c.sourceAppointmentId))));
}
