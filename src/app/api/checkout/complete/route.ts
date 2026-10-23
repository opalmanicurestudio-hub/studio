// src/app/api/checkout/complete/route.ts — CHECKOUT, SAVED ON THE SERVER (staff only).
// Everything the POS checkout used to write from the browser, now worked out here from the REAL prices
// (services and each provider's price tier, add-ons, products, memberships, packages, the client's actual
// owed fees, the business's tax settings) and saved in ONE all-or-nothing batch:
//   payment lines (services, add-ons, redemptions + their cost, overages, refreshments, products, memberships,
//   packages, deposits, rentals, owed fees, tips, discounts, service recovery, tax, card fee, deposit applied),
//   the visit(s) completed, providers freed, stock + stock log, space rentals paid, owed fees cleared,
//   lifetime value, package / perk use, the till, the receipt, discount-code use, offers and campaigns.
// Then: memberships / packages enrolled, and any next-visit deposit confirmed.
// The screen uses the same calculation (lib/checkout-calc), so the totals match; if they ever don't, the sale is
// still recorded exactly as worked out here and flagged for review — never silently.
import { depleteBatchesFIFO } from '@/lib/retail-orders';
import { giftCap, limitsOn, type BillLine } from '@/lib/gift-limits';
import { homeLocation } from '@/lib/business-locations';
import { saleStamp } from '@/lib/commission';
import { withPay } from '@/lib/staff-pay-server';
import { tuitionAccount, applyTuitionPayment } from '@/lib/tuition-desk';
import { renterAccount, applyRentPayment } from '@/lib/rent-desk';
import { syncVisitCopies } from '@/lib/visit-sync';
import { refundPaymentIntent } from '@/lib/stripe-refund';
import { momentsFor, bestMomentReward, prebookMoment } from '@/lib/moments';
import { monthKey } from '@/lib/team-discount';
import { consumeApproval, isApprover } from '@/lib/approvals';
import { heldCovered, heldLine, heldShortfall } from '@/lib/held-stock';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { computeCheckout } from '@/lib/checkout-calc';
import { addOnIdsOf, overCeiling, workOf } from '@/lib/prep-checkout';
import { computeServiceCost } from '@/lib/service-cost';
import { isCreditExpired } from '@/lib/deposit-policy';
import { accountOf, addShareToTicket, checkDeskPayment, clearExtraOnReceipt, clearRefundedPayment, deskPaymentOf, DISCARD_HOLD_MS, keepApartPayment, liveShares, markSalePaid, onAnyReceipt, outcomeRef, paidPayloadOf, promoteKeptApart, readerStripe, safeId, settleTicketReader, ticketPayment, viaWords } from '@/lib/reader-sale';
import { closeScreenPaymentsFor } from '@/lib/screen-pay';
import { methodOfVia } from '@/lib/pay-via';

export const dynamic = 'force-dynamic';
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const firstName = (n: any) => String(n || '').split(' ')[0] || undefined;
const clean = (v: any): any => {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(clean);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)]));
  return v;
};

const MGR = ['owner', 'admin', 'manager'];
const json = (body: any, status = 200) => ({ body, status });
const CARD_METHODS = ['card', 'terminal', 'card_on_file'];
const OPEN = ['prepared', 'paid_waiting', 'failed', 'partial'];
// A ticket the desk is in the middle of: paid, part paid in a split, or with a card reader payment still going.
const busy = (p: any) => !!p && (!!ticketPayment(p) || liveShares(p).length > 0 || (p.status === 'prepared' && p.readerOpen === true));
const usable = (p: any) => !!p && !['completed', 'discarded', 'discarding'].includes(String(p.status || ''));
const ticketTime = (p: any) => Date.parse(p?.paidAt || p?.updatedAt || p?.preparedAt || '') || 0;
const isAlreadyExists = (e: any) => e?.code === 6 || e?.code === 'already-exists' || /ALREADY_EXISTS|already exists/i.test(String(e?.message || ''));
const isChangedMeanwhile = (e: any) => e?.code === 9 || e?.code === 'failed-precondition' || /FAILED_PRECONDITION/i.test(String(e?.message || ''));
// A split share being taken off right now (tender_remove) doesn't pay for the sale.
const removing = (x: any) => !!x?.removingAt && Date.now() - (Date.parse(x.removingAt) || 0) < 2 * 60000;

// Each request here ends well inside the time a discard holds its sale (lib/reader-sale DISCARD_HOLD_MS).
export const maxDuration = 60;

/** Whether a paid ticket has anything the cart has: one of the same visits or owed fees (each is only ever paid once),
 *  or one of the same items. */
function overlaps(p: any, cart: any): boolean {
  const pv = new Set<string>((Array.isArray(p?.appointmentIds) ? p.appointmentIds : []).map(String));
  if ((Array.isArray(cart?.appointmentIds) ? cart.appointmentIds : []).some((id: any) => pv.has(String(id)))) return true;
  const pf = new Set<string>((Array.isArray(p?.feeIds) ? p.feeIds : []).map(String));
  if ((Array.isArray(cart?.feeIds) ? cart.feeIds : []).some((id: any) => pf.has(String(id)))) return true;
  const pi = new Set<string>((Array.isArray(p?.items) ? p.items : []).map((it: any) => `${String(it?.type || 'product')}:${String(it?.id || '')}`));
  return (Array.isArray(cart?.items) ? cart.items : []).some((it: any) => pi.has(`${String(it?.type || 'product')}:${String(it?.id || '')}`));
}

/** This client's open tickets that matter more than the one the desk has:
 *  - `same`: this very sale, already paid — a paid ticket with any of the same visits, owed fees or items (on any
 *    screen: the page reloaded, or the desk moved to another device; what's in the cart beyond it stays as a new sale),
 *    or paid at this desk in the last fifteen minutes — else this desk's own ticket with a card reader payment still
 *    going or part of a split paid (the page reloaded). Another desk's unpaid ticket is never handed over: that desk is
 *    still working on it. A visit or a fee that's paid on a ticket is this sale however long ago it was paid.
 *  - `other`: a different sale of theirs (nothing the same), paid in the last two hours but never saved. It's shown to
 *    the desk to save on its own; it never takes the place of the sale being rung up. */
