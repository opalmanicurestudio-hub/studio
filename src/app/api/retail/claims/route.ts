import { NextRequest, NextResponse } from 'next/server';

// ─── /api/retail/claims/route.ts ──────────────────────────────────────────────
// A claim is a customer's report that what arrived doesn't match what was
// ordered — missing, damaged, wrong item, or never arrived. It is NOT a
// return (nothing needs shipping back to open one) and NOT a chargeback.
//
// The engine's one rule: decide from EVIDENCE, never from mood. At open
// time the route snapshots the order's fulfilment evidence (scans, photos,
// weight, carrier state) INTO the claim doc, so the judgment that follows —
// automatic or human — reads the record as it stood, even if the order doc
// changes later.
//
// Routing is deliberately conservative in v1:
//   AUTO-APPROVE only when the shop's own evidence AGREES with the customer
//   (a "missing item" that was never scanned complete is the shop's short,
//   not a dispute), AND the value fits under retailSettings.
//   claimAutoResolveMaxCents (default 0 = off — dormant until the shop
//   raises it, the pack-photo pattern). Auto-approval QUEUES the refund in
//   pendingRefundCents — the same staff banner every other refund uses —
//   so money still moves through one human tap in Stripe.
//   EVERYTHING ELSE → in_review with the evidence pre-assembled.
//   The engine never auto-DECLINES: strong evidence routes to a human with
//   the record; declining a customer is always a person's call.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-claims';
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

