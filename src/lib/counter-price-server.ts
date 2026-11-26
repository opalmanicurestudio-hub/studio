// src/lib/counter-price-server.ts — ONE ITEM AT A DIFFERENT PRICE (server; design board "Register tools, part 3", part 1;
// api/counter 'price' and 'priceBack'; components/pos/CounterPrice). A dented muffin for less, or a shelf price that was
// wrong: the item's price on this order only (the menu stays as it is), with why. Lower takes a manager; higher doesn't.
// While the order is being taken, some of a line can be (it's split); once it's with the kitchen, the whole line.
// Charged at the menu price again, it's as it was. Paid already, it's a refund instead. The night report counts what
// different prices took off, by why (lib/night-close-server).
import { cardBusy } from '@/lib/counter-server';
import { markdownCentsOf, tendersOf, paidPartsOf } from '@/lib/counter-money';
import { moneyWith } from '@/lib/counter-money-server';
import { cleanPrice, type PriceChange } from '@/lib/counter-price';
import type { OrderLine } from '@/lib/counter-orders';
import { randomBytes } from 'crypto';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
type Who = { id: string | null; name: string };

/** Why its money can't change now (null: it can). */
function notNow(o: any): Fail | null {
  if (!o) return fail('That order is gone.', 404);
  if (o.paidAt) return fail('It’s paid already. Refund the item instead.', 409, 'paid');
  if (o.status !== 'building' && o.status !== 'sent') return fail('That order is finished.', 409, 'done');
  if (o.staffMeal) return fail('A staff meal takes no money already.', 409, 'staff');
  if (o.app?.code) return fail('A delivery app’s order is priced on the app.', 409, 'app');
  if (cardBusy(o)) return fail('The card reader is asking for this order’s payment. Stop it first.', 409, 'card_busy');
  if (o.phone?.id && o.phone.state === 'open') return fail('A scan-to-pay code is open for this order. Close it first.', 409, 'phone_open');
  if (tendersOf(o).length || paidPartsOf(o).length) return fail('Something is set aside on it (a gift card, store credit or part of a split bill). Take that off first.', 409, 'tenders');
  return null;
}

const saveMoney = (tx: any, ref: any, tenant: any, o: any, next: OrderLine[], extra: Record<string, unknown>) => {
  const after = { ...o, lines: next }; const md = markdownCentsOf(after); const money = moneyWith(tenant, after, md);
  tx.set(ref, { lines: next, subtotal: money.subtotal, tax: money.tax, taxLabel: money.taxLabel, taxedAmount: money.taxedAmount, taxPct: money.taxPct, total: money.total, discount: money.discount, itemsTotal: money.itemsTotal,
    ...(o.markdown ? { markdown: { ...o.markdown, cents: md } } : {}), ...extra, updatedAt: new Date().toISOString() }, { merge: true });
  return money;
};
const shown = (orderId: string, o: any, lines: OrderLine[], money: any) => ({ id: orderId, number: o.number, status: o.status, lines, subtotal: money.subtotal, tax: money.tax, total: money.total });

