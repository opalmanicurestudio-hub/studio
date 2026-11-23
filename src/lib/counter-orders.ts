// src/lib/counter-orders.ts — QUICK-SERVICE ORDERS (pure; the same on the server and every screen): the counter, the
// drive-thru, the kiosk and orders placed ahead. Each order has a short number that says where it came from (B16 is a
// drive-thru car), lines priced from the menu with their choices (lib/menu-choices), sales tax by the business's own
// settings (lib/pos-tax), and a time it should be ready by: a target per channel, the drive-thru's the tightest, and
// never less than the slowest thing on it takes to make. The kitchen screen orders its work by that time, drive-thru
// first, so the line that can't wait doesn't.
import { priceChoices, choicesText, itemSoldOut, type PickedChoice } from '@/lib/menu-choices';
import { posTaxAmount, posTaxLabel } from '@/lib/pos-tax';
import { offeredOnMenu } from '@/lib/menu-stock';
import { priceNow, servedNow } from '@/lib/menu-time';
import { byWeightOf, cleanWeight, stockAmountOf, weightText, perText, type WeightUnit } from '@/lib/menu-weight';
import { nameEsOf } from '@/lib/guest-lang';

export type Channel = 'drive-thru' | 'counter' | 'kiosk' | 'ahead';
export const CHANNELS: Channel[] = ['drive-thru', 'counter', 'kiosk', 'ahead'];
/** Whether a place in line (a car, or a guest at the counter) is the drive-thru's: everything before the counter had its own
 *  line is. The drive-thru's screens (the order board, the windows, the voice assistant) only ever see these. */
export const atDriveThru = (c: any) => (c?.channel || 'drive-thru') === 'drive-thru';
/** The counter's line: its own guests, and kiosk orders once they're paid (they wait at the counter to be handed over). */
export const counterSide = (channel: unknown) => channel === 'counter' || channel === 'kiosk';
export const isChannel = (v: unknown): v is Channel => typeof v === 'string' && (CHANNELS as string[]).includes(v);

/** What the number starts with: B for a drive-thru car, C at the counter, K from a kiosk, A for ordered ahead. */
export const PREFIX: Record<Channel, string> = { 'drive-thru': 'B', counter: 'C', kiosk: 'K', ahead: 'A' };
export const CHANNEL_NAME: Record<Channel, string> = { 'drive-thru': 'Drive-thru', counter: 'Counter', kiosk: 'Kiosk', ahead: 'Ordered ahead' };

/** Seconds from order to handed over that each channel aims for (the business can set its own). The drive-thru's is the
 *  tightest: a car waiting holds up every car behind it. */
