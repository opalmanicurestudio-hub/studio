// src/lib/ship-run.ts — SHIP TODAY, START TO FINISH: the pure parts, so the screens and the routes agree.
//   · Boxes chosen at the bench: the packer picks each box's size from the shop's packaging presets, and the labels are
//     bought for those boxes (the items' weight shared across them).
//   · The labels about to be bought: each service and how many (the standard one, or the one the customer paid for),
//     boxes, insured goods and what the insurance costs, signatures, and the total.
//   · The bench check: how many boxes have had their label scanned onto them, and which haven't.
//   · A USPS pickup: which day it's for, and whether USPS will take the booking (it needs a Priority Mail box).
//   · The day's summary when it closes: boxes, postage, insurance, signatures, carriers, and postage coming back from
//     labels nobody used.
import { labelSlots } from './label-boxes';
import { carrierName, nextShipDay, type ShipSchedule } from './ship-promise';
import { addDays, dayKey } from './tenant-time';

export type Preset = { id: string; name: string; lengthIn: number; widthIn: number; heightIn: number; weightOz: number };
/** One box as the packer chose it: its size and its own weight (the empty box). */
export type PackBox = { presetId: string | null; name: string; lengthIn: number; widthIn: number; heightIn: number; weightOz: number };
export type Parcel = { lengthIn: number; widthIn: number; heightIn: number; weightOz: number };

export const MAX_PACK_BOXES = 6;
/** The box used when the shop hasn't saved any sizes: 10 × 8 × 4 inches, 3 oz. */
export const STANDARD_BOX: PackBox = { presetId: null, name: 'Standard box', lengthIn: 10, widthIn: 8, heightIn: 4, weightOz: 3 };
/** What Shippo's own insurance costs on a domestic shipment, as a share of the value insured. */
export const SHIPPO_INSURANCE_RATE = 0.0125;

const num = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback; };

/** The shop's saved box sizes (Setup), tidied; at most eight. */
export function presetsOf(rs: any): Preset[] {
  return (Array.isArray(rs?.packagingPresets) ? rs.packagingPresets : []).slice(0, 8)
    .filter((p: any) => p && Number(p.lengthIn) > 0 && Number(p.widthIn) > 0 && Number(p.heightIn) > 0)
    .map((p: any, i: number) => ({ id: String(p.id || `p${i}`), name: String(p.name || `Box ${i + 1}`).slice(0, 40), lengthIn: num(p.lengthIn, 0.1, 200, 10), widthIn: num(p.widthIn, 0.1, 200, 8), heightIn: num(p.heightIn, 0.1, 200, 4), weightOz: num(p.weightOz, 0, 640, 3) }));
}

export const boxFrom = (p: Preset): PackBox => ({ presetId: p.id, name: p.name, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn, weightOz: p.weightOz });

/** The boxes chosen at the bench, as kept on the order; empty when none were chosen. */
export function packBoxesOf(order: any): PackBox[] {
  return (Array.isArray(order?.packBoxes) ? order.packBoxes : []).slice(0, MAX_PACK_BOXES)
    .filter((b: any) => b && Number(b.lengthIn) > 0 && Number(b.widthIn) > 0 && Number(b.heightIn) > 0)
    .map((b: any) => ({ presetId: b.presetId ? String(b.presetId) : null, name: String(b.name || 'Box').slice(0, 40), lengthIn: num(b.lengthIn, 0.1, 200, 10), widthIn: num(b.widthIn, 0.1, 200, 8), heightIn: num(b.heightIn, 0.1, 200, 4), weightOz: num(b.weightOz, 0, 640, 3) }));
}

/** What the items in an order weigh, in ounces: each item's own weight (4 oz when it has none), digital ones left out,
 *  for what's still being sent. */
export function itemsOz(order: any, weightOf: (productId: string) => number): number {
  return (Array.isArray(order?.lines) ? order.lines : []).reduce((a: number, l: any) => {
    if (l?.digital === true) return a;
    const open = Math.max(0, (Number(l?.qtyOrdered) || 0) - (Number(l?.qtyShorted) || 0));
    const per = weightOf(String(l?.productId || ''));
    return a + (per > 0 ? per : 4) * open;
  }, 0);
}

/**
 * The boxes a label is bought for: the ones chosen at the bench, otherwise the shop's first saved size (or the standard
 * box). The items' weight is shared evenly across the boxes, each box adds its own weight, and a box is never under
 * 4 oz (one box alone, never under 8, as before).
 */
