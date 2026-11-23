// src/lib/item-stickers.ts — A STICKER ON EACH ITEM, SCANNED BEFORE IT GOES (pure; design board "A sticker on each item,
// scanned into the bag", A: drinks first). The bags of a food order are scanned at the handover already (lib/food-bags);
// this goes one step in, for the items made at a station whose printer prints stickers (Settings, Printers: "Prints item
// stickers", for the bar):
//   - A sticker prints at that station as the order comes in, one for each item (two lattes, two stickers): the order
//     number, the guest's first name, the item with its choices and note, any allergy set off, "1 of 2", and its own code
//     (signed on the server, lib/order-qr makeItemCode). It's the barista's ticket too: grab a cup, stick it on, make
//     what it says.
//   - Before a to-go order is handed over (the counter, the drive-thru window, curbside), each sticker is scanned with
//     the bags; until then the handover waits, as for a bag. A drink for here is handed across as before.
//   - Printed again (a remake, a torn sticker): the new one carries the next version, and the old one stops scanning.
//   - Only stickers with a code are scanned: a Star printer on CloudPRNT prints words only. The business's "Scan bags
//     before they're handed over" (Menu page) covers stickers too, and a manager's PIN lets an order go without (with a
//     reason, kept on the order).
//   tenants/{t}/counterOrders/{id}.stickers = { list: [{ k: "<ticketId>.<unit>", name, v, c }], scanned: [k…] }
//   (c: the sticker carries a code); each ticket stickered keeps sticker = { printer, at }.
import type { PrintDoc, Block } from '@/lib/printing';
import { bagCheckOn } from '@/lib/food-bags';
import { modeOf } from '@/lib/plate-extras';

export type Sticker = { k: string; name: string; v: number; c: boolean };
export type ItemStickers = { list: Sticker[]; scanned: string[] };
export const STICKER_KEY = /^[A-Za-z0-9_-]{1,160}\.\d{1,2}$/;
/** Most stickers one item prints (its quantity, as a line allows), and one order keeps. */
export const MAX_UNITS = 20, MAX_STICKERS = 400;

/** "<ticketId>.<unit>": one item of a ticket for two. */
export const stickerKey = (ticketId: string, unit: number) => `${ticketId}.${unit}`;
export const ticketOfKey = (k: string) => k.slice(0, k.lastIndexOf('.'));
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** An order's stickers as kept, or null before any printed. */
export function stickersOf(order: any): ItemStickers | null {
  const s = order?.stickers; if (!s || typeof s !== 'object' || !Array.isArray(s.list) || !s.list.length) return null;
  const seen = new Set<string>(); const list: Sticker[] = [];
  for (const x of s.list.slice(0, MAX_STICKERS)) {
    const k = String(x?.k || ''); if (!STICKER_KEY.test(k) || seen.has(k)) continue; seen.add(k);
    const v = Math.max(1, Math.floor(Number(x?.v) || 1));
    list.push({ k, name: clip(x?.name, 80) || 'Item', v, c: x?.c === true });
  }
  const scanned = Array.from(new Set<string>((Array.isArray(s.scanned) ? s.scanned : []).map(String).filter((k: string) => seen.has(k))));
  return list.length ? { list, scanned } : null;
}

/** The order goes out with the guest (to go: the drive-thru, ordered ahead, a delivery app, or to go at the counter or
 *  the kiosk), so its stickers are scanned before it does. */
export const goesOut = (order: any) => !!order?.app?.code || modeOf(order?.channel, order?.toGo) === 'togo';

/** The stickers still to scan before this order is handed over: none when it's for here, its stickers carry no code,
 *  the business turned the scan off, or a manager let it go without. */
export function stickersLeft(order: any, tenant: any): Sticker[] {
  const s = stickersOf(order);
  if (!s || !goesOut(order) || !bagCheckOn(tenant) || order?.bags?.skipped) return [];
  return s.list.filter((x) => x.c && !s.scanned.includes(x.k));
}
/** Stickers with a code on a to-go order, not scanned and not let go by a manager, whatever the business's scan setting:
 *  how many went out unscanned (lib/counter-handover keeps it on the order). */
