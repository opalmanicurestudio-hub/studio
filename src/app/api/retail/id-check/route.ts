// src/app/api/retail/id-check/route.ts — ASK A CUSTOMER TO CONFIRM WHO THEY ARE. For an order held for review, a
// manager can send the customer a secure Stripe link to photograph their ID and take a selfie. The result comes back on
// the payment webhook and shows on the order; releasing it is still the manager's call. Staff only, managers only.
// POST { tenantId, orderId }
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { brandedEmailHtml } from '@/lib/email-template';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!tenantId || !orderId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager) return NextResponse.json({ error: 'Only a manager can ask for an ID check.' }, { status: 403 });
  const db = getAdminDb();
  const [tSnap, oSnap] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get()]);
  if (!oSnap.exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  const tenant: any = tSnap.data() || {}; const o: any = oSnap.data() || {};
  if (!o.holdForReview) return NextResponse.json({ error: 'Only held orders need an ID check.' }, { status: 409 });
  if (!o.customerEmail) return NextResponse.json({ error: 'This order has no email address to send the link to.' }, { status: 409 });
  const acct = String(tenant.stripeAccountId || ''); if (!acct || !process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'Payments aren’t connected.' }, { status: 400 });
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any });
  let url = ''; let sessionId = '';
  try {
    const vs: any = await (stripe as any).identity.verificationSessions.create({
      type: 'document', options: { document: { require_matching_selfie: true } },
      metadata: { tenantId, retailOrderId: orderId }, return_url: `${origin}/shop/${tenantId}/order/${orderId}`,
    }, { stripeAccount: acct });
    url = String(vs.url || ''); sessionId = String(vs.id || '');
  } catch (e: any) {
    const msg = String(e?.raw?.message || e?.message || '');
    return NextResponse.json({ error: /identity/i.test(msg) ? 'ID checks aren’t turned on for your Stripe account yet. Turn on Identity in your Stripe dashboard, then try again.' : `Stripe: ${msg || 'couldn’t start the check.'}` }, { status: 502 });
  }
  const shop = String(tenant.businessName || tenant.name || 'The shop'); const first = String(o.customerName || '').split(' ')[0] || 'there';
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  try {
    const { sendNotification } = await import('@/lib/notify');
    await sendNotification(db, { tenantId, channel: 'email', to: o.customerEmail, subject: `${shop}: one quick step before we send order ${num}`, kind: 'order_id_check', recipientType: 'client',
      html: brandedEmailHtml({ studioName: shop, title: 'One quick step before we send your order', bodyLines: [`Hi ${first},`, `Thank you for your order ${num}. Before we send it, we need to confirm it was you who placed it. It takes about two minutes: a photo of your ID and a quick selfie, handled securely by Stripe. We never see or keep the photos.`, 'If you didn’t place this order, you don’t need to do anything; reply to this email and we will cancel and refund it.', `Kind regards, ${shop}`], cta: { label: 'Confirm it’s me', url }, footerNote: `You are receiving this because order ${num} was placed with ${shop} using this email address.` }) } as any);
  } catch { /* the link is still on the order for staff to share */ }
  const at = new Date().toISOString();
  await oSnap.ref.set({ idCheck: { status: 'sent', at, sessionId, url, by: auth.actor.name } }, { merge: true });
  const ev = oSnap.ref.collection('events').doc();
  await ev.set({ id: ev.id, type: 'note', at, actorId: auth.actor.uid, actorName: auth.actor.name, meta: { kind: 'id_check_sent', text: 'Asked the customer to confirm their identity' } });
  return NextResponse.json({ ok: true, message: `Sent ${first} a link to confirm it’s them. You’ll see the result here.` });
}
