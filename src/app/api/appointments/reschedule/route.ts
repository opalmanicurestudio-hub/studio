// src/app/api/appointments/reschedule/route.ts
//
// STAFF RESCHEDULES — checked like bookings. The planner's Reschedule dialog
// used to write any time straight to the database: outside hours, on a day
// off, on top of another booking. Now it asks here first.
//   action 'check'  → that day's open times for the provider, and — for a
//                     chosen time — a plain reason if it won't work
//   action 'move'   → re-checks, then moves the appointment. Same engine +
//                     time frame as /api/appointments/book. Managers may
//                     override ("Move anyway"); the override and its reason
//                     are recorded. Keeps what the dialog did (fee inside the
//                     window, reschedule counts, history), and adds: the
//                     check-in copy is updated, the move is in the activity
//                     log, and the CLIENT IS TOLD (email + text) — before,
//                     nothing ever sent "appointment moved".

import { checkChange, chainAfterMove, hoursToDeadline } from '@/lib/change-rules';
import { bookingPolicyLines } from '@/lib/policy-copy';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { tenantTimeZone, wallToUtc, addDays as addDaysStr } from '@/lib/tenant-time';
import { buildDayContext, computeAvailability, parseClock, verifyBookable } from '@/lib/availability';
import { loadBookingData, engineFrame, FALLBACK_HOURS } from '@/lib/booking-data';

