import { NextRequest, NextResponse } from 'next/server';

import { brandedEmail, emailButton, getEmailBrand } from '@/lib/email-shell';

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
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  (getAdminDb as any).FieldValue = FieldValue;
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

/** Issue-category classification — the case key's second half. Deliberately
 *  coarse: these buckets exist to stop one problem becoming five tickets,
 *  not to be a taxonomy. */
function categoryOf(lower: string): string {
  if (/missing|not in the box|short(ed)?|didn.t (get|receive)|only received/.test(lower)) return 'missing';
  if (/damag|leak|broke|crack|shatter|spill/.test(lower)) return 'damaged';
  if (/wrong|different (item|product|color|shade)|incorrect item|not what i/.test(lower)) return 'wrong_item';
  if (/deliver|arrive|track|lost|where|status|when|eta|how long/.test(lower)) return 'delivery';
  if (/return|refund|money back|exchange/.test(lower)) return 'return_refund';
  if (/cancel/.test(lower)) return 'cancel';
  return 'other';
}

/** Chaser vs evidence. A chaser is short, photo-less, and asks rather than
 *  tells — "any update??" — and its arrival should never re-alert staff. */
function isChaser(message: string, photoCount: number): boolean {
  if (photoCount > 0) return false;
  const t = message.trim();
  if (t.length < 25) return true;
  return t.length < 90 && /update|status|hello|hey\b|any(one|body)|still (there|waiting)|\?{2,}|when will|how long/i.test(t.toLowerCase());
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

  /* THE HONEST CLOCK. Reply-time expectations are computed from the queue
   * that actually exists — the tenant-wide open ticket count — at the moment
   * this message lands, then stamped on the ticket so every surface (ack
   * email, the customer's thread, the staff inbox) quotes the same promise.
   * Tiers are deliberately loose ranges: a precise minute would be a lie. */
  let expectNote = 'We usually reply within a few hours.';
  try {
    const tenantOpen = await db.collection(`tenants/${tenantId}/retailSupport`)
      .where('status', '==', 'open').count().get();
    const n = tenantOpen.data().count ?? 0;
    expectNote = n >= 15
      ? 'We\u2019re busier than usual — expect a reply within 1\u20132 days.'
      : n >= 5
        ? 'Expect a reply within a day.'
        : 'We usually reply within a few hours.';
  } catch { /* the default tier stands */ }

  /* Photos: URLs minted by our own upload route (customer sends bytes there,
   * the server chooses the path) — capped and length-checked here so the
   * ticket can never carry an arbitrary payload. */
  const photoUrls: string[] = (Array.isArray(body.photoUrls) ? body.photoUrls : [])
    .map((u: any) => String(u || '').trim())
    .filter((u: string) => u.startsWith('https://') && u.length < 500)
    .slice(0, 4);

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
  /* ═══ ONE ISSUE = ONE CASE ═════════════════════════════════════════════
   * Before creating anything, look for an open case on this order. A new
   * message matching an open case's category (or any open case, when the
   * message is uncategorizable) APPENDS to that case's timeline instead of
   * becoming a sibling ticket: no second ack email, no new inbox row, no
   * reset of their place in the queue. Chasers bump a counter staff see as
   * one consolidated chip; evidence (photos, substantive text) rides in
   * marked as such. A message that clearly names a DIFFERENT problem still
   * opens its own case — one order can honestly have two issues. */
  /* Policy gate for the ACK EMAIL only. The ticket itself is always created —
   * switching off "message received" means the shop does not want to send an
   * auto-acknowledgement, not that it wants to lose the customer's message. */
  let ackAllowed = true;
  try {
    const { gateMessage } = await import('@/lib/message-policy');
    ackAllowed = (await gateMessage(db, tenantId, 'support_ack')).send;
  } catch { /* fail open */ }

  const newCat = categoryOf(lower);
  const caseSnap = await db.collection(`tenants/${tenantId}/retailSupport`)
    .where('orderId', '==', orderId).get();
  const allCases = caseSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const openCases = allCases.filter((c: any) => c.status === 'open');
  const target = openCases.find((c: any) => (c.category || 'other') === newCat)
    || (newCat === 'other' && openCases.length > 0 ? openCases[0] : null)
    || (openCases.length === 1 && !openCases[0].category ? openCases[0] : null);

  if (target) {
    const FieldValue = (getAdminDb as any).FieldValue;
    const kind = isChaser(message, photoUrls.length) ? 'chaser' : 'evidence';
    const angry = /furious|angry|unacceptable|ridiculous|scam|fraud|lawyer|dispute|chargeback/.test(lower);
    const update: any = {
      followUps: FieldValue.arrayUnion({ at: new Date().toISOString(), message, photoUrls, kind }),
      customerMessagesSinceStaffReply: FieldValue.increment(1),
      expectNote,
    };
    if (angry && target.priority !== 'urgent') update.priority = 'urgent';
    if (photoUrls.length > 0) {
      update.photoUrls = [...(Array.isArray(target.photoUrls) ? target.photoUrls : []), ...photoUrls].slice(0, 12);
    }
    await db.collection(`tenants/${tenantId}/retailSupport`).doc(target.id).update(update);
    return NextResponse.json({
      ok: true, attached: true, caseId: target.id,
      caseRef: target.caseRef || null, kind, expectNote,
      status: target.status,
      replies: Array.isArray(target.replies) ? target.replies.length : 0,
    });
  }
  const caseRef = `${order.orderNumber}-${allCases.length + 1}`;

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
    category: newCat, caseRef,
    followUps: [],
    customerMessagesSinceStaffReply: 0,
    priority: urgent ? 'urgent' : 'normal',
    autoReply: urgent ? '' : autoReply,
    expectNote,
    photoUrls,
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
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
  if (ackAllowed && RESEND_API_KEY && RESEND_FROM && order.customerEmail) {
    const origin = req.nextUrl.origin;
    const link = `${origin}/shop/${tenantId}/order/${orderId}`;
    try {
      const { sendNotification } = await import('@/lib/notify');
      await sendNotification(db, {
        tenantId, channel: 'email',
          to: order.customerEmail,
          subject: `We got your message \u2014 order #${String(order.orderNumber).padStart(4, '0')}`,
          html: await (async () => {
            const emailBrand = await getEmailBrand(db, tenantId);
            return brandedEmail(emailBrand, `
              <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0">Thanks \u2014 your message is with the team${caseRef ? ` as <strong>Case #${caseRef}</strong>` : ''}. Your place in the queue is saved; no need to resend it.</p>
              ${urgent
                ? `<p style="font-size:14px;color:#0f172a;line-height:1.7;margin:12px 0 0">We hear you \u2014 this has been flagged and a person is looking at it as a priority. We\u2019ll make it right.</p>`
                : autoReply ? `<div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;padding:14px;margin:16px 0 0"><p style="font-size:13px;color:#0f172a;margin:0;line-height:1.6"><strong>Instant answer:</strong> ${autoReply}</p></div>` : ''}
              <p style="font-size:12px;color:#64748b;margin:14px 0 0">${urgent ? 'You\u2019ll hear from us shortly.' : expectNote} Replies land on your order page and by email.</p>
              ${emailButton(link, 'View my order', emailBrand)}`,
              { preheader: urgent ? 'Flagged as a priority \u2014 a person is on it' : expectNote, title: 'We got your message', tag: `#${String(order.orderNumber).padStart(4, '0')}` });
          })(),
        kind: 'support_received', recipientType: 'client',
      });
    } catch {
      // acknowledgment email is best-effort
    }
  }

  return NextResponse.json({ ok: true, attached: false, caseId: ticketRef.id, caseRef, instantAnswer: urgent ? null : (autoReply || null), expectNote });
}
