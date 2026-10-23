// src/app/api/appointments/desk-deposit/route.ts
//
// DEPOSITS FOR BOOKINGS MADE AT THE DESK (Book next visit, and later any staff
// booking). Staff only. Four ways, all recorded exactly like an online deposit
// (the payment webhook's shape) so the next visit's checkout credits it:
//
//   settled  { appointmentId, amountCents, via: 'checkout' }
//            The deposit was a line on TODAY's checkout (checkout already wrote
//            the Retainers income line) → mark paid + confirm, deposit credit,
//            activity log, tell the client. No second income line. Never more
//            than the booking's deposit, and one credit per sale (or per booking
//            when there's no sale), so a repeat can't add another.
//   charge   { appointmentId }  Charge the client's saved card now (the secured
//            charge-card route writes its own Retainers line) → then recorded
//            once, by the card payment (lib/deposit-record). One charge at a
//            time per booking; a booking with a card payment on it already is
//            only recorded, never charged again.
//   link     { appointmentId }  Hold until the business's grace window, create the
//            pre-visit record the check-in page takes deposits through, and send
//            the client their check-in link. The payment webhook confirms it.
//   waive    { appointmentId, reason }  Managers/owners: confirm with no deposit;
//            the reason is recorded.
// A deposit that arrives after the hold was released does NOT revive the
// booking (the time may be taken) — it is flagged, like online.

import { balanceDueWith, settleCollectedBalance } from '@/lib/balance-with-deposit';
import { bookingPolicyLines, holdLine } from '@/lib/policy-copy';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { internalPost, internalOrigin } from '@/lib/message-policy';
import { graceHoursOf } from '@/lib/deposit-policy';
import { recordCardDepositSafely } from '@/lib/deposit-record';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const c0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
// How long one desk charge keeps others from starting for the same booking.
const CHARGE_LOCK_MS = 90_000;

