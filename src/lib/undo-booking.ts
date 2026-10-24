// src/lib/undo-booking.ts — UNDOING A BOOKING MADE BY MISTAKE AT THE DESK: its records, once (server).
// The undo (api/appointments/undo-booking) claims the booking and sets its deposit aside, refunds the deposit through
// the payment that took it (under one key for the booking), then records it all here in one step, named after the
// booking: the refund in the books, the deposit closed, the refund ticket on the sale it was paid on, cash out of the
// till, and the booking undone. The client gets one short note.
// When Stripe's answer was lost and nobody undoes it again, the claim would stay with the deposit set aside:
// settleStuckUndos (the five-minute check) asks Stripe for the refund made under it. One that went through finishes the
// undo, since the money is back with the client; none at all lets the booking and its deposit go back as they were.
import { FieldValue } from 'firebase-admin/firestore';

/** A booking that has started, ended or been cancelled is never undone (cancel it from the planner instead). */
export const undoEnded = (status: any) => ['cancelled', 'canceled', 'completed', 'checked_in', 'in_service', 'no_show'].includes(String(status || ''));
export const undoMark = (appointmentId: string) => `undo_${appointmentId}`;
const lineIdOf = (appointmentId: string) => undoMark(appointmentId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 140);

/** Which card payment the deposit is refunded through: a deposit charged on its own, or its sale's card payment (or a
 *  card share of a split). None: it was cash. */
export function undoPiFor(a: any, receipt: any, cents: number): string | null {
  // Charged to the saved card, or taken on the card reader: refunded through that payment.
  if (a.depositPaidVia === 'card_on_file' || a.depositPaidVia === 'card_reader') return a.depositStripePaymentIntentId || a.stripePaymentIntentId || null;
  if (!receipt) return null;
  if (Array.isArray(receipt.payments)) { const share = receipt.payments.find((x: any) => x.stripePaymentIntentId && (Number(x.amount) || 0) * 100 >= cents); return share?.stripePaymentIntentId || null; }
  return receipt.paymentMethod !== 'cash' ? receipt.stripePaymentIntentId || null : null;
}

/** Let the booking and its deposit go back as they were (Stripe said no, or nothing reached it). `claimWas`: only the
 *  claim that was looked at is let go — one the desk has just taken over is theirs. */
