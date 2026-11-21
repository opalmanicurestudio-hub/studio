// src/lib/counter-server.ts — QUICK-SERVICE ORDERS, changed on the server (L21). One place for every change to an order,
// so the lane screen (api/counter) and the drive-thru's voice assistant (api/counter/assistant) can never take an order
// two different ways: a car at the speaker, a line added or changed (priced from the menu with its choices, lib/
// counter-orders), the order sent to the kitchen (one ticket a line, due by the lane's target, stock and recipe parts
// taken once), an order paid (cash, a card machine of the business's own, or the card reader at the window, lib/
// counter-card), and an order voided when a car drives off without paying.
import { dayKey } from '@/lib/business-locations';
import { appName, appBooksOn, appWeekId, payoutWeek } from '@/lib/app-orders';
import { cleanLineNote, cleanOrderAllergy, mergeAllergy, orderAllergyOf, sameAllergy, sameNote, ticketFields, OTHER_KEEP, OTHER_MAX } from '@/lib/order-allergy';
import { cleanKeys, itemAllergens, ticketAllergyPatch } from '@/lib/allergens';
import { FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { lineFor, makeSecondsOf, partsOfLine, totalsOf, dueAt, orderNumber, carryOn, CHANNEL_NAME, type Channel, type OrderLine } from '@/lib/counter-orders';
import { itemSoldOut, picksOf, priceChoices, type Picks } from '@/lib/menu-choices';
import { isMenuItem } from '@/lib/menu-server';
import { nextSize, offerOf, sizedUp, upgradesOf } from '@/lib/menu-upgrades';
import { recipeOf, ingredientLeft, ingredientUnit, needsOf, type RecipeLine } from '@/lib/menu-stock';
import { madeWith } from '@/lib/choice-recipe';
import { extrasOf, itemExtras, modeOf, orderExtras } from '@/lib/plate-extras';
import { buildEntry } from '@/lib/stock-ledger';
import { moveStock } from '@/lib/usage';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { alsoAtOf, partName, partTicketId, type AlsoAt } from '@/lib/two-stations';
import { stationOfItem, stationsOf } from '@/lib/table-service';

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
/** Who a kitchen ticket is for: "Sam, car B41" at the drive-thru (or "Car B41" with no name), "Maria, C14" at the
 *  counter (or "C14"), "Kim, K7" from a kiosk, the name elsewhere. */
export function ticketWho(o: any): string {
  const name = cleanName(o?.guestName);
  if ((o?.channel === 'counter' || o?.channel === 'kiosk') && o?.number) return name ? `${name}, ${o.number}` : String(o.number);
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
export async function createCar(db: any, tenantId: string, tenant: any, carKey: unknown, who: Who, opts: { inLine?: boolean; looks?: string | null; channel?: Channel; lane?: 1 | 2 | null; app?: boolean; locationId?: string | null } = {}): Promise<{ carId: string; orderId: string; number: string; already?: boolean }> {
  // A guest at the counter is the same kind of place in line as a car (ordering, paying, waiting, handed over), numbered
  // as a counter order ("C14").
  const channel: Channel = opts.channel === 'counter' ? 'counter' : 'drive-thru';
  const T = `tenants/${tenantId}`; const now = new Date(); const nowIso = now.toISOString();
  const day = todayIn(tenantTimeZone(tenant), now);
  // With more than one location (lib/here-server): stamped with the screen's, and numbered at that location ("C1" at each).
  const here = opts.locationId && /^[A-Za-z0-9_-]{1,160}$/.test(opts.locationId) ? opts.locationId : null;
  const counterRef = db.doc(`${T}/orderCounters/${dayKey(day, here)}`);
  const k = KEY.test(String(carKey || '')) ? String(carKey) : null;
  const carRef = k ? db.doc(`${T}/driveThruCars/car_${k}`) : db.collection(`${T}/driveThruCars`).doc();
  const orderRef = db.collection(`${T}/counterOrders`).doc();
  return db.runTransaction(async (tx: any) => {
    const had: any = k ? (await tx.get(carRef)).data() : null;
    if (had) return { carId: carRef.id, orderId: had.orderId, number: had.number, already: true };
    const c: any = (await tx.get(counterRef)).data() || {};
    const n = Math.floor(num(c[channel])) + 1;
    const number = orderNumber(channel, n);
    tx.set(counterRef, { [channel]: n, day }, { merge: true });
    tx.set(orderRef, { id: orderRef.id, number, channel, status: 'building', lines: [], subtotal: 0, tax: 0, total: 0, carId: carRef.id, createdAt: nowIso, createdBy: who.name, day, ...(here ? { locationId: here } : {}),
      // A delivery app's order being rung in at the counter (lib/app-orders): which app and its code come when it's sent.
      ...(opts.app && channel === 'counter' ? { app: { state: 'taking' } } : {}) });
    tx.set(carRef, { id: carRef.id, number, stage: 'speaker', arrivedAt: nowIso, stageAt: { speaker: nowIso }, orderId: orderRef.id, takenBy: who.name, day, channel, ...(here ? { locationId: here } : {}),
      ...(opts.inLine ? { inLine: true } : {}), ...(opts.looks ? { looks: opts.looks } : {}),
      // The ordering lane it pulled up to, with two that merge (lib/drive-lanes); never for one taken in line.
      ...(opts.lane && !opts.inLine && channel === 'drive-thru' ? { lane: opts.lane } : {}) });
    return { carId: carRef.id, orderId: orderRef.id, number };
  });
}

export type EditOp = { action: 'add'; itemId: string; quantity?: unknown; choices?: Picks | unknown; tapKey?: unknown; offer?: unknown; note?: unknown }
  | { action: 'remove'; lineId: string; tapKey?: unknown } | { action: 'qty'; lineId: string; quantity: unknown; tapKey?: unknown }
  | { action: 'sizeUp'; lineId: string; quantity?: unknown; tapKey?: unknown }
  | { action: 'note'; lineId: string; note: unknown; tapKey?: unknown };

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
      const made = lineFor(itemSnap.data(), String(op.itemId), op.quantity ?? 1, op.choices, randomBytes(5).toString('hex'), { tenant });
      if (!made.ok) return { error: made.error, status: 400 };
      if (lines.length >= 40) return { error: 'That’s a big order. Send this one, and start another.', status: 400 };
      // Taken as an offer, right after something else was added (components/menu/OfferAsk): marked only where another
      // line's item offers it (lib/menu-upgrades offerOf), for how often offers are taken. Prices never depend on it.
      if (op.offer === 'item') {
        const others = Array.from(new Set(lines.map((l) => l.itemId).filter((id) => id !== made.line.itemId))).slice(0, 40);
        const docs = await Promise.all(others.map((id) => tx.get(db.doc(`${T}/inventory/${id}`))));
        if (offerOf('item', { id: made.line.itemId }, {}, docs.map((d: any, k: number) => ({ id: others[k], upgrades: d.data()?.upgrades }))) === 'item') made.line.offer = 'item';
      }
      // A note for the kitchen about this dish (lib/order-allergy): a line of its own unless another has the same note.
      const note = cleanLineNote(op.note); if (note) made.line.note = note;
      // The same item with the same choices (and the same note) is one line with more of it (taken as an offer stays marked).
      const same = lines.find((l) => l.itemId === made.line.itemId && l.choicesText === made.line.choicesText && l.unitPrice === made.line.unitPrice && sameNote(l.note, made.line.note));
      lines = same ? lines.map((l) => (l === same ? { ...l, quantity: Math.min(20, l.quantity + made.line.quantity), ...(l.offer || made.line.offer ? { offer: l.offer || made.line.offer } : {}) } : l)) : [...lines, made.line];
      line = same ? lines.find((l) => l.lineId === same.lineId) : made.line;
    } else if (op.action === 'sizeUp') {
      // The next size up, for what was just added (`quantity` of the line, at most all of it): only when its item offers a
      // size up (lib/menu-upgrades), priced from the menu like any line. The rest of the line stays as it was.
      const old = lines.find((l) => l.lineId === String(op.lineId || '')); if (!old) return { error: 'That isn’t on the order.', status: 404 };
      const it: any = (await tx.get(db.doc(`${T}/inventory/${old.itemId}`))).data();
      const picks = picksOf(old.choices);
      const up = it && upgradesOf(it.upgrades, old.itemId).size ? nextSize(it, picks) : null;
      if (!up) return { error: `There’s no bigger size of ${old.name} to offer.`, status: 409 };
      const q = Math.min(old.quantity, Math.max(1, Math.floor(num(op.quantity)) || old.quantity));
      const made = lineFor(it, old.itemId, q, sizedUp(picks, up), randomBytes(5).toString('hex'), { tenant });
      if (!made.ok) return { error: made.error, status: 400 };
      made.line.offer = 'size';
      // (Its note goes with it.)
      if (old.note) made.line.note = old.note;
      // Into a line already in that size, only when all of them fit (20 on a line: one tap is all of it or nothing); a new
      // line only while the order has room for one.
      const same = lines.find((l) => l !== old && l.itemId === made.line.itemId && l.choicesText === made.line.choicesText && l.unitPrice === made.line.unitPrice && sameNote(l.note, made.line.note));
      if (same && same.quantity + q > 20) return { error: 'That’s as many as one line takes. Send this one, and start another.', status: 400 };
      if (!same && old.quantity > q && lines.length >= 40) return { error: 'That’s a big order. Send this one, and start another.', status: 400 };
      made.line.quantity = q;
      const at = lines.indexOf(old);
      let rest = lines.map((l) => (l === old ? { ...l, quantity: l.quantity - q } : l));
      if (same) rest = rest.map((l) => (l.lineId === same.lineId ? { ...l, quantity: l.quantity + q, offer: l.offer || 'size' } : l));
      else rest.splice(at + 1, 0, made.line);   // just after the line it came from, where the team is looking
      lines = rest.filter((l) => l.quantity > 0);
      line = same ? lines.find((l) => l.lineId === same.lineId) : made.line;
    } else {
      const lineId = String(op.lineId || ''); if (!lines.some((l) => l.lineId === lineId)) return { error: 'That isn’t on the order.', status: 404 };
      if (op.action === 'remove') lines = lines.filter((l) => l.lineId !== lineId);
      else if (op.action === 'note') { const note = cleanLineNote(op.note); lines = lines.map((l) => { if (l.lineId !== lineId) return l; const { note: _was, ...rest } = l; return note ? { ...rest, note } : rest; }); }
      else { const q = Math.floor(num(op.quantity)); if (q < 1 || q > 20) return { error: 'How many? Between 1 and 20.', status: 400 }; lines = lines.map((l) => (l.lineId === lineId ? { ...l, quantity: q } : l)); }
    }
    const totals = totalsOf(tenant, lines);
    tx.set(orderRef, { lines, ...totals, updatedAt: nowIso, ...(tapKey ? { taps: [...taps, tapKey].slice(-30) } : {}) }, { merge: true });
    return { order: { id: orderId, number: o.number, status: o.status, lines, ...totals }, line };
  });
}

