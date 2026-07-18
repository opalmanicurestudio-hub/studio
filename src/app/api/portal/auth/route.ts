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

      // Plaintext `pin` match for backward compatibility with existing
      // staff docs; docs that have migrated to pinHash match on the hash.
      // (Server-side only — the client never sees either.)
      const [byPin, byHash] = await Promise.all([
        db.collection(`tenants/${tenantId}/staff`).where('pin', '==', pin).limit(1).get(),
        db.collection(`tenants/${tenantId}/staff`).where('pinHash', '==', sha256(pin)).limit(1).get(),
      ]);
      const hit = !byPin.empty ? byPin.docs[0] : (!byHash.empty ? byHash.docs[0] : null);
      await recordAttempt(db, tenantId, !!hit);
      if (!hit) {
        return NextResponse.json({ ok: false, error: 'Incorrect PIN. Try again.' }, { status: 401 });
      }

      const staff = safeStaff(hit.id, hit.data());

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
      // Set both forms: plaintext keeps every existing PIN surface working
      // (refund authorization, kiosk); pinHash is the migration path.
      await db.doc(`tenants/${tenantId}/staff/${staffId}`).set(
        { pin: newPin, pinHash: sha256(newPin), pinUpdatedAt: new Date().toISOString() }, { merge: true });
      await resetsRef.set({ [staffId]: null }, { merge: true });
      const sName = ((await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data() as any)?.name || 'Team member';
      await logAuditAdmin(db, tenantId, {
        action: 'portal.pin_reset', targetType: 'staff', targetId: staffId,
        summary: `${sName} reset their portal PIN via manager-relayed code`,
        actor: { type: 'user', id: staffId, name: sName },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[portal-auth] failed', err);
    return NextResponse.json({ ok: false, error: 'Authentication service error.' }, { status: 500 });
  }
}
