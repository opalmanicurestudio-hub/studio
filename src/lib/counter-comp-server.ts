// src/lib/counter-comp-server.ts — ONE ITEM ON THE HOUSE (server; design board "Register tools, part 2", part 2;
// api/counter 'comp' and 'uncomp'). A manager okays it, with why: the item is $0 on the order (its price kept beside it),
// still made and still off stock, and the order's own discount and reward stay as they are beside it. While the order
// is being taken, some of a line can go on the house (it's split); once it's with the kitchen, the whole line does.
// Taken back ("charge for it"), it's its price again. Paid already, it's a refund instead. The night report counts what
// was given, by why (lib/night-close-server).
import { cardBusy } from '@/lib/counter-server';
import { markdownCentsOf, tendersOf, paidPartsOf } from '@/lib/counter-money';
import { moneyWith } from '@/lib/counter-money-server';
import type { OrderLine } from '@/lib/counter-orders';
import { randomBytes } from 'crypto';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
type Who = { id: string | null; name: string };

export type Comp = { from: number; reason: string; by: string; approvedBy: string; at: string };

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

/** `qty` of a line on the house, okayed by `approver` (a manager), with why. */
export async function compLine(db: any, tenantId: string, tenant: any, orderId: string, lineId: string, qtyRaw: unknown, reasonRaw: unknown, who: Who, approver: Who | null) {
  if (!approver) return fail('On the house takes a manager. Their PIN, or ask one to.', 403, 'manager');
  if (!ID.test(orderId)) return fail('Which order?', 400);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(lineId)) return fail('Which item?', 400);
  const reason = String(reasonRaw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!reason) return fail('Why is it on the house?', 400, 'reason');
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`); const nowIso = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o); if (no) return no;
    const lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    const line: any = lines.find((l) => l.lineId === lineId); if (!line) return fail('That isn’t on the order.', 404);
    if (line.comp) return fail(`${line.name} is on the house already.`, 409, 'already');
    // (Money held for the guest, never a sale to give: lib/counter-gift. Take it off instead.)
    if (line.giftCard) return fail('A gift card can’t go on the house. Take it off instead.', 409, 'gift');
    if (!(num(line.unitPrice) > 0)) return fail(`${line.name} is free already.`, 409, 'free');
    const q = Math.floor(num(qtyRaw)); if (q < 1 || q > line.quantity) return fail(`How many? Between 1 and ${line.quantity}.`, 400);
    // (With the kitchen, each line is its own tickets and its own stock: all of the line, or none.)
    if (o.status === 'sent' && q !== line.quantity) return fail('It’s with the kitchen, so it’s all of that line or none.', 409, 'whole');
    if (q < line.quantity && lines.length >= 40) return fail('That’s a big order. Send this one, and start another.', 400);
    const comp: Comp = { from: Math.round(num(line.unitPrice) * 100) / 100, reason, by: who.name.slice(0, 60), approvedBy: approver.name.slice(0, 60), at: nowIso };
    const free = { ...line, quantity: q, unitPrice: 0, comp, ...(q < line.quantity ? { lineId: randomBytes(5).toString('hex') } : {}) };
    // (Some of a line while it's being taken: the rest stays as it was, just above it.)
    const next = q === line.quantity ? lines.map((l) => (l.lineId === lineId ? free : l)) : lines.flatMap((l) => (l.lineId === lineId ? [{ ...l, quantity: l.quantity - q }, free] : [l]));
    const money = saveMoney(tx, ref, tenant, o, next, { comps: [...(Array.isArray(o.comps) ? o.comps : []), { lineId: free.lineId, name: line.name, qty: q, cents: Math.round(comp.from * q * 100), reason, by: comp.by, approvedBy: comp.approvedBy, at: nowIso }].slice(-20) });
    return { ok: true as const, order: { id: orderId, number: o.number, status: o.status, lines: next, subtotal: money.subtotal, tax: money.tax, total: money.total }, name: line.name, qty: q, cents: Math.round(comp.from * q * 100), approvedBy: comp.approvedBy };
  });
}

/** On the house taken back: its price again (anyone; it only adds to what's owed). */
export async function uncompLine(db: any, tenantId: string, tenant: any, orderId: string, lineId: string, who: Who) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(lineId)) return fail('Which item?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`); const nowIso = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o); if (no) return no;
    const lines: OrderLine[] = Array.isArray(o.lines) ? o.lines : [];
    const line: any = lines.find((l) => l.lineId === lineId); if (!line) return fail('That isn’t on the order.', 404);
    if (!line.comp) return { ok: true as const, already: true, order: { id: orderId, number: o.number, status: o.status, lines, subtotal: num(o.subtotal), tax: num(o.tax), total: num(o.total) }, name: line.name };
    const next = lines.map((l: any) => { if (l.lineId !== lineId) return l; const { comp, ...rest } = l; return { ...rest, unitPrice: Math.round(num(comp.from) * 100) / 100 }; });
    const money = saveMoney(tx, ref, tenant, o, next, { comps: (Array.isArray(o.comps) ? o.comps : []).map((c: any) => (c.lineId === lineId && !c.undoneAt ? { ...c, undoneAt: nowIso, undoneBy: who.name.slice(0, 60) } : c)) });
    return { ok: true as const, order: { id: orderId, number: o.number, status: o.status, lines: next, subtotal: money.subtotal, tax: money.tax, total: money.total }, name: line.name };
  });
}
