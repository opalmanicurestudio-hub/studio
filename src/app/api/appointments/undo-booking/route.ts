// src/app/api/appointments/undo-booking/route.ts — UNDO A BOOKING JUST MADE AT THE DESK.
// For a mis-tapped date or the wrong service: it's as if the booking never happened — no cancellation, no fee, no
// "you cancelled" message. Only for a booking made at the desk in the last 30 minutes that hasn't started (so it
// can never be used to dodge a cancellation fee). A deposit taken for it goes back: card → refunded; cash → staff
// are told how much to hand back. The client — who just got a confirmation — gets one short "it's been removed" note.
// Once, however often it's asked: the booking and its deposit are claimed in one step (a second tap is told it's under
// way, and a sale can't use the deposit while it goes back; a deposit already used isn't refunded from here), the
// refund has one key for the booking, and the records are written once, named after the booking.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { recordWaitingReaderDeposit } from '@/lib/reader-deposit';
import { creditAmountCents, creditLeftCents } from '@/lib/credit-pools';
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
  if (['cancelled', 'canceled', 'completed', 'checked_in', 'in_service', 'no_show'].includes(String(a.status || '')) || Date.parse(a.startTime || '') <= Date.now())
    return NextResponse.json({ ok: false, error: 'This booking has already started or changed — cancel it from the planner instead.' }, { status: 409 });
  const now = new Date().toISOString(); const tenant: any = (await db.doc(T).get()).data() || {};
  const cents = a.depositStatus === 'paid' && Number(a.depositAmountCents) > 0 ? Number(a.depositAmountCents) : 0;
  const mark = `undo_${appointmentId}`;
  const creditDocs = cents ? (await db.collection(`${T}/depositCredits`).where('sourceAppointmentId', '==', appointmentId).get()).docs : [];
  const ended = (st: any) => ['cancelled', 'canceled', 'completed', 'checked_in', 'in_service', 'no_show'].includes(String(st || ''));

  // 1. Claimed, in one step: the booking (two taps undo it once) and its deposit (set aside while it goes back).
  const claim: any = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const cs: any[] = []; for (const d of creditDocs) cs.push(await tx.get(d.ref));
    if (cur.undoneAt) return { already: true };
    if (ended(cur.status)) return { error: 'This booking has already started or changed — cancel it from the planner instead.' };
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
  const release = async () => { await db.runTransaction(async (tx: any) => {
    const cs: any[] = []; for (const d of creditDocs) cs.push(await tx.get(d.ref));
    tx.set(ref, { undoClaim: FieldValue.delete() }, { merge: true });
    for (const x of cs) if ((x.data() || {}).refundingFor === mark) tx.set(x.ref, { status: 'available', refundingFor: null, refundingAt: null, refundingCents: null }, { merge: true });
  }).catch(() => {}); };

  // A deposit taken for it goes back — through the payment that took it — with a refund record in the books and,
  // when it was paid on a sale, a refund line on that sale's receipt.
  let refundedCents = 0, handBackCents = 0;
  const receiptRef = cents && a.depositReceiptId ? db.doc(`${T}/receipts/${a.depositReceiptId}`) : null;
  const receipt: any = receiptRef ? (await receiptRef.get()).data() : null;
  if (cents) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any });
    // Which card payment to refund: a deposit charged on its own, or this sale's card payment (or a card share of a split).
    const piFor = (): string | null => {
      // Charged to the saved card, or taken on the card reader: refunded through that payment.
      if (a.depositPaidVia === 'card_on_file' || a.depositPaidVia === 'card_reader') return a.depositStripePaymentIntentId || a.stripePaymentIntentId || null;
      if (!receipt) return null;
      if (Array.isArray(receipt.payments)) { const share = receipt.payments.find((x: any) => x.stripePaymentIntentId && (Number(x.amount) || 0) * 100 >= cents); return share?.stripePaymentIntentId || null; }
      return receipt.paymentMethod !== 'cash' ? receipt.stripePaymentIntentId || null : null;
    };
    const pi = piFor();
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
        const refused = ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'].includes(String(e?.type || ''));
        if (refused) { await release(); return NextResponse.json({ ok: false, error: `The deposit couldn’t be refunded (${String(e?.message || 'card error').slice(0, 80)}) — nothing was changed.` }, { status: 502 }); }
        return NextResponse.json({ ok: false, error: 'Stripe didn’t answer, so the deposit refund may or may not have gone through. Undo it again in a couple of minutes: it won’t refund twice.' }, { status: 502 });
      }
    } else handBackCents = cents;
  }
  // Cash paid at the desk with no sale went into the open till; handing it back takes it out again.
  const openTill = cents && !refundedCents && !receipt && a.depositPaidMethod === 'Cash' ? (await db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(1).get()).docs[0] || null : null;

  // 2. The records, once (named after the booking): the refund in the books, the deposit closed, the refund ticket on
  //    the sale it was paid on, cash out of the till, and the booking undone.
  const lineRef = db.doc(`${T}/transactions/${mark.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 140)}`);
  const wrote = await db.runTransaction(async (tx: any) => {
    const line = await tx.get(lineRef); const cur: any = (await tx.get(ref)).data() || {};
    const cs: any[] = []; for (const d of creditDocs) cs.push(await tx.get(d.ref));
    const rs = receiptRef ? await tx.get(receiptRef) : null;
    if (line.exists || cur.undoneAt) return false;
    if (cents) {
      tx.set(lineRef, { id: lineRef.id, type: 'reversal', context: 'Business', taxBucket: 'refund', category: 'Refunds', amount: cents / 100, date: now, createdAt: now, tenantId,
        description: `Refund — deposit for a booking undone at the desk (${a.clientName || 'client'})`, clientOrVendor: a.clientName || 'Client', clientId: a.clientId || null,
        paymentMethod: refundedCents ? 'Card (Stripe refund)' : 'Cash handed back', appointmentId, receiptId: a.depositReceiptId || null, hasReceipt: !!a.depositReceiptId });
      for (const x of cs) tx.set(x.ref, { status: refundedCents ? 'refunded' : 'void', voidedAt: now, voidReason: 'booking undone at the desk', refundingFor: null, refundingAt: null, refundingCents: null }, { merge: true });
      // The refund ticket on the sale it was paid on; cash handed back leaves the till.
      if (rs?.exists) {
        const rc: any = rs.data() || {};
        tx.set(receiptRef, { refunds: FieldValue.arrayUnion({ line: `deposit-${appointmentId}`, cents, at: now, by: auth.actor.name || 'Front desk', how: refundedCents ? 'card' : 'cash', reason: 'Booking undone at the desk', transactionId: lineRef.id }),
          refundedCents: FieldValue.increment(cents) }, { merge: true });
        if (!refundedCents && rc.tillId) tx.set(db.doc(`${T}/tillSessions/${rc.tillId}`), { expectedCash: FieldValue.increment(-cents / 100), totalCashRefunds: FieldValue.increment(cents / 100) }, { merge: true });
      } else if (openTill) {
        tx.set(openTill.ref, { expectedCash: FieldValue.increment(-cents / 100), totalCashRefunds: FieldValue.increment(cents / 100),
          cashAdjustments: FieldValue.arrayUnion({ amount: -cents / 100, reason: `Deposit handed back (booking undone, ${a.clientName || 'client'})`, at: now, by: auth.actor.name || 'Front desk', appointmentId }) }, { merge: true });
      }
    }
    tx.set(ref, { status: 'cancelled', cancelReason: 'undone_at_desk', undoneAt: now, undoneBy: auth.actor.name || 'Front desk', noFee: true, paymentDueAt: null, undoClaim: FieldValue.delete(),
      ...(refundedCents || handBackCents ? { depositStatus: refundedCents ? 'refunded' : 'returned', depositReturnedCents: refundedCents || handBackCents } : {}),
      timeline: [...(Array.isArray(cur.timeline) ? cur.timeline : []), { at: now, kind: 'note', text: 'Booking undone at the desk (made by mistake) — no fee', by: auth.actor.name || 'Front desk' }] }, { merge: true });
    return true;
  });
  if (!wrote) return NextResponse.json({ ok: true, already: true, refundedCents, handBackCents });
  await logAuditAdmin(db, tenantId, { action: 'appointment.undone', targetType: 'appointment', targetId: appointmentId,
    summary: `Booking undone at the desk${refundedCents ? ` — $${(refundedCents / 100).toFixed(2)} deposit refunded` : handBackCents ? ` — hand back $${(handBackCents / 100).toFixed(2)} cash deposit` : ''}`,
    actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role, via: 'front desk' } } as any).catch(() => null);
  // One short note — they've just had a confirmation for it.
  try {
    const client: any = a.clientId ? (await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {} : {};
    const phone = a.clientPhone || client.phone; const email = a.clientEmail || client.email; const studio = tenant.name || 'The studio';
    const when = (() => { try { return new Date(a.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || 'America/New_York' }); } catch { return ''; } })();
    const text = `Hi ${String(a.clientName || '').split(' ')[0] || 'there'}, your booking for ${when} was made in error and has been removed. Please disregard the earlier confirmation; there is nothing further you need to do.${refundedCents ? ` Your $${(refundedCents / 100).toFixed(2)} deposit has been refunded.` : ''} We apologize for any confusion.`;
    const { sendNotification } = await import('@/lib/notify');
    if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'booking_undone', clientId: a.clientId || null, clientName: a.clientName || null, text } as any);
    else if (email) { const { brandedEmailHtml } = await import('@/lib/email-template');
      await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'booking_undone', clientId: a.clientId || null, clientName: a.clientName || null, subject: `Your booking with ${studio} has been removed`, html: brandedEmailHtml({ studioName: studio, title: 'Your booking has been removed', bodyLines: [text, `Kind regards, ${studio}`] } as any) } as any); }
  } catch { /* the undo stands either way */ }
  return NextResponse.json({ ok: true, refundedCents, handBackCents });
}
