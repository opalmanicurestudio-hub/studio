import { NextRequest, NextResponse } from 'next/server';

import {
  insurableValueCents, protectionFor, protectionPolicy, shippoExtra,
} from '@/lib/shipment-protection';

// ─── /api/retail/shipping-label/route.ts ──────────────────────────────────────
// Shippo labels in the shape a human ships: see real rates, pick one, buy —
// and now UNDO: void a label that hasn't shipped and Shippo refunds the
// postage to the shop's account.
//
//   POST { tenantId, orderId, qrToken, action: 'rates',
//          parcel: { weightOz, lengthIn, widthIn, heightIn } }
//     → { rates: [{ id, provider, service, amountCents, days }] }
//
//   POST { ..., action: 'purchase', rateId }
//     → { trackingNumber, carrier, trackingUrl, labelUrl }
//       Saves those + the Shippo transaction id on the order and writes a
//       label_generated audit event. Stage does NOT change — "Confirm
//       shipped" stays the explicit truth moment.
//
//   POST { ..., action: 'void' }
//     → requests a Shippo refund for the saved transaction, clears the
//       label/tracking fields from the order, and writes a label_voided
//       note. Blocked once the order is shipped — voiding a label that's
//       on a moving box helps no one. (Carriers approve refunds for unused
//       labels, usually within days; USPS auto-refunds unscanned labels.)
//
// Config: retailSettings.shippoApiKey (per tenant; SHIPPO_API_KEY env as a
// platform fallback) + retailSettings.shipFrom { name, street1, city,
// state, zip, phone }. qrToken is the same possession proof the print and
// support routes use.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-shipping';
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

const SHIPPO = 'https://api.goshippo.com';

