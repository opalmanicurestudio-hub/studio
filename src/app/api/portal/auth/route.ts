// src/app/api/portal/auth/route.ts
//
// v76 — Server-side portal authentication. Replaces two client-side holes:
//   1. PIN login was a client Firestore query (the whole staff roster —
//      PINs included — had to be client-readable, and 4-digit PINs were
//      brute-forceable with no rate limit).
//   2. "Forgot PIN" granted a FULL session from name + last-4-of-phone —
//      both semi-public facts.
//
// Actions (POST { action, tenantId, ... }):
//   login          → { pin } — rate-limited server-side PIN check.
//                    Returns a SAFE staff subset (no pin/phone/email) and,
//                    when firebase-admin auth is available, a Firebase
//                    custom token with tenant/role claims for signing into
//                    the client SDK (lets Firestore rules actually scope).
//   request-reset  → { name } — generates a 6-digit code (10-min expiry,
//                    stored hashed). Until an SMS provider is wired, the
//                    code is delivered as a notification to owners/admins,
//                    who relay it to the team member — manager-mediated
//                    reset instead of a self-service bypass.
//   confirm-reset  → { staffId, code, newPin } — verifies the code, sets
//                    the new PIN, audits.
//
// Rate limiting: per-tenant sliding window in tenants/{id}/private/portalAuth
// — 5 failed logins in 15 minutes locks logins for 15 minutes. Reset codes:
// 5 attempts max per code.

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