/** `qty` of a line at `price` each (dollars), with why. `approver`: a manager, needed when it's lower than it is now. */
export async function priceLine(db: any, tenantId: string, tenant: any, orderId: string, lineId: string, qtyRaw: unknown, priceRaw: unknown, reasonRaw: unknown, who: Who, approver: Who | null) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(lineId)) return fail('Which item?', 400);
  const cents = cleanPrice(priceRaw); if (cents === null) return fail('A price from $0.01 to $1,000. For nothing at all, use On the house.', 400, 'price');
  const reason = String(reasonRaw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!reason) return fail('Why is the price different?', 400, 'reason');
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`); const nowIso = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o); if (no) return no;
    const lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    const line: any = lines.find((l) => l.lineId === lineId); if (!line) return fail('That isn’t on the order.', 404);
    if (line.giftCard) return fail('A gift card is its own amount. Take it off and add the one they want.', 409, 'gift');
    if (line.comp) return fail(`${line.name} is on the house. Charge for it first.`, 409, 'comp');
    // (Rung in at its own price, up to the business's amount: lib/counter-oneoff. Take it off and ring it in again.)
    if (line.oneOff) return fail(`${line.name} isn’t on the menu, so it’s rung in at its own price. Take it off and ring it in again.`, 409, 'one_off');
    const now = Math.round(num(line.unitPrice) * 100);
    if (cents === now) return fail(`${line.name} is $${(now / 100).toFixed(2)} already.`, 409, 'same');
    // (Lower than it is now takes a manager: a higher price only adds to what's owed.)
    if (cents < now && !approver) return fail('A lower price takes a manager. Their PIN, or ask one to.', 403, 'manager');
    const q = Math.floor(num(qtyRaw)); if (q < 1 || q > line.quantity) return fail(`How many? Between 1 and ${line.quantity}.`, 400);
    // (With the kitchen, each line is its own tickets and its own stock: all of the line, or none.)
    if (o.status === 'sent' && q !== line.quantity) return fail('It’s with the kitchen, so it’s all of that line or none.', 409, 'whole');
    if (q < line.quantity && lines.length >= 40) return fail('That’s a big order. Send this one, and start another.', 400);
    const from = line.priceChange ? num(line.priceChange.from) : now / 100;
    const change: PriceChange = { from: Math.round(from * 100) / 100, to: cents / 100, reason, by: who.name.slice(0, 60), approvedBy: cents < now ? approver!.name.slice(0, 60) : null, at: nowIso };
    // (Back at its menu price: as it was.)
    const back = Math.round(from * 100) === cents;
    const moved = (l: any) => { const { priceChange: _p, ...rest } = l; return back ? { ...rest, unitPrice: cents / 100 } : { ...rest, unitPrice: cents / 100, priceChange: change }; };
    const one = { ...moved(line), quantity: q, ...(q < line.quantity ? { lineId: randomBytes(5).toString('hex') } : {}) };
    const next = q === line.quantity ? lines.map((l) => (l.lineId === lineId ? one : l)) : lines.flatMap((l) => (l.lineId === lineId ? [{ ...l, quantity: l.quantity - q }, one] : [l]));
    const log = { lineId: one.lineId, name: line.name, qty: q, from: change.from, to: change.to, reason, by: change.by, approvedBy: cents < now ? change.approvedBy : null, at: nowIso };
    const money = saveMoney(tx, ref, tenant, o, next, { priceChanges: [...(Array.isArray(o.priceChanges) ? o.priceChanges : []), log].slice(-20) });
    return { ok: true as const, order: shown(orderId, o, next, money), name: line.name, qty: q, from: change.from, to: change.to, back, approvedBy: cents < now ? change.approvedBy : null };
  });
}

/** At its menu price again (anyone when that's higher; a manager when it's lower than it is now). */
export async function priceBack(db: any, tenantId: string, tenant: any, orderId: string, lineId: string, who: Who, approver: Who | null) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(lineId)) return fail('Which item?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`); const nowIso = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o); if (no) return no;
    const lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    const line: any = lines.find((l) => l.lineId === lineId); if (!line) return fail('That isn’t on the order.', 404);
    if (line.comp) return fail(`${line.name} is on the house. Charge for it first.`, 409, 'comp');
    if (!line.priceChange) return { ok: true as const, already: true, order: { id: orderId, number: o.number, status: o.status, lines, subtotal: num(o.subtotal), tax: num(o.tax), total: num(o.total) }, name: line.name };
    const from = num(line.priceChange.from);
    if (Math.round(from * 100) < Math.round(num(line.unitPrice) * 100) && !approver) return fail('Its menu price is lower, so a manager okays it. Their PIN, or ask one to.', 403, 'manager');
    const next = lines.map((l: any) => { if (l.lineId !== lineId) return l; const { priceChange: _p, ...rest } = l; return { ...rest, unitPrice: Math.round(from * 100) / 100 }; });
    const money = saveMoney(tx, ref, tenant, o, next, { priceChanges: (Array.isArray(o.priceChanges) ? o.priceChanges : []).map((c: any) => (c.lineId === lineId && !c.undoneAt ? { ...c, undoneAt: nowIso, undoneBy: who.name.slice(0, 60) } : c)) });
    return { ok: true as const, order: shown(orderId, o, next, money), name: line.name, from };
  });
}
