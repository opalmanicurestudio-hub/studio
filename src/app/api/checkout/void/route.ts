// src/app/api/checkout/void/route.ts — VOID A WHOLE SALE (staff ask; a manager approves).
// Undoes everything that sale did, together — using the reversal record the checkout stored on its receipt:
//   every payment line reversed (originals kept, marked void) · stock returned · owed fees put back on whoever owed them ·
//   the deposit credit made available again · a package session / membership perk given back · discount-code and offer
//   use reversed · gift card money put back on the cards · lifetime value taken back · the visit(s) reopened for a
//   correct checkout · the till corrected.
// Card payments are refunded first (the client gets the refund message). CASH: the desk is told exactly how much to
// hand back and what happened to the till. Within the business's void window (same day, by default); after that it's a refund.
// Once, however often it's asked:
//   1. claimed: the receipt is marked as being voided by this request, in one step (a second tap is told it's under
//      way; a claim left for more than two minutes by a try that never finished can be taken over);
//   2. card payments refunded, each under one key for its payment, so a retry never refunds twice;
//   3. everything else undone in one save, which goes through only if the receipt is exactly as this request left it
//      (still claimed by it, not voided) and the documents a new value was worked out from (an item's stock batches, a
//      client's package sessions) haven't changed since they were read. If one of those changed, nothing in the save
//      happened and it's built again from fresh reads. If the save fails any other way, nothing in it happened — gift
//      card money included — and the claim is let go, so pressing Void again starts clean and undoes each thing once.
import { returnToBatches } from '@/lib/retail-orders';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { consumeApproval, isApprover } from '@/lib/approvals';
import { refundPaymentIntent } from '@/lib/stripe-refund';

