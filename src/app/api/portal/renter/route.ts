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
import { createHash, randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';

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
  const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
  await ref.set({
    id: ref.id,
    userId: null, // owners/admins inbox
    read: false,
    createdAt: new Date().toISOString(),
    type: 'renter_code',
    link: 'inbox',
    message: `Renter portal code for ${name ? `${name} (${maskContact(contact)})` : maskContact(contact)}: ${code} — valid 10 minutes. Share it with the renter in person only.`,
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
});

const hourlyCentsOf = (booth: any): number => {
  const opts = Array.isArray(booth?.pricingOptions) ? booth.pricingOptions : [];
  return opts.find((o: any) => o.frequency === 'hourly' && o.amountCents > 0)?.amountCents || 0;
};

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
      await logAuditAdmin(db, tenantId, {
        action: 'portal.renter_login',
        targetType: 'renterContact', targetId: maskContact(raw),
        summary: `${entry.name || maskContact(raw)} signed in to the renter portal`,
        actor: { type: 'user', name: entry.name || null, role: 'renter', via: 'renter-portal' },
      });
      return NextResponse.json({ ok: true, token: session.token, expiresAt: session.expiresAt, name: entry.name || null });
    }

    // ═══ Everything below requires a session ══════════════════════════════
    const session = await resolveSession(db, tenantId, body.token);
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Session expired — sign in again.' }, { status: 401 });
    }
    const key = session.contactKey;

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
      });
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
        type: 'booth_reservation', link: '/booths',
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
          type: 'booth_reservation', link: '/booths',
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

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[portal/renter] failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — try again.' }, { status: 500 });
  }
}
