// /api/retail/digital/notify-update — after the shop saves a new version of a download's file, its "Email buyers"
// (lib/digital-notices-server): everyone who bought it and can still open it hears once per file version. Managers only.
//   POST { tenantId, productId, fileIds: string[] }  → { sent, skipped, failed }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { notifyFileUpdate } from '@/lib/digital-notices-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const productId = String(b.productId || '').trim();
  const fileIds = Array.isArray(b.fileIds) ? b.fileIds.map((x: any) => String(x)).filter((x: string) => /^[A-Za-z0-9_-]{1,40}$/.test(x)).slice(0, 10) : [];
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(productId) || !fileIds.length) return bad('Missing details.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.status === 401 ? 'Please sign in again to send this.' : auth.error || 'Please sign in to continue.', auth.status || 401);
  if (!auth.actor?.isManager) return bad('Only managers can email buyers.', 403);
  try {
    const r = await notifyFileUpdate(getAdminDb(), tenantId, productId, fileIds);
    if (!r.ok) return bad(r.error, 409);
    return NextResponse.json(r);
  } catch (e: any) {
    console.error('[digital/notify-update]', String(e?.message || e).slice(0, 200));
    return bad('The emails couldn’t be sent just now. Try again.', 500);
  }
}
