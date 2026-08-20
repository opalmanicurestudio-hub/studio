/**
 * staff-auth — one verified answer to "who is calling, and may they do this?"
 *
 * Every route that changes a tenant's data from a staff surface should start
 * here. It mirrors the Firestore rules exactly (isStaff / isManager) so a
 * route can never be more permissive than the database itself:
 *
 *   staff   = the tenant owner (tenants/{id}.userId) OR a staff doc at
 *             tenants/{id}/staff/{uid}
 *   manager = the tenant owner OR a staff doc whose role is owner, admin
 *             or manager
 *
 * The actor's NAME comes from the verified staff document, never from the
 * request body. An audit line that records a name the server never checked
 * is worse than no audit line, because it reads as fact.
 */

import type { NextRequest } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';

export const MANAGER_ROLES = ['owner', 'admin', 'manager'] as const;

export type StaffActor = {
  uid: string;
  name: string;
  role: string;
  isManager: boolean;
  isTenantOwner: boolean;
};

export type StaffAuthResult =
  | { ok: true; actor: StaffActor }
  | { ok: false; error: string; status: number };

export async function verifyStaffActor(
  req: NextRequest,
  tenantId: string,
): Promise<StaffAuthResult> {
  const header = req.headers.get('authorization') || '';
  const idToken = header.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) {
    return { ok: false, error: 'Sign in to record that decision.', status: 401 };
  }

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return { ok: false, error: 'Your session expired — sign in and try again.', status: 401 };
  }

  const db = getAdminDb();
  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  if (!tenantSnap.exists) {
    return { ok: false, error: 'Studio not found.', status: 404 };
  }

  const staffSnap = await db.doc(`tenants/${tenantId}/staff/${uid}`).get();
  const staff = staffSnap.exists ? (staffSnap.data() as any) : null;
  const isTenantOwner = (tenantSnap.data() as any)?.userId === uid;

  if (!isTenantOwner && !staff) {
    return { ok: false, error: 'You do not have access to this studio.', status: 403 };
  }

  const role = String(staff?.role || (isTenantOwner ? 'owner' : 'staff'));
  return {
    ok: true,
    actor: {
      uid,
      name: String(staff?.name || (isTenantOwner ? 'The owner' : 'A team member')).slice(0, 80),
      role,
      isManager: isTenantOwner || (MANAGER_ROLES as readonly string[]).includes(role),
      isTenantOwner,
    },
  };
}

/**
 * Who may answer a booking request.
 *
 * Accepting fills the calendar and can charge a card the client already
 * agreed to; declining releases a slot and sends the client a no. The
 * destructive one needs a manager. This is the platform default until the
 * per-provider authority model lands — change these two lines, not the
 * call sites.
 */
export function mayDecide(actor: StaffActor, decision: 'accept' | 'decline'): boolean {
  if (decision === 'accept') return true;
  return actor.isManager;
}
