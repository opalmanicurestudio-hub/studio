// src/app/api/walkins/route.ts
//
// v2 — THE WALK-IN QUEUE BACKEND.
//
// tenants/{id}/walkIns has existed for a long time and a lot has been built on
// top of it: the staff portal's turn board (queue view, floor view, Start
// Service, Pass, Skip, No-show, Cancel), the planner timeline, the per-provider
// "accepting walk-ins" switch, the fairness rotation that sorts providers by
// lastWalkInCompletedAt, and the inbox notification a provider gets when a
// walk-in lands on them.
//
// NOTHING EVER CREATED A ROW. Every reference to that collection in the app was
// a read or an .update() of a document that was assumed to already exist. So
// the whole queue was a room with no door. v1 of this file was the door.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT v2 ADDS, AND WHY
//
// Everything guest-facing in this app is keyed on a check-in TOKEN, not on an
// appointment id. The ticket printer builds its QR from `checkInToken`
// (lib/appointment-ticket → ticketCheckInUrl). /api/guest-lounge resolves a
// guest by token (resolveToken reads appointmentCheckIns/{token}). The consent
// gate on the check-in portal reads bookingCompletions/{token}. Real
// appointments are handed a token at booking time
// (api/appointments/book: nanoid(16) + generateShortCode()).
//
// Walk-ins, as v1 wrote them, had no token. So a walk-in could not print a
// ticket, could not reach the lounge, and could not be handed a consent form —
// not because those features are missing, but because there was no handle to
// hang them on. v2 mints the token and mirrors it exactly the way the booking
// route does, which turns all three on at once.
//
// v2 also closes three holes v1 left open:
//
//   1. NOTHING EVER FINISHED A WALK-IN. `busyIds` excludes anyone holding a
//      notified or in-service row, and no code path in the app ever moved a
//      row out of `in_service`. So after a provider started one walk-in they
//      were excluded from assignment permanently, and after N walk-ins every
//      provider was stuck and every guest fell through to the waitlist. v2
//      adds action:'complete' (the missing producer for
//      staff.lastWalkInCompletedAt, which the board's own turn order sorts on
//      but nothing ever wrote) AND self-heals rows that have been in service
//      for implausibly long, so one forgotten tap can't take a chair out of
//      circulation for the rest of the day.
//
//   2. CONSENT WAS CHECKED TOO LATE. A form the guest can't finish should cost
//      them a moment at the kiosk, not a chair. v2 computes what's outstanding
//      at JOIN time and refuses the spot until it's satisfied.
//
//   3. NOBODY COULD ASK FOR THEIR PERSON. A guest who drives across town for
//      Maya should be told plainly: Maya is ~40 minutes, next available is
//      ~10 — your call. And choosing to wait for Maya must not burn Maya's
//      rotation turn, or requesting her would quietly punish her.
//
// ─────────────────────────────────────────────────────────────────────────────
// GET  ?tenantId=…
//   -> public. What the kiosk needs before anyone taps anything: is the kiosk
//      turned on, is anyone actually accepting walk-ins right now, how long is
//      the line. No personal data — a guest can see the wait, not who's waiting.
//
// GET  ?tenantId=…&view=board
//   -> public. The lobby display board. First names only, no phone, no email,
//      no note, no internal notes. Anything on this payload is on a screen the
//      whole waiting room can read, so it is deliberately narrow.
//
// POST { tenantId, action: 'lookup', phone }
//   -> returning-guest recognition. First name + "same as last time" only.
//
// POST { tenantId, action: 'options', serviceId, phone? }
//   -> who could take this guest, what each one's wait looks like, and which
//      consent forms this particular guest still owes for this service.
//
// POST { tenantId, action: 'join', name, phone?, email?, serviceId, … }
//   -> puts a person standing in the lobby into the turn queue, mints their
//      token, and returns everything the kiosk needs to print their ticket.
//
// POST { tenantId, action: 'complete', walkInId }
//   -> the guest is finished. Frees the chair, advances the rotation.
//
// WHAT THIS ROUTE IS NOT: it does not book an appointment. A walk-in is not an
// appointment — it is a place in line. The provider taps Start Service on the
// board when they take the guest, and checkout happens from there. Booking a
// hard appointment for someone standing at the counter is what the very first
// version of the kiosk did, and it silently bypassed the entire queue.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { generateShortCode } from '@/lib/short-code';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';

const MAX_GROUP = 12;

/** Consent signatures go stale at 18 months — the same window QuickBookForm's
 *  formStatuses uses (differenceInMonths(...) >= 18). Kept identical on purpose:
 *  if the kiosk and the booking form disagreed about whether a form is still
 *  good, a guest would be asked to re-sign at one counter and not the other. */
const FORM_VALIDITY_MONTHS = 18;

/** PATCH_TEST_VALIDITY_MONTHS in QuickBookForm. Same reason. */
const PATCH_TEST_VALIDITY_MONTHS = 6;

/** A row that has been "in service" for longer than this is treated as
 *  finished. 2x the booked duration with a 90-minute floor: long enough that a
 *  genuinely long service is never cut off, short enough that a chair isn't
 *  lost for the whole day because nobody tapped anything. */
const STALE_MULTIPLE = 2;
const STALE_FLOOR_MS = 90 * 60 * 1000;

const str = (v: any, cap = 200): string => (typeof v === 'string' ? v.slice(0, cap) : '');
const digits = (v: any): string => str(v, 40).replace(/\D/g, '');

const isEmail = (v: any): boolean => {
  const s = str(v, 160).trim();
  return s.length > 3 && s.includes('@') && !s.includes(' ') && s.indexOf('@') < s.lastIndexOf('.');
};

/** First name only. Everything that goes on the lobby screen or into a
 *  phone-number lookup runs through this — a full surname on a wall-mounted
 *  display in a waiting room is a privacy problem nobody asked for. */
const firstName = (v: any): string => str(v, 80).trim().split(/\s+/)[0] || '';

/** Local YYYY-MM-DD, matching how the roster and the staff board store dates. */
const todayStr = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Whole calendar months between two instants, matching date-fns
 * differenceInMonths (which truncates toward zero and accounts for the day of
 * the month). Implemented locally rather than importing date-fns so this route
 * keeps the same tiny import surface the rest of it has.
 */
