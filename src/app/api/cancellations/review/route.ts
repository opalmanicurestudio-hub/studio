// src/app/api/cancellations/review/route.ts — DECIDE A SET-ASIDE CANCELLATION (owners & managers).
// Cancellations recorded before fees were charged inside the app sat untouched; anything older than 48 hours is set
// aside as 'needs_review' (lib/cancellation-events) instead of being charged out of the blue. Here the owner decides:
//   charge   → charge the card on file and tell the client (the normal path, now)
//   balance  → record it as owed — no charge, no message; marked so automatic collection never takes it (collect
//              it in person)
//   waive    → no fee, no message
// Every decision records who made it.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { processCancellationEvent } from '@/lib/cancellation-events';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const eventId = String(b.eventId || '').slice(0, 120);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!auth.actor?.isManager) return NextResponse.json({ ok: false, error: 'Only owners and managers can decide these.' }, { status: 403 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/cancellationEvents/${eventId}`);
  const ev: any = (await ref.get()).data();
  if (!ev) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  if (ev.status !== 'needs_review') return NextResponse.json({ ok: false, error: 'This one has already been decided.' }, { status: 409 });
  const who = { reviewedBy: auth.actor.name || auth.actor.uid, reviewedAt: new Date().toISOString() };
  const fee = Number(ev.feeAmount) || 0;

  if (b.action === 'waive') { await ref.update({ status: 'complete', chargeStatus: 'waived', ...who }); return NextResponse.json({ ok: true, result: 'waived' }); }

  if (b.action === 'balance') {
    if (fee <= 0) { await ref.update({ status: 'complete', chargeStatus: 'waived', ...who }); return NextResponse.json({ ok: true, result: 'waived' }); }
    const when = ev.createdAt || ev.appointmentStartTime || new Date().toISOString();
    const tx = db.collection(`${T}/transactions`).doc();
    const batch = db.batch();
    batch.set(tx, { id: tx.id, tenantId, appointmentId: ev.appointmentId || null, clientId: ev.clientId || null, clientName: ev.clientName || null, clientOrVendor: ev.clientName || null, type: 'income', context: 'Business',
      category: 'Cancellation Fee', taxBucket: 'revenue', amount: fee, amountCents: Math.round(fee * 100), status: 'balance_owed', notes: `Added to balance on review by ${who.reviewedBy}.`, createdAt: who.reviewedAt });
    if (ev.clientId) batch.update(db.doc(`${T}/clients/${ev.clientId}`), { outstandingBalance: FieldValue.increment(fee),
      unpaidFees: FieldValue.arrayUnion({ feeId: `cancel-${ev.appointmentId || eventId}`, appointmentId: ev.appointmentId || null, appointmentDate: when, feeAmount: fee, reason: 'Cancellation fee', autoCollect: false }) });   // the owner chose “no charge” — automatic collection leaves it alone
    batch.update(ref, { status: 'complete', chargeStatus: 'balance', ...who });
    await batch.commit(); return NextResponse.json({ ok: true, result: 'balance' });
  }

  if (b.action === 'charge') {
    if (!(fee > 0 && ev.paymentMethod === 'card_on_file' && ev.stripeCustomerId && ev.stripePaymentMethodId)) return NextResponse.json({ ok: false, error: 'There’s no card on file to charge — add it to their balance instead.' }, { status: 400 });
    await ref.update({ status: 'pending', ...who });   // back into the normal path, which charges once and tells the client
    const r = await processCancellationEvent(db, new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }), tenantId, eventId);
    return NextResponse.json({ ok: true, result: r.chargeStatus === 'charged' ? 'charged' : r.chargeStatus === 'failed' ? 'declined' : r.chargeStatus });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
