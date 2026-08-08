import { NextRequest, NextResponse } from 'next/server';

// ─── /api/retail/return-label/route.ts ────────────────────────────────────────
// Buys a RETURN shipping label for an authorized return: the outbound label
// machinery with the addresses reversed and is_return set. Called from the
// returns desk; the customer gets the label by email with plain instructions.
//
// The economics that make this safe to click freely: Shippo return labels
// are billed when the CARRIER FIRST SCANS them, not when purchased — so a
// label for a return that never ships costs nothing.
//
// Who pays comes from retailSettings.returnLabelPayer:
//   'shop'     — shop absorbs the label, always.
//   'customer' — label cost is deducted from the refund, disclosed in the
//                email BEFORE they ship.
//   'fault'    — the default and the fair one: the shop covers returns the
//                shop caused (damaged, defective, wrong item — and 'other',
//                because ambiguity reads in the customer's favor); only a
//                pure changed-mind return deducts.
// A deduction is only ever RECORDED here (labelDeductCents on the return) —
// the refund banner shows it and a person still executes the money.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-returnlabel';
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

const SHOP_FAULT_REASONS = ['damaged_in_transit', 'defective', 'wrong_item', 'other'];

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const returnId = String(body.returnId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  if (!tenantId || !orderId || !returnId || !qrToken) {
    return NextResponse.json({ error: 'tenantId, orderId, returnId, and qrToken are required' }, { status: 400 });
  }

  const db = getAdminDb();
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const retRef = db.collection(`tenants/${tenantId}/retailReturns`).doc(returnId);

  try {
    const [tenantSnap, orderSnap, retSnap] = await Promise.all([
      db.collection('tenants').doc(tenantId).get(), orderRef.get(), retRef.get(),
    ]);
    if (!tenantSnap.exists || !orderSnap.exists || !retSnap.exists) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 });
    }
    const tenant = tenantSnap.data() as any;
    const rs = tenant.retailSettings || {};
    const order = orderSnap.data() as any;
    const ret = retSnap.data() as any;

    if (order.qrToken !== qrToken) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    if (ret.orderId !== orderId) return NextResponse.json({ error: 'Return does not belong to this order' }, { status: 400 });
    if (ret.status !== 'open') {
      return NextResponse.json({ error: 'A label can only be sent while the return is open.' }, { status: 409 });
    }
    if (ret.labelUrl) {
      return NextResponse.json({ ok: true, alreadySent: true, labelUrl: ret.labelUrl, trackingNumber: ret.labelTrackingNumber || '', message: 'A label was already sent for this return.' });
    }
    if (!order.shippingAddress) {
      return NextResponse.json({ error: 'This order has no shipping address on file — it was a pickup. No label needed.' }, { status: 409 });
    }

    const apiKey = String(rs.shippoApiKey || process.env.SHIPPO_API_KEY || '').trim();
    if (!apiKey) return NextResponse.json({ error: 'Shippo is not connected — add your API key in Shop Settings.' }, { status: 400 });

    const from = rs.shipFrom || {};
    if (!from.street1 || !from.city || !from.state || !from.zip) {
      return NextResponse.json({ error: 'Ship-from address is incomplete — set it in Shop Settings.' }, { status: 400 });
    }

    // Reversed addresses: the customer sends, the shop receives.
    const cust = order.shippingAddress;
    const addressFrom = {
      name: cust.name, street1: cust.line1, street2: cust.line2 || '',
      city: cust.city, state: cust.state, zip: cust.postalCode, country: cust.country || 'US',
      phone: order.customerPhone || '', email: order.customerEmail || '',
    };
    const addressTo = {
      name: from.name || tenant.businessName || tenant.name || 'Shop',
      street1: from.street1, street2: from.street2 || '',
      city: from.city, state: from.state, zip: from.zip, country: 'US',
      phone: from.phone || '',
    };

    // Weight: map return lines back to inventory weights through the order's
    // lines; anything unmapped gets a padded guess. Return labels tolerate
    // approximation — carriers re-weigh and bill the true weight on scan.
    let weightOz = 0;
    const retLines: any[] = Array.isArray(ret.lines) ? ret.lines : [];
    for (const rl of retLines) {
      const orig = (order.lines || []).find((l: any) => l.lineId === rl.lineId);
      const pid = orig?.productId;
      let per = 0;
      if (pid) {
        try {
          const item = await db.collection(`tenants/${tenantId}/inventory`).doc(String(pid)).get();
          if (item.exists) per = Number((item.data() as any).weightOz) || 0;
        } catch {
          per = 0;
        }
      }
      weightOz += (per > 0 ? per : 4) * (Number(rl.qty) || 1);
    }
    weightOz = Math.max(8, Math.ceil(weightOz) + 3);

    const shipment = await shippo(apiKey, '/shipments/', {
      address_from: addressFrom,
      address_to: addressTo,
      parcels: [{ length: '10', width: '8', height: '4', distance_unit: 'in', weight: String(weightOz), mass_unit: 'oz' }],
      is_return: true,
      async: false,
    });
    const rates = (shipment.rates || [])
      .map((r: any) => ({ id: r.object_id, provider: r.provider, service: r.servicelevel?.name || '', amountCents: Math.round(parseFloat(r.amount) * 100) }))
      .filter((r: any) => Number.isFinite(r.amountCents) && r.amountCents > 0)
      .sort((a: any, b: any) => a.amountCents - b.amountCents);
    if (rates.length === 0) return NextResponse.json({ error: 'No return rates came back — check the addresses.' }, { status: 422 });
    const cheapest = rates[0];

    const txn = await shippo(apiKey, '/transactions/', { rate: cheapest.id, label_file_type: 'PDF_4x6', async: false });
    if (txn.status !== 'SUCCESS') {
      const msg = (txn.messages || []).map((m: any) => m.text).join('; ') || 'Label purchase failed';
      return NextResponse.json({ error: `Shippo: ${msg}` }, { status: 422 });
    }

    // Payer decision — recorded, disclosed, never silently executed.
    const payer = rs.returnLabelPayer === 'shop' || rs.returnLabelPayer === 'customer' ? rs.returnLabelPayer : 'fault';
    const anyShopFault = retLines.some((rl: any) => SHOP_FAULT_REASONS.includes(String(rl.reason)));
    const deduct = payer === 'customer' || (payer === 'fault' && !anyShopFault);
    const labelDeductCents = deduct ? cheapest.amountCents : 0;

    const now = new Date().toISOString();
    const batch = db.batch();
    batch.set(retRef, {
      labelUrl: String(txn.label_url || ''),
      labelTrackingNumber: String(txn.tracking_number || ''),
      labelCarrier: String(cheapest.provider || ''),
      labelService: String(cheapest.service || ''),
      labelCostCents: cheapest.amountCents,
      labelDeductCents,
      labelPurchasedAt: now,
    }, { merge: true });
    const evRef = orderRef.collection('events').doc();
    batch.set(evRef, {
      id: evRef.id, type: 'note', at: now,
      actorId: 'staff', actorName: 'Returns desk',
      meta: { text: `Return label emailed — ${cheapest.provider} ${cheapest.service}, ${String(txn.tracking_number || '')}${labelDeductCents ? ` ($${(labelDeductCents / 100).toFixed(2)} deducted from refund)` : ' (shop pays)'}` },
    });
    await batch.commit();

    // Email AFTER commit — a crash here loses one email, never the label.
    try {
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      const RESEND_FROM = process.env.RESEND_FROM;
      const to = String(order.customerEmail || '').trim();
      if (RESEND_API_KEY && RESEND_FROM && to) {
        const shopName = String(tenant.businessName || tenant.name || 'the shop');
        const firstName = String(order.customerName || '').trim().split(/\s+/)[0] || 'there';
        const itemsHtml = retLines.slice(0, 8).map((rl: any) =>
          `<tr><td style="font-size:13px;color:#0f172a;padding:4px 0">${String(rl.name || 'Item')}${(Number(rl.qty) || 1) > 1 ? ` \u00d7 ${Number(rl.qty)}` : ''}</td></tr>`
        ).join('');
        const deductHtml = labelDeductCents
          ? `<p style="font-size:13px;color:#334155;line-height:1.6">Return shipping of <strong>$${(labelDeductCents / 100).toFixed(2)}</strong> will be deducted from your refund, per the shop's return policy — you'll see the exact amount before it's processed.</p>`
          : `<p style="font-size:13px;color:#334155;line-height:1.6">Return shipping is on ${shopName} — the label costs you nothing.</p>`;
        const html = `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px">
          <p style="font-size:14px;color:#0f172a;font-weight:700">Hi ${firstName},</p>
          <p style="font-size:14px;color:#334155;line-height:1.6">Your return label for order #${String(order.orderNumber ?? '').padStart(4, '0')} is ready. Print it, tape it over the old label on any box, and drop it with ${cheapest.provider} — that's the whole job.</p>
          <table style="border-collapse:collapse;margin:14px 0">${itemsHtml}</table>
          ${deductHtml}
          <p style="margin:22px 0"><a href="${String(txn.label_url || '')}" style="background:#111827;color:#ffffff;padding:14px 30px;border-radius:12px;text-decoration:none;font-weight:700;font-size:13px">Get my return label</a></p>
          <p style="font-size:12px;color:#94a3b8;line-height:1.6">Tracking ${String(txn.tracking_number || '')}. Your refund moves once the return arrives and is checked in.</p>
        </div>`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: RESEND_FROM, to: [to], subject: `Your return label from ${shopName}`, html }),
        });
      }
    } catch {
      // email best-effort; the desk shows the label link either way
    }

    return NextResponse.json({
      ok: true,
      labelUrl: String(txn.label_url || ''),
      trackingNumber: String(txn.tracking_number || ''),
      carrier: cheapest.provider,
      costCents: cheapest.amountCents,
      deductCents: labelDeductCents,
      message: `Label emailed — ${cheapest.provider} ${cheapest.service}, $${(cheapest.amountCents / 100).toFixed(2)}${labelDeductCents ? ' (deducted from refund)' : ' (shop pays)'}. Billed only when the carrier scans it.`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || 'Request failed').slice(0, 200) }, { status: 500 });
  }
}
