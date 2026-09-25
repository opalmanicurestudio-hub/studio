// src/app/api/stripe/billing-webhook/route.ts
//
// STRIPE → CLARITYFLOW, FOR SUBSCRIPTIONS (ClarityFlow's own account — the
// existing /api/stripe/webhook only handles businesses' connected accounts).
//
// Set up in Stripe → Developers → Webhooks → Add endpoint:
//   URL     https://<your live address>/api/stripe/billing-webhook
//   Listen  "Your account" (not connected accounts)
//   Events  checkout.session.completed, customer.subscription.created,
//           customer.subscription.updated, customer.subscription.deleted,
//           invoice.paid, invoice.payment_failed
//   Then copy its signing secret into Vercel as STRIPE_BILLING_WEBHOOK_SECRET.
//
// What it does:
//   • keeps each business's status in step: active/trialing → active;
//     past_due → past_due with a 7-day grace (the app already honours it);
//     canceled/unpaid → cancelled (the suspended page)
//   • records every paid invoice in platformBilling (→ HQ Finance income)
//   • a failed payment emails the owner (card fix link) and HQ

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { resolveFromAddress } from '@/lib/notify';
import { platformAdminEmails } from '@/lib/platform-admin';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';

const GRACE_DAYS = 7;

async function email(to: string, subject: string, text: string) {
  if (!process.env.RESEND_API_KEY || !to) return;
  try { await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: resolveFromAddress(), to, subject, text }) }); } catch { /* ignore */ }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  const sig = req.headers.get('stripe-signature');
  if (!secret || !sig) return NextResponse.json({ error: 'Missing signature or STRIPE_BILLING_WEBHOOK_SECRET' }, { status: 400 });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await req.text(), sig, secret); }
  catch (e: any) { return NextResponse.json({ error: `Webhook Error: ${e.message}` }, { status: 400 }); }
  if ((event as any).account) return NextResponse.json({ received: true });   // connected-account events belong to the other webhook

  const db = getAdminDb();
  const tenantByCustomer = async (customer: string) => {
    const s = await db.collection('tenants').where('billing.customerId', '==', customer).limit(1).get();
    return s.empty ? null : { id: s.docs[0].id, ref: s.docs[0].ref, data: s.docs[0].data() as any };
  };

  const applySubscription = async (sub: Stripe.Subscription) => {
    const tenantId = sub.metadata?.tenantId || (await tenantByCustomer(String(sub.customer)))?.id;
    if (!tenantId) return;
    const ref = db.doc(`tenants/${tenantId}`);
    const t = ((await ref.get()).data() as any) || {};
    const periodEnd = (sub as any).items?.data?.[0]?.current_period_end || (sub as any).current_period_end;
    const billing = { ...(t.billing || {}), customerId: String(sub.customer), subscriptionId: sub.id, status: sub.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null, cancelAtPeriodEnd: !!sub.cancel_at_period_end, updatedAt: new Date().toISOString() };
    const patch: any = { billing };
    // Paid up: lifts a BILLING lock only — an HQ "Pause access" (it has accessLockedAt) stays.
    if (sub.status === 'active' || sub.status === 'trialing') Object.assign(patch, { subscriptionStatus: 'active', subscriptionTier: 'subscribed', gracePeriodEndsAt: null, accessLocked: t.accessLockedAt ? t.accessLocked : false, activatedAt: t.activatedAt || new Date().toISOString() });
    else if (sub.status === 'past_due') Object.assign(patch, { subscriptionStatus: 'past_due', gracePeriodEndsAt: t.gracePeriodEndsAt || new Date(Date.now() + GRACE_DAYS * 86400000).toISOString() });
    else if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) Object.assign(patch, { subscriptionStatus: 'cancelled' });
    await ref.set(patch, { merge: true });
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode === 'subscription' && s.subscription) await applySubscription(await stripe.subscriptions.retrieve(String(s.subscription)));
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice;
        const t = await tenantByCustomer(String(inv.customer));
        const paidAt = new Date(((inv.status_transitions?.paid_at as number) || Math.floor(Date.now() / 1000)) * 1000);
        await db.doc(`platformBilling/${inv.id}`).set({ id: inv.id, tenantId: t?.id || null, tenantName: t?.data?.name || null, amountPaidCents: inv.amount_paid, currency: inv.currency,
          month: `${paidAt.getUTCFullYear()}-${String(paidAt.getUTCMonth() + 1).padStart(2, '0')}`, paidAt: paidAt.toISOString(), number: inv.number || null, hostedUrl: inv.hosted_invoice_url || null });
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const t = await tenantByCustomer(String(inv.customer));
        if (!t) break;
        let owner = ''; try { owner = t.data.userId ? String((await getAdminAuth().getUser(t.data.userId)).email || '') : ''; } catch { /* none */ }
        const base = linkOrigin(t.data, req.nextUrl.origin);
        await email(owner, 'Your ClarityFlow payment didn’t go through', `Hi,\n\nWe couldn’t take this month’s ClarityFlow payment for ${t.data.name || 'your business'}. Nothing changes for ${GRACE_DAYS} days — please update your card here:\n\n${base}/subscriptions\n\nIf you need a hand, just reply.\n\n— ClarityFlow`);
        await email(process.env.LEADS_NOTIFY_EMAIL || platformAdminEmails()[0] || '', `Payment failed · ${t.data.name || t.id}`, `A subscription payment failed for ${t.data.name || t.id} ($${((inv.amount_due || 0) / 100).toFixed(2)}). HQ: ${base}/admin/tenants/${t.id}`);
        break;
      }
    }
  } catch (e: any) {
    console.error('[billing-webhook]', event.type, e?.message);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });   // Stripe will retry
  }
  return NextResponse.json({ received: true });
}
