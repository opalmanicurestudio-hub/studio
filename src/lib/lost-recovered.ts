// src/lib/lost-recovered.ts — LOST AND RECOVERED. Pure, so the screens and the server say the same thing.
// A parcel lost, stolen from the porch or damaged is a loss record (lib/exception-doc) that may be money someone else
// owes the shop. Here:
//   · who covers it: Shippo's insurance when the label was insured (it covers porch theft too), otherwise the carrier's
//     own included cover (USPS, UPS and FedEx include up to $100; it doesn't cover a box marked delivered)
//   · the date to file by: Shippo's insurer wants a "delivered but never arrived" claim within 15 days of the delivery
//     scan and a lost one within 60 days of shipping; a carrier claim follows the carrier's window (lib/exception-doc)
//   · the claim's story, from reported to paid, and the details to paste into a claim form
//   · the month: lost, recovered, net, where it went, and one change worth making
import { claimWindowFor, suggestedDeadline } from './exception-doc';
import { carrierName } from './ship-promise';
import { SHIPPO_INSURANCE_RATE } from './ship-run';

const DAY = 86400e3;
/** Where Shippo's shipments are listed; a shipment's sidebar has "File a claim" for an insured one. */
export const SHIPPO_SHIPMENTS_URL = 'https://goshippo.com/user/shipments/';
/** The insurer behind Shippo's insurance: a "delivered but never arrived" claim within 15 days of the delivery scan,
 *  a lost one within 60 days of shipping. */
export const INSURED_DELIVERED_DAYS = 15;
export const INSURED_LOST_DAYS = 60;
/** What USPS, UPS and FedEx include with most services. */
export const CARRIER_INCLUDED_CENTS = 10000;

const ms = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const iso = (t: number) => new Date(t).toISOString();
const money = (c: number) => `$${(Math.round(Number(c) || 0) / 100).toFixed(2)}`;
const whole = (c: number) => (Math.round(c) % 100 === 0 ? `$${Math.round(c) / 100}` : money(c));
const first = (n: unknown) => String(n || '').trim().split(/\s+/)[0] || 'The customer';
const num = (o: any, exc: any) => `#${String(o?.orderNumber ?? exc?.orderNumber ?? '').padStart(4, '0')}`;

/** A loss recovery could come from: a carrier or Shippo, not the customer or the shop's own packing. */
export const RECOVERABLE = new Set(['carrier_lost', 'carrier_damaged', 'carrier_destroyed', 'stolen_after_delivery']);

export type Cover = {
  by: 'shippo' | 'carrier'; who: string;
  /** 'Insured with Shippo', or 'USPS’s included cover'. */
  line: string;
  /** What the claim can be for: the insured amount, or the carrier's included cover (up to $100). */
  amountCents: number; upTo: boolean;
  /** Whether it pays when the carrier marked it delivered and it's gone from the porch. */
  theft: boolean;
  portalUrl: string; portalLabel: string;
};

/** Who covers a loss. */
export function coverFor(exc: any, order?: any): Cover {
  const insured = Number(exc?.insuredCents ?? order?.shipmentProtection?.insuranceCents) || 0;
  const carrier = carrierName(exc?.carrier || order?.carrier) || 'The carrier';
  if (insured > 0) return { by: 'shippo', who: 'Shippo', line: 'Insured with Shippo', amountCents: insured, upTo: false, theft: true, portalUrl: SHIPPO_SHIPMENTS_URL, portalLabel: 'Open the claim in Shippo' };
  const w = claimWindowFor(exc?.carrier || order?.carrier);
  const value = Math.max(Number(exc?.retailCents) || 0, Number(exc?.landedCostCents) || 0);
  return { by: 'carrier', who: carrier, line: `${carrier}’s included cover`, amountCents: value ? Math.min(CARRIER_INCLUDED_CENTS, value) : CARRIER_INCLUDED_CENTS, upTo: true, theft: false,
    portalUrl: w.url, portalLabel: `Open the claim with ${carrier}` };
}

/** Whether the carrier delivered it (so the claim is "delivered, but it isn't there"). */
const deliveredAtOf = (exc: any, order?: any): number => {
  const d = ms(order?.deliveredAt || exc?.deliveredAt);
  return Number.isFinite(d) ? d : NaN;
};

