// src/lib/counter-oneoff.ts — SOMETHING NOT ON THE MENU, RUNG IN AT THE COUNTER (pure; design board "Register tools",
// part 2; lib/counter-server editOrder 'oneOff', api/counter 'oneOff'; components/pos/CounterOneOff). A name, a price
// up to the amount the business sets under Menu, and whether it's taxed. It's a line of its own on the order (never
// merged with another), handed over at the counter: it doesn't go to the kitchen, and no stock moves for it. Its name is
// kept on record (tenants/{t}/oneOffNames, when the order is sent), so the Menu page can show what's rung in often
// enough to put on the menu. The menu and its prices stay as they are.
import type { OrderLine } from '@/lib/counter-orders';

/** The most one can be, unless the business sets its own (0 turns it off), and the most it can set. */
export const ONE_OFF_MAX_DEFAULT = 100, ONE_OFF_MAX_CAP = 1000;
export const ONE_OFF_NAME_MAX = 60;

/** The most one can be at this business, in dollars (0: not offered). */
export function oneOffMaxOf(tenant: any): number {
  const v = tenant?.counterOneOff?.max;
  if (v === undefined || v === null) return ONE_OFF_MAX_DEFAULT;
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) && n >= 0 ? Math.min(ONE_OFF_MAX_CAP, n) : ONE_OFF_MAX_DEFAULT;
}

/** Its name as kept: one line, no more than so long. */
export function cleanOneOffName(v: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ONE_OFF_NAME_MAX);
}

/** The key its name is kept under (the same name in any case, spacing or punctuation is one). */
export function oneOffKey(name: string): string | null {
  const k = cleanOneOffName(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return k ? `n-${k}` : null;
}

/** A one-off line on an order, checked: a name, a price over $0 and no more than `max`, 1 to 20 of it. */
export function oneOffLine(input: { name?: unknown; price?: unknown; quantity?: unknown; taxed?: unknown }, max: number, lineId: string): { ok: true; line: OrderLine } | { ok: false; error: string } {
  if (!(max > 0)) return { ok: false, error: 'Something not on the menu is turned off here. A manager can turn it on under Menu.' };
  const name = cleanOneOffName(input.name);
  if (!name) return { ok: false, error: 'What is it? Give it a name.' };
  const raw = typeof input.price === 'string' ? input.price.replace(/[$,\s]/g, '') : input.price;
  const price = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'What does it cost? More than $0.' };
  if (price > max) return { ok: false, error: `Up to $${max.toFixed(2)} here. Anything more goes on the menu first.` };
  const q = input.quantity === undefined || input.quantity === null || input.quantity === '' ? 1 : Math.floor(Number(input.quantity));
  if (!Number.isFinite(q) || q < 1 || q > 20) return { ok: false, error: 'How many? Between 1 and 20.' };
  return { ok: true, line: { lineId, itemId: '', name, quantity: q, unitPrice: price, choices: [], choicesText: null, makeSeconds: 0, imageUrl: null, oneOff: true, ...(input.taxed === false ? { untaxed: true } : {}) } };
}

/** The lines the kitchen makes (everything but the one-offs). */
export const menuLinesOf = <T extends { oneOff?: boolean }>(lines: T[]): T[] => lines.filter((l) => l.oneOff !== true);

export type OneOffName = { key: string; name: string; count: number; lastPrice: number; lastAt: string };
