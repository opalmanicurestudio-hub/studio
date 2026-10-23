// src/lib/non-card-back.ts — WHAT WAS PAID BY GIFT CARD OR STORE CREDIT GOES BACK THAT WAY. The part of an order a gift
// card paid goes back onto that gift card, and the part store credit paid comes back as new store credit, whether it's
// for a refund (api/retail/refund) or a cancellation (lib/cancel-restore). One running total on the paying order,
// nonCardRestored, counts what has gone back so far (only the server writes it), so the same money never goes back
// twice, and each give-back is one transaction with the gift card, the credit and that total, so a retry can't add it
// twice. A gift card that's gone or voided gets its part as store credit instead. Server only.

import { cardPaidCents } from './retail-money';

export type NonCard = { giftCents: number; creditCents: number };

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const iso = () => new Date().toISOString();
const GIFT_MAX = 500000;

/** What the order really took by gift card and by store credit. A gift card is charged when the order is paid
 *  (giftSpentAt). Store credit is taken then too, and the shortfall recorded (0 when it was all there); an order paid
 *  before that was recorded has its number. A checkout left unpaid has neither, and took nothing. */
export function nonCardPaid(o: any): NonCard {
  const giftCents = o?.giftSpentAt && o?.giftCardId ? c0(o.giftCardCents) : 0;
  const asked = c0(o?.storeCreditRequestedCents);
  const creditCents = !asked ? 0
    : o?.creditShortfallCents != null ? Math.max(0, asked - c0(o.creditShortfallCents))
    : Number(o?.orderNumber) > 0 ? asked : 0;
  return { giftCents, creditCents };
}

/** What has gone back that way so far. */
export function nonCardBack(o: any): NonCard {
  const r = o?.nonCardRestored || {};
  return { giftCents: c0(r.giftCents), creditCents: c0(r.creditCents) };
}

/** What can still go back that way. */
export function nonCardRoom(o: any): NonCard {
  const paid = nonCardPaid(o); const back = nonCardBack(o);
  return { giftCents: Math.max(0, paid.giftCents - back.giftCents), creditCents: Math.max(0, paid.creditCents - back.creditCents) };
}

export const roomCents = (o: any): number => { const r = nonCardRoom(o); return r.giftCents + r.creditCents; };

/** Reads (inside a transaction, before any write) what a give-back on `payer` needs: its gift card. */
export async function readGift(tx: any, db: any, t: string, payer: any): Promise<any | null> {
  if (!payer?.giftCardId || nonCardRoom(payer).giftCents <= 0) return null;
  const ref = db.doc(`tenants/${t}/giftCards/${String(payer.giftCardId)}`);
  const s = await tx.get(ref);
  return { ref, data: s.exists ? s.data() || null : null };
}

/** Writes (inside the same transaction, after every read) up to `want` cents back the way `payer` paid: its gift card
 *  first, then store credit. Returns what went back, by kind. `payerRef` is the paying order; the caller writes nothing
 *  else to nonCardRestored. */
export function writeGiveBack(tx: any, db: any, t: string, payerRef: any, payer: any, gift: any | null, want: number,
  why: { note: string; by: string; kind: 'refund' | 'order_cancelled'; forOrderId: string }): NonCard & { toCreditFromGift: number } {
  const room = nonCardRoom(payer);
  let left = c0(want);
  const giftPart = Math.min(left, room.giftCents); left -= giftPart;
  const creditPart = Math.min(left, room.creditCents);
  let onCard = 0; let asCredit = creditPart; let toCreditFromGift = 0;
  if (giftPart > 0) {
    const g = gift?.data;
    const usable = g && g.status !== 'void' && c0(g.balanceCents) + giftPart <= GIFT_MAX;
    if (usable) {
      const before = c0(g.balanceCents); const after = before + giftPart;
      tx.update(gift.ref, {
        balanceCents: after, status: 'active',
        history: [...(Array.isArray(g.history) ? g.history : []).slice(-80), { at: iso(), type: 'adjust', cents: giftPart, balanceAfter: after, by: why.by, note: why.note.slice(0, 200) }],
      });
      onCard = giftPart;
    } else {
      // The card can't take it (gone, voided or full): that part comes back as store credit.
      asCredit += giftPart; toCreditFromGift = giftPart;
    }
  }
  if (asCredit > 0) {
    const ref = db.collection(`tenants/${t}/depositCredits`).doc();
    tx.set(ref, {
      id: ref.id, tenantId: t, clientId: payer.clientId || null,
      clientEmail: String(payer.customerEmail || '').toLowerCase().trim(), clientName: payer.customerName || 'Guest',
      kind: 'store_credit', amountCents: asCredit, status: 'available', sourceRetailOrderId: why.forOrderId, sourceKind: why.kind, createdAt: iso(),
    });
  }
  const back = nonCardBack(payer);
  if (giftPart + creditPart > 0) {
    tx.update(payerRef, { nonCardRestored: { giftCents: back.giftCents + giftPart, creditCents: back.creditCents + creditPart } });
  }
  return { giftCents: onCard, creditCents: asCredit, toCreditFromGift };
}

