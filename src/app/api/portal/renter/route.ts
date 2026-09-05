// src/app/api/portal/renter/route.ts
//
// v81 — Guest portal auth + data for booth renters WITHOUT staff records
// (day/hourly renters). Staff-linked and hybrid renters keep using the
// staff portal; this route exists for the guest who booked a chair with
// just a name + phone/email and has nothing to log into.
//
// Identity = contact footprint. A guest proves control of the phone/email
// they booked with via a 6-digit code (10-min expiry, hashed at rest).
// Until an SMS/email provider is wired, the code is delivered as a
// notification to owners/admins — front desk relays it in person, same
// manager-mediated pattern as staff PIN resets. The delivery hook is a
// single function (deliverCode) so SMS can be swapped in later without
// touching the flow.
//
// Actions (POST { action, tenantId, ... }):
//   request-code → { contact } — finds the contact's footprint across
//                  renters + recent boothReservations. Always answers
//                  ok:true (no account enumeration); only stores/delivers
//                  a code when a footprint exists.
//   verify-code  → { contact, code } — 5 attempts max; returns a session
//                  token (24h, hashed at rest in private/renterSessions).
//   me           → { token, today? } — everything the guest may see:
//                  their reservations, credits, lease + invoices, and
//                  booth-rent payment history. Contact-scoped only.
//   check-in     → { token, reservationId, today? } — self check-in for a
//                  confirmed reservation on its booked date. Mirrors the
//                  owner-side checkInRes exactly (incl. the settleHourlyCents
//                  rate snapshot and the `checked_inAt` underscore field).
//   check-out    → { token, reservationId } — self check-out. Mirrors
//                  checkOutRes settlement math exactly: 10-min grace, then
//                  15-min increments of overage at the snapshotted rate;
//                  30+ min early with ≥$1 value records a PENDING credit
//                  for the owner to approve (never auto-issued).
//
// Rate limits (per tenant, sliding windows in tenants/{id}/private/renterAuth):
//   10 code requests / 15 min · 5 failed verifies / 15 min (423 when locked).

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createHash, randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { smsConfigured, sendTenantSms } from '@/lib/sms';

const WEEK_DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

// ── The leased window is the outer bound on bookable hours ───────────────────
// A part-time or shared lease holds the chair only on certain days (and
// sometimes only part of those days). A renter can set any hours they like,
// but clients can only ever book them inside what they actually lease —
// otherwise two people end up in one chair. Applied on BOTH read and write, so
// a later change to the lease can't leave stale hours behind.
function clampWeekToLease(week: any, lease: any): any {
  const slot = lease?.scheduleSlot;
  if (!slot || !Array.isArray(slot.days) || slot.days.length === 0) return week || {};
  const leasedDays = new Set(slot.days.map((d: any) => WEEK_DAYS[Number(d)] || ''));
  const out: any = {};
  for (const day of WEEK_DAYS) {
    const row = (week || {})[day];
    if (!row || !row.enabled) { out[day] = { enabled: false }; continue; }
    if (!leasedDays.has(day)) { out[day] = { enabled: false }; continue; }
    let start = String(row.start || '');
    let end = String(row.end || '');
    // A slot with times narrows the day; a slot without them takes it whole.
    if (slot.startTime && start < slot.startTime) start = slot.startTime;
    if (slot.endTime && end > slot.endTime) end = slot.endTime;
    out[day] = (start && end && start < end) ? { enabled: true, start, end } : { enabled: false };
  }
  return out;
}
import { dueAtFor, TICKET_STATUS_LABELS } from '@/lib/maintenance';
import { uploadTicketPhotoFromDataUrl, uploadPortalImageFromDataUrl, autoAssignTicket } from '@/lib/maintenance-server';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const WINDOW_MS = 15 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CODE_REQUESTS = 10;
const MAX_VERIFY_FAILS = 5;

// ── Contact normalization ─────────────────────────────────────────────────
// Stored contact fields are un-normalized (raw-trimmed at write time), so
// every comparison normalizes BOTH sides: emails trim+lowercase, phones
// digits-only. This matches the staff-portal reader behavior.
const isEmail = (v: string) => v.includes('@');
const normEmail = (v: any) => String(v || '').trim().toLowerCase();
const digits = (v: any) => String(v || '').replace(/\D/g, '');
const normContact = (v: string) => (isEmail(v) ? normEmail(v) : digits(v));
const contactMatches = (key: string, phone?: any, email?: any) =>
  !!key && (
    (isEmail(key) ? normEmail(email) === key : false) ||
    (!isEmail(key) ? (digits(phone) && digits(phone) === key) : false)
  );

const maskContact = (c: string) => {
  if (isEmail(c)) {
    const [u, d] = c.split('@');
    return `${u.slice(0, 1)}•••@${d}`;
  }
  const dg = digits(c);
  return dg.length >= 4 ? `•••-${dg.slice(-4)}` : '•••';
};

const localTodayFallback = () => new Date().toISOString().slice(0, 10);
const safeToday = (v: any) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : localTodayFallback();

// ── Rate limiting (private/renterAuth: { requestedAt:[], failedAt:[] }) ──
async function slidingWindow(db: any, tenantId: string, field: string, max: number): Promise<boolean> {
  const snap = await db.doc(`tenants/${tenantId}/private/renterAuth`).get();
  const stamps: number[] = (((snap.data() as any) || {})[field] || [])
    .filter((t: number) => Date.now() - t < WINDOW_MS);
  return stamps.length >= max;
}
async function recordStamp(db: any, tenantId: string, field: string, clear = false) {
  const ref = db.doc(`tenants/${tenantId}/private/renterAuth`);
  const snap = await ref.get();
  const prior: number[] = (((snap.data() as any) || {})[field] || [])
    .filter((t: number) => Date.now() - t < WINDOW_MS);
  await ref.set({ [field]: clear ? [] : [...prior, Date.now()].slice(-30) }, { merge: true });
}

