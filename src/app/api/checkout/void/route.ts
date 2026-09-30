// src/app/api/checkout/void/route.ts — VOID A WHOLE SALE (staff ask; a manager approves).
// Undoes everything that sale did, together — using the reversal record the checkout stored on its receipt:
//   every payment line reversed (originals kept, marked void) · stock returned · owed fees put back on whoever owed them ·
//   the deposit credit made available again · a package session / membership perk given back · discount-code and offer
//   use reversed · lifetime value taken back · the visit(s) reopened for a correct checkout · the till corrected.
// Card payments are refunded first (the client gets the refund message). CASH: the desk is told exactly how much to
// hand back and what happened to the till. Within the business's void window (same day, by default); after that it's a refund.
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

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), receiptId = String(b.receiptId || '');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const reason = String(b.reason || '').trim().slice(0, 300);
  if (!reason) return NextResponse.json({ ok: false, error: 'Say why the sale is being voided.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const rRef = db.doc(`${T}/receipts/${receiptId}`); const rc: any = (await rRef.get()).data();
  if (!rc) return NextResponse.json({ ok: false, error: 'That sale wasn’t found.' }, { status: 404 });
  if (rc.voided) return NextResponse.json({ ok: true, already: true });
  if (!rc.reversal) return NextResponse.json({ ok: false, error: 'This sale was recorded before whole-sale voids existed — void its lines one by one, or refund it.' }, { status: 409 });
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const R = rc.reversal;
  // The void window: the same day (default), or while that day's till is still open.
  const tz = tenant.timezone || undefined; const dayOf = (d: Date) => d.toLocaleDateString('en-US', { timeZone: tz });
  const windowRule = tenant?.voidRules?.window === 'till_open' ? 'till_open' : 'same_day';
  let till: any = null; if (R.tillId) till = ((await db.doc(`${T}/tillSessions/${R.tillId}`).get()).data() as any) || null;
  const inWindow = windowRule === 'till_open' ? (R.tillId ? till?.status === 'open' : dayOf(new Date(rc.date)) === dayOf(new Date())) : dayOf(new Date(rc.date)) === dayOf(new Date());
  if (!inWindow) return NextResponse.json({ ok: false, error: windowRule === 'till_open' ? 'That day’s till is closed — refund the sale instead.' : 'Sales can only be voided on the day — refund it instead.' }, { status: 409 });
  // A manager approves (signed in as a manager, or their PIN / phone approval for this sale).
  let approvedBy = auth.actor.name;
  if (!isApprover(auth.actor.role)) {
    const ok = await consumeApproval(db, tenantId, b.approvalToken, { kind: 'void', ref: receiptId });
    if (!ok) return NextResponse.json({ ok: false, error: 'Voiding a sale needs a manager’s approval.' }, { status: 403 });
    approvedBy = ok.approverName;
  }
  const now = new Date().toISOString();
  // ── Card: refund first (once — a retried void never refunds twice) ──
  let refunded = false;
  if (R.stripePaymentIntentId && !rc.voidRefundedAt) {
    refunded = await refundPaymentIntent(tenant.stripeAccountId || tenant.stripeConnectAccountId || null, String(R.stripePaymentIntentId));
    if (!refunded) return NextResponse.json({ ok: false, error: 'The card refund didn’t go through, so nothing was voided. Try again, or refund it from Stripe.' }, { status: 502 });
    await rRef.set({ voidRefundedAt: now }, { merge: true });
  } else if (rc.voidRefundedAt) refunded = true;
  if (Array.isArray(R.payments) && R.payments.length) {   // a split bill — every card share refunded, each only once
    const done: string[] = Array.isArray(rc.voidRefundedIds) ? rc.voidRefundedIds : [];
    for (const p of R.payments.filter((x: any) => x.stripePaymentIntentId && !done.includes(x.stripePaymentIntentId))) {
      const ok = await refundPaymentIntent(tenant.stripeAccountId || tenant.stripeConnectAccountId || null, String(p.stripePaymentIntentId));
      if (!ok) return NextResponse.json({ ok: false, error: `The refund for one card share (${money(p.amount)}) didn’t go through, so nothing was voided. Try again — cards already refunded won’t be refunded twice.` }, { status: 502 });
      done.push(p.stripePaymentIntentId); await rRef.set({ voidRefundedIds: done }, { merge: true });
    }
    refunded = R.payments.some((x: any) => x.stripePaymentIntentId);
  }

  const batch = db.batch();
  // Payment lines: originals marked void, one reversing line each (same shape as a single-line void).
  const lines = (await db.collection(`${T}/transactions`).where('checkoutSessionId', '==', rc.checkoutSessionId).get()).docs;
  const cardLines = R.stripePaymentIntentId ? (await db.collection(`${T}/transactions`).where('stripePaymentIntentId', '==', String(R.stripePaymentIntentId)).get()).docs : [];
  const seen = new Set<string>();
  for (const d of [...lines, ...cardLines]) {
    const t: any = d.data(); if (seen.has(d.id) || t.voided || t.category === 'Void') continue; seen.add(d.id);
    batch.set(d.ref, { voided: true, voidedAt: now, voidedBy: approvedBy, voidReason: reason }, { merge: true });
    const rv = db.collection(`${T}/transactions`).doc();
    batch.set(rv, { id: rv.id, date: now, description: `VOID: ${t.description || ''}`, clientOrVendor: t.clientOrVendor || null, clientId: t.clientId || null, type: t.type === 'income' ? 'expense' : 'income', context: 'Business', category: 'Void', taxBucket: 'refund', amount: num(t.amount), paymentMethod: t.paymentMethod || null, voidOf: d.id, notes: reason, hasReceipt: false, tenantId, checkoutSessionId: rc.checkoutSessionId, voidOfSale: receiptId });
  }
  // Stock back on the shelf.
  for (const p of R.products || []) {
    batch.set(db.doc(`${T}/inventory/${p.id}`), { totalStock: FieldValue.increment(num(p.quantity)) }, { merge: true });
    const sc = db.collection(`${T}/stockCorrections`).doc();
    batch.set(sc, { productId: p.id, date: now, change: num(p.quantity), unit: 'units', reason: `Void: ${p.name || 'item'} (sale for ${rc.clientName || 'a client'})`, actorId: auth.actor.uid || 'staff', actorName: approvedBy, source: 'stock_ledger', type: 'returned', field: 'totalStock', refKind: 'void', refId: receiptId });
  }
  // Owed fees back on whoever owed them.
  const feesByOwner: Record<string, any[]> = {};
  for (const f of R.fees || []) (feesByOwner[f.owner] = feesByOwner[f.owner] || []).push(f);
  for (const [owner, list] of Object.entries(feesByOwner)) batch.set(db.doc(`${T}/clients/${owner}`), { unpaidFees: FieldValue.arrayUnion(...list.map((f: any) => f.fee || { feeId: f.feeId, feeAmount: f.feeAmount, reason: f.reason })), outstandingBalance: FieldValue.increment(list.reduce((s: number, f: any) => s + num(f.feeAmount), 0)) }, { merge: true });
  // The deposit credit, available again.
  if (R.depositCreditId) batch.set(db.doc(`${T}/depositCredits/${R.depositCreditId}`), { status: 'available', consumedAt: null, appointmentId: null, restoredByVoid: receiptId }, { merge: true });
  // A package session / perk given back.
  if (R.redeemed?.clientId) {
    const c: any = ((await db.doc(`${T}/clients/${R.redeemed.clientId}`).get()).data() as any) || {};
    if (R.redeemed.type === 'package') {
      const list: any[] = Array.isArray(c.activePackages) ? c.activePackages : [];
      const has = list.some((p: any) => p.packageId === R.redeemed.id);
      batch.set(db.doc(`${T}/clients/${R.redeemed.clientId}`), { activePackages: has ? list.map((p: any) => (p.packageId === R.redeemed.id ? { ...p, sessionsRemaining: num(p.sessionsRemaining) + 1 } : p)) : [...list, { packageId: R.redeemed.id, sessionsRemaining: 1, restoredByVoid: receiptId }] }, { merge: true });
    } else batch.set(db.doc(`${T}/clients/${R.redeemed.clientId}`), { subscription: { perkUsage: { [String(R.redeemed.itemId)]: FieldValue.increment(-1) } } }, { merge: true });
  }
  // This month's team / family discount use given back.
  if (R.groupDiscount?.clientId && num(R.groupDiscount.amount) > 0) { const gc: any = ((await db.doc(`${T}/clients/${R.groupDiscount.clientId}`).get()).data() as any) || {};
    if (gc.teamDiscountUsage?.month === R.groupDiscount.month) batch.set(db.doc(`${T}/clients/${R.groupDiscount.clientId}`), { teamDiscountUsage: { amount: FieldValue.increment(-num(R.groupDiscount.amount)) } }, { merge: true }); }
  // A birthday / milestone treat given back (so it can be used again).
  if (R.momentKey && rc.clientId) batch.update(db.doc(`${T}/clients/${rc.clientId}`), { [`momentRewards.${R.momentKey}`]: FieldValue.delete() });
  // Discount-code use reversed.
  for (const id of R.discountIds || []) batch.set(db.doc(`${T}/discounts/${id}`), { usageCount: FieldValue.increment(-1) }, { merge: true });
  // Lifetime value taken back.
  for (const [cid, amt] of Object.entries(R.spend || {})) if (num(amt) > 0) batch.set(db.doc(`${T}/clients/${cid}`), { lifetimeValue: FieldValue.increment(-num(amt)) }, { merge: true });
  // The visit(s) reopened, so they can be checked out correctly.
  for (const v of R.visits || []) {
    const back = ['completed', 'paid', ''].includes(String(v.statusBefore || '')) ? 'checked_in' : v.statusBefore;
    batch.set(db.doc(`${T}/appointments/${v.id}`), { status: back, checkoutSessionId: null, revenue: 0, voidedSale: receiptId, reopenedAt: now }, { merge: true });
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
  batch.set(rRef, { voided: true, voidedAt: now, voidedBy: approvedBy, requestedBy: auth.actor.name, voidReason: reason, ...(refunded ? { voidRefunded: true } : {}), ...(cashBack ? { cashReturned: cashBack } : {}) }, { merge: true });
  try { await batch.commit(); }
  catch (e: any) { console.error('[void] save failed', e); return NextResponse.json({ ok: false, error: refunded ? 'The card was refunded, but the records didn’t update — press Void again (it won’t refund twice).' : 'The void didn’t save — nothing changed. Please try again.' }, { status: 500 }); }
  const warnings: string[] = [];
  for (const m of R.memberships || []) warnings.push(`${m.name || (m.type === 'membership' ? 'A membership' : 'A package')} was sold in this sale — cancel it from ${rc.clientName || 'the client'}’s profile.`);
  await logAuditAdmin(db, tenantId, { action: 'checkout.voided', targetType: 'client', targetId: rc.clientId || '', amount: num(rc.total),
    summary: `Sale voided — ${rc.clientName || 'client'} · ${money(rc.total)} (${R.method}) — ${reason} · approved by ${approvedBy}${refunded ? ' · card refunded' : ''}${cashBack ? ` · ${money(cashBack)} cash handed back` : ''}`,
    actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
  return NextResponse.json({ ok: true, refunded, cashToReturn: cashBack, tillNote, reopened: (R.visits || []).length, warnings, approvedBy });
}
