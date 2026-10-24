// src/lib/money-refund.ts — send a sale's refund back to the client's card (server).
// Finds the card payment behind a sale (on the transaction, or on the receipt for
// the same checkout) and refunds the amount on the business's connected account.
// Split payments are refunded card by card until the amount is covered. Once per sale: the refund is claimed on the
// sale before Stripe is asked, each card's refund has one key for the sale (so a retry replays it, and a retry asking a
// different amount is refused by Stripe rather than sent again), and what went back is kept on the sale, so a try
// after an earlier one whose record didn't save finds it (Stripe is asked, by the sale's name on the refund).
// What went back is recorded here too, in one step with the sale (recordSaleRefund): the refund line in the books, named
// after the sale, with what the person asked for on it (the reason, a tip or commission taken back), and the sale marked
// refunded. So a screen that never hears back can't leave a refund unrecorded: asked again, it finds the refund; not
// asked again, the five-minute check does (settleStuckSaleRefunds). No answer from Stripe keeps the claim, so the next
// try (or the check) finds what Stripe did; Stripe saying no lets it go.
// A booking's deposit is refunded as a deposit (lib/deposit-refund): its credit is closed in the same moves.
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { refundAmount } from '@/lib/stripe-refund';

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
export type CardRefund = { ok: true; card: false } | { ok: true; card: true; refundedCents: number; shortCents: number; deposit?: boolean; already?: boolean; recorded?: boolean } | { ok: false; error: string; status: number; unknown?: boolean };
/** What goes on the refund line besides the money: the reason, a tip or commission taken back, a case it's for. */
export type SaleRefundRecord = { reason?: string | null; notes?: string | null; refundTip?: boolean; tipStrategy?: string | null; payReversals?: { staffId: string; amount: number }[] | null; caseId?: string | null };
type Sent = { pi: string; cents: number; refundId?: string | null };
const NO_ANSWER = 'Stripe didn’t answer, so the refund may or may not have gone through. Try again in a couple of minutes: it won’t refund twice.';

/** The record a screen sends, kept to what a refund line holds. */
export function cleanRecord(r: any): SaleRefundRecord | null {
  if (!r || typeof r !== 'object') return null;
  const pr = Array.isArray(r.payReversals) ? r.payReversals.slice(0, 10).map((x: any) => ({ staffId: String(x?.staffId || '').slice(0, 80), amount: Math.round(num(x?.amount) * 100) / 100 })).filter((x: any) => x.staffId && x.amount > 0) : [];
  return { reason: r.reason ? String(r.reason).slice(0, 300) : null, notes: r.notes ? String(r.notes).slice(0, 300) : null, refundTip: r.refundTip === true,
    tipStrategy: r.tipStrategy ? String(r.tipStrategy).slice(0, 20) : null, payReversals: pr.length ? pr : null, caseId: r.caseId ? String(r.caseId).slice(0, 120) : null };
}

/** The card payments behind a sale: on the sale itself, or on the receipt for the same checkout (card by card). */
async function cardsFor(db: any, T: string, x: any): Promise<{ pi: string; cents: number }[]> {
  if (x.stripePaymentIntentId) return [{ pi: String(x.stripePaymentIntentId), cents: Math.round((num(x.amount) + num(x.tipAmount)) * 100) }];
  if (!x.checkoutSessionId) return [];
  const rs = await db.collection(`${T}/receipts`).where('checkoutSessionId', '==', String(x.checkoutSessionId)).limit(1).get();
  const r: any = rs.empty ? null : rs.docs[0].data();
  if (r && Array.isArray(r.payments) && r.payments.length) return r.payments.filter((p: any) => p.stripePaymentIntentId && !p.refundedAt).map((p: any) => ({ pi: String(p.stripePaymentIntentId), cents: Math.round((num(p.amount) + num(p.tip)) * 100) }));
  if (r?.stripePaymentIntentId) return [{ pi: String(r.stripePaymentIntentId), cents: Math.round(num(r.total) * 100) }];
  return [];
}

/** What went back to the card, recorded once with the sale: the refund line (named after the sale) and the sale marked
 *  refunded, in one step that first checks it isn't refunded already. A refund for a Making it right case closes the
 *  case's refund in the same step, so asking again from the case finds it done. */