function monthsSince(thenMs: number, nowMs: number): number {
  if (!thenMs || thenMs > nowMs) return 0;
  const a = new Date(thenMs);
  const b = new Date(nowMs);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  // Not a full month yet if we haven't reached the same day-of-month.
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

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

/**
 * A row is in the chair right now.
 *
 * TWO SCREENS IN THIS APP WRITE THIS STATE WITH TWO DIFFERENT WORDS.
 *
 *   /staff-portal  StaffPortalPage's Start Service writes 'in_service', and its
 *                  own walk-in query filters on 'in_service'.
 *   /pos           the Terminal's walk-in queue panel calls handleStartService,
 *                  which writes 'servicing' onto the same walkIns document.
 *
 * Recognising only one of them is how a guest disappears: start the service
 * from the Terminal and the row is neither open (it isn't 'waiting') nor
 * working (it isn't 'in_service'), so it falls out of every derived list. The
 * lobby board shows an empty chair panel, inServiceCount reads 0, and the wait
 * estimate is computed as though nobody at all were being served — which quotes
 * every guest in the room a longer wait than the truth.
 *
 * Accepting both words is not tidy, but it is correct against the app as it is
 * actually written, and it is the only change here that fixes all three
 * symptoms at once. Renaming one screen's vocabulary would silently orphan
 * every row already sitting in Firestore under the other spelling.
 */
const WORKING_STATUSES = ['in_service', 'servicing'];
const isWorking = (status: any): boolean => WORKING_STATUSES.includes(String(status || ''));

const toMs = (v: any): number => {
  if (!v) return 0;
  if (typeof v?.toDate === 'function') { const d = v.toDate(); return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0; }
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const d = new Date(v);
  return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0;
}

/**
 * Has this in-service row plainly been abandoned?
 *
 * Nothing in the app finishes a walk-in ROW. The Terminal's walk-in panel does
 * have a Finished button, but it closes the mirror APPOINTMENT
 * (apt-walkin-{id} -> ready_for_checkout) and never writes back to walkIns —
 * so in-service is still a one-way door for the row itself, and every provider
 * standing behind one is excluded from assignment by busyIds. One forgotten tap on a Tuesday morning used to mean that provider
 * never received another kiosk walk-in, ever. Rather than trust that the new
 * complete action is always called, treat an implausibly long service as over.
 * The row is left alone in Firestore unless a POST is in flight (see
 * healStale) — reads just stop counting it.
 */
function isStale(row: any, nowMs: number): boolean {
  if (!isWorking(row?.status)) return false;
  const started = Math.max(toMs(row?.serviceStartTime), toMs(row?.notifiedAt), toMs(row?.checkInTime));
  if (!started) return false;
  const booked = (Number(row?.estimatedDuration) || 30) * 60 * 1000;
  return nowMs - started > Math.max(STALE_FLOOR_MS, booked * STALE_MULTIPLE);
}

/**
 * Write the stale rows back as completed so the board stops showing a service
 * that ended hours ago, and stamp the rotation field so the provider re-enters
 * the turn order. Best-effort: a guest joining the line must never fail
 * because a cleanup write failed.
 */
async function healStale(db: any, tenantId: string, stale: any[], nowIso: string): Promise<void> {
  if (!stale.length) return;
  try {
    const batch = db.batch();
    const stamped = new Set<string>();
    for (const row of stale.slice(0, 25)) {
      batch.set(db.doc(`tenants/${tenantId}/walkIns/${row.id}`), {
        status: 'completed',
        completedAt: nowIso,
        updatedAt: nowIso,
        autoCompleted: true,
        autoCompletedReason: 'No completion recorded — closed automatically so the chair returns to the floor.',
      }, { merge: true });

      // A requested walk-in never cost the provider their turn, so finishing
      // one must not advance it either (see the join handler's rotation note).
      const sid = String(row?.staffId || '');
      if (sid && row?.isRequested !== true && !stamped.has(sid)) {
        stamped.add(sid);
        batch.set(db.doc(`tenants/${tenantId}/staff/${sid}`), { lastWalkInCompletedAt: nowIso }, { merge: true });
      }
    }
    await batch.commit();
  } catch {
    // Intentionally silent. This is housekeeping, not the guest's business.
  }
}

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

/**
 * How long before THIS provider specifically could start.
 *
 * Their own queue, plus whatever is left of what they're doing now. Rounded to
 * 5 and phrased by the caller as "about 40 minutes" — never a countdown. A
 * countdown on a salon floor is a promise you can't keep, and the first time it
 * hits 0:00 with nobody free, the guest is standing at the desk asking why.
 */
function providerWait(providerId: string, rows: any[], nowMs: number, fallbackMins: number): number {
  const mine = rows.filter((r: any) => String(r?.staffId || '') === providerId);
  const queued = mine.filter((r: any) => isOpenRow(r.status));
  const load = queued.reduce((sum: number, w: any) => sum + (Number(w.estimatedDuration) || fallbackMins || 30), 0);

  let remaining = 0;
  const active = mine.find((r: any) => isWorking(r.status) && !isStale(r, nowMs));
  if (active) {
    const started = Math.max(toMs(active.serviceStartTime), toMs(active.notifiedAt), toMs(active.checkInTime));
    const booked = Number(active.estimatedDuration) || fallbackMins || 30;
    const elapsed = started ? Math.max(0, (nowMs - started) / 60000) : 0;
    remaining = Math.max(5, booked - elapsed);
  }

  const mins = load + remaining;
  if (mins <= 0) return 0;
  return Math.max(5, Math.round(mins / 5) * 5);
}

/** Shared by every handler so the number the guest is quoted before they commit
 *  is computed the same way as the number they are given afterwards. */
async function readFloor(db: any, tenantId: string, service: any) {
  const nowMs = Date.now();
  const [staffSnap, shiftSnap, queueSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/staff`).get(),
    db.collection(`tenants/${tenantId}/shifts`).get(),
    db.collection(`tenants/${tenantId}/walkIns`).get(),
  ]);
  const staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const shifts = shiftSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const allRows = queueSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));

  // Abandoned services are dropped from every derived list BEFORE anything is
  // computed, so the wait estimate, the busy set and the board all agree.
  const stale = allRows.filter((r: any) => isStale(r, nowMs));
  const staleIds = new Set(stale.map((r: any) => String(r.id)));
  const rows = allRows.filter((r: any) => !staleIds.has(String(r.id)));

  const providers = eligibleProviders(staff, shifts, service);
  const queue = rows.filter((r: any) => isOpenRow(r.status)).sort((a: any, b: any) => toMs(a.checkInTime) - toMs(b.checkInTime));
  const working = rows.filter((r: any) => isWorking(r.status));
  return { staff, shifts, rows, stale, providers, queue, working, nowMs };
}

/** Look a returning guest up by phone, then email. Matches on the RAW phone
 *  string first (the house convention — api/appointments/book does the same
 *  with `phoneRaw`) and then re-checks by digits in memory, which catches the
 *  same number stored in a different format. */
async function findClient(db: any, tenantId: string, phone: string, email: string) {
  const col = db.collection(`tenants/${tenantId}/clients`);
  if (phone) {
    const exact = await col.where('phone', '==', phone).limit(1).get();
    if (!exact.empty) return { id: exact.docs[0].id, data: (exact.docs[0].data() as any) || {} };
  }
  if (isEmail(email)) {
    const byEmail = await col.where('email', '==', email).limit(1).get();
    if (!byEmail.empty) return { id: byEmail.docs[0].id, data: (byEmail.docs[0].data() as any) || {} };
  }
  return null;
}

/**
 * What this guest still owes before they can sit down, for this service.
 *
 * Two stores of truth exist for a signature and they are read by different
 * screens, so both count here or the guest gets asked twice:
 *   • clients/{id}.signedForms[formId].signedAt   (read by QuickBookForm)
 *   • clients/{id}/signedConsents/{formId}.signedAt (read by AppointmentDetailsSheet)
 *
 * Titles come from tenants/{t}/consentForms/{id}.title, which is world-readable
 * in firestore.rules — but the client record is NOT, which is the whole reason
 * this has to happen server-side instead of on the kiosk.
 */
async function readRequirements(db: any, tenantId: string, service: any, clientId: string, clientData: any) {
  const nowMs = Date.now();
  const requiredIds: string[] = (Array.isArray(service?.requiredFormIds) ? service.requiredFormIds : [])
    .map((v: any) => str(v, 120)).filter(Boolean);

  const satisfied = new Set<string>();

  const stillGood = (raw: any): boolean => {
    const ms = toMs(raw);
    if (!ms) return false;
    return monthsSince(ms, nowMs) < FORM_VALIDITY_MONTHS;
  };

  if (clientId) {
    const map = (clientData?.signedForms as any) || {};
    for (const fid of requiredIds) {
      const entry = map?.[fid];
      if (entry && stillGood(entry?.signedAt ?? entry)) satisfied.add(fid);
    }
    // The subcollection is the newer store and the one the self-service portal
    // writes, so check it for anything the map didn't cover.
    const missing = requiredIds.filter(f => !satisfied.has(f));
    if (missing.length) {
      try {
        const snaps = await Promise.all(
          missing.map(fid => db.doc(`tenants/${tenantId}/clients/${clientId}/signedConsents/${fid}`).get()),
        );
        snaps.forEach((s: any, i: number) => {
          if (s?.exists && stillGood((s.data() as any)?.signedAt)) satisfied.add(missing[i]);
        });
      } catch {
        // Unreadable history means we ask again. Asking twice is a small
        // annoyance; skipping a required waiver is not.
      }
    }
  }

  const outstandingIds = requiredIds.filter(f => !satisfied.has(f));

  // Titles for the forms we're about to put in front of the guest. Missing
  // definitions are still returned — with the id as the label — because a
  // required form with a broken definition must not silently disappear.
  let forms: { id: string; title: string; requiresGuardianSignature: boolean; fields: any[] }[] = [];
  if (outstandingIds.length) {
    const snaps = await Promise.all(outstandingIds.map(fid => db.doc(`tenants/${tenantId}/consentForms/${fid}`).get()));
    forms = outstandingIds.map((fid, i) => {
      const d: any = snaps[i]?.exists ? (snaps[i].data() as any) || {} : {};
      return {
        id: fid,
        title: str(d.title || d.name, 160) || fid,
        requiresGuardianSignature: d.requiresGuardianSignature === true,
        fields: Array.isArray(d.fields) ? d.fields.slice(0, 40) : [],
      };
    });
  }

  // Patch test. Advisory rather than a hard block — see the join handler.
  const patchTestRequired = service?.requiresPatchTest === true;
  const lastPatch = toMs(clientData?.lastPatchTest);
  const patchTestOnFile = !!lastPatch && monthsSince(lastPatch, nowMs) < PATCH_TEST_VALIDITY_MONTHS;

  // Documents the service asks for (photo ID and the like). These are NOT
  // collected at the kiosk — they go onto the guest's completion record so they
  // can do it from their phone while they wait, which is a much better use of
  // twenty minutes in a lobby than staring at a wall.
  const reqs: any[] = Array.isArray(service?.requiredFileRequirements) ? service.requiredFileRequirements : [];
  const profileDocs: any[] = Array.isArray(clientData?.profileDocuments) ? clientData.profileDocuments : [];
  const fileRequirements = reqs.filter((fr: any) => {
    if (!fr?.persistToProfile) return true;
    return !profileDocs.some((pd: any) => pd?.requirementId === fr?.id);
  }).slice(0, 10);

  return { requiredIds, outstandingIds, forms, patchTestRequired, patchTestOnFile, fileRequirements };
}

// ─── GET — the kiosk's status, and the lobby board ───────────────────────────

export async function GET(req: NextRequest) {
  try {
    const tenantId = str(req.nextUrl.searchParams.get('tenantId'), 120);
    const view = str(req.nextUrl.searchParams.get('view'), 20);
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
    const { staff, shifts, rows, providers, queue, working, nowMs } = await readFloor(db, tenantId, null);
    const studioName = str(tenant.name || tenant.businessName, 80);
    const estWaitMin = estimateWait(queue, working.length, providers.length, 30);

    // ── The lobby display board ──────────────────────────────────────────────
    // Everything on this payload is going onto a screen the entire waiting room
    // can read. First names only. No phone, no email, no note, and absolutely
    // no internalNotes — that field never leaves the staff side of the app.
    if (view === 'board') {
      const day = todayStr();
      const onShiftIds = new Set(
        (shifts || [])
          .filter((s: any) => String(s?.date || '').slice(0, 10) === day &&
            String(s?.status || '').toLowerCase() !== 'cancelled')
          .map((s: any) => String(s?.staffId || '')),
      );
      const rostered = onShiftIds.size > 0;
      const busyStaff = new Set(working.map((r: any) => String(r.staffId || '')).filter(Boolean));

      // Resolve the provider's name from the staff list rather than trusting
      // the row's own staffName. The staff board's Start Service writes only
      // { status, serviceStartTime } — it never stamps staffId or staffName —
      // so a guest who was picked up off the unassigned pile has a row with no
      // provider name on it at all. Reading the roster instead means the wall
      // screen says "with Maya" no matter which code path seated them.
      const staffNameById = new Map<string, string>(
        (staff || []).map((s: any) => [String(s.id), str(s.name, 80)]),
      );
      const providerOf = (row: any): string =>
        firstName(row?.staffName) || firstName(staffNameById.get(String(row?.staffId || '')) || '');

      // Provider photos for the wall screen. A staff headshot is NOT guest data
      // — it is the same picture already on the public booking page — so it is
      // safe on a screen the whole room can see. Guests still get first names
      // only and no photo, which does not change here.
      const avatarById = new Map<string, string>(
        (staff || []).map((s: any) => [String(s.id), str(s.avatarUrl, 400)]),
      );
      const avatarOf = (row: any): string => avatarById.get(String(row?.staffId || '')) || '';

      return NextResponse.json({
        ok: true,
        enabled,
        studioName,
        queueLength: queue.length,
        inServiceCount: working.length,
        estWaitMin,
        acceptingCount: providers.length,
        generatedAt: new Date(nowMs).toISOString(),
        queue: queue.slice(0, 20).map((w: any, i: number) => ({
          position: i + 1,
          firstName: firstName(w.customerName || w.clientName) || 'Guest',
          serviceName: str(w.serviceName, 60),
          providerFirstName: providerOf(w),
          providerAvatar: avatarOf(w),
          requested: w.isRequested === true,
          notified: String(w.status) === 'notified' || String(w.status) === 'arrived',
          waitedMin: Math.max(0, Math.round((nowMs - toMs(w.checkInTime)) / 60000)),
        })),
        inService: working.slice(0, 20).map((w: any) => ({
          firstName: firstName(w.customerName || w.clientName) || 'Guest',
          serviceName: str(w.serviceName, 60),
          providerFirstName: providerOf(w),
          providerAvatar: avatarOf(w),
        })),
        floor: (staff || [])
          .filter((s: any) => s.isActive !== false && (!rostered || onShiftIds.has(String(s.id))))
          .map((s: any) => ({
            firstName: firstName(s.name) || 'Team',
            avatarUrl: str(s.avatarUrl, 400),
            accepting: s.acceptingWalkIns !== false,
            busy: busyStaff.has(String(s.id)) || String(s.status || '') === 'busy',
          }))
          .slice(0, 24),
      });
    }

    void rows;

    return NextResponse.json({
      ok: true,
      enabled,
      open: enabled && providers.length > 0,
      acceptingCount: providers.length,
      queueLength: queue.length,
      inServiceCount: working.length,
      estWaitMin,
      studioName,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const tenantId = str(body?.tenantId, 120);
    const action = str(body?.action, 20) || 'join';

    if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing studio.' }, { status: 400 });
    if (!['join', 'lookup', 'options', 'complete'].includes(action)) {
      return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
    }

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) return NextResponse.json({ ok: false, error: 'Studio not found.' }, { status: 404 });
    const tenant = (tenantSnap.data() as any) || {};

    if (action === 'complete') return await handleComplete(db, tenantId, body);

    // Everything a guest can do at the kiosk is gated on the owner's switch.
    // `complete` is above this line because it's the staff board closing out a
    // row that already exists — turning the kiosk off must not trap the guests
    // who are already in the chair.
    if (!(await rateLimit(db, tenantId, 'walkInRate', 120))) {
      return NextResponse.json({ ok: false, error: 'Too many requests. Please try again shortly.' }, { status: 429 });
    }
    if (tenant?.walkInKiosk?.enabled !== true) {
      return NextResponse.json({ ok: false, closed: true, error: 'Walk-ins are not being taken right now.' }, { status: 200 });
    }

    if (action === 'lookup') return await handleLookup(db, tenantId, body);
    if (action === 'options') return await handleOptions(db, tenantId, body);
    return await handleJoin(db, tenantId, tenant, body);
  } catch {
    return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
  }
}

// ─── lookup — "Welcome back, Ann" ────────────────────────────────────────────
//
// This is a phone-number oracle and it is treated like one. It answers only to
// a full number, it is rate limited harder than the rest of the route, and it
// returns a FIRST NAME and a last-visit summary and nothing else — no surname,
// no email, no address, no lifetime value, no notes of any kind. Somebody
// standing at an unattended iPad guessing numbers learns almost nothing, and
// the one thing they could learn (a first name) is what the guest would have
// typed in themselves ten seconds later anyway.

async function handleLookup(db: any, tenantId: string, body: any) {
  const phone = str(body?.phone, 40).trim();
  const wantDigits = digits(phone);
  if (wantDigits.length < 7) {
    return NextResponse.json({ ok: true, found: false }, { status: 200 });
  }
  if (!(await rateLimit(db, tenantId, 'walkInLookupRate', 60))) {
    return NextResponse.json({ ok: false, error: 'Too many lookups. Please try again shortly.' }, { status: 429 });
  }

  const found = await findClient(db, tenantId, phone, '');
  if (!found) return NextResponse.json({ ok: true, found: false });

  const clientId = found.id;
  const client = found.data;

  // Are they already standing in this line? Telling them so is much better
  // than letting them join twice and then quietly deduping them.
  const { rows, queue, working, providers } = await readFloor(db, tenantId, null);
  const mine = rows.find((r: any) =>
    String(r.clientId || '') === clientId && (isOpenRow(r.status) || isWorking(r.status)));

  // Their usual. Appointments are the richer record (they carry the provider),
  // so they win; client.lastServiceId is the fallback for a guest whose history
  // predates that field.
  let usual: any = null;
  try {
    const apts = await db.collection(`tenants/${tenantId}/appointments`).where('clientId', '==', clientId).get();
    const past = apts.docs
      .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
      .filter((a: any) => !['cancelled', 'canceled', 'no_show'].includes(String(a.status || '').toLowerCase()))
      .sort((a: any, b: any) => toMs(b.startTime) - toMs(a.startTime));

    const pastWalkIns = rows
      .filter((r: any) => String(r.clientId || '') === clientId && String(r.status) === 'completed')
      .sort((a: any, b: any) => toMs(b.checkInTime) - toMs(a.checkInTime));

    const lastApt = past[0] || null;
    const lastWalk = pastWalkIns[0] || null;
    const aptMs = lastApt ? toMs(lastApt.startTime) : 0;
    const walkMs = lastWalk ? toMs(lastWalk.checkInTime) : 0;
    const winner = aptMs >= walkMs ? lastApt : lastWalk;
    const winnerMs = Math.max(aptMs, walkMs);

    if (winner) {
      usual = {
        serviceId: str(winner.serviceId, 120) || str((winner.serviceIds || [])[0], 120),
        staffId: str(winner.staffId, 120),
        lastVisit: winnerMs ? new Date(winnerMs).toISOString() : null,
      };
    } else if (client?.lastServiceId) {
      usual = { serviceId: str(client.lastServiceId, 120), staffId: '', lastVisit: null };
    }
  } catch {
    if (client?.lastServiceId) usual = { serviceId: str(client.lastServiceId, 120), staffId: '', lastVisit: null };
  }

  // Resolve names, and — importantly — drop the suggestion entirely if the
  // service is gone or no longer offered to walk-ins. Offering a one-tap
  // rebook that fails on the next screen is worse than offering nothing.
  if (usual?.serviceId) {
    const svcSnap = await db.doc(`tenants/${tenantId}/services/${usual.serviceId}`).get();
    const svc: any = svcSnap.exists ? (svcSnap.data() as any) || {} : null;
    if (!svc || svc.isActive === false || svc.walkInEnabled === false) {
      usual = null;
    } else {
      usual.serviceName = str(svc.name, 80);
      usual.durationMin = Number(svc.duration) > 0 ? Number(svc.duration) : 30;
      if (usual.staffId) {
        const stillHere = (providers || []).find((p: any) => String(p.id) === usual.staffId);
        const staffSnap = await db.doc(`tenants/${tenantId}/staff/${usual.staffId}`).get();
        const sd: any = staffSnap.exists ? (staffSnap.data() as any) || {} : null;
        usual.staffFirstName = firstName(sd?.name);
        usual.staffName = str(sd?.name, 80);
        usual.staffAvailableToday = !!stillHere;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    found: true,
    clientId,
    firstName: firstName(client?.name),
    usual,
    alreadyInLine: mine ? {
      walkInId: String(mine.id),
      status: str(mine.status, 20),
      position: queue.findIndex((q: any) => String(q.id) === String(mine.id)) + 1,
      checkInToken: str(mine.checkInToken, 40),
      shortCode: str(mine.shortCode, 20),
      estWaitMin: estimateWait(
        queue.filter((q: any) => toMs(q.checkInTime) < toMs(mine.checkInTime)),
        working.length, providers.length, 30),
    } : null,
  });
}

// ─── options — "wait for Maya, or take the next person free?" ────────────────

async function handleOptions(db: any, tenantId: string, body: any) {
  const serviceId = str(body?.serviceId, 120);
  const phone = str(body?.phone, 40).trim();
  const email = str(body?.email, 160).trim();
  if (!serviceId) return NextResponse.json({ ok: false, error: 'Please pick a service.' }, { status: 400 });

  const svcSnap = await db.doc(`tenants/${tenantId}/services/${serviceId}`).get();
  if (!svcSnap.exists) return NextResponse.json({ ok: false, error: 'That service is no longer offered.' }, { status: 404 });
  const service = { id: svcSnap.id, ...((svcSnap.data() as any) || {}) };
  if (service.isActive === false || service.walkInEnabled === false) {
    return NextResponse.json({ ok: false, error: 'That service is not available for walk-ins.' }, { status: 409 });
  }
  const svcMins = Number(service.duration) > 0 ? Number(service.duration) : 30;

  const { rows, providers, queue, working, nowMs } = await readFloor(db, tenantId, service);

  const busyIds = busySet(rows, nowMs);
  const nextFree = rotate(providers, rows, busyIds)[0] || null;

  const found = (phone || email) ? await findClient(db, tenantId, phone, email) : null;
  const reqs = await readRequirements(db, tenantId, service, found?.id || '', found?.data || null);

  return NextResponse.json({
    ok: true,
    open: providers.length > 0,
    queueLength: queue.length,
    serviceName: str(service.name, 80),
    durationMin: svcMins,
    // "Next available" — the option that always exists when anyone is on the
    // floor, and the one the kiosk should present first because it is fastest.
    nextAvailable: {
      estWaitMin: nextFree ? 0 : estimateWait(queue, working.length, providers.length, svcMins),
      providerFirstName: nextFree ? firstName(nextFree.name) : '',
      readyNow: !!nextFree,
    },
    // Every provider who COULD do this service, with their own honest wait, so
    // "wait for Maya (about 40 minutes)" is a real number and not a guess.
    providers: providers.map((p: any) => ({
      id: String(p.id),
      name: str(p.name, 80),
      firstName: firstName(p.name),
      avatarUrl: str(p.avatarUrl, 400),
      title: str(p.title || p.jobTitle, 60),
      readyNow: !busyIds.has(String(p.id)),
      estWaitMin: busyIds.has(String(p.id)) ? providerWait(String(p.id), rows, nowMs, svcMins) : 0,
    })).sort((a: any, b: any) => a.estWaitMin - b.estWaitMin || a.firstName.localeCompare(b.firstName)),
    // What this guest still owes before they can sit down.
    consent: {
      formIds: reqs.outstandingIds,
      forms: reqs.forms,
      patchTestRequired: reqs.patchTestRequired,
      patchTestOnFile: reqs.patchTestOnFile,
    },
    recognized: !!found,
    firstName: found ? firstName(found.data?.name) : '',
  });
}

/** Anyone whose turn is being spent right now. Stale rows are already gone by
 *  the time these `rows` reach here (readFloor drops them), but the nowMs guard
 *  is kept so this is safe to call on an unfiltered list too. */
function busySet(rows: any[], nowMs: number): Set<string> {
  return new Set(
    rows.filter((r: any) => (isWorking(r.status) && !isStale(r, nowMs)) || String(r.status) === 'notified')
      .map((r: any) => String(r.staffId || '')).filter(Boolean),
  );
}

/**
 * Turn rotation — longest since their last walk-in goes first.
 *
 * The staff board sorts turn order on staff.lastWalkInCompletedAt — and until
 * v2 nothing in the app had ever WRITTEN that field. Start Service sets the
 * provider's status to busy and stamps lastWalkInStartedAt; no code path
 * stamped ...CompletedAt. So the sort key was undefined for every provider,
 * every comparison was 0, and "fairness rotation" quietly degenerated into
 * "whoever Firestore happens to return first" — the same person all day.
 *
 * v2's complete action now writes that field, but a studio that has been
 * running for months has no history in it, so the fallback stays: when the
 * field is absent, use when each provider was last GIVEN a walk-in, which is
 * derivable from the queue rows this route already has in hand. Whoever has
 * gone longest without one goes next, and a provider who has never had one (0)
 * sorts to the front. Whichever of the two timestamps is later wins, since
 * that's the more recent truth.
 *
 * REQUESTED WALK-INS ARE EXCLUDED from the fallback. If a guest specifically
 * asks for Maya, that visit is not the house handing Maya a turn — it's a
 * client Maya brought in. Counting it would mean every guest who asks for her
 * by name pushes her further down the rotation, which punishes the provider
 * people actually ask for. The complete action skips the stamp for the same
 * reason.
 */
function rotate(providers: any[], rows: any[], busyIds: Set<string>): any[] {
  const lastServed = new Map<string, number>();
  for (const r of rows) {
    if (r?.isRequested === true) continue;
    const sid = String(r?.staffId || '');
    if (!sid) continue;
    const t = Math.max(toMs(r.serviceStartTime), toMs(r.notifiedAt), toMs(r.checkInTime));
    if (t > (lastServed.get(sid) || 0)) lastServed.set(sid, t);
  }
  const turnKey = (p: any) => Math.max(toMs(p.lastWalkInCompletedAt), lastServed.get(String(p.id)) || 0);

  return providers
    .filter((p: any) => !busyIds.has(String(p.id)))
    .sort((a: any, b: any) => turnKey(a) - turnKey(b) || String(a.id).localeCompare(String(b.id)));
}

// ─── join — taking a place in line ───────────────────────────────────────────

async function handleJoin(db: any, tenantId: string, tenant: any, body: any) {
  const name = str(body?.name, 80).trim();
  const phone = str(body?.phone, 40).trim();
  const email = str(body?.email, 160).trim();
  const serviceId = str(body?.serviceId, 120);
  const note = str(body?.note, 300).trim();
  const groupSize = Math.min(MAX_GROUP, Math.max(1, Math.round(Number(body?.groupSize) || 1)));
  const preferredStaffId = str(body?.preferredStaffId, 120);
  const waitForPreferred = body?.waitForPreferred === true;
  const acknowledgePatchTest = body?.acknowledgePatchTest === true;

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

  // `staff` is destructured here (it was not before) because the zero-provider
  // branch below has to tell "the studio has nobody for walk-ins" apart from
  // "a skills or roster gate excluded everybody", and only the raw roster can
  // answer that.
  const { staff, rows, stale, providers, queue, working, nowMs } = await readFloor(db, tenantId, service);
  const nowIso = new Date(nowMs).toISOString();

  // Housekeeping before anything else so a chair abandoned this morning is
  // available to the person standing here now.
  await healStale(db, tenantId, stale, nowIso);

  // ── Zero eligible providers: the bug that sent walk-ins to the waitlist ──
  //
  // eligibleProviders() applies FOUR filters, and any one of them can quietly
  // return an empty list:
  //     isActive === false
  //     acceptingWalkIns === false
  //     the service's requiredSkills vs the tech's skillSet
  //     the service's certifiedStaffIds
  //     a published shift roster for today (rosters exist -> must be on one)
  //
  // The last three are DATA-COMPLETENESS gates, not "the studio is closed"
  // gates. A service saved with a required skill nobody's profile lists, or
  // one rostered shift that accidentally excludes everybody else, made this
  // return "Nobody is taking walk-ins" — and the kiosk's only remaining offer
  // was the waitlist. So a guest standing in the lobby of an open studio with
  // three techs on the floor got "we'll call you sometime". That is the
  // opposite of a walk-in queue.
  //
  // So: separate the two situations.
  //   • Genuinely nobody on the floor for walk-ins -> the waitlist IS the
  //     honest answer, and the kiosk offers it.
  //   • Somebody is here, but a skills / certification / roster gate excluded
  //     them all -> the guest JOINS THE QUEUE, unassigned, flagged
  //     needsFrontDesk. A person decides. A silent filter does not get to turn
  //     a paying customer away.
  const floorForWalkIns = (staff || []).filter(
    (s: any) => s && s.isActive !== false && s.acceptingWalkIns !== false,
  );
  if (providers.length === 0 && floorForWalkIns.length === 0) {
    return NextResponse.json({
      ok: false, full: true,
      error: 'Nobody is taking walk-ins at the moment.',
      queueLength: queue.length,
    }, { status: 200 });
  }
  // Somebody IS on the floor — a gate, not the studio, produced the zero.
  const needsFrontDesk = providers.length === 0;

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
      // Returned so a guest who taps twice can still print (or reprint) their
      // ticket and open their waiting screen rather than hitting a dead end.
      checkInToken: str(dupe.checkInToken, 40),
      shortCode: str(dupe.shortCode, 20),
      serviceName: str(dupe.serviceName, 80),
    });
  }

  // ── Requirements, checked BEFORE a spot is granted ────────────────────────
  // Consent used to be collected after the guest was already assigned, which
  // meant somebody who couldn't finish a waiver was holding a chair while they
  // worked it out. Checking here costs them a moment at the kiosk instead.
  const existing = await findClient(db, tenantId, phone, email);
  const reqs = await readRequirements(db, tenantId, service, existing?.id || '', existing?.data || null);

  const submitted: any[] = Array.isArray(body?.signedForms) ? body.signedForms.slice(0, 20) : [];
  const submittedIds = new Set(
    submitted.map((f: any) => str(f?.formId, 120)).filter(Boolean),
  );
  const stillOutstanding = reqs.outstandingIds.filter(fid => !submittedIds.has(fid));

  if (stillOutstanding.length) {
    return NextResponse.json({
      ok: false,
      consentRequired: true,
      error: 'Please finish the consent form for this service.',
      forms: reqs.forms.filter(f => stillOutstanding.includes(f.id)),
    }, { status: 200 });
  }

  // Patch test. Deliberately NOT a hard wall. A patch test has to happen a day
  // or two BEFORE the service, so a guest arriving without one genuinely can't
  // have this done today — but the studio may well have one on paper, or on a
  // previous system, and a kiosk that flatly refuses would send a real customer
  // out the door over a record-keeping gap. So: tell them, let a human wave it
  // through, and mark the row loudly so the provider sees it before they start.
  if (reqs.patchTestRequired && !reqs.patchTestOnFile && !acknowledgePatchTest) {
    return NextResponse.json({
      ok: false,
      patchTestRequired: true,
      error: 'This service needs a patch test at least 24 hours beforehand. Please check with the front desk.',
      validityMonths: PATCH_TEST_VALIDITY_MONTHS,
    }, { status: 200 });
  }
  const patchTestWarning = reqs.patchTestRequired && !reqs.patchTestOnFile;

  // ── Who takes them ───────────────────────────────────────────────────────
  const busyIds = busySet(rows, nowMs);
  const free = rotate(providers, rows, busyIds);

  // A requested provider who has since gone off shift, switched their own
  // accepting toggle off, or turned out not to be certified for this service
  // is not a provider we can honour. Say so rather than silently reassigning.
  const requested = preferredStaffId
    ? (providers.find((p: any) => String(p.id) === preferredStaffId) || null)
    : null;
  const preferredUnavailable = !!preferredStaffId && !requested;

  let assigned: any = null;
  let isRequested = false;
  let waitingForRequested = false;

  if (requested) {
    isRequested = true;
    if (!busyIds.has(String(requested.id))) {
      // They asked for Maya and Maya is free. Easy.
      assigned = requested;
    } else if (waitForPreferred) {
      // They asked for Maya, Maya is busy, and they said they'd wait. The row
      // carries Maya's id while sitting in `waiting` — that puts it in her
      // "my queue" on the board and shows "→ Maya" to everyone else, so the
      // front desk can see who this guest is holding out for. Whoever actually
      // taps Start Service is who gets stamped, so this is a signal, not a lock.
      waitingForRequested = true;
      assigned = null;
    } else {
      // They asked for Maya, Maya is busy, and they chose not to wait.
      isRequested = false;
      assigned = free[0] || null;
    }
  } else {
    // If everyone qualified is mid-service, the guest still joins the line —
    // unassigned, status `waiting`. The board shows them; the next provider to
    // finish picks them up. Handing a name to someone who is elbow-deep in a
    // colour service would just make the board lie.
    assigned = free[0] || null;
  }

  const holder = assigned || (waitingForRequested ? requested : null);
  const position = queue.length + 1;
  // When a gate produced zero providers, estimateWait's divisor would be 0 and
  // it returns 0 — which reads to the guest as "no wait at all" at the exact
  // moment nobody is even assigned to her. Divide by who is actually on the
  // floor instead, so the number is a real estimate rather than a lie.
  const waitDivisor = providers.length > 0 ? providers.length : floorForWalkIns.length;
  const estWaitMin = assigned
    ? 0
    : waitingForRequested
      ? providerWait(String(requested.id), rows, nowMs, svcMins)
      : estimateWait(queue, working.length, waitDivisor, svcMins);

  // ── The token ────────────────────────────────────────────────────────────
  // Same shape and same generators as api/appointments/book, because the same
  // three consumers read it: the ticket printer's QR, /api/guest-lounge's
  // resolveToken, and the check-in portal.
  const token = nanoid(16);
  const shortCode = generateShortCode();

  const walkInRef = db.collection(`tenants/${tenantId}/walkIns`).doc();

  const signedForms = submitted
    .filter((f: any) => reqs.requiredIds.includes(str(f?.formId, 120)))
    .map((f: any) => ({
      formId: str(f?.formId, 120),
      formTitle: str(f?.formTitle, 160),
      formData: (f?.formData && typeof f.formData === 'object') ? f.formData : {},
      signedAt: nowIso,
      ...(str(f?.guardianName, 80) ? {
        guardianName: str(f?.guardianName, 80),
        guardianRelationship: str(f?.guardianRelationship, 80),
        guardianSignedAt: nowIso,
      } : {}),
    }));

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
        lastServiceId: service.id,
        createdVia: 'walkin-kiosk',
      });
    } else {
      // Keep the "same as last time" suggestion current for their next visit.
      // Merge, so nothing else on a long-standing client record is disturbed.
      tx.set(db.doc(`tenants/${tenantId}/clients/${foundId}`), {
        lastAppointment: nowIso,
        lastServiceId: service.id,
        ...(holder ? { lastStaffId: String(holder.id) } : {}),
      }, { merge: true });
    }

    const displayName = foundName || name;

    // ── The queue row ────────────────────────────────────────────────────
    // Every field here is one the existing readers already look for. The
    // board reads customerName OR clientName (both written, because
    // different surfaces reach for different ones), checkInTime for queue
    // order and wait minutes, groupSize for the "Group · 3" chip,
    // estimatedDuration for the floor's average, serviceIds for the
    // notification line, and startTime for the planner timeline.
    const row: any = {
      id: walkInRef.id,
      tenantId,
      status: assigned ? 'notified' : 'waiting',
      staffId: holder ? String(holder.id) : null,
      staffName: holder ? str(holder.name, 80) : null,
      notifiedAt: assigned ? nowIso : null,

      clientId: foundId,
      clientName: displayName,
      customerName: displayName,
      phone: phone || null,
      email: email || null,

      serviceId: service.id,
      serviceIds: [service.id],
      serviceName: str(service.name, 80),
      estimatedDuration: svcMins,
      groupSize,

      // v2 — the handle everything guest-facing hangs on.
      checkInToken: token,
      shortCode,

      // v2 — a requested provider is recorded separately from the assigned
      // one, because the two mean different things to the rotation.
      isRequested,
      requestedStaffId: requested ? String(requested.id) : null,
      requestedStaffName: requested ? str(requested.name, 80) : null,
      waitingForRequested,

      signedForms,
      patchTestWarning,

      // TRUE means: this guest is in the queue but no tech currently passes the
      // service's skill / certification / roster gate. She is NOT turned away —
      // the front desk decides. The staff board should show this loudly, because
      // nobody will be auto-assigned to her by the rotation.
      needsFrontDesk,

      checkInTime: nowIso,
      startTime: nowIso,
      serviceStartTime: null,
      completedAt: null,
      appointmentId: null,
      isEscalated: false,
      location: 'lobby',
      note,
      source: 'walkin-kiosk',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    tx.set(walkInRef, row);

    // ── The planner appointment ──────────────────────────────────────────
    // THIS IS WHAT STOPS A DOUBLE BOOKING.
    //
    // /api/appointments/book checks for conflicts by reading
    // tenants/{t}/appointments in the booking window and handing them to the
    // availability engine. It does NOT read walkIns and never has. So before
    // this write existed, a guest the kiosk seated with Maya was invisible to
    // online booking: the website went on offering Maya's 2:00, somebody took
    // it, and Maya was booked twice for the same half hour — once by a screen
    // in the lobby and once by a stranger on the internet. Nothing warned
    // anybody until 2:00.
    //
    // The id convention `apt-walkin-{walkInId}` is not arbitrary. Code all
    // over this app branches on id.startsWith('apt-walkin-') to tell a mirror
    // from a real booking, and /pos writes the SAME id when the front desk
    // assigns somebody by hand — so writing it here means the two paths
    // converge on one document instead of racing to create two.
    //
    // Only written when a provider is actually assigned. An unassigned guest
    // in `waiting` is holding nobody's calendar, and inventing an appointment
    // for her would block a tech who has not agreed to take her yet.
    if (holder) {
      tx.set(db.doc(`tenants/${tenantId}/appointments/apt-walkin-${walkInRef.id}`), {
        id: `apt-walkin-${walkInRef.id}`,
        tenantId,
        walkInId: walkInRef.id,
        isWalkIn: true,
        source: 'walk-in',
        status: 'confirmed',
        checkInStatus: 'arrived',
        checkedInAt: nowIso,

        clientId: foundId,
        clientName: displayName,
        clientPhone: phone || null,
        clientEmail: email || null,

        serviceId: service.id,
        serviceIds: [service.id],
        // serviceName is written here on purpose. /pos's own mirror omits it,
        // which is why an unresolvable service showed up at the till as a
        // blank line instead of a name you could read.
        serviceName: str(service.name, 80),
        staffId: String(holder.id),
        staffName: str(holder.name, 80),

        startTime: nowIso,
        endTime: new Date(nowMs + svcMins * 60 * 1000).toISOString(),
        estimatedDuration: svcMins,
        groupSize,

        checkInToken: token,
        shortCode,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    // ── The check-in mirror ──────────────────────────────────────────────
    // Deliberately a PROJECTION, not a copy of the row above. The check-in
    // portal treats appointmentCheckIns/{token} as the appointment: it reads
    // `status` and `checkInStatus` to decide what screen to show, and its
    // guest lounge only opens when checkInStatus === 'arrived' or
    // status === 'servicing'. A walk-in is by definition standing in the
    // building, so 'arrived' is the honest value and it's what turns the
    // concierge on for them the moment they join.
    //
    // completionLinkFirstViewedAt is pre-stamped on purpose: the portal has a
    // mount effect that writes that field to
    // tenants/{t}/appointments/{appointmentData.id} the first time the link is
    // opened, and for a walk-in there IS no appointment with that id — a merge
    // write would conjure a phantom appointment into the planner. Setting it
    // here makes that effect early-return instead.
    const mirror: any = {
      id: walkInRef.id,
      tenantId,
      walkInId: walkInRef.id,
      appointmentId: null,
      isWalkIn: true,
      source: 'walkin-kiosk',

      checkInToken: token,
      shortCode,

      clientId: foundId,
      clientName: displayName,
      clientPhone: phone || null,
      clientEmail: email || null,

      serviceId: service.id,
      serviceIds: [service.id],
      serviceName: str(service.name, 80),
      staffId: holder ? String(holder.id) : null,
      staffName: holder ? str(holder.name, 80) : null,

      startTime: nowIso,
      endTime: new Date(nowMs + svcMins * 60 * 1000).toISOString(),
      estimatedDuration: svcMins,
      groupSize,

      status: 'confirmed',
      checkInStatus: 'arrived',
      checkedInAt: nowIso,
      completionLinkFirstViewedAt: nowIso,

      createdAt: nowIso,
      updatedAt: nowIso,
    };
    tx.set(db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`), mirror);
    // resolveToken in /api/guest-lounge reads the top-level copy FIRST, and the
    // check-in portal reads it directly. Written until the legacy rule closes,
    // exactly as api/appointments/book does.
    tx.set(db.doc(`appointmentCheckIns/${token}`), mirror);

    // ── The completion record ────────────────────────────────────────────
    // Consent is already satisfied by the time we get here, so this exists for
    // two other reasons: the documents the service asks for (photo ID and the
    // like), which the guest can now finish from their phone while they wait
    // rather than at the counter; and to give the lounge and checkout the same
    // context an appointment would have. skipCardStep is true — a walk-in pays
    // at the chair, there is no deposit to authorise — which is precisely what
    // makes the portal's isCompletionPending false when nothing is owed, so
    // this never puts a gate screen in front of a guest with nothing to do.
    tx.set(db.doc(`tenants/${tenantId}/bookingCompletions/${token}`), {
      token,
      tenantId,
      appointmentId: null,
      walkInId: walkInRef.id,
      clientId: foundId,
      clientName: displayName,
      clientEmail: email ? email.toLowerCase() : null,
      serviceId: service.id,
      serviceName: str(service.name, 80),
      depositAmountCents: 0,
      requiredConsentFormIds: [],
      skipCardStep: true,
      cardAlreadyOnFile: false,
      fileRequirements: reqs.fileRequirements,
      appointmentStartTime: nowIso,
      source: 'walkin-kiosk',
      createdAt: nowIso,
    });

    return foundId;
  });

  // ── Persist the signatures somewhere permanent ────────────────────────────
  // Both stores, because two different screens read two different ones:
  // clients/{id}.signedForms is what QuickBookForm's "already on file" check
  // reads, clients/{id}/signedConsents is what AppointmentDetailsSheet reads.
  // The guest-facing check-in portal already tries to write both and its client
  // writes fail silently (clients is staff-only) — here they actually land,
  // which is the difference between "sign once" and "sign every single visit".
  if (signedForms.length) {
    try {
      const batch = db.batch();
      const map: any = {};
      for (const f of signedForms) {
        map[`signedForms.${f.formId}`] = { signedAt: nowIso, formTitle: f.formTitle, source: 'walkin-kiosk' };
        batch.set(db.doc(`tenants/${tenantId}/clients/${clientId}/signedConsents/${f.formId}`), {
          formId: f.formId,
          formTitle: f.formTitle,
          signedAt: nowIso,
          formData: f.formData,
          source: 'walkin-kiosk',
          appointmentId: null,
          walkInId: walkInRef.id,
          ...(f.guardianName ? {
            guardianName: f.guardianName,
            guardianRelationship: f.guardianRelationship,
            guardianSignedAt: nowIso,
          } : {}),
        }, { merge: true });
      }
      batch.set(db.doc(`tenants/${tenantId}/clients/${clientId}`), map, { merge: true });
      // The same audit record the self-service portal writes, so a signature
      // taken at the kiosk shows up in exactly the same place as one taken on
      // a phone. `create: if true` on this collection, so it is the one channel
      // that has always worked for an unauthenticated guest.
      batch.set(db.collection(`tenants/${tenantId}/completionSubmissions`).doc(), {
        token,
        tenantId,
        appointmentId: null,
        walkInId: walkInRef.id,
        clientId,
        clientName: name,
        clientEmail: email ? email.toLowerCase() : null,
        signedForms,
        fileSubmissions: [],
        policyAcceptance: {
          acceptedAt: nowIso,
          cardAuthorization: false,
          policyVersion: tenant?.depositPolicy?.version || 'v1',
          depositAmountCents: 0,
        },
        submittedAt: nowIso,
        cardAlreadyOnFile: false,
        source: 'walkin-kiosk',
      });
      await batch.commit();
    } catch {
      // The signature is on the walk-in row and in the queue either way. A
      // failure to file it permanently must not cost the guest their place.
    }
  }

  // ── Tell somebody a person is standing in the lobby ──────────────────────
  // Addressed to real user ids: the staff portal's bell reads
  // where('userId','==',me), so an unaddressed notification is invisible to
  // everyone. The assigned provider gets one; managers get one either way, so
  // an unassigned guest isn't left standing there because every provider
  // happened to be mid-service.
  try {
    const recipients = new Set<string>();
    if (holder) recipients.add(String(holder.id));
    const mgrs = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['owner', 'admin']).get();
    mgrs.docs.forEach((d: any) => recipients.add(d.id));
    // The owner's own uid off the tenant document, always.
    //
    // The query above is the ONLY thing that was feeding this, and it depends on
    // somebody's staff record carrying role 'owner' or 'admin'. If no staff doc
    // does — a real possibility on a studio set up by importing techs, or where
    // the owner never made herself a staff member — then an UNASSIGNED guest
    // produced an empty recipient set and NOBODY was told anyone had walked in.
    // The guest sits in the lobby and the only place she exists is a screen
    // nobody happens to be looking at.
    const ownerUid = str(tenant?.userId || tenant?.ownerId, 120);
    if (ownerUid) recipients.add(ownerUid);

    if (recipients.size) {
      const batch = db.batch();
      const flag = (patchTestWarning ? ' ⚠ Patch test not on file — confirm before starting.' : '')
        // Nobody passes this service's skill/certification/roster gate, so the
        // rotation will never pick this guest up on its own. If this line does
        // not appear, she waits forever while the board looks normal.
        + (needsFrontDesk ? ' ⚠ No tech currently qualifies for this service — assign by hand.' : '');
      recipients.forEach((uid: string) => {
        const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        const mine = holder && uid === String(holder.id);
        const askedFor = isRequested || waitingForRequested;
        batch.set(nRef, {
          id: nRef.id,
          userId: uid,
          type: 'walk_in_assigned',
          read: false,
          createdAt: nowIso,
          link: 'today',
          message: mine
            ? (waitingForRequested
              ? `${name} asked for you and is happy to wait · ${service.name || 'service'} · about ${estWaitMin} min.${flag}`
              : `Walk-in ${askedFor ? 'requested you' : 'assigned'}: ${name} · ${service.name || 'service'} · ready for you now.${flag}`)
            : `Walk-in: ${name} joined the queue for ${service.name || 'a service'}${holder ? ` — ${askedFor ? 'asked for' : 'sent to'} ${holder.name || 'a provider'}.` : ' — nobody free yet.'}${flag}`,
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
    staffName: holder ? str(holder.name, 80) : '',
    staffFirstName: holder ? firstName(holder.name) : '',
    assigned: !!assigned,
    isRequested,
    waitingForRequested,
    preferredUnavailable,
    patchTestWarning,
    // Surfaced so the kiosk can say "you're in line — please see the front desk
    // so we can match you with the right tech" instead of pretending a provider
    // is coming. She is in the QUEUE either way, which is the whole point.
    needsFrontDesk,
    estWaitMin,
    serviceName: str(service.name, 80),
    durationMin: svcMins,
    // Everything the kiosk needs to print the ticket and build the QR without
    // a second round trip. ticketScanValue prefers shortCode; ticketCheckInUrl
    // builds {origin}/check-in/{checkInToken}.
    checkInToken: token,
    shortCode,
    clientName: name,
  });
}

// ─── complete — the missing producer ─────────────────────────────────────────
//
// Nothing in this application ever finished a walk-in ROW. The Terminal's
// walk-in panel does offer Finished, but that path (onFinishService ->
// TechnicianReviewDialog -> onSendToFrontDesk) writes only to the mirror
// appointment, and checkout likewise stamps 'completed' on the appointment
// alone. The walkIns document is never touched by either. So in-service stayed
// a one-way door for the row: it sat there forever, the provider stayed in
// busyIds forever, and staff.lastWalkInCompletedAt — the field the staff
// board's own turn order sorts on — was never written by anything, anywhere.
//
// The consequence compounded. Each provider who started a walk-in was removed
// from assignment permanently, so after as many walk-ins as there were
// providers, every single one was excluded and every subsequent guest was told
// the floor was full. This action is the other half of Start Service.
//
// Staff-triggered, and like every other staff-triggered route in this codebase
// it has no auth check — the rate limit is the mitigation. It refuses to touch
// a row that belongs to an appointment, matching the board's own discipline of
// guarding on walkIn.appointmentId before writing anything.

async function handleComplete(db: any, tenantId: string, body: any) {
  const walkInId = str(body?.walkInId, 200);
  if (!walkInId) return NextResponse.json({ ok: false, error: 'Missing walk-in.' }, { status: 400 });
  if (!(await rateLimit(db, tenantId, 'walkInCompleteRate', 240))) {
    return NextResponse.json({ ok: false, error: 'Too many requests. Please try again shortly.' }, { status: 429 });
  }

  const ref = db.doc(`tenants/${tenantId}/walkIns/${walkInId}`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: 'That walk-in could not be found.' }, { status: 404 });
  const row = (snap.data() as any) || {};

  // A row carrying an appointmentId is a booked appointment that happened to be
  // surfaced on the walk-in board. The board itself guards on walkIn.appointmentId
  // before writing anything, and the appointment flow owns that row's status —
  // closing it from here would put two writers on one record.
  if (row.appointmentId) {
    return NextResponse.json({
      ok: false,
      error: 'That booking is an appointment — close it from the appointment instead.',
    }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const already = ['completed', 'cancelled', 'canceled', 'no_show'].includes(String(row.status || '').toLowerCase());
  if (already) {
    return NextResponse.json({ ok: true, alreadyClosed: true, status: str(row.status, 20) });
  }

  const batch = db.batch();
  batch.set(ref, {
    status: 'completed',
    completedAt: nowIso,
    updatedAt: nowIso,
    ...(row.serviceStartTime ? {} : { serviceStartTime: nowIso }),
  }, { merge: true });

  // Mirror the close so a guest whose phone is still open on the waiting
  // screen stops being told they're in service.
  if (row.checkInToken) {
    const closed = { status: 'completed', checkInStatus: 'completed', updatedAt: nowIso };
    batch.set(db.doc(`tenants/${tenantId}/appointmentCheckIns/${row.checkInToken}`), closed, { merge: true });
    batch.set(db.doc(`appointmentCheckIns/${row.checkInToken}`), closed, { merge: true });
  }

  // The row's own staffId first, then whoever the caller says did the work.
  // This second source matters: the staff board's Start Service sets the
  // provider's status to 'busy' but never writes staffId onto the row, so a
  // guest picked up off the unassigned pile finishes with no provider recorded
  // anywhere — and that provider would stay flagged busy for the rest of the
  // day with nothing to clear it.
  const staffId = str(row.staffId, 120) || str(body?.staffId, 120);
  if (staffId) {
    // A requested walk-in does not advance the rotation — see rotate(). It
    // still frees the chair, so status comes back off `busy` either way.
    const update: any = { updatedAt: nowIso };
    if (row.isRequested !== true) update.lastWalkInCompletedAt = nowIso;
    // Only clear a `busy` flag we can reasonably attribute to this service.
    // Overwriting 'on_break' or 'off' would put a provider back on the floor
    // who isn't standing on it.
    const sSnap = await db.doc(`tenants/${tenantId}/staff/${staffId}`).get();
    const sData: any = sSnap.exists ? (sSnap.data() as any) || {} : {};
    if (String(sData.status || '') === 'busy') update.status = 'available';
    batch.set(db.doc(`tenants/${tenantId}/staff/${staffId}`), update, { merge: true });
  }

  await batch.commit();

  return NextResponse.json({
    ok: true,
    walkInId,
    completedAt: nowIso,
    rotationAdvanced: !!staffId && row.isRequested !== true,
  });
}