// ── Code delivery — swap this for SMS/email when a provider is wired ─────
async function deliverCode(db: any, tenantId: string, contact: string, code: string, name?: string) {
  // SMS-FIRST: when Twilio is configured and the contact is a phone
  // number, the code goes straight to the renter — the owner is out of
  // the loop entirely. Anything else (email contact, SMS down, not yet
  // configured) falls back to the owner's inbox for manual relay.
  const isPhone = /^\+?[\d\s().-]{7,}$/.test(contact.trim());
  // Secondary method: know their email too? SMS failure falls through to
  // an emailed code before bothering the owner.
  let fallbackEmail: string | null = null;
  try {
    const rs = await db.collection(`tenants/${tenantId}/renters`).get();
    const norm = (s: any) => String(s || '').replace(/\D+/g, '');
    const r = rs.docs.map((d: any) => d.data() as any).find((x: any) => norm(x.phone) && norm(x.phone) === norm(contact));
    if (r?.email && /@/.test(r.email)) fallbackEmail = r.email;
  } catch { /* fallback is a bonus */ }
  if (isPhone && smsConfigured()) {
    const sent = await sendTenantSms(db, tenantId, contact,
      `Your renter portal sign-in code is ${code}. It expires in 10 minutes. Didn't request this? Ignore it.`,
      { email: fallbackEmail, subject: 'Your sign-in code' });
    if (sent.ok) {
      const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
      await ref.set({
        id: ref.id, userId: null, read: false, createdAt: new Date().toISOString(),
        type: 'renter_code', link: 'inbox',
        message: `${name || 'A renter'} signed in to the renter portal — code texted to them automatically.`,
      });
      return;
    }
  }
  // Contact IS an email (or SMS+email both failed) → email the code
  // directly before falling back to the owner inbox.
  const contactIsEmail = /@/.test(contact);
  if ((contactIsEmail || fallbackEmail) && process.env.RESEND_API_KEY) {
    try {
      let studioName = 'The studio';
      try { studioName = ((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.name || studioName; } catch { /* cosmetic */ }
      const { brandedEmailHtml } = await import('@/lib/email-template');
      // Through the logged sender, as a mandatory kind: a sign-in code the
      // owner cannot see in the delivery log is a support call waiting to
      // happen ("I never got my code" — did it bounce, or was it never sent?).
      const { sendNotification } = await import('@/lib/notify');
      const sent = await sendNotification(db, {
        tenantId, channel: 'email',
        to: (contactIsEmail ? contact.trim() : fallbackEmail) || '',
        subject: `Your sign-in code — ${studioName}`,
        text: `Your renter portal sign-in code is ${code}. It expires in 10 minutes. Didn't request this? Ignore it.`,
        html: brandedEmailHtml({
          studioName,
          title: 'Your sign-in code',
          bodyLines: ['Use this code to sign in to your renter portal. It expires in 10 minutes.'],
          bigCode: code,
          footerNote: `Didn't request this? You can safely ignore it. Sent by ${studioName}.`,
        }),
        kind: 'renter_signin_code',
        recipientType: 'renter', recipientName: name || null,
      });
      if (sent.ok) {
        const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        await nRef.set({
          id: nRef.id, userId: null, read: false, createdAt: new Date().toISOString(),
          type: 'renter_code', link: 'inbox',
          message: `${name || 'A renter'} signed in to the renter portal — code emailed to them automatically.`,
        });
        return;
      }
    } catch { /* fall through to the owner inbox */ }
  }
  const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
  await ref.set({
    id: ref.id,
    userId: null, // owners/admins inbox
    read: false,
    createdAt: new Date().toISOString(),
    type: 'renter_code',
    link: 'inbox',
    message: `${name || 'A renter'} is signing in to the renter portal and needs their code: ${code} (valid 10 min). ${isPhone ? `Text it to ${contact.trim()}.` : `Send it to ${contact.trim()}.`}`,
  });
}

// ── Contact footprint: does this phone/email belong to a renter here? ────
async function findFootprint(db: any, tenantId: string, key: string): Promise<{ found: boolean; name: string | null; renterId: string | null }> {
  // 1) renters directory (small collection — scan and normalize-compare)
  const renters = await db.collection(`tenants/${tenantId}/renters`).get();
  for (const d of renters.docs) {
    const r = d.data() as any;
    if (contactMatches(key, r.phone, r.email)) {
      const name = [r.firstName, r.lastName].filter(Boolean).join(' ') || null;
      return { found: true, name, renterId: d.id };
    }
  }
  // 2) recent reservations (last 180 days) — day/hourly guests live here
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const res = await db.collection(`tenants/${tenantId}/boothReservations`)
    .where('createdAt', '>=', cutoff).get();
  for (const d of res.docs) {
    const r = d.data() as any;
    if (contactMatches(key, r.phone, r.email)) {
      return { found: true, name: r.name || null, renterId: null };
    }
  }
  return { found: false, name: null, renterId: null };
}

// ── Session helpers (private/renterSessions: { [sha256(token)]: {...} }) ─
async function createSession(db: any, tenantId: string, key: string, name: string | null, renterId: string | null) {
  const token = randomBytes(24).toString('hex');
  const ref = db.doc(`tenants/${tenantId}/private/renterSessions`);
  const snap = await ref.get();
  const all = ((snap.data() as any) || {});
  // prune expired sessions while we're here
  const kept: any = {};
  for (const [k, v] of Object.entries<any>(all)) {
    if (v && v.expiresAt > Date.now()) kept[k] = v;
  }
  kept[sha256(token)] = {
    contactKey: key, name, renterId,
    expiresAt: Date.now() + SESSION_TTL_MS,
    createdAt: new Date().toISOString(),
  };
  await ref.set(kept); // whole-doc set = prune sticks
  return { token, expiresAt: kept[sha256(token)].expiresAt };
}
async function resolveSession(db: any, tenantId: string, token: any) {
  if (!token || typeof token !== 'string') return null;
  const snap = await db.doc(`tenants/${tenantId}/private/renterSessions`).get();
  const entry = (((snap.data() as any) || {})[sha256(token)]) || null;
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry as { contactKey: string; name: string | null; renterId: string | null };
}

// ── Reservation shaping (guest-safe subset) ───────────────────────────────
const safeReservation = (id: string, r: any) => ({
  id,
  boothId: r.boothId || null,
  boothName: r.boothName || 'Space',
  startDate: r.startDate, endDate: r.endDate,
  bookingType: r.bookingType || 'daily',
  startTime: r.startTime || null, endTime: r.endTime || null,
  slotLabel: r.slotLabel || null,
  status: r.status,
  amountCents: r.amountCents || 0,
  netDueCents: r.netDueCents ?? null,
  creditAppliedCents: r.creditAppliedCents || 0,
  balanceDueCents: r.balanceDueCents || 0,
  balanceMode: r.balanceMode || null,
  balancePaid: !!r.balancePaid,
  checked_inAt: r.checked_inAt || null,
  actualCheckIn: r.actualCheckIn || null,
  completedAt: r.completedAt || null,
  overageMinutes: r.overageMinutes || 0,
  overageDueCents: r.overageDueCents || 0,
  overageStatus: r.overageStatus || null,
  unusedMinutes: r.unusedMinutes || 0,
  potentialCreditCents: r.potentialCreditCents || 0,
  creditDecision: r.creditDecision || null,
  rescheduleRequestedAt: r.rescheduleRequestedAt || null,
});

const hourlyCentsOf = (booth: any): number => {
  const opts = Array.isArray(booth?.pricingOptions) ? booth.pricingOptions : [];
  return opts.find((o: any) => o.frequency === 'hourly' && o.amountCents > 0)?.amountCents || 0;
};



// ── Lease-window stamp ───────────────────────────────────────────────────────
// A money-free copy of what this renter's lease holds — days, times, station,
// turnover — written onto their STAFF doc, because the availability engine
// enforces the leased window at read time and the PUBLIC booking page reads
// staff but must never read leases (leases carry rent).
//
// Deliberately duplicated in /api/cron/nightly rather than imported: a route is
// an endpoint, not a module. The cron is the safety net for lease edits nobody
// is present for; these two call sites make a renter's own actions instant.
const DEFAULT_TURNOVER_MINUTES = 15;

function leaseWindowStamp(lease: any, boothBufferMinutes: any, tenant: any): any {
  if (!lease) return null;
  const slot = lease.scheduleSlot;
  const days = Array.isArray(slot?.days) && slot.days.length > 0
    ? slot.days.map((d: any) => Number(d)).filter((n: number) => n >= 0 && n <= 6)
    : null;
  const raw = boothBufferMinutes ?? tenant?.boothTurnoverMinutes ?? DEFAULT_TURNOVER_MINUTES;
  const turnoverMinutes = Math.max(0, Math.min(120, Number(raw) || 0));
  return {
    days,
    startTime: slot?.startTime || '',
    endTime: slot?.endTime || '',
    boothId: lease.boothId || null,
    turnoverMinutes,
  };
}

/** True when the stored stamp already says exactly this — skip a pointless write. */
function sameLeaseWindow(a: any, b: any): boolean {
  if (!a || !b) return (!a && !b);
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Refresh the stamp when it has drifted. Never fails the caller. */
async function syncLeaseWindow(db: any, tenantId: string, staffDoc: any, lease: any, tenant: any) {
  try {
    let bufferMinutes: any = undefined;
    if (lease?.boothId) {
      const b = await db.doc(`tenants/${tenantId}/booths/${lease.boothId}`).get();
      bufferMinutes = b.exists ? (b.data() as any)?.dayUseBufferMinutes : undefined;
    }
    const next = leaseWindowStamp(lease, bufferMinutes, tenant);
    if (sameLeaseWindow(staffDoc?.leaseWindow || null, next)) return;
    await db.doc(`tenants/${tenantId}/staff/${staffDoc.id}`).set({ leaseWindow: next }, { merge: true });
  } catch { /* the stamp is self-healing — the nightly sweep catches it */ }
}

// ═══ Renter day swaps ═══════════════════════════════════════════════════════
// Two renters trading a day between themselves. The owner is NOT in the
// approval path — she is told, not asked — because a swap trades TIME, never
// money. Rent does not move, invoices do not move, and a permanent change of
// days is a lease change, which IS her business. Keeping rent still is exactly
// what stops a swap quietly becoming a sublet.
//
// An accepted swap writes ONE thing: a date override on each staff record
// (availability.dates['yyyy-MM-dd']), which the availability engine reads as
// layer 3a. The giver's date turns off; the taker's turns on with the giver's
// window. Neither lease is touched, so every rent cron keeps working untouched.
//
// Everything is filtered BEFORE a request can be sent — you can only offer a
// day you actually hold and have no clients booked on, and you can only offer
// it to someone who is not already holding a chair that day. A request that
// could fail on accept is a request that should never have been sendable.

const SWAP_HORIZON_DAYS = 42;
const SWAP_DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SWAP_DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const swapDayIndex = (dateKey: string) => {
  const d = new Date(`${dateKey}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? -1 : d.getUTCDay();
};
const swapAddDays = (dateKey: string, n: number) => {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const swapDateLabel = (dateKey: string) => {
  const i = swapDayIndex(dateKey);
  const parts = String(dateKey).split('-');
  return `${SWAP_DAY_SHORT[i] || ''} ${Number(parts[1])}/${Number(parts[2])}`.trim();
};
const isDateKey = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const fmtHM = (t: any) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || ''));
  if (!m) return String(t || '');
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
/** 'HH:mm' ⇄ minutes past midnight. Wall-clock only — never an instant. */
const toMin = (t: any): number => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
};
const fromMin = (n: number): string =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

type SwapSeg = { start: string; end: string };
type SwapCtx = {
  renterId: string; staffId: string; name: string;
  email: string | null; phone: string | null; portalToken: string | null;
  week: any; dates: Record<string, any>;
  leaseDays: number[] | null; leaseStart: string; leaseEnd: string;
  leaseEndDate: string | null;
  boothId: string | null; boothName: string | null; turnoverMinutes: number;
  /** dateKey → the wall-clock spans their own clients already occupy. */
  appts: Record<string, Array<{ s: number; e: number }>>;
  busyDates: Set<string>;
  shortestServiceMinutes: number;
};

/**
 * The window this person actually holds on that date.
 * An accepted swap (date override) wins; otherwise their weekly template,
 * narrowed to the times their lease holds — the same read-time clamp the
 * booking engine applies, so the two can never disagree about the chair.
 */
function swapHeld(ctx: SwapCtx, dateKey: string): SwapSeg | null {
  const ov = ctx.dates?.[dateKey];
  if (ov) {
    if (ov.enabled !== true) return null;
    return ov.start && ov.end ? { start: String(ov.start), end: String(ov.end) } : null;
  }
  const idx = swapDayIndex(dateKey);
  if (idx < 0) return null;
  if (ctx.leaseDays && !ctx.leaseDays.includes(idx)) return null;
  const row = ctx.week?.[SWAP_DAY_NAMES[idx]];
  if (!row || !row.enabled || !row.start || !row.end) return null;
  let start = String(row.start); let end = String(row.end);
  if (ctx.leaseStart && start < ctx.leaseStart) start = ctx.leaseStart;
  if (ctx.leaseEnd && end > ctx.leaseEnd) end = ctx.leaseEnd;
  return start < end ? { start, end } : null;
}

const swapApptsOn = (ctx: SwapCtx, dateKey: string) => ctx.appts?.[dateKey] || [];
const segOverlaps = (a: { s: number; e: number }, b: { s: number; e: number }) => a.s < b.e && b.s < a.e;

/**
 * The slices of a day someone may offer.
 *
 * DELIBERATE CONSTRAINT: a partial swap takes the START or the END of a day,
 * never a hole out of the middle. Two reasons, and they point the same way.
 * Practically, "I need to leave early" and "I'm coming in late" are what people
 * actually swap for, while a mid-day hole means two handoffs in one chair.
 * Structurally, the remainder has to stay ONE window — a date override carries
 * a single {start,end}, so a hole would need a second blocking primitive, and
 * the obvious candidate (staffBlocks) stores true UTC instants while swap
 * windows are wall-clock. Keeping slices at the edges keeps the whole feature
 * inside the override layer with no timezone conversion anywhere near it.
 */
function swapOfferableSegments(ctx: SwapCtx, dateKey: string): { held: SwapSeg | null; leading: SwapSeg | null; trailing: SwapSeg | null } {
  const held = swapHeld(ctx, dateKey);
  if (!held) return { held: null, leading: null, trailing: null };
  const hs = toMin(held.start); const he = toMin(held.end);
  const mine = swapApptsOn(ctx, dateKey).filter((a) => segOverlaps(a, { s: hs, e: he }))
    .sort((a, b) => a.s - b.s);
  if (mine.length === 0) return { held, leading: { ...held }, trailing: { ...held } };
  const firstStart = mine[0].s;
  const lastEnd = mine[mine.length - 1].e;
  return {
    held,
    leading: firstStart > hs ? { start: held.start, end: fromMin(Math.min(firstStart, he)) } : null,
    trailing: lastEnd < he ? { start: fromMin(Math.max(lastEnd, hs)), end: held.end } : null,
  };
}

/** Empty string = they may offer exactly this window. Otherwise the honest reason. */
function swapGiveBlock(ctx: SwapCtx, dateKey: string, today: string, win: SwapSeg): string {
  if (dateKey <= today) return 'Today or past';
  if (ctx.leaseEndDate && dateKey > ctx.leaseEndDate) return 'After your lease ends';
  if (ctx.busyDates.has(dateKey)) return 'Already in a swap';
  const held = swapHeld(ctx, dateKey);
  if (!held) return 'Not one of your days';
  const ws = toMin(win.start); const we = toMin(win.end);
  const hs = toMin(held.start); const he = toMin(held.end);
  if (ws < 0 || we < 0 || ws >= we) return 'That is not a real window';
  if (ws < hs || we > he) return 'Outside the hours you hold';
  // Edge slice only — the remainder must stay one window.
  if (ws !== hs && we !== he) return 'Give away the start or the end of a day, not the middle';
  if (swapApptsOn(ctx, dateKey).some((a) => segOverlaps(a, { s: ws, e: we }))) {
    return 'You have clients booked in that window';
  }
  return '';
}

/**
 * Can this person take that window? Three answers, not two.
 *   ''          → clean
 *   'conflict:N' → they have N of their OWN clients booked inside it. Askable,
 *                  never auto-acceptable: the person who would have to move is
 *                  a client who is not in this conversation.
 *   anything else → a hard no.
 */
function swapTakeBlock(ctx: SwapCtx, dateKey: string, today: string, win: SwapSeg): string {
  if (dateKey <= today) return 'Today or past';
  if (ctx.leaseEndDate && dateKey > ctx.leaseEndDate) return 'After their lease ends';
  if (ctx.busyDates.has(dateKey)) return 'Already in a swap that day';
  const ws = toMin(win.start); const we = toMin(win.end);
  if (ws < 0 || we < 0 || ws >= we) return 'That is not a real window';
  if (we - ws < ctx.shortestServiceMinutes) return 'Too short for anything they offer';
  const held = swapHeld(ctx, dateKey);
  if (held) {
    const hs = toMin(held.start); const he = toMin(held.end);
    if (segOverlaps({ s: hs, e: he }, { s: ws, e: we })) return 'They are already working then';
    // Taking a window on a day they already work is only safe when it sits
    // flush against what they hold — otherwise THEIR day grows a hole, which
    // is the same shape this design refuses to create for the giver.
    const gap = ws >= he ? ws - he : hs - we;
    if (gap > Math.max(ctx.turnoverMinutes, 0)) return 'It would leave a gap in their day';
  }
  const clash = swapApptsOn(ctx, dateKey).filter((a) => segOverlaps(a, { s: ws, e: we })).length;
  if (clash > 0) return `conflict:${clash}`;
  return '';
}

/** What the taker's date override becomes: the window, or its union with what they already hold. */
function swapTakerSpan(ctx: SwapCtx, dateKey: string, win: SwapSeg): SwapSeg {
  const held = swapHeld(ctx, dateKey);
  if (!held) return { ...win };
  const s = Math.min(toMin(held.start), toMin(win.start));
  const e = Math.max(toMin(held.end), toMin(win.end));
  return { start: fromMin(s), end: fromMin(e) };
}

/** What the giver keeps: the remainder of their day, or nothing. */
function swapGiverRemainder(ctx: SwapCtx, dateKey: string, win: SwapSeg): SwapSeg | null {
  const held = swapHeld(ctx, dateKey);
  if (!held) return null;
  const hs = toMin(held.start); const he = toMin(held.end);
  const ws = toMin(win.start); const we = toMin(win.end);
  if (ws <= hs && we >= he) return null;
  if (ws === hs) return { start: win.end, end: held.end };
  return { start: held.start, end: win.start };
}

/**
 * Everyone who can take part in a swap, with everything needed to decide.
 * One pass over staff/renters/leases/appointments/services/swaps — the
 * alternative was a query per person per date, which does not survive a busy
 * studio. Appointment spans are kept as wall-clock minutes and NEVER returned
 * to another renter: they decide eligibility server-side and stop there.
 */
async function loadSwapProviders(db: any, tenantId: string, today: string): Promise<SwapCtx[]> {
  const horizonEnd = swapAddDays(today, SWAP_HORIZON_DAYS);
  const [staffSnap, renterSnap, leaseSnap, svcSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/staff`).get(),
    db.collection(`tenants/${tenantId}/renters`).get(),
    db.collection(`tenants/${tenantId}/leases`).get(),
    db.collection(`tenants/${tenantId}/renterServices`).get(),
  ]);

  const renterById = new Map<string, any>();
  renterSnap.docs.forEach((d: any) => renterById.set(d.id, { id: d.id, ...(d.data() as any) }));

  const leaseByRenter = new Map<string, any>();
  const boothIds = new Set<string>();
  leaseSnap.docs.forEach((d: any) => {
    const l: any = { id: d.id, ...(d.data() as any) };
    if (!['active', 'on_leave'].includes(String(l.status))) return;
    if (l.renterId && !leaseByRenter.has(l.renterId)) {
      leaseByRenter.set(l.renterId, l);
      if (l.boothId) boothIds.add(String(l.boothId));
    }
  });
  const boothInfo = new Map<string, any>();
  await Promise.all(Array.from(boothIds).map(async (bid) => {
    try {
      const b = await db.doc(`tenants/${tenantId}/booths/${bid}`).get();
      if (b.exists) boothInfo.set(bid, b.data() as any);
    } catch { /* booth detail is cosmetic */ }
  }));

  // Shortest sellable service per provider — a window nobody can fill is noise.
  const shortestByStaff = new Map<string, number>();
  svcSnap.docs.forEach((d: any) => {
    const sv: any = d.data() || {};
    if (!sv.staffId || sv.isActive === false) return;
    const dur = Math.max(5, Number(sv.duration) || 60);
    const cur = shortestByStaff.get(sv.staffId);
    if (cur === undefined || dur < cur) shortestByStaff.set(sv.staffId, dur);
  });

  // Booked client spans, one range query instead of one per person.
  const apptByStaff = new Map<string, Record<string, Array<{ s: number; e: number }>>>();
  const ap = await db.collection(`tenants/${tenantId}/appointments`)
    .where('startTime', '>=', `${today}T00:00:00`)
    .where('startTime', '<=', `${horizonEnd}T23:59:59`).get();
  ap.docs.forEach((d: any) => {
    const x: any = d.data() || {};
    if (!x.staffId || x.status === 'cancelled') return;
    const iso = String(x.startTime || '');
    const key = iso.slice(0, 10);
    if (!isDateKey(key)) return;
    const s = toMin(iso.slice(11, 16));
    if (s < 0) return;
    let e = toMin(String(x.endTime || '').slice(11, 16));
    if (e < 0 || e <= s) e = s + Math.max(5, Number(x.duration) || 60);
    if (!apptByStaff.has(x.staffId)) apptByStaff.set(x.staffId, {});
    const byDate = apptByStaff.get(x.staffId) as Record<string, Array<{ s: number; e: number }>>;
    (byDate[key] = byDate[key] || []).push({ s, e });
  });

  // Dates already spoken for by a live swap — one trade per person per date.
  const busyByRenter = new Map<string, Set<string>>();
  try {
    const sw = await db.collection(`tenants/${tenantId}/renterSwaps`).get();
    sw.docs.forEach((d: any) => {
      const x: any = d.data() || {};
      if (!['pending', 'accepted'].includes(String(x.status))) return;
      for (const [rid, dk] of [
        [x.fromRenterId, x.giveDate], [x.toRenterId, x.giveDate],
        [x.fromRenterId, x.returnDate], [x.toRenterId, x.returnDate],
      ] as any[]) {
        if (!rid || !isDateKey(dk) || dk < today) continue;
        if (!busyByRenter.has(rid)) busyByRenter.set(rid, new Set());
        (busyByRenter.get(rid) as Set<string>).add(dk);
      }
    });
  } catch { /* no swaps yet */ }

  const out: SwapCtx[] = [];
  staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((m: any) => m.isRenter && m.isActive !== false && m.renterId)
    .forEach((m: any) => {
      const r = renterById.get(m.renterId);
      if (!r) return;
      // Someone running their own booking system has no chair here to trade.
      if (r.bookingMode === 'own') return;
      const lease = leaseByRenter.get(m.renterId) || null;
      const days = lease?.scheduleSlot?.days;
      const booth = lease?.boothId ? boothInfo.get(String(lease.boothId)) : null;
      const rawTurn = booth?.dayUseBufferMinutes;
      out.push({
        renterId: m.renterId,
        staffId: m.id,
        name: `${r.firstName || ''} ${r.lastName || ''}`.trim() || m.name || 'Renter',
        email: r.email || null,
        phone: r.phone || null,
        portalToken: r.portalToken || null,
        week: (m.availability?.week && typeof m.availability.week === 'object') ? m.availability.week : {},
        dates: (m.availability?.dates && typeof m.availability.dates === 'object') ? m.availability.dates : {},
        leaseDays: Array.isArray(days) && days.length > 0
          ? days.map((x: any) => Number(x)).filter((n: number) => n >= 0 && n <= 6) : null,
        leaseStart: lease?.scheduleSlot?.startTime || '',
        leaseEnd: lease?.scheduleSlot?.endTime || '',
        leaseEndDate: isDateKey(lease?.endDate) ? String(lease.endDate).slice(0, 10) : null,
        boothId: lease?.boothId || null,
        boothName: booth?.name || null,
        turnoverMinutes: Math.max(0, Math.min(120, Number(rawTurn ?? 15) || 0)),
        appts: apptByStaff.get(m.id) || {},
        busyDates: busyByRenter.get(m.renterId) || new Set<string>(),
        shortestServiceMinutes: shortestByStaff.get(m.id) ?? 30,
      });
    });
  return out;
}

/**
 * Email AND text, to the person who has to act or wants to know. Both are
 * toggleable per business; both fail silently, because a swap that is already
 * written must never be undone by a mail outage.
 */
async function swapNotify(
  db: any, tenantId: string, tenant: any,
  target: { name: string; email: string | null; phone: string | null; portalToken: string | null },
  subject: string, headline: string, lines: string[], smsText: string,
  // A conflicted "ask anyway" is not urgent. Texting for it trains people to
  // mute swap notifications, which costs the ones that DO need answering.
  emailOnly = false,
) {
  const comms = (tenant?.rentComms || {}) as any;
  const studioName = tenant?.name || 'The studio';
  const origin = String(tenant?.publicOrigin
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');
  const portalUrl = origin
    ? `${origin}/rent/${tenantId}${target.portalToken ? `?rt=${encodeURIComponent(target.portalToken)}` : ''}`
    : '';

  if (comms.swapNotifyEmail !== false && target.email && /@/.test(target.email)) {
    try {
      const { brandedEmailHtml } = await import('@/lib/email-template');
      const { sendNotification } = await import('@/lib/notify');
      await sendNotification(db, {
        tenantId, channel: 'email', to: target.email,
        subject,
        text: `${headline}\n\n${lines.join('\n')}${portalUrl ? `\n\n${portalUrl}` : ''}`,
        html: brandedEmailHtml({
          studioName,
          title: headline,
          bodyLines: lines,
          ...(portalUrl ? { cta: { label: 'Open my portal', url: portalUrl } } : {}),
          footerNote: `Day swaps are between you and the other professional — rent is not affected. Sent by ${studioName}.`,
        }),
        kind: 'renter_day_swap',
        recipientType: 'renter', recipientName: target.name || null,
      });
    } catch { /* the swap stands whether or not the email lands */ }
  }

  if (!emailOnly && comms.swapNotifySms !== false && target.phone && smsConfigured()) {
    try {
      await sendTenantSms(db, tenantId, target.phone, smsText, { email: target.email, subject });
    } catch { /* same */ }
  }
}

/** The owner is told, never asked. She needs to know who is in the building. */
async function swapTellOwner(db: any, tenantId: string, message: string) {
  try {
    const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
    await ref.set({
      id: ref.id, userId: null, read: false, createdAt: new Date().toISOString(),
      type: 'renter_swap', link: 'booths', message,
    });
  } catch { /* visibility is a bonus, never a blocker */ }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId } = body || {};
    if (!action || !tenantId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();

    // ═══ request-code ═════════════════════════════════════════════════════
    if (action === 'request-code') {
      const raw = String(body.contact || '').trim().slice(0, 160);
      const key = normContact(raw);
      if (!key || (!isEmail(raw) && key.length < 7)) {
        return NextResponse.json({ ok: false, error: 'Enter the phone number or email you booked with.' }, { status: 400 });
      }
      if (await slidingWindow(db, tenantId, 'requestedAt', MAX_CODE_REQUESTS)) {
        return NextResponse.json({ ok: false, error: 'Too many code requests — try again in a few minutes.' }, { status: 429 });
      }
      await recordStamp(db, tenantId, 'requestedAt');

      const fp = await findFootprint(db, tenantId, key);
      if (fp.found) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await db.doc(`tenants/${tenantId}/private/renterCodes`).set({
          [key]: { codeHash: sha256(code), expiresAt: Date.now() + CODE_TTL_MS, attempts: 0, createdAt: new Date().toISOString(), name: fp.name, renterId: fp.renterId },
        }, { merge: true });
        await deliverCode(db, tenantId, raw, code, fp.name || undefined);
        await logAuditAdmin(db, tenantId, {
          action: 'portal.renter_code_requested',
          targetType: 'renterContact', targetId: maskContact(raw),
          summary: `Renter portal access code requested for ${fp.name || maskContact(raw)}`,
          actor: { type: 'system', name: 'renter-portal' },
        });
      }
      // Same answer either way — no account enumeration.
      return NextResponse.json({ ok: true, delivery: 'studio' });
    }

    // ═══ verify-code ══════════════════════════════════════════════════════
    if (action === 'verify-code') {
      const raw = String(body.contact || '').trim().slice(0, 160);
      const key = normContact(raw);
      const code = String(body.code || '').trim();
      if (!key || !/^\d{6}$/.test(code)) {
        return NextResponse.json({ ok: false, error: 'Enter the 6-digit code.' }, { status: 400 });
      }
      if (await slidingWindow(db, tenantId, 'failedAt', MAX_VERIFY_FAILS)) {
        return NextResponse.json({ ok: false, error: 'Too many attempts — try again in 15 minutes.' }, { status: 423 });
      }
      const codesRef = db.doc(`tenants/${tenantId}/private/renterCodes`);
      const entry = ((((await codesRef.get()).data() as any) || {})[key]) || null;
      if (!entry || Date.now() > entry.expiresAt || entry.attempts >= 5 || entry.codeHash !== sha256(code)) {
        if (entry) await codesRef.set({ [key]: { ...entry, attempts: (entry.attempts || 0) + 1 } }, { merge: true });
        await recordStamp(db, tenantId, 'failedAt');
        return NextResponse.json({ ok: false, error: 'That code isn’t valid — check it or request a new one.' }, { status: 401 });
      }
      await codesRef.set({ [key]: null }, { merge: true }); // single-use
      await recordStamp(db, tenantId, 'failedAt', true);
      const session = await createSession(db, tenantId, key, entry.name || null, entry.renterId || null);
      if (entry.renterId) {
        await db.doc(`tenants/${tenantId}/renters/${entry.renterId}`)
          .set({ portalInviteStatus: 'accepted', portalFirstSeenAt: new Date().toISOString() }, { merge: true })
          .catch(() => {});
      }
      await logAuditAdmin(db, tenantId, {
        action: 'portal.renter_login',
        targetType: 'renterContact', targetId: maskContact(raw),
        summary: `${entry.name || maskContact(raw)} signed in to the renter portal`,
        actor: { type: 'user', name: entry.name || null, role: 'renter', via: 'renter-portal' },
      });
      return NextResponse.json({ ok: true, token: session.token, expiresAt: session.expiresAt, name: entry.name || null });
    }

    // ═══ token-login — the renter's MAGIC LINK ════════════════════════════
    // The owner shares /rent/{tenantId}?rt=TOKEN from the renter's profile;
    // opening it signs the renter straight in — no code, no SMS required.
    // This is what makes the portal usable BEFORE Twilio is set up (and
    // easier after). The token lives on the renter doc; the owner clears or
    // regenerates it to revoke. Same rate-limit pool as code attempts, so
    // token guessing burns the same budget as code guessing.
    if (action === 'token-login') {
      const tok = String(body.magicToken || '').trim();
      if (!tok || tok.length < 12) {
        return NextResponse.json({ ok: false, error: 'This link is incomplete — ask the studio to resend it.' }, { status: 400 });
      }
      if (await slidingWindow(db, tenantId, 'failedAt', MAX_VERIFY_FAILS)) {
        return NextResponse.json({ ok: false, error: 'Too many attempts — try again in 15 minutes.' }, { status: 423 });
      }
      const rs = await db.collection(`tenants/${tenantId}/renters`).where('portalToken', '==', tok).limit(1).get();
      if (rs.empty) {
        await recordStamp(db, tenantId, 'failedAt');
        return NextResponse.json({ ok: false, error: 'This link is no longer valid — ask the studio for a fresh one.' }, { status: 401 });
      }
      const r = { id: rs.docs[0].id, ...(rs.docs[0].data() as any) };
      const key = normContact(String(r.phone || r.email || ''));
      if (!key) {
        return NextResponse.json({ ok: false, error: 'No phone or email on your renter record — the studio needs to add one.' }, { status: 400 });
      }
      await recordStamp(db, tenantId, 'failedAt', true);
      const session = await createSession(db, tenantId, key, r.name || null, r.id);
      if (r.portalInviteStatus !== 'accepted') {
        await db.doc(`tenants/${tenantId}/renters/${r.id}`)
          .set({ portalInviteStatus: 'accepted', portalFirstSeenAt: new Date().toISOString() }, { merge: true })
          .catch(() => {});
      }
      await logAuditAdmin(db, tenantId, {
        action: 'portal.renter_login',
        targetType: 'renter', targetId: r.id,
        summary: `${r.name || 'A renter'} signed in to the renter portal via their personal link`,
        actor: { type: 'user', name: r.name || null, role: 'renter', via: 'renter-portal-magic-link' },
      });
      return NextResponse.json({ ok: true, token: session.token, expiresAt: session.expiresAt, name: r.name || null });
    }

    // ═══ Everything below requires a session ══════════════════════════════
    const session = await resolveSession(db, tenantId, body.token);
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Session expired — sign in again.' }, { status: 401 });
    }
    const key = session.contactKey;

    // ═══ MAINTENANCE TICKETS — renters report and follow issues ═══════════
    // The renter portal is a first-class entry to the same ticket queue the
    // owner and techs work. No phone tag: they file it, they watch it move.
    if (action === 'create-ticket') {
      const title = String(body.title || '').trim().slice(0, 140);
      const description = String(body.description || '').trim().slice(0, 2000);
      const category = ['equipment', 'plumbing', 'electrical', 'cleaning', 'safety', 'other'].includes(body.category) ? body.category : 'other';
      // Renters can flag urgency, but 'urgent' (4h SLA + station lockout) is
      // an owner/tech call — renter submissions cap at 'high'.
      const priority = ['high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal';
      if (!title) return NextResponse.json({ ok: false, error: 'Give the issue a short title.' }, { status: 400 });
      // Attach their station automatically when they have one.
      let boothId: string | null = null; let boothName: string | null = null;
      if (session.renterId) {
        try {
          const ls = await db.collection(`tenants/${tenantId}/leases`).where('renterId', '==', session.renterId).get();
          const l = ls.docs.map((d: any) => d.data() as any).find((x: any) => ['active', 'on_leave'].includes(x.status));
          if (l?.boothId) {
            boothId = l.boothId;
            const b = await db.doc(`tenants/${tenantId}/booths/${l.boothId}`).get();
            boothName = b.exists ? ((b.data() as any).name || null) : null;
          }
        } catch { /* station attach is a bonus */ }
      }
      const nowIso = new Date().toISOString();
      const ref = db.collection(`tenants/${tenantId}/tickets`).doc();
      // Optional photo — "here's what it looks like" beats any description.
      let photoUrl: string | null = null;
      let photoError: string | undefined;
      if (typeof body.photoData === 'string' && body.photoData.startsWith('data:image')) {
        const up = await uploadTicketPhotoFromDataUrl(tenantId, ref.id, body.photoData);
        photoUrl = up.url; photoError = up.error;
      }
      await ref.set({
        id: ref.id, tenantId, locationId: null,
        title, description, category, priority, status: 'open',
        boothId, boothName,
        photoUrls: photoUrl ? [photoUrl] : [],
        reporter: { type: 'renter', name: session.name || 'Renter', phone: /\d{7,}/.test(key) ? key : '', renterId: session.renterId || null },
        assigneeId: null, assigneeName: null,
        updates: [{ at: nowIso, by: session.name || 'Renter', byType: 'renter', note: 'Ticket created', status: 'open', ...(photoUrl ? { photoUrl } : {}) }],
        createdAt: nowIso, updatedAt: nowIso, dueAt: dueAtFor(priority), resolvedAt: null,
      });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'maintenance', read: false, createdAt: nowIso, link: '/maintenance',
        message: `Maintenance request from ${session.name || 'a renter'}: "${title}"${boothName ? ` (${boothName})` : ''} — ${priority} priority${photoUrl ? ' · photo attached' : ''}.` });
      // Rotation: with auto-assign on, the ticket already has a worker (and
      // they already have a text) before the owner even sees the notification.
      const assigned = await autoAssignTicket(db, tenantId, ref.id, { title, boothName, priority }, req.headers.get('origin') || undefined);
      return NextResponse.json({ ok: true, ticketId: ref.id, photoError, assignedTo: assigned?.assigneeName || null });
    }

    // ═══ upload-credential — paperwork renews ITSELF ══════════════════════
    // The expiry text says "upload the renewed one in your portal"; this is
    // where that lands. Photo goes up with admin credentials, the renter
    // record updates, the expiry-nag stamp clears, and the owner gets a
    // "Maya uploaded her renewed license" notification instead of a chore.
    if (action === 'upload-credential') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'Your account isn\'t linked to a renter record — ask the studio to update it.' }, { status: 403 });
      const kind = body.kind === 'insurance' ? 'insurance' : 'license';
      if (typeof body.photoData !== 'string' || !body.photoData.startsWith('data:image')) {
        return NextResponse.json({ ok: false, error: 'Attach a photo of the document.' }, { status: 400 });
      }
      const up = await uploadTicketPhotoFromDataUrl(tenantId, `credential-${session.renterId}`, body.photoData);
      if (!up.url) return NextResponse.json({ ok: false, error: up.error || 'Upload failed — try again.' }, { status: 500 });
      const expiry = /^\d{4}-\d{2}-\d{2}$/.test(String(body.expiry || '')) ? String(body.expiry) : null;
      const patch: any = kind === 'license'
        ? { licenseDocUrl: up.url, ...(expiry ? { licenseExpiry: expiry } : {}), credNotified_licenseExpiry: null }
        : { insuranceDocUrl: up.url, ...(expiry ? { insuranceExpiry: expiry } : {}), credNotified_insuranceExpiry: null };
      await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).set(patch, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({
        id: nRef.id, type: 'credential', read: false, createdAt: new Date().toISOString(), link: '/renters',
        message: `${session.name || 'A renter'} uploaded a renewed ${kind}${expiry ? ` (expires ${expiry})` : ''} — it's on their profile.`,
      });
      await logAuditAdmin(db, tenantId, {
        action: 'renter.credential_uploaded', targetType: 'renter', targetId: session.renterId,
        summary: `${session.name || 'Renter'} self-uploaded renewed ${kind}${expiry ? ` (exp ${expiry})` : ''}`,
        actor: { type: 'user', name: session.name || 'Renter', role: 'renter', via: 'renter-portal' },
      });
      return NextResponse.json({ ok: true, url: up.url });
    }

    if (action === 'my-tickets') {
      const snap = await db.collection(`tenants/${tenantId}/tickets`).get();
      const mine = snap.docs
        .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        .filter((t: any) => (session.renterId && t.reporter?.renterId === session.renterId)
          || (t.reporter?.phone && t.reporter.phone === key))
        .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 25)
        .map((t: any) => ({
          id: t.id, title: t.title, description: t.description,
          category: t.category, priority: t.priority,
          status: t.status, statusLabel: TICKET_STATUS_LABELS[t.status as keyof typeof TICKET_STATUS_LABELS] || t.status,
          boothName: t.boothName || null, createdAt: t.createdAt, resolvedAt: t.resolvedAt || null,
          assigneeName: t.assigneeName || null,
          photoUrls: Array.isArray(t.photoUrls) ? t.photoUrls : [],
          updates: (t.updates || []).map((u: any) => ({ at: u.at, by: u.by, byType: u.byType, note: u.note || null, status: u.status || null, photoUrl: u.photoUrl || null })),
        }));
      return NextResponse.json({ ok: true, tickets: mine });
    }

    if (action === 'ticket-note') {
      const { ticketId } = body;
      const note = String(body.note || '').trim().slice(0, 1000);
      const hasPhoto = typeof body.photoData === 'string' && body.photoData.startsWith('data:image');
      if (!ticketId || (!note && !hasPhoto)) return NextResponse.json({ ok: false, error: 'Write a note or attach a photo first.' }, { status: 400 });
      const ref = db.doc(`tenants/${tenantId}/tickets/${ticketId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
      const t = snap.data() as any;
      const owns = (session.renterId && t.reporter?.renterId === session.renterId) || (t.reporter?.phone && t.reporter.phone === key);
      if (!owns) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
      const nowIso = new Date().toISOString();
      let photoUrl: string | null = null;
      if (hasPhoto) photoUrl = (await uploadTicketPhotoFromDataUrl(tenantId, ticketId, body.photoData)).url;
      await ref.set({
        updates: [...(t.updates || []), { at: nowIso, by: session.name || 'Renter', byType: 'renter', ...(note ? { note } : {}), ...(photoUrl ? { photoUrl } : {}) }],
        ...(photoUrl ? { photoUrls: [...(Array.isArray(t.photoUrls) ? t.photoUrls : []), photoUrl] } : {}),
        updatedAt: nowIso,
      }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'maintenance', read: false, createdAt: nowIso, link: '/maintenance',
        message: `${session.name || 'Renter'} added to ticket "${t.title}"${note ? `: "${note.slice(0, 120)}"` : ' — photo attached.'}` });
      return NextResponse.json({ ok: true, photoUrl });
    }

    // ═══ me ═══════════════════════════════════════════════════════════════
    if (action === 'me') {
      const today = safeToday(body.today);
      const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
      const tenant = (tenantSnap.data() as any) || {};

      // Renter directory entry (may not exist for pure day guests)
      let renter: any = null;
      if (session.renterId) {
        const rd = await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).get();
        if (rd.exists) renter = { id: rd.id, ...(rd.data() as any) };
      }
      if (!renter) {
        const renters = await db.collection(`tenants/${tenantId}/renters`).get();
        const hit = renters.docs.find((d: any) => { const r = d.data(); return contactMatches(key, r.phone, r.email); });
        if (hit) renter = { id: hit.id, ...(hit.data() as any) };
      }

      // Lease + invoices (leased renters only)
      let lease: any = null; let invoices: any[] = []; let leaseBoothName: string | null = null;
      if (renter) {
        const leases = await db.collection(`tenants/${tenantId}/leases`)
          .where('renterId', '==', renter.id).get();
        const activeish = leases.docs
          .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
          .filter((l: any) => ['active', 'on_leave', 'pending_signature'].includes(l.status));
        lease = activeish[0] || null;
        if (lease) {
          if (lease.boothId) {
            const b = await db.doc(`tenants/${tenantId}/booths/${lease.boothId}`).get();
            leaseBoothName = b.exists ? ((b.data() as any).name || null) : null;
          }
          const inv = await db.collection(`tenants/${tenantId}/rentInvoices`)
            .where('leaseId', '==', lease.id).get();
          invoices = inv.docs
            .map((d: any) => { const v = d.data() as any; return {
              id: d.id, amountCents: v.amountCents || 0, lateFeeCents: v.lateFeeCents || 0,
              dueDate: String(v.dueDate || '').slice(0, 10), status: v.status || 'due',
            }; })
            .sort((a: any, b: any) => (b.dueDate || '').localeCompare(a.dueDate || ''));
        }
      }

      // Credits — contactKey is stored un-normalized, so normalize both sides
      const creditsSnap = await db.collection(`tenants/${tenantId}/boothCredits`).get();
      const credits = creditsSnap.docs
        .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        .filter((c: any) => normContact(String(c.contactKey || '')) === key
          || contactMatches(key, c.phone, c.email))
        .map((c: any) => ({
          id: c.id, amountCents: c.amountCents || 0, minutes: c.minutes || 0,
          status: c.status, sourceBoothName: c.sourceBoothName || null, createdAt: c.createdAt || null,
        }));
      const availableCreditCents = credits
        .filter((c: any) => c.status === 'available')
        .reduce((s: number, c: any) => s + (c.amountCents || 0), 0);

      // Reservations (last 180 days), split upcoming vs past
      const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
      const resSnap = await db.collection(`tenants/${tenantId}/boothReservations`)
        .where('createdAt', '>=', cutoff).get();
      const mine = resSnap.docs
        .filter((d: any) => { const r = d.data(); return contactMatches(key, r.phone, r.email); })
        .map((d: any) => safeReservation(d.id, d.data()));
      const ACTIVE = ['confirmed', 'checked_in'];
      const upcoming = mine
        .filter((r: any) => ACTIVE.includes(r.status) && r.endDate >= today)
        .sort((a: any, b: any) => (a.startDate + (a.startTime || '')).localeCompare(b.startDate + (b.startTime || '')));
      const past = mine
        .filter((r: any) => !ACTIVE.includes(r.status) || r.endDate < today)
        .sort((a: any, b: any) => (b.startDate || '').localeCompare(a.startDate || ''))
        .slice(0, 8);

      // Booth-rent payment history — matched by name, same as the staff portal
      const namesToMatch = new Set<string>();
      if (session.name) namesToMatch.add(session.name.toLowerCase());
      if (renter) namesToMatch.add(`${renter.firstName || ''} ${renter.lastName || ''}`.trim().toLowerCase());
      const resNames = resSnap.docs
        .filter((d: any) => { const r = d.data(); return contactMatches(key, r.phone, r.email); })
        .map((d: any) => String((d.data() as any).name || '').trim().toLowerCase())
        .filter(Boolean);
      resNames.forEach((n: string) => namesToMatch.add(n));
      let payments: any[] = [];
      try {
        const txSnap = await db.collection(`tenants/${tenantId}/transactions`)
          .where('source', '==', 'booth_rent').get();
        payments = txSnap.docs
          .map((d: any) => d.data() as any)
          .filter((t: any) => namesToMatch.has(String(t.clientOrVendor || '').trim().toLowerCase()))
          .map((t: any) => ({
            id: t.id, date: t.date, description: t.description || '',
            amount: t.amount || 0, type: t.type, category: t.category || '',
          }))
          .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''))
          .slice(0, 15);
      } catch { /* payments are informational — never fail the whole call */ }

      // ── Independent-provider block: their menu + the pricing coach inputs ──
      // Their staff record is the provider identity; the menu is keyed to it.
      // The coach numbers are derived HERE, server-side, from their own lease
      // so the portal never has to guess and never sees another renter's data.
      let provider: any = null;
      let myServices: any[] = [];
      let pricing: any = null;
      let myBookings: any[] = [];
      let earnings: any = null;
      try {
        if (renter) {
          const stSnap = await db.collection(`tenants/${tenantId}/staff`)
            .where('renterId', '==', renter.id).get();
          const st = stSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
            .find((m: any) => m.isRenter && m.isActive !== false);
          if (st) {
            await syncLeaseWindow(db, tenantId, st, lease, tenant);
            const origin = String(tenant.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');
            provider = {
              staffId: st.id,
              // Their weekly template, in the shape the availability engine
              // already honors as layer 3 (per-staff weekly hours).
              week: clampWeekToLease(
                (st.availability?.week && typeof st.availability.week === 'object') ? st.availability.week : {},
                lease,
              ),
              // Shown so the renter understands why a day may be unavailable.
              leasedDays: Array.isArray(lease?.scheduleSlot?.days)
                ? lease.scheduleSlot.days.map((d: any) => WEEK_DAYS[Number(d)] || '').filter(Boolean)
                : null,
              leasedStart: lease?.scheduleSlot?.startTime || '',
              leasedEnd: lease?.scheduleSlot?.endTime || '',
              // Deposits can only be offered once their own Stripe can charge.
              chargesEnabled: renter?.stripeChargesEnabled === true,
              bookingUrl: origin ? `${origin}/book/${tenantId}?provider=${st.id}` : `/book/${tenantId}?provider=${st.id}`,
            };
            // Their own book: client appointments booked through their link.
            // This is the renter's ledger — the studio's reports exclude these
            // entirely, so the two sets of books never overlap.
            try {
              const since = new Date(Date.now() - 60 * 86400000).toISOString();
              const apSnap = await db.collection(`tenants/${tenantId}/appointments`)
                .where('staffId', '==', st.id).where('startTime', '>=', since).get();
              const rows = apSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
                .filter((a: any) => a.isRenterBooking && a.status !== 'cancelled');
              const nowIso = new Date().toISOString();
              myBookings = rows
                .filter((a: any) => a.startTime >= nowIso)
                .sort((a: any, b: any) => String(a.startTime).localeCompare(String(b.startTime)))
                .slice(0, 20)
                .map((a: any) => ({
                  id: a.id, clientName: a.clientName || 'Client',
                  serviceName: a.renterServiceName || '', price: Number(a.renterServicePrice) || 0,
                  startTime: a.startTime, status: a.status,
                }));
              const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
              const monthIso = monthStart.toISOString();
              const done = rows.filter((a: any) => a.startTime >= monthIso && a.startTime < nowIso);
              earnings = {
                monthBookedCents: Math.round(done.reduce((sum: number, a: any) => sum + (Number(a.renterServicePrice) || 0), 0) * 100),
                monthCount: done.length,
                upcomingCount: myBookings.length,
              };
            } catch { /* their book is additive — never fail the whole call */ }

            const svSnap = await db.collection(`tenants/${tenantId}/renterServices`)
              .where('staffId', '==', st.id).get();
            myServices = svSnap.docs
              .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
              .filter((sv: any) => sv.isActive !== false)
              .map((sv: any) => ({ id: sv.id, name: sv.name || '', price: Number(sv.price) || 0, duration: Number(sv.duration) || 60, productCost: Number(sv.productCost) || 0, depositAmount: Number(sv.depositAmount) || 0 }))
              .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

            // Rent → cost per bookable hour. Weekly/biweekly leases are
            // normalized to a month so the number means the same thing for
            // everyone. Bookable hours are the renter's own estimate.
            const freq = String(lease?.frequency || 'monthly');
            const rentCents = Number(lease?.rentAmountCents) || 0;
            const monthlyRentCents = freq === 'weekly' ? Math.round(rentCents * 52 / 12)
              : freq === 'biweekly' ? Math.round(rentCents * 26 / 12)
              : rentCents;
            const bookableHours = Math.max(1, Number(renter.bookableHoursPerMonth) || 100);
            // ── Their goals: PRIVATE ────────────────────────────────────────
            // Lives in a subcollection the security rules close to every
            // client, reachable only through this session-checked API. The
            // studio's own pages cannot read it — that is the promise the
            // portal makes to a renter, made structurally true rather than
            // just stated. Only a target hourly, and only if they opt in, is
            // ever visible to the owner (see shareTargetHourly).
            let goals: any = null;
            try {
              const g = await db.doc(`tenants/${tenantId}/renters/${renter.id}/private/goals`).get();
              if (g.exists) goals = g.data() as any;
            } catch { /* no goals yet */ }

            const personalCents = Number(goals?.personalMonthlyCents) || 0;
            const businessCents = Number(goals?.businessMonthlyCents) || 0;
            const taxPct = Math.min(60, Math.max(0, Number(goals?.taxSetAsidePct ?? 25)));
            // Backwards from what they need to KEEP: gross up for tax, add rent
            // and business costs, spread over the hours they actually book.
            const grossNeededCents = personalCents > 0
              ? Math.round(personalCents / Math.max(0.1, 1 - taxPct / 100)) + monthlyRentCents + businessCents
              : 0;

            pricing = {
              monthlyRentCents,
              bookableHoursPerMonth: bookableHours,
              rentPerHourCents: Math.round(monthlyRentCents / bookableHours),
              // Lease floor — a term they agreed to, shown plainly, not a leash.
              priceFloorCents: Number(lease?.priceFloorCents) || 0,
              hasGoals: !!goals && personalCents > 0,
              targetHourlyCents: grossNeededCents > 0 ? Math.round(grossNeededCents / bookableHours) : 0,
              monthlyTargetCents: grossNeededCents,
              taxSetAsidePct: taxPct,
              personalMonthlyCents: personalCents,
              businessMonthlyCents: businessCents,
              shareTargetHourly: !!goals?.shareTargetHourly,
            };
          }
        }
      } catch { /* the provider block is additive — never fail the whole call */ }

      // ── Day swaps: what is waiting on me, what I am waiting on ────────────
      // The clash on a flagged request is recomputed HERE, every read, rather
      // than trusted from what it was when it was sent. That is what makes it
      // self-clearing: the moment they move their own client, Accept lights up
      // on its own — nothing has to re-send and no sweep has to notice.
      let swaps: any = null;
      try {
        if (provider && renter) {
          const swSnap = await db.collection(`tenants/${tenantId}/renterSwaps`).get();
          const rows = swSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
            .filter((x: any) => x.fromRenterId === renter.id || x.toRenterId === renter.id)
            .filter((x: any) => isDateKey(x.giveDate) && x.giveDate >= today);

          let liveConflict: (x: any) => number = () => 0;
          if (rows.some((x: any) => x.status === 'pending' && x.toRenterId === renter.id)) {
            const all = await loadSwapProviders(db, tenantId, today);
            const meCtx = all.find((c) => c.renterId === renter.id);
            if (meCtx) {
              liveConflict = (x: any) => {
                const v = swapTakeBlock(
                  { ...meCtx, busyDates: new Set([...meCtx.busyDates].filter((d) => d !== x.giveDate)) },
                  x.giveDate, today, { start: String(x.giveStart || ''), end: String(x.giveEnd || '') },
                );
                return v.startsWith('conflict:') ? (Number(v.split(':')[1]) || 1) : 0;
              };
            }
          }

          const shape = (x: any) => {
            const mine = x.toRenterId === renter.id;
            const clash = (mine && x.status === 'pending') ? liveConflict(x) : 0;
            const other = x.fromRenterId === renter.id ? (x.toName || 'whoever takes it') : x.fromName;
            return {
              id: x.id, status: x.status,
              iAmGiver: x.fromRenterId === renter.id,
              otherName: other,
              giveDate: x.giveDate, giveLabel: swapDateLabel(x.giveDate),
              giveStart: x.giveStart || '', giveEnd: x.giveEnd || '',
              wholeDay: x.wholeDay !== false,
              windowLabel: x.wholeDay !== false ? 'the whole day' : `${fmtHM(x.giveStart)}–${fmtHM(x.giveEnd)}`,
              conflictCount: clash,
              note: x.note || null, createdAt: x.createdAt || null,
            };
          };
          const bySoonest = (a2: any, b2: any) => String(a2.giveDate).localeCompare(String(b2.giveDate));

          // ── Open offers anyone can take ─────────────────────────────────
          // Broadcasts are the one place this portal shows a renter something
          // that is not theirs, so it is filtered hard: only OTHER people's
          // open offers, only where this renter could actually take it right
          // now. An offer they cannot action is noise, and noise is how a
          // studio learns to ignore the whole feature.
          const openRows = swSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
            .filter((x: any) => x.kind === 'broadcast' && x.status === 'open'
              && isDateKey(x.giveDate) && x.giveDate > today
              && x.fromRenterId !== renter.id);
          let openOffers: any[] = [];
          if (openRows.length > 0) {
            const all2 = await loadSwapProviders(db, tenantId, today);
            const meCtx2 = all2.find((c) => c.renterId === renter.id);
            if (meCtx2) {
              openOffers = openRows.filter((x: any) => swapTakeBlock(
                { ...meCtx2, busyDates: new Set([...meCtx2.busyDates].filter((d) => d !== x.giveDate)) },
                x.giveDate, today, { start: String(x.giveStart || ''), end: String(x.giveEnd || '') },
              ) === '').map((x: any) => ({
                id: x.id, fromName: x.fromName,
                giveDate: x.giveDate, giveLabel: swapDateLabel(x.giveDate),
                wholeDay: x.wholeDay !== false,
                windowLabel: x.wholeDay !== false ? 'the whole day' : `${fmtHM(x.giveStart)}–${fmtHM(x.giveEnd)}`,
                boothName: x.giveBoothName || null, note: x.note || null,
                offeredTo: Number(x.offeredTo) || 0,
              })).sort(bySoonest);
            }
          }

          swaps = {
            enabled: tenant.renterSwapsEnabled !== false,
            incoming: rows.filter((x: any) => x.status === 'pending' && x.toRenterId === renter.id).map(shape).sort(bySoonest),
            outgoing: rows.filter((x: any) => x.status === 'pending' && x.fromRenterId === renter.id).map(shape).sort(bySoonest),
            confirmed: rows.filter((x: any) => x.status === 'accepted' || x.status === 'taken').map(shape).sort(bySoonest),
            myOpen: rows.filter((x: any) => x.kind === 'broadcast' && x.status === 'open' && x.fromRenterId === renter.id)
              .map((x: any) => ({
                id: x.id, giveDate: x.giveDate, giveLabel: swapDateLabel(x.giveDate),
                windowLabel: x.wholeDay !== false ? 'the whole day' : `${fmtHM(x.giveStart)}–${fmtHM(x.giveEnd)}`,
                offeredTo: Number(x.offeredTo) || 0,
              })).sort(bySoonest),
            openOffers,
          };
        }
      } catch { /* swaps are additive — never fail the whole call */ }

      // ── Setup checklist ───────────────────────────────────────────────────
      // Derived fresh every read from what actually exists, never from a
      // stored "onboarded" flag — a flag would keep saying done after they
      // deleted their last service, and would say not-done forever for the
      // renters who were already set up before this existed.
      //
      // It ADAPTS to booking mode: someone on their own system is not
      // half-finished, they are finished. Nagging them about hours and menus
      // they will never use is how a portal gets ignored.
      let checklist: any = null;
      try {
        if (renter) {
          const mode = renter.bookingMode === 'own' ? 'own' : 'studio';
          const modeChosen = renter.bookingMode === 'own' || renter.bookingMode === 'studio';
          const items: any[] = [];
          if (mode === 'studio' && provider) {
            const week = (provider as any).week || {};
            const hasHours = Object.keys(week).some((k) => week[k]?.enabled && week[k]?.start && week[k]?.end);
            items.push({
              key: 'hours', label: 'Set the hours you work',
              hint: hasHours ? '' : 'Until this is set, nobody can book you at all.',
              done: hasHours, optional: false,
            });
            items.push({
              key: 'services', label: 'Add at least one service',
              hint: (myServices || []).length > 0 ? '' : 'Your prices, your menu — clients see only yours.',
              done: (myServices || []).length > 0, optional: false,
            });
            items.push({
              key: 'deposits', label: 'Connect Stripe to take deposits',
              hint: renter.stripeChargesEnabled ? '' : 'Optional. Without it, clients pay you in person.',
              done: renter.stripeChargesEnabled === true, optional: true,
            });
          }
          const required = items.filter((i) => !i.optional);
          checklist = {
            mode, modeChosen,
            dismissed: !!renter.checklistDismissedAt,
            items,
            remaining: required.filter((i) => !i.done).length,
            allDone: required.every((i) => i.done),
          };
        }
      } catch { /* the checklist is additive — never fail the whole call */ }

      return NextResponse.json({
        ok: true,
        name: session.name,
        studioName: tenant.name || 'Studio',
        rebookUrl: tenant.boothListingUrl || tenant.publicBookingUrl || null,
        renter: renter ? {
          id: renter.id,
          firstName: renter.firstName || '', lastName: renter.lastName || '',
          businessName: renter.businessName || null,
          cardOnFile: !!renter.cardOnFile, cardBrand: renter.cardBrand || null, cardLast4: renter.cardLast4 || null,
          autopayEnabled: renter.autopayEnabled === true,
        } : null,
        lease: lease ? {
          id: lease.id, boothName: leaseBoothName,
          rentAmountCents: lease.rentAmountCents || 0, frequency: lease.frequency || 'monthly',
          dueDay: lease.dueDay ?? 1, endDate: lease.endDate || null, status: lease.status,
          scheduleSlot: lease.scheduleSlot || null,
        } : null,
        invoices, credits, availableCreditCents,
        upcoming, past,
        payments,
        provider, myServices, pricing, myBookings, earnings, swaps, checklist,
        profile: {
          bio: renter?.bio || '',
          instagram: renter?.instagram || '',
          photoUrl: renter?.photoUrl || '',
          externalBookingUrl: renter?.externalBookingUrl || '',
          listExternally: renter?.listExternally === true,
        },
        bookingMode: renter?.bookingMode === 'own' ? 'own' : 'studio',
      });
    }

    // ═══ my-goals ═════════════════════════════════════════════════════════
    // What they need to earn, in their own words. Written to the private
    // subcollection; nothing here is ever returned to an owner-facing surface.
    // shareTargetHourly is opt-in and shares ONE derived number, never the
    // inputs behind it.
    if (action === 'my-goals') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const personal = Math.max(0, Math.round((Number(body.personalMonthly) || 0) * 100));
      const business = Math.max(0, Math.round((Number(body.businessMonthly) || 0) * 100));
      const taxPct = Math.min(60, Math.max(0, Number(body.taxSetAsidePct ?? 25)));
      const share = body.shareTargetHourly === true;
      await db.doc(`tenants/${tenantId}/renters/${session.renterId}/private/goals`).set({
        personalMonthlyCents: personal,
        businessMonthlyCents: business,
        taxSetAsidePct: taxPct,
        shareTargetHourly: share,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      // The opt-in shares exactly one derived figure on the renter record —
      // the owner sees a rate, never a household budget.
      try {
        const rRef = db.doc(`tenants/${tenantId}/renters/${session.renterId}`);
        if (share) {
          const ls = await db.collection(`tenants/${tenantId}/leases`).where('renterId', '==', session.renterId).get();
          const active = ls.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
            .find((l: any) => ['active', 'on_leave'].includes(l.status));
          const freq = String(active?.frequency || 'monthly');
          const rentCents = Number(active?.rentAmountCents) || 0;
          const monthlyRentCents = freq === 'weekly' ? Math.round(rentCents * 52 / 12)
            : freq === 'biweekly' ? Math.round(rentCents * 26 / 12) : rentCents;
          const rSnap = await rRef.get();
          const hrs = Math.max(1, Number((rSnap.data() as any)?.bookableHoursPerMonth) || 100);
          const gross = personal > 0 ? Math.round(personal / Math.max(0.1, 1 - taxPct / 100)) + monthlyRentCents + business : 0;
          await rRef.set({ sharedTargetHourlyCents: gross > 0 ? Math.round(gross / hrs) : 0 }, { merge: true });
        } else {
          await rRef.set({ sharedTargetHourlyCents: 0 }, { merge: true });
        }
      } catch { /* sharing is a bonus — the private save already stands */ }
      return NextResponse.json({ ok: true });
    }

    // ═══ my-service-save / my-service-remove / my-hours ═══════════════════
    // A renter editing their own menu. The session's renterId decides which
    // staff record they own; the serviceId is re-read and re-checked against
    // it, so a forged id can only ever hit their own row. The lease floor is
    // enforced HERE, not just in the UI.
    if (action === 'my-service-save' || action === 'my-service-remove' || action === 'my-hours') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const stSnap = await db.collection(`tenants/${tenantId}/staff`).where('renterId', '==', session.renterId).get();
      const st = stSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        .find((m: any) => m.isRenter && m.isActive !== false);
      if (!st) return NextResponse.json({ ok: false, error: 'Bookings are not enabled for you yet' }, { status: 403 });

      if (action === 'my-hours') {
        // Two things share this action: the pricing input (hours per month)
        // and, optionally, the weekly template the booking engine reads.
        const patch: any = {};
        if (body.bookableHoursPerMonth !== undefined) {
          const hours = Math.max(1, Math.min(400, Number(body.bookableHoursPerMonth) || 0));
          if (!hours) return NextResponse.json({ ok: false, error: 'Enter your bookable hours' }, { status: 400 });
          patch.bookableHoursPerMonth = hours;
        }
        if (Object.keys(patch).length > 0) {
          await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).set(patch, { merge: true });
        }

        if (body.week && typeof body.week === 'object') {
          const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
          const clock = (v: any) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : '');
          const week: any = {};
          for (const d of DAYS) {
            const row = (body.week as any)[d] || {};
            const enabled = row.enabled === true;
            const start = clock(row.start);
            const end = clock(row.end);
            // A day is only "on" if it carries a real, ordered pair of times —
            // otherwise it is written as off rather than as a broken window
            // the booking grid would have to guess about.
            week[d] = (enabled && start && end && start < end)
              ? { enabled: true, start, end }
              : { enabled: false };
          }
          // Re-read their active lease here rather than trusting the client,
          // then clamp before saving.
          let activeLease: any = null;
          try {
            const ls = await db.collection(`tenants/${tenantId}/leases`).where('renterId', '==', session.renterId).get();
            activeLease = ls.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
              .find((l: any) => ['active', 'on_leave'].includes(l.status)) || null;
          } catch { /* no lease readable — save as entered */ }
          const clamped = clampWeekToLease(week, activeLease);
          await db.doc(`tenants/${tenantId}/staff/${st.id}`).set({ availability: { week: clamped } }, { merge: true });
          // Saved hours are only half the story — the engine clamps to the
          // lease at read time, so keep the stamp it reads current too.
          try {
            const tSnap = await db.doc(`tenants/${tenantId}`).get();
            await syncLeaseWindow(db, tenantId, st, activeLease, (tSnap.data() as any) || {});
          } catch { /* nightly sweep catches it */ }
          return NextResponse.json({ ok: true, week: clamped });
        }
        return NextResponse.json({ ok: true, ...patch });
      }

      if (action === 'my-service-remove') {
        const id = String(body.serviceId || '');
        const ref = db.doc(`tenants/${tenantId}/renterServices/${id}`);
        const cur = await ref.get();
        if (!cur.exists || (cur.data() as any)?.staffId !== st.id) {
          return NextResponse.json({ ok: false, error: 'Not your service' }, { status: 403 });
        }
        await ref.set({ isActive: false }, { merge: true });
        return NextResponse.json({ ok: true });
      }

      const name = String(body.name || '').trim().slice(0, 80);
      const priceCents = Math.round((Number(body.price) || 0) * 100);
      const duration = Math.max(5, Math.min(600, Number(body.duration) || 60));
      const productCost = Math.max(0, Number(body.productCost) || 0);
      // A deposit is only honored when Stripe has actually enabled charges on
      // their account — otherwise it silently stays off rather than promising
      // a client a payment step that can't run.
      const rSnap2 = await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).get();
      const canCharge = ((rSnap2.data() as any)?.stripeChargesEnabled === true);
      const depositAmount = canCharge ? Math.max(0, Number(body.depositAmount) || 0) : 0;
      if (!name) return NextResponse.json({ ok: false, error: 'Give the service a name' }, { status: 400 });
      if (priceCents <= 0) return NextResponse.json({ ok: false, error: 'Set a price' }, { status: 400 });

      // Lease floor: refuse rather than save something that breaks their terms.
      let floorCents = 0;
      try {
        const ls = await db.collection(`tenants/${tenantId}/leases`).where('renterId', '==', session.renterId).get();
        const active = ls.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
          .find((l: any) => ['active', 'on_leave'].includes(l.status));
        floorCents = Number(active?.priceFloorCents) || 0;
      } catch { /* no floor readable — treat as none */ }
      if (floorCents > 0 && priceCents < floorCents) {
        return NextResponse.json({
          ok: false,
          error: `Your lease sets a $${(floorCents / 100).toFixed(2)} minimum per service.`,
        }, { status: 400 });
      }

      const id = String(body.serviceId || '') || `rs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const ref = db.doc(`tenants/${tenantId}/renterServices/${id}`);
      const cur = await ref.get();
      if (cur.exists && (cur.data() as any)?.staffId !== st.id) {
        return NextResponse.json({ ok: false, error: 'Not your service' }, { status: 403 });
      }
      await ref.set({
        id, tenantId, staffId: st.id, renterId: session.renterId,
        name, price: priceCents / 100, duration, productCost, depositAmount,
        isActive: true, collectsOwnPayment: true,
        updatedAt: new Date().toISOString(),
        ...(cur.exists ? {} : { createdAt: new Date().toISOString() }),
      }, { merge: true });
      return NextResponse.json({ ok: true, serviceId: id });
    }

    // ═══ my-profile ═════════════════════════════════════════════════════════
    // Who a client sees behind the link. Until now a personal booking link led
    // to a bare name, which is a poor advertisement for someone whose whole
    // pitch is that they are their own business.
    //
    // Renters on their OWN booking system get the field that matters to them
    // instead: their real booking URL, so a client who lands on the studio's
    // page can still reach them rather than hitting a dead end.
    //
    // Everything saved here is public by nature, so it is mirrored onto the
    // STAFF doc — the booking page reads staff and must never read renters,
    // which hold rent, payouts and Stripe ids.
    if (action === 'my-profile') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const bio = String(body.bio ?? '').trim().slice(0, 300);
      const instagram = String(body.instagram ?? '').trim()
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/^@/, '').replace(/\/+$/, '').slice(0, 40);
      if (instagram && !/^[A-Za-z0-9._]+$/.test(instagram)) {
        return NextResponse.json({ ok: false, error: 'That Instagram handle has characters it shouldn’t.' }, { status: 400 });
      }

      // Only https. A booking link is rendered as something a stranger taps,
      // so javascript: and data: URLs are refused outright rather than escaped.
      let externalBookingUrl = String(body.externalBookingUrl ?? '').trim().slice(0, 300);
      if (externalBookingUrl) {
        if (!/^https:\/\//i.test(externalBookingUrl)) {
          externalBookingUrl = `https://${externalBookingUrl.replace(/^\w+:\/\//, '')}`;
        }
        try {
          const u = new URL(externalBookingUrl);
          if (u.protocol !== 'https:') throw new Error('bad');
          externalBookingUrl = u.toString();
        } catch {
          return NextResponse.json({ ok: false, error: 'That booking link doesn’t look like a web address.' }, { status: 400 });
        }
      }
      const listExternally = body.listExternally === true;

      let photoUrl: string | null | undefined = undefined;
      if (typeof body.photoData === 'string' && body.photoData.startsWith('data:')) {
        const up = await uploadPortalImageFromDataUrl(tenantId, `renters/${session.renterId}/profile`, body.photoData);
        if (!up.url) return NextResponse.json({ ok: false, error: up.error || 'That photo didn’t upload.' }, { status: 400 });
        photoUrl = up.url;
      } else if (body.photoData === null) {
        photoUrl = null;
      }

      const renterPatch: any = { bio, instagram, externalBookingUrl, listExternally };
      if (photoUrl !== undefined) renterPatch.photoUrl = photoUrl;
      await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).set(renterPatch, { merge: true });

      try {
        const stSnap = await db.collection(`tenants/${tenantId}/staff`)
          .where('renterId', '==', session.renterId).limit(1).get();
        if (!stSnap.empty) {
          const mirror: any = { bio, instagram, externalBookingUrl, listExternally };
          if (photoUrl !== undefined) mirror.photoUrl = photoUrl;
          await stSnap.docs[0].ref.set(mirror, { merge: true });
        }
      } catch { /* the portal still shows it; the booking page catches up on the next save */ }

      return NextResponse.json({ ok: true, photoUrl: photoUrl === undefined ? null : photoUrl });
    }

    // ═══ booking-mode ═══════════════════════════════════════════════════════
    // "I book through the studio" vs "I use my own system". This is an explicit
    // CHOICE, not an absence — plenty of renters already run Square or Booksy
    // and are not going to move. Recording it means the portal can stop
    // nagging them about hours and menus they will never use, and their booking
    // link can stop existing, without anybody having to pretend they are
    // half-set-up forever.
    if (action === 'booking-mode') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const mode = String(body.mode || '');
      if (!['studio', 'own'].includes(mode)) {
        return NextResponse.json({ ok: false, error: 'Pick how you take bookings.' }, { status: 400 });
      }
      await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).set({
        bookingMode: mode, bookingModeSetAt: new Date().toISOString(),
      }, { merge: true });

      // Mirror ONE public-safe flag onto the staff doc. The booking page reads
      // staff and never renters, and the availability engine reads this to make
      // the opt-out real rather than cosmetic.
      try {
        const stSnap = await db.collection(`tenants/${tenantId}/staff`)
          .where('renterId', '==', session.renterId).limit(1).get();
        if (!stSnap.empty) {
          await stSnap.docs[0].ref.set({ bookingOptOut: mode === 'own' }, { merge: true });
        }
      } catch { /* the engine also treats a missing flag as opted-in */ }

      await logAuditAdmin(db, tenantId, {
        action: 'renter.booking_mode', targetType: 'renter', targetId: session.renterId,
        summary: `${session.name || 'A renter'} set booking to ${mode === 'own' ? 'their own system' : 'the studio system'}`,
        actor: { type: 'user', name: session.name || 'Renter', role: 'renter', via: 'renter-portal' },
      });
      return NextResponse.json({ ok: true, mode });
    }

    // ═══ checklist-dismiss ══════════════════════════════════════════════════
    // One dismissal, permanent. A setup prompt that comes back is a nag.
    if (action === 'checklist-dismiss') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).set({
        checklistDismissedAt: new Date().toISOString(),
      }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // ═══ swap-options ═══════════════════════════════════════════════════
    // The days this renter could offer, as edge slices already cleared of
    // their own clients, plus who could take them. Nothing about anyone
    // else's clients is returned — eligibility is decided server-side.
    if (action === 'swap-options') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const today = safeToday(body.today);
      const tenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      if (tenant.renterSwapsEnabled === false) {
        return NextResponse.json({ ok: true, enabled: false, myDates: [], partners: [] });
      }
      const all = await loadSwapProviders(db, tenantId, today);
      const me = all.find((x) => x.renterId === session.renterId);
      if (!me) return NextResponse.json({ ok: false, error: 'Bookings are not enabled for you yet' }, { status: 403 });
      const others = all.filter((x) => x.renterId !== me.renterId);

      const myDates: any[] = [];
      for (let i = 1; i <= SWAP_HORIZON_DAYS; i++) {
        const dk = swapAddDays(today, i);
        if (me.busyDates.has(dk)) continue;
        if (me.leaseEndDate && dk > me.leaseEndDate) continue;
        const { held, leading, trailing } = swapOfferableSegments(me, dk);
        if (!held) continue;
        // Someone must be able to take at least the whole held window, or one
        // of its edges — otherwise the date is dead weight in the picker.
        const anyTaker = [held, leading, trailing].filter(Boolean).some((seg: any) =>
          others.some((o) => {
            const v = swapTakeBlock(o, dk, today, seg);
            return v === '' || v.startsWith('conflict:');
          }));
        if (!anyTaker) continue;
        myDates.push({
          date: dk, label: swapDateLabel(dk),
          held, leading, trailing,
          isSplit: !!(leading && trailing && (leading.end !== held.end || trailing.start !== held.start)),
        });
      }

      const partners = others.map((o) => ({ staffId: o.staffId, name: o.name, boothName: o.boothName }));
      return NextResponse.json({ ok: true, enabled: true, myDates, partners, boothName: me.boothName });
    }

    // ═══ swap-request ═══════════════════════════════════════════════════════
    // Sends, or — when the other person has their own client inside the window
    // — comes back asking whether to send it anyway. An ask-anyway request is
    // still just a request: it can be sent, but it can never be accepted while
    // the clash stands. See swap-respond.
    if (action === 'swap-request') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const today = safeToday(body.today);
      const tenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      if (tenant.renterSwapsEnabled === false) {
        return NextResponse.json({ ok: false, error: 'Day swaps are turned off for this studio.' }, { status: 403 });
      }
      const toStaffId = String(body.toStaffId || '');
      const giveDate = String(body.giveDate || '');
      const note = String(body.note || '').trim().slice(0, 240);
      const askAnyway = body.askAnyway === true;
      if (!isDateKey(giveDate)) return NextResponse.json({ ok: false, error: 'Pick a date to offer.' }, { status: 400 });

      const all = await loadSwapProviders(db, tenantId, today);
      const me = all.find((x) => x.renterId === session.renterId);
      const other = all.find((x) => x.staffId === toStaffId);
      if (!me) return NextResponse.json({ ok: false, error: 'Bookings are not enabled for you yet' }, { status: 403 });
      if (!other || other.renterId === me.renterId) {
        return NextResponse.json({ ok: false, error: 'Pick who you want to swap with.' }, { status: 400 });
      }

      const held = swapHeld(me, giveDate);
      if (!held) return NextResponse.json({ ok: false, error: 'That is not one of your days.' }, { status: 400 });
      const win: SwapSeg = {
        start: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.giveStart || '')) ? String(body.giveStart) : held.start,
        end: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.giveEnd || '')) ? String(body.giveEnd) : held.end,
      };
      const giveBlock = swapGiveBlock(me, giveDate, today, win);
      if (giveBlock) return NextResponse.json({ ok: false, error: `${giveBlock}.` }, { status: 400 });

      const takeBlock = swapTakeBlock(other, giveDate, today, win);
      const conflictCount = takeBlock.startsWith('conflict:') ? Number(takeBlock.split(':')[1]) || 1 : 0;
      if (takeBlock && conflictCount === 0) {
        return NextResponse.json({ ok: false, error: `${other.name} can’t take that — ${takeBlock.toLowerCase()}.` }, { status: 400 });
      }
      if (conflictCount > 0 && !askAnyway) {
        // Not a refusal — a question. They may still want to ask.
        return NextResponse.json({
          ok: false, needsConfirm: true, conflictCount,
          error: `${other.name} already has ${conflictCount === 1 ? 'a client' : `${conflictCount} clients`} booked in that window. You can still ask, but they won’t be able to accept unless they move it themselves.`,
        }, { status: 409 });
      }

      const whole = win.start === held.start && win.end === held.end;
      const ref = db.collection(`tenants/${tenantId}/renterSwaps`).doc();
      await ref.set({
        id: ref.id, tenantId, status: 'pending',
        fromRenterId: me.renterId, fromStaffId: me.staffId, fromName: me.name,
        toRenterId: other.renterId, toStaffId: other.staffId, toName: other.name,
        giveDate, giveStart: win.start, giveEnd: win.end,
        wholeDay: whole,
        giveBoothId: me.boothId, giveBoothName: me.boothName,
        returnDate: null, returnStart: null, returnEnd: null,
        returnBoothId: null, returnBoothName: null,
        conflicted: conflictCount > 0, conflictCountAtSend: conflictCount,
        note: note || null,
        createdAt: new Date().toISOString(), respondedAt: null,
      });

      const winText = whole ? 'the whole day' : `${fmtHM(win.start)}–${fmtHM(win.end)}`;
      await swapNotify(db, tenantId, tenant, other,
        `Day swap request from ${me.name}`,
        conflictCount > 0 ? 'A swap request you may not be able to take' : 'A day swap is waiting for you',
        [`${me.name} is offering you ${swapDateLabel(giveDate)}, ${winText}.`,
         ...(note ? [`They said: “${note}”`] : []),
         ...(conflictCount > 0
           ? [`Heads up: you already have ${conflictCount === 1 ? 'a client' : `${conflictCount} clients`} booked in that window, so you can’t accept as things stand. If you move that booking yourself, the request becomes acceptable on its own.`]
           : ['Open your portal to accept or decline.']),
         'Nothing changes until you answer, and your rent is not affected either way.'],
        `${me.name} wants to swap ${swapDateLabel(giveDate)} (${winText}). Open your portal to accept or decline.`,
        conflictCount > 0);

      await swapTellOwner(db, tenantId,
        `${me.name} asked ${other.name} to cover ${swapDateLabel(giveDate)}, ${winText} — waiting on ${other.name}.`);
      await logAuditAdmin(db, tenantId, {
        action: 'renter.swap_requested', targetType: 'renterSwap', targetId: ref.id,
        summary: `${me.name} requested a swap with ${other.name} for ${giveDate} ${win.start}-${win.end}${conflictCount > 0 ? ' (sent despite a booking clash)' : ''}`,
        actor: { type: 'user', name: me.name, role: 'renter', via: 'renter-portal' },
      });
      return NextResponse.json({ ok: true, swapId: ref.id, conflicted: conflictCount > 0 });
    }

    // ═══ swap-respond ═══════════════════════════════════════════════════════
    // Accepting is the only place a window actually moves, so everything is
    // checked AGAIN here. A request sent last week may have been overtaken by a
    // booking, and the honest answer then is no — not a double-booked chair.
    if (action === 'swap-respond') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const today = safeToday(body.today);
      const decision = String(body.decision || '');
      if (!['accept', 'decline'].includes(decision)) {
        return NextResponse.json({ ok: false, error: 'Accept or decline.' }, { status: 400 });
      }
      const ref = db.doc(`tenants/${tenantId}/renterSwaps/${String(body.swapId || '')}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'That request is gone.' }, { status: 404 });
      const sw: any = snap.data();
      if (sw.toRenterId !== session.renterId) {
        return NextResponse.json({ ok: false, error: 'That request isn’t yours to answer.' }, { status: 403 });
      }
      if (sw.status !== 'pending') {
        return NextResponse.json({ ok: false, error: 'That request has already been answered.' }, { status: 409 });
      }
      const tenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const all = await loadSwapProviders(db, tenantId, today);
      const from = all.find((x) => x.renterId === sw.fromRenterId);
      const to = all.find((x) => x.renterId === sw.toRenterId);
      const win: SwapSeg = { start: String(sw.giveStart || ''), end: String(sw.giveEnd || '') };
      const winText = sw.wholeDay ? 'the whole day' : `${fmtHM(win.start)}–${fmtHM(win.end)}`;

      if (decision === 'decline') {
        const reason = String(body.reason || '') === 'never_that_day' ? 'never_that_day' : 'not_this_time';
        await ref.set({ status: 'declined', declineReason: reason, respondedAt: new Date().toISOString() }, { merge: true });
        if (from) {
          await swapNotify(db, tenantId, tenant, from,
            `${sw.toName} declined the swap`, 'Swap declined',
            [`${sw.toName} can’t take ${swapDateLabel(sw.giveDate)}, ${winText}. Your day is unchanged and your rent was never affected.`,
             reason === 'never_that_day'
               ? `They said that day doesn’t work for them generally — worth asking someone else next time.`
               : 'You can offer it to someone else from your portal.'],
            `${sw.toName} declined the ${swapDateLabel(sw.giveDate)} swap. Your day is unchanged.`);
        }
        await logAuditAdmin(db, tenantId, {
          action: 'renter.swap_declined', targetType: 'renterSwap', targetId: ref.id,
          summary: `${sw.toName} declined ${sw.fromName}'s swap for ${sw.giveDate} (${reason})`,
          actor: { type: 'user', name: sw.toName, role: 'renter', via: 'renter-portal' },
        });
        return NextResponse.json({ ok: true, status: 'declined' });
      }

      if (!isDateKey(sw.giveDate) || sw.giveDate <= today) {
        await ref.set({ status: 'expired', respondedAt: new Date().toISOString() }, { merge: true });
        return NextResponse.json({ ok: false, error: 'That day has already come around — the request expired.' }, { status: 409 });
      }
      if (!from || !to) {
        return NextResponse.json({ ok: false, error: 'One of you is no longer set up for bookings.' }, { status: 409 });
      }
      // Re-check ignoring THIS request's own hold on the date.
      const without = (ctx: SwapCtx) => {
        const clone: SwapCtx = { ...ctx, busyDates: new Set(ctx.busyDates) };
        clone.busyDates.delete(sw.giveDate);
        return clone;
      };
      const fromC = without(from); const toC = without(to);
      const giveStale = swapGiveBlock(fromC, sw.giveDate, today, win);
      if (giveStale) {
        return NextResponse.json({ ok: false, error: `This swap no longer works — ${giveStale.toLowerCase()}. Ask them to send a new one.` }, { status: 409 });
      }
      const takeStale = swapTakeBlock(toC, sw.giveDate, today, win);
      if (takeStale.startsWith('conflict:')) {
        const n = Number(takeStale.split(':')[1]) || 1;
        // THE POINT OF ASK-ANYWAY: it may be sent, never auto-accepted. The
        // person who would have to move is a client who is not in this
        // conversation, so only their own provider can resolve it.
        return NextResponse.json({
          ok: false, conflictCount: n,
          error: `You still have ${n === 1 ? 'a client' : `${n} clients`} booked in that window. Move or cancel that booking first, then this becomes acceptable.`,
        }, { status: 409 });
      }
      if (takeStale) {
        return NextResponse.json({ ok: false, error: `You can’t take this — ${takeStale.toLowerCase()}.` }, { status: 409 });
      }

      const takerSpan = swapTakerSpan(toC, sw.giveDate, win);
      const giverRest = swapGiverRemainder(fromC, sw.giveDate, win);
      const stamp = { reason: 'swap', swapId: ref.id, setAt: new Date().toISOString() };
      const batch = db.batch();
      batch.set(db.doc(`tenants/${tenantId}/staff/${from.staffId}`), {
        availability: { dates: { [sw.giveDate]: giverRest
          ? { enabled: true, start: giverRest.start, end: giverRest.end, ...stamp, note: `Gave ${winText} to ${to.name}` }
          : { enabled: false, ...stamp, note: `Swapped to ${to.name}` } } },
      }, { merge: true });
      batch.set(db.doc(`tenants/${tenantId}/staff/${to.staffId}`), {
        availability: { dates: { [sw.giveDate]: { enabled: true, start: takerSpan.start, end: takerSpan.end, ...stamp, note: `Covering ${winText} for ${from.name}`, boothId: sw.giveBoothId || null } } },
      }, { merge: true });
      batch.set(ref, { status: 'accepted', respondedAt: new Date().toISOString(), acceptedTakerStart: takerSpan.start, acceptedTakerEnd: takerSpan.end }, { merge: true });
      await batch.commit();

      const both = `${to.name} covers ${swapDateLabel(sw.giveDate)}, ${winText}${giverRest ? `; ${from.name} still works ${fmtHM(giverRest.start)}–${fmtHM(giverRest.end)}` : ''}.`;
      for (const target of [from, to]) {
        await swapNotify(db, tenantId, tenant, target,
          `Swap confirmed — ${swapDateLabel(sw.giveDate)}`, 'Your swap is confirmed',
          [both, 'Booking hours have already moved for that window only. Rent is unchanged — a swap trades time, not money.'],
          `Swap confirmed: ${both}`);
      }
      await swapTellOwner(db, tenantId,
        `${to.name} is covering ${from.name} on ${swapDateLabel(sw.giveDate)}, ${winText}${sw.giveBoothName ? ` (${sw.giveBoothName})` : ''}. Rent unchanged.`);
      await logAuditAdmin(db, tenantId, {
        action: 'renter.swap_accepted', targetType: 'renterSwap', targetId: ref.id,
        summary: `${to.name} accepted ${from.name}'s swap: ${sw.giveDate} ${win.start}-${win.end} (rent unchanged)`,
        actor: { type: 'user', name: to.name, role: 'renter', via: 'renter-portal' },
      });
      return NextResponse.json({ ok: true, status: 'accepted' });
    }

    // ═══ swap-broadcast ═════════════════════════════════════════════════════
    // Put a day (or an edge of one) up for whoever can take it, instead of
    // leaning on one person. This is the honest answer to "I need Thursday
    // covered": ask everyone who could actually say yes, once, and let the
    // first taker close it. No badgering, no repeat asks, no chasing.
    if (action === 'swap-broadcast') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const today = safeToday(body.today);
      const tenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      if (tenant.renterSwapsEnabled === false) {
        return NextResponse.json({ ok: false, error: 'Day swaps are turned off for this studio.' }, { status: 403 });
      }
      const giveDate = String(body.giveDate || '');
      const note = String(body.note || '').trim().slice(0, 240);
      if (!isDateKey(giveDate)) return NextResponse.json({ ok: false, error: 'Pick a date to offer.' }, { status: 400 });

      const all = await loadSwapProviders(db, tenantId, today);
      const me = all.find((x) => x.renterId === session.renterId);
      if (!me) return NextResponse.json({ ok: false, error: 'Bookings are not enabled for you yet' }, { status: 403 });
      const held = swapHeld(me, giveDate);
      if (!held) return NextResponse.json({ ok: false, error: 'That is not one of your days.' }, { status: 400 });
      const win: SwapSeg = {
        start: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.giveStart || '')) ? String(body.giveStart) : held.start,
        end: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.giveEnd || '')) ? String(body.giveEnd) : held.end,
      };
      const giveBlock = swapGiveBlock(me, giveDate, today, win);
      if (giveBlock) return NextResponse.json({ ok: false, error: `${giveBlock}.` }, { status: 400 });

      // Only people who could actually say yes are told. A clash means they
      // could not accept it anyway, and a broadcast nobody can action is the
      // fastest way to teach a studio to ignore these.
      const eligible = all.filter((o) => o.renterId !== me.renterId
        && swapTakeBlock(o, giveDate, today, win) === '');
      if (eligible.length === 0) {
        return NextResponse.json({ ok: false, error: 'Nobody here can take that window right now. Try a different day or a shorter slice.' }, { status: 409 });
      }

      const whole = win.start === held.start && win.end === held.end;
      const ref = db.collection(`tenants/${tenantId}/renterSwaps`).doc();
      await ref.set({
        id: ref.id, tenantId, kind: 'broadcast', status: 'open',
        fromRenterId: me.renterId, fromStaffId: me.staffId, fromName: me.name,
        toRenterId: null, toStaffId: null, toName: null,
        giveDate, giveStart: win.start, giveEnd: win.end, wholeDay: whole,
        giveBoothId: me.boothId, giveBoothName: me.boothName,
        note: note || null, offeredTo: eligible.length,
        createdAt: new Date().toISOString(), respondedAt: null,
      });

      const winText = whole ? 'the whole day' : `${fmtHM(win.start)}–${fmtHM(win.end)}`;
      // Email only, deliberately. A broadcast goes to several people about
      // something first-come; texting the whole studio for it is exactly how
      // swap notifications end up muted.
      for (const target of eligible) {
        await swapNotify(db, tenantId, tenant, target,
          `${me.name} is offering ${swapDateLabel(giveDate)}`,
          'A day is up for grabs',
          [`${me.name} is offering ${swapDateLabel(giveDate)}, ${winText}${me.boothName ? ` at ${me.boothName}` : ''}.`,
           ...(note ? [`They said: “${note}”`] : []),
           `It goes to whoever takes it first — ${eligible.length === 1 ? 'you are the only one who can' : `${eligible.length} of you can`} take this one.`,
           'Rent is not affected: a swap trades time, not money.'],
          '', true);
      }
      await swapTellOwner(db, tenantId,
        `${me.name} offered ${swapDateLabel(giveDate)}, ${winText} to whoever can take it (${eligible.length} asked).`);
      await logAuditAdmin(db, tenantId, {
        action: 'renter.swap_broadcast', targetType: 'renterSwap', targetId: ref.id,
        summary: `${me.name} offered ${giveDate} ${win.start}-${win.end} to ${eligible.length} eligible providers`,
        actor: { type: 'user', name: me.name, role: 'renter', via: 'renter-portal' },
      });
      return NextResponse.json({ ok: true, swapId: ref.id, offeredTo: eligible.length });
    }

    // ═══ swap-claim ═════════════════════════════════════════════════════════
    // First to take it wins, and that has to be true under a real race — two
    // renters tapping at the same moment must not both end up in the chair.
    // The status flip happens INSIDE a transaction, so the second one reads
    // 'taken' and loses cleanly.
    if (action === 'swap-claim') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const today = safeToday(body.today);
      const ref = db.doc(`tenants/${tenantId}/renterSwaps/${String(body.swapId || '')}`);
      const pre = await ref.get();
      if (!pre.exists) return NextResponse.json({ ok: false, error: 'That offer is gone.' }, { status: 404 });
      const sw0: any = pre.data();
      if (sw0.kind !== 'broadcast') return NextResponse.json({ ok: false, error: 'That is not an open offer.' }, { status: 400 });
      if (sw0.status !== 'open') return NextResponse.json({ ok: false, error: 'Someone else already took that one.' }, { status: 409 });
      if (sw0.fromRenterId === session.renterId) return NextResponse.json({ ok: false, error: 'That is your own offer.' }, { status: 400 });
      if (!isDateKey(sw0.giveDate) || sw0.giveDate <= today) {
        return NextResponse.json({ ok: false, error: 'That day has already come around.' }, { status: 409 });
      }

      const tenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const all = await loadSwapProviders(db, tenantId, today);
      const from = all.find((x) => x.renterId === sw0.fromRenterId);
      const to = all.find((x) => x.renterId === session.renterId);
      if (!from || !to) return NextResponse.json({ ok: false, error: 'One of you is no longer set up for bookings.' }, { status: 409 });
      const win: SwapSeg = { start: String(sw0.giveStart || ''), end: String(sw0.giveEnd || '') };
      const without = (ctx: SwapCtx) => ({ ...ctx, busyDates: new Set([...ctx.busyDates].filter((d) => d !== sw0.giveDate)) });
      const fromC = without(from); const toC = without(to);

      const giveStale = swapGiveBlock(fromC, sw0.giveDate, today, win);
      if (giveStale) return NextResponse.json({ ok: false, error: `That offer no longer works — ${giveStale.toLowerCase()}.` }, { status: 409 });
      const takeStale = swapTakeBlock(toC, sw0.giveDate, today, win);
      if (takeStale.startsWith('conflict:')) {
        const n = Number(takeStale.split(':')[1]) || 1;
        return NextResponse.json({ ok: false, error: `You have ${n === 1 ? 'a client' : `${n} clients`} booked in that window. Move that booking first, then you can take this.` }, { status: 409 });
      }
      if (takeStale) return NextResponse.json({ ok: false, error: `You can’t take this — ${takeStale.toLowerCase()}.` }, { status: 409 });

      const takerSpan = swapTakerSpan(toC, sw0.giveDate, win);
      const giverRest = swapGiverRemainder(fromC, sw0.giveDate, win);
      const stamp = { reason: 'swap', swapId: ref.id, setAt: new Date().toISOString() };
      const winText = sw0.wholeDay ? 'the whole day' : `${fmtHM(win.start)}–${fmtHM(win.end)}`;

      try {
        await db.runTransaction(async (tx: any) => {
          const live = await tx.get(ref);
          if (!live.exists || (live.data() as any).status !== 'open') {
            throw new Error('ALREADY_TAKEN');
          }
          tx.set(db.doc(`tenants/${tenantId}/staff/${from.staffId}`), {
            availability: { dates: { [sw0.giveDate]: giverRest
              ? { enabled: true, start: giverRest.start, end: giverRest.end, ...stamp, note: `Gave ${winText} to ${to.name}` }
              : { enabled: false, ...stamp, note: `Swapped to ${to.name}` } } },
          }, { merge: true });
          tx.set(db.doc(`tenants/${tenantId}/staff/${to.staffId}`), {
            availability: { dates: { [sw0.giveDate]: { enabled: true, start: takerSpan.start, end: takerSpan.end, ...stamp, note: `Covering ${winText} for ${from.name}`, boothId: sw0.giveBoothId || null } } },
          }, { merge: true });
          tx.set(ref, {
            status: 'taken', toRenterId: to.renterId, toStaffId: to.staffId, toName: to.name,
            respondedAt: new Date().toISOString(),
            acceptedTakerStart: takerSpan.start, acceptedTakerEnd: takerSpan.end,
          }, { merge: true });
        });
      } catch (e: any) {
        if (String(e?.message) === 'ALREADY_TAKEN') {
          return NextResponse.json({ ok: false, error: 'Someone else got there first.' }, { status: 409 });
        }
        throw e;
      }

      const both = `${to.name} covers ${swapDateLabel(sw0.giveDate)}, ${winText}${giverRest ? `; ${from.name} still works ${fmtHM(giverRest.start)}–${fmtHM(giverRest.end)}` : ''}.`;
      for (const target of [from, to]) {
        await swapNotify(db, tenantId, tenant, target,
          `Covered — ${swapDateLabel(sw0.giveDate)}`, 'That day is covered',
          [both, 'Booking hours have already moved for that window only. Rent is unchanged — a swap trades time, not money.'],
          `Covered: ${both}`);
      }
      await swapTellOwner(db, tenantId,
        `${to.name} took ${from.name}'s offer for ${swapDateLabel(sw0.giveDate)}, ${winText}${sw0.giveBoothName ? ` (${sw0.giveBoothName})` : ''}. Rent unchanged.`);
      await logAuditAdmin(db, tenantId, {
        action: 'renter.swap_claimed', targetType: 'renterSwap', targetId: ref.id,
        summary: `${to.name} claimed ${from.name}'s open offer: ${sw0.giveDate} ${win.start}-${win.end} (rent unchanged)`,
        actor: { type: 'user', name: to.name, role: 'renter', via: 'renter-portal' },
      });
      return NextResponse.json({ ok: true, status: 'taken' });
    }

    // ═══ swap-cancel ════════════════════════════════════════════════════════
    if (action === 'swap-cancel') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const ref = db.doc(`tenants/${tenantId}/renterSwaps/${String(body.swapId || '')}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'That request is gone.' }, { status: 404 });
      const sw: any = snap.data();
      if (sw.fromRenterId !== session.renterId) {
        return NextResponse.json({ ok: false, error: 'That request isn’t yours to cancel.' }, { status: 403 });
      }
      if (sw.status !== 'pending' && sw.status !== 'open') {
        return NextResponse.json({ ok: false, error: 'That has already been answered.' }, { status: 409 });
      }
      await ref.set({ status: 'cancelled', respondedAt: new Date().toISOString() }, { merge: true });
      await logAuditAdmin(db, tenantId, {
        action: 'renter.swap_cancelled', targetType: 'renterSwap', targetId: ref.id,
        summary: `${sw.fromName} withdrew the swap request to ${sw.toName} for ${sw.giveDate}`,
        actor: { type: 'user', name: sw.fromName, role: 'renter', via: 'renter-portal' },
      });
      return NextResponse.json({ ok: true });
    }

    // ═══ check-in ═════════════════════════════════════════════════════════
    if (action === 'check-in') {
      const reservationId = String(body.reservationId || '');
      const today = safeToday(body.today);
      const ref = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
      const snap = await ref.get();
      const r = snap.exists ? (snap.data() as any) : null;
      if (!r || !contactMatches(key, r.phone, r.email)) {
        return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
      }
      if (r.status !== 'confirmed') {
        return NextResponse.json({ ok: false, error: `This booking can’t be checked in (status: ${String(r.status).replace(/_/g, ' ')}).` }, { status: 409 });
      }
      if (today < r.startDate || today > r.endDate) {
        return NextResponse.json({ ok: false, error: `This booking is for ${r.startDate}${r.endDate !== r.startDate ? ` – ${r.endDate}` : ''}.` }, { status: 409 });
      }
      // Rate snapshot — same as owner-side checkInRes (settle at the rate in
      // force during the stay, not whatever the booth costs later).
      let settleHourlyCents = r.settleHourlyCents || 0;
      if (!settleHourlyCents && r.boothId) {
        const b = await db.doc(`tenants/${tenantId}/booths/${r.boothId}`).get();
        settleHourlyCents = b.exists ? hourlyCentsOf(b.data()) : 0;
      }
      const nowIso = new Date().toISOString();
      await ref.set({
        status: 'checked_in',
        checked_inAt: nowIso,       // NOTE: underscore — matches every reader
        actualCheckIn: nowIso,
        settleHourlyCents,
        selfCheckIn: true,
      }, { merge: true });
      await logAuditAdmin(db, tenantId, {
        action: 'booth.renter_checked_in',
        targetType: 'boothReservation', targetId: reservationId,
        summary: `${r.name || 'Renter'} self-checked in to ${r.boothName || 'their space'} via renter portal`,
        actor: { type: 'user', name: r.name || session.name || null, role: 'renter', via: 'renter-portal' },
      });
      const notifRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await notifRef.set({
        id: notifRef.id, userId: null, read: false, createdAt: nowIso,
        type: 'booth_reservation', link: '/pos?tab=spaces',
        message: `${r.name || 'A renter'} checked in to ${r.boothName || 'their space'} (self check-in).`,
      });
      const needsBalance = (r.balanceDueCents || 0) > 0 && !r.balancePaid;
      return NextResponse.json({
        ok: true,
        reservation: safeReservation(reservationId, { ...r, status: 'checked_in', checked_inAt: nowIso, actualCheckIn: nowIso }),
        needsBalance,
        balanceDueCents: needsBalance ? r.balanceDueCents : 0,
        balanceMode: r.balanceMode || null,
      });
    }

    // ═══ check-out ════════════════════════════════════════════════════════
    if (action === 'check-out') {
      const reservationId = String(body.reservationId || '');
      const ref = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
      const snap = await ref.get();
      const r = snap.exists ? (snap.data() as any) : null;
      if (!r || !contactMatches(key, r.phone, r.email)) {
        return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
      }
      if (r.status !== 'checked_in') {
        return NextResponse.json({ ok: false, error: 'This booking isn’t checked in.' }, { status: 409 });
      }
      // Settlement math — mirrors owner-side checkOutRes exactly.
      const now = new Date();
      const updates: any = {
        status: 'completed',
        completedAt: now.toISOString(),
        actualCheckOut: now.toISOString(),
        selfCheckOut: true,
      };
      if (r.bookingType === 'hourly' && r.startTime && r.endTime && r.actualCheckIn) {
        const bookedEnd = new Date(`${r.startDate}T${r.endTime}:00`);
        let rate = r.settleHourlyCents > 0 ? r.settleHourlyCents : 0;
        if (!rate && r.boothId) {
          const b = await db.doc(`tenants/${tenantId}/booths/${r.boothId}`).get();
          rate = b.exists ? hourlyCentsOf(b.data()) : 0;
        }
        const GRACE_MS = 10 * 60 * 1000;
        const diffMs = now.getTime() - bookedEnd.getTime();
        if (diffMs > GRACE_MS && rate > 0) {
          const overQuarters = Math.ceil((diffMs - GRACE_MS) / (15 * 60 * 1000));
          updates.overageMinutes = overQuarters * 15;
          updates.overageDueCents = Math.round(rate * (overQuarters * 15) / 60);
          updates.overageStatus = 'due';
        } else if (diffMs < -(30 * 60 * 1000) && rate > 0) {
          const underQuarters = Math.floor(-diffMs / (15 * 60 * 1000));
          const creditCents = Math.round(rate * (underQuarters * 15) / 60);
          if (creditCents >= 100) {
            updates.unusedMinutes = underQuarters * 15;
            updates.potentialCreditCents = creditCents;
            updates.creditDecision = 'pending'; // owner approves — never auto-issued
          }
        }
      }
      await ref.set(updates, { merge: true });
      const bits: string[] = [];
      if (updates.overageDueCents) bits.push(`$${(updates.overageDueCents / 100).toFixed(2)} overage due (${updates.overageMinutes} min)`);
      if (updates.potentialCreditCents) bits.push(`$${(updates.potentialCreditCents / 100).toFixed(2)} potential credit pending review`);
      await logAuditAdmin(db, tenantId, {
        action: 'booth.renter_checked_out',
        targetType: 'boothReservation', targetId: reservationId,
        summary: `${r.name || 'Renter'} self-checked out of ${r.boothName || 'their space'} via renter portal${bits.length ? ` — ${bits.join(', ')}` : ''}`,
        amount: updates.overageDueCents ? updates.overageDueCents / 100 : undefined,
        actor: { type: 'user', name: r.name || session.name || null, role: 'renter', via: 'renter-portal' },
      });
      if (updates.overageDueCents || updates.potentialCreditCents) {
        const notifRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        await notifRef.set({
          id: notifRef.id, userId: null, read: false, createdAt: now.toISOString(),
          type: 'booth_reservation', link: '/pos?tab=spaces',
          message: `${r.name || 'A renter'} checked out of ${r.boothName || 'their space'} — ${bits.join(', ')}.`,
        });
      }
      return NextResponse.json({
        ok: true,
        reservation: safeReservation(reservationId, { ...r, ...updates }),
        overageDueCents: updates.overageDueCents || 0,
        overageMinutes: updates.overageMinutes || 0,
        potentialCreditCents: updates.potentialCreditCents || 0,
      });
    }

    // ═══ pay-invoice — Stripe Checkout for an open rent invoice ═══════════
    // Ownership chain verified server-side: invoice → lease → renter →
    // renter's contact must match this session. Works for every renter,
    // card on file or not (Checkout collects the card).
    // ── thread-list / thread-send: the renter's side of the conversation ───
    // Same thread the owner writes to from the renter card. A reply here is
    // documented the instant it is written, and the owner is told in-app —
    // no more "they texted me" with nothing on the record.
    if (action === 'thread-list') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const snap = await db.collection(`tenants/${tenantId}/renterThreads/${session.renterId}/messages`)
        .orderBy('createdAt', 'desc').limit(100).get();
      await db.doc(`tenants/${tenantId}/renterThreads/${session.renterId}`).set({ unreadForRenter: false, renterSeenAt: new Date().toISOString() }, { merge: true }).catch(() => {});
      return NextResponse.json({ ok: true, messages: snap.docs.map((d) => {
        const m = d.data() as any;
        return { id: d.id, direction: m.direction, text: m.text, byName: m.byName || null, createdAt: m.createdAt };
      }) });
    }
    if (action === 'thread-send') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const clean = String(body.text || '').trim().slice(0, 2000);
      if (!clean) return NextResponse.json({ ok: false, error: 'Write something first.' }, { status: 400 });
      const rSnap = await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).get();
      const r = (rSnap.data() as any) || {};
      const nowIso = new Date().toISOString();
      const mRef = db.collection(`tenants/${tenantId}/renterThreads/${session.renterId}/messages`).doc();
      await mRef.set({ id: mRef.id, renterId: session.renterId, direction: 'inbound', text: clean, byName: `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Renter', createdAt: nowIso });
      await db.doc(`tenants/${tenantId}/renterThreads/${session.renterId}`).set({
        renterId: session.renterId, lastAt: nowIso, lastText: clean.slice(0, 140), lastDirection: 'inbound', unreadForOwner: true,
      }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'renter_message', read: false, createdAt: nowIso, link: '/renters',
        message: `${r.firstName || 'A renter'} ${r.lastName || ''}: “${clean.slice(0, 90)}${clean.length > 90 ? '…' : ''}”`.replace(/\s+/g, ' ') });
      return NextResponse.json({ ok: true, id: mRef.id });
    }

    // ── autopay-set: the renter's own switch ───────────────────────────────
    // Same flag the owner flips on the renter card; this is their side of it.
    // Refused without a card on file, because an autopay with nothing to draft
    // from is a promise the shop cannot keep.
    if (action === 'autopay-set') {
      if (!session.renterId) return NextResponse.json({ ok: false, error: 'No renter on this session' }, { status: 403 });
      const rRef = db.doc(`tenants/${tenantId}/renters/${session.renterId}`);
      const rSnap = await rRef.get();
      const r = (rSnap.data() as any) || {};
      const on = body.enabled === true;
      const hasCard = !!(r.cardOnFile && r.stripeCustomerId && (r.stripePaymentMethodId || r.defaultPaymentMethodId));
      if (on && !hasCard) {
        return NextResponse.json({ ok: false, error: 'Add a card first — autopay needs one to draft from.' }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      await rRef.set({ autopayEnabled: on, autopayChangedAt: nowIso, autopayChangedBy: 'renter' }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'renter_autopay', read: false, createdAt: nowIso, link: '/rent',
        message: `${r.firstName || 'A renter'} ${r.lastName || ''} turned autopay ${on ? 'on' : 'off'} from their portal.`.replace(/\s+/g, ' ') });
      return NextResponse.json({ ok: true, autopayEnabled: on });
    }

    if (action === 'pay-invoice' || action === 'confirm-invoice') {
      const invoiceId = String(body.invoiceId || '');
      if (!invoiceId) return NextResponse.json({ ok: false, error: 'Missing invoice.' }, { status: 400 });
      if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ ok: false, error: 'Online payments aren’t set up yet — pay at the front desk.' }, { status: 400 });
      }
      const invRef = db.doc(`tenants/${tenantId}/rentInvoices/${invoiceId}`);
      const invSnap = await invRef.get();
      const inv = invSnap.exists ? (invSnap.data() as any) : null;
      if (!inv) return NextResponse.json({ ok: false, error: 'Invoice not found.' }, { status: 404 });
      const leaseSnap = inv.leaseId ? await db.doc(`tenants/${tenantId}/leases/${inv.leaseId}`).get() : null;
      const lease = leaseSnap?.exists ? (leaseSnap.data() as any) : null;
      const renterSnap = lease?.renterId ? await db.doc(`tenants/${tenantId}/renters/${lease.renterId}`).get() : null;
      const renter = renterSnap?.exists ? (renterSnap.data() as any) : null;
      if (!renter || !contactMatches(key, renter.phone, renter.email)) {
        return NextResponse.json({ ok: false, error: 'This invoice belongs to a different renter.' }, { status: 403 });
      }
      const renterName = `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'Renter';
      const totalCents = (inv.amountCents || 0) + (inv.lateFeeCents || 0);
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

      if (action === 'pay-invoice') {
        if (inv.status === 'paid') return NextResponse.json({ ok: true, alreadyPaid: true });
        if (!['due', 'late'].includes(inv.status)) {
          return NextResponse.json({ ok: false, error: 'This invoice isn’t open.' }, { status: 409 });
        }
        if (totalCents <= 0) return NextResponse.json({ ok: false, error: 'Nothing to pay.' }, { status: 400 });
        const returnUrl = String(body.returnUrl || '');
        if (!returnUrl) return NextResponse.json({ ok: false, error: 'Missing return URL.' }, { status: 400 });
        const base = returnUrl.split('?')[0];
        // Reuse the renter's Stripe customer if one exists (from setup-card or a
        // prior payment); otherwise create it now. The renter doc is the single
        // card-on-file store — paying rent online enrolls the card automatically,
        // so no separate setup step is needed for incidentals.
        let customerId: string | null = renter.stripeCustomerId || null;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: renter.email || undefined,
            name: renterName,
            metadata: { tenantId, renterId: lease?.renterId || '', leaseId: inv.leaseId || '' },
          });
          customerId = customer.id;
          if (lease?.renterId) {
            await db.doc(`tenants/${tenantId}/renters/${lease.renterId}`).set({ stripeCustomerId: customerId }, { merge: true });
          }
        }
        const checkout = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer: customerId,
          // Save the card for off-session incidental charges (hotel-style),
          // governed by the studio's capped incidentals policy.
          payment_intent_data: { setup_future_usage: 'off_session' },
          line_items: [{
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: totalCents,
              product_data: {
                name: `Booth rent — due ${String(inv.dueDate || '').slice(0, 10)}`,
                description: renterName + (inv.lateFeeCents > 0 ? ` · incl. $${(inv.lateFeeCents / 100).toFixed(2)} late fee` : ''),
              },
            },
          }],
          success_url: `${base}?cfInvoiceId=${invoiceId}&cfSession={CHECKOUT_SESSION_ID}`,
          cancel_url: base,
          metadata: { tenantId, invoiceId, kind: 'rent_invoice' },
        });
        await invRef.set({ stripeSessionId: checkout.id, paymentStartedAt: new Date().toISOString() }, { merge: true });
        return NextResponse.json({ ok: true, url: checkout.url });
      }

      // ═══ confirm-invoice — after Stripe redirects back ═════════════════
      if (inv.status === 'paid') return NextResponse.json({ ok: true, alreadyPaid: true });
      const sessionId = String(body.sessionId || '');
      if (!sessionId) return NextResponse.json({ ok: false, error: 'Missing session.' }, { status: 400 });
      const cs: any = await stripe.checkout.sessions.retrieve(sessionId);
      if (cs?.payment_status !== 'paid' || cs?.metadata?.invoiceId !== invoiceId) {
        return NextResponse.json({ ok: false, error: 'Payment not completed — nothing was charged.' }, { status: 402 });
      }
      const nowIso = new Date().toISOString();
      // Idempotent: refreshing the return page must never double-book income.
      const existing = await db.collection(`tenants/${tenantId}/transactions`)
        .where('sourceId', '==', invoiceId).get();
      let txnId = existing.docs.find((d: any) => (d.data() as any).type === 'income')?.id || null;
      if (!txnId) {
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        txnId = txnRef.id;
        await txnRef.set({
          id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
          source: 'booth_rent', category: 'Booth Rent',
          amount: totalCents / 100,
          description: `Booth rent — due ${String(inv.dueDate || '').slice(0, 10)} (paid online)${inv.lateFeeCents > 0 ? ` · incl. $${(inv.lateFeeCents / 100).toFixed(2)} late fee` : ''}`,
          clientOrVendor: renterName, date: nowIso, paymentMethod: 'Card (Stripe)',
          hasReceipt: false, sourceId: invoiceId,
          stripePaymentIntentId: cs.payment_intent || null,
          tenantId, createdAt: nowIso,
        });
        // Paired Stripe fee — fail-open, fee recording never blocks revenue.
        try {
          const pi: any = await stripe.paymentIntents.retrieve(String(cs.payment_intent), { expand: ['latest_charge.balance_transaction'] });
          const bt: any = pi?.latest_charge?.balance_transaction;
          const feeCents = bt?.fee ?? 0;
          if (feeCents > 0) {
            const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
            await feeRef.set({
              id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
              category: 'Processing Fee', amount: feeCents / 100,
              description: `Stripe fee — rent due ${String(inv.dueDate || '').slice(0, 10)}`,
              clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
              hasReceipt: false, relatedTxnId: txnId, sourceId: invoiceId, tenantId, createdAt: nowIso,
            });
          }
        } catch { /* fee is informational */ }
      }
      await invRef.set({
        status: 'paid', paidAt: nowIso, paidMethod: 'Card (Stripe)',
        paidAmountCents: totalCents, paidLedgerEntryId: txnId,
        stripePaymentIntentId: cs.payment_intent || null,
      }, { merge: true });
      // Save the card on file to the RENTER doc (the single card store the
      // studio's capped incidentals charge reads) so incidentals can be charged
      // off-session later. Best-effort — never blocks the receipt.
      try {
        if (lease?.renterId && cs.payment_intent) {
          const pi: any = await stripe.paymentIntents.retrieve(String(cs.payment_intent));
          const pmId = pi?.payment_method ? String(pi.payment_method) : null;
          const custId = pi?.customer ? String(pi.customer) : (cs.customer ? String(cs.customer) : null);
          if (pmId) {
            let brand = 'card', last4 = '';
            try {
              const pm: any = await stripe.paymentMethods.retrieve(pmId);
              brand = pm?.card?.brand || 'card';
              last4 = pm?.card?.last4 || '';
            } catch { /* card summary is cosmetic */ }
            await db.doc(`tenants/${tenantId}/renters/${lease.renterId}`).set({
              stripeCustomerId: custId || renter.stripeCustomerId || null,
              stripePaymentMethodId: pmId,
              cardOnFile: true,
              cardBrand: brand,
              cardLast4: last4,
              cardSetupAt: nowIso,
            }, { merge: true });
          }
        }
      } catch { /* card-on-file capture is best-effort */ }
      await logAuditAdmin(db, tenantId, {
        action: 'rent.paid_online', targetType: 'rentInvoice', targetId: invoiceId,
        summary: `${renterName} paid $${(totalCents / 100).toFixed(2)} rent online (due ${String(inv.dueDate || '').slice(0, 10)})`,
        amount: totalCents / 100,
        actor: { type: 'user', name: renterName, role: 'renter', via: 'renter-portal' },
      });
      const payNotif = db.collection(`tenants/${tenantId}/notifications`).doc();
      await payNotif.set({
        id: payNotif.id, userId: null, read: false, createdAt: nowIso,
        type: 'rent_paid', link: '/rent',
        message: `💚 ${renterName} paid $${(totalCents / 100).toFixed(2)} rent online.`,
      });
      return NextResponse.json({ ok: true, paidCents: totalCents });
    }

    // ═══ request-reschedule ═══════════════════════════════════════════════
    if (action === 'request-reschedule') {
      const reservationId = String(body.reservationId || '');
      const note = String(body.note || '').slice(0, 300);
      const ref = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
      const snap = await ref.get();
      const r = snap.exists ? (snap.data() as any) : null;
      if (!r || !contactMatches(key, r.phone, r.email)) {
        return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
      }
      if (r.status !== 'confirmed') {
        return NextResponse.json({ ok: false, error: 'Only upcoming confirmed bookings can be rescheduled.' }, { status: 409 });
      }
      const nowIso = new Date().toISOString();
      await ref.set({ rescheduleRequestedAt: nowIso, rescheduleRequestNote: note || null }, { merge: true });
      await logAuditAdmin(db, tenantId, {
        action: 'booth.reschedule_requested', targetType: 'boothReservation', targetId: reservationId,
        summary: `${r.name || 'Renter'} asked to move their ${r.boothName || 'space'} booking (${r.startDate}${r.startTime ? ` ${r.startTime}` : ''})${note ? ` — “${note}”` : ''}`,
        actor: { type: 'user', name: r.name || session.name || null, role: 'renter', via: 'renter-portal' },
      });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({
        id: nRef.id, userId: null, read: false, createdAt: nowIso,
        type: 'booth_reservation', link: '/pos?tab=spaces',
        message: `${r.name || 'A renter'} wants to reschedule ${r.boothName || 'their space'} (${r.startDate})${note ? `: “${note}”` : ''} — use Reschedule on their booking card.`,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[portal/renter] failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — try again.' }, { status: 500 });
  }
}
