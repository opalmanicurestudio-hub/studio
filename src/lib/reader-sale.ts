// src/lib/reader-sale.ts — A SALE PAID ON THE CARD READER IS NEVER CHARGED TWICE OR LOST (server).
// Before any card is charged, the desk saves the sale as a started ticket (pendingCheckouts, /api/checkout/complete
// 'prepare'). Every reader payment for the sale is named on that ticket as it begins, so the money is accounted for
// whatever happens to the screen:
//  - captured: the ticket shows it's paid. The desk records the sale with it; if it doesn't, a manager sees it in Needs
//    attention, under Sales not recorded, and records it there without charging again.
//  - the screen asks again (the answer was lost): capturing is safe to repeat, and says whether the card was charged.
//  - the desk tries again: an earlier payment for the ticket that went through is used instead of charging again.
//  - the screen closed after the reader approved the card but before it was captured: the sweep captures it (the reader
//    told the customer it was approved) and the ticket shows it's paid, unless the sale was paid another way, when
//    the hold on their card is released.
//  - paid twice (on the reader, the client screen, a saved card or a typed card, after the ticket was already paid):
//    the second payment is kept apart, the desk and managers are told, and a manager refunds or keeps it.
// When Stripe can't be reached, nothing is assumed: a payment is only "not charged" when Stripe says it doesn't exist
// or wasn't approved, and one that was refunded never pays for a sale.
// Only a payment taken at the desk FOR THIS SALE is ever accepted, kept apart or refunded from a ticket: the payment
// itself names its ticket (set by the server when it was created). An online order, a gift card bought in the shop, a
// booking deposit, an address change or another sale's payment never is, whatever id the screen sends.
import Stripe from 'stripe';
import { tenantTimeZone } from '@/lib/tenant-time';
import { recordChargeFee } from '@/lib/stripe-fee';
import { viaWords } from '@/lib/pay-via';
export { viaWords, viaOfMethod } from '@/lib/pay-via';

export type ReaderCheck = { ok: boolean; status: string; pi?: any; already?: boolean; charged?: boolean; refunded?: boolean; error?: string };
export type ReaderSaleMark = { result: 'waiting' | 'recorded' | 'paid_twice' | 'no_ticket'; fresh: boolean; revived?: boolean };
export type DeskPayment =
  | { ok: true; id: string; pi: any; via: string; cents: number; share: boolean; legacy: boolean }
  | { ok: false; status: 'unknown' | 'missing' | 'other' | 'processing' | 'not_paid' | 'refunded' | 'not_desk' | 'other_ticket'; error: string; pi?: any; forTicket?: string; via?: string };
export type TicketBlock = { status: number; code: string; error: string; paidWith?: TicketPaid; paidPayload?: any };
export type TicketPaid = { id: string; cents: number; via: string; tip?: number; tipAllocations?: Record<string, number> | null };

const centsOf = (pi: any) => Math.round(Number(pi?.amount_received || pi?.amount) || 0);
const money = (c: number) => `$${(Math.round(Number(c) || 0) / 100).toFixed(2)}`;
const nowIso = () => new Date().toISOString();
export const safeId = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
// A payment not finished yet: it can still be cancelled, and is never charged once it is.
const UNFINISHED = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'];
// What the sweep is done with: anything but a payment still being started.
const SETTLED = ['captured', 'recorded', 'paid_twice', 'released', 'not_charged', 'refunded'];
const UNREACHABLE = 'We couldn’t reach card payments to check it. Nothing new was charged. Try again in a moment.';

export function readerStripe(): any | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
}
export const accountOf = (t: any) => t?.stripeAccountId || t?.stripeConnectAccountId || null;
const ticketRef = (db: any, tenantId: string, pendingId: string) => db.doc(`tenants/${tenantId}/pendingCheckouts/${safeId(pendingId)}`);

/** The payment a started ticket is already paid with (and not refunded), if any. */
export function ticketPayment(pc: any): TicketPaid | null {
  if (!pc || !pc.paymentIntentId || pc.paymentRefundedAt) return null;
  if (!['paid_waiting', 'failed'].includes(String(pc.status || ''))) return null;
  const tip = Math.round((Number(pc.paidTip) || 0) * 100) / 100;   // a tip chosen on the client screen, in the payment
  return { id: String(pc.paymentIntentId), cents: Math.round(Number(pc.paidCents) || 0), via: String(pc.paidVia || 'card'), ...(tip > 0 ? { tip, tipAllocations: pc.paidTipAllocations || null } : {}) };
}
/** The shares of a split bill already taken on a ticket. */
export const liveShares = (pc: any): any[] => (Array.isArray(pc?.tenders) ? pc.tenders.filter((x: any) => x && !x.refundedAt) : []);
const sharesTotal = (pc: any) => Math.round(liveShares(pc).reduce((s, x) => s + (Number(x.amount) || 0) + (Number(x.tip) || 0), 0) * 100);
/** A ticket a new payment can pay for: nothing paid on it yet. */
const payable = (pc: any) => ['prepared', 'failed'].includes(String(pc?.status || 'prepared')) && !pc?.paymentIntentId && !liveShares(pc).length;
/** Put away by the system when the desk moved on to another sale before anything was paid: a payment for it that lands
 *  after that (the client finished paying on the client screen) brings it back as paid, so it's recorded, not lost. */
