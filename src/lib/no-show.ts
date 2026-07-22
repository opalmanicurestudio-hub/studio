// src/lib/no-show.ts
//
// Nightly no-show sweep for day/hourly booth reservations.
//
// Trigger (deliberately conservative): a reservation that was CONFIRMED (paid)
// but never checked in, whose booked end date is strictly in the past (UTC), is
// swept to 'no_show'. Because the nightly cron runs in the small hours, "endDate
// < today (UTC)" means the whole booked day is over everywhere in the US before
// anyone is flagged — so a late arrival or an hourly wall-clock/timezone quirk
// can never trip it. A booking is only ever a no-show once its window is fully,
// unambiguously gone.
//
// Fee (owner-controlled, default OFF): tenants/{id}.noShowPolicy = { enabled,
// feeCents }. When enabled with a fee AND a card is on file, the fee is charged
// off-session and booked to the ledger with its paired Stripe fee. When it's not
// enabled, or there's no card, the reservation is simply flagged for follow-up —
// money never moves silently.
//
// Non-punitive by design: a declined card is recorded and surfaced so the owner
// can collect another way. It NEVER bans, suspends, or blocks the renter — the
// same posture as overage and incidental charges.

import Stripe from 'stripe';
import { logAuditAdmin } from './audit';

type Db = any;

export interface NoShowCounts {
  swept: number;          // reservations marked no_show
  feesCharged: number;    // fees successfully charged
  feesDeclined: number;   // policy on, card on file, but charge failed
  feesNoCard: number;     // policy on, fee set, but no card on file
  feeCentsCharged: number;
}

const DAY_MS = 86400000;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// Self-contained fee resolver for an off-session charge. Off-session charges
// settle in the same request, so the balance-transaction fee may not be
// readable yet — try the expanded intent, then a re-fetch, then fall back to the
// US-standard estimate (2.9% + $0.30) so the processing-fee expense is never
// silently dropped. Mirrors the reserve route's resolveFeeCents.
async function resolveFeeCents(stripe: Stripe, intent: any, grossCents: number): Promise<{ feeCents: number; chargeId: string | null; estimated: boolean }> {
  const charge: any = intent?.latest_charge;
  let chargeId: string | null = (charge && typeof charge === 'object') ? (charge.id || null) : (typeof charge === 'string' ? charge : null);
  const bt: any = (charge && typeof charge === 'object') ? charge.balance_transaction : null;
  let fee = (bt && typeof bt === 'object') ? (Number(bt.fee) || 0) : 0;
  if (!fee && intent?.id) {
    try {
      const pi: any = await stripe.paymentIntents.retrieve(intent.id, { expand: ['latest_charge.balance_transaction'] });
      const c2: any = pi?.latest_charge;
      chargeId = chargeId || (c2?.id || null);
      fee = Number(c2?.balance_transaction?.fee) || 0;
    } catch { /* fall through to estimate */ }
  }
  if (!fee && grossCents > 0) return { feeCents: Math.round(grossCents * 0.029) + 30, chargeId, estimated: true };
  return { feeCents: fee, chargeId, estimated: false };
}

async function notifyOwner(db: Db, tenantId: string, message: string) {
  const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
  await ref.set({
    id: ref.id, userId: null, read: false, createdAt: new Date().toISOString(),
    type: 'booth_no_show', link: '/booths', message,
  });
}

/**
 * Sweep one tenant's reservations for no-shows. Returns per-category counts.
 * Every reservation is handled in its own try/catch so one failure can't stop
 * the rest, and the whole thing is safe to re-run (a no_show is never reprocessed).
 */
