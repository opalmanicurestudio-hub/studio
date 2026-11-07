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

import { extraMinutesFor, extraChargeCents } from '@/lib/client-timing';
import { limitPublic } from '@/lib/rate-limit';
import { recordConsent } from '@/lib/consent';
import { publicVisitCopy } from '@/lib/public-visit-copy';
import { placeOf, placeOptionsOf, placeLine, arrivalLine, clientAddressOf } from '@/lib/service-place';
import { unpaidFeeRuleOf } from '@/lib/booking-policies';
import { resolvePolicy } from '@/lib/booking-policies';
import { checkChange, chainAfterMove } from '@/lib/change-rules';
import { bookingPolicyLines, holdLine } from '@/lib/policy-copy';
import { linkOrigin } from '@/lib/app-origin';
import { offerProblem, walletStatus, offerLine } from '@/lib/offers';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { generateShortCode } from '@/lib/short-code';
import { nanoid } from 'nanoid';
import { verifyStaffActor } from '@/lib/staff-auth';
import { createHash, createHmac } from 'crypto';

/**
 * WHO IS ASKING. Staff treatment (no notice/horizon limits, the staff booking
 * plan, a staff-set price) used to follow a `source` label the CALLER sent —
 * so anyone booking online could claim to be the front desk and skip notice,
 * deposit and approval, or send their own price. Now it is earned:
 *   'internal' — a server-to-server call carrying CRON_SECRET (x-cf-internal)
 *   'staff'    — a signed-in owner/team member of THIS business (Bearer token)
 *   'renter'   — a valid renter-portal session, booking on that renter's own calendar
 * Anything else is treated as a public booking, whatever `source` says.
 */