const revivable = (pc: any) => pc?.status === 'discarded' && pc?.discardedBy === 'System' && !pc?.paymentIntentId && !pc?.paymentRefundedAt && !liveShares(pc).length;

/** What a paid ticket was rung up with (visits, items and fees), so the desk can save it as it was paid and keep only
 *  what was added since as a new sale. */
export function paidPayloadOf(pc: any): { appointmentIds: string[]; items: { id: string; type: string; quantity: number; name: string | null }[]; feeIds: string[]; paidAt: string | null } {
  const p: any = pc?.payload || {};
  return {
    appointmentIds: (Array.isArray(p.appointmentIds) ? p.appointmentIds : []).map(String).slice(0, 20),
    items: (Array.isArray(p.items) ? p.items : []).slice(0, 60).map((it: any) => ({ id: String(it?.id || ''), type: String(it?.type || 'product'), quantity: Math.max(1, Math.round(Number(it?.quantity) || 1)), name: it?.name ? String(it.name).slice(0, 80) : null })),
    feeIds: (Array.isArray(p.feeIds) ? p.feeIds : []).map(String).slice(0, 40),
    paidAt: pc?.paidAt || null,
  };
}

/** The ticket a payment says it was taken for at the desk, and how — or null when it isn't a desk sale payment at all.
 *  Only the payment's own metadata says so (the server sets it when the payment is created). `share`: one share of a
 *  split bill, never the whole sale. */
export function deskPaymentOf(pi: any, tenantId: string): { pendingId: string; via: string; share: boolean } | null {
  const m: any = pi?.metadata || {};
  if (String(m.tenantId || '') !== String(tenantId)) return null;
  const share = m.split === '1';
  if (m.source === 'terminal' && m.kind === 'sale' && safeId(m.pendingId)) return { pendingId: safeId(m.pendingId), via: 'card_reader', share: false };
  if (m.source === 'client_screen' && safeId(m.pendingCheckoutId)) return { pendingId: safeId(m.pendingCheckoutId), via: 'client_screen', share };
  if (m.kind === 'pos_cof' && safeId(m.pendingId)) return { pendingId: safeId(m.pendingId), via: 'card_on_file', share };
  if (m.source === 'pos_embedded' && safeId(m.pendingId)) return { pendingId: safeId(m.pendingId), via: 'card', share: false };
  return null;
}

// A desk payment from a screen opened before payments named their ticket (it hasn't been reloaded since): a saved card
// charged for a checkout or a split share, a typed card, or a client-screen payment, naming no ticket at all, from the
// last day. It can pay for the sale it's offered with; one that names a ticket only ever goes with that ticket.
const LEGACY_DESK_MS = 24 * 3600000;
function legacyDeskPayment(pi: any, now = Date.now()): string | null {
  const m: any = pi?.metadata || {};
  if (safeId(m.pendingId) || safeId(m.pendingCheckoutId)) return null;
  const made = Number(pi?.created) * 1000; if (!(made > 0) || now - made > LEGACY_DESK_MS) return null;
  const d = String(pi?.description || '');
  if (m.kind === 'pos_cof' && (d.startsWith('Studio Services — POS Checkout') || d.startsWith('Share of a split bill'))) return 'card_on_file';
  if (m.source === 'pos_embedded') return 'card';
  if (m.source === 'client_screen') return 'client_screen';
  return null;
}

/** Was any of this payment given back? A refunded payment never pays for a sale. */
export function refundedOf(pi: any): boolean {
  const ch = pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  return !!ch && (ch.refunded === true || Number(ch.amount_refunded) > 0);
}
// Only Stripe saying it doesn't exist means "missing". A timeout, a rate limit or an outage means we don't know yet.
const isMissing = (e: any) => e?.code === 'resource_missing' || e?.raw?.code === 'resource_missing' || e?.statusCode === 404 || e?.raw?.statusCode === 404;

async function load(stripe: any, acct: string, id: string, tenantId: string): Promise<{ pi?: any; err?: ReaderCheck }> {
  let pi: any = null;
  try { pi = await stripe.paymentIntents.retrieve(String(id), { expand: ['latest_charge'] }, { stripeAccount: acct }); }
  catch (e: any) {
    if (isMissing(e)) return { err: { ok: false, status: 'missing', charged: false, error: 'That card payment wasn’t found.' } };
    return { err: { ok: false, status: 'unknown', error: UNREACHABLE } };
  }
  if (!pi) return { err: { ok: false, status: 'missing', charged: false, error: 'That card payment wasn’t found.' } };
  if (String(pi.metadata?.tenantId || '') !== String(tenantId)) return { err: { ok: false, status: 'other', error: 'That card payment isn’t this business’s.' } };
  return { pi };
}

