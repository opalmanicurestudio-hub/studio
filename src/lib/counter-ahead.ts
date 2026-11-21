// src/lib/counter-ahead.ts — ORDERING AHEAD (server; the guest's own menu page through api/counter/ahead, the lane's
// "Ordered ahead" in api/counter, the payment notice in lib/connect-webhook and the payments sweep in lib/counter-card).
// The guest picks from the menu on their phone (photos, choices, prices from the menu itself, never the page), says how
// they'll pick it up (the drive-thru, or inside) and when (as soon as it's ready, or a time today), and pays right then:
// nothing is made for an order that isn't paid. Paid, it goes to the kitchen like any other order: for a later time the
// tickets wait under Later until it's time to start, or until the guest taps I'm here. The guest gets the order number
// and a 4-digit pickup code (said at the speaker or the counter, so the right bag goes to the right person) on a page
// that shows how it's going.
//   tenants/{t}/counterOrders/{id}.ahead = { state: 'awaiting_pay' | 'paid' | 'canceled' | 'abandoned', way: 'drive-thru' |
//     'inside', at (wanted time, null: as soon as it's ready), code, payId, cents, hereAt?, carId?, failed? }
//   tenants/{t}/aheadCodes/{day}_{code} = { orderId }   (one code, one order, per day)
// An order's link is signed for that order (lib: aheadSig), like scan to pay's.
import { createHash, createHmac, randomInt, timingSafeEqual } from 'crypto';
import { accountOf, readerStripe } from '@/lib/reader-sale';
import { lineFor, totalsOf, orderNumber, photoOf, carryOn, type OrderLine } from '@/lib/counter-orders';
import { readMenu, type MenuItem } from '@/lib/menu-server';
import { sendOrder, payOrder, cleanName } from '@/lib/counter-server';
import { giveBack } from '@/lib/counter-card';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { loyaltyOf } from '@/lib/loyalty';
import { pickupDelayMin } from '@/lib/kitchen-pace';
import { paceNow } from '@/lib/kitchen-pace-server';
import { klairSettings } from '@/lib/klair';
import { asapSlot, cleanSlotItems, fits, fullTimes, itemCount, itemsBySlot, slotCap, type PaceLevel } from '@/lib/ahead-slots';
import { menuAnswersOn } from '@/lib/klair-menu';
import { cleanPicks } from '@/lib/menu-choices';
import { pickupGeoOf } from '@/lib/pickup-geo';
import { offerOf } from '@/lib/menu-upgrades';
import { asapOpen, houseWeek, hoursNow, insideHours, type HoursNow } from '@/lib/ahead-hours';
import { lastFour, readyTextView, readyTextsOn } from '@/lib/ready-text';
import { toE164 } from '@/lib/sms';
import { picksOf } from '@/lib/menu-choices';
import { failedView } from '@/lib/food-delivery-settle-server';
import { posTaxAmount } from '@/lib/pos-tax';
import { foodDeliveryOf, driveMinutes, cleanAddress, cleanNote, withDeliveryFee, arrivalTimes, addressLine, deliveryStep, tipCentsOf, etaOf, type FoodAddress } from '@/lib/food-delivery';
import { cleanLineNote, cleanOrderAllergy, orderAllergyOf, allergyWords, mergeAllergy, sameAllergy } from '@/lib/order-allergy';
import { deliveryNowOf, drivableTimes } from '@/lib/driver-load';
import { driverLoad, forgetDriverLoad } from '@/lib/driver-load-server';
import { deliveryFrom } from '@/lib/delivery-plan';
import { anotherDayOf, cancelBy, cleanPeople, dayChoices, isLater, laterOk, releaseAt, LATER_MAX_QTY } from '@/lib/ahead-days';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const SLOT_MIN = 15, FIRST_SLOT_MIN = 20, UNPAID_MIN = 30, MAX_LINES = 30;
const nowIso = () => new Date().toISOString();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const centsOf = (n: unknown) => Math.round(num(n) * 100);
// Text a guest typed: control and invisible formatting characters out (they'd reorder or hide what staff read), spaces tidied.
const words = (v: unknown, n: number) => String(v ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
const secret = () => String(process.env.ORDER_TRACK_SECRET || process.env.RETAIL_QR_SECRET || process.env.CRON_SECRET || '');
export type AheadWay = 'drive-thru' | 'inside' | 'curbside' | 'delivery';

/** The business's order-ahead settings: whether it's on, how guests can pick up, and how far ahead (hours) they can order. */
export function aheadOf(tenant: any) {
  const a = tenant?.orderAhead || {};
  const hours = Math.floor(num(a.laterHours));
  // Curbside (we bring it to their car: components/orders/CurbsideScreen) only once it's turned on.
  // Delivery by the business's own drivers (lib/food-delivery) only once it's turned on, and while its delivery zones are.
  const ways: AheadWay[] = [...(a.driveThru !== false ? ['drive-thru' as const] : []), ...(a.inside !== false ? ['inside' as const] : []), ...(a.curbside === true ? ['curbside' as const] : []),
    ...(foodDeliveryOf(tenant).on && deliveryFrom(tenant?.retailSettings).on ? ['delivery' as const] : [])];
  const cap = cleanSlotItems(a.slotItems);
  return { on: a.on === true && ways.length > 0, ways: ways.length ? ways : (['inside'] as AheadWay[]), laterHours: hours >= 0 && hours <= 12 ? (a.laterHours === undefined ? 3 : hours) : 3,
    // Most items one pickup time takes (lib/ahead-slots); null: no limit.
    slotItems: cap === undefined ? null : cap };
}

export function aheadSig(tenantId: string, orderId: string): string | null {
  const s = secret(); if (!s) return null;
  return createHmac('sha256', s).update(`ahead:${tenantId}:${orderId}`).digest('base64url').slice(0, 32);
}
export function aheadSigOk(tenantId: string, orderId: string, sig: unknown): boolean {
  const want = aheadSig(tenantId, orderId); const got = String(sig || '');
  if (!want || got.length !== want.length) return false;
  try { return timingSafeEqual(Buffer.from(want), Buffer.from(got)); } catch { return false; }
}

/** The times a guest can pick, every quarter hour from twenty minutes on (later by `delayMin` when the kitchen is
 *  behind, lib/kitchen-pace), until the business's limit, today only (in the business's own time zone: an order and its
 *  code belong to one day), and only while it's open (`hours`: its opening hours today, lib/ahead-hours; none set, any
 *  time). */
export function pickupTimes(tenant: any, now = Date.now(), delayMin = 0, hours: HoursNow = { set: false }): string[] {
  const { laterHours } = aheadOf(tenant); if (!laterHours) return [];
  const step = SLOT_MIN * 60000; const tz = tenantTimeZone(tenant); const today = todayIn(tz, new Date(now));
  const first = Math.ceil((now + (FIRST_SLOT_MIN + Math.max(0, Math.round(delayMin))) * 60000) / step) * step;
  const out: string[] = [];
  for (let t = first; t <= now + laterHours * 3600000; t += step) { if (todayIn(tz, new Date(t)) !== today) break; if (insideHours(hours, t)) out.push(new Date(t).toISOString()); }
  return out;
}
/** "As soon as it's ready" is offered while the business is open, with at least the first pickup time's twenty minutes
 *  before it closes. */
export const asapNow = (hours: HoursNow, now = Date.now()) => asapOpen(hours, now, FIRST_SLOT_MIN);

/** The business's opening hours as they stand now (Settings → Opening hours; lib/ahead-hours), read at most once a minute
 *  per business. */
const hoursCache = new Map<string, { at: number; week: Record<string, any> | null }>();
/** The house week itself (null: no hours set), for today's times and the days ahead (lib/ahead-days). */
export async function aheadWeek(db: any, tenantId: string, now = Date.now()): Promise<Record<string, any> | null> {
  const c = hoursCache.get(tenantId);
  if (c && now - c.at < 60000) return c.week;
  const snap = await db.collection(`tenants/${tenantId}/scheduleProfiles`).get().catch(() => null);
  // (Not readable just now: no limit this time, never a closed page because of a hiccup.)
  const week = snap ? houseWeek(snap.docs.map((d: any) => d.data() || {})) : null;
  if (snap) { hoursCache.set(tenantId, { at: now, week }); if (hoursCache.size > 500) hoursCache.delete(hoursCache.keys().next().value as string); }
  return week;
}
export async function aheadHours(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<HoursNow> {
  return hoursNow(await aheadWeek(db, tenantId, now), tenantTimeZone(tenant), now);
}

/** What a guest sees of one item (only what's on the menu for everyone; sold out says so), and what they're offered
 *  once it's added (lib/menu-upgrades): only items on this same menu (`shown`). */
const guestItem = (m: MenuItem, shown: Set<string>) => ({ id: m.id, name: m.name, section: m.section, words: m.words, price: m.price, from: m.from, startPrice: m.startPrice, imageUrl: m.imageUrl,
  choices: m.choices, soldOut: m.soldOut || !m.inStock, calories: m.calories, upgrades: { size: m.upgrades?.size === true, items: (m.upgrades?.items || []).filter((id) => shown.has(id)) },
  // What it contains of the major allergens, when the business has said (null: nobody has, never "none").
  allergens: m.allergensSet ? m.allergens : null });

/** Today and yesterday in the business's own time zone: an order placed just before midnight is still picked up after. */
export function openDays(tenant: any, now = Date.now()): string[] {
  const tz = tenantTimeZone(tenant); const today = todayIn(tz, new Date(now)); const before = todayIn(tz, new Date(now - 86400000));
  return today === before ? [today] : [today, before];
}

/** The orders placed ahead that could be in today's pickup times (placed today, or late yesterday for a time after
 *  midnight), for how full each time is: read at most every 10 seconds per business. */
const dayCache = new Map<string, { at: number; day: string; orders: any[] }>();
async function dayOrders(db: any, tenantId: string, tenant: any, now: number): Promise<any[]> {
  const tz = tenantTimeZone(tenant); const day = todayIn(tz, new Date(now)); const before = todayIn(tz, new Date(now - 86400000)); const c = dayCache.get(tenantId);
  if (c && c.day === day && now - c.at < 10000) return c.orders;
  const orders = (await db.collection(`tenants/${tenantId}/counterOrders`).where('channel', '==', 'ahead').where('day', 'in', day === before ? [day] : [day, before]).limit(3000).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  dayCache.set(tenantId, { at: now, day, orders }); if (dayCache.size > 500) dayCache.delete(dayCache.keys().next().value as string);
  return orders;
}

/** The guest's menu: on or off, how they can pick up, the times, and the items by section. The menu itself is read at
 *  most every 15 seconds per business, however many guests open the page. */
const menuCache = new Map<string, { at: number; menu: MenuItem[] }>();
export async function aheadMenu(db: any, tenantId: string, tenant: any) {
  const A = aheadOf(tenant);
  const business = String(tenant?.name || tenant?.businessName || '').slice(0, 80) || 'Order ahead';
  if (!A.on) return { ok: true as const, on: false, business, ways: [] as AheadWay[], times: [] as string[], sections: [] as any[] };
  const c = menuCache.get(tenantId); let all: MenuItem[];
  if (c && Date.now() - c.at < 15000) all = c.menu;
  else { all = await readMenu(db, tenantId); menuCache.set(tenantId, { at: Date.now(), menu: all }); if (menuCache.size > 500) menuCache.delete(menuCache.keys().next().value as string); }
  const menu = all.filter((m) => m.onMenu && !m.membersOnly);
  const sections: { name: string; items: ReturnType<typeof guestItem>[] }[] = [];
  const shown = new Set(menu.map((m) => m.id));
  for (const m of menu) { let s = sections.find((x) => x.name === m.section); if (!s) sections.push((s = { name: m.section, items: [] })); s.items.push(guestItem(m, shown)); }
  const payments = !!accountOf(tenant) && !!process.env.STRIPE_SECRET_KEY && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && !!secret();
  // The rewards program, when it's on: the page asks for a phone number (and, for a program you join, whether they want to).
  const L = loyaltyOf(tenant);
  // The kitchen running behind (lib/kitchen-pace): the first time offered is that much later, and the page says so.
  const pace = await paceNow(db, `tenants/${tenantId}`, tenant);
  const busy = pace.level === 'calm' ? null : { minutes: pace.behindMin };
  // Pickup times that fill (lib/ahead-slots): the times with no room left, fewer items a time when the kitchen is busy.
  // Only while it's open (lib/ahead-hours): before opening, times from then; closed for the day, when it opens next.
  const now = Date.now(); const week = await aheadWeek(db, tenantId, now); const hours = hoursNow(week, tenantTimeZone(tenant), now); const times = pickupTimes(tenant, now, pickupDelayMin(pace), hours);
  // Orders for another day (lib/ahead-days), when they're taken: the days and their times, how it can be had (never the
  // drive-thru), the smallest order and the notice (the guest can cancel until it runs out).
  const D = anotherDayOf(tenant); const laterWays = A.ways.filter((w) => w !== 'drive-thru');
  const later = D.on && laterWays.length ? { days: dayChoices(D, week, tenantTimeZone(tenant), now), ways: laterWays, minCents: D.minCents, noticeHours: D.noticeHours } : null;
  const asap = asapNow(hours, now); const today = hours.set ? hours.today : null;
  const opens = today && now < today.open ? new Date(today.open).toISOString() : null;
  const closes = today ? new Date(today.close).toISOString() : null;
  const nextOpen = hours.set && !asap && !times.length && hours.next ? new Date(hours.next).toISOString() : null;
  // Open, but too near closing for anything to be ready in time: said as such, not as closed.
  const lateToday = !!today && now >= today.open && !asap && !times.length;
  const cap = slotCap(A.slotItems, pace.level as PaceLevel);
  let full: string[] = []; let asapFull = false;
  if (cap !== null) { const used = itemsBySlot(await dayOrders(db, tenantId, tenant, now), now); full = fullTimes(times, used, cap); asapFull = (used.get(asapSlot(now, pickupDelayMin(pace))) || 0) >= cap; }
  // Klair answering menu questions (lib/klair-menu), when the business turns it on.
  const K = klairSettings(tenant); const klair = menuAnswersOn(tenant, K.on) ? { name: K.name } : null;
  return { ok: true as const, on: payments, business, ways: A.ways, times, full, asapFull, filling: cap !== null && pace.level !== 'calm', busy, klair, sections, timeZone: tenantTimeZone(tenant),
    // Whether "as soon as it's ready" is offered, when it opens later today, closing time, and (nothing to pick now) when
    // it opens next; with no opening hours set, always as soon as it's ready and no limit.
    // (Too near closing today: lateToday, said as too late rather than closed.)
    asap, opens, closes, nextOpen, closedNow: hours.set && !asap && !times.length, lateToday, later,
    // (Joining is always asked on this page: a number typed here could be anyone's, so no one is added without saying yes.)
    points: L.on ? { unit: L.earn?.mode === 'punch' ? 'punches' : 'points', askJoin: true } : null,
    // "Text me when it's ready", where the business can text (lib/ready-text).
    texts: readyTextsOn(tenant) };
}

/** Place an order (not paid yet) and start its payment. Opened again with the same key (a refresh, a second tap), it's the
 *  same order and the same payment. */
export async function placeAhead(db: any, tenantId: string, tenant: any, b: { key?: unknown; lines?: unknown; name?: unknown; way?: unknown; at?: unknown; phone?: unknown; join?: unknown; textMe?: unknown; address?: unknown; note?: unknown; deliveryToken?: unknown; tip?: unknown; allergy?: unknown; day?: unknown; people?: unknown }, o: { stripe?: any; now?: number } = {}): Promise<any> {
  const A = aheadOf(tenant);
  if (!A.on) return fail('Ordering ahead isn’t on here right now.', 409, 'off');
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe || !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || !secret()) return fail('Paying online isn’t set up here yet.', 409, 'no_payments');
  const key = String(b.key || ''); if (!KEY.test(key)) return fail('Something went wrong. Try again.', 400);
  const name = cleanName(b.name); if (!name) return fail('What name should we put on the order?', 400, 'name');
  const way = String(b.way || '') as AheadWay; if (!A.ways.includes(way)) return fail('How will you pick it up?', 400, 'way');
  const now = o.now ?? Date.now();
  // For another day (lib/ahead-days): a day and a time it's open, from the notice on and up to how far ahead it takes
  // them, inside or delivered (never the drive-thru), with how many people when they say.
  const L = anotherDayOf(tenant); const forDay = b.day ? String(b.day) : null;
  if (forDay && !L.on) return fail('Orders for another day aren’t taken here right now.', 409, 'later_off');
  if (forDay && way === 'drive-thru') return fail('Orders for another day are picked up inside, or delivered.', 400, 'way');
  const people = forDay ? cleanPeople(b.people) : null;
  if (people === undefined) return fail('How many people: 1 to 500, or leave it empty.', 400, 'people');
  let at: string | null = null;
  if (forDay) {
    if (!b.at || !laterOk(L, await aheadWeek(db, tenantId, now), tenantTimeZone(tenant), forDay, String(b.at), now)) return fail('Pick the day and time again.', 400, 'at');
    at = new Date(Date.parse(String(b.at))).toISOString();
  } else if (b.at) {
    const t = Date.parse(String(b.at)); const times = pickupTimes(tenant, now).map((x) => Date.parse(x));
    // A time offered a moment ago still counts (the page may be a few minutes old); anything else is picked again.
    if (!Number.isFinite(t) || t < now + 10 * 60000 || !times.length || t > times[times.length - 1] + 60000 || t % (SLOT_MIN * 60000) !== 0) return fail('Pick a pickup time again.', 400, 'at');
    at = new Date(t).toISOString();
  }
  const raw = Array.isArray(b.lines) ? b.lines.slice(0, MAX_LINES + 1) : [];
  if (!raw.length) return fail('Add something first.', 400, 'empty');
  if (raw.length > MAX_LINES) return fail(`Up to ${MAX_LINES} lines in one order.`, 400);
  const T = `tenants/${tenantId}`;
  const ids = Array.from(new Set(raw.map((l: any) => String(l?.itemId || '')).filter((x) => ID.test(x))));
  const snaps = await Promise.all(ids.map((id) => db.doc(`${T}/inventory/${id}`).get()));
  const item = new Map<string, any>(); snaps.forEach((s: any, k: number) => { const d = s.data(); if (d) item.set(ids[k], d); });
  const menu = new Map((await readMenu(db, tenantId)).map((m) => [m.id, m]));
  const lines: OrderLine[] = []; const want = new Map<string, number>();
  for (const [k, l] of raw.entries()) {
    const id = String((l as any)?.itemId || ''); const m = menu.get(id); const it = item.get(id);
    if (!m || !it || !m.onMenu || m.membersOnly) return fail('Something in your order isn’t on the menu any more. Take it off and try again.', 409, 'gone');
    const r = lineFor(it, id, (l as any)?.quantity, (l as any)?.choices, `l${k + 1}`, undefined, forDay ? LATER_MAX_QTY : 20);
    if (!r.ok) return fail(`${m.name}: ${r.error}`, 409, 'line');
    // (A note for the kitchen about this dish: lib/order-allergy.)
    const note = cleanLineNote((l as any)?.note); if (note) r.line.note = note;
    want.set(id, (want.get(id) || 0) + r.line.quantity);
    lines.push(r.line);
  }
  // Taken as an offer once something else was added (lib/menu-upgrades): kept on the line only when the menu says it
  // was offered, for how often offers are taken.
  raw.forEach((l: any, k: number) => {
    const kind = offerOf(l?.offer, menu.get(lines[k].itemId)!, cleanPicks(l?.choices), lines.filter((_, j) => j !== k).map((x) => menu.get(x.itemId)!));
    if (kind) lines[k].offer = kind;
  });
  // (For another day, what's left today says nothing about then: it's checked when it goes to the kitchen.)
  for (const [id, q] of forDay ? [] : want) {
    const m = menu.get(id)!;
    if (m.soldOut || !m.inStock) return fail(`${m.name} just sold out. Take it off and try again.`, 409, 'sold_out');
    if (m.canMake !== null && m.canMake < q) return fail(m.canMake > 0 ? `Only ${m.canMake} ${m.name} left. Change your order and try again.` : `${m.name} just sold out. Take it off and try again.`, 409, 'sold_out');
  }
  // A phone number (optional): for points, kept with the order, and the order is theirs once it's paid; and for one text
  // when it's ready, if they ticked it (lib/ready-text).
  const phone = String(b.phone ?? '').replace(/\D/g, '').slice(-10);
  if (b.phone && phone.length !== 10) return fail('A 10-digit phone number, or leave it empty.', 400, 'phone');
  const textTo = b.textMe === true && phone && readyTextsOn(tenant) ? toE164(phone) : null;
  if (b.textMe === true && phone && readyTextsOn(tenant) && !textTo) return fail('That number can’t get texts. Check it, or untick Text me.', 400, 'phone');
  // (For another day, a number to reach them about it: a change, or it couldn't be made. Cleared the night after.)
  if (forDay && phone.length !== 10) return fail('Add your phone number, so we can reach you about your order.', 400, 'phone');
  // Delivered (lib/food-delivery): the address checked against the delivery zones again (the fee worked out here, never
  // taken from the page), and no farther than hot food goes. The fee is its own line, with no tax on it.
  let deliv: any = null;
  if (way === 'delivery') {
    // (A phone number, so the driver can reach them at the door: kept with the delivery, for the team only.)
    if (phone.length !== 10) return fail('Add your phone number so the driver can reach you.', 400, 'phone');
    const r = await deliveryQuote(db, tenantId, tenant, b.address, centsOf(totalsOf(tenant, lines).subtotal), b.deliveryToken, now);
    if (!r.ok) return r;
    deliv = { address: r.address, note: cleanNote(b.note), phone, feeCents: r.feeCents, miles: r.miles, driveMin: r.driveMin, zone: r.zone, state: 'waiting' };
  }
  // The driver's tip (a delivery only): worked out here from the food, never taken from the page.
  const tipCents = deliv ? tipCentsOf(b.tip, centsOf(totalsOf(tenant, lines).subtotal)) : 0;
  if (tipCents < 0) return fail('Pick a tip again.', 400, 'tip');
  // Sales tax on the delivery fee, where the business charges it (Menu, Ordering ahead): the same rate as the food.
  const feeTax = deliv && deliv.feeCents > 0 && foodDeliveryOf(tenant).feeTaxed ? posTaxAmount(tenant, { services: 0, products: deliv.feeCents / 100 }) : 0;
  const money = deliv ? withDeliveryFee(totalsOf(tenant, lines), deliv.feeCents, tipCents, feeTax) : totalsOf(tenant, lines); const cents = centsOf(money.total);
  if (cents < 50) return fail('Orders paid online start at $0.50.', 400, 'too_small');
  if (forDay && L.minCents !== null && centsOf(totalsOf(tenant, lines).subtotal) < L.minCents) return fail(`Orders for another day start at $${(L.minCents / 100).toFixed(2)} before tax.`, 400, 'too_small');
  // Its day: today, or the day it's for (its pickup code and number are that day's).
  const day = forDay || todayIn(tenantTimeZone(tenant), new Date(now));
  // Its pickup time (lib/ahead-slots): the one chosen, or for as soon as it's ready the first that could be ready. Room
  // in it is checked in the same step the order is made, so two guests can't both take the last of it.
  const pace = await paceNow(db, `tenants/${tenantId}`, tenant).catch(() => ({ level: 'calm', behindMin: 0 } as any));
  // A delivery slowed down at the counter: more minutes on its time (lib/driver-load).
  const slowMin = deliv && !forDay ? deliveryNowOf(tenant, now).extraMin : 0;
  // (For another day, no room is taken in its pickup time: it starts early enough for its size.)
  const slot = at || asapSlot(now, pickupDelayMin(pace) + slowMin); const cap = forDay ? null : slotCap(A.slotItems, pace.level as PaceLevel); const items = itemCount(lines);
  // The same order only for the same key AND the same details: changed after going back (another pickup way, time,
  // name or item), it's a new order, never the old one paid for.
  // The guest's allergies (lib/order-allergy): on every ticket.
  const allergy = cleanOrderAllergy(b.allergy);
  const what = JSON.stringify({ lines: lines.map((l) => [l.itemId, l.quantity, l.choicesText || '', l.note || '']), name, way, at, phone, text: !!textTo, ...(deliv ? { to: deliv.address, note: deliv.note, tip: tipCents } : {}), ...(allergy ? { allergy } : {}), ...(forDay ? { day: forDay, people } : {}) });
  const orderRef = db.doc(`${T}/counterOrders/ahead_${createHash('sha256').update(`${tenantId}/${key}/${what}`).digest('hex').slice(0, 32)}`);
  const orderId = orderRef.id;
  // (The same order asked again, its answer lost, is still found as it was: never refused by what changed since.)
  const prior = (await orderRef.get()).exists;
  if (deliv && !prior && !forDay) {
    // Paused at the counter (lib/driver-load): no new deliveries until it's over.
    const slow = deliveryNowOf(tenant, now);
    if (slow.paused) return { ...fail('We’re not taking deliveries for a little while. Pick it up instead, or try again later.', 409, 'paused'), until: slow.until };
    if (at && slowMin && Date.parse(at) < Date.parse(asapSlot(now, pickupDelayMin(pace) + slowMin))) return fail('Deliveries are taking a little longer right now. Pick a later time.', 409, 'at');
    // A driver free for it, there and back (read afresh, with deliveries others are paying for now; never this guest's own
    // earlier try), or a later time is asked for.
    const load = await driverLoad(db, tenantId, tenant, now, { skipCheckout: key }).catch(() => null);
    if (load && !drivableTimes([slot], deliv.driveMin, load.onShift, load.trips).ok.length) return fail(at ? 'Our drivers are all out then. Pick a later time.' : 'Our drivers are all out right now. Pick a later time.', 409, 'no_driver');
  }
  // Only while it's open (lib/ahead-hours): a page left open past closing can't place a new order for when it's closed.
  const hours = await aheadHours(db, tenantId, tenant, now);
  if (hours.set && !prior && !forDay) {
    if (at && !insideHours(hours, Date.parse(at))) return fail('Pick a pickup time again.', 400, 'at');
    if (!at && !asapNow(hours, now)) return pickupTimes(tenant, now, 0, hours).length ? fail('We’re not open yet. Pick a pickup time.', 409, 'asap_closed') : fail('We’re closed right now, so we can’t take an order for pickup today.', 409, 'closed_now');
  }
  const made: any = await db.runTransaction(async (tx: any) => {
    const had: any = (await tx.get(orderRef)).data();
    if (had) return { had };
    if (cap !== null) {
      // Only the orders for this pickup time, whatever day they were placed (a late order for a time after midnight).
      const inSlot = (await tx.get(db.collection(`${T}/counterOrders`).where('ahead.slot', '==', slot))).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      if (!fits(itemsBySlot(inSlot, now, orderId).get(slot) || 0, cap, items)) return { full: true };
    }
    // A pickup code nobody else has today (tried a few times; 9,000 to choose from).
    let code = ''; const counterRef = db.doc(`${T}/orderCounters/${day}`);
    const c: any = (await tx.get(counterRef)).data() || {};
    for (let i = 0; i < 8 && !code; i++) { const try1 = String(randomInt(1000, 10000)); const cRef = db.doc(`${T}/aheadCodes/${day}_${try1}`); if (!(await tx.get(cRef)).exists) code = try1; }
    if (!code) return { busy: true };
    const n = Math.floor(num(c.ahead)) + 1; const number = orderNumber('ahead', n);
    tx.set(counterRef, { ahead: n, day }, { merge: true });
    tx.set(db.doc(`${T}/aheadCodes/${day}_${code}`), { orderId, at: nowIso() });
    tx.set(orderRef, { id: orderId, number, channel: 'ahead', status: 'building', lines, ...money, ...(tipCents > 0 ? { tipFor: 'driver' } : {}), guestName: name, createdAt: new Date(now).toISOString(), createdBy: 'Ordered ahead', day,
      ...(allergy ? { allergy: { ...allergy, by: 'The guest', at: new Date(now).toISOString() } } : {}),
      ahead: { state: 'awaiting_pay', way, at, slot, code, cents, payId: null, ...(deliv ? { checkout: key } : {}), ...(phone && loyaltyOf(tenant).on ? { pointsPhone: phone, pointsJoin: b.join === true } : {}),
        // (Due at the door the drive after it's ready: its pickup time is when the driver leaves.)
        ...(deliv ? { delivery: { ...deliv, arriveAt: new Date(Date.parse(slot) + deliv.driveMin * 60000).toISOString() } } : {}),
        // For another day: until when the guest can cancel, and when it goes to the kitchen (lib/ahead-days).
        ...(forDay && at ? { forDay, later: { people, phone, noticeHours: L.noticeHours, cancelBy: new Date(cancelBy(Date.parse(at), L.noticeHours)).toISOString(), releaseAt: new Date(releaseAt(Date.parse(at), lines)).toISOString(),
          // (`due`: on the payments sweep's list until it's sent or canceled; `wipeAfter`: when the guest's number goes.
          // lib/ahead-days-server)
          due: new Date(releaseAt(Date.parse(at), lines)).toISOString(), wipeAfter: new Date(Date.parse(at) + 36 * 3600000).toISOString() } } : {}) },
      // (For another day, the number for the ready text waits from its own time: lib/ready-text lets go of one left waiting.)
      ...(textTo ? { readyText: { to: textTo, last4: lastFour(textTo), via: 'ahead', pendingSince: forDay && at ? at : new Date(now).toISOString(), sentAt: null } } : {}) });
    return { number, code };
  });
  if (made.busy) return fail('Something went wrong. Try again.', 503);
  if (!made.had) dayCache.delete(tenantId);
  if (made.full) { dayCache.delete(tenantId); return fail(at ? 'That pickup time just filled up. Pick another time.' : pickupTimes(tenant, now, 0, hours).length ? 'The kitchen’s full for the next few minutes. Pick a time a little later.' : 'The kitchen’s full right now. Please try again in a few minutes.', 409, 'slot_full'); }
  if (deliv && !made.had) forgetDriverLoad(tenantId);
  const cur: any = made.had || (await orderRef.get()).data();
  if (made.had) {
    if (cur.ahead?.state === 'paid') return { ok: true, orderId, sig: aheadSig(tenantId, orderId), number: cur.number, paid: true };
    if (cur.ahead?.state !== 'awaiting_pay') return fail('That order was closed. Start a new one.', 409, 'closed');
  }
  // One payment for the order, for exactly its total (made under the order's own key, so asking again never makes two).
  let pi: any;
  try {
    pi = await stripe.paymentIntents.create({
      amount: Math.round(num(cur.ahead.cents)), currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: `Order ahead ${cur.number}`,
      metadata: { tenantId, source: 'order_ahead', kind: 'counter', orderId },
    }, { stripeAccount: acct, idempotencyKey: `order-ahead-${orderId}` });
  } catch { return fail('Paying isn’t working right now. Try again in a moment.', 503); }
  // On the payments sweep's list (lib/counter-card) from now: paid and unheard, or never paid.
  await orderRef.set({ ahead: { payId: pi.id }, cardOpen: true }, { merge: true });
  return { ok: true, orderId, sig: aheadSig(tenantId, orderId), number: cur.number, total: num(cur.total), paid: false, ...(cur.deliveryFee ? { deliveryFee: num(cur.deliveryFee) } : {}), ...(num(cur.tipCents) > 0 ? { tip: num(cur.tipCents) / 100 } : {}),
    clientSecret: pi.client_secret, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, stripeAccount: acct };
}

/** The payment went through (asked of the card company, never taken from a page): the order goes to the kitchen and is
 *  paid by it, once, whichever hears first (the guest's page, the payment notice, the sweep). Something sold out since
 *  it was placed: the money goes back, and the guest is told. */
export async function settleAhead(db: any, tenantId: string, tenant: any, orderId: string, piId: string, o: { stripe?: any } = {}): Promise<any> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe || !ID.test(orderId)) return fail('Paying online isn’t set up here yet.', 409);
  let pi: any;
  try { pi = await stripe.paymentIntents.retrieve(String(piId), {}, { stripeAccount: acct }); } catch { return fail('We couldn’t reach card payments just now. Try again in a moment.', 503); }
  if (String(pi?.metadata?.tenantId || '') !== tenantId || String(pi?.metadata?.orderId || '') !== orderId || pi?.metadata?.source !== 'order_ahead') return fail('That payment isn’t for this order.', 409);
  if (pi.status === 'canceled') return { ok: true, paid: false, canceled: true };
  if (pi.status !== 'succeeded') return { ok: true, paid: false, pending: true };
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  // Given back (once), and the order closed, in one step that reads it as it is now: never undoes an order that's
  // already with the kitchen or paid.
  const back = async (why: string) => {
    const cur: any = (await ref.get()).data() || {};
    if (cur.cardBack?.[pi.id]?.refunded !== true) await giveBack(db, stripe, acct, tenantId, orderId, pi, String(cur.number || ''));
    await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(ref)).data() || {};
      if (x.paidAt && x.cardPaymentId === pi.id) return;
      tx.set(ref, { ahead: { state: x.paidAt ? 'paid' : 'canceled', ...(x.paidAt ? {} : { failed: why }), settlingAt: null },
        ...((x.status === 'building' || x.status === 'scheduled') && !x.paidAt ? { status: 'voided', voidedAt: nowIso(), voidReason: why, ...(x.readyText?.to ? { readyText: { to: null, pendingSince: null } } : {}),
          // (A delivery never paid for is off the delivery lists: lib/food-delivery-server reads by its state.)
          ...(x.ahead?.delivery ? { ahead: { state: 'canceled', failed: why, settlingAt: null, delivery: { state: 'abandoned' } } } : {}) } : {}) }, { merge: true });
    });
    return { ok: true, paid: false, notKept: true, why };
  };
  // One at a time (the guest's page, the payment notice and the sweep can all ask at once): the others wait for it.
  const claim: any = await db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(ref)).data(); if (!x) return { gone: true };
    if (x.paidAt && x.cardPaymentId === pi.id) return { paid: true };
    if (x.paidAt || x.ahead?.state === 'canceled' || x.ahead?.state === 'abandoned' || x.status === 'voided') return { back: String(x.ahead?.failed || (x.paidAt ? 'This order was paid another way.' : 'This order was closed before the payment went through.')) };
    if (Date.now() - (Date.parse(String(x.ahead?.settlingAt || '')) || 0) < 60000) return { busy: true };
    tx.set(ref, { ahead: { settlingAt: nowIso() } }, { merge: true });
    return { or: x };
  });
  if (claim.gone) return fail('That order is gone.', 404);
  // Paid by it already (an earlier answer was lost before the order was marked): marked now.
  if (claim.paid) { await ref.set({ ahead: { state: 'paid', settlingAt: null } }, { merge: true }).catch(() => null); return { ok: true, paid: true, already: true }; }
  if (claim.back) return back(claim.back);
  if (claim.busy) return { ok: true, paid: false, pending: true };
  const or = claim.or;
  const done = async (patch: any) => ref.set({ ahead: { settlingAt: null, ...patch } }, { merge: true });
  // To the kitchen: for a later time, its tickets wait until it's time to start (the slowest item, plus two minutes).
  const wanted = Date.parse(String(or.ahead?.at || ''));
  const slowest = Math.max(60, ...(or.lines || []).map((l: any) => num(l.makeSeconds)));
  const holdUntil = Number.isFinite(wanted) ? new Date(wanted - (slowest + 120) * 1000).toISOString() : null;
  // For another day (lib/ahead-days): paid now, and kept until its day (lib/ahead-days-server sends it to the kitchen).
  const sent: any = isLater(or) ? await scheduleOrder(db, tenantId, orderId)
    : await sendOrder(db, tenantId, tenant, orderId, { id: null, name: 'Ordered ahead' }, { due: Number.isFinite(wanted) ? new Date(wanted).toISOString() : null, holdUntil: or.ahead?.hereAt ? null : holdUntil });
  // Something ran out, or came off the menu, since it was placed: it can't be made, so the money goes back.
  if (!sent.ok) {
    if (sent.status === 409 || sent.status === 400) { await done({}); return back(String(sent.error || 'Something in the order can’t be made right now.')); }
    await done({}); return fail(sent.error || 'That didn’t go through. Try again.', sent.status || 500);
  }
  const r: any = await payOrder(db, tenantId, orderId, { method: 'card', by: 'Paid when ordering', card: { id: pi.id, cents: Math.round(num(pi.amount)) } });
  if (r.paidOtherwise) { await done({}); return back('This order was paid another way.'); }
  if (!r.ok) { await done({}); return fail(r.error || 'That didn’t go through. Try again.', r.status || 500); }
  await ref.set({ ahead: { state: 'paid', paidAt: nowIso(), settlingAt: null }, paidVia: 'online' }, { merge: true });
  // Points, for a guest who gave their number (lib/counter-points): a member's order is theirs; someone new joins only if
  // they said yes. Never holds up the order.
  if (or.ahead?.pointsPhone) await linkAheadPoints(db, tenantId, tenant, orderId, or);
  return { ok: true, paid: true };
}

