// src/lib/food-bags.ts — BAG LABELS ON FOOD ORDERS, AND A SCAN BEFORE IT GOES (pure; design board "Bag labels, and a
// check before it goes", A: scan each bag). The shop's pickups already work this way (lib/bag-tag); this is the café's.
//   - When an order is all ready, a sticky label prints for each bag (lib/food-bags-server), on a printer set to print
//     bag labels (Settings, Printers), or from a tablet's own print dialog on the counter. Each label: the order number
//     big, how it's going out, the guest's name, "Bag 2 of 3", every item with its choices and notes, any allergy set
//     off, and the bag's own code (signed on the server, lib/order-qr makeBagCode), so a label can't be made up.
//   - How many bags: one for every ITEMS_PER_BAG items, changed with a tap when printing again.
//   - Before it's handed over (at the counter, the drive-thru window, curbside), each bag is scanned: a missing bag is
//     asked for, and a bag from another order says whose it is. The server checks the signed codes and keeps what was
//     scanned on the order. A manager's PIN lets one go without (a torn label), kept on the order.
//   - Only labels that carry a code are scanned: a Star printer on CloudPRNT prints words only, so an order labeled
//     there goes as before. A business can turn the scan off (Menu page, Service times); the labels still print.
//     tenants/{t}/counterOrders/{id}.bags = { count, printedAt, coded, scanned: [n…], skipped: { by, at } | null }
import type { PrintDoc, Block } from '@/lib/printing';
import { allergyWords, orderAllergyOf } from '@/lib/order-allergy';

export const ITEMS_PER_BAG = 6;
export const MAX_FOOD_BAGS = 9;

export type FoodBags = { count: number; printedAt: string; coded: boolean; scanned: number[]; skipped: { by: string; at: string } | null };

const n0 = (v: unknown) => { const x = Math.floor(Number(v)); return Number.isFinite(x) ? x : 0; };
/** A bag count kept between 1 and the most a label set prints. */
export const clampBags = (v: unknown) => Math.min(MAX_FOOD_BAGS, Math.max(1, n0(v) || 1));

/** An order's bags as kept, or null before any label was printed. */
export function bagsOf(order: any): FoodBags | null {
  const b = order?.bags; if (!b || typeof b !== 'object' || !b.printedAt) return null;
  const count = clampBags(b.count);
  const scanned = Array.from(new Set<number>((Array.isArray(b.scanned) ? b.scanned : []).map(n0).filter((n: number) => n >= 1 && n <= count))).sort((a, c) => a - c);
  const sk = b.skipped && typeof b.skipped === 'object' && b.skipped.by ? { by: String(b.skipped.by).slice(0, 60), at: String(b.skipped.at || '') } : null;
  return { count, printedAt: String(b.printedAt), coded: b.coded === true, scanned, skipped: sk };
}

/** What goes in a bag: the dishes and drinks the kitchen makes (not a gift card or a one-off on the bill). */
const bagLines = (order: any) => (Array.isArray(order?.lines) ? order.lines : []).filter((l: any) => l && !l.giftCard && !l.oneOff);

/** How many bags, to start with: one for every ITEMS_PER_BAG items. */
export function defaultBags(order: any): number {
  const items = bagLines(order).reduce((s: number, l: any) => s + Math.max(1, n0(l.quantity) || 1), 0);
  return clampBags(Math.ceil(Math.max(1, items) / ITEMS_PER_BAG));
}

/** Why a manager let an order go without everything scanned (kept on the order, and on the record). */
export const SKIP_REASONS = [{ id: 'wont_scan', label: 'A label or sticker won’t scan' }, { id: 'printer', label: 'The printer is down' }, { id: 'other', label: 'Something else' }] as const;
export const skipReasonOf = (v: unknown): string => SKIP_REASONS.find((r) => r.id === v)?.label || 'Not said';
/** One of the reasons (a skip without one is refused). */
export const isSkipReason = (v: unknown) => SKIP_REASONS.some((r) => r.id === v);
/** The reason in the middle of a sentence: "the printer is down". */
export const reasonWords = (label: string) => `${label.charAt(0).toLowerCase()}${label.slice(1)}`;