/** The guest's allergies on an order (lib/order-allergy): the major ones, another in their words, and whether it's severe.
 *  While it's being taken: set, or none clears them; every ticket carries them once it's sent. Once sent (said at the
 *  window): added to the tickets still being made, and the kitchen taps Allergy noted again. */
export async function setAllergy(db: any, tenantId: string, orderId: string, raw: unknown, who: Who, opts: { add?: boolean } = {}): Promise<{ ok: true; allergy: any; tickets: number; already?: boolean } | Fail> {
  if (!ID.test(orderId)) return { error: 'Which order?', status: 400 };
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
    // (What a screen sends is kept as long as what's on the order already, when that came from more than one place.)
    const kept = String(orderAllergyOf(o)?.other || '').length;
    const a = cleanOrderAllergy(raw, opts.add ? OTHER_KEEP : Math.min(OTHER_KEEP, Math.max(OTHER_MAX, kept)));
    const allergy = a ? { ...a, by: String(who.name || 'Counter').slice(0, 60), at: new Date().toISOString() } : null;
    if (o.status === 'building') {
      // `add` (the voice assistant, what it heard): added to what's on the order, read here, so a save on the counter
      // screen at the same moment is never lost. Otherwise: as the screen has it.
      if (opts.add) {
        if (!a) return { error: 'What are they allergic to?', status: 400 };
        const had = orderAllergyOf(o); const m = mergeAllergy(had, a);
        if (!m || m.cut) return { error: 'That’s more than fits on the order. Tell the kitchen the rest.', status: 400 };
        if (had && sameAllergy(had, m)) return { ok: true, allergy: had, tickets: 0, already: true };
        const next = { keys: m.keys, other: m.other, severe: m.severe, by: allergy!.by, at: allergy!.at };
        tx.set(ref, { allergy: next, updatedAt: new Date().toISOString() }, { merge: true }); return { ok: true, allergy: next, tickets: 0 };
      }
      tx.set(ref, { allergy, updatedAt: new Date().toISOString() }, { merge: true }); return { ok: true, allergy, tickets: 0 };
    }
    // Sent already (the guest said it at the window): only added to, never taken off, and only while something is still
    // being made. The tickets not out yet carry it, and the kitchen taps Allergy noted again (lib/allergens).
    if (!a) return { error: 'The kitchen has it already. Tell the kitchen if it was a mistake.', status: 409 };
    if (o.status !== 'sent') return { error: 'That order is finished. Tell the kitchen.', status: 409 };
    const had = orderAllergyOf(o);
    const m = mergeAllergy(had, a);
    if (m?.cut) return { error: 'That’s more than fits on the order. Tell the kitchen the rest.', status: 400 };
    if (!m || (had && sameAllergy(had, m))) return { ok: true, allergy: had, tickets: 0, already: true };
    const merged = { keys: m.keys, other: m.other, severe: m.severe, by: allergy!.by, at: allergy!.at };
    const tix = (await tx.get(db.collection(`tenants/${tenantId}/kdsTickets`).where('orderId', '==', orderId))).docs;
    const ids = Array.from(new Set(tix.map((d: any) => String(d.data()?.menuItemId || '')).filter((x: string) => ID.test(x))));
    const items = await Promise.all(ids.map((id) => tx.get(db.doc(`tenants/${tenantId}/inventory/${id}`))));
    const itemOf = new Map(ids.map((id, k) => [id, items[k].data() || {}]));
    let changed = 0;
    for (const d of tix) {
      const t: any = d.data() || {}; const patch = ticketAllergyPatch(t, [{ id: 'order', seat: null, keys: merged.keys, other: merged.other, severe: merged.severe, from: 'asked', by: merged.by, at: merged.at }], null, itemAllergens(itemOf.get(String(t.menuItemId || '')) || {}));
      // (One already ready goes back to being made: it isn't ready to hand over, take out or deliver until the kitchen
      // taps Allergy noted and marks it ready again.)
      if (patch) { tx.set(d.ref, { ...patch, ...(t.status === 'ready' ? { status: 'in_progress', readyAt: null, backFromReady: 'allergy' } : {}) }, { merge: true }); changed++; }
    }
    if (!changed) return { error: 'Nothing for it is still being made. Tell the kitchen.', status: 409 };
    tx.set(ref, { allergy: merged, updatedAt: new Date().toISOString() }, { merge: true });
    return { ok: true, allergy: merged, tickets: changed };
  });
}

