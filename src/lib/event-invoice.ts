// src/lib/event-invoice.ts — THE FINAL INVOICE for an event (design canvas "Event sheet and final invoice";
// lib/event-invoice-server, api/event-sheet, the client's page at /event-invoice/[tenantId]/[token]). After the event: what
// was quoted, the guests who came beyond those guaranteed at a price each, the bar tab, anything else, less what's been
// paid (the deposit and payments since), and the balance the client pays by card from a link, or the business marks
// paid. Every amount is the business's own, set by a manager; the money is worked out here, never taken from a page.
// Pure.
import { sheetMoney } from '@/lib/event-sheet';

export const MAX_CENTS = 10_000_000; // $100,000 on one line
export const MAX_EXTRAS = 10;
export type Extra = { name: string; cents: number };
export type InvoiceIn = { came: number | null; eachCents: number | null; barCents: number; extras: Extra[] };
export type Payment = { id: string; cents: number; at: string; how: 'card' | 'cash' | 'check' | 'other'; pi?: string | null; refundedCents?: number };
/** What a payment still counts for: its amount less anything given back (a refund in Stripe). */
export const keptCents = (p: Payment) => Math.max(0, (Number(p.cents) || 0) - Math.max(0, Number(p.refundedCents) || 0));

const int = (v: unknown, max: number): number | null | undefined => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
};
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A manager's invoice as saved: whole cents in range, a guest count, up to ten other lines each with a name. */
export function cleanInvoice(raw: any): InvoiceIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const came = int(raw.came, 100000); const eachCents = int(raw.eachCents, MAX_CENTS); const bar = int(raw.barCents, MAX_CENTS);
  if (came === undefined || eachCents === undefined || bar === undefined) return null;
  const extras: Extra[] = [];
  for (const x of Array.isArray(raw.extras) ? raw.extras : []) {
    const name = clip(x?.name, 60); const cents = int(x?.cents, MAX_CENTS);
    if (!name && (cents === null || cents === 0)) continue;
    if (!name || cents === undefined || cents === null) return null;
    extras.push({ name, cents });
  }
  if (extras.length > MAX_EXTRAS) return null;
  return { came, eachCents, barCents: bar || 0, extras };
}

/** A price for each extra guest to start from: what was quoted for the event, per guest guaranteed. */
export function suggestEachCents(ev: any): number | null {
  const guests = Number(ev?.capacity); if (!(guests > 0)) return null;
  const lines = Array.isArray(ev?.quoteLines) ? ev.quoteLines : [];
  const total = lines.reduce((a: number, l: any) => a + Math.round((Number(l?.price) || 0) * 100) * (Number(l?.quantity) || 1), 0);
  return total > 0 ? Math.round(total / guests) : null;
}

export type InvoiceView = { lines: { label: string; cents: number }[]; totalCents: number; paidCents: number; balanceCents: number; extraGuests: number; guaranteed: number | null };
/** The invoice line by line: as quoted, the extra guests, the bar tab, anything else; what's been paid; the balance. */
export function invoiceLines(ev: any, inv: InvoiceIn | null, payments: Payment[] = []): InvoiceView {
  const m = sheetMoney(ev); const lines: { label: string; cents: number }[] = [];
  if (m.quotedCents > 0) lines.push({ label: 'As quoted', cents: m.quotedCents });
  // Guests beyond those guaranteed, for an event from a quote (another event's number is its ticket limit).
  const guaranteed = ev?.quoteId && Number(ev?.capacity) > 0 ? Number(ev.capacity) : null;
  const extraGuests = inv?.came !== null && inv?.came !== undefined && guaranteed !== null ? Math.max(0, inv.came - guaranteed) : 0;
  if (extraGuests > 0 && inv?.eachCents) lines.push({ label: `${extraGuests} more ${extraGuests === 1 ? 'guest' : 'guests'}`, cents: extraGuests * inv.eachCents });
  if (inv?.barCents) lines.push({ label: 'Bar tab', cents: inv.barCents });
  for (const x of inv?.extras || []) lines.push({ label: x.name, cents: x.cents });
  const totalCents = lines.reduce((a, l) => a + l.cents, 0);
  const paidCents = m.paidCents + payments.reduce((a, p) => a + keptCents(p), 0);
  return { lines, totalCents, paidCents, balanceCents: Math.max(0, totalCents - paidCents), extraGuests, guaranteed };
}

/** A payment already recorded (a card payment noticed twice, from the page and from Stripe, counts once). */
export const hasPayment = (payments: Payment[], id: string) => (payments || []).some((p) => p.id === id);
export const paymentsOf = (inv: any): Payment[] => (Array.isArray(inv?.payments) ? inv.payments : []).filter((p: any) => p && typeof p.id === 'string' && Number(p.cents) >= 0);