export const DEFAULT_TARGETS: Record<Channel, number> = { 'drive-thru': 210, counter: 300, kiosk: 300, ahead: 600 };
/** A long line: this many cars in the drive-thru (the voice assistant goes into rush mode, and the lane says so). */
export const RUSH_CARS = 6;
// A car taken in line (before the speaker) is told apart by how it looks: a color and a kind, tapped on the phone.
export const CAR_COLORS = ['White', 'Black', 'Gray', 'Silver', 'Red', 'Blue', 'Green', 'Brown', 'Gold'] as const;
export const CAR_KINDS = ['Car', 'SUV', 'Truck', 'Van', 'Motorcycle'] as const;
/** How a car looks ("Red SUV"), cleaned: letters, numbers and a few marks, up to 30 characters; or none. */
export function cleanLooks(v: unknown): string | null {
  const t = String(v ?? '').replace(/[^\p{L}\p{N} '’.-]/gu, '').replace(/\s+/g, ' ').trim();
  return t ? Array.from(t).slice(0, 30).join('').trim() : null;
}
/** Cars that count toward a long line: those that arrived in the last three hours (one left behind yesterday never does). */
export const inLineNow = (cars: { id?: string; arrivedAt?: unknown }[], nowMs: number, except?: string): number =>
  cars.filter((c) => c.id !== except && Date.parse(String(c.arrivedAt || '')) >= nowMs - 3 * 3600000).length;
/** How many pull-forward spots the drive-thru has (set on the Menu page): 1 to 8, 4 if it hasn't been set. */
export const spotsOf = (tenant: any): number => { const n = Math.floor(Number(tenant?.driveThru?.spots)); return n >= 1 && n <= 8 ? n : 4; };
/** Ordering ahead is on with the drive-thru as a way to pick up (lib/counter-ahead aheadOf, Menu page → Ordering ahead). */
export const aheadAtDriveThru = (tenant: any): boolean => tenant?.orderAhead?.on === true && tenant?.orderAhead?.driveThru !== false;
/** A drive-thru that only hands out orders placed ahead (Menu page, Service times): nobody orders at the speaker, and the
 *  voice assistant stays off. Only while orders placed ahead can come to it: with ordering ahead off (or not at the
 *  drive-thru), cars order at the speaker as usual, whatever was chosen. */
export const pickupOnlyOf = (tenant: any): boolean => tenant?.driveThru?.pickupOnly === true && aheadAtDriveThru(tenant);
/** A car with an order placed ahead going with it (car.aheadId: found at the speaker while the car was ordering), whose
 *  own order ends without being handed over (voided, let go, or nothing added): it carries on to pickup with the order it
 *  paid for ahead, under that order's number. A paid order is never left behind in the lane. */
export const carryOn = (car: any, nowIso: string) => ({ orderId: String(car.aheadId), aheadId: null, aheadNumber: null, number: String(car.aheadNumber || car.number || ''), ahead: true,
  stage: 'pickup', stageAt: { ...(car.stageAt || {}), pickup: nowIso } });
export const DEFAULT_MAKE_SECONDS = 120;

export function targetsOf(tenant: any): Record<Channel, number> {
  const t = tenant?.kitchenSettings?.targets || {};
  const out = { ...DEFAULT_TARGETS };
  for (const c of CHANNELS) { const n = Math.floor(Number(t[c])); if (Number.isFinite(n) && n >= 60 && n <= 3600) out[c] = n; }
  return out;
}

/** How long an item takes to make, in seconds (the menu's own, or two minutes). */
export const makeSecondsOf = (item: any) => { const n = Math.floor(Number(item?.makeSeconds)); return Number.isFinite(n) && n >= 10 && n <= 3600 ? n : DEFAULT_MAKE_SECONDS; };
/** How long a cooked batch of it can be held before it's thrown out, in minutes (0: it isn't held). */
export const holdMinutesOf = (item: any) => { const n = Math.floor(Number(item?.holdMinutes)); return Number.isFinite(n) && n >= 1 && n <= 240 ? n : 0; };

export type OrderLine = { lineId: string; itemId: string; name: string; quantity: number; unitPrice: number; choices: PickedChoice[]; choicesText: string | null; makeSeconds: number; imageUrl?: string | null; happy?: boolean;
  /** Its name in Spanish, from the menu, for a guest screen set to Español (lib/guest-lang). The team's screens, the
   *  kitchen and the receipt always use `name`. */
  nameEs?: string;
  /** Taken as an offer, right after something else was added (lib/menu-upgrades): a size up, or something to go with it. */
  offer?: 'size' | 'item';
  /** A note for the kitchen about this dish ("no onions"), on its tickets only (lib/order-allergy). */
  note?: string | null;
  /** Something not on the menu, rung in at the counter (lib/counter-oneoff): no item, no kitchen, no stock; `untaxed`
   *  when the counter said it isn't taxed. */
  oneOff?: boolean; untaxed?: boolean;
  /** On the house (lib/counter-comp-server): $0 here, its price kept, why, and the manager who okayed it. */
  comp?: { from: number; reason: string; by: string; approvedBy: string; at: string };
  /** At a different price (lib/counter-price-server): its menu price, the price now, why, who, and the manager who okayed
   *  a lower one. */
  priceChange?: { from: number; to: number; reason: string; by: string; approvedBy: string | null; at: string };
  /** Sold by weight (lib/menu-weight): what it weighed, in what unit, at what price per unit, and what came off stock. */
  weight?: { amount: number; unit: 'lb' | 'oz' | 'kg' | 'g'; per: number; stock: number };
  /** Scanned from a scale's sticker (lib/scale-label): what the sticker held, and its barcode. A sticker with the price
   *  is charged what it says; its weight is worked out from the menu's price, for stock. */
  label?: { kind: 'weight' | 'price'; code: string };
  /** A gift card sold with the order (lib/counter-gift): who it's for, how it gets to them, and once it's made its code. */
  giftCard?: { to: string | null; via: 'print' | 'text' | 'email'; phone: string | null; email: string | null; id?: string | null; code?: string | null; sent?: boolean; failed?: string | null; claim?: { token: string; at: string } | null; bonusCode?: string | null } };

/** An item's photo, if it has one that can be shown anywhere (an https address, as the Menu page uploads). */
export const photoOf = (item: any): string | null => {
  const u = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
  return /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 1500 ? u : null;
};

/** One line, from the menu item itself (never a price from a screen). With the business (`at`: when it's ordered), an item
 *  in a menu by time of day is sold only while that's on, and happy hour prices it (lib/menu-time). `here`: the location
 *  it's ordered at, with more than one (sold out there, or everywhere: lib/menu-choices outWhere). */
export function lineFor(item: any, itemId: string, quantity: unknown, picks: unknown, lineId: string, ctx?: { tenant?: any; at?: Date; here?: string | null }, maxQty = 20, weight?: unknown): { ok: true; line: OrderLine } | { ok: false; error: string } {
  const here = ctx?.here || null; const timed = !!ctx && 'tenant' in ctx;
  // Off the menu (never priced yet, or taken off): not sold, even from a screen that still shows it.
  if (!item || item.type !== 'refreshment' || item.archived === true || item.isActive === false || !offeredOnMenu(item)) return { ok: false, error: 'That isn’t on the menu.' };
  if (itemSoldOut(item, here)) return { ok: false, error: `${String(item.name || 'That')} is sold out right now.` };
  if (timed) { const sv = servedNow(item, ctx!.tenant, ctx!.at); if (!sv.ok) return { ok: false, error: `${String(item.name || 'That')} isn’t on now: ${sv.when}.` }; }
  const q = Math.floor(Number(quantity));
  // (Up to 20 of one thing, or more for an order for another day: lib/ahead-days LATER_MAX_QTY.)
  if (!Number.isFinite(q) || q < 1 || q > maxQty) return { ok: false, error: `How many? Between 1 and ${maxQty}.` };
  const c = priceChoices(item, picks, here);
  if (!c.ok) return { ok: false, error: c.error };
  const base = timed ? priceNow(item, ctx!.tenant, ctx!.at) : { price: Number(item.price || 0), happy: false };
  // Sold by weight (lib/menu-weight): one weighing a line, the weight times the price per unit, its choices' extras once.
  const wu: WeightUnit | null = byWeightOf(item);
  if (wu) {
    if (weight === undefined || weight === null || weight === '') return { ok: false, error: `${String(item.name || 'That')} is weighed at the counter. Type what the scale reads.` };
    const w = cleanWeight(weight, wu); if (w === null) return { ok: false, error: `How much does it weigh, in ${wu}?` };
    if (q !== 1) return { ok: false, error: 'One weighing a line. Weigh it again for more.' };
    const price = Math.max(0, Math.round((w * base.price + c.extra) * 100) / 100);
    if (!(price > 0)) return { ok: false, error: 'That weighs too little to charge for. Weigh it again.' };
    const words = `${weightText(w, wu)} at ${perText(base.price, wu)}`;
    return { ok: true, line: { lineId, itemId, name: String(item.name || 'Item').slice(0, 80), quantity: 1, unitPrice: price, choices: c.lines, choicesText: c.text ? `${words}, ${c.text}` : words, makeSeconds: makeSecondsOf(item), imageUrl: photoOf(item),
      weight: { amount: w, unit: wu, per: Math.round(base.price * 100) / 100, stock: stockAmountOf(w, wu, item) }, ...(base.happy ? { happy: true } : {}), ...esOf(item) } };
  }
  const unit = Math.max(0, Math.round((base.price + c.extra) * 100) / 100);
  return { ok: true, line: { lineId, itemId, name: String(item.name || 'Item').slice(0, 80), quantity: q, unitPrice: unit, choices: c.lines, choicesText: c.text || null, makeSeconds: makeSecondsOf(item), imageUrl: photoOf(item), ...(base.happy ? { happy: true } : {}), ...esOf(item) } };
}
/** (Only when the item has one: most lines never carry it.) */
const esOf = (item: any) => { const es = nameEsOf(item); return es ? { nameEs: es } : {}; };

/** The order's money: subtotal, the business's sales tax on food and drink, and the total. `off`: a reward used on it
 *  (lib/counter-points useReward), in dollars: the subtotal is what's left after it (what's sold, and what's taxed), and
 *  the items' own total is kept beside it. Something rung in as not taxed (lib/counter-oneoff) is left out of what's
 *  taxed, with its share of the reward. A gift card sold with it (lib/counter-gift) is money held for the guest: never in
 *  the subtotal (what's sold), never discounted or taxed, only in the total (`giftCards`, beside it). */
export function totalsOf(tenant: any, lines: OrderLine[], off = 0): { subtotal: number; tax: number; taxLabel: string; total: number; discount?: number; itemsTotal?: number; giftCards?: number } {
  const sold = lines.filter((l) => !l.giftCard);
  const gift = Math.round(lines.reduce((s, l) => s + (l.giftCard ? l.unitPrice * l.quantity : 0), 0) * 100) / 100;
  const items = Math.round(sold.reduce((s, l) => s + l.unitPrice * l.quantity, 0) * 100) / 100;
  const discount = Math.round(Math.max(0, Math.min(Number(off) || 0, items)) * 100) / 100;
  const subtotal = Math.round((items - discount) * 100) / 100;
  const untaxed = Math.round(sold.reduce((s, l) => s + (l.untaxed ? l.unitPrice * l.quantity : 0), 0) * 100) / 100;
  const taxed = untaxed > 0 && items > 0 ? Math.round(subtotal * ((items - untaxed) / items) * 100) / 100 : subtotal;
  const tax = posTaxAmount(tenant, { services: 0, products: taxed });
  return { subtotal, tax, taxLabel: posTaxLabel(tenant), total: Math.round((subtotal + tax + gift) * 100) / 100, ...(discount > 0 ? { discount, itemsTotal: items } : {}), ...(gift > 0 ? { giftCards: gift } : {}) };
}

/** When it should be ready: the channel's target from when it was sent, but never sooner than its slowest line takes. */
export function dueAt(channel: Channel, sentAtMs: number, lines: Pick<OrderLine, 'makeSeconds'>[], tenant?: any): number {
  const slowest = lines.reduce((m, l) => Math.max(m, Number(l.makeSeconds) || DEFAULT_MAKE_SECONDS), 0);
  return sentAtMs + Math.max(targetsOf(tenant)[channel], slowest) * 1000;
}

/** The kitchen's order of work: drive-thru first, then whatever is due soonest. */
export function byUrgency<T extends { channel?: string | null; dueAt?: string | number | null; at?: string }>(a: T, b: T): number {
  const dt = (x: T) => Number(x.channel === 'drive-thru');
  if (dt(a) !== dt(b)) return dt(b) - dt(a);
  const d = (x: T) => { const v = typeof x.dueAt === 'number' ? x.dueAt : Date.parse(String(x.dueAt || x.at || '')); return Number.isFinite(v) ? v : Infinity; };
  return d(a) - d(b);
}

/** "1:12 left", "0:40 over": how a ticket stands against its time. */
export function timeLeft(dueAtMs: number, nowMs: number): { left: number; over: boolean; text: string } {
  const s = Math.round((dueAtMs - nowMs) / 1000); const a = Math.abs(s);
  const t = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  return { left: s, over: s < 0, text: s < 0 ? `${t} over` : `${t} left` };
}

/** The order's number: its channel's letter and the day's count for that channel ("B16"). */
export const orderNumber = (channel: Channel, n: number) => `${PREFIX[channel]}${Math.max(1, Math.floor(n))}`;

/** The words read back to a guest, or on a bag label: "2 Latte, Large, Oat. Breakfast sandwich, No cheese." */
export function readBack(lines: Pick<OrderLine, 'name' | 'quantity' | 'choicesText'>[]): string {
  return lines.map((l) => `${l.quantity > 1 ? `${l.quantity} ` : ''}${l.name}${l.choicesText ? `, ${l.choicesText}` : ''}`).join('. ') + (lines.length ? '.' : '');
}

export { choicesText };

// ── COMBOS (design canvas "The counter and the menus") ──────────────────────────────────────────────────────────────
/** What a line is made as. A combo ("Burger meal": a burger, plus a side and a drink chosen) is made as its parts: the
 *  ones it always has (`comboParts`) and the ones picked (a choice whose option is another menu item), each its own ticket
 *  at its own station and its own stock. Anything else is made as itself. */
export function partsOfLine(l: Pick<OrderLine, 'itemId' | 'choices'>, item: any): string[] {
  if (item?.combo !== true) return [l.itemId];
  const ok = (x: string) => /^[A-Za-z0-9_-]{1,160}$/.test(x);
  const fixed = (Array.isArray(item.comboParts) ? item.comboParts : []).map((p: any) => String(p?.itemId || '')).filter(ok);
  const picked = (Array.isArray(l.choices) ? l.choices : []).map((c) => {
    const g = (Array.isArray(item.choices) ? item.choices : []).find((x: any) => String(x?.id) === c.groupId);
    const o = (Array.isArray(g?.options) ? g.options : []).find((x: any) => String(x?.id) === c.optionId);
    return String(o?.itemId || '');
  }).filter(ok);
  const ids = [...fixed, ...picked].slice(0, 8);
  return ids.length ? ids : [l.itemId];
}
/** "Burger, fries and iced tea": a combo's parts in words. */
export const partsWords = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