/** A card payment offered for a ticket, checked with Stripe: it went through, it's this business's, nothing of it was
 *  refunded, and it was taken at the desk for THIS ticket. `unknown`: Stripe couldn't be reached, so nothing may be
 *  assumed about it. `other_ticket` carries the ticket it was taken for. */
export async function checkDeskPayment(stripe: any, acct: string, id: string, tenantId: string, pendingId: string): Promise<DeskPayment> {
  const pid = String(id || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 80);
  if (!pid) return { ok: false, status: 'missing', error: 'That card payment has no reference.' };
  const l = await load(stripe, acct, pid, tenantId);
  if (l.err) return { ok: false, status: l.err.status === 'unknown' ? 'unknown' : l.err.status === 'other' ? 'other' : 'missing', error: l.err.error || UNREACHABLE };
  const pi = l.pi;
  if (pi.status === 'processing') return { ok: false, status: 'processing', pi, error: 'That card payment is still being processed. Try again in a moment.' };
  if (pi.status !== 'succeeded') return { ok: false, status: 'not_paid', pi, error: 'That card payment didn’t go through.' };
  if (refundedOf(pi)) return { ok: false, status: 'refunded', pi, error: 'That card payment was refunded, so it can’t pay for this sale.' };
  const desk = deskPaymentOf(pi, tenantId);
  if (desk) {
    if (desk.pendingId !== safeId(pendingId)) return { ok: false, status: 'other_ticket', pi, forTicket: desk.pendingId, via: desk.via, error: 'That card payment was taken for another sale.' };
    return { ok: true, id: pid, pi, via: desk.via, cents: centsOf(pi), share: desk.share, legacy: false };
  }
  const old = legacyDeskPayment(pi);
  if (old) return { ok: true, id: pid, pi, via: old, cents: centsOf(pi), share: String(pi.description || '').startsWith('Share of a split bill'), legacy: true };
  return { ok: false, status: 'not_desk', pi, error: 'That card payment wasn’t taken at the desk for this sale.' };
}

/** Settle one reader payment: capture it if the reader approved the card and it isn't captured yet. Safe to repeat,
 *  and the answer says whether the card was charged. `requires_capture` / `unknown` in the answer: not settled yet
 *  (ask again); a refunded payment says so and can't pay for anything. */
export async function captureReaderPayment(stripe: any, acct: string, id: string, tenantId: string): Promise<ReaderCheck> {
  const l = await load(stripe, acct, id, tenantId); if (l.err) return l.err;
  let pi = l.pi;
  if (pi.status === 'succeeded') {
    if (refundedOf(pi)) return { ok: false, status: 'refunded', pi, refunded: true, error: 'That card payment was refunded, so it can’t pay for this sale. Take the payment again.' };
    return { ok: true, status: 'succeeded', pi, already: true, charged: true };
  }
  if (pi.status === 'requires_capture') {
    try { pi = await stripe.paymentIntents.capture(String(id), {}, { stripeAccount: acct, idempotencyKey: `reader-capture-${id}` }); }
    catch (e: any) {
      const again = await load(stripe, acct, id, tenantId);
      if (again.pi?.status === 'succeeded') return { ok: true, status: 'succeeded', pi: again.pi, already: true, charged: true };
      if (again.err?.status === 'unknown') return again.err;
      // Still approved but not captured: not settled, so the screen asks again rather than saying it wasn't charged.
      if (again.pi?.status === 'requires_capture') return { ok: false, status: 'requires_capture', pi: again.pi, error: 'The payment was approved but couldn’t be finished yet. Check again: the card won’t be charged twice.' };
      return { ok: false, status: again.pi?.status || 'error', pi: again.pi, charged: false, error: String(e?.message || 'The payment couldn’t be captured.').slice(0, 200) };
    }
    return pi?.status === 'succeeded' ? { ok: true, status: 'succeeded', pi, charged: true } : { ok: false, status: String(pi?.status || 'error'), pi, error: 'The payment couldn’t be captured.' };
  }
  if (pi.status === 'processing') return { ok: false, status: 'processing', pi, error: 'The card payment is still being processed.' };
  return { ok: false, status: String(pi.status), pi, charged: false, error: 'The card wasn’t charged.' };
}

/** Call off a reader payment that hasn't gone through, so it never can: a hold on the card is released. One that
 *  already went through isn't touched, and the answer says so. `readerOnly`: refuse anything not started on the reader
 *  (a client-screen payment or a typed card is never cancelled from here). */