/** One line for the order's history and the team's message. */
export function giveBackLine(o: any, g: NonCard): string {
  const parts: string[] = [];
  if (g.giftCents > 0) parts.push(`$${(g.giftCents / 100).toFixed(2)} back on gift card${o?.giftCardCode ? ` ${o.giftCardCode}` : ''}`);
  if (g.creditCents > 0) parts.push(`$${(g.creditCents / 100).toFixed(2)} back as store credit`);
  return parts.join(' and ');
}

/** The sale was booked as income (through the card payment), so what goes back by gift card or credit is a refund too. */
// Every order paid in one step has its sale in the books whatever paid for it (lib/order-paid booksAt); before that,
// only orders paid with a card did.
export const saleBooked = (o: any): boolean => !!(o?.booksAt || o?.stripeCheckoutSessionId || o?.stripePaymentIntentId);

// ── THE SERVER'S OWN RECORD of what an order took by gift card and store credit, written in the same step as the money
// is taken (lib/gift-cards spendGiftCard, lib/retail-webhook, api/retail/checkout), somewhere no browser can write
// (tenants/{t}/private/...). What goes back is worked out from it alone, never from the order's own fields: an order
// made in a browser can't claim a gift card or store credit it never used. An order paid before the record was kept
// gets one from what only the server writes (lib/non-card-record) before anything goes back.
export const nonCardRecordRef = (db: any, t: string, orderId: string) => db.doc(`tenants/${t}/private/nonCardPaid/orders/${orderId}`);

/** Records what the server just took for an order (in `tx` when given). */
export async function recordNonCard(db: any, t: string, orderId: string, part: { giftCents?: number; giftCardId?: string | null; creditCents?: number }, tx?: any): Promise<void> {
  const v: any = { at: iso() };
  if (part.giftCents != null) { v.giftCents = c0(part.giftCents); v.giftCardId = part.giftCardId || null; }
  if (part.creditCents != null) v.creditCents = c0(part.creditCents);
  const ref = nonCardRecordRef(db, t, orderId);
  if (tx) tx.set(ref, v, { merge: true }); else await ref.set(v, { merge: true });
}

/** The order as far as its gift card and store credit go: each part as the server's record has it, and a part it
 *  doesn't have was not paid that way. What its card paid stays as it was worked out before (an order from before
 *  that was recorded works it out from its gift card and credit fields, lib/retail-money), so a part that can't be
 *  confirmed never makes the card look as though it paid more. `get` is the database's own (a transaction's, inside one). */
export async function withNonCardRecord(get: (r: any) => Promise<any>, db: any, t: string, orderId: string, o: any): Promise<any> {
  const r = await get(nonCardRecordRef(db, t, orderId));
  const rec: any = r?.exists ? r.data() || {} : {};
  const gift = c0(rec.giftCents); const credit = c0(rec.creditCents);
  return {
    ...o, ...(o?.chargedCents == null ? { chargedCents: cardPaidCents(o) } : {}),
    giftCardId: (gift > 0 && rec.giftCardId) || o?.giftCardId || null, giftCardCents: gift, giftSpentAt: gift > 0 ? o?.giftSpentAt || rec.at || iso() : null,
    storeCreditRequestedCents: credit, creditShortfallCents: 0,
  };
}
