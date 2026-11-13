// src/lib/counter-server.ts — QUICK-SERVICE ORDERS, changed on the server (L21). One place for every change to an order,
// so the lane screen (api/counter) and the drive-thru's voice assistant (api/counter/assistant) can never take an order
// two different ways: a car at the speaker, a line added or changed (priced from the menu with its choices, lib/
// counter-orders), the order sent to the kitchen (one ticket a line, due by the lane's target, stock and recipe parts
// taken once), an order paid (cash, a card machine of the business's own, or the card reader at the window, lib/
// counter-card), and an order voided when a car drives off without paying.
import { FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { lineFor, totalsOf, dueAt, orderNumber, CHANNEL_NAME, type Channel, type OrderLine } from '@/lib/counter-orders';
import { itemSoldOut, priceChoices, type Picks } from '@/lib/menu-choices';
import { isMenuItem } from '@/lib/menu-server';
import { recipeOf, ingredientLeft, ingredientUnit } from '@/lib/menu-stock';
import { buildEntry } from '@/lib/stock-ledger';
import { moveStock } from '@/lib/usage';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
// A card payment the window's reader is asking for, or taking right now: nothing else may pay the order, or void it, until
// it's finished or stopped (lib/counter-card). One still being started counts for a minute.
const CARD_BUSY_STATES = ['on_reader', 'capturing'];
export const cardBusy = (o: any, now = Date.now()): boolean => {
  const c = o?.card; if (!c || typeof c !== 'object') return false;
  if (CARD_BUSY_STATES.includes(String(c.state))) return true;
  return c.state === 'starting' && now - (Date.parse(String(c.at || '')) || 0) < 60000;
};
const CARD_BUSY_WORDS = 'The card reader is asking for this order’s payment. Stop it on the lane first, then take it another way.';
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export type Who = { id: string | null; name: string };
type Fail = { error: string; status: number };

/** A guest's first name for the order, as said or typed: letters, spaces, apostrophes, periods and hyphens, up to 24. */
export function cleanName(v: unknown): string {
  const s = String(v ?? '').normalize('NFC').replace(/[^\p{L}\p{M}'\u2019 .-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!/\p{L}/u.test(s)) return '';
  return Array.from(s).slice(0, 24).join('').trim();
}
/** Who a kitchen ticket is for: "Sam, car B41" at the drive-thru (or "Car B41" with no name), the name elsewhere. */
export function ticketWho(o: any): string {
  const name = cleanName(o?.guestName);
  return o?.channel === 'drive-thru' ? (name ? `${name}, car ${o.number}` : `Car ${o.number}`) : String(o?.name || name || o?.number || 'Guest');
}

/** The name on an order, so the team can hand it over by name: kept on the order, and on its kitchen tickets if it's
 *  been sent already. An empty name takes it off. */
export async function setOrderName(db: any, tenantId: string, orderId: string, name: unknown): Promise<{ ok: true; name: string | null } | Fail> {
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  if (!ID.test(orderId)) return { error: 'Which order?', status: 400 };
  const clean = cleanName(name) || null;
  const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
    if (o.status === 'cancelled' || o.status === 'voided') return { error: 'That order was cancelled.', status: 409 };
    tx.set(orderRef, { guestName: clean, updatedAt: nowIso }, { merge: true });
    return { ok: true, sent: o.status !== 'building', o: { ...o, guestName: clean } };
  });
  if (r.error) return r;
  if (r.sent) {
    // From the order as it is now (two quick changes both end on the latest name), onto tickets that still exist.
    const now: any = (await orderRef.get()).data() || r.o;
    const snap = await db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId).get();
    await Promise.all(snap.docs.map((d: any) => d.ref.update({ guestName: ticketWho(now) }).catch(() => undefined)));
  }
  return { ok: true, name: clean };
}

