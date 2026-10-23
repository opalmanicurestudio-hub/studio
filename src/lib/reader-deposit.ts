// src/lib/reader-deposit.ts — A DEPOSIT TAKEN ON THE SHOP'S CARD READER IS RECORDED BY THE SERVER, AS IT'S CAPTURED.
// The reader's payment names its booking (api/stripe/terminal/create-payment-intent, kind 'deposit'), and its amount is
// the booking's own deposit plus any balance collected with it, worked out here from the booking, never by the screen.
// It's recorded once, by the payment (lib/deposit-record): the booking marked paid, its credit, its Retainers income
// line, and a balance taken with it as the fee payment it is. Whichever comes first records it, so a lost connection
// can't leave a charged card unrecorded:
//   1. the capture itself (api/stripe/terminal/capture-payment-intent)
//   2. the booking screen asking right after (api/appointments/desk-deposit, reader)
//   3. the desk taking the deposit another way, or charging the saved card, while a reader payment is waiting
//   4. the unpaid-hold sweep, before it would let the time go (lib/release-unpaid)
// A deposit paid another way meanwhile keeps both payments; the booking is flagged and the desk is told. Server only.
import Stripe from 'stripe';
import { balanceDueWith } from '@/lib/balance-with-deposit';
import { recordCardDepositSafely } from '@/lib/deposit-record';
import { tellDepositClient } from '@/lib/deposit-notify';
import { logAuditAdmin } from '@/lib/audit';

const c0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export type ReaderDepositResult =
  | { ok: true; already: boolean; paidTwice: boolean; status: string; released: boolean; depositCents: number; chargedCents: number }
  | { ok: false; error: string; status: number; code?: string };

/** What the card reader takes for a booking's deposit: the deposit, and a balance collected with it (lib/balance-with-deposit). */
export function readerDepositAmount(ap: any): { depositCents: number; balanceCents: number; totalCents: number } {
  const depositCents = c0(ap?.depositAmountCents);
  const balanceCents = depositCents > 0 ? balanceDueWith(ap) : 0;
  return { depositCents, balanceCents, totalCents: depositCents + balanceCents };
}

/** The deposit's income line, the same shape the desk and card deposits have. */
export function depositIncomeLine(ap: any, appointmentId: string, cents: number, method: string, more: Record<string, any> = {}) {
  return {
    description: `Deposit — ${ap?.serviceName || 'next visit'}`, clientOrVendor: ap?.clientName || 'Guest', clientId: ap?.clientId || null,
    type: 'income', context: 'Business', category: 'Retainers', taxBucket: 'revenue', amount: cents / 100, paymentMethod: method, hasReceipt: false,
    appointmentId, staffId: ap?.staffId || null, kind: 'deposit', ...more,
  };
}

const fail = (error: string, status: number, code?: string): ReaderDepositResult => ({ ok: false, error, status, ...(code ? { code } : {}) });

/**
 * Records the deposit a card reader payment took for this booking, once. `intent` is the payment as the card processor
 * has it (looked up when it isn't passed, or doesn't carry its charge). A payment that isn't this business's, isn't for
 * this booking's deposit, hasn't gone through or wasn't taken in person is refused, and nothing is written.
 */
