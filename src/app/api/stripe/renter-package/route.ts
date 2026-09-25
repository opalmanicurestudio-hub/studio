// src/app/api/stripe/renter-package/route.ts
//
// A CLIENT BUYS A RENTER'S PACKAGE — ON THE RENTER'S STRIPE.
//
// Prepaid bundles of a renter's own services ("5 gel fills for $300"). The
// checkout session is created directly on the renter's connected account,
// with no platform fee: the studio never holds the money, not even in
// transit. The connect-webhook records the credits under
// renterPackagePurchases when the session completes; nothing is written to
// the studio's ledger. Hosted Checkout (redirect), so this works from the
// renter's public page without embedding anything.

import { payLaterCheckoutParams } from '@/lib/pay-later';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenantId || '').trim();
  const packageId = String(body.packageId || '').trim();
  const clientName = String(body.clientName || '').trim().slice(0, 120);
  const clientEmail = String(body.clientEmail || '').trim().toLowerCase().slice(0, 160);
  if (!tenantId || !packageId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ ok: false, error: 'Payments are not configured.' }, { status: 500 });

  const db = getAdminDb();
  const pSnap = await db.doc(`tenants/${tenantId}/renterPackages/${packageId}`).get();
  const pkg = (pSnap.data() as any) || null;
  if (!pkg || pkg.isActive === false) return NextResponse.json({ ok: false, error: 'That package is not available.' }, { status: 404 });

  const rSnap = await db.doc(`tenants/${tenantId}/renters/${String(pkg.renterId)}`).get();
  const r = (rSnap.data() as any) || null;
  if (!r?.stripeAccountId || r?.stripeChargesEnabled !== true) {
    return NextResponse.json({ ok: false, error: 'This provider is not taking online payments yet.' }, { status: 409 });
  }

  const origin = String(req.headers.get('origin') || req.nextUrl.origin || '').replace(/\/+$/, '');
  const back = `${origin}/book/${tenantId}?provider=${encodeURIComponent(String(pkg.staffId))}`;
  const priceCents = Math.max(50, Math.round(Number(pkg.priceCents) || 0));

  try {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        // Pay-later stays hidden until renters get their own "Offer pay-later" switch.
        ...payLaterCheckoutParams(null, priceCents),
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd', unit_amount: priceCents,
            product_data: { name: pkg.name || 'Package', description: `${pkg.credits} visit${Number(pkg.credits) === 1 ? '' : 's'}${pkg.serviceName ? ` · ${pkg.serviceName}` : ''}${pkg.validDays ? ` · valid ${pkg.validDays} days` : ''}` },
          },
        }],
        ...(clientEmail ? { customer_email: clientEmail } : {}),
        success_url: `${back}&package=thanks`,
        cancel_url: back,
        metadata: {
          type: 'renter_package', tenantId, packageId, renterId: String(pkg.renterId), staffId: String(pkg.staffId),
          credits: String(pkg.credits || 1), clientName, clientEmail,
        },
        payment_intent_data: { metadata: { tenantId, type: 'renter_package', renterProviderId: String(pkg.staffId) } },
      },
      { stripeAccount: r.stripeAccountId },
    );
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Could not start checkout.' }, { status: 500 });
  }
}
