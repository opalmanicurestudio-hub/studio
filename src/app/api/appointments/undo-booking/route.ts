// src/app/api/appointments/undo-booking/route.ts — UNDO A BOOKING JUST MADE AT THE DESK.
// For a mis-tapped date or the wrong service: it's as if the booking never happened — no cancellation, no fee, no
// "you cancelled" message. Only for a booking made at the desk in the last 30 minutes that hasn't started (so it
// can never be used to dodge a cancellation fee). A deposit taken for it goes back: card → refunded; cash → staff
// are told how much to hand back. The client — who just got a confirmation — gets one short "it's been removed" note.
// Once, however often it's asked: the booking and its deposit are claimed in one step (a second tap is told it's under
// way, and a sale can't use the deposit while it goes back; a deposit already used isn't refunded from here), the
// refund has one key for the booking, and the records are written once, named after the booking (lib/undo-booking).
// An undo whose answer from Stripe was lost and isn't asked again is finished or let go by the five-minute check.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { recordWaitingReaderDeposit } from '@/lib/reader-deposit';
import { creditAmountCents, creditLeftCents } from '@/lib/credit-pools';
import { finishUndo, releaseUndo, tellUndone, undoEnded, undoMark, undoPiFor } from '@/lib/undo-booking';
import { stripeRefused as saidNo } from '@/lib/stripe-said-no';
export const dynamic = 'force-dynamic';

