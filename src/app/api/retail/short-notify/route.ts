import { verifyStaffActor } from '@/lib/staff-auth';
import { taxShareCents } from '@/lib/restocking';
import { NextRequest, NextResponse } from 'next/server';

import { brandedEmailHtml } from '@/lib/email-template';
import { effectiveUnitCents } from '@/lib/retail-swap';

// ─── /api/retail/short-notify ─────────────────────────────────────────────────
// POST { tenantId, orderId, lineId }
//
// Closes the last customer-facing hole in fulfilment. When a picker shorts a
// line the refund queues and the order page updates — but nobody tells the
// customer, so someone who ordered three things gets two and finds out at the
// door. This route is the email that should have gone out.
//
// It is deliberately NOT a mail relay. It accepts no recipient, no subject and
// no body from the caller. It re-reads the order with the Admin SDK, proves the
// named line really is shorted, and writes to exactly one address: the one
// already on the order. The worst a forged call can do is send a truthful
// apology to the customer who is genuinely owed it — and it can only do that
// once, because of the marker below.
//
// IDEMPOTENCY is a deterministic event doc id, `short-notify-{lineId}`, not a
// query. A single .get() on a known id costs one read, needs no composite
// index, and cannot miss the marker on a chatty order the way a limited query
// can. This matters because resolveShortLine fires from a Firestore
// transaction that the SDK may retry — without the marker a contended short
// apologises three times.
//
// The event is written as type 'note' so it lands in the existing timeline
// renderer without widening ORDER_EVENT_TYPES; meta.kind carries the real
// meaning for anything that wants to filter on it later.
//
// FAILS SOFT EVERYWHERE. A missing RESEND key, a Resend outage, or a customer
// with no email on file each return ok:false with a reason and HTTP 200. None
// of them throw, because the short has already committed to the database and
// must never be undone — or made to look failed to the picker — by a mail
// problem.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-short-notify';
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

const SHORT_STATUSES = ['shorted', 'backordered', 'refunded'];

const money = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

