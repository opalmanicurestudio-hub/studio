// src/lib/dish-counts.ts — LIVE COUNTS PER DISH. Some dishes are made in a set number each night (fourteen short ribs,
// twenty pies). A menu item can say how many it starts each night with (`dailyCount`); the kitchen can change tonight's
// number (tenants/{t}/dishCounts/{day}). What's left is tonight's number less what's been rung in tonight, worked out
// from the kitchen's own tickets, so it can never drift from what was ordered: a void the kitchen never started gives
// one back; a dish started and then voided, or made again, has used one. At zero it sells out on every menu by itself
// (lib/dish-counts-server), and comes back if the count is raised. Pure.

export const MAX_COUNT = 999;
/** Who a sold-out set by the count shows as, so only those come back on their own when the count goes up. */
export const COUNT_BY = 'Tonight’s count';

/** How many it starts each night with, as set on the menu item (null: not counted). */
export function dailyCountOf(item: any): number | null {
  const v = item?.dailyCount; if (v === null || v === undefined || v === '') return null;
  const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= MAX_COUNT ? n : null;
}

/** Tonight's number for an item: tonight's own (a number, or null for "not counted tonight"), else the menu's. */
export function startOf(item: any, tonightCounts: Record<string, unknown> | null | undefined, id: string): number | null {
  const t = tonightCounts || {};
  if (Object.prototype.hasOwnProperty.call(t, id)) {
    const v = t[id]; if (v === null) return null;
    const n = Math.floor(Number(v)); if (Number.isFinite(n) && n >= 0 && n <= MAX_COUNT) return n;
  }
  return dailyCountOf(item);
}

/** Has this ticket used one? Rung in and not taken back: anything not cancelled, and a cancelled one the kitchen had
 *  started (claimed, made, or made again). A held course not fired yet counts: it's promised to a table. */
export function ticketUses(t: any): boolean {
  if (String(t?.status || '') !== 'cancelled') return true;
  return !!(t?.remadeAs || t?.claimedAt || t?.readyAt);
}
/** How many of each item tonight's tickets have used (by menu item id). */
export function usedByItem(tickets: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tickets) {
    const id = String(t?.menuItemId || t?.itemId || ''); if (!id || !ticketUses(t)) continue;
    m.set(id, (m.get(id) || 0) + Math.max(1, Math.round(Number(t?.quantity) || 1)));
  }
  return m;
}

export type CountRow = { id: string; name: string; start: number; used: number; left: number; soldOut: boolean; fromTonight: boolean };
/** Every counted item tonight, with what's left (never below 0 on screen; `used` can be more than `start`). */
export function countRows(items: { id: string; x: any }[], tonightCounts: Record<string, unknown> | null | undefined, used: Map<string, number>, soldOut: (x: any) => boolean): CountRow[] {
  const rows: CountRow[] = [];
  for (const { id, x } of items) {
    const start = startOf(x, tonightCounts, id); if (start === null) continue;
    const u = used.get(id) || 0;
    rows.push({ id, name: String(x?.name || 'Item').slice(0, 80), start, used: u, left: Math.max(0, start - u), soldOut: soldOut(x),
      fromTonight: !!tonightCounts && Object.prototype.hasOwnProperty.call(tonightCounts, id) });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
/** "3 left", or "Sold out". */
export const leftWords = (r: Pick<CountRow, 'left'>) => (r.left > 0 ? `${r.left} left` : 'Sold out');
/** Low enough to say so in amber. */
export const lowCount = (r: Pick<CountRow, 'left' | 'start'>) => r.left <= Math.max(2, Math.ceil(r.start * 0.2));
