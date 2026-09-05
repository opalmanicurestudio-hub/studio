import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { brandedEmailHtml } from '@/lib/email-template';

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


// Branded rent emails ride the same Resend + RESEND_FROM address the rest of
// the app's mail uses — tenant name as display name, fail-soft everywhere.
/**
 * Rent mail goes through sendNotification like every other message now.
 * It used to POST straight to Resend from here, which meant three things the
 * owner could not see or control: no row in the delivery log (so "did the
 * receipt go?" had no answer), no delivered/opened tracking, and no switch or
 * wording in message settings — the only control was the raw rentComms flag.
 * The kinds below already existed in the catalogue; the sends just never
 * used them. fromName is kept only for the signature: the from-address is the
 * platform's verified sender either way.
 */
async function sendRentEmail(opts: {
  db: any; tenantId: string; to: string; fromName: string; subject: string; html: string;
  kind: string; recipientType?: 'renter' | 'other'; recipientId?: string | null; recipientName?: string | null;
}): Promise<boolean> {
  if (!opts.to) return false;
  try {
    const { sendNotification } = await import('@/lib/notify');
    const r = await sendNotification(opts.db, {
      tenantId: opts.tenantId, channel: 'email', to: opts.to,
      subject: opts.subject, html: opts.html, kind: opts.kind,
      recipientType: opts.recipientType || 'renter',
      recipientId: opts.recipientId || null,
      recipientName: opts.recipientName || null,
    });
    return r.ok;
  } catch {
    return false;
  }
}

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

/** True if `dueDay` matches today, honoring lease frequency (daily/weekly/biweekly = day-of-cycle count; monthly = day-of-month).
 *
 *  Both dates are read as CALENDAR days, not as instants. The previous form
 *  parsed `${day}T00:00:00` — a string with no zone, which JavaScript reads
 *  in whatever zone the process happens to run in — and then asked it for a
 *  day-of-month. It gave the right answer only because Vercel runs in UTC;
 *  the same code on a laptop in Eastern reported the day before. A day is a
 *  day: take the numbers out of the string and never build an instant. */