/** An order for another day, paid: it waits as 'scheduled' (no tickets) until its day. Asked again, as it is. */
async function scheduleOrder(db: any, tenantId: string, orderId: string): Promise<{ ok: true; already?: boolean } | Fail> {
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return fail('That order is gone.', 404);
    if (o.status === 'scheduled') return { ok: true, already: true };
    if (o.status !== 'building') return fail(o.status === 'voided' ? 'That order was closed.' : 'That order has gone to the kitchen already.', 409);
    if (!Array.isArray(o.lines) || !o.lines.length) return fail('Add something first.', 400);
    tx.set(ref, { status: 'scheduled', scheduledAt: nowIso() }, { merge: true });
    return { ok: true };
  });
}

/** The phone number given when ordering: once it's paid, the order is theirs (a member, or someone who said yes to
 *  joining). Done, the full number isn't kept on the order; not done (a hiccup), it's tried again when the guest's page
 *  next asks how the order is going. */
export async function linkAheadPoints(db: any, tenantId: string, tenant: any, orderId: string, or: any) {
  try {
    const P = await import('@/lib/counter-points');
    const r: any = await P.linkOrder(db, tenantId, tenant, orderId, { phone: or.ahead.pointsPhone, join: or.ahead.pointsJoin === true, name: or.guestName }, 'Ordered ahead');
    // Linked, or nothing to link (not a member and didn't join, the program's off, the order's gone): the number is let
    // go either way. Only the card company or the database not answering is tried again, five times at most.
    const tries = Math.floor(num(or.ahead?.pointsTries)) + 1;
    if (r.ok || r.status !== 503 || tries >= 5) await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).set({ ahead: { pointsPhone: null, pointsJoin: null, pointsDone: true } }, { merge: true });
    else await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).set({ ahead: { pointsTries: tries } }, { merge: true });
  } catch (e: any) { console.error('[counter-ahead] points not linked', orderId, e?.message); }
}

