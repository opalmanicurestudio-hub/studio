// src/app/api/rent/change-credit/route.ts — "PUT THE CHANGE TOWARD THEIR NEXT RENT".
// A renter paid rent in cash and doesn't want the change back: it stays in the till and becomes credit that comes
// off their next rent invoice (never a tip). { tenantId, receiptId, renterId, cents }. Once per receipt.
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
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
  if (receipt.changeKeptAsRentCredit) return NextResponse.json({ ok: false, error: 'Already done for this sale.' }, { status: 409 });
  const renterId = String(b.renterId || ''); if (!renterId || !(await db.doc(`${T}/renters/${renterId}`).get()).exists) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });
  const now = new Date().toISOString(); const batch = db.batch(); const c = db.collection(`${T}/rentLedger`).doc();
  batch.set(c, { renterId, type: 'prepaid_credit', status: 'paid', amountCents: -cents, note: 'Change kept toward the next rent (cash at the front desk)', receiptId: rRef.id, createdAt: now, date: now, createdBy: auth.actor.name || null });
  batch.set(rRef, { changeKeptAsRentCredit: { cents, creditId: c.id, at: now, by: auth.actor.name || null } }, { merge: true });
  // The cash stays in the till, so the till expects it.
  if (receipt.tillId) batch.set(db.doc(`${T}/tillSessions/${receipt.tillId}`), { expectedCash: FieldValue.increment(cents / 100), totalCashSales: FieldValue.increment(cents / 100) }, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true, cents });
}
