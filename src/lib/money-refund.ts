// src/lib/money-refund.ts — send a sale's refund back to the client's card (server).
// Finds the card payment behind a sale (on the transaction, or on the receipt for
// the same checkout) and refunds the amount on the business's connected account.
// Split payments are refunded card by card until the amount is covered. Every
// refund carries its own key, so a retry never refunds twice.
import { refundAmount } from '@/lib/stripe-refund';

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export type CardRefund = { ok: true; card: false } | { ok: true; card: true; refundedCents: number; shortCents: number } | { ok: false; error: string; status: number };

export async function refundSaleToCard(db: any, tenantId: string, tenant: any, transactionId: string, want: number, byName: string | null): Promise<CardRefund> {
  const T = `tenants/${tenantId}`; const xRef = db.doc(`${T}/transactions/${transactionId}`); const xSnap = await xRef.get();
  if (!xSnap.exists) return { ok: false, error: 'That sale wasn’t found.', status: 404 };
  const x: any = xSnap.data();
  if (x.refundedAt || x.voided) return { ok: false, error: 'This sale was already refunded.', status: 409 };
  if (String(x.paymentMethod || '').toLowerCase() === 'cash') return { ok: true, card: false };
  let cards: { pi: string; cents: number }[] = [];
  if (x.stripePaymentIntentId) cards = [{ pi: String(x.stripePaymentIntentId), cents: Math.round((num(x.amount) + num(x.tipAmount)) * 100) }];
  else if (x.checkoutSessionId) {
    const rs = await db.collection(`${T}/receipts`).where('checkoutSessionId', '==', String(x.checkoutSessionId)).limit(1).get();
    const r: any = rs.empty ? null : rs.docs[0].data();
    if (r && Array.isArray(r.payments) && r.payments.length) cards = r.payments.filter((p: any) => p.stripePaymentIntentId && !p.refundedAt).map((p: any) => ({ pi: String(p.stripePaymentIntentId), cents: Math.round((num(p.amount) + num(p.tip)) * 100) }));
    else if (r?.stripePaymentIntentId) cards = [{ pi: String(r.stripePaymentIntentId), cents: Math.round(num(r.total) * 100) }];
  }
  if (!cards.length) return { ok: true, card: false };
  const acct = tenant.stripeAccountId || tenant.stripeConnectAccountId || null;
  let left = Math.round(want); const done: { pi: string; cents: number; refundId?: string }[] = [];
  for (const c of cards) {
    if (left <= 0) break;
    const cents = Math.min(left, c.cents || left);
    const r = await refundAmount(acct, c.pi, cents, `money-refund-${transactionId}-${c.pi}-${cents}`);
    if (!r.ok) { if (!done.length) return { ok: false, error: r.error || 'The card refund didn’t go through.', status: 502 }; break; }
    done.push({ pi: c.pi, cents, refundId: r.id }); left -= cents;
  }
  const refunded = done.reduce((s, d) => s + d.cents, 0);
  await xRef.set({ cardRefunds: done.map((d) => ({ ...d, at: new Date().toISOString(), by: byName })) }, { merge: true }).catch(() => {});
  return { ok: true, card: true, refundedCents: refunded, shortCents: Math.max(0, Math.round(want) - refunded) };
}

// The visit's sale — the one a Making it right refund goes back against.
export async function saleForVisit(db: any, tenantId: string, appointmentId: string) {
  if (!appointmentId) return null;
  const qs = await db.collection(`tenants/${tenantId}/transactions`).where('appointmentId', '==', appointmentId).get();
  const rows = qs.docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((t: any) => t.type !== 'reversal' && t.type !== 'expense' && !t.refundedAt && !t.voided && num(t.amount) > 0);
  rows.sort((a: any, b: any) => num(b.amount) - num(a.amount));
  return rows[0] || null;
}
