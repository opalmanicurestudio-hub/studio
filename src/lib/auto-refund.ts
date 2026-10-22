// src/lib/auto-refund.ts — A REFUND THE SHOP'S RULES DECIDED GOES BACK ON ITS OWN when it's within the shop's automatic
// amount (Policies, "Refund on its own up to"): an item nobody answered about a swap for, a swap the customer turned
// down or one that cost less, a claim the shop's rules approved, a pre-order run that fell through. It asks the refund
// route (api/retail/refund) as the shop's own server, so the amount is checked again there and the refund is sent and
// recorded exactly as a tap would send it. Over the amount, for a replacement for a lost parcel, or when anything
// fails, the refund simply stays queued for the team. Server only.

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));

export type AutoRefund = { sent: boolean; cents: number; cardCents: number; otherCents: number; message?: string };
const NONE: AutoRefund = { sent: false, cents: 0, cardCents: 0, otherCents: 0 };

/** The shop's automatic amount, in cents (0: every refund waits for someone allowed to send it). */
export const autoRefundLimit = (tenant: any): number => c0(tenant?.retailSettings?.policies?.refundAutoBelowCents);

/** Sends what's queued on the order when it's within the shop's automatic amount. `origin` is this app's own address
 *  (the request's, or the configured one). Never throws. */
export async function autoRefund(db: any, t: string, orderId: string, origin?: string | null): Promise<AutoRefund> {
  const base = String(origin || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (!base || !process.env.CRON_SECRET || !t || !orderId) return NONE;
  try {
    const [tSnap, oSnap] = await Promise.all([db.doc(`tenants/${t}`).get(), db.doc(`tenants/${t}/retailOrders/${orderId}`).get()]);
    const limit = autoRefundLimit(tSnap.data());
    const o: any = oSnap.data() || {};
    const pending = c0(o.pendingRefundCents);
    if (!limit || !pending || pending > limit || o.replacementFor === 'lost_in_transit' || o.isTest) return NONE;
    const r = await fetch(`${base}/api/retail/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': String(process.env.CRON_SECRET) },
      body: JSON.stringify({ tenantId: t, orderId, qrToken: o.qrToken || '', reason: 'policy' }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) return NONE;
    return { sent: true, cents: c0(d.amountCents), cardCents: c0(d.cardCents), otherCents: c0(d.otherCents), message: d.message };
  } catch {
    return NONE;
  }
}

const money = (c: number) => `$${(c0(c) / 100).toFixed(2)}`;

/** The customer's words for a refund: on its way when it went, approved and coming when it's waiting. */
export function refundWords(cents: number, sent: AutoRefund | null): string {
  if (sent?.sent && sent.cents > 0) {
    const card = sent.cardCents; const other = sent.otherCents;
    if (!card && other) return `${money(sent.cents)} is back the way you paid, on your gift card or as store credit.`;
    if (card && other) return `${money(sent.cents)} is on its way back to you: ${money(card)} to your card, which most banks show within 5 to 10 business days, and ${money(other)} on your gift card or as store credit.`;
    return `${money(sent.cents)} is on its way back to your card. Most banks show it within 5 to 10 business days.`;
  }
  return `A refund of ${money(cents)} is approved. We’ll let you know as soon as it’s on its way.`;
}

/** The same, short enough for a text. */
export function refundWordsShort(cents: number, sent: AutoRefund | null): string {
  return sent?.sent && sent.cents > 0 ? `${money(sent.cents)} is on its way back to you.` : `A refund of ${money(cents)} is approved; we’ll tell you when it’s sent.`;
}
