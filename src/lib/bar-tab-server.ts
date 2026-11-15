// src/lib/bar-tab-server.ts — BAR TABS WITH A CARD HELD, on the server (lib/bar-tab has the rules; api/bar is the way
// in). A tab is a party at the bar (parties/{id}, source 'bar', no table, not on the host stand's floor) with its own
// visit, the same kind a table has (appointments/apt-party-{id}), so drinks and food go on it the way they go on a
// table's tab, and the desk closes it the same way.
// The held card lives on the visit (`cardHold`), and every change to it is one step that first checks it's still about
// the same payment and try, so two phones can't both start one, and a late answer never undoes a newer one:
//   startHold  → the hold amount, sent to the bar's card reader (a smart reader on the internet), never captured here
//   checkHold  → from the card company: approved → held (with the card's brand and last four); turned down → the
//                reader's words; still asking → on the reader
//   stopHold   → called off before it's held, or a held card let go: the payment is canceled, so it can never be taken
//   chargeHold → the desk closes the tab on the held card: only the check is taken from it, and in the same step the
//                payment becomes the sale's own card reader payment (lib/reader-sale, which never takes or lets go a
//                bar hold itself); the rest of the hold goes back. Never more than what's held.
//   sweepBarHolds → every few minutes (cron/retail-payments): a held card on a tab paid another way is let go; a card
//                left asking on the reader is stopped; a charge whose answer was lost is recorded; managers hear once
//                about a tab still held after 12 hours.
import { createHash } from 'crypto';
import { accountOf, markReaderSalePaid, readerStripe, recordReaderFee, releaseReaderPayment, tellDeskReader, ticketPayment, liveShares, paidPayloadOf } from '@/lib/reader-sale';
import { declineWords, readerLetGo, readerOn, readerTrouble } from '@/lib/counter-card';
import { cleanTabName, holdDollarsOf, holdOf, type CardHold, type HoldState } from '@/lib/bar-tab';
import { viaWords } from '@/lib/pay-via';
import { tellManagers } from '@/lib/tell-managers';
import { tenantTimeZone } from '@/lib/tenant-time';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const READER = /^tmr_[A-Za-z0-9]{4,60}$/;
const UNREACHABLE = 'We couldn’t reach card payments just now. Nothing was charged. Try again in a moment.';
const nowIso = () => new Date().toISOString();
const holdKey = (tenantId: string, visitId: string, attempt: number) => `bar-hold-${createHash('sha256').update(`${tenantId}/${visitId}`).digest('hex').slice(0, 40)}-${attempt}`;

export type HoldAnswer = { ok: true; hold: CardHold | null; already?: boolean } | { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): HoldAnswer => ({ ok: false, error, status, ...(code ? { code } : {}) });
const visitRef = (db: any, tenantId: string, visitId: string) => db.doc(`tenants/${tenantId}/appointments/${visitId}`);

async function getPi(stripe: any, acct: string, id: string): Promise<{ pi?: any; err?: 'missing' | 'unknown' }> {
  try { const pi = await stripe.paymentIntents.retrieve(String(id), { expand: ['latest_charge'] }, { stripeAccount: acct }); return pi ? { pi } : { err: 'missing' }; }
  catch (e: any) { return { err: e?.code === 'resource_missing' || e?.statusCode === 404 ? 'missing' : 'unknown' }; }
}
const ours = (pi: any, tenantId: string, visitId: string) => String(pi?.metadata?.tenantId || '') === tenantId && String(pi?.metadata?.visitId || '') === visitId && String(pi?.metadata?.source || '') === 'terminal'
  && ['bar_hold', 'sale'].includes(String(pi?.metadata?.kind || ''));
const cardOf = (pi: any) => { const c: any = pi?.latest_charge?.payment_method_details?.card_present || {}; return { brand: c.brand ? String(c.brand).slice(0, 20) : null, last4: /^\d{4}$/.test(String(c.last4 || '')) ? String(c.last4) : null }; };