export async function releaseReaderPayment(stripe: any, acct: string, id: string, tenantId: string, o: { readerOnly?: boolean } = {}): Promise<ReaderCheck> {
  const l = await load(stripe, acct, id, tenantId); if (l.err) return l.err;
  const pi = l.pi;
  if (o.readerOnly && String(pi.metadata?.source || '') !== 'terminal') return { ok: false, status: 'other', pi, error: 'That isn’t a card reader payment.' };
  if (pi.status === 'succeeded') return { ok: false, status: 'succeeded', pi, charged: true, refunded: refundedOf(pi), error: 'This card payment already went through.' };
  if (pi.status === 'canceled') return { ok: true, status: 'canceled', pi, already: true, charged: false };
  if (pi.status === 'processing') return { ok: false, status: 'processing', pi, error: 'The card payment is still being processed.' };
  try {
    const c = await stripe.paymentIntents.cancel(String(id), {}, { stripeAccount: acct, idempotencyKey: `reader-release-${id}` });
    return { ok: true, status: String(c?.status || 'canceled'), pi: c, charged: false };
  } catch (e: any) {
    const again = await load(stripe, acct, id, tenantId);
    if (again.pi?.status === 'succeeded') return { ok: false, status: 'succeeded', pi: again.pi, charged: true, error: 'This card payment already went through.' };
    if (again.pi?.status === 'canceled') return { ok: true, status: 'canceled', pi: again.pi, charged: false };
    if (again.err?.status === 'unknown') return again.err;
    return { ok: false, status: again.pi?.status || 'error', pi: again.pi, error: String(e?.message || 'The payment couldn’t be cancelled.').slice(0, 200) };
  }
}

/** The exact Stripe fee, written once a reader payment is captured — whoever captured it (the desk, a retry, the
 *  sweep). Never blocks anything: the payment notice records it too (lib/stripe-fee). */
export async function recordReaderFee(db: any, stripe: any, acct: string, tenantId: string, piId: string): Promise<void> {
  try {
    const full: any = await stripe.paymentIntents.retrieve(String(piId), { expand: ['latest_charge.balance_transaction'] } as any, { stripeAccount: acct });
    if (full?.latest_charge && typeof full.latest_charge === 'object') await recordChargeFee(db, stripe, tenantId, acct, full.latest_charge);
  } catch (e) { console.warn('[reader-sale] fee not recorded yet (the payment notice records it)', e); }
}

/** The ticket learns a reader payment started for it (before the reader is handed the card). */
export async function noteReaderStart(db: any, tenantId: string, pendingId: string, piId: string, cents: number, by: string | null) {
  const at = nowIso();
  await ticketRef(db, tenantId, pendingId).set({ readerPis: { [piId]: { at, cents: Math.round(cents), by: by || null, state: 'started' } }, readerOpen: true, lastReaderAt: at, updatedAt: at }, { merge: true });
}

async function noteState(db: any, tenantId: string, pendingId: string, piId: string, state: string) {
  await ticketRef(db, tenantId, pendingId).set({ readerPis: { [piId]: { state, settledAt: nowIso() } }, updatedAt: nowIso() }, { merge: true }).catch(() => {});
}

/** A payment that went through, on its ticket — however it was taken (`via`: card_reader, client_screen,
 *  card_on_file, card): it pays for the sale when nothing was paid on the ticket yet (the desk records the sale with
 *  it), it was already recorded, or the ticket was already paid and it's a second payment, kept apart for a manager.
 *  Once per payment: asking again changes nothing. `extra`: more about the payment to keep on the ticket (a tip chosen
 *  on the client screen), so a manager recording the sale later records it as it was paid. */
export async function markSalePaid(db: any, tenantId: string, pendingId: string, pi: any, via: string, extra: Record<string, any> = {}): Promise<ReaderSaleMark> {
  const ref = ticketRef(db, tenantId, pendingId);
  const id = String(pi?.id || ''); const c = centsOf(pi); const reader = via === 'card_reader';
  let fresh = false; let revived = false;
  const result = await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref); const pc: any = snap.exists ? snap.data() : null;
    if (!pc) return 'no_ticket';
    const at = nowIso(); const status = String(pc.status || 'prepared');
    if (pc.paymentIntentId === id) {
      const done = status === 'completed';
      // Told again about the payment it's paid with: what else is known about it (a tip chosen on the client screen)
      // is kept, whoever told first.
      const more = !done && Object.keys(extra).length ? extra : {};
      if ((reader && pc.readerPis?.[id]?.state !== (done ? 'recorded' : 'captured')) || Object.keys(more).length)
        tx.set(ref, { ...more, ...(reader ? { readerPis: { [id]: { state: done ? 'recorded' : 'captured', capturedAt: pc.readerPis?.[id]?.capturedAt || at } } } : {}), updatedAt: at }, { merge: true });
      return done ? 'recorded' : 'waiting';
    }
    if (payable(pc) || revivable(pc)) {
      fresh = true; revived = revivable(pc);
      tx.set(ref, { status: 'paid_waiting', paymentIntentId: id, paidAt: at, paidVia: via, paidCents: c, updatedAt: at, ...extra, ...(reader ? { readerPis: { [id]: { state: 'captured', capturedAt: at } } } : {}),
        ...(revived ? { discardedAt: null, discardedBy: null, discardReason: null, revivedAt: at, note: 'Paid after the desk had moved on to another sale.' } : {}) }, { merge: true });
      return 'waiting';
    }
    if (pc.readerExtra?.[id]) return 'paid_twice';
    fresh = true;
    // Why it's extra, so a manager refunds the right one: the sale was saved without a card payment (it may be the one
    // that paid for it), or it was discarded before this payment went through.
    const hint = status === 'completed' && !pc.paymentIntentId && !liveShares(pc).length ? 'saved_without_card' : status === 'discarded' ? 'discarded' : null;
    tx.set(ref, { readerExtra: { [id]: { cents: c, at, state: 'open', via, ...(hint ? { hint } : {}) } }, readerExtraOpen: true, updatedAt: at, ...(reader ? { readerPis: { [id]: { state: 'paid_twice', capturedAt: at } } } : {}) }, { merge: true });
    return 'paid_twice';
  });
  return { result, fresh, ...(revived ? { revived: true } : {}) };
}
/** A captured reader payment, on its ticket (see markSalePaid). */
export const markReaderSalePaid = (db: any, tenantId: string, pendingId: string, pi: any) => markSalePaid(db, tenantId, pendingId, pi, 'card_reader');

