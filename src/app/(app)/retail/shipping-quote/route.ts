import crypto from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

// ─── /api/retail/shipping-quote ───────────────────────────────────────────────
// POST { tenantId, items:[{productId, qty}], address:{line1,line2,city,state,postalCode} }
//   → { options: [{ id, carrier, service, amountCents, days, token }] }
//
// Live carrier rates BEFORE an order exists, so a shopper picks their own
// service instead of accepting a flat guess. Two bottlenecks this removes:
// customers abandoning over unknown shipping, and the shop eating the
// difference when a heavy order goes cross-country.
//
// TRUST MODEL: each option carries an HMAC token binding tenant + amount +
// service + expiry. Checkout verifies the token instead of believing a price
// the browser sent — the client can choose, but it cannot invent a number.
// Parcel weight comes from the same per-item weightOz the Ship dialog uses,
// plus packaging, so quote and label agree.

export const dynamic = 'force-dynamic';

const QUOTE_TTL_MIN = 30;

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-quote';
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

/** Shared secret for quote signing — falls back to the admin key material. */
function quoteSecret(): string {
  return String(
    process.env.RETAIL_QUOTE_SECRET
    || process.env.FIREBASE_ADMIN_PRIVATE_KEY
    || 'clarityflow-quote'
  );
}

export function signQuote(tenantId: string, amountCents: number, service: string, expMs: number): string {
  return crypto
    .createHmac('sha256', quoteSecret())
    .update(`${tenantId}|${amountCents}|${service}|${expMs}`)
    .digest('base64url');
}

/** Used by checkout: does this amount/service really come from us, unexpired? */
export function verifyQuote(
  tenantId: string, amountCents: number, service: string, expMs: number, sig: string
): boolean {
  if (!sig || !Number.isFinite(expMs) || Date.now() > expMs) return false;
  const expected = signQuote(tenantId, amountCents, service, expMs);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const items = Array.isArray(body.items) ? body.items.slice(0, 60) : [];
  const address = body.address || {};

  if (!tenantId || items.length === 0) {
    return NextResponse.json({ error: 'Cart details are required' }, { status: 400 });
  }
  if (!address.line1 || !address.city || !address.state || !address.postalCode) {
    return NextResponse.json({ error: 'Enter your full address to see shipping options' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

    const tenant = tenantSnap.data() as any;
    const rs = tenant.retailSettings || {};
    const apiKey = String(rs.shippoApiKey || process.env.SHIPPO_API_KEY || '').trim();
    const from = rs.shipFrom || {};

    // No Shippo, or no ship-from on file: fall back to the shop's flat rate
    // rather than blocking checkout. A shop without carrier setup still sells.
    if (!apiKey || !from.street1 || !from.city || !from.state || !from.zip) {
      const flat = Math.round((Number(rs.flatShippingDollars) || 0) * 100);
      const exp = Date.now() + QUOTE_TTL_MIN * 60_000;
      return NextResponse.json({
        options: [{
          id: 'flat',
          carrier: 'Shop',
          service: 'Standard shipping',
          amountCents: flat,
          days: null,
          exp,
          token: signQuote(tenantId, flat, 'Standard shipping', exp),
        }],
      });
    }

    // Parcel weight from real per-item weights (same source as the Ship dialog).
    let ounces = 0;
    let known = false;
    for (const it of items) {
      const id = String(it.productId || '').trim();
      const qty = Math.max(0, Math.floor(Number(it.qty) || 0));
      if (!id || qty <= 0) continue;
      const snap = await db.collection(`tenants/${tenantId}/inventory`).doc(id).get();
      if (!snap.exists) continue;
      const w = Number((snap.data() as any).weightOz) || 0;
      if (w > 0) { known = true; ounces += w * qty; }
    }
    const weightOz = known ? Math.max(1, Math.ceil(ounces + 4)) : 16;

    const res = await fetch('https://api.goshippo.com/shipments/', {
      method: 'POST',
      headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address_from: {
          name: from.name || tenant.businessName || 'Shop',
          street1: from.street1, city: from.city, state: from.state, zip: from.zip, country: 'US',
        },
        address_to: {
          name: String(address.name || 'Customer'),
          street1: String(address.line1), street2: String(address.line2 || ''),
          city: String(address.city), state: String(address.state),
          zip: String(address.postalCode), country: 'US',
        },
        parcels: [{
          length: '10', width: '8', height: '4', distance_unit: 'in',
          weight: String(weightOz), mass_unit: 'oz',
        }],
        async: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.detail || 'Could not fetch shipping rates';
      return NextResponse.json({ error: String(detail).slice(0, 180) }, { status: 502 });
    }

    const markup = Math.max(0, Number(rs.shippingMarkupPercent) || 0);
    const exp = Date.now() + QUOTE_TTL_MIN * 60_000;

    const options = (data.rates || [])
      .map((r: any) => {
        const base = Math.round(parseFloat(r.amount) * 100);
        const amountCents = Math.round(base * (1 + markup / 100));
        const service = String(r.servicelevel?.name || r.servicelevel?.token || 'Shipping');
        return {
          id: String(r.object_id),
          carrier: String(r.provider || 'Carrier'),
          service,
          amountCents,
          days: r.estimated_days ?? null,
          exp,
          token: signQuote(tenantId, amountCents, service, exp),
        };
      })
      .filter((o: any) => Number.isFinite(o.amountCents))
      .sort((a: any, b: any) => a.amountCents - b.amountCents)
      .slice(0, 5);

    if (options.length === 0) {
      return NextResponse.json({ error: 'No carrier options for that address' }, { status: 422 });
    }
    return NextResponse.json({ options });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || 'Shipping quote failed').slice(0, 200) },
      { status: 500 }
    );
  }
}
