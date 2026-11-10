import { NextRequest, NextResponse } from 'next/server';
import { handleRetailOrderPaid, handleRetailCheckoutExpired } from '@/lib/retail-webhook';
import { tenantTimeZone } from '@/lib/tenant-time';
import { logAuditAdmin } from '@/lib/audit';
import { completeDonation } from '@/lib/academy-funding';
import { enrollFromCheckout } from '@/lib/academy';
import { completeDownPayment, completeStudentPayment, completeCardUpdate } from '@/lib/academy-admissions';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';
import { publicVisitCopy } from '@/lib/public-visit-copy';
import { depositCreditId } from '@/lib/deposit-record';
import { hasRealCard } from '@/lib/card-on-file';

// ─── src/lib/connect-webhook.ts ───────────────────────────────────────────────
// CONNECTED ACCOUNTS webhook — events on the businesses' Stripe accounts. ONE handler, served at both addresses a
// business's Stripe account may be set to call: /api/stripe/connect-webhook and the older /api/stripe/webhook (which
// used to be a stale copy of this file that knew nothing about shop orders, gift cards or fees). Whichever address
// Stripe calls, the same code runs, and every write below is safe to receive twice or at the same moment: Stripe
// retries a notice it thinks failed, and can send one again while the first is still being handled.
// Stripe Dashboard: Developers → Webhooks → "Connected accounts" endpoint
// Secret env var: STRIPE_CONNECT_WEBHOOK_SECRET
//
// Events handled:
//   checkout.session.completed  → 3 branches by metadata.type:
//                                   'deposit'           — public booking page
//                                     deposit: converts the bookingRequest into
//                                     a real appointment, marks deposit paid,
//                                     posts the ledger entry.
//                                   'completion'         — phone-booking
//                                     completion link WITH a deposit: vaults the
//                                     card AND marks the existing appointment's
//                                     deposit paid + posts the ledger entry.
//                                   'completion_setup'   — completion link with
//                                     NO deposit: vaults the card only.
//   charge.succeeded            → write exact Stripe processing fee to ledger
//   charge.refunded             → a refund made in the Stripe Dashboard into the books; fee credit back to ledger
//   charge.dispute.created      → write dispute fee
//   charge.dispute.closed        → reverse fee if won, note if lost
//   payout.paid                 → record net payout for reconciliation

const idOk = (v: any) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
/** A deposit for a renter's booking is paid to the RENTER's own account (api/stripe/deposit), which no business is
 *  keyed by: the business is found through the booking, and only when that booking's renter really has this account,
 *  so a stray notice can never mark someone else's visit paid. */
async function renterDepositTenant(db: any, acct: string, md: any): Promise<{ id: string; ref: any } | null> {
  const tId = md?.tenantId, apId = md?.appointmentId, rp = md?.renterProviderId;
  if (!idOk(tId) || !idOk(apId) || !idOk(rp)) return null;
  const ap: any = (await db.doc(`tenants/${tId}/appointments/${apId}`).get()).data();
  if (!ap || ap.isRenterBooking !== true || String(ap.renterProviderId || '') !== rp) return null;
  const st: any = (await db.doc(`tenants/${tId}/staff/${rp}`).get()).data();
  if (!st?.isRenter || !idOk(st.renterId)) return null;
  const r: any = (await db.doc(`tenants/${tId}/renters/${st.renterId}`).get()).data();
  if (!r || !r.stripeAccountId || r.stripeAccountId !== acct) return null;
  return { id: tId, ref: db.doc(`tenants/${tId}`) };
}

/** A card on file that has run out (its month has passed). */
const cardExpired = (c: any, now = new Date()) => { const y = Number(c?.expYear), m = Number(c?.expMonth); return !!y && !!m && (y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m < now.getUTCMonth() + 1)); };

/** On the client's record: an owed balance came in with a booking's deposit (it was cleared in the deposit's own step,
 *  lib/online-deposit). Best effort: the money is already recorded. */
async function balancePaidNote(db: any, tenantId: string, ap: any, cents: number) {
  if (!(cents > 0) || !ap?.clientId) return;
  await logAuditAdmin(db, tenantId, { action: 'balance.paid', targetType: 'client', targetId: String(ap.clientId), amount: cents / 100,
    summary: `${ap.clientName || 'The client'} paid a $${(cents / 100).toFixed(2)} balance with a booking deposit (online)`,
    actor: { type: 'system', name: 'Payments' } } as any).catch(() => {});
}

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-connect-webhook';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

