// src/lib/counter-card.ts — THE CARD READER AT THE DRIVE-THRU WINDOW (server; api/counter 'readers', 'card', 'cardCheck',
// 'cardStop'). The lane sends the order's total to the business's own card reader (a smart reader on the internet, picked
// on the lane screen); the guest taps, inserts or swipes there, and nothing about their card ever touches the lane.
// The order keeps its one card payment as it goes:
//   starting  → claimed in one step, so two tablets can't both start one; the payment is made under a key named after
//               the order and the try, so asking again never makes a second;
//   on_reader → the reader is asking for the card. Cash, another card machine or a void waits until it's done or stopped;
//   declined  → the reader said no (its words are kept for the lane and the window screen): send it again, or stop;
//   capturing → the card was approved, and it's being taken; then the order is paid by it, in one step;
//   paid      → the order is paid by this payment;
//   stopping / stopped → called off: the payment is canceled, so it can never go through later.
// Every change to that state is made in one step that first checks it's still about the same payment and try, and never
// undoes a newer one: a screen that heard back late can't mark an approved card declined, or put a payment back on the
// reader once the order was paid or stopped. Every answer comes from the card company, never from a screen. A card
// approved after the order was paid another way (or voided) is never kept: its hold is let go, or once taken it goes
// back to the card, and managers are told.
// The sweep (cron/retail-payments) settles any the lane never heard back about: approved → the order is paid by it;
// still waiting after 15 minutes → stopped.
import { createHash } from 'crypto';
import { accountOf, captureReaderPayment, readerStripe, recordReaderFee, releaseReaderPayment } from '@/lib/reader-sale';
import { refundAmount } from '@/lib/stripe-refund';
import { payOrder } from '@/lib/counter-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const READER = /^tmr_[A-Za-z0-9]{4,60}$/;
// Readers the server can send a payment to (the ones on the internet with their own screen). A reader that pairs over
// Bluetooth with a phone or tablet only works from the front desk.
const SMART = new Set(['bbpos_wisepos_e', 'simulated_wisepos_e', 'stripe_s700', 'verifone_P400']);
const UNREACHABLE = 'We couldn’t reach card payments just now. Nothing new was charged. Try again in a moment.';
const nowIso = () => new Date().toISOString();
const centsOf = (n: unknown) => Math.round((Number(n) || 0) * 100);
const isMissing = (e: any) => e?.code === 'resource_missing' || e?.raw?.code === 'resource_missing' || e?.statusCode === 404;
// A payment's key: short whatever the order's id (the card company takes keys of up to 255 characters).
const payKey = (tenantId: string, orderId: string, attempt: number) => `counter-card-${createHash('sha256').update(`${tenantId}/${orderId}`).digest('hex').slice(0, 40)}-${attempt}`;

export type ReaderRow = { id: string; label: string; online: boolean; test: boolean };
export type CardState = 'none' | 'starting' | 'on_reader' | 'declined' | 'paid' | 'stopped';
export type CardAnswer = { ok: true; state: CardState; message?: string | null; already?: boolean; payMethod?: string | null; justWent?: boolean; notKept?: boolean; voided?: boolean; wrongAmount?: boolean }
  | { ok: false; error: string; status: number; code?: string };

const fail = (error: string, status: number, code?: string): CardAnswer => ({ ok: false, error, status, ...(code ? { code } : {}) });
const orderRefOf = (db: any, tenantId: string, orderId: string) => db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);

/** What a change to the card state must still find: the same payment (`id`, null for none yet), the same try, the state
 *  it's leaving (`from`), and whether it may leave 'capturing' (only the step that's taking that payment). */
type Guard = { id?: string | null; attempt?: number; from?: string[]; fromCapturing?: boolean };
/** Change the order's card state only if nothing newer happened: never away from 'paid', never away from 'capturing'
 *  unless it's the step taking that payment, and never back onto the reader once the order is paid or voided. */
async function putCard(db: any, ref: any, g: Guard, card: Record<string, any>, open?: boolean): Promise<boolean> {
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return false;
    const c: any = o.card || {};
    if (g.id !== undefined && (c.id || null) !== (g.id || null)) return false;
    if (g.attempt !== undefined && Math.floor(Number(c.attempt) || 0) !== g.attempt) return false;
    if (g.from && !g.from.includes(String(c.state || ''))) return false;
    if (c.state === 'paid') return false;
    if (c.state === 'capturing' && !g.fromCapturing) return false;
    if ((o.paidAt || o.status === 'voided') && ['starting', 'on_reader', 'declined'].includes(String(card.state))) return false;
    tx.set(ref, { card: { ...card, updatedAt: nowIso() }, ...(open === undefined ? {} : { cardOpen: open }) }, { merge: true });
    return true;
  });
}

