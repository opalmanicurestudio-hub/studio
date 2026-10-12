// src/app/api/prep-decide/route.ts — BEFORE THE VISIT, THE TEAM'S SIDE (lib/prep-actions). From the staff app and the app.
//   approve  { appointmentId }  → the agreed change goes onto the booking (if it fits and the provider is certified)
//   keep     { appointmentId }  → keep it as booked; the client is told the business's on-the-day rule
//   desk     { appointmentId, why? } → doesn't fit: to the front desk
// The desk (anyone who can manage bookings):
//   move     { appointmentId }  → ask the client to pick a new time — free, not counted
//   cancel   { appointmentId }  → cancel with no fee; deposit to refund; the time is offered to the waitlist
//   desk_link { appointmentId } → the check's link for filling it in with the client over the phone
//   providers { appointmentId } → others certified and free at the same time for the whole new length
//   move_provider { appointmentId, staffId } → same time, that provider, with the change on the booking
// On the day (lib/prep-day) — the provider shows the client the change; the client answers in person:
//   day_options { appointmentId } → add-ons, services they can switch to, the free time after, the business's rule
//   day_change  { appointmentId, addOns[{id,qty}], addMinutes, switchServiceId?, answer:'yes'|'no', fee?, runOver? }
// A provider can decide on their own visits; managers and the desk on any.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { applyPrep, keepPrep, toDesk, askToMove, cancelFree, otherProviders, moveToProvider } from '@/lib/prep-actions';
import { dayOptions, dayChange } from '@/lib/prep-day';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120); const id = String(b.appointmentId || '').slice(0, 120);
  if (!tenantId || !id) return j({ ok: false, error: 'Missing details.' }, 400);
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return j({ ok: false, error: who.error }, who.status);
  const a = who.actor; const caps = a.caps || []; const desk = a.isOwner || a.isManager || caps.includes('bookings.manage') || caps.includes('bookings.all');
  const snap = await db.doc(`tenants/${tenantId}/appointments/${id}`).get(); if (!snap.exists) return j({ ok: false, error: 'That visit is gone.' }, 404);
  const appt: any = snap.data() || {}; const mine = String(appt.staffId || '') === a.staffId;
  const action = String(b.action || ''); const by = { name: a.name };
  if (['day_options', 'day_change'].includes(action)) {
    if (!(mine || desk)) return j({ ok: false, error: 'Only the provider or the desk can do this.' }, 403);
    if (action === 'day_options') { const r: any = await dayOptions(db, tenantId, id); return j(r, r.ok ? 200 : 409); }
    const answer = b.answer === 'yes' ? 'yes' : b.answer === 'no' ? 'no' : null; if (!answer) return j({ ok: false, error: 'Missing the client’s answer.' }, 400);
    const r: any = await dayChange(db, tenantId, id, { name: a.name, staffId: a.staffId, manager: !!(a.isOwner || a.isManager) }, { addOns: Array.isArray(b.addOns) ? b.addOns : [], addMinutes: Number(b.addMinutes) || 0, switchServiceId: b.switchServiceId ? String(b.switchServiceId) : null, answer, fee: b.fee === true, runOver: b.runOver === true });
    return j(r, r.ok ? 200 : 409);
  }
  if (['approve', 'keep', 'desk'].includes(action) && !(mine || desk)) return j({ ok: false, error: 'Only the provider or the desk can decide this.' }, 403);
  if (action === 'desk_link') { if (!desk) return j({ ok: false, error: 'The front desk does this one.' }, 403); const { prepPath, prepDeskKey } = await import('@/lib/prep-check-server'); return j({ ok: true, path: `${prepPath(tenantId, id)}&d=${prepDeskKey(tenantId, id)}` }); }
  if (action === 'providers' || action === 'move_provider') { if (!desk) return j({ ok: false, error: 'The front desk does this one.' }, 403);
    const r: any = action === 'providers' ? await otherProviders(db, tenantId, id) : await moveToProvider(db, tenantId, id, String(b.staffId || ''), by); return j(r, r.ok ? 200 : 409); }
  if (['move', 'cancel'].includes(action) && !desk) return j({ ok: false, error: 'The front desk decides this one.' }, 403);
  const r = action === 'approve' ? await applyPrep(db, tenantId, id, by) : action === 'keep' ? await keepPrep(db, tenantId, id, by) : action === 'desk' ? await toDesk(db, tenantId, id, by, b.why)
    : action === 'move' ? await askToMove(db, tenantId, id, by) : action === 'cancel' ? await cancelFree(db, tenantId, id, by) : { ok: false, error: 'Unknown action.' };
  return j(r, r.ok ? 200 : 409);
}