async function clientTickets(coll: any, clientId: string, deskId: string, exceptId: string, cart: any): Promise<{ same: any | null; other: any | null }> {
  if (!clientId) return { same: null, other: null };
  // Only this client's open tickets are read (never the whole history); if that ever fails, nothing is picked up.
  const open = await coll.where('clientId', '==', clientId).where('status', 'in', OPEN).get()
    .catch(() => coll.where('clientId', '==', clientId).get()).catch(() => ({ docs: [] as any[] }));
  const now = Date.now();
  const rows = open.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((p: any) => p.id !== exceptId && usable(p));
  const visitOrFee = (p: any) => overlaps({ appointmentIds: p.payload?.appointmentIds, feeIds: p.payload?.feeIds }, cart);
  const paid = rows.filter((p: any) => ticketPayment(p) && (now - ticketTime(p) < 2 * 3600000 || visitOrFee(p))).sort((x: any, y: any) => ticketTime(y) - ticketTime(x));
  const isSame = (p: any) => (!!deskId && p.deskId === deskId && now - ticketTime(p) < 15 * 60000) || overlaps(p.payload, cart);
  const same = paid.find(isSame) || null;
  const other = paid.find((p: any) => !isSame(p) && now - ticketTime(p) < 2 * 3600000) || null;
  if (same) return { same, other };
  const mine = rows.filter((p: any) => !!deskId && p.deskId === deskId && busy(p) && !ticketPayment(p) && now - (Date.parse(p.updatedAt || p.preparedAt || '') || 0) < 12 * 3600000)
    .sort((x: any, y: any) => (Date.parse(y.updatedAt || y.preparedAt || '') || 0) - (Date.parse(x.updatedAt || x.preparedAt || '') || 0));
  return { same: mine[0] || null, other };
}
const otherPaidOf = (p: any) => { const tp = ticketPayment(p); const pp = p ? paidPayloadOf(p) : null; return p && tp && pp ? { pendingId: p.id, clientName: p.clientName || null, cents: tp.cents, via: tp.via, paidAt: p.paidAt || null, items: pp.items, visits: pp.appointmentIds.length, paidPayload: pp } : null; };

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const action = String(b.action || 'complete');
  // ── A ticket is saved as "started" before a card is charged, so a paid sale can always be recorded later ──
  //  - A ticket already paid is never changed: it stays exactly as it was paid for, and the desk is told it's paid (and
  //    what it was rung up with), so it saves the sale as it was paid instead of taking another payment.
  //  - This client's ticket that's already paid is picked up again, on any screen (the page reloaded, or another screen
  //    took the payment) — so nothing is charged twice. This desk's own ticket with a card reader payment still going,
  //    or part of a split paid, is picked up after a reload too; another desk's never is (that desk is working on it).
  //  - Another client always gets a new ticket: a ticket is never reused for someone else, a finished or discarded one
  //    never comes back, and the desk hears about a paid one it left.
  //  - Saving the ticket again replaces what it was rung up with (never merged with what was there before).
  if (action === 'prepare') {
    const payload = { ...b }; delete payload.action; delete payload.pendingId; delete payload.deskId; delete payload.fresh;
    const clientId = String(b.clientId || ''); const deskId = safeId(b.deskId).slice(0, 60);
    const coll = db.collection(`${T}/pendingCheckouts`); const at = new Date().toISOString();
    const cl: any = clientId ? (((await db.doc(`${T}/clients/${clientId}`).get()).data() as any) || {}) : {};
    const givenId = safeId(b.pendingId);
    const given: any = givenId ? (((await coll.doc(givenId).get()).data() as any) || null) : null;
    const theirs = (p: any) => !p?.clientId || !clientId || p.clientId === clientId;
    // The desk's own ticket goes on being this sale's unless another of this client's matters more (this sale, paid).
    const keep = usable(given) && theirs(given) && busy(given);
    const found = clientId ? await clientTickets(coll, clientId, deskId, givenId, b) : { same: null, other: null };
    const adoptId = !keep && found.same ? found.same.id : '';
    const out = await db.runTransaction(async (tx: any) => {
      const gRef = givenId ? coll.doc(givenId) : null; const aRef = adoptId ? coll.doc(adoptId) : null;
      const g: any = gRef ? (((await tx.get(gRef)).data() as any) || null) : null;
      const a: any = aRef ? (((await tx.get(aRef)).data() as any) || null) : null;
      let ref: any; let prev: any; let isNew = false;
      if (a && usable(a) && (ticketPayment(a) || (busy(a) && !!deskId && a.deskId === deskId))) { ref = aRef; prev = a; }
      else if (g && usable(g) && theirs(g)) { ref = gRef; prev = g; }
      else { ref = coll.doc(); prev = {}; isNew = true; }
      let left: any = null;
      if (g && gRef && ref.id !== gRef.id) {
        const lp = ticketPayment(g);
        if (lp || liveShares(g).length) left = { pendingId: gRef.id, clientName: g.clientName || null, cents: lp ? lp.cents : 0, via: lp ? lp.via : 'split' };
        // The desk moved on before anything was paid on it: put away, so it never shows as a sale not recorded. (A
        // payment for it that lands after this brings it back as paid: lib/reader-sale.)
        else if (!busy(g) && String(g.status || 'prepared') === 'prepared' && !g.paymentIntentId) tx.set(gRef, { status: 'discarded', discardedAt: at, discardedBy: 'System', discardReason: 'The desk moved on to another sale before anything was paid.', updatedAt: at }, { merge: true });
      }
      // A different sale of theirs that's paid but not saved: the desk is shown it, to save on its own.
      const otherPaid = found.other && found.other.id !== ref.id ? otherPaidOf(found.other) : null;
      const paid = ticketPayment(prev);
      if (paid) { tx.set(ref, { updatedAt: at, seenBy: auth.actor.name || null }, { merge: true });
        return { pendingId: ref.id, paid, paidPayload: paidPayloadOf(prev), expectedTotal: Number(prev.expectedTotal) || 0, left, ...(otherPaid ? { otherPaid } : {}) }; }
      const shares = liveShares(prev);
      const fields = { id: ref.id, status: shares.length ? 'partial' : 'prepared', payload, clientId, clientName: cl.name || null, expectedTotal: Number(b.expectedTotal) || 0,
        preparedAt: prev.preparedAt || at, updatedAt: at, preparedBy: auth.actor.name || null, deskId: prev.deskId || deskId || null };
      if (isNew) tx.set(ref, fields); else tx.update(ref, fields);
      return { pendingId: ref.id, ...(shares.length ? { tenders: shares, paidSoFar: shares.reduce((s2: number, x: any) => s2 + num(x.amount) + num(x.tip), 0) } : {}), left, ...(otherPaid ? { otherPaid } : {}) };
    });
    return NextResponse.json({ ok: true, ...out });
  }
  // ── SPLIT THE BILL: each share is paid (cash, a card, the iPad / their phone, other) and recorded here against the
  //    started ticket AS IT HAPPENS — so if it stops halfway, nothing is lost (Sales not recorded shows "$50 of $120 paid").
  //    A card share is checked with Stripe: it went through, for the right amount, taken at the desk for this very sale,
  //    and not used anywhere else. Only such a share is ever refunded from here. ──
  if (action === 'tender' || action === 'tender_remove') {
    const ref = db.doc(`${T}/pendingCheckouts/${safeId(b.pendingId)}`); const pc: any = (await ref.get()).data();
    if (!pc) return NextResponse.json({ ok: false, error: 'Start the split again — the ticket wasn’t found.' }, { status: 404 });
    if (pc.status === 'completed') return NextResponse.json({ ok: false, error: 'This sale is already finished.' }, { status: 409 });
    if (pc.status === 'discarded' || pc.status === 'discarding') return NextResponse.json({ ok: false, error: 'This sale was discarded. Ring it up again.' }, { status: 409 });
    // A sale already paid in full can't take split shares on top: a card share already charged is kept apart for a manager.
    const paidAll = ticketPayment(pc);
    if (paidAll && action === 'tender') {
      const extra = b.method === 'card' && b.stripePaymentIntentId ? await keepApartPayment(db, tenantId, ref.id, String(b.stripePaymentIntentId)) : null;
      return NextResponse.json({ ok: false, code: 'ticket_paid', paidWith: paidAll, paidPayload: paidPayloadOf(pc), extra, error: `This sale was already paid${paidAll.cents ? `: $${(paidAll.cents / 100).toFixed(2)}` : ''} ${viaWords(paidAll.via)}.${extra ? ` The $${(extra.cents / 100).toFixed(2)} card share is kept apart for a manager to refund.` : ''}` }, { status: 409 });
    }
    const tenders: any[] = Array.isArray(pc.tenders) ? pc.tenders : [];
    const t0: any = ((await db.doc(T).get()).data() as any) || {}; const acct = accountOf(t0); const stripe = readerStripe();
    if (action === 'tender_remove') {
      const tenderId = String(b.tenderId || '');
      if (!tenders.some((x) => x && x.id === tenderId)) return NextResponse.json({ ok: false, error: 'That payment wasn’t found.' }, { status: 404 });
      // Claimed first, in one step: never on a sale that's finished, discarded or being discarded (a share on a recorded
      // receipt is never refunded from here), and a save of the split under way records nothing once this has begun.
      const at0 = new Date().toISOString();
      const claim: any = await db.runTransaction(async (tx: any) => {
        const cur: any = ((await tx.get(ref)).data() as any) || null;
        if (!cur) return { status: 404, error: 'Start the split again — the ticket wasn’t found.' };
        if (cur.status === 'completed') return { status: 409, error: 'This sale is already finished, so its payments can’t be taken off here. A manager can refund it from the receipt.' };
        if (['discarded', 'discarding'].includes(String(cur.status || ''))) return { status: 409, error: 'This sale was discarded. Ring it up again.' };
        const list: any[] = Array.isArray(cur.tenders) ? cur.tenders : []; const t1 = list.find((x: any) => x && x.id === tenderId);
        if (!t1) return { status: 404, error: 'That payment wasn’t found.' };
        if (t1.removingAt && Date.now() - (Date.parse(t1.removingAt) || 0) < 2 * 60000) return { status: 409, error: 'That payment is being taken off already.' };
        tx.set(ref, { tenders: list.map((x: any) => (x && x.id === tenderId ? { ...x, removingAt: at0, removingBy: auth.actor.name || null } : x)), updatedAt: at0 }, { merge: true });
        return { ok: true, tn: t1 };
      });
      if (!claim.ok) return NextResponse.json({ ok: false, error: claim.error }, { status: claim.status || 409 });
      const tn: any = claim.tn;
      const letGo = () => saveShareRefund(db, ref, tenderId, { removingAt: null, removingBy: null }).catch(() => {});
      let refunded = false;
      if (tn.stripePaymentIntentId && !tn.refundedAt) {
        if (!acct || !stripe) { await letGo(); return NextResponse.json({ ok: false, error: 'Card payments aren’t set up, so that card share can’t be refunded from here.' }, { status: 400 }); }
        const c = await checkDeskPayment(stripe, acct, String(tn.stripePaymentIntentId), tenantId, ref.id);
        if (!c.ok && c.status === 'unknown') { await letGo(); return NextResponse.json({ ok: false, error: 'We couldn’t reach card payments to check that share. Nothing was refunded. Try again in a moment.' }, { status: 503 }); }
        if (!c.ok && c.status === 'refunded') refunded = true;   // already given back (in Stripe itself): nothing to refund again
        else if (!c.ok) { await letGo(); return NextResponse.json({ ok: false, error: 'That card payment wasn’t taken at the desk for this sale, so it isn’t refunded from here. A manager can refund it from Money.' }, { status: 409 }); }
        else { refunded = await refundPaymentIntent(acct, c.id); if (!refunded) { await letGo(); return NextResponse.json({ ok: false, error: 'The card refund didn’t go through — try again, or refund it from Money.' }, { status: 502 }); } }
      }
      // Taken off in one step, so a share being added at the same moment isn't lost.
      const left: any[] = await db.runTransaction(async (tx: any) => {
        const cur: any = ((await tx.get(ref)).data() as any) || {}; const now0 = new Date().toISOString();
        const rest = (Array.isArray(cur.tenders) ? cur.tenders : []).filter((x: any) => x && x.id !== tenderId);
        const { removingAt: _r, removingBy: _b, ...was } = tn;
        tx.set(ref, { tenders: rest, status: rest.some((x: any) => !x.refundedAt) ? 'partial' : 'prepared', paidSoFar: Math.round(rest.filter((x: any) => !x.refundedAt).reduce((s2: number, x: any) => s2 + num(x.amount) + num(x.tip), 0) * 100) / 100,
          updatedAt: now0, removedTenders: FieldValue.arrayUnion({ ...was, removedAt: now0, removedBy: auth.actor.name, refunded }) }, { merge: true });
        return rest;
      });
      return NextResponse.json({ ok: true, tenders: left, paid: left.reduce((s, x) => s + num(x.amount) + num(x.tip), 0), refunded });
    }
    const m = String(b.method || ''); if (!['cash', 'card', 'other'].includes(m)) return NextResponse.json({ ok: false, error: 'Choose how this share was paid.' }, { status: 400 });
    const amount = Math.round(num(b.amount) * 100) / 100; const tipPart = Math.max(0, Math.round(num(b.tip) * 100) / 100);
    if (!(amount > 0)) return NextResponse.json({ ok: false, error: 'Enter the amount for this share.' }, { status: 400 });
    const tn: any = { id: rid(), method: m, amount, tip: tipPart, payerName: String(b.payerName || '').slice(0, 60) || null, payerClientId: b.payerClientId ? String(b.payerClientId) : null,
      label: String(b.label || '').slice(0, 60) || null, note: String(b.note || '').slice(0, 80) || null, at: new Date().toISOString(), by: auth.actor.name || 'Staff' };
    if (m === 'cash') tn.cashGiven = Math.max(amount + tipPart, Math.round(num(b.cashGiven) * 100) / 100);
    if (m === 'card') {
      const piId = String(b.stripePaymentIntentId || ''); if (!piId) return NextResponse.json({ ok: false, error: 'That card payment has no reference.' }, { status: 400 });
      if (tenders.some((x) => x.stripePaymentIntentId === piId)) return NextResponse.json({ ok: true, tenders, paid: tenders.reduce((s, x) => s + num(x.amount) + num(x.tip), 0), already: true });
      // Already on a receipt (as a sale's payment or one share of a split): never a share here as well.
      const dup = await onAnyReceipt(db, tenantId, piId).catch(() => 'unknown');
      if (dup === 'unknown') return NextResponse.json({ ok: false, error: 'We couldn’t check that card payment just now. Try again in a moment; the card won’t be charged again.' }, { status: 503 });
      if (dup) return NextResponse.json({ ok: false, error: 'That card payment is already on another sale.' }, { status: 409 });
      if (!acct || !stripe) return NextResponse.json({ ok: false, error: 'Card payments aren’t set up for this business.' }, { status: 400 });
      const c = await checkDeskPayment(stripe, acct, piId, tenantId, ref.id);
      if (!c.ok) return NextResponse.json({ ok: false, error: c.status === 'unknown' ? 'We couldn’t reach card payments to check that share. Try again in a moment; the card won’t be charged again.' : c.error }, { status: c.status === 'unknown' ? 503 : 409 });
      if (Math.abs(c.cents - Math.round((amount + tipPart) * 100)) > 1) return NextResponse.json({ ok: false, error: 'That card payment is for a different amount.' }, { status: 409 });
      tn.stripePaymentIntentId = c.id; tn.via = String(b.via || c.via || 'card').slice(0, 30);
    }
    // Added in one step (two shares taken at once are both kept); a sale finished or paid in full meanwhile takes no
    // share — a card share is kept apart for a manager instead.
    const added = await addShareToTicket(db, tenantId, ref.id, tn);
    if (added.result === 'removed') return NextResponse.json({ ok: false, code: 'share_removed', error: 'That card share was taken off this split and refunded, so it isn’t added again.' }, { status: 409 });
    // More than the bill: cash or another way isn't taken (hand it back); a card share already charged is kept apart.
    if (added.result === 'overpays' && m !== 'card') return NextResponse.json({ ok: false, code: 'overpays', left: added.left, error: `That’s more than this bill: $${num(added.left).toFixed(2)} is left to pay. Nothing was recorded.` }, { status: 409 });
    if (added.result === 'closed' || added.result === 'paid' || added.result === 'overpays') {
      const extra = m === 'card' ? await keepApartPayment(db, tenantId, ref.id, String(tn.stripePaymentIntentId)) : null;
      const why = added.result === 'paid' ? 'This sale was already paid.' : added.result === 'overpays' ? `That’s more than this bill: $${num(added.left).toFixed(2)} was left to pay.` : 'This sale was already finished.';
      return NextResponse.json({ ok: false, code: added.result === 'paid' ? 'ticket_paid' : added.result === 'overpays' ? 'overpays' : 'sale_done', extra, error: `${why}${extra ? ` The $${(extra.cents / 100).toFixed(2)} card share is kept apart for a manager to refund.` : ''}` }, { status: 409 });
    }
    if (added.result === 'no_ticket') return NextResponse.json({ ok: false, error: 'Start the split again — the ticket wasn’t found.' }, { status: 404 });
    const next = added.tenders;
    return NextResponse.json({ ok: true, ...(added.result === 'already' ? { already: true } : { tender: tn }), tenders: next, paid: next.filter((x: any) => !x.refundedAt).reduce((s, x) => s + num(x.amount) + num(x.tip), 0) });
  }
  // ── Managers: a sale paid twice on the card reader (lib/reader-sale) — refund the extra payment to the card, or keep it ──
  if (action === 'reader_extra') {
    if (!MGR.includes(String(auth.actor.role || '').toLowerCase())) return NextResponse.json({ ok: false, error: 'Only a manager can do that.' }, { status: 403 });
    const ref = db.doc(`${T}/pendingCheckouts/${safeId(b.pendingId)}`); const pc: any = (await ref.get()).data();
    const piId = String(b.paymentIntentId || ''); const extra = pc?.readerExtra?.[piId];
    if (!pc || !extra) return NextResponse.json({ ok: false, error: 'That payment wasn’t found.' }, { status: 404 });
    if (extra.state !== 'open') return NextResponse.json({ ok: true, already: true, state: extra.state });
    const decision = b.decision === 'keep' ? 'keep' : 'refund'; const reason = String(b.reason || '').trim().slice(0, 200);
    if (decision === 'keep' && !reason) return NextResponse.json({ ok: false, error: 'Say why it’s being kept.' }, { status: 400 });
    // The payment a recorded sale was paid with is never refunded from here (that's a refund of the sale itself).
    if (decision === 'refund' && piId === String(pc.paymentIntentId || '')) return NextResponse.json({ ok: false, error: 'That payment pays for this sale, so it isn’t refunded from here.' }, { status: 409 });
    // On a recorded sale's receipt (as its payment or one share of a split), or one of this sale's own split shares: it
    // isn't extra, so it's never refunded from here (that would refund a sale that's paid for), nor kept (it's already
    // counted with that sale). A share that landed while the split was being saved isn't on its receipt: that one is extra.
    const lateShare = pc.status === 'completed' && Array.isArray(pc.receiptPaymentIntentIds) && !pc.receiptPaymentIntentIds.includes(piId);
    const own = !lateShare && (Array.isArray(pc.tenders) ? pc.tenders : []).some((x: any) => x && x.stripePaymentIntentId === piId);
    const rc = own ? 'own' : await onAnyReceipt(db, tenantId, piId).catch(() => 'unknown');
    if (rc === 'unknown') return NextResponse.json({ ok: false, error: 'We couldn’t check that payment just now. Nothing was changed. Try again in a moment.' }, { status: 503 });
    if (rc) {
      await ref.set({ readerExtra: { [piId]: { state: 'on_receipt', decidedAt: new Date().toISOString() } }, readerExtraOpen: Object.entries<any>(pc.readerExtra || {}).some(([id, e]) => id !== piId && e?.state === 'open') }, { merge: true });
      return NextResponse.json({ ok: false, error: rc === 'own' ? 'That payment is one of this sale’s split shares, so it isn’t extra.' : `That payment is on a recorded sale’s receipt, so it isn’t extra.${decision === 'keep' ? ' It’s already counted with that sale.' : ' Refund it from that sale if it needs refunding.'}` }, { status: 409 });
    }
    const left = Object.entries<any>(pc.readerExtra || {}).some(([id, e]) => id !== piId && e?.state === 'open');
    let outside = false;
    // Only a payment taken at the desk for this very sale is refunded or kept from here, and only one still there in Stripe
    // is kept (counted as income).
    const t0: any = ((await db.doc(T).get()).data() as any) || {}; const acct = accountOf(t0); const stripe = readerStripe();
    if (!acct || !stripe) return NextResponse.json({ ok: false, error: 'Card payments aren’t set up, so it can’t be checked from here.' }, { status: 400 });
    const c = await checkDeskPayment(stripe, acct, piId, tenantId, ref.id);
    if (!c.ok && c.status === 'unknown') return NextResponse.json({ ok: false, error: 'We couldn’t reach card payments to check it. Nothing was changed. Try again in a moment.' }, { status: 503 });
    if (decision === 'keep' && !c.ok && c.status === 'refunded') {
      await ref.set({ readerExtra: { [piId]: { state: 'refunded', refundedOutside: true, decidedAt: new Date().toISOString(), decidedBy: auth.actor.name || null } }, readerExtraOpen: left, updatedAt: new Date().toISOString() }, { merge: true });
      return NextResponse.json({ ok: false, error: 'That payment was already refunded in Stripe, so there’s nothing to keep. It’s off this list.' }, { status: 409 });
    }
    if (!c.ok && c.status === 'refunded') outside = true;   // already given back (in Stripe itself)
    else if (!c.ok) {
      await ref.set({ readerExtra: { [piId]: { state: 'not_this_sale', decidedAt: new Date().toISOString(), decidedBy: auth.actor.name || null } }, readerExtraOpen: left, updatedAt: new Date().toISOString() }, { merge: true });
      return NextResponse.json({ ok: false, error: 'That payment wasn’t taken at the desk for this sale, so it isn’t refunded or kept from here. It’s off this list; refund it from Money if it needs refunding.' }, { status: 409 });
    }
    else if (decision === 'refund' && !(await refundPaymentIntent(acct, c.id))) return NextResponse.json({ ok: false, error: 'The card refund didn’t go through. Try again; it won’t be refunded twice.' }, { status: 502 });
    await ref.set({ readerExtra: { [piId]: { state: decision === 'refund' ? 'refunded' : 'kept', decidedAt: new Date().toISOString(), decidedBy: auth.actor.name || null, ...(reason ? { reason } : {}), ...(outside ? { refundedOutside: true } : {}) } }, readerExtraOpen: left, updatedAt: new Date().toISOString() }, { merge: true });
    // Kept: the money is the business's, so it's in the books (once), with why it was kept.
    if (decision === 'keep') {
      const tx0 = db.doc(`${T}/transactions/kept_${safeId(piId)}`);
      await tx0.create(clean({ id: tx0.id, date: new Date().toISOString(), description: `Extra card payment kept — ${reason}`, clientOrVendor: pc.clientName || 'Client', clientId: pc.clientId || null, payerClientId: pc.clientId || null,
        type: 'income', context: 'Business', category: 'Other Income', taxBucket: 'revenue', amount: Math.round(num(extra.cents)) / 100, paymentMethod: ({ card_reader: 'Card reader', client_screen: 'Client screen', card_on_file: 'Card on file' } as Record<string, string>)[String(extra.via || '')] || 'Card',
        hasReceipt: false, stripePaymentIntentId: piId, pendingId: ref.id, keptBy: auth.actor.name || null, tenantId })).catch(() => {});
    }
    await logAuditAdmin(db, tenantId, { action: decision === 'refund' ? 'checkout.extra_refunded' : 'checkout.extra_kept', targetType: 'client', targetId: pc.clientId || '', summary: `${pc.clientName || 'A client'} paid twice: the extra $${(num(extra.cents) / 100).toFixed(2)} ${viaWords(extra.via)} was ${decision === 'refund' ? (outside ? 'already refunded in Stripe' : 'refunded to the card') : `kept — ${reason}`}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
    return NextResponse.json({ ok: true, state: decision === 'refund' ? 'refunded' : 'kept' });
  }
  // ── A sale rung up but not saved: recorded as it was rung up (no charge), or discarded. Managers only — except a sale
  //    already paid at the desk, which the desk saves as it was paid ("Save the paid sale"); its payment is checked with
  //    Stripe again as it's saved. Card reader payments still open on it are settled first, so a sale is never recorded
  //    without the payment that went through for it, nor discarded with a hold left to complete later. ──
  if (action === 'record' || action === 'discard') {
    const isMgr = MGR.includes(String(auth.actor.role || '').toLowerCase());
    const ref = db.doc(`${T}/pendingCheckouts/${safeId(b.pendingId)}`); let pc: any = (await ref.get()).data();
    if (!pc) return NextResponse.json({ ok: false, error: 'That sale wasn’t found.' }, { status: 404 });
    if (!isMgr && !(action === 'record' && ticketPayment(pc)) && pc.status !== 'completed') return NextResponse.json({ ok: false, error: 'Only a manager can do that.' }, { status: 403 });
    if (pc.status === 'completed') return NextResponse.json({ ok: true, already: true, receiptId: pc.receiptId || null, total: pc.total ?? null });
    if (pc.status === 'discarded') return NextResponse.json({ ok: false, error: 'This sale was already discarded.' }, { status: 409 });
    // Recorded after all (the desk's save went through, but the ticket wasn't marked): nothing to record or refund.
    { const byId = await db.doc(`${T}/receipts/tk_${ref.id}`).get();
      const byTicket = byId.exists ? null : await db.collection(`${T}/receipts`).where('pendingId', '==', ref.id).limit(1).get();
      const byPayment = !byId.exists && byTicket?.empty && pc.paymentIntentId ? await db.collection(`${T}/receipts`).where('stripePaymentIntentId', '==', String(pc.paymentIntentId)).limit(1).get() : null;
      const rc = byId.exists ? byId : byTicket && !byTicket.empty ? byTicket.docs[0] : byPayment && !byPayment.empty ? byPayment.docs[0] : null;
      if (rc) { await ref.set({ status: 'completed', receiptId: rc.id, completedAt: (rc.data() as any)?.date || new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
        return NextResponse.json({ ok: true, already: true, recorded: true, receiptId: rc.id, total: (rc.data() as any)?.total ?? null }); } }
    const oRef = outcomeRef(db, tenantId, ref.id);
    if (pc.status === 'discarding') {
      if (Date.now() - (Date.parse(pc.discardingAt || '') || 0) < DISCARD_HOLD_MS) return NextResponse.json({ ok: false, error: 'A manager is discarding this sale right now. Check it again in a minute.' }, { status: 409 });
      // A discard that stopped partway (its connection dropped): taken back, so the sale can be recorded or discarded again.
      if (action === 'record') { await db.runTransaction(async (tx: any) => {
        const cur: any = ((await tx.get(ref)).data() as any) || {}; const o: any = await tx.get(oRef); const od: any = o.exists ? (o.data() || {}) : null;
        if (cur.status !== 'discarding' || Date.now() - (Date.parse(cur.discardingAt || '') || 0) < DISCARD_HOLD_MS) return;
        if (od?.kind === 'discarding') tx.delete(oRef);
        tx.set(ref, { status: cur.discardFrom || 'prepared', discardingAt: null, discardingBy: null, discardFrom: null, updatedAt: new Date().toISOString() }, { merge: true });
      }); pc = (await ref.get()).data() || pc; }
    }
    const paidAs = ['cash', 'other'].includes(String(b.paidAs || '')) ? String(b.paidAs) : '';
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (action === 'discard' && !reason) return NextResponse.json({ ok: false, error: 'Say why it’s being discarded.' }, { status: 400 });
    // A payment still open for it on the client screen is closed first (one that went through goes on the sale), then
    // its card reader payments are settled: recording captures an approved hold, unless the manager says it was paid
    // another way (then the hold is released, never taken on top); discarding releases it.
    const wasPaid = !!ticketPayment(pc);
    await closeScreenPaymentsFor(db, tenantId, ref.id).catch(() => 0);
    { const s = await settleTicketReader(db, tenantId, ref.id, action, { release: action === 'record' && !!paidAs });
      if (!s.ok) return NextResponse.json({ ok: false, code: 'reader_open', error: s.error }, { status: s.status === 'unknown' ? 503 : 409 });
      pc = (await ref.get()).data() || pc; }
    if (!isMgr && !ticketPayment(pc)) return NextResponse.json({ ok: false, error: 'Only a manager can do that.' }, { status: 403 });
    const t0: any = ((await db.doc(T).get()).data() as any) || {}; const acct = accountOf(t0); const stripe = readerStripe();
    if (action === 'discard') {
      // Claimed first, in one step with the ticket's outcome (lib/reader-sale): a save of this sale that hasn't finished
      // records nothing once the discard has begun, and one that already finished stops the discard — so money is never
      // given back for a sale that's recorded. Let go again if a refund doesn't go through.
      const claim: any = await db.runTransaction(async (tx: any) => {
        const cur: any = ((await tx.get(ref)).data() as any) || null; const o: any = await tx.get(oRef); const od: any = o.exists ? (o.data() || {}) : null;
        const at0 = new Date().toISOString();
        if (!cur) return { status: 404, error: 'That sale wasn’t found.' };
        if (cur.status === 'completed' || od?.kind === 'saved') return { already: true, receiptId: cur.receiptId || od?.receiptId || null };
        if (cur.status === 'discarded' || od?.kind === 'discarded') return { status: 409, error: 'This sale was already discarded.' };
        if (od?.kind === 'discarding' && Date.now() - (Date.parse(od.at || '') || 0) < DISCARD_HOLD_MS) return { status: 409, error: 'A manager is discarding this sale right now. Check it again in a minute.' };
        const from = cur.status === 'discarding' ? String(cur.discardFrom || 'prepared') : String(cur.status || 'prepared'); const token = rid();
        tx.set(oRef, { kind: 'discarding', at: at0, by: auth.actor.name || null, token });
        tx.set(ref, { status: 'discarding', discardingAt: at0, discardingBy: auth.actor.name || null, discardFrom: from, updatedAt: at0 }, { merge: true });
        return { ok: true, from, token, pc: cur };
      });
      if (claim.already) { if (claim.receiptId) await ref.set({ status: 'completed', receiptId: claim.receiptId, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
        return NextResponse.json({ ok: true, already: true, recorded: true, receiptId: claim.receiptId }); }
      if (!claim.ok) return NextResponse.json({ ok: false, error: claim.error }, { status: claim.status || 409 });
      pc = { ...claim.pc, status: claim.from };
      const unclaim = async () => { await db.runTransaction(async (tx: any) => {
        const cur: any = ((await tx.get(ref)).data() as any) || {}; const o: any = await tx.get(oRef);
        const mine = o.exists && (o.data() || {}).token === claim.token;
        if (mine) tx.delete(oRef);
        if (mine && cur.status === 'discarding') tx.set(ref, { status: claim.from, discardingAt: null, discardingBy: null, discardFrom: null, updatedAt: new Date().toISOString() }, { merge: true });
      }).catch(() => {}); };
      // Still this discard's (no other manager took it over after its hold ran out): checked before each refund.
      const stillMine = async () => { const o: any = await oRef.get().catch(() => null); const od: any = o?.exists ? (o.data() || {}) : null; return od?.kind === 'discarding' && od.token === claim.token; };
      const lost = () => NextResponse.json({ ok: false, error: 'Another manager took this sale over before the discard finished, so nothing more was refunded. Check it in Needs attention.' }, { status: 409 });
      // A partly paid split: refund each card share taken for this sale, and say how much cash to hand back. A card
      // payment that wasn't taken at the desk for this sale is never refunded from here. Each refund is written to the
      // ticket as it happens, so a discard that stops partway never leaves a refunded share looking paid.
      const shares: any[] = Array.isArray(pc.tenders) ? pc.tenders : []; let refundedCards = 0; const failed: string[] = []; const notOurs: string[] = [];
      const cardShares = shares.filter((y) => y.stripePaymentIntentId && !y.refundedAt);
      if ((cardShares.length || pc.paymentIntentId) && (!acct || !stripe)) { await unclaim(); return NextResponse.json({ ok: false, error: 'Card payments aren’t set up, so the card payments on this sale can’t be refunded from here. Nothing was discarded.' }, { status: 400 }); }
      for (const x of cardShares) {
        const c = await checkDeskPayment(stripe, acct, String(x.stripePaymentIntentId), tenantId, ref.id);
        if (!c.ok && c.status === 'unknown') { failed.push(`$${(num(x.amount) + num(x.tip)).toFixed(2)}`); continue; }
        if (!c.ok && c.status === 'refunded') { await saveShareRefund(db, ref, x.id, { refundedAt: new Date().toISOString(), refundedOutside: true }); x.refundedAt = new Date().toISOString(); continue; }
        if (!c.ok) { notOurs.push(`$${(num(x.amount) + num(x.tip)).toFixed(2)}`); await saveShareRefund(db, ref, x.id, { notRefunded: 'not_this_sale' }); continue; }
        if (!(await stillMine())) return lost();
        if (await refundPaymentIntent(acct, c.id)) { x.refundedAt = new Date().toISOString(); await saveShareRefund(db, ref, x.id, { refundedAt: x.refundedAt }); refundedCards++; } else failed.push(`$${(num(x.amount) + num(x.tip)).toFixed(2)}`);
      }
      if (failed.length) { await unclaim(); return NextResponse.json({ ok: false, error: `The refund for ${failed.join(', ')} didn’t go through — try again (cards already refunded won’t be refunded twice).` }, { status: 502 }); }
      const cashToReturn = Math.round(shares.filter((y) => y.method === 'cash' && !y.refundedAt).reduce((a, y) => a + num(y.amount) + num(y.tip), 0) * 100) / 100;
      // A sale paid by card (on the card reader, the client screen, a saved or typed card) and never recorded:
      // discarding it refunds that card — only when the payment was taken at the desk for this sale.
      let paymentRefunded = false; let paymentKept = false;
      if (pc.paymentIntentId && ['paid_waiting', 'failed'].includes(String(pc.status)) && !pc.paymentRefundedAt) {
        const c = await checkDeskPayment(stripe, acct, String(pc.paymentIntentId), tenantId, ref.id);
        if (!c.ok && c.status === 'unknown') { await unclaim(); return NextResponse.json({ ok: false, error: 'We couldn’t reach card payments to check its card payment. Nothing was refunded or discarded. Try again in a moment.' }, { status: 503 }); }
        if (!c.ok && c.status === 'refunded') paymentRefunded = true;   // already given back (in Stripe itself)
        else if (!c.ok) paymentKept = true;
        else { if (!(await stillMine())) return lost();
          if (!(await refundPaymentIntent(acct, c.id))) { await unclaim(); return NextResponse.json({ ok: false, error: 'The card refund didn’t go through. Try again; a card already refunded isn’t refunded twice.' }, { status: 502 }); }
          paymentRefunded = true; refundedCards++; }
        if (paymentRefunded) await ref.set({ paymentRefundedAt: new Date().toISOString(), ...(pc.readerPis?.[String(pc.paymentIntentId)] ? { readerPis: { [String(pc.paymentIntentId)]: { state: 'refunded', settledAt: new Date().toISOString() } } } : {}) }, { merge: true }).catch(() => {});
      }
      // Finished only while it's still this discard's.
      const at = new Date().toISOString();
      const finished = await db.runTransaction(async (tx: any) => {
        const o: any = await tx.get(oRef); const od: any = o.exists ? (o.data() || {}) : null;
        if (od?.kind !== 'discarding' || od.token !== claim.token) return false;
        tx.set(oRef, { kind: 'discarded', at, by: auth.actor.name || null, token: claim.token, reason });
        tx.set(ref, { status: 'discarded', discardedAt: at, discardedBy: auth.actor.name, discardReason: reason, discardingAt: null, discardFrom: null, ...(shares.length ? { cashToReturn } : {}),
          ...(paymentKept ? { paymentNotRefunded: 'not_this_sale' } : {}), updatedAt: at }, { merge: true });
        return true;
      });
      if (!finished) return lost();
      await logAuditAdmin(db, tenantId, { action: 'checkout.discarded', targetType: 'client', targetId: pc.clientId || '', summary: `Unrecorded sale for ${pc.clientName || 'a client'} ($${Number(pc.expectedTotal || 0).toFixed(2)}) discarded — ${reason}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
      const kept = [...(paymentKept ? [`$${(num(pc.paidCents) / 100).toFixed(2)}`] : []), ...notOurs];
      return NextResponse.json({ ok: true, discarded: true, refundedCards, cashToReturn,
        ...(kept.length ? { notRefunded: kept, warning: `The ${kept.join(', ')} card payment${kept.length === 1 ? '' : 's'} on it ${kept.length === 1 ? 'wasn’t' : 'weren’t'} refunded: ${kept.length === 1 ? 'it isn’t' : 'they aren’t'} marked as taken at the desk for this sale. Refund from Money if the client should get it back.` } : {}) });
    }
    // As it was paid: a payment taken on the client screen carries the tip the client chose there.
    const paidTip = Math.max(0, num(pc.paidTip));
    const tipParts = paidTip > 0 ? (() => { const out: Record<string, number> = { ...((pc.payload?.tipAllocations && typeof pc.payload.tipAllocations === 'object') ? pc.payload.tipAllocations : {}) };
      for (const [k, v] of Object.entries<any>(pc.paidTipAllocations || {})) out[k] = Math.round((num(out[k]) + num(v)) * 100) / 100; return out; })() : null;
    // Nothing paid on it at the desk: a manager says how it was paid (cash, or another way). A card sale is only ever
    // recorded with the card payment that paid for it.
    const unpaid = !pc.paymentIntentId && !liveShares(pc).length;
    const rungAs = String(pc.payload?.payment?.method || '');
    if (unpaid && !paidAs && (!rungAs || CARD_METHODS.includes(rungAs))) return NextResponse.json({ ok: false, code: 'say_how', error: 'Say how it was paid: in cash or another way. A card sale is recorded with its card payment.' }, { status: 400 });
    const replay = { ...(pc.payload || {}), clientId: pc.payload?.clientId || pc.clientId || '', tenantId, pendingId: ref.id, expectedTotal: Math.round((num(pc.expectedTotal) + paidTip) * 100) / 100, ...(paidTip > 0 ? { tip: Math.round((num(pc.payload?.tip) + paidTip) * 100) / 100, ...(tipParts && Object.keys(tipParts).length ? { tipAllocations: tipParts } : {}) } : {}),
      payment: { ...(pc.payload?.payment || {}), stripePaymentIntentId: null, ...(unpaid && paidAs ? { method: paidAs, amountTendered: num(pc.expectedTotal) } : {}), ...(liveShares(pc).length ? { method: 'split' } : {}),
        ...(pc.paymentIntentId ? { stripePaymentIntentId: pc.paymentIntentId, method: methodOfVia(pc.paidVia) } : {}) }, recordedLater: true };
    const r = await runCheckout(db, tenantId, replay, auth, req);
    // Said to be paid another way, but a card payment for it went through (found as it was settled): it's recorded with
    // that payment, and the manager is told.
    if (r.body?.ok && paidAs && !wasPaid && pc.paymentIntentId) r.body.warnings = [...(r.body.warnings || []), `A ${pc.paidCents ? `$${(num(pc.paidCents) / 100).toFixed(2)} ` : ''}card payment went through for this sale, so it’s recorded with that payment, not as ${paidAs === 'cash' ? 'cash' : 'paid another way'}. If they paid ${paidAs === 'cash' ? 'cash' : 'another way'} too, give that back.`];
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = await runCheckout(db, tenantId, b, auth, req);
  return NextResponse.json(r.body, { status: r.status });
}

/** One split share's refund (or why it wasn't refunded), written on the ticket in one step, with what's paid so far. */
async function saveShareRefund(db: any, ref: any, tenderId: string, fields: Record<string, any>): Promise<void> {
  await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(ref)).data() as any) || null; if (!cur) return;
    const list = (Array.isArray(cur.tenders) ? cur.tenders : []).map((x: any) => (x && x.id === tenderId ? { ...x, ...fields } : x));
    const live = list.filter((x: any) => x && !x.refundedAt);
    tx.set(ref, { tenders: list, paidSoFar: Math.round(live.reduce((s2: number, x: any) => s2 + num(x.amount) + num(x.tip), 0) * 100) / 100, updatedAt: new Date().toISOString() }, { merge: true });
  });
}
async function runCheckout(db: any, tenantId: string, b: any, auth: any, req: NextRequest): Promise<{ body: any; status: number }> {
  const T0 = `tenants/${tenantId}`;
  const clientIdIn = String(b.clientId || ''); const deskId = safeId(b.deskId).slice(0, 60);
  const coll = db.collection(`${T0}/pendingCheckouts`);
  const askedId = safeId(b.pendingId);   // the ticket the desk says this sale is
  let pendingRef: any = askedId ? coll.doc(askedId) : null;
  let ticket0: any = pendingRef ? ((await pendingRef.get()).data() || null) : null;
  const incomingPi = String(b.payment?.stripePaymentIntentId || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 80);
  const methodIn = String(b.payment?.method || 'card');
  // Never record the same sale twice — by its ticket, or by its card payment (as a sale's payment or one share of a split).
  if (incomingPi) {
    const dup: any = await onAnyReceipt(db, tenantId, incomingPi).catch(() => 'unknown');
    if (dup === 'unknown') return json({ ok: false, code: 'payment_unknown', error: 'We couldn’t check the card payment just now, so the sale isn’t saved yet. Nothing was charged again. Tap Save again in a moment.' }, 503);
    if (dup) {
      const d: any = dup.data() || {};
      // This sale's own receipt (saved before, and the answer was lost): the ticket is marked finished too, so it doesn't
      // come back as unrecorded. Only ever with its own receipt: one with this payment on another sale's receipt is
      // never this sale's, so the ticket is left as it is (its sale isn't lost).
      // (Or the receipt this same sale was recorded on by itself, from this ticket: it had been discarded, say.)
      const own = !!pendingRef && (dup.id === `tk_${pendingRef.id}` || d.pendingId === pendingRef.id || (!d.pendingId && !d.askedPendingId && !!ticket0 && String(ticket0.paymentIntentId || '') === incomingPi));
      const sameSale = own || (!!askedId && d.askedPendingId === askedId);
      if (pendingRef && !sameSale) return json({ ok: false, code: 'payment_used', error: 'That card payment is already on another sale’s receipt, so it can’t pay for this one. Nothing was recorded.' }, 409);
      if (own && ticket0 && !['completed', 'discarded', 'discarding'].includes(String(ticket0.status || ''))) await pendingRef.set({ status: 'completed', receiptId: dup.id, completedAt: d.date || new Date().toISOString(), ...(d.stripePaymentIntentId === incomingPi ? { paymentIntentId: incomingPi } : {}) }, { merge: true }).catch(() => {});
      return json({ ok: true, already: true, receiptId: dup.id, total: d.total ?? null, warnings: [] });
    }
  }
  // Being discarded by a manager: never saved now (the discard gives its money back).
  if (ticket0?.status === 'discarding') return json({ ok: false, code: 'sale_discarding', pendingId: pendingRef.id, error: 'A manager is discarding this sale, so it wasn’t saved. Nothing was recorded. Check Needs attention.' }, 409);
  if (ticket0?.status === 'completed') {
    // Saved before (the answer was lost): nothing is recorded twice.
    if (!incomingPi || incomingPi === String(ticket0.paymentIntentId || '')) return json({ ok: true, already: true, receiptId: ticket0.receiptId || null, checkoutSessionId: ticket0.checkoutSessionId || null, total: ticket0.total ?? null, warnings: [] });
    // A card payment taken for this finished sale again (on a screen still holding it) and on no receipt: it's extra,
    // kept apart for a manager to refund — never recorded as a sale of its own, which would record what the sale was
    // rung up with twice. A payment from before payments named their sale is that screen's next sale, recorded on its own.
    const tv: any = ((await db.doc(T0).get()).data() as any) || {}; const vAcct = accountOf(tv); const vStripe = readerStripe();
    if (vAcct && vStripe) {
      const c = await checkDeskPayment(vStripe, vAcct, incomingPi, tenantId, pendingRef.id, { legacy: methodIn !== 'split' });
      if (!c.ok && c.status === 'unknown') return json({ ok: false, code: 'payment_unknown', error: 'We couldn’t reach card payments to check the payment, so the sale isn’t saved yet. Nothing was charged again. Tap Save again in a moment.' }, 503);
      if (c.ok && !c.legacy) {
        const extra = await keepApartPayment(db, tenantId, pendingRef.id, c.id).catch(() => null);
        return json({ ok: false, code: 'sale_done', pendingId: pendingRef.id, receiptId: ticket0.receiptId || null, extra,
          error: `This sale was already saved, so the $${(c.cents / 100).toFixed(2)} card payment taken for it again wasn’t used. ${extra ? 'It’s kept apart for a manager to refund in Needs attention.' : 'A manager can refund it from Money.'}` }, 409);
      }
    }
    pendingRef = null; ticket0 = null;
  }
  // A discarded ticket isn't used again, nor one that's another client's (the desk switched clients before it was saved
  // again): the sale is recorded on its own. One left unpaid that way is put away, as when the desk starts another sale.
  let otherClient: any = null;
  if (ticket0 && (ticket0.status === 'discarded' || (ticket0.clientId && clientIdIn && ticket0.clientId !== clientIdIn))) {
    if (ticket0.status !== 'discarded') {
      otherClient = ticket0;
      if (!busy(ticket0) && String(ticket0.status || 'prepared') === 'prepared' && !ticket0.paymentIntentId) await pendingRef.set({ status: 'discarded', discardedAt: new Date().toISOString(), discardedBy: 'System', discardReason: 'The desk moved on to another sale before anything was paid.', updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    }
    pendingRef = null; ticket0 = null;
  }
  // A card reader payment still open on the ticket while it's being saved another way: settled first (one that went
  // through pays for it; one never finished is called off), so the client is never charged twice.
  if (ticket0 && !incomingPi && Object.values<any>(ticket0.readerPis || {}).some((e) => !['captured', 'recorded', 'paid_twice', 'released', 'not_charged', 'refunded'].includes(String(e?.state)))) {
    const s = await settleTicketReader(db, tenantId, pendingRef.id, 'pay');
    if (!s.ok) return json({ ok: false, code: s.status === 'unknown' ? 'reader_unknown' : 'reader_open', error: s.error }, s.status === 'unknown' ? 503 : 409);
    ticket0 = (await pendingRef.get()).data() || ticket0;
  }
  // A sale already paid is finished with THAT payment, never with another on top: cash, a card or a split here would take
  // the money twice. A second card payment that already went through is kept apart for a manager to refund, and the
  // desk and managers are told. The screen offers to save the sale as it was paid.
  const ticketPaid = ticketPayment(ticket0);
  if (ticketPaid && incomingPi !== ticketPaid.id) {
    const extra = incomingPi && pendingRef ? await keepApartPayment(db, tenantId, pendingRef.id, incomingPi) : null;
    return json({ ok: false, code: 'ticket_paid', pendingId: pendingRef.id, paidWith: ticketPaid, paidPayload: paidPayloadOf(ticket0), extra,
      error: `This sale was already paid${ticketPaid.cents ? `: $${(ticketPaid.cents / 100).toFixed(2)}` : ''} ${viaWords(ticketPaid.via)}. Save it as it was paid instead.${extra ? ` The second payment ($${(extra.cents / 100).toFixed(2)}) is kept apart for a manager to refund in Needs attention.` : ''}` }, 409);
  }
  if (!ticketPaid && methodIn !== 'split' && liveShares(ticket0).length) {
    const soFar = liveShares(ticket0).reduce((s2: number, x: any) => s2 + num(x.amount) + num(x.tip), 0);
    return json({ ok: false, code: 'ticket_split', pendingId: pendingRef.id, paidSoFar: soFar, error: `$${soFar.toFixed(2)} of this bill was already paid in a split. Finish it in Split the bill, or remove those payments there first.` }, 409);
  }
  // Cash or another way, with nothing paid on this ticket: this client's sale already paid (on any screen, in the last
  // two hours) is saved first, never paid for again — and this desk's own split or card reader payment is finished first.
  // (A manager recording a ticket from Needs attention chooses which one themselves.)
  if (!incomingPi && methodIn !== 'split' && !ticketPaid && clientIdIn && b.recordedLater !== true) {
    // Only this very sale (the same cart, or this desk's paid ticket from the last few minutes): another sale of theirs
    // that's paid but not saved is shown to the desk to save on its own, and never stops this one.
    const found = (await clientTickets(coll, clientIdIn, deskId, pendingRef ? pendingRef.id : '', b)).same;
    const fp = found ? ticketPayment(found) : null;
    if (fp) return json({ ok: false, code: 'ticket_paid', pendingId: found.id, paidWith: fp, paidPayload: paidPayloadOf(found),
      error: `${found.clientName || 'This client'}’s sale is already paid${fp.cents ? `: $${(fp.cents / 100).toFixed(2)}` : ''} ${viaWords(fp.via)}. Save it as it was paid first. Nothing was recorded.` }, 409);
    if (found && liveShares(found).length) return json({ ok: false, code: 'ticket_split', pendingId: found.id, paidSoFar: liveShares(found).reduce((s2: number, x: any) => s2 + num(x.amount) + num(x.tip), 0), error: 'Part of this client’s bill was already paid in a split. Finish it in Split the bill. Nothing was recorded.' }, 409);
    if (found && found.readerOpen === true) return json({ ok: false, code: 'reader_open', pendingId: found.id, error: 'A card reader payment for this client’s sale isn’t finished yet. Check it on the card reader screen first. Nothing was recorded.' }, 409);
  }
  // The card payment, checked with Stripe before anything is recorded with it: it went through, nothing of it was
  // refunded, and it was taken at the desk for this very sale (never an online order, a gift card, a deposit, or
  // another sale's payment).
  let verified: any = null;
  if (incomingPi) {
    const tv: any = ((await db.doc(T0).get()).data() as any) || {}; const vAcct = accountOf(tv); const vStripe = readerStripe();
    if (!vAcct || !vStripe) return json({ ok: false, code: 'payment_invalid', error: 'Card payments aren’t set up for this business, so a card payment can’t be saved with this sale.' }, 400);
    // A payment from before payments named their sale pays for a whole sale only (never a share of a split).
    const c = await checkDeskPayment(vStripe, vAcct, incomingPi, tenantId, askedId, { legacy: methodIn !== 'split', ticketsOwn: !!ticket0 && String(ticket0.paymentIntentId || '') === incomingPi });
    if (!c.ok) {
      if (c.status === 'unknown') return json({ ok: false, code: 'payment_unknown', error: 'We couldn’t reach card payments to check the payment, so the sale isn’t saved yet. Nothing was charged again. Tap Save again in a moment.' }, 503);
      if (c.status === 'refunded') {
        if (pendingRef && (!ticket0?.paymentIntentId || ticket0.paymentIntentId === incomingPi)) {
          if (ticket0?.paymentIntentId === incomingPi) await clearRefundedPayment(db, tenantId, pendingRef.id, incomingPi).catch(() => {});
          // Another payment for this sale was kept apart: it pays for the sale now, so the client isn't charged a third time.
          const promoted = await promoteKeptApart(db, vStripe, vAcct, tenantId, pendingRef.id).catch(() => null);
          if (promoted) { const pc2: any = ((await pendingRef.get()).data() as any) || {};
            return json({ ok: false, code: 'ticket_paid', pendingId: pendingRef.id, paidWith: promoted, paidPayload: paidPayloadOf(pc2),
              error: `That card payment was refunded, but the $${(promoted.cents / 100).toFixed(2)} ${viaWords(promoted.via)} kept apart for this sale pays for it now. Save the sale with that payment. Nothing was charged.` }, 409); }
        }
        return json({ ok: false, code: 'payment_refunded', error: 'That card payment was refunded, so it can’t pay for this sale. Take the payment again.' }, 409);
      }
      if (c.status === 'other_ticket') {
        // It's that sale's: kept on its own ticket, so it's recorded there (Needs attention → Sales not recorded).
        if (c.forTicket) await markSalePaid(db, tenantId, c.forTicket, c.pi, c.via || 'card').catch(() => null);
        return json({ ok: false, code: 'payment_other_sale', error: 'That card payment was taken for another sale, so it wasn’t used for this one. It’s waiting on that sale, in Needs attention under Sales not recorded.' }, 409);
      }
      return json({ ok: false, code: 'payment_invalid', error: c.error }, 409);
    }
    if (c.share && methodIn !== 'split') return json({ ok: false, code: 'payment_share', error: 'That card payment is one share of a split bill. Finish the sale in Split the bill.' }, 409);
    if (otherClient && !c.legacy) {
      await markSalePaid(db, tenantId, askedId, c.pi, c.via).catch(() => null);
      return json({ ok: false, code: 'payment_other_client', error: `That card payment was taken for ${otherClient.clientName || 'another client'}’s sale. Choose ${String(otherClient.clientName || 'them').split(' ')[0]} again to save it.` }, 409);
    }
    verified = c;
  }
  // The save didn't go through: the ticket says so (and carries the checked payment, so a manager can record the sale
  // later without charging again). A finished or discarded ticket is never changed here.
  const failPending = async (why: string) => {
    if (!pendingRef) return;
    try {
      if (verified && !ticketPaid) await markSalePaid(db, tenantId, pendingRef.id, verified.pi, verified.via);
      await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(pendingRef)).data() as any) || null;
        if (!cur || ['completed', 'discarded', 'discarding'].includes(String(cur.status || ''))) return;
        tx.set(pendingRef, { status: 'failed', lastError: why.slice(0, 300), failedAt: new Date().toISOString() }, { merge: true }); });
    } catch (e) { console.error('[checkout] ticket not marked failed', e); }
  };
  const clientId = clientIdIn;
  const apptIds: string[] = Array.isArray(b.appointmentIds) ? b.appointmentIds.map(String).slice(0, 20) : [];
  const reqItems: any[] = Array.isArray(b.items) ? b.items.slice(0, 60) : [];
  if (!clientId) return json({ ok: false, error: 'Choose who’s paying.' }, 400);
  if (!apptIds.length && !reqItems.length && !(Array.isArray(b.feeIds) && b.feeIds.length)) return json({ ok: false, error: 'Nothing to check out.' }, 400);
  const pay = { ...(b.payment || {}), stripePaymentIntentId: verified ? verified.id : null };   // only ever the payment checked above
  const method = String(pay.method || 'card'); const skipLedger = pay.skipLedger === true;
  // A split bill: the shares already taken (recorded on the started ticket) pay for this sale together.
  let split: any[] | null = null;
  // (The split's ticket as it was read here: it's finished only if nothing about it changed before the save is written.)
  let splitReadAt: any = null;
  if (method === 'split') {
    const snap: any = pendingRef ? await pendingRef.get() : null; const pcs: any = snap?.data?.() || null; splitReadAt = snap?.updateTime || null;
    split = liveShares(pcs).filter((x: any) => !removing(x));
    if (!split || !split.length) return json({ ok: false, error: 'No payments have been taken for this split yet.' }, 400);
    // Each card share is checked with Stripe again: one refunded since it was taken (or by a discard that stopped
    // partway) never pays for the sale.
    const cardShares = split.filter((x: any) => x.stripePaymentIntentId);
    if (cardShares.length) {
      const tv: any = ((await db.doc(T0).get()).data() as any) || {}; const sAcct = accountOf(tv); const sStripe = readerStripe();
      if (!sAcct || !sStripe) return json({ ok: false, code: 'payment_invalid', error: 'Card payments aren’t set up for this business, so the card shares can’t be checked.' }, 400);
      for (const x of cardShares) {
        const c = await checkDeskPayment(sStripe, sAcct, String(x.stripePaymentIntentId), tenantId, pendingRef.id, { legacy: true, ticketsOwn: true });
        const label = `$${(num(x.amount) + num(x.tip)).toFixed(2)}${x.label ? ` (${x.label})` : ''}`;
        if (!c.ok && (c.status === 'unknown' || c.status === 'processing')) return json({ ok: false, code: 'payment_unknown', error: 'We couldn’t check the card shares just now, so the sale isn’t saved yet. Nothing was charged again. Tap Finish again in a moment.' }, 503);
        if (!c.ok && c.status === 'refunded') { await saveShareRefund(db, pendingRef, String(x.id), { refundedAt: new Date().toISOString(), refundedOutside: true }).catch(() => {});
          return json({ ok: false, code: 'share_refunded', error: `The ${label} card share was refunded, so it doesn’t pay for this sale. Take that share again, then finish. Nothing was recorded.` }, 409); }
        if (!c.ok && c.status !== 'not_desk') return json({ ok: false, code: 'share_invalid', error: `The ${label} card share can’t pay for this sale: ${c.error} Nothing was recorded.` }, 409);
      }
    }
  }
  const splitCash = split ? split.filter((x) => x.method === 'cash').reduce((s, x) => s + num(x.amount) + num(x.tip), 0) : 0;
  const splitTips = split ? split.reduce((s, x) => s + num(x.tip), 0) : 0;
  const T = T0;
  const now = new Date().toISOString(); const checkoutSessionId = rid();

  // ── Load everything from the server ──
  const [tSnap, cSnap, stSnap, svSnap, invSnap, mSnap, pSnap, dSnap] = await Promise.all([
    db.doc(T).get(), db.doc(`${T}/clients/${clientId}`).get(), db.collection(`${T}/staff`).get(), db.collection(`${T}/services`).get(),
    db.collection(`${T}/inventory`).get(), db.collection(`${T}/memberships`).get(), db.collection(`${T}/packages`).get(), db.collection(`${T}/discounts`).get(),
  ]);
  const tenant: any = tSnap.data() || {}; const client: any = cSnap.exists ? { id: clientId, ...(cSnap.data() as any) } : null;
  // Store credit is used when the sale is paid, not before (lib/store-credit): never more than the client really has.
  if (b.creditAtPayment === true) { const { creditBalance } = await import('@/lib/store-credit'); b.storeCredit = Math.min(Math.max(0, num(b.storeCredit)), client ? creditBalance(client) : 0); }
  if (!client) return json({ ok: false, error: 'That client wasn’t found.' }, 404);
  const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const staff = await withPay(db, tenantId, rows(stSnap)), services = rows(svSnap), inventory = rows(invSnap), memberships = rows(mSnap), packages = rows(pSnap), allDiscounts = rows(dSnap);
  const svc = (id: string) => services.find((s: any) => s.id === id);
  const visits: any[] = [];
  for (const id of apptIds) {
    const a: any = (await db.doc(`${T}/appointments/${id}`).get()).data();
    if (!a) return json({ ok: false, error: 'One of these visits wasn’t found — refresh and try again.' }, 404);
    if (a.status === 'completed' && a.checkoutSessionId) return json({ ok: false, error: `${a.clientName || 'This visit'} has already been checked out.` }, 409);
    visits.push({ appointment: { ...a, id }, service: svc(a.serviceId) || { id: a.serviceId, name: a.serviceName || 'Service', price: num(a.price) }, addOnServices: addOnIdsOf(a).map((x: string) => svc(x)).filter(Boolean) });   // agreed counts (lib/prep-checkout)
  }
  // Sale items, priced here (never by the browser) — except next-visit deposits (capped by that booking's deposit) and rentals.
  const items: any[] = [];
  for (const it of reqItems) {
    const qty = ['rent', 'tuition'].includes(String(it.type)) ? 1 : Math.max(1, Math.min(99, Math.round(num(it.quantity) || 1))); const type = String(it.type || 'product'); const id = String(it.id || '');
    let price = num(it.price), name = String(it.name || 'Item'), stock: number | null = null;
    if (type === 'product') { const p = inventory.find((x: any) => x.id === id); if (!p) return json({ ok: false, error: `${name} isn’t in your inventory any more.` }, 400); price = num(p.msrp || p.costPerUnit); name = p.name || name; stock = num(p.totalStock); }
    else if (type === 'service') { const s = svc(id); if (s) { price = num(s.price); name = s.name || name; } }
    else if (type === 'tuition') { const acct: any = await tuitionAccount(db, tenantId, String(it.planId || '')); if (!acct) return json({ ok: false, error: 'That tuition plan wasn’t found.' }, 400);
      if (!acct.open) return json({ ok: false, error: 'That student isn’t enrolled yet — their down payment is taken on their application link.' }, 400);
      price = Math.round(num(it.price) * 100) / 100; if (!(price > 0)) return json({ ok: false, error: 'Enter the tuition amount they’re paying.' }, 400);
      if (Math.round(price * 100) > acct.balanceCents) return json({ ok: false, error: `That’s more than they owe ($${(acct.balanceCents / 100).toFixed(2)}).` }, 400);
      name = `Tuition — ${acct.name} · ${acct.program}`; (it as any).__tacct = { ...acct, __apply: (it as any).tuitionApply === 'paydown' ? 'paydown' : 'ahead' }; }
    else if (type === 'rent') { const acct: any = await renterAccount(db, T, String(it.renterId || '')); if (!acct) return json({ ok: false, error: 'That renter wasn’t found.' }, 400);
      price = Math.round(num(it.price) * 100) / 100; if (!(price > 0) || price > 20000) return json({ ok: false, error: 'Enter the rent amount they’re paying.' }, 400);
      name = `Rent — ${acct.name}${acct.booth?.name ? ` · ${acct.booth.name}` : ''}`; (it as any).__acct = acct; }
    else if (type === 'membership') { const m = memberships.find((x: any) => x.id === id); if (!m) return json({ ok: false, error: 'That membership wasn’t found.' }, 400); price = num(m.price); name = m.name || name; }
    else if (type === 'package') { const p = packages.find((x: any) => x.id === id); if (!p) return json({ ok: false, error: 'That package wasn’t found.' }, 400); price = num(p.price); name = p.name || name; }
    else if (type === 'giftcard') { const cents = Math.round(num(it.amountCents) || num(it.price) * 100); if (!(cents >= 100 && cents <= 500000)) return json({ ok: false, error: 'Gift cards are from $1 to $5,000.' }, 400);
      price = cents / 100; const g = it.gift || {}; name = `Gift card${g.recipientName ? ` for ${String(g.recipientName).slice(0, 60)}` : ''}`;
      (it as any).__gift = { cents, recipientName: g.recipientName ? String(g.recipientName).slice(0, 80) : null, recipientId: g.recipientId ? String(g.recipientId) : null, recipientPhone: g.recipientPhone ? String(g.recipientPhone).slice(0, 30) : null, recipientEmail: g.recipientEmail ? String(g.recipientEmail).slice(0, 120) : null, message: g.message ? String(g.message).slice(0, 400) : null, design: typeof g.design === 'string' && /^[a-z0-9-]{2,30}$/.test(g.design) ? g.design : null, line: g.line ? String(g.line).slice(0, 30) : null, service: g.service && typeof g.service.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(g.service.id) ? { id: g.service.id, name: String(g.service.name || '').slice(0, 80) } : null, sendVia: ['text', 'email', 'print', 'code'].includes(g.sendVia) ? g.sendVia : 'code', sendAt: g.sendAt && Date.parse(g.sendAt) > Date.now() + 60000 ? new Date(g.sendAt).toISOString() : null }; }
    else if (type === 'deposit' && it.depositForAppointmentId) { const ap: any = (await db.doc(`${T}/appointments/${String(it.depositForAppointmentId)}`).get()).data() || {}; const max = num(ap.depositAmountCents) / 100; if (max > 0) price = Math.min(price || max, max); }
    items.push({ id, type, quantity: qty, price: Math.max(0, price), name, stock, reservationId: it.reservationId || null, depositForAppointmentId: it.depositForAppointmentId || null, ...((it as any).__acct ? { __acct: (it as any).__acct } : {}), ...((it as any).__tacct ? { __tacct: (it as any).__tacct } : {}), ...((it as any).__gift ? { __gift: (it as any).__gift } : {}) });   // rent carries its renter's account to the payment step
  }
  // Everyone on the ticket: the payer, and whoever had each visit (a friend, partner or parent may be paying).
  const people: Record<string, any> = { [clientId]: client };
  for (const v of visits) { const cid = String(v.appointment.clientId || ''); if (cid && !people[cid]) { const d: any = (await db.doc(`${T}/clients/${cid}`).get()).data(); if (d) people[cid] = { id: cid, ...d }; } }
  const whoHad = (v: any) => people[String(v.appointment.clientId || '')] || client;
  // Owed fees being paid — from whoever owes them (not just the payer).
  const wantFees: string[] = Array.isArray(b.feeIds) ? b.feeIds : [];
  const fees = Object.values(people).flatMap((p: any) => (p.unpaidFees || []).filter((f: any) => wantFees.includes(f.feeId)).map((f: any) => ({ ...f, __owner: p.id })));
  const codes: string[] = Array.isArray(b.discountCodes) ? b.discountCodes.map((c: any) => String(c).toUpperCase()).slice(0, 5) : [];
  const discounts = codes.map((c) => allDiscounts.find((d: any) => String(d.code || '').toUpperCase() === c && d.appliesTo !== 'shop')).filter(Boolean);   // shop-only codes don't work at the desk
  const redeemedOffer = b.redeemedOffer && b.redeemedOffer.id ? { type: String(b.redeemedOffer.type), id: String(b.redeemedOffer.id), itemId: b.redeemedOffer.itemId ? String(b.redeemedOffer.itemId) : undefined } : null;
  const waivedIds: string[] = Array.isArray(b.waivedAppointmentIds) ? b.waivedAppointmentIds.map(String) : [];
  const tipAllocations: Record<string, number> = b.tipAllocations && typeof b.tipAllocations === 'object' ? b.tipAllocations : {};
  // WHO EARNS EACH LINE. Retail: the seller (chosen at the till, else whoever rang it up) — for retail commission.
  // A renter's visit (and a tip for a renter) is THEIR money: recorded as collected for them, never studio revenue,
  // and owed to them in their Books until the owner settles it (rule: renters' money is kept separate).
  const soldBy: string | null = b.soldBy && staff.some((s: any) => s.id === String(b.soldBy)) ? String(b.soldBy) : (auth.actor.uid || null);
  const renterOf = (sid: string) => { const s = staff.find((x: any) => x.id === sid); return s?.isRenter === true ? s : null; };
  const deskCollected: { renterId: string; staffId: string; cents: number; kind: 'service' | 'tip'; appointmentId: string | null; clientName?: string; serviceName?: string }[] = [];
  const tip = Math.max(0, num(b.tip)) + (typeof splitTips === 'number' ? splitTips : 0);   // + tips added on split shares
  // Moments (birthday / first visit / milestone) — worked out here from the client's own record and visit count.
  const doneBefore = (await db.collection(`${T}/appointments`).where('clientId', '==', clientId).get()).docs.filter((d: any) => (d.data() as any).status === 'completed' && !apptIds.includes(d.id)).length;
  const pre = prebookMoment(visits.map((v: any) => v.appointment));
  const moment = bestMomentReward([...momentsFor(tenant, client, doneBefore, new Date(), visits.length > 0), ...(pre ? [pre] : [])]);
  const sdIn = b.staffDiscount && ['pct', 'amt'].includes(b.staffDiscount.kind) && num(b.staffDiscount.value) > 0 ? { kind: b.staffDiscount.kind as 'pct' | 'amt', value: Math.max(0, num(b.staffDiscount.value)) } : null;
  // GIFT CARDS AND RENTERS (lib/gift-cards). A studio card pays for the studio's part first; it pays for a renter's
  // visit only when the business lets renters accept studio cards (Gift cards → Renters) — the studio then owes the renter
  // that amount, credited against their rent. A card a renter sold pays only for that renter's visits (they already have
  // the money). So: first the bill without gift cards, then what each card may pay for, then the bill with them.
  const calcArgs: any = { tenant, visits, staff, redeemedOffer, waivedIds, items, fees, discounts, client, memberships, tip, storeCredit: Math.max(0, num(b.storeCredit)), staffDiscount: null as any, skipGroupDiscount: b.skipGroupDiscount === true, skipMemberDiscount: b.skipMemberDiscount === true };
  const renterSettings = (tenant as any)?.giftCardSettings?.renters || {}; const salonForRenters = renterSettings.salonCards !== false;
  const giftUse: { id: string; code: string; cents: number; holdId: string | null; done?: boolean; owner: string | null; forRenters: Record<string, number> }[] = [];
  const giftTopUps: Record<string, number> = {};
  const promoCards = new Set<string>();   // bonus cards from an offer (lib/gift-offers): what they pay is a discount, not money in   // service cards whose service now costs more than was paid
  const giftPlan = async (calc0: any) => {
    const byRenter: Record<string, number> = {};
    for (const v of calc0.visits || []) if (v.renter) { const rid = String((staff.find((x: any) => x.id === v.renterStaffId) as any)?.renterId || ''); if (rid) byRenter[rid] = (byRenter[rid] || 0) + Math.round((v.mainPrice + v.addOns.reduce((t: number, x: any) => t + x.price, 0)) * 100); }
    // What the business's rules say a card can't pay for (Gift cards → Rules): products and/or tips.
    const pf = (tenant as any)?.giftCardSettings?.paysFor || {};
    const notFor = Math.round(((pf.products === false ? (items || []).filter((it: any) => it.type === 'product').reduce((s2: number, it: any) => s2 + num(it.price) * num(it.quantity), 0) : 0) + (pf.tips === false ? num(calc0.tip) : 0)) * 100);
    let studioLeft = Math.max(0, Math.round(num(calc0.giftable) * 100) - Object.values(byRenter).reduce((a, c) => a + c, 0) - notFor);
    const cardsIn: any[] = []; const usedVisits = new Set<number>();
    for (const g of (Array.isArray(b.giftCards) ? b.giftCards : []).slice(0, 5)) {
      const d: any = (await db.doc(`${T}/giftCards/${String(g?.id || '')}`).get()).data(); if (!d) return 'A gift card on this sale wasn’t found — remove it and try again.';
      if (d.promo && d.usableFrom && Date.parse(d.usableFrom) > Date.now()) return `Bonus card ${d.code} can be used from ${new Date(d.usableFrom).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}.`;
      if (d.promo) promoCards.add(String(g.id));
      let want = Math.max(0, Math.round(num(g.cents)));
      // A SERVICE gift card pays for that service on this bill — today's price, even if it went up since it was bought.
      if (d.kind === 'service' && d.serviceId) { const i = visits.findIndex((v: any, k: number) => !usedVisits.has(k) && v.service?.id === d.serviceId && !calc0.visits?.[k]?.renter);
        if (i < 0) return `Gift card ${d.code} is for a ${d.serviceName || 'specific service'} — it isn’t on this bill.`;
        usedVisits.add(i); want = Math.round(num(calc0.visits[i].mainPrice) * 100); const { available } = await import('@/lib/gift-cards');
        if (want > available(d, g.holdId ? String(g.holdId) : null)) giftTopUps[String(g.id)] = want - available(d, g.holdId ? String(g.holdId) : null); }
      // Advanced limits (lib/gift-limits): only when the business turned them on and this card has some.
      if (d.limits && limitsOn(tenant)) { const lines: BillLine[] = [];
        (calc0.visits || []).forEach((cv: any, k: number) => { const ap: any = visits[k]?.appointment || {}; const sid = visits[k]?.service?.id || null;
          lines.push({ kind: 'service', cents: Math.round(num(cv.mainPrice) * 100), serviceId: sid, staffId: ap.staffId || null });
          for (const x of cv.addOns || []) lines.push({ kind: 'service', cents: Math.round(num(x.price) * 100), serviceId: sid, staffId: ap.staffId || null }); });
        for (const it of items || []) if (it.type === 'product') lines.push({ kind: 'product', cents: Math.round(num(it.price) * num(it.quantity) * 100) });
        if (num(calc0.tip) > 0) lines.push({ kind: 'tip', cents: Math.round(num(calc0.tip) * 100) });
        const lim = giftCap(d, { channel: 'desk', lines, hasDiscount: (Array.isArray(discounts) && discounts.length > 0) || !!redeemedOffer }, true);
        if (lim.error) return lim.error; if (lim.cap != null) want = Math.min(want, lim.cap); }
      cardsIn.push({ id: String(g.id), code: d.code, wantCents: want, holdId: g.holdId ? String(g.holdId) : null, owner: d.ownerRenterId || null, ownerName: d.ownerName || null }); }
    const { planGiftUse } = await import('@/lib/gift-cards');
    const plan = planGiftUse({ cards: cardsIn, byRenter, studioLeft, salonForRenters }); if (plan.error) return plan.error;
    giftUse.push(...plan.uses);
    return null;
  };
  // A loyalty reward (lib/loyalty): checked against the program and worked out from this bill; the points come off in the
  // ledger just before the money moves (below), and go back if the checkout doesn't finish.
  let loyaltyReward: { cents: number; label: string; rewardId: string } | null = null; let loyaltyRw: any = null; let loyaltyRwCents = 0;
  // Loyalty extras on the same discount: a tier's free upgrade and a surprise (lib/loyalty), each checked again here.
  let loyaltyGifts: { kind: 'perk' | 'surprise'; name: string; cents: number; costCents: number; surpriseId?: string | null }[] = [];
  if ((b.loyaltyPerk === true || b.loyaltySurpriseId) && clientId && (tenant as any)?.loyalty?.on === true) {
    const { rewardCents: rc } = await import('@/lib/loyalty'); const { clientExtras } = await import('@/lib/loyalty-server'); const X: any = await clientExtras(db, tenantId, tenant, clientId).catch(() => null);
    const base: any = computeCheckout({ ...calcArgs, giftCard: 0 });
    const lines = (base.visits || []).filter((v: any) => !v.renter).flatMap((v: any, k: number) => [{ serviceId: visits[k]?.service?.id || null, cents: Math.round(num(v.mainPrice) * 100) }, ...(v.addOns || []).map((x: any) => ({ serviceId: x.addon?.id || null, cents: Math.round(num(x.price) * 100) }))]);
    const room = Math.round(Math.max(0, num(base.subtotal) - num(base.renterSub) - num(base.discount)) * 100);
    const up = X?.tierPerks?.upgrade; const upLine = up ? lines.find((l: any) => l.serviceId === up.toServiceId) : null;
    if (b.loyaltyPerk === true && up && upLine) { const c = Math.min(upLine.cents, up.cents); if (c > 0) loyaltyGifts.push({ kind: 'perk', name: `${X.tierPerks.name}: ${up.toName} at the ${up.fromName} price`, cents: c, costCents: c }); }
    if (b.loyaltySurpriseId) { const sid = String(b.loyaltySurpriseId); const it = X?.surprise?.id === sid ? X.surprise : (X?.teamSurprises || []).find((x: any) => x.id === sid);
      if (!it) return json({ ok: false, error: 'That surprise isn’t available for this client now. Remove it and try again.' }, 400);
      const c = rc(it, { lines, discountableCents: room }); if (c > 0) loyaltyGifts.push({ kind: 'surprise', name: it.name, cents: c, costCents: Number(it.costCents ?? c) || 0, surpriseId: sid }); }
  }
  if (b.loyaltyRewardId && clientId) {
    const { loyaltyOf, rewardCents } = await import('@/lib/loyalty'); const LS = loyaltyOf(tenant);
    loyaltyRw = LS.on ? LS.rewards.find((r) => r.on && r.id === String(b.loyaltyRewardId)) || null : null;
    if (!loyaltyRw) return json({ ok: false, error: 'That reward isn’t available any more. Remove it and try again.' }, 400);
    const { balanceFor } = await import('@/lib/loyalty-server'); const bal = await balanceFor(db, tenantId, clientId);
    if (bal < loyaltyRw.points) return json({ ok: false, error: `They have ${bal} points; ${loyaltyRw.name} needs ${loyaltyRw.points}.` }, 400);
    const base: any = computeCheckout({ ...calcArgs, giftCard: 0 });
    const lines = (base.visits || []).filter((v: any) => !v.renter).flatMap((v: any, k: number) => [{ serviceId: visits[k]?.service?.id || null, cents: Math.round(num(v.mainPrice) * 100) }, ...(v.addOns || []).map((x: any) => ({ serviceId: x.addon?.id || null, cents: Math.round(num(x.price) * 100) }))]);
    const account = (items || []).filter((it: any) => ['rent', 'tuition', 'giftcard'].includes(it.type)).reduce((t2: number, it: any) => t2 + num(it.price) * num(it.quantity), 0);
    const cents = rewardCents(loyaltyRw, { lines, discountableCents: Math.round(Math.max(0, num(base.subtotal) - num(base.renterSub) - account - num(base.discount)) * 100) });
    if (cents <= 0) return json({ ok: false, error: `${loyaltyRw.name} can’t be used on this bill.` }, 400);
    loyaltyRwCents = cents;     loyaltyReward = { cents, label: `Reward: ${loyaltyRw.name}`, rewardId: loyaltyRw.id }; calcArgs.loyaltyReward = loyaltyReward;
  }
  if (loyaltyGifts.length) { const extra = loyaltyGifts.reduce((t2, g) => t2 + g.cents, 0);
    loyaltyReward = { cents: (loyaltyReward?.cents || 0) + extra, label: [loyaltyReward?.label, ...loyaltyGifts.map((g) => (g.kind === 'surprise' ? `Surprise: ${g.name}` : g.name))].filter(Boolean).join(' · '), rewardId: loyaltyReward?.rewardId || '' }; calcArgs.loyaltyReward = loyaltyReward; }
  { const sdPre = b.staffDiscount && ['pct', 'amt'].includes(b.staffDiscount.kind) && num(b.staffDiscount.value) > 0 ? { kind: b.staffDiscount.kind as 'pct' | 'amt', value: Math.max(0, num(b.staffDiscount.value)) } : null;
    const calc0 = computeCheckout({ ...calcArgs, staffDiscount: sdPre, giftCard: 0, momentReward: moment && b.skipMomentReward !== true ? { pct: moment.rewardPct, label: moment.rewardLabel || 'Thank-you', key: moment.key } : null });
    const err = await giftPlan(calc0); if (err) return json({ ok: false, error: err }, 400); }
  const calc = computeCheckout({ tenant, visits, staff, redeemedOffer, waivedIds, items, fees, discounts, client, memberships, tip, loyaltyReward, storeCredit: Math.max(0, num(b.storeCredit)), giftCard: giftUse.reduce((s2, g) => s2 + g.cents, 0) / 100, staffDiscount: sdIn, skipGroupDiscount: b.skipGroupDiscount === true, skipMemberDiscount: b.skipMemberDiscount === true, momentReward: moment && b.skipMomentReward !== true ? { pct: moment.rewardPct, label: moment.rewardLabel || 'Thank-you', key: moment.key } : null });
  const recoveryAmount = Math.min(Math.max(0, num(b.recovery?.amount)), calc.subtotal);
  // Gift cards paying for this sale were planned above (giftPlan); the bill can't take more than it costs.
  { let over = giftUse.reduce((s2, g) => s2 + g.cents, 0) - Math.round(num((calc as any).giftCard) * 100); for (let i = giftUse.length - 1; i >= 0 && over > 0; i--) { const cut = Math.min(over, giftUse[i].cents); giftUse[i].cents -= cut; over -= cut; } }
  const recoveryReason = String(b.recovery?.reason || 'Service Recovery Adjustment').slice(0, 200);
  const cardSurcharge = Math.max(0, num(pay.cardSurcharge));
  // ── Deposits for these visits (lib/credit-pools) ──
  // A deposit is money paid for one booking: it comes off that visit's bill, from what's left on it. Only a sale with a
  // visit takes one: each visit's own deposit; otherwise one carried over from a booking that isn't still to come (a
  // booking moved to a new time keeps its first booking's deposit). Never store credit (it shares the collection) and
  // never a deposit paid for another booking still to come. Each one is used in the same step as the sale, only if it
  // hasn't changed since it was read (two checkouts at once can't both use it).
  let depositsUsing: { ref: any; id: string; data: any; updateTime: any; left: number }[] = [];
  if (apptIds.length) {
    try {
      const { creditLeftCents, isDepositCredit, pickDeposit, spendable } = await import('@/lib/credit-pools');
      let cs = await db.collection(`${T}/depositCredits`).where('status', '==', 'available').where('clientId', '==', clientId).get();
      if (cs.empty && client.email) cs = await db.collection(`${T}/depositCredits`).where('status', '==', 'available').where('clientEmail', '==', String(client.email).toLowerCase().trim()).get();
      // The visits' own deposits too, whoever is paying (a parent paying for her daughter's visit uses the daughter's deposit).
      const byId = new Map<string, any>(); for (const d of cs.docs) byId.set(d.id, d);
      const own = await db.collection(`${T}/depositCredits`).where('sourceAppointmentId', 'in', apptIds.slice(0, 30)).get().catch(() => null);
      for (const d of own?.docs || []) byId.set(d.id, d);
      const all = [...byId.values()].map((d: any) => ({ ref: d.ref, id: d.id, updateTime: d.updateTime, ...(d.data() as any) })).filter((c: any) => isDepositCredit(c) && spendable(c) && !isCreditExpired(c.expiresAt));
      const mine = all.filter((c: any) => apptIds.includes(String(c.sourceAppointmentId || '')));
      let picked: any[] = mine;
      if (!picked.length) {
        // A deposit from another booking is used only when that booking isn't still to come.
        const upcoming = new Set<string>();
        for (const c of all.slice(0, 10)) {
          const src = String(c.sourceAppointmentId || ''); if (!src) continue;
          const a: any = (await db.doc(`${T}/appointments/${src}`).get()).data();
          if (a && !['cancelled', 'canceled', 'completed', 'no_show', 'noshow', 'rescheduled'].includes(String(a.status || '')) && (Date.parse(String(a.startTime || '')) || 0) > Date.now()) upcoming.add(src);
        }
        const one = pickDeposit(all, [], (id) => upcoming.has(id)); picked = one ? [one] : [];
      }
      depositsUsing = picked.map((c: any) => ({ ref: c.ref, id: c.id, data: c, updateTime: c.updateTime, left: creditLeftCents(c) })).filter((x) => x.left > 0);
    } catch (e) { console.warn('[checkout] deposit credit lookup', e); depositsUsing = []; }
  }
  const depositCredit: any = depositsUsing[0] || null;
  const depositCreditDollars = depositsUsing.reduce((t, x) => t + x.left, 0) / 100;

  // A card sale is only ever saved with the card payment that paid for it (checked above): one with no card payment is
  // refused before anything is used up, so a sale is never recorded as paid by card when nothing was charged.
  if (CARD_METHODS.includes(method) && !verified && Math.round((calc.total - Math.min(depositCreditDollars, calc.total)) * 100) > 0)
    return json({ ok: false, code: 'card_unpaid', error: 'This sale’s card payment wasn’t found, so it isn’t saved. Take the payment again, or choose how they paid. Nothing was recorded.' }, 409);
  // ── Approvals (checked HERE — the browser can't skip them). Managers checking out approve by being signed in. ──
  const actorIsManager = isApprover(auth.actor.role);
  const approvedWaivers: Record<string, { by: string; reason: string | null }> = {};
  for (const id of waivedIds) {
    if (actorIsManager) { approvedWaivers[id] = { by: auth.actor.name, reason: b.waivers?.[id]?.reason || null }; continue; }
    const ok = await consumeApproval(db, tenantId, b.waivers?.[id]?.approvalToken, { kind: 'waive', ref: id });
    if (!ok) { await failPending('A fee waiver wasn’t approved by a manager.'); return json({ ok: false, error: 'Waiving fees needs a manager’s approval — ask a manager to enter their PIN.' }, 403); }
    approvedWaivers[id] = { by: ok.approverName, reason: ok.reason || b.waivers?.[id]?.reason || null };
  }
  // Staff discount: front desk up to the business's limit (10% by default); above it, a manager approves. Managers aren't limited.
  let staffDiscountApprovedBy: string | null = null;
  const staffDiscountReason = String(b.staffDiscount?.reason || '').trim().slice(0, 200);
  if (calc.staffDiscount > 0) {
    if (!staffDiscountReason) return json({ ok: false, error: 'A staff discount needs a reason.' }, 400);
    const limitPct = Number.isFinite(Number(tenant?.approvalRules?.staffDiscountLimitPct)) ? Number(tenant.approvalRules.staffDiscountLimitPct) : 10;
    const pctGiven = calc.subtotal > 0 ? (calc.staffDiscount / calc.subtotal) * 100 : 0;
    if (!actorIsManager && pctGiven > limitPct + 0.001) {
      const ok = await consumeApproval(db, tenantId, b.staffDiscount?.approvalToken, { kind: 'discount', amount: calc.staffDiscount });
      if (!ok) { await failPending('A staff discount over the limit wasn’t approved.'); return json({ ok: false, error: `That discount is over your ${limitPct}% limit — a manager needs to approve it.` }, 403); }
      staffDiscountApprovedBy = ok.approverName;
    } else if (actorIsManager) staffDiscountApprovedBy = auth.actor.name;
  }
  let recoveryApprovedBy: string | null = null;
  if (recoveryAmount > 0) {
    const { overStaffLimit } = await import('@/lib/staff-limit');   // one rule for discounts and store credit
    const over = overStaffLimit(tenant, recoveryAmount, calc.subtotal);
    if (over && !actorIsManager) {
      const ok = await consumeApproval(db, tenantId, b.recovery?.approvalToken, { kind: 'recovery', amount: recoveryAmount });
      if (!ok) { await failPending('Service recovery above the limit wasn’t approved.'); return json({ ok: false, error: `Service recovery over your limit needs a manager’s approval ($${recoveryAmount.toFixed(2)}).` }, 403); }
      recoveryApprovedBy = ok.approverName;
    } else if (over) recoveryApprovedBy = auth.actor.name;
  }
  // Units held for paid online orders (lib/held-stock): selling into them would leave one of those orders short, so a
  // manager says yes — signed in, or their PIN at the desk (one approval, used here, for the products and the number of
  // units it names: a bigger sale, or another product, asks again).
  const heldShort = heldShortfall(items, inventory);
  let heldApprovedBy: string | null = null;
  if (heldShort.length) {
    if (actorIsManager) heldApprovedBy = auth.actor.name;
    else {
      const ok = await consumeApproval(db, tenantId, b.heldStock?.approvalToken, { kind: 'held_stock', covers: (a: any) => heldCovered(a?.ref, heldShort) });
      if (!ok) { await failPending('Units held for online orders weren’t approved to sell.'); return json({ ok: false, code: 'held_stock', held: heldShort, error: `${heldShort.map(heldLine).join('; ')}. A manager needs to approve selling them.` }, 409); }
      heldApprovedBy = ok.approverName;
    }
  }
  // The "up to" price the client agreed (before the visit or in person) — the work can't go over it unless they agreed again.
  for (const [idx, v] of visits.entries()) {
    const o = overCeiling(v.appointment, workOf(calc.visits[idx]));
    if (o.over) { await failPending('Over the price the client agreed.'); return json({ ok: false, error: `${v.appointment.clientName || 'This visit'} agreed to up to $${(o.ceiling || 0).toFixed(2)} — this is $${o.by.toFixed(2)} more. Take off what wasn’t done, or record that they agreed to the higher price in person.` }, 409); }
  }
  const expected = num(b.expectedTotal); const mismatch = Number.isFinite(expected) && b.expectedTotal !== undefined && Math.abs(expected - calc.total) > 0.01;

  // ── Write it all, together ──
  const batch = db.batch();
  // A shared service: the visit names an assistant and their share (Appointment → "Assisted by"); the main service line
  // carries it so both people's pay splits the credit (lib/commission → splitShare).
  // Only an assistant who earns commission takes a share — someone paid by the hour is already paid for that time
  // through the clock, so the provider keeps the full credit (the visit still records who helped).
  const assistOf = (appt: any, mainStaffId: string) => { const x = appt?.assist; const p = Math.round(Number(x?.pct)); if (!x?.staffId || x.staffId === mainStaffId) return {};
    const helper = staff.find((s: any) => s.id === x.staffId); const shares = helper && ['commission', 'hourly_plus_commission'].includes(String(helper.payStructure || ''));
    return shares && p > 0 && p < 100 ? { splitWith: { staffId: String(x.staffId), pct: p } } : { assistedBy: String(x.staffId) }; };
  const txn = (f: any) => { if (!skipLedger) { const r = db.collection(`${T}/transactions`).doc(); batch.set(r, clean({ id: r.id, date: now, clientOrVendor: client.name || 'Client', clientId, payerClientId: clientId, paidBy: client.name || null, tenantId, checkoutSessionId, ...f })); } };
  const spend: Record<string, number> = {};   // lifetime value, by person
  const credit = (cid: string, amt: number) => { spend[cid] = (spend[cid] || 0) + amt; };
  let totalLtvIncrease = 0, totalCashIncrease = 0, cashTipsTotal = 0;
  const add = (amt: number) => { totalLtvIncrease += amt; if (method === 'cash') totalCashIncrease += amt; };
  const cashTipsByStaff: Record<string, any> = {}; const cashTipsPlain: Record<string, number> = {};
  const tmhr = num(tenant.tmhr) || 50;
  for (const [idx, v] of visits.entries()) {
    const vc = calc.visits[idx]; const a = v.appointment; const mainStaff = staff.find((s: any) => s.id === vc.mainStaffId);
    const had = whoHad(v); const forHad = { clientId: had.id, clientOrVendor: had.name || 'Client' };   // the visit is theirs; the payer is on every line
    const before = totalLtvIncrease;
    add(vc.mainPrice);
    const rStaff = vc.renter ? staff.find((s: any) => s.id === vc.renterStaffId) : null;
    const asRenter = vc.renter ? { category: 'Collected for renter', taxBucket: 'pass_through', renterId: String(rStaff?.renterId || a.renterId || '') || null, renterStaffId: vc.renterStaffId } : {};
    const tookOver = (sid: string) => (a.staffId && sid && sid !== a.staffId ? { bookedWithStaffId: a.staffId } : {});   // someone else stepped in
    txn({ ...forHad, description: vc.mainRedeemed ? `Redemption: ${v.service.name}` : `Service: ${vc.renter && a.renterServiceName ? a.renterServiceName : v.service.name}`, type: 'income', context: 'Business', category: 'Service Revenue', taxBucket: 'revenue', amount: vc.mainPrice, paymentMethod: method, staffId: vc.mainStaffId, appointmentId: a.id, hasReceipt: true, ...(vc.renter ? {} : saleStamp(mainStaff, v.service, { minutes: Number(a.providerMinutes) || Number(v.service?.duration) || undefined, coveredAt: vc.mainRedeemed ? vc.mainList : null, price: vc.mainPrice, tenant, discountShare: (calc as any).discountShare })), ...(!vc.renter ? assistOf(a, vc.mainStaffId) : {}), ...asRenter, ...tookOver(vc.mainStaffId) });
    if (vc.mainRedeemed) { const cost = computeServiceCost(v.service, a, mainStaff, inventory, tmhr); if (cost.total > 0) txn({ description: `Redemption Cost: ${v.service.name}`, type: 'expense', context: 'Business', category: 'Comp & Redemption Cost', taxBucket: 'operating_cost', amount: cost.total, paymentMethod: 'Internal', staffId: vc.mainStaffId, appointmentId: a.id, hasReceipt: false, notes: `Materials $${cost.materials.toFixed(2)} · Overhead $${cost.overhead.toFixed(2)} · Labor $${cost.labor.toFixed(2)}` }); }
    for (const ad of vc.addOns) {
      if (ad.redeemed) { const cost = computeServiceCost(ad.addon, a, staff.find((s: any) => s.id === ad.staffId), inventory, tmhr); if (cost.total > 0) txn({ description: `Redemption Cost: ${ad.addon.name}`, type: 'expense', context: 'Business', category: 'Comp & Redemption Cost', taxBucket: 'operating_cost', amount: cost.total, paymentMethod: 'Internal', staffId: ad.staffId, appointmentId: a.id, hasReceipt: false }); }
      add(ad.price);
      txn({ ...forHad, description: `${ad.redeemed ? 'Redemption' : 'Add-on'}: ${ad.addon.name}`, type: 'income', context: 'Business', category: 'Service Revenue', taxBucket: 'revenue', amount: ad.price, paymentMethod: method, staffId: ad.staffId, appointmentId: a.id, hasReceipt: true, ...(vc.renter ? {} : saleStamp(staff.find((s: any) => s.id === ad.staffId), ad.addon, { coveredAt: ad.redeemed ? ad.list : null, price: ad.price, tenant, discountShare: (calc as any).discountShare })), ...asRenter, ...tookOver(ad.staffId) });
    }
    const fee = (amount: number, description: string, category: string) => { if (amount > 0) { add(amount); txn({ ...forHad, description, type: 'income', context: 'Business', category, taxBucket: 'adjustment', amount, paymentMethod: method, staffId: vc.mainStaffId, appointmentId: a.id, hasReceipt: false }); } };
    fee(vc.rescheduleFee, `Reschedule Recovery: ${v.service.name}`, 'Protocol Recovery');
    fee(vc.dayChangeFee, `On-the-day change fee: ${v.service.name}`, 'Adjustment Fee');
    fee(vc.timeOverage, `Time Floor Overage: ${v.service.name}`, 'Strategic Adjustment');
    fee(vc.materialOverage, `Material Protocol Overage: ${v.service.name}`, 'Strategic Adjustment');
    fee(vc.additionalCharge, 'Strategic Adjustment Fee', 'Adjustment Fee');
    for (const r of vc.refreshments) { const amt = r.price * r.qty; if (amt > 0) { add(amt); txn({ ...forHad, description: `Concierge: ${r.name} (x${r.qty})`, type: 'income', context: 'Business', category: 'Hospitality Revenue', taxBucket: 'revenue', amount: amt, paymentMethod: method, appointmentId: a.id, hasReceipt: false }); } }
    credit(had.id, totalLtvIncrease - before);   // the visit's value counts for the person who had it
    if (vc.renter) { const cents = Math.round((vc.mainPrice + vc.addOns.reduce((t: number, x: any) => t + x.price, 0)) * 100);
      if (cents > 0) deskCollected.push({ renterId: String((asRenter as any).renterId || ''), staffId: String(vc.renterStaffId || ''), cents, kind: 'service', appointmentId: a.id, clientName: had.name || 'Client', serviceName: a.renterServiceName || v.service?.name || 'Service' }); }
    const revenue = vc.mainPrice + vc.addOns.reduce((s: number, x: any) => s + x.price, 0);
    const waiver = vc.waived ? { authorizerId: b.waivers?.[a.id]?.authorizerId, reason: approvedWaivers[a.id]?.reason || b.waivers?.[a.id]?.reason, verifiedBy: approvedWaivers[a.id]?.by } : null;   // who approved (verified above), and why
    batch.set(db.doc(`${T}/appointments/${a.id}`), clean({ status: 'completed', stage: 'complete', timeline: [...(Array.isArray(a.timeline) ? a.timeline : []), { at: now, kind: 'stage', stage: 'complete', text: `Paid — ${method === 'split' ? 'split between payments' : method.replace(/_/g, ' ')}`, by: auth.actor.name || 'Staff', via: 'checkout' }].slice(-60), statusBeforeCheckout: a.status || 'checked_in', revenue, actualEndTime: now, checkoutSessionId, checkedOutAt: now, checkedOutBy: auth.actor.name,
      ...(waiver ? { feesWaived: { by: String(waiver.authorizerId || auth.actor.uid || ''), byName: waiver.verifiedBy || staff.find((s: any) => s.id === waiver.authorizerId)?.name || auth.actor.name, reason: String(waiver.reason || '').slice(0, 200) || null, at: now } } : {}) }), { merge: true });
    if (waiver) await logAuditAdmin(db, tenantId, { action: 'checkout.fees_waived', targetType: 'appointment', targetId: a.id, summary: `Fees waived for ${had.name || 'a client'} — approved by ${waiver.verifiedBy || staff.find((s: any) => s.id === waiver.authorizerId)?.name || 'a manager'}${waiver.reason ? `: ${waiver.reason}` : ''}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
    if (a.checkInToken) { batch.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), { status: 'completed', tenantId }, { merge: true }); batch.set(db.doc(`${T}/appointmentCheckIns/${a.checkInToken}`), { status: 'completed' }, { merge: true }); }
    const involved = new Set<string>([a.staffId, vc.mainStaffId, ...vc.addOns.map((x: any) => x.staffId)].filter(Boolean));
    for (const sid of involved) batch.set(db.doc(`${T}/staff/${sid}`), { status: 'available', lastWalkInCompletedAt: now }, { merge: true });
  }
  const toEnroll: { offeringType: 'membership' | 'package'; offeringId: string }[] = [];
  const rentPayments: any[] = [];
  // Made early: a rent payment points to its receipt. A sale with a ticket has ONE receipt id, made from the ticket, and
  // it's created (never overwritten): two saves of the same sale at once (the desk and a manager, or "Save again") can't
  // both record it — the second finds it already there.
  const receiptRef = pendingRef ? db.doc(`${T}/receipts/tk_${pendingRef.id}`) : db.collection(`${T}/receipts`).doc();
  for (const it of items) {
    const value = it.price * it.quantity;
    const category = it.type === 'giftcard' ? 'Gift Card Sales' : it.type === 'deposit' ? 'Retainers' : it.type === 'service' ? 'Service Revenue' : it.type === 'membership' ? 'Membership Sales' : it.type === 'package' ? 'Package Sales' : it.type === 'rental' ? 'Space Rental' : it.type === 'rent' ? 'Booth Rent' : it.type === 'tuition' ? 'Tuition' : 'Retail';
    const description = it.type === 'giftcard' ? `Gift card sold: ${it.name}` : it.type === 'deposit' ? `Deposit: ${it.name}` : it.type === 'service' ? `Service (POS): ${it.quantity}x ${it.name}` : it.type === 'membership' ? `Membership: ${it.name}` : it.type === 'package' ? `Package: ${it.name}` : it.type === 'rental' ? `Space rental: ${it.name}` : it.type === 'rent' ? `Booth rent: ${it.name}` : it.type === 'tuition' ? `Tuition: ${it.name}` : `Retail Product: ${it.quantity}x ${it.name}`;
    txn({ description, type: 'income', context: 'Business', category, ...(it.type === 'giftcard' ? { taxBucket: 'transfer' } : {}), amount: value, paymentMethod: method, hasReceipt: true, itemId: it.id, itemType: it.type, quantity: it.quantity, ...(it.type === 'product' && soldBy ? { staffId: soldBy, soldBy } : {}), ...((it.type === 'membership' || it.type === 'package') && soldBy ? { soldBy } : {}) });
    if (it.type === 'product') {
      // The batches move too (soonest-expiring first, lib/retail-orders), so lots and expiry stay true for in-store sales.
      let batchPatch: any = {};
      try { const inv: any = (await db.doc(`${T}/inventory/${it.id}`).get()).data(); if (Array.isArray(inv?.batches) && inv.batches.length) batchPatch = { batches: JSON.parse(JSON.stringify(depleteBatchesFIFO(inv.batches, it.quantity).batches)) }; } catch { /* the total still moves */ }
      batch.set(db.doc(`${T}/inventory/${it.id}`), { totalStock: FieldValue.increment(-it.quantity), ...batchPatch }, { merge: true });
      const sc = db.collection(`${T}/stockCorrections`).doc();
      batch.set(sc, clean({ productId: it.id, date: now, change: -it.quantity, unit: 'units', reason: `Retail Sale: ${it.name} for ${client.name || 'Guest'}`, actorId: auth.actor.uid || 'staff', actorName: auth.actor.name || 'Staff', source: 'stock_ledger', type: 'sold', field: 'totalStock', balanceAfter: Math.max(0, num(it.stock) - it.quantity), refKind: 'checkout', refId: checkoutSessionId }));
    }
    if (it.type === 'membership' || it.type === 'package') toEnroll.push({ offeringType: it.type, offeringId: it.id });
    if (it.type === 'rent' && it.__acct) rentPayments.push(applyRentPayment(batch, db, T, it.__acct, { amountCents: Math.round(value * 100), method: String(method), receiptId: receiptRef.id, transactionId: checkoutSessionId, now, by: auth.actor.name || 'Front desk' }));   // the renter's rent ledger, oldest charges first
    if (it.type === 'rental' && it.reservationId) batch.set(db.doc(`${T}/boothReservations/${it.reservationId}`), { paymentStatus: 'paid', paidAt: now, paidVia: 'pos' }, { merge: true });
    add(value);
  }
  if (fees.length) {
    const settled = fees.reduce((s: number, f: any) => s + num(f.feeAmount), 0);
    const ids = new Set(fees.map((f: any) => f.feeId));
    for (const ownerId of new Set(fees.map((f: any) => f.__owner))) {
      const owner: any = people[ownerId]; const theirs = fees.filter((f: any) => f.__owner === ownerId).reduce((s: number, f: any) => s + num(f.feeAmount), 0);
      batch.set(db.doc(`${T}/clients/${ownerId}`), { unpaidFees: (owner.unpaidFees || []).filter((f: any) => !ids.has(f.feeId)), outstandingBalance: FieldValue.increment(-theirs) }, { merge: true });
    }
    if (method === 'cash') totalCashIncrease += settled;
    for (const f of fees) txn({ feeId: f.feeId, feeReason: f.reason || null, clientId: f.__owner, clientOrVendor: people[f.__owner]?.name || 'Client', description: `Debt Settlement: ${f.reason || 'fee'}`, type: 'income', context: 'Business', category: 'Fee Recovery', taxBucket: 'adjustment', amount: num(f.feeAmount), paymentMethod: method, hasReceipt: false });
    totalLtvIncrease += settled;
  }
  // Client: lifetime value, last visit, package session / membership perk used.
  const visitSpend = Object.values(spend).reduce((s, x) => s + x, 0);
  credit(clientId, Math.max(0, totalLtvIncrease - visitSpend - calc.discount - calc.memberDiscount - recoveryAmount));   // the rest (products, fees, card fee), less discounts
  for (const [cid, amt] of Object.entries(spend)) if (cid !== clientId) batch.set(db.doc(`${T}/clients/${cid}`), { lifetimeValue: FieldValue.increment(Math.max(0, amt)), lastAppointment: now }, { merge: true });
  const payerHadVisit = !visits.length || visits.some((v) => whoHad(v).id === clientId);   // someone who only paid didn't visit
  const clientUpd: any = { lifetimeValue: FieldValue.increment(Math.max(0, spend[clientId] || 0)), ...(payerHadVisit ? { lastAppointment: now } : {}) };
  // This month's team / family discount use (for the monthly cap).
  const gMonth = monthKey(new Date(now));
  if (calc.momentDiscount > 0 && calc.moment) clientUpd[`momentRewards.${calc.moment.key}`] = now;   // a birthday treat once a year; a milestone once
  if (calc.groupDiscount > 0) clientUpd.teamDiscountUsage = client.teamDiscountUsage?.month === gMonth ? { month: gMonth, amount: FieldValue.increment(calc.groupDiscount) } : { month: gMonth, amount: calc.groupDiscount };
  // A package session / membership perk comes off the account of whoever used it.
  const usedBy: any = redeemedOffer ? (visits.map((v) => ({ v, has: [v.service?.id, ...(v.addOnServices || []).map((x: any) => x.id)].includes(redeemedOffer.itemId) })).find((x) => x.has) ? whoHad(visits.find((v) => [v.service?.id, ...(v.addOnServices || []).map((x: any) => x.id)].includes(redeemedOffer.itemId))) : client) : client;
  // Each redemption is also copied into the business's redemption log, which the membership ledger watches live.
  const logRedemption = (ref: any, data: any) => { batch.set(ref, data); batch.set(db.doc(`${T}/redemptionLog/${ref.id}`), { ...data, at: data.redeemedAt || data.date || now, clientPath: ref.path }); };
  if (redeemedOffer && usedBy.id !== clientId) {
    const rr = db.collection(`${T}/clients/${usedBy.id}/redemptions`).doc();
    const offeringName = redeemedOffer.type === 'membership' ? memberships.find((m: any) => m.id === redeemedOffer.id)?.name : packages.find((p: any) => p.id === redeemedOffer.id)?.name;
    logRedemption(rr, clean({ id: rr.id, clientId: usedBy.id, paidBy: clientId, type: redeemedOffer.type, offeringId: redeemedOffer.id, offeringName: offeringName || 'Offer', serviceId: redeemedOffer.itemId, redeemedAt: now, checkoutSessionId, appointmentId: apptIds[0] || null }));
    batch.set(db.doc(`${T}/clients/${usedBy.id}`), redeemedOffer.type === 'package'
      ? { activePackages: (usedBy.activePackages || []).map((p: any) => (p.packageId === redeemedOffer.id ? { ...p, sessionsRemaining: num(p.sessionsRemaining) - 1 } : p)).filter((p: any) => num(p.sessionsRemaining) > 0) }
      : { subscription: { perkUsage: { [String(redeemedOffer.itemId)]: FieldValue.increment(1) }, perkLastUsed: now } }, { merge: true });
  }
  if (redeemedOffer && usedBy.id === clientId) {
    const rr = db.collection(`${T}/clients/${clientId}/redemptions`).doc();
    const offeringName = redeemedOffer.type === 'membership' ? memberships.find((m: any) => m.id === redeemedOffer.id)?.name : packages.find((p: any) => p.id === redeemedOffer.id)?.name;
    logRedemption(rr, clean({ id: rr.id, clientId, type: redeemedOffer.type, offeringId: redeemedOffer.id, offeringName: offeringName || 'Offer', serviceId: redeemedOffer.itemId, serviceName: svc(String(redeemedOffer.itemId))?.name || null, redeemedAt: now, checkoutSessionId, appointmentId: apptIds[0] || null }));
    if (redeemedOffer.type === 'package') clientUpd.activePackages = (client.activePackages || []).map((p: any) => (p.packageId === redeemedOffer.id ? { ...p, sessionsRemaining: num(p.sessionsRemaining) - 1 } : p)).filter((p: any) => num(p.sessionsRemaining) > 0);
    else { clientUpd[`subscription.perkUsage.${redeemedOffer.itemId}`] = FieldValue.increment(1); clientUpd['subscription.perkLastUsed'] = now; }
  }
  batch.update(db.doc(`${T}/clients/${clientId}`), clientUpd);
  // Tips, by who they're for (unallocated → the main provider, else the cashier).
  // Tips, by who they're for — checked here: only people who worked on the visit (or the school) get a share, it adds
  // up to the tip exactly, and anything unassigned goes to the main provider. A student whose program keeps tips is
  // paid to the school whatever the screen sent. Tips added on split-bill shares follow the same split.
  const { checkTipSplit, splitTip, SCHOOL } = await import('@/lib/tip-split');
  const mainTip = visits[0] ? calc.visits[0].mainStaffId : (auth.actor.uid || 'unassigned');
  const tipKey = (sid: string) => { const st: any = staff.find((x: any) => x.id === sid); return st?.isStudent && ['school', 'none'].includes(String(st.tipPolicy || 'school')) ? SCHOOL : sid; };
  const allowedTip = [...new Set<string>([...calc.visits.flatMap((v: any) => [v.mainStaffId, ...v.addOns.map((x: any) => x.staffId)]), ...visits.map((v: any) => v.appointment.staffId)].filter(Boolean) as string[])];
  const asked = Object.fromEntries(Object.entries(tipAllocations || {}).map(([k, v]) => [k === SCHOOL ? k : tipKey(k), v]));
  const alloc: Record<string, number> = tip > 0 ? checkTipSplit(tip, asked, allowedTip.map(tipKey), tipKey(mainTip)) : {};
  if (split && splitTips > 0) {
    const extra = Object.keys(alloc).length ? splitTip(splitTips, Object.entries(alloc).map(([id, a]) => ({ id, name: id, weight: Number(a) })), 'value') : { [tipKey(mainTip)]: splitTips };
    for (const [k, v] of Object.entries(extra)) alloc[k] = Math.round((num(alloc[k]) + num(v)) * 100) / 100;
  }
  for (const [sid, amount] of Object.entries(alloc)) { const amt = num(amount); if (amt <= 0) continue;
    const rt = renterOf(sid); if (rt) deskCollected.push({ renterId: String(rt.renterId || ''), staffId: sid, cents: Math.round(amt * 100), kind: 'tip', appointmentId: apptIds[0] || null });
    txn({ description: sid === '__school' ? 'Gratuity — school (student salon)' : 'Gratuity', type: 'income', context: 'Business', category: rt ? 'Tips collected for renter' : 'Tips', taxBucket: rt ? 'pass_through' : 'gratuity', ...(rt ? { renterId: rt.renterId || null, renterStaffId: sid } : {}), amount: amt, paymentMethod: method, staffId: sid, hasReceipt: true });
    if (method === 'cash') { cashTipsTotal += amt; cashTipsByStaff[sid] = FieldValue.increment(amt); cashTipsPlain[sid] = (cashTipsPlain[sid] || 0) + amt; } }
  // Bonus cards (an offer) paid part of this bill: nobody paid for that money, so it's a discount in the books.
  { const promoCents = giftUse.filter((g) => promoCards.has(g.id)).reduce((a, g) => a + g.cents, 0);
    if (promoCents > 0) txn({ description: `Gift card bonus used — ${giftUse.filter((g) => promoCards.has(g.id)).map((g) => g.code).join(', ')}`, clientOrVendor: 'Internal', type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: promoCents / 100, paymentMethod: 'Internal', hasReceipt: false, discountKind: 'gift_offer' }); }
  if (calc.codeDiscount > 0) txn({ description: 'Promotion Applied', clientOrVendor: 'Internal', type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: calc.codeDiscount, paymentMethod: 'Internal', hasReceipt: false });
  if (calc.momentDiscount > 0 && calc.moment) txn({ description: `${calc.moment.label} — ${client.name || 'client'}`, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: calc.momentDiscount, paymentMethod: 'Internal', hasReceipt: false, discountKind: 'moment', momentKey: calc.moment.key });
  if (calc.groupDiscount > 0 && calc.group) txn({ description: `${calc.group.label} — ${client.name || 'client'}`, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: calc.groupDiscount, paymentMethod: 'Internal', hasReceipt: false, discountKind: calc.group.type === 'team' ? 'team' : 'family', linkedStaffId: calc.group.staffId || null });
  if (calc.staffDiscount > 0) txn({ description: `Staff discount — ${staffDiscountReason}${staffDiscountApprovedBy ? ` · approved by ${staffDiscountApprovedBy}` : ''}`, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: calc.staffDiscount, paymentMethod: 'Internal', hasReceipt: false, notes: staffDiscountReason, discountKind: 'staff', givenBy: auth.actor.name, ...(staffDiscountApprovedBy ? { approvedBy: staffDiscountApprovedBy } : {}) });
  if (recoveryAmount > 0) txn({ description: `Service Recovery: ${recoveryReason}`, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: recoveryAmount, notes: recoveryReason, paymentMethod: 'Internal', hasReceipt: false, ...(recoveryApprovedBy ? { approvedBy: recoveryApprovedBy } : {}) });
  if (calc.tax > 0) txn({ description: calc.taxLabel, type: 'income', context: 'Business', category: 'Tax Collected', taxBucket: 'tax_collected', amount: calc.tax, paymentMethod: method, hasReceipt: false });
  if (cardSurcharge > 0) { txn({ description: 'Card Processing Fee (passed to client)', type: 'income', context: 'Business', category: 'Card Processing Fee', taxBucket: 'revenue', amount: cardSurcharge, paymentMethod: method, hasReceipt: false }); totalLtvIncrease += cardSurcharge; }
  let cashDepositOffset = 0;
  // What the deposits pay of this bill (never more than it comes to), each from what's left on it, in one step with
  // the sale: what's left over stays on the deposit for the rest of the visit or a refund.
  const depositsUsed: { id: string; cents: number }[] = [];
  if (depositsUsing.length && depositCreditDollars > 0) {
    let need = Math.round(Math.min(depositCreditDollars, calc.total) * 100);
    for (const d of depositsUsing) {
      if (need <= 0) break;
      const use = Math.min(d.left, need); if (use <= 0) continue; need -= use;
      const usedAfter = Math.max(0, Math.round(Number(d.data.usedCents) || 0)) + use;
      const allUsed = use >= d.left;
      txn({ depositCreditId: d.id, description: 'Deposit applied (prepaid)', type: 'expense', context: 'Business', category: 'Deposit Applied', taxBucket: 'adjustment', amount: use / 100, paymentMethod: 'Deposit', hasReceipt: false, ...(d.data.sourceAppointmentId ? { appointmentId: d.data.sourceAppointmentId } : {}) });
      const patch = { usedCents: usedAfter, status: allUsed ? 'consumed' : 'available', ...(allUsed ? { consumedAt: now } : {}), lastUsedAt: now, appointmentId: d.data.sourceAppointmentId || apptIds[0] || null };
      if (d.updateTime) batch.update(d.ref, patch, { lastUpdateTime: d.updateTime }); else batch.set(d.ref, patch, { merge: true });
      depositsUsed.push({ id: d.id, cents: use });
    }
    cashDepositOffset = Math.min(depositsUsed.reduce((t, x) => t + x.cents, 0) / 100, totalCashIncrease);
  }
  // Cash into the till = what the client actually handed over: the sale total (tax included; discounts and recovery
  // taken off) less any deposit they'd already paid. (The old way added up line prices — tax was missed and
  // discounts ignored, so the till's expected cash drifted.) Split into sales and tips.
  if (split) {   // tips added on CASH shares are cash tips in the till (credited to the main provider)
    const cashTip = split.filter((x) => x.method === 'cash').reduce((t, x) => t + num(x.tip), 0);
    if (cashTip > 0) { cashTipsTotal += cashTip;   // the till pays cash tips out by the same split
      const shares = Object.keys(alloc).length ? splitTip(cashTip, Object.entries(alloc).map(([id, a]) => ({ id, name: id, weight: Number(a) })), 'value') : { [tipKey(mainTip)]: cashTip };
      for (const [k, v] of Object.entries(shares)) { cashTipsByStaff[k] = FieldValue.increment(num(v)); cashTipsPlain[k] = (cashTipsPlain[k] || 0) + num(v); } }
  }
  const depositUsed = depositsUsed.reduce((t, x) => t + x.cents, 0) / 100;
  const cashIn = method === 'cash' ? Math.max(0, Math.round((calc.total - depositUsed) * 100) / 100) : split ? Math.round(splitCash * 100) / 100 : 0;
  let splitOver = 0;
  if (split) {   // the shares must cover what's owed (and more than that is flagged, never recorded quietly)
    const paid = split.reduce((s, x) => s + num(x.amount) + num(x.tip), 0); const owed = Math.max(0, Math.round((calc.total - depositUsed) * 100) / 100);
    if (paid + 0.01 < owed) return json({ ok: false, error: `Still $${(owed - paid).toFixed(2)} to pay on this bill.`, owed, paid }, 409);
    if (paid > owed + 0.01) splitOver = Math.round((paid - owed) * 100) / 100;
  }
  const cashSalesAmt = Math.max(0, Math.round((cashIn - cashTipsTotal) * 100) / 100);
  void cashDepositOffset;
  if ((method === 'cash' || (split && cashIn > 0)) && b.tillId) batch.set(db.doc(`${T}/tillSessions/${String(b.tillId)}`), { expectedCash: FieldValue.increment(cashIn), totalCashSales: FieldValue.increment(cashSalesAmt), totalCashTips: FieldValue.increment(cashTipsTotal), ...(Object.keys(cashTipsByStaff).length ? { cashTipsByStaff } : {}) }, { merge: true });   // nested, so each provider's cash tips really add up
  // Gift cards that paid for a renter's visit: a card the renter sold → they already have that money, so it isn't owed
  // to them; a studio card → the studio owes them, credited against their next rent (taken off by the nightly run).
  { const owned: Record<string, number> = {}, salon: Record<string, number> = {};
    for (const g of giftUse) for (const [rid, c] of Object.entries(g.forRenters || {})) { if (g.owner) owned[rid] = (owned[rid] || 0) + c; else salon[rid] = (salon[rid] || 0) + c; }
    for (const rid of new Set([...Object.keys(owned), ...Object.keys(salon)])) { let cut = (owned[rid] || 0) + (salon[rid] || 0);
      for (const d of deskCollected) { if (d.renterId !== rid || d.kind !== 'service' || cut <= 0) continue; const t = Math.min(cut, d.cents); d.cents -= t; cut -= t; } }
    for (const [rid, c] of Object.entries(salon)) { if (c <= 0) continue; const ref = db.collection(`${T}/rentLedger`).doc();
      batch.set(ref, clean({ id: ref.id, renterId: rid, type: 'gift_card_credit', status: 'paid', amountCents: -c, appliedCents: 0, receiptId: receiptRef.id, giftCardIds: giftUse.filter((g) => !g.owner && g.forRenters?.[rid]).map((g) => g.id),
        note: `Paid with a studio gift card at the front desk — $${(c / 100).toFixed(2)} credited to your rent`, date: now, createdAt: now, createdBy: auth.actor.name || null })); } }
  // What the desk collected for renters → their Books, owed to them until the owner settles it (never auto-netted).
  for (const d of deskCollected) { if (!d.renterId || d.cents <= 0) continue; const ref = db.collection(`${T}/rentLedger`).doc();
    batch.set(ref, clean({ id: ref.id, renterId: d.renterId, staffId: d.staffId, type: 'desk_collected', kind: d.kind, amountCents: d.cents, status: 'owed', appointmentId: d.appointmentId, receiptId: receiptRef.id,
      note: d.kind === 'tip' ? 'Tip collected at the front desk' : `Collected at the front desk — ${d.serviceName || 'service'} for ${d.clientName || 'a client'}`, date: now, createdAt: now, collectedBy: auth.actor.name || null })); }
  // The receipt.
  const tendered = num(pay.amountTendered);
  // THE FULL RECEIPT — every line with who did it, each fee by reason, every adjustment in plain words, deposit and
  // credit applied, the card fee, each payment, and each provider's share of the tip. (Card used and what's left on a
  // rent / tuition account are added just after the sale is saved.)
  const nameOf = (id: any) => (id ? staff.find((s: any) => s.id === id)?.name || null : null);
  const plainReason = (r: any) => String(r || 'Fee').replace(/\s*[—–-]\s*(auto-charge failed|card declined|no card on file|payments not connected).*$/i, '');
  const detail: any = { number: receiptRef.id.slice(-6).toUpperCase(), lines: [] as any[], fees: [] as any[], tipShares: [] as any[], payments: [] as any[] };
  visits.forEach((v: any, idx: number) => {
    const vc: any = calc.visits[idx]; const a = v.appointment; const who = whoHad(v); const forWho = who.id !== clientId ? (who.name || null) : null;
    const collectedFor = vc.renter ? nameOf(vc.renterStaffId) : null;
    detail.lines.push({ kind: 'service', label: vc.renter && a.renterServiceName ? a.renterServiceName : v.service?.name || 'Service', amount: vc.mainPrice, staff: nameOf(vc.mainStaffId),
      bookedWith: a.staffId && vc.mainStaffId !== a.staffId ? nameOf(a.staffId) : null, for: forWho, collectedFor, redeemed: vc.mainRedeemed || null });
    for (const x of vc.addOns) detail.lines.push({ kind: 'addon', label: x.addon?.name || 'Add-on', amount: x.price, staff: nameOf(x.staffId), for: forWho, collectedFor, redeemed: x.redeemed || null });
    const adj: [number, string][] = [[vc.rescheduleFee, 'Reschedule fee'], [vc.dayChangeFee, 'On-the-day change fee'], [vc.timeOverage, a.checkoutState?.extraTimeMinutes ? `Extra time — ${a.checkoutState.extraTimeMinutes} min` : 'Extra time'], [vc.materialOverage, a.checkoutState?.extraProductNote ? `Extra product — ${String(a.checkoutState.extraProductNote).slice(0, 80)}` : 'Extra product'], [vc.additionalCharge, 'Additional charge']];
    for (const [amt, label] of adj) if (num(amt) > 0) detail.lines.push({ kind: 'adjustment', label, amount: num(amt), for: forWho });
    if (vc.waived) detail.lines.push({ kind: 'note', label: 'Fees on this visit were waived', amount: 0, for: forWho });
    for (const r of vc.refreshments || []) detail.lines.push({ kind: 'refreshment', label: r.name, qty: r.qty, unit: r.price, amount: r.price * r.qty, for: forWho });
  });
  for (const it of items as any[]) detail.lines.push({ kind: it.type || 'product', label: it.name, qty: num(it.quantity), unit: num(it.price), amount: num(it.price) * num(it.quantity), soldBy: it.type === 'product' ? nameOf(soldBy) : null });
  for (const f of fees as any[]) detail.fees.push({ label: plainReason(f.reason), amount: num(f.feeAmount), date: f.appointmentDate || null, for: f.__owner && f.__owner !== clientId ? (people[f.__owner]?.name || null) : null });
  for (const [sid, amt] of Object.entries(alloc)) if (num(amt) > 0) detail.tipShares.push({ name: sid === '__school' ? 'The school' : nameOf(sid) || 'The team', amount: num(amt) });
  detail.payments = split ? split.map((x: any) => ({ method: x.method, amount: num(x.amount), tip: num(x.tip), payer: x.payerName || null, label: x.label || null, pi: x.stripePaymentIntentId || null }))
    : [{ method, amount: Math.max(0, Math.round((calc.total - depositUsed) * 100) / 100), pi: pay.stripePaymentIntentId || null }];
  if (giftUse.length) { detail.giftCards = giftUse.map((g) => ({ code: g.code, amount: g.cents / 100 })); detail.payments.unshift(...giftUse.map((g) => ({ method: 'gift_card', amount: g.cents / 100, label: `Gift card ${g.code}` }))); }
  detail.depositUsed = depositUsed; detail.storeCredit = num((calc as any).storeCredit ?? b.storeCredit); detail.cardSurcharge = cardSurcharge;
  const viewKey = `${rid()}${rid()}`;
  // Paid with the ticket's payment: what the card was charged should be what this sale comes to. If the sale changed
  // after the payment (an item or a tip added), it's still recorded, and the difference is flagged to settle.
  const cardDueCents = Math.round((calc.total - depositUsed + cardSurcharge) * 100);
  const chargedCents = ticketPaid && ticketPaid.cents > 0 ? ticketPaid.cents : verified ? verified.cents : 0;   // whichever way the card was taken
  const paidDiffers = chargedCents > 0 && Math.abs(chargedCents - cardDueCents) > 1 ? { paidCents: chargedCents, dueCents: cardDueCents } : null;
  const reviewNotes = [mismatch ? `The screen showed $${expected.toFixed(2)}; recorded $${calc.total.toFixed(2)}.` : '', paidDiffers ? `The card was charged $${(paidDiffers.paidCents / 100).toFixed(2)}; the sale comes to $${(paidDiffers.dueCents / 100).toFixed(2)}.` : '',
    splitOver > 0 ? `The split was paid $${splitOver.toFixed(2)} more than the sale comes to.` : ''].filter(Boolean);
  // Every card payment on it — the sale's own, or each card share of a split — so a payment is never used for a second
  // sale, kept apart as extra, or refunded as extra once it's on this receipt (lib/reader-sale onAnyReceipt).
  const paymentIntentIds = [...new Set([pay.stripePaymentIntentId, ...(split || []).map((x: any) => x?.stripePaymentIntentId)].filter(Boolean).map(String))];
  batch.create(receiptRef, clean({ id: receiptRef.id, pendingId: pendingRef ? pendingRef.id : null, ...(askedId && (!pendingRef || pendingRef.id !== askedId) ? { askedPendingId: askedId } : {}), ...(paymentIntentIds.length ? { paymentIntentIds } : {}), ...(splitOver > 0 ? { overpaid: splitOver } : {}), detail, tillId: b.tillId ? String(b.tillId) : null, viewKey, checkoutSessionId, clientId, clientName: client.name || 'Guest', tenantId, date: now, paymentMethod: method, amountTendered: tendered, change: Math.max(0, tendered - calc.total),
    paidBy: client.name || 'Guest', people: Object.values(people).map((p: any) => p.name).filter(Boolean),
    // Everything a void needs to undo this sale exactly.
    ...(split ? { payments: split.map((x) => ({ method: x.method, amount: num(x.amount), tip: num(x.tip), payerName: x.payerName || null, label: x.label || null, stripePaymentIntentId: x.stripePaymentIntentId || null, via: x.via || null })) } : {}),
    reversal: { ...(rentPayments.length ? { rentPayments } : {}), ...(split ? { payments: split.map((x) => ({ method: x.method, amount: num(x.amount) + num(x.tip), stripePaymentIntentId: x.stripePaymentIntentId || null })) } : {}), method, tillId: (method === 'cash' || (split && cashIn > 0)) ? (b.tillId || null) : null, cashIn, cashSales: cashSalesAmt, cashTips: method === 'cash' ? cashTipsTotal : 0, cashTipsByStaff: cashTipsPlain,
      spend, products: items.filter((x) => x.type === 'product').map((x) => ({ id: x.id, name: x.name, quantity: x.quantity })),
      fees: fees.map((f: any) => ({ feeId: f.feeId, feeAmount: num(f.feeAmount), reason: f.reason || null, owner: f.__owner, fee: (({ __owner, ...rest }) => rest)(f) })),
      depositCreditId: depositsUsed[0]?.id || null, ...(depositsUsed.length ? { depositsUsed } : {}),
      redeemed: redeemedOffer ? { ...redeemedOffer, clientId: usedBy.id } : null,
      discountIds: (discounts as any[]).map((d) => d.id), groupDiscount: calc.groupDiscount > 0 ? { amount: calc.groupDiscount, month: gMonth, clientId } : null, momentKey: calc.momentDiscount > 0 && calc.moment ? calc.moment.key : null, memberships: items.filter((x) => x.type === 'membership' || x.type === 'package').map((x) => ({ type: x.type, id: x.id, name: x.name })),
      visits: visits.map((v) => ({ id: v.appointment.id, statusBefore: v.appointment.status || 'checked_in', checkInToken: v.appointment.checkInToken || null, clientId: v.appointment.clientId || clientId })),
      giftCardsUsed: giftUse.map((g) => ({ id: g.id, cents: g.cents })),
      stripePaymentIntentId: pay.stripePaymentIntentId || null },
    // Each discount by name (and any the staff removed for this sale) — so the receipt explains the total.
    discounts: [...(calc.codeDiscount > 0 ? [{ kind: 'code', label: `Code ${(discounts as any[]).map((d) => d.code).filter(Boolean).join(', ')}`, amount: calc.codeDiscount }] : []),
      ...(calc.groupDiscount > 0 ? [{ kind: 'group', label: calc.group?.label || 'Team discount', amount: calc.groupDiscount }] : []),
      ...(calc.momentDiscount > 0 ? [{ kind: 'moment', label: calc.moment?.label || 'Thank-you treat', amount: calc.momentDiscount }] : []),
      ...(calc.memberDiscount > 0 ? [{ kind: 'member', label: calc.memberLabel || 'Member discount', amount: calc.memberDiscount }] : []),
      ...(calc.staffDiscount > 0 ? [{ kind: 'staff', label: `Staff discount${staffDiscountReason ? ` — ${staffDiscountReason}` : ''}`, amount: calc.staffDiscount }] : [])],
    discountsRemoved: [...(b.skipGroupDiscount === true ? ['group'] : []), ...(b.skipMomentReward === true ? ['moment'] : []), ...(b.skipMemberDiscount === true ? ['member'] : [])],
    subtotal: calc.subtotal, tax: calc.tax, taxLabel: calc.taxLabel, tip: calc.tip, discount: calc.discount + calc.memberDiscount, total: calc.total, cashierName: auth.actor.name || '', stripePaymentIntentId: pay.stripePaymentIntentId || null,
    ...(reviewNotes.length ? { needsReview: true, ...(mismatch ? { screenTotal: expected } : {}), ...(paidDiffers ? { paidDiffers } : {}), reviewNote: reviewNotes.join(' ') } : {}),
    lineItems: [...visits.flatMap((v, idx) => { const vc = calc.visits[idx]; const forWho = whoHad(v).id !== clientId ? firstName(whoHad(v).name) : undefined; return [{ label: v.service?.name || 'Service', amount: vc.mainPrice, type: 'service', staff: firstName(staff.find((s: any) => s.id === vc.mainStaffId)?.name), for: forWho },
      ...vc.addOns.map((x: any) => ({ label: `+ ${x.addon.name}`, amount: x.price, type: 'addon', staff: firstName(staff.find((s: any) => s.id === x.staffId)?.name) }))]; }),
      ...items.map((it) => ({ label: it.name, amount: it.price * it.quantity, type: it.type || 'retail' }))] }));
  // Discount codes used; campaign offers redeemed.
  for (const d of discounts as any[]) {
    batch.set(db.doc(`${T}/discounts/${d.id}`), { usageCount: FieldValue.increment(1), usedByClientIds: FieldValue.arrayUnion(clientId) }, { merge: true });
    const w = (await db.collection(`${T}/clientOffers`).where('clientId', '==', clientId).get()).docs.find((x: any) => String((x.data() as any).code || '').toUpperCase() === String(d.code || '').toUpperCase() && !['redeemed', 'expired', 'cancelled'].includes(String((x.data() as any).status || '')) && !(x.data() as any).ownerRenterId);
    if (w) { batch.set(w.ref, { status: 'redeemed', redeemedAt: now, appointmentId: apptIds[0] || null, saleTotal: calc.total }, { merge: true });
      const cid = (w.data() as any).campaignId; if (cid) batch.set(db.doc(`${T}/campaigns/${cid}`), { offersRedeemed: FieldValue.increment(1), offerRevenueCents: FieldValue.increment(Math.round(calc.total * 100)) }, { merge: true }); }
    for (const v of visits) if (v.appointment.pendingDiscountCode) batch.set(db.doc(`${T}/appointments/${v.appointment.id}`), { pendingDiscountCode: FieldValue.delete(), discountCodeUsed: String(d.code) }, { merge: true });
  }
  // Where this sale happened (cards across locations): the desk's location, else the visit's, else its provider's only one.
  const saleLocation: string | null = (typeof b.locationId === 'string' && b.locationId.slice(0, 80)) || visits[0]?.appointment?.locationId || homeLocation(staff.find((x: any) => x.id === visits[0]?.appointment?.staffId)) || null;
  // The loyalty reward's points come off now, checked against the ledger itself; put back if the checkout doesn't save.
  let loyaltyRedeemed = false;
  if (loyaltyRw && loyaltyRwCents > 0 && clientId) { const { redeemForSale } = await import('@/lib/loyalty-server');
    const r: any = await redeemForSale(db, tenantId, tenant, { clientId, saleId: checkoutSessionId, reward: loyaltyRw, cents: Math.min(loyaltyRwCents, Math.round(num((calc as any).loyaltyDiscount) * 100)) || loyaltyRwCents, by: auth.actor.name || 'Front desk' });
    if (!r.ok) { await failPending(r.error); return json({ ok: false, error: r.error }, 409); } loyaltyRedeemed = true; }
  const loyaltyUndo = async () => { if (loyaltyRedeemed) { const { reverseSale } = await import('@/lib/loyalty-server'); await reverseSale(db, tenantId, { saleId: checkoutSessionId, full: true, by: 'System' }).catch(() => {}); } };
  // Gift cards: take the money off each card now (each in its own safe step); put it all back if anything fails.
  const { spendGiftCard, adjustGiftCard } = await import('@/lib/gift-cards');
  const putBack = async () => { for (const g of giftUse.filter((x) => x.done)) await adjustGiftCard(db, tenantId, { id: g.id, kind: 'add', cents: g.cents, note: 'Checkout didn’t finish — put back', by: 'System' }).catch(() => {}); };
  for (const [gid, up] of Object.entries(giftTopUps)) if (giftUse.some((g) => g.id === gid)) await adjustGiftCard(db, tenantId, { id: gid, kind: 'add', cents: up, note: 'The service costs more now — the gift still covers it', by: 'Front desk' }).catch(() => {});
  for (const g of giftUse) { const r: any = await spendGiftCard(db, tenantId, { id: g.id, cents: g.cents, holdId: g.holdId, by: auth.actor.name || 'Front desk', transactionRef: checkoutSessionId, appointmentId: apptIds[0] || null, clientId: visits[0] ? whoHad(visits[0]).id : clientId, locationId: saleLocation });
    if (!r.ok) { await putBack(); await loyaltyUndo(); await failPending(r.error); return json({ ok: false, error: r.error }, 409); } g.done = true; }
  // The ticket is finished in the same all-or-nothing save as the sale, so it can never show as unrecorded once saved.
  if (pendingRef) {
    // Which card payments its receipt has: one that lands on the ticket afterwards is extra, never taken as recorded.
    const done = { status: 'completed', completedAt: now, receiptId: receiptRef.id, checkoutSessionId, total: calc.total, receiptPaymentIntentIds: paymentIntentIds, ...(pay.stripePaymentIntentId ? { paymentIntentId: String(pay.stripePaymentIntentId) } : {}) };
    // A split is finished only if its shares are as they were read: one added or taken off meanwhile stops the save.
    if (split && splitReadAt) batch.update(pendingRef, done, { lastUpdateTime: splitReadAt });
    else batch.set(pendingRef, done, { merge: true });
    // Made only once, here or by a discard (lib/reader-sale outcomeRef): a discard under way stops this save.
    batch.create(outcomeRef(db, tenantId, pendingRef.id), { kind: 'saved', receiptId: receiptRef.id, at: now, by: auth.actor.name || null });
  }
  try { await batch.commit(); if (giftUse.length) { const { notifyGiftUse } = await import('@/lib/gift-cards'); for (const g of giftUse) void notifyGiftUse(db, tenantId, g.id, g.cents, req.nextUrl.origin).catch(() => {}); } }
  catch (e: any) {
    await putBack(); await loyaltyUndo();
    // Another save of this same sale got there first (the receipt is made from the ticket): it's recorded once, by that
    // one. What this save took off gift cards and points is put back, and the ticket is left as the other save left it.
    if (pendingRef && isAlreadyExists(e)) {
      const wonSnap = await receiptRef.get().catch(() => null);
      if (wonSnap?.exists) { const won: any = wonSnap.data() || {}; return json({ ok: true, already: true, receiptId: receiptRef.id, total: won.total ?? null, warnings: [] }); }
      // A manager began discarding it first: nothing is recorded (the discard gives its money back).
      const o: any = await outcomeRef(db, tenantId, pendingRef.id).get().catch(() => null); const od: any = o?.exists ? (o.data() || {}) : null;
      if (od && od.kind !== 'saved') return json({ ok: false, code: 'sale_discarding', pendingId: pendingRef.id, error: 'A manager is discarding this sale, so it wasn’t saved. Nothing was recorded. Check Needs attention.' }, 409);
    }
    // A share was added to the split (or taken off) while it was being saved: nothing is recorded, so it's finished again
    // with the shares as they are now.
    if (pendingRef && split && isChangedMeanwhile(e)) return json({ ok: false, code: 'bill_changed', pendingId: pendingRef.id, error: 'A payment on this split changed while it was being saved, so nothing was recorded. Check the split, then finish again.' }, 409);
    // The client's deposit was used or changed by another sale at the same moment: nothing is recorded, so the sale is
    // finished again with the deposit as it is now.
    if (depositsUsed.length && isChangedMeanwhile(e)) { await failPending('The deposit changed while the sale was being saved'); return json({ ok: false, code: 'deposit_changed', ...(pendingRef ? { pendingId: pendingRef.id } : {}), error: 'The client’s deposit changed while this sale was being saved, so nothing was recorded. Finish the sale again.' }, 409); }
    console.error('[checkout] save failed', e); await failPending(String(e?.message || e)); return json({ ok: false, error: 'Checkout didn’t save — nothing was recorded. Please try again.' }, 500);
  }

  // After the sale is saved: enrol memberships / packages; confirm next-visit deposits.
  const warnings: string[] = [];
  if (heldShort.length) {
    warnings.push(`${heldShort.map((h) => h.name).join(', ')} came out of what was held for online orders${heldApprovedBy ? ` (approved by ${heldApprovedBy})` : ''}. An order may be short when it’s packed.`);
    await logAuditAdmin(db, tenantId, { action: 'checkout.held_stock_sold', targetType: 'client', targetId: clientId || '', summary: `Sold at the desk from units held for online orders: ${heldShort.map((h) => `${h.name} (${h.want} sold, ${h.free} free)`).join('; ')}${heldApprovedBy ? ` — approved by ${heldApprovedBy}` : ''}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
  }
  if (splitOver > 0) warnings.push(`The split was paid $${splitOver.toFixed(2)} more than the sale comes to. Give that back to whoever paid it; the receipt is flagged.`);
  // Its card payment, if it was kept apart as extra on its sale's ticket (it landed while that sale was being discarded,
  // say): it's on this receipt now, so it's off that list and never refunded or kept a second time.
  if (verified) { const forT = deskPaymentOf(verified.pi, tenantId)?.pendingId || (pendingRef ? pendingRef.id : '');
    if (forT) await clearExtraOnReceipt(db, tenantId, forT, verified.id).catch(() => {}); }
  // Loyalty extras given on this sale: recorded at no points, with what each cost (reward first, then these, as discounted).
  if (clientId && loyaltyGifts.length) { try { const { recordGift } = await import('@/lib/loyalty-server'); const all = Math.round(num((calc as any).loyaltyDiscount) * 100); let left = all - Math.min(all, loyaltyRw ? loyaltyRwCents : 0);
    for (const g of loyaltyGifts) { const c = Math.max(0, Math.min(g.cents, left)); left -= c; if (c > 0) await recordGift(db, tenantId, { kind: g.kind, clientId, saleId: checkoutSessionId, name: g.name, cents: c, costCents: Math.min(g.costCents, c), by: auth.actor.name || 'Front desk', surpriseId: g.surpriseId || null }); } } catch (e) { console.error('[checkout] loyalty gifts', e); } }
  // Loyalty (lib/loyalty): what this paid sale earns, once. Services and products only, on what was actually paid.
  if (clientId && (tenant as any)?.loyalty?.on === true) { try {
    const { earnForSale } = await import('@/lib/loyalty-server'); const c2: any = calc;
    const acct = (items || []).filter((it: any) => ['rent', 'tuition', 'giftcard'].includes(it.type)).reduce((t2: number, it: any) => t2 + num(it.price) * num(it.quantity), 0);
    const discountable = Math.max(0.01, num(c2.subtotal) - num(c2.renterSub) - acct); const paidShare = Math.max(0, 1 - (num(c2.discount) + num(c2.memberDiscount)) / discountable);
    const member = !!(client?.activeMembershipId || client?.subscription?.status === 'active');
    const svcLines = (c2.visits || []).filter((v: any) => !v.renter).flatMap((v: any, k: number) => [{ serviceId: visits[k]?.service?.id || null, cents: Math.round(num(v.mainPrice) * 100 * paidShare), member: member && num(v.mainPrice) === 0 }, ...(v.addOns || []).map((x: any) => ({ serviceId: x.addon?.id || null, cents: Math.round(num(x.price) * 100 * paidShare) }))]);
    const prodLines = (items || []).filter((it: any) => it.type === 'product').map((it: any) => ({ productId: String(it.id || ''), cents: Math.round(num(it.price) * num(it.quantity) * 100 * paidShare) }));
    const ahead = (await db.collection(`${T}/appointments`).where('clientId', '==', clientId).get()).docs.some((d: any) => { const x: any = d.data() || {}; return Date.parse(x.startTime) > Date.now() + 3600e3 && !['cancelled', 'canceled', 'no_show', 'declined'].includes(String(x.status || '')); });
    const tzq = String((tenant as any)?.timezone || 'America/New_York');
    const quiet = (visits || []).map((v: any) => { const st = Date.parse(v.appointment?.startTime || ''); if (!st) return null; const parts = new Intl.DateTimeFormat('en-US', { timeZone: tzq, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(st));
      const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.find((p2) => p2.type === 'weekday')?.value)); const h = Number(parts.find((p2) => p2.type === 'hour')?.value) % 24; const m = Number(parts.find((p2) => p2.type === 'minute')?.value);
      return wd >= 0 ? { day: wd, min: h * 60 + m, serviceId: v.service?.id || null } : null; }).filter(Boolean) as any[];
    await earnForSale(db, tenantId, tenant, { clientId, saleId: checkoutSessionId, by: auth.actor.name || 'Checkout', quiet, sale: { services: svcLines, products: prodLines, giftSpentCents: giftUse.reduce((t2, g) => t2 + g.cents, 0), giftBoughtCents: Math.round((items || []).filter((it: any) => it.type === 'giftcard').reduce((t2: number, it: any) => t2 + num(it.price) * num(it.quantity), 0) * 100), visits: (c2.visits || []).filter((v: any) => !v.renter).length, rebooked: ahead, renter: !(c2.visits || []).some((v: any) => !v.renter) && !prodLines.length } });
  } catch (e) { console.error('[checkout] loyalty', e); } }
  // The client's store credit, now that the sale is recorded (lib/store-credit).
  if (b.creditAtPayment === true && clientId && num((calc as any).storeCredit) > 0) {
    try { const { useCredit } = await import('@/lib/store-credit');
      const u = await useCredit(db, tenantId, clientId, num((calc as any).storeCredit), { appointmentId: visits[0]?.appointment?.id || null, checkoutSessionId, by: auth.actor.name || null });
      if (u.applied + 0.009 < num((calc as any).storeCredit)) warnings.push(`Only ${'$'}${u.applied.toFixed(2)} of store credit was left to use. Please check the balance with the client.`);
    } catch (e) { console.error('[checkout] store credit', e); warnings.push('The store credit couldn’t be marked as used. Please check the client’s balance.'); }
  }
  // Gift cards sold on this sale: made now, and sent (or set to send on the day chosen).
  const giftsIssued: { id: string; code: string; amount: number; sendVia: string; sent: boolean; path?: string; bonus?: boolean; when?: string }[] = [];
  for (const it of items.filter((x: any) => x.type === 'giftcard' && x.__gift)) {
    for (let q = 0; q < Math.max(1, num(it.quantity)); q++) {
      try { const { issueGiftCard, deliverGiftCard } = await import('@/lib/gift-cards'); const g = it.__gift;
        const r: any = await issueGiftCard(db, tenantId, { amountCents: g.cents, by: auth.actor.name || 'Front desk', source: 'desk', purchaser: { id: clientId, name: client.name || null }, recipient: { id: g.recipientId, name: g.recipientName, phone: g.recipientPhone, email: g.recipientEmail }, message: g.message, design: g.design, line: g.line, sendVia: g.sendVia, sendAt: g.sendAt, transactionId: checkoutSessionId, locationId: saleLocation, ...(g.service && (await db.doc(`tenants/${tenantId}/services/${g.service.id}`).get()).exists ? { service: g.service } : {}) });
        if (!r.ok) { warnings.push(`The gift card was paid for but not made: ${r.error} Make it from Money → Gift cards.`); continue; }
        let sent = false; if (['text', 'email'].includes(g.sendVia) && !g.sendAt) sent = (await deliverGiftCard(db, tenantId, tenant, r.card)).sent;
        if (['text', 'email'].includes(g.sendVia) && !g.sendAt && !sent) warnings.push(`Gift card ${r.card.code} was made, but it didn’t send — give them the code or resend it from Money → Gift cards.`);
        giftsIssued.push({ id: r.card.id, code: r.card.code, amount: g.cents / 100, sendVia: g.sendVia, sent, path: (await import('@/lib/gift-cards')).giftPath(tenantId, r.card.id) } as any);
        // An offer is on at the desk ("buy $100, get $20 for you"): the buyer's own bonus card (lib/gift-offers).
        if (!g.service) { const { giveBonus, giftPath } = await import('@/lib/gift-cards');
          const bonus: any = await giveBonus(db, tenantId, tenant, { channel: 'desk', forCard: r.card, buyer: { id: clientId || null, name: client.name || null, email: client.email || null, phone: client.phone || null }, by: auth.actor.name || 'Front desk' }).catch(() => null);
          if (bonus) giftsIssued.push({ id: bonus.id, code: bonus.code, amount: bonus.initialCents / 100, sendVia: bonus.sendVia, sent: !!bonus.recipientEmail || !!bonus.recipientPhone, path: giftPath(tenantId, bonus.id), bonus: true, when: (await import('@/lib/gift-offers')).bonusWhen(bonus) } as any); }
      } catch (e: any) { console.error('[checkout] gift card', e); warnings.push('A gift card was paid for but not made — make it from Money → Gift cards.'); }
    }
  }
  if (giftsIssued.length) await receiptRef.set({ giftCardsSold: giftsIssued.map((g) => ({ id: g.id, code: g.code, amount: g.amount })), reversal: { giftCardsSold: giftsIssued.map((g) => g.id) } }, { merge: true }).catch(() => {});
  // Tuition: the Academy's audited, add-only ledger (it writes on its own, so it follows the saved sale).
  const tuitionPayments: any[] = [];
  for (const it of items.filter((x: any) => x.type === 'tuition' && x.__tacct)) {
    try { tuitionPayments.push(await applyTuitionPayment(db, tenantId, it.__tacct, { amountCents: Math.round(it.price * it.quantity * 100), method: String(method), receiptId: receiptRef.id, by: auth.actor.name || 'Front desk', apply: it.__tacct.__apply })); }
    catch (e: any) { console.error('[checkout] tuition ledger', e); warnings.push(`The payment was taken, but ${it.__tacct.name}’s tuition ledger didn’t update — record it on their Academy account.`); }
  }
  if (tuitionPayments.length) await receiptRef.set({ reversal: { tuitionPayments } }, { merge: true }).catch(() => {});
  const origin = req.nextUrl.origin; const authz = req.headers.get('authorization') || '';
  for (const o of toEnroll) {
    try { const r = await fetch(`${origin}/api/memberships/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId, offeringType: o.offeringType, offeringId: o.offeringId, paymentMethod: 'already_charged', existingPaymentIntentId: pay.stripePaymentIntentId || null, source: 'pos_checkout', skipLedger: true }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r?.ok) warnings.push(`${o.offeringType === 'membership' ? 'The membership' : 'The package'} was sold but not activated — please check the client’s profile.`); } catch { warnings.push('An enrolment didn’t go through — please check the client’s profile.'); }
  }
  for (const it of items.filter((x) => x.type === 'deposit' && x.depositForAppointmentId)) {
    try { const r = await fetch(`${origin}/api/appointments/desk-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authz }, body: JSON.stringify({ action: 'settled', tenantId, appointmentId: it.depositForAppointmentId, amountCents: Math.round(it.price * 100), receiptId: receiptRef.id, paidMethod: String(method) }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r?.ok) warnings.push(`The deposit for ${it.name} was paid — confirm that booking from the planner.`); } catch { warnings.push(`The deposit for ${it.name} was paid — confirm that booking from the planner.`); }
  }
  await logAuditAdmin(db, tenantId, { action: 'checkout.completed', targetType: 'client', targetId: clientId, amount: calc.total,
    summary: `Checkout — ${client.name || 'client'} · $${calc.total.toFixed(2)} (${method})${mismatch ? ` · the screen showed $${expected.toFixed(2)} — flagged for review` : ''}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
  for (const v of visits) await syncVisitCopies(db, tenantId, { ...v.appointment, status: 'completed', stage: 'complete', timeline: [...(Array.isArray(v.appointment.timeline) ? v.appointment.timeline : []), { at: now, kind: 'stage', stage: 'complete', text: 'Paid' }] }, tenant).catch(() => {});
  // Products the services used come off stock (once per visit) — never blocks the sale; a problem becomes a warning.
  for (const v of visits) { try { const { expectedUsage, recordVisitUsage } = await import('@/lib/usage');
      const r: any = await recordVisitUsage(db, tenantId, v.appointment, expectedUsage(v.service, v.addOnServices || [], inventory), { id: (auth as any)?.actor?.uid, name: (auth as any)?.actor?.name });
      if (r?.lines?.some((l: any) => l.shortfall)) warnings.push(`${v.appointment.clientName || 'A visit'} used more of ${r.lines.filter((l: any) => l.shortfall).map((l: any) => l.name).join(', ')} than your stock shows — check the shelf.`);
    } catch (e: any) { console.error('[checkout] usage', e?.message); } }
  // WHAT THIS SALE DID — so the finished screen says the right thing for each kind of sale (a visit, rent, tuition,
  // a booth day, a membership…) and only offers "book their next visit" where there was a visit.
  const outcomes: any[] = [];
  if (visits.length) outcomes.push({ kind: 'visit', serviceId: visits[0].service?.id || null, renter: calc.visits.some((v: any) => v.renter) });
  let rentIdx = 0;
  for (const it of items as any[]) {
    if (it.type === 'rent' && it.__acct) { const r: any = rentPayments[rentIdx++] || {}; const paid = Math.round(num(it.price) * 100); const acct = it.__acct;
      const owedBefore = acct.usesInvoices ? num(acct.invoiceOwedCents) : num(acct.owedCents);
      outcomes.push({ kind: 'rent', renterId: acct.renter?.id || null, name: acct.name, paidCents: paid, owedAfterCents: Math.max(0, owedBefore - paid), creditCents: num(r.creditCents) }); }
    else if (it.type === 'tuition' && it.__tacct) outcomes.push({ kind: 'tuition', planId: it.__tacct.plan?.id || null, apply: it.__tacct.__apply, name: it.__tacct.name, program: it.__tacct.program || null, paidCents: Math.round(num(it.price) * 100), remainingCents: Math.max(0, num(it.__tacct.balanceCents) - Math.round(num(it.price) * 100)) });
    else if (it.type === 'membership' || it.type === 'package') outcomes.push({ kind: it.type, name: it.name });
    else if (it.type === 'rental' && it.reservationId) outcomes.push({ kind: 'booth', name: it.name, reservationId: it.reservationId });
    else if (it.type === 'product') { if (!outcomes.some((o) => o.kind === 'retail')) outcomes.push({ kind: 'retail' }); }
  }
  // Extra time / extra product added at the desk: a charge record each, with the consent it rests on.
  try { const { recordCharge } = await import('@/lib/charge-records');
    for (const [idx, v] of (visits as any[]).entries()) { const vc: any = calc.visits[idx]; const a = v.appointment || {}; if (vc?.waived) continue; const who = String(a.clientId || clientId);
      if (num(vc?.timeOverage) > 0) await recordCharge(db, tenantId, { kind: 'extra_time', clientId: who, cents: Math.round(num(vc.timeOverage) * 100), reason: `Extra time — ${a.checkoutState?.extraTimeMinutes || '?'} min${a.checkoutState?.extraTimeReason ? ` (${a.checkoutState.extraTimeReason})` : ''}`, appointmentId: a.id, receiptId: receiptRef.id, by: auth.actor.name || 'Front desk', needs: ['booking_policies'] });
      if (num(vc?.materialOverage) > 0) await recordCharge(db, tenantId, { kind: 'extra_product', clientId: who, cents: Math.round(num(vc.materialOverage) * 100), reason: `Extra product — ${a.checkoutState?.extraProductNote || ''}`.trim(), appointmentId: a.id, receiptId: receiptRef.id, by: auth.actor.name || 'Front desk', needs: ['booking_policies'] }); }
  } catch { /* the sale stands */ }
  // Restocking fund: each studio visit sets aside its product cost + markup (never a renter's service).
  try { const { setAsideForSale } = await import('@/lib/restocking-fund');
    await setAsideForSale(db, tenantId, tenant, receiptRef.id, visits.map((v: any, idx: number) => ({ appointmentId: v.appointment.id, service: v.service, serviceName: v.service?.name || 'Service', renter: !!calc.visits[idx]?.renter }))); } catch { /* the sale stands */ }
  // Finish the receipt: the card used for each card payment, and what's left on any rent / tuition account.
  try {
    const cardPays = detail.payments.filter((x: any) => x.pi);
    if (cardPays.length && tenant.stripeAccountId) {
      const StripeLib = (await import('stripe')).default; const sc = new StripeLib(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any });
      for (const x of cardPays) { try { const pi: any = await sc.paymentIntents.retrieve(x.pi, { expand: ['latest_charge'] }, { stripeAccount: tenant.stripeAccountId });
        const pm: any = pi?.latest_charge?.payment_method_details || {}; const card = pm.card || pm.card_present || pm.interac_present || null;
        if (card) { x.brand = card.brand || null; x.last4 = card.last4 || null; x.wallet = card.wallet?.type || null; } } catch { /* the receipt stands without it */ } }
    }
    detail.payments = detail.payments.map(({ pi, ...rest }: any) => rest);   // the payment id stays on the sale, not the client's receipt
  } catch { /* best effort */ }
  // Rent / tuition: a receipt to the person whose account it is (what's left, when's next), and their autopay status.
  try {
    const { sendAccountReceipt, autopayLink } = await import('@/lib/account-receipts');
    const { linkOrigin } = await import('@/lib/app-origin'); const { nextChargeDate } = await import('@/lib/rent-schedule');
    const receiptLink = `${linkOrigin(tenant)}/r/${tenantId}/${receiptRef.id}?k=${viewKey}`;
    for (const o of outcomes) {
      if (o.kind === 'rent' && o.renterId) {
        const it: any = (items as any[]).find((x) => x.type === 'rent' && x.__acct?.renter?.id === o.renterId);
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const nextDue = it?.__acct?.lease ? nextChargeDate(it.__acct.lease, tomorrow) : null;
        Object.assign(o, await sendAccountReceipt(db, tenantId, tenant, { kind: 'rent', id: o.renterId, amountCents: o.paidCents, owedAfterCents: o.owedAfterCents, creditCents: o.creditCents, nextDue, receiptLink }));
        o.autopayQr = await autopayLink(db, tenantId, tenant, 'rent', o.renterId, false);
      }
      if (o.kind === 'tuition' && o.planId) {
        const p: any = (await db.doc(`${T}/tuitionPlans/${o.planId}`).get()).data() || {};
        const nextAmountCents = p.nextDueAt ? Math.max(0, Math.min(o.remainingCents, Number(p.installmentCents) || o.remainingCents) - (Number(p.prepaidCents) || 0)) : null;
        Object.assign(o, await sendAccountReceipt(db, tenantId, tenant, { kind: 'tuition', id: o.planId, amountCents: o.paidCents, remainingCents: o.remainingCents, nextDue: p.nextDueAt || null, nextAmountCents, receiptLink }));
        o.autopayQr = await autopayLink(db, tenantId, tenant, 'tuition', o.planId, false);
      }
    }
  } catch (e: any) { warnings.push('The receipt couldn’t be sent automatically — use Text or Email below.'); }
  try { await receiptRef.set({ detail: { ...detail, accounts: outcomes.filter((o: any) => o.kind === 'rent' || o.kind === 'tuition').map((o: any) => ({ kind: o.kind, name: o.name, program: o.program || null, paidCents: o.paidCents,
    owedAfterCents: o.owedAfterCents ?? null, creditCents: o.creditCents ?? null, remainingCents: o.remainingCents ?? null })) } }, { merge: true }); } catch { /* best effort */ }
  if (paidDiffers) warnings.push(`The card was charged $${(paidDiffers.paidCents / 100).toFixed(2)}, but the sale comes to $${(paidDiffers.dueCents / 100).toFixed(2)}. The receipt is flagged: settle the $${(Math.abs(paidDiffers.paidCents - paidDiffers.dueCents) / 100).toFixed(2)} difference with the client.`);
  return json({ ok: true, checkoutSessionId, receiptId: receiptRef.id, total: calc.total, collected: Math.max(0, Math.round((calc.total - depositUsed) * 100) / 100), depositUsed, subtotal: calc.subtotal, tax: calc.tax, mismatch, warnings, outcomes, giftCards: giftsIssued, ...(paidDiffers ? { paidDiffers } : {}) });
}
