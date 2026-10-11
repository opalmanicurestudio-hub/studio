// src/app/api/portal/pay-balance/route.ts — A CLIENT SETTLES WHAT THEY OWE, FOR REAL.
// Replaces the portal button that used to clear the balance and record it as
// paid WITHOUT taking any money. Now:
//   • the amount is the balance ON RECORD — never a number from the browser
//   • it's charged to their REAL saved card (Stripe payment method + customer)
//     on the business's connected account, off-session
//   • a lock + Stripe idempotency key mean a double tap can't charge twice
//   • the balance clears ONLY after Stripe confirms; otherwise nothing changes
//     and they're told they can settle it at their next visit
// Access: the portal's own model — the client's private link (their id).
// { useGift: true } spends the client's own gift cards first; { cardToo: true } then charges the card for what's left.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { hasRealCard } from '@/lib/card-on-file';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), clientId = String(b.clientId || '');
  if (!tenantId || !clientId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const cRef = db.doc(`${T}/clients/${clientId}`);
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  let later = 'You can settle it at your next visit instead.';

  // Lock: one payment attempt at a time for this client.
  const claim = await db.runTransaction(async (tx: any) => {
    const c = (await tx.get(cRef)).data() as any;
    if (!c) return { err: 'We couldn’t find your account.' };
    const cents = Math.round((Number(c.outstandingBalance) || 0) * 100);
    if (cents <= 0) return { err: 'You don’t owe anything — you’re all clear.', clear: true };
    if (c.balancePayingAt && Date.now() - Date.parse(c.balancePayingAt) < 2 * 60000) return { err: 'Your payment is already going through — give it a moment.' };
    tx.set(cRef, { balancePayingAt: new Date().toISOString() }, { merge: true });
    return { c, cents };
  });
  if ((claim as any).err) return NextResponse.json({ ok: (claim as any).clear === true, error: (claim as any).clear ? undefined : (claim as any).err, message: (claim as any).clear ? (claim as any).err : undefined });
  const { c } = claim as any; let { cents } = claim as any;
  const unlock = () => cRef.set({ balancePayingAt: null }, { merge: true }).catch(() => {});

  // Their gift cards first, when they asked: the cards given to THEM (renter-only cards excluded), soonest-to-expire
  // first. What the cards pay is recorded and taken off the balance straight away; the card on file covers the rest.
  let giftPaidCents = 0;
  if (b.useGift === true) {
    try {
      const { available, spendGiftCard, notifyGiftUse } = await import('@/lib/gift-cards');
      const snap = await db.collection(`${T}/giftCards`).where('recipientId', '==', clientId).get();
      const cards = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((g: any) => g.status === 'active' && !g.ownerRenterId && g.kind !== 'service' && available(g) > 0 && !(g.expiresAt && Date.parse(g.expiresAt) < Date.now()))
        .sort((a: any, z: any) => String(a.expiresAt || '9999').localeCompare(String(z.expiresAt || '9999')));
      for (const g of cards) {
        const want = Math.min(available(g), cents - giftPaidCents); if (want <= 0) break;
        const r: any = await spendGiftCard(db, tenantId, { id: g.id, cents: want, by: 'Client portal', transactionRef: `balance_${clientId}_${Date.now()}`, clientId });
        if (r?.ok) { giftPaidCents += want; void notifyGiftUse(db, tenantId, g.id, want).catch(() => {}); }
      }
    } catch (e: any) { console.error('[pay-balance] gift card', e?.message); }
    if (giftPaidCents > 0) {
      const nowIso = new Date().toISOString(); const left = cents - giftPaidCents;
      const txRef = db.collection(`${T}/transactions`).doc(); const batch = db.batch();
      batch.set(txRef, { id: txRef.id, tenantId, date: nowIso, description: 'Balance paid online with a gift card', clientOrVendor: c.name || null, clientId, type: 'income', context: 'Business', category: 'Fee Recovery', amount: giftPaidCents / 100, paymentMethod: 'Gift Card', hasReceipt: false });
      batch.set(cRef, { outstandingBalance: left / 100, ...(left <= 0 ? { unpaidFees: [], balancePaidAt: nowIso } : {}), balanceVersion: nowIso, ...(left <= 0 ? { balancePayingAt: null } : {}) }, { merge: true });
      await batch.commit();
      await logAuditAdmin(db, tenantId, { action: 'balance.paid_online', targetType: 'client', targetId: clientId, summary: `${c.name || 'Client'} paid $${(giftPaidCents / 100).toFixed(2)} of their balance with a gift card`, actor: { type: 'system', id: 'portal', name: c.name || 'Client' } as any }).catch(() => {});
      cents = left;
      if (left <= 0) return NextResponse.json({ ok: true, paidDollars: 0, giftDollars: giftPaidCents / 100 });
      later = `Your gift card paid $${(giftPaidCents / 100).toFixed(2)}; you can settle the other $${(left / 100).toFixed(2)} at your next visit.`;
    } else if (b.cardToo !== true) { await unlock(); return NextResponse.json({ ok: false, error: 'Your gift card couldn’t be used for this — nothing was taken.' }, { status: 409 }); }
    if (b.cardToo !== true) { await unlock(); return NextResponse.json({ ok: true, partial: true, giftDollars: giftPaidCents / 100, leftDollars: cents / 100 }); }
  }

  const pm = c.cardOnFile?.paymentMethodId || null;
  const customer = c.cardOnFile?.customerId || c.stripeCustomerId || null;
  if (!hasRealCard(c) || !pm || !customer || !tenant.stripeAccountId || !process.env.STRIPE_SECRET_KEY) {
    await unlock();
    return NextResponse.json({ ok: false, error: `There’s no card saved we can charge. ${later}`, code: 'no_card', giftDollars: giftPaidCents / 100 }, { status: 409 });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
  let intent: any;
  try {
    intent = await stripe.paymentIntents.create({
      amount: cents, currency: String(tenant.currency || 'usd').toLowerCase(), customer, payment_method: pm, off_session: true, confirm: true,
      description: `Balance payment — ${c.name || 'client'}`, metadata: { tenantId, clientId, kind: 'balance_payment' },
    }, { stripeAccount: tenant.stripeAccountId, idempotencyKey: `balance-${tenantId}-${clientId}-${cents}-${String(c.balanceVersion || c.updatedAt || '').slice(0, 40)}` });
  } catch (e: any) {
    await unlock();
    const declined = e?.code === 'card_declined' || e?.code === 'authentication_required' || e?.type === 'StripeCardError';
    await logAuditAdmin(db, tenantId, { action: 'balance.payment_failed', targetType: 'client', targetId: clientId, summary: `Online balance payment of $${(cents / 100).toFixed(2)} didn’t go through (${e?.code || 'error'}) — nothing cleared`, actor: { type: 'user', name: c.name || 'Client', role: 'client', via: 'portal' } }).catch(() => {});
    return NextResponse.json({ ok: false, error: declined ? `Your card was declined. ${later}` : `The payment didn’t go through. ${later}` }, { status: 402 });
  }
  if (intent?.status !== 'succeeded') {
    await unlock();
    return NextResponse.json({ ok: false, error: `The payment needs another step we can’t do here. ${later}` }, { status: 402 });
  }
  // Paid — NOW clear it, record it, and remember it.
  const nowIso = new Date().toISOString(); const dollars = cents / 100;
  const txRef = db.collection(`${T}/transactions`).doc();
  const batch = db.batch();
  batch.set(txRef, { id: txRef.id, tenantId, date: nowIso, description: 'Balance paid online', clientOrVendor: c.name || null, clientId, type: 'income', context: 'Business', category: 'Fee Recovery',
    amount: dollars, paymentMethod: 'Card on File', stripePaymentIntentId: intent.id, hasReceipt: false });
  batch.set(cRef, { outstandingBalance: 0, unpaidFees: [], balancePayingAt: null, balancePaidAt: nowIso, balanceVersion: nowIso }, { merge: true });
  await batch.commit();
  await logAuditAdmin(db, tenantId, { action: 'balance.paid_online', targetType: 'client', targetId: clientId, summary: `${c.name || 'Client'} paid their $${dollars.toFixed(2)} balance online (card •••• ${c.cardOnFile?.last4 || ''})`, actor: { type: 'user', name: c.name || 'Client', role: 'client', via: 'portal' } }).catch(() => {});
  return NextResponse.json({ ok: true, paidDollars: dollars, giftDollars: giftPaidCents / 100, last4: c.cardOnFile?.last4 || null });
}
