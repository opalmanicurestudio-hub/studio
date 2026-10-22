// src/lib/ship-day.ts — THE TEAM'S DAY. What the orders screen leads with, and what the alerts are worked out from:
//   · today's cutoff and the next carrier pickup
//   · what has to leave today, and how much of it is packed
//   · what's late: past the date its customer was first given, with what happened and the next step
//   · what's at risk: due today and, at the team's own pace, not going to make the last pickup
//   · parcels the carrier is having trouble with (going back to the sender, a delivery that failed, gone quiet)
// Dates come from the one shipping schedule (lib/ship-promise), on the shop's clock. Pure: no reads, no writes, so the
// screen, the alerts and the tests all say the same thing.
import { addDays, dayKey, formatShortDay, formatTime } from './tenant-time';
import { carrierName, clockLabel, cutoffFor, cutoffInfo, dayLabel, isCalendarDay, LATE_GRACE_MS, MAX_AUTO_NOTICES, missedAt, nextShipDay, pickupsOn, promiseCarrier, promisedDay, revisedShipBy, teamDay, waitingPreorder, type ShipSchedule } from './ship-promise';
import { dueAt, fulfilmentPolicy } from './retail-orders';
import { firstName, itemCount, orderNum, packQueue } from './orders-view';
import { labelDoubt } from './label-doubt';

const OPEN = ['paid', 'picking', 'packed'];
/** Minutes kept back before a pickup for the label and the hand-over. */
export const HANDOVER_MINUTES = 10;
/** Minutes an order takes to pack when there isn't enough history to tell. */
export const DEFAULT_PACK_MINUTES = 8;
/** How long after its time a running-late notice the app sends by itself is still expected (the check runs hourly). */
const AUTO_TELL_WINDOW_MS = 90 * 60_000;
/** How long before its pickup telling an at-risk order's customer a new date is offered: by then a miss is likely
 *  whatever the pace guess says. */
export const TELL_WINDOW_MS = 60 * 60_000;

/** A box the shop ships itself: not a download, and not an order riding in another order's box (that one is
 *  counted once, on the order that carries the label). */
export const shipsItself = (o: any) => o?.method === 'ship' && o.digitalOnly !== true && !o.labelFromOrderId && !o.shippedWithOrderId;

/** It has a label (bought here, or a tracking number typed in). */
export const hasLabel = (o: any) => !!(o?.trackingNumber || o?.labelUrl || o?.shippoTransactionId);
/** Waiting on stock its customer chose to wait for, or a pre-order still waiting: its date moves with the stock, so it
 *  isn't counted as due, late or missed (as the late notices don't tell its customer anything either). */
export const waitsOnStock = (o: any) => o?.holdUntilRestock === true || waitingPreorder(o);
const addressWaiting = (o: any) => ['waiting', 'approving'].includes(String(o?.addressRequest?.status || ''));

/** When the team has to have it out: its deadline (the last pickup of its ship-by day, moved by any notice). */
export function teamDue(o: any, rs: any, tz: string): number {
  return dueAt(o, fulfilmentPolicy(rs || {}, tz));
}

/** Open boxes the shop ships itself that have to leave by the end of `day`, late ones included; not ones waiting on
 *  stock, whose dates move with it. What "Ship today" counts, and the alerts. */
export function dueBy(orders: any[], day: string, rs: any, tz: string): any[] {
  return orders.filter((o) => shipsItself(o) && OPEN.includes(String(o?.stage)) && !waitsOnStock(o)
    && (() => { const t = teamDue(o, rs, tz); return Number.isFinite(t) && dayKey(new Date(t), tz) <= day; })());
}

/** The ship-by day its customer was first given (or, when they weren't shown dates, the team's own ship-by day). */
export function firstShipDay(o: any, rs: any, tz: string): string | null {
  if (isCalendarDay(o?.promise?.shipBy)) return String(o.promise.shipBy);
  const t = teamDue(o, rs, tz);
  return Number.isFinite(t) ? dayKey(new Date(t), tz) : null;
}

