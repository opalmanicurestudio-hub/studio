// src/lib/part-refund.ts — REFUND PART OF AN ORDER (pure): what a refund of some items, the shipping, or another
// amount comes to, worked out from the order itself, and what it marks on the order once it's sent.
//   items    — each at what was paid for it (its price after any promo code), with the sales tax that went with it.
//              Never more of a line than is left of it: units missing at packing, sent on a backorder, returned, or
//              refunded already are someone else's to refund.
//   shipping — up to what was charged for shipping or delivery, less what's been refunded of it. No tax.
//   amount   — any other amount (a goodwill gesture, a price matched); its tax part is worked out when it's sent.
// Every part refund has a reason: it goes on the order's record and in the books.
import { effectiveUnitCents, taxShareCents } from '@/lib/restocking';

export type PartKind = 'items' | 'shipping' | 'amount';
export type PartLine = { lineId: string; qty: number; name: string };
export type PartRefund = { kind: PartKind; cents: number; itemsCents: number; taxCents: number; note: string; what: string; lines: PartLine[]; id?: string };

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Units of a line that can still be refunded on their own (not ones put right through a problem report, qtyClaimed). */
export function unitsLeft(l: any): number {
  return Math.max(0, c0(l?.qtyOrdered) - c0(l?.qtyShorted) - c0(l?.qtyReturned) - c0(l?.qtyRefunded) - c0(l?.qtyClaimed));
}

/** Shipping charged that hasn’t been refunded yet (a delivery fee given back and marked done by hand counts too: lib/delivery-retry). */
export function shippingLeft(o: any): number {
  return Math.max(0, c0(o?.shippingCents) - c0(o?.shippingRefundedCents) - c0(o?.deliveryFeeBackHandCents));
}

/** The items' part: what was paid for them and the tax that went with them. */
export function itemsRefund(o: any, picks: { lineId: string; qty: number }[]): { ok: true; itemsCents: number; taxCents: number; lines: PartLine[] } | { ok: false; error: string } {
  const lines: PartLine[] = []; let itemsCents = 0;
  for (const p of picks || []) {
    const qty = c0(p?.qty); if (!qty) continue;
    const l = (o?.lines || []).find((x: any) => String(x?.lineId) === String(p?.lineId));
    if (!l) return { ok: false, error: 'One of those items isn’t on the order any more.' };
    const left = unitsLeft(l);
    if (qty > left) return { ok: false, error: left ? `Only ${left} of ${l.name || 'that item'} can be refunded.` : `${l.name || 'That item'} has already been refunded, returned or sent on its own.` };
    itemsCents += qty * effectiveUnitCents(l);
    lines.push({ lineId: String(l.lineId), qty, name: String(l.name || 'Item') });
  }
  if (!lines.length) return { ok: false, error: 'Choose what to refund.' };
  return { ok: true, itemsCents, taxCents: taxShareCents(o, itemsCents), lines };
}

/** Checks a part refund asked for (from the order as it is) and works out its amount. */
export function partRefundAsk(o: any, ask: any): { ok: true; add: PartRefund } | { ok: false; error: string } {
  const r = partRefundAsk0(o, ask);
  // The sheet's own id for this ask: the same ask sent twice (a double tap, a retry) is one refund (api/retail/refund).
  const id = String(ask?.id || '');
  return r.ok && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? { ok: true, add: { ...r.add, id } } : r;
}

/** Whether this ask was sent already (its id is on the order's part refunds). */
export const partRefundSent = (o: any, id?: string) => !!id && (Array.isArray(o?.partRefunds) ? o.partRefunds : []).some((p: any) => p?.id === id);

function partRefundAsk0(o: any, ask: any): { ok: true; add: PartRefund } | { ok: false; error: string } {
  const kind = String(ask?.kind || '') as PartKind;
  const note = String(ask?.note || '').trim().slice(0, 300);
  if (!note) return { ok: false, error: 'Say why it’s being refunded.' };
  if (['cancelled', 'placed'].includes(String(o?.stage || ''))) return { ok: false, error: o?.stage === 'placed' ? 'This order hasn’t been paid.' : 'This order has been cancelled and refunded already.' };
  if (kind === 'items') {
    const r = itemsRefund(o, Array.isArray(ask?.lines) ? ask.lines : []);
    if (!r.ok) return r;
    const n = r.lines.reduce((a, l) => a + l.qty, 0);
    const what = n === 1 ? `Refund for ${r.lines[0].name}` : `Refund for ${n} items`;
    return { ok: true, add: { kind, cents: r.itemsCents + r.taxCents, itemsCents: r.itemsCents, taxCents: r.taxCents, note, what, lines: r.lines } };
  }
  if (kind === 'shipping') {
    const left = shippingLeft(o);
    const what = o?.method === 'delivery' ? 'delivery' : 'shipping';
    if (!left) return { ok: false, error: c0(o?.shippingCents) ? `The ${what} has been refunded already.` : `They weren’t charged for ${what}.` };
    const want = ask?.cents == null ? left : c0(ask.cents);
    if (!want) return { ok: false, error: `Enter how much of the ${what} to refund.` };
    if (want > left) return { ok: false, error: `Only ${money(left)} of the ${what} is left to refund.` };
    return { ok: true, add: { kind, cents: want, itemsCents: 0, taxCents: 0, note, what: o?.method === 'ship' ? 'Shipping refunded' : 'Delivery refunded', lines: [] } };
  }
  if (kind === 'amount') {
    const want = c0(ask?.cents);
    if (!want) return { ok: false, error: 'Enter an amount to refund.' };
    return { ok: true, add: { kind, cents: want, itemsCents: 0, taxCents: 0, note, what: 'Partial refund', lines: [] } };
  }
  return { ok: false, error: 'Choose what to refund.' };
}

/** What a sent part refund marks on the order: the units refunded on each line, the shipping refunded, and the record. */
export function partRefundApply(o: any, add: PartRefund, rec: { at: string; by: string; seq: number; refundId?: string }): Record<string, any> {
  const out: Record<string, any> = {
    partRefunds: [...(Array.isArray(o?.partRefunds) ? o.partRefunds : []).slice(-30), { kind: add.kind, cents: add.cents, note: add.note, lines: add.lines, at: rec.at, by: rec.by, seq: rec.seq, ...(add.id ? { id: add.id } : {}), ...(rec.refundId ? { refundId: rec.refundId } : {}) }],
  };
  if (add.kind === 'items' && add.lines.length) {
    out.lines = (o?.lines || []).map((l: any) => {
      const hit = add.lines.find((x) => x.lineId === String(l?.lineId));
      return hit ? { ...l, qtyRefunded: c0(l?.qtyRefunded) + hit.qty } : l;
    });
  }
  if (add.kind === 'shipping') out.shippingRefundedCents = c0(o?.shippingRefundedCents) + add.cents;
  return JSON.parse(JSON.stringify(out));
}
