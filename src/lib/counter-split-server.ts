// src/lib/counter-split-server.ts — SPLIT BILLS AT THE COUNTER AND THE DRIVE-THRU (server; design board "Money at the
// counter", part 3; lib/counter-money). One order, paid in parts: evenly some number of ways, or by amount.
// - takePart: one part in cash (into the drawer now, the change handed back) or by card (the card reader's payment,
//   lib/counter-card, or another card machine of the business's own). It's on the order with the gift cards and store
//   credit (`tenders`), and what's left is less by it. The last part pays the order (lib/counter-server payOrder), which
//   books the sale once, split, with each part.
// - undoPart: a part given back before the order is paid (a manager's: the route checks): the card payment refunded, or
//   the cash taken back out of the drawer. Paid, the order is refunded as a whole instead.
// - setSplit: how many ways, kept on the order so each screen shows the same next share.
// While a part is paid, the order's total stays as it is (no tip, discount or reward changes: lib/counter-money-server
// notNow, lib/counter-points), and it can't be voided until the parts are given back (lib/counter-server voidOrder).
import { randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { cardBusy } from '@/lib/counter-server';
import { dueCentsOf, tendersOf, paidPartsOf, isPaidPart, partBackOpen, PART_BACK_WORDS, PARTS_MAX, SPLIT_WAYS_MAX, type Tender } from '@/lib/counter-money';
import { refundAmount } from '@/lib/stripe-refund';
import { accountOf } from '@/lib/reader-sale';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
const nowIso = () => new Date().toISOString();
const usd = (c: number) => `$${(Math.round(c) / 100).toFixed(2)}`;

/** Why it can't take a part now (null: it can). `reader`: the card reader's own payment, being taken. */
function notNow(o: any, reader = false): Fail | null {
  if (!o) return fail('That order is gone.', 404);
  if (o.paidAt) return fail('It’s paid already.', 409, 'paid');
  if (o.status !== 'sent' && o.status !== 'done') return fail(o.status === 'building' ? 'Send the order first, then take the payment.' : 'That order can’t be paid now.', 409, 'not_sent');
  if (o.staffMeal) return fail('A staff meal takes no money.', 409, 'staff');
  if (o.app?.code) return fail('A delivery app’s order is paid on the app.', 409, 'app');
  if (o.channel === 'kiosk') return fail('A kiosk order is paid at the kiosk.', 409, 'kiosk');
  if (!reader && cardBusy(o)) return fail('The card reader is asking for this order’s payment. Stop it first.', 409, 'card_busy');
  if (o.phone?.id && o.phone.state === 'open') return fail('A scan-to-pay code is open for this order. Close it first.', 409, 'phone_open');
  if (partBackOpen(o)) return fail(PART_BACK_WORDS, 409, 'part_back');
  return null;
}

const partIdOf = () => `p${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

export type PartAnswer = { ok: true; partId: string; cents: number; change: number | null; due: number; already?: boolean; inDrawer?: boolean } | { ok: true; whole: true } | Fail;

/** One part, paid now. `cents`: the part; `tendered` (dollars): the cash handed over; `card.id`: the card reader's payment
 *  (taken already: lib/counter-card settle), or none for another card machine. All of what's left: `whole`, for the
 *  caller to pay the order with it (lib/counter-server payOrder). */
export async function takePart(db: any, tenantId: string, orderId: string, how: { method: 'cash' | 'card'; cents: unknown; tendered?: unknown; by: string; card?: { id: string } | null }): Promise<PartAnswer> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const cents = Math.round(Number(how.cents));
  if (!Number.isFinite(cents) || cents < 1 || cents > 100000) return fail('How much is this part?', 400, 'amount');
  const tenderedC = how.method === 'cash' ? (how.tendered === undefined || how.tendered === null || how.tendered === '' ? cents : Math.round(Number(how.tendered) * 100)) : null;
  if (tenderedC !== null && (!Number.isFinite(tenderedC) || tenderedC < 0 || tenderedC > 100000)) return fail('How much did they hand over?', 400);
  if (tenderedC !== null && tenderedC < cents) return fail(`That’s less than this part (${usd(cents)}).`, 400, 'short');
  const reader = how.method === 'card' && !!how.card?.id;
  if (reader && !ID.test(String(how.card!.id))) return fail('Which card payment?', 400);
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    // The card reader's part, asked again (the first answer was lost): once.
    if (o && reader) { const had = tendersOf(o).find((t) => t.kind === 'card' && t.id === how.card!.id); if (had) return { ok: true as const, already: true, partId: (had as any).partId, cents: had.cents, change: null, due: dueCentsOf(o) / 100 }; }
    const no = notNow(o, reader); if (no) return no;
    const due = dueCentsOf(o);
    if (cents >= due) return reader ? fail('That card payment is more than what’s left.', 409, 'over') : { ok: true as const, whole: true as const };
    if (tendersOf(o).length >= PARTS_MAX) return fail(`An order takes up to ${PARTS_MAX} parts. Take the rest in one.`, 409, 'too_many');
    const at = nowIso(); const partId = partIdOf();
    let part: Tender;
    let inDrawer = false;
    if (how.method === 'cash') {
      // Into the one drawer that's open now, as a sale's cash is (two open, or none: kept on the order, for the count).
      const till = (await tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))).docs;
      const drawer = till.length === 1 ? till[0] : null;
      part = { kind: 'cash', partId, cents, tendered: tenderedC!, at, by: how.by, tillId: drawer ? drawer.id : null, part: true };
      if (drawer) { tx.set(drawer.ref, { expectedCash: FieldValue.increment(cents / 100), totalCashSales: FieldValue.increment(cents / 100) }, { merge: true }); inDrawer = true; }
    } else part = { kind: 'card', partId, cents, id: reader ? String(how.card!.id) : null, at, by: how.by, part: true };
    tx.set(ref, { tenders: [...tendersOf(o), part], partsOpen: true, updatedAt: at }, { merge: true });
    return { ok: true as const, partId, cents, change: tenderedC !== null ? (tenderedC - cents) / 100 : null, due: (due - cents) / 100, inDrawer };
  });
}

/** A part given back before the order is paid: its card payment refunded (once), or its cash taken back out of the
 *  drawer it went into (or the one open now). Another card machine's part: given back on that machine. */
export async function undoPart(db: any, tenantId: string, tenant: any, orderId: string, partId: unknown, who: { id: string | null; name: string }) {
  if (!ID.test(orderId) || !ID.test(String(partId || ''))) return fail('Which part?', 400);
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  // Claimed first, in one step with the order: not paid, the part on it, nothing asking a card or a phone for the rest,
  // and (a card reader's part) nothing paying the order while its refund is asked (lib/counter-money partBackOpen).
  const claim: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return fail('That order is gone.', 404);
    if (o.paidAt) return fail('That order is paid. Refund it at the desk instead.', 409, 'paid');
    const p: any = paidPartsOf(o).find((t: any) => t.partId === partId);
    if (!p) return fail('That part isn’t on the order.', 404, 'gone');
    if (cardBusy(o)) return fail('The card reader is asking for this order’s payment. Stop it first.', 409, 'card_busy');
    if (o.phone?.id && o.phone.state === 'open') return fail('A scan-to-pay code is open for this order. Close it first.', 409, 'phone_open');
    if (partBackOpen(o) && o.partBack.partId !== partId) return fail(PART_BACK_WORDS, 409, 'part_back');
    if (p.kind === 'card' && p.id) tx.set(ref, { partBack: { partId: String(partId), at: nowIso(), refunded: o.partBack?.partId === partId && o.partBack?.refunded === true } }, { merge: true });
    return { ok: true as const, p, wasRefunded: o.partBack?.partId === partId && o.partBack?.refunded === true };
  });
  if (!claim.ok) return claim;
  const p0: any = claim.p;
  // A card reader's part: refunded (the same refund, asked twice, is given once), then taken off.
  let refunded = false;
  if (p0.kind === 'card' && p0.id) {
    const acct = accountOf(tenant);
    const r: any = acct ? await refundAmount(acct, String(p0.id), p0.cents, `counter-part-back-${p0.id}`, { origin: 'app', orderId }) : { ok: false };
    if (!r.ok && r.code !== 'charge_already_refunded') {
      // (Not refunded: the hold is let go, unless an earlier try already refunded it.)
      if (claim.wasRefunded !== true) await ref.set({ partBack: null }, { merge: true }).catch(() => null);
      return fail(acct ? 'The card company didn’t answer, so nothing changed. Try again in a moment.' : 'Card payments aren’t set up for this business.', acct ? 503 : 409, 'refund');
    }
    refunded = true;
    // (Refunded: the order stays held until the part is off it, however long that takes.)
    await ref.set({ partBack: { partId: String(partId), at: nowIso(), refunded: true } }, { merge: true });
  }
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return fail('That order is gone.', 404);
    const p: any = paidPartsOf(o).find((t: any) => t.partId === partId);
    if (!p) return { ok: true as const, already: true, due: dueCentsOf(o) / 100, cents: p0.cents, kind: p0.kind };
    // (Paid meanwhile, never with a card part being refunded: the claim held it. A cash part is taken back in this step.)
    if (o.paidAt) return fail('That order is paid. Refund it at the desk instead.', 409, 'paid');
    let fromDrawer = false;
    if (p.kind === 'cash') {
      // Out of the drawer it went into, while that one's open; or the one open now; or none (counted as it is). One that
      // never went into a drawer (none open, or two, when it was taken) comes out of none.
      const own = p.tillId && ID.test(String(p.tillId)) ? await tx.get(db.doc(`${T}/tillSessions/${p.tillId}`)) : null;
      let open: any = own?.exists && own.data()?.status === 'open' ? own : null;
      if (!open && own) { const now = (await tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))).docs; open = now.length === 1 ? now[0] : null; }
      if (open) { tx.set(open.ref, { expectedCash: FieldValue.increment(-p.cents / 100), totalCashSales: FieldValue.increment(-p.cents / 100) }, { merge: true }); fromDrawer = true; }
    }
    const keep = tendersOf(o).filter((t: any) => t.partId !== partId);
    tx.set(ref, { tenders: keep, partsOpen: keep.some(isPaidPart), updatedAt: nowIso(), partBack: null, partsBack: { [String(partId)]: { kind: p.kind, cents: p.cents, at: nowIso(), by: who.name, byId: who.id || null, refunded, fromDrawer } } }, { merge: true });
    return { ok: true as const, due: dueCentsOf({ ...o, tenders: keep }) / 100, cents: p.cents, kind: p.kind as 'cash' | 'card', machine: p.kind === 'card' && !p.id, refunded, fromDrawer };
  });
}

/** How many ways it's split (2 to 10), or not split (null). */
export async function setSplit(db: any, tenantId: string, orderId: string, ways: unknown) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const n = ways === null || ways === undefined || ways === '' ? null : Math.round(Number(ways));
  if (n !== null && (!Number.isFinite(n) || n < 2 || n > SPLIT_WAYS_MAX)) return fail(`Split it 2 to ${SPLIT_WAYS_MAX} ways.`, 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return fail('That order is gone.', 404);
    if (o.paidAt) return fail('It’s paid already.', 409, 'paid');
    tx.set(ref, { split: n ? { ways: n } : null, updatedAt: nowIso() }, { merge: true });
    return { ok: true as const, ways: n };
  });
}
