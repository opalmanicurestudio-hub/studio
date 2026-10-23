// src/app/api/portal/pay-balance/route.ts — A CLIENT SETTLES WHAT THEY OWE, FOR REAL.
// Replaces the portal button that used to clear the balance and record it as
// paid WITHOUT taking any money. Now:
//   • the amount is the balance ON RECORD — never a number from the browser
//   • it's charged to their REAL saved card (Stripe payment method + customer)
//     on the business's connected account, off-session
//   • the balance and every fee on it are claimed first, through the same lock every other way of paying a fee uses
//     (lib/fee-pay): while a fee is being charged another way (automatic collection, the desk), this waits; while this
//     is going through, nothing else can take them. A double tap is told it's already going through.
//   • Stripe gets one key for this balance, amount and card, so a retry after a lost answer is the same charge
//   • the balance clears ONLY after Stripe confirms, by what was paid: the fees it was for come off, a fee added
//     meanwhile stays, and anything paid beyond what's owed by then (a fee paid another way at the same moment) is
//     refunded. Stripe saying no changes nothing, and they're told they can settle it at their next visit; no answer
//     from Stripe keeps the claim, and asking again finds that payment rather than charging again.
// Access: proof the caller is this client (or their business), never just the ids:
//   • k = the visit token (checkInToken) of one of THIS client's appointments, or
//   • k = the signed portal key for this client (lib/portal-key), or
//   • a signed-in staff member of this business.
// { useGift: true } spends the client's own gift cards first; { cardToo: true } then charges the card for what's left.
// What the gift cards pay is spent and recorded once for this claim (asked again, the same spends are found).
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { hasRealCard } from '@/lib/card-on-file';
import { verifyStaffActor } from '@/lib/staff-auth';
import { checkPortalKey, portalKeysReady } from '@/lib/portal-key';
import { chargeClaimedFees, claimFees, releaseFeeClaim, resolveStaleFees } from '@/lib/fee-pay';
import { available, spendGiftCard, notifyGiftUse } from '@/lib/gift-cards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), clientId = String(b.clientId || '');
  if (!tenantId || !clientId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;

  // Who's asking: staff of this business, or the client holding proof of their own link.
  const k = typeof b.k === 'string' ? b.k.trim().slice(0, 200) : '';
  let allowed = false; let staffName: string | null = null;
  if (req.headers.get('authorization')) {
    const staff: any = await verifyStaffActor(req, tenantId);
    if (staff.ok) { allowed = true; staffName = staff.actor?.name || 'Front desk'; }
  }
  if (!allowed && k) {
    const visit = await db.collection(`${T}/appointments`).where('checkInToken', '==', k).limit(1).get().catch(() => null);
    const appt: any = visit && !visit.empty ? visit.docs[0].data() : null;
    if (appt && String(appt.clientId || '') === clientId) allowed = true;
  }
  if (!allowed && k) {
    if (!portalKeysReady()) return NextResponse.json({ ok: false, error: 'Payments by link are not set up yet.' }, { status: 503 });
    if (checkPortalKey(tenantId, clientId, k)) allowed = true;
  }
  if (!allowed) return NextResponse.json({ ok: false, error: 'For your security, please open this page from the link we sent you, or settle your balance at your next visit.', code: 'needs_link' }, { status: 403 });

  const cRef = db.doc(`${T}/clients/${clientId}`);
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const stripe: any = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any }) : null;
  let later = 'You can settle it at your next visit instead.';
  const giftOnly = b.useGift === true && b.cardToo !== true;

  // The claim: the whole balance and every fee on it, for this payment only.
  const ask = () => claimFees(db, tenantId, { clientId, feeIds: 'all', source: 'balance', by: staffName || 'Client portal', allowNoCard: b.useGift === true });
  let cl = await ask();
  if (!cl.ok && cl.why === 'stale' && stripe) { await resolveStaleFees(db, stripe, tenantId, tenant, clientId).catch(() => null); cl = await ask(); }
  if (!cl.ok) {
    if (cl.why === 'paid') return NextResponse.json({ ok: true, message: 'You don’t owe anything — you’re all clear.' });
    if (cl.why === 'no_client') return NextResponse.json({ ok: false, error: 'We couldn’t find your account.' });
    if (cl.why === 'no_card') return NextResponse.json({ ok: false, error: `There’s no card saved we can charge. ${later}`, code: 'no_card', giftDollars: 0 }, { status: 409 });
    return NextResponse.json({ ok: false, code: cl.why === 'stale' ? 'unconfirmed' : 'in_progress', error: cl.why === 'stale' ? 'A payment on this balance is still being confirmed. Please try again in a couple of minutes.' : 'Your payment is already going through — give it a moment.' }, { status: 409 });
  }
  const claim = cl.claim; const c = claim.client; const cents = claim.cents;
  const release = (declined = false) => releaseFeeClaim(db, tenantId, claim, { declined }).catch(() => {});

  // Their gift cards first, when they asked: the cards given to THEM (renter-only cards excluded), soonest-to-expire
  // first. Each card's spend is recorded against this claim, so asking again never spends it twice; what they pay is
  // recorded and comes off the balance (and off their fees, oldest first) in one step.
  let giftPaidCents = 0;
  if (b.useGift === true) {
    try {
      const snap = await db.collection(`${T}/giftCards`).where('recipientId', '==', clientId).get();
      const cards = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((g: any) => g.status === 'active' && !g.ownerRenterId && g.kind !== 'service' && !g.promo && !((tenant as any)?.giftCardSettings?.advancedLimits === true && g.limits) && available(g) > 0 && !(g.expiresAt && Date.parse(g.expiresAt) < Date.now()))
        .sort((a: any, z: any) => String(a.expiresAt || '9999').localeCompare(String(z.expiresAt || '9999')));
      for (const g of cards) {
        const want = Math.min(available(g), cents - giftPaidCents); if (want <= 0) break;
        const r: any = await spendGiftCard(db, tenantId, { id: g.id, cents: want, by: 'Client portal', transactionRef: `balance_${claim.key}`, clientId, record: db.doc(`${T}/feeCharges/${claim.key}/giftSpends/${g.id}`) });
        if (r?.ok) { giftPaidCents += Number(r.cents) || 0; if (!r.already) void notifyGiftUse(db, tenantId, g.id, Number(r.cents) || 0).catch(() => {}); }
      }
    } catch (e: any) { console.error('[pay-balance] gift card', e?.message); }
    if (giftPaidCents > 0) {
      const nowIso = new Date().toISOString(); const lineRef = db.doc(`${T}/transactions/balgift_${claim.key}`);
      const fresh = await db.runTransaction(async (tx: any) => {
        const line = await tx.get(lineRef); const cur: any = (await tx.get(cRef)).data() || {};
        if (line.exists) return false;
        // Off their fees, oldest first: a fee paid in full comes off their list; one paid in part shows what's left.
        // The whole balance paid: every fee this payment was for comes off.
        const owedNow = Math.round((Number(cur.outstandingBalance) || 0) * 100); const all = giftPaidCents >= owedNow;
        let left = giftPaidCents; const fees: any[] = Array.isArray(cur.unpaidFees) ? cur.unpaidFees : [];
        const next = fees.map((f) => { const fc = Math.round((Number(f.feeAmount) || 0) * 100); if (f.collectingKey !== claim.key || fc <= 0) return f; if (all) return null;
          if (left <= 0) return f; const take = Math.min(fc, left); left -= take; return take >= fc ? null : { ...f, feeAmount: (fc - take) / 100, originalFeeAmount: f.originalFeeAmount ?? f.feeAmount }; }).filter(Boolean);
        tx.set(lineRef, { id: lineRef.id, tenantId, date: nowIso, description: 'Balance paid online with a gift card', clientOrVendor: c.name || null, clientId, type: 'income', context: 'Business', category: 'Fee Recovery', amount: giftPaidCents / 100, paymentMethod: 'Gift Card', hasReceipt: false });
        tx.set(cRef, { outstandingBalance: Math.max(0, owedNow - giftPaidCents) / 100, unpaidFees: next, balanceVersion: nowIso, ...(all ? { balancePaidAt: nowIso } : {}) }, { merge: true });
        return true;
      });
      if (fresh) await logAuditAdmin(db, tenantId, { action: 'balance.paid_online', targetType: 'client', targetId: clientId, summary: `${c.name || 'Client'} paid $${(giftPaidCents / 100).toFixed(2)} of their balance with a gift card`, actor: { type: 'system', id: 'portal', name: c.name || 'Client' } as any }).catch(() => {});
      const left = cents - giftPaidCents;
      if (left <= 0) { await releaseFeeClaim(db, tenantId, claim, { status: 'settled' }); return NextResponse.json({ ok: true, paidDollars: 0, giftDollars: giftPaidCents / 100 }); }
      later = `Your gift card paid $${(giftPaidCents / 100).toFixed(2)}; you can settle the other $${(left / 100).toFixed(2)} at your next visit.`;
    } else if (b.cardToo !== true) { await release(); return NextResponse.json({ ok: false, error: 'Your gift card couldn’t be used for this — nothing was taken.' }, { status: 409 }); }
    if (giftOnly) { await release(); return NextResponse.json({ ok: true, partial: true, giftDollars: giftPaidCents / 100, leftDollars: (cents - giftPaidCents) / 100 }); }
  }

  const card = c.cardOnFile || {};
  if (!hasRealCard(c) || !claim.pm || !claim.customer || !tenant.stripeAccountId || !stripe) {
    await release();
    return NextResponse.json({ ok: false, error: `There’s no card saved we can charge. ${later}`, code: 'no_card', giftDollars: giftPaidCents / 100 }, { status: 409 });
  }
  const cardCents = cents - giftPaidCents;
  const r = await chargeClaimedFees(db, stripe, tenantId, tenant, { ...claim, chargeCents: cardCents }, { description: `Balance payment — ${c.name || 'client'}`, metadata: { kind: 'balance_payment' },
    by: staffName || 'Client portal', how: 'balance', brand: card.brand || null, last4: card.last4 || null });
  if (!r.ok && 'unknown' in r) return NextResponse.json({ ok: false, code: 'unconfirmed', error: 'The card processor didn’t answer, so the payment may or may not have gone through. Please try again in a couple of minutes: you won’t be charged twice.', giftDollars: giftPaidCents / 100 }, { status: 502 });
  if (!r.ok) {
    const e: any = r.error || {}; const declined = e?.code === 'card_declined' || e?.code === 'authentication_required' || e?.type === 'StripeCardError';
    await logAuditAdmin(db, tenantId, { action: 'balance.payment_failed', targetType: 'client', targetId: clientId, summary: `Online balance payment of $${(cardCents / 100).toFixed(2)} didn’t go through (${e?.code || 'error'}) — nothing cleared`, actor: { type: 'user', name: c.name || 'Client', role: 'client', via: 'portal' } }).catch(() => {});
    return NextResponse.json({ ok: false, error: declined ? `Your card was declined. ${later}` : `The payment didn’t go through. ${later}`, giftDollars: giftPaidCents / 100 }, { status: 402 });
  }
  const dollars = (r.settled.already ? cardCents : r.settled.paidCents) / 100;
  if (!r.settled.already) await logAuditAdmin(db, tenantId, { action: 'balance.paid_online', targetType: 'client', targetId: clientId, summary: `${c.name || 'Client'} paid their $${dollars.toFixed(2)} balance online (card •••• ${card.last4 || ''})`, actor: staffName ? { type: 'user', name: staffName, role: 'staff', via: 'front desk' } : { type: 'user', name: c.name || 'Client', role: 'client', via: 'portal' } } as any).catch(() => {});
  return NextResponse.json({ ok: true, paidDollars: dollars, giftDollars: giftPaidCents / 100, ...(card.last4 ? { last4: card.last4 } : {}) });
}