/** The day to file by, or null when the ship date isn't known (a guessed deadline is worse than none). */
export function fileBy(exc: any, order?: any): string | null {
  const cover = coverFor(exc, order);
  const shipped = ms(exc?.shippedAt || order?.completedAt || order?.shippedAt);
  if (cover.by === 'shippo') {
    const delivered = deliveredAtOf(exc, order);
    if (Number.isFinite(delivered) && exc?.reason !== 'carrier_lost') return iso(delivered + INSURED_DELIVERED_DAYS * DAY);
    return Number.isFinite(shipped) ? iso(shipped + INSURED_LOST_DAYS * DAY) : null;
  }
  return Number.isFinite(shipped) ? suggestedDeadline(iso(shipped), exc?.carrier || order?.carrier) : null;
}

export type ClaimStage = 'to_file' | 'filed' | 'approved' | 'paid' | 'denied' | 'closed';
export function claimStage(exc: any): ClaimStage {
  const s = String(exc?.recovery?.status || '');
  return s === 'candidate' ? 'to_file' : s === 'filed' ? 'filed' : s === 'approved' ? 'approved' : s === 'paid' ? 'paid' : s === 'denied' ? 'denied' : 'closed';
}
export const isOpenClaim = (exc: any) => ['to_file', 'filed', 'approved'].includes(claimStage(exc));

/** What happened, in a few words: "Dana reported it missing", "It stopped moving, and a replacement went out". */
export function whatHappened(exc: any, order?: any): string {
  const who = first(order?.customerName);
  const r = String(exc?.reason || '');
  if (exc?.source === 'carrier_watch') return exc?.replacementOrderId ? 'It stopped moving, and a replacement went out' : 'It stopped moving';
  if (r === 'stolen_after_delivery') return `Delivered, but ${who} says it never arrived`;
  if (r === 'carrier_damaged') return `${who} reported it damaged`;
  if (r === 'carrier_destroyed') return 'The carrier destroyed it';
  return `${who} reported it missing`;
}

export type Due = 'ok' | 'soon' | 'overdue' | 'none';
export function dueState(by: string | null, now = Date.now()): Due {
  const t = ms(by);
  if (!Number.isFinite(t)) return 'none';
  if (t < now) return 'overdue';
  return t - now < 7 * DAY ? 'soon' : 'ok';
}

export type ClaimToFile = { exc: any; order: any | null; by: string | null; due: Due; title: string; detail: string };

/**
 * Claims to file, for Needs you: the next file-by date first, any due in the next week (or past it) on top. `day`
 * formats a date the shop's way ('Nov 20').
 */
export function claimsToFile(rows: any[], ordersById: Map<string, any>, day: (iso: string) => string, now = Date.now()): ClaimToFile[] {
  return rows.filter((r) => claimStage(r) === 'to_file' && RECOVERABLE.has(String(r.reason)))
    .map((exc) => {
      const order = exc.orderId ? ordersById.get(String(exc.orderId)) || null : null;
      const by = fileBy(exc, order);
      const cover = coverFor(exc, order);
      return {
        exc, order, by, due: dueState(by, now),
        title: `File the claim for ${num(order, exc)}${by ? ` by ${day(by)}` : ''}`,
        detail: `${whatHappened(exc, order)}. ${cover.by === 'shippo' ? `Insured with Shippo for ${whole(cover.amountCents)}.` : `${cover.who}’s included cover, up to ${whole(cover.amountCents)}.`}`,
      };
    })
    .sort((a, b) => Number(['soon', 'overdue'].includes(b.due)) - Number(['soon', 'overdue'].includes(a.due)) || (ms(a.by) || Infinity) - (ms(b.by) || Infinity));
}

export type TimelineStep = { text: string; sub: string; done: boolean; good?: boolean };

