/**
 * rentCollector.ts — v1 (recurring rent: the money-collecting engine)
 *
 * Daily at 8:00 AM ET. For every ACTIVE lease with autoCollect enabled:
 *
 *  1. DUE TODAY? monthly → lease.dueDay (default: start date's day,
 *     clamped to 28); weekly/biweekly → every 7/14 days from startDate.
 *  2. INVOICE — idempotent doc at rentInvoices/{leaseId}_{dueDate}:
 *     { renterId, leaseId, boothId, dueDate, amountCents, status }.
 *     Reruns and redeploys can never double-bill.
 *  3. CHARGE — renter's card on file (setup-card flow), off-session.
 *     Success → invoice 'paid' + canonical ledger txn (source
 *     'booth_rent', clientOrVendor = renter name — so statements,
 *     receipts, and the renter portal all pick it up automatically).
 *     No card / declined → invoice stays 'due' + owner notification.
 *  4. LATE LADDER — unpaid 3 days past due → status 'late', one late
 *     fee applied (lease.lateFeeCents, default $25), retry the card;
 *     7 days → final retry + escalation notice. Fees join the invoice
 *     total so the eventual charge collects rent + fee together.
 *
 * Deploy: functions/src/rentCollector.ts
 *   index.ts: export { rentCollector } from './rentCollector';
 *   firebase functions:secrets:set STRIPE_SECRET_KEY   (if not already set)
 *   firebase deploy --only functions:rentCollector
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) initializeApp();

const STRIPE_KEY = defineSecret('STRIPE_SECRET_KEY');

const OCCUPYING = ['active', 'on_leave'];
const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 3;
const FINAL_RETRY_DAYS = 7;
const DEFAULT_LATE_FEE_CENTS = 2500;

const iso = (d: Date) => d.toISOString().slice(0, 10);

function isDueToday(lease: any, todayStr: string): boolean {
  if (!lease.startDate || lease.startDate > todayStr) return false;
  if (lease.endDate && lease.endDate < todayStr) return false;
  const today = new Date(todayStr + 'T00:00:00Z');
  if (lease.frequency === 'monthly') {
    const dueDay = Math.min(28, Number(lease.dueDay) || Math.min(28, new Date(lease.startDate + 'T00:00:00Z').getUTCDate()));
    return today.getUTCDate() === dueDay;
  }
  const start = new Date(lease.startDate + 'T00:00:00Z').getTime();
  const days = Math.round((today.getTime() - start) / DAY_MS);
  if (lease.frequency === 'weekly') return days >= 0 && days % 7 === 0;
  if (lease.frequency === 'biweekly') return days >= 0 && days % 14 === 0;
  return false;
}


// Exact Stripe fee via the charge's balance transaction. Fail-open —
// fee recording must never block rent collection.
async function stripeFeeFor(stripeKey: string, paymentIntentId: string | null): Promise<{ feeCents: number; chargeId: string | null }> {
  try {
    if (!paymentIntentId || !stripeKey) return { feeCents: 0, chargeId: null };
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);
    const pi: any = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
    const charge: any = pi?.latest_charge;
    const bt: any = charge?.balance_transaction;
    return { feeCents: Number(bt?.fee) || 0, chargeId: charge?.id || null };
  } catch { return { feeCents: 0, chargeId: null }; }
}

async function notify(db: FirebaseFirestore.Firestore, tenantId: string, message: string) {
  const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
  await ref.set({ id: ref.id, type: 'rent_collection', read: false, createdAt: new Date().toISOString(), link: '/booths', message });
}

async function writeRentTxn(db: FirebaseFirestore.Firestore, tenantId: string, inv: any, renterName: string, paymentIntentId: string | null, viaCard: boolean) {
  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  const nowIso = new Date().toISOString();
  const total = (inv.amountCents || 0) + (inv.lateFeeCents || 0);
  const { feeCents, chargeId } = viaCard ? await stripeFeeFor(STRIPE_KEY.value(), paymentIntentId) : { feeCents: 0, chargeId: null };
  await txnRef.set({
    id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
    amount: total / 100, category: 'Booth Rent', source: 'booth_rent',
    description: `Rent — ${inv.boothName || 'Space'} — due ${inv.dueDate}${inv.lateFeeCents ? ` (incl. $${(inv.lateFeeCents / 100).toFixed(2)} late fee)` : ''}`,
    clientOrVendor: renterName, date: nowIso,
    paymentMethod: viaCard ? 'Card on file (Stripe)' : 'Recorded manually',
    hasReceipt: false, stripePaymentIntentId: paymentIntentId, stripeChargeId: chargeId,
    stripeFeeCents: feeCents || null, netAmountCents: feeCents ? total - feeCents : null,
    sourceId: inv.id, leaseId: inv.leaseId, renterId: inv.renterId, tenantId, createdAt: nowIso,
  });

  if (feeCents > 0) {
    const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await feeRef.set({
      id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
      amount: feeCents / 100, category: 'Processing Fees',
      description: `Stripe fee — rent — ${inv.boothName || 'Space'} (${renterName})`,
      clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
      hasReceipt: false, stripePaymentIntentId: paymentIntentId, stripeChargeId: chargeId,
      sourceId: inv.id, leaseId: inv.leaseId, renterId: inv.renterId, relatedTxnId: txnRef.id,
      tenantId, createdAt: nowIso,
    });
  }
}

async function chargeCard(stripeKey: string, renter: any, amountCents: number, description: string, meta: Record<string, string>) {
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(stripeKey);
  return stripe.paymentIntents.create({
    amount: amountCents, currency: 'usd',
    customer: renter.stripeCustomerId, payment_method: renter.stripePaymentMethodId,
    off_session: true, confirm: true, description, metadata: meta,
  });
}

export const rentCollector = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/New_York', region: 'us-central1', secrets: [STRIPE_KEY] },
  async () => {
    const db = getFirestore();
    const todayStr = iso(new Date());
    const tenantsSnap = await db.collection('tenants').get();

    for (const tenantDoc of tenantsSnap.docs) {
      const tenantId = tenantDoc.id;
      try {
        const [leasesSnap, rentersSnap, boothsSnap] = await Promise.all([
          db.collection(`tenants/${tenantId}/leases`).get(),
          db.collection(`tenants/${tenantId}/renters`).get(),
          db.collection(`tenants/${tenantId}/booths`).get(),
        ]);
        const renters = new Map(rentersSnap.docs.map(d => [d.id, { id: d.id, ...(d.data() as any) }]));
        const booths = new Map(boothsSnap.docs.map(d => [d.id, { id: d.id, ...(d.data() as any) }]));

        // ── Phase 1: create today's invoices + first charge attempt ──
        for (const ld of leasesSnap.docs) {
          const lease = { id: ld.id, ...(ld.data() as any) };
          if (!OCCUPYING.includes(lease.status) || !lease.autoCollect) continue;
          if (!isDueToday(lease, todayStr)) continue;

          const invId = `${lease.id}_${todayStr}`;
          const invRef = db.doc(`tenants/${tenantId}/rentInvoices/${invId}`);
          if ((await invRef.get()).exists) continue;   // idempotent

          const renter: any = renters.get(lease.renterId);
          const booth: any = lease.boothId ? booths.get(lease.boothId) : null;
          const renterName = renter ? `${renter.firstName || ''} ${renter.lastName || ''}`.trim() : 'Renter';
          const inv: any = {
            id: invId, leaseId: lease.id, renterId: lease.renterId, boothId: lease.boothId || null,
            boothName: booth?.name || 'Space', renterName,
            dueDate: todayStr, amountCents: lease.rentAmountCents || 0, lateFeeCents: 0,
            status: 'due', attempts: 0, createdAt: new Date().toISOString(), tenantId,
          };
          await invRef.set(inv);

          if (renter?.cardOnFile && renter.stripeCustomerId && renter.stripePaymentMethodId && inv.amountCents > 0) {
            try {
              const intent = await chargeCard(STRIPE_KEY.value(), renter, inv.amountCents,
                `Rent — ${inv.boothName} — due ${todayStr} (${renterName})`,
                { tenantId, leaseId: lease.id, invoiceId: invId, kind: 'rent' });
              await invRef.set({ status: 'paid', paidAt: new Date().toISOString(), stripePaymentIntentId: intent.id, attempts: 1 }, { merge: true });
              await writeRentTxn(db, tenantId, inv, renterName, intent.id, true);
              await notify(db, tenantId, `💰 Rent collected: ${renterName} — ${inv.boothName} ($${(inv.amountCents / 100).toFixed(2)})`);
            } catch (err: any) {
              const msg = err?.raw?.message || err?.message || 'declined';
              await invRef.set({ attempts: 1, lastError: String(msg).slice(0, 200) }, { merge: true });
              await notify(db, tenantId, `⚠ Rent charge failed: ${renterName} — ${inv.boothName}. Card ${msg}. Grace period: ${GRACE_DAYS} days.`);
            }
          } else {
            await notify(db, tenantId, `📅 Rent due today: ${renterName} — ${inv.boothName} ($${(inv.amountCents / 100).toFixed(2)}). No card on file — collect manually or have them add one in their portal.`);
          }
        }

        // ── Phase 2: the late ladder on unpaid invoices ──
        const openInvSnap = await db.collection(`tenants/${tenantId}/rentInvoices`).where('status', 'in', ['due', 'late']).get();
        for (const invDoc of openInvSnap.docs) {
          const inv: any = { id: invDoc.id, ...(invDoc.data() as any) };
          const ageDays = Math.floor((new Date(todayStr + 'T00:00:00Z').getTime() - new Date(inv.dueDate + 'T00:00:00Z').getTime()) / DAY_MS);
          const renter: any = renters.get(inv.renterId);
          const renterName = inv.renterName || 'Renter';
          const canCharge = renter?.cardOnFile && renter.stripeCustomerId && renter.stripePaymentMethodId;
          const total = () => (inv.amountCents || 0) + (inv.lateFeeCents || 0);

          // Grace expired → late + one late fee + retry
          if (inv.status === 'due' && ageDays >= GRACE_DAYS) {
            const leaseSnap = await db.doc(`tenants/${tenantId}/leases/${inv.leaseId}`).get();
            const lateFee = Number((leaseSnap.data() as any)?.lateFeeCents) || DEFAULT_LATE_FEE_CENTS;
            inv.lateFeeCents = lateFee;
            await invDoc.ref.set({ status: 'late', lateFeeCents: lateFee, lateAt: new Date().toISOString() }, { merge: true });
            await notify(db, tenantId, `🔴 Rent LATE: ${renterName} — ${inv.boothName}. $${(lateFee / 100).toFixed(2)} late fee applied. Total owed: $${(total() / 100).toFixed(2)}.`);
            if (canCharge) {
              try {
                const intent = await chargeCard(STRIPE_KEY.value(), renter, total(),
                  `Rent + late fee — ${inv.boothName} — due ${inv.dueDate} (${renterName})`,
                  { tenantId, leaseId: inv.leaseId, invoiceId: inv.id, kind: 'rent_late' });
                await invDoc.ref.set({ status: 'paid', paidAt: new Date().toISOString(), stripePaymentIntentId: intent.id, attempts: (inv.attempts || 0) + 1 }, { merge: true });
                await writeRentTxn(db, tenantId, inv, renterName, intent.id, true);
                await notify(db, tenantId, `💰 Late rent collected: ${renterName} — $${(total() / 100).toFixed(2)} (incl. late fee)`);
              } catch { await invDoc.ref.set({ attempts: (inv.attempts || 0) + 1 }, { merge: true }); }
            }
            continue;
          }

          // Final retry + escalation
          if (inv.status === 'late' && ageDays >= FINAL_RETRY_DAYS && !inv.finalNoticeAt) {
            await invDoc.ref.set({ finalNoticeAt: new Date().toISOString() }, { merge: true });
            if (canCharge) {
              try {
                const intent = await chargeCard(STRIPE_KEY.value(), renter, total(),
                  `Rent + late fee (final) — ${inv.boothName} — due ${inv.dueDate} (${renterName})`,
                  { tenantId, leaseId: inv.leaseId, invoiceId: inv.id, kind: 'rent_final' });
                await invDoc.ref.set({ status: 'paid', paidAt: new Date().toISOString(), stripePaymentIntentId: intent.id, attempts: (inv.attempts || 0) + 1 }, { merge: true });
                await writeRentTxn(db, tenantId, inv, renterName, intent.id, true);
                await notify(db, tenantId, `💰 Late rent collected on final retry: ${renterName} — $${(total() / 100).toFixed(2)}`);
                continue;
              } catch { /* fall through to escalation */ }
            }
            await notify(db, tenantId, `🚨 ${ageDays} days late: ${renterName} — ${inv.boothName} owes $${(total() / 100).toFixed(2)}. All automatic attempts exhausted — time for a conversation. Review their lease terms for next steps.`);
          }
        }
      } catch (err) {
        console.error(`[rentCollector] tenant ${tenantId} failed`, err);
      }
    }
  }
);
