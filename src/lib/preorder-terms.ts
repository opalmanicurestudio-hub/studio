// ─── src/lib/preorder-terms.ts ────────────────────────────────────────────
// ONE set of words for a pre-order, used in TWO places: the notice the
// customer reads before paying, and the record stored on the order.
//
// They have to be the same words. A shop that shows one promise at checkout
// and files a different one afterwards has no defence at all — and under the
// FTC's Mail, Internet, or Telephone Order Merchandise Rule the disclosure is
// only worth something if it was made BEFORE the money moved and can be
// produced later. So this file builds the text once; the checkout page
// renders it, the checkout route re-builds it server-side and snapshots it
// onto the order. Neither can drift from the other, and editing this file
// later cannot rewrite what a past customer was actually shown.
//
// Nothing here promises anything the code does not already do:
//   · the ship-by date comes from shipPromiseAt(), which is what the delay
//     notice and the late-cancel right are already computed from;
//   · the "cancel online" line is true because self-serve cancel allows
//     placed|paid, and a pre-order sits at 'paid' until stock lands;
//   · the "we email a new date and you can cancel" line is the existing
//     preorder-run-eta / delay-notice path, not an aspiration.

import { FTC_DEFAULT_PROMISE_DAYS } from '@/lib/retail-orders';

/** Bump ONLY when the wording changes materially. Stored on every order so a
 *  past agreement can be read back against the text that produced it. */
export const PREORDER_TERMS_VERSION = 1;

export type PreorderTermItem = {
  name: string;
  etaAt?: string | null;
  qty?: number;
};

export type PreorderNotice = {
  headline: string;
  itemLines: string[];
  bullets: string[];
  agreeLabel: string;
  promiseAt: string | null;
  text: string;
};

export type PreorderAckSnapshot = {
  agreed: true;
  agreedAt: string;
  version: number;
  promiseAt: string | null;
  items: { name: string; etaAt: string | null; qty: number }[];
  text: string;
};

/**
 * Dates arrive in two shapes: a plain calendar day from the product editor
 * ('2026-03-03') and a full ISO instant from shipPromiseAt(). A calendar day
 * parsed as an instant is UTC midnight, which renders as the PREVIOUS day for
 * anyone west of Greenwich — the single most common way a promised date
 * quietly becomes a day earlier than the shop meant. Midday local removes it.
 */
export function parsePromiseDate(value?: string | null): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** "March 3, 2026" — the way a person reads a date, not the way a database stores one. */
export function formatPromiseDay(value?: string | null): string {
  const d = parsePromiseDate(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * The promise that binds: the LATEST pre-order date on the cart, because the
 * order ships as one; if no item names a date, the rule's own 30 days.
 * Mirrors shipPromiseAt() deliberately — same answer, computed before the
 * order exists.
 */
export function cartPromiseAt(items: PreorderTermItem[], from: Date = new Date()): string | null {
  const stamps = items
    .map((i) => parsePromiseDate(i.etaAt))
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  if (stamps.length > 0) return new Date(Math.max(...stamps)).toISOString();
  const start = from.getTime();
  if (!Number.isFinite(start)) return null;
  return new Date(start + FTC_DEFAULT_PROMISE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The notice itself. Returns the pieces separately so the page can lay them
 * out, and `text` as the flattened version that gets stored — one function,
 * so what is stored is provably what was shown.
 */
export function preorderNotice(input: {
  items: PreorderTermItem[];
  promiseAt?: string | null;
  now?: Date;
}): PreorderNotice {
  const items = (Array.isArray(input.items) ? input.items : [])
    .map((i) => ({
      name: String(i?.name || '').trim() || 'Item',
      etaAt: i?.etaAt ? String(i.etaAt) : null,
      qty: Math.max(1, Math.floor(Number(i?.qty) || 1)),
    }));

  const promiseAt = input.promiseAt || cartPromiseAt(items, input.now || new Date());
  const promiseDay = formatPromiseDay(promiseAt);

  const headline = items.length > 1
    ? 'Your order includes pre-ordered items'
    : 'Your order includes a pre-ordered item';

  const itemLines = items.map((i) => {
    const day = formatPromiseDay(i.etaAt);
    const qty = i.qty > 1 ? ` × ${i.qty}` : '';
    return day ? `${i.name}${qty} — ships by ${day}` : `${i.name}${qty} — not in stock yet`;
  });

  const bullets = [
    'These items are not in stock yet. You are paying today to reserve them.',
    promiseDay
      ? `We will ship your order by ${promiseDay}.`
      : `We will ship your order within ${FTC_DEFAULT_PROMISE_DAYS} days of payment.`,
    'If we cannot make that date, we will email you a new date and a one-tap full refund. You never have to simply wait.',
    'You can cancel online for a full refund from your order page any time before we start packing — and if we miss the date above, you can cancel even after that.',
  ];

  const agreeLabel = 'I understand this order includes a pre-order and agree to these terms.';

  const text = [
    headline,
    ...itemLines.map((l) => `- ${l}`),
    ...bullets.map((b) => `- ${b}`),
    agreeLabel,
  ].join('\n');

  return { headline, itemLines, bullets, agreeLabel, promiseAt, text };
}

/**
 * What gets written to the order. Deliberately carries the TEXT, not a
 * pointer to it: a version number alone would send future-us reading a file
 * that has since been edited, which is exactly the thing this is meant to
 * prevent.
 */
export function preorderAckSnapshot(input: {
  items: PreorderTermItem[];
  promiseAt?: string | null;
  agreedAt?: string;
}): PreorderAckSnapshot {
  const notice = preorderNotice({ items: input.items, promiseAt: input.promiseAt });
  return {
    agreed: true,
    agreedAt: input.agreedAt || new Date().toISOString(),
    version: PREORDER_TERMS_VERSION,
    promiseAt: notice.promiseAt,
    items: (Array.isArray(input.items) ? input.items : []).map((i) => ({
      name: String(i?.name || '').trim() || 'Item',
      etaAt: i?.etaAt ? String(i.etaAt) : null,
      qty: Math.max(1, Math.floor(Number(i?.qty) || 1)),
    })),
    text: notice.text,
  };
}