/** To the kitchen: one ticket a line, due by the lane's target (never sooner than the slowest item takes). Everything is
 *  checked again first (still on the menu, not sold out, its choices still there, enough in stock), and stock (the item
 *  and what its recipe uses) is taken once, here. */
/** `o.due`: when it's wanted (an order placed ahead for a time); `o.holdUntil`: the kitchen doesn't start before then (the
 *  tickets wait under Later on the kitchen screen until it's time, or until the guest says they're here). `o.unpaid`: a
 *  kiosk's order, paid on its card reader next (lib/kiosk): its stock is taken now, so nothing runs out while the guest
 *  pays, but its tickets are 'unpaid' and no kitchen screen, printer or board shows them until payOrder lets them go. */
export async function sendOrder(db: any, tenantId: string, tenant: any, orderId: string, who: Who, opts: { due?: string | null; holdUntil?: string | null; toGo?: boolean; unpaid?: boolean } = {}): Promise<{ ok: true; due: string | null; already?: boolean } | Fail> {
  const T = `tenants/${tenantId}`; const now = new Date(); const nowIso = now.toISOString();
  if (!ID.test(orderId)) return { error: 'Which order?', status: 400 };
  const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
    // (An order for another day waits as 'scheduled' until its day: lib/ahead-days-server sends it then.)
    if (o.status !== 'building' && o.status !== 'scheduled') return { ok: true, already: true, due: o.dueAt || null };
    // (One being canceled, its money on the way back, never goes to the kitchen.)
    if (o.status === 'scheduled' && o.ahead?.later?.cancel) return { error: 'That order is being canceled.', status: 409 };
    const lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    if (!lines.length) return { error: 'Add something first.', status: 400 };
    // Something added at the speaker to an order placed ahead: the guest's allergies on that order go on this one too
    // (lib/order-allergy), when this one has none of its own.
    const withCar: any = ID.test(String(o.carId || '')) ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
    const aheadOrder: any = withCar && ID.test(String(withCar.aheadId || '')) ? (await tx.get(db.doc(`${T}/counterOrders/${withCar.aheadId}`))).data() : null;
    const aheadAllergy = aheadOrder ? orderAllergyOf(aheadOrder) : null;
    // (Both, when this one has its own too: every allergen in either.)
    const joined = aheadAllergy ? mergeAllergy(orderAllergyOf(o), aheadAllergy) : null;
    // (Never dropped: every allergen and severe from both, and as many of their words as an order keeps.)
    const fromAhead = joined && !sameAllergy(orderAllergyOf(o), joined) ? { keys: joined.keys, other: joined.other, severe: joined.severe, by: aheadAllergy!.by || 'The guest', at: aheadAllergy!.at || nowIso } : null;
    const lineIds = Array.from(new Set(lines.map((l) => l.itemId)));
    const lineRefs = lineIds.map((id) => db.doc(`${T}/inventory/${id}`));
    const lineItems = (await Promise.all(lineRefs.map((ref) => tx.get(ref)))).map((s: any) => s.data());
    for (const [k, it] of lineItems.entries()) {
      if (!isMenuItem(it)) return { error: `${lines.find((l) => l.itemId === lineIds[k])?.name || 'Something'} isn’t on the menu any more. Take it off the order first.`, status: 409 };
      if (itemSoldOut(it)) return { error: `${String(it.name || 'Something')} just sold out. Take it off the order first.`, status: 409 };
    }
    // What's made: each line as itself, or a combo as its parts (lib/counter-orders partsOfLine), each its own stock and
    // its own ticket at its own station.
    const lineItem = (l: OrderLine) => lineItems[lineIds.indexOf(l.itemId)];
    const made = lines.flatMap((l) => partsOfLine(l, lineItem(l)).map((itemId, n, all) => ({ l, itemId, n, of: all.length, combo: lineItem(l)?.combo === true })));
    const ids = Array.from(new Set(made.map((m) => m.itemId)));
    const itemRefs = ids.map((id) => db.doc(`${T}/inventory/${id}`));
    const items = (await Promise.all(itemRefs.map((ref, k) => (lineIds.includes(ids[k]) ? Promise.resolve({ data: () => lineItems[lineIds.indexOf(ids[k])] }) : tx.get(ref))))).map((s: any) => s.data());
    const qtyOf = (id: string) => made.filter((m) => m.itemId === id).reduce((n, m) => n + m.l.quantity, 0);
    for (const [k, it] of items.entries()) {
      if (!it || it.archived === true || it.isActive === false) return { error: `Part of ${made.find((m) => m.itemId === ids[k])?.l.name || 'an order line'} isn’t on the menu any more. Take it off the order first.`, status: 409 };
      if (itemSoldOut(it)) return { error: `${String(it.name || 'Something')} just sold out. Take it off the order first.`, status: 409 };
      // Made from a recipe: its ingredients are what's counted (below), not the item itself (lib/menu-stock).
      if (recipeOf(it, ids[k]).length) continue;
      if (num(it.totalStock) < qtyOf(ids[k])) return { error: num(it.totalStock) > 0 ? `Only ${num(it.totalStock)} ${String(it.name || 'of that')} left. Change the order first.` : `${String(it.name || 'That')} just ran out. Take it off the order first.`, status: 409 };
    }
    // …or one of the choices on a line ("no oat milk tonight"): that line is changed before it goes, never made wrong.
    for (const l of lines) {
      const picks: Record<string, string[]> = {};
      for (const c of Array.isArray(l.choices) ? l.choices : []) (picks[c.groupId] = picks[c.groupId] || []).push(c.optionId);
      const still = priceChoices(lineItem(l), picks);
      if (!still.ok) return { error: `${l.name}: ${still.error} Change that line, then send it.`, status: 409 };
    }
    // What each line takes: an item without a recipe, its own count; one made from a recipe, its ingredients (the bun
    // and patty in a burger, the milk and beans in a latte). Kept on the order line by line, so a void puts back exactly
    // that. Every stock item is read once, before anything is written, even one that's both sold on its own line and an
    // ingredient of another (a bottled sauce): its own count and the recipe's share come off in one step.
    const docs = new Map<string, { ref: any; data: any }>(); ids.forEach((id, k) => docs.set(id, { ref: itemRefs[k], data: items[k] }));
    // (`extras`: the share of `parts` that went out with it, set once, so a void can say what it puts back of each.)
    type PartTake = { item: string; items: Record<string, number>; parts: Record<string, number>; extras: Record<string, number> };
    const lineTake: Record<string, { own: number; parts: Record<string, number>; items: Record<string, number>; extras: Record<string, number>; byPart: Record<string, PartTake> }> = {};
    const ownNeed = new Map<string, number>(); const partNeed = new Map<string, number>(); const partFor = new Map<string, string>();
    // What's made, line by line: the recipe as the guest chose it (oat milk instead of whole, an extra shot:
    // lib/choice-recipe); a combo's part as it comes. Each ingredient's amount is worked out once its record is read
    // (a kitchen measure turned into what it's counted in, more for what trimming and cooking lose: lib/kitchen-units).
    // What goes out with each, set once (a box for a main to go, a lid on a hot drink: lib/plate-extras), for here or to
    // go; and with the order (a bag). Taken with the line (a void puts it back), never what stops an order.
    const extras = extrasOf(tenant); const toGo = opts.toGo === true || o.toGo === true; const mode = modeOf(o.channel, toGo);
    const toTake: { l: OrderLine; take: (typeof lineTake)[string]; pt: PartTake | null; lines: RecipeLine[]; extra: RecipeLine[] }[] = [];
    for (const m of made) {
      const l = m.l; const it = items[ids.indexOf(m.itemId)]; const recipe = recipeOf(it, m.itemId);
      const take = lineTake[l.lineId] || { own: 0, parts: {} as Record<string, number>, items: {} as Record<string, number>, extras: {} as Record<string, number>, byPart: {} as Record<string, PartTake> };
      // A combo's part: what it took kept part by part too, so a void puts back exactly the parts the kitchen never
      // started (the drink, when the burger is already on the grill).
      const pt: PartTake | null = m.combo ? (take.byPart[String(m.n)] = take.byPart[String(m.n)] || { item: m.itemId, items: {}, parts: {}, extras: {} }) : null;
      // A combo's part without a recipe comes off its own count, kept with the line by item (so a void puts it back).
      if (!recipe.length) {
        if (m.combo) take.items[m.itemId] = (take.items[m.itemId] || 0) + l.quantity; else take.own += l.quantity;
        if (pt) pt.items[m.itemId] = (pt.items[m.itemId] || 0) + l.quantity;
        ownNeed.set(m.itemId, (ownNeed.get(m.itemId) || 0) + l.quantity);
      }
      const lines = m.combo ? recipe : madeWith(it, m.itemId, picksOf(l.choices)); const extra = itemExtras(extras, it, mode);
      if (lines.length || extra.length) toTake.push({ l, take, pt, lines, extra });
      for (const f of lines) if (!partFor.has(f.id)) partFor.set(f.id, String(it.name || 'item'));
      lineTake[l.lineId] = take;
    }
    const withOrder = orderExtras(extras, mode);
    for (const pid of Array.from(new Set([...toTake.flatMap((x) => [...x.lines, ...x.extra].map((f) => f.id)), ...withOrder.map((f) => f.id)]))) {
      if (docs.has(pid) || !/^[A-Za-z0-9_-]{1,160}$/.test(pid)) continue;
      const pRef = db.doc(`${T}/inventory/${pid}`); const data = (await tx.get(pRef)).data(); if (data) docs.set(pid, { ref: pRef, data });
    }
    const partData = new Map<string, any>(Array.from(docs.entries()).map(([id, d]) => [id, d.data]));
    const extraNeed = new Map<string, number>();
    for (const x of toTake) for (const [list, into] of [[x.lines, partNeed], [x.extra, extraNeed]] as [RecipeLine[], Map<string, number>][]) for (const [pid, need] of needsOf(list, partData)) {
      const use = Math.round(need * x.l.quantity * 1000) / 1000; if (!(use > 0)) continue;
      x.take.parts[pid] = (x.take.parts[pid] || 0) + use; if (x.pt) x.pt.parts[pid] = (x.pt.parts[pid] || 0) + use;
      if (into === extraNeed) { x.take.extras[pid] = (x.take.extras[pid] || 0) + use; if (x.pt) x.pt.extras[pid] = (x.pt.extras[pid] || 0) + use; }
      into.set(pid, Math.round(((into.get(pid) || 0) + use) * 1000) / 1000);
    }
    const extrasTaken: Record<string, number> = {};
    for (const [pid, need] of needsOf(withOrder, partData)) { extraNeed.set(pid, Math.round(((extraNeed.get(pid) || 0) + need) * 1000) / 1000); extrasTaken[pid] = need; }
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
    // Each ticket: a line (or a combo's part) at its own station, and a part of it made at another station (lib/two-stations).
    const stations = stationsOf(tenant);
    const tickets = made.flatMap((m) => {
      const it = items[ids.indexOf(m.itemId)]; const base = `${orderId}_${m.l.lineId}${m.combo ? `_${m.n}` : ''}`;
      const also = it && it.combo !== true ? alsoAtOf(it, stations) : [];
      return [{ m, id: base, also: null as AlsoAt | null, main: base }, ...also.map((a, k) => ({ m, id: partTicketId(base, k), also: a as AlsoAt | null, main: base }))];
    });
    const allergy = fromAhead || orderAllergyOf(o);
    if (fromAhead) tx.set(orderRef, { allergy: { ...fromAhead, from: 'ahead' } }, { merge: true });
    tickets.forEach(({ m, id, also, main }, i) => {
      const l = m.l; const part = m.combo ? items[ids.indexOf(m.itemId)] : null; const it = items[ids.indexOf(m.itemId)];
      const dish = part ? String(part.name || 'Item').slice(0, 80) : l.name;
      const tRef = db.doc(`${T}/kdsTickets/${id}`);
      // A combo's part: its own name and make time, with the combo it's part of ("Burger meal"), at its own station.
      tx.set(tRef, { id: tRef.id, source: channel, channel, orderId, orderNumber: o.number, menuItemId: m.itemId, menuItemName: also ? partName(dish, also.part) : dish, quantity: l.quantity,
        choicesText: part ? l.name : l.choicesText || null, ...(!part && !also && Array.isArray(l.choices) && l.choices.length ? { choices: l.choices } : {}), ...(part ? { comboLineId: l.lineId } : {}),
        ...(also ? { madeAt: also.station, partOf: main, partFor: dish, partFrom: stationOfItem(it || {}, stations) } : alsoAtOf(it || {}, stations).length && it?.combo !== true ? { alsoAt: alsoAtOf(it, stations) } : {}),
        guestName: who2, stationName: o.app?.code ? `${appName(o.app)}${o.app.shelf ? `, shelf ${o.app.shelf}` : ''}` : `${o.ahead?.way === 'delivery' ? 'Delivery' : CHANNEL_NAME[channel] || 'Order'} ${o.number}`, status: opts.unpaid ? 'unpaid' : 'pending', createdAt: nowIso, dueAt: due, makeSeconds: part ? makeSecondsOf(part) : Number(l.makeSeconds) || null,
        line: i + 1, lines: tickets.length, tenantId, stockMoved: true, ...(holdUntil ? { holdUntil, requestedAt: holdUntil } : {}),
        // (Made at the order's location, with more than one: that location's kitchen screen shows it. lib/here-server)
        ...(o.locationId ? { locationId: String(o.locationId) } : {}),
        // The guest's allergies on every ticket, with what the menu says this dish contains of them; the dish's note on
        // its own tickets (lib/order-allergy).
        ...ticketFields(allergy, part || it || {}), ...(l.note ? { note: l.note } : {}) });
    });
    const why = `${CHANNEL_NAME[channel]} order ${o.number}`;
    // An extra that was only partly there: each line's (and the order's) share of it cut to what came off.
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    const shrinkOne = (t: { parts: Record<string, number>; extras: Record<string, number> }, pid: string, r: number) => {
      const e = t.extras[pid]; if (!e) return; t.parts[pid] = r3((t.parts[pid] || 0) - e * (1 - r)); t.extras[pid] = r3(e * r);
      if (!(t.parts[pid] > 0)) delete t.parts[pid]; if (!(t.extras[pid] > 0)) delete t.extras[pid];
    };
    const shrinkExtra = (pid: string, r: number) => {
      for (const t of Object.values(lineTake)) { shrinkOne(t, pid, r); for (const x of Object.values(t.byPart)) shrinkOne(x, pid, r); }
      if (extrasTaken[pid]) { extrasTaken[pid] = r3(extrasTaken[pid] * r); if (!(extrasTaken[pid] > 0)) delete extrasTaken[pid]; }
    };
    // Taken: each stock item once (lib/usage moveStock for an ingredient, as the lounge does), with a line in the stock
    // ledger for what was sold and what was used.
    const used: { id: string; qty: number }[] = []; const itemsTaken: string[] = [];
    for (const [id, d] of docs) {
      const own = ownNeed.get(id) || 0; const part = countable(id) ? partNeed.get(id) || 0 : 0; const extra = countable(id) ? extraNeed.get(id) || 0 : 0;
      if (!own && !part && !extra) continue;
      const after = { ...d.data, totalStock: num(d.data.totalStock) - own };
      // What went out with it is only what was there (the recipe's share was checked above; a box that's run out isn't):
      // kept as taken, so a void never puts back more than came off.
      let extraMoved = extra;
      if (part || extra) { const mv = moveStock(after, Math.round((part + extra) * 1000) / 1000); tx.set(d.ref, mv.patch, { merge: true }); if (extra && mv.shortfall > 0) extraMoved = Math.max(0, Math.round((extra - mv.shortfall) * 1000) / 1000); }
      else tx.set(d.ref, { totalStock: FieldValue.increment(-own) }, { merge: true });
      if (extraMoved < extra) shrinkExtra(id, extra > 0 ? extraMoved / extra : 0);
      if (own) {
        itemsTaken.push(id);
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: id, type: 'sold', delta: -own, unit: String(d.data.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId }, balanceAfter: num(d.data.totalStock) - own }));
      }
      if (part) {
        used.push({ id, qty: part });
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: id, type: 'used', delta: -part, unit: String(d.data.unit || 'units'), reason: `${why}: ${partFor.get(id)}`, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }));
      }
      // What went out with it (set once: a box, a lid, a bag), on a line of its own, marked so a report can tell it apart.
      if (extraMoved > 0) tx.set(db.collection(`${T}/stockCorrections`).doc(), { ...buildEntry({ productId: id, type: 'used', delta: -extraMoved, unit: String(d.data.unit || 'units'), reason: `${why}: what goes out with it`, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }), extra: true });
    }
    // What each line took, as taken (an ingredient that couldn't be counted took nothing).
    const stockTaken: Record<string, { own: number; parts: Record<string, number>; items?: Record<string, number>; extras?: Record<string, number>; byPart?: Record<string, Partial<PartTake>> }> = {};
    const counted = (x: Record<string, number>) => Object.fromEntries(Object.entries(x).filter(([pid]) => countable(pid)));
    const some = (x: Record<string, number>) => (Object.keys(counted(x)).length ? { extras: counted(x) } : {});
    for (const [lineId, t] of Object.entries(lineTake)) stockTaken[lineId] = { own: t.own, parts: counted(t.parts), ...(Object.keys(t.items).length ? { items: t.items } : {}), ...some(t.extras),
      ...(Object.keys(t.byPart).length ? { byPart: Object.fromEntries(Object.entries(t.byPart).map(([n, x]) => [n, { item: x.item, items: x.items, parts: counted(x.parts), ...some(x.extras) }])) } : {}) };
    tx.set(orderRef, { status: 'sent', sentAt: nowIso, sentBy: who.name, dueAt: due, partsUsed: used, itemsTaken, stockTaken, toGo: mode === 'togo', ...(Object.keys(extrasTaken).length ? { extrasTaken: counted(extrasTaken) } : {}) }, { merge: true });
    // The day's count of each item sent to the kitchen (the menu board's Popular tags): one small document a day, on the
    // business's day it was sent. What's sold, not net sales: a void or refund later doesn't take it off.
    // (A kiosk's order is counted once it's paid: payOrder.)
    const sDay = todayIn(tenantTimeZone(tenant), now);
    if (!opts.unpaid) tx.set(db.doc(`${T}/menuSales/${sDay}`), { day: sDay, ...soldCounts(lines) }, { merge: true });
    if (car && car.stage === 'speaker') tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'pay', stageAt: { ...(car.stageAt || {}), pay: nowIso } }, { merge: true });
    return { ok: true, due };
  });
}

