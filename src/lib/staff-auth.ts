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
import {
  evaluateDecision,
  resolveAuthority,
  type AuthorityPolicy,
  type DecisionAuthority,
  type DecisionVerdict,
  type EmploymentModel,
} from '@/lib/appointment-authority';

export const MANAGER_ROLES = ['owner', 'admin', 'manager'] as const;

export type StaffActor = {
  uid: string;
  name: string;
  role: string;
  isManager: boolean;
  isTenantOwner: boolean;
  employmentModel: EmploymentModel | null;
  decisionAuthority: DecisionAuthority | null;
};

export type StaffAuthResult =
  | { ok: true; actor: StaffActor; tenant: any }
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
    tenant: (tenantSnap.data() as any) || {},
    actor: {
      uid,
      name: String(staff?.name || (isTenantOwner ? 'The owner' : 'A team member')).slice(0, 80),
      role,
      isManager: isTenantOwner || (MANAGER_ROLES as readonly string[]).includes(role),
      isTenantOwner,
      employmentModel: (staff?.employmentModel as EmploymentModel) || null,
      decisionAuthority: (staff?.decisionAuthority as DecisionAuthority) || null,
    },
  };
}

/**
 * Who may answer a booking request.
 *
 * With no authority configured anywhere this resolves exactly as it did
 * before: anyone may accept, only a manager may decline.
 */
export function decisionVerdict(
  actor: StaffActor,
  decision: 'accept' | 'decline',
  opts?: { reasonCode?: string | null; policy?: AuthorityPolicy | null },
): DecisionVerdict {
  return evaluateDecision({
    decision,
    isManager: actor.isManager,
    employmentModel: actor.employmentModel,
    decisionAuthority: actor.decisionAuthority,
    role: actor.role,
    reasonCode: opts?.reasonCode ?? null,
    policy: opts?.policy ?? null,
  });
}

export function mayDecide(
  actor: StaffActor,
  decision: 'accept' | 'decline',
  opts?: { reasonCode?: string | null; policy?: AuthorityPolicy | null },
): boolean {
  return decisionVerdict(actor, decision, opts).allowed;
}

/** What this person may do with their own book, after every rule is applied. */
export function actorAuthority(
  actor: StaffActor,
  policy?: AuthorityPolicy | null,
): DecisionAuthority {
  return resolveAuthority({
    isManager: actor.isManager,
    employmentModel: actor.employmentModel,
    decisionAuthority: actor.decisionAuthority,
    role: actor.role,
    policy: policy ?? null,
  });
}