/** A second payment offered for a ticket that's already paid (the desk took cash or a card while the screen had lost
 *  track): checked with Stripe — it went through, nothing of it was refunded, it was taken at the desk for this very
 *  sale, and it isn't on a receipt — then kept apart on the ticket for a manager, and the desk and managers are told.
 *  Returns it, or null when it isn't this sale's payment (it's never listed, so it can never be refunded from here). */
export async function keepApartPayment(db: any, tenantId: string, pendingId: string, piId: string): Promise<{ id: string; cents: number } | null> {
  const tenant: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const acct = accountOf(tenant); const stripe = readerStripe(); if (!acct || !stripe) return null;
  const c = await checkDeskPayment(stripe, acct, piId, tenantId, pendingId); if (!c.ok) return null;
  const onReceipt = await db.collection(`tenants/${tenantId}/receipts`).where('stripePaymentIntentId', '==', c.id).limit(1).get().catch(() => ({ empty: true }));
  if (!onReceipt.empty) return null;
  const m = await markSalePaid(db, tenantId, pendingId, c.pi, c.via);
  if (m.fresh && m.result === 'paid_twice') {
    const pc: any = ((await ticketRef(db, tenantId, pendingId).get()).data() as any) || {};
    await tellDeskReader(db, tenantId, 'paid_twice', pc, c.cents, pendingId, c.via).catch(() => {});
  }
  return m.result === 'paid_twice' ? { id: c.id, cents: c.cents } : null;
}

/** Before another payment is taken for a ticket (a saved card, a typed card, the client screen): is it still open for
 *  one? Never when it's finished, discarded, already paid, part paid in a split (unless this is a share), or has a card
 *  reader payment still going. Returns why not, or null. */
export async function ticketBlocks(db: any, tenantId: string, pendingId: string, o: { share?: boolean; stripe?: any; acct?: string | null } = {}): Promise<TicketBlock | null> {
  const id = safeId(pendingId); if (!id) return { status: 400, code: 'no_ticket', error: 'The sale wasn’t saved before charging. Check the internet connection and try again. Nothing was charged.' };
  const pc: any = ((await ticketRef(db, tenantId, id).get()).data() as any) || null;
  if (!pc) return { status: 404, code: 'no_ticket', error: 'The sale wasn’t found. Start it again. Nothing was charged.' };
  if (pc.status === 'completed') return { status: 409, code: 'sale_done', error: 'This sale was already saved. Nothing was charged.' };
  if (pc.status === 'discarded') return { status: 409, code: 'sale_discarded', error: 'This sale was discarded. Ring it up again. Nothing was charged.' };
  const paid = ticketPayment(pc);
  if (paid) return { status: 409, code: 'ticket_paid', paidWith: paid, paidPayload: paidPayloadOf(pc), error: `This sale was already paid${paid.cents ? `: ${money(paid.cents)}` : ''} ${viaWords(paid.via)}. Save the sale with that payment. Nothing was charged.` };
  if (!o.share && liveShares(pc).length) return { status: 409, code: 'ticket_split', error: 'Part of this bill was already paid in a split. Finish it in Split the bill. Nothing was charged.' };
  // A card reader payment still going for it: settled first (one that went through pays for it; one never finished is
  // called off), so the card is never charged a second way on top of it.
  if (Object.values<any>(pc.readerPis || {}).some((e) => !SETTLED.includes(String(e?.state)))) {
    const s = await settleTicketReader(db, tenantId, id, 'pay', { stripe: o.stripe, acct: o.acct });
    if (!s.ok) return { status: s.status === 'unknown' ? 503 : 409, code: s.status === 'unknown' ? 'reader_unknown' : 'reader_open', error: s.error };
    const after: any = ((await ticketRef(db, tenantId, id).get()).data() as any) || {};
    const nowPaid = ticketPayment(after);
    if (nowPaid) return { status: 409, code: 'ticket_paid', paidWith: nowPaid, paidPayload: paidPayloadOf(after), error: `This sale was already paid: ${money(nowPaid.cents)} ${viaWords(nowPaid.via)}. Save the sale with that payment. Nothing was charged.` };
  }
  return null;
}

