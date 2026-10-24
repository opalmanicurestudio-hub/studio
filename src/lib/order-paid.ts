// src/lib/order-paid.ts — AN ONLINE ORDER BECOMES PAID IN ONE STEP (server).
// Every way an online order is paid ends here: a card payment (Stripe's notice, the five-minute check, the order
// page's own check: lib/retail-webhook), and an order paid in full with store credit or a gift card (checkout, which
// has no card payment to wait for). In one transaction:
//   · the order number (issued here and nowhere else, so the sequence has no gaps),
//   · the stock held for it (or a pre-order's place in its run), with its line in the stock ledger,
//   · the store credit it uses, from what's left on the customer's store credit, oldest first (never a booking's
//     deposit: lib/credit-pools), read in the same step, so two orders paying at once can't spend the same credit,
//   · the gift card it uses, spent from the card in the same step (lib/gift-cards giftSpendPlan),
//   · what it took by gift card and store credit, where only the server writes (lib/non-card-back),
//   · the order marked paid, its history, and its lines in the books (lib/order-books): the sale, the shipping
//     charged and the sales tax, whatever paid for it.
// Nothing is written half: if the step can't finish, none of it happened, and the next try (Stripe's retry, the
// five-minute check) does all of it. Only one try can win: an order that isn't 'placed' any more is left alone.
import { buildEvent, buildOrderQrValue } from '@/lib/retail-orders';
import { buildEntry } from '@/lib/stock-ledger';
import { giftSpendPlan } from '@/lib/gift-cards';
import { orderBookLines, orderParts } from '@/lib/order-books';
import { isStoreCredit, planCreditTake } from '@/lib/credit-pools';
import { makeQrToken } from '@/lib/order-qr';

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export type PayWith =
  /** A card payment Stripe confirmed (with any store credit and gift card the checkout set aside). */
  | { via: 'card'; session: any; chargeId: string | null; connAcct: string; clientId?: string | null;
      risk?: { level: string | null; score: number | null; reasons: string[]; hold: boolean } | null }
  /** Paid in full with store credit: no card payment. */
  | { via: 'store_credit'; cents: number }
  /** Paid in full with a gift card: no card payment. */
  | { via: 'gift_card'; gift: { id: string; code: string; cents: number } };

export type Paid =
  | { won: false; reason?: 'not_placed' | 'credit_short' | 'gift_failed'; error?: string }
  | { won: true; orderNumber: number; creditTaken: number; creditShortfall: number; giftSpent: number; giftShortfall: number; giftCardId: string | null; order: any };

