// src/lib/counter-gift.ts — A GIFT CARD SOLD AT THE COUNTER OR THE WINDOW (pure; design board "Gift cards at the counter";
// lib/counter-server editOrder 'giftCard' and payOrder, api/counter 'giftCard'; components/pos/CounterGift). An amount
// (the business's own amounts from Gift cards, or another from $1 to $5,000, as at the front desk), who it's for, and how
// it gets to them (on the receipt, by text or by email). It's a line of its own on the order, money held for the guest:
// not taxed, no discount, reward or points on it, never part of the order's sales (lib/counter-orders totalsOf keeps it
// out of the subtotal), and paid in cash or by card, not with another gift card or store credit. Once the order is paid,
// the gift card is made (lib/gift-cards), the same as the front desk's, and sent.
import type { OrderLine } from '@/lib/counter-orders';

export type GiftVia = 'print' | 'text' | 'email';
export type GiftOnLine = { to: string | null; via: GiftVia; phone: string | null; email: string | null;
  /** Once it's made: the card, its code, and whether it went. */
  id?: string | null; code?: string | null; sent?: boolean; failed?: string | null; claim?: { token: string; at: string } | null;
  /** A bonus card it earned while an offer is on (lib/gift-offers): its code, for the receipt. */
  bonusCode?: string | null };

export const GIFT_MIN_CENTS = 100, GIFT_MAX_CENTS = 500000;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,24}$/;

/** A US mobile number as it's texted (+1 and ten digits), or none. */
export function giftPhone(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, ''); const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return /^[2-9]\d{9}$/.test(ten) ? `+1${ten}` : null;
}

/** A gift card line, checked: $1 to $5,000 in whole cents, a name of up to 40 letters, and where it goes. */
export function giftLine(input: { cents?: unknown; to?: unknown; via?: unknown; phone?: unknown; email?: unknown }, lineId: string): { ok: true; line: OrderLine & { giftCard: GiftOnLine } } | { ok: false; error: string } {
  const cents = Math.round(Number(input.cents));
  if (!Number.isFinite(cents) || cents < GIFT_MIN_CENTS || cents > GIFT_MAX_CENTS) return { ok: false, error: 'Gift cards are from $1 to $5,000.' };
  // eslint-disable-next-line no-control-regex
  const to = String(input.to ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || null;
  const via: GiftVia = input.via === 'text' || input.via === 'email' ? input.via : 'print';
  const phone = via === 'text' ? giftPhone(input.phone) : null;
  if (via === 'text' && !phone) return { ok: false, error: 'A 10-digit mobile number to text it to.' };
  const email = via === 'email' ? String(input.email ?? '').trim().toLowerCase().slice(0, 254) : null;
  if (via === 'email' && !EMAIL.test(email || '')) return { ok: false, error: 'An email address to send it to.' };
  const giftCard: GiftOnLine = { to, via, phone, email };
  return { ok: true, line: { lineId, itemId: '', name: `Gift card${to ? ` for ${to}` : ''}`, quantity: 1, unitPrice: cents / 100, choices: [], choicesText: null, makeSeconds: 0, imageUrl: null, oneOff: true, untaxed: true, giftCard } };
}

/** A gift card line. */
export const isGiftLine = (l: any) => !!l?.giftCard && typeof l.giftCard === 'object';
/** How many gift cards are on an order. */
export const giftLineCount = (lines: any[] | null | undefined) => (Array.isArray(lines) ? lines.filter(isGiftLine).length : 0);
/** What the gift cards on an order come to, in cents (lib/counter-money, where tips and tenders need it too). */
export { giftCentsOf } from '@/lib/counter-money';
/** How a gift card line reads under its name: how it gets to them, once it's made its code. */
export function giftWords(g: GiftOnLine | null | undefined): string {
  if (!g) return '';
  const how = g.via === 'text' ? `By text to ···${String(g.phone || '').slice(-4)}` : g.via === 'email' ? `By email to ${g.email}` : 'Its code on the receipt';
  return g.code ? `${g.code}${g.via === 'print' ? '' : `, ${g.sent ? 'sent' : 'not sent yet'}`}` : `${how}, not taxed`;
}
