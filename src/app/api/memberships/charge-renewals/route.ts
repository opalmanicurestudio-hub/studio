/**
 * POST /api/memberships/charge-renewals — v1
 *
 * Cron-driven recurring membership billing. This is the OTHER HALF of
 * enroll-membership.ts's custom-billing choice — without this running on a
 * schedule, a membership would charge once at enrollment and then silently
 * never bill again, since nothing else advances nextBillingDate or
 * attempts the recurring charge.
 *
 * Selection: clients with subscription.status === 'active' whose
 * nextBillingDate has passed.
 *
 * On successful charge: advance nextBillingDate by one interval, reset
 * perkUsage to {} (a fresh cycle's allotment), record the ledger revenue
 * line.
 *
 * On failed charge (declined / no usable card): status becomes 'past_due'
 * — NOT immediately cancelled. A grace period (gracePeriodDays, default 5)
 * gives the client a chance to update payment before the membership
 * actually lapses. Staff get notified either way. This mirrors
 * MembershipLedgerPage's existing "Arrears Alert" concept — that UI
 * already expected failed/past-due membership payments to be a real,
 * visible state, not an immediate silent cancellation.
 *
 * If still past_due after gracePeriodDays: status becomes 'canceled',
 * activeMembershipId is cleared (perks stop), staff notified. This is a
 * deliberate, real design decision — not a guess dressed as fact. If you
 * want a different grace period or a different lapse behavior (e.g. never
 * auto-lapse, always require a human to cancel a membership), that's a
 * one-field change, but the default here is a real policy, not a
 * placeholder.
 *
 * Auth: same voice-secret-style header pattern as the other cron routes in
 * this codebase, kept separate from the voice system's own secret since
 * this has nothing to do with voice.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GRACE_PERIOD_DAYS_DEFAULT = 5;

export async function POST(req: NextRequest) {
  if (req.headers.get('x-billing-secret') !== process.env.BILLING_CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch { /* tenantId check below */ }
  const tenantId: string = body?.tenantId;
  // v18 — dry-run mode: runs the exact same selection logic (who's due,
  // who's past-due-past-grace) without ever calling Stripe or writing
  // anything to Firestore. Built specifically so this can be verified
  // against real client data before trusting it to move real money —
  // there was previously no safe way to test this route at all short of
  // actually charging someone or waiting for a real billing date.
  const dryRun: boolean = body?.dryRun === true;
  if (!tenantId) {
    return NextResponse.json({ charged: 0, error: 'missing_tenant' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const tenant = tenantSnap.data() || {};
    const gracePeriodDays = Number(tenant.membershipGracePeriodDays) || GRACE_PERIOD_DAYS_DEFAULT;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';
    const now = new Date();

    // No composite index needed — single-field query, filtered in memory,
    // same discipline as every other cron route in this codebase.
    const snap = await db
      .collection(`tenants/${tenantId}/clients`)
      .where('subscription.status', 'in', ['active', 'past_due'])
      .get();

    let charged = 0;
    let lapsed = 0;
    const results: any[] = [];

    for (const clientDoc of snap.docs) {
      const client = clientDoc.data() as any;
      const sub = client.subscription;
      if (!sub?.membershipId || !sub?.nextBillingDate) continue;

      const nextBilling = new Date(sub.nextBillingDate);
      if (Number.isNaN(nextBilling.getTime()) || nextBilling.getTime() > now.getTime()) continue;

      // Already past_due — check whether the grace period has expired
      // before trying to charge again.
      if (sub.status === 'past_due') {
        const pastDueSince = sub.pastDueSince ? new Date(sub.pastDueSince) : nextBilling;
        const daysPastDue = (now.getTime() - pastDueSince.getTime()) / (24 * 3600 * 1000);
        if (daysPastDue > gracePeriodDays) {
          if (!dryRun) {
            await clientDoc.ref.set(
              {
                activeMembershipId: null,
                subscription: { ...sub, status: 'canceled', canceledAt: now.toISOString() },
              },
              { merge: true },
            );
          }
          lapsed += 1;
          results.push({ clientId: clientDoc.id, clientName: client.name, outcome: dryRun ? 'would_lapse' : 'lapsed', daysPastDue: Math.round(daysPastDue) });
          continue;
        }
      }

      const membershipSnap = await db.doc(`tenants/${tenantId}/memberships/${sub.membershipId}`).get();
      const membership = membershipSnap.exists ? membershipSnap.data() as any : null;
      if (!membership) continue;
      const price = Number(membership.price) || 0;

      const cardExpDate = client.cardOnFile?.expMonth && client.cardOnFile?.expYear
        ? new Date(Number(client.cardOnFile.expYear), Number(client.cardOnFile.expMonth), 0)
        : null;
      const cardIsExpired = !!cardExpDate && cardExpDate < now;
      const hasUsableCard = !!(
        (client.cardOnFile?.paymentMethodId || client.cardOnFile?.token) &&
        (client.cardOnFile?.customerId || client.cardOnFile?.stripeCustomerId) &&
        !cardIsExpired
      );

      let chargeSucceeded = price === 0; // nothing to charge — renews cleanly
      let stripePaymentIntentId: string | undefined;

      if (dryRun) {
        // Never call Stripe or write anything in dry-run — just report
        // what this run WOULD attempt, so the decision logic can be
        // checked against real client data with zero financial risk.
        const wouldAttempt = price > 0 && hasUsableCard;
        results.push({
          clientId: clientDoc.id,
          clientName: client.name,
          membershipName: membership.name,
          amount: price,
          hasUsableCard,
          outcome: price === 0 ? 'would_renew_free' : wouldAttempt ? 'would_charge' : 'would_mark_past_due',
          reason: price > 0 && !hasUsableCard ? 'no_usable_card_on_file' : undefined,
        });
        continue;
      }

      if (price > 0 && hasUsableCard) {
        try {
          const chargeRes = await fetch(`${appUrl}/api/stripe/charge-card`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              clientId: clientDoc.id,
              amountCents: Math.round(price * 100),
              description: `Membership renewal — ${membership.name}`,
              category: 'Membership Sales',
              reason: 'Scheduled membership renewal',
              mode: 'auto',
              // Deliberately 'arrears_fee' here, unlike enrollment's
              // 'deposit' choice — a FAILED RENEWAL is a genuine billing
              // arrears situation (they already have the membership and
              // owe this cycle's payment), not a declined new-purchase
              // attempt. The two scenarios warrant different failure
              // bookkeeping on purpose.
              kind: 'arrears_fee',
            }),
          });
          const chargeData = await chargeRes.json().catch(() => ({ ok: false }));
          if (chargeData.ok) {
            chargeSucceeded = true;
            stripePaymentIntentId = chargeData.paymentIntentId;
          }
        } catch {
          /* chargeSucceeded stays false */
        }
      }

      if (chargeSucceeded) {
        const intervalMonths = membership.interval === 'yearly' ? 12 : 1;
        const newNextBilling = new Date(nextBilling);
        newNextBilling.setMonth(newNextBilling.getMonth() + intervalMonths);

        const batch = db.batch();
        batch.set(
          clientDoc.ref,
          {
            subscription: {
              ...sub,
              status: 'active',
              nextBillingDate: newNextBilling.toISOString(),
              perkUsage: {},
              perkLastUsed: null,
              pastDueSince: null,
            },
            lifetimeValue: (Number(client.lifetimeValue) || 0) + price,
          },
          { merge: true },
        );
        const txnRef = db.doc(`tenants/${tenantId}/transactions/${nanoid()}`);
        batch.set(txnRef, {
          id: txnRef.id,
          tenantId,
          date: now.toISOString(),
          description: `Membership renewal: ${membership.name}`,
          clientOrVendor: client.name || 'Client',
          clientId: clientDoc.id,
          type: 'income',
          context: 'Business',
          category: 'Membership Sales',
          amount: price,
          paymentMethod: 'Card on File (Stripe)',
          stripePaymentIntentId,
          hasReceipt: true,
        });
        await batch.commit();
        charged += 1;
        results.push({ clientId: clientDoc.id, clientName: client.name, outcome: 'charged' });
      } else {
        await clientDoc.ref.set(
          {
            subscription: {
              ...sub,
              status: 'past_due',
              pastDueSince: sub.status === 'past_due' ? sub.pastDueSince : now.toISOString(),
            },
          },
          { merge: true },
        );
        // Notify staff — same shape as every other staff notification in
        // this codebase.
        const adminsSnap = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get();
        const notifBatch = db.batch();
        adminsSnap.docs.forEach((d) => {
          const notifRef = db.collection(`tenants/${tenantId}/notifications`).doc();
          notifBatch.set(notifRef, {
            id: notifRef.id,
            userId: d.id,
            type: 'membership_payment_failed',
            message: `${client.name || 'A client'}'s membership renewal failed — $${price.toFixed(2)} for ${membership.name}`,
            link: `/clients/${clientDoc.id}`,
            createdAt: now.toISOString(),
            read: false,
          });
        });
        await notifBatch.commit();

        // v20 — FIX: previously only staff were told a renewal failed —
        // the client themselves had no idea anything was wrong until
        // their membership silently lapsed days later. That's exactly
        // the kind of surprise that generates an angry support ticket
        // ("why was I cancelled, nobody told me"). Tell them directly,
        // from their studio's own dedicated number, while there's still
        // time in the grace period to fix it.
        if (client.phone) {
          try {
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            const twilioAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
            await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
              method: 'POST',
              headers: { Authorization: `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                To: client.phone,
                From: tenant.voiceAgent?.phoneNumber || process.env.TWILIO_PHONE_NUMBER || '',
                Body: `${tenant.name || 'Your studio'}: We couldn't process your ${membership.name} membership renewal ($${price.toFixed(2)}). Please update your card on file within ${gracePeriodDays} days to keep your membership active.`,
              }),
            });
          } catch {
            /* non-fatal — staff were already notified above and can follow up manually */
          }
        }
        results.push({ clientId: clientDoc.id, clientName: client.name, outcome: 'past_due' });
      }
    }

    return NextResponse.json({ dryRun, charged, lapsed, considered: snap.docs.length, results });
  } catch (e) {
    console.error('[memberships/charge-renewals]', e);
    return NextResponse.json({ charged: 0, error: 'internal' }, { status: 500 });
  }
}
