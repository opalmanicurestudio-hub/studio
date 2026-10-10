// src/lib/route-guard.ts — "staff of this business, or our own server" for API
// routes that move money (charges, refunds, store credit). Staff prove it with
// their sign-in (Bearer token); server-to-server calls with CRON_SECRET.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import type { Cap } from '@/lib/permissions';

export async function staffOrServer(req: NextRequest, tenantId: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('x-cf-internal') === secret) return true;
  if (!(req.headers.get('authorization') || '').toLowerCase().startsWith('bearer ')) return false;
  const a: any = await verifyStaffActor(req, String(tenantId || '')).catch(() => null);
  return !!a?.ok;
}

// requireRole — WHO MAY CALL THIS ROUTE, by level. One check every sensitive route uses, so none can forget.
//   const g = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
// Levels: 'staff' (anyone on the team) · 'manager' (owners, admins, managers) · 'owner' (owners and admins).
// Identity comes from the signed-in token the app attaches to every call (components/shared/AuthFetch), checked by
// verifyStaffActor against this business's team — never from anything the caller writes in the request body.
export type GuardLevel = 'staff' | 'manager' | 'owner';
export async function requireRole(req: NextRequest, tenantId: string | null | undefined, level: GuardLevel = 'staff'): Promise<{ actor?: any; deny?: NextResponse }> {
  const tid = String(tenantId || '').trim().slice(0, 120);
  if (!tid) return { deny: NextResponse.json({ ok: false, error: 'Which business?' }, { status: 400 }) };
  const auth: any = await verifyStaffActor(req, tid).catch(() => null);
  if (!auth?.ok) return { deny: NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: auth?.status || 401 }) };
  const a = auth.actor; const role = String(a.role || '').toLowerCase(); const owner = !!a.isTenantOwner;
  const allowed = level === 'staff' ? true : level === 'manager' ? owner || !!a.isManager || ['owner', 'admin', 'manager'].includes(role) : owner || ['owner', 'admin'].includes(role);
  if (!allowed) return { deny: NextResponse.json({ ok: false, error: level === 'owner' ? 'Only the owner or an admin can do that.' : 'Only a manager can do that.' }, { status: 403 }) };
  return { actor: a };
}

// requireCan — the same, by what the person's role allows (lib/permissions): const g = await requireCan(req, tid, 'checkout.refund').
export async function requireCan(req: NextRequest, tenantId: string | null | undefined, cap: Cap): Promise<{ actor?: any; deny?: NextResponse }> {
  const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g;
  const a = g.actor; if (a.isTenantOwner || (Array.isArray(a.caps) && a.caps.includes(cap))) return g;
  return { deny: NextResponse.json({ ok: false, error: 'Your role doesn’t allow that — ask the owner.' }, { status: 403 }) };
}