/** The reader's own words for a card it turned down, kept short and plain for the lane and the window screen. */
export function declineWords(msg: unknown): string {
  const s = String(msg || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'The card didn’t go through.';
  if (/insufficient/i.test(s)) return 'The card was declined for not enough funds.';
  if (/expired/i.test(s)) return 'The card has expired.';
  if (/(incorrect|invalid).*pin|pin.*(incorrect|invalid)/i.test(s)) return 'The PIN wasn’t right.';
  if (/cancel/i.test(s)) return 'It was canceled on the reader.';
  if (/timed? ?out|timeout/i.test(s)) return 'The reader stopped waiting for a card.';
  if (/declin/i.test(s)) return 'The card was declined.';
  return 'The card didn’t go through.';
}

/** What went wrong sending a payment to a reader, in plain words. */
function readerTrouble(e: any): string {
  const code = String(e?.code || e?.raw?.code || '');
  if (code === 'terminal_reader_offline') return 'The card reader is offline. Check it’s on and connected to the internet, then try again.';
  if (code === 'terminal_reader_busy') return 'The card reader is busy with another payment. Finish or cancel it on the reader, then try again.';
  if (code === 'terminal_reader_timeout') return 'The card reader didn’t answer. Check it’s on and connected to the internet, then try again.';
  if (isMissing(e)) return 'That card reader isn’t set up for this business any more. Pick another under Screen.';
  return 'The card reader didn’t take the payment. Try again, or take it another way.';
}

// The business's readers change rarely: asked at most every 30 seconds a business, however many tablets ask.
const readerCache = new Map<string, { at: number; rows: ReaderRow[] }>();
/** The business's card readers the lane can send a payment to. */
export async function listReaders(tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ rows: ReaderRow[]; payments: boolean } | { error: string }> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) return { rows: [], payments: false };
  const now = o.now ?? Date.now();
  const hit = readerCache.get(tenantId); if (hit && now - hit.at < 30000) return { rows: hit.rows, payments: true };
  try {
    const r: any = await stripe.terminal.readers.list({ limit: 100 }, { stripeAccount: acct });
    const rows: ReaderRow[] = (Array.isArray(r?.data) ? r.data : []).filter((x: any) => READER.test(String(x?.id || '')) && SMART.has(String(x?.device_type || '')))
      .map((x: any) => ({ id: String(x.id), label: String(x.label || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Card reader', online: x.status === 'online', test: x.device_type === 'simulated_wisepos_e' }));
    readerCache.set(tenantId, { at: now, rows });
    if (readerCache.size > 500) readerCache.delete(readerCache.keys().next().value as string);
    return { rows, payments: true };
  } catch { return { error: UNREACHABLE }; }
}

async function getPi(stripe: any, acct: string, id: string): Promise<{ pi?: any; err?: 'missing' | 'unknown' }> {
  try { const pi = await stripe.paymentIntents.retrieve(String(id), { expand: ['latest_charge'] }, { stripeAccount: acct }); return pi ? { pi } : { err: 'missing' }; }
  catch (e) { return { err: isMissing(e) ? 'missing' : 'unknown' }; }
}
const ours = (pi: any, tenantId: string, orderId: string) => String(pi?.metadata?.tenantId || '') === tenantId && String(pi?.metadata?.orderId || '') === orderId && String(pi?.metadata?.source || '') === 'drive_thru';
const approved = (pi: any) => pi?.status === 'requires_capture' || pi?.status === 'succeeded';
/** Whether a reader is asking for this payment right now, and how that's going. */
async function readerOn(stripe: any, acct: string, readerId: string | null, piId: string): Promise<{ mine: boolean; status?: string; message?: string | null } | null> {
  if (!readerId || !READER.test(readerId)) return { mine: false };
  try {
    const rd: any = await stripe.terminal.readers.retrieve(readerId, {}, { stripeAccount: acct });
    const a = rd?.action;
    const mine = a?.type === 'process_payment_intent' && String(a?.process_payment_intent?.payment_intent?.id || a?.process_payment_intent?.payment_intent || '') === piId;
    return { mine, status: mine ? String(a.status || '') : undefined, message: mine ? a.failure_message || null : null };
  } catch { return null; }
}
/** The reader stops asking for this payment (only if it's this one it's asking for). */
async function readerLetGo(stripe: any, acct: string, readerId: string | null, piId: string) {
  const on = await readerOn(stripe, acct, readerId, piId);
  if (on?.mine && on.status === 'in_progress') { try { await stripe.terminal.readers.cancelAction(readerId, {}, { stripeAccount: acct }); } catch { /* the payment itself is canceled after */ } }
}

/** Tell the owners and managers, once a payment, about a card payment that went back to the guest's card on its own
 *  (or that has to and hasn't yet). */
async function tellManagers(db: any, tenantId: string, piId: string, number: string, cents: number, refunded: boolean) {
  try {
    const T = `tenants/${tenantId}`;
    const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((m: any) => !m.archived && ['owner', 'admin', 'manager'].includes(String(m.role || '')) && ID.test(String(m.id)));
    const money = `$${(cents / 100).toFixed(2)}`;
    const message = refunded
      ? `Drive-thru order ${number} was already paid another way when its ${money} card payment went through, so the card payment went back to the guest’s card.`
      : `Drive-thru order ${number} was already paid another way when its ${money} card payment went through. Giving it back to the card didn’t work yet: it’s tried again every few minutes.`;
    const b = db.batch();
    // Named for the payment, what happened and who it's for: told again, it's the same notice.
    for (const m of staff) { const r = db.doc(`${T}/notifications/cardback_${piId.replace(/[^A-Za-z0-9_]/g, '').slice(0, 80)}_${refunded ? 'back' : 'todo'}_${m.id}`); b.set(r, { id: r.id, userId: m.id, type: 'counter_card_back', title: refunded ? 'Card payment given back' : 'Card payment to give back', link: '/transactions', read: false, createdAt: nowIso(), message }); }
    await b.commit();
  } catch (e) { console.error('[counter-card] managers not told', e); }
}

/** A payment the reader approved: taken, and the order paid by it in one step. If the order was paid another way or
 *  voided first, it isn't kept: an approval is let go (the guest is never charged), and a payment already taken goes
 *  back to the card. */
async function settle(db: any, stripe: any, acct: string, tenantId: string, orderId: string, pi: any, by: string): Promise<CardAnswer> {
  const ref = orderRefOf(db, tenantId, orderId);
  const cents = Math.round(Number(pi.amount) || 0);
  // Claimed first, so nothing else pays the order while the card is being taken.
  const claim: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return { gone: true };
    if (o.paidAt && o.cardPaymentId === pi.id) return { paid: true, payMethod: o.payMethod };
    if (o.paidAt || o.status === 'voided' || o.status === 'cancelled') return { notKept: true, number: o.number };
    if (centsOf(o.total) !== cents) return { notKept: true, number: o.number };
    tx.set(ref, { card: { ...(o.card || {}), id: pi.id, state: 'capturing', updatedAt: nowIso() }, cardOpen: true }, { merge: true });
    return { number: o.number };
  });
  if (claim.gone) return fail('That order is gone.', 404);
  if (claim.paid) return { ok: true, state: 'paid', already: true, payMethod: claim.payMethod || 'card' };
  if (claim.notKept) return giveBack(db, stripe, acct, tenantId, orderId, pi, claim.number);
  const mine: Guard = { id: pi.id, from: ['capturing'], fromCapturing: true };
  let taken = pi;
  if (pi.status === 'requires_capture') {
    const c = await captureReaderPayment(stripe, acct, pi.id, tenantId);
    if (!c.ok) {
      // Not settled yet (the card company didn't answer): still on the reader as far as anyone knows; asked again.
      if (c.status === 'unknown' || c.status === 'requires_capture' || c.status === 'processing') { await putCard(db, ref, mine, { state: 'on_reader' }); return { ok: true, state: 'on_reader' }; }
      await putCard(db, ref, mine, { state: 'declined', failed: 'The card didn’t go through.', failedAt: nowIso() }, true);
      return { ok: true, state: 'declined', message: 'The card didn’t go through.' };
    }
    taken = c.pi;
    void recordReaderFee(db, stripe, acct, tenantId, pi.id).catch(() => {});
  }
  const r: any = await payOrder(db, tenantId, orderId, { method: 'card', by, card: { id: pi.id, cents } });
  if (r.paidOtherwise) return giveBack(db, stripe, acct, tenantId, orderId, taken, claim.number);
  if (!r.ok) { await putCard(db, ref, mine, { state: 'on_reader' }).catch(() => {}); return fail(r.error || 'That didn’t go through. Try again.', r.status || 500); }
  // A payment on the guest's own phone meanwhile is called off (or given back, if it went through at that moment).
  if (!r.already) { const P = await import('@/lib/counter-phone'); const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {}; await P.stopPhone(db, tenantId, t, orderId, { stripe }).catch(() => null); }
  return { ok: true, state: 'paid', already: !!r.already, payMethod: 'card' };
}

/** A card payment the order doesn't need (paid another way, or voided, before it went through): an approval is let
 *  go; one already taken goes back to the card, once, and the managers are told. The answer says how the order stands:
 *  paid (and how), or voided. */
export async function giveBack(db: any, stripe: any, acct: string, tenantId: string, orderId: string, pi: any, number: string): Promise<CardAnswer> {
  const ref = orderRefOf(db, tenantId, orderId);
  const cents = Math.round(Number(pi.amount_received || pi.amount) || 0);
  let pending = false;
  if (pi.status === 'succeeded') {
    const r = await refundAmount(acct, pi.id, cents, `counter-card-back-${pi.id}`, { origin: 'app', orderId });
    // Given back by hand already counts as given back.
    const done = r.ok || r.code === 'charge_already_refunded';
    pending = !done;
    await ref.set({ cardBack: { [pi.id]: { cents, at: nowIso(), refunded: done, refundId: r.id || null } } }, { merge: true });
    await tellManagers(db, tenantId, pi.id, number, cents, done);
  } else {
    const rel = await releaseReaderPayment(stripe, acct, pi.id, tenantId);
    // It went through after all, between the two: given back as above.
    if (!rel.ok && rel.status === 'succeeded' && rel.pi) return giveBack(db, stripe, acct, tenantId, orderId, rel.pi, number);
    pending = !rel.ok;
  }
  await putCard(db, ref, { id: pi.id, fromCapturing: true }, { state: pending ? 'stopping' : 'stopped' }, pending);
  const cur: any = (await ref.get()).data() || {};
  // Not paid and not voided: it wasn't for the order's total (it's let go; a new one can be sent).
  return { ok: true, state: cur.paidAt ? 'paid' : 'stopped', already: true, payMethod: cur.payMethod || null, notKept: true, voided: cur.status === 'voided', wrongAmount: !cur.paidAt && cur.status !== 'voided' };
}

/** Put a payment back the way it was when the order moved on while it was being sent to the reader: the reader stops
 *  asking, and it's let go (or, if the guest got their card in first, settled like any other). */
async function undoSend(db: any, stripe: any, acct: string, tenantId: string, orderId: string, readerId: string, piId: string, by: string): Promise<CardAnswer> {
  await readerLetGo(stripe, acct, readerId, piId);
  const g = await getPi(stripe, acct, piId);
  if (g.pi && approved(g.pi)) return settle(db, stripe, acct, tenantId, orderId, g.pi, by);
  if (g.pi && g.pi.status !== 'canceled') await releaseReaderPayment(stripe, acct, piId, tenantId);
  const cur: any = (await orderRefOf(db, tenantId, orderId).get()).data() || {};
  if (cur.paidAt) return { ok: true, state: 'paid', already: true, payMethod: cur.payMethod || null };
  return { ok: true, state: cur.card?.state === 'on_reader' ? 'on_reader' : 'stopped' };
}

/** Send the order's total to the reader at this screen. Asking again for the same order uses the same payment (sent to
 *  the reader again if it isn't asking for it now); one the reader already approved pays for the order instead. */
export async function startCard(db: any, tenantId: string, tenant: any, orderId: string, readerId: string, by: string, o: { stripe?: any } = {}): Promise<CardAnswer> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) return fail('Card payments aren’t set up for this business yet.', 409, 'no_payments');
  if (!ID.test(orderId)) return fail('Which order?', 400);
  if (!READER.test(String(readerId || ''))) return fail('Pick the card reader for this screen first, under Screen.', 400, 'no_reader');
  const ref = orderRefOf(db, tenantId, orderId);
  for (let round = 0; round < 2; round++) {
    const claim: any = await db.runTransaction(async (tx: any) => {
      const or: any = (await tx.get(ref)).data(); if (!or) return { error: 'That order is gone.', status: 404 };
      if (or.paidAt) return { paid: true, payMethod: or.payMethod || null };
      if (or.status !== 'sent' && or.status !== 'done') return { error: or.status === 'voided' ? 'That order was voided.' : 'Send the order to the kitchen first.', status: 409 };
      const amount = centsOf(or.total);
      if (amount < 50) return { error: 'Card payments start at $0.50. Take this one in cash.', status: 409, code: 'too_small' };
      const c: any = or.card || null;
      const attempt = Math.max(0, Math.floor(Number(c?.attempt) || 0));
      if (c?.state === 'capturing') return { capturing: true };
      if (c?.state === 'starting' && !c.id && Date.now() - (Date.parse(String(c.at || '')) || 0) < 60000) return { error: 'The card reader is being started on another screen.', status: 409, code: 'starting' };
      // The same payment, sent again: starting once more, so cash waits while it goes to the reader.
      if (c?.id && !['stopped', 'stopping', 'paid'].includes(String(c.state))) {
        tx.set(ref, { card: { ...c, state: c.state === 'on_reader' ? 'on_reader' : 'starting', readerId, at: nowIso(), by, failed: null, updatedAt: nowIso() }, cardOpen: true }, { merge: true });
        return { reuse: String(c.id), attempt, amount, number: or.number };
      }
      tx.set(ref, { card: { state: 'starting', attempt: attempt + 1, readerId, at: nowIso(), by, cents: amount, id: null, failed: null, updatedAt: nowIso() }, cardOpen: true }, { merge: true });
      return { attempt: attempt + 1, amount, number: or.number };
    });
    if (claim.error) return fail(claim.error, claim.status, claim.code);
    if (claim.paid) return { ok: true, state: 'paid', already: true, payMethod: claim.payMethod };
    if (claim.capturing) return checkCard(db, tenantId, tenant, orderId, by, { stripe });
    let pi: any = null;
    if (claim.reuse) {
      const g = await getPi(stripe, acct, claim.reuse);
      if (g.err === 'unknown') { await putCard(db, ref, { id: claim.reuse, from: ['starting'] }, { state: 'declined', failed: 'The card reader couldn’t be reached.', failedAt: nowIso() }, true); return fail(UNREACHABLE, 503, 'unknown'); }
      pi = g.pi;
      if (!pi || !ours(pi, tenantId, orderId) || pi.status === 'canceled' || Math.round(Number(pi.amount) || 0) !== claim.amount) {
        // Not one this order can use (gone, canceled, or for another amount): called off, and a new one is made.
        if (pi && ours(pi, tenantId, orderId) && pi.status !== 'canceled') {
          if (approved(pi)) return settle(db, stripe, acct, tenantId, orderId, pi, by);
          const rel = await releaseReaderPayment(stripe, acct, pi.id, tenantId);
          if (!rel.ok) return rel.status === 'succeeded' && rel.pi ? settle(db, stripe, acct, tenantId, orderId, rel.pi, by) : fail(UNREACHABLE, 503, 'unknown');
        }
        await putCard(db, ref, { id: claim.reuse }, { state: 'stopped' }, false);
        continue;
      }
      if (approved(pi)) return settle(db, stripe, acct, tenantId, orderId, pi, by);
      // Being processed on the reader already: on the reader, so cash keeps waiting.
      if (pi.status === 'processing') { await putCard(db, ref, { id: pi.id, from: ['starting'] }, { state: 'on_reader' }, true); return { ok: true, state: 'on_reader' }; }
    } else {
      try {
        pi = await stripe.paymentIntents.create({
          amount: claim.amount, currency: 'usd', payment_method_types: ['card_present'], capture_method: 'manual',
          description: `Drive-thru order ${claim.number}`,
          metadata: { tenantId, source: 'drive_thru', kind: 'counter', orderId, attempt: String(claim.attempt) },
        }, { stripeAccount: acct, idempotencyKey: payKey(tenantId, orderId, claim.attempt) });
      } catch {
        await putCard(db, ref, { id: null, attempt: claim.attempt, from: ['starting'] }, { state: 'stopped' }, false);
        return fail('The card payment couldn’t be started. Check the internet connection and try again. Nothing was charged.', 503);
      }
      // Still this try (not stopped, paid or started again on another screen in the meantime): it's the order's payment.
      if (!(await putCard(db, ref, { id: null, attempt: claim.attempt, from: ['starting'] }, { id: pi.id, state: 'starting' }))) {
        await releaseReaderPayment(stripe, acct, pi.id, tenantId).catch(() => null);
        const cur: any = (await ref.get()).data() || {};
        // How it stands now: paid, stopped, or started again on another screen (on the reader as far as this one goes).
        if (cur.paidAt) return { ok: true, state: 'paid', already: true, payMethod: cur.payMethod || null };
        return { ok: true, state: ['starting', 'on_reader', 'capturing'].includes(String(cur.card?.state)) ? 'on_reader' : 'stopped' };
      }
    }
    // To the reader. A reader already asking for this very payment is fine as it is.
    try {
      await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: pi.id, process_config: { skip_tipping: true } }, { stripeAccount: acct });
    } catch (e: any) {
      const on = String(e?.code || e?.raw?.code || '') === 'terminal_reader_busy' ? await readerOn(stripe, acct, readerId, pi.id) : null;
      if (!(on?.mine && on.status === 'in_progress')) {
        const words = readerTrouble(e);
        await putCard(db, ref, { id: pi.id, from: ['starting', 'on_reader', 'declined'] }, { state: 'declined', readerId, failed: words, failedAt: nowIso() }, true);
        return fail(words, 409, 'reader');
      }
    }
    // On the reader, unless the order moved on meanwhile (paid another way, stopped): then the reader stops asking.
    if (!(await putCard(db, ref, { id: pi.id, from: ['starting', 'on_reader', 'declined'] }, { state: 'on_reader', readerId, sentAt: nowIso(), failed: null }, true))) {
      return undoSend(db, stripe, acct, tenantId, orderId, readerId, pi.id, by);
    }
    return { ok: true, state: 'on_reader' };
  }
  return fail('The card payment couldn’t be started. Try again.', 409);
}

