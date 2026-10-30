// src/lib/order-windows.ts — WHEN A CUSTOMER'S RETURN AND PROBLEM WINDOWS START. The shop's policy says "days after
// delivery", so the count starts at the carrier's delivery scan. A parcel the carrier never confirms delivering counts
// from the day it shipped instead, and a pickup from the day it was handed over. A window with no start date, or no limit
// set, stays open: ambiguity reads in the customer's favor. Pure — the order page's menu, the self-serve routes and the
// order assistant all ask here, so what a customer is shown and what the server allows can't disagree.

const ms = (v: unknown): number | null => {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : null;
};

export type WindowStart = { at: number; from: 'delivered' | 'shipped' | 'handed_over' };

/** When the count starts: delivered (the carrier's scan, or the shop's own driver), else shipped (no delivery scan), else
 *  handed over (pickups). */
export function windowStart(order: any): WindowStart | null {
  const delivered = ms(order?.deliveredAt);
  if (delivered !== null) return { at: delivered, from: 'delivered' };
  const done = ms(order?.completedAt);
  if (done === null) return null;
  return { at: done, from: order?.method === 'ship' ? 'shipped' : 'handed_over' };
}

/** Whole days since the window started (0 on the day itself), or null when there's no start yet. */
export function daysSinceStart(order: any, now = Date.now()): number | null {
  const s = windowStart(order);
  if (!s) return null;
  return Math.max(0, Math.floor((now - s.at) / 86400000));
}

/** Is a window of `days` still open? A limit of 0 (or none) is no limit; no start date keeps it open. */
export function windowOpen(order: any, days: unknown, now = Date.now()): boolean {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  if (d <= 0) return true;
  const s = windowStart(order);
  if (!s) return true;
  return (now - s.at) / 86400000 <= d;
}

/** The last day of a window, for "Returns until Nov 12" (null with no limit or no start yet). */
export function windowEndsAt(order: any, days: unknown): number | null {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  const s = windowStart(order);
  if (d <= 0 || !s) return null;
  return s.at + d * 86400000;
}

/** How a closed window is described: "delivered 40 days ago", "shipped 40 days ago" (no delivery scan), … */
export function startedAgo(order: any, now = Date.now()): string {
  const s = windowStart(order);
  if (!s) return '';
  const n = Math.max(0, Math.floor((now - s.at) / 86400000));
  const verb = s.from === 'delivered' ? 'delivered' : s.from === 'shipped' ? 'shipped' : 'picked up';
  return `${verb} ${n} day${n === 1 ? '' : 's'} ago`;
}