export function stickersUnscanned(order: any): number {
  const s = stickersOf(order); if (!s || !goesOut(order) || order?.bags?.skipped) return 0;
  return s.list.filter((x) => x.c && !s.scanned.includes(x.k)).length;
}
/** Every sticker scanned before it goes (for the scan sheet's ticks): each with whether it's done. */
export function stickersToScan(order: any, tenant: any): { k: string; name: string; done: boolean }[] {
  const s = stickersOf(order); const left = new Set(stickersLeft(order, tenant).map((x) => x.k));
  if (!s || !left.size) return [];
  return s.list.filter((x) => x.c).map((x) => ({ k: x.k, name: x.name, done: !left.has(x.k) }));
}

/** The stickers kept on an order once some of its items are taken off: a ticket gone takes its stickers with it, and a
 *  ticket for fewer keeps the first ones. */
export function stickersAfter(order: any, tickets: { id: string; quantity: number; cancelled: boolean }[]): ItemStickers | null {
  const s = stickersOf(order); if (!s) return null;
  const by = new Map(tickets.map((t) => [t.id, t]));
  const keep = (x: Sticker) => { const t = by.get(ticketOfKey(x.k)); if (!t) return true; const unit = Number(x.k.slice(x.k.lastIndexOf('.') + 1)); return !t.cancelled && unit <= t.quantity; };
  const list = s.list.filter(keep);
  return { list, scanned: s.scanned.filter((k) => list.some((x) => x.k === k)) };
}

/** What one sticker says ("1 of 2": two of the same item, numbered; one alone, not). */
export type StickerLabel = { number: string; name: string | null; item: string; sub: string[]; allergy: string[]; n: number; of: number; code: string | null };
/** One item's sticker, from its kitchen ticket as the kitchen reads it (lib/kitchen ticketFrom). */
export function stickerOf(order: any, t: { item: string; choiceList: string[]; note: string | null }, allergy: string[], n: number, of: number, code: string | null): StickerLabel {
  return {
    number: clip(order?.number, 12), name: clip(order?.guestName, 60).split(' ')[0]?.slice(0, 30) || null,
    item: clip(t.item, 60) || 'Item', sub: [t.choiceList.length ? clip(t.choiceList.join(', '), 120) : '', t.note ? `Note: ${clip(t.note, 140)}` : ''].filter(Boolean),
    allergy: allergy.slice(0, 3), n, of, code,
  };
}
/** The name the scan sheet shows for a sticker: "Large oat latte", or with its choices when they make it. */
export const stickerName = (t: { item: string; choiceList: string[] }) => clip(t.choiceList.length ? `${t.item}, ${t.choiceList.join(', ')}` : t.item, 80);

/** One sticker, for a printer (lib/printing): one slip, cut after it. */
export function stickerDoc(l: StickerLabel): PrintDoc {
  const blocks: Block[] = [{ k: 'head', left: l.number || 'Order', right: l.name || undefined }, { k: 'text', text: l.item, bold: true }];
  for (const s of l.sub) blocks.push({ k: 'text', text: s });
  for (const a of l.allergy) blocks.push({ k: 'alert', text: a });
  if (l.of > 1) blocks.push({ k: 'text', text: `${l.n} of ${l.of}` });
  if (l.code) blocks.push({ k: 'qr', data: l.code });
  return { blocks, buzz: false };
}

/** A sticker's code, read without checking it (the server checks): which order and item it says it's for. */
export function parseItemCode(raw: string): { orderId: string; k: string; v: number } | null {
  const m = /^clarityflow:\/\/item\/([A-Za-z0-9_-]{1,160})\.([A-Za-z0-9_-]{1,160}\.\d{1,2})\.(\d{1,3})\.[0-9a-f]{16}$/.exec(String(raw || '').trim());
  return m ? { orderId: m[1], k: m[2], v: Number(m[3]) } : null;
}

/** "the sticker on Large oat latte", "2 item stickers". */
export const stickersWords = (left: { name: string }[]) => (left.length === 1 ? `the sticker on ${left[0].name}` : `${left.length} item stickers`);