/** How the order's card payment is going, from the card company: approved → the order is paid by it; turned down →
 *  the reader's words; still asking → on the reader. */
export async function checkCard(db: any, tenantId: string, tenant: any, orderId: string, by: string, o: { stripe?: any } = {}): Promise<CardAnswer> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = orderRefOf(db, tenantId, orderId);
  const or: any = (await ref.get()).data(); if (!or) return fail('That order is gone.', 404);
  if (or.paidAt && (!or.card?.id || or.cardPaymentId === or.card.id || !['on_reader', 'capturing', 'declined', 'stopping', 'starting'].includes(String(or.card.state)))) return { ok: true, state: 'paid', already: true, payMethod: or.payMethod || null };
  const c: any = or.card || null;
  if (!c?.id) return { ok: true, state: c?.state === 'starting' ? 'starting' : 'none' };
  if (c.state === 'stopped') return { ok: true, state: 'stopped' };
  if (!acct || !stripe) return fail('Card payments aren’t set up for this business yet.', 409, 'no_payments');
  const g = await getPi(stripe, acct, c.id);
  if (g.err === 'unknown') return { ok: true, state: c.state === 'declined' ? 'declined' : 'on_reader', message: c.failed || null };
  const pi = g.pi;
  if (!pi || !ours(pi, tenantId, orderId)) { await putCard(db, ref, { id: c.id }, { state: 'stopped' }, false); return { ok: true, state: 'stopped' }; }
  if (approved(pi)) return settle(db, stripe, acct, tenantId, orderId, pi, by);
  if (or.paidAt || or.status === 'voided') return giveBack(db, stripe, acct, tenantId, orderId, pi, or.number);
  if (pi.status === 'canceled') { await putCard(db, ref, { id: c.id }, { state: 'stopped' }, false); return { ok: true, state: 'stopped' }; }
  // Just sent (the reader takes a moment to start asking), or still being processed.
  if (pi.status === 'processing') { if (c.state === 'starting') await putCard(db, ref, { id: pi.id, from: ['starting'] }, { state: 'on_reader' }, true); return { ok: true, state: 'on_reader' }; }
  if (c.state === 'starting' && Date.now() - (Date.parse(String(c.at || '')) || 0) < 20000) return { ok: true, state: 'on_reader' };
  if (c.state === 'declined') return { ok: true, state: 'declined', message: c.failed || null };
  const on = await readerOn(stripe, acct, c.readerId || null, pi.id);
  if (!on) return { ok: true, state: 'on_reader' };   // the reader couldn't be asked: asked again next time
  if (on.mine && on.status === 'in_progress') return { ok: true, state: 'on_reader' };
  // The reader isn't asking any more. Its card may have just been approved (the reader moves on the moment it is), so
  // the payment is asked again before anything is called declined.
  const again = await getPi(stripe, acct, pi.id);
  if (again.err === 'unknown') return { ok: true, state: 'on_reader' };
  if (again.pi && approved(again.pi)) return settle(db, stripe, acct, tenantId, orderId, again.pi, by);
  if (again.pi?.status === 'processing') return { ok: true, state: 'on_reader' };
  if (!(on.mine && on.status === 'failed')) {
    // It moved on without a card (canceled on the reader, or it stopped waiting): it can be sent again, a few seconds
    // after it was sent (the reader takes a moment to start asking).
    const sentAt = Date.parse(String(c.sentAt || c.at || '')) || 0;
    if (Date.now() - sentAt < 5000) return { ok: true, state: 'on_reader' };
  }
  const words = declineWords((on.mine ? on.message : null) || again.pi?.last_payment_error?.message || (on.mine ? '' : 'stopped waiting'));
  await putCard(db, ref, { id: pi.id, from: ['on_reader', 'starting'] }, { state: 'declined', failed: words, failedAt: nowIso() }, true);
  // (Something newer happened meanwhile: the next check says what.)
  const now: any = (await ref.get()).data() || {};
  if (now.paidAt) return { ok: true, state: 'paid', already: true, payMethod: now.payMethod || null };
  return now.card?.state === 'declined' ? { ok: true, state: 'declined', message: now.card.failed || words } : { ok: true, state: 'on_reader' };
}