export const dynamic = 'force-dynamic';
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };
const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; // engine frame is "local time written as UTC"

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(appointmentId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const actor = auth.actor; const isManager = !!(actor.isManager || actor.isTenantOwner);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const aRef = db.doc(`${T}/appointments/${appointmentId}`);
  const appt = ((await aRef.get()).data() as any) || null;
  if (!appt) return NextResponse.json({ ok: false, error: 'That appointment wasn’t found.' }, { status: 404 });
  const date = String(b.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: 'Pick a day.' }, { status: 400 });
  const time = b.time ? String(b.time) : ''; if (time && !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ ok: false, error: 'Pick a time.' }, { status: 400 });

  const data = await loadBookingData(db, T); if (!data) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
  const t = data.t; const tz = tenantTimeZone(t);
  const raw = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const staff = raw(data.st).filter((m: any) => m.isActive !== false);
  const renterSvcs = raw(data.rsv).map((x: any) => ({ ...x, staffIds: x.staffId ? [x.staffId] : x.staffIds }));
  const services = [...raw(data.sv), ...renterSvcs];
  const service = services.find((s: any) => s.id === appt.serviceId);
  if (!service) return NextResponse.json({ ok: false, error: 'This appointment’s service no longer exists — edit it instead.' }, { status: 400 });
  const staffId = String(b.staffId || appt.staffId || '');
  const who = staff.find((m: any) => m.id === staffId); const first = String(who?.name || 'This provider').split(' ')[0];
  const duration = Math.max(5, Math.round((Date.parse(appt.endTime) - Date.parse(appt.startTime)) / 60000) || Number(service.duration) || 60);

  // Everyone else's busy time, in the business's local frame (this appointment excluded).
  const frame = engineFrame({ appointments: raw(data.ap).filter((a: any) => a.id !== appointmentId), events: raw(data.ce), staffBlocks: raw(data.sb), tickets: raw(data.tk) }, tz, date);
  const input: any = {
    date, serviceId: service.id, staffId, services: services.map((s: any) => (s.id === service.id ? { ...s, duration } : s)), staff, scheduleProfiles: raw(data.sp), tenant: { id: tenantId, ...t },
    appointments: frame.appointments, events: frame.events, staffBlocks: frame.staffBlocks, tickets: frame.tickets, now: frame.now,
    shifts: raw(data.sh), dayOffBlocks: raw(data.dof), resources: raw(data.rs), maintenancePlans: raw(data.mp),
    fallbackHours: FALLBACK_HOURS, ignoreHeuristics: true, minLeadMinutes: 0, maxHorizonDays: 3650, includeUnavailable: false,
  };

  /** A plain reason a time won't work — for staff, so they can decide. */
  const explain = (tm: string): string | null => {
    const startUtc = wallToUtc(date, Number(tm.slice(0, 2)), Number(tm.slice(3, 5)), tz);
    if (startUtc.getTime() < Date.now() - 60000) return 'That time has passed.';
    const v = verifyBookable({ ...input, time: tm, requireStaffId: staffId });
    if (v.ok) return null;
    const off = raw(data.dof).find((o: any) => o.staffId === staffId && o.date === date && ['approved', 'confirmed', undefined].includes(o.status));
    if (off) return `${first} has the day off.`;
    const ctx = buildDayContext(input); const day = ctx?.byId?.[staffId];
    if (!day) return `${first} isn’t scheduled that day.`;
    const s = ctx ? parseClock(tm, ctx.dateObj) : null; const e = s ? new Date(s.getTime() + duration * 60000) : null;
    if (s && e && (s < day.open || e > day.close)) return `Outside ${first}’s hours that day (${clock(hhmm(day.open))} – ${clock(hhmm(day.close))}).`;
    if (s && e) {
      const clash = frame.appointments.find((a: any) => a.staffId === staffId && Date.parse(a.startTime) < e.getTime() && Date.parse(a.endTime) > s.getTime());
      if (clash) { const cs = new Date(clash.startTime); return `Clashes with ${clash.clientName || 'another booking'}${clash.serviceName ? `’s ${clash.serviceName}` : ''} at ${clock(hhmm(cs))}.`; }
    }
    return v.error || 'That time isn’t available.';
  };

  // 'range' — each day's open times for up to 6 weeks (calendar dots and the
  // "same time, later" suggestions), plus who else can do this service.
  if (b.action === 'range') {
    const n = Math.max(1, Math.min(42, Number(b.days) || 31)); const out: { date: string; times: string[] }[] = [];
    for (let i = 0; i < n; i++) {
      const d = addDaysStr(date, i);
      const f = engineFrame({ appointments: raw(data.ap).filter((a: any) => a.id !== appointmentId), events: raw(data.ce), staffBlocks: raw(data.sb), tickets: raw(data.tk) }, tz, d);
      let times: string[] = []; try { times = computeAvailability({ ...input, date: d, appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now }).times; } catch { /* unreadable day */ }
      out.push({ date: d, times });
    }
    const providers = staff.filter((m: any) => !(m.isRenter && m.bookingOptOut === true) && (!service.requiredSkills?.length || service.requiredSkills.every((k: string) => (m.skillSet || []).includes(k))) && (!service.staffIds?.length || service.staffIds.includes(m.id)))
      .map((m: any) => ({ id: m.id, name: m.name || 'Team member', avatarUrl: m.avatarUrl || null }));
    return NextResponse.json({ ok: true, days: out, providers, duration, staffId });
  }

  if (b.action === 'check') {
    const r = computeAvailability(input);
    return NextResponse.json({ ok: true, times: r.times, reason: time ? explain(time) : null, duration, staffName: who?.name || null, policyNote: checkChange(t, appt, 'staff', service).staffNote });
  }

  if (b.action !== 'move' || !time) return NextResponse.json({ ok: false, error: 'Pick a time.' }, { status: 400 });
  const reason = explain(time);
  if (reason && !(b.override === true && isManager && reason !== 'That time has passed.')) {
    return NextResponse.json({ ok: false, error: reason, canOverride: isManager && reason !== 'That time has passed.' }, { status: 409 });
  }
  const start = wallToUtc(date, Number(time.slice(0, 2)), Number(time.slice(3, 5)), tz); const end = new Date(start.getTime() + duration * 60000);
  const nowIso = new Date().toISOString();
  const fee = Number(t.rescheduleFee || 0), windowH = Number(t.rescheduleFeeWindowHours || 0);
  // The fee window counts from the ORIGINAL time (Booking policies → deadline), so moving twice can't dodge it.
  const inWindow = fee > 0 && windowH > 0 && hoursToDeadline(t, appt, service) < windowH;
  const rule = checkChange(t, appt, 'staff', service);   // staff are never blocked — but it's recorded
  const applyFee = inWindow && b.applyFee !== false;
  const { FieldValue } = await import('firebase-admin/firestore');
  const batch = db.batch();
  const auditId = `resched_${appointmentId}_${Date.now()}`;
  batch.set(aRef, {
    startTime: start.toISOString(), endTime: end.toISOString(), staffId, ...(who?.name ? { staffName: who.name } : {}),
    rescheduledFromTime: appt.startTime, rescheduleCount: FieldValue.increment(1), originalStartTime: chainAfterMove(appt).originalStartTime,
    ...(rule.staffNote ? { lastChangePastPolicy: rule.staffNote } : {}), changeRequestedAt: null, lastRescheduledAt: nowIso, lastRescheduledBy: actor.uid || actor.name || 'staff',
    ...(['requested', 'pending_payment', 'cancelled'].includes(appt.status) ? {} : { status: 'confirmed' }), checkInStatus: 'pending',
    ...(applyFee ? { rescheduleFeeApplied: fee } : {}),
    rescheduleAuditTrail: FieldValue.arrayUnion({ id: auditId, fromTime: appt.startTime, toTime: start.toISOString(), at: nowIso, byId: actor.uid || null, byName: actor.name || null, feeApplied: applyFee ? fee : 0, ...(reason ? { overrode: reason } : {}) }),
  }, { merge: true });
  if (appt.checkInToken) batch.set(db.doc(`appointmentCheckIns/${appt.checkInToken}`), { startTime: start.toISOString(), endTime: end.toISOString(), staffId }, { merge: true });
  if (appt.clientId) batch.set(db.doc(`${T}/clients/${appt.clientId}`), { rescheduleCount: FieldValue.increment(1), ...(applyFee ? { outstandingBalance: FieldValue.increment(fee), unpaidFees: FieldValue.arrayUnion({ feeId: auditId, appointmentId, appointmentDate: nowIso, feeAmount: fee, reason: 'reschedule_fee' }) } : {}) }, { merge: true });
  await batch.commit();

  const whenOld = new Date(appt.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  const whenNew = start.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  await logAuditAdmin(db, tenantId, { action: 'appointment.reschedule', targetType: 'appointment', targetId: appointmentId,
    summary: `Moved ${appt.clientName || 'appointment'} from ${whenOld} to ${whenNew}${staffId !== appt.staffId && who?.name ? ` (now with ${who.name})` : ''}${applyFee ? ` · $${fee} reschedule fee` : ''}${reason ? ` · OVERRIDE: ${reason}` : ''}${rule.staffNote ? ` — ${rule.staffNote}` : ''}`,
    before: { startTime: appt.startTime, staffId: appt.staffId }, after: { startTime: start.toISOString(), staffId },
    actor: { type: 'user', id: actor.uid, name: actor.name, role: actor.role, via: 'planner' } }).catch(() => {});

  // Tell the client — "they will otherwise arrive at the old time".
  let told = { email: false, sms: false };
  if (b.notify !== false) {
    try {
      const cl = appt.clientId ? (((await db.doc(`${T}/clients/${appt.clientId}`).get()).data() as any) || {}) : {};
      const email = appt.clientEmail || cl.email || null; const phone = appt.clientPhone || cl.phone || null;
      const svcName = service.name || appt.serviceName || 'appointment'; const studio = t.name || 'Your studio';
      const base = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
      const link = appt.checkInToken ? `${base}/check-in/${appt.checkInToken}` : null;
      const { sendNotification } = await import('@/lib/notify');
      const { brandedEmailHtml } = await import('@/lib/email-template');
      if (email) {
        const r = await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'appointment_rescheduled', subject: `Your ${svcName} has moved — ${whenNew}`,
          html: brandedEmailHtml({ studioName: studio, title: 'Your appointment has moved', bodyLines: [`Hi ${String(appt.clientName || '').split(' ')[0] || 'there'} — your ${svcName} is now on ${whenNew}${who?.name ? ` with ${who.name}` : ''}.`, `(It was ${whenOld}.)`, ...(applyFee ? [`A $${fee.toFixed(2)} reschedule fee applies, as it was moved within ${windowH} hours of the time.`] : []), 'If the new time doesn’t work, just reply or give us a call.', ...bookingPolicyLines(t, service).filter((l, i) => i === 0 || /^Running late/.test(l))],
            ...(link ? { cta: { label: 'View my appointment', url: link } } : {}) }),
          recipientType: 'client', recipientId: appt.clientId || null, recipientName: appt.clientName || null, appointmentId } as any).catch(() => null);
        told.email = (r as any)?.status === 'sent';
      }
      if (phone) {
        const r = await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'appointment_rescheduled', text: `${studio}: your ${svcName} has moved to ${whenNew}.${link ? ` ${link}` : ''}`,
          recipientType: 'client', recipientId: appt.clientId || null, recipientName: appt.clientName || null, appointmentId } as any).catch(() => null);
        told.sms = (r as any)?.status === 'sent';
      }
    } catch (e) { console.error('[reschedule] client message failed (the move stands)', e); }
  }
  return NextResponse.json({ ok: true, policyNote: rule.staffNote, startTime: start.toISOString(), endTime: end.toISOString(), staffId, feeApplied: applyFee ? fee : 0, told, overrode: reason || null, auditId });
}