/** 'today', 'tomorrow', 'Friday' (this coming week), or 'Fri, Oct 30'. */
export function whenWord(day: string, today: string, tz: string): string {
  if (day === today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  if (day > today && day <= addDays(today, 6)) {
    const [y, m, d] = day.split('-').map(Number);
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }
  return dayLabel(day, tz);
}

// ── Pace ─────────────────────────────────────────────────────────────────────

export type Pace = { minutesPerOrder: number; packers: number; from: 'recent' | 'default' };

/**
 * How fast the team packs, from its own recent orders: the middle time from starting an order to packing it, over
 * the last two weeks, and how many people are packing today. Too little history (fewer than three orders) uses a
 * plain default, and says so.
 */
export function packPace(recent: any[], active: any[], now: number, tz: string): Pace {
  const today = dayKey(new Date(now), tz);
  const mins = recent
    .map((o) => (Date.parse(String(o?.packedAt || '')) - Date.parse(String(o?.claimedAt || ''))) / 60_000)
    .filter((m) => Number.isFinite(m) && m >= 0.5 && m <= 240)
    .sort((a, b) => a - b);
  const people = new Set<string>();
  for (const o of recent) if (o?.packedAt && dayKey(new Date(Date.parse(o.packedAt)), tz) === today && o.claimedBy) people.add(String(o.claimedBy));
  for (const o of active) if (o?.stage === 'picking' && o.claimedBy) people.add(String(o.claimedBy));
  const packers = Math.max(1, people.size);
  if (mins.length < 3) return { minutesPerOrder: DEFAULT_PACK_MINUTES, packers, from: 'default' };
  const mid = mins[Math.floor(mins.length / 2)];
  return { minutesPerOrder: Math.min(45, Math.max(2, Math.round(mid))), packers, from: 'recent' };
}

// ── Late ─────────────────────────────────────────────────────────────────────

export type StepKind = 'pack' | 'open' | 'label' | 'tell';
export type Step = { kind: StepKind; label: string; day?: string };
export type LateItem = {
  order: any;
  /** The ship-by day its customer was first given. */
  first: string;
  /** The date they know now, when a notice moved it. */
  told: { day: string; at: string | null } | null;
  /** That date still stands (it hasn't gone by too). */
  toldStands: boolean;
  /** They were given a date at all (shown at checkout, or told by a notice). */
  shown: boolean;
  /** When they're told the new date by themselves (lib/late-notices: an hour after the date they know has gone by,
   *  unless the box is labeled first), and the date they'll be given. Null when nothing goes by itself: an order held
   *  for review, one that has had its two automatic notices, a date not yet gone by, or a notice that should have gone
   *  well before now and didn't. */
  autoTell: { at: string; day: string } | null;
  /** What happened, in a sentence. */
  what: string;
  steps: Step[];
};

/**
 * An order past the ship-by day its customer was first given, still not out: what happened, whether they've been
 * told a new date, and the next step. Missed at that day's last pickup (or the end of the shop's shipping day), never
 * before the team's own deadline for it. Not an order waiting on stock the customer chose to wait for, or a pre-order
 * still waiting (those dates move with the stock, as the late notices do). Not a labeled box either: it's on its way
 * out, or, when nobody has scanned it for days, the morning label check asks about it (under Labels); no
 * running-late notice goes for one.
 */
export function lateItem(o: any, now: number, tz: string, schedule: ShipSchedule, rs: any): LateItem | null {
  if (!shipsItself(o) || !OPEN.includes(String(o?.stage))) return null;
  if (waitsOnStock(o) || hasLabel(o)) return null;
  const first = firstShipDay(o, rs, tz);
  if (!first) return null;
  const carrier = promiseCarrier(o);
  const ownDeadline = first === o.promise?.shipBy ? Date.parse(String(o.promise?.shipByAt || '')) || 0 : 0;
  if (now < Math.max(Date.parse(missedAt(first, tz, schedule, carrier)), ownDeadline)) return null;

  const today = dayKey(new Date(now), tz);
  const who = firstName(o.customerName);
  const shown = o.promise?.shown === true || !!o.notifiedForPromiseAt;
  const current = shown ? promisedDay(o, tz) : null;
  const told = o.notifiedForPromiseAt && current && current > first ? { day: current, at: o.delayNoticeAt ? String(o.delayNoticeAt) : null } : null;
  // The soonest it can honestly go: today while today's last pickup is ahead, otherwise the next day the carrier collects.
  const soonest = revisedShipBy(first, new Date(now), tz, schedule, carrier);
  const st = String(o.stage);
  let what = ''; const steps: Step[] = [];
  if (o.holdForReview === true) { what = 'Held for review, so it can’t be packed yet.'; steps.push({ kind: 'open', label: 'Review it' }); }
  else if (addressWaiting(o)) { what = `${who} asked to change the address.`; steps.push({ kind: 'open', label: 'Answer it' }); }
  else if (st === 'paid') {
    const came = Date.parse(String(o.releasedAt || ''));
    what = Number.isFinite(came) ? `Its stock came in ${pastWord(dayKey(new Date(came), tz), today, tz)}. It hasn’t been started.` : 'It hasn’t been started.';
    steps.push({ kind: 'pack', label: 'Pack it now' });
  }
  else if (st === 'picking') { what = `${o.claimedByName ? `${firstName(o.claimedByName)} is` : 'Someone is'} packing it.`; steps.push({ kind: 'open', label: 'Open it' }); }
  else { what = 'Packed, but it has no label yet.'; steps.push({ kind: 'label', label: 'Buy the label' }); }

  // Told by itself an hour after the date they know has gone by, unless the box is labeled first (lib/late-notices,
  // checked every hour). Once that's well past and they still haven't been told, it didn't go, so a person should.
  let autoTell: LateItem['autoTell'] = null;
  if (shown && o.promise && current && o.holdForReview !== true && (Number(o.autoDelayNotices) || 0) < MAX_AUTO_NOTICES) {
    const gone = Math.max(Date.parse(missedAt(current, tz, schedule, carrier)), current === o.promise.shipBy ? Date.parse(String(o.promise.shipByAt || '')) || 0 : 0);
    const at = gone + LATE_GRACE_MS;
    if (now >= gone && now < at + AUTO_TELL_WINDOW_MS) autoTell = { at: new Date(at).toISOString(), day: revisedShipBy(current, new Date(Math.max(now, at)), tz, schedule, carrier) };
  }
  // A date to give them: only to a customer who was given one, and only when the one they know has gone by. It comes
  // first when nobody else will tell them, after the work when they're told by themselves.
  const stands = !!current && current >= soonest;
  if (shown && !stands) {
    const tell: Step = { kind: 'tell', label: `Tell ${who} it ships ${whenWord(soonest, today, tz)}`, day: soonest };
    if (autoTell) steps.push(tell); else steps.unshift(tell);
  }
  return { order: o, first, told, toldStands: !!told && stands, shown, autoTell, what, steps };
}

/** 'today', 'yesterday', 'Tuesday' (the past week), or 'Tue, Oct 20'. */
export function pastWord(day: string, today: string, tz: string): string {
  if (day === today) return 'today';
  if (day === addDays(today, -1)) return 'yesterday';
  if (day < today && day >= addDays(today, -6)) {
    const [y, m, d] = day.split('-').map(Number);
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }
  return dayLabel(day, tz);
}

// ── At risk ──────────────────────────────────────────────────────────────────

export type RiskWhy = 'not_started' | 'packing' | 'address' | 'held';
export type RiskItem = {
  order: any; why: RiskWhy; status: string; detail: string;
  /** The next day it could honestly ship, and from when telling its customer that is offered (an hour before its
   *  pickup). Only a customer who was given a date (`shown`) is told anything. */
  tellDay: string; tellFrom: string; shown: boolean;
};

const STATUS: Record<RiskWhy, string> = { not_started: 'Not started', packing: 'Being packed', address: 'Needs you', held: 'Held' };

/**
 * Orders due out today that won't make it at the team's pace. The work is counted in the order the pack queue takes it
 * (lib/orders-view packQueue: anything moved to the front, then late ones, then soonest due, pickups included): each
 * order still to pack adds its share (one already being packed counts as half done), and an order due today that
 * would finish after its own last pickup (less the hand-over time) is at risk. One that can't move without someone
 * (held for review, an address change waiting) is at risk however much time is left. Not one waiting on stock: its
 * date moves with the stock (Needs you lists it). Late ones are on the Late list instead.
 */
export function atRiskItems(orders: any[], now: number, tz: string, schedule: ShipSchedule, rs: any, pace: Pace): RiskItem[] {
  const today = dayKey(new Date(now), tz);
  const dueToday = (o: any) => shipsItself(o) && ['paid', 'picking'].includes(String(o.stage)) && !waitsOnStock(o)
    && (() => { const t = teamDue(o, rs, tz); return Number.isFinite(t) && dayKey(new Date(t), tz) === today; })() && !lateItem(o, now, tz, schedule, rs);
  const facts = (o: any) => {
    const carrier = promiseCarrier(o);
    const missAt = Date.parse(missedAt(today, tz, schedule, carrier));
    return { tellDay: revisedShipBy(today, new Date(now), tz, schedule, carrier), tellFrom: new Date(missAt - TELL_WINDOW_MS).toISOString(), shown: o.promise?.shown === true || !!o.notifiedForPromiseAt, missAt };
  };
  const blocked = (o: any): RiskWhy | null => (o.holdForReview === true ? 'held' : addressWaiting(o) ? 'address' : null);
  const out: RiskItem[] = [];
  // Waiting on someone first: held ones aren't in the pack queue at all, and an address change stops the box going.
  const waiting = orders.filter((o) => dueToday(o) && blocked(o)).sort((a, b) => teamDue(a, rs, tz) - teamDue(b, rs, tz));
  for (const o of waiting) { const f = facts(o); const why = blocked(o)!; out.push({ order: o, why, status: STATUS[why], detail: why === 'held' ? 'Held for review' : 'Address change waiting', tellDay: f.tellDay, tellFrom: f.tellFrom, shown: f.shown }); }
  const per = pace.minutesPerOrder / Math.max(1, pace.packers);
  let work = 0;
  for (const o of packQueue(orders, rs, now, tz)) {
    if (!['paid', 'picking'].includes(String(o.stage)) || blocked(o) || waitsOnStock(o)) continue;
    work += o.stage === 'picking' ? per / 2 : per;
    if (!dueToday(o)) continue;
    const f = facts(o);
    if (now + (work + HANDOVER_MINUTES) * 60_000 <= f.missAt) continue;
    const why: RiskWhy = o.stage === 'picking' ? 'packing' : 'not_started';
    const items = itemCount(o);
    const paid = Date.parse(String(o.paidAt || ''));
    const detail = why === 'packing'
      ? `${o.claimedByName ? `${firstName(o.claimedByName)} is` : 'Someone is'} packing it`
      : `${items} item${items === 1 ? '' : 's'}${Number.isFinite(paid) ? ` · paid ${dayKey(new Date(paid), tz) === today ? 'today' : dayKey(new Date(paid), tz) === addDays(today, -1) ? 'yesterday' : formatShortDay(new Date(paid), tz)} ${formatTime(new Date(paid), tz)}` : ''}`;
    out.push({ order: o, why, status: STATUS[why], detail, tellDay: f.tellDay, tellFrom: f.tellFrom, shown: f.shown });
  }
  return out;
}

/** The at-risk customers "Tell them now" can tell right now: given a date, and within the hour before their pickup. */
export function tellableNow(items: RiskItem[], now: number): RiskItem[] {
  return items.filter((i) => i.shown && now >= Date.parse(i.tellFrom));
}

// ── Carrier problems ─────────────────────────────────────────────────────────

export type CarrierItem = { order: any; kind: 'returned' | 'failed' | 'stalled'; title: string; detail: string; key: string };

/**
 * A parcel the carrier is having trouble with, as the shipping webhook and the nightly check flag it (carrierIssue):
 * going back to the sender, a delivery that failed, or no scan for days. Gone once someone has seen it, once the parcel
 * is delivered, and while the team waits on it (snoozeUntil, "Wait 3 more days"). Counted once per box: an order riding
 * in another order's box is left to that order.
 */
export function carrierItem(o: any, tz: string, now = Date.now()): CarrierItem | null {
  const ci = o?.carrierIssue;
  if (!ci || ci.open !== true || o.shippedWithOrderId || o.labelFromOrderId) return null;
  // "Wait 3 more days" is for a parcel gone quiet: a new problem (going back, a failed delivery) shows straight away.
  if (ci.status === 'STALLED' && Date.parse(String(ci.snoozeUntil || '')) > now) return null;
  const who = firstName(o.customerName);
  const num = orderNum(o);
  const carrier = carrierName(o.carrier || ci.carrier) || 'The carrier';
  const detail = String(ci.detail || '').trim().replace(/\.$/, '');
  if (ci.status === 'RETURNED') return { order: o, kind: 'returned', key: String(ci.key || ''), title: `${num} is going back to the sender`,
    detail: `${carrier}${detail ? `: ${detail.charAt(0).toLowerCase()}${detail.slice(1)}` : ' is returning it'}. Message ${who} about a new one or a refund.` };
  if (ci.status === 'STALLED') {
    const last = Date.parse(String(ci.at || ''));
    const day = Number.isFinite(last) ? formatShortDay(new Date(last), tz) : '';
    const n = Math.max(1, Number(ci.quietDays) || 0);
    const told = ci.customerTold === true ? `${who} knows it’s running late. ` : ci.customerTold === false ? `${who} hasn’t been told. ` : '';
    return ci.unscanned === true
      ? { order: o, kind: 'stalled', key: String(ci.key || ''), title: `${num} hasn’t been scanned in ${n} days`,
        detail: `${day ? `Marked shipped ${day}, and ` : ''}${carrier} hasn’t scanned it${day ? ' since' : ''}. ${told}Check the tracking number, or open a trace with ${carrier}.` }
      : { order: o, kind: 'stalled', key: String(ci.key || ''), title: `${num} hasn’t moved in ${n} days`,
        detail: `${day ? `${carrier} last scanned it ${day}. ` : ''}${told}Open a trace with ${carrier}.` };
  }
  return { order: o, kind: 'failed', key: String(ci.key || ''), title: `${carrier} couldn’t deliver ${num}`,
    detail: `${detail ? `${detail}. ` : ''}Message ${who} to check the address.` };
}

// ── The day ──────────────────────────────────────────────────────────────────

export type DayPicture = {
  today: string;
  /** The shop has saved its shipping schedule; until then there's no cutoff or pickup to show. */
  scheduled: boolean;
  /** The shop works on orders today: a ship day, not closed, and not a holiday for every carrier it uses. */
  shipsToday: boolean;
  cutoff: { label: string; at: string | null; minutesLeft: number | null };
  /** The next pickup (or drop-off) today; null when none is listed or the last has gone. */
  pickup: { carrier: string; kind: 'pickup' | 'dropoff'; label: string; at: string } | null;
  /** Today's pickups are listed and the last one has gone. */
  pickupsDone: boolean;
  /** The last pickup listed today: what "at risk" is measured against for most orders. */
  lastPickup: { carrier: string; label: string } | null;
  /** Has to leave today (late ones included), how many are packed, how many to go, and how many went today. On a day
   *  the shop doesn't ship, what has to leave on its next ship day (`shipDay`). */
  ship: { total: number; packed: number; toGo: number; sent: number };
  shipDay: string;
  late: LateItem[];
  atRisk: RiskItem[];
  carrier: CarrierItem[];
  pace: Pace;
};

export function dayPicture(input: {
  orders: any[]; flagged?: any[]; recentPacked?: any[]; sentToday?: number; rs: any; schedule: ShipSchedule; now: number; timeZone: string;
}): DayPicture {
  const { orders, rs, schedule, now } = input;
  const tz = input.timeZone;
  const today = dayKey(new Date(now), tz);
  const scheduled = !!schedule.savedAt;
  // A holiday only USPS keeps doesn't stop a shop that also ships with a carrier working that day.
  const td = scheduled ? teamDay(today, schedule, orders.filter(shipsItself).map(promiseCarrier)) : { ships: true, carrier: null };
  const ci = cutoffInfo(new Date(now), tz, schedule, td.carrier);
  const pickups = pickupsOn(today, tz, schedule);
  const next = pickups.find((p) => Date.parse(p.at) > now) || null;
  const pace = packPace(input.recentPacked || [], orders, now, tz);

  const shipDay = td.ships ? today : nextShipDay(today, schedule);
  const mustGo = dueBy(orders, shipDay, rs, tz);
  const packed = mustGo.filter((o) => o.stage === 'packed').length;
  const sent = td.ships ? Math.max(0, Math.floor(Number(input.sentToday) || 0)) : 0;
  const late = orders.map((o) => lateItem(o, now, tz, schedule, rs)).filter(Boolean) as LateItem[];
  late.sort((a, b) => a.first.localeCompare(b.first) || String(a.order.paidAt || '').localeCompare(String(b.order.paidAt || '')));
  const seen = new Map<string, any>();
  for (const o of [...(input.flagged || []), ...orders]) seen.set(o.id, o);
  const carrier = [...seen.values()].map((o) => carrierItem(o, tz, now)).filter(Boolean) as CarrierItem[];

  return {
    today,
    scheduled,
    shipsToday: td.ships,
    cutoff: { label: clockLabel(cutoffFor(today, schedule)), at: ci.cutoffAt, minutesLeft: ci.minutesLeft },
    pickup: next ? { carrier: next.carrier, kind: next.kind, label: clockLabel(next.time), at: next.at } : null,
    pickupsDone: pickups.length > 0 && !next,
    lastPickup: pickups.length ? { carrier: pickups[pickups.length - 1].carrier, label: clockLabel(pickups[pickups.length - 1].time) } : null,
    ship: { total: mustGo.length + sent, packed, toGo: mustGo.length - packed, sent },
    shipDay,
    late,
    atRisk: atRiskItems(orders, now, tz, schedule, rs, pace),
    carrier,
    pace,
  };
}

/** Orders with a label problem that needs a person: a box waiting for its new label, a void that didn't finish, a label
 *  nobody has used, a refund Shippo turned down (lib/label-doubt, lib/label-records). The Labels count on Today. */
export function labelWork(orders: any[]): number {
  const seen = new Set<string>();
  let n = 0;
  for (const o of orders) {
    if (!o?.id || seen.has(o.id)) continue;
    seen.add(o.id);
    const d = labelDoubt(o);
    const relabel = d === 'relabel' && ['paid', 'picking', 'packed', 'shipped'].includes(String(o.stage));
    const stuck = d === 'voiding' || d === 'partial' || d === 'unfinished' || (o.labelUnscannedOpen === true && o.labelUnscanned?.why === 'void_unfinished');
    const unused = o.labelUnscannedOpen === true && !!o.shippoTransactionId;
    if (relabel || stuck || unused || o.labelRefundDenied?.open === true) n++;
  }
  return n;
}

/** The one date "Tell them now" gives, when every customer it would tell gets the same one; else null. */
export function sharedTellDay(items: { tellDay?: string; day?: string }[]): string | null {
  const days = [...new Set(items.map((i) => i.tellDay || i.day).filter(Boolean) as string[])];
  return days.length === 1 ? days[0] : null;
}