async function tellClient(db: any, tenant: any, tenantId: string, ap: any, base: string, kind: 'confirmed' | 'pay_link', cents: number) {
  try {
    const { sendNotification } = await import('@/lib/notify');
    const { brandedEmailHtml } = await import('@/lib/email-template');
    const cl = ap.clientId ? (((await db.doc(`tenants/${tenantId}/clients/${ap.clientId}`).get()).data() as any) || {}) : {};
    const email = String(cl.email || ap.clientEmail || '').trim(), phone = String(cl.phone || ap.clientPhone || '').trim();
    const first = String(ap.clientName || '').split(' ')[0] || 'there'; const studio = tenant.name || tenant.businessName || 'the studio';
    const when = ap.startTime ? new Date(ap.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined }) : 'your next visit';
    const link = ap.checkInToken ? `${base}/check-in/${ap.checkInToken}` : `${base}/book/${tenantId}`;
    const money = `$${(cents / 100).toFixed(2)}`;
    const subject = kind === 'confirmed' ? `Your appointment is confirmed for ${when}` : `Please pay your ${money} deposit to confirm ${when}`;
    const policy = bookingPolicyLines(tenant, null, { depositCents: cents });
    const lines = kind === 'confirmed'
      ? [`Hi ${first},`, `Thank you for booking with us. Your next visit at ${studio} is confirmed for ${when}.${cents > 0 ? ` We have received your ${money} deposit.` : ''}`, ...policy, `Kind regards, ${studio}`]
      : [`Hi ${first},`, `We are holding ${when} for you at ${studio}. To confirm your appointment, please pay your ${money} deposit using the button below.`, holdLine(tenant, ap.paymentDueAt ? new Date(ap.paymentDueAt) : null), ...policy, `Kind regards, ${studio}`];
    if (email) await sendNotification(db, { tenantId, channel: 'email', to: email, subject, html: brandedEmailHtml({ studioName: studio, title: kind === 'confirmed' ? 'Your appointment is confirmed' : 'Confirm your next visit', bodyLines: lines, cta: { label: kind === 'confirmed' ? 'View your visit' : `Pay ${money} deposit`, url: link } }), kind: kind === 'confirmed' ? 'desk_booking_confirmed' : 'deposit_pay_link', appointmentId: ap.id, clientId: ap.clientId || null, clientName: ap.clientName || null } as any);
    if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, text: `${kind === 'confirmed' ? `Hi ${first}, your appointment is confirmed for ${when}. Your visit link:` : `Hi ${first}, to confirm your appointment on ${when}, please pay your ${money} deposit here:`} ${link}`, kind: kind === 'confirmed' ? 'desk_booking_confirmed' : 'deposit_pay_link', appointmentId: ap.id, clientId: ap.clientId || null, clientName: ap.clientName || null } as any);
  } catch (e) { console.error('[desk-deposit] notify failed (the deposit is safe)', e); }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || ''), action = String(b.action || '');
  if (!tenantId || !appointmentId) return bad('Missing details.');
  // Staff — or the server itself (the nightly job taking a repeat visit's scheduled deposit).
  const internal = !!process.env.CRON_SECRET && req.headers.get('x-cf-internal') === process.env.CRON_SECRET;
  const auth: any = internal ? { ok: true, actor: { uid: 'system', name: 'Scheduled deposit', role: 'system' } } : await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Sign in to do that.', auth.status || 401);
  if (internal && !['charge', 'link'].includes(action)) return bad('Not allowed.', 403);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const aRef = db.doc(`${T}/appointments/${appointmentId}`);
  const ap: any = { id: appointmentId, ...(((await aRef.get()).data() as any) || {}) };
  if (!ap.startTime) return bad('That booking wasn’t found.', 404);
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const base = linkOrigin(tenant, req.nextUrl.origin);
  const nowIso = new Date().toISOString(); const actor = { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role, via: 'front desk' };
  // Paid already: nothing is taken again (a card payment that was charged but never recorded is recorded below).
  if (ap.depositStatus === 'paid' && action !== 'link' && !(action === 'charge' && ap.depositStripePaymentIntentId)) return NextResponse.json({ ok: true, already: true, status: ap.status });

  // After a deposit is recorded: the activity log, and the client hears their visit is confirmed.
  const after = async (cents: number, via: string, released: boolean) => {
    await logAuditAdmin(db, tenantId, { action: 'deposit.paid', targetType: 'appointment', targetId: appointmentId, amount: cents / 100, summary: `Deposit ${money(cents)} taken at the front desk (${via === 'checkout' ? 'on today’s bill' : 'card on file'}) — ${ap.clientName || 'client'}`, actor } as any).catch(() => {});
    if (!released) await tellClient(db, tenant, tenantId, ap, base, 'confirmed', cents);
  };

  // Paid on a sale (or at the desk): the credit is named after the sale and the booking, so a repeat can't add another.
  const settle = async (cents: number, via: string, creditId: string, extra: any = {}) => {
    const cRef = db.doc(`${T}/depositCredits/${creditId}`);
    const done = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(aRef)).data() || {};
      if ((await tx.get(cRef)).exists || cur.depositStatus === 'paid') return null;
      const released = cur.status === 'cancelled';
      const next = released ? 'cancelled' : (cur.status === 'pending_payment' ? 'confirmed' : cur.status);
      tx.set(aRef, { status: next, depositStatus: 'paid', depositPaidAt: nowIso, depositAmountCents: cents, paymentDueAt: null, depositPaidVia: via, ...extra,
        depositDeskHold: null, ...(cur.needsAttention === 'deposit_unpaid' && !released ? { needsAttention: null } : {}),
        ...(released ? { needsAttention: 'deposit_paid_after_hold_released', needsAttentionAt: nowIso } : {}) }, { merge: true });
      if (cur.checkInToken) tx.set(db.doc(`appointmentCheckIns/${cur.checkInToken}`), { status: next, depositStatus: 'paid' }, { merge: true });
      tx.set(cRef, { id: cRef.id, tenantId, clientId: cur.clientId || null, clientEmail: String(cur.clientEmail || '').toLowerCase().trim(), clientName: cur.clientName || 'Guest',
        amountCents: cents, status: 'available', sourceAppointmentId: appointmentId, createdAt: nowIso, via });
      return { next, released };
    });
    if (!done) return NextResponse.json({ ok: true, already: true, status: ap.status });
    await after(cents, via, done.released);
    return NextResponse.json({ ok: true, status: done.next, released: done.released, depositCents: cents });
  };

  if (action === 'settled') {
    // Never more than the booking's deposit.
    const owed = c0(ap.depositAmountCents);
    const asked = c0(b.amountCents);
    const cents = owed > 0 ? Math.min(asked || owed, owed) : asked;
    if (cents <= 0) return bad('No deposit amount.');
    const receiptId = String(b.receiptId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    // Paid at the desk covers a balance collected with this deposit too.
    const bal = balanceDueWith(ap);
    if (bal > 0) await settleCollectedBalance(db, tenantId, appointmentId, bal, { paymentMethod: 'Paid at the desk', via: 'front desk', actorName: auth.actor.name });
    // Which sale paid it, and how — so an undo can refund it through that payment.
    return settle(cents, 'checkout', receiptId ? `deposit_${receiptId}_${appointmentId}` : `deposit_desk_${appointmentId}`,
      { depositReceiptId: receiptId || null, depositPaidMethod: b.paidMethod ? String(b.paidMethod) : null });
  }

  if (action === 'charge') {
    const cents = c0(ap.depositAmountCents);
    if (cents <= 0) return bad('This booking has no deposit to take.');
    if (!ap.clientId) return bad('There’s no client record with a saved card for this booking.');
    const clientEmail = String(ap.clientEmail || (((await db.doc(`${T}/clients/${ap.clientId}`).get()).data() as any) || {}).email || '').toLowerCase().trim();
    const recorded = async (pi: string, chargeId: string | null, chargedCents: number) => {
      const rec = await recordCardDepositSafely(db, tenantId, appointmentId, { cents, paymentIntentId: pi, chargeId, via: 'card_on_file', clientEmail, extra: { stripePaymentIntentId: pi } },
        { status: ap.status === 'pending_payment' ? 'confirmed' : ap.status, depositStatus: 'paid', depositPaidAt: nowIso, depositPaidVia: 'card_on_file', paymentDueAt: null, depositChargeLock: null });
      if (!rec.ok) return NextResponse.json({ ok: false, error: rec.error, code: 'not_recorded' }, { status: 500 });
      if (!rec.already) await after(cents, 'card_on_file', rec.released);
      return NextResponse.json({ ok: true, already: rec.already, status: rec.status, released: rec.released, depositCents: cents, chargedCents });
    };
    // Taken already (its credit is here): nothing is charged or added.
    const prior = await db.collection(`${T}/depositCredits`).where('sourceAppointmentId', '==', appointmentId).limit(20).get();
    if (prior.docs.some((d: any) => ['available', 'consumed'].includes(String(d.data()?.status || '')))) {
      if (ap.depositStatus !== 'paid') await aRef.set({ depositStatus: 'paid' }, { merge: true });
      return NextResponse.json({ ok: true, already: true, status: ap.status });
    }
    // Charged before but not recorded (the save failed after the charge): recorded now, not charged again.
    const onFile = String(ap.depositStripePaymentIntentId || '');
    if (onFile) return recorded(onFile, null, 0);
    // One charge at a time for a booking: a second device or a double tap waits for the first. Each attempt has its own
    // key with the card processor, so a new attempt after a decline really tries the card again; when an attempt's answer
    // was lost, the next one reuses its key, so the processor answers with that charge instead of making another.
    const bal = balanceDueWith(ap);
    const startedAt = Date.now();
    const lock = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(aRef)).data() || {};
      if (cur.depositStatus === 'paid' || cur.depositStripePaymentIntentId) return { state: 'paid' as const, key: '' };
      const prev: any = cur.depositChargeLock || null;
      const held = Date.parse(String(prev?.at || ''));
      if (!prev?.unknown && Number.isFinite(held) && startedAt - held < CHARGE_LOCK_MS) return { state: 'busy' as const, key: '' };
      const key = prev?.unknown && prev?.key ? String(prev.key) : `dep_${appointmentId}_${cents + bal}_${startedAt}`;
      tx.set(aRef, { depositChargeLock: { at: new Date(startedAt).toISOString(), by: auth.actor.name || 'Front desk', key } }, { merge: true });
      return { state: 'ok' as const, key };
    });
    if (lock.state === 'paid') return NextResponse.json({ ok: true, already: true, status: ap.status });
    if (lock.state === 'busy') return NextResponse.json({ ok: false, error: 'This deposit is being charged right now. Give it a moment, then check the booking.', code: 'in_progress' }, { status: 409 });
    // One charge for the deposit AND any balance collected with it; the ledger line is split afterwards.
    const r = await internalPost(internalOrigin(null, req.nextUrl.origin), '/api/stripe/charge-card', {
      tenantId, clientId: ap.clientId, amountCents: cents + bal, description: bal ? `Deposit — ${ap.serviceName || 'next visit'} + ${money(bal)} balance` : `Deposit — ${ap.serviceName || 'next visit'}`, category: 'Retainers',
      appointmentId, reason: 'Front desk deposit (card on file)', mode: 'auto', kind: 'deposit', idempotencyKey: lock.key }, { retries: 0 }); // never retry a charge
    if (!r.ok && (r.transportError || !r.status || r.status >= 500)) {
      // No answer from the card processor: the charge may have gone through. The next attempt asks about this one.
      await aRef.set({ depositChargeLock: { at: new Date(startedAt).toISOString(), by: auth.actor.name || 'Front desk', key: lock.key, unknown: true } }, { merge: true }).catch(() => {});
      return NextResponse.json({ ok: false, error: 'We couldn’t confirm the charge. Try again in a moment: it won’t be charged twice.', code: 'unconfirmed' }, { status: 502 });
    }
    if (!r.data?.ok || !r.data?.paymentIntentId) {
      await aRef.set({ depositChargeLock: null }, { merge: true }).catch(() => {});
      return NextResponse.json({ ok: false, error: r.data?.reason || r.data?.error || 'The card didn’t go through.', code: r.data?.code || 'declined', declineCode: r.data?.declineCode || null }, { status: 402 });
    }
    const pi = String(r.data.paymentIntentId);
    if (bal > 0) {
      // charge-card recorded the whole charge as a deposit line — make that line the deposit part only,
      // and record the balance part as the fee payment it is (the total still equals what was charged).
      for (const id of [`card_charge__${pi}`, `pos_cof__${pi}`]) {
        const tRef = db.doc(`${T}/transactions/${id}`);
        if ((await tRef.get()).exists) { await tRef.set({ amount: cents / 100, description: `Deposit — ${ap.serviceName || 'next visit'}` }, { merge: true }); break; }
      }
      await settleCollectedBalance(db, tenantId, appointmentId, bal, { paymentMethod: 'Card on file (Stripe)', via: 'card on file', chargeId: r.data.chargeId || null, actorName: auth.actor.name });
    }
    return recorded(pi, r.data.chargeId || null, cents + bal);
  }

  if (action === 'link') {
    const cents = Math.round(Number(ap.depositAmountCents) || 0);
    if (cents <= 0) return bad('This booking has no deposit to take.');
    if (!ap.checkInToken) return bad('This booking has no link to send.');
    const due = new Date(Date.now() + Math.max(1, graceHoursOf(tenant)) * 3600e3).toISOString();
    const batch = db.batch();
    batch.set(aRef, { paymentDueAt: due, depositLinkSentAt: nowIso }, { merge: true });
    // The check-in page takes the deposit through this record; the webhook confirms the booking.
    batch.set(db.doc(`${T}/bookingCompletions/${ap.checkInToken}`), { appointmentId, clientId: ap.clientId || null, clientName: ap.clientName || null, clientEmail: ap.clientEmail || null,
      serviceName: ap.serviceName || null, appointmentStartTime: ap.startTime, depositAmountCents: cents, skipCardStep: false, status: 'pending', createdAt: nowIso, createdVia: 'front desk' }, { merge: true });
    await batch.commit();
    await logAuditAdmin(db, tenantId, { action: 'deposit.link_sent', targetType: 'appointment', targetId: appointmentId, amount: cents / 100, summary: `Deposit link sent — ${ap.clientName || 'client'}, held until ${new Date(due).toLocaleString('en-US', { timeZone: tenant.timezone || undefined })}`, actor } as any).catch(() => {});
    await tellClient(db, tenant, tenantId, { ...ap, paymentDueAt: due }, base, 'pay_link', cents);
    return NextResponse.json({ ok: true, heldUntil: due });
  }

  if (action === 'waive') {
    // Anyone at the desk may skip it for a member/regular when the business chose
    // "No deposit for members & regulars"; otherwise it's a manager's call, with a reason.
    let regular = false;
    if (tenant.deskDepositDefault === 'regulars' && ap.clientId) {
      const cl: any = ((await db.doc(`${T}/clients/${ap.clientId}`).get()).data() as any) || {};
      const need = Number(tenant.bookingMode?.autoApproveAfterVisits) > 0 ? Number(tenant.bookingMode.autoApproveAfterVisits) : 3;
      const done = (await db.collection(`${T}/appointments`).where('clientId', '==', ap.clientId).where('status', '==', 'completed').limit(need).get()).size;
      regular = !!cl.activeMembershipId || done >= need;
    }
    const reason = String(b.reason || '').trim().slice(0, 300) || (regular ? 'Member / regular — no deposit (desk setting)' : '');
    if (!auth.actor.isManager && !regular) return bad('Only a manager or the owner can confirm this without a deposit.', 403);
    if (!reason) return bad('Add a reason for confirming without a deposit.');
    const batch = db.batch();
    batch.set(aRef, { status: ap.status === 'pending_payment' ? 'confirmed' : ap.status, depositStatus: 'waived', depositWaivedReason: reason, depositWaivedBy: auth.actor.name, depositWaivedAt: nowIso, paymentDueAt: null, depositDeskHold: null, ...(ap.needsAttention === 'deposit_unpaid' ? { needsAttention: null } : {}) }, { merge: true });
    if (ap.checkInToken) batch.set(db.doc(`appointmentCheckIns/${ap.checkInToken}`), { status: ap.status === 'pending_payment' ? 'confirmed' : ap.status, depositStatus: 'waived' }, { merge: true });
    await batch.commit();
    await logAuditAdmin(db, tenantId, { action: 'deposit.waived', targetType: 'appointment', targetId: appointmentId, summary: `Confirmed without a deposit — ${ap.clientName || 'client'} (${reason})`, actor } as any).catch(() => {});
    await tellClient(db, tenant, tenantId, ap, base, 'confirmed', 0);
    return NextResponse.json({ ok: true, status: 'confirmed' });
  }
  return bad('Unknown action.');
}