function isDueToday(lease: any, todayIso: string): boolean {
  const parts = (v: any) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  };
  const today = parts(todayIso);
  if (!today) return false;
  if (lease.frequency === 'monthly') {
    return today.d === lease.dueDay;
  }
  const anchor = parts(lease.firstChargeDate);
  if (!anchor) return false;
  const stepDays = lease.frequency === 'daily' ? 1 : lease.frequency === 'weekly' ? 7 : 14;
  const diffDays = Math.round(
    (Date.UTC(today.y, today.mo - 1, today.d) - Date.UTC(anchor.y, anchor.mo - 1, anchor.d)) / 86_400_000,
  );
  return diffDays >= 0 && diffDays % stepDays === 0;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { db } = getAdmin();
  const stripe = getStripe();
  const nowISO = new Date().toISOString();

  const results: { leaseId: string; ok: boolean; reason?: string }[] = [];

  // Every tenant with at least one connected Stripe account — charges are
  // scoped per-tenant same as everywhere else in this app.
  const tenantsSnap = await db.collection('tenants').where('stripeAccountId', '!=', null).get();

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    const stripeAccountId = tenantDoc.data().stripeAccountId;
    if (!stripeAccountId) continue;

    // Which day it is decides whether rent is charged AND forms the dedupe
    // key, so it has to be the studio's day. On a UTC clock a west-coast
    // lease was charged on the evening BEFORE its due date — and the dedupe
    // key rolled over mid-evening, which is how one day could take two
    // payments. Resolved per tenant.
    const todayIso = todayIn(tenantTimeZone(tenantDoc.data() as any));

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

      // A saved card is stored as stripePaymentMethodId (the portal and the
      // setup-card link both write that); this cron was checking a field that
      // nothing ever wrote, so every lease, every day, was "not configured"
      // and nobody was ever drafted. Either name is honoured now.
      const paymentMethodId = renter?.stripePaymentMethodId || renter?.defaultPaymentMethodId || null;
      if (!renter?.autopayEnabled || !renter.stripeCustomerId || !paymentMethodId) {
        results.push({
          leaseId: lease.id, ok: false,
          reason: !renter?.autopayEnabled ? 'autopay_off' : !renter?.stripeCustomerId ? 'no_stripe_customer' : 'no_card',
        });
        continue;
      }

      // The invoice this draft settles — raised by the nightly job this
      // morning. Marked paid on success, left for the late sweep on decline.
      const invSnap = await db.collection(`tenants/${tenantId}/rentInvoices`)
        .where('leaseId', '==', lease.id).where('dueDate', '==', todayIso).limit(1).get();
      const invoiceRef = invSnap.empty ? null : invSnap.docs[0].ref;

      const now = new Date().toISOString();
      let intent: Stripe.PaymentIntent | null = null;
      let failureReason: string | null = null;

      try {
        intent = await stripe.paymentIntents.create(
          {
            amount: lease.rentAmountCents,
            currency: 'usd',
            customer: renter.stripeCustomerId,
            payment_method: paymentMethodId,
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
      if (intent && intent.status === 'succeeded' && invoiceRef) {
        batch.set(invoiceRef, {
          status: 'paid', paidAt: new Date().toISOString(), ledgerEntryId: ledgerRef.id,
          paidVia: 'autopay', updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

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

      // ── comms: receipts + decline notices, honoring tenants/{t}.rentComms ──
      // After the commit on purpose: the money truth is on the ledger before
      // a single email goes out, and a mail failure can never unwind it.
      try {
        const tData: any = tenantDoc.data() || {};
        const comms: any = { sendReceipts: true, ownerEmailOnFailedAutopay: true, ...(tData.rentComms || {}) };
        const businessName = String(tData.name || 'ClarityFlow');
        const base = String(tData.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://studio-one-blue.vercel.app')).replace(/\/+$/, '');
        const portalUrl = renter?.portalToken ? `${base}/rent/${tenantId}?rt=${renter.portalToken}` : '';
        const amountStr = `$${((lease.rentAmountCents || 0) / 100).toFixed(2)}`;
        const boothName = booth?.name || 'your booth';
        if (!failureReason) {
          if (comms.sendReceipts !== false && renter?.email) {
            await sendRentEmail({
              db, tenantId, kind: 'rent_receipt',
              recipientId: lease.renterId || null, recipientName: `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || null,
              to: renter.email, fromName: businessName,
              subject: `Rent paid — ${amountStr} (${boothName})`,
              html: brandedEmailHtml({
                studioName: businessName,
                title: 'Rent paid — thank you.',
                bodyLines: [
                  `Your autopay went through: ${amountStr} for ${boothName} on ${todayIso}.`,
                  'Keep this email for your records — your portal has the full history.',
                ],
                ...(portalUrl ? { cta: { label: 'Open my portal', url: portalUrl } } : {}),
                footerNote: `Sent by ${businessName}.`,
              }),
            });
          }
        } else {
          if (renter?.email) {
            await sendRentEmail({
              db, tenantId, kind: 'rent_failed',
              recipientId: lease.renterId || null, recipientName: `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || null,
              to: renter.email, fromName: businessName,
              subject: 'Action needed — your rent payment didn\u2019t go through',
              html: brandedEmailHtml({
                studioName: businessName,
                title: 'Your rent payment didn\u2019t go through.',
                bodyLines: [
                  `We tried to collect ${amountStr} for ${boothName} today and the card was declined.`,
                  'The amount stays owed. Update your card or pay directly in your portal to stay ahead of late fees.',
                ],
                ...(portalUrl ? { cta: { label: 'Update my card', url: portalUrl } } : {}),
                footerNote: `Sent by ${businessName}.`,
              }),
            });
          }
          if (comms.ownerEmailOnFailedAutopay !== false) {
            const ownerEmail = String(tData.notificationEmail || tData.email || '');
            if (ownerEmail) {
              const rn = `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || 'A renter';
              await sendRentEmail({
                db, tenantId, kind: 'rent_failed', recipientType: 'other', recipientName: 'Owner',
                to: ownerEmail, fromName: 'ClarityFlow',
                subject: `Autopay declined — ${rn} (${amountStr})`,
                html: brandedEmailHtml({
                  studioName: 'ClarityFlow',
                  title: `${rn}\u2019s autopay was declined.`,
                  bodyLines: [
                    `${amountStr} for ${boothName} did not collect (${failureReason}). It\u2019s posted as owed, and the renter was asked to update their card.`,
                  ],
                  cta: { label: 'Open Booths', url: `${base}/booths` },
                  footerNote: 'You\u2019re receiving this because you own this business on ClarityFlow.',
                }),
              });
            }
          }
        }
      } catch { /* comms are a bonus — the charge and ledger truth stand */ }
    }
  }

  return NextResponse.json({ processed: results.length, results });
}

// Vercel Cron invokes scheduled paths with GET — same auth, same run.
export async function GET(req: NextRequest) {
  return POST(req);
}
