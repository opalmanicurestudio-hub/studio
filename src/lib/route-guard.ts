// src/lib/route-guard.ts — "staff of this business, or our own server" for API
// routes that move money (charges, refunds, store credit). Staff prove it with
// their sign-in (Bearer token); server-to-server calls with CRON_SECRET.
import type { NextRequest } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';

export async function staffOrServer(req: NextRequest, tenantId: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('x-cf-internal') === secret) return true;
  if (!(req.headers.get('authorization') || '').toLowerCase().startsWith('bearer ')) return false;
  const a: any = await verifyStaffActor(req, String(tenantId || '')).catch(() => null);
  return !!a?.ok;
}
