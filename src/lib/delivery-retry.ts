// src/lib/delivery-retry.ts — WHEN A DELIVERY COULDN'T BE MADE: WHAT THE CUSTOMER CAN DO NEXT (pure). Read by the order
// page (mockup 7B), the server that carries out their choice (lib/delivery-retry-server, api/retail/delivery-choice) and
// a cancellation (api/retail/self-serve). Three choices while it's back at the shop:
//   · Try again in an open delivery window: free, or the order's own delivery fee again, by the shop's second-try rule
//     (lib/delivery-plan secondTry) for whose side it failed on (lib/delivery-run FAIL_REASONS).
//   · Pick it up at the shop: free, with their pickup code.
//   · Cancel: their items back to the card.
// The delivery fee paid for the try that failed is kept when it failed on the customer's side, and comes back on a pickup
// or a cancellation when it failed on the shop's. That fee is the order's own for the first try, a second try's own
// payment when one was paid for, or the first one carried over to a free second try after the shop's failure; a free
// second try after the customer's failure has none (the first fee went on the first try).
import type { FailCause } from '@/lib/delivery-run';

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));

/** Whose side the last try failed on (an unknown reason counts as the shop's). */
export const failCauseOf = (order: any): FailCause => (order?.delivery?.failCause === 'customer' ? 'customer' : 'shop');

/** The customer can choose: a delivery back at the shop after a try, not yet sent out again or finished. */
export function canChoose(order: any): boolean {
  return order?.method === 'delivery' && order?.delivery?.status === 'failed' && ['packed', 'ready'].includes(String(order?.stage || ''));
}

/** A second try's payment page is open (or was very recently). */
export const retryPayOpen = (order: any): boolean => order?.delivery?.retryPay?.status === 'awaiting_payment';

/** The delivery fee paid for the try that just failed, and where it was paid: 'order' (with the order) or a second
 *  try's own payment (its key). null when nothing was paid for it. */
export function feeOnTry(order: any): { cents: number; from: string } | null {
  const d = order?.delivery || {};
  if (!Object.prototype.hasOwnProperty.call(d, 'feeFor')) { const c = orderFeeLeft(order); return c > 0 ? { cents: c, from: 'order' } : null; }
  const f = d.feeFor;
  // The order's own fee carried to this try: no more than is left of it (a shipping refund since gave some back).
  const cents = f && String(f.from || 'order') === 'order' ? Math.min(c0(f?.cents), orderFeeLeft(order)) : c0(f?.cents);
  return f && cents > 0 ? { cents, from: String(f.from || 'order') } : null;
}

/** What another try costs: the order's own delivery fee (a window, never the "within minutes" charge) when the shop's
 *  rule for that side says so, else free. Too little to pay by card is free. */
export function retryCents(order: any, plan: any): number {
  const st = plan?.secondTry || {};
  const charge = failCauseOf(order) === 'customer' ? st.customer !== 'free' : st.shop === 'charge';
  const c = charge ? c0(order?.delivery?.feeCents) : 0;
  return c >= 50 ? c : 0;
}

/** The fee the next try carries: what they pay for it, else the failed try's own when that was the shop's side. */
export function feeForNext(order: any, paid: { cents: number; from: string } | null): { cents: number; from: string } | null {
  if (paid && c0(paid.cents) > 0) return { cents: c0(paid.cents), from: paid.from };
  return failCauseOf(order) === 'shop' ? feeOnTry(order) : null;
}

/** On a pickup or a cancellation: the delivery fee that comes back (the try failed on the shop's side). */
export function feeBack(order: any): { cents: number; from: string } | null {
  return failCauseOf(order) === 'shop' ? feeOnTry(order) : null;
}

/** The order's own delivery fee not yet given back (a shipping refund, by the route or marked by hand). */
export const orderFeeLeft = (order: any): number => Math.max(0, c0(order?.shippingCents) - c0(order?.shippingRefundedCents) - c0(order?.deliveryFeeBackHandCents));

/** What a cancellation keeps off the order's own card refund: what's left of its delivery fee, unless that's the one
 *  coming back. (The cancellation keeps no more than the card has left to refund: api/retail/self-serve.) */