/** Change the hold only if it's still the one this step is about (same payment, or same try with none yet), and in one
 *  of the states it can move from. Whether it changed. */
async function putHold(db: any, ref: any, g: { id: string | null; attempt?: number; from?: HoldState[] }, patch: Partial<CardHold>): Promise<boolean> {
  return db.runTransaction(async (tx: any) => {
    const v: any = (await tx.get(ref)).data(); const h = holdOf(v?.cardHold); if (!h) return false;
    if (g.id ? h.id !== g.id : (h.id !== null || (g.attempt !== undefined && h.attempt !== g.attempt))) return false;
    if (g.from && !g.from.includes(h.state)) return false;
    tx.set(ref, { cardHold: { ...h, ...patch, updatedAt: nowIso() } }, { merge: true });
    return true;
  });
}

/** A new tab at the bar, under a name. */
export async function openTab(db: any, tenantId: string, name: unknown, by: string): Promise<{ ok: true; partyId: string; visitId: string } | { ok: false; error: string; status: number }> {
  const n = cleanTabName(name); if (!n) return { ok: false, error: 'Whose tab? A name, so the bar knows.', status: 400 };
  const T = `tenants/${tenantId}`; const pRef = db.collection(`${T}/parties`).doc(); const visitId = `apt-party-${pRef.id}`; const at = nowIso();
  const b = db.batch();
  b.set(pRef, { id: pRef.id, name: n, size: 1, status: 'seated', source: 'bar', barTab: true, unitIds: [], sessionId: null, guestIds: [], needs: [], seatedAt: at, createdAt: at, openedBy: by.slice(0, 60) });
  b.set(db.doc(`${T}/appointments/${visitId}`), { id: visitId, tenantId, isTable: true, barTab: true, partyId: pRef.id, tableName: 'Bar', partySize: 1, clientName: n, noBookedTime: true, source: 'bar',
    status: 'servicing', stage: 'in_service', startTime: at, actualStartTime: at, tab: [], timeline: [{ at, kind: 'note', text: 'Tab opened at the bar', by: by.slice(0, 60), via: 'bar' }], createdAt: at, updatedAt: at });
  await b.commit();
  return { ok: true, partyId: pRef.id, visitId };
}

/** Tonight's open tabs at the bar: name, what's on the check, how long it's been open, and the held card. */
export async function tabsNow(db: any, tenantId: string): Promise<{ visitId: string; partyId: string; name: string; total: number; lines: number; openedAt: string; hold: CardHold | null }[]> {
  const snap = await db.collection(`tenants/${tenantId}/appointments`).where('barTab', '==', true).where('status', '==', 'servicing').limit(100).get();
  return snap.docs.map((d: any) => { const v: any = d.data() || {}; const tab = Array.isArray(v.tab) ? v.tab : [];
    return { visitId: d.id, partyId: String(v.partyId || ''), name: String(v.clientName || 'A tab').slice(0, 40), lines: tab.length,
      total: Math.round(tab.reduce((s: number, l: any) => s + (l?.comp ? 0 : (Number(l?.price) || 0) * (Number(l?.quantity) || 1)), 0) * 100) / 100,
      openedAt: String(v.startTime || v.createdAt || ''), hold: holdOf(v.cardHold) }; })
    .sort((a: any, b: any) => a.openedAt.localeCompare(b.openedAt));
}

