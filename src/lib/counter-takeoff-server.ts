// src/lib/counter-takeoff-server.ts — TAKE SOMETHING OFF AN ORDER AFTER IT WENT TO THE KITCHEN (server; design board
// "Register tools, part 2", part 1; api/counter 'takeOff'). Before it's paid: some or all of one line comes off.
// - The kitchen hasn't started it (every ticket of that line still waiting): what it took comes back on the shelf, in
//   the same share (its own count, its ingredients, what went out with it, and the location's own number), and its
//   tickets come off the kitchen screen (or show fewer).
// - The kitchen started it: a manager okays it (the route asks), it's kept as waste, and its tickets come off too.
// - The order's money follows: its discount worked out again on what's left, its reward and tip as they were. Paid
//   already, it's a refund instead (lib/counter-refund-server); something set aside on it (a gift card, a part of a
//   split bill) or a card payment under way stops it until that's taken off.
import { FieldValue } from 'firebase-admin/firestore';
import { buildEntry } from '@/lib/stock-ledger';
import { moveStock } from '@/lib/usage';
import { storeMoveNested } from '@/lib/store-stock';
import { cardBusy } from '@/lib/counter-server';
import { markdownCentsOf, tendersOf, paidPartsOf } from '@/lib/counter-money';
import { moneyWith } from '@/lib/counter-money-server';
import { menuLinesOf } from '@/lib/counter-oneoff';
import { CHANNEL_NAME, type Channel, type OrderLine } from '@/lib/counter-orders';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r3 = (x: number) => Math.round(x * 1000) / 1000;
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
type Who = { id: string | null; name: string };

/** The kitchen hasn't started a ticket (or it's gone). */
const untouched = (t: any) => !t || t.status === 'pending' || t.status === 'unpaid' || t.status === 'cancelled';
/** A line's tickets: its own, a combo's parts, and parts made at another station (all start with its own id). */
const lineTicket = (orderId: string, lineId: string) => (id: string) => id === `${orderId}_${lineId}` || id.startsWith(`${orderId}_${lineId}_`);

/** What one line took at sending, as a share (`r` of it): its own counts, its ingredients, and what went out with it. */
function shareOf(t: any, itemId: string, r: number) {
  const own = new Map<string, number>(); const part = new Map<string, number>(); const extra = new Map<string, number>();
  const add = (m: Map<string, number>, id: string, q: unknown) => { if (ID.test(id) && num(q) > 0) m.set(id, r3((m.get(id) || 0) + num(q) * r)); };
  const one = (x: any) => {
    for (const [pid, q] of Object.entries<any>(x?.items || {})) add(own, pid, q);
    for (const [pid, q] of Object.entries<any>(x?.parts || {})) add(part, pid, q);
    for (const [pid, q] of Object.entries<any>(x?.extras || {})) add(extra, pid, q);
  };
  if (t?.byPart && typeof t.byPart === 'object') for (const x of Object.values<any>(t.byPart)) one(x);
  else { if (num(t?.own) > 0) add(own, itemId, t.own); one(t); }
  return { own, part, extra };
}

/** What's left of what a line took, once `r` of it came off (kept, so a void later gives back no more than that). */
function scaleTake(t: any, keep: number): any {
  const s = (x: Record<string, any> | undefined) => (x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, r3(num(v) * keep)]).filter(([, v]) => (v as number) > 0)) : undefined);
  const out: any = { own: r3(num(t?.own) * keep), parts: s(t?.parts) || {} };
  if (t?.items) out.items = s(t.items); if (t?.extras) out.extras = s(t.extras);
  if (t?.byPart && typeof t.byPart === 'object') out.byPart = Object.fromEntries(Object.entries<any>(t.byPart).map(([n, x]) => [n, { item: x?.item, items: s(x?.items) || {}, parts: s(x?.parts) || {}, ...(x?.extras ? { extras: s(x.extras) } : {}) }]));
  return out;
}

/** Some or all of one line off an order the kitchen has, before it's paid. `approver`: a manager who okayed it (needed
 *  once the kitchen has started it: answered with code 'made' without one). */
