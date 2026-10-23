// src/app/api/rent/change-credit/route.ts — "PUT THE CHANGE TOWARD THEIR NEXT PAYMENT" (rent or tuition).
// Someone paid an account in cash and doesn't want the change back: the cash stays in the till and is applied like any
// other payment — rent pays off anything still owed first, then becomes credit off the next rent; tuition goes toward
// the next instalment. Never a tip. Recorded in the books and the till. Once per sale:
//   rent — the payment, its line in the books (named after the sale), the till and the sale's note that it's done are
//          written in one step that first checks it isn't done yet, and reads the renter's open invoices and charges as
//          they are then (so change from two sales at the same moment can't both count against one invoice);
//   tuition — the Academy's ledger is written on its own, so the sale is claimed first (a second tap is told it's under
//          way), the payment goes on the student's ledger, then the line in the books, the till and the sale's note are
//          written in one step. A claim left by a try that never finished can be taken over after two minutes; the
//          payment that try already put on the ledger is found and not added again.
//   { tenantId, receiptId, cents, kind: 'rent', renterId } | { …, kind: 'tuition', planId }
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { renterAccount, applyRentPayment } from '@/lib/rent-desk';
import { tuitionAccount, applyTuitionPayment } from '@/lib/tuition-desk';
export const dynamic = 'force-dynamic';

