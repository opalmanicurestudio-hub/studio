import { NextRequest, NextResponse } from 'next/server';

// ─── /api/retail/support-reply/route.ts ───────────────────────────────────────
// POST { tenantId, ticketId, reply, resolve? , staffName? }
//
// The staff side of automated customer service: one tap sends the reply to
// the customer BY EMAIL (Resend), threads it on the ticket, stamps the
// order's audit timeline, and optionally resolves in the same motion. The
// customer never needed an account or an inbox on our side — email is the
// channel they already have. Ticket ids are unguessable Firestore ids that
// only surface in the staff inbox.

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
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const ticketId = String(body.ticketId || '').trim();
  const reply = String(body.reply || '').trim().slice(0, 2000);
  const resolve = body.resolve === true;
  const staffName = String(body.staffName || 'The shop').slice(0, 80);

  if (!tenantId || !ticketId || !reply) {
    return NextResponse.json({ error: 'A reply is required' }, { status: 400 });
  }

  const db = getAdminDb();
  const ticketRef = db.collection(`tenants/${tenantId}/retailSupport`).doc(ticketId);
  const snap = await ticketRef.get();
  if (!snap.exists) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  const ticket = snap.data() as any;

  const now = new Date().toISOString();
  let emailed = false;

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM;
  if (RESEND_API_KEY && RESEND_FROM && ticket.customerEmail) {
    const origin = req.nextUrl.origin;
    const link = `${origin}/shop/${tenantId}/order/${ticket.orderId}`;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [ticket.customerEmail],
          subject: `Re: your order #${String(ticket.orderNumber).padStart(4, '0')}`,
          html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:8px">
            <p style="font-size:14px;color:#0f172a;white-space:pre-wrap">${reply.replace(/</g, '&lt;')}</p>
            <p style="font-size:12px;color:#64748b;margin-top:18px">\u2014 ${staffName}</p>
            <p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#111827;color:#ffffff;padding:12px 26px;border-radius:12px;text-decoration:none;font-weight:700;font-size:13px">View my order</a></p>
          </div>`,
        }),
      });
      emailed = res.ok;
    } catch {
      emailed = false;
    }
  }

  const batch = db.batch();
  batch.set(ticketRef, JSON.parse(JSON.stringify({
    replies: [...(ticket.replies || []), { by: staffName, text: reply, at: now, emailed }],
    ...(resolve ? { status: 'resolved', resolvedBy: staffName, resolvedAt: now } : {}),
  })), { merge: true });
  const evRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(ticket.orderId).collection('events').doc();
  batch.set(evRef, {
    id: evRef.id, type: 'note', at: now, actorId: 'staff', actorName: staffName,
    meta: { text: `Support reply${emailed ? ' (emailed)' : ''}: ${reply.slice(0, 120)}` },
  });
  await batch.commit();

  return NextResponse.json({
    ok: true,
    emailed,
    message: emailed
      ? 'Reply sent to the customer by email.'
      : ticket.customerEmail
        ? 'Reply saved — email could not be sent (check Resend settings).'
        : 'Reply saved — this order has no email on file.',
  });
}
