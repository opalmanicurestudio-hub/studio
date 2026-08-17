import { NextRequest, NextResponse } from 'next/server';

import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';

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
  /* FIRST NAME ONLY, enforced here — not left to whoever typed the reply.
   * This email reaches a stranger's inbox; the staffer's surname doesn't
   * belong there, and no client-side mistake can leak it past this line. */
  const staffName = (String(body.staffName || 'The shop').trim().split(/\s+/)[0] || 'The shop').slice(0, 40);

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
      /* The reply wears the shop's clothes: same branded shell as receipts
       * and credit emails — logo band, brand color, real button — with a
       * proper signature block instead of a bare em dash. The customer's
       * original message is quoted underneath so the email stands alone in
       * an inbox without the thread. */
      const emailBrand = await getEmailBrand(db, tenantId);
      const first = String(ticket.customerName || '').trim().split(/\s+/)[0];
      const num = `#${String(ticket.orderNumber).padStart(4, '0')}`;
      const html = brandedEmail(emailBrand, `
        ${first ? `<p style="font-size:14px;color:#0f172a;font-weight:700;margin:0 0 10px">Hi ${first},</p>` : ''}
        <p style="font-size:14px;color:#0f172a;line-height:1.7;white-space:pre-wrap;margin:0">${reply.replace(/</g, '&lt;')}</p>
        <table style="border-collapse:collapse;margin:20px 0 0">
          <tr>
            <td style="border-left:3px solid ${emailBrand.brandColor};padding:2px 0 2px 12px">
              <p style="font-size:13px;font-weight:800;color:#0f172a;margin:0">${staffName}</p>
              <p style="font-size:11px;color:#64748b;margin:2px 0 0">${emailBrand.shopName} \u00b7 order ${num}</p>
            </td>
          </tr>
        </table>
        ${emailButton(link, 'View my order', emailBrand)}
        <p style="font-size:11px;color:#94a3b8;margin:18px 0 0;border-top:1px solid #e2e8f0;padding-top:10px;line-height:1.6">You wrote: \u201c${String(ticket.message || '').slice(0, 240).replace(/</g, '&lt;')}${String(ticket.message || '').length > 240 ? '\u2026' : ''}\u201d</p>`,
        { preheader: `${staffName} at ${emailBrand.shopName} replied about order ${num}` });

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [ticket.customerEmail],
          subject: `${emailBrand.shopName} \u2014 about your order ${num}`,
          html,
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
    customerMessagesSinceStaffReply: 0,
    lastStaffReplyAt: now,
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
