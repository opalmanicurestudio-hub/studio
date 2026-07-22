/**
 * /api/booths/setup-card — v2
 *
 * Card on file for LEASE RENTERS (the hotel model, monthly edition).
 * Day/hourly guests already save a card at checkout; lease renters never
 * pass through checkout, so this route runs Stripe Checkout in SETUP
 * mode — a hosted card-collection page, zero client-side Stripe.js.
 *
 * POST { tenantId, renterId, returnUrl }
 *   → creates/reuses a Stripe Customer for the renter, opens a setup
 *     session, returns { url } to redirect to.
 *
 * GET ?tenantId=&renterId=&session=
 *   → called on return from Stripe: retrieves the SetupIntent, stores
 *     the payment method + card summary (brand/last4) on the renter doc.
 *     Idempotent.
 *
 * PUT { tenantId, renterId, category, note?, amountCents }
 *   → one-tap incidental charge against the renter's card on file, GOVERNED
 *     BY THE STUDIO'S CAPPED POLICY (src/lib/incidentals.ts). The category
 *     must be an allowed charge type and the amount must sit under its cap —
 *     enforced HERE (server) so no made-up charges, even if the UI is bypassed.
 *     This is the SAME policy the day/hourly path and the signed lease use.
 *
 * The renter doc is the single card-on-file store. It gets populated two ways:
 * this setup flow (portal), or automatically the first time a renter pays rent
 * online (see /api/portal/renter confirm-invoice).
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { resolveIncidentalPolicy, validateIncidental } from '@/lib/incidentals';


// Exact Stripe fee via the charge's balance transaction. Fail-open.
async function stripeFeeFor(paymentIntentId: string | null): Promise<{ feeCents: number; chargeId: string | null }> {
  try {
    if (!paymentIntentId || !process.env.STRIPE_SECRET_KEY) return { feeCents: 0, chargeId: null };
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const pi: any = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
    const charge: any = pi?.latest_charge;
    const bt: any = charge?.balance_transaction;
    return { feeCents: Number(bt?.fee) || 0, chargeId: charge?.id || null };
  } catch { return { feeCents: 0, chargeId: null }; }
}

export async function POST(req: NextRequest) {
  try {
    const { tenantId, renterId, returnUrl } = await req.json();
    if (!tenantId || !renterId || !returnUrl) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }

    const db = getAdminDb();
    const renterSnap = await db.doc(`tenants/${tenantId}/renters/${renterId}`).get();
    if (!renterSnap.exists) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });
    const renter = renterSnap.data() as any;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

    // Reuse the customer if this renter already has one (from prior day
    // bookings by email, or a prior setup).
    let customerId: string | null = renter.stripeCustomerId || null;
    if (!customerId && renter.email) {
      const existing = await stripe.customers.list({ email: renter.email, limit: 1 });
      customerId = existing.data[0]?.id || null;
    }
    if (!customerId) {
      const created = await stripe.customers.create({
        email: renter.email || undefined,
        phone: renter.phone || undefined,
        name: `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || undefined,
        metadata: { tenantId, renterId },
      });
      customerId = created.id;
    }

    const base = String(returnUrl).split('?')[0];
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      payment_method_types: ['card'],
      success_url: `${base}?cfCardSetup=1&cfSetupSession={CHECKOUT_SESSION_ID}&cfRenterId=${renterId}`,
      cancel_url: base,
      metadata: { tenantId, renterId },
    });

    await db.doc(`tenants/${tenantId}/renters/${renterId}`).set(
      { stripeCustomerId: customerId }, { merge: true });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[setup-card] POST failed', err);
    return NextResponse.json({ ok: false, error: 'Could not start card setup.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId  = searchParams.get('tenantId');
    const renterId  = searchParams.get('renterId');
    const sessionId = searchParams.get('session');
    if (!tenantId || !renterId || !sessionId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }

    const db = getAdminDb();
    const renterRef = db.doc(`tenants/${tenantId}/renters/${renterId}`);
    const snap = await renterRef.get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });
    const renter = snap.data() as any;

    // Idempotent: already stored for this session
    if (renter.cardSetupSessionId === sessionId && renter.cardOnFile) {
      return NextResponse.json({ ok: true, cardBrand: renter.cardBrand, cardLast4: renter.cardLast4 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] });
    const si: any = session.setup_intent;
    if (!si || si.status !== 'succeeded' || !si.payment_method) {
      return NextResponse.json({ ok: false, error: 'Card setup not completed.' }, { status: 400 });
    }

    const pmId = String(si.payment_method);
    let brand = 'card', last4 = '';
    try {
      const pm = await stripe.paymentMethods.retrieve(pmId);
      brand = pm.card?.brand || 'card';
      last4 = pm.card?.last4 || '';
    } catch { /* summary is cosmetic */ }

    await renterRef.set({
      cardOnFile: true,
      stripePaymentMethodId: pmId,
      cardBrand: brand,
      cardLast4: last4,
      cardSetupSessionId: sessionId,
      cardSetupAt: new Date().toISOString(),
    }, { merge: true });

    return NextResponse.json({ ok: true, cardBrand: brand, cardLast4: last4 });
  } catch (err) {
    console.error('[setup-card] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not confirm card setup.' }, { status: 500 });
  }
}