/** The day's count of each item on an order, to add to that day's menuSales (the menu board's Popular tags). */
function soldCounts(lines: OrderLine[]): Record<string, any> {
  const qty = new Map<string, number>();
  for (const l of lines) { const id = String(l.itemId || ''); if (!ID.test(id)) continue; qty.set(`n_${id}`, (qty.get(`n_${id}`) || 0) + num(l.quantity)); }
  const sold: Record<string, any> = {}; for (const [k, q] of qty) if (q > 0) sold[k] = FieldValue.increment(q);
  return sold;
}

/** A staff meal (design canvas "Food numbers"): a sent order settled with no money, for a named member of the team, so
 *  what it took off stock is on the books as a staff meal and not a mystery (lib/food-cost). Never a sale: no money is
 *  booked, the night's sales leave it out (lib/night-close-server), and the food cost report counts it apart. Once only;
 *  never one that's paid, voided, or on a card reader. */
export async function staffMeal(db: any, tenantId: string, orderId: string, forName: unknown, who: Who, approver?: Who): Promise<{ ok: true; already?: boolean; for: string } | Fail> {
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  if (!ID.test(orderId)) return { error: 'Which order?', status: 400 };
  const name = cleanName(forName); if (!name) return { error: 'Who is it for? Type their first name.', status: 400 };
  const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
    if (o.staffMeal) return { ok: true, already: true, for: String(o.staffMeal.for || name) };
    if (o.paidAt) return { error: 'That order is paid already.', status: 409 };
    if (o.status !== 'sent' && o.status !== 'done') return { error: o.status === 'voided' ? 'That order was voided.' : 'Send the order to the kitchen first.', status: 409 };
    if (cardBusy(o)) return { error: CARD_BUSY_WORDS, status: 409 };
    if (o.reward) return { error: 'A reward is on this order. Take it off first.', status: 409 };
    const car: any = o.carId ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
    tx.set(orderRef, { paidAt: nowIso, payMethod: 'staff', staffMeal: { for: name, by: who.name, byId: who.id || null, at: nowIso, ...(approver ? { approvedBy: approver.name, approvedById: approver.id || null } : {}) }, updatedAt: nowIso }, { merge: true });
    // Settled: it waits to be handed over, like a paid order.
    if (car && (car.stage === 'speaker' || car.stage === 'pay')) tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'pickup', stageAt: { ...(car.stageAt || {}), pickup: nowIso } }, { merge: true });
    return { ok: true, for: name };
  });
}

