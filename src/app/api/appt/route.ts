// src/app/api/appt/route.ts
//
// CLIENT SELF-SERVE for appointments — the engine behind the Cancel /
// Reschedule / Running-late buttons in confirmation and reminder
// messages. Auth is a per-appointment ACTION TOKEN (appointment doc's
// manageToken): the link in the client's own email/text is their key,
// scoped to that one appointment. No accounts, no dashboard exposure.
//
// POST { action, tenantId, apptId, k, ... }
//   'view'        → appointment details + policy + this studio's info
//   'cancel'      → cancels (inside the studio's cancel window), frees
//                   the slot, notifies owner + staff
//   'reschedule'  { newDate, newTime } → conflict-checked move on the SAME
//                   staff member; keeps duration; notifies owner + staff.
//                   The client sends WALL-CLOCK ('2026-07-16', '14:30') and
//                   the server turns it into an instant using the studio's
//                   zone. It used to send a finished ISO instant built in the
//                   browser from a fixed offset suffix, which booked every
//                   summer reschedule an hour off. { newStartIso } is still
//                   accepted so an older cached page keeps working.
//   'late'        → one-tap "running late" note to staff + owner
// GET ?tenantId=&apptId=&k=&ics=1 → calendar file (.ics)
//
// Every action stamps the appointment and writes the audit log — client
// self-service leaves the same paper trail as front-desk service.

import { resolvePolicy } from '@/lib/booking-policies';
import { checkChange, chainAfterMove, deadlineStart, hoursToDeadline } from '@/lib/change-rules';
import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { smsConfigured, sendTenantSms } from '@/lib/sms';
import { addDays, formatDateTime, isValidTimeZone, tenantTimeZone, todayIn, wallToUtc } from '@/lib/tenant-time';

const overlaps = (s1: number, e1: number, s2: number, e2: number) => s1 < e2 && s2 < e1;