function originFrom(req: NextRequest): string {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : '';
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400 });
  }

  const tenantId = String(body?.tenantId || '').trim();
  const orderId = String(body?.orderId || '').trim();
  const lineId = String(body?.lineId || '').trim();
  if (!tenantId || !orderId || !lineId) {
    return NextResponse.json({ ok: false, reason: 'missing_ids' }, { status: 400 });
  }
  // Only the team, or the shop's own server, can ask for this email.
  const internal = !!process.env.CRON_SECRET && req.headers.get('x-internal-key') === process.env.CRON_SECRET;
  if (!internal) { const auth = await verifyStaffActor(req, tenantId); if (!auth.ok) return NextResponse.json({ ok: false, reason: 'not_allowed' }, { status: auth.status }); }

  const db = getAdminDb();
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const markerRef = orderRef.collection('events').doc(`short-notify-${lineId}`);

  let order: any;
  let tenant: any = {};
  let alreadySent = false;
  try {
    const [oSnap, tSnap, mSnap] = await Promise.all([
      orderRef.get(),
      db.collection('tenants').doc(tenantId).get(),
      markerRef.get(),
    ]);
    if (!oSnap.exists) return NextResponse.json({ ok: false, reason: 'order_not_found' }, { status: 404 });
    order = oSnap.data() || {};
    if (tSnap.exists) tenant = tSnap.data() || {};
    alreadySent = !!mSnap.exists;
  } catch {
    return NextResponse.json({ ok: false, reason: 'read_failed', retry: true }, { status: 503 });
  }

  // Already told them once. Silence beats a duplicate apology.
  if (alreadySent) return NextResponse.json({ ok: true, skipped: 'already_notified' });

  const line = (order.lines || []).find((l: any) => String(l?.lineId) === lineId);
  if (!line) return NextResponse.json({ ok: false, reason: 'line_not_found' }, { status: 404 });

  const qtyShorted = Number(line.qtyShorted) || 0;
  if (qtyShorted < 1 || !SHORT_STATUSES.includes(String(line.status))) {
    return NextResponse.json({ ok: false, reason: 'line_not_shorted' }, { status: 200 });
  }

  const to = String(order.customerEmail || '').trim();
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
  if (!to) return NextResponse.json({ ok: false, reason: 'no_customer_email' }, { status: 200 });
  if (!RESEND_API_KEY || !RESEND_FROM) {
    return NextResponse.json({ ok: false, reason: 'email_not_configured' }, { status: 200 });
  }

  const shopName = String(tenant.businessName || tenant.name || 'Our team');
  const num = `#${String(order.orderNumber ?? '').padStart(4, '0')}`;
  const first = String(order.customerName || '').split(' ')[0];
  const backordered = String(line.status) === 'backordered';
  const itemName = String(line.name || 'One item')
    + (line.optionsLabel ? ` (${String(line.optionsLabel)})` : '');
  const itemCents = effectiveUnitCents(line) * qtyShorted;   // what was actually paid, after any promo code
  const refundCents = itemCents + taxShareCents(order, itemCents);   // the tax paid on it comes back too
  const moneySent = (Number(order.refundedCents) || 0) >= refundCents && !(Number(order.pendingRefundCents) || 0);
  const remaining = (order.lines || [])
    .filter((l: any) => String(l?.lineId) !== lineId && (Number(l?.qtyShorted) || 0) === 0).length;

  const contact = [tenant.phone, tenant.email].filter(Boolean).map(String).join(' · ');
  const origin = originFrom(req);
  const orderUrl = origin ? `${origin}/shop/${tenantId}/order/${orderId}` : '';

  const bodyLines: string[] = [
    `Hi ${first || 'there'},`,
    `Thank you for your order. Unfortunately, we were unable to include everything in order ${num}.`,
    `${qtyShorted} × ${itemName} could not be included because we had fewer in stock than our records showed.`,
  ];

  if (backordered) {
    bodyLines.push(
      'We are holding this item for you. As soon as it is back in stock, we will ship it separately at no additional shipping cost and email you the tracking details.',
      `If you would prefer not to wait, please open your order and send us a message, and we will refund ${money(refundCents)} the same day.`,
    );
  } else {
    bodyLines.push(
      moneySent
        ? `We have refunded ${money(refundCents)} to the card you paid with. Most banks show it within 5 to 10 business days.`
        : `We are refunding ${money(refundCents)} to the card you paid with. Once it is sent, most banks show it within 5 to 10 business days.`,
      'If you would prefer that we send the item when it is back in stock instead, please open your order and let us know, and we can arrange that in place of the refund.',
    );
  }

  if (remaining > 0) {
    bodyLines.push('The rest of your order is unaffected and is on its way as planned.');
  }
  bodyLines.push('We apologize for the inconvenience. This was an error in our stock count, not an issue with your order.');
  bodyLines.push(`Kind regards, ${shopName}`);

  const html = brandedEmailHtml({
    studioName: shopName,
    title: backordered ? 'One item will arrive separately' : 'An update on your order',
    bodyLines,
    cta: orderUrl ? { label: 'View my order', url: orderUrl } : null,
    footerNote: contact
      ? `If you have any questions, please contact us: ${contact}`
      : `You are receiving this because you placed order ${num} with ${shopName}.`,
  });

  let sent = false; let failedFinal = false;
  try {
    const { sendNotification } = await import('@/lib/notify');
    const res = await sendNotification(db, {
      tenantId, channel: 'email',
        to,
        subject: backordered
          ? `Order ${num}: one item will arrive separately`
          : `Order ${num}: an update on your order`,
        html,
      kind: 'order_short', recipientType: 'client', orderId,
    });
    sent = res.ok; failedFinal = !res.ok && res.status !== 'failed';
    if (!res.ok) {
      console.error('[short-notify] not sent:', res.status, res.error);
    }
  } catch (e: any) {
    console.error('[short-notify] send failed:', e?.message || e);
  }

  // Only mark it sent if it actually went. A failed send stays retryable: the queue that sent it tries later
  // (lib/order-outbox). One the shop switched off, or a missing email service, isn't tried again.
  if (!sent) return failedFinal ? NextResponse.json({ ok: true, sent: false, reason: 'not_sent_by_policy' }) : NextResponse.json({ ok: false, reason: 'send_failed', retry: true }, { status: 503 });

  try {
    await markerRef.set({
      id: `short-notify-${lineId}`,
      type: 'note',
      at: new Date().toISOString(),
      actorId: 'system',
      actorName: 'Automatic',
      meta: {
        kind: 'short_notified',
        lineId,
        qtyShorted,
        resolution: backordered ? 'backorder' : 'refund',
        to,
        text: `Emailed the customer about ${qtyShorted}× ${String(line.name || 'item')}`,
      },
    });
  } catch {
    // The email is out; a missing timeline row is cosmetic.
  }

  return NextResponse.json({ ok: true, sent: true });
}
