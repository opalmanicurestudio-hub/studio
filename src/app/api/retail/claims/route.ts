import { NextRequest, NextResponse } from 'next/server';

// ─── /api/retail/claims/route.ts ──────────────────────────────────────────────
// A claim is a customer's report that what arrived doesn't match what was
// ordered — missing, damaged, wrong item, or never arrived. Not a return
// (nothing ships back to open one), not a chargeback.
//
// POST { action?: 'appeal', ... }  — open a claim, or appeal a declined one
// GET  ?tenantId=&orderId=&t=      — the customer's own claims on that order
//
// The engine's one rule: decide from EVIDENCE, never from mood. At open
// time the route snapshots the order's fulfilment evidence INTO the claim,
// so the judgment that follows — automatic or human — reads the record as
// it stood, even if the order changes later.
//
// Routing is deliberately conservative:
//   AUTO-APPROVE only when the shop's own evidence AGREES with the customer
//   (a "missing item" never scanned complete is the shop's short, not a
//   dispute), AND the value fits under retailSettings.claimAutoResolveMaxCents
//   (default 0 = off — dormant until the shop raises it). Auto-approval
//   QUEUES the refund in pendingRefundCents — the same staff banner every
//   refund uses — so money still moves through one human tap in Stripe.
//   EVERYTHING ELSE → in_review with the evidence pre-assembled.
//   The engine never auto-DECLINES: that is always a person's call.
//   A declined customer gets ONE appeal, which reopens review with their
//   note attached — the decline reason stays on the record.

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

const safeClaim = (d: any) => ({
  id: d.id, type: d.type, qty: d.qty || 1,
  lineName: d.lineName || null,
  status: d.status, resolution: d.resolution || null,
  resolutionCents: d.resolutionCents ?? null,
  declineReason: d.declineReason || null,
  appealedAt: d.appealedAt || null,
  openedAt: d.openedAt || null,
});

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const orderId = String(req.nextUrl.searchParams.get('orderId') || '').trim();
  const t = String(req.nextUrl.searchParams.get('t') || '').trim();
  if (!tenantId || !orderId || !t) return NextResponse.json({ error: 'Missing details' }, { status: 400 });

  const db = getAdminDb();
  try {
    const orderSnap = await db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get();
    if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    if ((orderSnap.data() as any).qrToken !== t) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });

    const snap = await db.collection(`tenants/${tenantId}/retailClaims`)
      .where('orderId', '==', orderId).limit(20).get();
    const claims = snap.docs
      .map((d: any) => safeClaim({ id: d.id, ...(d.data() || {}) }))
      .sort((a: any, b: any) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')));
    return NextResponse.json({ claims });
  } catch (e: any) {
    return NextResponse.json({ claims: [] });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  if (!tenantId || !orderId || !qrToken) return NextResponse.json({ error: 'Missing claim details' }, { status: 400 });

  const db = getAdminDb();
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);

  try {
    // ── APPEAL: reopen a declined claim, once, with the customer's note ──
    if (String(body.action || '') === 'appeal') {
      const claimId = String(body.claimId || '').trim();
      const note = String(body.note || '').trim().slice(0, 600);
      if (!claimId || !note) return NextResponse.json({ error: 'Tell the shop why the decision should be looked at again.' }, { status: 400 });

      const claimRef = db.collection(`tenants/${tenantId}/retailClaims`).doc(claimId);
      const [orderSnap, claimSnap] = await Promise.all([orderRef.get(), claimRef.get()]);
      if (!orderSnap.exists || !claimSnap.exists) return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });
      const order = orderSnap.data() as any;
      const claim = claimSnap.data() as any;
      if (order.qrToken !== qrToken || claim.orderId !== orderId) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
      if (claim.status !== 'declined') return NextResponse.json({ error: 'Only a declined claim can be appealed.' }, { status: 409 });
      if (claim.appealedAt) return NextResponse.json({ error: 'This claim has already been appealed once — the shop has it.' }, { status: 409 });

      const now = new Date().toISOString();
      const batch = db.batch();
      batch.update(claimRef, {
        status: 'in_review',
        appealNote: note,
        appealedAt: now,
        decidedAt: null, decidedBy: null, resolution: null,
        riskFactors: [...(Array.isArray(claim.riskFactors) ? claim.riskFactors : []), 'Appealed after decline'],
      });
      const evRef = orderRef.collection('events').doc();
      batch.set(evRef, {
        id: evRef.id, type: 'note', at: now,
        actorId: 'customer', actorName: order.customerName || 'Customer',
        meta: { text: `Claim appealed: ${claim.type}${claim.lineName ? ` — ${claim.lineName}` : ''}` },
      });
      await batch.commit();
      return NextResponse.json({ ok: true, message: 'Appeal received — a person will look at it again with your note and the packing record.' });
    }

    // ── OPEN a claim ──
    const type = String(body.type || '').trim() as (typeof CLAIM_TYPES)[number];
    const lineId = String(body.lineId || '').trim();
    const qty = Math.max(1, Math.floor(Number(body.qty) || 1));
    const description = String(body.description || '').trim().slice(0, 600);

    if (!CLAIM_TYPES.includes(type)) return NextResponse.json({ error: 'Missing claim details' }, { status: 400 });
    if (type !== 'not_received' && !lineId) return NextResponse.json({ error: 'Pick the affected item.' }, { status: 400 });

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

    // One open claim per order per line+type — a double tap must not file
    // the same grievance twice.
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
    // point, under the shop's ceiling, from a low-risk account.
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