const CLAIM_MS = 2 * 60000;
const freshClaim = (at: any) => !!at && Date.now() - (Date.parse(String(at)) || 0) < CLAIM_MS;
const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const KEPT = 'cash (change kept)';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const cents = Math.round(Number(b.cents) || 0);
  const rRef = db.doc(`${T}/receipts/${String(b.receiptId || '')}`); const receipt: any = (await rRef.get()).data();
  if (!receipt) return NextResponse.json({ ok: false, error: 'That sale wasn’t found.' }, { status: 404 });
  const changeCents = Math.round((Number(receipt.amountTendered) || 0) * 100 - Math.round(((Number(receipt.total) || 0) - (Number(receipt.depositUsed) || 0)) * 100));
  // Done already (a second tap, or asked again after the answer was lost): what was kept, nothing more.
  const doneAnswer = (r: any) => (r.changeKept ? NextResponse.json({ ok: true, already: true, cents: Number(r.changeKept.cents) || 0, toward: r.changeKept.toward || null })
    : NextResponse.json({ ok: false, error: 'Already done for this sale.' }, { status: 409 }));
  if (receipt.changeKept || receipt.changeKeptAsRentCredit) return doneAnswer(receipt);
  if (!(cents > 0) || cents > Math.max(changeCents, 0) + 1) return NextResponse.json({ ok: false, error: 'That’s more than the change due.' }, { status: 400 });
  const now = new Date().toISOString(); const by = auth.actor.name || 'Front desk';
  const lineRef = db.doc(`${T}/transactions/change_kept_${safe(rRef.id)}`);
  const busy = () => NextResponse.json({ ok: false, error: 'The change for this sale is being saved already. Give it a moment.' }, { status: 409 });
  // The cash stays in the till, so the till expects it (written with the rest, once).
  const tillWrite = (tx: any, r: any, c: number) => { if (r.tillId) tx.set(db.doc(`${T}/tillSessions/${r.tillId}`), { expectedCash: FieldValue.increment(c / 100), totalCashSales: FieldValue.increment(c / 100) }, { merge: true }); };
  let label = ''; let keptCents = cents;
  if (b.kind === 'tuition') {
    const planId = String(b.planId || '');
    const acct: any = await tuitionAccount(db, tenantId, planId); if (!acct) return NextResponse.json({ ok: false, error: 'Tuition plan not found.' }, { status: 404 });
    // 1. Claimed: this sale's change is going toward this plan, by this request.
    const claim: any = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(rRef)).data() || {};
      if (cur.changeKept || cur.changeKeptAsRentCredit) return { done: cur };
      if (cur.changeKeepClaimAt && (freshClaim(cur.changeKeepClaimAt) || cur.changeKeepClaim?.kind !== 'tuition' || cur.changeKeepClaim?.planId !== planId)) return { busy: true };
      const takeover = !!cur.changeKeepClaimAt;   // an earlier try that never finished: it may have put the payment on the ledger
      const amount = takeover ? Number(cur.changeKeepClaim?.cents) || cents : cents;
      tx.set(rRef, { changeKeepClaimAt: now, changeKeepClaim: { kind: 'tuition', planId, cents: amount, by } }, { merge: true });
      return { takeover, amount };
    });
    if (claim.done) return doneAnswer(claim.done);
    if (claim.busy) return busy();
    const amount = Number(claim.amount) || cents;
    const release = () => db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(rRef)).data() || {}; if (!cur.changeKept && cur.changeKeepClaimAt === now) tx.set(rRef, { changeKeepClaimAt: FieldValue.delete(), changeKeepClaim: FieldValue.delete() }, { merge: true }); }).catch(() => {});
    // 2. On the student's ledger — unless the try that left the claim already put it there.
    const onLedger = claim.takeover && (await db.collection(`${T}/tuitionEntries`).where('planId', '==', planId).where('ref', '==', rRef.id).get()).docs
      .some((d: any) => { const e: any = d.data() || {}; return e.type === 'payment' && String(e.desc || '').includes(KEPT); });
    if (!onLedger) {
      if (amount > acct.balanceCents) { await release(); return NextResponse.json({ ok: false, error: `That’s more than their remaining tuition (${(acct.balanceCents / 100).toFixed(2)}) — hand it back.` }, { status: 400 }); }
      try { await applyTuitionPayment(db, tenantId, acct, { amountCents: amount, method: KEPT, receiptId: rRef.id, by, apply: 'ahead' }); }
      catch (e) { console.error('[change-credit] tuition', e); await release(); return NextResponse.json({ ok: false, error: 'That didn’t save — nothing changed. Please try again.' }, { status: 500 }); }
    }
    // 3. The books, the till and the sale's note, once.
    const wrote = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(rRef)).data() || {}; const line = await tx.get(lineRef);
      if (cur.changeKept || line.exists) return false;
      tx.set(lineRef, { id: lineRef.id, type: 'income', context: 'Business', category: 'Tuition', taxBucket: 'revenue', amount: amount / 100, date: now, createdAt: now, tenantId,
        description: `Tuition — change kept toward the next instalment (${acct.name})`, clientOrVendor: acct.name, paymentMethod: 'cash', receiptId: rRef.id, hasReceipt: true });
      tx.set(rRef, { changeKept: { cents: amount, toward: 'tuition', transactionId: lineRef.id, at: now, by }, changeKeepClaimAt: FieldValue.delete(), changeKeepClaim: FieldValue.delete() }, { merge: true });
      tillWrite(tx, cur, amount);
      return true;
    });
    if (!wrote) { const r: any = (await rRef.get()).data() || {}; return r.changeKept ? doneAnswer(r) : NextResponse.json({ ok: true, already: true, cents: amount, toward: 'tuition' }); }
    label = 'tuition'; keptCents = amount;
  } else {
    const renterId = String(b.renterId || ''); const acct0: any = renterId ? await renterAccount(db, T, renterId) : null;
    if (!acct0) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });
    // All in one step that first checks the change isn't already kept: pays off anything still owed first, then credit.
    // The renter's open invoices and charges are read in the same step, as they are now, so change from two sales put
    // toward this renter at the same moment can't both count against the same invoice: the second step runs again with
    // what the first one paid.
    const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const out: any = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(rRef)).data() || {};
      const inv: any[] = []; for (const i of acct0.invoices || []) { const s = await tx.get(db.doc(`${T}/rentInvoices/${i.id}`)); if (s.exists) inv.push({ id: s.id, ...(s.data() || {}) }); }
      const chg: any[] = []; for (const e of acct0.unpaid || []) { const s = await tx.get(db.doc(`${T}/rentLedger/${e.id}`)); if (s.exists) chg.push({ id: s.id, ...(s.data() || {}) }); }
      if (cur.changeKept || cur.changeKeptAsRentCredit) return { done: cur };
      if (cur.changeKeepClaimAt) return { busy: true };
      // What's still owed on each, worked out as lib/rent-desk does: invoices due or late with something left on them
      // (oldest first), and charges not yet settled.
      const invoices = inv.filter((i) => ['due', 'late'].includes(String(i.status || ''))).map((i) => ({ ...i, owedCents: Math.max(0, n(i.amountCents) + n(i.lateFeeCents) - n(i.paidCents)) })).filter((i) => i.owedCents > 0);
      const unpaid = chg.filter((e) => n(e.amountCents) > 0 && !['paid', 'waived', 'refunded', 'voided'].includes(String(e.status || '')));
      const acct = { ...acct0, invoices, unpaid };
      applyRentPayment(tx, db, T, acct, { amountCents: cents, method: KEPT, receiptId: rRef.id, transactionId: lineRef.id, now, by });
      tx.set(lineRef, { id: lineRef.id, type: 'income', context: 'Business', category: 'Booth Rent', taxBucket: 'revenue', amount: cents / 100, date: now, createdAt: now, tenantId,
        description: `Rent — change kept toward the next rent (${acct.name})`, clientOrVendor: acct.name, paymentMethod: 'cash', receiptId: rRef.id, hasReceipt: true });
      tx.set(rRef, { changeKept: { cents, toward: 'rent', transactionId: lineRef.id, at: now, by } }, { merge: true });
      tillWrite(tx, cur, cents);
      return { ok: true };
    });
    if (out.done) return doneAnswer(out.done);
    if (out.busy) return busy();
    label = 'rent';
  }
  try { const { sendAccountReceipt } = await import('@/lib/account-receipts'); const tenant: any = (await db.doc(T).get()).data() || {};
    if (label === 'tuition') { const acct: any = await tuitionAccount(db, tenantId, String(b.planId || '')); await sendAccountReceipt(db, tenantId, tenant, { kind: 'tuition', id: String(b.planId), amountCents: keptCents, remainingCents: acct?.balanceCents || 0 }); }
    else { const acct: any = await renterAccount(db, T, String(b.renterId || '')); await sendAccountReceipt(db, tenantId, tenant, { kind: 'rent', id: String(b.renterId), amountCents: keptCents, owedAfterCents: acct?.usesInvoices ? acct.invoiceOwedCents : acct?.owedCents || 0 }); }
  } catch { /* the credit stands either way */ }
  return NextResponse.json({ ok: true, cents: keptCents, toward: label });
}
