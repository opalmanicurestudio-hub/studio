import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── /api/cron/autopay-leases/route.ts ─────────────────────────────────────
// Runs once daily (wire to Vercel Cron / Cloud Scheduler / GitHub Actions —
// whatever already triggers other scheduled jobs in this app; hits this URL
// with header `Authorization: Bearer ${CRON_SECRET}`).
//
// For every ACTIVE lease where the renter has autopayEnabled + a card on
// file, and today matches the lease's billing cycle, charges rent
// off-session (mirrors charge-card's `mode: 'auto'` branch exactly — same
// off_session reasoning: no one's present, the card was authorized in
// advance) and writes the charge to both tenants/{t}/transactions (fee
// reconciliation) and tenants/{t}/rentLedger (rent roll), exactly like
// book-station does for day-use bookings — same dual-ledger reasoning
// applies here, it's the same studio's money either way.
//
// IDEMPOTENCY: keyed by `autopay_${leaseId}_${todayIso}` — Stripe's
// idempotency key AND a NotificationLog dedupeKey check both prevent a
// re-run (retried cron, duplicate trigger) from double-charging the same
// lease on the same day.
//
// FAILURE HANDLING: a failed charge does NOT retry same-day. It writes a
// 'pending' ledger charge (so it shows up as owed, same as a manual charge
// would) and a NotificationLog entry so the existing reminder/escalation
// pipeline (see StudioSettings.reminders) picks it up on its normal
// cadence, rather than building a second dunning system in parallel.
// ─────────────────────────────────────────────────────────────────────────

function getAdmin() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return { db: getFirestore(app) };
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

function resolveChargeId(intent: Stripe.PaymentIntent): string | null {
  return typeof intent.latest_charge === 'string' ? intent.latest_charge : (intent.latest_charge as any)?.id || null;
}

