// src/lib/lost-charges.ts — A SAVED-CARD CHARGE WHOSE ANSWER NEVER CAME BACK (server; run by the five-minute check).
// Every charge to a client's saved card (api/stripe/charge-card) keeps a record of the attempt (cardAttempts), written
// before the card is charged and closed with Stripe's answer. When the answer is lost (no connection, Stripe's own
// error), the person is told to try again in a couple of minutes, which finds the same charge under the same key. If
// nobody does, the attempt stays open, and the money may have been taken without being recorded. This settles each one
// left open more than 20 minutes, so every payment ends recorded:
//   - Stripe has the payment, and it went through: recorded once, named after the payment, as the charge itself would
//     have recorded it. A booking's deposit (onLost 'deposit') is recorded as that booking's deposit while the booking is
//     still waiting on one. Anything else is recorded as the income it was, and the owners are told what it was for, so
//     they can check what it paid for happened (a cancellation or a move whose screen saved nothing), and refund it from
//     Money if it didn't.
//   - Stripe said no: closed, nothing recorded.
//   - Still processing (a bank payment): left for the next run.
//   - No payment under that key (it never reached Stripe): closed after two hours, nothing recorded; a booking that was
//     waiting on that deposit charge is told to send its pay link.
// A desk sale's own payment (one named on its ticket) is left to its ticket, which the payment notice marks paid. A desk
// attempt settled here keeps its key, so the next tap for it finds the same payment rather than charging again. Two
// runs at once settle an attempt once: each is taken over in one step first.
// The other way an answer is lost: the charge went through and its attempt is closed, but the screen or step that asked
// for it never heard back (a booking's deposit, a cancellation or a move whose fee was charged). Those attempts carry
// `unapplied` until checked here, 20 minutes on: a deposit not on its booking is recorded there (as a second payment
// when the booking was paid another way meanwhile, for the desk to refund one), and a fee whose change wasn't saved is
// told to the owners.
import Stripe from 'stripe';

const SETTLE_AFTER_MS = 20 * 60000;     // an attempt still open this long has lost its answer
const NOTHING_AFTER_MS = 2 * 3600000;   // no payment under the key by then: it never reached Stripe
const TAKEN_MS = 5 * 60000;             // one run's hold on an attempt it's settling
const c0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));
const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const stripeFor = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }) as any;

export type LostChargeCounts = { checked: number; recorded: number; released: number; waiting: number };

/** Which attempts are still open: an unattended charge still sending or unanswered, or a desk charge left unanswered. */
const openAuto = (a: any) => a?.mode === 'auto' && ['sending', 'unknown'].includes(String(a.status || ''));
const openPos = (a: any) => a?.mode === 'pos' && a.unknown === true && a.done !== true;

/** The payment Stripe made under this attempt's key (it carries the key as metadata.chargeKey), if any. */
async function paymentUnder(stripe: any, a: any): Promise<{ found: any | null; asked: boolean }> {
  try {
    const since = Math.floor((Date.parse(String(a.at || '')) || Date.now()) / 1000) - 3600;
    const l: any = await stripe.paymentIntents.list({ customer: String(a.customer), created: { gte: since }, limit: 100 }, { stripeAccount: String(a.account) });
    const found = (Array.isArray(l?.data) ? l.data : []).find((p: any) => String(p?.metadata?.chargeKey || '') === String(a.key)) || null;
    return { found, asked: true };
  } catch { return { found: null, asked: false }; }
}

async function tellOwners(db: any, tenantId: string, id: string, message: string, link: string) {
  try {
    const admins = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get();
    const now = new Date().toISOString();
    for (const d of admins.docs) {
      const n = db.doc(`tenants/${tenantId}/notifications/${safe(id)}_${safe(d.id)}`);
      await n.set({ id: n.id, userId: d.id, type: 'card_charge_settled', read: false, createdAt: now, link, message });
    }
  } catch { /* the money is recorded; the note is a courtesy */ }
}