/** A car at the speaker: the day's next number ("B42") and an empty order. The same carKey sent twice is the same car. */
/** A car in the lane, with its empty order. `inLine`: taken by someone walking the line before the speaker (the speaker
 *  never greets it, and the order board by the speaker never shows it), told apart by how it looks. */
export async function createCar(db: any, tenantId: string, tenant: any, carKey: unknown, who: Who, opts: { inLine?: boolean; looks?: string | null } = {}): Promise<{ carId: string; orderId: string; number: string; already?: boolean }> {
  const T = `tenants/${tenantId}`; const now = new Date(); const nowIso = now.toISOString();
  const day = todayIn(tenantTimeZone(tenant), now);
  const counterRef = db.doc(`${T}/orderCounters/${day}`);
  const k = KEY.test(String(carKey || '')) ? String(carKey) : null;
  const carRef = k ? db.doc(`${T}/driveThruCars/car_${k}`) : db.collection(`${T}/driveThruCars`).doc();
  const orderRef = db.collection(`${T}/counterOrders`).doc();
  return db.runTransaction(async (tx: any) => {
    const had: any = k ? (await tx.get(carRef)).data() : null;
    if (had) return { carId: carRef.id, orderId: had.orderId, number: had.number, already: true };
    const c: any = (await tx.get(counterRef)).data() || {};
    const n = Math.floor(num(c['drive-thru'])) + 1;
    const number = orderNumber('drive-thru', n);
    tx.set(counterRef, { 'drive-thru': n, day }, { merge: true });
    tx.set(orderRef, { id: orderRef.id, number, channel: 'drive-thru' as Channel, status: 'building', lines: [], subtotal: 0, tax: 0, total: 0, carId: carRef.id, createdAt: nowIso, createdBy: who.name, day });
    tx.set(carRef, { id: carRef.id, number, stage: 'speaker', arrivedAt: nowIso, stageAt: { speaker: nowIso }, orderId: orderRef.id, takenBy: who.name, day,
      ...(opts.inLine ? { inLine: true } : {}), ...(opts.looks ? { looks: opts.looks } : {}) });
    return { carId: carRef.id, orderId: orderRef.id, number };
  });
}

export type EditOp = { action: 'add'; itemId: string; quantity?: unknown; choices?: Picks | unknown; tapKey?: unknown }
  | { action: 'remove'; lineId: string; tapKey?: unknown } | { action: 'qty'; lineId: string; quantity: unknown; tapKey?: unknown };

/** One change to an order still being taken. One tap is one change, however many times it's sent (tapKey), and a tap
 *  that arrives after the order went to the kitchen is answered with the order as it is, not an error. */
export async function editOrder(db: any, tenantId: string, tenant: any, orderId: string, op: EditOp): Promise<{ order: any; line?: OrderLine } | Fail> {
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  if (!ID.test(orderId)) return { error: 'Which order?', status: 400 };
  const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
  const itemSnap = op.action === 'add' && ID.test(String(op.itemId || '')) ? await db.doc(`${T}/inventory/${String(op.itemId)}`).get() : null;
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
    let lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    const tapKey = KEY.test(String(op.tapKey || '')) ? String(op.tapKey) : null;
    const taps: string[] = Array.isArray(o.taps) ? o.taps.map(String) : [];
    const asIs = { order: { id: orderId, number: o.number, status: o.status, lines, subtotal: num(o.subtotal), tax: num(o.tax), taxLabel: o.taxLabel, total: num(o.total) } };
    if (tapKey && taps.includes(tapKey)) return asIs;
    if (o.status !== 'building') return { error: 'That order has gone to the kitchen already.', status: 409 };
    let line: OrderLine | undefined;
    if (op.action === 'add') {
      if (!itemSnap) return { error: 'Which item?', status: 400 };
      const made = lineFor(itemSnap.data(), String(op.itemId), op.quantity ?? 1, op.choices, randomBytes(5).toString('hex'));
      if (!made.ok) return { error: made.error, status: 400 };
      if (lines.length >= 40) return { error: 'That’s a big order. Send this one, and start another.', status: 400 };
      // The same item with the same choices is one line with more of it.
      const same = lines.find((l) => l.itemId === made.line.itemId && l.choicesText === made.line.choicesText && l.unitPrice === made.line.unitPrice);
      lines = same ? lines.map((l) => (l === same ? { ...l, quantity: Math.min(20, l.quantity + made.line.quantity) } : l)) : [...lines, made.line];
      line = same ? lines.find((l) => l.lineId === same.lineId) : made.line;
    } else {
      const lineId = String(op.lineId || ''); if (!lines.some((l) => l.lineId === lineId)) return { error: 'That isn’t on the order.', status: 404 };
      if (op.action === 'remove') lines = lines.filter((l) => l.lineId !== lineId);
      else { const q = Math.floor(num(op.quantity)); if (q < 1 || q > 20) return { error: 'How many? Between 1 and 20.', status: 400 }; lines = lines.map((l) => (l.lineId === lineId ? { ...l, quantity: q } : l)); }
    }
    const totals = totalsOf(tenant, lines);
    tx.set(orderRef, { lines, ...totals, updatedAt: nowIso, ...(tapKey ? { taps: [...taps, tapKey].slice(-30) } : {}) }, { merge: true });
    return { order: { id: orderId, number: o.number, status: o.status, lines, ...totals }, line };
  });
}

