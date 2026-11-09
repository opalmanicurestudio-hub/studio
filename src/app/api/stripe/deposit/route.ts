import { NextRequest, NextResponse } from 'next/server';
import { closedReply } from '@/lib/tenant-open-server';
import { balanceDueWith } from '@/lib/balance-with-deposit';
import { depositFormExpiry } from '@/lib/deposit-sessions';
import Stripe from 'stripe';

// ─── Firebase Admin (lazy init — must be inside handler, not module scope) ───
function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  /* NAMED app, and the firestore instance is taken FROM it.
   *
   * This was `if (!getApps().length) initializeApp(...)` followed by a bare
   * `getFirestore()`. Both halves are wrong together: the guard asks "does
   * ANY app exist", but other routes in this codebase create their own NAMED
   * apps — so as soon as one of those had run in the same warm serverless
   * instance, this route decided initialisation was already done and then
   * asked for the DEFAULT app, which nobody had created. The result was a
   * checkout that failed with "The default Firebase app does not exist",
   * intermittently, depending purely on which route ran first.
   *
   * Naming the app and passing it to getFirestore removes the shared global
   * entirely — this route's initialisation no longer depends on what any
   * other route did. */
  const APP_NAME = 'admin-stripe-deposit';
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

/** Why a booking can't take a deposit payment now, said the same way wherever it's asked: paid already, booked (no
 *  deposit due any more), or ended (let go, expired, declined: book again). null when it can. */
