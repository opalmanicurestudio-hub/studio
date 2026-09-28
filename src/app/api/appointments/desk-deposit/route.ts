// src/app/api/appointments/desk-deposit/route.ts
//
// DEPOSITS FOR BOOKINGS MADE AT THE DESK (Book next visit, and later any staff
// booking). Staff only. Four ways, all recorded exactly like an online deposit
// (the payment webhook's shape) so the next visit's checkout credits it:
//
//   settled  { appointmentId, amountCents, via: 'checkout' }
//            The deposit was a line on TODAY's checkout (checkout already wrote
//            the Retainers income line) → mark paid + confirm, deposit credit,
//            activity log, tell the client. No second income line.
//   charge   { appointmentId }  Charge the client's saved card now (the secured
//            charge-card route writes its own Retainers line) → then as settled.
//   link     { appointmentId }  Hold until the business's grace window, create the
//            pre-visit record the check-in page takes deposits through, and send
//            the client their check-in link. The payment webhook confirms it.
//   waive    { appointmentId, reason }  Managers/owners: confirm with no deposit;
//            the reason is recorded.
// A deposit that arrives after the hold was released does NOT revive the
// booking (the time may be taken) — it is flagged, like online.

import { bookingPolicyLines, holdLine } from '@/lib/policy-copy';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { internalPost, internalOrigin } from '@/lib/message-policy';
import { graceHoursOf } from '@/lib/deposit-policy';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

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
    const subject = kind === 'confirmed' ? `You're booked — ${when}` : `Pay your ${money} deposit to confirm ${when}`;
    const policy = bookingPolicyLines(tenant, null, { depositCents: cents });
    const lines = kind === 'confirmed'
      ? [`Hi ${first},`, `Your next visit at ${studio} is confirmed for ${when}.${cents > 0 ? ` Your ${money} deposit is received.` : ''}`, ...policy]
      : [`Hi ${first},`, `We've held ${when} for you at ${studio}. Pay your ${money} deposit to confirm it.`, holdLine(tenant, ap.paymentDueAt ? new Date(ap.paymentDueAt) : null), ...policy];
    if (email) await sendNotification(db, { tenantId, channel: 'email', to: email, subject, html: brandedEmailHtml({ studioName: studio, title: kind === 'confirmed' ? 'You’re booked' : 'Confirm your next visit', bodyLines: lines, cta: { label: kind === 'confirmed' ? 'View your visit' : `Pay ${money} deposit`, url: link } }), kind: kind === 'confirmed' ? 'desk_booking_confirmed' : 'deposit_pay_link', appointmentId: ap.id, clientId: ap.clientId || null, clientName: ap.clientName || null } as any);
    if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, text: `${studio}: ${kind === 'confirmed' ? `you're booked for ${when}.` : `pay your ${money} deposit to confirm ${when}:`} ${link}`, kind: kind === 'confirmed' ? 'desk_booking_confirmed' : 'deposit_pay_link', appointmentId: ap.id, clientId: ap.clientId || null, clientName: ap.clientName || null } as any);
  } catch (e) { console.error('[desk-deposit] notify failed (the deposit is safe)', e); }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || ''), action = String(b.action || '');
  if (!tenantId || !appointmentId) return bad('Missing details.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Sign in to do that.', auth.status || 401);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const aRef = db.doc(`${T}/appointments/${appointmentId}`);
  const ap: any = { id: appointmentId, ...(((await aRef.get()).data() as any) || {}) };
  if (!ap.startTime) return bad('That booking wasn’t found.', 404);
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const base = linkOrigin(tenant, req.nextUrl.origin);
  const nowIso = new Date().toISOString(); const actor = { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role, via: 'front desk' };
  if (ap.depositStatus === 'paid' && action !== 'link') return NextResponse.json({ ok: true, already: true, status: ap.status });

  const settle = async (cents: number, via: string, extra: any = {}) => {
    const released = ap.status === 'cancelled';
    const next = released ? 'cancelled' : (ap.status === 'pending_payment' ? 'confirmed' : ap.status);
    const batch = db.batch();
    batch.set(aRef, { status: next, depositStatus: 'paid', depositPaidAt: nowIso, depositAmountCents: cents, paymentDueAt: null, depositPaidVia: via, ...extra,
      ...(released ? { needsAttention: 'deposit_paid_after_hold_released', needsAttentionAt: nowIso } : {}) }, { merge: true });
    if (ap.checkInToken) batch.set(db.doc(`appointmentCheckIns/${ap.checkInToken}`), { status: next, depositStatus: 'paid' }, { merge: true });
    const cRef = db.collection(`${T}/depositCredits`).doc();
    batch.set(cRef, { id: cRef.id, tenantId, clientId: ap.clientId || null, clientEmail: String(ap.clientEmail || '').toLowerCase().trim(), clientName: ap.clientName || 'Guest',
      amountCents: cents, status: 'available', sourceAppointmentId: appointmentId, createdAt: nowIso, via });
    await batch.commit();
    await logAuditAdmin(db, tenantId, { action: 'deposit.paid', targetType: 'appointment', targetId: appointmentId, amount: cents / 100, summary: `Deposit $${(cents / 100).toFixed(2)} taken at the front desk (${via === 'checkout' ? 'on today’s bill' : 'card on file'}) — ${ap.clientName || 'client'}`, actor } as any).catch(() => {});
    if (!released) await tellClient(db, tenant, tenantId, ap, base, 'confirmed', cents);
    return NextResponse.json({ ok: true, status: next, released });
  };

  if (action === 'settled') {
    const cents = Math.round(Number(b.amountCents) || Number(ap.depositAmountCents) || 0);
    if (cents <= 0) return bad('No deposit amount.');
    return settle(cents, 'checkout');
  }

  if (action === 'charge') {
    const cents = Math.round(Number(ap.depositAmountCents) || 0);
    if (cents <= 0) return bad('This booking has no deposit to take.');
    if (!ap.clientId) return bad('There’s no client record with a saved card for this booking.');
    const r = await internalPost(internalOrigin(null, req.nextUrl.origin), '/api/stripe/charge-card', {
      tenantId, clientId: ap.clientId, amountCents: cents, description: `Deposit — ${ap.serviceName || 'next visit'}`, category: 'Retainers',
      appointmentId, reason: 'Front desk deposit (card on file)', mode: 'auto', kind: 'deposit' });
    if (!r.ok || !r.data?.ok) return NextResponse.json({ ok: false, error: r.data?.reason || r.data?.error || 'The card didn’t go through.', code: r.data?.code || 'declined' }, { status: 402 });
    return settle(cents, 'card_on_file', { stripePaymentIntentId: r.data?.paymentIntentId || null });
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
    batch.set(aRef, { status: ap.status === 'pending_payment' ? 'confirmed' : ap.status, depositStatus: 'waived', depositWaivedReason: reason, depositWaivedBy: auth.actor.name, depositWaivedAt: nowIso, paymentDueAt: null }, { merge: true });
    if (ap.checkInToken) batch.set(db.doc(`appointmentCheckIns/${ap.checkInToken}`), { status: ap.status === 'pending_payment' ? 'confirmed' : ap.status, depositStatus: 'waived' }, { merge: true });
    await batch.commit();
    await logAuditAdmin(db, tenantId, { action: 'deposit.waived', targetType: 'appointment', targetId: appointmentId, summary: `Confirmed without a deposit — ${ap.clientName || 'client'} (${reason})`, actor } as any).catch(() => {});
    await tellClient(db, tenant, tenantId, ap, base, 'confirmed', 0);
    return NextResponse.json({ ok: true, status: 'confirmed' });
  }
  return bad('Unknown action.');
}
