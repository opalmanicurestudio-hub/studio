/**
 * staff-auth (voice) — kept as a named entry point for the voice routes that
 * already import it. The implementation now lives in @/lib/staff-auth so
 * there is exactly one definition of "is this caller staff" in the codebase.
 */

import type { NextRequest } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';

export async function verifyStaff(
  req: NextRequest,
  tenantId: string,
): Promise<{ ok: true; uid: string } | { ok: false; error: string }> {
  const res = await verifyStaffActor(req, tenantId);
  if (res.ok) return { ok: true, uid: res.actor.uid };
  return { ok: false, error: res.error };
}
