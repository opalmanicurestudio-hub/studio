// src/app/api/walkins/route.ts
//
// v1 — THE WALK-IN QUEUE BACKEND.
//
// tenants/{id}/walkIns has existed for a long time and a lot has been built on
// top of it: the staff portal's turn board (queue view, floor view, Start
// Service, Pass, Skip, No-show, Cancel), the planner timeline, the per-provider
// "accepting walk-ins" switch, the fairness rotation that sorts providers by
// lastWalkInCompletedAt, and the inbox notification a provider gets when a
// walk-in lands on them.
//
// NOTHING EVER CREATED A ROW. Every reference to that collection in the app is
// a read or an .update() of a document that was assumed to already exist. So
// the whole queue was a room with no door.
//
// This route is the door. It is also the only thing that CAN be, for the same
// reason /api/waitlist exists: `walkIns` has no explicit rule in
// firestore.rules and is not in the catch-all's exclusion list, so it resolves
// to `read, write: if isStaff(tenantId)`. A guest at the kiosk is not signed
// in. The write has to happen here, with Admin privileges, behind a rate limit.
//
// GET  ?tenantId=…
//   -> public. What the kiosk needs to decide what to show: is the kiosk turned
//      on, is anyone actually accepting walk-ins right now, how long is the
//      line. No personal data is returned — a guest can see the wait, not who
//      is waiting.
//
// POST { tenantId, action: 'join', name, phone?, email?, serviceId, groupSize?, note? }
//   -> public. Puts a person who is standing in the lobby into the turn queue.
//      Refuses when the owner has the kiosk switched off. Refuses (as `full`,
//      not as an error) when no qualified provider is on the floor accepting
//      walk-ins — the kiosk offers the waitlist instead, which is the right
//      list for "come back later".
//
// WHAT THIS ROUTE IS NOT: it does not book an appointment. A walk-in is not an
// appointment — it is a place in line. The provider taps Start Service on the
// board when they take the guest, and checkout happens from there. Booking a
// hard appointment for someone standing at the counter is what the previous
// version of the kiosk did, and it silently bypassed the entire queue.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const MAX_GROUP = 12;

const str = (v: any, cap = 200): string => (typeof v === 'string' ? v.slice(0, cap) : '');
const digits = (v: any): string => str(v, 40).replace(/\D/g, '');

const isEmail = (v: any): boolean => {
  const s = str(v, 160).trim();
  return s.length > 3 && s.includes('@') && !s.includes(' ') && s.indexOf('@') < s.lastIndexOf('.');
};

/** Local YYYY-MM-DD, matching how the roster and the staff board store dates. */
const todayStr = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The same sliding ten-minute window /api/waitlist and the lounge use. Kept
 *  local rather than shared so this route has no import that can break it. */
async function rateLimit(db: any, tenantId: string, key: string, max: number): Promise<boolean> {
  const ref = db.doc(`tenants/${tenantId}/private/${key}`);
  const cur = ((await ref.get()).data() as any) || {};
  const stamps: number[] = (cur.at || []).filter((t: number) => Date.now() - t < 10 * 60 * 1000);
  if (stamps.length >= max) return false;
  await ref.set({ at: [...stamps, Date.now()].slice(-400) }, { merge: true });
  return true;
}

/**
 * A row still occupies a place in line.
 *
 * `arrived` is included because the staff board's queue filter includes it —
 * if this list and that list disagreed, the kiosk would quote a position that
 * doesn't match the board the front desk is looking at.
 */
const OPEN_STATUSES = ['waiting', 'notified', 'arrived'];
const isOpenRow = (status: any): boolean => OPEN_STATUSES.includes(String(status || 'waiting'));
const isWorking = (status: any): boolean => String(status || '') === 'in_service';

const toMs = (v: any): number => {
  if (!v) return 0;
  if (typeof v?.toDate === 'function') { const d = v.toDate(); return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0; }
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const d = new Date(v);
  return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0;
};

