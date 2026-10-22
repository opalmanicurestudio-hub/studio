// src/lib/non-card-record.ts — AN ORDER WITH NO RECORD OF ITS GIFT CARD OR STORE CREDIT PART (one paid before the
// record was kept, lib/non-card-back): what it really took that way is found in what only the server writes, and
// recorded, before anything goes back that way. The order's own fields are only ever a reason to look, never the amount:
//   · the gift card part is a spend in the gift card's own history made for this order: at checkout (marked with the
//     order, and made within the hour after the order was: a browser can choose an order's id, never when it was made),
//     or with the order's card payment (marked with its payment page, which Stripe confirms is this order's);
//   · the store credit part is credit marked as used on this order after it was added (the server's step when the order
//     was paid: a browser can add credit, never mark it used).
// What can't be found doesn't go back that way: the order's history says so once, for someone to check and give back
// by hand. Server only, outside any transaction.
import Stripe from 'stripe';

import { nonCardPaid, nonCardRecordRef } from './non-card-back';
import { isFollowUp } from './order-family';

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const HOUR = 3600000;

export type NonCardCheck = { unconfirmed: { giftCents: number; creditCents: number }; retry: boolean };

/** Whether Stripe's payment page `sid` was this order's: true or false, or null when Stripe couldn't be asked. */
async function pageIsOrder(db: any, t: string, sid: string, orderId: string): Promise<boolean | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const tenant = (await db.doc(`tenants/${t}`).get()).data() || {};
  const acct = String(tenant.stripeAccountId || tenant.stripeConnectAccountId || '');
  if (!acct) return null;
  try {
    const stripe: any = new Stripe(key, { apiVersion: '2024-06-20' as any, timeout: 15000, maxNetworkRetries: 1 });
    const s: any = await stripe.checkout.sessions.retrieve(sid, {}, { stripeAccount: acct });
    const m = s?.metadata || {};
    return String(m.retailOrderId || '') === orderId && (!m.tenantId || String(m.tenantId) === t);
  } catch (e: any) {
    // No such payment page on the shop's account: it isn't this order's. Anything else: ask again another time.
    return e?.type === 'StripeInvalidRequestError' && (e?.statusCode === 404 || e?.code === 'resource_missing') ? false : null;
  }
}

/** Makes sure the server's record has every gift card and store credit part `orderId` really paid (`o` is the order, when
 *  already read). Returns what its fields show that couldn't be found, and `retry` when Stripe couldn't be asked. */
