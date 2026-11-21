// src/lib/ahead-slots.ts — PICKUP TIMES THAT FILL (design canvas "Pickup times that fill"; lib/counter-ahead, the guest's
// order page, the order-ahead settings on the menu page). Each quarter-hour pickup time takes a set number of items
// (orderAhead.slotItems; none set, no limit, as it always was). The kitchen's pace (lib/kitchen-pace) takes some off:
// three-quarters as many when it's busy, half when it's slammed. An order counts against its time from the moment it's
// placed (paid, or still being paid for in the last half hour) until it's voided; one placed for "as soon as it's ready"
// counts against the first time that could be ready. A time with nothing in it takes any one order, however big. Pure.

export const SLOT_MS = 15 * 60000;
export const UNPAID_HOLD_MS = 30 * 60000;
export const SLOT_ITEMS_MIN = 1, SLOT_ITEMS_MAX = 200;
export type PaceLevel = 'calm' | 'busy' | 'slammed';
const FACTOR: Record<PaceLevel, number> = { calm: 1, busy: 0.75, slammed: 0.5 };

/** The items one pickup time takes right now: the business's number, less when the kitchen is busy. null: no limit. */
export function slotCap(slotItems: number | null, level: PaceLevel): number | null {
  if (slotItems === null) return null;
  return Math.max(1, Math.floor(slotItems * (FACTOR[level] ?? 1)));
}

/** The business's number, as saved: a whole number in range, or null for no limit. */
export function cleanSlotItems(v: unknown): number | null | undefined {
  if (v === null || v === '' || v === 0) return null;
  const n = Number(v); return Number.isInteger(n) && n >= SLOT_ITEMS_MIN && n <= SLOT_ITEMS_MAX ? n : undefined;
}

/** "As soon as it's ready": the first quarter hour that could be ready (twenty minutes on, later when the kitchen is
 *  behind), the same first time the page offers. */
export const asapSlot = (now: number, delayMin = 0) => new Date(Math.ceil((now + (20 + Math.max(0, Math.round(delayMin))) * 60000) / SLOT_MS) * SLOT_MS).toISOString();

/** Items at each pickup time from the day's orders placed ahead (paid, or being paid for in the last half hour). */
export function itemsBySlot(orders: any[], now: number, except?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of orders || []) {
    if (!o || o.id === except || o.channel !== 'ahead') continue; const a = o.ahead || {}; const slot = String(a.slot || '');
    // Voided or given back at the counter: it isn't being made, so its room is free again.
    if (['voided', 'refunded', 'canceled', 'cancelled'].includes(String(o.status || ''))) continue;
    if (!slot) continue;
    // (An order for another day takes no room in its pickup time: it starts early enough for its size. lib/ahead-days)
    if (a.forDay) continue;
    const live = a.state === 'paid' || (a.state === 'awaiting_pay' && now - Date.parse(String(o.createdAt || '')) < UNPAID_HOLD_MS);
    if (!live) continue;
    const items = Array.isArray(o.lines) ? o.lines.reduce((n: number, l: any) => n + Math.max(1, Math.round(Number(l?.quantity) || 1)), 0) : 1;
    out.set(slot, (out.get(slot) || 0) + items);
  }
  return out;
}

/** Does an order of `items` fit a time that already has `used`? A time with nothing in it takes any one order. */
export const fits = (used: number, cap: number | null, items: number) => cap === null || used === 0 || used + items <= cap;

/** The times that are full right now (nothing more fits, even one item). */
export function fullTimes(times: string[], used: Map<string, number>, cap: number | null): string[] {
  return cap === null ? [] : times.filter((t) => (used.get(t) || 0) >= cap);
}

/** Lines' item count. */
export const itemCount = (lines: { quantity?: number }[]) => (lines || []).reduce((n, l) => n + Math.max(1, Math.round(Number(l?.quantity) || 1)), 0);
