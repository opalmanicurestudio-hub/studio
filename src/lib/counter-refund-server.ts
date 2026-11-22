// src/lib/counter-refund-server.ts — A REFUND AFTER A COUNTER ORDER IS PAID (server; design board "Register tools";
// lib/counter-refund works out how much and where it goes). A manager's (the route checks).
// 1. Claimed on the order first, with what goes back where. A refund that was started and didn't finish is finished
//    (never a second one): each card's refund has one key for it, so asking again replays it.
// 2. Card payments are refunded at the card company.
// 3. Then, in one step: gift cards and store credit get it back, cash comes out of the open drawer, the refund line goes
//    in the books (its tax and tip carved out, the tip off whoever's it was), and the order keeps what went back.
// Stock isn't changed: what was paid for was made.
import { FieldValue } from 'firebase-admin/firestore';
import { refundPlan, sourcesOf, allocate, cantRefund, refundLeftOf, type RefundAsk, type Back, type Source } from '@/lib/counter-refund';
import { refundAmount } from '@/lib/stripe-refund';
import { accountOf } from '@/lib/reader-sale';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
const nowIso = () => new Date().toISOString();
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const CHANNEL: Record<string, string> = { counter: 'Counter', 'drive-thru': 'Drive-thru', kiosk: 'Kiosk', ahead: 'Order ahead' };

/** The ask as kept: all, or some lines; the tip; why. */
export function cleanAsk(b: any): RefundAsk {
  return { all: b?.all !== false, lines: Array.isArray(b?.lines) ? b.lines.slice(0, 40).map((l: any) => ({ lineId: clip(l?.lineId, 80), qty: Math.max(0, Math.round(Number(l?.qty) || 0)) })) : [],
    tip: b?.tip === undefined ? undefined : b.tip === true, reason: clip(b?.reason, 120) };
}

export type RefundDone = { ok: true; cents: number; back: { kind: string; cents: number; code?: string }[]; machineCents: number; cashCents: number; full: boolean; resumed?: boolean; startedBy?: string; number: string };

const backOut = (back: Back[]) => back.map((b) => ({ kind: b.kind, cents: b.back, ...(b.code ? { code: b.code } : {}) }));
/** A refund started on it that didn't finish (a card company that didn't answer): what it was, to finish it first. */
const unfinished = (c: any) => ({ cents: Number(c?.plan?.cents) || 0, reason: String(c?.reason || ''), approvedBy: String(c?.approvedBy || 'A manager'), at: String(c?.at || ''), back: backOut(Array.isArray(c?.back) ? c.back : []) });

/** Where it can go back: a gift card that was cancelled or has expired can't take it (read with `get`, in the caller's
 *  step), so what it would have taken goes nowhere and the refund is refused, naming it. */
async function placesFor(get: (path: string) => Promise<any>, T: string, o: any, cents: number): Promise<{ ok: true; back: Back[] } | { ok: false; error: string }> {
  const all = sourcesOf(o); const now = Date.now();
  const gone: Source[] = [];
  for (const s of all.filter((x) => x.kind === 'gift' && x.giftCardId && ID.test(x.giftCardId))) {
    const g: any = await get(`${T}/giftCards/${s.giftCardId}`);
    if (!g || g.status === 'void' || (g.expiresAt && Date.parse(String(g.expiresAt)) < now)) gone.push(s);
  }
  const back = allocate(all.filter((s) => !gone.includes(s)), cents);
  const short = cents - back.reduce((n, b) => n + b.back, 0);
  if (short > 0) return { ok: false, error: `${gone.length ? `Gift card ${gone[0].code || ''} was cancelled or has expired, so ` : ''}$${(short / 100).toFixed(2)} of this has nowhere to go back. Refund less, or give it back another way.`.replace(/\s+/g, ' ') };
  return { ok: true, back };
}

/** What a refund would give back and where (nothing written): for the screen to show before it's okayed. One started
 *  that didn't finish comes back instead (`resuming`), to be finished first. */
export async function previewRefund(db: any, tenantId: string, orderId: string, ask: RefundAsk) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const T = `tenants/${tenantId}`;
  const o: any = (await db.doc(`${T}/counterOrders/${orderId}`).get()).data();
  if (o?.refundClaim) return { ok: true as const, resuming: unfinished(o.refundClaim) };
  const p = refundPlan(o, ask); if (!p.ok) return fail(p.error, 409, 'plan');
  const at = await placesFor(async (path) => (await db.doc(path).get()).data() || null, T, o, p.plan.cents); if (!at.ok) return fail(at.error, 409, 'nowhere');
  return { ok: true as const, plan: p.plan, back: backOut(at.back) };
}

/** Give money back on a paid order. `approver`: the manager who okayed it. `resume`: finish the one that was started
 *  and didn't (it's never finished by a new ask without saying so, and a new one never starts while it's there). */