export async function releaseUndo(db: any, tenantId: string, appointmentId: string, creditDocs: any[], claimWas?: string) {
  const ref = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`); const mark = undoMark(appointmentId);
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const cs: any[] = []; for (const d of creditDocs) cs.push(await tx.get(d.ref));
    if (cur.undoneAt || (claimWas !== undefined && String(cur.undoClaim || '') !== claimWas)) return;
    tx.set(ref, { undoClaim: FieldValue.delete() }, { merge: true });
    for (const x of cs) if ((x.data() || {}).refundingFor === mark) tx.set(x.ref, { status: 'available', refundingFor: null, refundingAt: null, refundingCents: null }, { merge: true });
  }).catch(() => {});
}

/** The records, once: false when it was undone already. `keepBooking`: the refund went through, but the booking went
 *  ahead meanwhile (checked in, started): the money is recorded and the deposit closed, the booking stays, and it's
 *  marked for the desk. */
export async function finishUndo(db: any, tenantId: string, appointmentId: string, x: {
  a: any; cents: number; refundedCents: number; handBackCents: number; creditDocs: any[]; receiptRef: any | null; openTill: any | null; by: string; at?: string; keepBooking?: boolean; flag?: boolean;
}): Promise<boolean> {
  const T = `tenants/${tenantId}`; const now = x.at || new Date().toISOString(); const a = x.a; const cents = x.cents;
  const ref = db.doc(`${T}/appointments/${appointmentId}`);
  const lineRef = db.doc(`${T}/transactions/${lineIdOf(appointmentId)}`);
  return db.runTransaction(async (tx: any) => {
    const line = await tx.get(lineRef); const cur: any = (await tx.get(ref)).data() || {};
    const cs: any[] = []; for (const d of x.creditDocs) cs.push(await tx.get(d.ref));
    const rs = x.receiptRef ? await tx.get(x.receiptRef) : null;
    if (line.exists || cur.undoneAt) return false;
    if (cents) {
      tx.set(lineRef, { id: lineRef.id, type: 'reversal', context: 'Business', taxBucket: 'refund', category: 'Refunds', amount: cents / 100, date: now, createdAt: now, tenantId,
        description: `Refund — deposit for a booking undone at the desk (${a.clientName || 'client'})`, clientOrVendor: a.clientName || 'Client', clientId: a.clientId || null,
        paymentMethod: x.refundedCents ? 'Card (Stripe refund)' : 'Cash handed back', appointmentId, receiptId: a.depositReceiptId || null, hasReceipt: !!a.depositReceiptId });
      for (const c of cs) tx.set(c.ref, { status: x.refundedCents ? 'refunded' : 'void', voidedAt: now, voidReason: 'booking undone at the desk', refundingFor: null, refundingAt: null, refundingCents: null }, { merge: true });
      // The refund ticket on the sale it was paid on; cash handed back leaves the till.
      if (rs?.exists) {
        const rc: any = rs.data() || {};
        tx.set(x.receiptRef, { refunds: FieldValue.arrayUnion({ line: `deposit-${appointmentId}`, cents, at: now, by: x.by, how: x.refundedCents ? 'card' : 'cash', reason: 'Booking undone at the desk', transactionId: lineRef.id }),
          refundedCents: FieldValue.increment(cents) }, { merge: true });
        if (!x.refundedCents && rc.tillId) tx.set(db.doc(`${T}/tillSessions/${rc.tillId}`), { expectedCash: FieldValue.increment(-cents / 100), totalCashRefunds: FieldValue.increment(cents / 100) }, { merge: true });
      } else if (x.openTill) {
        tx.set(x.openTill.ref, { expectedCash: FieldValue.increment(-cents / 100), totalCashRefunds: FieldValue.increment(cents / 100),
          cashAdjustments: FieldValue.arrayUnion({ amount: -cents / 100, reason: `Deposit handed back (booking undone, ${a.clientName || 'client'})`, at: now, by: x.by, appointmentId }) }, { merge: true });
      }
    }
    if (x.keepBooking) {
      tx.set(ref, { undoClaim: FieldValue.delete(), ...(x.flag ? { needsAttention: 'undo_refund_kept', needsAttentionAt: now } : {}),
        ...(x.refundedCents ? { depositStatus: 'refunded', depositReturnedCents: x.refundedCents } : {}),
        timeline: [...(Array.isArray(cur.timeline) ? cur.timeline : []), { at: now, kind: 'note', text: x.flag ? 'The deposit was refunded when the desk undid this booking, but the booking went ahead' : 'The deposit was refunded when the desk undid this booking', by: x.by }] }, { merge: true });
      return true;
    }
    tx.set(ref, { status: 'cancelled', cancelReason: 'undone_at_desk', undoneAt: now, undoneBy: x.by, noFee: true, paymentDueAt: null, undoClaim: FieldValue.delete(),
      ...(x.refundedCents || x.handBackCents ? { depositStatus: x.refundedCents ? 'refunded' : 'returned', depositReturnedCents: x.refundedCents || x.handBackCents } : {}),
      timeline: [...(Array.isArray(cur.timeline) ? cur.timeline : []), { at: now, kind: 'note', text: 'Booking undone at the desk (made by mistake) — no fee', by: x.by }] }, { merge: true });
    return true;
  });
}

/** One short note to the client: they've just had a confirmation for it. */
export async function tellUndone(db: any, tenantId: string, tenant: any, a: any, refundedCents: number) {
  try {
    const T = `tenants/${tenantId}`;
    const client: any = a.clientId ? (await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {} : {};
    const phone = a.clientPhone || client.phone; const email = a.clientEmail || client.email; const studio = tenant.name || 'The studio';
    const when = (() => { try { return new Date(a.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || 'America/New_York' }); } catch { return ''; } })();
    const text = `Hi ${String(a.clientName || '').split(' ')[0] || 'there'}, your booking for ${when} was made in error and has been removed. Please disregard the earlier confirmation; there is nothing further you need to do.${refundedCents ? ` Your $${(refundedCents / 100).toFixed(2)} deposit has been refunded.` : ''} We apologize for any confusion.`;
    const { sendNotification } = await import('@/lib/notify');
    if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'booking_undone', clientId: a.clientId || null, clientName: a.clientName || null, text } as any);
    else if (email) { const { brandedEmailHtml } = await import('@/lib/email-template');
      await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'booking_undone', clientId: a.clientId || null, clientName: a.clientName || null, subject: `Your booking with ${studio} has been removed`, html: brandedEmailHtml({ studioName: studio, title: 'Your booking has been removed', bodyLines: [text, `Kind regards, ${studio}`] } as any) } as any); }
  } catch (e: any) { console.error('[undo-booking] note to the client', String(e?.message || e).slice(0, 160)); /* the undo stands either way */ }
}

async function tellTeam(db: any, tenantId: string, appointmentId: string, message: string) {
  try {
    const admins = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get();
    const now = new Date().toISOString(); const id = String(appointmentId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
    for (const s of admins.docs) await db.doc(`tenants/${tenantId}/notifications/undokept_${id}_${s.id}`).set({ id: `undokept_${id}_${s.id}`, userId: s.id, type: 'undo_refund_kept', read: false, createdAt: now, link: `/planner?visit=${id}`, message });
  } catch { /* the refund is recorded; the note is a courtesy */ }
}

/** The five-minute check: an undo left claimed more than 15 minutes (Stripe's answer was lost and nobody undid it
 *  again) is finished when Stripe has its refund, or let go when it has none: at once for a deposit that never went to
 *  Stripe (cash), after two hours for one that did. Stripe is never asked for a refund from here — undoing it again is
 *  the desk's call. */
export async function settleStuckUndos(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; recorded: number; released: number; waiting: number }> {
  const out = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const T = `tenants/${tenantId}`; const now = o.now ?? Date.now();
  const snap = await db.collection(`${T}/appointments`).where('undoClaim', '>', '').limit(50).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) {
    const a0: any = d.data() || {};
    if (a0.undoneAt || now - (Date.parse(String(a0.undoClaim || '')) || now) < 15 * 60000) continue;
    // Taken over in one step, so two runs at once settle it once.
    const a: any = await db.runTransaction(async (tx: any) => {
      const s = await tx.get(d.ref); const cur: any = s.data() || {};
      if (cur.undoneAt || !cur.undoClaim || now - (Date.parse(String(cur.undoClaim)) || now) < 15 * 60000) return null;
      if (cur.undoSettlingAt && now - (Date.parse(String(cur.undoSettlingAt)) || 0) < 5 * 60000) return null;
      tx.set(d.ref, { undoSettlingAt: new Date(now).toISOString() }, { merge: true });
      return cur;
    }).catch(() => null);
    if (!a) continue;
    out.checked++;
    const cents = a.depositStatus === 'paid' && Number(a.depositAmountCents) > 0 ? Number(a.depositAmountCents) : 0;
    const creditDocs = cents ? (await db.collection(`${T}/depositCredits`).where('sourceAppointmentId', '==', d.id).get()).docs : [];
    const receiptRef = cents && a.depositReceiptId ? db.doc(`${T}/receipts/${a.depositReceiptId}`) : null;
    const receipt: any = receiptRef ? (await receiptRef.get()).data() : null;
    const pi = cents ? undoPiFor(a, receipt, cents) : null;
    let refund: any = null;
    if (pi && tenant?.stripeAccountId) {
      try {
        let stripe = o.stripe; if (!stripe) { const S = (await import('stripe')).default; stripe = new S(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }); }
        const l: any = await stripe.refunds.list({ payment_intent: pi, limit: 100 }, { stripeAccount: tenant.stripeAccountId });
        refund = (Array.isArray(l?.data) ? l.data : []).find((r: any) => String(r?.metadata?.appointmentId || '') === d.id && r?.metadata?.why === 'booking undone at the desk' && !['failed', 'canceled'].includes(String(r.status || ''))) || null;
      } catch { await d.ref.set({ undoSettlingAt: null }, { merge: true }); out.waiting++; continue; }
    }
    if (refund) {
      // The money is back with the client: the undo is finished, as the desk meant, unless the booking went ahead
      // meanwhile (checked in, started): then the refund is recorded, the booking stays, and the team is told.
      // (Cancelled another way meanwhile: the refund is recorded, and nothing more is said.)
      const cancelled = ['cancelled', 'canceled'].includes(String(a.status || ''));
      const wentAhead = !cancelled && (undoEnded(a.status) || (Date.parse(String(a.startTime || '')) || Infinity) <= now);
      const wrote = await finishUndo(db, tenantId, d.id, { a, cents, refundedCents: cents, handBackCents: 0, creditDocs, receiptRef, openTill: null, by: 'Automatic check', keepBooking: wentAhead || cancelled, flag: wentAhead });
      await d.ref.set({ undoSettlingAt: null }, { merge: true }).catch(() => {});
      if (wrote && !wentAhead && !cancelled) await tellUndone(db, tenantId, tenant, a, cents);
      if (wrote && wentAhead) await tellTeam(db, tenantId, d.id, `The $${(cents / 100).toFixed(2)} deposit for ${a.clientName || 'a client'}’s booking was refunded when the desk undid it, but the booking went ahead, so it’s still on the calendar without its deposit. Collect it at checkout if it’s still owed.`);
      out.recorded++;
    } else if (pi && tenant?.stripeAccountId && now - (Date.parse(String(a.undoClaim)) || now) < 2 * 3600e3) {
      // Nothing at Stripe yet: looked at again on the next runs, and let go after two hours.
      await d.ref.set({ undoSettlingAt: null }, { merge: true }).catch(() => {});
      out.waiting++;
    } else {
      // No refund at Stripe (or a cash deposit, which the desk hands back in person): the booking and its deposit go
      // back as they were, so the desk can undo it again.
      await releaseUndo(db, tenantId, d.id, creditDocs, String(a.undoClaim));
      await d.ref.set({ undoSettlingAt: null }, { merge: true }).catch(() => {});
      out.released++;
    }
  }
  return out;
}
