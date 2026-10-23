// src/app/api/appointments/deposit-outcome/route.ts — A CANCELLED BOOKING'S DEPOSIT, SETTLED ON THE SERVER
// (lib/deposit-outcome). The desk's cancel and no-show screens ask here once the cancellation is saved: the deposit is
// kept, rolled over to their next visit, or set aside to refund, once. Deposits are changed only on the server (the
// database lets only managers change them from a screen), so this works for everyone who can cancel a booking.
//   POST { tenantId, appointmentId, outcome: 'forfeit' | 'rollover' | 'refund_pending', reason? }
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
import { getAdminDb } from '@/lib/firebase-admin';
import { settleCancelledDeposit, type DepositOutcome } from '@/lib/deposit-outcome';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const appointmentId = String(b.appointmentId || '').trim();
  const outcome = String(b.outcome || '') as DepositOutcome;
  if (!tenantId || !/^[A-Za-z0-9_-]{1,160}$/.test(appointmentId) || !['forfeit', 'rollover', 'refund_pending'].includes(outcome)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  const actor: any = g.actor || {};
  if (actor.isRenter === true || actor.role === 'renter') return NextResponse.json({ ok: false, error: 'Only the business’s own team settles its deposits.' }, { status: 403 });
  const db = getAdminDb();
  const a = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
  const ap: any = a.exists ? a.data() || {} : null;
  if (!ap) return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
  // Only a booking that has been cancelled (or missed): a deposit for a visit still to come stays as it is.
  if (ap.status !== 'cancelled') return NextResponse.json({ ok: false, error: 'This booking hasn’t been cancelled.' }, { status: 409 });
  const actorType = String(ap.cancellationAudit?.actorType || '');
  const r = await settleCancelledDeposit(db, tenantId, {
    appointmentId, outcome, reason: String(b.reason || (actorType === 'no_show' ? 'no_show' : 'front_desk')).slice(0, 80),
    trigger: actorType === 'no_show' ? 'no_show' : actorType === 'client' ? 'client_cancel' : 'front_desk', by: String(actor.name || 'Front desk'),
  });
  return NextResponse.json({ ok: true, ...r });
}