/** How the order is going, for the guest's page: paid, the code, being made (or waiting until it's time), ready. */
/** Whether an address gets hot food, and for what (lib/food-delivery): the business's delivery zones and fees
 *  (lib/delivery-server, the same answer the online shop gets), and no farther than the longest drive for hot food. */
export async function deliveryQuote(db: any, tenantId: string, tenant: any, rawAddress: unknown, itemsCents: number, token: unknown, now = Date.now()):
  Promise<{ ok: true; address: FoodAddress; feeCents: number; free: boolean; miles: number | null; driveMin: number; zone: string; token: string | null } | Fail> {
  const F = foodDeliveryOf(tenant);
  if (!F.on || !aheadOf(tenant).ways.includes('delivery')) return fail('Delivery isn’t on here right now. Pick it up instead.', 409, 'delivery_off');
  const address = cleanAddress(rawAddress);
  if (!address) return fail('Add the street address, town, state and ZIP code.', 400, 'address');
  const { deliveryFor } = await import('@/lib/delivery-server');
  const v = await deliveryFor(db, tenantId, tenant, address, { itemsCents: Math.max(0, Math.round(itemsCents)), token, now });
  if (!v.ok) return fail(v.message.replace('Choose another way to get your order.', 'Pick it up instead.'), v.reason === 'unavailable' ? 503 : 409, `delivery_${v.reason}`);
  const driveMin = driveMinutes(v.miles);
  // (Zones by ZIP code have no miles: the zones themselves are how far it goes.)
  if (v.miles !== null && driveMin > F.maxDriveMin) return fail(`That’s farther than we take hot food (about a ${driveMin}-minute drive). Pick it up instead.`, 409, 'too_far');
  return { ok: true, address, feeCents: Math.max(0, Math.round(v.fee.feeCents)), free: !!v.fee.free, miles: v.miles, driveMin, zone: String(v.zone.name || '').slice(0, 60), token: v.token };
}