export function keptFromCard(order: any): number {
  const b = feeBack(order);
  return b && b.from === 'order' ? 0 : orderFeeLeft(order);
}

/** Every second-try payment written on the order, by key. */
export const retryPaidOf = (order: any): Record<string, any> => (order?.deliveryRetryPaid && typeof order.deliveryRetryPaid === 'object' ? order.deliveryRetryPaid : {});

/** The second-try payments that stay with the shop if they cancel or pick it up now (every one not coming back). */
export function keptPaidKeys(order: any): string[] {
  const b = feeBack(order);
  return Object.entries(retryPaidOf(order)).filter(([k, e]) => e && !e.refundedAt && ['applied', 'kept'].includes(String(e.state)) && !(b && b.from === k)).map(([k]) => k);
}

/** What they've paid for delivery that stays with the shop if they cancel or pick it up now. */
export function keptCents(order: any, fromCard: number = keptFromCard(order)): number {
  const paid = retryPaidOf(order);
  return c0(fromCard) + keptPaidKeys(order).reduce((s, k) => s + c0(paid[k]?.cents), 0);
}

/** A window's label in a sentence: "today 5–7 pm", "tomorrow 10 am–12 pm", or the day as it is ("Sat Nov 1, 2–4 pm"). */
export const whenInSentence = (label: string): string => String(label || '').replace(/^(Today|Tomorrow)\b/, (m) => m.toLowerCase());

const money = (c: number) => `$${(c0(c) / 100).toFixed(2)}`;

/** The words under each choice, as the order page shows them (mockup 7B). `cardCents` is what the order's card can
 *  still give back (null when it can't be said here, for an order made from another). */
export function choiceWords(order: any, plan: any, o: { cardCents: number | null; pickup: boolean; withWhy?: boolean }): { retry: string; pickup: string | null; cancel: string; footer: string | null } {
  const cause = failCauseOf(order);
  const fee = retryCents(order, plan);
  const back = feeBack(order);
  // The cancellation keeps no more of the order's own fee than the card has left to give back.
  const keptCard = o.cardCents === null ? keptFromCard(order) : Math.min(keptFromCard(order), c0(o.cardCents));
  const kept = keptCents(order, keptCard);
  // Why it failed is said only to whoever has the customer's pass (the order page's rule for the reason).
  const why = o.withWhy === false ? '' : order?.delivery?.failCode === 'no_answer' ? 'no one was home' : order?.delivery?.failCode === 'no_access' ? 'the driver couldn’t get in' : order?.delivery?.failCode === 'bad_address' ? 'the address couldn’t be found' : '';
  const retry = fee > 0 ? `${money(fee)} delivery fee again${cause === 'customer' && why ? `, because ${why}` : ''}.` : 'Free. Choose a time below.';
  const pickup = !o.pickup ? null : back ? `Free, ready now. Your ${money(back.cents)} delivery fee goes back to your card.` : 'Free, ready now. Bring your pickup code.';
  // The card refund, less the order's own delivery fee when that's coming back with it (said on its own).
  // Paid partly by gift card or store credit: that part goes back that way, so no one card amount is said.
  const mixed = c0(order?.giftCardCents) + c0(order?.storeCreditRequestedCents) > 0;
  const itemsCents = o.cardCents === null || mixed ? null : Math.max(0, c0(o.cardCents) - keptCard - (back && back.from === 'order' ? back.cents : 0));
  const what = c0(order?.tipCents) > 0 ? 'your items and the tip' : 'your items';
  const items = itemsCents === null ? `${what.charAt(0).toUpperCase()}${what.slice(1)} go` : `${money(itemsCents)} for ${what}`;
  const to = mixed ? 'the way you paid' : 'to your card';
  const cancel = back
    ? `${items} back ${to}, with the ${money(back.cents)} delivery fee${kept > 0 ? ' for the last try' : ''}.${kept > 0 ? ` The ${money(kept)} for the earlier try isn’t refunded.` : ''}`
    : `${items} back ${to}.${kept > 0 ? ` The ${money(kept)} delivery fee isn’t refunded.` : ''}`;
  const st = plan?.secondTry || {};
  const footer = st.shop === 'charge' ? null : 'If a delivery fails on our side, trying again is free.';
  return { retry, pickup, cancel, footer };
}