/** To the kitchen: one ticket a line, due by the lane's target (never sooner than the slowest item takes). Everything is
 *  checked again first (still on the menu, not sold out, its choices still there, enough in stock), and stock (the item
 *  and what its recipe uses) is taken once, here. */
/** `o.due`: when it's wanted (an order placed ahead for a time); `o.holdUntil`: the kitchen doesn't start before then (the
 *  tickets wait under Later on the kitchen screen until it's time, or until the guest says they're here). */
export async function sendOrder(db: any, tenantId: string, tenant: any, orderId: string, who: Who, opts: { due?: string | null; holdUntil?: string | null } = {}): Promise<{ ok: true; due: string | null; already?: boolean } | Fail> {
  const T = `tenants/${tenantId}`; const now = new Date(); const nowIso = now.toISOString();
  if (!ID.test(orderId)) return { error: 'Which order?', status: 400 };
  const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
    if (o.status !== 'building') return { ok: true, already: true, due: o.dueAt || null };
    const lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    if (!lines.length) return { error: 'Add something first.', status: 400 };
    const ids = Array.from(new Set(lines.map((l) => l.itemId)));
    const itemRefs = ids.map((id) => db.doc(`${T}/inventory/${id}`));
    const items = (await Promise.all(itemRefs.map((ref) => tx.get(ref)))).map((s: any) => s.data());
    const qtyOf = (id: string) => lines.filter((l) => l.itemId === id).reduce((n, l) => n + l.quantity, 0);
    for (const [k, it] of items.entries()) {
      if (!isMenuItem(it)) return { error: `${lines.find((l) => l.itemId === ids[k])?.name || 'Something'} isn’t on the menu any more. Take it off the order first.`, status: 409 };
      if (itemSoldOut(it)) return { error: `${String(it.name || 'Something')} just sold out. Take it off the order first.`, status: 409 };
      // Made from a recipe: its ingredients are what's counted (below), not the item itself (lib/menu-stock).
      if (recipeOf(it, ids[k]).length) continue;
      if (num(it.totalStock) < qtyOf(ids[k])) return { error: num(it.totalStock) > 0 ? `Only ${num(it.totalStock)} ${String(it.name || 'of that')} left. Change the order first.` : `${String(it.name || 'That')} just ran out. Take it off the order first.`, status: 409 };
    }
    // …or one of the choices on a line ("no oat milk tonight"): that line is changed before it goes, never made wrong.
    for (const l of lines) {
      const picks: Record<string, string[]> = {};
      for (const c of Array.isArray(l.choices) ? l.choices : []) (picks[c.groupId] = picks[c.groupId] || []).push(c.optionId);
      const still = priceChoices(items[ids.indexOf(l.itemId)], picks);
      if (!still.ok) return { error: `${l.name}: ${still.error} Change that line, then send it.`, status: 409 };
    }
    // What each line takes: an item without a recipe, its own count; one made from a recipe, its ingredients (the bun
    // and patty in a burger, the milk and beans in a latte). Kept on the order line by line, so a void puts back exactly
    // that. Every stock item is read once, before anything is written, even one that's both sold on its own line and an
    // ingredient of another (a bottled sauce): its own count and the recipe's share come off in one step.
    const docs = new Map<string, { ref: any; data: any }>(); ids.forEach((id, k) => docs.set(id, { ref: itemRefs[k], data: items[k] }));
    const lineTake: Record<string, { own: number; parts: Record<string, number> }> = {};
    const ownNeed = new Map<string, number>(); const partNeed = new Map<string, number>(); const partFor = new Map<string, string>();
    for (const l of lines) {
      const it = items[ids.indexOf(l.itemId)]; const recipe = recipeOf(it, l.itemId);
      const take = { own: recipe.length ? 0 : l.quantity, parts: {} as Record<string, number> };
      if (take.own) ownNeed.set(l.itemId, (ownNeed.get(l.itemId) || 0) + take.own);
      for (const f of recipe) {
        const use = f.quantityUsed * l.quantity; if (!(use > 0)) continue;
        take.parts[f.id] = (take.parts[f.id] || 0) + use;
        partNeed.set(f.id, (partNeed.get(f.id) || 0) + use); if (!partFor.has(f.id)) partFor.set(f.id, String(it.name || 'item'));
      }
      lineTake[l.lineId] = take;
    }
    for (const pid of partNeed.keys()) {
      if (docs.has(pid)) continue;
      const pRef = db.doc(`${T}/inventory/${pid}`); const data = (await tx.get(pRef)).data(); if (data) docs.set(pid, { ref: pRef, data });
    }
    // An ingredient that can't be counted (no size or uses set, put away, or a menu item made from its own recipe) is left
    // as it is; so is one no longer in stock at all.
    const countable = (pid: string) => { const d = docs.get(pid)?.data; return !!d && ingredientLeft(d) !== null && !moveStock(d, 0).notCounted; };
    // Not enough of an ingredient for the whole order: said now, before the kitchen starts on it.
    for (const [pid, need] of partNeed) {
      if (!countable(pid)) continue;
      const d = docs.get(pid)!.data; const after = ownNeed.has(pid) ? { ...d, totalStock: num(d.totalStock) - ownNeed.get(pid)! } : d;
      const left = ingredientLeft(after) ?? 0; if (left + 1e-9 >= need) continue;
      const what = String(d.name || 'an ingredient').replace(/\s+/g, ' ').trim().slice(0, 40);
      return { error: left > 0 ? `Not enough ${what} for this order (${Math.round(left * 100) / 100} ${ingredientUnit(d)} left). Change the order first, or count it in Inventory.` : `${what} ran out, so ${partFor.get(pid)} can’t be made. Take it off the order first, or count it in Inventory.`, status: 409 };
    }
    const car: any = o.carId ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
    const channel = o.channel as Channel;
    const asap = dueAt(channel, now.getTime(), lines, tenant); const wanted = Date.parse(String(opts.due || ''));
    const due = new Date(Number.isFinite(wanted) && wanted > asap ? wanted : asap).toISOString();
    const hold = Date.parse(String(opts.holdUntil || '')); const holdUntil = Number.isFinite(hold) && hold > now.getTime() ? new Date(hold).toISOString() : null;
    const who2 = ticketWho(o);
    lines.forEach((l, i) => {
      const tRef = db.doc(`${T}/kdsTickets/${orderId}_${l.lineId}`);
      tx.set(tRef, { id: tRef.id, source: channel, channel, orderId, orderNumber: o.number, menuItemId: l.itemId, menuItemName: l.name, quantity: l.quantity,
        choicesText: l.choicesText || null, guestName: who2, stationName: `${CHANNEL_NAME[channel] || 'Order'} ${o.number}`, status: 'pending', createdAt: nowIso, dueAt: due,
        line: i + 1, lines: lines.length, tenantId, stockMoved: true, ...(holdUntil ? { holdUntil, requestedAt: holdUntil } : {}) });
    });
    const why = `${CHANNEL_NAME[channel]} order ${o.number}`;
    // Taken: each stock item once (lib/usage moveStock for an ingredient, as the lounge does), with a line in the stock
    // ledger for what was sold and what was used.
    const used: { id: string; qty: number }[] = []; const itemsTaken: string[] = [];
    for (const [id, d] of docs) {
      const own = ownNeed.get(id) || 0; const part = countable(id) ? partNeed.get(id) || 0 : 0;
      if (!own && !part) continue;
      const after = { ...d.data, totalStock: num(d.data.totalStock) - own };
      if (part) tx.set(d.ref, moveStock(after, part).patch, { merge: true });
      else tx.set(d.ref, { totalStock: FieldValue.increment(-own) }, { merge: true });
      if (own) {
        itemsTaken.push(id);
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: id, type: 'sold', delta: -own, unit: String(d.data.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId }, balanceAfter: num(d.data.totalStock) - own }));
      }
      if (part) {
        used.push({ id, qty: part });
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: id, type: 'used', delta: -part, unit: String(d.data.unit || 'units'), reason: `${why}: ${partFor.get(id)}`, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }));
      }
    }
    // What each line took, as taken (an ingredient that couldn't be counted took nothing).
    const stockTaken: Record<string, { own: number; parts: Record<string, number> }> = {};
    for (const [lineId, t] of Object.entries(lineTake)) stockTaken[lineId] = { own: t.own, parts: Object.fromEntries(Object.entries(t.parts).filter(([pid]) => countable(pid))) };
    tx.set(orderRef, { status: 'sent', sentAt: nowIso, sentBy: who.name, dueAt: due, partsUsed: used, itemsTaken, stockTaken }, { merge: true });
    if (car && car.stage === 'speaker') tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'pay', stageAt: { ...(car.stageAt || {}), pay: nowIso } }, { merge: true });
    return { ok: true, due };
  });
}