/** The business scans bags before they're handed over, unless it turned that off. */
export const bagCheckOn = (tenant: any) => tenant?.bagCheck?.off !== true;

/** The bags still to scan before this order is handed over (bag numbers); none when its labels carry no code, it has
 *  none, the business turned the scan off, or a manager let it go without. */
export function bagsLeft(order: any, tenant: any): number[] {
  const b = bagsOf(order);
  if (!b || !b.coded || b.skipped || !bagCheckOn(tenant)) return [];
  return Array.from({ length: b.count }, (_, i) => i + 1).filter((n) => !b.scanned.includes(n));
}

/** "Bag 2 of 3", or "The bag". */
export const bagName = (n: number, of: number) => (of > 1 ? `Bag ${n} of ${of}` : 'The bag');
/** "bags 2 and 3", "bag 2", "the bag". */
export function bagsWords(ns: number[], of: number): string {
  if (of <= 1) return 'the bag';
  if (ns.length === 1) return `bag ${ns[0]}`;
  return `bags ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/** How it's going out, as the label says it. */
export function wayWords(order: any): string {
  if (order?.app?.code) return `${String(order.app.label || 'Delivery app').slice(0, 30)} ${String(order.app.code).slice(0, 12)}`;
  if (order?.channel === 'drive-thru') return 'Drive-thru';
  if (order?.channel === 'kiosk') return 'Kiosk';
  if (order?.channel === 'ahead') { const w = String(order?.ahead?.way || 'inside'); return w === 'curbside' ? 'Curbside' : w === 'delivery' ? 'Delivery' : w === 'drive-thru' ? 'Ordered ahead, drive-thru' : 'Ordered ahead'; }
  return 'Counter';
}

export type BagLabel = { number: string; name: string | null; way: string; n: number; of: number; items: { qty: number; name: string; sub: string[] }[]; allergy: string | null; code: string | null;
  /** The business's name, at the top (its initial in a black tile, when drawn in the app's look: lib/print-picture). */
  business?: string | null };

/** What one bag's label says. `code`: the bag's signed code (none for a printer that can't print one). */
export function labelOf(order: any, n: number, of: number, code: string | null, business: string | null = null): BagLabel {
  const a = allergyWords(orderAllergyOf(order));
  return { business: business ? String(business).slice(0, 60) : null,
    number: String(order?.number || '').slice(0, 12), name: String(order?.guestName || '').trim().split(/\s+/)[0]?.slice(0, 30) || null, way: wayWords(order), n, of,
    items: bagLines(order).slice(0, 30).map((l: any) => ({ qty: Math.max(1, n0(l.quantity) || 1), name: String(l.name || 'Item').slice(0, 60),
      sub: [l.choicesText ? String(l.choicesText).slice(0, 120) : null, l.note ? `Note: ${String(l.note).slice(0, 140)}` : null].filter(Boolean) as string[] })),
    allergy: a ? `Allergy: ${a}` : null, code,
  };
}

/** One bag's label, for a printer (lib/printing): one slip, cut after it. */
export function labelDoc(l: BagLabel): PrintDoc {
  const blocks: Block[] = l.business ? [{ k: 'brand', name: l.business }] : [];
  blocks.push({ k: 'head', left: l.number || 'Order' });
  if (l.name) blocks.push({ k: 'text', text: l.name, bold: true });
  blocks.push({ k: 'text', text: `${l.way}, ${bagName(l.n, l.of).toLowerCase()}` }, { k: 'rule' });
  for (const it of l.items) blocks.push({ k: 'item', qty: it.qty, name: it.name, sub: it.sub });
  if (l.allergy) blocks.push({ k: 'alert', text: l.allergy });
  if (l.code) blocks.push({ k: 'qr', data: l.code });
  // (Drawn as a picture, the code sits beside the number and name.)
  return { blocks, buzz: false, qrBeside: true };
}
