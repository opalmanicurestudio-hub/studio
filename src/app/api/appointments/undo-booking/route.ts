// src/app/api/appointments/undo-booking/route.ts — UNDO A BOOKING JUST MADE AT THE DESK.
// For a mis-tapped date or the wrong service: it's as if the booking never happened — no cancellation, no fee, no
// "you cancelled" message. Only for a booking made at the desk in the last 30 minutes that hasn't started (so it
// can never be used to dodge a cancellation fee). A deposit taken for it goes back: card → refunded; cash → staff
// are told how much to hand back. The client — who just got a confirmation — gets one short "it's been removed" note.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
export const dynamic = 'force-dynamic';

const DESK_SOURCES = ['front_desk', 'planner', 'pos_add_appointment', 'staff', 'admin', 'add_appointment', 'staff_portal'];
export const UNDO_WINDOW_MS = 30 * 60000;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const appointmentId = String(b.appointmentId || '').slice(0, 120);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/appointments/${appointmentId}`);
  const a: any = (await ref.get()).data();
  if (!a) return NextResponse.json({ ok: false, error: 'That booking wasn’t found.' }, { status: 404 });
  const made = Date.parse(a.createdAt || a.bookedAt || '');
  if (!DESK_SOURCES.includes(String(a.source || '')) || !Number.isFinite(made) || Date.now() - made > UNDO_WINDOW_MS)
    return NextResponse.json({ ok: false, error: 'Undo is only for a booking made here in the last 30 minutes — cancel it from the planner instead.' }, { status: 409 });
  if (['cancelled', 'canceled', 'completed', 'checked_in', 'in_service', 'no_show'].includes(String(a.status || '')) || Date.parse(a.startTime || '') <= Date.now())
    return NextResponse.json({ ok: false, error: 'This booking has already started or changed — cancel it from the planner instead.' }, { status: 409 });
  const now = new Date().toISOString(); const tenant: any = (await db.doc(T).get()).data() || {};
  // A deposit taken for it goes back.
  let refundedCents = 0, handBackCents = 0;
  if (a.depositStatus === 'paid' && Number(a.depositAmountCents) > 0) {
    const cents = Number(a.depositAmountCents);
    if (a.depositPaidVia === 'card_on_file' && a.stripePaymentIntentId && tenant.stripeAccountId) {
      try { await new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }).refunds.create({ payment_intent: a.stripePaymentIntentId, reason: 'requested_by_customer', metadata: { tenantId, appointmentId, why: 'booking undone at the desk' } },
        { stripeAccount: tenant.stripeAccountId, idempotencyKey: `undo-${tenantId}-${appointmentId}` }); refundedCents = cents; }
      catch (e: any) { return NextResponse.json({ ok: false, error: `The deposit couldn’t be refunded (${String(e?.message || 'card error').slice(0, 80)}) — nothing was changed.` }, { status: 502 }); }
    } else handBackCents = cents;
    for (const c of (await db.collection(`${T}/depositCredits`).where('sourceAppointmentId', '==', appointmentId).get()).docs)
      await c.ref.set({ status: refundedCents ? 'refunded' : 'void', voidedAt: now, voidReason: 'booking undone at the desk' }, { merge: true });
  }
  await ref.set({ status: 'cancelled', cancelReason: 'undone_at_desk', undoneAt: now, undoneBy: auth.actor.name || 'Front desk', noFee: true, paymentDueAt: null,
    ...(refundedCents || handBackCents ? { depositStatus: refundedCents ? 'refunded' : 'returned', depositReturnedCents: refundedCents || handBackCents } : {}),
    timeline: [...(Array.isArray(a.timeline) ? a.timeline : []), { at: now, kind: 'note', text: 'Booking undone at the desk (made by mistake) — no fee', by: auth.actor.name || 'Front desk' }] }, { merge: true });
  await logAuditAdmin(db, tenantId, { action: 'appointment.undone', targetType: 'appointment', targetId: appointmentId,
    summary: `Booking undone at the desk${refundedCents ? ` — $${(refundedCents / 100).toFixed(2)} deposit refunded` : handBackCents ? ` — hand back $${(handBackCents / 100).toFixed(2)} cash deposit` : ''}`,
    actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role, via: 'front desk' } } as any).catch(() => null);
  // One short note — they've just had a confirmation for it.
  try {
    const client: any = a.clientId ? (await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {} : {};
    const phone = a.clientPhone || client.phone; const email = a.clientEmail || client.email; const studio = tenant.name || 'The studio';
    const when = (() => { try { return new Date(a.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || 'America/New_York' }); } catch { return ''; } })();
    const text = `${studio}: the booking for ${when} has been removed — please ignore that confirmation. Nothing else to do.${refundedCents ? ` Your $${(refundedCents / 100).toFixed(2)} deposit has been refunded.` : ''}`;
    const { sendNotification } = await import('@/lib/notify');
    if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'booking_undone', clientId: a.clientId || null, clientName: a.clientName || null, text } as any);
    else if (email) { const { brandedEmailHtml } = await import('@/lib/email-template');
      await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'booking_undone', clientId: a.clientId || null, clientName: a.clientName || null, subject: `Booking removed — ${studio}`, html: brandedEmailHtml({ studioName: studio, title: 'That booking has been removed', bodyLines: [text.replace(`${studio}: `, '')] } as any) } as any); }
  } catch { /* the undo stands either way */ }
  return NextResponse.json({ ok: true, refundedCents, handBackCents });
}