/** A sent order that won't be paid (the car drove off): voided by a manager, with the reason kept. The car leaves the
 *  lane, the kitchen stops on it, and what the kitchen hadn't started goes back on the shelf (the item and its recipe
 *  parts); anything already started or made is kept as waste on the order. Never once it's paid (that's a refund). */
export async function voidOrder(db: any, tenantId: string, orderId: string, reason: string, who: Who): Promise<{ ok: true; returned: number; wasted: number; already?: boolean } | Fail> {
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  if (!ID.test(orderId)) return { error: 'Which order?', status: 400 };
  const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
    if (o.status === 'voided' || o.status === 'cancelled') return { ok: true, already: true, returned: 0, wasted: 0 };
    if (o.paidAt) return { error: 'That order is paid. Refund it at the desk instead.', status: 409 };
    if (cardBusy(o)) return { error: CARD_BUSY_WORDS, status: 409 };
    if (o.status === 'building') return { error: 'That order hasn’t gone to the kitchen. Use “The car left without ordering”.', status: 409 };
    // Only an order the kitchen got (and took stock for) is voided: nothing else ever puts stock back.
    if (o.status !== 'sent') return { error: 'That order can’t be voided now.', status: 409 };
    const tix = (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId))).docs;
    const car: any = o.carId ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
    const lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    // Lines the kitchen never started go back; the rest was made (or being made) and is waste.
    const back: Record<string, number> = {}; const goesBack = new Set<string>(); let returned = 0, wasted = 0;
    for (const l of lines) {
      const t: any = tix.find((d: any) => d.id === `${orderId}_${l.lineId}`)?.data();
      if (!t || t.status === 'pending' || t.status === 'cancelled') { back[l.itemId] = (back[l.itemId] || 0) + l.quantity; returned += l.quantity; goesBack.add(l.lineId); } else wasted += l.quantity;
    }
    const why = `Voided ${CHANNEL_NAME[o.channel as Channel] || ''} order ${o.number}: ${reason}`.replace(/\s+/g, ' ');
    const log = (id: string, d: any, delta: number) => tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: id, type: 'returned', delta, unit: String(d.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }));
    if (o.stockTaken && typeof o.stockTaken === 'object') {
      // Exactly what each line that goes back took at sending (its own count, or its ingredients), each stock item put
      // back once.
      const own = new Map<string, number>(); const part = new Map<string, number>();
      for (const l of lines) {
        if (!goesBack.has(l.lineId)) continue;
        const t: any = o.stockTaken[l.lineId]; if (!t) continue;
        if (num(t.own) > 0 && ID.test(l.itemId)) own.set(l.itemId, (own.get(l.itemId) || 0) + num(t.own));
        for (const [pid, q] of Object.entries<any>(t.parts || {})) if (ID.test(pid) && num(q) > 0) part.set(pid, (part.get(pid) || 0) + num(q));
      }
      const idsBack = Array.from(new Set([...own.keys(), ...part.keys()]));
      const snaps = await Promise.all(idsBack.map((id) => tx.get(db.doc(`${T}/inventory/${id}`))));
      idsBack.forEach((id, k) => {
        const d: any = snaps[k].data(); if (!d) return;
        const o1 = own.get(id) || 0; const p1 = part.get(id) || 0;
        const ref = db.doc(`${T}/inventory/${id}`);
        // (An ingredient that can't be counted any more is left as it is, and nothing is logged for it.)
        const m = p1 ? moveStock({ ...d, totalStock: num(d.totalStock) + o1 }, -p1) : null; const partBack = !!m && !m.notCounted;
        if (partBack) tx.set(ref, m!.patch, { merge: true });
        else if (o1) tx.set(ref, { totalStock: FieldValue.increment(o1) }, { merge: true });
        if (o1) log(id, d, o1);
        if (partBack) log(id, d, p1);
      });
    } else {
      // An order sent before each line's take was kept: as it was worked out then.
      // Only what was taken goes back: an item's own count if it was taken at sending (an order sent before recipes were
      // counted took every item's), and the ingredients used (below).
      const taken: string[] | null = Array.isArray(o.itemsTaken) ? o.itemsTaken.map(String) : null;
      const itemIds = Object.keys(back).filter((id) => ID.test(id));
      const items = (await Promise.all(itemIds.map((id) => tx.get(db.doc(`${T}/inventory/${id}`))))).map((s: any) => s.data());
      // Recipe parts used at sending, given back in the same share as the lines that go back.
      const partBack: { ref: any; data: any; qty: number }[] = [];
      for (const [k, it] of items.entries()) {
        if (!it) continue;
        for (const f of Array.isArray(it.formula) ? it.formula : []) {
          const pid = String(f?.id || ''); if (!ID.test(pid) || itemIds.includes(pid)) continue;
          if (!(Array.isArray(o.partsUsed) && o.partsUsed.some((p: any) => p?.id === pid))) continue;
          const qty = num(f.quantityUsed) * back[itemIds[k]]; if (!(qty > 0)) continue;
          const same = partBack.find((p) => p.ref.id === pid); if (same) { same.qty += qty; continue; }
          const pRef = db.doc(`${T}/inventory/${pid}`); const data = (await tx.get(pRef)).data(); if (data) partBack.push({ ref: pRef, data, qty });
        }
      }
      for (const [k, it] of items.entries()) {
        if (!it || (taken && !taken.includes(itemIds[k]))) continue;
        tx.set(db.doc(`${T}/inventory/${itemIds[k]}`), { totalStock: FieldValue.increment(back[itemIds[k]]) }, { merge: true });
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: itemIds[k], type: 'returned', delta: back[itemIds[k]], unit: String(it.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }));
      }
      for (const p of partBack) {
        const m = moveStock(p.data, -p.qty); if (m.notCounted) continue;
        tx.set(p.ref, m.patch, { merge: true });
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: p.ref.id, type: 'returned', delta: p.qty, unit: String(p.data.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }));
      }
    }
    for (const d of tix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && t.status !== 'cancelled') tx.set(d.ref, { status: 'cancelled', cancelledAt: nowIso, cancelledBy: { name: who.name, via: 'lane' }, voided: true }, { merge: true }); }
    tx.set(orderRef, { status: 'voided', voidedAt: nowIso, voidedBy: who.name, voidedById: who.id, voidReason: reason, returnedQty: returned, wastedQty: wasted }, { merge: true });
    if (car && car.stage !== 'gone') tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'gone', goneAt: nowIso, left: true, voided: true, stageAt: { ...(car.stageAt || {}), gone: nowIso } }, { merge: true });
    return { ok: true, returned, wasted };
  });
}

