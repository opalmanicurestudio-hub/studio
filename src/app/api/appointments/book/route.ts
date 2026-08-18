// src/app/api/appointments/book/route.ts
//
// v11 — THE shared booking engine. Every booking surface (POS Quick Book,
// Add Appointment dialog, public booking page, client portal, walk-in
// kiosk) can call this ONE endpoint instead of each writing appointments
// with its own client-side conflict math.
//
// Why it exists — the failure it prevents: today each surface checks
// availability in the BROWSER, then writes. Two people booking the same
// slot from two surfaces (or two tabs) both pass their local check and
// both write — a silent double-booking. Here the overlap check and the
// write happen inside one Firestore transaction: the second writer is
// re-run against the first writer's appointment and told "just taken."
//
// POST {
//   tenantId, source,                     // source: 'public' | 'portal' | 'kiosk' | 'pos' | ...
//   serviceId, addOnIds?,
//   staffId,                              // a staff id, or 'any' (server resolves fairly)
//   startTime,                            // FULL ISO string incl. offset — the client
//                                         // computes it, so server timezone never matters
//   client: { id } | { name, email?, phone? },   // existing or new
//   notes?, holdOnly?,                    // holdOnly: create as 'pending_payment'
//   depositCents?, inspirationPhotoUrl?,
// }
// → { ok, appointmentId, checkInToken, shortCode, staffId, staffName,
//     startTime, endTime }
// → 409 with a human message when the slot was taken or nobody qualifies.
//
// Notes:
// - Padding (service.padBefore/padAfter) is enforced HERE, identically for
//   every surface — no more drift between each page's overlap math.
// - Check-in doc goes to the scoped path with a legacy mirror (same
//   migration pattern as /api/checkins).
// - 'any' resolution uses the SAME fairness field the POS surfaces use
//   (lastBookingAssignedAt), so all surfaces share one rotation queue.
// - holdOnly creates a 'pending_payment' appointment that HOLDS the slot;
//   the caller confirms after payment (or a cleanup pass releases stale
//   holds after 30 min — see PENDING_HOLD_MS).

// ─── v17 — THE AVAILABILITY CHECK NOW COMES FROM THE SHARED ENGINE ──────────
//
// Everything below the client-resolution step is unchanged. What changed is the
// guard: this route used to carry its own overlap math, which meant it enforced
// LESS than the screens that call it. It checked appointments and nothing else —
// no business hours, no roster, no approved time off, no blocked events, no
// station capacity, no maintenance downtime. So it would happily accept a
// booking at 11 PM, on a tech's approved day off, or into a pedicure chair that
// is out of service, while the UI that offered the slot was applying all of
// those rules. Client and server disagreeing is exactly the bug this endpoint
// was created to end.
//
// It now calls verifyBookable() from src/lib/availability.ts — the same
// function the QuickBook form and the booking grid use — inside the same
// transaction, on appointments it just read. One set of rules, one answer.
//
// TIMEZONES. The engine compares wall-clock times ('10:00' working hours) with
// instants (appointment.startTime). On Vercel this process runs in UTC, so
// everything is shifted into a single frame before the engine sees it: local
// wall clock is read as-is, and every stored instant has the studio's offset
// added. The offset comes from the caller's `tzOffsetMinutes`, else the
// tenant's clientNotify.tzOffsetMinutes (the field the reminder cron already
// uses), else tenant.timezone, else -300 to match the rest of the app.
//
// DEGRADING SAFELY. Each context collection is read with its own catch. If
// `resources` cannot be read, station capacity simply is not enforced — that
// constraint drops out rather than turning every booking into a 500. Anything
// that dropped comes back as `checksSkipped` on the response so it is visible
// instead of silent.
//
// NEW OPTIONAL BODY FIELDS (all safe to omit):
//   tzOffsetMinutes  — minutes local is AHEAD of UTC. Overrides tenant config.
//   minLeadMinutes   — required notice. Ignored for in-studio sources.
//   maxHorizonDays   — how far out bookings are accepted. Ignored in-studio.
//   ignoreShifts     — book someone who is not on the published roster.
//   requireAcceptingWalkIns — walk-in queue only offers opted-in staff.
//
// ONE THING TO EXPECT. This route now enforces the same rules the screens do,
// which means a surface that has NOT been wired up with the full context yet
// can get a 409 it did not get before — for example a page that offers a slot
// without looking at the published roster. That is the server being right and
// the page being behind, and the fix is to pass that page the same data.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { generateShortCode } from '@/lib/short-code';
import { nanoid } from 'nanoid';
import { verifyBookable } from '@/lib/availability';
import { resolveBookingPlan, shouldAutoApprove } from '@/lib/deposit-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PENDING_HOLD_MS = 30 * 60 * 1000;
const MAX_FIELD = 300;

