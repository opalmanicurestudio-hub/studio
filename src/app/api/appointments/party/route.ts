// src/app/api/appointments/party/route.ts
//
// ALL-OR-NOTHING PARTY BOOKING.
//
// The failure this ends: a party of five was booked one appointment at a time —
// five separate writes, each checked on its own. Guest one takes the last
// pedicure chair, guest two takes the only tech certified for gel, and by guest
// four there is nothing left. Four bookings are already saved. The studio now
// owns a half-booked party, a client expecting five seats, and a front desk
// phoning people back. Worse, nothing in those five writes knew about the other
// four, so two guests could be handed the same chair and neither write noticed.
//
// This route places the whole party or none of it. One transaction: read the
// day's appointments once, walk the guests in order, and check each one with
// verifyBookable() — the same function the screens use — against a context that
// already contains the guests placed before it. So guest three is tested against
// a studio where guests one and two are already sitting down: their providers
// are taken, their chairs are counted, their padding is respected. If any guest
// cannot be seated, nothing at all is written and the caller gets alternative
// times the whole party actually fits.
//
// POST {
//   tenantId, source,
//   startTime,                    // FULL ISO instant — the anchor the organizer picked
//   organizer: { id } | { name, email?, phone? },
//   members: [{                   // members[0] IS the organizer's own service
//     name?, serviceId, staffId?, addOnIds?, offsetMinutes?, depositCents?,
//     email?, phone?,             // only if THIS guest wants their own messages
//   }],
//   mode?: 'together' | 'staggered' | 'either',   // default 'either'
//   notes?, holdOnly?, depositCents?,             // depositCents = whole-party total
//   tzOffsetMinutes?, ignoreShifts?, minLeadMinutes?, maxHorizonDays?,
// }
// → { ok, groupBookingId, primaryAppointmentId, mode, spanMinutes,
//     members: [{ appointmentId, checkInToken, shortCode, staffId, staffName,
//                 startTime, endTime, serviceId, name, isOrganizer }] }
// → 409 { ok:false, error, alternatives:[{ time, mode, label }] } when the party
//   does not fit — with times it WOULD fit, because "no" without "try 2:15" just
//   moves the work to the phone.
//
// WHO HEARS ABOUT IT. One confirmation to the organizer listing every guest,
// because a party is one plan in one person's head — five texts to the same
// phone is what the reminder cron was just fixed to stop doing. A guest who gave
// their own number gets their own note as well; they are a different person.
//
// SHARED CONVENTIONS with /api/appointments/book — deliberately identical, so
// the two routes cannot drift into disagreeing:
//   · one time frame: every stored instant is shifted into the studio's local
//     wall clock before the engine sees it; shifts stay wall-clock 'HH:mm'
//   · DATE-PREFIX Firestore ranges, never ISO-instant ranges — documents saved
//     with an offset suffix sort differently from 'Z' ones and an instant range
//     misses them, which is how a conflicting appointment goes invisible
//   · both 'cancelled' and 'canceled' spellings free a time
//   · every context collection has its own catch; what dropped comes back as
//     `checksSkipped` rather than becoming a 500 or a silent gap
//   · check-in docs are written to the scoped path AND the legacy root mirror

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { generateShortCode } from '@/lib/short-code';
import { nanoid } from 'nanoid';
import { verifyBookable, computePartyAvailability } from '@/lib/availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FIELD = 300;
const MAX_PARTY = 12;

/** Front-desk surfaces: no required notice, no horizon cap. Same list as /book. */
const IN_STUDIO_SOURCES = [
  'pos', 'pos_quick_book', 'quick_book', 'kiosk', 'walkin', 'walk_in',
  'staff', 'staff_portal', 'admin', 'front_desk', 'add_appointment',
];

/** Must match useSmartAvailability and /book, or screens and server disagree. */
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