/** Call off the order's card payment, so it can be paid another way: the reader stops asking, and the payment is
 *  canceled so it can never go through later. One the reader approved just before is kept: it pays for the order. */
export async function stopCard(db: any, tenantId: string, tenant: any, orderId: string, by: string, o: { stripe?: any } = {}): Promise<CardAnswer> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = orderRefOf(db, tenantId, orderId);
  const or: any = (await ref.get()).data(); if (!or) return fail('That order is gone.', 404);
  const c: any = or.card || null;
  if (or.paidAt && (!c?.id || or.cardPaymentId === c.id)) return { ok: true, state: 'paid', already: true, payMethod: or.payMethod || null };
  // Still being started (no payment yet): stopped now, and the screen starting it lets its payment go when it finds that.
  if (!c?.id) { if (c) await putCard(db, ref, { id: null, attempt: Math.floor(Number(c.attempt) || 0) }, { state: 'stopped' }, false); return { ok: true, state: 'stopped' }; }
  if (c.state === 'stopped') return { ok: true, state: or.paidAt ? 'paid' : 'stopped', already: true, payMethod: or.payMethod || null };
  if (!acct || !stripe) return fail('Card payments aren’t set up for this business yet.', 409, 'no_payments');
  await readerLetGo(stripe, acct, c.readerId || null, c.id);
  const g = await getPi(stripe, acct, c.id);
  if (g.err === 'unknown') return fail(UNREACHABLE, 503, 'unknown');
  const pi = g.pi;
  if (!pi || !ours(pi, tenantId, orderId) || pi.status === 'canceled') { await putCard(db, ref, { id: c.id }, { state: 'stopped' }, false); const cur: any = (await ref.get()).data() || {}; return { ok: true, state: cur.paidAt ? 'paid' : 'stopped', payMethod: cur.payMethod || null }; }
  if (approved(pi)) { const r = await settle(db, stripe, acct, tenantId, orderId, pi, by); return r.ok && r.state === 'paid' && !r.notKept ? { ...r, justWent: true } : r; }
  if (pi.status === 'processing') return fail('The card is still being processed. Check again in a moment.', 409, 'processing');
  const rel = await releaseReaderPayment(stripe, acct, pi.id, tenantId);
  if (rel.ok) { await putCard(db, ref, { id: c.id }, { state: 'stopped' }, false); const cur: any = (await ref.get()).data() || {}; return { ok: true, state: cur.paidAt ? 'paid' : 'stopped', payMethod: cur.payMethod || null }; }
  if (rel.status === 'succeeded' && rel.pi) { const r = await settle(db, stripe, acct, tenantId, orderId, rel.pi, by); return r.ok && r.state === 'paid' && !r.notKept ? { ...r, justWent: true } : r; }
  return fail(rel.error || UNREACHABLE, 503, 'unknown');
}

