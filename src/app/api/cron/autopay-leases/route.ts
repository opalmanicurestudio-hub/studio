import { NextRequest, NextResponse } from 'next/server';
import { recordCronRun } from '@/lib/cron-heartbeat';
import { refuseCron } from '@/lib/cron-auth';
import { linkOrigin } from '@/lib/app-origin';
import { mintRenterLink } from '@/lib/renter-link';
import Stripe from 'stripe';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { brandedEmailHtml } from '@/lib/email-template';
import { renterBusinessCard, spacePayAccount } from '@/lib/space-stripe';
import { stripeRefused } from '@/lib/stripe-said-no';

// ─── /api/cron/autopay-leases/route.ts ─────────────────────────────────────
// Runs once daily (wire to Vercel Cron / Cloud Scheduler / GitHub Actions —
// whatever already triggers other scheduled jobs in this app; hits this URL
// with header `Authorization: Bearer ${CRON_SECRET}`).
//
// For every ACTIVE lease with autopay on (the renter's switch, or the owner's auto-collect) and a card saved on the
// business's account, charges the open rent bill the nightly job made: one dated today or yesterday (first bills
// included; the day before covers businesses far west of UTC, where the nightly run lands on the previous local day).
// Writes the payment to tenants/{t}/transactions (source 'booth_rent', with the renter and the bill) and the rent ledger.
//
// ONCE PER BILL: the bill is claimed (autopayTriedAt) in one step before it's charged, and the charge is keyed to the
// bill, so a second run, a retried trigger or a failed save never charges it twice.
//
// FAILURE HANDLING: a declined card isn't tried again on its own. The bill stays open (the late sweep and reminders take
// it from there) and the ledger keeps a 'failed' line as history, not as a second amount owed. A late fee on a bill is
// never taken by autopay; it stays on the bill.
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

const { FieldValue } = require('firebase-admin/firestore');

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