/** Record a payment that went through as the income it is, named as the charge itself names it. */
async function recordIncome(db: any, tenantId: string, a: any, pi: any, client: any) {
  const T = `tenants/${tenantId}`;
  const id = `${a.mode === 'pos' ? 'pos_cof' : 'card_charge'}__${safe(pi.id)}`;
  const lc: any = pi.latest_charge; const chargeId = lc ? (typeof lc === 'string' ? lc : lc.id || null) : null;
  const cents = c0(pi.amount_received ?? pi.amount ?? a.amountCents); const sur = Math.min(cents, c0(a.surchargeCents));
  const at = new Date(((Number(pi.created) || 0) * 1000) || Date.now()).toISOString();
  const base = { date: at, clientOrVendor: client?.name || 'Client', clientId: a.clientId || null, type: 'income', context: 'Business', paymentMethod: 'Card on file (Stripe)',
    appointmentId: a.appointmentId || null, stripePaymentIntentId: pi.id, stripeChargeId: chargeId, checkoutSessionId: a.checkoutSessionId || null, tenantId,
    notes: 'The charge went through after its answer was lost; recorded by the five-minute check.' };
  const lineRef = db.doc(`${T}/transactions/${id}`);
  const surRef = db.doc(`${T}/transactions/${id}__surcharge`);
  const wrote = await db.runTransaction(async (tx: any) => {
    const l = await tx.get(lineRef);
    if (l.exists) return false;
    tx.set(lineRef, { ...base, id, description: a.description || 'Card on file charge', category: a.category || 'Service Revenue', taxBucket: a.taxBucket === 'adjustment' ? 'adjustment' : 'revenue', amount: (cents - sur) / 100, hasReceipt: true });
    if (sur > 0) tx.set(surRef, { ...base, id: surRef.id, description: 'Card Processing Fee (passed to client)', category: 'Card Processing Fee', taxBucket: 'revenue', amount: sur / 100, hasReceipt: false });
    return true;
  });
  return { wrote, lineId: id, chargeId, cents };
}

/** A card payment recorded as its booking's deposit: the credit, its line in the books (named as the charge names it;
 *  kept when the charge already wrote it) and any balance collected with it, split from the booking as it is now. A
 *  booking paid another way meanwhile keeps its first payment, and this one is kept beside it for the desk to refund.
 *  A part beyond the deposit that no open balance explains (that balance paid another way meanwhile) is recorded on
 *  its own line and the owners are told, so it can be refunded. 'waiting' when the record couldn't be written just now
 *  (asked again on the next run). */