export async function recordSaleRefund(db: any, tenantId: string, transactionId: string, o: { sent: Sent[]; record: SaleRefundRecord | null; by: string | null }): Promise<{ wrote: boolean; lineId: string | null }> {
  const T = `tenants/${tenantId}`; const xRef = db.doc(`${T}/transactions/${transactionId}`);
  const lineRef = db.doc(`${T}/transactions/refund_${String(transactionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 140)}`);
  const now = new Date().toISOString(); const rec = o.record || {};
  const cents = o.sent.reduce((n, d) => n + Math.round(num(d.cents)), 0);
  const caseRef = rec.caseId ? db.doc(`${T}/cases/${String(rec.caseId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)}`) : null;
  return db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(xRef)).data() || null; const line = await tx.get(lineRef);
    const cs: any = caseRef ? (await tx.get(caseRef)).data() || null : null;
    if (!x) return { wrote: false, lineId: null };
    // The case's refund is done, however this refund was recorded (the case asking again, or the five-minute check).
    if (cs?.fix && !cs.fix.refundedAt) tx.set(caseRef, { fix: { ...cs.fix, refundedAt: now, refundedCents: cents, saleId: transactionId, todo: null }, updatedAt: now }, { merge: true });
    if (x.refundedAt || line.exists) {
      tx.set(xRef, { cardRefundClaim: null, ...(Array.isArray(x.cardRefunds) && x.cardRefunds.length ? {} : { cardRefunds: o.sent.map((d) => ({ ...d, at: now, by: o.by })) }) }, { merge: true });
      return { wrote: false, lineId: x.refundTransactionId || (line.exists ? lineRef.id : null) };
    }
    const tip = rec.refundTip && num(x.tipAmount) > 0 && rec.tipStrategy !== 'absorb' && x.staffId ? { tipReversal: { staffId: String(x.staffId), amount: num(x.tipAmount) } } : {};
    tx.set(lineRef, { id: lineRef.id, date: now, createdAt: now, tenantId, description: `Refund for: ${x.description || 'sale'}`, clientOrVendor: x.clientOrVendor || null, clientId: x.clientId || null,
      type: 'reversal', context: x.context || 'Business', category: 'Refunds', amount: cents / 100, paymentMethod: x.paymentMethod || 'Card', reversalOf: transactionId, appointmentId: x.appointmentId || null,
      hasReceipt: false, notes: rec.notes || (rec.reason ? `Refund Reason: ${rec.reason}` : 'Refunded to the card'), refundedToCard: true, by: o.by || null,
      stripeRefundIds: o.sent.map((d) => d.refundId).filter(Boolean), ...tip, ...(rec.payReversals?.length ? { payReversals: rec.payReversals, staffId: x.staffId || null } : {}), ...(rec.caseId ? { caseId: rec.caseId } : {}) });
    tx.set(xRef, { refundedAt: now, refundTransactionId: lineRef.id, cardRefunds: o.sent.map((d) => ({ ...d, at: now, by: o.by })), cardRefundClaim: null }, { merge: true });
    return { wrote: true, lineId: lineRef.id };
  });
}

