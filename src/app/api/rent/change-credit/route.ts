// src/app/api/rent/change-credit/route.ts — "PUT THE CHANGE TOWARD THEIR NEXT PAYMENT" (rent or tuition).
// Someone paid an account in cash and doesn't want the change back: the cash stays in the till and is applied like any
// other payment — rent pays off anything still owed first, then becomes credit off the next rent; tuition goes toward
// the next instalment. Never a tip. Recorded in the books and the till. Once per sale.
//   { tenantId, receiptId, cents, kind: 'rent', renterId } | { …, kind: 'tuition', planId }
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { renterAccount, applyRentPayment } from '@/lib/rent-desk';
import { tuitionAccount, applyTuitionPayment } from '@/lib/tuition-desk';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const cents = Math.round(Number(b.cents) || 0);
  const rRef = db.doc(`${T}/receipts/${String(b.receiptId || '')}`); const receipt: any = (await rRef.get()).data();
  if (!receipt) return NextResponse.json({ ok: false, error: 'That sale wasn’t found.' }, { status: 404 });
  const changeCents = Math.round((Number(receipt.amountTendered) || 0) * 100 - Math.round(((Number(receipt.total) || 0) - (Number(receipt.depositUsed) || 0)) * 100));
  if (!(cents > 0) || cents > Math.max(changeCents, 0) + 1) return NextResponse.json({ ok: false, error: 'That’s more than the change due.' }, { status: 400 });
  if (receipt.changeKeptAsRentCredit || receipt.changeKept) return NextResponse.json({ ok: false, error: 'Already done for this sale.' }, { status: 409 });
  const now = new Date().toISOString(); const by = auth.actor.name || 'Front desk'; const tx = db.collection(`${T}/transactions`).doc();
  let label = '';
  if (b.kind === 'tuition') {
    const acct: any = await tuitionAccount(db, tenantId, String(b.planId || '')); if (!acct) return NextResponse.json({ ok: false, error: 'Tuition plan not found.' }, { status: 404 });
    if (cents > acct.balanceCents) return NextResponse.json({ ok: false, error: `That’s more than their remaining tuition (${(acct.balanceCents / 100).toFixed(2)}) — hand it back.` }, { status: 400 });
    await applyTuitionPayment(db, tenantId, acct, { amountCents: cents, method: 'cash (change kept)', receiptId: rRef.id, by, apply: 'ahead' });
    await tx.set({ id: tx.id, type: 'income', context: 'Business', category: 'Tuition', taxBucket: 'revenue', amount: cents / 100, date: now, createdAt: now, tenantId,
      description: `Tuition — change kept toward the next instalment (${acct.name})`, clientOrVendor: acct.name, paymentMethod: 'cash', receiptId: rRef.id, hasReceipt: true });
    label = 'tuition';
  } else {
    const renterId = String(b.renterId || ''); const acct: any = renterId ? await renterAccount(db, T, renterId) : null;
    if (!acct) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });
    const batch = db.batch();
    applyRentPayment(batch, db, T, acct, { amountCents: cents, method: 'cash (change kept)', receiptId: rRef.id, transactionId: tx.id, now, by });   // pays off anything still owed first, then credit
    batch.set(tx, { id: tx.id, type: 'income', context: 'Business', category: 'Booth Rent', taxBucket: 'revenue', amount: cents / 100, date: now, createdAt: now, tenantId,
      description: `Rent — change kept toward the next rent (${acct.name})`, clientOrVendor: acct.name, paymentMethod: 'cash', receiptId: rRef.id, hasReceipt: true });
    await batch.commit(); label = 'rent';
  }
  await rRef.set({ changeKept: { cents, toward: label, transactionId: tx.id, at: now, by } }, { merge: true });
  // The cash stays in the till, so the till expects it.
  if (receipt.tillId) await db.doc(`${T}/tillSessions/${receipt.tillId}`).set({ expectedCash: FieldValue.increment(cents / 100), totalCashSales: FieldValue.increment(cents / 100) }, { merge: true });
  try { const { sendAccountReceipt } = await import('@/lib/account-receipts'); const tenant: any = (await db.doc(T).get()).data() || {};
    if (label === 'tuition') { const acct: any = await tuitionAccount(db, tenantId, String(b.planId || '')); await sendAccountReceipt(db, tenantId, tenant, { kind: 'tuition', id: String(b.planId), amountCents: cents, remainingCents: acct?.balanceCents || 0 }); }
    else { const acct: any = await renterAccount(db, T, String(b.renterId || '')); await sendAccountReceipt(db, tenantId, tenant, { kind: 'rent', id: String(b.renterId), amountCents: cents, owedAfterCents: acct?.usesInvoices ? acct.invoiceOwedCents : acct?.owedCents || 0 }); }
  } catch { /* the credit stands either way */ }
  return NextResponse.json({ ok: true, cents, toward: label });
}