async function asDeposit(db: any, tenantId: string, a: any, pi: any, ap: any, client: any, now: number): Promise<{ state: 'recorded' | 'elsewhere' | 'no_booking' | 'waiting'; r?: any; extraCents?: number }> {
  const T = `tenants/${tenantId}`;
  const { recordCardDeposit } = await import('@/lib/deposit-record');
  const lc: any = pi.latest_charge; const chargeId = lc ? (typeof lc === 'string' ? lc : lc.id || null) : null;
  const incomeId = `card_charge__${safe(pi.id)}`; const received = c0(pi.amount_received ?? pi.amount ?? a.amountCents);
  const owed = c0(ap.depositAmountCents); const dep = owed > 0 ? Math.min(received, owed) : received;
  const balOpen = !ap.balanceCollectedAt ? c0(ap.balanceCollectCents) : 0;
  // Collected by this same charge: the booking says so, or (recorded before it did) the balance's line names this charge.
  let balByThis = !!ap.balanceCollectedAt && !!chargeId && String(ap.balanceCollectedChargeId || '') === chargeId;
  if (!balByThis && ap.balanceCollectedAt && chargeId && !ap.balanceCollectedChargeId) {
    const lines = await db.collection(`${T}/transactions`).where('stripeChargeId', '==', chargeId).limit(10).get().catch(() => ({ docs: [] as any[] }));
    balByThis = lines.docs.some((d: any) => String((d.data() || {}).category || '') === 'Fee Recovery' && String((d.data() || {}).appointmentId || '') === String(a.appointmentId || ''));
  }
  // How the payment splits: a balance still open that it covers is collected from it here; a balance this same charge
  // already collected (the step that charged it got that far) stays as recorded; anything else beyond the deposit is extra.
  const split = balOpen > 0 && received - dep >= balOpen;
  const depCents = split ? received - balOpen : dep;
  const extra = split ? 0 : balByThis ? 0 : received - dep;
  const lineRef = db.doc(`${T}/transactions/${incomeId}`);
  // The charge wrote its own line for the whole payment: it's brought down to the deposit's part first, so the payment
  // is counted once (the balance and any extra get lines of their own).
  if (depCents < received) {
    try { await db.runTransaction(async (tx: any) => { const l: any = (await tx.get(lineRef)).data() || null; if (l && Math.round((Number(l.amount) || 0) * 100) === received) tx.set(lineRef, { amount: depCents / 100 }, { merge: true }); }); }
    catch { return { state: 'waiting' }; }
  }
  let r: any;
  try {
    r = await recordCardDeposit(db, tenantId, String(a.appointmentId), {
      ...(split ? { cents: received, received, balance: { id: `${incomeId}__balance`, method: 'Card on file (Stripe)' } } : { cents: depCents }),
      paymentIntentId: String(pi.id), chargeId, via: 'card_on_file', clientEmail: ap.clientEmail || client.email || null, keepFirst: ap.depositStatus === 'paid',
      extra: { depositChargeUnconfirmed: null, depositPaidVia: 'card_on_file' },
      income: { id: incomeId, data: { id: incomeId, date: new Date(((Number(pi.created) || 0) * 1000) || now).toISOString(), description: a.description || 'Deposit',
        clientOrVendor: ap.clientName || client.name || 'Client', clientId: a.clientId || null, type: 'income', context: 'Business', category: a.category || 'Retainers', taxBucket: 'revenue',
        paymentMethod: 'Card on file (Stripe)', appointmentId: a.appointmentId, stripePaymentIntentId: pi.id, stripeChargeId: chargeId, hasReceipt: true, tenantId,
        notes: 'The deposit charge went through but its answer was lost; recorded by the five-minute check.' } },
    });
  } catch { return { state: 'waiting' }; }
  if (r?.ok) {
    // Money beyond the deposit that nothing open explains: on its own line, once, for the owners to refund if it wasn't owed.
    if (extra > 0) {
      const xRef = db.doc(`${T}/transactions/${incomeId}__extra`);
      await db.runTransaction(async (tx: any) => { if ((await tx.get(xRef)).exists) return;
        tx.set(xRef, { id: xRef.id, tenantId, date: new Date(now).toISOString(), description: 'Card charge beyond the deposit (its balance was paid another way)', clientOrVendor: ap.clientName || client.name || 'Client',
          clientId: a.clientId || null, type: 'income', context: 'Business', category: 'Fee Recovery', taxBucket: 'adjustment', amount: extra / 100, paymentMethod: 'Card on file (Stripe)',
          appointmentId: a.appointmentId, stripePaymentIntentId: pi.id, stripeChargeId: chargeId, hasReceipt: false }); }).catch(() => {});
    }
    return { state: 'recorded', r, extraCents: extra };
  }
  const err = String(r?.error || '');
  if (/another booking/.test(err)) return { state: 'elsewhere' };
  if (/wasn.t found/.test(err)) return { state: 'no_booking' };
  return { state: 'waiting' };
}

/** What the owners are told about a deposit the check recorded. */
function depositWords(ap: any, cents: number, d: { r?: any; extraCents?: number }, charged: boolean): string {
  const who = `${ap.clientName || 'a client'}’s booking`;
  if (d.r?.twice) return `A ${money(cents)} deposit charge for ${who} went through after the booking was paid another way, so it’s been paid twice. Refund one of them from the booking.`;
  const base = charged ? `The ${money(cents)} deposit for ${who} went through, though the step that charged it never heard back. It’s recorded on the booking now.`
    : `The ${money(cents)} deposit for ${who} did go through. It’s recorded on the booking.`;
  return c0(d.extraCents) > 0 ? `${base} ${money(c0(d.extraCents))} of it was for a balance that was paid another way meanwhile, so it’s recorded on its own line: refund it from Money if it wasn’t owed.` : base;
}