export type PayHow = { method: 'card' | 'cash'; tendered?: number | null; by: string; byId?: string | null; card?: { id: string; cents: number } | null; pouch?: boolean; day?: string };
export type PayDone = { ok: true; already?: boolean; drawer?: boolean; pouch?: boolean; change?: number | null; payMethod: string; paidOtherwise?: boolean; cardId?: string | null };

/** Paid at the window: the sale and its tax in the books, cash into the one open drawer (with what was handed over and
 *  the change), and the car moves on to pick up — all in one step. Asking again changes nothing and says how it was
 *  paid. `card`: the reader's payment that pays it (lib/counter-card), which must be for exactly the order's total;
 *  when the order was paid another way first, nothing is written and `paidOtherwise` says so (that payment is given
 *  back by the caller). Cash or another card machine waits while the reader is asking for the card. `cardId` in the
 *  answer: a card payment that was started for the order and is now not needed (the caller calls it off). */
export async function payOrder(db: any, tenantId: string, orderId: string, how: PayHow): Promise<PayDone | (Fail & { code?: string })> {
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  if (!ID.test(orderId)) return { error: 'Which order?', status: 400 };
  const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
  const method = how.method; const tendered = method === 'cash' && how.tendered !== undefined && how.tendered !== null ? Math.round(Number(how.tendered) * 100) / 100 : null;
  if (tendered !== null && (!Number.isFinite(tendered) || tendered < 0 || tendered > 100000)) return { error: 'How much did they hand over?', status: 400 };
  const viaReader = !!how.card?.id;
  const res: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
    const car: any = o.carId ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
    // The drawer that's open now, read in the same step (a drawer closed mid-sale never takes the cash).
    const till = method === 'cash' ? (await tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))).docs : [];
    // Paid already (another tablet, or the first answer was lost): say how, and the change that was given.
    if (o.paidAt) {
      if (viaReader && o.cardPaymentId !== how.card!.id) return { ok: true, already: true, paidOtherwise: true, payMethod: o.payMethod || null };
      return { ok: true, already: true, change: o.changeGiven ?? null, payMethod: o.payMethod || null };
    }
    if (o.status !== 'sent' && o.status !== 'done') {
      if (viaReader && o.status === 'voided') return { ok: true, already: true, paidOtherwise: true, payMethod: null };
      return { error: o.status === 'voided' ? 'That order was voided.' : 'Send the order to the kitchen first.', status: 409 };
    }
    if (!viaReader && cardBusy(o)) return { error: CARD_BUSY_WORDS, status: 409, code: 'card_busy' };
    // A pouch is only for cash taken in line, from a car that was taken there.
    if (how.pouch && method === 'cash' && !(car?.inLine === true || car?.wasInLine === true)) return { error: 'Cash goes in a pouch only for a car taken in line. Take it at the window.', status: 409 };
    const total = num(o.total), subtotal = num(o.subtotal), tax = num(o.tax);
    if (viaReader && Math.round(how.card!.cents) !== Math.round(total * 100)) return { error: 'That card payment isn’t for this order’s total.', status: 409 };
    if (tendered !== null && tendered < total) return { error: `That’s less than the total ($${total.toFixed(2)}).`, status: 400 };
    const saleRef = db.doc(`${T}/transactions/counter_${orderId}`); const taxRef = db.doc(`${T}/transactions/counter_${orderId}_tax`);
    const common = { date: nowIso, type: 'income', context: 'Business', paymentMethod: method, hasReceipt: true, clientOrVendor: `${CHANNEL_NAME[o.channel as Channel]} ${o.number}`, orderId, channel: o.channel, tenantId,
      ...(viaReader ? { stripePaymentIntentId: how.card!.id } : {}) };
    tx.set(saleRef, { id: saleRef.id, ...common, description: `${CHANNEL_NAME[o.channel as Channel]} order ${o.number}`, category: 'Retail', amount: subtotal });
    if (tax > 0) tx.set(taxRef, { id: taxRef.id, ...common, description: o.taxLabel || 'Sales tax', category: 'Tax Collected', taxBucket: 'tax_collected', amount: tax, hasReceipt: false });
    // Cash goes into the one drawer that's open (two open, or none: it's kept on the order, for the drawer count); taken
    // in line, it goes into that person's own pouch, counted as theirs for the day.
    const pouch = method === 'cash' && how.pouch === true;
    const drawer = method === 'cash' && !pouch && till.length === 1 ? till[0].ref : null;
    if (drawer) tx.set(drawer, { expectedCash: FieldValue.increment(total), totalCashSales: FieldValue.increment(total) }, { merge: true });
    const change = tendered !== null ? Math.round((tendered - total) * 100) / 100 : null;
    // A reader payment started for it and not the one paying (declined, left, or the guest paid on their phone instead):
    // called off by the caller, so it can't go through later.
    const cardIsThis = viaReader && String(o.card?.id || '') === how.card!.id;
    const leftCard = o.card?.id && !cardIsThis && o.card.state !== 'stopped' && o.card.state !== 'paid' ? String(o.card.id) : null;
    tx.set(orderRef, { paidAt: nowIso, payMethod: method, paidBy: how.by, tillId: drawer ? drawer.id : null,
      // (Counted on the day it was taken, the business's day, whenever the car arrived.)
      ...(pouch ? { cashInPouch: true, pouchOpen: true, cashWith: how.by, cashWithId: how.byId || null, cashDay: how.day || o.day || null } : method === 'cash' && !drawer ? { cashNotInDrawer: true } : {}),
      ...(tendered !== null ? { cashTendered: tendered, changeGiven: change } : {}),
      ...(viaReader ? { cardPaymentId: how.card!.id } : {}),
      ...(cardIsThis ? { card: { ...(o.card || {}), state: 'paid', paidAt: nowIso, failed: null }, cardOpen: false } : {}),
      ...(leftCard ? { card: { ...(o.card || {}), state: 'stopping' }, cardOpen: true } : {}) }, { merge: true });
    if (car && (car.stage === 'speaker' || car.stage === 'pay')) tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'pickup', stageAt: { ...(car.stageAt || {}), pickup: nowIso } }, { merge: true });
    return { ok: true, drawer: !!drawer, pouch, change, payMethod: method, cardId: leftCard };
  });
  // Points for a guest who gave their number (lib/counter-points): once it's paid, once.
  if (res?.ok && !res.already) { try { const P = await import('@/lib/counter-points'); await P.earnForOrder(db, tenantId, null, orderId); } catch (e: any) { console.error('[counter] points not earned', orderId, e?.message); } }
  return res;
}
