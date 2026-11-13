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
import { lineFor, totalsOf, orderNumber, photoOf, type OrderLine } from '@/lib/counter-orders';
import { readMenu, type MenuItem } from '@/lib/menu-server';
import { sendOrder, payOrder, cleanName } from '@/lib/counter-server';
import { giveBack } from '@/lib/counter-card';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { loyaltyOf } from '@/lib/loyalty';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const SLOT_MIN = 15, FIRST_SLOT_MIN = 20, UNPAID_MIN = 30, MAX_LINES = 30;
const nowIso = () => new Date().toISOString();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const centsOf = (n: unknown) => Math.round(num(n) * 100);
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
const secret = () => String(process.env.ORDER_TRACK_SECRET || process.env.RETAIL_QR_SECRET || process.env.CRON_SECRET || '');
export type AheadWay = 'drive-thru' | 'inside';

/** The business's order-ahead settings: whether it's on, how guests can pick up, and how far ahead (hours) they can order. */
export function aheadOf(tenant: any) {
  const a = tenant?.orderAhead || {};
  const hours = Math.floor(num(a.laterHours));
  const ways: AheadWay[] = [...(a.driveThru !== false ? ['drive-thru' as const] : []), ...(a.inside !== false ? ['inside' as const] : [])];
  return { on: a.on === true && ways.length > 0, ways: ways.length ? ways : (['inside'] as AheadWay[]), laterHours: hours >= 0 && hours <= 12 ? (a.laterHours === undefined ? 3 : hours) : 3 };
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

/** The pickup times offered: as soon as it's ready (null), then every 15 minutes from 20 minutes out, for `laterHours`,
 *  today only (in the business's own time zone: an order and its code belong to one day). */
export function pickupTimes(tenant: any, now = Date.now()): string[] {
  const { laterHours } = aheadOf(tenant); if (!laterHours) return [];
  const step = SLOT_MIN * 60000; const tz = tenantTimeZone(tenant); const today = todayIn(tz, new Date(now));
  const first = Math.ceil((now + FIRST_SLOT_MIN * 60000) / step) * step;
  const out: string[] = [];
  for (let t = first; t <= now + laterHours * 3600000; t += step) { if (todayIn(tz, new Date(t)) !== today) break; out.push(new Date(t).toISOString()); }
  return out;
}

/** What a guest sees of one item (only what's on the menu for everyone; sold out says so). */
const guestItem = (m: MenuItem) => ({ id: m.id, name: m.name, section: m.section, words: m.words, price: m.price, from: m.from, startPrice: m.startPrice, imageUrl: m.imageUrl,
  choices: m.choices, soldOut: m.soldOut || !m.inStock });

/** Today and yesterday in the business's own time zone: an order placed just before midnight is still picked up after. */
function openDays(tenant: any, now = Date.now()): string[] {
  const tz = tenantTimeZone(tenant); const today = todayIn(tz, new Date(now)); const before = todayIn(tz, new Date(now - 86400000));
  return today === before ? [today] : [today, before];
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
  for (const m of menu) { let s = sections.find((x) => x.name === m.section); if (!s) sections.push((s = { name: m.section, items: [] })); s.items.push(guestItem(m)); }
  const payments = !!accountOf(tenant) && !!process.env.STRIPE_SECRET_KEY && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && !!secret();
  // The rewards program, when it's on: the page asks for a phone number (and, for a program you join, whether they want to).
  const L = loyaltyOf(tenant);
  return { ok: true as const, on: payments, business, ways: A.ways, times: pickupTimes(tenant), sections, timeZone: tenantTimeZone(tenant), // (Joining is always asked on this page: a number typed here could be anyone's, so no one is added without saying yes.)
    points: L.on ? { unit: L.earn?.mode === 'punch' ? 'punches' : 'points', askJoin: true } : null };
}

/** Place an order (not paid yet) and start its payment. Opened again with the same key (a refresh, a second tap), it's the
 *  same order and the same payment. */
export async function placeAhead(db: any, tenantId: string, tenant: any, b: { key?: unknown; lines?: unknown; name?: unknown; way?: unknown; at?: unknown; phone?: unknown; join?: unknown }, o: { stripe?: any; now?: number } = {}): Promise<any> {
  const A = aheadOf(tenant);
  if (!A.on) return fail('Ordering ahead isn’t on here right now.', 409, 'off');
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe || !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || !secret()) return fail('Paying online isn’t set up here yet.', 409, 'no_payments');
  const key = String(b.key || ''); if (!KEY.test(key)) return fail('Something went wrong. Try again.', 400);
  const name = cleanName(b.name); if (!name) return fail('What name should we put on the order?', 400, 'name');
  const way = String(b.way || '') as AheadWay; if (!A.ways.includes(way)) return fail('How will you pick it up?', 400, 'way');
  const now = o.now ?? Date.now();
  let at: string | null = null;
  if (b.at) {
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
    const r = lineFor(it, id, (l as any)?.quantity, (l as any)?.choices, `l${k + 1}`);
    if (!r.ok) return fail(`${m.name}: ${r.error}`, 409, 'line');
    want.set(id, (want.get(id) || 0) + r.line.quantity);
    lines.push(r.line);
  }
  for (const [id, q] of want) {
    const m = menu.get(id)!;
    if (m.soldOut || !m.inStock) return fail(`${m.name} just sold out. Take it off and try again.`, 409, 'sold_out');
    if (m.canMake !== null && m.canMake < q) return fail(m.canMake > 0 ? `Only ${m.canMake} ${m.name} left. Change your order and try again.` : `${m.name} just sold out. Take it off and try again.`, 409, 'sold_out');
  }
  // A phone number for points (optional): kept with the order, and the order is theirs once it's paid.
  const phone = String(b.phone ?? '').replace(/\D/g, '').slice(-10);
  if (b.phone && phone.length !== 10) return fail('A 10-digit phone number for points, or leave it empty.', 400, 'phone');
  const money = totalsOf(tenant, lines); const cents = centsOf(money.total);
  if (cents < 50) return fail('Orders paid online start at $0.50.', 400, 'too_small');
  const day = todayIn(tenantTimeZone(tenant), new Date(now));
  // The same order only for the same key AND the same details: changed after going back (another pickup way, time,
  // name or item), it's a new order, never the old one paid for.
  const what = JSON.stringify({ lines: lines.map((l) => [l.itemId, l.quantity, l.choicesText || '']), name, way, at, phone });
  const orderRef = db.doc(`${T}/counterOrders/ahead_${createHash('sha256').update(`${tenantId}/${key}/${what}`).digest('hex').slice(0, 32)}`);
  const orderId = orderRef.id;
  const made: any = await db.runTransaction(async (tx: any) => {
    const had: any = (await tx.get(orderRef)).data();
    if (had) return { had };
    // A pickup code nobody else has today (tried a few times; 9,000 to choose from).
    let code = ''; const counterRef = db.doc(`${T}/orderCounters/${day}`);
    const c: any = (await tx.get(counterRef)).data() || {};
    for (let i = 0; i < 8 && !code; i++) { const try1 = String(randomInt(1000, 10000)); const cRef = db.doc(`${T}/aheadCodes/${day}_${try1}`); if (!(await tx.get(cRef)).exists) code = try1; }
    if (!code) return { busy: true };
    const n = Math.floor(num(c.ahead)) + 1; const number = orderNumber('ahead', n);
    tx.set(counterRef, { ahead: n, day }, { merge: true });
    tx.set(db.doc(`${T}/aheadCodes/${day}_${code}`), { orderId, at: nowIso() });
    tx.set(orderRef, { id: orderId, number, channel: 'ahead', status: 'building', lines, ...money, guestName: name, createdAt: new Date(now).toISOString(), createdBy: 'Ordered ahead', day,
      ahead: { state: 'awaiting_pay', way, at, code, cents, payId: null, ...(phone && loyaltyOf(tenant).on ? { pointsPhone: phone, pointsJoin: b.join === true } : {}) } });
    return { number, code };
  });
  if (made.busy) return fail('Something went wrong. Try again.', 503);
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
  return { ok: true, orderId, sig: aheadSig(tenantId, orderId), number: cur.number, total: num(cur.total), paid: false,
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
        ...(x.status === 'building' && !x.paidAt ? { status: 'voided', voidedAt: nowIso(), voidReason: why } : {}) }, { merge: true });
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
  const sent: any = await sendOrder(db, tenantId, tenant, orderId, { id: null, name: 'Ordered ahead' }, { due: Number.isFinite(wanted) ? new Date(wanted).toISOString() : null, holdUntil: or.ahead?.hereAt ? null : holdUntil });
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
export async function aheadView(db: any, tenantId: string, tenant: any, orderId: string) {
  const or: any = (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data();
  if (!or || or.channel !== 'ahead') return fail('This order isn’t here.', 404);
  // A day on, the page says only that it's done (the guest's name and order aren't shown to anyone after that).
  if (Date.now() - (Date.parse(String(or.createdAt || '')) || 0) > 24 * 3600000) return fail('This order is done.', 410);
  const tickets = (await db.collection(`tenants/${tenantId}/kdsTickets`).where('orderId', '==', orderId).get()).docs.map((d: any) => d.data() || {});
  const live = tickets.filter((t: any) => t.status !== 'cancelled' && t.status !== 'voided');
  const held = live.some((t: any) => t.status === 'pending' && t.holdUntil && Date.parse(t.holdUntil) > Date.now());
  const ready = live.length > 0 && live.every((t: any) => ['ready', 'delivered', 'served', 'done'].includes(String(t.status)));
  // Handed over: at the drive-thru window (the order's done), or inside, when the kitchen screen marks it picked up.
  const handed = or.status === 'done' || (live.length > 0 && live.every((t: any) => ['delivered', 'served', 'done'].includes(String(t.status))));
  const state = String(or.ahead?.state || '');
  return {
    ok: true as const, business: String(tenant?.name || tenant?.businessName || '').slice(0, 80), number: String(or.number || ''), name: or.guestName || null,
    state, paid: !!or.paidAt, code: or.paidAt ? String(or.ahead?.code || '') : null, way: (or.ahead?.way || 'inside') as AheadWay, at: or.ahead?.at || null,
    kitchen: !or.paidAt ? null : handed ? 'handed' : ready ? 'ready' : held ? 'later' : 'making',
    here: !!or.ahead?.hereAt, failed: state === 'canceled' ? String(or.ahead?.failed || '') || null : null,
    // Points this order earned (never their balance: a page anyone with the link can open).
    earned: Math.max(0, Math.floor(num(or.points?.earned))), unit: loyaltyOf(tenant).earn?.mode === 'punch' ? 'punches' : 'points',
    lines: (or.lines || []).map((l: any) => ({ name: String(l.name || ''), quantity: num(l.quantity), choicesText: l.choicesText || null, price: Math.round(num(l.unitPrice) * num(l.quantity) * 100) / 100, imageUrl: l.imageUrl || null })),
    subtotal: num(or.subtotal), tax: num(or.tax), total: num(or.total),
  };
}

/** The guest says they're here (in the drive-thru line, or inside): the kitchen starts now if it was waiting. */
export async function aheadHere(db: any, tenantId: string, orderId: string): Promise<{ ok: true; already?: boolean } | Fail> {
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const r: any = await db.runTransaction(async (tx: any) => {
    const or: any = (await tx.get(ref)).data(); if (!or || or.channel !== 'ahead') return fail('This order isn’t here.', 404);
    if (!or.paidAt) return fail('This order isn’t paid yet.', 409);
    if (or.ahead?.hereAt) return { ok: true, already: true };
    tx.set(ref, { ahead: { hereAt: nowIso() } }, { merge: true }); return { ok: true };
  });
  if (!r.ok || r.already) return r;
  await startNow(db, tenantId, orderId);
  return { ok: true };
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
    .map((o: any) => ({ id: o.id, number: String(o.number || ''), name: o.guestName || null, code: String(o.ahead?.code || ''), at: o.ahead?.at || null, hereAt: o.ahead?.hereAt || null,
      items: (o.lines || []).reduce((n: number, l: any) => n + num(l.quantity), 0), total: num(o.total), summary: (o.lines || []).slice(0, 3).map((l: any) => `${num(l.quantity)} ${String(l.name || '')}`).join(', ') }))
    .sort((a: any, b: any) => Number(!!b.hereAt) - Number(!!a.hereAt) || String(a.hereAt || a.at || '9').localeCompare(String(b.hereAt || b.at || '9')));
  laneCache.set(tenantId, { at: now, rows }); if (laneCache.size > 500) laneCache.delete(laneCache.keys().next().value as string);
  return rows;
}
/** Something changed (an order placed ahead went to a car, or was paid): the lane's list is read again. */
export const aheadChanged = (tenantId: string) => { laneCache.delete(tenantId); };

/** At the speaker: "I ordered ahead, code 4821." The order becomes the car's (the car's own empty order is let go), the
 *  car goes straight to pickup, and the kitchen starts if it was waiting. Without a car on screen, one is made for it. */
export async function aheadToCar(db: any, tenantId: string, tenant: any, b: { orderId?: unknown; code?: unknown; carId?: unknown }, who: { id: string | null; name: string }): Promise<any> {
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
    if (or.status === 'done') return fail(`Order ${or.number} was picked up already.`, 409, 'done');
    // Already with another car: only while that car is still in the lane with it (one that left, or was taken off, frees it).
    const other: any = or.ahead?.carId && or.ahead.carId !== carRef.id ? (await tx.get(db.doc(`${T}/driveThruCars/${or.ahead.carId}`))).data() : null;
    if (other && other.stage !== 'gone' && other.orderId === orderId) return fail(`Order ${or.number} is already with a car in the lane.`, 409, 'taken');
    const car: any = carId ? (await tx.get(carRef)).data() : null;
    if (carId && (!car || car.stage === 'gone')) return fail('That car isn’t in the lane any more.', 404);
    let emptyRef: any = null;
    if (car && car.orderId && car.orderId !== orderId) {
      const mine: any = (await tx.get(db.doc(`${T}/counterOrders/${car.orderId}`))).data();
      // Only a car that hasn't ordered anything yet takes it: an order already started there stays as it is.
      if (mine && (mine.status !== 'building' || (mine.lines || []).length)) return fail('This car already has an order. Start a new car for the order placed ahead.', 409, 'has_order');
      if (mine) emptyRef = db.doc(`${T}/counterOrders/${car.orderId}`);
    }
    const nowS = nowIso();
    if (emptyRef) tx.set(emptyRef, { status: 'voided', voidedAt: nowS, voidReason: 'Ordered ahead instead', carId: null }, { merge: true });
    tx.set(carRef, { ...(car ? {} : { id: carRef.id, arrivedAt: nowS, takenBy: who.name, day: days[0] }), number: or.number, orderId, stage: 'pickup', stageAt: { ...(car?.stageAt || {}), pickup: nowS }, ahead: true, inLine: false }, { merge: true });
    tx.set(ref, { carId: carRef.id, ahead: { carId: carRef.id, hereAt: or.ahead?.hereAt || nowS } }, { merge: true });
    return { ok: true, carId: carRef.id, number: or.number, name: or.guestName || null };
  });
  if (r.ok) { await startNow(db, tenantId, orderId); aheadChanged(tenantId); }
  return r;
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
  await ref.set({ status: 'voided', voidedAt: nowIso(), voidReason: 'Not paid', cardOpen: false, ahead: { state: 'abandoned' } }, { merge: true });
  if (or.ahead.code && or.day) await db.doc(`tenants/${tenantId}/aheadCodes/${or.day}_${or.ahead.code}`).delete().catch(() => null);
  return 'abandoned';
}

export { photoOf };