/** The guest's "Check address" on the order page: the fee, the drive, as soon as it's ready (about when it'd be there),
 *  and the arrival times on offer. The order's items say whether it meets the zone's minimum. */
export async function deliveryCheck(db: any, tenantId: string, tenant: any, b: { address?: unknown; lines?: unknown; token?: unknown; later?: unknown }, now = Date.now()): Promise<any> {
  const raw = Array.isArray(b.lines) ? b.lines.slice(0, MAX_LINES) : [];
  const menu = new Map((await readMenu(db, tenantId)).map((m) => [m.id, m]));
  // (What it comes to, near enough for the minimum: the menu's prices; placing the order works it out exactly.)
  const itemsCents = raw.reduce((s: number, l: any) => { const m = menu.get(String(l?.itemId || '')); return s + (m ? Math.round(num(m.price) * 100) * Math.max(1, Math.min(99, Math.floor(num(l?.quantity) || 1))) : 0); }, 0);
  const r = await deliveryQuote(db, tenantId, tenant, b.address, itemsCents, b.token, now);
  if (!r.ok) return r;
  // For another day (lib/ahead-days): the fee and the drive; today's drivers and hours don't come into it.
  if (b.later === true) return { ok: true, feeCents: r.feeCents, free: r.free, driveMin: r.driveMin, token: r.token, asapArrive: null, asapNoDriver: false, times: [], leaveFull: [], leaveFirst: null, slowMin: 0 };
  // Slowed down at the counter (lib/driver-load): paused, or more minutes on new deliveries' times.
  const slow = deliveryNowOf(tenant, now);
  if (slow.paused) return { ...fail('We’re not taking deliveries for a little while. Pick it up instead, or try again later.', 409, 'paused'), until: slow.until };
  const hours = await aheadHours(db, tenantId, tenant, now);
  const pace = await paceNow(db, `tenants/${tenantId}`, tenant).catch(() => ({ level: 'calm', behindMin: 0 } as any));
  const asap = asapNow(hours, now) ? asapSlot(now, pickupDelayMin(pace) + slow.extraMin) : null;
  // Only times a driver on the schedule can make, there and back (lib/driver-load); with nobody on it as a driver, all.
  const load = await driverLoad(db, tenantId, tenant, now).catch(() => null);
  const leave = pickupTimes(tenant, now, pickupDelayMin(pace) + slow.extraMin, hours);
  const can = load ? drivableTimes(leave, r.driveMin, load.onShift, load.trips) : { ok: leave, full: [] as string[] };
  const asapOk = !!asap && (!load || drivableTimes([asap], r.driveMin, load.onShift, load.trips).ok.length > 0);
  return { ok: true, feeCents: r.feeCents, free: r.free, driveMin: r.driveMin, token: r.token,
    asapArrive: asapOk ? new Date(Date.parse(asap!) + r.driveMin * 60000).toISOString() : null, asapNoDriver: !!asap && !asapOk,
    times: arrivalTimes(can.ok, r.driveMin), leaveFull: can.full, leaveFirst: leave[0] || null, slowMin: slow.extraMin };
}