/** Send the hold to the bar's reader. Sent again while it's still being asked for, it's the same payment. */
export async function startHold(db: any, tenantId: string, tenant: any, visitId: string, readerId: string, by: string, o: { stripe?: any } = {}): Promise<HoldAnswer> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) return fail('Card payments aren’t set up for this business yet.', 409, 'no_payments');
  if (!ID.test(visitId)) return fail('Which tab?', 400);
  if (!READER.test(String(readerId || ''))) return fail('Pick the bar’s card reader first.', 400, 'no_reader');
  const ref = visitRef(db, tenantId, visitId); const cents = holdDollarsOf(tenant) * 100;
  const claim: any = await db.runTransaction(async (tx: any) => {
    const v: any = (await tx.get(ref)).data(); if (!v || v.barTab !== true) return { error: 'That tab isn’t here.', status: 404 };
    if (v.status !== 'servicing') return { error: 'That tab is closed.', status: 409 };
    const h = holdOf(v.cardHold);
    if (h && ['held', 'charging', 'charged'].includes(h.state)) return { done: h };
    if (h?.state === 'starting' && !h.id && Date.now() - (Date.parse(h.at) || 0) < 60000) return { error: 'The card is being sent to the reader on another phone.', status: 409, code: 'starting' };
    if (h?.id && ['on_reader', 'starting', 'declined'].includes(h.state) && h.cents === cents) {
      tx.set(ref, { cardHold: { ...h, state: 'starting', readerId, at: nowIso(), by, failed: null } }, { merge: true });
      return { reuse: h.id, attempt: h.attempt };
    }
    const attempt = (h?.attempt || 0) + 1;
    tx.set(ref, { cardHold: { state: 'starting', id: null, cents, readerId, at: nowIso(), by, attempt, brand: null, last4: null, failed: null } }, { merge: true });
    return { attempt, old: h?.id && !['stopped', 'released'].includes(h.state) ? h.id : null };
  });
  if (claim.error) return fail(claim.error, claim.status, claim.code);
  if (claim.done) return { ok: true, hold: claim.done, already: true };
  // An old payment for another amount (the hold amount changed) is called off first.
  if (claim.old) await releaseReaderPayment(stripe, acct, claim.old, tenantId, { barHold: true }).catch(() => null);
  let pi: any = null;
  if (claim.reuse) {
    const g = await getPi(stripe, acct, claim.reuse);
    if (g.err === 'unknown') return fail(UNREACHABLE, 503, 'unknown');
    pi = g.pi;
    if (pi && ours(pi, tenantId, visitId) && pi.status === 'requires_capture') return checkHold(db, tenantId, tenant, visitId, { stripe });
    if (!pi || !ours(pi, tenantId, visitId) || pi.status === 'canceled') { await putHold(db, ref, { id: claim.reuse }, { state: 'stopped' }); return startHold(db, tenantId, tenant, visitId, readerId, by, { stripe }); }
  } else {
    try {
      pi = await stripe.paymentIntents.create({
        amount: cents, currency: 'usd', payment_method_types: ['card_present'], capture_method: 'manual',
        description: 'Bar tab, card held',
        metadata: { tenantId, source: 'terminal', kind: 'bar_hold', visitId, attempt: String(claim.attempt) },
      }, { stripeAccount: acct, idempotencyKey: holdKey(tenantId, visitId, claim.attempt) });
    } catch {
      await putHold(db, ref, { id: null, attempt: claim.attempt, from: ['starting'] }, { state: 'stopped' });
      return fail('The card hold couldn’t be started. Check the internet connection and try again. Nothing was charged.', 503);
    }
    if (!(await putHold(db, ref, { id: null, attempt: claim.attempt, from: ['starting'] }, { id: pi.id }))) {
      await releaseReaderPayment(stripe, acct, pi.id, tenantId, { barHold: true }).catch(() => null);
      return { ok: true, hold: holdOf(((await ref.get()).data() || {}).cardHold) };
    }
  }
  try {
    await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: pi.id, process_config: { skip_tipping: true } }, { stripeAccount: acct });
  } catch (e: any) {
    const on = String(e?.code || e?.raw?.code || '') === 'terminal_reader_busy' ? await readerOn(stripe, acct, readerId, pi.id) : null;
    if (!(on?.mine && on.status === 'in_progress')) {
      const words = readerTrouble(e);
      await putHold(db, ref, { id: pi.id, from: ['starting', 'on_reader', 'declined'] }, { state: 'declined', readerId, failed: words });
      return fail(words, 409, 'reader');
    }
  }
  await putHold(db, ref, { id: pi.id, from: ['starting', 'declined'] }, { state: 'on_reader', readerId, failed: null });
  return { ok: true, hold: holdOf(((await ref.get()).data() || {}).cardHold) };
}