/** Settle one attempt. Returns what happened to it. */
async function settleOne(db: any, tenantId: string, ref: any, a: any, stripe: any, now: number): Promise<'recorded' | 'released' | 'waiting' | 'skipped'> {
  const T = `tenants/${tenantId}`;
  if (!a.customer || !a.account || !a.key) return 'skipped';   // made before attempts kept these: left as they were
  // A desk sale's payment named on its ticket is the ticket's: the payment notice marks the sale paid there.
  // ('settled' keeps it out of this check, and the next tap still reuses its key.)
  if (a.mode === 'pos' && a.ticket) { await ref.set({ unknown: 'settled', settledAt: new Date(now).toISOString(), settledAs: 'ticket', settlingAt: null }, { merge: true }); return 'released'; }
  const { found, asked } = await paymentUnder(stripe, a);
  if (!asked) return 'waiting';
  const age = now - (Date.parse(String(a.at || '')) || now);
  // A desk attempt keeps its key unless Stripe said no: the next tap for the same payment finds it (or, when nothing
  // reached Stripe, makes it under that key) instead of charging again. A decline ends it, so a new tap tries the card.
  const at = new Date(now).toISOString();
  const close = (status: string, more: Record<string, any> = {}) => ref.set(a.mode === 'pos'
    ? { ...(status === 'declined' ? { done: true, unknown: false, doneAt: at } : { unknown: 'settled' }), settledAt: at, settledAs: status, ...more }
    : { status, endedAt: at, settledAt: at, settledBy: 'check', ...more }, { merge: true });

  if (!found) {
    if (age < NOTHING_AFTER_MS) return 'waiting';
    await close(a.mode === 'pos' ? 'not_charged' : 'not_charged');
    // A booking that was waiting on that deposit charge: nothing was taken, so its pay link can go out.
    if (a.onLost === 'deposit' && a.appointmentId) {
      const aRef = db.doc(`${T}/appointments/${safe(a.appointmentId)}`); const ap: any = (await aRef.get()).data() || null;
      if (ap?.depositChargeUnconfirmed?.key === a.key && ap.depositStatus !== 'paid') {
        await aRef.set({ depositChargeUnconfirmed: null, depositChargeCheckedAt: new Date(now).toISOString() }, { merge: true });
        await tellOwners(db, tenantId, `depnone_${a.appointmentId}`, `The ${money(c0(a.amountCents))} deposit charge for ${ap.clientName || 'a client'}’s booking never reached Stripe, so nothing was taken. Send them the deposit link from the booking.`, `/planner?visit=${safe(a.appointmentId)}`);
      }
    }
    return 'released';
  }
  const status = String(found.status || '');
  if (status === 'processing') return 'waiting';
  if (status !== 'succeeded') { await close('declined', { code: status }); return 'released'; }

  const client: any = a.clientId ? ((await db.doc(`${T}/clients/${safe(a.clientId)}`).get()).data() || {}) : {};
  const cents = c0(found.amount_received ?? found.amount ?? a.amountCents);
  // A booking's deposit: recorded as its deposit (credit, line and any balance with it, in one step); a booking paid
  // another way meanwhile keeps both, for the desk to refund one.
  if (a.onLost === 'deposit' && a.appointmentId) {
    const ap: any = (await db.doc(`${T}/appointments/${safe(a.appointmentId)}`).get()).data() || null;
    if (ap) {
      const d = await asDeposit(db, tenantId, a, found, ap, client, now);
      if (d.state === 'waiting') return 'waiting';
      if (d.state === 'elsewhere') { await close('charged', { pi: found.id, settledAs: 'recorded_elsewhere' }); return 'recorded'; }
      if (d.state === 'recorded') {
        await close('charged', { pi: found.id, settledAs: 'deposit' });
        if (!d.r.already) await tellOwners(db, tenantId, `depfound_${a.appointmentId}`, depositWords(ap, cents, d, false), `/planner?visit=${safe(a.appointmentId)}`);
        return 'recorded';
      }
    }
  }
  // Anything else: the income it is, once, and the owners are told what it was for.
  const rec = await recordIncome(db, tenantId, a, found, client);
  await close('charged', { pi: found.id, settledAs: 'income' });
  if (rec.wrote) {
    const what = String(a.description || 'a charge').replace(/\s*—.*$/, '');
    await tellOwners(db, tenantId, `lostcharge_${found.id}`, `A ${money(cents)} charge to ${client.name || 'a client'}’s saved card (${what}) went through, but the screen that asked for it never heard back${a.onLost === 'refund' ? ', so what it was for wasn’t saved' : ''}. It’s recorded in Money. Check the booking, and refund it from Money if it wasn’t meant.`,
      a.appointmentId ? `/planner?visit=${safe(a.appointmentId)}` : '/money');
  }
  return 'recorded';
}