/** 'HH:mm' → minutes since midnight. Returns null on anything unreadable. */
function clockToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, startTime } = body || {};
    const source = String(body.source || 'api').slice(0, 40);
    if (!tenantId || !startTime || !Array.isArray(body.members)) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }

    // ── The party itself ─────────────────────────────────────────────────────
    const members = body.members
      .slice(0, MAX_PARTY)
      .map((m: any, i: number) => ({
        index: i,
        name: String(m?.name || '').slice(0, MAX_FIELD).trim(),
        serviceId: String(m?.serviceId || ''),
        staffId: String(m?.staffId || 'any'),
        addOnIds: Array.isArray(m?.addOnIds) ? m.addOnIds.slice(0, 10).map(String) : [],
        offsetMinutes: Number.isFinite(Number(m?.offsetMinutes)) ? Math.max(0, Math.round(Number(m.offsetMinutes))) : null,
        depositCents: Number.isFinite(Number(m?.depositCents)) ? Math.max(0, Math.round(Number(m.depositCents))) : null,
        email: String(m?.email || '').slice(0, MAX_FIELD).trim(),
        phone: String(m?.phone || '').slice(0, 40).trim(),
      }))
      .filter((m: any) => m.serviceId);
    if (members.length === 0) {
      return NextResponse.json({ ok: false, error: 'Pick a service for at least one guest.' }, { status: 400 });
    }
    if (members.length < 2) {
      // Not an error, just the wrong door: one person is a normal booking and
      // /book does everything this does with less machinery.
      return NextResponse.json({
        ok: false,
        error: 'A party needs at least two guests — book a single guest through /api/appointments/book.',
      }, { status: 400 });
    }

    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ ok: false, error: 'Invalid start time.' }, { status: 400 });
    }
    if (start.getTime() < Date.now() - 5 * 60 * 1000) {
      return NextResponse.json({ ok: false, error: 'That time is in the past.' }, { status: 400 });
    }

    const db = getAdminDb();

    const [svcListSnap, staffSnap, tenantSnap] = await Promise.all([
      db.collection(`tenants/${tenantId}/services`).get(),
      db.collection(`tenants/${tenantId}/staff`).get(),
      db.doc(`tenants/${tenantId}`).get(),
    ]);
    const services = svcListSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    const roster = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    const tenant = ((tenantSnap.data() as any) || {}) as any;

    // Resolve each guest's service up front — an unknown service or an
    // uncertified request is a 4xx about THAT guest, named, not a vague failure
    // after the studio has already been searched.
    for (const m of members as any[]) {
      const svc = services.find((s: any) => s.id === m.serviceId);
      if (!svc) {
        return NextResponse.json({
          ok: false,
          error: `${m.name || `Guest ${m.index + 1}`}: that service no longer exists.`,
        }, { status: 404 });
      }
      let addOnMinutes = 0;
      for (const id of m.addOnIds) {
        const a = services.find((s: any) => s.id === id);
        if (a) addOnMinutes += Number((a as any).duration) || 0;
      }
      m.svc = svc;
      m.duration = (Number(svc.duration) || 60) + addOnMinutes;
      m.padBefore = Number(svc.padBefore) || 0;
      m.padAfter = Number(svc.padAfter) || 0;
      m.requiredResourceIds = Array.isArray(svc.requiredResourceIds) && svc.requiredResourceIds.length > 0
        ? svc.requiredResourceIds : null;
      if (m.staffId !== 'any') {
        const member = roster.find((s: any) => s.id === m.staffId);
        if (!member) {
          return NextResponse.json({
            ok: false,
            error: `${m.name || `Guest ${m.index + 1}`}: that provider is no longer on the team.`,
          }, { status: 404 });
        }
        const certified: string[] | undefined = Array.isArray(svc.certifiedStaffIds) && svc.certifiedStaffIds.length > 0
          ? svc.certifiedStaffIds : undefined;
        if (certified && !certified.includes(m.staffId)) {
          return NextResponse.json({
            ok: false,
            error: `${member.name || 'That provider'} isn't certified for ${svc.name || 'that service'} — ${m.name || `guest ${m.index + 1}`} needs someone else.`,
          }, { status: 409 });
        }
      }
    }

    // ── ONE TIME FRAME (identical to /book) ──────────────────────────────────
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
    const toLocalIso = (v: any): string | null => {
      if (v === null || v === undefined || v === '') return null;
      const d = v instanceof Date ? v : new Date(String(v));
      if (Number.isNaN(d.getTime())) return null;
      return new Date(d.getTime() + shiftMs).toISOString();
    };
    const localStartIso = new Date(start.getTime() + shiftMs).toISOString();
    const dateStr = localStartIso.slice(0, 10);
    const anchorClock = localStartIso.slice(11, 16);
    const nowLocal = new Date(Date.now() + shiftMs);

    // ── Every blocking source, once, each with its own catch ─────────────────
    const prevDay = shiftDateStr(dateStr, -1);
    const nextDayEnd = `${shiftDateStr(dateStr, 1)}`;
    const dropped: string[] = [];
    const safeRead = async (label: string, q: any): Promise<any[]> => {
      try {
        const snap = await q.get();
        return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
      } catch (e) {
        console.warn(`[appointments/party] could not read ${label} — that check was skipped`, e);
        dropped.push(label);
        return [];
      }
    };
    const col = (name: string) => db.collection(`tenants/${tenantId}/${name}`);

    const [rawEvents, rawShifts, rawStaffBlocks, dayOffBlocks, resources, rawTickets, maintenancePlans, scheduleProfiles] =
      await Promise.all([
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

    // Shifts hold wall-clock 'HH:mm' and are NOT shifted. Everything holding a
    // real instant is.
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

    const inStudio = IN_STUDIO_SOURCES.includes(source.toLowerCase());
    const mode: 'together' | 'staggered' | 'either' =
      body.mode === 'together' || body.mode === 'staggered' ? body.mode : 'either';

    /** The shared part of every engine call in this request. */
    const baseContext = {
      services,
      staff: roster,
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
      date: dateStr,
    };

    // ── WHERE DOES EACH GUEST SIT? ───────────────────────────────────────────
    // If the caller already knows the arrangement (it came from a screen that
    // showed the guest "you're at 2:15"), honour those offsets exactly — the
    // client was shown times and must get those times. Otherwise ask the engine
    // for an arrangement at this anchor: everyone together if that fits, else a
    // staggered one starting at the same anchor.
    const callerGaveOffsets = (members as any[]).some((m) => m.offsetMinutes !== null);
    let offsets: number[] = (members as any[]).map((m) => m.offsetMinutes ?? 0);
    let placedMode: 'together' | 'staggered' = offsets.some((o) => o !== 0) ? 'staggered' : 'together';
    let alternatives: Array<{ time: string; mode: string; label: string }> = [];

    if (!callerGaveOffsets) {
      const party = computePartyAvailability(
        baseContext as any,
        (members as any[]).map((m) => ({ name: m.name, serviceId: m.serviceId, staffId: m.staffId, addOnIds: m.addOnIds })),
        { mode, maxOptions: 12 },
      );
      const anchorMin = clockToMinutes(anchorClock) ?? 0;
      const atAnchor = (list: any[]) => list.find((o: any) => o.time === anchorClock);
      const chosen = (mode !== 'staggered' ? atAnchor(party.together) : undefined)
        || (mode !== 'together' ? atAnchor(party.staggered) : undefined);

      if (chosen) {
        placedMode = chosen.mode;
        // Derive offsets from the option's own placements so the arrangement the
        // engine proved is the arrangement that gets written — not a re-guess.
        offsets = chosen.members.map((p: any) => {
          const pm = clockToMinutes(String(p.start).slice(11, 16));
          return pm === null ? 0 : Math.max(0, pm - anchorMin);
        });
      } else {
        // Nothing at the requested time. Offer the nearest times that DO work
        // rather than a bare refusal.
        alternatives = [...party.together, ...party.staggered]
          .sort((a: any, b: any) => {
            const am = Math.abs((clockToMinutes(a.time) ?? 0) - anchorMin);
            const bm = Math.abs((clockToMinutes(b.time) ?? 0) - anchorMin);
            return am - bm;
          })
          .slice(0, 5)
          .map((o: any) => ({ time: o.time, mode: o.mode, label: o.label }));
        const size = members.length;
        return NextResponse.json({
          ok: false,
          error: alternatives.length > 0
            ? `There isn't room for all ${size} of you at that time. ${alternatives.length === 1 ? 'This time works' : 'These times work'}: ${alternatives.map((a) => a.time).join(', ')}.`
            : `There isn't room for all ${size} of you that day — try another date, or split the party across two times.`,
          alternatives,
          warnings: party.warnings,
          ...(dropped.length > 0 ? { checksSkipped: dropped } : {}),
        }, { status: 409 });
      }
    }

    // ── ALL OR NOTHING ───────────────────────────────────────────────────────
    const aptsRef = db.collection(`tenants/${tenantId}/appointments`);
    const groupBookingId = nanoid();

    const result = await db.runTransaction(async (tx: any) => {
      const nearby = await tx.get(
        aptsRef.where('startTime', '>=', prevDay).where('startTime', '<=', nextDayEnd),
      );
      const liveAppointments: any[] = [];
      for (const d of nearby.docs) {
        const a = d.data() as any;
        const status = String(a.status || '').toLowerCase();
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

      // ── PASS ONE: seat everybody, or nobody. Nothing is written in this pass.
      //    Each guest is checked against a studio that already contains the
      //    guests before them — appended to the same appointments array the
      //    engine reads. That is what makes two guests unable to be handed the
      //    same tech or the same chair, which per-guest booking could not see.
      const seated: Array<{ m: any; staffId: string; staffName: string; startMs: number; endMs: number }> = [];
      for (let i = 0; i < members.length; i++) {
        const m: any = members[i];
        const memberStartMs = start.getTime() + (offsets[i] || 0) * 60000;
        const localIso = new Date(memberStartMs + shiftMs).toISOString();
        const attempt = verifyBookable({
          ...(baseContext as any),
          date: localIso.slice(0, 10),
          time: localIso.slice(11, 16),
          serviceId: m.serviceId,
          addOnIds: m.addOnIds,
          staffId: m.staffId,
          appointments: liveAppointments,
          requireStaffId: m.staffId !== 'any' ? m.staffId : undefined,
        });
        if (!attempt.ok) {
          const who = m.name || `Guest ${i + 1}`;
          return {
            conflict: seated.length === 0
              ? `${who}: ${attempt.error}`
              : `${who} can't be seated at that time — ${attempt.error} Nothing was booked, so the whole party stays together.`,
          };
        }
        const endMs = memberStartMs + m.duration * 60000;
        seated.push({ m, staffId: attempt.staffId, staffName: attempt.staffName, startMs: memberStartMs, endMs });
        // The guest just seated now blocks their provider, holds their chair,
        // and carries their padding for everyone checked after them.
        liveAppointments.push({
          id: `party-pending-${i}`,
          tenantId,
          serviceId: m.serviceId,
          addOnIds: m.addOnIds.length > 0 ? m.addOnIds : null,
          staffId: attempt.staffId,
          startTime: new Date(memberStartMs + shiftMs).toISOString(),
          endTime: new Date(endMs + shiftMs).toISOString(),
          padBefore: m.padBefore,
          padAfter: m.padAfter,
          requiredResourceIds: m.requiredResourceIds,
          status: 'confirmed',
          createdAt: new Date(Date.now() + shiftMs).toISOString(),
        });
      }

      // ── The organizer's client record: existing id, match-by-contact, or new.
      let organizerClientId = String(body?.organizer?.id || '');
      let organizerName = '';
      let organizerPhone = String(body?.organizer?.phone || '').slice(0, 40).trim();
      let organizerEmail = String(body?.organizer?.email || '').slice(0, MAX_FIELD).trim();
      if (organizerClientId) {
        const c = await tx.get(db.doc(`tenants/${tenantId}/clients/${organizerClientId}`));
        if (!c.exists) return { conflict: 'Client not found.' };
        const cd = c.data() as any;
        organizerName = cd.name || '';
        organizerPhone = organizerPhone || String(cd.phone || '').trim();
        organizerEmail = organizerEmail || String(cd.email || '').trim();
      } else {
        organizerName = String(body?.organizer?.name || (members as any[])[0]?.name || '').slice(0, MAX_FIELD).trim();
        if (!organizerName) return { conflict: "The organizer's name is required." };
        let reused: any = null;
        if (organizerPhone) {
          const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('phone', '==', organizerPhone).limit(1));
          if (!hit.empty) reused = hit.docs[0];
        }
        if (!reused && organizerEmail) {
          const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('email', '==', organizerEmail).limit(1));
          if (!hit.empty) reused = hit.docs[0];
        }
        if (reused) {
          organizerClientId = reused.id;
          organizerName = (reused.data() as any).name || organizerName;
        } else {
          const newRef = db.collection(`tenants/${tenantId}/clients`).doc();
          organizerClientId = newRef.id;
          tx.set(newRef, {
            id: organizerClientId,
            name: organizerName,
            email: organizerEmail || null,
            phone: organizerPhone || null,
            status: 'active',
            lifetimeValue: 0,
            lastAppointment: new Date().toISOString(),
            createdVia: source,
          });
        }
      }

      // A guest who gave their own contact details becomes their own client, so
      // their history is theirs. A guest who gave only a name stays a name on
      // the organizer's party — inventing a contactless profile per guest is how
      // a client list fills with "Sarah's friend".
      const guestClientIds: Array<string | null> = [];
      for (let i = 0; i < seated.length; i++) {
        const m: any = seated[i].m;
        if (i === 0) { guestClientIds.push(organizerClientId); continue; }
        if (!m.phone && !m.email) { guestClientIds.push(null); continue; }
        let hitDoc: any = null;
        if (m.phone) {
          const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('phone', '==', m.phone).limit(1));
          if (!hit.empty) hitDoc = hit.docs[0];
        }
        if (!hitDoc && m.email) {
          const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('email', '==', m.email).limit(1));
          if (!hit.empty) hitDoc = hit.docs[0];
        }
        if (hitDoc) { guestClientIds.push(hitDoc.id); continue; }
        const gRef = db.collection(`tenants/${tenantId}/clients`).doc();
        tx.set(gRef, {
          id: gRef.id,
          name: m.name || `Guest of ${organizerName}`,
          email: m.email || null,
          phone: m.phone || null,
          status: 'active',
          lifetimeValue: 0,
          lastAppointment: new Date().toISOString(),
          createdVia: `${source}:party-guest`,
        });
        guestClientIds.push(gRef.id);
      }

      // ── PASS TWO: write. Every guest is already proven seatable.
      // Deposit: a per-guest amount if the caller split it, otherwise the whole
      // party total sits on the organizer's appointment — which is who is
      // actually paying it.
      const totalDeposit = Number(body.depositCents) || 0;
      const anySplit = (members as any[]).some((m) => m.depositCents !== null);
      const nowIso = new Date().toISOString();
      const spanMinutes = Math.round(
        (Math.max(...seated.map((s) => s.endMs)) - Math.min(...seated.map((s) => s.startMs))) / 60000,
      );
      const written: any[] = [];
      const rotated = new Set<string>();

      for (let i = 0; i < seated.length; i++) {
        const s = seated[i];
        const m: any = s.m;
        const aptId = nanoid();
        const token = nanoid(16);
        const shortCode = generateShortCode();
        const isOrganizer = i === 0;
        const depositCents = anySplit
          ? (m.depositCents || 0)
          : (isOrganizer ? totalDeposit : 0);
        const payload: any = {
          id: aptId, tenantId,
          clientId: guestClientIds[i],
          clientName: isOrganizer ? organizerName : (m.name || `Guest ${i + 1}`),
          serviceId: m.serviceId,
          addOnIds: m.addOnIds.length > 0 ? m.addOnIds : null,
          staffId: s.staffId,
          startTime: new Date(s.startMs).toISOString(),
          endTime: new Date(s.endMs).toISOString(),
          padBefore: m.padBefore,
          padAfter: m.padAfter,
          requiredResourceIds: m.requiredResourceIds,
          status: body.holdOnly ? 'pending_payment' : 'confirmed',
          source,
          checkInToken: token, shortCode,
          checkInStatus: 'pending',
          depositAmountCents: depositCents,
          depositStatus: depositCents > 0 ? (body.depositPaid === true ? 'paid' : 'pending') : 'none',
          ...(body.depositPaid === true && depositCents > 0 ? { depositPaidAt: nowIso } : {}),
          notes: body.notes ? String(body.notes).slice(0, 500) : null,
          // The group metadata every downstream consumer keys off: the planner's
          // party badge, sibling cancellation, and the one-text-per-visit
          // reminder bucketing all read these.
          groupBookingId,
          groupSize: seated.length,
          groupOrganizerClientId: organizerClientId,
          groupOrganizerName: organizerName,
          partyMode: placedMode,
          ...(isOrganizer ? { isPrimaryGroup: true } : {}),
          createdAt: nowIso,
          reminderSent: false,
          autoCancelledNoShow: false,
        };
        tx.set(aptsRef.doc(aptId), payload);
        tx.set(db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`), payload);
        tx.set(db.doc(`appointmentCheckIns/${token}`), payload); // TODO: remove after legacy rule closes
        // Rotation stamp once per provider, even if they took two guests.
        if (m.staffId === 'any' && !rotated.has(s.staffId)) {
          rotated.add(s.staffId);
          tx.set(db.doc(`tenants/${tenantId}/staff/${s.staffId}`), { lastBookingAssignedAt: nowIso }, { merge: true });
        }
        written.push({
          appointmentId: aptId,
          checkInToken: token,
          shortCode,
          staffId: s.staffId,
          staffName: s.staffName,
          startTime: payload.startTime,
          endTime: payload.endTime,
          serviceId: m.serviceId,
          serviceName: m.svc?.name || null,
          name: payload.clientName,
          clientId: guestClientIds[i],
          phone: isOrganizer ? organizerPhone : m.phone,
          email: isOrganizer ? organizerEmail : m.email,
          isOrganizer,
          depositAmountCents: depositCents,
        });
      }

      return { written, organizerClientId, organizerName, organizerPhone, organizerEmail, spanMinutes };
    });

    if ((result as any).conflict) {
      return NextResponse.json({ ok: false, error: (result as any).conflict }, { status: 409 });
    }
    const r: any = result;
    const primary = r.written[0];

    await logAuditAdmin(db, tenantId, {
      action: 'appointment.party_booked',
      targetType: 'appointment', targetId: primary.appointmentId,
      summary: `${r.organizerName || 'Client'} booked a party of ${r.written.length} — ${String(primary.startTime).slice(0, 16).replace('T', ' ')} (${placedMode}, ${r.spanMinutes}m in the building)`,
      actor: { type: 'user', name: r.organizerName || null, role: 'client', via: source },
    });

    // ── ONE message to the organizer, listing everybody ──────────────────────
    // Best-effort: a failed send never unbooks a party, it just shows as
    // not-sent so the front desk can fix the number and resend.
    const sendStatus = { smsSent: false, emailSent: false, guestsMessaged: 0 };
    try {
      const { sendNotification } = await import('@/lib/notify');
      const studioName = tenant.name || tenant.businessName || 'Your studio';
      const base = String(
        tenant.publicOrigin
        || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
        || req.nextUrl.origin,
      ).replace(/\/$/, '');
      const fmtLocal = (iso: string) => {
        const d = new Date(new Date(iso).getTime() + shiftMs);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
      };
      const firstStart = new Date(new Date(primary.startTime).getTime() + shiftMs);
      const dayLabel = firstStart.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
      const lines = r.written.map((w: any) =>
        `${String(w.name || 'Guest').split(' ')[0]} — ${fmtLocal(w.startTime)}${w.serviceName ? ` ${w.serviceName}` : ''}${w.staffName ? ` with ${w.staffName}` : ''}`,
      );
      const portalUrl = `${base}/check-in/${primary.checkInToken}`;
      const isHold = !!body.holdOnly;
      const heading = isHold
        ? `Almost booked — your party of ${r.written.length} on ${dayLabel}`
        : `Your party of ${r.written.length} is confirmed — ${dayLabel}`;
      const smsText = isHold
        ? `We're holding your party of ${r.written.length} on ${dayLabel}: ${lines.join('; ')}. Finish up to lock it in: ${portalUrl}`
        : `Your party of ${r.written.length} is booked for ${dayLabel}: ${lines.join('; ')}. Details & check-in: ${portalUrl}`;

      if (String(r.organizerEmail || '').includes('@')) {
        const { brandedEmailHtml } = await import('@/lib/email-template');
        const html = brandedEmailHtml({
          studioName,
          title: heading,
          bodyLines: [
            `Hi ${String(r.organizerName || 'there').split(' ')[0]} — here's the whole party, ${placedMode === 'together' ? 'all starting together' : 'staggered so everyone gets the right chair'}:`,
            ...lines,
            isHold
              ? 'Tap below to finish up and lock it in — the confirmation follows the moment it\'s done.'
              : `Everyone is in the building for about ${Math.max(1, Math.round(r.spanMinutes / 15) * 15)} minutes.`,
          ],
          ...(isHold ? {} : { bigCode: primary.shortCode ? String(primary.shortCode).toUpperCase() : undefined }),
          cta: { label: isHold ? 'Finish my booking' : 'Check in / manage the party', url: portalUrl },
          footerNote: `Need to change or cancel the party? It's all behind the button above. Sent by ${studioName}.`,
        });
        const er = await sendNotification(db, {
          tenantId, channel: 'email', to: r.organizerEmail,
          subject: heading, html,
          kind: isHold ? 'booking_hold' : 'booking_confirmation',
          appointmentId: primary.appointmentId,
          clientId: r.organizerClientId || null, clientName: r.organizerName || null,
        });
        sendStatus.emailSent = !!er.ok;
      }
      if (r.organizerPhone) {
        const sr = await sendNotification(db, {
          tenantId, channel: 'sms', to: r.organizerPhone, text: smsText,
          kind: isHold ? 'booking_hold' : 'booking_confirmation',
          appointmentId: primary.appointmentId,
          clientId: r.organizerClientId || null, clientName: r.organizerName || null,
        });
        sendStatus.smsSent = !!sr.ok;
      }

      // A guest who gave their OWN number is a different person and hears about
      // their own appointment — but only their own, not the whole roster.
      for (const w of r.written.slice(1)) {
        if (!w.phone && !w.email) continue;
        if (w.phone && w.phone === r.organizerPhone) continue;
        if (w.email && w.email === r.organizerEmail) continue;
        const own = `You're booked with ${studioName} on ${dayLabel} at ${fmtLocal(w.startTime)}${w.serviceName ? ` for ${w.serviceName}` : ''}${w.staffName ? ` with ${w.staffName}` : ''}. Details & check-in: ${base}/check-in/${w.checkInToken}`;
        const gr = await sendNotification(db, {
          tenantId,
          channel: w.phone ? 'sms' : 'email',
          to: w.phone || w.email,
          text: own,
          subject: `You're booked — ${dayLabel}`,
          kind: 'booking_confirmation',
          appointmentId: w.appointmentId,
          clientId: w.clientId || null, clientName: w.name || null,
        });
        if (gr.ok) sendStatus.guestsMessaged++;
      }
    } catch (e) {
      console.error('[appointments/party] confirmation send failed (the party is safe)', e);
    }

    return NextResponse.json({
      ok: true,
      groupBookingId,
      primaryAppointmentId: primary.appointmentId,
      mode: placedMode,
      spanMinutes: r.spanMinutes,
      members: r.written.map((w: any) => ({
        appointmentId: w.appointmentId,
        checkInToken: w.checkInToken,
        shortCode: w.shortCode,
        staffId: w.staffId,
        staffName: w.staffName,
        startTime: w.startTime,
        endTime: w.endTime,
        serviceId: w.serviceId,
        serviceName: w.serviceName,
        name: w.name,
        isOrganizer: w.isOrganizer,
        depositAmountCents: w.depositAmountCents,
      })),
      sendStatus,
      ...(dropped.length > 0 ? { checksSkipped: dropped } : {}),
    });
  } catch (err) {
    console.error('[appointments/party] failed', err);
    return NextResponse.json({
      ok: false,
      error: 'The party could not be booked — nothing was saved. Try again.',
    }, { status: 500 });
  }
}
