// src/lib/bag-tag.ts — BAG TAGS (pure; the same on the server and every screen). Every bag of a pickup order gets a tag
// as it's finished: "Bag 1 of 3", the customer's name, the shelf spot and the bag's own code (signed on the server,
// lib/order-qr makeBagCode). At handover each bag is scanned before the customer's code, so the right bags go to the
// right person and none is left behind (Walmart pickup works this way). On unless the shop turns it off in Setup
// (`scanBagAtHandover: false`); orders finished before bags were counted (no `bagCount`) are handed over as before.
// A shipped order goes out in its boxes (lib/ship-run), and a delivery is handled on its Delivery tab. An order from
// the line at a pop-up is bagged and called at a table that usually has no printer, so its bags aren't scanned. A tag
// that won't scan (or a count that was wrong) is handed over with a manager's PIN instead, kept on the order.

export const BAG_PREFIX = 'clarityflow://bag/';
export const MAX_BAGS = 20;

/** The order and bag number a scanned tag names (the signature is checked by the server, not here). */
export function parseBagCode(raw: string): { orderId: string; n: number } | null {
  const m = /^clarityflow:\/\/bag\/([A-Za-z0-9_-]{1,160})\.(\d{1,2})\.[0-9a-f]{16}$/.exec(String(raw || '').trim());
  return m && Number(m[2]) >= 1 ? { orderId: m[1], n: Number(m[2]) } : null;
}

/** The shop scans bags at handover unless it turned that off. */
export function bagScanOn(rs: any): boolean {
  return rs?.scanBagAtHandover !== false;
}

/** How many bags a number of bags is, kept between 1 and the most a tag sheet prints. */
export function clampBags(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_BAGS, Math.max(1, n)) : 1;
}

/** An order that goes out in bags: picked up (at the counter, curbside, the window, a pop-up table) or delivered. */
export function goesInBags(order: any): boolean {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  return order?.method !== 'ship' && order?.method !== 'digital' && lines.some((l: any) => l && l.digital !== true);
}

/** The bags this order's handover needs scanned: none for an order finished before bags were counted. */
export function bagsToScan(order: any, rs: any): number {
  const n = Math.floor(Number(order?.bagCount) || 0);
  return bagScanOn(rs) && goesInBags(order) && order?.method !== 'delivery' && !order?.popupId && n > 0 ? Math.min(MAX_BAGS, n) : 0;
}

/** "Bag 2 of 3", or "The bag" for one. */
export function bagWords(n: number, of: number): string {
  return of > 1 ? `Bag ${n} of ${of}` : 'The bag';
}