async function callerTrust(req: NextRequest, tenantId: string, body: any): Promise<'internal' | 'staff' | 'renter' | null> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('x-cf-internal') === secret) return 'internal';
  if ((req.headers.get('authorization') || '').toLowerCase().startsWith('bearer ')) {
    const a = await verifyStaffActor(req, tenantId).catch(() => null);
    if (a && (a as any).ok) { (body as any).__staffActor = (a as any).actor; return 'staff'; }
  }
  const tok = typeof body?.renterToken === 'string' ? body.renterToken : '';
  if (tok) {
    try {
      const db = getAdminDb();
      const all = ((await db.doc(`tenants/${tenantId}/private/renterSessions`).get()).data() as any) || {};
      const entry = all[createHash('sha256').update(tok).digest('hex')];
      if (entry && entry.expiresAt > Date.now() && entry.renterId && body.staffId && body.staffId !== 'any') {
        const st = ((await db.doc(`tenants/${tenantId}/staff/${String(body.staffId)}`).get()).data() as any) || null;
        if (st && (st.renterId === entry.renterId || String(body.staffId) === String(entry.renterId))) return 'renter';
      }
    } catch { /* not trusted */ }
  }
  return null;
}
import { verifyBookable, providerMinutes } from '@/lib/availability';
import { graceHoursOf, resolveBookingPlan, shouldAutoApprove } from '@/lib/deposit-policy';
import { searchFields } from '@/lib/client-search';

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
  'renter_portal',
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
  // Each photo as sent, and (lib/markup) the photo before its marks and the marks themselves, so they can be changed later.
  // Kept privately (only the team opens it); the marks are the client's own, checked again.
  const { keepMarkup } = await import('@/lib/markup/model'); const { ownOriginal } = await import('@/lib/inspo-photos');
  const tid = String((body as any)?.tenantId || '');
  let inspoIn: { url: string; note: string; original?: string; markup?: string }[] = (Array.isArray((body as any)?.inspirationPhotos) ? (body as any).inspirationPhotos : []).slice(0, 4)
    .filter((x: any) => x && /^https:\/\//.test(String(x.url || '')) && String(x.url).length <= 1000)
    .map((x: any) => { const original = ownOriginal(x.original, tid); const markup = original ? keepMarkup(x.markup, { as: 'client' }) : null;
      return { url: String(x.url), note: String(x.note || '').slice(0, 300), ...(original ? { original } : {}), ...(markup ? { markup } : {}) }; });
  // How it looks now, to compare with them (the same checks).
  let photosLeftOut = 0;
  let nowIn = (() => { const x: any = (body as any)?.nowPhoto; if (!x || !/^https:\/\//.test(String(x.url || '')) || String(x.url).length > 1000) return null;
    const original = ownOriginal(x.original, tid); const markup = original ? keepMarkup(x.markup, { as: 'client' }) : null;
    return { url: String(x.url), note: String(x.note || '').slice(0, 300), ...(original ? { original } : {}), ...(markup ? { markup } : {}) }; })();
  const signedFormsIn: any[] = (() => {
    const list = Array.isArray((body as any)?.signedForms) ? (body as any).signedForms.slice(0, 10) : [];
    // Answers keep only plain question ids as keys: never empty, never the form screen's own marks, never "__…__" (which
    // the database keeps for itself). A question's own id can start with "__", so that alone is fine.
    const answersOf = (d: any) => (d && typeof d === 'object' && !Array.isArray(d) ? Object.fromEntries(Object.entries(d).filter(([k]) => /^[A-Za-z0-9_-]{1,80}$/.test(k) && !/^__.*__$/.test(k) && !['__signedName', '__read', '__seen'].includes(k)).slice(0, 200)) : {});
    const clean = list.filter((f: any) => f && typeof f === 'object' && f.formId).map((f: any) => ({ formId: String(f.formId).slice(0, 80), formTitle: String(f.formTitle || '').slice(0, 200), formData: answersOf(f.formData), signedAt: new Date().toISOString(),
      // The name they typed to sign it, and "I've read this" on a form with only wording.
      ...(typeof f.signedName === 'string' && f.signedName.trim() ? { signedName: f.signedName.trim().slice(0, 120) } : {}),
      ...(f.acknowledged === true ? { acknowledged: true } : {}),
      // A parent or guardian who completed it for someone under 18, and said so (their name, how they're related, and
      // their tick that they're the parent or legal guardian and agree for them).
      ...(f.guardian && typeof f.guardian === 'object' && f.guardian.confirmed === true && typeof f.guardian.name === 'string' && f.guardian.name.trim() && typeof f.guardian.relationship === 'string' && f.guardian.relationship.trim()
        ? { guardian: { name: f.guardian.name.trim().slice(0, 120), relationship: f.guardian.relationship.trim().slice(0, 80), confirmed: true } } : {}) }));
    return JSON.stringify(clean).length <= 600_000 ? clean : null;   // null: too large to keep (said so below, never dropped quietly)
  })();
  if (signedFormsIn === null) return NextResponse.json({ ok: false, error: 'Those forms are too large to send. Shorten a long answer, or clear a signature and sign it again, then try once more.' }, { status: 413 });
    const { tenantId, serviceId, startTime } = body || {};
    const source = String(body.source || 'api').slice(0, 40);
    const channel = String(body.channel || '').slice(0, 24) || null;   // where the client came from (a shared link's src)
    const trust = await callerTrust(req, String(tenantId || ''), body);
    let groupSigned = false;   // one guest's part of a group booking, sent by our own server (book-group)
    if (!trust) {
      // Public bookings send texts and emails, so they're limited: per visitor per hour, and per business per day.
      // A group booking calls this once per guest from our own server; those calls are signed (x-cf-group-sig) and
      // skip the per-visitor count, because the group route already counted the visitor.
      const secret = process.env.CRON_SECRET || ''; const sig = req.headers.get('x-cf-group-sig') || '';
      const signed = !!secret && !!sig && body?.groupRequest === true && sig === createHmac('sha256', secret).update(`${tenantId}|${body?.serviceId}|${body?.startTime}`).digest('hex');
      groupSigned = signed;
      const limited = await limitPublic(req, 'book', String(tenantId || ''), { perHour: signed ? 1000 : 20, perDay: 600 }); if (limited) return limited;
    }
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
    // Photos only from this business's own photo upload (api/booking/photo): the team opens them, so never another site.
    // Any left out are counted, so the client is told (the booking itself goes ahead).
    if (inspoIn.length || nowIn) {
      const { ownInspoPhoto, ourBuckets } = await import('@/lib/inspo-photos'); const buckets = await ourBuckets(tenant);
      const own = async (x: any) => { const u = await ownInspoPhoto(db, x.url, tenantId, buckets); if (!u) { photosLeftOut++; console.warn('[book] a photo that isn’t this business’s own was left out'); } return u ? { ...x, url: u } : null; };
      inspoIn = (await Promise.all(inspoIn.map(own))).filter(Boolean) as typeof inspoIn;
      nowIn = nowIn ? await own(nowIn) : null;
    }

    // ── MOVING A VISIT (client reschedule from the booking page) ──────────
    // The business's change rules apply before anything is created: the change
    // cutoff and the change limit (then staff approval, or no more changes online).
    // Staff/our server aren't limited here. When allowed, the new booking
    // inherits the original time + count, so deadlines can't be pushed back.
    let replacedChain: { originalStartTime: string | null; rescheduleCount: number } | null = null;
    let movingOwn = false;   // moving their own visit of the same service (its forms were asked for when it was booked)
    const replacesId = typeof body.replacesAppointmentId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.replacesAppointmentId) ? body.replacesAppointmentId : null;
    if (replacesId) {
      const oldSnap = await db.doc(`tenants/${tenantId}/appointments/${replacesId}`).get();
      const old: any = oldSnap.exists ? oldSnap.data() : null;
      if (old) {
        if (!trust) {
          const rule = checkChange(tenant, old, 'client', services.find((x: any) => x.id === old.serviceId));
          if (!rule.allowed) {
            if (rule.needsApproval && !old.changeRequestedAt) {
              const nowIso = new Date().toISOString();
              await oldSnap.ref.set({ changeRequestedAt: nowIso, changeRequestedFor: body.startTime || null }, { merge: true }).catch(() => {});
              const n = db.collection(`tenants/${tenantId}/notifications`).doc();
              await n.set({ id: n.id, userId: null, read: false, createdAt: nowIso, type: 'change_request', link: 'pos',
                message: `Action needed: ${old.clientName || 'A client'} has asked to reschedule their ${old.serviceName || 'appointment'}, which has already been rescheduled ${rule.count} time${rule.count === 1 ? '' : 's'}${body.startTime ? `, to ${new Date(body.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined })}` : ''}. Please reschedule it for them.` }).catch(() => {});
              await logAuditAdmin(db, tenantId, { action: 'appointment.change_requested', targetType: 'appointment', targetId: replacesId,
                summary: `${old.clientName || 'Client'} asked to move it again — over the change limit (${rule.count}/${rule.limit}), staff approval needed`, actor: { type: 'user', name: old.clientName || 'Client', role: 'client', via: 'booking page' } }).catch(() => {});
            }
            return NextResponse.json({ ok: false, error: rule.reason, changeRequested: rule.needsApproval }, { status: 409 });
          }
        }
        replacedChain = chainAfterMove(old);
        const em = String(body?.client?.email || '').trim().toLowerCase(), ph = String(body?.client?.phone || '').replace(/\D/g, '').slice(-10);
        movingOwn = String(old.serviceId || '') === String(serviceId || '') && !['cancelled', 'canceled'].includes(String(old.status || ''))
          && ((!!em && String(old.clientEmail || '').trim().toLowerCase() === em) || (ph.length === 10 && String(old.clientPhone || '').replace(/\D/g, '').slice(-10) === ph));
      }
    }

    // ── UNPAID CHANGE FEE (Booking policies: "they pay it before booking again") — online only ─────
    // Matched by email/phone like the limit below. The pay link goes ONLY to the client's own email on
    // file — never shown here, never sent to whatever address was typed (that would leak their account).
    if (!trust && unpaidFeeRuleOf(tenant) === 'before_booking') {
      const em = String(body?.client?.email || '').trim().toLowerCase(); const pd = String(body?.client?.phone || '').replace(/\D/g, '').slice(-10);
      const hits: any[] = [];
      try {
        if (em) hits.push(...(await db.collection(`tenants/${tenantId}/clients`).where('email', '==', em).limit(5).get()).docs);
        if (pd.length === 10) for (const f of [pd, `+1${pd}`, `(${pd.slice(0, 3)}) ${pd.slice(3, 6)}-${pd.slice(6)}`]) hits.push(...(await db.collection(`tenants/${tenantId}/clients`).where('phone', '==', f).limit(3).get()).docs);
      } catch { /* best-effort */ }
      const owing = hits.map((d: any) => ({ id: d.id, ...(d.data() as any) })).find((c: any) => Number(c.outstandingBalance) > 0);
      if (owing) {
        const bal = Number(owing.outstandingBalance);
        const last = Date.parse(owing.balanceLinkSentAt || '');
        if (String(owing.email || '').includes('@') && !(Number.isFinite(last) && Date.now() - last < 3600000)) {
          try {
            const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
            const origin = linkOrigin(tenant, req.nextUrl.origin);
            const studio = (tenant as any).name || 'the studio';
            await sendNotification(db, { tenantId, channel: 'email', to: String(owing.email), subject: `Your balance with ${studio}`, kind: 'balance_due',
              html: brandedEmailHtml({ studioName: studio, title: 'Before your next booking', bodyLines: [`Hi ${String(owing.name || '').split(' ')[0] || 'there'},`, `Thank you for your interest in booking with us. Our records show an outstanding balance of $${bal.toFixed(2)} from a previous appointment change. Once this balance has been paid, you will be able to book your next appointment.`, `Kind regards, ${studio}`], cta: { label: 'Pay my balance', url: `${origin}/portal/${tenantId}/${owing.id}?k=${encodeURIComponent((await import('@/lib/portal-key')).portalKey(tenantId, String(owing.id)) || '')}` } }),
              clientId: owing.id, clientName: owing.name || null } as any);
            await db.doc(`tenants/${tenantId}/clients/${owing.id}`).set({ balanceLinkSentAt: new Date().toISOString() }, { merge: true });
          } catch (e) { console.error('[book] balance link failed', e); }
        }
        return NextResponse.json({ ok: false, code: 'balance_due', error: `Our records show an unpaid balance on your account from a previous change. We have emailed you a link to pay it, and once it has been paid, you will be able to book.` }, { status: 402 });
      }
    }

    // ── UPCOMING-BOOKING LIMIT (Booking policies) — online bookings only ─────
    const maxUpcoming = Number(resolvePolicy(tenant).access.maxUpcoming.value) || 0;
    if (!trust && maxUpcoming > 0) {
      const ids = new Set<string>();
      if (typeof body?.client?.id === 'string' && body.client.id) ids.add(body.client.id);
      const em = String(body?.client?.email || '').trim().toLowerCase();
      const pd = String(body?.client?.phone || '').replace(/\D/g, '').slice(-10);
      try {
        if (em) (await db.collection(`tenants/${tenantId}/clients`).where('email', '==', em).limit(5).get()).docs.forEach((d: any) => ids.add(d.id));
        if (pd.length === 10) for (const f of [pd, `+1${pd}`, `(${pd.slice(0, 3)}) ${pd.slice(3, 6)}-${pd.slice(6)}`])
          (await db.collection(`tenants/${tenantId}/clients`).where('phone', '==', f).limit(3).get()).docs.forEach((d: any) => ids.add(d.id));
      } catch { /* matching is best-effort */ }
      if (ids.size) {
        const nowIso = new Date().toISOString(); let upcoming = 0;
        for (const cid of Array.from(ids).slice(0, 5)) {
          const q = await db.collection(`tenants/${tenantId}/appointments`).where('clientId', '==', cid).limit(60).get();
          upcoming += q.docs.filter((d: any) => { const x = d.data() as any; return d.id !== replacesId && String(x.startTime || '') >= nowIso && !['cancelled', 'canceled', 'declined', 'expired', 'completed', 'no_show', 'released'].includes(String(x.status || '')); }).length;
        }
        if (upcoming >= maxUpcoming) return NextResponse.json({ ok: false, error: `You already have ${upcoming} upcoming booking${upcoming === 1 ? '' : 's'} with us — the most we can hold at once is ${maxUpcoming}. Reschedule or cancel one of them from its confirmation link, then book again.` }, { status: 409 });
      }
    }

    let svc = services.find((s: any) => s.id === serviceId);
    // A phone appointment where WE call them needs a number to call.
    // Where it happens: the client's pick when the service lets them choose, otherwise its main option.
    const placeOpts = placeOptionsOf(svc); const placeChoice = placeOpts.includes(body?.place) ? body.place : placeOpts[0];
    const svcAsBooked: any = svc ? { ...svc, where: placeChoice } : svc;
    { const pl = placeOf(svcAsBooked);
      if (pl.kind === 'phone' && pl.phoneWho !== 'they_call' && String(body?.client?.phone || '').replace(/\D/g, '').length < 7 && !String(body?.client?.id || ''))
        return NextResponse.json({ ok: false, error: 'This is a phone appointment — please add the number we should call you on.' }, { status: 400 }); }
    // A campaign offer code, if the client came from one — verified here.
    let pendingCode: string | null = null;
    if (typeof body.promoCode === 'string' && body.promoCode.trim()) {
      try {
        const code = body.promoCode.trim().toUpperCase().slice(0, 40);
        const hit = await db.collection(`tenants/${tenantId}/discounts`).where('code', '==', code).limit(1).get();
        const dz: any = hit.docs[0]?.data();
        // Same rules as checkout (dates, usage, services). "Once per client"
        // is checked after the booking, when we know who the client is.
        if (dz && !offerProblem(dz, { serviceIds: [String(serviceId || '')] })) pendingCode = code;
      } catch { /* no code */ }
    }
    // Independent-provider menus live in their own collection. Looked up only
    // on a miss, so the house path costs nothing. The flag rides onto the
    // appointment below, which is what keeps their sale out of YOUR books.
    let renterSvc: any = null;
    let renterProvider: any = null;
    if (!svc) {
      try {
        const rs = await db.doc(`tenants/${tenantId}/renterServices/${serviceId}`).get();
        if (rs.exists) {
          const d = rs.data() as any;
          if (d?.isActive !== false) {
            const provider = roster.find((m: any) => m.id === d.staffId && m.isRenter && m.isActive !== false);
            if (provider) {
              renterProvider = provider;
              renterSvc = { id: rs.id, ...d, providerName: provider.name || 'your provider', staffIds: [provider.id] };
              svc = renterSvc;
            }
          }
        }
      } catch { /* fall through to the 404 below */ }
    }
    if (!svc) return NextResponse.json({ ok: false, error: 'Service not found.' }, { status: 404 });

    const addOnIds: string[] = Array.isArray(body.addOnIds) ? body.addOnIds.slice(0, 10).map(String) : [];
    let addOnMinutes = 0;
    for (const id of addOnIds) {
      const a = services.find((s: any) => s.id === id);
      if (a) addOnMinutes += Number((a as any).duration) || 0;
    }
    // Staff may set a custom length (5–600 min); the clash check below uses it too.
    const staffSet = trust === 'staff' || trust === 'internal';
    const customLen = staffSet && Number.isFinite(Number(body.durationMinutes)) && Number(body.durationMinutes) >= 5 && Number(body.durationMinutes) <= 600 ? Math.round(Number(body.durationMinutes)) : null;
    // THE CLIENT'S OWN TIME (online): when the email or phone matches a client with a usual extra time for this service,
    // reserve it — only ever MORE time (shortening a visit is a staff decision). The price is unchanged here; the charge for
    // extra time is shown and agreed separately. If the longer visit doesn't fit, the answer says so (code 'needs_longer').
    let clientExtra = 0; let clientExtraCents = 0;
    if (!staffSet && customLen == null) {
      try {
        const em = String(body?.client?.email || '').trim().toLowerCase(); const pd = String(body?.client?.phone || '').replace(/\D/g, '').slice(-10);
        const own = (snap: any) => (snap?.docs || []).map((d: any) => d.data() || {}).find((c: any) => !c.ownerRenterId) || null;
        let hit: any = em ? own(await db.collection(`tenants/${tenantId}/clients`).where('email', '==', em).limit(5).get()) : null;
        if (!hit && pd.length === 10) for (const f of [pd, `+1${pd}`, `(${pd.slice(0, 3)}) ${pd.slice(3, 6)}-${pd.slice(6)}`]) { hit = own(await db.collection(`tenants/${tenantId}/clients`).where('phone', '==', f).limit(3).get()); if (hit) break; }
        if (hit) { clientExtra = Math.max(0, extraMinutesFor(hit, String(svc.id || body.serviceId || ''))); if (clientExtra > 0) clientExtraCents = extraChargeCents(tenant, svc, hit, String(svc.id || body.serviceId || '')); }
      } catch { /* best-effort: never blocks a booking */ }
    }
    const duration = customLen ?? ((Number(svc.duration) || 60) + addOnMinutes + clientExtra);
    // Group requests: the time is reserved, but no one is there to agree a charge per guest — the desk can add it.
    if (body?.groupRequest === true) clientExtraCents = 0;
    // A charge for that extra time is never added silently: unless they've agreed to THIS amount, ask first.
    const extraLine = clientExtraCents > 0 ? `Includes about ${clientExtra} extra minutes (+$${(clientExtraCents / 100).toFixed(2)}), based on your past visits.` : '';
    if (clientExtraCents > 0 && Math.round(Number(body?.acceptExtraCents)) !== clientExtraCents)
      return NextResponse.json({ ok: false, code: 'confirm_extra', extraMinutes: clientExtra, extraCents: clientExtraCents, line: extraLine,
        error: `Your visits here usually take about ${clientExtra} minutes longer, so we reserve that time for you. ${extraLine.replace(/^Includes/, 'That’s')}` }, { status: 409 });
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
    const inStudio = !!trust && IN_STUDIO_SOURCES.includes(source.toLowerCase());

    // ── Times held by an assistant (lib/agent-holds): busy for everyone but the client it was held for. ──
    const { liveHolds, holdsAsBusy } = await import('@/lib/agent-holds');
    let ownHold: any = null;
    if (typeof body.holdId === 'string' && typeof body.holdKey === 'string') {
      try { const h = (await db.doc(`tenants/${tenantId}/agentHolds/${body.holdId.slice(0, 40)}`).get()); const hd: any = h.exists ? h.data() : null;
        if (hd && hd.key === body.holdKey && hd.status === 'held') ownHold = { id: h.id, ...hd }; } catch { /* booked as a normal booking */ }
    }
    const heldRows = holdsAsBusy(await liveHolds(db, `tenants/${tenantId}`), ownHold?.id || null);

    // ── The forms sent with the booking, checked before anything is written (lib/forms) ──
    // Only the forms this visit asks for, each finished by the same rule the booking sheet uses (every required answer,
    // a real signature and the signer's name, "I've read this", and for a form that needs one, a parent or guardian who
    // said they agree). Anything else is kept beside the visit, not counted, and asked for on the visit link. A form
    // that couldn't be read just now isn't counted either.
    const formsPre: { formIds: string[]; defs: any[]; defsRead: boolean } = { formIds: [], defs: [], defsRead: false };
    let acceptedForms: any[] = []; let asideForms: any[] = signedFormsIn;
    try {
      const { formsAskedFor, sentFormDone, formRulesOf } = await import('@/lib/forms');
      formsPre.formIds = formsAskedFor({}, [svc, ...addOnIds.map((id) => services.find((x: any) => x.id === id)).filter(Boolean)]);
      let read = true;
      formsPre.defs = (await Promise.all(formsPre.formIds.map((id) => db.doc(`tenants/${tenantId}/consentForms/${id}`).get().catch(() => { read = false; return null; }))))
        .map((d: any, i: number) => (d?.exists ? { id: formsPre.formIds[i], ...(d.data() || {}) } : null)).filter(Boolean);
      formsPre.defsRead = read;
      const rules = formRulesOf(tenant);
      const ok = (f: any) => { const def = formsPre.defs.find((d: any) => d.id === f.formId); return !!def && sentFormDone(def, f, rules); };
      acceptedForms = signedFormsIn.filter(ok); asideForms = signedFormsIn.filter((f: any) => !ok(f));
    } catch (e) { console.error('[book] forms check', e); }
    // A service whose forms are due when they book (Settings › Forms and documents): online, every one is finished to book.
    // Not for a guest's part of a group (the guest is asked on their own visit link) or a visit being moved (its forms
    // were asked for when it was first booked).
    if (trust === null && formsPre.defsRead && !(groupSigned && body?.quiet === true) && !movingOwn) {
      const { formsRuleOf } = await import('@/lib/forms');
      if (formsRuleOf(svc).due === 'booking') {
        const open = formsPre.defs.find((d: any) => !acceptedForms.some((f: any) => f?.formId === d.id));
        if (open) return NextResponse.json({ ok: false, code: 'forms_needed', error: `Please finish “${String(open.title || 'the form')}” to book. It’s needed before booking.` }, { status: 400 });
      }
    }

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
      for (const h of heldRows) { const s = toLocalIso(h.startTime); if (s) liveAppointments.push({ ...h, startTime: s, endTime: toLocalIso(h.endTime) ?? s }); }

      // v12 — FLEXIBLE mode (the walk-in "auto-turn"): when the requested time
      // doesn't work, search forward in 15-min steps for the EARLIEST opening
      // within flexWindowMin. The walk-in kiosk sends startTime=now +
      // flexible:true and gets back "Dana at 1:15". The rotation that picks
      // "Dana" now lives in the engine, shared with every other surface.
      const flexible = body.flexible === true;
      const flexWindowMin = Math.min(Math.max(Number(body.flexWindowMin) || 240, 0), 480);

      // A renter's booking window. Public clients get horizonDays; an ACTIVE
      // member (matched by the email on this booking) gets memberHorizonDays.
      // This is "early booking" enforced at the moment of booking, so a link
      // that shows more calendar to a member cannot be worked around by
      // editing the request.
      let renterHorizonDays: number | undefined = undefined;
      if (renterSvc) {
        const provider: any = roster.find((m: any) => m.id === renterSvc.staffId);
        const { horizonDaysFor } = await import('@/lib/booking-release');
        // Is this client a member of THIS renter? Matched by the booking email.
        let isMember = false;
        const email = String(body?.client?.email || '').trim().toLowerCase();
        if (email) {
          try {
            const subs = await db.collection(`tenants/${tenantId}/renterMemberSubscriptions`).where('staffId', '==', String(renterSvc.staffId)).where('clientEmail', '==', email).get();
            isMember = subs.docs.some((d: any) => (d.data() as any)?.status === 'active');
          } catch { /* treated as a non-member */ }
        }
        // A members-only service is a perk, enforced here, not a label.
        if (renterSvc.membersOnly === true && !isMember) {
          return NextResponse.json({ ok: false, error: `${renterSvc.name || 'That service'} is for members only. Join on ${renterSvc.providerName || 'the provider'}'s page, then book with the same email.` }, { status: 403 });
        }
        const h = horizonDaysFor(provider?.renterBooking || null, isMember, new Date(), tenant.timezone || 'America/New_York');
        if (h !== null) renterHorizonDays = h;
      } else if (tenant.bookingRelease?.mode && tenant.bookingRelease.mode !== 'off' || svc?.membersOnly === true) {
        // ── The STUDIO's own release settings + members-only services ──
        // A member here is a client with an active studio membership
        // (enroll-membership sets activeMembershipId + subscription.status),
        // matched by the booking's email or phone.
        const { horizonDaysFor } = await import('@/lib/booking-release');
        let isMember = false; let tierEarlyDays = 0;
        const email = String(body?.client?.email || '').trim().toLowerCase();
        const phoneDigits = String(body?.client?.phone || '').replace(/\D/g, '').slice(-10);
        try {
          const hits: any[] = [];
          if (email) hits.push(...(await db.collection(`tenants/${tenantId}/clients`).where('email', '==', email).limit(5).get()).docs);
          if (!hits.length && phoneDigits.length === 10) {
            for (const f of [phoneDigits, `+1${phoneDigits}`, `(${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`]) {
              const q = await db.collection(`tenants/${tenantId}/clients`).where('phone', '==', f).limit(3).get();
              hits.push(...q.docs); if (hits.length) break;
            }
          }
          isMember = hits.some((d: any) => { const c = d.data() as any; return !c.ownerRenterId && !!c.activeMembershipId && c.subscription?.status === 'active'; });
          // A loyalty tier that books early (lib/loyalty): its extra days on top of their window.
          try { const { loyaltyOf } = await import('@/lib/loyalty'); const LS = loyaltyOf(tenant);
            if (LS.on) for (const d of hits) { const c: any = d.data() || {}; const tt = c.loyalty?.tier; const tier = tt?.id && (!tt.until || Date.parse(tt.until) > Date.now()) ? LS.tiers.find((x) => x.id === tt.id) : null;
              if (tier?.earlyDays) tierEarlyDays = Math.max(tierEarlyDays, tier.earlyDays); } } catch { /* no extra days */ }
        } catch { /* treated as a non-member */ }
        if (svc?.membersOnly === true && !isMember) {
          return NextResponse.json({ ok: false, error: `${svc.name || 'That service'} is for members only. Use the email or phone on your membership, or ask us about joining.` }, { status: 403 });
        }
        const h = horizonDaysFor(tenant.bookingRelease || null, isMember, new Date(), tenant.timezone || 'America/New_York');
        if (h !== null) renterHorizonDays = h + tierEarlyDays;
      }

      const engineContext = {
        serviceId,
        addOnIds,
        staffId: requestedStaffId,
        ...(renterHorizonDays !== undefined ? { maxHorizonDays: renterHorizonDays } : {}),
        // A renter's service lives in renterServices, not the house list.
        // The route resolved it into `svc` above and then handed the engine
        // the house list, which doesn't contain it — so every renter booking
        // died with "Service not found" at the last step. The engine sees
        // the service that was actually chosen.
        services: (renterSvc ? [...services, renterSvc] : services).map((x: any) => (customLen && x.id === serviceId ? { ...x, duration: Math.max(5, customLen - addOnMinutes) } : x)),
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
        ignoreShifts: !!trust && body.ignoreShifts === true, // only staff may book outside shifts
        // Public bookings use the business's own notice rule — never one the caller sends.
        minLeadMinutes: inStudio
          ? 0
          : (trust && Number.isFinite(Number(body.minLeadMinutes)) ? Number(body.minLeadMinutes) : undefined),
        maxHorizonDays: inStudio
          ? 3650
          : (trust && Number.isFinite(Number(body.maxHorizonDays)) ? Number(body.maxHorizonDays) : undefined), // public → the business's horizon
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
      // A manager may book over a clash on purpose — a named provider, with a reason, recorded on the booking.
      const actorRole = String((body as any).__staffActor?.role || '').toLowerCase();
      const overrideReason = trust === 'staff' && ['owner', 'admin', 'manager'].includes(actorRole) && requestedStaffId !== 'any'
        ? String(body?.overrideConflict?.reason || '').trim().slice(0, 200) : '';
      if (!staffId && overrideReason) { staffId = requestedStaffId; placedStartMs = start.getTime(); }
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
      // The chosen provider's own booking length for this service (set on their profile), unless staff set a length.
      const ownMinutes = customLen == null ? providerMinutes(roster.find((m: any) => m.id === staffId), svc) : null;
      const placedDuration = ownMinutes == null ? duration : Math.max(5, duration - (Number(svc.duration) || 60) + ownMinutes);
      const placedEnd = new Date(placedStartMs + placedDuration * 60000);

      // ── Client: existing id, or match-by-contact, or create ──
      let clientId = String(body?.client?.id || '');
      let clientName = '';
      // The client RECORD, when we have one — the booking plan reads their
      // history (no-shows, trust flag, completed visits) to decide whether
      // this booking needs a deposit, a card, or the studio's blessing.
      let clientRecord: any = null;
      let clientNew = false;   // a client record made by this booking (forms signed now can go on file: lib/forms-server)
      if (clientId) {
        const c = await tx.get(db.doc(`tenants/${tenantId}/clients/${clientId}`));
        if (!c.exists) return { conflict: 'Client not found.' };
        clientRecord = c.data() as any;
        clientName = clientRecord.name || '';
        if (['banned', 'blocked'].includes(String(clientRecord?.status || ''))) return { conflict: trust ? 'This client is marked “Not to be booked”. A manager can change this on their profile.' : 'We’re sorry, we’re unable to take this booking online. Please contact us directly.', blocked: true };   // “Not to be booked”: online, portal, kiosk and desk alike
      } else {
        clientName = String(body?.client?.name || '').slice(0, MAX_FIELD).trim();
        if (!clientName) return { conflict: 'Client name is required.' };
        // v12 — dedupe: a returning walk-in who types the same phone/email
        // reuses their existing profile instead of minting a duplicate.
        const phoneRaw = String(body?.client?.phone || '').slice(0, 40).trim();
        const emailRaw = String(body?.client?.email || '').slice(0, MAX_FIELD).trim();
        // ── Whose book is this client in? ─────────────────────────────────
        // A renter's booking looks up and creates clients in the RENTER'S
        // book (ownerRenterId); a studio booking looks in the studio's. The
        // same person can exist once in each — that is correct, not a
        // duplicate: two independent businesses, two client records. A
        // renter who leaves takes their book; the studio never sees it.
        const bookOwner: string | null = renterSvc ? (String(renterProvider?.renterId || '') || null) : null;
        const inThisBook = (d: any) => (String((d.data() as any)?.ownerRenterId || '') || null) === bookOwner;
        let reused: any = null;
        if (phoneRaw) {
          const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('phone', '==', phoneRaw).limit(5));
          reused = hit.docs.find(inThisBook) || null;
        }
        if (!reused && emailRaw) {
          const hit = await tx.get(db.collection(`tenants/${tenantId}/clients`).where('email', '==', emailRaw).limit(5));
          reused = hit.docs.find(inThisBook) || null;
        }
        // Consent, with the exact words the client agreed to. Only ever a YES
        // from a booking: an unticked box on a later booking must not wipe a
        // consent given before (opting out is STOP / the unsubscribe link).
        const nowC = new Date().toISOString();
        const consent: any = {};
        if (body?.client?.smsConsent === true) consent.smsConsent = { agreed: true, at: nowC, source: source || 'booking', text: String(body.client.smsConsentText || '').slice(0, 600) || null };
        if (body?.client?.smsMarketing === true) { consent.smsMarketingOptIn = true; consent.smsMarketingOptInAt = nowC; consent.smsMarketingOptInText = String(body.client.smsMarketingText || '').slice(0, 600) || null; consent.smsMarketingOptInSource = source || 'booking'; }
        if (reused) {
          clientId = reused.id;
          clientRecord = reused.data() as any;
          clientName = clientRecord.name || clientName;
          if (['banned', 'blocked'].includes(String(clientRecord?.status || ''))) return { conflict: trust ? 'This client is marked “Not to be booked”. A manager can change this on their profile.' : 'We’re sorry, we’re unable to take this booking online. Please contact us directly.', blocked: true };
          if (Object.keys(consent).length) tx.set(reused.ref, consent, { merge: true });
        } else {
          const newRef = db.collection(`tenants/${tenantId}/clients`).doc();
          clientId = newRef.id; clientNew = true;
          tx.set(newRef, {
            id: clientId,
            name: clientName,
            email: emailRaw || null,
            phone: phoneRaw || null,
            status: 'active',
            lifetimeValue: 0,
            lastAppointment: new Date().toISOString(),
            createdVia: source,
            ...searchFields({ name: clientName, email: emailRaw, phone: phoneRaw }),
            ...(bookOwner ? { ownerRenterId: bookOwner, ownerStaffId: renterSvc.staffId } : {}),
            ...consent,
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
      /* ── WHO IS DOING THE BOOKING? ────────────────────────────────────
       * This was an allow-list of CLIENT sources — 'online', 'client',
       * 'portal', 'web' — and anything else counted as staff. The public
       * booking page sends 'booking-page', which is on neither list, so every
       * single online booking was treated as staff-made and skipped approval
       * entirely. Approval mode looked switched on and did nothing.
       *
       * Inverted deliberately: name the STAFF surfaces, and treat everything
       * else as a client. Getting it wrong in this direction sends a staff
       * booking through the approval queue, which is visible and annoying.
       * The old direction silently confirmed appointments the shop wanted to
       * vet — invisible, and exactly the failure that happened. */
      const STAFF_SOURCES = [
        'manual', 'front-desk', 'terminal', 'walk-in', 'walkin-kiosk', 'lounge',
        'foundation', 'recovery', 'goodwill', 'starter', 'event', 'retell', 'waitlist',
        'renter_portal', 'front_desk', 'planner', 'pos_add_appointment',   // the planner's "Add appointment" is the desk too
      ];
      const staffSide = !!trust && STAFF_SOURCES.includes(String(source || '').toLowerCase());
      let plan = resolveBookingPlan({
        tenant, service: svcAsBooked,   // paid in full when they chose video / phone
        // Only staff may set a price; everyone else pays the service's price.
        price: Number((trust ? body.price : undefined) ?? (Number(svc.price ?? 0) + clientExtraCents / 100)),
        // From a campaign's Book button. The code is only stored if it names
        // a real, active discount; checkout applies it automatically.
        ...(typeof body.campaignId === 'string' && body.campaignId ? { campaignId: String(body.campaignId).slice(0, 64) } : {}),
        ...(pendingCode ? { pendingDiscountCode: pendingCode } : {}),
        client: clientRecord,
        byStaff: staffSide,
      });
      // ONLINE GROUPS AND MULTI-SERVICE VISITS ARRIVE AS ONE REQUEST: each part holds its slot (requests do), the studio
      // accepts the group together, and accepting is when the money is asked for. Only ever makes a public booking
      // stricter, so it needs no trust.
      const groupRequest = body?.groupRequest === true && !staffSide;
      if (groupRequest) plan = { ...plan, status: 'requested', mode: 'approval' } as any;
      if (!groupRequest && plan.status === 'requested' && shouldAutoApprove(tenant, clientRecord)) {
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
        ...(overrideReason ? { conflictOverride: { reason: overrideReason, by: (body as any).__staffActor?.name || 'Manager', clash: firstReason || null, at: nowIso } } : {}),
        ...(customLen ? { durationMinutes: customLen, customLength: true } : {}),
        ...(customLen == null && ownMinutes != null ? { providerMinutes: ownMinutes } : {}),
        ...(clientExtra > 0 ? { clientExtraMinutes: clientExtra } : {}),
        ...(clientExtraCents > 0 ? { checkoutState: { adjustments: { timeOverage: clientExtraCents / 100 }, extraTimeMinutes: clientExtra, extraTimeReason: 'Usual extra time, agreed when booking' } } : {}),
        ...(staffSet && typeof body.internalNotes === 'string' && body.internalNotes.trim() ? { internalNotes: body.internalNotes.trim().slice(0, 2000) } : {}),
        // Linked bookings: a repeat series, a group, or one guest's visit with several providers.
        ...(staffSet && typeof body.seriesId === 'string' ? { seriesId: body.seriesId.slice(0, 64), seriesIndex: Number(body.seriesIndex) || 0 } : {}),
        ...(staffSet && typeof body.groupId === 'string' ? { groupId: body.groupId.slice(0, 64), groupRole: body.groupRole === 'organizer' ? 'organizer' : 'guest', ...(body.groupName ? { groupName: String(body.groupName).slice(0, 80) } : {}) } : {}),
        ...(staffSet && typeof body.visitId === 'string' ? { visitId: body.visitId.slice(0, 64), visitStep: Number(body.visitStep) || 0 } : {}),
        ...(placeOpts.length > 1 ? { place: placeChoice } : {}),   // their choice (in person / video / phone …)
        id: aptId, tenantId,
        clientId, clientName,
        serviceId, addOnIds: addOnIds.length > 0 ? addOnIds : null, blueprintVersion: (svc as any)?.blueprint?.version || null,
        // ── Whose sale is this? ──────────────────────────────────────────────
        // An independent provider's booking is THEIR revenue, not the studio's.
        // Stamped at creation so reporting never has to re-derive it, and
        // revenue is explicitly zero so any total that sums appointments is
        // right by construction rather than by remembering to filter.
        ...(renterSvc ? {
          isRenterBooking: true,
          renterProviderId: renterSvc.staffId,
          renterServiceName: renterSvc.name || '',
          renterServicePrice: Number(renterSvc.price) || 0,
          revenue: 0,
        } : {}),
        staffId,
        startTime: placedStart.toISOString(),
        endTime: placedEnd.toISOString(),
        padBefore, padAfter,
        // Written onto the appointment so the station-capacity check keeps
        // working for this booking even if the service definition changes later.
        requiredResourceIds: Array.isArray(svc.requiredResourceIds) && svc.requiredResourceIds.length > 0
          ? svc.requiredResourceIds : null,
        status: plan.status,
        source, ...(channel ? { channel } : {}),
        // Where it came from, so results credit it once: a follow-up task's link (opp) or a campaign's Book button.
        ...(typeof body.opportunityId === 'string' && /^[A-Za-z0-9_-]{6,60}$/.test(body.opportunityId) ? { opportunityId: body.opportunityId } : {}),
        ...(typeof body.campaignId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.campaignId) ? { campaignId: body.campaignId } : {}),
        checkInToken: token, shortCode,
        checkInStatus: body.checkInStatus === 'arrived' ? 'arrived' : 'pending',
        depositAmountCents: plan.depositCents,
        // Staff may hold an unpaid booking for longer than the online hold (e.g.
        // "until the end of today" while the deposit goes on today's bill).
        ...(trust && plan.status === 'pending_payment' && typeof body.holdUntil === 'string' && Date.parse(body.holdUntil) > Date.now()
          ? { paymentDueAt: new Date(Math.min(Date.parse(body.holdUntil), Date.now() + 7 * 864e5)).toISOString() } : {}),
        // v14 — depositPaid:true = the caller is collecting the deposit at
        // booking time (card on file / terminal). Anything else that owes a
        // deposit starts 'pending'.
        // Only staff/our server may say the deposit was collected — otherwise
        // anyone could mark it paid and have it taken off their bill.
        depositStatus: plan.depositCents > 0
          ? (trust && body.depositPaid === true ? 'paid' : 'pending')
          : 'none',
        ...(trust && body.depositPaid === true && plan.depositCents > 0
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
        // Up to 4 marked-up inspiration photos with a note each; the first also
        // fills inspirationPhotoUrl so every existing screen keeps showing it.
        ...(inspoIn.length ? { inspirationPhotos: inspoIn } : {}),
        ...(nowIn ? { nowPhoto: nowIn } : {}),
        // The visit this booking replaces (client reschedule) — released after payment by the webhook.
        ...(replacedChain || {}),
        ...(typeof body.replacesAppointmentId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.replacesAppointmentId) ? { replacesAppointmentId: body.replacesAppointmentId } : {}),
        // (A single photo on its own only from the team's own booking screens: a client's always comes with the list.)
        inspirationPhotoUrl: inspoIn[0]?.url || (body.inspirationPhotoUrl && trust ? String(body.inspirationPhotoUrl).slice(0, 500) : null),
        // Signed forms travel WITH the booking and are saved here, on the server.
        // (They used to be attached afterwards from the client's browser, which
        // the database rules refuse for clients — so they were silently lost.)
        ...(acceptedForms.length ? { signedForms: acceptedForms } : {}),
        ...(asideForms.length ? { formsSetAside: asideForms } : {}),   // sent, but not finished or not asked for: kept, not counted
        createdAt: nowIso,
        reminderSent: false,
        autoCancelledNoShow: false,
      };
      // Reminder timing for THIS booking: the desk's choice, else the client's own preference ("remind me X hours before").
      {
        const own = staffSet && Number(body.reminderHoursBefore) > 0 ? Number(body.reminderHoursBefore) : Number((clientRecord as any)?.notificationPreferences?.reminderHoursBefore) || 0;
        if (own > 0) { payload.reminderHoursBefore = Math.min(168, Math.max(1, Math.round(own))); payload.ownReminder = true; }
      }
      // Unpaid-fee rule "collected with the new booking's deposit": an owed balance rides this booking's deposit
      // payment (split off again when it's paid). No deposit due → it stays on their account for this visit's bill.
      {
        const owedCents = Math.round((Number((clientRecord as any)?.outstandingBalance) || 0) * 100);
        if (unpaidFeeRuleOf(tenant) === 'with_deposit' && owedCents > 0 && plan.depositCents > 0 && payload.depositStatus === 'pending') payload.balanceCollectCents = owedCents;
      }
      // Linked bookings (a repeat series, or the later parts of a group / visit): the deposit is held by the
      // first booking ("covered") or taken before this visit ("scheduled") — so this one is CONFIRMED now and the
      // unpaid-hold release never cancels it. Staff only.
      const depScheduledMs = staffSet ? Date.parse(String(body.depositScheduledAt || '')) : NaN;
      if (staffSet && plan.depositCents > 0 && payload.status === 'pending_payment' && (body.depositCovered === true || Number.isFinite(depScheduledMs))) {
        Object.assign(payload, Number.isFinite(depScheduledMs)
          ? { status: 'confirmed', depositStatus: 'scheduled', depositDueAt: new Date(Math.max(depScheduledMs, Date.now() + 3600000)).toISOString(), paymentDueAt: null }
          : { status: 'confirmed', depositStatus: 'covered', depositCoveredBy: String(body.depositCoveredBy || 'series').slice(0, 64), paymentDueAt: null });
      }
      if (ownHold) { payload.bookedVia = 'assistant'; payload.agentHoldId = ownHold.id;
        tx.set(db.doc(`tenants/${tenantId}/agentHolds/${ownHold.id}`), { status: 'booked', appointmentId: aptId, bookedAt: nowIso }, { merge: true }); }
      tx.set(aptsRef.doc(aptId), payload);
      // The copies are readable with the visit token — only the visit-link-safe fields go there.
      tx.set(db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`), publicVisitCopy(payload));
      tx.set(db.doc(`appointmentCheckIns/${token}`), publicVisitCopy(payload)); // TODO: remove after legacy rule closes
      if (requestedStaffId === 'any') {
        tx.set(db.doc(`tenants/${tenantId}/staff/${staffId}`), { lastBookingAssignedAt: nowIso }, { merge: true });
      }
      return { aptId, token, shortCode, staffId, clientId, clientName, clientNew, plan, balanceCollectCents: Number(payload.balanceCollectCents) || 0, placedStartIso: placedStart.toISOString(), placedEndIso: placedEnd.toISOString() };
    });

    if ((result as any).conflict) {
      if (clientExtra > 0 && !(result as any).blocked) return NextResponse.json({ ok: false, code: 'needs_longer', extraMinutes: clientExtra, error: `Your visits here usually take about ${clientExtra} minutes longer, so this time doesn’t leave enough room. Here are times that fit.` }, { status: 409 });
      return NextResponse.json({ ok: false, error: (result as any).conflict }, { status: 409 });
    }
    const r: any = result;
    const staffName = roster.find((s: any) => s.id === r.staffId)?.name || null;

    await logAuditAdmin(db, tenantId, {
      action: 'appointment.booked',
      targetType: 'appointment', targetId: r.aptId,
      summary: `${r.clientName || 'Client'} booked ${svc.name || 'a service'} with ${staffName || 'staff'} — ${String(r.placedStartIso).slice(0, 16).replace('T', ' ')}${body.holdOnly ? ' (awaiting payment)' : ''}`,
      // Who actually booked it: the signed-in staff member, the renter, our server — or the client.
      actor: trust === 'staff' && (body as any).__staffActor
        ? { type: 'user', id: (body as any).__staffActor.uid || null, name: (body as any).__staffActor.name || 'Staff', role: (body as any).__staffActor.role || 'staff', via: source }
        : trust === 'renter' ? { type: 'user', name: 'Renter', role: 'renter', via: source }
        : trust === 'internal' ? { type: 'system' as const, name: `ClarityFlow (${source})` }
        : { type: 'user', name: r.clientName || null, role: 'client', via: source },
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
    // ── Staff extras, after the booking exists ──
    let packageRedeemed: boolean | null = null;
    if (staffSet && typeof body.redeemPackageId === 'string' && body.redeemPackageId && r.clientId) {
      // One session off the client's package — on the server, and only if one is left.
      try {
        const cRef = db.doc(`tenants/${tenantId}/clients/${r.clientId}`);
        packageRedeemed = await db.runTransaction(async (tx: any) => {
          const c: any = (await tx.get(cRef)).data() || {};
          const list: any[] = Array.isArray(c.activePackages) ? c.activePackages : [];
          const i = list.findIndex((x: any) => x.packageId === body.redeemPackageId && Number(x.sessionsRemaining) > 0);
          if (i < 0) return false;
          const next = list.map((x: any, j: number) => (j === i ? { ...x, sessionsRemaining: Number(x.sessionsRemaining) - 1 } : x)).filter((x: any) => Number(x.sessionsRemaining) > 0);
          tx.set(cRef, { activePackages: next }, { merge: true });
          tx.set(db.doc(`tenants/${tenantId}/appointments/${r.aptId}`), { redeemedPackageId: body.redeemPackageId, redeemedPackageName: list[i].name || list[i].packageName || null }, { merge: true });
          return true;
        });
      } catch (e) { console.error('[book] package redemption', e); packageRedeemed = false; }
    }
    if (staffSet && typeof body.callbackDraftId === 'string' && body.callbackDraftId) {
      // Booked from a saved call-back → close it as booked.
      await db.doc(`tenants/${tenantId}/callBackDrafts/${body.callbackDraftId}`).set({ status: 'resolved', outcome: 'booked', outcomeNote: 'Booked from the call-back', resolvedAt: new Date().toISOString(), resolvedBy: (body as any).__staffActor?.name || 'Staff', bookedAppointmentId: r.aptId }, { merge: true }).catch(() => {});
    }

    // ── What the visit still needs from the client (lib/forms) ──────────────────────────────────────────────────
    // The forms signed with the booking count for this visit. They go ON FILE (so they aren't asked again next time)
    // when the client record is known to be theirs: the team booked it, or this booking made the record. A public
    // booking (or one passed on for a renter or by the app itself) that matched an existing record by its phone or email
    // keeps them on this visit only, so nobody can sign
    // in someone else's name for good. A form or document still needed (photo ID, a form that needs a guardian, or a
    // form when the booking came from somewhere that doesn't ask) is asked for on the visit link, with the same
    // completion record a phone booking or the desk's "Send to client" makes.
    let formsCtx: { svcs: any[]; formIds: string[]; defs: any[]; cDoc: any; defsRead: boolean } | null = null;
    let askedItems: string[] | null = null;
    try {
      const svcs = [svc, ...addOnIds.map((id) => services.find((x: any) => x.id === id)).filter(Boolean)];
      const cDoc: any = r.clientId ? ((await db.doc(`tenants/${tenantId}/clients/${r.clientId}`).get().catch(() => null))?.data() || {}) : {};
      formsCtx = { svcs, formIds: formsPre.formIds, defs: formsPre.defs, cDoc, defsRead: formsPre.defsRead };
    } catch (e) { console.error('[book] forms', e); }
    // Signed here and theirs to keep: only the finished forms this booking asks for (checked above, before booking).
    const keptForms = acceptedForms;
    if (formsCtx && r.clientId && keptForms.length && (staffSet || (r as any).clientNew)) {
      try { const { recordSignedForms } = await import('@/lib/forms-server');
        await recordSignedForms(db, tenantId, { clientId: r.clientId, appointmentId: r.aptId, source: staffSet ? 'desk_booking' : 'online_booking', forms: keptForms });
        formsCtx.cDoc = ((await db.doc(`tenants/${tenantId}/clients/${r.clientId}`).get()).data() as any) || formsCtx.cDoc;
      } catch (e) { console.error('[book] forms on file', e); /* they're on the visit either way */ }
    }
    if (formsCtx && r.token && r.clientId && (String(body?.client?.email || formsCtx.cDoc.email || '').includes('@') || String(body?.client?.phone || formsCtx.cDoc.phone || '').trim())) {
      try {
        const { formsStillNeeded, filesStillNeeded, formRulesOf } = await import('@/lib/forms');
        // Only forms that still exist (a deleted form can't be opened, so it's never asked for). If the forms couldn't all
        // be read, every one the visit asks for is asked.
        const known = new Set<string>(formsCtx.defsRead ? formsCtx.defs.map((d: any) => d.id) : formsCtx.formIds);
        const formsLeft = formsStillNeeded({ apt: { signedForms: keptForms }, ids: formsCtx.formIds.filter((id) => known.has(id)), client: formsCtx.cDoc, forms: formsCtx.defs, rules: formRulesOf(tenant) });
        const filesLeft = formsCtx.svcs.flatMap((x: any) => filesStillNeeded(x, formsCtx!.cDoc)).filter((f: any, i: number, all: any[]) => all.findIndex((y) => y.id === f.id) === i);
        if (formsLeft.length || filesLeft.length) {
          const nowC = new Date().toISOString();
          // Any deposit or card was settled by the booking itself (its own pay step on the visit link for a held time),
          // so this asks only for the forms and documents.
          await db.doc(`tenants/${tenantId}/bookingCompletions/${r.token}`).set({
            token: r.token, tenantId, appointmentId: r.aptId, clientId: r.clientId, clientName: r.clientName || null, clientEmail: String(body?.client?.email || formsCtx.cDoc.email || '').toLowerCase() || null,
            serviceId: svc?.id || null, serviceName: svc?.name || '', appointmentStartTime: r.placedStartIso,
            depositAmountCents: 0, skipCardStep: true, cardAlreadyOnFile: !!formsCtx.cDoc?.cardOnFile?.paymentMethodId,
            requiredConsentFormIds: formsLeft,
            fileRequirements: filesLeft.slice(0, 10).map((fr: any) => ({ id: String(fr.id || ''), type: 'file_upload', label: String(fr.label || 'A document'), required: true, prompt: String(fr.label || 'A document'), minCount: Number(fr.minCount) || 1, maxCount: Number(fr.maxCount) || 5, acceptedTypes: ['image/*', 'application/pdf'], persistToProfile: !!fr.persistToProfile })),
            status: 'pending', createdAt: nowC, expiresAt: r.placedEndIso, via: staffSet ? 'desk_booking' : 'online_booking',
          }, { merge: true });
          await db.doc(`tenants/${tenantId}/appointments/${r.aptId}`).set({ completionStatus: 'pending' }, { merge: true });
          // Marked as asked once the confirmation (whose link opens straight to these) has actually gone out, below.
          const isPhotoId = (f: any) => [f.id, f.label].some((x) => /photo.?id|^id$/i.test(String(x || '').trim()));   // by its id or its label
          askedItems = [...(formsLeft.length ? ['forms'] : []), ...(filesLeft.some(isPhotoId) ? ['photo_id'] : []), ...(filesLeft.some((f: any) => !isPhotoId(f)) ? ['file'] : [])];
        }
      } catch (e) { console.error('[book] still needed', e); /* the booking stands */ }
    }

    const sendStatus = { smsSent: false, emailSent: false };
    let renterConfirmed = false;
    // A group / multi-provider booking holds its messages until every part is booked (staff only).
    if (!(staffSet && body.quiet === true)) {
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
        const base = linkOrigin(tData, req.nextUrl.origin);
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
        // What the client should know — one shared wording (src/lib/policy-copy.ts),
        // from the business's own settings or their written policy.
        const tAny: any = tenant || {};
        const money$ = (c: number) => `$${(c / 100).toFixed(2)}`;
        const depCents = Number(r.plan?.depositCents) || 0;
        const policyLines: string[] = bookingPolicyLines(tAny, svc, { depositCents: depCents });
        try { const cid = String(r.clientId || ''); if (cid && policyLines.length) { const c = await recordConsent(db, tenantId, { clientId: cid, kind: 'booking_policies', text: policyLines.join('\n'), via: source, ref: r.aptId, name: body?.client?.name || null });
          await db.doc(`tenants/${tenantId}/appointments/${r.aptId}`).set({ policyConsent: { version: c.version, at: c.at, via: source } }, { merge: true }); } } catch { /* the booking stands */ }
        // The extra-time charge they agreed to, in the words they saw — the desk's charge record cites it.
        try { const cid = String(r.clientId || ''); if (cid && clientExtraCents > 0) { const c = await recordConsent(db, tenantId, { clientId: cid, kind: 'extra_time', text: extraLine, via: source, ref: r.aptId, name: String(body?.client?.name || '') || null });
          await db.doc(`tenants/${tenantId}/appointments/${r.aptId}`).set({ extraTimeConsent: { version: c.version, at: c.at, cents: clientExtraCents, minutes: clientExtra } }, { merge: true }); } } catch { /* the booking stands */ }   // what they agreed to when booking
        // Where it happens (studio / online / at the client's place) — so online and mobile visits aren't told to "check in when you arrive".
        const placeSvc: any = renterSvc || svcAsBooked; const where = placeLine(placeSvc, clientAddressOf(body?.client), null, { timeZone: (tenant as any)?.timezone || null, clientPhone: phone || null, businessPhone: (tenant as any)?.phone || (tenant as any)?.twilioPhoneNumber || null });

        // ── A RENTER'S booking is confirmed in the RENTER'S name ────────
        // With the two links a client actually needs: cancel (their own
        // link, package rules applied) and reschedule (opens the renter's
        // page on this service with the old visit released once the new one
        // is booked). The studio's confirmation below is for studio bookings.
        if (renterSvc && !isRequest && !isHold) {
          try {
            const { renterVoice, tellClient } = await import('@/lib/renter-comms');
            const providerDoc: any = roster.find((m: any) => m.id === renterSvc.staffId);
            if (providerDoc?.renterId) {
              const v = await renterVoice(db, tenantId, String(providerDoc.renterId));
              const whenLabel = whenStr;
              const cancelUrl = `${base}/cancel/${tenantId}/${r.aptId}${r.token ? `?k=${encodeURIComponent(r.token)}` : ''}`; // the key proves it's their link
              const rescheduleUrl = `${base}/book/${tenantId}?provider=${encodeURIComponent(String(renterSvc.staffId))}&reschedule=${encodeURIComponent(r.aptId)}${r.token ? `&k=${encodeURIComponent(r.token)}` : ''}`;
              const depositLine = Number(r.plan?.depositCents) > 0 ? `A $${(Number(r.plan.depositCents) / 100).toFixed(2)} deposit secures your appointment, and the remaining balance is due at your visit.` : '';
              renterConfirmed = true;
              await tellClient(db, v, { email, phone, clientId: r.clientId || null, name: r.clientName || null }, `Your appointment is confirmed: ${svcLabel}, ${whenLabel}`,
                [`Hi ${firstName}, thank you for booking. Your ${svcLabel} on ${whenLabel} is confirmed${renterSvc.price ? ` ($${Number(renterSvc.price).toFixed(0)})` : ''}.`,
                 depositLine,
                 `If you need to reschedule, please use this link: ${rescheduleUrl}`,
                 `If you are unable to attend, you can cancel here: ${cancelUrl}`,
                 where,
                 placeOf(placeSvc).kind === 'studio' ? `Please check in when you arrive: ${checkInUrl}` : `Your visit page: ${checkInUrl}`].filter(Boolean) as string[], 'renter_client_confirmed');
              sendStatus.emailSent = email.includes('@'); sendStatus.smsSent = !!phone;
            }
          } catch (e) { console.error('[book] renter confirmation', e); /* fall through to the studio's */ }
        }

        // Email — the shared shell (lib/email-template, board 15G); the CONTENT matches the state.
        if (!renterConfirmed && email.includes('@')) {
          const { brandedEmailHtml, fullAddressOf } = await import('@/lib/email-template');
          const { seeYouDay, wallWhen, whatLine } = await import('@/lib/visit-email');
          const { resolveAddressPolicy, resolveAddressForMessage } = await import('@/lib/message-policy');
          const at = wallWhen(local);
          const minutes = Math.round((Date.parse(r.placedEndIso) - Date.parse(r.placedStartIso)) / 60000);
          // Where: an online, phone or at-home visit says so; a studio visit gets the address the business shares
          // (or its area, and when the full address comes, per its message settings).
          const studioVisit = placeOf(placeSvc).kind === 'studio';
          // A business that never chose an address setting gets its area here, as in its email footer; the street goes
          // out only under the setting it chose.
          const addressFor = (confirmed: boolean) => { if (!studioVisit) return null;
            try { const pol = resolveAddressPolicy(tAny); if (!tAny.addressPolicy?.mode) return pol.areaLabel || null;
              return resolveAddressForMessage(pol, { fullAddress: fullAddressOf(tAny), confirmed, eventStartIso: r.placedStartIso }).text || null; } catch { return null; } };
          // A request or a held time shows what and when only: a video link, a call-in number or the address of the
          // client's own home goes out once the visit is confirmed (the studio's address follows its own setting).
          const detailsFor = (confirmed: boolean) => ({ big: at.big, lines: [whatLine(svcLabel, staffName, minutes), confirmed ? (where || addressFor(true)) : addressFor(false)].filter(Boolean) as string[] });
          const html = isRequest
            ? brandedEmailHtml({
              studioName,
              /* A REQUEST is not a booking, and the email must never let
               * someone believe otherwise — no confirmation code, no
               * "you're booked", and the honest charge position up front. */
              eyebrow: 'Request received',
              title: 'Not booked',
              titleBold: 'yet',
              preheader: `We’ll confirm your request for ${at.big} as soon as we can.`,
              bodyLines: [
                `Hi ${firstName}, thanks for your request. We review every request personally, and you’ll hear from us shortly. There’s nothing you need to do in the meantime.`,
                ...(r.plan?.depositCents > 0
                  ? [r.plan?.requiresCardOnFile
                    ? `You haven’t been charged. Your card has been saved securely. If we accept your request, the $${(r.plan.depositCents / 100).toFixed(2)} deposit will be charged to it automatically and your appointment will be confirmed. If the card is declined, we’ll send you a link to pay within ${graceHoursOf(tenant)} hours; if the deposit isn’t received by then, the time will be released.`
                    : `You haven’t been charged. If we accept your request, we’ll ask for the $${(r.plan.depositCents / 100).toFixed(2)} deposit to confirm your appointment.`]
                  : []),
              ],
              details: detailsFor(false),
              cta: { label: 'View my request', url: portalUrl },
              smallPrint: 'We’ll confirm your request or suggest another time as soon as we can.',
            })
            : isHold
            ? brandedEmailHtml({
              studioName,
              eyebrow: 'One more step',
              title: 'Finish your',
              titleBold: 'booking',
              preheader: `We’re holding ${at.big} for you.`,
              bodyLines: [
                `Hi ${firstName}, we’re holding this time for you. To confirm it, please complete your deposit and any forms with the button below. Your confirmation follows as soon as that’s done.`,
                ...((r as any).balanceCollectCents > 0 ? ['Your balance from a previous visit is collected together with the deposit. It isn’t part of the deposit.'] : []),
              ],
              details: detailsFor(false),
              amounts: depCents > 0 ? ((r as any).balanceCollectCents > 0
                ? [{ label: r.plan?.fullPayment ? 'Payment in full' : 'Deposit', value: money$(depCents) },
                   { label: 'Balance from a previous visit', value: money$((r as any).balanceCollectCents) },
                   { label: 'To pay now', value: money$(depCents + (r as any).balanceCollectCents), strong: true }]
                : [{ label: r.plan?.fullPayment ? 'Payment in full' : 'Deposit to pay', value: money$(depCents), strong: true }]) : null,
              cta: { label: 'Complete my booking', url: checkInUrl },
              smallPrint: [depCents > 0 ? (r.plan?.fullPayment ? 'This is payment in full, and nothing more will be due.' : 'Your deposit comes off your total on the day of your visit.') : '',
                holdLine(tAny, trust && typeof body.holdUntil === 'string' && Date.parse(body.holdUntil) > Date.now() ? new Date(body.holdUntil) : null)].filter(Boolean).join(' '),
            })
            : brandedEmailHtml({
              studioName,
              eyebrow: 'Booking confirmed',
              title: 'See you',
              titleBold: seeYouDay(local, new Date(Date.now() + tzOffset * 60000)),
              preheader: `${at.big}: ${whatLine(svcLabel, staffName)}`,
              bodyLines: [`Hi ${firstName}, thanks for booking with us. You’re all set.`],
              details: detailsFor(true),
              amounts: depCents > 0 && trust && body.depositPaid === true ? [{ label: r.plan?.fullPayment ? 'Paid in full' : 'Deposit paid', value: money$(depCents), strong: !!r.plan?.fullPayment }] : null,
              ...(r.shortCode && studioVisit ? { bigCode: String(r.shortCode).toUpperCase(), codeLabel: 'Your check-in code', codeNote: 'Show it when you arrive to check in.' } : {}),
              cta: { label: 'See or change your booking', url: portalUrl },
              links: [...(calendarUrl ? [{ label: 'Add to calendar', url: calendarUrl }] : []), { label: 'Running late', url: `${portalUrl}?do=late` }],
              smallPrint: [depCents > 0 && trust && body.depositPaid === true && !r.plan?.fullPayment ? 'Your deposit comes off your total on the day of your visit.' : '', studioVisit ? '' : arrivalLine(placeSvc)].filter(Boolean).join(' '),
              notes: policyLines.length ? { title: 'Good to know', lines: policyLines } : null,
            });
          const er = await sendNotification(db, {
            tenantId, channel: 'email', to: email,
            subject: isRequest
              ? `We have received your request: ${svcLabel} on ${whenStr}`
              : isHold
                ? `Please complete your booking for ${svcLabel}`
                : `Your appointment is confirmed: ${svcLabel} on ${whenStr}`,
            html, kind: isRequest ? 'booking_request' : isHold ? 'booking_hold' : 'booking_confirmation',
            appointmentId: r.aptId, clientId: r.clientId || null, clientName: r.clientName || null,
          });
          sendStatus.emailSent = !!er.ok;
        }

        // Text — short, matching the state. Routed through sendNotification
        // so it lands in messageLog with delivery tracking, same as email.
        if (!renterConfirmed && phone) {
          const sr = await sendNotification(db, {
            tenantId, channel: 'sms', to: phone,
            text: isRequest
              ? `Hi ${firstName}, thank you for your request for ${svcLabel} on ${whenStr}. Please note that it is not booked yet; we will be in touch shortly. ${portalUrl}`
              : isHold
                ? `Hi ${firstName}, we are holding ${whenStr} for your ${svcLabel}. To confirm your appointment, please complete your booking here: ${checkInUrl}`
                : `Hi ${firstName}, thank you for booking with us. Your ${svcLabel}${staffName ? ` with ${staffName}` : ''} on ${whenStr} is confirmed. For details and check-in: ${portalUrl}`,
            kind: isRequest ? 'booking_request' : isHold ? 'booking_hold' : 'booking_confirmation',
            appointmentId: r.aptId, clientId: r.clientId || null, clientName: r.clientName || null,
          });
          sendStatus.smsSent = !!sr.ok;
        }
        // The forms and documents still needed were asked for: the confirmation that went out opens straight to them.
        if (askedItems && askedItems.length && (sendStatus.emailSent || sendStatus.smsSent || renterConfirmed)) {
          await db.doc(`tenants/${tenantId}/appointments/${r.aptId}`).set({ lastRequirementsRequestedAt: new Date().toISOString(), requestedItems: askedItems }, { merge: true }).catch(() => {});
        }
        /* ═══ TELL THE STUDIO, NOW ═══════════════════════════════════════
         * A request sitting unseen until tomorrow's digest is the single
         * biggest weakness of approval mode: the client is holding their day
         * open while the shop does not know they exist. This fires
         * immediately, to the owner, and is the one kind in the catalog whose
         * recipient is staff. Best-effort — the booking already succeeded. */
        // ── OFFERS: a code that came with the booking, or one waiting in the
        // client's wallet — attached so it's applied automatically, however
        // they booked. Studio bookings use the studio's discounts (applied at
        // the POS); a renter's bookings use that renter's own offers
        // (applied when the renter taps Done).
        if (r.clientId) {
          try {
            const aRef = db.doc(`tenants/${tenantId}/appointments/${r.aptId}`);
            const ctx = { clientId: String(r.clientId), serviceIds: [String(serviceId || '')] };
            const renterId = renterSvc ? (String(renterProvider?.renterId || '') || null) : null;
            const findDiscount = async (code: string) => {
              const h = await db.collection(`tenants/${tenantId}/discounts`).where('code', '==', code).limit(1).get();
              return h.docs[0] ? { id: h.docs[0].id, ...(h.docs[0].data() as any) } : null;
            };
            const renterOffers = async () => renterId
              ? (await db.collection(`tenants/${tenantId}/renterOffers`).where('ownerRenterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
              : [];
            const stampRenter = async (o: any, walletId?: string | null) => aRef.set({ renterOfferId: o.id, renterOfferCode: o.code, renterOfferLine: offerLine(o), ...(walletId ? { clientOfferId: walletId } : {}) }, { merge: true });
            const typed = typeof body.promoCode === 'string' ? body.promoCode.trim().toUpperCase().slice(0, 40) : '';
            let attached = false;

            if (renterSvc) {
              if (pendingCode) await aRef.set({ pendingDiscountCode: null }, { merge: true });   // studio codes don't apply to a renter's visit
              if (typed) {
                const o = (await renterOffers()).find((x: any) => String(x.code || '').toUpperCase() === typed);
                if (o && !offerProblem(o, ctx)) { await stampRenter(o); attached = true; }
              }
            } else if (pendingCode) {
              const dz = await findDiscount(pendingCode);
              if (offerProblem(dz, ctx)) await aRef.set({ pendingDiscountCode: null }, { merge: true });   // e.g. already used by this client
              else { await aRef.set({ pendingDiscountCode: pendingCode }, { merge: true }); attached = true; }   // saved on the visit, so checkout applies it (was checked, then never stored)
            }

            if (!attached) {
              const w = await db.collection(`tenants/${tenantId}/clientOffers`).where('clientId', '==', String(r.clientId)).get();
              const waiting = w.docs.map((d: any) => ({ ref: d.ref, ...(d.data() as any) }))
                .filter((x: any) => walletStatus(x) === 'available')
                .sort((a: any, b: any) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
              const mine = renterSvc ? await renterOffers() : [];
              for (const x of waiting) {
                if (renterSvc) {
                  if (x.ownerRenterId !== renterId) continue;
                  if (x.renterOfferId) {
                    const o = mine.find((y: any) => y.id === x.renterOfferId);
                    if (o && !offerProblem(o, ctx)) { await stampRenter(o, x.id); break; }
                    continue;
                  }
                  // An older offer in the renter's own words.
                  await aRef.set({ renterOfferLine: x.line, clientOfferId: x.id }, { merge: true }); break;
                }
                if (x.ownerRenterId || !x.code) continue;
                const dz = await findDiscount(String(x.code));
                if (!offerProblem(dz, ctx)) { await aRef.set({ pendingDiscountCode: String(x.code), clientOfferId: x.id }, { merge: true }); break; }
              }
            }
          } catch { /* offers are a bonus; the booking stands */ }
        }

        // ── REFERRALS: a friend's link, "who recommended you?", or a number a client gifted (lib/referrals-server).
        // The friend's welcome offer is attached like any offer (unless one already is); the reward waits for a paid visit.
        if (r.clientId && !renterSvc && !isRequest) {
          try {
            const { matchOnBooking } = await import('@/lib/referrals-server');
            await matchOnBooking(db, tenantId, { clientId: String(r.clientId), appointmentId: String(r.aptId), slug: typeof body.referralCode === 'string' ? body.referralCode : null,
              named: body.referredBy && typeof body.referredBy === 'object' ? { firstName: String(body.referredBy.firstName || ''), phone: String(body.referredBy.phone || '') } : null,
              serviceIds: [String(serviceId || '')], code: typeof body.referralTypedCode === 'string' ? body.referralTypedCode.slice(0, 20) : null, cp: typeof body.referralCampaign === 'string' ? body.referralCampaign.slice(0, 90) : null });
          } catch (e) { console.error('[book] referral', e); }   // a bonus; the booking stands
        }

        // ── RECONNECT: did a nudge bring them back? ──────────────────────
        // A booking within 14 days of a nudge to the same client counts as a
        // conversion — the one number that says whether nudges are worth it.
        if (r.clientId) {
          try {
            const since = new Date(Date.now() - 14 * 86400000).toISOString();
            const ns = await db.collection(`tenants/${tenantId}/reconnectNudges`).where('clientId', '==', String(r.clientId)).get();
            const open = ns.docs.filter((d: any) => { const x = d.data() as any; return !x.converted && String(x.sentAt || '') >= since; });
            for (const d of open) await d.ref.set({ converted: true, convertedAt: new Date().toISOString(), convertedAppointmentId: r.aptId }, { merge: true });
            // Campaigns: same rule — booked within 14 days of receiving one.
            const cs = await db.collection(`tenants/${tenantId}/campaignSends`).where('clientId', '==', String(r.clientId)).get();
            for (const d of cs.docs) {
              const x = d.data() as any;
              if (x.converted || String(x.at || '') < since) continue;
              await d.ref.set({ converted: true, convertedAt: new Date().toISOString(), convertedAppointmentId: r.aptId }, { merge: true });
              await db.doc(`tenants/${tenantId}/campaigns/${x.campaignId}/recipients/${r.clientId}`).set({ converted: true, convertedAppointmentId: r.aptId }, { merge: true });
              // Count it, add the booking's value, and credit the subject line
              // (A or B) that brought them — the campaign's real results.
              const FV = (await import('firebase-admin/firestore')).FieldValue;
              const valueCents = Math.round((Number(svc?.price) || 0) * 100);
              await db.doc(`tenants/${tenantId}/campaigns/${x.campaignId}`).set({
                convertedCount: FV.increment(1), convertedRevenueCents: FV.increment(valueCents),
                ...(x.variant === 'A' ? { convertedA: FV.increment(1) } : x.variant === 'B' ? { convertedB: FV.increment(1) } : {}),
              }, { merge: true });
            }
          } catch { /* the tally is a bonus */ }
        }

        // A RENTER's booking or request goes to the RENTER — their phone, their
        // inbox, by their own preferences. It used to go to the studio owner,
        // who can't accept a renter's request anyway.
        if (renterSvc) {
          try {
            const providerDoc: any = roster.find((m: any) => m.id === renterSvc.staffId);
            if (providerDoc?.renterId) {
              const { notifyRenter, renterPortalUrl } = await import('@/lib/renter-comms');
              const portal = await renterPortalUrl(db, tenantId);
              if (isRequest) {
                await notifyRenter(db, tenantId, String(providerDoc.renterId), 'request', `Action needed: ${r.clientName || 'A client'} has requested ${svcLabel} on ${whenStr}. Please accept or decline the request in your portal.`, { tone: 'amber', subject: `Booking request: ${svcLabel}`, link: portal });
              } else {
                await notifyRenter(db, tenantId, String(providerDoc.renterId), 'new_booking', `New booking: ${r.clientName || 'A client'} has booked ${svcLabel} on ${whenStr}.${isHold ? ' Their deposit has not been received yet.' : ''}`, { tone: 'green', subject: `New booking: ${svcLabel}`, link: portal });
              }
            }
          } catch (e) { console.error('[book] renter alert', e); }
        }
        if (isRequest && !renterSvc) {
          try {
            const { resolveMessage, tidyBody, internalOrigin } = await import('@/lib/message-policy');
            const { brandedEmailHtml } = await import('@/lib/email-template');
            const ownerTo = String(tData.ownerEmail || tData.email || tData.businessEmail || '').trim();
            const ownerPhone = String(tData.ownerPhone || tData.phone || '').trim();
            const queueUrl = `${internalOrigin(tData, base)}/appointments/requests`;
            const staffTokens = {
              client_first: r.clientName || 'A client',
              service: svcLabel,
              when: whenStr,
              amount: `$${((r.plan?.depositCents || 0) / 100).toFixed(2)}`,
              link: queueUrl,
              studio: studioName,
            };
            const sMsg = resolveMessage(tData, 'staff_new_request', staffTokens, 'email');
            if (sMsg.send && ownerTo) {
              await sendNotification(db, {
                tenantId, channel: 'email', to: ownerTo,
                subject: sMsg.subject,
                html: brandedEmailHtml({
                  studioName,
                  title: sMsg.subject,
                  bodyLines: tidyBody(sMsg.body).split('\n\n'),
                  cta: { label: 'Open the queue', url: queueUrl },
                }),
                kind: 'staff_new_request',
                appointmentId: r.aptId, recipientType: 'staff', recipientName: 'Studio',
              });
            }
            const sSms = resolveMessage(tData, 'staff_new_request', staffTokens, 'sms');
            if (sSms.send && ownerPhone) {
              await sendNotification(db, {
                tenantId, channel: 'sms', to: ownerPhone,
                text: tidyBody(sSms.body),
                kind: 'staff_new_request',
                appointmentId: r.aptId, recipientType: 'staff', recipientName: 'Studio',
              });
            }
          } catch (e) {
            console.error('[appointments/book] staff request alert failed (booking is safe)', e);
          }
        }
      } catch (e) {
        console.error('[appointments/book] confirmation send failed (booking is safe)', e);
      }
    }

    // A new client, or a phone number never confirmed with a code: the confirmation screen offers "Confirm your number"
    // (lib/client-verify, through the visit link's /api/appt with checkInToken).
    let phoneUnconfirmed = false;
    try { const cl: any = r.clientId ? (await db.doc(`tenants/${tenantId}/clients/${r.clientId}`).get()).data() : null; phoneUnconfirmed = !!cl?.phone && !cl.phoneVerifiedAt && !cl.phoneReportedWrongAt && cl.smsOptOut !== true; } catch { /* the offer is optional */ }

    // Before the visit (lib/prep-check): when the service asks a few questions, the client can answer them now —
    // the same page the reminder links to, so holds, quotes and approvals work exactly the same.
    let prepUrl: string | null = null;
    try { const { checkOf } = await import('@/lib/prep-check'); if (checkOf(svc) && (tenant as any)?.prep?.on !== false) { const { prepPath } = await import('@/lib/prep-check-server'); prepUrl = prepPath(tenantId, String(r.aptId)); } } catch { prepUrl = null; }

    return NextResponse.json({
      ok: true, prepUrl,
      // What the visit link still asks for (forms left for later, photo ID…), so the confirmation can say so.
      stillNeeded: askedItems || [],
      ...(packageRedeemed !== null ? { packageRedeemed } : {}),
      phoneUnconfirmed,
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
      // A balance the client owes that's collected together with the deposit (the unpaid-fee rule).
      balanceCollectCents: Number((r as any).balanceCollectCents) || 0,
      chargeTiming: r.plan?.chargeTiming || 'never',
      requiresCardOnFile: !!r.plan?.requiresCardOnFile,
      clientNotice: r.plan?.clientNotice || '',
      ...(photosLeftOut ? { photosLeftOut } : {}),
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
