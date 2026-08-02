import { NextRequest, NextResponse } from 'next/server';

// ─── /api/retail/support/route.ts ─────────────────────────────────────────────
// POST { tenantId, orderId, qrToken, message }
//
// The customer's "Need help with this order?" form. qrToken is
// proof-of-possession (only the order's tracking page has it), so support
// requests are always tied to a real order — no anonymous spam surface.
// Creates a ticket in tenants/{tid}/retailSupport and stamps the order's
// audit timeline. Caps: 1000-char message, 5 open tickets per order.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-support';
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

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  const message = String(body.message || '').trim().slice(0, 1000);

  if (!tenantId || !orderId || !qrToken || !message) {
    return NextResponse.json({ error: 'A message is required' }, { status: 400 });
  }

  const db = getAdminDb();
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const order = orderSnap.data() as any;
  if (order.qrToken !== qrToken) {
    return NextResponse.json({ error: 'Not authorized for this order' }, { status: 403 });
  }

  const openCount = await db.collection(`tenants/${tenantId}/retailSupport`)
    .where('orderId', '==', orderId).where('status', '==', 'open').count().get();
  if ((openCount.data().count ?? 0) >= 5) {
    return NextResponse.json({ error: 'This order already has open requests — we will get back to you soon.' }, { status: 429 });
  }

  const lower = message.toLowerCase();
  const stageLine: Record<string, string> = {
    placed: 'Your order is awaiting payment confirmation.',
    paid: 'Your order is confirmed and in the packing queue.',
    picking: 'Your order is being packed right now.',
    packed: 'Your order is packed and being finalized.',
    ready: 'Your order is READY for pickup.',
    arrived: 'We see you here \u2014 your order is on its way out.',
    shipped: 'Your order has shipped.',
    handed_off: 'Your order was picked up.',
    completed: 'Your order is complete.',
    cancelled: 'This order is cancelled.',
    refunded: 'This order was refunded.',
  };
  let autoReply = '';
  if (/refund|money back|charge/.test(lower)) {
    const refunded = order.refundedCents || 0;
    const pending = order.pendingRefundCents || 0;
    autoReply = refunded > 0
      ? `A refund of $${(refunded / 100).toFixed(2)} has been issued on this order. Card refunds typically appear in 5\u201310 business days.`
      : pending > 0
        ? `A refund of $${(pending / 100).toFixed(2)} is queued on this order and the shop will process it shortly. Card refunds typically appear in 5\u201310 business days after processing.`
        : `No refund is currently recorded on this order. ${stageLine[order.stage] || ''} The shop will review your message.`;
  } else if (/cancel/.test(lower)) {
    autoReply = ['placed', 'paid'].includes(order.stage)
      ? 'You can cancel this order yourself \u2014 open your order page and tap \u201cCancel this order\u201d. Stock is released immediately and any payment is queued for refund.'
      : `${stageLine[order.stage] || ''} Since packing has started, cancellation needs a human \u2014 your message is in the shop\u2019s queue now.`;
  } else if (/return|exchange/.test(lower)) {
    autoReply = ['shipped', 'handed_off', 'completed'].includes(order.stage)
      ? 'You can start a return right from your order page \u2014 tap \u201cStart a return\u201d, pick the items and reason, and bring them by (or ship them back).'
      : 'Returns open once your order has been picked up or delivered. Your message is in the shop\u2019s queue.';
  } else if (/where|status|when|ready|track|eta|how long/.test(lower)) {
    const trackBit = order.trackingNumber
      ? ` Tracking: ${order.carrier || ''} ${order.trackingNumber}${order.trackingUrl ? ` \u2014 ${order.trackingUrl}` : ''}.`
      : '';
    autoReply = `${stageLine[order.stage] || 'Your order is in progress.'}${trackBit} Your order page always shows the live status.`;
  }

  // ── Sentiment triage: angry customers get MORE human, faster ──
  const angryWords = /furious|angry|unacceptable|ridiculous|scam|fraud|lawyer|dispute|chargeback|worst|terrible|awful|never again|joke|pissed|disgust/;
  let urgent = angryWords.test(lower) || (message === message.toUpperCase() && message.length > 20);
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!urgent && ANTHROPIC_API_KEY) {
    try {
      const clsRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 5,
          messages: [{ role: 'user', content: `Classify this customer message as ANGRY or CALM. Reply with one word only.\n\n"${message.slice(0, 500)}"` }],
        }),
      });
      const cls = await clsRes.json();
      const word = String(cls?.content?.[0]?.text || '').trim().toUpperCase();
      if (word.startsWith('ANGRY')) urgent = true;
    } catch {
      // classification is best-effort
    }
  }

  const now = new Date().toISOString();
  const ticketRef = db.collection(`tenants/${tenantId}/retailSupport`).doc();
  const batch = db.batch();
  batch.set(ticketRef, {
    id: ticketRef.id, tenantId,
    orderId, orderNumber: order.orderNumber,
    customerName: order.customerName || 'Guest',
    customerEmail: order.customerEmail || '',
    customerPhone: order.customerPhone || '',
    stageAtRequest: order.stage,
    message, status: 'open', createdAt: now,
    priority: urgent ? 'urgent' : 'normal',
    autoReply: urgent ? '' : autoReply,
    replies: [],
  });
  const evRef = orderRef.collection('events').doc();
  batch.set(evRef, {
    id: evRef.id, type: 'note', at: now,
    actorId: 'customer', actorName: order.customerName || 'Customer',
    meta: { text: `Support request: ${message.slice(0, 120)}` },
  });
  await batch.commit();

  // Acknowledgment email (+ instant answer when calm and we have one). Best-effort.
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM;
  if (RESEND_API_KEY && RESEND_FROM && order.customerEmail) {
    const origin = req.nextUrl.origin;
    const link = `${origin}/shop/${tenantId}/order/${orderId}`;
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [order.customerEmail],
          subject: `We got your message \u2014 order #${String(order.orderNumber).padStart(4, '0')}`,
          html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:8px">
            <p style="font-size:15px;color:#0f172a">Thanks \u2014 your message about order <strong>#${String(order.orderNumber).padStart(4, '0')}</strong> is with the team.</p>
            ${urgent
              ? `<p style="font-size:13px;color:#0f172a">We hear you \u2014 this has been flagged and a person is looking at it as a priority. We\u2019ll make it right.</p>`
              : autoReply ? `<div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;padding:14px;margin:16px 0"><p style="font-size:13px;color:#0f172a;margin:0"><strong>Instant answer:</strong> ${autoReply}</p></div>` : ''}
            <p style="font-size:13px;color:#64748b">${urgent ? 'You\u2019ll hear from us shortly. Live status any time:' : 'A human will follow up if anything else is needed. Live status any time:'}</p>
            <p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#111827;color:#ffffff;padding:12px 26px;border-radius:12px;text-decoration:none;font-weight:700;font-size:13px">View my order</a></p>
          </div>`,
        }),
      });
    } catch {
      // acknowledgment email is best-effort
    }
  }

  return NextResponse.json({ ok: true, instantAnswer: urgent ? null : (autoReply || null) });
}