/** How the hold is going, from the card company. */
export async function checkHold(db: any, tenantId: string, tenant: any, visitId: string, o: { stripe?: any } = {}): Promise<HoldAnswer> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!ID.test(visitId)) return fail('Which tab?', 400);
  const ref = visitRef(db, tenantId, visitId);
  const v: any = (await ref.get()).data(); if (!v || v.barTab !== true) return fail('That tab isn’t here.', 404);
  const h = holdOf(v.cardHold);
  if (!h || !h.id || !['starting', 'on_reader', 'declined'].includes(h.state)) return { ok: true, hold: h };
  if (!acct || !stripe) return fail('Card payments aren’t set up for this business yet.', 409, 'no_payments');
  const g = await getPi(stripe, acct, h.id);
  if (g.err === 'unknown') return { ok: true, hold: h };
  const pi = g.pi;
  if (!pi || !ours(pi, tenantId, visitId) || pi.status === 'canceled') { await putHold(db, ref, { id: h.id }, { state: 'stopped' }); return { ok: true, hold: holdOf(((await ref.get()).data() || {}).cardHold) }; }
  if (pi.status === 'requires_capture') {
    // Held. A tab closed meanwhile doesn't keep it.
    if (v.status !== 'servicing') { await releaseReaderPayment(stripe, acct, pi.id, tenantId, { barHold: true }).catch(() => null); await putHold(db, ref, { id: h.id }, { state: 'released' }); return { ok: true, hold: holdOf(((await ref.get()).data() || {}).cardHold) }; }
    await putHold(db, ref, { id: h.id, from: ['starting', 'on_reader', 'declined'] }, { state: 'held', failed: null, ...cardOf(pi), cents: Math.round(Number(pi.amount_capturable || pi.amount) || h.cents) });
    return { ok: true, hold: holdOf(((await ref.get()).data() || {}).cardHold) };
  }
  if (pi.status === 'processing') return { ok: true, hold: h };
  if (h.state === 'declined') return { ok: true, hold: h };
  if (Date.now() - (Date.parse(h.at) || 0) < 5000) return { ok: true, hold: h };
  const on = await readerOn(stripe, acct, h.readerId, pi.id);
  if (!on || (on.mine && on.status === 'in_progress')) return { ok: true, hold: h };
  const again = await getPi(stripe, acct, pi.id);
  if (again.pi?.status === 'requires_capture') return checkHold(db, tenantId, tenant, visitId, { stripe });
  const words = declineWords((on.mine ? on.message : null) || again.pi?.last_payment_error?.message || (on.mine ? '' : 'stopped waiting'));
  await putHold(db, ref, { id: pi.id, from: ['on_reader', 'starting'] }, { state: 'declined', failed: words });
  return { ok: true, hold: holdOf(((await ref.get()).data() || {}).cardHold) };
}

