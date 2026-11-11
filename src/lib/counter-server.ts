// src/lib/counter-server.ts — QUICK-SERVICE ORDERS, changed on the server (L21). One place for every change to an order,
// so the lane screen (api/counter) and the drive-thru's voice assistant (api/counter/assistant) can never take an order
// two different ways: a car at the speaker, a line added or changed (priced from the menu with its choices, lib/
// counter-orders), the order sent to the kitchen (one ticket a line, due by the lane's target, stock and recipe parts
// taken once), and an order voided when a car drives off without paying.
import { FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { lineFor, totalsOf, dueAt, orderNumber, CHANNEL_NAME, type Channel, type OrderLine } from '@/lib/counter-orders';
import { itemSoldOut, priceChoices, type Picks } from '@/lib/menu-choices';
import { isMenuItem } from '@/lib/menu-server';
import { buildEntry } from '@/lib/stock-ledger';
import { moveStock } from '@/lib/usage';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
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
export async function createCar(db: any, tenantId: string, tenant: any, carKey: unknown, who: Who): Promise<{ carId: string; orderId: string; number: string; already?: boolean }> {
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
    tx.set(carRef, { id: carRef.id, number, stage: 'speaker', arrivedAt: nowIso, stageAt: { speaker: nowIso }, orderId: orderRef.id, takenBy: who.name, day });
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
export async function sendOrder(db: any, tenantId: string, tenant: any, orderId: string, who: Who): Promise<{ ok: true; due: string | null; already?: boolean } | Fail> {
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
      if (num(it.totalStock) < qtyOf(ids[k])) return { error: num(it.totalStock) > 0 ? `Only ${num(it.totalStock)} ${String(it.name || 'of that')} left. Change the order first.` : `${String(it.name || 'That')} just ran out. Take it off the order first.`, status: 409 };
    }
    // …or one of the choices on a line ("no oat milk tonight"): that line is changed before it goes, never made wrong.
    for (const l of lines) {
      const picks: Record<string, string[]> = {};
      for (const c of Array.isArray(l.choices) ? l.choices : []) (picks[c.groupId] = picks[c.groupId] || []).push(c.optionId);
      const still = priceChoices(items[ids.indexOf(l.itemId)], picks);
      if (!still.ok) return { error: `${l.name}: ${still.error} Change that line, then send it.`, status: 409 };
    }
    // What a recipe uses (the milk and beans in a latte), read before anything is written.
    const parts: { ref: any; data: any; qty: number; forItem: string }[] = [];
    for (const [k, it] of items.entries()) {
      for (const f of Array.isArray(it.formula) ? it.formula : []) {
        // (A part that's also sold on this order is counted by its own line, never twice.)
        const pid = String(f?.id || ''); if (!ID.test(pid) || ids.includes(pid)) continue;
        const use = num(f.quantityUsed) * qtyOf(ids[k]); if (!(use > 0)) continue;
        const same = parts.find((p) => p.ref.id === pid); if (same) { same.qty += use; continue; }
        const pRef = db.doc(`${T}/inventory/${pid}`); const data = (await tx.get(pRef)).data();
        if (data) parts.push({ ref: pRef, data, qty: use, forItem: String(it.name || 'item') });
      }
    }
    const car: any = o.carId ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
    const channel = o.channel as Channel;
    const due = new Date(dueAt(channel, now.getTime(), lines, tenant)).toISOString();
    const who2 = ticketWho(o);
    lines.forEach((l, i) => {
      const tRef = db.doc(`${T}/kdsTickets/${orderId}_${l.lineId}`);
      tx.set(tRef, { id: tRef.id, source: channel, channel, orderId, orderNumber: o.number, menuItemId: l.itemId, menuItemName: l.name, quantity: l.quantity,
        choicesText: l.choicesText || null, guestName: who2, stationName: `${CHANNEL_NAME[channel] || 'Order'} ${o.number}`, status: 'pending', createdAt: nowIso, dueAt: due,
        line: i + 1, lines: lines.length, tenantId, stockMoved: true });
    });
    const why = `${CHANNEL_NAME[channel]} order ${o.number}`;
    for (const [k, it] of items.entries()) {
      const qty = qtyOf(ids[k]);
      tx.set(itemRefs[k], { totalStock: FieldValue.increment(-qty) }, { merge: true });
      tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: ids[k], type: 'sold', delta: -qty, unit: String(it.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId }, balanceAfter: num(it.totalStock) - qty }));
    }
    // The same step as the lounge's (lib/usage moveStock): a part with no uses or size set is left alone.
    const used: { id: string; qty: number }[] = [];
    for (const p of parts) {
      const m = moveStock(p.data, p.qty); if (m.notCounted) continue;
      tx.set(p.ref, m.patch, { merge: true }); used.push({ id: p.ref.id, qty: p.qty });
      tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: p.ref.id, type: 'used', delta: -p.qty, unit: String(p.data.unit || 'units'), reason: `${why}: ${p.forItem}`, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }));
    }
    tx.set(orderRef, { status: 'sent', sentAt: nowIso, sentBy: who.name, dueAt: due, partsUsed: used }, { merge: true });
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
    if (o.status === 'building') return { error: 'That order hasn’t gone to the kitchen. Use “The car left without ordering”.', status: 409 };
    // Only an order the kitchen got (and took stock for) is voided: nothing else ever puts stock back.
    if (o.status !== 'sent') return { error: 'That order can’t be voided now.', status: 409 };
    const tix = (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId))).docs;
    const car: any = o.carId ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
    const lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    // Lines the kitchen never started go back; the rest was made (or being made) and is waste.
    const back: Record<string, number> = {}; let returned = 0, wasted = 0;
    for (const l of lines) {
      const t: any = tix.find((d: any) => d.id === `${orderId}_${l.lineId}`)?.data();
      if (!t || t.status === 'pending' || t.status === 'cancelled') { back[l.itemId] = (back[l.itemId] || 0) + l.quantity; returned += l.quantity; } else wasted += l.quantity;
    }
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
    const why = `Voided ${CHANNEL_NAME[o.channel as Channel] || ''} order ${o.number}: ${reason}`.replace(/\s+/g, ' ');
    for (const [k, it] of items.entries()) {
      if (!it) continue;
      tx.set(db.doc(`${T}/inventory/${itemIds[k]}`), { totalStock: FieldValue.increment(back[itemIds[k]]) }, { merge: true });
      tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: itemIds[k], type: 'returned', delta: back[itemIds[k]], unit: String(it.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }));
    }
    for (const p of partBack) {
      const m = moveStock(p.data, -p.qty); if (m.notCounted) continue;
      tx.set(p.ref, m.patch, { merge: true });
      tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: p.ref.id, type: 'returned', delta: p.qty, unit: String(p.data.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }));
    }
    for (const d of tix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && t.status !== 'cancelled') tx.set(d.ref, { status: 'cancelled', cancelledAt: nowIso, cancelledBy: { name: who.name, via: 'lane' }, voided: true }, { merge: true }); }
    tx.set(orderRef, { status: 'voided', voidedAt: nowIso, voidedBy: who.name, voidedById: who.id, voidReason: reason, returnedQty: returned, wastedQty: wasted }, { merge: true });
    if (car && car.stage !== 'gone') tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'gone', goneAt: nowIso, left: true, voided: true, stageAt: { ...(car.stageAt || {}), gone: nowIso } }, { merge: true });
    return { ok: true, returned, wasted };
  });
}
