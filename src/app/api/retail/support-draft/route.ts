import { NextRequest, NextResponse } from 'next/server';

// ─── /api/retail/support-draft/route.ts ───────────────────────────────────────
// POST { tenantId, ticketId } → { draft }
//
// Claude pre-writes a reply from the ticket + LIVE order facts (stage,
// refunds, tracking) so the draft can't promise things the data doesn't
// support. The draft lands in the staff reply box — it is NEVER auto-sent;
// a human reads, edits, and taps send. Urgent tickets get de-escalation
// instructions. Uses Haiku (~a third of a cent per draft); set
// ANTHROPIC_API_KEY in the environment, optional ANTHROPIC_DRAFT_MODEL to
// override the model.

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
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI drafts need ANTHROPIC_API_KEY in the environment.' }, { status: 400 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const tenantId = String(body.tenantId || '').trim();
  const ticketId = String(body.ticketId || '').trim();
  if (!tenantId || !ticketId) return NextResponse.json({ error: 'Missing ticket' }, { status: 400 });

  const db = getAdminDb();
  const ticketSnap = await db.collection(`tenants/${tenantId}/retailSupport`).doc(ticketId).get();
  if (!ticketSnap.exists) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  const ticket = ticketSnap.data() as any;

  const orderSnap = await db.collection(`tenants/${tenantId}/retailOrders`).doc(ticket.orderId).get();
  const order = orderSnap.exists ? (orderSnap.data() as any) : {};
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  const shopName = tenantSnap.exists
    ? ((tenantSnap.data() as any).businessName || (tenantSnap.data() as any).name || 'the shop')
    : 'the shop';

  const facts = [
    `Order #${String(ticket.orderNumber).padStart(4, '0')} for ${ticket.customerName}`,
    `Current stage: ${order.stage || 'unknown'}`,
    `Fulfillment method: ${order.method || 'unknown'}`,
    `Total: $${((order.totalCents || 0) / 100).toFixed(2)}`,
    (order.refundedCents || 0) > 0 ? `Refunded so far: $${(order.refundedCents / 100).toFixed(2)}` : '',
    (order.pendingRefundCents || 0) > 0 ? `Refund QUEUED (not yet processed): $${(order.pendingRefundCents / 100).toFixed(2)}` : '',
    order.trackingNumber ? `Tracking: ${order.carrier || ''} ${order.trackingNumber}` : '',
    Array.isArray(order.lines) ? `Items: ${order.lines.map((l: any) => `${l.qtyOrdered}x ${l.name}${l.qtyShorted ? ` (${l.qtyShorted} shorted/refunded)` : ''}`).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const urgent = ticket.priority === 'urgent';
  const system = `You draft short customer-service email replies for ${shopName}, a small local shop. Rules:
- Use ONLY the order facts provided. NEVER invent refunds, dates, discounts, or policies not in the facts.
- Warm, human, concise (3-6 sentences). First name only. No subject line, no signature block.
- If a refund is queued, say it will be processed shortly and typically reaches cards in 5-10 business days.
${urgent ? '- The customer is upset. Lead by acknowledging their specific frustration sincerely, no corporate speak, no exclamation marks, offer a concrete next step, and do not quote policy at them.' : '- Match the customer\u2019s energy and answer their actual question.'}
- If the message asks for something the facts cannot answer, say the team is checking and will follow up \u2014 do not guess.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_DRAFT_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system,
        messages: [{
          role: 'user',
          content: `ORDER FACTS:\n${facts}\n\nCUSTOMER MESSAGE:\n"${String(ticket.message || '').slice(0, 1000)}"\n\nDraft the reply body only.`,
        }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: String(data?.error?.message || 'Anthropic API error').slice(0, 200) }, { status: 502 });
    }
    const draft = (data.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')
      .trim();
    if (!draft) return NextResponse.json({ error: 'Empty draft returned' }, { status: 502 });
    return NextResponse.json({ draft });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || 'Draft failed').slice(0, 200) }, { status: 502 });
  }
}