/**
 * Who can be handed a walk-in right now.
 *
 * Deliberately the same four gates the rest of the app already applies, in the
 * same direction, so the kiosk never offers a chair the board would refuse:
 *
 *   1. acceptingWalkIns !== false — the provider's own switch in their portal.
 *      Tri-state on purpose: nobody has to opt in for this to work on day one.
 *   2. Active.
 *   3. Qualified for the service — requiredSkills / certifiedStaffIds, matching
 *      qualifiedFor() and isCertified() in lib/availability.
 *   4. On today's roster, but ONLY if a roster was actually published for
 *      today. Same tolerance as the availability engine: an unpublished roster
 *      means "we didn't bother today", not "nobody is working".
 *
 * NOTE ON RENTERS — deliberately NOT excluded.
 * An earlier draft of this file skipped anyone with isRenter/role === 'renter'
 * on the theory that a renter's chair is their own business. That was wrong for
 * two reasons. First, the staff board's own turn order (StaffPortalPage,
 * "Turn order: techs accepting walk-ins") does NOT exclude renters — so the
 * kiosk would have refused chairs the board was actively showing as Up Next,
 * which is exactly the kind of disagreement that makes the feature feel broken.
 * Second, if a provider's record is mis-typed as 'renter', that exclusion turns
 * into a silent, total outage: every guest is told "we're full" forever, with
 * nothing in the UI to explain why. The provider's own accepting switch is the
 * consent mechanism here — a renter who doesn't want house walk-ins turns it
 * off, and both the board and this route respect that immediately.
 */
function eligibleProviders(staff: any[], shifts: any[], service: any): any[] {
  const day = todayStr();
  // 'cancelled' only — the same test the board uses. Matching it matters more
  // than being stricter: a shift the board counts as on-the-floor must be a
  // shift this route counts too, or the two screens tell different stories.
  const rostered = (shifts || []).filter(
    (s: any) => String(s?.date || '').slice(0, 10) === day &&
      String(s?.status || '').toLowerCase() !== 'cancelled',
  );
  const published = rostered.length > 0;
  const onShift = new Set(rostered.map((s: any) => String(s?.staffId || '')));
  const required: string[] = Array.isArray(service?.requiredSkills) ? service.requiredSkills : [];
  const certified: string[] = Array.isArray(service?.certifiedStaffIds) ? service.certifiedStaffIds : [];

  return (staff || []).filter((s: any) => {
    if (!s || s.isActive === false) return false;
    if (s.acceptingWalkIns === false) return false;
    if (required.length && !required.every(k => (s.skillSet || []).includes(k))) return false;
    if (certified.length && !certified.includes(s.id)) return false;
    if (published && !onShift.has(String(s.id))) return false;
    return true;
  });
}

/** Minutes, rounded to a friendly 5, never promising zero when there IS a line. */
function estimateWait(ahead: any[], workingCount: number, providerCount: number, fallbackMins: number): number {
  if (providerCount <= 0) return 0;
  const load = ahead.reduce((sum: number, w: any) => sum + (Number(w.estimatedDuration) || fallbackMins || 30), 0);
  // Everyone mid-service is a chair that frees up before the line moves twice,
  // so count them as roughly half a service each rather than a whole one.
  const inFlight = workingCount * (fallbackMins || 30) * 0.5;
  const mins = (load + inFlight) / providerCount;
  if (mins <= 0) return 0;
  return Math.max(5, Math.round(mins / 5) * 5);
}

/** Shared by GET and POST so the number the guest is quoted before they commit
 *  is computed the same way as the number they are given afterwards. */