async function shippo(apiKey: string, path: string, payload: any) {
  const res = await fetch(`${SHIPPO}${path}`, {
    method: 'POST',
    headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail || data?.__all__?.[0] || JSON.stringify(data).slice(0, 200);
    throw new Error(`Shippo: ${detail}`);
  }
  return data;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  const action = String(body.action || '').trim();

  if (!tenantId || !orderId || !qrToken || !['rates', 'purchase', 'void'].includes(action)) {
    return NextResponse.json({ error: 'tenantId, orderId, qrToken, and a valid action are required' }, { status: 400 });
  }

  const db = getAdminDb();
  const [tenantSnap, orderSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get(),
  ]);
  if (!tenantSnap.exists || !orderSnap.exists) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const tenant = tenantSnap.data() as any;
  const rs = tenant.retailSettings || {};
  const order = orderSnap.data() as any;
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);

  if (order.qrToken !== qrToken) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const apiKey = String(rs.shippoApiKey || process.env.SHIPPO_API_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'Shippo is not connected — add your API key in Shop Settings.' }, { status: 400 });
  }

  try {
    if (action === 'void') {
      if (['shipped', 'handed_off', 'completed'].includes(order.stage)) {
        return NextResponse.json({ error: 'This order already shipped — the label can\u2019t be voided from here.' }, { status: 409 });
      }
      const txnId = String(order.shippoTransactionId || '').trim();
      if (!txnId) return NextResponse.json({ error: 'No purchased label is saved on this order.' }, { status: 400 });

      const refund = await shippo(apiKey, '/refunds/', { transaction: txnId, async: false });
      const status = String(refund.status || 'PENDING');

      const evRef = orderRef.collection('events').doc();
      const batch = db.batch();
      batch.set(orderRef, {
        trackingNumber: '', carrier: '', trackingUrl: '', labelUrl: '',
        shippoTransactionId: '', labelVoidedAt: new Date().toISOString(),
      }, { merge: true });
      batch.set(evRef, {
        id: evRef.id, type: 'note', at: new Date().toISOString(),
        actorId: 'shippo', actorName: 'Shippo',
        meta: { text: `Label voided — refund ${status.toLowerCase()} (carrier approval can take a few days)` },
      });
      await batch.commit();

      return NextResponse.json({
        ok: true,
        message: status === 'SUCCESS'
          ? 'Label voided — postage refunded.'
          : 'Void requested — the carrier usually approves unused labels within a few days.',
      });
    }

    const from = rs.shipFrom || {};
    if (!from.street1 || !from.city || !from.state || !from.zip) {
      return NextResponse.json({ error: 'Ship-from address is incomplete — set it in Shop Settings.' }, { status: 400 });
    }
    if (order.method !== 'ship' || !order.shippingAddress) {
      return NextResponse.json({ error: 'This is not a shipping order' }, { status: 400 });
    }

    const to = order.shippingAddress;
    const addressTo = {
      name: to.name, street1: to.line1, street2: to.line2 || '',
      city: to.city, state: to.state, zip: to.postalCode, country: to.country || 'US',
      phone: order.customerPhone || '', email: order.customerEmail || '',
    };
    const addressFrom = {
      name: from.name || tenant.businessName || tenant.name || 'Shop',
      street1: from.street1, street2: from.street2 || '',
      city: from.city, state: from.state, zip: from.zip, country: 'US',
      phone: from.phone || '',
    };

    if (action === 'rates') {
      // Accept a parcels ARRAY (multi-box B2B shipments) or the legacy
      // single `parcel`. Each box quotes and labels individually — one rate
      // covers the whole set.
      const raw = Array.isArray(body.parcels) && body.parcels.length > 0
        ? body.parcels.slice(0, 10)
        : [body.parcel || {}];
      const parcels = raw.map((p: any) => ({
        length: String(Math.max(1, Number(p.lengthIn) || 10)),
        width: String(Math.max(1, Number(p.widthIn) || 8)),
        height: String(Math.max(1, Number(p.heightIn) || 4)),
        distance_unit: 'in',
        weight: String(Math.max(1, Number(p.weightOz) || 16)),
        mass_unit: 'oz',
      }));
      // Signature and insurance are priced by the carrier on the shipment, so
      // they are added HERE and not at purchase — otherwise staff would be
      // shown one price and charged another.
      const decision = protectionFor(order, protectionPolicy(rs));
      const extra = shippoExtra(decision);

      const shipment = await shippo(apiKey, '/shipments/', {
        address_from: addressFrom, address_to: addressTo, parcels, async: false,
        ...(extra ? { extra } : {}),
      });
      const rates = (shipment.rates || [])
        .map((r: any) => ({
          id: r.object_id,
          provider: r.provider,
          service: r.servicelevel?.name || r.servicelevel?.token || '',
          amountCents: Math.round(parseFloat(r.amount) * 100),
          days: r.estimated_days ?? null,
        }))
        .filter((r: any) => Number.isFinite(r.amountCents))
        .sort((a: any, b: any) => a.amountCents - b.amountCents)
        .slice(0, 8);
      if (rates.length === 0) {
        return NextResponse.json({ error: 'No rates returned — check the addresses and parcel size.' }, { status: 422 });
      }
      return NextResponse.json({
        rates,
        // Surfaced so the ship dialog can say why a rate costs more than usual.
        protection: {
          signature: decision.signature,
          insuranceCents: decision.insuranceCents,
          reasons: decision.reasons,
        },
      });
    }

    // purchase
    const rateId = String(body.rateId || '').trim();
    if (!rateId) return NextResponse.json({ error: 'rateId is required' }, { status: 400 });

    const txn = await shippo(apiKey, '/transactions/', {
      rate: rateId, label_file_type: 'PDF_4x6', async: false,
    });
    if (txn.status !== 'SUCCESS') {
      const msg = (txn.messages || []).map((m: any) => m.text).join('; ') || 'Label purchase failed';
      return NextResponse.json({ error: `Shippo: ${msg}` }, { status: 422 });
    }

    // Multi-parcel purchases: the master transaction is one of N — fetch the
    // full set for this rate so every box gets its own label + tracking.
    let extraLabelUrls: string[] = [];
    let extraTracking: string[] = [];
    try {
      const listRes = await fetch(`${SHIPPO}/transactions/?rate=${encodeURIComponent(rateId)}&results=25`, {
        headers: { Authorization: `ShippoToken ${apiKey}` },
      });
      const list = await listRes.json().catch(() => ({}));
      const all = (list.results || []).filter((t: any) => t.status === 'SUCCESS' && t.object_id !== txn.object_id);
      extraLabelUrls = all.map((t: any) => String(t.label_url || '')).filter(Boolean);
      extraTracking = all.map((t: any) => String(t.tracking_number || '')).filter(Boolean);
    } catch {
      // single-parcel shipments have nothing extra; a listing hiccup only
      // costs the extra-label buttons, never the purchase itself
    }

    const result = {
      trackingNumber: String(txn.tracking_number || ''),
      carrier: String(txn.rate?.provider || txn.provider || 'Carrier'),
      trackingUrl: String(txn.tracking_url_provider || ''),
      labelUrl: String(txn.label_url || ''),
      extraLabelUrls,
      packageCount: 1 + extraLabelUrls.length,
    };

    // The weight the system expected, from the per-item weights the board
    // summed. Written at purchase because it cannot be reconstructed later,
    // and because a carrier-scanned weight is meaningless without it.
    const purchaseDecision = protectionFor(order, protectionPolicy(rs));
    const expectedWeightOz = (Array.isArray(body.parcels) && body.parcels.length > 0
      ? body.parcels
      : [body.parcel || {}]
    ).reduce((a: number, p: any) => a + (Number(p?.weightOz) || 0), 0);

    const evRef = orderRef.collection('events').doc();
    const batch = db.batch();
    batch.set(orderRef, {
      shipmentProtection: {
        signature: purchaseDecision.signature,
        insuranceCents: purchaseDecision.insuranceCents,
        insurableValueCents: insurableValueCents(order),
        expectedWeightOz,
        decidedAt: new Date().toISOString(),
      },
      trackingNumber: result.trackingNumber,
      carrier: result.carrier,
      trackingUrl: result.trackingUrl,
      labelUrl: result.labelUrl,
      shippoTransactionId: String(txn.object_id || ''),
      extraLabelUrls,
      extraTrackingNumbers: extraTracking,
      packageCount: result.packageCount,
    }, { merge: true });
    batch.set(evRef, {
      id: evRef.id, type: 'label_generated', at: new Date().toISOString(),
      actorId: 'shippo', actorName: 'Shippo',
      meta: {
        carrier: result.carrier,
        trackingNumber: result.trackingNumber,
        packages: result.packageCount,
        signature: purchaseDecision.signature,
        insuranceCents: purchaseDecision.insuranceCents,
        expectedWeightOz,
        text: purchaseDecision.reasons.join(' · ') || 'No added protection on this shipment',
      },
    });
    await batch.commit();

    return NextResponse.json({
      ...result,
      protection: {
        signature: purchaseDecision.signature,
        insuranceCents: purchaseDecision.insuranceCents,
        reasons: purchaseDecision.reasons,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || 'Shipping label request failed').slice(0, 300) }, { status: 502 });
  }
}
