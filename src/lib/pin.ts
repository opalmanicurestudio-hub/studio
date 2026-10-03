// src/lib/pin.ts — STAFF PINS, CHECKED ONLY ON THE SERVER.
// Every screen that asks for a PIN (time clock, floor, kitchen screen, till, refunds, inventory vault, Staff page,
// staff portal, approvals) sends it here; no device ever downloads PINs. One way of storing them: scrambled with a
// server-only secret (HMAC) in tenants/{t}/staffSecrets/{staffId}, which the database rules block from every device.
// Older stores are still recognised so nobody is locked out — plain text and a sha256 `pinHash` on staff records,
// the sha256 `private/pinIndex`, `staff/{id}/private/auth` — and each is converted the first time that PIN is used,
// then deleted. `migrateTenantPins` converts a whole business at once.
import { createHash } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { pinHash } from '@/lib/approvals';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const validPin = (pin: any) => /^\d{4}$/.test(String(pin || ''));
const WINDOW_MS = 15 * 60 * 1000; const MAX_FAILS = 10;

/** Too many wrong PINs on this business recently? (A shared tablet is the realistic attacker — 10 tries per 15 min.) */
export async function pinLocked(db: any, tenantId: string): Promise<boolean> {
  const d: any = (await db.doc(`tenants/${tenantId}/private/pinGuard`).get()).data() || {};
  return ((d.failedAt || []) as number[]).filter((t) => Date.now() - t < WINDOW_MS).length >= MAX_FAILS;
}
export async function recordPinAttempt(db: any, tenantId: string, ok: boolean) {
  const ref = db.doc(`tenants/${tenantId}/private/pinGuard`); const d: any = (await ref.get()).data() || {};
  const prior = ((d.failedAt || []) as number[]).filter((t) => Date.now() - t < WINDOW_MS);
  await ref.set({ failedAt: ok ? [] : [...prior, Date.now()].slice(-30) }, { merge: true });
}

/** Store this PIN the one strong way, and remove every older copy for this person. */
async function storeStrong(db: any, tenantId: string, staffId: string, pin: string) {
  const T = `tenants/${tenantId}`; const now = new Date().toISOString();
  await db.doc(`${T}/staffSecrets/${staffId}`).set({ pinHash: pinHash(tenantId, pin), updatedAt: now }, { merge: true });
  await db.doc(`${T}/staff/${staffId}`).set({ pin: FieldValue.delete(), pinHash: FieldValue.delete(), hasPin: true, pinUpdatedAt: now }, { merge: true });
  await db.doc(`${T}/staff/${staffId}/private/auth`).delete().catch(() => null);
  const idxRef = db.doc(`${T}/private/pinIndex`); const idx: any = (await idxRef.get()).data();
  if (idx) { const left: any = {}; for (const [h, id] of Object.entries(idx)) if (id !== staffId) left[h] = id; await idxRef.set(left); }
}

/** Whose PIN is this? Strong store first; older stores are recognised once and converted on the spot. */
export async function findStaffByPin(db: any, tenantId: string, pin: string): Promise<{ id: string; name: string; role: string; data: any } | null> {
  if (!validPin(pin)) return null;
  const T = `tenants/${tenantId}`; let id: string | null = null; let legacy = false;
  id = (await db.collection(`${T}/staffSecrets`).where('pinHash', '==', pinHash(tenantId, pin)).limit(1).get()).docs[0]?.id || null;
  if (!id) { const idx: any = (await db.doc(`${T}/private/pinIndex`).get()).data() || {}; if (idx[sha256(pin)]) { id = idx[sha256(pin)]; legacy = true; } }
  if (!id) { const q = await db.collection(`${T}/staff`).where('pin', '==', pin).limit(1).get(); if (!q.empty) { id = q.docs[0].id; legacy = true; } }
  if (!id) { const q = await db.collection(`${T}/staff`).where('pinHash', '==', sha256(pin)).limit(1).get(); if (!q.empty) { id = q.docs[0].id; legacy = true; } }
  if (!id) return null;
  const snap = await db.doc(`${T}/staff/${id}`).get(); const st: any = snap.exists ? snap.data() : null;
  if (!st || st.isActive === false || st.status === 'archived') return null;
  if (legacy) await storeStrong(db, tenantId, id, pin).catch(() => null);   // converted, older copies deleted
  return { id, name: st.name || [st.firstName, st.lastName].filter(Boolean).join(' ') || 'Team member', role: String(st.role || ''), data: st };
}

/** Set someone's PIN. Never reveals whose PIN a taken one is. */
export async function setStaffPin(db: any, tenantId: string, staffId: string, pin: string, opts: { checkOnly?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  if (!validPin(pin)) return { ok: false, error: 'A PIN is 4 digits.' };
  const taken = await findStaffByPin(db, tenantId, pin);
  if (taken && taken.id !== staffId) return { ok: false, error: 'That PIN is already in use — choose another.' };
  if (opts.checkOnly) return { ok: true };
  if (!(await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).exists) return { ok: false, error: 'Team member not found.' };
  await storeStrong(db, tenantId, staffId, pin);
  return { ok: true };
}

/** Convert a whole business: every plain-text PIN moves to the strong store and is deleted from staff records. PINs
 *  that only exist as an older sha256 can't be converted without the PIN itself — they stay recognised (server-side
 *  only) and convert the first time they're used. */
export async function migrateTenantPins(db: any, tenantId: string) {
  const T = `tenants/${tenantId}`; let converted = 0, waiting = 0;
  const idxRef = db.doc(`${T}/private/pinIndex`); const idx: any = (await idxRef.get()).data() || {};
  for (const d of (await db.collection(`${T}/staff`).get()).docs) {
    const s: any = d.data() || {};
    if (s.pin && validPin(s.pin)) { await storeStrong(db, tenantId, d.id, String(s.pin)); converted++; delete idx[sha256(String(s.pin))]; continue; }
    if (s.pinHash) { idx[s.pinHash] = d.id; await d.ref.set({ pinHash: FieldValue.delete(), hasPin: true }, { merge: true }); waiting++; }
  }
  await idxRef.set(idx);
  await db.doc(T).set({ pinsPrivate: true, pinsMigratedAt: new Date().toISOString() }, { merge: true });
  return { converted, waiting };
}