async function loadAuthed(db: any, tenantId: string, apptId: string, k: any) {
  if (!tenantId || !apptId || !k || String(k).length < 16) return null;
  const ref = db.doc(`tenants/${tenantId}/appointments/${apptId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const a = snap.data() as any;
  // v18 — two accepted keys: the manageToken (from email links) OR the
  // appointment's checkInToken (the master /check-in portal's own token),
  // so the portal's reschedule view authenticates with the key it already
  // has. Both are long random secrets delivered only to the client.
  const key = String(k);
  const ok = (a.manageToken && a.manageToken === key) || (a.checkInToken && a.checkInToken === key);
  if (!ok) return null;
  return { ref, a };
}

async function notifyStaffAndOwner(db: any, tenantId: string, a: any, message: string) {
  try {
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({ id: nRef.id, type: 'appointment', read: false, createdAt: new Date().toISOString(), link: '/planner', message });
  } catch { /* best-effort */ }
  try {
    if (a.staffId && smsConfigured()) {
      const s = (await db.doc(`tenants/${tenantId}/staff/${a.staffId}`).get()).data() as any;
      if (s?.phone) await sendTenantSms(db, tenantId, s.phone, message);
    }
  } catch { /* text is a bonus */ }
}

/** The time a client reads. Takes the studio's zone when it has one, and
 *  falls back to the stored fixed offset otherwise — same migration ladder as
 *  the reminder cron, and for the same reason: a correct zone is better, but
 *  nobody's times should silently shift by an hour because we improved the
 *  code. An offset cannot know that -300 becomes -240 in March, so every
 *  "when" label here was an hour out for eight months of the year. */
const fmtWhen = (iso: string, tzOffset: number, zone?: string | null) => {
  if (zone) return formatDateTime(iso, zone);
  const d = new Date(new Date(iso).getTime() + tzOffset * 60000);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}`;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId, apptId } = body || {};
    if (!action || !tenantId || !apptId) return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    const db = getAdminDb();
    const authed = await loadAuthed(db, tenantId, apptId, body.k);
    if (!authed) return NextResponse.json({ ok: false, error: 'This link is no longer valid — call the studio and we\'ll help.' }, { status: 401 });
    const { ref, a } = authed;

    const tDoc = (await db.doc(`tenants/${tenantId}`).get()).data() as any || {};
    const studioName = tDoc.name || tDoc.businessName || 'The studio';
    const cfg = tDoc.clientNotify || {};
    // Your cancellation window from Booking policies (the old hidden clientNotify.cancelHours is retired).
    const cancelHours = Math.max(0, Number(resolvePolicy(tDoc).cancel.windowHours.value) || 24);
    // v19 — RESCHEDULING has its OWN, much shorter cutoff (default 2h,
    // configurable via clientNotify.rescheduleCutoffHours). Psychology:
    // a reschedule KEEPS the booking and the revenue — every one you
    // allow is a cancellation or no-show you avoided. Only cancellation
    // (money walking out) uses the longer fee window, and even then the
    // fee engine recovers the cost rather than forcing a phone call.
    // The one change cutoff, from Booking policies (reads this older setting too).
    const rescheduleCutoffHours = Math.max(0, Number(resolvePolicy(tDoc).change.cutoffHours.value) || 0);
    const tzOffset = Number.isFinite(Number(cfg.tzOffsetMinutes)) ? Number(cfg.tzOffsetMinutes) : -300;
    // An IANA zone wins where the studio has set one; otherwise the legacy
    // offset above still drives everything, unchanged.
    const hasZone = isValidTimeZone(tDoc.timezone) || isValidTimeZone(tDoc.timeZone) || isValidTimeZone(tDoc.retailSettings?.timezone);
    const zone = hasZone ? tenantTimeZone(tDoc) : null;
    // Deadlines count from the booking's ORIGINAL time unless the business chose otherwise.
    const startMs = deadlineStart(tDoc, a).getTime();
    const insideWindow = Date.now() <= startMs - cancelHours * 3600000;
    // Moving it: the shared change rules (cutoff + how many times it's been moved).
    // When WE asked them to move it (running late → "please pick a new time"), the usual cutoff and change limit don't apply.
    const change = a.studioAskedToMove ? { ...checkChange(tDoc, a, 'client'), allowed: true, needsApproval: false, blocked: false, reason: null } : checkChange(tDoc, a, 'client');
    const insideRescheduleWindow = change.allowed;
    // Your reschedule fee (Booking policies) — counted from the ORIGINAL time; none when WE asked them to move it; renters keep their own rules.
    const rp = resolvePolicy(tDoc).change;
    const rFee = Number(rp.fee.value) || 0, rWin = Number(rp.feeWindowHours.value) || 0;
    const feeIfMovedNow = !a.studioAskedToMove && !a.isRenterBooking && rFee > 0 && rWin > 0 && hoursToDeadline(tDoc, a) < rWin ? rFee : 0;
    // Over the change limit and the business approves further moves → tell the team, ONCE, with the client's note.
    const requestChange = async (note: string | null) => {
      if (a.changeRequestedAt) return false;
      const nowIso = new Date().toISOString();
      await ref.set({ changeRequestedAt: nowIso, ...(note ? { changeRequestNote: note } : {}) }, { merge: true }).catch(() => {});
      const n = db.collection(`tenants/${tenantId}/notifications`).doc();
      await n.set({ id: n.id, userId: null, read: false, createdAt: nowIso, type: 'change_request', link: 'pos',
        message: `${a.clientName || 'A client'} wants to move their ${a.serviceName || 'appointment'} again (already moved ${change.count} time${change.count === 1 ? '' : 's'})${note ? ` — “${note}”` : ''}. Please move it for them.` }).catch(() => {});
      await logAuditAdmin(db, tenantId, { action: 'appointment.change_requested', targetType: 'appointment', targetId: apptId, summary: `${a.clientName || 'Client'} asked to move it again — over the change limit (${change.count}/${change.limit}), staff approval needed${note ? `: “${note}”` : ''}`, actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'visit link' } }).catch(() => {});
      return true;
    };
    const already = ['cancelled', 'canceled', 'completed', 'no_show'].includes(String(a.status || ''));

    if (action === 'view') {
      return NextResponse.json({
        ok: true, studioName,
        appt: {
          serviceName: a.serviceName || a.service || 'Appointment',
          staffName: a.staffName || null,
          startTime: a.startTime, endTime: a.endTime || null,
          status: a.status || 'confirmed',
          whenLabel: fmtWhen(a.startTime, tzOffset, zone),
        },
        policy: {
          cancelHours, canChange: insideWindow && !already, tzOffsetMinutes: tzOffset,
          rescheduleCutoffHours, canReschedule: insideRescheduleWindow && !already,
          changeRule: change.allowed ? null : { reason: change.reason, needsApproval: change.needsApproval, count: change.count, limit: change.limit },
          rescheduleFee: feeIfMovedNow, rescheduleFeeWindowHours: rWin,
          // The earliest date the CLIENT may pick, on the STUDIO's calendar.
          // The pages used to compute this from the browser's clock, so a
          // client travelling — or simply awake late — could be offered a
          // date the studio already considers past.
          earliestDate: zone ? addDays(todayIn(zone), 1) : addDays(todayIn(null, new Date(Date.now() + tzOffset * 60000)), 1),
          timeZone: zone || null,
        },
      });
    }

    if (already) return NextResponse.json({ ok: false, error: 'This appointment is already finished or cancelled.' }, { status: 409 });

    if (action === 'late') {
      const nowIso = new Date().toISOString();
      await ref.set({ clientRunningLateAt: nowIso }, { merge: true });
      await notifyStaffAndOwner(db, tenantId, a, `${a.clientName || 'Your client'} is running late for ${fmtWhen(a.startTime, tzOffset, zone)} — they tapped "running late".`);
      return NextResponse.json({ ok: true });
    }

    if (action === 'cancel') {
      // Inside the window, cancelling goes through the visit link, where your late-cancellation policy (and fee) applies.
      if (!insideWindow) return NextResponse.json({ ok: false, error: `It’s within ${cancelHours} hours of your appointment, so a late-cancellation policy applies — cancel from your visit link to see exactly what that means, or call us.`, visitLink: a.checkInToken ? `/check-in/${a.checkInToken}` : null }, { status: 422 });
      const nowIso = new Date().toISOString();
      const cancelFields = { status: 'cancelled', cancelledAt: nowIso, cancelledBy: 'client_self_serve' };
      await ref.set(cancelFields, { merge: true });
      if (a.checkInToken) {
        // The portal she is standing on reads the mirror, so it has to move too.
        await Promise.all([
          db.doc(`appointmentCheckIns/${a.checkInToken}`).set({ ...cancelFields, tenantId }, { merge: true }).catch(() => {}),
          db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`).set({ ...cancelFields, tenantId }, { merge: true }).catch(() => {}),
        ]);
      }

      // ── THE REST OF THE SAME VISIT ────────────────────────────────────────
      // A multi-provider visit is stored as one row per leg. Cancelling only
      // the leg she happened to tap left her booked for the others: the studio
      // still expected her, the chairs stayed held, and she got a reminder for
      // an appointment she believed she had cancelled. The legs go together.
      //
      // A party is one row per GUEST — different people — so a guest cancelling
      // never touches anyone else. Only the organizer's row cancels the party,
      // which is what cancelling a party of five means.
      const visitId = a.multiProviderGroupId || null;
      const partyId = a.isPrimaryGroup ? (a.groupBookingId || null) : null;
      let alsoCancelled = 0;
      if (visitId || partyId) {
        const apptsCol = db.collection(`tenants/${tenantId}/appointments`);
        const sibSnaps = await Promise.all([
          visitId ? apptsCol.where('multiProviderGroupId', '==', visitId).get().catch(() => ({ docs: [] as any[] })) : Promise.resolve({ docs: [] as any[] }),
          partyId ? apptsCol.where('groupBookingId', '==', partyId).get().catch(() => ({ docs: [] as any[] })) : Promise.resolve({ docs: [] as any[] }),
        ]);
        const seen = new Set<string>([apptId]);
        for (const snap of sibSnaps) {
          for (const d of (snap as any).docs) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            const s = d.data() as any;
            if (['cancelled', 'canceled', 'completed', 'no_show'].includes(String(s.status || ''))) continue;
            const sib = { ...cancelFields, cancelledWithAppointmentId: apptId };
            await d.ref.set(sib, { merge: true }).catch(() => {});
            if (s.checkInToken) {
              await Promise.all([
                db.doc(`appointmentCheckIns/${s.checkInToken}`).set({ ...sib, tenantId }, { merge: true }).catch(() => {}),
                db.doc(`tenants/${tenantId}/appointmentCheckIns/${s.checkInToken}`).set({ ...sib, tenantId }, { merge: true }).catch(() => {}),
              ]);
            }
            alsoCancelled++;
          }
        }
      }

      const extra = alsoCancelled > 0
        ? ` This freed ${alsoCancelled + 1} linked bookings on the same visit.`
        : '';
      await notifyStaffAndOwner(db, tenantId, a, `${a.clientName || 'A client'} cancelled ${fmtWhen(a.startTime, tzOffset, zone)}${a.staffName ? ` with ${a.staffName}` : ''} (self-serve). The slot is open again.${extra}`);
      await logAuditAdmin(db, tenantId, {
        action: 'appointment.client_cancelled', targetType: 'appointment', targetId: apptId,
        summary: `${a.clientName || 'Client'} self-cancelled ${fmtWhen(a.startTime, tzOffset, zone)}${alsoCancelled > 0 ? ` (+${alsoCancelled} linked)` : ''}`,
        actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'manage-link' },
      });
      return NextResponse.json({ ok: true, ...(alsoCancelled > 0 ? { alsoCancelled } : {}) });
    }

    // "Ask us to move it" — when the change limit needs the team's OK.
    if (action === 'request_change') {
      if (change.allowed) return NextResponse.json({ ok: false, error: 'You can move this one yourself — pick a new time.' }, { status: 400 });
      if (!change.needsApproval) return NextResponse.json({ ok: false, error: change.reason }, { status: 409 });
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
      const first = await requestChange(note || null);
      return NextResponse.json({ ok: true, requested: true, alreadyAsked: !first });
    }
    if (action === 'reschedule') {
      if (!change.allowed) {
        if (change.needsApproval) await requestChange(null);
        return NextResponse.json({ ok: false, error: change.reason, requested: change.needsApproval }, { status: 409 });
      }
      // WALL CLOCK IN, INSTANT OUT. '2026-07-16' + '14:30' means half past two
      // on the studio's wall — a fact only the server can turn into a moment,
      // because only it knows the zone and whether daylight saving applies on
      // that date. newStartIso stays accepted for pages served before this.
      const newDate = String(body.newDate || '').slice(0, 10);
      const newTime = String(body.newTime || '').slice(0, 5);
      let newStart: Date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(newDate) && /^\d{2}:\d{2}$/.test(newTime)) {
        const [hh, mm] = newTime.split(':').map(Number);
        newStart = zone
          ? wallToUtc(newDate, hh, mm, zone)
          : new Date(Date.UTC(+newDate.slice(0, 4), +newDate.slice(5, 7) - 1, +newDate.slice(8, 10), hh, mm) - tzOffset * 60000);
      } else {
        newStart = new Date(String(body.newStartIso || ''));
      }
      if (Number.isNaN(newStart.getTime())) return NextResponse.json({ ok: false, error: 'Pick a date and time.' }, { status: 400 });
      const nowMs = Date.now();
      if (newStart.getTime() < nowMs + 2 * 3600000) return NextResponse.json({ ok: false, error: 'Pick a time at least 2 hours from now.' }, { status: 422 });
      if (newStart.getTime() > nowMs + 60 * 86400000) return NextResponse.json({ ok: false, error: 'Pick a time within the next 60 days.' }, { status: 422 });

      const durMs = Math.max(15 * 60000, new Date(a.endTime || a.startTime).getTime() - startMs || 60 * 60000);
      const newEnd = new Date(newStart.getTime() + durMs);
      // Conflict check against the SAME staff member's calendar, honoring pads.
      const dayStart = new Date(newStart.getTime() - 86400000).toISOString();
      const dayEnd = new Date(newEnd.getTime() + 86400000).toISOString();
      const result = await db.runTransaction(async (tx: any) => {
        const nearby = await tx.get(db.collection(`tenants/${tenantId}/appointments`)
          .where('startTime', '>=', dayStart).where('startTime', '<=', dayEnd));
        for (const d of nearby.docs) {
          if (d.id === apptId) continue;
          const o = d.data() as any;
          if (o.staffId !== a.staffId || ['cancelled', 'canceled'].includes(String(o.status || ''))) continue;
          const oS = new Date(o.startTime).getTime() - (Number(o.padBefore) || 0) * 60000;
          const oE = new Date(o.endTime || o.startTime).getTime() + (Number(o.padAfter) || 0) * 60000;
          if (overlaps(newStart.getTime(), newEnd.getTime(), oS, oE)) return { conflict: true };
        }
        const move = {
          ...chainAfterMove(a),   // remembers the original time + how many times it has moved
          ...(feeIfMovedNow > 0 ? { rescheduleFeeApplied: feeIfMovedNow } : {}),
          // A new time is a fresh start: no longer late, no longer asked to move.
          studioAskedToMove: false, lateReply: null, checkInStatus: null, lateTimeMinutes: null, clientCheckInStatus: null, clientLateMinutes: null, clientEtaAt: null, etaAt: null, clientLateNote: null, clientTrip: null,
          startTime: newStart.toISOString(), endTime: newEnd.toISOString(),
          rescheduledAt: new Date().toISOString(), rescheduledBy: 'client_self_serve',
          previousStartTime: a.startTime,
          reminderSentAt: null, // the new time earns its own reminder
        };
        tx.set(ref, move, { merge: true });
        // v18 — keep the check-in MIRRORS in step: the master portal reads
        // appointmentCheckIns/{token}, so without this the portal would
        // keep showing the old time after a successful move.
        if (a.checkInToken) {
          tx.set(db.doc(`tenants/${tenantId}/appointmentCheckIns/${a.checkInToken}`), move, { merge: true });
          tx.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), move, { merge: true });
        }
        return { conflict: false };
      });
      if (!result.conflict && feeIfMovedNow > 0 && a.clientId) {
        const feeId = `rf_${Date.now().toString(36)}`;
        await db.doc(`tenants/${tenantId}/clients/${a.clientId}`).set({ outstandingBalance: FieldValue.increment(feeIfMovedNow),
          unpaidFees: FieldValue.arrayUnion({ feeId, appointmentId: apptId, appointmentDate: new Date().toISOString(), feeAmount: feeIfMovedNow, reason: 'reschedule_fee' }) }, { merge: true }).catch(() => {});
      }
      if (result.conflict) return NextResponse.json({ ok: false, error: `${a.staffName || 'That staff member'} is booked then — try another time.` }, { status: 409 });
      await notifyStaffAndOwner(db, tenantId, a,
        `${a.clientName || 'A client'} moved their appointment${a.staffName ? ` with ${a.staffName}` : ''}: ${fmtWhen(a.startTime, tzOffset, zone)} → ${fmtWhen(newStart.toISOString(), tzOffset, zone)} (self-serve).`);
      await logAuditAdmin(db, tenantId, {
        action: 'appointment.client_rescheduled', targetType: 'appointment', targetId: apptId,
        summary: `${a.clientName || 'Client'} self-rescheduled to ${fmtWhen(newStart.toISOString(), tzOffset, zone)}${feeIfMovedNow > 0 ? ` · $${feeIfMovedNow.toFixed(2)} reschedule fee added to their balance` : ''}${a.studioAskedToMove ? ' (we asked them to choose a new time)' : ''}`,
        actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'manage-link' },
      });
      return NextResponse.json({ ok: true, newStartIso: newStart.toISOString(), whenLabel: fmtWhen(newStart.toISOString(), tzOffset, zone), feeApplied: feeIfMovedNow });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[appt] failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — try again.' }, { status: 500 });
  }
}

// ── Add to calendar (.ics) ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId') || '';
    const apptId = url.searchParams.get('apptId') || '';
    const k = url.searchParams.get('k') || '';
    const db = getAdminDb();
    const authed = await loadAuthed(db, tenantId, apptId, k);
    if (!authed) return new NextResponse('Link expired', { status: 401 });
    const { a } = authed;
    const tDoc = (await db.doc(`tenants/${tenantId}`).get()).data() as any || {};
    const studioName = tDoc.name || 'Studio';
    const dt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClarityFlow//EN', 'BEGIN:VEVENT',
      `UID:${apptId}@clarityflow`,
      `DTSTART:${dt(a.startTime)}`,
      `DTEND:${dt(a.endTime || new Date(new Date(a.startTime).getTime() + 3600000).toISOString())}`,
      `SUMMARY:${(a.serviceName || 'Appointment')} — ${studioName}`.replace(/[\n,;]/g, ' '),
      `DESCRIPTION:${studioName}${a.staffName ? ` with ${a.staffName}` : ''}`.replace(/[\n,;]/g, ' '),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return new NextResponse(ics, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="appointment.ics"' },
    });
  } catch { return new NextResponse('Error', { status: 500 }); }
}
