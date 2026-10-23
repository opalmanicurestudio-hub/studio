import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';
import { recordReaderDeposit } from '@/lib/reader-deposit';
import { captureReaderPayment, markReaderSalePaid, recordReaderFee, tellDeskReader } from '@/lib/reader-sale';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
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

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

export async function POST(req: NextRequest) {
  try {
    const {
      tenantId,
      clientId,
      paymentIntentId,
      customerId,
      saveCard = false,
    } = await req.json();
    const g = await requireRole(req, String(tenantId || ''), 'staff'); if (g.deny) return g.deny;

    if (!tenantId || !paymentIntentId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json({ error: 'No connected Stripe account' }, { status: 400 });
    }

    const stripe = getStripe();

    // Capture it if the reader approved the card. Safe to ask again (the screen does when an answer is lost): a payment
    // already captured says so, and one that never went through says the card wasn't charged (lib/reader-sale).
    // Not settled yet (Stripe couldn't be reached, or an approved payment couldn't be finished) is a 503, so the screen
    // asks again and never tells the desk the card wasn't charged when it may have been.
    const settled = await captureReaderPayment(stripe, stripeAccountId, String(paymentIntentId), String(tenantId));
    if (!settled.ok) {
      const unsettled = settled.status === 'unknown' || settled.status === 'requires_capture';
      return NextResponse.json({ ok: false, status: settled.status, ...(typeof settled.charged === 'boolean' ? { charged: settled.charged } : {}), ...(settled.refunded ? { refunded: true } : {}), error: settled.error || 'The payment couldn’t be confirmed.' },
        { status: settled.status === 'processing' ? 202 : unsettled ? 503 : 409 });
    }
    const intent: any = settled.pi;

    // Saving the card: an in-person card can't be charged again later, but Stripe makes a reusable copy of it
    // (the "generated card") when the payment was set up for future use. That copy is what goes on the profile.
    if (saveCard && clientId && customerId) {
      try {
        const full: any = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] }, { stripeAccount: stripeAccountId });
        const cp = full?.latest_charge?.payment_method_details?.card_present || {};
        const reusable = cp.generated_card || null;
        if (reusable) {
          const nowISO = new Date().toISOString();
          await db.doc(`tenants/${tenantId}/clients/${clientId}`).update({
            cardOnFile: { token: reusable, customerId, paymentMethodId: reusable, brand: cp.brand || null, last4: cp.last4 || null, expMonth: cp.exp_month || null, expYear: cp.exp_year || null, savedAt: nowISO, source: 'terminal' },
            cardOnFileSavedAt: nowISO,
          });
        }
      } catch (e) {
        console.warn('[terminal/capture] card save failed (non-fatal)', e);
      }
    }

    // A booking's deposit is recorded here, as the money is captured, so a screen that loses its connection now can't
    // leave the card charged with nothing on the booking (lib/reader-deposit). The booking screen confirms it after.
    let deposit: any = null;
    const meta: any = intent.metadata || {};
    if (meta.kind === 'deposit' && meta.appointmentId && String(meta.tenantId || '') === String(tenantId)) {
      try {
        deposit = await recordReaderDeposit(db, String(tenantId), String(meta.appointmentId), { paymentIntentId: intent.id, tenant: tenantSnap.data(), actorName: g.actor?.name || null, origin: req.nextUrl.origin });
      } catch (e) { console.error('[terminal/capture] deposit record failed (the booking screen and the hold sweep record it)', e); }
    }

    // The exact fee Stripe took, recorded now that it exists (the approval notice comes before it; lib/stripe-fee).
    await recordReaderFee(db, stripe, stripeAccountId, String(tenantId), String(intent.id));

    // A sale's payment is marked on its ticket as it's captured, so a screen that loses its connection now can't leave
    // it paid with no sale: the desk records it, or a manager does from Needs attention, without charging again.
    let sale: any = null;
    if (meta.kind === 'sale' && meta.pendingId && String(meta.tenantId || '') === String(tenantId)) {
      try {
        const m = await markReaderSalePaid(db, String(tenantId), String(meta.pendingId), intent);
        sale = m.result;
        if (m.fresh && m.result === 'paid_twice') {
          const pc: any = (await db.doc(`tenants/${tenantId}/pendingCheckouts/${String(meta.pendingId)}`).get()).data() || {};
          await tellDeskReader(db, String(tenantId), 'paid_twice', pc, Math.round(Number(intent.amount_received || intent.amount) || 0), String(meta.pendingId)).catch(() => {});
        }
      } catch (e) { console.error('[terminal/capture] sale mark failed (the reader sweep marks it)', e); }
    }

    // What the card was actually charged, so the desk records the sale for that amount (and sees any difference).
    const amountCents = Math.round(Number(intent.amount_received || intent.amount) || 0);
    return NextResponse.json({ ok: true, paymentIntentId: intent.id, amountCents, ...(settled.already ? { already: true } : {}), ...(deposit ? { deposit } : {}), ...(sale ? { sale } : {}) });
  } catch (err: any) {
    console.error('[terminal/capture-payment-intent]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
