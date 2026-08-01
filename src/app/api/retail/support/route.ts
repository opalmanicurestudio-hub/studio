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
  });
  const evRef = orderRef.collection('events').doc();
  batch.set(evRef, {
    id: evRef.id, type: 'note', at: now,
    actorId: 'customer', actorName: order.customerName || 'Customer',
    meta: { text: `Support request: ${message.slice(0, 120)}` },
  });
  await batch.commit();

  return NextResponse.json({ ok: true });
}