export async function sweepNoShows(db: Db, tenantId: string, now: Date = new Date()): Promise<NoShowCounts> {
  const counts: NoShowCounts = { swept: 0, feesCharged: 0, feesDeclined: 0, feesNoCard: 0, feeCentsCharged: 0 };
  const todayStr = now.toISOString().slice(0, 10);

  // Owner policy — default OFF (flag only), fee 0.
  let policyEnabled = false;
  let feeCents = 0;
  try {
    const t = (await db.doc(`tenants/${tenantId}`).get()).data() as any;
    const p = t?.noShowPolicy || {};
    policyEnabled = !!p.enabled;
    feeCents = Math.max(0, Math.round(Number(p.feeCents) || 0));
  } catch { /* no tenant doc → treat as flag-only */ }

  // Confirmed-but-not-checked-in reservations only. (checked_in / completed /
  // cancelled / refunded / pending_payment / conflict are all excluded by the
  // equality filter, and an already-swept no_show can never match.)
  let snap: any;
  try {
    snap = await db.collection(`tenants/${tenantId}/boothReservations`)
      .where('status', '==', 'confirmed').get();
  } catch {
    return counts; // no reservations / query failed
  }

  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY as string) : null;

  for (const doc of snap.docs) {
    try {
      const r = doc.data() as any;
      // Elapsed only when the booked end date is strictly before today (UTC).
      const endDate = String(r.endDate || r.startDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
      if (!(endDate < todayStr)) continue;
      if (r.checked_inAt) continue; // safety: never flag someone who checked in

      const nowIso = now.toISOString();
      const name = r.name || 'Guest';
      const boothName = r.boothName || 'a space';
      const when = r.startDate && r.endDate && r.startDate !== r.endDate ? `${r.startDate} → ${r.endDate}` : endDate;

      // Base flag — always applied.
      const update: any = { status: 'no_show', noShowAt: nowIso, noShowSweptBy: 'cron' };

      const hasCard = !!(r.stripeCustomerId && r.stripePaymentMethodId);
      let feeMsg = '';

      if (policyEnabled && feeCents > 0 && hasCard && stripe) {
        let intent: any = null;
        try {
          intent = await stripe.paymentIntents.create({
            amount: feeCents, currency: 'usd',
            customer: r.stripeCustomerId, payment_method: r.stripePaymentMethodId,
            off_session: true, confirm: true,
            expand: ['latest_charge.balance_transaction'],
            description: `No-show fee — ${boothName} — ${name} (${when})`,
            metadata: { tenantId, reservationId: doc.id, kind: 'booth_no_show_fee' },
          });
        } catch (err: any) {
          intent = null;
          update.noShowFeeStatus = 'declined';
          update.noShowFeeError = String(err?.raw?.message || err?.message || 'Card declined').slice(0, 160);
          counts.feesDeclined++;
          feeMsg = ` Fee ${money(feeCents)} could not be charged (card declined) — collect another way.`;
        }
        if (intent) {
          const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
          await txnRef.set({
            id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
            amount: feeCents / 100, category: 'No-show Fee',
            description: `No-show fee — ${boothName} — ${name} (${when})`,
            clientOrVendor: name, date: nowIso, paymentMethod: 'Card on file (Stripe)',
            hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: doc.id, tenantId, createdAt: nowIso,
          });
          try {
            const { feeCents: procFee, chargeId, estimated } = await resolveFeeCents(stripe, intent, feeCents);
            if (procFee > 0) {
              const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
              await feeRef.set({
                id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
                amount: procFee / 100, category: 'Processing Fee', estimated,
                description: `Stripe fee${estimated ? ' (est.)' : ''} — no-show fee — ${boothName} (${name})`,
                clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
                hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
                sourceId: doc.id, relatedTxnId: txnRef.id, tenantId, createdAt: nowIso,
              });
            }
          } catch { /* fee accounting is best-effort */ }
          update.noShowFeeStatus = 'charged';
          update.noShowFeeChargedCents = feeCents;
          update.noShowFeePaymentIntentId = intent.id;
          counts.feesCharged++;
          counts.feeCentsCharged += feeCents;
          feeMsg = ` A ${money(feeCents)} no-show fee was charged to the card on file.`;
        }
      } else if (policyEnabled && feeCents > 0 && !hasCard) {
        update.noShowFeeStatus = 'no_card';
        counts.feesNoCard++;
        feeMsg = ` No card on file — collect the ${money(feeCents)} no-show fee in person if you charge one.`;
      }

      await doc.ref.set(update, { merge: true });
      counts.swept++;

      await notifyOwner(db, tenantId, `No-show: ${name} didn't check in for ${boothName} (${when}).${feeMsg}`);
      await logAuditAdmin(db, tenantId, {
        action: 'booth.no_show', targetType: 'boothReservation', targetId: doc.id,
        summary: `No-show — ${name} · ${boothName} (${when})${feeMsg}`,
        amount: update.noShowFeeStatus === 'charged' ? feeCents / 100 : undefined,
        actor: { type: 'system', name: 'no-show-sweep' },
      });
    } catch { /* skip this reservation */ }
  }

  return counts;
}