/** The card reader payments still open on a ticket, settled with Stripe before anything else happens to it — so a sale is
 *  never recorded without the payment that went through for it, and an approved hold is never left to complete later.
 *  Went through → the ticket shows it's paid with it (or paid twice). Approved but not captured → captured when the
 *  sale is being recorded (the reader told the client it was approved), released when it's being discarded, and left
 *  for the desk to check when another payment is about to be taken. Never finished → called off. `unknown` /
 *  `processing` / `approved`: one can't be settled yet, so nothing else may happen to the ticket now. */
export async function settleTicketReader(db: any, tenantId: string, pendingId: string, mode: 'record' | 'discard' | 'pay', o: { stripe?: any; acct?: string | null } = {}):
  Promise<{ ok: true } | { ok: false; status: 'unknown' | 'processing' | 'approved'; id: string; error: string }> {
  const ref = ticketRef(db, tenantId, pendingId);
  const pc: any = ((await ref.get()).data() as any) || {};
  const open = Object.entries<any>(pc.readerPis || {}).filter(([, e]) => !SETTLED.includes(String(e?.state)));
  if (!open.length) return { ok: true };
  let acct = o.acct || null; if (!acct) { const tenant: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {}; acct = accountOf(tenant); }
  const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) return { ok: false, status: 'unknown', id: open[0][0], error: 'Card payments aren’t set up, so the card reader payment on this sale can’t be checked.' };
  for (const [id] of open) {
    const l = await load(stripe, acct, id, tenantId);
    if (l.err) {
      if (l.err.status === 'unknown') return { ok: false, status: 'unknown', id, error: 'We couldn’t reach card payments to check this sale’s card reader payment. Nothing was changed. Try again in a moment.' };
      await noteState(db, tenantId, pendingId, id, 'not_charged'); continue;
    }
    const pi = l.pi;
    if (pi.status === 'succeeded') {
      if (refundedOf(pi)) { await noteState(db, tenantId, pendingId, id, 'refunded'); continue; }
      const m = await markReaderSalePaid(db, tenantId, pendingId, pi);
      if (m.fresh && m.result === 'paid_twice') await tellDeskReader(db, tenantId, 'paid_twice', pc, centsOf(pi), pendingId).catch(() => {});
      continue;
    }
    if (pi.status === 'requires_capture') {
      const cur: any = ((await ref.get()).data() as any) || {};
      const paidOtherwise = !payable(cur) && cur.paymentIntentId !== id;
      if (mode === 'pay' && !paidOtherwise) return { ok: false, status: 'approved', id, error: 'The card reader approved a payment for this sale that isn’t finished yet. Check it on the card reader screen first. Nothing was charged.' };
      if (mode === 'record' && !paidOtherwise) {
        const c = await captureReaderPayment(stripe, acct, id, tenantId);
        if (c.ok) { await recordReaderFee(db, stripe, acct, tenantId, id); await markReaderSalePaid(db, tenantId, pendingId, c.pi); continue; }
        if (c.status === 'unknown' || c.status === 'requires_capture') return { ok: false, status: 'unknown', id, error: 'The card reader payment for this sale couldn’t be finished just now. Nothing was changed. Try again in a moment.' };
        continue;
      }
      const r = await releaseReaderPayment(stripe, acct, id, tenantId);
      if (r.ok) { await noteState(db, tenantId, pendingId, id, 'released'); continue; }
      if (r.charged && !r.refunded) { await markReaderSalePaid(db, tenantId, pendingId, r.pi); continue; }
      return { ok: false, status: 'unknown', id, error: 'The card reader payment for this sale couldn’t be released just now. Nothing was changed. Try again in a moment.' };
    }
    if (pi.status === 'processing') return { ok: false, status: 'processing', id, error: 'A card reader payment for this sale is still being processed. Try again in a minute.' };
    if (pi.status === 'canceled') { await noteState(db, tenantId, pendingId, id, 'not_charged'); continue; }
    if (UNFINISHED.includes(String(pi.status))) {
      const r = await releaseReaderPayment(stripe, acct, id, tenantId);
      if (r.ok) { await noteState(db, tenantId, pendingId, id, 'released'); continue; }
      if (r.charged && !r.refunded) { await markReaderSalePaid(db, tenantId, pendingId, r.pi); continue; }
      return { ok: false, status: 'unknown', id, error: 'A card reader payment for this sale couldn’t be called off just now. Nothing was changed. Try again in a moment.' };
    }
    await noteState(db, tenantId, pendingId, id, 'not_charged');
  }
  // Nothing left going on the reader for it.
  const left: any = ((await ref.get()).data() as any) || {};
  if (!Object.values<any>(left.readerPis || {}).some((e) => !SETTLED.includes(String(e?.state)))) await ref.set({ readerOpen: false, updatedAt: nowIso() }, { merge: true }).catch(() => {});
  return { ok: true };
}

/** A ticket's payment was refunded (in Needs attention, or in Stripe itself): it can't pay for the sale, so the ticket
 *  is no longer paid by it and the desk can take the payment again. A recorded sale is never changed here. */