export async function recordReaderDeposit(db: any, tenantId: string, appointmentId: string, o: {
  paymentIntentId: string; intent?: any; tenant?: any; actorName?: string | null; origin?: string | null; stripe?: any;
}): Promise<ReaderDepositResult> {
  const T = `tenants/${tenantId}`;
  const tenant: any = o.tenant || (((await db.doc(T).get()).data() as any) || {});
  const acct = String(tenant.stripeAccountId || '');
  if (!acct) return fail('Card payments aren’t set up for this business.', 400);
  const pi = String(o.paymentIntentId || o.intent?.id || '').trim();
  if (!/^pi_[A-Za-z0-9_]+$/.test(pi)) return fail('The card payment is missing.', 400);
  let intent: any = o.intent && o.intent.id === pi && o.intent.latest_charge && typeof o.intent.latest_charge !== 'string' ? o.intent : null;
  if (!intent) {
    try {
      const stripe: any = o.stripe || new (Stripe as any)(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any });
      intent = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] }, { stripeAccount: acct });
    } catch (e) { console.error('[reader-deposit] payment lookup failed', e); }
  }
  if (!intent) return fail('We couldn’t confirm that card payment yet. The booking will show it as soon as it’s confirmed; don’t take the deposit again.', 502, 'unconfirmed');
  // Only a payment the reader took for this booking's deposit.
  if (String(intent.metadata?.tenantId || '') !== tenantId) return fail('That card payment isn’t this business’s.', 403);
  if (String(intent.metadata?.appointmentId || '') !== appointmentId || String(intent.metadata?.kind || '') !== 'deposit') return fail('That card payment wasn’t for this booking’s deposit.', 409);
  if (intent.status !== 'succeeded') return fail('That card payment didn’t go through.', 402, String(intent.status || 'not_succeeded'));
  if (!(intent.payment_method_types || []).includes('card_present')) return fail('That payment wasn’t taken on a card reader.', 400);

  const aRef = db.doc(`${T}/appointments/${appointmentId}`);
  const ap: any = { id: appointmentId, ...(((await aRef.get()).data() as any) || {}) };
  if (!ap.startTime) return fail('That booking wasn’t found.', 404);
  const received = c0(intent.amount_received ?? intent.amount);
  if (received <= 0) return fail('That card payment has no amount.', 400);
  const chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id || null;
  const clientEmail = String(ap.clientEmail || '').toLowerCase().trim() || null;
  const nowIso = new Date().toISOString();
  const safeId = pi.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  // The whole payment goes to the record step, which splits it in the same transaction: a balance collected with the
  // deposit is the fee payment it is, and everything else the card paid is the deposit's credit, so no money that came in
  // is left off the books, and two recorders can't count the balance twice (lib/deposit-record).
  const rec = await recordCardDepositSafely(db, tenantId, appointmentId, {
    cents: received, received, balance: { id: `reader_balance__${safeId}`, method: 'Card reader' },
    paymentIntentId: pi, chargeId, via: 'card_reader', clientEmail, keepFirst: true,
    extra: { stripePaymentIntentId: pi, depositPaidMethod: 'Card reader', depositReaderPi: null },
    income: { id: `reader_deposit__${safeId}`, data: depositIncomeLine(ap, appointmentId, received, 'Card reader', { stripePaymentIntentId: pi, stripeChargeId: chargeId, recordedBy: o.actorName || null }) },
  }, { status: ap.status === 'pending_payment' ? 'confirmed' : ap.status, depositStatus: 'paid', depositPaidAt: nowIso, depositPaidVia: 'card_reader', paymentDueAt: null, depositReaderPi: null });
  if (!rec.ok) return fail(rec.error, 500, 'not_recorded');
  const twice = !!rec.twice;
  const cents = c0(rec.cents ?? received);
  if (!rec.already && c0(rec.balanceCents) > 0) {
    await logAuditAdmin(db, tenantId, { action: 'balance.paid', targetType: 'client', targetId: ap.clientId || appointmentId, amount: c0(rec.balanceCents) / 100,
      summary: `${ap.clientName || 'Client'} paid a ${money(c0(rec.balanceCents))} balance with a booking deposit (card reader)`,
      actor: o.actorName ? { type: 'user', name: o.actorName } : { type: 'system', name: 'Payments' } } as any).catch(() => {});
  }
  if (!rec.already) {
    const who = ap.clientName || 'client';
    await logAuditAdmin(db, tenantId, { action: twice ? 'deposit.paid_twice' : 'deposit.paid', targetType: 'appointment', targetId: appointmentId, amount: cents / 100,
      summary: twice ? `Deposit ${money(cents)} taken on the card reader for ${who}, but it was already paid another way: both payments are kept` : `Deposit ${money(cents)} taken at the front desk (card reader) — ${who}`,
      actor: o.actorName ? { type: 'user', name: o.actorName, via: 'front desk' } : { type: 'system', name: 'Payments' } } as any).catch(() => {});
    if (twice) await tellDeskPaidTwice(db, tenantId, ap, cents).catch((e) => console.error('[reader-deposit] desk notice', e));
    else if (!rec.released) {
      const base = String(o.origin || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
      if (base) await tellDepositClient(db, tenant, tenantId, ap, base, 'confirmed', cents);
    }
  }
  return { ok: true, already: rec.already, paidTwice: twice, status: rec.status, released: rec.released, depositCents: cents, chargedCents: received };
}

/** The front desk, managers and the provider hear that a deposit was paid twice, so one can be refunded. */
export async function tellDeskPaidTwice(db: any, tenantId: string, ap: any, cents: number) {
  const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const { tenantTimeZone } = await import('@/lib/tenant-time');
  const when = ap.startTime ? new Date(ap.startTime).toLocaleString('en-US', { timeZone: tenantTimeZone(tenant), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'their visit';
  const message = `${ap.clientName || 'A client'}’s ${money(cents)} deposit for ${when} was paid twice. Both payments are kept on the booking. Please refund one of them from the booking.`;
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((m: any) => !m.archived && (['owner', 'admin', 'manager', 'front_desk'].includes(String(m.role || '')) || m.id === ap.staffId));
  const b = db.batch();
  for (const m of staff) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId: m.id, type: 'deposit_paid_twice', title: 'Deposit paid twice', link: '/planner', read: false, createdAt: new Date().toISOString(), message, appointmentId: ap.id }); }
  await b.commit();
}

/** A reader payment still waiting on a booking (named when it was started): recorded now if it went through. */
export async function recordWaitingReaderDeposit(db: any, tenantId: string, ap: any, o: { tenant?: any; actorName?: string | null; origin?: string | null } = {}): Promise<ReaderDepositResult | null> {
  const pi = String(ap?.depositReaderPi?.id || '');
  if (!pi || ap?.depositStatus === 'paid') return null;
  const r = await recordReaderDeposit(db, tenantId, String(ap.id), { paymentIntentId: pi, ...o });
  // A payment that was cancelled, or never finished long after it was started (a card still on the reader looks the
  // same for a while), isn't asked about again.
  const startedAt = Date.parse(String(ap?.depositReaderPi?.at || ''));
  const stale = !Number.isFinite(startedAt) || Date.now() - startedAt > 2 * 3600e3;
  if (!r.ok && (r.code === 'canceled' || (r.code === 'requires_payment_method' && stale))) await db.doc(`tenants/${tenantId}/appointments/${ap.id}`).set({ depositReaderPi: null }, { merge: true }).catch(() => {});
  return r;
}