/** The five-minute check: every saved-card attempt left open is settled (see the top of this file). */
export async function settleLostCardCharges(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<LostChargeCounts> {
  const out: LostChargeCounts = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  if (!tenant?.stripeAccountId && !tenant?.stripeConnectAccountId) return out;
  const now = o.now ?? Date.now();
  const col = db.collection(`tenants/${tenantId}/cardAttempts`);
  const [auto, pos] = await Promise.all([
    col.where('status', 'in', ['sending', 'unknown']).limit(50).get().catch(() => ({ docs: [] as any[] })),
    // Desk attempts made before they kept what's needed to find them (no mode) are left out, so they never crowd out
    // the ones that can be settled.
    col.where('unknown', '==', true).where('mode', '==', 'pos').limit(50).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const stripe = o.stripe || stripeFor();
  for (const d of [...auto.docs, ...pos.docs]) {
    const a0: any = d.data() || {};
    if (!(openAuto(a0) || openPos(a0))) continue;
    if (now - (Date.parse(String(a0.unknownAt || a0.at || '')) || now) < SETTLE_AFTER_MS) continue;
    // Taken over in one step, so two runs at once settle it once.
    const mine = await db.runTransaction(async (tx: any) => {
      const s = await tx.get(d.ref); const a: any = s.data() || {};
      if (!(openAuto(a) || openPos(a))) return null;
      if (a.settlingAt && now - (Date.parse(String(a.settlingAt)) || 0) < TAKEN_MS) return null;
      tx.set(d.ref, { settlingAt: new Date(now).toISOString() }, { merge: true });
      return a;
    }).catch(() => null);
    if (!mine) continue;
    out.checked++;
    try {
      const r = await settleOne(db, tenantId, d.ref, mine, stripe, now);
      if (r === 'recorded') out.recorded++; else if (r === 'released') out.released++; else if (r === 'waiting') out.waiting++;
      if (r === 'waiting' || r === 'skipped') await d.ref.set({ settlingAt: null }, { merge: true }).catch(() => {});
    } catch (e: any) {
      console.error('[lost-charges]', tenantId, d.id, String(e?.message || e).slice(0, 160));
      await d.ref.set({ settlingAt: null }, { merge: true }).catch(() => {});
      out.waiting++;
    }
  }

  // Charges that went through whose answer the asking screen or step may have lost: checked once, 20 minutes on.
  const charged = (await col.where('unapplied', '==', true).limit(50).get().catch(() => ({ docs: [] as any[] }))).docs;
  for (const d of charged) {
    const a0: any = d.data() || {};
    if (a0.status !== 'charged' || now - (Date.parse(String(a0.endedAt || a0.at || '')) || now) < SETTLE_AFTER_MS) continue;
    const mine = await db.runTransaction(async (tx: any) => {
      const a: any = (await tx.get(d.ref)).data() || {};
      if (a.unapplied !== true || a.status !== 'charged') return null;
      if (a.settlingAt && now - (Date.parse(String(a.settlingAt)) || 0) < TAKEN_MS) return null;
      tx.set(d.ref, { settlingAt: new Date(now).toISOString() }, { merge: true });
      return a;
    }).catch(() => null);
    if (!mine) continue;
    out.checked++;
    try {
      const r = await checkApplied(db, tenantId, mine, stripe, now);
      if (r === 'waiting') { await d.ref.set({ settlingAt: null }, { merge: true }).catch(() => {}); out.waiting++; continue; }
      await d.ref.set({ unapplied: false, appliedCheckedAt: new Date(now).toISOString(), appliedAs: r, settlingAt: null }, { merge: true });
      if (r === 'recorded' || r === 'told') out.recorded++;
    } catch (e: any) {
      console.error('[lost-charges] applied', tenantId, d.id, String(e?.message || e).slice(0, 160));
      await d.ref.set({ settlingAt: null }, { merge: true }).catch(() => {});
      out.waiting++;
    }
  }
  return out;
}

/** A charge that went through, 20 minutes on: did what it was for get saved? A booking's deposit is looked for on the
 *  booking (and recorded there when it isn't); a cancellation or move fee is checked against the booking (and the
 *  owners told when the change wasn't saved). Anything else can't be told apart from the outside, and is left. */
async function checkApplied(db: any, tenantId: string, a: any, stripe: any, now: number): Promise<'applied' | 'recorded' | 'told' | 'waiting' | 'left'> {
  const T = `tenants/${tenantId}`; const pi = String(a.pi || '');
  if (!a.appointmentId || !pi) return 'left';
  const ap: any = (await db.doc(`${T}/appointments/${safe(a.appointmentId)}`).get()).data() || null;
  const cents = c0(a.amountCents);
  // A deposit taken for a booking that was never saved (the booking step stopped after charging): the money is in the
  // books (the charge wrote its line), and the owners are told, so it can be refunded or the booking made.
  if (!ap) {
    if (a.onLost !== 'deposit') return 'left';
    const client: any = a.clientId ? ((await db.doc(`${T}/clients/${safe(a.clientId)}`).get()).data() || {}) : {};
    await tellOwners(db, tenantId, `depnobooking_${safe(pi)}`, `A ${money(cents)} deposit was charged to ${client.name || 'a client'}’s card for a booking that was never saved. It’s recorded in Money: refund it from there, or book them in.`, '/money');
    return 'told';
  }
  if (a.onLost === 'deposit') {
    const { depositCreditId } = await import('@/lib/deposit-record');
    // Its credit is what checkout takes off the bill: there, it's on its booking.
    if ((await db.doc(`${T}/depositCredits/${depositCreditId(pi)}`).get()).exists) return 'applied';
    // Not on its booking: the step that charged it never heard back (or stopped before saving its credit). Recorded now,
    // as its deposit.
    let intent: any = null;
    try { intent = await stripe.paymentIntents.retrieve(pi, {}, { stripeAccount: String(a.account) }); } catch { return 'waiting'; }
    if (String(intent?.status || '') !== 'succeeded') return 'left';
    const client: any = a.clientId ? ((await db.doc(`${T}/clients/${safe(a.clientId)}`).get()).data() || {}) : {};
    const d = await asDeposit(db, tenantId, a, intent, ap, client, now);
    if (d.state === 'waiting') return 'waiting';
    if (d.state !== 'recorded') return 'left';
    if (!d.r.already) await tellOwners(db, tenantId, `depfound_${a.appointmentId}`, depositWords(ap, cents, d, true), `/planner?visit=${safe(a.appointmentId)}`);
    return 'recorded';
  }
  if (a.onLost === 'refund') {
    const cat = String(a.category || '').toLowerCase();
    const cancel = /cancel|no.?show/.test(cat); const move = /reschedul/.test(cat);
    if (!cancel && !move) return 'left';
    const saved = cancel ? ['cancelled', 'canceled', 'no_show'].includes(String(ap.status || '')) : String(ap.rescheduleFeeIntentId || '') === pi;
    if (saved) return 'applied';
    const what = String(a.description || (cancel ? 'Cancellation fee' : 'Reschedule fee')).replace(/\s*—.*$/, '');
    await tellOwners(db, tenantId, `unsaved_${safe(pi)}`, cancel
      ? `A ${money(cents)} ${what.toLowerCase()} was charged to ${ap.clientName || 'a client'}’s card, but the cancellation wasn’t saved, so the booking is still on the calendar. Cancel it from the planner without a new fee, or refund the fee from Money.`
      : `A ${money(cents)} ${what.toLowerCase()} was charged to ${ap.clientName || 'a client'}’s card, but the move wasn’t saved, so the booking is still at its old time. Move it from the planner without a new fee, or refund the fee from Money.`,
      `/planner?visit=${safe(a.appointmentId)}`);
    return 'told';
  }
  return 'left';
}