export async function refundSaleToCard(db: any, tenantId: string, tenant: any, transactionId: string, want: number, byName: string | null, record: SaleRefundRecord | null = null): Promise<CardRefund> {
  const T = `tenants/${tenantId}`; const xRef = db.doc(`${T}/transactions/${transactionId}`); const xSnap = await xRef.get();
  if (!xSnap.exists) return { ok: false, error: 'That sale wasn’t found.', status: 404 };
  const x: any = xSnap.data();
  if (x.refundedAt || x.voided) return { ok: false, error: 'This sale was already refunded.', status: 409 };
  // An online order is refunded on the order (api/retail/refund), so its items, its sales tax and the customer's email
  // all follow; a refund from here would miss them.
  if (x.retailOrderId) return { ok: false, error: 'This is an online order. Refund it from the order in Orders, so the items, the sales tax and the customer’s email all follow.', status: 409 };
  // A booking's deposit: refunded as a deposit, so its credit is closed and it can't also come off their next bill.
  const { isDepositLine, depositForLine, refundDepositCredit } = await import('@/lib/deposit-refund');
  if (isDepositLine(x) && String(x.paymentMethod || '').toLowerCase() !== 'cash') {
    const creditId = await depositForLine(db, tenantId, x);
    if (!creditId) return { ok: false, error: 'This is a booking deposit, but its deposit record can’t be found. Refund it from the booking.', status: 409 };
    const c: any = (await db.doc(`${T}/depositCredits/${creditId}`).get()).data() || {};
    const { creditLeftCents } = await import('@/lib/credit-pools');
    const left = c.status === 'available' ? creditLeftCents(c) : 0;
    if (c.status === 'available' && Math.round(want) !== left) return { ok: false, error: left > 0 ? `A deposit goes back whole: $${(left / 100).toFixed(2)} is left on this one.` : 'Nothing is left on this deposit to refund.', status: 409 };
    const Stripe = (await import('stripe')).default;
    const r = await refundDepositCredit(db, tenantId, creditId, new Stripe(String(process.env.STRIPE_SECRET_KEY || ''), { apiVersion: '2024-06-20' as any }), { by: byName, saleLineId: transactionId });
    if (!r.ok) return r;
    return { ok: true, card: true, deposit: true, refundedCents: Math.round(r.amount * 100), shortCents: 0, ...(r.already ? { already: true } : {}) };
  }
  // A deposit paid in cash, refunded from the till: its credit is closed here (the till and the books are the page's).
  if (isDepositLine(x)) {
    const creditId = await depositForLine(db, tenantId, x);
    if (creditId) {
      const { creditLeftCents } = await import('@/lib/credit-pools');
      const cRef = db.doc(`${T}/depositCredits/${creditId}`);
      const closed: any = await db.runTransaction(async (tx: any) => {
        const c: any = (await tx.get(cRef)).data() || {};
        if (c.status !== 'available') return { error: c.status === 'refunded' ? 'This deposit was already refunded.' : `This deposit is ${String(c.status || 'not available')}, so it can’t be refunded.` };
        const left = creditLeftCents(c);
        if (Math.round(want) !== left) return { error: left > 0 ? `A deposit goes back whole: $${(left / 100).toFixed(2)} is left on this one.` : 'Nothing is left on this deposit to refund.' };
        tx.set(cRef, { status: 'refunded', refundedAt: new Date().toISOString(), refundedCents: left, refundedVia: 'cash', refundedBy: byName || null }, { merge: true });
        return { ok: true };
      });
      if (closed.error) return { ok: false, error: closed.error, status: 409 };
    }
    return { ok: true, card: false };
  }
  if (String(x.paymentMethod || '').toLowerCase() === 'cash') return { ok: true, card: false };
  const cards = await cardsFor(db, T, x);
  if (!cards.length) return { ok: true, card: false };
  const acct = tenant.stripeAccountId || tenant.stripeConnectAccountId || null;
  // Sent to the card before (an earlier try, its record not saved yet): that refund stands, is recorded now, and nothing
  // more goes.
  const priorOf = (v: any) => (Array.isArray(v?.cardRefunds) ? v.cardRefunds : []).reduce((s: number, d: any) => s + Math.round(num(d?.cents)), 0);
  // A screen from before the books were written here sends no record, and writes the refund line itself.
  const writes = record !== null;
  const asBefore = async (v: any) => {
    const got = priorOf(v); const rec = v.cardRefundClaim?.record || record;
    if (rec) await recordSaleRefund(db, tenantId, transactionId, { sent: v.cardRefunds, record: rec, by: byName });
    return { ok: true as const, card: true as const, refundedCents: got, shortCents: Math.max(0, Math.round(want) - got), already: true, ...(rec ? { recorded: true } : {}) };
  };
  if (priorOf(x) > 0) return asBefore(x);
  // Claimed on the sale first (with what to write on the refund line): a second tap while this one is going is told so.
  const claim: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(xRef)).data() || {};
    if (cur.refundedAt || cur.voided) return { error: 'This sale was already refunded.', status: 409 };
    if (priorOf(cur) > 0) return { prior: cur };
    if (cur.cardRefundClaim?.at && Date.now() - (Date.parse(String(cur.cardRefundClaim.at)) || 0) < 120000) return { error: 'A refund for this sale is already being sent. Give it a moment.', status: 409 };
    tx.set(xRef, { cardRefundClaim: { at: new Date().toISOString(), cents: Math.round(want), by: byName || null, record: record || null } }, { merge: true });
    return { stale: cur.cardRefundClaim || null };
  });
  if (claim.error) return { ok: false, error: claim.error, status: claim.status };
  if (claim.prior) return asBefore(claim.prior);
  // An earlier try that was cut off after asking Stripe: its refund is found by the sale's name on it, never sent again.
  if (claim.stale) {
    try {
      const found = await sentAtStripe(acct, cards, transactionId);
      if (found.length) {
        const got = found.reduce((s, d) => s + d.cents, 0);
        await afterRefund(db, tenantId, x, transactionId, got, byName);
        if (writes) await recordSaleRefund(db, tenantId, transactionId, { sent: found, record, by: byName });
        else await xRef.set({ cardRefunds: found.map((d) => ({ ...d, at: new Date().toISOString(), by: byName })), cardRefundClaim: null }, { merge: true });
        return { ok: true, card: true, refundedCents: got, shortCents: Math.max(0, Math.round(want) - got), already: true, ...(writes ? { recorded: true } : {}) };
      }
    } catch (e: any) { console.error('[money-refund] earlier try', String(e?.message || e).slice(0, 160)); return { ok: false, error: 'Stripe couldn’t be checked for an earlier try at this refund. Try again in a moment.', status: 502, unknown: true }; }
  }
  let left = Math.round(want); const done: Sent[] = [];
  for (const c of cards) {
    if (left <= 0) break;
    const cents = Math.min(left, c.cents || left);
    const r: any = await refundAmount(acct, c.pi, cents, `money-refund-${transactionId}-${c.pi}`, { moneyRefundOf: transactionId });
    if (!r.ok) {
      // No answer (for any card): the claim stays, so the next try (or the five-minute check) finds every refund Stripe
      // made for this sale, card by card, and records them together.
      if (r.unknown) return { ok: false, error: NO_ANSWER, status: 502, unknown: true };
      // Stripe said no on the first card: nothing went back, and the sale can be refunded again. On a later card: what
      // went back is recorded, and the rest is left to refund another way.
      if (!done.length) {
        await xRef.set({ cardRefundClaim: null }, { merge: true }).catch(() => {});
        return { ok: false, error: r.error || 'The card refund didn’t go through.', status: 502 };
      }
      break;
    }
    done.push({ pi: c.pi, cents, refundId: r.id || null }); left -= cents;
  }
  const refunded = done.reduce((s, d) => s + d.cents, 0);
  await afterRefund(db, tenantId, x, transactionId, refunded, byName);
  if (writes) await recordSaleRefund(db, tenantId, transactionId, { sent: done, record, by: byName });
  else await xRef.set({ cardRefunds: done.map((d) => ({ ...d, at: new Date().toISOString(), by: byName })), cardRefundClaim: null }, { merge: true }).catch(() => {});
  return { ok: true, card: true, refundedCents: refunded, shortCents: Math.max(0, Math.round(want) - refunded), ...(writes ? { recorded: true } : {}) };
}

