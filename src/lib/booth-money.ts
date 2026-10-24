// src/lib/booth-money.ts — A BOOTH OR DAY-RENTAL BOOKING'S CHARGES AND REFUNDS, RECORDED ONCE (server).
// The booking route (api/booths/reserve) charges an overage or an incidental to the guest's saved card, or refunds the
// booking, on the platform's own Stripe account. Each is claimed on the booking first, charged or refunded under one
// key, and recorded here, once: its lines are named after the booking (and, for an incidental, the attempt), and
// written in the same step as the booking's status.
// When Stripe's answer is lost and nobody asks again, the claim would stay open with the money maybe taken and never
// recorded: settleLostBoothMoney (the five-minute check) finds each claim left open more than 15 minutes, asks Stripe
// what happened under it, and records it, or lets it go when nothing was charged or refunded.
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';

export const safeKey = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const OPEN_AFTER_MS = 15 * 60000;     // a claim still open this long has lost its answer
const NOTHING_AFTER_MS = 2 * 3600000; // nothing at Stripe by then: it never reached Stripe
const stripeFor = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }) as any;
const iso = (n: number) => new Date(n).toISOString();
const older = (at: any, ms: number, now: number) => now - (Date.parse(String(at || '')) || now) >= ms;

/** Stripe's fee on a charge: from the charge it came back with, else asked for, else the usual US rate as an estimate,
 *  so the fee is never left out of the books. */
export async function boothFeeOf(stripe: any, intent: any, grossCents: number): Promise<{ feeCents: number; chargeId: string | null; estimated: boolean }> {
  const lc: any = intent?.latest_charge;
  let chargeId: string | null = lc ? (typeof lc === 'string' ? lc : lc.id || null) : null;
  let fee = lc && typeof lc === 'object' && lc.balance_transaction && typeof lc.balance_transaction === 'object' ? Number(lc.balance_transaction.fee) || 0 : 0;
  if (!fee && intent?.id) {
    try {
      const pi: any = await (stripe || stripeFor()).paymentIntents.retrieve(intent.id, { expand: ['latest_charge.balance_transaction'] });
      const c: any = pi?.latest_charge; fee = Number(c?.balance_transaction?.fee) || 0; chargeId = chargeId || c?.id || null;
    } catch { /* estimated below */ }
  }
  if (!fee && grossCents > 0) return { feeCents: Math.round(grossCents * 0.029) + 30, chargeId, estimated: true };
  return { feeCents: fee, chargeId, estimated: false };
}

/** The overage charged: its line, its fee and the booking's status, once. */
export async function recordBoothOverage(db: any, tenantId: string, reservationId: string, r: any, intent: any, cents: number, o: { stripe?: any; at?: string } = {}) {
  const at = o.at || new Date().toISOString();
  const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
  const { feeCents, chargeId, estimated } = await boothFeeOf(o.stripe, intent, cents).catch(() => ({ feeCents: 0, chargeId: null, estimated: false }));
  const txnRef = db.doc(`tenants/${tenantId}/transactions/boothover_${safeKey(reservationId)}`);
  const feeRef = db.doc(`tenants/${tenantId}/transactions/boothoverfee_${safeKey(reservationId)}`);
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(resRef)).data() || {};
    if (cur.overageStatus === 'charged') return false;
    tx.set(txnRef, {
      id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
      source: 'booth_rent',
      amount: cents / 100, category: 'Booth Rent',
      description: `Overage — ${r.boothName || 'Space'} — ${r.name} (+${r.overageMinutes} min)`,
      clientOrVendor: r.name || 'Day renter', date: at, paymentMethod: 'Card on file (Stripe)',
      hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: reservationId, tenantId, createdAt: at,
    });
    // Paired Stripe processing-fee expense.
    if (feeCents > 0) tx.set(feeRef, {
      id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
      amount: feeCents / 100, category: 'Processing Fee', estimated,
      description: `Stripe fee${estimated ? ' (est.)' : ''} — overage — ${r.boothName || 'Space'} (${r.name})`,
      clientOrVendor: 'Stripe', date: at, paymentMethod: 'Deducted from payout',
      hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
      sourceId: reservationId, relatedTxnId: txnRef.id, tenantId, createdAt: at,
    });
    tx.set(resRef, { overageStatus: 'charged', overageChargedAt: at, overageChargedCents: cents, overagePaymentIntentId: intent.id, overageClaimAt: null, overageClaimPm: null }, { merge: true });
    return true;
  });
}