const maskPhone = (p?: string) => {
  const digits = (p || '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••-${digits.slice(-4)}` : null;
};
const maskEmail = (e?: string) => {
  if (!e || !e.includes('@')) return null;
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}•••@${d}`;
};

/** Safe subset — the client never receives pin/phone/email/etc. */
const safeStaff = (id: string, s: any) => ({
  id,
  name: s.name || '',
  role: s.role || 'staff',
  isRenter: !!s.isRenter || s.role === 'renter',
  linkedStaffId: s.linkedStaffId || null,
  avatarUrl: s.avatarUrl || null,
  payStructure: s.payStructure || null,
  commissionRate: s.commissionRate ?? null,
  retailCommissionRate: s.retailCommissionRate ?? null,
  hourlyRate: s.hourlyRate ?? null,
});

async function checkRateLimit(db: any, tenantId: string): Promise<{ locked: boolean }> {
  const ref = db.doc(`tenants/${tenantId}/private/portalAuth`);
  const snap = await ref.get();
  const fails: number[] = ((snap.data() as any)?.failedAt || [])
    .filter((t: number) => Date.now() - t < WINDOW_MS);
  return { locked: fails.length >= MAX_FAILS };
}
async function recordAttempt(db: any, tenantId: string, ok: boolean) {
  const ref = db.doc(`tenants/${tenantId}/private/portalAuth`);
  const snap = await ref.get();
  const prior: number[] = ((snap.data() as any)?.failedAt || [])
    .filter((t: number) => Date.now() - t < WINDOW_MS);
  await ref.set({ failedAt: ok ? [] : [...prior, Date.now()].slice(-20) }, { merge: true });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId } = body || {};
    if (!tenantId || !action) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();

    // ── LOGIN ──────────────────────────────────────────────────────────
    if (action === 'login') {
      const pin = String(body.pin || '');
      if (!/^\d{4}$/.test(pin)) return NextResponse.json({ ok: false, error: 'Enter a 4-digit PIN.' }, { status: 400 });

      const { locked } = await checkRateLimit(db, tenantId);
      if (locked) {
        return NextResponse.json({ ok: false, error: 'Too many attempts — locked for 15 minutes. Use Forgot PIN or ask a manager.' }, { status: 423 });
      }

      // v79 — PIN lookup order:
      //  1. pinIndex (tenants/{id}/private/pinIndex — server-only, written
      //     by the migrate-pins action): hash → staffId, one doc read.
      //  2. Legacy fallback for unmigrated tenants: plaintext/pinHash
      //     queries on staff docs.
      let hitId: string | null = null;
      let hitData: any = null;
      const idx = ((await db.doc(`tenants/${tenantId}/private/pinIndex`).get()).data() as any) || null;
      if (idx && idx[sha256(pin)]) {
        hitId = idx[sha256(pin)];
        const s = await db.doc(`tenants/${tenantId}/staff/${hitId}`).get();
        if (s.exists) hitData = s.data(); else hitId = null;
      }
      if (!hitId) {
        const [byPin, byHash] = await Promise.all([
          db.collection(`tenants/${tenantId}/staff`).where('pin', '==', pin).limit(1).get(),
          db.collection(`tenants/${tenantId}/staff`).where('pinHash', '==', sha256(pin)).limit(1).get(),
        ]);
        const hit = !byPin.empty ? byPin.docs[0] : (!byHash.empty ? byHash.docs[0] : null);
        if (hit) { hitId = hit.id; hitData = hit.data(); }
      }
      await recordAttempt(db, tenantId, !!hitId);
      if (!hitId) {
        return NextResponse.json({ ok: false, error: 'Incorrect PIN. Try again.' }, { status: 401 });
      }

      const staff = safeStaff(hitId, hitData);

      // Best-effort Firebase custom token — lets the client sign into the
      // SDK with tenant/role claims so Firestore rules can enforce scope.
      let customToken: string | null = null;
      try {
        const { getAuth } = await import('firebase-admin/auth');
        customToken = await getAuth().createCustomToken(`portal:${tenantId}:${staff.id}`, {
          tenantId, staffId: staff.id, role: staff.role, isRenter: staff.isRenter, portal: true,
        });
      } catch { customToken = null; /* admin auth not configured — login still works */ }

      await logAuditAdmin(db, tenantId, {
        action: 'portal.login', targetType: 'staff', targetId: staff.id,
        summary: `${staff.name || 'Team member'} signed into the portal`,
        actor: { type: 'user', id: staff.id, name: staff.name, role: staff.role },
      });
      return NextResponse.json({ ok: true, staff, customToken });
    }

    // ── REQUEST RESET ──────────────────────────────────────────────────
    if (action === 'request-reset') {
      const name = String(body.name || '').trim().toLowerCase();
      if (name.length < 2) return NextResponse.json({ ok: false, error: 'Enter your name.' }, { status: 400 });

      const all = await db.collection(`tenants/${tenantId}/staff`).get();
      const match = all.docs.find((d: any) => ((d.data().name || '') as string).toLowerCase().includes(name));
      // Same response whether found or not — no roster probing.
      if (!match) return NextResponse.json({ ok: true, sent: true, staffId: null, contactHint: null });

      const s = match.data() as any;
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const nowIso = new Date().toISOString();
      await db.doc(`tenants/${tenantId}/private/pinResets`).set({
        [match.id]: { codeHash: sha256(code), expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0, createdAt: nowIso },
      }, { merge: true });

      // TODO(sms): send `code` directly to s.phone via your SMS provider.
      // Until then: manager-mediated — owners/admins get the code as a
      // portal notification and relay it in person.
      const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
      const managers = staffSnap.docs.filter((d: any) => ['owner', 'admin'].includes((d.data() as any).role));
      for (const m of managers) {
        const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        await nRef.set({
          id: nRef.id, userId: m.id, read: false, createdAt: nowIso, type: 'pin_reset', link: 'inbox',
          message: `🔐 PIN reset requested by ${s.name}. Their code: ${code} (expires in 10 min). Share it with them in person.`,
        });
      }
      await logAuditAdmin(db, tenantId, {
        action: 'portal.pin_reset_requested', targetType: 'staff', targetId: match.id,
        summary: `PIN reset code issued for ${s.name} (delivered to ${managers.length} manager${managers.length === 1 ? '' : 's'})`,
        actor: { type: 'system', name: 'portal-auth' },
      });
      return NextResponse.json({ ok: true, sent: true, staffId: match.id, contactHint: maskPhone(s.phone) || maskEmail(s.email) });
    }

    // ── CONFIRM RESET ──────────────────────────────────────────────────
    if (action === 'confirm-reset') {
      const { staffId } = body;
      const code = String(body.code || '');
      const newPin = String(body.newPin || '');
      if (!staffId || !/^\d{6}$/.test(code) || !/^\d{4}$/.test(newPin)) {
        return NextResponse.json({ ok: false, error: 'Enter the 6-digit code and a new 4-digit PIN.' }, { status: 400 });
      }
      const resetsRef = db.doc(`tenants/${tenantId}/private/pinResets`);
      const resets = ((await resetsRef.get()).data() as any) || {};
      const entry = resets[staffId];
      if (!entry || Date.now() > entry.expiresAt) {
        return NextResponse.json({ ok: false, error: 'Code expired — request a new one.' }, { status: 400 });
      }
      if ((entry.attempts || 0) >= 5) {
        return NextResponse.json({ ok: false, error: 'Too many tries — request a new code.' }, { status: 423 });
      }
      if (entry.codeHash !== sha256(code)) {
        await resetsRef.set({ [staffId]: { ...entry, attempts: (entry.attempts || 0) + 1 } }, { merge: true });
        return NextResponse.json({ ok: false, error: 'Wrong code. Check with your manager.' }, { status: 401 });
      }
      // v79 — maintain all PIN stores consistently:
      //  - private/pinIndex + staff/{id}/private/auth: the target state
      //  - plaintext on the staff doc: kept ONLY until the tenant has run
      //    migrate-pins with removePlaintext (pinsPrivate flag) — then
      //    never written again.
      const pinsPrivate = !!((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.pinsPrivate;
      const oldHashEntries = ((await db.doc(`tenants/${tenantId}/private/pinIndex`).get()).data() as any) || {};
      const cleaned: any = {};
      for (const [h, sid] of Object.entries(oldHashEntries)) if (sid !== staffId) cleaned[h] = sid;
      cleaned[sha256(newPin)] = staffId;
      await db.doc(`tenants/${tenantId}/private/pinIndex`).set(cleaned);
      await db.doc(`tenants/${tenantId}/staff/${staffId}/private/auth`).set(
        { pinHash: sha256(newPin), updatedAt: new Date().toISOString() }, { merge: true });
      await db.doc(`tenants/${tenantId}/staff/${staffId}`).set(
        pinsPrivate
          ? { pinHash: sha256(newPin), pinUpdatedAt: new Date().toISOString() }
          : { pin: newPin, pinHash: sha256(newPin), pinUpdatedAt: new Date().toISOString() },
        { merge: true });
      await resetsRef.set({ [staffId]: null }, { merge: true });
      const sName = ((await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data() as any)?.name || 'Team member';
      await logAuditAdmin(db, tenantId, {
        action: 'portal.pin_reset', targetType: 'staff', targetId: staffId,
        summary: `${sName} reset their portal PIN via manager-relayed code`,
        actor: { type: 'user', id: staffId, name: sName },
      });
      return NextResponse.json({ ok: true });
    }

    // ── VERIFY MANAGER (v79) ───────────────────────────────────────────
    // Server-side replacement for client code that compared s.pin directly
    // (refund authorization). Returns the manager identity ONLY for
    // owner/admin PINs. Shares the login rate limiter.
    if (action === 'verify-manager') {
      const pin = String(body.pin || '');
      if (!/^\d{4}$/.test(pin)) return NextResponse.json({ ok: false, error: 'Enter a 4-digit PIN.' }, { status: 400 });
      const { locked } = await checkRateLimit(db, tenantId);
      if (locked) return NextResponse.json({ ok: false, error: 'Too many attempts — locked for 15 minutes.' }, { status: 423 });

      let hitId: string | null = null;
      let hitData: any = null;
      const idx = ((await db.doc(`tenants/${tenantId}/private/pinIndex`).get()).data() as any) || null;
      if (idx && idx[sha256(pin)]) {
        hitId = idx[sha256(pin)];
        const s = await db.doc(`tenants/${tenantId}/staff/${hitId}`).get();
        if (s.exists) hitData = s.data(); else hitId = null;
      }
      if (!hitId) {
        const [byPin, byHash] = await Promise.all([
          db.collection(`tenants/${tenantId}/staff`).where('pin', '==', pin).limit(1).get(),
          db.collection(`tenants/${tenantId}/staff`).where('pinHash', '==', sha256(pin)).limit(1).get(),
        ]);
        const hit = !byPin.empty ? byPin.docs[0] : (!byHash.empty ? byHash.docs[0] : null);
        if (hit) { hitId = hit.id; hitData = hit.data(); }
      }
      const role = hitData?.role;
      const isManager = !!hitId && (role === 'owner' || role === 'admin');
      await recordAttempt(db, tenantId, isManager);
      if (!isManager) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
      return NextResponse.json({ ok: true, manager: { id: hitId, name: hitData?.name || '', role } });
    }

    // ── MIGRATE PINS (v79 — step 4 of the rules migration) ─────────────
    // Builds the server-only pinIndex + per-staff private/auth docs from
    // current PINs. Phase A (no flag): dual state — plaintext stays so
    // every un-migrated PIN surface keeps working. Phase B
    // ({ removePlaintext: true }, requires the CRON_SECRET bearer):
    // deletes plaintext `pin` from staff docs and sets tenants/{id}
    // .pinsPrivate=true so resets never write plaintext again. Run B only
    // after every PIN surface (kiosk, timeclock, floor) verifies via API.
    if (action === 'migrate-pins') {
      const remove = body.removePlaintext === true;
      if (remove) {
        const secret = process.env.CRON_SECRET;
        if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
          return NextResponse.json({ ok: false, error: 'removePlaintext requires the CRON_SECRET bearer token.' }, { status: 401 });
        }
      }
      const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
      const index: Record<string, string> = {};
      let indexed = 0, cleaned = 0;
      for (const d of staffSnap.docs) {
        const s = d.data() as any;
        const hash = s.pin ? sha256(String(s.pin)) : (s.pinHash || null);
        if (!hash) continue;
        index[hash] = d.id;
        await db.doc(`tenants/${tenantId}/staff/${d.id}/private/auth`).set(
          { pinHash: hash, updatedAt: new Date().toISOString() }, { merge: true });
        indexed++;
        if (remove && s.pin) {
          const { FieldValue } = await import('firebase-admin/firestore');
          await d.ref.update({ pin: FieldValue.delete(), pinHash: hash });
          cleaned++;
        }
      }
      await db.doc(`tenants/${tenantId}/private/pinIndex`).set(index);
      if (remove) await db.doc(`tenants/${tenantId}`).set({ pinsPrivate: true }, { merge: true });
      await logAuditAdmin(db, tenantId, {
        action: 'portal.pins_migrated', targetType: 'staff',
        summary: `PIN privacy migration: ${indexed} PIN${indexed === 1 ? '' : 's'} indexed server-side${remove ? `, ${cleaned} plaintext PINs removed from staff docs` : ' (plaintext kept — compatibility phase)'}`,
        actor: { type: 'system', name: 'pin-migration' },
      });
      return NextResponse.json({ ok: true, indexed, plaintextRemoved: remove ? cleaned : 0 });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[portal-auth] failed', err);
    return NextResponse.json({ ok: false, error: 'Authentication service error.' }, { status: 500 });
  }
}