async function readFloor(db: any, tenantId: string, service: any) {
  const [staffSnap, shiftSnap, queueSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/staff`).get(),
    db.collection(`tenants/${tenantId}/shifts`).get(),
    db.collection(`tenants/${tenantId}/walkIns`).get(),
  ]);
  const staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const shifts = shiftSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const rows = queueSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const providers = eligibleProviders(staff, shifts, service);
  const queue = rows.filter((r: any) => isOpenRow(r.status)).sort((a: any, b: any) => toMs(a.checkInTime) - toMs(b.checkInTime));
  const working = rows.filter((r: any) => isWorking(r.status));
  return { staff, shifts, rows, providers, queue, working };
}

// ─── GET — what the kiosk shows before anyone taps anything ──────────────────

export async function GET(req: NextRequest) {
  try {
    const tenantId = str(req.nextUrl.searchParams.get('tenantId'), 120);
    if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing studio.' }, { status: 400 });

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) return NextResponse.json({ ok: false, error: 'Studio not found.' }, { status: 404 });
    const tenant = (tenantSnap.data() as any) || {};

    // Off unless the owner turned it on. This is the switch Jessica asked for:
    // a kiosk that is live the moment you buy an iPad, whether or not you are
    // ready to take walk-ins, is worse than no kiosk.
    const enabled = tenant?.walkInKiosk?.enabled === true;

    // No service in hand yet, so eligibility is measured against an empty
    // service — skills and certification gates don't apply until a guest has
    // picked something. The count is "who is on the floor for walk-ins at all".
    const { providers, queue, working } = await readFloor(db, tenantId, null);

    return NextResponse.json({
      ok: true,
      enabled,
      open: enabled && providers.length > 0,
      acceptingCount: providers.length,
      queueLength: queue.length,
      inServiceCount: working.length,
      estWaitMin: estimateWait(queue, working.length, providers.length, 30),
      studioName: str(tenant.name || tenant.businessName, 80),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
  }
}

// ─── POST — joining the line ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const tenantId = str(body?.tenantId, 120);
    const action = str(body?.action, 20) || 'join';

    if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing studio.' }, { status: 400 });
    if (action !== 'join') return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) return NextResponse.json({ ok: false, error: 'Studio not found.' }, { status: 404 });
    const tenant = (tenantSnap.data() as any) || {};

    if (!(await rateLimit(db, tenantId, 'walkInRate', 120))) {
      return NextResponse.json({ ok: false, error: 'Too many requests. Please try again shortly.' }, { status: 429 });
    }

    if (tenant?.walkInKiosk?.enabled !== true) {
      return NextResponse.json({ ok: false, closed: true, error: 'Walk-ins are not being taken right now.' }, { status: 200 });
    }

    const name = str(body?.name, 80).trim();
    const phone = str(body?.phone, 40).trim();
    const email = str(body?.email, 160).trim();
    const serviceId = str(body?.serviceId, 120);
    const note = str(body?.note, 300).trim();
    const groupSize = Math.min(MAX_GROUP, Math.max(1, Math.round(Number(body?.groupSize) || 1)));

    if (!name) return NextResponse.json({ ok: false, error: 'Please tell us your name.' }, { status: 400 });
    if (!serviceId) return NextResponse.json({ ok: false, error: 'Please pick a service.' }, { status: 400 });
    // Without a number there is no way to call them back from the lobby, and
    // no way to text them if they step out for coffee.
    if (!phone && !isEmail(email)) {
      return NextResponse.json({ ok: false, error: 'Please leave a phone number so we can call you when it is your turn.' }, { status: 400 });
    }

    const svcSnap = await db.doc(`tenants/${tenantId}/services/${serviceId}`).get();
    if (!svcSnap.exists) return NextResponse.json({ ok: false, error: 'That service is no longer offered.' }, { status: 404 });
    const service = { id: svcSnap.id, ...((svcSnap.data() as any) || {}) };
    if (service.isActive === false || service.walkInEnabled === false) {
      return NextResponse.json({ ok: false, error: 'That service is not available for walk-ins.' }, { status: 409 });
    }
    const svcMins = Number(service.duration) > 0 ? Number(service.duration) : 30;

    const { rows, providers, queue, working } = await readFloor(db, tenantId, service);

    // No qualified provider on the floor with walk-ins switched on. This is the
    // one case where the WAITLIST is the right answer: nobody can take them
    // now, so "we'll call you" is a real offer rather than a brush-off. The
    // kiosk makes that offer; this route just reports the situation honestly.
    if (providers.length === 0) {
      return NextResponse.json({
        ok: false, full: true,
        error: 'Nobody is taking walk-ins at the moment.',
        queueLength: queue.length,
      }, { status: 200 });
    }

    // Two taps on a kiosk, or the same person coming back ten minutes later to
    // check, must not become two people in line. Matched on phone digits, then
    // email — the same pair /api/waitlist dedupes on.
    const wantPhone = digits(phone);
    const wantEmail = email.toLowerCase();
    const dupe = rows
      .filter((r: any) => isOpenRow(r.status) || isWorking(r.status))
      .find((r: any) => {
        if (wantPhone && digits(r.phone || r.clientPhone) === wantPhone) return true;
        if (wantEmail && str(r.email || r.clientEmail, 160).trim().toLowerCase() === wantEmail) return true;
        return false;
      });
    if (dupe) {
      const ahead = queue.filter((q: any) => toMs(q.checkInTime) < toMs(dupe.checkInTime));
      return NextResponse.json({
        ok: true, alreadyInLine: true,
        walkInId: String(dupe.id),
        position: ahead.length + 1,
        staffName: str(dupe.staffName, 80),
        estWaitMin: estimateWait(ahead, working.length, providers.length, svcMins),
        queueLength: queue.length,
      });
    }

    // ── Turn rotation ────────────────────────────────────────────────────────
    // Longest since their last walk-in goes first. Anyone already holding one
    // (notified, or mid-service) is skipped: their turn is being used right now.
    const busyIds = new Set(
      rows.filter((r: any) => isWorking(r.status) || String(r.status) === 'notified')
        .map((r: any) => String(r.staffId || '')).filter(Boolean),
    );

    // The staff board sorts turn order on staff.lastWalkInCompletedAt — but
    // nothing in the app has ever WRITTEN that field. Start Service sets the
    // provider's status to busy and stamps lastWalkInStartedAt; no code path
    // stamps ...CompletedAt. So the sort key is undefined for every provider,
    // every comparison is 0, and "fairness rotation" quietly degenerates into
    // "whoever Firestore happens to return first" — the same person all day.
    //
    // Rather than depend on a field that may never be populated, fall back to
    // when each provider was last GIVEN a walk-in, which is derivable from the
    // queue rows this route already has in hand. Whoever has gone longest
    // without one goes next, and a provider who has never had one (0) sorts to
    // the front. If lastWalkInCompletedAt is ever wired up it wins, since the
    // later of the two timestamps is the more recent truth.
    const lastServed = new Map<string, number>();
    for (const r of rows) {
      const sid = String(r?.staffId || '');
      if (!sid) continue;
      const t = Math.max(toMs(r.serviceStartTime), toMs(r.notifiedAt), toMs(r.checkInTime));
      if (t > (lastServed.get(sid) || 0)) lastServed.set(sid, t);
    }
    const turnKey = (p: any) =>
      Math.max(toMs(p.lastWalkInCompletedAt), lastServed.get(String(p.id)) || 0);

    const free = providers
      .filter((p: any) => !busyIds.has(String(p.id)))
      .sort((a: any, b: any) => turnKey(a) - turnKey(b) || String(a.id).localeCompare(String(b.id)));

    // If everyone qualified is mid-service, the guest still joins the line —
    // unassigned, status `waiting`. The board shows them; the next provider to
    // finish picks them up. Handing a name to someone who is elbow-deep in a
    // colour service would just make the board lie.
    const assigned = free[0] || null;

    const nowIso = new Date().toISOString();
    const position = queue.length + 1;
    const estWaitMin = assigned ? 0 : estimateWait(queue, working.length, providers.length, svcMins);

    const walkInRef = db.collection(`tenants/${tenantId}/walkIns`).doc();

    // Client dedupe + the queue row in one transaction, so two guests tapping
    // at the same instant can't mint two profiles for the same phone number.
    // Reads first, writes second — Firestore's rule, not a style choice.
    const clientId: string = await db.runTransaction(async (tx: any) => {
      let foundId = '';
      let foundName = '';
      if (phone) {
        const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('phone', '==', phone).limit(1));
        if (!hit.empty) { foundId = hit.docs[0].id; foundName = str((hit.docs[0].data() as any)?.name, 80); }
      }
      if (!foundId && isEmail(email)) {
        const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('email', '==', email).limit(1));
        if (!hit.empty) { foundId = hit.docs[0].id; foundName = str((hit.docs[0].data() as any)?.name, 80); }
      }

      if (!foundId) {
        const cRef = db.collection(`tenants/${tenantId}/clients`).doc();
        foundId = cRef.id;
        // `clients` is one of the few collections with `allow create: if true`,
        // so this shape matches what the booking route writes for a first-time
        // guest — same fields, so the client list doesn't grow two dialects.
        tx.set(cRef, {
          id: foundId,
          name,
          email: email || null,
          phone: phone || null,
          status: 'active',
          lifetimeValue: 0,
          lastAppointment: nowIso,
          createdVia: 'walkin-kiosk',
        });
      }

      // ── The queue row ────────────────────────────────────────────────────
      // Every field here is one the existing readers already look for. The
      // board reads customerName OR clientName (both written, because
      // different surfaces reach for different ones), checkInTime for queue
      // order and wait minutes, groupSize for the "Group · 3" chip,
      // estimatedDuration for the floor's average, serviceIds for the
      // notification line, and startTime for the planner timeline.
      tx.set(walkInRef, {
        id: walkInRef.id,
        tenantId,
        status: assigned ? 'notified' : 'waiting',
        staffId: assigned ? String(assigned.id) : null,
        staffName: assigned ? str(assigned.name, 80) : null,
        notifiedAt: assigned ? nowIso : null,

        clientId: foundId,
        clientName: foundName || name,
        customerName: foundName || name,
        phone: phone || null,
        email: email || null,

        serviceId: service.id,
        serviceIds: [service.id],
        serviceName: str(service.name, 80),
        estimatedDuration: svcMins,
        groupSize,

        checkInTime: nowIso,
        startTime: nowIso,
        serviceStartTime: null,
        appointmentId: null,
        isEscalated: false,
        location: 'lobby',
        note,
        source: 'walkin-kiosk',
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      return foundId;
    });

    // ── Tell somebody a person is standing in the lobby ──────────────────────
    // Addressed to real user ids: the staff portal's bell reads
    // where('userId','==',me), so an unaddressed notification is invisible to
    // everyone. The assigned provider gets one; managers get one either way, so
    // an unassigned guest isn't left standing there because every provider
    // happened to be mid-service.
    try {
      const recipients = new Set<string>();
      if (assigned) recipients.add(String(assigned.id));
      const mgrs = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['owner', 'admin']).get();
      mgrs.docs.forEach((d: any) => recipients.add(d.id));

      if (recipients.size) {
        const batch = db.batch();
        recipients.forEach((uid: string) => {
          const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
          const mine = assigned && uid === String(assigned.id);
          batch.set(nRef, {
            id: nRef.id,
            userId: uid,
            type: 'walk_in_assigned',
            read: false,
            createdAt: nowIso,
            link: 'today',
            message: mine
              ? `Walk-in assigned: ${name} · ${service.name || 'service'} · ready for you now.`
              : `Walk-in: ${name} joined the queue for ${service.name || 'a service'}${assigned ? ` — sent to ${assigned.name || 'a provider'}.` : ' — nobody free yet.'}`,
          });
        });
        await batch.commit();
      }
    } catch {
      // A notification that fails to send must never undo a guest's place in
      // line. They are in the queue; the board will show them regardless.
    }

    return NextResponse.json({
      ok: true,
      walkInId: walkInRef.id,
      clientId,
      position,
      queueLength: position,
      staffName: assigned ? str(assigned.name, 80) : '',
      assigned: !!assigned,
      estWaitMin,
      serviceName: str(service.name, 80),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
  }
}
