// src/lib/goodwill-credit.ts — STORE CREDIT FOR THE TROUBLE, GIVEN ON THE ORDER. The team gives a customer store credit
// from the order or its problem (a late parcel, a mix-up), worked out and saved here on the server, never by the screen:
// managers give any amount; anyone else on the team up to the shop's limit for the whole order (Policies, "Staff can
// give store credit up to", $25 unless set). The credit is kept by the customer's email and spent at checkout (lib/credit-pools);
// the order's history says who gave it and why. Asked twice with the same key, it's given once. Server only.

export const GOODWILL_MAX_CENTS = 500000;
const money = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;

/** The most someone who isn't a manager can give on one order, all told. */
export const staffCreditCap = (tenant: any): number => Math.max(0, Math.floor(Number(tenant?.retailSettings?.staffCreditCapCents ?? 2500) || 0));

export type GoodwillResult = { ok: boolean; status?: number; message: string; creditId?: string; cents?: number; already?: boolean; orderId?: string };

export async function giveGoodwillCredit(db: any, t: string, a: { orderId: string; cents: number; note?: string; key: string; ticketId?: string | null }, by: { id: string; name: string; boss: boolean }): Promise<GoodwillResult> {
  const cents = Math.floor(Number(a.cents) || 0);
  if (!(cents >= 1 && cents <= GOODWILL_MAX_CENTS)) return { ok: false, status: 400, message: `Pick an amount from $0.01 to ${money(GOODWILL_MAX_CENTS)}.` };
  const key = String(a.key || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!key) return { ok: false, status: 400, message: 'Try again.' };
  const note = String(a.note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const oRef = db.doc(`tenants/${t}/retailOrders/${a.orderId}`);
  const cRef = db.doc(`tenants/${t}/depositCredits/goodwill_${a.orderId}_${key}`);
  return db.runTransaction(async (tx: any): Promise<GoodwillResult> => {
    const [os, cs, ts] = [await tx.get(oRef), await tx.get(cRef), await tx.get(db.doc(`tenants/${t}`))];
    // Given already (a second tap, or a retry whose answer was lost).
    if (cs.exists) { const c: any = cs.data() || {}; return { ok: true, already: true, message: `${money(Number(c.amountCents) || 0)} store credit was given.`, creditId: cRef.id, cents: Number(c.amountCents) || 0, orderId: a.orderId }; }
    if (!os.exists) return { ok: false, status: 404, message: 'That order isn’t there any more.' };
    const o: any = os.data() || {};
    if (o.isTest === true) return { ok: false, status: 409, message: 'This is a test order.' };
    // A paid order only: never a checkout left unpaid.
    if (o.isDraft === true || o.stage === 'placed' || (o.stage === 'cancelled' && !o.paidAt)) return { ok: false, status: 409, message: 'This order was never paid, so there’s nothing to make up for.' };
    const email = String(o.customerEmail || '').toLowerCase().trim();
    if (!email) return { ok: false, status: 422, message: 'This order has no email, and store credit is kept by email. Add their email on the order first.' };
    const given = Math.max(0, Number(o.goodwillCents) || 0);
    if (!by.boss) {
      const cap = staffCreditCap(ts.exists ? ts.data() : {});
      if (given + cents > cap) {
        const left = Math.max(0, cap - given);
        return { ok: false, status: 403, message: cap <= 0 ? 'Only a manager can give store credit here.' : left > 0 ? `You can give up to ${money(left)} more on this order. A manager can give more.` : `${money(cap)} is the most you can give on an order. A manager can give more.` };
      }
    }
    const now = new Date().toISOString();
    tx.set(cRef, {
      id: cRef.id, tenantId: t, clientEmail: email, clientName: String(o.customerName || 'Guest').slice(0, 80), clientId: o.clientId || null,
      kind: 'store_credit', amountCents: cents, status: 'available', source: 'goodwill',
      retailOrderId: a.orderId, sourceSupportTicketId: a.ticketId || null, note: note || null,
      issuedBy: by.name, issuedById: by.id, createdAt: now,
    });
    tx.update(oRef, { goodwillCents: given + cents });
    const ev = db.collection(`tenants/${t}/retailOrders/${a.orderId}/events`).doc();
    tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: by.id, actorName: by.name, meta: { kind: 'goodwill_credit', cents, text: `${money(cents)} store credit given by ${by.name}${note ? `: ${note}` : ''}` } });
    return { ok: true, message: `${money(cents)} store credit given. It’s ready for ${String(o.customerName || 'them').split(' ')[0]} at checkout.`, creditId: cRef.id, cents, orderId: a.orderId };
  });
}