export async function takeOffSent(db: any, tenantId: string, tenant: any, orderId: string, lineId: string, qtyRaw: unknown, who: Who, approver: Who | null) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(lineId)) return fail('Which item?', 400);
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`); const nowIso = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    if (!o) return fail('That order is gone.', 404);
    if (o.status === 'building') return fail('It hasn’t gone to the kitchen yet. Take it off the order as usual.', 409, 'building');
    if (o.status !== 'sent') return fail('That order is finished. Refund it instead.', 409, 'done');
    if (o.paidAt) return fail('It’s paid already. Refund the item instead.', 409, 'paid');
    if (o.staffMeal) return fail('A staff meal takes no money. Void it instead.', 409, 'staff');
    if (o.app?.code) return fail('A delivery app’s order is changed on the app.', 409, 'app');
    if (cardBusy(o)) return fail('The card reader is asking for this order’s payment. Stop it first.', 409, 'card_busy');
    if (o.phone?.id && o.phone.state === 'open') return fail('A scan-to-pay code is open for this order. Close it first.', 409, 'phone_open');
    if (tendersOf(o).length || paidPartsOf(o).length) return fail('Something is set aside on it (a gift card, store credit or part of a split bill). Take that off first.', 409, 'tenders');
    const lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    const line = lines.find((l) => l.lineId === lineId); if (!line) return fail('That isn’t on the order.', 404);
    const q = Math.floor(num(qtyRaw)); if (q < 1 || q > line.quantity) return fail(`How many? Between 1 and ${line.quantity}.`, 400);
    const whole = q === line.quantity;
    if (whole && lines.length === 1) return fail('That’s all of it. Void the order instead.', 409, 'all');
    // Its tickets, and whether the kitchen started any.
    const tix = (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId))).docs.filter((d: any) => lineTicket(orderId, lineId)(String(d.id)));
    const made = !line.oneOff && tix.some((d: any) => !untouched(d.data()));
    if (made && !approver) return fail('The kitchen started on it, so a manager okays this.', 403, 'made');
    const why = `Taken off ${CHANNEL_NAME[o.channel as Channel] || ''} order ${o.number}`.replace(/\s+/g, ' ');
    const r = q / line.quantity;
    const take = o.stockTaken?.[lineId];
    // Reads first: what goes back on the shelf.
    const back = !made && !line.oneOff && take ? shareOf(take, line.itemId, r) : null;
    const ids = back ? Array.from(new Set([...back.own.keys(), ...back.part.keys()])) : [];
    const snaps = await Promise.all(ids.map((id) => tx.get(db.doc(`${T}/inventory/${id}`))));
    // (Back on the location's own number too, no more than came off it there.)
    const at = o.storeTaken && typeof o.storeTaken === 'object' ? String(o.storeTaken.at || '') || null : null;
    const storeLeft: Record<string, number> = at ? Object.fromEntries(Object.entries<any>(o.storeTaken.items || {}).map(([k, v]) => [k, Math.max(0, Math.floor(num(v)))])) : {};
    const backAt = (id: string, d: any, qty: number) => { const n = Math.min(Math.max(0, Math.round(qty)), storeLeft[id] || 0); if (!at || n <= 0) return {}; storeLeft[id] -= n; return storeMoveNested(d, at, { stock: n }); };
    const log = (id: string, d: any, delta: number, extra = false) => tx.set(db.collection(`${T}/stockCorrections`).doc(), { ...buildEntry({ productId: id, type: 'returned', delta, unit: String(d.unit || 'units'), reason: why, actorId: who.id || 'lane', actorName: who.name, ref: { kind: 'order', id: orderId }, ...(at ? { storeId: at } : {}) }), ...(extra ? { extra: true } : {}) });
    let returned = 0;
    if (back) {
      ids.forEach((id, k) => {
        const d: any = snaps[k].data(); if (!d) return;
        const o1 = back.own.get(id) || 0; const p1 = back.part.get(id) || 0; const iRef = db.doc(`${T}/inventory/${id}`);
        const m = p1 ? moveStock({ ...d, totalStock: num(d.totalStock) + o1 }, -p1) : null; const partBack = !!m && !m.notCounted;
        if (partBack) tx.set(iRef, { ...m!.patch, ...backAt(id, d, num(m!.patch.totalStock) - num(d.totalStock)) }, { merge: true });
        else if (o1) tx.set(iRef, { totalStock: FieldValue.increment(o1), ...backAt(id, d, o1) }, { merge: true });
        if (o1) log(id, d, o1);
        const e1 = partBack ? Math.min(p1, back.extra.get(id) || 0) : 0;
        if (partBack && p1 - e1 > 1e-9) log(id, d, r3(p1 - e1));
        if (e1 > 0) log(id, d, e1, true);
      });
      returned = q;
    }
    // Its tickets: off the kitchen screen with all of it, or showing fewer.
    for (const d of tix) {
      const t: any = d.data() || {}; if (t.status === 'delivered' || t.status === 'cancelled') continue;
      if (whole) tx.set(d.ref, { status: 'cancelled', cancelledAt: nowIso, cancelledBy: { name: who.name, via: 'lane' }, takenOff: true }, { merge: true });
      else tx.set(d.ref, { quantity: Math.max(1, num(t.quantity) - q), changedAt: nowIso }, { merge: true });
    }
    // The order: the line less, its money again (its discount on what's left), and what's left of what it took.
    const next = whole ? lines.filter((l) => l.lineId !== lineId) : lines.map((l) => (l.lineId === lineId ? { ...l, quantity: l.quantity - q } : l));
    const after = { ...o, lines: next };
    const mdCents = markdownCentsOf(after);
    const money = moneyWith(tenant, after, mdCents);
    const stockTaken = { ...(o.stockTaken || {}) };
    if (take) { if (whole) delete stockTaken[lineId]; else stockTaken[lineId] = scaleTake(take, 1 - r); }
    // What was made and thrown away, kept apart from what a void throws away (lib/counter-server voidOrder), with when, so
    // Food cost counts it in its own stretch (api/food-cost). (A combo with any part started counts as made, whole.)
    const takenOffWaste: Record<string, number> = { ...(o.takenOffWaste || {}) };
    if (made) {
      const byPart = take?.byPart && typeof take.byPart === 'object' ? Object.values<any>(take.byPart).map((x) => String(x?.item || '')).filter((x) => ID.test(x)) : [];
      for (const id of byPart.length ? byPart : [line.itemId]) if (ID.test(id)) takenOffWaste[id] = (takenOffWaste[id] || 0) + q;
    }
    const off = { lineId, name: line.name, qty: q, made, by: who.name, ...(approver ? { approvedBy: approver.name } : {}), at: nowIso };
    tx.set(ref, { lines: next, subtotal: money.subtotal, tax: money.tax, taxLabel: money.taxLabel, total: money.total, discount: money.discount, itemsTotal: money.itemsTotal,
      ...(o.markdown ? { markdown: { ...o.markdown, cents: mdCents } } : {}), stockTaken,
      ...(made ? { takenOffWaste, takenOffWastedQty: num(o.takenOffWastedQty) + q, wastedAt: nowIso } : { takenOffReturnedQty: num(o.takenOffReturnedQty) + returned }),
      // (What's left of what came off the location's own number: a void later gives back no more than that.)
      ...(at && back ? { storeTaken: { ...o.storeTaken, at, items: storeLeft } } : {}),
      // (Nothing for the kitchen left: ready now.)
      ...(menuLinesOf(next).length ? {} : { kitchenNone: true }),
      takenOff: [...(Array.isArray(o.takenOff) ? o.takenOff : []), off].slice(-20), updatedAt: nowIso }, { merge: true });
    return { ok: true as const, order: { id: orderId, number: o.number, status: o.status, lines: next, subtotal: money.subtotal, tax: money.tax, total: money.total }, made, returned, name: line.name, qty: q, less: Math.round((num(o.total) - money.total) * 100) / 100 };
  });
}