/**
 * Front-desk and in-studio surfaces. These get no required-notice and no
 * booking-horizon limit, because a receptionist must be able to book the person
 * standing in front of them for right now, and to take a booking for next year
 * if the client asks. Public surfaces get the tenant's policy applied.
 */
const IN_STUDIO_SOURCES = [
  'pos', 'pos_quick_book', 'quick_book', 'kiosk', 'walkin', 'walk_in',
  'staff', 'staff_portal', 'admin', 'front_desk', 'add_appointment',
];

/**
 * The same fallback window `useSmartAvailability` uses when a studio has no
 * schedule profile and a staff member has no hours of their own. It MUST match,
 * or an unconfigured studio gets slots offered on screen and refused here.
 */
const LEGACY_FALLBACK_HOURS = { start: '08:00', end: '20:00' };

/** 'yyyy-MM-dd' plus n days, calendar-safe. */
function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minutes local time is AHEAD of UTC for an IANA zone on a given instant. */
function offsetMinutesForZone(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).reduce((acc: any, p) => { acc[p.type] = p.value; return acc; }, {});
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
    );
    if (!Number.isFinite(asUtc)) return null;
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, serviceId, startTime } = body || {};
    const source = String(body.source || 'api').slice(0, 40);
    if (!tenantId || !serviceId || !startTime) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ ok: false, error: 'Invalid start time.' }, { status: 400 });
    }
    if (start.getTime() < Date.now() - 5 * 60 * 1000) {
      return NextResponse.json({ ok: false, error: 'That time is in the past.' }, { status: 400 });
    }

    const db = getAdminDb();

    // ── Catalog, roster, tenant: the three things nothing can proceed without.
    //    Read together, and the add-on durations come out of the catalog we
    //    already have instead of one extra round trip per add-on.
    const [svcListSnap, staffSnap, tenantSnap] = await Promise.all([
      db.collection(`tenants/${tenantId}/services`).get(),
      db.collection(`tenants/${tenantId}/staff`).get(),
      db.doc(`tenants/${tenantId}`).get(),
    ]);
    const services = svcListSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    const roster = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    const tenant = ((tenantSnap.data() as any) || {}) as any;

    const svc = services.find((s: any) => s.id === serviceId);
    if (!svc) return NextResponse.json({ ok: false, error: 'Service not found.' }, { status: 404 });

    const addOnIds: string[] = Array.isArray(body.addOnIds) ? body.addOnIds.slice(0, 10).map(String) : [];
    let addOnMinutes = 0;
    for (const id of addOnIds) {
      const a = services.find((s: any) => s.id === id);
      if (a) addOnMinutes += Number((a as any).duration) || 0;
    }
    const duration = (Number(svc.duration) || 60) + addOnMinutes;
    const padBefore = Number(svc.padBefore) || 0;
    const padAfter = Number(svc.padAfter) || 0;

    const certified: string[] | undefined = Array.isArray(svc.certifiedStaffIds) && svc.certifiedStaffIds.length > 0
      ? svc.certifiedStaffIds : undefined;
    const requestedStaffId = String(body.staffId || 'any');
    if (requestedStaffId !== 'any') {
      const member = roster.find((s: any) => s.id === requestedStaffId);
      if (!member) return NextResponse.json({ ok: false, error: 'Provider not found.' }, { status: 404 });
      if (certified && !certified.includes(requestedStaffId)) {
        return NextResponse.json({ ok: false, error: `${member.name || 'That provider'} isn't certified for this service.` }, { status: 409 });
      }
    }

    // ── ONE TIME FRAME ────────────────────────────────────────────────────────
    // The engine compares wall-clock strings ("we open at 10:00") against
    // instants (an appointment's startTime). This process runs in UTC, so both
    // are moved into the studio's local frame before the engine sees them: every
    // instant gets the offset added, and wall clock is then read straight off it.
    const tzOffset = (() => {
      if (Number.isFinite(Number(body.tzOffsetMinutes))) return Number(body.tzOffsetMinutes);
      const cfg = (tenant.clientNotify || {}) as any;
      if (Number.isFinite(Number(cfg.tzOffsetMinutes))) return Number(cfg.tzOffsetMinutes);
      if (tenant.timezone) {
        const z = offsetMinutesForZone(String(tenant.timezone), start);
        if (z !== null) return z;
      }
      return -300;
    })();
    const shiftMs = tzOffset * 60000;
    /** An instant, re-expressed as the studio's local wall clock. */
    const toLocalIso = (v: any): string | null => {
      if (v === null || v === undefined || v === '') return null;
      const d = v instanceof Date ? v : new Date(String(v));
      if (Number.isNaN(d.getTime())) return null;
      return new Date(d.getTime() + shiftMs).toISOString();
    };
    const localStartIso = new Date(start.getTime() + shiftMs).toISOString();
    const dateStr = localStartIso.slice(0, 10);
    const nowLocal = new Date(Date.now() + shiftMs);

    // ── Every other blocking source, loaded ONCE outside the transaction.
    //    Each read carries its own catch. If `resources` cannot be read, station
    //    capacity is simply not enforced for this booking — that one constraint
    //    drops out instead of turning the whole request into a 500. Bounded
    //    windows use a DATE-PREFIX range, not an ISO-instant range: documents
    //    written with an offset suffix ("...T10:00:00-05:00") sort differently
    //    from ones written with "Z", and a plain instant range silently misses
    //    them — which is exactly how a conflicting appointment becomes invisible.
    const prevDay = shiftDateStr(dateStr, -1);
    const nextDayEnd = `${shiftDateStr(dateStr, 1)}`;
    const dropped: string[] = [];
    const safeRead = async (label: string, q: any): Promise<any[]> => {
      try {
        const snap = await q.get();
        return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
      } catch (e) {
        console.warn(`[appointments/book] could not read ${label} — that check was skipped`, e);
        dropped.push(label);
        return [];
      }
    };
    const col = (name: string) => db.collection(`tenants/${tenantId}/${name}`);

    const [rawEvents, rawShifts, rawStaffBlocks, dayOffBlocks, resources, rawTickets, maintenancePlans, scheduleProfiles] =
      await Promise.all([
        // 31 days back so a month-long closure that straddles this date is seen.
        safeRead('events', col('events')
          .where('startTime', '>=', shiftDateStr(dateStr, -31))
          .where('startTime', '<=', nextDayEnd)),
        safeRead('shifts', col('shifts').where('date', '>=', prevDay).where('date', '<=', nextDayEnd)),
        safeRead('staffBlocks', col('staffBlocks')
          .where('startTime', '>=', prevDay).where('startTime', '<=', nextDayEnd)),
        safeRead('shiftDayOffBlocks', col('shiftDayOffBlocks')
          .where('date', '>=', prevDay).where('date', '<=', nextDayEnd)),
        safeRead('resources', col('resources')),
        safeRead('tickets', col('tickets').where('status', 'in', ['open', 'in_progress'])),
        safeRead('maintenancePlans', col('maintenancePlans')),
        safeRead('scheduleProfiles', col('scheduleProfiles')),
      ]);

    // Shifts are stored as wall-clock 'HH:mm' already, so they are NOT shifted.
    // Everything holding a real instant is.
    const events = rawEvents.map((e: any) => ({
      ...e,
      startTime: toLocalIso(e.startTime) ?? e.startTime,
      endTime: toLocalIso(e.endTime) ?? e.endTime,
    }));
    const staffBlocks = rawStaffBlocks.map((b: any) => ({
      ...b,
      startTime: toLocalIso(b.startTime) ?? b.startTime,
      endTime: toLocalIso(b.endTime) ?? b.endTime,
    }));
    const tickets = rawTickets.map((t: any) => ({ ...t, createdAt: toLocalIso(t.createdAt) ?? t.createdAt }));

    /**
     * In-studio surfaces get no required-notice and no horizon cap, and the
     * tight-scheduling / morning-anchor preferences are treated as suggestions —
     * the front desk must always be able to book the person standing there.
     * Public surfaces get the tenant's policy applied in full.
     */
    const inStudio = IN_STUDIO_SOURCES.includes(source.toLowerCase());

    // ── The race-proof core: check + write in ONE transaction ──
    const aptsRef = db.collection(`tenants/${tenantId}/appointments`);

    const result = await db.runTransaction(async (tx: any) => {
      const nearby = await tx.get(
        aptsRef.where('startTime', '>=', prevDay).where('startTime', '<=', nextDayEnd),
      );
      const liveAppointments: any[] = [];
      for (const d of nearby.docs) {
        const a = d.data() as any;
        const status = String(a.status || '').toLowerCase();
        // Both spellings — the app has written 'cancelled' and 'canceled'.
        if (status === 'cancelled' || status === 'canceled') continue;
        const s = toLocalIso(a.startTime);
        if (!s) continue;
        liveAppointments.push({
          ...a,
          id: a.id || d.id,
          startTime: s,
          endTime: toLocalIso(a.endTime) ?? s,
          createdAt: toLocalIso(a.createdAt) ?? a.createdAt,
        });
      }

      // v12 — FLEXIBLE mode (the walk-in "auto-turn"): when the requested time
      // doesn't work, search forward in 15-min steps for the EARLIEST opening
      // within flexWindowMin. The walk-in kiosk sends startTime=now +
      // flexible:true and gets back "Dana at 1:15". The rotation that picks
      // "Dana" now lives in the engine, shared with every other surface.
      const flexible = body.flexible === true;
      const flexWindowMin = Math.min(Math.max(Number(body.flexWindowMin) || 240, 0), 480);

      const engineContext = {
        serviceId,
        addOnIds,
        staffId: requestedStaffId,
        services,
        staff: roster,
        appointments: liveAppointments,
        events,
        scheduleProfiles,
        tenant,
        shifts: rawShifts,
        staffBlocks,
        dayOffBlocks,
        resources,
        tickets,
        maintenancePlans,
        now: nowLocal,
        fallbackHours: LEGACY_FALLBACK_HOURS,
        ignoreHeuristics: inStudio,
        ignoreShifts: body.ignoreShifts === true,
        minLeadMinutes: inStudio
          ? 0
          : (Number.isFinite(Number(body.minLeadMinutes)) ? Number(body.minLeadMinutes) : undefined),
        maxHorizonDays: inStudio
          ? 3650
          : (Number.isFinite(Number(body.maxHorizonDays)) ? Number(body.maxHorizonDays) : undefined),
        requireAcceptingWalkIns: body.requireAcceptingWalkIns === true,
      };

      let staffId: string | null = null;
      let placedStartMs = start.getTime();
      let firstReason = '';
      const maxOffsetMin = flexible ? flexWindowMin : 0;
      for (let off = 0; off <= maxOffsetMin; off += 15) {
        const candidateMs = start.getTime() + off * 60000;
        const localIso = new Date(candidateMs + shiftMs).toISOString();
        const attempt = verifyBookable({
          ...engineContext,
          date: localIso.slice(0, 10),
          time: localIso.slice(11, 16),
          requireStaffId: requestedStaffId !== 'any' ? requestedStaffId : undefined,
        });
        if (attempt.ok) { staffId = attempt.staffId; placedStartMs = candidateMs; break; }
        if (!firstReason) firstReason = attempt.error;
        if (!flexible) break;
      }
      if (!staffId) {
        const hours = Math.max(1, Math.round(flexWindowMin / 60));
        const who = requestedStaffId !== 'any'
          ? (roster.find((s: any) => s.id === requestedStaffId)?.name?.split(' ')[0] || 'That provider')
          : null;
        if (flexible) {
          return { conflict: who
            ? `${who} has no opening in the next ${hours} hours — see the front desk.`
            : `Everyone's booked for the next ${hours} hours — see the front desk.` };
        }
        // The engine's own sentence is more useful than a generic one: it says
        // whether it was hours, time off, the roster, or a station.
        return { conflict: firstReason || 'No provider is free for that time — pick another slot.' };
      }
      const placedStart = new Date(placedStartMs);
      const placedEnd = new Date(placedStartMs + duration * 60000);

      // ── Client: existing id, or match-by-contact, or create ──
      let clientId = String(body?.client?.id || '');
      let clientName = '';
      // The client RECORD, when we have one — the booking plan reads their
      // history (no-shows, trust flag, completed visits) to decide whether
      // this booking needs a deposit, a card, or the studio's blessing.
      let clientRecord: any = null;
      if (clientId) {
        const c = await tx.get(db.doc(`tenants/${tenantId}/clients/${clientId}`));
        if (!c.exists) return { conflict: 'Client not found.' };
        clientRecord = c.data() as any;
        clientName = clientRecord.name || '';
      } else {
        clientName = String(body?.client?.name || '').slice(0, MAX_FIELD).trim();
        if (!clientName) return { conflict: 'Client name is required.' };
        // v12 — dedupe: a returning walk-in who types the same phone/email
        // reuses their existing profile instead of minting a duplicate.
        const phoneRaw = String(body?.client?.phone || '').slice(0, 40).trim();
        const emailRaw = String(body?.client?.email || '').slice(0, MAX_FIELD).trim();
        let reused: any = null;
        if (phoneRaw) {
          const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('phone', '==', phoneRaw).limit(1));
          if (!hit.empty) reused = hit.docs[0];
        }
        if (!reused && emailRaw) {
          const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('email', '==', emailRaw).limit(1));
          if (!hit.empty) reused = hit.docs[0];
        }
        if (reused) {
          clientId = reused.id;
          clientRecord = reused.data() as any;
          clientName = clientRecord.name || clientName;
        } else {
          const newRef = db.collection(`tenants/${tenantId}/clients`).doc();
          clientId = newRef.id;
          tx.set(newRef, {
            id: clientId,
            name: clientName,
            email: emailRaw || null,
            phone: phoneRaw || null,
            status: 'active',
            lifetimeValue: 0,
            lastAppointment: new Date().toISOString(),
            createdVia: source,
          });
        }
      }

      /* ═══ THE BOOKING PLAN ═══════════════════════════════════════════════
       * One resolver decides status, deposit, charge timing and card
       * requirement from the shop's mode, the service's override, and this
       * client's history. Two deliberate compatibility rules:
       *   • an explicit holdOnly from an older caller still forces a hold —
       *     callers that already knew what they wanted keep working;
       *   • staff-side sources are never made to wait on studio approval.
       * Auto-approval for proven regulars is applied here too, so a request
       * that would have been rubber-stamped never reaches the queue. */
      const staffSide = !['online', 'client', 'portal', 'web'].includes(String(source || '').toLowerCase());
      let plan = resolveBookingPlan({
        tenant, service: svc,
        price: Number(body.price ?? svc.price ?? 0),
        client: clientRecord,
        byStaff: staffSide,
      });
      if (plan.status === 'requested' && shouldAutoApprove(tenant, clientRecord)) {
        plan = { ...plan, status: 'confirmed', chargeTiming: plan.depositCents > 0 ? 'at_booking' : 'never',
          reason: `${plan.reason} — auto-accepted (proven regular)` };
      }
      if (body.holdOnly === true && plan.status === 'confirmed') {
        plan = { ...plan, status: 'pending_payment', reason: 'Caller requested a payment hold' };
      }

      // ── Write the appointment + scoped check-in (legacy mirror) ──
      const aptId = nanoid();
      const token = nanoid(16);
      const shortCode = generateShortCode();
      const nowIso = new Date().toISOString();
      const payload: any = {
        id: aptId, tenantId,
        clientId, clientName,
        serviceId, addOnIds: addOnIds.length > 0 ? addOnIds : null,
        staffId,
        startTime: placedStart.toISOString(),
        endTime: placedEnd.toISOString(),
        padBefore, padAfter,
        // Written onto the appointment so the station-capacity check keeps
        // working for this booking even if the service definition changes later.
        requiredResourceIds: Array.isArray(svc.requiredResourceIds) && svc.requiredResourceIds.length > 0
          ? svc.requiredResourceIds : null,
        status: plan.status,
        source,
        checkInToken: token, shortCode,
        checkInStatus: body.checkInStatus === 'arrived' ? 'arrived' : 'pending',
        depositAmountCents: plan.depositCents,
        // v14 — depositPaid:true = the caller is collecting the deposit at
        // booking time (card on file / terminal). Anything else that owes a
        // deposit starts 'pending'.
        depositStatus: plan.depositCents > 0
          ? (body.depositPaid === true ? 'paid' : 'pending')
          : 'none',
        ...(body.depositPaid === true && plan.depositCents > 0
          ? { depositPaidAt: nowIso } : {}),
        // ── Round V: the booking plan, recorded on the appointment itself ──
        // Written down rather than recomputed, so the queue, the emails, and
        // an owner looking at this six weeks from now all see the rule that
        // actually applied at the moment of booking — not today's settings.
        bookingMode: plan.mode,
        bookingReason: plan.reason,
        chargeTiming: plan.chargeTiming,
        requiresCardOnFile: plan.requiresCardOnFile,
        // Stamped so the requests queue can tell the owner what "Accept"
        // will actually DO — charge the card now, or send a pay link —
        // without reading every client document to render a list.
        hasCardOnFile: !!(clientRecord?.cardOnFile?.customerId && clientRecord?.cardOnFile?.paymentMethodId),
        ...(plan.status === 'requested' ? {
          requestedAt: nowIso,
          requestExpiresAt: plan.approvalExpiryHours > 0
            ? new Date(Date.now() + plan.approvalExpiryHours * 3600000).toISOString()
            : null,
        } : {}),
        notes: body.notes ? String(body.notes).slice(0, 500) : null,
        inspirationPhotoUrl: body.inspirationPhotoUrl ? String(body.inspirationPhotoUrl).slice(0, 500) : null,
        createdAt: nowIso,
        reminderSent: false,
        autoCancelledNoShow: false,
      };
      tx.set(aptsRef.doc(aptId), payload);
      tx.set(db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`), payload);
      tx.set(db.doc(`appointmentCheckIns/${token}`), payload); // TODO: remove after legacy rule closes
      if (requestedStaffId === 'any') {
        tx.set(db.doc(`tenants/${tenantId}/staff/${staffId}`), { lastBookingAssignedAt: nowIso }, { merge: true });
      }
      return { aptId, token, shortCode, staffId, clientId, clientName, plan, placedStartIso: placedStart.toISOString(), placedEndIso: placedEnd.toISOString() };
    });

    if ((result as any).conflict) {
      return NextResponse.json({ ok: false, error: (result as any).conflict }, { status: 409 });
    }
    const r: any = result;
    const staffName = roster.find((s: any) => s.id === r.staffId)?.name || null;

    await logAuditAdmin(db, tenantId, {
      action: 'appointment.booked',
      targetType: 'appointment', targetId: r.aptId,
      summary: `${r.clientName || 'Client'} booked ${svc.name || 'a service'} with ${staffName || 'staff'} — ${String(r.placedStartIso).slice(0, 16).replace('T', ' ')}${body.holdOnly ? ' (awaiting payment)' : ''}`,
      actor: { type: 'user', name: r.clientName || null, role: 'client', via: source },
    });

    // ── v16 — EVERY booking messages the client immediately. Confirmed
    // bookings get the confirmation (code + Manage + Add to calendar).
    // Bookings still owing something (holdOnly / pending_payment) get an
    // "almost booked — finish up" message carrying the check-in link where
    // they pay the deposit and sign forms — because a client who books and
    // hears NOTHING is a front-desk bottleneck waiting to happen. Sends
    // are best-effort: a failure never breaks the booking, it just shows
    // as not-sent so staff can fix the address and resend. Every send —
    // and its delivery/opened/clicked journey via the provider webhooks —
    // lands in messageLog for the appointment timeline.
    const sendStatus = { smsSent: false, emailSent: false };
    {
      try {
        const clientDoc = r.clientId
          ? ((await db.doc(`tenants/${tenantId}/clients/${r.clientId}`).get()).data() as any) || {}
          : {};
        const phone = String(body?.client?.phone || clientDoc.phone || '').trim();
        const email = String(body?.client?.email || clientDoc.email || '').trim();

        // The tenant doc was already read above for the timezone — reuse it
        // rather than paying for the same document twice on every booking.
        const tData = tenant;
        const studioName = tData.name || tData.businessName || 'Your studio';
        const local = new Date(new Date(r.placedStartIso).getTime() + tzOffset * 60000);
        const whenStr = `${local.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} at ${local.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}`;

        // Links live on the PERMANENT domain, never a frozen preview URL.
        const base = String(
          tData.publicOrigin
          || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
          || req.nextUrl.origin,
        ).replace(/\/$/, '');
        // v18 — ONE portal for clients: the master check-in link. Arrival,
        // running-late, concierge, forms/deposit, and the studio's real
        // cancellation flow all live at /check-in/{token}; every button we
        // send points there. The manageToken lives on only as the key for
        // the .ics calendar download (served by /api/appt GET).
        const { ensureApptToken, sendNotification } = await import('@/lib/notify');
        const k = await ensureApptToken(db, tenantId, r.aptId);
        const calendarUrl = k
          ? `${base}/api/appt?tenantId=${encodeURIComponent(tenantId)}&apptId=${encodeURIComponent(r.aptId)}&k=${encodeURIComponent(k)}`
          : null;
        const portalUrl = `${base}/check-in/${r.token}`;
        const firstName = String(r.clientName || '').split(' ')[0] || 'there';
        const isRequest = r.plan?.status === 'requested';
        const isHold = r.plan?.status === 'pending_payment';
        const checkInUrl = portalUrl;
        const svcLabel = svc.name || 'appointment';

        // Email — branded either way; the CONTENT matches the state.
        if (email.includes('@')) {
          const { brandedEmailHtml } = await import('@/lib/email-template');
          const html = isRequest
            ? brandedEmailHtml({
              studioName,
              /* A REQUEST is not a booking, and the email must never let
               * someone believe otherwise — no confirmation code, no
               * "you're booked", and the honest charge position up front. */
              title: 'Request received',
              bodyLines: [
                `Hi ${firstName} — we have your request for ${svcLabel}${staffName ? ` with ${staffName}` : ''} on ${whenStr}.`,
                'This time is not booked yet. We look at every request personally and you will hear back shortly — you do not need to do anything now.',
                ...(r.plan?.depositCents > 0
                  ? [`Nothing has been charged. If we accept, we will ask for the $${(r.plan.depositCents / 100).toFixed(2)} deposit to lock it in.`]
                  : []),
              ],
              cta: { label: 'View my request', url: portalUrl },
              footerNote: `We will confirm or suggest another time as soon as we can — ${studioName}.`,
            })
            : isHold
            ? brandedEmailHtml({
              studioName,
              title: 'Almost booked — one more step',
              bodyLines: [
                `Hi ${firstName} — we're holding ${whenStr} for your ${svcLabel}${staffName ? ` with ${staffName}` : ''}.`,
                'Tap below to finish up (deposit and any forms) and lock it in. Your confirmation follows the moment it\'s done.',
              ],
              cta: { label: 'Finish my booking', url: checkInUrl },
              footerNote: `Your spot is held for a limited time. Questions? Just reply or call — ${studioName}.`,
            })
            : brandedEmailHtml({
              studioName,
              title: "You're confirmed",
              bodyLines: [
                `Hi ${firstName} — your ${svcLabel}${staffName ? ` with ${staffName}` : ''} is booked for ${whenStr}.`,
                'Show the code below when you arrive to check in.',
              ],
              bigCode: r.shortCode ? String(r.shortCode).toUpperCase() : undefined,
              cta: { label: 'Check in / manage my visit', url: portalUrl },
              secondaryCta: calendarUrl ? { label: 'Add to calendar', url: calendarUrl } : null,
              footerNote: `Running late, need to cancel, or want anything during your visit? It's all behind the button above. Sent by ${studioName}.`,
            });
          const er = await sendNotification(db, {
            tenantId, channel: 'email', to: email,
            subject: isRequest
              ? `Request received: ${svcLabel} — ${whenStr}`
              : isHold
                ? `Action needed: finish booking your ${svcLabel}`
                : `Confirmed: ${svcLabel} — ${whenStr}`,
            html, kind: isRequest ? 'booking_request' : isHold ? 'booking_hold' : 'booking_confirmation',
            appointmentId: r.aptId, clientId: r.clientId || null, clientName: r.clientName || null,
          });
          sendStatus.emailSent = !!er.ok;
        }

        // Text — short, matching the state. Routed through sendNotification
        // so it lands in messageLog with delivery tracking, same as email.
        if (phone) {
          const sr = await sendNotification(db, {
            tenantId, channel: 'sms', to: phone,
            text: isRequest
              ? `Request received for ${svcLabel} on ${whenStr} — not booked yet, we'll confirm shortly. ${portalUrl}`
              : isHold
                ? `We're holding ${whenStr} for your ${svcLabel}. Finish up here to lock it in: ${checkInUrl}`
                : `You're confirmed — ${svcLabel}${staffName ? ` with ${staffName}` : ''} on ${whenStr}. Details & check-in: ${portalUrl}`,
            kind: isRequest ? 'booking_request' : isHold ? 'booking_hold' : 'booking_confirmation',
            appointmentId: r.aptId, clientId: r.clientId || null, clientName: r.clientName || null,
          });
          sendStatus.smsSent = !!sr.ok;
        }
      } catch (e) {
        console.error('[appointments/book] confirmation send failed (booking is safe)', e);
      }
    }

    return NextResponse.json({
      ok: true,
      appointmentId: r.aptId,
      checkInToken: r.token,
      shortCode: r.shortCode,
      staffId: r.staffId,
      staffName,
      clientId: r.clientId,
      startTime: r.placedStartIso,
      endTime: r.placedEndIso,
      sendStatus,
      // The plan the server actually applied — so the booking sheet shows the
      // client the same truth the server wrote, instead of guessing from what
      // it asked for. `status` distinguishes booked from requested from held.
      status: r.plan?.status || 'confirmed',
      bookingMode: r.plan?.mode || 'instant',
      depositCents: r.plan?.depositCents || 0,
      chargeTiming: r.plan?.chargeTiming || 'never',
      requiresCardOnFile: !!r.plan?.requiresCardOnFile,
      clientNotice: r.plan?.clientNotice || '',
      // Non-empty only when a context collection could not be read, so a
      // support conversation can tell "we didn't check stations" apart from
      // "we checked and it was fine." Callers can ignore it.
      ...(dropped.length > 0 ? { checksSkipped: dropped } : {}),
    });
  } catch (err) {
    console.error('[appointments/book] failed', err);
    return NextResponse.json({ ok: false, error: 'Booking failed — nothing was saved. Try again.' }, { status: 500 });
  }
}