export const dynamic = 'force-dynamic';
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n: number) => `$${num(n).toFixed(2)}`;
// Ids named after what they record, so a record can only ever be written once.
const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const CLAIM_MS = 2 * 60000;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), receiptId = String(b.receiptId || '');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const reason = String(b.reason || '').trim().slice(0, 300);
  if (!reason) return NextResponse.json({ ok: false, error: 'Say why the sale is being voided.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const rRef = db.doc(`${T}/receipts/${receiptId}`); const rc0: any = (await rRef.get()).data();
  if (!rc0) return NextResponse.json({ ok: false, error: 'That sale wasn’t found.' }, { status: 404 });
  if (rc0.voided) return NextResponse.json({ ok: true, already: true });
  if (!rc0.reversal) return NextResponse.json({ ok: false, error: 'This sale was recorded before whole-sale voids existed — void its lines one by one, or refund it.' }, { status: 409 });
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const R = rc0.reversal;
  const { reverseRentPayment } = await import('@/lib/rent-desk');
  // The void window: the same day (default), or while that day's till is still open.
  const tz = tenant.timezone || undefined; const dayOf = (d: Date) => d.toLocaleDateString('en-US', { timeZone: tz });
  const windowRule = tenant?.voidRules?.window === 'till_open' ? 'till_open' : 'same_day';
  let till: any = null; if (R.tillId) till = ((await db.doc(`${T}/tillSessions/${R.tillId}`).get()).data() as any) || null;
  const inWindow = windowRule === 'till_open' ? (R.tillId ? till?.status === 'open' : dayOf(new Date(rc0.date)) === dayOf(new Date())) : dayOf(new Date(rc0.date)) === dayOf(new Date());
  if (!inWindow) return NextResponse.json({ ok: false, error: windowRule === 'till_open' ? 'That day’s till is closed — refund the sale instead.' : 'Sales can only be voided on the day — refund it instead.' }, { status: 409 });
  const now = new Date().toISOString();

  // ── 1. The claim: this sale is being voided, by this request ──
  const claimId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const claim: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(rRef)).data() || {};
    if (cur.voided) return { already: true };
    if (cur.voidClaimAt && Date.now() - (Date.parse(String(cur.voidClaimAt)) || 0) < CLAIM_MS) return { busy: true };
    tx.set(rRef, { voidClaimAt: now, voidClaimId: claimId, voidClaimBy: auth.actor.name || null }, { merge: true });
    return { rc: cur };
  });
  if (claim.already) return NextResponse.json({ ok: true, already: true });
  if (claim.busy) return NextResponse.json({ ok: false, error: 'This sale is being voided already. Give it a moment.' }, { status: 409 });
  // Lets go of the claim (only while it's still this request's), so the next try starts clean.
  const release = () => db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(rRef)).data() || {};
    if (!cur.voided && cur.voidClaimId === claimId) tx.set(rRef, { voidClaimAt: FieldValue.delete(), voidClaimId: FieldValue.delete(), voidClaimBy: FieldValue.delete() }, { merge: true });
  }).catch(() => {});
  const rc: any = claim.rc;

  // A manager approves (signed in as a manager, or their PIN / phone approval for this sale).
  let approvedBy = auth.actor.name;
  if (!isApprover(auth.actor.role)) {
    const ok = await consumeApproval(db, tenantId, b.approvalToken, { kind: 'void', ref: receiptId });
    if (!ok) { await release(); return NextResponse.json({ ok: false, error: 'Voiding a sale needs a manager’s approval.' }, { status: 403 }); }
    approvedBy = ok.approverName;
  }

  // ── 2. Card: refund first (once — a retried void never refunds twice) ──
  let refunded = false;
  if (R.stripePaymentIntentId && !rc.voidRefundedAt) {
    refunded = await refundPaymentIntent(tenant.stripeAccountId || tenant.stripeConnectAccountId || null, String(R.stripePaymentIntentId));
    if (!refunded) { await release(); return NextResponse.json({ ok: false, error: 'The card refund didn’t go through, so nothing was voided. Try again, or refund it from Stripe.' }, { status: 502 }); }
    await rRef.set({ voidRefundedAt: now }, { merge: true });
  } else if (rc.voidRefundedAt) refunded = true;
  if (Array.isArray(R.payments) && R.payments.length) {   // a split bill — every card share refunded, each only once
    const done: string[] = Array.isArray(rc.voidRefundedIds) ? [...rc.voidRefundedIds] : [];
    for (const p of R.payments.filter((x: any) => x.stripePaymentIntentId && !done.includes(x.stripePaymentIntentId))) {
      const ok = await refundPaymentIntent(tenant.stripeAccountId || tenant.stripeConnectAccountId || null, String(p.stripePaymentIntentId));
      if (!ok) { await release(); return NextResponse.json({ ok: false, error: `The refund for one card share (${money(p.amount)}) didn’t go through, so nothing was voided. Try again — cards already refunded won’t be refunded twice.` }, { status: 502 }); }
      done.push(p.stripePaymentIntentId); await rRef.set({ voidRefundedIds: done }, { merge: true });
    }
    refunded = R.payments.some((x: any) => x.stripePaymentIntentId);
  }

  // ── 3. Everything else, in one save ──
  // Built from what's read just before it goes in, and it goes in only if the receipt is exactly as this request left it
  // (still claimed by it, not voided) and nothing a new value was worked out from has changed since it was read: the
  // stock batches an item goes back into, and a package's sessions. If one of those changed (a sale at the same moment),
  // nothing in the save happened, so it's built again from fresh reads (twice more at most). Any other failure stops
  // here, and the claim is let go.
  const products: any[] = Array.isArray(R.products) ? R.products : [];
  const buildSave = async (snap: any) => {
    const batch = db.batch();
    // First the writes worked out from a read, each only if its document is unchanged since then. They go first, so
    // each is the first write to its document in the save.
    // Stock back on the shelf: one write per item (two lines of the same item add up), into its batches.
    const byItem = new Map<string, number>();
    for (const p of products) if (p?.id) byItem.set(String(p.id), (byItem.get(String(p.id)) || 0) + num(p.quantity));
    for (const [id, qty] of byItem) {
      const invRef = db.doc(`${T}/inventory/${id}`); let inv: any = null; let b2: any = null;
      try { inv = await invRef.get(); b2 = inv.exists ? returnToBatches((inv.data() as any)?.batches, qty) : null; } catch { /* the total still moves */ }
      if (inv?.exists && b2) batch.update(invRef, { totalStock: FieldValue.increment(qty), batches: JSON.parse(JSON.stringify(b2)) }, { lastUpdateTime: inv.updateTime });
      else batch.set(invRef, { totalStock: FieldValue.increment(qty) }, { merge: true });
    }
    // A package session given back: its sessions are worked out from the client's record as read.
    if (R.redeemed?.clientId && R.redeemed.type === 'package') {
      const cRef = db.doc(`${T}/clients/${R.redeemed.clientId}`); const cs = await cRef.get(); const c: any = cs.data() || {};
      const list: any[] = Array.isArray(c.activePackages) ? c.activePackages : [];
      const has = list.some((p: any) => p.packageId === R.redeemed.id);
      const next = has ? list.map((p: any) => (p.packageId === R.redeemed.id ? { ...p, sessionsRemaining: num(p.sessionsRemaining) + 1 } : p)) : [...list, { packageId: R.redeemed.id, sessionsRemaining: 1, restoredByVoid: receiptId }];
      if (cs.exists) batch.update(cRef, { activePackages: next }, { lastUpdateTime: cs.updateTime });
      else batch.set(cRef, { activePackages: next }, { merge: true });
    }
    for (const x of (Array.isArray(R.rentPayments) ? R.rentPayments : [])) reverseRentPayment(batch, db, T, x, now, reason);   // rent: the payment stops counting; its charges are owed again
    // What the desk collected for renters on this sale is no longer owed to them.
    for (const d of (await db.collection(`${T}/rentLedger`).where('receiptId', '==', receiptId).get()).docs) {
      const v: any = d.data() || {}; if (v.type === 'desk_collected' && v.status !== 'settled') batch.set(d.ref, { status: 'voided', voidedAt: now, voidReason: reason || null }, { merge: true });
      // A studio gift card's rent credit for this sale stops counting (the part already taken off rent stays noted).
      if (v.type === 'gift_card_credit' && v.status !== 'voided') batch.set(d.ref, { status: 'voided', voidedAt: now, voidReason: reason || null, appliedBeforeVoidCents: Number(v.appliedCents) || 0, appliedCents: Math.abs(Number(v.amountCents) || 0) }, { merge: true });
    }
    // Payment lines: originals marked void, one reversing line each (same shape as a single-line void), named after the
    // line it undoes. Each says what it undid (voidType / voidCategory / voidTaxBucket), so the books put it back where
    // that line was (lib/books-summary).
    const lines = (await db.collection(`${T}/transactions`).where('checkoutSessionId', '==', rc0.checkoutSessionId).get()).docs;
    const cardLines = R.stripePaymentIntentId ? (await db.collection(`${T}/transactions`).where('stripePaymentIntentId', '==', String(R.stripePaymentIntentId)).get()).docs : [];
    const seen = new Set<string>();
    for (const d of [...lines, ...cardLines]) {
      const t: any = d.data(); if (seen.has(d.id) || t.voided || t.category === 'Void') continue; seen.add(d.id);
      batch.set(d.ref, { voided: true, voidedAt: now, voidedBy: approvedBy, voidReason: reason }, { merge: true });
      const rv = db.doc(`${T}/transactions/void__${safe(d.id)}`);
      batch.set(rv, { id: rv.id, date: now, description: `VOID: ${t.description || ''}`, clientOrVendor: t.clientOrVendor || null, clientId: t.clientId || null, type: t.type === 'income' ? 'expense' : 'income', context: 'Business', category: 'Void', taxBucket: 'refund', amount: num(t.amount), paymentMethod: t.paymentMethod || null, voidOf: d.id, voidType: t.type || null, voidCategory: t.category || null, voidTaxBucket: t.taxBucket || null, notes: reason, hasReceipt: false, tenantId, checkoutSessionId: rc0.checkoutSessionId, voidOfSale: receiptId });
    }
    // The stock ledger: one entry per line put back.
    for (let i = 0; i < products.length; i++) {
      const p = products[i]; const sc = db.doc(`${T}/stockCorrections/void_${safe(receiptId)}_${i}`);
      batch.set(sc, { productId: p.id, date: now, change: num(p.quantity), unit: 'units', reason: `Void: ${p.name || 'item'} (sale for ${rc0.clientName || 'a client'})`, actorId: auth.actor.uid || 'staff', actorName: approvedBy, source: 'stock_ledger', type: 'returned', field: 'totalStock', refKind: 'void', refId: receiptId });
    }
    // Owed fees back on whoever owed them.
    const feesByOwner: Record<string, any[]> = {};
    for (const f of R.fees || []) (feesByOwner[f.owner] = feesByOwner[f.owner] || []).push(f);
    for (const [owner, list] of Object.entries(feesByOwner)) batch.set(db.doc(`${T}/clients/${owner}`), { unpaidFees: FieldValue.arrayUnion(...list.map((f: any) => f.fee || { feeId: f.feeId, feeAmount: f.feeAmount, reason: f.reason })), outstandingBalance: FieldValue.increment(list.reduce((s: number, f: any) => s + num(f.feeAmount), 0)) }, { merge: true });
    // The deposit credit, available again.
    // What the sale used of each deposit goes back on it (lib/credit-pools); a sale saved before that was kept used up
    // the whole deposit, so it's simply available again.
    if (Array.isArray(R.depositsUsed) && R.depositsUsed.length) {
      for (const d of R.depositsUsed) if (d?.id && Number(d.cents) > 0) batch.set(db.doc(`${T}/depositCredits/${String(d.id)}`), { status: 'available', consumedAt: null, usedCents: FieldValue.increment(-Math.round(Number(d.cents))), restoredByVoid: receiptId }, { merge: true });
    } else if (R.depositCreditId) batch.set(db.doc(`${T}/depositCredits/${R.depositCreditId}`), { status: 'available', consumedAt: null, appointmentId: null, restoredByVoid: receiptId }, { merge: true });
    // A membership perk given back (a package session is above).
    if (R.redeemed?.clientId && R.redeemed.type !== 'package') batch.set(db.doc(`${T}/clients/${R.redeemed.clientId}`), { subscription: { perkUsage: { [String(R.redeemed.itemId)]: FieldValue.increment(-1) } } }, { merge: true });
    // This month's team / family discount use given back.
    if (R.groupDiscount?.clientId && num(R.groupDiscount.amount) > 0) { const gc: any = ((await db.doc(`${T}/clients/${R.groupDiscount.clientId}`).get()).data() as any) || {};
      if (gc.teamDiscountUsage?.month === R.groupDiscount.month) batch.set(db.doc(`${T}/clients/${R.groupDiscount.clientId}`), { teamDiscountUsage: { amount: FieldValue.increment(-num(R.groupDiscount.amount)) } }, { merge: true }); }
    // A birthday / milestone treat given back (so it can be used again).
    if (R.momentKey && rc0.clientId) batch.update(db.doc(`${T}/clients/${rc0.clientId}`), { [`momentRewards.${R.momentKey}`]: FieldValue.delete() });
    // Gift card money spent on this sale goes back on the cards; cards sold on it are cancelled (what's left on them).
    // In this same save, so it happens exactly when the void does: each card's history says which sale's void it was.
    const giftBack: { id: string; cents: number }[] = []; const giftOwners = new Set<string>();
    for (const g of (Array.isArray(R.giftCardsUsed) ? R.giftCardsUsed : [])) {
      const id = safe(g?.id); const cents = Math.round(num(g?.cents)); if (!id || !(cents > 0)) continue;
      const gRef = db.doc(`${T}/giftCards/${id}`); const gs = await gRef.get(); if (!gs.exists) continue;
      const card: any = gs.data() || {};
      batch.set(gRef, { balanceCents: FieldValue.increment(cents), status: 'active',
        history: FieldValue.arrayUnion({ at: now, type: 'adjust', cents, balanceAfter: num(card.balanceCents) + cents, by: approvedBy, note: `Sale voided (${receiptId})`, ref: `void:${receiptId}` }) }, { merge: true });
      giftBack.push({ id, cents }); if (card.recipientId) giftOwners.add(String(card.recipientId));
    }
    for (const raw of (Array.isArray(R.giftCardsSold) ? R.giftCardsSold : [])) {
      const id = safe(raw); if (!id) continue;
      const gRef = db.doc(`${T}/giftCards/${id}`); const gs = await gRef.get(); if (!gs.exists) continue;
      const card: any = gs.data() || {};
      batch.set(gRef, { balanceCents: 0, status: 'void', voidedAt: now, voidedBy: approvedBy,
        history: FieldValue.arrayUnion({ at: now, type: 'void', cents: -num(card.balanceCents), balanceAfter: 0, by: approvedBy, note: `Sale voided (${receiptId})`, ref: `void:${receiptId}` }) }, { merge: true });
      if (card.recipientId) giftOwners.add(String(card.recipientId));
    }
    // Discount-code use reversed.
    for (const id of R.discountIds || []) batch.set(db.doc(`${T}/discounts/${id}`), { usageCount: FieldValue.increment(-1) }, { merge: true });
    // Lifetime value taken back.
    for (const [cid, amt] of Object.entries(R.spend || {})) if (num(amt) > 0) batch.set(db.doc(`${T}/clients/${cid}`), { lifetimeValue: FieldValue.increment(-num(amt)) }, { merge: true });
    // The visit(s) reopened, so they can be checked out correctly.
    for (const v of R.visits || []) {
      const back = ['completed', 'paid', ''].includes(String(v.statusBefore || '')) ? 'checked_in' : v.statusBefore;
      batch.set(db.doc(`${T}/appointments/${v.id}`), { status: back, stage: back === 'ready_for_checkout' ? 'ready_to_pay' : back === 'servicing' ? 'in_service' : 'arrived', checkoutSessionId: null, revenue: 0, voidedSale: receiptId, reopenedAt: now,
        timeline: FieldValue.arrayUnion({ at: now, kind: 'payment', text: `Sale voided — ${reason} · approved by ${approvedBy}`, by: approvedBy, via: 'void' }) }, { merge: true });
      if (v.checkInToken) { batch.set(db.doc(`appointmentCheckIns/${v.checkInToken}`), { status: back }, { merge: true }); batch.set(db.doc(`${T}/appointmentCheckIns/${v.checkInToken}`), { status: back }, { merge: true }); }
    }
    // The till: cash that came in is going back out.
    const hasCash = R.method === 'cash' || (R.method === 'split' && num(R.cashIn) > 0);   // a split bill hands back only its cash shares
    const cashBack = hasCash ? Math.round(((R.cashIn !== undefined ? num(R.cashIn) : num(R.cashSales) + num(R.cashTips))) * 100) / 100 : 0;   // exactly what they handed over
    let tillNote: string | null = null;
    if (hasCash) {
      if (till && till.status === 'open') {
        batch.set(db.doc(`${T}/tillSessions/${R.tillId}`), { expectedCash: FieldValue.increment(-(num(R.cashSales) + num(R.cashTips))), totalCashSales: FieldValue.increment(-num(R.cashSales)), totalCashTips: FieldValue.increment(-num(R.cashTips)),
          ...(Object.keys(R.cashTipsByStaff || {}).length ? { cashTipsByStaff: Object.fromEntries(Object.entries(R.cashTipsByStaff).map(([k, v]) => [k, FieldValue.increment(-num(v))])) } : {}),
          voidsTotal: FieldValue.increment(cashBack) }, { merge: true });
        tillNote = `The till has been adjusted — take ${money(cashBack)} out of it now.`;
      } else tillNote = R.tillId ? `That day’s till is already closed — take ${money(cashBack)} from the cash you keep for refunds and note it in the cash log.` : 'No till was open for this sale — take the cash from where you keep refund cash and note it.';
    }
    // The receipt is marked voided in the same save — only if it's exactly as this request left it.
    batch.update(rRef, { voided: true, voidedAt: now, voidedBy: approvedBy, requestedBy: auth.actor.name, voidReason: reason, ...(refunded ? { voidRefunded: true } : {}), ...(cashBack ? { cashReturned: cashBack } : {}),
      ...(giftBack.length ? { voidGiftCardsBack: giftBack } : {}), voidClaimAt: FieldValue.delete(), voidClaimId: FieldValue.delete(), voidClaimBy: FieldValue.delete() }, { lastUpdateTime: snap.updateTime });
    return { batch, cashBack, tillNote, giftOwners };
  };
  // Something it was worked out from changed between the reads and the save (nothing in the save happened).
  const changedUnder = (e: any) => Number(e?.code) === 9 || /FAILED_PRECONDITION/i.test(String(e?.message || ''));
  let saved: any = null;
  for (let attempt = 1; !saved; attempt++) {
    const snap = await rRef.get(); const cur: any = snap.data() || {};
    if (cur.voided) return NextResponse.json({ ok: true, already: true });
    if (cur.voidClaimId !== claimId) return NextResponse.json({ ok: false, error: 'This sale is being voided already. Give it a moment.' }, { status: 409 });
    try { const plan = await buildSave(snap); await plan.batch.commit(); saved = plan; }
    catch (e: any) {
      console.error('[void] save failed', e);
      if (changedUnder(e) && attempt < 3) continue;
      await release();
      return NextResponse.json({ ok: false, error: refunded ? 'The card was refunded, but the records didn’t update — press Void again (it won’t refund twice).' : 'The void didn’t save — nothing changed. Please try again.' }, { status: 500 });
    }
  }
  const { cashBack, tillNote, giftOwners } = saved;
  // The cards' owners see their gift card total as it is now.
  if (giftOwners.size) { try { const { syncClientGift } = await import('@/lib/gift-cards'); for (const cid of giftOwners) await syncClientGift(db, tenantId, cid).catch(() => {}); } catch { /* the cards are right; the total catches up */ } }
  // Loyalty: undoing the sale takes back what it earned and gives back any reward it used (lib/loyalty-server).
  if (rc0.checkoutSessionId) { try { const { reverseSale } = await import('@/lib/loyalty-server'); await reverseSale(db, tenantId, { saleId: String(rc0.checkoutSessionId), full: true, by: approvedBy || 'Void' }); } catch { /* best effort */ } }
  // Tuition: the Academy's ledger is add-only — a void ADDS a refund entry with the reason (after the rest is saved).
  for (const x of (Array.isArray(R.tuitionPayments) ? R.tuitionPayments : [])) { try { const { reverseTuitionPayment } = await import('@/lib/tuition-desk'); await reverseTuitionPayment(db, tenantId, x, reason, String(approvedBy || 'Front desk')); } catch (e) { console.error('[void] tuition', e); } }
  const warnings: string[] = [];
  for (const m of R.memberships || []) warnings.push(`${m.name || (m.type === 'membership' ? 'A membership' : 'A package')} was sold in this sale — cancel it from ${rc0.clientName || 'the client'}’s profile.`);
  await logAuditAdmin(db, tenantId, { action: 'checkout.voided', targetType: 'client', targetId: rc0.clientId || '', amount: num(rc0.total),
    summary: `Sale voided — ${rc0.clientName || 'client'} · ${money(rc0.total)} (${R.method}) — ${reason} · approved by ${approvedBy}${refunded ? ' · card refunded' : ''}${cashBack ? ` · ${money(cashBack)} cash handed back` : ''}`,
    actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
  try { const { takeBackForSale } = await import('@/lib/restocking-fund'); await takeBackForSale(db, tenantId, receiptId); } catch { /* best effort */ }
  // Rent / tuition taken on this sale no longer counts — tell the person whose account it was.
  try {
    const { sendReversalNotice } = await import('@/lib/account-receipts');
    for (const x of (Array.isArray(R.rentPayments) ? R.rentPayments : [])) {
      const e: any = x.entryId ? (await db.doc(`${T}/rentLedger/${x.entryId}`).get()).data() || {} : {};
      const cents = Math.abs(Number(e.amountCents) || 0); if (x.renterId && cents) await sendReversalNotice(db, tenantId, tenant, { kind: 'rent', id: x.renterId, amountCents: cents, paidOn: String(rc0.date || e.paidAt || now), details: 'Your rent balance is back to what it was before it.' });
    }
    for (const x of (Array.isArray(R.tuitionPayments) ? R.tuitionPayments : [])) if (x.planId && x.amountCents)
      await sendReversalNotice(db, tenantId, tenant, { kind: 'tuition', id: x.planId, amountCents: Number(x.amountCents), paidOn: String(rc0.date || now), details: 'Your tuition balance and schedule are back to what they were before it.' });
  } catch { /* the void stands either way */ }
  return NextResponse.json({ ok: true, refunded, cashToReturn: cashBack, tillNote, reopened: (R.visits || []).length, warnings, approvedBy });
}
