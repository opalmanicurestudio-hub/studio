// src/lib/counter-price.ts — ONE ITEM AT A DIFFERENT PRICE (pure; design board "Register tools, part 3", part 1;
// lib/counter-price-server). Why it's different, and how a line at a different price reads on a screen or a slip.

export const PRICE_REASONS = ['Damaged', 'Wrong price', 'Price match'];
/** The most one item can be charged here. */
export const PRICE_MAX = 1000;

export type PriceChange = { from: number; to: number; reason: string; by: string; approvedBy: string | null; at: string };

/** How a line at a different price reads under its name. */
export function priceWords(l: { priceChange?: PriceChange | null } | null | undefined): string {
  const p = l?.priceChange; if (!p) return '';
  return `Was $${Number(p.from).toFixed(2)}: ${p.reason}`;
}

/** A new price for one item, in whole cents: more than $0 (nothing at all is On the house), up to PRICE_MAX. */
export function cleanPrice(v: unknown): number | null {
  const n = Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')) * 100);
  return Number.isFinite(n) && n >= 1 && n <= PRICE_MAX * 100 ? n : null;
}
