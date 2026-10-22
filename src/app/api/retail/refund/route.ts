import { refundAllowed } from '@/lib/money-limits';
import { familyRefundableCents, followUpLabel, followUpsOf, isFollowUp, payingOrder, sameCustomer } from '@/lib/order-family';
import { giveBackLine, readGift, roomCents, saleBooked, withNonCardRecord, writeGiveBack } from '@/lib/non-card-back';
import { ensureNonCardRecord } from '@/lib/non-card-record';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { brandedEmail, emailButton, getEmailBrand } from '@/lib/email-shell';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';

// ─── /api/retail/refund ───────────────────────────────────────────────────────
// POST { tenantId, orderId, qrToken, reason? }
//
// Executes the order's pending refund THROUGH Stripe instead of sending
// staff to the dashboard: refunds.create on the connected account against
// the order's stored payment intent, for exactly pendingRefundCents (the
// figure the returns desk or claims desk already computed and promised).
//
// WHAT WAS PAID BY GIFT CARD OR STORE CREDIT goes back that way
// (lib/non-card-back): the card gets back what it can, and the rest goes
// onto the gift card the order used, or comes back as store credit, within
// what was paid that way. An order paid entirely by gift card or credit has
// no card refund at all: it all goes back that way.
//
// AN ORDER MADE FROM ANOTHER ONE (a backorder, pre-order items sent later, a
// replacement: lib/order-family) has no payment of its own, because the
// customer paid on the order it came from. Its refund goes back to that
// order's card (and gift card or credit), and every refund across the family
// counts against what was paid, so nothing is given back twice. While any
// refund in the family is being sent, the paying order is held too, so two
// at once can't both count the same money. The refund is recorded on the
// order it's for; the paying order's history notes it.
//
// THE SHOP'S AUTOMATIC AMOUNT ("refund on its own up to $X", Policies): a
// refund at or under it goes back without waiting for someone who can send
// refunds. The shop's own server sends one its rules decided (a customer's
// cancellation, a swap nobody answered, a claim the shop's rules approved, a
// pre-order run that fell through), proving itself with the server secret;
// anyone on the team sends one they made (checking in a return, an item that
// wasn't on the shelf). Never a replacement for a lost parcel: the first
// parcel may still turn up.
//
// On success this route performs the same closure markRefundExecuted does
// on the board — pending zeroed, refundedCents accumulated, refund_issued
// event, Refund expense line — so the books look identical whichever path
// ran. The Connect webhook's charge.refunded handler independently credits
// back Stripe's fee portion, exactly as it does for dashboard refunds; it
// never touches refundedCents, so nothing double-counts.
//
// Two idempotency layers: the pending-refund check (a second tap finds
// pending=0 and refuses before Stripe), and a Stripe idempotency key
// keyed to order+sequence (a racing duplicate returns the SAME refund
// instead of creating a second one). On any Stripe failure NOTHING is
// written — the amber banner keeps showing the debt and the manual
// dashboard path still works.

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
// How long a refund being sent holds the order: longer than any one try can run (Stripe's own timeout below, and the
// function's limit), so a try still running is never taken for one that died.
const HOLD_MS = 5 * 60000;
export const maxDuration = 60;
const listed = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  if (!tenantId || !orderId || !qrToken) {
    return NextResponse.json({ error: 'tenantId, orderId and qrToken are required' }, { status: 400 });
  }

  const db = getAdminDb();
  const col = db.collection(`tenants/${tenantId}/retailOrders`);
  const [tenantSnap, orderSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    col.doc(orderId).get(),
  ]);
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const tenant = tenantSnap.data() as any;
  const order = { ...(orderSnap.data() as any), id: orderId };

  if (String(order.qrToken || '') !== qrToken) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  // The order the customer paid on: this one, or for a follow-up the order it was made from, for the same customer.
  const follow = isFollowUp(order);
  const read = (r: any) => r.get();
  const payer0 = follow ? await payingOrder(read, col, order) : order;
  if (!payer0 || (follow && !sameCustomer(payer0, order))) {
    return NextResponse.json({
      error: 'This order was made from another one, and the payment behind it can’t be found. Refund it in the Stripe dashboard, then tap "Mark done manually".',
    }, { status: 422 });
  }
  const payerId = String(payer0.id);
  const piId = String(payer0.stripePaymentIntentId || '').trim();
  // The orders above it: a replacement for a lost parcel anywhere above means the first parcel may still turn up, so
  // nothing made from it is refunded on its own.
  const chain: any[] = [];
  for (let cur: any = order, i = 0; follow && i < 4 && cur?.parentOrderId; i++) {
    const s = await col.doc(String(cur.parentOrderId)).get(); if (!s.exists) break;
    cur = { ...(s.data() || {}), id: s.id }; chain.push(cur); if (!isFollowUp(cur)) break;
  }
  const lostLink = [order, ...chain].some((x) => String(x?.replacementFor || '') === 'lost_in_transit');
  const pendingNow = Number(order.pendingRefundCents) || 0;

  // Money leaves only for a signed-in team member allowed to refund. The order's own token is not enough:
  // it is printed on the customer's QR code and tracking link. The exceptions, each re-checked here:
  //   · the shop's own server, under the shop's automatic amount: a customer's self-serve cancellation
  //     (customer_cancel), or another refund the shop's rules decided (policy);
  //   · anyone on the team (not a renter), under the shop's automatic amount, for a refund they made (policy);
  //   · the shipping on an order that went in the same box as another of the customer's orders (lib/ship-together),
  //     which the shop refunds automatically. Never more than that order's shipping.
  const internalKey = !!process.env.CRON_SECRET && req.headers.get('x-internal-key') === process.env.CRON_SECRET;
  const internal = internalKey && body.reason === 'customer_cancel';
  const together = internalKey && body.reason === 'ship_together';
  const policyAsk = body.reason === 'policy';
  const autoBelow = Math.max(0, Number(tenant.retailSettings?.policies?.refundAutoBelowCents) || 0);
  const underAuto = (p: number) => autoBelow > 0 && p > 0 && p <= autoBelow && !lostLink;
  // The automatic amount is for an order and everything made from it, not for each tap: what has gone back that way
  // across the family (a customer's cancellation included) counts, kept for the order paid on where only the server
  // writes (written only here), so it can't be sent in pieces, or reset from a browser.
  const autoRef = db.doc(`tenants/${tenantId}/private/autoRefunds/orders/${payerId}`);
  const autoUsed = (snap: any) => c0(snap?.exists ? snap.data()?.cents : 0);
  const autoUsed0 = (policyAsk || internal) && autoBelow > 0 ? autoUsed(await autoRef.get()) : 0;
  const underAutoTotal = (p: number) => underAuto(p) && p + autoUsed0 <= autoBelow;
  let policyPath = false;
  let actor: { uid: string; name: string };
  let limitFor: ((c: number) => ReturnType<typeof refundAllowed>) | null = null;
  let autoCap = 0;
  if (together) {
    if (!order.shippedWithOrderId || pendingNow <= 0 || pendingNow > Math.max(0, Number(order.shippingCents) || 0)) return NextResponse.json({ error: 'This refund needs the shop to send it.' }, { status: 403 });
    actor = { uid: 'system', name: 'Shipped together (automatic shipping refund)' };
  } else if (internal) {
    if (order.stage !== 'cancelled' || !underAutoTotal(pendingNow)) return NextResponse.json({ error: 'This refund needs the shop to send it.' }, { status: 403 });
    actor = { uid: 'customer', name: 'Customer cancellation (automatic)' };
    autoCap = autoBelow; policyPath = true;
  } else if (internalKey && policyAsk) {
    if (!underAutoTotal(pendingNow)) return NextResponse.json({ error: 'This refund needs the shop to send it.' }, { status: 403 });
    actor = { uid: 'system', name: 'Automatic refund' };
    autoCap = autoBelow; policyPath = true;
  } else {
    const auth = await verifyStaffActor(req, tenantId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const a: any = auth.actor;
    const renter = a.isRenter === true || a.employmentModel === 'renter' || a.role === 'renter';
    if (policyAsk && !renter && underAutoTotal(pendingNow)) {
      // Within the shop's automatic amount the shop has already said yes: anyone on the team sends one, and no one's
      // own refund limit is in the way. The amount, and what has already gone back that way, is checked again inside
      // the claim below.
      autoCap = autoBelow; policyPath = true;
    } else if (renter || !a.caps?.includes('checkout.refund')) {
      return NextResponse.json({ error: 'Refunds need someone allowed to refund payments.' }, { status: 403 });
    } else {
      // The owner's limit for this person's role (lib/money-limits), checked against what would be sent now (below), and
      // again inside the claim, against what really goes.
      limitFor = (c: number) => refundAllowed(tenant.retailSettings || {}, a, c);
    }
    actor = auth.actor;
  }

  // What it paid by gift card or store credit: the server's own record (lib/non-card-back), made sure of first for an
  // order paid before the record was kept (lib/non-card-record). What its fields show that can't be matched to a real
  // payment doesn't go back that way: the team is told.
  const check = await ensureNonCardRecord(db, tenantId, payerId, payer0);
  if (check.retry) return NextResponse.json({ error: 'Stripe couldn’t be asked about the gift card payment on this order just now. Try again in a moment.' }, { status: 502 });
  const unconfirmed = check.unconfirmed.giftCents + check.unconfirmed.creditCents;
  const unconfirmedLine = unconfirmed > 0
    ? `${follow ? 'The original order' : 'This order'} shows ${money(unconfirmed)} paid by gift card or store credit that couldn’t be matched to the gift card or the customer’s credit, so that part doesn’t go back on its own: if it was paid, give it back by hand.`
    : '';
  const payer0T = await withNonCardRecord(read, db, tenantId, payerId, payer0);
  const room0 = piId ? familyRefundableCents(payer0T, await followUpsOf(read, col, payerId)) : 0;
  const other0 = roomCents(payer0T);
  if (limitFor) {
    const allowed = limitFor(Math.min(pendingNow, room0 + other0));
    if (!allowed.ok) return NextResponse.json({ error: allowed.message, limitCents: allowed.limit }, { status: 403 });
  }
  if (!piId && other0 <= 0) {
    if (unconfirmedLine) return NextResponse.json({ error: unconfirmedLine }, { status: 422 });
    return NextResponse.json({
      error: follow
        ? 'No Stripe payment is on file for the order this one was made from (it may predate payment tracking, or was paid another way). Refund it in the Stripe dashboard, then tap "Mark done manually".'
        : 'No Stripe payment is on file for this order (it may predate payment tracking, or was paid another way). Refund it in the Stripe dashboard, then tap "Mark done manually".',
    }, { status: 422 });
  }
  if (piId && (!process.env.STRIPE_SECRET_KEY || !tenant.stripeAccountId)) {
    return NextResponse.json({ error: !process.env.STRIPE_SECRET_KEY ? 'Stripe is not configured on the server.' : 'This shop has no connected Stripe account.' }, { status: 400 });
  }

  // A short timeout, so a try is always over well before its hold lapses (below) and can't be mistaken for a dead one.
  const stripe = piId ? new Stripe(String(process.env.STRIPE_SECRET_KEY), { apiVersion: '2024-06-20' as any, timeout: 25000, maxNetworkRetries: 1 }) : null;
  const oRef = col.doc(orderId);
  const pRef = col.doc(payerId);
  const held = (l: any) => !!l && Date.parse(l.at || '') > Date.now() - HOLD_MS;
  let cents = 0; let other = 0; let seq = 0; let overCard = 0; let refundId = '';
  const mine = (l: any) => !!l && l.forOrderId === orderId && Number(l.seq) === seq;

  // A REFUND THAT MAY HAVE GONE THROUGH WITHOUT BEING RECORDED: an earlier try claimed it under the next number and was
  // cut off before writing it to the order (its hold has lapsed, the number unused). Stripe is asked first. A refund it
  // made for this order and number is recorded as it is; when there is none, a new one goes out under a fresh number,
  // so it can never be mistaken for the one that didn't happen. When a refund has been recorded on the order since
  // that try (someone marked it done by hand, which can't clear the hold), it was that one: nothing is recorded twice.
  let recordOnly = false; let floorSeq = 0;
  const lapsed = order.refundInFlight;
  const recSeq = Number(order.refundSeq) || 0;
  const recordedSince = lapsed?.refundedBefore != null && (Number(order.refundedCents) || 0) !== Number(lapsed.refundedBefore);
  // A number an earlier try claimed is never used again, whatever happened to it.
  if (lapsed && !held(lapsed)) floorSeq = Math.max(floorSeq, Number(lapsed.seq) || 0);
  if (stripe && lapsed && !held(lapsed) && !recordedSince && Number(lapsed.seq) > recSeq && Number(lapsed.cents) > 0) {
    // Any refund Stripe made for this order under a number not written down yet: the one that try claimed first.
    let found: any = null;
    try {
      const list: any = await stripe.refunds.list({ payment_intent: piId, limit: 100 } as any, { stripeAccount: tenant.stripeAccountId });
      const unrecorded = (list?.data || []).filter((r: any) => r?.metadata?.retailOrderId === orderId && Number(r?.metadata?.seq || 0) > recSeq && !['failed', 'canceled'].includes(String(r?.status || '')));
      for (const r of unrecorded) floorSeq = Math.max(floorSeq, Number(r.metadata.seq) || 0);
      found = unrecorded.find((r: any) => String(r.metadata.seq) === String(lapsed.seq)) || unrecorded.sort((a: any, b: any) => Number(b.metadata.seq) - Number(a.metadata.seq))[0] || null;
    } catch {
      return NextResponse.json({ error: 'Stripe couldn’t be checked for an earlier try at this refund. Try again in a moment.' }, { status: 502 });
    }
    // The gift card or store credit part that try was going to give back goes back now, with the card part.
    if (found) {
      recordOnly = true; cents = Math.max(0, Math.round(Number(found.amount) || 0)); seq = Number(found.metadata.seq); refundId = String(found.id || '');
      other = String(found.metadata.seq) === String(lapsed.seq) ? Math.max(0, Math.round(Number(lapsed.other) || 0)) : 0;
      policyPath = policyPath || lapsed.auto === true;
    }
  }

  if (!recordOnly) {
    // Claim the pending amount in a transaction, so two taps (or a claim approved at the same moment) can't
    // double-send or erase each other. Each refund gets its own sequence number, which is also Stripe's
    // duplicate-protection key: a retry of THIS refund replays it, a later refund of the same amount is new.
    // A follow-up's refund holds the paying order as well, and every refund in the family checks it.
    let limitHit: { message: string; limit: number } | null = null;
    try {
      await db.runTransaction(async (tx: any) => {
        const cSnap = await tx.get(oRef); const cur = cSnap.data() || {};
        const pSnap = follow ? await tx.get(pRef) : cSnap;
        const payer = await withNonCardRecord((r: any) => tx.get(r), db, tenantId, payerId, follow ? { ...(pSnap.data() || {}), id: payerId } : { ...cur, id: orderId });
        const family = (await followUpsOf((r: any) => tx.get(r), col, payerId)).map((f: any) => (f.id === orderId ? { ...cur, id: orderId } : f));
        const autoSnap = policyPath ? await tx.get(autoRef) : null;
        if (held(cur.refundInFlight) || (follow && held(payer.refundInFlight))) throw new Error('busy');
        // The card first, never more than it can take back (whatever has already gone back to it for any order in
        // the family is spoken for); then the gift card or store credit the order was paid with, within that.
        const pending = Number(cur.pendingRefundCents) || 0;
        if (pending <= 0) throw new Error('none');
        if (autoCap && pending > autoCap) throw new Error('over');
        if (policyPath && pending + autoUsed(autoSnap) > autoCap) throw new Error('over');
        cents = piId ? Math.min(pending, familyRefundableCents(payer, family)) : 0;
        other = Math.min(pending - cents, roomCents(payer));
        if (cents + other <= 0) throw new Error('nocard');
        const allowed = limitFor ? limitFor(cents + other) : { ok: true as const };
        if (!allowed.ok) { limitHit = { message: allowed.message, limit: allowed.limit }; throw new Error('limit'); }
        overCard = pending - cents - other;
        seq = Math.max((Number(cur.refundSeq) || 0) + 1, floorSeq + 1);
        const lock = { cents, other, seq, at: new Date().toISOString(), by: actor.uid, refundedBefore: Number(cur.refundedCents) || 0, ...(policyPath ? { auto: true } : {}) };
        tx.update(oRef, { refundInFlight: lock });
        if (follow) tx.update(pRef, { refundInFlight: { ...lock, forOrderId: orderId } });
      });
    } catch (e: any) {
      if (e?.message === 'busy') return NextResponse.json({ error: follow ? 'A refund for this customer’s order is already being sent. Give it a moment.' : 'A refund on this order is already being sent. Give it a moment.' }, { status: 409 });
      if (e?.message === 'nocard') return NextResponse.json({ error: unconfirmedLine || (follow ? 'Everything paid on the original order has already gone back the way it was paid.' : 'Everything paid on this order has already gone back the way it was paid.') }, { status: 409 });
      if (e?.message === 'none') return NextResponse.json({ error: 'No refund is pending on this order.' }, { status: 409 });
      if (e?.message === 'over') return NextResponse.json({ error: 'This is more than your automatic amount allows for this order, so someone allowed to refund needs to send it.' }, { status: 403 });
      if (e?.message === 'limit' && limitHit) return NextResponse.json({ error: (limitHit as any).message, limitCents: (limitHit as any).limit }, { status: 403 });
      return NextResponse.json({ error: 'Couldn’t start the refund. Try again.' }, { status: 500 });
    }

    // ── The refund itself ──────────────────────────────────────────────────────
    if (cents > 0 && stripe) {
      try {
        const refund = await stripe.refunds.create(
          {
            payment_intent: piId,
            amount: cents,
            reason: 'requested_by_customer',
            metadata: { tenantId, retailOrderId: orderId, source: 'clarityflow_board', seq: String(seq), ...(follow ? { paidOnOrderId: payerId } : {}) },
          },
          {
            stripeAccount: tenant.stripeAccountId,
            idempotencyKey: `retail-refund-${orderId}-${seq}`,
          },
        );
        refundId = String(refund.id || '');
      } catch (e: any) {
        // Stripe said no: nothing moved, so the hold comes off. Anything else (no answer in time, a dropped connection)
        // may have gone through: the hold stays, and once it lapses the next try asks Stripe before sending anything.
        const refused = ['StripeCardError', 'StripeInvalidRequestError', 'StripeIdempotencyError', 'StripePermissionError', 'StripeAuthenticationError', 'StripeRateLimitError'].includes(String(e?.type || ''));
        if (refused) {
          try {
            await db.runTransaction(async (tx: any) => {
              const p = follow ? (await tx.get(pRef)).data() || {} : null;
              tx.update(oRef, { refundInFlight: null });
              if (p && mine(p.refundInFlight)) tx.update(pRef, { refundInFlight: null });
            });
          } catch { /* the locks expire on their own */ }
          const msg = e?.raw?.message || e?.message || 'Stripe refused the refund.';
          return NextResponse.json({ error: `Stripe: ${msg}` }, { status: 502 });
        }
        return NextResponse.json({ error: 'Stripe didn’t answer in time, so the refund may or may not have gone through. Try again in five minutes: it will check first, and never send it twice.' }, { status: 502 });
      }
    }
  }

  // ── Closure — same shape as the board's manual markRefundExecuted, in a transaction: only what was sent
  // comes off the pending amount, so anything queued meanwhile stays queued. The gift card or store credit part goes
  // back here, in the same transaction, within what can still go back that way. Tried a few times: the money has
  // moved, so it must be written down. A refund already written down under this number is left alone.
  const now = new Date().toISOString();
  const what = follow ? followUpLabel(order) : '';
  const evRef = oRef.collection('events').doc();
  const pEvRef = pRef.collection('events').doc();
  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  const otherTxnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  let left = 0; let recorded = false; let already = false;
  let gave = { giftCents: 0, creditCents: 0 }; let fromGift = 0; let payerNow: any = payer0;
  for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
    try {
      await db.runTransaction(async (tx: any) => {
        const cSnap = await tx.get(oRef); const cur = cSnap.data() || {};
        const pSnap = follow ? await tx.get(pRef) : null;
        const p = pSnap ? pSnap.data() || {} : null;
        const payerHere = await withNonCardRecord((r: any) => tx.get(r), db, tenantId, payerId, follow ? { ...(p || {}), id: payerId } : { ...cur, id: orderId });
        const gift = other > 0 ? await readGift(tx, db, tenantId, payerHere) : null;
        const autoSnap = policyPath ? await tx.get(autoRef) : null;
        // Written down already: by another tap (on the first try), or by this request's own earlier try, whose write
        // went through though it reported an error (on a later one): what that try worked out (kept below) is what was
        // written, and it still owes the points and the email.
        if ((Number(cur.refundSeq) || 0) >= seq) { already = attempt === 0; left = Math.max(0, Number(cur.pendingRefundCents) || 0); return; }
        payerNow = payerHere;
        let giveNow = { giftCents: 0, creditCents: 0 }; let fromGiftNow = 0;
        const afterCard = Math.max(0, (Number(cur.pendingRefundCents) || 0) - cents);
        const want = Math.min(other, afterCard);
        if (want > 0) {
          const g = writeGiveBack(tx, db, tenantId, follow ? pRef : oRef, payerNow, gift, want, {
            note: `Refund on order #${order.orderNumber}${follow ? ` (${what.replace(/^the /, '')})` : ''}`, by: actor.name, kind: 'refund', forOrderId: orderId,
          });
          giveNow = { giftCents: g.giftCents, creditCents: g.creditCents };
          fromGiftNow = g.giftCents + g.toCreditFromGift;
        }
        gave = giveNow; fromGift = fromGiftNow;
        const given = gave.giftCents + gave.creditCents;
        left = Math.max(0, afterCard - given);
        tx.update(oRef, {
          pendingRefundCents: left,
          refundedCents: (Number(cur.refundedCents) || 0) + cents,
          ...(given ? { refundedOtherCents: (Number(cur.refundedOtherCents) || 0) + given } : {}),
          refundSeq: seq, refundInFlight: null,
          ...(refundId ? { lastStripeRefundId: refundId } : {}),
        });
        if (p && mine(p.refundInFlight)) tx.update(pRef, { refundInFlight: null });
        // Sent within the shop's automatic amount: counted for the order paid on, for everything made from it.
        if (policyPath && cents + given > 0) tx.set(autoRef, { cents: autoUsed(autoSnap) + cents + given, at: now }, { merge: true });
        const otherLine = given ? giveBackLine(payerNow, gave) : '';
        const cardLine = cents ? `${money(cents)} to the card${follow ? ' used on the original order' : ''} (${refundId})` : '';
        tx.set(evRef, {
          id: evRef.id, type: 'refund_issued', at: now,
          actorId: actor.uid, actorName: actor.name,
          meta: {
            amountCents: cents + given,
            ...(given ? { toCardCents: cents, giftCents: gave.giftCents, creditCents: gave.creditCents } : {}),
            scope: follow ? (cur.stage === 'cancelled' ? 'full' : 'partial') : cents + given >= (Number(order.totalCents) || 0) ? 'full' : 'partial',
            ...(refundId ? { refundId } : {}),
            text: `Refund sent by ${actor.name}: ${[cardLine, otherLine].filter(Boolean).join(' and ')}`,
            ...(follow ? { paidOnOrderId: payerId } : {}),
          },
        });
        if (follow) {
          tx.set(pEvRef, {
            id: pEvRef.id, type: 'note', at: now,
            actorId: actor.uid, actorName: actor.name,
            meta: { kind: 'follow_up_refund', followUpOrderId: orderId, amountCents: cents + given, ...(refundId ? { refundId } : {}), text: `${money(cents + given)} refunded for ${what}: ${[cents ? `${money(cents)} to this order’s card` : '', otherLine].filter(Boolean).join(' and ')}` },
          });
        }
        if (cents) {
          tx.set(txnRef, {
            id: txnRef.id, date: now,
            description: `Refund sent through Stripe — Order #${order.orderNumber}${follow ? ` (${what.replace(/^the /, '')})` : ''} · ${refundId}`,
            clientOrVendor: order.customerName || 'Guest',
            type: 'expense', context: 'Business', category: 'Refund', taxBucket: 'refund',
            amount: cents / 100, paymentMethod: 'Card (Online)', hasReceipt: true,
            retailOrderId: orderId, ...(follow ? { paidOnOrderId: payerId } : {}), tenantId,
          });
        }
        // The sale was booked as income, gift card and credit included: what goes back that way is a refund too.
        if (given && saleBooked(payerNow)) {
          tx.set(otherTxnRef, {
            id: otherTxnRef.id, date: now,
            description: `Refund to ${gave.giftCents && !gave.creditCents ? 'gift card' : gave.creditCents && !gave.giftCents ? 'store credit' : 'gift card and store credit'} — Order #${order.orderNumber}${follow ? ` (${what.replace(/^the /, '')})` : ''}`,
            clientOrVendor: order.customerName || 'Guest',
            type: 'expense', context: 'Business', category: 'Refund', taxBucket: 'refund',
            amount: given / 100, paymentMethod: gave.giftCents && !gave.creditCents ? 'Gift card' : 'Store credit', hasReceipt: true,
            retailOrderId: orderId, ...(follow ? { paidOnOrderId: payerId } : {}), tenantId,
          });
        }
      });
      recorded = true;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  if (!recorded) {
    // Nothing went to the card, and the gift card or credit part is written in the same step as the order: nothing
    // moved, so the hold comes off and it can be tried again straight away.
    if (!cents) {
      try {
        await db.runTransaction(async (tx: any) => {
          const p = follow ? (await tx.get(pRef)).data() || {} : null;
          tx.update(oRef, { refundInFlight: null });
          if (p && mine(p.refundInFlight)) tx.update(pRef, { refundInFlight: null });
        });
      } catch { /* the hold expires on its own */ }
      return NextResponse.json({ error: 'Couldn’t give it back just now. Try again.' }, { status: 500 });
    }
    return NextResponse.json({
      ok: true, recorded: false, refundId, amountCents: cents,
      message: `${money(cents)} has gone back through Stripe, but it couldn’t be saved on the order yet. Tap send again in five minutes to record it. It won’t be sent twice.`,
    });
  }
  if (already) return NextResponse.json({ ok: true, refundId, amountCents: cents, leftCents: left, overCardCents: 0, message: 'That refund was already recorded on the order.' });
  const given = gave.giftCents + gave.creditCents;
  const total = cents + given;

  // A gift card topped back up: the customer's wallet shows it.
  if (gave.giftCents > 0 && payerNow?.giftCardId) {
    try { const { syncClientGift } = await import('@/lib/gift-cards'); const g = await db.doc(`tenants/${tenantId}/giftCards/${String(payerNow.giftCardId)}`).get(); await syncClientGift(db, tenantId, g.data()?.recipientId); } catch { /* the wallet catches up */ }
  }
  // Loyalty: a refund takes back the points those products earned (lib/loyalty-server), on the sale that earned them:
  // for what goes back to the card and to the gift card. Store credit spent on the order earned nothing, so what comes
  // back as store credit for it takes nothing back.
  try { const { reverseSale } = await import('@/lib/loyalty-server'); if (cents + fromGift > 0) await reverseSale(db, tenantId, { saleId: `order_${payerId}`, refundCents: cents + fromGift, refundId: refundId || `${orderId}-${seq}`, by: 'Refund' }); } catch { /* best effort */ }

  /* THE REFUND-TIMELINE EMAIL — the moment money moves, the customer knows,
   * with the number and the honest window. Fired here (not the webhook) so
   * dashboard refunds recorded via "Mark done manually" don't double-send;
   * best-effort — the refund succeeded regardless. */
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
  if (RESEND_API_KEY && RESEND_FROM && order.customerEmail) {
    try {
      const emailBrand = await getEmailBrand(db, tenantId);
      const num = `#${String(order.orderNumber).padStart(4, '0')}`;
      const first = String(order.customerName || '').trim().split(/\s+/)[0];
      const origin = req.nextUrl.origin;
      const link = `${origin}/shop/${tenantId}/order/${orderId}`;
      const yours = [
        cents ? `${money(cents)} to the card you paid with` : '',
        gave.giftCents ? `${money(gave.giftCents)} back on your gift card` : '',
        gave.creditCents ? `${money(gave.creditCents)} as store credit` : '',
      ].filter(Boolean);
      const how = given
        ? `We have sent ${listed(yours)}.${cents ? ' Banks typically show card refunds within <strong>5 to 10 business days</strong>.' : ''}${gave.giftCents ? ' Your gift card can be used again right away.' : ''}${gave.creditCents ? ' Your store credit is ready for your next order.' : ''}`
        : 'Your refund has just been sent to your original payment method. The funds have been released on our side, and banks typically show card refunds within <strong>5 to 10 business days</strong>.';
      const html = brandedEmail(emailBrand, `
        <p style="font-size:14px;color:#0f172a;margin:0 0 8px">Hi ${first || 'there'},</p>
        <p style="font-size:15px;font-weight:800;color:#0f172a;margin:0">${cents ? 'Your refund is on its way' : 'Your refund is ready to use'}</p>
        <p style="font-size:28px;font-weight:900;color:#0f172a;margin:12px 0 0;font-variant-numeric:tabular-nums">$${(total / 100).toFixed(2)}</p>
        <p style="font-size:13px;color:#334155;line-height:1.7;margin:12px 0 0">${how}</p>
        <p style="font-size:11px;color:#64748b;margin:14px 0 0">Order ${num}${refundId ? ` · refund reference ${refundId.slice(-8)}` : ''}</p>
        ${emailButton(link, 'View my order', emailBrand)}
        <p style="font-size:13px;color:#334155;line-height:1.7;margin:16px 0 0">If you have any questions, please reply to this email.</p>
        <p style="font-size:13px;color:#334155;line-height:1.7;margin:12px 0 0">Kind regards,<br>${emailBrand.shopName}</p>`,
        { preheader: `$${(total / 100).toFixed(2)} has been refunded on order ${num}.${cents ? ' Please allow 5 to 10 business days for the card part.' : ''}` });
      const { sendNotification } = await import('@/lib/notify');
      await sendNotification(db, {
        tenantId, channel: 'email', to: order.customerEmail,
        subject: `${emailBrand.shopName}: your $${(total / 100).toFixed(2)} refund ${cents ? 'is on its way' : 'is ready to use'}`,
        html, kind: 'refund_issued', recipientType: 'client',
        recipientId: orderId || null, recipientName: order.customerName || null,
      });
    } catch { /* the refund stands; the order page shows it regardless */ }
  }

  const otherLine = given ? giveBackLine(payerNow, gave) : '';
  const sent = recordOnly
    ? `${money(cents)} had already gone back through Stripe, and it's recorded on the order now.${otherLine ? ` With it, ${otherLine}.` : ''}`
    : !cents
      ? `${money(total)} refunded: ${otherLine}.`
      : !given
        ? `${money(cents)} has been refunded through Stripe${follow ? ' to the card used on the original order' : ''}. It will appear with the customer's bank within 5 to 10 business days.`
        : `${money(total)} refunded: ${money(cents)} through Stripe to the card${follow ? ' used on the original order' : ''} and ${otherLine}. The card part appears with the customer's bank within 5 to 10 business days.`;
  return NextResponse.json({
    ok: true, refundId, amountCents: total, cardCents: cents, otherCents: given, leftCents: left, overCardCents: overCard,
    message: overCard > 0
      ? `${sent} The other ${money(overCard)} ${unconfirmedLine ? `stays on the order. ${unconfirmedLine}` : 'is more than is left of what they paid, so it stays on the order for a look.'}`
      : sent,
  });
}
