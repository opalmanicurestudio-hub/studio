import { labelFormatOf, shippoFileType, withOrderRef } from '@/lib/label-format';
import { SHIP_DENIED, mayShip } from '@/lib/fulfilment-guard';
import { shippoKeyFor } from '@/lib/retail-secrets';
import { rateCents, recordPostage, reversePostage } from '@/lib/postage';
import { groundFilter } from '@/lib/ground-only';
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { addressKey, openRequest } from '@/lib/address-flow';

import {
  insurableValueCents, insuredParcels, protectionFor, protectionPolicy,
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

  if (!tenantId || !orderId || !qrToken || !['rates', 'purchase', 'void', 'unscanned_ok', 'voided_seen'].includes(action)) {
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
  // Labels spend the shop's postage money: a signed-in team member only. The order's token alone is not enough;
  // it is on the customer's QR code and order link.
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!mayShip(auth.actor)) return NextResponse.json({ error: SHIP_DENIED }, { status: 403 });

  const apiKey = await shippoKeyFor(db, tenantId, tenant);
  // Orders going in the same box (lib/ship-together): the box carries all their goods, so it's insured for all of them.
  const withIds: string[] = (Array.isArray(body.withOrderIds) ? body.withOrderIds : []).map(String).filter((id: string) => id && id !== orderId).slice(0, 9);
  const together = withIds.length
    ? (await Promise.all(withIds.map((id) => db.collection(`tenants/${tenantId}/retailOrders`).doc(id).get())))
        .filter((d: any) => d.exists).map((d: any) => d.data() as any)
        .filter((o: any) => String(o.customerEmail || '').trim().toLowerCase() === String(order.customerEmail || '').trim().toLowerCase())
    : [];
  const boxOrder = together.length ? { ...order, lines: [...(order.lines || []), ...together.flatMap((o: any) => o.lines || [])] } : order;
  if (!apiKey) {
    return NextResponse.json({ error: 'Shippo is not connected — add your API key in Shop Settings.' }, { status: 400 });
  }

  try {
    // A label under Needs you (lib/label-sweep) that someone has looked at: nobody has scanned it for days and the box
    // did go out, a void of it didn't finish, or it couldn't be voided automatically. Either way, stop asking.
    if (action === 'unscanned_ok') {
      const now = new Date().toISOString();
      const w = String(order.labelUnscanned?.why || '');
      await orderRef.set({ labelUnscanned: { ...(order.labelUnscanned || {}), dismissedAt: now, dismissedBy: auth.actor.name }, labelUnscannedOpen: false }, { merge: true });
      const ev = orderRef.collection('events').doc();
      const text = w === 'void_unfinished' ? 'Kept the label after a void of it didn’t finish' : w === 'void_refused' ? 'Left the label as it is (it couldn’t be voided automatically)' : 'Confirmed the box went out, though the carrier hasn’t scanned it yet';
      await ev.set({ id: ev.id, type: 'note', at: now, actorId: auth.actor.uid, actorName: auth.actor.name, meta: { kind: 'label_unscanned_ok', text } });
      return NextResponse.json({ ok: true, message: w ? 'Noted.' : 'Noted. If it still isn’t scanned in a few days, check with the carrier.' });
    }

    // A voided label the carrier scanned anyway (api/retail/shippo-webhook): seen, off Needs you.
    if (action === 'voided_seen') {
      await orderRef.set({ voidedLabelMoving: { ...(order.voidedLabelMoving || {}), open: false, seenAt: new Date().toISOString(), seenBy: auth.actor.name } }, { merge: true });
      return NextResponse.json({ ok: true, message: 'Noted.' });
    }

    if (action === 'void') {
      // A box that has gone out keeps its label: once the carrier has it, only the carrier's own options are left.
      if (['shipped', 'handed_off', 'completed'].includes(order.stage)) {
        return NextResponse.json({ error: 'This order already shipped — the label can\u2019t be voided from here.' }, { status: 409 });
      }
      if (!String(order.shippoTransactionId || '').trim()) return NextResponse.json({ error: 'No purchased label is saved on this order.' }, { status: 400 });
      // Every box's label, checked against the carrier first (lib/label-sweep): by hand, refused only if the carrier has
      // scanned it, and a label shared by orders in one box comes off all of them; automatically (body.auto, from
      // cancelling), only when the carrier shows it unused, it's not on a USPS form and it isn't shared. Boxes that
      // voided are kept on the order if others didn't, so trying again finishes the job.
      const { voidIfUnused } = await import('@/lib/label-sweep');
      const r = await voidIfUnused(db, tenantId, orderRef, order, apiKey, body.auto === true ? 'the order was cancelled' : 'voided by hand',
        { id: auth.actor.uid, name: auth.actor.name }, { byHand: body.auto !== true });
      if (!r.ok) return NextResponse.json({ error: r.error, refused: r.refused || null }, { status: 409 });
      return NextResponse.json({ ok: true, message: 'Label voided. The carrier refunds the postage, usually within a couple of weeks.' });
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
      const decision = protectionFor(boxOrder, protectionPolicy(rs));
      // Several boxes: each is insured for its own share of the goods, never the whole value again (lib/shipment-protection).
      const insured = insuredParcels(decision, parcels);
      const extra = withOrderRef(insured.extra, rs, order);

      const shipment = await shippo(apiKey, '/shipments/', {
        address_from: addressFrom, address_to: addressTo, parcels: insured.parcels, async: false,
        ...(extra ? { extra } : {}),
      });
      const rates = groundFilter(shipment.rates || [], order.groundOnly === true)
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
        return NextResponse.json({ error: order.groundOnly ? 'This order can only go by ground, and no ground rate came back. Check the address, or ship it another way.' : 'No rates returned — check the addresses and parcel size.' }, { status: 422 });
      }
      return NextResponse.json({
        rates, groundOnly: order.groundOnly === true,
        // The address these rates were priced for: buying must be for the same one (lib/address-flow).
        addressKey: addressKey(order.shippingAddress),
        // Surfaced so the ship dialog can say why a rate costs more than usual.
        protection: {
          signature: decision.signature,
          insuranceCents: decision.insuranceCents,
          reasons: decision.reasons,
        },
      });
    }

    // purchase: never a second label over one that is still live (it could never be voided afterwards).
    if (order.shippoTransactionId && order.labelUrl) return NextResponse.json({ error: 'This order already has a label. Void it first to buy a new one.' }, { status: 409 });
    if (['cancelled', 'completed'].includes(String(order.stage))) return NextResponse.json({ error: `This order is ${order.stage}.` }, { status: 409 });
    if (openRequest(order)) return NextResponse.json({ error: 'The customer asked to change the address. Answer that on the order first, so the label goes to the right place.' }, { status: 409 });
    // The rate was priced for an address; if the order's address changed since, the label would go to the old one.
    const boughtFor = addressKey(order.shippingAddress);
    if (body.addressKey && String(body.addressKey) !== boughtFor) return NextResponse.json({ error: 'The address changed since these rates came in. Get new rates and buy the label again.', addressChanged: true }, { status: 409 });
    const rateId = String(body.rateId || '').trim();
    if (!rateId) return NextResponse.json({ error: 'rateId is required' }, { status: 400 });

    const txn = await shippo(apiKey, '/transactions/', {
      rate: rateId, label_file_type: shippoFileType(labelFormatOf(rs)), async: false,
    });
    if (txn.status !== 'SUCCESS') {
      const msg = (txn.messages || []).map((m: any) => m.text).join('; ') || 'Label purchase failed';
      return NextResponse.json({ error: `Shippo: ${msg}` }, { status: 422 });
    }

    // Multi-parcel purchases: the master transaction is one of N — fetch the
    // full set for this rate so every box gets its own label + tracking.
    let extraLabelUrls: string[] = [];
    let extraTracking: string[] = [];
    let extraTrackingUrls: string[] = [];
    try {
      const listRes = await fetch(`${SHIPPO}/transactions/?rate=${encodeURIComponent(rateId)}&results=25`, {
        headers: { Authorization: `ShippoToken ${apiKey}` },
      });
      const list = await listRes.json().catch(() => ({}));
      const all = (list.results || []).filter((t: any) => t.status === 'SUCCESS' && t.object_id !== txn.object_id);
      extraLabelUrls = all.map((t: any) => String(t.label_url || '')).filter(Boolean);
      extraTracking = all.map((t: any) => String(t.tracking_number || '')).filter(Boolean);
      extraTrackingUrls = all.filter((t: any) => t.tracking_number).map((t: any) => String(t.tracking_url_provider || ''));
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
      extraTrackingNumbers: extraTracking,
      packageCount: 1 + extraLabelUrls.length,
    };

    // The weight the system expected, from the per-item weights the board
    // summed. Written at purchase because it cannot be reconstructed later,
    // and because a carrier-scanned weight is meaningless without it.
    const purchaseDecision = protectionFor(boxOrder, protectionPolicy(rs));
    const expectedWeightOz = (Array.isArray(body.parcels) && body.parcels.length > 0
      ? body.parcels
      : [body.parcel || {}]
    ).reduce((a: number, p: any) => a + (Number(p?.weightOz) || 0), 0);

    // Saved only if the order still goes to the address the label was bought for, has no change waiting, and has no
    // other label; otherwise the new label is voided straight away.
    const evRef = orderRef.collection('events').doc();
    const saved = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(orderRef)).data() || {};
      if (addressKey(cur.shippingAddress) !== boughtFor || openRequest(cur) || (cur.shippoTransactionId && cur.labelUrl)) return false;
      tx.set(orderRef, {
        shipmentProtection: {
          signature: purchaseDecision.signature,
          insuranceCents: purchaseDecision.insuranceCents,
          insurableValueCents: insurableValueCents(boxOrder),
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
        extraTrackingUrls,
        packageCount: result.packageCount,
        labelsChecked: [],
      }, { merge: true });
      tx.set(evRef, {
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
      return true;
    });
    if (!saved) {
      const { voidOrderLabels } = await import('@/lib/label-void');
      await voidOrderLabels(db, tenantId, { shippoTransactionId: String(txn.object_id || ''), extraLabelUrls, trackingNumber: result.trackingNumber, extraTrackingNumbers: extraTracking }, apiKey).catch(() => null);
      return NextResponse.json({ error: 'The address changed while the label was being bought, so that label was voided straight away. Get new rates and buy it again.', addressChanged: true }, { status: 409 });
    }
    // The postage is a real cost: into the books against this order (lib/postage).
    await recordPostage(db, tenantId, { id: orderId, orderNumber: order.orderNumber }, String(txn.object_id || ''), await rateCents(apiKey, rateId), result.carrier);

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