/** An incidental charged: its line, its fee, the booking's incidentals and the attempt, once. */
export async function recordBoothIncidental(db: any, tenantId: string, reservationId: string, r: any, key: string, intent: any, amountCents: number, description: string, o: { stripe?: any; at?: string } = {}) {
  const at = o.at || new Date().toISOString();
  const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
  const attemptRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}/charges/inc_${key}`);
  const fee = await boothFeeOf(o.stripe, intent, amountCents).catch(() => ({ feeCents: 0, chargeId: null, estimated: false }));
  const txnRef = db.doc(`tenants/${tenantId}/transactions/boothinc_${safeKey(reservationId)}_${key}`);
  const feeRef = db.doc(`tenants/${tenantId}/transactions/boothincfee_${safeKey(reservationId)}_${key}`);
  return db.runTransaction(async (tx: any) => {
    const a: any = (await tx.get(attemptRef)).data() || {};
    if (a.status === 'charged') return false;
    tx.set(txnRef, {
      id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
      amount: amountCents / 100, category: 'Renter Incidental',
      description: `Incidental — ${r.boothName || 'Space'} — ${r.name}: ${description}`,
      clientOrVendor: r.name || 'Day renter', date: at, paymentMethod: 'Card on file (Stripe)',
      hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: reservationId, tenantId, createdAt: at,
    });
    if (fee.feeCents > 0) tx.set(feeRef, {
      id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
      amount: fee.feeCents / 100, category: 'Processing Fee', estimated: fee.estimated,
      description: `Stripe fee${fee.estimated ? ' (est.)' : ''} — incidental — ${r.boothName || 'Space'} (${r.name})`,
      clientOrVendor: 'Stripe', date: at, paymentMethod: 'Deducted from payout',
      hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: fee.chargeId,
      sourceId: reservationId, relatedTxnId: txnRef.id, tenantId, createdAt: at,
    });
    tx.set(resRef, { incidentals: FieldValue.arrayUnion({ amountCents, description, at, paymentIntentId: intent.id }), incidentalsTotalCents: FieldValue.increment(amountCents) }, { merge: true });
    tx.set(attemptRef, { status: 'charged', chargedAt: at, paymentIntentId: intent.id }, { merge: true });
    return true;
  });
}

/** The booking refunded: its line and its status, once. */
export async function recordBoothRefund(db: any, tenantId: string, reservationId: string, r: any, refund: any, refundCents: number, pi: string, reason: string | null, o: { at?: string } = {}) {
  const at = o.at || new Date().toISOString();
  const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
  const txnRef = db.doc(`tenants/${tenantId}/transactions/boothrefund_${safeKey(reservationId)}`);
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(resRef)).data() || {};
    if (cur.status === 'refunded') return false;
    tx.set(txnRef, {
      id: txnRef.id, type: 'reversal', context: 'Business', taxBucket: 'refund',
      source: 'booth_rent',
      amount: refundCents / 100, category: 'Refunds',
      description: `Refund — ${r.boothName || 'Space'} — ${r.name || 'guest'}${reason ? ` (${String(reason).slice(0, 120)})` : ''}`,
      clientOrVendor: r.name || 'Day renter', date: at, paymentMethod: 'Card (Stripe refund)',
      hasReceipt: false, stripePaymentIntentId: pi, stripeRefundId: refund.id,
      sourceId: reservationId, tenantId, createdAt: at,
    });
    tx.set(resRef, {
      status: 'refunded', refundedAt: at,
      refundedCents: refundCents, stripeRefundId: refund.id,
      refundReason: reason ? String(reason).slice(0, 300) : null,
      refundClaimAt: null, refundClaimCents: null,
    }, { merge: true });
    return true;
  });
}

export type LostBoothCounts = { checked: number; recorded: number; released: number; waiting: number };

/** The payments made on a guest's card since a claim began (platform account). */
async function paymentsSince(stripe: any, customer: string, at: string): Promise<any[] | null> {
  try {
    const since = Math.floor((Date.parse(at) || Date.now()) / 1000) - 3600;
    const l: any = await stripe.paymentIntents.list({ customer, created: { gte: since }, limit: 100 });
    return Array.isArray(l?.data) ? l.data : [];
  } catch { return null; }
}

/** Let a claim go in one step, only while it's still the one this run took over. False when it wasn't. */
async function letGo(db: any, ref: any, still: (d: any) => boolean, patch: Record<string, any>): Promise<boolean> {
  return db.runTransaction(async (tx: any) => {
    const d: any = (await tx.get(ref)).data() || null;
    if (!d || !still(d)) return false;
    tx.set(ref, patch, { merge: true }); return true;
  }).catch(() => false);
}

/** Take a claim over in one step, so two runs of the check at once settle it once. */
async function takeOver(db: any, ref: any, field: string, isOpen: (d: any) => boolean, now: number) {
  return db.runTransaction(async (tx: any) => {
    const d: any = (await tx.get(ref)).data() || null;
    if (!d || !isOpen(d)) return null;
    if (d[field] && now - (Date.parse(String(d[field])) || 0) < 5 * 60000) return null;
    tx.set(ref, { [field]: iso(now) }, { merge: true });
    return d;
  }).catch(() => null);
}

/** The five-minute check for booth bookings: overages, incidentals and refunds whose answer was lost (see the top). */
export async function settleLostBoothMoney(db: any, tenantId: string, _tenant: any, o: { stripe?: any; now?: number } = {}): Promise<LostBoothCounts> {
  const out: LostBoothCounts = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const now = o.now ?? Date.now(); const stripe = o.stripe || stripeFor();
  const col = db.collection(`tenants/${tenantId}/boothReservations`);
  const tally = (r: 'recorded' | 'released' | 'waiting') => { out[r]++; };

  // ── Overages: claimed ('charging') and never recorded ──
  const charging = (await col.where('overageStatus', '==', 'charging').limit(50).get().catch(() => ({ docs: [] as any[] }))).docs;
  for (const d of charging) {
    const r0: any = d.data() || {};
    if (!older(r0.overageClaimAt, OPEN_AFTER_MS, now)) continue;
    const r: any = await takeOver(db, d.ref, 'overageSettlingAt', (x) => x.overageStatus === 'charging', now);
    if (!r) continue;
    out.checked++;
    const list = r.stripeCustomerId ? await paymentsSince(stripe, String(r.stripeCustomerId), String(r.overageClaimAt || '')) : [];
    if (list === null) { await d.ref.set({ overageSettlingAt: null }, { merge: true }); tally('waiting'); continue; }
    const pi = list.find((p: any) => p?.metadata?.kind === 'booth_overage' && String(p?.metadata?.reservationId || '') === d.id && Number(p.amount) === Number(r.overageClaimCents));
    if (pi?.status === 'succeeded') { await recordBoothOverage(db, tenantId, d.id, r, pi, Number(r.overageClaimCents) || Number(pi.amount) || 0, { stripe, at: iso(now) }); await d.ref.set({ overageSettlingAt: null }, { merge: true }); tally('recorded'); continue; }
    if (pi?.status === 'processing' || (!pi && !older(r.overageClaimAt, NOTHING_AFTER_MS, now))) { await d.ref.set({ overageSettlingAt: null }, { merge: true }); tally('waiting'); continue; }
    // Declined, or never reached Stripe: still due, for the desk to charge again or collect in person (only if nobody
    // asked again meanwhile; then that request finishes it).
    const let1 = await letGo(db, d.ref, (x) => x.overageStatus === 'charging' && String(x.overageClaimAt || '') === String(r.overageClaimAt || '') && x.overageSettlingAt === iso(now),
      { overageStatus: 'due', overageClaimAt: null, overageClaimCents: null, overageClaimPm: null, overageSettlingAt: null });
    tally(let1 ? 'released' : 'waiting');
  }

  // ── Incidentals: an attempt left 'charging' (the booking says one is open) ──
  const withOpen = (await col.where('incidentalOpenAt', '>', '').limit(50).get().catch(() => ({ docs: [] as any[] }))).docs;
  for (const d of withOpen) {
    const r: any = d.data() || {};
    const q: any = await d.ref.collection('charges').where('status', '==', 'charging').get().catch(() => null);
    if (!q) continue;   // couldn't look: the booking keeps its mark for the next run
    const attempts = q.docs;
    let stillOpen = false;
    for (const a0 of attempts) {
      const at0: any = a0.data() || {};
      if (!older(at0.claimAt, OPEN_AFTER_MS, now)) { stillOpen = true; continue; }
      const a: any = await takeOver(db, a0.ref, 'settlingAt', (x) => x.status === 'charging', now);
      if (!a) { stillOpen = true; continue; }
      out.checked++;
      const key = String(a0.id).replace(/^inc_/, '');
      const list = r.stripeCustomerId ? await paymentsSince(stripe, String(r.stripeCustomerId), String(a.claimAt || '')) : [];
      if (list === null) { await a0.ref.set({ settlingAt: null }, { merge: true }); stillOpen = true; tally('waiting'); continue; }
      const pi = list.find((p: any) => p?.metadata?.kind === 'booth_incidental' && String(p?.metadata?.reservationId || '') === d.id && String(p?.metadata?.attempt || '') === key);
      if (pi?.status === 'succeeded') { await recordBoothIncidental(db, tenantId, d.id, r, key, pi, Number(a.amountCents) || Number(pi.amount) || 0, String(a.description || 'Incidental'), { stripe, at: iso(now) }); tally('recorded'); continue; }
      if (pi?.status === 'processing' || (!pi && !older(a.claimAt, NOTHING_AFTER_MS, now))) { await a0.ref.set({ settlingAt: null }, { merge: true }); stillOpen = true; tally('waiting'); continue; }
      const let2 = await letGo(db, a0.ref, (x) => x.status === 'charging' && String(x.claimAt || '') === String(a.claimAt || '') && x.settlingAt === iso(now),
        { status: 'failed', failedAt: iso(now), error: pi ? `Charge ${pi.status}` : 'It never reached Stripe.', settlingAt: null });
      if (!let2) stillOpen = true;
      tally(let2 ? 'released' : 'waiting');
    }
    // The mark comes off only when nothing is open AND no incidental was claimed meanwhile (a new claim sets it again).
    if (!stillOpen) await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(d.ref)).data() || {};
      if (String(cur.incidentalOpenAt || '') === String(r.incidentalOpenAt || '')) tx.set(d.ref, { incidentalOpenAt: null }, { merge: true });
    }).catch(() => {});
  }

  // ── Refunds: claimed and never recorded ──
  const refunding = (await col.where('refundClaimAt', '>', '').limit(50).get().catch(() => ({ docs: [] as any[] }))).docs;
  for (const d of refunding) {
    const r0: any = d.data() || {};
    if (r0.status === 'refunded' || !older(r0.refundClaimAt, OPEN_AFTER_MS, now)) continue;
    const r: any = await takeOver(db, d.ref, 'refundSettlingAt', (x) => !!x.refundClaimAt && x.status !== 'refunded', now);
    if (!r) continue;
    out.checked++;
    let refund: any = null; let asked = true;
    try {
      const l: any = await stripe.refunds.list({ payment_intent: String(r.stripePaymentIntentId), limit: 100 });
      refund = (Array.isArray(l?.data) ? l.data : []).find((x: any) => x?.metadata?.reservationId === d.id && x?.metadata?.kind === 'booth_refund' && !['failed', 'canceled'].includes(String(x.status || ''))) || null;
    } catch { asked = false; }
    if (!asked || (!refund && !older(r.refundClaimAt, NOTHING_AFTER_MS, now))) { await d.ref.set({ refundSettlingAt: null }, { merge: true }); tally('waiting'); continue; }
    if (refund) { await recordBoothRefund(db, tenantId, d.id, r, refund, Number(refund.amount) || Number(r.refundClaimCents) || 0, String(r.stripePaymentIntentId), r.refundReason || null, { at: iso(now) }); await d.ref.set({ refundSettlingAt: null }, { merge: true }); tally('recorded'); continue; }
    // Never reached Stripe: the claim comes off, and the booking can be refunded again (only if nobody asked again
    // meanwhile).
    const let3 = await letGo(db, d.ref, (x) => String(x.refundClaimAt || '') === String(r.refundClaimAt || '') && x.refundSettlingAt === iso(now) && x.status !== 'refunded',
      { refundClaimAt: null, refundClaimCents: null, refundSettlingAt: null });
    tally(let3 ? 'released' : 'waiting');
  }
  return out;
}