/** Call off the hold: the reader stops asking, or a held card is let go. Never one being charged. */
export async function stopHold(db: any, tenantId: string, tenant: any, visitId: string, o: { stripe?: any } = {}): Promise<HoldAnswer> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!ID.test(visitId)) return fail('Which tab?', 400);
  const ref = visitRef(db, tenantId, visitId);
  const v: any = (await ref.get()).data(); if (!v || v.barTab !== true) return fail('That tab isn’t here.', 404);
  const h = holdOf(v.cardHold);
  if (!h || ['stopped', 'released', 'charged'].includes(h.state)) return { ok: true, hold: h, already: true };
  if (h.state === 'charging') return fail('The desk is charging this card right now.', 409, 'charging');
  if (!h.id) { await putHold(db, ref, { id: null, attempt: h.attempt }, { state: 'stopped' }); return { ok: true, hold: holdOf(((await ref.get()).data() || {}).cardHold) }; }
  if (!acct || !stripe) return fail('Card payments aren’t set up for this business yet.', 409, 'no_payments');
  await readerLetGo(stripe, acct, h.readerId, h.id);
  const rel = await releaseReaderPayment(stripe, acct, h.id, tenantId, { barHold: true });
  if (!rel.ok && rel.status !== 'canceled') return fail(rel.status === 'succeeded' ? 'This card was already charged.' : rel.error || UNREACHABLE, rel.status === 'succeeded' ? 409 : 503);
  await putHold(db, ref, { id: h.id, from: ['starting', 'on_reader', 'held', 'declined'] }, { state: h.state === 'held' ? 'released' : 'stopped' });
  return { ok: true, hold: holdOf(((await ref.get()).data() || {}).cardHold) };
}

export type ChargeAnswer = { ok: true; paymentIntentId: string; amountCents: number; already?: boolean; sale?: string } | { ok: false; error: string; status: number; code?: string; paidWith?: any; paidPayload?: any };
/** The desk closes a tab on its held card: only the check, never more than what's held. The payment becomes the sale's
 *  own card reader payment, named on its started ticket first (lib/reader-sale), so it's never lost or taken twice. */
