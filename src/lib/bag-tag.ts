// src/lib/bag-tag.ts — BAG TAGS (pure; the same on the server and every screen). Every bag of a pickup order gets a tag
// as it's finished: "Bag 1 of 3", the customer's name, the shelf spot and the bag's own code (signed on the server,
// lib/order-qr makeBagCode). At handover each bag is scanned before the customer's code, so the right bags go to the
// right person and none is left behind (Walmart pickup works this way). On unless the shop turns it off in Setup
// (`scanBagAtHandover: false`); orders finished before bags were counted (no `bagCount`) are handed over as before.
// A delivery's bags are scanned into the van as its driver takes it out instead (bagsToLoad), and every order's bags are
// scanned onto their spot on the ready shelf (bagsToShelve). A shipped order goes out in its boxes (lib/ship-run). An
// order from the line at a pop-up is bagged and called at a table that usually has no printer, so its bags aren't
// scanned. A tag that won't scan (or a count that was wrong) goes out with a manager's PIN instead, kept on the order.

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

/** A delivery's bags, each scanned into the van as its driver takes it out (Amazon's drivers scan every bag as they load):
 *  none for an order finished before bags were counted. */
export function bagsToLoad(order: any, rs: any): number {
  const n = Math.floor(Number(order?.bagCount) || 0);
  return bagScanOn(rs) && order?.method === 'delivery' && goesInBags(order) && n > 0 ? Math.min(MAX_BAGS, n) : 0;
}

/** Bags are scanned onto their shelf spot (each bag, then the spot's label) unless the shop turned that off, or doesn't
 *  scan bags at all. */
export function shelfScanOn(rs: any): boolean {
  return bagScanOn(rs) && rs?.scanBagToShelf !== false;
}

/** The bags an order puts on the ready shelf: one finished in bags that waits there (for its customer or its driver).
 *  Pop-up orders are called at their table instead. */
export function bagsToShelve(order: any, rs: any): number {
  const n = Math.floor(Number(order?.bagCount) || 0);
  return shelfScanOn(rs) && goesInBags(order) && !order?.popupId && n > 0 ? Math.min(MAX_BAGS, n) : 0;
}

/** On the ready shelf with its bags not yet scanned onto a spot (a delivery brought back is put away again). */
export function needsPutAway(order: any, rs: any): boolean {
  if (!bagsToShelve(order, rs) || !['ready', 'arrived'].includes(String(order?.stage))) return false;
  if (order?.method === 'delivery' && order?.delivery?.status === 'out') return false;
  return !order?.putAway?.at;
}

// ─── SHELF SPOTS ───────────────────────────────────────────────────────────────
// Each spot on the ready shelf has a label with its name and a barcode of "SPOT-A3" (lib/shelf-labels-client). Putting
// an order away is scanning each of its bags, then the spot's label, so the shelf says where every bag is.
export const SPOT_ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const SPOTS_PER_ROW = 12;
export const spotCode = (spot: string) => `SPOT-${String(spot).toUpperCase()}`;
/** Every spot the ready shelf hands out (lib/orders-view nextFreeSlot), in order, then Overflow. */
export const allSpots = (): string[] => [...SPOT_ROWS.flatMap((r) => Array.from({ length: SPOTS_PER_ROW }, (_, i) => `${r}${i + 1}`)), 'Overflow'];

/** The spot a scanned shelf label names ("SPOT-A3", or a spot typed as "a3"), as the shelf shows it: only a spot the
 *  shelf hands out, so a product's label or a code that looks like a spot is never taken for one. Null otherwise. */
export function parseSpot(raw: string): string | null {
  const t = String(raw || '').trim().toUpperCase();
  const m = /^SPOT-([A-Z0-9]{1,10})$/.exec(t) || /^([A-Z]\d{1,2}|OVERFLOW)$/.exec(t);
  if (!m) return null;
  const spot = m[1] === 'OVERFLOW' ? 'Overflow' : m[1];
  return allSpots().includes(spot) ? spot : null;
}

/** "Bag 2 of 3", or "The bag" for one. */
export function bagWords(n: number, of: number): string {
  return of > 1 ? `Bag ${n} of ${of}` : 'The bag';
}

/** "#0012" for an order. */
const numOf = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;

export type BagReply = { ok: true; n: number; code: string } | { ok: false; message: string };
/** What a scanned tag means for one order's bags (the screens say it straight away; the server checks the signed codes
 *  again as the step goes through): one of its own, counted once; another order's, and whose; a tag from an earlier
 *  print; or not a bag tag at all. */
export function bagReply(v: string, order: any, need: number, have: { has: (n: number) => boolean }, lookup?: (orderId: string) => any): BagReply {
  const tag = parseBagCode(v);
  if (!tag) return { ok: false, message: 'That isn’t a bag tag. Scan the tag on the bag.' };
  if (tag.orderId !== String(order?.id ?? '')) {
    const o = lookup?.(tag.orderId);
    return { ok: false, message: o ? `Wrong bag. This one is ${numOf(o)} for ${o.customerName || 'someone else'}.` : 'Wrong bag. This one is for another order.' };
  }
  if (tag.n > need) return { ok: false, message: 'That tag is from an earlier print. Reprint the tags and scan the new ones.' };
  if (have.has(tag.n)) return { ok: false, message: `${bagWords(tag.n, need)} is already scanned.` };
  return { ok: true, n: tag.n, code: String(v).trim() };
}