const DESK_SOURCES = ['front_desk', 'planner', 'pos_add_appointment', 'staff', 'admin', 'add_appointment', 'staff_portal'];
const UNDO_WINDOW_MS = 30 * 60000;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const appointmentId = String(b.appointmentId || '').slice(0, 120);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/appointments/${appointmentId}`);
  let a: any = (await ref.get()).data();
  if (!a) return NextResponse.json({ ok: false, error: 'That booking wasn’t found.' }, { status: 404 });
  // Undone already (a second tap, or asked again after the answer was lost): nothing more happens.
  if (a.undoneAt) return NextResponse.json({ ok: true, already: true, refundedCents: a.depositStatus === 'refunded' ? Number(a.depositReturnedCents) || 0 : 0, handBackCents: a.depositStatus === 'returned' ? Number(a.depositReturnedCents) || 0 : 0 });
  // A deposit taken on the card reader that the screen never confirmed is recorded first, so it's refunded with the rest.
  if (a.depositReaderPi?.id && a.depositStatus !== 'paid') {
    const r = await recordWaitingReaderDeposit(db, tenantId, { id: appointmentId, ...a }, { actorName: auth.actor?.name || null, origin: req.nextUrl.origin }).catch(() => null);
    if (r?.ok) a = (await ref.get()).data() || a;
  }
  // Paid twice: one payment is refunded from the booking first, so each goes back the way it came.
  if (a.needsAttention === 'deposit_paid_twice') return NextResponse.json({ ok: false, error: 'This deposit was paid twice. Refund one of the payments from the booking first, then undo it.' }, { status: 409 });
  const made = Date.parse(a.createdAt || a.bookedAt || '');
  if (!DESK_SOURCES.includes(String(a.source || '')) || !Number.isFinite(made) || Date.now() - made > UNDO_WINDOW_MS)
    return NextResponse.json({ ok: false, error: 'Undo is only for a booking made here in the last 30 minutes — cancel it from the planner instead.' }, { status: 409 });
  if (undoEnded(a.status) || Date.parse(a.startTime || '') <= Date.now())
    return NextResponse.json({ ok: false, error: 'This booking has already started or changed — cancel it from the planner instead.' }, { status: 409 });
  const now = new Date().toISOString(); const tenant: any = (await db.doc(T).get()).data() || {};
  const cents = a.depositStatus === 'paid' && Number(a.depositAmountCents) > 0 ? Number(a.depositAmountCents) : 0;
  const mark = undoMark(appointmentId);
  const creditDocs = cents ? (await db.collection(`${T}/depositCredits`).where('sourceAppointmentId', '==', appointmentId).get()).docs : [];

  // 1. Claimed, in one step: the booking (two taps undo it once) and its deposit (set aside while it goes back).
  const claim: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const cs: any[] = []; for (const d of creditDocs) cs.push(await tx.get(d.ref));
    if (cur.undoneAt) return { already: true };
    if (undoEnded(cur.status)) return { error: 'This booking has already started or changed — cancel it from the planner instead.' };
    if (cur.undoClaim && Date.now() - (Date.parse(String(cur.undoClaim)) || 0) < 2 * 60000) return { error: 'This booking is being undone already. Give it a moment.' };
    for (const x of cs) {
      const c: any = x.data() || {}; const mine = c.status === 'refunding' && c.refundingFor === mark;
      if (!mine && (c.status !== 'available' || creditLeftCents(c) < creditAmountCents(c))) return { error: 'This deposit has been used on a sale, or refunded — cancel the booking from the planner instead.' };
    }
    tx.set(ref, { undoClaim: now }, { merge: true });
    for (const x of cs) tx.set(x.ref, { status: 'refunding', refundingFor: mark, refundingAt: now, refundingCents: creditLeftCents(x.data() || {}) }, { merge: true });
    return { ok: true };
  });
  if (claim.already) return NextResponse.json({ ok: true, already: true, refundedCents: 0, handBackCents: 0 });
  if (claim.error) return NextResponse.json({ ok: false, error: claim.error }, { status: 409 });
  const release = () => releaseUndo(db, tenantId, appointmentId, creditDocs, now);

  // A deposit taken for it goes back — through the payment that took it — with a refund record in the books and,
  // when it was paid on a sale, a refund line on that sale's receipt.
  let refundedCents = 0, handBackCents = 0;
  const receiptRef = cents && a.depositReceiptId ? db.doc(`${T}/receipts/${a.depositReceiptId}`) : null;
  const receipt: any = receiptRef ? (await receiptRef.get()).data() : null;
  if (cents) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any });
    // Which card payment to refund: a deposit charged on its own (or taken on the card reader), or this sale's card
    // payment (or a card share of a split).
    const pi = undoPiFor(a, receipt, cents);
    if (pi && tenant.stripeAccountId) {
      const opts = { stripeAccount: tenant.stripeAccountId, idempotencyKey: `undo-${tenantId}-${appointmentId}` };
      const asBefore = { payment_intent: pi, amount: cents, reason: 'requested_by_customer' as const, metadata: { tenantId, appointmentId, why: 'booking undone at the desk' } };
      try {
        // The app's mark and the deposit's id go with it; a retry of one first sent without them is sent as it was then.
        try { await stripe.refunds.create({ ...asBefore, metadata: { ...asBefore.metadata, origin: 'app', ...(creditDocs.length === 1 ? { depositCreditId: creditDocs[0].id } : {}) } }, opts); }
        catch (k: any) { if (String(k?.type || '') !== 'StripeIdempotencyError') throw k; await stripe.refunds.create(asBefore, opts); }
        refundedCents = cents;
      } catch (e: any) {
        // Stripe said no: the booking and its deposit are as they were. No answer: they stay set aside, and undoing
        // it again in a moment finishes it (the same refund, never a second).
        const refused = saidNo(e);
        if (refused) { await release(); return NextResponse.json({ ok: false, error: `The deposit couldn’t be refunded (${String(e?.message || 'card error').slice(0, 80)}) — nothing was changed.` }, { status: 502 }); }
        return NextResponse.json({ ok: false, error: 'Stripe didn’t answer, so the deposit refund may or may not have gone through. Undo it again in a couple of minutes: it won’t refund twice.' }, { status: 502 });
      }
    } else handBackCents = cents;
  }
  // Cash paid at the desk with no sale went into the open till; handing it back takes it out again.
  const openTill = cents && !refundedCents && !receipt && a.depositPaidMethod === 'Cash' ? (await db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(1).get()).docs[0] || null : null;

  // 2. The records, once (named after the booking): the refund in the books, the deposit closed, the refund ticket on
  //    the sale it was paid on, cash out of the till, and the booking undone.
  const by = auth.actor.name || 'Front desk';
  const wrote = await finishUndo(db, tenantId, appointmentId, { a, cents, refundedCents, handBackCents, creditDocs, receiptRef, openTill, by, at: now });
  if (!wrote) return NextResponse.json({ ok: true, already: true, refundedCents, handBackCents });
  await logAuditAdmin(db, tenantId, { action: 'appointment.undone', targetType: 'appointment', targetId: appointmentId,
    summary: `Booking undone at the desk${refundedCents ? ` — $${(refundedCents / 100).toFixed(2)} deposit refunded` : handBackCents ? ` — hand back $${(handBackCents / 100).toFixed(2)} cash deposit` : ''}`,
    actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role, via: 'front desk' } } as any).catch(() => null);
  // One short note — they've just had a confirmation for it.
  await tellUndone(db, tenantId, tenant, a, refundedCents);
  return NextResponse.json({ ok: true, refundedCents, handBackCents });
}
