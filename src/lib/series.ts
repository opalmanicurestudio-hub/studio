// src/lib/series.ts — REPEAT BOOKINGS: WHAT HAPPENS WHEN A VISIT IS CANCELLED (server).
//   • Move the deposit to the next visit (Booking policies → Repeat bookings, on by default):
//     a visit holding the series' deposit, cancelled in good time, keeps the deposit as CREDIT
//     (never a refund) — checkout applies available credit automatically — and the next visit
//     is marked "deposit paid (moved)", so a scheduled "before each visit" charge isn't taken twice.
//   • Cancel this and later visits: every later visit in the series is cancelled, no fee (they're
//     weeks away). Scheduled deposits are called off; deposits already paid stay as credit.
import { logAuditAdmin } from '@/lib/audit';

export const seriesMoveDepositOn = (tenant: any) => tenant?.bookingPolicies?.seriesMoveDeposit !== false;
const LIVE = ['confirmed', 'pending_payment', 'requested'];

/** Later visits in the same series (soonest first). */
export async function laterSeriesVisits(db: any, tenantId: string, appt: any): Promise<any[]> {
  if (!appt?.seriesId) return [];
  const snap = await db.collection(`tenants/${tenantId}/appointments`).where('seriesId', '==', appt.seriesId).get();
  const from = Date.parse(appt.startTime);
  return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((a: any) => LIVE.includes(String(a.status)) && Date.parse(a.startTime) > from)
    .sort((a: any, b: any) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

async function mirror(db: any, tenantId: string, a: any, f: any) {
  if (!a.checkInToken) return;
  await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {}), db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {})]);
}

/** Mark the next visit as holding the (moved) deposit. Returns that visit's id, or null. */
export async function markDepositMoved(db: any, tenantId: string, from: any, actorName: string): Promise<string | null> {
  const next = (await laterSeriesVisits(db, tenantId, from))[0];
  if (!next || next.depositStatus === 'paid') return null;
  const f = { depositStatus: 'paid', depositMovedFrom: from.id, depositMovedAt: new Date().toISOString(), depositAmountCents: Number(from.depositAmountCents) || Number(next.depositAmountCents) || 0,
    depositDueAt: null, paymentDueAt: null, ...(next.needsAttention === 'series_deposit_failed' ? { needsAttention: null } : {}), ...(next.status === 'pending_payment' ? { status: 'confirmed' } : {}) };
  await db.doc(`tenants/${tenantId}/appointments/${next.id}`).set(f, { merge: true });
  await mirror(db, tenantId, next, f);
  await logAuditAdmin(db, tenantId, { action: 'deposit.moved', targetType: 'appointment', targetId: next.id, amount: (Number(f.depositAmountCents) || 0) / 100,
    summary: `Deposit moved to the next visit in the series (${new Date(next.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}) after an on-time cancellation`, actor: { type: 'user', name: actorName } } as any).catch(() => {});
  return next.id;
}

/** Cancel every later visit in the series. Returns how many were cancelled. */
export async function cancelLaterVisits(db: any, tenantId: string, from: any, actor: { name: string; role?: string; id?: string | null }): Promise<number> {
  const later = await laterSeriesVisits(db, tenantId, from);
  const nowIso = new Date().toISOString();
  for (const a of later) {
    const f: any = { status: 'cancelled', cancelledAt: nowIso, cancelledBy: actor.name, cancellationReason: 'Cancelled with the rest of the repeat series', cancellationFee: 0,
      ...(['scheduled', 'covered', 'pending', 'failed'].includes(String(a.depositStatus)) ? { depositStatus: 'none', depositDueAt: null, paymentDueAt: null } : {}),
      ...(a.depositStatus === 'paid' ? { depositKeptAsCredit: true } : {}), ...(a.needsAttention === 'series_deposit_failed' ? { needsAttention: null } : {}) };
    await db.doc(`tenants/${tenantId}/appointments/${a.id}`).set(f, { merge: true });
    await mirror(db, tenantId, a, { status: 'cancelled' });
  }
  if (later.length) await logAuditAdmin(db, tenantId, { action: 'appointment.series_cancelled', targetType: 'series', targetId: String(from.seriesId),
    summary: `${later.length} later visit${later.length === 1 ? '' : 's'} in the repeat series cancelled with the ${new Date(from.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} visit — no fees; any paid deposits kept as credit`,
    actor: { type: 'user', id: actor.id || null, name: actor.name, role: actor.role || null } } as any).catch(() => {});
  return later.length;
}