const CLAIM_TYPES = ['missing', 'damaged', 'wrong_item', 'not_received'] as const;
const CLAIM_STAGES = ['shipped', 'handed_off', 'completed'];

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  const type = String(body.type || '').trim() as (typeof CLAIM_TYPES)[number];
  const lineId = String(body.lineId || '').trim();
  const qty = Math.max(1, Math.floor(Number(body.qty) || 1));
  const description = String(body.description || '').trim().slice(0, 600);

  if (!tenantId || !orderId || !qrToken || !CLAIM_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Missing claim details' }, { status: 400 });
  }
  if (type !== 'not_received' && !lineId) {
    return NextResponse.json({ error: 'Pick the affected item.' }, { status: 400 });
  }

  const db = getAdminDb();
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);

  try {
    const [orderSnap, tenantSnap] = await Promise.all([
      orderRef.get(),
      db.collection('tenants').doc(tenantId).get(),
    ]);
    if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const order = orderSnap.data() as any;
    if (order.qrToken !== qrToken) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    if (!CLAIM_STAGES.includes(order.stage)) {
      return NextResponse.json({ error: 'Problems can be reported once the order has been picked up, delivered, or shipped.' }, { status: 409 });
    }

    const rs = (tenantSnap.exists ? (tenantSnap.data() as any).retailSettings : {}) || {};
    const autoMaxCents = Math.max(0, Math.floor(Number(rs.claimAutoResolveMaxCents) || 0));

    // One open claim per order per line+type — a stuck retry button or a
    // double tap must not file the same grievance twice.
    const dupId = `${orderId}__${type}__${lineId || 'order'}`;
    const claimRef = db.collection(`tenants/${tenantId}/retailClaims`).doc(dupId);
    const dupSnap = await claimRef.get();
    if (dupSnap.exists) {
      return NextResponse.json({ ok: true, status: (dupSnap.data() as any).status, message: 'This is already on file — the shop has it.' });
    }

    const lines: any[] = order.lines || [];
    const line = lineId ? lines.find((l) => l.lineId === lineId) : null;
    if (lineId && !line) return NextResponse.json({ error: 'Item not found on this order.' }, { status: 400 });

    // ── Evidence snapshot: the order's record AS OF the claim ──
    const lineTarget = line ? Math.max(0, (line.qtyOrdered || 0) - (line.qtyShorted || 0)) : 0;
    const lineScanned = line ? Number(line.qtyScanned) || 0 : 0;
    const allScanned = lines.length > 0 && lines.every((l) => (Number(l.qtyScanned) || 0) >= Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0)));
    const photoCount = Array.isArray(order.packPhotoUrls) ? order.packPhotoUrls.length : 0;
    const evidence = {
      allScanned,
      lineScanned: line ? `${lineScanned}/${lineTarget}` : null,
      lineScanComplete: line ? lineScanned >= lineTarget : null,
      photoCount,
      hasCarrier: Boolean(order.trackingNumber),
      delivered: order.stage === 'completed',
      stageAtClaim: String(order.stage),
    };

    const claimValueCents = line
      ? Math.min(qty, lineTarget || qty) * (Number(line.unitPriceCents) || 0)
      : Math.max(0, Number(order.totalCents) || 0);

    // ── Risk + routing ──
    const priorClaims = await db.collection(`tenants/${tenantId}/retailClaims`)
      .where('customerEmail', '==', String(order.customerEmail || '')).limit(10).get()
      .then((s: any) => s.size).catch(() => 0);

    const riskFactors: string[] = [];
    if (claimValueCents >= 10000) riskFactors.push('High value');
    if (priorClaims >= 2) riskFactors.push(`${priorClaims} prior claims on this email`);
    if (type === 'missing' && evidence.lineScanComplete) riskFactors.push('Item was scanned complete at packing');
    if (type === 'missing' && photoCount > 0) riskFactors.push('Packing photo exists');
    if (type === 'not_received' && evidence.delivered) riskFactors.push('Carrier reported delivered');
    const risk: 'low' | 'medium' | 'high' = riskFactors.length === 0 ? 'low' : riskFactors.length === 1 ? 'medium' : 'high';

    // Auto-approve ONLY the case where the shop's own record concedes the
    // point: a missing/wrong-item claim on a line that was never scanned
    // complete, under the shop's ceiling, from a low-risk account.
    const evidenceConcedes = (type === 'missing' || type === 'wrong_item') && line != null && !evidence.lineScanComplete;
    const autoApprove = autoMaxCents > 0 && claimValueCents > 0 && claimValueCents <= autoMaxCents && risk === 'low' && evidenceConcedes;

    const now = new Date().toISOString();
    const claim = {
      id: dupId, tenantId, orderId,
      orderNumber: order.orderNumber ?? null,
      customerName: String(order.customerName || ''),
      customerEmail: String(order.customerEmail || ''),
      type, qty,
      lineId: lineId || null,
      lineName: line ? String(line.name || '') : null,
      lineSku: line ? String(line.sku || '') : null,
      description: description || null,
      claimValueCents,
      evidence, risk, riskFactors,
      status: autoApprove ? 'auto_resolved' : 'in_review',
      resolution: autoApprove ? 'refund' : null,
      resolutionCents: autoApprove ? claimValueCents : null,
      openedBy: 'customer',
      openedAt: now,
      decidedAt: autoApprove ? now : null,
      decidedBy: autoApprove ? 'auto (evidence + shop rules)' : null,
    };

    const batch = db.batch();
    batch.set(claimRef, JSON.parse(JSON.stringify(claim)));
    const evRef = orderRef.collection('events').doc();
    batch.set(evRef, {
      id: evRef.id, type: 'note', at: now,
      actorId: 'customer', actorName: claim.customerName || 'Customer',
      meta: { text: `Claim opened: ${type}${line ? ` — ${line.name} ×${qty}` : ''}${autoApprove ? ' (auto-approved, refund queued)' : ' (in review)'}` },
    });
    if (autoApprove) {
      batch.update(orderRef, {
        pendingRefundCents: Math.max(0, Number(order.pendingRefundCents) || 0) + claimValueCents,
      });
    }
    await batch.commit();

    return NextResponse.json({
      ok: true,
      status: claim.status,
      message: autoApprove
        ? 'Approved — the record backs you up. Your refund is queued and the shop will process it shortly.'
        : 'Reported — the shop is reviewing it with the packing record and will follow up by email.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || 'Request failed').slice(0, 200) }, { status: 500 });
  }
}