/** Marks the order paid, once, with everything that goes with it (see above). */
export async function payOrder(db: any, tenantId: string, orderId: string, pay: PayWith, at = new Date().toISOString()): Promise<Paid> {
  const T = `tenants/${tenantId}`;
  const orderRef = db.doc(`${T}/retailOrders/${orderId}`);
  const counterRef = db.doc(`${T}/counters/retailOrders`);
  const recordRef = db.doc(`${T}/private/nonCardPaid/orders/${orderId}`);
  const out = await db.runTransaction(async (tx: any): Promise<Paid> => {
    // ── Reads (all of them before any write) ─────────────────────────────────
    const os = await tx.get(orderRef);
    if (!os.exists) return { won: false };
    const o: any = os.data() || {};
    if (o.stage !== 'placed') return { won: false };
    const lines: any[] = Array.isArray(o.lines) ? o.lines : [];
    const itemRefs = lines.map((l: any) => db.doc(`${T}/inventory/${String(l.productId)}`));
    // A variant pre-ordered in its listing's run takes a place in the listing's count (lib/variants asSold).
    const runIds = [...new Set(lines.filter((l: any) => l.preorder === true && l.digital !== true && l.preorderRunId).map((l: any) => String(l.preorderRunId)))].filter((id) => id && !id.includes('/'));
    const runRefs = new Map<string, any>(runIds.map((id) => [id, db.doc(`${T}/inventory/${id}`)]));
    const [counterSnap, itemSnaps, runSnaps] = await Promise.all([tx.get(counterRef), Promise.all(itemRefs.map((r: any) => tx.get(r))), Promise.all([...runRefs.values()].map((r: any) => tx.get(r)))]);
    const runSold = new Map<string, number>(runIds.map((id, k) => [id, runSnaps[k]?.exists ? Math.max(0, Math.floor(Number((runSnaps[k].data() || {}).preorderSold) || 0)) : -1]));

    // Store credit to take: what the checkout applied (a card payment), or the whole order (paid with credit).
    const creditWant = pay.via === 'store_credit' ? c0(pay.cents) : pay.via === 'card' ? c0(o.storeCreditRequestedCents) : 0;
    const email = String(o.customerEmail || '').toLowerCase().trim();
    let creditDocs: { ref: any; data: any }[] = [];
    if (creditWant > 0 && email) {
      const q = await tx.get(db.collection(`${T}/depositCredits`).where('clientEmail', '==', email).where('status', '==', 'available').limit(40));
      // Each one read on its own too, so a credit spent by another order meanwhile is seen (the step runs again).
      const fresh = await Promise.all((q?.docs || []).map((d: any) => tx.get(d.ref)));
      creditDocs = fresh.filter((s: any) => s?.exists).map((s: any) => ({ ref: s.ref, data: s.data() || {} })).filter((x: any) => isStoreCredit(x.data));
    }
    // The gift card to spend: the one the checkout set aside (a card payment), or the one paying for all of it.
    const giftId = pay.via === 'gift_card' ? String(pay.gift.id) : pay.via === 'card' && c0(o.giftCardCents) > 0 && o.giftCardId && !o.giftSpentAt ? String(o.giftCardId) : '';
    const giftWant = pay.via === 'gift_card' ? c0(pay.gift.cents) : giftId ? c0(o.giftCardCents) : 0;
    const giftRef = giftId ? db.doc(`${T}/giftCards/${giftId}`) : null;
    const [giftSnap, recSnap] = await Promise.all([giftRef ? tx.get(giftRef) : Promise.resolve(null), tx.get(recordRef)]);
    const rec: any = recSnap?.exists ? recSnap.data() || {} : null;

    // ── What store credit and the gift card can pay, worked out before anything is written ────────────────────
    // From what's left on the customer's store credit, oldest first; the gift card from what's on it (its own hold
    // for this order doesn't count against it).
    const plan = planCreditTake(creditDocs.map((x) => x.data), creditWant, Date.parse(at) || Date.now());
    const creditTaken = creditWant > 0 ? plan.taken : 0;
    const creditShortfall = Math.max(0, creditWant - creditTaken);
    // Paid with store credit alone: all of it must be there, or it isn't paid this way (checkout takes a card instead).
    if (pay.via === 'store_credit' && creditShortfall > 0) return { won: false, reason: 'credit_short' };
    const giftCode = pay.via === 'gift_card' ? pay.gift.code : String(o.giftCardCode || '');
    const g = giftRef && giftWant > 0
      ? giftSpendPlan(giftSnap?.exists ? { ...(giftSnap.data() || {}), id: giftId } : null, rec, { cents: giftWant, holdId: `retail_${orderId}`, by: 'Online shop', transactionRef: pay.via === 'card' ? String(pay.session?.id || orderId) : orderId, giftCardId: giftId })
      : null;
    // Paid with the gift card alone: it must pay all of it.
    if (pay.via === 'gift_card' && (!g || !g.ok || g.cents < giftWant)) return { won: false, reason: 'gift_failed', error: g && !g.ok ? g.error : 'The gift card couldn’t pay for it.' };

    // ── The number, and the stock ────────────────────────────────────────────
    // A legacy order that already carries a number keeps it (the counter follows, so no number is issued twice).
    const counter = (counterSnap?.exists ? Number(counterSnap.data()?.value) : 0) || 0;
    const number = typeof o.orderNumber === 'number' && o.orderNumber > 0 ? o.orderNumber : counter + 1;
    tx.set(counterRef, { value: Math.max(counter, number) }, { merge: true });
    // Two lines can be the same shelf item (one product, different options): they add up, never overwrite.
    const held = new Map<string, number>(); const run = new Map<string, number>();
    itemSnaps.forEach((snap: any, i: number) => {
      const l = lines[i];
      if (!snap?.exists) { console.warn(`[order-paid] item ${l?.productId} missing: nothing held for it`); return; }
      if (l.digital === true) return;
      const pid = String(l.productId); const q = c0(l.qtyOrdered); const item: any = snap.data() || {};
      // A pre-order takes a place in its run, not shelf stock that doesn't exist yet (claimed here, so two people
      // paying at once can't both take the last place).
      if (l.preorder === true) {
        const rid = String(l.preorderRunId || '');
        // The listing's run, whether the line is a variant on it or the listing itself: counted once, written once.
        const runKey = rid && (runSold.get(rid) ?? -1) >= 0 ? rid : (runSold.get(pid) ?? -1) >= 0 ? pid : '';
        if (runKey) { runSold.set(runKey, (runSold.get(runKey) || 0) + q); return; }
        const sold = Math.max(0, Math.floor(Number(item.preorderSold) || 0)) + (run.get(pid) || 0);
        tx.update(itemRefs[i], { preorderSold: sold + q }); run.set(pid, (run.get(pid) || 0) + q); return;
      }
      const cur = (Number(item.stockReserved) || 0) + (held.get(pid) || 0);
      tx.update(itemRefs[i], { stockReserved: cur + q }); held.set(pid, (held.get(pid) || 0) + q);
      // Both halves of a hold are on record (this one, and its release at fulfilment), so a leak can be found.
      tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({
        productId: pid, type: 'reserved', field: 'stockReserved', delta: q, unit: item.unit || 'units',
        reason: `Held for online order #${number}`, actorId: 'system', actorName: 'Checkout', ref: { kind: 'order', id: orderId }, balanceAfter: cur + q,
      }));
    });

    for (const [rid, sold] of runSold) if (sold >= 0) tx.update(runRefs.get(rid), { preorderSold: sold });

    // ── Store credit: from what's left, oldest first ──────────────────────────
    for (const t of plan.takes) {
      const d = creditDocs[t.index];
      tx.set(d.ref, { usedCents: t.usedAfter, status: t.used ? 'used' : 'available', lastUsedAt: at, lastUsedOnRetailOrderId: orderId }, { merge: true });
    }

    // ── The gift card: spent in the same step ─────────────────────────────────
    let giftSpent = 0; let giftShortfall = 0; let giftNote = '';
    if (g) {
      if (g.ok) {
        giftSpent = g.cents;
        if (!g.already && g.cents > 0) tx.update(giftRef!, g.patch);
        giftNote = `Gift card ${giftCode}: ${money(giftSpent)} redeemed`;
      } else { giftShortfall = giftWant; giftNote = `Gift card ${giftCode} couldn’t be charged (${money(giftWant)}): ${g.error} Needs a look.`; }
    }
    // What it really took by gift card and store credit, where only the server writes: what a refund or cancellation
    // gives back (lib/non-card-back).
    if (creditWant > 0 || giftSpent > 0) {
      tx.set(recordRef, { at, ...(creditWant > 0 ? { creditCents: creditTaken } : {}), ...(giftSpent > 0 ? { giftCents: giftSpent, giftCardId: giftId } : {}) }, { merge: true });
    }

    // ── The order, paid ───────────────────────────────────────────────────────
    const stripeTax = o.taxMode === 'stripe' && pay.via === 'card';
    const session = pay.via === 'card' ? pay.session : null;
    const sessionTax = stripeTax ? c0(session?.total_details?.amount_tax) : null;
    const charged = pay.via === 'card' ? (session?.amount_total != null ? c0(session.amount_total) : null) : 0;
    const piId = session ? (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null) : null;
    const qrToken = makeQrToken(orderId);
    const digitalOnly = o.digitalOnly === true;
    const risk = pay.via === 'card' ? pay.risk || null : null;
    // The sale is what the order sold for: the items after any promo code, shipping, tax and tip. Store credit and gift
    // cards pay for part of it; they don't make it smaller (with Stripe Tax too: its tax is written back here).
    const withTax = { ...o, ...(sessionTax != null ? { taxCents: sessionTax } : {}) };
    const parts = orderParts(withTax);
    const tenders = { cardCents: charged || 0, creditCents: creditTaken, giftCents: giftSpent };
    const paid = {
      orderNumber: number, isDraft: false, stage: digitalOnly ? 'completed' : 'paid', paidAt: at, ...(digitalOnly ? { completedAt: at } : {}),
      qrToken, totalCents: parts.totalCents, ...(sessionTax != null ? { taxCents: sessionTax } : {}),
      ...(charged != null ? { chargedCents: charged } : {}),
      paidVia: pay.via, tenders,
      ...(creditWant > 0 ? { storeCreditRequestedCents: creditWant, creditShortfallCents: creditShortfall } : {}),
      ...(pay.via === 'gift_card' ? { giftCardId: giftId, giftCardCode: pay.gift.code, giftCardCents: giftWant, storeCreditRequestedCents: 0 } : {}),
      ...(giftSpent > 0 ? { giftSpentAt: at } : {}), ...(giftShortfall > 0 ? { giftShortfallCents: giftShortfall } : {}),
      ...(pay.via === 'card' ? { clientId: pay.clientId || o.clientId || null, stripePaymentIntentId: piId, stripeCheckoutSessionId: session?.id || o.stripeCheckoutSessionId || null } : {}),
      ...(risk ? { riskCheck: { at, level: risk.level, score: risk.score, reasons: risk.reasons } } : {}),
      ...(risk?.hold ? { holdForReview: true, holdAuto: true, holdReason: risk.reasons.join(' · '), heldAt: at, heldBy: 'Automatic check' } : {}),
      booksAt: at,
    };
    tx.update(orderRef, paid);

    // ── Its history ───────────────────────────────────────────────────────────
    const ev = (data: any) => { const r = orderRef.collection('events').doc(); tx.set(r, { id: r.id, ...data }); };
    if (pay.via === 'card') {
      // What the card should have paid: the order, less the store credit and gift card the checkout took off.
      const expectedCard = Math.max(0, parts.totalCents - creditWant - giftWant);
      if (charged != null && charged !== expectedCard) console.warn(`[order-paid] order ${orderId}: card paid ${charged}, expected ${expectedCard}`);
      ev(buildEvent('payment_confirmed', 'system', 'Stripe', { checkoutSessionId: String(session?.id || ''), amountCents: charged ?? expectedCard, amountMatched: charged == null || charged === expectedCard }));
    } else {
      ev({ type: 'paid', at, actorId: 'system', actorName: pay.via === 'store_credit' ? 'Store credit' : 'Gift card',
        meta: { text: pay.via === 'store_credit' ? `Paid in full with store credit: ${money(creditTaken)} redeemed, nothing charged` : `Paid in full with gift card ${pay.gift.code}: ${money(giftSpent || giftWant)} redeemed, nothing charged` } });
    }
    ev(buildEvent('stock_reserved', 'system', 'Retail Engine', { lineCount: lines.length, units: lines.reduce((a: number, l: any) => a + c0(l.qtyOrdered), 0), qr: buildOrderQrValue(qrToken) }));
    if (pay.via === 'card' && creditWant > 0) ev({ type: 'note', at, actorId: 'system', actorName: 'Store credit',
      meta: { text: creditShortfall > 0 ? `Store credit: ${money(creditTaken)} of the ${money(creditWant)} discount was still available. ${money(creditShortfall)} short needs a look.` : `Store credit applied: ${money(creditTaken)} redeemed` } });
    if (pay.via === 'card' && giftNote) ev({ type: 'note', at, actorId: 'system', actorName: 'Gift card', meta: { text: giftNote } });
    if (digitalOnly) ev({ type: 'note', at, actorId: 'system', actorName: 'Digital delivery', meta: { text: 'Digital order: delivered by email on payment, nothing to fulfil' } });

    // ── Its lines in the books ────────────────────────────────────────────────
    const books = orderBookLines({ ...withTax, orderNumber: number }, {
      tenantId, orderId, at, tenders, clientId: pay.via === 'card' ? pay.clientId || o.clientId || null : o.clientId || null,
      chargeId: pay.via === 'card' ? pay.chargeId : null, sessionId: pay.via === 'card' ? String(session?.id || '') || null : null, connAcct: pay.via === 'card' ? pay.connAcct : null,
    });
    for (const b of books) tx.set(db.doc(`${T}/transactions/${b.id}`), b.data);

    return { won: true, orderNumber: number, creditTaken, creditShortfall, giftSpent, giftShortfall, giftCardId: giftId || null, order: { ...o, ...paid, id: orderId } };
  });
  return out;
}