export async function chargeHold(db: any, tenantId: string, tenant: any, visitId: string, pendingId: string, amountCents: number, by: string, o: { stripe?: any } = {}): Promise<ChargeAnswer> {
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) return { ok: false, error: 'Card payments aren’t set up for this business yet.', status: 409, code: 'no_payments' };
  if (!ID.test(visitId) || !ID.test(pendingId)) return { ok: false, error: 'Which sale?', status: 400 };
  const cents = Math.round(Number(amountCents) || 0);
  if (cents < 50) return { ok: false, error: 'Card payments start at $0.50. Take this one another way.', status: 409, code: 'too_small' };
  const T = `tenants/${tenantId}`; const ref = visitRef(db, tenantId, visitId);
  // The sale's ticket: started, not finished or put away, not already paid, and with this tab on it.
  const ticket: any = (await db.doc(`${T}/pendingCheckouts/${pendingId}`).get()).data();
  if (!ticket) return { ok: false, error: 'The sale wasn’t found. Start it again. Nothing was charged.', status: 404, code: 'no_ticket' };
  if (ticket.status === 'completed') return { ok: false, error: 'This sale is already finished.', status: 409, code: 'sale_done' };
  if (ticket.status === 'discarded' || ticket.status === 'discarding') return { ok: false, error: 'This sale was discarded. Ring it up again. Nothing was charged.', status: 409, code: 'sale_discarded' };
  const paid = ticketPayment(ticket);
  if (paid && paid.id !== (holdOf((await ref.get()).data()?.cardHold)?.id || '')) return { ok: false, code: 'ticket_paid', paidWith: paid, paidPayload: paidPayloadOf(ticket), status: 409,
    error: `This sale was already paid${paid.cents ? `: $${(paid.cents / 100).toFixed(2)}` : ''} ${viaWords(paid.via)}. Save the sale with that payment. Nothing was charged.` };
  if (liveShares(ticket).length) return { ok: false, code: 'ticket_split', status: 409, error: 'Part of this bill was already paid in a split. Finish it in Split the bill. Nothing was charged.' };
  if (!paidPayloadOf(ticket).appointmentIds.includes(visitId)) return { ok: false, error: 'This tab isn’t on the sale. Open it from the bar’s tabs. Nothing was charged.', status: 409, code: 'not_on_sale' };
  // Claimed in one step: two desks can't both charge it.
  const claim: any = await db.runTransaction(async (tx: any) => {
    const v: any = (await tx.get(ref)).data(); const h = holdOf(v?.cardHold);
    if (!v || v.barTab !== true || !h || !h.id) return { error: 'This tab has no card held.', status: 409, code: 'no_hold' };
    if (h.state === 'charged' && h.pendingId === pendingId) return { again: h };
    if (h.state === 'charging' && h.pendingId === pendingId) return { again: h };
    if (h.state !== 'held') return { error: h.state === 'charging' ? 'This card is being charged on another screen.' : 'This tab’s card isn’t held any more. Take the payment another way.', status: 409, code: 'not_held' };
    if (cents > h.cents) return { error: `The check is more than the $${(h.cents / 100).toFixed(2)} held on the card. Take it on the card reader instead (the held card is let go).`, status: 409, code: 'over_hold' };
    tx.set(ref, { cardHold: { ...h, state: 'charging', pendingId, chargedCents: cents, chargingAt: nowIso(), chargingBy: by.slice(0, 60) } }, { merge: true });
    return { hold: h };
  });
  if (claim.error) return { ok: false, error: claim.error, status: claim.status, code: claim.code };
  const h: CardHold = claim.hold || claim.again;
  const piId = String(h.id);
  let pi: any = (await getPi(stripe, acct, piId)).pi;
  if (!pi || !ours(pi, tenantId, visitId)) { await putHold(db, ref, { id: piId }, { state: 'stopped' }); return { ok: false, error: 'This tab’s held card isn’t there any more. Take the payment another way. Nothing was charged.', status: 409, code: 'not_held' }; }
  if (pi.status === 'succeeded') {
    if (String(pi.metadata?.pendingId || '') !== pendingId) return { ok: false, error: 'This card was already charged for another sale.', status: 409, code: 'other_sale' };
  } else if (pi.status === 'requires_capture') {
    // Taken for the check only, and named as the sale's own payment in the same step: until it's taken it's still only
    // the tab's hold (on no ticket), so nothing else can take it, and nothing can take it in full.
    try {
      pi = await stripe.paymentIntents.capture(piId, { amount_to_capture: cents, metadata: { ...(pi.metadata || {}), kind: 'sale', pendingId, barHold: '1' } }, { stripeAccount: acct, idempotencyKey: `bar-capture-${piId}-${cents}` });
    } catch {
      const again = await getPi(stripe, acct, piId);
      if (again.pi?.status === 'succeeded') pi = again.pi;
      else if (again.pi?.status === 'requires_capture') {
        // Not taken: still held for the tab, for another try or another way.
        await putHold(db, ref, { id: piId, from: ['charging'] }, { state: 'held', pendingId: null, chargedCents: null });
        return { ok: false, error: UNREACHABLE, status: 503, code: 'unknown' };
      } else if (again.pi?.status === 'canceled') {
        await putHold(db, ref, { id: piId, from: ['charging'] }, { state: 'stopped' });
        return { ok: false, error: 'This tab’s held card was let go. Take the payment another way. Nothing was charged.', status: 409, code: 'not_held' };
      } else return { ok: false, error: UNREACHABLE, status: 503, code: 'unknown' };
    }
  } else {
    await putHold(db, ref, { id: piId }, { state: pi.status === 'canceled' ? 'stopped' : 'declined' });
    return { ok: false, error: 'This tab’s held card can’t be charged any more. Take the payment another way. Nothing was charged.', status: 409, code: 'not_held' };
  }
  await recordReaderFee(db, stripe, acct, tenantId, piId).catch(() => undefined);
  const m = await markReaderSalePaid(db, tenantId, pendingId, pi);
  if (m.fresh && m.result === 'paid_twice') await tellDeskReader(db, tenantId, 'paid_twice', ticket, Math.round(Number(pi.amount_received) || cents), pendingId).catch(() => {});
  await putHold(db, ref, { id: piId }, { state: 'charged', pendingId, chargedCents: Math.round(Number(pi.amount_received) || cents) });
  return { ok: true, paymentIntentId: piId, amountCents: Math.round(Number(pi.amount_received) || cents), ...(claim.again ? { already: true } : {}), sale: m.result };
}