/** The refunds Stripe has for this sale (it names the sale on each), card by card. Throws when Stripe can't be asked. */
async function sentAtStripe(acct: string | null, cards: { pi: string }[], transactionId: string, stripe?: any): Promise<Sent[]> {
  if (!stripe) stripe = new Stripe(String(process.env.STRIPE_SECRET_KEY || ''), { apiVersion: '2024-06-20' as any });
  const found: Sent[] = [];
  for (const c of cards) {
    const l: any = await stripe.refunds.list({ payment_intent: c.pi, limit: 100 }, { stripeAccount: acct });
    for (const r of l?.data || []) if (r?.metadata?.moneyRefundOf === transactionId && !['failed', 'canceled'].includes(String(r.status || ''))) found.push({ pi: c.pi, cents: Number(r.amount) || 0, refundId: r.id || null });
  }
  return found;
}

/** Points earned on the sale come back off (best effort, once per sale). */
async function afterRefund(db: any, tenantId: string, x: any, transactionId: string, refunded: number, byName: string | null) {
  if (refunded > 0 && x.checkoutSessionId) { try { const { reverseSale } = await import('@/lib/loyalty-server'); await reverseSale(db, tenantId, { saleId: String(x.checkoutSessionId), refundCents: refunded, refundId: `c${transactionId}`, by: byName || 'Refund' }); } catch { /* best effort */ } }
}

/** The five-minute check: a sale's card refund left claimed more than 15 minutes (the screen never heard back, and
 *  nobody asked again). A refund Stripe has for it is recorded, as the person asked (the reason and anything taken back
 *  ride on the claim), and the owners are told; a refund sent but never written down is written down; nothing at
 *  Stripe after two hours lets the claim go. It never sends a refund itself: asking again is the team's call. */
