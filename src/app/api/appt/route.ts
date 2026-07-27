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
//   'reschedule'  { newStartIso } → conflict-checked move on the SAME
//                   staff member; keeps duration; notifies owner + staff
//   'late'        → one-tap "running late" note to staff + owner
// GET ?tenantId=&apptId=&k=&ics=1 → calendar file (.ics)
//
// Every action stamps the appointment and writes the audit log — client
// self-service leaves the same paper trail as front-desk service.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { smsConfigured, sendTenantSms } from '@/lib/sms';

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

const fmtWhen = (iso: string, tzOffset: number) => {
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
    const cancelHours = Number.isFinite(Number(cfg.cancelHours)) ? Math.max(0, Number(cfg.cancelHours)) : 24;
    // v19 — RESCHEDULING has its OWN, much shorter cutoff (default 2h,
    // configurable via clientNotify.rescheduleCutoffHours). Psychology:
    // a reschedule KEEPS the booking and the revenue — every one you
    // allow is a cancellation or no-show you avoided. Only cancellation
    // (money walking out) uses the longer fee window, and even then the
    // fee engine recovers the cost rather than forcing a phone call.
    const rescheduleCutoffHours = Number.isFinite(Number(cfg.rescheduleCutoffHours)) ? Math.max(0, Number(cfg.rescheduleCutoffHours)) : 2;
    const tzOffset = Number.isFinite(Number(cfg.tzOffsetMinutes)) ? Number(cfg.tzOffsetMinutes) : -300;
    const startMs = new Date(a.startTime).getTime();
    const insideWindow = Date.now() <= startMs - cancelHours * 3600000;
    const insideRescheduleWindow = Date.now() <= startMs - rescheduleCutoffHours * 3600000;
    const already = ['cancelled', 'canceled', 'completed', 'no_show'].includes(String(a.status || ''));

    if (action === 'view') {
      return NextResponse.json({
        ok: true, studioName,
        appt: {
          serviceName: a.serviceName || a.service || 'Appointment',
          staffName: a.staffName || null,
          startTime: a.startTime, endTime: a.endTime || null,
          status: a.status || 'confirmed',
          whenLabel: fmtWhen(a.startTime, tzOffset),
        },
        policy: {
          cancelHours, canChange: insideWindow && !already, tzOffsetMinutes: tzOffset,
          rescheduleCutoffHours, canReschedule: insideRescheduleWindow && !already,
        },
      });
    }

    if (already) return NextResponse.json({ ok: false, error: 'This appointment is already finished or cancelled.' }, { status: 409 });

    if (action === 'late') {
      const nowIso = new Date().toISOString();
      await ref.set({ clientRunningLateAt: nowIso }, { merge: true });
      await notifyStaffAndOwner(db, tenantId, a, `${a.clientName || 'Your client'} is running late for ${fmtWhen(a.startTime, tzOffset)} — they tapped "running late".`);
      return NextResponse.json({ ok: true });
    }

    if (action === 'cancel') {
      if (!insideWindow) return NextResponse.json({ ok: false, error: `Online cancellation closes ${cancelHours}h before the appointment — call the studio and we'll sort it out.` }, { status: 422 });
      const nowIso = new Date().toISOString();
      await ref.set({ status: 'cancelled', cancelledAt: nowIso, cancelledBy: 'client_self_serve' }, { merge: true });
      await notifyStaffAndOwner(db, tenantId, a, `${a.clientName || 'A client'} cancelled ${fmtWhen(a.startTime, tzOffset)}${a.staffName ? ` with ${a.staffName}` : ''} (self-serve). The slot is open again.`);
      await logAuditAdmin(db, tenantId, {
        action: 'appointment.client_cancelled', targetType: 'appointment', targetId: apptId,
        summary: `${a.clientName || 'Client'} self-cancelled ${fmtWhen(a.startTime, tzOffset)}`,
        actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'manage-link' },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'reschedule') {
      if (!insideRescheduleWindow) return NextResponse.json({ ok: false, error: `Online rescheduling closes ${rescheduleCutoffHours}h before the appointment — call the studio and we'll sort it out.` }, { status: 422 });
      const newStart = new Date(String(body.newStartIso || ''));
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
      if (result.conflict) return NextResponse.json({ ok: false, error: `${a.staffName || 'That staff member'} is booked then — try another time.` }, { status: 409 });
      await notifyStaffAndOwner(db, tenantId, a,
        `${a.clientName || 'A client'} moved their appointment${a.staffName ? ` with ${a.staffName}` : ''}: ${fmtWhen(a.startTime, tzOffset)} → ${fmtWhen(newStart.toISOString(), tzOffset)} (self-serve).`);
      await logAuditAdmin(db, tenantId, {
        action: 'appointment.client_rescheduled', targetType: 'appointment', targetId: apptId,
        summary: `${a.clientName || 'Client'} self-rescheduled to ${fmtWhen(newStart.toISOString(), tzOffset)}`,
        actor: { type: 'user', name: a.clientName || 'Client', role: 'client', via: 'manage-link' },
      });
      return NextResponse.json({ ok: true, newStartIso: newStart.toISOString(), whenLabel: fmtWhen(newStart.toISOString(), tzOffset) });
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
