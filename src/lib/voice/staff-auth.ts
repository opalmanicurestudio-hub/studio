/**
 * staff-auth — shared Firebase ID-token verification for staff-triggered
 * voice routes (execute-reschedule, execute-cancel, outbound-call).
 * Mirrors the Firestore rules' isStaff(): tenant owner (tenant.userId) or
 * a staff doc at tenants/{tenantId}/staff/{uid}.
 */

import type { NextRequest } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';

export async function verifyStaff(
  req: NextRequest,
  tenantId: string,
): Promise<{ ok: true; uid: string } | { ok: false; error: string }> {
  const header = req.headers.get('authorization') || '';
  const idToken = header.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return { ok: false, error: 'missing_token' };

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return { ok: false, error: 'invalid_token' };
  }

  const db = getAdminDb();
  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  if (!tenantSnap.exists) return { ok: false, error: 'tenant_not_found' };
  if ((tenantSnap.data() as any)?.userId === uid) return { ok: true, uid };

  const staffSnap = await db.doc(`tenants/${tenantId}/staff/${uid}`).get();
  if (staffSnap.exists) return { ok: true, uid };

  return { ok: false, error: 'not_staff' };
}