/** EVERY FEW MINUTES (cron/retail-payments): held cards on tabs paid another way are let go; cards left asking on the
 *  reader are stopped after 15 minutes; a charge whose answer was lost is recorded on its sale; a tab still held after 12
 *  hours is told to the managers once. */
export async function sweepBarHolds(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; released: number; told: number }> {
  const out = { checked: 0, released: 0, told: 0 };
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe(); if (!acct || !stripe) return out;
  const now = o.now ?? Date.now();
  const snap = await db.collection(`tenants/${tenantId}/appointments`).where('cardHold.state', 'in', ['starting', 'on_reader', 'held', 'charging', 'declined']).limit(60).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) {
    const v: any = d.data() || {}; const h = holdOf(v.cardHold); if (!h) continue;
    out.checked++;
    const age = now - (Date.parse(String((v.cardHold || {}).chargingAt || h.at)) || now);
    if (h.state === 'charging' && h.pendingId && age > 5 * 60000 && h.id) {
      const g = await getPi(stripe, acct, h.id); if (g.err) continue;
      if (g.pi?.status === 'succeeded') { const m = await markReaderSalePaid(db, tenantId, h.pendingId, g.pi); if (m.fresh) { const pc: any = (await db.doc(`tenants/${tenantId}/pendingCheckouts/${h.pendingId}`).get()).data() || {}; await tellDeskReader(db, tenantId, m.result === 'paid_twice' ? 'paid_twice' : 'unrecorded', pc, Math.round(Number(g.pi.amount_received) || 0), h.pendingId).catch(() => {}); } await putHold(db, d.ref, { id: h.id }, { state: 'charged' }); }
      else if (g.pi?.status === 'requires_capture') await putHold(db, d.ref, { id: h.id, from: ['charging'] }, { state: 'held', pendingId: null, chargedCents: null });
      else if (g.pi?.status === 'canceled') await putHold(db, d.ref, { id: h.id, from: ['charging'] }, { state: 'stopped' });
      continue;
    }
    if (h.state === 'held' && v.status !== 'servicing') { const r = await stopHold(db, tenantId, tenant, d.id, { stripe }); if (r.ok) out.released++; continue; }
    if (['starting', 'on_reader', 'declined'].includes(h.state)) {
      if (h.id) { const c = await checkHold(db, tenantId, tenant, d.id, { stripe }); if (c.ok && c.hold?.state === 'held') continue; }
      if (age > 15 * 60000 && (v.status !== 'servicing' || ['starting', 'on_reader', 'declined'].includes(String(holdOf(((await d.ref.get()).data() || {}).cardHold)?.state)))) { const r = await stopHold(db, tenantId, tenant, d.id, { stripe }); if (r.ok) out.released++; }
      continue;
    }
    if (h.state === 'held' && age > 12 * 3600000 && !v.cardHoldToldAt) {
      const mine = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(d.ref)).data(); if (!cur || cur.cardHoldToldAt) return false; tx.set(d.ref, { cardHoldToldAt: new Date(now).toISOString() }, { merge: true }); return true; }).catch(() => false);
      if (mine) { const sent = await tellManagers(db, tenantId, tenant, { type: 'bar_tab_open', priority: 'high', link: '/bar-tabs', message: `${String(v.clientName || 'A bar tab')}’s tab is still open with a card held from ${new Date(h.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tenantTimeZone(tenant) })}. Close it at the desk, or let the card go.` }); if (sent > 0) out.told++; }
    }
  }
  return out;
}
