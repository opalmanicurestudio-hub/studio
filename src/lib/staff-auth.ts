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

import { capsFor, isManagerRole, ALL_CAPS } from '@/lib/permissions';
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
  uid: string;        // their STAFF record id (the same as their login for the owner and older records)
  authUid?: string;   // their login, when it differs (a team member invited to the app)
  name: string;
  role: string;
  isManager: boolean;
  isTenantOwner: boolean;
  caps?: string[];
  /** Signed in through the staff portal with their PIN. */
  portal?: boolean;
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

  let uid: string; let portalClaims = false;
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    uid = decoded.uid; portalClaims = (decoded as any).portal === true && (decoded as any).tenantId === tenantId;
  } catch {
    return { ok: false, error: 'Your session expired — sign in and try again.', status: 401 };
  }

  const db = getAdminDb();
  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  if (!tenantSnap.exists) {
    return { ok: false, error: 'Studio not found.', status: 404 };
  }

  // A staff-portal sign-in (PIN): uid is portal:{tenant}:{staffId}, signed by the server for this business only.
  const portalPrefix = `portal:${tenantId}:`;
  const viaPortal = portalClaims && uid.startsWith(portalPrefix);
  let staffSnap = await db.doc(`tenants/${tenantId}/staff/${viaPortal ? uid.slice(portalPrefix.length) : uid}`).get();
  // A team member invited to the app: their login is linked to their staff record through staffDirectory.
  if (!staffSnap.exists) { const dir: any = (await db.doc(`staffDirectory/${uid}`).get()).data(); if (dir?.tenantId === tenantId && dir.staffId) staffSnap = await db.doc(`tenants/${tenantId}/staff/${String(dir.staffId)}`).get(); }
  const staff = staffSnap.exists ? (staffSnap.data() as any) : null;
  const staffDocId = staffSnap.exists ? String(staffSnap.id) : uid;
  const isTenantOwner = (tenantSnap.data() as any)?.userId === uid;

  if (!isTenantOwner && !staff) {
    return { ok: false, error: 'You do not have access to this studio.', status: 403 };
  }
  if (!isTenantOwner && (staff?.archived === true || (!viaPortal && staff?.appAccess === 'off'))) {
    return { ok: false, error: 'Your access to this business has been turned off.', status: 403 };
  }

  const role = String(staff?.role || (isTenantOwner ? 'owner' : 'staff'));
  return {
    ok: true,
    tenant: (tenantSnap.data() as any) || {},
    actor: {
      uid: staffDocId,
      ...(staffDocId !== uid ? { authUid: uid } : {}),
      name: String(staff?.name || (isTenantOwner ? 'The owner' : 'A team member')).slice(0, 80),
      role,
      isManager: isTenantOwner || (MANAGER_ROLES as readonly string[]).includes(role) || isManagerRole(tenantSnap.data(), role),
      isTenantOwner,
      ...(viaPortal ? { portal: true } : {}),
      caps: isTenantOwner ? ALL_CAPS : capsFor(tenantSnap.data(), role),
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