/** True if `dueDay` matches today, honoring lease frequency (daily/weekly/biweekly = day-of-cycle count; monthly = day-of-month). */
function isDueToday(lease: any, todayIso: string): boolean {
  const today = new Date(`${todayIso}T00:00:00`);
  if (lease.frequency === 'monthly') {
    return today.getDate() === lease.dueDay;
  }
  const anchor = new Date(`${lease.firstChargeDate}T00:00:00`);
  const stepDays = lease.frequency === 'daily' ? 1 : lease.frequency === 'weekly' ? 7 : 14;
  const diffDays = Math.round((today.getTime() - anchor.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays % stepDays === 0;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { db } = getAdmin();
  const stripe = getStripe();
  const todayIso = new Date().toISOString().slice(0, 10);
  const nowISO = new Date().toISOString();

  const results: { leaseId: string; ok: boolean; reason?: string }[] = [];

  // Every tenant with at least one connected Stripe account — charges are
  // scoped per-tenant same as everywhere else in this app.
  const tenantsSnap = await db.collection('tenants').where('stripeAccountId', '!=', null).get();

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    const stripeAccountId = tenantDoc.data().stripeAccountId;
    if (!stripeAccountId) continue;

    const leasesSnap = await db.collection(`tenants/${tenantId}/leases`).where('status', '==', 'active').get();

    for (const leaseDoc of leasesSnap.docs) {
      const lease = { id: leaseDoc.id, ...leaseDoc.data() } as any;
      if (!isDueToday(lease, todayIso)) continue;

      const dedupeKey = `autopay_${lease.id}_${todayIso}`;
      const alreadyRun = await db.collection(`tenants/${tenantId}/notificationLog`).where('dedupeKey', '==', dedupeKey).limit(1).get();
      if (!alreadyRun.empty) {
        results.push({ leaseId: lease.id, ok: false, reason: 'already_processed_today' });
        continue;
      }

      const renterSnap = await db.doc(`tenants/${tenantId}/renters/${lease.renterId}`).get();
      const renter = renterSnap.data();
      const boothSnap = await db.doc(`tenants/${tenantId}/booths/${lease.boothId}`).get();
      const booth = boothSnap.data();

      if (!renter?.autopayEnabled || !renter.stripeCustomerId || !renter.defaultPaymentMethodId) {
        results.push({ leaseId: lease.id, ok: false, reason: 'autopay_not_configured' });
        continue;
      }

      const now = new Date().toISOString();
      let intent: Stripe.PaymentIntent | null = null;
      let failureReason: string | null = null;

      try {
        intent = await stripe.paymentIntents.create(
          {
            amount: lease.rentAmountCents,
            currency: 'usd',
            customer: renter.stripeCustomerId,
            payment_method: renter.defaultPaymentMethodId,
            off_session: true,
            confirm: true,
            description: `Autopay rent — ${booth?.name ?? lease.boothId}`,
            metadata: { tenantId, leaseId: lease.id, renterId: lease.renterId, kind: 'lease_autopay' },
          },
          { stripeAccount: stripeAccountId, idempotencyKey: dedupeKey }
        );
        if (intent.status !== 'succeeded') failureReason = `stripe_${intent.status}`;
      } catch (err: any) {
        failureReason = err?.code || err?.message || 'charge_failed';
      }

      const ledgerRef = db.collection(`tenants/${tenantId}/rentLedger`).doc();
      const notifRef = db.collection(`tenants/${tenantId}/notificationLog`).doc();
      const batch = db.batch();

      if (intent && intent.status === 'succeeded') {
        const chargeId = resolveChargeId(intent);
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();

        batch.set(txnRef, {
          id: txnRef.id,
          date: nowISO,
          description: `Autopay rent — ${booth?.name ?? lease.boothId}`,
          clientOrVendor: `${renter.firstName} ${renter.lastName}`,
          type: 'income',
          context: 'Business',
          category: 'Rent income',
          taxBucket: 'revenue',
          amount: lease.rentAmountCents / 100,
          paymentMethod: 'Card on file (Stripe autopay)',
          stripePaymentIntentId: intent.id,
          stripeChargeId: chargeId,
          leaseId: lease.id,
          hasReceipt: true,
          tenantId, locationId: lease.locationId,
        });

        batch.set(ledgerRef, {
          id: ledgerRef.id,
          locationId: lease.locationId,
          leaseId: lease.id,
          bookingId: null,
          renterId: lease.renterId,
          boothId: lease.boothId,
          type: 'rent_charge',
          amountCents: lease.rentAmountCents,
          status: 'paid',
          dueDate: todayIso,
          paidAt: nowISO,
          description: 'Autopay rent charge',
          method: 'card',
          stripePaymentIntentId: intent.id,
          createdAt: nowISO,
          updatedAt: nowISO,
        });

        batch.set(notifRef, {
          id: notifRef.id,
          tenantId, locationId: lease.locationId,
          recipientType: 'renter',
          recipientId: lease.renterId,
          channel: 'email',
          eventType: 'payment_received',
          relatedId: ledgerRef.id,
          status: 'pending',
          dedupeKey,
          createdAt: nowISO,
          sentAt: null,
        });

        batch.update(db.doc(`tenants/${tenantId}/leases/${lease.id}`), { lastChargeDate: todayIso, updatedAt: nowISO });

        results.push({ leaseId: lease.id, ok: true });
      } else {
        // Charge failed — post a PENDING charge (so it shows as owed, same
        // as any other unpaid rent) rather than silently dropping it, and
        // let the existing reminder/escalation pipeline handle follow-up.
        batch.set(ledgerRef, {
          id: ledgerRef.id,
          locationId: lease.locationId,
          leaseId: lease.id,
          bookingId: null,
          renterId: lease.renterId,
          boothId: lease.boothId,
          type: 'rent_charge',
          amountCents: lease.rentAmountCents,
          status: 'pending',
          dueDate: todayIso,
          paidAt: null,
          description: `Autopay rent charge — card declined (${failureReason})`,
          createdAt: nowISO,
          updatedAt: nowISO,
        });

        batch.set(notifRef, {
          id: notifRef.id,
          tenantId, locationId: lease.locationId,
          recipientType: 'owner',
          recipientId: lease.renterId,
          channel: 'email',
          eventType: 'rent_late',
          relatedId: ledgerRef.id,
          status: 'pending',
          dedupeKey,
          createdAt: nowISO,
          sentAt: null,
          error: failureReason ?? undefined,
        });

        results.push({ leaseId: lease.id, ok: false, reason: failureReason ?? 'unknown' });
      }

      await batch.commit();
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
