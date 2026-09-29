// src/lib/approvals.ts — MANAGER APPROVALS, CHECKED ON THE SERVER.
// Approvals used to be checked in the browser (and one prompt accepted ANY staff member's PIN). Now the PIN is
// checked HERE, and a successful approval is
// a SINGLE-USE token, tied to what it's for (a waiver for this visit, recovery up to $X, a void…) and valid for
// 10 minutes — the server refuses the action without one.
import crypto from 'crypto';

export const APPROVER_ROLES = ['owner', 'admin', 'manager'];
export const isApprover = (role: any) => APPROVER_ROLES.includes(String(role || '').toLowerCase());
export const pinHash = (tenantId: string, pin: string) =>
  crypto.createHmac('sha256', process.env.PIN_PEPPER || process.env.CRON_SECRET || 'clarityflow-pin').update(`${tenantId}:${String(pin).trim()}`).digest('hex');

/** Whose PIN is this? Checked on the server. (PINs still live on staff records for now — the time clock, floor and
 *  kitchen screens, till, portal login and more read them; moving every one of those to the server, then removing PINs
 *  from staff records, is its own task. A scrambled copy in staffSecrets is used first when one exists.) */
export async function findByPin(db: any, tenantId: string, pin: string): Promise<{ id: string; name: string; role: string } | null> {
  if (!/^\d{4,8}$/.test(String(pin || ''))) return null;
  const T = `tenants/${tenantId}`;
  let id: string | null = (await db.collection(`${T}/staffSecrets`).where('pinHash', '==', pinHash(tenantId, pin)).get()).docs[0]?.id || null;
  if (!id) id = (await db.collection(`${T}/staff`).where('pin', '==', String(pin)).get()).docs[0]?.id || null;
  if (!id) return null;
  const st: any = (await db.doc(`${T}/staff/${id}`).get()).data();
  if (!st || st.isActive === false) return null;
  return { id, name: st.name || 'Manager', role: String(st.role || '') };
}

export async function issueApproval(db: any, tenantId: string, a: { kind: string; amount?: number | null; ref?: string | null; reason?: string | null; approver: { id: string; name: string; role?: string }; requestedBy?: { id?: string; name?: string } | null; via: 'pin' | 'phone' | 'self' }) {
  const ref = db.collection(`tenants/${tenantId}/approvals`).doc();
  const now = Date.now();
  await ref.set({ id: ref.id, kind: a.kind, amount: a.amount ?? null, ref: a.ref ?? null, reason: a.reason ?? null, status: 'approved', approverId: a.approver.id, approverName: a.approver.name,
    requestedBy: a.requestedBy?.name || null, requestedById: a.requestedBy?.id || null, via: a.via, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 10 * 60000).toISOString(), used: false });
  return ref.id;
}

/** Use an approval once: it must be for this kind (and this visit / at least this amount), unused and in date. */
export async function consumeApproval(db: any, tenantId: string, id: any, need: { kind: string; amount?: number; ref?: string }): Promise<{ approverId: string; approverName: string; reason: string | null } | null> {
  if (!id || typeof id !== 'string') return null;
  const ref = db.doc(`tenants/${tenantId}/approvals/${id}`);
  return db.runTransaction(async (tx: any) => {
    const a: any = (await tx.get(ref)).data();
    if (!a || a.status !== 'approved' || a.used || a.kind !== need.kind || Date.parse(a.expiresAt) < Date.now()) return null;
    if (need.ref && a.ref && a.ref !== need.ref) return null;
    if (need.amount !== undefined && a.amount !== null && a.amount !== undefined && Number(a.amount) + 0.005 < Number(need.amount)) return null;
    tx.set(ref, { used: true, usedAt: new Date().toISOString() }, { merge: true });
    return { approverId: a.approverId, approverName: a.approverName, reason: a.reason || null };
  });
}