// ── PUT: charge an incidental to a lease renter's card on file ───────────────
// Body: { tenantId, renterId, category, note?, amountCents }  (legacy: description)
// Policy-enforced (allowed type + hard cap) → off-session charge → ledger entry
// ('Renter Incidental') + paired Stripe fee. Declines return the Stripe reason
// so the owner can collect another way — the renter is never suspended.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, renterId } = body || {};
    const amountCents = Math.round(Number(body.amountCents) || 0);
    if (!tenantId || !renterId) {
      return NextResponse.json({ ok: false, error: 'Missing or invalid parameters.' }, { status: 400 });
    }
    // Backstop above any per-type cap — genuinely large charges are run manually.
    if (amountCents > 100000) {
      return NextResponse.json({ ok: false, error: 'Charges over $1,000 need to be run manually.' }, { status: 400 });
    }

    const db = getAdminDb();
    const renterRef = db.doc(`tenants/${tenantId}/renters/${renterId}`);
    const snap = await renterRef.get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });
    const renter = snap.data() as any;

    if (!renter.cardOnFile || !renter.stripeCustomerId || !renter.stripePaymentMethodId) {
      return NextResponse.json({ ok: false, error: 'No card on file — it’s saved when the renter first pays rent online, or they can add one in their portal Documents tab.' }, { status: 400 });
    }

    // ── Incidentals policy — no made-up charges. Only owner-defined charge
    // types are allowed, each capped. Enforced HERE via the shared module so it
    // stays in lockstep with the day/hourly path and the signed lease.
    const cats = resolveIncidentalPolicy((await db.doc(`tenants/${tenantId}`).get()).data());
    const v = validateIncidental(cats, String(body.category || body.description || ''), amountCents, String(body.note || ''));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    const description = v.description;

    const renterName = `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'Renter';
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    let intent;
    try {
      intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        customer: renter.stripeCustomerId,
        payment_method: renter.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        expand: ['latest_charge.balance_transaction'],
        description: `${description} — ${renterName}`,
        metadata: { tenantId, renterId, kind: 'renter_incidental', category: v.category.label },
      });
    } catch (err: any) {
      const msg = err?.raw?.message || err?.message || 'Card charge failed.';
      return NextResponse.json({ ok: false, error: `Card charge failed: ${msg} — collect another way; the renter is not affected.` }, { status: 402 });
    }

    const nowIso = new Date().toISOString();
    const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await txnRef.set({
      id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
      amount: amountCents / 100, category: 'Renter Incidental',
      description: `${description} — ${renterName} (card on file)`,
      clientOrVendor: renterName, date: nowIso, paymentMethod: 'Card on file (Stripe)',
      hasReceipt: false, stripePaymentIntentId: intent.id, renterId, sourceId: renterId, tenantId, createdAt: nowIso,
    });

    // Paired Processing Fees expense for the incidental charge.
    try {
      const { feeCents: __fee, chargeId: __chg } = await stripeFeeFor(intent.id);
      if (__fee > 0) {
        const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await feeRef.set({
          id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
          amount: __fee / 100, category: 'Processing Fees',
          description: `Stripe fee — incidental charge (${renterName})`,
          clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
          hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: __chg,
          renterId, relatedTxnId: txnRef.id, tenantId, createdAt: nowIso,
        });
      }
    } catch { /* never blocks the charge */ }

    // Append to the renter's incidentals log for their history.
    const list = Array.isArray(renter.incidentals) ? renter.incidentals : [];
    list.push({ amountCents, description, at: nowIso, paymentIntentId: intent.id });
    await renterRef.set({ incidentals: list, incidentalsTotalCents: (renter.incidentalsTotalCents || 0) + amountCents }, { merge: true });

    return NextResponse.json({ ok: true, chargedCents: amountCents });
  } catch (err) {
    console.error('[setup-card] PUT failed', err);
    return NextResponse.json({ ok: false, error: 'Could not charge card.' }, { status: 500 });
  }
}