/** The claim's story, from reported to paid. `day` formats a date ('Oct 28'). */
export function claimTimeline(exc: any, order: any | null, day: (iso: string) => string): TimelineStep[] {
  const out: TimelineStep[] = [];
  const at = String(exc?.at || '');
  const who = first(order?.customerName);
  const r = String(exc?.reason || '');
  out.push({ text: exc?.source === 'carrier_watch' ? 'Stopped moving' : r === 'carrier_damaged' ? `Reported damaged by ${who}` : r === 'stolen_after_delivery' ? `Reported missing by ${who}, after delivery` : `Reported missing by ${who}`, sub: at ? day(at) : '', done: true });
  if (exc?.replacementOrderId) out.push({ text: 'Replacement sent', sub: `${at ? `${day(at)} · ` : ''}cost you ${money(Number(exc.costed ? exc.landedCostCents : exc.retailCents) || 0)}`, done: true });
  const rec = exc?.recovery || {};
  const events: any[] = Array.isArray(rec.events) ? rec.events : [];
  for (const e of events) {
    if (e.action === 'file') out.push({ text: `Claim filed${e.refNumber ? ` · ${e.refNumber}` : ''}`, sub: day(e.at), done: true });
    else if (e.action === 'approve') out.push({ text: 'Approved', sub: day(e.at), done: true, good: true });
    else if (e.action === 'deny') out.push({ text: 'Turned down', sub: `${day(e.at)}${e.note ? ` · ${e.note}` : ''}`, done: true });
    else if (e.action === 'abandon') out.push({ text: 'Closed without a claim', sub: `${day(e.at)}${e.note ? ` · ${e.note}` : ''}`, done: true });
    else if (e.action === 'payment') out.push({ text: `Paid ${money(e.amountCents)}`, sub: `${day(e.at)} · recorded in Money`, done: true, good: true });
  }
  return out;
}