/** EVERY FEW MINUTES (cron/retail-payments): card payments at the window the lane never heard back about. Five minutes
 *  after one started: approved → the order is paid by it (or it's let go, if the order was paid another way); still
 *  waiting on the reader after 15 minutes → stopped; a payment that had to go back to a card and didn't → tried again. */
export async function sweepCounterCards(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; paid: number; stopped: number }> {
  const out = { checked: 0, paid: 0, stopped: 0 };
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) return out;
  const now = o.now ?? Date.now();
  const snap = await db.collection(`tenants/${tenantId}/counterOrders`).where('cardOpen', '==', true).limit(40).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) {
    const or: any = d.data() || {}; const c: any = or.card || {};
    // Card payments that had to go back and didn't yet.
    for (const [piId, back] of Object.entries<any>(or.cardBack || {})) {
      if (back?.refunded !== false) continue;
      const r = await refundAmount(acct, piId, Math.round(Number(back.cents) || 0), `counter-card-back-${piId}`, { origin: 'app', orderId: d.id });
      if (r.ok || r.code === 'charge_already_refunded') { await d.ref.set({ cardBack: { [piId]: { refunded: true, refundId: r.id || null, at: new Date(now).toISOString() } } }, { merge: true }); await tellManagers(db, tenantId, piId, String(or.number || ''), Math.round(Number(back.cents) || 0), true); }
    }
    // Off the sweep's list, in one step that checks nothing new started (a card sent again, a phone payment) and nothing
    // is left to give back.
    const settled = () => db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(d.ref)).data() || {};
      if (!['paid', 'stopped'].includes(String(cur.card?.state || 'stopped'))) return;
      if (cur.phone?.id && !['paid', 'stopped'].includes(String(cur.phone.state || ''))) return;
      if (cur.ahead?.state === 'awaiting_pay') return;
      if (Object.values<any>(cur.cardBack || {}).some((b) => b?.refunded === false)) return;
      tx.set(d.ref, { cardOpen: false }, { merge: true });
    });
    // Scan to pay (lib/counter-phone): one paid on the phone that nobody heard about pays the order (or goes back, if it
    // was paid another way); one not paid (and not going through) is called off once the order is paid or voided, or its
    // link has expired.
    // An order placed ahead (lib/counter-ahead): paid and nobody heard, it goes to the kitchen; not paid after 30
    // minutes, it's let go.
    if (or.ahead?.state === 'awaiting_pay') {
      const A = await import('@/lib/counter-ahead');
      const r = await A.sweepAhead(db, tenantId, tenant, or, d.id, { stripe, now }).catch(() => null);
      if (r === 'paid') { out.checked++; out.paid++; } else if (r === 'abandoned') { out.checked++; out.stopped++; }
      if (r !== 'paid') continue;
    }
    const ph: any = or.phone || {};
    if (ph.id && ph.state === 'open') {
      const phAge = now - (Date.parse(String(ph.at || '')) || now);
      if (phAge >= 5 * 60000 || or.paidAt || or.status === 'voided') {
        out.checked++;
        const P = await import('@/lib/counter-phone');
        const s: any = await P.settlePhone(db, tenantId, tenant, d.id, String(ph.id), { stripe }).catch(() => null);
        if (s?.ok && s.paid) out.paid++;
        else if (s?.ok && s.pending && (or.paidAt || or.status === 'voided' || phAge >= 3 * 3600000)) { await P.stopPhone(db, tenantId, tenant, d.id, { stripe }).catch(() => null); out.stopped++; }
      }
    }
    if (!or.card) { await settled(); continue; }
    const age = now - (Date.parse(String(c.at || '')) || now);
    if (age < 5 * 60000 && c.state !== 'stopping') continue;
    out.checked++;
    const by = 'Card reader';
    if (!c.id) { await putCard(db, d.ref, { id: null, attempt: Math.floor(Number(c.attempt) || 0) }, { state: 'stopped' }, false); await settled(); continue; }
    if (c.state === 'paid' || c.state === 'stopped') { await settled(); continue; }
    const g = await getPi(stripe, acct, c.id);
    if (g.err === 'unknown') continue;
    const pi = g.pi;
    if (!pi || !ours(pi, tenantId, d.id) || pi.status === 'canceled') { await putCard(db, d.ref, { id: c.id, fromCapturing: true }, { state: 'stopped' }, false); await settled(); out.stopped++; continue; }
    if (approved(pi)) { const r = await settle(db, stripe, acct, tenantId, d.id, pi, by); if (r.ok && r.state === 'paid' && !r.notKept) out.paid++; continue; }
    if (pi.status === 'processing') continue;
    if (c.state === 'stopping' || or.paidAt || or.status === 'voided' || age >= 15 * 60000) {
      const r = await stopCard(db, tenantId, tenant, d.id, by, { stripe });
      if (r.ok && r.state === 'stopped') out.stopped++;
      else if (r.ok && r.state === 'paid' && r.justWent) out.paid++;
    }
  }
  return out;
}
