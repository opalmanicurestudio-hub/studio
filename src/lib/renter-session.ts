// src/lib/renter-session.ts — who's signed in to the renter portal (/rent). The portal's code login keeps hashed
// session tokens in tenants/{t}/private/renterSessions (made by /api/portal/renter); this reads them for other routes.
import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function renterSession(db: any, tenantId: string, token: any): Promise<{ renterId: string; name: string | null } | null> {
  if (!tenantId || !token || typeof token !== 'string') return null;
  const snap = await db.doc(`tenants/${tenantId}/private/renterSessions`).get();
  const e: any = ((snap.data() as any) || {})[sha256(token)] || null;
  if (!e || !(e.expiresAt > Date.now()) || !e.renterId) return null;
  return { renterId: String(e.renterId), name: e.name || null };
}

/** The renter's provider (staff) record — what documents, bookings and services hang off. */
export async function renterStaff(db: any, tenantId: string, renterId: string): Promise<any | null> {
  const s = await db.collection(`tenants/${tenantId}/staff`).where('renterId', '==', renterId).limit(1).get();
  return s.empty ? null : { id: s.docs[0].id, ...(s.docs[0].data() || {}) };
}
