import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── /api/stripe/webhook/route.ts ─────────────────────────────────────────────
// YOUR ACCOUNT webhook — platform-level events.
// Stripe Dashboard: Developers → Webhooks → "Your account" endpoint
// Secret env var: STRIPE_WEBHOOK_SECRET
//
// Events handled:
//   account.updated                    → sync connected account onboarding status
//   customer.subscription.created     → activate tenant
//   customer.subscription.updated     → sync plan changes
//   customer.subscription.deleted     → deactivate tenant
//   customer.subscription.trial_ending → send trial expiry warning
//   invoice.payment_succeeded          → clear past_due, restore access
//   invoice.payment_failed             → set past_due + grace period
//   invoice.finalized                  → store invoice record

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore }                 = require('firebase-admin/firestore');
  const APP_NAME = 'admin-platform-webhook';
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

// Grace period in days before access is locked after payment failure
const GRACE_PERIOD_DAYS = 7;

// Helper: find tenant by Stripe customer ID (platform customer, not connected account)
async function getTenantByCustomer(db: any, customerId: string) {
  const snap = await db.collection('tenants')
    .where('stripeCustomerId', '==', customerId)
    .limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ref: snap.docs[0].ref, data: snap.docs[0].data() };
}

// Helper: send notification email via your existing Resend setup
async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    `ClarityFlow <billing@${process.env.RESEND_FROM_DOMAIN || 'clarityflow.app'}>`,
        to:      [to],
        subject,
        html,
      }),
    });
  } catch (err) {
    console.error('[webhook] Email send failed:', err);
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig     = req.headers.get('stripe-signature');
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-04-30.basil' as any,
  });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    console.error('[platform-webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Webhook Error' }, { status: 400 });
  }

  const db = getAdminDb();

  try {
    switch (event.type) {

      // ── account.updated: sync connected account onboarding status ────────────
      case 'account.updated': {
        const account    = event.data.object as Stripe.Account;
        const tenantSnap = await db.collection('tenants')
          .where('stripeAccountId', '==', account.id)
          .limit(1).get();
        if (tenantSnap.empty) break;

        await tenantSnap.docs[0].ref.set({
          stripeOnboardingComplete: account.details_submitted && account.charges_enabled,
          stripeChargesEnabled:     account.charges_enabled,
          stripePayoutsEnabled:     account.payouts_enabled,
          stripeAccountUpdatedAt:   new Date().toISOString(),
        }, { merge: true });

        console.log('[platform-webhook] Account synced:', account.id);
        break;
      }

      // ── customer.subscription.created: new subscriber ────────────────────────
      case 'customer.subscription.created': {
        const sub       = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const tenant    = await getTenantByCustomer(db, customerId);
        if (!tenant) break;

        const priceId   = sub.items.data[0]?.price?.id;
        const planId    = sub.items.data[0]?.price?.lookup_key || priceId || 'unknown';
        const isTrial   = sub.status === 'trialing';

        await tenant.ref.set({
          subscriptionStatus:  sub.status,          // 'active' | 'trialing'
          accessLocked:        false,
          stripeSubscriptionId: sub.id,
          stripeCustomerId:    customerId,
          planId,
          stripePriceId:       priceId,
          currentPeriodEnd:    new Date(sub.current_period_end * 1000).toISOString(),
          trialEnd:            sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          gracePeriodEndsAt:   null,
          subscriptionUpdatedAt: new Date().toISOString(),
        }, { merge: true });

        console.log(`[platform-webhook] Subscription created for tenant ${tenant.id} — status: ${sub.status}`);
        break;
      }

      // ── customer.subscription.updated: plan change or status change ──────────
      case 'customer.subscription.updated': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const tenant     = await getTenantByCustomer(db, customerId);
        if (!tenant) break;

        const priceId = sub.items.data[0]?.price?.id;
        const planId  = sub.items.data[0]?.price?.lookup_key || priceId || 'unknown';

        const updates: Record<string, any> = {
          subscriptionStatus:    sub.status,
          planId,
          stripePriceId:         priceId,
          currentPeriodEnd:      new Date(sub.current_period_end * 1000).toISOString(),
          subscriptionUpdatedAt: new Date().toISOString(),
        };

        // If reactivated after being past_due, clear the grace period and unlock
        if (sub.status === 'active') {
          updates.accessLocked      = false;
          updates.gracePeriodEndsAt = null;
        }

        // If moving to cancelled/unpaid, lock access
        if (sub.status === 'canceled' || sub.status === 'unpaid') {
          updates.accessLocked = true;
        }

        await tenant.ref.set(updates, { merge: true });

        console.log(`[platform-webhook] Subscription updated for tenant ${tenant.id} — status: ${sub.status}, plan: ${planId}`);
        break;
      }

      // ── customer.subscription.deleted: cancelled or payment exhausted ────────
      case 'customer.subscription.deleted': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const tenant     = await getTenantByCustomer(db, customerId);
        if (!tenant) break;

        await tenant.ref.set({
          subscriptionStatus:    'cancelled',
          accessLocked:          true,
          gracePeriodEndsAt:     null,
          subscriptionUpdatedAt: new Date().toISOString(),
        }, { merge: true });

        console.log(`[platform-webhook] Subscription cancelled for tenant ${tenant.id} — access locked`);

        // Send cancellation notice
        const ownerEmail = tenant.data.ownerEmail || tenant.data.email;
        if (ownerEmail) {
          await sendEmail(
            ownerEmail,
            'Your ClarityFlow subscription has ended',
            `<p>Hi ${tenant.data.name || 'there'},</p>
             <p>Your ClarityFlow subscription has been cancelled and access to your account has been suspended.</p>
             <p>To reactivate, visit <a href="https://studio-one-blue.vercel.app/settings/billing">your billing settings</a>.</p>
             <p>Your data is retained for 90 days.</p>`
          );
        }
        break;
      }

      // ── customer.subscription.trial_ending: 3 days before trial ends ─────────
      case 'customer.subscription.trial_ending': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const tenant     = await getTenantByCustomer(db, customerId);
        if (!tenant) break;

        const trialEnd   = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
        const daysLeft   = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 3;

        // Mark that warning has been sent so we don't spam
        await tenant.ref.set({
          trialEndingWarningSent: true,
          trialEnd: trialEnd?.toISOString() || null,
        }, { merge: true });

        const ownerEmail = tenant.data.ownerEmail || tenant.data.email;
        if (ownerEmail) {
          await sendEmail(
            ownerEmail,
            `Your ClarityFlow trial ends in ${daysLeft} days`,
            `<p>Hi ${tenant.data.name || 'there'},</p>
             <p>Your free trial ends in <strong>${daysLeft} days</strong> on ${trialEnd?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.</p>
             <p>To keep access to ClarityFlow, <a href="https://studio-one-blue.vercel.app/settings/billing">add a payment method</a> before your trial ends.</p>
             <p>No card on file means your account will be paused automatically.</p>`
          );
        }

        console.log(`[platform-webhook] Trial ending warning sent for tenant ${tenant.id} — ${daysLeft} days left`);
        break;
      }

      // ── invoice.payment_succeeded: payment went through ──────────────────────
      case 'invoice.payment_succeeded': {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as any)?.id;
        if (!customerId) break;

        const tenant = await getTenantByCustomer(db, customerId);
        if (!tenant) break;

        // Restore access and clear grace period
        await tenant.ref.set({
          subscriptionStatus:    'active',
          accessLocked:          false,
          gracePeriodEndsAt:     null,
          lastPaymentAt:         new Date().toISOString(),
          subscriptionUpdatedAt: new Date().toISOString(),
        }, { merge: true });

        // Store the invoice record
        const invoiceRef = db.collection(`tenants/${tenant.id}/invoices`).doc(invoice.id);
        await invoiceRef.set({
          id:            invoice.id,
          stripeInvoiceId: invoice.id,
          amount:        (invoice.amount_paid || 0) / 100,
          currency:      invoice.currency,
          status:        invoice.status,
          paidAt:        invoice.status_transitions?.paid_at
            ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
            : new Date().toISOString(),
          hostedUrl:     invoice.hosted_invoice_url,
          pdfUrl:        invoice.invoice_pdf,
          periodStart:   invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
          periodEnd:     invoice.period_end   ? new Date(invoice.period_end   * 1000).toISOString() : null,
          tenantId:      tenant.id,
        });

        console.log(`[platform-webhook] Payment succeeded for tenant ${tenant.id} — $${((invoice.amount_paid || 0) / 100).toFixed(2)}`);
        break;
      }

      // ── invoice.payment_failed: card declined ────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as any)?.id;
        if (!customerId) break;

        const tenant = await getTenantByCustomer(db, customerId);
        if (!tenant) break;

        const gracePeriodEndsAt = new Date(
          Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();

        await tenant.ref.set({
          subscriptionStatus:    'past_due',
          gracePeriodEndsAt,
          subscriptionUpdatedAt: new Date().toISOString(),
          // Do NOT lock immediately — let the grace period middleware handle it
        }, { merge: true });

        const ownerEmail = tenant.data.ownerEmail || tenant.data.email;
        if (ownerEmail) {
          await sendEmail(
            ownerEmail,
            'Action required: ClarityFlow payment failed',
            `<p>Hi ${tenant.data.name || 'there'},</p>
             <p>We couldn't process your ClarityFlow subscription payment.</p>
             <p>Your account will remain active for <strong>${GRACE_PERIOD_DAYS} days</strong> while you update your payment method.</p>
             <p><a href="https://studio-one-blue.vercel.app/settings/billing">Update payment method →</a></p>
             <p>If payment isn't resolved by ${new Date(gracePeriodEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}, access will be suspended.</p>`
          );
        }

        console.log(`[platform-webhook] Payment failed for tenant ${tenant.id} — grace period until ${gracePeriodEndsAt}`);
        break;
      }

      // ── invoice.finalized: store invoice for records ──────────────────────────
      case 'invoice.finalized': {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as any)?.id;
        if (!customerId) break;

        const tenant = await getTenantByCustomer(db, customerId);
        if (!tenant) break;

        const invoiceRef = db.collection(`tenants/${tenant.id}/invoices`).doc(invoice.id);
        await invoiceRef.set({
          id:             invoice.id,
          stripeInvoiceId: invoice.id,
          amount:         (invoice.amount_due || 0) / 100,
          currency:       invoice.currency,
          status:         invoice.status,
          finalizedAt:    new Date().toISOString(),
          hostedUrl:      invoice.hosted_invoice_url,
          pdfUrl:         invoice.invoice_pdf,
          periodStart:    invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
          periodEnd:      invoice.period_end   ? new Date(invoice.period_end   * 1000).toISOString() : null,
          tenantId:       tenant.id,
        }, { merge: true });

        console.log(`[platform-webhook] Invoice finalized for tenant ${tenant.id}: ${invoice.id}`);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[platform-webhook] Handler error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