export async function clearRefundedPayment(db: any, tenantId: string, pendingId: string, id: string): Promise<void> {
  await db.runTransaction(async (tx: any) => {
    const ref = ticketRef(db, tenantId, pendingId); const cur: any = ((await tx.get(ref)).data() as any) || null; if (!cur) return;
    const at = nowIso();
    tx.set(ref, { ...(cur.readerPis?.[id] ? { readerPis: { [id]: { state: 'refunded', settledAt: at } } } : {}), updatedAt: at,
      ...(cur.paymentIntentId === id && cur.status !== 'completed' ? { status: 'prepared', paymentIntentId: null, paidVia: null, paidCents: null, paidAt: null, paidTip: null, paidTipAllocations: null, refundedPayment: { id, at } } : {}) }, { merge: true });
  });
}

/** Before a sale is charged on the reader: an earlier reader payment for the same ticket (or the one the screen names)
 *  that went through is used instead of charging again; one the reader approved but that wasn't captured is captured
 *  (same amount) or released (the amount changed); one never finished is called off so it can't complete later.
 *  `unknown`: Stripe couldn't be reached about one of them, so nothing new may be charged yet. */
export async function earlierReaderPayment(db: any, stripe: any, acct: string, tenantId: string, pendingId: string, previousId: string | null, chargeCents: number):
  Promise<{ use?: { id: string; cents: number }; differs?: { id: string; cents: number }; processing?: { id: string }; unknown?: { id: string } }> {
  const pc: any = ((await ticketRef(db, tenantId, pendingId).get()).data() as any) || {};
  const ids = new Set<string>();
  for (const [id, e] of Object.entries<any>(pc.readerPis || {})) if (!['released', 'not_charged', 'paid_twice', 'refunded'].includes(String(e?.state))) ids.add(id);
  if (pc.paymentIntentId && pc.paidVia === 'card_reader') ids.add(String(pc.paymentIntentId));
  const prev = safeId(previousId); if (prev) ids.add(prev);
  const close = Math.round(chargeCents);
  for (const id of ids) {
    const l = await load(stripe, acct, id, tenantId);
    if (l.err) { if (l.err.status === 'unknown') return { unknown: { id } }; continue; }
    const pi = l.pi; const meta: any = pi.metadata || {};
    // Only a payment made on the reader for this very sale: never one for another ticket, a deposit, or one on a receipt.
    if (meta.kind !== 'sale' || meta.pendingId !== safeId(pendingId)) continue;
    if (pi.status === 'succeeded' || pi.status === 'requires_capture') {
      const onReceipt = await db.collection(`tenants/${tenantId}/receipts`).where('stripePaymentIntentId', '==', id).limit(1).get().catch(() => ({ empty: true }));
      if (!onReceipt.empty) continue;
    }
    if (pi.status === 'succeeded' && refundedOf(pi)) { await clearRefundedPayment(db, tenantId, pendingId, id); continue; }
    if (pi.status === 'succeeded') {
      if (Math.abs(centsOf(pi) - close) <= 1) { await markReaderSalePaid(db, tenantId, pendingId, pi); return { use: { id, cents: centsOf(pi) } }; }
      return { differs: { id, cents: centsOf(pi) } };
    }
    if (pi.status === 'requires_capture') {
      if (Math.abs(Math.round(Number(pi.amount) || 0) - close) <= 1) {
        const c = await captureReaderPayment(stripe, acct, id, tenantId);
        if (c.ok) { await markReaderSalePaid(db, tenantId, pendingId, c.pi); await recordReaderFee(db, stripe, acct, tenantId, id); return { use: { id, cents: centsOf(c.pi) } }; }
        if (c.status === 'unknown' || c.status === 'requires_capture') return { unknown: { id } };
        continue;
      }
      const r = await releaseReaderPayment(stripe, acct, id, tenantId);
      if (r.ok) await noteState(db, tenantId, pendingId, id, 'released');
      else if (r.status === 'unknown') return { unknown: { id } };
      continue;
    }
    if (pi.status === 'processing') return { processing: { id } };
    if (UNFINISHED.includes(String(pi.status))) {
      const r = await releaseReaderPayment(stripe, acct, id, tenantId);
      if (r.ok) await noteState(db, tenantId, pendingId, id, 'released');
      else if (r.charged) { await markReaderSalePaid(db, tenantId, pendingId, r.pi); return Math.abs(centsOf(r.pi) - close) <= 1 ? { use: { id, cents: centsOf(r.pi) } } : { differs: { id, cents: centsOf(r.pi) } }; }
      else if (r.status === 'unknown') return { unknown: { id } };
    }
    else if (pi.status === 'canceled') await noteState(db, tenantId, pendingId, id, 'released');
  }
  return {};
}

/** The front desk and managers hear about a payment that needs a person: one taken on the reader that went through
 *  without its sale being saved, or a sale paid twice (`via`: how the second payment was taken). */