function notPayable(ap: any): { error: string; code: 'paid' | 'booked' | 'ended' } | null {
  if (ap?.depositStatus === 'paid') return { error: 'This deposit is already paid.', code: 'paid' };
  if (ap?.status === 'pending_payment') return null;
  // Ended only when it's no longer a booking at all (gone, or let go); any other state (booked, under way, done) is a
  // booking that stands.
  const st = String(ap?.status || '');
  return !st || ['cancelled', 'canceled', 'declined', 'expired', 'released'].includes(st) ? { error: 'This hold has ended. Please choose a time again.', code: 'ended' } : { error: 'No deposit is due for this booking.', code: 'booked' };
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Creates an EMBEDDED Stripe Checkout Session to collect an appointment
// DEPOSIT on the studio's connected account, mounted directly inside the
// BookingSheet — no redirect away from the booking page.
//
//   • metadata.type = 'deposit'      ← the connect-webhook branches on this
//   • metadata.appointmentId         ← so the webhook confirms THAT booking
//   • redirect_on_completion: 'never' + onComplete callback client-side means
//     the guest never leaves the page, even on completion.
//
// Only for a booking that already exists and is holding its time (appointment
// mode). The old way — a booking request with the deposit figure sent by the
// browser — is refused: anyone could make a request, pay whatever they liked,
// and be booked as if that were the deposit, with no check the time was free.
// Nothing in the app uses it any more (the booking page and the booking engine
// both send appointmentId).
//
// This route only COLLECTS. It posts nothing to the ledger — that happens in
// the connect-webhook once checkout.session.completed fires.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let balCents = 0;
    let {
      tenantId,
      clientName,
      clientEmail,
      serviceName,
      renterProviderId,     // present when this is an independent provider's booking
    } = body;
    let depositAmount = 0;  // dollars — always read from the booking, never from the browser
    let holdOf: any = null; // the booking, for when its payment form should close by itself
    const appointmentId: string | null = body.appointmentId ? String(body.appointmentId) : null;

    // The old booking-request way (no appointment): refused, see above.
    if (!appointmentId) {
      return NextResponse.json({ error: 'This booking page is out of date. Please refresh it and pick your time again.' }, { status: 410 });
    }

    const db = getAdminDb();
    /* APPOINTMENT MODE (5a) — the booking already exists (created by
     * /api/appointments/book, holding the slot). Everything that matters is
     * read from THAT appointment on the server: the amount (never trusted from
     * the browser — a client could otherwise pay $1), who it's for, whose
     * account collects it. The webhook then confirms this same appointment. */
    {
      const aSnap = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
      const ap = aSnap.exists ? (aSnap.data() as any) : null;
      // Each refusal says which it is (code), so the booking sheet knows whether it's booked or needs booking again.
      if (!ap) return NextResponse.json({ error: 'We couldn’t find that booking.', code: 'ended' }, { status: 404 });
      const no = notPayable(ap); if (no) return NextResponse.json(no, { status: 409 });
      // A few payment forms per booking is plenty (each try opens one); more is someone hammering it.
      if ((Array.isArray(ap.depositSessions) ? ap.depositSessions.length : 0) >= 12) return NextResponse.json({ error: 'Too many tries for this booking. Please go back and choose your time again.' }, { status: 429 });
      const cents = Math.round(Number(ap.depositAmountCents) || 0);
      if (cents <= 0) return NextResponse.json({ error: 'No deposit is due for this booking.', code: 'booked' }, { status: 409 });
      depositAmount = cents / 100;
      // A balance owed to the business rides its own deposit; never a renter's (that money goes to the renter's account).
      balCents = ap.isRenterBooking ? 0 : balanceDueWith(ap);
      holdOf = ap;
      // Appointments link to the client record rather than copying the email.
      const cl = ap.clientId ? (((await db.doc(`tenants/${tenantId}/clients/${ap.clientId}`).get()).data() as any) || {}) : {};
      clientName = ap.clientName || cl.name || clientName; clientEmail = ap.clientEmail || cl.email || clientEmail;
      serviceName = ap.serviceName || ap.renterServiceName || (ap.serviceId ? ((((await db.doc(`tenants/${tenantId}/services/${ap.serviceId}`).get()).data() as any) || {}).name) : null) || serviceName;
      renterProviderId = ap.isRenterBooking && ap.renterProviderId ? ap.renterProviderId : undefined;
    }
    if (!tenantId || !clientEmail || !depositAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }
    { const closed = closedReply(tenantSnap.data()); if (closed) return closed; }
    // ── Whose account collects this? ────────────────────────────────────────
    // For an independent provider's booking the money must land on THEIR
    // connected account, never the studio's. The account id is resolved here
    // from their provider record — never accepted from the caller — and only
    // when Stripe has actually enabled charges for them.
    let stripeAccountId = tenantSnap.data()?.stripeAccountId;
    let isRenterCharge = false;
    if (renterProviderId) {
      const stSnap = await db.doc(`tenants/${tenantId}/staff/${String(renterProviderId)}`).get();
      const st = stSnap.exists ? (stSnap.data() as any) : null;
      if (!st?.isRenter || !st?.renterId) {
        return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
      }
      const rSnap = await db.doc(`tenants/${tenantId}/renters/${st.renterId}`).get();
      const r = rSnap.exists ? (rSnap.data() as any) : null;
      if (!r?.stripeAccountId || r?.stripeChargesEnabled !== true) {
        return NextResponse.json(
          { error: 'This provider is not set up to take cards yet — book without a deposit and pay them directly.' },
          { status: 400 }
        );
      }
      stripeAccountId = r.stripeAccountId;
      isRenterCharge = true;
    }
    if (!stripeAccountId) {
      return NextResponse.json(
        { error: 'This business isn’t set up to take card payments online yet, so the deposit can’t be paid here. Please let the business know.' },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        ui_mode:        'embedded',
        mode:           'payment',
        payment_method_types: ['card'],
        customer_email: clientEmail,
        customer_creation: 'always',
        line_items: [
          {
            price_data: {
              currency:     'usd',
              unit_amount:  Math.round(depositAmount * 100),
              product_data: {
                name:        serviceName ? `Deposit — ${serviceName}` : 'Appointment Deposit',
                description: 'Deposit to secure your appointment. Applied to your final total.',
              },
            },
            quantity: 1,
          },
          // A balance collected with this deposit (unpaid-fee rule "with the deposit") — its own line.
          ...(balCents > 0 ? [{ price_data: { currency: 'usd', unit_amount: balCents, product_data: { name: 'Balance from a previous visit', description: 'Clears what you owe — not part of your deposit.' } }, quantity: 1 }] : []),

        ],
        // Save the card for future off-session charges (final balance, fees, etc.)
        // Metadata on the SESSION does not reach the charge; the fee handler
        // reads charge.metadata, so the renter tag has to ride the payment
        // intent too — or a renter's Stripe fee gets booked as a studio expense.
        payment_intent_data: {
          setup_future_usage: 'off_session',
          metadata: { tenantId, type: 'deposit', ...(isRenterCharge ? { renterProviderId: String(renterProviderId) } : {}) },
        },
        metadata: {
          tenantId,
          appointmentId,
          type:        'deposit',
          // Tagged so the webhook and any later reconciliation can tell a
          // renter's deposit from the studio's at a glance.
          ...(isRenterCharge ? { renterProviderId: String(renterProviderId) } : {}),
          serviceName: serviceName || '',
          clientName:  clientName  || '',
          clientEmail: clientEmail || '',
        },
        redirect_on_completion: 'never',
        // The form closes by itself when the booking's time stops being held (lib/deposit-sessions), not a day later.
        expires_at: depositFormExpiry(holdOf, tenantSnap.data()),
      },
      {
        stripeAccount: stripeAccountId,
      }
    );

    // Each payment form opened for this booking is noted on it, so a client who steps back from paying can only let
    // the time go once Stripe says none of them is being paid (app/api/appointments/release-hold).
    // If it can't be noted, or the booking stopped waiting for its deposit meanwhile (let go a moment ago), the form is
    // closed again at once, so nothing is ever paid on a booking that isn't holding its time.
    const closeIt = async () => { try { await stripe.checkout.sessions.expire(session.id, { stripeAccount: stripeAccountId }); } catch (e) { console.error('[stripe/deposit] closing the session', e); } };
    try { const { FieldValue } = require('firebase-admin/firestore');
      const apRef = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`);
      // When the newest form was opened: every form closes within a day of opening (Stripe's limit), so after that the
      // hold sweep knows none can be paid without asking Stripe (lib/release-unpaid).
      await apRef.update({ depositSessions: FieldValue.arrayUnion(`${stripeAccountId}:${session.id}`), depositSessionAt: new Date().toISOString() });   // a booking deleted meanwhile isn't brought back
      const now: any = (await apRef.get()).data() || {};
      const no = notPayable(now); if (no) { await closeIt(); return NextResponse.json(no, { status: 409 }); }
    } catch (e) { console.error('[stripe/deposit] noting the session', e); await closeIt(); return NextResponse.json({ error: 'The payment step didn’t open. Please try again.' }, { status: 500 }); }

    return NextResponse.json({
      clientSecret:   session.client_secret,
      sessionId:      session.id,
      stripeAccountId,
    });
  } catch (err: any) {
    console.error('[stripe/deposit]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
