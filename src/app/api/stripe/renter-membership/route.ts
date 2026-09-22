// src/app/api/stripe/renter-membership/route.ts
//
// A CLIENT JOINS A RENTER'S MEMBERSHIP — RECURRING, ON THE RENTER'S STRIPE.
//
// A subscription created directly on the renter's connected account, no
// platform fee. Stripe bills it every month; the connect-webhook records the
// membership on checkout, resets included visits on each paid invoice, and
// closes it when cancelled. Nothing touches the studio's money or ledger.

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
  const membershipId = String(body.membershipId || '').trim();
  const clientName = String(body.clientName || '').trim().slice(0, 120);
  const clientEmail = String(body.clientEmail || '').trim().toLowerCase().slice(0, 160);
  const clientPhone = String(body.clientPhone || '').trim().slice(0, 40);
  if (!tenantId || !membershipId || !clientEmail) return NextResponse.json({ ok: false, error: 'Name and email are needed.' }, { status: 400 });
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ ok: false, error: 'Payments are not configured.' }, { status: 500 });

  const db = getAdminDb();
  const mSnap = await db.doc(`tenants/${tenantId}/renterMemberships/${membershipId}`).get();
  const m = (mSnap.data() as any) || null;
  if (!m || m.isActive === false) return NextResponse.json({ ok: false, error: 'That membership is not available.' }, { status: 404 });
  const rSnap = await db.doc(`tenants/${tenantId}/renters/${String(m.renterId)}`).get();
  const r = (rSnap.data() as any) || null;
  if (!r?.stripeAccountId || r?.stripeChargesEnabled !== true) {
    return NextResponse.json({ ok: false, error: 'This provider is not taking online payments yet.' }, { status: 409 });
  }

  const origin = String(req.headers.get('origin') || req.nextUrl.origin || '').replace(/\/+$/, '');
  const back = `${origin}/book/${tenantId}?provider=${encodeURIComponent(String(m.staffId))}`;
  const priceCents = Math.max(100, Math.round(Number(m.priceCents) || 0));

  try {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd', unit_amount: priceCents, recurring: { interval: 'month' },
            product_data: { name: m.name || 'Membership', description: [m.includedVisits ? `${m.includedVisits} visit${m.includedVisits === 1 ? '' : 's'} a month` : null, m.discountPct ? `${m.discountPct}% off other services` : null].filter(Boolean).join(' · ') || 'Monthly membership' },
          },
        }],
        customer_email: clientEmail,
        success_url: `${back}&member=thanks`,
        cancel_url: back,
        subscription_data: { metadata: { tenantId, type: 'renter_membership', membershipId, renterId: String(m.renterId), staffId: String(m.staffId), clientEmail } },
        metadata: { type: 'renter_membership', tenantId, membershipId, renterId: String(m.renterId), staffId: String(m.staffId), clientName, clientEmail, clientPhone },
      },
      { stripeAccount: r.stripeAccountId },
    );
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Could not start checkout.' }, { status: 500 });
  }
}
