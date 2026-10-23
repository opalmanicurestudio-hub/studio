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
// Once per booking, however often the sweep runs (a repeated nightly run, or a
// manual run while the first is still going):
//   1. claimed: the booking is marked as being charged in one step, with the amount
//      and card it's for, so a second run at the same moment leaves it alone;
//   2. charged under one key for this booking, amount and card, so asking Stripe
//      again sends the same charge, never a second;
//   3. recorded: the fee's line in the books (named after the booking) and the
//      no-show mark are written together, in one step.
// No answer from Stripe (it may have gone through) leaves the claim in place and
// the booking as it was: the next run looks for that charge at Stripe and records
// it, or sends the same charge again. It is never treated as a decline.
//
// Non-punitive by design: a declined card is recorded and surfaced so the owner
// can collect another way. It NEVER bans, suspends, or blocks the renter — the
// same posture as overage and incidental charges.

import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { logAuditAdmin } from './audit';

type Db = any;

export interface NoShowCounts {
  swept: number;          // reservations marked no_show
  feesCharged: number;    // fees successfully charged
  feesDeclined: number;   // policy on, card on file, but charge failed
  feesNoCard: number;     // policy on, fee set, but no card on file
  feeCentsCharged: number;
  feesPending: number;    // charged, but Stripe didn't answer — finished on the next run
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
// A claim older than this belongs to a run that stopped; the next run finishes it (the same charge).
const CLAIM_MS = 2 * 60000;
const freshClaim = (at: any) => !!at && Date.now() - (Date.parse(String(at)) || 0) < CLAIM_MS;
const safeKey = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
// Stripe said no (nothing moved) — as against no answer at all (it may have gone through).
const stripeRefused = (e: any) => ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'].includes(String(e?.type || ''));

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

// Named after the booking, so a second run can't tell the owner twice.
async function notifyOwner(db: Db, tenantId: string, reservationId: string, message: string) {
  const ref = db.doc(`tenants/${tenantId}/notifications/noshow_${safeKey(reservationId)}`);
  await ref.set({
    id: ref.id, userId: null, read: false, createdAt: new Date().toISOString(),
    type: 'booth_no_show', link: '/pos?tab=spaces', message,
  });
}

type Settled = { fee: 'charged' | 'declined' | 'no_card' | 'flag'; cents: number; msg: string; name: string; boothName: string; when: string } | { fee: 'pending' } | null;

/** One booking: claimed, charged (when the policy says so) and recorded, once. Null when there's nothing to do. */
async function settleOne(db: Db, tenantId: string, ref: any, o: { todayStr: string; nowIso: string; policyEnabled: boolean; feeCents: number; stripe: Stripe | null }): Promise<Settled> {
  const id = String(ref.id);
  const claimAt = new Date().toISOString();

  // 1. The claim, read fresh: only a booking still confirmed, never checked in, and fully past.
  const claim: any = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); const r: any = s.exists ? s.data() || {} : null;
    if (!r || r.status !== 'confirmed' || r.checked_inAt) return null;
    const endDate = String(r.endDate || r.startDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !(endDate < o.todayStr)) return null;
    if (freshClaim(r.noShowClaimAt)) return null;   // another run is charging it right now
    const name = r.name || 'Guest';
    const boothName = r.boothName || 'a space';
    const when = r.startDate && r.endDate && r.startDate !== r.endDate ? `${r.startDate} → ${r.endDate}` : endDate;
    const base = { r, name, boothName, when };
    // An earlier run that got no answer from Stripe: the same charge again (its amount, card and wording).
    if (r.noShowClaimAt && Number(r.noShowClaimCents) > 0) {
      tx.set(ref, { noShowClaimAt: claimAt }, { merge: true });
      return { ...base, mode: 'charge', retry: true, cents: Number(r.noShowClaimCents), pm: String(r.noShowClaimPm || ''), customer: String(r.noShowClaimCustomer || r.stripeCustomerId || ''),
        desc: String(r.noShowClaimDesc || `No-show fee — ${boothName} — ${name} (${when})`) };
    }
    const hasCard = !!(r.stripeCustomerId && r.stripePaymentMethodId);
    if (o.policyEnabled && o.feeCents > 0 && hasCard && o.stripe) {
      const desc = `No-show fee — ${boothName} — ${name} (${when})`;
      tx.set(ref, { noShowClaimAt: claimAt, noShowClaimCents: o.feeCents, noShowClaimPm: r.stripePaymentMethodId, noShowClaimCustomer: r.stripeCustomerId, noShowClaimDesc: desc }, { merge: true });
      return { ...base, mode: 'charge', retry: false, cents: o.feeCents, pm: String(r.stripePaymentMethodId), customer: String(r.stripeCustomerId), desc };
    }
    return { ...base, mode: o.policyEnabled && o.feeCents > 0 ? 'no_card' : 'flag', cents: o.feeCents };
  });
  if (!claim) return null;
  const { name, boothName, when } = claim;
  const cents = Number(claim.cents) || 0;

  // 2. The charge: one key for this booking, amount and card.
  let intent: any = null; let declined: { error: string; code: string | null } | null = null;
  if (claim.mode === 'charge') {
    const stripe = o.stripe;
    if (!stripe) return { fee: 'pending' };
    // The last run got no answer: if Stripe has that charge, it's the one (recorded, never sent again).
    if (claim.retry && claim.customer) {
      try {
        const l: any = await stripe.paymentIntents.list({ customer: claim.customer, limit: 20 });
        intent = (Array.isArray(l?.data) ? l.data : []).find((x: any) => x?.metadata?.reservationId === id && x?.metadata?.kind === 'booth_no_show_fee' && x?.status === 'succeeded') || null;
      } catch { /* asked for below, under the booking's own key */ }
    }
    if (!intent) {
      try {
        intent = await stripe.paymentIntents.create({
          amount: cents, currency: 'usd',
          customer: claim.customer, payment_method: claim.pm,
          off_session: true, confirm: true,
          expand: ['latest_charge.balance_transaction'],
          description: claim.desc,
          metadata: { tenantId, reservationId: id, kind: 'booth_no_show_fee' },
        }, { idempotencyKey: `noshow_${safeKey(id)}_${cents}_${safeKey(claim.pm)}` });
      } catch (err: any) {
        // No answer: it may have gone through, so the claim stays and the next run finishes it.
        if (!stripeRefused(err)) return { fee: 'pending' };
        declined = { error: String(err?.raw?.message || err?.message || 'Card declined').slice(0, 160), code: err?.decline_code || err?.raw?.decline_code || null };
        intent = null;
      }
    }
    if (intent && intent.status !== 'succeeded') {
      if (!['requires_payment_method', 'canceled', 'requires_action'].includes(String(intent.status))) return { fee: 'pending' };   // still going through
      declined = { error: `The charge didn’t complete (${intent.status}).`, code: null };
      intent = null;
    }
  }

  const T = `tenants/${tenantId}`;
  const clearClaim = { noShowClaimAt: null, noShowClaimCents: null, noShowClaimPm: null, noShowClaimCustomer: null, noShowClaimDesc: null };

  // 3a. Charged: the fee's line (named after the booking), its Stripe fee, and the no-show mark, in one step.
  if (intent) {
    const { feeCents: procFee, chargeId, estimated } = await resolveFeeCents(o.stripe as Stripe, intent, cents).catch(() => ({ feeCents: 0, chargeId: null, estimated: false }));
    const txnRef = db.doc(`${T}/transactions/noshow_${safeKey(id)}`);
    const feeRef = db.doc(`${T}/transactions/noshowfee_${safeKey(id)}`);
    const wrote = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      const line = await tx.get(txnRef);
      if (line.exists || cur.noShowFeeStatus === 'charged') return false;
      tx.set(txnRef, {
        id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
        amount: cents / 100, category: 'No-show Fee',
        description: `No-show fee — ${boothName} — ${name} (${when})`,
        clientOrVendor: name, date: o.nowIso, paymentMethod: 'Card on file (Stripe)',
        hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: id, tenantId, createdAt: o.nowIso,
      });
      if (procFee > 0) tx.set(feeRef, {
        id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
        amount: procFee / 100, category: 'Processing Fee', estimated,
        description: `Stripe fee${estimated ? ' (est.)' : ''} — no-show fee — ${boothName} (${name})`,
        clientOrVendor: 'Stripe', date: o.nowIso, paymentMethod: 'Deducted from payout',
        hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
        sourceId: id, relatedTxnId: txnRef.id, tenantId, createdAt: o.nowIso,
      });
      // The money moved, so it's recorded whatever happened meanwhile; the booking becomes a no-show only if it still is one.
      tx.set(ref, { ...(cur.status === 'confirmed' ? { status: 'no_show', noShowAt: o.nowIso, noShowSweptBy: 'cron' } : {}),
        noShowFeeStatus: 'charged', noShowFeeChargedCents: cents, noShowFeePaymentIntentId: intent.id, ...clearClaim }, { merge: true });
      return true;
    });
    if (!wrote) return null;
    return { fee: 'charged', cents, name, boothName, when, msg: ` A ${money(cents)} missed reservation fee has been charged to the card on file.` };
  }

  // 3b. Declined, no card, or flag only: the no-show mark and (when a fee is owed) the fee on their account, in one
  //     step. A declined fee is still owed: it lands on the renter's balance like any other debt, once (its id is on
  //     their list of owed fees), so it's visible at the next booking and the next checkout.
  const owe = claim.mode === 'no_card' || !!declined;
  const clientId = owe ? String(claim.r.clientId || claim.r.renterId || '') : '';
  const clientRef = /^[^/]{1,200}$/.test(clientId) ? db.doc(`${T}/clients/${clientId}`) : null;
  const feeId = `no_show-${id}`;
  const done: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const c = clientRef ? await tx.get(clientRef) : null;
    if (cur.status !== 'confirmed' || cur.checked_inAt) return null;   // recorded by another run
    if (!declined && freshClaim(cur.noShowClaimAt)) return null;
    const listed = !!c?.exists && (Array.isArray((c.data() || {}).unpaidFees) ? c.data().unpaidFees : []).some((f: any) => f?.feeId === feeId);
    const addNow = owe && !!c?.exists && !listed && cents > 0;
    if (addNow) tx.update(clientRef, {
      outstandingBalance: FieldValue.increment(cents / 100),
      unpaidFees: FieldValue.arrayUnion({ feeId, appointmentId: id, appointmentDate: o.nowIso, feeAmount: cents / 100,
        reason: declined ? `No-show fee — ${boothName} (${when})` : `No-show fee — ${boothName} (${when}) — no card on file` }),
    });
    const owing = addNow || listed;
    tx.set(ref, {
      status: 'no_show', noShowAt: o.nowIso, noShowSweptBy: 'cron',
      ...(declined ? { noShowFeeStatus: 'declined', noShowFeeError: declined.error, noShowFeeDeclineCode: declined.code } : claim.mode === 'no_card' ? { noShowFeeStatus: 'no_card' } : {}),
      ...(owing ? { noShowFeeArrearsCents: cents } : {}),
      ...clearClaim,
    }, { merge: true });
    return { owing };
  });
  if (!done) return null;
  if (declined) return { fee: 'declined', cents, name, boothName, when, msg: done.owing
    ? ` The ${money(cents)} fee could not be charged and has been recorded as owing on their account.`
    : ` The ${money(cents)} fee could not be charged because the card was declined. Please collect it another way.` };
  if (claim.mode === 'no_card') return { fee: 'no_card', cents, name, boothName, when, msg: done.owing
    ? ` There is no card on file, so the ${money(cents)} fee has been recorded as owing on their account.`
    : ` There is no card on file, so the ${money(cents)} fee could not be charged. Please collect it another way.` };
  return { fee: 'flag', cents: 0, name, boothName, when, msg: '' };
}