export async function aheadView(db: any, tenantId: string, tenant: any, orderId: string) {
  const or: any = (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data();
  if (!or || or.channel !== 'ahead') return fail('This order isn’t here.', 404);
  // A day on, the page says only that it's done (the guest's name and order aren't shown to anyone after that). For
  // another day, a day on from its own time (lib/ahead-days).
  const since = Math.max(Date.parse(String(or.createdAt || '')) || 0, isLater(or) ? Date.parse(String(or.ahead?.at || '')) || 0 : 0);
  if (Date.now() - since > 24 * 3600000) return fail('This order is done.', 410);
  const tickets = (await db.collection(`tenants/${tenantId}/kdsTickets`).where('orderId', '==', orderId).get()).docs.map((d: any) => d.data() || {});
  const live = tickets.filter((t: any) => t.status !== 'cancelled' && t.status !== 'voided');
  const held = live.some((t: any) => t.status === 'pending' && t.holdUntil && Date.parse(t.holdUntil) > Date.now());
  const ready = live.length > 0 && live.every((t: any) => ['ready', 'delivered', 'served', 'done'].includes(String(t.status)));
  // Handed over: at the drive-thru window (the order's done), or inside, when the kitchen screen marks it picked up.
  const handed = or.status === 'done' || (live.length > 0 && live.every((t: any) => ['delivered', 'served', 'done'].includes(String(t.status))));
  const state = String(or.ahead?.state || '');
  return {
    ok: true as const, business: String(tenant?.name || tenant?.businessName || '').slice(0, 80), number: String(or.number || ''), name: or.guestName || null,
    // (A delivery has no pickup code, unless it's being picked up instead after it couldn't be delivered.)
    state, paid: !!or.paidAt, code: or.paidAt && (or.ahead?.way !== 'delivery' || ['pickup', 'picked_up'].includes(String(or.ahead?.delivery?.state || ''))) ? String(or.ahead?.code || '') : null, way: (or.ahead?.way || 'inside') as AheadWay, at: or.ahead?.at || null,
    kitchen: !or.paidAt ? null : or.status === 'scheduled' ? 'later' : handed ? 'handed' : ready ? 'ready' : held ? 'later' : 'making',
    // For another day (lib/ahead-days): its day, for how many, until when it can be canceled for a full refund (while it
    // hasn't gone to the kitchen), and once canceled, what went back to their card.
    later: isLater(or) ? laterView(or) : null,
    here: !!or.ahead?.hereAt, failed: state === 'canceled' ? String(or.ahead?.failed || '') || null : null,
    // Curbside: where they said they are, and, once someone's taking it out, their first name.
    curb: or.ahead?.way === 'curbside' ? { where: or.ahead?.curb?.where || null, out: !!or.ahead?.curb?.outAt, by: or.ahead?.curb?.outBy || null,
      onWay: !!or.ahead?.curb?.onWayAt, eta: or.ahead?.curb?.etaMinutes ?? null, found: or.ahead?.curb?.source === 'geo' } : null,
    // Where pickups happen (lib/pickup-geo), for a curbside guest not here yet: how far away, and checking in once they pull in.
    geo: or.ahead?.way === 'curbside' && !or.ahead?.hereAt && or.status !== 'done' ? await pickupGeoOf(db, tenantId, tenant) : null,
    // Points this order earned (never their balance: a page anyone with the link can open).
    earned: Math.max(0, Math.floor(num(or.points?.earned))), unit: loyaltyOf(tenant).earn?.mode === 'punch' ? 'punches' : 'points',
    // (With what was picked, so the page can put the same order together again: Order this again.)
    // (What they told the kitchen: their allergies, and a note on a dish.)
    allergy: allergyWords(orderAllergyOf(or)) || null,
    lines: (or.lines || []).map((l: any) => ({ name: String(l.name || ''), quantity: num(l.quantity), choicesText: l.choicesText || null, note: l.note || null, price: Math.round(num(l.unitPrice) * num(l.quantity) * 100) / 100, imageUrl: l.imageUrl || null,
      itemId: String(l.itemId || ''), picks: picksOf(l.choices) })),
    // The text when it's ready (lib/ready-text): asked for (its last four digits) or sent, and whether it can be asked.
    text: readyTextView(or), texts: readyTextsOn(tenant) && or.status === 'sent' && !or.readyText?.sentAt,
    subtotal: num(or.subtotal), tax: num(or.tax), total: num(or.total),
    // Delivered (lib/food-delivery): where to (no ZIP or note, on a page anyone with the link can open), the fee, about
    // when it should get there, and how it's going: who's bringing it once it's out.
    ...(or.ahead?.way === 'delivery' && or.ahead?.delivery ? { deliveryFee: num(or.deliveryFee), tip: Math.max(0, num(or.tipCents)) / 100, delivery: {
      to: addressLine(or.ahead.delivery.address), arriveAt: or.ahead.delivery.arriveAt || null, driveMin: num(or.ahead.delivery.driveMin),
      step: or.paidAt ? deliveryStep(or.ahead.delivery, handed ? 'handed' : ready ? 'ready' : 'making') : null,
      driver: or.ahead.delivery.state === 'out' || or.ahead.delivery.state === 'delivered' ? String(or.ahead.delivery.driverName || '').split(' ')[0] || null : null,
      outAt: or.ahead.delivery.outAt || null, deliveredAt: or.ahead.delivery.deliveredAt || null,
      // Delivered: left at the door (and its photo, when the driver took one), or handed over.
      ...(or.ahead.delivery.state === 'delivered' ? { left: or.ahead.delivery.left === true, photo: typeof or.ahead.delivery.photo === 'string' ? or.ahead.delivery.photo : null } : {}),
      // Out with a driver: about when it gets there now, and whether it's running late (lib/food-delivery etaOf).
      ...(or.ahead.delivery.state === 'out' ? (() => { const e = etaOf(or.ahead.delivery, Date.now()); return { eta: e.eta, late: e.late }; })() : { eta: null, late: false }),
      // (The driver texted that they're outside, in the last few minutes, while it's out.)
      outside: or.ahead.delivery.state === 'out' && Date.now() - (Date.parse(String(or.ahead.delivery.outsideAt || '')) || 0) < 15 * 60000,
      // Couldn't be delivered (lib/food-delivery-settle-server): why, and what a refund or a pickup gives back; once
      // it's settled, what went back to their card.
      ...(or.ahead.delivery.state === 'failed' ? { failed: failedView(or, tenant) } : {}),
      ...(['pickup', 'picked_up', 'refunded'].includes(String(or.ahead.delivery.state)) ? { back: Math.max(0, Math.round(num(or.ahead.delivery.backCents))) / 100, owed: Array.isArray(or.ahead.delivery.owed) && or.ahead.delivery.owed.length > 0 } : {}) } } : {}),
  };
}

/** For another day, on the guest's page (lib/ahead-days). */
function laterView(or: any) {
  const L = or.ahead?.later || {}; const by = Date.parse(String(L.cancelBy || ''));
  const busy = !!L.cancel?.at && Date.now() - (Date.parse(String(L.cancel.at)) || 0) < 2 * 60000;
  return { day: String(or.ahead.forDay), people: Number(L.people) || null, cancelBy: Number.isFinite(by) ? new Date(by).toISOString() : null, waiting: or.status === 'scheduled',
    canCancel: or.status === 'scheduled' && !!or.paidAt && Number.isFinite(by) && Date.now() < by && !busy, canceled: !!L.canceledAt, canceledBy: L.canceledBy === 'guest' ? 'guest' : L.canceledAt ? 'business' : null,
    back: Math.max(0, Math.round(num(L.backCents))) / 100, stuck: !!L.cancel && !busy && Array.isArray(L.cancel.left) && L.cancel.left.length > 0 };
}

/** The guest says they're here (in the drive-thru line, inside, or parked outside for curbside): the kitchen starts now
 *  if it was waiting. Curbside says where they are (their car, its color, the spot) and anything to know; saying it again
 *  only changes those. Managers' phones buzz at once (a 'curbside_here' alert); the Curbside screen shows them either way. */
export async function aheadHere(db: any, tenantId: string, orderId: string, curb?: { where?: unknown; note?: unknown; source?: unknown; distanceM?: unknown }): Promise<{ ok: true; already?: boolean } | Fail> {
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  let where = words(curb?.where, 80); const note = words(curb?.note, 160);
  // Checked in by their phone's location as they pulled in (their page open): where can come later. The distance is kept
  // as what the phone said, not a claim.
  const geo = curb?.source === 'geo'; const said = curb?.distanceM != null && curb?.distanceM !== '' && Number.isFinite(Number(curb?.distanceM)); const dist = said ? Math.round(Number(curb?.distanceM)) : -1;
  const r: any = await db.runTransaction(async (tx: any) => {
    const or: any = (await tx.get(ref)).data(); if (!or || or.channel !== 'ahead') return fail('This order isn’t here.', 404);
    if (!or.paidAt) return fail('This order isn’t paid yet.', 409);
    // (For another day: on its day, once it's with the kitchen.)
    if (or.status === 'scheduled') return fail('Your order is for another day. Tap I’m here when you come for it.', 409, 'later');
    // (A delivery comes to them: nothing to check in for.)
    if (or.ahead?.way === 'delivery') return fail('This order is being delivered to you.', 409, 'delivery');
    const curbside = or.ahead?.way === 'curbside';
    if (curbside && !where) where = String(or.ahead?.curb?.where || '');   // what they said they're driving, on the way
    if (curbside && !where && !geo) return fail('Say where you are: your car, its color, or the spot.', 400, 'where');
    if (curbside && geo && or.ahead?.hereAt) return { ok: true, already: true };   // the phone never changes a check-in already made
    if (or.status === 'done') return { ok: true, already: true };
    const at = or.ahead?.hereAt || nowIso();
    if (curbside) tx.set(ref, { ahead: { hereAt: at, curb: { where: where || null, note: note || or.ahead?.curb?.note || null, arrivedAt: or.ahead?.curb?.arrivedAt || at,
      ...(!or.ahead?.hereAt ? { source: geo ? 'geo' : 'tap', ...(geo && dist >= 0 && dist <= 2000 ? { distanceM: dist } : {}) } : {}) } } }, { merge: true });
    else if (!or.ahead?.hereAt) tx.set(ref, { ahead: { hereAt: at } }, { merge: true });
    return { ok: true, already: !!or.ahead?.hereAt, curbside, number: String(or.number || ''), name: or.guestName || null };
  });
  if (!r.ok || r.already) return r.ok ? { ok: true, already: true } : r;
  if (r.curbside) {
    // Someone is parked outside: said first, so nothing after can lose it (a second tap is "already").
    try {
      const n = db.collection(`tenants/${tenantId}/notifications`).doc();
      await n.set({ id: n.id, userId: null, read: false, createdAt: nowIso(), type: 'curbside_here', link: '/curbside', title: `${r.name ? String(r.name).split(' ')[0] : 'A guest'} is outside`,
        message: `Order ${r.number} for curbside: ${where || 'just pulled in (found by their location)'}.${note ? ` ${note}` : ''}` });
      await (await import('@/lib/push')).pushNow(db, tenantId);
    } catch { /* the curbside screen shows them either way */ }
  }
  try { await startNow(db, tenantId, orderId); } catch (e: any) { console.error('[counter-ahead] kitchen not started early', orderId, e?.message); }   // its own time still starts it
  return { ok: true };
}

/** A curbside guest on their way: when they set off, about how many minutes out (from a one-time location if they
 *  allowed it, else nothing: never treated as a promise), and what they're driving if they said. The Curbside screen
 *  shows them under On the way; nothing is buzzed. Saying it again updates the minutes (kept when no new ones come) and the car. */
export async function aheadOnWay(db: any, tenantId: string, orderId: string, b: { eta?: unknown; where?: unknown }): Promise<{ ok: true } | Fail> {
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const eta = Math.round(num(b?.eta)); const where = words(b?.where, 80); const sent = b?.eta != null && b?.eta !== '';
  return db.runTransaction(async (tx: any) => {
    const or: any = (await tx.get(ref)).data(); if (!or || or.channel !== 'ahead') return fail('This order isn’t here.', 404);
    if (!or.paidAt) return fail('This order isn’t paid yet.', 409);
    if (or.ahead?.way !== 'curbside') return fail('This order isn’t for curbside.', 409);
    if (or.ahead?.hereAt || or.status === 'done') return { ok: true };
    tx.set(ref, { ahead: { curb: { onWayAt: or.ahead?.curb?.onWayAt || nowIso(), etaMinutes: eta >= 1 && eta <= 60 ? eta : sent ? null : (or.ahead?.curb?.etaMinutes ?? null), ...(where ? { where } : {}) } } }, { merge: true });
    return { ok: true };
  });
}

/** An order's tickets that were waiting until later: the kitchen starts on them now. */
async function startNow(db: any, tenantId: string, orderId: string) {
  const s = await db.collection(`tenants/${tenantId}/kdsTickets`).where('orderId', '==', orderId).get();
  // (Its wait on the kitchen screen counts from now, not from when it was placed.)
  // Only tickets still waiting: one already started (its time came) is left as it is.
  await Promise.all(s.docs.map((d: any) => { const t = d.data() || {}; return t.status === 'pending' && t.holdUntil && Date.parse(t.holdUntil) > Date.now() ? d.ref.set({ holdUntil: null, startedEarlyAt: nowIso(), requestedAt: nowIso() }, { merge: true }) : null; }));
}

/** Today's (and last night's) orders placed ahead for the drive-thru that haven't been picked up (for the lane): here
 *  first, then by time. Asked at most every few seconds per business, however many lane screens poll. */
const laneCache = new Map<string, { at: number; rows: any[] }>();
export async function aheadForLane(db: any, tenantId: string, tenant: any, now = Date.now()) {
  const c = laneCache.get(tenantId); if (c && now - c.at < 4000) return c.rows;
  const snaps = await Promise.all(openDays(tenant, now).map((day) => db.collection(`tenants/${tenantId}/counterOrders`).where('day', '==', day).where('channel', '==', 'ahead').get()));
  const rows = snaps.flatMap((s: any) => s.docs).map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((o: any) => o.ahead?.way === 'drive-thru' && o.paidAt && !o.ahead?.carId && o.status !== 'done' && o.status !== 'voided')
    .map((o: any) => ({ id: o.id, number: String(o.number || ''), name: o.guestName || null, code: String(o.ahead?.code || ''), at: o.ahead?.at || null, hereAt: o.ahead?.hereAt || null, locationId: o.locationId ? String(o.locationId) : null,
      items: (o.lines || []).reduce((n: number, l: any) => n + num(l.quantity), 0), total: num(o.total), summary: (o.lines || []).slice(0, 3).map((l: any) => `${num(l.quantity)} ${String(l.name || '')}`).join(', ') }))
    .sort((a: any, b: any) => Number(!!b.hereAt) - Number(!!a.hereAt) || String(a.hereAt || a.at || '9').localeCompare(String(b.hereAt || b.at || '9')));
  laneCache.set(tenantId, { at: now, rows }); if (laneCache.size > 500) laneCache.delete(laneCache.keys().next().value as string);
  return rows;
}
/** Something changed (an order placed ahead went to a car, or was paid): the lane's list is read again. */
export const aheadChanged = (tenantId: string) => { laneCache.delete(tenantId); };

/** At the speaker: "I ordered ahead, code 4821." The order goes with the car at the speaker (car.aheadId), whether it has
 *  ordered anything yet or not, and the kitchen starts on it if it was waiting: the crew asks if they'd like anything else,
 *  which is the car's own order, paid at the window ("Nothing else" sends the car on to pickup: aheadNothingMore). Without
 *  a car at the speaker (the window, a pickup-only lane), a car is made for it, straight to pickup. */
export async function aheadToCar(db: any, tenantId: string, tenant: any, b: { orderId?: unknown; code?: unknown; carId?: unknown }, who: { id: string | null; name: string }, here: string | null = null): Promise<any> {
  const T = `tenants/${tenantId}`; const days = openDays(tenant);
  let orderId = String(b.orderId || '');
  // The code: today's first, then last night's (an order placed just before midnight).
  // (Today's and last night's could share a code: one already picked up is skipped.)
  for (const day of days) {
    if (orderId || !/^\d{4}$/.test(String(b.code || ''))) break;
    const found = String(((await db.doc(`${T}/aheadCodes/${day}_${String(b.code)}`).get()).data() || {}).orderId || '');
    if (found && ID.test(found) && ((await db.doc(`${T}/counterOrders/${found}`).get()).data() || {}).status !== 'done') orderId = found;
  }
  if (!ID.test(orderId)) return fail('No order today has that code. Check the number with them.', 404, 'no_code');
  const carId = ID.test(String(b.carId || '')) ? String(b.carId) : null;
  const ref = db.doc(`${T}/counterOrders/${orderId}`);
  const carRef = carId ? db.doc(`${T}/driveThruCars/${carId}`) : db.collection(`${T}/driveThruCars`).doc();
  const r: any = await db.runTransaction(async (tx: any) => {
    const or: any = (await tx.get(ref)).data();
    if (!or || or.channel !== 'ahead' || !days.includes(String(or.day))) return fail('No order today has that code. Check the number with them.', 404, 'no_code');
    if (!or.paidAt) return fail('That order isn’t paid, so it isn’t being made. Take their order at the speaker instead.', 409, 'unpaid');
    // (A delivery goes out with a driver from the counter, never with a car in the lane.)
    if (or.ahead?.way === 'delivery') return fail(`Order ${or.number} is being delivered, so it goes out from the counter.`, 409, 'delivery');
    if (or.status === 'done') return fail(`Order ${or.number} was picked up already.`, 409, 'done');
    // Already with another car: only while that car is still in the lane with it (one that left, or was taken off, frees it).
    const other: any = or.ahead?.carId && or.ahead.carId !== carRef.id ? (await tx.get(db.doc(`${T}/driveThruCars/${or.ahead.carId}`))).data() : null;
    if (other && other.stage !== 'gone' && (other.orderId === orderId || other.aheadId === orderId)) return fail(`Order ${or.number} is already with a car in the lane.`, 409, 'taken');
    const car: any = carId ? (await tx.get(carRef)).data() : null;
    if (carId && (!car || car.stage === 'gone')) return fail('That car isn’t in the lane any more.', 404);
    // Found again for the same car (a second tap): as it is.
    if (car && (car.orderId === orderId || car.aheadId === orderId)) return { ok: true, carId: carRef.id, number: or.number, name: or.guestName || null, linked: car.aheadId === orderId, already: true };
    const ownRef = car?.orderId ? db.doc(`${T}/counterOrders/${car.orderId}`) : null;
    const own: any = ownRef ? (await tx.get(ownRef)).data() : null;
    if (car) {
      // Only a car still ordering at the speaker: one whose order is with the kitchen has moved on (a new car for it).
      if (!own || own.status !== 'building') return fail('This car’s order is already with the kitchen. Start a new car for the order placed ahead.', 409, 'has_order');
      if (car.aheadId) return fail('This car already has an order placed ahead with it. Start a new car for this one.', 409, 'has_ahead');
    }
    const nowS = nowIso();
    if (car) {
      tx.set(carRef, { aheadId: orderId, aheadNumber: String(or.number || '') }, { merge: true });
      // Their name from the order placed ahead, for the board, the window and the kitchen, unless one was given here.
      if (!own.guestName && or.guestName) tx.set(ownRef, { guestName: or.guestName }, { merge: true });
      // …and their allergies (lib/order-allergy), shown on this screen while it's being taken, on whatever is added here.
      const had = orderAllergyOf(or); const both = had ? mergeAllergy(orderAllergyOf(own), had) : null;
      if (both && !sameAllergy(orderAllergyOf(own), both)) tx.set(ownRef, { allergy: { keys: both.keys, other: both.other, severe: both.severe, by: had!.by || 'The guest', at: had!.at || nowS, from: 'ahead' } }, { merge: true });
    } else tx.set(carRef, { id: carRef.id, arrivedAt: nowS, takenBy: who.name, day: days[0], number: or.number, orderId, stage: 'pickup', stageAt: { pickup: nowS }, ahead: true, inLine: false, ...(here || or.locationId ? { locationId: String(here || or.locationId) } : {}) }, { merge: true });
    tx.set(ref, { carId: carRef.id, ahead: { carId: carRef.id, hereAt: or.ahead?.hereAt || nowS } }, { merge: true });
    return { ok: true, carId: carRef.id, number: or.number, name: or.guestName || null, linked: !!car, carNumber: car ? String(car.number || '') : String(or.number || '') };
  });
  if (r.ok) { await startNow(db, tenantId, orderId); aheadChanged(tenantId); }
  return r;
}

/** "Nothing else": the car at the speaker came only for its order placed ahead. Its own order (nothing on it) is let go,
 *  and the car goes on to pickup with the order it paid for, under that order's number. Once they've added something,
 *  that goes to the kitchen and is paid at the window instead. */
export async function aheadNothingMore(db: any, tenantId: string, carId: string): Promise<any> {
  const T = `tenants/${tenantId}`;
  if (!ID.test(carId)) return fail('Which car?', 400);
  const carRef = db.doc(`${T}/driveThruCars/${carId}`);
  return db.runTransaction(async (tx: any) => {
    const car: any = (await tx.get(carRef)).data();
    if (!car || car.stage === 'gone') return fail('That car isn’t in the lane any more.', 404);
    // (A second tap: already on its way to pickup.)
    if (!car.aheadId) return car.ahead === true ? { ok: true, already: true, number: String(car.number || '') } : fail('This car has no order placed ahead with it.', 409, 'no_ahead');
    const ownRef = ID.test(String(car.orderId || '')) ? db.doc(`${T}/counterOrders/${car.orderId}`) : null;
    const own: any = ownRef ? (await tx.get(ownRef)).data() : null;
    if (own && (own.status !== 'building' || (own.lines || []).length)) return fail('They added something: send it to the kitchen, and it’s paid at the window.', 409, 'has_order');
    const nowS = nowIso();
    if (own) tx.set(ownRef, { status: 'voided', voidedAt: nowS, voidReason: 'Ordered ahead instead', carId: null }, { merge: true });
    tx.set(carRef, carryOn(car, nowS), { merge: true });
    return { ok: true, number: String(car.aheadNumber || car.number || '') };
  });
}

/** Orders placed ahead and not paid after 30 minutes are let go (the payment called off, the code free again); one paid
 *  that nobody heard about goes to the kitchen. (The payments sweep, lib/counter-card.) */
export async function sweepAhead(db: any, tenantId: string, tenant: any, or: any, orderId: string, o: { stripe?: any; now?: number } = {}): Promise<'paid' | 'abandoned' | null> {
  const st = String(or?.ahead?.state || ''); if (st !== 'awaiting_pay') return null;
  const now = o.now ?? Date.now();
  const age = now - (Date.parse(String(or.createdAt || '')) || now);
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  if (or.ahead.payId && acct && stripe) {
    const s: any = await settleAhead(db, tenantId, tenant, orderId, String(or.ahead.payId), { stripe }).catch(() => null);
    if (s?.ok && s.paid) return 'paid';
    if (s?.ok && s.notKept) return 'abandoned';
    if (s?.ok && s.pending && age >= UNPAID_MIN * 60000) {
      try { await stripe.paymentIntents.cancel(String(or.ahead.payId), {}, { stripeAccount: acct }); }
      catch { const again: any = await settleAhead(db, tenantId, tenant, orderId, String(or.ahead.payId), { stripe }).catch(() => null); if (again?.ok && again.paid) return 'paid'; if (!(again?.ok && again.canceled)) return null; }
    } else if (!(s?.ok && s.canceled) && age < UNPAID_MIN * 60000) return null;
    // One that keeps being refused (not for this order, say) is called off and let go after the same 30 minutes; the card
    // company unreachable just waits.
    else if (!s?.ok && (s?.status === 503 || !s)) return null;
    else if (!s?.ok) { try { await stripe.paymentIntents.cancel(String(or.ahead.payId), {}, { stripeAccount: acct }); } catch { return null; } }
  } else if (age < UNPAID_MIN * 60000) return null;
  // (A number given for a ready text goes with it: lib/ready-text.)
  await ref.set({ status: 'voided', voidedAt: nowIso(), voidReason: 'Not paid', cardOpen: false, ahead: { state: 'abandoned', ...(or.ahead?.delivery ? { delivery: { state: 'abandoned' } } : {}), ...(or.ahead?.later ? { later: { due: null, phone: null, wipeAfter: null } } : {}) }, ...(or.readyText?.to ? { readyText: { to: null, pendingSince: null } } : {}) }, { merge: true });
  if (or.ahead.code && or.day) await db.doc(`tenants/${tenantId}/aheadCodes/${or.day}_${or.ahead.code}`).delete().catch(() => null);
  return 'abandoned';
}

export { photoOf };
