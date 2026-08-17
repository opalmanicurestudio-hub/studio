import { NextRequest, NextResponse } from 'next/server';

import {
  insurableValueCents, protectionFor, protectionPolicy, shippoExtra,
} from '@/lib/shipment-protection';

// ─── /api/retail/shipping-labels-bulk ─────────────────────────────────────────
// POST { tenantId, orders: [{ orderId, qrToken }], parcelDefaults? }
//
// One tap buys a label for EVERY packed ship order: per order it sums the
// real product weights (item.weightOz × open qty, 4oz fallback), adds the
// box weight from the shop's packaging preset, quotes, takes the cheapest
// rate with the same signature/insurance policy the single-label dialog
// applies, and purchases — writing the identical fields and audit event the
// single route writes, so downstream (customer page, evidence, Shippo
// webhook) cannot tell the difference.
//
// PNG_4x6 on purpose: the bulk flow ends at /print/labels, a stack of 4x6
// pages — PNGs lay out as pages; PDFs don't embed. Auth is per-order link
// possession (qrToken), same bar as the single route; an order that fails
// (missing address, no rates) is reported and skipped, never blocking the
// rest. Sequential on purpose — Shippo rate-limits bursts.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-bulk-labels';
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
    const detail = data?.detail || (Array.isArray(data?.messages) ? data.messages.map((m: any) => m.text).join('; ') : '') || `HTTP ${res.status}`;
    throw new Error(`Shippo: ${detail}`);
  }
  return data;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const reqOrders: { orderId: string; qrToken: string }[] = (Array.isArray(body.orders) ? body.orders : [])
    .map((o: any) => ({ orderId: String(o?.orderId || '').trim(), qrToken: String(o?.qrToken || '').trim() }))
    .filter((o: any) => o.orderId && o.qrToken)
    .slice(0, 25);
  if (!tenantId || reqOrders.length === 0) {
    return NextResponse.json({ error: 'tenantId and at least one order are required' }, { status: 400 });
  }

  const pd = body.parcelDefaults || {};
  const parcelDefaults = {
    lengthIn: Math.max(1, Number(pd.lengthIn) || 10),
    widthIn: Math.max(1, Number(pd.widthIn) || 8),
    heightIn: Math.max(1, Number(pd.heightIn) || 4),
    boxWeightOz: Math.max(0, Number(pd.boxWeightOz) || 3),
  };

  const db = getAdminDb();
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const tenant = tenantSnap.data() as any;
  const rs = tenant.retailSettings || {};
  const apiKey = String(rs.shippoApiKey || process.env.SHIPPO_API_KEY || '').trim();
  if (!apiKey) return NextResponse.json({ error: 'Shippo is not connected — add your API key in Shop Settings.' }, { status: 400 });
  const from = rs.shipFrom || {};
  if (!from.street1 || !from.city || !from.state || !from.zip) {
    return NextResponse.json({ error: 'Ship-from address is incomplete — set it in Shop Settings.' }, { status: 400 });
  }
  const addressFrom = {
    name: from.name || String(tenant.businessName || tenant.name || 'Shop'),
    street1: from.street1, street2: from.street2 || '',
    city: from.city, state: from.state, zip: from.zip, country: 'US',
    phone: from.phone || '', email: from.email || '',
  };

  // Load every order first, then every distinct product's weight in one pass.
  const orderSnaps = await Promise.all(
    reqOrders.map((o) => db.collection(`tenants/${tenantId}/retailOrders`).doc(o.orderId).get())
  );
  const productIds = new Set<string>();
  orderSnaps.forEach((s: any) => {
    if (!s.exists) return;
    ((s.data() as any).lines || []).forEach((l: any) => { if (l.productId && l.digital !== true) productIds.add(String(l.productId)); });
  });
  const weightByProduct = new Map<string, number>();
  await Promise.all([...productIds].map(async (pid) => {
    try {
      const it = await db.collection(`tenants/${tenantId}/inventory`).doc(pid).get();
      if (it.exists) weightByProduct.set(pid, Number((it.data() as any).weightOz) || 0);
    } catch { /* falls back to the 4oz default */ }
  }));

  const results: any[] = [];
  for (let i = 0; i < reqOrders.length; i++) {
    const { orderId, qrToken } = reqOrders[i];
    const snap = orderSnaps[i];
    const fail = (error: string) => results.push({ orderId, ok: false, error });
    try {
      if (!snap.exists) { fail('Order not found'); continue; }
      const order = snap.data() as any;
      if (String(order.qrToken || '') !== qrToken) { fail('Not authorized'); continue; }
      if (order.trackingNumber || order.labelUrl) {
        results.push({ orderId, ok: true, skipped: true, labelUrl: order.labelUrl || '', trackingNumber: order.trackingNumber || '', message: 'Already has a label' });
        continue;
      }
      if (order.stage !== 'packed') { fail(`Not packed yet (${order.stage})`); continue; }
      if (order.method !== 'ship' || !order.shippingAddress) { fail('Not a ship order'); continue; }

      const cust = order.shippingAddress;
      const addressTo = {
        name: cust.name || order.customerName || 'Customer',
        street1: cust.line1, street2: cust.line2 || '',
        city: cust.city, state: cust.state, zip: cust.zip, country: 'US',
        phone: order.customerPhone || '', email: order.customerEmail || '',
      };

      const productOz = (order.lines || []).reduce((a: number, l: any) => {
        if (l.digital === true) return a;
        const open = Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0));
        const per = weightByProduct.get(String(l.productId)) || 0;
        return a + (per > 0 ? per : 4) * open;
      }, 0);
      const weightOz = Math.max(8, Math.ceil(productOz + parcelDefaults.boxWeightOz));

      const decision = protectionFor(order, protectionPolicy(rs));
      const extra = shippoExtra(decision);
      const shipment = await shippo(apiKey, '/shipments/', {
        address_from: addressFrom, address_to: addressTo,
        parcels: [{
          length: String(parcelDefaults.lengthIn), width: String(parcelDefaults.widthIn),
          height: String(parcelDefaults.heightIn), distance_unit: 'in',
          weight: String(weightOz), mass_unit: 'oz',
        }],
        async: false,
        ...(extra ? { extra } : {}),
      });
      const rates = (shipment.rates || [])
        .map((r: any) => ({ id: r.object_id, provider: r.provider, service: r.servicelevel?.name || '', amountCents: Math.round(parseFloat(r.amount) * 100) }))
        .filter((r: any) => Number.isFinite(r.amountCents) && r.amountCents > 0)
        .sort((a: any, b: any) => a.amountCents - b.amountCents);
      if (rates.length === 0) { fail('No rates came back'); continue; }
      const cheapest = rates[0];

      const txn = await shippo(apiKey, '/transactions/', { rate: cheapest.id, label_file_type: 'PNG_4x6', async: false });
      if (txn.status !== 'SUCCESS') {
        fail((txn.messages || []).map((m: any) => m.text).join('; ') || 'Label purchase failed');
        continue;
      }

      const now = new Date().toISOString();
      const orderRef = snap.ref;
      const evRef = orderRef.collection('events').doc();
      const batch = db.batch();
      batch.set(orderRef, {
        shipmentProtection: {
          signature: decision.signature,
          insuranceCents: decision.insuranceCents,
          insurableValueCents: insurableValueCents(order),
          expectedWeightOz: weightOz,
          decidedAt: now,
        },
        trackingNumber: String(txn.tracking_number || ''),
        carrier: String(txn.rate?.provider || cheapest.provider || 'Carrier'),
        trackingUrl: String(txn.tracking_url_provider || ''),
        labelUrl: String(txn.label_url || ''),
        shippoTransactionId: String(txn.object_id || ''),
        extraLabelUrls: [],
        extraTrackingNumbers: [],
        packageCount: 1,
      }, { merge: true });
      batch.set(evRef, {
        id: evRef.id, type: 'label_generated', at: now,
        actorId: 'shippo', actorName: 'Shippo',
        meta: {
          carrier: String(cheapest.provider || ''),
          trackingNumber: String(txn.tracking_number || ''),
          packages: 1,
          signature: decision.signature,
          insuranceCents: decision.insuranceCents,
          expectedWeightOz: weightOz,
          text: `Bulk purchase — cheapest rate (${cheapest.provider} ${cheapest.service}, $${(cheapest.amountCents / 100).toFixed(2)})${decision.reasons.length ? ' · ' + decision.reasons.join(' · ') : ''}`,
        },
      });
      await batch.commit();

      results.push({
        orderId, ok: true,
        labelUrl: String(txn.label_url || ''),
        trackingNumber: String(txn.tracking_number || ''),
        carrier: String(cheapest.provider || ''),
        costCents: cheapest.amountCents,
        weightOz,
      });
    } catch (e: any) {
      fail(String(e?.message || 'Failed').slice(0, 200));
    }
  }

  const bought = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  const spentCents = results.reduce((a, r) => a + (r.costCents || 0), 0);
  return NextResponse.json({
    ok: true, results, bought, skipped, failed, spentCents,
    message: `${bought} label${bought === 1 ? '' : 's'} bought ($${(spentCents / 100).toFixed(2)})${skipped ? `, ${skipped} already labeled` : ''}${failed ? `, ${failed} failed` : ''}.`,
  });
}