/** A sent order that won't be paid (the car drove off): voided by a manager, with the reason kept. The car leaves the
 *  lane, the kitchen stops on it, and what the kitchen hadn't started goes back on the shelf (the item and its recipe
 *  parts); anything already started or made is kept as waste on the order. Never once it's paid (that's a refund). */
export async function voidOrder(db: any, tenantId: string, orderId: string, reason: string, who: Who, opts: { nothingMade?: boolean } = {}): Promise<{ ok: true; returned: number; wasted: number; already?: boolean } | (Fail & { code?: string })> {
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  if (!ID.test(orderId)) return { error: 'Which order?', status: 400 };
  const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
  let gaveBack: string | null = null;
  const res = await db.runTransaction(async (tx: any) => {
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
    const wastedItems: Record<string, number> = {};   // what was made and thrown away, by item (lib/food-cost wasteOf)
    const untouched = (t: any) => !t || t.status === 'pending' || t.status === 'unpaid' || t.status === 'cancelled';
    // A combo's parts the kitchen never started, line by line ("0", "1"…), when what each took was kept part by part.
    const partsBack = new Map<string, Set<string>>();
    for (const l of lines) {
      const byPart: Record<string, any> | null = o.stockTaken?.[l.lineId]?.byPart && typeof o.stockTaken[l.lineId].byPart === 'object' ? o.stockTaken[l.lineId].byPart : null;
      if (byPart) {
        const ok = new Set<string>(); let made = false;
        for (const [n, x] of Object.entries<any>(byPart)) {
          if (untouched(tix.find((d: any) => d.id === `${orderId}_${l.lineId}_${n}`)?.data())) ok.add(n);
          else { made = true; const pid = String(x?.item || ''); if (ID.test(pid)) wastedItems[pid] = (wastedItems[pid] || 0) + l.quantity; }
        }
        partsBack.set(l.lineId, ok);
        if (made) wasted += l.quantity; else { returned += l.quantity; goesBack.add(l.lineId); }
        continue;
      }
      // (A combo line sent before parts were kept one by one: it goes back only if the kitchen started none of them.)
      const mine = tix.filter((d: any) => d.id === `${orderId}_${l.lineId}` || String(d.id).startsWith(`${orderId}_${l.lineId}_`)).map((d: any) => d.data() || {});
      if (mine.every(untouched)) { back[l.itemId] = (back[l.itemId] || 0) + l.quantity; returned += l.quantity; goesBack.add(l.lineId); }
      else { wasted += l.quantity; if (ID.test(String(l.itemId || ''))) wastedItems[l.itemId] = (wastedItems[l.itemId] || 0) + l.quantity; }
    }
    // (Only while the kitchen hasn't started on any of it, when asked: a delivery app's order cancelled without a manager.)
    if (opts.nothingMade && wasted > 0) return { error: 'The kitchen started on it, so a manager okays this.', status: 403, code: 'made' };
    const why = `Voided ${CHANNEL_NAME[o.channel as Channel] || ''} order ${o.number}: ${reason}`.replace(/\s+/g, ' ');
    const log = (id: string, d: any, delta: number) => tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: id, type: 'returned', delta, unit: String(d.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }));
    if (o.stockTaken && typeof o.stockTaken === 'object') {
      // Exactly what each line that goes back took at sending (its own count, or its ingredients), each stock item put
      // back once.
      const own = new Map<string, number>(); const part = new Map<string, number>(); const extra = new Map<string, number>();
      const addExtra = (x: any) => { for (const [pid, q] of Object.entries<any>(x?.extras || {})) if (ID.test(pid) && num(q) > 0) extra.set(pid, (extra.get(pid) || 0) + num(q)); };
      // What went out once with the order (a bag) comes back too when none of it was made.
      if (returned > 0 && wasted === 0 && o.extrasTaken && typeof o.extrasTaken === 'object') for (const [pid, q] of Object.entries<any>(o.extrasTaken)) {
        if (!ID.test(pid) || !(num(q) > 0)) continue; part.set(pid, (part.get(pid) || 0) + num(q)); extra.set(pid, (extra.get(pid) || 0) + num(q));
      }
      for (const l of lines) {
        const t: any = o.stockTaken[l.lineId]; if (!t) continue;
        const ok = partsBack.get(l.lineId);
        if (ok) {
          // A combo: each part the kitchen never started, as that part took it.
          for (const n of ok) { const x: any = t.byPart?.[n] || {};
            for (const [pid, q] of Object.entries<any>(x.items || {})) if (ID.test(pid) && num(q) > 0) own.set(pid, (own.get(pid) || 0) + num(q));
            for (const [pid, q] of Object.entries<any>(x.parts || {})) if (ID.test(pid) && num(q) > 0) part.set(pid, (part.get(pid) || 0) + num(q));
            addExtra(x); }
          continue;
        }
        if (!goesBack.has(l.lineId)) continue;
        if (num(t.own) > 0 && ID.test(l.itemId)) own.set(l.itemId, (own.get(l.itemId) || 0) + num(t.own));
        // A combo's parts that came off their own counts.
        for (const [pid, q] of Object.entries<any>(t.items || {})) if (ID.test(pid) && num(q) > 0) own.set(pid, (own.get(pid) || 0) + num(q));
        for (const [pid, q] of Object.entries<any>(t.parts || {})) if (ID.test(pid) && num(q) > 0) part.set(pid, (part.get(pid) || 0) + num(q));
        addExtra(t);
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
        // What went out with it comes back on a line of its own, marked as it was taken (lib/food-cost counts it off).
        const e1 = partBack ? Math.min(p1, extra.get(id) || 0) : 0;
        if (partBack && p1 - e1 > 1e-9) log(id, d, Math.round((p1 - e1) * 1000) / 1000);
        if (e1 > 0) tx.set(db.collection(`${T}/stockCorrections`).doc(), { ...buildEntry({ productId: id, type: 'returned', delta: e1, unit: String(d.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId } }), extra: true });
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
    // A number left for a ready text (lib/ready-text) goes with it.
    tx.set(orderRef, { status: 'voided', voidedAt: nowIso, voidedBy: who.name, voidedById: who.id, voidReason: reason, returnedQty: returned, wastedQty: wasted, ...(wasted ? { wastedItems } : {}), ...(o.readyText?.to ? { readyText: { to: null, pendingSince: null } } : {}),
      // A delivery app's order (lib/app-orders): off the pickup shelf, and its code free to go in again today.
      ...(o.app?.code ? { app: { state: 'cancelled', cancelledAt: nowIso, cancelledBy: who.name } } : {}) }, { merge: true });
    if (o.app?.code && ID.test(String(o.app.claimId || ''))) tx.delete(db.doc(`${T}/private/${o.app.claimId}`));
    // A reward held for it (never used: it wasn't paid) goes back to them.
    if (o.reward) { tx.delete(db.doc(`${T}/loyaltyLedger/redeem_counter_${orderId}`)); gaveBack = String(o.clientId || '') || null; }
    // (A car with an order placed ahead going with it carries on to pickup with that: it was paid for.)
    if (car && car.stage !== 'gone' && car.orderId === orderId && ID.test(String(car.aheadId || ''))) tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { ...carryOn(car, nowIso), addOnVoided: true }, { merge: true });
    else if (car && car.stage !== 'gone') tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'gone', goneAt: nowIso, left: true, voided: true, stageAt: { ...(car.stageAt || {}), gone: nowIso } }, { merge: true });
    return { ok: true, returned, wasted };
  });
  // (Their balance and wallet card show the reward back.)
  if (gaveBack && ID.test(gaveBack)) { try { const L = await import('@/lib/loyalty-server'); await L.refreshMember(db, tenantId, gaveBack); } catch { /* the ledger is right; the copy catches up */ } }
  return res;
}

