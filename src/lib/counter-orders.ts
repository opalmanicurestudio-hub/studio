// src/lib/counter-orders.ts — QUICK-SERVICE ORDERS (pure; the same on the server and every screen): the counter, the
// drive-thru, the kiosk and orders placed ahead. Each order has a short number that says where it came from (B16 is a
// drive-thru car), lines priced from the menu with their choices (lib/menu-choices), sales tax by the business's own
// settings (lib/pos-tax), and a time it should be ready by: a target per channel, the drive-thru's the tightest, and
// never less than the slowest thing on it takes to make. The kitchen screen orders its work by that time, drive-thru
// first, so the line that can't wait doesn't.
import { priceChoices, choicesText, itemSoldOut, type PickedChoice } from '@/lib/menu-choices';
import { posTaxAmount, posTaxLabel } from '@/lib/pos-tax';

export type Channel = 'drive-thru' | 'counter' | 'kiosk' | 'ahead';
export const CHANNELS: Channel[] = ['drive-thru', 'counter', 'kiosk', 'ahead'];
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

export type OrderLine = { lineId: string; itemId: string; name: string; quantity: number; unitPrice: number; choices: PickedChoice[]; choicesText: string | null; makeSeconds: number; imageUrl?: string | null };

/** An item's photo, if it has one that can be shown anywhere (an https address, as the Menu page uploads). */
export const photoOf = (item: any): string | null => {
  const u = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
  return /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 1500 ? u : null;
};

/** One line, from the menu item itself (never a price from a screen). */
export function lineFor(item: any, itemId: string, quantity: unknown, picks: unknown, lineId: string): { ok: true; line: OrderLine } | { ok: false; error: string } {
  if (!item || item.type !== 'refreshment' || item.archived === true || item.isActive === false) return { ok: false, error: 'That isn’t on the menu.' };
  if (itemSoldOut(item)) return { ok: false, error: `${String(item.name || 'That')} is sold out right now.` };
  const q = Math.floor(Number(quantity));
  if (!Number.isFinite(q) || q < 1 || q > 20) return { ok: false, error: 'How many? Between 1 and 20.' };
  const c = priceChoices(item, picks);
  if (!c.ok) return { ok: false, error: c.error };
  const unit = Math.max(0, Math.round((Number(item.price || 0) + c.extra) * 100) / 100);
  return { ok: true, line: { lineId, itemId, name: String(item.name || 'Item').slice(0, 80), quantity: q, unitPrice: unit, choices: c.lines, choicesText: c.text || null, makeSeconds: makeSecondsOf(item), imageUrl: photoOf(item) } };
}

/** The order's money: subtotal, the business's sales tax on food and drink, and the total. */
export function totalsOf(tenant: any, lines: OrderLine[]): { subtotal: number; tax: number; taxLabel: string; total: number } {
  const subtotal = Math.round(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) * 100) / 100;
  const tax = posTaxAmount(tenant, { services: 0, products: subtotal });
  return { subtotal, tax, taxLabel: posTaxLabel(tenant), total: Math.round((subtotal + tax) * 100) / 100 };
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