/**
 * Sweep one tenant's reservations for no-shows. Returns per-category counts.
 * Every reservation is handled in its own try/catch so one failure can't stop
 * the rest, and the whole thing is safe to re-run, or to run twice at once:
 * each booking is settled once (see the header).
 */
export async function sweepNoShows(db: Db, tenantId: string, now: Date = new Date()): Promise<NoShowCounts> {
  const counts: NoShowCounts = { swept: 0, feesCharged: 0, feesDeclined: 0, feesNoCard: 0, feeCentsCharged: 0, feesPending: 0 };
  const todayStr = now.toISOString().slice(0, 10);
  const nowIso = now.toISOString();

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
  // equality filter, and an already-swept no_show can never match.) Each one is
  // read again, on its own, before anything happens to it.
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

      const s = await settleOne(db, tenantId, doc.ref, { todayStr, nowIso, policyEnabled, feeCents, stripe });
      if (!s) continue;
      if (s.fee === 'pending') { counts.feesPending++; continue; }
      counts.swept++;
      if (s.fee === 'charged') { counts.feesCharged++; counts.feeCentsCharged += s.cents; }
      else if (s.fee === 'declined') counts.feesDeclined++;
      else if (s.fee === 'no_card') counts.feesNoCard++;

      await notifyOwner(db, tenantId, doc.id, `Missed reservation: ${s.name} did not check in for ${s.boothName} (${s.when}).${s.msg}`);
      await logAuditAdmin(db, tenantId, {
        action: 'booth.no_show', targetType: 'boothReservation', targetId: doc.id,
        summary: `Missed reservation: ${s.name}, ${s.boothName} (${s.when}).${s.msg}`,
        amount: s.fee === 'charged' ? s.cents / 100 : undefined,
        actor: { type: 'system', name: 'no-show-sweep' },
      });
    } catch { /* skip this reservation */ }
  }

  return counts;
}