export async function settleStuckSaleRefunds(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; recorded: number; released: number; waiting: number }> {
  const out = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const acct = tenant?.stripeAccountId || tenant?.stripeConnectAccountId || null; if (!acct) return out;
  const T = `tenants/${tenantId}`; const now = o.now ?? Date.now(); const iso = new Date(now).toISOString();
  const snap = await db.collection(`${T}/transactions`).where('cardRefundClaim.at', '>', '').limit(50).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) {
    const c0: any = (d.data() || {}).cardRefundClaim || {};
    if (now - (Date.parse(String(c0.at || '')) || now) < 15 * 60000) continue;
    const x: any = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(d.ref)).data() || {}; const c = cur.cardRefundClaim || null;
      if (!c?.at || c.at !== c0.at || now - (Date.parse(String(c.at)) || now) < 15 * 60000) return null;
      if (c.settlingAt && now - (Date.parse(String(c.settlingAt)) || 0) < 5 * 60000) return null;
      tx.set(d.ref, { cardRefundClaim: { settlingAt: iso } }, { merge: true });
      return cur;
    }).catch(() => null);
    if (!x) continue;
    out.checked++;
    const claim = x.cardRefundClaim || {}; const by = claim.by || 'Automatic check';
    if (x.refundedAt) { await d.ref.set({ cardRefundClaim: null }, { merge: true }); out.released++; continue; }
    // Sent and kept on the sale, but never written in the books.
    if (Array.isArray(x.cardRefunds) && x.cardRefunds.length) {
      const r = await recordSaleRefund(db, tenantId, d.id, { sent: x.cardRefunds, record: claim.record || null, by });
      const sentCents = x.cardRefunds.reduce((n: number, s: any) => n + (Number(s.cents) || 0), 0);
      out.recorded++; if (r.wrote) { await tellOwners(db, tenantId, d.id, x, sentCents); await caseNote(db, tenantId, claim.record, sentCents); }
      continue;
    }
    let found: Sent[] = [];
    try { found = await sentAtStripe(acct, await cardsFor(db, T, x), d.id, o.stripe); }
    catch { await d.ref.set({ cardRefundClaim: { settlingAt: null } }, { merge: true }).catch(() => {}); out.waiting++; continue; }
    if (found.length) {
      const got = found.reduce((n, s) => n + s.cents, 0);
      await afterRefund(db, tenantId, x, d.id, got, by);
      const r = await recordSaleRefund(db, tenantId, d.id, { sent: found, record: claim.record || null, by });
      out.recorded++; if (r.wrote) { await tellOwners(db, tenantId, d.id, x, got); await caseNote(db, tenantId, claim.record, got); }
      continue;
    }
    if (now - (Date.parse(String(claim.at)) || now) < 2 * 3600e3) { await d.ref.set({ cardRefundClaim: { settlingAt: null } }, { merge: true }).catch(() => {}); out.waiting++; continue; }
    // Nothing went back: the sale can be refunded again.
    await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(d.ref)).data() || {}; if (cur.cardRefundClaim?.at === claim.at) tx.set(d.ref, { cardRefundClaim: null }, { merge: true }); }).catch(() => {});
    out.released++;
  }
  return out;
}

/** A Making it right case whose refund the check recorded: its timeline says so. */
async function caseNote(db: any, tenantId: string, record: any, cents: number) {
  const id = String(record?.caseId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120); if (!id) return;
  await db.doc(`tenants/${tenantId}/cases/${id}`).set({ timeline: FieldValue.arrayUnion({ at: new Date().toISOString(), by: 'Automatic check', text: `Refunded ${money(cents)} to the card (the screen that sent it never heard back)` }) }, { merge: true }).catch(() => {});
}

async function tellOwners(db: any, tenantId: string, saleId: string, x: any, cents: number) {
  try {
    const admins = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get();
    const now = new Date().toISOString(); const id = String(saleId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
    for (const s of admins.docs) await db.doc(`tenants/${tenantId}/notifications/salerefund_${id}_${s.id}`).set({ id: `salerefund_${id}_${s.id}`, userId: s.id, type: 'card_refund_settled', read: false, createdAt: now, link: '/money',
      message: `A ${money(cents)} refund to ${x.clientOrVendor || 'a client'}’s card (${String(x.description || 'a sale').slice(0, 60)}) went through, but the screen that sent it never heard back. It’s recorded in Money now.` });
  } catch { /* the refund is recorded; the note is a courtesy */ }
}

// The visit's sale — the one a Making it right refund goes back against.
export async function saleForVisit(db: any, tenantId: string, appointmentId: string) {
  if (!appointmentId) return null;
  const qs = await db.collection(`tenants/${tenantId}/transactions`).where('appointmentId', '==', appointmentId).get();
  const rows = qs.docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((t: any) => t.type !== 'reversal' && t.type !== 'expense' && !t.refundedAt && !t.voided && num(t.amount) > 0);
  rows.sort((a: any, b: any) => num(b.amount) - num(a.amount));
  return rows[0] || null;
}