export async function tellDeskReader(db: any, tenantId: string, kind: 'unrecorded' | 'paid_twice', pc: any, cents: number, pendingId: string, via = 'card_reader') {
  const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const when = new Date(Date.parse(pc?.preparedAt || '') || Date.now()).toLocaleString('en-US', { timeZone: tenantTimeZone(tenant), weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const who = pc?.clientName || 'A client';
  const message = kind === 'unrecorded'
    ? `${who} paid ${money(cents)} ${viaWords(via)} (${when}), but the sale wasn’t saved. Record it in Needs attention, under Sales not recorded. Recording it won’t charge the card again.`
    : `${who}’s sale (${when}) was paid twice: ${money(cents)} ${viaWords(via)} on top of the payment already taken. Refund or keep the extra payment in Needs attention.`;
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((m: any) => !m.archived && ['owner', 'admin', 'manager', 'front_desk'].includes(String(m.role || '')));
  const b = db.batch();
  for (const m of staff) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId: m.id, type: kind === 'unrecorded' ? 'reader_unrecorded' : 'reader_paid_twice', title: kind === 'unrecorded' ? 'Card payment not saved' : 'Sale paid twice', link: '/pos', read: false, createdAt: nowIso(), message, pendingId }); }
  await b.commit();
}

/** EVERY FEW MINUTES (cron/retail-payments): reader payments the desk never heard back about. Ten minutes after one
 *  started: gone through → the ticket shows it's paid (or paid twice) and the desk is told; approved but not captured →
 *  captured and the ticket shows it's paid, or released when the sale was paid another way; never finished → called
 *  off after half an hour, so it can't complete later. When Stripe can't be reached, it's asked again next time. */
export async function sweepReaderPayments(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; captured: number; released: number; told: number }> {
  const out = { checked: 0, captured: 0, released: 0, told: 0 };
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) return out;
  const now = o.now ?? Date.now();
  const snap = await db.collection(`tenants/${tenantId}/pendingCheckouts`).where('readerOpen', '==', true).limit(40).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) {
    const pendingId = d.id; let pc: any = d.data() || {};
    let open = false;
    for (const [id, e] of Object.entries<any>(pc.readerPis || {})) {
      if (SETTLED.includes(String(e?.state))) continue;
      const age = now - (Date.parse(String(e?.at || '')) || now);
      if (age < 10 * 60000) { open = true; continue; }
      out.checked++;
      const l = await load(stripe, acct, id, tenantId);
      if (l.err) { if (l.err.status === 'unknown') open = true; else await noteState(db, tenantId, pendingId, id, 'not_charged'); continue; }
      const pi = l.pi;
      pc = ((await d.ref.get()).data() as any) || pc;
      const paidOtherwise = !payable(pc) && pc.paymentIntentId !== id;
      if (pi.status === 'succeeded') {
        if (refundedOf(pi)) { await noteState(db, tenantId, pendingId, id, 'refunded'); continue; }
        const m = await markReaderSalePaid(db, tenantId, pendingId, pi);
        if (m.fresh && (m.result === 'waiting' || m.result === 'paid_twice')) { await tellDeskReader(db, tenantId, m.result === 'waiting' ? 'unrecorded' : 'paid_twice', pc, centsOf(pi), pendingId).catch(() => {}); out.told++; }
      } else if (pi.status === 'requires_capture') {
        if (paidOtherwise) { const r = await releaseReaderPayment(stripe, acct, id, tenantId); if (r.ok) { await noteState(db, tenantId, pendingId, id, 'released'); out.released++; } else open = true; }
        else {
          const c = await captureReaderPayment(stripe, acct, id, tenantId);
          if (c.ok) { out.captured++; await recordReaderFee(db, stripe, acct, tenantId, id); const m = await markReaderSalePaid(db, tenantId, pendingId, c.pi); if (m.fresh) { await tellDeskReader(db, tenantId, m.result === 'paid_twice' ? 'paid_twice' : 'unrecorded', pc, centsOf(c.pi), pendingId).catch(() => {}); out.told++; } }
          else open = true;
        }
      } else if (pi.status === 'processing') open = true;
      else if (pi.status === 'canceled') await noteState(db, tenantId, pendingId, id, 'not_charged');
      else if (UNFINISHED.includes(String(pi.status))) {
        if (age < 30 * 60000) { open = true; continue; }
        const r = await releaseReaderPayment(stripe, acct, id, tenantId);
        if (r.ok) { await noteState(db, tenantId, pendingId, id, 'released'); out.released++; }
        else if (r.charged && !r.refunded) { const m = await markReaderSalePaid(db, tenantId, pendingId, r.pi); if (m.fresh) { await tellDeskReader(db, tenantId, m.result === 'paid_twice' ? 'paid_twice' : 'unrecorded', pc, centsOf(r.pi), pendingId).catch(() => {}); out.told++; } }
        else open = true;
      } else await noteState(db, tenantId, pendingId, id, 'not_charged');
    }
    if (!open) await d.ref.set({ readerOpen: false, updatedAt: nowIso() }, { merge: true }).catch(() => {});
  }
  return out;
}