export type PayHow = { method: 'card' | 'cash' | 'app'; tendered?: number | null; by: string; byId?: string | null; card?: { id: string; cents: number } | null; pouch?: boolean; day?: string };
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
    // A kiosk's order (lib/kiosk): its tickets, waiting for the payment, read in the same step so paying lets them go.
    // A reward held for it (lib/counter-points useReward), read in the same step so paying uses exactly that one.
    const heldRef = o.reward && !o.paidAt ? db.doc(`${T}/loyaltyLedger/redeem_counter_${orderId}`) : null;
    const heldReward: any = heldRef ? (await tx.get(heldRef)).data() : null;
    const unpaid = o.channel === 'kiosk' && !o.paidAt ? (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId))).docs.filter((d: any) => d.data()?.status === 'unpaid') : [];
    // The drawer that's open now, read in the same step (a drawer closed mid-sale never takes the cash).
    const till = method === 'cash' ? (await tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))).docs : [];
    // Paid already (another tablet, or the first answer was lost): say how, and the change that was given.
    if (o.paidAt) {
      if (viaReader && o.cardPaymentId !== how.card!.id) return { ok: true, already: true, paidOtherwise: true, payMethod: o.payMethod || null };
      return { ok: true, already: true, change: o.changeGiven ?? null, payMethod: o.payMethod || null };
    }
    // (An order for another day is paid when it's placed and kept until its day: lib/ahead-days.)
    if (o.status !== 'sent' && o.status !== 'done' && !(o.status === 'scheduled' && o.channel === 'ahead' && o.ahead?.forDay)) {
      if (viaReader && o.status === 'voided') return { ok: true, already: true, paidOtherwise: true, payMethod: null };
      return { error: o.status === 'voided' ? 'That order was voided.' : 'Send the order to the kitchen first.', status: 409 };
    }
    if (!viaReader && cardBusy(o)) return { error: CARD_BUSY_WORDS, status: 409, code: 'card_busy' };
    // A pouch is only for cash taken in line, from a car that was taken there.
    if (how.pouch && method === 'cash' && !(car?.inLine === true || car?.wasInLine === true)) return { error: 'Cash goes in a pouch only for a car taken in line. Take it at the window.', status: 409 };
    const total = num(o.total), subtotal = num(o.subtotal), tax = num(o.tax);
    if (viaReader && Math.round(how.card!.cents) !== Math.round(total * 100)) return { error: 'That card payment isn’t for this order’s total.', status: 409 };
    if (tendered !== null && tendered < total) return { error: `That’s less than the total ($${total.toFixed(2)}).`, status: 400 };
    // Paid through a delivery app (lib/app-orders): only an app's order, and only once it's sent.
    if (method === 'app' && !o.app?.code) return { error: 'Only a delivery app’s order is paid on the app.', status: 409 };
    if (method !== 'app' && o.app?.code) return { error: `${appName(o.app)} is paid on the app. Hand it to the courier.`, status: 409 };
    const saleRef = db.doc(`${T}/transactions/counter_${orderId}`); const taxRef = db.doc(`${T}/transactions/counter_${orderId}_tax`);
    const viaApp = method === 'app';
    // An app's order (lib/app-orders): booked at what the app charged, with its share and any sales tax the business pays.
    const am = viaApp ? appBooksOn(o) : null;
    const appKey = viaApp ? String(o.app.app || 'other') : ''; let week = viaApp ? payoutWeek(String(o.app.day || o.day || nowIso.slice(0, 10))) : '';
    // (A week whose payout was already checked and its difference booked: counted in the next one, so the booked week
    // stays as it was. Read here, before anything is written.)
    for (let i = 0; viaApp && i < 3; i++) { const wk: any = (await tx.get(db.doc(`${T}/private/${appWeekId(appKey, week)}`))).data(); if (!wk?.adjustedAt) break; week = payoutWeek(new Date(Date.parse(`${week}T12:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10)); }
    const common = { date: nowIso, type: 'income', context: 'Business', paymentMethod: method, hasReceipt: true, clientOrVendor: viaApp ? String(o.app.label || 'Delivery app') : `${CHANNEL_NAME[o.channel as Channel]} ${o.number}`, orderId, channel: o.channel, tenantId,
      ...(viaReader ? { stripePaymentIntentId: how.card!.id } : {}), ...(viaApp ? { appName: String(o.app.label || ''), appOrderCode: String(o.app.code || '') } : {}) };
    tx.set(saleRef, { id: saleRef.id, ...common, description: viaApp ? `${appName(o.app)} (paid out by the app, less its fees)` : `${CHANNEL_NAME[o.channel as Channel]} order ${o.number}`, category: 'Retail', amount: am ? am.appCents / 100 : subtotal,
      ...(am ? { appKey, appWeek: week, appMenuCents: am.menuCents, appFeeCents: am.feeCents, appTaxCents: am.taxCents, appPayoutCents: am.payoutCents } : {}) });
    if (am) {
      // The sales tax the business pays (an app that doesn't collect it), and the app's share, its own expense line.
      if (am.taxCents > 0) tx.set(taxRef, { id: taxRef.id, ...common, description: `Sales tax on ${appName(o.app)} (yours to pay: it comes in the payout)`, category: 'Tax Collected', taxBucket: 'tax_collected', amount: am.taxCents / 100, hasReceipt: false });
      if (am.feeCents > 0) { const feeRef = db.doc(`${T}/transactions/counter_${orderId}_appfee`); tx.set(feeRef, { id: feeRef.id, ...common, type: 'expense', category: 'Delivery App Fees', taxBucket: 'operating_cost', description: `${String(o.app.label || 'The app')}’s share (${am.feePct}%), ${appName(o.app)}`, clientOrVendor: String(o.app.label || 'Delivery app'), paymentMethod: 'Deducted from payout', amount: am.feeCents / 100, hasReceipt: false, relatedTxnId: saleRef.id }); }
      // The week's payout from that app, counted as it goes (lib/app-payouts checks it when it comes in).
      tx.set(db.doc(`${T}/private/${appWeekId(appKey, week)}`), { app: appKey, label: String(o.app.label || ''), week, orders: FieldValue.increment(1), grossCents: FieldValue.increment(am.appCents + am.taxCents), feeCents: FieldValue.increment(am.feeCents), payoutCents: FieldValue.increment(am.payoutCents), updatedAt: nowIso }, { merge: true });
    }
    // (The delivery fee's own sales tax, where the business charges it, is a line of its own beside the fee.)
    const feeTax = Math.min(tax, Math.max(0, num(o.deliveryFeeTax)));
    const foodTax = Math.round((tax - feeTax) * 100) / 100;
    if (foodTax > 0) tx.set(taxRef, { id: taxRef.id, ...common, description: o.taxLabel || 'Sales tax', category: 'Tax Collected', taxBucket: 'tax_collected', amount: foodTax, hasReceipt: false });
    // A delivery's fee (lib/food-delivery): on its own line, what the guest paid for delivery, never food sales.
    const fee = num(o.deliveryFee);
    if (fee > 0) { const feeRef = db.doc(`${T}/transactions/counter_${orderId}_delivery`); tx.set(feeRef, { id: feeRef.id, ...common, description: `Delivery, order ${o.number}`, category: 'Shipping Charged', taxBucket: 'revenue', amount: fee, hasReceipt: false }); }
    if (feeTax > 0) { const ftRef = db.doc(`${T}/transactions/counter_${orderId}_delivery_tax`); tx.set(ftRef, { id: ftRef.id, ...common, description: `${o.taxLabel || 'Sales tax'} on delivery, order ${o.number}`, category: 'Tax Collected', taxBucket: 'tax_collected', amount: feeTax, hasReceipt: false }); }
    // Its driver's tip (lib/food-delivery): a tip, never sales, kept with no one on it until it's delivered, when it's put
    // under the driver's name (lib/food-delivery-server). Refunded with the order, it goes back to the card from here.
    const tipC = Math.max(0, Math.round(num(o.tipCents)));
    if (tipC > 0) { const tipRef = db.doc(`${T}/transactions/ftip_${orderId}`); tx.set(tipRef, { id: tipRef.id, ...common, description: `Driver tip, order ${o.number} (the driver’s once it’s delivered)`, category: 'Tips', taxBucket: 'gratuity', amount: tipC / 100, staffId: null, hasReceipt: false }); }
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
    // A reward held for it (lib/counter-points useReward) is used now: paid for with it.
    if (heldRef && heldReward?.held === true) tx.set(heldRef, { held: false, usedAt: nowIso }, { merge: true });
    // Paid at a kiosk: the kitchen gets it now (its time to be ready counted from now), it's counted as sold, and it
    // waits at the counter to be handed over, as a counter order does once it's paid.
    if (o.channel === 'kiosk' && o.status === 'sent') {
      const took = Math.max(0, (Date.parse(String(o.dueAt || '')) || 0) - (Date.parse(String(o.sentAt || '')) || 0));
      const due = new Date(Date.parse(nowIso) + (took || 300000)).toISOString();
      for (const d of unpaid) tx.set(d.ref, { status: 'pending', createdAt: nowIso, requestedAt: nowIso, dueAt: due }, { merge: true });
      tx.set(orderRef, { sentAt: nowIso, dueAt: due, kiosk: { ...(o.kiosk || {}), state: 'paid' } }, { merge: true });
      if (unpaid.length) tx.set(db.doc(`${T}/menuSales/${String(o.day || nowIso.slice(0, 10))}`), { day: String(o.day || nowIso.slice(0, 10)), ...soldCounts(Array.isArray(o.lines) ? o.lines : []) }, { merge: true });
      const carRef = db.doc(`${T}/driveThruCars/kiosk_${orderId}`);
      tx.set(carRef, { id: carRef.id, number: o.number, channel: 'kiosk', stage: 'pickup', arrivedAt: nowIso, stageAt: { pickup: nowIso }, orderId, takenBy: String(o.createdBy || 'Kiosk'), day: o.day || null, ...(o.locationId ? { locationId: String(o.locationId) } : {}) }, { merge: true });
      tx.set(orderRef, { carId: carRef.id }, { merge: true });
    }
    return { ok: true, drawer: !!drawer, pouch, change, payMethod: method, cardId: leftCard };
  });
  // Points for a guest who gave their number (lib/counter-points): once it's paid, once.
  if (res?.ok && !res.already) { try { const P = await import('@/lib/counter-points'); await P.earnForOrder(db, tenantId, null, orderId); } catch (e: any) { console.error('[counter] points not earned', orderId, e?.message); } }
  return res;
}