export function parcelsFor(order: any, productOz: number, fallback: PackBox = STANDARD_BOX): Parcel[] {
  const boxes = packBoxesOf(order);
  const list = boxes.length ? boxes : [fallback];
  const share = Math.max(0, productOz) / list.length;
  return list.map((b) => ({ lengthIn: b.lengthIn, widthIn: b.widthIn, heightIn: b.heightIn, weightOz: Math.max(list.length > 1 ? 4 : 8, Math.ceil(share + b.weightOz)) }));
}

// ── The labels about to be bought ────────────────────────────────────────────

/** One order's label, priced but not bought. `how`: the service the customer paid for (matched), or the cheapest
 *  because they chose plain shipping (any). */
export type LabelPlan = {
  orderId: string; orderNumber?: number | null; customerName?: string; carrier: string; service: string; how: 'matched' | 'any';
  amountCents: number; insuranceFeeCents: number; insuredCents: number; signature: string; boxes: number;
};
export type LeftOut = { orderId: string; why: string };

export type PlanSummary = {
  lines: { label: string; count: number; note: string }[];
  orders: number; boxes: number; multiBox: number;
  insured: { orders: number; goodsCents: number; feeCents: number };
  signatures: number; totalCents: number;
};

export function planSummary(plans: LabelPlan[]): PlanSummary {
  const groups = new Map<string, { label: string; count: number; note: string; paid: boolean }>();
  for (const p of plans) {
    const label = `${carrierName(p.carrier) || p.carrier || 'Carrier'} ${p.service}`.trim();
    const key = `${label}|${p.how}`;
    const g = groups.get(key) || { label, count: 0, note: p.how === 'matched' ? 'they paid for it' : 'standard', paid: p.how === 'matched' };
    g.count += 1; groups.set(key, g);
  }
  const insured = plans.filter((p) => p.insuredCents > 0);
  return {
    // The standard service first, then the ones customers paid for; the biggest of each first.
    lines: [...groups.values()].sort((a, b) => Number(a.paid) - Number(b.paid) || b.count - a.count).map(({ label, count, note }) => ({ label, count, note })),
    orders: plans.length,
    boxes: plans.reduce((a, p) => a + Math.max(1, p.boxes), 0),
    multiBox: plans.filter((p) => p.boxes > 1).length,
    insured: { orders: insured.length, goodsCents: insured.reduce((a, p) => a + p.insuredCents, 0), feeCents: insured.reduce((a, p) => a + p.insuranceFeeCents, 0) },
    signatures: plans.filter((p) => p.signature && p.signature !== 'NONE').length,
    totalCents: plans.reduce((a, p) => a + p.amountCents, 0),
  };
}

// ── The bench check ──────────────────────────────────────────────────────────

const digits = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/** Every box with a label to go out, and whether its label has been scanned onto it. A box whose label was voided is
 *  left out until it has its new one; boxes riding in another order's box are that order's. */
export function benchCheck(orders: any[]): { checked: number; total: number; waiting: { order: any; box: number; of: number }[] } {
  let checked = 0; let total = 0; const waiting: { order: any; box: number; of: number }[] = [];
  for (const o of orders) {
    if (o?.labelFromOrderId || o?.shippedWithOrderId) continue;
    const all = labelSlots(o);
    const slots = all.filter((s) => !s.voided && digits(s.tracking).length >= 8);
    if (!slots.length) continue;
    const done = new Set((Array.isArray(o.labelsChecked) ? o.labelsChecked : []).map(digits));
    slots.forEach((s) => {
      total += 1;
      // One box checked before each box was ticked off on its own: the order's own stamp says so.
      const ok = done.has(digits(s.tracking)) || (slots.length === 1 && !!o.labelCheckedAt);
      // Numbered by its own place on the order, so box 2 is still box 2 when box 1 is waiting for a new label.
      if (ok) checked += 1; else waiting.push({ order: o, box: s.slot + 1, of: all.length });
    });
  }
  return { checked, total, waiting };
}

// ── Pickups ──────────────────────────────────────────────────────────────────

/** USPS only books a pickup through Shippo when at least one box is Priority Mail, Priority Mail Express, international
 *  or a return. */
export function uspsPickupAllowed(services: string[]): boolean {
  return services.some((s) => /priority|express|international|return/i.test(String(s || '')));
}