export async function refundCounterOrder(db: any, tenantId: string, tenant: any, orderId: string, ask: RefundAsk, approver: { id: string | null; name: string }, by: string, resume = false): Promise<RefundDone | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  if (!resume && !ask.reason) return fail('Why is it being refunded?', 400, 'reason');
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  // 1. Claimed, or the one already claimed (finished, never started again).
  const claim: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return fail('That order is gone.', 404);
    if (o.refundClaim) {
      if (resume) return { ok: true, o, c: o.refundClaim, resumed: true };
      const u = unfinished(o.refundClaim);
      return { ...fail(`A $${(u.cents / 100).toFixed(2)} refund okayed by ${u.approvedBy} didn’t finish. Finish it first.`, 409, 'unfinished'), unfinished: u };
    }
    if (resume) return fail('That refund was finished already.', 409, 'finished');
    const no = cantRefund(o); if (no) return fail(no, 409, 'cant');
    const p = refundPlan(o, ask); if (!p.ok) return fail(p.error, 409, 'plan');
    const seq = (Array.isArray(o.refunds) ? o.refunds.length : 0) + 1;
    const at = await placesFor(async (path) => (await tx.get(db.doc(path))).data() || null, T, o, p.plan.cents); if (!at.ok) return fail(at.error, 409, 'nowhere');
    const back: Back[] = at.back;
    const c = { seq, at: nowIso(), plan: p.plan, back, reason: ask.reason, by, approvedBy: approver.name, approvedById: approver.id || null, sent: {} as Record<string, string> };
    tx.set(ref, { refundClaim: c }, { merge: true });
    return { ok: true, o, c };
  });
  if (!claim.ok) return claim;
  const c: any = claim.c; const o0: any = claim.o;
  // 2. Card payments, each by its own key for this refund (asked again, the same refund).
  const cards = (c.back as Back[]).filter((b) => b.kind === 'card' && b.pi && !c.sent?.[b.pi]);
  if (cards.length) {
    const acct = accountOf(tenant);
    for (const b of cards) {
      const r: any = acct ? await refundAmount(acct, b.pi!, b.back, `counter-refund-${orderId}-${c.seq}-${b.pi}`, { origin: 'app', orderId }) : { ok: false, error: 'Card payments aren’t set up for this business.' };
      if (!r.ok && r.code !== 'charge_already_refunded') {
        // Turned down with nothing given back yet: let go, so it can be asked again some other way. Not answered, or part
        // given back already: kept, and asking again finishes it.
        const anySent = Object.keys(c.sent || {}).length > 0;
        if (!r.unknown && !anySent) await ref.set({ refundClaim: null }, { merge: true }).catch(() => null);
        return fail(r.unknown || anySent ? 'The card company didn’t answer, so the refund isn’t finished. Try again: it won’t refund twice.' : `The card refund didn’t go through: ${r.error || 'the card company said no'}.`, r.unknown || anySent ? 503 : 409, 'card');
      }
      c.sent = { ...(c.sent || {}), [b.pi!]: r.id || 'already' };
      await ref.set({ refundClaim: { sent: { [b.pi!]: r.id || 'already' } } }, { merge: true });
    }
  }
  // 3. Everything else, and the books, in one step.
  const lineRef = db.doc(`${T}/transactions/crefund_${orderId}_${c.seq}`);
  const gifts = (c.back as Back[]).filter((b) => b.kind === 'gift' && b.giftCardId && ID.test(b.giftCardId));
  const credits = (c.back as Back[]).filter((b) => b.kind === 'credit' && b.clientId && ID.test(b.clientId));
  const cashC = (c.back as Back[]).filter((b) => b.kind === 'cash').reduce((n, b) => n + b.back, 0);
  const machineC = (c.back as Back[]).filter((b) => b.kind === 'machine').reduce((n, b) => n + b.back, 0);
  const done: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return fail('That order is gone.', 404);
    if (!o.refundClaim || o.refundClaim.seq !== c.seq) return { ok: true, already: true };
    const line = await tx.get(lineRef);
    const gReads = await Promise.all(gifts.map((b) => tx.get(db.doc(`${T}/giftCards/${b.giftCardId}`))));
    const cReads = await Promise.all(credits.map((b) => tx.get(db.doc(`${T}/clients/${b.clientId}`))));
    const tipLine: any = c.plan.tipCents > 0 ? (await tx.get(db.doc(`${T}/transactions/ctip_${orderId}`))).data() || null : null;
    const till = cashC > 0 ? (await tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))).docs : [];
    const at = nowIso();
    if (line.exists) { tx.set(ref, { refundClaim: null }, { merge: true }); return { ok: true, already: true }; }
    gifts.forEach((b, i) => {
      const g: any = gReads[i].data(); if (!g) return;
      const bal = (Number(g.balanceCents) || 0) + b.back;
      tx.update(gReads[i].ref, { balanceCents: bal, status: g.status === 'void' ? 'void' : 'active',
        history: [...(Array.isArray(g.history) ? g.history : []).slice(-80), { at, type: 'refund', cents: b.back, balanceAfter: bal, by: c.approvedBy, ref: lineRef.id }] });
    });
    credits.forEach((b, i) => {
      const cl: any = cReads[i].data() || {};
      const entry = { id: `cref_${orderId}_${c.seq}`, amount: b.back / 100, amountCents: b.back, status: 'available', createdAt: at, type: 'refund', source: 'counter_refund', orderId, note: `Refund, order ${o.number || ''}`.trim() };
      tx.set(cReads[i].ref, { storeCredits: [...(Array.isArray(cl.storeCredits) ? cl.storeCredits : []), entry], totalStoreCredit: Math.round(((Number(cl.totalStoreCredit) || 0) + b.back / 100) * 100) / 100 }, { merge: true });
    });
    const drawer = cashC > 0 && till.length === 1 ? till[0] : null;
    if (drawer) tx.set(drawer.ref, { expectedCash: FieldValue.increment(-cashC / 100), totalCashRefunds: FieldValue.increment(cashC / 100) }, { merge: true });
    const kinds = Array.from(new Set((c.back as Back[]).map((b) => b.kind)));
    const word = kinds.length > 1 ? 'split' : kinds[0] === 'gift' ? 'gift_card' : kinds[0] === 'credit' ? 'store_credit' : kinds[0] === 'cash' ? 'cash' : 'card';
    const label = `${CHANNEL[String(o.channel)] || 'Counter'} ${o.number || ''}`.trim();
    const tipStaff = tipLine?.staffId ? String(tipLine.staffId) : null;
    tx.set(lineRef, { id: lineRef.id, date: at, createdAt: at, tenantId, orderId, description: `Refund, ${label}: ${c.reason}`, clientOrVendor: label,
      type: 'expense', context: 'Business', category: 'Refunds', taxBucket: 'refund', amount: c.plan.cents / 100, taxRefunded: c.plan.taxCents / 100,
      ...(c.plan.tipCents > 0 ? { tipRefunded: c.plan.tipCents / 100, tipBooked: true, ...(tipStaff ? { tipReversal: { staffId: tipStaff, amount: c.plan.tipCents / 100 } } : {}) } : {}),
      paymentMethod: word, hasReceipt: false, reversalOf: `counter_${orderId}`, refundedToCard: kinds.includes('card'), by: c.by, approvedBy: c.approvedBy, approvedById: c.approvedById, reason: c.reason,
      stripeRefundIds: Object.values(c.sent || {}).filter((x) => x && x !== 'already'), back: (c.back as Back[]).map((b) => ({ kind: b.kind, cents: b.back })) });
    const backMap: Record<string, number> = { ...(o.refundBack || {}) }; for (const b of c.back as Back[]) backMap[b.key] = (Number(backMap[b.key]) || 0) + b.back;
    const linesMap: Record<string, number> = { ...(o.refundedLines || {}) }; for (const l of c.plan.lines) linesMap[l.lineId] = (Number(linesMap[l.lineId]) || 0) + l.qty;
    tx.set(ref, { refundClaim: null, refundCents: (Number(o.refundCents) || 0) + c.plan.cents, refundTipCents: (Number(o.refundTipCents) || 0) + c.plan.tipCents, refundTaxCents: (Number(o.refundTaxCents) || 0) + c.plan.taxCents,
      refundBack: backMap, refundedLines: linesMap, lastRefundAt: at,
      refunds: [...(Array.isArray(o.refunds) ? o.refunds : []), { seq: c.seq, at, cents: c.plan.cents, taxCents: c.plan.taxCents, tipCents: c.plan.tipCents, lines: c.plan.lines, reason: c.reason, by: c.by,
        approvedBy: c.approvedBy, approvedById: c.approvedById, back: (c.back as Back[]).map((b) => ({ kind: b.kind, cents: b.back, ...(b.code ? { code: b.code } : {}) })), lineId: lineRef.id, ...(cashC > 0 && !drawer ? { cashNotFromDrawer: true } : {}) }] }, { merge: true });
    return { ok: true, number: String(o.number || '') };
  });
  if (!done.ok) return done;
  const left = refundLeftOf(o0);
  return { ok: true, cents: c.plan.cents, back: (c.back as Back[]).map((b) => ({ kind: b.kind, cents: b.back, ...(b.code ? { code: b.code } : {}) })), machineCents: machineC, cashCents: cashC,
    full: c.plan.cents >= left, ...(claim.resumed ? { resumed: true, startedBy: String(c.approvedBy || '') } : {}), number: String(done.number || o0.number || '') };
}