export async function POST(req: NextRequest) {
  // Only the scheduler, holding the secret exactly. No secret set: nobody (a missing secret used to let
  // "Bearer undefined" through).
  const refused = refuseCron(req); if (refused) return refused;
  void recordCronRun('autopay-leases');   // HQ → System: "did it run?"

  const { db } = getAdmin();
  const stripe = getStripe();
  const nowISO = new Date().toISOString();

  const results: { leaseId: string; ok: boolean; reason?: string }[] = [];

  // Every tenant with at least one connected Stripe account — charges are
  // scoped per-tenant same as everywhere else in this app.
  const tenantsSnap = await db.collection('tenants').where('stripeAccountId', '!=', null).get();

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    // Only an account that can take cards (lib/space-stripe): the same check every other space payment makes.
    const stripeAccountId = spacePayAccount(tenantDoc.data());
    if (!stripeAccountId) continue;

    // Which day it is decides whether rent is charged AND forms the dedupe
    // key, so it has to be the studio's day. On a UTC clock a west-coast
    // lease was charged on the evening BEFORE its due date — and the dedupe
    // key rolled over mid-evening, which is how one day could take two
    // payments. Resolved per tenant.
    const todayIso = todayIn(tenantTimeZone(tenantDoc.data() as any));

    const leasesSnap = await db.collection(`tenants/${tenantId}/leases`).where('status', '==', 'active').get();

    // What autopay takes is the rent bill the nightly job made (lib/rent-schedule decides the days, first bills
    // included): one dated today or yesterday (the nightly run lands on the previous local day for businesses far west of
    // UTC), still open, and not tried by autopay before. A declined card isn't tried again on its own: the bill waits for
    // the renter or the business.
    const yesterdayIso = new Date(Date.parse(`${todayIso}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const openBills = new Map<string, any>();
    for (const d of (await db.collection(`tenants/${tenantId}/rentInvoices`).where('dueDate', 'in', [yesterdayIso, todayIso]).get()).docs) {
      const x: any = d.data() || {};
      if (!['due', 'late'].includes(String(x.status || '')) || x.autopayTriedAt || !x.leaseId) continue;
      const prev = openBills.get(String(x.leaseId));
      if (!prev || String(x.dueDate) < String(prev.data.dueDate)) openBills.set(String(x.leaseId), { ref: d.ref, data: x });
    }

    for (const leaseDoc of leasesSnap.docs) {
      const lease = { id: leaseDoc.id, ...leaseDoc.data() } as any;
      const bill = openBills.get(lease.id);
      if (!bill) continue;

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
      // ONE autopay: charged when the renter switched autopay on in their portal, OR the owner set this lease to
      // auto-collect in Booths (the old separate collector for that never ran — those leases were invoiced and
      // then sat unpaid, unseen by the late-rent sweep). A card on file is needed either way.
      const autoCharge = renter?.autopayEnabled === true || lease.autoCollect === true;
      // Charged on the business's account, to a card saved there (lib/space-stripe). A card saved on the platform's
      // account before the move can't be charged here, so it waits to be saved again (the invoice stays open).
      const card = renterBusinessCard(renter, stripeAccountId);
      if (!autoCharge || !renter?.stripeCustomerId || !paymentMethodId || !card) {
        results.push({
          leaseId: lease.id, ok: false,
          reason: !autoCharge ? 'autopay_off' : !renter?.stripeCustomerId ? 'no_stripe_customer' : !paymentMethodId ? 'no_card' : 'card_saved_before_move',
        });
        continue;
      }

      // The invoice this draft settles — raised by the nightly job this
      // morning. Marked paid on success, left for the late sweep on decline.
      const invoiceRef = bill.ref;
      // Charge what today's invoice still owes — never the lease's full rent blindly. No invoice (rent paused by approved
      // leave, or not billed today) → nothing to charge; already paid (the renter paid early) → nothing to charge. The
      // invoice already has credits and leave reductions taken off.
      const inv: any = bill.data;
      if (!inv) { results.push({ leaseId: lease.id, ok: false, reason: 'no_invoice_today' }); continue; }
      if (['paid', 'void', 'waived', 'cancelled'].includes(String(inv.status || ''))) { results.push({ leaseId: lease.id, ok: false, reason: 'already_paid' }); continue; }
      if (Math.max(0, Math.round((Number(inv.amountCents ?? lease.rentAmountCents) || 0) - (Number(inv.paidCents) || 0))) <= 0) { results.push({ leaseId: lease.id, ok: false, reason: 'nothing_owed' }); continue; }

      // Claimed before it's charged, in one step: whatever happens next (a decline, a failed save, a second run at the same
      // moment), autopay never takes this bill again on its own. What it charges is worked out from the bill as it is at
      // that moment, so a payment or credit that landed since it was first read is never charged again. The charge is
      // named after the bill and amount, so Stripe makes it once however often it's asked.
      const claim: any = await db.runTransaction(async (tx: any) => {
        const cur: any = ((await tx.get(invoiceRef)).data() as any) || {};
        if (cur.autopayTriedAt || !['due', 'late'].includes(String(cur.status || ''))) return { taken: true };
        const cents = Math.max(0, Math.round((Number(cur.amountCents ?? lease.rentAmountCents) || 0) - (Number(cur.paidCents) || 0)));
        if (cents <= 0) return { none: true };
        tx.set(invoiceRef, { autopayTriedAt: nowISO, autopayChargeCents: cents }, { merge: true });
        return { cents };
      }).catch(() => ({ taken: true }));
      if (claim.none) { results.push({ leaseId: lease.id, ok: false, reason: 'nothing_owed' }); continue; }
      if (!claim.cents) { results.push({ leaseId: lease.id, ok: false, reason: 'already_tried' }); continue; }
      const chargeCents: number = claim.cents;

      const now = new Date().toISOString();
      let intent: Stripe.PaymentIntent | null = null;
      let failureReason: string | null = null;

      // Stripe saying no (a declined card) is a decline. No answer (a dropped connection, Stripe's own error) may have
      // gone through, so it's asked again under the same key, which finds what Stripe did; still no answer, and the
      // bill is left for the business to check, never treated as a decline.
      let unconfirmed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          intent = await stripe.paymentIntents.create(
            {
              amount: chargeCents,
              currency: 'usd',
              customer: card.customer,
              payment_method: card.pm,
              off_session: true,
              confirm: true,
              description: `Autopay rent — ${booth?.name ?? 'space'}`,
              metadata: { tenantId, leaseId: lease.id, renterId: lease.renterId, invoiceId: invoiceRef.id, kind: 'lease_autopay' },
            },
            { stripeAccount: stripeAccountId, idempotencyKey: `autopay-bill-${invoiceRef.id}-${chargeCents}` }
          );
          // Still processing (it may yet go through) is unconfirmed, not a decline. One that needs the renter (another card,
          // or their bank's check) or was canceled didn't go through: a decline, which the renter can pay themselves.
          unconfirmed = intent.status === 'processing';
          failureReason = intent.status !== 'succeeded' ? `stripe_${intent.status}` : null;
          break;
        } catch (err: any) {
          if (stripeRefused(err)) { unconfirmed = false; failureReason = err?.code || err?.raw?.code || 'card_declined'; break; }
          unconfirmed = true; failureReason = String(err?.message || 'no answer').slice(0, 120);
        }
      }
      if (unconfirmed) {
        await invoiceRef.set({ autopayUnconfirmed: true, autopayUnconfirmedNote: failureReason, updatedAt: nowISO }, { merge: true }).catch(() => {});
        const n0 = db.collection(`tenants/${tenantId}/notifications`).doc();
        await n0.set({ id: n0.id, type: 'renter_autopay', read: false, createdAt: nowISO, link: '/rent',
          message: `Autopay couldn’t confirm the rent payment for ${`${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || 'a renter'} (due ${inv.dueDate}). Check your Stripe payments before taking it another way.` }).catch(() => {});
        results.push({ leaseId: lease.id, ok: false, reason: 'unconfirmed' });
        continue;
      }
      // Taken: noted on the bill straight away, so even if saving the rest fails the bill shows it was paid by autopay.
      if (intent && intent.status === 'succeeded') {
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await invoiceRef.set({ autopayIntentId: intent.id, autopayChargedCents: chargeCents }, { merge: true }); break; } catch { /* try again */ }
        }
      }

      const ledgerRef = db.collection(`tenants/${tenantId}/rentLedger`).doc();
      const notifRef = db.collection(`tenants/${tenantId}/notificationLog`).doc();
      const batch = db.batch();
      if (intent && intent.status === 'succeeded' && invoiceRef) {
        // A late fee on the bill isn't taken by autopay: the rent is, and the fee stays on the bill for the business.
        const feeLeft = Math.max(0, Number(inv.lateFeeCents) || 0);
        batch.set(invoiceRef, {
          ...(feeLeft > 0 ? {} : { status: 'paid', paidAt: new Date().toISOString() }),
          ledgerEntryId: ledgerRef.id,
          // Added to what's already there, never a copy of an earlier read, so nothing recorded meanwhile is lost.
          paidCents: FieldValue.increment(chargeCents),
          paidVia: 'autopay', autopayIntentId: intent.id, updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      if (intent && intent.status === 'succeeded') {
        const chargeId = resolveChargeId(intent);
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();

        batch.set(txnRef, {
          id: txnRef.id,
          date: nowISO,
          description: `Rent — ${booth?.name ?? 'space'} (due ${inv.dueDate}, autopay)`,
          clientOrVendor: `${renter.firstName} ${renter.lastName}`,
          type: 'income',
          context: 'Business',
          // The same fields every rent payment has, so it shows in the renter's history and the rent reports.
          source: 'booth_rent',
          category: 'Booth Rent',
          renterId: lease.renterId,
          sourceId: invoiceRef.id,
          taxBucket: 'revenue',
          amount: chargeCents / 100,
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
          amountCents: chargeCents,
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
        // Charge failed: a 'failed' line for the history (what's owed stays on the bill, so it isn't counted twice), and
        // the existing reminder pipeline follows up on the open bill.
        batch.set(ledgerRef, {
          id: ledgerRef.id,
          locationId: lease.locationId,
          leaseId: lease.id,
          bookingId: null,
          renterId: lease.renterId,
          boothId: lease.boothId,
          type: 'rent_charge',
          amountCents: chargeCents,
          // History only: what's owed stays on the rent bill, so this line isn't counted as owed again.
          status: 'failed',
          dueDate: String(inv.dueDate || todayIso).slice(0, 10),
          paidAt: null,
          description: `Autopay rent charge — card declined (${failureReason})`,
          createdAt: nowISO,
          updatedAt: nowISO,
        });
        // Tried once (claimed above): the bill stays open for the renter or the business, and autopay doesn't try again.
        batch.set(invoiceRef, { autopayDeclined: String(failureReason || 'declined').slice(0, 120), updatedAt: nowISO }, { merge: true });

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

      // The money already moved (or didn't), so the record is saved even through a passing hiccup: tried three times.
      let saved = false;
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        try { await batch.commit(); saved = true; }
        catch (e) { if (attempt === 2) console.error('[autopay] could not save the result for bill', invoiceRef.id, intent?.id || failureReason, e); }
      }
      if (!saved) { results.push({ leaseId: lease.id, ok: false, reason: 'save_failed' }); continue; }

      // ── comms: receipts + decline notices, honoring tenants/{t}.rentComms ──
      // After the commit on purpose: the money truth is on the ledger before
      // a single email goes out, and a mail failure can never unwind it.
      try {
        const tData: any = tenantDoc.data() || {};
        const comms: any = { sendReceipts: true, ownerEmailOnFailedAutopay: true, ...(tData.rentComms || {}) };
        const businessName = String(tData.name || 'ClarityFlow');
        const base = linkOrigin(tData, 'https://studio-one-blue.vercel.app');
        const portalUrl = renter?.email && lease.renterId ? ((await mintRenterLink(db, tenantId, String(lease.renterId), base, { renter }).catch(() => null)) || '') : '';
        const amountStr = `$${(chargeCents / 100).toFixed(2)}`;
        const boothName = booth?.name || 'your booth';
        if (!failureReason) {
          if (comms.sendReceipts !== false && renter?.email) {
            await sendRentEmail({
              db, tenantId, kind: 'rent_receipt',
              recipientId: lease.renterId || null, recipientName: `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || null,
              to: renter.email, fromName: businessName,
              subject: `Rent payment received: ${amountStr} (${boothName})`,
              html: brandedEmailHtml({
                studioName: businessName,
                title: 'Thank you for your rent payment',
                bodyLines: [
                  `Hi ${renter?.firstName || 'there'},`,
                  `Thank you. Your autopay payment of ${amountStr} for ${boothName} was processed successfully on ${todayIso}.`,
                  'Please keep this email for your records. Your full payment history is available in your portal.',
                  `Kind regards, ${businessName}`,
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
              subject: 'Action needed: we were unable to process your rent payment',
              html: brandedEmailHtml({
                studioName: businessName,
                title: 'We were unable to process your rent payment',
                bodyLines: [
                  `Hi ${renter?.firstName || 'there'},`,
                  `We were not able to process your rent payment of ${amountStr} for ${boothName} today, as the card on file was declined.`,
                  'The amount remains outstanding. Please update your card or pay directly in your portal to avoid any late fees.',
                  `Kind regards, ${businessName}`,
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
                subject: `Autopay declined: ${rn} (${amountStr})`,
                html: brandedEmailHtml({
                  studioName: 'ClarityFlow',
                  title: `${rn}\u2019s autopay was declined`,
                  bodyLines: [
                    `The rent payment of ${amountStr} for ${boothName} was not collected (${failureReason}). It has been recorded as owed, and the renter has been asked to update their card.`,
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