/** The details a claim form asks for, to paste in. */
export function claimDetails(exc: any, order: any | null, day: (iso: string) => string): string {
  const cover = coverFor(exc, order);
  const a = order?.shippingAddress || {};
  const lines = [
    `Order ${num(order, exc)}`,
    order?.trackingNumber || exc?.trackingNumber ? `Tracking: ${order?.trackingNumber || exc?.trackingNumber}${order?.carrier || exc?.carrier ? ` (${carrierName(order?.carrier || exc?.carrier)})` : ''}` : '',
    exc?.shippedAt || order?.completedAt ? `Shipped: ${day(String(exc?.shippedAt || order?.completedAt))}` : '',
    order?.deliveredAt ? `Delivered: ${day(String(order.deliveredAt))}` : '',
    `What happened: ${whatHappened(exc, order)}.`,
    cover.by === 'shippo' ? `Insured value: ${money(cover.amountCents)}` : `Value of the goods: ${money(Math.max(Number(exc?.retailCents) || 0, Number(exc?.landedCostCents) || 0))}`,
    order?.customerName ? `Shipped to: ${order.customerName}${[a.line1, a.city, a.state, a.postalCode || a.zip].filter(Boolean).length ? `, ${[a.line1, a.city, a.state, a.postalCode || a.zip].filter(Boolean).join(', ')}` : ''}` : '',
    exc?.note ? `Customer’s words: “${String(exc.note).slice(0, 400)}”` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

// ── The month ────────────────────────────────────────────────────────────────

/** Where a loss came from, in the shop's words. */
export function lossKind(reason: string): string {
  const r = String(reason || '');
  if (['carrier_lost', 'carrier_destroyed', 'delivery_exception', 'tracking_discrepancy', 'carrier_returned'].includes(r)) return 'Lost in transit';
  if (r === 'stolen_after_delivery') return 'Delivered, but missing';
  if (['carrier_damaged', 'reported_damaged', 'reported_leaking', 'packaging_failure'].includes(r)) return 'Damaged';
  if (['wrong_item_shipped', 'wrong_quantity', 'reported_missing', 'picking_damage', 'packing_damage'].includes(r)) return 'Packing mistakes';
  if (r.startsWith('return_') || ['refused_delivery', 'refund_without_return'].includes(r)) return 'Returns';
  return 'Other';
}

/** A loss in money: what it cost the shop, or what it sold for when the item has no cost set. */
export const lossOf = (r: any) => (r?.costed ? Number(r.landedCostCents) || 0 : Number(r?.retailCents) || Number(r?.landedCostCents) || 0);

export type MonthLoss = {
  lostCents: number; recoveredCents: number; netCents: number;
  openClaims: number; dueSoon: number; unusedRefundedCents: number;
  where: { kind: string; cents: number; pct: number; mistake: boolean }[];
  uncosted: number;
  worth: string[];
};

/**
 * One month (`month`, 'YYYY-MM' in the shop's zone; `monthOf` turns a time into that key). Losses are the order's ones
 * recorded that month; recovered is money that came back that month, whatever month the loss was in. `shippedValues`:
 * the goods value of each order shipped that month, so the cost of insuring more can be worked out.
 */
export function monthLoss(rows: any[], month: string, opts: {
  monthOf: (iso: string) => string; now?: number; unusedRefundedCents?: number; shippedValues?: number[];
  insuranceOn?: boolean; insureOverCents?: number; requireScan?: boolean; ordersById?: Map<string, any>;
}): MonthLoss {
  const now = opts.now ?? Date.now();
  const mine = rows.filter((r) => r?.orderId && opts.monthOf(String(r.at || '')) === month);
  const lostCents = mine.reduce((a, r) => a + lossOf(r), 0);
  const recoveredCents = rows.reduce((a, r) => a + (Array.isArray(r?.recovery?.events) ? r.recovery.events : [])
    .filter((e: any) => e?.action === 'payment' && opts.monthOf(String(e.at || '')) === month)
    .reduce((s: number, e: any) => s + (Number(e.amountCents) || 0), 0), 0);
  const open = rows.filter((r) => isOpenClaim(r) && RECOVERABLE.has(String(r.reason)));
  const dueSoon = open.filter((r) => claimStage(r) === 'to_file' && ['soon', 'overdue'].includes(dueState(fileBy(r, opts.ordersById?.get(String(r.orderId))), now))).length;
  const byKind = new Map<string, number>();
  for (const r of mine) byKind.set(lossKind(r.reason), (byKind.get(lossKind(r.reason)) || 0) + lossOf(r));
  const top = Math.max(1, ...byKind.values());
  const where = [...byKind.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])
    .map(([kind, cents]) => ({ kind, cents, pct: Math.round((cents / top) * 100), mistake: kind === 'Packing mistakes' }));

  // One or two changes worth making, each from this month's own numbers.
  const worth: string[] = [];
  const uninsured = mine.filter((r) => RECOVERABLE.has(String(r.reason)) && Number(r.insuredCents) === 0);
  if (uninsured.length) {
    const cents = uninsured.reduce((a, r) => a + lossOf(r), 0);
    const smallest = Math.min(...uninsured.map((r) => Math.max(Number(r.retailCents) || 0, lossOf(r))));
    const over = Math.max(2500, Math.floor(smallest / 2500) * 2500);
    const ceiling = opts.insuranceOn ? Math.max(over, Number(opts.insureOverCents) || 0) : Infinity;
    const values = (opts.shippedValues || []).filter((v) => v >= over && v < ceiling);
    const cost = Math.round(values.reduce((a, v) => a + v, 0) * SHIPPO_INSURANCE_RATE);
    const n = uninsured.length;
    worth.push(`${n} ${n === 1 ? 'loss' : 'losses'} this month ${n === 1 ? 'wasn’t' : 'weren’t'} insured (${whole(cents)}).${values.length ? ` Insuring orders over ${whole(over)} would have cost about ${whole(Math.max(100, cost))}.` : ''}`);
  }
  const mistakes = mine.filter((r) => lossKind(r.reason) === 'Packing mistakes');
  if (mistakes.length >= 2 && !opts.requireScan) worth.push(`${mistakes.length} packing mistakes this month (${whole(mistakes.reduce((a, r) => a + lossOf(r), 0))}). Scanning each item at the bench catches most of them.`);
  const lapsed = rows.filter((r) => claimStage(r) === 'to_file' && RECOVERABLE.has(String(r.reason)) && dueState(fileBy(r, opts.ordersById?.get(String(r.orderId))), now) === 'overdue');
  if (lapsed.length) worth.push(`${lapsed.length} ${lapsed.length === 1 ? 'claim is' : 'claims are'} past the date to file by (${whole(lapsed.reduce((a, r) => a + lossOf(r), 0))}). File today, or close ${lapsed.length === 1 ? 'it' : 'them'}.`);

  return {
    lostCents, recoveredCents, netCents: lostCents - recoveredCents, openClaims: open.length, dueSoon,
    unusedRefundedCents: Math.max(0, Number(opts.unusedRefundedCents) || 0), where,
    uncosted: mine.filter((r) => r.costed === false).length, worth: worth.slice(0, 2),
  };
}