export async function handleConnectWebhook(req: NextRequest) {
  const rawBody = await req.text();
  const sig     = req.headers.get('stripe-signature');
  const secret  = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!sig || !secret) {
    console.error('[connect-webhook] Missing signature or STRIPE_CONNECT_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    console.error('[connect-webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Webhook Error' }, { status: 400 });
  }

  // All connected account events have an account field
  const connAcct = (event as any).account as string | undefined;
  if (!connAcct) {
    console.warn('[connect-webhook] No connected account on event — ignoring');
    return NextResponse.json({ received: true });
  }

  const db      = getAdminDb();
  const stripe2 = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });

  // Helper: find tenant by connected Stripe account ID
  const getTenant = async (accountId: string) => {
    const snap = await db.collection('tenants')
      .where('stripeAccountId', '==', accountId)
      .limit(1).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ref: snap.docs[0].ref };
  };

  try {
    switch (event.type) {

      // ── A payment that takes days to clear (a bank debit) didn't go through: a shop order waiting on it is closed,
      //    and the customer gets the usual note that their cart is still there. Nothing was recorded for it. ──
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.type !== 'retail_order') break;
        const tenant = await getTenant(connAcct); if (!tenant) break;
        await handleRetailCheckoutExpired(db, tenant.id, session, 'payment_failed');
        break;
      }

      // ── checkout.session.completed: deposit / completion / card vaulting ──
      // A page finished with a payment that takes days to clear says 'unpaid': nothing is recorded until Stripe says the
      // money arrived (checkout.session.async_payment_succeeded), which runs this same code, each part once.
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status === 'unpaid') break;
        let tenant: { id: string; ref: any } | null = await getTenant(connAcct);
        let renterDeposit = false;
        // Also when this account happens to be some business's own (an owner who rents space elsewhere): a renter's deposit
        // names the business it belongs to, so a different one found by the account isn't it.
        if (session.metadata?.type === 'deposit' && session.metadata?.renterProviderId && session.payment_status === 'paid' && (!tenant || tenant.id !== String(session.metadata?.tenantId || ''))) {
          tenant = await renterDepositTenant(db, connAcct, session.metadata).catch((e: any) => { console.error('[connect-webhook] renter deposit lookup', e?.message); return null; });
          renterDeposit = !!tenant;
        }
        // A gift card a renter sold online was paid to the RENTER's account, which no business is keyed by: find it
        // through the order (the order records which account it was paid to, so a stray event can't claim it).
        if (!tenant && session.metadata?.type === 'gift_card' && session.metadata?.tenantId && session.metadata?.giftOrderId && session.payment_status === 'paid') {
          try { const tId = String(session.metadata.tenantId); const o: any = (await db.doc(`tenants/${tId}/giftOrders/${String(session.metadata.giftOrderId)}`).get()).data();
            if (o && o.stripeAccountId === connAcct) { const { completeGiftOrder } = await import('@/lib/gift-shop');
              await completeGiftOrder(getAdminDb(), tId, String(session.metadata.giftOrderId), { sessionId: session.id, paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent as any)?.id || null, amountTotal: session.amount_total }); }
          } catch (e: any) { console.error('[connect-webhook] renter gift card order failed', e?.message); }
          break;
        }
        if (!tenant) break;

        const sessionType = session.metadata?.type;

        // Rent paid online on the business's own account (api/portal/renter, pay-invoice): recorded once (lib/rent-online-pay),
        // whichever comes first, this notice or the renter's return to the portal. Only for this business's own invoice.
        if (session.metadata?.kind === 'rent_invoice') {
          const inv = String(session.metadata?.invoiceId || '');
          if (session.payment_status === 'paid' && String(session.metadata?.tenantId || '') === tenant.id && /^[A-Za-z0-9_-]{1,128}$/.test(inv)) {
            const { recordRentPayment } = await import('@/lib/rent-online-pay');
            await recordRentPayment(db, stripe2, tenant.id, inv, session, { account: connAcct });
          }
          break;
        }

        // A security deposit paid online (api/portal/renter, pay-deposit): recorded once (lib/rent-deposit), whichever comes
        // first, this notice or the renter's return to the portal. Not written: this notice fails, so Stripe sends it again.
        if (session.metadata?.kind === 'rent_deposit') {
          const leaseId = String(session.metadata?.leaseId || '');
          if (session.payment_status === 'paid' && String(session.metadata?.tenantId || '') === tenant.id && /^[A-Za-z0-9_-]{1,128}$/.test(leaseId)) {
            const { recordCardDeposit } = await import('@/lib/rent-deposit');
            const { todayIn, tenantTimeZone } = await import('@/lib/tenant-time');
            const tData: any = (await tenant.ref.get()).data() || {};
            const r = await recordCardDeposit(db, stripe2, tenant.id, tData, leaseId, session, { account: connAcct, today: todayIn(tenantTimeZone(tData)) });
            if (!r.ok && !r.extra) {
              // Asked again by Stripe a few times; then the owners are told (once), since the renter was charged.
              const fRef = db.doc(`tenants/${tenant.id}/refundNotices/depositpayfail_${String(session.id).replace(/[^A-Za-z0-9_-]/g, '')}`);
              const tries = await db.runTransaction(async (tx: any) => { const f: any = (await tx.get(fRef)).data() || {}; const k = (Number(f.tries) || 0) + 1; tx.set(fRef, { tries: k, lastAt: new Date().toISOString() }, { merge: true }); return k; }).catch(() => 1);
              if (tries < 5) throw new Error(`deposit payment not recorded: ${r.error}`);
              if (tries === 5) await db.doc(`tenants/${tenant.id}/notifications/depositpayfail_${String(session.id).replace(/[^A-Za-z0-9_-]/g, '')}`).set({ userId: null, read: false, createdAt: new Date().toISOString(), type: 'booth_deposit', link: '/booths',
                message: `A renter paid a $${((Number(session.amount_total) || 0) / 100).toFixed(2)} security deposit online, but it couldn’t be recorded on their lease (${r.error}). Check their deposit in their profile, and refund the payment in Stripe if it isn’t owed.` }).catch(() => {});
            }
          }
          break;
        }

        // Tickets for a paid event, bought on its page (lib/event-tickets): the guests go on the list and the sale in the
        // books, once, whichever comes first, this notice or the guest's return. Not finished on our side: this notice
        // fails too, so Stripe sends it again.
        if (session.metadata?.kind === 'event_ticket') {
          if (String(session.metadata?.tenantId || '') === tenant.id) {
            const { finishTicketOrder } = await import('@/lib/event-tickets');
            const r = await finishTicketOrder(db, stripe2, tenant.id, String(session.id), session);
            if (!r.ok && r.error === 'retry') throw new Error('event ticket order not finished yet');
          }
          break;
        }

        // A space booking or a day pass paid on the business's own account (api/booths/reserve): confirmed from here too,
        // so it's booked and in the books even when the guest never comes back to the page that confirms it. The same
        // confirming step runs (it checks the payment with Stripe and is safe to run twice).
        const spaceKind = String(session.metadata?.kind || '');
        if (((spaceKind === 'space_booking' || spaceKind === 'booth_booking') && session.metadata?.reservationId) || (spaceKind === 'day_pass' && session.metadata?.passPurchaseId)) {
          // Not reached, or the confirm failed on our side: this notice fails too, so Stripe sends it again later.
          const { internalOrigin } = await import('@/lib/message-policy');
          const biz: any = ((await db.doc(`tenants/${tenant.id}`).get()).data()) || {};
          const q = new URLSearchParams({ tenantId: tenant.id, sessionId: String(session.id),
            ...(spaceKind === 'day_pass' ? { passPurchaseId: String(session.metadata?.passPurchaseId) } : { reservationId: String(session.metadata?.reservationId) }) });
          const r = await fetch(`${internalOrigin(biz, req.nextUrl.origin)}/api/booths/reserve?${q}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
          if (r.status >= 500) throw new Error(`space payment confirm answered ${r.status}`);
          if (!r.ok) console.error('[connect-webhook] space payment confirm answered', r.status);
          break;
        }

        // Academy: course purchases enrol the student; tuition down payments
        // complete admission (the return page does the same — whichever comes
        // first; both are safe to run twice).
        // A pay link the front desk sent for fees → settle exactly those fees (once, however often this arrives).
        // Before the visit: a deposit top-up after the price went up (lib/prep-check-server; safe to run twice).
        // A customer paid the shipping difference for a new address on their shop order (lib/address-pay; safe to run twice).
        // A membership or package bought on the booking page → given to the client (lib/offer-sale; safe to run twice).
        // Not finished yet (stopped part way, or another run still holding it): answered with an error, so Stripe sends
        // the notice again and it's picked straight back up.
        if (sessionType === 'studio_offer') {
          const { finishOfferSale } = await import('@/lib/offer-sale');
          const r = await finishOfferSale(db, stripe2, tenant.id, session.id, session);
          if ((!r.ok && r.error === 'retry') || (r.ok && r.outcome === 'pending')) throw new Error('membership or package bought online not finished yet');
          break;
        }
        if (sessionType === 'address_change') {
          try { if (session.metadata?.retailOrderId) { const { finishAddressPay } = await import('@/lib/address-pay');
              await finishAddressPay(db, tenant.id, String(session.metadata.retailOrderId), session.id, { session, stripe: stripe2 }); }
          } catch (e: any) { console.error('[connect-webhook] address change payment failed', e?.message); }
          break;
        }
        // A customer paid for another try at a delivery that couldn't be made (lib/delivery-retry-server; safe to run twice).
        if (sessionType === 'delivery_retry') {
          try { if (session.metadata?.retailOrderId) { const { finishRetryPay } = await import('@/lib/delivery-retry-server');
              await finishRetryPay(db, tenant.id, String(session.metadata.retailOrderId), session.id, { session, stripe: stripe2 }); }
          } catch (e: any) { console.error('[connect-webhook] delivery retry payment failed', e?.message); }
          break;
        }
        if (sessionType === 'deposit_topup') {
          try { if (session.payment_status === 'paid' && session.metadata?.appointmentId) { const { prepTopUpPaid } = await import('@/lib/prep-check-server');
              await prepTopUpPaid(getAdminDb(), tenant.id, String(session.metadata.appointmentId), { cents: Number(session.amount_total) || Number(session.metadata.cents) || 0, sessionId: session.id, chargeId: null }); }
          } catch (e: any) { console.error('[connect-webhook] deposit top-up failed', e?.message); }
          break;
        }
        if (sessionType === 'fee_payment') {
          try { const { settleFeesPaid } = await import('@/lib/fee-pay');
            const md: any = session.metadata || {};
            await settleFeesPaid(getAdminDb(), tenant.id, { clientId: String(md.clientId || ''), feeIds: String(md.feeIds || '').split(',').filter(Boolean), how: 'link', paymentIntentId: String(session.payment_intent || session.id), by: 'Payment link' });
          } catch (e: any) { console.error('[connect-webhook] fee link settle failed', e?.message); }
          break;
        }
        // A gift card bought online → make the card, record it, send it (lib/gift-shop; safe to run twice).
        // A company's gift card order paid online → make every card (lib/gift-bulk; safe to run twice).
        if (sessionType === 'gift_bulk') {
          try { if (session.payment_status === 'paid' && session.metadata?.giftBulkId) { const { markBulkPaid } = await import('@/lib/gift-bulk');
              await markBulkPaid(getAdminDb(), tenant.id, String(session.metadata.giftBulkId), { via: 'card', sessionId: session.id, amountCents: session.amount_total, by: 'Online' }); }
          } catch (e: any) { console.error('[connect-webhook] company gift cards failed', e?.message); }
          break;
        }
        if (sessionType === 'gift_card') {
          try { const { completeGiftOrder } = await import('@/lib/gift-shop');
            if (session.payment_status === 'paid' && session.metadata?.giftOrderId) await completeGiftOrder(getAdminDb(), tenant.id, String(session.metadata.giftOrderId), { sessionId: session.id, paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent as any)?.id || null, amountTotal: session.amount_total });
          } catch (e: any) { console.error('[connect-webhook] gift card order failed', e?.message); }
          break;
        }
        if (sessionType === 'academy_course') {
          try { await enrollFromCheckout(tenant.id, session); } catch (e: any) { console.error('[connect-webhook] academy enrol failed', e?.message); }
          break;
        }
        if (sessionType === 'academy_donation') {
          try { await completeDonation(tenant.id, session); } catch (e: any) { console.error('[connect-webhook] donation failed', e?.message); }
          break;
        }
        if (sessionType === 'academy_tuition_payment') {
          try { await completeStudentPayment(tenant.id, session); } catch (e: any) { console.error('[connect-webhook] tuition payment failed', e?.message); }
          break;
        }
        if (sessionType === 'academy_card_update') {
          try { await completeCardUpdate(tenant.id, connAcct, session); } catch (e: any) { console.error('[connect-webhook] card update failed', e?.message); }
          break;
        }
        if (sessionType === 'academy_tuition') {
          try { await completeDownPayment(tenant.id, session); } catch (e: any) { console.error('[connect-webhook] tuition failed', e?.message); }
          break;
        }

        // Resolve the resulting charge (if any) so fee tracking can link to it
        let chargeId: string | null = null;
        let stripeCustomerId: string | null = null;
        let stripePaymentMethodId: string | null = null;
        if (session.payment_intent) {
          const piId = typeof session.payment_intent === 'string'
            ? session.payment_intent : session.payment_intent.id;
          try {
            const pi = await stripe2.paymentIntents.retrieve(piId, {}, { stripeAccount: connAcct });
            chargeId = typeof pi.latest_charge === 'string'
              ? pi.latest_charge : (pi.latest_charge as any)?.id || null;
            stripeCustomerId = typeof pi.customer === 'string'
              ? pi.customer : (pi.customer as any)?.id || null;
            stripePaymentMethodId = typeof pi.payment_method === 'string'
              ? pi.payment_method : (pi.payment_method as any)?.id || null;
          } catch (e) {
            console.error('[connect-webhook] Could not retrieve payment intent', e);
          }
        }

        // ───────────────────────────────────────────────────────────────────
        // 'deposit' — public booking-page deposit. The appointment doesn't
        // exist yet; it lives as a pending bookingRequest. Convert it now.
        // ───────────────────────────────────────────────────────────────────
        // ONLINE SHOP ORDERS — restored. A webhook clean-up on 2026-08-20 removed this call, so no paid order was marked
        // paid (the customer's page sat on "Confirming payment"). Idempotent: only an order still 'placed' is processed.
        if (sessionType === 'retail_order') {
          await handleRetailOrderPaid(db, stripe2, tenant.id, connAcct as string, session, chargeId);
          break;
        }

        if (sessionType === 'deposit') {
          /* ── 5a: the APPOINTMENT already exists (created by /api/appointments/book,
           * holding the slot with status 'pending_payment'). Confirm THAT
           * appointment — no second booking, no clash risk. Ledger + deposit
           * credit are written exactly as before so POS checkout nets it off. */
          const payApptId = session.metadata?.appointmentId;
          if (payApptId) {
            const aRef = db.doc(`tenants/${tenant.id}/appointments/${payApptId}`);
            const aSnap = await aRef.get();
            if (!aSnap.exists) { console.warn('[connect-webhook] deposit for missing appointment', payApptId); break; }
            const ap = aSnap.data() as any;
            // The email and phone live on the client record (appointments link to it), the service name on the
            // service, and the tenant found here is only its id: so load the client, the service and the business.
            const cl: any = ap.clientId ? (((await db.doc(`tenants/${tenant.id}/clients/${ap.clientId}`).get()).data() as any) || {}) : {};
            if (!ap.clientEmail) ap.clientEmail = cl.email || null;
            const svcDoc: any = ap.serviceId ? (((await db.doc(`tenants/${tenant.id}/services/${ap.serviceId}`).get()).data() as any) || {}) : {};
            if (!ap.serviceName) ap.serviceName = svcDoc.name || ap.renterServiceName || null;
            const biz: any = ((await db.doc(`tenants/${tenant.id}`).get()).data()) || {};
            // Recorded once (lib/online-deposit): the booking marked paid, its credit and its income in one step, named
            // after this payment. A balance collected with it is split off: it clears the debt; only the rest is the deposit.
            // A renter's booking is marked paid and nothing more: the money went to the renter's own account.
            const piOf = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent as any)?.id || null;
            const { recordOnlineDeposit } = await import('@/lib/online-deposit');
            const rec = await recordOnlineDeposit(db, tenant.id, { appointmentId: payApptId, sessionId: String(session.id), paymentIntentId: piOf, chargeId: chargeId || null,
              paidCents: Number(session.amount_total ?? ap.depositAmountCents) || 0, via: 'online booking', serviceName: ap.serviceName || null, clientEmail: ap.clientEmail || null, renter: renterDeposit });
            if (!rec || rec.already) break;   // retried notice: already recorded
            const cents = rec.cents; const balPart = rec.balanceCents; const lateAfterRelease = rec.released;
            if (rec.twice) {
              await logAuditAdmin(db, tenant.id, { action: 'deposit.paid', targetType: 'appointment', targetId: payApptId, amount: cents / 100,
                summary: renterDeposit
                  ? `A second deposit payment came in for ${ap.clientName || 'a client'} ($${(cents / 100).toFixed(2)}), paid to the renter. The renter should refund one of them if it wasn't meant.`
                  : `A second deposit payment came in for ${ap.clientName || 'a client'} ($${(cents / 100).toFixed(2)}). It's kept as credit; refund one of them if it wasn't meant.`,
                actor: { type: 'user', name: ap.clientName || 'Guest', role: 'client', via: 'online booking' } }).catch(() => {});
              break;
            }
            if (balPart > 0) await balancePaidNote(db, tenant.id, rec.booking, balPart);
            // The card used for the deposit goes on the client's record, so it's on file for the rest of the bill and any
            // fee, as a booking request's deposit always did. Only under a customer (a card without one can't be charged
            // later), never a renter's (that card is on the renter's account, not this business's), and a card already on
            // file stays unless it has expired.
            if (!renterDeposit && ap.clientId && stripePaymentMethodId && stripeCustomerId && (!hasRealCard(cl) || cardExpired(cl.cardOnFile))) {
              try {
                const pm = await stripe2.paymentMethods.retrieve(stripePaymentMethodId, {}, { stripeAccount: connAcct });
                // Replaced whole (update, not a merge), so nothing from the old card stays attached to the new one.
                await db.doc(`tenants/${tenant.id}/clients/${ap.clientId}`).update({ cardOnFile: { paymentMethodId: stripePaymentMethodId, customerId: stripeCustomerId,
                  brand: pm.card?.brand || 'card', last4: pm.card?.last4 || '', expMonth: pm.card?.exp_month || null, expYear: pm.card?.exp_year || null, savedAt: new Date().toISOString(), source: 'online_deposit' } });
              } catch (e: any) { console.error('[connect-webhook] saving the deposit card (the deposit is recorded)', e?.message); }
            }
            await logAuditAdmin(db, tenant.id, { action: 'deposit.paid', targetType: 'appointment', targetId: payApptId, amount: cents / 100,
              summary: lateAfterRelease ? `Deposit paid AFTER the hold ran out — ${ap.clientName || 'Guest'} (needs your attention: re-confirm or refund)` : `Online booking deposit paid — ${ap.clientName || 'Guest'}, booking confirmed${renterDeposit ? ' (paid to the renter)' : ''}`,
              actor: { type: 'user', name: ap.clientName || 'Guest', role: 'client', via: 'online booking' } }).catch(() => {});
            // Tell the client, by email and text, as any confirmed booking is told (or, if late, tell the business).
            try {
              const { sendNotification } = await import('@/lib/notify');
              const { brandedEmailHtml } = await import('@/lib/email-template');
              const { linkOrigin } = await import('@/lib/app-origin');
              const studioName = biz.name || 'The team';
              const first = String(ap.clientName || '').trim().split(' ')[0] || 'there';
              const svcLabel = ap.serviceName || 'appointment';
              const when = ap.startTime ? new Date(ap.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenantTimeZone(biz) }) : '';
              // Links on the business's permanent address, never a preview's or a made-up one.
              const visitUrl = ap.checkInToken ? `${linkOrigin(biz, req.nextUrl.origin)}/check-in/${ap.checkInToken}` : '';
              const counts = svcDoc.depositAppliesToBalance !== false;
              if (!lateAfterRelease && ap.clientEmail) {
                await sendNotification(db, { tenantId: tenant.id, channel: 'email', to: String(ap.clientEmail), kind: 'booking_confirmation',
                  subject: `Your appointment is confirmed: ${svcLabel}${when ? `, ${when}` : ''}`,
                  html: brandedEmailHtml({ studioName, title: 'Your appointment is confirmed', bodyLines: [`Hi ${first},`, `Thank you. We have received your $${(cents / 100).toFixed(2)} deposit, and your ${svcLabel}${when ? ` on ${when}` : ''} is confirmed.`, counts ? 'Your deposit will be applied toward your total at your visit. If you have any questions, please reply to this email.' : 'Your deposit holds your appointment. If you have any questions, please reply to this email.', 'Kind regards,', studioName],
                    cta: visitUrl ? { label: 'View my appointment', url: visitUrl } : undefined }),
                  recipientType: 'client', recipientId: ap.clientId || null, recipientName: ap.clientName || null, appointmentId: payApptId } as any);
              }
              const phone = ap.clientPhone || cl.phone || null;
              if (!lateAfterRelease && phone) {
                await sendNotification(db, { tenantId: tenant.id, channel: 'sms', to: String(phone), kind: 'booking_confirmation',
                  text: `Hi ${first}, thank you. We received your $${(cents / 100).toFixed(2)} deposit, and your ${svcLabel}${when ? ` on ${when}` : ''} is confirmed.${visitUrl ? ` Details and check-in: ${visitUrl}` : ''}`,
                  appointmentId: payApptId, clientId: ap.clientId || null, clientName: ap.clientName || null } as any);
              }
              if (lateAfterRelease && (biz.notificationEmail || biz.email)) {
                const holdMin = Number(biz?.bookingMode?.holdMinutes) > 0 ? Number(biz.bookingMode.holdMinutes) : 30;
                await sendNotification(db, { tenantId: tenant.id, channel: 'email', to: String(biz.notificationEmail || biz.email), kind: 'staff_new_request',
                  subject: `Action needed: Deposit received after the hold expired for ${ap.clientName || 'a client'}`,
                  html: brandedEmailHtml({ studioName, title: 'A deposit needs your attention', bodyLines: [`${ap.clientName || 'A client'} paid a $${(cents / 100).toFixed(2)} deposit for ${ap.serviceName || 'an appointment'}${when ? ` on ${when}` : ''}, but their ${holdMin}-minute hold had already run out and the time was let go.`, renterDeposit ? 'It was paid to the renter. Please open the appointment to re-confirm it if the time is still free, or ask the renter to refund the deposit.' : 'Please open the appointment to re-confirm it if the time is still available, or refund the deposit.'] }),
                  recipientType: 'staff', recipientName: biz.name || 'The business', appointmentId: payApptId } as any);
              }
            } catch (e) { console.error('[connect-webhook] deposit message failed (payment is recorded)', e); }
            // A reschedule: now that the new visit is paid for, release the OLD one —
            // only if it belongs to the same client (a booking can never cancel
            // someone else's appointment).
            if (!lateAfterRelease && ap.replacesAppointmentId) {
              try {
                const old = ((await db.doc(`tenants/${tenant.id}/appointments/${ap.replacesAppointmentId}`).get()).data() as any) || null;
                if (old && !['cancelled', 'canceled'].includes(String(old.status || '')) && old.clientId && old.clientId === ap.clientId) {
                  const { internalOrigin, internalPost } = await import('@/lib/message-policy');
                  await internalPost(internalOrigin(biz, req.nextUrl.origin), '/api/appointments/self-cancel', { tenantId: tenant.id, appointmentId: ap.replacesAppointmentId, clientReason: 'Rescheduled online', rescheduledToId: payApptId });
                } else if (old && old.clientId !== ap.clientId) {
                  console.warn('[connect-webhook] replacesAppointmentId belongs to a different client — left alone', ap.replacesAppointmentId);
                }
              } catch (e) { console.error('[connect-webhook] releasing the old visit failed — it can be cancelled from its own link', e); }
            }
            break;
          }

          const bookingRequestId = session.metadata?.bookingRequestId;
          if (!bookingRequestId) break;

          const brRef  = db.collection(`tenants/${tenant.id}/bookingRequests`).doc(bookingRequestId);
          const brSnap = await brRef.get();
          if (!brSnap.exists) {
            console.warn('[connect-webhook] bookingRequest not found', bookingRequestId);
            break;
          }
          if ((brSnap.data() as any)?.status === 'completed' && (brSnap.data() as any)?.appointmentId) break;   // retried notice

          // The card used for the deposit, read from Stripe before the booking is made, so it can be saved with it.
          let cardOnFile: any = null;
          if (stripePaymentMethodId) {
            try {
              const pm = await stripe2.paymentMethods.retrieve(stripePaymentMethodId, {}, { stripeAccount: connAcct });
              cardOnFile = { paymentMethodId: stripePaymentMethodId, customerId: stripeCustomerId || null, brand: pm.card?.brand || 'unknown', last4: pm.card?.last4 || '????', expMonth: pm.card?.exp_month, expYear: pm.card?.exp_year, savedAt: new Date().toISOString() };
            } catch (e) {
              console.error('[connect-webhook] Could not vault card for deposit', e);
            }
          }

          // THE BOOKING, ITS CLIENT, ITS INCOME AND ITS DEPOSIT CREDIT, IN ONE STEP. The request is marked done in the same
          // step, so a notice Stripe sends twice (or two at the same moment) makes one booking, never two; the income and
          // the credit are named after this payment (lib/online-deposit), so they can't be written twice either.
          const piOfReq = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent as any)?.id || null;
          const { onlineDepositCreditId, onlineDepositIncomeId } = await import('@/lib/online-deposit');
          const made = await db.runTransaction(async (tx: any) => {
            const bs = await tx.get(brRef); const br: any = bs.data() || {};
            if (br.status === 'completed' && br.appointmentId) return null;
            const depositAmountCents = session.amount_total ?? Math.round((br.depositAmount || 0) * 100);
            const email = String(br.clientEmail || '').toLowerCase().trim();
            const clientsCol = db.collection(`tenants/${tenant.id}/clients`);
            const clientMatch = email ? await tx.get(clientsCol.where('email', '==', email).limit(1)) : null;
            const found = clientMatch && !clientMatch.empty ? clientMatch.docs[0] : null;
            const clientRef = found ? found.ref : clientsCol.doc();
            const clientId = clientRef.id;
            const nowIso = new Date().toISOString();
            if (!found) {
              tx.set(clientRef, { id: clientId, name: br.clientName || 'Guest', email: br.clientEmail || '', phone: br.clientPhone || '',
                avatarUrl: `https://picsum.photos/seed/${clientId}/100`, lifetimeValue: 0, status: 'active', createdAt: nowIso, ...(cardOnFile ? { cardOnFile } : {}) });
            } else if (cardOnFile) {
              // Save the card used for the deposit to the client's profile, so it's on file for the final balance / future
              // fees without re-entering it.
              tx.set(clientRef, { cardOnFile }, { merge: true });
            }
            const aptRef = db.collection(`tenants/${tenant.id}/appointments`).doc();
            const appointmentId = aptRef.id;
            const checkInToken = nanoid(16);
            const appointmentPayload = {
              id: appointmentId, tenantId: tenant.id, clientId,
              clientName: br.clientName || 'Guest', clientEmail: br.clientEmail || '', clientPhone: br.clientPhone || '',
              serviceId: br.serviceId, staffId: br.staffId, startTime: br.startTime, endTime: br.endTime,
              status: 'confirmed', source: 'online', isWalkIn: false, checkInToken, checkInStatus: 'pending',
              depositAmountCents, depositStatus: 'paid', depositPaidAt: nowIso, stripeCheckoutSessionId: session.id,
              ...(piOfReq ? { depositStripePaymentIntentId: piOfReq } : {}),
              inspirationPhotoUrl: br.inspirationPhotoUrl || null, notes: br.notes || '', signedForms: br.signedForms || [], createdAt: nowIso,
            };
            tx.set(aptRef, appointmentPayload);
            tx.set(db.collection('appointmentCheckIns').doc(checkInToken), publicVisitCopy(appointmentPayload));   // visit-link-safe fields only
            // Post the deposit to the ledger — taxBucket 'revenue' + checkoutSessionId so the charge.succeeded handler can
            // backfill the exact fee later.
            const txnRef = db.doc(`tenants/${tenant.id}/transactions/${onlineDepositIncomeId(String(session.id))}`);
            tx.set(txnRef, { id: txnRef.id, date: nowIso, description: `Deposit — ${br.serviceName || 'Appointment'}`, clientOrVendor: br.clientName || 'Guest', clientId,
              type: 'income', context: 'Business', category: 'Retainers', taxBucket: 'revenue', amount: depositAmountCents / 100, paymentMethod: 'Online Checkout', hasReceipt: false,
              appointmentId, staffId: br.staffId || null, checkoutSessionId: session.id, stripeChargeId: chargeId, tenantId: tenant.id });
            tx.set(brRef, { status: 'completed', appointmentId, completedAt: nowIso }, { merge: true });
            // The deposit's credit: what the desk checkout looks up to write the offsetting "Deposit Applied" line, and
            // what a refund of the deposit goes back against (its card payment).
            const creditRef = db.doc(`tenants/${tenant.id}/depositCredits/${onlineDepositCreditId(piOfReq, String(session.id))}`);
            tx.set(creditRef, { id: creditRef.id, tenantId: tenant.id, kind: 'deposit', clientId, clientEmail: email, clientName: br.clientName || 'Guest',
              amountCents: depositAmountCents, status: 'available', sourceAppointmentId: appointmentId, serviceName: br.serviceName || null, createdAt: nowIso, via: 'online booking',
              stripePaymentIntentId: piOfReq, stripeChargeId: chargeId, checkoutSessionId: session.id });
            return { appointmentId, depositAmountCents, clientId, clientNew: !found, serviceId: String(br.serviceId || ''), forms: Array.isArray(br.signedForms) ? br.signedForms : [] };
          });
          if (!made) break;
          // Forms signed while booking go on file when this booking made the client record (lib/forms-server; a record
          // matched by email keeps them on the visit only, as the booking route does).
          // Only the service's own forms, and none that needs a guardian (that's asked on the visit link with one).
          if (made.clientNew && made.forms.length) { try { const { recordSignedForms } = await import('@/lib/forms-server');
            const sv: any = made.serviceId ? ((await db.doc(`tenants/${tenant.id}/services/${made.serviceId}`).get()).data() || {}) : {};
            const asked = new Set<string>((sv.requiredFormIds || []).map(String));
            const ok: any[] = [];
            for (const f of made.forms) { const id = String(f?.formId || ''); if (!asked.has(id)) continue;
              const d: any = ((await db.doc(`tenants/${tenant.id}/consentForms/${id}`).get().catch(() => null))?.data?.()) || null; if (d?.requiresGuardianSignature) continue; ok.push(f); }
            if (ok.length) await recordSignedForms(db, tenant.id, { clientId: made.clientId, appointmentId: made.appointmentId, source: 'online_booking', forms: ok }); } catch (e) { console.error('[connect-webhook] forms on file', e); } }
          await logAuditAdmin(db, tenant.id, { action: 'deposit.paid', targetType: 'appointment', targetId: made.appointmentId, amount: made.depositAmountCents / 100, summary: `Online booking deposit paid — ${(brSnap.data() as any)?.clientName || 'Guest'}, ${(brSnap.data() as any)?.serviceName || 'appointment'}`, actor: { type: 'user', name: (brSnap.data() as any)?.clientName || 'Guest', role: 'client', via: 'online booking' } }).catch(() => {});
          console.log(`[connect-webhook] Deposit paid — appointment ${made.appointmentId} created for tenant ${tenant.id}`);
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // 'completion' / 'completion_setup' — phone-booking completion link.
        // Vault the card; if a deposit was collected, mark it paid on the
        // EXISTING appointment and post the ledger entry.
        // ───────────────────────────────────────────────────────────────────
        if (sessionType === 'completion' || sessionType === 'completion_setup') {
          const clientId      = session.metadata?.clientId;
          const appointmentId = session.metadata?.appointmentId;
          if (!clientId) break;

          let pmId: string | null = null;
          let customerIdForCard: string | null = stripeCustomerId;

          if (session.setup_intent) {
            const siId = typeof session.setup_intent === 'string'
              ? session.setup_intent : session.setup_intent.id;
            const setupIntent = await stripe2.setupIntents.retrieve(siId, {}, { stripeAccount: connAcct });
            pmId = typeof setupIntent.payment_method === 'string'
              ? setupIntent.payment_method : setupIntent.payment_method?.id || null;
            customerIdForCard = typeof setupIntent.customer === 'string'
              ? setupIntent.customer : (setupIntent.customer as any)?.id || customerIdForCard;
          } else if (session.payment_intent) {
            const piId = typeof session.payment_intent === 'string'
              ? session.payment_intent : session.payment_intent.id;
            const pi = await stripe2.paymentIntents.retrieve(piId, {}, { stripeAccount: connAcct });
            pmId = typeof pi.payment_method === 'string'
              ? pi.payment_method : (pi.payment_method as any)?.id || null;
          }

          if (pmId) {
            const pm = await stripe2.paymentMethods.retrieve(pmId, {}, { stripeAccount: connAcct });
            await db.collection(`tenants/${tenant.id}/clients`).doc(clientId).set({
              cardOnFile: {
                paymentMethodId: pmId,
                customerId:      customerIdForCard || null,
                brand:           pm.card?.brand || 'unknown',
                last4:           pm.card?.last4 || '????',
                expMonth:        pm.card?.exp_month,
                expYear:         pm.card?.exp_year,
                savedAt:         new Date().toISOString(),
              },
            }, { merge: true });
            await logAuditAdmin(db, tenant.id, { action: 'card.saved', targetType: 'client', targetId: clientId, summary: `Card saved on file — ${pm.card?.brand || 'card'} ending ${pm.card?.last4 || '????'}`, actor: { type: 'user', role: 'client', via: 'online' } }).catch(() => {});
          }

          const completionToken = session.metadata?.completionToken || null;
          // A CANCELLATION FEE paid through the client's link: record it as a fee,
          // settle what they owe, mark the link paid — and leave the cancelled
          // appointment cancelled (it used to be treated as a deposit and revived).
          if (session.metadata?.purpose === 'fee') {
            const cents = Number(session.amount_total) || 0; const nowIso = new Date().toISOString();
            const { FieldValue } = await import('firebase-admin/firestore');
            // Once: the fee's income line is named after this payment, and the balance comes down in the same step.
            // The fee itself comes off their list of fees owed too (lib/fee-pay), so automatic collection can't charge it
            // again. If collection is charging it at this very moment, that payment finds the fee gone and is refunded.
            const feeRef = db.doc(`tenants/${tenant.id}/transactions/feepaid_${String(session.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)}`);
            const clientRef = db.doc(`tenants/${tenant.id}/clients/${clientId}`);
            const fresh = cents > 0 ? await db.runTransaction(async (tx: any) => {
              const [fs1, prior] = await Promise.all([tx.get(feeRef), tx.get(db.collection(`tenants/${tenant.id}/transactions`).where('checkoutSessionId', '==', String(session.id)).limit(1))]);
              const cs = await tx.get(clientRef);
              if (fs1.exists || (prior && !prior.empty)) return false;
              const c: any = cs.exists ? cs.data() || {} : {};
              const owed: any[] = Array.isArray(c.unpaidFees) ? c.unpaidFees : [];
              // This booking's fee: named after it (cancel-<booking>), or listed against it.
              const paidFee = appointmentId ? owed.find((f: any) => String(f?.feeId || '') === `cancel-${appointmentId}`) || owed.find((f: any) => String(f?.appointmentId || '') === String(appointmentId)) : null;
              tx.set(feeRef, { id: feeRef.id, date: nowIso, description: `Cancellation fee — ${session.metadata?.serviceName || 'Appointment'}`, clientOrVendor: session.metadata?.clientName || 'Guest', clientId,
                type: 'income', context: 'Business', category: 'Cancellation Fees', taxBucket: 'revenue', amount: cents / 100, paymentMethod: 'Online Checkout', hasReceipt: false,
                appointmentId: appointmentId || null, checkoutSessionId: session.id, stripeChargeId: chargeId, tenantId: tenant.id });
              if (paidFee) {
                const left = Math.max(0, Math.round((Number(c.outstandingBalance) || 0) * 100) - cents);
                tx.set(clientRef, { unpaidFees: owed.filter((f: any) => f !== paidFee), outstandingBalance: left / 100, feePaidViaLinkAt: nowIso }, { merge: true });
              } else tx.set(clientRef, { outstandingBalance: FieldValue.increment(-(cents / 100)), feePaidViaLinkAt: nowIso }, { merge: true });
              return true;
            }) : false;
            if (completionToken) await db.doc(`tenants/${tenant.id}/bookingCompletions/${completionToken}`).set({ status: 'fee_paid', feePaidAt: nowIso }, { merge: true });
            if (fresh) await logAuditAdmin(db, tenant.id, { action: 'fee.paid', targetType: 'client', targetId: clientId, amount: cents / 100, summary: `Cancellation fee paid by link — ${session.metadata?.clientName || 'client'} ($${(cents / 100).toFixed(2)})`, actor: { type: 'user', name: session.metadata?.clientName || 'Client', role: 'client', via: 'check-in link' } }).catch(() => {});
            break;
          }
          if (sessionType === 'completion' && appointmentId && session.amount_total) {
            // Recorded once (lib/online-deposit): the booking marked paid, its credit and its income in one step, named
            // after this payment. A balance collected with it is split off: it clears the debt; only the rest is the deposit.
            const piOfLink = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent as any)?.id || null;
            const { recordOnlineDeposit } = await import('@/lib/online-deposit');
            const rec = await recordOnlineDeposit(db, tenant.id, { appointmentId, sessionId: String(session.id), paymentIntentId: piOfLink, chargeId: chargeId || null,
              paidCents: Number(session.amount_total) || 0, via: 'pay link', serviceName: session.metadata?.serviceName || null,
              clientEmail: session.metadata?.clientEmail || null, clientName: session.metadata?.clientName || null, confirmFrom: ['pending_payment', 'deposit_pending', 'pending'] });
            if (rec && !rec.already && rec.balanceCents > 0) await balancePaidNote(db, tenant.id, rec.booking, rec.balanceCents);
            if (rec && !rec.already && rec.twice) await logAuditAdmin(db, tenant.id, { action: 'deposit.paid', targetType: 'appointment', targetId: appointmentId, amount: rec.cents / 100,
              summary: `A second deposit payment came in through the pay link for ${session.metadata?.clientName || 'a client'} ($${(rec.cents / 100).toFixed(2)}). It's kept as credit; refund one of them if it wasn't meant.`,
              actor: { type: 'user', name: session.metadata?.clientName || 'Client', role: 'client', via: 'pay link' } }).catch(() => {});
          }

          // The pre-visit steps are done once the card/deposit is confirmed.
          if (completionToken) {
            const nowIso = new Date().toISOString();
            await db.doc(`tenants/${tenant.id}/bookingCompletions/${completionToken}`).set({ status: 'complete', completedAt: nowIso }, { merge: true });
            if (appointmentId) await db.doc(`tenants/${tenant.id}/appointments/${appointmentId}`).set({ completionStatus: 'completed', requirementsCompletedAt: nowIso, cardUpdatedViaLinkAt: nowIso }, { merge: true });
            // On the appointment's own record: the client paid through their link.
            if (appointmentId && sessionType === 'completion' && Number(session.amount_total) > 0) await logAuditAdmin(db, tenant.id, { action: 'deposit.paid', targetType: 'appointment', targetId: appointmentId, amount: Number(session.amount_total) / 100,
              summary: `Deposit $${(Number(session.amount_total) / 100).toFixed(2)} paid by ${session.metadata?.clientName || 'the client'} through their link — booking confirmed`,
              actor: { type: 'user', name: session.metadata?.clientName || 'Client', role: 'client', via: 'pay link' } }).catch(() => {});
            else if (appointmentId && sessionType === 'completion_setup') await logAuditAdmin(db, tenant.id, { action: 'card.saved', targetType: 'appointment', targetId: appointmentId,
              summary: `${session.metadata?.clientName || 'The client'} saved a card and finished their pre-visit steps`, actor: { type: 'user', name: session.metadata?.clientName || 'Client', role: 'client', via: 'check-in link' } }).catch(() => {});
          }
          console.log(`[connect-webhook] Completion processed for client ${clientId} on tenant ${tenant.id}`);
          break;
        }

        // ── Legacy fallback: original vaulting-only path keyed on client_reference_id ──
        if (session.client_reference_id && session.setup_intent) {
          const clientId = session.client_reference_id;
          const siId = typeof session.setup_intent === 'string'
            ? session.setup_intent : session.setup_intent.id;
          const setupIntent = await stripe2.setupIntents.retrieve(siId, {}, { stripeAccount: connAcct });
          const pmId = typeof setupIntent.payment_method === 'string'
            ? setupIntent.payment_method : setupIntent.payment_method?.id;
          if (!pmId) break;

          const pm = await stripe2.paymentMethods.retrieve(pmId, {}, { stripeAccount: connAcct });
          const customerId = typeof setupIntent.customer === 'string'
            ? setupIntent.customer : (setupIntent.customer as any)?.id;

          await db.collection(`tenants/${tenant.id}/clients`).doc(clientId).set({
            cardOnFile: {
              paymentMethodId: pmId,
              customerId:      customerId || null,
              brand:           pm.card?.brand || 'unknown',
              last4:           pm.card?.last4 || '????',
              expMonth:        pm.card?.exp_month,
              expYear:         pm.card?.exp_year,
              savedAt:         new Date().toISOString(),
            },
          }, { merge: true });

          console.log(`[connect-webhook] (legacy) Card saved for client ${clientId} on tenant ${tenant.id}`);
        }
        break;
      }

      // ── charge.succeeded / charge.captured: record exact Stripe processing fee (lib/stripe-fee) ─────────────
      // A card reader payment is approved first (charge.succeeded, no fee yet) and captured after (charge.captured):
      // the fee is recorded once, whichever brings it.
      case 'charge.succeeded':
      case 'charge.captured': {
        const charge = event.data.object as Stripe.Charge;
        const tenant = await getTenant(connAcct);
        if (!tenant) break;
        // A space rental's payment writes its own fee line where it's recorded (lib/space-stripe): not a second one here.
        { const { writesOwnFee } = await import('@/lib/space-stripe'); if (writesOwnFee(charge.metadata)) break; }
        const { recordChargeFee } = await import('@/lib/stripe-fee');
        const fee = await recordChargeFee(db, stripe2, tenant.id, connAcct as string, charge);
        if (fee > 0) console.log(`[connect-webhook] Fee $${(fee / 100).toFixed(2)} recorded for charge ${charge.id} on ${tenant.id}`);
        // A desk sale's card payment that went through — a typed card, a saved card or the client screen (a card reader
        // hold is captured by the desk or the sweep first) — goes on its sale's ticket too, in case the desk's screen
        // never said so: a manager then records it without charging again (lib/reader-sale).
        try {
          const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent as any)?.id;
          if (piId && charge.paid && charge.captured !== false && !charge.refunded && !(Number(charge.amount_refunded) > 0)) {
            const { deskPaymentOf, markSalePaid, tellDeskReader } = await import('@/lib/reader-sale');
            const meta: any = (charge.metadata as any)?.tenantId ? charge.metadata : ((await stripe2.paymentIntents.retrieve(piId, {}, { stripeAccount: connAcct as string }).catch(() => null)) as any)?.metadata || {};
            const desk = deskPaymentOf({ metadata: meta }, tenant.id);
            const cents = Math.round(Number(charge.amount_captured || charge.amount) || 0);
            const tipCents = Math.max(0, Math.round(Number(meta.tipCents) || 0));
            const tipSplit = (() => { try { const x = meta.tipAllocations ? JSON.parse(String(meta.tipAllocations)) : null; return x && typeof x === 'object' ? x : null; } catch { return null; } })();
            if (desk && desk.share) {
              // One share of a split bill: on its split as it's paid (or kept apart if the sale was finished meanwhile).
              const { recordCardShare } = await import('@/lib/screen-pay');
              await recordCardShare(db, tenant.id, desk.pendingId, { id: piId }, { amount: (cents - tipCents) / 100, tip: tipCents / 100, label: meta.shareLabel || null, via: desk.via === 'card_on_file' ? 'saved_card' : desk.via, payerClientId: meta.clientId || null, by: 'Card payment' });
            } else if (desk && desk.via !== 'card_reader') {
              const m = await markSalePaid(db, tenant.id, desk.pendingId, { id: piId, amount: charge.amount, amount_received: cents }, desk.via, tipCents > 0 ? { paidTip: tipCents / 100, paidTipAllocations: tipSplit } : {});
              if (m.fresh && (m.result === 'paid_twice' || m.revived)) {
                const pc: any = ((await db.doc(`tenants/${tenant.id}/pendingCheckouts/${desk.pendingId}`).get()).data() as any) || {};
                await tellDeskReader(db, tenant.id, m.result === 'paid_twice' ? 'paid_twice' : 'unrecorded', pc, cents, desk.pendingId, desk.via).catch(() => {});
              }
            }
          }
        } catch (e) { console.error('[connect-webhook] desk sale payment not marked on its ticket', e); }
        break;
      }

      // ── charge.refunded: tell the client, record a refund made outside the app, and book any fee Stripe gave back ──
      // Every refund on the charge is looked at, each once (by its own id): newer notices don't carry the list of
      // refunds, so it's asked for. Shop order refunds are told on the order page and by the refund itself
      // (api/retail/refund), so the client isn't told twice.
      case 'charge.refunded': {
        const charge  = event.data.object as Stripe.Charge;
        const tenant  = await getTenant(connAcct);
        if (!tenant) break;

        let refunds: any[] = Array.isArray((charge as any).refunds?.data) ? (charge as any).refunds.data : [];
        try { const l: any = await stripe2.refunds.list({ charge: charge.id, limit: 20 } as any, { stripeAccount: connAcct }); if (Array.isArray(l?.data)) refunds = l.data; }
        catch (e) { console.error('[connect-webhook] refunds for the charge could not be listed', e); }
        let meta: any = { ...(charge.metadata || {}) };
        const chPi = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent as any)?.id || null;
        if (!meta.type && chPi) { try { const pi: any = await stripe2.paymentIntents.retrieve(chPi, {}, { stripeAccount: connAcct }); meta = { ...(pi?.metadata || {}), ...meta }; } catch { /* told without it */ } }
        const shopOrder = meta.type === 'retail_order' || meta.type === 'address_change' || meta.type === 'delivery_retry';
        // A renter's own card payment (rent online or by autopay, an agreed charge from the card on file), or money a
        // rent bill didn't need going back: the renter is told as a renter, on their account (lib/renter-refund).
        const { RENTER_PAYMENT_KINDS } = await import('@/lib/renter-refund');
        const renterPay = (RENTER_PAYMENT_KINDS as readonly string[]).includes(String(meta.kind || ''));
        for (const rf of refunds) {
          if (!rf || ['failed', 'canceled'].includes(String(rf.status || ''))) continue;
          const { recordOutsideRefund, notOutside } = await import('@/lib/outside-refund');
          let accountNote: string | null = null; let lineExtra: Record<string, any> | null = null;
          if (meta.kind === 'rent_deposit' || ['deposit_refund', 'deposit_extra'].includes(String(rf.metadata?.kind || ''))) {
            // A security deposit paid by card (lib/rent-deposit): the app's own return recorded if the screen never heard
            // back; one made in the Stripe Dashboard recorded on the deposit, and in the books as held money going out.
            const { noticeDepositRefund } = await import('@/lib/rent-deposit');
            const tData: any = (await tenant.ref.get()).data() || {};
            // Held money going out, whatever happens below (never a refund of a sale).
            lineExtra = { category: 'Booth Deposit', taxBucket: 'transfer' };
            let who: any = null;
            try { who = await noticeDepositRefund(db, tenant.id, tData, charge, rf, meta, { outside: !notOutside(charge, rf) }); }
            catch (e) {
              console.error('[connect-webhook] deposit refund', e);
              // Asked again by Stripe a few times; then left to the owners (told once), so it never holds up the rest.
              const fRef = db.doc(`tenants/${tenant.id}/refundNotices/depositfail_${String(rf.id).replace(/[^A-Za-z0-9_-]/g, '')}`);
              const tries = await db.runTransaction(async (tx: any) => { const f: any = (await tx.get(fRef)).data() || {}; const k = (Number(f.tries) || 0) + 1; tx.set(fRef, { tries: k, lastAt: new Date().toISOString() }, { merge: true }); return k; }).catch(() => 1);
              if (tries < 5) throw e;
              if (tries === 5) await db.doc(`tenants/${tenant.id}/notifications/depositrefundfail_${String(rf.id).replace(/[^A-Za-z0-9_-]/g, '')}`).set({ userId: null, read: false, createdAt: new Date().toISOString(), type: 'booth_deposit', link: '/booths',
                message: `A $${((Number(rf.amount) || 0) / 100).toFixed(2)} refund of a security deposit went through in Stripe but couldn’t be recorded on the deposit automatically. Check the renter’s deposit in their profile.` }).catch(() => {});
            }
            // A second payment sent back (never held or booked): nothing more to write.
            if (who?.skipBooks) continue;
            if (who && !notOutside(charge, rf)) {
              lineExtra = { category: 'Booth Deposit', taxBucket: 'transfer', renterId: who.renterId, leaseId: who.leaseId };
              accountNote = `It’s recorded on ${who.name || 'the renter'}’s security deposit as returned.`;
            }
          } else if (renterPay || ['renter_refund', 'rent_refund'].includes(String(rf.metadata?.kind || ''))) {
            // The app's own refund is recorded here if the screen never heard back; one made in the Stripe Dashboard goes
            // on the renter's account as money back they don't owe again, and the owners' note says so. If it can't be
            // written, the notice fails, so Stripe sends it again (all of it is safe to receive twice).
            const { noticeRenterRefund } = await import('@/lib/renter-refund');
            const tData: any = (await tenant.ref.get()).data() || {};
            let who: any = null;
            try { who = await noticeRenterRefund(db, tenant.id, tData, charge, rf, meta, { piId: chPi, outside: !notOutside(charge, rf) }); }
            catch (e) {
              console.error('[connect-webhook] renter refund', e);
              // Asked again by Stripe a few times; one that still can't be written after that is left to the owners (told
              // once), so it never holds up the rest of this charge's refunds or Stripe's notices.
              const fRef = db.doc(`tenants/${tenant.id}/refundNotices/renterfail_${String(rf.id).replace(/[^A-Za-z0-9_-]/g, '')}`);
              const tries = await db.runTransaction(async (tx: any) => { const f: any = (await tx.get(fRef)).data() || {}; const k = (Number(f.tries) || 0) + 1; tx.set(fRef, { tries: k, lastAt: new Date().toISOString() }, { merge: true }); return k; }).catch(() => 1);
              if (tries < 5) throw e;
              if (tries === 5) {
                const nRef = db.doc(`tenants/${tenant.id}/notifications/renterrefundfail_${String(rf.id).replace(/[^A-Za-z0-9_-]/g, '')}`);
                await nRef.set({ id: nRef.id, userId: null, read: false, createdAt: new Date().toISOString(), type: 'outside_refund', link: '/rent',
                  message: `A $${((Number(rf.amount) || 0) / 100).toFixed(2)} refund to a renter’s card went through in Stripe but couldn’t be added to their account automatically, so it won’t show in their account history. It’s in Money as a refund.` }).catch(() => {});
              }
            }
            if (who?.renterId && !notOutside(charge, rf)) {
              lineExtra = { renterId: who.renterId, ...(who.transactionId ? { rentRefundOf: who.transactionId } : {}) };
              if (who.onAccount) accountNote = `It’s also on ${who.name || 'the renter'}’s account as money back they don’t owe again. If they still owe it, add it as a charge on the Rent page.`;
            }
          } else if (!shopOrder && !rf.metadata?.retailOrderId && !(rf.metadata?.kind === 'booth_refund' && rf.metadata?.origin === 'app')) {
            // (A day or hourly booking refunded from the desk: its guest is told by the booking route, with a link to
            // their booking (lib/reservation-notify), so not twice.)
            try {
              const { sendRefundNotice } = await import('@/lib/refund-notice');
              await sendRefundNotice(db, tenant.id, { key: `refund_${rf.id}`, kind: 'refund', amountCents: Number(rf.amount) || 0,
                clientId: meta.clientId || null, appointmentId: meta.appointmentId || null,
                email: charge.billing_details?.email || charge.receipt_email || null, last4: (charge.payment_method_details as any)?.card?.last4 || null });
            } catch (e) { console.error('[connect-webhook] refund notice', e); }
          }
          // Made outside the app (in the Stripe Dashboard): in the books too, once, and the owners are told
          // (lib/outside-refund). The app's own refunds carry its mark and are recorded where they're sent. Asked again
          // if it fails: everything in this notice is safe to receive twice.
          await recordOutsideRefund(db, tenant.id, charge, rf, meta, { piId: chPi, account: connAcct, accountNote, lineExtra });
          const refundBalTxnId = typeof rf.balance_transaction === 'string' ? rf.balance_transaction : (rf.balance_transaction as any)?.id;
          if (!refundBalTxnId) continue;
          // Once: by its own id, and by the lines written before it had one.
          const retRef = db.doc(`tenants/${tenant.id}/transactions/stripefee_${String(refundBalTxnId).replace(/[^A-Za-z0-9_]/g, '')}`);
          if ((await retRef.get()).exists) continue;
          const existing = await db.collection(`tenants/${tenant.id}/transactions`).where('stripeBalanceTxnId', '==', refundBalTxnId).limit(1).get();
          if (!existing.empty) continue;
          let refundBalTxn: any = null;
          try { refundBalTxn = await stripe2.balanceTransactions.retrieve(refundBalTxnId, {}, { stripeAccount: connAcct }); } catch { continue; }
          // Stripe gives part of the fee back on some refunds: the fee is negative (a credit).
          const feeReturn = Math.abs(Number(refundBalTxn?.fee) || 0) / 100;
          if (feeReturn <= 0) continue;
          try {
            await retRef.create({
              id: retRef.id, date: new Date((Number(rf.created) || Math.floor(Date.now() / 1000)) * 1000).toISOString(), description: 'Stripe fee return — refund credit', clientOrVendor: 'Stripe',
              type: 'income', context: 'Business', category: 'Processing Fee', taxBucket: 'processing_fee', amount: feeReturn, paymentMethod: 'Stripe', hasReceipt: false,
              stripeChargeId: charge.id, stripeRefundId: rf.id, stripeBalanceTxnId: refundBalTxnId, stripeConnectedAccountId: connAcct, tenantId: tenant.id,
            });
            console.log(`[connect-webhook] Fee return $${feeReturn.toFixed(2)} for refund on charge ${charge.id}`);
          } catch { /* another notice wrote it a moment ago */ }
        }
        // Event tickets refunded in full in the Stripe Dashboard: the order shows as refunded and its guests come off the
        // list (lib/event-tickets). The app's own refunds have done that already, so this changes nothing for them.
        if (meta.kind === 'event_ticket' && meta.orderId && charge.refunded === true && String(meta.tenantId || '') === tenant.id && !refunds.some((rf: any) => rf?.metadata?.origin === 'app')) {
          const { syncOutsideTicketRefund } = await import('@/lib/event-tickets');
          await syncOutsideTicketRefund(db, tenant.id, String(meta.orderId), Number(charge.amount_refunded) || 0);
        }
        // The card payment for a shop order refunded in full in the Stripe dashboard (not by the app, whose refunds carry
        // the app's mark): its downloads close (lib/digital-access), whatever else paid for the order.
        if (meta.type === 'retail_order' && charge.refunded === true && meta.retailOrderId && !refunds.some((rf: any) => rf?.metadata?.origin === 'app')) {
          await db.doc(`tenants/${tenant.id}/retailOrders/${String(meta.retailOrderId)}`).set({ cardRefundedInFull: true }, { merge: true });
        }
        break;
      }

      // ── charge.dispute.created: write dispute record + fee + flag client ───
      // Once: the dispute's record is named after Stripe's dispute (records made before then are found by its id too),
      // and the fee is Stripe's own figure from the dispute's balance record, not a guess.
      case 'charge.dispute.created': {
        const dispute  = event.data.object as Stripe.Dispute;
        const tenant   = await getTenant(connAcct);
        if (!tenant) break;
        const { FieldValue } = await import('firebase-admin/firestore');
        const dKey = String(dispute.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
        const disputeDocRef = db.doc(`tenants/${tenant.id}/disputes/${dKey}`);
        const chargeId = typeof dispute.charge === 'string'
          ? dispute.charge : (dispute.charge as any)?.id;
        // The dispute fee, as Stripe charged it, named after the dispute: written with the dispute's record, and again
        // by any later notice that finds the record without it (a step that stopped halfway), never twice.
        const feeCents = (Array.isArray((dispute as any).balance_transactions) ? (dispute as any).balance_transactions : [])
          .reduce((sum: number, b: any) => sum + Math.max(0, Number(b?.fee) || 0), 0);
        const feeRef = db.doc(`tenants/${tenant.id}/transactions/disputefee_${dKey}`);
        const feeLine = (clientId: string | null) => ({
          id: feeRef.id, date: new Date(dispute.created * 1000).toISOString(), description: `Dispute fee — ${dispute.reason}`, clientOrVendor: 'Stripe', clientId,
          type: 'expense', context: 'Business', category: 'Processing Fee', taxBucket: 'processing_fee', amount: feeCents / 100, paymentMethod: 'Stripe', hasReceipt: false,
          stripeDisputeId: dispute.id, stripeChargeId: chargeId || null, stripeConnectedAccountId: connAcct,
          notes: `Reason: ${dispute.reason}. Disputed: $${(dispute.amount / 100).toFixed(2)}`, tenantId: tenant.id,
        });
        const known = await disputeDocRef.get();
        if (known.exists) {
          // Written already, or a real failure: a failure answers Stripe with an error, so it sends the notice again.
          if (feeCents > 0) await feeRef.create(feeLine((known.data() as any)?.clientId || null)).catch((e: any) => { if (!/ALREADY_EXISTS|already exists/i.test(String(e?.message || ''))) throw e; });
          break;
        }
        const existingDisp = await db.collection(`tenants/${tenant.id}/disputes`)
          .where('stripeDisputeId', '==', dispute.id)
          .limit(1).get();
        if (!existingDisp.empty) break;

        // ── Look up the original charge to link client, session, receipt ──────
        let clientId:          string | null = null;
        let clientName:        string        = 'Unknown Client';
        let checkoutSessionId: string | null = null;
        let receiptUrl:        string | null = null;
        let appointmentId:     string | null = null;
        let retailOrderId:     string | null = null;
        let signatureUrls:     string[]      = [];
        const consentFormUrls: string[]      = [];

        if (chargeId) {
          // Find the revenue transaction linked to this charge
          const revTxns = await db.collection(`tenants/${tenant.id}/transactions`)
            .where('stripeChargeId', '==', chargeId)
            .where('taxBucket', '==', 'revenue')
            .limit(1).get();

          if (!revTxns.empty) {
            const txn      = revTxns.docs[0].data();
            clientId       = txn.clientId       || null;
            clientName     = txn.clientOrVendor || 'Unknown Client';
            checkoutSessionId = txn.checkoutSessionId || null;
            receiptUrl     = txn.receiptUrl     || null;
            appointmentId  = txn.appointmentId  || null;
            retailOrderId  = txn.retailOrderId  || null;
          }

          // If we have a client, find their signatures for this appointment
          if (clientId && appointmentId) {
            const sigsSnap = await db.collection(`tenants/${tenant.id}/signatures`)
              .where('clientId', '==', clientId)
              .where('appointmentId', '==', appointmentId)
              .get();
            signatureUrls = sigsSnap.docs.map((d: any) => d.data().signatureUrl).filter(Boolean);
          }

          // Also get any consent forms signed by this client (most recent 3)
          if (clientId) {
            try {
              const allSigsSnap = await db.collection(`tenants/${tenant.id}/signatures`)
                .where('clientId', '==', clientId)
                .orderBy('signedAt', 'desc')
                .limit(3).get();
              const allSigUrls = allSigsSnap.docs.map((d: any) => d.data().signatureUrl).filter(Boolean);
              // Merge with appointment-specific, deduplicate
              signatureUrls = Array.from(new Set([...signatureUrls, ...allSigUrls]));
            } catch { /* the dispute is recorded without them */ }
          }
        }

        // Calculate response deadline: Stripe's own date when it gives one, else about a week.
        const dueBy = Number((dispute as any).evidence_details?.due_by) || 0;
        const deadlineDate = dueBy > 0 ? new Date(dueBy * 1000) : new Date(dispute.created * 1000);
        if (!(dueBy > 0)) deadlineDate.setDate(deadlineDate.getDate() + 7);

        // ── The dispute's record, its fee, the client's flag and the sidebar count, in one step ──────────────
        const made = await db.runTransaction(async (tx: any) => {
          const [ds, fs] = await Promise.all([tx.get(disputeDocRef), feeCents > 0 ? tx.get(feeRef) : Promise.resolve(null)]);
          if (fs && !fs.exists) tx.set(feeRef, feeLine(clientId));
          if (ds.exists) return false;   // another notice recorded it a moment ago
          tx.set(disputeDocRef, {
            id:                       disputeDocRef.id,
            stripeDisputeId:          dispute.id,
            stripeChargeId:           chargeId,
            stripeConnectedAccountId: connAcct,
            clientId,
            clientName,
            amount:                   dispute.amount / 100,
            currency:                 dispute.currency,
            reason:                   dispute.reason,
            status:                   dispute.status,
            deadline:                 deadlineDate.toISOString(),
            evidenceSubmitted:        false,
            checkoutSessionId,
            receiptUrl,
            appointmentId,
            ...(retailOrderId ? { retailOrderId } : {}),
            signatureUrls,
            consentFormUrls,
            createdAt:                new Date(dispute.created * 1000).toISOString(),
            tenantId:                 tenant.id,
          });
          if (clientId) {
            tx.set(db.collection(`tenants/${tenant.id}/clients`).doc(clientId), {
              hasOpenDispute:   true,
              disputeCount:     FieldValue.increment(1),
              lastDisputeAt:    new Date(dispute.created * 1000).toISOString(),
              lastDisputeReason: dispute.reason,
            }, { merge: true });
          }
          // The open dispute count on the business, for the sidebar badge.
          tx.set(db.collection('tenants').doc(tenant.id), { openDisputeCount: FieldValue.increment(1) }, { merge: true });
          return true;
        });
        // Downloads on the disputed order pause until it's decided (lib/digital-access). On every notice, before the
        // "already recorded" stop, so a hold that failed once is tried again when Stripe resends. An inquiry (a
        // warning, not a chargeback) pauses nothing.
        if (!String(dispute.status || '').startsWith('warning')) {
          const { holdDigitalForDispute } = await import('@/lib/digital-access');
          const pi = typeof (dispute as any).payment_intent === 'string' ? (dispute as any).payment_intent : (dispute as any).payment_intent?.id || null;
          if ((await holdDigitalForDispute(db, tenant.id, { retailOrderId, paymentIntentId: pi }, 'open', dispute.id)) === 'failed') throw new Error('download hold failed');
        }
        if (!made) break;

        console.log(`[connect-webhook] Dispute ${dispute.id} recorded for tenant ${tenant.id} — client: ${clientName}`);
        break;
      }

      // ── charge.dispute.closed: fires for won, lost, or warning_closed ──────
      // Once per dispute: the outcome is claimed on the dispute's record before anything is written, so a second
      // notice changes nothing. Won: the fee comes back (Stripe's figure). Lost: the disputed amount went back to
      // the cardholder, a refund in the books (returns), not a processing fee.
      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute;
        const tenant  = await getTenant(connAcct);
        if (!tenant) break;
        const dKey = String(dispute.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
        const byId = db.doc(`tenants/${tenant.id}/disputes/${dKey}`);
        const found = (await byId.get()).exists ? byId : ((await db.collection(`tenants/${tenant.id}/disputes`).where('stripeDisputeId', '==', dispute.id).limit(1).get()).docs[0]?.ref || null);
        const outcome = dispute.status === 'won' ? 'won' : dispute.status === 'lost' ? 'lost' : 'closed';
        const nowIso = new Date().toISOString();
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge as any)?.id;
        // Won: the fee comes back (Stripe's own figure: the reversal's fee is negative). Lost: the disputed amount went back
        // to the cardholder, a refund in the books (returns), not a processing fee.
        const feeBack = outcome !== 'won' ? 0 : (Array.isArray((dispute as any).balance_transactions) ? (dispute as any).balance_transactions : [])
          .reduce((sum: number, b: any) => sum + Math.max(0, -(Number(b?.fee) || 0)), 0);
        const revRef = db.doc(`tenants/${tenant.id}/transactions/disputewon_${dKey}`);
        const lossRef = db.doc(`tenants/${tenant.id}/transactions/disputelost_${dKey}`);
        // The outcome and its line in the books in one step: the first notice to get here writes both; any other finds
        // them written. A failure answers Stripe with an error, so it sends the notice again.
        // Downloads: open again when won (or closed without a chargeback), closed for good when lost (lib/digital-access).
        // On every notice, before the "already claimed" stop, so a failure is tried again when Stripe resends.
        {
          const { holdDigitalForDispute } = await import('@/lib/digital-access');
          const rec: any = found ? ((await found.get()).data() || {}) : {};
          const pi = typeof (dispute as any).payment_intent === 'string' ? (dispute as any).payment_intent : (dispute as any).payment_intent?.id || null;
          if ((await holdDigitalForDispute(db, tenant.id, { retailOrderId: rec.retailOrderId || null, paymentIntentId: pi }, outcome === 'lost' ? 'lost' : 'won', dispute.id)) === 'failed') throw new Error('download hold failed');
        }
        const claimed = await db.runTransaction(async (tx: any) => {
          const ref = found || byId;
          const [snap, rs, ls] = await Promise.all([tx.get(ref), tx.get(revRef), tx.get(lossRef)]);
          const cur: any = snap.exists ? snap.data() || {} : {};
          if (cur.outcomeAt) return null;
          tx.set(ref, { id: ref.id, stripeDisputeId: dispute.id, status: outcome === 'closed' ? 'charge_refunded' : outcome, outcome, outcomeAt: nowIso, closedAt: nowIso, tenantId: tenant.id }, { merge: true });
          if (outcome === 'won' && feeBack > 0 && !rs.exists) tx.set(revRef, {
            id: revRef.id, date: nowIso, description: 'Dispute won — fee reversed', clientOrVendor: 'Stripe',
            type: 'income', context: 'Business', category: 'Processing Fee', taxBucket: 'processing_fee', amount: feeBack / 100,
            paymentMethod: 'Stripe', hasReceipt: false, stripeDisputeId: dispute.id, stripeChargeId: chargeId || null, stripeConnectedAccountId: connAcct, tenantId: tenant.id,
          });
          if (outcome === 'lost' && !ls.exists) tx.set(lossRef, {
            id: lossRef.id, date: nowIso, description: `Chargeback (dispute lost) — $${(dispute.amount / 100).toFixed(2)}`, clientOrVendor: 'Stripe',
            type: 'expense', context: 'Business', category: 'Refunds', taxBucket: 'refund', amount: dispute.amount / 100, taxRefunded: 0,
            paymentMethod: 'Stripe', hasReceipt: false, stripeDisputeId: dispute.id, stripeChargeId: chargeId || null, stripeConnectedAccountId: connAcct, chargeback: true,
            notes: `Dispute lost: ${dispute.reason}. The charge went back to the cardholder.`, tenantId: tenant.id,
          });
          return { clientId: cur.clientId || null, wasOpen: snap.exists };
        });
        if (!claimed) break;
        const { FieldValue } = await import('firebase-admin/firestore');
        console.log(`[connect-webhook] Dispute ${outcome} for ${dispute.id}`);



        // The client's flag comes off when nothing else of theirs is open; the sidebar count comes down.
        if (claimed.clientId) {
          try {
            const otherOpen = await db.collection(`tenants/${tenant.id}/disputes`)
              .where('clientId', '==', claimed.clientId)
              .where('status', 'in', ['needs_response', 'warning_needs_response', 'under_review'])
              .limit(1).get();
            if (otherOpen.empty) await db.collection(`tenants/${tenant.id}/clients`).doc(claimed.clientId).set({ hasOpenDispute: false }, { merge: true });
          } catch { /* the flag stays until the next one */ }
        }
        if (claimed.wasOpen) {
          await db.runTransaction(async (tx: any) => {
            const tRef = db.collection('tenants').doc(tenant.id); const t: any = (await tx.get(tRef)).data() || {};
            tx.set(tRef, { openDisputeCount: Math.max(0, (Number(t.openDisputeCount) || 0) - 1) }, { merge: true });
          }).catch(() => db.collection('tenants').doc(tenant.id).set({ openDisputeCount: FieldValue.increment(-1) }, { merge: true }).catch(() => {}));
        }
        break;
      }

      // ── payout.paid: record net payout for month-end reconciliation ───────
      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout;
        const tenant = await getTenant(connAcct);
        if (!tenant) break;

        // Idempotency
        const existing = await db.collection(`tenants/${tenant.id}/stripePayouts`)
          .where('stripePayoutId', '==', payout.id)
          .limit(1).get();
        if (!existing.empty) break;

        // Write to a separate payouts collection for reconciliation
        // (not the transactions ledger — this is a bank transfer, not revenue)
        const payoutRef = db.collection(`tenants/${tenant.id}/stripePayouts`).doc(payout.id);
        await payoutRef.set({
          id:                       payout.id,
          stripePayoutId:           payout.id,
          stripeConnectedAccountId: connAcct,
          amount:                   payout.amount / 100,
          currency:                 payout.currency,
          arrivalDate:              new Date(payout.arrival_date * 1000).toISOString(),
          createdAt:                new Date(payout.created * 1000).toISOString(),
          status:                   payout.status,
          method:                   payout.method,
          description:              payout.description || 'Stripe payout',
          tenantId:                 tenant.id,
        });

        console.log(`[connect-webhook] Payout $${(payout.amount / 100).toFixed(2)} recorded for ${tenant.id}`);
        break;
      }

      case 'checkout.session.expired': {   // restored: an abandoned shop cart closes its unpaid order and releases held stock
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.type === 'retail_order') {
          const tenant = await getTenant(connAcct);
          if (tenant) await handleRetailCheckoutExpired(db, tenant.id, session);
        }
        // An unpaid ticket checkout closed: its places go back on sale (lib/event-tickets).
        if (session.metadata?.kind === 'event_ticket' && session.metadata?.orderId) {
          const tenant = await getTenant(connAcct);
          if (tenant && String(session.metadata?.tenantId || '') === tenant.id) { const { expireTicketOrder } = await import('@/lib/event-tickets'); await expireTicketOrder(db, tenant.id, String(session.metadata.orderId), String(session.id)); }
        }
        break;
      }

      // ── Stripe says how a connected account's setup stands: card payments on, details sent, payouts on. Saved on the
      //    business (Settings › Payments, the setup guide and HQ read it) or, for a renter's own account, on the renter
      //    and the one flag on their provider record that the booking page reads. ──
      case 'account.updated': {
        const acct = event.data.object as Stripe.Account;
        const flags = { stripeChargesEnabled: !!acct.charges_enabled, stripeDetailsSubmitted: !!acct.details_submitted, stripePayoutsEnabled: !!acct.payouts_enabled, stripeStatusAt: new Date().toISOString() };
        const md: any = acct.metadata || {};
        if (md.kind === 'renter' && md.tenantId && md.renterId) {
          const rRef = db.doc(`tenants/${String(md.tenantId)}/renters/${String(md.renterId)}`);
          const r: any = (await rRef.get()).data();
          if (r?.stripeAccountId === acct.id) {
            await rRef.set(flags, { merge: true });
            const st = await db.collection(`tenants/${String(md.tenantId)}/staff`).where('renterId', '==', String(md.renterId)).get().catch(() => ({ docs: [] as any[] }));
            for (const d of st.docs) if ((d.data() as any)?.isRenter) await d.ref.set({ stripeChargesEnabled: flags.stripeChargesEnabled }, { merge: true }).catch(() => {});
          }
          break;
        }
        const tenant = await getTenant(acct.id || connAcct);
        if (tenant) await tenant.ref.set(flags, { merge: true });
        break;
      }

      default: {
        // An ID check asked for on a held shop order (/api/retail/id-check): record how it went on the order. A
        // manager still releases it; a pass is the evidence, not the decision.
        const type = String(event.type);
        if (type.startsWith('identity.verification_session.')) {
          const vs: any = event.data.object; const t = String(vs?.metadata?.tenantId || ''); const oid = String(vs?.metadata?.retailOrderId || '');
          const status = type.endsWith('.verified') ? 'verified' : type.endsWith('.requires_input') ? 'failed' : type.endsWith('.canceled') ? 'canceled' : type.endsWith('.processing') ? 'processing' : '';
          if (t && oid && status) {
            const at = new Date().toISOString();
            await db.doc(`tenants/${t}/retailOrders/${oid}`).set({ idCheck: { status, at, sessionId: vs.id, lastError: vs?.last_error?.reason || null } }, { merge: true });
            if (status === 'verified' || status === 'failed') {
              const n = db.collection(`tenants/${t}/notifications`).doc();
              await n.set({ id: n.id, type: 'order_id_check', read: false, createdAt: at, link: `/retail-orders/problems?order=${oid}`, message: status === 'verified' ? 'A held order’s ID check passed. It’s ready for you to release.' : 'A held order’s ID check didn’t pass.' });
            }
          }
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[connect-webhook] Handler error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