/** The day a pickup booked now is for: the next day USPS works and the shop ships, after today. */
export function pickupDay(today: string, schedule: ShipSchedule): string {
  return nextShipDay(addDays(today, 1), schedule, 'usps');
}

/** The shop's regular USPS pickup on a day (Shipping schedule), when it has one: then there's nothing to book. */
export function regularPickup(day: string, schedule: ShipSchedule): { time: string } | null {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const r = (schedule.pickups || []).find((p) => /usps/i.test(p.carrier) && p.kind !== 'dropoff' && p.days.includes(wd));
  return r ? { time: r.time } : null;
}

// ── The day, closed ──────────────────────────────────────────────────────────

export type DaySummary = {
  /** Labels bought today and still in use: one per box. */
  labels: number; postageCents: number;
  /** The goods insured on them, and what the insurance cost (as Shippo priced it; 1.25% where a label didn't say). */
  insured: { orders: number; goodsCents: number; feeCents: number };
  signatures: number;
  /** Labels by carrier, USPS first. */
  carriers: { carrier: string; boxes: number }[];
  /** Labels nobody used that the morning check voided this past week: the postage coming back (asked for, and already
   *  back), and any Shippo never confirmed, for someone to check in Shippo. */
  moneyBack: { labels: number; cents: number; backCents: number; checkCents: number };
};

/**
 * Today's labels from their records (lib/label-records): bought today in the shop's time zone and not voided since. A
 * box that had its own new label counts once, on the new label's record (its insured share with it). `voided` are
 * records voided in the last week; only the morning check's voids of labels nobody used (or of cancelled orders) count
 * as money back.
 */
export function daySummary(records: any[], voided: any[], now: number, timeZone: string): DaySummary {
  const today = dayKey(new Date(now), timeZone);
  const mine = records.filter((r) => !r?.voidedAt && r?.boughtAt && dayKey(new Date(Date.parse(String(r.boughtAt))), timeZone) === today);
  const all = (r: any) => Math.max(1, Array.isArray(r?.boxes) ? r.boxes.length : 1);
  const live = (r: any) => (Array.isArray(r?.boxes) && r.boxes.length ? r.boxes.filter((b: any) => !b?.replacedBy).length : 1);
  // The part of a record still in use: a record whose boxes all had new labels counts for nothing.
  const share = (r: any) => live(r) / all(r);
  const byCarrier = new Map<string, number>();
  for (const r of mine) { if (!live(r)) continue; const c = carrierName(r.carrier) || String(r.carrier || 'Carrier'); byCarrier.set(c, (byCarrier.get(c) || 0) + live(r)); }
  const insured = mine.filter((r) => Number(r?.protection?.insuranceCents) > 0 && live(r) > 0);
  const goods = insured.reduce((a, r) => a + Math.round((Number(r.protection.insuranceCents) || 0) * share(r)), 0);
  const fee = insured.reduce((a, r) => a + Math.round((Number(r.protection.feeCents) > 0 ? Number(r.protection.feeCents) : (Number(r.protection.insuranceCents) || 0) * SHIPPO_INSURANCE_RATE) * share(r)), 0);
  const week = now - 7 * 86400e3;
  const auto = voided.filter((r) => Date.parse(String(r?.voidedAt || '')) >= week && /never scanned|was cancelled/i.test(String(r?.voidWhy || '')));
  const asked = (r: any, statuses: string[]) => Object.values(r?.refunds || {}).filter((e: any) => statuses.includes(String(e?.status))).reduce((a: number, e: any) => a + (Number(e?.cents) || 0), 0);
  return {
    labels: mine.reduce((a, r) => a + live(r), 0),
    postageCents: mine.reduce((a, r) => a + (Number(r.amountCents) || 0), 0),
    insured: { orders: insured.length, goodsCents: goods, feeCents: fee },
    signatures: mine.filter((r) => r?.protection?.signature && r.protection.signature !== 'NONE' && live(r) > 0).length,
    carriers: [...byCarrier.entries()].map(([carrier, boxes]) => ({ carrier, boxes })).sort((a, b) => Number(b.carrier === 'USPS') - Number(a.carrier === 'USPS') || b.boxes - a.boxes),
    moneyBack: { labels: auto.length, cents: auto.reduce((a, r) => a + asked(r, ['requested', 'refunded']), 0), backCents: auto.reduce((a, r) => a + asked(r, ['refunded']), 0), checkCents: auto.reduce((a, r) => a + asked(r, ['unconfirmed']), 0) },
  };
}
