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
    return NextResponse.json({ error: 'This order already has several open requests. Thank you for your patience. We will get back to you as soon as possible.' }, { status: 429 });
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
      ? 'We are busier than usual, so please allow 1 to 2 days for a reply. Thank you for your patience.'
      : n >= 5
        ? 'We will reply within 1 day.'
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
    ready: 'Your order is ready for pickup.',
    arrived: 'We can see that you have arrived, and your order is on its way out to you.',
    shipped: 'Your order has shipped.',
    completed: 'Your order is complete.',
    cancelled: 'This order has been cancelled.',
  };
  // A delivery isn't picked up: where it is, in its own words.
  if (order.method === 'delivery') stageLine.ready = order.delivery?.status === 'out' ? 'Your order is out for delivery.' : order.delivery?.status === 'failed' ? 'We couldn’t deliver your order this time, and it’s back at the shop.' : 'Your order is packed and waiting to go out for delivery.';
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
      ? `A refund of $${(refunded / 100).toFixed(2)} has been issued on this order. Card refunds typically appear within 5 to 10 business days.`
      : pending > 0
        ? `A refund of $${(pending / 100).toFixed(2)} has been queued on this order and will be processed shortly. Card refunds typically appear within 5 to 10 business days after processing.`
        : `No refund is currently recorded on this order. ${stageLine[order.stage] || ''} Our team will review your message.`;
  } else if (/cancel/.test(lower)) {
    autoReply = ['placed', 'paid'].includes(order.stage)
      ? 'You can cancel this order yourself. Please open your order page and tap \u201cCancel this order\u201d. The items will be released right away, and any payment will be queued for a refund.'
      : `${stageLine[order.stage] || ''} As packing has already started, a member of our team will need to review your cancellation request. Your message has been added to our queue.`;
  } else if (/return|exchange/.test(lower)) {
    autoReply = ['shipped', 'completed'].includes(order.stage)
      ? 'You can start a return from your order page. Please tap \u201cStart a return\u201d, select the items and the reason, and then bring them to us or ship them back.'
      : 'Returns can be started once your order has been picked up or delivered. Your message has been added to our queue.';
  } else if (/where|status|when|ready|track|eta|how long/.test(lower)) {
    const trackBit = order.trackingNumber
      ? ` Tracking: ${order.carrier || ''} ${order.trackingNumber}${order.trackingUrl ? `. You can track it here: ${order.trackingUrl}` : ''}.`
      : '';
    autoReply = `${stageLine[order.stage] || 'Your order is in progress.'}${trackBit} Your order page always shows the latest status.`;
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
          subject: `We have received your message about order #${String(order.orderNumber).padStart(4, '0')}`,
          html: await (async () => {
            const emailBrand = await getEmailBrand(db, tenantId);
            return brandedEmail(emailBrand, `
              <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0 0 10px">Hi ${String(order.customerName || '').trim().split(' ')[0] || 'there'},</p>
              <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0">Thank you for contacting us. We have received your message${caseRef ? `, and it has been logged as <strong>Case #${caseRef}</strong>` : ''}. Your place in our queue has been saved, so there is no need to send it again.</p>
              ${urgent
                ? `<p style="font-size:14px;color:#0f172a;line-height:1.7;margin:12px 0 0">We are sorry for the trouble. Your message has been marked as a priority, and a member of our team is looking into it now. We will do our best to put this right.</p>`
                : autoReply ? `<div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;padding:14px;margin:16px 0 0"><p style="font-size:13px;color:#0f172a;margin:0;line-height:1.6"><strong>Instant answer:</strong> ${autoReply}</p></div>` : ''}
              <p style="font-size:12px;color:#64748b;margin:14px 0 0">${urgent ? 'You will hear from us shortly.' : expectNote} Our replies will appear on your order page and will also be sent to you by email.</p>
              ${emailButton(link, 'View my order', emailBrand)}
              <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:16px 0 0">Kind regards,<br>${emailBrand.shopName}</p>`,
              { preheader: urgent ? 'Your message has been marked as a priority.' : expectNote, title: 'We have received your message', tag: `#${String(order.orderNumber).padStart(4, '0')}` });
          })(),
        kind: 'support_received', recipientType: 'client', replyCase: ticketRef.id, orderId,
      });
    } catch {
      // acknowledgment email is best-effort
    }
  }

  return NextResponse.json({ ok: true, attached: false, caseId: ticketRef.id, caseRef, instantAnswer: urgent ? null : (autoReply || null), expectNote });
}