export async function ensureNonCardRecord(db: any, t: string, orderId: string, o?: any): Promise<NonCardCheck> {
  const none: NonCardCheck = { unconfirmed: { giftCents: 0, creditCents: 0 }, retry: false };
  const ref = nonCardRecordRef(db, t, orderId);
  const rs = await ref.get();
  const rec: any = rs.exists ? rs.data() || {} : {};
  let order: any = o;
  if (!order) {
    const os = await db.doc(`tenants/${t}/retailOrders/${orderId}`).get();
    if (!os.exists) return none;
    order = os.data() || {};
  }
  // An order made from another one paid nothing itself: what it's owed goes back the way the order it came from paid.
  if (isFollowUp(order)) return none;
  // What its fields say it paid that way (shown), and what it may have, worth looking for: a gift card spend whose
  // stamp on the order didn't get written, say.
  const shown = nonCardPaid(order);
  const creditCap = Math.max(0, c0(order.storeCreditRequestedCents) - (order.creditShortfallCents != null ? c0(order.creditShortfallCents) : 0));
  const needGift = rec.giftCents == null && !!order.giftCardId && c0(order.giftCardCents) > 0;
  const needCredit = rec.creditCents == null && creditCap > 0;
  if (!needGift && !needCredit) return none;

  let gift = 0; let credit = 0; let retry = false;
  if (needGift) {
    const gs = await db.doc(`tenants/${t}/giftCards/${String(order.giftCardId)}`).get();
    const history: any[] = gs.exists && Array.isArray(gs.data()?.history) ? gs.data().history : [];
    const spends = history.filter((h: any) => h && h.type === 'spend' && h.ref);
    const sum = (hs: any[]) => hs.reduce((s: number, h: any) => s + c0(-Number(h.cents)), 0);
    const spent = (mark: string) => sum(spends.filter((h: any) => String(h.ref) === mark));
    // Marked with the order: spent at checkout, moments after the order was made there. One made before the order
    // existed, or long after, was for something else that happens to share the mark.
    const direct = spends.filter((h: any) => String(h.ref) === orderId);
    if (direct.length) {
      const made = (await db.doc(`tenants/${t}/retailOrders/${orderId}`).get())?.createTime?.toMillis?.();
      gift = sum(direct.filter((h: any) => { const at = Date.parse(String(h.at || '')); return Number.isFinite(made) && Number.isFinite(at) && at >= made - 60000 && at <= made + HOUR; }));
    }
    const sid = String(order.stripeCheckoutSessionId || '').trim();
    const viaPage = sid && sid !== orderId ? spent(sid) : 0;
    if (viaPage > 0) {
      const mine = await pageIsOrder(db, t, sid, orderId);
      if (mine === null) retry = true; else if (mine) gift += viaPage;
    }
  }
  if (needCredit) {
    const cs = await db.collection(`tenants/${t}/depositCredits`).where('lastUsedOnRetailOrderId', '==', orderId).limit(50).get();
    // Changed after it was added: marked used by the server. One added from a browser already marked used doesn't count.
    const used = cs.docs.filter((d: any) => {
      const made = d.createTime?.toMillis?.(); const changed = d.updateTime?.toMillis?.();
      return Number.isFinite(made) && Number.isFinite(changed) && changed > made;
    }).reduce((s: number, d: any) => s + c0(d.data()?.usedCents), 0);
    credit = Math.min(used, creditCap);
  }

  const unconfirmed = {
    giftCents: needGift && !retry ? Math.max(0, shown.giftCents - gift) : 0,
    creditCents: needCredit ? Math.max(0, shown.creditCents - credit) : 0,
  };
  // Said once, and only once everything could be checked.
  const note = !retry && unconfirmed.giftCents + unconfirmed.creditCents > 0 && !rec.unconfirmedNotedAt;
  if (gift > 0 || credit > 0 || note) {
    const orderRef = db.doc(`tenants/${t}/retailOrders/${orderId}`);
    await db.runTransaction(async (tx: any) => {
      const s = await tx.get(ref);
      const cur: any = s.exists ? s.data() || {} : {};
      const now = new Date().toISOString();
      const v: any = {};
      if (needGift && gift > 0 && cur.giftCents == null) { v.giftCents = gift; v.giftCardId = String(order.giftCardId); }
      if (needCredit && credit > 0 && cur.creditCents == null) v.creditCents = credit;
      const noteNow = note && !cur.unconfirmedNotedAt;
      if (noteNow) v.unconfirmedNotedAt = now;
      if (!Object.keys(v).length) return;
      const found = v.giftCents != null || v.creditCents != null;
      tx.set(ref, { ...v, ...(found ? { at: cur.at || order.giftSpentAt || order.paidAt || now, from: 'history' } : {}) }, { merge: true });
      if (noteNow) {
        const parts = [
          unconfirmed.giftCents ? `${money(unconfirmed.giftCents)} paid by gift card, but no matching charge was found on the gift card` : '',
          unconfirmed.creditCents ? `${money(unconfirmed.creditCents)} paid by store credit, but no matching use of the customer’s store credit was found` : '',
        ].filter(Boolean);
        const ev = orderRef.collection('events').doc();
        tx.set(ev, {
          id: ev.id, type: 'note', at: now, actorId: 'system', actorName: 'Payment check',
          meta: { kind: 'non_card_unconfirmed', giftCents: unconfirmed.giftCents, creditCents: unconfirmed.creditCents,
            text: `This order shows ${parts.join(', and ')}. That part won’t go back on its own: if it was paid, give it back by hand.` },
        });
      }
    });
  }
  return { unconfirmed, retry };
}
