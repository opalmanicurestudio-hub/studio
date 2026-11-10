// src/lib/quote-public.ts — A QUOTE AS ITS CLIENT SEES IT, AND WHAT THEY CAN DO WITH IT (api/quote). Pure.
// The client opens their quote from a link carrying its own key (the quote's clientSecret): they see what's quoted,
// the total and the deposit, when it runs out, and can accept it, ask for changes or decline it. They never see what
// the business pays its team or what anything costs the business.

export const DECLINE_REASONS = [
  'The price is more than I planned',
  'I went with someone else',
  'The date doesn’t work anymore',
  'My plans changed',
  'I need more time to decide',
  'It isn’t what I’m looking for',
  'Something else',
] as const;

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money2 = (n: number) => Math.round(n * 100) / 100;

/** The quote's totals, in dollars as the quote keeps them: the items, travel, the percentage fee, and the total. */
export function quoteTotals(q: any): { items: number; travel: number; feePercent: number; fee: number; total: number; deposit: number } {
  const items = (Array.isArray(q?.lineItems) ? q.lineItems : []).reduce((a: number, i: any) => a + num(i?.price) * (num(i?.quantity) || 1), 0);
  const travel = Math.max(0, num(q?.travelExpenses));
  const feePercent = Math.max(0, num(q?.projectFee));
  const fee = items * (feePercent / 100);
  const total = items + travel + fee;
  return { items: money2(items), travel: money2(travel), feePercent, fee: money2(fee), total: money2(total), deposit: money2(Math.min(Math.max(0, num(q?.depositAmount)), total)) };
}

/** The quote's day as YYYY-MM-DD. Quotes made before keep a moment ("2026-11-20T05:00:00.000Z", the start of the day
 *  where it was written), read on the business's own clock; newer ones keep the day itself. */
export function quoteDay(q: any, dayOf: (d: Date) => string): string | null {
  const v = String(q?.eventDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? dayOf(new Date(t)) : null;
}

/** When a sent quote runs out (null when it doesn't). */
export function quoteExpiresAt(q: any): Date | null {
  const days = Math.round(num(q?.expiresInDays));
  const sent = Date.parse(String(q?.sentAt || ''));
  if (!(days > 0) || !Number.isFinite(sent)) return null;
  return new Date(sent + days * 86400000);
}

/** Can the client act on it now: accept, ask for changes or decline. */
export const quoteOpen = (q: any, now = Date.now()): boolean => {
  if (!['sent', 'viewed', 'revision_requested'].includes(String(q?.status || ''))) return false;
  const exp = quoteExpiresAt(q);
  return !exp || exp.getTime() > now;
};

/** "123 Main St, Springfield" from however the quote keeps its place. */
export function placeText(loc: any): string {
  if (!loc) return '';
  if (typeof loc === 'string') return loc.trim().slice(0, 300);
  return [loc.name, loc.street, loc.city, loc.state, loc.zip].map((x: any) => String(x || '').trim()).filter(Boolean).join(', ').slice(0, 300);
}

/** What the client's page shows: no team pay, no costs, no internal fields. */
export function publicQuote(q: any, tenant: any, dayOf: (d: Date) => string, now = Date.now()) {
  const t = quoteTotals(q);
  const exp = quoteExpiresAt(q);
  const status = String(q?.status || 'draft');
  const expired = status === 'expired' || (['sent', 'viewed', 'revision_requested'].includes(status) && !!exp && exp.getTime() <= now);
  return {
    status: expired ? 'expired' : status,
    open: !expired && quoteOpen(q, now),
    eventName: String(q?.eventName || 'Your event').slice(0, 160),
    eventDay: quoteDay(q, dayOf),
    startTime: /^\d{2}:\d{2}$/.test(String(q?.startTime || '')) ? q.startTime : null,
    place: placeText(q?.eventLocation),
    hours: num(q?.totalHours) > 0 ? num(q.totalHours) : null,
    notes: String(q?.notes || '').slice(0, 3000) || null,
    lines: (Array.isArray(q?.lineItems) ? q.lineItems : []).map((i: any) => ({ name: String(i?.name || 'Item').slice(0, 160), quantity: num(i?.quantity) || 1, price: money2(num(i?.price)) })),
    travel: t.travel, feePercent: t.feePercent, fee: t.fee, total: t.total, deposit: t.deposit,
    paymentTerms: String(q?.paymentTerms || '') || null,
    expiresAt: exp ? exp.toISOString() : null,
    cancellationPolicy: String(q?.cancellationPolicy || tenant?.cancellationPolicy || '').slice(0, 3000) || null,
    business: {
      name: String(tenant?.name || tenant?.businessName || 'The business'),
      email: String(tenant?.email || tenant?.contactEmail || '') || null,
      phone: String(tenant?.phone || '') || null,
      logoUrl: tenant?.bookingPageSettings?.logoUrl || tenant?.kioskSettings?.logoUrl || tenant?.logoUrl || tenant?.bookingPageSettings?.cfPageConfig?.logoUrl || null,
    },
  };
}
